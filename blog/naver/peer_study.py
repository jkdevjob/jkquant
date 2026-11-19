#!/usr/bin/env python3
"""잘나가는 네이버 블로그와 우리 블로그를 숫자로 비교한다 — '왜 검색되고 왜 조회수가 나오는가' 연구용.

사용자 지시 2026-11-19: "메르나 잘나가는 블로그 참고 분석 연구해서 개선 좀 하라고 / 왜 검색이 되는지 왜 조회수가 잘 나오는지 연구해".
글 내용은 저장·인용하지 않는다 — 공개된 숫자(이웃 수·방문자·공감)와 글 모양(글자 수·이미지·링크·번호 줄 수)만 센다.

usage: python3 -I blog/naver/peer_study.py [검색어 …]
  검색어를 안 주면 우리 최근 원고의 keyword + 기본 경제·이슈 검색어를 쓴다.
  1) 검색어마다 네이버 블로그 탭 상위 5개와 통합검색에 뜬 블로그 글 상위 5개를 모은다.
  2) 그 글의 모양(글자 수·이미지·동영상·외부 링크·'출처:' 줄·번호 줄·인용·표)과 공감 수·작성 후 지난 날을 잰다.
  3) 그 블로그의 이웃 수·하루 방문자(최근 4일 평균)·누적 방문자·최근 30개 글의 하루 글 수·몰아 올리기(10분 안 연속)·
     카테고리 집중도·평균 공감·검색 허용·외부 공유 허용을 잰다.
  4) 우리(maniacjk)와 메르(ranto28)를 같은 방식으로 재서 나란히 찍고, blog/naver/peer_study/<날짜>_{posts,blogs}.csv 로 남긴다.
"""
import csv, datetime, glob, html, json, os, re, statistics, subprocess, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'peer_study')
KST = datetime.timezone(datetime.timedelta(hours=9))
UA_M = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
OURS, MER = 'maniacjk', 'ranto28'
BASE_Q = ['엔비디아 실적', '코스피 5000', '한국은행 기준금리', '에너지바우처', '정년 65세 연장', '담뱃값 인상',
          '종부세 공제', '레버리지 ETF', '서킷브레이커', '한중정상회담']


def get(url, ref=None, ua='Mozilla/5.0'):
    cmd = ['curl', '-s', '-m', '20', '-A', ua]
    if ref:
        cmd += ['-H', 'Referer: ' + ref]
    time.sleep(0.35)
    return subprocess.run(cmd + [url], capture_output=True, text=True).stdout


def jget(url, ref):
    try:
        return json.loads(get(url, ref, UA_M))
    except Exception:
        return {}


def search(q):
    """(블로그 탭 상위 5, 통합검색 블로그 상위 5, 통합검색 인플루언서 글 수)"""
    def ids(h, k):
        out = []
        for m in re.finditer(r'blog\.naver\.com/([A-Za-z0-9_\-]+)/(\d{9,})', h):
            if m.groups() not in out:
                out.append(m.groups())
        return out[:k]
    qq = urllib.parse.quote(q)
    tab = ids(get('https://search.naver.com/search.naver?ssc=tab.blog.all&where=blog&query=' + qq), 5)
    h = get('https://search.naver.com/search.naver?where=nexearch&query=' + qq)
    infl = len(set(re.findall(r'in\.naver\.com/[A-Za-z0-9_\-]+/contents/internal/\d+', h)))
    return tab, ids(h, 5), infl


def layout(blog, no):
    t = get(f'https://blog.naver.com/PostView.naver?blogId={blog}&logNo={no}')
    i = t.find('se-main-container')
    if i < 0:
        return {'editor': 'old'}
    s = t[i:]
    e = s.find('post_footer')
    s = s[:e] if e > 0 else s
    comp = lambda c: len(re.findall(r'class="se-component se-' + c + r'\b', s))
    lines = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', x))).strip()
             for x in re.findall(r'<p class="se-text-paragraph[^"]*"[^>]*>(.*?)</p>', s, re.S)]
    lines = [x for x in lines if x and x != '​']
    hrefs = re.findall(r'<a [^>]*href="(https?://[^"]+)"', s)
    ext = [u for u in hrefs if not re.match(r'https?://(m\.)?blog\.naver\.com/' + blog, u)]
    return {
        'editor': 'se4',
        'chars': sum(len(x.replace(' ', '')) for x in lines),
        'lines': len(lines),
        'num_lines': sum(1 for x in lines if re.match(r'^\d+\.\s', x)),
        'imgs': len(re.findall(r'se-image-resource', s)),
        'videos': comp('video') + comp('oembed'),
        'ext_links': len(ext),
        'news_links': sum(1 for u in ext if 'news.naver.com' in u or 'n.news' in u),
        'src_lines': sum(1 for x in lines if re.match(r'^(출처|자료|사진|이미지)\s*[:：]', x)),
        'quotes': comp('quotation'),
        'tables': comp('table'),
        'stickers': comp('sticker'),
        'oglinks': comp('oglink'),
    }


