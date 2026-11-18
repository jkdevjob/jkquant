#!/usr/bin/env python3
"""G7 fixed preregistered comparison; reads immutable git objects, never orders."""
from __future__ import annotations
import argparse,copy,datetime as dt,gzip,hashlib,importlib.util,json,math,statistics,subprocess,sys,types
from dataclasses import asdict
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))
import backtest_daytrading as engine

def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def raw_git(sha,path):
    return subprocess.check_output(['git','show',sha+':'+path],cwd=ROOT)

def extras(summary):
    daily=summary['daily']
    return {**summary,'dailyExpectedPct':statistics.fmean(x['returnPct'] for x in daily) if daily else None,
            'worstDayPct':min((x['returnPct'] for x in daily),default=None),
            'daysAtLeast1Pct':sum(x['returnPct']>=1 for x in daily),
            'positiveDays':sum(x['returnPct']>0 for x in daily),
            'cashSlots':sum(3-x['trades'] for x in daily)}

def independent_daily(trades,dates):
    by={d:0.0 for d in dates}
    for t in trades:by[t['date']]+=t['pnl']/3
    equity=peak=1.0;mdd=0.0
    for d in dates:
        equity*=1+by[d]/100;peak=max(peak,equity);mdd=min(mdd,100*(equity/peak-1))
    return by,100*(equity-1),mdd

