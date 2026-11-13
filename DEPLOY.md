# 线上部署说明（务必按此执行）

## 一句话

**永远不要直接执行 `docker compose up`**，只执行 `./deploy.sh`（或 `docker compose -f docker-compose.server.yml up -d --build`）。

## 为什么

仓库里有两个 compose 文件：

| 文件 | 内容 | 能否用于线上 |
|---|---|---|
| `docker-compose.yml` | 上游默认模板：`image: calciumion/new-api:latest`，**没有 build 段** | ❌ 禁止 |
| `docker-compose.prod.yml` | 生产模板：`build: context .`，本地源码构建 | ✅ 模板 |
| `docker-compose.server.yml` | 服务器专用（在 `docker-compose.prod.yml` 基础上填了真实密码），**不入库** | ✅ 线上唯一入口 |

用 `docker-compose.yml` 启动会拉到官方镜像，导致：界面变成上游新版、我们的定制功能消失、
PostgreSQL 被换成 15 且账号变 root/123456、与现有 PG16 数据卷不兼容（会 Restarting 循环）。

## 标准流程

```bash
cd ~/new-api
./deploy.sh          # 拉代码 + 构建 + 启动 + 健康检查
```

只更新代码不重启用：`./deploy.sh --no-pull`。

## 首次准备（当前已就绪，重装时用）

1. 生成服务器专用 compose：

```bash
cp docker-compose.prod.yml docker-compose.server.yml
```

2. 填真实值（`CHANGEME_*`）：

```yaml
- SQL_DSN=postgresql://newapi:<PG_PASSWORD>@postgres:5432/new-api
- REDIS_CONN_STRING=redis://:<REDIS_PASSWORD>@redis:6379/0
- SESSION_SECRET=<原值>
- CRYPTO_SECRET=<原值>          # 必须与历史一致，否则数据库里加密的渠道密钥解不开
- SESSION_COOKIE_SECURE=true
- SESSION_COOKIE_TRUSTED_URL=https://baseadd.vip
```

3. 在 `~/.bashrc` 里加别名，防止误用默认 compose：

```bash
alias dc='docker compose -f ~/new-api/docker-compose.server.yml'
```

## 安全检查清单

启动后确认：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}'   # new-api-prod 的镜像必须是 new-api-new-api
docker compose -f docker-compose.server.yml ps
docker logs --tail 50 new-api-prod
```

- 镜像不是 `calciumion/new-api:latest`
- PostgreSQL 是 `postgres:16-alpine`
- `/api/status` 返回 200

## 禁止操作

| 禁止 | 原因 |
|---|---|
| `docker compose up -d`（不带 -f） | 会拉起官方镜像 |
| `docker compose down -v` | 会删除数据库数据卷 |
| `docker compose down --volumes` | 同上 |
| 修改 `CRYPTO_SECRET` | 已加密的渠道密钥会解不开 |
| `git checkout .` / `git clean -fdx` | 会删掉未入库的 `docker-compose.server.yml` |

> 建议在服务器上额外保留一份配置备份：`cp docker-compose.server.yml /root/docker-compose.server.yml`。

## 回滚

```bash
git log --oneline -10
git reset --hard <上一个正常提交>
./deploy.sh --no-pull
```

数据库迁移通常是加列/加表，回退旧版本一般可正常运行；若启动日志报 schema 错误，先恢复备份：

```bash
# 出问题前务必先备份
docker compose -f docker-compose.server.yml exec postgres \
  pg_dump -U newapi -d new-api > /root/newapi-backup-$(date +%F-%H%M).sql
```
