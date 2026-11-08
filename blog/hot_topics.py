#!/usr/bin/env python3
"""어제 '사람들이 가장 궁금해한' 이슈를 분야 제한 없이 실제 공개 순위에서 모은다(주제 고르기 1단계).

usage: python3 -I blog/hot_topics.py [--econ]
  1) 네이버 '많이 본 뉴스'(언론사 80여 곳 × 상위 5개)에서 여러 언론사에 겹친 이슈(낱말 묶음) 순위
  2) 네이버 '댓글 많은 뉴스'에서 겹친 이슈 순위 — 사람들이 할 말이 많은 이슈
  3) 구글 트렌드 한국 급상승 검색어(대략 검색량)
  '언론사 수'가 많을수록 어제 가장 뜨거웠던 이슈다. 사건·사고(사망·범죄 등)는 [주의] 표시: 피해자·사생활·추측을 다루지 않는다.
  --econ 을 주면 예전처럼 경제 낱말이 든 기사만 따로 보여 준다.
  ★ 표시 = 경제·비즈니스가 아닌 분야도 쓸 수 있는 '정말 핫이슈' 크기(사용자 지시 2026-11-09, GUIDE 1장):
    '많이 본 뉴스' 언론사 12곳 이상, 또는 구글 트렌드 5,000+ 이상. 자동완성 검색어(keywords.py)까지 있어야 쓴다.
숫자(순위·언론사 수·검색량)는 이 출력에 있는 것만 근거로 쓴다. 지어내지 않는다.
"""
import html, re, sys, urllib.request
from collections import Counter, defaultdict

UA = {'User-Agent': 'Mozilla/5.0 (blog topic research)'}
HOT_PRESS, HOT_TRAFFIC = 12, 5000  # ★ 기준(사용자 지시 2026-11-09): 경제 밖 분야는 이 크기 이상만
SENSITIVE = '사망 숨져 숨진 숨졌 살해 살인 흉기 피살 성폭 성범죄 자살 극단 투신 실종 시신 학대 폭행 참사 유족'.split()
STOP = set('''속보 단독 종합 영상 사진 포토 자막뉴스 현장 오늘 어제 내일 이번 지난 올해 내년 이후 이전 관련 위해 대한 통해 때문 정도 가장 모두 다시
 결국 무슨 일이 왜 이유 이게 그냥 진짜 만에 만원 억원 조원 달러 대해 발표 공개 논란 확인 사실 전망 분석 우려 기대 가능성 상황 문제 여부 이상 이하
 하는 하고 했다 한다 있다 없다 된다 됐다 위한 대로 까지 부터 에서 으로 에게 the and 기자 뉴스 보도 입장 발언 주장 이날 당시 최대 최고 최초 역대
 하루 이제 나왔다 되나 아냐 어디 뛰었다 직격 놓고 제안 정부 국민 시대 직접 결정 공개 사람 생각 지금 정말 이렇게 그런데 하지만
 20대 30대 40대 50대 60대 70대 80대 여성 남성 남편 아내 아들 엄마 아빠 1만 2만 3만 10만 100만 서울 한국'''.split())
ECON_WORDS = ('금리 환율 코스피 코스닥 증시 주가 주식 유가 원유 반도체 수출 물가 부동산 아파트 집값 전세 대출 연금 세금 관세 달러 비트코인 '
              '금값 실적 연준 한은 국채 경제 고용 소비 투자 ETF 배당 은행 보험 월급 임금 예산 재정 GDP 성장률').split()


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        b = r.read()
    for enc in ('utf-8', 'euc-kr', 'cp949'):
        try:
            return b.decode(enc)
        except UnicodeDecodeError:
            pass
    return b.decode('utf-8', 'replace')


def naver_boxes(url):
    t = get(url)
    out = []
    for box in t.split('class="rankingnews_box"')[1:]:
        m = re.search(r'class="rankingnews_name">([^<]+)<', box)
        if not m:
            continue
        items = re.findall(r'<a href="(https://n\.news\.naver\.com/article/[^"]+)"[^>]*class="list_title[^"]*"[^>]*>([^<]+)</a>', box)
        out.append((html.unescape(m.group(1)).strip(), [(html.unescape(x).strip(), u.split('?')[0]) for u, x in items[:5]]))
    return out