def post_meta(blog, no):
    r = jget(f'https://m.blog.naver.com/api/blogs/{blog}/posts/{no}/sympathy-users?itemCount=1',
             f'https://m.blog.naver.com/{blog}/{no}').get('result') or {}
    add = r.get('postAddDate')
    days = round((time.time() * 1000 - add) / 86400000, 1) if add else ''
    return {'title': r.get('postTitle', ''), 'sympathy': r.get('totalCount', ''), 'days_old': days}


def blog_meta(blog):
    ref = f'https://m.blog.naver.com/{blog}'
    b = jget(f'https://m.blog.naver.com/api/blogs/{blog}', ref).get('result') or {}
    v = [int(x) for x in re.findall(r'cnt="(\d+)"', get(f'https://blog.naver.com/NVisitorgp4Ajax.naver?blogId={blog}'))]
    items = (jget(f'https://m.blog.naver.com/api/blogs/{blog}/post-list?categoryNo=0&itemCount=30&page=1', ref).get('result') or {}).get('items') or []
    ts = sorted((it['addDate'] for it in items), reverse=True)
    span = (ts[0] - ts[-1]) / 86400000 if len(ts) > 1 else 0
    gaps = [(a - b_) / 60000 for a, b_ in zip(ts, ts[1:])]
    cats = [it.get('categoryName') for it in items]
    top = max(set(cats), key=cats.count) if cats else ''
    avg = lambda k: round(statistics.mean(it.get(k) or 0 for it in items), 1) if items else ''
    share = lambda k: round(sum(1 for it in items if it.get(k)) / len(items), 2) if items else ''
    return {
        'blog': blog, 'name': b.get('blogName', ''), 'subscribers': b.get('subscriberCount', ''),
        # 마지막 값은 오늘(진행 중)이라 뺀다. 방문자 그래프를 숨긴 블로그는 오늘 값(dayVisitorCount)만 쓴다
        'visitors_day': round(statistics.mean(v[:-1])) if len(v) > 1 else b.get('dayVisitorCount', ''),
        'visitors_total': b.get('totalVisitorCount', ''), 'power': b.get('powerBlog', ''), 'official': b.get('officialBlog', ''),
        # 네이버 메이트(AI 브리핑 인용 중심 선정) · 이번 달 AI 브리핑 인용 수 · 블로그 주제 · blogNo(작을수록 먼저 만든 블로그)
        'mate': b.get('isNaverMateBlog', ''), 'mate_cites_month': (re.search(r"currentMonthCount': (\d+)", str(b.get('mateCitations') or '')) or [None, ''])[1],
        'directory': b.get('blogDirectoryName', ''), 'blogNo': b.get('blogNo', ''),
        'posts_per_day': round(len(ts) / span, 2) if span else '', 'bursts_10min': sum(1 for g in gaps if g < 10),
        'top_cat': top, 'top_cat_share': round(cats.count(top) / len(cats), 2) if cats else '',
        'avg_sympathy': avg('sympathyCnt'), 'avg_comments': avg('commentCnt'), 'avg_imgs': avg('thumbnailCount'),
        'search_allow': share('searchYn'), 'outside_allow': share('outSideAllow'),
        'recent': [(it['logNo'], it['titleWithInspectMessage']) for it in items[:10]],
    }


def med(rows, k):
    xs = [r[k] for r in rows if isinstance(r.get(k), (int, float)) and r.get(k) != '']
    return statistics.median(xs) if xs else '-'


