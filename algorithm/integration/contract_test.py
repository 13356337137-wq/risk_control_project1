"""契约测试：按 contract.md 逐条校验接口。

用法：python contract_test.py --base http://localhost:8000
退出码：0 全绿，1 有失败。

注意：需要后端已启动、数据库已建表。本文件是可运行骨架，
接口全部实现前会大量 FAIL，这是预期的——它测的是契约，不是进度。
"""

import argparse
import sys

try:
    import requests
except ImportError:
    print("缺少依赖：pip install requests")
    sys.exit(2)

# (方法, 路径, 期望状态码集合, 说明)
CHECKS = [
    ("GET", "/api/v1/tasks", {200}, "任务列表可分页"),
    ("GET", "/api/v1/tasks/不存在的ID", {404}, "不存在返回 404"),
    ("GET", "/api/v1/tasks/1/report", {200, 403, 409}, "报告：有权限才可读"),
    ("GET", "/api/v1/templates", {200}, "模板列表"),
    ("GET", "/api/v1/rules", {200}, "规则列表"),
    ("GET", "/api/v1/audit", {200, 403}, "审计查询受限"),
]


def run(base: str, token: str | None) -> int:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    failed = 0
    for method, path, ok, note in CHECKS:
        url = base.rstrip("/") + path
        try:
            resp = requests.request(method, url, headers=headers, timeout=10)
            passed = resp.status_code in ok
            body_head = resp.text[:120].replace("\n", " ")
        except Exception as exc:  # 连不上也算失败
            passed, body_head, resp = False, str(exc)[:120], None
        status = "PASS" if passed else "FAIL"
        code = resp.status_code if resp is not None else "---"
        print(f"[{status}] {method:6s} {path:34s} {str(code):4s} {note}")
        if not passed:
            failed += 1
            print(f"        {body_head}")
    print(f"\n合计 {len(CHECKS)} 项，失败 {failed} 项")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--token", default=None)
    args = ap.parse_args()
    sys.exit(run(args.base, args.token))
