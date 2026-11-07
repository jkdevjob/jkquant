#!/usr/bin/env python3
"""R28-b ① 시초가 심층 2 — 날 단위 · 통과 수(breadth) · 시장 뺀 초과 · 헤지 · 실전 규칙 대조 (2026-11-07).

사용자 "더 심도있게 분석해서 고민해봐". R28 이 매매 단위로 본 것을 날 단위로 다시 보고, 이익이 어디서 오는지 분해한다.
  D1 날 단위(그날 신호 평균) 성적 — 그날 통과 수(rsiPassed: 전일 RSI<30 이면서 실제 갭 −2% 이하인 종목 수) 구간별 · 해별.
  D2 그날 코스닥·코스피 시가→종가와 비교한 초과(종목 시장지수 기준) — 이익이 시장 방향인지 종목 선별인지.
  D3 통과 수 × 갭 깊이 2차원표.
  D4 통과 7+ 날의 위험(최악 · 하위 5% · 상위 5일 몫 · 연속 손실 · 이어 붙인 누적과 낙폭).
  D5 코스닥 시가→종가에 대한 β 와 1배 헤지(코스닥150 인버스 같은 금액) 효과(비용 전).
  L1 실측 26일: 실전 통과(예상 ≤−2 수) vs 연구식 통과(실제 −2~−29 수) · 고른 종목이 연구식 7+ 날인지에 따른 성적 · 시장 뺀 초과.
  L2 같은 자료에 규칙 대안을 대 봄 — 지금 규칙 / 연구 정의 그대로(사후) / 보정 대안(예상 ≤−4 수 ≥7 · 예상 ≤−5 깊은 3) / 통과 13.
  L3 승자의 저주: 그날 예상갭 순위(1~3 · 4~10 · 11+)별 예상→실제 되돌림.
사용: python3 scripts/research/r28b_opening_breadth.py signals.csv decisions.csv live/ prices.json index.json
  prices.json 은 r28_opening_deep.py 의 캐시(R28_CACHE), index.json 은 {"KQ11":{날짜:{o,c}},"KS11":...}(FDR).
"""
import csv, glob, json, os, statistics as st, sys
from collections import defaultdict

SIG, DEC, LIVE, CACHE, IDX = sys.argv[1:6]
KR_TICK = [(2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100), (500000, 500)]


def tick(p):
    for u, t in KR_TICK:
        if p < u:
            return t
    return 1000


def cost(p):
    return 0.23 + 2 * 1.5 * tick(p) / p * 100


def tstat(xs):
    n = len(xs)
    sd = st.pstdev(xs) if n > 1 else 0
    return st.mean(xs) / (sd / n ** 0.5) if sd else 0.0


def line(nm, xs, unit="건"):
    if not xs:
        return f"  {nm}: 없음"
    return f"  {nm}: {len(xs)}{unit} · 평균 {st.mean(xs):+.2f}% · 중앙값 {st.median(xs):+.2f}% · 승률 {sum(1 for x in xs if x > 0) / len(xs) * 100:.0f}% · t {tstat(xs):+.1f}"


idx = json.load(open(IDX, encoding="utf-8"))


def oc(ix, d):
    v = idx[ix].get(d)
    return (v["c"] / v["o"] - 1) * 100 if v and v.get("o") else None


# ── 설계 ────────────────────────────────────────────────────────────────────────────────────────
dec = {r["date"]: r for r in csv.DictReader(open(DEC, encoding="utf-8"))}
sig = [r for r in csv.DictReader(open(SIG, encoding="utf-8")) if r.get("variant", "baseline") == "baseline"]
for r in sig:
    r["pnl"], r["gap"], r["n"] = float(r["pnl"]), float(r["gapPct"]), int(dec[r["date"]]["rsiPassed"] or 0)
day = defaultdict(list)
for r in sig:
    day[r["date"]].append(r["pnl"])
