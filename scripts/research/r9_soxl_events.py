"""R9 (2026-10-15 사전 등록 · 일정 원천 사본: scripts/research/r9_events — 연준 · ALFRED · EDGAR 에서 2026-10-15 받음) — ④ SOXL 과매도 반등에 '큰 예정 일정' 거르기를 넣으면 나아지는가.
일정(공식 원천, 2009~): FOMC 결정일(연준 보도자료 · 그날 14:00 ET → 그날 반영), CPI 발표일(ALFRED CPIAUCNS 빈티지 · 08:30 ET → 그날 반영,
  한 달에 두 개면 8~20일 것만), 엔비디아 실적(EDGAR 8-K 2.02 접수 시각 · 장 시작 전이면 그날, 아니면 다음 거래일 반영).
가설: 메인(RSI(2)<20 · 200일 평균 위 · 최대 5일) 진입이 큰 일정 반영일과 겹치면 손익이 나쁘다 → 피하면 수익은 메인 이상, MDD·최악일은 줄어든다.
변형(결과 보기 전 고정): E1 매수일(시가 진입일)이 반영일이면 사지 않음 · E2 매수일 또는 다음 거래일이 반영일이면 사지 않음 ·
  E3 = E2 + 보유 중 다음 거래일이 반영일이면 그날 시가에 매도.
시간순: 시험 연도 Y(2014~2026)마다 Y 전 성적(누적 수익)이 가장 좋은 변형(메인 포함)을 골라 Y 에 적용. 메인과 같은 연도로 비교.
판정(R8 과 같음): (a) 시간순 누적 ≥ 메인 (b) 칸 MDD ≥ −25% 이거나 메인보다 개선 (c) 최악일 ≥ −15% (d) 기대값 > 0 (e) 매매한 해 60% 이상 플러스.
모두 만족해야 통과 — 통과해도 새 규칙 요소라 사용자 확인 뒤 경쟁군에 넣는다. 계산: 운영 soxl_meanrev 규칙 + 거르기 몇 줄(없음 = 운영과 날짜별 같음 확인)."""
import json, sys, math
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
sys.path.insert(0, sys.argv[1] + "/scripts")   # 사용: python3 -I scripts/research/r9_soxl_events.py <저장소> <soxl.json — claude_lab.fetch_us("SOXL") 저장본> scripts/research/r9_events
import claude_lab as L

sx = json.load(open(sys.argv[2])); rows = [(d, *sx[d]) for d in sorted(sx)]; S = [r[0] for r in rows]
ev_dir = sys.argv[3]
def next_session(d, incl=True):
    for s in S:
        if (s >= d if incl else s > d): return s
    return None
