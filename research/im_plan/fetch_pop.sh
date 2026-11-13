#!/usr/bin/env bash
# 시중 매매법 시험(11-12)용 시세 — fetch.sh 와 같은 곳(jkquant /api/quote · 상장일부터 · 배당 포함) · data/ (저장소에 안 올린다)
set -e; cd "$(dirname "$0")"; mkdir -p data; P2=$(date +%s)
for s in UPRO TMF SSO AGG EFA EEM VEA VWO LQD SHY TIP DBC BND IWD IWM VNQ VGK EWJ VEU SCZ UVXY SQQQ SPXL ^GSPC; do
  f="data/$(echo $s|tr -d '^=').json"; e=$(node -e "console.log(encodeURIComponent('$s'))")
  for t in 1 2 3; do curl -sf -o "$f" "https://jkquant.pages.dev/api/quote?symbol=$e&range=5y&period1=0&period2=$P2&div=1" && break; sleep $((t*5)); done
  node -e "const j=require('./$f'); if(!(j.series&&j.series.length>100)) { console.error('BAD $s'); process.exit(1); } console.log('$s', j.series.length, j.series[0].date, j.series[j.series.length-1].date, (j.dividends||[]).length)"
done
# 11-14 달러지수(DX-Y.NYB · 1971~) — 듀얼 가드 U3 후보(planrule/dg_d14.js)가 data/DXYNYB.json 으로 읽는다
for t in 1 2 3; do curl -sf -o data/DXYNYB.json "https://jkquant.pages.dev/api/quote?symbol=DX-Y.NYB&range=5y&period1=0&period2=$P2&div=1" && break; sleep $((t*5)); done
node -e "const j=require('./data/DXYNYB.json'); if(!(j.series&&j.series.length>1000)){ console.error('BAD DXY'); process.exit(1); } console.log('DX-Y.NYB', j.series.length, j.series[0].date, j.series[j.series.length-1].date)"
