"""R49 — 해마다 다시 고르는 큰 코인 바구니(③ 고정 규칙 · 정직한 걸어가기) · 판정표 ① ②.
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-18 R49(커밋 ca496dcb).
사용: JKQ_DATA=<scalping-data data 사본> python scripts/research/r49_coin_yearly.py
  - 구간: 2021-06-01~12-31 · 2022 · 2023 · 2024 · 2025 · 2026-01-01~11-15. 코인 = 구간 시작 전 12개월 원화 거래대금(주봉 합) 상위 5(BTC · ETH · 스테이블 제외).
  - 구간마다 연구실 coin_series(1/5 씩) → 구간 날짜만 잘라 이어 붙임(③ 은 하루 안 매매). 지표 · 기준은 R47 stats 그대로."""
import importlib.util
import time
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("r48", str(HERE / "r48_coin_basket.py"))
R48 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R48)
R47, L = R48.R47, R48.L
TAB = R48.TAB
PERIODS = [("2021-06-01", "2021-12-31"), ("2022-01-01", "2022-12-31"), ("2023-01-01", "2023-12-31"), ("2024-01-01", "2024-12-31"),
           ("2025-01-01", "2025-12-31"), ("2026-01-01", "2026-11-15")]
N = 5


def weekly_values(markets):
    """코인마다 주봉 거래대금 {주 시작일: 원}. 200주씩 두 번(2019~)."""
    out = {}
    for m in markets:
        c = m.split("-")[1]
        if c in ("BTC", "ETH") or c in R47.STABLE:
            continue
        w = {}
        for to in ("2026-11-17T00:00:00Z", "2023-01-01T00:00:00Z"):
            for x in R48.get(f"https://api.upbit.com/v1/candles/weeks?market={m}&count=200&to={to}") or []:
                w[str(x.get("candle_date_time_kst", ""))[:10]] = float(x.get("candle_acc_trade_price") or 0)
            time.sleep(0.11)
        out[m] = w
    return out


def pick(wv, start):
    """start 전 12개월(주 시작일이 [start−365일, start)) 거래대금 합 상위 N."""
    a = (date.fromisoformat(start) - timedelta(days=365)).isoformat()
    tot = sorted(((sum(v for d, v in w.items() if a <= d < start), m) for m, w in wv.items()), reverse=True)
    return [(m, v) for v, m in tot[:N] if v > 0]


def chained(periods_coins, H_by, extra=0.0, with_eth=False):
    dv, cal = {}, []
    for (s, e), coins in periods_coins:
        mk = (["KRW-ETH"] if with_eth else []) + [m for m, _ in coins]
        d1, c1 = R48.basket(mk, H_by, extra)
        dv.update({d: v for d, v in d1.items() if s <= d <= e})
        cal += [d for d in c1 if s <= d <= e]
    return dv, sorted(set(cal))


def main():
    mk = [x["market"] for x in R48.get("https://api.upbit.com/v1/market/all?isDetails=false") if x["market"].startswith("KRW-")]
    wv = weekly_values(mk)
    pc = [((s, e), pick(wv, s)) for s, e in PERIODS]
    for (s, e), coins in pc:
        print(f"{s}~{e}: " + " · ".join(f"{m.split('-')[1]} {v / 1e12:,.1f}조" for m, v in coins))
    need = sorted({m for _, cs in pc for m, _ in cs} | {"KRW-ETH"})
    H_by = {m: L.fetch_hourly(m, start="2021-05-01") for m in need}
    for tag, we in (("(가) 해마다 고른 5개", False), ("(나) 참고: ETH + 해마다 고른 5개", True)):
        dv, cal = chained(pc, H_by, 0.0, we)
        s, s100 = R47.stats(dv, cal, TAB), R47.stats(dv, cal, 1.0)
        line, means = [], []
        for x in (0.05, 0.10, 0.20):
            dv2, cal2 = chained(pc, H_by, x, we)
            s2 = R47.stats(dv2, cal2, TAB)
            line.append(s2["cagr"])
            means.append(s2["mean"])
        ok1 = s["n"] >= 60 and s["mean"] > 0 and s["t"] >= 2.0 and s["ny"] and s["pos"] / s["ny"] >= 0.6 and s["mdd"] >= -25
        ok2 = line[1] > 0 and means[2] >= 0
        ys = {}
        for d in cal:
            ys[d[:4]] = ys.get(d[:4], 1.0) * (1 + dv.get(d, 0.0) * TAB / 100)
        print(f"\n== {tag}: 매매일 {s['n']} · 날 평균 {s['mean']:+.3f}% · t {s['t']:.3f} · 연 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.1f}% · 플러스 해 {s['pos']}/{s['ny']} · "
              f"(100%: 연 {s100['cagr']:+.1f}% · MDD {s100['mdd']:.1f}%) | 비용+ {line[0]:+.1f}/{line[1]:+.1f}/{line[2]:+.1f}% · 평균 {means[2]:+.3f}% | ① {'O' if ok1 else 'X'} ② {'O' if ok2 else 'X'}")
        print("   해마다:", " · ".join(f"{y} {(v - 1) * 100:+.1f}%" for y, v in sorted(ys.items())))
        if not we:
            print("   판정 →", "통과 — 다음 ⓑ" if ok1 and ok2 else "기록만")


if __name__ == "__main__":
    main()
