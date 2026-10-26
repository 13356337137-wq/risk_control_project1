#!/usr/bin/env bash
# 一键起四部分（骨架，按实际实现补全）
set -e

echo "[1/3] 启动后端"
# cd ../backend && python main.py &
echo "  待补：backend 启动命令"

echo "[2/3] 启动前端（借款人 5173 / 银行 5174）"
# cd ../frontend && npm run dev &
# cd ../frontend-admin && npm run dev &
echo "  待补：前端启动命令"

echo "[3/3] 跑契约测试"
# python contract_test.py --base http://localhost:8000
echo "  待补：契约测试"

echo "完成。四个部分都起来后，重跑本脚本末尾的契约测试。"
