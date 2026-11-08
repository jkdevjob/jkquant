#!/usr/bin/env python3
"""R34 정해진 시간 안에서만 매매 — 사전 등록(CLAUDE-SCALPING-RESEARCH.md R34 · 2026-11-08) 그대로 잰다.

A ① 매도 시각: 연구 신호(시가 매수)를 10:00 · 11:00 · … · 15:00(야후 60분봉 2년) · 09:05~09:30(5분봉 60일) · 종가에 팔면.
B ⑤ 매수 시각: 233740 이 그 시각 전일 종가보다 낮으면 매수 → 15:30 종가 매도 — 15:00(지금) · 14:00 · 13:00(60분봉 캐시) · 14:30(30분봉 60일).
C ② · ④ 최대 24시간 판: ②-24 금요일 · 연휴 전 진입 뺌 · ④-24 다음 날 시가 → 그다음 날 시가(금요일 매수 뺌).
사용: python3 scripts/research/r34_windows.py signals.csv decisions.csv yahoo_dir bars.json kr-hourly-233740.json etf_30m.json
  yahoo_dir = {종목}.{KS|KQ}_{60m|5m|30m}.json(야후 chart 원본) · bars.json = R33 일봉(233740 · SOXL).
"""
import csv, importlib.util, json, os, statistics as st, sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

SIG, DEC, YDIR, BARS, KRH, E30 = sys.argv[1:7]
spec = importlib.util.spec_from_file_location("lab", Path(__file__).resolve().parents[1] / "claude_lab.py")
L = importlib.util.module_from_spec(spec)
spec.loader.exec_module(L)
KST = timezone(timedelta(hours=9))


def tstat(xs):
    n = len(xs)
    sd = st.pstdev(xs) if n > 1 else 0
    return st.fmean(xs) / (sd / n ** 0.5) if sd else 0.0


def line(nm, xs):
    if not xs:
        return f"  {nm}: 없음"
    return f"  {nm}: {len(xs)}건 · 평균 {st.fmean(xs):+.2f}% · 중앙값 {st.median(xs):+.2f}% · 승률 {sum(1 for x in xs if x > 0) / len(xs) * 100:.0f}% · t {tstat(xs):+.1f}"


def gm(dv, cal, per):
    m = L.goal_metrics(dv, cal, per)
    y = L.year_stats(dv, cal)
    return (f"매매일 {m['tradeDays']} · 평균 {m['expectancyPct'] or 0:+.3f}% · 주 평균 {m['weeklyAvgPct'] or 0:+.3f}% · 누적 {m['totalPct']:+.0f}% · "
            f"MDD {m['mddPct']:.1f}% · 최악일 {m['worstDayPct']:+.2f}% · 플러스 해 {y.get('pos')}/{y.get('n')}"), m, y


def yahoo(path):
    """야후 chart → {날짜: [(HH:MM 봉 시작, 종가), …]} — 값 없는 봉은 버린다."""
    if not os.path.exists(path):
        return {}
    try:
        r = json.load(open(path, encoding="utf-8"))["chart"]["result"][0]
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    q = r["indicators"]["quote"][0]
    for t, o, c in zip(r.get("timestamp") or [], q.get("open") or [], q.get("close") or []):
        if c is None:
            continue
        k = datetime.fromtimestamp(t, KST)
        out.setdefault(k.strftime("%Y-%m-%d"), []).append((k.strftime("%H:%M"), float(o) if o is not None else None, float(c)))
    return out


def bar_close_at(bars, start, step_min):
    """'봉 끝 시각' 가격 = 그 봉(start) 종가. start 봉이 없으면 None(거래정지 · VI 로 빈 봉을 앞 값으로 채우지 않는다)."""
    for hm, _, c in bars:
        if hm == start:
            return c
    return None


def day_open(bars):
    """그날 첫 봉(09:00)의 시가 — 같은 원천 · 같은 조정 기준 안에서만 비율을 잰다(야후는 뒤 액면병합 등을 지난 가격에 소급 조정)."""
    for hm, o, _ in bars:
        if hm == "09:00" and o:
            return o
    return None


# ── A ① 매도 시각 ──────────────────────────────────────────────────────────────────────────────
dec = {r["date"]: int(r["rsiPassed"] or 0) for r in csv.DictReader(open(DEC, encoding="utf-8"))}
sig = [r for r in csv.DictReader(open(SIG, encoding="utf-8")) if r.get("variant", "baseline") == "baseline" and r["date"] >= "2024-11-07"]
byday = {}
for r in sig:
    byday.setdefault(r["date"], []).append(r)
main = set()
for d, rs in byday.items():
    if dec.get(d, 0) >= 7:
        for r in sorted([r for r in rs if float(r["gapPct"]) <= -3], key=lambda r: (float(r["gapPct"]), float(r["pnl"])))[:3]:
            main.add(r["signalId"])
