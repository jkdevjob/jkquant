"""R40 — ③ 코인 돌파 투자 판정. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-12 R40(커밋 9733f28b).
사용: JKQ_DATA=<scalping-data data 사본(claude-lab/hourly · main-config.json)> python scripts/research/r40_coin_invest.py
  - 60분봉: 연구실 fetch_hourly(업비트 캐시) 그대로. 전략 식: 연구실 coin_breakout · coin_series 와 같은 식을 미리 계산한 특징으로
    빠르게 다시 짠 것 — 무작위 40조합에서 연구실 coin_series(칸값 · 달력)와 모두 같아야(±1e-9) 계산을 이어 간다.
  - 자금 80%(tabSize 0.8 · 경쟁 계산 기준)로 판정하고 100% 는 참고로 같이 적는다.
  - 7번 기록 일치: scalping-data 의 data/claude-live/{날짜}.json(Worker 실시간 장부 사본)을 git 으로 읽는다(JKQ_REPO · 기본 이 저장소)."""
import bisect
import itertools
import json
import math
import os
import random
import statistics
import subprocess
import sys
from datetime import date, datetime, timedelta
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

FROM = "2020-01-01"
PINNED = "g_coin_ma15_s99_hi7_eth"
PROMO = "g_coin_ma5_s10_hi_both"
TAB = 0.8
PER = 365
MKTS = ("KRW-BTC", "KRW-ETH")
CB = L.COIN_BO
HALF = CB["costRoundTripPct"] / 2
SELS = [f"{y}-01-01" for y in range(2020, 2027)]

HR = {m: L.fetch_hourly(m) for m in MKTS}


class Mk:
    """시장 하나의 미리 계산한 특징 — 연구실 coin_breakout 과 같은 식(같은 순서의 같은 연산)."""

    def __init__(self, H):
        self.Dd = L.upbit_days(H)
        self.days = sorted(self.Dd)
        self.C = [self.Dd[d][3] for d in self.days]
        self.bars, self.sufmin = [], []
        for d in self.days:
            s0 = datetime.fromisoformat(d + "T09:00:00")
            b = [H[(s0 + timedelta(hours=k)).isoformat()] for k in range(24)]
            self.bars.append(b)
            sm, m = [0.0] * 24, float("inf")
            for k in range(23, -1, -1):
                m = min(m, b[k][2])
                sm[k] = m
            self.sufmin.append(sm)
        n_days = len(self.days)
        self.ma = {n: [sum(self.C[i - n:i]) / n if i >= n else None for i in range(n_days)] for n in L.GRID["crypto"]["ma"]}
        self.lvl = {}
        for hn in L.GRID["crypto"]["hiN"]:
            self.lvl[("prevhigh", hn)] = [max(self.Dd[self.days[i - j]][1] for j in range(1, hn + 1)) if i >= hn else None for i in range(n_days)]
        for k in L.GRID["crypto"]["k"]:
            arr = [None] * n_days
            for i in range(1, n_days):
                d, pd = self.days[i], self.days[i - 1]
                arr[i] = self.Dd[d][0] + k * (self.Dd[pd][1] - self.Dd[pd][2])
            self.lvl[("vb", k)] = arr
        self.entry = {}

    def entries(self, lv, leh):
        key = (lv, leh)
        if key not in self.entry:
            L_, out = self.lvl[lv], []
            for i, b in enumerate(self.bars):
                lev, got = L_[i], None
                if lev is not None:
                    for k in range(24):
                        if leh is not None and (9 + k) % 24 >= leh and k < 15:
                            break
                        if b[k][1] > lev:
                            got = (k, max(b[k][0], lev) * (1 + CB["entrySlipPct"] / 100))
                            break
                out.append(got)
            self.entry[key] = out
        return self.entry[key]


MK = {m: Mk(HR[m]) for m in MKTS}


def lv_of(p):
    return ("prevhigh", int(p.get("hiN") or 1)) if p["level"] == "prevhigh" else ("vb", p["k"])


