"""模板智能字段分析引擎：短字段（就近匹配）+ 标题字段（版式分析）。

面向银行后台人员：只需上传样例流水 PDF 并输入两类目标字段：
1. 短字段（short_fields）：如卡号、户名、开户行、起止日期、币种等页眉/单值信息；
   采用「锚点词定位 + 同行右侧/正下方就近匹配」提取键值与归一化坐标框（meta_boxes）。
2. 标题字段（header_fields）：如交易日期、摘要、发生额、余额、对方户名等明细列；
   采用「表头行评分定位 + 相邻列间隙切分 + 数据行投影校正」自动产出表格区、表头线、
   列带坐标（layout.tables）与结构化试解析预览行。

优先使用 PyMuPDF（生产高性能），环境缺少 PyMuPDF 时自动回退 pdfplumber（零外网依赖）。
"""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class _Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2.0

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2.0


@dataclass
class _Line:
    words: list[_Word]
    top: float
    bottom: float

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2.0

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)


_TRADITIONAL_BANK_HINTS: list[tuple[str, str]] = [
    ("中国工商银行", "ICBC"),
    ("工商银行", "ICBC"),
    ("中国建设银行", "CCB"),
    ("建设银行", "CCB"),
    ("招商银行", "CMB"),
    ("中国农业银行", "ABC"),
    ("农业银行", "ABC"),
    ("中国银行", "BOC"),
    ("交通银行", "BCM"),
    ("广发银行", "CGB"),
    ("邮储银行", "PSBC"),
    ("邮政储蓄", "PSBC"),
    ("浦发银行", "SPDB"),
    ("平安银行", "PAB"),
    ("光大银行", "CEB"),
    ("中信银行", "CITIC"),
    ("兴业银行", "CIB"),
    ("民生银行", "CMBC"),
]

_THIRD_PARTY_HINTS: list[tuple[str, str]] = [
    ("微信支付", "WECHAT"),
    ("支付宝", "ALIPAY"),
]

_FOOTER_RE = re.compile(r"(?:本页(?:支出|收入|交易|合计)|合计|总计|共\s*\d+\s*笔|第\s*\d+\s*页|打印时间|下单时间)")
_DATE_LIKE_RE = re.compile(r"(?:20\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}|(?<!\d)20\d{6}(?!\d))")
_MONEY_LIKE_RE = re.compile(r"[-+]?[¥￥]?\d[\d,]*\.\d{2}")


def _norm(text: str) -> str:
    trans = str.maketrans({"（": "(", "）": ")", "／": "/", "：": ":", "　": " "})
    return "".join(str(text or "").translate(trans).split()).lower()


def _split_keywords(raw: str | list[str] | None) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        items = raw
    else:
        items = re.split(r"[,，、/|;；\n]+", str(raw))
    out: list[str] = []
    for item in items:
        s = str(item or "").strip()
        if s and s not in out:
            out.append(s)
    return out


def _one_edit_apart(a: str, b: str) -> bool:
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = 0
    while i < la and a[i] == b[i]:
        i += 1
    if la == lb:
        return a[i + 1:] == b[i + 1:]
    return a[i:] == b[i + 1:]


def _group_lines(words: list[_Word], y_tol: float = 3.5) -> list[_Line]:
    lines: list[_Line] = []
    for w in sorted(words, key=lambda item: (item.cy, item.x0)):
        if lines and abs(w.cy - lines[-1].cy) <= y_tol:
            lines[-1].words.append(w)
            lines[-1].top = min(lines[-1].top, w.top)
            lines[-1].bottom = max(lines[-1].bottom, w.bottom)
        else:
            lines.append(_Line(words=[w], top=w.top, bottom=w.bottom))
    for ln in lines:
        ln.words.sort(key=lambda item: item.x0)
    return lines


def _merge_close_words(words: list[_Word], gap: float = 2.5) -> list[_Word]:
    merged: list[_Word] = []
    for w in words:
        if merged and (w.x0 - merged[-1].x1) <= gap:
            prev = merged[-1]
            merged[-1] = _Word(
                text=prev.text + w.text,
                x0=prev.x0,
                x1=max(prev.x1, w.x1),
                top=min(prev.top, w.top),
                bottom=max(prev.bottom, w.bottom),
            )
        else:
            merged.append(w)
    return merged


