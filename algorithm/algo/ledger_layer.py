from __future__ import annotations

from bisect import bisect_right
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from pydantic import BaseModel, Field, field_validator

from ..ocr.models import Transaction
from ..ocr.parse import LOW_CONF
from .evidence import txn_evidence
from .models import CheckResult, LayerConclusion

MONEY_TOLERANCE = Decimal("0.01")
INTEREST_ABS_TOLERANCE = Decimal("0.05")
INTEREST_REL_TOLERANCE = Decimal("0.001")
MAX_EVIDENCE = 20

INTEREST_KEYWORDS = ("利息", "结息")
FEE_KEYWORDS = ("管理费", "短信费", "信使", "年费", "工本费", "手续费", "服务费")
FREEZE_KEYWORDS = ("冻结", "止付", "司法冻结")

QUARTER_DAYS = (85, 95)
ANNUAL_DAYS = (360, 370)
MONTH_DAYS = (28, 33)


class RatePeriod(BaseModel):
    """一段挂牌年利率；effective_from 当天起生效，直到下一段开始。"""

    effective_from: date
    annual_rate: Decimal
    day_basis: int = 360

    @field_validator("annual_rate")
    @classmethod
    def _positive(cls, value: Decimal) -> Decimal:
        if value < 0:
            raise ValueError("annual_rate 不能为负")
        return value

    @field_validator("day_basis")
    @classmethod
    def _basis(cls, value: int) -> int:
        if value not in (360, 365):
            raise ValueError("day_basis 只支持 360 或 365")
        return value


class RateTable(BaseModel):
    periods: list[RatePeriod] = Field(default_factory=list)
    tax_rate: Decimal | None = None


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _is_interest(txn: Transaction) -> bool:
    summary = (txn.summary or "").replace(" ", "")
    return any(key in summary for key in INTEREST_KEYWORDS) and "税" not in summary


def _is_fee(txn: Transaction) -> bool:
    summary = (txn.summary or "").replace(" ", "")
    return any(key in summary for key in FEE_KEYWORDS)


def _is_frozen(txn: Transaction) -> bool:
    summary = (txn.summary or "").replace(" ", "")
    return any(key in summary for key in FREEZE_KEYWORDS)


