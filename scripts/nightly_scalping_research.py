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
import math
import statistics
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST=ZoneInfo("Asia/Seoul")
OPEN=Path("data/opening-history")
OPEN_OUTCOMES=Path("data/opening-research/signal-outcomes.json")
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
SHADOW_MIN_COUNT=10
SHADOW_SCORE_VERSION="v2-lifecycle"
AUTO_PROMOTION_DAYS=7
AUTO_PROMOTION_MIN_SCORE=60
OPENING_SHADOW_NAMES=[
    "hold_to_next_open","today_combo_v1","pb_max_0.5","amount_1.5","entry_by_0915",
    "entry_by_0920","gap_3_6","vol_1.5","stop_0.7","tp_1.0",
    "pb_max_0.7","amount_1.8","entry_by_0910","stop_0.8_tp_1.8",
]

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

def _clip(v, lo, hi):
    return max(lo,min(hi,float(v)))

def shadow_score(all_edge, validation_edge, recent_edge, risk_ok, trades, min_trades):
    """0~100 research ranking score. Low samples shrink every edge back toward neutral 50."""
    min_trades=max(1,int(min_trades or 1))
    sample_factor=_clip(float(trades or 0)/min_trades,0.0,1.0)
    all_component=math.tanh(float(all_edge or 0)/0.20)
    validation_component=math.tanh(float(validation_edge or 0)/0.20)
    recent_component=math.tanh(float(recent_edge or 0)/0.75)
    risk_component=1.0 if risk_ok else -1.0
    raw=50.0+20.0*all_component+25.0*validation_component+10.0*recent_component+5.0*risk_component
    score=50.0+(raw-50.0)*sample_factor
    return {
        "score":round(_clip(score,0.0,100.0),2),
        "sampleFactor":round(sample_factor,4),
        "sampleReady":sample_factor>=1.0,
        "parts":{
            "allEdgePct":float(all_edge or 0),
            "validationEdgePct":float(validation_edge or 0),
            "recentEdgePct":float(recent_edge or 0),
            "riskOk":bool(risk_ok),
            "trades":int(trades or 0),
            "minTrades":min_trades,
        }
    }

def rank_candidates(rows):
    # Zero-evidence placeholders are always last even though their neutral score is 50.
    ranked=sorted(rows,key=lambda x:(
        int((x.get("scoreParts") or {}).get("trades") or x.get("trades") or x.get("allTrades") or 0)<=0,
        -float(x.get("researchScore") or 0),
        -float(x.get("sampleFactor") or 0),
        str(x.get("name") or "")
    ))
    for i,x in enumerate(ranked,1):
        x["rank"]=i
    return ranked

def ranking_rule():
    return {
        "version":SHADOW_SCORE_VERSION,
        "minShadowStrategies":SHADOW_MIN_COUNT,
        "formula":"50 + sampleFactor × (20·tanh(allEdge/0.20) + 25·tanh(validationEdge/0.20) + 10·tanh(recentEdge/0.75) + 5·riskSign), clipped 0~100",
        "sampleFactor":"min(1, trades/minTrades)",
        "note":"Rank is research triage only. Backtest/reconstruction and live-forward evidence stay separate; baseline is never auto-promoted.",
    }

def _rank1_name(report):
    rows=(report or {}).get("candidates") or []
    ranked=sorted(rows,key=lambda x:int(x.get("rank") or 999999))
    return str(ranked[0].get("name") or "") if ranked else ""

def _previous_reports(limit=14):
    out=[]
    for p in sorted(OUT.glob("????-??-??.json"))[-limit:]:
        j=load_json(p,{}) or {}
        if j.get("date"):
            out.append(j)
    return out

