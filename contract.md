> 这是什么：接口与数据契约，跨部分唯一依据 · 谁写：PM/PD · 何时更新：接口变更前先改这里
> 权限：仅 PM/PD 可写。前端/后端/算法/数据 只读；需要改接口请写 chat.md 提案。

# 通用约定

| 项 | 约定 |
| --- | --- |
| 基址 | /api/v1 |
| 鉴权 | Bearer Token；前台 bs_token，后台 bs_admin_token，互不读取 |
| 响应 | {code, message, data}；code=0 为成功 |
| 分页 | page 从 1 起，size 默认 20，上限 100 |
| 幂等 | 创建任务以文件哈希判重，重复提交返回原 task_id |
| 时间 | 存储与返回均为 UTC+8，带偏移 |
| 金额 | decimal(18,2)；接口用字符串传输，禁止 JSON 浮点 |
| 限流 | 单账号创建任务 10 次/分钟 |
| 支持载体 | application/pdf、image/jpeg、image/png |
| 大小上限 | PDF 20MB；图片 10MB、短边 ≥ 1000px |
| 载体判定 | 服务端判定 electronic / image / screenshot，不接受客户端自称 |

# 接口清单

## 任务

| 方法 | 路径 | 输入 | 成功 | 失败 |
| --- | --- | --- | --- | --- |
| POST | /tasks | multipart：file、task_type、period_start、period_end、password? | 202 {task_id,status,carrier} | E_FORMAT E_ENCRYPT E_LIMIT E_IMAGE_LOWQ E_IMAGE_BLUR |
| GET | /tasks | page、size、status、task_type | 200 分页 | — |
| GET | /tasks/{id} | — | 200 详情 | 404 |
| POST | /tasks/{id}/retry | — | 202 | E_STATE |
| POST | /tasks/{id}/supplement | multipart：file | 202 | E_STATE |
| DELETE | /tasks/{id} | — | 204 逻辑删除 | E_STATE |

## 报告（仅银行侧）

| 方法 | 路径 | 输入 | 成功 | 失败 |
| --- | --- | --- | --- | --- |
| GET | /tasks/{id}/report | — | 200 报告 | 409 未生成 E_FORBID |
| POST | /reports/{id}/export | format（pdf/docx） | 202 {job_id} | E_LIMIT |
| GET | /reports/{id}/export/{job_id} | — | 200 {url} | 404 |

## 批量

| 方法 | 路径 | 输入 | 成功 |
| --- | --- | --- | --- |
| POST | /tasks | task_type=batch，period_start/end | 202 |
| GET | /tasks/{id}/hits | page、size、rule_code | 200 命中清单 |
| PUT | /tasks/{id}/hits/{hitId} | decision、note | 200 |

## 模板与规则

| 方法 | 路径 | 输入 | 成功 |
| --- | --- | --- | --- |
| GET | /templates | bank_code、status | 200 |
| POST | /templates | field_map、version | 201 |
| POST | /templates/{id}/publish | — | 200 启用 |
| GET | /rules | category | 200 |
| PUT | /rules/{id} | expr、threshold | 200 新版本 |

## 账号与审计

| 方法 | 路径 | 输入 | 成功 |
| --- | --- | --- | --- |
| POST | /auth/login | username、password | 200 token |
| GET | /users | role、status | 200 |
| GET | /audit | object_type、object_id、page | 200 |
| GET | /settings/thresholds | — | 200 默认阈值与当前版本 |
| PUT | /settings/thresholds | 阈值项与值 | 200 新版本号 |

# 错误码

| 码 | HTTP | 含义 | 借款人可见文案 | 审批人可见文案 |
| --- | --- | --- | --- | --- |
| E_FORMAT | 400 | 非 PDF | 文件格式不支持，请上传 PDF | 格式判定失败 |
| E_BROKEN | 400 | 文件被截断 | 文件不完整，请重新下载 | 文件结构异常 |
| E_ENCRYPT | 400 | 有口令 | 文件已加密，请去掉口令 | 加密件 |
| E_NOLAYER | 400 | 无文字层 | 该文件像截图或扫描件 | 非官方导出件 |
| E_MULTI | 400 | 混装多家银行 | 一次只能传一家银行 | 来源不单一 |
| E_CHECK | 409 | 校验未通过 | 明细与合计对不上，请核对原件 | 数字核对失败，见定位行 |
| E_STATE | 409 | 状态不允许 | 当前状态不能这样操作 | 状态机拒绝 |
| E_LIMIT | 429 | 超限 | 操作太频繁或文件过大 | 触发限流 |
| E_IMAGE_LOWQ | 400 | 图片分辨率过低 | 图片太模糊，请重新拍摄或导出 | 短边不足 1000px |
| E_IMAGE_BLUR | 400 | 模糊、倾斜或反光遮挡关键字段 | 关键信息看不清，请重新拍摄 | 图片质量不达标 |
| E_AUTH | 401 | 未登录 | 登录已过期 | 令牌无效 |
| E_FORBID | 403 | 无权限 | 没有权限查看 | 越权访问 |

