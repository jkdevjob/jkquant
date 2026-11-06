"""R28 ① 시초가 심층 분석 — 설계(밤 연구 신호 2018~)와 실측(장전 예상가 기록 10월~)을 같은 틀로 (2026-11-06 사용자 "특히 시초가 좀 심도있게 분석해서 연구해보자").

① 규칙: 전일 RSI(14) < 30 명단을 08:56 예상체결가로 보고(08:58 상위 10 다시 보기), 예상 갭 −2% 이하 종목이 minQ(7) 이상인 날
깊은 topK(3) 종목(gapMax −3% 이하)을 09:00 시가에 사서 15:30 종가에 판다. 비용 0.23% + 1.5틱 × 2.

밤 연구(signals.csv)는 '실제 시가갭'으로 고른다. 실전은 08:56/08:58 '예상갭'으로 고른다 — 둘이 다르다(R12 · R18 · R22).
이 분석은 그 차이를 숫자로 메운다: 실제로 쓸 수 있는 신호(예상갭)로 고르면 돈이 되는지.

사전 등록(결과 보기 전) — 묻는 것과 판정:
 Q1 설계: 연도별 · 갭 깊이별(−2~−3 · −3~−5 · −5~−8 · ≤−8) · RSI별(<20 · 20~25 · 25~30) · 그날 신호 수별(1~2 · 3~6 · 7+) · 시장별 매매당 순손익 · 승률 · t.
 Q2 실측 예상→실제: 08:56 예상갭 vs 실제 시가갭 — 평균 오차 · 기울기 · 예상갭 구간별 '실제 −2% 이하' 비율.
 Q3 실측 수익: 예상갭 구간별 시가 → KRX 종가 순손익(모든 후보) · '실제 갭 −2% 이하'(연구 가정) 부분집합과 비교.
 Q4 선별: 메인이 고른 3종목 vs 예상 −2% 이하 후보 전체 vs 실제 갭 깊은 3(사후).
 Q5 통과 수 7: 날짜별 통과 수와 그날 후보 평균 수익 · 7 미만 날 포함 시.
 Q6 시장: 그날 코스피 · 코스닥 시가→종가와 후보 평균 수익의 상관.
 판정: 예상갭 기준 대안(예: 예상 ≤ −4% 만)이 실측 25일에서 (a) 매매당 평균이 지금 규칙보다 높고 (b) 매매 수가 절반 이상 남으면 '후보 — 사용자에게 제안'.
       그 외는 '관찰 기록'. 25일은 짧다 — 주문 규칙은 바꾸지 않는다.

시세: 시가 = FinanceDataReader 일봉(장부 매수가와 같음 · R22), 종가 = KRX 공식 종가(네이버 모바일 시세 다음 날 기준가 · R22), 지수 = FinanceDataReader KS11 · KQ11.
재현: R28_CACHE=<가격 캐시 json> python3 scripts/research/r28_opening_deep.py <signals.csv> <decisions.csv> <opening-gapdown-live 폴더>
"""
import glob
import json
import math
import os
import statistics
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date

SIG, DEC, LIVE = sys.argv[1], sys.argv[2], sys.argv[3]
CACHE = os.environ.get("R28_CACHE", "r28_prices.json")
KR_TICK = [(2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100), (500000, 500)]


def tick(p):
    for u, t in KR_TICK:
        if p < u:
            return t
    return 1000


def cost(p):                                                      # ① 비용식(claude-live d1CostPct · 밤 연구 frictionPct 와 같은 식)
    return 0.23 + 2 * 1.5 * tick(p) / p * 100


def mean(xs):
    return statistics.fmean(xs) if xs else None


def tstat(xs):
    return mean(xs) / (statistics.pstdev(xs) / math.sqrt(len(xs))) if len(xs) > 2 and statistics.pstdev(xs) > 0 else None


