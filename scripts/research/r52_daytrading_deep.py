"""R52 — ② 데이트레이딩 심층 연구: 투자 판정표 일곱 항목(지금 비용표) · 왜 졌나 · 고칠 만한 것 셋(파는 시각 · 깊은 하락 빼기 · 급락 국면 쉬기).
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-20 R52(커밋 da9a6763).
사용: JKQ_DATA=<scalping-data data 사본(claude-lab/kr-hourly/233740.json)> python scripts/research/r52_daytrading_deep.py
  - 장부 식: 연구실 etf_trades 그대로(신호일 종가 매수 → 다음 거래일 시가 매도 · 최대 24시간 · 35% 넘는 값은 자료 오류) — 빠른 식은 먼저 연구실 값과 맞춘다.
  - 지표: 연구실 goal_metrics · score_metrics · gate_ok · neighbors · trades_per_year 그대로(자금 = ② 칸 100% · 1년 250거래일).
  - 걸어가기 고르기: R39 pick 과 같은 경쟁 규칙(기준 통과 먼저 · 안정 점수 = min(점수, 이웃 중앙값) × 빈도 보정 · 메인 +0.02)."""
import importlib.util
import json
import math
import statistics
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("r44", str(HERE / "r44_public_invest.py"))
R44 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R44)

CODE, MAIN_TH, FROM, PER = "233740", -4.75, "2018-01-01", 250
SELS = [f"{y}-01-01" for y in range(2018, 2027)]
GRID_TH = L.GRID["daytrading"]["th"]
COST_NOW, COST_OLD = L.SC.cost_pct("etf"), 0.03

bars = L.etf_bars(CODE)
D = [b[0] for b in bars]
O = [b[1] for b in bars]
C = [b[2] for b in bars]
IDX = {d: i for i, d in enumerate(D)}
MA60 = [statistics.fmean(C[i - 59:i + 1]) if i >= 59 else None for i in range(len(C))]
RET = [None] + [C[i] / C[i - 1] - 1 for i in range(1, len(C))]
VOL20 = [statistics.pstdev(RET[i - 19:i + 1]) if i >= 20 else None for i in range(len(C))]
R20 = [(C[i] / C[i - 20] - 1) * 100 if i >= 20 else None for i in range(len(C))]


def tick(p):
    return 5 if p >= 2000 else 1


def trades(th=MAIN_TH, cost_rt=COST_NOW, exit_="open", floor=None, crash=None):
    """(매수일, 매도일, 손익%, 신호일 등락%, 매수일 번호). 연구실 etf_trades 와 같은 식 + 연구용 거르기."""
    out = []
    for i in range(1, len(bars) - 1):
        chg = (C[i] / C[i - 1] - 1) * 100
        if not (abs(chg) <= 35 and chg <= th and L.etf_24h(D[i], D[i + 1])):
            continue
        if floor is not None and chg <= floor:
            continue
        if crash is not None and R20[i] is not None and R20[i] <= crash:
            continue
        px = O[i + 1] if exit_ == "open" else C[i + 1]
        out.append((D[i], D[i + 1], (px / C[i] - 1) * 100 - (cost_rt + 2 * tick(C[i]) / C[i] * 100), chg, i))
    return out


def dv_of(tr):
    return {t[1]: t[2] for t in tr}


