from decimal import Decimal

from algorithm.algo import analyze_content
from algorithm.algo.models import CheckResult
from algorithm.ocr.models import PageSummary, ParseResult, Transaction


def txn(
    row_no: int,
    *,
    page_no: int = 1,
    direction: str = "in",
    amount: str = "100.00",
    balance: str | None = None,
    confidence: float = 1.0,
) -> Transaction:
    return Transaction(
        page_no=page_no,
        row_no=row_no,
        txn_date="2025-01-01",
        summary="测试",
        direction=direction,
        amount=Decimal(amount),
        balance=None if balance is None else Decimal(balance),
        confidence=confidence,
        bbox=(10.0, float(row_no * 10), 100.0, float(row_no * 10 + 8)),
    )


def result(
    transactions: list[Transaction],
    *,
    summaries: list[PageSummary] | None = None,
    footer_count: int | None = None,
) -> ParseResult:
    return ParseResult(
        transactions=transactions,
        page_summaries=summaries or [],
        footer_count=footer_count,
    )


def check(checks: list[CheckResult], code: str) -> CheckResult:
    return next(item for item in checks if item.code == code)


def test_clean_statement_passes_without_limitations():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, direction="out", amount="50.00", balance="1050.00"),
    ]
    summaries = [PageSummary(page_no=1, printed_count=2, printed_in=Decimal("100.00"), printed_out=Decimal("50.00"))]
    out = analyze_content(
        result(txns, summaries=summaries, footer_count=2),
        opening_balance=Decimal("1000.00"),
        closing_balance=Decimal("1050.00"),
    )
    assert out.status == "pass"
    assert out.limitations == []
    assert all(item.status == "pass" for item in out.checks)


def test_balance_break_is_data_inconsistency_with_row_evidence():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, amount="100.00", balance="1300.00"),
    ]
    out = analyze_content(result(txns))
    c1 = check(out.checks, "C1")
    assert out.status == "inconsistent"
    assert c1.status == "fail"
    assert "1 处余额不连续" in c1.detail
    assert "+100.00" in c1.detail
    assert c1.attribution.cause == "data" and c1.attribution.action == "stop"
    assert [(e.page_no, e.row_no) for e in c1.evidence] == [(1, 2)]


def test_low_confidence_break_is_recognition_not_data():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, amount="100.00", balance="1300.00", confidence=0.55),
    ]
    out = analyze_content(result(txns))
    c1 = check(out.checks, "C1")
    assert c1.status == "fail"
    assert c1.attribution.cause == "recognition"
    assert c1.attribution.action == "manual"
    assert out.status == "undetermined"


def test_mixed_confidence_break_still_treated_as_data():
    txns = [
        txn(1, amount="100.00", balance="1100.00", confidence=0.55),
        txn(2, amount="100.00", balance="1300.00"),
    ]
    out = analyze_content(result(txns))
    c1 = check(out.checks, "C1")
    assert c1.attribution.cause == "data"
    assert out.status == "inconsistent"


def test_low_confidence_rows_are_skipped_not_failed():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, amount="100.00", balance="1200.00"),
        txn(3, amount="100.00", balance=None, confidence=0.5),
    ]
    out = analyze_content(result(txns))
    c1 = check(out.checks, "C1")
    assert c1.status == "skipped"
    assert c1.attribution.cause == "recognition"
    assert out.status == "limited"


def test_missing_balance_is_partial_not_fail():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, amount="100.00", balance="1200.00"),
        txn(3, amount="100.00", balance=None),
        txn(4, amount="100.00", balance="1400.00"),
    ]
    out = analyze_content(result(txns))
    c1 = check(out.checks, "C1")
    assert c1.status == "partial"
    assert "2 处字段缺失" in c1.detail
    assert out.status == "limited"


def test_page_total_mismatch_points_to_footer():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, amount="200.00", balance="1300.00"),
    ]
    summaries = [PageSummary(page_no=1, printed_count=2, printed_in=Decimal("999.00"), printed_out=Decimal("0.00"))]
    out = analyze_content(result(txns, summaries=summaries))
    c2 = check(out.checks, "C2")
    assert c2.status == "fail"
    assert "第 1 页合计不符" in c2.detail
    assert "收入 印 999.00 实 300.00" in c2.detail
    assert c2.attribution.cause == "data"
    assert out.status == "inconsistent"


def test_page_count_mismatch_fails():
    txns = [txn(1, amount="100.00", balance="1100.00")]
    summaries = [PageSummary(page_no=1, printed_count=3)]
    out = analyze_content(result(txns, summaries=summaries, footer_count=3))
    c3 = check(out.checks, "C3")
    assert c3.status == "fail"
    assert "第 1 页印 3 笔、解析 1 笔" in c3.detail
    assert c3.evidence[0].page_no == 1


def test_footer_total_count_mismatch_fails():
    txns = [txn(1, amount="100.00", balance="1100.00")]
    out = analyze_content(result(txns, footer_count=5))
    c3 = check(out.checks, "C3")
    assert c3.status == "fail"
    assert "页脚共 5 笔、解析 1 笔" in c3.detail


def test_opening_closing_skipped_when_absent():
    out = analyze_content(result([txn(1, amount="100.00", balance="1100.00")]))
    c4 = check(out.checks, "C4")
    assert c4.status == "skipped"
    assert "未标注期初/期末余额" in c4.detail
    assert out.status == "limited"


def test_opening_closing_closes():
    txns = [
        txn(1, amount="100.00", balance="1100.00"),
        txn(2, direction="out", amount="30.00", balance="1070.00"),
    ]
    out = analyze_content(
        result(txns),
        opening_balance=Decimal("1000.00"),
        closing_balance=Decimal("1070.00"),
    )
    assert check(out.checks, "C4").status == "pass"


def test_opening_closing_mismatch_fails():
    txns = [txn(1, amount="100.00", balance="1100.00")]
    out = analyze_content(
        result(txns),
        opening_balance=Decimal("1000.00"),
        closing_balance=Decimal("1200.00"),
    )
    c4 = check(out.checks, "C4")
    assert c4.status == "fail"
    assert "差 +100.00" in c4.detail


def test_empty_statement_is_undetermined():
    out = analyze_content(result([]))
    assert out.status == "undetermined"
    assert "未解析到交易明细，无法核对" in out.limitations
