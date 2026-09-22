#!/usr/bin/env python3
"""Cumulative research backtest for the opening pullback→rebreak strategy.

Reads immutable daily Top-N minute archives from data/scalping/YYYY/*.json.gz.
The archive stores each day's actual universe rank, so Top50 vs Top100 can be
replayed without using today's membership (reduces survivor/ranking leakage).

This is research/paper logic only. It does not place orders.
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
DATA = Path("data/scalping")
OUT = Path("data/opening-research")


@dataclass(frozen=True)
class Params:
    name: str
    top_n: int = 100
    gap_min: float = 2.0
    gap_max: float = 7.0
    obs: int = 3
    min_rise: float = 0.5
    pb_min: float = 0.3
    pb_max: float = 1.0
    vol_mult: float = 1.0
    amount_mult: float = 1.2
    entry_cutoff: int = 930
    stop: float = 1.0
    take_profit: float = 1.5
    final_exit: int = 930
    fee: float = 0.25


VARIANTS = [
    Params("baseline"),
    Params("top50", top_n=50),
    Params("pb_max_0.5", pb_max=0.5),
    Params("pb_max_0.7", pb_max=0.7),
    Params("amount_1.5", amount_mult=1.5),
    Params("amount_2.0", amount_mult=2.0),
    Params("entry_by_0915", entry_cutoff=915),
    Params("gap_2_5", gap_max=5.0),
    Params("gap_3_7", gap_min=3.0),
    Params("stop_0.8", stop=0.8),
    Params("tp_1.0", take_profit=1.0),
    Params("tp_2.0", take_profit=2.0),
]


def hm(t: str) -> int:
    s = str(t or "")
    if len(s) >= 6 and s[-6:].isdigit():
        return int(s[-6:-2])
    if len(s) >= 16 and s[11:13].isdigit():
        return int(s[11:13]) * 100 + int(s[14:16])
    return -1


def load_days():
    out = []
    for p in sorted(DATA.glob("*/*.json.gz")):
        try:
            with gzip.open(p, "rt", encoding="utf-8") as f:
                j = json.load(f)
            if j.get("date") and j.get("universe"):
                out.append(j)
        except Exception as e:
            print("skip", p, e)
    return out


def estimate_prev_close(row):
    """Older schema fallback only.

    v2+ stores prevClose exactly. v1 did not, so estimate it from end-of-day
    close and quoted daily percent change. Those rows are marked estimated.
    """
    pc = float(row.get("prevClose") or 0)
    if pc > 0:
        return pc, False
    close = float(row.get("close") or 0)
    chg = float(row.get("chg") or 0)
    den = 1.0 + chg / 100.0
    if close > 0 and abs(den) > 1e-9:
        return close / den, True
    return 0.0, True


def norm_bars(row):
    a = []
    for b in row.get("bars") or []:
        x = {
            "hm": hm(b.get("t")),
            "o": float(b.get("o") or b.get("c") or 0),
            "h": float(b.get("h") or b.get("c") or 0),
            "l": float(b.get("l") or b.get("c") or 0),
            "c": float(b.get("c") or 0),
            "v": float(b.get("v") or 0),
        }
        if 900 <= x["hm"] <= 930 and x["c"] > 0:
            a.append(x)
    a.sort(key=lambda x: x["hm"])
    return a


def one_trade(day, row, p: Params):
    if int(row.get("rank") or 999999) > p.top_n:
        return None
    a = norm_bars(row)
    if len(a) < p.obs + 3:
        return None

    prev_close, estimated_gap = estimate_prev_close(row)
    day_open = float(row.get("open") or 0) or a[0]["o"] or a[0]["c"]
    if not (day_open > 0 and prev_close > 0):
        return None
    gap = (day_open / prev_close - 1.0) * 100.0
    if gap < p.gap_min or gap > p.gap_max:
        return None

    first_high = max(x["h"] for x in a[:p.obs])
    bi = -1
    for i in range(p.obs, len(a) - 2):
        x = a[i]
        if x["hm"] > p.entry_cutoff:
            break
        if x["h"] > first_high and x["c"] >= day_open and (x["c"] / day_open - 1) * 100 >= p.min_rise:
            bi = i
            break
    if bi < 0:
        return None

    peak = a[bi]["h"]
    peak_i = bi
    for i in range(bi + 1, len(a) - 1):
        x = a[i]
        if x["h"] > peak:
            peak = x["h"]
            peak_i = i
            continue
        dd = (peak - x["c"]) / peak * 100
        if dd < p.pb_min or dd > p.pb_max or x["c"] < day_open:
            continue

        pull = a[peak_i + 1 : i + 1]
        if not pull:
            continue
        base_vol = sum(y["v"] for y in pull) / len(pull)
        base_amt = sum(y["c"] * y["v"] for y in pull) / len(pull)

        for j in range(i + 1, len(a)):
            y = a[j]
            if y["hm"] > p.entry_cutoff:
                break
            vol_ratio = y["v"] / max(1.0, base_vol)
            amt_ratio = (y["c"] * y["v"]) / max(1.0, base_amt)
            if y["c"] > peak and vol_ratio >= p.vol_mult and amt_ratio >= p.amount_mult:
                entry = y["c"]
                exit_px = None
                exit_hm = None
                reason = None
                for z in a[j + 1 :]:
                    r = (z["c"] / entry - 1) * 100
                    if r <= -p.stop:
                        exit_px, exit_hm, reason = z["c"], z["hm"], "stop"
                        break
                    if r >= p.take_profit:
                        exit_px, exit_hm, reason = z["c"], z["hm"], "take_profit"
                        break
                if exit_px is None:
                    z = max((q for q in a if q["hm"] <= p.final_exit), key=lambda q: q["hm"], default=a[-1])
                    exit_px, exit_hm, reason = z["c"], z["hm"], "time_exit"
                pnl = (exit_px / entry - 1) * 100 - p.fee
                return {
                    "date": day["date"],
                    "rank": int(row.get("rank") or 0),
                    "code": row.get("code"),
                    "name": row.get("name"),
                    "gap": gap,
                    "gapEstimated": estimated_gap,
                    "pullbackPct": dd,
                    "entryTime": y["hm"],
                    "entryPrice": entry,
                    "volRatio": vol_ratio,
                    "amountRatio": amt_ratio,
                    "exitTime": exit_hm,
                    "exitPrice": exit_px,
                    "reason": reason,
                    "pnl": pnl,
                    "variant": p.name,
                }
        break
    return None


def summary(trades, days):
    pnls = [x["pnl"] for x in trades]
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    eq = peak = mdd = 0.0
    for x in sorted(trades, key=lambda z: (z["date"], z["entryTime"], z["code"] or "")):
        eq += x["pnl"]
        peak = max(peak, eq)
        mdd = min(mdd, eq - peak)
    gp = sum(wins)
    gl = -sum(losses)
    return {
        "days": len(days),
        "trades": len(trades),
        "winRate": (len(wins) / len(pnls) * 100) if pnls else 0.0,
        "avgPnl": statistics.fmean(pnls) if pnls else 0.0,
        "medianPnl": statistics.median(pnls) if pnls else 0.0,
        "sumPnl": sum(pnls),
        "profitFactor": (gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "maxDrawdownSimple": mdd,
        "tradesPerDay": (len(trades) / len(days)) if days else 0.0,
        "estimatedGapTrades": sum(1 for x in trades if x.get("gapEstimated")),
    }


def main():
    days = load_days()
    OUT.mkdir(parents=True, exist_ok=True)
    if not days:
        print("No daily scalping archives yet.")
        return 0

    reports = []
    baseline = []
    day_labels = [x["date"] for x in days]

    for p in VARIANTS:
        trades = []
        for day in days:
            for row in day.get("universe") or []:
                t = one_trade(day, row, p)
                if t:
                    trades.append(t)
        s = summary(trades, day_labels)
        reports.append({"params": asdict(p), "summary": s})
        if p.name == "baseline":
            baseline = trades

    enough = len(days) >= 20 and len(baseline) >= 30
    report = {
        "schema": 1,
        "generatedAt": datetime.now(KST).isoformat(),
        "from": day_labels[0],
        "to": day_labels[-1],
        "archiveDays": len(days),
        "baselineTradeCount": len(baseline),
        "comparisonStatus": "eligible" if enough else "collecting",
        "comparisonRule": "Variant comparison is treated as preliminary until >=20 trading days and >=30 baseline trades.",
        "variants": reports,
    }

    with (OUT / "latest.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with (OUT / "baseline-trades.csv").open("w", encoding="utf-8", newline="") as f:
        cols = ["date","rank","code","name","gap","gapEstimated","pullbackPct","entryTime","entryPrice","volRatio","amountRatio","exitTime","exitPrice","reason","pnl"]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for x in baseline:
            w.writerow({k: x.get(k) for k in cols})

    stamp = day_labels[-1]
    with (OUT / f"{stamp}.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    base = next(x for x in reports if x["params"]["name"] == "baseline")
    print(json.dumps({
        "days": len(days),
        "from": day_labels[0],
        "to": day_labels[-1],
        "baseline": base["summary"],
        "comparisonStatus": report["comparisonStatus"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
