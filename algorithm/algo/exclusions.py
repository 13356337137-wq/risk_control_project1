from __future__ import annotations

import re
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field

from ..ocr.models import Transaction

ExclusionCode = Literal[
    "SELF_TRANSFER",
    "REFUND",
    "LOAN_INFLOW",
    "WEALTH",
    "CREDIT_CARD",
    "THIRD_PARTY_PAY",
]

CATEGORIES: dict[str, tuple[str, str]] = {
    "SELF_TRANSFER": ("同名互转", "自己账户间搬钱不是收入"),
    "REFUND": ("退款与冲正", "交易被撤销，不代表收入"),
    "LOAN_INFLOW": ("贷款放款", "借来的钱不是收入"),
    "WEALTH": ("理财赎回与申购", "本金回流不是收入"),
    "CREDIT_CARD": ("信用卡还款与取现", "负债周转不是收支"),
    "THIRD_PARTY_PAY": ("他人代付", "需单独认定"),
}

_SELF_SUMMARY = ("本人", "同名", "内部划转", "内部转账", "归集")
_REFUND = ("退款", "冲正", "撤销")
_LOAN_SUMMARY = ("放款", "贷款发放", "借款", "消费金融", "小额贷款", "网贷")
_LOAN_COUNTERPARTY = (
    "消费金融",
    "小额贷款",
    "借呗",
    "花呗",
    "网商银行",
    "微粒贷",
    "招联",
    "中邮消费",
    "马上消费",
    "捷信",
)
_WEALTH = ("理财", "基金", "赎回", "申购", "赎买")
_CREDIT = ("信用卡", "还款", "取现", "ATM")
_INSTITUTION = (
    "公司",
    "银行",
    "支付",
    "平台",
    "有限",
    "中心",
    "保险",
    "信托",
    "证券",
    "基金",
    "商行",
    "信用社",
)
_MASK = re.compile(r"[\s*＊·•]")


class ExcludedTxn(BaseModel):
    txn_index: int
    category: str
    category_name: str
    reason: str
    needs_review: bool = False
    page_no: int
    row_no: int
    txn_date: str | None = None
    summary: str | None = None
    counterparty_name: str | None = None
    direction: Literal["in", "out"] | None = None
    amount: Decimal | None = None


class ExclusionCategory(BaseModel):
    code: str
    name: str
    count: int = 0
    amount: Decimal = Decimal("0")


class ExclusionResult(BaseModel):
    excluded: list[ExcludedTxn] = Field(default_factory=list)
    categories: list[ExclusionCategory] = Field(default_factory=list)
    kept_indices: list[int] = Field(default_factory=list)
    inflow_before: Decimal = Decimal("0")
    inflow_after: Decimal = Decimal("0")
    outflow_before: Decimal = Decimal("0")
    outflow_after: Decimal = Decimal("0")
    notes: list[str] = Field(default_factory=list)


def normalize_name(text: str | None) -> str:
    return _MASK.sub("", text or "")


_norm = normalize_name


def _has(text: str | None, needles: tuple[str, ...]) -> bool:
    if not text:
        return False
    upper = text.upper()
    return any(needle.upper() in upper for needle in needles)


def _same_holder(txn: Transaction, holder_name: str | None) -> bool:
    holder = _norm(holder_name)
    if not holder:
        return False
    return _norm(txn.counterparty_name) == holder


def _match(
    txn: Transaction, holder_name: str | None
) -> tuple[ExclusionCode, str, bool] | None:
    summary = txn.summary
    counterparty = txn.counterparty_name
    direction = txn.direction

    if _same_holder(txn, holder_name) or _has(summary, _SELF_SUMMARY):
        return "SELF_TRANSFER", "对手方与本人同名或摘要指向本人账户", False
    if _has(summary, _REFUND):
        return "REFUND", f"摘要含 {next(w for w in _REFUND if w in (summary or ''))}", False
    if direction == "in" and (
        _has(summary, _LOAN_SUMMARY) or _has(counterparty, _LOAN_COUNTERPARTY)
    ):
        hit = next(
            (
                word
                for word in _LOAN_SUMMARY + _LOAN_COUNTERPARTY
                if word.upper() in (f"{summary or ''}{counterparty or ''}").upper()
            ),
            "放款",
        )
        return "LOAN_INFLOW", f"命中放贷机构或摘要含 {hit}", False
    if _has(summary, _WEALTH):
        return "WEALTH", f"摘要含 {next(w for w in _WEALTH if w in (summary or ''))}，属本金回流", False
    if _has(summary, _CREDIT):
        return "CREDIT_CARD", f"摘要含 {next(w for w in _CREDIT if w in (summary or '').upper())}", False

    pay_debit = _has(summary, ("代付",)) and not _has(summary, ("代发",))
    if direction == "in" and pay_debit and _has(counterparty, _INSTITUTION):
        return "THIRD_PARTY_PAY", "对手方为机构且摘要含代付，需单独认定", True
    return None


def analyze_exclusions(
    transactions: list[Transaction],
    *,
    holder_name: str | None = None,
) -> ExclusionResult:
    """六类剔除；按固定顺序匹配，一笔只归一类。"""
    excluded: list[ExcludedTxn] = []
    kept: list[int] = []
    inflow_before = outflow_before = Decimal("0")
    inflow_after = outflow_after = Decimal("0")
    by_category: dict[str, ExclusionCategory] = {
        code: ExclusionCategory(code=code, name=name) for code, (name, _) in CATEGORIES.items()
    }

    for index, txn in enumerate(transactions):
        amount = txn.amount
        if amount is not None:
            if txn.direction == "in":
                inflow_before += amount
            elif txn.direction == "out":
                outflow_before += amount

        hit = _match(txn, holder_name) if amount is not None else None
        if hit is None:
            kept.append(index)
            if amount is not None:
                if txn.direction == "in":
                    inflow_after += amount
                elif txn.direction == "out":
                    outflow_after += amount
            continue

        code, reason, needs_review = hit
        name = CATEGORIES[code][0]
        category = by_category[code]
        category.count += 1
        category.amount += amount
        excluded.append(
            ExcludedTxn(
                txn_index=index,
                category=code,
                category_name=name,
                reason=reason,
                needs_review=needs_review,
                page_no=txn.page_no,
                row_no=txn.row_no,
                txn_date=txn.txn_date,
                summary=txn.summary,
                counterparty_name=txn.counterparty_name,
                direction=txn.direction,
                amount=amount,
            )
        )

    notes: list[str] = []
    if not holder_name:
        notes.append("未提供本人姓名，同名互转仅按摘要识别")
    pending = sum(1 for item in excluded if item.needs_review)
    if pending:
        notes.append(f"{pending} 笔他人代付已剔除待人工认定")

    return ExclusionResult(
        excluded=excluded,
        categories=[by_category[code] for code in CATEGORIES],
        kept_indices=kept,
        inflow_before=inflow_before,
        inflow_after=inflow_after,
        outflow_before=outflow_before,
        outflow_after=outflow_after,
        notes=notes,
    )
