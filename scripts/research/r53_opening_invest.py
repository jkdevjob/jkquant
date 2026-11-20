"""R53 — ① 시초가 투자 판정(지금 비용표 · 판정표 일곱 항목).
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-21 R53(커밋 9ac526f3).
사용: JKQ_DATA=<scalping-data data 사본(opening-gapdown-research · claude-paper/opening_d1v2)> python scripts/research/r53_opening_invest.py
  - 장부: 연구실 d1_series · d1_days 그대로(연구 신호 행의 pnl = 시가 매수 → 종가 매도 · 행마다 지금 비용표 frictionPct).
  - 지표: 연구실 goal_metrics · score_metrics · gate_ok · neighbors · trades_per_year · 걸어가기 고르기는 R39 pick 과 같은 경쟁 규칙."""
import importlib.util
import itertools
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

MAIN = dict(minQ=7, topK=3, gapMax=-3.0)
FROM, PER = "2019-01-01", 250
SELS = [f"{y}-01-01" for y in range(2019, 2027)]
G = L.GRID["opening"]
COMBOS = [dict(minQ=a, topK=b, gapMax=c) for a, b, c in itertools.product(G["minQ"], G["topK"], G["gapMax"])]
key = lambda p: (p["minQ"], p["topK"], p["gapMax"])  # noqa: E731
Q = {r["date"]: int(r.get("rsiPassed") or 0) for r in L.read_csv(L.DATA / "opening-gapdown-research/decisions.csv")}
CACHE = {}


def series(p):
    k = key(p)
    if k not in CACHE:
        CACHE[k] = L.d1_series(p)
    return CACHE[k]


def stats(dv, cal, frm=FROM, size=1.0):
    cal = [d for d in cal if d >= frm]
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
    return (f"매매일 {s['n']} · 날 평균 {s['mean']:+.2f}% · 이긴 비율 {s['win']:.0f}% · t {s['t']:.2f} · 연 {s['cagr']:+.1f}% · 누적 {s['cum']:+.0f}% · "
            f"MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.1f}% · 플러스 해 {s['pos']}/{s['ny']}")


def score_before(dv, cal, s):
    c = [d for d in cal if d < s]
    sub = {d: v for d, v in dv.items() if d < s}
    m = L.score_metrics(sub, c, PER)
    return dict(adj=m.get("adj"), gate=L.gate_ok(m), tpy=L.trades_per_year(sub, c, PER))


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


def nb_keys(p):
    out = []
    for n in L.neighbors("opening", p, L.PLATEAU_KEYS["opening"]):
        out.append(key(n))
    return out


def walk():
    cur, picks = key(L.D1_DEFAULT), []
    for s in SELS:
        base = {}
        for p in COMBOS:
            dv, cal = series(p)
            base[key(p)] = score_before(dv, cal, s)
        rows = {}
        for p in COMBOS:
            k = key(p)
            vals = [base[n]["adj"] for n in nb_keys(p) if n in base and base[n]["adj"] is not None]
            pl = statistics.median(vals) if vals else None
            a = base[k]["adj"]
            rows[k] = dict(stable=a if pl is None or a is None else min(a, pl), tpy=base[k]["tpy"], gate=base[k]["gate"])
        cur = pick(rows, cur)
        picks.append((s, cur, sum(1 for r in rows.values() if r["gate"])))
    return picks


def chain(picks, extra=0.0):
    out, cal_all = {}, None
    for k, (s, v, _) in enumerate(picks):
        e = picks[k + 1][0] if k + 1 < len(picks) else "9999-12-31"
        dv, cal = series(dict(minQ=v[0], topK=v[1], gapMax=v[2]))
        cal_all = cal
        out.update({d: x - 2 * extra for d, x in dv.items() if s <= d < e})
    return out, cal_all


