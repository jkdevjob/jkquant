"""Resumable, off-hours historical Top100 reconstruction. Never uses today's members."""
from __future__ import annotations
import argparse
import csv
import io
import hashlib
import gzip
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
ROOT = Path(os.environ.get('JKQ_BACKFILL_ROOT', 'data/scalping-backfill'))
LAST_REQUEST = 0.0
YEAR_FRAMES = {}
DEADLINE = None


class MarketHours(RuntimeError):
    pass


class TimeBudget(MarketHours):
    pass


def guard(now=None):
    if DEADLINE is not None and time.monotonic() >= DEADLINE:
        raise TimeBudget('Backfill time budget reached; resume from saved checkpoints')
    now = now or datetime.now(KST)
    hm = now.astimezone(KST).hour * 100 + now.astimezone(KST).minute
    if 830 <= hm <= 1540:
        raise MarketHours('Backfill paused: 08:30~15:40 KST is reserved for live monitoring')


def request_bytes(url, data=None, headers=None):
    global LAST_REQUEST
    guard()
    time.sleep(max(0, 0.7 - (time.monotonic() - LAST_REQUEST)))
    guard()  # also check after throttling, before EVERY network request
    LAST_REQUEST = time.monotonic()
    req = urllib.request.Request(url, data=data, headers={
        'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,*/*', **(headers or {})})
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def request_json(url, data=None, headers=None):
    raw = request_bytes(url, data, headers).decode('utf-8')
    try:
        return json.loads(raw)
    except ValueError:
        raise RuntimeError('Historical daily source returned non-JSON (login/access required); not a holiday') from None


def save(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    if path.suffix == '.gz':
        with gzip.open(tmp, 'wt', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
    else:
        tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)


def num(value):
    return 0.0 if value in (None, '', '-') else float(str(value).replace(',', ''))


def public_snapshot(day):
    """Newly downloaded FinanceData KRX snapshots preserve EACH DAY's full membership.

    No current listing join: a subsequently delisted stock remains in its historical rows.
    Amount is actual traded KRW, never close * volume. Annual Rank is market-cap rank;
    ignore it and recompute turnover rank.
    """
    import pandas as pd
    year = day[:4]
    if year not in YEAR_FRAMES:
        url = f'https://raw.githubusercontent.com/FinanceData/marcap/master/data/marcap-{year}.parquet'
        path = ROOT / 'sources' / f'marcap-{year}.parquet'
        if not path.exists():
            raw = request_bytes(url)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            save(path.with_suffix('.source.json'), dict(url=url, downloadedAt=datetime.now(KST).isoformat(),
                 sha256=hashlib.sha256(raw).hexdigest()))
        frame = pd.read_parquet(path)
        required = {'Date','Code','Market','Amount','Close','Open','Changes','Volume'}
        if not required.issubset(frame.columns) or frame.empty:
            raise RuntimeError('Historical KRX annual snapshot schema invalid')
        frame['Date'] = frame['Date'].astype(str).str[:10]
        YEAR_FRAMES[year] = frame
    frame = YEAR_FRAMES[year]
    if frame['Date'].min() <= day <= frame['Date'].max():
        records = frame[frame['Date'] == day].to_dict('records')
        source = f'FinanceData/marcap KRX daily snapshot {year}'
    else:
        url = f'https://raw.githubusercontent.com/FinanceData/fdr_krx_data_cache/master/data/listing/krx/{day}.csv'
        records = list(csv.DictReader(io.StringIO(request_bytes(url).decode('utf-8-sig'))))
        source = url
        if not records or not {'Code','Amount','Changes','Open'}.issubset(records[0]):
            raise RuntimeError('Daily KRX snapshot schema invalid')
    rows = []
    for r in records:
        if r['Market'] not in ('KOSPI', 'KOSDAQ', 'KOSDAQ GLOBAL'):
            continue
        close = num(r['Close'])
        rows.append(dict(code=str(r['Code']).zfill(6), name=r['Name'], market=r['Market'],
            amount=num(r['Amount'])/1e6, cap=num(r['Marcap'])/1e8,
            chg=num(r.get('ChangesRatio', r.get('ChagesRatio', 0))), close=close,
            open=num(r['Open']), prevClose=close-num(r['Changes']), volume=num(r['Volume'])))
    return dict(date=day, source=source, collectedAt=datetime.now(KST).isoformat(), rows=rows)


def daily_snapshot(day):
    """KRX actual value traded, unadjusted OHLC, historical membership incl. delistings."""
    path = ROOT / 'daily' / f'{day}.json.gz'
    if path.exists():
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            return json.load(f)
    if not os.environ.get('KRX_COOKIE'):
        result = public_snapshot(day)
        save(path, result)
        return result
    body = urllib.parse.urlencode(dict(bld='dbms/MDC/STAT/standard/MDCSTAT01501',
        locale='ko_KR', mktId='ALL', trdDd=day.replace('-', ''), share='1', money='1', csvxls_isNo='false')).encode()
    headers = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://data.krx.co.kr/',
               'Content-Type': 'application/x-www-form-urlencoded'}
    if os.environ.get('KRX_COOKIE'):
        headers['Cookie'] = os.environ['KRX_COOKIE']
    j = request_json('https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd', body, headers)
    if not isinstance(j, dict) or not isinstance(j.get('OutBlock_1'), list):
        raise RuntimeError('KRX daily schema unavailable; refusing to infer holiday or use current universe')
    rows = []
    for r in j['OutBlock_1']:
        if r.get('MKT_NM') not in ('KOSPI', 'KOSDAQ', 'KOSDAQ GLOBAL'):
            continue
        close = num(r.get('TDD_CLSPRC'))
        rows.append(dict(code=r['ISU_SRT_CD'], name=r.get('ISU_ABBRV', ''), market=r['MKT_NM'],
            amount=num(r.get('ACC_TRDVAL')) / 1e6, cap=num(r.get('MKTCAP')) / 1e8,
            chg=num(r.get('FLUC_RT')), close=close, open=num(r.get('TDD_OPNPRC')),
            prevClose=close-num(r.get('CMPPREVDD_PRC')), volume=num(r.get('ACC_TRDVOL'))))
    result = dict(date=day, source='KRX/MDCSTAT01501', collectedAt=datetime.now(KST).isoformat(), rows=rows)
    save(path, result)
    return result