def market_dv(mk, p, half=HALF):
    n = p["ma"]
    hn = int(p.get("hiN") or 1) if p["level"] == "prevhigh" else 1
    ent = mk.entries(lv_of(p), p.get("lastEntryHour"))
    ma, C, s = mk.ma[n], mk.C, p["stopPct"]
    dv = {}
    for i in range(max(n, hn), len(mk.days)):
        if not C[i - 1] > ma[i]:
            continue
        e = ent[i]
        if e is None:
            continue
        k, px = e
        stop = px * (1 - s / 100)
        if mk.sufmin[i][k] <= stop:
            r = -s - CB["stopSlipPct"] - 2 * half
        else:
            r = (mk.bars[i][-1][3] / px - 1) * 100 - 2 * half
        dv[mk.days[i]] = r * CB["size"]
    return dv


def full_dv(p, half=HALF):
    """칸값(두 코인 고정 몫 합) · 달력 — 연구실 coin_series 의 full · cal 과 같은 것."""
    per, cal = {}, set()
    for m in p["markets"]:
        mk = MK[m]
        per[m] = (market_dv(mk, p, half), set(mk.days))
        cal |= set(mk.days)
    cal = sorted(cal)
    return L.basket(per, cal), cal


def grid():
    keys = list(L.GRID["crypto"])
    out = {}
    for vals in itertools.product(*[L.GRID["crypto"][k] for k in keys]):
        try:
            p = L._canon("crypto", dict(zip(keys, vals), tabSize=TAB))
        except (ValueError, KeyError, TypeError):
            continue
        out.setdefault(L.gen_version("crypto", p), p)
    return out


def verify(G, k=40):
    rnd = random.Random(40)
    picks = rnd.sample(sorted(G), k) + [PINNED, PROMO]
    bad = 0
    for v in picks:
        p = G[v]
        _, ref, _, _, rcal = L.coin_series(dict(p, version=v), HR)
        got, gcal = full_dv(p)
        if rcal != gcal or set(ref) != set(got) or any(abs(ref[d] - got[d]) > 1e-9 for d in ref):
            bad += 1
            print("  다름:", v, len(ref), len(got))
    print(f"검증: 연구실 coin_series 와 칸값 · 달력 비교 {len(picks)}조합 · 다름 {bad}")
    return bad == 0


G_ALL = {}


def _eval(v):
    p = G_ALL[v]
    dv, cal = full_dv(p)
    items = sorted(dv.items())
    ds = [d for d, _ in items]
    out = {}
    for s in SELS:
        k = bisect.bisect_left(ds, s)
        cut = {d: x * TAB for d, x in items[:k]}
        c = cal[:bisect.bisect_left(cal, s)]
        m = L.score_metrics(cut, c, PER)
        out[s] = dict(adj=m.get("adj"), gate=L.gate_ok(m), tpy=L.trades_per_year(cut, c, PER))
    return v, out


def table(G):
    G_ALL.update(G)
    with Pool(os.cpu_count() or 2) as pool:
        return dict(pool.map(_eval, sorted(G), chunksize=64))


NBV = {}


def nb_versions(G):
    for v, p in G.items():
        out = []
        for nb in L.neighbors("crypto", p, L.PLATEAU_KEYS["crypto"]):
            try:
                out.append(L.gen_version("crypto", L._canon("crypto", nb)))
            except (ValueError, KeyError, TypeError):
                continue
        NBV[v] = out


def stable_rows(G, res, s):
    rows = {}
    for v in G:
        r = res[v][s]
        vals = [res[nv][s]["adj"] for nv in NBV[v] if nv in res and res[nv][s]["adj"] is not None]
        pl = statistics.median(vals) if vals else None
        st = r["adj"] if pl is None or r["adj"] is None else min(r["adj"], pl)
        rows[v] = dict(stable=st, tpy=r["tpy"], gate=r["gate"])
    return rows


def pick(rows, main):
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


CAL = sorted(set(MK["KRW-BTC"].days) | set(MK["KRW-ETH"].days))


