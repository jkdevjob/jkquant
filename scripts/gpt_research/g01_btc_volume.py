"""G1 preregistered BTC study. Offline replay of immutable downloaded sources.

Example: python scripts/gpt_research/g01_btc_volume.py --sources ../jkquant-sources
  --refetch ../live-sources/btc-completed-public.json --out ../g01
Outputs are experimental replays; they never write an operating ledger.
"""
from __future__ import annotations
import argparse, gzip, hashlib, importlib.util, json, math, shutil, subprocess, sys
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
import backtest_crypto_orb as engine

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def metrics(rows,labels,extra=0):
    adjusted=[dict(t,pnlPct=t['pnlPct']-extra) for t in rows]
    result=engine.summary(adjusted,labels)
    by={d:0.0 for d in labels}
    for t in adjusted: by[t['date']]+=t['pnlPct']
    result['worstDayPct']=min(by.values(),default=0)
    result['tradeDays']=len({t['date'] for t in rows})
    result['daily']=[{'date':d,'pnlPct':r} for d,r in sorted(by.items())]
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--sources',type=Path,required=True);ap.add_argument('--refetch',type=Path);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--node',default=shutil.which('node'));args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    by={};manifest=[];revisions=[]
    def merge(b,source):
        d=b['tKst'][:10];key=b['tUtc'];old=by.setdefault(d,{}).get(key)
        if old and any(old.get(k)!=b.get(k) for k in ['o','h','l','c','v']):revisions.append({'tUtc':key,'old':old,'new':b,'source':source})
        by[d][key]=b
    for p in engine.crypto_archive_files(args.sources/'data/crypto/KRW-BTC/5m'):
        manifest.append({'path':str(p.relative_to(args.sources)),'sha256':digest(p)})
        with gzip.open(p,'rt',encoding='utf-8') as f:j=json.load(f)
        for b in j.get('bars',[]):merge(b,str(p.name))
    if args.refetch:
        j=json.loads(args.refetch.read_text(encoding='utf-8'));manifest.append({'path':args.refetch.name,'sha256':digest(args.refetch),'source':j.get('source'),'collectedAt':j.get('collectedAt')})
        for b in j.get('bars',[]):merge(b,args.refetch.name)
    valid=[];invalid=[];diagnostic=[]
    for d,rows in sorted(by.items()):
        if d>'2026-11-08':continue
        bars=sorted(rows.values(),key=lambda b:b['tUtc']); reasons=[]
        expected=[(datetime.fromisoformat(d)+timedelta(minutes=i*5)).isoformat(timespec='seconds') for i in range(288)]
        if [b['tKst'] for b in bars]!=expected:reasons.append('not_exactly_288_contiguous_5m_bars')
        if any(not all(math.isfinite(float(b.get(k,0))) for k in ['o','h','l','c','v']) or min(float(b.get(k,0)) for k in ['o','h','l','c'])<=0 or float(b.get('v',-1))<0 for b in bars):reasons.append('invalid_ohlcv')
        day={'sessionDateKst':d,'bars':bars}
        if reasons:
            invalid.append({'date':d,'bars':len(bars),'reasons':reasons,'missingTimes':[t[11:16] for t in expected if t not in {b['tKst'] for b in bars}]})
            if d>='2026-11-07':diagnostic.append(day)
        else:valid.append(day)
    input_file=args.out/'engine-input.json';worker_file=args.out/'worker-output.json'
    input_file.write_text(json.dumps(valid+diagnostic),encoding='utf-8')
    subprocess.run([args.node,str(Path(__file__).with_suffix('.mjs')),str(input_file),str(worker_file)],check=True,cwd=ROOT)
    worker=json.loads(worker_file.read_text(encoding='utf-8'));worker_by={(r['date'],r['variant']):r for r in worker}
    trades={};parity=[];diagnostic_results=[]
    for name in ['baseline','vol_1.5']:
        p=engine.Params(name,volume_mult=1.2 if name=='baseline' else 1.5);trades[name]=[]
        for day in valid+diagnostic:
            d=day['sessionDateKst'];partial=day in diagnostic
            py=engine.trade_for_day(day,p,allow_partial=partial);js=worker_by[(d,name)]['trade'];diff=[]
            if (py is None)!=(js is None):diff.append('trade_presence')
            if py and js:
                for k in ['signalTimeKst','entryTimeKst','exitTimeKst','reason']:
                    if py.get(k)!=js.get(k):diff.append(k)
                for k in ['entryPrice','exitPrice','pnlPct']:
                    if py.get(k) is None or js.get(k) is None or abs(py[k]-js[k])>1e-7:diff.append(k)
            parity.append({'date':d,'variant':name,'complete':not partial,'equal':not diff,'differences':diff})
            if partial:diagnostic_results.append({'date':d,'variant':name,'python':py,'worker':worker_by[(d,name)],'scope':'incomplete session; excluded from study statistics'})
            elif py:trades[name].append(py)
    labels=[d['sessionDateKst'] for d in valid];splits={}
    for scope,ls in [('all',labels),('fixed_20261001',[d for d in labels if d>='2026-10-01'])]:
        splits[scope]={n:{'normal':metrics([t for t in ts if t['date'] in ls],ls),'stressPlus010':metrics([t for t in ts if t['date'] in ls],ls,.1)} for n,ts in trades.items()}
    folds=[];chosen_rows=[];all_eval=[]
    for cut in range(120,len(labels),30):
        train=labels[:cut];test=labels[cut:cut+30]
        if len(test)<20:break
        b=metrics([t for t in trades['baseline'] if t['date'] in train],train)
        c=metrics([t for t in trades['vol_1.5'] if t['date'] in train],train)
        selected='vol_1.5' if c['trades']>=20 and c['profitFactor']>=1.10 and c['avgDailyReturnPct']>0 and c['avgDailyReturnPct']>=b['avgDailyReturnPct'] else 'baseline'
        test_rows={n:[t for t in ts if t['date'] in test] for n,ts in trades.items()}
        folds.append({'trainFrom':train[0],'trainTo':train[-1],'testFrom':test[0],'testTo':test[-1],'selected':selected,'training':{'baseline':b,'vol_1.5':c},'test':{n:metrics(ts,test) for n,ts in test_rows.items()}})
        all_eval+=test;chosen_rows+=test_rows[selected]
    wf={n:{'normal':metrics([t for t in ts if t['date'] in all_eval],all_eval),'stressPlus010':metrics([t for t in ts if t['date'] in all_eval],all_eval,.1)} for n,ts in trades.items()}
    wf['selected']={'normal':metrics(chosen_rows,all_eval),'stressPlus010':metrics(chosen_rows,all_eval,.1)}
    latest=[]
    for d in labels[-3:]:latest.append({'date':d,'trades':{n:[t for t in ts if t['date']==d] for n,ts in trades.items()}})
    result={'schema':1,'research':'G1','preregisterCommit':'084149f5c55ff35890deefdea26d3b62814b9ca0','generatedAt':datetime.now(timezone.utc).isoformat(),'sourceSha':subprocess.check_output(['git','-C',str(args.sources),'rev-parse','HEAD'],text=True).strip(),'sourceManifest':manifest,'sourceRevisions':revisions,'validDays':len(labels),'from':labels[0],'to':labels[-1],'invalidDays':invalid,'engineParity':{'comparisons':len(parity),'completeComparisons':sum(r['complete'] for r in parity),'mismatches':[r for r in parity if not r['equal']]},'periods':splits,'walkForward':wf,'folds':folds,'latest':latest,'incompleteDiagnostics':diagnostic_results,'prospectiveAfterRegistration':{'days':0,'trades':0,'status':'collecting','nextSession':'2026-11-10'},'decision':'No adoption. Historical replay only; prospective registration gate not met.'}
    (args.out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    (args.out/'trades.json').write_text(json.dumps(trades,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ['validDays','from','to','engineParity']},ensure_ascii=False))
    for scope,variants in {**splits,'walkForward':wf}.items():
        print(scope,json.dumps({n:{cost:{k:z[k] for k in ['days','trades','avgDailyReturnPct','compoundReturnPct','profitFactor','maxDrawdownPct','worstDayPct','target1PctDayCount']} for cost,z in cases.items()} for n,cases in variants.items()},ensure_ascii=False))
    return 0

if __name__=='__main__':raise SystemExit(main())
