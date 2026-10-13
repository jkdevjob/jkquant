#!/usr/bin/env python3
"""Value tests for hindsight separation, gap execution, halts, and censoring."""
import datetime as dt
import unittest

import numpy as np
import pandas as pd
from analyze_tenbagger import (add_years, annual_cohorts, indicators, net_growth,
                               oracle_window, simulate, summarize)


STOCK={'code':'TEST00','name':'시험','market':'KOSPI','listingDate':'1999-01-01','delistingDate':None}


def frame(n=1700):
    dates=pd.bdate_range('2000-01-03',periods=n).strftime('%Y-%m-%d')
    d=indicators([[x,10.,10.1,9.9,10.,1000.] for x in dates])
    d['trend200']=False; d.loc[300,'trend200']=True
    return d


class Tests(unittest.TestCase):
    def test_signal_cannot_buy_same_bar(self):
        d=frame(); d.loc[300,'open']=1; d.loc[301,'open']=20
        t=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        self.assertEqual(t['buyDate'],d.date.iloc[301]);self.assertEqual(t['buyPrice'],20)

    def test_gap_stop_does_not_pretend_minus12_fill(self):
        d=frame();d.loc[310,'close']=8;d.loc[311,'open']=4
        t=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        self.assertEqual(t['sellDate'],d.date.iloc[311]);self.assertEqual(t['sellPrice'],4)
        self.assertAlmostEqual(t['growth'],4*.995/(10*1.005))
        self.assertLess(t['returnPct'],-60)

    def test_exit_day_close_cannot_change_realized_drawdown(self):
        d=frame();d.loc[310,'close']=8;d.loc[311,'open']=4
        a=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        d.loc[311,'close']=.001
        b=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        self.assertEqual(a['mddPct'],b['mddPct'])

    def test_sell_waits_for_resumption(self):
        d=frame();d.loc[310,'close']=8;d.loc[311:313,'sellable']=False;d.loc[314,'open']=5
        t=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        self.assertEqual(t['sellDate'],d.date.iloc[314]);self.assertEqual(t['sellPrice'],5)

    def test_unbuyable_next_bar_discards_signal(self):
        d=frame();d.loc[301,'buyable']=False
        self.assertEqual(simulate(d,STOCK,'trend200','hold5','2001-01-01','2002-12-31'),[])

    def test_future_does_not_change_indicators(self):
        bars=[[x,10+i*.01,10.2+i*.01,9.8+i*.01,10+i*.01,1000+i] for i,x in enumerate(pd.bdate_range('2000-01-03',periods=500).strftime('%Y-%m-%d'))]
        original=indicators(bars)
        future=bars[:]
        future[400:]=[[r[0],10000,20000,1,15000,10**9] for r in future[400:]]
        mutated=indicators(future)
        pd.testing.assert_frame_equal(original.iloc[:400],mutated.iloc[:400])

    def test_breakout_compares_previous_high_not_its_own_close(self):
        bars=[[x,10+i*.01,10.2+i*.01,9.8+i*.01,10+i*.01,1000.] for i,x in enumerate(pd.bdate_range('2000-01-03',periods=500).strftime('%Y-%m-%d'))]
        d=indicators(bars)
        self.assertAlmostEqual(d.high252.iloc[300],bars[299][4])
        self.assertTrue(d.breakout252_plain.iloc[300])

    def test_future_does_not_change_closed_trade(self):
        d=frame();d.loc[310,'close']=8;d.loc[311,'open']=4
        a=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        d.loc[400:,'close']=100000
        b=simulate(d,STOCK,'trend200','profit100','2001-01-01','2002-12-31')[0]
        for key in ['signalDate','buyDate','sellDate','buyPrice','sellPrice','growth','mddPct']:
            self.assertEqual(a[key],b[key])

    def test_oracle_must_sell_later_and_stay_in_calendar_window(self):
        d=indicators([['2000-01-03',100,101,99,100,10],['2000-01-04',1,1,1,1,10],['2000-01-05',20,20,20,20,10],['2006-01-01',10000,10000,10000,10000,10]])
        r=oracle_window(d)
        self.assertEqual(r['buyDate'],'2000-01-04');self.assertEqual(r['sellDate'],'2000-01-05');self.assertEqual(r['multiple'],20)
        lifetime=oracle_window(d,years=None)
        self.assertEqual(lifetime['multiple'],10000)

    def test_suspension_zero_open_is_never_imputed(self):
        d=indicators([['2000-01-03',0,0,0,10,0]])
        self.assertFalse(d.buyable.iloc[0]);self.assertFalse(d.sellable.iloc[0])

    def test_incomplete_hold_not_realized_win(self):
        d=frame(500);t=simulate(d,STOCK,'trend200','hold5','2001-01-01','2002-12-31')[0]
        self.assertFalse(t['completed']);self.assertFalse(t['benchmarkComplete']);self.assertEqual(summarize([t])['n'],0)

    def test_delisting_stress_is_explicit_and_never_positive(self):
        d=frame(500);s={**STOCK,'delistingDate':d.date.iloc[-1]}
        t=simulate(d,s,'trend200','hold5','2001-01-01','2002-12-31')[0]
        self.assertTrue(t['terminalStress']);self.assertEqual(t['growth'],0);self.assertEqual(t['returnPct'],-100)

    def test_costs_and_calendar_leap_day(self):
        self.assertAlmostEqual(net_growth(100,100),.995/1.005)
        self.assertEqual(add_years('2020-02-29',5),'2025-02-28')

    def test_annual_features_use_previous_bar(self):
        d=frame(1800);base=annual_cohorts(d,STOCK)
        start=next(i for i,x in enumerate(d.date) if x.startswith('2001'))
        d.loc[start,'ma200']=0;d.loc[start,'close']=999999
        other=annual_cohorts(d,STOCK)
        self.assertEqual(base[0]['above200'],other[0]['above200'])
        self.assertEqual(base[0]['momentum50'],other[0]['momentum50'])


if __name__=='__main__':unittest.main(verbosity=2)