def _extract_pdf_words(
    raw: bytes,
    password: str | None = None,
    max_pages: int = 3,
) -> tuple[list[list[_Word]], list[tuple[float, float]], int, str]:
    """抽取前 max_pages 页词坐标与整页文本；优先 PyMuPDF，缺省自动回退 pdfplumber。"""
    if raw[:4] != b"%PDF":
        raise ValueError("模板智能字段分析目前仅支持 PDF 电子流水文件")

    # 1. 优先尝试 PyMuPDF
    try:
        import pymupdf  # noqa: PLC0415

        doc = pymupdf.open(stream=raw, filetype="pdf")
        try:
            if doc.needs_pass:
                if not password or doc.authenticate(password) <= 0:
                    raise PermissionError("PDF 受口令保护，请提供正确的打开口令")
            total_pages = doc.page_count
            pages_words: list[list[_Word]] = []
            page_sizes: list[tuple[float, float]] = []
            full_texts: list[str] = []
            for idx in range(min(total_pages, max_pages)):
                pg = doc[idx]
                mtx = pg.rotation_matrix
                ws: list[_Word] = []
                for x0, y0, x1, y1, tx, *_rest in pg.get_text("words"):
                    t = tx.strip()
                    if not t:
                        continue
                    r = pymupdf.Rect(x0, y0, x1, y1) * mtx
                    ws.append(_Word(text=t, x0=float(r.x0), x1=float(r.x1), top=float(r.y0), bottom=float(r.y1)))
                pages_words.append(ws)
                page_sizes.append((float(pg.rect.width), float(pg.rect.height)))
                full_texts.append(pg.get_text("text") or "")
            return pages_words, page_sizes, total_pages, "\n".join(full_texts)
        finally:
            doc.close()
    except ImportError:
        pass

    # 2. 回退 pdfplumber
    import pdfplumber  # noqa: PLC0415

    try:
        with pdfplumber.open(io.BytesIO(raw), password=password or "") as pdf:
            total_pages = len(pdf.pages)
            pages_words = []
            page_sizes = []
            full_texts = []
            for idx in range(min(total_pages, max_pages)):
                pg = pdf.pages[idx]
                raw_ws = pg.extract_words(x_tolerance=2.0, y_tolerance=2.5, keep_blank_chars=False) or []
                ws = [
                    _Word(
                        text=str(w["text"]).strip(),
                        x0=float(w["x0"]),
                        x1=float(w["x1"]),
                        top=float(w["top"]),
                        bottom=float(w["bottom"]),
                    )
                    for w in raw_ws
                    if str(w.get("text") or "").strip()
                ]
                pages_words.append(ws)
                page_sizes.append((float(pg.width), float(pg.height)))
                full_texts.append(pg.extract_text() or "")
            return pages_words, page_sizes, total_pages, "\n".join(full_texts)
    except Exception as exc:  # noqa: BLE001
        if "password" in str(exc).lower() or "encrypt" in str(exc).lower():
            raise PermissionError("PDF 受口令保护，请提供正确的打开口令") from exc
        raise


def _detect_bank(
    full_text: str,
    header_text: str = "",
    filename: str | None = None,
) -> tuple[str | None, str | None]:
    """优先从页眉与正文识别传统银行，其次参考文件名；微信/支付宝仅限页眉或文件名命中，避免被明细摘要误导。"""
    top_text = header_text or full_text[:260]
    fname = filename or ""
    for scope in (top_text, full_text, fname):
        if not scope:
            continue
        for alias, code in _TRADITIONAL_BANK_HINTS:
            if alias in scope:
                return code, alias
    for scope in (top_text, fname):
        if not scope:
            continue
        for alias, code in _THIRD_PARTY_HINTS:
            if alias in scope:
                return code, alias
    return None, None


def _match_keyword(token_text: str, keywords: list[str]) -> tuple[str, float] | None:
    """判断单个词/短语是否命中关键词列表，返回 (命中的关键词, 匹配得分)。"""
    nt = _norm(token_text)
    if not nt:
        return None
    best: tuple[str, float] | None = None
    for kw in keywords:
        nk = _norm(kw)
        if not nk:
            continue
        if nt == nk:
            return kw, 1.0
        # 去掉末尾冒号后的精确命中（如「户名：」）
        if nt.rstrip(":") == nk:
            return kw, 0.98
        if nk in nt and len(nk) >= 2:
            score = 0.85 if len(nt) <= len(nk) + 6 else 0.72
            if best is None or score > best[1]:
                best = (kw, score)
        elif nt in nk and len(nt) >= 2:
            score = 0.78
            if best is None or score > best[1]:
                best = (kw, score)
        elif len(nk) >= 3 and len(nt) <= len(nk) + 2 and _one_edit_apart(nt, nk):
            score = 0.70
            if best is None or score > best[1]:
                best = (kw, score)
    return best


