from decimal import Decimal

from algorithm.ocr.models import Transaction
from algorithm.algo.exclusions import analyze_exclusions


def _txn(
    summary: str | None,
    *,
    direction: str = "in",
    amount: str = "100",
    counterparty: str | None = None,
    row: int = 1,
) -> Transaction:
    return Transaction(
        page_no=1,
        row_no=row,
        txn_date="2026-01-05",
        summary=summary,
        counterparty_name=counterparty,
        direction=direction,
        amount=Decimal(amount),
        balance=Decimal("1000"),
    )


def test_clean_salary_is_kept():
    result = analyze_exclusions([_txn("代发工资", counterparty="甲公司")], holder_name="张三")
    assert result.kept_indices == [0]
    assert result.excluded == []
    assert result.inflow_after == result.inflow_before == Decimal("100")


def test_self_transfer_by_holder_name():
    result = analyze_exclusions(
        [_txn("转账", counterparty="张 三")], holder_name="张三"
    )
    assert result.excluded[0].category == "SELF_TRANSFER"
    assert result.inflow_after == 0


def test_self_transfer_by_summary():
    result = analyze_exclusions([_txn("本人账户互转")])
    assert result.excluded[0].category == "SELF_TRANSFER"


def test_refund_excluded():
    result = analyze_exclusions([_txn("退款", amount="20")])
    assert result.excluded[0].category == "REFUND"
    assert result.inflow_after == Decimal("0")


def test_loan_inflow_by_summary_and_counterparty():
    txns = [
        _txn("消费金融放款", amount="30000", counterparty="某消费金融公司"),
        _txn("转账", amount="5000", counterparty="某小额贷款有限公司", row=2),
    ]
    result = analyze_exclusions(txns)
    assert [item.category for item in result.excluded] == ["LOAN_INFLOW", "LOAN_INFLOW"]
    assert result.inflow_before == Decimal("35000")
    assert result.inflow_after == 0


def test_wealth_excluded():
    result = analyze_exclusions([_txn("理财赎回", amount="1000")])
    assert result.excluded[0].category == "WEALTH"


def test_credit_card_outflow_excluded_from_outflow():
    result = analyze_exclusions([_txn("信用卡还款", direction="out", amount="500")])
    assert result.excluded[0].category == "CREDIT_CARD"
    assert result.outflow_before == Decimal("500")
    assert result.outflow_after == 0


def test_third_party_pay_requires_institution_and_review():
    txns = [
        _txn("平台代付", amount="800", counterparty="某支付科技有限公司"),
        _txn("代发工资", amount="9000", counterparty="某公司", row=2),
    ]
    result = analyze_exclusions(txns)
    assert [item.category for item in result.excluded] == ["THIRD_PARTY_PAY"]
    assert result.excluded[0].needs_review is True
    assert "待人工认定" in result.notes[-1]


def test_first_matching_category_wins():
    result = analyze_exclusions([_txn("消费金融放款 理财", amount="1000")])
    assert result.excluded[0].category == "LOAN_INFLOW"


def test_category_totals_and_counts():
    result = analyze_exclusions(
        [
            _txn("退款", amount="10"),
            _txn("冲正", amount="20", row=2),
            _txn("工资", amount="100", row=3),
        ]
    )
    refund = next(item for item in result.categories if item.code == "REFUND")
    assert refund.count == 2
    assert refund.amount == Decimal("30")


def test_missing_holder_name_adds_note():
    result = analyze_exclusions([_txn("工资")])
    assert any("未提供本人姓名" in note for note in result.notes)
