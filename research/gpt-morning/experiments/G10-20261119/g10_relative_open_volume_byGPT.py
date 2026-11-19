#!/usr/bin/env python3
"""G10 preregistered early-session relative-volume filter."""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import statistics
import sys
from pathlib import Path


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def metrics(rows, stress=0.0):
    daily, trades = [], []
    equity = peak = 1.0
    mdd = 0.0
    for row in rows:
        pnl = row["pnl"] - (stress if row["trade"] else 0.0)
        daily.append(pnl)
        if row["trade"]:
            trades.append(pnl)
        equity *= max(1e-12, 1 + pnl / 100)
        peak = max(peak, equity)
        mdd = min(mdd, (equity / peak - 1) * 100)
    wins = [x for x in trades if x > 0]
    losses = [x for x in trades if x < 0]
    return {
        "days": len(rows), "trades": len(trades),
        "winRatePct": len(wins) / len(trades) * 100 if trades else 0.0,
        "avgTradePct": statistics.fmean(trades) if trades else 0.0,
        "avgDailyPct": statistics.fmean(daily) if daily else 0.0,
        "compoundPct": (equity - 1) * 100,
        "profitFactor": sum(wins) / abs(sum(losses)) if losses else (999.0 if wins else 0.0),
        "mddPct": mdd, "worstDayPct": min(daily) if daily else 0.0,
        "plus1Days": sum(x >= 1.0 for x in daily),
    }


