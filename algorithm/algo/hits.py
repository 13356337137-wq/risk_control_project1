from __future__ import annotations

import re
import unicodedata
from datetime import date
from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field

from ..ocr.models import Transaction
from .evidence import txn_evidence
from .models import Evidence

HitField = Literal["summary", "counterparty_name"]

RULE_LIBRARY_VERSION = 1


class LexiconRule(BaseModel):
    """一条摘要/对手方词库规则；expr 按 contract 的 rule.expr 拼接。"""

    rule_code: str
    category: str
    tag: str
    keywords: list[str] = Field(default_factory=list)
    regex: str | None = None
    weight: Decimal = Decimal("1")
    source: str = "算法组"
    updated_at: date = date(2026, 10, 29)
    version: int = 1

    @property
    def expr(self) -> str:
        parts = list(self.keywords)
        if self.regex:
            parts.append(self.regex)
        return "|".join(parts)


class RuleLibrary(BaseModel):
    version: int = RULE_LIBRARY_VERSION
    entries: list[LexiconRule] = Field(default_factory=list)

    def filtered(self, categories: set[str] | None) -> list[LexiconRule]:
        if not categories:
            return self.entries
        return [entry for entry in self.entries if entry.category in categories]

    @classmethod
    def from_json(cls, payload: str) -> RuleLibrary:
        return cls.model_validate_json(payload)


class RuleHit(BaseModel):
    rule_code: str
    rule_version: int
    category: str
    tag: str
    weight: Decimal
    field: HitField
    matched: str
    span_start: int
    span_end: int
    txn_index: int
    page_no: int
    row_no: int
    txn_date: str | None = None
    summary: str | None = None
    counterparty_name: str | None = None
    direction: Literal["in", "out"] | None = None
    amount: Decimal | None = None
    evidence: Evidence


class HitResult(BaseModel):
    library_version: int
    hits: list[RuleHit] = Field(default_factory=list)
    labels: list[set[str]] = Field(default_factory=list)
    tag_counts: dict[str, int] = Field(default_factory=dict)
    tag_txn_counts: dict[str, int] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


def _fold(text: str) -> str:
    """全半角归一；长度变化时退回原文，保证 span 可回指原摘要。"""
    normalized = unicodedata.normalize("NFKC", text)
    return normalized if len(normalized) == len(text) else text


