"""R47 — ③ 돌파 규칙(사용자 고정 메인 g_coin_ma15_s99_hi7_eth)을 업비트 다른 큰 코인에 — 판정표 ① ②.
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-16 R47.
사용: JKQ_DATA=<scalping-data data 사본> python scripts/research/r47_coin_others.py
  - 코인: 업비트 원화 24시간 거래대금 상위(BTC · ETH · 스테이블코인 제외) 중 60분봉이 2021-06-01 이전부터 있는 10개(실행 때 한 번 고름).
  - 장부: 연구실 coin_series 그대로(실시간 화면 · 봇과 같은 식) · 비용 왕복 0.14% · 2021-06-01~ · 자금 80%(100% 참고).
  - 60분봉은 연구실 fetch_hourly 캐시(JKQ_DATA/claude-lab/hourly/{코인}/)에 받는다."""
import json
import math
import statistics
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

FROM, TO, TAB, N_COINS = "2021-06-01", "2026-11-15", 0.8, 10
STABLE = {"USDT", "USDC", "DAI", "TUSD", "USDE", "FDUSD", "PYUSD", "USDS", "BUSD"}
PIN = dict(ma=15, stopPct=99.0, level="prevhigh", k=0.5, hiN=7, lastEntryHour=None, tabSize=TAB)


def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers={"Accept": "application/json"}), timeout=30) as r:
        return json.load(r)


def pick_coins():
    mk = [x["market"] for x in get("https://api.upbit.com/v1/market/all?isDetails=false") if x["market"].startswith("KRW-")]
    tk = []
    for i in range(0, len(mk), 100):
        tk += get("https://api.upbit.com/v1/ticker?markets=" + ",".join(mk[i:i + 100]))
    tk.sort(key=lambda t: -float(t.get("acc_trade_price_24h") or 0))
    out = []
    for t in tk:
        m, c = t["market"], t["market"].split("-")[1]
        if c in ("BTC", "ETH") or c in STABLE:
            continue
        old = get(f"https://api.upbit.com/v1/candles/days?market={m}&count=1&to=2021-06-01T00:00:00Z")   # 2021-06-01 전 일봉이 있나
        if old:
            out.append((m, float(t["acc_trade_price_24h"])))
        if len(out) >= N_COINS:
            break
    return out


def series(m, H, extra=0.0):
    p = dict(L.COIN_BO, **PIN, markets=[m], costRoundTripPct=L.COIN_BO["costRoundTripPct"] + 2 * extra, version="r47")
    _, full, _, _, cal = L.coin_series(p, {m: H})
    cal = [d for d in cal if FROM <= d <= TO]
    return {d: v for d, v in full.items() if FROM <= d <= TO}, cal


def stats(dv, cal, size):
    v = list(dv.values())
    n = len(v)
    mean = statistics.fmean(v) if v else 0.0
    sd = statistics.stdev(v) if n > 1 else 0.0
    m = L.goal_metrics({d: x * size for d, x in dv.items()}, cal, 365)
    eq, ys = 1.0, {}
    for d in cal:
        x = 1 + dv.get(d, 0.0) * size / 100
        eq *= x
        if d in dv:
            ys[d[:4]] = ys.get(d[:4], 1.0) * x
    yrs = len(cal) / 365
    cagr = (eq ** (1 / yrs) - 1) * 100 if yrs > 0 and eq > 0 else float("nan")
    return dict(n=n, mean=mean, t=mean / (sd / math.sqrt(n)) if sd > 0 else 0.0, cagr=cagr, mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                pos=sum(1 for y in ys.values() if y > 1), ny=len(ys), win=sum(1 for x in v if x > 0) / n * 100 if n else 0.0)


def main():
    coins = pick_coins()
    print("고른 코인(24시간 거래대금 · 2021-06 전 자료 있음):", " · ".join(f"{m.split('-')[1]} {a / 1e8:,.0f}억" for m, a in coins))
    rows, passed, plus = [], [], 0
    for m, _ in [("KRW-ETH", 0)] + coins:
        H = L.fetch_hourly(m, start="2021-05-01")
        dv, cal = series(m, H)
        s, s100 = stats(dv, cal, TAB), stats(dv, cal, 1.0)
        line, means = [], []
        for x in (0.05, 0.10, 0.20):
            dv2, cal2 = series(m, H, x)
            s2 = stats(dv2, cal2, TAB)
            line.append(s2["cagr"])
            means.append(s2["mean"])
        ok1 = s["n"] >= 60 and s["mean"] > 0 and s["t"] >= 2.0 and s["ny"] and s["pos"] / s["ny"] >= 0.6 and s["mdd"] >= -25
        ok2 = line[1] > 0 and means[2] >= 0
        tag = "안 표본(참고)" if m == "KRW-ETH" else ("통과" if ok1 and ok2 else "미통과")
        if m != "KRW-ETH":
            plus += s["mean"] > 0
            if ok1 and ok2:
                passed.append(m)
        print(f"{m.split('-')[1]:>5} | {cal[0] if cal else '-'}~ · 매매일 {s['n']:4d} · 평균 {s['mean']:+.2f}% · 승률 {s['win']:.0f}% · t {s['t']:4.1f} · "
              f"연 {s['cagr']:+6.1f}% · MDD {s['mdd']:6.1f}% · 최악일 {s['worst']:6.1f}% · 플러스 해 {s['pos']}/{s['ny']} · (100%: 연 {s100['cagr']:+.1f}% · MDD {s100['mdd']:.1f}%) | "
              f"비용+ {line[0]:+.1f}/{line[1]:+.1f}/{line[2]:+.1f}% · 평균 {means[2]:+.2f}% | ① {'O' if ok1 else 'X'} ② {'O' if ok2 else 'X'} → {tag}")
        rows.append((m, s, ok1, ok2))
    print(f"\n== 밖 표본 {len(coins)}개: ① ② 통과 {len(passed)}개({', '.join(x.split('-')[1] for x in passed) or '없음'}) · 매매 평균 플러스 {plus}/{len(coins)}")
    print("판정:", "3개 이상 → 여러 코인 판을 ⓑ 로" if len(passed) >= 3 else "2개 이하 → 기록만(ETH 만의 성질)")


if __name__ == "__main__":
    main()
