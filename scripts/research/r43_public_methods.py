"""R43 — 시중 유명 매매법 백테스트(발표 규칙 그대로). 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-12 R43(커밋 3050a0c6).
사용: JKQ_DATA=<scalping-data data 사본(claude-lab/hourly)> python scripts/research/r43_public_methods.py
  - 일봉: FinanceDataReader(미국 · 국내 ETF, 가능한 처음부터) · 코인은 업비트 60분봉 캐시로 만든 업비트 하루 봉(연구실 upbit_days).
  - 자금 100% · 매매마다 전액 · 비용 왕복 0.20%(매수 · 매도 반씩) · 확인용 왕복 0.40%.
  - 룩어헤드 금지: 종가로 정한 신호는 다음 날 시가에 체결한다. 장중 돌파(M1~M3)는 기준가(시가가 이미 넘었으면 시가)에 체결된다고 본다.
  - RSI(2)는 연구실 rsi2_at 그대로(④ 와 같은 정의)."""
import math
import statistics
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

US = {"SPY": 1, "QQQ": 1, "TQQQ": 3, "SOXL": 3}
KR = {"069500": 1, "122630": 2, "233740": 2}
COIN = {"BTC": "KRW-BTC", "ETH": "KRW-ETH"}
SPLIT, RECENT = "2020-01-01", "2024-11-12"


def load_fdr(sym, start):
    import FinanceDataReader as fdr
    d = fdr.DataReader(sym, start)
    rows = []
    for i, r in d.iterrows():
        o, h, l, c = (float(r[k]) for k in ("Open", "High", "Low", "Close"))
        if min(o, h, l, c) > 0 and h >= l and h >= max(o, c) * 0.999 and l <= min(o, c) * 1.001:
            rows.append((str(i)[:10], o, h, l, c))
    return rows


def load_coin(market):
    Dd = L.upbit_days(L.fetch_hourly(market))
    return [(d, *Dd[d]) for d in sorted(Dd)]


def sma(C, i, n):
    return sum(C[i - n + 1:i + 1]) / n if i >= n - 1 else None


# ── 방법 — 각자 (매매 목록[(진입일, 청산일, 수익%)], 일 손익 dict) ─────────────────────────────
def intraday(rows, entry_of, cost):
    """그날 안에 사고판다: entry_of(i) → 진입가 또는 None. 청산 = 그날 종가."""
    D, O, H, Lw, C = zip(*rows)
    trades, dv = [], {}
    for i in range(1, len(rows)):
        e = entry_of(i, D, O, H, Lw, C)
        if e is None:
            continue
        r = (C[i] / e - 1) * 100 - cost
        trades.append((D[i], D[i], r))
        dv[D[i]] = r
    return trades, dv


def m1(rows, cost, k=0.5, ma=None):
    def ent(i, D, O, H, Lw, C):
        if ma and (i < ma or not C[i - 1] > sma(C, i - 1, ma)):
            return None
        lv = O[i] + k * (H[i - 1] - Lw[i - 1])
        return max(O[i], lv) if H[i] > lv else None
    return intraday(rows, ent, cost)


def m3(rows, cost):
    def ent(i, D, O, H, Lw, C):
        if i < 8:
            return None
        rg = [H[j] - Lw[j] for j in range(i - 7, i)]          # i−7 … i−1 의 폭 7개
        if rg[-1] > min(rg):
            return None
        return max(O[i], H[i - 1]) if H[i] > H[i - 1] else None
    return intraday(rows, ent, cost)


def m4(rows, cost, g):
    def ent(i, D, O, H, Lw, C):
        return O[i] if O[i] <= C[i - 1] * (1 - g / 100) else None
    return intraday(rows, ent, cost)


def m5(rows, cost):
    D, O, H, Lw, C = zip(*rows)
    trades, dv = [], {}
    for i in range(1, len(rows)):
        r = (O[i] / C[i - 1] - 1) * 100 - cost
        trades.append((D[i - 1], D[i], r))
        dv[D[i]] = r
    return trades, dv


def m6(rows, cost):
    D, O, H, Lw, C = zip(*rows)
    trades, dv = [], {}
    for i in range(1, len(rows)):
        j = i - 1
        ibs = (C[j] - Lw[j]) / (H[j] - Lw[j]) if H[j] > Lw[j] else 0.5
        if ibs < 0.2:
            r = (C[i] / O[i] - 1) * 100 - cost
            trades.append((D[i], D[i], r))
            dv[D[i]] = r
    return trades, dv


