from __future__ import annotations

import argparse
import json
import math
import platform
import tempfile
import time
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

from pydantic import BaseModel, Field

from ..ocr.parse import parse
from .content_layer import analyze_content
from .exclusions import analyze_exclusions
from .external_layer import ExternalContext, analyze_external
from .file_layer import analyze_file
from .hits import detect_hits
from .ledger_layer import analyze_ledger
from .metrics import compute_metrics
from .report import build_report
from .samples import _ICBC_HEADER, _ICBC_XS, _bank_footer, _write_pdf
from .verdict import conclude

PERF_VERSION = 1
STRESS_ROWS = 3000
ROWS_PER_PAGE = 40
SLA_SECONDS = 5.0
DEFAULT_RUNS = 20
DEFAULT_WARMUP = 2


@dataclass(frozen=True)
class StressStatement:
    path: Path
    rows: int
    pages: int
    build_seconds: float
    size_bytes: int


class PerfStats(BaseModel):
    runs: int
    warmup: int
    min_ms: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    mean_ms: float
    sla_ms: float
    passed: bool


class StageStats(BaseModel):
    parse: float = 0.0
    content: float = 0.0
    file: float = 0.0
    ledger: float = 0.0
    external: float = 0.0
    verdict: float = 0.0
    hits: float = 0.0
    exclusions: float = 0.0
    metrics: float = 0.0
    report: float = 0.0


class PerfReport(BaseModel):
    perf_version: int = PERF_VERSION
    rows: int
    pages: int
    file_bytes: int
    txn_count: int
    verdict: str
    fail_codes: list[str] = Field(default_factory=list)
    stats: PerfStats
    stages: StageStats
    machine: str
    python: str
    notes: list[str] = Field(default_factory=list)


