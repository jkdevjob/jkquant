"""R37 — ④ 자동 승격 전 점검. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-12 R37(커밋 89bfdcbc).
사용: python scripts/research/r37_soxl_promo.py latest.json
  (a) 후보(11/12 경쟁 1위)와 메인을 연구실 soxl_series 그대로(FDR SOXL) 해마다 · 2022~ 로 비교한다.
  (b) R6 와 같은 분기 재선정(2022~ · 11/12 ④ 경쟁군 · β ∈ {0, 0.25, 0.5}) — 선택 시점 전날까지의 일봉만 넣어 다시 계산한다(진짜 걸어가기)."""
import importlib.util
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

_spec = importlib.util.spec_from_file_location("r6", str(Path(__file__).resolve().parent / "r6_freq_beta.py"))
R6 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(R6)

MAIN = "g_soxl_r2lt30_ibs0.6_ma100_d5"
FROM = "2022-01-01"
PER = 252


def stats(dv, cal):
    m = L.goal_metrics({d: v for d, v in dv.items() if d in set(cal)}, cal, PER)
    eq = 1.0
    for d in cal:
        eq *= 1 + dv.get(d, 0.0) / 100
    return dict(cum=(eq - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"), tpy=m.get("tradeDaysPerYear"), plus1=m.get("plus1DaysPerYear"),
                wk=m.get("weeklyAvgPct"))


def yearly(dv, cal):
    out = {}
    for d in cal:
        y = d[:4]
        out[y] = out.get(y, 1.0) * (1 + dv.get(d, 0.0) / 100)
    return {y: (v - 1) * 100 for y, v in out.items()}


def main(latest):
    lj = json.loads(Path(latest).read_text(encoding="utf-8"))
    t = lj["arena"]["soxl"]
    cands = [dict(version=r["version"], params=r["params"]) for r in t["rows"]]
    top = t["rows"][0]["version"]
    assert MAIN in {c["version"] for c in cands} and top != MAIN
    sx = L.fetch_us(L.SOXL_MR["trade"])
    srows = [(d, *sx[d]) for d in sorted(sx)]
    cal_all = [r[0] for r in srows]
    print(f"SOXL 일봉 {cal_all[0]}~{cal_all[-1]} · {len(cal_all)}일 · 후보 {len(cands)} · 1위 {top} · 메인 {MAIN}")
    full = {c["version"]: L.soxl_series(dict(c["params"], version=c["version"]), srows)[0] for c in cands}

    # (a) 고정 비교
    print("\n(a) 고정 비교 — 누적 · MDD · 최악일 · 연 매매 · +1% 달성일(연) · 주 평균")
    for lab, frm in (("전체", cal_all[0]), ("2015~", "2015-01-01"), ("2022~", FROM)):
        cal = [d for d in cal_all if d >= frm]
        for v in (top, MAIN):
            s = stats(full[v], cal)
            print(f"  {lab:5} {v:34} 누적 {s['cum']:+9.1f}% · MDD {s['mdd']:6.1f}% · 최악일 {s['worst']:6.2f}% · 연 매매 {s['tpy']:5.1f} · +1% {s['plus1']:5.1f}일 · 주 {s['wk']:+.3f}%")
    ya, yb = yearly(full[top], cal_all), yearly(full[MAIN], cal_all)
    print("  해마다(후보 / 메인 · %):", " · ".join(f"{y} {ya[y]:+.1f}/{yb[y]:+.1f}" for y in sorted(ya) if y >= "2015"))
    wins = sum(1 for y in ya if y >= "2015" and ya[y] > yb[y])
    print(f"  후보가 나은 해 {wins}/{sum(1 for y in ya if y >= '2015')}")

    # (b) 분기 재선정(β)
    qs = R6.quarters(cal_all[-1])
    rows_by_q = {}
    for s in qs:
        ctx = {"soxl": [r for r in srows if r[0] < s]}
        E = L._Evaluator("soxl", ctx)
        out = {}
        for c in cands:
            m = E.metrics(c["params"], c["version"])
            if not m or m.get("error"):
                continue
            r = E.robust(c["params"], m)
            out[c["version"]] = dict(stable=r["stable"], tpy=r["tradesPerYear"], gate=L.gate_ok(r))
        rows_by_q[s] = out
    cal = [d for d in cal_all if d >= FROM]
    print(f"\n(b) 분기 재선정 {len(qs)}회({qs[0]}~{qs[-1]}) — β · 누적 · MDD · 최악일 · 연 매매 · +1% 연 · 교체")
    picks = {}
    for beta in R6.BETAS:
        main, chain, sw, pk = MAIN, {}, 0, []
        for i, s in enumerate(qs):
            nxt = R6.pick(rows_by_q[s], main, beta)
            sw += nxt != main
            main = nxt
            e = qs[i + 1] if i + 1 < len(qs) else "9999-12-31"
            chain.update({d: v for d, v in full[main].items() if s <= d < e})
            pk.append(main)
        st = stats(chain, cal)
        picks[beta] = pk
        print(f"  β={beta:4.2f} 누적 {st['cum']:+8.1f}% · MDD {st['mdd']:6.1f}% · 최악일 {st['worst']:6.2f}% · 연 매매 {st['tpy']:5.1f} · +1% {st['plus1']:5.1f}일 · 교체 {sw}")
    print("  분기별 선택(β 0 / 0.25 / 0.5):")
    for i, s in enumerate(qs):
        print("   ", s, " / ".join(picks[b][i] for b in R6.BETAS))


if __name__ == "__main__":
    main(sys.argv[1])
