from __future__ import annotations

from typing import Any, Iterable, Literal, Protocol, Sequence

from pydantic import BaseModel, Field

from ..ocr.models import Transaction
from .models import CheckResult, Evidence, LayerConclusion

ExternalStatus = Literal["consistent", "inconsistent", "not_configured", "unavailable", "skipped"]

EXTERNAL_CHECKS: tuple[tuple[str, str], ...] = (
    ("E1", "电子回单验真"),
    ("E2", "跨行调证"),
    ("E3", "征信交叉"),
    ("E4", "社保与个税"),
    ("E5", "行内代发"),
    ("E6", "多份互证"),
    ("E7", "电子签章 CA"),
)
EXTERNAL_CHECK_NAMES = dict(EXTERNAL_CHECKS)
EXTERNAL_REQUIREMENTS = {
    "E1": "需客户授权并接入网银或官方回单核验渠道",
    "E2": "需机构间函证协议",
    "E3": "需征信查询授权",
    "E4": "需客户授权社保与个税数据",
    "E5": "需本行代发数据接口",
    "E6": "需同一账户其他时段或同一人在他行的流水",
    "E7": "需签章证书链与有效期数据",
}
MAX_EXTERNAL_EVIDENCE = 20


class ExternalContext(BaseModel):
    """外部核验输入：明细 + 已获授权的第三方数据。materials 由适配器自行解释。"""

    transactions: list[Transaction] = Field(default_factory=list)
    holder_name: str | None = None
    account_no: str | None = None
    bank_name: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    materials: dict[str, Any] = Field(default_factory=dict)


class ExternalCheckResult(BaseModel):
    code: str
    name: str
    status: ExternalStatus
    detail: str
    evidence: list[Evidence] = Field(default_factory=list)


class ExternalAdapter(Protocol):
    code: str
    name: str

    def check(self, context: ExternalContext) -> ExternalCheckResult: ...


class PlaceholderAdapter:
    """接口占位：可调用，固定返回未启用，不编造外部数据。"""

    def __init__(self, code: str, name: str, requirement: str) -> None:
        self.code = code
        self.name = name
        self.requirement = requirement

    def check(self, context: ExternalContext) -> ExternalCheckResult:
        return ExternalCheckResult(
            code=self.code,
            name=self.name,
            status="not_configured",
            detail=f"{self.requirement}；外部核验未启用",
        )

    def __call__(self, context: ExternalContext) -> ExternalCheckResult:
        return self.check(context)


def default_adapters() -> list[ExternalAdapter]:
    return [
        PlaceholderAdapter(code, name, EXTERNAL_REQUIREMENTS[code])
        for code, name in EXTERNAL_CHECKS
    ]


DEFAULT_ADAPTERS: tuple[ExternalAdapter, ...] = tuple(default_adapters())

_CHECK_STATUS = {
    "consistent": "pass",
    "inconsistent": "fail",
    "not_configured": "skipped",
    "unavailable": "skipped",
    "skipped": "skipped",
}


def _dedupe_evidence(items: list[Evidence]) -> list[Evidence]:
    seen: set[tuple] = set()
    result: list[Evidence] = []
    for item in items:
        key = (item.rule_code, item.page_no, item.row_no)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def _to_check(result: ExternalCheckResult) -> CheckResult:
    return CheckResult(
        code=result.code,
        name=result.name,
        status=_CHECK_STATUS[result.status],
        detail=result.detail,
        evidence=result.evidence,
    )


def _run(adapter: ExternalAdapter, context: ExternalContext) -> ExternalCheckResult:
    try:
        return adapter.check(context)
    except Exception as exc:  # 外部接口不可用时降级，不中断主链
        return ExternalCheckResult(
            code=adapter.code,
            name=adapter.name,
            status="unavailable",
            detail=f"接口调用失败：{exc}",
        )


def analyze_external(
    context: ExternalContext,
    *,
    adapters: Sequence[ExternalAdapter] | None = None,
    enabled: Iterable[str] | None = None,
) -> LayerConclusion:
    """E1–E7 外部交叉。无授权或接口未启用时降级为「未发现异常但标注」，不猜数据。"""
    chosen = list(DEFAULT_ADAPTERS if adapters is None else adapters)
    if enabled is not None:
        allowed = {code.upper() for code in enabled}
        chosen = [adapter for adapter in chosen if adapter.code in allowed]

    results = [_run(adapter, context) for adapter in chosen]
    checked_codes = {result.code for result in results}
    missing = [code for code, _ in EXTERNAL_CHECKS if code not in checked_codes]

    consistent = [result for result in results if result.status == "consistent"]
    inconsistent = [result for result in results if result.status == "inconsistent"]
    failed = [result for result in results if result.status == "unavailable"]
    missing_data = [
        result for result in results if result.status in ("not_configured", "skipped")
    ]

    limitations = [
        f"{result.code} {result.name}：{result.detail}"
        for result in results
        if result.status != "consistent"
    ] + [
        f"{code} {EXTERNAL_CHECK_NAMES[code]}：外部核验未启用"
        for code in missing
    ]

    checks = [_to_check(result) for result in results] + [
        CheckResult(
            code=code,
            name=EXTERNAL_CHECK_NAMES[code],
            status="skipped",
            detail="外部核验未启用",
        )
        for code in missing
    ]

    if inconsistent:
        first = inconsistent[0]
        detail = f"{first.code} {first.name}：{first.detail}"
        if len(inconsistent) > 1:
            detail = f"{len(inconsistent)} 项外部数据不一致；{detail}"
        status = "fail"
        outcome = "存在不一致"
    elif consistent and not missing and not failed and not missing_data:
        status = "pass"
        outcome = None
        detail = f"外部核验 {len(consistent)} 项一致"
    elif consistent:
        status = "limited"
        outcome = None
        pending = len(missing) + len(failed) + len(missing_data)
        detail = f"外部核验部分完成：{len(consistent)} 项一致，{pending} 项未取得数据"
    else:
        status = "unavailable"
        outcome = None
        if failed:
            detail = f"外部接口不可用，{len(failed)} 项未取得数据"
            if missing or missing_data:
                detail += f"；{len(missing) + len(missing_data)} 项未启用"
        else:
            detail = f"外部核验未开通（{len(missing) + len(missing_data)} 项均未启用）"

    evidence = _dedupe_evidence(
        [
            item
            for result in inconsistent
            for item in result.evidence
        ]
    )[:MAX_EXTERNAL_EVIDENCE]

    return LayerConclusion(
        layer="external",
        status=status,
        detail=detail,
        outcome=outcome,
        checks=checks,
        limitations=limitations,
        evidence=evidence,
    )