def main():
    qs = sys.argv[1:]
    if not qs:
        kws = []
        for f in sorted(glob.glob(os.path.join(HERE, 'posts', '*.json')))[::-1]:
            k = json.load(open(f, encoding='utf-8')).get('keyword')
            if k and k not in kws:
                kws.append(k)
        qs = kws[:4] + [q for q in BASE_Q if q not in kws]
    today = datetime.datetime.now(KST).strftime('%Y-%m-%d')
    os.makedirs(OUT, exist_ok=True)
    posts, seen, blogs = [], set(), {}
    for q in qs:
        tab, top, infl = search(q)
        print(f'[{q}] 블로그탭 {len(tab)} · 통합 {len(top)} · 인플루언서 글 {infl}', flush=True)
        for src, lst in (('tab', tab), ('main', top)):
            for rank, (b, no) in enumerate(lst, 1):
                row = {'query': q, 'src': src, 'rank': rank, 'blog': b, 'logNo': no}
                if (b, no) not in seen:
                    seen.add((b, no))
                    row.update(post_meta(b, no))
                    row.update(layout(b, no))
                    words = [w for w in re.findall(r'[가-힣A-Za-z0-9]+', q)]
                    row['title_len'] = len(row.get('title', ''))
                    row['kw_all_in_title'] = all(w.lower() in row.get('title', '').lower() for w in words)
                    row['kw_front'] = row.get('title', '').lower().find(words[0].lower()) if words else -1
                posts.append(row)
                blogs.setdefault(b, None)
    for b in [OURS, MER]:
        blogs.setdefault(b, None)
    for b in blogs:
        blogs[b] = blog_meta(b)
    # 우리·메르의 최근 글 5개도 같은 모양 재기
    for b in (OURS, MER):
        for no, _t in blogs[b]['recent'][:5]:
            row = {'query': '(self)', 'src': 'self', 'rank': '', 'blog': b, 'logNo': str(no)}
            row.update(post_meta(b, no))
            row.update(layout(b, no))
            row['title_len'] = len(row.get('title', ''))
            posts.append(row)

    pk = ['query', 'src', 'rank', 'blog', 'logNo', 'title', 'title_len', 'kw_all_in_title', 'kw_front', 'days_old', 'sympathy',
          'editor', 'chars', 'lines', 'num_lines', 'imgs', 'videos', 'ext_links', 'news_links', 'src_lines', 'quotes', 'tables',
          'stickers', 'oglinks']
    with open(os.path.join(OUT, f'{today}_posts.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, pk, extrasaction='ignore')
        w.writeheader()
        w.writerows(posts)
    bk = ['blog', 'name', 'subscribers', 'visitors_day', 'visitors_total', 'power', 'official', 'mate', 'mate_cites_month', 'directory', 'blogNo', 'posts_per_day', 'bursts_10min',
          'top_cat', 'top_cat_share', 'avg_sympathy', 'avg_comments', 'avg_imgs', 'search_allow', 'outside_allow']
    with open(os.path.join(OUT, f'{today}_blogs.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, bk, extrasaction='ignore')
        w.writeheader()
        w.writerows(blogs.values())

    ranked = [p for p in posts if p['src'] in ('tab', 'main') and p.get('editor') == 'se4' and 'chars' in p]
    ours = [p for p in posts if p['src'] == 'self' and p['blog'] == OURS and 'chars' in p]
    mer = [p for p in posts if p['src'] == 'self' and p['blog'] == MER and 'chars' in p]
    print(f'\n== 글 모양 중앙값: 상위 글 {len(ranked)}개 / 메르 {len(mer)} / 우리 {len(ours)}')
    for k in ['chars', 'lines', 'num_lines', 'imgs', 'videos', 'ext_links', 'src_lines', 'quotes', 'tables', 'stickers', 'title_len', 'days_old', 'sympathy']:
        print(f'  {k:>10}: {med(ranked, k)!s:>7} | {med(mer, k)!s:>7} | {med(ours, k)!s:>7}')
    tw = [p for p in ranked if 'kw_all_in_title' in p]
    if tw:
        print(f"  검색어 낱말이 제목에 다 있음 {sum(p['kw_all_in_title'] for p in tw)}/{len(tw)} · 제목 앞 10자 안 {sum(1 for p in tw if 0 <= p['kw_front'] < 10)}/{len(tw)}")
    rb = [blogs[b] for b in blogs if b not in (OURS, MER)]
    print(f'\n== 블로그 중앙값: 상위 블로그 {len(rb)}개 / 메르 / 우리')
    for k in ['subscribers', 'visitors_day', 'visitors_total', 'posts_per_day', 'bursts_10min', 'top_cat_share', 'avg_sympathy', 'avg_comments', 'avg_imgs', 'search_allow', 'outside_allow']:
        print(f"  {k:>14}: {med(rb, k)!s:>9} | {blogs[MER].get(k)!s:>9} | {blogs[OURS].get(k)!s:>9}")
    print(f'\n저장: {os.path.relpath(OUT)}/{today}_posts.csv · _blogs.csv')


if __name__ == '__main__':
    main()
