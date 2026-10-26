> 这是什么：OCR 与解析抽取实现 · 谁写：算法组 · 何时更新：实现变化时

# 职责

把合规 PDF 变成结构化明细：日期、摘要、对手方、金额、方向、余额、页码、坐标、置信度。

# 接口

```python
def parse(file_bytes: bytes, template: Template | None) -> ParseResult:
    """返回明细列表与自检三项；不判断真伪。"""

class ParseResult(BaseModel):
    transactions: list[Transaction]
    field_completeness: float   # 字段完整率
    avg_confidence: float       # 平均置信度
    low_conf_ratio: float       # 低置信行占比
    page_count: int
    warnings: list[str]

```

# 实现要点

| 项 | 做法 |
| --- | --- |
| 文本抽取 | pdfplumber，保留坐标 |
| 交叉校验 | PyMuPDF、Camelot 两路比对，定位抽错行 |
| 表格重建 | 坐标聚类，不依赖固定列宽 |
| 模板优先 | 本行模板库优先于预置模板库 |
| 兜底 | 都不命中走通用解析 |

# 不做

- 不做图像增强，扫描件直接判无文字层退回。
- 不做真假判断，那是 algo 的事。

