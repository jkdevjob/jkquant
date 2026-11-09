"""Value and mutation checks for a saved G1 replay; never touches Worker code."""
import argparse,json,shutil,subprocess,tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
ap=argparse.ArgumentParser();ap.add_argument('output',type=Path);ap.add_argument('--daily-api',type=Path,required=True);args=ap.parse_args()
read=lambda p:json.loads(p.read_text(encoding='utf-8'))
r=read(args.output/'result.json');raw=read(args.output/'worker-output.json')
assert r['engineParity']['completeComparisons']==790 and not r['engineParity']['mismatches']
assert r['validDays']==395 and r['to']=='2026-11-08'
today=read(args.daily_api);live=next(v for v in today['strategies'] if v['strategy']=='crypto')['previous']
t=next(v['trade'] for v in raw if v['date']==live['date'] and v['variant']=='baseline')
assert live['finalized'] and live['trades']==1 and abs(live['returnPct']-t['pnlPct'])<1e-10
seen=set()
for f in r['folds']:
    assert f['trainTo']<f['testFrom']<=f['testTo']
    labels={d['date'] for d in f['test']['baseline']['daily']}
    assert not seen.intersection(labels);seen.update(labels)
assert len(seen)==270
for n,m in r['periods']['all'].items():
    assert abs((m['normal']['avgDailyReturnPct']-m['stressPlus010']['avgDailyReturnPct'])-.1*m['normal']['trades']/395)<1e-12
print('PASS G1: live 11/8 net return, 790 engine comparisons, 395 full sessions, non-overlapping chronological folds, explicit cost stress')
src=Path(__file__).with_name('g01_btc_volume.mjs').read_text(encoding='utf-8')
src=src.replace("const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');",'const root='+json.dumps(str(ROOT))+';')
needle="const {btcTrade,btcNoTradeDecision}=await import("
mutations={
 'candidate_volume_reverted':src.replace("['vol_1.5',1.5]","['vol_1.5',1.2]"),
 'same_signal_bar_entry':src.replace(needle,"source=source.replaceAll('const entry=a[i+1];','const entry=a[i];');\n"+needle),
 'round_trip_cost_removed':src.replace(needle,"source=source.replace('friction:.14,params:p','friction:0,params:p');\n"+needle),
}
with tempfile.TemporaryDirectory(dir=args.output) as td:
    td=Path(td)
    for name,code in mutations.items():
        p=td/(name+'.mjs');out=td/(name+'.json');p.write_text(code,encoding='utf-8')
        subprocess.run([shutil.which('node'),str(p),str((args.output/'engine-input.json').resolve()),str(out)],check=True,cwd=ROOT)
        changed=read(out);assert changed!=raw,'mutation survived: '+name
        mismatches=sum(a['trade']!=b['trade'] for a,b in zip(raw,changed))
        assert mismatches>0,'mutation did not affect a trade: '+name
        print('PASS mutation detected:',name,'divergent decisions',mismatches)
