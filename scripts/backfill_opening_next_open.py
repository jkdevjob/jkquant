"""Store next-session opening prices separately; never modify original signal archives."""
import json
from datetime import datetime
from opening_backfill import KST, MarketHours, daily_snapshot, guard, request_json, save
from collect_scalping_data import BASE
from backtest_opening_rebreak import DATA, Params, load_days, one_trade


def main():
    try:
        guard()
    except MarketHours as e:
        print(e)
        return 0
    # Market-wide daily calendar prevents Friday->Saturday, holidays, or suspension jumps.
    j = request_json(BASE + '/api/quote?symbol=069500&range=2y&intraday=0&div=0')
    dates = sorted({r['date'] for r in j.get('ohlc', []) if len(r.get('date', '')) == 10})
    if not dates:
        raise RuntimeError('Next-session calendar is unavailable')
    mapping = dict(zip(dates, dates[1:]))
    for day in load_days():
        next_date = mapping.get(day['date'])
        if not next_date or next_date > datetime.now(KST).date().isoformat():
            continue
        candidates = [r for r in day['universe'] if not r.get('nextOpen') and one_trade(day, r, Params('baseline'))]
        if not candidates:
            continue
        path = DATA.parent / 'opening-next-open' / (day['date'] + '.json')
        payload = json.loads(path.read_text(encoding='utf-8')) if path.exists() else dict(date=day['date'], records={})
        snap = daily_snapshot(next_date)
        rows = {r['code']: r for r in snap['rows']}
        for r in candidates:
            nr = rows.get(r['code'])
            if nr and nr['open'] > 0 and r.get('close', 0) > 0 and abs(nr['prevClose']/r['close']-1) <= .01:
                payload['records'][r['code']] = dict(date=next_date, price=nr['open'], source=snap['source'])
        payload['updatedAt'] = datetime.now(KST).isoformat()
        save(path, payload)
        print(day['date'], 'next open labels', len(payload['records']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
