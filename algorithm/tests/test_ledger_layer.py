from datetime import date
from decimal import Decimal

from algorithm.algo import RatePeriod, RateTable, analyze_ledger, conclude
from algorithm.algo.models import ContentLayerResult
from algorithm.ocr.models import Transaction


def txn(
    day: str,
    summary: str,
    *,
    direction: str = "in",
    amount: str = "0.00",
    balance: str | None = None,
    confidence: float = 1.0,
    row_no: int = 1,
) -> Transaction:
    return Transaction(
        page_no=1,
        row_no=row_no,
        txn_date=day,
        summary=summary,
        direction=direction,
        amount=Decimal(amount),
        balance=None if balance is None else Decimal(balance),
        confidence=confidence,
        bbox=(10.0, 10.0 * row_no, 100.0, 10.0 * row_no + 8),
    )


def rate_table(tax_rate: str | None = None) -> RateTable:
    return RateTable(
        periods=[RatePeriod(effective_from=date(2026, 1, 1), annual_rate=Decimal("0.0035"))],
        tax_rate=None if tax_rate is None else Decimal(tax_rate),
    )


def interest_txns(actual: str = "8.94") -> list[Transaction]:
    return [
        txn("2026-03-21", "利息", amount="8.00", balance="10000.00", row_no=1),
        txn("2026-06-21", "利息", amount=actual, balance=str(Decimal("10000.00") + Decimal(actual)), row_no=2),
    ]


def check(result, code):
    return next(item for item in result.checks if item.code == code)


def test_interest_recalc_matches_when_rate_and_balances_agree():
    ledger = analyze_ledger(interest_txns(), rate_table=rate_table())
    a1 = check(ledger, "A1")
    assert a1.status == "pass"
    assert "1 期结息复算一致" in a1.detail
    assert check(ledger, "A2").status == "pass"
    assert ledger.status == "limited"


def test_interest_recalc_tamper_gives_balance_suspicious():
    ledger = analyze_ledger(interest_txns(actual="9.94"), rate_table=rate_table())
    a1 = check(ledger, "A1")
    assert a1.status == "fail"
    assert "应 8.94、印 9.94、差 +1.00" in a1.detail
    assert a1.evidence[0].row_no == 2
    assert ledger.status == "fail" and ledger.outcome == "余额可疑"

    verdict = conclude(ContentLayerResult(status="pass"), ledger=ledger)
    assert verdict.verdict == "余额可疑"


def test_interest_recalc_skipped_without_rate_table():
    ledger = analyze_ledger(interest_txns())
    assert check(ledger, "A1").status == "skipped"
    assert "无利率表" in check(ledger, "A1").detail


def test_interest_recalc_skips_low_confidence_rows():
    txns = interest_txns()
    txns[-1].confidence = 0.55
    ledger = analyze_ledger(txns, rate_table=rate_table())
    a1 = check(ledger, "A1")
    assert a1.status == "skipped"
    assert "低置信" in a1.detail
    assert ledger.status != "fail"


def test_interest_recalc_needs_previous_settlement_date():
    txns = [txn("2026-06-21", "利息", amount="8.94", balance="10008.94")]
    ledger = analyze_ledger(txns, rate_table=rate_table())
    assert check(ledger, "A1").status == "skipped"
    assert "无可用结息期" in check(ledger, "A1").detail

    ledger = analyze_ledger(
        txns,
        rate_table=rate_table(),
        interest_period_start=date(2026, 3, 21),
    )
    assert check(ledger, "A1").status == "skipped"
    assert "缺起始余额" in check(ledger, "A1").detail


def test_interest_date_outside_quarter_end_fails():
    txns = [txn("2026-06-15", "利息", amount="0.01", balance="100.00")]
    ledger = analyze_ledger(txns)
    a2 = check(ledger, "A2")
    assert a2.status == "fail"
    assert "不在季度结息日" in a2.detail
    assert ledger.status == "fail"


def test_interest_date_interval_must_be_quarterly_or_annual():
    txns = [
        txn("2026-03-21", "利息", amount="0.01", balance="100.00"),
        txn("2026-09-21", "利息", amount="0.01", balance="100.01"),
    ]
    a2 = check(analyze_ledger(txns), "A2")
    assert a2.status == "fail"
    assert "184 天" in a2.detail


def test_annual_interest_cadence_passes():
    txns = [
        txn("2025-12-31", "利息", amount="0.01", balance="100.00"),
        txn("2026-12-31", "利息", amount="0.01", balance="100.01"),
    ]
    assert check(analyze_ledger(txns), "A2").status == "pass"


def test_interest_tax_matches_and_mismatches():
    txns = interest_txns() + [
        txn("2026-03-21", "利息税", direction="out", amount="1.60", balance="9998.40"),
        txn("2026-06-21", "利息税", direction="out", amount="1.79", balance="10007.15"),
    ]
    ledger = analyze_ledger(txns, rate_table=rate_table(tax_rate="0.2"))
    assert check(ledger, "A3").status == "pass"

    txns[-1].amount = Decimal("1.00")
    ledger = analyze_ledger(txns, rate_table=rate_table(tax_rate="0.2"))
    assert check(ledger, "A3").status == "fail"


def test_fee_cadence_consistent_and_inconsistent():
    txns = [
        txn("2026-05-01", "短信费", direction="out", amount="3.00", balance="100.00"),
        txn("2026-06-01", "短信费", direction="out", amount="3.00", balance="97.00"),
        txn("2026-07-01", "短信费", direction="out", amount="3.00", balance="94.00"),
    ]
    assert check(analyze_ledger(txns), "A4").status == "pass"

    txns[1].amount = Decimal("5.00")
    a4 = check(analyze_ledger(txns), "A4")
    assert a4.status == "fail"
    assert "金额不一致" in a4.detail


def test_single_fee_record_cannot_check_cadence():
    txns = [txn("2026-09-21", "信使展期服务费", direction="out", amount="30.00", balance="21.65")]
    a4 = check(analyze_ledger(txns), "A4")
    assert a4.status == "skipped"
    assert "不足 2 笔" in a4.detail


def test_closing_balance_matches_last_row():
    txns = [txn("2026-06-21", "消费", direction="out", amount="10.00", balance="90.00")]
    assert check(analyze_ledger(txns, closing_balance=Decimal("90.00")), "A6").status == "pass"
    a6 = check(analyze_ledger(txns, closing_balance=Decimal("95.00")), "A6")
    assert a6.status == "fail"
    assert a6.evidence[0].row_no == 1


def test_overdraft_rules():
    negative = [txn("2026-06-21", "消费", direction="out", amount="10.00", balance="-1.00")]
    assert check(analyze_ledger(negative, overdraft_allowed=False), "A7").status == "fail"
    assert check(analyze_ledger(negative), "A7").status == "partial"
    assert check(analyze_ledger(negative, overdraft_allowed=True), "A7").status == "pass"

    frozen = [txn("2026-06-21", "司法冻结", amount="0.00", balance="10.00")]
    a7 = check(analyze_ledger(frozen), "A7")
    assert a7.status == "partial"
    assert "冻结" in a7.detail


def test_time_delay_is_always_limited_without_trade_time():
    ledger = analyze_ledger(interest_txns())
    assert check(ledger, "A5").status == "skipped"
    assert "交易时间" in check(ledger, "A5").detail
