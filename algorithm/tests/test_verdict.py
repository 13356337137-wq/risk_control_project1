from decimal import Decimal

from algorithm.algo import analyze_content, conclude
from algorithm.algo.models import ContentLayerResult, Evidence
from algorithm.algo.verdict import LayerConclusion
from algorithm.ocr.models import PageSummary, ParseResult, Transaction


def clean_txns() -> list[Transaction]:
    return [
        Transaction(
            page_no=1,
            row_no=1,
            txn_date="2025-01-01",
            direction="in",
            amount=Decimal("100.00"),
            balance=Decimal("1100.00"),
        ),
        Transaction(
            page_no=1,
            row_no=2,
            txn_date="2025-01-02",
            direction="out",
            amount=Decimal("50.00"),
            balance=Decimal("1050.00"),
        ),
    ]


def clean_content() -> ContentLayerResult:
    return analyze_content(
        ParseResult(
            transactions=clean_txns(),
            page_summaries=[
                PageSummary(
                    page_no=1,
                    printed_count=2,
                    printed_in=Decimal("100.00"),
                    printed_out=Decimal("50.00"),
                )
            ],
            footer_count=2,
        ),
        opening_balance=Decimal("1000.00"),
        closing_balance=Decimal("1050.00"),
    )


def test_screenshot_caps_at_source_suspicious():
    out = conclude(clean_content(), carrier="screenshot")
    assert out.verdict == "来源可疑"
    assert "截图" in out.verdict_reason
    assert "截图件，不得作为授信依据" in out.limitations


def test_file_layer_source_suspicious_wins():
    file_layer = LayerConclusion(
        layer="file",
        status="fail",
        detail="字体与生成器不符",
        outcome="来源可疑",
        evidence=[Evidence(rule_code="F1", page_no=1, x=1.0, y=2.0)],
    )
    out = conclude(clean_content(), file_layer=file_layer)
    assert out.verdict == "来源可疑"
    assert out.verdict_reason == "字体与生成器不符"
    assert [(e.rule_code, e.page_no) for e in out.evidence] == [("F1", 1)]


def test_data_break_gives_inconsistent():
    broken = analyze_content(
        ParseResult(
            transactions=[
                Transaction(page_no=1, row_no=1, direction="in", amount=Decimal("100.00"), balance=Decimal("1100.00")),
                Transaction(page_no=1, row_no=2, direction="in", amount=Decimal("100.00"), balance=Decimal("1300.00")),
            ]
        )
    )
    out = conclude(broken)
    assert out.verdict == "存在不一致"
    assert "数据断" in out.verdict_reason
    assert out.evidence[0].row_no == 2
    assert out.layers[1].outcome == "存在不一致"


def test_ledger_failure_gives_balance_suspicious():
    ledger = LayerConclusion(
        layer="ledger",
        status="fail",
        detail="结息反算差额 12.34 元",
        evidence=[Evidence(rule_code="L1", page_no=2, x=5.0, y=6.0)],
    )
    out = conclude(clean_content(), ledger=ledger)
    assert out.verdict == "余额可疑"
    assert "12.34" in out.verdict_reason
    assert out.evidence[0].rule_code == "L1"


def test_undefined_when_only_low_confidence_rows_break():
    ocr_content = analyze_content(
        ParseResult(
            transactions=[
                Transaction(page_no=1, row_no=1, direction="in", amount=Decimal("100.00"), balance=Decimal("1100.00")),
                Transaction(
                    page_no=1,
                    row_no=2,
                    direction="in",
                    amount=Decimal("100.00"),
                    balance=Decimal("1300.00"),
                    confidence=0.55,
                ),
            ]
        )
    )
    out = conclude(ocr_content, carrier="image")
    assert out.verdict == "无法判定"
    assert "识别结果不可靠" in out.verdict_reason
    assert "影像件，核验受限，需人工复核" in out.limitations


def test_undefined_when_nothing_parsed():
    out = conclude(analyze_content(ParseResult()))
    assert out.verdict == "无法判定"


def test_all_clear_is_not_found_but_limited_without_other_layers():
    out = conclude(clean_content())
    assert out.verdict == "未发现异常"
    assert "部分检查不可算" in out.verdict_reason
    assert any(layer.status == "skipped" and layer.layer == "file" for layer in out.layers)


def test_all_layers_pass_is_not_found_without_limitations():
    passing = lambda name: LayerConclusion(layer=name, status="pass", detail="通过")  # noqa: E731
    out = conclude(
        clean_content(),
        file_layer=passing("file"),
        ledger=passing("ledger"),
        external=passing("external"),
    )
    assert out.verdict == "未发现异常"
    assert out.verdict_reason == "内容层核对通过，未发现矛盾"
    assert out.limitations == []


def test_layer_labels_are_normalised():
    out = conclude(clean_content(), file_layer=LayerConclusion(layer="content", status="pass", detail="通过"))
    assert [layer.layer for layer in out.layers] == ["file", "content", "ledger", "external"]
