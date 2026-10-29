# 银行侧前端（frontend-admin）

> 端口 5174，代理 `/api` 到 8000。与借款人侧 `frontend/`（5173）是两个应用，Token 不共用。

## 现在能做什么

| 能力 | 状态 |
| --- | --- |
| 载入样例流水（PDF / JPG / PNG，本机读取不上传） | 可用 |
| 内置示例页（假数据，无文件也能练） | 可用 |
| 在页面上框选：画框、拖动、右下角缩放、删除 | 可用 |
| 每个框指定字段（内置 17 个）+ 自建字段 | 可用 |
| 表格区与列边界标注（明细逐行抽取的前提） | 可用 |
| 坐标归一化（0–1 相对比例）与基准页尺寸记录 | 可用 |
| 标注校验（T001–T010 错误 / W001–W005 警告）与点击定位 | 可用 |
| 草稿自动保存在浏览器 | 可用 |
| 导出 field_map JSON | 可用 |
| 试解析（dry-run）对照 | **未接入**，等后端 `/templates/dry-run` |
| 模板列表 / 启用停用 | **未接入**，等后端 `/templates` |
| 登录与权限守卫 | **未接入** |

## 启动

```bash
cd frontend-admin
npm install
npm run dev      # http://127.0.0.1:5174
npm run build    # 产物在 dist/
```

## 目录

```text
src/lib/types.ts      数据结构（FieldMapV1 / Issue …）
src/lib/fields.ts     内置字段字典（要加字段改这里）
src/lib/template.ts   校验、序列化、草稿、坐标工具
src/lib/pdf.ts        PDF/图片渲染（pdfjs 按需加载）
src/lib/sample.ts     内置示例页（纯假数据）
src/components/       Stage（画布与框选）/ Inspector / Toolbar / ValidationPanel
src/pages/Annotate.tsx 标注页主逻辑
src/App.tsx           应用壳（标注 / 模板列表）
```

## 可扩展点

| 要加什么 | 改哪里 |
| --- | --- |
| 新内置字段 | `src/lib/fields.ts` 的 `FIELD_DICT` |
| 新校验规则 | `src/lib/template.ts` 的 `validate()`，码沿用 spec |
| 支持更多文件类型 | `src/lib/pdf.ts` 的 `openSampleFile()` |
| 多页表格 | 已是结构内支持（tables 多条 + page） |
| 接入后端 | `src/lib/template.ts` 旁新增 api 层，替换导出为保存 |

## 已知限制

| 限制 | 说明 |
| --- | --- |
| 只是标注，不验证抽取 | 试解析未接入，标注对不对目前只能靠人工看 |
| 不做脱敏 | 样例是客户真件时，需先自行脱敏再载入；本页不上传 |
| 单页渲染 | 一次渲染一页；跨页表格需逐页标 |
| 无 undo/redo | 删错了只能重画 |

## 规范依据

字段结构、坐标基准、校验码、命中规则、试解析契约，全部见 `../algorithm/template-spec.md`。
