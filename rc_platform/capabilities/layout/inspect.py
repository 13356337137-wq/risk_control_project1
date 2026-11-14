"""标注用的「扩散报告」：把版面分析的中间结果原样交给人看。

为什么需要它：模板不再记死坐标，只声明「我需要卡号、交易日期、金额」这些列。
系统在新文件上要自己找到它们——先靠关键词定位文字，再靠版面把同一列往下扩。
那这个过程必须可见、可纠正，否则标注员只能盲签。

三个动作：
  inspect(data)            整页扩散：所有被识别出来的列带 + 每条列带下面的单元格
  spread(data, keyword)    单关键词扩散：只按给定的词（如「卡号」）去找位置、往下扩
  cells(...)               给定 x 范围与起始行，取出该列的所有单元格

坐标一律用页面点（pt），前端画布直接用；保存模板时再归一化到 0-1。
"""
from __future__ import annotations

from . import detect
from .words import Line, PageWords, Word, group_lines, merge_tokens, read_pages

MIN_HITS = 2
MAX_MISSES = 12
# 页脚/小计行不能当成数据：它们也在同一列上，但意思是「这一页结束了」
FOOTER_WORDS = ("本页", "合计", "小计", "共计", "以上", "打印", "第", "页码", "制表")


def _tokens(pages: list[PageWords]) -> list[list[list[Word]]]:
    return [[merge_tokens(line) for line in group_lines(page.words)] for page in pages]


def _value_like(text: str) -> bool:
    """判断一段文字像不像「值」而不是「另一个表头」。"""
    body = (text or "").strip()
    if not body:
        return False
    digits = sum(1 for ch in body if ch.isdigit())
    if digits == 0:
        return False
    return digits >= 2 or len(body) <= 6


def _cell(word: Word) -> dict:
    return {
        "text": word.text,
        "x0": round(word.x0, 2),
        "x1": round(word.x1, 2),
        "y0": round(word.top, 2),
        "y1": round(word.bottom, 2),
    }


