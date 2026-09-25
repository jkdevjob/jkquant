#!/usr/bin/env python3
"""Cumulative paper backtest for the day-trading research tab.

Baseline hypothesis: VWAP trend + 20-minute high breakout after a 10:00 universe
snapshot.  The signal is formed at a completed minute close and the simulated
entry is the NEXT minute open, avoiding same-bar lookahead.

Research only. No broker orders are placed.
"""
from __future__ import annotations
import csv, gzip, json, statistics
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

KST=ZoneInfo("Asia/Seoul")
DATA=Path("data/daytrading")
OUT=Path("data/daytrading-research")

# Primary research is meant to use a universe frozen around 10:00 KST.
# GitHub scheduled jobs can be delayed by hours; those late snapshots are still
# archived for observation, but must not be mixed into the primary comparison.
PRIMARY_SNAPSHOT_MAX_HM=1015

@dataclass(frozen=True)
class Params:
    name:str
    top_n:int=100
    start_hm:int=1000
    entry_cutoff:int=1430
    lookback:int=20
    slope_n:int=10
    min_session_ret:float=1.0
    max_session_ret:float=8.0
    min_vwap_slope:float=0.10
    vol_mult:float=1.5
    stop:float=1.0
    take_profit:float=2.0
    final_exit:int=1510
    fee:float=0.25
    max_trades:int=3

VARIANTS=[
    Params("baseline"),
    Params("vol_2.0",vol_mult=2.0),
    Params("lookback_30",lookback=30),
    Params("vwap_slope_0.2",min_vwap_slope=0.20),
    Params("entry_by_1400",entry_cutoff=1400),
    Params("session_min_2",min_session_ret=2.0),
    Params("stop_0.8",stop=0.8),
    Params("tp_1.5",take_profit=1.5),
]

def hm(t):
    s=str(t or "")
    if len(s)>=12 and s[-6:].isdigit():
        return int(s[-6:-2])
    return -1

def load_days():
    out=[]
    for p in sorted(DATA.glob("*/*.json.gz")):
        try:
            with gzip.open(p,"rt",encoding="utf-8") as f:
                j=json.load(f)
            if j.get("date") and j.get("universe"):
                out.append(j)
        except Exception as e:
            print("skip",p,e)
    return out

def split_primary_days(all_days):
    eligible=[]
    excluded=[]
    for d in all_days:
        sh=int(d.get("snapshotHm") or 0)
        if 0 < sh <= PRIMARY_SNAPSHOT_MAX_HM:
            eligible.append(d)
        else:
            excluded.append({
                "date":d.get("date"),
                "snapshotHm":sh or None,
                "reason":"late_snapshot" if sh else "missing_snapshot_time",
            })
    return eligible, excluded


def bars_of(row):
    a=[]
    for b in row.get("bars") or []:
        x={
            "hm":hm(b.get("t")),
            "o":float(b.get("o") or b.get("c") or 0),
            "h":float(b.get("h") or b.get("c") or 0),
            "l":float(b.get("l") or b.get("c") or 0),
            "c":float(b.get("c") or 0),
            "v":float(b.get("v") or 0),
        }
        if 900<=x["hm"]<=1520 and x["c"]>0:
            a.append(x)
    a.sort(key=lambda z:z["hm"])
    return a

def time_bucket(h):
    if h < 1100: return "10:00~10:59"
    if h < 1300: return "11:00~12:59"
    if h < 1400: return "13:00~13:59"
    return "14:00+"


def bucket_value(v, cuts, labels):
    for cut,label in zip(cuts,labels):
        if v < cut: return label
    return labels[-1]


def benchmark_context(day, signal_hm):
    vals={}
    for b in day.get("benchmarks") or []:
        a=bars_of(b)
        if not a: continue
        op=a[0]["o"] or a[0]["c"]
        prior=[x for x in a if x["hm"]<=signal_hm]
        if op>0 and prior:
            vals[str(b.get("code") or "")]=(prior[-1]["c"]/op-1)*100
    k200=vals.get("069500")
    kq=vals.get("229200")
    if k200 is None or kq is None:
        regime="unknown"
    elif k200>0 and kq>0:
        regime="both_up"
    elif k200<0 and kq<0:
        regime="both_down"
    else:
        regime="mixed"
    return {"marketRegime":regime,"k200Ret":k200,"kosdaq150Ret":kq}


