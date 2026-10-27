import json
from pathlib import Path
import tempfile
import unittest
import datetime as dt
import nightly_closing30_research as engine

class ClosingHistory(unittest.TestCase):
    def test_sorted_next_open_sell_does_not_reopen_completed_position(self):
        events=[{'kind':'overnight','variant':'baseline','code':'005930','stage':s,'price':p,'pnl':v}
                for s,p,v in [('sell',102,1.77),('signal',None,None),('buy',100,None)]]
        rows=engine.flatten({'date':'2026-10-23','events':events})
        self.assertEqual(rows[0]['state'],'closed')
        self.assertEqual(rows[0]['pnl'],1.77)

    @staticmethod
    def sample(days=22):
        ledgers=[]
        for i in range(days):
            date=(dt.date(2026,9,1)+dt.timedelta(days=i)).isoformat()
            events=[]
            for variant,pnl in [('baseline',.1),('dip_2',1.2)]:
                for code in ['005930','009150']:
                    for stage in ['signal','buy','sell']:
                        events.append({'kind':'day','variant':variant,'code':code,'stage':stage,'price':100 if stage=='buy' else 102,'pnl':pnl if stage=='sell' else None})
            ledgers.append({'date':date,'scans':[{'targetHm':1506,'partial':False,'quoteErrors':0}], 'events':events})
        return ledgers

    def test_fixed_slots_compound_risk_and_time_ordered_benchmark_edges(self):
        ls=self.sample();section=engine.research_section('day',ls,{},[])
        row=next(x for x in section['candidates'] if x['name']=='dip_2')
        self.assertEqual(row['trades'],44)
        self.assertAlmostEqual(row['summary']['daily'][0]['returnPct'],.8)
        self.assertAlmostEqual(row['summary']['compoundReturnPct'],((1.008**22)-1)*100)
        self.assertAlmostEqual(row['allAvgEdgePct'],(2.4-.2)/3)
        self.assertEqual(row['status'],'review')
        self.assertEqual(section['lifecycle']['autoPromotionReady'],False)

    def test_seven_distinct_evidence_sessions_not_backup_or_weekend_runs(self):
        prior={};ls=self.sample(29)
        for length in range(22,29):
            section=engine.research_section('day',ls[:length],prior,[])
            duplicate=engine.research_section('day',ls[:length],section['lifecycle'],[])
            self.assertEqual(duplicate['lifecycle']['leader'],section['lifecycle']['leader'])
            prior=section['lifecycle']
        self.assertEqual(prior['leader']['consecutiveResearchSessions'],7)
        self.assertEqual(prior['autoPromotionCandidate'],'dip_2')
        # No later fully closed evidence: it is still the same research session.
        self.assertEqual(engine.research_section('day',ls[:28],prior,[])['lifecycle']['leader']['consecutiveResearchSessions'],7)

    def test_partial_missing_and_short_samples_never_promote(self):
        ls=self.sample(22)
        for l in ls:l['scans'][0]['partial']=True
        self.assertFalse(engine.research_section('day',ls,{},[])['baseline']['daily'])
        short=engine.research_section('day',self.sample(19),{},[])
        self.assertFalse(any(x['eligibleToPromote'] for x in short['candidates']))
        bad=engine.research_section('day',self.sample(22),{},[{'date':'missing'}])
        self.assertFalse(any(x['eligibleToPromote'] for x in bad['candidates']))

    def test_shared_factory_retirement_replenishment_and_no_backdated_generated_samples(self):
        ls=self.sample(22)
        first=engine.research_section('day',ls,{},[])
        life=first['lifecycle']
        self.assertEqual(life['generatedPool'][0]['name'],'cf_g0001')
        self.assertEqual(life['generatedPool'][0]['createdAfter'],ls[-1]['date'])
        next_report=engine.research_section('day',ls,life,[])
        generated=next(x for x in next_report['candidates'] if x['name']=='cf_g0001')
        self.assertEqual(generated['trades'],0)
        self.assertEqual(generated['summary']['observedDays'],0)
        from nightly_scalping_research import evolve_lifecycle
        previous={'activeCandidates':engine.NAMES[1:],'poorStreaks':{'dip_1':2},'lastEvidenceDate':'2026-09-21',
          'lastFactoryDate':'2026-09-21','generatedPool':[{'name':'cf_g0001','params':{'side':'dip','threshold':0,'volume':0},'createdAfter':'2026-09-20'}]}
        section={'to':'2026-09-22','candidates':[{'name':name,'trades':50,'researchScore':20 if name=='dip_1' else 60,'sampleReady':True,'sampleFactor':1,
          'validationAvgEdgePct':-.2 if name=='dip_1' else .2,'mddOk':name!='dip_1','status':'collecting'} for name in engine.NAMES[1:]+['cf_g0001']]}
        evolved=evolve_lifecycle('closing30',section,previous)
        self.assertEqual(len(evolved['activeCandidates']),10)
        self.assertNotIn('dip_1',evolved['activeCandidates'])
        self.assertIn('cf_g0001',evolved['activeCandidates'])
        self.assertEqual(evolved['retired'][0]['name'],'dip_1')

    def test_mutants_daily_weight_and_early_promotion_are_detected(self):
        import types
        source=Path(engine.__file__).read_text()
        for old,new,check in [
          ("/3,'trades':len(rs)","/len(rs) if rs else 0,'trades':len(rs)",lambda m:self.assertAlmostEqual(m.research_section('day',self.sample(),{},[])['baseline']['daily'][0]['returnPct'],.2/3)),
          ("len(paired)>=20","len(paired)>=1",lambda m:self.assertFalse(any(x['eligibleToPromote'] for x in m.research_section('day',self.sample(19),{},[])['candidates']))),
        ]:
            self.assertIn(old,source)
            module=types.ModuleType('closing_mutant');exec(compile(source.replace(old,new),'<mutant>','exec'),module.__dict__)
            with self.assertRaises(AssertionError):check(module)

    def test_refresh_open_overnight_after_long_holiday(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'2026-10-01.json'
            ledger={'date':'2026-10-01','events':[{'kind':'overnight','variant':'baseline','code':'005930','stage':'buy','price':100}]}
            p.write_text(json.dumps(ledger))
            self.assertTrue(engine.needs_refresh(p))
            ledger['events'].append({'kind':'overnight','variant':'baseline','code':'005930','stage':'sell','price':101,'pnl':.77})
            p.write_text(json.dumps(ledger))
            self.assertFalse(engine.needs_refresh(p))
            self.assertTrue(engine.needs_refresh(p,True))

    def test_backup_same_day_and_weekend_do_not_reset_or_add_streak(self):
        prior={'leader':'dip_2','date':'2026-10-21','leaderStreak':6}
        self.assertEqual(engine.leader_streak(prior,'dip_2','2026-10-21'),6)
        self.assertEqual(engine.leader_streak(prior,'dip_2','2026-10-22'),7)
        self.assertEqual(engine.leader_streak(prior,'dip_3','2026-10-22'),1)
        self.assertEqual(engine.leader_streak(prior,None,'2026-10-22'),0)

    def test_old_refresh_and_backup_mutants_fail_values(self):
        old=lambda prior,leader,date:(int(prior.get('leaderStreak') or 0)+1) if leader and prior.get('leader')==leader and prior.get('date')!=date else (1 if leader else 0)
        with self.assertRaises(AssertionError):self.assertEqual(old({'leader':'dip_2','date':'2026-10-21','leaderStreak':6},'dip_2','2026-10-21'),6)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'old.json'
            p.write_text(json.dumps({'date':'2026-10-01','events':[{'kind':'overnight','variant':'baseline','code':'005930','stage':'buy','price':100}]}))
            old_refresh=lambda path,recent=False:recent or not path.is_file()
            self.assertTrue(engine.needs_refresh(p))
            with self.assertRaises(AssertionError):self.assertEqual(old_refresh(p),True)

if __name__=='__main__':unittest.main()