def apply_shadow_lifecycle(kind, report):
    rows=sorted((report or {}).get("candidates") or [],key=lambda x:int(x.get("rank") or 999999))
    active=rows[:SHADOW_MIN_COUNT]
    reserve=rows[SHADOW_MIN_COUNT:]
    previous=_previous_reports()
    prev_lifecycle=((previous[-1].get(kind) or {}).get("lifecycle") or {}) if previous else {}
    prev_active=set(prev_lifecycle.get("active") or [])
    active_names=[str(x.get("name") or "") for x in active if x.get("name")]
    reserve_names=[str(x.get("name") or "") for x in reserve if x.get("name")]
    active_set=set(active_names)

    admitted=[x for x in active_names if x not in prev_active] if prev_active else []
    retired=[x for x in prev_active if x not in active_set]
    for x in rows:
        name=str(x.get("name") or "")
        if name in active_set:
            x["lifecycleStatus"]="active"
            x["lifecycleReason"]="상위 %d 경쟁군 유지"%SHADOW_MIN_COUNT
        else:
            x["lifecycleStatus"]="retired"
            x["lifecycleReason"]="하위 순위 자동퇴출 · 예비후보로 전환"

    leader=active_names[0] if active_names else ""
    prior_leaders=[]
    for old in previous[-(AUTO_PROMOTION_DAYS-1):]:
        old_strategy=old.get(kind) or {}
        old_lifecycle=old_strategy.get("lifecycle") or {}
        prior_leaders.append(str(old_lifecycle.get("leader") or _rank1_name(old_strategy) or ""))
    leader_series=prior_leaders+[leader]
    leader_days=0
    for name in reversed(leader_series):
        if leader and name==leader:
            leader_days+=1
        else:
            break

    top=active[0] if active else {}
    risk_ok=top.get("mddOk") is not False and top.get("profitFactorOk") is not False
    gate_ok=(
        bool(leader)
        and leader_days>=AUTO_PROMOTION_DAYS
        and top.get("status")=="review"
        and top.get("sampleReady") is True
        and risk_ok
        and float(top.get("researchScore") or 0)>=AUTO_PROMOTION_MIN_SCORE
        and not (kind=="opening" and leader=="hold_to_next_open")
    )
    missing=[]
    if leader_days<AUTO_PROMOTION_DAYS: missing.append("1위 유지 %d/%d일"%(leader_days,AUTO_PROMOTION_DAYS))
    if top.get("status")!="review": missing.append("검토 게이트 미통과")
    if top.get("sampleReady") is not True: missing.append("최소 표본 미충족")
    if not risk_ok: missing.append("위험조건 미충족")
    if float(top.get("researchScore") or 0)<AUTO_PROMOTION_MIN_SCORE: missing.append("점수 %.2f<%d"%(float(top.get("researchScore") or 0),AUTO_PROMOTION_MIN_SCORE))
    if kind=="opening" and leader=="hold_to_next_open": missing.append("연구전용 전략")

    report["lifecycle"]={
        "version":"v1",
        "minimumActive":SHADOW_MIN_COUNT,
        "candidatePoolCount":len(rows),
        "active":active_names,
        "reserve":reserve_names,
        "admittedToday":admitted,
        "retiredToday":retired,
        "leader":leader or None,
        "leaderDays":leader_days,
        "recentLeaders":leader_series[-AUTO_PROMOTION_DAYS:],
        "autoPromotion":{
            "enabled":True,
            "requiredLeaderDays":AUTO_PROMOTION_DAYS,
            "minScore":AUTO_PROMOTION_MIN_SCORE,
            "eligible":gate_ok,
            "variant":leader or None,
            "score":float(top.get("researchScore") or 0) if top else None,
            "reason":"자동승격 조건 충족" if gate_ok else " · ".join(missing) or "후보 없음",
            "effective":"next-new-session",
        },
        "changeLog":[
            *[{"type":"admit","variant":x,"reason":"상위 %d 진입으로 신규 투입"%SHADOW_MIN_COUNT} for x in admitted],
            *[{"type":"retire","variant":x,"reason":"상위 %d 이탈로 자동 퇴출"%SHADOW_MIN_COUNT} for x in retired],
        ],
    }
    return report

def opening_condition_bucket(name, value):
    try:
        v=float(value)
    except Exception:
        return "unknown"
    if name=="gap":
        if v<3: return "2~3%"
        if v<4: return "3~4%"
        if v<5: return "4~5%"
        return "5~7%"
    if name=="pullback":
        if v<=0.5: return "0.3~0.5%"
        if v<=0.7: return "0.5~0.7%"
        return "0.7~1.0%"
    if name=="volume":
        if v<1.5: return "1.0~1.5x"
        if v<2.0: return "1.5~2.0x"
        return "2.0x+"
    if name=="amount":
        if v<1.5: return "1.2~1.5x"
        if v<2.0: return "1.5~2.0x"
        return "2.0x+"
    if name=="rank":
        if v<=20: return "Top1~20"
        if v<=50: return "Top21~50"
        return "Top51~100"
    return str(value)


def opening_entry_bucket(hm):
    h=int(hm or 0)
    if h<=910: return "09:03~09:10"
    if h<=920: return "09:11~09:20"
    return "09:21~09:30"