def tokens(title):
    t = re.sub(r'\[[^\]]*\]', ' ', title)
    ws = set()
    for w in re.findall(r'[가-힣A-Za-z0-9·]{2,}', t):
        w = re.sub(r'(은|는|을|를|의|에|와|과|도|으로|에서|까지|부터|이다|했다|한다|라며|라고|이란)$', '', w)
        if len(w) >= 2 and w not in STOP and not w.isdigit():
            ws.add(w)
    return ws


def clusters(boxes, top=12):
    """같은 이슈의 낱말을 한 묶음으로. 점수 = 대표 낱말이 들어간 기사를 상위 5개에 올린 서로 다른 언론사 수(합집합으로 부풀리지 않음)."""
    items_by_tok = defaultdict(set)
    meta = {}
    for name, items in boxes:
        for rank, (title, url) in enumerate(items, 1):
            key = (name, title)
            meta[key] = (rank, name, title, url)
            for w in tokens(title):
                items_by_tok[w].add(key)
    ranked = sorted(items_by_tok.items(), key=lambda kv: (-len({k[0] for k in kv[1]}), kv[0]))
    groups = []
    for w, its in ranked:
        if len({k[0] for k in its}) < 2:
            break
        for g in groups:
            ov = len(its & g['items'])
            if ov / len(its) >= 0.6 and ov / len(g['items']) >= 0.3:
                g['labels'].append(w)
                break
        else:
            groups.append({'labels': [w], 'items': set(its)})
    out = [(' · '.join(g['labels'][:4]), len({k[0] for k in g['items']}), sorted(meta[k] for k in g['items'])) for g in groups]
    out.sort(key=lambda x: -x[1])
    return out[:top]


def flag(title):
    return ' [주의:사건·사고]' if any(s in title for s in SENSITIVE) else ''


def print_clusters(label, boxes, star=False):
    print(f'== {label} — 여러 언론사 상위 5개에 겹친 이슈(언론사 수 순)')
    for w, n, hs in clusters(boxes):
        mark = f'  ★{HOT_PRESS}곳+ (경제 밖 분야도 가능)' if star and n >= HOT_PRESS else ''
        print(f'  ◆ {w}  (언론사 {n}곳){mark}')
        for rank, name, title, url in hs[:3]:
            print(f'     - [{name} {rank}위] {title}{flag(title)}  {url}')


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
    econ = '--econ' in sys.argv
    try:
        pop = naver_boxes('https://news.naver.com/main/ranking/popularDay.naver')
        print_clusters('1) 네이버 많이 본 뉴스', pop, star=True)
    except Exception as e:
        pop = []
        print('  (많이 본 뉴스 가져오기 실패:', e, ')')
    print()
    try:
        memo = naver_boxes('https://news.naver.com/main/ranking/popularMemo.naver')
        print_clusters('2) 네이버 댓글 많은 뉴스', memo)
    except Exception as e:
        print('  (댓글 많은 뉴스 가져오기 실패:', e, ')')
    print('\n== 3) 구글 트렌드 한국 급상승 검색어 (대략 검색량)')
    try:
        for title, traffic, news in trends()[:20]:
            n0 = news[0] if news else ''
            vol = int(re.sub(r'\D', '', traffic) or 0)
            mark = f'  ★{HOT_TRAFFIC}+ (경제 밖 분야도 가능)' if vol >= HOT_TRAFFIC else ''
            print(f'  - {title} ({traffic}) — {n0}{flag(n0)}{mark}')
    except Exception as e:
        print('  (가져오기 실패:', e, ')')
    if econ and pop:
        print('\n== (참고) 경제 낱말 기사')
        for name, items in pop:
            for i, (x, u) in enumerate(items, 1):
                if any(w in x for w in ECON_WORDS):
                    print(f'  [{name} {i}위] {x}  {u}')


if __name__ == '__main__':
    main()
