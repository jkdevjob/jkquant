#!/usr/bin/env python3
"""Cumulative SOXL intraday research backtest.

Baseline v1:
- SOXL regular-session 5-minute bars, America/New_York.
- Opening range = first 15 minutes (09:30, 09:35, 09:40 bars).
- First fresh close breakout of the opening-range high, no later than 11:30 ET.
- Breakout close above cumulative session VWAP.
- Breakout volume >= recent closed-bar mean volume * 1.0.
- Enter at the NEXT 5-minute bar open.
- Stop -1.2%, take-profit +2.4%, max hold 90 minutes.
- One trade maximum per session.
- Same-bar stop/target conflict resolves to stop.
- Net result subtracts 0.20% round-trip friction.

Research only. Variants never auto-promote and no orders are placed.
"""
from __future__ import annotations

import csv
import gzip
import json
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime
from bisect import bisect_left
from pathlib import Path
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
DATA = Path("data") / "soxl" / "SOXL" / "5m"
SOXX_DAILY = Path("data") / "soxl" / "SOXX" / "1d" / "series.json.gz"
OUT = Path("data") / "soxl-research"


@dataclass(frozen=True)
class Params:
    name: str
    range_bars: int = 3
    volume_lookback: int = 6
    volume_mult: float = 1.0
    use_vwap: bool = True
    entry_cutoff_hm: int = 1130
    stop_pct: float = 1.2
    take_profit_pct: float = 2.4
    max_hold_bars: int = 18
    friction_pct: float = 0.20


VARIANTS = [
    Params("baseline"),
    Params("range_5m", range_bars=1),
    Params("range_30m", range_bars=6),
    Params("vol_0.8", volume_mult=0.8),
    Params("vol_1.2", volume_mult=1.2),
    Params("no_vwap", use_vwap=False),
    Params("stop_0.8_tp_1.6", stop_pct=0.8, take_profit_pct=1.6),
    Params("stop_1.5_tp_3.0", stop_pct=1.5, take_profit_pct=3.0),
    Params("hold_45m", max_hold_bars=9),
    Params("hold_120m", max_hold_bars=24),
]

SHADOW_STRATEGIES = [
    {
        "name": "soxl_soxx_rsi35_v1",
        "label": "반도체 과매도 당일 반등",
        "designedFrom": ["2010-01~2026-09"],
        "evaluationScope": "all_available",
        "ordersAllowed": False,
        "params": {"soxxPrevRsiMax": 35.0, "frictionPct": 0.20, "hold": "same_day"},
        "backtestExpected": {
            "trades": 184, "avgPnlPct": 1.030, "winRatePct": 51.0, "t": 1.86,
            "without2020AvgPct": 0.769, "without2020_2022_2025AvgPct": 0.306,
            "sample": "SOXL/SOXX · 2010~2026-09",
        },
        "note": "위기 때만 작동하는 전략 — 평소엔 신호가 거의 없고 수익도 없다. 5일 보유 금지.",
    }
]


def et_hm(t: str) -> int:
    try:
        s = str(t)
        return int(s[11:13]) * 100 + int(s[14:16])
    except Exception:
        return -1


