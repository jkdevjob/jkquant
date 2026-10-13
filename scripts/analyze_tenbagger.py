#!/usr/bin/env python3
"""Reproducible retrospective research, never a production trading engine.

Annual cohorts measure forward 1/3/5-calendar-year price outcomes. Trading
experiments use only completed signal bars and the next available executable
open, including gap losses. Train entries 2001-2010 finish before 2016 test
entries (2016-2020). Five-year test follow-up ends by 2025. Stock clustering,
missing delistings and retrospectively adjusted prices limit inference.
"""
import argparse
from collections import Counter, deque
import datetime as dt
import gzip
import hashlib
import json
import math
import pathlib

import numpy as np
import pandas as pd

VERSION = '1.0.0'
ENTRIES = {
    'trend200': '상승하는 200일선 회복',
    'breakout252': '252일 종가 신고가 + 거래량 1.5배',
    'breakout252_plain': '252일 종가 신고가',
    'pullback50': '상승 추세의 50일선 재돌파',
}
EXITS = {
    'hold5': '5년 보유',
    'profit100': '+100% 익절 / -12% 종가 손절',
    'ma50': '50일선 2일 이탈 / -12% 종가 손절',
    'ma200': '200일선 5일 이탈 / -12% 종가 손절',
    'trail25': '종가 고점 대비 -25% / -12% 종가 손절',
    'trail35': '종가 고점 대비 -35% / -12% 종가 손절',
}


def add_years(date, years):
    d = dt.date.fromisoformat(date)
    try: return d.replace(year=d.year + years).isoformat()
    except ValueError: return d.replace(year=d.year + years, day=28).isoformat()


def finite(x):
    return float(x) if x is not None and np.isfinite(x) else None


def indicators(bars, market='KOSPI'):
    d = pd.DataFrame(bars, columns=['date', 'open', 'high', 'low', 'close', 'volume'])
    c, v = d.close, d.volume
    d['ma50'] = c.rolling(50).mean()
    d['ma200'] = c.rolling(200).mean()
    d['slope200'] = d.ma200 / d.ma200.shift(20) - 1
    d['high252'] = c.rolling(252).max().shift(1)
    d['range60'] = c.rolling(60).max() / c.rolling(60).min() - 1
    d['volumeRatio'] = v / v.rolling(20).mean().shift(1)
    for n in (63, 126, 252): d['ret' + str(n)] = c / c.shift(n) - 1
    change = c.diff()
    gain = change.clip(lower=0).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    loss = (-change.clip(upper=0)).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    d['rsi14'] = (100 - 100/(1 + gain/loss)).where(loss > 0, 100).where((gain+loss)>0, 50)
    d['distanceHigh'] = c / d.high252 - 1
    trend = (c > d.ma200) & (d.slope200 > 0)
    d['trend200'] = trend & (c.shift(1) <= d.ma200.shift(1))
    d['breakout252_plain'] = trend & (c > d.high252)
    d['breakout252'] = d.breakout252_plain & (d.volumeRatio >= 1.5)
    d['pullback50'] = trend & (c > d.ma50) & (c.shift(1) <= d.ma50.shift(1)) & d.distanceHigh.between(-.30, -.05)
    d['below50'] = (c < d.ma50).astype(int).rolling(2).sum() == 2
    d['below200'] = (c < d.ma200).astype(int).rolling(5).sum() == 5
    # Zero OHLC/volume denotes a halt. Never replace it by a close for execution.
    d['tradable'] = (d.open > 0) & (d.high > 0) & (d.low > 0) & (v > 0)
    opening_gap = d.open / c.shift(1) - 1
    lim = np.where(d.date < '2015-06-15', .14, .29)
    if market == 'KOSDAQ': lim = np.where(d.date < '2005-03-28', .11, lim)
    # A full day's high/low cannot decide an order placed at its opening.
    # Conservatively reject opening prices within ~1%p of the price-limit zone;
    # queue position is unavailable in daily OHLCV. Never use the later close.
    d['buyable'] = (d.open > 0) & ~(opening_gap > lim)
    d['sellable'] = (d.open > 0) & ~(opening_gap < -lim)
    return d


