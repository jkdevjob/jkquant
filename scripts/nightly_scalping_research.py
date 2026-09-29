#!/usr/bin/env python3
"""Nightly research rollup for opening + day-trading + bitcoin + SOXL strategies.

Reads immutable/reconstructed paper research from scalping-data and produces a
single daily research report. It NEVER changes live strategy parameters.

Promotion policy:
- opening: >=20 archived days, >=50 baseline trades, candidate >=30 trades,
  and the candidate must beat baseline average PnL in both all-history and
  last-20-day windows by minimum margins.
- daytrading: existing primary-quality gate must be eligible and walk-forward
  must be reviewable before any variant can become a review candidate.
- KIS VTS friction remains collecting until the reconciliation layer has enough
  matched fills; this report only surfaces the observed values.
"""
from __future__ import annotations

import json
import statistics
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST=ZoneInfo("Asia/Seoul")
OPEN=Path("data/opening-history")
DAY=Path("data/daytrading-research/latest.json")
CRYPTO=Path("data/crypto-research/latest.json")
SOXL=Path("data/soxl-research/latest.json")
VTS=Path("data/vts-research/latest.json")
OUT=Path("data/nightly-research")

OPEN_MIN_DAYS=20
OPEN_MIN_BASE_TRADES=50
OPEN_MIN_CAND_TRADES=30
OPEN_ALL_EDGE=0.10
OPEN_20D_EDGE=0.05

