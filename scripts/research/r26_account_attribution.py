"""R26 10/1 이후 모의 계좌 손실은 어디서 났나 — 칸별 몫 나누기 (2026-11-05 아침 점검).

계기: 밤 점검이 '계좌 실측이 기대보다 낮음(z −2.3) — 규칙 점검'을 띄웠다. 어느 칸 · 어느 규칙 몫인지 먼저 나눈다.

방법: 밤 계산의 계좌 규칙 그대로 다시 합친다 — 국내 30%(①②⑤, 같은 날 여럿이면 똑같이 나눔) · 코인 30%(BTC · ETH 고정 몫 1/2) · 미국 40%(SOXL, 칸 안 전액).
날마다 칸 손익(계좌 기준 = 칸 비중 × 칸 안 손익)의 로그 합으로 몫을 나눈다. 다시 합친 누적이 실제 계좌 누적과 맞는지 먼저 확인한다.

재현: python3 scripts/research/r26_account_attribution.py <latest.json>
  (scalping-data 의 data/claude-lab/latest.json — git show origin/scalping-data:data/claude-lab/latest.json > latest.json)
"""
import json
import math
import sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
plan, ps = d["account"]["plan"], d["paper"]["summary"]


def rows(k):
    return {r["date"]: r for r in (ps.get(k) or {}).get("rows") or []}


def traded(r):
    return r and r.get("action") == "trade" and r.get("pnlPct") is not None


acc = rows("account")
kr = [rows(k) for k in ("opening_d1v2", "daytrading_etf", "close30_etf")]
coins = [rows("coin_bo_btc"), rows("coin_bo_eth")]
us = rows("us_soxl")
eq = eqa = 1.0
part = dict(kr=0.0, crypto=0.0, us=0.0)
for day in sorted(acc):
    a = [t[day]["pnlPct"] for t in kr if traded(t.get(day))]
    c = [t[day]["pnlPct"] for t in coins if traded(t.get(day))]
    v = dict(kr=plan["krWeight"] * (sum(a) / len(a) if a else 0.0),
             crypto=plan["cryptoWeight"] * plan["cryptoSize"] * (sum(c) / len(coins) if c else 0.0),
             us=plan["usWeight"] * plan["usSize"] * ((us.get(day) or {}).get("pnlPct") or 0.0))
    for k, x in v.items():
        part[k] += math.log(1 + x / 100)
    eq *= 1 + sum(v.values()) / 100
    eqa *= 1 + (acc[day]["pnlPct"] or 0) / 100
print(f"다시 합친 누적 {(eq - 1) * 100:+.2f}% · 실제 계좌 누적 {(eqa - 1) * 100:+.2f}% · {min(acc)} ~ {max(acc)}")
tot = sum(part.values())
for k, x in part.items():
    print(f"{k}: {x * 100:+.2f}%p ({x / tot * 100:.0f}%)")
