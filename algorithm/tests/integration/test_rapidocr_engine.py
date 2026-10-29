from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

from algorithm.ocr import RapidOCREngine

FONT_PATH = Path("C:/Windows/Fonts/msyh.ttc")


@pytest.mark.skipif(not FONT_PATH.exists(), reason="缺少中文字体 msyh.ttc")
def test_rapidocr_reads_synthetic_statement_image(tmp_path):
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

    path = tmp_path / "statement.png"
    image.save(path)

    result = RapidOCREngine().recognize(path.read_bytes())

    assert len(result.pages) == 1
    text = "".join(word.text for word in result.pages[0].words)
    for expected in ("2026-08-01", "+5,000.00", "5,024.58", "-29.00", "4,995.58"):
        assert expected in text
    assert all(0.0 <= word.confidence <= 1.0 for word in result.pages[0].words)
