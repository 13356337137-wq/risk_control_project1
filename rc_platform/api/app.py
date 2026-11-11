"""特征 Lab 的最小 API：算子目录、内置特征目录、表达式试算。

为什么先只做这三件事：特征 Lab 要回答的是「这个口径写出来是什么值」，
不需要任务、报告、权限那一整套。等 M6-7 把正式 API 接起来，这几个路由会挂进同一个应用。

安全边界：仅监听 127.0.0.1，只对**合成样本**试算，不接触真实客户流水；没有鉴权。
正式上线前必须换成带鉴权的路由，并只允许登录用户对自己有权的数据试算。
"""
from __future__ import annotations

import pathlib
from decimal import Decimal
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from rc_platform.capabilities.features import expr as expr_mod
from rc_platform.capabilities.features.library import feature_catalog, operator_catalog
from rc_platform.capabilities.features.operators import Frame, Series
from rc_platform.core.context import JobContext
from rc_platform.core.contracts import DocumentProfile, SourceDocument
from rc_platform.core.pipeline import Pipeline
from rc_platform.core.registry import default_registry
from rc_platform.lab import store as lab_store

ROOT = pathlib.Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "algorithm" / "inputs" / "samples" / "synthetic"

app = FastAPI(title="特征 Lab", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5175", "http://localhost:5175"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_STATEMENT_CACHE: dict[str, Any] = {}


class EvaluateRequest(BaseModel):
    sample: str
    expr: str | None = None
    code: str | None = None        # 也可以直接跑一条已保存的自定义特征


class CustomFeatureRequest(BaseModel):
    code: str
    name: str
    expr: str
    unit: str = ""
    description: str = ""


def _sample_path(name: str) -> pathlib.Path:
    candidate = (SAMPLES / name).resolve()
    if not str(candidate).startswith(str(SAMPLES.resolve())) or not candidate.exists():
        raise HTTPException(404, detail={"code": "E_NOT_FOUND", "message": f"样本不存在：{name}"})
    return candidate


def _statement(name: str):
    """解析一份样本并缓存：表达式试算要反复跑，不能每次都重新解析。"""
    if name in _STATEMENT_CACHE:
        return _STATEMENT_CACHE[name]
    path = _sample_path(name)
    data = path.read_bytes()
    registry = default_registry()
    plan = registry.plan("statement", overrides={"statement": "parse.layout_v2"})
    result = Pipeline(registry, plan, on_error="degrade").run(
        JobContext(job_id=name),
        {"document": SourceDocument(data=data, filename=name), "profile": DocumentProfile(carrier="electronic")},
    )
    statement = result.get("statement")
    if statement is None:
        raise HTTPException(422, detail={"code": "E_PARSE", "message": "这份样本解析失败：" + "；".join(result.degradation)})
    _STATEMENT_CACHE[name] = statement
    return statement


def _json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, Series):
        return [_json_safe(item) for item in value.values]
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


@app.get("/api/v1/lab/operators")
def list_operators():
    return {"items": operator_catalog()}


@app.get("/api/v1/lab/features")
def list_features():
    return {"items": feature_catalog()}


@app.get("/api/v1/lab/samples")
def list_samples():
    if not SAMPLES.exists():
        return {"items": []}
    return {
        "items": [
            {
                "name": path.relative_to(SAMPLES).as_posix(),
                "group": path.parent.name,
            }
            for path in sorted(SAMPLES.rglob("*.pdf"))
        ]
    }


@app.get("/api/v1/lab/custom")
def list_custom(include_history: bool = False):
    return {"items": lab_store.list_features(include_history=include_history)}


@app.post("/api/v1/lab/custom")
def save_custom(request: CustomFeatureRequest):
    try:
        return lab_store.save_feature(
            request.code, request.name, request.expr, unit=request.unit, description=request.description
        )
    except lab_store.LabFeatureError as exc:
        raise HTTPException(422, detail={"code": "E_FEATURE", "message": str(exc)}) from exc


@app.delete("/api/v1/lab/custom/{code}")
def delete_custom(code: str):
    return {"code": code, "deleted": lab_store.delete_feature(code)}


@app.post("/api/v1/lab/evaluate")
def evaluate(request: EvaluateRequest):
    expression = request.expr
    if not expression and request.code:
        record = lab_store.current(request.code)
        if record is None:
            raise HTTPException(404, detail={"code": "E_NOT_FOUND", "message": f"没有这条自定义特征：{request.code}"})
        expression = record["expr"]
    if not expression:
        raise HTTPException(422, detail={"code": "E_PARAM", "message": "expr 与 code 至少给一个"})

    statement = _statement(request.sample)
    frame = Frame(list(statement.rows))
    notes: list[str] = []
    try:
        value = expr_mod.eval_expr(expression, frame, notes=notes)
    except expr_mod.ExprError as exc:
        raise HTTPException(422, detail={"code": "E_EXPR", "message": str(exc)}) from exc
    except Exception as exc:  # noqa: BLE001 - 算子层面的错误要原样告诉调用方
        raise HTTPException(422, detail={"code": "E_OP", "message": str(exc)}) from exc

    preview = None
    if isinstance(value, Series):
        preview = [_json_safe(item) for item in value.values[:20]]

    return {
        "expr": expression,
        "value": _json_safe(value),
        "type": type(value).__name__,
        "notes": notes,
        "preview": preview,
        "rows": len(statement.rows),
    }
