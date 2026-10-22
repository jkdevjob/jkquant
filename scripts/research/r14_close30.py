"""R14 장 마감 30분 — 15:00 판단 → 15:30 종가 청산 (국내 ETF 6종 · 2년).

사용자 질문(2026-10-22): "시초가 반대로 종가 매매 전략 추가하면 어떨까? 장 종료 30분전에만 거래하는 방법으로"

자료: Yahoo Finance 60분봉(730일) + 일봉. Yahoo 의 국내 분봉은 15:00 에서 끝난다(15:00~15:30 이 없음).
그래서 14시 봉의 종가 = 15:00 가격, 일봉 종가 = 15:30 종가(동시호가)로 마지막 30분을 잰다.
비용: 수수료 0.015% × 2 + 15:00 매수 반 호가(ETF 호가 2,000원 미만 1원 · 이상 5원). 종가 동시호가 매도는 호가 비용 0.

사전 등록(결과 보기 전): 주 가설 H-a — 15:00 까지 오른 날 15:00 매수 → 종가 매도(장중 모멘텀).
보조 H-b — 첫 1시간이 오른 날. 기준선 — 매일 15:00 매수.
통과: 순수익 평균 > 0 · t ≥ 2 · 앞뒤 1년 모두 양수 · MDD ≥ −25% · 최악일 ≥ −15%.

    python3 scripts/research/r14_close30.py <캐시 폴더>
"""
import datetime as dt
import json
import math
import statistics as st
import sys
import time
import urllib.request
from pathlib import Path

NAMES = {"069500": "KODEX 200", "122630": "KODEX 레버리지", "229200": "KODEX 코스닥150", "233740": "KODEX 코스닥150레버리지",
         "114800": "KODEX 인버스", "252670": "KODEX 200선물인버스2X"}
FEE = 0.015 * 2
URL = "https://query1.finance.yahoo.com/v8/finance/chart/{code}.KS?interval={iv}&range={rg}"


def fetch(cache, code, kind):
    path = cache / f"{kind}_{code}.json"
    if not path.exists():
        iv, rg = ("60m", "730d") if kind == "h" else ("1d", "3y")
        req = urllib.request.Request(URL.format(code=code, iv=iv, rg=rg), headers={"User-Agent": "Mozilla/5.0"})
        path.write_bytes(urllib.request.urlopen(req, timeout=40).read())
        time.sleep(1)
    return json.loads(path.read_text())["chart"]["result"][0]


def tick(p):
    return 1 if p < 2000 else 5


def kst(t):
    return dt.datetime.fromtimestamp(t + 9 * 3600, dt.timezone.utc).replace(tzinfo=None)


def load(cache, code):
    h, d = fetch(cache, code, "h"), fetch(cache, code, "d")
    hq, dq = h["indicators"]["quote"][0], d["indicators"]["quote"][0]
    bars, daily = {}, {}
    for i, t in enumerate(h["timestamp"]):
        k = kst(t)
        if hq["close"][i] is None or k.minute:
            continue
        bars.setdefault(k.date(), {})[k.hour] = hq["close"][i]
    for i, t in enumerate(d["timestamp"]):
        if dq["close"][i] is not None:
            daily[kst(t).date()] = dq["close"][i]
    dd = sorted(daily)
    out = []
    for j, k in enumerate(dd):
        if j == 0 or sorted(bars.get(k, {})) != [9, 10, 11, 12, 13, 14]:   # 6시간 정상 장만(수능 · 첫 거래일 늦은 개장 제외)
            continue
        prev, p15, close, p10 = daily[dd[j - 1]], bars[k][14], daily[k], bars[k][9]
        out.append(dict(date=k, sofar=(p15 / prev - 1) * 100, first=(p10 / prev - 1) * 100,
                        last=(close / p15 - 1) * 100, cost=FEE + tick(p15) / 2 / p15 * 100))
    return out


def stats(sel):
    rets = [r["last"] - r["cost"] for r in sel]
    if not rets:
        return None
    n, m = len(rets), st.mean(rets)
    sd = st.pstdev(rets) if n > 1 else 0
    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in rets:
        eq *= 1 + r / 100
        peak = max(peak, eq)
        mdd = min(mdd, (eq / peak - 1) * 100)
    d0, d1 = sel[0]["date"], sel[-1]["date"]
    half = d0 + (d1 - d0) / 2
    return dict(n=n, mean=m, t=(m / (sd / math.sqrt(n)) if sd else 0), win=sum(r > 0 for r in rets) / n * 100,
                cum=(eq - 1) * 100, mdd=mdd, worst=min(rets), plus1=sum(r >= 1 for r in rets),
                h1=sum(r["last"] - r["cost"] for r in sel if r["date"] <= half),
                h2=sum(r["last"] - r["cost"] for r in sel if r["date"] > half))


def main():
    cache = Path(sys.argv[1] if len(sys.argv) > 1 else "r14-cache")
    cache.mkdir(parents=True, exist_ok=True)
    rules = [("기준선 매일 15:00 매수", lambda r: True), ("H-a 15:00까지 오른 날", lambda r: r["sofar"] > 0),
             ("H-b 첫 1시간 오른 날", lambda r: r["first"] > 0), ("(사후) 15:00까지 내린 날", lambda r: r["sofar"] < 0),
             ("(사후) 15:00까지 −3% 이하", lambda r: r["sofar"] <= -3)]
    for code, nm in NAMES.items():
        rows = load(cache, code)
        print(f"\n{code} {nm}: {len(rows)}일 {rows[0]['date']}~{rows[-1]['date']} · 마지막 30분 평균(비용 전) "
              f"{st.mean(r['last'] for r in rows):+.3f}% · 비용 {st.mean(r['cost'] for r in rows):.3f}%")
        for tag, pick in rules:
            s = stats([r for r in rows if pick(r)])
            if not s:
                print(f"  {tag:<24} 매매 없음")
                continue
            ok = s["mean"] > 0 and s["t"] >= 2 and s["h1"] > 0 and s["h2"] > 0 and s["mdd"] >= -25 and s["worst"] >= -15
            print(f"  {tag:<24} n={s['n']:>3} 평균 {s['mean']:+.3f}% t={s['t']:+.2f} 승 {s['win']:.0f}% 누적 {s['cum']:+.1f}% "
                  f"MDD {s['mdd']:.1f}% 최악 {s['worst']:+.2f}% 앞/뒤 {s['h1']:+.1f}/{s['h2']:+.1f} +1%일 {s['plus1']}"
                  f"{' ← 기준 통과' if ok else ''}")


if __name__ == "__main__":
    main()
