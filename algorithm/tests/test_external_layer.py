from decimal import Decimal

from algorithm.algo.external_layer import (
    DEFAULT_ADAPTERS,
    EXTERNAL_CHECKS,
    ExternalCheckResult,
    ExternalContext,
    analyze_external,
)
from algorithm.algo.models import ContentLayerResult, Evidence, LayerConclusion
from algorithm.algo.verdict import conclude
from algorithm.ocr.models import Transaction


class _FixedAdapter:
    def __init__(
        self,
        code: str,
        status: str = "consistent",
        detail: str = "与外部记录一致",
        evidence: list[Evidence] | None = None,
    ) -> None:
        self.code = code
        self.name = dict(EXTERNAL_CHECKS)[code]
        self.status = status
        self.detail = detail
        self.evidence = evidence or []

    def check(self, context: ExternalContext) -> ExternalCheckResult:
        return ExternalCheckResult(
            code=self.code,
            name=self.name,
            status=self.status,
            detail=self.detail,
            evidence=list(self.evidence),
        )


class _BoomAdapter:
    code = "E3"
    name = "征信交叉"

    def check(self, context: ExternalContext) -> ExternalCheckResult:
        raise RuntimeError("征信接口超时")


def _context() -> ExternalContext:
    return ExternalContext(
        transactions=[
            Transaction(
                page_no=1,
                row_no=1,
                txn_date="2026-01-05",
                summary="工资",
                counterparty_name="甲公司",
                direction="in",
                amount=Decimal("10000"),
                balance=Decimal("10000"),
                bbox=(100.0, 200.0, 300.0, 240.0),
            )
        ],
        holder_name="张三",
        bank_name="工商银行",
    )


def _all_consistent() -> list[_FixedAdapter]:
    return [_FixedAdapter(code) for code, _ in EXTERNAL_CHECKS]


def test_default_adapters_cover_seven_checks():
    assert [adapter.code for adapter in DEFAULT_ADAPTERS] == [code for code, _ in EXTERNAL_CHECKS]
    assert len(DEFAULT_ADAPTERS) == 7


def test_placeholder_is_callable_and_returns_not_configured():
    adapter = DEFAULT_ADAPTERS[0]
    result = adapter(_context())
    assert result.code == "E1"
    assert result.status == "not_configured"
    assert "未启用" in result.detail


def test_default_run_degrades_to_unavailable():
    layer = analyze_external(_context())
    assert layer.layer == "external"
    assert layer.status == "unavailable"
    assert "7 项均未启用" in layer.detail
    assert len(layer.checks) == 7
    assert all(check.status == "skipped" for check in layer.checks)
    assert len(layer.limitations) == 7
    assert layer.evidence == []


def test_all_consistent_passes():
    layer = analyze_external(_context(), adapters=_all_consistent())
    assert layer.status == "pass"
    assert layer.outcome is None
    assert layer.limitations == []
    assert "7 项一致" in layer.detail


def test_inconsistent_counts_as_layer_failure():
    evidence = [Evidence(rule_code="E3", page_no=1, x=10.0, y=20.0, row_no=1)]
    adapters = _all_consistent()
    adapters[2] = _FixedAdapter(
        "E3", status="inconsistent", detail="征信月供 8000 元、流水还款 5000 元", evidence=evidence
    )
    layer = analyze_external(_context(), adapters=adapters)
    assert layer.status == "fail"
    assert layer.outcome == "存在不一致"
    assert "E3 征信交叉" in layer.detail
    assert any("E3 征信交叉" in item for item in layer.limitations)
    assert layer.evidence == evidence


def test_multiple_inconsistent_summarized():
    adapters = _all_consistent()
    adapters[2] = _FixedAdapter("E3", status="inconsistent", detail="月供不符")
    adapters[3] = _FixedAdapter("E4", status="inconsistent", detail="社保基数不符")
    layer = analyze_external(_context(), adapters=adapters)
    assert layer.status == "fail"
    assert layer.detail.startswith("2 项外部数据不一致；E3 征信交叉")


def test_adapter_exception_degrades_to_unavailable():
    layer = analyze_external(_context(), adapters=[_BoomAdapter()], enabled=["E3"])
    assert layer.status == "unavailable"
    assert "接口调用失败" in layer.detail or "外部接口不可用" in layer.detail
    e3 = next(check for check in layer.checks if check.code == "E3")
    assert "接口调用失败" in e3.detail
    assert any("E1 电子回单验真" in item for item in layer.limitations)


def test_enabled_subset_with_partial_data_is_limited():
    layer = analyze_external(_context(), adapters=_all_consistent(), enabled=["E5"])
    assert layer.status == "limited"
    assert "1 项一致" in layer.detail
    assert "6 项未取得数据" in layer.detail
    assert any("E1 电子回单验真" in item for item in layer.limitations)


def test_enabled_unknown_code_keeps_all_missing():
    layer = analyze_external(_context(), enabled=["E9"])
    assert layer.status == "unavailable"
    assert "7 项均未启用" in layer.detail


def test_conclude_without_external_data_is_not_found_with_limitations():
    external = analyze_external(_context())
    verdict = conclude(ContentLayerResult(status="pass"), external=external)
    assert verdict.verdict == "未发现异常"
    assert "部分检查不可算" in verdict.verdict_reason
    assert verdict.layers[-1].status == "unavailable"
    assert any("E1" in item and "未启用" in item for item in verdict.limitations)


def test_conclude_external_inconsistency_is_inconsistent():
    evidence = [Evidence(rule_code="E3", page_no=1, x=10.0, y=20.0, row_no=1)]
    adapters = _all_consistent()
    adapters[2] = _FixedAdapter(
        "E3", status="inconsistent", detail="征信月供与流水还款不符", evidence=evidence
    )
    external = analyze_external(_context(), adapters=adapters)
    verdict = conclude(ContentLayerResult(status="pass"), external=external)
    assert verdict.verdict == "存在不一致"
    assert "E3" in verdict.verdict_reason
    assert verdict.evidence == evidence


def test_ledger_failure_precedes_external_inconsistency():
    external = analyze_external(_context(), adapters=[_FixedAdapter("E3", "inconsistent")])
    ledger = LayerConclusion(layer="ledger", status="fail", detail="结息偏差 12.00 元")
    verdict = conclude(ContentLayerResult(status="pass"), ledger=ledger, external=external)
    assert verdict.verdict == "余额可疑"