def run(source_sha,out,study='G7',candidate_name='session_min_2',candidate_overrides=None,prereg='60b9cd34'):
    out.mkdir(parents=True,exist_ok=True)
    paths=subprocess.check_output(['git','ls-tree','-r','--name-only',source_sha,'data/daytrading'],cwd=ROOT,encoding='utf-8').splitlines()
    manifests=[];days=[];excluded=[]
    for path in paths:
        if not path.endswith('.json.gz'):continue
        raw=raw_git(source_sha,path);j=json.loads(gzip.decompress(raw));date=j.get('date')
        dest=out/'raw'/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
        manifests.append({'path':path,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'date':date})
        if date and date<='2026-11-12' and j.get('universe'):days.append(j)
        else:excluded.append({'date':date,'reason':'after_cutoff_or_missing_universe'})
    days.sort(key=lambda x:x['date'])
    assert len({d['date'] for d in days})==len(days),'duplicate date'
    primary,late=engine.split_primary_days(days);excluded+=late
    dates=[d['date'] for d in primary]
    params=[engine.Params('baseline'),engine.Params(candidate_name,**(candidate_overrides or {'min_session_ret':2.0}))]
    tm={p.name:engine.trades_for_variant(primary,p) for p in params}
    candidates=[];quality=[]
    for d in primary:
        counts={'date':d['date'],'universe':len(d['universe']),'emptyBars':0,'missingOHLC':0,'rowsWithMinuteGaps':0}
        for row in d['universe']:
            bars=row.get('bars') or []
            counts['emptyBars']+=not bool(bars)
            counts['missingOHLC']+=bool(bars) and any(any(not b.get(k) for k in ('o','h','l')) for b in bars)
            mins=[(engine.hm(b.get('t'))//100)*60+engine.hm(b.get('t'))%100 for b in bars]
            counts['rowsWithMinuteGaps']+=any(b-a!=1 for a,b in zip(mins,mins[1:]))
            for p in params:
                t=engine.first_trade(d,row,p)
                if t:candidates.append({**t,'selected':t in tm[p.name]})
        quality.append(counts)
    summaries={};stress={};blocks={};verifications=[]
    for p in params:
        trades=tm[p.name];s=extras(engine.summary(trades,dates,3));summaries[p.name]=s
        stressed=[{**x,'pnl':x['pnl']-.10} for x in trades]
        stress[p.name]=extras(engine.summary(stressed,dates,3))
        block_dates=[dates[len(dates)*i//3:len(dates)*(i+1)//3] for i in range(3)]
        blocks[p.name]=[extras(engine.summary([t for t in trades if t['date'] in ds],ds,3)) for ds in block_dates]
        independent,ret,mdd=independent_daily(trades,dates)
        assert all(abs(x['returnPct']-independent[x['date']])<1e-10 for x in s['daily'])
        assert abs(s['portfolioReturnPct']-ret)<1e-10 and abs(s['portfolioMddPct']-mdd)<1e-10
        verifications.append({'name':p.name,'independentAccountParity':'PASS','trades':len(trades),'days':len(dates)})
    # The shared walk-forward engine only sees the two registered candidates.
    previous=engine.VARIANTS
    engine.VARIANTS=params
    try:wf=engine.walk_forward(primary,tm)
    finally:engine.VARIANTS=previous
    choices=[];chosen_oos=[];oos_dates=[]
    for f in wf.get('folds',[]):
        variants={x['name']:x for x in f['variants']};a=variants['baseline']['train'];c=variants[candidate_name]['train']
        select=candidate_name if c['trades']>=20 and c['profitFactor']>=1.10 and c['sumPnl']>0 and c['portfolioReturnPct']>=a['portfolioReturnPct'] else 'baseline'
        ds=[d for d in dates if f['testFrom']<=d<=f['testTo']]
        assert not set(ds)&set(oos_dates),'overlapping OOS days'
        oos_dates+=ds;chosen_oos += [t for t in tm[select] if t['date'] in ds]
        choices.append({'fold':f['fold'],'trainFrom':f['trainFrom'],'trainTo':f['trainTo'],'testFrom':f['testFrom'],'testTo':f['testTo'],'selected':select,'reason':'fixed training gates','test':extras(variants[select]['test'])})
    oos={x['name']:extras(x['summary']) for x in wf.get('oosVariants',[])}
    mutations=[]
    for p in params:
        original=summaries[p.name]
        for label,rows,slots in [('remove_cost',[{**t,'pnl':t['pnl']+.25} for t in tm[p.name]],3),('one_slot',tm[p.name],1)]:
            mutated=engine.summary(rows,dates,slots)
            diff=abs(mutated['portfolioReturnPct']-original['portfolioReturnPct'])
            mutations.append({'name':p.name,'mutation':label,'changedPortfolioReturnPp':diff,'detected':diff>1e-10})
    code=(ROOT/'scripts/backtest_daytrading.py').read_text(encoding='utf-8')
    assert code.count('ent=a[i+1]')==1
    mutant=types.ModuleType('g07_same_bar_mutant');sys.modules[mutant.__name__]=mutant
    exec(compile(code.replace('ent=a[i+1]','ent=a[i]'),'<G7 same-bar mutant>','exec'),mutant.__dict__)
    for p in params:
        changed=mutant.trades_for_variant(primary,p)
        differences=sum(a!=b for a,b in zip(changed,tm[p.name]))+abs(len(changed)-len(tm[p.name]))
        mutations.append({'name':p.name,'mutation':'same_bar_entry','changedTradeRecords':differences,'detected':differences>0})
    assert all(x['detected'] for x in mutations),'undetected mutation'
    source_unchanged=all(hashlib.sha256(raw_git(source_sha,m['path'])).hexdigest()==m['sha256'] for m in manifests)
    assert source_unchanged,'source hash changed'
    candidate=summaries[candidate_name];cand_oos=oos.get(candidate_name)
    positive_blocks=sum(x['portfolioReturnPct']>0 for x in blocks[candidate_name])
    gates={'positiveExpectation':candidate['dailyExpectedPct'] is not None and candidate['dailyExpectedPct']>0,
           'PF1.10':candidate['profitFactor']>=1.10,'MDD-15':candidate['portfolioMddPct']>=-15,
           'worstDay-8':candidate['worstDayPct'] is not None and candidate['worstDayPct']>=-8,
           'positiveBlocks60':positive_blocks/3>=.60,
           'OOSNotWorseThanMain':bool(cand_oos and cand_oos['portfolioReturnPct']>=oos['baseline']['portfolioReturnPct']),
           'stressPositive':stress[candidate_name]['dailyExpectedPct'] is not None and stress[candidate_name]['dailyExpectedPct']>0,
           'total30Trades':candidate['trades']>=30,'postRegistration20Days20Trades':False,'sevenSessions':False,
           'operationalParity':False}
    result={'study':study,'mainSha':'1ab0fe92a2c2b243f32939d050fda8a4d885199d','sourceSha':source_sha,
            'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'cutoff':'2026-11-12','params':[asdict(p) for p in params],
            'sourceFiles':manifests,'eligibleDates':dates,'excluded':excluded,'quality':quality,
            'summaries':summaries,'stressPlus010':stress,'chronologicalThirds':blocks,'walkForward':wf,
            'fixedTrainingSelection':choices,'selectedOOS':extras(engine.summary(chosen_oos,oos_dates,3)),
            'oos':oos,'verifications':verifications,'mutations':mutations,'sourceHashesUnchanged':source_unchanged,
            'forward':{'days':0,'trades':0,'reason':'new G7 registration; historical replay does not replace prospective evidence'},
            'gates':gates,'verdict':'retain_main','limits':['Shared historical engine replay, not live execution parity.','Original minute archive may have close-only bars and missing minutes; quality counts preserved.','No live order, FX, integer-share or market impact validation.']}
    # Resolve the registration hash from the actual git object, never a guessed ID.
    result['preregisteredCommit']=subprocess.check_output(['git','rev-parse',prereg],cwd=ROOT,encoding='utf-8').strip()
    write(out/'result.json',result);write(out/'selected-trades.json',tm);write(out/'all-signals-selected-and-unselected.json',candidates)
    write(out/'source-manifest.json',manifests)
    print(json.dumps({'study':study,'dates':len(dates),'excluded':len(excluded),'summaries':{k:{n:v[n] for n in ['trades','dailyExpectedPct','portfolioReturnPct','portfolioMddPct','profitFactor','worstDayPct','daysAtLeast1Pct']} for k,v in summaries.items()},'oos':{k:{n:v[n] for n in ['trades','dailyExpectedPct','portfolioReturnPct','profitFactor']} for k,v in oos.items()},'folds':len(choices),'gates':gates,'checks':verifications,'mutations':mutations},ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-sha',required=True);parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args();run(args.source_sha,args.out)
