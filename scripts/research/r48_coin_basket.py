"""R48 — 큰 코인 바구니(③ 고정 규칙) — 섞으면 낙폭이 줄어드는가 · 판정표 ① ②.
사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-17 R48(커밋 80fd4bc3).
사용: JKQ_DATA=<scalping-data data 사본> python scripts/research/r48_coin_basket.py
  - 코인: 업비트 원화 시장 중 2021-05-01~05-31 일봉 거래대금 합 상위 5개(BTC · ETH · 스테이블코인 제외 · 지금 상장된 것만 받을 수 있음).
  - 바구니: 연구실 coin_series(여러 코인 = 칸 안 고정 몫 합 basket) 그대로 · 비용 왕복 0.14% · 2021-06-01~2026-11-15 · 자금 80%(100% 참고).
  - 판정 지표 · 기준은 R47 과 같은 함수(r47_coin_others.stats)."""
import importlib.util
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("r47", str(HERE / "r47_coin_others.py"))
R47 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R47)
L = R47.L
FROM, TO, TAB = R47.FROM, R47.TO, R47.TAB
PIN = R47.PIN


def get(u):
    for a in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"Accept": "application/json"}), timeout=30) as r:
                return json.load(r)
        except Exception:  # noqa: BLE001
            time.sleep(1 + a)
    return None


def pick_2021(n=5):
    """2021-05-01~05-31 일봉 거래대금 합 상위 n(BTC · ETH · 스테이블코인 제외)."""
    mk = [x["market"] for x in get("https://api.upbit.com/v1/market/all?isDetails=false") if x["market"].startswith("KRW-")]
    val = []
    for m in mk:
        c = m.split("-")[1]
        if c in ("BTC", "ETH") or c in R47.STABLE:
            continue
        d = get(f"https://api.upbit.com/v1/candles/days?market={m}&count=31&to=2021-06-01T00:00:00Z") or []
        v = sum(float(x.get("candle_acc_trade_price") or 0) for x in d if "2021-05-01" <= str(x.get("candle_date_time_kst", ""))[:10] <= "2021-05-31")
        if v > 0:
            val.append((v, m))
        time.sleep(0.11)
    val.sort(reverse=True)
    return val[:n], len(mk)


def basket(markets, H_by, extra=0.0):
    p = dict(L.COIN_BO, **PIN, markets=list(markets), costRoundTripPct=L.COIN_BO["costRoundTripPct"] + 2 * extra, version="r48")
    _, full, _, _, cal = L.coin_series(p, H_by)
    cal = [d for d in cal if FROM <= d <= TO]
    return {d: v for d, v in full.items() if FROM <= d <= TO}, cal


def main():
    top, n_all = pick_2021()
    coins = [m for _, m in top]
    print(f"2021-05 거래대금 상위 5(지금 원화 시장 {n_all}개 중 · BTC · ETH · 스테이블 제외):", " · ".join(f"{m.split('-')[1]} {v / 1e12:,.1f}조" for v, m in top))
    H_by = {m: L.fetch_hourly(m, start="2021-05-01") for m in ["KRW-ETH"] + coins}
    singles = {}
    for m in coins:
        dv, cal = basket([m], H_by)
        singles[m] = R47.stats(dv, cal, TAB)
        s = singles[m]
        print(f"   {m.split('-')[1]:>5} 하나: 매매일 {s['n']} · 평균 {s['mean']:+.2f}% · t {s['t']:.1f} · 연 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · 플러스 해 {s['pos']}/{s['ny']}")
    med_mdd = statistics.median(s["mdd"] for s in singles.values())
    for tag, mk in (("(가) 밖 표본 5개", coins), ("(나) 참고: ETH + 5개", ["KRW-ETH"] + coins)):
        dv, cal = basket(mk, H_by)
        s, s100 = R47.stats(dv, cal, TAB), R47.stats(dv, cal, 1.0)
        line, means = [], []
        for x in (0.05, 0.10, 0.20):
            dv2, cal2 = basket(mk, H_by, x)
            s2 = R47.stats(dv2, cal2, TAB)
            line.append(s2["cagr"])
            means.append(s2["mean"])
        ok1 = s["n"] >= 60 and s["mean"] > 0 and s["t"] >= 2.0 and s["ny"] and s["pos"] / s["ny"] >= 0.6 and s["mdd"] >= -25
        ok2 = line[1] > 0 and means[2] >= 0
        print(f"\n== {tag}: 매매일 {s['n']} · 날 평균 {s['mean']:+.2f}% · t {s['t']:.1f} · 연 {s['cagr']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.1f}% · 플러스 해 {s['pos']}/{s['ny']} · "
              f"(100%: 연 {s100['cagr']:+.1f}% · MDD {s100['mdd']:.1f}%) | 비용+ {line[0]:+.1f}/{line[1]:+.1f}/{line[2]:+.1f}% · 평균 {means[2]:+.3f}% | ① {'O' if ok1 else 'X'} ② {'O' if ok2 else 'X'}")
        if tag.startswith("(가)"):
            print(f"   바구니 MDD {s['mdd']:.1f}% vs 코인 하나씩 MDD 중앙값 {med_mdd:.1f}% · 판정 → {'통과 — 다음 ⓑ' if ok1 and ok2 else '기록만'}")


if __name__ == "__main__":
    main()
