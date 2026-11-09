"""解析能力（M2 新路）：用新长出来的版式驱动解析。

做法：把 LayoutPlan 转成旧模板的 layout 结构，交给旧解析器的 L1 通道。
这不是最终形态——最终形态是自己按列带切行切值；这一步的价值是**验证几何对不对**：
如果新几何能让旧解析器读出的笔数不少于无模板时的笔数，说明它抓对了表。

为什么先这么绕：先证明「几何是对的」，再证明「解析器是自己的」，
两件事分开验收，出问题时能一眼看出是几何错还是切值错。
"""
from __future__ import annotations

from ...compat.native import statement_from_parsed
from ...core.contracts import Statement
from ...core.paths import ensure_root_on_path
from ...core.registry import capability

ensure_root_on_path()


@capability
class LayoutDrivenParser:
    """按新版式解析（M2 对照实现，M4 后成为默认）。"""

    name = "parse.layout_v2"
    version = "1.0"
    provides = "statement"
    requires = ("document", "layout")
    priority = 5

    def run(self, ctx, inputs) -> Statement:
        from algorithm.ocr.models import Template as ParseTemplate
        from algorithm.ocr.parse import parse as parse_document

        from ..layout.legacy import to_legacy_layout

        layout = to_legacy_layout(inputs["layout"])
        if layout is None:
            raise RuntimeError("版式为空，无法按新路解析")
        template = ParseTemplate(
            bank_code="UNKNOWN",
            version=1,
            field_map={},
            layout=layout,
        )
        parsed = parse_document(inputs["document"].data, template)
        return statement_from_parsed(parsed)