def load_json(p:Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default

def stats(rows):
    pn=[float(x.get("pnl")) for x in rows if x.get("pnl") is not None]
    if not pn:
        return {"trades":0,"winRate":0.0,"avgPnl":0.0,"medianPnl":0.0,"sumPnl":0.0}
    return {
        "trades":len(pn),
        "winRate":sum(1 for x in pn if x>0)/len(pn)*100,
        "avgPnl":statistics.fmean(pn),
        "medianPnl":statistics.median(pn),
        "sumPnl":sum(pn),
    }

def opening_report():
    days=[]
    books={}
    for p in sorted(OPEN.glob("*.json")):
        j=load_json(p,{}) or {}
        d=str(j.get("date") or p.stem)
        if not d:
            continue
        days.append(d)
        for x in j.get("trades") or []:
            books.setdefault("baseline",[]).append({"date":d,**x})
        for v in j.get("shadowVariants") or []:
            name=str(v.get("name") or "")
            if not name:
                continue
            for x in v.get("trades") or []:
                books.setdefault(name,[]).append({"date":d,**x})

    days=sorted(set(days))
    if not days:
        return {"status":"collecting","archiveDays":0,"variants":[],"candidates":[]}

    windows={"last5":set(days[-5:]),"last20":set(days[-20:]),"all":set(days)}
    variants=[]
    for name,rows in sorted(books.items(),key=lambda z:(z[0]!="baseline",z[0])):
        w={}
        for key,dates in windows.items():
            w[key]=stats([x for x in rows if x["date"] in dates])
        variants.append({"name":name,"windows":w})

    by={v["name"]:v for v in variants}
    base=by.get("baseline",{"windows":{"last20":stats([]),"all":stats([])}})
    b20=base["windows"]["last20"]; ball=base["windows"]["all"]
    enough=len(days)>=OPEN_MIN_DAYS and ball["trades"]>=OPEN_MIN_BASE_TRADES
    candidates=[]
    for v in variants:
        if v["name"]=="baseline":
            continue
        a=v["windows"]["all"]; w20=v["windows"]["last20"]
        all_edge=a["avgPnl"]-ball["avgPnl"]
        d20_edge=w20["avgPnl"]-b20["avgPnl"]
        review=(
            enough and a["trades"]>=OPEN_MIN_CAND_TRADES and
            all_edge>=OPEN_ALL_EDGE and d20_edge>=OPEN_20D_EDGE
        )
        candidates.append({
            "name":v["name"],
            "status":"review" if review else "collecting",
            "allAvgEdgePct":all_edge,
            "last20AvgEdgePct":d20_edge,
            "allTrades":a["trades"],
            "last20Trades":w20["trades"],
        })
    candidates.sort(key=lambda x:(x["status"]!="review",-x["last20AvgEdgePct"],-x["allAvgEdgePct"],x["name"]))
    return {
        "status":"reviewable" if enough else "collecting",
        "archiveDays":len(days),"from":days[0],"to":days[-1],
        "policy":{
            "minDays":OPEN_MIN_DAYS,"minBaselineTrades":OPEN_MIN_BASE_TRADES,
            "minCandidateTrades":OPEN_MIN_CAND_TRADES,
            "allAvgEdgePct":OPEN_ALL_EDGE,"last20AvgEdgePct":OPEN_20D_EDGE,
            "autoPromotion":False,
        },
        "variants":variants,"candidates":candidates,
    }

def compound_daily(daily):
    eq=1.0
    for x in daily:
        eq*=1+float(x.get("returnPct") or 0)/100
    return (eq-1)*100

def daytrading_report():
    j=load_json(DAY,{}) or {}
    vars=j.get("variants") or []
    rows=[]
    for v in vars:
        name=str((v.get("params") or {}).get("name") or "")
        s=v.get("summary") or {}
        daily=s.get("daily") or []
        rows.append({
            "name":name,
            "trades":int(s.get("trades") or 0),
            "winRate":float(s.get("winRate") or 0),
            "avgPnl":float(s.get("avgPnl") or 0),
            "profitFactor":float(s.get("profitFactor") or 0),
            "portfolioReturnPct":float(s.get("portfolioReturnPct") or 0),
            "portfolioMddPct":float(s.get("portfolioMddPct") or 0),
            "last5PortfolioReturnPct":compound_daily(daily[-5:]),
            "last20PortfolioReturnPct":compound_daily(daily[-20:]),
        })
    by={x["name"]:x for x in rows}
    base=by.get("baseline",{"avgPnl":0.0,"profitFactor":0.0,"portfolioMddPct":0.0})
    eligible=j.get("comparisonStatus")=="eligible"
    wf=(j.get("walkForward") or {}).get("status")=="reviewable"
    candidates=[]
    for x in rows:
        if x["name"]=="baseline":
            continue
        edge=x["avgPnl"]-base["avgPnl"]
        mdd_ok=x["portfolioMddPct"]>=base["portfolioMddPct"]-1.0
        pf_ok=x["profitFactor"]>=base["profitFactor"]
        review=eligible and wf and x["trades"]>=30 and edge>=0.10 and mdd_ok and pf_ok
        candidates.append({
            "name":x["name"],"status":"review" if review else "collecting",
            "avgPnlEdgePct":edge,"trades":x["trades"],
            "last20PortfolioReturnPct":x["last20PortfolioReturnPct"],
            "mddOk":mdd_ok,"profitFactorOk":pf_ok,
        })
    candidates.sort(key=lambda x:(x["status"]!="review",-x["avgPnlEdgePct"],-x["last20PortfolioReturnPct"],x["name"]))
    return {
        "status":"reviewable" if eligible and wf else "collecting",
        "archiveDays":int(j.get("archiveDays") or 0),
        "eligibleArchiveDays":int(j.get("eligibleArchiveDays") or 0),
        "baselineTradeCount":int(j.get("baselineTradeCount") or 0),
        "comparisonStatus":j.get("comparisonStatus") or "collecting",
        "walkForwardStatus":(j.get("walkForward") or {}).get("status") or "collecting",
        "from":j.get("from"),"to":j.get("to"),
        "variants":rows,"candidates":candidates,
        "autoPromotion":False,
    }

def crypto_report():
    j=load_json(CRYPTO,{}) or {}
    rows=[]
    for v in j.get("variants") or []:
        p=v.get("params") or {}
        s=v.get("summary") or {}
        h=(v.get("validation") or {}).get("holdout") or {}
        rows.append({
            "name":str(p.get("name") or ""),
            "trades":int(s.get("trades") or 0),
            "winRate":float(s.get("winRate") or 0),
            "avgPnl":float(s.get("avgPnl") or 0),
            "avgDailyReturnPct":float(s.get("avgDailyReturnPct") or 0),
            "target1PctDayRatePct":float(s.get("target1PctDayRatePct") or 0),
            "profitFactor":float(s.get("profitFactor") or 0),
            "compoundReturnPct":float(s.get("compoundReturnPct") or 0),
            "maxDrawdownPct":float(s.get("maxDrawdownPct") or 0),
            "holdoutTrades":int(h.get("trades") or 0),
            "holdoutAvgPnl":float(h.get("avgPnl") or 0),
            "holdoutCompoundReturnPct":float(h.get("compoundReturnPct") or 0),
            "holdoutTarget1PctDayRatePct":float(h.get("target1PctDayRatePct") or 0),
        })
    by={x["name"]:x for x in rows}
    base=by.get("baseline",{
        "avgPnl":0.0,"maxDrawdownPct":0.0,"holdoutAvgPnl":0.0,
        "target1PctDayRatePct":0.0,"holdoutTarget1PctDayRatePct":0.0
    })
    eligible=j.get("comparisonStatus")=="reviewable"
    candidates=[]
    for x in rows:
        if x["name"]=="baseline":
            continue
        all_edge=x["avgPnl"]-base["avgPnl"]
        hold_edge=x["holdoutAvgPnl"]-base["holdoutAvgPnl"]
        mdd_ok=x["maxDrawdownPct"]>=base["maxDrawdownPct"]-2.0
        review=(
            eligible and x["trades"]>=50 and x["holdoutTrades"]>=20
            and all_edge>=0.05 and hold_edge>=0.05 and mdd_ok
        )
        candidates.append({
            "name":x["name"],"status":"review" if review else "collecting",
            "allAvgEdgePct":all_edge,"holdoutAvgEdgePct":hold_edge,
            "trades":x["trades"],"holdoutTrades":x["holdoutTrades"],
            "target1PctDayRatePct":x["target1PctDayRatePct"],
            "holdoutTarget1PctDayRatePct":x["holdoutTarget1PctDayRatePct"],
            "mddOk":mdd_ok,
        })
    candidates.sort(key=lambda x:(
        x["status"]!="review",
        -x["holdoutAvgEdgePct"],
        -x["allAvgEdgePct"],
        -x["holdoutTarget1PctDayRatePct"],
        x["name"]
    ))
    return {
        "status":"reviewable" if eligible else "collecting",
        "archiveDays":int(j.get("archiveDays") or 0),
        "validDays":int(j.get("validDays") or 0),
        "from":j.get("from"),"to":j.get("to"),
        "comparisonStatus":j.get("comparisonStatus") or "collecting",
        "validationModel":"70/30 holdout + rolling30",
        "rolling30":j.get("rolling30") or {},
        "variants":rows,"candidates":candidates,
        "autoPromotion":False,
        "targetNote":"1% is a research target metric, not a guaranteed daily return."
    }


def soxl_report():
    j=load_json(SOXL,{}) or {}
    rows=[]
    for v in j.get("variants") or []:
        p=v.get("params") or {}
        x=v.get("summary") or {}
        h=(v.get("validation") or {}).get("holdout") or {}
        rows.append({
            "name":str(p.get("name") or ""),
            "trades":int(x.get("trades") or 0),
            "winRate":float(x.get("winRate") or 0),
            "avgPnl":float(x.get("avgPnl") or 0),
            "avgDailyReturnPct":float(x.get("avgDailyReturnPct") or 0),
            "target1PctDayRatePct":float(x.get("target1PctDayRatePct") or 0),
            "profitFactor":float(x.get("profitFactor") or 0),
            "compoundReturnPct":float(x.get("compoundReturnPct") or 0),
            "maxDrawdownPct":float(x.get("maxDrawdownPct") or 0),
            "holdoutTrades":int(h.get("trades") or 0),
            "holdoutAvgPnl":float(h.get("avgPnl") or 0),
            "holdoutCompoundReturnPct":float(h.get("compoundReturnPct") or 0),
            "holdoutTarget1PctDayRatePct":float(h.get("target1PctDayRatePct") or 0),
        })
    by={x["name"]:x for x in rows}
    base=by.get("baseline",{"avgPnl":0.0,"maxDrawdownPct":0.0,"holdoutAvgPnl":0.0})
    wf=j.get("walkForward") or {}
    wf_status=wf.get("status") or "collecting"
    oos_by={x.get("name"):(x.get("summary") or {}) for x in wf.get("oosVariants") or []}
    eligible=j.get("comparisonStatus")=="reviewable" and wf_status=="reviewable"
    candidates=[]
    for x in rows:
        if x["name"]=="baseline":
            continue
        all_edge=x["avgPnl"]-base["avgPnl"]
        hold_edge=x["holdoutAvgPnl"]-base["holdoutAvgPnl"]
        ox=oos_by.get(x["name"],{})
        ob=oos_by.get("baseline",{})
        oos_edge=float(ox.get("avgPnl") or 0)-float(ob.get("avgPnl") or 0)
        oos_trades=int(ox.get("trades") or 0)
        mdd_ok=x["maxDrawdownPct"]>=base["maxDrawdownPct"]-3.0
        review=(
            eligible and x["trades"]>=30 and x["holdoutTrades"]>=10 and oos_trades>=10
            and all_edge>=0.10 and hold_edge>=0.10 and oos_edge>=0.05 and mdd_ok
        )
        candidates.append({
            "name":x["name"],"status":"review" if review else "collecting",
            "allAvgEdgePct":all_edge,"holdoutAvgEdgePct":hold_edge,
            "trades":x["trades"],"holdoutTrades":x["holdoutTrades"],
            "target1PctDayRatePct":x["target1PctDayRatePct"],
            "holdoutTarget1PctDayRatePct":x["holdoutTarget1PctDayRatePct"],
            "oosAvgEdgePct":oos_edge,"oosTrades":oos_trades,
            "mddOk":mdd_ok,
        })
    candidates.sort(key=lambda x:(
        x["status"]!="review",-x["holdoutAvgEdgePct"],-x["allAvgEdgePct"],
        -x["holdoutTarget1PctDayRatePct"],x["name"]
    ))
    return {
        "status":"reviewable" if eligible else "collecting",
        "archiveDays":int(j.get("archiveDays") or 0),
        "validDays":int(j.get("validDays") or 0),
        "from":j.get("from"),"to":j.get("to"),
        "comparisonStatus":j.get("comparisonStatus") or "collecting",
        "rolling30":j.get("rolling30") or {},
        "variants":rows,"candidates":candidates,
        "autoPromotion":False,
        "targetNote":"Net +1% days are a research metric, not a guaranteed daily return.",
    }

def vts_report():
    j=load_json(VTS,{}) or {}
    out=[]
    for s in j.get("strategies") or []:
        out.append({
            "strategy":s.get("strategy"),
            "days":int(s.get("days") or 0),
            "internalTrades":int(s.get("internalTrades") or 0),
            "completeMatches":int(s.get("completeMatches") or 0),
            "avgRoundTripSlippageCostPct":s.get("avgRoundTripSlippageCostPct"),
            "avgBrokerCostRatePct":s.get("avgBrokerCostRatePct"),
            "avgObservedExecutionDragPct":s.get("avgObservedExecutionDragPct"),
            "frictionGapVsInternal025Pct":s.get("frictionGapVsInternal025Pct"),
            "calibrationStatus":s.get("calibrationStatus") or "collecting",
        })
    return {"generatedAt":j.get("generatedAt"),"strategies":out}

def main():
    now=datetime.now(KST)
    o=opening_report()
    d=daytrading_report()
    c=crypto_report()
    sx=soxl_report()
    v=vts_report()
    report={
        "schema":1,
        "generatedAt":now.isoformat(),
        "date":now.strftime("%Y-%m-%d"),
        "mode":"nightly-research-no-auto-promotion",
        "opening":o,
        "daytrading":d,
        "crypto":c,
        "soxl":sx,
        "execution":v,
        "guardrail":{
            "liveStrategyAutoChange":False,
            "note":"데이터는 매일 누적·비교하지만 기준전략은 자동 변경하지 않는다. 충분한 표본과 일관성이 확인되면 검토 후보만 올린다."
        }
    }
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/"latest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    (OUT/f"{report['date']}.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({
        "date":report["date"],
        "opening":{"status":o["status"],"archiveDays":o["archiveDays"],"reviewCandidates":[x["name"] for x in o["candidates"] if x["status"]=="review"]},
        "daytrading":{"status":d["status"],"eligibleDays":d["eligibleArchiveDays"],"baselineTrades":d["baselineTradeCount"],"reviewCandidates":[x["name"] for x in d["candidates"] if x["status"]=="review"]},
        "crypto":{"status":c["status"],"validDays":c["validDays"],"reviewCandidates":[x["name"] for x in c["candidates"] if x["status"]=="review"]},
        "soxl":{"status":sx["status"],"validDays":sx["validDays"],"reviewCandidates":[x["name"] for x in sx["candidates"] if x["status"]=="review"]},
        "vts":v["strategies"],
    },ensure_ascii=False,indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
