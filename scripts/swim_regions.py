#!/usr/bin/env python3
"""대한민국 17개 시·도와 시·군·구 판정 (수영대회 수집기 전용 · 순수 함수).

원칙
- 장소(수영장·주소) 글자를 대회명보다 먼저 본다. 대회명의 '경북연맹회장배' 같은 주최 이름은 개최지가 아닐 수 있다.
- 겹치는 이름(중구·동구·서구·남구·북구·강서구·고성군)은 시·도 문맥이 있을 때만 확정한다.
- '경기종목'의 '경기', '50m 장수로'의 '장수'처럼 일반 낱말과 겹치는 이름은 지역으로 읽지 않는다.
- 근거가 없으면 빈 값을 돌려준다(추측하지 않는다). 해외 대회는 is_foreign 으로 걸러 수집에서 뺀다.
"""
from __future__ import annotations

import re

SIDO = ("서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기",
        "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주")

# '경상'·'충청'·'전라' 같은 묶음 이름은 시·도 하나로 정할 수 없어 넣지 않는다.
SIDO_ALIASES = {
    "서울특별시": "서울", "서울시": "서울", "서울": "서울",
    "부산광역시": "부산", "부산시": "부산", "부산": "부산",
    "대구광역시": "대구", "대구시": "대구", "대구": "대구",
    "인천광역시": "인천", "인천시": "인천", "인천": "인천",
    "광주광역시": "광주", "광주": "광주",
    "대전광역시": "대전", "대전시": "대전", "대전": "대전",
    "울산광역시": "울산", "울산시": "울산", "울산": "울산",
    "세종특별자치시": "세종", "세종시": "세종", "세종": "세종",
    "경기도": "경기", "경기": "경기",
    "강원특별자치도": "강원", "강원도": "강원", "강원": "강원",
    "충청북도": "충북", "충북": "충북",
    "충청남도": "충남", "충남": "충남",
    "전북특별자치도": "전북", "전라북도": "전북", "전북": "전북",
    "전라남도": "전남", "전남": "전남",
    "경상북도": "경북", "경북": "경북",
    "경상남도": "경남", "경남": "경남",
    "제주특별자치도": "제주", "제주도": "제주", "제주": "제주",
}

SIGUNGU = {
    "서울": "종로구 중구 용산구 성동구 광진구 동대문구 중랑구 성북구 강북구 도봉구 노원구 은평구 서대문구 마포구 "
            "양천구 강서구 구로구 금천구 영등포구 동작구 관악구 서초구 강남구 송파구 강동구",
    "부산": "중구 서구 동구 영도구 부산진구 동래구 남구 북구 해운대구 사하구 금정구 강서구 연제구 수영구 사상구 기장군",
    "대구": "중구 동구 서구 남구 북구 수성구 달서구 달성군 군위군",
    "인천": "제물포구 영종구 중구 동구 미추홀구 연수구 남동구 부평구 계양구 서구 서해구 검단구 강화군 옹진군",
    "광주": "동구 서구 남구 북구 광산구",
    "대전": "동구 중구 서구 유성구 대덕구",
    "울산": "중구 남구 동구 북구 울주군",
    "세종": "",
    "경기": "수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 "
            "시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 "
            "연천군 가평군 양평군",
    "강원": "춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 "
            "양구군 인제군 고성군 양양군",
    "충북": "청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군",
    "충남": "천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군",
    "전북": "전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군",
    "전남": "목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 "
            "영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군",
    "경북": "포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 의성군 청송군 영양군 영덕군 "
            "청도군 고령군 성주군 칠곡군 예천군 봉화군 울진군 울릉군",
    "경남": "창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 고성군 남해군 하동군 "
            "산청군 함양군 거창군 합천군",
    "제주": "제주시 서귀포시",
}
SIGUNGU = {k: tuple(v.split()) for k, v in SIGUNGU.items()}

_OWNERS = {}
for _sido, _names in SIGUNGU.items():
    for _n in _names:
        _OWNERS.setdefault(_n, []).append(_sido)
# '광주시'는 경기도 광주시다. 광주광역시는 '광주광역시·광주 ○구'로 쓴다(아래 resolve 에서 따로 본다).
_OWNERS["광주시"] = ["경기"]
AMBIGUOUS = {n for n, owners in _OWNERS.items() if len(owners) > 1}

