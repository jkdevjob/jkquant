import unittest
import copy
import backtest_opening_rebreak as engine
from test_opening_backfill import signal_row
from opening_basis_cost import cost_range, overnight_basis_status


class BasisCostTests(unittest.TestCase):
    def adjusted_fixture(self):
        row = signal_row()
        for b in row['bars']:
            for k in ('o', 'h', 'l', 'c'):
                b[k] *= 10
        fields = ('stck_oprc', 'stck_hgpr', 'stck_lwpr', 'stck_clpr')
        row['priceBasisReference'] = dict(originalGapPct=(103/100-1)*100,
            adjusted={'stck_oprc':'1030'}, originalFile='original.json', adjustedFile='adjusted.json',
            originalPriceFactorBounds=dict(status='bounded_rounding_hypothesis',lower=10,upper=10),
            nextMarketSession=dict(date='20260928', status='reference_available_not_execution_validated',
                original=dict.fromkeys(fields,'110'), adjusted=dict.fromkeys(fields,'1100')))
        return row

    def test_engine_preserves_gap_inputs_and_same_entry_hold(self):
        row = self.adjusted_fixture()
        before = copy.deepcopy(row)
        days = [dict(date='2026-09-25', universe=[row])]
        b = engine.trades_for_days(days, engine.Params('baseline'))[0]
        h = engine.trades_for_days(days, engine.Params('hold',exit_policy='next_session_open'))[0]
        self.assertAlmostEqual(b['gap'],3)
        self.assertEqual(b['entryPrice'],1042)
        self.assertEqual((b['entryTime'],b['entryPrice']),(h['entryTime'],h['entryPrice']))
        self.assertEqual(h['exitPrice'],1100)
        self.assertAlmostEqual(h['pnl'],(1100/1042-1)*100-h['friction']['totalPct'])
        self.assertEqual(row,before)
        self.assertEqual(b['strategyVersion'],'opening_rebreak_basis_v2')
        self.assertEqual(b['friction']['totalPct'],b['friction']['originalPriceCostBounds']['totalCostPctMax'])

    def test_adjusted_day_open_controls_intraday_rise(self):
        row = self.adjusted_fixture()
        row['priceBasisReference']['adjusted']['stck_oprc'] = '1039'
        self.assertIsNone(engine.one_trade(dict(date='2026-09-25'),row,engine.Params('baseline')))

    def test_engine_refuses_changed_gap(self):
        row = self.adjusted_fixture()
        row['priceBasisReference']['originalGapPct'] = 4
        with self.assertRaises(ValueError):
            engine.one_trade(dict(date='2026-09-25'),row,engine.Params('baseline'))

    def test_engine_preserves_pending_and_legacy_corporate_action_guard(self):
        row = self.adjusted_fixture()
        row['nextOpenStatus'] = 'corporate_action_review'
        h = engine.trades_for_days([dict(date='2026-09-25',universe=[row])],engine.Params('hold',exit_policy='next_session_open'))[0]
        self.assertIsNone(h['pnl'])
        self.assertEqual(h['outcomeStatus'],'pending_next_open')

    def test_identity_preserves_existing_cost(self):
        x = cost_range(168600, dict(status='identical_ohlc'))
        self.assertAlmostEqual(x['totalCostPctMax'], .23 + 500/168600*100)

    def test_cost_parameters_come_from_engine_configuration(self):
        x = cost_range(10000, dict(status='identical_ohlc'),fixed_pct=.5,ticks_per_side=1)
        self.assertAlmostEqual(x['totalCostPctMax'],.7)

    def test_tenfold_adjustment_uses_original_cost_band(self):
        x = cost_range(25350, dict(status='bounded_rounding_hypothesis', lower=9.9996, upper=10.0004))
        expected = .23 + 25/2535*100
        self.assertLess(x['totalCostPctMin'], expected)
        self.assertGreater(x['totalCostPctMax'], expected)
        self.assertLess(x['totalCostPctMax']-x['totalCostPctMin'], .001)

    def test_tick_boundary_retains_both_cost_bands(self):
        x = cost_range(2000, dict(status='bounded_rounding_hypothesis', lower=.9999, upper=1.0001))
        self.assertLess(x['totalCostPctMin'], .49)
        self.assertGreater(x['totalCostPctMax'], 1.47)

    def test_execution_price_need_not_be_on_quote_grid(self):
        x = cost_range(194684, dict(status='bounded_rounding_hypothesis', lower=.9531613226452906, upper=.9531670702179177))
        self.assertLess(x['originalEntryMin'], 204250)
        self.assertGreater(x['originalEntryMax'], 204250)

    def test_invalid_factor_is_not_silently_skipped(self):
        with self.assertRaises(ValueError):
            cost_range(100, dict(status='bounded_rounding_hypothesis', lower=0, upper=1))

    def test_overnight_adjustment_change_stays_pending(self):
        fields = ('stck_oprc', 'stck_hgpr', 'stck_lwpr', 'stck_clpr')
        x = dict(originalPriceFactorBounds=dict(lower=1, upper=1), nextMarketSession=dict(
            status='reference_available_not_execution_validated',
            original=dict.fromkeys(fields, '10000'), adjusted=dict.fromkeys(fields, '1000')))
        self.assertEqual(overnight_basis_status(x), 'corporate_action_basis_change_pending')
        x['nextMarketSession']['adjusted'] = dict.fromkeys(fields, '10000')
        self.assertEqual(overnight_basis_status(x), 'same_basis_reference_available')


if __name__ == '__main__':
    unittest.main()
