"""KST morning source boundary, immutable partials, merged-day value and mutants."""
import gzip,importlib.util,json,sys,tempfile,types
from datetime import datetime,timedelta,timezone
from pathlib import Path
import collect_crypto_data as collector
import backtest_crypto_orb as engine

def boundaries(fn):
    cases=[('2026-11-15T22:00:00+00:00','2026-11-15T15:00:00+00:00'),
           ('2026-11-15T15:01:00+00:00','2026-11-15T15:00:00+00:00'),
           ('2026-11-16T00:20:00+00:00','2026-11-16T00:00:00+00:00')]
    for now,expected in cases:assert fn(datetime.fromisoformat(now)).isoformat()==expected

def rows(start,count):
    result=[]
    for i in range(count):
        t=start+timedelta(minutes=5*i)
        result.append({'tUtc':t.replace(tzinfo=None).isoformat(timespec='seconds'),'tKst':t.astimezone(collector.KST).replace(tzinfo=None).isoformat(timespec='seconds'),
                       'o':100.,'h':101.,'l':99.,'c':100.,'v':1.})
    return result

boundaries(collector.completed_collection_end)
with tempfile.TemporaryDirectory() as tmp:
    previous_root,previous_data=collector.ROOT,engine.DATA
    collector.ROOT=Path(tmp);engine.DATA=Path(tmp)
    try:
        collector.write_days(rows(datetime(2026,11,14,tzinfo=timezone.utc),288))
        canonical=Path(tmp)/'2026-11-14.json.gz';before=canonical.read_bytes()
        added=rows(datetime(2026,11,15,tzinfo=timezone.utc),180)
        collector.write_days(added)
        partials=list((Path(tmp)/'partials/2026-11-15').glob('*.gz'));assert len(partials)==1
        immutable=partials[0].read_bytes();collector.write_days(added)
        assert partials[0].read_bytes()==immutable and canonical.read_bytes()==before
        assert len(list((Path(tmp)/'partials/2026-11-15').glob('*.gz')))==1
        assert not (Path(tmp)/'2026-11-15.json.gz').exists()
        merged=next(d for d in engine.load_days() if d['sessionDateKst']=='2026-11-15')
        expected=[(datetime(2026,11,15)+timedelta(minutes=5*i)).isoformat(timespec='seconds') for i in range(288)]
        assert [b['tKst'] for b in merged['bars']]==expected
        assert not any(d['sessionDateKst']>'2026-11-15' for d in engine.load_days())
        assert engine.valid_day(merged)[0]
    finally:collector.ROOT,engine.DATA=previous_root,previous_data
print('PASS KST morning/UTC rollover boundaries; 288 merged bars; unfinished KST day excluded; original bytes/idempotent partials')
source=Path(collector.__file__).read_text(encoding='utf-8');assert source.count('return max(utc_midnight, kst_midnight)')==1
for label,replacement in [('old_utc_cutoff','return utc_midnight'),('drops_closed_utc','return kst_midnight'),('unfinished_day','return now')]:
    module=types.ModuleType('crypto_window_mutant_'+label);module.__file__=collector.__file__
    exec(compile(source.replace('return max(utc_midnight, kst_midnight)',replacement),'<crypto-window-mutant>','exec'),module.__dict__)
    try:boundaries(module.completed_collection_end)
    except AssertionError:print('PASS killed:',label)
    else:raise AssertionError('survived:'+label)