def _quantize(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _balance_days(transactions: list[Transaction]) -> tuple[list[date], list[Decimal]]:
    """按日取日终余额；同日多笔取最后一笔。"""
    by_day: dict[date, Decimal] = {}
    for txn in transactions:
        day = _parse_date(txn.txn_date)
        if day is None or txn.balance is None:
            continue
        by_day[day] = txn.balance
    days = sorted(by_day)
    return days, [by_day[day] for day in days]


def _balance_on(days: list[date], balances: list[Decimal], day: date) -> Decimal | None:
    index = bisect_right(days, day) - 1
    if index < 0:
        return None
    return balances[index]


def _rate_on(periods: list[RatePeriod], day: date) -> RatePeriod | None:
    chosen = None
    for period in periods:
        if period.effective_from <= day:
            chosen = period
        else:
            break
    return chosen


def _interest_tolerance(expected: Decimal) -> Decimal:
    return max(INTEREST_ABS_TOLERANCE, abs(expected) * INTEREST_REL_TOLERANCE)


def _low_confidence_in_period(
    transactions: list[Transaction], start: date, end: date
) -> bool:
    for txn in transactions:
        day = _parse_date(txn.txn_date)
        if day is not None and start <= day <= end and txn.confidence < LOW_CONF:
            return True
    return False


def _check_interest(
    transactions: list[Transaction],
    rate_table: RateTable | None,
    period_start: date | None,
) -> CheckResult:
    code, name = "A1", "结息反算"
    records = sorted(
        [t for t in transactions if _is_interest(t) and t.amount is not None],
        key=lambda t: _parse_date(t.txn_date) or date.min,
    )
    if rate_table is None or not rate_table.periods:
        return CheckResult(code=code, name=name, status="skipped", detail="无利率表，未做结息反算")
    if not records:
        return CheckResult(code=code, name=name, status="skipped", detail="无结息记录")

    days, balances = _balance_days(transactions)
    periods = sorted(rate_table.periods, key=lambda p: p.effective_from)
    failures: list[tuple[Transaction, Decimal, Decimal]] = []
    computed = 0
    skipped: list[str] = []

    previous_date = period_start
    for index, record in enumerate(records):
        end = _parse_date(record.txn_date)
        if end is None:
            skipped.append("结息日期无法解析")
            previous_date = end
            continue
        start = previous_date
        previous_date = end
        if start is None:
            if index == 0:
                continue
            skipped.append(f"{end} 缺上一结息日，未复算")
            continue
        accrual_end = end - timedelta(days=1)
        if start > accrual_end:
            skipped.append(f"{end} 计息区间为空")
            continue
        if record.confidence < LOW_CONF or _low_confidence_in_period(transactions, start, accrual_end):
            skipped.append(f"{end} 存在低置信行，先重跑解析")
            continue

        accrued = Decimal("0")
        incomplete = False
        day = start
        while day <= accrual_end:
            balance = _balance_on(days, balances, day)
            rate = _rate_on(periods, day)
            if balance is None or rate is None:
                incomplete = True
                break
            accrued += balance * rate.annual_rate / Decimal(rate.day_basis)
            day += timedelta(days=1)
        if incomplete:
            skipped.append(f"{end} 缺起始余额或适用利率，未复算")
            continue

        expected = _quantize(accrued)
        actual = record.amount
        computed += 1
        if abs(actual - expected) > _interest_tolerance(expected):
            failures.append((record, expected, actual))

    if failures:
        record, expected, actual = failures[0]
        detail = (
            f"{len(failures)} 个结息期偏差超容差；首处 {record.txn_date} "
            f"应 {expected}、印 {actual}、差 {actual - expected:+.2f} 元"
        )
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=[txn_evidence(txn, code) for txn, _, _ in failures[:MAX_EVIDENCE]],
        )
    if computed == 0:
        detail = skipped[0] if skipped else "无可用结息期"
        return CheckResult(code=code, name=name, status="skipped", detail=detail)
    if skipped:
        return CheckResult(
            code=code,
            name=name,
            status="partial",
            detail=f"复算 {computed} 期；{len(skipped)} 期不可算（{skipped[0]}）",
        )
    return CheckResult(code=code, name=name, status="pass", detail=f"{computed} 期结息复算一致")


def _check_interest_dates(transactions: list[Transaction]) -> CheckResult:
    code, name = "A2", "结息日规律"
    records = sorted(
        [t for t in transactions if _is_interest(t)],
        key=lambda t: _parse_date(t.txn_date) or date.min,
    )
    if not records:
        return CheckResult(code=code, name=name, status="skipped", detail="无结息记录")

    parsed: list[tuple[Transaction, date]] = []
    for record in records:
        day = _parse_date(record.txn_date)
        if day is None:
            return CheckResult(
                code=code,
                name=name,
                status="partial",
                detail="存在无法解析的结息日期",
                evidence=[txn_evidence(record, code)],
            )
        parsed.append((record, day))

    for record, day in parsed:
        quarterly = day.month in (3, 6, 9, 12) and day.day in (20, 21)
        year_end = day.month == 12 and day.day == 31
        if not (quarterly or year_end):
            detail = f"{day} 不在季度结息日（3/6/9/12 月 20/21 日）或年末"
            return CheckResult(
                code=code,
                name=name,
                status="fail",
                detail=detail,
                evidence=[txn_evidence(record, code)],
            )

    if len(parsed) >= 2:
        gaps = [(parsed[i][1] - parsed[i - 1][1]).days for i in range(1, len(parsed))]
        kinds = set()
        for index, gap in enumerate(gaps, start=1):
            if QUARTER_DAYS[0] <= gap <= QUARTER_DAYS[1]:
                kinds.add("quarter")
            elif ANNUAL_DAYS[0] <= gap <= ANNUAL_DAYS[1]:
                kinds.add("annual")
            else:
                detail = f"结息间隔 {gap} 天不符合季度或年度规律"
                return CheckResult(
                    code=code,
                    name=name,
                    status="fail",
                    detail=detail,
                    evidence=[txn_evidence(parsed[index][0], code)],
                )
        if len(kinds) > 1:
            detail = f"结息间隔不一致：{gaps} 天"
            return CheckResult(
                code=code,
                name=name,
                status="fail",
                detail=detail,
                evidence=[txn_evidence(parsed[-1][0], code)],
            )

    return CheckResult(
        code=code,
        name=name,
        status="pass",
        detail=f"{len(parsed)} 笔结息日期符合规律",
    )


