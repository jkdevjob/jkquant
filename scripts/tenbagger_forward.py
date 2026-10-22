#!/usr/bin/env python3
"""Locked price-pattern hypotheses and prospective observation ledger, NOT orders.

Uses KRX-derived marcap prices, not Naver KRX+NXT composite closes. Historical
GPT indicators are reused. Registration precedes every measured session; data
revisions never rewrite stored observations. Outputs belong to scalping-data.
"""
import argparse
import copy
import datetime as dt
import hashlib
import inspect
import json
import pathlib
import re
import urllib.request
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from analyze_tenbagger import indicators
from tenbagger_claude.panel import FUND_RE

VERSION = '1.0.0'
PATTERNS = {
    'trend200': '상승 200일선 재돌파',
    'breakout252': '252일 신고가·거래량 1.5배',
    'pullback50': '상승 추세·50일선 재돌파',
}
RULES = {
    'version': VERSION, 'registeredOn': '2026-10-13',
    'patterns': PATTERNS,
    'parameters': {'ma50': 50, 'ma200': 200, 'slopeDays': 20,
                   'priorHighDays': 252, 'volumeRatio': 1.5,
                   'pullbackMin': -.30, 'pullbackMax': -.05,
                   'prior20AmountMinWon': 1_000_000_000,
                   'costPerSide': .005, 'stopClose': -.12,
                   'trailClose': -.35, 'maxSessions': 1260},
    'arms': ['hold1260', 'stop12_trail35'],
    'horizons': [20, 60, 120, 252, 756, 1260],
    'execution': '등록일과 신호일 모두 지난 첫 거래 가능 KRX 종가를 관찰 기준으로 고정. 실체결 아님. 청산 신호도 다음 거래 가능 종가.',
    'selection': '기존 과거 분석에서 정의한 세 조건을 고정한 탐색 가설. 수익성 검증·최적 규칙 아님. 공시 시점 재무 자료 미포함.',
}


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def completed_cutoff(now):
    # Publication may lag the 15:30 KRX close. Before 18:00 never use today's row.
    local = now.astimezone(ZoneInfo('Asia/Seoul'))
    day = local.date() if local.hour >= 18 else local.date() - dt.timedelta(days=1)
    return day.isoformat()


def prepare(raw, cutoff):
    d = raw.copy()
    d['Date'] = pd.to_datetime(d['Date']).dt.strftime('%Y-%m-%d')
    d = d[d.Date <= cutoff].copy()  # truncate BEFORE indicators/universe selection
    d['Code'] = d.Code.astype(str).str.zfill(6)
    if d.duplicated(['Code', 'Date']).any():
        raise ValueError('duplicate code-date input')
    return d.sort_values(['Code', 'Date']).reset_index(drop=True)


def eligible(row):
    return (row.Market in ('KOSPI', 'KOSDAQ', 'KOSDAQ GLOBAL')
            and bool(re.fullmatch(r'\d{5}0', row.Code)) and row.Close > 0
            and not re.search(FUND_RE, str(row.Name))
            and str(row.Dept) not in ('SPAC(소속부없음)', '관리종목(소속부없음)',
                                     '투자주의환기종목(소속부없음)'))


def chain(g):
    ref = g.Close.astype(float) - g.Changes.astype(float)
    ratios = g.Close.astype(float) / ref
    # Unknown corporate action/reference error is quarantined, never filled by zero return.
    valid = ((ref > 0) & np.isfinite(ratios) & (ratios > .34) & (ratios < 2.6))
    if not valid.iloc[1:].all():
        return None
    ratios.iloc[0] = 1
    adj = ratios.cumprod() * float(g.Close.iloc[0])
    fac = adj / g.Close
    bars = [[r.Date, float(r.Open * f), float(r.High * f), float(r.Low * f),
             float(c), float(r.Volume)] for r, f, c in zip(g.itertuples(), fac, adj)]
    return indicators(bars, 'KOSDAQ' if 'KOSDAQ' in str(g.Market.iloc[-1]) else 'KOSPI')


