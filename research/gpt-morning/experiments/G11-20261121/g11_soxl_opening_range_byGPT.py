#!/usr/bin/env python3
"""G11 preregistered SOXL 30/10 opening-range validation."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import statistics
import sys
from pathlib import Path


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("g11_soxl_engine", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def metrics(rows, labels, stress_add=0.0):
    by_date = {x["date"]: x for x in rows}
    daily, trades = [], []
    equity = peak = 1.0
    mdd = 0.0
    for date in labels:
        row = by_date.get(date)
        pnl = float(row["pnlPct"]) - stress_add if row else 0.0
        daily.append(pnl)
        if row:
            trades.append(pnl)
        equity *= max(1e-12, 1 + pnl / 100)
        peak = max(peak, equity)
        mdd = min(mdd, (equity / peak - 1) * 100)
    wins = [x for x in trades if x > 0]
    losses = [x for x in trades if x < 0]
    return {
        "days": len(labels),
        "trades": len(trades),
        "avgTradePct": statistics.fmean(trades) if trades else 0.0,
        "avgDailyPct": statistics.fmean(daily) if daily else 0.0,
        "compoundPct": (equity - 1) * 100,
        "profitFactor": sum(wins) / abs(sum(losses)) if losses else (999.0 if wins else 0.0),
        "mddPct": mdd,
        "worstDayPct": min(daily) if daily else 0.0,
        "plus1Days": sum(x >= 1.0 for x in daily),
        "winRatePct": len(wins) / len(trades) * 100 if trades else 0.0,
    }


def integer_account(rows, labels, capital, stress_add=0.0):
    by_date = {x["date"]: x for x in rows}
    equity = peak = float(capital)
    mdd = 0.0
    daily = []
    for date in labels:
        row = by_date.get(date)
        pnl_cash = 0.0
        if row:
            entry = float(row["entryPrice"])
            qty = math.floor(equity / entry)
            pnl_pct = float(row["pnlPct"]) - stress_add
            pnl_cash = qty * entry * pnl_pct / 100
        before = equity
        equity += pnl_cash
        daily.append(pnl_cash / before * 100 if before else 0.0)
        peak = max(peak, equity)
        mdd = min(mdd, (equity / peak - 1) * 100)
    return {
        "initial": capital,
        "ending": equity,
        "compoundPct": (equity / capital - 1) * 100,
        "mddPct": mdd,
        "worstDayPct": min(daily) if daily else 0.0,
    }


def source_hashes(data_dir: Path):
    out = {}
    for path in sorted(data_dir.glob("*.json.gz")):
        out[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--main-root", required=True)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    main_root = Path(args.main_root).resolve()
    data_root = Path(args.data_root).resolve()
    sys.path.insert(0, str(main_root / "scripts"))
    engine = load_module(main_root / "scripts/backtest_soxl_intraday.py")
    engine.DATA = data_root / "data/soxl/SOXL/5m"

    days = []
    invalid = []
    for day in engine.load_days():
        date = str(day.get("sessionDateEt") or "")
        ok, reason = engine.valid_day(day)
        if ok and date <= "2026-11-19":
            days.append(day)
        elif date <= "2026-11-19":
            invalid.append({"date": date, "reason": reason})
    days.sort(key=lambda x: x["sessionDateEt"])
    labels = [x["sessionDateEt"] for x in days]
    if len(labels) != 40:
        raise RuntimeError(f"expected 40 valid sessions, got {len(labels)}")
    train_labels, test_labels = labels[:30], labels[30:40]
    specs = {
        "range_5m": engine.Params("range_5m", range_bars=1),
        "range_10m": engine.Params("range_10m", range_bars=2),
        "baseline_15m": engine.Params("baseline_15m", range_bars=3),
        "range_30m": engine.Params("range_30m", range_bars=6),
    }
    trade_map = {}
    details = {}
    for name, params in specs.items():
        trades = []
        decisions = []
        for day in days:
            trade, decision = engine.evaluate_day(day, params)
            decisions.append(decision)
            if trade:
                trades.append(trade)
        trade_map[name] = trades
        details[name] = {
            "params": vars(params),
            "train": metrics(trades, train_labels),
            "test": metrics(trades, test_labels),
            "testStress": metrics(trades, test_labels, 0.10),
            "all40": metrics(trades, labels),
            "testTrades": [x for x in trades if x["date"] in set(test_labels)],
            "testDecisions": [x for x in decisions if x["date"] in set(test_labels)],
        }

    base = details["baseline_15m"]["train"]
    eligible = []
    for name in ("range_5m", "range_10m", "range_30m"):
        m = details[name]["train"]
        if (m["trades"] >= 10 and m["avgDailyPct"] > 0 and m["profitFactor"] >= 1.10
                and m["mddPct"] >= -15 and m["worstDayPct"] >= -8
                and m["avgDailyPct"] > base["avgDailyPct"]
                and m["compoundPct"] > base["compoundPct"]):
            eligible.append(name)
    selected = max(eligible, key=lambda x: details[x]["train"]["avgDailyPct"]) if eligible else "baseline_15m"
    sm = details[selected]["test"]
    bm = details["baseline_15m"]["test"]
    st = details[selected]["testStress"]
    passes = (selected != "baseline_15m" and sm["trades"] >= 3 and sm["avgDailyPct"] > 0
              and sm["profitFactor"] >= 1.10 and sm["mddPct"] >= -15
              and sm["worstDayPct"] >= -8 and sm["avgDailyPct"] > bm["avgDailyPct"]
              and sm["compoundPct"] > bm["compoundPct"] and st["avgDailyPct"] > 0)
    result = {
        "schema": 1,
        "experiment": "G11-20261121",
        "engine": "scripts/backtest_soxl_intraday.py",
        "cutoffEt": "2026-11-19",
        "validSessions": len(labels),
        "invalidSessions": invalid,
        "train": {"from": train_labels[0], "to": train_labels[-1], "days": 30},
        "test": {"from": test_labels[0], "to": test_labels[-1], "days": 10},
        "costPct": 0.50,
        "stressAddPct": 0.10,
        "variants": details,
        "eligibleOnTrain": eligible,
        "selectedOnTrain": selected,
        "historicalTimeSplitPass": passes,
        "verdict": "historical_pass_forward_required" if passes else "reject_or_keep_baseline",
        "integerAccountsSelectedTest": {
            "usd10000": integer_account(trade_map[selected], test_labels, 10000),
            "usd100000": integer_account(trade_map[selected], test_labels, 100000),
            "usd10000Stress": integer_account(trade_map[selected], test_labels, 10000, 0.10),
            "usd100000Stress": integer_account(trade_map[selected], test_labels, 100000, 0.10),
        },
        "sourceSha256": source_hashes(engine.DATA),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "selected": selected,
        "eligible": eligible,
        "train": details[selected]["train"],
        "test": sm,
        "testBaseline": bm,
        "testStress": st,
        "pass": passes,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
