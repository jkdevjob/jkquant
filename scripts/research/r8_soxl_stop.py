"""R8 (2026-10-15 사전 등록) — ④ SOXL RSI(2) 과매도 반등에 손절을 넣으면 나아지는가.
가설: 메인(rsiMax 20 · 200일 평균 위 · 최대 5일)에 '종가가 매수가 대비 −S% 이하로 마감하면 다음 날 시가 매도'를 더하면
      시간순 검증에서 수익은 메인 이상이면서 MDD · 최악 매매가 줄어든다.
S 후보 {8,10,12,15,20}%. 시간순: 시험 연도 Y(2014~2026)마다 Y 전 성적(누적 수익)이 가장 좋은 S 를 골라 Y 에 적용. 메인과 같은 연도로 비교.
판정(결과 보기 전 고정): (a) 시간순 누적 수익 ≥ 메인 (b) 칸 MDD ≥ −25% 이거나 메인보다 개선 (c) 최악일 ≥ −15% (d) 기대값 > 0
(e) 매매한 해의 60% 이상 플러스 — 모두 만족해야 통과. 통과해도 새 청산 규칙이므로 사용자 확인 뒤 경쟁군에 넣는다.
계산: 운영과 같은 soxl_meanrev 규칙 그대로 + 손절 한 줄. 손절 없음(S=None)이 운영 함수와 날짜별로 같은지 먼저 확인한다."""
import json, sys, math
from datetime import date, timedelta
sys.path.insert(0, sys.argv[1] + "/scripts")   # 사용: python3 -I scripts/research/r8_soxl_stop.py <저장소> <soxl.json — claude_lab.fetch_us("SOXL") 저장본>
import claude_lab as L

def meanrev_stop(rows, p, S=None):
    D = [r[0] for r in rows]; O, Hh, Lw, C = [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows], [r[4] for r in rows]
    n, half, sz, rn = p["ma"], p["costRoundTripPct"] / 2, p["size"], int(p.get("rsiN") or 2)
    dv, trades, pos, pending = {}, [], None, None
    for i in range(max(n, rn + 1), len(rows)):
        if pending == "sell" and pos:
            v = ((O[i] / C[i - 1] - 1) * 100 - half) * sz; dv[D[i]] = v; pos["r"].append(v); trades.append(pos); pos = None
        elif pending == "buy" and not pos:
            v = ((C[i] / O[i] - 1) * 100 - half) * sz; dv[D[i]] = v; pos = dict(entry=i, days=1, r=[v], d=D[i])
        elif pos:
            pos["days"] += 1; v = (C[i] / C[i - 1] - 1) * 100 * sz; dv[D[i]] = v; pos["r"].append(v)
        pending = None
        ma = sum(C[i - n + 1:i + 1]) / n if n else None
        r2 = L.rsi2_at(C, i, rn); ibs = (C[i] - Lw[i]) / (Hh[i] - Lw[i]) if Hh[i] > Lw[i] else 0.5
        down = 0
        while down < i and C[i - down] < C[i - down - 1]: down += 1
        sig = L.soxl_signal(p, r2, ibs, down)
        if pos:
            stop = S is not None and (C[i] / O[pos["entry"]] - 1) * 100 <= -S       # 손절(종가 확정 → 다음 날 시가)
            if C[i] > C[i - 1] or pos["days"] >= p["maxHoldDays"] or stop: pending = "sell"
        elif sig and (ma is None or C[i] > ma): pending = "buy"
    return dv, trades

def stats(dv, tab):
    ds = sorted(dv); eq = 1.0; peak = 1.0; mdd = 0.0; worst = 0.0; yr = {}
    for d in ds:
        v = dv[d] * tab; eq *= 1 + v / 100; peak = max(peak, eq); mdd = min(mdd, (eq / peak - 1) * 100); worst = min(worst, v)
        yr[d[:4]] = yr.get(d[:4], 1.0) * (1 + v / 100)
    return dict(total=(eq - 1) * 100, mdd=mdd, worst=worst, years={y: (g - 1) * 100 for y, g in yr.items()})

root = sys.argv[1]
sx = json.load(open(sys.argv[2])); rows = [(d, *sx[d]) for d in sorted(sx)]
P = dict(L.SOXL_MR); tab = P["tabSize"]
ref, _, _ = L.soxl_meanrev(rows, P)
base, btr = meanrev_stop(rows, P, None)
assert set(ref) == set(base) and all(abs(ref[d] - base[d]) < 1e-9 for d in ref), "운영 함수와 다름"
print("확인: 손절 없음 = 운영 soxl_meanrev (날짜", len(ref), "개 같음)")
cands = [None, 8, 10, 12, 15, 20]
runs = {S: meanrev_stop(rows, P, S) for S in cands}
yrs_all = sorted({d[:4] for d in ref})
def yret(S, y):
    g = 1.0
    for d, v in runs[S][0].items():
        if d[:4] == y: g *= 1 + v * tab / 100
    return (g - 1) * 100
test = [y for y in yrs_all if "2014" <= y <= "2026"]
wf, chosen = {}, {}
for y in test:
    past = [x for x in yrs_all if x < y]
    score = {S: math.prod(1 + yret(S, x) / 100 for x in past) for S in cands}
    S = max(cands, key=lambda s: (score[s], s is None))           # 같으면 메인(손절 없음)
    chosen[y] = S
    for d, v in runs[S][0].items():
        if d[:4] == y: wf[d] = v
mainwf = {d: v for d, v in runs[None][0].items() if d[:4] in test}
def tstats(tr):
    t = [ (math.prod(1 + x * tab / 100 for x in p["r"]) - 1) * 100 for p in tr if p["d"][:4] in test]
    return dict(n=len(t), exp=sum(t) / len(t) if t else 0, worst=min(t) if t else 0)
for name, dv, tr in (("메인(손절 없음)", mainwf, runs[None][1]), ("시간순 손절", wf, None)):
    s = stats(dv, tab); yp = [v for v in s["years"].values()]
    traded = [v for y, v in s["years"].items() if any(d[:4] == y for d in dv)]
    pos_share = sum(1 for v in traded if v > 0) / len(traded) if traded else 0
    print(f"{name}: 누적 {s['total']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.2f}% · 플러스 해 {pos_share*100:.0f}% · 연도별 " + " ".join(f"{y[2:]}:{v:+.0f}" for y, v in s['years'].items()))
for S in cands[1:]:
    s = stats({d: v for d, v in runs[S][0].items() if d[:4] in test}, tab); t = tstats(runs[S][1])
    print(f"  고정 손절 {S}%: 누적 {s['total']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.2f}% · 매매 {t['n']} · 기대값 {t['exp']:+.2f}% · 최악 매매 {t['worst']:.1f}%")
t0 = tstats(runs[None][1]); print(f"  메인: 매매 {t0['n']} · 기대값 {t0['exp']:+.2f}% · 최악 매매 {t0['worst']:.1f}%")
print("시간순 고른 손절:", " ".join(f"{y[2:]}:{chosen[y] or '없음'}" for y in test))
