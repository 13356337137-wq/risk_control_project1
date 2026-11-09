"""版式能力：从页面自己长出表格结构。

它只回答「表格在哪、有哪几列、每列装什么」，不读值、不判真伪。

取词两条路，收敛逻辑共用：
- 有文本层：直接读 PDF 词（快、准）
- 没有文本层（图片/扫描）：渲染后 OCR 取词（慢，但几何算法一模一样）

OCR 默认关闭（layout.ocr = true 才开）：它耗时，且不同部署的算力差别很大。
"""
from __future__ import annotations

from ...core.contracts import LayoutPlan
from ...core.registry import capability
from .detect import detect_layout
from .words import read_pages


@capability
class AnchorSpreadLayout:
    """锚点扩散为主、几何聚类兜底、表头位置保底的版式检测。"""

    name = "layout.anchor_spread"
    version = "1.1"
    provides = "layout"
    requires = ("document", "profile")
    priority = 0

    def run(self, ctx, inputs) -> LayoutPlan:
        doc = inputs["document"]
        profile = inputs["profile"]
        pages = read_pages(doc.data)
        used_ocr = False

        if not any(page.has_text for page in pages) and ctx.setting("layout.ocr", False):
            from .ocr_words import read_pages_via_ocr

            pages = read_pages_via_ocr(doc.data, dpi=int(ctx.setting("layout.ocr_dpi", 200)))
            used_ocr = True

        plan = detect_layout(pages)
        if used_ocr:
            plan.reasons.insert(0, "文本层为空，已改用 OCR 取词")
        elif not plan.regions and profile.carrier in ("image", "screenshot"):
            plan.reasons.append("图片件没有文本层：开启 layout.ocr 后可由 OCR 取词")
        ctx.logger.info(
            "版式检测：%s，置信 %.2f，%d 个区域%s",
            plan.method, plan.confidence, len(plan.regions), "（OCR 取词）" if used_ocr else "",
        )
        return plan
