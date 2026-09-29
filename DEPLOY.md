# 自建部署指南

把「知行朋友圈」从托管环境迁到你自己的服务器。整套是标准栈：**NestJS + React + PostgreSQL**，一台 2 核 4G 的云服务器就能跑。

---

## 一、准备

| 项目 | 要求 |
|---|---|
| 服务器 | Linux（Ubuntu 22.04 推荐），2 核 4G 起 |
| Node.js | **≥ 22.0.0**（`package.json` engines 强制要求；undici@7 需要 Node ≥ 20 的全局 `File`） |
| PostgreSQL | 14+ |
| 反向代理 | Nginx（可选，用于 HTTPS） |

> Node 版本是最常见的启动失败原因。用 Node 18 启动会报 `ReferenceError: File is not defined`。

## 二、安装

```bash
# 1. 拉代码
git clone https://github.com/x2it/zhixing-circle.git
cd zhixing-circle

# 2. 装依赖
npm install

# 3. 建数据库
sudo -u postgres psql -c "CREATE USER zhixing WITH PASSWORD '改成强密码';"
sudo -u postgres psql -c "CREATE DATABASE zhixing OWNER zhixing;"
```

## 三、环境变量

复制 `.env.example` 为 `.env`，关键项：

```bash
SUDA_DATABASE_URL=postgres://zhixing:你的密码@127.0.0.1:5432/zhixing
NODE_ENV=production
SERVER_HOST=127.0.0.1
```

**`.env` 已在 `.gitignore` 中，永远不要提交。**

## 四、初始化数据库表

项目用 Drizzle，表结构定义在 `server/database/schema.ts`。首次部署执行迁移：

```bash
npm run gen:db-schema   # 如需重新生成 schema
npx drizzle-kit push    # 将表结构推到数据库
```

## 五、构建与启动

```bash
npm run type:check   # 服务端 + 客户端类型检查，必须双端 exit 0
npm run build:prod   # 产出 dist/server 与 dist/client
node dist/server/main.js
```

默认监听 `127.0.0.1:3000`。生产环境建议用 systemd 或 PM2 托管：

```ini
# /etc/systemd/system/zhixing.service
[Unit]
Description=Zhixing Circle
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/zhixing-circle
EnvironmentFile=/opt/zhixing-circle/.env
ExecStart=/usr/bin/node dist/server/main.js
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now zhixing
```

## 六、Nginx 反代（可选）

```nginx
server {
    listen 80;
    server_name your.domain.com;
    client_max_body_size 20m;   # 批量同步接口需要

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 七、创建账号

**系统没有开放注册接口**，这是刻意设计——auth 模块只有登录、改密、恢复码三类能力，没有 `register`/`signup`。

账号只能由你直接在数据库创建（密码用 bcrypt 哈希）：

```bash
# 生成 bcrypt 哈希（cost=10，与 auth.service 保持一致）
node -e "console.log(require('bcryptjs').hashSync('你的密码', 10))"
```

```sql
INSERT INTO users (username, password_hash)
VALUES ('admin', '上一步生成的哈希');
```

登录后会生成恢复码，务必保存——忘记密码时只能靠它重置。

## 八、从旧环境迁移数据

在旧环境「数据页 → 导出 JSON 备份」拿到全量数据（联系人 + 标签 + 跟进记录），到新环境「数据页 → JSON 导入」恢复。

也可以直接用 `pg_dump` 整库迁移：

```bash
# 旧环境
pg_dump -h 旧地址 -U zhixing zhixing > zhixing.sql
# 新环境
psql -h 127.0.0.1 -U zhixing -d zhixing < zhixing.sql
```

## 九、App 端对接

App 通过 API Key 访问，在「设置 → API 密钥」创建（`zx_` 前缀）。请求方式二选一：

- Header：`X-API-Key: zx_xxx`
- URL 参数：`?api_key=zx_xxx`

把 App 里的服务地址改成你的域名即可，无需改代码。

## 十、常见问题

**启动报 `File is not defined`**
Node 版本过低，升到 22。

**短信/通话同步返回 403**
这两类属敏感数据，开关默认关闭。在设置里开启，或调用 `PUT /api/settings/sms-sync`、`PUT /api/settings/call-sync`。

**批量接口报 400「单批最多 200 条」**
网关有 1MB 请求体限制，App 端已自动分批。自行调用时请遵守该上限。

**导出备份是空的**
默认不导出已归档联系人，勾选「包含已归档」再导出。

---

## 数据备份建议

自建后数据在你自己手上，但仍建议定期备份：

```bash
# 每天凌晨全量备份，保留 30 天
0 2 * * * pg_dump -U zhixing zhixing | gzip > /backup/zhixing-$(date +\%F).sql.gz
find /backup -name "zhixing-*.sql.gz" -mtime +30 -delete
```
