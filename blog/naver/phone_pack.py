#!/usr/bin/env python3
"""네이버 원고(blog/naver/posts/<날짜>_<이름>.json)를 휴대폰 네이버 블로그 앱에서 직접 올리기 쉬운 글 파일로 바꾼다.

실험 E6(2026-11-17 사용자 승인 "두개 다 해보자"): 서버 자동 게시 대신 사용자가 휴대폰 앱으로 직접 올려,
검색 누락이 '올리는 방법' 때문인지 가린다. 서버는 이 기간에 네이버에 로그인하지 않는다.

usage: python3 -I blog/naver/phone_pack.py <post.json> <출력.txt>
출력: 제목 · 카테고리/주제 · 본문(이미지 넣을 자리 표시) · 태그 한 줄. 이미지 파일은 assets/<날짜>/ 에 있다.
"""
import json
import re
import sys


def main():
    src, out = sys.argv[1], sys.argv[2]
    d = json.load(open(src, encoding='utf-8'))
    L = []
    L.append('■ 제목 (그대로 복사)')
    L.append(d['title'])
    L.append('')
    L.append(f"■ 카테고리: {d.get('category', '')}   ■ 주제: {d.get('topic', '')}")
    L.append('■ 공개 설정: 전체공개 · 댓글·공감·검색 허용 · 공지 끔')
    L.append('')
    L.append('■ 본문 — 위에서부터 순서대로 붙여 넣기. [이미지] 줄은 붙여 넣지 말고 그 자리에 사진을 넣는다.')
    L.append('')
    n = 0
    for b in d['blocks']:
        if b.get('t') == 'img':
            n += 1
            L.append(f"[이미지 {n}: {b['file']} 넣기 → 사진 설명 칸에 아래 한 줄]")
            L.append(b['cap'])
            L.append('[사진 아래 본문에 아래 줄을 붙여 넣기]')
            attr = b.get('attr') or []
            if isinstance(attr, str):
                attr = [attr]
            L.extend(re.sub(r'<[^>]+>', '', x) for x in attr)  # 편집기용 <a> 태그를 걷어 맨 주소만 남긴다(앱이 자동 링크)
            L.append('')
        else:
            t = b.get('text', '').strip()
            if t:
                L.append(t)
                L.append('')
    L.append('■ 태그 (발행 화면 태그 칸에 하나씩)')
    L.append(' '.join('#' + t for t in d.get('tags', [])))
    open(out, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print('OK', out, 'images', n, 'chars', sum(len(x) for x in L))


if __name__ == '__main__':
    main()
