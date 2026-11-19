"""G9 follow-up: same original closed sessions with a prior-known KRX holiday gate."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import argparse
import json
from pathlib import Path
import subprocess
import sys

from g05_closing_parity import audit, ROOT
from closing30_metrics import daily_rows, summarize, walk_forward
from nightly_closing30_research import flatten

SOURCE = "c481c5beadc97d8d20185909172995a68ce55c73"
PREREG = "78fa6afc7ce80eb73211754d429f667d5770e7bd"
KINDS = ("baseline", "up_1")


def schedule(dates):
    script = """
import {krxDay} from './functions/api/_krx_calendar.js';
const dates = JSON.parse(process.argv[1]);
const map = Object.fromEntries(dates.map(date => {
  const next = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0,10);
  const decision = krxDay(next);
  if (!decision.known) throw new Error('Unknown KRX calendar ' + next);
  return [date, {next, ...decision}];
}));
console.log(JSON.stringify(map));
"""
    out = subprocess.check_output(
        ["node", "--input-type=module", "-e", script, json.dumps(dates)], cwd=ROOT
    )
    return json.loads(out)


def compute(workdir, original):
    check = audit(SOURCE, workdir)
    assert check["passed"], "Original-ledger JS/Python audit failed"
    ledgers = [x for x in json.loads((workdir / "ledgers.json").read_bytes()) if x["date"] <= "2026-11-18"]
    rows = [x for ledger in ledgers for x in flatten(ledger) if
            x["kind"] == "overnight" and x["variant"] in KINDS]
    daily = {variant: {x["date"]: x for x in daily_rows(rows, ledgers, "overnight", variant)}
             for variant in KINDS}
    common = sorted(set(daily["baseline"]) & set(daily["up_1"]))
    assert common == original["commonDates"], "G9 comparison dates drifted"
    calendar = schedule(common)
    blocked = {d for d, decision in calendar.items() if decision["closed"]}
    selected = [d for d in common if d not in blocked]
    scenarios, holding_audit = {}, {}
    for variant in KINDS:
        historical = [x for x in rows if x["variant"] == variant and x["date"] in common]
        observed = [daily[variant][date] for date in common]
        eligible = [r for r in historical if r["date"] not in blocked]
        adjusted = [dict(d, returnPct=0.0, trades=0) if d["date"] in blocked else d for d in observed]
        raw_result = summarize(historical, observed)
        old = original["metrics"][variant]["net"]
        for k in ("totalReturnPct", "mddPct", "profitFactor", "dailyAvgPct", "trades"):
            assert abs(raw_result[k] - old[k]) < 1e-9, (variant, k)
        guarded = summarize(eligible, adjusted)
        eligible_only = summarize(eligible, [d for d in observed if d["date"] in selected])
        assert abs(guarded["totalReturnPct"] - eligible_only["totalReturnPct"]) < 1e-9
        assert guarded["observedDays"] == len(common)
        assert len(eligible) == sum(d["trades"] for d in adjusted)
        old_over, new_over, max_hours = [], [], 0.0
        for x in historical:
            start = datetime.fromisoformat(x["entryTime"])
            stop = datetime.fromisoformat(x["exitTime"])
            hours = (stop - start).total_seconds() / 3600
            assert hours >= 0, "Exit before entry"
            if hours > 24:
                over = {"date": x["date"], "hours": hours, "skippedBySchedule": x["date"] in blocked}
                old_over.append(over)
                if x["date"] not in blocked:
                    new_over.append(over)
            if x["date"] not in blocked:
                max_hours = max(max_hours, hours)
        holding_audit[variant] = {"over24hBefore": len(old_over), "over24hAfter": len(new_over),
                                  "maxHoursAfter": max_hours, "longPositions": old_over}
        scenarios[variant] = {
            "asRecorded": {"normal": raw_result, "stress": summarize(historical, observed, .1)},
            "guarded": {"normal": guarded, "stress": summarize(eligible, adjusted, .1)},
            "removedDayReturns": [d for d in observed if d["date"] in blocked],
        }
    base_daily = scenarios["baseline"]["guarded"]["normal"]["daily"]
    alt_daily = scenarios["up_1"]["guarded"]["normal"]["daily"]
    base_rows = [x for x in rows if x["variant"] == "baseline" and x["date"] in selected]
    alt_rows = [x for x in rows if x["variant"] == "up_1" and x["date"] in selected]
    wf = walk_forward(alt_rows, base_rows, alt_daily, base_daily, "up_1_24h_krx")
    blocks, loo = [], []
    for i in range(3):
        ds = alt_daily[len(common)*i//3:len(common)*(i+1)//3]
        dates = {d["date"] for d in ds}
        trade_set = [x for x in alt_rows if x["date"] in dates]
        blocks.append({"period": [ds[0]["date"], ds[-1]["date"]],
                       "trades": len(trade_set), "normalPct": summarize(trade_set, ds)["totalReturnPct"],
                       "stressPct": summarize(trade_set, ds, .1)["totalReturnPct"]})
    for skip in common:
        day_rows = [x for x in alt_rows if x["date"] != skip]
        adjusted_days = [x for x in alt_daily if x["date"] != skip]
        loo.append({"drop": skip, "netPct": summarize(day_rows, adjusted_days)["totalReturnPct"],
                    "stressPct": summarize(day_rows, adjusted_days, .1)["totalReturnPct"]})
    exposed_unsettled = defaultdict(int)
    for x in rows:
        if x["state"] != "closed":
            exposed_unsettled[x["variant"]] += 1
    return {
        "schema": 1, "study": "G9 next-calendar-day guard", "preregistrationCommit": PREREG,
        "sourceSha": SOURCE, "auditedAt": datetime.now(timezone.utc).isoformat(),
        "mainSha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "completeCommonDays": common, "scheduleBlockedDays": sorted(blocked), "calendar": calendar,
        "completeGuardedTradingDays": [d["date"] for d in alt_daily if d["trades"]],
        "jsPythonAudit": {k: check[k] for k in ["records", "recordDifferences", "dailyDifferences", "passed"]},
        "recordedMetricsMatchG9": True,
        "allUnsettledSignals": dict(exposed_unsettled),
        "scenarios": scenarios, "timeBlocks": blocks, "leaveOneDayOut": loo, "walkForward": wf,
        "holdingAudit": holding_audit, "newProspectiveDays": 0, "newProspectiveTrades": 0,
        "definition": "Skip closing entry when the next calendar date is a known KRX closure",
        "limit": "Historical sensitivity after G9 selection. A schedule filter does not guarantee exit on a halt or missing open fill.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work", type=Path, required=True)
    parser.add_argument("--g9", type=Path, required=True)
    args = parser.parse_args()
    g9 = json.loads(args.g9.read_bytes())
    assert g9["sourceSha"] == SOURCE and g9["validation"]["passed"]
    result = compute(args.work.resolve(), g9["strategies"]["overnight"])
    (args.work / "closing_24h_result_byGPT.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
