import json
from pathlib import Path
import tempfile
import unittest
import nightly_closing30_research as engine

class ClosingHistory(unittest.TestCase):
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
