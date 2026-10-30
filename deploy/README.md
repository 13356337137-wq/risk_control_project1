# 部署说明（公网可访问）

> 目标：在服务器上跑起来，公网打开网址就能用。
> 现状：后端 + 两个前端 + MySQL 已能本地闭环；**还没有登录鉴权**，公网暴露前必须补临时保护。

# 一、先回答三个决定性问题

| 问题 | 为什么关键 |
| --- | --- |
| 服务器在**中国大陆**还是境外 | 大陆公网 IP 绑域名**必须备案**，否则只能用 IP 直接访问，且随时可能被拦 |
| 站点放**演示数据**还是**真实客户流水** | 真实流水放公网属重大合规风险；演示站只能放脱敏样例 |
| 谁能进银行侧 `/bank/` | 现在接口无鉴权，任何人拿到网址都能看报告 |

**建议：v2 先做成演示站（脱敏样例 + 明显水印「演示数据」），真实数据永不公网。**

# 二、方案 A：一键脚本（Ubuntu 22.04/24.04）

~~~bash
# 服务器上
git clone https://github.com/SYNACK200/risk_control_project1.git ~/risk_control_project1
cd ~/risk_control_project1
sudo bash deploy/deploy.sh demo.example.com
~~~

脚本做八件事：装依赖 → 建库建用户 → 同步代码到 `/opt/risk-control` → 装 Python 依赖 → 构建两个前端 → 写 `.env`（密码随机生成）→ 配 systemd 与 nginx → 自检。

# 三、方案 B：手动步骤（想逐步确认时用）

| 步 | 命令 / 文件 |
| --- | --- |
| 1 装依赖 | `apt install nginx mysql-server python3-venv nodejs npm` |
| 2 建库 | `CREATE DATABASE risk_control` + 建 `riskapp` 用户 |
| 3 代码 | 放 `/opt/risk-control` |
| 4 后端 | `python3 -m venv venv && venv/bin/pip install -r backend/requirements.txt` |
| 5 前端 | `VITE_BASE=/ npm run build`（借款人）、`VITE_BASE=/bank/ npm run build`（银行侧） |
| 6 静态 | `dist` 拷到 `/opt/risk-control/web` 与 `/opt/risk-control/bank` |
| 7 服务 | `deploy/risk-control.service` → `/etc/systemd/system/` |
| 8 反代 | `deploy/nginx.conf` → `sites-available`，`nginx -t && systemctl reload nginx` |

# 四、上线检查表（缺一项别开公网）

| # | 检查 | 通过标准 |
| --- | --- | --- |
| 1 | 后端只监听 127.0.0.1 | `ss -lntp` 看不到 8000 对公网 |
| 2 | 数据库只监听 127.0.0.1 | 3306 不对外 |
| 3 | `/bank/` 有保护 | Basic Auth 或 IP 白名单（登录未做） |
| 4 | HTTPS | `certbot --nginx -d 域名` 后 443 可访问、80 跳 443 |
| 5 | 上传大小 | nginx `client_max_body_size 25m`，超限返回 413 |
| 6 | 大文件超时 | `proxy_read_timeout 300s`，上传 8 页 PDF 不超时 |
| 7 | 无真实数据 | 服务器上 `find / -name '*.pdf'` 只有样例，无客户材料 |
| 8 | 演示标识 | 页面明显标注「演示环境，数据已脱敏」 |
| 9 | 日志 | `/var/log/nginx/` 与 journald 中不含账号姓名原文 |
| 10 | 备份 | MySQL 每日 dump，`.env` 单独备份 |

# 五、验证命令（部署后逐条跑）

~~~bash
curl -s https://域名/health                 # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}' https://域名/        # 200 借款人端
curl -s -o /dev/null -w '%{http_code}' https://域名/bank/   # 200 或 401（有口令时）
# 浏览器上传一份样例 PDF，确认能出报告并落库
mysql -e 'SELECT COUNT(*) FROM risk_control.task;'
~~~

# 六、已知风险（必须让组员知道）

| # | 风险 | 处置 |
| --- | --- | --- |
| 1 | **接口无鉴权** | 公网前至少加 Basic Auth + IP 白名单；登录功能排进 v3 |
| 2 | 明文 HTTP | 必须 certbot 上 HTTPS |
| 3 | 同步解析占 CPU | 大文件会占满 worker，后续改队列 |
| 4 | 上传落本地磁盘 | 无清理策略，磁盘会被撑满 |
| 5 | 无备案 | 大陆服务器只能 IP 访问，域名会被拦 |

# 七、回滚

~~~bash
systemctl stop risk-control
# 恢复上一版代码与 dist 后
systemctl start risk-control && systemctl reload nginx
~~~
