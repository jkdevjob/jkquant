#!/usr/bin/env python3
"""네이버 원고(blog/naver/posts/<날짜>_<이름>.json)를 휴대폰 네이버 블로그 앱에서 직접 올리기 쉬운 글 파일로 바꾼다.

실험 E6(2026-11-17 사용자 승인 "두개 다 해보자"): 서버 자동 게시 대신 사용자가 휴대폰 앱으로 직접 올려,
검색 누락이 '올리는 방법' 때문인지 가린다. 서버는 이 기간에 네이버에 로그인하지 않는다.

usage: python3 -I blog/naver/phone_pack.py <post.json> <출력.txt> [묶음.zip]
출력: 제목 · 카테고리/주제 · 본문(이미지 넣을 자리 표시) · 태그 한 줄. 이미지 파일은 assets/<날짜>/ 에 있다.
묶음.zip 을 주면 원고 txt 와 이미지(txt 에 적힌 이름 그대로)를 폴더 하나로 압축한다
(2026-11-20 사용자 "한번에 다운받게 압축해" · "앞으로도 압축해서 보내").
"""
import json
import os
import re
import sys
import zipfile


def main():
    src, out = sys.argv[1], sys.argv[2]
    d = json.load(open(src, encoding='utf-8'))
    L = []
    L.append('■ 제목 (그대로 복사)')
    L.append(d['title'])
    L.append('')
    L.append(f"■ 카테고리: {d.get('category', '')}   ■ 주제: {d.get('topic', '')}")
    L.append('■ 공개 설정: 전체공개 · 댓글·공감·검색 허용 · 외부 공유 허용(있으면 켬) · 공지 끔')
    L.append('')
    L.append('■ 본문 — 위에서부터 순서대로 붙여 넣기. [ ] 줄은 붙여 넣지 말고 그 자리에 사진을 넣는다.')
    # 2026-11-20 메르 형식: 번호 줄 하나가 한 문단이다(인용구·소제목 없이). 사진은 몇 줄마다 하나씩.
    L.append('')
    n, slot = 0, False
    SLOT = '[선택: 여기(한줄 코멘트 바로 앞)에 내 생각 2~3줄을 직접 써 넣기 — 이 뉴스를 보고 내가 실제로 하는 일·보는 시각. 안 쓰면 넘어감]'
    for b in d['blocks']:
        if b.get('t') == 'img':
            n += 1
            attr = b.get('attr') or []
            if isinstance(attr, str):
                attr = [attr]
            attr = [re.sub(r'<[^>]+>', '', x) for x in attr]  # 편집기용 <a> 태그를 걷어 맨 주소만 남긴다(앱이 자동 링크)
            # 2026-11-19 사용자 형식("쓸데없는 글 남기지 말고"): 썸네일은 사진 설명·'이미지: 블로그 직접 제작' 줄 없이,
            # 도표는 '도표:' 머리말과 '사진: 블로그 직접 작성 도표 /' 머리말을 뺀다.
            if (n == 1 and any('직접 제작' in x for x in attr)) or (not b.get('cap') and not attr):
                L.append(f"[이미지 {n}: {b['file']} 넣기 — 사진 설명은 비워 둠]")
                L.append('')
                continue
            L.append(f"[이미지 {n}: {b['file']} 넣기 → 사진 설명 칸에 아래 한 줄]")
            L.append(re.sub(r'^도표:\s*', '', b['cap']))
            # 2026-11-19 "출처 주소 줄 빼고 해": 옛 원고에 남은 '출처: 주소' 줄도 걸러 '자료:' 줄만 남긴다
            attr = [x for x in attr if not re.match(r'^(사진: 블로그 직접 작성 도표 / )?출처: ', x)]
            if attr:
                L.append('[사진 아래 본문에 아래 줄을 붙여 넣기]')
                L.extend(attr)
            L.append('')
        else:
            t = b.get('text', '').strip()
            if t.startswith('한줄 코멘트') and not slot:
                # 2026-11-20 한줄 코멘트는 글의 맨 끝 — 사용자 '내 생각' 칸은 그 바로 앞
                L.append(SLOT); L.append(''); slot = True
            if t:
                L.append(t)
                L.append('')
    # 2026-11-19 네이버 공식 가이드(서치어드바이저 '콘텐츠 작성시 권장 사항'): AI 도구를 쓰면 단순 생성·요약에 그치지 말고
    # 운영자의 경험과 관점을 더한다. 이 부분은 사용자만 쓸 수 있다(대신 지어내지 않는다) — 안 쓰면 그냥 넘어간다.
    if not slot:
        L.append(SLOT); L.append('')
    # 2026-11-20 사용자 "■ 태그 (발행 화면 태그 칸에 하나씩) 요건 쓰지마" — 머리말 없이 태그 줄만 둔다
    L.append(' '.join('#' + t for t in d.get('tags', [])))
    open(out, 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print('OK', out, 'images', n, 'chars', sum(len(x) for x in L))
    if len(sys.argv) > 3:
        zpath = sys.argv[3]
        base = os.path.basename(src)[:-5]                      # 2026-11-20_silson-5gen
        date, slug = base[:10], base[11:]
        assets = os.path.join(os.path.dirname(os.path.abspath(src)), 'assets', date)
        files = [b['file'] for b in d['blocks'] if b.get('t') == 'img']
        missing = [f for f in files if not os.path.exists(os.path.join(assets, f))]
        if missing:
            sys.exit('missing images: ' + ', '.join(missing))
        top = f'naver_{date}'
        with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(out, f'{top}/원고_{slug}.txt')
            for f in files:
                z.write(os.path.join(assets, f), f'{top}/{f}')
        print('ZIP', zpath, 'files', len(files) + 1, 'bytes', os.path.getsize(zpath))


if __name__ == '__main__':
    main()
