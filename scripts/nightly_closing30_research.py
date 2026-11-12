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
from closing30_metrics import section
from pathlib import Path
from zoneinfo import ZoneInfo

KST=ZoneInfo("Asia/Seoul")
RAW=Path("data/closing30")
OUT=Path("data/nightly-research")
KEY=os.environ.get("KEY") or os.environ.get("AUTOTRADE_KEY") or ""
WORKER=(os.environ.get("CLOSING_WORKER_URL") or "https://jkquant-opening-scheduler.mumae4.workers.dev").rstrip("/")
FEE=.23

def needs_refresh(path, recent=False):
    if recent or not path.is_file():return True
    try:
        # A long holiday can keep an overnight record open beyond five days.
        return any(x['kind']=='overnight' and x['state']=='open' for x in flatten(json.loads(path.read_text(encoding='utf-8'))))
    except Exception:return True

def leader_streak(prior, leader, research_date):
    if not leader:return 0
    if prior.get('leader')!=leader:return 1
    return int(prior.get('leaderStreak') or 0)+(prior.get('date')!=research_date)

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
            if len(result.stdout)>8_000_000:raise ValueError('ledger response exceeds 8 MB; retain previous copy')
            obj=json.loads(result.stdout)
            if not obj.get("ok"):raise ValueError(str(obj.get("error","ledger error"))[:100])
            return date,obj.get("ledger"),None
        except Exception as e:
            errors.append(str(e)[:160])
    return date,None," | ".join(errors)[:320]

def ledger_extends(original,updated):
    """A refreshed copy may append events, never delete/change an existing event."""
    if original.get('date')!=updated.get('date'):return False
    by={x.get('id'):x for x in updated.get('events') or [] if x.get('id')}
    return all(x.get('id') in by and by[x['id']]==x for x in original.get('events') or [])

def flatten(day):
    if not day or not isinstance(day.get("events"),list):return []
    by={}
    for e in sorted(day["events"],key=lambda x:{'signal':0,'buy':1,'sell':2}.get(x.get('stage'),3)):
        if e.get("stage") not in ("signal","buy","sell") or e.get("kind") not in ("day","overnight"):continue
        k=(e.get("kind"),e.get("variant"),e.get("code"))
        if not all(k):continue
        t=by.setdefault(k,{"date":day.get("date"),"kind":k[0],"variant":k[1],"code":k[2],
                           "name":e.get("name") or k[2],"state":"signal","entryPrice":None,"exitPrice":None,"pnl":None,
                           "strategyVersion":e.get('strategyVersion') or e.get('decisionVersion'),
                           "strategyParams":e.get('strategyParams'),"signal":e.get('signal'),"signalTime":None,
                           "entryTime":None,"exitTime":None,"outcomes":None})
        if e['stage']=='signal':t['signalTime']=e.get('priceAt') or (e.get('signal') or {}).get('signalTime') or e.get('createdAt')
        if e["stage"]=="buy":
            t["entryPrice"]=e.get("price");t["entryTime"]=e.get("priceAt") or e.get("createdAt");t["state"]="open" if isinstance(e.get('price'),(int,float)) and e['price']>0 else 'unverified'
            t['outcomes']=e.get('outcomes')
        elif e["stage"]=="sell":
            t["exitPrice"]=e.get("price");t["exitTime"]=e.get("priceAt") or e.get("createdAt")
            t['outcomes']=e.get('outcomes')
            p=e.get("pnl")
            if t["entryPrice"] and t["exitPrice"] and p is not None:
                t["pnl"]=float(p);t["state"]="closed"
            else:t["state"]="unverified"
    return list(by.values())

def main():
    now=dt.datetime.now(KST)
    days=[(now.date()-dt.timedelta(days=i)).isoformat() for i in range(40)]
    RAW.mkdir(parents=True,exist_ok=True);OUT.mkdir(parents=True,exist_ok=True)
    errors=[];received=0
    # Refresh last 5 days (late overnight fills) plus any day whose immutable copy is absent.
    wanted=[d for d in days if needs_refresh(RAW/(d+".json"),d>=days[4])]
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        for date,ledger,error in pool.map(download,wanted):
            if error:errors.append({"date":date,"error":error});continue
            if ledger:
                path=RAW/(date+'.json')
                if path.is_file() and not ledger_extends(json.loads(path.read_text(encoding='utf-8')),ledger):
                    errors.append({'date':date,'error':'original event changed/missing; retained previous immutable copy'});continue
                path.write_text(json.dumps(ledger,ensure_ascii=False),encoding="utf-8")
                received+=1
    all_days=[]
    for path in sorted(RAW.glob('????-??-??.json')):
        d=path.stem
        if d>now.date().isoformat():continue
        if path.is_file():
            try:all_days.append(json.loads(path.read_text(encoding="utf-8")))
            except Exception as e:errors.append({"date":d,"error":str(e)})
    all_rows=[x for d in all_days for x in flatten(d)]
    lifecycle_path=OUT/'lifecycle.json'
    try:lifecycle=json.loads(lifecycle_path.read_text(encoding='utf-8'))
    except Exception:lifecycle={'strategies':{}}
    strategies=lifecycle.setdefault('strategies',{})
    reports={}
    old=strategies.get('closing30') or {}
    # Retain the earlier nested day/overnight record as migration evidence.
    if 'day' in old or 'overnight' in old:
        lifecycle.setdefault('legacyClosing30',old)
    for name in ('closing30','closing_bet'):
        prior=strategies.get(name) or {}
        if 'day' in prior:prior={}
        reports[name]=section(name,all_rows,all_days,prior,errors)
        strategies[name]=reports[name]['lifecycle']
    lifecycle['updatedAt']=now.isoformat()
    lifecycle_path.write_text(json.dumps(lifecycle,ensure_ascii=False,indent=2),encoding='utf-8')
    variants=[v for r in reports.values() for v in r['variants']]
    report={'schema':2,'date':now.date().isoformat(),'generatedAt':now.isoformat(),
      'status':'degraded' if errors else 'research' if all_rows else 'collecting',
      'mode':'close30-paper-shadow-nightly','archiveDays':len(all_days),'freshLedgers':received,'errors':errors[:12],
      'sourceRule':'Original signal-time ledgers; missing/unsettled observations are excluded and disclosed',
      'feesPct':FEE,'slots':3,'variants':variants,'strategies':reports,
      'candidates':[v for v in variants if v['eligibleToPromote']],
      'promotion':{name:r['lifecycle'] for name,r in reports.items()},'fullPaperTradeCount':len(all_rows)}
    (OUT/'closing30.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    # Publish into the same consolidated report consumed by ranking and protected promotion.
    latest_path=OUT/'latest.json'
    try:latest=json.loads(latest_path.read_text(encoding='utf-8'))
    except Exception:latest={'schema':2,'date':now.date().isoformat()}
    latest.update(reports);latest['generatedAt']=now.isoformat()
    latest_path.write_text(json.dumps(latest,ensure_ascii=False,indent=2),encoding='utf-8')
    (OUT/(now.date().isoformat()+'.json')).write_text(json.dumps(latest,ensure_ascii=False,indent=2),encoding='utf-8')
    return report

if __name__=="__main__":
    print(json.dumps(main(),ensure_ascii=False)[:3000])
