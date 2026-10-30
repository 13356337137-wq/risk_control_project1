"""报告与指标查询。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from db.models import MetricValue, Report, Txn
from db.session import get_session

router = APIRouter(tags=["reports"])


@router.get("/reports/{task_id}")
def get_report(task_id: int, db: Session = Depends(get_session)):
    rep = db.execute(select(Report).where(Report.task_id == task_id).order_by(Report.version.desc())).scalars().first()
    if rep is None:
        raise HTTPException(404, "报告不存在")
    return rep.payload


@router.get("/tasks/{task_id}/transactions")
def get_transactions(task_id: int, limit: int = 500, db: Session = Depends(get_session)):
    rows = db.execute(select(Txn).where(Txn.task_id == task_id).order_by(Txn.id).limit(min(limit, 2000))).scalars().all()
    return [{"id": r.id, "txn_date": r.txn_date, "direction": r.direction,
             "amount": None if r.amount is None else str(r.amount),
             "balance": None if r.balance is None else str(r.balance),
             "summary": r.summary, "counterparty_name": r.counterparty_name,
             "page_no": r.page_no, "confidence": None if r.confidence is None else str(r.confidence)} for r in rows]


@router.get("/tasks/{task_id}/metrics")
def get_metrics(task_id: int, db: Session = Depends(get_session)):
    rows = db.execute(select(MetricValue).where(MetricValue.task_id == task_id).order_by(MetricValue.metric_code)).scalars().all()
    return [{"code": r.metric_code, "name": r.metric_name,
             "value": None if r.value_num is None else str(r.value_num),
             "unit": r.unit, "note": r.note, "caliber_version": r.caliber_version} for r in rows]

