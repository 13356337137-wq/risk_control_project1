#!/usr/bin/env bash
# 一键部署到 Ubuntu 22.04 / 24.04（Debian 类似）
# 用法：sudo bash deploy/deploy.sh <域名或IP>
# 说明：脚本未在目标机上实测，首次执行请逐段确认输出。
set -euo pipefail

APP_DIR=/opt/risk-control
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)
DOMAIN=${1:-_}
DB_NAME=risk_control
DB_USER=riskapp
DB_PASS=${DB_PASS:-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 18)}

echo "== 1/8 安装系统依赖 =="
apt-get update -y
apt-get install -y python3-venv python3-pip nginx mysql-server git curl
if ! command -v node >/dev/null || [ "$(node -v | tr -dc '0-9' | cut -c1-2)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "== 2/8 建库建用户 =="
mysql -e "CREATE DATABASE IF NOT EXISTS ${DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -e "CREATE USER IF NOT EXISTS '${DB_USER}'@'127.0.0.1' IDENTIFIED BY '${DB_PASS}';"
mysql -e "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'127.0.0.1'; FLUSH PRIVILEGES;"

echo "== 3/8 同步代码到 ${APP_DIR} =="
mkdir -p "$APP_DIR"
rsync -a --delete --exclude node_modules --exclude .git --exclude dist --exclude storage \
  "$SRC_DIR/" "$APP_DIR/"

echo "== 4/8 安装后端依赖 =="
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install -q -U pip
"$APP_DIR/venv/bin/pip" install -q -r "$APP_DIR/backend/requirements.txt"
"$APP_DIR/venv/bin/pip" install -q pdfplumber pymupdf

echo "== 5/8 构建两个前端 =="
cd "$APP_DIR/frontend" && npm ci --no-audit --no-fund && VITE_BASE=/ npm run build
cd "$APP_DIR/frontend-admin" && npm ci --no-audit --no-fund && VITE_BASE=/bank/ npm run build
mkdir -p "$APP_DIR/web" "$APP_DIR/bank"
rsync -a --delete "$APP_DIR/frontend/dist/" "$APP_DIR/web/"
rsync -a --delete "$APP_DIR/frontend-admin/dist/" "$APP_DIR/bank/"
chown -R www-data:www-data "$APP_DIR/web" "$APP_DIR/bank"

echo "== 6/8 写环境变量 =="
mkdir -p "$APP_DIR/deploy"
cat > "$APP_DIR/deploy/.env" <<ENV
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=${DB_USER}
MYSQL_DB=${DB_NAME}
MYSQL_PASSWORD=${DB_PASS}
LOG_LEVEL=INFO
ENV
chmod 600 "$APP_DIR/deploy/.env"

echo "== 7/8 配置 systemd 与 nginx =="
sed "s/server_name _;/server_name ${DOMAIN};/" "$APP_DIR/deploy/nginx.conf" > /etc/nginx/sites-available/risk-control
ln -sf /etc/nginx/sites-available/risk-control /etc/nginx/sites-enabled/risk-control
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
cp "$APP_DIR/deploy/risk-control.service" /etc/systemd/system/risk-control.service
systemctl daemon-reload && systemctl enable --now risk-control

echo "== 8/8 自检 =="
sleep 3
curl -sS http://127.0.0.1:8000/health || true
echo
echo "部署完成：http://${DOMAIN}/（借款人端）  http://${DOMAIN}/bank/（银行侧）"
echo "数据库密码已写入 /opt/risk-control/deploy/.env，请备份并勿外传。"
echo "下一步：配 HTTPS（certbot --nginx -d ${DOMAIN}），并给 /bank/ 加访问限制。"