def live_signal_stats(rows):
    labelled=[x for x in rows if (x.get("reconstructedOutcome") or {}).get("pnl") is not None]
    pn=[float(x["reconstructedOutcome"]["pnl"]) for x in labelled]
    wins=[x for x in pn if x>0]
    losses=[x for x in pn if x<0]
    path=[x.get("pathOutcome") or {} for x in rows]
    complete=[x for x in path if x.get("outcomeWindowComplete")]
    mf=[float(x["mfePct"]) for x in complete if x.get("mfePct") is not None]
    ma=[float(x["maePct"]) for x in complete if x.get("maePct") is not None]
    def hit(key):
        return sum(1 for x in complete if x.get(key) is not None)
    n=len(complete)
    return {
        "signals":len(rows),
        "labelled":len(labelled),
        "pathLabelled":len(complete),
        "winRate":sum(1 for x in pn if x>0)/len(pn)*100 if pn else 0.0,
        "avgWin":statistics.fmean(wins) if wins else 0.0,
        "avgLoss":statistics.fmean(losses) if losses else 0.0,
        "expectancyPct":statistics.fmean(pn) if pn else 0.0,
        "avgMfe":statistics.fmean(mf) if mf else None,
        "avgMae":statistics.fmean(ma) if ma else None,
        "pathComplete":n,
        "plus1HitRate":hit("hitPlus1Time")/n*100 if n else 0.0,
        "plus2HitRate":hit("hitPlus2Time")/n*100 if n else 0.0,
        "minus1HitRate":hit("hitMinus1Time")/n*100 if n else 0.0,
        "minus2HitRate":hit("hitMinus2Time")/n*100 if n else 0.0,
    }


def live_group_stats(rows, key_fn):
    groups={}
    for x in rows:
        groups.setdefault(str(key_fn(x) or "unknown"),[]).append(x)
    return [{"group":k,**live_signal_stats(v)} for k,v in sorted(groups.items())]


