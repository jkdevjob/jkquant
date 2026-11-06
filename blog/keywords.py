#!/usr/bin/env python3
"""사람들이 네이버에서 실제로 치는 검색어를 모은다(제목·태그를 검색어에 맞추기 위한 도구).

usage: python3 -I blog/keywords.py 레버리지ETF 반대매매 "서킷브레이커"
  각 씨앗 낱말과 '씨앗 + 뜻/위험/전망/계산/세금' 으로 네이버 자동완성을 조회해 후보를 보여 준다.
  자동완성에 뜨는 말 = 많은 사람이 실제로 검색하는 말이다(검색량 숫자는 주지 않는다).
  검색량 숫자가 필요하면 네이버 검색광고 키워드 도구(API 키 필요)를 따로 쓴다. 숫자를 지어내지 않는다.
"""
import json, sys, urllib.parse, urllib.request
from collections import OrderedDict

SUFFIX = ['', ' 뜻', ' 위험', ' 전망', ' 계산', ' 세금']
UA = {'User-Agent': 'Mozilla/5.0 (blog keyword research)'}


def ac(q):
    url = ('https://ac.search.naver.com/nx/ac?con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8'
           '&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100&q=' + urllib.parse.quote(q))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
        d = json.load(r)
    return [x[0] for x in (d.get('items') or [[]])[0]]


def main():
    seeds = sys.argv[1:]
    if not seeds:
        sys.exit(__doc__)
    for s in seeds:
        found = OrderedDict()
        for suf in SUFFIX:
            try:
                for k in ac(s + suf):
                    found.setdefault(k, suf.strip() or '기본')
            except Exception as e:
                print(f'  ({s+suf} 조회 실패: {e})')
        print(f'== {s}  (자동완성 {len(found)}개)')
        for k, via in found.items():
            print(f'  - {k}   [{via}]')


if __name__ == '__main__':
    main()
