"""R45 — 시중 유명 매매법 2차(눌림목 변형 · 1배 신호로 3배 매매 · 추세). 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-13 R45(커밋 fd722f81).
사용: JKQ_DATA=<scalping-data data 사본(claude-lab/hourly)> python scripts/research/r45_public_methods2.py
  - 장부 · 자료 · 1차 기준은 R43(r43_public_methods.py)과 같다: 종가 신호 → 다음 날 시가 체결 · 비용 왕복 0.20% · 자금 100%.
  - 추세(B3 · B4 · C)는 같은 종목을 그냥 들고 있기(같은 시작일부터)와 견준다."""
import importlib.util
import math
import statistics
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("r43", str(HERE / "r43_public_methods.py"))
R43 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R43)
L = R43.L
SPLIT = R43.SPLIT


class Ind:
    """한 종목의 지표 배열(같은 인덱스)."""

    def __init__(self, rows):
        self.D = [r[0] for r in rows]
        self.O, self.H, self.Lw, self.C = ([r[k] for r in rows] for k in (1, 2, 3, 4))
        n = len(rows)
        C = self.C
        self.sma = {k: [R43.sma(C, i, k) for i in range(n)] for k in (5, 20, 50, 200)}
        self.sd20 = [statistics.pstdev(C[i - 19:i + 1]) if i >= 19 else None for i in range(n)]
        self.rsi = [L.rsi2_at(C, i, 2) if i >= 2 else None for i in range(n)]
        self.wr = []
        for i in range(n):
            if i < 9:
                self.wr.append(None)
                continue
            hh, ll = max(self.H[i - 9:i + 1]), min(self.Lw[i - 9:i + 1])
            self.wr.append((hh - C[i]) / (hh - ll) * -100 if hh > ll else -50.0)
        self.mend = [i + 1 == n or self.D[i][:7] != self.D[i + 1][:7] for i in range(n)]
        me = [C[i] for i in range(n) if self.mend[i]]
        self.ma10m = []
        k = 0
        for i in range(n):
            if self.mend[i]:
                k += 1
                self.ma10m.append(statistics.fmean(me[k - 10:k]) if k >= 10 else None)
            else:
                self.ma10m.append(None)


def run(trd, cost, enter, exit_):
    """④ · R43 과 같은 장부. enter(i) · exit_(i) 는 i 일 종가로 판단(같은 인덱스) → 다음 날 시가 체결."""
    D, O, C = trd.D, trd.O, trd.C
    half = cost / 2
    trades, dv = [], {}
    pos, pending = None, None
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
            pos = (D[i], [v])
        elif pos is not None:
            v = (C[i] / C[i - 1] - 1) * 100
            dv[D[i]] = v
            pos[1].append(v)
        pending = None
        if pos is not None:
            if exit_(i):
                pending = "sell"
        elif enter(i):
            pending = "buy"
    if pos is not None:
        trades.append((pos[0], D[-1], R43._compound(pos[1])))
    return trades, dv


def above200(s, i):
    m = s.sma[200][i]
    return m is not None and s.C[i] > m


def a1(s):
    return (lambda i: above200(s, i) and i >= 1 and s.rsi[i] is not None and s.rsi[i - 1] is not None and s.rsi[i] + s.rsi[i - 1] < 35,
            lambda i: s.rsi[i] is not None and s.rsi[i] > 65)


def a2(s):
    def ent(i):
        if i < 3 or not above200(s, i) or s.sma[5][i] is None or not s.C[i] < s.sma[5][i]:
            return False
        return all(s.H[j] < s.H[j - 1] and s.Lw[j] < s.Lw[j - 1] for j in (i, i - 1, i - 2))
    return ent, lambda i: s.sma[5][i] is not None and s.C[i] > s.sma[5][i]


def a3(s):
    return (lambda i: above200(s, i) and s.sd20[i] is not None and s.C[i] < s.sma[20][i] - 2 * s.sd20[i],
            lambda i: s.sma[20][i] is not None and s.C[i] > s.sma[20][i])


def a4(s):
    return (lambda i: above200(s, i) and s.wr[i] is not None and s.wr[i] < -80,
            lambda i: s.wr[i] is not None and s.wr[i] > -20)


def a5(s):
    return (lambda i: above200(s, i) and i >= 3 and s.C[i] < s.C[i - 1] < s.C[i - 2] < s.C[i - 3],
            lambda i: s.sma[5][i] is not None and s.C[i] > s.sma[5][i])


