#!/usr/bin/env python3
"""Synthetic unit probes only; no synthetic investment performance reported."""
import copy
import datetime as dt
import unittest

import pandas as pd

import tenbagger_forward as engine

NOW = dt.datetime.fromisoformat('2026-10-13T10:30:00+00:00')
SOURCE = {'combinedSha256': 'test-input-only'}


def frame(prices, dates=None, code='000010'):
    dates = dates or [f'2026-10-{i+13:02}' for i in range(len(prices))]
    last = prices[0]
    rows = []
    for day, close in zip(dates, prices):
        rows.append(dict(Date=day, Code=code, Name='시험종목', Market='KOSPI', Dept='',
            Open=close, High=close, Low=close, Close=close, Volume=1000,
            Amount=2e9, Changes=close-last, Stocks=100000, Marcap=close*100000))
        last = close
    return pd.DataFrame(rows)


def candidate(code='000010', date='2026-10-13'):
    return dict(code=code, name='시험종목', market='KOSPI', pattern='pullback50',
                signalDate=date, signalClose=100, features={})


class ForwardTests(unittest.TestCase):
    def test_cutoff_before_publication(self):
        self.assertEqual(engine.completed_cutoff(dt.datetime.fromisoformat('2026-10-13T15:29:00+09:00')), '2026-10-12')
        self.assertEqual(engine.completed_cutoff(NOW), '2026-10-13')

    def test_registration_not_retroactive(self):
        d = frame([100, 110, 120], ['2026-10-08', '2026-10-12', '2026-10-13'])
        s, n = engine.evolve(None, d, [candidate(date='2026-10-08')], NOW, SOURCE)
        self.assertEqual(n, 1)
        self.assertIsNone(s['records'][0]['entryDate'])
        s, _ = engine.evolve(s, frame([100, 110, 120, 130], ['2026-10-08', '2026-10-12', '2026-10-13', '2026-10-14']), [], NOW, SOURCE)
        self.assertEqual(s['records'][0]['entryDate'], '2026-10-14')
        self.assertEqual(s['records'][0]['observations'][0]['growth'], 1)

    def test_all_initial_candidates_and_no_duplicates(self):
        d = pd.concat([frame([100]), frame([200], code='000020')])
        cs = [candidate(date='2026-10-08'), candidate('000020', '2026-10-08')]
        s, n = engine.evolve(None, d, cs, NOW, SOURCE)
        self.assertEqual(n, 2)
        same, n = engine.evolve(s, d, cs, NOW, SOURCE)
        self.assertEqual(n, 0); self.assertEqual(len(same['records']), 2)

    def test_locked_rule_mismatch_blocks(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        s['rulesSha256'] = 'changed'
        with self.assertRaisesRegex(ValueError, 'locked rules'): engine.evolve(s, frame([100]), [], NOW, SOURCE)

    def test_next_close_exit_and_gap_loss(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        d = frame([100, 100, 87, 70])
        s, _ = engine.evolve(s, d, [], NOW, SOURCE)
        r = s['records'][0]; a = r['arms']['stop12_trail35']
        self.assertEqual(a['exitSignalDate'], '2026-10-15')
        self.assertEqual(a['exitDate'], '2026-10-16')
        self.assertAlmostEqual(a['netReturnPct'], (0.7 * .995 / 1.005 - 1) * 100)
        self.assertLess(a['netReturnPct'], -12)
        self.assertEqual(r['arms']['hold1260']['status'], 'open')

    def test_halt_waits_for_exit_without_fabricated_fill(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        d = frame([100, 100, 87, 87, 70])
        d.loc[3, 'Volume'] = 0; d.loc[3, ['Open', 'High', 'Low']] = 0
        s, _ = engine.evolve(s, d, [], NOW, SOURCE)
        self.assertEqual(s['records'][0]['arms']['stop12_trail35']['exitDate'], '2026-10-17')

    def test_trailing_exit_is_not_fixed_profit_target(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        s, _ = engine.evolve(s, frame([100, 100, 180, 110, 100]), [], NOW, SOURCE)
        a = s['records'][0]['arms']['stop12_trail35']
        self.assertEqual(a['exitReason'], 'close_trail35')
        self.assertEqual(a['exitSignalDate'], '2026-10-16')
        self.assertEqual(a['exitDate'], '2026-10-17')

    def test_pending_halt_is_not_an_entry(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        d = frame([100, 100, 110]); d.loc[1, 'Volume'] = 0
        s, _ = engine.evolve(s, d, [], NOW, SOURCE)
        self.assertEqual(s['records'][0]['entryDate'], '2026-10-15')

    def test_revisions_do_not_rewrite_old_observations(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        d = frame([100, 100, 110]); s, _ = engine.evolve(s, d, [], NOW, SOURCE)
        old = copy.deepcopy(s['records'][0]['observations'])
        d.loc[1, 'Close'] = 50
        revised, _ = engine.evolve(s, d, [], NOW, SOURCE)
        self.assertEqual(revised['records'][0]['observations'], old)
        self.assertIn('2026-10-14', revised['records'][0]['revisionDates'])

    def test_missing_or_delisted_record_preserved(self):
        s, _ = engine.evolve(None, frame([100]), [candidate()], NOW, SOURCE)
        other = frame([100, 101], code='000020')
        s, _ = engine.evolve(s, other, [], NOW, SOURCE)
        self.assertEqual(len(s['records']), 1)
        self.assertEqual(s['records'][0]['dataStatus'], 'missing_or_delisted_settlement_unknown')
        self.assertIsNone(s['records'][0]['netMarkPct'])

    def test_future_prices_removed_before_scan(self):
        days = pd.bdate_range(end='2026-10-13', periods=280).strftime('%Y-%m-%d').tolist()
        d = frame([100] * 279 + [200], days)
        clipped = engine.prepare(d, '2026-10-12')
        self.assertEqual(clipped.Date.max(), '2026-10-12')
        _, c, _ = engine.scan(clipped)
        self.assertEqual(c, [])

    def test_prior_volume_not_current_average_and_liquidity(self):
        days = pd.bdate_range(end='2026-10-13', periods=280).strftime('%Y-%m-%d').tolist()
        prices = [100 + i * .1 for i in range(279)] + [130]
        d = frame(prices, days); d.loc[279, 'Volume'] = 1500
        _, c, _ = engine.scan(engine.prepare(d, '2026-10-13'))
        hit = next(x for x in c if x['pattern'] == 'breakout252')
        self.assertEqual(hit['features']['volumeRatio'], 1.5)
        d.loc[:278, 'Amount'] = 0; d.loc[279, 'Amount'] = 1e14
        _, c, _ = engine.scan(engine.prepare(d, '2026-10-13'))
        self.assertEqual(c, [], 'current huge amount cannot improve prior liquidity')

    def test_duplicate_dates_and_backwards_input_fail(self):
        d = frame([100])
        with self.assertRaises(ValueError): engine.prepare(pd.concat([d, d]), '2026-10-13')
        s, _ = engine.evolve(None, d, [], NOW, SOURCE)
        with self.assertRaises(ValueError): engine.evolve(s, frame([99], ['2026-10-12']), [], NOW, SOURCE)

    def test_former_spac_history_not_company_warmup(self):
        days = pd.bdate_range(end='2026-10-13', periods=280).strftime('%Y-%m-%d').tolist()
        d = frame([100 + i * .1 for i in range(280)], days)
        d.loc[30:50, 'Name'] = '합병전 스팩'
        _, c, coverage = engine.scan(engine.prepare(d, '2026-10-13'))
        self.assertEqual(c, [])
        self.assertEqual(coverage['excluded'].get('prior_spac_or_fund_history'), 1)


if __name__ == '__main__':
    import io
    import pathlib
    import types
    source = pathlib.Path(engine.__file__).read_text()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(ForwardTests)
    result = unittest.TextTestRunner(verbosity=1).run(suite)
    if not result.wasSuccessful(): raise SystemExit(1)
    control = engine
    changes = [
        ('publication cutoff', 'local.hour >= 18', 'local.hour >= 0'),
        ('retroactive entry', "start = max(record['registeredDate'], record['signalDate'])", "start = record['signalDate']"),
        ('future input', 'd.Date <= cutoff', 'd.Date <= "9999-12-31"'),
        ('rules unlocked', "if state['strategyVersion'] != VERSION or state['rulesSha256'] != rules_hash or digest(state['rules']) != rules_hash:", 'if False:'),
        ('current liquidity leak', 'g.Amount.iloc[-21:-1]', 'g.Amount.iloc[-20:]'),
        ('instant stop fill', "arm['exitSignalDate'] = day; arm['exitReason'] = 'close_stop12'", "arm.update(status='closed', exitDate=day, exitSignalDate=day); arm['exitReason'] = 'close_stop12'"),
        ('trail threshold', 'growth / arm[\'highGrowth\'] <= .65', 'growth / arm[\'highGrowth\'] <= .35'),
        ('revised observation overwrite', "record['revisionDates'] = sorted(set(record.get('revisionDates', []) + revised))", "record['revisionDates'] = sorted(set(record.get('revisionDates', []) + revised))\n        for o in obs:\n            if o['date'] in rows: o['rawClose'] = float(rows[o['date']].Close)"),
    ]
    for name, old, new in changes:
        if old not in source: raise AssertionError('mutation target absent: ' + name)
        mutant = types.ModuleType('mutant')
        exec(compile(source.replace(old, new), '<mutation>', 'exec'), mutant.__dict__)
        engine = mutant
        r = unittest.TextTestRunner(stream=io.StringIO()).run(unittest.defaultTestLoader.loadTestsFromTestCase(ForwardTests))
        if r.errors or not r.failures: raise AssertionError('mutation not caught by value assertion: ' + name)
        print('PASS mutation:', name)
    engine = control
    print('ALL PASS forward value tests and 8 mutations')
