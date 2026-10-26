"""R16 실측 손실이 설계 표본 안인가 — ② 데이트레이딩 · ④ SOXL (2026-10-27 아침 점검).

계기: 10월 모의 장부(10/1~) ② 7매매 −18.54% · ④ 1매매 −34.78%. 나쁜 운인지, 설계에 없던 일인지 먼저 잰다.

사전 등록(결과 보기 전): 실측 누적이 설계 표본(2026-09-30 까지)의 같은 길이 구간 하위 5% 보다 나쁘면
'설계와 다름 — 점검', 그 안이면 '설계 안의 나쁜 구간 — 그대로 쌓음'.
- ②: 설계 매매 목록(claude_lab.etf_trades 와 같은 식 · 비용 0.03% + 2틱)에서 연속 n매매(n = 실측 매매 수) 복리 누적 분포.
  지금 메인(−4.75% 이하 마감)과 옛 기본(−3%) 두 기준으로 본다.
- ④: soxl-mr-decisions.csv 의 매매별(진입 → 청산) 복리 손익 분포에서 실측 매매의 위치.

재현: python3 scripts/research/r16_forward_vs_design.py <latest.json> <soxl-mr-decisions.csv>
  (둘 다 scalping-data 의 data/claude-lab/ 에 있다 — git show origin/scalping-data:data/claude-lab/latest.json > latest.json)
"""
import csv
import json
import math
import sys

import FinanceDataReader as fdr

lab = json.load(open(sys.argv[1], encoding="utf-8"))
soxl_csv = sys.argv[2]
design_end = lab.get("designEnd")
print("designEnd", design_end)

# ② 실측 — 모의 장부의 매매일만
rows = lab["paper"]["summary"]["daytrading_etf"]["rows"]
fw = [r["pnlPct"] for r in rows if r["action"] == "trade"]
fcum = (math.prod(1 + x / 100 for x in fw) - 1) * 100
print("② forward trades", len(fw), [round(x, 2) for x in fw], "cum", round(fcum, 2))
d = fdr.DataReader("233740", "2016-01-01")
b = [(str(i)[:10], float(r["Open"]), float(r["Close"])) for i, r in d.iterrows() if float(r["Open"]) > 0 and float(r["Close"]) > 0]


def trades(th):
    out = []
    for i in range(1, len(b) - 1):
        chg = (b[i][2] / b[i - 1][2] - 1) * 100
        if abs(chg) <= 35 and chg <= th:
            tick = 5 if b[i][2] >= 2000 else 1
            out.append((b[i][0], (b[i + 1][1] / b[i][2] - 1) * 100 - (0.03 + 2 * tick / b[i][2] * 100)))
    return out


for th in (-4.75, -3.0):
    tr = [t for t in trades(th) if not design_end or t[0] <= design_end]
    n = len(fw)
    win = sorted((math.prod(1 + x / 100 for _, x in tr[k:k + n]) - 1) * 100 for k in range(len(tr) - n + 1))
    pct = sum(1 for w in win if w <= fcum) / len(win) * 100
    print(f"② th{th}: design trades {len(tr)} · {n}-trade windows {len(win)} · p5 {win[int(0.05 * len(win))]:.2f}% · "
          f"worst {win[0]:.2f}% · forward {fcum:.2f}% is at percentile {pct:.1f}")

# ④ 매매별 복리 손익(진입일 손익부터 청산일까지)
cur, tr4 = None, []
for r in csv.DictReader(open(soxl_csv, encoding="utf-8")):
    a = r["action"]
    if a == "enter":
        cur = [r["date"], 1 + float(r["pnlPct"]) / 100]
    elif a in ("hold", "exit") and cur:
        cur[1] *= 1 + float(r["pnlPct"] or 0) / 100
        if a == "exit":
            tr4.append((cur[0], (cur[1] - 1) * 100))
            cur = None
des = [t for t in tr4 if not design_end or t[0] <= design_end]
s = sorted(x for _, x in des)
print("④ design trades", len(des), "worst5", [round(x, 1) for x in s[:5]], "p1", round(s[int(0.01 * len(s))], 2), "p5", round(s[int(0.05 * len(s))], 2))
for dt, x in (t for t in tr4 if t[0] > (design_end or "")):
    print("④ forward trade", dt, round(x, 2), "percentile", round(sum(1 for y in s if y <= x) / len(s) * 100, 2))
