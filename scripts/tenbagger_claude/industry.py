#!/usr/bin/env python3
"""텐배거(클로드) 보조 자료 — 네이버 업종 분류(현재 상장 종목만)와 코스피·코스닥 지수 일봉.

업종은 지금 상장된 종목만 알 수 있다(상장폐지 종목은 '미확인'). 그래서 업종 분석은
'현재 남아 있는 텐배거의 업종 구성'으로만 쓰고, 확률(기저율) 계산에는 쓰지 않는다.

쓰는 법:
  python scripts/tenbagger_claude/industry.py --out /scratch/aux.json
"""
import argparse
import json
import time
import urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://m.stock.naver.com/'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception:
            time.sleep(1.5 * (i + 1))
    raise RuntimeError('fetch failed: ' + url)


def industries():
    g, page = [], 1
    while True:       # pageSize 는 100 이 한도(그 이상은 오류)
        part = json.loads(get(f'https://m.stock.naver.com/api/stocks/industry?page={page}&pageSize=100')).get('groups') or []
        g += part
        if len(part) < 100:
            break
        page += 1
    out = {}
    for x in g:
        no, name = x['no'], x['name']
        page = 1
        while True:
            j = json.loads(get(f'https://m.stock.naver.com/api/stocks/industry/{no}?page={page}&pageSize=100'))
            st = j.get('stocks') or []
            for s in st:
                out[str(s.get('itemCode', '')).upper()] = name
            if len(st) < 100:
                break
            page += 1
            time.sleep(0.1)
        time.sleep(0.1)
    return out


def index_series(sym):
    t = get(f'https://api.finance.naver.com/siseJson.naver?symbol={sym}&requestType=1&startTime=19900101&endTime=20991231&timeframe=day')
    rows = []
    for line in t.splitlines():
        line = line.strip().rstrip(',')
        if not line.startswith('["'):
            continue
        p = [x.strip().strip('"') for x in line.strip('[]').split(',')]
        d = p[0]
        rows.append([f'{d[:4]}-{d[4:6]}-{d[6:]}', float(p[4])])
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    ind = industries()
    idx = {s: index_series(s) for s in ('KOSPI', 'KOSDAQ')}
    json.dump({'industry': ind, 'index': idx}, open(a.out, 'w'), ensure_ascii=False)
    print(f'업종 {len(set(ind.values()))}개 · 종목 {len(ind)} · KOSPI {len(idx["KOSPI"])}일 · KOSDAQ {len(idx["KOSDAQ"])}일')


if __name__ == '__main__':
    main()