def path_metrics(a, entry_i, entry, final_hm):
    post=[z for z in a[entry_i:] if z["hm"]<=final_hm]
    if not post or entry<=0:
        return {}
    best=max(post,key=lambda z:z["h"])
    worst=min(post,key=lambda z:z["l"])
    out={
        "mfePct":(best["h"]/entry-1)*100,
        "mfeTime":best["hm"],
        "maePct":(worst["l"]/entry-1)*100,
        "maeTime":worst["hm"],
    }
    for n in (1,3,5,10,20):
        idx=entry_i+n
        key=f"fwd{n}mPct"
        out[key]=((a[idx]["c"]/entry-1)*100) if idx<len(a) else None
    return out


def first_trade(day,row,p:Params):
    if int(row.get("rank") or 999999)>p.top_n:
        return None
    a=bars_of(row)
    if len(a)<max(p.lookback,p.slope_n)+3:
        return None
    # Live Naver minute feed has close+volume only. Use the completed 09:00
    # minute close as the signal-model session base so historical signals match.
    day_open=a[0]["c"]
    if day_open<=0:
        return None

    # Cumulative VWAP known at each completed minute.
    vwap=[]
    pv=vv=0.0
    for x in a:
        pv+=x["c"]*x["v"]; vv+=x["v"]
        vwap.append(pv/max(vv,1.0))

    snapshot_hm=int(day.get("snapshotHm") or 1000)
    # A late snapshot may only govern later signals. Five minutes gives the saved
    # universe time to precede the first evaluated completed bar.
    start=max(p.start_hm,snapshot_hm+5)

    for i in range(max(p.lookback,p.slope_n),len(a)-1):
        x=a[i]
        if x["hm"]<start:
            continue
        if x["hm"]>p.entry_cutoff:
            break

        prev=a[i-p.lookback:i]
        prior_high=max(z["c"] for z in prev)
        avg_vol=sum(z["v"] for z in prev)/len(prev)
        vol_ratio=x["v"]/max(avg_vol,1.0)
        vw=vwap[i]
        old=vwap[i-p.slope_n]
        slope=(vw/old-1)*100 if old>0 else -999
        session_ret=(x["c"]/day_open-1)*100

        if not (p.min_session_ret<=session_ret<=p.max_session_ret):
            continue
        if not (x["c"]>vw and slope>=p.min_vwap_slope):
            continue
        if not (x["c"]>prior_high and vol_ratio>=p.vol_mult):
            continue

        # Signal is known only after this minute closes; fill at next minute open.
        ent=a[i+1]
        entry=ent["o"] or ent["c"]
        if entry<=0:
            continue

        breakout=(x["c"]/prior_high-1)*100
        score=vol_ratio*max(0.01,breakout+0.05)*max(0.01,slope+0.05)
        ctx=benchmark_context(day,x["hm"])
        path=path_metrics(a,i+1,entry,p.final_exit)
        exit_px=exit_hm=None; reason=None

        for z in a[i+1:]:
            if z["hm"]>p.final_exit:
                break
            stop_px=entry*(1-p.stop/100)
            tp_px=entry*(1+p.take_profit/100)
            hit_stop=z["l"]<=stop_px
            hit_tp=z["h"]>=tp_px
            # Conservative intrabar ordering when both levels are touched.
            if hit_stop:
                exit_px=stop_px; exit_hm=z["hm"]; reason="stop"
                break
            if hit_tp:
                exit_px=tp_px; exit_hm=z["hm"]; reason="take_profit"
                break

        if exit_px is None:
            eligible=[z for z in a if z["hm"]<=p.final_exit]
            if not eligible:
                return None
            z=eligible[-1]
            exit_px=z["c"]; exit_hm=z["hm"]; reason="time_exit"

        pnl=(exit_px/entry-1)*100-p.fee
        return {
            "date":day["date"],"rank":int(row.get("rank") or 0),
            "code":row.get("code"),"name":row.get("name"),
            "snapshotHm":snapshot_hm,"signalTime":x["hm"],"entryTime":ent["hm"],
            "entryPrice":entry,"exitTime":exit_hm,"exitPrice":exit_px,"reason":reason,
            "sessionRet":session_ret,"vwap":vw,"vwapSlope":slope,
            "priorHigh":prior_high,"breakoutPct":breakout,"volRatio":vol_ratio,
            "timeBucket":time_bucket(ent["hm"]),
            "volRatioBucket":bucket_value(vol_ratio,(1.75,2.5,999),("1.5~1.74","1.75~2.49","2.5+")),
            "vwapSlopeBucket":bucket_value(slope,(0.2,0.4,999),("0.10~0.19","0.20~0.39","0.40+")),
            "sessionRetBucket":bucket_value(session_ret,(2,4,999),("1~1.99","2~3.99","4+")),
            **ctx,**path,
            "score":score,"pnl":pnl,"variant":p.name,
        }
    return None

