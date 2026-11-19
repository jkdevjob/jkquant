"""Continue the fixed G7 preregistration; call the existing research engine.

Reconstructed history and post-registration paper records stay separate. This
script does not collect market data, place orders, or update a live ledger.
"""
from __future__ import annotations
import argparse
import csv
import datetime as dt
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import backtest_daytrading as engine

NAMES = ("baseline", "session_min_2")
SOURCE = "c481c5beadc97d8d20185909172995a68ce55c73"
APP = "6a4fdd9ec2f8ef4a95ca1ccedd0c22dec6b1de31"


def metrics(rows, labels, extra=0):
    adjusted = [dict(x, pnl=x["pnl"] - extra) for x in rows]
    result = engine.summary(adjusted, labels, 3)
    result["dailyAvgPct"] = statistics.fmean(x["returnPct"] for x in result["daily"]) if result["daily"] else None
    result["worstDayPct"] = min((x["returnPct"] for x in result["daily"]), default=None)
    result["plus1Days"] = sum(x["returnPct"] >= 1 for x in result["daily"])
    return result


def run(source: Path, out: Path):
    source_head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if source_head != SOURCE:
        raise ValueError("G7 requires the pinned source snapshot " + SOURCE)
    path = "scripts/backtest_daytrading.py"
    pinned = subprocess.check_output(["git", "show", APP + ":" + path], cwd=ROOT)
    if (ROOT / path).read_bytes() != pinned:
        raise ValueError("G7 requires the pinned actual research engine at " + APP)
    engine.DATA = source / "data/daytrading"
    engine.LIVE = source / "data/daytrading-live"
    primary, excluded = engine.split_primary_days(engine.load_days())
    days = [d for d in primary if d["date"] <= "2026-11-18"]
    labels = [x["date"] for x in days]
    params = [engine.Params("baseline"), engine.Params("session_min_2", min_session_ret=2.)]
    trades = {p.name: engine.trades_for_variant(days, p) for p in params}
    with (source / "data/daytrading-research/variant-trades.csv").open(newline="") as f:
        archived = [x for x in csv.DictReader(f) if x["variant"] in NAMES and x["date"] in labels]

    def key(x):
        return (x["date"], x["code"], int(x["signalTime"]))

    parity = []
    for name, rows in trades.items():
        expected = {key(x): x for x in archived if x["variant"] == name}
        actual = {key(x): x for x in rows}
        differences = []
        for k in sorted(set(expected) | set(actual)):
            if k not in expected or k not in actual:
                differences.append({"key": k, "field": "trade_presence"})
                continue
            for field in ("entryTime", "exitTime", "entryPrice", "exitPrice", "pnl"):
                if abs(float(expected[k][field]) - float(actual[k][field])) > 1e-9:
                    differences.append({"key": k, "field": field})
            if expected[k]["reason"] != actual[k]["reason"]:
                differences.append({"key": k, "field": "reason"})
        parity.append({"variant": name, "replayedTrades": len(rows), "archiveTrades": len(expected), "differences": differences})

    windows = {}
    for scope, dates in (("historical_before_registration", [d for d in labels if d <= "2026-11-12"]),
                          ("post_registration", [d for d in labels if d >= "2026-11-16"]),
                          ("all", labels)):
        windows[scope] = {name: {"net": metrics([x for x in rows if x["date"] in dates], dates),
            "extraCost010pp": metrics([x for x in rows if x["date"] in dates], dates, .10)}
            for name, rows in trades.items()}
    live = [engine.live_paper_comparison(d, [x for x in trades["baseline"] if x["date"] == d])
            for d in labels if d >= "2026-11-16"]
    # Reuse the established 20/5/5 engine, limiting candidates to the two fixed rules.
    engine.VARIANTS = params
    wf = engine.walk_forward(days, trades)
    choices = []
    for fold in wf.get("folds", []):
        by = {x["name"]: x for x in fold["variants"]}
        base, cand = by["baseline"]["train"], by["session_min_2"]["train"]
        daily_mean = lambda s: statistics.fmean(x["returnPct"] for x in s["daily"])
        select = cand["trades"] >= 20 and cand["profitFactor"] >= 1.10 and daily_mean(cand) > 0 and daily_mean(cand) >= daily_mean(base)
        choices.append({"trainFrom": fold["trainFrom"], "trainTo": fold["trainTo"],
                        "testFrom": fold["testFrom"], "testTo": fold["testTo"],
                        "selected": "session_min_2" if select else "baseline"})
    # Independent account arithmetic, using the engine's original trade PnL.
    account_diffs = []
    for name, rows in trades.items():
        summary = windows["all"][name]["net"]
        equity, peak, mdd = 1., 1., 0.
        for day in summary["daily"]:
            expected = sum(x["pnl"] for x in rows if x["date"] == day["date"]) / 3
            if abs(expected - day["returnPct"]) > 1e-9:
                account_diffs.append({"variant": name, "date": day["date"]})
            equity *= 1 + expected / 100
            peak = max(peak, equity)
            mdd = min(mdd, (equity / peak - 1) * 100)
        assert abs((equity - 1) * 100 - summary["portfolioReturnPct"]) < 1e-9
        assert abs(mdd - summary["portfolioMddPct"]) < 1e-9
    report = {"research": "G7", "continuation": True,
        "preregistrationCommit": "60b9cd340886f54b536d51f8eb0e23d9c50ab7d6",
        "mainSha": APP, "sourceSha": source_head,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "primaryDays": len(days),
        "excludedSnapshots": excluded, "windows": windows, "researchEngineVsArchivedCsv": parity,
        "baselineLiveLedgerComparison": live, "walkForward": wf, "trainOnlyChoices": choices,
        "independentAccountDifferences": account_diffs,
        "sourceManifest": [{"path": str(p.relative_to(source)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                           for p in sorted(engine.DATA.glob("*/*.json.gz"))],
        "limitations": ["Historical reconstruction uses the production research engine; it is not a separately verified live fill engine.",
                        "Post-registration dated paper evidence is only three days, below the 20-day gate.",
                        "No broker fill, FX or integer-share execution was verified."],
        "decision": "No adoption. Maintain the frozen candidate and collect independent future sessions."}
    report["validationPassed"] = not account_diffs and all(not x["differences"] for x in parity)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"research": "G7", "validationPassed": report["validationPassed"], "primaryDays": len(days),
        "parity": parity, "postRegistration": windows["post_registration"],
        "live": [{k: x.get(k) for k in ("date", "status", "liveTrades", "reconstructedTrades", "matched", "exactMatches")} for x in live],
        "trainOnlyChoices": choices}, ensure_ascii=False))
    return report


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--sources", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args()
    sys.exit(0 if run(a.sources.resolve(), a.out.resolve())["validationPassed"] else 1)