# 접미사(시·군) 없이 써도 되는 짧은 이름. 일반 낱말과 겹치는 이름은 뺀다.
_SHORT_EXCLUDE = {"장수", "음성", "예산", "영양", "고령", "공주", "영광", "남해", "동해", "구리", "인제", "고성",
                  "광주", "양구", "서천", "청도", "영동", "경주", "보은", "상주", "제주", "부여", "완도", "진도",
                  "화순", "보성", "하동", "의성", "청송", "성주"}
SHORT = {}
for _sido, _names in SIGUNGU.items():
    for _n in _names:
        if _n in AMBIGUOUS or not _n.endswith(("시", "군")):
            continue
        short = _n[:-1]
        if len(short) >= 2 and short not in _SHORT_EXCLUDE and short not in SIDO_ALIASES:
            SHORT[short] = _n
# 짧은 이름 바로 뒤에 와도 되는 글자(대회명에서 흔한 이음). 그 밖의 한글이 붙으면 다른 낱말로 본다.
_SHORT_NEXT = set("배전마생수실종스체학국꿈유연특올문한시군")

# 잘 알려진 경기장 — 주소가 안 적힌 공고를 위해. 확실한 곳만 넣는다(띄어쓰기 무시).
VENUES = {
    "김천실내수영장": ("경북", "김천시"), "김천종합스포츠타운": ("경북", "김천시"),
    "한들문화센터": ("충남", "천안시"), "배미수영장": ("충남", "아산시"),
    "한밭수영장": ("대전", "중구"), "정부세종청사": ("세종", ""),
    "사직실내수영장": ("부산", "동래구"), "문수실내수영장": ("울산", "남구"),
    "남부대시립국제수영장": ("광주", "광산구"), "남부대학교시립국제수영장": ("광주", "광산구"),
    "문학박태환수영장": ("인천", "미추홀구"), "인천도원수영장": ("인천", "제물포구"),
    "잠실실내수영장": ("서울", "송파구"), "잠실제1수영장": ("서울", "송파구"), "올림픽수영장": ("서울", "송파구"),
    "서울체육고등학교": ("서울", "송파구"), "성북레포츠센터": ("서울", "성북구"), "성북종합레포츠타운": ("서울", "성북구"),
    "완산실내수영장": ("전북", "전주시"), "전주완산수영장": ("전북", "전주시"), "전주완산실내수영장": ("전북", "전주시"),
    "창원실내수영장": ("경남", "창원시"), "목포실내수영장": ("전남", "목포시"),
    "광양수영장": ("전남", "광양시"), "광양성황수영장": ("전남", "광양시"), "광양스포츠센터": ("전남", "광양시"),
    "진남수영장": ("전남", "여수시"), "청주실내수영장": ("충북", "청주시"),
    "광교복합체육센터": ("경기", "수원시"), "경기체육고등학교": ("경기", "수원시"),
    "이천스포렉스": ("경기", "이천시"), "대부동복지체육센터": ("경기", "안산시"),
    "안양종합운동장": ("경기", "안양시"), "구리멀티스포츠센터": ("경기", "구리시"),
    "소사벌레포츠타운": ("경기", "평택시"), "유앤아이센터": ("경기", "화성시"),
    "별내커뮤니티센터": ("경기", "남양주시"), "운정스포츠센터": ("경기", "파주시"),
    "시흥어울림국민체육센터": ("경기", "시흥시"), "오산스포츠센터": ("경기", "오산시"),
    "광주시G스타디움": ("경기", "광주시"),
    "제주종합경기장": ("제주", "제주시"), "제주실내수영장": ("제주", "제주시"),
    "서귀포시동방파제": ("제주", "서귀포시"), "거제동부학생수영장": ("경남", "거제시"),
    "다원복합센터": ("경북", "포항시"), "대구체육고등학교": ("대구", ""),
    "원주동부복합체육센터": ("강원", "원주시"), "용운국제수영장": ("대전", "동구"), "도원실내수영장": ("인천", "제물포구"),
    "뚝섬한강공원": ("서울", "광진구"),
    "완주군근로자종합복지관": ("전북", "완주군"),
}

FOREIGN = re.compile(r"일본|오사카|도쿄|후쿠오카|KANSAI|JAPAN|괌|사이판|골드코스트|호주|태국|베트남|대만|"
                     r"싱가포르|말레이시아|필리핀|홍콩|중국|미국|하와이|해외", re.I)

_SPACE = re.compile(r"\s+")
_HANGUL = re.compile(r"[가-힣]")


