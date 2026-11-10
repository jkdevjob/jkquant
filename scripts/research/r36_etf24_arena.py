"""R36 — ② 24시간 규칙 뒤 경쟁 순위 점검. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-10 R36(커밋 0e792dfc).
사용: python scripts/research/r36_etf24_arena.py [latest.json]
  - 연구실 경쟁 계산과 같은 _Evaluator(metrics · robust(이웃 중앙값) · 빈도 보정 · gate_ok)로 th 후보(모두 24시간)를 매긴다.
  - latest.json(scalping-data data/claude-lab/latest.json)을 주면 경쟁군에 있는 기준의 점수를 그대로 맞춰 본다(재현 확인).
  - 일봉은 claude_lab.etf_bars(FinanceDataReader 233740 · 2016~ · 오늘 봉은 16:00 뒤에만)를 그대로 쓴다."""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

CODE = "233740"
TH = [-4.0, -4.25, -4.5, -4.75, -5.0, -5.5, -6.0, -6.5, -7.0, -7.5]
MAIN_TH = -4.75
WF_FROM = "2020-01-01"
ARENA_FROM = "2018-04-01"
ARENA_END = "2026-11-06"   # 11/10 06:28 경쟁 계산의 ① 연구 달력 끝(11/09 는 아직 없었다) — 이 날까지로 맞춰야 점수가 같다


def fixed_stats(th, cal):
    """시간순(고정 기준) — WF_FROM 부터의 매매 · 누적 · MDD · 최악일 · +1% 달성일(goal_metrics 그대로)."""
    dv, _ = L.etf_variant(CODE, th)
    c = [d for d in cal if d >= WF_FROM]
    d2 = {d: v for d, v in dv.items() if d >= WF_FROM}
    m = L.goal_metrics(d2, c, 250)
    eq = 1.0
    for d in c:
        eq *= 1 + d2.get(d, 0.0) / 100
    ys = L.year_stats(d2, c)
    years = len({d[:4] for d in c})
    v = list(d2.values())
    return dict(n=len(v), perYear=len(v) / years if years else None, avg=statistics.fmean(v) if v else None, cum=(eq - 1) * 100,
                mdd=m.get("mddPct"), worst=m.get("worstDayPct"), plus1=m.get("plus1Days"), plus1Yr=m.get("plus1DaysPerYear"), years=f"{ys.get('pos')}/{ys.get('n')}")


def main(latest=None):
    bars = L.etf_bars(CODE)
    cal = [b[0] for b in bars]
    print(f"자료 {cal[0]}~{cal[-1]} · {len(cal)}거래일")
    # 경쟁 계산(claude_lab main)과 같은 달력: ① 연구 달력의 2018-04-01~ (kr_cal=[d for d in krx_cal if d >= "2018-04-01"]).
    # ① 달력 대신 같은 기간의 233740 거래일을 쓴다(같은 KRX 거래일). 2016~ 로 세거나 11/09 까지 넣으면 점수가 경쟁과 달라진다(처음 돌린 두 번 · 버림).
    arena_cal = [d for d in cal if ARENA_FROM <= d <= ARENA_END]
    print(f"경쟁 달력 {arena_cal[0]}~{arena_cal[-1]} · {len(arena_cal)}거래일")
    ctx = {"kr_cal": arena_cal}
    E = L._Evaluator("daytrading", ctx)
    main_p = dict(code=CODE, th=MAIN_TH)
    mm = E.metrics(main_p, "g_etf_th4.75")
    E.ref = mm.get("tradesPerYear")
    rows = []
    for th in TH:
        p = dict(code=CODE, th=th)
        m = E.metrics(p)
        r = E.robust(p, m)
        r["th"], r["gate"] = th, L.gate_ok(r)
        r["why"] = L.gate_reason(r)
        rows.append(r)
    ranked = sorted(rows, key=lambda r: (not r["gate"], -((r["score"] if r["score"] is not None else -1e9) + (L.MAIN_MARGIN if r["th"] == MAIN_TH else 0.0))))
    print("\n경쟁 계산 그대로(24시간) — 순위 · th · 순위 점수 · 안정 · adj · 이웃 중앙값 · 빈도 보정 · 연 매매 · MDD · 최악일 · 게이트")
    for i, r in enumerate(ranked, 1):
        f = r.get("full") or {}
        print(f"{i:2d} | {r['th']:5.2f} | {r['score']:+.4f} | {r['stable']:+.4f} | {r['adj']:+.4f} | "
              f"{(r['plateau'] if r['plateau'] is not None else float('nan')):+.4f} | {r['freqFactor']:.3f} | {r['tradesPerYear']:5.1f} | "
              f"{f.get('mddPct'):6.1f} | {f.get('worstDayPct'):6.2f} | {'통과' if r['gate'] else r['why'][:40]}")
    if latest:
        lj = json.loads(Path(latest).read_text(encoding="utf-8"))
        arena_rows = {x["version"]: x for x in lj["arena"]["daytrading"]["rows"]}
        print("\n재현 확인(경쟁군에 있는 기준 · 11/10 latest.json 대 이 계산)")
        ok = True
        for r in rows:
            v = L.gen_version("daytrading", L._canon("daytrading", dict(code=CODE, th=r["th"])))
            a = arena_rows.get(v)
            if a is None:
                continue
            same = abs((a.get("score") or 0) - r["score"]) < 5e-4
            ok &= same
            print(f"  {v}: 경쟁 {a.get('score'):+.4f} · 이 계산 {r['score']:+.4f} → {'같음' if same else '다름'}")
        print("  재현:", "같음 — 결과를 쓴다" if ok else "다름 — 판정하지 않는다")
    print(f"\n시간순(고정 기준 · {WF_FROM}~) — th · 매매 · 연 매매 · 평균% · 누적% · MDD% · 최악일% · 플러스해 · +1% 달성일(연)")
    for th in TH:
        s = fixed_stats(th, cal)
        print(f"{th:5.2f} | {s['n']:4d} | {s['perYear']:5.1f} | {s['avg']:+.3f} | {s['cum']:+7.1f} | {s['mdd']:6.1f} | {s['worst']:6.2f} | {s['years']:>5} | {s['plus1']} ({s['plus1Yr']:.1f})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
