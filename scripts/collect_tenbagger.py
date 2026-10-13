#!/usr/bin/env python3
"""Collect a dated KRX/KIND + delisting-cache universe and Naver historical OHLCV.

No API keys. Immutable gzip inputs + hashes are kept outside the website checkout.
Prices are the provider's retrospectively adjusted series, not certified KRX
point-in-time execution prices. Missing delisted histories are counted explicitly.
"""
import argparse
import ast
import concurrent.futures
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import pathlib
import re
import time
import urllib.request

import pandas as pd

UA = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.naver.com/'}
KIND = 'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download&searchType=13'
DELIST_TREE = 'https://api.github.com/repos/FinanceData/fdr_krx_data_cache/contents/data/listing/delisting'
CODE = re.compile(r'^(?:\d{6}|\d{4}[A-Z]\d)$')
EXCLUDE = re.compile(r'스팩|기업인수목적|리츠|인프라투융자|인프라펀드')


def download(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read()


def universe(cache, end):
    raw = cache / 'kind.html'
    if not raw.exists():
        raw.write_bytes(download(KIND))
    listed = pd.read_html(io.StringIO(raw.read_bytes().decode('euc-kr', 'replace')), converters={'종목코드': str})[0]
    rows, excluded = [], []
    for _, x in listed.iterrows():
        code = str(x['종목코드']).strip().zfill(6)
        market = {'유가': 'KOSPI', '유가증권': 'KOSPI', '코스피': 'KOSPI', '코스닥': 'KOSDAQ'}.get(str(x['시장구분']))
        reason = None
        if not market: reason = 'other_market'
        elif str(x['상장일']) > end: reason = 'listed_after_analysis_end'
        elif EXCLUDE.search(str(x['회사명'])): reason = 'spac_reit_fund'
        elif not CODE.fullmatch(code): reason = 'unsupported_code'
        if reason:
            excluded.append({'code': code, 'reason': reason})
            continue
        rows.append({'code': code, 'name': str(x['회사명']), 'market': market,
                     'sector': str(x['업종']), 'listingDate': str(x['상장일']),
                     'delistingDate': None, 'delistingReason': None, 'universeSource': 'KIND-current'})
    dfile = cache / 'delist.csv'
    meta = cache / 'delist-source.json'
    if not dfile.exists():
        entries = json.loads(download(DELIST_TREE))
        entry = max((x for x in entries if x['name'].endswith('.csv')), key=lambda x: x['name'])
        dfile.write_bytes(download(entry['download_url']))
        meta.write_text(json.dumps({'url': entry['download_url'], 'snapshot': entry['name'][:-4]}, ensure_ascii=False))
    delisted = pd.read_csv(dfile, dtype=str)
    active = {x['code'] for x in rows}
    elig = delisted[(delisted.Market.isin(['KOSPI', 'KOSDAQ'])) & (delisted.Kind == '보통주')
                    & (delisted.SecuGroup == '주권') & (delisted.DelistingDate >= '2000-01-01')
                    & (delisted.ListingDate <= end)]
    duplicate = set(elig.Symbol[elig.Symbol.duplicated(keep=False)])
    for _, x in elig.iterrows():
        code, name = str(x.Symbol), str(x.Name)
        reason = None
        if code in active: reason = 'listed_code_collision_or_market_transfer'
        elif code in duplicate: reason = 'multiple_delisting_identity'
        elif EXCLUDE.search(name): reason = 'spac_reit_fund'
        elif not CODE.fullmatch(code): reason = 'unsupported_code'
        if reason:
            excluded.append({'code': code, 'reason': reason})
            continue
        rows.append({'code': code, 'name': name, 'market': str(x.Market),
                     'sector': str(x.Industry) if pd.notna(x.Industry) else '상장폐지 / 업종 미확인',
                     'listingDate': str(x.ListingDate), 'delistingDate': str(x.DelistingDate),
                     'delistingReason': str(x.Reason), 'universeSource': 'KRX-via-FinanceData-cache'})
    return sorted(rows, key=lambda x: x['code']), excluded, json.loads(meta.read_text())


def collect_one(stock, cache, end):
    code = stock['code']
    path = cache / 'prices' / (code + '.json.gz')
    url = f'https://fchart.stock.naver.com/siseJson.nhn?symbol={code}&requestType=1&startTime=20000101&endTime={end.replace("-", "")}&timeframe=day'
    error = None
    for attempt in range(2):
        try:
            if path.exists():
                payload = gzip.decompress(path.read_bytes())
            else:
                payload = download(url)
                path.write_bytes(gzip.compress(payload, mtime=0))
            try: txt = payload.decode('utf-8')
            except UnicodeDecodeError: txt = payload.decode('euc-kr')
            arr = ast.literal_eval(txt.strip())
            limit = min(end, stock['delistingDate'] or end)
            bars = []
            for r in arr[1:]:
                if len(r) < 6: continue
                date = str(r[0]); date = date[:4] + '-' + date[4:6] + '-' + date[6:8]
                if not (max('2000-01-01', stock['listingDate']) <= date <= limit): continue
                o, h, l, c, v = map(float, r[1:6])
                if c <= 0: continue
                bars.append([date, o, h, l, c, v])
            bars.sort()
            flags = []
            if not bars: flags.append('no_price_history')
            elif len(bars) < 253: flags.append('less_than_253_bars')
            if len({b[0] for b in bars}) != len(bars): flags.append('duplicate_dates')
            jumps = sum(abs(bars[i][4] / bars[i-1][4] - 1) > .36 for i in range(1, len(bars)))
            if jumps: flags.append('price_jump_over_36pct')
            impossible = sum(b[1] > 0 and (b[2] < max(b[1], b[4]) - max(3, b[4]*.015)
                              or b[3] > min(b[1], b[4]) + max(3, b[4]*.015)
                              or b[3] > b[2]) for b in bars)
            if impossible: flags.append('inconsistent_adjusted_ohlc')
            if stock['delistingDate'] and stock['delistingDate'] <= end and bars:
                missing = (dt.date.fromisoformat(stock['delistingDate']) - dt.date.fromisoformat(bars[-1][0])).days
                if missing > 31: flags.append('delisting_terminal_history_gap')
            return {**stock, 'bars': bars, 'sourceUrl': url, 'inputSha256': hashlib.sha256(payload).hexdigest(),
                    'flags': flags, 'jumpCount': jumps, 'invalidOhlcCount': impossible, 'error': None}
        except Exception as e:
            error = f'{type(e).__name__}: {e}'
            if path.exists(): path.unlink()
    return {**stock, 'bars': [], 'flags': ['source_failed'], 'error': error, 'sourceUrl': url, 'inputSha256': None}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--cache', default='/tmp/tenbagger-inputs-20261013')
    p.add_argument('--end', default='2025-12-31')
    p.add_argument('--workers', type=int, default=8)
    p.add_argument('--limit', type=int)
    p.add_argument('--offset', type=int, default=0)
    a = p.parse_args()
    cache = pathlib.Path(a.cache); (cache / 'prices').mkdir(parents=True, exist_ok=True)
    rows, excluded, dm = universe(cache, a.end)
    rows = rows[a.offset:a.offset+a.limit] if a.limit else rows[a.offset:]
    print(f'Universe {len(rows)} (listed {sum(x["delistingDate"] is None for x in rows)}, delisted {sum(x["delistingDate"] is not None for x in rows)})', flush=True)
    manifest = {'schemaVersion': 1, 'collectedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'analysisStart': '2000-01-01', 'analysisEnd': a.end, 'listingSource': KIND,
                'delistingSource': dm, 'priceBasis': 'naver-retrospective-adjusted-OHLCV',
                'marketBasis': 'current-or-final-market-not-point-in-time',
                'excludedUniverse': excluded, 'stocks': []}
    with concurrent.futures.ThreadPoolExecutor(max_workers=a.workers) as ex:
        futures = {ex.submit(collect_one, s, cache, a.end): s for s in rows}
        for f in concurrent.futures.as_completed(futures):
            x = f.result()
            path = cache / 'normalized' / (x['code'] + '.json.gz')
            path.parent.mkdir(exist_ok=True)
            path.write_bytes(gzip.compress(json.dumps(x, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
            manifest['stocks'].append({k: v for k, v in x.items() if k != 'bars'} | {'barCount': len(x['bars']), 'firstDate': x['bars'][0][0] if x['bars'] else None, 'lastDate': x['bars'][-1][0] if x['bars'] else None})
            if len(manifest['stocks']) % 100 == 0:
                print(f'{len(manifest["stocks"])}/{len(rows)} | histories {sum(s["barCount"] >= 253 for s in manifest["stocks"])} | failed {sum(bool(s["error"]) for s in manifest["stocks"])}', flush=True)
                (cache / 'manifest.partial.json').write_text(json.dumps(manifest, ensure_ascii=False))
    manifest['stocks'].sort(key=lambda s: s['code'])
    name = f'manifest-{a.offset}-{a.limit}.json' if a.limit or a.offset else 'manifest.json'
    (cache / name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print('Complete:', len(rows), 'manifest', cache / name, flush=True)


if __name__ == '__main__':
    main()