def rank_rows(snapshot, limit=100):
    rows = [r for r in snapshot['rows'] if r['amount'] > 0 and r['close'] > 0]
    rows.sort(key=lambda r: (-r['amount'], r['code']))
    return [dict(r, rank=i+1) for i, r in enumerate(rows[:limit])]


def next_session(day, last_day):
    d = date.fromisoformat(day) + timedelta(days=1)
    while d <= date.fromisoformat(last_day):
        if d.weekday() < 5:
            snapshot = daily_snapshot(d.isoformat())
            if any(r['volume'] > 0 for r in snapshot['rows']):
                return snapshot
        d += timedelta(days=1)
    return None


def minute_bars(code, day):
    from collect_scalping_data import BASE
    qs = urllib.parse.urlencode(dict(op='minhist', code=code, date=day.replace('-', ''), hour='100000'))
    for attempt in range(4):
        try:
            j = request_json(BASE + '/api/kis?' + qs)
            if j.get('error'):
                raise RuntimeError(str(j['error']))
            break
        except MarketHours:
            raise
        except Exception:
            if attempt == 3:
                raise
            time.sleep(2 * (attempt+1))
    if j.get('error'):
        raise RuntimeError(str(j['error']))
    prefix = day.replace('-', '')
    bars = {b['t']: b for b in j.get('bars', [])
            if b.get('t', '').startswith(prefix) and '090000' <= b['t'][-6:] <= '100000'
            and all(float(b.get(k) or 0) > 0 for k in ('o', 'h', 'l', 'c'))}
    return [bars[t] for t in sorted(bars)]


