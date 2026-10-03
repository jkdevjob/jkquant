#!/usr/bin/env python3
"""Nightly research rollup for opening + day-trading + bitcoin + SOXL strategies.

Reads immutable/reconstructed paper research from scalping-data and produces a
single daily research report plus a persistent shadow-strategy lifecycle.

Evolution policy:
- keep at least 10 active shadow candidates per strategy;
- retire only sample-ready candidates that repeatedly fail validation/risk gates;
- automatically activate the best reserve candidate after a retirement;
- track the #1 active candidate across distinct research sessions;
- a candidate may request automatic main promotion only after 7 consecutive
  distinct research sessions at rank #1 AND all existing promotion gates pass.

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
SHADOW_SCORE_VERSION="v1"
OPENING_SHADOW_NAMES=[
    "hold_to_next_open","today_combo_v1","pb_max_0.5","amount_1.5","entry_by_0915",
    "entry_by_0920","gap_3_6","vol_1.5","stop_0.7","tp_1.0",
    "pb_max_0.7","amount_1.8","entry_by_0910","gap_2_5","vol_1.8",
    "combo_pb07_amt15","combo_e0920_vol15","gap_25_55","stop_0.9_tp_1.8","combo_pb05_e0920",
]
CANDIDATE_POOLS={
    "opening":OPENING_SHADOW_NAMES,
    "daytrading":["vol_2.0","lookback_30","vwap_slope_0.2","entry_by_1400","session_min_2",
                  "stop_0.8","tp_1.5","vol_1.2","lookback_10","max_trades_1",
                  "vwap_slope_0.15","entry_by_1330","session_max_6","vol_1.8","lookback_15",
                  "combo_vol18_lb15","combo_slope15_e1400","session_min_1_5","session_max_5","combo_lb30_vol12"],
    "crypto":["no_vwap","vol_1.0","vol_1.5","range_15m","range_30m","stop_0.3_tp_0.6",
              "stop_0.7_tp_1.4","hold_30m","hold_120m","entry_by_1800",
              "range_10m","vol_1.3","stop_0.4_tp_0.8","hold_90m","entry_by_2000"],
    "soxl":["range_5m","range_30m","vol_0.8","vol_1.2","no_vwap","stop_0.8_tp_1.6",
            "stop_1.5_tp_3.0","hold_45m","hold_120m","entry_by_1030",
            "range_10m","vol_1.5","stop_1.0_tp_2.0","hold_60m","entry_by_1100"],
}
ACTIVE_SHADOW_COUNT=10
RETIRE_STREAK_REQUIRED=3
AUTO_PROMOTION_LEADER_SESSIONS=7
AUTO_PROMOTION_MIN_SCORE=60.0

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
        "note":"Rank uses sample-shrunk research evidence. Active candidate lifecycle is separate from reserve/retired history.",
    }


def _candidate_trades(x):
    return int((x.get("scoreParts") or {}).get("trades") or x.get("trades") or x.get("allTrades") or 0)

def _validation_edge(x):
    for k in ("validationAvgEdgePct","holdoutAvgEdgePct","last20AvgEdgePct","oosAvgEdgePct"):
        if x.get(k) is not None:
            try: return float(x.get(k) or 0)
            except Exception: pass
    return 0.0

def _risk_ok(x):
    return x.get("mddOk") is not False and x.get("profitFactorOk") is not False

def _candidate_sort_key(x):
    return (
        _candidate_trades(x)<=0,
        -float(x.get("researchScore") or 0),
        -float(x.get("sampleFactor") or 0),
        str(x.get("name") or ""),
    )

def evolve_lifecycle(kind, report, previous=None):
    pool=list(CANDIDATE_POOLS[kind])
    previous=previous or {}
    retired=[x for x in (previous.get("retired") or []) if str(x.get("name") or "") in pool]
    retired_names={str(x.get("name") or "") for x in retired}
    active=[x for x in (previous.get("activeCandidates") or pool[:ACTIVE_SHADOW_COUNT])
            if x in pool and x not in retired_names]
    for name in pool:
        if len(active)>=ACTIVE_SHADOW_COUNT: break
        if name not in active and name not in retired_names: active.append(name)

    by={str(x.get("name") or ""):x for x in (report.get("candidates") or [])}
    evidence=str(report.get("to") or report.get("from") or "")
    is_new_evidence=bool(evidence) and evidence!=str(previous.get("lastEvidenceDate") or "")
    poor=dict(previous.get("poorStreaks") or {})
    changes=list(previous.get("recentChanges") or [])[-19:]

    if is_new_evidence:
        reserve=[x for x in pool if x not in active and x not in retired_names]
        retireable=[]
        for name in list(active):
            row=by.get(name) or {}
            sample_ready=row.get("sampleReady") is True
            weak=sample_ready and ((not _risk_ok(row)) or (
                float(row.get("researchScore") or 0)<40.0 and _validation_edge(row)<0
            ))
            poor[name]=(int(poor.get(name) or 0)+1) if weak else 0
            if poor[name]>=RETIRE_STREAK_REQUIRED:
                retireable.append(name)

        # Worst persistent failures leave first; every retirement immediately gets a reserve replacement.
        retireable.sort(key=lambda n:(
            float((by.get(n) or {}).get("researchScore") or 0),
            _validation_edge(by.get(n) or {}),
            n
        ))
        for name in retireable:
            reserve=[x for x in pool if x not in active and x not in retired_names]
            if not reserve: break
            active.remove(name)
            row=by.get(name) or {}
            reason=("위험조건 반복 실패" if not _risk_ok(row)
                    else f"검증우위 {_validation_edge(row):+.3f}% · 연구점수 {float(row.get('researchScore') or 0):.1f}가 "
                         f"{RETIRE_STREAK_REQUIRED}개 연구세션 연속 부진")
            rec={"name":name,"retiredAt":evidence,"reason":reason}
            retired.append(rec);retired_names.add(name);poor[name]=0
            changes.append({"date":evidence,"type":"retired","name":name,"reason":reason})

            reserve_rows=[by.get(n) or {"name":n} for n in pool if n not in active and n not in retired_names]
            reserve_rows.sort(key=_candidate_sort_key)
            if reserve_rows:
                replacement=str(reserve_rows[0].get("name") or "")
                if replacement:
                    active.append(replacement)
                    changes.append({"date":evidence,"type":"activated","name":replacement,
                                    "reason":f"{name} 퇴출 후 경쟁군 {ACTIVE_SHADOW_COUNT}개 유지"})

    # Active leaderboard is independent from reserve/retired research rows.
    active_rows=[by.get(n) or {"name":n,"researchScore":0,"sampleFactor":0} for n in active]
    active_rows.sort(key=_candidate_sort_key)
    for i,row in enumerate(active_rows,1):
        row["activeRank"]=i

    leader_name=str(active_rows[0].get("name") or "") if active_rows else ""
    prev_leader=previous.get("leader") or {}
    leader_dates=list(prev_leader.get("dates") or [])
    if is_new_evidence:
        if leader_name and leader_name==str(prev_leader.get("name") or ""):
            if evidence not in leader_dates: leader_dates.append(evidence)
        else:
            leader_dates=[evidence] if leader_name else []
    leader_dates=leader_dates[-AUTO_PROMOTION_LEADER_SESSIONS:]
    consecutive=len(leader_dates) if leader_name else 0
    leader_row=by.get(leader_name) or {}
    promotion_gate=(
        leader_row.get("status")=="review"
        and leader_row.get("sampleReady") is True
        and _risk_ok(leader_row)
        and float(leader_row.get("researchScore") or 0)>=AUTO_PROMOTION_MIN_SCORE
        and not (kind=="opening" and leader_name=="hold_to_next_open")
    )
    ready=consecutive>=AUTO_PROMOTION_LEADER_SESSIONS and promotion_gate
    if not leader_name:
        auto_reason="활성 후보 없음"
    elif consecutive<AUTO_PROMOTION_LEADER_SESSIONS:
        auto_reason=f"1위 유지 {consecutive}/{AUTO_PROMOTION_LEADER_SESSIONS} 연구세션"
    elif not promotion_gate:
        auto_reason="1위 유지 충족, 기존 표본·검증·위험·점수 승격조건 미충족"
    else:
        auto_reason="7개 연속 연구세션 1위 + 기존 승격조건 통과"

    life={
        "schema":1,
        "candidateFactory":"whitelisted-parameter-neighborhood-v1",
        "minimumActive":ACTIVE_SHADOW_COUNT,
        "candidatePoolSize":len(pool),
        "activeCandidates":active,
        "reserveCandidates":[x for x in pool if x not in active and x not in retired_names],
        "retired":retired[-50:],
        "poorStreaks":poor,
        "lastEvidenceDate":evidence or previous.get("lastEvidenceDate"),
        "leader":{"name":leader_name,"consecutiveResearchSessions":consecutive,
                  "requiredResearchSessions":AUTO_PROMOTION_LEADER_SESSIONS,"dates":leader_dates},
        "autoPromotionCandidate":leader_name if ready else None,
        "autoPromotionReady":ready,
        "autoPromotionReason":auto_reason,
        "recentChanges":changes[-20:],
        "retirementRule":f"sampleReady 이후 위험 실패 또는 점수<40·검증우위<0 상태가 {RETIRE_STREAK_REQUIRED}개 서로 다른 연구세션 연속",
        "replacementRule":"퇴출 즉시 예비 후보 중 연구순위가 가장 높은 후보를 활성화해 최소 10개 유지",
    }
    for x in report.get("candidates") or []:
        name=str(x.get("name") or "")
        x["lifecycleStatus"]="retired" if name in retired_names else ("active" if name in active else "reserve")
        x["activeRank"]=next((i for i,r in enumerate(active_rows,1) if str(r.get("name") or "")==name),None)
    report["lifecycle"]=life
    report["autoPromotion"]=True
    return life

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
            "autoPromotion":True,
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
        "autoPromotion":True,
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
    o=opening_report()
    d=daytrading_report()
    c=crypto_report()
    sx=soxl_report()
    v=vts_report()
    OUT.mkdir(parents=True,exist_ok=True)
    state_path=OUT/"lifecycle.json"
    state=load_json(state_path,{"schema":1,"strategies":{}}) or {"schema":1,"strategies":{}}
    strategies=state.setdefault("strategies",{})
    for kind,obj in (("opening",o),("daytrading",d),("crypto",c),("soxl",sx)):
        strategies[kind]=evolve_lifecycle(kind,obj,strategies.get(kind) or {})
    state["updatedAt"]=now.isoformat()
    state_path.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding="utf-8")

    report={
        "schema":2,
        "generatedAt":now.isoformat(),
        "date":now.strftime("%Y-%m-%d"),
        "mode":"nightly-shadow-auto-evolution",
        "opening":o,
        "daytrading":d,
        "crypto":c,
        "soxl":sx,
        "execution":v,
        "guardrail":{
            "liveStrategyAutoChange":True,
            "autoPromotionRule":"7 distinct research sessions at active rank #1 plus all existing promotion gates",
            "note":"부진 후보 자동퇴출·예비후보 자동투입은 연구 경쟁군에만 적용한다. 메인전략 자동변경은 7연속 1위와 기존 표본/검증/위험/점수 조건을 모두 통과한 경우에만 다음 새 세션부터 적용한다."
        }
    }
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