B = [("1~2", 1, 2), ("3~6", 3, 6), ("7~19", 7, 19), ("20~49", 20, 49), ("50+", 50, 10 ** 6), ("7+", 7, 10 ** 6)]
print("═ D1 설계 · 날 단위(그날 신호 평균) — 통과 수(rsiPassed) 구간별")
for nm, lo, hi in B:
    print(line(nm, [st.mean(day[d]) for d in day if lo <= int(dec[d]["rsiPassed"]) <= hi], "일"))
print(line("전체", [st.mean(v) for v in day.values()], "일"))
print(" 해별(날 단위)")
by = defaultdict(list)
for d, v in day.items():
    by[d[:4]].append(st.mean(v))
for y in sorted(by):
    print(line(y, by[y], "일"))

print("═ D2 설계 · 그날 지수 시가→종가와 초과(① − 종목 시장지수)")
mk = defaultdict(list)
for r in sig:
    m = oc("KS11" if r["market"] == "KOSPI" else "KQ11", r["date"])
    if m is not None:
        mk[r["date"]].append(r["pnl"] - m)
for nm, lo, hi in B:
    ds = [d for d in day if lo <= int(dec[d]["rsiPassed"]) <= hi and oc("KQ11", d) is not None]
    print(f" {nm} ({len(ds)}일)")
    print(line("  ① 신호 평균", [st.mean(day[d]) for d in ds], "일"))
    print(line("  코스닥 시가→종가", [oc("KQ11", d) for d in ds], "일"))
    print(line("  초과", [st.mean(mk[d]) for d in ds if mk[d]], "일"))
print(" 7+ 날 해별 · ① / 코스닥 / 초과")
for y in sorted(by):
    ds = [d for d in day if int(dec[d]["rsiPassed"]) >= 7 and d[:4] == y and oc("KQ11", d) is not None]
    if ds:
        print(f"  {y}: {len(ds)}일 · ① {st.mean([st.mean(day[d]) for d in ds]):+.2f}% · 코스닥 {st.mean([oc('KQ11', d) for d in ds]):+.2f}% · 초과 {st.mean([st.mean(mk[d]) for d in ds]):+.2f}%")
ks = sorted(idx["KQ11"])
allk = [(idx["KQ11"][d]["c"] / idx["KQ11"][d]["o"] - 1) * 100 for d in ks if d >= "2018-01-01" and idx["KQ11"][d].get("o")]
print(f" (참고) 코스닥 시가→종가 2018~ 전체 평균 {st.mean(allk):+.3f}%/일 · {len(allk)}일")

print("═ D3 설계 · 매매당 — 통과 수(행) × 실제 갭 깊이(열)")
GB = [("−2~−3", -3, -2), ("−3~−5", -5, -3), ("−5~−8", -8, -5), ("≤−8", -99, -8)]
print("          " + " | ".join(f"{c:^20}" for c, _, _ in GB))
for nm, lo, hi in B[:4] + [("20+", 20, 10 ** 6)]:
    if nm == "20~49":
        continue
    cells = []
    for _, glo, ghi in GB:
        xs = [r["pnl"] for r in sig if lo <= r["n"] <= hi and glo < r["gap"] <= ghi]
        cells.append(f"{len(xs):4d}건 {st.mean(xs):+5.2f}% t{tstat(xs):+4.1f}" if xs else "        —          ")
    print(f"  {nm:>5}  " + " | ".join(cells))

print("═ D4 설계 · 7+ 날 위험(3종목 동일 비중 · 날 수익)")
d7 = sorted(d for d in day if int(dec[d]["rsiPassed"]) >= 7)
dm = [st.mean(day[d]) for d in d7]
s = sorted(dm)
n = len(s)
print(f"  {n}일: 최악 {s[0]:+.2f}% · 하위5% {s[int(n * 0.05)]:+.2f}% · 중앙 {st.median(s):+.2f}% · 상위5% {s[int(n * 0.95)]:+.2f}% · 최고 {s[-1]:+.2f}% · 플러스 {sum(1 for x in dm if x > 0)}/{n}")
tot = sum(dm)
top5 = sum(sorted(dm, reverse=True)[:5])
print(f"  합계 {tot:+.1f}%p 중 상위 5일 {top5:+.1f}%p({top5 / tot * 100:.0f}%) · 하위 5일 {sum(s[:5]):+.1f}%p")
eq = peak = 1.0
mdd = run = worst = 0
for d in d7:
    m = st.mean(day[d]) / 100
    eq *= 1 + m
    peak = max(peak, eq)
    mdd = min(mdd, eq / peak - 1)
    run = run + 1 if m < 0 else 0
    worst = max(worst, run)
