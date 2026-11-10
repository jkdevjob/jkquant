#!/usr/bin/env bash
# 인버스/롱 거래대금 비율 연구(11-10) 자료 — Yahoo 일봉(가격) + Eastmoney 일봉(실제 거래대금 f57 · 2017-07~). data/ 는 저장소에 안 올린다.
# Yahoo 의 분할 반영 거래량은 역분할이 많은 인버스 ETF 에서 정수로 뭉개진다(SOXS 2018 하루 거래량이 1~2) — 거래대금은 반드시 Eastmoney 값을 쓴다.
set -e; cd "$(dirname "$0")"; mkdir -p data; P2=$(date +%s)
for s in SOXS SOXL SOXX SQQQ TQQQ QQQ TECS TECL; do
  curl -sf -m 40 -A "Mozilla/5.0" -o data/y_$s.json "https://query1.finance.yahoo.com/v8/finance/chart/$s?period1=1262304000&period2=$P2&interval=1d&events=div%2Csplit"
  for mk in 107 105 106; do for t in 1 2 3; do curl -sf -m 40 -A "Mozilla/5.0" -o data/e_$s.json "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=$mk.$s&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=20100101&end=20261231&lmt=10000" && break; done
    n=$(node -e "try{console.log((require('./data/e_$s.json').data.klines||[]).length)}catch(e){console.log(0)}"); [ "$n" -gt 100 ] && break; done
  echo "$s yahoo+eastmoney($n)"
done
