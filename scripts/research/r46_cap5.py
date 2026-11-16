"""R46 — '최대 5일' 상한판 투자 판정: QQQ 신호 → TQQQ 매매 3종(Double 7s · 3일 연속 하락 · RSI2) · ③ 과 합친 판.
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-14 R46(커밋 a3b17eca).
사용: JKQ_DATA=<scalping-data data 사본> python scripts/research/r46_cap5.py [--no-mix]
  - 신호는 QQQ 종가(같은 날짜로 맞춘 줄) → 다음 날 TQQQ 시가 체결 · 비용 왕복 0.20% · 5번째 보유일 종가 뒤 다음 시가에 무조건 매도(④ 와 같은 셈법).
  - 판정 지표 · 부트스트랩 · 정수주 · 국면은 R44 함수 그대로(자금 50% · 100% 참고). 합친 판은 R41 계좌(매달 다시 맞춤) 그대로."""
import importlib.util
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, str(HERE / file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R44 = _load("r44", "r44_public_invest.py")
R45 = _load("r45", "r45_public_methods2.py")
R43 = R45.R43
L = R45.L
COST, SIZE, FROM = R44.COST, 0.5, R44.FROM


def run_cap(trd, cost, enter, exit_, cap):
    """R45 run 과 같은 장부 + 보유 일수 상한(매수일 = 1일째 · cap 번째 날 종가 뒤 다음 시가 매도). 반환: trades, dv, 상한으로 판 수."""
    D, O, C = trd.D, trd.O, trd.C
    half = cost / 2
    trades, dv, capped = [], {}, 0
    pos, pending, days = None, None, 0
    for i in range(len(D)):
        if pending == "sell" and pos is not None:
            v = (O[i] / C[i - 1] - 1) * 100 - half
            dv[D[i]] = v
            pos[1].append(v)
            trades.append((pos[0], D[i], R43._compound(pos[1])))
            pos = None
        elif pending == "buy" and pos is None:
            v = (C[i] / O[i] - 1) * 100 - half
            dv[D[i]] = v
            pos, days = (D[i], [v]), 1
        elif pos is not None:
            v = (C[i] / C[i - 1] - 1) * 100
            dv[D[i]] = v
            pos[1].append(v)
            days += 1
        pending = None
        if pos is not None:
            if exit_(i):
                pending = "sell"
            elif cap and days >= cap:
                pending, capped = "sell", capped + 1
        elif enter(i):
            pending = "buy"
    if pos is not None:
        trades.append((pos[0], D[-1], R43._compound(pos[1])))
    return trades, dv, capped


class Pair:
    """QQQ(신호) · TQQQ(매매) 같은 날짜 줄 + 이동평균 캐시."""

    def __init__(self, qqq, tqqq):
        self.s, self.t, self.rows = R45.aligned(qqq, tqqq)
        self._ma = {}

    def ma(self, k):
        if k not in self._ma:
            C = self.s.C
            self._ma[k] = [R43.sma(C, i, k) for i in range(len(C))]
        return self._ma[k]

    def above(self, i, n):
        m = self.ma(n)[i]
        return m is not None and self.s.C[i] > m


def d7(P, cost, w=7, n=200, cap=5):
    C = P.s.C
    return run_cap(P.t, cost, lambda i: i >= w - 1 and P.above(i, n) and C[i] <= min(C[i - w + 1:i + 1]),
                   lambda i: i >= w - 1 and C[i] >= max(C[i - w + 1:i + 1]), cap)


def dn(P, cost, k=3, xm=5, n=200, cap=5):
    C = P.s.C
    return run_cap(P.t, cost, lambda i: i >= k and P.above(i, n) and all(C[i - j] < C[i - j - 1] for j in range(k)),
                   lambda i: P.ma(xm)[i] is not None and C[i] > P.ma(xm)[i], cap)


def r2(P, cost, th=10, xm=5, n=200, cap=5):
    C, R = P.s.C, P.s.rsi
    return run_cap(P.t, cost, lambda i: P.above(i, n) and R[i] is not None and R[i] < th,
                   lambda i: P.ma(xm)[i] is not None and C[i] > P.ma(xm)[i], cap)


CANDS = [("(가) Double 7s", d7), ("(나) 3일 연속 하락", dn), ("(다) RSI2", r2)]
NEIGH = {d7: [dict(w=5), dict(w=6), dict(w=8), dict(w=10), dict(n=150), dict(n=250), dict(cap=3), dict(cap=4)],
         dn: [dict(k=2), dict(k=4), dict(xm=3), dict(xm=10), dict(n=150), dict(n=250), dict(cap=3), dict(cap=4)],
         r2: [dict(th=5), dict(th=15), dict(xm=3), dict(xm=10), dict(n=150), dict(n=250), dict(cap=3), dict(cap=4)]}


def main():
    qqq, tqqq = R43.load_fdr("QQQ", "1999-01-01"), R43.load_fdr("TQQQ", "2010-01-01")
    P = Pair(qqq, tqqq)
    rows = P.rows
    print(f"자료: QQQ {qqq[0][0]}~{qqq[-1][0]} · TQQQ {tqqq[0][0]}~{tqqq[-1][0]} · 맞춘 줄 {len(rows)} · 판정 {FROM}~ · 자금 {SIZE:.0%}(100% 참고)")
    out = {}
    for name, fn in CANDS:
        trades, dv, capped = fn(P, COST)
        tr0, dv0, _ = fn(P, COST, cap=0)                                     # 상한 없음(R45 판)
        s, s100, s0 = R44.stats(rows, dv, trades, SIZE), R44.stats(rows, dv, trades, 1.0), R44.stats(rows, dv0, tr0, SIZE)
        print(f"\n== {name} · 최대 5일")
        print(f"   1. {FROM}~: 매매 {s['n']}번(연 {s['tpy']:.1f}) · 평균 {s['mean']:+.2f}%(100%) · t {s['t']:.1f} · 연 복리 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.1f}% · "
              f"플러스 해 {s['pos']}/{s['ny']} · (100%: 연 {s100['cagr']:+.1f}% · MDD {s100['mdd']:.1f}%) · 상한으로 판 매매 {capped}번 · 상한 없음 판 연 {s0['cagr']:+.1f}% · MDD {s0['mdd']:.1f}%")
        ok1 = s["mean"] > 0 and s["t"] >= 2.0 and s["ny"] and s["pos"] / s["ny"] >= 0.6 and s["mdd"] >= -25
        line, means = [], []
        for x in (0.05, 0.10, 0.20):
            tr2, dv2, _ = fn(P, COST + 2 * x)
            s2 = R44.stats(rows, dv2, tr2, SIZE)
            line.append(s2["cagr"])
            means.append(s2["mean"])
        ok2 = line[1] > 0 and means[2] >= 0
        print(f"   2. 비용 한쪽 +0.05/+0.10/+0.20%: 연 {line[0]:+.1f} / {line[1]:+.1f} / {line[2]:+.1f}% · 평균 {means[0]:+.2f} / {means[1]:+.2f} / {means[2]:+.2f}% → {'통과' if ok2 else '미통과'}")
        rg = R44.vol_regimes(rows, trades, dv, SIZE)
        bad = [k for k, (n, a) in rg.items() if n >= 20 and a < -0.3]
        ok3 = not bad
        print("   3. 국면:", " · ".join(f"{k} {n}번 {a:+.2f}%" for k, (n, a) in sorted(rg.items())), "→", "문제 없음" if ok3 else f"문제 {bad}")
        nb = []
        for kw in NEIGH[fn]:
            trn, dvn, _ = fn(P, COST, **kw)
            nb.append((kw, R44.stats(rows, dvn, trn, SIZE)["cagr"]))
        med = statistics.median(x for _, x in nb)
        ok4 = s["cagr"] > 0 and med >= 0.6 * s["cagr"]
        print(f"   4. 이웃 연 복리 중앙값 {med:+.1f}% (자기 {s['cagr']:+.1f}%) →", "통과" if ok4 else "미통과", "·",
              " · ".join(f"{list(k)[0]}={list(k.values())[0]} {v:+.1f}" for k, v in nb))
        td = R44.trade_dailies({d: v for d, v in dv.items() if d >= FROM}, [t for t in trades if t[0] >= FROM])
        b = R44.boot(td, s["tpy"], SIZE)
        ok5 = b["pLoss"] <= 0.10 and b["pDeep"] <= 0.10
        print(f"   5. 부트스트랩 1년({b['k']}번): −20% 손실 {b['pLoss'] * 100:.1f}% · MDD −30% {b['pDeep'] * 100:.1f}% · 1년 5/50/95% = {b['p05']:+.1f} / {b['p50']:+.1f} / {b['p95']:+.1f}% →",
              "통과" if ok5 else "미통과")
        pct = R44.stats(rows, dv, trades, SIZE, frm=R44.SHARES_FROM)["cum"]
        sh = [R44.shares(rows, trades, SIZE, c) for c in (10000, 100000)]
        ok6 = all(abs(x - pct) <= 3 for x in sh)
        print(f"   6. {R44.SHARES_FROM}~ 정수주 1만$ {sh[0]:+.1f}% · 10만$ {sh[1]:+.1f}% vs 비율 계산 {pct:+.1f}% →", "문제 없음" if ok6 else "문제")
        oks = [ok1, ok2, ok3, ok4, ok5, ok6]
        v = all(oks)
        out[name] = (v, dv)
        print("   → 판정: " + " · ".join(f"{i + 1} {'O' if o else 'X'}" for i, o in enumerate(oks)) + " · 7 전향 검증 대상 → " + ("판정표 통과" if v else "보류"))
    print("\n== 요약:", " / ".join(f"{n} {'통과' if v else '보류'}" for n, (v, _) in out.items()))
    if "--no-mix" in sys.argv:
        return
    passed = [(n, dv) for n, (v, dv) in out.items() if v]
    if not passed:
        print("합친 판: 통과한 후보 없음 — 계산 안 함")
        return
    R41 = _load("r41", "r41_portfolio.py")
    base, stress = R41.sleeves(0.0), R41.sleeves(0.05)
    r3, r3s = base["A"][0], stress["A"][0]
    cur = R41.account(*base["A"], 0.6, 0.4)
    cs, cb = R41.stats(cur), R41.block_boot(cur)
    print(f"\n== 합친 판(③ 정직한 판 2020~ · 매달 다시 맞춤) — 지금 투자안 ③ 60% + ④ 40%: 연 {cs['cagr']:+.1f}% · MDD {cs['mdd']:.1f}% · 최악일 {cs['worst']:.1f}% · "
          f"{cs['pos']}/{cs['n']}해 · −20% 손실 {cb['p'] * 100:.1f}%")
    for n, dv in passed:
        x = L.us_to_kst({d: v for d, v in dv.items()})
        xs = L.us_to_kst({d: v - (0.05 * 2 if False else 0) for d, v in dv.items()})
        best = None
        for w3 in (0.4, 0.5, 0.6, 0.7, 0.8):
            for wx in (0.2, 0.3, 0.4, 0.5):
                if w3 + wx > 1.0 + 1e-9:
                    continue
                a = R41.account(r3, x, w3, wx)
                st, bb = R41.stats(a), R41.block_boot(a)
                ok = R41.ok_of(st, bb)
                print(f"   {n} · ③ {w3:.1f} + 후보 {wx:.1f}: 연 {st['cagr']:+.1f}% · MDD {st['mdd']:.1f}% · 최악일 {st['worst']:.1f}% · {st['pos']}/{st['n']}해 · −20% 손실 {bb['p'] * 100:.1f}% → {'통과' if ok else '미통과'}")
                if ok and (best is None or st["cagr"] > best[2]["cagr"]):
                    best = (w3, wx, st)
        if best:
            print(f"   → {n}: 기준 통과 중 연 복리 가장 높은 비중 ③ {best[0]:.0%} + 후보 {best[1]:.0%} · 연 {best[2]['cagr']:+.1f}% · MDD {best[2]['mdd']:.1f}%")


if __name__ == "__main__":
    main()