# 报告结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| carrier | string | electronic / image / screenshot |
| verdict | string | 未发现异常 / 存在不一致 / 余额可疑 / 来源可疑 / 无法判定 |
| limitations | array | 核验受限说明，例：影像件未做结构取证、无利率表未做结息反算 |
| verdict_reason | string | 触发结论的检查项 |
| layers | array | 四层各自结论：file、content、ledger、external |
| metrics | array | {code,name,value,unit,note,caliber_version}；指标集版本见 metric_set_version |
| metric_set_version | int | 指标集版本，数量可增减，历史报告按当时版本解释 |
| threshold_version | int | 阈值版本，默认值随系统发布 |
| conclusions | array | {code,level,threshold,value}，按阈值判定出的结论，银行可调阈值 |
| trend | array | {month,income,expense} |
| evidence | array | {txn_id,rule_code,page_no,x,y} |
| version | int | 只增不改 |

# 载体与结论上限

| carrier | 结论上限 | 附加要求 |
| --- | --- | --- |
| electronic | 未发现异常 | 结构取证 11 项全部执行 |
| image | 未发现异常 + limitations 注明核验受限 | 图像取证 8 项，强制人工复核 |
| screenshot | 来源可疑（封顶） | 报告写明不得作为授信依据 |

服务端判定的 carrier 与报告中的 carrier 必须一致，不允许前端传入。

# 数据契约（十一张表）

| 表 | 关键字段 | 约束 |
| --- | --- | --- |
| staff_user | id、name、role、status | role ∈ 审批人/模板管理员/运营管理员/系统管理员 |
| file_obj | id、sha256、mime、carrier、width、height、pages、has_text_layer、storage_path | sha256 唯一；carrier ∈ electronic/image/screenshot |
| task | id、biz_no、task_type、channel、file_id、carrier、template_id、template_version、status、check_result、period_start、period_end、hits | biz_no 唯一；task_type ∈ credit/batch；carrier 冗余便于统计 |
| bank_account | id、task_id、account_no、bank_name、period_start、period_end、opening_balance、closing_balance | 账号脱敏后落库 |
| txn | id、task_id、account_id、txn_date、direction、amount、balance、summary、counterparty_name、page_no | amount 恒正；按月分区 |
| metric_value | id、task_id、metric_code、metric_name、value_num、unit、note、caliber_version | 名与值同行 |
| report | id、task_id、version、carrier、verdict、layers、limitations、evidence | 只增不改 |
| template | id、bank_code、version、status、field_map | 只增不改 |
| rule | id、rule_code、version、category、expr、threshold | 只增不改 |
| appeal | id、task_id、txn_id、status、resolution | 只标记不删 |
| audit_log | id、actor_id、action、object_type、object_id、created_at | 只追加 |

# 状态机

| 当前 | 事件 | 下一 |
| --- | --- | --- |
| PENDING | 合规通过 | CHECKING |
| CHECKING | 解析投递 | PARSING |
| PARSING | 自检通过 | VERIFYING |
| PARSING | 缺页缺月 | NEED_SUPPLEMENT |
| NEED_SUPPLEMENT | 补传成功 | PARSING |
| VERIFYING | 三态合成 | REPORTING |
| REPORTING | 报告生成 | DONE |
| 任一 | 异常 | FAILED |
| FAILED | 重跑 | PENDING |

# 变更流程

1. 任何接口或字段变更：先改本文件，由 PM/PD 落笔。
2. 变更记录追加到「变更日志」，写明日期、内容、影响部分。
3. 契约变更后，对应部分的 tasks.md 由 Agent 自动追加「同步契约」条目。

# 变更日志

| 日期 | 内容 | 影响 |
| --- | --- | --- |
| 2026-10-26 | 初版：十二接口、十错误码、十一张表、报告结构 | 全部 |
| 2026-10-26 | 报告改为单份仅银行侧；移除 audience | 后端、前端、算法 |
| 2026-10-26 | 增加三类载体：electronic / image / screenshot；新增两条图片错误码；报告加 carrier 与 limitations | 全部 |
| 2026-10-26 | 结论改为按阈值判定：报告加 conclusions、threshold_version；指标集加 metric_set_version；新增阈值配置接口 | 后端、算法、前端 |