def _stress_rows(rows: int) -> list[tuple[str, ...]]:
    """造 3000 笔连续流水：每 10 笔一笔工资，其余为支出，余额链逐笔递推。"""
    start = date(2026, 1, 1)
    balance = Decimal("100000.00")
    result: list[tuple[str, ...]] = []
    for index in range(rows):
        day = (start + timedelta(days=index // 10)).isoformat()
        if index % 10 == 0:
            summary, party, direction = "工资", "某科技有限公司", "贷"
            amount = Decimal("12500.00")
            balance += amount
        else:
            summary = ("消费", "转账", "还款", "消费")[index % 4]
            party = ("某超市", "张三", "某银行", "某餐厅")[index % 4]
            direction = "借"
            amount = Decimal((index % 97) + 1) + Decimal("0.50")
            balance -= amount
        result.append(
            (day, summary, party, direction, f"{amount:,.2f}", f"{balance:,.2f}")
        )
    return result


def build_stress_statement(
    path: str | Path,
    *,
    rows: int = STRESS_ROWS,
    rows_per_page: int = ROWS_PER_PAGE,
) -> StressStatement:
    if rows < 1 or rows_per_page < 1:
        raise ValueError("rows 与 rows_per_page 必须为正数")
    target = Path(path)
    all_rows = _stress_rows(rows)
    pages = [
        all_rows[start : start + rows_per_page]
        for start in range(0, len(all_rows), rows_per_page)
    ]
    began = time.perf_counter()
    _write_pdf(
        target,
        title="银行账户交易明细",
        header=_ICBC_HEADER,
        xs=_ICBC_XS,
        pages=pages,
        footers=[_bank_footer(page, "icbc") for page in pages],
    )
    elapsed = time.perf_counter() - began
    return StressStatement(
        path=target,
        rows=rows,
        pages=len(pages),
        build_seconds=round(elapsed, 3),
        size_bytes=target.stat().st_size,
    )


def percentiles(values: list[float], quantiles: tuple[float, ...]) -> dict[float, float]:
    """线性插值分位数，与 numpy 默认口径一致。"""
    if not values:
        raise ValueError("没有样本，无法计算分位数")
    if any(q < 0 or q > 1 for q in quantiles):
        raise ValueError("分位数必须在 0 到 1 之间")
    ordered = sorted(values)
    if len(ordered) == 1:
        return {q: ordered[0] for q in quantiles}
    result: dict[float, float] = {}
    for q in quantiles:
        position = (len(ordered) - 1) * q
        low = math.floor(position)
        high = math.ceil(position)
        if low == high:
            result[q] = ordered[low]
        else:
            weight = position - low
            result[q] = ordered[low] + (ordered[high] - ordered[low]) * weight
    return result


def _fail_codes(content_checks, layers) -> list[str]:
    codes: list[str] = []
    for check in content_checks:
        if check.status == "fail" and check.code not in codes:
            codes.append(check.code)
    for layer in layers:
        for check in layer.checks:
            if check.status == "fail" and check.code not in codes:
                codes.append(check.code)
    return codes


def _measure_once(raw: bytes) -> tuple[float, dict[str, float], int, str, list[str]]:
    marks: list[tuple[str, float]] = []
    clock = time.perf_counter
    began = clock()

    parsed = parse(raw)
    marks.append(("parse", clock()))
    content = analyze_content(parsed)
    marks.append(("content", clock()))
    file_layer = analyze_file(raw, carrier="electronic")
    marks.append(("file", clock()))
    ledger = analyze_ledger(parsed.transactions)
    marks.append(("ledger", clock()))
    external = analyze_external(ExternalContext(transactions=parsed.transactions))
    marks.append(("external", clock()))
    verdict = conclude(
        content,
        carrier="electronic",
        file_layer=file_layer,
        ledger=ledger,
        external=external,
    )
    marks.append(("verdict", clock()))
    hits = detect_hits(parsed.transactions)
    marks.append(("hits", clock()))
    exclusions = analyze_exclusions(parsed.transactions)
    marks.append(("exclusions", clock()))
    metrics = compute_metrics(parsed.transactions, exclusions=exclusions, hits=hits)
    marks.append(("metrics", clock()))
    build_report(
        verdict,
        metrics,
        carrier="electronic",
        hits=hits,
        transactions=parsed.transactions,
        txn_ids=[None] * len(parsed.transactions),
        version=1,
    )
    finished = clock()
    marks.append(("report", finished))

    stages: dict[str, float] = {}
    previous = began
    for name, moment in marks:
        stages[name] = (moment - previous) * 1000
        previous = moment
    return (finished - began) * 1000, stages, len(parsed.transactions), verdict.verdict, _fail_codes(
        content.checks, (file_layer, ledger, external)
    )


def run_benchmark(
    statement: StressStatement,
    *,
    runs: int = DEFAULT_RUNS,
    warmup: int = DEFAULT_WARMUP,
) -> PerfReport:
    if runs < 1:
        raise ValueError("runs 必须大于 0")
    if warmup < 0:
        raise ValueError("warmup 不能为负")
    raw = statement.path.read_bytes()

    for _ in range(warmup):
        _measure_once(raw)

    timings: list[float] = []
    stage_totals = {name: 0.0 for name in StageStats.model_fields}
    txn_count = 0
    verdict = ""
    fail_codes: list[str] = []
    for _ in range(runs):
        elapsed, stages, txn_count, verdict, fail_codes = _measure_once(raw)
        timings.append(elapsed)
        for name, value in stages.items():
            stage_totals[name] += value

    points = percentiles(timings, (0.5, 0.95, 0.99))
    p99 = round(points[0.99], 1)
    stats = PerfStats(
        runs=runs,
        warmup=warmup,
        min_ms=round(min(timings), 1),
        p50_ms=round(points[0.5], 1),
        p95_ms=round(points[0.95], 1),
        p99_ms=p99,
        max_ms=round(max(timings), 1),
        mean_ms=round(sum(timings) / len(timings), 1),
        sla_ms=SLA_SECONDS * 1000,
        passed=p99 <= SLA_SECONDS * 1000,
    )
    stages = StageStats(
        **{name: round(total / runs, 1) for name, total in stage_totals.items()}
    )
    notes = [
        "计时段为「解析 → 内容 → 文件 → 账务 → 外部 → 五态 → 标签 → 剔除 → 指标 → 报告」，不含样本生成与文件读取。",
        f"P99 用线性插值，{runs} 次计时（另 {warmup} 次预热不计入）。",
        "样本为合成电子件，无 OCR；影像件耗时取决于页数与识别引擎，不在本压测范围。",
    ]
    if runs < 100:
        notes.append("计时次数少于 100，P99 接近最大值，仅作回归基线。")
    if txn_count != statement.rows:
        notes.append(f"解析笔数 {txn_count} 与造数 {statement.rows} 不一致，结果不可用于 SLA。")

    return PerfReport(
        rows=statement.rows,
        pages=statement.pages,
        file_bytes=statement.size_bytes,
        txn_count=txn_count,
        verdict=verdict,
        fail_codes=fail_codes,
        stats=stats,
        stages=stages,
        machine=f"{platform.system()} {platform.machine()} / {platform.processor() or 'unknown'}",
        python=platform.python_version(),
        notes=notes,
    )


def format_report(report: PerfReport) -> str:
    stats = report.stats
    flag = "PASS" if stats.passed else "FAIL"
    lines = [
        f"AL-17 性能压测报告（perf v{report.perf_version}）",
        (
            f"样本 {report.rows} 笔 / {report.pages} 页 / {report.file_bytes / 1024:.0f} KB；"
            f"解析 {report.txn_count} 笔；五态「{report.verdict}」"
            f"{'；失败码 ' + ','.join(report.fail_codes) if report.fail_codes else ''}"
        ),
        (
            f"计时 {stats.runs} 次（预热 {stats.warmup} 次）："
            f"P50 {stats.p50_ms:.1f} ms，P95 {stats.p95_ms:.1f} ms，"
            f"P99 {stats.p99_ms:.1f} ms，最大 {stats.max_ms:.1f} ms，均值 {stats.mean_ms:.1f} ms"
        ),
        f"验收：P99 {stats.p99_ms:.1f} ms ≤ {stats.sla_ms:.0f} ms → {flag}",
        "",
        "分段均值（ms）：",
    ]
    for name, value in report.stages.model_dump().items():
        lines.append(f"  {name:<11}{value:>9.1f}")
    lines.append("")
    lines.append(f"环境：{report.machine}；Python {report.python}")
    for note in report.notes:
        lines.append(f"说明：{note}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AL-17 三千笔流水性能压测")
    parser.add_argument("--rows", type=int, default=STRESS_ROWS, help="交易笔数，默认 3000")
    parser.add_argument("--runs", type=int, default=DEFAULT_RUNS, help="计时次数，默认 20")
    parser.add_argument("--warmup", type=int, default=DEFAULT_WARMUP, help="预热次数，默认 2")
    parser.add_argument("--json", help="把报告写到指定 JSON 路径")
    parser.add_argument("--keep", help="保留生成的流水 PDF 到指定路径")
    args = parser.parse_args(argv)

    try:
        if args.keep:
            statement = build_stress_statement(args.keep, rows=args.rows)
            report = run_benchmark(statement, runs=args.runs, warmup=args.warmup)
        else:
            with tempfile.TemporaryDirectory(prefix="algo-perf-") as tmp:
                statement = build_stress_statement(Path(tmp) / "stress.pdf", rows=args.rows)
                report = run_benchmark(statement, runs=args.runs, warmup=args.warmup)
    except (OSError, ValueError) as exc:
        print(f"压测失败：{exc}")
        return 2

    print(format_report(report))
    if args.json:
        Path(args.json).write_text(
            json.dumps(report.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"JSON 报告：{args.json}")
    if report.txn_count != report.rows:
        return 2
    return 0 if report.stats.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