def _clean(s):
    return _SPACE.sub(" ", str(s or "")).strip()


def _venue(text):
    compact = text.replace(" ", "")
    for venue in sorted(VENUES, key=len, reverse=True):
        if venue in compact:
            return VENUES[venue]
    return "", ""


def _sido_mentions(text):
    """[(위치, 시·도)] — 긴 별칭부터 자리를 차지해 '부산진구' 같은 겹침을 막는다."""
    found, taken = [], [False] * len(text)
    for alias in sorted(SIDO_ALIASES, key=len, reverse=True):
        for m in re.finditer(re.escape(alias), text):
            a, b = m.span()
            if any(taken[a:b]):
                continue
            nxt = text[b:b + 1]
            if alias == "경기" and nxt and _HANGUL.match(nxt) and nxt != "도":
                continue          # 경기종목·수영경기·경기장 …
            if alias == "광주" and nxt == "시":
                continue          # 경기 광주시 (아래에서 시·군·구로 본다)
            if alias in ("대전", "세종") and nxt and _HANGUL.match(nxt) and nxt not in "시광":
                continue          # '한마음 대전' 같은 낱말, '세종문화회관'
            for i in range(a, b):
                taken[i] = True
            found.append((a, SIDO_ALIASES[alias]))
    return sorted(found)


def _sigungu_mentions(text):
    out, taken = [], [False] * len(text)
    for n in sorted(_OWNERS, key=len, reverse=True):
        for m in re.finditer(re.escape(n), text):
            a, b = m.span()
            if any(taken[a:b]):
                continue
            if n == "수영구" and text[b:b + 1] in ("조", "명", "역"):
                continue
            prev = text[a - 1:a]
            if n in AMBIGUOUS or len(n) == 2:
                # '부산진구'의 '진구', '남동구'의 '동구' 같은 꼬리 겹침 방지
                if prev and _HANGUL.match(prev):
                    continue
            for i in range(a, b):
                taken[i] = True
            out.append((a, n))
    if len(text) <= 200:
        for short in sorted(SHORT, key=len, reverse=True):
            for m in re.finditer(re.escape(short), text):
                a, b = m.span()
                if any(taken[a:b]):
                    continue
                nxt, prev = text[b:b + 1], text[a - 1:a]
                if nxt and _HANGUL.match(nxt) and nxt not in _SHORT_NEXT:
                    continue
                if prev and _HANGUL.match(prev):
                    continue
                for i in range(a, b):
                    taken[i] = True
                out.append((a, SHORT[short]))
    return sorted(out)


def owners_of(sigungu):
    return list(_OWNERS.get(sigungu, []))


def _resolve_one(text):
    """글에 적힌 지역을 먼저 쓰고, 없을 때만 경기장 사전으로 채운다."""
    vs, vg = _venue(text)
    mentions = _sido_mentions(text)
    gus = [g for _, g in _sigungu_mentions(text)]
    sido = mentions[0][1] if mentions else ""
    # '광주시 남구'처럼 광주광역시의 구와 같이 쓰면 광주광역시다.
    if not sido and "광주시" in gus and any(g in ("동구", "서구", "남구", "북구", "광산구") for g in gus):
        sido = "광주"
        gus = [g for g in gus if g != "광주시"]
    gu = ""
    for g in gus:
        owners = _OWNERS.get(g, [])
        if sido:
            if sido in owners:
                gu = g
                break
        elif len(owners) == 1:
            sido, gu = owners[0], g
            break
    if not sido:
        sido, gu = vs, vg
    elif not gu and vs == sido:
        gu = vg
    return sido, gu


def resolve(*texts):
    """여러 근거(앞쪽일수록 강함)를 받아 (sido, sigungu)를 돌려준다. 모르면 ('', '')."""
    sido, sigungu = "", ""
    for raw in texts:
        text = _clean(raw)
        if not text:
            continue
        s, g = _resolve_one(text)
        if not sido and s:
            sido, sigungu = s, g
        elif sido and s == sido and not sigungu and g:
            sigungu = g
        if sido and sigungu:
            break
    if sido == "세종":
        sigungu = ""
    return sido, sigungu


def is_foreign(*texts):
    text = " ".join(_clean(t) for t in texts)
    if not FOREIGN.search(text):
        return False
    sido, _ = resolve(*texts)
    return not sido


def label(sido, sigungu):
    if not sido:
        return "지역 미확인"
    return sido + (" " + sigungu if sigungu else "")
