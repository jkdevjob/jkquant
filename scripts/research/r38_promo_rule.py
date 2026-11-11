"""R38 — 자동 승격 기준 전체 점검. 사전 등록: CLAUDE-SCALPING-RESEARCH.md 2026-11-12 R38(커밋 4cf3e5c2).
사용:
  재현 확인: JKQ_DATA=<scalping-data 의 data 사본> python scripts/research/r38_promo_rule.py latest.json --repro
  본 계산  : JKQ_DATA=<…> python scripts/research/r38_promo_rule.py latest.json [opening daytrading crypto soxl close30]
  - 후보 = latest.json(11/12 06:33 경쟁 계산)의 탭별 표 줄 전부(고정) · 첫 메인 = 같은 계산의 메인.
  - 2022-01-01 부터 분기마다(주 판정) · 매달(확인용) 그 전날까지 자료로만 연구실 _Evaluator 값(안정 점수 · 연 매매 · 게이트 · MDD · 최악일)을 내고,
    변형 V0~V6 의 규칙으로 1위를 골라 다음 구간 실제 일 손익을 이어 붙인다.
  - ①②③⑤ 는 일 손익과 달력을 선택 날 전으로 자른다(전략 식이 그날까지 자료로만 정해진다 — 전체 자료로 한 번 계산해 자른다).
    ② 는 경쟁 계산처럼 달력(kr_cal = ① 연구 달력 2018-04-01~)도 자른다. ④ 는 R37 처럼 일봉 자체를 잘라 다시 계산한다.
  - 실제 경쟁 규칙처럼 1위가 게이트 미달이면 바꾸지 않는다(arena: `days >= PROMOTE_DAYS and gate_ok(top)`)."""
import json
import math
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

TABS = ["opening", "daytrading", "crypto", "soxl", "close30"]
JUDGE = ["opening", "daytrading", "crypto", "soxl"]
PER = {"opening": 250, "daytrading": 250, "close30": 250, "crypto": 365, "soxl": 252}
FROM = "2022-01-01"
ARENA_KR_FROM = "2018-04-01"
VARIANTS = {
    "V0": dict(),                      # 지금: β 0.25 · 메인 +0.02 · 게이트 그대로
    "V1": dict(beta=0.0),
    "V2": dict(beta=0.125),
    "V3": dict(beta=0.5),
    "V4": dict(raw=True),              # 보정 전 안정 점수도 메인보다 높아야 교체(둘 다 게이트 통과일 때)
    "V5": dict(rel=True),              # 메인 보호 = 메인 순위 점수의 10%(≤0 이면 +0.02)
    "V6": dict(band=True),             # 메인만 낙폭 기준 MDD −28% · 최악일 −17%
}

# ── 선택 날 전으로 자르기 ─────────────────────────────────────────────────────────────
CUT = {"d": None}
_FULL = {}


def _key(kind, p):
    return kind + json.dumps({k: v for k, v in p.items() if k != "version"}, sort_keys=True)


def _cut(dv, cal):
    c = CUT["d"]
    if c is None:
        return dv, cal
    return {d: v for d, v in dv.items() if d < c}, [d for d in cal if d < c]


_orig = dict(coin=L.coin_series, d1=L.d1_series, c30=L.close30_series, etf=L.etf_series)


def coin_cut(p, rows):
    k = _key("coin", p)
    if k not in _FULL:
        _FULL[k] = _orig["coin"](p, rows)
    r, c = _FULL[k], CUT["d"]
    if c is None:
        return r
    return ({d: v for d, v in r[0].items() if d < c}, {d: v for d, v in r[1].items() if d < c}, r[2], r[3], [d for d in r[4] if d < c])


def d1_cut(p):
    k = _key("d1", p)
    if k not in _FULL:
        _FULL[k] = _orig["d1"](p)
    return _cut(*_FULL[k])


def c30_cut(p):
    k = _key("c30", p)
    if k not in _FULL:
        _FULL[k] = _orig["c30"](p)
    return _cut(*_FULL[k])


def etf_cut(p):
    k = _key("etf", p)
    if k not in _FULL:
        _FULL[k] = _orig["etf"](p)
    return _cut(_FULL[k], [])[0]


L.coin_series, L.d1_series, L.close30_series, L.etf_series = coin_cut, d1_cut, c30_cut, etf_cut


def full_series(tab, params, ctx):
    """전체 자료의 (일 손익, 달력) — 이어 붙이기용."""
    CUT["d"] = None
    p = dict(params)
    if tab == "crypto":
        r = L.coin_series(p, ctx["coin"])
        return r[0], r[4]
    if tab == "opening":
        return L.d1_series(p)
    if tab == "close30":
        return L.close30_series(p)
    if tab == "daytrading":
        return L.etf_series(p), ctx["kr_cal"]
    srows = ctx["soxl"]
    return L.soxl_series(dict(p, version="x"), srows)[0], [r[0] for r in srows]


