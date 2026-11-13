#!/usr/bin/env bash
# 线上部署脚本：只用服务器专用 compose（本地构建），禁止用默认 docker-compose.yml。
#
# 为什么必须这样：
#   docker-compose.yml 是上游默认模板，new-api 服务的镜像是 calciumion/new-api:latest，
#   没有 build 段。直接 `docker compose up -d --build` 会拉官方镜像，界面和数据口径全变，
#   还会把 PostgreSQL 换成 15 版本、账号换成 root/123456。
#
# 用法：
#   ./deploy.sh              # 拉代码 + 构建 + 启动
#   ./deploy.sh --no-pull    # 只构建 + 启动（代码已就位）
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.server.yml}"
PULL=1
if [ "${1:-}" = "--no-pull" ]; then
  PULL=0
fi

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "错误：找不到 $COMPOSE_FILE" >&2
  echo "这是服务器专用配置（含真实凭据），不入库。请从备份恢复：" >&2
  echo "  cp /root/docker-compose.server.yml ./$COMPOSE_FILE" >&2
  echo "或参考 docker-compose.prod.yml 填写真实值后另存为 $COMPOSE_FILE。" >&2
  exit 1
fi

echo "== 当前提交 =="
git log -1 --oneline

if [ "$PULL" = "1" ]; then
  echo "== 拉取代码 =="
  git pull --ff-only
fi

echo "== 构建并启动（$COMPOSE_FILE）=="
docker compose -f "$COMPOSE_FILE" up -d --build

echo "== 状态 =="
docker compose -f "$COMPOSE_FILE" ps

echo "== 镜像检查（必须是本地构建的 new-api-new-api）=="
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' | grep -E 'new-api-prod|NAME' || true

echo "== 健康检查 =="
sleep 3
curl -s -o /dev/null -w 'api/status HTTP %{http_code}\n' http://127.0.0.1:3000/api/status || true

echo
echo "完成。若站点 502，检查 caddy 与 new-api-prod 是否在同一 docker 网络。"
