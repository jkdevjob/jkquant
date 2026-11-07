#!/usr/bin/env python3
"""R33 ② · ④ 를 하루 안 청산 규칙으로 — 사전 등록(CLAUDE-SCALPING-RESEARCH.md R33 · 2026-11-08) 그대로 잰다.

사용자 규칙(11/08): 텐배거를 제외한 전략은 매매가 하루를 넘기면 안 된다. ② 종가 → 다음 날 시가 · ④ 최대 5거래일이 어긴다.
후보(고정): ②-G 시가 갭 −g% 이하 시가 → 종가 · ②-D 전일 −d% 이하 다음 날 시가 → 종가 · ②-A 매일 / ④-G · ④-R(RSI2<20 · 종가>200일) · ④-A.
방법: 해마다 그 전 해까지 자료로 연구실 score_metrics(adj) · gate_reason 통과한 변수만 골라 그 해에 잰다(② 2020~ · ④ 2015~). 없으면 그 해는 쉼.
판정: 검증 구간 매매일 평균 > 0 · 플러스 해 60%↑ · MDD ≥ −25% · 최악일 ≥ −15% · 매매일 ≥ 60.
참고(판정에 안 씀): 지금 메인(② 종가 −4.75% → 다음 날 시가 · ④ RSI2<30 · IBS≤0.6 · 100일 평균 · 최대 5일)의 같은 해 성적.
사용: python3 scripts/research/r33_sameday.py bars.json   (bars.json = {"233740": [[날짜, 시가, 고가, 저가, 종가], …], "SOXL": […]} · FDR)
"""
import importlib.util, json, statistics as st, sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("lab", Path(__file__).resolve().parents[1] / "claude_lab.py")
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)
B = json.load(open(sys.argv[1], encoding="utf-8"))
KR, US = B["233740"], B["SOXL"]


def kr_cost(p):                                    # ② 비용식(backtest_etf_overnight.cost_pct 와 같은 꼴)
    return 2 * 0.015 + 2 * 1 * (5 if p >= 2000 else 1) / p * 100


US_COST = 0.20                                     # ④ 왕복 비용(SOXL_MR costRoundTripPct)


def kr_series(fam, x):
    out = {}
    for i in range(2, len(KR)):
        d, o, _, _, c = KR[i]
        gap = (o / KR[i - 1][4] - 1) * 100
        prev = (KR[i - 1][4] / KR[i - 2][4] - 1) * 100
        if (fam == "G" and gap <= -x) or (fam == "D" and prev <= -x) or fam == "A":
            out[d] = (c / o - 1) * 100 - kr_cost(o)
    return out


def us_series(fam, x):
    C = [r[4] for r in US]
    out = {}
    for i in range(201, len(US)):
        d, o, _, _, c = US[i]
        gap = (o / C[i - 1] - 1) * 100
        sig = False
        if fam == "G":
            sig = gap <= -x
        elif fam == "R":
            sig = L.rsi2_at(C, i - 1, 2) < 20 and C[i - 1] > sum(C[i - 200:i]) / 200      # 전일 확정 종가로 판단(룩어헤드 없음)
        elif fam == "A":
            sig = True
        if sig:
            out[d] = (c / o - 1) * 100 - US_COST
    return out


def kr_main_ref(th=-4.75):                         # 지금 ② 메인: 종가 −4.75% 이하 → 종가 매수 → 다음 날 시가 매도(매도일에 기록)
    out = {}
    for i in range(1, len(KR) - 1):
        if (KR[i][4] / KR[i - 1][4] - 1) * 100 <= th:
            out[KR[i + 1][0]] = (KR[i + 1][1] / KR[i][4] - 1) * 100 - kr_cost(KR[i][4])
    return out


def us_main_ref():                                 # 지금 ④ 메인(g_soxl_r2lt30_ibs0.6_ma100_d5) · 원금 100%
    p = dict(L.SOXL_MR, rsiMax=30, rsiN=2, ibsMax=0.6, downDays=0, ma=100, maxHoldDays=5, size=1.0, version="ref")
    dv, _, _ = L.soxl_meanrev([tuple(r) for r in US], p)
    return dv