def b1(s):
    return (lambda i: above200(s, i) and i >= 6 and s.C[i] <= min(s.C[i - 6:i + 1]),
            lambda i: i >= 6 and s.C[i] >= max(s.C[i - 6:i + 1]))


def b2(s):
    return (lambda i: above200(s, i) and s.rsi[i] is not None and s.rsi[i] < 10,
            lambda i: s.sma[5][i] is not None and s.C[i] > s.sma[5][i])


def b3(s):
    return (lambda i: above200(s, i), lambda i: s.sma[200][i] is not None and not s.C[i] > s.sma[200][i])


def b4(s):
    return (lambda i: s.sma[200][i] is not None and s.C[i] > s.sma[200][i] * 1.03,
            lambda i: s.sma[200][i] is not None and s.C[i] < s.sma[200][i] * 0.97)


def c1(s):
    ok = lambda i: s.sma[50][i] is not None and s.sma[200][i] is not None and s.sma[50][i] > s.sma[200][i]
    return ok, lambda i: not ok(i)


def c2(s):
    return (lambda i: s.mend[i] and s.ma10m[i] is not None and s.C[i] > s.ma10m[i],
            lambda i: s.mend[i] and s.ma10m[i] is not None and not s.C[i] > s.ma10m[i])


def aligned(sig_rows, trd_rows):
    sd = {r[0]: r for r in sig_rows}
    t = [r for r in trd_rows if r[0] in sd]
    return Ind([sd[r[0]] for r in t]), Ind(t), t


def trend_stats(trd, rows, dv, start_i, per):
    cal = trd.D[start_i:]
    m = L.goal_metrics({d: v for d, v in dv.items() if d >= cal[0]}, cal, per)

    def cagr(ds, f):
        eq = 1.0
        for d in ds:
            eq *= 1 + f(d) / 100
        yrs = max((date.fromisoformat(ds[-1]) - date.fromisoformat(ds[0])).days / 365.25, 1e-9) if ds else 1
        return (eq ** (1 / yrs) - 1) * 100 if ds and eq > 0 else -100
    bh = {trd.D[i]: (trd.C[i] / trd.C[i - 1] - 1) * 100 for i in range(start_i + 1, len(trd.D))}
    mb = L.goal_metrics(bh, cal, per)
    ys = {}
    for d in cal:
        ys[d[:4]] = ys.get(d[:4], 1.0) * (1 + dv.get(d, 0.0) / 100)
    pre, post = [d for d in cal if d < SPLIT], [d for d in cal if d >= SPLIT]
    return dict(cagr=cagr(cal, lambda d: dv.get(d, 0.0)), mdd=m.get("mddPct"), bh=cagr(cal, lambda d: bh.get(d, 0.0)), bhmdd=mb.get("mddPct"),
                pre=cagr(pre, lambda d: dv.get(d, 0.0)) if len(pre) > 250 else None, post=cagr(post, lambda d: dv.get(d, 0.0)),
                pos=sum(1 for v in ys.values() if v > 1), ny=len(ys), start=cal[0])


