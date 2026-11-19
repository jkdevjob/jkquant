#!/usr/bin/env python3
"""naverpack 원고(blog/naverpack/posts/<날짜_주제>/post.json)를 이 폴더의 직접 발행 형식으로 바꾼다.

usage: python3 -I from_pack.py <pack post.json> <원본 이미지 폴더> <날짜 YYYY-MM-DD> <슬러그>
  -> posts/<날짜>_<슬러그>.json, 이미지는 posts/assets/<날짜>/<슬러그>_01.png …
"""
import html, json, os, re, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def a(url):
    u = html.escape(url, quote=True)
    return f'<a href="{u}">{u}</a>'


def outlets(links):
    # 언론사 이름만, 겹치면 한 번. links 의 'src' 가 있으면 그것을, 없으면 label 의 첫 낱말(예: '중앙일보 황 없이도…' → '중앙일보')
    out = []
    for l in links:
        n = (l.get('src') or l['label'].split()[0]).strip()
        if n and n not in out:
            out.append(n)
    return out


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    src, imgdir, date, slug = sys.argv[1:]
    pk = json.load(open(src, encoding='utf-8'))
    assets = os.path.join(HERE, 'posts', 'assets', date)
    os.makedirs(assets, exist_ok=True)
    blocks, used = [], []
    for b in pk['blocks']:
        if b['type'] == 'paragraph':
            blocks.append({'t': 'p', 'text': b['text']})
            continue
        if b['type'] != 'image':
            sys.exit('unknown block ' + b['type'])
        name = f"{slug}_{os.path.basename(b['file'])}"
        shutil.copyfile(os.path.join(imgdir, os.path.basename(b['file'])), os.path.join(assets, name))
        cap = b['caption'].replace('. 블로그 직접 작성 도표', '').replace(' 블로그 직접 작성 도표', '').strip()
        cap = re.sub(r'^도표:\s*', '', cap)
        links = b.get('links') or []
        # 2026-11-19 사용자 지시("쓸데없는 글 남기지 말고" · "출처 주소 줄 빼고 해"): 썸네일은 사진 설명·제작 표기 없이,
        # 도표는 '도표:' 머리말 없이 설명 한 줄 + 사진 아래 '자료: 언론사 · 언론사' 한 줄만. 주소(URL)는 네이버 글에 넣지 않고
        # 원고(post.json 의 links)에만 남겨 사실 확인 기록으로 쓴다. 메르 글 비교: 출처 줄 0 · 링크 1~6(STRATEGY_LAB H10).
        if b.get('thumb'):
            blocks.append({'t': 'img', 'file': name, 'cap': '', 'attr': []})
            continue
        if not links:
            sys.exit('image without source link: ' + b['file'])
        # 2026-11-20 메르 형식(이미지 8~12장): 사진마다 '자료:' 줄을 달면 같은 줄이 반복되므로 사진 아래는 비우고
        # 글 맨 끝에 '자료: 언론사 · …' 한 줄로 모은다(메르는 뉴스 주소 0 · 사진 아래 줄 없음).
        used += links
        blocks.append({'t': 'img', 'file': name, 'cap': cap, 'attr': []})
    if used:
        blocks.append({'t': 'p', 'text': '자료: ' + ' · '.join(outlets(used))})
    out = {'title': pk['title'], 'blocks': blocks, 'tags': pk['tags'], 'topic': pk.get('topic') or '비즈니스·경제', 'category': pk.get('category') or '', 'priority': pk.get('priority') or 1, 'keyword': pk.get('keyword') or ''}  # keyword: STRATEGY_LAB 순위 추적용 노린 검색어
    dst = os.path.join(HERE, 'posts', f'{date}_{slug}.json')
    if os.path.exists(dst):
        sys.exit('already exists: ' + dst)
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write('\n')
    n_img = sum(1 for b in blocks if b['t'] == 'img')
    print('OK', dst, 'blocks', len(blocks), 'images', n_img, 'assets', assets)


if __name__ == '__main__':
    main()