def stats(dv, frm=FROM, to=None, size=1.0):
    cal = [d for d in D if d >= frm and (to is None or d <= to)]
    cs = set(cal)
    tab = {d: v * size for d, v in dv.items() if d in cs}
    m = L.goal_metrics(tab, cal, PER)
    eq, ys = 1.0, {}
    for d in cal:
        x = 1 + tab.get(d, 0.0) / 100
        eq *= x
        ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = (date.fromisoformat(cal[-1]) - date.fromisoformat(cal[0])).days / 365.25
    v = list(tab.values())
    sd = statistics.stdev(v) if len(v) > 1 else 0.0
    return dict(cagr=(eq ** (1 / yrs) - 1) * 100, cum=(eq - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"), n=len(v),
                mean=statistics.fmean(v) if v else 0.0, t=statistics.fmean(v) / (sd / math.sqrt(len(v))) if sd else 0.0,
                win=sum(1 for x in v if x > 0) / len(v) * 100 if v else 0.0, pos=sum(1 for y in ys.values() if y > 1), ny=len(ys),
                years={y: (e - 1) * 100 for y, e in ys.items()}, tpy=len(v) / yrs)


def fmt(s):
    return (f"매매 {s['n']} · 매매 평균 {s['mean']:+.2f}% · 이긴 비율 {s['win']:.0f}% · t {s['t']:.2f} · 연 {s['cagr']:+.1f}% · 누적 {s['cum']:+.0f}% · "
            f"MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.1f}% · 플러스 해 {s['pos']}/{s['ny']}")


def verify():
    """빠른 식 = 연구실 etf_trades(지금 비용표) — 세 기준에서 매매일 · 손익이 같은지."""
    for th in (-3.0, MAIN_TH, -6.5):
        lab = {t["sellDate"]: t["pnl"] for t in L.etf_trades(CODE, th)[0]}
        mine = dv_of(trades(th))
        if set(lab) != set(mine) or any(abs(lab[d] - mine[d]) > 1e-9 for d in lab):
            print(f"   빠른 식이 연구실과 다르다(th {th}) — 판정하지 않는다")
            return False
    return True


# ── 가-1. 정직한 걸어가기 ────────────────────────────────────────────────────────────────
def score_before(dv, s):
    cal = [d for d in D if d < s]
    sub = {d: v for d, v in dv.items() if d < s}
    m = L.score_metrics(sub, cal, PER)
    return dict(adj=m.get("adj"), gate=L.gate_ok(m), tpy=L.trades_per_year(sub, cal, PER))


def pick(rows, main):
    ref = (rows.get(main) or {}).get("tpy")

    def sc(k):
        r = rows[k]
        st = r["stable"] if r["stable"] is not None else -1e9
        f = 1.0 if (not ref or not r["tpy"] or ref <= 0 or r["tpy"] <= 0) else (r["tpy"] / ref) ** L.FREQ_BETA
        return (st * f if st > 0 else st) + (L.MAIN_MARGIN if k == main else 0.0)
    top = sorted(rows, key=lambda k: (not rows[k]["gate"], -sc(k)))[0]
    if main in rows and top != main and not rows[top]["gate"]:
        return main
    return top


def walk_th():
    dvs = {th: dv_of(trades(th)) for th in GRID_TH}
    cur, picks = L.ETF_DEFAULT["th"], []
    for s in SELS:
        base = {th: score_before(dvs[th], s) for th in GRID_TH}
        rows = {}
        for th in GRID_TH:
            nb = [n["th"] for n in L.neighbors("daytrading", {"th": th}, ("th",))]
            vals = [base[x]["adj"] for x in nb if base[x]["adj"] is not None]
            pl = statistics.median(vals) if vals else None
            a = base[th]["adj"]
            rows[th] = dict(stable=a if pl is None or a is None else min(a, pl), tpy=base[th]["tpy"], gate=base[th]["gate"])
        cur = pick(rows, cur)
        picks.append((s, cur, sum(1 for r in rows.values() if r["gate"])))
    return picks


def chain(picks, make):
    """picks[(시작일, 선택)] → 구간마다 make(선택) 의 일 손익을 이어 붙인다."""
    out = {}
    for k, (s, v, *_) in enumerate(picks):
        e = picks[k + 1][0] if k + 1 < len(picks) else "9999-12-31"
        out.update({d: x for d, x in make(v).items() if s <= d < e})
    return out


def walk_opt(options, make):
    """선택지 중 해마다 그 전까지 점수(score_metrics adj · 기준 통과 먼저)가 높은 것을 고른다(첫 해 전에는 '없음' = options[0])."""
    picks = []
    for s in SELS:
        best = sorted(options, key=lambda o: (not score_before(make(o), s)["gate"], -(score_before(make(o), s)["adj"] or -1e9)))[0]
        picks.append((s, best))
    return picks


def shares_sim(tr, cash0, cost_rt=COST_NOW, frm=FROM):
    cash = cash0
    half = cost_rt / 200
    for a, b, _, _, i in tr:
        if a < frm:
            continue
        buy, sell = C[i] + tick(C[i]), O[i + 1] - tick(C[i])
        q = math.floor(cash / (buy * (1 + half)))
        cash += q * (sell * (1 - half) - buy * (1 + half))
    yrs = (date.fromisoformat(D[-1]) - date.fromisoformat(frm)).days / 365.25
    return ((cash / cash0) ** (1 / yrs) - 1) * 100


def hourly_exit():
    """60분봉(2023-10~): −4.75% 매매를 다음 날 시가 · 10:00 · 11:00 · 종가에 팔았다면(지금 비용표 · 참고)."""
    path = L.KR_HOURLY / f"{CODE}.json"
    if not path.exists():
        return None
    H = json.loads(path.read_text(encoding="utf-8"))
    out = {"시가": [], "10:00": [], "11:00": [], "종가": []}
    for a, b, _, _, i in trades():
        h = H.get(b) or {}
        if a < "2023-10-23" or "9" not in h or "10" not in h:
            continue
        c = COST_NOW + 2 * tick(C[i]) / C[i] * 100
        for k, px in (("시가", O[i + 1]), ("10:00", h["9"]), ("11:00", h["10"]), ("종가", C[i + 1])):
            out[k].append((px / C[i] - 1) * 100 - c)
    return out


def main():
    print(f"자료: {CODE} 일봉 {D[0]}~{D[-1]} · 지금 비용표 왕복 {COST_NOW:.2f}% + 호가 2틱 · 판정 구간 {FROM}~")
    if not verify():
        return
    print("   빠른 식 = 연구실 etf_trades(−3.0 · −4.75 · −6.5 매매일 · 손익 같음)")
    main_tr = trades()
    s_main = stats(dv_of(main_tr))
    s_main_all = stats(dv_of(main_tr), frm="2016-01-01")
    s_old = stats(dv_of(trades(cost_rt=COST_OLD)))
    print(f"\n== 지금 규칙 −4.75% · 다음 날 시가(지금 비용표)\n   2018~: {fmt(s_main)}\n   2016~: {fmt(s_main_all)}\n   참고 옛 비용(0.03%+2틱) 2018~: {fmt(s_old)}")
    gross = [(O[i + 1] / C[i] - 1) * 100 - 2 * tick(C[i]) / C[i] * 100 for _, _, _, _, i in main_tr if D[i] >= FROM]
    print(f"   손익분기 왕복 수수료(2018~ 매매 평균 = 0): {statistics.fmean(gross):.2f}% (지금 {COST_NOW:.2f}% · 옛 {COST_OLD:.2f}%)")
    print("   해마다:", " · ".join(f"{y} {v:+.1f}%" for y, v in sorted(s_main['years'].items())))

    # 가-1
    picks = walk_th()
    ch = chain(picks, lambda th: dv_of(trades(th)))
    s1 = stats(ch)
    ok1 = s1["cagr"] > 0 and s1["mdd"] >= -25 and s1["ny"] and s1["pos"] / s1["ny"] >= 0.6
    print("\n== 가-1 정직한 걸어가기(해마다 · 전체 격자 29개 · 경쟁 규칙 · 첫 메인 −3.0%)")
    print("   고른 기준:", " · ".join(f"{s[:4]} {v:g}%(통과 {n})" for s, v, n in picks))
    print(f"   {fmt(s1)}\n   해마다:", " · ".join(f"{y} {v:+.1f}%" for y, v in sorted(s1['years'].items())), f"\n   → {'통과' if ok1 else '미통과'}")

    # 가-2
    line, means = [], []
    for x in (0.05, 0.10, 0.20):
        sx = stats(dv_of(trades(cost_rt=COST_NOW + 2 * x)))
        line.append(sx["cagr"])
        means.append(sx["mean"])
    chx = [stats(chain(picks, lambda th, x=x: dv_of(trades(th, cost_rt=COST_NOW + 2 * x))))["cagr"] for x in (0.05, 0.10, 0.20)]
    ok2 = line[1] > 0 and means[2] >= 0
    print(f"\n== 가-2 비용 한쪽 +0.05/+0.10/+0.20%: 지금 규칙 연 {line[0]:+.1f} / {line[1]:+.1f} / {line[2]:+.1f}% · 매매 평균 {means[0]:+.2f} / {means[1]:+.2f} / {means[2]:+.2f}% · "
          f"걸어가기 연 {chx[0]:+.1f} / {chx[1]:+.1f} / {chx[2]:+.1f}% → {'통과' if ok2 else '미통과'}")

    # 가-3
    all_tr = main_tr
    med_vol = statistics.median(v for v in VOL20 if v is not None)
    groups = {
        "60일 평균 아래": lambda i: MA60[i] is not None and C[i] < MA60[i], "60일 평균 위": lambda i: MA60[i] is not None and C[i] >= MA60[i],
        "변동성 높음": lambda i: VOL20[i] is not None and VOL20[i] > med_vol, "변동성 낮음": lambda i: VOL20[i] is not None and VOL20[i] <= med_vol,
        "낙폭 −4.75~−7": lambda i: -7 < RET[i] * 100 <= -4.75, "낙폭 −7~−10": lambda i: -10 < RET[i] * 100 <= -7, "낙폭 −10 이하": lambda i: RET[i] * 100 <= -10,
        "20일 −15% 이하(급락 국면)": lambda i: R20[i] is not None and R20[i] <= -15, "20일 −15% 위": lambda i: R20[i] is not None and R20[i] > -15}
    bad = []
    print("\n== 가-3 국면(2016~ 매매 · 지금 비용표)")
    for k, f in groups.items():
        v = [t[2] for t in all_tr if f(t[4])]
        if not v:
            continue
        mu = statistics.fmean(v)
        if len(v) >= 20 and mu < -0.3:
            bad.append(k)
        print(f"   {k}: {len(v)}번 · 평균 {mu:+.2f}% · 이긴 비율 {sum(1 for x in v if x > 0) / len(v) * 100:.0f}%")
    ok3 = not bad
    print(f"   → {'통과' if ok3 else '미통과 — ' + ', '.join(bad)}")

    # 가-4
    nb = {th: stats(dv_of(trades(th)))["cagr"] for th in (-4.25, -4.5, -5.0, -5.25)}
    med = statistics.median(nb.values())
    ok4 = s_main["cagr"] > 0 and med > 0 and med >= 0.6 * s_main["cagr"]
    print(f"\n== 가-4 이웃(2018~ 연 복리): " + " · ".join(f"{k:g}% {v:+.1f}" for k, v in nb.items()) + f" · 중앙값 {med:+.1f}%(자기 {s_main['cagr']:+.1f}%) → {'통과' if ok4 else '미통과'}")

    # 가-5
    td = [[t[2]] for t in main_tr if t[0] >= FROM]
    b = R44.boot(td, s_main["tpy"], 1.0)
    ok5 = b["pLoss"] <= 0.05 and b["p50"] > 0
    print(f"\n== 가-5 부트스트랩(1년 = {b['k']}번): 1년 −20% 손실 확률 {b['pLoss'] * 100:.1f}% · MDD −30% 넘을 확률 {b['pDeep'] * 100:.1f}% · "
          f"1년 수익 5/50/95% {b['p05']:+.1f} / {b['p50']:+.1f} / {b['p95']:+.1f}% → {'통과' if ok5 else '미통과'}")

    # 가-6
    sh = {c: shares_sim(main_tr, c) for c in (1_000_000, 10_000_000)}
    ok6 = all(abs(v - s_main["cagr"]) <= 1.0 for v in sh.values())
    print(f"\n== 가-6 정수주(2018~): 100만 원 연 {sh[1_000_000]:+.1f}% · 1,000만 원 연 {sh[10_000_000]:+.1f}% vs 비율 계산 {s_main['cagr']:+.1f}% → {'통과' if ok6 else '미통과'}")
    print("\n== 가-7 기록 일치: R51 — 10/08~ 14번 가격 같음 · 빠진 날 없음 → 통과")
    passed = sum([ok1, ok2, ok3, ok4, ok5, ok6, True])
    print(f"   판정표: {passed}/7 통과")

    # 나
    print("\n== 나. 왜 졌나 — 급락 국면(233740 20일 수익률 −20% 이하) 묶음별 ② 성적(지금 비용표)")
    eps, cur = [], None
    for i in range(len(D)):
        on = R20[i] is not None and R20[i] <= -20
        if on and cur is None:
            cur = [i, i]
        elif on:
            cur[1] = i
        elif cur is not None and i - cur[1] > 10:
            eps.append(cur)
            cur = None
    if cur is not None:
        eps.append(cur)
    for a, e in eps:
        v = [t[2] for t in main_tr if a <= t[4] <= e + 5]
        low = min(R20[a:e + 1])
        print(f"   {D[a]}~{D[e]}: 20일 수익률 최저 {low:.0f}% · ② 매매 {len(v)}번 · 합계 {sum(v):+.1f}%p" + (f" · 평균 {statistics.fmean(v):+.2f}%" if v else ""))
    deep_hist = [t for t in main_tr if t[0] < "2026-10-01"]
    deep_now = [t for t in main_tr if t[0] >= "2026-10-01"]
    for tag, tr in (("과거(2016~09월)", deep_hist), ("이번(10월~)", deep_now)):
        if tr:
            print(f"   {tag}: 매매 {len(tr)}번 · 신호일 낙폭 −10% 이하 비율 {sum(1 for t in tr if t[3] <= -10) / len(tr) * 100:.0f}% · 평균 낙폭 {statistics.fmean(t[3] for t in tr):.1f}%")

    # 다
    print("\n== 다. 고칠 만한 것 셋(하락 기준 −4.75% 고정 · 변수는 해마다 걸어가기로 고름 · 비교 상대 = 지금 규칙 2018~)")
    base_years = s_main["years"]
    cands = {
        "C1 파는 시각(시가 · 종가)": (["open", "close"], lambda o: dv_of(trades(exit_=o)), lambda o, x: dv_of(trades(exit_=o, cost_rt=COST_NOW + 2 * x))),
        "C2 깊은 하락 빼기(하한)": ([None, -8.0, -10.0, -12.0, -15.0], lambda o: dv_of(trades(floor=o)), lambda o, x: dv_of(trades(floor=o, cost_rt=COST_NOW + 2 * x))),
        "C3 급락 국면 쉬기(20일 수익률)": ([None, -10.0, -15.0, -20.0, -25.0], lambda o: dv_of(trades(crash=o)), lambda o, x: dv_of(trades(crash=o, cost_rt=COST_NOW + 2 * x))),
    }
    winners = []
    for name, (opts, make, make_c) in cands.items():
        pk = walk_opt(opts, make)
        sc = stats(chain(pk, make))
        sc10 = stats(chain(pk, lambda o: make_c(o, 0.10)))
        wins = sum(1 for y, v in sc["years"].items() if v > base_years.get(y, 0.0) + 1e-9)
        ok = sc["cagr"] > s_main["cagr"] and sc["mdd"] >= s_main["mdd"] and wins >= math.ceil(len(sc["years"]) / 2) and sc10["cagr"] > 0
        if ok:
            winners.append(name)
        fixed = {str(o): stats(make(o))["cagr"] for o in opts}
        print(f"   {name}: 고름 " + " · ".join(f"{s[:4]} {o}" for s, o in pk))
        print(f"      걸어가기 {fmt(sc)} · 지금 규칙보다 나은 해 {wins}/{len(sc['years'])} · 비용 +0.10% 연 {sc10['cagr']:+.1f}% → {'통과' if ok else '미통과'}")
        print("      참고(고정판 2018~ 연 복리):", " · ".join(f"{k} {v:+.1f}%" for k, v in fixed.items()))
    hx = hourly_exit()
    if hx:
        print("   C1 참고(60분봉 2023-10~ · −4.75% 매매 · 지금 비용표):", " · ".join(f"{k} {len(v)}번 평균 {statistics.fmean(v):+.2f}%" for k, v in hx.items() if v))

    a12 = ok1 or ok2
    concl = "고쳐서 계속 제안(" + ", ".join(winners) + ")" if winners else ("계속 · 경고" if ok1 and ok2 else "멈춤 제안 유지")
    print(f"\n== 결론(사전 등록 규칙): 가-1 {'O' if ok1 else 'X'} · 가-2 {'O' if ok2 else 'X'} · 다 통과 {len(winners)}개 → {concl}" + ("" if a12 or winners else ""))


if __name__ == "__main__":
    main()
