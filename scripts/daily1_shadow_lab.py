#!/usr/bin/env python3
"""Daily +1% shadow-strategy lab for the four JKQuant scalping tabs.

Purpose
-------
Add one materially different research/paper candidate to each active tab without
changing the live baseline or placing any broker order.

Candidates (frozen 2026-10-01, prospective paper starts 2026-10-01):
- opening: opening_gapdown_reclaim_v1
- daytrading: day_rs_vwap_reclaim_v1
- crypto: btc_flush_reclaim_v1
- soxl: soxl_power_hour_v1

All signals are formed on COMPLETED bars and filled at the NEXT bar open.
Same-bar stop/target conflicts resolve to stop. Costs are subtracted.
Rules never auto-promote; daily data is accumulated and review status is only
reported after enough prospective observations.

Outputs:
  data/daily1-shadow/latest.json
  data/daily1-shadow/<strategy>-trades.csv
  data/daily1-shadow/<strategy>-decisions.csv
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import statistics
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
NY = ZoneInfo("America/New_York")
DATA = Path("data")
OUT = DATA / "daily1-shadow"
DESIGN_END = "2026-09-30"
PAPER_START = "2026-10-01"

KR_FIXED_COST = 0.23
KR_TICKS_PER_SIDE = 2.5
CRYPTO_FRICTION = 0.14
SOXL_FRICTION = 0.20

META = {
    "opening": {
        "version": "opening_gapdown_reclaim_v1",
        "name": "갭하락 플러시 → VWAP·시초가 재탈환",
        "rule": "시가 -2~-8% 갭하락 → 첫 5분 추가 하락≥1% → 09:05~09:35 VWAP와 시초가 재탈환 + 거래량 1.2배 → 다음 1분봉 시가 진입 · -0.8%/+1.8% · 10:00 청산",
        "slots": 2,
    },
    "daytrading": {
        "version": "day_rs_vwap_reclaim_v1",
        "name": "시장 상대강도 + VWAP 재탈환",
        "rule": "10:05~14:30 시장대비 상대강도≥1%p · 당일 +0.5~+6% · VWAP 아래→위 재탈환 · 거래량 1.2배 · 직전3분 고점 회복 → 다음 1분봉 시가 · -0.8%/+1.6% · 최대60분/15:10",
        "slots": 3,
    },
    "crypto": {
        "version": "btc_flush_reclaim_v1",
        "name": "BTC 60분 급락 플러시 반등",
        "rule": "최근 60분 고점 대비 -1.5% 이상 플러시 후 5분봉이 직전봉 고가를 회복 + 거래량 1.5배 → 다음 5분봉 시가 · -0.7%/+1.4% · 최대90분 · 22:00 진입까지",
        "slots": 1,
    },
    "soxl": {
        "version": "soxl_power_hour_v1",
        "name": "SOXL 파워아워 추세 지속",
        "rule": "첫30분 +1% 이상 · 14:30~15:00 +0.5% 이상 · 15:00~15:20 VWAP 위 + 직전3봉 고점 돌파 + 거래량 1.1배 → 다음 5분봉 시가 · -1%/+2% · 15:55 청산",
        "slots": 1,
    },
}


def hm(s):
    s = str(s or "")
    if len(s) >= 6 and s[-6:].isdigit():
        return int(s[-6:-2])
    if len(s) >= 16 and s[11:13].isdigit():
        return int(s[11:13]) * 100 + int(s[14:16])
    return -1


def minute_of_day(s):
    h = hm(s)
    return (h // 100) * 60 + h % 100 if h >= 0 else -1


def kr_tick(px):
    p = float(px or 0)
    if p < 2000: return 1.0
    if p < 5000: return 5.0
    if p < 20000: return 10.0
    if p < 50000: return 50.0
    if p < 200000: return 100.0
    if p < 500000: return 500.0
    return 1000.0


def kr_cost(px):
    return KR_FIXED_COST + 2 * KR_TICKS_PER_SIDE * kr_tick(px) / max(float(px), 1e-9) * 100


def bars_of(row, start=900, end=1600):
    a = []
    for b in row.get("bars") or []:
        close = float(b.get("c") or b.get("close") or 0)
        if close <= 0:
            continue
        hmi = hm(b.get("t") or b.get("tKst") or b.get("tEt"))
        if not (start <= hmi <= end):
            continue
        a.append({
            "hm": hmi,
            "o": float(b.get("o") or close),
            "h": float(b.get("h") or close),
            "l": float(b.get("l") or close),
            "c": close,
            "v": float(b.get("v") or b.get("vol") or 0),
        })
    a.sort(key=lambda x: x["hm"])
    return a


def sim_exit(a, entry_i, entry, stop_pct, tp_pct, final_hm, max_bars, friction):
    stop = entry * (1 - stop_pct / 100)
    target = entry * (1 + tp_pct / 100)
    last_i = min(len(a) - 1, entry_i + max_bars - 1) if max_bars else len(a) - 1
    exit_px = exit_i = None
    reason = None
    for i in range(entry_i, last_i + 1):
        z = a[i]
        if z["hm"] > final_hm:
            break
        hit_s = z["l"] <= stop
        hit_t = z["h"] >= target
        if hit_s:
            exit_px, exit_i, reason = stop, i, "stop_same_bar" if hit_t else "stop"
            break
        if hit_t:
            exit_px, exit_i, reason = target, i, "take_profit"
            break
    if exit_px is None:
        eligible = [(i, z) for i, z in enumerate(a[entry_i:], start=entry_i)
                    if i <= last_i and z["hm"] <= final_hm]
        if not eligible:
            return None
        exit_i, z = eligible[-1]
        exit_px, reason = z["c"], "time_exit"
    gross = (exit_px / entry - 1) * 100
    return {
        "exitTime": a[exit_i]["hm"],
        "exitPrice": exit_px,
        "grossPnlPct": gross,
        "frictionPct": friction,
        "pnlPct": gross - friction,
        "reason": reason,
    }


def estimate_prev_close(row):
    p = float(row.get("prevClose") or 0)
    if p > 0:
        return p
    close = float(row.get("close") or 0)
    chg = float(row.get("chg") or 0)
    den = 1 + chg / 100
    return close / den if close > 0 and abs(den) > 1e-9 else 0.0


def load_opening_days():
    out = []
    for p in sorted((DATA / "scalping").glob("*/*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            if j.get("date") and j.get("universe"):
                out.append(j)
        except Exception as e:
            print("opening skip", p, e)
    return out


def opening_candidate(day, row):
    if int(row.get("rank") or 999999) > 100:
        return None
    a = bars_of(row, 900, 1000)
    if len(a) < 15:
        return None
    prev = estimate_prev_close(row)
    op = float(row.get("open") or 0) or a[0]["o"]
    if op <= 0 or prev <= 0:
        return None
    gap = (op / prev - 1) * 100
    if not (-8.0 <= gap <= -2.0):
        return None

    first5 = [z for z in a if z["hm"] <= 904][:5]
    if len(first5) < 3:
        return None
    first_low = min(z["l"] for z in first5)
    flush = (first_low / op - 1) * 100
    if flush > -1.0:
        return None

    pv = vv = 0.0
    vw = []
    for z in a:
        pv += z["c"] * z["v"]
        vv += z["v"]
        vw.append(pv / max(vv, 1.0))

    for i in range(5, len(a) - 1):
        z = a[i]
        if z["hm"] < 905:
            continue
        if z["hm"] > 935:
            break
        hist = a[max(0, i - 10):i]
        vols = [x["v"] for x in hist if x["v"] > 0]
        vol_ratio = z["v"] / statistics.fmean(vols) if vols else 0.0
        had_below = any(a[k]["c"] <= vw[k] for k in range(max(0, i - 3), i))
        reclaim = z["c"] > vw[i] and z["c"] > op and had_below
        prior3 = max(x["c"] for x in a[max(0, i - 3):i]) if i else z["c"]
        if not reclaim or z["c"] <= prior3 or vol_ratio < 1.2:
            continue
        ent_i = i + 1
        entry = a[ent_i]["o"]
        ex = sim_exit(a, ent_i, entry, .8, 1.8, 1000, 60, kr_cost(entry))
        if not ex:
            continue
        return {
            "date": day["date"], "strategy": "opening", "strategyVersion": META["opening"]["version"],
            "code": row.get("code"), "name": row.get("name"), "rank": row.get("rank"),
            "signalTime": z["hm"], "entryTime": a[ent_i]["hm"], "entryPrice": entry,
            "gapPct": gap, "flushPct": flush, "signalVwap": vw[i], "volumeRatio": vol_ratio,
            "decisionReason": "gapdown+first5_flush+open_vwap_reclaim+prior3_break+volume",
            "sample": "design" if day["date"] <= DESIGN_END else "outOfSample", **ex,
        }
    return None


def opening_run():
    days = load_opening_days()
    trades, decisions = [], []
    for d in days:
        cand = [t for row in d.get("universe") or [] if (t := opening_candidate(d, row))]
        cand.sort(key=lambda x: (x["signalTime"], -x["volumeRatio"], str(x.get("code") or "")))
        chosen = cand[:META["opening"]["slots"]]
        trades.extend(chosen)
        decisions.append({
            "date": d["date"], "strategy": "opening", "strategyVersion": META["opening"]["version"],
            "action": "trade" if chosen else "no_trade", "trades": len(chosen),
            "decisionReason": "qualified_reclaims" if chosen else "no_gapdown_reclaim_signal",
        })
    return days, trades, decisions


def load_daytrading_days():
    out = []
    for p in sorted((DATA / "daytrading").glob("*/*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            sh = int(j.get("snapshotHm") or 0)
            if j.get("date") and j.get("universe") and 0 < sh <= 1015:
                out.append(j)
        except Exception as e:
            print("day skip", p, e)
    return out


def benchmark_ret(day, hmi):
    vals = []
    for row in day.get("benchmarks") or []:
        a = bars_of(row, 900, 1520)
        if not a:
            continue
        base = a[0]["c"]
        p = [x for x in a if x["hm"] <= hmi]
        if base > 0 and p:
            vals.append((p[-1]["c"] / base - 1) * 100)
    return statistics.fmean(vals) if vals else 0.0


def day_candidate(day, row):
    if int(row.get("rank") or 999999) > 100:
        return None
    a = bars_of(row, 900, 1520)
    if len(a) < 40:
        return None
    base = a[0]["c"]
    pv = vv = 0.0
    vw = []
    for z in a:
        pv += z["c"] * z["v"]
        vv += z["v"]
        vw.append(pv / max(vv, 1.0))

    start = max(1005, int(day.get("snapshotHm") or 1000) + 5)
    for i in range(20, len(a) - 1):
        z = a[i]
        if z["hm"] < start:
            continue
        if z["hm"] > 1430:
            break
        sess = (z["c"] / base - 1) * 100
        if not (.5 <= sess <= 6.0):
            continue
        market = benchmark_ret(day, z["hm"])
        rs = sess - market
        if rs < 1.0:
            continue
        prev = a[i - 1]
        crossed = prev["c"] <= vw[i - 1] and z["c"] > vw[i]
        prior3 = max(x["c"] for x in a[i - 3:i])
        vols = [x["v"] for x in a[i - 20:i] if x["v"] > 0]
        vr = z["v"] / statistics.fmean(vols) if vols else 0.0
        if not crossed or z["c"] <= prior3 or vr < 1.2:
            continue
        ent_i = i + 1
        entry = a[ent_i]["o"]
        ex = sim_exit(a, ent_i, entry, .8, 1.6, 1510, 60, .25)
        if not ex:
            continue
        return {
            "date": day["date"], "strategy": "daytrading", "strategyVersion": META["daytrading"]["version"],
            "code": row.get("code"), "name": row.get("name"), "rank": row.get("rank"),
            "signalTime": z["hm"], "entryTime": a[ent_i]["hm"], "entryPrice": entry,
            "sessionRetPct": sess, "marketRetPct": market, "relativeStrengthPctPoint": rs,
            "signalVwap": vw[i], "volumeRatio": vr,
            "decisionReason": "relative_strength+vwap_reclaim+prior3_break+volume",
            "sample": "design" if day["date"] <= DESIGN_END else "outOfSample", **ex,
        }
    return None


def daytrading_run():
    days = load_daytrading_days()
    trades, decisions = [], []
    for d in days:
        cand = [t for row in d.get("universe") or [] if (t := day_candidate(d, row))]
        cand.sort(key=lambda x: (x["signalTime"], -x["relativeStrengthPctPoint"], -x["volumeRatio"], str(x.get("code") or "")))
        chosen = cand[:META["daytrading"]["slots"]]
        trades.extend(chosen)
        decisions.append({
            "date": d["date"], "strategy": "daytrading", "strategyVersion": META["daytrading"]["version"],
            "action": "trade" if chosen else "no_trade", "trades": len(chosen),
            "decisionReason": "qualified_rs_reclaims" if chosen else "no_relative_strength_reclaim_signal",
        })
    return days, trades, decisions


def load_crypto_days():
    root = DATA / "crypto" / "KRW-BTC" / "5m"
    by = {}
    for p in sorted(root.glob("*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            for b in j.get("bars") or []:
                tk = str(b.get("tKst") or "")
                if len(tk) >= 16:
                    by.setdefault(tk[:10], {})[str(b.get("tUtc") or tk)] = b
        except Exception as e:
            print("crypto skip", p, e)
    out = []
    for d, rows in sorted(by.items()):
        a = sorted(rows.values(), key=lambda x: x.get("tUtc") or x.get("tKst") or "")
        if len(a) >= 288 and minute_of_day(a[0].get("tKst")) == 0 and minute_of_day(a[-1].get("tKst")) == 1435:
            out.append({"date": d, "bars": a})
    return out


def crypto_candidate(day):
    raw = day["bars"]
    a = [{
        "hm": hm(x.get("tKst")), "o": float(x.get("o") or 0), "h": float(x.get("h") or 0),
        "l": float(x.get("l") or 0), "c": float(x.get("c") or 0), "v": float(x.get("v") or 0)
    } for x in raw]
    for i in range(12, len(a) - 1):
        z = a[i]
        if minute_of_day(raw[i].get("tKst")) > 21 * 60 + 55:
            break
        prev12 = a[i - 12:i]
        peak = max(x["h"] for x in prev12)
        flush = (z["l"] / peak - 1) * 100 if peak > 0 else 0
        vr = z["v"] / statistics.fmean([x["v"] for x in prev12 if x["v"] > 0]) if any(x["v"] > 0 for x in prev12) else 0
        reclaim = z["c"] > a[i - 1]["h"] and z["c"] > statistics.fmean(x["c"] for x in a[i - 3:i])
        if flush > -1.5 or vr < 1.5 or not reclaim:
            continue
        ent_i = i + 1
        entry = a[ent_i]["o"]
        ex = sim_exit(a, ent_i, entry, .7, 1.4, 2355, 18, CRYPTO_FRICTION)
        if not ex:
            continue
        return {
            "date": day["date"], "strategy": "crypto", "strategyVersion": META["crypto"]["version"],
            "code": "KRW-BTC", "signalTime": z["hm"], "entryTime": a[ent_i]["hm"], "entryPrice": entry,
            "flush60mPct": flush, "volumeRatio": vr, "reclaimClose": z["c"],
            "decisionReason": "60m_flush+previous_high_reclaim+volume",
            "sample": "design" if day["date"] <= DESIGN_END else "outOfSample", **ex,
        }
    return None


def crypto_run():
    days = load_crypto_days()
    trades, decisions = [], []
    for d in days:
        t = crypto_candidate(d)
        if t: trades.append(t)
        decisions.append({
            "date": d["date"], "strategy": "crypto", "strategyVersion": META["crypto"]["version"],
            "action": "trade" if t else "no_trade", "trades": 1 if t else 0,
            "decisionReason": "qualified_flush_reclaim" if t else "no_60m_flush_reclaim_signal",
        })
    return days, trades, decisions


def load_soxl_days():
    root = DATA / "soxl" / "SOXL" / "5m"
    out = []
    for p in sorted(root.glob("*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            if j.get("sessionDateEt") and j.get("bars"):
                a = sorted(j["bars"], key=lambda x: x.get("tEt") or "")
                if len(a) >= 70 and hm(a[0].get("tEt")) == 930 and hm(a[-1].get("tEt")) >= 1555:
                    out.append(j)
        except Exception as e:
            print("soxl skip", p, e)
    return out


def soxl_candidate(day):
    a = [{
        "hm": hm(x.get("tEt")), "o": float(x.get("o") or 0), "h": float(x.get("h") or 0),
        "l": float(x.get("l") or 0), "c": float(x.get("c") or 0), "v": float(x.get("v") or 0)
    } for x in sorted(day["bars"], key=lambda x: x.get("tEt") or "")]
    if len(a) < 72:
        return None
    first6 = a[:6]
    first30 = (first6[-1]["c"] / first6[0]["o"] - 1) * 100 if first6[0]["o"] > 0 else 0
    if first30 < 1.0:
        return None

    pv = vv = 0.0
    vw = []
    for z in a:
        tp = (z["h"] + z["l"] + z["c"]) / 3
        pv += tp * z["v"]; vv += z["v"]
        vw.append(pv / max(vv, 1.0))

    for i in range(6, len(a) - 1):
        z = a[i]
        if z["hm"] < 1500:
            continue
        if z["hm"] > 1520:
            break
        prev6 = a[i - 6:i]
        mom30 = (z["c"] / prev6[0]["c"] - 1) * 100 if prev6[0]["c"] > 0 else 0
        prior3 = max(x["c"] for x in a[i - 3:i])
        vols = [x["v"] for x in prev6 if x["v"] > 0]
        vr = z["v"] / statistics.fmean(vols) if vols else 0
        if mom30 < .5 or z["c"] <= vw[i] or z["c"] <= prior3 or vr < 1.1:
            continue
        ent_i = i + 1
        entry = a[ent_i]["o"]
        ex = sim_exit(a, ent_i, entry, 1.0, 2.0, 1555, 12, SOXL_FRICTION)
        if not ex:
            continue
        return {
            "date": day["sessionDateEt"], "strategy": "soxl", "strategyVersion": META["soxl"]["version"],
            "code": "SOXL", "signalTime": z["hm"], "entryTime": a[ent_i]["hm"], "entryPrice": entry,
            "first30RetPct": first30, "power30RetPct": mom30, "signalVwap": vw[i], "volumeRatio": vr,
            "decisionReason": "first30_strength+power_hour_momentum+vwap+prior3_break+volume",
            "sample": "design" if day["sessionDateEt"] <= DESIGN_END else "outOfSample", **ex,
        }
    return None


def soxl_run():
    days = load_soxl_days()
    trades, decisions = [], []
    for d in days:
        t = soxl_candidate(d)
        if t: trades.append(t)
        ds = d["sessionDateEt"]
        decisions.append({
            "date": ds, "strategy": "soxl", "strategyVersion": META["soxl"]["version"],
            "action": "trade" if t else "no_trade", "trades": 1 if t else 0,
            "decisionReason": "qualified_power_hour" if t else "no_power_hour_signal",
        })
    return days, trades, decisions


def day_labels(name, days):
    if name == "opening" or name == "daytrading":
        return [d["date"] for d in days]
    if name == "crypto":
        return [d["date"] for d in days]
    return [d["sessionDateEt"] for d in days]


def daily_returns(trades, labels, slots):
    by = {d: [] for d in labels}
    for t in trades:
        by.setdefault(t["date"], []).append(float(t["pnlPct"]))
    return {d: sum(by.get(d, [])) / max(1, slots) for d in labels}


def metrics(trades, labels, slots):
    labels = sorted(set(labels))
    daily = daily_returns(trades, labels, slots)
    eq = peak = 1.0
    mdd = 0.0
    weeks = {}
    for d in labels:
        r = daily.get(d, 0.0)
        eq *= max(1e-9, 1 + r / 100)
        peak = max(peak, eq)
        mdd = min(mdd, (eq / peak - 1) * 100)
        y, w, _ = date.fromisoformat(d).isocalendar()
        weeks[(y, w)] = weeks.get((y, w), 1.0) * (1 + r / 100)

    trade_pnl = [float(t["pnlPct"]) for t in trades]
    wins = [x for x in trade_pnl if x > 0]
    losses = [x for x in trade_pnl if x < 0]
    active = [daily[d] for d in labels if abs(daily[d]) > 1e-12]
    loss_days = [x for x in active if x < 0]
    years = max(len(labels) / (365 if len(labels) and labels[0] and False else 250), 1e-9)
    # Calendar normalization: crypto is 365, other tabs roughly 250. Caller overwrites perYear below.
    return {
        "days": len(labels), "trades": len(trades), "tradeDays": len(active),
        "winRatePct": len(wins) / len(trade_pnl) * 100 if trade_pnl else 0.0,
        "avgTradePnlPct": statistics.fmean(trade_pnl) if trade_pnl else 0.0,
        "avgDailyReturnPct": statistics.fmean([daily[d] for d in labels]) if labels else 0.0,
        "plus1Days": sum(1 for d in labels if daily[d] >= 1.0),
        "plus1DayRatePct": sum(1 for d in labels if daily[d] >= 1.0) / len(labels) * 100 if labels else 0.0,
        "plus5Weeks": sum(1 for v in weeks.values() if v >= 1.05),
        "weeklyAvgPct": (eq ** (1 / len(weeks)) - 1) * 100 if weeks else 0.0,
        "lossDayAvgPct": statistics.fmean(loss_days) if loss_days else 0.0,
        "worstDayPct": min(active) if active else 0.0,
        "profitFactor": sum(wins) / -sum(losses) if losses else (999.0 if wins else 0.0),
        "compoundReturnPct": (eq - 1) * 100,
        "maxDrawdownPct": mdd,
        "daily": [{"date": d, "returnPct": daily[d], "trades": sum(1 for t in trades if t["date"] == d)} for d in labels],
    }


def split_report(name, days, trades):
    labels = day_labels(name, days)
    design_l = [d for d in labels if d <= DESIGN_END]
    oos_l = [d for d in labels if d >= PAPER_START]
    design_t = [t for t in trades if t["date"] <= DESIGN_END]
    oos_t = [t for t in trades if t["date"] >= PAPER_START]
    slots = META[name]["slots"]
    d = metrics(design_t, design_l, slots)
    o = metrics(oos_t, oos_l, slots)
    per_year = 365 if name == "crypto" else 250
    for z in (d, o):
        yrs = z["days"] / per_year if z["days"] else 0
        z["plus1DaysPerYear"] = z["plus1Days"] / yrs if yrs else 0.0
        z["plus5WeeksPerYear"] = z["plus5Weeks"] / yrs if yrs else 0.0
    enough = o["days"] >= 20 and o["trades"] >= 20
    if not enough:
        status = "collecting"
    elif o["avgDailyReturnPct"] > 0 and o["profitFactor"] >= 1.10 and o["maxDrawdownPct"] >= -15 and o["worstDayPct"] >= -8:
        status = "review"
    else:
        status = "needs_revision"
    return {
        "strategy": name, **META[name], "paperStart": PAPER_START,
        "status": status, "design": d, "outOfSample": o,
        "reviewPolicy": "Rules stay frozen. Review after >=20 prospective days AND >=20 prospective trades; positive daily expectancy, PF>=1.10, MDD>=-15%, worst day>=-8%. No automatic live promotion.",
        "targetNote": "+1% day / +5% week are research thresholds, not guaranteed returns.",
        "recentTrades": sorted(trades, key=lambda x: (x["date"], x.get("entryTime", 0)))[-20:],
    }


def write_csv(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    keys = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def equal_weight_portfolio(reports):
    """Research-only 25% each candidate. SOXL ET result maps to next KST date."""
    series = {}
    calendars = set()
    for name, rep in reports.items():
        daily = {x["date"]: float(x["returnPct"]) for x in rep["outOfSample"].get("daily") or []}
        if name == "soxl":
            daily = {(date.fromisoformat(d) + timedelta(days=1)).isoformat(): v for d, v in daily.items()}
        series[name] = daily
        calendars |= set(daily)
    if not calendars:
        return {}
    daily = {}
    for d in sorted(calendars):
        daily[d] = sum(series[n].get(d, 0.0) for n in series) / 4
    fake = [{"date": d, "pnlPct": v} for d, v in daily.items()]
    z = metrics(fake, sorted(calendars), 1)
    z["allocation"] = "research-only equal 25% each; SOXL ET session mapped to next KST date"
    return z


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    runners = {
        "opening": opening_run,
        "daytrading": daytrading_run,
        "crypto": crypto_run,
        "soxl": soxl_run,
    }
    reports = {}
    latest_dates = {}
    for name, fn in runners.items():
        days, trades, decisions = fn()
        reports[name] = split_report(name, days, trades)
        labels = day_labels(name, days)
        latest_dates[name] = labels[-1] if labels else None
        write_csv(OUT / f"{name}-trades.csv", trades)
        write_csv(OUT / f"{name}-decisions.csv", decisions)

    report = {
        "schema": 1,
        "generatedAt": datetime.now(KST).isoformat(),
        "mode": "prospective-shadow-paper",
        "paperStart": PAPER_START,
        "designEnd": DESIGN_END,
        "goal": {"dailyNetPct": 1.0, "weeklyNetPct": 5.0},
        "executionRule": "completed-bar signal -> next-bar-open fill; same-bar stop/target -> stop first; explicit friction; no broker orders",
        "promotionRule": "No automatic promotion. New version only after prospective review; never rewrite historical rules.",
        "latestSourceDates": latest_dates,
        "strategies": reports,
        "equalWeightPortfolio": equal_weight_portfolio(reports),
    }
    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    stamp = max((d for d in latest_dates.values() if d), default="empty")
    print(json.dumps({
        "latest": stamp,
        "strategies": {k: {
            "status": v["status"],
            "design": {x: v["design"].get(x) for x in ("trades","avgDailyReturnPct","plus1DaysPerYear","maxDrawdownPct")},
            "oos": {x: v["outOfSample"].get(x) for x in ("days","trades","avgDailyReturnPct","plus1Days","maxDrawdownPct")},
        } for k, v in reports.items()},
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