print(f"  매매일만 이어 붙인 누적 {(eq - 1) * 100:+.0f}% · 최대 낙폭 {mdd * 100:.1f}% · 최장 연속 손실 {worst}일 · 해마다 {n / 9:.0f}일꼴")

print("═ D5 설계 · 7+ 날 코스닥 β 와 1배 헤지(코스닥150 인버스 같은 금액 · 비용 전)")
dd = [d for d in d7 if oc("KQ11", d) is not None]
X = [oc("KQ11", d) for d in dd]
Y = [st.mean(day[d]) for d in dd]
mx, my = st.mean(X), st.mean(Y)
beta = sum((x - mx) * (y - my) for x, y in zip(X, Y)) / sum((x - mx) ** 2 for x in X)
h1 = [y - x for x, y in zip(X, Y)]
print(f"  {len(dd)}일 · 상관 {st.correlation(X, Y):+.2f} · β {beta:.2f} · α {my - beta * mx:+.2f}%/일 · 코스닥 sd {st.pstdev(X):.2f}%p")
print(f"  그냥: 평균 {my:+.2f} · sd {st.pstdev(Y):.2f} · t {tstat(Y):+.1f} · 플러스 {sum(1 for y in Y if y > 0)}/{len(Y)} · 최악 {min(Y):+.2f} · 하위5% {sorted(Y)[int(len(Y) * .05)]:+.2f}")
print(f"  1배 헤지: 평균 {st.mean(h1):+.2f} · sd {st.pstdev(h1):.2f} · t {tstat(h1):+.1f} · 플러스 {sum(1 for y in h1 if y > 0)}/{len(h1)} · 최악 {min(h1):+.2f} · 하위5% {sorted(h1)[int(len(h1) * .05)]:+.2f}")
byh = defaultdict(list)
for d, y, x in zip(dd, Y, X):
    byh[d[:4]].append((y, y - x))
print("  해별 그냥/헤지: " + " · ".join(f"{y} {st.mean([a for a, _ in v]):+.2f}/{st.mean([b for _, b in v]):+.2f}" for y, v in sorted(byh.items())))

# ── 실측 ────────────────────────────────────────────────────────────────────────────────────────
cache = json.load(open(CACHE, encoding="utf-8"))
rows, days = [], {}
for f in sorted(glob.glob(os.path.join(LIVE, "*.json"))):
    d = json.load(open(f, encoding="utf-8"))
    dy = os.path.basename(f)[:10]
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
    days[dy] = dict(q=(pre.get("breadth") or {}).get("qualified"), picks=picks)
    for code, c in q56.items():
        r = rc.get(code)
        gexp = ((r or c)["expectedPrice"] / (r or c)["basePrice"] - 1) * 100
        b = (cache.get(code) or {}).get(dy) or {}
        rows.append(dict(day=dy, code=code, gexp=gexp, pick=code in picks, open=b.get("o"), close=b.get("c"),
                         gact=(b["o"] / c["basePrice"] - 1) * 100 if b.get("o") else None,
                         pnl=(b["c"] / b["o"] - 1) * 100 - cost(b["o"]) if b.get("o") and b.get("c") else None))
dates = [d for d in sorted(days) if any(r["day"] == d and r["pnl"] is not None for r in rows)]
print("═ L1 실측 · 날짜 · 실전 통과(예상 ≤−2) · 연구식 통과(실제 −2~−29) · 예상 ≤−4 수 · 고른 평균 · 코스닥 시가→종가")
agree = []
for d in sorted(days):
    rs = [r for r in rows if r["day"] == d]
    act = sum(1 for r in rs if r["gact"] is not None and -29 <= r["gact"] <= -2)
    e4 = sum(1 for r in rs if r["gexp"] <= -4)
    pk = [r["pnl"] for r in rs if r["pick"] and r["pnl"] is not None]
    kq = oc("KQ11", d)
    print(f"  {d} 통과 {str(days[d]['q']):>4} · 실제≤−2 {act:>3} · 예상≤−4 {e4:>3} · 고른 {len(pk)} 평균 {(st.mean(pk) if pk else 0):+.2f}% · 코스닥 {'—' if kq is None else f'{kq:+.2f}'}")
    agree.append((d, act, pk, kq))
