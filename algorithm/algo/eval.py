from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from ..ocr.models import ParseResult
from ..ocr.parse import LOW_CONF, parse
from .content_layer import analyze_content
from .external_layer import ExternalContext, analyze_external
from .file_layer import analyze_file
from .ledger_layer import analyze_ledger
from .models import CheckResult, Evidence, LayerConclusion
from .samples import (
    LoadedSample,
    SampleCase,
    SampleManifest,
    build_sample_set,
    load_manifest,
    load_samples,
)
from .verdict import conclude

EVAL_VERSION = 1

EvalCause = Literal[
    "recognition",
    "parsing",
    "rule_gap",
    "parameter_missing",
    "false_positive",
    "verdict_logic",
]
EvalAction = Literal[
    "rerun_or_manual",
    "fix_parser",
    "tune_rule",
    "add_parameter",
    "review_rule",
    "fix_verdict",
]

_ACTION: dict[str, EvalAction] = {
    "recognition": "rerun_or_manual",
    "parsing": "fix_parser",
    "rule_gap": "tune_rule",
    "parameter_missing": "add_parameter",
    "false_positive": "review_rule",
    "verdict_logic": "fix_verdict",
}


class EvalIssue(BaseModel):
    cause: EvalCause
    action: EvalAction
    detail: str
    rule_codes: list[str] = Field(default_factory=list)


class EvalCaseResult(BaseModel):
    id: str
    layout: str
    forgery: str | None
    expected_verdict: str
    actual_verdict: str
    expected_txn_count: int | None
    actual_txn_count: int
    expected_fail_codes: list[str]
    actual_fail_codes: list[str]
    missing_codes: list[str]
    extra_codes: list[str]
    passed: bool
    verdict_reason: str
    layer_status: dict[str, str]
    issues: list[EvalIssue] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class EvalSummary(BaseModel):
    total: int
    passed: int
    failed: int
    sample_pass_rate: float
    verdict_accuracy: float
    txn_count_accuracy: float
    required_code_recall: float
    forgery_recall: float
    clean_false_positive_rate: float
    by_cause: dict[str, int] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)


class EvalReport(BaseModel):
    eval_version: int = EVAL_VERSION
    sample_set_version: int
    samples: str
    cases: list[EvalCaseResult] = Field(default_factory=list)
    summary: EvalSummary


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def _fail_codes(
    content_checks: list[CheckResult],
    layers: tuple[LayerConclusion, ...],
) -> list[str]:
    codes: list[str] = []
    for check in content_checks:
        if check.status == "fail" and check.code not in codes:
            codes.append(check.code)
    for layer in layers:
        for check in layer.checks:
            if check.status == "fail" and check.code not in codes:
                codes.append(check.code)
    return codes


def _content_recognition(content) -> bool:
    return any(
        check.status == "fail"
        and check.attribution is not None
        and check.attribution.cause == "recognition"
        for check in content.checks
    )


def _content_failure_detail(content) -> str:
    for check in content.checks:
        if check.status == "fail":
            if check.attribution is not None:
                return f"{check.code} {check.name}：{check.detail}；{check.attribution.detail}"
            return f"{check.code} {check.name}：{check.detail}"
    return "内容层未给出失败项"


def _layer_status(code: str, layers: dict[str, LayerConclusion]) -> str:
    layer = {"F": "file", "C": "content", "A": "ledger", "E": "external"}.get(code[:1])
    if layer is None:
        return "unknown"
    return f"{layer} {layers[layer].status}"


def _cause_for_missing(code: str, parsed: ParseResult, content) -> EvalCause:
    if code.startswith(("F", "E")):
        if code in ("F4", "F10") or code.startswith("E"):
            return "parameter_missing"
        return "rule_gap"
    if code.startswith("A"):
        return "parameter_missing" if code in ("A1", "A3", "A4", "A5", "A6") else "rule_gap"
    if code.startswith("C"):
        if parsed.low_conf_ratio > 0 or _content_recognition(content):
            return "recognition"
        return "rule_gap"
    return "rule_gap"


def _missing_issue(
    code: str,
    parsed: ParseResult,
    content,
    layers: dict[str, LayerConclusion],
) -> EvalIssue:
    cause = _cause_for_missing(code, parsed, content)
    detail = f"应命中 {code} 但未命中；{_layer_status(code, layers)}"
    if cause == "parameter_missing":
        detail += "；缺基线、利率/税率/费用或外部授权"
    elif cause == "recognition":
        detail += f"；低置信占比 {parsed.low_conf_ratio:.2f}"
    return EvalIssue(cause=cause, action=_ACTION[cause], detail=detail, rule_codes=[code])


