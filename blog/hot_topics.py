#!/usr/bin/env python3
"""'사람들이 가장 궁금해할 만한' 경제 이슈 후보를 실제 공개 순위에서 모은다(주제 고르기 1단계).

usage: python3 -I blog/hot_topics.py [--all]
  1) 네이버 뉴스 언론사별 '많이 본 뉴스'(경제지 각 상위 5개) — 사람들이 실제로 많이 클릭한 기사
  2) 네이버 뉴스 '댓글 많은 뉴스' 중 경제 낱말이 든 기사 — 사람들이 할 말이 많은 이슈
  3) 구글 트렌드 한국 급상승 검색어(대략 검색량 포함) — 사람들이 직접 찾아본 낱말
  마지막에 경제 기사 제목의 낱말 빈도를 묶어 보여 준다.
숫자(순위·검색량)는 이 출력에 있는 것만 근거로 쓴다. 지어내지 않는다.
"""
import html, re, sys, urllib.request
from collections import Counter

UA = {'User-Agent': 'Mozilla/5.0 (blog topic research)'}
ECON_PRESS = ['한국경제', '매일경제', '머니투데이', '서울경제', '이데일리', '헤럴드경제', '아시아경제', '파이낸셜뉴스',
              '조선비즈', '비즈워치', 'SBS Biz', '한국경제TV', '매경이코노미', '한경비즈니스', '이코노미스트', '조세일보']
ECON_WORDS = ('금리 환율 코스피 코스닥 증시 주가 주식 유가 원유 반도체 수출 수입 무역 물가 부동산 아파트 집값 전세 대출 '
              '연금 세금 관세 달러 원화 엔화 비트코인 코인 금값 실적 연준 한은 기준금리 국채 채권 엔비디아 삼성전자 하이닉스 '
              '테슬라 애플 AMD 인텔 나스닥 다우 S&P 월가 뉴욕증시 경제 경기침체 경기둔화 고용 실업 소비 투자 펀드 ETF 배당 상장 공모 '
              '은행 보험 카드 월급 임금 최저임금 예산 재정 적자 흑자 GDP 성장률 인플레 부채 가계 기업 매출 영업이익').split()


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        b = r.read()
    m = re.search(rb'charset=["\']?([\w-]+)', b[:5000])
    enc = (m.group(1).decode() if m else 'utf-8').lower()
    try:
        return b.decode('euc-kr' if enc in ('euc-kr', 'ks_c_5601-1987') else enc)
    except UnicodeDecodeError:
        try:
            return b.decode('euc-kr')
        except UnicodeDecodeError:
            return b.decode('utf-8', 'replace')


def is_econ(title):
    return any(w in title for w in ECON_WORDS)


def naver_boxes(url):
    t = get(url)
    out = []
    for box in t.split('class="rankingnews_box"')[1:]:
        m = re.search(r'class="rankingnews_name">([^<]+)<', box)
        if not m:
            continue
        items = re.findall(r'<a href="(https://n\.news\.naver\.com/article/[^"]+)"[^>]*class="list_title[^"]*"[^>]*>([^<]+)</a>', box)
        out.append((html.unescape(m.group(1)).strip(), [(html.unescape(x).strip(), u.split('?')[0]) for u, x in items]))
    return out


def trends():
    t = get('https://trends.google.com/trending/rss?geo=KR')
    res = []
    for it in re.findall(r'<item>(.*?)</item>', t, re.S):
        title = html.unescape(re.search(r'<title>(.*?)</title>', it, re.S).group(1))
        traffic = (re.search(r'<ht:approx_traffic>(.*?)</ht:approx_traffic>', it) or [None, '?'])[1]
        news = [html.unescape(x) for x in re.findall(r'<ht:news_item_title>(.*?)</ht:news_item_title>', it, re.S)]
        res.append((title, traffic, news))
    return res


def main():
    show_all = '--all' in sys.argv
    econ_titles = []
    print('== 1) 네이버 많이 본 뉴스 — 경제지 상위 5개 (집계 시각은 네이버 페이지 기준)')
    try:
        boxes = naver_boxes('https://news.naver.com/main/ranking/popularDay.naver')
        for name, items in boxes:
            if name in ECON_PRESS:
                hits = [(i, x, u) for i, (x, u) in enumerate(items[:5], 1) if show_all or is_econ(x)]
                print(f'[{name}]' + ('' if hits else ' (상위 5개에 경제 낱말 기사 없음)'))
                for i, x, u in hits:
                    print(f'  {i}. {x}  {u}')
                    econ_titles.append(x)
        others = [(n, i, x, u) for n, items in boxes if n not in ECON_PRESS
                  for i, (x, u) in enumerate(items[:5], 1) if is_econ(x)]
        print(f'-- 일반 언론사 상위 5개 중 경제 낱말 기사 {len(others)}건')
        for n, i, x, u in others[: (999 if show_all else 25)]:
            print(f'  [{n} {i}위] {x}  {u}')
            econ_titles.append(x)
    except Exception as e:
        print('  (가져오기 실패:', e, ')')

    print('\n== 2) 네이버 댓글 많은 뉴스 — 경제 낱말 기사')
    try:
        for n, items in naver_boxes('https://news.naver.com/main/ranking/popularMemo.naver'):
            for i, (x, u) in enumerate(items[:5], 1):
                if is_econ(x):
                    print(f'  [{n} {i}위] {x}  {u}')
    except Exception as e:
        print('  (가져오기 실패:', e, ')')

    print('\n== 3) 구글 트렌드 한국 급상승 검색어 (대략 검색량)')
    try:
        for title, traffic, news in trends():
            econ = is_econ(title) or any(is_econ(n) for n in news[:3])
            if econ or show_all:
                print(f"  {'★' if econ else ' '} {title} ({traffic}) — {news[0] if news else ''}")
    except Exception as e:
        print('  (가져오기 실패:', e, ')')

    print('\n== 경제 기사 제목 낱말 빈도(상위 25) — 여러 매체가 같이 다루는 이슈 찾기')
    words = Counter()
    for x in econ_titles:
        for w in set(re.findall(r'[가-힣A-Za-z0-9&]{2,}', x)):
            words[w] += 1
    print('  ' + ', '.join(f'{w} {c}' for w, c in words.most_common(25)))


if __name__ == '__main__':
    main()
