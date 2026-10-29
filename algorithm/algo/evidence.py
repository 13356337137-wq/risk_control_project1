from __future__ import annotations

from ..ocr.models import Transaction
from .models import Evidence


def bbox_center(bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    return (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2


def txn_evidence(txn: Transaction, rule_code: str) -> Evidence:
    if txn.bbox is None:
        x = y = 0.0
    else:
        x, y = bbox_center(txn.bbox)
    return Evidence(
        rule_code=rule_code,
        page_no=txn.page_no,
        x=x,
        y=y,
        row_no=txn.row_no,
    )


def page_evidence(
    page_no: int,
    bbox: tuple[float, float, float, float] | None,
    rule_code: str,
) -> Evidence:
    if bbox is None:
        x = y = 0.0
    else:
        x, y = bbox_center(bbox)
    return Evidence(rule_code=rule_code, page_no=page_no, x=x, y=y)
