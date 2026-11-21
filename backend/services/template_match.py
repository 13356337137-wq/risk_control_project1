"""模板表头相似度匹配与指纹计算（T9：layout_hash + header_text + Jaccard >= 0.6）。"""
from __future__ import annotations

import hashlib
from typing import Any


def compute_layout_hash(headers: list[str]) -> str:
    """对表头词序列做稳定规范化指纹，供同银行多版式快速区分。"""
    norm = [str(h or "").strip() for h in headers if str(h or "").strip()]
    joined = "|".join(norm)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16] if joined else ""


def header_jaccard(a: list[str] | set[str], b: list[str] | set[str]) -> float:
    """计算两组表头关键词的 Jaccard 相似度（0.0 ~ 1.0）。"""
    sa = {str(x).strip() for x in (a or []) if str(x).strip()}
    sb = {str(x).strip() for x in (b or []) if str(x).strip()}
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def pick_best_template(
    candidates: list[Any],
    doc_headers: list[str] | None = None,
    min_jaccard: float = 0.6,
) -> tuple[Any | None, float, str]:
    """在同银行候选模板中按 layout_hash / 表头 Jaccard >= 0.6 选出最佳版式。

    返回 (matched_template, score, reason)。
    """
    if not candidates:
        return None, 0.0, "no_enabled_template"
    if not doc_headers:
        if len(candidates) == 1:
            return candidates[0], 1.0, "single_enabled_fallback"
        return candidates[0], 0.0, "no_doc_headers_first_fallback"

    doc_hash = compute_layout_hash(doc_headers)
    best_tpl = None
    best_score = -1.0
    for tpl in candidates:
        lay = getattr(tpl, "layout", None) or {}
        if doc_hash and lay.get("layout_hash") == doc_hash:
            return tpl, 1.0, "layout_hash_exact"
        tpl_headers: list[str] = []
        for tb in (lay.get("tables") or []):
            for col in (tb.get("columns") or []):
                ht = col.get("header_text") or col.get("label")
                if ht:
                    tpl_headers.append(str(ht))
        if not tpl_headers:
            tpl_headers = [str(x) for x in (getattr(tpl, "header_columns", None) or []) if x]
        if not tpl_headers:
            fmap = getattr(tpl, "field_map", None) or {}
            tpl_headers = [str(v) for v in fmap.values() if isinstance(v, str)]
        score = header_jaccard(doc_headers, tpl_headers)
        if score > best_score:
            best_score = score
            best_tpl = tpl

    if best_tpl is not None and best_score >= min_jaccard:
        return best_tpl, round(best_score, 4), "header_jaccard_match"
    if len(candidates) == 1:
        return candidates[0], round(max(0.0, best_score), 4), "single_enabled_low_jaccard"
    return None, round(max(0.0, best_score), 4), "jaccard_below_threshold"
