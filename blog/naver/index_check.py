#!/usr/bin/env python3
"""네이버 블로그 검색에 우리 글이 뜨는지(색인) 매일 잰다 — blog/STRATEGY_LAB.md 의 첫 지표.

usage: python3 -I blog/naver/index_check.py [글 수, 기본 30]
  글 목록(PostTitleListAsync)의 글마다 제목을 그대로 네이버 블로그 탭에서 검색해, 결과 안에 그 글 번호(logNo)가 있는지 본다.
  결과는 화면에 찍고 blog/naver/index_log.csv 에 (잰 날짜, logNo, 올린 날, 검색됨 0/1, 제목) 으로 덧붙인다.
  제목 그대로 검색해도 안 나오면 '검색 누락'으로 본다(순위가 낮은 것과 다르다).
"""
import csv, datetime, html, os, re, subprocess, sys, urllib.parse

BLOG = 'maniacjk'
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, 'index_log.csv')


def get(url):
    return subprocess.run(['curl', '-s', '-m', '20', '-A', 'Mozilla/5.0', url], capture_output=True, text=True).stdout


def posts(n):
    t = get(f'https://blog.naver.com/PostTitleListAsync.naver?blogId={BLOG}&currentPage=1&categoryNo=0&countPerPage={n}')
    out = []
    for m in re.finditer(r'"logNo":"(\d+)".*?"title":"(.*?)".*?"addDate":"(.*?)"', t):
        title = html.unescape(urllib.parse.unquote_plus(m.group(2)))
        out.append((m.group(1), m.group(3), title))
    return out


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).strftime('%Y-%m-%d')
    rows = []
    for no, added, title in posts(n):
        q = re.sub(r'\s+', ' ', re.sub(r"[^\w가-힣\s%.]", ' ', title)).strip()
        h = get('https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query=' + urllib.parse.quote(q))
        found = 1 if no in h else 0
        rows.append((today, no, added, found, title))
        print(f"{'O' if found else 'X'} | {added} | {no} | {title[:44]}")
    ok = sum(r[3] for r in rows)
    print(f'검색됨 {ok}/{len(rows)}')
    new = not os.path.exists(LOG)
    with open(LOG, 'a', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if new:
            w.writerow(['checked', 'logNo', 'added', 'found', 'title'])
        w.writerows(rows)


if __name__ == '__main__':
    main()
