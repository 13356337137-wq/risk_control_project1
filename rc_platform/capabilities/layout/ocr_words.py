"""图片件 / 扫描件取词：走 OCR，产出与文本层同一种 PageWords。

为什么要同一份结构：锚点扩散的收敛逻辑（看形态、长带宽）与词从哪来无关。
文本层与 OCR 共用一套几何算法，才不会出现「电子件一套口径、图片件另一套口径」。
坐标单位是图片像素，下游一律按 width/height 归一化，所以不需要换算。
"""
from __future__ import annotations

from .words import PageWords, Word


def read_pages_via_ocr(data: bytes, dpi: int = 200) -> list[PageWords]:
    from algorithm.ocr.engine import RapidOCREngine

    engine = RapidOCREngine(dpi=dpi)
    result = engine.recognize(data, dpi=dpi)
    pages: list[PageWords] = []
    for page in result.pages:
        words = [
            Word(text=w.text, x0=float(w.bbox[0]), x1=float(w.bbox[2]),
                 top=float(w.bbox[1]), bottom=float(w.bbox[3]))
            for w in page.words
        ]
        pages.append(PageWords(
            page_no=max(0, page.page_no - 1),
            width=float(page.width), height=float(page.height),
            words=words, has_text=bool(words),
        ))
    return pages
