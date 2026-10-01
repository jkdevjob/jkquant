#!/usr/bin/env python3
"""Research shadow for the opening tab: gap-DOWN oversold rebound (D-1).

Rule opening_gapdown_v1 (fixed before evaluation; see SCALPING_IMPROVEMENTS_v2.md D-1 / G):
- Universe: KOSPI · KOSDAQ · KOSDAQ GLOBAL common stocks, each day's historical membership
  (delisted stocks included). Excluded: preferred/other share classes, SPAC, REIT, halted rows.
- Liquidity: previous close >= 1,000 KRW, previous-day value traded >= 2,000,000,000 KRW,
  at least 60 prior sessions.
- Risk proxy (관리종목 대용): previous-day department 관리종목/투자주의환기종목 excluded; no trading halt
  (zero-volume session) in the last 20 sessions; no daily move beyond +-30% in the last 10 sessions
  (정리매매·재상장처럼 가격제한이 없는 구간은 -50% 일중 손실이 나서 제외).
- Signal (known at the 09:00 opening auction): previous-day RSI(14) < 30 on adjusted closes
  AND opening gap vs adjusted previous close <= -2% (and > -29%, limit-down opens excluded).
- Take the 3 deepest gaps. Buy at the opening auction (open), sell at the closing auction (close).
- Costs: tax 0.20% + commission 0.015% x 2 = 0.23% fixed, plus auction slippage scenarios of
  0 / 1.5 / 3.0 ticks per side (KRX tick table). The primary scenario is 1.5 ticks.
- Control: same day, same liquidity filters, gap <= -2% but NO RSI condition, 3 random names
  (seed = date). Strategy skill = strategy - control.

Research only. No orders. Daily-bar strategy: intraday path fields (fwd 5~30m, first-hit times)
are unknowable from daily bars and are written as null; day high/low give MFE/MAE because both
occur at or after the opening-auction entry.

Adjusted prices: KRX `Changes` is measured against the adjusted base price, so the previous
adjusted close is `Close - Changes` and returns chain through splits without fake crashes.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import math
import os
import random
import statistics
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
OUT = Path(os.environ.get("JKQ_GAPDOWN_OUT", "data/opening-gapdown-research"))
LIVE = Path(os.environ.get("JKQ_GAPDOWN_LIVE", str(OUT.parent / "opening-gapdown-live")))
CACHE = Path(os.environ.get("JKQ_GAPDOWN_CACHE", ".cache/krx-daily"))
FROM_YEAR = int(os.environ.get("JKQ_GAPDOWN_FROM_YEAR", str(datetime.now(KST).year - 1)))
DESIGN_END = "2026-09-30"          # rule designed on data up to here; verdict uses later days only
STRATEGY_VERSION = "opening_gapdown_v1"
SCHEMA = 1

# v2 (2026-10-01): 같은 날 조건을 통과한 종목 수(시장 투매 강도)가 많을 때만 산다. 임계값 3·5 는 결과를 보기 전에
# 변형 목록에 적어 둔 값이고, 설계 2018~2022 / 검증 2023~2026-09 두 구간 모두 1.5틱에서 양수였다(감사 문서 참조).
BREADTH_MIN = [3, 5]
PARAMS = dict(rsiMax=30.0, gapMax=-2.0, gapFloor=-29.0, minPrevClose=1000, minPrevAmount=2e9,
              minHistory=60, haltLookback=20, noLimitLookback=10, picks=3, entry="open_auction", exit="close_auction",
              fixedCostPct=0.23, slipTicksPerSide=[0.0, 1.5, 3.0], primarySlipTicks=1.5)

TICK = [(2000, 1), (5000, 5), (20000, 10), (50000, 50), (200000, 100), (500000, 500), (float("inf"), 1000)]


def tick(p):
    for upper, t in TICK:
        if p < upper:
            return t
    return 1000


def cost_pct(price, ticks):
    return PARAMS["fixedCostPct"] + 2 * ticks * tick(price) / price * 100


def fetch(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if getattr(e, "code", None) == 404:
                return None
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"download failed: {url}")


def is_common(code, name):
    code = str(code)
    if len(code) != 6 or code[-1] != "0":      # 보통주는 단축코드 끝자리 0
        return False
    n = str(name)
    return not any(k in n for k in ("스팩", "리츠", "SPAC"))


NUM = ["Open", "High", "Low", "Close", "Changes", "Amount", "Volume"]


def load_rows():
    """({code: [(date, open, high, low, close, changes, amount, volume, name, market, dept)...]}, sources, final_last).

    marcap 연도 파일은 다음 날 기준가와 100% 맞는 확정 종가다(2026-09-29 확인). fdr_krx_data_cache 일별 파일은
    장중 스냅숏일 수 있다(2026-09-29 파일은 종가가 26%만 일치). 그래서 일별 파일로 채운 날은 '잠정'으로 두고
    다음 날 아침 명단(RSI) 계산에만 쓰며, 연구 기록(신호·대조군·판정)은 marcap 확정일(final_last)까지만 만든다."""
    import pandas as pd
    CACHE.mkdir(parents=True, exist_ok=True)
    frames, sources = [], []
    this_year = datetime.now(KST).year
    for y in range(FROM_YEAR, this_year + 1):
        p = CACHE / f"marcap-{y}.parquet"
        url = f"https://raw.githubusercontent.com/FinanceData/marcap/master/data/marcap-{y}.parquet"
        if not p.exists() or y == this_year:
            raw = fetch(url)
            if raw is None:
                continue
            p.write_bytes(raw)
        f = pd.read_parquet(p)
        f["Date"] = f["Date"].astype(str).str[:10]
        frames.append(f)
        sources.append(dict(url=url, rows=len(f), lastDate=f["Date"].max(), status="final"))
    base = pd.concat(frames, ignore_index=True)
    final_last = base["Date"].max()
    # 연도 파일이 아직 안 따라온 최근 영업일은 일별 스냅숏(잠정)으로 채운다
    d = date.fromisoformat(final_last) + timedelta(days=1)
    today = datetime.now(KST).date()
    extra = []
    while d <= today:
        if d.weekday() < 5:
            url = f"https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/master/data/listing/krx/{d}.csv"
            raw = fetch(url)
            if raw:
                g = pd.read_csv(io.StringIO(raw.decode("utf-8-sig")), dtype={"Code": str})
                for c in NUM:
                    g[c] = pd.to_numeric(g[c], errors="coerce")
                valid = g["Close"].notna() & g["Open"].notna() & (g["Close"] > 0)
                # 장 시작 전 파일은 가격이 '-' 로 비어 있다 — 그런 날은 통째로 버린다
                if valid.mean() >= 0.5:
                    g = g[valid].copy()
                    g["Date"] = str(d)
                    extra.append(g)
                    sources.append(dict(url=url, rows=int(valid.sum()), lastDate=str(d), status="provisional"))
        d += timedelta(days=1)
    if extra:
        base = pd.concat([base] + extra, ignore_index=True)
    base = base[base["Market"].isin(["KOSPI", "KOSDAQ", "KOSDAQ GLOBAL"])]
    base["Code"] = base["Code"].astype(str).str.zfill(6)
    for c in NUM:
        base[c] = pd.to_numeric(base[c], errors="coerce")
    base = base.dropna(subset=["Close", "Changes"])
    base = base.fillna({"Open": 0, "High": 0, "Low": 0, "Amount": 0, "Volume": 0})
    by = {}
    for r in base[["Date", "Code", "Name", "Market", "Open", "High", "Low", "Close", "Changes", "Amount", "Volume", "Dept"]].itertuples(index=False):
        by.setdefault(r.Code, []).append((r.Date, float(r.Open), float(r.High), float(r.Low), float(r.Close),
                                          float(r.Changes), float(r.Amount), float(r.Volume), r.Name, r.Market,
                                          "" if pd.isna(r.Dept) else str(r.Dept)))
    for v in by.values():
        v.sort(key=lambda x: x[0])
    return by, sources, final_last


def wilder_rsi(closes, n=14):
    out = [None] * len(closes)
    au = ad = 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        u, dn = max(d, 0.0), max(-d, 0.0)
        if i <= n:
            au += u / n
            ad += dn / n
            if i == n:
                out[i] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
        else:
            au = (au * (n - 1) + u) / n
            ad = (ad * (n - 1) + dn) / n
            out[i] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
    return out


def risky_dept(dept):
    return any(k in dept for k in ("관리종목", "투자주의환기", "정리매매"))


def pre_open_ok(rows, ret, rsi, i):
    """Everything known before session i opens (i == len(rows) means the next, not-yet-traded session)."""
    p = rows[i - 1]
    if i < PARAMS["minHistory"] or rsi[i - 1] is None or risky_dept(p[10]):
        return False
    if any(rows[j][7] <= 0 for j in range(max(0, i - PARAMS["haltLookback"]), i)):
        return False
    if any(abs(ret[j]) > 0.305 for j in range(max(1, i - PARAMS["noLimitLookback"]), i)):
        return False
    return p[7] > 0 and p[4] >= PARAMS["minPrevClose"] and p[6] >= PARAMS["minPrevAmount"]


def build_days(by):
    """(days, watch, pre): days = date -> gap-down candidates; watch = next-session RSI<30 list;
    pre = date -> number of pre-open RSI<30 names (the live watchlist size that day)."""
    days, watch, pre = {}, [], {}
    last_date = max(r[-1][0] for r in by.values())
    for code, rows in by.items():
        name = rows[-1][8]
        if not is_common(code, name):
            continue
        adj, ret = [rows[0][4]], [0.0]
        for i in range(1, len(rows)):
            c, chg = rows[i][4], rows[i][5]
            base_px = c - chg
            r = chg / base_px if base_px > 0 else 0.0
            ret.append(r)
            adj.append(adj[-1] * (1 + r) if adj[-1] > 0 else c)
        rsi = wilder_rsi(adj)
        for i in range(1, len(rows)):
            dt, o, h, l, c, chg, amt, vol, nm, mk, _ = rows[i]
            p = rows[i - 1]
            if not pre_open_ok(rows, ret, rsi, i):
                continue
            if rsi[i - 1] < PARAMS["rsiMax"]:
                pre.setdefault(dt, []).append((code, rsi[i - 1]))
            prev_adj = c - chg
            if o <= 0 or vol <= 0 or prev_adj <= 0:
                continue
            gap = (o / prev_adj - 1) * 100
            if gap > PARAMS["gapMax"] or gap <= PARAMS["gapFloor"]:
                continue
            days.setdefault(dt, []).append(dict(
                date=dt, code=code, name=nm, market=mk, open=o, high=h, low=l, close=c,
                prevCloseAdj=prev_adj, gapPct=gap, rsiPrev=rsi[i - 1], prevAmountKrw=p[6], prevVolume=p[7],
                gross=(c / o - 1) * 100))
        n = len(rows)
        if rows[-1][0] == last_date and pre_open_ok(rows, ret, rsi, n) and rsi[n - 1] < PARAMS["rsiMax"]:
            p = rows[-1]
            watch.append(dict(code=code, name=p[8], market=p[9], prevClose=p[4], rsi14=round(rsi[n - 1], 3),
                              prevAmountKrw=p[6], prevVolume=p[7]))
    watch.sort(key=lambda x: x["rsi14"])
    return days, watch, pre


def record(x, variant, action="signal"):
    costs = {f"{k}t": cost_pct(x["open"], k) for k in PARAMS["slipTicksPerSide"]}
    prim = cost_pct(x["open"], PARAMS["primarySlipTicks"])
    mfe = (x["high"] / x["open"] - 1) * 100
    mae = (x["low"] / x["open"] - 1) * 100
    return {
        "signalId": hashlib.sha1(f"{x['date']}|{STRATEGY_VERSION}|{variant}|{x['code']}|0900".encode()).hexdigest()[:16],
        "date": x["date"], "signalTime": "09:00", "tz": "Asia/Seoul",
        "market": x["market"], "code": x["code"], "name": x["name"],
        "strategy": "opening", "variant": variant, "strategyVersion": STRATEGY_VERSION, "signalSchemaVersion": SCHEMA,
        "action": action, "rejectedBy": None,
        "signalPrice": x["open"], "entryPrice": x["open"], "prevClose": x["prevCloseAdj"],
        "gapPct": x["gapPct"], "chgPct": x["gapPct"],
        "volume": None, "cumVolume": None, "volRatio": None,
        "amount": None, "cumAmount": None, "amountRatio": None,
        "indicators": {"rsi14Prev": x["rsiPrev"], "prevAmountKrw": x["prevAmountKrw"], "prevVolume": x["prevVolume"]},
        "params": PARAMS,
        "decisionReason": "rsi14_prev<30+gap<=-2%+liquidity" if variant == "baseline" else "control_random_gapdown_same_day",
        "source": "research-daily-bars", "feed": "FinanceData marcap / fdr_krx_data_cache (KRX daily)",
        "fwd5mPct": None, "fwd10mPct": None, "fwd20mPct": None, "fwd30mPct": None,
        "mfePct": mfe, "maePct": mae, "mfeTime": None, "maeTime": None,
        "hitPlus1": mfe >= 1, "hitPlus2": mfe >= 2, "hitMinus1": mae <= -1, "hitMinus2": mae <= -2,
        "hitPlus1Time": None, "hitPlus2Time": None, "hitMinus1Time": None, "hitMinus2Time": None,
        "exitModel": "close_auction", "exitTime": "15:30", "exitPrice": x["close"], "reason": "close",
        "grossPnl": x["gross"], "frictionPct": prim, "friction": costs, "pnl": x["gross"] - prim,
        "pnlByTicks": {k: x["gross"] - v for k, v in costs.items()},
    }


def stats(recs, key=None):
    if not recs:
        return dict(trades=0, days=0)
    by = {}
    for r in recs:
        v = r["pnl"] if key is None else r["pnlByTicks"][key]
        by.setdefault(r["date"], []).append(v)
    allv = [v for a in by.values() for v in a]
    dv = [statistics.fmean(a) for a in by.values()]
    t = (statistics.fmean(dv) / (statistics.stdev(dv) / math.sqrt(len(dv)))) if len(dv) > 2 and statistics.stdev(dv) > 0 else None
    wins = [v for v in allv if v > 0]
    losses = [v for v in allv if v <= 0]
    return dict(trades=len(allv), days=len(dv), winRate=len(wins) / len(allv) * 100,
                avgPnl=statistics.fmean(allv), avgWin=statistics.fmean(wins) if wins else 0.0,
                avgLoss=statistics.fmean(losses) if losses else 0.0, dayAvgPnl=statistics.fmean(dv), tStatDays=t,
                avgGross=statistics.fmean(r["grossPnl"] for r in recs))


def day_means(recs, key):
    by = {}
    for r in recs:
        by.setdefault(r["date"], []).append(r["pnlByTicks"][key])
    return {d: statistics.fmean(v) for d, v in by.items()}


def section(sig, ctl):
    out = {"strategy": {}, "control": {}, "skillPctPoints": {}, "skillPairedDays": {}}
    for k in [f"{t}t" for t in PARAMS["slipTicksPerSide"]]:
        s, c = stats(sig, k), stats(ctl, k)
        out["strategy"][k], out["control"][k] = s, c
        if s.get("trades") and c.get("trades"):
            out["skillPctPoints"][k] = s["dayAvgPnl"] - c["dayAvgPnl"]
            # 같은 날끼리 짝지은 차이 — 시장 전체 움직임을 뺀 선별 실력
            sd, cd = day_means(sig, k), day_means(ctl, k)
            diff = [sd[d] - cd[d] for d in sd if d in cd]
            t = (statistics.fmean(diff) / (statistics.stdev(diff) / math.sqrt(len(diff)))) if len(diff) > 2 and statistics.stdev(diff) > 0 else None
            out["skillPairedDays"][k] = dict(days=len(diff), mean=statistics.fmean(diff) if diff else None, tStat=t)
    return out


def live_trades(by, final_last):
    """VTS 모의체결 원본(Worker ledger 사본)과 그날 실제 시가·종가를 잇는다. 원본 파일은 읽기만 한다."""
    if not LIVE.exists():
        return []
    bar = {}
    for code, rows in by.items():
        for r in rows:
            if r[0] <= final_last:          # 잠정 스냅숏 값으로 실측을 매기지 않는다
                bar[(code, r[0])] = r
    out = []
    for f in sorted(LIVE.glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        led = j.get("ledger") or {}
        d = led.get("date") or f.stem
        ev = {e.get("stage"): e.get("payload") or {} for e in led.get("events", []) if e}
        pre, rec, clo = ev.get("preopen", {}), ev.get("reconcile", {}), ev.get("close", {})
        pos = {p.get("code"): p for p in (rec.get("positions") or clo.get("positions") or [])}
        orders = {o.get("code"): o for o in pre.get("orders") or [] if o.get("side") == "buy"}
        sells = {o.get("code"): o for o in clo.get("orders") or [] if o.get("side") == "sell"}
        for p in pre.get("picks") or []:
            code = p.get("code")
            b = bar.get((code, d))
            o = c = gap = None
            if b:
                o, c = b[1], b[4]
                gap = (o / (b[4] - b[5]) - 1) * 100 if b[4] - b[5] > 0 else None
            ps = pos.get(code) or {}
            bf = (ps.get("buy") or {}).get("avgPrice")
            sf = (ps.get("sell") or {}).get("avgPrice")
            exp = p.get("expectedPrice")
            pct = lambda a, z: (a / z - 1) * 100 if a and z else None  # noqa: E731
            gross = pct(sf, bf)
            model = pct(c, o)
            out.append(dict(
                date=d, code=code, name=p.get("name"), strategyVersion=STRATEGY_VERSION, source="kis-vts-live",
                expectedPrice=exp, expectedGapPct=p.get("expectedGapPct"), actualOpen=o, actualClose=c, actualGapPct=gap,
                actualGapQualifies=(gap is not None and PARAMS["gapFloor"] < gap <= PARAMS["gapMax"]),
                openVsExpectedPct=pct(o, exp),
                buyOrderOk=bool(((orders.get(code) or {}).get("vts") or {}).get("ok")),
                buyOrderMsg=((orders.get(code) or {}).get("vts") or {}).get("msg"),
                sellOrderOk=bool(((sells.get(code) or {}).get("vts") or {}).get("ok")),
                sellOrderMsg=((sells.get(code) or {}).get("vts") or {}).get("msg"),
                buyQty=(ps.get("buy") or {}).get("qty"), buyFill=bf, sellQty=(ps.get("sell") or {}).get("qty"), sellFill=sf,
                buySlipPct=pct(bf, o), sellSlipPct=(-pct(sf, c) if sf and c else None),
                realizedGrossPct=gross, realizedNetPct=(gross - PARAMS["fixedCostPct"]) if gross is not None else None,
                modelNet0tPct=(model - PARAMS["fixedCostPct"]) if model is not None else None))
    return out


def live_summary(rows):
    def m(k):
        v = [r[k] for r in rows if r.get(k) is not None]
        return dict(n=len(v), mean=statistics.fmean(v) if v else None)
    return dict(trades=len(rows), days=len({r["date"] for r in rows}),
                actualGapQualifiesRate=(sum(1 for r in rows if r["actualGapQualifies"]) / len(rows) * 100) if rows else None,
                openVsExpectedPct=m("openVsExpectedPct"), buySlipPct=m("buySlipPct"), sellSlipPct=m("sellSlipPct"),
                realizedNetPct=m("realizedNetPct"), modelNet0tPct=m("modelNet0tPct"),
                note="buySlip = 매수체결가/시가-1, sellSlip = 1-매도체결가/종가 (양수 = 비용). 판정은 realizedNet 누적으로 한다.")


def main():
    by, sources, final_last = load_rows()
    days, watch, pre = build_days(by)
    watch_based = max(r[-1][0] for r in by.values())
    all_dates = sorted({r[0] for rows in by.values() for r in rows if r[0] <= final_last})
    sig, ctl, decisions = [], [], []
    for d in all_dates:
        cands = days.get(d, [])
        picks = sorted([x for x in cands if x["rsiPrev"] < PARAMS["rsiMax"]], key=lambda x: x["gapPct"])[: PARAMS["picks"]]
        rng = random.Random(int(hashlib.sha1(d.encode()).hexdigest()[:8], 16))
        cpick = rng.sample(cands, min(PARAMS["picks"], len(cands))) if cands else []
        sig += [record(x, "baseline") for x in picks]
        ctl += [record(x, "CONTROL_random_gapdown", action="control") for x in cpick]
        decisions.append(dict(date=d, strategyVersion=STRATEGY_VERSION, gapDownCandidates=len(cands),
                              rsiPassed=sum(1 for x in cands if x["rsiPrev"] < PARAMS["rsiMax"]),
                              signals=len(picks), action="signal" if picks else "no_signal",
                              decisionReason="" if picks else ("no_gapdown_candidates" if not cands else "no_candidate_with_rsi14_prev<30")))
    design = [r for r in sig if r["date"] <= DESIGN_END]
    oos = [r for r in sig if r["date"] > DESIGN_END]
    report = {
        "schema": SCHEMA, "generatedAt": datetime.now(KST).isoformat(), "strategyVersion": STRATEGY_VERSION,
        "rule": PARAMS, "from": all_dates[0] if all_dates else None, "to": all_dates[-1] if all_dates else None,
        "sources": sources, "designEnd": DESIGN_END,
        "verdictRule": "Only out-of-sample days (> designEnd) count toward adoption. Needs >= 20 signal days and skill > 0 at 1.5 ticks.",
        "designSample": section(design, [r for r in ctl if r["date"] <= DESIGN_END]),
        "outOfSample": section(oos, [r for r in ctl if r["date"] > DESIGN_END]),
        "byYear": {y: stats([r for r in sig if r["date"][:4] == y]) for y in sorted({r["date"][:4] for r in sig})},
        "latestSignals": sig[-15:],
    }
    qualified = {x["date"]: x["rsiPassed"] for x in decisions}
    report["breadthFilter"] = {
        "note": "v2 후보: 그날 RSI<30·갭하락 조건 통과 종목 수 >= K 인 날만 매매. 판정은 designEnd 이후 표본만.",
        "variants": {f"min{k}": {
            "designSample": section([r for r in design if qualified.get(r["date"], 0) >= k],
                                    [r for r in ctl if r["date"] <= DESIGN_END and qualified.get(r["date"], 0) >= k]),
            "outOfSample": section([r for r in oos if qualified.get(r["date"], 0) >= k],
                                   [r for r in ctl if r["date"] > DESIGN_END and qualified.get(r["date"], 0) >= k]),
            "byYear": {y: stats([r for r in sig if r["date"][:4] == y and qualified.get(r["date"], 0) >= k])
                       for y in sorted({r["date"][:4] for r in sig})},
        } for k in BREADTH_MIN}}
    live = live_trades(by, final_last)
    report["live"] = live_summary(live)
    report["liveTrades"] = live[-30:]
    based_status = "final" if watch_based <= final_last else "provisional_snapshot"
    watchlist = dict(strategyVersion=STRATEGY_VERSION, schema=SCHEMA, generatedAt=report["generatedAt"], basedOn=watch_based,
                     basedOnStatus=based_status,
                     note="다음 거래일 09:00 전 예상체결가로 갭을 보는 명단. RSI(14)<30 · 유동성 · 관리종목 대용 필터 통과 종목.",
                     rule=dict(rsiMax=PARAMS["rsiMax"], gapMax=PARAMS["gapMax"], gapFloor=PARAMS["gapFloor"], picks=PARAMS["picks"]),
                     names=watch)
    report["watchlist"] = dict(basedOn=watch_based, basedOnStatus=based_status, size=len(watch))
    report["finalDataThrough"] = final_last
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "watchlist.json").write_text(json.dumps(watchlist, ensure_ascii=False, indent=2), encoding="utf-8")
    if live:
        with (OUT / "live-trades.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(live[0].keys()))
            w.writeheader()
            w.writerows(live)
    cols = ["signalId", "date", "code", "name", "market", "variant", "strategyVersion", "gapPct", "entryPrice", "exitPrice",
            "grossPnl", "frictionPct", "pnl", "mfePct", "maePct", "hitPlus1", "hitPlus2", "hitMinus1", "hitMinus2"]
    for fname, rows in (("signals.csv", sig), ("control.csv", ctl)):
        with (OUT / fname).open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols + ["rsi14Prev"])
            w.writeheader()
            for r in rows:
                w.writerow({**{k: r.get(k) for k in cols}, "rsi14Prev": r["indicators"]["rsi14Prev"]})
    with (OUT / "decisions.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(decisions[0].keys()))
        w.writeheader()
        w.writerows(decisions)
    # 표본 밖(판정용) 날짜는 날짜별 원본을 한 번만 쓰고 이후 덮어쓰지 않는다
    daily = OUT / "daily"
    daily.mkdir(exist_ok=True)
    for d in sorted({r["date"] for r in oos} | {x["date"] for x in decisions if x["date"] > DESIGN_END}):
        p = daily / f"{d}.json"
        if not p.exists():
            p.write_text(json.dumps(dict(date=d, recordedAt=datetime.now(KST).isoformat(),
                                         decision=next((x for x in decisions if x["date"] == d), None),
                                         signals=[r for r in oos if r["date"] == d],
                                         control=[r for r in ctl if r["date"] == d]), ensure_ascii=False, indent=2),
                         encoding="utf-8")
    print(json.dumps({"from": report["from"], "to": report["to"], "signals": len(sig),
                      "design": report["designSample"], "oos": report["outOfSample"]["strategy"].get("1.5t"),
                      "watchlist": report["watchlist"], "live": report["live"]},
                     ensure_ascii=False, indent=1)[:3000])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