def _count_issue(parsed: ParseResult, expected: int) -> EvalIssue:
    recognition = parsed.low_conf_ratio > 0 or any(
        txn.confidence < LOW_CONF for txn in parsed.transactions
    )
    cause: EvalCause = "recognition" if recognition else "parsing"
    detail = (
        f"解析 {len(parsed.transactions)} 笔、期望 {expected} 笔；"
        f"平均置信度 {parsed.avg_confidence:.2f}、低置信占比 {parsed.low_conf_ratio:.2f}"
    )
    if parsed.warnings:
        detail += "；警告：" + "；".join(parsed.warnings[:3])
    return EvalIssue(cause=cause, action=_ACTION[cause], detail=detail)


def _false_positive_issue(
    codes: list[str],
    content,
    layers: dict[str, LayerConclusion],
) -> EvalIssue:
    if _content_recognition(content):
        detail = f"干净样本被判失败，内容层归因为识别问题：{_content_failure_detail(content)}"
        return EvalIssue(cause="recognition", action="rerun_or_manual", detail=detail, rule_codes=codes)
    layer_text = "、".join(_layer_status(code, layers) for code in codes)
    detail = f"干净样本出现失败检查：{', '.join(codes)}（{layer_text}）"
    return EvalIssue(cause="false_positive", action="review_rule", detail=detail, rule_codes=codes)


def _dedupe_evidence(items: list[Evidence]) -> list[Evidence]:
    seen: set[tuple] = set()
    result: list[Evidence] = []
    for item in items:
        key = (item.rule_code, item.page_no, item.row_no)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def evaluate_case(sample: LoadedSample) -> EvalCaseResult:
    case: SampleCase = sample.case
    raw = sample.read_bytes()
    parsed = parse(raw)
    content = analyze_content(parsed)
    file_layer = analyze_file(raw, carrier=case.carrier)
    ledger = analyze_ledger(parsed.transactions)
    external = analyze_external(ExternalContext(transactions=parsed.transactions))
    verdict = conclude(
        content,
        carrier=case.carrier,
        file_layer=file_layer,
        ledger=ledger,
        external=external,
    )

    actual_codes = _fail_codes(content.checks, (file_layer, ledger, external))
    expected = case.expectation
    missing = [code for code in expected.fail_codes if code not in actual_codes]
    extra = [code for code in actual_codes if code not in expected.fail_codes]
    layers = {layer.layer: layer for layer in verdict.layers}

    issues: list[EvalIssue] = []
    if expected.txn_count is not None and expected.txn_count != len(parsed.transactions):
        issues.append(_count_issue(parsed, expected.txn_count))
    for code in missing:
        issues.append(_missing_issue(code, parsed, content, layers))
    if case.forgery is None and extra:
        issues.append(_false_positive_issue(extra, content, layers))
    if verdict.verdict != expected.verdict:
        issues.append(
            EvalIssue(
                cause="verdict_logic",
                action=_ACTION["verdict_logic"],
                detail=f"期望「{expected.verdict}」，实际「{verdict.verdict}」：{verdict.verdict_reason}",
            )
        )

    return EvalCaseResult(
        id=case.id,
        layout=case.layout,
        forgery=case.forgery,
        expected_verdict=expected.verdict,
        actual_verdict=verdict.verdict,
        expected_txn_count=expected.txn_count,
        actual_txn_count=len(parsed.transactions),
        expected_fail_codes=list(expected.fail_codes),
        actual_fail_codes=actual_codes,
        missing_codes=missing,
        extra_codes=extra,
        passed=not issues,
        verdict_reason=verdict.verdict_reason,
        layer_status={layer.layer: layer.status for layer in verdict.layers},
        issues=issues,
        evidence=_dedupe_evidence(verdict.evidence),
        warnings=parsed.warnings,
    )


