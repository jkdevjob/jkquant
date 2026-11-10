"""R6 — 빈도 보정 세기(β) 재검토. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-11 R6(커밋 1b184019).
사용: JKQ_DATA=<scalping-data 의 data 폴더 사본> python scripts/research/r6_freq_beta.py latest.json [crypto|daytrading ...]
  - 후보 = latest.json(11/11 경쟁 계산)의 탭별 표 줄 전부(고정).
  - 2022-01-01 부터 분기마다(1·4·7·10월 1일) 그 전날까지 자료로만 연구실 _Evaluator(metrics · robust(이웃 중앙값) · gate_ok)를 내고,
    β ∈ {0, 0.25, 0.5} 로 순위(게이트 통과 먼저 · 메인 +0.02 보호 · 빈도 기준 = 그 길의 지금 메인)를 매겨 1위를 다음 분기에 쓴다.
  - ③ 은 자료가 60분봉이라 신호가 그날까지 자료로만 정해진다(전략 식이 미래를 보지 않는다) — 전체 자료로 한 번 계산한 일 손익을
    선택 시점 전날까지 잘라 쓴다(_Evaluator 가 부르는 coin_series 를 감싸 자른다). ② 는 경쟁 계산처럼 달력(kr_cal)을 자른다."""
import json
import os
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

BETAS = [0.0, 0.25, 0.5]
MAIN0 = {"crypto": "g_coin_ma15_s99_hi7_eth", "daytrading": "g_etf_th4.75"}
PER = {"crypto": 365, "daytrading": 250}
FROM = "2022-01-01"
ARENA_KR_FROM = "2018-04-01"       # 경쟁 계산의 ② 달력 시작(① 연구 달력) — R36 에서 확인


def quarters(end):
    out, y, m = [], 2022, 1
    while date(y, m, 1).isoformat() <= end:
        out.append(date(y, m, 1).isoformat())
        m += 3
        if m > 12:
            y, m = y + 1, m - 12
    return out


CUT = {"d": None}
_COIN_FULL = {}
_orig_coin_series = L.coin_series


def coin_series_cut(p, rows_by_market):
    key = json.dumps({k: v for k, v in p.items() if k != "version"}, sort_keys=True)
    if key not in _COIN_FULL:
        _COIN_FULL[key] = _orig_coin_series(p, rows_by_market)
    r = _COIN_FULL[key]
    c = CUT["d"]
    if c is None:
        return r
    return ({d: v for d, v in r[0].items() if d < c}, {d: v for d, v in r[1].items() if d < c}, r[2], r[3], [d for d in r[4] if d < c])


L.coin_series = coin_series_cut


def full_series(tab, params, ctx_full):
    CUT["d"] = None
    if tab == "crypto":
        r = L.coin_series(dict(params), ctx_full["coin"])
        return r[0], r[4]
    return L.etf_series(dict(params)), ctx_full["kr_cal"]


def rows_at(tab, cands, ctx_full, s):
    """선택 시점 s 전날까지 자료로 후보마다 경쟁 계산 값(β 와 무관한 안정 점수 · 연 매매 · 게이트)."""
    CUT["d"] = s
    ctx = dict(ctx_full)
    if tab == "daytrading":
        ctx["kr_cal"] = [d for d in ctx_full["kr_cal"] if d < s]
    E = L._Evaluator(tab, ctx)
    out = {}
    for c in cands:
        m = E.metrics(c["params"], c["version"])
        if not m or m.get("error"):
            continue
        r = E.robust(c["params"], m)
        out[c["version"]] = dict(stable=r["stable"], tpy=r["tradesPerYear"], gate=L.gate_ok(r))
    CUT["d"] = None
    return out


def pick(rows, main, beta):
    ref = (rows.get(main) or {}).get("tpy")

    def score(v, r):
        st = r["stable"] if r["stable"] is not None else -1e9
        f = 1.0 if (not ref or not r["tpy"] or ref <= 0 or r["tpy"] <= 0) else (r["tpy"] / ref) ** beta
        s = st * f if st > 0 else st
        return s + (L.MAIN_MARGIN if v == main else 0.0)
    return sorted(rows, key=lambda v: (not rows[v]["gate"], -score(v, rows[v])))[0]


