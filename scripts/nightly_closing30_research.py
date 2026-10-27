#!/usr/bin/env python3
"""Nightly ledger archival/ranking for closing 30-minute research.
Never places orders, never changes live rules on insufficient evidence.
Uses only the day-stamped immutable paper ledger, never reconstructs buys after knowing closes.
"""
from __future__ import annotations
from nightly_scalping_research import shadow_score, evolve_lifecycle, factory_params
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
            obj=json.loads(result.stdout[:1_500_000])
            if not obj.get("ok"):raise ValueError(str(obj.get("error","ledger error"))[:100])
            return date,obj.get("ledger"),None
        except Exception as e:
            errors.append(str(e)[:160])
    return date,None," | ".join(errors)[:320]

def flatten(day):
    if not day or not isinstance(day.get("events"),list):return []
    by={}
    for e in sorted(day["events"],key=lambda e:{"signal":0,"buy":1,"sell":2}.get(e.get("stage"),3)):
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
    rows=[x for x in rows if x.get("date") in calendar_days]
    closed=[x for x in rows if x["state"]=="closed" and isinstance(x.get("pnl"),(int,float)) and math.isfinite(x["pnl"])]
    values=[x["pnl"] for x in closed]
    daily=[]
    for date in sorted(calendar_days):
        rs=[x for x in rows if x['date']==date]
        if any(x['state']!='closed' for x in rs):continue
        daily.append({'date':date,'returnPct':sum(x['pnl'] for x in rs)/3,'trades':len(rs)})
    equity=peak=1.0;mdd=0.0
    for x in daily:
        equity*=max(0,1+x['returnPct']/100);peak=max(peak,equity);mdd=min(mdd,(equity/peak-1)*100)
    gains=sum(v for v in values if v>0);loss=-sum(v for v in values if v<0)
    split=max(1,len(daily)//2)
    first=[x['returnPct'] for x in daily[:split]];second=[x['returnPct'] for x in daily[split:]]
    return {"trades":len(values),"observedDays":len(daily),"daily":daily,
      "compoundReturnPct":(equity-1)*100 if daily else None,
      "winRate":sum(v>0 for v in values)/len(values)*100 if values else None,
      "avgPnl":statistics.mean(values) if values else None,
      "avgWin":statistics.mean([v for v in values if v>0]) if any(v>0 for v in values) else None,
      "avgLoss":statistics.mean([v for v in values if v<0]) if any(v<0 for v in values) else None,
      "profitFactor":gains/loss if loss else (999 if gains else None),
      "mddPct":mdd if daily else None,"worst":min(values) if values else None,
      "firstHalfAvg":statistics.mean(first) if first else None,
      "secondHalfAvg":statistics.mean(second) if second else None,
      "unsettled":len(rows)-len(closed)}

NAMES=["baseline","dip_1","dip_2","dip_3","dip_volume","dip_vol2","momentum","up_1","up_volume","flat","all"]

def research_section(kind,ledgers,previous,errors):
    # No missing/partial signal day becomes a synthetic zero-return session.
    target=1506 if kind=='day' else 1522
    good=[]
    for d in ledgers:
        scans=[x for x in d.get('scans',[]) if x.get('targetHm')==target]
        if scans and all(not x.get('partial') and not x.get('failed') and not x.get('quoteErrors') for x in scans):good.append(d)
    rows=[x for d in good for x in flatten(d) if x['kind']==kind]
    dates=sorted({d['date'] for d in good})
    generated={x['name']:x for x in previous.get('generatedPool',[]) if x.get('name')}
    names=list(dict.fromkeys(NAMES+list(generated)+[x['variant'] for x in rows if x['variant'].startswith('cf_g')]))
    def observed(n):
        if not n.startswith('cf_g'):return dates
        created=generated.get(n,{}).get('createdAfter','9999-99-99')
        return [d['date'] for d in good if d['date']>created and n in d.get('closingVariants',{}).get(kind,[])]
    summaries={n:stats([x for x in rows if x['variant']==n],observed(n)) for n in names}
    base={x['date']:x['returnPct'] for x in summaries['baseline']['daily']}
    candidates=[]
    for name in names[1:]:
        x=summaries[name]
        paired=[(d['date'],d['returnPct']-base[d['date']]) for d in x['daily'] if d['date'] in base]
        split=max(1,len(paired)//2)
        avg=lambda xs:statistics.mean(v for _,v in xs) if xs else 0
        edge,valid,recent=avg(paired),avg(paired[split:]),avg(paired[-20:])
        risk=x['mddPct'] is not None and x['mddPct']>=-15 and x['profitFactor'] is not None and x['profitFactor']>=1.1
        ready=x['trades']>=30 and len(paired)>=20
        review=ready and risk and edge>0 and valid>0 and recent>0 and x['firstHalfAvg'] is not None and x['firstHalfAvg']>0 and x['secondHalfAvg'] is not None and x['secondHalfAvg']>0 and not errors and x['unsettled']==0
        score=shadow_score(edge,valid,recent,risk,x['trades'],30)
        candidates.append({'name':name,'params':factory_params('closing30' if kind=='day' else 'closing_bet',int(name[4:])) if name.startswith('cf_g') else None,'summary':x,'trades':x['trades'],'allTrades':x['trades'],
          'researchScore':score['score'],'sampleFactor':score['sampleFactor'],'scoreParts':score['parts'],
          'sampleReady':ready,'allAvgEdgePct':edge,'validationAvgEdgePct':valid,'recentEdgePct':recent,
          'holdoutTrades':sum(d['trades'] for d in x['daily'][split:]),
          'mddOk':x['mddPct'] is not None and x['mddPct']>=-15,'profitFactorOk':x['profitFactor'] is not None and x['profitFactor']>=1.1,
          'status':'review' if review else 'collecting','eligibleToPromote':review})
    candidates.sort(key=lambda x:(x['trades']<=0,-x['researchScore'],-x['sampleFactor'],x['name']))
    # Reuse the same retirement, reserve activation, weekly factory, leader
    # streak and promotion rules as the other trading strategies.
    evidence=max((d['date'] for d in good if any(x['date']==d['date'] and x['state']=='closed' for x in rows)),default='')
    section={'status':'degraded' if errors else 'research' if rows else 'collecting','from':dates[0] if dates else None,'to':evidence or None,
      'candidates':candidates,'baseline':summaries['baseline'],'source':'immutable-closing-ledgers','returnRule':'sum net trade pct / 3 fixed slots, entry-session dates'}
    if errors:
        section['to']=previous.get('lastEvidenceDate')
    section['lifecycle']=evolve_lifecycle('closing30' if kind=='day' else 'closing_bet',section,previous)
    return section


def verified_main_day(d):
    scans=[x for x in d.get('scans',[]) if x.get('targetHm')==1506]
    rows=[x for x in flatten(d) if x['kind']=='day' and x['variant']==d.get('closingMains',{}).get('day','baseline')]
    return bool(scans) and all(not x.get('partial') and not x.get('failed') and not x.get('quoteErrors') for x in scans) and all(x['state']=='closed' for x in rows)

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
                (RAW/(date+".json")).write_text(json.dumps(ledger,ensure_ascii=False),encoding="utf-8")
                received+=1
    all_days=[]
    for path in sorted(RAW.glob("20??-??-??.json")):
        d=path.stem
        if d>now.date().isoformat():continue
        if path.is_file():
            try:all_days.append(json.loads(path.read_text(encoding="utf-8")))
            except Exception as e:errors.append({"date":d,"error":str(e)})
    all_rows=[x for d in all_days for x in flatten(d)]
    lifecycle_path=OUT/"lifecycle.json"
    try:lifecycle=json.loads(lifecycle_path.read_text(encoding="utf-8"))
    except Exception:lifecycle={"strategies":{}}
    strategies=lifecycle.setdefault("strategies",{})
    try:combined=json.loads((OUT/'latest.json').read_text(encoding='utf-8'))
    except Exception:combined={'schema':2,'date':now.date().isoformat(),'generatedAt':now.isoformat()}
    variants=[];winners={}
    for strategy,kind in [('closing30','day'),('closing_bet','overnight')]:
        section=research_section(kind,all_days,strategies.get(strategy) or {},errors)
        strategies[strategy]=section['lifecycle'];combined[strategy]=section
        variants.append({'kind':kind,'name':'baseline','summary':section['baseline'],'status':'baseline'})
        variants.extend({**v,'kind':kind} for v in section['candidates'])
        winners[kind]=section['lifecycle']
    lifecycle['updatedAt']=now.isoformat()
    lifecycle_path.write_text(json.dumps(lifecycle,ensure_ascii=False,indent=2),encoding='utf-8')
    for path in [OUT/'latest.json',OUT/(combined['date']+'.json')]:path.write_text(json.dumps(combined,ensure_ascii=False,indent=2),encoding='utf-8')
    report={"schema":1,"date":now.date().isoformat(),"generatedAt":now.isoformat(),"status":"degraded" if errors else "collecting" if not all_rows else "research",
      "mode":"close30-paper-shadow-nightly","archiveDays":len(all_days),"freshLedgers":received,"errors":errors[:12],
      "sourceRule":"Actual signal-time Durable Object evidence, no post-hoc signal reconstruction",
      "feesPct":FEE,"mainVariant":"baseline","variants":variants,
      "candidates":[v for v in variants if v.get('eligibleToPromote')],
      "promotion":winners,"fullPaperTradeCount":len(all_rows),
      "operationalSessions":[{'date':d['date'],'mainVariant':d.get('closingMains',{}).get('day','baseline'),
         'trades':[x for x in flatten(d) if x['kind']=='day' and x['variant']==d.get('closingMains',{}).get('day','baseline')]}
        for d in all_days if verified_main_day(d)]}
    (OUT/"closing30.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    return report

if __name__=="__main__":
    print(json.dumps(main(),ensure_ascii=False)[:3000])