def _extract_inline_value(text: str, kw: str) -> str | None:
    """处理「户名：张三」「卡号:6222...」这类标签与值粘在同一个词里的情况。"""
    # 尝试按冒号切分
    m = re.search(r"[:：]\s*(.+)$", text)
    if m and m.group(1).strip():
        return m.group(1).strip()
    # 尝试去掉前缀关键词
    idx = text.find(kw)
    if idx >= 0:
        rest = text[idx + len(kw):].lstrip(" :：")
        if rest:
            return rest
    return None


def analyze_header_fields(
    pages_words: list[list[_Word]],
    page_sizes: list[tuple[float, float]],
    header_fields: list[dict[str, Any]],
) -> dict[str, Any]:
    """标题字段版式分析：表头行评分定位 + 相邻列间隙切分 + 数据行投影校正 + 试解析预览。"""
    if not pages_words or not header_fields:
        return {
            "header_found": False,
            "header_results": [],
            "table_area": None,
            "preview_rows": [],
            "field_map": {},
            "table_layout": None,
            "header_y_pt": None,
        }

    words0 = pages_words[0]
    pw, ph = page_sizes[0]
    lines0 = _group_lines(words0, y_tol=3.5)

    # 1. 评分寻找最佳表头行（扫描前 30 行）
    best_line: _Line | None = None
    best_tokens: list[_Word] = []
    best_matches: dict[int, tuple[dict[str, Any], str, float]] = {}
    best_score = 0.0

    for ln in lines0[:30]:
        tokens = _merge_close_words(ln.words, gap=3.0)
        line_matches: dict[int, tuple[dict[str, Any], str, float]] = {}
        used_fields: set[str] = set()
        score_sum = 0.0
        for t_idx, tok in enumerate(tokens):
            best_f: tuple[dict[str, Any], str, float] | None = None
            for hf in header_fields:
                fkey = str(hf.get("field") or "").strip()
                if not fkey or fkey in used_fields:
                    continue
                kws = _split_keywords(hf.get("keywords") or hf.get("label") or fkey)
                hit = _match_keyword(tok.text, kws)
                if hit and (best_f is None or hit[1] > best_f[2]):
                    best_f = (hf, hit[0], hit[1])
            if best_f is not None:
                line_matches[t_idx] = best_f
                used_fields.add(str(best_f[0]["field"]))
                score_sum += best_f[2]
        if len(line_matches) >= 2 and score_sum > best_score:
            best_score = score_sum
            best_line = ln
            best_tokens = tokens
            best_matches = line_matches

    if best_line is None or not best_matches:
        return {
            "header_found": False,
            "header_results": [
                {
                    "field": str(hf.get("field") or ""),
                    "label": str(hf.get("label") or hf.get("field") or ""),
                    "keywords": _split_keywords(hf.get("keywords") or hf.get("label")),
                    "matched": False,
                    "header_text": None,
                    "x": None,
                    "w": None,
                    "sample_values": [],
                    "hit_rows": 0,
                    "confidence": 0.0,
                }
                for hf in header_fields
            ],
            "table_area": None,
            "preview_rows": [],
            "field_map": {},
            "table_layout": None,
            "header_y_pt": None,
        }

    # 2. 基于整行全部表头词（不仅限于命中的字段）的相邻间隙切分列边界，防止跨列串读
    tok_bounds: list[tuple[float, float]] = []
    n_tok = len(best_tokens)
    for i, tok in enumerate(best_tokens):
        tw = max(tok.x1 - tok.x0, 12.0)
        if i == 0:
            left = max(0.0, tok.x0 - 0.25 * tw)
        else:
            prev = best_tokens[i - 1]
            left = (prev.x1 + tok.x0) / 2.0
        if i == n_tok - 1:
            right = min(pw, tok.x1 + 0.6 * tw)
        else:
            nxt = best_tokens[i + 1]
            right = (tok.x1 + nxt.x0) / 2.0
        if right <= left:
            left, right = tok.x0, max(tok.x1, tok.x0 + 12.0)
        tok_bounds.append((left, right))

    # 3. 数据行投影：收集表头下方至页脚前的所有数据行，校验列边界并提取样例值
    header_top = best_line.top
    header_bottom = best_line.bottom
    data_lines: list[_Line] = []
    last_data_bottom = header_bottom + 20.0

    for ln in lines0:
        if ln.top <= header_bottom + 1.0:
            continue
        txt = ln.text.strip()
        if not txt:
            continue
        if _FOOTER_RE.search(txt) and not _DATE_LIKE_RE.search(txt):
            break
        data_lines.append(ln)
        last_data_bottom = max(last_data_bottom, ln.bottom)

    # 4. 为每个命中的标题字段收集样例值、按数据投影略微扩展首尾边界
    matched_cols: list[dict[str, Any]] = []
    field_map: dict[str, str] = {}
    col_specs: list[tuple[str, float, float, str, float]] = []

    for t_idx in sorted(best_matches.keys()):
        hf, _kw, conf = best_matches[t_idx]
        fkey = str(hf["field"]).strip()
        flabel = str(hf.get("label") or fkey)
        tok = best_tokens[t_idx]
        left, right = tok_bounds[t_idx]
        col_specs.append((fkey, left, right, tok.text, conf))
        field_map[fkey] = tok.text

    # 抽取前 15 行预览与每列样例
    samples_by_field: dict[str, list[str]] = {f: [] for f, *_ in col_specs}
    hits_by_field: dict[str, int] = {f: 0 for f, *_ in col_specs}
    preview_rows: list[dict[str, Any]] = []

    for ln in data_lines:
        row_cells: dict[str, str] = {}
        for fkey, left, right, _ht, _cf in col_specs:
            cell_ws = [w for w in ln.words if left <= w.cx < right]
            if cell_ws:
                val = " ".join(w.text for w in cell_ws).strip()
                if val:
                    row_cells[fkey] = val
                    hits_by_field[fkey] += 1
                    if len(samples_by_field[fkey]) < 4 and val not in samples_by_field[fkey]:
                        samples_by_field[fkey].append(val)
        if len(row_cells) >= 2 and len(preview_rows) < 15:
            preview_rows.append({"page_no": 1, "cells": row_cells})

    matched_by_field = {f: (left, right, ht, cf) for f, left, right, ht, cf in col_specs}
    header_results: list[dict[str, Any]] = []
    layout_columns: list[dict[str, Any]] = []

    for hf in header_fields:
        fkey = str(hf.get("field") or "").strip()
        flabel = str(hf.get("label") or fkey)
        kws = _split_keywords(hf.get("keywords") or flabel)
        if fkey in matched_by_field:
            left, right, ht, conf = matched_by_field[fkey]
            nx = round(max(0.0, left / pw), 4)
            nw = round(min(1.0 - nx, max(0.02, (right - left) / pw)), 4)
            header_results.append({
                "field": fkey,
                "label": flabel,
                "keywords": kws,
                "matched": True,
                "header_text": ht,
                "x": nx,
                "w": nw,
                "sample_values": samples_by_field.get(fkey, [])[:3],
                "hit_rows": hits_by_field.get(fkey, 0),
                "confidence": round(conf, 2),
            })
            layout_columns.append({
                "field": fkey,
                "fields": [fkey],
                "label": flabel,
                "header_text": ht,
                "x": nx,
                "w": nw,
            })
        else:
            header_results.append({
                "field": fkey,
                "label": flabel,
                "keywords": kws,
                "matched": False,
                "header_text": None,
                "x": None,
                "w": None,
                "sample_values": [],
                "hit_rows": 0,
                "confidence": 0.0,
            })

    layout_columns.sort(key=lambda c: c["x"])
    area_x = round(max(0.0, min(b[0] for b in tok_bounds) / pw - 0.005), 4)
    area_x1 = round(min(1.0, max(b[1] for b in tok_bounds) / pw + 0.005), 4)
    area_y = round(max(0.0, (header_top - 3.0) / ph), 4)
    area_y1 = round(min(0.98, (last_data_bottom + 6.0) / ph), 4)
    header_y_norm = round(min(area_y1, max(area_y, (header_bottom + 1.0) / ph)), 4)

    table_area = {
        "x": area_x,
        "y": area_y,
        "w": round(max(0.05, area_x1 - area_x), 4),
        "h": round(max(0.05, area_y1 - area_y), 4),
        "headerY": header_y_norm,
    }
    table_layout = {
        "page": 0,
        "slot": "first",
        "area": {k: table_area[k] for k in ("x", "y", "w", "h")},
        "headerY": header_y_norm,
        "columns": layout_columns,
    }
    return {
        "header_found": True,
        "header_results": header_results,
        "table_area": table_area,
        "preview_rows": preview_rows,
        "field_map": field_map,
        "table_layout": table_layout,
        "header_y_pt": header_top,
    }


