#!/usr/bin/env python3
"""Nightly ledger archival/ranking for closing 30-minute research.
Never places orders, never changes live rules on insufficient evidence.
Uses only the day-stamped immutable paper ledger, never reconstructs buys after knowing closes.
"""
from __future__ import annotations
import concurrent.futures
import datetime as dt
import json
import math
import os
import statistics
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

KST=ZoneInfo("Asia/Seoul")
RAW=Path("data/closing30")
OUT=Path("data/nightly-research")
KEY=os.environ.get("KEY") or os.environ.get("AUTOTRADE_KEY") or ""
WORKER=(os.environ.get("CLOSING_WORKER_URL") or "https://jkquant-opening-scheduler.mumae4.workers.dev").rstrip("/")
FEE=.23

def download(date):
    if not KEY:
        return date,None,"research monitor key not configured"
    # GitHub -> Workers direct can be blocked by edge policy (HTTP 403).
    # Pages-to-Worker relay uses the same secret, remains private and read-only.
    endpoints=[WORKER+"/closing-ledger?date="+date,
               "https://jkquant.pages.dev/api/closing30-archive?date="+date]
    errors=[]
    for url in endpoints:
        try:
            # GitHub runners can get Cloudflare bot 403 for Python-urllib's default UA.
            # Use the same curl client as existing successful project archivers.
            result=subprocess.run(["curl","--fail","--silent","--show-error","--max-time","12",
                "--user-agent","JKQuant-nightly-research/1.0","-H","x-monitor-key: "+KEY,
                "-H","accept: application/json",url],capture_output=True,text=True,timeout=15)
            if result.returncode!=0:
                raise ValueError("curl HTTP/network failure (exit "+str(result.returncode)+")")
            obj=json.loads(result.stdout[:1_500_000])
            if not obj.get("ok"):raise ValueError(str(obj.get("error","ledger error"))[:100])
            return date,obj.get("ledger"),None
        except Exception as e:
            errors.append(str(e)[:160])
    return date,None," | ".join(errors)[:320]

def flatten(day):
    if not day or not isinstance(day.get("events"),list):return []
    by={}
    for e in day["events"]:
        if e.get("stage") not in ("signal","buy","sell") or e.get("kind") not in ("day","overnight"):continue
        k=(e.get("kind"),e.get("variant"),e.get("code"))
        if not all(k):continue
        t=by.setdefault(k,{"date":day.get("date"),"kind":k[0],"variant":k[1],"code":k[2],
                           "name":e.get("name") or k[2],"state":"signal","entryPrice":None,"exitPrice":None,"pnl":None})
        if e["stage"]=="buy":
            t["entryPrice"]=e.get("price");t["entryTime"]=e.get("createdAt");t["state"]="open"
        elif e["stage"]=="sell":
            t["exitPrice"]=e.get("price");t["exitTime"]=e.get("createdAt")
            p=e.get("pnl")
            if t["entryPrice"] and t["exitPrice"] and p is not None:
                t["pnl"]=float(p);t["state"]="closed"
            else:t["state"]="unverified"
    return list(by.values())

