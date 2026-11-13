#!/usr/bin/env bash
# ③ 실투자 봇 설치 확인 — 설정 파일을 읽어 coinbot.mjs --check 를 돈다(실제로 체결되는 주문은 내지 않는다). --status 를 주면 지금 상태만 본다.
set -euo pipefail
BOT="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$HOME/.claude-coinbot/env"; set +a
COINBOT_DIR="$HOME/.claude-coinbot" exec /opt/node/bin/node "$BOT/coinbot.mjs" "${1:---check}"   # 인자 --status 면 상태만(주문 · 알림 없음)