def evaluate_samples(directory: str | Path) -> EvalReport:
    root = Path(directory)
    manifest: SampleManifest = load_manifest(root)
    samples = load_samples(root)
    cases = [evaluate_case(sample) for sample in samples]

    total = len(cases)
    passed = sum(1 for case in cases if case.passed)
    verdict_hits = sum(1 for case in cases if case.actual_verdict == case.expected_verdict)
    count_cases = [case for case in cases if case.expected_txn_count is not None]
    count_hits = sum(
        1 for case in count_cases if case.actual_txn_count == case.expected_txn_count
    )
    required_total = sum(len(case.expected_fail_codes) for case in cases)
    required_missing = sum(len(case.missing_codes) for case in cases)
    forged = [case for case in cases if case.forgery is not None]
    forged_hits = sum(1 for case in forged if case.passed)
    clean = [case for case in cases if case.forgery is None]
    clean_false_positives = sum(
        1
        for case in clean
        if case.actual_verdict != case.expected_verdict or case.actual_fail_codes
    )
    by_cause: dict[str, int] = {}
    for case in cases:
        for issue in case.issues:
            by_cause[issue.cause] = by_cause.get(issue.cause, 0) + 1

    notes = [
        "样本集为合成件，准确率只反映当前版式与伪造类型，不代表真实客群分布。",
        f"覆盖 {len({case.layout for case in cases})} 类版式、{len({case.forgery for case in forged})} 类伪造。",
    ]
    if not required_total:
        notes.append("样本清单没有必需失败码，失败码召回率记为 1.0。")

    summary = EvalSummary(
        total=total,
        passed=passed,
        failed=total - passed,
        sample_pass_rate=_ratio(passed, total),
        verdict_accuracy=_ratio(verdict_hits, total),
        txn_count_accuracy=_ratio(count_hits, len(count_cases)),
        required_code_recall=_ratio(required_total - required_missing, required_total) if required_total else 1.0,
        forgery_recall=_ratio(forged_hits, len(forged)),
        clean_false_positive_rate=_ratio(clean_false_positives, len(clean)),
        by_cause=by_cause,
        notes=notes,
    )
    return EvalReport(
        sample_set_version=manifest.version,
        samples=root.resolve().as_posix(),
        cases=cases,
        summary=summary,
    )


def format_report(report: EvalReport) -> str:
    summary = report.summary
    lines = [
        f"AL-16 样本评测报告（eval v{report.eval_version}，样本集 v{report.sample_set_version}）",
        f"样本目录：{report.samples}",
        (
            f"样本 {summary.total}，通过 {summary.passed}，失败 {summary.failed}；"
            f"通过率 {summary.sample_pass_rate:.2%}"
        ),
        (
            f"五态准确率 {summary.verdict_accuracy:.2%}；"
            f"笔数准确率 {summary.txn_count_accuracy:.2%}；"
            f"必需失败码召回 {summary.required_code_recall:.2%}；"
            f"伪造检出 {summary.forgery_recall:.2%}；"
            f"干净件误判 {summary.clean_false_positive_rate:.2%}"
        ),
        "",
        "逐例：",
    ]
    for case in report.cases:
        flag = "PASS" if case.passed else "FAIL"
        count = f"{case.actual_txn_count}/{case.expected_txn_count or '-'}"
        lines.append(
            f"[{flag}] {case.id} ({case.layout}{'/' + case.forgery if case.forgery else ''}) "
            f"五态 {case.actual_verdict}（期望 {case.expected_verdict}），笔数 {count}，"
            f"失败码 {','.join(case.actual_fail_codes) or '-'}"
        )
        for issue in case.issues:
            lines.append(f"    - {issue.cause}/{issue.action}：{issue.detail}")
        for item in case.evidence[:2]:
            row = item.row_no if item.row_no is not None else "-"
            lines.append(
                f"      证据：{item.rule_code} 第 {item.page_no} 页 行 {row} ({item.x:.1f}, {item.y:.1f})"
            )

    lines.append("")
    if summary.by_cause:
        lines.append("归因汇总：" + "；".join(f"{cause} {count}" for cause, count in sorted(summary.by_cause.items())))
    else:
        lines.append("归因汇总：无")
    for note in summary.notes:
        lines.append(f"说明：{note}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AL-16 样本回归与准确率评测")
    parser.add_argument(
        "--samples",
        default="algorithm/inputs/samples/synthetic",
        help="样本目录（含 manifest.json），默认 algorithm/inputs/samples/synthetic",
    )
    parser.add_argument("--build", action="store_true", help="评测前先重建合成样本")
    parser.add_argument("--json", help="把机器可读报告写到指定路径")
    parser.add_argument("--strict", action="store_true", help="有失败样本时返回非零")
    args = parser.parse_args(argv)

    directory = Path(args.samples)
    try:
        if args.build:
            build_sample_set(directory)
        report = evaluate_samples(directory)
    except (FileNotFoundError, ValueError) as exc:
        print(f"评测失败：{exc}")
        print("先生成样本：python -m algorithm.algo.samples")
        return 2

    print(format_report(report))
    if args.json:
        Path(args.json).write_text(
            json.dumps(report.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"JSON 报告：{args.json}")
    if args.strict and report.summary.failed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