def match_short_fields(
    pages_words: list[list[_Word]],
    page_sizes: list[tuple[float, float]],
    short_fields: list[dict[str, Any]],
    header_y_pt: float | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """短字段就近匹配：在首页页眉（表头上方，若无表头则整页）定位锚点词，就近提取右侧或下方值。"""
    if not pages_words or not short_fields:
        return [], []

    words0 = pages_words[0]
    pw, ph = page_sizes[0]
    # 优先在表头上方页眉区检索，避免误命中明细行；若无表头则扫描全页
    zone_words = [w for w in words0 if header_y_pt is None or w.bottom <= header_y_pt + 4.0]
    if not zone_words:
        zone_words = words0
    lines = _group_lines(zone_words, y_tol=4.5)

    # 收集所有短字段关键词用于“遇到下一个标签即停止合并值”
    all_stop_kws: list[str] = []
    for sf in short_fields:
        all_stop_kws.extend(_split_keywords(sf.get("keywords") or sf.get("label")))

    results: list[dict[str, Any]] = []
    meta_boxes: list[dict[str, Any]] = []

    for sf in short_fields:
        fkey = str(sf.get("field") or "").strip()
        flabel = str(sf.get("label") or fkey)
        kws = _split_keywords(sf.get("keywords") or flabel)
        best_candidate: tuple[float, dict[str, Any], dict[str, Any]] | None = None
        _title_noise = ("明细", "流水", "证明", "清单", "对账单")

        for ln_idx, ln in enumerate(lines):
            # 1) 逐词定位锚点，按置信度与键值特征择优，避免被首页大标题（如「个人活期账户全部交易明细」）截胡
            for w_idx, w in enumerate(ln.words):
                hit = _match_keyword(w.text, kws)
                if not hit:
                    continue
                kw_hit, conf = hit
                has_colon = (":" in w.text) or ("：" in w.text)
                if not has_colon and any(t in w.text for t in _title_noise) and len(w.text) >= len(kw_hit) + 4:
                    continue
                inline_val = _extract_inline_value(w.text, kw_hit)
                val_words: list[_Word] = [w]
                method = "inline"

                if inline_val:
                    # 仍向右检查是否有紧跟的续接词（如「起止日期：2026-04-14」后紧跟「— 2026-10-14」）
                    right_extra: list[str] = [inline_val]
                    prev_x1 = w.x1
                    for nw in ln.words[w_idx + 1:]:
                        if nw.x0 - prev_x1 > 28.0:
                            break
                        if _match_keyword(nw.text, [k for k in all_stop_kws if k not in kws]):
                            break
                        val_words.append(nw)
                        right_extra.append(nw.text)
                        prev_x1 = nw.x1
                    value = " ".join(right_extra).strip()
                else:
                    # 2) 同行右侧就近匹配：跳过独立冒号，合并右侧连续值词直到大间隙或下一个标签
                    method = "right_neighbor"
                    collected: list[_Word] = []
                    prev_x1 = w.x1
                    for nw in ln.words[w_idx + 1:]:
                        if nw.text in (":", "："):
                            prev_x1 = nw.x1
                            continue
                        gap_limit = 90.0 if not collected else 28.0
                        if nw.x0 - prev_x1 > gap_limit:
                            break
                        if _match_keyword(nw.text, [k for k in all_stop_kws if k not in kws]):
                            break
                        collected.append(nw)
                        prev_x1 = nw.x1
                    if collected:
                        val_words = [w, *collected]
                        value = " ".join(x.text for x in collected).strip()
                    else:
                        # 3) 正下方就近匹配（上下排版键值）
                        method = "below_neighbor"
                        below_ws: list[_Word] = []
                        if ln_idx + 1 < len(lines):
                            next_ln = lines[ln_idx + 1]
                            if 0 <= next_ln.top - ln.bottom <= 24.0:
                                below_ws = [
                                    bw for bw in next_ln.words
                                    if bw.x1 >= w.x0 - 15.0 and bw.x0 <= w.x1 + 60.0
                                ]
                        if below_ws:
                            val_words = below_ws
                            value = " ".join(x.text for x in below_ws).strip()
                        else:
                            value = w.text

                x0 = min(x.x0 for x in val_words)
                y0 = min(x.top for x in val_words)
                x1 = max(x.x1 for x in val_words)
                y1 = max(x.bottom for x in val_words)
                rect = {
                    "x": round(max(0.0, x0 / pw), 4),
                    "y": round(max(0.0, y0 / ph), 4),
                    "w": round(min(1.0 - max(0.0, x0 / pw), max(0.02, (x1 - x0) / pw)), 4),
                    "h": round(min(1.0 - max(0.0, y0 / ph), max(0.015, (y1 - y0) / ph)), 4),
                }
                cand_score = conf + (0.25 if has_colon else 0.0)
                if method == "inline" and has_colon:
                    cand_score += 0.20
                elif method == "right_neighbor":
                    cand_score += 0.15
                elif method == "below_neighbor":
                    cand_score += 0.05
                cand_item = {
                    "field": fkey,
                    "label": flabel,
                    "keywords": kws,
                    "matched": True,
                    "anchor_text": w.text,
                    "value": value,
                    "page": 0,
                    "rect": rect,
                    "method": method,
                    "confidence": round(min(1.0, conf), 2),
                }
                cand_box = {
                    "field": fkey,
                    "label": flabel,
                    "value": value,
                    "page": 0,
                    **rect,
                }
                if best_candidate is None or cand_score > best_candidate[0]:
                    best_candidate = (cand_score, cand_item, cand_box)

        if best_candidate:
            results.append(best_candidate[1])
            meta_boxes.append(best_candidate[2])
        else:
            results.append({
                "field": fkey,
                "label": flabel,
                "keywords": kws,
                "matched": False,
                "anchor_text": None,
                "value": None,
                "page": 0,
                "rect": None,
                "method": None,
                "confidence": 0.0,
            })

    return results, meta_boxes


def analyze_template_fields(
    raw: bytes,
    short_fields: list[dict[str, Any]],
    header_fields: list[dict[str, Any]],
    *,
    password: str | None = None,
    bank_code: str | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    """端到端模板智能分析：先跑标题字段版式分析定表头，再在页眉区跑短字段就近匹配。"""
    pages_words, page_sizes, page_count, full_text = _extract_pdf_words(raw, password=password, max_pages=3)
    hdr_out = analyze_header_fields(pages_words, page_sizes, header_fields)

    header_y_pt = hdr_out["header_y_pt"]
    if pages_words and header_y_pt is not None:
        header_text = " ".join(w.text for w in pages_words[0] if w.bottom <= header_y_pt + 4.0)
    else:
        header_text = full_text[:260]
    detected_code, detected_name = _detect_bank(full_text, header_text=header_text, filename=filename)
    final_bank = (bank_code or detected_code or "UNKNOWN").strip().upper()
    short_results, meta_boxes = match_short_fields(
        pages_words, page_sizes, short_fields, header_y_pt=hdr_out["header_y_pt"],
    )

    pw, ph = page_sizes[0] if page_sizes else (595.0, 842.0)
    tables = [hdr_out["table_layout"]] if hdr_out["table_layout"] else []
    header_sig = "|".join(
        str(c.get("header_text") or c.get("label") or "")
        for c in ((tables[0].get("columns") or []) if tables else [])
    )
    layout_hash = hashlib.sha256(header_sig.encode("utf-8")).hexdigest()[:16] if header_sig else ""

    layout = {
        "page_size": {"w": round(pw, 1), "h": round(ph, 1)},
        "page_count": page_count,
        "page_base": 0,
        **({"layout_hash": layout_hash} if layout_hash else {}),
        "tables": tables,
        "meta_boxes": meta_boxes,
    }

    return {
        "bank_code": final_bank,
        "bank_name": detected_name,
        "page_count": page_count,
        "page_size": {"w": round(pw, 1), "h": round(ph, 1)},
        "header_found": hdr_out["header_found"],
        "short_results": short_results,
        "header_results": hdr_out["header_results"],
        "table_area": hdr_out["table_area"],
        "preview_rows": hdr_out["preview_rows"],
        "field_map": hdr_out["field_map"],
        "layout": layout,
    }
