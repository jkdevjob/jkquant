#!/usr/bin/env python3
"""R32 ① 후보 분봉 분석 — 매수 시각(시가 · 1~10분 뒤) · 장중 경로 · 분봉 손절 (2026-11-07 · 자료가 쌓이면 매주 다시 돌린다).

자료: data/minute-opening/{날짜}.json(네이버 1분 종가 · 정규장 · 장 마감 뒤 받은 재구성 자료) + data/opening-gapdown-live/{날짜}.json(기준가)
      + 공식 시가 · KRX 종가 캐시(r28 과 같은 prices.json — 없으면 FDR 로 받아 채움).
연구 정의로 고른다: 그날 실제 시가갭 −2~−29% 종목 수 ≥ 7 인 날, 실제 갭 ≤ −3% 깊은 3(경쟁군 메인 minQ 7 · gapMax −3 · topK 3).
  A 매수 시각: 공식 시가(동시호가) vs 09:00 · 09:01 · 09:05 · 09:10 분봉 종가 — 모두 종가(15:30 분봉 = 종가 동시호가) 매도 · 같은 비용(0.23% + 1.5틱×2).
     '실제 시가를 보고 고른 뒤 사면'(R31-나) 얼마나 비싸게 사는가가 이것이다.
  B 장중 경로: 시가 대비 09:01 · 09:05 · 09:10 · 09:30 · 10:00 · 11:00 · 13:00 · 15:30 · 분봉 종가 기준 최고 · 최저와 그 시각.
  C 분봉 손절(R29 미리보기): 분봉 종가가 시가 대비 −X% 이하가 된 첫 분 종가에 판다(다음 분 체결 가정보다 낙관적일 수 있음).
사용: python3 scripts/research/r32_opening_minutes.py minute_opening_dir live_dir prices.json
"""
import glob, json, os, statistics as st, sys

MDIR, LIVE, CACHE = sys.argv[1:4]
KR_TICK = [(2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100), (500000, 500)]


def tick(p):
    for u, t in KR_TICK:
        if p < u:
            return t
    return 1000


def cost(p):
    return 0.23 + 2 * 1.5 * tick(p) / p * 100


cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}


def bar(code, day):
    b = (cache.get(code) or {}).get(day)
    if b and b.get("o"):
        return b
    try:
        import FinanceDataReader as fdr
        d = fdr.DataReader(code, day, day)
        if len(d):
            r = d.iloc[0]
            cache.setdefault(code, {})[day] = dict(o=float(r["Open"]), h=float(r["High"]), l=float(r["Low"]), c_fdr=float(r["Close"]))
            return cache[code][day]
    except Exception:  # noqa: BLE001
        pass
    return None


def line(nm, xs):
    if not xs:
        return f"  {nm}: 없음"
    return f"  {nm}: {len(xs)}건 · 평균 {st.fmean(xs):+.2f}% · 중앙값 {st.median(xs):+.2f}% · 승률 {sum(1 for x in xs if x > 0) / len(xs) * 100:.0f}%"


def at(rows, hm):
    """hm 분봉 종가(그 분봉이 없으면 그 앞 마지막 분봉 · 거래정지 등)."""
    v = None
    for t, c, _ in rows:
        if t <= hm:
            v = c
        else:
            break
    return v


trades, check, days_used = [], [], []
for f in sorted(glob.glob(os.path.join(MDIR, "*.json"))):
    M = json.load(open(f, encoding="utf-8"))
    day = M["date"]
    lp = os.path.join(LIVE, day + ".json")
    if not os.path.exists(lp):
        continue
    base = {}
    for e in json.load(open(lp, encoding="utf-8"))["ledger"]["events"]:
        cs = (e.get("payload") or {}).get("candidates")            # preopen 의 candidates 는 개수(정수) — 시세 단계만 목록
        for c in cs if isinstance(cs, list) else []:
            if isinstance(c, dict) and c.get("basePrice"):
                base[c["code"]] = c["basePrice"]
    rows = []
    for code, x in M["codes"].items():
        b = bar(code, day)
        if not b or not base.get(code) or not x["rows"]:
            continue
        gap = (b["o"] / base[code] - 1) * 100
        rows.append(dict(code=code, name=x["name"], gap=gap, open=b["o"], krx=b.get("c"), m=x["rows"]))
        if b.get("c"):
            check.append(abs(x["rows"][-1][1] - b["c"]) < 1e-6 if x["rows"][-1][0] == "15:30" else None)
    q = sum(1 for r in rows if -29 <= r["gap"] <= -2)
    if q < 7:
        continue
    picks = sorted([r for r in rows if -29 < r["gap"] <= -3], key=lambda r: (r["gap"], r["code"]))[:3]
    days_used.append(f"{day[5:]}(통과 {q})")
    for r in picks:
        close = r["krx"] or (r["m"][-1][1] if r["m"][-1][0] == "15:30" else None)
        if not close:
            continue
        trades.append(dict(r, day=day, close=close))