EX60 = [("10:00", "09:00"), ("11:00", "10:00"), ("12:00", "11:00"), ("13:00", "12:00"), ("14:00", "13:00"), ("15:00", "14:00")]
EX5 = [("09:05", "09:00"), ("09:10", "09:05"), ("09:15", "09:10"), ("09:20", "09:15"), ("09:30", "09:25"), ("10:00", "09:55")]
cache = {}
res = []
for r in sig:
    t = r["code"] + (".KS" if r["market"] == "KOSPI" else ".KQ")
    for iv in ("60m", "5m"):
        if (t, iv) not in cache:
            cache[(t, iv)] = yahoo(os.path.join(YDIR, f"{t}_{iv}.json"))
    o, c, fr = float(r["entryPrice"]), float(r["exitPrice"]), float(r["frictionPct"])
    x = dict(id=r["signalId"], date=r["date"], main=r["signalId"] in main, close=(c / o - 1) * 100 - fr, ex60={}, ex5={}, chk=None)
    b60 = cache[(t, "60m")].get(r["date"]) or []
    yo = day_open(b60)
    if yo:
        for nm, stt in EX60:
            p = bar_close_at(b60, stt, 60)
            if p:
                x["ex60"][nm] = (p / yo - 1) * 100 - fr
        p15 = bar_close_at(b60, "14:00", 60)                       # 자료 점검: 야후 15:00 가격 기준 당일 수익 ≈ 연구 종가 기준 당일 수익(마지막 30분만큼 차이)
        if p15:
            x["chk"] = abs((p15 / yo - 1) * 100 - (c / o - 1) * 100)
    b5 = cache[(t, "5m")].get(r["date"]) or []
    yo5 = day_open(b5)
    if yo5:
        for nm, stt in EX5:
            p = bar_close_at(b5, stt, 5)
            if p:
                x["ex5"][nm] = (p / yo5 - 1) * 100 - fr
    res.append(x)
have60 = [x for x in res if len(x["ex60"]) == len(EX60)]
print(f"═ A ① 매도 시각 · 신호 {len(res)}건(2024-11-07~) · 60분봉 다 있는 {len(have60)}건 · 메인 매매 {sum(1 for x in have60 if x['main'])}건")
ck = [x["chk"] for x in res if x["chk"] is not None]
if ck:
    print(f"  자료 점검: 야후(시가 → 15:00) 당일 수익과 연구(공식 시가 → 종가) 당일 수익의 차이 — 중앙값 {st.median(ck):.2f}%p · 2%p 안 {sum(1 for v in ck if v <= 2) / len(ck) * 100:.0f}% ({len(ck)}건 · 15:00~15:30 움직임만큼은 다르다)")
mid = "2025-11-07"
for grp, sel in (("A1 메인 매매", lambda x: x["main"]), ("A2 모든 신호", lambda x: True)):
    for half, hs in (("전체", lambda x: True), ("앞 1년", lambda x: x["date"] < mid), ("뒤 1년", lambda x: x["date"] >= mid)):
        g = [x for x in have60 if sel(x) and hs(x)]
        if not g:
            continue
        cells = " · ".join(f"{nm} {st.fmean(x['ex60'][nm] for x in g):+.2f}" for nm, _ in EX60) + f" · 종가 {st.fmean(x['close'] for x in g):+.2f}"
        print(f"  {grp} {half} {len(g)}건: {cells}")
g1 = [x for x in have60 if x["main"] and x["date"] < mid]
if g1:
    best = max([nm for nm, _ in EX60] + ["종가"], key=lambda nm: st.fmean((x["close"] if nm == "종가" else x["ex60"][nm]) for x in g1))
    g2 = [x for x in have60 if x["main"] and x["date"] >= mid]
    v = lambda g, nm: st.fmean((x["close"] if nm == "종가" else x["ex60"][nm]) for x in g)
    a2 = [x for x in have60]
    ok = best != "종가" and g2 and v(g2, best) > v(g2, "종가") and v(a2, best) > v(a2, "종가")
    print(f"  ▶ 앞 1년 최고 = {best} · 뒤 1년 {best} {v(g2, best):+.2f} vs 종가 {v(g2, '종가'):+.2f} · 모든 신호 {best} {v(a2, best):+.2f} vs 종가 {v(a2, '종가'):+.2f} → {'권고: ' + best + ' 매도' if ok else '종가 유지 권고'}")
for nm in ("10:00", "15:00"):
    print(line(f"A1 {nm} 매도(2년)", [x["ex60"][nm] for x in have60 if x["main"]]))
print(line("A1 종가 매도(2년)", [x["close"] for x in have60 if x["main"]]))
have5 = [x for x in res if len(x["ex5"]) == len(EX5)]
print(f"  5분봉(60일) {len(have5)}건 — 참고: " + " · ".join(f"{nm} {st.fmean(x['ex5'][nm] for x in have5):+.2f}" for nm, _ in EX5) + (f" · 종가 {st.fmean(x['close'] for x in have5):+.2f}" if have5 else ""))
m5 = [x for x in have5 if x["main"]]
if m5:
    print(f"  5분봉 메인 매매 {len(m5)}건: " + " · ".join(f"{nm} {st.fmean(x['ex5'][nm] for x in m5):+.2f}" for nm, _ in EX5) + f" · 종가 {st.fmean(x['close'] for x in m5):+.2f}")

