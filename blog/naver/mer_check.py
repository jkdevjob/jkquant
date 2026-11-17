#!/usr/bin/env python3
"""참고 블로그(메르, blog.naver.com/ranto28)를 매일 읽어 주제 고르기에 쓴다.

사용자 지시 2026-11-13 "이 블로그 참고해 여기가 주제선정을 잘하네", 2026-11-18 "매일 메르 블로그 참고해서 분석해".
글 내용은 베끼지 않는다 — 제목·시각·주제 흐름만 본다(GUIDE 1장 '참고 블로그').

usage: python3 -I blog/naver/mer_check.py [최근 글 수, 기본 30]
  1) 최근 글 목록(제목·올린 시각)과 처음 본 글을 blog/naver/mer_log.csv 에 쌓는다.
  2) 제목 형식 통계: 물음표 · '(feat …)' · '비밀' · 후속(A/S) · 국장/미장/이번주 · 평균 글자 수.
  3) 최근 이틀 글 가운데 우리 블로그(maniacjk)가 같은 이슈를 다뤘는지 낱말이 겹치는지로 표시한다.
  4) 색인 대조군: 그 블로그 최근 3개 글을 제목 그대로 검색해 바로 뜨는지 본다(우리 index_check 와 같은 방식).
"""
import csv, datetime, html, os, re, subprocess, sys, urllib.parse

REF = 'ranto28'
OURS = 'maniacjk'
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, 'mer_log.csv')
KST = datetime.timezone(datetime.timedelta(hours=9))
STOP = set('있다 없다 이번 오늘 어제 내일 우리 무엇 누가 이유 비밀 정말 과연 feat A/S 이번주 한가지 봐야할 있다면'.split())


def get(url):
    return subprocess.run(['curl', '-s', '-m', '20', '-A', 'Mozilla/5.0', url], capture_output=True, text=True).stdout


def posts(blog, n):
    t = get(f'https://blog.naver.com/PostTitleListAsync.naver?blogId={blog}&currentPage=1&categoryNo=0&countPerPage={n}')
    out = []
    for m in re.finditer(r'"logNo":"(\d+)".*?"title":"(.*?)".*?"addDate":"(.*?)"', t):
        out.append((m.group(1), html.unescape(urllib.parse.unquote_plus(m.group(3))), html.unescape(urllib.parse.unquote_plus(m.group(2)))))
    return out


def words(title):
    w = re.findall(r'[가-힣A-Za-z]{2,}', re.sub(r'\(feat.*?\)', ' ', title))
    return {x for x in w if x not in STOP}


def recent(added):
    # '57분 전'·'8시간 전' 처럼 상대 시각이면 오늘, 'YYYY. M. D.' 면 그 날짜
    if '전' in added:
        return 0
    m = re.match(r'(\d{4})\. (\d+)\. (\d+)\.', added)
    if not m:
        return 99
    d = datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (datetime.datetime.now(KST).date() - d).days


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    now = datetime.datetime.now(KST).strftime('%Y-%m-%d %H:%M')
    ref = posts(REF, n)
    seen = set()
    if os.path.exists(LOG):
        with open(LOG, encoding='utf-8') as f:
            seen = {r['logNo'] for r in csv.DictReader(f)}
    new = [p for p in ref if p[0] not in seen]
    with open(LOG, 'a', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        if not seen:
            w.writerow(['first_seen', 'logNo', 'added', 'title'])
        w.writerows([(now, *p) for p in new])

    print(f'== 메르 최근 글 {len(ref)}개 (새로 본 글 {len(new)}개, 기록 {os.path.relpath(LOG)})')
    ours = posts(OURS, 15)
    ourw = [(t, words(t)) for _, _, t in ours]
    for no, added, title in ref:
        if recent(added) > 2:
            continue
        hit = [t for t, ws in ourw if len(words(title) & ws) >= 2]
        mark = f"  ← 우리도 다룸: {hit[0][:30]}" if hit else ''
        print(f'  {added:>13} | {title[:60]}{mark}')

    t = [p[2] for p in ref]
    k = lambda pat: sum(1 for x in t if re.search(pat, x))
    print(f'== 제목 형식(최근 {len(t)}개): 물음표 {k(r"[?？]")} · (feat) {k(r"feat")} · 비밀 {k("비밀")} · A/S {k("A/S")} · '
          f'국장/미장/이번주 {k("국장|미장|이번주")} · 평균 {sum(len(x) for x in t) // max(len(t), 1)}자')

    print('== 색인 대조군(제목 그대로 검색)')
    for no, added, title in ref[:3]:
        q = re.sub(r'\s+', ' ', re.sub(r"[^\w가-힣\s%.]", ' ', title)).strip()
        h = get('https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query=' + urllib.parse.quote(q))
        print(f"  {'O' if no in h else 'X'} | {added} | {title[:50]}")


if __name__ == '__main__':
    main()
