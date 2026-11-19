"""Reprice the fixed G9 closing sample using the current fee model."""

from argparse import ArgumentParser
from datetime import datetime, timezone
import gzip
import json
from math import isclose
from pathlib import Path

from closing30_metrics import daily_rows, summarize
from nightly_closing30_research import flatten
from scalp_cost import cost_pct


def run(guard_result, ledgers, fee_rate):
    sample = guard_result["completeCommonDays"]
    blocked = set(guard_result["scheduleBlockedDays"])
    cost = cost_pct("kr", fee_rate)
    recorded_cost = 0.23
    ledgers = [ledger for ledger in ledgers if ledger["date"] in sample]
    variants = {}
    for variant in ("baseline", "up_1"):
        rows = [
            row for ledger in ledgers for row in flatten(ledger)
            if row["kind"] == "overnight" and row["variant"] == variant
        ]
        assert len(rows) == 3 * len(sample)
        assert all(
            row["state"] == "closed" and row["strategyParams"]["frictionPct"] == recorded_cost
            and isclose(row["pnl"], (row["exitPrice"] / row["entryPrice"] - 1) * 100 - recorded_cost)
            for row in rows
        )
        repriced = [
            dict(row, pnl=(row["exitPrice"] / row["entryPrice"] - 1) * 100 - cost)
            for row in rows
        ]
        daily = daily_rows(repriced, ledgers, "overnight", variant)
        assert [day["date"] for day in daily] == sample
        guarded_trades = [row for row in repriced if row["date"] not in blocked]
        guarded_days = [
            dict(day, returnPct=0, trades=0) if day["date"] in blocked else day for day in daily
        ]
        variants[variant] = {
            kind: {"current": summarize(trades, days), "stress": summarize(trades, days, 0.10)}
            for kind, trades, days in (
                ("regular", repriced, daily),
                ("guard", guarded_trades, guarded_days),
            )
        }
        variants[variant]["guard"]["leaveOneDayOutMinimumPct"] = min(
            summarize(
                [trade for trade in guarded_trades if trade["date"] != omit],
                [day for day in guarded_days if day["date"] != omit],
            )["totalReturnPct"] for omit in sample
        )
    return {
        "schema": 1,
        "sample": sample,
        "blockedDates": guard_result["scheduleBlockedDays"],
        "ledgerCommit": guard_result["sourceSha"],
        "rulePreregistration": guard_result["preregistrationCommit"],
        "engineCommit": "6eafa72f94576fb4a811f42d70071ad31f1f6396",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "costVerification": "https://jkquant.pages.dev/api/scalping-duel",
        "writtenCostPct": recorded_cost,
        "specifiedCurrentFeeRate": fee_rate,
        "currentRoundTripCostPct": cost,
        "extraCostPp": 0.10,
        "prospective": {"eligibleDays": 0, "settledTrades": 0},
        "variants": variants,
    }


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--guard-result", type=Path, required=True)
    parser.add_argument("--ledgers", type=Path, required=True)
    parser.add_argument("--fee-rate", type=float, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with gzip.open(args.guard_result, "rt", encoding="utf-8") as stream:
        guard_result = json.load(stream)
    result = run(guard_result, json.loads(args.ledgers.read_text()), args.fee_rate)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
