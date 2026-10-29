from __future__ import annotations

import io
from decimal import Decimal
from pathlib import Path

import fitz
import pytest
from PIL import Image, ImageDraw, ImageFont

from algorithm.ocr import parse

FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")


def statement_png() -> bytes:
    image = Image.new("RGB", (900, 230), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(FONT_PATH), 22)
    lines = [
        "交易日期    摘要    收入/支出金额    余额",
        "2026-08-01  工资    +5,000.00   5,024.58",
        "2026-08-02  消费    -29.00      4,995.58",
    ]
    for index, line in enumerate(lines):
        draw.text((20, 20 + index * 65), line, font=font, fill="black")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def scanned_pdf(png: bytes) -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=900, height=230)
    page.insert_image(fitz.Rect(0, 0, 900, 230), stream=png)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.mark.skipif(not FONT_PATH.exists(), reason="缺少中文字体 msyh.ttc")
def test_parse_image_end_to_end():
    result = parse(statement_png())

    assert result.page_count == 1
    assert len(result.transactions) == 2
    first, second = result.transactions
    assert (first.txn_date, first.summary, first.direction) == ("2026-08-01", "工资", "in")
    assert (first.amount, first.balance) == (Decimal("5000"), Decimal("5024.58"))
    assert (second.txn_date, second.summary, second.direction) == ("2026-08-02", "消费", "out")
    assert (second.amount, second.balance) == (Decimal("29"), Decimal("4995.58"))
    assert 0 < first.confidence <= 1
    assert any("OCR" in warning for warning in result.warnings)


@pytest.mark.skipif(not FONT_PATH.exists(), reason="缺少中文字体 msyh.ttc")
def test_parse_pdf_without_text_layer_falls_back_to_ocr():
    result = parse(scanned_pdf(statement_png()))

    assert result.page_count == 1
    assert [txn.txn_date for txn in result.transactions] == ["2026-08-01", "2026-08-02"]
    assert any("OCR" in warning for warning in result.warnings)