def main():
    uni = {}
    for sym in ("SPY", "QQQ", "TQQQ", "SOXL", "SOXX"):
        uni[sym] = (R43.load_fdr(sym, "1993-01-01"), 252)
    for code in ("069500", "122630", "233740"):
        uni[code] = (R43.load_fdr(code, "2002-01-01"), 252)
    for name, mk in R43.COIN.items():
        uni[name] = (R43.load_coin(mk), 365)
    for k, (rows, _) in uni.items():
        print(f"자료 {k:7} {rows[0][0]}~{rows[-1][0]} · {len(rows)}일")
    out = []
    A = [("A1 누적 RSI", a1), ("A2 HL3", a2), ("A3 볼린저 %b", a3), ("A4 윌리엄스 %R", a4), ("A5 3일 연속 하락", a5)]
    for name, fn in A:
        for sym in ("SPY", "QQQ", "TQQQ", "SOXL", "069500", "122630", "233740", "BTC", "ETH"):
            rows, per = uni[sym]
            s = Ind(rows)
            r20, r40 = run(s, 0.20, *fn(s)), run(s, 0.40, *fn(s))
            m20, m40 = R43.measure(rows, *r20, per), R43.measure(rows, *r40, per)
            ok, why = R43.passes(m20, m40)
            out.append((name, sym, m20, m40, ok, why))
    pairs = [("QQQ", "TQQQ"), ("SOXX", "SOXL"), ("069500", "122630")]
    for name, fn in (("B1 Double 7s(1배 신호)", b1), ("B2 RSI2(1배 신호)", b2)):
        for sg, tr in pairs:
            sig, trd, rows = aligned(uni[sg][0], uni[tr][0])
            r20, r40 = run(trd, 0.20, *fn(sig)), run(trd, 0.40, *fn(sig))
            m20, m40 = R43.measure(rows, *r20, 252), R43.measure(rows, *r40, 252)
            ok, why = R43.passes(m20, m40)
            out.append((name, f"{sg}→{tr}", m20, m40, ok, why))
    print("\n[A · B1 · B2] 방법 · 종목 — 매매 수(연) · 평균 · 승률 · t · 연 복리 · MDD · 플러스 해 · 2020 전 / 2020~ / 최근 2년 · 왕복 0.4% → 1차")
    for name, sym, s, s40, ok, why in out:
        if s is None:
            print(f"  {name:18} {sym:12} 자료 부족")
            continue
        f = lambda x: f"{x[1]:+.2f}%({x[0]})" if x[1] is not None else f"-({x[0]})"
        print(f"  {name:18} {sym:12} {s['n']:5d}({s['tpy']:5.1f}) · {s['mean']:+.2f}% · {s['win'] * 100:3.0f}% · t {s['t']:+5.1f} · 연 {s['cagr']:+6.1f}% · MDD {s['mdd']:6.1f}% · "
              f"{s['pos']}/{s['ny']}해 · {f(s['pre'])} / {f(s['post'])} / {f(s['rec'])} · 0.4% {s40['mean']:+.2f}% → {'통과' if ok else '—'}{'' if ok else ' (' + why + ')'}")
    tout = []
    for name, fn in (("B3 200일 추세(1배 신호)", b3), ("B4 200일 ±3% 띠(1배 신호)", b4)):
        for sg, tr in pairs:
            sig, trd, rows = aligned(uni[sg][0], uni[tr][0])
            _, dv = run(trd, 0.20, *fn(sig))
            tout.append((name, f"{sg}→{tr}", trend_stats(trd, rows, dv, 200, 252)))
    for name, fn in (("C1 골든 크로스", c1), ("C2 파버 10개월", c2)):
        for sym in ("SPY", "QQQ", "TQQQ", "SOXL", "069500", "122630", "BTC", "ETH"):
            rows, per = uni[sym]
            s = Ind(rows)
            _, dv = run(s, 0.20, *fn(s))
            tout.append((name, sym, trend_stats(s, rows, dv, 200, per)))
    print("\n[B3 · B4 · C] 방법 · 종목 — 연 복리 / MDD vs 들고 있기 · 2020 전 / 2020~ 연 복리 · 플러스 해 → 1차(연 복리 ≥ 들고 있기 −2%p · MDD 15%p 이상 얕음 · 두 구간 + · 60%)")
    tpass = []
    for name, sym, t in tout:
        ok = (t["cagr"] >= t["bh"] - 2 and t["mdd"] >= t["bhmdd"] + 15 and (t["pre"] is None or t["pre"] > 0) and t["post"] > 0 and t["pos"] / t["ny"] >= 0.6)
        if ok:
            tpass.append((name, sym, t))
        pre = f"{t['pre']:+.1f}%" if t["pre"] is not None else "-"
        print(f"  {name:22} {sym:12} 연 {t['cagr']:+6.1f}% · MDD {t['mdd']:6.1f}% vs 들고 있기 연 {t['bh']:+6.1f}% · MDD {t['bhmdd']:6.1f}% · {pre} / {t['post']:+.1f}% · {t['pos']}/{t['ny']}해 "
              f"({t['start']}~) → {'통과' if ok else '—'}")
    passed = [x for x in out if x[4]]
    print(f"\n== 1차 통과: 눌림목 · 1배 신호 {len(passed)}개 / {len(out)} · 추세 {len(tpass)}개 / {len(tout)}")
    for name, sym, s, s40, ok, why in sorted(passed, key=lambda x: -x[2]["t"]):
        print(f"  {name} · {sym} — t {s['t']:.1f} · 평균 {s['mean']:+.2f}% · 연 {s['tpy']:.0f}번 · 연 복리 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · 2020 전 {s['pre'][1]:+.2f}% / 2020~ {s['post'][1]:+.2f}%")
    for name, sym, t in tpass:
        print(f"  {name} · {sym} — 연 {t['cagr']:+.1f}% · MDD {t['mdd']:.1f}% (들고 있기 {t['bh']:+.1f}% · {t['bhmdd']:.1f}%)")


if __name__ == "__main__":
    main()
