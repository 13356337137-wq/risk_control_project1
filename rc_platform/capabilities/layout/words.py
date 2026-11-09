"""把 PDF 变成带坐标的词；没有文本层就明确说没有（图片件走 OCR 通道）。"""
from __future__ import annotations

from dataclasses import dataclass, field

import pymupdf


@dataclass(frozen=True, slots=True)
class Word:
    text: str
    x0: float
    x1: float
    top: float
    bottom: float
    size: float = 0.0
    confidence: float = 1.0

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2

    @property
    def width(self) -> float:
        return self.x1 - self.x0


@dataclass
class Line:
    words: list[Word] = field(default_factory=list)
    top: float = 0.0
    bottom: float = 0.0

    @property
    def cy(self) -> float:
        return (self.top + self.bottom) / 2

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def x0(self) -> float:
        return min((w.x0 for w in self.words), default=0.0)

    @property
    def x1(self) -> float:
        return max((w.x1 for w in self.words), default=0.0)


@dataclass
class PageWords:
    page_no: int
    width: float
    height: float
    words: list[Word] = field(default_factory=list)
    has_text: bool = False


def group_lines(words_: list[Word], y_tol: float = 3.0) -> list[Line]:
    lines: list[Line] = []
    for word in sorted(words_, key=lambda w: (w.cy, w.x0)):
        if lines and abs(word.cy - lines[-1].cy) <= y_tol:
            line = lines[-1]
            line.words.append(word)
            line.top = min(line.top, word.top)
            line.bottom = max(line.bottom, word.bottom)
        else:
            lines.append(Line(words=[word], top=word.top, bottom=word.bottom))
    for line in lines:
        line.words.sort(key=lambda w: w.x0)
    return lines


def merge_tokens(line: Line, gap: float = 2.0) -> list[Word]:
    """把同一行里紧邻的词并成一个 token（PDF 常把一个表头词拆成多个 word）。"""
    tokens: list[Word] = []
    for word in line.words:
        if tokens and word.x0 - tokens[-1].x1 <= gap:
            prev = tokens[-1]
            tokens[-1] = Word(
                text=prev.text + word.text,
                x0=prev.x0, x1=max(prev.x1, word.x1),
                top=min(prev.top, word.top), bottom=max(prev.bottom, word.bottom),
                size=max(prev.size, word.size),
            )
        else:
            tokens.append(word)
    return tokens


def read_pages(data: bytes) -> list[PageWords]:
    """读 PDF 每页的词。没有文本层时 words 为空、has_text=False。"""
    pages: list[PageWords] = []
    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        for page_no in range(doc.page_count):
            page = doc[page_no]
            rect = page.rect
            raw = page.get_text("words") or []
            items = [
                Word(text=str(r[4]).strip(), x0=float(r[0]), x1=float(r[2]),
                     top=float(r[1]), bottom=float(r[3]))
                for r in raw if str(r[4]).strip()
            ]
            pages.append(PageWords(page_no=page_no, width=rect.width, height=rect.height,
                                   words=items, has_text=bool(items)))
    finally:
        doc.close()
    return pages