def metrics(dv, cal, per):
    m = L.goal_metrics(dv, cal, per)
    y = L.year_stats(dv, cal)
    return m, y


def fmt(m, y):
    return (f"매매일 {m['tradeDays']}(연 {m['tradeDaysPerYear']:.0f}) · 평균 {m['expectancyPct'] or 0:+.3f}% · 주 평균 {m['weeklyAvgPct'] or 0:+.3f}% · "
            f"누적 {m['totalPct']:+.0f}% · MDD {m['mddPct']:.1f}% · 최악일 {m['worstDayPct']:+.2f}% · t {m['tStat'] or 0:+.1f} · 플러스 해 {y.get('pos')}/{y.get('n')}")


def walk(cands, cal, start, per):
    val, picks = {}, []
    for yv in sorted({d[:4] for d in cal if d[:4] >= str(start)}):
        cut = f"{yv}-01-01"
        pc = [d for d in cal if d < cut]
        best = None
        for nm, s in cands.items():
            m = L.score_metrics({d: v for d, v in s.items() if d < cut}, pc, per)
            if L.gate_reason(m):
                continue
            if best is None or m["adj"] > best[1]:
                best = (nm, m["adj"])
        picks.append(f"{yv}:{best[0] if best else '쉼'}")
        if best:
            val.update({d: v for d, v in cands[best[0]].items() if d[:4] == yv})
    vcal = [d for d in cal if d[:4] >= str(start)]
    return val, vcal, picks


def verdict(m, y):
    ok = (m["tradeDays"] >= 60 and (m["expectancyPct"] or 0) > 0 and y.get("n") and y["pos"] / y["n"] >= 0.6
          and m["mddPct"] >= -25 and m["worstDayPct"] >= -15)
    return "통과" if ok else "탈락"


def tab(name, cal, per, start, fams, ref):
    print(f"\n════ {name} — 검증 {start}~ · 거래일 {len([d for d in cal if d[:4] >= str(start)])}")
    allc = {}
    vcal = [d for d in cal if d[:4] >= str(start)]
    for fam, xs, mk in fams:
        print(f" ─ 후보군 {fam}")
        cands = {f"{fam}{x}" if x is not None else fam: mk(x) for x in xs}
        allc.update(cands)
        for nm, s in cands.items():
            m, y = metrics({d: v for d, v in s.items() if d[:4] >= str(start)}, vcal, per)
            print(f"   {nm:>6} 고정(검증 구간): {fmt(m, y)}")
        val, vc, picks = walk(cands, cal, start, per)
        m, y = metrics(val, vc, per)
        print(f"   ▶ 시간순 재선정: {' '.join(picks)}")
        print(f"     {fmt(m, y)} → {verdict(m, y)}")
    val, vc, picks = walk(allc, cal, start, per)
    m, y = metrics(val, vc, per)
    print(f" ▶ 전체 재선정(모든 후보): {' '.join(picks)}")
    print(f"   {fmt(m, y)} → {verdict(m, y)}")
    rm, ry = metrics({d: v for d, v in ref.items() if d[:4] >= str(start)}, vcal, per)
    print(f" (참고) 지금 메인(하루 넘김) 같은 구간: {fmt(rm, ry)}")


kr_cal = [r[0] for r in KR]
us_cal = [r[0] for r in US]
tab("② KODEX 코스닥150레버리지 하루 안 청산", kr_cal, 250, 2020,
    [("G", [1, 2, 3, 4, 5], lambda x: kr_series("G", x)), ("D", [2, 3, 4.75, 6], lambda x: kr_series("D", x)), ("A", [None], lambda x: kr_series("A", x))],
    kr_main_ref())
tab("④ SOXL 하루 안 청산(미국 정규장 시가 → 종가)", us_cal, 252, 2015,
    [("G", [2, 3, 5, 7], lambda x: us_series("G", x)), ("R", [None], lambda x: us_series("R", x)), ("A", [None], lambda x: us_series("A", x))],
    us_main_ref())
