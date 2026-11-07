#!/usr/bin/env python3
"""R30 ① 코스닥150 인버스 헤지 — 실제 인버스 ETF(251340) 시가→종가와 비용으로 2018~ 다시 잰다 (2026-11-07 · 사전 등록은 R28-b).

같은 원금 기준: 헤지판 = 원금 절반 ① 메인(통과 ≥7 · 갭 ≤−3 · 깊은 3) + 절반 KODEX 코스닥150선물인버스(시가 매수 → 종가 매도).
  비용(사전 등록): 인버스 왕복 0.10%/일. 참고로 ② ETF 비용식(수수료 0.015%×2 + 1틱×2)도 같이 보인다.
  비교 대상: (가) 메인 그대로(원금 100% ①) (나) 원금 절반만 ①(나머지 현금) (다) 헤지판.
판정(사전 등록): 연구실 같은 함수(goal_metrics · score_metrics · gate_reason)로 손실 기준 · 매매일 · 해마다 일관성을 지키고 점수(주 평균 · 줄여 당김)가 (가) 이상이면 통과.
사용: python3 scripts/research/r30_opening_hedge.py signals.csv decisions.csv etf.json
  etf.json = {"251340": {날짜: {o, c}}} (FDR · 2018~).
"""
import csv, importlib.util, json, statistics as st, sys
from pathlib import Path

SIG, DEC, ETF = sys.argv[1:4]
spec = importlib.util.spec_from_file_location("lab", Path(__file__).resolve().parents[1] / "claude_lab.py")
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)
MAIN = dict(minQ=7, topK=3, gapMax=-3.0)                 # 경쟁군 메인(opening_d1v2 · 2026-11 기준)
INV = "251340"
PRE_COST = 0.10                                          # 사전 등록 비용(왕복 %)


def tick(p):
    return 5 if p >= 2000 else 1


def etf_cost(p):                                         # ② ETF 비용식과 같은 꼴(backtest_etf_overnight.cost_pct)
    return 2 * 0.015 + 2 * 1 * tick(p) / p * 100


q = {r["date"]: int(r.get("rsiPassed") or 0) for r in csv.DictReader(open(DEC, encoding="utf-8"))}
cal = sorted(q)
by = {}
for r in csv.DictReader(open(SIG, encoding="utf-8")):
    if r.get("variant", "baseline") == "baseline":
        by.setdefault(r["date"], []).append(r)
main = {}
for d, rs in by.items():
    if q.get(d, 0) < MAIN["minQ"]:
        continue
    s = [r for r in sorted(rs, key=lambda r: (float(r["gapPct"]), float(r["pnl"]))) if float(r["gapPct"]) <= MAIN["gapMax"]][: MAIN["topK"]]
    if s:
        main[d] = st.fmean(float(r["pnl"]) for r in s)
inv = json.load(open(ETF, encoding="utf-8"))[INV]
miss = [d for d in main if not (inv.get(d) and inv[d].get("o"))]
oc = {d: (inv[d]["c"] / inv[d]["o"] - 1) * 100 for d in main if d not in miss}
half = {d: main[d] / 2 for d in main}
hedge_pre = {d: main[d] / 2 + (oc[d] - PRE_COST) / 2 for d in oc}
hedge_etf = {d: main[d] / 2 + (oc[d] - etf_cost(inv[d]["o"])) / 2 for d in oc}
print(f"═ ① 메인 매매일 {len(main)}일(2018~) · 인버스 시세 없는 날 {len(miss)}일 {miss[:5]}")
print(f"  인버스 시가→종가(매매일): 평균 {st.fmean(oc.values()):+.3f}% · 승률 {sum(1 for v in oc.values() if v > 0) / len(oc) * 100:.0f}% · ② 비용식 평균 {st.fmean(etf_cost(inv[d]['o']) for d in oc):.3f}%")
xs, ys = [oc[d] for d in oc], [main[d] for d in oc]
print(f"  ① 와 인버스 상관 {st.correlation(xs, ys):+.2f} (음수면 헤지가 된다)")


def show(name, dv):
    m = L.score_metrics(dv, cal, 250)
    f = m["full"]
    y = m["years"]
    g = L.gate_reason(m) or "통과"
    print(f"  {name}: 점수(adj) {m['adj']:+.4f} · 주 평균 {f['weeklyAvgPct']:+.4f}% · 누적 {f['totalPct']:+.1f}% · MDD {f['mddPct']:.1f}% · 최악일 {f['worstDayPct']:+.2f}% · 매매일 평균 {f['expectancyPct']:+.2f}% · t {f['tStat'] or 0:+.1f} · 플러스 해 {y.get('pos')}/{y.get('n')} · 게이트 {g}")
    return m


print("═ 같은 원금 비교(연구실 goal_metrics · score_metrics · gate_reason)")
ma = show("(가) 메인 그대로(① 100%)", main)
mb = show("(나) ① 50% · 현금 50%", half)
mc = show("(다) 헤지판 ① 50% · 인버스 50% · 비용 0.10%(사전 등록)", hedge_pre)
md = show("(다') 헤지판 · ② 비용식(참고)", hedge_etf)
print("═ 해별 매매일 평균(가 / 나 / 다)")
for yv in sorted({d[:4] for d in main}):
    ds = [d for d in oc if d[:4] == yv]
    print(f"  {yv}: {len(ds)}일 · {st.fmean(main[d] for d in ds):+.2f} / {st.fmean(half[d] for d in ds):+.2f} / {st.fmean(hedge_pre[d] for d in ds):+.2f}")
print("═ 나쁜 날(가 기준 하위 5일): 가 → 다")
for d in sorted(oc, key=lambda d: main[d])[:5]:
    print(f"  {d}: {main[d]:+.2f}% → {hedge_pre[d]:+.2f}% (인버스 {oc[d]:+.2f}%)")
verdict = "통과" if (not L.gate_reason(mc)) and mc["adj"] >= ma["adj"] else "기각"
print(f"═ 판정(사전 등록 — 게이트 + 점수 ≥ 메인): {verdict} · 점수 {mc['adj']:+.4f} vs 메인 {ma['adj']:+.4f} · (나) 대비 {'헤지판이 낫다' if mc['adj'] > mb['adj'] else '헤지판이 못하다'}")