@lru_cache(maxsize=64)
def _compiled(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


def _match_text(
    text: str | None, rule: LexiconRule
) -> tuple[str, int, int] | None:
    if not text:
        return None
    folded = _fold(text)
    lowered = folded.lower()
    for keyword in rule.keywords:
        start = lowered.find(_fold(keyword).lower())
        if start >= 0:
            return folded[start : start + len(keyword)], start, start + len(keyword)
    if rule.regex:
        found = _compiled(rule.regex).search(folded)
        if found:
            return found.group(0), found.start(), found.end()
    return None


def _first_match(
    txn: Transaction, rule: LexiconRule
) -> tuple[HitField, str, int, int] | None:
    for field in ("summary", "counterparty_name"):
        matched = _match_text(getattr(txn, field), rule)
        if matched:
            text, start, end = matched
            return field, text, start, end
    return None


DEFAULT_LIBRARY = RuleLibrary(
    entries=[
        LexiconRule(
            rule_code="R_LOAN_PLATFORM",
            category="借贷",
            tag="LOAN",
            keywords=[
                "消费金融",
                "小额贷款",
                "借呗",
                "花呗",
                "备用金",
                "网贷",
                "微粒贷",
                "招联金融",
                "中邮消费",
                "马上消费",
                "捷信",
                "拍拍贷",
                "分期乐",
                "度小满",
                "360借条",
                "京东金条",
                "美团借钱",
                "放心借",
            ],
            weight=Decimal("1.0"),
            source="监管名录与人工归纳",
        ),
        LexiconRule(
            rule_code="R_LOAN_REPAY",
            category="借贷",
            tag="LOAN",
            regex=(
                "(小贷|网贷|消费金融|借呗|花呗|白条|金条|分期乐|度小满|微粒贷)"
                ".{0,10}(还款|扣款|分期|借款)"
                "|(还款|扣款).{0,10}"
                "(小贷|网贷|消费金融|借呗|花呗|白条|金条|分期乐|度小满|微粒贷)"
            ),
            weight=Decimal("0.8"),
            source="行业归纳",
        ),
        LexiconRule(
            rule_code="R_LOAN_WORD",
            category="借贷",
            tag="LOAN",
            keywords=["贷款发放", "放款", "借款", "贷款"],
            weight=Decimal("0.6"),
            source="行业归纳",
        ),
        LexiconRule(
            rule_code="R_GAMBLING",
            category="博彩",
            tag="GAMBLING",
            keywords=[
                "彩票",
                "棋牌",
                "博彩",
                "赌博",
                "赌场",
                "六合彩",
                "时时彩",
                "百家乐",
                "老虎机",
                "体育投注",
                "真人娱乐",
                "娱乐城",
                "返水",
                "彩金",
            ],
            regex=r"(下注|投注|赔率|博彩|娱乐城)",
            weight=Decimal("1.0"),
            source="监管与人工归纳",
        ),
        LexiconRule(
            rule_code="R_COLLECTION",
            category="资金归集",
            tag="COLLECTION",
            keywords=["代付", "代收", "收款码", "码商", "资金归集", "归集", "商户结算"],
            regex=r"(代付|代收|归集|码商)",
            weight=Decimal("0.8"),
            source="行业归纳",
        ),
        LexiconRule(
            rule_code="R_CASHOUT",
            category="套现",
            tag="CASHOUT",
            keywords=["POS机", "POS", "套现", "刷卡套现", "扫码套现", "商户收款"],
            weight=Decimal("0.9"),
            source="行业归纳",
        ),
        LexiconRule(
            rule_code="R_JUDICIAL",
            category="司法",
            tag="JUDICIAL",
            keywords=[
                "法院",
                "冻结",
                "扣划",
                "司法",
                "裁定",
                "判决",
                "查封",
                "强制执行",
                "执行款",
                "案款",
            ],
            weight=Decimal("1.0"),
            source="监管与人工归纳",
        ),
        LexiconRule(
            rule_code="R_INVEST",
            category="投资",
            tag="INVEST",
            keywords=["证券", "基金", "期货", "理财", "股票", "炒股", "黄金", "外汇", "信托"],
            weight=Decimal("0.6"),
            source="行业归纳",
        ),
        LexiconRule(
            rule_code="R_CRYPTO",
            category="虚拟币",
            tag="CRYPTO",
            keywords=[
                "虚拟币",
                "数字货币",
                "比特币",
                "以太坊",
                "USDT",
                "USDC",
                "BTC",
                "ETH",
                "火币",
                "币安",
                "欧易",
                "泰达币",
                "加密货币",
            ],
            regex=r"(USDT|USDC|BTC|ETH)",
            weight=Decimal("1.0"),
            source="监管与人工归纳",
        ),
    ]
)


def detect_hits(
    transactions: list[Transaction],
    *,
    library: RuleLibrary | None = None,
    categories: set[str] | None = None,
) -> HitResult:
    """摘要/对手方词库命中；标签只作线索，不改真伪结论。"""
    library = library or DEFAULT_LIBRARY
    rules = library.filtered(categories)
    labels: list[set[str]] = [set() for _ in transactions]
    hits: list[RuleHit] = []
    tag_txns: dict[str, set[int]] = {}

    for index, txn in enumerate(transactions):
        for rule in rules:
            matched = _first_match(txn, rule)
            if matched is None:
                continue
            field, text, start, end = matched
            hits.append(
                RuleHit(
                    rule_code=rule.rule_code,
                    rule_version=rule.version,
                    category=rule.category,
                    tag=rule.tag,
                    weight=rule.weight,
                    field=field,
                    matched=text,
                    span_start=start,
                    span_end=end,
                    txn_index=index,
                    page_no=txn.page_no,
                    row_no=txn.row_no,
                    txn_date=txn.txn_date,
                    summary=txn.summary,
                    counterparty_name=txn.counterparty_name,
                    direction=txn.direction,
                    amount=txn.amount,
                    evidence=txn_evidence(txn, rule.rule_code),
                )
            )
            labels[index].add(rule.tag)
            tag_txns.setdefault(rule.tag, set()).add(index)

    tag_counts: dict[str, int] = {}
    for hit in hits:
        tag_counts[hit.tag] = tag_counts.get(hit.tag, 0) + 1

    notes = ["命中标签仅作线索，不改变真伪结论"]
    if not hits:
        notes.append("规则库未命中任何词条")

    return HitResult(
        library_version=library.version,
        hits=hits,
        labels=labels,
        tag_counts=tag_counts,
        tag_txn_counts={tag: len(items) for tag, items in sorted(tag_txns.items())},
        notes=notes,
    )
