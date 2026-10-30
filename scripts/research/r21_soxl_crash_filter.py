"""R21 ④ SOXL 급락 거름 — '폭락 중에는 반등 매수를 쉬면 나아지나' (2026-10-30 아침 점검).

계기: R16 — 10월 ④ 실측 1매매 −34.78%(옛 메인 v1)가 설계 표본 최악권. 급락장 한가운데의 '과매도 반등'이 반등이 아니었다.

사전 등록(결과 보기 전):
- 지금 메인(RSI(2) < 30 · IBS ≤ 0.6 · 100일 평균 위 · 최대 5일 · 탭 50%)에 진입 거름 하나만 더한다. 거름은 신호 날 확정 종가까지만 쓴다.
  A: 종가 ≤ 최근 20거래일 최고 종가 × (1 − 30%) 이면 그날 신호를 쉰다.
  B: 최근 20거래일 일간 등락률 표준편차 ≥ 7.0%p 이면 쉰다.
- 실험실 엔진(claude_lab.soxl_meanrev)을 그대로 돌리고 신호 판정 함수만 감싼다 — 쉰 날 뒤 다음 신호는 엔진이 그대로 잡는다(대체 매매 포함).
- 설계 2011~2022 · 검증 2023-01 ~ 2026-09 · 10월 이후는 참고.
- 통과 = 검증 누적 ≥ 메인 · 검증 MDD ≥ −25% · 최악 매매 ≥ −15%(탭 50%) · 설계 누적 ≥ 메인의 80%.
  옛 메인 v1(RSI(2) < 20 · 200일 평균 위)에도 같은 거름을 대어 '실측 손실 매매를 막았나'를 같이 본다.

재현: python3 scripts/research/r21_soxl_crash_filter.py   (시세는 FinanceDataReader — 실험실과 같은 fetch_us)
"""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

sx = L.fetch_us("SOXL")
rows = [(d, *sx[d]) for d in sorted(sx)]
D, C = [r[0] for r in rows], [r[4] for r in rows]
MAIN = dict(rsiMax=30, rsiN=2, ibsMax=0.6, downDays=0, ma=100, maxHoldDays=5, tabSize=0.5)
V1 = dict(L.MAIN_DEFAULT["soxl"]["params"], tabSize=0.5)                 # 옛 메인 v1: RSI(2) < 20 · 200일 평균 위


def crash_a(i):
    return C[i] <= max(C[max(0, i - 19):i + 1]) * 0.70


def crash_b(i):
    r = [(C[k] / C[k - 1] - 1) * 100 for k in range(max(1, i - 19), i + 1)]
    return len(r) >= 2 and statistics.pstdev(r) >= 7.0


def run(p, block=None):
    orig = L.soxl_signal
    start = max(p["ma"], int(p.get("rsiN") or 2) + 1)
    k = {"i": start}

    def wrapped(pp, r2, ibs, down):                 # 엔진은 날마다 한 번씩 순서대로 부른다 — 호출 순번 = 그날 번호
        i = k["i"]
        k["i"] += 1
        s = orig(pp, r2, ibs, down)
        return s and not (block and block(i))
    L.soxl_signal = wrapped
    try:
        tab, full, dec, _ = L.soxl_series(dict(p, version="r21"), rows)
    finally:
        L.soxl_signal = orig
    assert k["i"] == len(rows), (k["i"], len(rows))
    trades, cur = [], None
    for r in dec:
        if r["action"] == "enter":
            cur = [r["date"], 1 + r["pnlPct"] * p["tabSize"] / 100]
        elif r["action"] in ("hold", "exit") and cur:
            cur[1] *= 1 + r["pnlPct"] * p["tabSize"] / 100
            if r["action"] == "exit":
                trades.append((cur[0], (cur[1] - 1) * 100))
                cur = None
    return tab, trades


def seg(tab, trades, a, b):
    cal = [d for d in D if a <= d <= b]
    eq, peak, mdd = 1.0, 1.0, 0.0
    for d in cal:
        eq *= 1 + tab.get(d, 0.0) / 100
        peak = max(peak, eq)
        mdd = min(mdd, (eq / peak - 1) * 100)
    tr = [x for dt, x in trades if a <= dt <= b]
    yrs = len(cal) / 252
    return dict(cum=round((eq - 1) * 100, 1), cagr=round((eq ** (1 / yrs) - 1) * 100, 1) if yrs > 0 else None, mdd=round(mdd, 1),
                n=len(tr), win=round(sum(1 for x in tr if x > 0) / len(tr) * 100, 1) if tr else None,
                worst=round(min(tr), 1) if tr else None, avg=round(statistics.fmean(tr), 2) if tr else None)


SEGS = [("design", "2011-01-01", "2022-12-31"), ("valid", "2023-01-01", "2026-09-30"), ("fwd", "2026-10-01", "2099-12-31"), ("all", "2011-01-01", "2099-12-31")]
out = {}
for name, p in (("main", MAIN), ("v1", V1)):
    for fl, blk in (("base", None), ("A", crash_a), ("B", crash_b)):
        tab, trades = run(p, blk)
        out[f"{name}|{fl}"] = {s: seg(tab, trades, a, b) for s, a, b in SEGS}
        if name == "v1":
            out[f"{name}|{fl}"]["octTrades"] = [(dt, round(x, 2)) for dt, x in trades if dt >= "2026-09-15"]
        if fl == "base":
            out[f"{name}|{fl}"]["worst5"] = sorted(trades, key=lambda t: t[1])[:5]
for k, v in out.items():
    print(k, json.dumps(v, ensure_ascii=False))
for name in ("main", "v1"):
    if f"{name}|base" not in out:
        continue
    b = out[f"{name}|base"]
    for fl in ("A", "B"):
        x = out[f"{name}|{fl}"]
        ok = (x["valid"]["cum"] >= b["valid"]["cum"] and x["valid"]["mdd"] >= -25 and (x["valid"]["worst"] or 0) >= -15
              and x["design"]["cum"] >= 0.8 * b["design"]["cum"])
        print(name, fl, "PASS" if ok else "FAIL", "valid", x["valid"]["cum"], "vs", b["valid"]["cum"], "design", x["design"]["cum"], "vs", b["design"]["cum"])
