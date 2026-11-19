"""G9: fixed up_1/baseline comparison using original, versioned closing ledgers.

This is post-selection historical diagnosis, not an independent holdout. It
calls the existing production ledger/metrics modules and never discovers signals
or writes orders, raw ledgers, lifecycle state, or live settings.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from nightly_closing30_research import flatten
from closing30_metrics import coverage, daily_rows, summarize, walk_forward

SOURCE = "c481c5beadc97d8d20185909172995a68ce55c73"
PREREG = "6cfc02e4b7ab521747124ef82e47d208ca08a2fb"
NAMES = ("baseline", "up_1")
END = "2026-11-18"


def compact(summary):
    return {k: v for k, v in summary.items() if k != "daily"}


def run(bundle: Path, out: Path):
    audit = json.loads((bundle / "g05-audit.json").read_text())
    assert audit["sourceSha"] == SOURCE and audit["passed"], "source/JS parity failed"
    ledgers = [x for x in json.loads((bundle / "ledgers.json").read_text()) if x["date"] <= END]
    rows = [x for ledger in ledgers for x in flatten(ledger)]
    fee_diffs = []
    independent_days = 0
    mutations = {"remove023Cost": 0, "divideByFilledSlots": 0, "unsettledAsZero": 0}
    hash_changes = [x["path"] for x in audit["sourceManifest"]
                    if hashlib.sha256((bundle / "sources" / Path(x["path"]).name).read_bytes()).hexdigest() != x["sha256"]]
    for x in rows:
        if x["state"] != "closed":
            continue
        gross = (x["exitPrice"] / x["entryPrice"] - 1) * 100
        expected = gross - .23
        if abs(expected - x["pnl"]) > 1e-9:
            fee_diffs.append({k: x[k] for k in ("date", "kind", "variant", "code", "pnl")})
        mutations["remove023Cost"] += abs(gross - x["pnl"]) > 1e-9

    results = {}
    for kind in ("day", "overnight"):
        subsets = {n: [x for x in rows if x["kind"] == kind and x["variant"] == n] for n in NAMES}
        daily = {n: daily_rows(xs, ledgers, kind, n) for n, xs in subsets.items()}
        dates = sorted(set(x["date"] for x in daily["baseline"]) & set(x["date"] for x in daily["up_1"]))
        paired_rows = {n: [x for x in subsets[n] if x["date"] in dates] for n in NAMES}
        paired_daily = {n: [x for x in daily[n] if x["date"] in dates] for n in NAMES}
        metrics = {}
        stage_exclusions = {}
        for name in NAMES:
            xs, ds = paired_rows[name], paired_daily[name]
            normal, stress = summarize(xs, ds), summarize(xs, ds, .10)
            blocks = []
            for i in range(3):
                bd = ds[i * len(ds) // 3:(i + 1) * len(ds) // 3]
                br = [x for x in xs if x["date"] in {d["date"] for d in bd}]
                blocks.append({"from": bd[0]["date"] if bd else None,
                    "to": bd[-1]["date"] if bd else None,
                    "net": compact(summarize(br, bd)), "stress": compact(summarize(br, bd, .10))})
            loo = []
            for date in dates:
                keep_rows = [x for x in xs if x["date"] != date]
                keep_days = [x for x in ds if x["date"] != date]
                loo.append({"removedDate": date, "net": compact(summarize(keep_rows, keep_days)),
                            "stress": compact(summarize(keep_rows, keep_days, .10))})
            holdings = []
            for x in xs:
                if x["entryTime"] and x["exitTime"]:
                    hours = (dt.datetime.fromisoformat(x["exitTime"]) - dt.datetime.fromisoformat(x["entryTime"])).total_seconds() / 3600
                    holdings.append({"date": x["date"], "code": x["code"], "hours": hours})
            metrics[name] = {"net": compact(normal), "extraCost010pp": compact(stress),
                "positiveTimeBlockFraction": sum((b["net"]["dailyAvgPct"] or 0) > 0 for b in blocks) / 3,
                "timeBlocks": blocks, "leaveOneSessionOut": loo,
                "worstLeaveOneOutReturnPct": min((x["net"]["totalReturnPct"] for x in loo), default=None),
                "holdingHoursMax": max((x["hours"] for x in holdings), default=None),
                "over24HourTrades": [x for x in holdings if x["hours"] > 24],
                "daily": ds}
            complete_dates = {x["date"] for x in daily[name]}
            exclusions = []
            for ledger in ledgers:
                original = [x for x in subsets[name] if x["date"] == ledger["date"]]
                unclosed = [x for x in original if x["state"] != "closed"]
                if coverage(ledger, kind) and unclosed:
                    assert ledger["date"] not in complete_dates
                    mutations["unsettledAsZero"] += 1
                if ledger["date"] not in dates:
                    exclusions.append({"date": ledger["date"], "scansComplete": coverage(ledger, kind),
                        "signalRows": len(original), "unsettled": [{k: x.get(k) for k in
                            ("code", "state", "signalTime", "entryTime", "exitTime", "strategyVersion")} for x in unclosed],
                        "ownAccountComplete": ledger["date"] in complete_dates,
                        "missingVersions": sum(not x.get("strategyVersion") for x in original)})
            stage_exclusions[name] = {"totalSignals": len(subsets[name]),
                "closed": sum(x["state"] == "closed" for x in subsets[name]),
                "unsettled": sum(x["state"] != "closed" for x in subsets[name]),
                "ownCompleteDays": len(daily[name]), "excludedDates": exclusions,
                "missingVersions": sum(not x.get("strategyVersion") for x in subsets[name])}
            for d in ds:
                original = [x for x in xs if x["date"] == d["date"]]
                assert all(x["state"] == "closed" for x in original)
                assert abs(sum(x["pnl"] for x in original) / 3 - d["returnPct"]) < 1e-9
                independent_days += 1
                if original:
                    mutations["divideByFilledSlots"] += abs(sum(x["pnl"] for x in original) / len(original) - d["returnPct"]) > 1e-9
        wf = walk_forward(paired_rows["up_1"], paired_rows["baseline"],
                          paired_daily["up_1"], paired_daily["baseline"], "up_1")
        cand, base = metrics["up_1"]["net"], metrics["baseline"]["net"]
        stress = metrics["up_1"]["extraCost010pp"]
        checks = {"positiveDailyExpectancy": (cand["dailyAvgPct"] or 0) > 0,
            "profitFactor110": (cand["profitFactor"] or 0) >= 1.10,
            "sameDateBaselineEdge": cand["dailyAvgPct"] is not None and cand["dailyAvgPct"] >= base["dailyAvgPct"],
            "extraCostStress": (stress["dailyAvgPct"] or 0) > 0 and (stress["profitFactor"] or 0) >= 1.10,
            "mddMinus15": cand["mddPct"] is not None and cand["mddPct"] >= -15,
            "worstDayMinus8": cand["worst"] is not None and cand["worst"] >= -8,
            "positiveBlocks60pct": metrics["up_1"]["positiveTimeBlockFraction"] >= .60,
            "walkForward": wf["passed"],
            "sourceComplete": not fee_diffs and not hash_changes and
                all(stage_exclusions[n]["unsettled"] == 0 and not stage_exclusions[n]["missingVersions"] for n in NAMES) and
                all(coverage(l, kind) for l in ledgers),
            "totalTrades30": cand["trades"] >= 30,
            "independentForward20days20trades": False,
            "sevenLeadersAndScore60": False,
            "holdingTimeAuthorization": kind == "day"}
        bmap = {x["date"]: x for x in paired_daily["baseline"]}
        differences = [{"date": x["date"], "up1Pct": x["returnPct"], "baselinePct": bmap[x["date"]]["returnPct"],
                        "edgePct": x["returnPct"] - bmap[x["date"]]["returnPct"]} for x in paired_daily["up_1"]]
        results[kind] = {"commonDates": dates, "metrics": metrics, "coverage": stage_exclusions,
            "pairedDifferences": differences, "walkForward": wf, "checks": checks,
            "blockedReasons": [k for k, v in checks.items() if not v],
            "verdict": "historical_candidate_only_no_adoption"}

    # A labelled one-trade/two-cash-slots probe using an unchanged real row.
    # It checks account sizing and is excluded from every market metric.
    probe = next(x for x in rows if x["state"] == "closed" and x["pnl"] != 0 and
                 coverage(next(l for l in ledgers if l["date"] == x["date"]), x["kind"]))
    probe_ledger = next(l for l in ledgers if l["date"] == probe["date"])
    pd = daily_rows([probe], [probe_ledger], probe["kind"], probe["variant"])
    assert len(pd) == 1 and abs(pd[0]["returnPct"] - probe["pnl"] / 3) < 1e-9
    natural_slot_diffs = mutations["divideByFilledSlots"]
    mutations["divideByFilledSlots"] += abs(pd[0]["returnPct"] - probe["pnl"]) > 1e-9
    validation = {"operatingVsResearchRecords": audit["records"], "recordDifferences": audit["recordDifferences"],
        "dailyDifferences": audit["dailyDifferences"], "feeCheckedClosedRecords": sum(x["state"] == "closed" for x in rows),
        "feeDifferences": fee_diffs, "independentAccountDays": independent_days, "sourceHashChanges": hash_changes,
        "mutations": mutations, "naturalSlotMutationDifferences": natural_slot_diffs,
        "cashSlotProbe": {"date": probe["date"], "code": probe["code"], "returnPct": pd[0]["returnPct"], "includedInPerformance": False}}
    validation["passed"] = audit["passed"] and not fee_diffs and not hash_changes and all(mutations.values())
    report = {"schema": 1, "research": "G9", "preregistrationCommit": PREREG,
        "mainSha": "6a4fdd9ec2f8ef4a95ca1ccedd0c22dec6b1de31", "sourceSha": SOURCE,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "lastSignalDate": END,
        "sourceLedgers": len(ledgers), "sourceManifest": audit["sourceManifest"],
        "knownBeforeRegistration": "up_1 overnight 17d/51 trades +12.771%, PF1.775; post-selection historical diagnosis",
        "costPct": .23, "stressAdditionalPct": .10, "fixedSlots": 3,
        "independentForward": {"days": 0, "trades": 0, "firstEligibleSignalDate": "2026-11-20"},
        "strategies": results, "validation": validation,
        "decision": "No adoption or investment recommendation. Missing outcomes and independent forward/WF gates remain unresolved."}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"research": "G9", "validation": validation, "results": {
        k: {"commonDays": len(v["commonDates"]), "metrics": {n: {"net": m["net"], "stress": m["extraCost010pp"],
            "positiveBlocks": m["positiveTimeBlockFraction"], "worstLeaveOneOutReturnPct": m["worstLeaveOneOutReturnPct"],
            "holdingHoursMax": m["holdingHoursMax"], "over24HourCount": len(m["over24HourTrades"])} for n, m in v["metrics"].items()},
            "blockedReasons": v["blockedReasons"]} for k, v in results.items()}}, ensure_ascii=False))
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--bundle", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    sys.exit(0 if run(a.bundle.resolve(), a.out.resolve())["validation"]["passed"] else 1)