def scan(d):
    if d.empty:
        raise ValueError('empty market input')
    asof = str(d.Date.max())
    cal = sorted(d.Date.unique())
    current = d[d.Date == asof]
    candidates, excluded = [], {}
    examined = 0
    for code, g in d.groupby('Code', sort=True):
        row = g.iloc[-1]
        reason = None
        if row.Date != asof: reason = 'missing_latest_session'
        elif not eligible(row): reason = 'outside_common_stock_or_watch_status'
        elif len(g) < 253: reason = 'short_history'
        elif g.Name.tail(253).astype(str).str.contains(FUND_RE, regex=True).any(): reason = 'prior_spac_or_fund_history'
        elif list(g.Date.tail(253)) != cal[-253:]: reason = 'history_gap'
        elif row.Volume <= 0 or min(row.Open, row.High, row.Low) <= 0: reason = 'not_traded'
        if reason:
            excluded[reason] = excluded.get(reason, 0) + 1
            continue
        examined += 1
        f = chain(g.tail(300).reset_index(drop=True))
        if f is None:
            excluded['invalid_reference_or_action'] = excluded.get('invalid_reference_or_action', 0) + 1
            continue
        amount = float(g.Amount.iloc[-21:-1].mean())
        if not np.isfinite(amount) or amount < RULES['parameters']['prior20AmountMinWon']:
            excluded['low_prior_liquidity'] = excluded.get('low_prior_liquidity', 0) + 1
            continue
        x = f.iloc[-1]
        for pattern in PATTERNS:
            if not bool(x[pattern]): continue
            candidates.append({'code': code, 'name': str(row.Name),
                'market': 'KOSDAQ' if 'KOSDAQ' in str(row.Market) else 'KOSPI',
                'pattern': pattern, 'signalDate': asof, 'signalClose': float(row.Close),
                'features': {'ma200SlopePct': float(x.slope200 * 100),
                    'distancePriorHighPct': float(x.distanceHigh * 100),
                    'volumeRatio': float(x.volumeRatio), 'prior20AmountWon': amount}})
    # No future winner ranking; keep the complete passing set in code/pattern order.
    return asof, candidates, {'currentRows': len(current), 'examined': examined,
                              'excluded': excluded, 'candidateSignals': len(candidates)}


def evolve(previous, d, candidates, now, source):
    rules_hash = digest(RULES)
    state = copy.deepcopy(previous) if previous else {
        'schemaVersion': 1, 'strategyVersion': VERSION, 'rules': RULES,
        'rulesSha256': rules_hash, 'registeredAt': now.isoformat(),
        'records': [], 'lastAsOf': None,
    }
    if state['strategyVersion'] != VERSION or state['rulesSha256'] != rules_hash or digest(state['rules']) != rules_hash:
        raise ValueError('locked rules changed: start a separate version, do not rewrite history')
    asof = str(d.Date.max())
    if state['lastAsOf'] and asof < state['lastAsOf']:
        raise ValueError('source date moved backwards')
    today = now.astimezone(ZoneInfo('Asia/Seoul')).date().isoformat()
    bycode = {str(c): g for c, g in d.groupby('Code')}
    cal = sorted(d.Date.unique())
    new_count = 0
    initial = previous is None
    for record in state['records']:
        if all(a['status'] == 'closed' for a in record['arms'].values()):
            record['dataStatus'] = 'completed'
            continue
        g = bycode.get(record['code'])
        if g is None:
            record['dataStatus'] = 'missing_or_delisted_settlement_unknown'
            continue  # never silently drop failed/delisted observations
        start = max(record['registeredDate'], record['signalDate'])
        obs = record['observations']
        last = obs[-1]['date'] if obs else start
        expected = [day for day in cal if last < day <= asof]
        rows = {r.Date: r for r in g.itertuples()}
        record['dataStatus'] = 'observing'
        for day in expected:
            r = rows.get(day)
            if r is None or r.Close <= 0:
                record['dataStatus'] = 'missing_session_or_settlement_unknown'
                break
            tradable = r.Volume > 0 and min(r.Open, r.High, r.Low) > 0
            if not tradable and not obs:
                record['dataStatus'] = 'halted_entry_waiting'
                continue
            ratio = float(r.Close / (r.Close - r.Changes)) if r.Close - r.Changes > 0 else None
            if obs and (ratio is None or not .34 < ratio < 2.6):
                record['dataStatus'] = 'reference_or_action_review'
                break
            growth = obs[-1]['growth'] * ratio if obs else 1.0
            obs.append({'date': day, 'rawClose': float(r.Close), 'sourceChanges': float(r.Changes), 'growth': growth, 'tradable': bool(tradable),
                        'inputSha256': source['combinedSha256']})
            if not record['entryDate']:
                record['entryDate'] = day
                for arm in record['arms'].values(): arm['status'] = 'open'
            sessions = len(obs) - 1
            for name, arm in record['arms'].items():
                if arm['status'] == 'closed': continue
                if arm['exitSignalDate'] and day > arm['exitSignalDate'] and tradable:
                    arm.update(status='closed', exitDate=day,
                               netReturnPct=(growth * .995 / 1.005 - 1) * 100)
                    continue
                arm['highGrowth'] = max(arm['highGrowth'], growth)
                if arm['exitSignalDate']: continue
                if sessions >= RULES['parameters']['maxSessions']:
                    arm['exitSignalDate'] = day; arm['exitReason'] = 'time1260'
                elif name == 'stop12_trail35':
                    if growth <= .88:
                        arm['exitSignalDate'] = day; arm['exitReason'] = 'close_stop12'
                    elif growth / arm['highGrowth'] <= .65:
                        arm['exitSignalDate'] = day; arm['exitReason'] = 'close_trail35'
            if sessions in RULES['horizons']:
                record['horizons'][str(sessions)] = {'date': day,
                    'netReturnPct': (growth * .995 / 1.005 - 1) * 100}
            for multiple in (2, 5, 10):
                if growth >= multiple: record['firstTouch'].setdefault(str(multiple), day)
        if obs:
            record['sessions'] = len(obs) - 1
            record['netMarkPct'] = (obs[-1]['growth'] * .995 / 1.005 - 1) * 100
            growths = [o['growth'] for o in obs]
            record['mfeClosePct'] = (max(growths) - 1) * 100
            record['maeClosePct'] = (min(growths) - 1) * 100
            record['mddClosePct'] = float(min(np.asarray(growths) / np.maximum.accumulate(growths) - 1) * 100)
        # Compare already stored observations to revised source without rewriting them.
        rows = {r.Date: r for r in g.itertuples()}
        revised = [o['date'] for o in obs if o['date'] in rows
                   and (float(rows[o['date']].Close) != o['rawClose']
                        or 'sourceChanges' in o and float(rows[o['date']].Changes) != o['sourceChanges'])]
        record['revisionDates'] = sorted(set(record.get('revisionDates', []) + revised))
    occupied = {(r['code'], r['pattern']) for r in state['records']
                if any(a['status'] != 'closed' for a in r['arms'].values())}
    for c in candidates:
        if (c['code'], c['pattern']) in occupied: continue
        # Initial latest-source signals can predate registration: measurement still
        # starts only AFTER registration, never retroactively on T+1 already passed.
        if c['signalDate'] < RULES['registeredOn'] and not initial: continue
        record = copy.deepcopy(c)
        record.update(id=VERSION + ':' + c['signalDate'] + ':' + c['code'] + ':' + c['pattern'],
            strategyVersion=VERSION, rulesSha256=rules_hash, registeredAt=now.isoformat(),
            registeredDate=today, sourceSnapshot=copy.deepcopy(source),
            entryDate=None, sessions=0, netMarkPct=None, observations=[],
            dataStatus='registered_waiting_next_session', horizons={}, firstTouch={},
            revisionDates=[], arms={a: {'status': 'pending', 'highGrowth': 1.0,
                'exitSignalDate': None, 'exitDate': None, 'netReturnPct': None,
                'exitReason': None} for a in RULES['arms']})
        state['records'].append(record); occupied.add((c['code'], c['pattern'])); new_count += 1
    state['lastAsOf'] = asof
    return state, new_count


