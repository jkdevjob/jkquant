"""R39 — ④ SOXL 과매도 반등 투자 판정. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-12 R39(커밋 03acb0d6).
사용: JKQ_DATA=<scalping-data data 사본(claude-lab/main-config.json · soxl-mr-decisions.csv 포함)> python scripts/research/r39_soxl_invest.py
  - 일봉: 연구실 fetch_us("SOXL")(FDR) 그대로. 전략 식: 연구실 soxl_meanrev 와 같은 식을 빠르게 다시 짠 fast_dv —
    무작위 40조합에서 연구실 soxl_series 일 손익과 모두 같아야(±1e-9) 계산을 이어 간다.
  - 자금 50%(tabSize 0.5 · 경쟁 계산 기준)로 판정하고 100% 는 참고로 같이 적는다. 비용 기본 왕복 0.20%(연구실 SOXL_MR)."""
import bisect
import csv
import itertools
import math
import os
import random
import statistics
import sys
from datetime import date
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

FROM = "2016-01-01"
MAIN = "g_soxl_r2lt30_ibs0.6_ma100_d5"
CAND = "g_soxl_norsi_ibs0.6_dn1_ma50_d3"
TAB = 0.5
BASE_COST = L.SOXL_MR["costRoundTripPct"]
PER = 252

# ── 자료 · 특징 ─────────────────────────────────────────────────────────────────────────
SX = L.fetch_us(L.SOXL_MR["trade"])
SROWS = [(d, *SX[d]) for d in sorted(SX)]
D = [r[0] for r in SROWS]
O, H, LW, C = [r[1] for r in SROWS], [r[2] for r in SROWS], [r[3] for r in SROWS], [r[4] for r in SROWS]
N = len(D)
RSI = {rn: [L.rsi2_at(C, i, rn) if i >= rn else None for i in range(N)] for rn in (2, 3, 4)}
MA = {n: [sum(C[i - n + 1:i + 1]) / n if i >= n - 1 else None for i in range(N)] for n in (50, 100, 150, 200)}
IBS = [(C[i] - LW[i]) / (H[i] - LW[i]) if H[i] > LW[i] else 0.5 for i in range(N)]
DOWN = []
for i in range(N):
    k = 0
    while k < i and C[i - k] < C[i - k - 1]:
        k += 1
    DOWN.append(k)


def fast_dv(p, cost_rt=BASE_COST):
    """연구실 soxl_meanrev 의 일 손익(자금 100%)과 같은 식. 돌려줌: (일 손익 dict, 매수일 목록, 매매 목록[(매수 i, [일 손익…])])."""
    n, rn, half, mh = p["ma"], int(p.get("rsiN") or 2), cost_rt / 2, p["maxHoldDays"]
    R, M = RSI[rn], (MA[n] if n else None)
    dv, entries, trades = {}, [], []
    pos = pending = None
    for i in range(max(n, rn + 1), N):
        if pending == "sell" and pos:
            v = (O[i] / C[i - 1] - 1) * 100 - half
            dv[D[i]] = v
            pos[2].append(v)
            trades.append((pos[0], pos[2]))
            pos = None
        elif pending == "buy" and not pos:
            v = (C[i] / O[i] - 1) * 100 - half
            dv[D[i]] = v
            pos = [i, 1, [v]]
            entries.append(D[i])
        elif pos:
            pos[1] += 1
            v = (C[i] / C[i - 1] - 1) * 100
            dv[D[i]] = v
            pos[2].append(v)
        pending = None
        if pos:
            if C[i] > C[i - 1] or pos[1] >= mh:
                pending = "sell"
        elif L.soxl_signal(p, R[i], IBS[i], DOWN[i]) and (M is None or C[i] > M[i]):
            pending = "buy"
    if pos:
        trades.append((pos[0], pos[2]))                  # 아직 들고 있는 매매(마지막 날까지)
    return dv, entries, trades


# ── 격자 ──────────────────────────────────────────────────────────────────────────────
def grid():
    keys = list(L.GRID["soxl"])
    out = {}
    for vals in itertools.product(*[L.GRID["soxl"][k] for k in keys]):
        try:
            p = L._canon("soxl", dict(zip(keys, vals), tabSize=TAB))
        except (ValueError, KeyError, TypeError):
            continue
        v = L.gen_version("soxl", p)
        out.setdefault(v, p)
    return out