def rows_at(tab, cands, ctx_full, s):
    """선택 날 s 전날까지 자료로 후보마다 경쟁 계산 값. s=None 이면 전체 자료."""
    CUT["d"] = s
    ctx = dict(ctx_full)
    if s:
        if tab == "daytrading":
            ctx["kr_cal"] = [d for d in ctx_full["kr_cal"] if d < s]
        if tab == "soxl":
            ctx["soxl"] = [r for r in ctx_full["soxl"] if r[0] < s]
    E = L._Evaluator(tab, ctx)
    out = {}
    for c in cands:
        m = E.metrics(c["params"], c["version"])
        if not m or m.get("error"):
            continue
        r = E.robust(c["params"], m)
        f, y = r.get("full") or {}, r.get("years") or {}
        out[c["version"]] = dict(stable=r["stable"], tpy=r["tradesPerYear"], gate=L.gate_ok(r), mdd=f.get("mddPct"), worst=f.get("worstDayPct"),
                                 exp=f.get("expectancyPct"), tdays=f.get("tradeDays"), pos=y.get("pos"), n=y.get("n"), vals=bool(f.get("tradeDays")))
    CUT["d"] = None
    return out


# ── 변형 규칙 ────────────────────────────────────────────────────────────────────────
def gate_band(r):
    """V6: 메인만 낙폭 기준을 넓혀 본다(MDD −28% · 최악일 −17%). 기대값 · 매매일 · 플러스 해는 그대로."""
    if not r.get("vals") or r.get("exp") is None or r["exp"] <= 0:
        return False
    if (r.get("mdd") if r.get("mdd") is not None else -1e9) < -28.0 or (r.get("worst") if r.get("worst") is not None else -1e9) < -17.0:
        return False
    if (r.get("tdays") or 0) < L.MIN_TRADE_DAYS:
        return False
    if r.get("n") and r["pos"] / r["n"] < L.YEAR_POS_MIN:
        return False
    return True


def pick(rows, main, V):
    beta = V.get("beta", L.FREQ_BETA)
    ref = (rows.get(main) or {}).get("tpy")

    def gate(v):
        return gate_band(rows[v]) if (V.get("band") and v == main) else rows[v]["gate"]

    def rscore(v):
        r = rows[v]
        st = r["stable"] if r["stable"] is not None else -1e9
        f = 1.0 if (not ref or not r["tpy"] or ref <= 0 or r["tpy"] <= 0) else (r["tpy"] / ref) ** beta
        return st * f if st > 0 else st

    def bonus(v):
        if v != main:
            return 0.0
        if V.get("rel"):
            s = rscore(v)
            return 0.10 * s if s > 0 else L.MAIN_MARGIN
        return L.MAIN_MARGIN

    order = sorted(rows, key=lambda v: (not gate(v), -(rscore(v) + bonus(v))))
    top = order[0]
    if main not in rows or top == main:
        return top if main not in rows else main
    if not gate(top):                                  # 실제 규칙: 게이트 미달 1위는 승격하지 않는다
        return main
    if V.get("raw") and gate(main):
        a, b = rows[top]["stable"], rows[main]["stable"]
        if a is None or b is None or not a > b:
            return main
    return top


def dates(end, months):
    out, y, m = [], 2022, 1
    while date(y, m, 1).isoformat() <= end:
        out.append(date(y, m, 1).isoformat())
        m += months
        while m > 12:
            y, m = y + 1, m - 12
    return out


def chain_stats(tab, full, main0, sels, rows_by, V):
    main, chain, picks, sw = main0, {}, [], 0
    for i, s in enumerate(sels):
        nxt = pick(rows_by[s], main, V)
        sw += nxt != main
        main = nxt
        e = sels[i + 1] if i + 1 < len(sels) else "9999-12-31"
        chain.update({d: v for d, v in full[main][0].items() if s <= d < e})
        picks.append(main)
    cal = sorted({d for x in full.values() for d in x[1] if d >= FROM})
    m = L.goal_metrics({d: v for d, v in chain.items() if d >= FROM}, cal, PER[tab])
    eq = 1.0
    for d in cal:
        eq *= 1 + chain.get(d, 0.0) / 100
    return dict(cum=(eq - 1) * 100, mdd=m.get("mddPct"), worst=m.get("worstDayPct"), tpy=m.get("tradeDaysPerYear"), plus1=m.get("plus1DaysPerYear"),
                wk=m.get("weeklyAvgPct"), sw=sw, picks=picks)


