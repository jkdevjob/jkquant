#!/usr/bin/env python3
"""우리 글이 '노린 검색어'에서 몇 위인지 잰다 — blog/STRATEGY_LAB.md 의 둘째 지표.

usage: python3 -I blog/naver/rank_check.py [최근 원고 수, 기본 10]
  blog/naver/posts/*.json 가운데 published 가 있는 최근 원고마다, keyword(없으면 첫 태그)를 네이버 블로그 탭에서 검색해
  결과 30개 안의 순위를 찍고 blog/naver/rank_log.csv 에 (잰 날짜, 원고, logNo, 검색어, 순위(없으면 0), 결과 수) 로 덧붙인다.
"""
import csv, datetime, glob, json, os, re, subprocess, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, 'rank_log.csv')


def get(url):
    return subprocess.run(['curl', '-s', '-m', '20', '-A', 'Mozilla/5.0', url], capture_output=True, text=True).stdout


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d')
    files = sorted(glob.glob(os.path.join(HERE, 'posts', '*.json')))[::-1]
    rows = []
    for f in files:
        d = json.load(open(f, encoding='utf-8'))
        pub = d.get('published') or {}
        m = re.search(r'/(\d{9,})$', pub.get('url', ''))
        if not m:
            continue
        no = m.group(1)
        kw = d.get('keyword') or (d.get('tags') or [''])[0]
        h = get('https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query=' + urllib.parse.quote(kw))
        ids = []
        for x in re.finditer(r'blog\.naver\.com/[A-Za-z0-9_\-]+/(\d{9,})', h):
            if x.group(1) not in ids:
                ids.append(x.group(1))
        rank = ids.index(no) + 1 if no in ids else 0
        rows.append((today, os.path.basename(f)[:-5], no, kw, rank, len(ids)))
        print(f"{rank or '-':>3} / {len(ids)} | {kw} | {os.path.basename(f)[:-5]}")
        if len(rows) >= n:
            break
    new = not os.path.exists(LOG)
    with open(LOG, 'a', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(['checked', 'post', 'logNo', 'keyword', 'rank', 'results'])
        w.writerows(rows)


if __name__ == '__main__':
    main()
