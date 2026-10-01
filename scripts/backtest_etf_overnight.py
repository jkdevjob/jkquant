#!/usr/bin/env python3
"""Research + live join for ② etf_dip_overnight_v1 and the ①+② daily portfolio (goal metrics).

Rule (fixed 2026-10-01, see AUDIT-SELF-REVIEW.md):
- KODEX 코스닥150레버리지 (233740). If today's close is <= -3% vs the previous close, buy at the
  closing auction and sell at the next session's opening auction. ETF: no securities transaction tax.
- Cost: commission 0.015% x 2 + one tick per side (KRX ETF tick: 5 KRW >= 2,000, else 1 KRW).

Goal metrics (user's evaluation order, 2026-10-01): days/yr with net >= +1%, weeks/yr with >= +5%,
weekly average, loss-day average and worst day, MDD. Days without a signal are 0%, not losses.
Portfolio ①+② is on ONE capital base: if both trade the same day, each gets half (no double counting).
A strategy only qualifies if expectancy > 0, MDD >= -25% and worst day >= -15%.
Research only; the live VTS path is functions/api/opening-gapdown.js.
"""
from __future__ import annotations

import csv
import json
import math
import os
import statistics
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
OUT = Path(os.environ.get("JKQ_ETF_OUT", "data/etf-overnight-research"))
D1 = Path(os.environ.get("JKQ_GAPDOWN_OUT", "data/opening-gapdown-research"))
LIVE = Path(os.environ.get("JKQ_GAPDOWN_LIVE", "data/opening-gapdown-live"))
DESIGN_END = "2026-09-30"
VERSION = "etf_dip_overnight_v1"
RULE = dict(code="233740", name="KODEX 코스닥150레버리지", dropMaxPct=-3.0, entry="close_auction", exit="next_open_auction",
            commissionPct=0.015, ticksPerSide=1)
D1_BREADTH_MIN = 5
GATE = dict(mdd=-25.0, worstDay=-15.0)


def tick(p):
    return 5 if p >= 2000 else 1


def cost_pct(p):
    return 2 * RULE["commissionPct"] + 2 * RULE["ticksPerSide"] * tick(p) / p * 100


def load_bars():
    import FinanceDataReader as fdr
    today = datetime.now(KST).strftime("%Y-%m-%d")
    now_hm = int(datetime.now(KST).strftime("%H%M"))
    d = fdr.DataReader(RULE["code"], "2016-01-01")
    rows = []
    for idx, r in d.iterrows():
        ds = str(idx)[:10]
        if ds == today and now_hm < 1600:
            continue                      # 장중 값은 쓰지 않는다
        if float(r["Open"]) > 0 and float(r["Close"]) > 0:
            rows.append((ds, float(r["Open"]), float(r["Close"])))
    return rows


def signals(rows):
    out = []
    for i in range(1, len(rows) - 1):
        prev, cur, nxt = rows[i - 1], rows[i], rows[i + 1]
        chg = (cur[2] / prev[2] - 1) * 100
        if abs(chg) > 35 or chg > RULE["dropMaxPct"]:
            continue
        gross = (nxt[1] / cur[2] - 1) * 100
        c = cost_pct(cur[2])
        out.append(dict(signalDate=cur[0], exitDate=nxt[0], strategyVersion=VERSION, code=RULE["code"], dayChangePct=chg,
                        entryPrice=cur[2], exitPrice=nxt[1], grossPnl=gross, frictionPct=c, pnl=gross - c,
                        sample="design" if cur[0] <= DESIGN_END else "outOfSample"))
    return out


def goal_metrics(daily, calendar):
    """daily: {date: net %} realised that day; calendar: every trading day (no-trade days count as 0%)."""
    cal = sorted(set(calendar))
    if not cal:
        return {}
    yrs = len(cal) / 250
    traded = [d for d in cal if d in daily]
    r = [daily.get(d, 0.0) for d in cal]
    eq = pk = 1.0
    mdd = 0.0
    wk = {}
    for d, x in zip(cal, r):
        eq *= 1 + x / 100
        pk = max(pk, eq)
        mdd = min(mdd, eq / pk - 1)
        k = date.fromisoformat(d).isocalendar()[:2]
        wk[k] = wk.get(k, 1.0) * (1 + x / 100)
    vals = [daily[d] for d in traded]
    loss = [v for v in vals if v < 0]
    out = dict(
        tradingDays=len(cal), tradeDays=len(traded), tradeDaysPerYear=len(traded) / yrs,
        plus1DaysPerYear=sum(1 for v in vals if v >= 1) / yrs,
        plus1RateOfTradeDays=(sum(1 for v in vals if v >= 1) / len(vals) * 100) if vals else None,
        plus5WeeksPerYear=sum(1 for v in wk.values() if v >= 1.05) / yrs,
        weeklyAvgPct=(eq ** (1 / len(wk)) - 1) * 100 if wk else None,
        lossDaysPerYear=len(loss) / yrs, lossDayAvgPct=statistics.fmean(loss) if loss else 0.0,
        worstDayPct=min(vals) if vals else 0.0, cagrPct=(eq ** (1 / yrs) - 1) * 100, mddPct=mdd * 100,
        expectancyPct=statistics.fmean(vals) if vals else None,
        tStat=(statistics.fmean(vals) / (statistics.stdev(vals) / math.sqrt(len(vals)))) if len(vals) > 2 and statistics.stdev(vals) > 0 else None,
    )
    out["gate"] = bool(vals) and out["expectancyPct"] > 0 and out["mddPct"] >= GATE["mdd"] and out["worstDayPct"] >= GATE["worstDay"]
    return out


