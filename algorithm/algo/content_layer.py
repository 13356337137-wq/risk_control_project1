from __future__ import annotations

from decimal import Decimal

from ..ocr.models import PageSummary, ParseResult, Transaction
from ..ocr.parse import LOW_CONF
from .evidence import page_evidence, txn_evidence
from .models import Attribution, CheckResult, ContentLayerResult

MONEY_TOLERANCE = Decimal("0.01")
MAX_EVIDENCE = 20


def _signed_amount(txn: Transaction) -> Decimal | None:
    if txn.amount is None or txn.direction is None:
        return None
    return txn.amount if txn.direction == "in" else -txn.amount


def _attribute(txns: list[Transaction], detail: str) -> Attribution:
    """看失败相关的行：有正常置信度的就判数据断，全低置信才是识别问题。"""
    if txns and all(txn.confidence < LOW_CONF for txn in txns):
        lowest = min(txn.confidence for txn in txns)
        return Attribution(
            cause="recognition",
            action="manual",
            detail=f"{detail}；相关行最低置信度 {lowest:.2f}，先重跑解析，仍低转人工",
        )
    return Attribution(
        cause="data",
        action="stop",
        detail=f"{detail}；相关行置信度正常，判为数据断",
    )


def _check_balance_chain(transactions: list[Transaction]) -> CheckResult:
    code, name = "C1", "余额链"
    failures: list[tuple[Transaction, Decimal]] = []
    low_skips: list[Transaction] = []
    missing = 0
    checked = 0

    for previous, current in zip(transactions, transactions[1:]):
        signed = _signed_amount(current)
        if previous.balance is None or current.balance is None or signed is None:
            if previous.confidence < LOW_CONF or current.confidence < LOW_CONF:
                low_skips.append(current)
            else:
                missing += 1
            continue
        checked += 1
        diff = current.balance - (previous.balance + signed)
        if abs(diff) > MONEY_TOLERANCE:
            failures.append((current, diff))

    if failures:
        first_diff = failures[0][1]
        detail = f"{len(failures)} 处余额不连续（已核对 {checked} 处），首处差额 {first_diff:+.2f} 元"
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=[txn_evidence(txn, code) for txn, _ in failures[:MAX_EVIDENCE]],
            attribution=_attribute([txn for txn, _ in failures], detail),
        )
    if low_skips:
        detail = f"{len(low_skips)} 处因低置信行无法核对"
        return CheckResult(
            code=code,
            name=name,
            status="skipped",
            detail=detail,
            attribution=_attribute(low_skips, detail),
        )
    if checked == 0:
        return CheckResult(code=code, name=name, status="skipped", detail="无可用余额行，未核对")
    if missing:
        return CheckResult(
            code=code,
            name=name,
            status="partial",
            detail=f"已核对 {checked} 处；{missing} 处字段缺失未核对",
        )
    return CheckResult(code=code, name=name, status="pass", detail=f"{checked} 处余额连续")


def _check_page_totals(
    transactions: list[Transaction], summaries: list[PageSummary]
) -> CheckResult:
    code, name = "C2", "每页合计"
    printed = [s for s in summaries if s.printed_in is not None or s.printed_out is not None]
    if not printed:
        return CheckResult(code=code, name=name, status="skipped", detail="未取得每页合计")

    failures: list[tuple[PageSummary, str, list[Transaction]]] = []
    incomplete = 0
    checked = 0
    for summary in printed:
        page_txns = [t for t in transactions if t.page_no == summary.page_no]
        if any(t.amount is None or t.direction is None for t in page_txns):
            incomplete += 1
            continue
        actual_in = sum((t.amount for t in page_txns if t.direction == "in"), Decimal("0"))
        actual_out = sum((t.amount for t in page_txns if t.direction == "out"), Decimal("0"))
        checked += 1
        diffs = []
        if summary.printed_in is not None and abs(actual_in - summary.printed_in) > MONEY_TOLERANCE:
            diffs.append(f"收入 印 {summary.printed_in} 实 {actual_in} 差 {actual_in - summary.printed_in:+.2f}")
        if summary.printed_out is not None and abs(actual_out - summary.printed_out) > MONEY_TOLERANCE:
            diffs.append(f"支出 印 {summary.printed_out} 实 {actual_out} 差 {actual_out - summary.printed_out:+.2f}")
        if diffs:
            failures.append((summary, "；".join(diffs), page_txns))

    if failures:
        summary, first_diffs, _ = failures[0]
        detail = f"第 {summary.page_no} 页合计不符：{first_diffs}"
        involved = [txn for _, _, page_txns in failures for txn in page_txns]
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=[page_evidence(s.page_no, s.footer_bbox, code) for s, _, _ in failures[:MAX_EVIDENCE]],
            attribution=_attribute(involved, detail),
        )
    if checked == 0:
        return CheckResult(code=code, name=name, status="skipped", detail=f"{incomplete} 页字段缺失，未核对")
    if incomplete:
        return CheckResult(
            code=code,
            name=name,
            status="partial",
            detail=f"已核对 {checked} 页；{incomplete} 页字段缺失未核对",
        )
    return CheckResult(code=code, name=name, status="pass", detail=f"{checked} 页合计一致")