print(line(" 고른 종목 · 연구식 7+ 날", [p for _, act, pk, _ in agree if act >= 7 for p in pk]))
print(line(" 고른 종목 · 연구식 <7 날", [p for _, act, pk, _ in agree if act < 7 for p in pk]))
print(line(" 고른 종목 − 코스닥(초과)", [p - kq for _, _, pk, kq in agree if kq is not None for p in pk]))

print("═ L2 실측 · 규칙 대안(같은 26일 · 종가 있는 날)")


def run_rule(label, breadth_fn, pick_fn):
    tr, dys, ex, used = [], [], [], []
    for d in dates:
        rs = [r for r in rows if r["day"] == d]
        if breadth_fn(rs) < 7:
            continue
        pk = [r for r in pick_fn(rs)[:3] if r["pnl"] is not None]
        if not pk:
            continue
        used.append(d[5:])
        m = st.mean([r["pnl"] for r in pk])
        tr += [r["pnl"] for r in pk]
        dys.append(m)
        k = oc("KQ11", d)
        if k is not None:
            ex.append(m - k)
    print(f" [{label}] 매매일 {len(used)}: {' '.join(used)}")
    print(line("  매매당", tr))
    print(line("  날 초과(−코스닥)", ex, "일"))


run_rule("지금 실전(예상 ≤−2 수 ≥7 · 예상 ≤−3 깊은 3)", lambda rs: sum(1 for r in rs if r["gexp"] <= -2), lambda rs: sorted([r for r in rs if -29 <= r["gexp"] <= -3], key=lambda r: r["gexp"]))
run_rule("연구 정의 그대로(실제 갭 · 사후)", lambda rs: sum(1 for r in rs if r["gact"] is not None and -29 <= r["gact"] <= -2), lambda rs: sorted([r for r in rs if r["gact"] is not None and -29 <= r["gact"] <= -3], key=lambda r: r["gact"]))
run_rule("보정 대안(예상 ≤−4 수 ≥7 · 예상 ≤−5 깊은 3)", lambda rs: sum(1 for r in rs if r["gexp"] <= -4), lambda rs: sorted([r for r in rs if -29 <= r["gexp"] <= -5], key=lambda r: r["gexp"]))
run_rule("통과 13(예상 ≤−2 수 ≥13 · 지금 고르기)", lambda rs: sum(1 for r in rs if r["gexp"] <= -2) * 7 / 13, lambda rs: sorted([r for r in rs if -29 <= r["gexp"] <= -3], key=lambda r: r["gexp"]))

print("═ L3 실측 · 승자의 저주 — 그날 예상갭 순위별 예상 → 실제(예상 ≤−2 · 시가 있는 쌍)")
rank = defaultdict(list)
for d in days:
    rs = sorted([r for r in rows if r["day"] == d and r["gexp"] <= -2 and r["gact"] is not None], key=lambda r: r["gexp"])
    for i, r in enumerate(rs):
        rank["1~3" if i < 3 else "4~10" if i < 10 else "11+"].append(r)
for k in ("1~3", "4~10", "11+"):
    g = rank[k]
    if g:
        print(f"  순위 {k}: {len(g)}쌍 · 예상 {st.mean([r['gexp'] for r in g]):+.2f}% → 실제 {st.mean([r['gact'] for r in g]):+.2f}% · 되돌림 {st.mean([r['gact'] - r['gexp'] for r in g]):+.2f}%p · 실제 ≤−3 비율 {sum(1 for r in g if r['gact'] <= -3) / len(g) * 100:.0f}%")