def main():
    dv, cal = series(MAIN)
    print(f"자료: 연구 신호 {cal[0]}~{cal[-1]} · 거래일 {len(cal)} · 메인 {key(MAIN)} · 판정 구간 {FROM}~")
    days, _ = L.d1_days(MAIN)
    fr = [float(r["frictionPct"]) for rs in days.values() for r in rs if r.get("frictionPct")]
    print(f"   행마다 비용(frictionPct) 평균 {statistics.fmean(fr):.2f}% · 최소 {min(fr):.2f} · 최대 {max(fr):.2f}")
    s0 = stats(dv, cal)
    s_all = stats(dv, cal, frm=cal[0])
    print(f"\n== 메인 고정판\n   {FROM}~: {fmt(s0)}\n   {cal[0]}~: {fmt(s_all)}")
    print("   해마다:", " · ".join(f"{y} {v:+.1f}%" for y, v in sorted(s0['years'].items())))

    picks = walk()
    ch, chcal = chain(picks)
    s1 = stats(ch, chcal)
    ok1 = s1["cagr"] > 0 and s1["mdd"] >= -25 and s1["ny"] and s1["pos"] / s1["ny"] >= 0.6
    print("\n== 1. 정직한 걸어가기(해마다 · 격자 180개 · 경쟁 규칙 · 첫 메인 5·3·없음)")
    print("   고름:", " · ".join(f"{s[:4]} {v}(통과 {n})" for s, v, n in picks))
    print(f"   {fmt(s1)}\n   해마다:", " · ".join(f"{y} {v:+.1f}%" for y, v in sorted(s1['years'].items())), f"\n   → {'통과' if ok1 else '미통과'}")

    line, means, chl = [], [], []
    for x in (0.05, 0.10, 0.20):
        sx = stats({d: v - 2 * x for d, v in dv.items()}, cal)
        line.append(sx["cagr"])
        means.append(sx["mean"])
        chl.append(stats(*chain(picks, x))["cagr"])
    ok2 = line[1] > 0 and means[2] >= 0
    print(f"\n== 2. 비용 한쪽 +0.05/+0.10/+0.20%: 메인 연 {line[0]:+.1f} / {line[1]:+.1f} / {line[2]:+.1f}% · 날 평균 {means[0]:+.2f} / {means[1]:+.2f} / {means[2]:+.2f}% · "
          f"걸어가기 연 {chl[0]:+.1f} / {chl[1]:+.1f} / {chl[2]:+.1f}% → {'통과' if ok2 else '미통과'}")

    bars = L.etf_bars("233740")
    BD = [b[0] for b in bars]
    BC = [b[2] for b in bars]
    import bisect
    ma60 = [statistics.fmean(BC[i - 59:i + 1]) if i >= 59 else None for i in range(len(BC))]
    ret = [None] + [BC[i] / BC[i - 1] - 1 for i in range(1, len(BC))]
    vol = [statistics.pstdev(ret[i - 19:i + 1]) if i >= 20 else None for i in range(len(BC))]
    medv = statistics.median(v for v in vol if v is not None)

    def prev_i(d):
        j = bisect.bisect_left(BD, d) - 1
        return j if j >= 0 else None
    grp = {"60일 평균 아래": [], "60일 평균 위": [], "변동성 높음": [], "변동성 낮음": [], "통과 7~9": [], "통과 10~14": [], "통과 15↑": []}
    for d, v in dv.items():
        if d < cal[0]:
            continue
        j = prev_i(d)
        if j is not None and ma60[j] is not None:
            grp["60일 평균 아래" if BC[j] < ma60[j] else "60일 평균 위"].append(v)
        if j is not None and vol[j] is not None:
            grp["변동성 높음" if vol[j] > medv else "변동성 낮음"].append(v)
        q = Q.get(d, 0)
        grp["통과 7~9" if q <= 9 else ("통과 10~14" if q <= 14 else "통과 15↑")].append(v)
    bad = [k for k, v in grp.items() if len(v) >= 20 and statistics.fmean(v) < -0.3]
    ok3 = not bad
    print("\n== 3. 국면(전 기간 · 신호 전날 233740 기준):", " · ".join(f"{k} {len(v)}일 {statistics.fmean(v):+.2f}%" for k, v in grp.items() if v),
          f"→ {'통과' if ok3 else '미통과 — ' + ', '.join(bad)}")

    nbs = {}
    for n in L.neighbors("opening", MAIN, L.PLATEAU_KEYS["opening"]):
        d2, c2 = series(n)
        nbs[key(n)] = stats(d2, c2)["cagr"]
    med = statistics.median(nbs.values())
    ok4 = s0["cagr"] > 0 and med > 0 and med >= 0.6 * s0["cagr"]
    print(f"\n== 4. 이웃({FROM}~ 연 복리):", " · ".join(f"{k} {v:+.1f}" for k, v in nbs.items()), f"· 중앙값 {med:+.1f}%(자기 {s0['cagr']:+.1f}%) → {'통과' if ok4 else '미통과'}")

    td = [[v] for d, v in dv.items() if d >= FROM]
    b = R44.boot(td, s0["tpy"], 1.0)
    ok5 = b["pLoss"] <= 0.05 and b["p50"] > 0
    print(f"\n== 5. 부트스트랩(1년 = {b['k']}일): 1년 −20% 손실 확률 {b['pLoss'] * 100:.1f}% · MDD −30% 넘을 확률 {b['pDeep'] * 100:.1f}% · "
          f"1년 수익 5/50/95% {b['p05']:+.1f} / {b['p50']:+.1f} / {b['p95']:+.1f}% → {'통과' if ok5 else '미통과'}")

    def shares(cash0):
        cash = cash0
        for d in sorted(days):
            if d < FROM:
                continue
            rs = days[d]
            alloc = cash / len(rs)
            pnl = 0.0
            for r in rs:
                e, x, f = float(r["entryPrice"]), float(r["exitPrice"]), float(r["frictionPct"])
                q = math.floor(alloc / e)
                pnl += q * (x - e) - q * e * f / 100
            cash += pnl
        yrs = (date.fromisoformat(cal[-1]) - date.fromisoformat(FROM)).days / 365.25
        return ((cash / cash0) ** (1 / yrs) - 1) * 100
    sh = {c: shares(c) for c in (1_000_000, 10_000_000)}
    ok6 = all(abs(v - s0["cagr"]) <= 1.0 for v in sh.values())
    print(f"\n== 6. 정수주({FROM}~): 100만 원 연 {sh[1_000_000]:+.1f}% · 1,000만 원 연 {sh[10_000_000]:+.1f}% vs 비율 계산 {s0['cagr']:+.1f}% → {'통과' if ok6 else '미통과'}")

    same = diff = 0
    notes = []
    for f in sorted((L.DATA / "claude-paper" / "opening_d1v2").glob("*.json")):
        j = json.loads(f.read_text(encoding="utf-8"))
        if j.get("action") != "trade" or j.get("strategyVersion") != "g_open_q7_k3_gap3":
            continue
        live = sorted(t.get("code") for t in j.get("trades") or [])
        res = sorted(r["code"] for r in days.get(j["date"], []))
        if live == res:
            same += 1
        else:
            diff += 1
            notes.append(f"{j['date']} 장부 {live} · 연구 {res}")
        lp = j.get("pnlPct")
        rp = dv.get(j["date"])
        notes.append(f"   {j['date']} 장부 {lp:+.2f}%({(j.get('trades') or [{}])[0].get('exitTime', '')}) · 연구 {('%+.2f%%' % rp) if rp is not None else '없음'}(종가)")
    ok7 = diff == 0 and same > 0
    print(f"\n== 7. 기록 일치(지금 메인 판 모의 장부): 종목 같은 날 {same} · 다른 날 {diff} → {'통과' if ok7 else '미통과'}")
    for n in notes[:30]:
        print("  ", n)
    passed = sum([ok1, ok2, ok3, ok4, ok5, ok6, ok7])
    print(f"\n== 판정표 {passed}/7 · 1 {'O' if ok1 else 'X'} · 2 {'O' if ok2 else 'X'} → {'전향 확인 후보(따로 사전 등록)' if ok1 and ok2 else '기록만'}")


if __name__ == "__main__":
    main()