def oracle_window(d, years=5):
    """Largest later close / earlier close, with exact calendar horizon, O(n)."""
    q, best = deque(), None
    dates, c, ok = d.date.to_numpy(), d.close.to_numpy(), d.tradable.to_numpy()
    for j in range(len(d)):
        while years is not None and q and add_years(str(dates[q[0]]), years) < dates[j]: q.popleft()
        if not ok[j]: continue
        if q:
            i = q[0]; ratio = c[j] / c[i]
            if best is None or ratio > best['multiple']:
                best = {'buyIndex': int(i), 'sellIndex': int(j), 'buyDate': str(dates[i]), 'sellDate': str(dates[j]),
                        'buyClose': float(c[i]), 'sellClose': float(c[j]), 'multiple': float(ratio)}
        while q and c[q[-1]] >= c[j]: q.pop()
        q.append(j)
    return best


def net_growth(buy, sell, cost=.005):
    return sell * (1 - cost) / (buy * (1 + cost))


def simulate(d, stock, entry, exit_rule, start, entry_end, cost=.005, calendar=None, asof='2025-12-31'):
    # A training result cannot know a later resumption or delisting settlement.
    if len(d) and d.date.iloc[-1] > asof:
        d = d.loc[d.date <= asof].reset_index(drop=True)
    if not len(d): return []
    dates = d.date.to_numpy(); c = d.close.to_numpy(); o = d.open.to_numpy()
    sig = d[entry].fillna(False).to_numpy()
    buyable, sellable = d.buyable.to_numpy(), d.sellable.to_numpy()
    below50, below200 = d.below50.to_numpy(), d.below200.to_numpy()
    candidates = np.flatnonzero(sig & (dates >= start) & (dates <= entry_end))
    sell_days = np.flatnonzero(sellable)
    trades, next_i = [], 0
    for i in candidates:
        if i < next_i or i + 1 >= len(d): continue
        if not buyable[i + 1] or dates[i+1] > entry_end: continue
        b = int(i + 1)
        # A missing run of dates can hide the real next trading day. Do not infer an entry.
        if calendar is not None:
            if calendar.get(str(dates[i])) != dates[b]: continue
        elif (dt.date.fromisoformat(dates[b]) - dt.date.fromisoformat(dates[i])).days > 7: continue
        due = add_years(str(dates[b]), 5)
        deadline = int(np.searchsorted(dates, due))
        end = min(len(d), deadline)
        segment = c[b:end]
        hits, reason = np.array([], dtype=int), None
        if exit_rule != 'hold5' and len(segment):
            stop = segment <= o[b] * .88
            condition = np.zeros(len(segment), dtype=bool)
            if exit_rule == 'profit100': condition = segment >= o[b] * 2
            elif exit_rule == 'ma50': condition = below50[b:end]
            elif exit_rule == 'ma200': condition = below200[b:end]
            elif exit_rule.startswith('trail'):
                peak = np.maximum.accumulate(np.maximum(segment, o[b]))
                condition = segment <= peak * (1 - int(exit_rule[5:]) / 100)
            hits = np.flatnonzero(stop | condition)
            if len(hits): reason = '종가 손절 신호' if stop[hits[0]] else EXITS[exit_rule]
        if len(hits):
            earliest = b + int(hits[0]) + 1  # exit signal close cannot fill at its own open
        else:
            earliest, reason = deadline, '5년 보유기한'
        sell_pos = int(np.searchsorted(sell_days, earliest))
        sell_i = int(sell_days[sell_pos]) if sell_pos < len(sell_days) else None
        exit_reason = reason
        terminal = stock.get('delistingDate') and stock['delistingDate'] <= asof
        if sell_i is None:
            s = len(d) - 1
            if terminal:
                sell_price, reason, completed = 0., '상장폐지 정산 미확인: 전액손실 스트레스', True
            else:
                sell_price, reason, completed = float(c[s]), '관측 종료 / 미청산 평가', False
        else:
            s, sell_price, reason, completed = sell_i, float(o[sell_i]), exit_reason, True
        grow = net_growth(float(o[b]), sell_price, cost)
        held_closes = c[b:s] if completed and not (sell_i is None) else c[b:s+1]
        equity = np.r_[1., held_closes / (o[b] * (1 + cost)), grow]
        dd = float(np.min(equity / np.maximum.accumulate(equity) - 1))
        horizon = min(len(d) - 1, int(np.searchsorted(dates, due)))
        benchmark_complete = dates[-1] >= due or bool(terminal)
        if dates[-1] < due and terminal:
            bh_price = 0.
        else:
            # Deadline may itself be a halt; wait for the first executable sell open.
            k = horizon
            while k < len(d) and not sellable[k]: k += 1
            bh_price = float(o[k]) if k < len(d) else float(c[-1])
            if k >= len(d): benchmark_complete = False
        bh = net_growth(float(o[b]), bh_price, cost)
        peak_end = min(len(d), int(np.searchsorted(dates, due, side='right')))
        forward_peak = float(np.max(c[b:peak_end]) / o[b])
        trades.append({'code': stock['code'], 'name': stock['name'], 'market': stock['market'],
                       'signalDate': str(dates[i]), 'buyDate': str(dates[b]), 'sellDate': str(dates[s]),
                       'buyPrice': float(o[b]), 'sellPrice': sell_price, 'growth': grow,
                       'returnPct': (grow - 1) * 100, 'mddPct': dd * 100,
                       'holdingDays': (dt.date.fromisoformat(dates[s]) - dt.date.fromisoformat(dates[b])).days,
                       'reason': reason, 'completed': completed, 'terminalStress': sell_i is None and bool(terminal),
                       'benchmarkGrowth': bh, 'benchmarkComplete': benchmark_complete, 'forwardPeak': forward_peak})
        if not completed: break
        next_i = s + 1  # no overlapping positions, nor same-bar re-entry
    return trades


