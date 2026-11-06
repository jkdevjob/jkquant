#!/usr/bin/env python3
"""네이버 블로그(maniacjk) 공개 통계를 하루 한 줄씩 기록한다: 누적 방문자·구독자·글 수.

usage: python3 -I blog/naver/stats.py          → blog/naver/stats.csv 에 한 줄 추가(같은 날짜면 갱신)하고 최근 7줄을 보여 준다.
누적 방문자 차이로 하루 방문자를 계산한다(공개 '오늘 방문자'는 아침에는 거의 0이라 쓰지 않는다).
"""
import csv, datetime, json, os, re, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, 'stats.csv')
UA = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://m.blog.naver.com/maniacjk'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return r.read().decode('utf-8', 'replace')


def main():
    info = json.loads(get('https://m.blog.naver.com/api/blogs/maniacjk'))['result']
    lst = get('https://blog.naver.com/PostTitleListAsync.naver?blogId=maniacjk&currentPage=1&categoryNo=0&countPerPage=5')
    posts = int((re.findall(r'"totalCount":"?(\d+)', lst) or ['0'])[0])
    now = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=9)
    row = {'date': now.strftime('%Y-%m-%d'), 'time_kst': now.strftime('%H:%M'),
           'total_visitors': info.get('totalVisitorCount'), 'subscribers': info.get('subscriberCount'), 'posts': posts}
    rows = []
    if os.path.exists(CSV):
        with open(CSV, encoding='utf-8') as f:
            rows = [r for r in csv.DictReader(f) if r['date'] != row['date']]
    rows.append({k: str(v) for k, v in row.items()})
    rows.sort(key=lambda r: r['date'])
    with open(CSV, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(row))
        w.writeheader(); w.writerows(rows)
    prev = None
    for r in rows[-8:]:
        diff = '' if prev is None else f"  (+{int(r['total_visitors']) - int(prev['total_visitors'])}명)"
        if prev is not None or len(rows) <= 8:
            print(f"{r['date']} {r['time_kst']}  누적 방문자 {r['total_visitors']}{diff}  구독자 {r['subscribers']}  글 {r['posts']}")
        prev = r


if __name__ == '__main__':
    main()
