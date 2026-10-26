> 这是什么：mock 数据规范（后端未就绪时前端用什么假数据） · 谁写：PM/PD 出基线，后端实现后替换 · 何时更新：契约变化时
> 为什么要有它：没有统一 mock，前端只能自己编字段，联调时全改。

# 一、三条铁律

| # | 铁律 | 违反的后果 |
| --- | --- | --- |
| M1 | 字段名与 `contract.md` 一字不差 | 联调时字段对不上，改一遍等于重写 |
| M2 | 金额一律字符串、时间带时区偏移 | 前端养成算术习惯、时间显示差 8 小时 |
| M3 | 每种错误码都要有样例，且文案与契约的「双受众」一致 | 上线才发现有的码没有文案 |

# 二、放哪、怎么切

| 项 | 约定 |
| --- | --- |
| 位置 | `frontend/src/mocks/`（银行侧同结构） |
| 开关 | 环境变量 `VITE_USE_MOCK=1`，默认关 |
| 拦截 | 请求层判断开关，命中则返回本地 JSON，不发网络请求 |
| 生产 | **构建时强制关闭**；`import.meta.env.PROD` 下不许引用 mocks |
| 删除 | 后端接口联通后删除对应 mock，不留死代码 |

# 三、必须覆盖的场景（九种）

| # | 场景 | 用来验什么 |
| --- | --- | --- |
| S1 | 电子件正常完成 | 主链路展示 |
| S2 | 影像件完成（带 limitations、待复核标记） | 受限说明与标记 |
| S3 | 截图件（结论来源可疑） | 封顶结论的展示 |
| S4 | 待补件（缺两个月） | 补件入口与清单 |
| S5 | 处理失败（E_CHECK） | 失败态与原因码 |
| S6 | 空列表 | 空态 |
| S7 | 无权限（E_FORBID） | 403 页，不是空列表 |
| S8 | 慢响应（延迟 3 秒） | 加载态与取消 |
| S9 | 十种错误码各一条 | 文案映射全覆盖 |

# 四、任务详情样例（字段以契约为准）

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "T20261024001",
    "task_type": "credit",
    "carrier": "image",
    "status": "DONE",
    "status_text": "已完成",
    "fail_code": null,
    "created_at": "2026-10-24T10:00:00+08:00",
    "period_start": "2026-04-01",
    "period_end": "2026-09-30"
  }
}
```

# 五、报告样例（含阈值与指标集版本）

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "T20261024001",
    "carrier": "image",
    "verdict": "未发现异常",
    "verdict_reason": "四层核验通过",
    "limitations": ["影像件未做结构取证", "无利率表，未做结息反算"],
    "layers": {
      "carrier": "影像件取证未见拼接或涂改",
      "content": "余额链与合计一致",
      "ledger": "不可算",
      "external": "未做"
    },
    "metric_set_version": 1,
    "threshold_version": 1,
    "conclusions": [
      { "code": "DTI_HIGH", "level": "info", "threshold": "0.5", "value": "0.42" }
    ],
    "metrics": [
      { "code": "A02", "name": "月均收入", "value": "8500.00", "unit": "元",
        "note": "近六个月入账均值（OCR 识别）", "caliber_version": 2 }
    ],
    "evidence": [
      { "txn_id": 88123, "rule_code": "C1", "page_no": 4, "x": 120.5, "y": 330.2 }
    ]
  }
}
```

# 六、错误样例（十种都要有）

```json
{ "code": "E_FORBID", "message": "没有查看该内容的权限", "data": null }
```

| 码 | 必须有一条 mock |
| --- | --- |
| E_FORMAT、E_BROKEN、E_ENCRYPT、E_IMAGE_LOWQ、E_IMAGE_BLUR、E_MULTI、E_CHECK、E_STATE、E_LIMIT、E_AUTH、E_FORBID | 是 |

# 七、谁来维护

| 阶段 | 谁 | 做什么 |
| --- | --- | --- |
| 契约定稿后 | PM/PD | 出 mock 基线（本文件即基线） |
| 开发期 | 前端 | 按场景补样例，字段不许自创 |
| 接口就绪 | 后端 | 提供真实响应，前端对照差异 |
| 联调通过 | 前端 | 删除 mock，关掉开关 |

# 八、禁止事项

| 禁止 | 为什么 |
| --- | --- |
| 用真实客户数据做 mock | 公开仓库，一提交就泄露 |
| 自创字段或自创状态 | 联调必炸 |
| 把 mock 留在生产构建里 | 线上出现假数据是最严重的事故 |
| 用 mock 通过验收 | 验收必须跑真实接口 |