def summarize(trades):
    a = [t for t in trades if t['completed'] and t['benchmarkComplete']]
    if not a: return {'n': 0, 'stocks': 0}
    g = np.array([t['growth'] for t in a]); bh = np.array([t['benchmarkGrowth'] for t in a])
    return {'n': len(a), 'stocks': len({t['code'] for t in a}), 'winPct': float(np.mean(g > 1) * 100),
            'medianReturnPct': float((np.median(g) - 1) * 100), 'meanReturnPct': float((np.mean(g) - 1) * 100),
            'meanLogGrowth': float(np.mean(np.log(np.maximum(g, 1e-6)))),
            'p10ReturnPct': float((np.quantile(g, .1) - 1) * 100), 'worstReturnPct': float((np.min(g) - 1) * 100),
            'medianMddPct': float(np.median([t['mddPct'] for t in a])), 'worstMddPct': float(min(t['mddPct'] for t in a)),
            'medianHoldingDays': float(np.median([t['holdingDays'] for t in a])),
            'tenbaggerPct': float(np.mean(g >= 10) * 100),
            'matchedHoldMedianReturnPct': float((np.median(bh) - 1) * 100),
            'beatMatchedHoldPct': float(np.mean(g > bh) * 100),
            'medianExcessPct': float(np.median((g - bh) * 100)),
            'terminalStressN': sum(t['terminalStress'] for t in a),
            'incompleteN': len(trades) - len(a)}