def verify(G, k=40):
    rnd = random.Random(39)
    picks = rnd.sample(sorted(G), k) + [MAIN, CAND]
    bad = 0
    for v in picks:
        p = G[v]
        ref = L.soxl_series(dict(p, version=v), SROWS)[1]
        got = fast_dv(p)[0]
        if set(ref) != set(got) or any(abs(ref[d] - got[d]) > 1e-9 for d in ref):
            bad += 1
            print("  다름:", v, len(ref), len(got))
    print(f"검증: 연구실 soxl_series 와 일 손익 비교 {len(picks)}조합 · 다름 {bad}")
    return bad == 0


# ── 날짜별 경쟁 값(병렬) ──────────────────────────────────────────────────────────────
SELS = [f"{y}-01-01" for y in range(2016, 2027)]
G_ALL = {}


def _eval(v):
    p = G_ALL[v]
    dv, entries, _ = fast_dv(p)
    items = sorted(dv.items())
    ds = [d for d, _ in items]
    out = {}
    for s in SELS:
        k = bisect.bisect_left(ds, s)
        cut = {d: x * TAB for d, x in items[:k]}
        cal = D[:bisect.bisect_left(D, s)]
        m = L.score_metrics(cut, cal, PER)
        ne = bisect.bisect_left(entries, s)
        out[s] = dict(adj=m.get("adj"), gate=L.gate_ok(m), tpy=L.trades_per_year(cut, cal, PER, ne))
    return v, out


def table(G):
    G_ALL.update(G)
    with Pool(os.cpu_count() or 2) as pool:
        res = dict(pool.map(_eval, sorted(G), chunksize=64))
    return res


NBV = {}


def nb_versions(G):
    for v, p in G.items():
        out = []
        for nb in L.neighbors("soxl", p, L.PLATEAU_KEYS["soxl"]):
            try:
                out.append(L.gen_version("soxl", L._canon("soxl", nb)))
            except (ValueError, KeyError, TypeError):
                continue
        NBV[v] = out


def stable_rows(G, res, s):
    rows = {}
    for v in G:
        r = res[v][s]
        vals = []
        for nv in NBV[v]:
            a = res.get(nv, {}).get(s, {}).get("adj")
            if a is not None:
                vals.append(a)
        pl = statistics.median(vals) if vals else None
        st = r["adj"] if pl is None or r["adj"] is None else min(r["adj"], pl)
        rows[v] = dict(stable=st, tpy=r["tpy"], gate=r["gate"])
    return rows


def pick(rows, main):
    """경쟁 규칙(V0): 게이트 통과 먼저 · 안정 점수 × (연 매매 ÷ 메인 연 매매)^0.25 · 메인 +0.02 · 1위가 게이트 미달이면 그대로."""
    ref = (rows.get(main) or {}).get("tpy")

    def sc(v):
        r = rows[v]
        st = r["stable"] if r["stable"] is not None else -1e9
        f = 1.0 if (not ref or not r["tpy"] or ref <= 0 or r["tpy"] <= 0) else (r["tpy"] / ref) ** L.FREQ_BETA
        return (st * f if st > 0 else st) + (L.MAIN_MARGIN if v == main else 0.0)
    top = sorted(rows, key=lambda v: (not rows[v]["gate"], -sc(v)))[0]
    if main in rows and top != main and not rows[top]["gate"]:
        return main
    return top


# ── 지표 ──────────────────────────────────────────────────────────────────────────────
def stats(dv_full, frm=FROM, to=None, scale=TAB):
    cal = [d for d in D if d >= frm and (to is None or d <= to)]
    cs = set(cal)
    tab = {d: v * scale for d, v in dv_full.items() if d in cs}
    m = L.goal_metrics(tab, cal, PER)
    eq, ys = 1.0, {}
    for d in cal:
        x = 1 + tab.get(d, 0.0) / 100
        eq *= x
        ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = (date.fromisoformat(cal[-1]) - date.fromisoformat(cal[0])).days / 365.25
    return dict(cum=(eq - 1) * 100, cagr=(eq ** (1 / yrs) - 1) * 100 if yrs > 0 else None, mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                pos=sum(1 for y in ys.values() if y > 1), n=len(ys), years={y: (v - 1) * 100 for y, v in ys.items()})


