#!/usr/bin/env python3
"""Cumulative research backtest for JKQuant bitcoin 09:00 KST ORB.

Baseline v1:
- Upbit KRW-BTC 5-minute candles.
- 09:00~09:05 KST first-bar high is the opening-range high.
- First fresh close breakout after the range, no later than 12:00 KST.
- Breakout volume >= opening-range average volume * 1.2.
- Breakout close must be above cumulative session VWAP.
- Enter at the NEXT 5-minute bar open (no same-bar/lookahead entry).
- Stop -0.5%, take-profit +1.0%, max hold 60 minutes.
- If stop and target are both touched in one candle, stop wins.
- Net result subtracts 0.10% round-trip fee plus 0.04% slippage assumption.

Research only. No variant is automatically promoted and no orders are placed.
"""
from __future__ import annotations

import csv
import gzip
import json
import math
import statistics
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")
DATA = Path("data") / "crypto" / "KRW-BTC" / "5m"
OUT = Path("data") / "crypto-research"


@dataclass(frozen=True)
class Params:
    name: str
    range_bars: int = 1
    volume_mult: float = 1.2
    use_vwap: bool = True
    entry_cutoff_min: int = 180  # UTC 03:00 == KST 12:00
    stop_pct: float = 0.5
    take_profit_pct: float = 1.0
    max_hold_bars: int = 12      # 60 minutes on 5m bars
    fee_round_trip_pct: float = 0.10
    slippage_round_trip_pct: float = 0.04


VARIANTS = [
    Params("baseline"),
    Params("no_vwap", use_vwap=False),
    Params("vol_1.0", volume_mult=1.0),
    Params("vol_1.5", volume_mult=1.5),
    Params("range_15m", range_bars=3),
    Params("range_30m", range_bars=6),
    Params("stop_0.3_tp_0.6", stop_pct=0.3, take_profit_pct=0.6),
    Params("stop_0.7_tp_1.4", stop_pct=0.7, take_profit_pct=1.4),
    Params("hold_30m", max_hold_bars=6),
    Params("hold_120m", max_hold_bars=24),
    Params("entry_by_10", entry_cutoff_min=60),  # UTC 01:00 == KST 10:00
]

SHADOW_STRATEGIES = [
    {
        "name": "btc_24h_drop_v1",
        "label": "24시간 급락 받아주기",
        "designedFrom": ["2023-07~2026-09"],
        "evaluationScope": "all_available",
        "ordersAllowed": False,
        "params": {"drop24hPctMax": -5.0, "holdHours": 24, "frictionPct": 0.12},
        "backtestExpected": {
            "trades": 52, "avgPnlPct": 0.93, "winRatePct": 58.0, "t": 1.76,
            "firstHalfAvgPct": 1.57, "secondHalfAvgPct": 0.30,
            "sample": "Upbit KRW-BTC 1h · 2023-07~2026-09",
        },
        "note": "연 약 17회 수준이라 30건까지 약 2년 예상. 기준전략/주문과 분리된 그림자 전용.",
    }
]


def utc_minute(t: str) -> int:
    s = str(t or "")
    try:
        hh = int(s[11:13])
        mm = int(s[14:16])
        return hh * 60 + mm
    except Exception:
        return -1


def kst_hm(t: str) -> str:
    s = str(t or "")
    return s[11:16] if len(s) >= 16 else ""


