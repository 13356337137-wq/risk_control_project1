"""任务接口：上传受理、列表、详情。"""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from db.models import AuditLog, FileObj, MetricValue, Report, Task, TaskFile, Txn
from db.session import get_session
from helpers.security import require_local_access
from services.analysis import EncryptedFile, is_password_protected, run_analysis
from services.workflow import transition

router = APIRouter(prefix="/tasks", tags=["tasks"])
STORAGE = Path(__file__).resolve().parents[1] / "storage" / "uploads"
STORAGE.mkdir(parents=True, exist_ok=True)
PASSWORD_ATTEMPT_LIMIT = 3


def _safe_file_name(filename: str | None) -> str:
    return Path(filename or "材料文件").name[:120] or "材料文件"


def _find_or_create_file(
    db: Session,
    *,
    digest: str,
    mime: str | None,
    storage_path: Path,
) -> FileObj:
    row = db.execute(select(FileObj).where(FileObj.sha256 == digest)).scalars().first()
    if row is None:
        row = FileObj(sha256=digest, mime=mime, storage_path=str(storage_path))
        db.add(row)
        db.flush()
    return row


def _password_failure_count(db: Session, file_id: int) -> int:
    return int(db.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.action == "password_attempt_failed",
            AuditLog.object_type == "file",
            AuditLog.object_id == file_id,
        )
    ) or 0)


def _record_password_attempt(
    db: Session,
    *,
    file_id: int,
    file_name: str,
    outcome: str,
) -> None:
    """审计只记录材料名与结果，绝不记录口令或其派生值。"""
    db.add(AuditLog(
        action=f"password_attempt_{outcome}",
        object_type="file",
        object_id=file_id,
        detail=f"file={file_name}; result={outcome}",
    ))


@router.post("", status_code=status.HTTP_202_ACCEPTED)
def create_task(
    file: UploadFile = File(...),
    password: str | None = Form(None),
    period_start: str | None = Form(None),
    period_end: str | None = Form(None),
    source_ref: str | None = Form(None),
    bank_code: str | None = Form(None),
    db: Session = Depends(get_session),
    _: None = Depends(require_local_access),
):
    data = file.file.read()
    if not data:
        raise HTTPException(400, "文件为空")
    digest = hashlib.sha256(data).hexdigest()

    path = STORAGE / f"{uuid.uuid4().hex}{Path(file.filename or '').suffix or '.pdf'}"
    path.write_bytes(data)
    file_name = _safe_file_name(file.filename)

    protected = is_password_protected(data)
    password_file: FileObj | None = None
    if protected:
        password_file = _find_or_create_file(
            db, digest=digest, mime=file.content_type, storage_path=path,
        )
        if not password:
            _record_password_attempt(
                db, file_id=password_file.id, file_name=file_name, outcome="cancelled",
            )
            db.commit()
            raise HTTPException(400, detail={"code": "E_ENCRYPT", "message": "PDF 需要打开口令"})
        if _password_failure_count(db, password_file.id) >= PASSWORD_ATTEMPT_LIMIT:
            raise HTTPException(429, detail={"code": "E_LIMIT", "message": "该材料口令尝试次数已达上限"})

    template = None
    template_row = None
    if bank_code:
        from db.models import Template

        row = db.execute(
            select(Template).where(Template.bank_code == bank_code.upper(), Template.status == "enabled")
        ).scalars().first()
        if row:
            template_row = row
            template = {"bank_code": row.bank_code, "version": row.version, "field_map": row.field_map}

    try:
        result = run_analysis(data, password=password, template=template)
    except EncryptedFile as exc:
        if password_file is not None and password:
            _record_password_attempt(
                db, file_id=password_file.id, file_name=file_name, outcome="failed",
            )
            db.commit()
        raise HTTPException(400, detail={"code": "E_ENCRYPT", "message": str(exc)}) from exc
    except Exception as exc:  # 解析失败也要留任务与审计
        task = Task(
            biz_no=f"T{datetime.now():%Y%m%d%H%M%S}{uuid.uuid4().hex[:4]}",
            status="PENDING",
            failure_code="E_PARSE",
            created_at=datetime.now(),
            period_start=period_start,
            period_end=period_end,
        )
        db.add(task); db.flush()
        transition(task, "FAILED")
        db.commit(); db.refresh(task)
        db.add(AuditLog(action="create_task_failed", object_type="task", object_id=task.id, detail=str(exc)[:200]))
        db.commit()
        raise HTTPException(500, detail={"code": "E_PARSE", "message": str(exc)[:200]}) from exc

    file_obj = password_file or _find_or_create_file(
        db, digest=digest, mime=file.content_type, storage_path=path,
    )
    file_obj.mime = file.content_type
    file_obj.carrier = result["carrier"]
    file_obj.pages = result["pages"]
    file_obj.has_text_layer = result["has_text_layer"]
    if not file_obj.storage_path:
        file_obj.storage_path = str(path)

    task = Task(
        biz_no=f"T{datetime.now():%Y%m%d%H%M%S}{uuid.uuid4().hex[:4]}",
        task_type="credit", channel="upload", file_id=file_obj.id,
        carrier=result["carrier"], status="PENDING",
        template_id=template_row.id if template_row else None,
        template_version=template_row.version if template_row else None,
        period_start=period_start, period_end=period_end,
        check_result={"warnings": result["warnings"], "self_check": result.get("self_check")},
        finished_at=datetime.now(),
    )
    db.add(task); db.flush()
    db.add(TaskFile(task_id=task.id, file_id=file_obj.id, role="original", seq=1))

    # 现阶段仍同步执行分析；每次状态推进仍必须满足统一状态机。
    transition(task, "CHECKING")
    transition(task, "PARSING")
    transition(task, "VERIFYING")
    transition(task, "REPORTING")

    for i, t in enumerate(result["transactions"], start=1):
        db.add(Txn(
            task_id=task.id, txn_date=t["txn_date"], direction=t["direction"],
            amount=None if t["amount"] is None else Decimal(t["amount"]),
            balance=None if t["balance"] is None else Decimal(t["balance"]),
            summary=t["summary"], counterparty_name=t["counterparty_name"], page_no=t["page_no"],
            confidence=None if t["confidence"] is None else Decimal(t["confidence"]),
        ))
    for m in result["metrics"]:
        db.add(MetricValue(
            task_id=task.id, metric_code=m["code"], metric_name=m["name"],
            value_num=None if m["value"] is None else Decimal(m["value"]),
            unit=m["unit"], note=m["note"], caliber_version=m["caliber_version"],
        ))
    rep = result["report"]
    db.add(Report(
        task_id=task.id, version=1, carrier=rep["carrier"], verdict=rep["verdict"],
        verdict_reason=rep["verdict_reason"], layers=rep["layers"], limitations=rep["limitations"],
        evidence=rep["evidence"], materials=rep["materials"],
        metric_set_version=rep["metric_set_version"], threshold_version=rep["threshold_version"],
        payload=rep,
    ))
    db.add(AuditLog(action="create_task", object_type="task", object_id=task.id,
                   detail=f"source_ref={source_ref or '-'} carrier={rep['carrier']}"))
    if result["password_protected"] and password:
        _record_password_attempt(
            db, file_id=file_obj.id, file_name=file_name, outcome="success",
        )
    transition(task, "DONE")
    db.commit(); db.refresh(task)

    return {"task_id": task.id, "biz_no": task.biz_no, "status": task.status,
            "carrier": task.carrier, "txn_count": result["txn_count"]}


