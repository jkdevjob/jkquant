import copy
import datetime as dt
import unittest
from pathlib import Path
from closing30_metrics import daily_rows,summarize,section,condition_analysis,walk_forward
from nightly_scalping_research import evolve_lifecycle

def fixture(days=40):
    ledgers=[];rows=[]
    for i in range(days):
        date=(dt.date(2026,9,1)+dt.timedelta(days=i)).isoformat()
        ledgers.append({'date':date,'scans':[{'targetHm':hm,'kind':'day','variants':[{'id':'dip_2'}]}
                       for hm in (1506,1522,1540)]})
        for variant,pnl in [('baseline',.1),('dip_2',.4)]:
            for code in ('A','B'):
                rows.append({'date':date,'kind':'day','variant':variant,'code':code,'state':'closed','pnl':pnl})
    return rows,ledgers

class ClosingParity(unittest.TestCase):
    def test_unknown_condition_and_absent_outcomes_remain_missing(self):
        rows,_=fixture(1)
        x=condition_analysis(rows[:1])
        self.assertIn('gap:missing',[g['condition'] for g in x['groups']])
        self.assertEqual(x['horizonCoverage']['30'],{'observed':0,'missing':1})
        from nightly_closing30_research import ledger_extends,flatten
        original={'date':'2026-11-10','events':[{'id':'a','kind':'day','variant':'baseline','code':'A','stage':'buy','price':100,
            'priceAt':'2026-11-10T15:06:00+09:00','createdAt':'2026-11-10T15:07:00+09:00'}]}
        self.assertEqual(flatten(original)[0]['entryTime'],'2026-11-10T15:06:00+09:00')
        self.assertTrue(ledger_extends(original,{**original,'events':original['events']+[{'id':'b'}]}))
        self.assertFalse(ledger_extends(original,{**original,'events':[]}))
        self.assertFalse(ledger_extends(original,{**original,'events':[{**original['events'][0],'price':101}]}))
    def test_fixed_slots_zero_trade_and_missing_coverage(self):
        rows,ledgers=fixture(2)
        ds=daily_rows(rows,ledgers,'day','dip_2')
        self.assertAlmostEqual(ds[0]['returnPct'],.8/3)
        sm=summarize([x for x in rows if x['variant']=='dip_2'],ds)
        self.assertAlmostEqual(sm['totalReturnPct'],((1+.8/300)**2-1)*100)
        self.assertEqual(sm['observedDays'],2)
        self.assertEqual(daily_rows([],ledgers,'day','dip_2')[0]['returnPct'],0)
        self.assertEqual(daily_rows([],ledgers,'day','unobserved'),[])
        ledgers[0]['scans'][0]['partial']=True
        self.assertEqual(len(daily_rows(rows,ledgers,'day','dip_2')),1)

    def test_all_gates_forward_cost_stress_and_common_lifecycle(self):
        rows,ledgers=fixture()
        r=section('closing30',rows,ledgers,{},[])
        candidate=next(x for x in r['candidates'] if x['name']=='dip_2')
        self.assertTrue(candidate['eligibleToPromote'])
        self.assertEqual(candidate['summary']['trades'],80)
        self.assertEqual(candidate['holdoutTrades'],40)
        self.assertAlmostEqual(candidate['allAvgEdgePct'],.3)
        self.assertAlmostEqual(candidate['validationAvgEdgePct'],.3)
        self.assertAlmostEqual(candidate['stress']['avgPnl'],.3)
        self.assertEqual(len(r['lifecycle']['activeCandidates']),10)
        self.assertEqual(r['lifecycle']['leader']['consecutiveResearchSessions'],1)
        self.assertEqual(r['lifecycle']['autoPromotionCandidate'],None)
        again=section('closing30',rows,ledgers,r['lifecycle'],[])
        self.assertEqual(again['lifecycle']['leader']['consecutiveResearchSessions'],1)
        for i in range(2,8):
            later=copy.deepcopy(r);later['to']=(dt.date(2026,10,10)+dt.timedelta(days=i)).isoformat()
            r['lifecycle']=evolve_lifecycle('closing30',later,r['lifecycle'])
        self.assertEqual(r['lifecycle']['leader']['consecutiveResearchSessions'],7)
        self.assertEqual(r['lifecycle']['autoPromotionCandidate'],'dip_2')

    def test_walk_forward_selection_cannot_read_the_later_profitable_block(self):
        rows,ledgers=fixture()
        for x in rows:
            if x['variant']=='dip_2' and x['date']<ledgers[20]['date']:x['pnl']=-.1
        candidate=[x for x in rows if x['variant']=='dip_2'];base=[x for x in rows if x['variant']=='baseline']
        cd=daily_rows(candidate,ledgers,'day','dip_2');bd=daily_rows(base,ledgers,'day','baseline')
        result=walk_forward(candidate,base,cd,bd,'dip_2')
        self.assertEqual(result['folds'][0]['selected'],'baseline')
        self.assertEqual(result['folds'][0]['trainTo'],ledgers[19]['date'])
        self.assertEqual(result['folds'][0]['testFrom'],ledgers[20]['date'])
        import closing30_metrics as module
        source=Path(module.__file__).read_text(encoding='utf-8')
        mutant=source.replace("train=summarize([x for x in rows if x['date'] in train_dates],[candidate[d] for d in dates[:start]])",'train=summarize(rows,list(candidate.values()))')
        self.assertNotEqual(mutant,source);ctx={};exec(compile(mutant,module.__file__,'exec'),ctx)
        with self.assertRaises(AssertionError):
            self.assertEqual(ctx['walk_forward'](candidate,base,cd,bd,'dip_2')['folds'][0]['selected'],'baseline')

    def test_weak_stress_partial_fetch_and_unsettled_block_promotion(self):
        rows,ledgers=fixture()
        for x in rows:
            if x['variant']=='dip_2':x['pnl']=.09
        r=section('closing30',rows,ledgers,{},[])
        cand=next(x for x in r['candidates'] if x['name']=='dip_2')
        self.assertFalse(cand['checks']['costStress']);self.assertFalse(cand['eligibleToPromote'])
        rows,ledgers=fixture();ledgers[0]['scans'][0]['partial']=True
        r=section('closing30',rows,ledgers,{},[])
        cand=next(x for x in r['candidates'] if x['name']=='dip_2')
        self.assertFalse(cand['checks']['sourceComplete']);self.assertFalse(cand['eligibleToPromote'])
        rows,ledgers=fixture();rows[-1]['state']='open';rows[-1]['pnl']=None
        r=section('closing30',rows,ledgers,{},[])
        cand=next(x for x in r['candidates'] if x['name']=='dip_2')
        self.assertEqual(cand['summary']['unsettled'],1);self.assertFalse(cand['eligibleToPromote'])
        rows,ledgers=fixture();r=section('closing30',rows,ledgers,{},[{'error':'timeout'}])
        self.assertTrue(all(not x['eligibleToPromote'] for x in r['candidates']))

    def test_value_mutants_fixed_slots_and_unknown_as_zero_are_detected(self):
        import closing30_metrics as module
        source=Path(module.__file__).read_text(encoding='utf-8')
        original={};exec(compile(source,module.__file__,'exec'),original)
        rows,ledgers=fixture(2)
        expected=original['daily_rows'](rows,ledgers,'day','dip_2')
        for old,new in [('sum(x[\'pnl\'] for x in xs)/3','sum(x[\'pnl\'] for x in xs)/max(1,len(xs))'),
                        ('if not observed:continue','if False:continue')]:
            mutant=source.replace(old,new);self.assertNotEqual(mutant,source)
            ctx={};exec(compile(mutant,module.__file__,'exec'),ctx)
            with self.assertRaises(AssertionError):
                if old=='if not observed:continue':self.assertEqual(ctx['daily_rows']([],ledgers,'day','unobserved'),[])
                else:self.assertEqual(ctx['daily_rows'](rows,ledgers,'day','dip_2'),expected)

if __name__=='__main__':unittest.main()