def stats(rows,calendar_days):
    closed=[x for x in rows if x["state"]=="closed" and isinstance(x.get("pnl"),(int,float))]
    values=[x["pnl"] for x in closed]
    equity=peak=1.0;mdd=0.0
    for v in values:
        equity*=max(0,1+v/100);peak=max(peak,equity);mdd=min(mdd,(equity/peak-1)*100)
    gains=sum(v for v in values if v>0);loss=-sum(v for v in values if v<0)
    first,second=[],[]
    for x in closed:
        # Date-ordered archival source; evaluate each half independently.
        (first if x["date"]<=calendar_days[len(calendar_days)//2] else second).append(x["pnl"])
    return {"trades":len(values),"observedDays":len(set(x["date"] for x in closed)),
      "winRate":sum(v>0 for v in values)/len(values)*100 if values else None,
      "avgPnl":statistics.mean(values) if values else None,
      "profitFactor":gains/loss if loss else (999 if gains else None),
      "mddPct":mdd if values else None,"worst":min(values) if values else None,
      "firstHalfAvg":statistics.mean(first) if first else None,
      "secondHalfAvg":statistics.mean(second) if second else None,
      "unsettled":len(rows)-len(closed)}

def main():
    now=dt.datetime.now(KST)
    days=[(now.date()-dt.timedelta(days=i)).isoformat() for i in range(40)]
    RAW.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    errors=[];received=0
    # Refresh last 5 days (late overnight fills) plus any day whose immutable copy is absent.
    wanted=[d for d in days if d>=days[4] or not (RAW/(d+".json")).exists()]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for date,ledger,error in pool.map(download,wanted):
            if error:errors.append({"date":date,"error":error});continue
            if ledger:
                (RAW/(date+".json")).write_text(json.dumps(ledger,ensure_ascii=False),encoding="utf-8")
                received+=1
    all_days=[]
    for d in reversed(days):
        path=RAW/(d+".json")
        if path.is_file():
            try:all_days.append(json.loads(path.read_text(encoding="utf-8")))
            except Exception as e:errors.append({"date":d,"error":str(e)})
    all_rows=[x for d in all_days for x in flatten(d)]
    variants=[]
    for kind in ("day","overnight"):
        names=["baseline","dip_1","dip_2","dip_3","dip_volume","dip_vol2","momentum","up_1","up_volume","flat","all"]
        for name in names:
            v=[x for x in all_rows if x["kind"]==kind and x["variant"]==name]
            x=stats(v,sorted(days))
            is_valid=(x["trades"]>=30 and x["observedDays"]>=20
              and x["avgPnl"] is not None and x["avgPnl"]>0
              and x["profitFactor"] is not None and x["profitFactor"]>=1.1
              and x["firstHalfAvg"] is not None and x["firstHalfAvg"]>0
              and x["secondHalfAvg"] is not None and x["secondHalfAvg"]>0
              and x["mddPct"] is not None and x["mddPct"]>=-15)
            variants.append({"name":name,"kind":kind,"summary":x,
                "status":"candidate" if is_valid else "collecting",
                "eligibleToPromote":bool(is_valid)})
    lifecycle_path=OUT/"lifecycle.json"
    try:lifecycle=json.loads(lifecycle_path.read_text(encoding="utf-8"))
    except Exception:lifecycle={"strategies":{}}
    strategies=lifecycle.setdefault("strategies",{})
    previous=strategies.get("closing30") or {}
    winners={}
    for kind in ("day","overnight"):
        best=max((v for v in variants if v["kind"]==kind and v["eligibleToPromote"]),
          key=lambda v:v["summary"]["avgPnl"],default=None)
        prior=previous.get(kind) or {}
        leader=(best or {}).get("name")
        streak=(int(prior.get("leaderStreak") or 0)+1) if leader and prior.get("leader")==leader and prior.get("date")!=now.date().isoformat() else (1 if leader else 0)
        winners[kind]={"date":now.date().isoformat(),"leader":leader,"leaderStreak":streak,
          "reviewReady":bool(best and streak>=7),
          "activeMain":"baseline", # live change requires separate protected promotion path
          "reason":"7 연속 연구세션 1위 및 OOS 위험조건 필요"}
    strategies["closing30"]={"day":winners["day"],"overnight":winners["overnight"],
      "updatedAt":now.isoformat(),"paperOnly":True,"autoChange":False}
    lifecycle_path.write_text(json.dumps(lifecycle,ensure_ascii=False,indent=2),encoding="utf-8")
    report={"schema":1,"date":now.date().isoformat(),"generatedAt":now.isoformat(),"status":"degraded" if errors else "collecting" if not all_rows else "research",
      "mode":"close30-paper-shadow-nightly","archiveDays":len(all_days),"freshLedgers":received,"errors":errors[:12],
      "sourceRule":"Actual signal-time Durable Object evidence, no post-hoc signal reconstruction",
      "feesPct":FEE,"mainVariant":"baseline","variants":variants,
      "candidates":[v for v in variants if v["eligibleToPromote"]],
      "promotion":winners,"fullPaperTradeCount":len(all_rows)}
    (OUT/"closing30.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report

if __name__=="__main__":
    print(json.dumps(main(),ensure_ascii=False)[:3000])