@router.get("")
def list_tasks(
    status: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_session),
    _: None = Depends(require_local_access),
):
    stmt = select(Task).order_by(Task.id.desc()).limit(min(limit, 100))
    if status:
        stmt = stmt.where(Task.status == status)
    rows = db.execute(stmt).scalars().all()
    return [{"id": t.id, "biz_no": t.biz_no, "status": t.status, "carrier": t.carrier,
             "created_at": t.created_at.isoformat() if t.created_at else None} for t in rows]


@router.get("/{task_id}")
def get_task(task_id: int, db: Session = Depends(get_session)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    return {"id": task.id, "biz_no": task.biz_no, "status": task.status, "carrier": task.carrier,
            "period_start": task.period_start, "period_end": task.period_end,
            "failure_code": task.failure_code,
            "created_at": task.created_at.isoformat() if task.created_at else None}


@router.post("/{task_id}/supplement", status_code=status.HTTP_202_ACCEPTED)
def add_supplement(
    task_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
    _: None = Depends(require_local_access),
):
    """为待补件任务追加材料；不创建新任务，也不覆盖历史材料。"""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    if task.status != "NEED_SUPPLEMENT":
        raise HTTPException(409, detail={"code": "E_STATE", "message": "当前任务不允许补件"})

    data = file.file.read()
    if not data:
        raise HTTPException(400, detail={"code": "E_FORMAT", "message": "补件文件为空"})
    digest = hashlib.sha256(data).hexdigest()
    existing = db.execute(
        select(TaskFile).join(FileObj, TaskFile.file_id == FileObj.id).where(
            TaskFile.task_id == task.id, FileObj.sha256 == digest,
        )
    ).scalars().first()
    if existing is not None:
        raise HTTPException(409, detail={"code": "E_STATE", "message": "该材料已在此任务中，无需重复补传"})

    path = STORAGE / f"{uuid.uuid4().hex}{Path(file.filename or '').suffix or '.pdf'}"
    path.write_bytes(data)
    file_obj = _find_or_create_file(
        db, digest=digest, mime=file.content_type, storage_path=path,
    )
    max_seq = db.scalar(select(func.max(TaskFile.seq)).where(TaskFile.task_id == task.id)) or 0
    db.add(TaskFile(task_id=task.id, file_id=file_obj.id, role="supplement", seq=int(max_seq) + 1))
    transition(task, "PARSING")
    db.add(AuditLog(
        action="add_supplement", object_type="task", object_id=task.id,
        detail=f"file={_safe_file_name(file.filename)}; file_id={file_obj.id}",
    ))
    db.commit()
    return {"task_id": task.id, "status": task.status, "file_id": file_obj.id, "material_count": int(max_seq) + 1}