# ── B ⑤ 매수 시각 ──────────────────────────────────────────────────────────────────────────────
B = json.load(open(BARS, encoding="utf-8"))
KR, US = B["233740"], B["SOXL"]
H = json.load(open(KRH, encoding="utf-8"))
prevc = {KR[i][0]: KR[i - 1][4] for i in range(1, len(KR))}
closep = {r[0]: r[4] for r in KR}


def c30cost(p):
    return 0.03 + (5 if p >= 2000 else 1) / 2 / p * 100


cal5 = [d for d in sorted(H) if d in prevc and sorted(int(k) for k in H[d]) == [9, 10, 11, 12, 13, 14] and abs((float(H[d]["14"]) / prevc[d] - 1) * 100) <= 35]
print(f"\n═ B ⑤ 매수 시각 · 233740 60분봉 {cal5[0]}~{cal5[-1]} · {len(cal5)}거래일")
half = cal5[len(cal5) // 2]
for nm, key in (("15:00(지금)", "14"), ("14:00", "13"), ("13:00", "12")):
    dv = {}
    for d in cal5:
        p = float(H[d][key])
        if p / prevc[d] - 1 < 0:
            dv[d] = (closep[d] / p - 1) * 100 - c30cost(p)
    s_all, _, _ = gm(dv, cal5, 250)
    s1, _, _ = gm({d: v for d, v in dv.items() if d < half}, [d for d in cal5 if d < half], 250)
    s2, _, _ = gm({d: v for d, v in dv.items() if d >= half}, [d for d in cal5 if d >= half], 250)
    print(f"  {nm} 전체: {s_all}\n     앞 절반: {s1}\n     뒤 절반: {s2}")
e30 = yahoo(E30)
r30 = {"14:30": [], "15:00": [], "14:00": []}
for d, bars in e30.items():
    if d not in prevc or d not in closep:
        continue
    for nm, stt in (("14:00", "13:30"), ("14:30", "14:00"), ("15:00", "14:30")):
        p = bar_close_at(bars, stt, 30)
        if p and p / prevc[d] - 1 < 0:
            r30[nm].append((closep[d] / p - 1) * 100 - c30cost(p))
print("  30분봉 60일 참고: " + " · ".join(f"{nm} {len(v)}건 평균 {st.fmean(v) if v else 0:+.2f}%" for nm, v in r30.items()))

# ── C ② · ④ 최대 24시간 판 ───────────────────────────────────────────────────────────────────
def kr_cost(p):
    return 2 * 0.015 + 2 * (5 if p >= 2000 else 1) / p * 100


print("\n═ C ② · ④ 최대 24시간 판")
kc = [r[0] for r in KR]
cur, lim = {}, {}
for i in range(1, len(KR) - 1):
    if (KR[i][4] / KR[i - 1][4] - 1) * 100 <= -4.75:
        v = (KR[i + 1][1] / KR[i][4] - 1) * 100 - kr_cost(KR[i][4])
        cur[KR[i + 1][0]] = v
        if (date.fromisoformat(KR[i + 1][0]) - date.fromisoformat(KR[i][0])).days == 1:
            lim[KR[i + 1][0]] = v
vc = [d for d in kc if d >= "2020"]
for nm, dv in (("② 지금(제한 없음 · 금요일 → 월요일 포함)", cur), ("②-24(금요일 · 연휴 전 진입 뺌)", lim)):
    s, _, _ = gm({d: v for d, v in dv.items() if d >= "2020"}, vc, 250)
    print(f"  {nm}: {s}")
wk = {d: v for d, v in cur.items() if d >= "2020" and d not in lim}
print(line("  ② 빠지는 매매(주말 · 연휴 넘김)", list(wk.values())))
C = [r[4] for r in US]
O = [r[1] for r in US]
D = [r[0] for r in US]
lim4 = {}
for i in range(100, len(US) - 2):
    hi, lo = US[i][2], US[i][3]
    ibs = (C[i] - lo) / (hi - lo) if hi > lo else 0.5
    if L.rsi2_at(C, i, 2) < 30 and ibs <= 0.6 and C[i] > sum(C[i - 99:i + 1]) / 100:
        d1, d2 = date.fromisoformat(D[i + 1]), date.fromisoformat(D[i + 2])
        if d1.weekday() == 4 or (d2 - d1).days != 1:
            continue
        lim4[D[i + 2]] = (O[i + 2] / O[i + 1] - 1) * 100 - 0.20
p4 = dict(L.SOXL_MR, rsiMax=30, rsiN=2, ibsMax=0.6, downDays=0, ma=100, maxHoldDays=5, size=1.0, version="ref")
cur4, _, _ = L.soxl_meanrev([tuple(r) for r in US], p4)
uc = [d for d in D if d >= "2015"]
for nm, dv in (("④ 지금(최대 5거래일)", cur4), ("④-24(다음 날 시가 → 그다음 날 시가 · 금요일 매수 뺌)", lim4)):
    s, _, _ = gm({d: v for d, v in dv.items() if d >= "2015"}, uc, 252)
    print(f"  {nm}: {s}")
