"""R44 — 유명 매매법 통과 4개 투자 판정(발표 규칙 고정판) · ④ 와 겹침. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-13 R44(커밋 c5f282ff).
사용: JKQ_DATA=<scalping-data data 사본> python scripts/research/r44_public_invest.py
  - 일봉 · 장부는 R43 과 같다(FinanceDataReader · 종가 신호 → 다음 날 시가 체결 · 비용 왕복 0.20%).
  - 자금 기준: 1배(SPY · QQQ) 100% · 3배(SOXL · TQQQ) 50%(매일 그 비율로 다시 맞춘 비율 계산) — 6번에서 실제 보유 방식과 견준다."""
import bisect
import importlib.util
import math
import random
import statistics
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, str(HERE / file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R43 = _load("r43", "r43_public_methods.py")
R39 = _load("r39", "r39_soxl_invest.py")
L = R43.L
FROM, SHARES_FROM = "2010-01-01", "2022-01-01"
COST = 0.20


def d7(rows, cost, w=7, n=200):
    def ent(i, C):
        m = R43.sma(C, i, n)
        return m is not None and i >= w - 1 and C[i] > m and C[i] <= min(C[i - w + 1:i + 1])

    def ex(i, C):
        return i >= w - 1 and C[i] >= max(C[i - w + 1:i + 1])
    return R43.swing(rows, cost, ent, ex)


def rsi2(rows, cost, th=10, xm=5):
    C0 = [r[4] for r in rows]
    rsi = [L.rsi2_at(C0, i, 2) if i >= 2 else None for i in range(len(C0))]

    def ent(i, C):
        m = R43.sma(C, i, 200)
        return m is not None and C[i] > m and rsi[i] is not None and rsi[i] < th

    def ex(i, C):
        m = R43.sma(C, i, xm)
        return m is not None and C[i] > m
    return R43.swing(rows, cost, ent, ex)


CANDS = [("Double 7s SPY", "SPY", 1.0, d7, dict()), ("Double 7s QQQ", "QQQ", 1.0, d7, dict()),
         ("Double 7s SOXL", "SOXL", 0.5, d7, dict()), ("RSI2 TQQQ", "TQQQ", 0.5, rsi2, dict())]
NEIGH = {d7: [dict(w=5), dict(w=6), dict(w=8), dict(w=10), dict(n=150), dict(n=250)],
         rsi2: [dict(th=5), dict(th=15), dict(xm=3), dict(xm=10)]}


def stats(rows, dv, trades, size, frm=FROM):
    cal = [r[0] for r in rows if r[0] >= frm]
    tab = {d: v * size for d, v in dv.items() if d >= frm}
    m = L.goal_metrics(tab, cal, 252)
    eq, ys = 1.0, {}
    for d in cal:
        x = 1 + tab.get(d, 0.0) / 100
        eq *= x
        ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = (date.fromisoformat(cal[-1]) - date.fromisoformat(cal[0])).days / 365.25
    tr = [t[2] for t in trades if t[0] >= frm]
    sd = statistics.stdev(tr) if len(tr) > 1 else 0
    tyears = {t[1][:4] for t in trades if t[0] >= frm}
    return dict(cagr=(eq ** (1 / yrs) - 1) * 100, cum=(eq - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"), n=len(tr),
                mean=statistics.fmean(tr) if tr else 0, t=(statistics.fmean(tr) / (sd / math.sqrt(len(tr)))) if sd else 0,
                pos=sum(1 for y in tyears if ys.get(y, 1) > 1), ny=len(tyears), tpy=len(tr) / yrs)


def boot(trades_daily, tpy, size, n=10000, seed=44):
    rnd = random.Random(seed)
    k = max(1, round(tpy))
    loss = deep = 0
    rets = []
    for _ in range(n):
        eq, peak, mdd = 1.0, 1.0, 0.0
        for _ in range(k):
            for v in rnd.choice(trades_daily):
                eq *= 1 + v * size / 100
                peak = max(peak, eq)
                mdd = min(mdd, eq / peak - 1)
        rets.append((eq - 1) * 100)
        loss += eq - 1 < -0.20
        deep += mdd < -0.30
    rets.sort()
    return dict(pLoss=loss / n, pDeep=deep / n, p05=rets[int(n * 0.05)], p50=rets[n // 2], p95=rets[int(n * 0.95)], k=k)


def trade_dailies(dv, trades):
    """매매마다 그 기간의 일 손익 목록(부트스트랩용)."""
    ds = sorted(dv)
    out = []
    for a, b, _ in trades:
        i, j = bisect.bisect_left(ds, a), bisect.bisect_right(ds, b)
        seg = [dv[d] for d in ds[i:j]]
        if seg:
            out.append(seg)
    return out


def shares(rows, trades, size, cash0, frm=SHARES_FROM, side=COST / 200):
    """산 주식을 그대로 들고 있는 정수주 모의 — 매수일 시가에 자산 × size 만큼 · 매도일 시가(월말은 종가 없음 · 스윙만)."""
    idx = {r[0]: k for k, r in enumerate(rows)}
    cash, sh = cash0, 0
    for a, b, _ in trades:
        if a < frm or a not in idx or b not in idx:
            continue
        o_in, o_out = rows[idx[a]][1], rows[idx[b]][1]
        q = math.floor(cash * size / (o_in * (1 + side)))
        cash -= q * o_in * (1 + side)
        cash += q * o_out * (1 - side)
    return (cash / cash0 - 1) * 100


def vol_regimes(rows, trades, dv, size):
    C = [r[4] for r in rows]
    D = [r[0] for r in rows]
    idx = {d: k for k, d in enumerate(D)}
    vol = [statistics.pstdev([C[j] / C[j - 1] - 1 for j in range(i - 19, i + 1)]) if i >= 20 else None for i in range(len(C))]
    first = bisect.bisect_left(D, FROM)
    med = statistics.median(v for v in vol[first:] if v is not None)
    out = {}
    for a, b, r in trades:
        if a < FROM or a not in idx:
            continue
        si = idx[a] - 1
        key = "변동성 높음" if vol[si] is not None and vol[si] > med else "변동성 낮음"
        out.setdefault(key, []).append(r * size)
    return {k: (len(v), statistics.fmean(v)) for k, v in out.items()}


def main():
    data = {s: R43.load_fdr(s, "1993-01-01") for s in ("SPY", "QQQ", "SOXL", "TQQQ")}
    soxl_rows = [(d, *R39.SX[d]) for d in sorted(R39.SX)]
    g4 = R39.grid()
    d4 = R39.fast_dv(g4["g_soxl_norsi_ibs0.6_dn1_ma50_d3"])[0]                 # ④ 11/14 메인(칸 100%)
    verdicts = []
    for name, sym, size, fn, kw in CANDS:
        rows = data[sym]
        trades, dv = fn(rows, COST, **kw)
        s = stats(rows, dv, trades, size)
        s100 = stats(rows, dv, trades, 1.0)
        print(f"\n== {name} (자금 {size:.0%}) · 자료 {rows[0][0]}~{rows[-1][0]}")
        print(f"   1. 2010~: 매매 {s['n']}번(연 {s['tpy']:.1f}) · 평균 {s['mean']:+.2f}%(100%) · t {s['t']:.1f} · 연 복리 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · "
              f"최악일 {s['worst']:.1f}% · 플러스 해 {s['pos']}/{s['ny']} · (100%: 연 {s100['cagr']:+.1f}% · MDD {s100['mdd']:.1f}%)")
        ok1 = s["mean"] > 0 and s["t"] >= 2.0 and s["ny"] and s["pos"] / s["ny"] >= 0.6 and s["mdd"] >= -25
        line, means = [], []
        for x in (0.05, 0.10, 0.20):
            tr2, dv2 = fn(rows, COST + 2 * x, **kw)
            s2 = stats(rows, dv2, tr2, size)
            line.append(s2["cagr"])
            means.append(s2["mean"])
        ok2 = line[1] > 0 and means[2] >= 0
        print(f"   2. 비용 한쪽 +0.05/+0.10/+0.20%: 연 복리 {line[0]:+.1f} / {line[1]:+.1f} / {line[2]:+.1f}% · 매매 평균 {means[0]:+.2f} / {means[1]:+.2f} / {means[2]:+.2f}% → {'통과' if ok2 else '미통과'}")
        rg = vol_regimes(rows, trades, dv, size)
        bad = [k for k, (n, a) in rg.items() if n >= 20 and a < -0.3]
        ok3 = not bad
        print("   3. 국면:", " · ".join(f"{k} {n}번 {a:+.2f}%" for k, (n, a) in sorted(rg.items())), "→", "문제 없음" if ok3 else f"문제 {bad}")
        nb = []
        for kw2 in NEIGH[fn]:
            trn, dvn = fn(rows, COST, **dict(kw, **kw2))
            nb.append((kw2, stats(rows, dvn, trn, size)["cagr"]))
        med = statistics.median(x for _, x in nb)
        ok4 = s["cagr"] > 0 and med >= 0.6 * s["cagr"]
        print(f"   4. 이웃 연 복리 중앙값 {med:+.1f}% (자기 {s['cagr']:+.1f}% · 비 {med / s['cagr'] if s['cagr'] else float('nan'):.2f}) →", "통과" if ok4 else "미통과",
              "·", " · ".join(f"{list(k.items())[0][0]}={list(k.items())[0][1]} {v:+.1f}" for k, v in nb))
        td = trade_dailies({d: v for d, v in dv.items() if d >= FROM}, [t for t in trades if t[0] >= FROM])
        b = boot(td, s["tpy"], size)
        ok5 = b["pLoss"] <= 0.10 and b["pDeep"] <= 0.10
        print(f"   5. 부트스트랩 1년({b['k']}번): −20% 손실 확률 {b['pLoss'] * 100:.1f}% · MDD −30% {b['pDeep'] * 100:.1f}% · 1년 5/50/95% = {b['p05']:+.1f} / {b['p50']:+.1f} / {b['p95']:+.1f}% →",
              "통과" if ok5 else "미통과")
        pct = stats(rows, dv, trades, size, frm=SHARES_FROM)["cum"]
        sh = [shares(rows, trades, size, c) for c in (10000, 100000)]
        ok6 = all(abs(x - pct) <= 3 for x in sh)
        print(f"   6. 2022~ 정수주 1만$ {sh[0]:+.1f}% · 10만$ {sh[1]:+.1f}% vs 비율 계산 {pct:+.1f}% →", "문제 없음" if ok6 else "문제")
        held = {d for d in dv if d >= "2016-01-01"}
        h4 = {d for d in d4 if d >= "2016-01-01"}
        cal = sorted(d for d in {r[0] for r in rows} | {r[0] for r in soxl_rows} if d >= "2016-01-01")
        x = [dv.get(d, 0.0) for d in cal]
        y = [d4.get(d, 0.0) for d in cal]
        mx, my = statistics.fmean(x), statistics.fmean(y)
        cor = sum((a - mx) * (b_ - my) for a, b_ in zip(x, y)) / math.sqrt(sum((a - mx) ** 2 for a in x) * sum((b_ - my) ** 2 for b_ in y))
        mix = {d: 0.5 * dv.get(d, 0.0) + 0.5 * d4.get(d, 0.0) for d in cal}          # 같은 자금을 반반(둘 다 칸 전액 기준)
        m4 = L.goal_metrics({d: v for d, v in d4.items() if d >= "2016-01-01"}, cal, 252)["mddPct"]
        mc = L.goal_metrics({d: v for d, v in dv.items() if d >= "2016-01-01"}, cal, 252)["mddPct"]
        mm = L.goal_metrics(mix, cal, 252)["mddPct"]
        print(f"   ④ 와 겹침(2016~): 보유일 {len(held)}일 중 ④ 와 같은 날 {len(held & h4)}일({len(held & h4) / max(1, len(held)) * 100:.0f}%) · 일 손익 상관 {cor:+.2f} · "
              f"MDD(칸 전액) ④ {m4:.1f}% · 이것 {mc:.1f}% · 반반 {mm:.1f}%")
        v = ok1 and ok2 and ok4 and ok5 and ok3 and ok6
        verdicts.append((name, v, [ok1, ok2, ok3, ok4, ok5, ok6]))
        print(f"   → 판정: " + " · ".join(f"{i + 1} {'O' if o else 'X'}" for i, o in enumerate([ok1, ok2, ok3, ok4, ok5, ok6])) + " · 7 전향 검증 대상 → " + ("판정표 통과" if v else "보류"))
    print("\n== 요약:", " / ".join(f"{n} {'통과' if v else '보류'}" for n, v, _ in verdicts))


if __name__ == "__main__":
    main()
