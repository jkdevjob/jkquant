#!/usr/bin/env python3
"""네이버 원고가 출처 기사 문장과 얼마나 겹치는지 잰다 — '뉴스와 중복되는 기사성 게시글' 점검.

근거(2026-11-20 사용자가 보낸 네이버 검색 고객센터 「블로그 검색 제한 기준 안내」):
  '내 게시물이 갑자기 미노출되는 경우 — (1) 뉴스와 중복되는 기사성 게시글 또는 단순 홍보성 게시글 …
   (3) 기계 생성으로 의심되는 게시물'.

usage: python3 -I blog/naverpack/news_overlap.py <pack 폴더 또는 post.json>
  post.json 의 이미지 links(출처 기사 주소)를 받아 본문만 뽑고, 원고의 번호 줄마다
  글자 5-gram 이 기사들과 겹치는 비율을 잰다. 줄별 최댓값이 50% 이상이면 '기사 문장과 겹침'.
  결과: 겹치는 줄 수/비율 · 원고 전체 5-gram 중 기사에도 있는 비율 · 가장 많이 겹친 줄 5개.
  기사 본문은 저장하지 않는다(메모리에서만 비교).
"""
import html, json, os, re, subprocess, sys


def article_text(url):
    t = subprocess.run(['curl', '-s', '-m', '20', '-A', 'Mozilla/5.0', url], capture_output=True, text=True).stdout
    m = re.search(r'<article id="dic_area"[^>]*>(.*?)</article>', t, re.S)
    if not m:
        return ''
    b = re.sub(r'<[^>]+>', ' ', m.group(1))
    return re.sub(r'\s+', '', html.unescape(b))


def grams(s, n=5):
    s = re.sub(r'\s+', '', s)
    return {s[i:i + n] for i in range(len(s) - n + 1)}


def main():
    p = sys.argv[1]
    if os.path.isdir(p):
        p = os.path.join(p, 'post.json')
    d = json.load(open(p, encoding='utf-8'))
    urls = []
    for b in d['blocks']:
        for l in b.get('links') or []:
            if l['url'] not in urls:
                urls.append(l['url'])
    pool = set()
    got = 0
    for u in urls:
        t = article_text(u)
        if t:
            got += 1
            pool |= grams(t)
    lines = [re.sub(r'^\d+\.\s*', '', b['text']) for b in d['blocks']
             if b.get('type') == 'paragraph' and re.match(r'^\d+\.\s', b['text'])]
    rows = []
    allg, hit = 0, 0
    for x in lines:
        g = grams(x)
        if not g:
            continue
        h = len(g & pool)
        allg += len(g)
        hit += h
        rows.append((h / len(g), x))
    over = [r for r in rows if r[0] >= 0.5]
    print(f'기사 {got}/{len(urls)}개 비교 · 번호 줄 {len(rows)}개')
    print(f'기사 문장과 겹친 줄(5-gram 50% 이상): {len(over)}개 ({len(over) * 100 // max(len(rows), 1)}%)')
    print(f'원고 전체 5-gram 중 기사에도 있는 비율: {hit * 100 // max(allg, 1)}%')
    for r, x in sorted(rows, reverse=True)[:5]:
        print(f'  {int(r * 100):>3}% | {x[:60]}')


if __name__ == '__main__':
    main()
