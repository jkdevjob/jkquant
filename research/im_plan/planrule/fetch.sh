#!/usr/bin/env bash
# 앱 모의와 같은 시세(/api/quote · range=max · div=1 · ohlcTrade 체결가 + 배당 이벤트) — planrule/data/ (저장소에 안 올림)
set -e; cd "$(dirname "$0")"; mkdir -p data
for s in TECL TQQQ SGOV; do curl -sf -o "data/$s.json" "https://jkquant.pages.dev/api/quote?symbol=$s&range=max&div=1&intraday=0"; done