def opening_report():
    days=[]
    books={}
    live=[]
    scan_count=0
    partial_scans=0
    for p in sorted(OPEN.glob("*.json")):
        j=load_json(p,{}) or {}
        d=str(j.get("date") or p.stem)
        if not d:
            continue
        days.append(d)
        ledger=j.get("liveSignalLedger") or {}
        scans=ledger.get("scans") or []
        scan_count+=len(scans)
        partial_scans+=sum(1 for x in scans if x.get("partial"))
        for rec in j.get("signalRecords") or []:
            if str((rec or {}).get("date") or d)!=d:
                continue
            sig=(rec or {}).get("signal") or {}
            live.append({
                "signalId":rec.get("signalId"),
                "date":d,
                "variant":str(rec.get("variant") or "baseline"),
                "strategyVersion":str(rec.get("strategyVersion") or sig.get("strategyVersion") or "unknown"),
                "strategyParams":rec.get("strategyParams") or sig.get("strategyParams"),
                "alertDelivery":rec.get("alertDelivery"),
                "code":str(rec.get("code") or sig.get("code") or ""),
                "name":rec.get("name") or sig.get("name"),
                "entryTime":sig.get("entryTime"),
                "signal":sig,
                "reconstructedOutcome":rec.get("outcome"),
                "pathOutcome":None,
            })
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
        return {"status":"collecting","archiveDays":0,"variants":[],"candidates":[],"rankingRule":ranking_rule()}

    # Future shadow slots are visible from day zero; real live-forward evidence fills them prospectively.
    for name in OPENING_SHADOW_NAMES:
        books.setdefault(name,[])

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
        score=shadow_score(all_edge,d20_edge,d20_edge,True,a["trades"],OPEN_MIN_CAND_TRADES)
        candidates.append({
            "name":v["name"],
            "status":"review" if review else "collecting",
            "allAvgEdgePct":all_edge,
            "last20AvgEdgePct":d20_edge,
            "allTrades":a["trades"],
            "last20Trades":w20["trades"],
            "researchScore":score["score"],
            "sampleFactor":score["sampleFactor"],
            "sampleReady":score["sampleReady"],
            "scoreParts":score["parts"],
        })
    candidates=rank_candidates(candidates)

    # Join exact live BUY signals to the richer KIS 30-minute path labels generated later.
    outcome_data=load_json(OPEN_OUTCOMES,{}) or {}
    outcome_map={}
    for x in outcome_data.get("records") or []:
        key=(str(x.get("date") or ""),str(x.get("variant") or "baseline"),
             str(x.get("code") or ""),int(x.get("entryTime") or 0))
        outcome_map[key]=x
    for x in live:
        key=(x["date"],x["variant"],x["code"],int(x.get("entryTime") or 0))
        x["pathOutcome"]=outcome_map.get(key)

    delivery_failures=sum(1 for x in live if (x.get("alertDelivery") or {}).get("error"))
    live_report={
        "source":"exact-cloudflare-live-buy-signals",
        "signals":len(live),
        "labelledSignals":sum(1 for x in live if (x.get("reconstructedOutcome") or {}).get("pnl") is not None),
        "pathLabelledSignals":sum(1 for x in live if (x.get("pathOutcome") or {}).get("outcomeWindowComplete")),
        "deliveryFailures":delivery_failures,
        "scanCount":scan_count,
        "partialScans":partial_scans,
        "overall":live_signal_stats(live),
        "byVariant":live_group_stats(live,lambda x:x.get("variant")),
        "byStrategyVersion":live_group_stats(live,lambda x:x.get("strategyVersion")),
        "byEntryTime":live_group_stats(live,lambda x:opening_entry_bucket(x.get("entryTime"))),
        "byGap":live_group_stats(live,lambda x:opening_condition_bucket("gap",(x.get("signal") or {}).get("gap"))),
        "byPullback":live_group_stats(live,lambda x:opening_condition_bucket("pullback",(x.get("signal") or {}).get("pullbackPct"))),
        "byVolume":live_group_stats(live,lambda x:opening_condition_bucket("volume",(x.get("signal") or {}).get("volRatio"))),
        "byAmount":live_group_stats(live,lambda x:opening_condition_bucket("amount",(x.get("signal") or {}).get("amountRatio"))),
        "byRank":live_group_stats(live,lambda x:opening_condition_bucket("rank",(x.get("signal") or {}).get("rank"))),
        "note":"Exact live signals are never replaced by reconstructed history. 09:30 strategy PnL and later KIS 30-minute path labels remain separate fields.",
    }
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
        "rankingRule":ranking_rule(),
        "configuredShadowCount":len(OPENING_SHADOW_NAMES),
        "liveSignals":live_report,
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
    base=by.get("baseline",{"avgPnl":0.0,"profitFactor":0.0,"portfolioMddPct":0.0,"last20PortfolioReturnPct":0.0})
    eligible=j.get("comparisonStatus")=="eligible"
    wf_obj=j.get("walkForward") or {}
    wf=wf_obj.get("status")=="reviewable"
    oos_by={x.get("name"):(x.get("summary") or {}) for x in wf_obj.get("oosVariants") or []}
    base_oos=oos_by.get("baseline",{})
    candidates=[]
    for x in rows:
        if x["name"]=="baseline":
            continue
        edge=x["avgPnl"]-base["avgPnl"]
        mdd_ok=x["portfolioMddPct"]>=base["portfolioMddPct"]-1.0
        pf_ok=x["profitFactor"]>=base["profitFactor"]
        ox=oos_by.get(x["name"],{})
        validation_edge=float(ox.get("avgPnl") or 0)-float(base_oos.get("avgPnl") or 0) if ox and base_oos else 0.0
        recent_edge=x["last20PortfolioReturnPct"]-base.get("last20PortfolioReturnPct",0.0)
        risk_ok=mdd_ok and pf_ok
        score=shadow_score(edge,validation_edge,recent_edge,risk_ok,x["trades"],30)
        review=eligible and wf and x["trades"]>=30 and edge>=0.10 and mdd_ok and pf_ok
        candidates.append({
            "name":x["name"],"status":"review" if review else "collecting",
            "avgPnlEdgePct":edge,"validationAvgEdgePct":validation_edge,"trades":x["trades"],
            "last20PortfolioReturnPct":x["last20PortfolioReturnPct"],"recentEdgePct":recent_edge,
            "mddOk":mdd_ok,"profitFactorOk":pf_ok,
            "researchScore":score["score"],"sampleFactor":score["sampleFactor"],
            "sampleReady":score["sampleReady"],"scoreParts":score["parts"],
        })
    candidates=rank_candidates(candidates)
    return {
        "status":"reviewable" if eligible and wf else "collecting",
        "archiveDays":int(j.get("archiveDays") or 0),
        "eligibleArchiveDays":int(j.get("eligibleArchiveDays") or 0),
        "baselineTradeCount":int(j.get("baselineTradeCount") or 0),
        "comparisonStatus":j.get("comparisonStatus") or "collecting",
        "walkForwardStatus":(j.get("walkForward") or {}).get("status") or "collecting",
        "from":j.get("from"),"to":j.get("to"),
        "variants":rows,"candidates":candidates,
        "rankingRule":ranking_rule(),
        "configuredShadowCount":max(0,len(rows)-1),
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
        recent_edge=x["holdoutCompoundReturnPct"]-base.get("holdoutCompoundReturnPct",0.0)
        score=shadow_score(all_edge,hold_edge,recent_edge,mdd_ok,x["trades"],50)
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
            "recentEdgePct":recent_edge,"mddOk":mdd_ok,
            "researchScore":score["score"],"sampleFactor":score["sampleFactor"],
            "sampleReady":score["sampleReady"],"scoreParts":score["parts"],
        })
    candidates=rank_candidates(candidates)
    return {
        "status":"reviewable" if eligible else "collecting",
        "archiveDays":int(j.get("archiveDays") or 0),
        "validDays":int(j.get("validDays") or 0),
        "from":j.get("from"),"to":j.get("to"),
        "comparisonStatus":j.get("comparisonStatus") or "collecting",
        "validationModel":"70/30 holdout + rolling30",
        "rolling30":j.get("rolling30") or {},
        "variants":rows,"candidates":candidates,
        "rankingRule":ranking_rule(),
        "configuredShadowCount":max(0,len(rows)-1),
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
        validation_edge=(hold_edge+oos_edge)/2.0 if oos_trades>0 else hold_edge
        recent_edge=x["holdoutCompoundReturnPct"]-base.get("holdoutCompoundReturnPct",0.0)
        score=shadow_score(all_edge,validation_edge,recent_edge,mdd_ok,x["trades"],30)
        review=(
            eligible and x["trades"]>=30 and x["holdoutTrades"]>=10 and oos_trades>=10
            and all_edge>=0.10 and hold_edge>=0.10 and oos_edge>=0.05 and mdd_ok
        )
        candidates.append({
            "name":x["name"],"status":"review" if review else "collecting",
            "allAvgEdgePct":all_edge,"holdoutAvgEdgePct":hold_edge,
            "validationAvgEdgePct":validation_edge,
            "trades":x["trades"],"holdoutTrades":x["holdoutTrades"],
            "target1PctDayRatePct":x["target1PctDayRatePct"],
            "holdoutTarget1PctDayRatePct":x["holdoutTarget1PctDayRatePct"],
            "oosAvgEdgePct":oos_edge,"oosTrades":oos_trades,
            "recentEdgePct":recent_edge,"mddOk":mdd_ok,
            "researchScore":score["score"],"sampleFactor":score["sampleFactor"],
            "sampleReady":score["sampleReady"],"scoreParts":score["parts"],
        })
    candidates=rank_candidates(candidates)
    return {
        "status":"reviewable" if eligible else "collecting",
        "archiveDays":int(j.get("archiveDays") or 0),
        "validDays":int(j.get("validDays") or 0),
        "from":j.get("from"),"to":j.get("to"),
        "comparisonStatus":j.get("comparisonStatus") or "collecting",
        "rolling30":j.get("rolling30") or {},
        "variants":rows,"candidates":candidates,
        "rankingRule":ranking_rule(),
        "configuredShadowCount":max(0,len(rows)-1),
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
    o=apply_shadow_lifecycle("opening",opening_report())
    d=apply_shadow_lifecycle("daytrading",daytrading_report())
    c=apply_shadow_lifecycle("crypto",crypto_report())
    sx=apply_shadow_lifecycle("soxl",soxl_report())
    v=vts_report()
    report={
        "schema":1,
        "generatedAt":now.isoformat(),
        "date":now.strftime("%Y-%m-%d"),
        "mode":"nightly-research-auto-lifecycle",
        "opening":o,
        "daytrading":d,
        "crypto":c,
        "soxl":sx,
        "execution":v,
        "guardrail":{
            "liveStrategyAutoChange":True,
            "autoPromotionLeaderDays":AUTO_PROMOTION_DAYS,
            "autoPromotionMinScore":AUTO_PROMOTION_MIN_SCORE,
            "note":"최근 7일 연구에서 같은 전략이 계속 1위이고 검토·표본·위험·점수 게이트를 모두 통과할 때만 다음 새 세션부터 자동승격한다."
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