def annual_cohorts(d, stock):
    dates = d.date.to_numpy(); out = []
    for year in range(2001, 2021):
        i = int(np.searchsorted(dates, f'{year}-01-01'))
        if i < 253 or i >= len(d) or dates[i] > f'{year}-01-15' or not d.buyable.iloc[i]: continue
        prev = d.iloc[i - 1]
        row = {'code': stock['code'], 'market': stock['market'], 'year': year, 'date': str(dates[i]),
               'above200': bool(prev.close > prev.ma200), 'rising200': bool(prev.slope200 > 0),
               'nearHigh': bool(prev.distanceHigh >= -.20), 'ret63positive': bool(prev.ret63 > 0),
               'momentum50': bool(prev.ret252 >= .50), 'tight60': bool(prev.range60 <= .35),
               'trendConfirmed': bool(prev.close > prev.ma200 and prev.slope200 > 0),
               'deepDrawdown': bool(prev.distanceHigh <= -.50), 'rsiLow': bool(prev.rsi14 <= 30),
               'rsiStrong': bool(prev.rsi14 >= 55),
               'volume15': bool(prev.volumeRatio >= 1.5), 'return126': finite(prev.ret126),
               'listedAgeYears': (dt.date.fromisoformat(dates[i]) - dt.date.fromisoformat(stock['listingDate'])).days / 365.25}
        for h in (1, 3, 5):
            due = add_years(str(dates[i]), h)
            j = min(len(d)-1, int(np.searchsorted(dates, due, side='right'))-1)
            terminal = bool(stock['delistingDate'] and stock['delistingDate'] <= due and stock['delistingDate'] <= '2025-12-31')
            stale = (dt.date.fromisoformat(due)-dt.date.fromisoformat(dates[j])).days > 31
            complete = (dates[-1] >= due and not stale) or terminal
            peak = float(d.close.iloc[i:j+1].max() / d.open.iloc[i])
            endpoint = 0. if terminal else float(d.close.iloc[j] / d.open.iloc[i])
            row[f'peak{h}'] = peak if complete else None
            row[f'end{h}'] = endpoint if complete else None
        if row['peak5'] is not None: out.append(row)
    return out


def probability(rows, condition=None):
    a = [x for x in rows if condition is None or x[condition]]
    if not a: return {'n': 0, 'successN': 0, 'ratePct': None}
    by = {}
    for x in a:
        p = by.setdefault(x['code'], [0, 0]); p[0] += 1; p[1] += x['peak5'] >= 10
    counts = np.array(list(by.values()), dtype=float)
    rng = np.random.default_rng(20261013)
    rates = []
    for _ in range(200):
        z = counts[rng.integers(0, len(counts), len(counts))].sum(axis=0)
        rates.append(z[1] / z[0] * 100)
    return {'n': len(a), 'stocks': len(by), 'successN': sum(x['peak5'] >= 10 for x in a),
            'ratePct': sum(x['peak5'] >= 10 for x in a)/len(a)*100,
            'stockCluster95': [float(np.quantile(rates, .025)), float(np.quantile(rates, .975))]}


