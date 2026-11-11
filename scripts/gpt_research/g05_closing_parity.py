"""G5 preregistered original-ledger audit; no network quotes, orders or alpha claim."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
from nightly_closing30_research import flatten
from closing30_metrics import daily_rows,coverage

FIELDS=['date','kind','variant','code','signalTime','entryTime','exitTime','entryPrice','exitPrice','pnl','status','strategyVersion','strategyParams']

def audit(sha,out,node='node'):
    def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
    paths=git('ls-tree','-r','--name-only',sha,'data/closing30').decode().splitlines()
    ledgers=[];manifest=[]
    (out/'sources').mkdir(parents=True,exist_ok=True)
    for name in sorted(paths):
        if not name.endswith('.json'):continue
        raw=git('show',sha+':'+name)
        ledger=json.loads(raw);ledgers.append(ledger)
        (out/'sources'/Path(name).name).write_bytes(raw)
        manifest.append({'path':name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),
            'events':len(ledger.get('events') or []),'date':ledger.get('date')})
    inputs=out/'ledgers.json';inputs.write_text(json.dumps(ledgers,ensure_ascii=False),encoding='utf-8')
    subprocess.run([node,str(Path(__file__).with_suffix('.mjs')),str(inputs),str(out/'js.json')],check=True,cwd=ROOT)
    js=json.loads((out/'js.json').read_text(encoding='utf-8'))
    py=flatten_all=[x for ledger in ledgers for x in flatten(ledger)]
    def normalized(x):return {k:x.get('state') if k=='status' else x.get(k) for k in FIELDS}
    def key(x):return ':'.join(str(x.get(k) or '') for k in ('date','kind','variant','code'))
    pa={key(x):normalized(x) for x in py};ja={key(x):{k:x.get(k) for k in FIELDS} for x in js['records']}
    differences=[]
    for ident in sorted(set(pa)|set(ja)):
        if ident not in pa or ident not in ja:differences.append({'id':ident,'missing':'python' if ident not in pa else 'js'});continue
        for field in FIELDS:
            a,b=pa[ident][field],ja[ident][field]
            same=abs(a-b)<=1e-10 if field=='pnl' and isinstance(a,(int,float)) and isinstance(b,(int,float)) else a==b
            if not same:differences.append({'id':ident,'field':field,'python':a,'js':b})
    daily_differences=[]
    for strategy,kind in [('closing30','day'),('closing_bet','overnight')]:
        pd={x['date']:x for x in daily_rows(flatten_all,ledgers,kind)}
        for x in (x for x in js['daily'] if x['strategy']==strategy):
            p=pd.get(x['date']);complete=p is not None
            if x['finalized']!=complete or (complete and abs(x['returnPct']-p['returnPct'])>1e-10) or (not complete and x['returnPct'] is not None):
                daily_differences.append({'strategy':strategy,'date':x['date'],'js':{'finalized':x['finalized'],'returnPct':x['returnPct']},'python':p})
    hash_changes=[x['path'] for x in manifest if hashlib.sha256((out/'sources'/Path(x['path']).name).read_bytes()).hexdigest()!=x['sha256']]
    counts={}
    for x in py:
        k=x['kind']+':'+x['variant'];counts.setdefault(k,{'signal':0,'open':0,'closed':0,'unverified':0})[x['state']]+=1
    stats={}
    for strategy,kind in [('closing30','day'),('closing_bet','overnight')]:
        all_main=[x for x in py if x['kind']==kind and x['variant']=='baseline']
        closed=[x for x in all_main if x['state']=='closed']
        ds=daily_rows(py,ledgers,kind,'baseline')
        stats[strategy]={'baselineSignals':len(all_main),'closedTrades':len(closed),'unsettled':len(all_main)-len(closed),
            'completeAccountDays':len(ds),'tradeMeanPnlPct':sum(x['pnl'] for x in closed)/len(closed) if closed else None,
            'daily':ds}
    report={'research':'G5','preregistration':'65f8013eac3819c5e1d969b352bde093abdabe28','sourceSha':sha,
        'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'ledgers':len(ledgers),'records':len(py),
        'recordDifferences':len(differences),'dailyDifferences':len(daily_differences),'originalHashChanges':len(hash_changes),
        'passed':not differences and not daily_differences and not hash_changes,'differences':differences,
        'dailyComparisonFailures':daily_differences,'sourceManifest':manifest,'counts':counts,'strategies':stats,
        'limitation':'Engineering consistency only. Old ledgers lack the complete cutoff universe and minute paths; no retrospective candidate selection/replay or forward profitability claim.'}
    (out/'g05-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    with gzip.open(out/'g05-normalized.json.gz','wb') as f:f.write(json.dumps({'python':pa,'js':ja},ensure_ascii=False).encode())
    print(json.dumps({k:report[k] for k in ('research','sourceSha','ledgers','records','recordDifferences','dailyDifferences','originalHashChanges','passed')},ensure_ascii=False))
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-sha',required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--node',default='node');a=p.parse_args()
    sys.exit(0 if audit(a.source_sha,a.out.resolve(),a.node)['passed'] else 1)