def _check_counts(
    transactions: list[Transaction],
    summaries: list[PageSummary],
    footer_count: int | None,
) -> CheckResult:
    code, name = "C3", "笔数"
    printed = [s for s in summaries if s.printed_count is not None]
    if footer_count is None and not printed:
        return CheckResult(code=code, name=name, status="skipped", detail="无页脚笔数")

    for summary in printed:
        page_txns = [t for t in transactions if t.page_no == summary.page_no]
        if len(page_txns) != summary.printed_count:
            detail = f"第 {summary.page_no} 页印 {summary.printed_count} 笔、解析 {len(page_txns)} 笔"
            return CheckResult(
                code=code,
                name=name,
                status="fail",
                detail=detail,
                evidence=[page_evidence(summary.page_no, summary.footer_bbox, code)],
                attribution=_attribute(page_txns, detail),
            )

    if footer_count is not None and footer_count != len(transactions):
        detail = f"页脚共 {footer_count} 笔、解析 {len(transactions)} 笔"
        evidence = [page_evidence(printed[-1].page_no, printed[-1].footer_bbox, code)] if printed else []
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=evidence,
            attribution=_attribute(transactions, detail),
        )

    if not printed:
        return CheckResult(
            code=code,
            name=name,
            status="pass",
            detail=f"解析 {len(transactions)} 笔，与页脚总数 {footer_count} 一致",
        )
    return CheckResult(code=code, name=name, status="pass", detail=f"{len(printed)} 页笔数一致")


def _check_opening_closing(
    transactions: list[Transaction],
    opening_balance: Decimal | None,
    closing_balance: Decimal | None,
) -> CheckResult:
    code, name = "C4", "期初期末"
    if opening_balance is None or closing_balance is None:
        return CheckResult(
            code=code,
            name=name,
            status="skipped",
            detail="文件未标注期初/期末余额，未核对",
        )
    if any(_signed_amount(t) is None for t in transactions):
        return CheckResult(
            code=code,
            name=name,
            status="skipped",
            detail="存在方向/金额缺失，无法复算",
        )

    total_in = sum((t.amount for t in transactions if t.direction == "in"), Decimal("0"))
    total_out = sum((t.amount for t in transactions if t.direction == "out"), Decimal("0"))
    expected = opening_balance + total_in - total_out
    diff = closing_balance - expected
    if abs(diff) > MONEY_TOLERANCE:
        detail = (
            f"期初 {opening_balance} + 收入 {total_in} - 支出 {total_out} = {expected}，"
            f"与期末 {closing_balance} 差 {diff:+.2f}"
        )
        evidence = [txn_evidence(transactions[-1], code)] if transactions else []
        return CheckResult(
            code=code,
            name=name,
            status="fail",
            detail=detail,
            evidence=evidence,
            attribution=_attribute(transactions, detail),
        )
    return CheckResult(code=code, name=name, status="pass", detail="期初、收支与期末闭合")


def analyze_content(
    result: ParseResult,
    *,
    opening_balance: Decimal | None = None,
    closing_balance: Decimal | None = None,
) -> ContentLayerResult:
    """C1–C4；不含账务层与载体层。"""
    checks = [
        _check_balance_chain(result.transactions),
        _check_page_totals(result.transactions, result.page_summaries),
        _check_counts(result.transactions, result.page_summaries, result.footer_count),
        _check_opening_closing(result.transactions, opening_balance, closing_balance),
    ]
    limitations = [
        f"{check.code} {check.name}：{check.detail}"
        for check in checks
        if check.status in ("skipped", "partial")
    ]

    if not result.transactions:
        return ContentLayerResult(
            status="undetermined",
            checks=checks,
            limitations=limitations + ["未解析到交易明细，无法核对"],
        )
    if any(check.status == "fail" and check.attribution and check.attribution.cause == "data" for check in checks):
        status = "inconsistent"
    elif any(check.status == "fail" for check in checks):
        status = "undetermined"
    elif any(check.status in ("skipped", "partial") for check in checks):
        status = "limited"
    else:
        status = "pass"
    return ContentLayerResult(status=status, checks=checks, limitations=limitations)
