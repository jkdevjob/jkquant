"""Independent accounting and mutation sensitivity for preregistered G9."""
import argparse,hashlib,json,math,statistics,sys,types
from dataclasses import asdict,replace
from pathlib import Path
from g09_btc_cutoff import ROOT,engine,metrics

def verify(folder,sources,refetch):
    result=json.loads((folder/'result.json').read_text(encoding='utf-8'))
    trades=json.loads((folder/'trades.json').read_text(encoding='utf-8'))
    days=json.loads((folder/'engine-input.json').read_text(encoding='utf-8'))
    labels=[x['date'] for x in result['periods']['all']['baseline']['normal']['daily']]
    valid=[d for d in days if d['sessionDateKst'] in labels]
    checks=[];mutations=[];blocks={};params={n:engine.Params(n,entry_cutoff_min=1315 if n=='baseline' else 1075) for n in trades}
    for name,rows in trades.items():
        s=result['periods']['all'][name]['normal'];by={d:0.0 for d in labels};fee_diffs=[]
        for t in rows:
            independent=(t['exitPrice']/t['entryPrice']-1)*100-.14
            if abs(independent-t['pnlPct'])>1e-9:fee_diffs.append(t['date'])
            by[t['date']]+=t['pnlPct']
        expected=100*(math.prod(1+by[d]/100 for d in labels)-1)
        assert not fee_diffs and abs(expected-s['compoundReturnPct'])<1e-9
        assert abs(statistics.fmean(by.values())-s['avgDailyReturnPct'])<1e-9
        checks.append({'variant':name,'costAndAccountParity':'PASS','trades':len(rows),'days':len(labels)})
        mutations.append({'variant':name,'mutation':'remove_cost','differences':sum(abs((t['exitPrice']/t['entryPrice']-1)*100-t['pnlPct'])>1e-9 for t in rows)})
        parts=[labels[len(labels)*i//3:len(labels)*(i+1)//3] for i in range(3)]
        blocks[name]=[{'from':ds[0],'to':ds[-1],'normal':metrics([t for t in rows if t['date'] in ds],ds),'stressPlus010':metrics([t for t in rows if t['date'] in ds],ds,.1)} for ds in parts]
    code=(ROOT/'scripts/backtest_crypto_orb.py').read_text(encoding='utf-8');assert code.count('entry_i = signal_i + 1')==1
    mutant=types.ModuleType('g09_samebar_mutant');mutant.__file__=str(ROOT/'scripts/backtest_crypto_orb.py');sys.modules[mutant.__name__]=mutant
    exec(compile(code.replace('entry_i = signal_i + 1','entry_i = signal_i'),'<G9 same-bar mutant>','exec'),mutant.__dict__)
    for name,p in params.items():
        original={t['date']:t for t in trades[name]};diff=[]
        for d in valid:
            actual=mutant.trade_for_day(d,p);prior=original.get(d['sessionDateKst'])
            if bool(actual)!=bool(prior) or actual and any(actual.get(k)!=prior.get(k) for k in ['entryTimeKst','entryPrice','exitTimeKst','pnlPct']):diff.append(d['sessionDateKst'])
        mutations.append({'variant':name,'mutation':'same_bar_entry','differences':len(diff),'dates':diff})
    b={t['date']:t for t in trades['baseline']};c={t['date']:t for t in trades['entry_by_1800']}
    changed=[d for d in labels if b.get(d)!=c.get(d) and (bool(b.get(d))!=bool(c.get(d)) or b[d]['pnlPct']!=c[d]['pnlPct'])]
    mutations.append({'variant':'entry_by_1800','mutation':'restore_2155_cutoff','differences':len(changed),'dates':changed})
    assert all(x['differences']>0 for x in mutations)
    seen=[]
    for f in result['folds']:
        assert f['trainTo']<f['testFrom']
        ds=[d for d in labels if f['testFrom']<=d<=f['testTo']];assert not set(seen)&set(ds);seen+=ds
    changed_files=[]
    for source in result['sourceManifest']:
        path=refetch if source['path']==refetch.name else sources/source['path']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=source['sha256']:changed_files.append(source['path'])
    assert not changed_files and not result['engineParity']['mismatches']
    candidate=result['periods']['all']['entry_by_1800']['normal'];stressed=result['periods']['all']['entry_by_1800']['stressPlus010']
    positive_folds=sum(f['test']['entry_by_1800']['avgDailyReturnPct']>0 for f in result['folds'])
    gates={'positiveNetExpectation':candidate['avgDailyReturnPct']>0,'PF1.10':candidate['profitFactor']>=1.1,'MDD-15':candidate['maxDrawdownPct']>=-15,'worstDay-8':candidate['worstDayPct']>=-8,
           'positiveFolds60':positive_folds/len(result['folds'])>=.6,'positiveThirds60':sum(x['normal']['avgDailyReturnPct']>0 for x in blocks['entry_by_1800'])/3>=.6,
           'OOSNotWorseThanMain':result['walkForward']['entry_by_1800']['normal']['avgDailyReturnPct']>=result['walkForward']['baseline']['normal']['avgDailyReturnPct'],
           'stressPositive':stressed['avgDailyReturnPct']>0,'total50Trades':candidate['trades']>=50,'prospective20Days20Trades':False,'sevenLeaderSessions':False,'engineParity':True}
    validation={'study':'G9','checks':checks,'mutations':mutations,'sourceHashChanges':changed_files,'chronologicalThirds':blocks,'params':{k:asdict(v) for k,v in params.items()},'OOSDays':len(seen),'positiveFolds':positive_folds,'foldCount':len(result['folds']),'gates':gates,'passed':True,'verdict':'reject_candidate_retain_main'}
    (folder/'validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:validation[k] for k in ['study','checks','sourceHashChanges','OOSDays','positiveFolds','foldCount','gates','passed','verdict']},ensure_ascii=False))
    print(json.dumps({'mutations':[{k:x[k] for k in ['variant','mutation','differences']} for x in mutations]},ensure_ascii=False))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('folder',type=Path);p.add_argument('--sources',type=Path,required=True);p.add_argument('--refetch',type=Path,required=True);a=p.parse_args();verify(a.folder,a.sources,a.refetch)
