"""与封存版本对象之间的适配。

为什么单独一个包：两个能力都用同一段映射（旧 ParseResult -> 新 Statement），
但能力之间不许互相 import。适配层不是能力，放在顶层 compat/ 下，谁都可以用。
M4 之后新解析器自己产出 Statement，这里只留「对照旧版」一个用途。
"""
from __future__ import annotations

from ..core.contracts import Statement, TxnRow


def txn_row(txn) -> TxnRow:
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


def statement_from_parsed(parsed) -> Statement:
    return Statement(
        rows=[txn_row(t) for t in parsed.transactions],
        footer_count=parsed.footer_count,
        page_count=parsed.page_count,
        warnings=list(parsed.warnings),
        native=parsed,
    )