def stats(dv_full, frm=FROM, scale=TAB):
    cal = [d for d in CAL if d >= frm]
    cs = set(cal)
    tab = {d: v * scale for d, v in dv_full.items() if d in cs}
    m = L.goal_metrics(tab, cal, PER)
    eq, ys = 1.0, {}
    for d in cal:
        x = 1 + tab.get(d, 0.0) / 100
        eq *= x
        ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = (date.fromisoformat(cal[-1]) - date.fromisoformat(cal[0])).days / 365.25
    return dict(cum=(eq - 1) * 100, cagr=(eq ** (1 / yrs) - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                pos=sum(1 for y in ys.values() if y > 1), n=len(ys), years={y: (v - 1) * 100 for y, v in ys.items()}, tdays=len(tab))


def fmt(s):
    return f"연 복리 {s['cagr']:+6.1f}% · 누적 {s['cum']:+8.1f}% · MDD {s['mdd']:6.1f}% · 최악일 {s['worst']:6.2f}% · 플러스 해 {s['pos']}/{s['n']}"


def boot(vals, per_year, n=10000, seed=40):
    rnd = random.Random(seed)
    k = max(1, round(per_year))
    loss20 = mdd30 = 0
    rets = []
    for _ in range(n):
        eq, peak, mdd = 1.0, 1.0, 0.0
        for _ in range(k):
            eq *= 1 + rnd.choice(vals) / 100
            peak = max(peak, eq)
            mdd = min(mdd, eq / peak - 1)
        rets.append((eq - 1) * 100)
        loss20 += eq - 1 < -0.20
        mdd30 += mdd < -0.30
    rets.sort()
    return dict(pLoss20=loss20 / n, pMdd30=mdd30 / n, p05=rets[int(n * 0.05)], p50=rets[n // 2], p95=rets[int(n * 0.95)], k=k)


def regimes(dv_full, scale):
    bt = MK["KRW-BTC"]
    idx = {d: i for i, d in enumerate(bt.days)}
    ma200 = [sum(bt.C[i - 200:i]) / 200 if i >= 200 else None for i in range(len(bt.days))]
    vol = [statistics.pstdev([bt.C[j] / bt.C[j - 1] - 1 for j in range(i - 20, i)]) if i >= 21 else None for i in range(len(bt.days))]
    first = bisect.bisect_left(bt.days, FROM)
    med = statistics.median(v for v in vol[first:] if v is not None)
    out = {}
    for d, v in dv_full.items():
        if d < FROM or d not in idx:
            continue
        i = idx[d]                                           # 그날 시작에 아는 값(어제까지 종가)
        keys = ["BTC 200일 위" if ma200[i] is not None and bt.C[i - 1] > ma200[i] else "BTC 200일 아래",
                "변동성 높음" if vol[i] is not None and vol[i] > med else "변동성 낮음"]
        for k in keys:
            out.setdefault(k, []).append(v * scale)
    return {k: (len(x), statistics.fmean(x)) for k, x in out.items()}


def live_trades(frm="2026-10-01"):
    """Worker 실시간 장부 사본(scalping-data data/claude-live/{날짜}.json)의 ③ 마감 매매 — (업비트 날, 코인) → 기록."""
    repo = os.environ.get("JKQ_REPO", str(Path(__file__).resolve().parents[2]))
    names = subprocess.run(["git", "-C", repo, "ls-tree", "--name-only", "origin/scalping-data", "data/claude-live/"],
                           capture_output=True, text=True).stdout.split()
    out = {}
    for f in sorted(names):
        d = f.rsplit("/", 1)[-1][:10]
        if d < frm:
            continue
        j = json.loads(subprocess.run(["git", "-C", repo, "show", "origin/scalping-data:" + f], capture_output=True, text=True).stdout or "{}")
        for e in (j.get("ledger") or {}).get("events") or []:
            if e.get("id") != "close:crypto":
                continue
            for t in (e.get("payload") or {}).get("trades") or []:
                md, hm = t["entryTime"].split()
                y = int(d[:4]) - (1 if md[:2] == "12" and d[5:7] == "01" else 0)
                when = datetime.fromisoformat(f"{y}-{md}T{hm}:00")
                uday = (when - timedelta(hours=9)).date().isoformat()     # 업비트 하루(09:00~다음 09:00)
                out[(uday, "KRW-" + t["name"])] = dict(hour=hm, entry=t["entryPrice"], exit=t.get("exitPrice"), pnl=t.get("pnlPct"), file=d)
    return out


def main():
    G = grid()
    print(f"업비트 60분봉 BTC {MK['KRW-BTC'].days[0]}~{MK['KRW-BTC'].days[-1]} · ETH {MK['KRW-ETH'].days[0]}~{MK['KRW-ETH'].days[-1]} · 유효 격자 {len(G)}조합 "
          f"(원래 {math.prod(len(v) for v in L.GRID['crypto'].values())})")
    assert PINNED in G and PROMO in G
    if not verify(G):
        print("판정하지 않는다 — 빠른 식이 연구실과 다르다")
        return
    res = table(G)
    nb_versions(G)
    main0 = L.gen_version("crypto", L._canon("crypto", L.MAIN_DEFAULT["crypto"]["params"]))
    cur, picks = main0, []
    for s in SELS:
        rows = stable_rows(G, res, s)
        nxt = pick(rows, cur)
        picks.append((s, nxt, rows[nxt]["stable"], sum(1 for r in rows.values() if r["gate"])))
        cur = nxt
    print(f"\n1. 정직한 걸어가기(해마다 1/1 · 전체 격자 · 경쟁 규칙) — 첫 메인 {main0}")
    for s, v, st, npass in picks:
        print(f"   {s} → {v} (안정 {st:+.3f} · 게이트 통과 {npass})")

    def chain(half):
        out, cache = {}, {}
        for i, (s, v, _, _) in enumerate(picks):
            e = picks[i + 1][0] if i + 1 < len(picks) else "9999-12-31"
            if v not in cache:
                cache[v] = full_dv(G[v], half)[0]
            out.update({d: x for d, x in cache[v].items() if s <= d < e})
        return out
    ch = chain(HALF)
    s80, s100 = stats(ch), stats(ch, scale=1.0)
    print("   자금 80%:", fmt(s80))
    print("   자금 100%:", fmt(s100))
    print("   해마다(80%):", " · ".join(f"{y} {x:+.1f}" for y, x in sorted(s80["years"].items())))
    ok1 = s80["cagr"] >= 10 and s80["mdd"] >= -25 and s80["pos"] >= 5
    print("   → 1번", "통과" if ok1 else "미통과", "(기준 연 복리 ≥ 10% · MDD ≥ −25% · 플러스 해 ≥ 5/7)")

    print("\n2. 비용 감도(자금 80% · 2020~) — 한쪽 +0 / +0.05 / +0.10 / +0.20%")
    ok2 = True
    for name, f in (("걸어가기", None), ("고정 메인", PINNED), ("11/11 메인", PROMO)):
        line = [stats(chain(HALF + x) if f is None else full_dv(G[f], HALF + x)[0])["cagr"] for x in (0.0, 0.05, 0.10, 0.20)]
        ok = line[2] >= 7 and line[3] > 0
        ok2 &= ok
        print(f"   {name:7} 연 복리 " + " / ".join(f"{x:+.1f}%" for x in line) + ("  통과" if ok else "  미통과"))

    ok3 = ok4 = ok5 = True
    for name, v in (("고정 메인", PINNED), ("11/11 메인", PROMO)):
        dv, _ = full_dv(G[v])
        st80, st100 = stats(dv), stats(dv, scale=1.0)
        d20 = [x for d, x in dv.items() if d >= FROM]
        yrs = (date.fromisoformat(CAL[-1]) - date.fromisoformat(FROM)).days / 365.25
        print(f"\n== {name} {v}")
        print("   자금 80%:", fmt(st80))
        print("   자금 100%:", fmt(st100))
        print(f"   매매일 {len(d20)}일(2020~ · 연 {len(d20) / yrs:.1f}) · 매매일 평균(칸 100%) {statistics.fmean(d20):+.3f}% · 이긴 날 {sum(1 for x in d20 if x > 0) / len(d20) * 100:.0f}%")
        rg, rg100 = regimes(dv, TAB), regimes(dv, 1.0)
        bad = [k for k, (n, a) in rg.items() if n >= 20 and a < -0.3]
        ok3 &= not bad
        print("   3. 국면(매매일 · 평균 80% / 100%):", " · ".join(f"{k} {n}일 {a:+.3f}%/{rg100[k][1]:+.3f}%" for k, (n, a) in sorted(rg.items())),
              "→", "문제 없음" if not bad else f"문제 {bad}")
        nbs = []
        for nv in NBV[v]:
            if nv != v and nv in G:
                nbs.append((nv, stats(full_dv(G[nv])[0])["cagr"]))
        nbs = sorted(set(nbs), key=lambda x: -x[1])
        medn = statistics.median(x for _, x in nbs) if nbs else None
        ok = medn is not None and medn >= 0.6 * st80["cagr"]
        ok4 &= ok
        print(f"   4. 이웃 {len(nbs)}개 연 복리 중앙값 {medn:+.1f}% (자기 {st80['cagr']:+.1f}% · 비 {medn / st80['cagr']:.2f}) →", "통과" if ok else "미통과")
        print("      " + " · ".join(f"{a.replace('g_coin_', '')} {b:+.1f}" for a, b in nbs))
        b80, b100 = boot([x * TAB for x in d20], len(d20) / yrs), boot(d20, len(d20) / yrs)
        ok = b80["pLoss20"] <= 0.10 and b80["pMdd30"] <= 0.10
        ok5 &= ok
        print(f"   5. 부트스트랩 1년({b80['k']}매매일 · 1만 번): 80% — −20% 넘게 잃을 확률 {b80['pLoss20'] * 100:.1f}% · MDD −30% 넘을 확률 {b80['pMdd30'] * 100:.1f}% · "
              f"1년 수익 5/50/95% = {b80['p05']:+.1f} / {b80['p50']:+.1f} / {b80['p95']:+.1f}% →", "통과" if ok else "미통과")
        print(f"      100% — 잃을 확률(−20%) {b100['pLoss20'] * 100:.1f}% · MDD −30% {b100['pMdd30'] * 100:.1f}% · 5/50/95% = {b100['p05']:+.1f} / {b100['p50']:+.1f} / {b100['p95']:+.1f}%")
    print("\n6. 실제 보유 방식: 하루 안(09:00~다음 09:00) 한 번 사고 한 번 판다 · 소수 수량 · 코인마다 고정 몫 — 보유 중 '다시 맞춤'이 없어 비율 계산과 같은 식 → 해당 없음(통과)")
    ok6 = True

    # 7. 기록 일치 — Worker 실시간 장부 vs 그날 메인 규칙의 백테스트
    L.MAIN_EVENTS[:] = L.load_main_events()
    live = live_trades()
    bt = {}
    vers = {}
    for d in [x for x in CAL if x >= "2026-10-01"]:
        m = L.main_for("crypto", d)
        if m["version"] not in vers:
            vers[m["version"]] = L.coin_series(dict(m["params"], version=m["version"]), HR)[2]
        for mk, dec in vers[m["version"]].items():
            for r in dec:
                if r["date"] == d and r["action"] in ("trade", "stop"):
                    bt[(d, mk)] = dict(hour=r["entryHour"], entry=r["entryPrice"], pnl=r["pnlPct"], version=m["version"])
    last_live = max((k[0] for k in live), default="")
    keys = sorted(k for k in set(bt) | set(live) if k[0] <= last_live)
    same = [k for k in keys if k in bt and k in live and bt[k]["hour"] == live[k]["hour"]]
    diffs = [abs(bt[k]["pnl"] - live[k]["pnl"]) for k in same if live[k]["pnl"] is not None]
    rate = len(same) / len(keys) if keys else None
    ok7 = rate is not None and rate >= 0.9 and (statistics.fmean(diffs) if diffs else 0) <= 0.3
    print(f"\n7. 기록 일치(10/01~{last_live} · 백테스트 매매 {len([k for k in bt if k[0] <= last_live])} · 실시간 매매 {len(live)}): "
          f"같은 진입(날 · 코인 · 시각) {len(same)}/{len(keys)} = {rate * 100 if rate is not None else float('nan'):.0f}% · 손익 차이 평균 {statistics.fmean(diffs) if diffs else float('nan'):.3f}%p →",
          "통과" if ok7 else "문제")
    for k in keys:
        if k not in same:
            print("   다름:", k, "백테스트", bt.get(k), "· 실시간", live.get(k))
    verdict = ok1 and ok2 and ok4 and ok5 and ok3 and ok6 and ok7
    print(f"\n== 판정: 1 {'O' if ok1 else 'X'} · 2 {'O' if ok2 else 'X'} · 3 {'O' if ok3 else 'X'} · 4 {'O' if ok4 else 'X'} · 5 {'O' if ok5 else 'X'} · "
          f"6 {'O' if ok6 else 'X'} · 7 {'O' if ok7 else 'X'} → {'투자 가능' if verdict else '보류'}")


if __name__ == "__main__":
    main()
