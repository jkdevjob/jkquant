"""R18 전략별 시간순 재선정 검증 — '그해 이전 자료로만 고르고 다음 해에 시험' (2026-10-28 사용자 "각 전략별로 연구를 좀 심도있게 분석해서 빨리 결과를 도출해").

왜: 탭마다 보이는 설계 성적(예: ① 연 30% · 계좌 연 40%)은 여러 변형 중 과거 전체에서 가장 잘 맞은 것을 고른 '고른 뒤 성적'이다.
고르는 행위 자체가 성적을 부풀린다. 실제로 기대할 수 있는 값은 '그때까지의 자료로만 고른 것'의 다음 해 성적이다.

방법(사전 등록 — 결과 보기 전):
- 탭마다 실험실(claude_lab.py)의 같은 계산 함수 · 같은 비용 · 같은 변형 격자(④ ③ 은 계산량 때문에 줄인 격자)를 쓴다.
- 해마다 Y: Y-01-01 이전 자료만으로 실험실 점수(score_metrics.adj)가 가장 높은 변형을 고른다.
  실험실 관문(MDD ≥ −25% · 최악일 ≥ −15% · 매매일 ≥ 60 · 플러스 해 60% 이상)을 통과한 것 중에서만 고르고, 통과한 것이 없으면 그해는 쉰다(0%).
- 그 변형의 Y 해 성적만 이어 붙인 것이 '시간순 실측'이다. 같은 해들에 지금 메인을 그대로 쓴 성적('지금 메인 · 사후')과 비교한다.
- 블록 부트스트랩(20거래일 묶음 · 2만 번)으로 1 · 3 · 12개월 뒤 손실 확률과 중앙값을 낸다.
- 첫 시험 해는 자료 시작 + 3년.

재현: JKQ_DATA=<scalping-data 의 data 폴더> python3 scripts/research/r18_walkforward.py <탭...>
  필요한 자료: opening-gapdown-research/{signals,decisions}.csv · etf-overnight-research/signals.csv · claude-lab/hourly · claude-lab/kr-hourly · claude-lab/main-config.json
"""
import itertools
import json
import os
import random
import statistics
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import claude_lab as L  # noqa: E402

L.MAIN_EVENTS = L.load_main_events()                         # 지금 메인(승격 기록) — main() 밖에서 쓰므로 직접 읽는다

TABS = sys.argv[1:] or ["daytrading", "opening", "soxl", "crypto", "close30"]
OUT = Path(os.environ.get("R18_OUT", "r18_out.json"))
random.seed(18)


def gate(m):
    f, y = m.get("full") or {}, m.get("years") or {}
    if not f.get("gate") or (f.get("tradeDays") or 0) < L.MIN_TRADE_DAYS:
        return False
    return not (y.get("n") and y["pos"] / y["n"] < L.YEAR_POS_MIN)


def variants(tab):
    if tab == "daytrading":
        return [dict(code="233740", th=t) for t in L.GRID["daytrading"]["th"]]
    if tab == "opening":
        g = L.GRID["opening"]
        return [dict(minQ=a, topK=b, gapMax=c) for a, b, c in itertools.product(g["minQ"], g["topK"], g["gapMax"])]
    if tab == "close30":
        return [dict(code="233740", th=t) for t in L.GRID["close30"]["th"]]
    if tab == "soxl":
        out = []
        for r, n, i, dd, ma, h in itertools.product([10.0, 20.0, 30.0, 40.0, 100.0], [2, 3], [0.2, 0.4, 0.6, 1.0], [0, 1, 2], [0, 100, 200], [1, 3, 5]):
            if r >= 100 and n != 2:
                continue
            out.append(dict(rsiMax=r, rsiN=n, ibsMax=i, downDays=dd, ma=ma, maxHoldDays=h, tabSize=1.0))
        return out
    if tab == "crypto":
        out = []
        for ma, st, hi, mk in itertools.product([10, 15, 20, 30, 50], [3.0, 5.0, 99.0], [1, 3, 7], [["KRW-BTC", "KRW-ETH"], ["KRW-BTC"], ["KRW-ETH"]]):
            out.append(dict(ma=ma, stopPct=st, level="prevhigh", k=0.5, hiN=hi, lastEntryHour=None, tabSize=1.0, markets=mk))
        return out
    raise SystemExit("unknown tab " + tab)