def line(name, xs):
    if not xs:
        return f"  {name}: 없음"
    w = sum(1 for x in xs if x > 0) / len(xs) * 100
    t = tstat(xs)
    return f"  {name}: {len(xs)}건 · 평균 {mean(xs):+.2f}% · 중앙값 {statistics.median(xs):+.2f}% · 승률 {w:.0f}% · t {t:+.1f}" if t is not None else f"  {name}: {len(xs)}건 · 평균 {mean(xs):+.2f}%"


def csv_rows(path):
    import csv
    return list(csv.DictReader(open(path, encoding="utf-8")))


# ── Q1 설계 ─────────────────────────────────────────────────────────────────────────────────────
sig = [r for r in csv_rows(SIG) if r.get("variant", "baseline") == "baseline"]
dec = {r["date"]: r for r in csv_rows(DEC)}
for r in sig:
    r["pnl"], r["gap"], r["rsi"] = float(r["pnl"]), float(r["gapPct"]), float(r["rsi14Prev"] or 0)
    r["n"] = int((dec.get(r["date"]) or {}).get("signals") or 0)
print("═ Q1 설계(밤 연구 신호 · 실제 시가갭 기준 · 비용 뺀 %)")
by = defaultdict(list)
for r in sig:
    by[r["date"][:4]].append(r["pnl"])
for y in sorted(by):
    print(line(y, by[y]))
print(line("전체", [r["pnl"] for r in sig]))
GB = [("−2~−3", -3, -2), ("−3~−5", -5, -3), ("−5~−8", -8, -5), ("≤−8", -99, -8)]
print(" 갭 깊이별")
for nm, lo, hi in GB:
    print(line(nm, [r["pnl"] for r in sig if lo < r["gap"] <= hi]))
print(" 전일 RSI 별")
for nm, lo, hi in [("<20", -1, 20), ("20~25", 20, 25), ("25~30", 25, 30)]:
    print(line(nm, [r["pnl"] for r in sig if lo <= r["rsi"] < hi]))
print(" 그날 신호 수별(연구 signals)")
for nm, lo, hi in [("1~2", 1, 2), ("3~6", 3, 6), ("7+", 7, 999)]:
    print(line(nm, [r["pnl"] for r in sig if lo <= r["n"] <= hi]))
print(" 시장별")
for m in ("KOSPI", "KOSDAQ"):
    print(line(m, [r["pnl"] for r in sig if r["market"] == m]))
print(" 요일별")
for wd, nm in enumerate(["월", "화", "수", "목", "금"]):
    print(line(nm, [r["pnl"] for r in sig if date.fromisoformat(r["date"]).weekday() == wd]))
mfe = [float(r["mfePct"]) for r in sig if r.get("mfePct")]
mae = [float(r["maePct"]) for r in sig if r.get("maePct")]
print(f" 장중 경로: MFE 평균 {mean(mfe):+.2f}% · MAE 평균 {mean(mae):+.2f}% · +1% 닿음 {mean([float(r['hitPlus1']=='True') for r in sig]) * 100:.0f}% · −2% 닿음 {mean([float(r['hitMinus2']=='True') for r in sig]) * 100:.0f}%")

