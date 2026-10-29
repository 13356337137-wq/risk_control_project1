from __future__ import annotations

import io

import fitz
import pytest
from PIL import Image

from algorithm.ocr import OcrUnavailable, RapidOCREngine


class FakeBackend:
    def __init__(self, result):
        self.result = result
        self.calls = 0

    def __call__(self, image):
        self.calls += 1
        return self.result, 0.0


def png_bytes(size: tuple[int, int] = (640, 120)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, "white").save(buf, format="PNG")
    return buf.getvalue()


def pdf_bytes(pages: int = 1) -> bytes:
    doc = fitz.open()
    for _ in range(pages):
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 100), "2026-08-01  +5,000.00")
    data = doc.tobytes()
    doc.close()
    return data


def fake_result(text: str = " 2026-08-01 ", score: float = 0.97):
    box = [[10.0, 20.0], [60.0, 20.0], [60.0, 40.0], [10.0, 40.0]]
    return [(box, text, score)]


def test_recognize_normalizes_words_and_bbox():
    engine = RapidOCREngine()
    engine._backend = FakeBackend(fake_result())

    result = engine.recognize(png_bytes())

    assert result.engine == "rapidocr"
    assert len(result.pages) == 1
    page = result.pages[0]
    assert (page.page_no, page.width, page.height) == (1, 640, 120)
    assert [(word.text, word.bbox) for word in page.words] == [
        ("2026-08-01", (10.0, 20.0, 60.0, 40.0))
    ]
    assert page.words[0].confidence == pytest.approx(0.97)


def test_recognize_skips_empty_text_and_sorts_by_line():
    box_a = [[10.0, 80.0], [60.0, 80.0], [60.0, 100.0], [10.0, 100.0]]
    box_b = [[10.0, 20.0], [60.0, 20.0], [60.0, 40.0], [10.0, 40.0]]
    engine = RapidOCREngine()
    engine._backend = FakeBackend(
        [(box_a, "第二行", 0.9), (box_b, "第一行", 0.8), (box_b, "  ", 0.5)]
    )

    words = engine.recognize(png_bytes()).pages[0].words

    assert [word.text for word in words] == ["第一行", "第二行"]


def test_recognize_pdf_renders_each_page():
    backend = FakeBackend(fake_result())
    engine = RapidOCREngine()
    engine._backend = backend

    result = engine.recognize(pdf_bytes(pages=2))

    assert backend.calls == 2
    assert [page.page_no for page in result.pages] == [1, 2]
    assert all(page.width > 0 and page.height > 0 for page in result.pages)


def test_empty_bytes_raises():
    with pytest.raises(OcrUnavailable):
        RapidOCREngine().recognize(b"")


def test_undecodable_image_raises():
    engine = RapidOCREngine()
    engine._backend = FakeBackend(fake_result())

    with pytest.raises(OcrUnavailable):
        engine.recognize(b"not an image")
