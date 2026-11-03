#!/usr/bin/env python3
"""JKQuant 전국 수영대회 수집기 v2.

구조
- 수집처마다 '관측값(observation)'을 만든다. 대회 기록은 관측값들에서 매번 같은 규칙으로 계산한다
  (같은 걸 두 군데서 세지 않는다 — 화면이 쓰는 값은 derive() 한 곳에서만 나온다).
- 수집처가 실패하면 그 수집처의 이전 관측값을 그대로 둔다(수집 실패 ≠ 대회 취소 · 기존 데이터 유지).
- 공식 출처(대한수영연맹·대한수중핀수영협회·시도 연맹·공식 공고 원문)를 2차 자료(통합 일정 사이트)보다 앞에 둔다.
- 근거가 없는 값은 비워 둔다(None/''). 자유형 50·100m 는 요강 원문에 적힌 경우에만 '가능/불가'로 정한다.
- robots.txt 가 막은 사이트는 수집하지 않는다(마이랭킹은 검색엔진 외 수집 금지라 v2 에서 뺐다).

파일
- data/swim/competitions.json : 화면용 대회 목록(계산 결과)
- data/swim/state.json        : 수집기 내부 상태(대회별 관측값 · PDF 분석 캐시)
- data/swim/changes.json      : 변경 이력(신규 · 일정/장소/접수 변경 · 취소/연기)
- data/swim/sources.json      : 수집처별 마지막 시도/성공 시각 · 건수 · 오류
- data/swim/leads.json        : 검색엔진으로 찾은 미확정 후보(공식 확인 전)
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.robotparser
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import swim_regions as R

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("SWIM_DATA_DIR") or ROOT / "data" / "swim")
# 원문·PDF 분석 캐시는 저장소에 올리지 않는다(Actions 캐시). 없어져도 다시 받아 같은 값이 나온다.
CACHE_FILE = Path(os.environ.get("SWIM_CACHE_FILE") or ROOT / ".swim-cache" / "cache.json")
KST = ZoneInfo("Asia/Seoul")
SCHEMA = 2
UA = "JKQuantSwimBot/2.0 (+https://jkquant.pages.dev/swim; public competition schedule, once a day)"
UA_TOKEN = "JKQuantSwimBot"
APP = "https://jkquant.pages.dev/swim"


def today():
    v = os.environ.get("SWIM_TODAY")
    return date.fromisoformat(v) if v else datetime.now(KST).date()


def now_iso():
    return datetime.now(KST).isoformat(timespec="seconds")


TIER_RANK = {"official": 3, "secondary": 2, "unverified": 1}
# 같은 등급 안에서의 우선순위(앞이 강함)
SOURCE_ORDER = ["korswim", "korswim_detail", "kua", "seoulswim", "gswimming", "busanswim", "djswim",
                "official_link", "swimming_co_kr", "whoisfast", "search_lead", "legacy_v1"]
SOURCE_NAMES = {
    "korswim": "대한수영연맹 대회일정",
    "korswim_detail": "대한수영연맹 공고 원문·요강",
    "kua": "대한수중핀수영협회 대회일정",
    "seoulswim": "서울특별시수영연맹 대회일정",
    "gswimming": "경기도수영연맹 공지사항",
    "busanswim": "부산광역시수영연맹 공지사항",
    "djswim": "대전광역시수영연맹 공지사항",
    "official_link": "공식 공고 원문 확인",
    "swimming_co_kr": "전국 수영대회 통합 플랫폼(swimming.co.kr)",
    "whoisfast": "Whoisfast 대회 일정",
    "search_lead": "검색엔진 발견",
    "legacy_v1": "이전 수집본(v1)",
}
OFFICIAL_HOST_SUFFIX = (".go.kr", ".or.kr", ".ac.kr", ".kr.kr")
OFFICIAL_HOSTS = ("korswim.co.kr", "kua.or.kr", "gswimming.com", "busanswimming.kr", "gbaquatics.co.kr",
                  "ulsanswimming.com", "djswimming.or.kr", "seoulswim.or.kr", "sjswim.or.kr",
                  "cnswimming.or.kr", "goegu.kr", "seo.incheon.kr", "bucheon.go.kr", "hscity.go.kr")
UNOFFICIAL_HOSTS = ("cafe.naver.com", "blog.naver.com", "m.blog.naver.com", "cafe.daum.net", "tistory.com",
                    "instagram.com", "facebook.com", "youtube.com", "swimming.co.kr", "whoisfast.com",
                    "myranking.co.kr", "band.us")
TRACKED = ("title", "start_date", "end_date", "venue", "sido", "sigungu", "apply_open", "apply_close",
           "status", "apply_closed", "events", "free50", "free100", "fee", "eligibility", "pool",
           "official_url", "apply_url", "verification")


class StructureError(Exception):
    """페이지는 받았지만 기대한 구조가 아니다(사이트 개편 의심) — 성공으로 치지 않는다."""


class RobotsDenied(Exception):
    pass


# ───────────────────────── HTTP ─────────────────────────
class Fetcher:
    def __init__(self, session=None, pause=0.35, tries=3):
        if session is None:
            import requests
            session = requests.Session()
        self.s = session
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6"})
        self.pause, self.tries = pause, tries
        self.robots = {}
        self.count = 0

    def allowed(self, url):
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.s.get(base + "/robots.txt", timeout=15)
                if r.status_code >= 500:
                    rp.parse(["User-agent: *", "Disallow: /"])
                elif r.status_code >= 400:
                    rp.parse([])
                else:
                    rp.parse(r.text.splitlines())
            except Exception:
                rp = None                         # 확인 못함 — 본 요청이 실패하면 그때 실패로 기록
            self.robots[base] = rp
        rp = self.robots[base]
        return rp is None or rp.can_fetch(UA_TOKEN, url)

    def get(self, url, max_bytes=8_000_000):
        if not self.allowed(url):
            raise RobotsDenied(url)
        last = None
        for i in range(self.tries):
            try:
                r = self.s.get(url, timeout=25)
                if r.status_code >= 500:
                    raise IOError(f"HTTP {r.status_code}")
                r.raise_for_status()
                if len(r.content) > max_bytes:
                    raise ValueError("response too large")
                self.count += 1
                time.sleep(self.pause)
                return r
            except Exception as exc:            # 연결 끊김 · 시간 초과 · 5xx 는 다시 시도
                last = exc
                if getattr(getattr(exc, "response", None), "status_code", 500) in (403, 404, 410):
                    break
                time.sleep(1.5 * (i + 1))
        raise last

    def soup(self, url):
        from bs4 import BeautifulSoup
        r = self.get(url)
        return BeautifulSoup(r.content, "html.parser"), r


# ───────────────────────── 글자 처리 ─────────────────────────
_WS = re.compile(r"\s+")


def clean(x):
    return _WS.sub(" ", str(x or "")).strip()


def iso(y, m, d):
    try:
        return date(int(y), int(m), int(d)).isoformat()
    except (TypeError, ValueError):
        return ""


_DATE_TOKEN = re.compile(
    r"(?P<full>(?P<y>20\d{2})\s*(?:년|[.\-/])\s*(?P<m>\d{1,2})\s*(?:월|[.\-/])\s*(?P<d>\d{1,2})(?!\d)\s*일?\.?)"
    r"|(?P<md>(?<![\d.])(?P<m2>\d{1,2})\s*(?:월|[.\-/])\s*(?P<d2>\d{1,2})(?!\d)(?![.,]\d)(?!\s*(?:km|m\b|M\b|명|원|%|회|위|부|kg))\s*일?\.?)"
    r"|(?P<dd>(?<![\d.])(?P<d3>\d{1,2})\s*일(?!\s*간))")


def parse_dates(s, default_year=None):
    """글 속 날짜를 순서대로 ISO 로. '2026. 8. 29.(토) - 8. 30.(일)', '11월 28일 ~ 29일' 등."""
    out, year, month = [], default_year, None
    for m in _DATE_TOKEN.finditer(str(s or "")):
        if m.group("full"):
            year, month, day = int(m["y"]), int(m["m"]), int(m["d"])
        elif m.group("md"):
            if year is None:
                continue
            mm, day = int(m["m2"]), int(m["d2"])
            if month and mm < month and mm <= 2 and month >= 11:
                year += 1                         # 12월 → 1월 해 넘김
            month = mm
        else:
            if year is None or month is None:
                continue
            day = int(m["d3"])
        v = iso(year, month, day)
        if v:
            out.append(v)
    return out


def date_range(s, default_year=None):
    ds = parse_dates(s, default_year)
    if not ds:
        return "", ""
    start = ds[0]
    end = ds[1] if len(ds) > 1 and ds[1] >= start else start
    if (date.fromisoformat(end) - date.fromisoformat(start)).days > 31:
        end = start                               # 대회 기간이 한 달을 넘으면 두 번째 날짜는 다른 뜻(마감일 등)
    return start, end


def spaced(label):
    return r"\s*".join(map(re.escape, label.replace(" ", "")))


LABELS = {
    "title": ["대회명", "대 회 명", "행사명"],
    "date": ["대회기간", "대회일시", "대회일자", "개최일시", "개최일자", "개최기간", "경기일시", "경기기간", "일시", "기간", "일자", "날짜", "대회일"],
    "venue": ["대회장소", "개최장소", "경기장소", "장소"],
    "apply": ["참가신청기간", "신청기간", "접수기간", "참가접수", "참가신청", "신청접수", "접수", "신청마감", "접수마감"],
    "eligibility": ["참가자격", "참가대상", "참가구분 및 참가대상", "참가구분", "대상", "자격"],
    "events": ["경기종목", "대회종목", "참가종목", "세부종목", "종목"],
    "fee": ["참가비", "참 가 비", "참가 비용", "참가료"],
    "host": ["주최", "주관", "주최/주관", "주최·주관"],
}
_ALL_LABELS = sorted({spaced(x) for v in LABELS.values() for x in v} |
                     {spaced(x) for x in ("후원", "협찬", "문의", "시상", "경기방법", "참가인원", "대표팀후원",
                                          "주요사항", "참고양식", "기타", "붙임", "유의사항", "환불", "제출서류")},
                     key=len, reverse=True)
_MARK = r"(?:^|\s)(?:[□■○●◎▶※\-*•·]+\s*)?(?:\(?[가-하]\)?\s*[.)]|\d{1,2}\s*[.)])?\s*"
_STOP = re.compile(_MARK + r"(?:" + "|".join(_ALL_LABELS) + r")\s*[:：;]")


def block_text(node):
    """블록 요소 경계에서 줄을 나누고 인라인 조각은 붙인다('2026<span>년</span>6월' → '2026년6월')."""
    from bs4 import NavigableString
    parts = []

    def walk(n):
        for c in n.children:
            if isinstance(c, NavigableString):
                if type(c).__name__ in ("Comment", "Doctype"):
                    continue
                parts.append(str(c))
                continue
            name = c.name or ""
            if name in ("script", "style", "noscript"):
                continue
            if name == "br":
                parts.append("\n")
                continue
            block = name in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section",
                             "article", "dl", "dt", "dd", "ul", "ol", "header", "footer", "blockquote")
            if block:
                parts.append("\n")
            walk(c)
            if name in ("td", "th"):
                parts.append(" ")
            if block:
                parts.append("\n")

    walk(node)
    lines = [clean(x) for x in "".join(parts).split("\n")]
    return [x for x in lines if x]


def field(lines, kind, maxlen=180):
    """'가. 대 회 명: …', '일 시: …', 다음 줄에 값이 있는 표 형식까지 찾는다."""
    labs = sorted((spaced(x) for x in LABELS[kind]), key=len, reverse=True)
    pat = re.compile(_MARK + r"(?:" + "|".join(labs) + r")\s*(?:[:：;]|(?:은|는)(?=\s)|$)\s*(.*)$")
    text = "\n".join(lines)
    for i, line in enumerate(lines):
        m = pat.search(line)
        if not m:
            continue
        val = m.group(1).strip()
        if not val and i + 1 < len(lines):
            val = lines[i + 1]
        cut = _STOP.search(" " + val)
        if cut and cut.start() > 0:
            val = val[:cut.start() - 1]
        val = clean(val)[:maxlen]
        if val:
            return val
    # 한 줄에 여러 항목이 이어진 글(줄바꿈 없는 본문)
    flat = clean(text)
    m = re.search(r"(?:" + "|".join(labs) + r")\s*[:：;]\s*(.+)", flat)
    if m:
        val = m.group(1)
        cut = _STOP.search(" " + val)
        if cut and cut.start() > 0:
            val = val[:cut.start() - 1]
        return clean(val)[:maxlen]
    return ""


_CONTENT_SEL = "#bo_v_con, #post_area, .view_content, .board_view .content, .bbs_view, .view-con, .view_con, .board-view-content, td.content"
_LABEL_HINT = re.compile(r"(?:대\s*회\s*명|일\s*시|대\s*회\s*기\s*간|날\s*짜|장\s*소|신\s*청\s*기\s*간)\s*[:：;]")


def content_node(soup, selector=None):
    """게시글 본문 요소. 알려진 선택자가 없으면 '일시:'·'장소:' 같은 항목을 품은 가장 작은 덩어리를 쓴다
    (목록·메뉴 글이 섞이면 다른 대회의 날짜를 읽게 된다)."""
    for sel in filter(None, [selector, _CONTENT_SEL]):
        el = soup.select_one(sel)
        if el is not None and len(el.get_text(" ", strip=True)) > 20:
            return el
    hit = soup.find(string=_LABEL_HINT)
    p = hit.parent if hit else None
    while p is not None and p.name not in ("body", "html"):
        if len(p.get_text(" ", strip=True)) >= 150:
            return p
        p = p.parent
    return soup.body or soup


def _stale(c):
    """원문 캐시: 날짜를 읽은 글은 3일, 못 읽은 글(점검 화면 · 오류)은 하루 뒤 다시 받는다."""
    if not c:
        return True
    days = 3 if c.get("ok") else 1
    return c.get("at", "") <= (today() - timedelta(days=days)).isoformat()


def _cap_lines(lines, limit=7000):
    out, n = [], 0
    for x in lines:
        n += len(x)
        if n > limit:
            break
        out.append(x)
    return out


def notice_fields(lines, default_year=None):
    """공고 본문 줄 목록 → 구조화 값. 날짜가 없으면 대회 공고로 쓰지 않는다(호출자가 판단)."""
    title = field(lines, "title", 140)
    dtext = field(lines, "date", 120)
    start, end = date_range(dtext, default_year)
    venue = field(lines, "venue", 120)
    atext = field(lines, "apply", 160)
    a_open = a_close = ""
    ad = parse_dates(atext, int(start[:4]) if start else default_year)
    if re.search(r"마감", atext) and len(ad) == 1:
        a_close = ad[0]
    elif len(ad) >= 2:
        a_open, a_close = ad[0], ad[1]
    elif len(ad) == 1:
        a_close = ad[0] if re.search(r"까지|마감", atext) else ""
        a_open = ad[0] if not a_close else ""
    if not a_close:                               # '신청마감은 2026년 10월 27일(화) 17시까지' 같은 별도 줄
        for line in lines:
            if re.search(r"(?:신청|접수)\s*마감", line):
                ds = parse_dates(line, default_year)
                if ds:
                    a_close = ds[-1]
                    break
    if a_open and a_close and a_open > a_close:
        a_open = ""
    events = field(lines, "events", 220)
    if events and not re.search(r"경영|자유형|배영|평영|접영|혼영|계영|다이빙|수구|아티스틱|핀\s*수영|오픈\s*워터|\d+\s*m\b|발차기|장거리", events, re.I):
        events = ""                                  # '단체전 종목: 개인별 참가 신청을…' 같은 안내문은 종목이 아니다
    return {
        "title": title, "start_date": start, "end_date": end, "venue": venue,
        "apply_open": a_open, "apply_close": a_close,
        "eligibility": field(lines, "eligibility", 220), "events": events,
        "fee": fee_text(field(lines, "fee", 120)), "host": field(lines, "host", 120),
        "pool": pool_length(" ".join(lines[:200])),
    }


def fee_text(s):
    s = re.split(r"\s[∗※*]|\s\(?\s*(?:대회\s*)?참가\s*신청\s*마감", clean(s))[0]
    if not s or re.search(r"공식\s*요강\s*확인|확인\s*필요|^-$", s):
        return ""
    if not re.search(r"\d|무료|없음", s):
        return ""
    return s[:120]


def pool_length(s):
    s = clean(s)
    if re.search(r"50\s*m\s*(?:정규\s*풀|장\s*수로|풀|레인|수영장|규격)|장\s*수로|롱\s*코스|long\s*course", s, re.I):
        return "50m"
    if re.search(r"25\s*m\s*(?:단\s*수로|풀|레인|수영장|규격)|단\s*수로|숏\s*코스|short\s*course", s, re.I):
        return "25m"
    return ""


# ───────────────────────── 분류 ─────────────────────────
MASTERS = re.compile(r"마스터즈|마스터스|생활체육|동호인|생활수영|아마추어|어울림|등급제|클럽대항|직장인|시민\s*수영|생활\s*체육|대축전")
ELITE = re.compile(r"국가대표|상비군|청소년대표|선수권|종별|전국체육대회|전국체전|대통령배|프레대회|등록\s*선수|엘리트|실업|코리아\s*오픈|"
                   r"회장배\s*전국수영대회|전국\s*수영대회|선발\s*대회|선발전")
STUDENT = re.compile(r"유소년|꿈나무|초등|초·중|초중|중학|중등|고등|학생|교육감|소년체|학교스포츠클럽|유년|어린이|청소년")
NON_SWIM = re.compile(r"근대\s*5종|철인\s*3종|트라이애슬론|아쿠아슬론|조정|카누|요트")


def kinds_for(title, eligibility="", hint=""):
    t, s = clean(title), clean(title) + " " + clean(eligibility)
    out = []
    if MASTERS.search(t) or (MASTERS.search(eligibility or "") and not ELITE.search(t)):
        out.append("masters")
    if ELITE.search(t) and not (out and re.search(r"선발", t) and not re.search(r"국가대표|상비군|청소년대표|선수권|대통령배|전국체", t)):
        if not (STUDENT.search(t) and not re.search(r"국가대표|상비군|선수권|대통령배|전국체육대회|전국체전|종별", t)
                and re.search(r"선발|소년체", t)):
            out.append("elite")
    if (STUDENT.search(t) or (STUDENT.search(eligibility or "") and not out)) and \
            not ("elite" in out and re.search(r"국가대표|청소년대표|상비군", t) and not re.search(r"학생|소년체|꿈나무|유소년|초등|중학|고등", t)):
        out.append("student")
    if not out and hint:
        out.append(hint)
    return out or ["other"]


SPORTS = [
    ("핀수영", r"핀\s*수영|프리\s*다이빙|무호흡|수중\s*스포츠|수중\s*핀"),
    ("아티스틱", r"아티스틱|싱크로"),
    ("다이빙", r"(?<!프리)(?<!스킨)다이빙"),
    ("수구", r"수구(?!조)"),
    ("오픈워터", r"오픈\s*워터|바다\s*수영|해양\s*수영|아쿠아\s*마라톤|해수욕장|방파제"),
    ("경영", r"경영|자유형|배영|평영|접영|개인\s*혼영|혼계영|계영"),
]


_NEGATED = re.compile(r"(다이빙|수구|아티스틱(?:\s*스위밍)?|핀\s*수영|오픈\s*워터(?:\s*스위밍)?|경영)\s*(?:종목\s*)?(?:은|는)?\s*"
                      r"(?:미개최|미실시|미운영|제외|없음|불포함|개최\s*안\s*함|하지\s*않)")


def sports_for(*texts, force=None):
    """(목록, 추정 여부). 종목 낱말이 없고 '수영대회'면 경영으로 두되 추정 표시를 남긴다.
    '다이빙 미개최' 같은 부정 표현은 종목으로 읽지 않는다."""
    if force:
        return [force], False
    s = _NEGATED.sub(" ", " ".join(clean(t) for t in texts))
    out = [name for name, pat in SPORTS if re.search(pat, s)]
    if out:
        return out, False
    if re.search(r"수영|마스터즈|swim", s, re.I):
        return ["경영"], True
    return ["기타"], True


def _dists(txt):
    return {int(x) for x in re.findall(r"(?<!\d)(\d{2,4})(?!\d)", txt) if int(x) in (25, 50, 100, 200, 400, 800, 1500)}


def freestyle(text):
    """요강·공고 글에서 자유형 거리. (거리집합, 목록으로 확인됐는지, 근거)."""
    s = clean(text).replace("ｍ", "m").replace("M", "m").replace("미터", "m")
    s = re.sub(r"[ㆍ･・•]", "·", s)
    s = re.sub(r"평\s+영", "평영", re.sub(r"배\s+영", "배영", re.sub(r"접\s+영", "접영", s)))
    s = re.sub(r"자\s*유\s*형", "자유형", s)
    found, listed, ev = set(), False, ""
    for m in re.finditer(r"자유형\s*[:：(\[]?\s*((?:\d{2,4}\s*m?\s*(?:[·,/、]|및|와)\s*)*\d{2,4})\s*m(?![a-z])", s):
        ds = _dists(m.group(1))
        found |= ds
        if len(ds) >= 2:
            listed = True
        ev = ev or s[max(0, m.start() - 10):m.end() + 10]
    for m in re.finditer(r"(?<!\d)(\d{2,4})\s*m\s*자유형", s):
        found |= _dists(m.group(1))
        ev = ev or s[max(0, m.start() - 10):m.end() + 10]
    # 표: '구 분 [발차기] 자유형 평영 배영 접영 개인혼영 | 학생부 남 50·100m 50·100m …' — 머리줄에서 자유형 칸 위치를 찾고
    #     각 줄의 그 칸만 읽는다(빈칸은 '*'·'-'·'×'). 머리줄 앞 칸(발차기 등)을 세지 않으면 열이 어긋난다.
    s2 = re.sub(r"개인\s*혼영", "개인혼영", s)
    for m in re.finditer(r"((?:(?:발차기|킥판|자유형|평영|배영|접영|개인혼영|혼영)\s+){1,7}(?:발차기|킥판|자유형|평영|배영|접영|개인혼영|혼영))", s2):
        cols = m.group(1).split()
        if "자유형" not in cols or len(cols) < 2:
            continue
        idx, ncol = cols.index("자유형"), len(cols)
        tail = s2[m.end():m.end() + 600]
        tokens = [a or b for a, b in re.findall(r"(?<![\d·])(\d{2,4}(?:\s*·\s*\d{2,4})*)\s*m(?![a-z])|(?<!\S)([*×X\-–])(?=\s|[가-힣]|$)", tail)]
        if len(tokens) < ncol:
            continue
        rows = [tokens[i:i + ncol] for i in range(0, len(tokens) - len(tokens) % ncol, ncol)]
        got = set()
        for row in rows[:10]:
            if row[idx] not in ("*", "×", "X", "-", "–"):
                got |= _dists(row[idx])
        if got:
            found |= got
            listed = True
            ev = ev or ("요강 표(자유형 칸): " + " / ".join(r[idx] for r in rows[:6]))
    return found, listed, clean(ev)[:140]


def freestyle_flags(text):
    found, listed, ev = freestyle(text)
    if not found:
        return None, None, ""
    f50 = True if 50 in found else (False if listed else None)
    f100 = True if 100 in found else (False if listed else None)
    return f50, f100, ev


def status_from_title(t):
    t = clean(t)
    if re.search(r"(?:대회|개최)\s*(?:전면\s*)?취소|취소\s*(?:안내|공지|알림)|\[\s*취소\s*\]|\(\s*취소\s*\)", t):
        return "cancelled"
    if re.search(r"(?:대회|개최|일정)\s*(?:잠정\s*)?연기|연기\s*(?:안내|공지|알림)|순연|\[\s*연기\s*\]|\(\s*연기\s*\)", t):
        return "postponed"
    return ""


def apply_closed_from(t):
    return bool(re.search(r"(?:접수|참가|모집|신청)\s*(?:조기\s*)?마감|선착순\s*마감|[-–]\s*마감\s*$", clean(t)))


def tidy_title(t):
    """게시판 제목 꼬리(개최 알림 · (신청서 수정-…) · 잘린 '...')를 떼어 대회명만 남긴다."""
    t = clean(t)
    for _ in range(3):
        t = re.sub(r"^\s*(?:\[[^\]]{1,12}\]|\([^)]{1,10}\)|공지|참가\s*마감|접수\s*마감)\s*", "", t)
    t = re.sub(r"\s*[-–]\s*마감\s*$", "", t)
    t = re.sub(r"\s*(?:\.{2,}|…)\s*$", "", t)
    t = re.sub(r"\s*\([^)]*(?:수정|필독|문의|마감|변경|추가|안내|공지)[^)]*\)?\s*$", "", t)
    t = re.sub(r"\s*(?:개최\s*)?(?:알림|안내|공지|홍보\s*안내|개최)\s*$", "", t)
    return t.strip(" -·")


def edition(title):
    m = re.search(r"제\s*(\d{1,3})\s*회", title or "")
    return int(m.group(1)) if m else None


_CORE_SUB = [
    (r"20\d{2}\s*년?", " "), (r"제\s*\d{1,3}\s*회", " "), (r"[\[\](){}<>「」『』【】]", " "),
    (r"광역시|특별시|특례시|특별자치시", "시"), (r"특별자치도", "도"),
    (r"경상북도", "경북"), (r"경상남도", "경남"), (r"충청북도", "충북"), (r"충청남도", "충남"),
    (r"전라북도", "전북"), (r"전라남도", "전남"), (r"경기도(?!지사|의장)", "경기"), (r"강원도", "강원"),
    (r"수영\s*연맹", "연맹"), (r"(장|감|사|수)\s*기(?![가-힣])", r"\1배"), (r"(장|감|사|수)기\s", r"\1배 "),
    # '수원시체육회장배'·'서울시연맹회장배' → 도시 이름 뒤 '시'는 뗀다('시장배'의 시는 둔다)
    (r"([가-힣]{2})\s*시\s*(?=체육회|연맹|수영|구청|교육감|생활|마스터즈|전국|$)", r"\1 "),
]
_FILLERS = r"전국|생활\s*체육|마스터즈|마스터스|동호인|클럽\s*대항|클럽|수영\s*대회|수영\s*경기|대회|수영|겸|및|개최|알림|안내|" \
           r"요강|공지|참가|신청|모집|선착순|접수|마감|홍보|프로그램|필독|수정|최종|변경|대회명"


def core_key(title):
    s = clean(title)
    for a, b in _CORE_SUB:
        s = re.sub(a, b, s)
    s = re.sub(_FILLERS, " ", s)
    s = re.sub(r"배(?=\s|$)", " ", s)
    s = re.sub(r"[^가-힣A-Za-z0-9]", " ", s)
    return "".join(s.split()).lower()


def _bigrams(s):
    return {s[i:i + 2] for i in range(len(s) - 1)} or ({s} if s else set())


def overlap(a, b):
    """짧은 이름의 글자쌍이 긴 이름에 얼마나 들어 있나 — '서울대축전선발전' ↔ '전국생활체육대축전 서울시 대표 선발전'."""
    A, B = _bigrams(core_key(a)), _bigrams(core_key(b))
    if not A or not B:
        return 0.0
    return len(A & B) / min(len(A), len(B))


def title_sim(a, b):
    ka, kb = core_key(a), core_key(b)
    if not ka or not kb:
        return 0.0
    if ka == kb:
        return 1.0
    short, long_ = sorted((ka, kb), key=len)
    if len(short) >= 2 and short in long_:
        return 0.9
    A, B = _bigrams(ka), _bigrams(kb)
    return len(A & B) / max(1, len(A | B))


def days_between(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def gap_days(a, b):
    """두 기간 사이 빈 날 수(겹치면 0)."""
    s1, e1 = a.get("start_date"), a.get("end_date") or a.get("start_date")
    s2, e2 = b.get("start_date"), b.get("end_date") or b.get("start_date")
    if not (s1 and s2):
        return None
    lo, hi = max(s1, s2), min(e1, e2)
    return 0 if lo <= hi else days_between(lo, hi)


def explicit_sports(x):
    sp = set(x.get("sports") or [])
    return set() if x.get("sports_inferred") else sp - {"기타"}


def kind_conflict(ta, tb):
    """'마스터즈 대회'와 '국가대표 선발대회'처럼 대회 성격이 이름에서 서로 다르면 같은 대회가 아니다."""
    ka = set(kinds_for(ta)) - {"other"}
    kb = set(kinds_for(tb)) - {"other"}
    return bool(ka and kb and not (ka & kb))


def same_meet(a, b):
    """두 관측(또는 대회)이 같은 대회인가. 이름이 달라도(약칭·주최 표기) 날짜·지역·종목으로 묶는다."""
    ua, ub = a.get("official_url") or "", b.get("official_url") or ""
    if ua and ua == ub and not ua.rstrip("/").endswith(("/11", "schedule")):
        return True
    ea, eb = edition(a.get("title")), edition(b.get("title"))
    if ea and eb and ea != eb:
        return False
    sa, sb = explicit_sports(a), explicit_sports(b)
    if sa and sb and not (sa & sb):
        return False
    if a.get("sido") and b.get("sido") and a["sido"] != b["sido"]:
        return False
    if a.get("sigungu") and b.get("sigungu") and a["sigungu"] != b["sigungu"]:
        return False
    if kind_conflict(a.get("title", ""), b.get("title", "")):
        return False
    gap = gap_days(a, b)
    if gap is None:
        return False
    sim = title_sim(a.get("title", ""), b.get("title", ""))
    short = min(len(core_key(a.get("title", ""))), len(core_key(b.get("title", ""))))
    same_year = a["start_date"][:4] == b["start_date"][:4]
    if sim >= 0.9:
        if short <= 2:
            return gap <= 1 and bool(a.get("sido")) and a.get("sido") == b.get("sido")
        if gap <= 3:
            return True
        return same_year and gap <= 75 and bool(a.get("sido") or b.get("sido"))
    if sim >= 0.6 and gap <= 1 and a.get("sido") and a.get("sido") == b.get("sido"):
        return True
    # 같은 날 · 같은 시·도(시·군·구가 서로 다르지 않음)에서 짧은 이름이 긴 이름에 거의 다 들어 있으면 같은 대회
    if gap == 0 and a.get("sido") and a.get("sido") == b.get("sido") and short >= 4 and \
            overlap(a.get("title", ""), b.get("title", "")) >= 0.7:
        return True
    return False


# ───────────────────────── 관측값 ─────────────────────────
def host_of(url):
    return urlparse(url or "").netloc.lower().split(":")[0]


def is_official_url(url):
    h = host_of(url)
    if not h:
        return False
    if any(h == u or h.endswith("." + u) for u in UNOFFICIAL_HOSTS):
        return False
    return h.endswith(OFFICIAL_HOST_SUFFIX) or any(h == o or h.endswith("." + o) for o in OFFICIAL_HOSTS)


def make_obs(source, tier, title, *, start="", end="", venue="", place="", url="", official_url="",
             apply_open="", apply_close="", eligibility="", events="", fee="", pool="", status="",
             apply_closed=False, apply_url="", sport_force=None, kind_hint="", free=None, attachments=None,
             extra_text=""):
    title = tidy_title(title)
    if not title or NON_SWIM.search(title) and not re.search(r"수영\s*대회", title):
        return None
    venue, place = clean(venue), clean(place)
    if R.is_foreign(title, venue, place):
        return None
    sido, sigungu = R.resolve(place, venue, title)
    sports, inferred = sports_for(title, events, extra_text, force=sport_force)
    if free is None:
        f50, f100, ev = freestyle_flags(" ".join([events, extra_text]))
    else:
        f50, f100, ev = free
    if "경영" not in sports and not inferred:
        f50 = False if f50 is None else f50
        f100 = False if f100 is None else f100
        ev = ev or ("경영(자유형) 없는 종목: " + "·".join(sports))
    if apply_open and apply_close and apply_open > apply_close:
        apply_open = ""
    if start and apply_close and apply_close > (end or start):
        apply_close = ""                           # 대회 뒤에 끝나는 접수 마감은 잘못 읽은 값
    if start and apply_open and apply_open > (end or start):
        apply_open = ""
    return {
        "source": source, "tier": tier, "title": title, "start_date": start or "", "end_date": end or start or "",
        "venue": venue, "place": place, "sido": sido, "sigungu": sigungu, "url": url,
        "official_url": official_url if is_official_url(official_url) else "",
        "apply_open": apply_open or "", "apply_close": apply_close or "", "apply_url": apply_url or "",
        "eligibility": clean(eligibility)[:220], "events": clean(events)[:220], "fee": fee or "",
        "pool": pool or "", "status": status or status_from_title(title), "apply_closed": bool(apply_closed),
        "sports": sports, "sports_inferred": inferred, "kind_hint": kind_hint,
        "free50": f50, "free100": f100, "free_evidence": ev, "attachments": attachments or [],
    }


# ───────────────────────── 수집처 ─────────────────────────
def scrape_korswim(f, state, max_pages=6, detail_limit=20):
    from bs4 import BeautifulSoup
    out, seen = [], set()
    for page in range(1, max_pages + 1):
        url = "https://www.korswim.co.kr/11" + (f"?page={page}" if page > 1 else "")
        try:
            soup, _ = f.soup(url)
        except Exception:
            if page == 1:
                raise
            break
        rows = 0
        for a in soup.select("div.s11-txt2 a[href]") or soup.find_all("a", href=True):
            label = clean(a.get_text(" ", strip=True))
            m = re.search(r"대회기간\s*:\s*(20\d\d-\d\d-\d\d)\s*~\s*(20\d\d-\d\d-\d\d)", label)
            if not m:
                continue
            href = urljoin(url, a["href"])
            if href in seen:
                continue
            seen.add(href)
            h2, sp = a.find("h2"), a.find("span")
            title = clean(h2.get_text(" ", strip=True)) if h2 else label[:m.start()].removeprefix("공지").strip()
            venue = clean(sp.get_text(" ", strip=True)).lstrip("-").strip() if sp else ""
            if not h2 and " - " in title:
                title, venue = title.rsplit(" - ", 1)
            obs = make_obs("korswim", "official", title, start=m[1], end=m[2], venue=venue, url=href,
                           official_url=href, kind_hint="elite" if "전국수영대회" in title else "")
            if obs:
                out.append(obs)
            rows += 1
        if not rows:
            if page == 1:
                raise StructureError("대한수영연맹 대회일정 목록에서 '대회기간' 항목을 찾지 못함")
            break
    # 다가오는 대회는 원문(개요 · 참가자격 · 참가비 · 신청기간)과 PDF 요강까지 본다.
    t0 = today().isoformat()
    upcoming = [o for o in out if (o["end_date"] or o["start_date"]) >= (today() - timedelta(days=1)).isoformat()]
    for o in sorted(upcoming, key=lambda x: x["start_date"])[:detail_limit]:
        try:
            d = korswim_detail(f, o["url"], state)
        except Exception as exc:
            o["detail_error"] = type(exc).__name__
            continue
        if d:
            out.append(d)
    _ = t0
    return out


def korswim_detail(f, url, state):
    soup, _ = f.soup(url)
    con = content_node(soup, "#bo_v_con")
    if con is None:
        raise StructureError("본문 없음")
    lines = block_text(con)
    title_el = soup.select_one("#bo_v_title") or soup.find("h1") or soup.title
    page_title = clean(title_el.get_text(" ", strip=True) if title_el else "").split(">")[0].strip()
    nf = notice_fields(lines, today().year)
    title = nf["title"] or page_title
    attachments = []
    pdf_text = ""
    for a in soup.select('a[href*="download.php"]'):
        name = clean(a.get_text(" ", strip=True))
        attachments.append({"name": re.sub(r"\s*\(\d+(?:\.\d+)?[KMG]\)\s*\[\d+\]\s*$", "", name)[:120],
                            "url": urljoin(url, a["href"])})
    pdfs = [x for x in attachments if x["name"].lower().endswith(".pdf") and "요강" in x["name"]]
    pdfs.sort(key=lambda x: ("공지" in x["name"], len(x["name"])))
    for att in pdfs[:2]:
        pdf_text += " " + analyze_pdf(f, att["url"], state)
    body = " ".join(lines)
    full = body + " " + pdf_text
    elig = nf["eligibility"]
    pe = re.search(r"참가\s*자격\s*[:：]?\s*(.{10,240}?)(?=\s\d\.\s|\s[가-하]\.\s신청|$)", clean(pdf_text))
    if pe and len(pe.group(1)) > len(elig):
        elig = pe.group(1)
    fee = nf["fee"] or fee_text((re.search(r"참\s*가\s*비\s*[:：]?\s*([^※]{2,60}?원)", clean(full)) or [None, ""])[1])
    apply_url = ""
    for a in con.find_all("a", href=True):
        tx, href = clean(a.get_text(" ", strip=True)), urljoin(url, a["href"])
        if re.search(r"참가\s*신청|신청\s*하기|접수\s*하기|온라인\s*접수", tx) and "." in host_of(href) and "download.php" not in href:
            apply_url = href
            break
    if not (nf["start_date"]):
        return None
    events = nf["events"]
    f50, f100, ev = freestyle_flags(full)
    if ev and pdfs and ev in clean(pdf_text):
        ev = "공식 요강 PDF — " + ev
    return make_obs("korswim_detail", "official", title, start=nf["start_date"], end=nf["end_date"],
                    venue=nf["venue"], url=url, official_url=url, apply_open=nf["apply_open"],
                    apply_close=nf["apply_close"], eligibility=elig, events=events, fee=fee, pool=nf["pool"],
                    apply_url=apply_url, free=(f50, f100, ev), attachments=attachments[:8],
                    extra_text=nf["events"] + " " + clean(pdf_text)[:4000],
                    kind_hint="elite" if "전국수영대회" in title else "")


def analyze_pdf(f, url, state):
    """요강 PDF 글자를 뽑는다(한 번만 — 같은 주소는 캐시). 실패해도 대회 기록은 남는다."""
    cache = state.setdefault("cache", {}).setdefault("pdf", {})
    if url in cache:
        return cache[url].get("text", "")
    try:
        r = f.get(url, max_bytes=15_000_000)
        from pypdf import PdfReader
        rd = PdfReader(io.BytesIO(r.content))
        text = clean(" ".join((p.extract_text() or "") for p in rd.pages[:30]))
        cache[url] = {"at": today().isoformat(), "pages": len(rd.pages), "chars": len(text),
                      "sha1": hashlib.sha1(r.content).hexdigest()[:16], "text": text[:20000]}
        return text
    except Exception as exc:
        cache[url] = {"at": today().isoformat(), "error": type(exc).__name__, "text": ""}
        return ""


def scrape_kua(f, state, max_pages=3):
    out, seen = [], set()
    for page in range(1, max_pages + 1):
        url = "https://www.kua.or.kr/competition-info/schedule" + (f"?page={page}" if page > 1 else "")
        try:
            r = f.get(url)
        except Exception:
            if page == 1:
                raise
            break
        text = r.content.decode("utf-8", "replace")
        segs = re.findall(r'\{\\"id\\":\d+,\\"category\\".*?\\"isTopFixed\\":(?:true|false)\}', text)
        items = []
        for s in segs:
            try:
                items.append(json.loads(json.loads('"' + s + '"')))
            except ValueError:
                continue
        if not items:
            if page == 1:
                raise StructureError("대한수중핀수영협회 일정 자료(JSON)를 찾지 못함")
            break
        new = 0
        for it in items:
            if it.get("id") in seen:
                continue
            seen.add(it.get("id"))
            new += 1
            if clean(it.get("category")) not in ("국내", ""):
                continue
            ds = parse_dates(it.get("competitionPeriod"))
            ap = parse_dates(it.get("applicationPeriod"))
            link = f"https://www.kua.or.kr/competition-info/schedule/{it['id']}"
            title = clean(it.get("title")).replace("개최 안내", "").strip()
            obs = make_obs("kua", "official", title, start=ds[0] if ds else "", end=ds[-1] if ds else "",
                           venue=it.get("location", ""), place=it.get("location", ""), url=link, official_url=link,
                           apply_open=ap[0] if ap else "", apply_close=ap[-1] if len(ap) > 1 else "",
                           sport_force="오픈워터" if re.search(r"해수욕장|바다|수면|방파제|호수", it.get("location", "")) else "핀수영",
                           status="cancelled" if "취소" in clean(it.get("status")) else "")
            if obs and obs["start_date"]:
                if obs["sports"] == ["오픈워터"]:
                    obs["sports"] = ["핀수영", "오픈워터"]
                out.append(obs)
        if not new:
            break
    if not out:
        raise StructureError("대한수중핀수영협회 대회 0건")
    return out


ANNOUNCE = re.compile(r"대회|선발전|챔피언십|페스티벌|기록회|인증대회")
FOLLOWUP = re.compile(r"결과|상장|대진표|감독자\s*회의|대표자\s*회의|경기\s*순서|입장\s*순서|프로그램|AD\s*카드|텐트|천막|기록지|"
                      r"성적|사진|입금|환불|주차|셔틀|시상|명단|조\s*편성|경기\s*일정표|타임\s*테이블|순위|기록\s*증|"
                      r"심판|강습회|교육|자격|채용|이사회|총회|회의록|예산|결산|선수\s*등록|홍보\s*영상")

BOARDS = [
    {"key": "seoulswim", "url": "http://www.seoulswim.or.kr/bbs/board.php?bo_table=schedule",
     "link": r"bo_table=schedule&wr_id=\d+", "content": "#bo_v_con"},
    {"key": "gswimming", "url": "http://www.gswimming.com/31", "link": r"gswimming\.com/31/\d+", "content": "#bo_v_con"},
    {"key": "busanswim", "url": "http://www.busanswimming.kr/BoardList.asp?gubun=notice",
     "link": r"BoardView\.asp\?idx=\d+", "content": None},
    {"key": "djswim", "url": "https://djswimming.or.kr/bizdemo38944/mp5/mp5_sub1.php?sub=01",
     "link": r"com_board_basic=read_form&com_board_idx=\d+", "content": None},
]


def _canon_board_url(href):
    """목록의 page/검색 꼬리를 떼고 같은 이름의 값은 한 번만 — 같은 글을 같은 주소로 본다."""
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
    p = urlsplit(href)
    drop = {"page", "searchcode", "searchstr", "sca", "sfl", "stx", "sst", "sod", "spt", "com_board_search_code",
            "com_board_search_value1", "com_board_search_value2", "com_board_page"}
    seen, q = set(), []
    for k, v in parse_qsl(p.query, keep_blank_values=False):
        if k.lower() in drop or k in seen:
            continue
        seen.add(k)
        q.append((k, v))
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(q), ""))


def scrape_board(f, state, cfg, detail_limit=12):
    soup, _ = f.soup(cfg["url"])
    links = []
    for a in soup.find_all("a", href=True):
        href = urljoin(cfg["url"], a["href"])
        if not re.search(cfg["link"], href):
            continue
        t = clean(a.get_text(" ", strip=True))
        if len(t) < 6:
            continue
        links.append((t, _canon_board_url(href)))
    if not links:
        raise StructureError("게시판 목록 링크 형식을 찾지 못함")
    out, seen = [], set()
    cache = state.setdefault("cache", {}).setdefault("notice", {})
    fetched = 0
    for t, href in links:
        if href in seen:
            continue
        seen.add(href)
        st, closed = status_from_title(t), apply_closed_from(t)
        if not ANNOUNCE.search(t) or (FOLLOWUP.search(t) and not (st or closed)):
            continue
        c = cache.get(href)
        stale = _stale(c)
        if stale and fetched < detail_limit:
            fetched += 1
            try:
                ds, _ = f.soup(href)
                lines = block_text(content_node(ds, cfg.get("content")))
                c = {"at": today().isoformat(), "lines": _cap_lines(lines), "attachments": attachments_of(ds, href),
                     "ok": bool(notice_fields(lines, today().year)["start_date"])}
                cache[href] = c
            except Exception as exc:
                c = c or {"at": today().isoformat(), "error": type(exc).__name__}
                cache[href] = c
        if not c or not c.get("lines"):
            continue
        nf = notice_fields(c["lines"], today().year)
        c["body"] = " ".join(c["lines"])
        title = nf["title"] or re.sub(r"\s*(?:개최\s*)?(?:알림|안내|공지)\s*$", "", re.sub(r"^\s*(?:\[[^\]]*\]|공지)\s*", "", t))
        title = re.sub(r"^(?:참가\s*마감|접수\s*마감)\s*", "", title).strip()
        if not nf["start_date"] and not (st or closed):
            continue
        atts = c.get("attachments") or []
        pdf_text = ""
        if nf["start_date"] and (nf["end_date"] or nf["start_date"]) >= today().isoformat():
            for att in [a for a in atts if a["name"].lower().endswith(".pdf") and "요강" in a["name"]][:2]:
                pdf_text += " " + analyze_pdf(f, att["url"], state)
        f50, f100, ev = freestyle_flags(nf["events"] + " " + c.get("body", "")[:3000] + " " + pdf_text)
        if ev and pdf_text and ev in clean(pdf_text):
            ev = "공식 요강 PDF — " + ev
        fee = nf["fee"] or fee_text((re.search(r"참\s*가\s*비\s*[:：]?\s*([^※]{2,60}?원)", clean(pdf_text)) or [None, ""])[1])
        obs = make_obs(cfg["key"], "official", title, start=nf["start_date"], end=nf["end_date"], venue=nf["venue"],
                       url=href, official_url=href, apply_open=nf["apply_open"], apply_close=nf["apply_close"],
                       eligibility=nf["eligibility"], events=nf["events"], fee=fee, pool=nf["pool"],
                       status=st, apply_closed=closed, free=(f50, f100, ev), attachments=atts[:8],
                       extra_text=nf["events"] + " " + c.get("body", "")[:1500])
        if obs:
            obs["notice_title"] = t
            out.append(obs)
    return out


def attachments_of(soup, page_url):
    """게시글 첨부(요강 · 신청서). 파일 이름이 링크 글자에 있는 게시판(그누보드 등)만 — 이름 없는 링크는 뺀다."""
    out = []
    for a in soup.find_all("a", href=True):
        name = clean(a.get_text(" ", strip=True))
        href = urljoin(page_url, a["href"])
        if not re.search(r"\.(?:pdf|hwp|hwpx|xlsx?|docx?|zip)\b", name + " " + href, re.I):
            continue
        if not re.search(r"download|/data/file/|DataFile|files/|attach|\.pdf|\.hwp", href, re.I):
            continue
        name = re.sub(r"\s*\(\d+(?:\.\d+)?[KMG]B?\)\s*(?:\[\d+\]|\d+회 다운로드)?.*$", "", name)[:120] or href.rsplit("/", 1)[-1][:80]
        item = {"name": name, "url": href}
        if item not in out:
            out.append(item)
    return out[:10]


def scrape_swimming_co_kr(f, state):
    soup, _ = f.soup("https://swimming.co.kr/")
    cards = soup.select("article.swim-card")
    if not cards:
        raise StructureError("swimming.co.kr 카드(article.swim-card) 없음")
    out, bad = [], 0
    for c in cards:
        h3 = c.find("h3")
        dd = {clean(dt.get_text(" ", strip=True)): clean(dt.find_next_sibling("dd").get_text(" ", strip=True))
              for dt in c.select("dt") if dt.find_next_sibling("dd")}
        if not h3 or "대회일" not in dd:
            bad += 1
            continue
        ds = parse_dates(dd.get("대회일"))
        ap = parse_dates(dd.get("접수"))
        region = clean((c.select_one(".region") or c).get_text(" ", strip=True)) if c.select_one(".region") else ""
        badge = clean(c.select_one(".badge").get_text(" ", strip=True)) if c.select_one(".badge") else ""
        link = ""
        for a in c.select("a[href]"):
            if "요강" in a.get_text() or "공고" in a.get_text():
                link = a["href"]
                break
        title = clean(h3.get_text(" ", strip=True))
        elig = dd.get("대상", "")
        elig = "" if re.search(r"^공식\s*요강\s*확인$|^확인\s*필요$", elig) else elig
        events = dd.get("종목", "")
        events = "" if re.search(r"^공식\s*요강\s*확인$|^확인\s*필요$", events) else events
        obs = make_obs("swimming_co_kr", "secondary", title, start=ds[0] if ds else "", end=ds[-1] if ds else "",
                       venue=dd.get("장소", ""), place=region.replace("경상", "").replace("충청", "").replace("전라", ""),
                       url="https://swimming.co.kr/", official_url=link,
                       apply_open=ap[0] if len(ap) > 1 else "", apply_close=ap[-1] if ap else "",
                       eligibility=elig, events=events, fee=fee_text(dd.get("참가비", "")),
                       status="cancelled" if "취소" in badge else ("postponed" if "연기" in badge else ""),
                       apply_closed=False)
        if obs and obs["start_date"]:
            obs["source_note"] = dd.get("출처", "")[:120]
            out.append(obs)
    if bad > len(cards) / 2:
        raise StructureError(f"swimming.co.kr 카드 {len(cards)}개 중 {bad}개에서 '대회일' 항목 없음")
    return out


def scrape_whoisfast(f, state):
    url = f"https://whoisfast.com/meets?year={today().year}"
    soup, _ = f.soup(url)
    items = soup.select("li.meet")
    if not items:
        raise StructureError("whoisfast 대회 목록(li.meet) 없음")
    out = []
    for li in items:
        t_el = li.select_one(".meet-title")
        d_el = li.select_one(".meet-date")
        if not (t_el and d_el):
            continue
        ds = parse_dates(d_el.get_text(" ", strip=True))
        meta = clean(li.select_one(".meet-meta").get_text(" ", strip=True)) if li.select_one(".meet-meta") else ""
        parts = [p.strip() for p in meta.split("·")]
        apply_close = ""
        place, venue = "", ""
        for p in parts:
            if p.startswith("접수 마감"):
                d = parse_dates(p)
                apply_close = d[0] if d else ""
            elif re.search(r"^\d{2}m\s", p):
                continue                           # 수영장 규격: whoisfast 는 모두 '50m 장수로'로 표시해 근거로 쓰지 않는다
            elif not place and R.resolve(p)[0] and not re.search(r"수영장|센터|체육|스포츠|풀|학교|타운|복지관|운동장", p):
                place = p
            elif not venue:
                venue = p
        badge = clean(li.select_one(".badge").get_text(" ", strip=True)) if li.select_one(".badge") else ""
        link = ""
        for a in li.select(".meet-links a[href]"):
            if "요강" in a.get_text():
                link = a["href"]
        obs = make_obs("whoisfast", "secondary", t_el.get_text(" ", strip=True), start=ds[0] if ds else "",
                       end=ds[-1] if ds else "", venue=venue, place=place, url=url, official_url=link,
                       apply_close=apply_close, kind_hint="masters",
                       status="cancelled" if "취소" in badge else ("postponed" if "연기" in badge else ""))
        if obs and obs["start_date"]:
            out.append(obs)
    if not out:
        raise StructureError("whoisfast 날짜가 있는 대회 0건")
    return out


SEARCH_TEMPLATES = [
    "{y} 마스터즈 수영대회 요강", "{y} 수영대회 개최요강", "{y} 생활체육 수영대회 참가신청", "{y} 시장배 수영대회",
    "{y} 구청장배 수영대회", "{y} 수영연맹회장배 수영대회", "{y} 교육감배 수영대회", "{y} 도지사배 수영대회",
    "{y} 핀수영대회 개최", "{y} 오픈워터 수영대회", "{y} 수영 선수권대회", "{y} 꿈나무 수영대회",
]


def lead_title(t):
    """검색 결과 제목 꼬리(' | 사이트명', ' > 게시판', ' : 네이버 블로그') 제거."""
    t = clean(t)
    t = re.split(r"\s+[|>]\s+|\s+:\s+네이버|\s+-\s+(?:네이버|다음)\s", t)[0]
    return tidy_title(t)


def discover_search(state, prev_leads, search=None, limit_queries=None):
    """검색엔진(DDGS)으로 기존 수집처에 없는 공고 후보를 찾는다. 후보는 '미확정'으로만 남긴다."""
    y = today().year
    queries = [t.format(y=y) for t in SEARCH_TEMPLATES] + [f"{y} {s} 수영대회" for s in R.SIDO]
    if today().month >= 10:
        queries += [f"{y + 1} 마스터즈 수영대회", f"{y + 1} 수영대회 요강"]
    if limit_queries:
        queries = queries[:limit_queries]
    if search is None:
        from ddgs import DDGS

        def search(q):
            last = None
            for region in ("wt-wt", "kr-kr"):
                try:
                    return list(DDGS().text(q, region=region, safesearch="moderate", max_results=15) or [])
                except Exception as exc:
                    last = exc
                    time.sleep(1.2)
            raise last
    leads = {x["url"]: x for x in prev_leads}
    errors, hits = 0, 0
    for q in queries:
        try:
            rows = search(q)
        except Exception:
            errors += 1
            continue
        for r in rows:
            url = clean(r.get("href") or r.get("url"))
            title = lead_title(r.get("title"))
            body = clean(r.get("body") or r.get("snippet"))
            if not url.startswith("http") or not title:
                continue
            h = host_of(url)
            if any(x in h for x in ("wikipedia", "namu.wiki", "worldaquatics", "youtube", "whoisfast.com", "myranking", "swimming.co.kr")):
                continue
            s = title + " " + body
            if not re.search(r"수영\s*대회|마스터즈|핀수영|수구|다이빙|오픈워터|선발전|선수권", s):
                continue
            if not re.search(r"대회|선발전|선수권|챔피언십", title):
                continue
            if re.search(r"결과|기록\s*조회|후기|순위|영상|강습|모집\s*공고|채용", title):
                continue
            ys = [int(v) for v in re.findall(r"(?<!\d)(20\d{2})(?!\d)", s)]
            if ys and max(ys) < y:
                continue
            hits += 1
            if url in leads:
                continue
            ds = parse_dates(body)
            leads[url] = {"url": url, "title": title[:140], "host": h, "snippet": body[:220], "query": q,
                          "first_seen": today().isoformat(), "official_host": is_official_url(url),
                          "dates_in_snippet": ds[:3]}
    if errors == len(queries):
        raise IOError("검색 질의 전부 실패")
    return list(leads.values()), {"queries": len(queries), "errors": errors, "hits": hits}


def confirm_official_links(f, state, records, limit=25):
    """2차 자료에만 있는 다가오는 대회의 '공식 공고' 원문을 열어 이름·날짜가 맞는지 확인한다."""
    out = []
    cache = state.setdefault("cache", {}).setdefault("link", {})
    t = today().isoformat()
    covered = {"korswim", "korswim_detail", "kua", "seoulswim", "gswimming", "busanswim", "djswim"}
    todo = []
    for rec in records.values():
        d = rec.get("derived", {})
        if (d.get("end_date") or d.get("start_date") or "") < t:
            continue
        if any(o["source"] in covered for o in rec["obs"].values()):
            continue
        for o in rec["obs"].values():
            u = o.get("official_url")
            if u and is_official_url(u) and "download" not in u and not u.lower().endswith((".pdf", ".hwp", ".hwpx")):
                todo.append((u, d))
                break
    fetched = 0
    for u, d in todo:
        c = cache.get(u)
        if _stale(c) and fetched < limit:
            fetched += 1
            try:
                soup, _ = f.soup(u)
                lines = block_text(content_node(soup))
                page_title = clean(soup.title.get_text(" ", strip=True) if soup.title else "")
                c = {"at": today().isoformat(), "lines": _cap_lines(lines), "page_title": page_title[:160],
                     "ok": bool(notice_fields(lines, int(d["start_date"][:4]))["start_date"])}
            except RobotsDenied:
                c = {"at": today().isoformat(), "error": "robots"}
            except Exception as exc:
                c = {"at": today().isoformat(), "error": type(exc).__name__}
            cache[u] = c
        if not c or not c.get("lines"):
            continue
        nf = notice_fields(c["lines"], int(d["start_date"][:4]))
        body = " ".join(c["lines"])
        title = nf["title"] or ""
        sim = max(title_sim(title, d["title"]) if title else 0, title_sim(c.get("page_title", ""), d["title"]))
        start, end = nf["start_date"], nf["end_date"]
        if not start:
            continue
        # 원문에 대회명이 없어도 개최일과 장소가 그대로 맞으면 같은 공고로 본다(다른 글은 확인 실패로 둔다).
        same_place = bool(nf["venue"] and d.get("venue")) and (overlap(nf["venue"], d["venue"]) >= 0.6 or
                                                              nf["venue"].replace(" ", "") in d["venue"].replace(" ", "") or
                                                              d["venue"].replace(" ", "") in nf["venue"].replace(" ", ""))
        if sim < 0.6 and core_key(d["title"]) not in core_key(body)[:3000] and not (start == d["start_date"] and same_place):
            continue
        obs = make_obs("official_link", "official", title if sim >= 0.6 else d["title"], start=start, end=end,
                       venue=nf["venue"], url=u, official_url=u, apply_open=nf["apply_open"], apply_close=nf["apply_close"],
                       eligibility=nf["eligibility"], events=nf["events"], fee=nf["fee"], pool=nf["pool"],
                       extra_text=nf["events"] + " " + body[:3000])
        if obs:
            out.append(obs)
    return out


# ───────────────────────── 병합 · 계산 ─────────────────────────
def _rank(o):
    src = o.get("source", "")
    return (TIER_RANK.get(o.get("tier"), 0), -SOURCE_ORDER.index(src) if src in SOURCE_ORDER else -99)


def derive(rec):
    """관측값들 → 화면용 값 한 벌. 공식 > 2차 > 미확정, 같은 등급은 SOURCE_ORDER."""
    obs = sorted(rec["obs"].values(), key=_rank, reverse=True)
    dated = [o for o in obs if o.get("start_date")]
    if not dated:
        return None
    top = dated[0]
    conflicts = {}

    def pick(key, cands=None, allow_empty=False):
        cands = cands if cands is not None else obs
        vals = [o.get(key) for o in cands if o.get(key) not in (None, "", [])]
        return vals[0] if vals else ("" if not allow_empty else None)

    # 날짜는 가장 강한 근거 하나에서 시작·종료를 같이 가져온다(섞지 않는다).
    start, end = top["start_date"], top.get("end_date") or top["start_date"]
    others = {(o["start_date"], o.get("end_date") or o["start_date"]) for o in dated if TIER_RANK[o["tier"]] >= TIER_RANK[top["tier"]]}
    if len(others) > 1:
        conflicts["dates"] = sorted(f"{a}~{b}" for a, b in others)
    if top["tier"] == "secondary":                   # 2차 자료끼리면 넓은 기간(이틀짜리 대회의 하루만 적은 목록 보정)
        same = [o for o in dated if o["tier"] == "secondary" and gap_days(o, top) == 0]
        start = min(o["start_date"] for o in same)
        end = max(o.get("end_date") or o["start_date"] for o in same)
    titles = [o["title"] for o in obs if o.get("title")]
    named = [o["title"] for o in obs if len(core_key(o.get("title", ""))) > 2 and len(o.get("title", "")) >= 6]
    title = (named or titles)[0]
    sido = pick("sido")
    sig_c = [o for o in obs if o.get("sido") == sido and o.get("sigungu")]
    sigungu = sig_c[0]["sigungu"] if sig_c else ""
    venues = [o.get("venue") for o in obs if o.get("venue")]
    venue = venues[0] if venues else ""
    ap_src = [o for o in obs if o.get("apply_open") or o.get("apply_close")]
    apply_open = ap_src[0].get("apply_open", "") if ap_src else ""
    apply_close = ap_src[0].get("apply_close", "") if ap_src else ""
    if not apply_open:
        apply_open = pick("apply_open")
    if not apply_close:
        apply_close = pick("apply_close")
    if apply_open and apply_close and apply_open > apply_close:
        apply_open = ""
    aps = {(o.get("apply_open", ""), o.get("apply_close", "")) for o in ap_src if o["tier"] == ap_src[0]["tier"]}
    if len(aps) > 1 and len({b for _, b in aps if b}) > 1:
        conflicts["apply"] = sorted(f"{a or '?'}~{b or '?'}" for a, b in aps)
    status = ""
    for o in obs:
        if o.get("status"):
            status = o["status"]
            break
    apply_closed = any(o.get("apply_closed") for o in obs if o["tier"] == "official")
    sports, inferred = [], True
    for o in obs:
        if not o.get("sports_inferred"):
            for s in o.get("sports") or []:
                if s not in sports:
                    sports.append(s)
            inferred = False
    if not sports:
        sports = list(top.get("sports") or ["경영"])
    f50 = f100 = None
    ev = ""
    for o in obs:                                    # 원문에 '가능'이 있으면 가능, 목록으로 '없음'이 확인되면 불가
        if o.get("free50") is not None and f50 is None:
            f50, ev = o["free50"], ev or o.get("free_evidence", "")
        if o.get("free100") is not None and f100 is None:
            f100, ev = o["free100"], ev or o.get("free_evidence", "")
    if "경영" not in sports and not inferred:
        f50 = False if f50 is None else f50
        f100 = False if f100 is None else f100
    elig = pick("eligibility")
    events = pick("events")
    kinds = []
    for o in obs:
        for k in kinds_for(o.get("title", ""), o.get("eligibility", ""), o.get("kind_hint", "")):
            if k not in kinds and k != "other":
                kinds.append(k)
    kinds = kinds or ["other"]
    order = ["masters", "elite", "student", "other"]
    kinds.sort(key=order.index)
    official = [o for o in obs if o["tier"] == "official" and o.get("official_url")]
    official_url = official[0]["official_url"] if official else pick("official_url")
    verification = obs[0]["tier"]
    text = " ".join([title, elig])
    # adult_ok = 일반 성인(동호인)이 나갈 수 있는가. 전문선수 대회의 '일반부'는 등록선수 성인부라 해당 없음.
    elite_kind = "elite" in kinds and "masters" not in kinds
    if "masters" in kinds or re.search(r"동호인|누구나|일반인|비\s*등록|시민", elig or ""):
        adult = True
    elif not elite_kind and re.search(r"성인|일반부|대학부|20세\s*이상|만\s*19", elig or ""):
        adult = True
    elif elite_kind or kinds == ["student"]:
        adult = False
    else:
        adult = None
    student = True if ("student" in kinds or re.search(r"학생|초등|중등|중학|고등|유소년|유년|꿈나무", elig or "")) else None
    registered = None
    if re.search(r"비\s*등록", elig or ""):
        registered = False
    if re.search(r"(?<!비)(?:선수\s*등록|등록\s*선수|등록을\s*필|등록\s*완료|경기인\s*등록)", text):
        registered = True
    elite_only = "elite" in kinds and "masters" not in kinds and adult is not True
    pool_c = [o.get("pool") for o in obs if o.get("pool") and o["source"] != "whoisfast"]
    pool = pool_c[0] if len(set(pool_c)) == 1 else ("" if pool_c else "")
    if len(set(pool_c)) > 1:
        conflicts["pool"] = sorted(set(pool_c))
    sources = []
    for o in obs:
        sources.append({"key": o["source"], "name": SOURCE_NAMES.get(o["source"], o["source"]), "tier": o["tier"],
                        "url": o.get("url") or "", "title": o.get("title", "")})
    warnings = []
    if apply_close and start and (date.fromisoformat(start) - date.fromisoformat(apply_close)).days > 200:
        warnings.append("접수 마감이 대회보다 200일 이상 앞섬 — 원문 확인 필요")
    if verification != "official":
        warnings.append("공식 공고 원문으로 확인되지 않음(2차 자료)" if verification == "secondary" else "검색으로 찾은 미확정 정보")
    if inferred:
        warnings.append("경기 종목이 공고에 없어 일반 수영대회(경영)로 분류")
    attachments = []
    for o in obs:
        for a in o.get("attachments") or []:
            if a not in attachments:
                attachments.append(a)
    return {
        "title": title, "aliases": sorted({t for t in titles if t != title})[:6],
        "kind": kinds[0], "kinds": kinds, "sports": sports, "sport": sports[0], "sports_inferred": inferred,
        "sido": sido, "sigungu": sigungu, "region": R.label(sido, sigungu),
        "venue": venue, "pool": pool,
        "start_date": start, "end_date": end,
        "apply_open": apply_open, "apply_close": apply_close, "apply_closed": apply_closed,
        "status": status or "scheduled",
        "eligibility": elig, "adult_ok": adult, "student_ok": student, "registered": registered,
        "elite_only": elite_only, "amateur_ok": (False if elite_only or kinds == ["student"] else (True if "masters" in kinds else None)),
        "events": events, "fee": pick("fee"), "free50": f50, "free100": f100, "free_evidence": ev,
        "apply_url": pick("apply_url"), "official_url": official_url,
        "verification": verification, "sources": sources, "conflicts": conflicts, "warnings": warnings,
        "attachments": attachments[:8],
    }


def new_id(obs, taken):
    basis = core_key(obs["title"]) + "|" + (obs.get("start_date") or "")[:4] + "|" + (obs.get("sido") or "")
    h = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]
    i = 1
    out = h
    while out in taken:
        i += 1
        out = f"{h}{i}"
    return out


def obs_key(o):
    """수집처 안에서 같은 글을 같은 열쇠로. 목록 사이트(주소가 대회마다 없음)는 이름만 쓴다 —
    날짜가 바뀐 같은 대회가 새 관측으로 쌓이지 않고 이전 관측을 바꾼다(일정 변경 감지)."""
    if o.get("url") and o["source"] not in ("swimming_co_kr", "whoisfast"):
        return o["source"] + ":" + o["url"]
    return o["source"] + ":" + core_key(o["title"])


def match(records, o):
    best, score = None, -1.0
    for rid, rec in records.items():
        d = rec.get("derived")
        cands = list(rec["obs"].values()) + ([d] if d else [])
        for c in cands:
            if c and same_meet(o, c):
                s = title_sim(o["title"], c.get("title", "")) - (gap_days(o, c) or 0) / 100
                if s > score:
                    best, score = rid, s
                break
    return best


def attach_only(records, o):
    """날짜 없는 공지(조기 마감 · 취소 안내) — 이름이 같은 다가오는 대회에만 붙인다."""
    t = today().isoformat()
    best, score = None, 0.0
    for rid, rec in records.items():
        d = rec.get("derived") or {}
        if (d.get("end_date") or "") < t:
            continue
        s = title_sim(o["title"], d.get("title", ""))
        if s >= 0.9 and s > score and (not o.get("sido") or o["sido"] == d.get("sido")):
            best, score = rid, s
    return best


def merge_batch(records, batch, source_key):
    """한 수집처의 이번 관측값으로 그 수집처 몫을 바꾼다(다른 수집처 몫은 그대로)."""
    touched = set()
    for o in batch:
        if not o.get("start_date"):
            rid = attach_only(records, o)
            if rid:
                records[rid]["obs"][obs_key(o)] = o
                touched.add(rid)
            continue
        rid = match(records, o)
        if rid is None:
            rid = new_id(o, records)
            records[rid] = {"id": rid, "obs": {}, "first_seen": today().isoformat()}
        records[rid]["obs"][obs_key(o)] = o
        records[rid]["derived"] = derive(records[rid]) or records[rid].get("derived")
        touched.add(rid)
    return touched


def collapse_duplicates(records):
    """서로 다른 기록이 같은 대회로 판정되면 먼저 생긴 기록으로 합친다(별칭·약칭 중복 방지)."""
    ids = sorted(records, key=lambda r: (records[r].get("first_seen", ""), r))
    merged = {}
    for i, a in enumerate(ids):
        if a in merged:
            continue
        for b in ids[i + 1:]:
            if b in merged:
                continue
            da, db = records[a].get("derived"), records[b].get("derived")
            if da and db and same_meet(da, db):
                records[a]["obs"].update(records[b]["obs"])
                records[a]["derived"] = derive(records[a])
                merged[b] = a
    for b in merged:
        records.pop(b, None)
    return merged


def migrate_v1(doc):
    """v1(competitions.json 평면 목록) → v2 관측값. 마이랭킹 출처는 robots.txt 정책에 따라 버린다."""
    records = {}
    dropped = 0
    for x in doc.get("competitions", []):
        src = clean(x.get("source"))
        if "마이랭킹" in src or "myranking" in (x.get("source_url") or "") or "캐치레인" in src:
            dropped += 1
            continue
        key = {"대한수영연맹 공식 일정": "korswim", "전국 수영대회 통합 목록": "swimming_co_kr",
               "Whoisfast 전국 마스터즈 일정": "whoisfast"}.get(src, "legacy_v1")
        tier = "official" if key == "korswim" else "secondary"
        o = make_obs(key, tier, x.get("title", ""), start=x.get("start_date", ""), end=x.get("end_date", ""),
                     venue=x.get("venue", ""), url=x.get("source_url", ""), official_url=x.get("official_url", ""),
                     apply_open=x.get("apply_open", ""), apply_close=x.get("apply_close", ""),
                     eligibility=x.get("eligibility", ""), events=x.get("events", ""))
        if o and o["start_date"]:
            o["migrated"] = True
            merge_batch(records, [o], key)
    return records, dropped


# ───────────────────────── 저장 ─────────────────────────
def read_json(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return default


def write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=False) + "\n"
    old = Path(path).read_text(encoding="utf-8") if Path(path).exists() else None
    if old != text:
        Path(path).write_text(text, encoding="utf-8")
        return True
    return False


def public_record(rid, rec):
    d = dict(rec["derived"])
    d["id"] = rid
    d["first_seen"] = rec.get("first_seen", "")
    d["last_changed"] = rec.get("last_changed", rec.get("first_seen", ""))
    d["changes"] = rec.get("history", [])[-6:]
    d["url"] = APP + "?id=" + rid
    return d


def diff(old, new):
    out = {}
    for k in TRACKED:
        a, b = (old or {}).get(k), new.get(k)
        if a in ("", None) and b in ("", None):
            continue
        if a != b:
            out[k] = [a, b]
    return out


SOURCES = [
    ("korswim", "official", "https://www.korswim.co.kr/11", lambda f, st: scrape_korswim(f, st)),
    ("kua", "official", "https://www.kua.or.kr/competition-info/schedule", lambda f, st: scrape_kua(f, st)),
] + [(b["key"], "official", b["url"], (lambda cfg: lambda f, st: scrape_board(f, st, cfg))(b)) for b in BOARDS] + [
    ("swimming_co_kr", "secondary", "https://swimming.co.kr/", lambda f, st: scrape_swimming_co_kr(f, st)),
    ("whoisfast", "secondary", "https://whoisfast.com/meets", lambda f, st: scrape_whoisfast(f, st)),
]


def refresh(fetcher=None, search=None, sources=None, do_search=True, do_confirm=True):
    t = today().isoformat()
    started = now_iso()
    comp_path, state_path = DATA_DIR / "competitions.json", DATA_DIR / "state.json"
    status_path, changes_path, leads_path = DATA_DIR / "sources.json", DATA_DIR / "changes.json", DATA_DIR / "leads.json"
    state = read_json(state_path, {})
    state["cache"] = read_json(CACHE_FILE, {})
    prev_public = read_json(comp_path, {})
    prev_status = {s["key"]: s for s in read_json(status_path, {}).get("sources", [])}
    changes_doc = read_json(changes_path, {})
    changes = changes_doc.get("changes", []) if changes_doc.get("schema_version") == SCHEMA else []
    baseline = state.get("baseline_date")
    migrated_note = None
    if state.get("schema_version") != SCHEMA:
        records, dropped = migrate_v1(prev_public if prev_public.get("schema_version", 1) == 1 else {})
        state = {"schema_version": SCHEMA, "baseline_date": t, "records": records, "cache": state.get("cache", {})}
        baseline = t
        migrated_note = f"v1 → v2 전환: 이전 {len(prev_public.get('competitions', []))}건 중 마이랭킹 출처 {dropped}건 제외(robots.txt 수집 금지)"
    records = state["records"]
    # 판 전환 첫 실행은 전부 '기준선'이다(옛 값과 비교한 가짜 변경 · 신규를 만들지 않는다).
    before = {} if migrated_note else {rid: dict(rec.get("derived") or {}) for rid, rec in records.items()}
    f = fetcher or Fetcher()
    statuses = []
    for key, tier, url, fn in (sources or SOURCES):
        prev = prev_status.get(key, {})
        st = {"key": key, "name": SOURCE_NAMES.get(key, key), "tier": tier, "url": url, "last_attempt": started,
              "last_success": prev.get("last_success", ""), "previous_count": prev.get("count", 0)}
        t0 = time.time()
        try:
            batch = fn(f, state)
            if not batch:
                raise StructureError("0건")
            merge_batch(records, batch, key)
            st.update(status="ok", count=len(batch), error="", last_success=started)
            if st["previous_count"] >= 6 and len(batch) < st["previous_count"] * 0.4:
                st["warning"] = f"건수 급감 {st['previous_count']} → {len(batch)} (구조 변경 의심)"
        except RobotsDenied:
            st.update(status="blocked", count=0, error="robots.txt 가 수집을 허용하지 않음")
        except StructureError as exc:
            st.update(status="failed", count=0, error="구조 변경 의심: " + str(exc))
        except Exception as exc:
            st.update(status="failed", count=0, error=f"{type(exc).__name__}: {str(exc)[:160]}")
        st["seconds"] = round(time.time() - t0, 1)
        statuses.append(st)
        print(f"[{st['status']}] {st['name']}: {st.get('count', 0)}건 {st.get('error', '')}", flush=True)
    for rid, rec in list(records.items()):
        rec["derived"] = derive(rec)
        if rec["derived"] is None:
            records.pop(rid)
    collapse_duplicates(records)
    if do_confirm:
        st = {"key": "official_link", "name": SOURCE_NAMES["official_link"], "tier": "official", "url": "",
              "last_attempt": started, "last_success": prev_status.get("official_link", {}).get("last_success", "")}
        try:
            batch = confirm_official_links(f, state, records)
            merge_batch(records, batch, "official_link")
            st.update(status="ok", count=len(batch), error="", last_success=started)
        except Exception as exc:
            st.update(status="failed", count=0, error=f"{type(exc).__name__}: {str(exc)[:160]}")
        statuses.append(st)
        print(f"[{st['status']}] {st['name']}: {st.get('count', 0)}건", flush=True)
        collapse_duplicates(records)
    leads_doc = read_json(leads_path, {"leads": []})
    leads = leads_doc.get("leads", [])
    if do_search:
        st = {"key": "search_lead", "name": SOURCE_NAMES["search_lead"], "tier": "unverified", "url": "https://duckduckgo.com/",
              "last_attempt": started, "last_success": prev_status.get("search_lead", {}).get("last_success", "")}
        try:
            leads, info = discover_search(state, leads, search=search)
            st.update(status="ok", count=info["hits"], error="" if not info["errors"] else f"질의 {info['errors']}/{info['queries']}개 실패",
                      last_success=started)
        except Exception as exc:
            st.update(status="failed", count=0, error=f"{type(exc).__name__}: {str(exc)[:160]}")
        statuses.append(st)
        print(f"[{st['status']}] {st['name']}: {st.get('count', 0)}건", flush=True)
    # 후보를 이미 아는 대회와 잇는다(같은 이름이면 '이미 수집됨').
    for ld in leads:
        best, score = "", 0.0
        for rid, rec in records.items():
            s = title_sim(ld["title"], rec["derived"]["title"])
            if s > score:
                best, score = rid, s
        ld["matched_id"] = best if score >= 0.9 else ""
    cutoff = (today() - timedelta(days=150)).isoformat()
    leads = sorted([x for x in leads if x.get("first_seen", "") >= cutoff], key=lambda x: x["first_seen"], reverse=True)[:400]
    # 변경 감지
    n_new = n_changed = 0
    for rid, rec in records.items():
        d = rec["derived"]
        old = before.get(rid)
        if not old:
            rec["first_seen"] = rec.get("first_seen") or t
            rec["last_changed"] = t
            rec["history"] = [{"date": t, "type": "baseline" if migrated_note else "new"}]
            if not migrated_note:
                changes.append({"date": t, "id": rid, "title": d["title"], "type": "new"})
                n_new += 1
            continue
        dd = diff(old, d)
        if dd:
            rec["last_changed"] = t
            kind = "status" if "status" in dd else "updated"
            entry = {"date": t, "type": kind, "fields": {k: v for k, v in dd.items()}}
            rec.setdefault("history", []).append(entry)
            rec["history"] = rec["history"][-12:]
            changes.append({"date": t, "id": rid, "title": d["title"], "type": kind, "fields": dd})
            n_changed += 1
    if migrated_note:
        changes.append({"date": t, "type": "migration", "note": migrated_note, "count": len(records)})
    ok = [s for s in statuses if s["status"] == "ok" and s["key"] not in ("search_lead", "official_link")]
    pub = sorted((public_record(rid, rec) for rid, rec in records.items()),
                 key=lambda e: (e["start_date"], e["title"]))
    payload = {"schema_version": SCHEMA, "range": "대한민국 전국 17개 시·도", "baseline_date": baseline,
               "data_changed_at": prev_public.get("data_changed_at", ""), "count": len(pub), "competitions": pub}
    old_payload = dict(prev_public)
    if json.dumps({k: v for k, v in payload.items() if k != "data_changed_at"}, ensure_ascii=False, sort_keys=True) != \
            json.dumps({k: v for k, v in old_payload.items() if k != "data_changed_at"}, ensure_ascii=False, sort_keys=True):
        payload["data_changed_at"] = started
    if ok:
        write_json(comp_path, payload)
        state["records"] = records
        cache = state.pop("cache", {})
        write_json(state_path, state)
        write_json(CACHE_FILE, cache)
        write_json(changes_path, {"schema_version": SCHEMA, "changes": changes[-1500:]})
        write_json(leads_path, {"schema_version": SCHEMA, "baseline_date": state.get("baseline_date", baseline),
                                "count": len(leads), "leads": leads})
    total_ok = len(ok)
    summary = {"started": started, "finished": now_iso(), "ok_sources": total_ok,
               "failed_sources": sum(1 for s in statuses if s["status"] != "ok"),
               "total": len(pub), "new": n_new if not migrated_note else 0, "changed": n_changed,
               "http_requests": getattr(f, "count", 0), "data_saved": bool(ok)}
    last_ok = max([s.get("last_success", "") for s in statuses] + [""])
    write_json(status_path, {"schema_version": SCHEMA, "updated_at": started, "last_success_at": last_ok,
                             "run": summary, "sources": statuses})
    print(json.dumps(summary, ensure_ascii=False))
    return summary


if __name__ == "__main__":
    s = refresh(do_search=os.environ.get("SWIM_SEARCH", "1") != "0")
    sys.exit(0 if s["ok_sources"] else 2)
