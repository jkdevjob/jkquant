#!/usr/bin/env python3
"""naverpack 원고(blog/naverpack/posts/<날짜_주제>/post.json)를 이 폴더의 직접 발행 형식으로 바꾼다.

usage: python3 -I from_pack.py <pack post.json> <원본 이미지 폴더> <날짜 YYYY-MM-DD> <슬러그>
  -> posts/<날짜>_<슬러그>.json, 이미지는 posts/assets/<날짜>/<슬러그>_01.png …
"""
import html, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def a(url):
    u = html.escape(url, quote=True)
    return f'<a href="{u}">{u}</a>'


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    src, imgdir, date, slug = sys.argv[1:]
    pk = json.load(open(src, encoding='utf-8'))
    assets = os.path.join(HERE, 'posts', 'assets', date)
    os.makedirs(assets, exist_ok=True)
    blocks = []
    for b in pk['blocks']:
        if b['type'] == 'paragraph':
            blocks.append({'t': 'p', 'text': b['text']})
            continue
        if b['type'] != 'image':
            sys.exit('unknown block ' + b['type'])
        name = f"{slug}_{os.path.basename(b['file'])}"
        shutil.copyfile(os.path.join(imgdir, os.path.basename(b['file'])), os.path.join(assets, name))
        cap = b['caption'].replace('. 블로그 직접 작성 도표', '').replace(' 블로그 직접 작성 도표', '').strip()
        links = b.get('links') or []
        if not links:
            sys.exit('image without source link: ' + b['file'])
        attr = ['사진: 블로그 직접 작성 도표 / 출처: ' + a(links[0]['url'])]
        attr += ['출처: ' + a(l['url']) for l in links[1:]]
        attr.append('자료: ' + ' · '.join(l['label'] for l in links))
        blocks.append({'t': 'img', 'file': name, 'cap': cap, 'attr': attr})
    out = {'title': pk['title'], 'blocks': blocks, 'tags': pk['tags']}
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
