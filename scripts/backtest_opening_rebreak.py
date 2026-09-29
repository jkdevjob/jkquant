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
    Params("today_combo_v1", pb_max=0.5, amount_mult=1.5, entry_cutoff=915),
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
        close = float(b.get("c") or 0)
        x = {
            "hm": hm(b.get("t")),
            "o": float(b.get("o") or close or 0),
            "h": float(b.get("h") or close or 0),
            "l": float(b.get("l") or close or 0),
            "c": close,
            "v": float(b.get("v") or 0),
            # 현재 실시간 서버의 Naver 1분 데이터는 O/H/L이 없어
            # 돌파/전고점 판정에 분봉 종가를 사용한다. 장기 백테스트도
            # 기준전략 비교만큼은 같은 관측정보(close-only)로 맞춘다.
            "signal_h": close,
        }
        if 900 <= x["hm"] <= 1000 and x["c"] > 0:
            a.append(x)
    a.sort(key=lambda x: x["hm"])
    return a


def opening_time_bucket(h):
    if h <= 910: return "09:03~09:10"
    if h <= 920: return "09:11~09:20"
    return "09:21~09:30"


def hm_to_minute(h):
    return (int(h) // 100) * 60 + (int(h) % 100)


def opening_gap_bucket(v):
    if v < 3: return "2~3%"
    if v < 4: return "3~4%"
    if v < 5: return "4~5%"
    return "5~7%"


def opening_pullback_bucket(v):
    if v <= 0.5: return "0.3~0.5%"
    if v <= 0.7: return "0.5~0.7%"
    return "0.7~1.0%"


def opening_ratio_bucket(v, kind):
    if kind == "amount":
        if v < 1.5: return "1.2~1.5x"
        if v < 2.0: return "1.5~2.0x"
        return "2.0x+"
    if v < 1.5: return "1.0~1.5x"
    if v < 2.0: return "1.5~2.0x"
    return "2.0x+"


def opening_rank_bucket(v):
    if v <= 20: return "Top1~20"
    if v <= 50: return "Top21~50"
    return "Top51~100"


def opening_path_metrics(a, entry_i, entry):
    """Label the observed path for 30 minutes after the signal.

    Signal decisions stay close-only for live parity. Outcome labels use archived
    KIS 1-minute high/low for excursion/threshold touches and close for forward marks.
    A threshold hit time is minute-level; if both sides are touched inside one minute,
    this dataset cannot infer which came first.
    """
    if entry <= 0 or entry_i >= len(a):
        return {}
    entry_min = hm_to_minute(a[entry_i]["hm"])
    # Entry is the signal minute close. Intrabar high/low from that same minute
    # happened before the entry, so outcome excursions start from the next bar.
    post = [z for z in a[entry_i + 1:] if 0 < hm_to_minute(z["hm"]) - entry_min <= 30]
    if not post:
        return {
            "outcomeWindowMin":30,
            "outcomeObservedMin":0,
            "outcomeWindowComplete":False,
            "outcomePriceModel":"KIS 1m high/low threshold + close forward mark",
        }

    observed=max(hm_to_minute(z["hm"]) - entry_min for z in post)
    complete=observed>=30
    best=max(post,key=lambda z:z["h"] if z["h"]>0 else z["c"])
    worst=min(post,key=lambda z:z["l"] if z["l"]>0 else z["c"])
    best_px=best["h"] if best["h"]>0 else best["c"]
    worst_px=worst["l"] if worst["l"]>0 else worst["c"]
    out={
        "outcomeWindowMin":30,
        "outcomeObservedMin":min(30,observed),
        "outcomeWindowComplete":complete,
        "outcomePriceModel":"KIS 1m high/low threshold + close forward mark",
        "mfePct":(best_px/entry-1)*100,
        "mfeTime":best["hm"],
        "maePct":(worst_px/entry-1)*100,
        "maeTime":worst["hm"],
        "hitPlus1Time":None,
        "hitPlus2Time":None,
        "hitMinus1Time":None,
        "hitMinus2Time":None,
    }

    for z in post:
        high=z["h"] if z["h"]>0 else z["c"]
        low=z["l"] if z["l"]>0 else z["c"]
        if out["hitPlus1Time"] is None and (high/entry-1)*100 >= 1.0: out["hitPlus1Time"]=z["hm"]
        if out["hitPlus2Time"] is None and (high/entry-1)*100 >= 2.0: out["hitPlus2Time"]=z["hm"]
        if out["hitMinus1Time"] is None and (low/entry-1)*100 <= -1.0: out["hitMinus1Time"]=z["hm"]
        if out["hitMinus2Time"] is None and (low/entry-1)*100 <= -2.0: out["hitMinus2Time"]=z["hm"]

    for n in (1,3,5,10,20,30):
        target=entry_min+n
        z=next((q for q in post if hm_to_minute(q["hm"]) >= target), None)
        out[f"fwd{n}mPct"]=((z["c"]/entry-1)*100) if z else None
    return out


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

    first_high = max(x["signal_h"] for x in a[:p.obs])
    bi = -1
    for i in range(p.obs, len(a) - 2):
        x = a[i]
        if x["hm"] > p.entry_cutoff:
            break
        if x["signal_h"] > first_high and x["c"] >= day_open and (x["c"] / day_open - 1) * 100 >= p.min_rise:
            bi = i
            break
    if bi < 0:
        return None

    peak = a[bi]["signal_h"]
    peak_i = bi
    for i in range(bi + 1, len(a) - 1):
        x = a[i]
        if x["signal_h"] > peak:
            peak = x["signal_h"]
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
                path = opening_path_metrics(a, j, entry)
                exit_px = None
                exit_hm = None
                reason = None
                for z in a[j + 1 :]:
                    if z["hm"] > p.final_exit:
                        break
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
                    "signalSchemaVersion": 2,
                    "strategyVersion": "opening_rebreak_v1",
                    "strategyParams": asdict(p),
                    "rank": int(row.get("rank") or 0),
                    "code": row.get("code"),
                    "name": row.get("name"),
                    "gap": gap,
                    "gapEstimated": estimated_gap,
                    "firstHigh": first_high,
                    "peak": peak,
                    "pullbackPct": dd,
                    "entryTime": y["hm"],
                    "entryPrice": entry,
                    "volRatio": vol_ratio,
                    "amountRatio": amt_ratio,
                    "decisionReason": "gap+first_breakout+pullback+rebreak+volume+amount_pass",
                    "evidence": {
                        "gapPct": gap, "gapMin": p.gap_min, "gapMax": p.gap_max,
                        "firstHigh": first_high, "peak": peak,
                        "pullbackPct": dd, "pullbackMin": p.pb_min, "pullbackMax": p.pb_max,
                        "rebreakClose": y["c"],
                        "volumeRatio": vol_ratio, "requiredVolumeRatio": p.vol_mult,
                        "amountRatio": amt_ratio, "requiredAmountRatio": p.amount_mult,
                        "entryCutoff": p.entry_cutoff,
                        "stopPct": p.stop, "takeProfitPct": p.take_profit,
                        "frictionPct": p.fee, "finalExit": p.final_exit,
                    },
                    "timeBucket": opening_time_bucket(y["hm"]),
                    "gapBucket": opening_gap_bucket(gap),
                    "pullbackBucket": opening_pullback_bucket(dd),
                    "volumeBucket": opening_ratio_bucket(vol_ratio, "volume"),
                    "amountBucket": opening_ratio_bucket(amt_ratio, "amount"),
                    "rankBucket": opening_rank_bucket(int(row.get("rank") or 0)),
                    **path,
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
    avg=statistics.fmean(pnls) if pnls else 0.0
    return {
        "days": len(days),
        "trades": len(trades),
        "winRate": (len(wins) / len(pnls) * 100) if pnls else 0.0,
        "avgWin": statistics.fmean(wins) if wins else 0.0,
        "avgLoss": statistics.fmean(losses) if losses else 0.0,
        "avgPnl": avg,
        "expectancyPct": avg,
        "medianPnl": statistics.median(pnls) if pnls else 0.0,
        "sumPnl": sum(pnls),
        "profitFactor": (gp / gl) if gl > 0 else (999.0 if gp > 0 else 0.0),
        "maxDrawdownSimple": mdd,
        "tradesPerDay": (len(trades) / len(days)) if days else 0.0,
        "estimatedGapTrades": sum(1 for x in trades if x.get("gapEstimated")),
    }


def opening_group_stats(trades, key):
    groups={}
    for x in trades:
        groups.setdefault(str(x.get(key) or "unknown"),[]).append(x)
    out=[]
    for name,rows in sorted(groups.items()):
        pn=[x["pnl"] for x in rows]
        wins=[v for v in pn if v>0]
        losses=[v for v in pn if v<0]
        complete=[x for x in rows if x.get("outcomeWindowComplete")]
        mf=[x["mfePct"] for x in complete if x.get("mfePct") is not None]
        ma=[x["maePct"] for x in complete if x.get("maePct") is not None]
        out.append({
            "group":name,"trades":len(rows),
            "winRate":sum(1 for v in pn if v>0)/len(pn)*100 if pn else 0,
            "avgWin":statistics.fmean(wins) if wins else 0,
            "avgLoss":statistics.fmean(losses) if losses else 0,
            "avgPnl":statistics.fmean(pn) if pn else 0,
            "expectancyPct":statistics.fmean(pn) if pn else 0,
            "avgMfe":statistics.fmean(mf) if mf else None,
            "avgMae":statistics.fmean(ma) if ma else None,
            "pathComplete":len(complete),
            "plus1HitRate":sum(1 for x in complete if x.get("hitPlus1Time") is not None)/len(complete)*100 if complete else 0,
            "plus2HitRate":sum(1 for x in complete if x.get("hitPlus2Time") is not None)/len(complete)*100 if complete else 0,
            "minus1HitRate":sum(1 for x in complete if x.get("hitMinus1Time") is not None)/len(complete)*100 if complete else 0,
            "minus2HitRate":sum(1 for x in complete if x.get("hitMinus2Time") is not None)/len(complete)*100 if complete else 0,
        })
    return out


def opening_diagnostics(trades):
    path={}
    for n in (5,10,20,30):
        k=f"fwd{n}mPct"; vals=[x[k] for x in trades if x.get(k) is not None]
        path[k]={"n":len(vals),"avg":statistics.fmean(vals) if vals else None,
                 "median":statistics.median(vals) if vals else None}
    complete=[x for x in trades if x.get("outcomeWindowComplete")]
    mf=[x["mfePct"] for x in complete if x.get("mfePct") is not None]
    ma=[x["maePct"] for x in complete if x.get("maePct") is not None]
    n=len(complete)
    threshold={
        "plus1":{"hits":sum(1 for x in complete if x.get("hitPlus1Time") is not None)},
        "plus2":{"hits":sum(1 for x in complete if x.get("hitPlus2Time") is not None)},
        "minus1":{"hits":sum(1 for x in complete if x.get("hitMinus1Time") is not None)},
        "minus2":{"hits":sum(1 for x in complete if x.get("hitMinus2Time") is not None)},
    }
    for z in threshold.values():
        z["ratePct"]=z["hits"]/n*100 if n else 0.0
        z["total"]=n
    return {
        "timeBuckets":opening_group_stats(trades,"timeBucket"),
        "conditionGroups":{
            "entryTime":opening_group_stats(trades,"timeBucket"),
            "gap":opening_group_stats(trades,"gapBucket"),
            "pullback":opening_group_stats(trades,"pullbackBucket"),
            "volumeRatio":opening_group_stats(trades,"volumeBucket"),
            "amountRatio":opening_group_stats(trades,"amountBucket"),
            "rank":opening_group_stats(trades,"rankBucket"),
            "strategyVersion":opening_group_stats(trades,"strategyVersion"),
        },
        "forwardPath":path,
        "thresholdHits":threshold,
        "avgMfe":statistics.fmean(mf) if mf else None,
        "avgMae":statistics.fmean(ma) if ma else None,
        "outcomeWindowMin":30,
        "pathCompleteTrades":len(complete),
        "outcomeModel":"KIS 1m high/low from the bar after entry for MFE/MAE/threshold; close for 5/10/20/30m marks",
    }


def trades_for_days(days, p: Params):
    out = []
    for day in days:
        for row in day.get("universe") or []:
            t = one_trade(day, row, p)
            if t:
                out.append(t)
    return out


def walk_forward(days, variant_trade_map):
    """Chronological 20d train -> 5d test walk-forward.

    No variant is auto-promoted. This only reports out-of-sample behavior.
    Test windows are non-overlapping because step=5.
    """
    train_days = 20
    test_days = 5
    step_days = 5
    labels = [x["date"] for x in days]

    if len(labels) < train_days + test_days:
        return {
            "status": "collecting",
            "trainDays": train_days,
            "testDays": test_days,
            "stepDays": step_days,
            "archiveDays": len(labels),
            "daysNeededForFirstFold": train_days + test_days,
            "folds": [],
            "oosVariants": [],
            "note": "Need at least 25 trading days for the first chronological out-of-sample fold.",
        }

    folds = []
    oos_by_variant = {p.name: [] for p in VARIANTS}

    for start in range(0, len(labels) - train_days - test_days + 1, step_days):
        train_dates = labels[start : start + train_days]
        test_dates = labels[start + train_days : start + train_days + test_days]
        train_set = set(train_dates)
        test_set = set(test_dates)

        fv = []
        for p in VARIANTS:
            all_trades = variant_trade_map.get(p.name, [])
            train_trades = [x for x in all_trades if x["date"] in train_set]
            test_trades = [x for x in all_trades if x["date"] in test_set]
            oos_by_variant[p.name].extend(test_trades)
            fv.append({
                "name": p.name,
                "train": summary(train_trades, train_dates),
                "test": summary(test_trades, test_dates),
            })

        folds.append({
            "fold": len(folds) + 1,
            "trainFrom": train_dates[0],
            "trainTo": train_dates[-1],
            "testFrom": test_dates[0],
            "testTo": test_dates[-1],
            "variants": fv,
        })

    oos = []
    oos_days = []
    for fold in folds:
        oos_days.extend([
            d for d in labels
            if fold["testFrom"] <= d <= fold["testTo"]
        ])
    oos_days = sorted(set(oos_days))

    for p in VARIANTS:
        oos.append({
            "name": p.name,
            "summary": summary(oos_by_variant[p.name], oos_days),
        })

    return {
        "status": "reviewable" if len(folds) >= 3 else "early",
        "trainDays": train_days,
        "testDays": test_days,
        "stepDays": step_days,
        "archiveDays": len(labels),
        "foldCount": len(folds),
        "oosDays": len(oos_days),
        "folds": folds,
        "oosVariants": oos,
        "note": "Out-of-sample only. No strategy is automatically promoted from this result.",
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
    variant_trade_map = {}

    for p in VARIANTS:
        trades = trades_for_days(days, p)
        variant_trade_map[p.name] = trades
        s = summary(trades, day_labels)
        reports.append({"params": asdict(p), "summary": s})
        if p.name == "baseline":
            baseline = trades

    wf = walk_forward(days, variant_trade_map)
    enough = len(days) >= 20 and len(baseline) >= 30
    report = {
        "schema": 5,
        "generatedAt": datetime.now(KST).isoformat(),
        "from": day_labels[0],
        "to": day_labels[-1],
        "archiveDays": len(days),
        "baselineTradeCount": len(baseline),
        "comparisonStatus": "eligible" if enough else "collecting",
        "comparisonRule": "Variant comparison is treated as preliminary until >=20 trading days and >=30 baseline trades.",
        "signalModel": "live-parity-close-only",
        "signalModelNote": "Signal decisions use 1-minute close to match the live Naver feed. Outcome labels use archived KIS OHLC for 30-minute path diagnostics without changing the strategy exit rule.",
        "variants": reports,
        "diagnostics": opening_diagnostics(baseline),
        "walkForward": wf,
    }

    with (OUT / "latest.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    with (OUT / "baseline-trades.csv").open("w", encoding="utf-8", newline="") as f:
        cols = ["date","signalSchemaVersion","strategyVersion","variant","rank","rankBucket","code","name",
                "gap","gapEstimated","gapBucket","pullbackPct","pullbackBucket","entryTime","entryPrice",
                "volRatio","volumeBucket","amountRatio","amountBucket","timeBucket",
                "mfePct","mfeTime","maePct","maeTime",
                "hitPlus1Time","hitPlus2Time","hitMinus1Time","hitMinus2Time",
                "fwd5mPct","fwd10mPct","fwd20mPct","fwd30mPct",
                "exitTime","exitPrice","reason","pnl"]
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for x in baseline:
            w.writerow({k: x.get(k) for k in cols})

    # Compact per-signal outcome archive used to join the exact live alert ledger.
    # Strategy changes never rewrite the signal's strategyVersion/params; the join key
    # also includes variant/date/code/entryTime so a later rule cannot silently replace it.
    outcome_rows = []
    for variant_name, trades in variant_trade_map.items():
        for x in trades:
            outcome_rows.append({
                "variant": variant_name,
                "date": x.get("date"),
                "code": x.get("code"),
                "name": x.get("name"),
                "entryTime": x.get("entryTime"),
                "entryPrice": x.get("entryPrice"),
                "strategyVersion": x.get("strategyVersion"),
                "signalSchemaVersion": x.get("signalSchemaVersion"),
                "strategyParams": x.get("strategyParams"),
                "gap": x.get("gap"),
                "pullbackPct": x.get("pullbackPct"),
                "volRatio": x.get("volRatio"),
                "amountRatio": x.get("amountRatio"),
                "rank": x.get("rank"),
                "timeBucket": x.get("timeBucket"),
                "gapBucket": x.get("gapBucket"),
                "pullbackBucket": x.get("pullbackBucket"),
                "volumeBucket": x.get("volumeBucket"),
                "amountBucket": x.get("amountBucket"),
                "rankBucket": x.get("rankBucket"),
                "outcomeObservedMin": x.get("outcomeObservedMin"),
                "outcomeWindowComplete": x.get("outcomeWindowComplete"),
                "mfePct": x.get("mfePct"),
                "mfeTime": x.get("mfeTime"),
                "maePct": x.get("maePct"),
                "maeTime": x.get("maeTime"),
                "hitPlus1Time": x.get("hitPlus1Time"),
                "hitPlus2Time": x.get("hitPlus2Time"),
                "hitMinus1Time": x.get("hitMinus1Time"),
                "hitMinus2Time": x.get("hitMinus2Time"),
                "fwd5mPct": x.get("fwd5mPct"),
                "fwd10mPct": x.get("fwd10mPct"),
                "fwd20mPct": x.get("fwd20mPct"),
                "fwd30mPct": x.get("fwd30mPct"),
                "exitTime": x.get("exitTime"),
                "exitPrice": x.get("exitPrice"),
                "reason": x.get("reason"),
                "pnl": x.get("pnl"),
            })
    outcome_rows.sort(key=lambda x: (x["date"] or "", x["variant"] or "", x["entryTime"] or 0, x["code"] or ""))
    with (OUT / "signal-outcomes.json").open("w", encoding="utf-8") as f:
        json.dump({
            "schema": 1,
            "generatedAt": report["generatedAt"],
            "from": day_labels[0],
            "to": day_labels[-1],
            "records": outcome_rows,
        }, f, ensure_ascii=False, separators=(",", ":"))

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
        "walkForwardStatus": wf["status"],
        "walkForwardFolds": wf.get("foldCount", 0),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
