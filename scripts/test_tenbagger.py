#!/usr/bin/env python3
"""Value tests for hindsight separation, gap execution, halts, and censoring."""
import datetime as dt
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from collect_tenbagger import collect_one, universe
from analyze_tenbagger import (add_years, annual_cohorts, indicators, net_growth,
                               oracle_window, simulate, summarize)


STOCK={'code':'TEST00','name':'시험','market':'KOSPI','listingDate':'1999-01-01','delistingDate':None}


def frame(n=1700):
    dates=pd.bdate_range('2000-01-03',periods=n).strftime('%Y-%m-%d')
    d=indicators([[x,10.,10.1,9.9,10.,1000.] for x in dates])
    d['trend200']=False; d.loc[300,'trend200']=True
    return d


class Tests(unittest.TestCase):
    def test_kospi_alias_and_delisting_code_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            html='<table><tr><th>회사명</th><th>시장구분</th><th>종목코드</th><th>업종</th><th>상장일</th></tr><tr><td>상장A</td><td>유가</td><td>000010</td><td>전자</td><td>2000-01-01</td></tr><tr><td>상장B</td><td>코스닥</td><td>000020</td><td>전자</td><td>2000-01-01</td></tr></table>'
            html=html.replace('</table>','<tr><td>상장A</td><td>유가</td><td>000010</td><td>전자</td><td>1999-01-01</td></tr></table>')
            (root/'kind.html').write_bytes(html.encode('euc-kr'))
            pd.DataFrame([{'Symbol':'000010','Name':'옛기업','Market':'KOSPI','Kind':'보통주','SecuGroup':'주권','ListingDate':'1990-01-01','DelistingDate':'2002-01-01','Industry':'전자','Reason':'합병'}, {'Symbol':'000030','Name':'폐지C','Market':'KOSDAQ','Kind':'보통주','SecuGroup':'주권','ListingDate':'1990-01-01','DelistingDate':'2015-01-01','Industry':'전자','Reason':'감사의견'}]).to_csv(root/'delist.csv',index=False)
            (root/'delist-source.json').write_text(json.dumps({'snapshot':'2026-09-17','url':'https://example.com/'}))
            stocks,excluded,_=universe(root,'2025-12-31')
            self.assertEqual([(x['code'],x['market']) for x in stocks],[('000010','KOSPI'),('000020','KOSDAQ'),('000030','KOSDAQ')])
            self.assertEqual(stocks[0]['listingDate'],'1999-01-01')
            self.assertEqual({x['reason'] for x in excluded},{'duplicate_listed_record','listed_code_collision_or_market_transfer'})

    def test_euckr_empty_history_is_missing_not_transport_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/'prices').mkdir()
            raw="[['날짜','시가','고가','저가','종가','거래량']]".encode('euc-kr')
            stock={**STOCK,'sector':'전자','delistingReason':None,'universeSource':'test'}
            with patch('collect_tenbagger.download',return_value=raw):r=collect_one(stock,root,'2025-12-31')
            self.assertIsNone(r['error']);self.assertEqual(r['flags'],['no_price_history']);self.assertEqual(r['bars'],[])

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

    def test_opening_price_limit_does_not_use_later_range(self):
        bars=[['2016-01-04',100,101,99,100,1000],['2016-01-05',130,130,130,130,1000]]
        before=indicators(bars)
        bars[1]=['2016-01-05',130,150,90,100,1000]
        after=indicators(bars)
        self.assertFalse(before.buyable.iloc[1]);self.assertFalse(after.buyable.iloc[1])
        self.assertEqual(before.buyable.iloc[1],after.buyable.iloc[1])
        normal=indicators([bars[0],['2016-01-05',100,105,95,100,1000]])
        later_missing=indicators([bars[0],['2016-01-05',100,0,0,100,0]])
        self.assertEqual(normal.buyable.iloc[1],later_missing.buyable.iloc[1])
        self.assertEqual(normal.sellable.iloc[1],later_missing.sellable.iloc[1])

    def test_old_kosdaq_limit_zone_differs_from_kospi(self):
        bars=[['2004-01-05',100,101,99,100,1000],['2004-01-06',112,114,111,113,1000]]
        self.assertFalse(indicators(bars,'KOSDAQ').buyable.iloc[1])
        self.assertTrue(indicators(bars,'KOSPI').buyable.iloc[1])

    def test_market_calendar_separates_holiday_and_missing_bar(self):
        d=frame()
        signal=d.date.iloc[300];next_day=d.date.iloc[301]
        missing=d.drop(index=301).reset_index(drop=True)
        self.assertEqual(simulate(missing,STOCK,'trend200','hold5','2001-01-01','2002-12-31',calendar={signal:next_day}),[])
        holiday=frame()
        holiday.loc[301:,'date']=[(dt.date.fromisoformat(x)+dt.timedelta(days=10)).isoformat() for x in holiday.date.iloc[301:]]
        allowed=simulate(holiday,STOCK,'trend200','hold5','2001-01-01','2002-12-31',calendar={signal:holiday.date.iloc[301]})
        self.assertEqual(len(allowed),1)

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

    def test_training_cutoff_cannot_know_future_sale_or_delisting(self):
        d=frame();cutoff=d.date.iloc[450]
        stock={**STOCK,'delistingDate':'2016-01-01'}
        t=simulate(d,stock,'trend200','hold5','2001-01-01','2002-12-31',asof=cutoff)[0]
        self.assertLessEqual(t['sellDate'],cutoff)
        self.assertFalse(t['completed']);self.assertFalse(t['terminalStress'])
        short=simulate(d.iloc[:500].copy(),stock,'trend200','hold5','2001-01-01','2002-12-31',asof=cutoff)[0]
        self.assertEqual(t,short)

    def test_forward_cohort_peak_cannot_include_price_after_deadline(self):
        d=frame(2100)
        d=d.loc[~d.date.between('2006-01-01','2006-02-01')].reset_index(drop=True)
        after=np.flatnonzero(d.date.to_numpy()>'2006-02-01')[0]
        d.loc[after,'close']=10000
        row=next(x for x in annual_cohorts(d,STOCK) if x['year']==2001)
        self.assertEqual(row['peak5'],1)
        self.assertEqual(row['end5'],1)

    def test_annual_features_use_previous_bar(self):
        d=frame(1800);base=annual_cohorts(d,STOCK)
        start=next(i for i,x in enumerate(d.date) if x.startswith('2001'))
        d.loc[start,'ma200']=0;d.loc[start,'close']=999999
        other=annual_cohorts(d,STOCK)
        self.assertEqual(base[0]['above200'],other[0]['above200'])
        self.assertEqual(base[0]['momentum50'],other[0]['momentum50'])


if __name__=='__main__':unittest.main(verbosity=2)
