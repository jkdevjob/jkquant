"""Value tests for F: historical membership, execution guard, same-entry overnight exits."""
import copy
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
import opening_backfill as b
import backtest_opening_rebreak as r


def signal_row():
    prices = [103,103,103,104,103.6,104.2,102,101,100]
    bars = [dict(t=f'2026092509{i:02}00',o=p,h=p,l=p,c=p,v=100 if i != 5 else 500)
            for i,p in enumerate(prices)]
    bars.append(dict(t='20260925093000',o=100,h=100,l=100,c=100,v=100))
    return dict(code='000001',name='fixture',rank=1,open=103,prevClose=100,bars=bars,
                nextOpen=dict(date='2026-09-28',price=110,source='fixture'))


class Tests(unittest.TestCase):
    def test_price_basis_mismatch_blocks_adoption_without_changing_records(self):
        days=[dict(date='2026-02-09',universeTiming='same-day-close',universe=[dict(
            code='011930',open=2270,bars=[dict(t='20260209090000',o=22700)])])]
        before=copy.deepcopy(days)
        validation=r.price_basis_validation(days)
        self.assertEqual(validation['status'],'blocked_price_basis_mismatch')
        self.assertEqual(validation['mismatches'][0]['ratio'],10)
        report=dict(comparisonStatus='eligible',variants=[dict(avgPnl=1.2)],walkForward=dict(
            status='reviewable',adoptionReview=[dict(passesPredeclaredRule=True)]))
        r.apply_price_basis_gate(report,validation)
        self.assertEqual(report['comparisonStatus'],'data_review_required')
        self.assertFalse(report['walkForward']['adoptionReview'][0]['passesPredeclaredRule'])
        self.assertTrue(report['walkForward']['adoptionReview'][0]['statisticalRuleBeforeDataValidation'])
        self.assertEqual(report['variants'],[dict(avgPnl=1.2)])
        self.assertEqual(days,before)

    def test_price_basis_missing_open_not_assumed_valid_and_delayed_open_checked(self):
        day=dict(date='2025-11-13',universeTiming='same-day-close',collectionWindow=['100000','110000'],
            universe=[dict(code='005930',open=100,bars=[dict(t='20251113100015',o=100)])])
        self.assertEqual(r.price_basis_validation([day])['status'],'observed_open_consistent')
        day['universe'][0]['bars'][0]['t']='20251113100100'
        self.assertEqual(r.price_basis_validation([day])['status'],'unverified_opening_observation')

    def test_delayed_open_fetches_actual_hour_without_shifting_strategy(self):
        for day in ('2025-11-13','2026-01-02'):
            prefix=day.replace('-','')
            bars=[dict(t=prefix+t,o=1,h=1,l=1,c=1,v=1) for t in ('090000','100000','100100','110000','110100')]
            with patch.object(b,'request_json',return_value=dict(bars=bars)) as request:
                result=b.minute_bars('005930',day)
                self.assertEqual([x['t'][-6:] for x in result],['100000','100100','110000'])
                self.assertIn('hour=110000',request.call_args.args[0])
                self.assertEqual([x['hm'] for x in r.norm_bars(dict(bars=result))],[1000])

    def test_delayed_window_checkpoint_recollects_each_stale_symbol(self):
        day='2025-11-13'
        rows=[dict(code=f'{i:06}',amount=100-i,close=1,open=1,prevClose=1,volume=1) for i in range(100)]
        bar=dict(t='20251113100000',o=1,h=1,l=1,c=1,v=1)
        # Interrupted upgrade: top-level window already new, only first row refreshed.
        cached=[dict(x,bars=[bar],sourceRequestComplete=True) for x in rows]
        cached[0]['collectionWindow']=['100000','110000']
        with tempfile.TemporaryDirectory() as tmp, patch.object(b,'ROOT',Path(tmp)), \
                patch.object(b,'daily_snapshot',return_value=dict(rows=rows)), \
                patch.object(b,'next_session',return_value=None),patch.object(b,'guard'), \
                patch.object(b,'minute_bars',return_value=[bar]) as fetch:
            path=Path(tmp)/'archives'/'2025'/f'{day}.json.gz'
            b.save(path,dict(universe=cached,collectionWindow=['100000','110000']))
            result=b.collect_day(day,day)
            self.assertEqual(fetch.call_count,99)
            self.assertEqual(result['status'],'complete')

    def test_year_boundary_resolves_exact_next_session(self):
        jan2 = dict(date='2026-01-02', rows=[dict(code='fixture', volume=1)])
        with tempfile.TemporaryDirectory() as tmp, patch.object(b,'ROOT',Path(tmp)), \
                patch.dict(b.os.environ, {'KRX_COOKIE':''}), \
                patch.object(b,'public_snapshot',return_value=jan2) as read:
            self.assertEqual(b.next_session('2025-12-30','2026-01-05'),jan2)
            read.assert_called_once_with('2026-01-02')

    def test_unknown_source_failure_is_not_a_holiday(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(b,'ROOT',Path(tmp)), \
                patch.dict(b.os.environ, {'KRX_COOKIE':''}), \
                patch.object(b,'public_snapshot',side_effect=RuntimeError('source unavailable')):
            with self.assertRaisesRegex(RuntimeError,'source unavailable'):
                b.daily_snapshot('2026-01-05')

    def test_budget_stops_before_another_network_request(self):
        with patch.object(b,'DEADLINE',0), patch.object(b.urllib.request,'urlopen') as network:
            with self.assertRaises(b.TimeBudget):
                b.request_bytes('https://example.com')
            network.assert_not_called()

    def test_market_guard_boundaries_and_weekends(self):
        for hour, minute, blocked in [(8,29,False),(8,30,True),(15,40,True),(15,41,False)]:
            for day in (25,26):
                now = datetime(2026,9,day,hour,minute,tzinfo=b.KST)
                if blocked:
                    with self.assertRaises(b.MarketHours): b.guard(now)
                else: b.guard(now)

    def test_historical_rank_uses_amount_not_cap_or_today(self):
        rows = [dict(code='dead',amount=300,close=1,cap=1), dict(code='live',amount=100,close=9,cap=999)]
        ranked = b.rank_rows(dict(rows=rows))
        self.assertEqual([x['code'] for x in ranked], ['dead','live'])
        self.assertEqual([x['rank'] for x in ranked], [1,2])

    def test_baseline_same_entry_and_no_stop_for_overnight(self):
        row = signal_row()
        days = [dict(date='2026-09-25',universe=[row])]
        base = r.trades_for_days(days,r.Params('baseline'))[0]
        hold = r.trades_for_days(days,r.Params('hold_to_next_open',exit_policy='next_session_open'))[0]
        self.assertEqual(base['entryTime'], hold['entryTime'])
        self.assertEqual(base['entryPrice'], hold['entryPrice'])
        self.assertLess(base['pnl'],0)
        self.assertEqual(hold['exitDate'],'2026-09-28')
        self.assertEqual(hold['exitPrice'],110)
        self.assertAlmostEqual(hold['pnl'],(110/104.2-1)*100-hold['friction']['totalPct'])
        self.assertEqual(hold['lowHighPnl'],hold['pnl'])
        self.assertEqual(hold['strategyVersion'],'opening_hold_to_next_open_v1')

    def test_missing_next_open_is_not_zero_return(self):
        row=signal_row(); row['nextOpen']=None
        hold=r.trades_for_days([dict(date='2026-09-25',universe=[row])],r.Params('hold_to_next_open',exit_policy='next_session_open'))[0]
        self.assertIsNone(hold['pnl'])
        s=r.summary([hold],['2026-09-25'])
        self.assertEqual((s['signals'],s['trades'],s['pending']),(1,0,1))
        self.assertEqual(r.evaluation_trades('hold_to_next_open',[hold]),[])

    def test_filter_wrong_day_and_duplicate_minutes(self):
        x=dict(t='20250930090000',o=1,h=1,l=1,c=1,v=1)
        other=dict(x,t='20251001090000')
        with patch.object(b,'request_json',return_value=dict(bars=[x,x,other])):
            self.assertEqual(b.minute_bars('000001','2025-09-30'),[x])

    def test_archive_checkpoint_is_atomic(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'x.json'
            b.save(path,dict(status='partial'))
            b.save(path,dict(status='complete'))
            self.assertEqual(json.loads(path.read_text())['status'],'complete')
            self.assertFalse(path.with_name('x.json.tmp').exists())

    def test_next_session_does_not_skip_a_suspended_stock(self):
        monday=dict(date='2026-09-28',rows=[dict(code='other',volume=100),dict(code='halted',volume=0)])
        with patch.object(b,'daily_snapshot',return_value=monday) as read:
            self.assertEqual(b.next_session('2026-09-25','2026-09-30')['date'],'2026-09-28')
            read.assert_called_once_with('2026-09-28')


if __name__=='__main__': unittest.main()
