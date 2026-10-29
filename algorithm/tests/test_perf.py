import pytest

from algorithm.algo.perf import (
    build_stress_statement,
    format_report,
    percentiles,
    run_benchmark,
)
from algorithm.ocr.parse import parse


def test_percentiles_use_linear_interpolation():
    points = percentiles([1.0, 2.0, 3.0, 4.0], (0.0, 0.5, 0.99, 1.0))

    assert points[0.0] == 1.0
    assert points[0.5] == 2.5
    assert points[0.99] == pytest.approx(3.97)
    assert points[1.0] == 4.0


def test_percentiles_reject_empty_input():
    with pytest.raises(ValueError, match="没有样本"):
        percentiles([], (0.5,))


def test_stress_statement_parses_all_rows(tmp_path):
    statement = build_stress_statement(tmp_path / "stress.pdf", rows=60, rows_per_page=25)

    assert statement.rows == 60
    assert statement.pages == 3
    parsed = parse(statement.path.read_bytes())
    assert len(parsed.transactions) == 60
    assert parsed.footer_count == 60
    assert parsed.transactions[0].direction == "in"
    assert parsed.transactions[1].direction == "out"
    assert parsed.transactions[1].row_no == 2


def test_benchmark_reports_p99_and_sla(tmp_path):
    statement = build_stress_statement(tmp_path / "small.pdf", rows=40)
    report = run_benchmark(statement, runs=2, warmup=0)

    assert report.txn_count == 40
    assert report.stats.runs == 2
    assert report.stats.p99_ms >= report.stats.p50_ms
    assert report.stats.passed is True
    assert report.fail_codes == []

    text = format_report(report)
    assert "P99" in text
    assert "PASS" in text


def test_benchmark_rejects_non_positive_runs(tmp_path):
    statement = build_stress_statement(tmp_path / "small.pdf", rows=20)

    with pytest.raises(ValueError, match="runs"):
        run_benchmark(statement, runs=0)


def test_statement_rejects_non_positive_rows(tmp_path):
    with pytest.raises(ValueError, match="rows"):
        build_stress_statement(tmp_path / "bad.pdf", rows=0)
