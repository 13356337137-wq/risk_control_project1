from __future__ import annotations

from algorithm.ocr import OcrPage, OcrResult, OcrWord, parse


class FakeEngine:
    def recognize(self, file_bytes: bytes, dpi: int | None = None) -> OcrResult:
        words = [
            OcrWord(text="交易日期", bbox=(0, 0, 60, 20), confidence=0.99),
            OcrWord(text="摘要", bbox=(100, 0, 140, 20), confidence=0.99),
            OcrWord(text="交易金额", bbox=(220, 0, 280, 20), confidence=0.99),
            OcrWord(text="账户余额", bbox=(340, 0, 400, 20), confidence=0.99),
            OcrWord(text="2026-08-01 工资", bbox=(20, 30, 180, 50), confidence=0.55),
            OcrWord(text="+100.00", bbox=(220, 30, 280, 50), confidence=0.95),
            OcrWord(text="200.00", bbox=(340, 30, 400, 50), confidence=0.99),
        ]
        page = OcrPage(page_no=1, width=1000, height=200, words=words)
        return OcrResult(engine="fake", pages=[page])


def test_parse_routes_image_to_ocr_and_keeps_confidence(monkeypatch):
    monkeypatch.setattr("algorithm.ocr.engine.get_default_engine", lambda: FakeEngine())

    result = parse(b"\x89PNG\r\n\x1a\n" + b"\x00" * 8)

    assert result.page_count == 1
    assert len(result.transactions) == 1
    txn = result.transactions[0]
    assert txn.txn_date == "2026-08-01"
    assert txn.summary == "工资"
    assert txn.direction == "in"
    assert txn.amount == 100
    assert txn.balance == 200
    assert txn.confidence == 0.55
    assert result.low_conf_ratio == 1.0
    assert any("fake" in warning for warning in result.warnings)
