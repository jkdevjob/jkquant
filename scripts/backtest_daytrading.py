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

def first_trade(day,row,p:Params):
    if int(row.get("rank") or 999999)>p.top_n:
        return None
    a=bars_of(row)
    if len(a)<max(p.lookback,p.slope_n)+3:
        return None
    day_open=a[0]["o"] or a[0]["c"]
    if day_open<=0:
        return None

    # Cumulative VWAP known at each completed minute.
    vwap=[]
    pv=vv=0.0
    for x in a:
        typical=(x["h"]+x["l"]+x["c"])/3.0
        pv+=typical*x["v"]; vv+=x["v"]
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
        prior_high=max(z["h"] for z in prev)
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
    days=load_days(); OUT.mkdir(parents=True,exist_ok=True)
    if not days:
        print("No day-trading archives yet.")
        return 0

    labels=[d["date"] for d in days]
    reports=[]; trade_map={}
    for p in VARIANTS:
        tr=trades_for_variant(days,p); trade_map[p.name]=tr
        reports.append({"params":asdict(p),"summary":summary(tr,labels,p.max_trades)})

    baseline=trade_map["baseline"]
    wf=walk_forward(days,trade_map)
    enough=len(days)>=20 and len(baseline)>=30
    report={
        "schema":1,"generatedAt":datetime.now(KST).isoformat(),
        "from":labels[0],"to":labels[-1],"archiveDays":len(days),
        "baselineTradeCount":len(baseline),
        "comparisonStatus":"eligible" if enough else "collecting",
        "comparisonRule":"Preliminary until >=20 trading days and >=30 baseline trades.",
        "strategyName":"VWAP 추세 돌파 v1",
        "dataRule":"10:00 intraday Top100 snapshot; signals only after snapshot; next-minute-open entry.",
        "variants":reports,"walkForward":wf,
        "latestDayTrades":[x for x in baseline if x["date"]==labels[-1]],
    }
    (OUT/"latest.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    (OUT/f"{labels[-1]}.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")

    with (OUT/"baseline-trades.csv").open("w",encoding="utf-8",newline="") as f:
        cols=["date","rank","code","name","snapshotHm","signalTime","entryTime","entryPrice","exitTime","exitPrice","reason",
              "sessionRet","vwapSlope","breakoutPct","volRatio","pnl"]
        w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
        for x in baseline:w.writerow({k:x.get(k) for k in cols})

    b=next(x for x in reports if x["params"]["name"]=="baseline")
    print(json.dumps({"days":len(days),"from":labels[0],"to":labels[-1],
      "baseline":{k:v for k,v in b["summary"].items() if k!="daily"},
      "comparisonStatus":report["comparisonStatus"],"walkForwardStatus":wf["status"]},ensure_ascii=False,indent=2))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