def build_ctx(tabs):
    ctx = {}
    if "crypto" in tabs:
        ctx["coin"] = {m: L.fetch_hourly(m) for m in ("KRW-BTC", "KRW-ETH")}
    if "daytrading" in tabs:
        m1 = L.MAIN_DEFAULT["opening"]["params"]
        _, krx_cal = _orig["d1"](dict(m1))                 # 경쟁 계산과 같은 ① 연구 달력
        ctx["kr_cal"] = [d for d in krx_cal if d >= ARENA_KR_FROM]
    if "soxl" in tabs:
        sx = L.fetch_us(L.SOXL_MR["trade"])
        ctx["soxl"] = [(d, *sx[d]) for d in sorted(sx)]
    return ctx


def cands_of(lj, tab):
    t = lj["arena"][tab]
    return [dict(version=r["version"], params=r["params"]) for r in t["rows"]], t["main"]


def repro(lj, tabs):
    """자르는 날짜를 11/12 계산의 자료 끝에 맞춰 경쟁군 안정 점수가 같은지(±5e-4). 날짜 후보를 차례로 본다."""
    ctx = build_ctx(tabs)
    for tab in tabs:
        cands, main = cands_of(lj, tab)
        want = {r["version"]: r for r in lj["arena"][tab]["rows"]}
        best = None
        for s in [None, "2026-11-13", "2026-11-12", "2026-11-11", "2026-11-10", "2026-11-09"]:
            got = rows_at(tab, cands, ctx, s)
            same = sum(1 for v, r in got.items() if want[v].get("stable") is not None and r["stable"] is not None and abs(want[v]["stable"] - r["stable"]) < 5e-4)
            print(f"  {tab:10} 자르는 날 {s or '없음':10} 안정 점수 같음 {same}/{len(want)} (계산 {len(got)})")
            if best is None or same > best[1]:
                best = (s, same)
            if same == len(want):
                break
        print(f"  → {tab}: {'재현 — 자르는 날 ' + str(best[0]) if best[1] == len(want) else '재현 안 됨 — 판정에서 뺀다'}")


def run(lj, tabs):
    ctx = build_ctx(tabs)
    res = {}
    for tab in tabs:
        cands, main0 = cands_of(lj, tab)
        assert main0 in {c["version"] for c in cands}, f"{tab}: 메인이 후보에 없다"
        full = {c["version"]: full_series(tab, c["params"], ctx) for c in cands}
        end = max(d for x in full.values() for d in x[1])
        res[tab] = {}
        for label, months in (("분기", 3), ("매달", 1)):
            sels = dates(end, months)
            rows_by = {s: rows_at(tab, cands, ctx, s) for s in sels}
            res[tab][label] = {k: chain_stats(tab, full, main0, sels, rows_by, V) for k, V in VARIANTS.items()}
            print(f"\n== {tab} · {label} 재선정 {len(sels)}회({sels[0]}~{sels[-1]}) · 후보 {len(cands)} · 첫 메인 {main0} · 자료 끝 {end}")
            for k, st in res[tab][label].items():
                print(f"  {k} 누적 {st['cum']:+9.1f}% · MDD {st['mdd']:6.1f}% · 최악일 {st['worst']:6.2f}% · 연 매매 {st['tpy']:5.1f} · +1% {st['plus1']:5.1f}일 · 주 {st['wk']:+.3f}% · 교체 {st['sw']}")
            if label == "분기":
                print("  분기별 선택(V0 / V1 / V4 / V6):")
                for i, s in enumerate(sels):
                    print("   ", s, " / ".join(res[tab][label][k]["picks"][i] for k in ("V0", "V1", "V4", "V6")))
    return res


def judge(res):
    tabs = [t for t in JUDGE if t in res]
    print(f"\n== 판정(사전 기준 · 탭 {', '.join(tabs)})")
    out = {}
    for k in VARIANTS:
        if k == "V0":
            continue
        dq = sum(math.log1p(res[t]["분기"][k]["cum"] / 100) - math.log1p(res[t]["분기"]["V0"]["cum"] / 100) for t in tabs)
        dm = sum(math.log1p(res[t]["매달"][k]["cum"] / 100) - math.log1p(res[t]["매달"]["V0"]["cum"] / 100) for t in tabs)
        worse = [t for t in tabs if (1 + res[t]["분기"][k]["cum"] / 100) / (1 + res[t]["분기"]["V0"]["cum"] / 100) < 0.95
                 or res[t]["분기"][k]["mdd"] < res[t]["분기"]["V0"]["mdd"] - 2.0]
        ok = dq >= 0.05 and len(worse) <= 1 and dm > 0
        out[k] = dict(dq=dq, dm=dm, worse=worse, ok=ok)
        print(f"  {k}: 분기 Δ {dq:+.3f} · 매달 Δ {dm:+.3f} · 뚜렷이 나쁜 탭 {worse or '없음'} → {'통과' if ok else '미통과'}")
    return out


if __name__ == "__main__":
    lj = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    args = sys.argv[2:]
    if "--repro" in args:
        repro(lj, [a for a in args if a != "--repro"] or TABS)
    else:
        r = run(lj, args or TABS)
        judge(r)