fomc = json.load(open(ev_dir + "/fomc.json")); cpi = json.load(open(ev_dir + "/cpi.json")); nv = json.load(open(ev_dir + "/nvda.json"))
bym = {}
for d in cpi: bym.setdefault(d[:7], []).append(d)
cpi = [x for m, ds in bym.items() for x in (ds if len(ds) == 1 else [d for d in ds if 8 <= int(d[8:]) <= 20])]
EV = {}
for d in fomc: s = next_session(d); EV.setdefault(s, set()).add("FOMC")
for d in cpi: s = next_session(d); EV.setdefault(s, set()).add("CPI")
for fd, acc in nv:
    et = datetime.fromisoformat(acc.replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York"))
    d = et.date().isoformat(); s = next_session(d) if (et.hour, et.minute) < (9, 30) else next_session(d, incl=False)
    EV.setdefault(s, set()).add("NVDA")
EV.pop(None, None)
idx = {d: i for i, d in enumerate(S)}

def run(p, mode=None):
    D = S; O, Hh, Lw, C = [r[1] for r in rows], [r[2] for r in rows], [r[3] for r in rows], [r[4] for r in rows]
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
        nxt = D[i + 1] if i + 1 < len(D) else None; nxt2 = D[i + 2] if i + 2 < len(D) else None
        if pos:
            pre = mode == "E3" and nxt in EV                              # 다음 거래일이 반영일 → 그날 시가 매도
            if C[i] > C[i - 1] or pos["days"] >= p["maxHoldDays"] or pre: pending = "sell"
        elif sig and (ma is None or C[i] > ma):
            block = (mode in ("E1", "E2", "E3") and nxt in EV) or (mode in ("E2", "E3") and nxt2 in EV)
            if not block: pending = "buy"
    return dv, trades

def stats(dv, tab, years):
    ds = sorted(d for d in dv if d[:4] in years); eq = peak = 1.0; mdd = worst = 0.0; yr = {}
    for d in ds:
        v = dv[d] * tab; eq *= 1 + v / 100; peak = max(peak, eq); mdd = min(mdd, (eq / peak - 1) * 100); worst = min(worst, v)
        yr[d[:4]] = yr.get(d[:4], 1.0) * (1 + v / 100)
    return dict(total=(eq - 1) * 100, mdd=mdd, worst=worst, years={y: (g - 1) * 100 for y, g in yr.items()})

P = dict(L.SOXL_MR); tab = P["tabSize"]
ref, _, _ = L.soxl_meanrev(rows, P); base, _ = run(P, None)
assert set(ref) == set(base) and all(abs(ref[d] - base[d]) < 1e-9 for d in ref), "운영 함수와 다름"
print(f"확인: 거르기 없음 = 운영 soxl_meanrev (날짜 {len(ref)}개 같음) · 반영일 {len(EV)}개(FOMC {sum('FOMC' in v for v in EV.values())} · CPI {sum('CPI' in v for v in EV.values())} · NVDA {sum('NVDA' in v for v in EV.values())})")
modes = [None, "E1", "E2", "E3"]; runs = {m: run(P, m) for m in modes}
yrs = sorted({d[:4] for d in ref}); test = [y for y in yrs if "2014" <= y <= "2026"]
def yret(m, y): return math.prod(1 + v * tab / 100 for d, v in runs[m][0].items() if d[:4] == y) - 1
wf, chosen = {}, {}
for y in test:
    past = [x for x in yrs if x < y]
    m = max(modes, key=lambda k: (math.prod(1 + yret(k, x) for x in past), k is None)); chosen[y] = m
    wf.update({d: v for d, v in runs[m][0].items() if d[:4] == y})
def tstat(tr):
    t = [(math.prod(1 + x * tab / 100 for x in p["r"]) - 1) * 100 for p in tr if p["d"][:4] in test]
    return len(t), (sum(t) / len(t) if t else 0), (min(t) if t else 0)
def line(name, dv, tr=None):
    s = stats(dv, tab, set(test)); traded = [v for y, v in s["years"].items()]
    pos = sum(v > 0 for v in traded) / len(traded) if traded else 0
    extra = "" if tr is None else " · 매매 %d · 기대값 %+.2f%% · 최악 매매 %.1f%%" % tstat(tr)
    print(f"{name}: 누적 {s['total']:+.1f}% · MDD {s['mdd']:.1f}% · 최악일 {s['worst']:.2f}% · 플러스 해 {pos*100:.0f}%{extra}")
for m in modes: line("메인" if m is None else m, runs[m][0], runs[m][1])
line("시간순 선택", wf)
print("시간순 고른 변형:", " ".join(f"{y[2:]}:{chosen[y] or '메인'}" for y in test))
# 진단: 메인 보유일 손익 — 반영일 vs 아닌 날
def mean_sd(a): m = sum(a) / len(a); return m, (sum((x - m) ** 2 for x in a) / len(a)) ** .5
ev_d = [v * tab for d, v in ref.items() if d in EV and d[:4] in test]; ot = [v * tab for d, v in ref.items() if d not in EV and d[:4] in test]
(m1, s1), (m2, s2) = mean_sd(ev_d), mean_sd(ot)
print(f"진단(메인 보유일, 칸): 반영일 {len(ev_d)}일 평균 {m1:+.3f}% · 표준편차 {s1:.2f} / 그 밖 {len(ot)}일 평균 {m2:+.3f}% · 표준편차 {s2:.2f}")
