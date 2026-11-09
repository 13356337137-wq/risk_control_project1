"""字段关键词与取值形态。

两类信息分开：
- 关键词表：表头里怎么叫（同一字段各银行叫法不同，同一银行不同行也可能不同）
- 形态表：这一列的值长什么样（日期形、金额形、方向字…）

锚点扩散靠关键词起步，靠形态收敛；只有关键词没有形态会误扩，只有形态没有关键词会误判列义。
"""
from __future__ import annotations

import re

# 规范字段 -> 表头叫法。顺序无关，匹配时取最长命中。
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "txn_date": ("交易日期", "交易时间", "记账日期", "交易发生日期", "交易发生时间", "交易日", "日期", "入账日期"),
    "reference_no": ("交易流水号", "流水号", "参考号", "凭证号", "业务编号", "交易单号", "交易编号", "交易序号"),
    "summary": ("交易摘要", "摘要", "交易类型", "交易说明", "用途", "附言", "备注", "商品"),
    "counterparty": ("对方户名", "交易对方", "对方名称", "对方账户名", "对手方", "对手信息", "对方账号与户名", "收款方", "付款方", "商户名称"),
    "account_name": ("账户名称", "本方户名", "户名", "账户名", "开户人"),
    "direction": ("收/支", "借贷标志", "借贷方向", "收付标志", "借/贷", "收支", "方向"),
    "amount": ("交易金额", "发生额", "交易额", "发生金额", "金额(元)", "金额（元）", "金额"),
    "amount_in": ("收入金额", "贷方发生额", "贷方金额", "收入"),
    "amount_out": ("支出金额", "借方发生额", "借方金额", "支出"),
    "balance": ("账户余额", "交易后余额", "当前余额", "余额"),
}

MONEY_FIELDS = frozenset({"amount", "amount_in", "amount_out", "balance"})
TEXT_FIELDS = frozenset({"summary", "counterparty", "account_name"})

DATETIME_RE = re.compile(r"\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}")
SHORT_DATE_RE = re.compile(r"\d{2}[-/]\d{1,2}[-/]\d{1,2}")
MONEY_RE = re.compile(r"[¥￥]?\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\s*-?\d+(?:\.\d{1,2})?")
DIRECTION_CHARS = ("收", "支", "借", "贷", "入", "出")


def normalize(text: str) -> str:
    table = str.maketrans({"（": "(", "）": ")", "／": "/", "：": ":", "　": " ", "，": ","})
    return "".join(text.translate(table).split())


def match_header_field(text: str) -> str | None:
    """表头词 -> 规范字段。精确优先，其次包含（最长命中）。"""
    value = normalize(text)
    if not value:
        return None
    best: tuple[str, int] | None = None
    for field, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            key = normalize(alias)
            if not key:
                continue
            if value == key:
                return field
            if key in value and len(key) >= 2:
                if best is None or len(key) > best[1]:
                    best = (field, len(key))
    return best[0] if best else None


def is_date(text: str) -> bool:
    value = normalize(text)
    return bool(DATETIME_RE.search(value) or SHORT_DATE_RE.search(value))


def is_money(text: str) -> bool:
    value = normalize(text)
    if not value or is_date(value):
        return False
    if not MONEY_RE.fullmatch(value):
        return False
    digits = sum(ch.isdigit() for ch in value)
    return digits >= 2


def is_direction(text: str) -> bool:
    value = normalize(text)
    return len(value) <= 2 and any(ch in value for ch in DIRECTION_CHARS)


def is_reference(text: str) -> bool:
    value = normalize(text)
    if len(value) < 6 or is_date(value) or is_money(value):
        return False
    return sum(ch.isdigit() for ch in value) >= 4


def shape_ok(field: str, text: str) -> bool:
    """这一列的值是否像这个字段。文本类字段不做形态限制。"""
    if field in TEXT_FIELDS:
        return bool(normalize(text))
    if field == "txn_date":
        return is_date(text)
    if field in MONEY_FIELDS:
        return is_money(text)
    if field == "direction":
        return is_direction(text)
    if field == "reference_no":
        return is_reference(text)
    return False


def infer_by_position(fields_present: list[str], money_index: list[int], text_index: list[int]) -> dict[int, str]:
    """没有表头时按位置推字段：最左日期、最右金额=余额、其余金额=金额、最宽文本=摘要。"""
    mapping: dict[int, str] = {}
    if not money_index and not text_index:
        return mapping
    if len(money_index) >= 2:
        mapping[money_index[-1]] = "balance"
        for idx in money_index[:-1]:
            mapping[idx] = "amount"
    elif money_index:
        mapping[money_index[0]] = "amount"
    for rank, idx in enumerate(text_index):
        mapping.setdefault(idx, "summary" if rank == 0 else "counterparty")
    return mapping
