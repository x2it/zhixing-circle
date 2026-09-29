#!/bin/bash
# 知行朋友圈 · 建账号 / 改密码（服务端命令行工具）
#
# 系统没有开放注册接口，这是刻意设计——auth 模块只有登录、改密、恢复码三类能力，
# Web 端也没有注册页。账号只能由服务端创建，本脚本把这件事变成一条命令。
#
# 新建账号时会同时签发一枚 App 用的 API Key（明文只显示这一次，库里只存 sha256）。
#
# 前置：设置数据库连接串（不要把它写进任何文件）
#   export SUDA_DATABASE_URL='postgres://用户:口令@127.0.0.1:5432/库名'
#
# 用法：
#   bash scripts/add-user.sh <用户名> <密码> [显示名]        # 新建账号（顺带签发 App 密钥）
#   bash scripts/add-user.sh <用户名> <新密码> --reset-pw    # 重置已有账号密码
#
# 例：
#   bash scripts/add-user.sh davi 'MyPass123' 'Davi'
#   bash scripts/add-user.sh davi 'NewPass456' --reset-pw

set -e

DB_URL="${SUDA_DATABASE_URL:-${DATABASE_URL:-}}"
PROJ="${ZHIXING_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"

if [ -z "$DB_URL" ]; then
  echo "❌ 请先设置数据库连接串："
  echo "   export SUDA_DATABASE_URL='postgres://用户:口令@127.0.0.1:5432/库名'"
  exit 1
fi

USERNAME="$1"
PASSWORD="$2"
THIRD="$3"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  echo "用法：bash scripts/add-user.sh <用户名> <密码> [显示名]"
  echo "     bash scripts/add-user.sh <用户名> <新密码> --reset-pw"
  exit 1
fi

# 防 SQL 破坏：用户名不允许引号与空格
case "$USERNAME" in
  *"'"*|*" "*|*'"'*) echo "❌ 用户名不能包含引号或空格"; exit 1 ;;
esac

DISPLAY=""
RESET=0
if [ "$THIRD" = "--reset-pw" ]; then RESET=1; else DISPLAY="$THIRD"; fi

if [ ${#PASSWORD} -lt 8 ]; then
  echo "⚠️  密码少于 8 位，建议设置得更长一些（不强制拦截）"
fi

cd "$PROJ"
HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 10))" "$PASSWORD")
EXISTS=$(psql "$DB_URL" -t -A -c "SELECT id FROM users WHERE username='$USERNAME';" 2>/dev/null | head -1)

# ===== 重置密码 =====
if [ "$RESET" = "1" ]; then
  if [ -z "$EXISTS" ]; then
    echo "❌ 账号 '$USERNAME' 不存在，无法重置"
    exit 1
  fi
  psql "$DB_URL" -c "UPDATE users SET password_hash='$HASH' WHERE username='$USERNAME';" > /dev/null
  echo "✅ 密码已重置 —— 账号：$USERNAME"
  exit 0
fi

# ===== 新建账号 =====
if [ -n "$EXISTS" ]; then
  echo "❌ 账号 '$USERNAME' 已存在。要改密码请加 --reset-pw"
  exit 1
fi

NEWID=$(psql "$DB_URL" -t -A -c \
  "INSERT INTO users (username, password_hash, display_name, role) VALUES ('$USERNAME','$HASH','${DISPLAY:-$USERNAME}','user') RETURNING id;" \
  | grep -oE '[0-9a-f-]{36}' | head -1)

if [ -z "$NEWID" ]; then
  echo "❌ 创建失败（未返回用户 id）"
  exit 1
fi

# 签发 App 用的 API Key：明文只出现这一次，库里只存 sha256
PLAIN="zx_$(openssl rand -hex 16)"
KEYHASH=$(printf '%s' "$PLAIN" | sha256sum | cut -d' ' -f1)
PREFIX=$(printf '%s' "$PLAIN" | cut -c1-10)
psql "$DB_URL" -c \
  "INSERT INTO api_keys (key_hash, key_prefix, name, status, user_id) VALUES ('$KEYHASH','$PREFIX','$USERNAME 的 App 密钥','active','$NEWID');" \
  > /dev/null

echo "✅ 账号已创建"
echo "   用户名   ：$USERNAME"
echo "   显示名   ：${DISPLAY:-$USERNAME}"
echo "   登录密码 ：$PASSWORD"
echo "   API Key  ：$PLAIN"
echo ""
echo "⚠️  API Key 只显示这一次（库里只存哈希，无法找回），请立刻复制保存。"
echo "   App 端填这个 Key 即可连上云端；Web 端用上面的用户名密码登录。"
echo ""
echo "数据隔离：每个账号的联系人/短信/通话/标签/批次/密钥全部按 user_id 隔离，"
echo "          用 A 的密钥既看不到也删不掉 B 的数据（越权 id 会被静默忽略）。"
