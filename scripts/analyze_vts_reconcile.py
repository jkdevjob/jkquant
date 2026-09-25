#!/usr/bin/env python3
"""Aggregate read-only KIS VTS execution-quality reports.

Input:
  data/vts-reconcile/YYYY-MM-DD-opening.json
  data/vts-reconcile/YYYY-MM-DD-daytrading.json
Output:
  data/vts-research/latest.json

This script never talks to a broker and never submits orders.
"""
from __future__ import annotations
import json, statistics
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST=ZoneInfo("Asia/Seoul")
SRC=Path("data/vts-reconcile")
OUT=Path("data/vts-research")

def avg(vals):
    a=[float(x) for x in vals if x is not None]
    return statistics.fmean(a) if a else None

def load():
    rows=[]
    for p in sorted(SRC.glob("*.json")):
        try:
            j=json.loads(p.read_text(encoding="utf-8"))
            if not j.get("ok") or j.get("env")!="vts":
                continue
            j["_file"]=p.name
            rows.append(j)
        except Exception as e:
            print("skip",p,e)
    return rows

def summarize(reports,strategy):
    rr=[x for x in reports if x.get("strategy")==strategy]
    matches=[m for x in rr for m in (x.get("matches") or [])]
    complete=[m for m in matches if m.get("matched")]
    with_buy=[m for m in matches if m.get("vtsBuy")]
    with_sell=[m for m in matches if m.get("vtsSell")]
    return {
        "strategy":strategy,
        "days":len({x.get("date") for x in rr if x.get("date")}),
        "reports":len(rr),
        "internalTrades":sum(int(x.get("internalTrades") or 0) for x in rr),
        "kisOrders":sum(int(x.get("kisOrders") or 0) for x in rr),
        "completeMatches":len(complete),
        "buyMatches":len(with_buy),
        "sellMatches":len(with_sell),
        "avgEntrySlippageCostPct":avg(m.get("entrySlippageCostPct") for m in with_buy),
        "avgExitSlippageCostPct":avg(m.get("exitSlippageCostPct") for m in with_sell),
        "avgRoundTripSlippageCostPct":avg(
            (float(m.get("entrySlippageCostPct") or 0)+float(m.get("exitSlippageCostPct") or 0))
            for m in complete
        ),
        "avgInternalPnlPct":avg(m.get("internalPnl") for m in complete),
        "avgVtsGrossPnlPct":avg(m.get("vtsGrossPnlPct") for m in complete),
        "avgVtsNetPnlPct":avg(m.get("vtsNetPnlPct") for m in complete),
        "avgBrokerCostRatePct":avg(m.get("vtsBrokerCostRatePct") for m in complete),
        "avgObservedExecutionDragPct":avg(m.get("observedExecutionDragPct") for m in complete),
        "frictionGapVsInternal025Pct":(
            avg(m.get("observedExecutionDragPct") for m in complete)-0.25
            if avg(m.get("observedExecutionDragPct") for m in complete) is not None else None
        ),
        "calibrationStatus":"reviewable" if len(complete)>=20 else "collecting",
        "calibrationMatches":len(complete),
        "totalBrokerEstimatedCostsWon":sum(float(m.get("vtsBrokerEstimatedCosts") or 0) for m in complete),
        "avgBrokerEstimatedCostsWon":avg(m.get("vtsBrokerEstimatedCosts") for m in complete),
    }

def main():
    reports=load()
    OUT.mkdir(parents=True,exist_ok=True)
    if not reports:
        print("No VTS reconciliation reports yet.")
        return 0
    dates=sorted({x.get("date") for x in reports if x.get("date")})
    latest_date=dates[-1] if dates else None
    report={
        "schema":1,
        "generatedAt":datetime.now(KST).isoformat(),
        "mode":"read-only-vts-execution-research",
        "from":dates[0] if dates else None,
        "to":latest_date,
        "archiveDays":len(dates),
        "strategies":[summarize(reports,"opening"),summarize(reports,"daytrading")],
        "latest":{
            "date":latest_date,
            "reports":[{
                "strategy":x.get("strategy"),
                "internalTrades":x.get("internalTrades",0),
                "kisOrders":x.get("kisOrders",0),
                "matched":sum(1 for m in (x.get("matches") or []) if m.get("matched")),
                "matches":x.get("matches") or [],
                "unmatched":x.get("unmatched") or [],
            } for x in reports if x.get("date")==latest_date]
        }
    }
    (OUT/"latest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    if latest_date:
        (OUT/f"{latest_date}.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:report[k] for k in ("from","to","archiveDays","strategies")},ensure_ascii=False,indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