def trades_for_variant(days,p):
    chosen=[]
    for day in days:
        cands=[]
        for row in day.get("universe") or []:
            t=first_trade(day,row,p)
            if t:cands.append(t)
        # Chronology first. If several signals are simultaneous, only then rank by
        # information available at that minute.
        cands.sort(key=lambda x:(x["signalTime"],-x["score"],x["code"] or ""))
        chosen.extend(cands[:p.max_trades])
    return chosen

def summary(trades,day_labels,max_trades=3):
    pn=[x["pnl"] for x in trades]
    wins=[x for x in pn if x>0]; losses=[x for x in pn if x<0]
    gp=sum(wins); gl=-sum(losses)
    by={d:[] for d in day_labels}
    for x in trades: by.setdefault(x["date"],[]).append(x["pnl"])

    equity=1.0; peak=1.0; mdd=0.0
    daily=[]
    for d in day_labels:
        # Equal capital slots; unused slots stay cash.
        dr=sum(by.get(d,[]))/max_trades
        daily.append({"date":d,"returnPct":dr,"trades":len(by.get(d,[]))})
        equity*=1+dr/100
        peak=max(peak,equity)
        mdd=min(mdd,(equity/peak-1)*100)

    return {
        "days":len(day_labels),"trades":len(trades),
        "winRate":len(wins)/len(pn)*100 if pn else 0.0,
        "avgPnl":statistics.fmean(pn) if pn else 0.0,
        "medianPnl":statistics.median(pn) if pn else 0.0,
        "sumPnl":sum(pn),
        "profitFactor":gp/gl if gl>0 else (999.0 if gp>0 else 0.0),
        "portfolioReturnPct":(equity-1)*100,
        "portfolioMddPct":mdd,
        "tradesPerDay":len(trades)/len(day_labels) if day_labels else 0.0,
        "daily":daily,
    }

def group_stats(trades,key):
    groups={}
    for x in trades:
        v=x.get(key)
        if v is None: v="unknown"
        groups.setdefault(str(v),[]).append(x)
    out=[]
    for name,rows in sorted(groups.items()):
        pn=[x["pnl"] for x in rows]
        out.append({
            "group":name,"trades":len(rows),
            "winRate":sum(1 for x in pn if x>0)/len(pn)*100 if pn else 0,
            "avgPnl":statistics.fmean(pn) if pn else 0,
            "avgMfe":statistics.fmean([x["mfePct"] for x in rows if x.get("mfePct") is not None]) if any(x.get("mfePct") is not None for x in rows) else None,
            "avgMae":statistics.fmean([x["maePct"] for x in rows if x.get("maePct") is not None]) if any(x.get("maePct") is not None for x in rows) else None,
        })
    return out


def diagnostics(trades):
    path={}
    for n in (1,3,5,10,20):
        k=f"fwd{n}mPct"; vals=[x[k] for x in trades if x.get(k) is not None]
        path[k]={"n":len(vals),"avg":statistics.fmean(vals) if vals else None,
                 "median":statistics.median(vals) if vals else None}
    return {
        "timeBuckets":group_stats(trades,"timeBucket"),
        "marketRegimes":group_stats(trades,"marketRegime"),
        "volRatioBuckets":group_stats(trades,"volRatioBucket"),
        "vwapSlopeBuckets":group_stats(trades,"vwapSlopeBucket"),
        "sessionRetBuckets":group_stats(trades,"sessionRetBucket"),
        "forwardPath":path,
        "avgMfe":statistics.fmean([x["mfePct"] for x in trades if x.get("mfePct") is not None]) if any(x.get("mfePct") is not None for x in trades) else None,
        "avgMae":statistics.fmean([x["maePct"] for x in trades if x.get("maePct") is not None]) if any(x.get("maePct") is not None for x in trades) else None,
    }


def walk_forward(days,trade_map):
    train,test,step=20,5,5
    labels=[d["date"] for d in days]
    if len(labels)<train+test:
        return {"status":"collecting","trainDays":train,"testDays":test,"stepDays":step,
                "archiveDays":len(labels),"daysNeededForFirstFold":train+test,"folds":[],"oosVariants":[]}
    folds=[]; oos={p.name:[] for p in VARIANTS}; oos_days=[]
    for start in range(0,len(labels)-train-test+1,step):
        tr=labels[start:start+train]; te=labels[start+train:start+train+test]
        trset=set(tr); teset=set(te); oos_days.extend(te)
        vv=[]
        for p in VARIANTS:
            allx=trade_map[p.name]
            atr=[x for x in allx if x["date"] in trset]
            ate=[x for x in allx if x["date"] in teset]
            oos[p.name].extend(ate)
            vv.append({"name":p.name,"train":summary(atr,tr,p.max_trades),"test":summary(ate,te,p.max_trades)})
        folds.append({"fold":len(folds)+1,"trainFrom":tr[0],"trainTo":tr[-1],"testFrom":te[0],"testTo":te[-1],"variants":vv})
    od=sorted(set(oos_days))
    return {"status":"reviewable" if len(folds)>=3 else "early","trainDays":train,"testDays":test,"stepDays":step,
            "archiveDays":len(labels),"foldCount":len(folds),"oosDays":len(od),"folds":folds,
            "oosVariants":[{"name":p.name,"summary":summary(oos[p.name],od,p.max_trades)} for p in VARIANTS]}

