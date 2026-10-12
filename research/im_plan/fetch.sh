#!/usr/bin/env bash
# 시세 받기(jkquant /api/quote · 상장일부터 오늘까지) + 합성 3배 자료 만들기. 자료는 data/ (저장소에 안 올린다)
set -e; cd "$(dirname "$0")"; mkdir -p data; P2=$(date +%s)
for s in SOXL TQQQ TECL QQQ QLD SGOV BIL SOXX SMH ^SOX ^IRX ^NDX SPY XLK GLD TLT IEF; do
  f="data/$(echo $s|tr -d '^').json"; e=$(node -e "console.log(encodeURIComponent('$s'))")
  for t in 1 2 3; do curl -sf -o "$f" "https://jkquant.pages.dev/api/quote?symbol=$e&range=5y&period1=0&period2=$P2&div=1" && break; sleep $((t*5)); done
  node -e "const j=require('./$f'); if(!(j.series&&j.series.length>100)) { console.error('BAD $s'); process.exit(1); } console.log('$s', j.series.length, j.series[0].date, j.series[j.series.length-1].date)"
done
node synth.js