def run(tab, cands, ctx_full):
    full = {c["version"]: full_series(tab, c["params"], ctx_full) for c in cands}
    cal_all = sorted(set().union(*[set(x[1]) for x in full.values()]))
    end = cal_all[-1]
    qs = quarters(end)
    print(f"\n== {tab} · 후보 {len(cands)} · 자료 {cal_all[0]}~{end} · 재선정 {len(qs)}회({qs[0]}~{qs[-1]})")
    rows_by_q = {}
    for s in qs:
        rows_by_q[s] = rows_at(tab, cands, ctx_full, s)
    res = {}
    for beta in BETAS:
        main, chain, picks, switches = MAIN0[tab], {}, [], 0
        for i, s in enumerate(qs):
            top = pick(rows_by_q[s], main, beta)
            if top != main:
                switches += 1
            main = top
            e = qs[i + 1] if i + 1 < len(qs) else "9999-12-31"
            dv = full[main][0]
            chain.update({d: v for d, v in dv.items() if s <= d < e})
            picks.append((s, main))
        cal = [d for d in cal_all if d >= FROM]
        m = L.goal_metrics(chain, cal, PER[tab])
        eq = 1.0
        for d in cal:
            eq *= 1 + chain.get(d, 0.0) / 100
        res[beta] = dict(cum=(eq - 1) * 100, wk=m.get("weeklyAvgPct"), mdd=m.get("mddPct"), worst=m.get("worstDayPct"),
                         tpy=m.get("tradeDaysPerYear"), plus1=m.get("plus1DaysPerYear"), switches=switches, picks=picks)
        print(f"β={beta:4.2f} | 누적 {res[beta]['cum']:+8.1f}% | 주 평균 {res[beta]['wk']:+.3f}% | MDD {res[beta]['mdd']:6.1f}% | 최악일 {res[beta]['worst']:6.2f}% | "
              f"연 매매 {res[beta]['tpy']:5.1f} | +1% 연 {res[beta]['plus1']:5.1f}일 | 교체 {switches}")
    print("분기별 선택(β 0 / 0.25 / 0.5):")
    for i, s in enumerate(qs):
        print("  ", s, " / ".join(res[b]["picks"][i][1] for b in BETAS))
    # 비교 기준: 처음 메인을 고정으로 계속 썼다면
    dv0 = full[MAIN0[tab]][0]
    cal = [d for d in cal_all if d >= FROM]
    m0 = L.goal_metrics({d: v for d, v in dv0.items() if d >= FROM}, cal, PER[tab])
    eq = 1.0
    for d in cal:
        eq *= 1 + dv0.get(d, 0.0) / 100
    print(f"참고 — 처음 메인 {MAIN0[tab]} 고정: 누적 {(eq - 1) * 100:+.1f}% · MDD {m0.get('mddPct'):.1f}% · 연 매매 {m0.get('tradeDaysPerYear'):.1f}")
    return res


def main(latest, tabs):
    lj = json.loads(Path(latest).read_text(encoding="utf-8"))
    ctx_full = {}
    if "crypto" in tabs:
        ctx_full["coin"] = {m: L.fetch_hourly(m) for m in ("KRW-BTC", "KRW-ETH")}
    if "daytrading" in tabs:
        cal = [b[0] for b in L.etf_bars("233740")]
        ctx_full["kr_cal"] = [d for d in cal if d >= ARENA_KR_FROM]
    for tab in tabs:
        cands = [dict(version=r["version"], params=r["params"]) for r in lj["arena"][tab]["rows"]]
        assert MAIN0[tab] in {c["version"] for c in cands}, f"{tab}: 처음 메인이 후보에 없다"
        run(tab, cands, ctx_full)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:] or ["daytrading", "crypto"])