def main():
    all_days=load_days(); OUT.mkdir(parents=True,exist_ok=True)
    if not all_days:
        print("No day-trading archives yet.")
        return 0

    raw_labels=[d["date"] for d in all_days]
    eligible,excluded=split_primary_days(all_days)

    labels=[d["date"] for d in eligible]
    reports=[]; trade_map={}
    for p in VARIANTS:
        tr=trades_for_variant(eligible,p); trade_map[p.name]=tr
        reports.append({"params":asdict(p),"summary":summary(tr,labels,p.max_trades)})

    baseline=trade_map["baseline"]
    wf=walk_forward(eligible,trade_map)
    enough=len(eligible)>=20 and len(baseline)>=30

    # Late days are kept as observation-only so we can inspect what happened
    # after the actual snapshot, but they never enter parameter comparison/OOS.
    latest_raw=all_days[-1]
    observed_latest=trades_for_variant([latest_raw],VARIANTS[0])
    latest_eligible_date=labels[-1] if labels else None
    report={
        "schema":4,"generatedAt":datetime.now(KST).isoformat(),
        "from":raw_labels[0],"to":raw_labels[-1],"archiveDays":len(all_days),
        "eligibleArchiveDays":len(eligible),
        "eligibleFrom":labels[0] if labels else None,
        "eligibleTo":labels[-1] if labels else None,
        "baselineTradeCount":len(baseline),
        "comparisonStatus":"eligible" if enough else "collecting",
        "comparisonRule":"Primary comparison uses only snapshots saved by 10:15 KST; preliminary until >=20 eligible trading days and >=30 baseline trades.",
        "strategyName":"VWAP 추세 돌파 v1",
        "signalModel":"live-parity-close-volume",
        "dataRule":"Around-10:00 intraday Top100 snapshot; snapshots after 10:15 are observation-only and excluded from primary comparison/walk-forward; next-minute-open paper entry.",
        "dataQuality":{
            "snapshotTarget":"09:55~10:05 KST",
            "primaryMaxSnapshotHm":PRIMARY_SNAPSHOT_MAX_HM,
            "rawArchiveDays":len(all_days),
            "eligibleDays":len(eligible),
            "excludedDays":len(excluded),
            "excluded":excluded,
            "note":"GitHub schedules can be delayed. Late snapshots remain archived but are not allowed to contaminate the primary strategy comparison."
        },
        "variants":reports,"walkForward":wf,
        "diagnostics":diagnostics(baseline),
        "latestDayTrades":[x for x in baseline if x["date"]==latest_eligible_date] if latest_eligible_date else [],
        "latestObservedDay":{
            "date":latest_raw.get("date"),
            "snapshotHm":int(latest_raw.get("snapshotHm") or 0),
            "primaryEligible":latest_raw in eligible,
            "trades":observed_latest,
        },
    }
    (OUT/"latest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    (OUT/f"{raw_labels[-1]}.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")

    with (OUT/"baseline-trades.csv").open("w",encoding="utf-8",newline="") as f:
        cols=["date","rank","code","name","snapshotHm","signalTime","entryTime","entryPrice","exitTime","exitPrice","reason",
              "sessionRet","vwapSlope","breakoutPct","volRatio","timeBucket","marketRegime","k200Ret","kosdaq150Ret",
              "mfePct","mfeTime","maePct","maeTime","fwd1mPct","fwd3mPct","fwd5mPct","fwd10mPct","fwd20mPct","pnl"]
        w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
        for x in baseline:w.writerow({k:x.get(k) for k in cols})

    b=next(x for x in reports if x["params"]["name"]=="baseline")
    print(json.dumps({
      "rawDays":len(all_days),"eligibleDays":len(eligible),"excludedDays":excluded,
      "from":raw_labels[0],"to":raw_labels[-1],
      "baseline":{k:v for k,v in b["summary"].items() if k!="daily"},
      "comparisonStatus":report["comparisonStatus"],"walkForwardStatus":wf["status"]
    },ensure_ascii=False,indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
