> 这是什么：跨部分联调三件套 · 谁写：算法组维护，全员使用 · 何时更新：契约或样例变化时

# 三件套

| 文件 | 作用 | 怎么用 |
| --- | --- | --- |
| contract_test.py | 按 contract.md 校验接口 | `python contract_test.py --base http://localhost:8000` |
| samples/ | 三份样例流水 + 期望 JSON | 算法与数据共用 |
| run_all.sh | 一键起四部分 | `bash run_all.sh` |

# 联调流程

| 步 | 谁 | 通过标准 |
| --- | --- | --- |
| 1 | 算法 | 单测与样本回归通过 |
| 2 | 数据 | 十一张表齐全、查询达标 |
| 3 | 后端 | 每个接口 200 与 4xx 各一次 |
| 4 | 前端 | 发起联调，跑 contract_test 全绿 |
| 5 | PM/PD | 放行，history 记「联调通过 日期 版本」 |

# 失败回流

contract_test 报错 → 在**对应部分**的 tasks.md 追加一条，附报错原文，标注「来自联调」。谁的部分谁认领。

# 闸门

> contract_test 不全绿，不得合并到 main。history 没有「联调通过」记录，视为未完成。
