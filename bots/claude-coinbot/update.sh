#!/usr/bin/env bash
# ③ 실투자 봇 새 판 받기 — main 을 받아 봇을 다시 켠다(설정 · 상태 파일은 그대로).
set -euo pipefail
BOT="$(cd "$(dirname "$0")" && pwd)"
git -C "$BOT" pull --ff-only
sudo systemctl restart claude-coinbot
sleep 3
systemctl --no-pager --lines=5 status claude-coinbot || true