def load_days():
    out = []
    if not DATA.exists():
        return out
    for p in sorted(DATA.glob("*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            bars = j.get("bars") or []
            if j.get("sessionDateUtc") and bars:
                out.append(j)
        except Exception as e:
            print("skip", p, e)
    return out


def valid_day(day):
    bars = day.get("bars") or []
    if len(bars) < 270:
        return False, "too_few_bars"
    first = bars[0]
    if utc_minute(first.get("tUtc")) != 0:
        return False, "missing_utc_0000"
    return True, ""


def trade_for_day(day, p: Params):
    ok, _ = valid_day(day)
    if not ok:
        return None

    bars = sorted(day.get("bars") or [], key=lambda x: x.get("tUtc") or "")
    if len(bars) < p.range_bars + 2:
        return None

    opening = bars[: p.range_bars]
    if any(utc_minute(x.get("tUtc")) != i * 5 for i, x in enumerate(opening)):
        return None

    or_high = max(float(x.get("h") or 0) for x in opening)
    or_low = min(float(x.get("l") or 0) for x in opening)
    base_vol = statistics.fmean(float(x.get("v") or 0) for x in opening)
    if or_high <= 0 or base_vol <= 0:
        return None

    cum_pv = 0.0
    cum_v = 0.0
    for x in opening:
        v = float(x.get("v") or 0)
        tp = (float(x.get("h") or 0) + float(x.get("l") or 0) + float(x.get("c") or 0)) / 3.0
        cum_pv += tp * v
        cum_v += v

    signal_i = None
    signal_vwap = None
    signal_vol_ratio = None

    for i in range(p.range_bars, len(bars) - 1):
        x = bars[i]
        minute = utc_minute(x.get("tUtc"))
        if minute < 0:
            continue
        if minute > p.entry_cutoff_min:
            break

        v = float(x.get("v") or 0)
        tp = (float(x.get("h") or 0) + float(x.get("l") or 0) + float(x.get("c") or 0)) / 3.0
        cum_pv += tp * v
        cum_v += v
        vwap = cum_pv / cum_v if cum_v > 0 else 0.0
        close = float(x.get("c") or 0)
        prev_close = float(bars[i - 1].get("c") or 0)
        vol_ratio = v / base_vol if base_vol > 0 else 0.0

        fresh_breakout = close > or_high and prev_close <= or_high
        if not fresh_breakout:
            continue
        if vol_ratio < p.volume_mult:
            continue
        if p.use_vwap and not (close > vwap):
            continue

        signal_i = i
        signal_vwap = vwap
        signal_vol_ratio = vol_ratio
        break

    if signal_i is None:
        return None

    entry_i = signal_i + 1
    entry_bar = bars[entry_i]
    entry = float(entry_bar.get("o") or 0)
    if entry <= 0:
        return None

    stop_px = entry * (1.0 - p.stop_pct / 100.0)
    target_px = entry * (1.0 + p.take_profit_pct / 100.0)
    last_i = min(len(bars) - 1, entry_i + p.max_hold_bars - 1)

    exit_px = None
    exit_i = None
    reason = None
    for i in range(entry_i, last_i + 1):
        b = bars[i]
        low = float(b.get("l") or 0)
        high = float(b.get("h") or 0)
        hit_stop = low <= stop_px
        hit_target = high >= target_px
        if hit_stop and hit_target:
            exit_px, exit_i, reason = stop_px, i, "stop_same_bar"
            break
        if hit_stop:
            exit_px, exit_i, reason = stop_px, i, "stop"
            break
        if hit_target:
            exit_px, exit_i, reason = target_px, i, "take_profit"
            break

    if exit_px is None:
        exit_i = last_i
        exit_px = float(bars[exit_i].get("c") or 0)
        reason = "time_exit"

    gross = (exit_px / entry - 1.0) * 100.0
    friction = p.fee_round_trip_pct + p.slippage_round_trip_pct
    net = gross - friction

    signal_bar = bars[signal_i]
    exit_bar = bars[exit_i]
    signal_close = float(signal_bar.get("c") or 0)
    signal_prev_close = float(bars[signal_i - 1].get("c") or 0)
    return {
        "date": day.get("sessionDateUtc"),
        "strategyVersion": "btc_orb_v1",
        "signalTimeKst": kst_hm(signal_bar.get("tKst")),
        "entryTimeKst": kst_hm(entry_bar.get("tKst")),
        "exitTimeKst": kst_hm(exit_bar.get("tKst")),
        "openingHigh": or_high,
        "openingLow": or_low,
        "signalClose": signal_close,
        "signalVwap": signal_vwap,
        "volumeRatio": signal_vol_ratio,
        "entryPrice": entry,
        "exitPrice": exit_px,
        "reason": reason,
        "grossPnlPct": gross,
        "frictionPct": friction,
        "pnlPct": net,
        "variant": p.name,
        "evidence": {
            "source": "Upbit public 5m OHLCV",
            "rangeBars": p.range_bars,
            "openingHigh": or_high,
            "openingLow": or_low,
            "openingRangeBaseVolume": base_vol,
            "signalClose": signal_close,
            "previousClose": signal_prev_close,
            "freshBreakout": signal_close > or_high and signal_prev_close <= or_high,
            "signalVwap": signal_vwap,
            "closeAboveVwap": (signal_close > signal_vwap) if signal_vwap is not None else None,
            "volumeRatio": signal_vol_ratio,
            "requiredVolumeRatio": p.volume_mult,
            "entryCutoffUtcMinute": p.entry_cutoff_min,
            "entryRule": "next_5m_open",
            "stopPct": p.stop_pct,
            "takeProfitPct": p.take_profit_pct,
            "maxHoldBars": p.max_hold_bars,
            "feeRoundTripPct": p.fee_round_trip_pct,
            "slippageRoundTripPct": p.slippage_round_trip_pct,
            "sameBarConflictRule": "stop_first",
        },
    }


def summary(trades, day_labels):
    trades = sorted(trades, key=lambda x: (x["date"], x["entryTimeKst"]))
    pnls = [float(x["pnlPct"]) for x in trades]
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    gp = sum(wins)
    gl = -sum(losses)

    equity = 1.0
    peak = 1.0
    mdd = 0.0
    for pnl in pnls:
        equity *= max(1e-9, 1.0 + pnl / 100.0)
        peak = max(peak, equity)
        if peak > 0:
            mdd = min(mdd, (equity / peak - 1.0) * 100.0)

    traded_dates = {x["date"] for x in trades}
    target1 = sum(1 for x in pnls if x >= 1.0)
    return {
        "days": len(day_labels),
        "trades": len(trades),
        "signalRatePct": (len(trades) / len(day_labels) * 100.0) if day_labels else 0.0,
        "noTradeDays": max(0, len(day_labels) - len(traded_dates)),
        "winRate": (len(wins) / len(pnls) * 100.0) if pnls else 0.0,
        "avgPnl": statistics.fmean(pnls) if pnls else 0.0,
        "avgDailyReturnPct": (sum(pnls) / len(day_labels)) if day_labels else 0.0,
        "positiveDayRatePct": (len(wins) / len(day_labels) * 100.0) if day_labels else 0.0,
        "target1PctDayCount": target1,
        "target1PctDayRatePct": (target1 / len(day_labels) * 100.0) if day_labels else 0.0,
        "medianPnl": statistics.median(pnls) if pnls else 0.0,
        "sumPnl": sum(pnls),
        "compoundReturnPct": (equity - 1.0) * 100.0,
        "profitFactor": (gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "maxDrawdownPct": mdd,
    }


def split_validation(days, trades):
    labels = [x["sessionDateUtc"] for x in days]
    if len(labels) < 30:
        return {
            "status": "collecting",
            "trainDays": 0,
            "holdoutDays": 0,
            "train": summary([], []),
            "holdout": summary([], []),
        }

    cut = max(1, int(len(labels) * 0.70))
    train_days = labels[:cut]
    holdout_days = labels[cut:]
    train_set = set(train_days)
    holdout_set = set(holdout_days)
    return {
        "status": "reviewable",
        "trainDays": len(train_days),
        "holdoutDays": len(holdout_days),
        "train": summary([x for x in trades if x["date"] in train_set], train_days),
        "holdout": summary([x for x in trades if x["date"] in holdout_set], holdout_days),
    }


def rolling_baseline(days, trades, window=30):
    labels = [x["sessionDateUtc"] for x in days]
    if len(labels) < window:
        return {"windowDays": window, "count": 0}
    by_date = {}
    for t in trades:
        by_date.setdefault(t["date"], []).append(t)

    vals = []
    for i in range(len(labels) - window + 1):
        d = labels[i : i + window]
        ts = []
        for x in d:
            ts.extend(by_date.get(x, []))
        s = summary(ts, d)
        vals.append({
            "from": d[0],
            "to": d[-1],
            "avgPnl": s["avgPnl"],
            "compoundReturnPct": s["compoundReturnPct"],
            "trades": s["trades"],
        })

    return {
        "windowDays": window,
        "count": len(vals),
        "worstCompoundReturnPct": min(x["compoundReturnPct"] for x in vals),
        "bestCompoundReturnPct": max(x["compoundReturnPct"] for x in vals),
        "avgCompoundReturnPct": statistics.fmean(x["compoundReturnPct"] for x in vals),
        "latest": vals[-1],
    }



def shadow_hourly_bars(days):
    by_ts = {}
    for day in days:
        for b in day.get("bars") or []:
            t = str(b.get("tKst") or "")
            if len(t) < 13:
                continue
            key = t[:13]
            row = by_ts.get(key)
            if row is None:
                by_ts[key] = {
                    "tKst": key + ":00:00",
                    "o": float(b.get("o") or 0),
                    "h": float(b.get("h") or 0),
                    "l": float(b.get("l") or 0),
                    "c": float(b.get("c") or 0),
                }
            else:
                row["h"] = max(row["h"], float(b.get("h") or 0))
                row["l"] = min(row["l"], float(b.get("l") or 0))
                row["c"] = float(b.get("c") or 0)
    return [by_ts[k] for k in sorted(by_ts)]


def btc_24h_drop_shadow(days, cfg):
    bars = shadow_hourly_bars(days)
    p = cfg["params"]
    trades = []
    i = 24
    while i < len(bars) - 23:
        entry_date = bars[i]["tKst"][:10]
        try:
            prev_dt = datetime.fromisoformat(bars[i - 25]["tKst"])
            exit_dt = datetime.fromisoformat(bars[i + 23]["tKst"])
            entry_dt = datetime.fromisoformat(bars[i]["tKst"])
        except Exception:
            i += 1
            continue
        if (entry_dt - prev_dt).total_seconds() != 25 * 3600 or (exit_dt - entry_dt).total_seconds() != 23 * 3600:
            i += 1
            continue
        ref = float(bars[i - 25]["c"] or 0)
        prev = float(bars[i - 1]["c"] or 0)
        entry = float(bars[i]["o"] or 0)
        exit_px = float(bars[i + 23]["c"] or 0)
        if min(ref, prev, entry, exit_px) <= 0:
            i += 1
            continue
        drop = (prev / ref - 1.0) * 100.0
        if drop <= float(p["drop24hPctMax"]):
            gross = (exit_px / entry - 1.0) * 100.0
            net = gross - float(p["frictionPct"])
            trades.append({
                "date": entry_date,
                "strategyVersion": "btc_24h_drop_shadow_v1",
                "variant": cfg["name"],
                "signalTimeKst": bars[i - 1]["tKst"][11:16],
                "entryTimeKst": bars[i]["tKst"][11:16],
                "exitTimeKst": bars[i + 23]["tKst"][11:16],
                "entryPrice": entry,
                "exitPrice": exit_px,
                "drop24hPct": drop,
                "grossPnlPct": gross,
                "frictionPct": float(p["frictionPct"]),
                "pnlPct": net,
                "reason": "24h_time_exit",
                "evidence": {
                    "source": "Upbit public 5m OHLCV aggregated to completed 1h bars",
                    "evaluationScope": "all_available",
                    "drop24hPct": drop,
                    "requiredDropPctMax": p["drop24hPctMax"],
                    "holdHours": p["holdHours"],
                    "entryRule": "next completed 1h bar open",
                    "exitRule": "24h horizon close",
                },
            })
            i += int(p["holdHours"])
        else:
            i += 1
    eval_days = sorted({x["tKst"][:10] for x in bars})
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
            invalid.append({"date": d.get("sessionDateUtc"), "reason": reason})

    if not valid:
        print("No valid crypto archives yet.")
        return 0

    labels = [x["sessionDateUtc"] for x in valid]
    reports = []
    variant_trades = {}
    for p in VARIANTS:
        trades = [t for d in valid if (t := trade_for_day(d, p))]
        variant_trades[p.name] = trades
        reports.append({
            "params": asdict(p),
            "summary": summary(trades, labels),
            "validation": split_validation(valid, trades),
        })

    baseline = variant_trades["baseline"]
    report = {
        "schema": 2,
        "generatedAt": datetime.now(KST).isoformat(),
        "market": "KRW-BTC",
        "unitMinutes": 5,
        "source": "Upbit public minute candles",
        "from": labels[0],
        "to": labels[-1],
        "archiveDays": len(all_days),
        "validDays": len(valid),
        "invalidDays": invalid,
        "comparisonStatus": "reviewable" if len(valid) >= 90 else "collecting",
        "comparisonRule": "Research comparison only. No automatic strategy promotion or live order connection.",
        "auditRule": "Raw OHLCV + strategy version + observed signal features + thresholds + entry/exit reason are retained for reproducibility.",
        "executionModel": "signal on completed 5m candle; enter next candle open; same-candle stop/target conflict resolves to stop",
        "frictionModel": "0.10% round-trip fee + 0.04% round-trip slippage assumption",
        "variants": reports,
        "shadowStrategies": [btc_24h_drop_shadow(valid, cfg) for cfg in SHADOW_STRATEGIES],
        "rolling30": rolling_baseline(valid, baseline, 30),
        "latestTrades": baseline[-20:],
    }

    with (OUT / "latest.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with (OUT / "baseline-trades.csv").open("w", encoding="utf-8", newline="") as f:
        cols = [
            "date","strategyVersion","signalTimeKst","entryTimeKst","exitTimeKst","openingHigh","openingLow",
            "signalClose","signalVwap","volumeRatio","entryPrice","exitPrice","reason",
            "grossPnlPct","frictionPct","pnlPct",
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for x in baseline:
            w.writerow({k: x.get(k) for k in cols})

    with (OUT / f"{labels[-1]}.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # One row per session, including no-trade days. This is the compact audit
    # trail for "why did the strategy trade / not trade on that date?" Raw bars
    # remain the source of truth and allow the exact decision to be reconstructed.
    by_date = {x["date"]: x for x in baseline}
    with (OUT / "baseline-decisions.csv").open("w", encoding="utf-8", newline="") as f:
        cols = [
            "date","strategyVersion","action","decisionReason","signalTimeKst","entryTimeKst","exitTimeKst",
            "openingHigh","openingLow","signalClose","signalVwap","volumeRatio",
            "entryPrice","exitPrice","exitReason","pnlPct"
        ]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for d in labels:
            t = by_date.get(d)
            if t:
                w.writerow({
                    "date":d,"strategyVersion":t.get("strategyVersion"),"action":"trade",
                    "decisionReason":"fresh_breakout+volume+vwap_pass",
                    "signalTimeKst":t.get("signalTimeKst"),"entryTimeKst":t.get("entryTimeKst"),
                    "exitTimeKst":t.get("exitTimeKst"),"openingHigh":t.get("openingHigh"),
                    "openingLow":t.get("openingLow"),"signalClose":t.get("signalClose"),
                    "signalVwap":t.get("signalVwap"),"volumeRatio":t.get("volumeRatio"),
                    "entryPrice":t.get("entryPrice"),"exitPrice":t.get("exitPrice"),
                    "exitReason":t.get("reason"),"pnlPct":t.get("pnlPct"),
                })
            else:
                w.writerow({
                    "date":d,"strategyVersion":"btc_orb_v1","action":"no_trade",
                    "decisionReason":"no_qualified_breakout_before_cutoff_after_volume_vwap_filters",
                })

    base = next(x for x in reports if x["params"]["name"] == "baseline")
    print(json.dumps({
        "days": len(valid),
        "from": labels[0],
        "to": labels[-1],
        "baseline": base["summary"],
        "holdout": base["validation"]["holdout"],
        "rolling30": report["rolling30"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