def _check_interest_tax(
    transactions: list[Transaction], rate_table: RateTable | None
) -> CheckResult:
    code, name = "A3", "利息税"
    if rate_table is None or rate_table.tax_rate is None:
        return CheckResult(code=code, name=name, status="skipped", detail="未提供利息税率")
    interest = [t for t in transactions if _is_interest(t) and t.amount is not None]
    if not interest:
        return CheckResult(code=code, name=name, status="skipped", detail="无结息记录")
    tax_rate = rate_table.tax_rate
    taxes = [
        t for t in transactions
        if t.summary and "利息税" in t.summary and t.amount is not None
    ]

    failures: list[Transaction] = []
    for record in interest:
        expected = _quantize(record.amount * tax_rate)
        same_day = [t for t in taxes if _parse_date(t.txn_date) == _parse_date(record.txn_date)]
        actual = same_day[0].amount if same_day else Decimal("0")
        if abs(actual - expected) > MONEY_TOLERANCE:
            failures.append(record)

    if failures:
        record = failures[0]
        expected = _quantize(record.amount * tax_rate if record.amount is not None else Decimal("0"))
        detail = f"{len(failures)} 笔结息税额不符；首处 {record.txn_date} 应 {expected}"
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=[txn_evidence(txn, code) for txn in failures[:MAX_EVIDENCE]],
        )
    return CheckResult(code=code, name=name, status="pass", detail=f"{len(interest)} 笔利息税一致")


def _cadence(gap: int) -> str | None:
    for label, (low, high) in (("month", MONTH_DAYS), ("quarter", QUARTER_DAYS), ("annual", ANNUAL_DAYS)):
        if low <= gap <= high:
            return label
    return None


def _check_fees(transactions: list[Transaction]) -> CheckResult:
    code, name = "A4", "费用规律"
    fees = sorted(
        [t for t in transactions if _is_fee(t) and t.amount is not None and _parse_date(t.txn_date)],
        key=lambda t: _parse_date(t.txn_date) or date.min,
    )
    if not fees:
        return CheckResult(code=code, name=name, status="skipped", detail="无费用记录")

    groups: dict[str, list[Transaction]] = {}
    for txn in fees:
        groups.setdefault((txn.summary or "").replace(" ", ""), []).append(txn)

    checked = 0
    for label, items in groups.items():
        if len(items) < 2:
            continue
        amounts = {item.amount for item in items}
        if len(amounts) > 1:
            detail = f"「{label}」金额不一致：{sorted(str(a) for a in amounts)}"
            return CheckResult(
                code=code,
                name=name,
                status="fail",
                detail=detail,
                evidence=[txn_evidence(items[-1], code)],
            )
        gaps = [
            (_parse_date(items[i].txn_date) - _parse_date(items[i - 1].txn_date)).days
            for i in range(1, len(items))
        ]
        kinds = {_cadence(gap) for gap in gaps}
        if None in kinds or len(kinds) > 1:
            detail = f"「{label}」周期不一致：{gaps} 天"
            return CheckResult(
                code=code,
                name=name,
                status="fail",
                detail=detail,
                evidence=[txn_evidence(items[-1], code)],
            )
        checked += 1

    if checked == 0:
        return CheckResult(
            code=code,
            name=name,
            status="skipped",
            detail="费用记录不足 2 笔，无法核对周期",
        )
    return CheckResult(code=code, name=name, status="pass", detail=f"{checked} 类费用金额与周期一致")


