# %% 0. 准备
import sys
from pathlib import Path

ROOT = Path.cwd()
if not (ROOT / "algorithm").is_dir() and "__file__" in globals():
    ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PDF_PATH = ROOT / "algorithm/inputs/samples/icbc_desensitized.pdf"
RAW = PDF_PATH.read_bytes()
print(f"项目根目录：{ROOT}")
print(f"待分析文件：{PDF_PATH}")
print(f"文件大小：{len(RAW):,} 字节")

# %% 1. 解析：PDF -> 明细
from algorithm.ocr.parse import parse

parsed = parse(RAW)
print(f"页数 {parsed.page_count}，明细 {len(parsed.transactions)} 笔，页脚笔数 {parsed.footer_count}")
print(
    f"字段完整率 {parsed.field_completeness:.2%}，"
    f"平均置信度 {parsed.avg_confidence:.2f}，低置信占比 {parsed.low_conf_ratio:.2%}"
)
print("警告：", parsed.warnings or "无")
for txn in parsed.transactions[:5]:
    print(
        f"  第 {txn.page_no} 页 行 {txn.row_no} | {txn.txn_date} | {txn.summary} | "
        f"{txn.counterparty_name} | {txn.direction} | {txn.amount} | 余额 {txn.balance}"
    )

# %% 2. 内容层：C1 余额链 / C2 每页合计 / C3 笔数 / C4 期初期末
from algorithm.algo.content_layer import analyze_content

content = analyze_content(parsed)
for check in content.checks:
    print(f"{check.code} {check.name}：{check.status} | {check.detail}")
print("内容层状态：", content.status)
print("限制：", content.limitations or "无")

# %% 3. 文件层：F1-F11 结构取证
from algorithm.algo.file_layer import analyze_file

file_layer = analyze_file(RAW, carrier="electronic")
for check in file_layer.checks:
    print(f"{check.code} {check.name}：{check.status} | {check.detail}")
print("文件层状态：", file_layer.status, "| 结论：", file_layer.outcome or "-")
print("限制：", file_layer.limitations or "无")

# %% 4. 账务层：A1-A7 结息、费用、期末余额
from algorithm.algo.ledger_layer import analyze_ledger

ledger = analyze_ledger(parsed.transactions)
for check in ledger.checks:
    print(f"{check.code} {check.name}：{check.status} | {check.detail}")
print("账务层状态：", ledger.status, "| 结论：", ledger.outcome or "-")
print("限制：", ledger.limitations or "无")

# %% 5. 外部层：E1-E7 占位与降级
from algorithm.algo.external_layer import ExternalContext, analyze_external

external = analyze_external(ExternalContext(transactions=parsed.transactions))
for check in external.checks:
    print(f"{check.code} {check.name}：{check.status} | {check.detail}")
print("外部层状态：", external.status)
print("限制：", external.limitations or "无")

# %% 6. 五态结论：file -> content -> ledger -> external
from algorithm.algo.verdict import conclude

verdict = conclude(
    content,
    carrier="electronic",
    file_layer=file_layer,
    ledger=ledger,
    external=external,
)
print("五态结论：", verdict.verdict)
print("原因：", verdict.verdict_reason)
for layer in verdict.layers:
    print(f"  {layer.layer}：{layer.status} | {layer.detail}")
for item in verdict.evidence[:5]:
    print(f"  证据：{item.rule_code} 第 {item.page_no} 页 行 {item.row_no or '-'} ({item.x:.1f}, {item.y:.1f})")

# %% 7. 剔除、规则命中、40 项指标
from algorithm.algo.exclusions import analyze_exclusions
from algorithm.algo.hits import detect_hits
from algorithm.algo.metrics import compute_metrics

exclusions = analyze_exclusions(parsed.transactions)
print(f"剔除 {len(exclusions.excluded)} 笔；入账 {exclusions.inflow_before} -> {exclusions.inflow_after}")
for category in exclusions.categories:
    print(f"  {category.code} {category.name}：{category.count} 笔")

hits = detect_hits(parsed.transactions)
print(f"规则命中 {len(hits.hits)} 条；标签计数 {hits.tag_txn_counts}")

metrics = compute_metrics(parsed.transactions, exclusions=exclusions, hits=hits)
missing = [metric.code for metric in metrics.metrics if metric.value is None]
print(f"指标 {len(metrics.metrics)} 项；空值 {missing or '无'}")

# %% 8. 报告聚合：contract 12 字段
from algorithm.algo.report import build_report

report = build_report(
    verdict,
    metrics,
    carrier="electronic",
    hits=hits,
    transactions=parsed.transactions,
    txn_ids=[None] * len(parsed.transactions),
    version=1,
)
print(report.model_dump_json(indent=2))