# ── 실측 자료 ────────────────────────────────────────────────────────────────────────────────────
rows, days = [], {}
for f in sorted(glob.glob(os.path.join(LIVE, "*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    day = os.path.basename(f)[:10]
    ev = {}
    for e in d["ledger"]["events"]:
        p = e["payload"]
        ev[e["stage"] + ":" + str(p.get("part", ""))] = p
    q56 = {}
    for k, p in ev.items():
        if k.startswith("quote:") and p.get("part") != "recheck":
            for c in p.get("candidates") or []:
                if c.get("expectedPrice") and c.get("basePrice"):
                    q56[c["code"]] = c
    rc = {c["code"]: c for c in (ev.get("quote:recheck") or {}).get("candidates") or [] if c.get("expectedPrice") and c.get("basePrice")}
    pre = ev.get("preopen:") or {}
    picks = [p["code"] for p in pre.get("picks") or []]
    days[day] = dict(qualified=(pre.get("breadth") or {}).get("qualified"), picks=picks, reason=pre.get("decisionReason"))
    for code, c in q56.items():
        r = rc.get(code)
        rows.append(dict(day=day, code=code, name=c.get("name"), market=c.get("market"), rsi=c.get("rsi14Prev"), base=c["basePrice"],
                         g56=(c["expectedPrice"] / c["basePrice"] - 1) * 100, g58=(r["expectedPrice"] / r["basePrice"] - 1) * 100 if r else None,
                         gexp=(r["expectedPrice"] / r["basePrice"] - 1) * 100 if r else (c["expectedPrice"] / c["basePrice"] - 1) * 100,   # 실전이 판단에 쓴 값(08:58 있으면 그것)
                         pick=code in picks))
codes = sorted({r["code"] for r in rows})
dates = sorted(days)

# ── 시세(캐시) ───────────────────────────────────────────────────────────────────────────────────
cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}


def num(x):
    return float(str(x).replace(",", ""))


def fetch(code):
    import FinanceDataReader as fdr
    d = fdr.DataReader(code, dates[0], "2026-12-31")
    bars = {str(i)[:10]: dict(o=float(r["Open"]), h=float(r["High"]), l=float(r["Low"]), c_fdr=float(r["Close"])) for i, r in d.iterrows()}
    req = urllib.request.Request(f"https://m.stock.naver.com/api/stock/{code}/price?pageSize=60&page=1", headers={"User-Agent": "Mozilla/5.0"})
    nv = sorted(json.load(urllib.request.urlopen(req, timeout=20)), key=lambda r: r["localTradedAt"])
    for a, b in zip(nv, nv[1:]):                                   # KRX 공식 종가 = 다음 날 기준가 = 다음 날 종가 − 전일비
        if a["localTradedAt"] in bars:
            bars[a["localTradedAt"]]["c"] = num(b["closePrice"]) - num(b["compareToPreviousClosePrice"])
    return bars


miss = [c for c in codes if c not in cache]
for i, c in enumerate(miss):
    try:
        cache[c] = fetch(c)
    except Exception as e:  # noqa: BLE001
        print("fetch fail", c, e, file=sys.stderr)
        cache[c] = {}
    if i % 20 == 19:
        json.dump(cache, open(CACHE, "w"), ensure_ascii=False)
        time.sleep(0.5)
for ix in ("KS11", "KQ11"):
    if ix not in cache:
        import FinanceDataReader as fdr
        d = fdr.DataReader(ix, dates[0], "2026-12-31")
        cache[ix] = {str(i)[:10]: dict(o=float(r["Open"]), c=float(r["Close"])) for i, r in d.iterrows()}
json.dump(cache, open(CACHE, "w"), ensure_ascii=False)

for r in rows:
    b = (cache.get(r["code"]) or {}).get(r["day"]) or {}
    r["open"] = b.get("o")
    r["close"] = b.get("c")                                        # KRX 종가(마지막 날은 다음 날 기준가가 없어 None)
    r["gact"] = (r["open"] / r["base"] - 1) * 100 if r.get("open") else None
    r["pnl"] = (r["close"] / r["open"] - 1) * 100 - cost(r["open"]) if r.get("open") and r.get("close") else None
    r["mfe"] = (b["h"] / r["open"] - 1) * 100 if b.get("h") and r.get("open") else None
    r["mae"] = (b["l"] / r["open"] - 1) * 100 if b.get("l") and r.get("open") else None
have_open = [r for r in rows if r["gact"] is not None]
have_pnl = [r for r in rows if r["pnl"] is not None]
print(f"\n═ 실측 자료: {len(dates)}일 · 후보 {len(rows)}쌍(종목 {len(codes)}) · 시가 있는 쌍 {len(have_open)} · KRX 종가까지 있는 쌍 {len(have_pnl)}(마지막 날은 다음 날 기준가가 아직 없어 제외)")

# ── Q2 예상 → 실제 ──────────────────────────────────────────────────────────────────────────────
print("═ Q2 예상갭 → 실제 시가갭(08:56 기준 · 전체 후보)")
err = [r["g56"] - r["gact"] for r in have_open]
xs, ys = [r["g56"] for r in have_open], [r["gact"] for r in have_open]
mx, my = mean(xs), mean(ys)
sxx = sum((x - mx) ** 2 for x in xs)
slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx if sxx else None
icpt = my - slope * mx if slope is not None else None
print(f"  평균(예상−실제) {mean(err):+.2f}%p · 절대 오차 {mean([abs(e) for e in err]):.2f}%p · 실제 ≈ {icpt:+.2f} + {slope:.2f} × 예상")
rc = [r for r in have_open if r["g58"] is not None]
if rc:
    print(f"  08:58 다시 본 {len(rc)}쌍: 08:56 오차 {mean([abs(r['g56'] - r['gact']) for r in rc]):.2f}%p → 08:58 {mean([abs(r['g58'] - r['gact']) for r in rc]):.2f}%p")
EB = [("≥0", 0, 99), ("−2~0", -2, 0), ("−3~−2", -3, -2), ("−4~−3", -4, -3), ("−5~−4", -5, -4), ("−8~−5", -8, -5), ("≤−8", -99, -8)]
print("  예상갭 구간별: 쌍 수 · 실제 −2% 이하 비율 · 실제 −3% 이하 비율 · 실제 평균 갭")
for nm, lo, hi in EB:
    g = [r for r in have_open if lo < r["gexp"] <= hi]
    if g:
        print(f"   {nm:>6}: {len(g):3d} · {sum(1 for r in g if r['gact'] <= -2) / len(g) * 100:3.0f}% · {sum(1 for r in g if r['gact'] <= -3) / len(g) * 100:3.0f}% · {mean([r['gact'] for r in g]):+.2f}%")

# ── Q3 예상갭 구간별 수익 ───────────────────────────────────────────────────────────────────────
print("═ Q3 시가 → KRX 종가 순손익(비용 뺀 · 모든 후보 · 실전이 판단에 쓴 예상갭 기준)")
for nm, lo, hi in EB:
    print(line(nm, [r["pnl"] for r in have_pnl if lo < r["gexp"] <= hi]))
print(" 연구 가정(실제 시가갭 −2~−29%)으로 걸렀을 때")
for nm, lo, hi in GB:
    print(line(nm, [r["pnl"] for r in have_pnl if lo < r["gact"] <= hi]))
print(line(" 실제 −2% 이하 전체", [r["pnl"] for r in have_pnl if -29 <= r["gact"] <= -2]))
print(line(" 예상 −2% 이하인데 실제는 −2% 위", [r["pnl"] for r in have_pnl if r["gexp"] <= -2 and r["gact"] > -2]))
print(line(" 예상 −2% 이하이고 실제도 −2% 이하", [r["pnl"] for r in have_pnl if r["gexp"] <= -2 and r["gact"] <= -2]))

# ── Q4 선별 · Q5 통과 수 ────────────────────────────────────────────────────────────────────────
print("═ Q4 선별(매매일만 · 종가 있는 날)")
pk = [r["pnl"] for r in have_pnl if r["pick"] and (days[r["day"]]["qualified"] or 0) >= 7]
print(line("메인이 고른 3종목(통과 7↑ 날)", pk))
print(line("고른 3종목(통과 수 무관)", [r["pnl"] for r in have_pnl if r["pick"]]))
print(line("예상 −2% 이하 후보 전체(통과 7↑ 날)", [r["pnl"] for r in have_pnl if r["gexp"] <= -2 and (days[r["day"]]["qualified"] or 0) >= 7]))
post = []
for d in dates:
    g = sorted([r for r in have_pnl if r["day"] == d and -29 <= r["gact"] <= -2], key=lambda r: r["gact"])[:3]
    if (days[d]["qualified"] or 0) >= 7:
        post += [r["pnl"] for r in g]
print(line("실제 갭 깊은 3(사후 · 통과 7↑ 날)", post))
print("═ Q5 통과 수(실전 qualified)와 그날 예상 −2% 이하 후보 평균")
for d in dates:
    g = [r["pnl"] for r in have_pnl if r["day"] == d and r["gexp"] <= -2]
    p = [r["pnl"] for r in have_pnl if r["day"] == d and r["pick"]]
    ix = cache.get("KQ11", {}).get(d) or {}
    kq = (ix["c"] / ix["o"] - 1) * 100 if ix else None
    print(f"  {d} 통과 {str(days[d]['qualified']):>4} · 후보 {len(g):2d}개 평균 {mean(g):+.2f}% · 고른 {len(p)}개 평균 {(mean(p) if p else 0):+.2f}% · 코스닥 시가→종가 {kq:+.2f}%" if g and kq is not None else f"  {d} 통과 {days[d]['qualified']} · 후보 {len(g)}개")
print(" 통과 수별(후보 평균)")
for nm, lo, hi in [("1~2", 1, 2), ("3~6", 3, 6), ("7+", 7, 999)]:
    print(line(nm, [r["pnl"] for r in have_pnl if r["gexp"] <= -2 and lo <= (days[r["day"]]["qualified"] or 0) <= hi]))

# ── Q6 시장 ─────────────────────────────────────────────────────────────────────────────────────
print("═ Q6 시장 시가→종가와 그날 후보 평균(예상 −2% 이하)")
pairs = []
for d in dates:
    g = [r["pnl"] for r in have_pnl if r["day"] == d and r["gexp"] <= -2]
    ix = cache.get("KQ11", {}).get(d) or {}
    ik = cache.get("KS11", {}).get(d) or {}
    if g and ix and ik:
        pairs.append((mean(g), (ix["c"] / ix["o"] - 1) * 100, (ik["c"] / ik["o"] - 1) * 100))
if len(pairs) > 3:
    def corr(a, b):
        ma, mb = mean(a), mean(b)
        return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    print(f"  {len(pairs)}일 · 코스닥 상관 {corr([p[0] for p in pairs], [p[1] for p in pairs]):+.2f} · 코스피 상관 {corr([p[0] for p in pairs], [p[2] for p in pairs]):+.2f} · 후보 평균 − 코스닥 = {mean([p[0] - p[1] for p in pairs]):+.2f}%p/일")

# ── 판정: 예상갭 기준 대안 ──────────────────────────────────────────────────────────────────────
print("═ 판정 — 예상갭 기준 대안(그날 예상갭 깊은 3 · 통과 7↑ 날 · 종가 있는 날)")
base = None
for th in (-2, -3, -4, -5, -6):
    sel = []
    for d in dates:
        if (days[d]["qualified"] or 0) < 7:
            continue
        g = sorted([r for r in have_pnl if r["day"] == d and -29 <= r["gexp"] <= th], key=lambda r: r["gexp"])[:3]
        sel += [r["pnl"] for r in g]
    if th == -3:
        base = sel
    print(line(f"예상 ≤ {th}%", sel))
alt = {}
for th in (-4, -5, -6):
    sel = []
    for d in dates:
        if (days[d]["qualified"] or 0) < 7:
            continue
        sel += [r["pnl"] for r in sorted([r for r in have_pnl if r["day"] == d and -29 <= r["gexp"] <= th], key=lambda r: r["gexp"])[:3]]
    alt[th] = sel
ok = [th for th, s in alt.items() if base and s and mean(s) > mean(base) and len(s) >= len(base) / 2]
print("  후보로 올릴 기준(평균 ↑ · 매매 수 절반 이상):", ok if ok else "없음")
