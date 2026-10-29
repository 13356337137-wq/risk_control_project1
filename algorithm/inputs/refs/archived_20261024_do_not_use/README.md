# 归档区：禁止用于实现

本目录三份文件为 2026-10-24 的旧稿（算法模块 MVP 规格），状态为**仅归档**。

## 使用约束

1. 不得作为需求、口径、接口或验收依据；现行唯一依据是根目录 `contract.md`、`forbidden.md`、`proposal.md` 与本目录外的 `design.md`、`tasks.md`。
2. 不得把本目录内容放入提示词、复制进实现代码或作为 AI 开工上下文。
3. 与现行文档冲突时，一律以现行文档为准，不因旧稿提出修改。
4. 如确需采用旧稿中的任何口径，必须先由 PM/PD 解冻相应冻结项并修改 `contract.md`，再另行建任务。

## 已知冲突

| 旧稿 | 现行口径 |
| --- | --- |
| 综合评分、风险等级、四维雷达图 | F01 只呈现不判断，不评分、不分级 |
| 7 项指标 | F06 当前 40 项，带 `metric_set_version` / `caliber_version` |
| Mock OCR | F14 统一调行内 OCR 服务 |
| 金额 `float` | contract 金额 `decimal(18,2)`，字符串传输 |
| `GET /api/tasks/{taskId}/report` | `/api/v1/tasks/{id}/report` + 报告结构以 contract 为准 |
| 算法侧写 FastAPI routers | 接口归后端，算法只提供解析/核验/指标能力 |
