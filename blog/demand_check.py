#!/usr/bin/env python3
"""블로그 주제 후보의 '찾는 사람'과 '경쟁'을 같이 잰다 — 은퇴노트·매니악 블로거 주제 고르기용(2026-11-13).

usage: python3 -I blog/demand_check.py "국민연금 추납" "건강보험료 피부양자" ...
  후보 검색어마다
   - 구글 자동완성 수(블로거는 구글 검색으로 들어온다)·네이버 자동완성 수: 많을수록 실제로 치는 사람이 많다는 신호
   - 최근 7일 뉴스(네이버 뉴스 1주 검색 첫 쪽 기사 수, 최대 10): 지금 관심이 몰리는지
   - 블로그 경쟁(네이버 블로그 탭 상위 10개 중 30일 넘은 글 수): 많을수록 새 글이 끼어들 틈이 있다
  를 표로 보여 준다. 검색량 숫자를 지어내지 않는다 — 자동완성·기사 수는 '신호'일 뿐이다.
"""
import json, re, subprocess, sys, urllib.parse


def get(url):
    return subprocess.run(['curl', '-s', '-m', '15', '-A', 'Mozilla/5.0', url], capture_output=True, text=True).stdout


def google_ac(q):
    try:
        d = json.loads(get('https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&q=' + urllib.parse.quote(q)))
        return d[1]
    except Exception:
        return []


def naver_ac(q):
    try:
        d = json.loads(get('https://ac.search.naver.com/nx/ac?con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0'
                           '&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100&q=' + urllib.parse.quote(q)))
        return [x[0] for x in (d.get('items') or [[]])[0]]
    except Exception:
        return []


def news_week(q):
    t = get('https://search.naver.com/search.naver?where=news&sort=0&pd=1&query=' + urllib.parse.quote(q))
    return len(set(re.findall(r'https://n\.news\.naver\.com/mnews/article/\d+/\d+', t)))


def blog_old(q):
    t = get('https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query=' + urllib.parse.quote(q))
    dates = re.findall(r'(\d+(?:시간|분|일) 전|\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.)', t)[:10]
    old = 0
    for d in dates:
        m = re.match(r'(\d+)일 전', d)
        if re.match(r'\d{4}\.', d) or (m and int(m.group(1)) > 30):
            old += 1
    return old, len(dates)


def main():
    qs = sys.argv[1:]
    if not qs:
        sys.exit(__doc__)
    print(f"{'검색어':<22} 구글AC 네이버AC 7일뉴스 블로그30일+ | 구글 자동완성 예")
    for q in qs:
        g, n = google_ac(q), naver_ac(q)
        nw = news_week(q)
        old, tot = blog_old(q)
        print(f"{q:<22} {len(g):>5} {len(n):>7} {nw:>7} {old:>6}/{tot:<3} | {', '.join(g[:4])}")


if __name__ == '__main__':
    main()
