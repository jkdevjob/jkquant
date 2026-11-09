"""Actual archive writes/reads, plus regressions to discarded/mutated evidence."""
import gzip, inspect, json, tempfile, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
import collect_crypto_data as collector
import backtest_crypto_orb as engine
import daily1_shadow_lab as shadow

def bars(day, count=288, price=100):
    start=datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    out=[]
    for i in range(count):
        t=start+timedelta(minutes=5*i)
        out.append(dict(tUtc=t.replace(tzinfo=None).isoformat(),tKst=t.astimezone(collector.KST).replace(tzinfo=None).isoformat(),o=price,h=price+1,l=price-1,c=price,v=1,amount=price))
    return out

class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.base=Path(self.tmp.name)
        self.root=self.base/'crypto/KRW-BTC/5m'
        self.patches=[patch.object(collector,'ROOT',self.root),patch.object(engine,'DATA',self.root),patch.object(shadow,'DATA',self.base)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def test_partial_restores_complete_kst_and_keeps_incomplete_pending(self):
        collector.write_days(bars('2026-11-07'))
        original=self.root/'2026-11-07.json.gz';before=original.read_bytes()
        written,incomplete=collector.write_days(bars('2026-11-08',228))
        self.assertEqual(written,[]);self.assertEqual(incomplete,[('2026-11-08',228)])
        files=list((self.root/'partials/2026-11-08').glob('*.json.gz'));self.assertEqual(len(files),1)
        self.assertEqual(original.read_bytes(),before)
        days={d['sessionDateKst']:d for d in engine.load_days()}
        self.assertEqual(len(days['2026-11-08']['bars']),288)
        self.assertEqual(engine.valid_day(days['2026-11-08']),(True,''))
        self.assertFalse(engine.valid_day(days['2026-11-09'])[0])
        self.assertEqual([d['date'] for d in shadow.load_crypto_days()],['2026-11-08'])
    def test_same_partial_is_immutable_and_revisions_are_separate(self):
        row=bars('2026-11-08',228);collector.write_days(row)
        paths=list((self.root/'partials/2026-11-08').glob('*.json.gz'));self.assertEqual(len(paths),1)
        before=paths[0].read_bytes();collector.write_days(row);self.assertEqual(paths[0].read_bytes(),before)
        changed=[dict(b) for b in row];changed[0]['v']=2;collector.write_days(changed)
        self.assertEqual(len(list(paths[0].parent.glob('*.json.gz'))),2)
        self.assertEqual(paths[0].read_bytes(),before)
        latest=next(d for d in engine.load_days() if d['sessionDateKst']=='2026-11-08')
        self.assertEqual(latest['bars'][0]['v'],2)
    def test_complete_canonical_source_has_priority_and_no_double_count(self):
        collector.write_days(bars('2026-11-07'));collector.write_days(bars('2026-11-08',228,90))
        collector.write_days(bars('2026-11-08',288,100))
        days={d['sessionDateKst']:d for d in engine.load_days()}
        d=days['2026-11-08'];self.assertEqual(len(d['bars']),288)
        self.assertEqual(len({b['tUtc'] for b in d['bars']}),288)
        self.assertEqual(next(b for b in d['bars'] if b['tKst'].endswith('09:00:00'))['c'],100)

def run_suite(stream=None):
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(ArchiveTests)
    if stream:return unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)
    result=unittest.TestResult();suite.run(result);return result

if __name__=='__main__':
    import sys
    good=run_suite(sys.stdout)
    if not good.wasSuccessful():raise SystemExit(1)
    original_write=collector.write_partial;original_paths=engine.crypto_archive_files;original_shadow_paths=shadow.crypto_archive_files
    mutants=[
        ('old_discard_partial',lambda:setattr(collector,'write_partial',lambda *a:None)),
        ('old_read_complete_utc_only',lambda:(setattr(engine,'crypto_archive_files',lambda p:sorted(p.glob('*.json.gz'))),setattr(shadow,'crypto_archive_files',lambda p:sorted(p.glob('*.json.gz'))))),
        ('overwrite_previous_snapshot',lambda:exec(inspect.getsource(original_write).replace('out.open("xb")','out.open("wb")'),collector.__dict__)),
    ]
    for name,apply in mutants:
        apply();result=run_suite()
        collector.write_partial=original_write;engine.crypto_archive_files=original_paths;shadow.crypto_archive_files=original_shadow_paths
        if result.wasSuccessful():raise SystemExit('FAIL mutation survived: '+name)
        print('PASS mutation detected:',name)
    print('ALL PASS BTC partial archive: 3 values / 3 mutations; no strategy or order change')