def main():
    p = argparse.ArgumentParser(); p.add_argument('--cache', default='/tmp/tenbagger-inputs-20261013')
    p.add_argument('--out', default='data/tenbagger/gpt'); a = p.parse_args()
    cache, dest = pathlib.Path(a.cache), pathlib.Path(a.out); dest.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((cache/'manifest.json').read_text())
    # Trading dates are observed in three long-listed KRX benchmark histories.
    # This separates a missing stock bar from a genuine multi-day market holiday.
    calendar_dates = set()
    for code in ['000660','005930','035420']:
        fp = cache/'normalized'/(code+'.json.gz')
        if fp.exists():
            data = json.loads(gzip.decompress(fp.read_bytes()))
            calendar_dates.update(b[0] for b in data['bars'] if b[1]>0 and b[5]>0)
    dates = sorted(calendar_dates)
    calendar = dict(zip(dates[:-1],dates[1:])) if len(dates)>=5000 else None
    rows, cases, cohorts = [], [], []
    trades = {f'{e}__{x}': {'train': [], 'test': []} for e in ENTRIES for x in EXITS}
    quality = Counter(); stock_results = []
    for idx, sm in enumerate(manifest['stocks']):
        s = json.loads(gzip.decompress((cache/'normalized'/(sm['code']+'.json.gz')).read_bytes()))
        if s['flags']:
            quality.update(s['flags']); continue
        d = indicators(s['bars'], s['market']); oracle = oracle_window(d, years=None); fast = oracle_window(d)
        cohorts.extend(annual_cohorts(d, s))
        stock_results.append({k: s[k] for k in ['code','name','market','sector','listingDate','delistingDate','inputSha256']} | {'bars': len(d), 'oracleMultiple': oracle['multiple'] if oracle else None})
        if oracle and oracle['multiple'] >= 10:
            i, j = oracle['buyIndex'], oracle['sellIndex']; prefix = d.iloc[i:j+1]
            two = prefix[prefix.close >= oracle['buyClose']*2]
            ten = prefix[prefix.close >= oracle['buyClose']*10]
            sequence = d.close.iloc[i:j+1].to_numpy()/oracle['buyClose']
            case = {k: s[k] for k in ['code','name','market','sector','listingDate','delistingDate']} | oracle
            case['fastFiveYear'] = fast
            case['riseMddPct'] = float(np.min(sequence / np.maximum.accumulate(sequence)-1)*100)
            case['first2xDate'] = str(two.date.iloc[0]) if len(two) else None
            case['first10xDate'] = str(ten.date.iloc[0]) if len(ten) else None
            case['featuresAt2x'] = {k: finite(two.iloc[0][k]) if len(two) else None for k in ['ret63','ret126','slope200','volumeRatio','distanceHigh','range60','rsi14']}
            case['endpointMultiple'] = float(d.close.iloc[-1]/oracle['buyClose'])
            case['postPeakDrawdownPct'] = float((d.close.iloc[j:].min()/oracle['sellClose']-1)*100)
            case['executions'] = []
            # Illustrative matching is hindsight-selected; excluded from strategy selection.
            if case['code'] in {'086520','247540','091990','128940','028300','058470','035420','035720','042700','214370','042670','196170','145020','005930','000660','039030','009540','003490','096770','006400','003230','267260','298040','012450','041510'}:
                start = str(d.date.iloc[max(253,i-252)])
                for e in ENTRIES:
                    for x in ['hold5','profit100','ma200','trail25','trail35']:
                        tt = simulate(d, s, e, x, start, oracle['sellDate'], calendar=calendar)
                        matching = [t for t in tt if t['buyDate'] <= oracle['sellDate'] and t['sellDate'] >= oracle['buyDate']]
                        if matching:
                            t = max(matching, key=lambda t: t['growth'])
                            case['executions'].append({'rule': f'{e}__{x}', **t})
            monthly = d.groupby(d.date.str[:7],sort=True).tail(1)
            exact = d[d.date.isin([case['buyDate'],case['sellDate'],case['first2xDate'],case['first10xDate']])]
            points = pd.concat([monthly,exact]).drop_duplicates('date').sort_values('date')
            case['chart'] = [[str(r.date),float(r.close)] for _,r in points.iterrows()]
            cases.append(case)
        train_data = d.loc[d.date <= '2015-12-31'].reset_index(drop=True)
        for e in ENTRIES:
            for x in EXITS:
                key = f'{e}__{x}'
                trades[key]['train'].extend(simulate(train_data, s, e, x, '2001-01-01', '2010-12-31', calendar=calendar, asof='2015-12-31'))
                trades[key]['test'].extend(simulate(d, s, e, x, '2016-01-01', '2020-12-31', calendar=calendar))
        if (idx+1)%100 == 0: print(f'Analyzed {idx+1}/{len(manifest["stocks"])} | tenbaggers {len(cases)}',flush=True)
    strategies = []
    for key, phases in trades.items():
        e,x=key.split('__')
        result={'id':key,'entry':ENTRIES[e],'exit':EXITS[x], 'train':summarize(phases['train']), 'test':summarize(phases['test']),
                'testByMarket':{m:summarize([t for t in phases['test'] if t['market']==m]) for m in ['KOSPI','KOSDAQ']},
                'testWithoutTerminalStress':summarize([t for t in phases['test'] if not t['terminalStress']])}
        eligible=[t for t in phases['test'] if t['completed'] and t['benchmarkComplete']]
        result['costSensitivity']=[{'oneWayPct':fee*100,'testMedianReturnPct':float(np.median([net_growth(t['buyPrice'],t['sellPrice'],fee)-1 for t in eligible])*100) if eligible else None} for fee in [.001,.005,.01]]
        strategies.append(result)
    eligible_rules=[r for r in strategies if r['train']['n']>=100]
    chosen=max(eligible_rules,key=lambda r:r['train']['meanLogGrowth'])['id'] if eligible_rules else None
    for r in strategies:r['selectedOnTrain']=r['id']==chosen
    features=[]
    for key,label in [('above200','전일 종가 > 200일선'),('rising200','200일선이 20일 전보다 상승'),('trendConfirmed','종가 > 200일선 + 200일선 상승'),('nearHigh','252일 종가 고점과 거리 20% 이내'),('deepDrawdown','252일 종가 고점보다 50% 이상 하락'),('ret63positive','직전 63일 수익률 양수'),('momentum50','직전 252일 +50% 이상'),('tight60','직전 60일 종가 범위 35% 이하'),('volume15','전일 거래량 / 직전 20일 평균 ≥ 1.5'),('rsiLow','전일 RSI(14) ≤ 30'),('rsiStrong','전일 RSI(14) ≥ 55')]:
        features.append({'id':key,'label':label,'train':probability([z for z in cohorts if z['year']<=2010],key),
                         'test':probability([z for z in cohorts if 2016<=z['year']<=2020],key)})
    summary = {'schemaVersion':1,'version':VERSION,'generatedAt':dt.datetime.now(dt.timezone.utc).isoformat(),
       'analysisStart':manifest['analysisStart'],'analysisEnd':manifest['analysisEnd'],
       'collection':{'requested':len(manifest['stocks']),'listedRequested':sum(not s['delistingDate'] for s in manifest['stocks']),
        'delistedRequested':sum(bool(s['delistingDate']) for s in manifest['stocks']),
        'usable':len(stock_results),'listedUsable':sum(not s['delistingDate'] for s in stock_results),
        'delistedUsable':sum(bool(s['delistingDate']) for s in stock_results),'qualityExclusions':dict(quality),
        'universeExclusions':dict(Counter(x['reason'] for x in manifest['excludedUniverse'])),
        'inputManifestSha256':hashlib.sha256((cache/'manifest.json').read_bytes()).hexdigest(),
        'delistingSnapshot':manifest['delistingSource']['snapshot']},
       'tenbaggerStocks':len(cases), 'byMarket':dict(Counter(x['market'] for x in cases)),
       'fastFiveYearStocks':sum(x['fastFiveYear']['multiple']>=10 for x in cases),
       'caseRisk':{'medianRiseMddPct':float(np.median([x['riseMddPct'] for x in cases])) if cases else None,
                   'medianPostPeakDrawdownPct':float(np.median([x['postPeakDrawdownPct'] for x in cases])) if cases else None},
       'marketCohorts':{m:probability([z for z in cohorts if 2016<=z['year']<=2020 and z['market']==m]) for m in ['KOSPI','KOSDAQ']},
       'cohortN':len(cohorts),'baselineTrain':probability([z for z in cohorts if z['year']<=2010]),
       'baselineTest':probability([z for z in cohorts if 2016<=z['year']<=2020]),
       'horizons':[{'years':h,'n':sum(z[f'peak{h}'] is not None for z in cohorts),
         'touch10N':sum(z[f'peak{h}'] is not None and z[f'peak{h}']>=10 for z in cohorts),
         'finish10N':sum(z[f'end{h}'] is not None and z[f'end{h}']>=10 for z in cohorts)} for h in [1,3,5]],
       'features':features,'strategies':strategies,'selectedRule':chosen,
       'method':{'oracle':'확보한 전체 기간의 선행 종가 저점→후행 종가 고점, 별도로 5개 달력년 최대 상승도 계산. 미래를 아는 사후 상한; 실현 수익 아님.',
         'train':'진입 2001~2010, 최대 5년 추적. 2015-12-31 이후 가격·거래재개·상장폐지 결과를 차단하고 미완료 거래 제외. 선택 완료 시점 2015년 말.',
         'test':'진입 2016~2020, 최대 5년 추적(~2025). 규칙 선택에 미사용.',
         'cost':'한쪽 비용 0.5%(수수료·세금·슬리피지 합산 가정), 민감도 0.1/0.5/1.0%. 연도별 실제 세율 아님.',
         'execution':'확정 종가 신호→다음 체결 가능한 시가. 삼성을 포함한 3개 장기 상장 종목의 관측 거래일로 누락봉과 휴장을 구분. 매수 다음 봉 불가 시 폐기; 매도 중지/가격제한 근처 시가는 재개까지 대기. 고저가·그날 종가로 시가 체결을 판단하지 않음. 종가 기준 낙폭.',
         'limitZone':'거래 당시 호가·대기열을 모른다. 현재/최종 코스닥 분류는 2005-03-28 전 시가 갭 ±11%, 그 밖은 2015-06-15 전 ±14%, 이후 ±29%를 넘는 매수/매도는 보수적으로 제외한다. 과거 시장 이전·특별 기준가격·정리매매·호가 반올림을 완전히 복원한 가격제한 모델은 아님.',
         'terminal':'상장폐지 시 정산액 미확인은 0원 전액손실 스트레스. 합병·시장 이전 실제 정산 수익은 복원하지 못함.',
         'inference':'같은 종목의 연도별 코호트가 겹친다. 확률 구간은 종목 단위 200회 bootstrap; 시간·업종 상관까지 제거한 인과 추정 아님.',
         'returnUnit':'독립 종목의 겹치지 않는 거래 사건. 자금 배분·동시 보유를 구현한 포트폴리오 CAGR/MDD가 아님.',
         'priceBasis':'Naver 소급 조정 OHLCV. 거래 당시 원주가/주식수·기업행동 전체 대조 미완료. 소수주 정규화 연구 수익, 정수주 실주문 성과 아님. 양수 시가를 모형상 체결가로 가정하며, 당일 거래량이 0/누락인 원천의 실제 시가 거래와 주문 체결은 확인하지 못했다.',
         'marketBasis':'현재/최종 시장·업종. 과거 시장 이전·업종 변경은 소급 복원하지 못함.',
         'fundamentals':'역사적 공시 접수시각 연결 재무 패널 미확보. 재무 성장·수주·기술수출은 기업 원문 사례로만 설명하며 정량 예측 신호에 넣지 않음.'}}
    cases.sort(key=lambda r:r['multiple'],reverse=True)
    for case in cases:
        for k in ['buyIndex','sellIndex']:case.pop(k,None)
    (dest/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2,allow_nan=False))
    (dest/'cases.json').write_text(json.dumps(cases,ensure_ascii=False,separators=(',',':'),allow_nan=False))
    (dest/'universe.json').write_text(json.dumps({'stocks':manifest['stocks'],'excludedUniverse':manifest['excludedUniverse']},ensure_ascii=False,separators=(',',':')))
    (cache/'cohorts.json.gz').write_bytes(gzip.compress(json.dumps(cohorts,ensure_ascii=False).encode(),mtime=0))
    (cache/'trades.json.gz').write_bytes(gzip.compress(json.dumps(trades,ensure_ascii=False).encode(),mtime=0))
    print(json.dumps({'usable':len(stock_results),'tenbaggers':len(cases),'cohorts':len(cohorts),'selected':chosen,'quality':dict(quality)},ensure_ascii=False),flush=True)


if __name__=='__main__':main()