late = [f"{t['day'][5:]} {t['name']} 첫 분봉 {t['m'][0][0]}" for t in trades if t["m"][0][0] > "09:00"]
print(f"═ 자료 점검: 첫 분봉이 09:00 이 아닌 매매(거래정지 · 서킷브레이커 등 — 그 시각 값은 앞 분봉으로 두지 않고 비움) {len(late)}건 {late[:4]}")
print(f"═ 자료 점검: 15:30 분봉 종가 = KRX 종가 {sum(1 for c in check if c)}/{sum(1 for c in check if c is not None)} · 분석 매매일 {len(days_used)}: {' '.join(days_used)} · 매매 {len(trades)}건 (판정용 아님 — 표본이 쌓이면 다시)")
print("═ A 매수 시각 — 시가 대비 매수가 · 종가 매도 순손익")
for hm in ("open", "09:00", "09:01", "09:05", "09:10"):
    px = [(t["open"] if hm == "open" else at(t["m"], hm)) for t in trades]
    ok = [(t, p) for t, p in zip(trades, px) if p]
    prem = [(p / t["open"] - 1) * 100 for t, p in ok]
    pnl = [(t["close"] / p - 1) * 100 - cost(p) for t, p in ok]
    print(f"  {('공식 시가' if hm == 'open' else hm + ' 분봉 종가'):>12}: 매수가 시가 대비 {st.fmean(prem) if prem else 0:+.2f}% · " + line("순손익", pnl).strip())
print("═ B 장중 경로 — 시가 대비(분봉 종가)")
for hm in ("09:01", "09:05", "09:10", "09:30", "10:00", "11:00", "13:00", "15:30"):
    xs = [(at(t["m"], hm) / t["open"] - 1) * 100 for t in trades if at(t["m"], hm)]
    print(f"  {hm}: 평균 {st.fmean(xs):+.2f}% · 중앙값 {st.median(xs):+.2f}%" if xs else f"  {hm}: 없음")
mx = [max(t["m"], key=lambda r: r[1]) for t in trades]
mn = [min(t["m"], key=lambda r: r[1]) for t in trades]
if trades:
    print(f"  분봉 최고: 평균 {st.fmean((b[1] / t['open'] - 1) * 100 for t, b in zip(trades, mx)):+.2f}% · 시각 중앙값 {sorted(b[0] for b in mx)[len(mx) // 2]}")
    print(f"  분봉 최저: 평균 {st.fmean((b[1] / t['open'] - 1) * 100 for t, b in zip(trades, mn)):+.2f}% · 시각 중앙값 {sorted(b[0] for b in mn)[len(mn) // 2]}")
print("═ C 분봉 손절(시가 대비 −X% 이하 첫 분봉 종가에 매도)")
base_pnl = [(t["close"] / t["open"] - 1) * 100 - cost(t["open"]) for t in trades]
print(line("손절 없음", base_pnl))
for X in (3, 5):
    out = []
    for t in trades:
        ex = next((c for hm, c, _ in t["m"] if (c / t["open"] - 1) * 100 <= -X), None)
        out.append(((ex or t["close"]) / t["open"] - 1) * 100 - cost(t["open"]))
    print(line(f"손절 −{X}%", out))
print("═ 매매별")
for t in trades:
    p1 = at(t["m"], "09:01")
    s1 = "—" if p1 is None else f"{(p1 / t['open'] - 1) * 100:+.2f}%"
    hi = (max(r[1] for r in t["m"]) / t["open"] - 1) * 100
    print(f"  {t['day']} {t['name']} 갭 {t['gap']:+.1f}% · 첫 분봉 {t['m'][0][0]} · 09:01 {s1} · 최고 {hi:+.2f}% · 종가 {(t['close'] / t['open'] - 1) * 100:+.2f}%")
json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