def fmt(s):
    return f"연 복리 {s['cagr']:+6.1f}% · 누적 {s['cum']:+8.1f}% · MDD {s['mdd']:6.1f}% · 최악일 {s['worst']:6.2f}% · 플러스 해 {s['pos']}/{s['n']}"


def trade_ret(daily, scale):
    eq = 1.0
    for v in daily:
        eq *= 1 + v * scale / 100
    return (eq - 1) * 100


def boot(trades, tpy, scale, n=10000, seed=39):
    rnd = random.Random(seed)
    k = max(1, round(tpy))
    loss20 = mdd30 = 0
    rets = []
    for _ in range(n):
        eq, peak, mdd = 1.0, 1.0, 0.0
        for _ in range(k):
            for v in rnd.choice(trades):
                eq *= 1 + v * scale / 100
                peak = max(peak, eq)
                mdd = min(mdd, eq / peak - 1)
        rets.append((eq - 1) * 100)
        loss20 += eq - 1 < -0.20
        mdd30 += mdd < -0.30
    rets.sort()
    return dict(pLoss20=loss20 / n, pMdd30=mdd30 / n, p05=rets[int(n * 0.05)], p50=rets[n // 2], p95=rets[int(n * 0.95)], k=k)


def _actions(p):
    """연구실 결정 기록(enter · hold · exit) — 정수주 모의에 쓴다."""
    _, dec, _ = L.soxl_meanrev(SROWS, dict(L.SOXL_MR, **p, version="x"))
    return {r["date"]: r["action"] for r in dec}


def shares_sim2(p, cash0, frm="2022-01-01", side=0.001, frac=TAB):
    act = _actions(p)
    cash, sh = cash0, 0
    for i in range(bisect.bisect_left(D, frm), N):
        a = act.get(D[i])
        if a == "enter" and sh == 0:
            q = math.floor(cash * frac / (O[i] * (1 + side)))
            cash -= q * O[i] * (1 + side)
            sh = q
        elif a == "exit" and sh:
            cash += sh * O[i] * (1 - side)
            sh = 0
    return (cash + sh * C[-1]) / cash0 * 100 - 100


def regimes(trades, scale):
    vol = [None] * N
    for i in range(20, N):
        r = [C[j] / C[j - 1] - 1 for j in range(i - 19, i + 1)]
        vol[i] = statistics.pstdev(r)
    first = bisect.bisect_left(D, FROM)
    med = statistics.median(v for v in vol[first:] if v is not None)
    ma200 = MA[200]
    out = {}
    for ei, daily in trades:
        if D[ei] < FROM:
            continue
        si = ei - 1                                       # 신호 날(전날 종가)
        tr = trade_ret(daily, scale)
        keys = ["200일 위" if ma200[si] is not None and C[si] > ma200[si] else "200일 아래",
                "변동성 높음" if vol[si] is not None and vol[si] > med else "변동성 낮음"]
        for k in keys:
            out.setdefault(k, []).append(tr)
    return {k: (len(v), statistics.fmean(v)) for k, v in out.items()}


def main():
    G = grid()
    print(f"SOXL 일봉 {D[0]}~{D[-1]} · {N}일 · 유효 격자 {len(G)}조합 (원래 {math.prod(len(v) for v in L.GRID['soxl'].values())})")
    assert MAIN in G and CAND in G
    if not verify(G):
        print("판정하지 않는다 — 빠른 식이 연구실과 다르다")
        return
    res = table(G)
    nb_versions(G)
    # 1. 정직한 걸어가기
    main0 = L.gen_version("soxl", L._canon("soxl", L.MAIN_DEFAULT["soxl"]["params"]))
    cur, picks = main0, []
    for s in SELS:
        rows = stable_rows(G, res, s)
        nxt = pick(rows, cur)
        npass = sum(1 for r in rows.values() if r["gate"])
        picks.append((s, nxt, rows[nxt]["stable"], npass))
        cur = nxt
    print(f"\n1. 정직한 걸어가기(해마다 1/1 · 전체 격자 · 경쟁 규칙) — 첫 메인 {main0}")
    for s, v, st, npass in picks:
        print(f"   {s} → {v} (안정 {st:+.3f} · 게이트 통과 {npass})")

    def chain(cost_rt):
        out = {}
        cache = {}
        for i, (s, v, _, _) in enumerate(picks):
            e = picks[i + 1][0] if i + 1 < len(picks) else "9999-12-31"
            if v not in cache:
                cache[v] = fast_dv(G[v], cost_rt)[0]
            out.update({d: x for d, x in cache[v].items() if s <= d < e})
        return out
    ch = chain(BASE_COST)
    s50, s100 = stats(ch), stats(ch, scale=1.0)
    print("   자금 50%:", fmt(s50))
    print("   자금 100%:", fmt(s100))
    print("   해마다(50%):", " · ".join(f"{y} {x:+.1f}" for y, x in sorted(s50["years"].items())))
    ok1 = s50["cagr"] >= 10 and s50["mdd"] >= -25 and s50["pos"] >= 8
    print("   → 1번", "통과" if ok1 else "미통과", "(기준 연 복리 ≥ 10% · MDD ≥ −25% · 플러스 해 ≥ 8/11)")

    # 2. 비용
    print("\n2. 비용 감도(자금 50% · 2016~) — 왕복 0.20 / 0.30 / 0.40 / 0.60%")
    ok2 = True
    for name, f in (("걸어가기", None), ("메인", MAIN), ("후보", CAND)):
        line = []
        for c in (0.20, 0.30, 0.40, 0.60):
            st = stats(chain(c) if f is None else fast_dv(G[f], c)[0])
            line.append(st["cagr"])
        ok = line[2] >= 7 and line[3] > 0
        ok2 &= ok
        print(f"   {name:5} 연 복리 " + " / ".join(f"{x:+.1f}%" for x in line) + ("  통과" if ok else "  미통과"))

    # 3~6. 메인 · 후보
    ok3 = ok4 = ok5 = ok6 = True
    for name, v in (("메인", MAIN), ("후보", CAND)):
        dv, entries, trades = fast_dv(G[v])
        st50, st100 = stats(dv), stats(dv, scale=1.0)
        tr16 = [t for t in trades if D[t[0]] >= FROM]
        yrs = (date.fromisoformat(D[-1]) - date.fromisoformat(FROM)).days / 365.25
        tpy = len(tr16) / yrs
        print(f"\n== {name} {v}")
        print("   자금 50%:", fmt(st50))
        print("   자금 100%:", fmt(st100))
        print(f"   매매 {len(tr16)}번(2016~ · 연 {tpy:.1f}) · 매매 평균(100%) {statistics.fmean(trade_ret(t[1], 1.0) for t in tr16):+.2f}% · "
              f"이긴 매매 {sum(1 for t in tr16 if trade_ret(t[1], 1.0) > 0) / len(tr16) * 100:.0f}%")
        rg = regimes(trades, TAB)
        rg100 = regimes(trades, 1.0)
        bad = [k for k, (n, a) in rg.items() if n >= 20 and a < -0.3]
        ok3 &= not bad
        print("   3. 국면(매매 수 · 매매 평균 50% / 100%):", " · ".join(f"{k} {n}번 {a:+.2f}%/{rg100[k][1]:+.2f}%" for k, (n, a) in sorted(rg.items())),
              "→", "문제 없음" if not bad else f"문제 {bad}")
        nbs = []
        for nb in L.neighbors("soxl", G[v], L.PLATEAU_KEYS["soxl"]):
            try:
                nv = L.gen_version("soxl", L._canon("soxl", nb))
            except (ValueError, KeyError, TypeError):
                continue
            if nv != v and nv in G:
                nbs.append((nv, stats(fast_dv(G[nv])[0])["cagr"]))
        medn = statistics.median(x for _, x in nbs) if nbs else None
        ok = medn is not None and medn >= 0.6 * st50["cagr"]
        ok4 &= ok
        print(f"   4. 이웃 {len(nbs)}개 연 복리 중앙값 {medn:+.1f}% (자기 {st50['cagr']:+.1f}% · 비 {medn / st50['cagr']:.2f}) →", "통과" if ok else "미통과")
        print("      " + " · ".join(f"{a.replace('g_soxl_', '')} {b:+.1f}" for a, b in sorted(nbs, key=lambda x: -x[1])))
        b50, b100 = boot([t[1] for t in tr16], tpy, TAB), boot([t[1] for t in tr16], tpy, 1.0)
        ok = b50["pLoss20"] <= 0.10 and b50["pMdd30"] <= 0.10
        ok5 &= ok
        print(f"   5. 부트스트랩 1년({b50['k']}번 매매 · 1만 번): 50% — −20% 넘게 잃을 확률 {b50['pLoss20'] * 100:.1f}% · MDD −30% 넘을 확률 {b50['pMdd30'] * 100:.1f}% · "
              f"1년 수익 5% / 50% / 95% = {b50['p05']:+.1f} / {b50['p50']:+.1f} / {b50['p95']:+.1f}% →", "통과" if ok else "미통과")
        print(f"      100% — 잃을 확률(−20%) {b100['pLoss20'] * 100:.1f}% · MDD −30% {b100['pMdd30'] * 100:.1f}% · 5/50/95% = {b100['p05']:+.1f} / {b100['p50']:+.1f} / {b100['p95']:+.1f}%")
        pct = stats(dv, frm="2022-01-01")["cum"]
        for cash in (10000, 100000):
            r = shares_sim2(G[v], cash)
            ok = abs(r - pct) <= 3
            ok6 &= ok
            print(f"   6. 정수주 {cash:,}$ · 2022~ · 자금 50%: {r:+.1f}% (비율 계산 {pct:+.1f}% · 차이 {r - pct:+.1f}%p) →", "문제 없음" if ok else "문제")

    # 7. 기록 일치
    ok7 = None
    path = L.DATA / "claude-lab" / "soxl-mr-decisions.csv"
    if path.exists():
        rec = {r["date"]: r["action"] for r in csv.DictReader(path.open(encoding="utf-8")) if r["date"] >= "2026-10-01"}
        L.MAIN_EVENTS[:] = L.load_main_events()                 # 밤 계산 main() 과 같이 메인 기록을 읽는다
        _, _, dec, _, sw = L.soxl_piecewise(SROWS)
        mine = {r["date"]: r["action"] for r in dec if r["date"] >= "2026-10-01"}
        days = sorted(set(rec) | set(mine))
        diff = [(d, rec.get(d), mine.get(d)) for d in days if (rec.get(d) in ("enter", "exit")) != (mine.get(d) in ("enter", "exit")) or
                (rec.get(d) in ("enter", "exit") and rec.get(d) != mine.get(d))]
        ok7 = not diff
        print(f"\n7. 기록 일치(10/01~ · 밤 기록 {len(rec)}일 · 다시 계산 {len(mine)}일 · 메인 교체 {[(x['version'], x['switchDate']) for x in sw]}):",
              "같음" if ok7 else f"다름 {diff[:8]}")
        print("   매수 · 매도:", " · ".join(f"{d} {a}" for d, a in sorted(rec.items()) if a in ("enter", "exit")) or "없음")
    else:
        print("\n7. 기록 일치: soxl-mr-decisions.csv 없음 — 미확인")
    verdict = ok1 and ok2 and ok4 and ok5 and ok3 and ok6 and ok7 is not False
    print(f"\n== 판정: 1 {'O' if ok1 else 'X'} · 2 {'O' if ok2 else 'X'} · 3 {'O' if ok3 else 'X'} · 4 {'O' if ok4 else 'X'} · 5 {'O' if ok5 else 'X'} · "
          f"6 {'O' if ok6 else 'X'} · 7 {'O' if ok7 else ('?' if ok7 is None else 'X')} → {'투자 가능' if verdict else '보류'}")


if __name__ == "__main__":
    main()