def collect_day(day, last_day):
    snapshot = daily_snapshot(day)
    universe = rank_rows(snapshot)
    if not universe:
        return dict(status='no_session', symbols=0, bars=0)
    if len(universe) != 100:
        raise RuntimeError(f'Incomplete historical universe: {len(universe)}/100')
    path = ROOT / 'archives' / day[:4] / f'{day}.json.gz'
    old = {}
    if path.exists():
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            old = json.load(f)
    cached = {r['code']: r for r in old.get('universe', [])}
    nxt = next_session(day, last_day)
    next_rows = {r['code']: r for r in nxt['rows']} if nxt else {}
    rows = []
    errors = []
    payload = dict(schema=4, date=day, universeLimit=100, universeSource='KRX historical daily turnover',
        universeTiming='same-day-close', lookaheadWarning='Ex-post EOD universe, not tradable morning membership',
        source='historical-reconstruction', collectedAt=datetime.now(KST).isoformat(), complete=False, universe=rows)
    for item in universe:
        guard()
        row = dict(item)
        previous = cached.get(item['code'], {})
        bars = previous.get('bars', [])
        # KIS can omit no-trade/VI minutes. Keep gaps visible, never invent flat candles.
        if not bars or (not previous.get('sourceRequestComplete') and
                        any(e.get('code') == item['code'] for e in old.get('errors', []))):
            try:
                bars = minute_bars(item['code'], day)
                row['sourceRequestComplete'] = True
            except MarketHours:
                raise
            except Exception as e:
                errors.append(dict(code=item['code'], error=str(e)))
                if len(errors) >= 3 and not any(r.get('bars') for r in rows):
                    raise RuntimeError('Repeated minute source failures; checkpoint preserved: ' + str(e))
        else:
            row['sourceRequestComplete'] = True
        row['bars'] = bars
        row['observedMinutes'] = len(bars)
        row['missingMinuteCount'] = 61-len(bars)
        row['gap'] = (row['open']/row['prevClose']-1)*100 if row['prevClose'] > 0 else None
        nr = next_rows.get(item['code'])
        row['nextOpen'] = dict(date=nxt['date'], price=nr['open'], source=nxt['source']) if nr and nr['open'] > 0 else None
        if nr and row['close'] > 0 and abs(nr['prevClose']/row['close']-1) > 0.01:
            row['nextOpen'] = None
            row['nextOpenStatus'] = 'corporate_action_review'  # do not interpret split/ex-rights as P&L
        rows.append(row)
        # Preserve unvisited cached symbols on interruption.
        payload['universe'] = rows + [cached[r['code']] for r in universe[len(rows):] if r['code'] in cached]
        save(path, payload)
    full = sum(bool(r['bars']) and r['prevClose'] > 0 and r.get('sourceRequestComplete', False) for r in rows)
    payload.update(universe=rows, count=len(rows), successful=full, complete=full == 100, errors=errors)
    payload['fullWindowSymbols'] = sum(len(r['bars']) == 61 for r in rows)
    payload['coverageNote'] = 'Complete means all 100 source requests returned bars and daily metadata; sparse/no-trade minutes remain unfilled and counted per symbol.'
    save(path, payload)
    return dict(status='complete' if full == 100 else 'partial', symbols=len(rows), completeSymbols=full,
                bars=sum(len(r['bars']) for r in rows), errors=errors, source=payload['universeSource'])


def main(argv=None):
    global DEADLINE
    parser = argparse.ArgumentParser()
    today = datetime.now(KST).date()
    parser.add_argument('--start', default=(today-timedelta(days=365)).isoformat())
    parser.add_argument('--end', default=today.isoformat())
    parser.add_argument('--max-days', type=int, default=366)
    parser.add_argument('--max-seconds', type=int, default=14400)
    args = parser.parse_args(argv)
    if args.max_seconds <= 0:
        parser.error('max-seconds must be positive')
    DEADLINE = time.monotonic() + args.max_seconds
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    if start > end or end > today:
        parser.error('Require start <= end <= today')
    manifest_path = ROOT / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {'dates': {}}
    manifest.update(start=args.start, end=args.end, status='running', universeTiming='same-day-close')
    try:
        guard()
        d, attempted = start, 0
        while d <= end and attempted < args.max_days:
            key = d.isoformat()
            if d.weekday() < 5 and manifest['dates'].get(key, {}).get('status') not in ('complete', 'no_session'):
                attempted += 1
                try:
                    result = collect_day(key, args.end)
                except MarketHours:
                    raise
                except Exception as e:
                    result = dict(status='error', error=str(e))
                manifest['dates'][key] = dict(result, attemptedAt=datetime.now(KST).isoformat())
                save(manifest_path, manifest)
                print(key, result['status'], result.get('error', ''), flush=True)
                if result['status'] == 'error':
                    break  # source-wide access failure: do not hammer the source
            d += timedelta(days=1)
        expected = [(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1)
                    if (start+timedelta(days=i)).weekday() < 5]
        missing = [d for d in expected if manifest['dates'].get(d, {}).get('status') not in ('complete','no_session')]
        manifest.update(status='complete' if not missing else 'incomplete', unresolvedDates=missing)
    except MarketHours as e:
        manifest.update(status='paused_time_budget' if isinstance(e, TimeBudget) else 'paused_market_hours', reason=str(e))
    save(manifest_path, manifest)
    print(json.dumps(dict(status=manifest['status'], unresolved=len(manifest.get('unresolvedDates', []))), ensure_ascii=False), flush=True)
    return 0 if manifest['status'] == 'complete' else 2


if __name__ == '__main__':
    raise SystemExit(main())
