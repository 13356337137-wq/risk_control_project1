from decimal import Decimal

from algorithm.algo.hits import (
    DEFAULT_LIBRARY,
    LexiconRule,
    RuleLibrary,
    detect_hits,
)
from algorithm.algo.metrics import compute_metrics
from algorithm.ocr.models import Transaction


def _txn(
    summary: str | None,
    *,
    counterparty: str | None = None,
    direction: str = "out",
    amount: str = "100",
    page: int = 2,
    row: int = 7,
) -> Transaction:
    return Transaction(
        page_no=page,
        row_no=row,
        txn_date="2026-05-10",
        summary=summary,
        counterparty_name=counterparty,
        direction=direction,
        amount=Decimal(amount),
        balance=Decimal("1000"),
        bbox=(100.0, 200.0, 300.0, 240.0),
    )


def test_loan_keyword_hit_carries_row_position():
    result = detect_hits([_txn("借呗还款")])
    hit = result.hits[0]
    assert hit.tag == "LOAN"
    assert hit.rule_code == "R_LOAN_PLATFORM"
    assert hit.matched == "借呗"
    assert (hit.span_start, hit.span_end) == (0, 2)
    assert hit.evidence.page_no == 2
    assert hit.evidence.row_no == 7
    assert (hit.evidence.x, hit.evidence.y) == (200.0, 220.0)


def test_gambling_keyword_hit():
    result = detect_hits([_txn("彩票充值")])
    assert [hit.tag for hit in result.hits] == ["GAMBLING"]
    assert result.labels[0] == {"GAMBLING"}


def test_counterparty_match():
    result = detect_hits([_txn("转账", counterparty="某消费金融有限公司")])
    hit = result.hits[0]
    assert hit.tag == "LOAN"
    assert hit.field == "counterparty_name"
    assert hit.matched == "消费金融"


def test_credit_card_repayment_not_tagged_as_loan():
    result = detect_hits([_txn("信用卡还款")])
    assert result.hits == []
    assert result.labels[0] == set()


def test_regex_context_for_small_loan_repayment():
    result = detect_hits([_txn("小贷公司扣款")])
    assert [hit.rule_code for hit in result.hits] == ["R_LOAN_REPAY"]
    assert result.hits[0].matched == "小贷公司扣款"


def test_crypto_case_insensitive():
    result = detect_hits([_txn("usdt 入金")])
    assert result.labels[0] == {"CRYPTO"}


def test_category_filter():
    txns = [_txn("借呗还款"), _txn("彩票充值", row=8)]
    result = detect_hits(txns, categories={"博彩"})
    assert [hit.tag for hit in result.hits] == ["GAMBLING"]
    assert result.labels[0] == set()
    assert result.labels[1] == {"GAMBLING"}


def test_custom_library():
    library = RuleLibrary(
        version=2,
        entries=[
            LexiconRule(
                rule_code="R_TEST",
                category="测试",
                tag="TEST",
                keywords=["测试词"],
                weight=Decimal("0.5"),
            )
        ],
    )
    result = detect_hits([_txn("这是一条测试词")], library=library)
    assert result.library_version == 2
    assert result.labels[0] == {"TEST"}
    assert result.hits[0].weight == Decimal("0.5")


def test_library_json_round_trip():
    restored = RuleLibrary.from_json(DEFAULT_LIBRARY.model_dump_json())
    assert restored.version == DEFAULT_LIBRARY.version
    assert [entry.rule_code for entry in restored.entries] == [
        entry.rule_code for entry in DEFAULT_LIBRARY.entries
    ]


def test_tag_counts_are_per_transaction():
    result = detect_hits([_txn("借呗还款")])
    assert result.tag_counts["LOAN"] >= 1
    assert result.tag_txn_counts["LOAN"] == 1


def test_labels_align_and_no_hits_note():
    result = detect_hits([_txn("工资"), _txn("消费", row=8)])
    assert len(result.labels) == 2
    assert result.labels == [set(), set()]
    assert "未命中" in result.notes[-1]


def test_repeated_detection_is_identical():
    txns = [_txn("借呗还款"), _txn("彩票充值", row=8)]
    first, second = detect_hits(txns), detect_hits(txns)
    assert [(h.rule_code, h.matched, h.span_start) for h in first.hits] == [
        (h.rule_code, h.matched, h.span_start) for h in second.hits
    ]


def test_metrics_accept_hits_labels():
    txns = [_txn("借呗还款"), _txn("彩票充值", row=8)]
    hits = detect_hits(txns)
    result = compute_metrics(txns, hits=hits)
    assert result.by_code("E04").value == Decimal("0.5000")
    assert result.by_code("E05").value == Decimal("0.5000")
    assert result.by_code("E06").value == Decimal("0.0000")
    assert any("规则库 v1" in note for note in result.notes)


def test_metrics_without_hits_still_null_for_loan_and_gambling():
    result = compute_metrics([_txn("借呗还款")])
    assert result.by_code("E04").value is None
    assert result.by_code("E05").value is None
