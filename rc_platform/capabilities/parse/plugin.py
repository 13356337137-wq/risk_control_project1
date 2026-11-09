"""解析能力（兼容实现）：把文件读成逐笔明细。

M1 直接复用封存版本的 algorithm.ocr.parse（三级保底）。
M2 起这里换成两条能力并存：parse.template（走 layout 快通道）与 parse.generic（无模板主干）。
"""
from __future__ import annotations

from ...core.contracts import Statement, TxnRow
from ...core.paths import ensure_root_on_path
from ...core.registry import capability

ensure_root_on_path()


def _template_from_config(cfg: dict | None):
    if not cfg:
        return None
    from algorithm.ocr.models import Template as ParseTemplate

    return ParseTemplate(
        bank_code=str(cfg.get("bank_code", "UNKNOWN")),
        version=int(cfg.get("version", 1)),
        field_map=dict(cfg.get("field_map") or {}),
        layout=cfg.get("layout"),
    )


def _row(txn) -> TxnRow:
    return TxnRow(
        txn_date=txn.txn_date,
        trade_time=getattr(txn, "trade_time", None),
        reference_no=getattr(txn, "reference_no", None),
        direction=txn.direction,
        amount=txn.amount,
        balance=txn.balance,
        summary=txn.summary,
        counterparty_name=txn.counterparty_name,
        page_no=txn.page_no,
        row_no=txn.row_no,
        confidence=float(txn.confidence or 1.0),
        extra=getattr(txn, "extra", None),
    )


@capability
class AlgorithmParser:
    """兼容层：用封存版本的三级保底解析读明细。"""

    name = "parse.algorithm_compat"
    version = "1.0"
    provides = "statement"
    requires = ("document", "profile")
    priority = 0

    def run(self, ctx, inputs):
        from algorithm.ocr.parse import parse as parse_document

        doc = inputs["document"]
        template = _template_from_config(ctx.setting("parse.template"))
        parsed = parse_document(doc.data, template)
        return Statement(
            rows=[_row(t) for t in parsed.transactions],
            footer_count=parsed.footer_count,
            page_count=parsed.page_count,
            warnings=list(parsed.warnings),
            native=parsed,
        )