def report(state, candidates, coverage, now, source, new_count):
    records = []
    for r in state['records']:
        x = {k: v for k, v in r.items() if k != 'observations'}
        prices = {o['date']: o.get('rawClose') for o in r['observations']}
        x['entryPrice'] = prices.get(r.get('entryDate'))
        x['arms'] = {name: {**arm, 'exitPrice': prices.get(arm.get('exitDate'))} for name, arm in r['arms'].items()}
        x['lastObservedDate'] = r['observations'][-1]['date'] if r['observations'] else None
        records.append(x)
    stats = []
    for pattern in PATTERNS:
        group = [r for r in records if r['pattern'] == pattern]
        horizons = {}
        for day in RULES['horizons']:
            values = [r['horizons'][str(day)]['netReturnPct'] for r in group if str(day) in r['horizons']]
            horizons[str(day)] = {'n': len(values), 'medianNetPct': float(np.median(values)) if values else None,
                                 'negativeN': sum(x < 0 for x in values)}
        arms = {}
        for arm in RULES['arms']:
            done = [r['arms'][arm]['netReturnPct'] for r in group if r['arms'][arm]['status'] == 'closed']
            arms[arm] = {'closedN': len(done), 'medianNetPct': float(np.median(done)) if done else None}
        stats.append({'pattern': pattern, 'registrations': len(group),
                      'uniqueStocks': len({r['code'] for r in group}),
                      'entered': sum(bool(r['entryDate']) for r in group),
                      'horizons': horizons, 'arms': arms})
    return {'ok': True, 'schemaVersion': 1, 'strategyVersion': VERSION,
        'status': 'prospective_experiment', 'generatedAt': now.isoformat(),
        'asOf': state['lastAsOf'], 'registeredAt': state['registeredAt'],
        'rules': RULES, 'rulesSha256': state['rulesSha256'], 'source': source,
        'coverage': coverage, 'candidates': candidates, 'records': records,
        'patternStats': stats, 'newRegistrations': new_count, 'entered': sum(bool(r['entryDate']) for r in records),
        'closedArms': sum(a['status'] == 'closed' for r in records for a in r['arms'].values()),
        'warnings': ['가격 조건만으로 고정한 탐색 가설이며 텐배거 예측력·수익성 미검증.',
            'KRX 종가 관찰 수익률. 실체결·배당·세금·호가·정수주·시장충격 및 포트폴리오 성과 아님. 비용은 편도 0.5% 가정.',
            '정지·누락·폐지 정산 미확인은 보류로 보존하며 확정 수익/0%로 대체하지 않음.',
            '재무·공시 시점·업종 및 시장지수 대조는 후속 검증. 세 가설과 두 청산군 비교에 다중검정 주의.']}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--out', default='data/tenbagger-forward')
    ap.add_argument('--seed', help='initial state from main when data branch has no state')
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    cutoff = completed_cutoff(now)
    cache, out = pathlib.Path(a.cache), pathlib.Path(a.out)
    cache.mkdir(parents=True, exist_ok=True); out.mkdir(parents=True, exist_ok=True)
    frames, inputs = [], []
    upstream_url = 'https://api.github.com/repos/FinanceData/marcap/git/ref/heads/master'
    with urllib.request.urlopen(urllib.request.Request(upstream_url, headers={'User-Agent': 'jkquant-tenbagger-forward/1.0'}), timeout=30) as r:
        upstream = json.load(r)['object']['sha']
    if not re.fullmatch(r'[0-9a-f]{40}', upstream): raise ValueError('invalid upstream commit')
    for year in (int(cutoff[:4]) - 1, int(cutoff[:4])):
        url = f'https://raw.githubusercontent.com/FinanceData/marcap/{upstream}/data/marcap-{year}.parquet'
        path = cache / f'marcap-{year}.parquet'
        req = urllib.request.Request(url, headers={'User-Agent': 'jkquant-tenbagger-forward/1.0'})
        with urllib.request.urlopen(req, timeout=90) as r: data = r.read()
        sha = hashlib.sha256(data).hexdigest()
        frozen = cache / (str(year) + '-' + sha + '.parquet')
        if not frozen.exists(): frozen.write_bytes(data)
        path.write_bytes(data)
        frames.append(pd.read_parquet(path))
        inputs.append({'url': url, 'sha256': sha, 'bytes': len(data)})
    d = prepare(pd.concat(frames, ignore_index=True), cutoff)
    asof, candidates, coverage = scan(d)
    age = (now.astimezone(ZoneInfo('Asia/Seoul')).date() - dt.date.fromisoformat(asof)).days
    if age > 7: raise RuntimeError('source too old for new registration: ' + asof)
    source = {'provider': 'KRX-via-FinanceData-marcap', 'priceBasis': 'KRX close/reference-price chain, cash dividends excluded',
              'asOf': asof, 'cutoff': cutoff, 'inputs': inputs, 'combinedSha256': digest(inputs), 'upstreamCommit': upstream,
              'engineSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
              'indicatorsSha256': hashlib.sha256(inspect.getsource(indicators).encode()).hexdigest(),
              'universeFilterSha256': hashlib.sha256(FUND_RE.encode()).hexdigest()}
    statepath = out / ('state-' + VERSION + '.json')
    old = json.loads(statepath.read_text()) if statepath.exists() else (
        json.loads(pathlib.Path(a.seed).read_text()) if a.seed and pathlib.Path(a.seed).exists() else None)
    state, new_count = evolve(old, d, candidates, now, source)
    result = report(state, candidates, coverage, now, source, new_count)
    # One source day is immutable. Reruns only refresh latest/state, not old snapshots.
    snapshot = out / 'snapshots' / (VERSION + '-' + asof + '.json')
    snapshot.parent.mkdir(exist_ok=True)
    if not snapshot.exists(): snapshot.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    statepath.write_text(json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False))
    (out / 'latest.json').write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    note = {'study': 'tenbagger', 'date': now.astimezone(ZoneInfo('Asia/Seoul')).date().isoformat(), 'discovery': False,
            'body': f'시세 {asof} · 실험 후보 {len(candidates)}신호 · 신규 등록 {new_count} · 전체 추적 {len(state["records"])} · 진입 {result["entered"]} · 청산군 {result["closedArms"]} · 수익성 미검증/자동주문 없음'}
    # Same-source reruns send exactly the original daily summary (server dedup).
    notepath = out / ('note-' + asof + '.json')
    if not notepath.exists(): notepath.write_text(json.dumps(note, ensure_ascii=False))
    (out / 'note.json').write_bytes(notepath.read_bytes())
    print(json.dumps({'asOf': asof, 'coverage': coverage, 'records': len(state['records']),
                      'new': new_count, 'sourceSha256': source['combinedSha256']}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
