"""Deployment probe: source-only paper refresh, never alerts or broker orders."""
import datetime as dt
import json
import os
import subprocess
from zoneinfo import ZoneInfo

BASE=os.environ.get('GLOBAL_WORKER_URL','https://jkquant-global-intraday-scheduler.mumae4.workers.dev').rstrip('/')

def call(path,body=None):
    key=os.environ.get('MONITOR_KEY','')
    if not key:raise RuntimeError('MONITOR_KEY missing')
    args=['curl','--fail','--silent','--show-error','--max-time','45','--user-agent','JKQuant-deployment-probe/1.0','-H','x-monitor-key: '+key,'-H','content-type: application/json']
    if body is not None:args+=['-X','POST','--data-binary',json.dumps(body)]
    r=subprocess.run([*args,BASE+path],capture_output=True,text=True,timeout=50)
    if r.returncode:raise RuntimeError('paper probe HTTP/network failure, curl exit '+str(r.returncode))
    j=json.loads(r.stdout)
    if not j.get('ok'):raise RuntimeError(str(j.get('error','probe rejected'))[:150])
    return j

def main():
    now=dt.datetime.now(dt.timezone.utc)
    for strategy,tz in [('crypto','Asia/Seoul'),('soxl','America/New_York')]:
        date=now.astimezone(ZoneInfo(tz)).date()
        if strategy=='soxl':
            bars=call('/bars?strategy=soxl').get('bars') or []
            dates=sorted({b['date'] for b in bars if b.get('hm')==930})
            if not dates:raise RuntimeError('SOXL confirmed session opening unavailable')
            date=dt.date.fromisoformat(dates[-1])
        ledger=call('/refresh',{'strategy':strategy,'date':date.isoformat()}).get('ledger')
        if not ledger or not isinstance(ledger.get('trades'),list):raise RuntimeError('paper ledger missing')
        shadows=ledger.get('shadowLedgers') or {}
        # A pre-existing research import is deliberately immutable and is never relabelled live.
        if ledger.get('mode')!='historical-research-import-no-order' and len(shadows)<20:raise RuntimeError('shadow capture missing')
        print(json.dumps({'strategy':strategy,'date':ledger['date'],'mode':ledger.get('mode'),
          'mainTrades':len(ledger['trades']),'shadowVariants':len(shadows),
          'shadowTrades':sum(len(x.get('trades') or []) for x in shadows.values()),
          'summary':ledger.get('summary')},ensure_ascii=False))
    runtime=call('/runtime').get('runtime')
    print(json.dumps({'cronRuntime':runtime},ensure_ascii=False))

if __name__=='__main__':main()
