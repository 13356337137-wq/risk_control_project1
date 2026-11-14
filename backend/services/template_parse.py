"""把数据库里的模板行转成算法侧能用的 Template。

为什么单独一处：解析主链路（analysis）与模板试跑（templates.preview）都要转，
两处各写一遍就会出现「试跑说没问题、真解析没生效」——页号 0/1 起这种差异尤其容易漏。
"""
from __future__ import annotations

from algorithm.ocr.models import MetaBox, Template as ParseTemplate


def build_template(*, bank_code: str, version: int, field_map: dict | None,
                   layout: dict | None) -> ParseTemplate:
    layout = layout or {}
    size = layout.get("page_size") or {}
    width = float(size.get("w") or 0)
    height = float(size.get("h") or 0)
    page_size = (width, height) if width > 0 and height > 0 else None

    raw_boxes = [box for box in (layout.get("meta_boxes") or []) if {"field", "x", "y", "w", "h"} <= set(box)]
    # 页号口径：解析侧从 1 起（交易行的 page_no 也是 1 起）。
    # 画布早期按 0 起存过，这里统一纠正，避免「框永远匹配不到页」。
    zero_based = bool(raw_boxes) and min(int(box.get("page", 0)) for box in raw_boxes) == 0
    meta_boxes = [
        MetaBox(
            field=str(box["field"]),
            page=int(box.get("page", 0)) + (1 if zero_based else 0),
            x=float(box["x"]), y=float(box["y"]), w=float(box["w"]), h=float(box["h"]),
        )
        for box in raw_boxes
    ]

    return ParseTemplate(
        bank_code=str(bank_code or "UNKNOWN"),
        version=int(version or 1),
        field_map=dict(field_map or {}),
        layout=layout or None,
        meta_boxes=meta_boxes,
        page_size=page_size,
    )