def d1_v2_daily():
    """① D-1 v2 day P&L (1.5 ticks) from the gap-down research outputs."""
    q, by = {}, {}
    try:
        with (D1 / "decisions.csv").open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                q[r["date"]] = int(r.get("rsiPassed") or 0)
        with (D1 / "signals.csv").open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                by.setdefault(r["date"], []).append(float(r["pnl"]))
    except FileNotFoundError:
        return {}
    return {d: statistics.fmean(v) for d, v in by.items() if q.get(d, 0) >= D1_BREADTH_MIN}


def combine(a, b):
    """One capital base: a day with both strategies gives each half."""
    out = {}
    for d in set(a) | set(b):
        if d in a and d in b:
            out[d] = (a[d] + b[d]) / 2
        else:
            out[d] = a.get(d, b.get(d))
    return out


def live_trades(bars):
    """Pair etf_buy (day d) with the next session's etf_sell, using VTS fills from etf_reconcile."""
    if not LIVE.exists():
        return []
    led = {}
    for f in sorted(LIVE.glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        lg = j.get("ledger") or {}
        led[lg.get("date") or f.stem] = {e.get("stage"): e.get("payload") or {} for e in lg.get("events", []) if e}
    px = {d: (o, c) for d, o, c in bars}
    days = sorted(px)
    out = []
    for d in sorted(led):
        buy = led[d].get("etf_buy") or {}
        if not buy.get("signal"):
            continue
        nxt = next((x for x in sorted(led) if x > d and (led[x].get("etf_sell") or {}).get("buyDate") == d), None)
        fb = ((led[d].get("etf_reconcile") or {}).get("fills") or {}).get("closeBuy") or {}
        fs = (((led.get(nxt) or {}).get("etf_reconcile") or {}).get("fills") or {}).get("openSell") or {}
        close = px.get(d, (None, None))[1]
        nd = next((x for x in days if x > d), None)
        nopen = px.get(nd, (None, None))[0] if nd else None
        pct = lambda a, z: (a / z - 1) * 100 if a and z else None  # noqa: E731
        bf, sf = fb.get("avgPrice"), fs.get("avgPrice")
        out.append(dict(signalDate=d, exitDate=nxt, strategyVersion=VERSION, source="kis-vts-live",
                        expectedDropPct=buy.get("dropPct"), buyOrderOk=bool((buy.get("order") or {}).get("vts", {}).get("ok")),
                        buyQty=fb.get("qty"), buyFill=bf, actualClose=close, buySlipPct=pct(bf, close),
                        sellQty=fs.get("qty"), sellFill=sf, actualNextOpen=nopen, sellSlipPct=(-pct(sf, nopen) if sf and nopen else None),
                        realizedNetPct=(pct(sf, bf) - 2 * RULE["commissionPct"]) if bf and sf else None,
                        modelNetPct=(pct(nopen, close) - cost_pct(close)) if nopen and close else None))
    return out


def main():
    bars = load_bars()
    sig = signals(bars)
    cal = [d for d, _, _ in bars if d >= "2018-04-01"]
    etf_daily = {s["exitDate"]: s["pnl"] for s in sig}          # 다음날 시가에 실현 → 그날 손익
    d1 = d1_v2_daily()
    port = combine(d1, etf_daily)
    split = lambda dv, f: {d: v for d, v in dv.items() if f(d)}  # noqa: E731
    design_cal = [d for d in cal if d <= DESIGN_END]
    oos_cal = [d for d in cal if d > DESIGN_END]
    report = {
        "schema": 1, "generatedAt": datetime.now(KST).isoformat(), "strategyVersion": VERSION, "rule": RULE,
        "designEnd": DESIGN_END, "gate": GATE, "from": cal[0] if cal else None, "to": cal[-1] if cal else None,
        "evaluationOrder": ["plus1DaysPerYear", "plus5WeeksPerYear", "weeklyAvgPct", "lossDayAvgPct/worstDayPct", "mddPct"],
        "note": "수익률은 수수료·슬리피지 포함 순수익. 매매 없는 날은 0%. ①+② 는 같은 원금 — 같은 날 둘 다면 반씩.",
        "etf": {"design": goal_metrics(split(etf_daily, lambda d: d <= DESIGN_END), design_cal),
                "outOfSample": goal_metrics(split(etf_daily, lambda d: d > DESIGN_END), oos_cal)},
        "d1v2": {"design": goal_metrics(split(d1, lambda d: d <= DESIGN_END), design_cal),
                 "outOfSample": goal_metrics(split(d1, lambda d: d > DESIGN_END), oos_cal)},
        "portfolio": {"design": goal_metrics(split(port, lambda d: d <= DESIGN_END), design_cal),
                      "outOfSample": goal_metrics(split(port, lambda d: d > DESIGN_END), oos_cal)},
        "latestSignals": sig[-10:],
    }
    live = live_trades(bars)
    report["live"] = dict(trades=len(live), rows=live[-20:])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    with (OUT / "signals.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(sig[0].keys()))
        w.writeheader()
        w.writerows(sig)
    if live:
        with (OUT / "live-trades.csv").open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(live[0].keys()))
            w.writeheader()
            w.writerows(live)
    print(json.dumps({k: report[k]["design"] for k in ("etf", "d1v2", "portfolio")}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