def load_days():
    out = []
    if not DATA.exists():
        return out
    for p in sorted(DATA.glob("*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            if j.get("sessionDateEt") and j.get("bars"):
                out.append(j)
        except Exception as e:
            print("skip", p, e)
    return out


def valid_day(day):
    bars = sorted(day.get("bars") or [], key=lambda x: x.get("tEt") or "")
    if len(bars) < 70:
        return False, "too_few_regular_bars"
    if et_hm(bars[0].get("tEt")) != 930:
        return False, "missing_0930_bar"
    if et_hm(bars[-1].get("tEt")) < 1555:
        return False, "incomplete_or_early_close_session"
    return True, ""


def no_trade(date, reason, **extra):
    return {
        "date": date,
        "strategyVersion": "soxl_orb_v1",
        "action": "no_trade",
        "decisionReason": reason,
        **extra,
    }


def load_soxx_rsi14():
    if not SOXX_DAILY.exists():
        return [], {}
    try:
        with gzip.open(SOXX_DAILY, "rt", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:
        return [], {}
    rows = sorted(payload.get("rows") or [], key=lambda x: str(x.get("date") or ""))
    out = {}
    prev = None
    au = ad = None
    alpha = 1.0 / 14.0
    for row in rows:
        d = str(row.get("date") or "")
        c = float(row.get("adjClose") or 0)
        if not d or c <= 0:
            continue
        if prev is not None:
            delta = c - prev
            up, dn = max(delta, 0.0), max(-delta, 0.0)
            if au is None:
                au, ad = up, dn
            else:
                au = au * (1.0 - alpha) + up * alpha
                ad = ad * (1.0 - alpha) + dn * alpha
            out[d] = 100.0 - 100.0 / (1.0 + au / max(ad, 1e-12)) if ad > 0 else 100.0
        prev = c
    return sorted(out), out


def soxx_prev_rsi(date, dates, values):
    i = bisect_left(dates, date) - 1
    return values.get(dates[i]) if i >= 0 else None


def soxl_oversold_shadow(days, cfg, soxx_dates, soxx_rsi):
    p = cfg["params"]
    eval_days = []
    trades = []
    for day in days:
        date = str(day.get("sessionDateEt") or "")
        rsi = soxx_prev_rsi(date, soxx_dates, soxx_rsi)
        if rsi is None:
            continue
        eval_days.append(date)
        if not (rsi < float(p["soxxPrevRsiMax"])):
            continue
        bars = sorted(day.get("bars") or [], key=lambda x: x.get("tEt") or "")
        if not bars:
            continue
        entry = float(bars[0].get("o") or 0)
        exit_px = float(bars[-1].get("c") or 0)
        if min(entry, exit_px) <= 0:
            continue
        gross = (exit_px / entry - 1.0) * 100.0
        net = gross - float(p["frictionPct"])
        mfe = (max(float(x.get("h") or entry) for x in bars) / entry - 1.0) * 100.0
        mae = (min(float(x.get("l") or entry) for x in bars) / entry - 1.0) * 100.0
        trades.append({
            "date": date,
            "strategyVersion": "soxl_soxx_rsi35_shadow_v1",
            "variant": cfg["name"],
            "signalTimeEt": "09:30",
            "entryTimeEt": "09:30",
            "exitTimeEt": "16:00",
            "entryPrice": entry,
            "exitPrice": exit_px,
            "soxxPrevRsi14": rsi,
            "grossPnlPct": gross,
            "frictionPct": float(p["frictionPct"]),
            "pnlPct": net,
            "mfePct": mfe,
            "maePct": mae,
            "reason": "same_day_close",
            "evidence": {
                "source": "SOXX adjusted daily close RSI(14) + SOXL regular-session 5m OHLCV",
                "evaluationScope": "all_available",
                "soxxPrevRsi14": rsi,
                "requiredRsiBelow": p["soxxPrevRsiMax"],
                "entryRule": "SOXL regular-session open",
                "exitRule": "same-day regular-session close",
                "frictionPct": p["frictionPct"],
                "overnightHold": False,
            },
        })
    sm = summary(trades, eval_days)
    ready = len(eval_days) >= 20 and sm["trades"] >= 30
    return {
        **cfg,
        "evaluationDays": len(eval_days),
        "status": "reviewable" if ready else "collecting",
        "reviewRule": ">=20 stored days and >=30 completed shadow trades; no auto-promotion",
        "sampleNote": "전체 보유 데이터 재평가 — 설계 표본 포함 가능, OOS 아님",
        "summary": sm,
        "trades": trades,
        "latestTrades": trades[-20:],
        "soxxAdjustedDataAvailable": bool(soxx_dates),
    }


def evaluate_day(day, p: Params):
    date = day.get("sessionDateEt")
    ok, why = valid_day(day)
    if not ok:
        return None, no_trade(date, why)

    bars = sorted(day.get("bars") or [], key=lambda x: x.get("tEt") or "")
    if len(bars) < p.range_bars + 2:
        return None, no_trade(date, "insufficient_opening_range")

    for i, x in enumerate(bars[:p.range_bars]):
        minute = 9 * 60 + 30 + i * 5
        expected = (minute // 60) * 100 + (minute % 60)
        if et_hm(x.get("tEt")) != expected:
            return None, no_trade(date, "opening_range_gap")

    opening = bars[:p.range_bars]
    or_high = max(float(x.get("h") or 0) for x in opening)
    or_low = min(float(x.get("l") or 0) for x in opening)
    if or_high <= 0:
        return None, no_trade(date, "invalid_opening_range")

    cum_pv = 0.0
    cum_v = 0.0
    for x in opening:
        v = float(x.get("v") or 0)
        tp = (float(x.get("h") or 0) + float(x.get("l") or 0) + float(x.get("c") or 0)) / 3.0
        cum_pv += tp * v
        cum_v += v

    saw_breakout = False
    saw_volume_pass = False
    saw_vwap_pass = False
    breakout_count = 0
    max_close_vs_or = -999.0
    max_volume_ratio = 0.0
    max_close_vs_vwap = -999.0

    for i in range(p.range_bars, len(bars) - 1):
        x = bars[i]
        hmi = et_hm(x.get("tEt"))
        if hmi < 0:
            continue
        if hmi > p.entry_cutoff_hm:
            break

        v = float(x.get("v") or 0)
        tp = (float(x.get("h") or 0) + float(x.get("l") or 0) + float(x.get("c") or 0)) / 3.0
        cum_pv += tp * v
        cum_v += v
        vwap = cum_pv / cum_v if cum_v > 0 else 0.0
        close = float(x.get("c") or 0)
        prev_close = float(bars[i - 1].get("c") or 0)

        close_vs_or = (close / or_high - 1.0) * 100.0 if or_high > 0 else -999.0
        max_close_vs_or = max(max_close_vs_or, close_vs_or)
        close_vs_vwap = (close / vwap - 1.0) * 100.0 if vwap > 0 else -999.0
        max_close_vs_vwap = max(max_close_vs_vwap, close_vs_vwap)

        hist = bars[max(0, i - p.volume_lookback):i]
        vols = [float(z.get("v") or 0) for z in hist if float(z.get("v") or 0) > 0]
        ref_vol = statistics.fmean(vols) if vols else 0.0
        vol_ratio = v / ref_vol if ref_vol > 0 else 0.0
        max_volume_ratio = max(max_volume_ratio, vol_ratio)

        fresh = close > or_high and prev_close <= or_high
        if not fresh:
            continue
        saw_breakout = True
        breakout_count += 1
        if vol_ratio < p.volume_mult:
            continue
        saw_volume_pass = True
        if p.use_vwap and not (close > vwap):
            continue
        saw_vwap_pass = True

        entry_i = i + 1
        entry_bar = bars[entry_i]
        entry = float(entry_bar.get("o") or 0)
        if entry <= 0:
            return None, no_trade(date, "invalid_next_bar_open", openingHigh=or_high, openingLow=or_low)

        stop_px = entry * (1.0 - p.stop_pct / 100.0)
        target_px = entry * (1.0 + p.take_profit_pct / 100.0)
        last_i = min(len(bars) - 1, entry_i + p.max_hold_bars - 1)

        exit_px = None
        exit_i = None
        reason = None
        for k in range(entry_i, last_i + 1):
            b = bars[k]
            low = float(b.get("l") or 0)
            high = float(b.get("h") or 0)
            hit_stop = low <= stop_px
            hit_target = high >= target_px
            if hit_stop and hit_target:
                exit_px, exit_i, reason = stop_px, k, "stop_same_bar"
                break
            if hit_stop:
                exit_px, exit_i, reason = stop_px, k, "stop"
                break
            if hit_target:
                exit_px, exit_i, reason = target_px, k, "take_profit"
                break

        if exit_px is None:
            exit_i = last_i
            exit_px = float(bars[exit_i].get("c") or 0)
            reason = "time_exit"

        path = bars[entry_i:exit_i + 1]
        mfe = (max(float(z.get("h") or entry) for z in path) / entry - 1.0) * 100.0
        mae = (min(float(z.get("l") or entry) for z in path) / entry - 1.0) * 100.0
        gross = (exit_px / entry - 1.0) * 100.0
        net = gross - p.friction_pct
        signal_bar = bars[i]

        trade = {
            "date": date,
            "strategyVersion": "soxl_orb_v1",
            "variant": p.name,
            "signalTimeEt": str(signal_bar.get("tEt") or "")[11:16],
            "entryTimeEt": str(entry_bar.get("tEt") or "")[11:16],
            "exitTimeEt": str(bars[exit_i].get("tEt") or "")[11:16],
            "openingHigh": or_high,
            "openingLow": or_low,
            "signalClose": close,
            "signalVwap": vwap,
            "volumeRatio": vol_ratio,
            "entryPrice": entry,
            "exitPrice": exit_px,
            "reason": reason,
            "grossPnlPct": gross,
            "frictionPct": p.friction_pct,
            "pnlPct": net,
            "mfePct": mfe,
            "maePct": mae,
            "evidence": {
                "source": "Yahoo Finance public 5m OHLCV",
                "timezone": "America/New_York",
                "rangeBars": p.range_bars,
                "openingHigh": or_high,
                "openingLow": or_low,
                "signalClose": close,
                "previousClose": prev_close,
                "freshBreakout": fresh,
                "signalVwap": vwap,
                "closeAboveVwap": (close > vwap) if vwap > 0 else None,
                "recentVolumeMean": ref_vol,
                "signalVolume": v,
                "volumeRatio": vol_ratio,
                "requiredVolumeRatio": p.volume_mult,
                "entryCutoffEt": p.entry_cutoff_hm,
                "entryRule": "next_5m_open",
                "stopPct": p.stop_pct,
                "takeProfitPct": p.take_profit_pct,
                "maxHoldBars": p.max_hold_bars,
                "frictionPct": p.friction_pct,
                "sameBarConflictRule": "stop_first",
                "oneTradePerSession": True,
            },
        }
        decision = {
            "date": date,
            "strategyVersion": "soxl_orb_v1",
            "action": "trade",
            "decisionReason": "fresh_breakout+volume+vwap_pass",
            "signalTimeEt": trade["signalTimeEt"],
            "entryTimeEt": trade["entryTimeEt"],
            "exitTimeEt": trade["exitTimeEt"],
            "openingHigh": or_high,
            "openingLow": or_low,
            "signalClose": close,
            "signalVwap": vwap,
            "volumeRatio": vol_ratio,
            "entryPrice": entry,
            "exitPrice": exit_px,
            "exitReason": reason,
            "pnlPct": net,
        }
        return trade, decision

    if not saw_breakout:
        reason = "no_fresh_breakout_before_cutoff"
    elif not saw_volume_pass:
        reason = "breakout_volume_filter_fail"
    elif p.use_vwap and not saw_vwap_pass:
        reason = "breakout_vwap_filter_fail"
    else:
        reason = "no_qualified_entry"

    return None, no_trade(
        date,
        reason,
        openingHigh=or_high,
        openingLow=or_low,
        breakoutCount=breakout_count,
        maxCloseVsOpeningHighPct=max_close_vs_or if max_close_vs_or > -900 else None,
        maxVolumeRatio=max_volume_ratio,
        maxCloseVsVwapPct=max_close_vs_vwap if max_close_vs_vwap > -900 else None,
    )


def summary(trades, day_labels):
    trades = sorted(trades, key=lambda x: (x["date"], x["entryTimeEt"]))
    by_date = {x["date"]: x for x in trades}
    pnls = [float(x["pnlPct"]) for x in trades]
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    gp = sum(wins)
    gl = -sum(losses)

    equity = 1.0
    peak = 1.0
    mdd = 0.0
    for d in day_labels:
        t = by_date.get(d)
        pnl = float(t["pnlPct"]) if t else 0.0
        equity *= max(1e-9, 1.0 + pnl / 100.0)
        peak = max(peak, equity)
        if peak > 0:
            mdd = min(mdd, (equity / peak - 1.0) * 100.0)

    target1 = sum(1 for x in pnls if x >= 1.0)
    traded_dates = set(by_date)
    return {
        "days": len(day_labels),
        "trades": len(trades),
        "signalRatePct": (len(trades) / len(day_labels) * 100.0) if day_labels else 0.0,
        "noTradeDays": max(0, len(day_labels) - len(traded_dates)),
        "winRate": (len(wins) / len(pnls) * 100.0) if pnls else 0.0,
        "avgPnl": statistics.fmean(pnls) if pnls else 0.0,
        "medianPnl": statistics.median(pnls) if pnls else 0.0,
        "sumPnl": sum(pnls),
        "avgDailyReturnPct": (sum(pnls) / len(day_labels)) if day_labels else 0.0,
        "target1PctDayCount": target1,
        "target1PctDayRatePct": (target1 / len(day_labels) * 100.0) if day_labels else 0.0,
        "profitFactor": (gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "compoundReturnPct": (equity - 1.0) * 100.0,
        "maxDrawdownPct": mdd,
        "avgMfePct": statistics.fmean(float(x["mfePct"]) for x in trades) if trades else 0.0,
        "avgMaePct": statistics.fmean(float(x["maePct"]) for x in trades) if trades else 0.0,
    }


def split_validation(days, trades):
    labels = [x["sessionDateEt"] for x in days]
    if len(labels) < 30:
        return {
            "status": "collecting",
            "trainDays": 0,
            "holdoutDays": 0,
            "train": summary([], []),
            "holdout": summary([], []),
        }
    cut = max(1, int(len(labels) * 0.70))
    train = labels[:cut]
    hold = labels[cut:]
    tr = set(train)
    ho = set(hold)
    return {
        "status": "reviewable",
        "trainDays": len(train),
        "holdoutDays": len(hold),
        "train": summary([x for x in trades if x["date"] in tr], train),
        "holdout": summary([x for x in trades if x["date"] in ho], hold),
    }


def rolling_baseline(days, trades, window=30):
    labels = [x["sessionDateEt"] for x in days]
    if len(labels) < window:
        return {"windowDays": window, "count": 0}
    by_date = {x["date"]: x for x in trades}
    vals = []
    for i in range(len(labels) - window + 1):
        d = labels[i:i + window]
        ts = [by_date[x] for x in d if x in by_date]
        s = summary(ts, d)
        vals.append({
            "from": d[0],
            "to": d[-1],
            "trades": s["trades"],
            "avgDailyReturnPct": s["avgDailyReturnPct"],
            "target1PctDayRatePct": s["target1PctDayRatePct"],
            "compoundReturnPct": s["compoundReturnPct"],
        })
    return {
        "windowDays": window,
        "count": len(vals),
        "worstCompoundReturnPct": min(x["compoundReturnPct"] for x in vals),
        "bestCompoundReturnPct": max(x["compoundReturnPct"] for x in vals),
        "avgCompoundReturnPct": statistics.fmean(x["compoundReturnPct"] for x in vals),
        "latest": vals[-1],
    }



def walk_forward(days, trade_map, train_days=30, test_days=10, step_days=10):
    labels = [x["sessionDateEt"] for x in days]
    need = train_days + test_days
    if len(labels) < need:
        return {
            "status": "collecting",
            "trainDays": train_days,
            "testDays": test_days,
            "stepDays": step_days,
            "foldCount": 0,
            "daysNeededForFirstFold": need,
            "folds": [],
            "oosVariants": [],
        }

    folds = []
    oos = {p.name: [] for p in VARIANTS}
    oos_days = []
    for start in range(0, len(labels) - need + 1, step_days):
        train = labels[start:start + train_days]
        test = labels[start + train_days:start + need]
        tr_set = set(train)
        te_set = set(test)
        oos_days.extend(test)
        variants = []
        for p in VARIANTS:
            rows = trade_map[p.name]
            tr = [x for x in rows if x["date"] in tr_set]
            te = [x for x in rows if x["date"] in te_set]
            oos[p.name].extend(te)
            variants.append({
                "name": p.name,
                "train": summary(tr, train),
                "test": summary(te, test),
            })
        folds.append({
            "fold": len(folds) + 1,
            "trainFrom": train[0],
            "trainTo": train[-1],
            "testFrom": test[0],
            "testTo": test[-1],
            "variants": variants,
        })

    unique_oos_days = sorted(set(oos_days))
    return {
        "status": "reviewable" if len(folds) >= 3 else "early",
        "trainDays": train_days,
        "testDays": test_days,
        "stepDays": step_days,
        "foldCount": len(folds),
        "oosDays": len(unique_oos_days),
        "folds": folds,
        "oosVariants": [
            {"name": p.name, "summary": summary(oos[p.name], unique_oos_days)}
            for p in VARIANTS
        ],
    }


def main():
    all_days = load_days()
    OUT.mkdir(parents=True, exist_ok=True)

    valid = []
    invalid = []
    for d in all_days:
        ok, reason = valid_day(d)
        if ok:
            valid.append(d)
        else:
            invalid.append({"date": d.get("sessionDateEt"), "reason": reason})

    if not valid:
        print("No valid SOXL archives yet.")
        return 0

    labels = [x["sessionDateEt"] for x in valid]
    reports = []
    trade_map = {}
    decision_map = {}
    soxx_dates, soxx_rsi = load_soxx_rsi14()

    for p in VARIANTS:
        trades = []
        decisions = []
        for d in valid:
            t, dec = evaluate_day(d, p)
            decisions.append(dec)
            if t:
                trades.append(t)
        trade_map[p.name] = trades
        decision_map[p.name] = decisions
        reports.append({
            "params": asdict(p),
            "summary": summary(trades, labels),
            "validation": split_validation(valid, trades),
        })

    baseline = trade_map["baseline"]
    base_decisions = decision_map["baseline"]
    wf = walk_forward(valid, trade_map)
    comparison_ready = len(valid) >= 60 and len(baseline) >= 25 and wf["status"] == "reviewable"

    report = {
        "schema": 1,
        "generatedAt": datetime.now(NY).isoformat(),
        "market": "SOXL",
        "timezone": "America/New_York",
        "unitMinutes": 5,
        "source": "Yahoo Finance public chart endpoint",
        "from": labels[0],
        "to": labels[-1],
        "archiveDays": len(all_days),
        "validDays": len(valid),
        "invalidDays": invalid,
        "comparisonStatus": "reviewable" if comparison_ready else "collecting",
        "comparisonRule": "Research comparison only. Baseline stays fixed; no automatic live promotion.",
        "auditRule": "Raw OHLCV, strategy version, signal thresholds, trade/no-trade reason, entry/exit and MFE/MAE are retained.",
        "executionModel": "signal on completed 5m bar; enter next 5m open; same-bar stop/target conflict resolves to stop",
        "frictionModel": "0.20% round-trip conservative friction assumption",
        "dataWindowNote": "Yahoo 5m source backfills a rolling recent window; the scalping-data archive grows prospectively beyond it.",
        "targetNote": "Net +1% days are tracked as a research target metric, not a guaranteed daily return.",
        "variants": reports,
        "shadowStrategies": [soxl_oversold_shadow(valid, cfg, soxx_dates, soxx_rsi) for cfg in SHADOW_STRATEGIES],
        "walkForward": wf,
        "rolling30": rolling_baseline(valid, baseline, 30),
        "latestTrades": baseline[-20:],
        "latestDecisions": base_decisions[-10:],
    }

    (OUT / "latest.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / f"{labels[-1]}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    with (OUT / "baseline-trades.csv").open("w", encoding="utf-8", newline="") as f:
        cols = [
            "date", "strategyVersion", "signalTimeEt", "entryTimeEt", "exitTimeEt",
            "openingHigh", "openingLow", "signalClose", "signalVwap", "volumeRatio",
            "entryPrice", "exitPrice", "reason", "grossPnlPct", "frictionPct", "pnlPct",
            "mfePct", "maePct",
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for x in baseline:
            w.writerow({k: x.get(k) for k in cols})

    with (OUT / "baseline-decisions.csv").open("w", encoding="utf-8", newline="") as f:
        cols = [
            "date", "strategyVersion", "action", "decisionReason", "signalTimeEt", "entryTimeEt", "exitTimeEt",
            "openingHigh", "openingLow", "breakoutCount", "maxCloseVsOpeningHighPct", "maxVolumeRatio",
            "maxCloseVsVwapPct", "signalClose", "signalVwap", "volumeRatio", "entryPrice", "exitPrice",
            "exitReason", "pnlPct",
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for x in base_decisions:
            w.writerow({k: x.get(k) for k in cols})

    base = next(x for x in reports if x["params"]["name"] == "baseline")
    print(json.dumps({
        "days": len(valid),
        "from": labels[0],
        "to": labels[-1],
        "baseline": base["summary"],
        "holdout": base["validation"]["holdout"],
        "rolling30": report["rolling30"],
        "walkForwardStatus": wf["status"],
        "walkForwardFolds": wf["foldCount"],
        "comparisonStatus": report["comparisonStatus"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