def swing(rows, cost, enter_sig, exit_sig):
    """종가로 정한 신호 → 다음 날 시가 체결(④ 와 같은 장부: 매수일 종가/시가 · 보유일 종가/전일 종가 · 매도일 시가/전일 종가)."""
    D, O, H, Lw, C = zip(*rows)
    half = cost / 2
    trades, dv = [], {}
    pos, pending = None, None
    for i in range(len(rows)):
        if pending == "sell" and pos is not None:
            v = (O[i] / C[i - 1] - 1) * 100 - half
            dv[D[i]] = v
            pos[1].append(v)
            trades.append((pos[0], D[i], _compound(pos[1])))
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
            if exit_sig(i, C):
                pending = "sell"
        elif enter_sig(i, C):
            pending = "buy"
    if pos is not None:
        trades.append((pos[0], D[-1], _compound(pos[1])))
    return trades, dv


def _compound(vals):
    eq = 1.0
    for v in vals:
        eq *= 1 + v / 100
    return (eq - 1) * 100


def m7(rows, cost):
    C = [r[4] for r in rows]
    rsi = [L.rsi2_at(C, i, 2) if i >= 2 else None for i in range(len(C))]

    def ent(i, C_):
        m = sma(C_, i, 200)
        return m is not None and C_[i] > m and rsi[i] is not None and rsi[i] < 10

    def ex(i, C_):
        m = sma(C_, i, 5)
        return m is not None and C_[i] > m
    return swing(rows, cost, ent, ex)


def m8(rows, cost):
    def ent(i, C):
        m = sma(C, i, 200)
        return m is not None and i >= 6 and C[i] > m and C[i] <= min(C[i - 6:i + 1])

    def ex(i, C):
        return i >= 6 and C[i] >= max(C[i - 6:i + 1])
    return swing(rows, cost, ent, ex)


def m9(rows, cost):
    """월 마지막 거래일 종가 매수 → 다음 달 세 번째 거래일 종가 매도."""
    D, O, H, Lw, C = zip(*rows)
    half = cost / 2
    trades, dv = [], {}
    i = 0
    n = len(rows)
    while i < n - 1:
        if D[i][:7] != D[i + 1][:7]:                     # i = 그달 마지막 거래일
            k = i + 3                                    # 다음 달 세 번째 거래일
            if k < n and all(D[j][:7] == D[i + 1][:7] for j in range(i + 1, k + 1)):
                vals = []
                for j in range(i + 1, k + 1):
                    v = (C[j] / C[j - 1] - 1) * 100 - (half if j == i + 1 else 0) - (half if j == k else 0)
                    dv[D[j]] = v
                    vals.append(v)
                trades.append((D[i], D[k], _compound(vals)))
                i = k
                continue
        i += 1
    return trades, dv


def m10(rows, cost):
    def ent(i, C):
        m = sma(C, i, 200)
        return m is not None and C[i] > m

    def ex(i, C):
        m = sma(C, i, 200)
        return m is not None and not C[i] > m
    return swing(rows, cost, ent, ex)


METHODS = [
    ("M1 변동성 돌파 k0.5", "하루", lambda r, c, lev, coin: m1(r, c)),
    ("M2 변동성 돌파+5일평균", "하루", lambda r, c, lev, coin: m1(r, c, ma=5)),
    ("M3 NR7 돌파", "하루", lambda r, c, lev, coin: m3(r, c)),
    ("M4 갭 하락 되돌림", "하루", lambda r, c, lev, coin: None if coin else m4(r, c, lev)),
    ("M5 야간 보유", "하루", lambda r, c, lev, coin: None if coin else m5(r, c)),
    ("M6 IBS<0.2 다음 날", "하루", lambda r, c, lev, coin: m6(r, c)),
    ("M7 코너스 RSI2", "여러 날", lambda r, c, lev, coin: m7(r, c)),
    ("M8 Double 7s", "여러 날", lambda r, c, lev, coin: m8(r, c)),
    ("M9 월말 효과", "여러 날", lambda r, c, lev, coin: m9(r, c)),
    ("M10 200일 추세", "추세", lambda r, c, lev, coin: m10(r, c)),
]