def _collect_cells(tokens_per_line: list[list[Word]], start: int, center: float, half: float,
                   page_width: float) -> list[dict]:
    """从 start 行开始，往下收集中心落在 [center-half, center+half] 的词，按行成组。"""
    cells: list[dict] = []
    misses = 0
    previous_bottom = None
    gaps: list[float] = []
    for tokens in tokens_per_line[start:]:
        best = None
        distance = None
        for token in tokens:
            delta = abs(token.cx - center)
            if delta <= half and (distance is None or delta < distance):
                best, distance = token, delta
        if best is None:
            misses += 1
            if misses > MAX_MISSES and cells:
                break
            continue

        # 页脚行：同列但不是数据，遇到就收手（否则「本页交易笔数：3」会变成最后一笔金额）
        if any(word in best.text for word in FOOTER_WORDS):
            break

        # 行距突变：流水表行距稳定，突然空出一大段说明换区了（表格结束了/换页眉了）
        if previous_bottom is not None:
            gap = best.top - previous_bottom
            gaps.append(gap)
            if len(gaps) >= 3:
                median = sorted(gaps)[len(gaps) // 2]
                if median > 0 and gap > median * 3.5:
                    break
        previous_bottom = best.bottom
        cells.append(_cell(best))
        misses = 0
    return cells


def _page_report(index: int, page: PageWords, region) -> dict:
    tokens_per_line = [merge_tokens(line) for line in group_lines(page.words)]
    header_y = None
    bands: list[dict] = []

    if region is not None:
        header_y = region.header_y
        if header_y is not None and header_y <= 1.0:
            header_y = header_y * page.height      # 契约定的是归一化，画布要用点
        header_index = -1
        if header_y is not None:
            # 取「包含表头 y 的那一行」，不是「表头之上的第一行」——
            # 页面顶部还有行名/账号等行，取错会把表头自己当成第一个数据格。
            for i, tokens in enumerate(tokens_per_line):
                if not tokens:
                    continue
                if tokens[0].top - 1 <= header_y <= tokens[0].bottom + 1:
                    header_index = i
                    break
        if header_index < 0:
            header_index = 0
        for column in region.columns:
            x0 = column.x * page.width
            x1 = (column.x + column.w) * page.width
            cells = _collect_cells(tokens_per_line, header_index + 1, (x0 + x1) / 2,
                                   max((x1 - x0) / 2, page.width * 0.01) + page.width * 0.012,
                                   page.width)
            # 列带按「实际捡到的单元格」扩到包络：表头词往往比数据窄（「摘要」两个字 vs
            # 「工资代发-某公司」），只画表头宽度会让人以为没对准。
            if cells:
                x0 = min([x0] + [item["x0"] for item in cells])
                x1 = max([x1] + [item["x1"] for item in cells])
            bands.append({
                "field": column.field,
                "source": region.source,
                "confidence": round(column.confidence, 3),
                "x0": round(x0, 2),
                "x1": round(x1, 2),
                "cells": cells,
            })

    return {
        "index": index,
        "width": round(page.width, 2),
        "height": round(page.height, 2),
        "lines": len(tokens_per_line),
        "header_y": None if header_y is None else round(header_y, 2),
        "bands": bands,
        "has_text": bool(page.words),
    }


def inspect(data: bytes, password: str | None = None) -> dict:
    pages = read_pages(data, password)
    tokens = _tokens(pages)
    reports = []
    for index, page in enumerate(pages):
        region = None
        try:
            region = detect.detect_page(page)
        except Exception:  # noqa: BLE001 - 单页识别失败不该让整份样本看不出东西
            region = None
        report = _page_report(index, page, region)
        # 单值字段（卡号/户名/开户行…）：它们不是列，混在列带里会让人没法用
        column_fields = {band["field"] for band in report["bands"]}
        report["singles"] = _singles(index, page, tokens[index], column_fields)
        reports.append(report)
    return {
        "pages": reports,
        "page_count": len(reports),
        "text_layer": any(item["has_text"] for item in reports),
    }


def spread(data: bytes, keyword: str, page_index: int | None = None, password: str | None = None) -> dict:
    """按关键词扩散出一列。

    典型用法是「卡号」：它可能出现在表头单元格里（卡号 | 6222…），
    也可能出现在说明行里（卡号：6222…）。两种都要能起步：
      - 同行右侧有值 -> 先收下这个值，再以它的中心往下扩
      - 同行右侧没值 -> 以关键词自己的中心往下扩
    """
    pages = read_pages(data, password)
    tokens = _tokens(pages)
    hits: list[dict] = []

    for index, page in enumerate(pages):
        if page_index is not None and index != page_index:
            continue
        found = False
        for line_no, tokens_line in enumerate(tokens[index]):
            if found:
                break
            for token in tokens_line:
                if keyword and keyword in token.text:
                    inline = None
                    for other in tokens_line:
                        if other is token or other.cx <= token.cx:
                            continue
                        if other.x0 - token.x1 > page.width * 0.35:
                            continue
                        # 只有「像值」的才当成同行取值：紧邻的往往是下一列表头
                        if not _value_like(other.text):
                            continue
                        inline = other
                        break
                    anchor = inline or token
                    cells = _collect_cells(tokens[index], line_no + (0 if inline else 1),
                                           anchor.cx, page.width * 0.06, page.width)
                    if inline is not None:
                        cells = [_cell(inline)] + cells
                    left = min([anchor.x0] + [item["x0"] for item in cells])
                    right = max([anchor.x1] + [item["x1"] for item in cells])
                    hits.append({
                        "page": index,
                        "keyword": _cell(token),
                        "anchor": _cell(anchor),
                        "x0": round(left, 2),
                        "x1": round(right, 2),
                        "cells": cells,
                        "source": "inline" if inline else "column",
                    })
                    found = True   # 一页一段起步即可，避免同一列被重复扩
                    break

    return {"keyword": keyword, "page_count": len(pages), "bands": hits}

# ---------------------------------------------------------------- 单值字段
# 不是所有要提取的东西都是「列」。卡号、户名、开户行这类属性整份文件只有一个，
# 按列扩散会得到一条只有一格的列带，语义是错的——它们是「页内的一个框」。
SINGLE_LABELS: list[tuple[str, str]] = [
    ("卡号", "account_no"),
    ("账号", "account_no"),
    ("账户号", "account_no"),
    ("户名", "account_name"),
    ("账户名称", "account_name"),
    ("客户名称", "account_name"),
    ("开户行", "bank_branch"),
    ("开户机构", "bank_branch"),
    ("账户类型", "account_type"),
]
SINGLE_FIELD_LABEL = {
    "account_no": "卡号或账号",
    "account_name": "户名",
    "bank_branch": "开户行",
    "account_type": "账户类型",
}


def _singles(page_index: int, page: PageWords, tokens_per_line: list[list[Word]],
             column_fields: set[str]) -> list[dict]:
    """在一个页面上找「单值字段」：标签 + 紧邻的值，且该标签不构成一列。

    判据三条，缺一不可：
      ① 命中预设标签（卡号/户名/开户行…）；
      ② 同一标签在整页只出现一次（出现多次说明它其实是一列的表头）；
      ③ 能取到值（同行右侧优先，其次正下方）。
    """
    found: list[dict] = []
    seen_fields: set[str] = set()

    for line_no, tokens in enumerate(tokens_per_line):
        for token in tokens:
            # 标签必须出现在词首：表头上的「对方户名」里有「户名」，按包含匹配会误判成单值
            body = token.text.strip()
            label = next((text for text, _ in SINGLE_LABELS if body.startswith(text)), None)
            if label is None:
                continue
            field = dict(SINGLE_LABELS)[label]
            if field in seen_fields or field in column_fields:
                continue

            # ② 以标签开头的词在全页只出现一次（出现多次说明它是一列的表头）
            occurrences = sum(
                1 for other_line in tokens_per_line for other in other_line
                if other.text.strip().startswith(label)
            )
            if occurrences > 1:
                continue

            # ③ 取值：标签词自带的值 + 同一行右侧紧跟的词；都没有就取正下方
            value_words: list[Word] = []
            rest = body.split(label, 1)[1].strip(" ：:　")
            if rest:
                value_words = [Word(text=rest, x0=token.x0, x1=token.x1, top=token.top, bottom=token.bottom)]
            cursor = value_words[-1].x1 if value_words else token.x1
            for other in tokens:
                if other is token or other.x0 <= cursor:
                    continue
                if other.x0 - cursor > page.width * 0.06:      # 同行但隔得远 = 另一个字段
                    break
                value_words.append(other)
                cursor = other.x1
            if not value_words and line_no + 1 < len(tokens_per_line):
                below = [
                    other for other in tokens_per_line[line_no + 1]
                    if abs(other.x0 - token.x0) < page.width * 0.12
                ]
                value_words = below[:2]

            if not value_words:
                continue

            value = "".join(word.text for word in value_words).strip()
            if not value:
                continue

            left = min([token.x0] + [word.x0 for word in value_words])
            right = max([token.x1] + [word.x1 for word in value_words])
            top = min([token.top] + [word.top for word in value_words])
            bottom = max([token.bottom] + [word.bottom for word in value_words])
            seen_fields.add(field)
            found.append({
                "field": field,
                "label": SINGLE_FIELD_LABEL.get(field, field),
                "page": page_index,
                "value": value,
                # 归一化：与模板 meta_boxes 的口径一致（左上原点，0-1）
                "x": round(max(0.0, left - 2) / page.width, 4),
                "y": round(max(0.0, top - 2) / page.height, 4),
                "w": round(min(page.width, right + 2) / page.width - max(0.0, left - 2) / page.width, 4),
                "h": round(min(page.height, bottom + 2) / page.height - max(0.0, top - 2) / page.height, 4),
                # 点坐标：画布直接用
                "x0": round(left, 2),
                "x1": round(right, 2),
                "y0": round(top, 2),
                "y1": round(bottom, 2),
            })
    return found
