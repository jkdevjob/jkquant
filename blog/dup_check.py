#!/usr/bin/env python3
"""블로거 글(.md)이 네이버 글과 문장째 겹치는지 잰다 — 중복 문서(유사 문서) 위험 점검.

usage: python3 -I blog/dup_check.py <블로거 글.md> [기준 %, 기본 15]
  공백·문장부호를 뺀 7글자 묶음(shingle)으로 바꿔, 블로거 글의 묶음 가운데 네이버 글(최근 14일, blog/naver/posts/*.json)과
  다른 블로거 글(blog/20*.md)에 그대로 있는 비율을 글마다 잰다. 가장 높은 값이 기준 이하이면 PASS.
  숫자·고유명사는 어차피 겹치므로 0% 가 목표가 아니다. 같은 문장을 옮겨 쓰면 30% 를 넘는다.
"""
import datetime, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
K = 7


def norm(t):
    t = re.sub(r'https?://\S+', ' ', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'[^0-9A-Za-z가-힣]', '', t)


def shingles(t):
    t = norm(t)
    return {t[i:i + K] for i in range(max(0, len(t) - K + 1))}


def md_body(path):
    s = open(path, encoding='utf-8').read().split('\n---\n')[0]
    lines = [l for l in s.split('\n')[1:] if l.strip() and not l.startswith('<!--') and not l.startswith('![')]
    return '\n'.join(lines)


def main():
    src = sys.argv[1]
    lim = float(sys.argv[2]) if len(sys.argv) > 2 else 15.0
    me = shingles(md_body(src))
    if not me:
        sys.exit('본문이 비어 있음')
    m = re.match(r'(\d{4}-\d{2}-\d{2})', os.path.basename(src))
    d0 = datetime.date.fromisoformat(m.group(1)) if m else datetime.date.today()
    rows = []
    for f in glob.glob(os.path.join(HERE, 'naver', 'posts', '*.json')):
        mm = re.match(r'(\d{4}-\d{2}-\d{2})', os.path.basename(f))
        if not mm or abs((datetime.date.fromisoformat(mm.group(1)) - d0).days) > 14:
            continue
        d = json.load(open(f, encoding='utf-8'))
        txt = d.get('title', '') + '\n' + '\n'.join(b.get('text', '') + ' ' + b.get('caption', '') for b in d.get('blocks', []))
        rows.append(('네이버', os.path.basename(f), txt))
    for f in glob.glob(os.path.join(HERE, '20*.md')):
        if os.path.abspath(f) != os.path.abspath(src):
            rows.append(('블로거', os.path.basename(f), md_body(f)))
    res = sorted(((100.0 * len(me & shingles(t)) / len(me), kind, name) for kind, name, t in rows), reverse=True)
    for pct, kind, name in res[:5]:
        print(f'{pct:5.1f}% | {kind} | {name}')
    top = res[0][0] if res else 0.0
    print(f"RESULT: {'PASS' if top <= lim else 'FAIL'} (최대 {top:.1f}% · 기준 {lim:.0f}%)")
    sys.exit(0 if top <= lim else 1)


if __name__ == '__main__':
    main()