def measure(rows, trades, dv, per):
    cal = [r[0] for r in rows]
    rets = [t[2] for t in trades]
    if len(rets) < 2:
        return None
    m = L.goal_metrics(dv, cal, per)
    eq, ys = 1.0, {}
    for d in cal:
        x = 1 + dv.get(d, 0.0) / 100
        eq *= x
        ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = (date.fromisoformat(cal[-1]) - date.fromisoformat(cal[0])).days / 365.25
    traded_years = {t[1][:4] for t in trades}
    mean, sd = statistics.fmean(rets), statistics.stdev(rets)
    pre = [t[2] for t in trades if t[1] < SPLIT]
    post = [t[2] for t in trades if t[1] >= SPLIT]
    rec = [t[2] for t in trades if t[1] >= RECENT]
    return dict(n=len(rets), tpy=len(rets) / yrs, mean=mean, win=sum(1 for x in rets if x > 0) / len(rets), t=mean / (sd / math.sqrt(len(rets))) if sd > 0 else 0,
                cagr=(eq ** (1 / yrs) - 1) * 100 if eq > 0 else -100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                pos=sum(1 for y in traded_years if ys.get(y, 1) > 1), ny=len(traded_years),
                pre=(len(pre), statistics.fmean(pre) if pre else None), post=(len(post), statistics.fmean(post) if post else None),
                rec=(len(rec), statistics.fmean(rec) if rec else None), start=cal[0], end=cal[-1])


def passes(s, s40):
    if s is None or s40 is None:
        return False, "자료 부족"
    why = []
    if s["n"] < 100:
        why.append(f"매매 {s['n']} < 100")
    if s["t"] < 2.5:
        why.append(f"t {s['t']:.1f} < 2.5")
    for name, (n, a) in (("2020 전", s["pre"]), ("2020~", s["post"])):
        if n >= 20 and not (a is not None and a > 0):
            why.append(f"{name} 평균 {a:+.2f}%")
    if s["ny"] and s["pos"] / s["ny"] < 0.6:
        why.append(f"플러스 해 {s['pos']}/{s['ny']}")
    if not s40["mean"] > 0:
        why.append(f"왕복 0.4% 평균 {s40['mean']:+.2f}%")
    return not why, " · ".join(why)


def main():
    uni = []
    for sym, lev in US.items():
        uni.append((sym, lev, False, load_fdr(sym, "1993-01-01"), 252))
    for code, lev in KR.items():
        uni.append((code, lev, False, load_fdr(code, "2002-01-01"), 252))
    for name, mk in COIN.items():
        uni.append((name, 1, True, load_coin(mk), 365))
    for sym, lev, coin, rows, per in uni:
        print(f"자료 {sym:7} {rows[0][0]}~{rows[-1][0]} · {len(rows)}일 · {lev}배" + (" · 코인" if coin else ""))
    out = []
    for mname, kind, fn in METHODS:
        for sym, lev, coin, rows, per in uni:
            r20, r40 = fn(rows, 0.20, lev, coin), fn(rows, 0.40, lev, coin)
            if r20 is None:
                continue
            s, s40 = measure(rows, *r20, per), measure(rows, *r40, per)
            ok, why = passes(s, s40)
            out.append((mname, kind, sym, s, s40, ok, why))
    print("\n방법 · 종목 — 매매 수(연) · 매매 평균 · 승률 · t · 연 복리 · MDD · 최악일 · 플러스 해 · 2020 전 / 2020~ / 최근 2년 매매 평균 · 왕복 0.4% 평균 → 1차")
    for mname, kind, sym, s, s40, ok, why in out:
        if s is None:
            print(f"  {mname:18} {sym:7} 자료 부족")
            continue
        f = lambda x: f"{x[1]:+.2f}%({x[0]})" if x[1] is not None else f"-({x[0]})"
        print(f"  {mname:18} {sym:7} {s['n']:5d}({s['tpy']:5.1f}) · {s['mean']:+.2f}% · {s['win'] * 100:3.0f}% · t {s['t']:+5.1f} · 연 {s['cagr']:+6.1f}% · "
              f"MDD {s['mdd']:6.1f}% · 최악일 {s['worst']:6.1f}% · {s['pos']}/{s['ny']}해 · {f(s['pre'])} / {f(s['post'])} / {f(s['rec'])} · "
              f"0.4% {s40['mean']:+.2f}% → {'통과' if ok else '—'}{'' if ok else ' (' + why + ')'}")
    passed = [x for x in out if x[5]]
    print(f"\n== 1차 통과 {len(passed)}개 / 시험 {len(out)}개")
    for mname, kind, sym, s, s40, ok, why in sorted(passed, key=lambda x: -x[3]["t"]):
        print(f"  {mname} · {sym} ({kind}) — t {s['t']:.1f} · 매매 평균 {s['mean']:+.2f}% · 연 {s['tpy']:.0f}번 · 연 복리 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · "
              f"2020 전 {s['pre'][1]:+.2f}% / 2020~ {s['post'][1]:+.2f}% / 최근 2년 {(s['rec'][1] or 0):+.2f}%({s['rec'][0]})")


if __name__ == "__main__":
    main()