def _check_closing(transactions: list[Transaction], closing_balance: Decimal | None) -> CheckResult:
    code, name = "A6", "期末余额"
    if closing_balance is None:
        return CheckResult(code=code, name=name, status="skipped", detail="未提供账户期末余额")
    with_balance = [t for t in transactions if t.balance is not None]
    if not with_balance:
        return CheckResult(code=code, name=name, status="skipped", detail="无可用余额行")
    last = with_balance[-1]
    diff = closing_balance - last.balance
    if abs(diff) > MONEY_TOLERANCE:
        detail = f"最后一笔余额 {last.balance} 与账户期末余额 {closing_balance} 差 {diff:+.2f}"
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=[txn_evidence(last, code)],
        )
    return CheckResult(code=code, name=name, status="pass", detail="最后一笔余额与账户期末余额一致")


def _check_overdraft(
    transactions: list[Transaction], overdraft_allowed: bool | None
) -> CheckResult:
    code, name = "A7", "透支与冻结"
    negatives = [t for t in transactions if t.balance is not None and t.balance < 0]
    frozen = [t for t in transactions if _is_frozen(t)]

    if negatives and overdraft_allowed is False:
        detail = f"出现 {len(negatives)} 笔负余额，与账户形态不符"
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=[txn_evidence(txn, code) for txn in negatives[:MAX_EVIDENCE]],
        )
    if frozen:
        return CheckResult(
            code=code,
            name=name,
            status="partial",
            detail=f"{len(frozen)} 笔摘要含冻结/止付标记，需人工核验",
            evidence=[txn_evidence(frozen[0], code)],
        )
    if negatives and overdraft_allowed is None:
        return CheckResult(
            code=code,
            name=name,
            status="partial",
            detail=f"出现 {len(negatives)} 笔负余额，未提供账户产品形态，未判定是否合理",
            evidence=[txn_evidence(negatives[0], code)],
        )
    if negatives:
        return CheckResult(code=code, name=name, status="pass", detail="负余额符合已声明的透支形态")
    return CheckResult(code=code, name=name, status="pass", detail="无负余额与冻结标记")


def analyze_ledger(
    transactions: list[Transaction],
    *,
    rate_table: RateTable | None = None,
    closing_balance: Decimal | None = None,
    overdraft_allowed: bool | None = None,
    interest_period_start: date | None = None,
) -> LayerConclusion:
    """账务层 A1–A7。A5 依赖交易时分与清算时间表，当前恒为不可算。"""
    checks = [
        _check_interest(transactions, rate_table, interest_period_start),
        _check_interest_dates(transactions),
        _check_interest_tax(transactions, rate_table),
        _check_fees(transactions),
        CheckResult(
            code="A5",
            name="到账时延",
            status="skipped",
            detail="缺交易时间与清算时间表，未核对",
        ),
        _check_closing(transactions, closing_balance),
        _check_overdraft(transactions, overdraft_allowed),
    ]
    failures = [check for check in checks if check.status == "fail"]
    limitations = [
        f"{check.code} {check.name}：{check.detail}"
        for check in checks
        if check.status in ("skipped", "partial")
    ]
    if failures:
        return LayerConclusion(
            layer="ledger",
            status="fail",
            detail=failures[0].detail,
            outcome="余额可疑",
            checks=checks,
            limitations=limitations,
            evidence=[item for check in failures for item in check.evidence],
        )
    if limitations:
        return LayerConclusion(
            layer="ledger",
            status="limited",
            detail=f"已完成 {sum(1 for c in checks if c.status == 'pass')} 项；{len(limitations)} 项不可算",
            checks=checks,
            limitations=limitations,
        )
    return LayerConclusion(
        layer="ledger",
        status="pass",
        detail="账务层 7 项核对通过",
        checks=checks,
    )