def series_fn(tab):
    if tab == "daytrading":
        cal = [b[0] for b in L.etf_bars("233740") if b[0] >= "2018-04-01"]
        return (lambda p: (L.etf_series(p), cal)), 250
    if tab == "opening":
        return (lambda p: L.d1_series(p)), 250
    if tab == "close30":
        return (lambda p: L.close30_series(p)), 250
    if tab == "soxl":
        sx = L.fetch_us("SOXL")
        rows = [(d, *sx[d]) for d in sorted(sx)]
        cal = [r[0] for r in rows]
        return (lambda p: (L.soxl_series(dict(p, version="r18"), rows)[0], cal)), 252
    if tab == "crypto":
        H = {m: L.fetch_hourly(m) for m in ("KRW-BTC", "KRW-ETH")}
        cache = {}

        def f(p):
            key = json.dumps(p, sort_keys=True)
            if key not in cache:
                r = L.coin_series(dict(p, version="r18"), H)
                cache[key] = (r[1], r[4])                          # 탭 자금 비율 전(칸 안 전액) 값
            return cache[key]
        return f, 365
    raise SystemExit(tab)


def block_boot(vals, horizon, n=20000, block=20):
    if len(vals) < block * 2:
        return None
    out = []
    for _ in range(n):
        eq, got = 1.0, 0
        while got < horizon:
            s = random.randrange(0, len(vals) - block)
            for x in vals[s:s + min(block, horizon - got)]:
                eq *= 1 + x / 100
            got += min(block, horizon - got)
        out.append((eq - 1) * 100)
    out.sort()
    return dict(pLoss=sum(1 for v in out if v < 0) / n * 100, p10=out[int(0.1 * n)], median=out[n // 2], p90=out[int(0.9 * n)])


def main():
    res = {}
    for tab in TABS:
        fn, per = series_fn(tab)
        vs = variants(tab)
        runs = []
        for p in vs:
            try:
                dv, cal = fn(p)
            except Exception as e:  # noqa: BLE001
                print(tab, "variant failed", p, e, file=sys.stderr)
                continue
            runs.append((p, dv, sorted(set(cal))))
        cal_all = sorted(set().union(*[set(c) for _, _, c in runs]))
        years = sorted({d[:4] for d in cal_all})
        first_test = str(int(years[0]) + 3)
        main_p = dict(L.main_for(tab)["params"])
        if "tabSize" in main_p:
            main_p["tabSize"] = 1.0                                # 칸 안 전액 기준으로 비교(변형들과 같게)
        main_key = json.dumps({k: main_p.get(k) for k in runs[0][0]}, sort_keys=True, default=str)
        main_run = next((r for r in runs if json.dumps({k: r[0].get(k) for k in r[0]}, sort_keys=True, default=str) == main_key), None)
        if main_run is None:                                        # 지금 메인이 줄인 격자에 없으면 따로 계산
            dv, cal = fn(dict(runs[0][0], **{k: main_p[k] for k in runs[0][0] if k in main_p}))
            main_run = (main_p, dv, sorted(set(cal)))
        oos, picks, mains = {}, [], {}
        for y in [y for y in years if y >= first_test]:
            cut = f"{y}-01-01"
            best = None
            for p, dv, cal in runs:
                ctr = [d for d in cal if d < cut]
                if len(ctr) < per:
                    continue
                m = L.score_metrics({d: v for d, v in dv.items() if d < cut}, ctr, per)
                if gate(m) and (best is None or (m["score"] or -9) > best[0]):
                    best = (m["score"] or -9, p, dv)
            ycal = [d for d in cal_all if d[:4] == y]
            if best:
                oos.update({d: best[2][d] for d in ycal if d in best[2]})
            mains.update({d: main_run[1][d] for d in ycal if d in main_run[1]})
            picks.append(dict(year=y, pick=best[1] if best else None))
        ocal = [d for d in cal_all if d >= f"{first_test}-01-01"]
        wf, mn = L.goal_metrics(oos, ocal, per), L.goal_metrics(mains, ocal, per)
        full_main = L.goal_metrics(main_run[1], main_run[2], per)
        vals = [oos.get(d, 0.0) for d in ocal]
        boot = {h: block_boot(vals, h) for h in (21, 63, 252)} if tab != "crypto" else {h: block_boot(vals, h) for h in (30, 90, 365)}
        yearly = {}
        for y in sorted({d[:4] for d in ocal}):
            eq = 1.0
            for d in ocal:
                if d[:4] == y:
                    eq *= 1 + oos.get(d, 0.0) / 100
            yearly[y] = round((eq - 1) * 100, 2)
        keep = lambda m: {k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items() if k in
                          ("days", "tradeDays", "tradeDaysPerYear", "totalPct", "cagrPct", "mddPct", "worstDayPct", "expectancyPct", "profitFactor", "tStat")}
        res[tab] = dict(variants=len(runs), firstTest=first_test, oosTo=ocal[-1], walkForward=keep(wf), mainSameYears=keep(mn),
                        mainFullPeriod=keep(full_main), yearly=yearly, picks=picks, bootstrap=boot)
        print(json.dumps({tab: res[tab]}, ensure_ascii=False, default=str), flush=True)
    OUT.write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