def segment(rows):
    n = len(rows)
    cuts = [0, n // 3, 2 * n // 3, n]
    return [metrics(rows[cuts[i]:cuts[i + 1]]) for i in range(3)]


def filtered_rows(baseline_by_date, early_volume, threshold):
    rows, history, excluded = [], [], []
    for date in sorted(early_volume):
        volume = early_volume[date]
        if volume <= 0:
            excluded.append({"date": date, "reason": "nonpositive_early_volume"})
            continue
        if len(history) < 14:
            history.append(volume)
            continue
        reference = statistics.fmean(history[-14:])
        ratio = volume / reference if reference > 0 else 0.0
        trade = baseline_by_date.get(date)
        passed = ratio >= threshold
        rows.append({
            "date": date, "earlyVolume": volume, "prior14Mean": reference,
            "relativeVolume": ratio, "trade": bool(trade) and passed,
            "baselineTrade": bool(trade),
            "pnl": float(trade["pnlPct"]) if trade and passed else 0.0,
            "baselinePnl": float(trade["pnlPct"]) if trade else 0.0,
            "entry": trade.get("entryPrice") if trade else None,
            "exit": trade.get("exitPrice") if trade else None,
        })
        history.append(volume)
    return rows, excluded


def baseline_rows(rows):
    return [{**row, "trade": row["baselineTrade"], "pnl": row["baselinePnl"]} for row in rows]


def btc_walk_forward(rows):
    folds, start = [], 120
    while start < len(rows):
        stop = min(start + 30, len(rows))
        if stop - start < 20:
            break
        train, base_train = rows[:start], baseline_rows(rows[:start])
        cm, bm = metrics(train), metrics(base_train)
        select = (cm["trades"] >= 20 and cm["avgTradePct"] > 0 and
                  cm["profitFactor"] >= 1.10 and cm["avgDailyPct"] > bm["avgDailyPct"])
        test = rows[start:stop] if select else baseline_rows(rows[start:stop])
        folds.append({
            "trainThrough": rows[start - 1]["date"], "testFrom": rows[start]["date"],
            "testTo": rows[stop - 1]["date"], "selected": "candidate" if select else "baseline",
            "trainBaseline": bm, "trainCandidate": cm, "test": metrics(test),
        })
        start += 30
    return folds


def integer_account(rows, capital):
    equity = peak = float(capital)
    mdd, daily = 0.0, []
    for row in rows:
        pnl_cash = 0.0
        if row["trade"] and row["entry"]:
            qty = math.floor(equity / float(row["entry"]))
            pnl_cash = qty * float(row["entry"]) * float(row["pnl"]) / 100
        pnl_pct = pnl_cash / equity * 100 if equity else 0.0
        daily.append(pnl_pct)
        equity += pnl_cash
        peak = max(peak, equity)
        mdd = min(mdd, (equity / peak - 1) * 100)
    return {"initial": capital, "ending": equity, "compoundPct": (equity / capital - 1) * 100,
            "mddPct": mdd, "worstDayPct": min(daily) if daily else 0.0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--main-root", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    main_root, data_root = Path(args.main_root).resolve(), Path(args.data_root).resolve()
    sys.path.insert(0, str(main_root / "scripts"))
    crypto = load_module("g10_crypto_engine", main_root / "scripts/backtest_crypto_orb.py")
    soxl = load_module("g10_soxl_engine", main_root / "scripts/backtest_soxl_intraday.py")
    crypto.DATA = data_root / "data/crypto/KRW-BTC/5m"
    soxl.DATA = data_root / "data/soxl/SOXL/5m"

    btc_days = [x for x in crypto.load_days()
                if crypto.valid_day(x)[0] and x["sessionDateKst"] <= "2026-11-18"]
    btc_p = crypto.Params("baseline_g10", fee_round_trip_pct=0.10, slippage_round_trip_pct=0.04)
    btc_trades, btc_vol = {}, {}
    for day in btc_days:
        date = day["sessionDateKst"]
        bars = sorted(day["bars"], key=lambda x: x.get("tUtc") or "")
        btc_vol[date] = float(bars[0].get("v") or 0)
        trade = crypto.trade_for_day(day, btc_p)
        if trade:
            btc_trades[date] = trade

    soxl_days = [x for x in soxl.load_days()
                 if soxl.valid_day(x)[0] and x["sessionDateEt"] <= "2026-11-18"]
    soxl_p = soxl.Params("baseline_g10", friction_pct=0.20)
    soxl_trades, soxl_vol = {}, {}
    for day in soxl_days:
        date = day["sessionDateEt"]
        bars = sorted(day["bars"], key=lambda x: x.get("tEt") or "")
        soxl_vol[date] = sum(float(x.get("v") or 0) for x in bars[:3])
        trade, _ = soxl.evaluate_day(day, soxl_p)
        if trade:
            soxl_trades[date] = trade

    result = {
        "schema": 1, "experiment": "G10-20261119",
        "cutoff": {"btcKst": "2026-11-18", "soxlEt": "2026-11-18"},
        "costsPct": {"btc": 0.14, "soxl": 0.20, "stressAdd": 0.10},
        "btc": {"validSessions": len(btc_days), "baselineTradesBeforeWarmup": len(btc_trades)},
        "soxl": {"validSessions": len(soxl_days), "baselineTradesBeforeWarmup": len(soxl_trades)},
    }
    for name, vols, trades in [("btc", btc_vol, btc_trades), ("soxl", soxl_vol, soxl_trades)]:
        block = result[name]
        for threshold in [1.25, 1.50, 1.75]:
            rows, excluded = filtered_rows(trades, vols, threshold)
            base = baseline_rows(rows)
            item = {
                "threshold": threshold,
                "evaluationFrom": rows[0]["date"] if rows else None,
                "evaluationTo": rows[-1]["date"] if rows else None,
                "baseline": metrics(base), "candidate": metrics(rows),
                "candidateStress": metrics(rows, stress=0.10),
                "segments": segment(rows), "excluded": excluded, "rows": rows,
            }
            if name == "btc":
                item["walkForward"] = btc_walk_forward(rows)
                post = [x for x in rows if x["date"] >= "2026-10-01"]
                item["post20261001"] = {"baseline": metrics(baseline_rows(post)),
                                         "candidate": metrics(post)}
            else:
                item["formalWalkForwardReady"] = len(rows) >= 40
                item["integerAccounts"] = {"10000": integer_account(rows, 10000),
                                            "100000": integer_account(rows, 100000)}
            block[f"rv{threshold:.2f}"] = item

    for name, path in [("btc", data_root / "data/crypto-research/latest.json"),
                       ("soxl", data_root / "data/soxl-research/latest.json")]:
        latest = json.loads(path.read_text(encoding="utf-8"))
        baseline = next(x for x in latest["variants"] if x["params"]["name"] == "baseline")
        result[name]["canonicalLatest"] = baseline["summary"]

    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "btc": {"validSessions": result["btc"]["validSessions"],
                "baselineTrades": result["btc"]["baselineTradesBeforeWarmup"],
                "rv1.50": {k: v for k, v in result["btc"]["rv1.50"].items() if k != "rows"}},
        "soxl": {"validSessions": result["soxl"]["validSessions"],
                 "baselineTrades": result["soxl"]["baselineTradesBeforeWarmup"],
                 "rv1.50": {k: v for k, v in result["soxl"]["rv1.50"].items() if k != "rows"}},
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
