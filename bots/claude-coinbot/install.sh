#!/usr/bin/env bash
# ③ 실투자 봇 설치 — 우분투(오라클 클라우드 무료 서버 등). 사용: bash ~/jkquant/bots/claude-coinbot/install.sh
# 하는 일: Node.js 22.23.4(공식 파일 · 체크섬 확인) → /opt/node · 설정 파일 ~/.claude-coinbot/env(처음만 · 권한 600 · 보고 키 생성) ·
#          systemd 서비스 claude-coinbot 등록(켜지는 않음). 업비트 키는 이 서버의 설정 파일에만 넣는다(대화창 · 깃에 넣지 않는다).
set -euo pipefail
NODE_VER=22.23.4
case "$(uname -m)" in
  x86_64) ARCH=x64; SUM=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce ;;
  aarch64) ARCH=arm64; SUM=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b ;;
  *) echo "지원하지 않는 CPU: $(uname -m)"; exit 1 ;;
esac
if [ ! -x /opt/node/bin/node ] || [ "$(/opt/node/bin/node -v)" != "v$NODE_VER" ]; then
  echo "Node.js $NODE_VER 설치 중..."
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/node.tar.xz" "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-linux-$ARCH.tar.xz"
  echo "$SUM  $tmp/node.tar.xz" | sha256sum -c -
  sudo rm -rf /opt/node && sudo mkdir -p /opt/node
  sudo tar -xJf "$tmp/node.tar.xz" -C /opt/node --strip-components=1
  rm -rf "$tmp"
fi
/opt/node/bin/node -v
DIR="$HOME/.claude-coinbot"
mkdir -p "$DIR" && chmod 700 "$DIR"
ENVF="$DIR/env"
if [ ! -f "$ENVF" ]; then
  ( umask 077; cat > "$ENVF" <<EOF
# ③ 실투자 봇 설정 — 이 파일은 이 서버에만 둔다(권한 600). 바꾼 뒤: sudo systemctl restart claude-coinbot
UPBIT_ACCESS_KEY=
UPBIT_SECRET_KEY=
COINBOT_REPORT_KEY=$(openssl rand -hex 32)
BUDGET_KRW=600000
DRY_RUN=1
EOF
  )
  echo "설정 파일을 만들었습니다: $ENVF"
fi
chmod 600 "$ENVF"
BOT="$(cd "$(dirname "$0")" && pwd)"
sudo tee /etc/systemd/system/claude-coinbot.service >/dev/null <<EOF
[Unit]
Description=jkquant ③ ETH 실투자 봇
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$BOT
EnvironmentFile=$ENVF
Environment=COINBOT_DIR=$DIR
ExecStart=/opt/node/bin/node $BOT/coinbot.mjs
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
echo
echo "설치 끝. 다음 순서(README.md 5~8단계):"
echo "  1) nano $ENVF   — UPBIT_ACCESS_KEY= 와 UPBIT_SECRET_KEY= 뒤에 업비트 키 붙여넣기"
echo "  2) Cloudflare Pages 환경 변수 CLAUDE_COINBOT_KEY 에 아래 보고 키 넣기(대화창에는 붙이지 마세요)"
echo "     $(grep '^COINBOT_REPORT_KEY=' "$ENVF" | cut -d= -f2)"
echo "  3) bash $BOT/check.sh   — 설치 확인(실제로 체결되는 주문은 내지 않음)"
echo "  4) sudo systemctl enable --now claude-coinbot   — 시험 모드로 시작"
