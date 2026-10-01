#!/usr/bin/env python3
import json
import os
import re
import sys
import time
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from difflib import SequenceMatcher
from html import escape
from pathlib import Path
from zoneinfo import ZoneInfo
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS

CACHE_DIR = Path(".job-alert-cache")
SEEN_FILE = CACHE_DIR / "seen.json"
SENT_FILE = CACHE_DIR / "last_sent_date.txt"
ARCHIVE_FILE = Path("data/job_archive.json")
ARCHIVE_DAYS = 180

JAVA_AI_QUERIES = [
    '대전 Java JSP Spring 프리랜서 프로젝트',
    '세종 Java JSP Spring 프리랜서 프로젝트',
    '대전 Java 전자정부프레임워크 SM 유지보수',
    '세종 Java 전자정부프레임워크 SM 유지보수',
    '대전 Spring Boot Java 백엔드 계약직 프리랜서',
    '세종 Spring Boot Java 백엔드 계약직 프리랜서',
    '대전 Java AI LLM RAG 생성형AI 채용',
    '세종 Java AI LLM RAG 생성형AI 채용',
    '대전 Java AI Agent Spring AI LangChain4j 채용',
    '세종 Java AI Agent Spring AI LangChain4j 채용',
    'site:saramin.co.kr 대전 Java Spring 프리랜서',
    'site:saramin.co.kr 세종 Java Spring 프리랜서',
    'site:imjob.co.kr 대전 Java 프로젝트',
    'site:imjob.co.kr 세종 Java 프로젝트',
]

REGULAR_DEV_QUERIES = [
    '대전 개발자 정규직 채용',
    '세종 개발자 정규직 채용',
    '대전 Java Spring 정규직 채용',
    '세종 Java Spring 정규직 채용',
    '대전 백엔드 서버개발 정규직',
    '세종 백엔드 서버개발 정규직',
    '대전 웹개발 시스템개발 정규직',
    '세종 웹개발 시스템개발 정규직',
    '대전 AI LLM RAG 개발자 정규직',
    '세종 AI LLM RAG 개발자 정규직',
    'site:saramin.co.kr 대전 개발자 정규직 Java Spring',
    'site:saramin.co.kr 세종 개발자 정규직 Java Spring',
    'site:wanted.co.kr 대전 백엔드 개발자',
    'site:wanted.co.kr 세종 백엔드 개발자',
    'site:jumpit.saramin.co.kr 대전 백엔드 개발자',
    'site:jumpit.saramin.co.kr 세종 백엔드 개발자',
]

SALARY_QUERIES = [
    '대전 연봉 6000만원 채용',
    '세종 연봉 6000만원 채용',
    '대전 연봉 5400만원 채용',
    '세종 연봉 5400만원 채용',
    '대전 월급 500만원 채용',
    '세종 월급 500만원 채용',
    '대전 월급 450만원 채용',
    '세종 월급 450만원 채용',
    'site:saramin.co.kr 대전 연봉 6000',
    'site:saramin.co.kr 세종 연봉 6000',
    'site:saramin.co.kr 대전 연봉 5400',
    'site:saramin.co.kr 세종 연봉 5400',
    'site:work24.go.kr 대전 월급 450만원',
    'site:work24.go.kr 세종 월급 450만원',
]

SHORT_TERM_QUERIES = [
    '대전 단기알바 하루 당일 초보 경력무관',
    '세종 단기알바 하루 당일 초보 경력무관',
    '대전 단기 알바 피킹 포장 소분 분류',
    '세종 단기 알바 피킹 포장 소분 분류',
    '대전 1일 알바 물류 포장 생산 초보',
    '세종 1일 알바 물류 포장 생산 초보',
    '대전 1개월 단기 생산 포장 경력무관',
    '세종 1개월 단기 생산 포장 경력무관',
    '대전 전산보조 PC설치 단기 알바',
    '세종 전산보조 PC설치 단기 알바',
    '대전 사무보조 데이터입력 단기 알바',
    '세종 사무보조 데이터입력 단기 알바',
    'site:alba.co.kr 대전 단기알바 초보',
    'site:alba.co.kr 세종 단기알바 초보',
    'site:albamon.com 대전 단기알바 초보',
    'site:albamon.com 세종 단기알바 초보',
]

JOBKOREA_BASE = 'https://www.jobkorea.co.kr'
JOBKOREA_DIRECT_QUERIES = [
    '대전 Java', '세종 Java',
    '대전 Spring', '세종 Spring',
    '대전 JSP', '세종 JSP',
    '대전 개발자', '세종 개발자',
    '대전 백엔드', '세종 백엔드',
    '대전 웹개발', '세종 웹개발',
    '대전 시스템개발', '세종 시스템개발',
    '대전 전자정부', '세종 전자정부',
    '대전 프리랜서 개발', '세종 프리랜서 개발',
    '대전 유지보수 개발', '세종 유지보수 개발',
    '대전 AI 개발자', '세종 AI 개발자',
    '대전 LLM', '세종 LLM',
    '대전 RAG', '세종 RAG',
    '대전 NestJS', '세종 NestJS',
    '대전 6000만원', '세종 6000만원',
    '대전 5400만원', '세종 5400만원',
    '대전 500만원', '세종 500만원',
    '대전 450만원', '세종 450만원',
    '대전 단기 알바', '세종 단기 알바',
    '대전 포장 단기', '세종 포장 단기',
    '대전 경력무관 알바', '세종 경력무관 알바',
    '대전 전산보조 단기', '세종 전산보조 단기',
]
JOBKOREA_PAGES_PER_QUERY = 2

SARAMIN_BASE = 'https://www.saramin.co.kr'
SARAMIN_DIRECT_QUERIES = [
    '대전 Java', '세종 Java',
    '대전 Spring', '세종 Spring',
    '대전 개발자', '세종 개발자',
    '대전 백엔드', '세종 백엔드',
    '대전 AI 개발자', '세종 AI 개발자',
    '대전 유지보수 개발', '세종 유지보수 개발',
    '대전 연봉 6000', '세종 연봉 6000',
    '대전 월급 500', '세종 월급 500',
]
SARAMIN_PAGES_PER_QUERY = 1

SEARCH_SOURCES = {
    '고용24': 'work24.go.kr',
    '원티드': 'wanted.co.kr',
    '점핏': 'jumpit.saramin.co.kr',
    '커리어': 'career.co.kr',
    '인크루트': 'incruit.com',
    '로켓펀치': 'rocketpunch.com',
    '아이엠잡': 'imjob.co.kr',
    '링크드인': 'linkedin.com/jobs',
    '알바몬': 'albamon.com',
    '알바천국': 'alba.co.kr',
}
SOURCE_SEARCH_TERMS = [
    '대전 Java Spring 개발자',
    '세종 Java Spring 개발자',
    '대전 백엔드 AI 개발자',
    '세종 백엔드 AI 개발자',
    '대전 연봉 5400 6000 월급 450 500 채용',
    '세종 연봉 5400 6000 월급 450 500 채용',
    '대전 단기 알바 초보 경력무관',
    '세종 단기 알바 초보 경력무관',
]
SOURCE_PRIORITY = {
    '잡코리아': 100,
    '사람인': 95,
    '고용24': 90,
    '원티드': 85,
    '점핏': 84,
    '커리어': 80,
    '인크루트': 78,
    '로켓펀치': 76,
    '아이엠잡': 74,
    '링크드인': 72,
    '알바몬': 70,
    '알바천국': 70,
}

LOCATION_TERMS = ('대전', '세종')
CORE_TERMS = (
    'java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov',
    '백엔드', 'sm', '유지보수', 'si', '프리랜서', '계약직',
)
DEV_REQUIRED_TERMS = (
    'java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov',
    '백엔드', '웹개발', '서버개발', '소프트웨어개발', '개발자',
    '시스템개발', '프로그래머', 'node.js', 'nodejs', 'nestjs',
)
JUNIOR_ONLY_TERMS = (
    '2년차 미만', '3년차 미만', '경력 1~2년', '경력1~2년',
    '경력 1~3년', '경력1~3년', '주니어 전용', '신입 전용', '신입만',
)
AI_TERMS = (
    'ai', 'llm', 'rag', 'agent', '생성형', '챗봇', 'spring ai',
    'langchain4j', 'mcp', 'vector', 'embedding',
)
REGULAR_DEV_TERMS = (
    '개발자', '개발', '백엔드', '서버개발', '웹개발', '시스템개발',
    'java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov',
    'api', 'was', 'tomcat', 'ai', 'llm', 'rag',
)
SHORT_TERM_TERMS = (
    '단기', '하루', '당일', '1일', '일용', '일급', '일당',
    '1주', '2주', '3주', '한달', '1개월', '15일', '30일',
    '요일협의', '요일 협의',
)
NO_EXPERIENCE_TERMS = (
    '초보', '초보가능', '초보 가능', '경력무관', '경력 무관',
    '학력무관', '학력 무관', '누구나', '미경험', '경력없음',
)
SHORT_TERM_ROLE_TERMS = (
    '피킹', '포장', '소분', '분류', '물류', '생산보조', '생산 보조',
    '포장보조', '포장 보조', '검수', '전산보조', '전산 보조',
    'pc설치', 'pc 설치', '컴퓨터 설치', '사무보조', '사무 보조',
    '데이터입력', '데이터 입력', '문서정리', '문서 정리', '행사보조',
    '행사 보조', '매장보조', '매장 보조',
)
SHORT_TERM_EXCLUDE_TERMS = (
    '자격증 필수', '면허 필수', '운전면허', '지게차',
    '경력 1년', '경력1년', '경력 2년', '경력2년',
    '간호사', '요양보호사', '전기기사', '현장소장',
    '2개월', '3개월', '4개월', '5개월', '6개월',
)
PRIORITY_TERMS = (
    '프리랜서', '계약직', 'sm', '유지보수', '공공', '정부',
    '연구원', '연구소', '전자정부', '고급', '중급',
)
JOB_TERMS = (
    '채용', '모집', '구인', '정규직', '계약직', '프리랜서',
    '경력', '신입', '직원', '사원', '현장', '개발자', '기사',
)
EXCLUDE_TERMS = (
    '인턴만', '마감되었습니다', '채용마감',
)

ENTRY_ONLY_EXPLICIT_TERMS = (
    '신입만', '신입 전용', '신입전용', '신입사원만',
    '신입 공채', '신입공채', '신입사원 공개채용', '신입사원 채용',
)
CAREER_ALLOWED_PATTERNS = (
    r'신입\s*[·ㆍ/,+&]\s*경력',
    r'신입\s*(?:및|또는)\s*경력',
    r'경력\s*무관',
    r'경력직',
    r'경력자',
    r'경력\s*\d+\s*년',
    r'경력\s*(?:이상|지원|우대)',
)
TRUSTED_DOMAINS = (
    'jobkorea.co.kr', 'saramin.co.kr', 'imjob.co.kr', 'work24.go.kr',
    'wanted.co.kr', 'jumpit.saramin.co.kr', 'career.co.kr',
    'alba.co.kr', 'albamon.com', 'incruit.com', 'rocketpunch.com',
    'linkedin.com',
)


def normalize_text(value):
    return re.sub(r'\s+', ' ', (value or '')).strip()



INVALID_COMPANY_EXACT = {
    '대전', '세종', '대전광역시', '세종특별자치시',
    '입사지원', '홈페이지 지원', '즉시지원', '스크랩', '관심기업',
    '채용', '모집', '경력', '신입', '정규직', '계약직',
    '하반기', '상반기', '수정일', '등록일', '채용시',
}
GENERIC_JOB_TITLES = {
    '입사지원', '홈페이지 지원', '즉시지원', '스크랩', '관심기업',
    '채용', '모집', '채용공고', '공고', '상세보기',
}
DETAIL_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/154.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
}


def clean_company_name(value, title=''):
    text = normalize_text(value)
    if not text:
        return ''
    text = re.sub(r'^\s*기업정보\s*[:：]?\s*', '', text)
    text = re.sub(r'\s+(?:관심기업|채용중\s*\d+\s*)
    try:
        parts = urlsplit(url)
        kept = []
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith('utm_') or lk in {'sc', 'track', 'tracking', 'ref', 'referer'}:
                continue
            kept.append((k, v))
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(kept), ''))
    except Exception:
        return url


def domain_of(url):
    try:
        return urlsplit(url).netloc.lower().replace('www.', '')
    except Exception:
        return ''


def is_trusted(url):
    domain = domain_of(url)
    return any(domain.endswith(d) for d in TRUSTED_DOMAINS)


def has_target_location(text):
    text = normalize_text(text or '')
    return bool(re.search(
        r'(?<![가-힣A-Za-z0-9])(?:대전(?:광역시)?|세종(?:특별자치시)?)(?![가-힣A-Za-z0-9])',
        text,
        re.I,
    ))


def salary_info(title, body):
    raw_text = f"{title} {body}"
    text = raw_text.lower().replace(',', '')
    candidates = []

    monthly_patterns = [
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})(?:\s*(?:~|-|–|〜)\s*(\d{3,4}))?\s*만원',
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})\s*만\s*원?',
    ]
    for pattern in monthly_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 200 <= low <= 3000:
                candidates.append({
                    'monthly': low,
                    'annual': low * 12,
                    'label': f'월 {low:,.0f}만원 이상 기준',
                })

    annual_patterns = [
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d{4,5})(?:\s*(?:~|-|–|〜)\s*(\d{4,5}))?\s*만원',
        r'(?:연봉|연\s*급여)\s*[:：]?\s*(\d{4,5})\s*(?:이상|부터)',
    ]
    for pattern in annual_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 2400 <= low <= 15000:
                candidates.append({
                    'monthly': low / 12.0,
                    'annual': low,
                    'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
                })

    korean_thousand = re.finditer(
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*천\s*만원',
        text,
    )
    for m in korean_thousand:
        low = float(m.group(1)) * 1000
        if 2400 <= low <= 15000:
            candidates.append({
                'monthly': low / 12.0,
                'annual': low,
                'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
            })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['monthly'])


def short_term_pay_info(title, body):
    text = f"{title} {body}".lower().replace(',', '')
    candidates = []

    daily_patterns = [
        r'(?:일급|일당)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
        r'(?:일급|일당)\s*[:：]?\s*(\d{4,7})\s*원',
        r'(?:하루|1일)\s*(?:급여|수입|일당)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
    ]
    for pattern in daily_patterns:
        for m in re.finditer(pattern, text):
            raw = float(m.group(1))
            won = raw * 10000 if raw < 1000 else raw
            if 30000 <= won <= 1000000:
                candidates.append({
                    'kind': 'daily',
                    'won': won,
                    'sort_value': won,
                    'label': f'일급 {won:,.0f}원',
                })

    hourly_patterns = [
        r'(?:시급)\s*[:：]?\s*(\d{4,6})\s*원',
    ]
    for pattern in hourly_patterns:
        for m in re.finditer(pattern, text):
            won = float(m.group(1))
            if 9000 <= won <= 100000:
                candidates.append({
                    'kind': 'hourly',
                    'won': won,
                    'sort_value': won * 8,
                    'label': f'시급 {won:,.0f}원',
                })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['sort_value'])


def is_entry_only(title, body):
    title_text = normalize_text(title).lower()
    body_text = normalize_text(body).lower()
    text = f'{title_text} {body_text}'

    # '신입·경력', '경력무관', '경력직' 등 경력자 지원 가능 신호가 있으면 허용한다.
    career_allowed = any(
        re.search(pattern, text, re.I)
        for pattern in CAREER_ALLOWED_PATTERNS
    )
    if career_allowed:
        return False

    # 명시적인 신입 전용 문구는 제외한다.
    if any(term in text for term in ENTRY_ONLY_EXPLICIT_TERMS):
        return True

    # 제목 자체가 '[신입]', '(신입)', '신입 개발자/엔지니어/사원 채용' 형태이고
    # 본문에도 경력자 지원 가능 신호가 없으면 신입 전용으로 본다.
    if re.search(r'(?:^|[\[\(\s])신입(?:[\]\)\s]|$)', title_text):
        if re.search(
            r'신입\s*(?:사원|개발자|엔지니어|직원|채용|모집|공채)',
            title_text,
            re.I,
        ) or re.search(r'^\s*[\[\(]?신입[\]\)]?', title_text, re.I):
            return True

    return False


def score_java_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999

    has_dev = any(term in text for term in DEV_REQUIRED_TERMS)
    has_ai = any(term in text for term in AI_TERMS)
    if not has_dev and not has_ai:
        return -999

    score = 0
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in CORE_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in PRIORITY_TERMS if t in text)
    if is_trusted(url):
        score += 5
    return score


def score_regular_dev_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if '정규직' not in text and '정규' not in text:
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999
    if not any(term in text for term in DEV_REQUIRED_TERMS):
        return -999

    # 신입 공고라도 경력 지원 가능 문구가 함께 있으면 허용하고,
    # 명백한 신입 전용 공고는 위 EXCLUDE_TERMS에서 걸러낸다.
    score = 12
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in REGULAR_DEV_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in ('경력', '시니어', '고급', '중급', '유지보수', '운영') if t in text)
    if is_trusted(url):
        score += 5
    return score


def salary_is_plausible(title, body, salary):
    if salary is None:
        return False
    text = f'{title} {body}'.lower()
    annual = salary.get('annual', 0)

    # 일반 채용공고에서 연 1.5억원을 넘는 '만원' 표기는 자릿수/구분자 파싱 오류인 경우가 많다.
    if annual > 15000:
        return False

    # 시급/일급 숫자를 월급으로 오인한 경우를 막는다.
    if salary.get('monthly', 0) > 3000:
        return False

    return True


def score_salary_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999

    salary = salary_info(title, body)
    if not salary_is_plausible(title, body, salary) or salary['monthly'] < 450:
        return -999

    if not is_trusted(url) and not any(term in text for term in JOB_TERMS):
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 5 if is_trusted(url) else 0
    score += min(15, int((salary['monthly'] - 450) / 10))
    score += 2 * sum(1 for t in JOB_TERMS if t in text)
    return score


def score_short_term_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if any(term in text for term in SHORT_TERM_EXCLUDE_TERMS):
        return -999

    has_short = any(term in text for term in SHORT_TERM_TERMS)
    has_easy_role = any(term in text for term in SHORT_TERM_ROLE_TERMS)
    has_no_exp = any(term in text for term in NO_EXPERIENCE_TERMS)

    if not has_short:
        return -999
    if not has_easy_role and not has_no_exp:
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 4 * sum(1 for t in NO_EXPERIENCE_TERMS if t in text)
    score += 3 * sum(1 for t in SHORT_TERM_ROLE_TERMS if t in text)
    score += 2 * sum(1 for t in ('하루', '당일', '1일', '요일협의', '요일 협의') if t in text)

    pay = short_term_pay_info(title, body)
    if pay:
        score += min(20, int(pay['sort_value'] / 10000))

    if is_trusted(url):
        score += 5
    return score


def tags_for(title, body):
    text = f"{title} {body}".lower()
    tags = []
    if any(t in text for t in ('java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov')):
        tags.append('Java')
    if any(t in text for t in ('sm', '유지보수', '운영')):
        tags.append('SM')
    if any(t in text for t in ('프리랜서', '계약직')):
        tags.append('프리/계약')
    if any(t in text for t in AI_TERMS):
        tags.append('AI')
    return tags or ['IT']


def study_hint(title, body):
    text = f"{title} {body}".lower()
    hints = []
    if any(t in text for t in ('spring boot', 'springboot')):
        hints.append('Spring Boot')
    if any(t in text for t in ('ai', 'llm', 'rag', 'agent', '생성형', '챗봇')):
        hints.append('Spring AI')
    if 'rag' in text or 'vector' in text or 'embedding' in text:
        hints.append('RAG/pgvector')
    if 'agent' in text or 'mcp' in text:
        hints.append('Tool Calling/MCP')
    if '전자정부' in text or 'egov' in text:
        hints.append('전자정부프레임워크')
    if not hints:
        hints = ['Spring Boot', 'REST API']
    return ', '.join(dict.fromkeys(hints[:3]))


def today_kst():
    return datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()


def already_sent_today():
    if not SENT_FILE.exists():
        return False
    try:
        return SENT_FILE.read_text(encoding='utf-8').strip() == today_kst()
    except Exception:
        return False


def mark_sent_today():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SENT_FILE.write_text(today_kst(), encoding='utf-8')


def load_seen():
    if not SEEN_FILE.exists():
        return set()
    try:
        data = json.loads(SEEN_FILE.read_text(encoding='utf-8'))
        return set(data.get('urls', []))
    except Exception:
        return set()


def save_seen(urls):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = sorted(urls)[-12000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_group(queries, scorer, source_name=None):
    merged = {}
    ddgs = DDGS()

    for query in queries:
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='w',
                max_results=15,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url:
                    continue

                score = scorer(title, body, url)
                if score < 0:
                    continue

                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': score,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name or domain_of(url),
                    'sources': [source_name or domain_of(url)],
                }
                current = merged.get(url)
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.35)

    return list(merged.values())


def merge_jobs(*groups):
    merged = {}
    for group in groups:
        for job in group:
            current = merged.get(job['url'])
            if current is None or job.get('score', 0) > current.get('score', 0):
                merged[job['url']] = job
    return list(merged.values())


def classify_jobs(jobs, scorer):
    result = []
    for job in jobs:
        score = scorer(job['title'], job['body'], job['url'])
        if score < 0:
            continue
        item = dict(job)
        item['score'] = score
        item['salary'] = salary_info(item['title'], item['body'])
        item['short_pay'] = short_term_pay_info(item['title'], item['body'])
        result.append(item)
    return result


def jobkorea_card_text(anchor):
    # 한 공고 카드의 경계를 'GI_Read 링크가 1개인 가장 가까운 조상'으로 잡는다.
    # 검색결과 전체 컨테이너를 읽어 옆 공고의 지역/급여가 섞이는 것을 막는다.
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))

    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break

        detail_ids = set()
        for link in node.find_all('a', href=True):
            match = re.search(r'/Recruit/GI_Read/(\d+)', link.get('href') or '', re.I)
            if match:
                detail_ids.add(match.group(1))

        if len(detail_ids) > 1:
            break

        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue

        if len(detail_ids) == 1:
            fallback = text
            has_location = any(loc in text for loc in LOCATION_TERMS)
            has_job_meta = any(
                term in text
                for term in (
                    '정규직', '계약직', '프리랜서', '경력', '학력',
                    '만원', '월급', '연봉', '상시채용', '마감',
                )
            )
            if has_location and has_job_meta:
                return text

    return fallback


def jobkorea_title_quality(title):
    text = normalize_text(title)
    lower = text.lower()
    score = min(len(text), 100)

    reward_terms = (
        '개발', 'java', 'spring', 'jsp', '백엔드', '프론트', '웹',
        '채용', '모집', '운영', '유지보수', '엔지니어', 'si', 'sm',
        'ai', '계약직', '정규직', '프리랜서',
    )
    score += 25 * sum(1 for term in reward_terms if term in lower)

    company_markers = ('㈜', '(주)', '주식회사', '관심기업', '벤처기업')
    if any(marker in text for marker in company_markers):
        score -= 80
    if text in {'벤처기업', '중소기업', '강소기업', '외국계'}:
        score -= 200
    return score


def collect_jobkorea_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    parsed_links = 0
    errors = []

    for query in JOBKOREA_DIRECT_QUERIES:
        for page_no in range(1, JOBKOREA_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{JOBKOREA_BASE}/Search',
                    params={'stext': query, 'Page_No': page_no},
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1

                soup = BeautifulSoup(response.text, 'html.parser')
                page_links = 0
                page_parsed_detail_links = 0
                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    match = re.search(r'/Recruit/GI_Read/(\d+)', href, re.I)
                    if not match:
                        continue

                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if (
                        not title
                        or len(title) < 2
                        or title in {'즉시지원', '홈페이지 지원', '스크랩', '관심기업'}
                    ):
                        continue

                    page_parsed_detail_links += 1
                    body = jobkorea_card_text(anchor)
                    if not has_target_location(body):
                        continue

                    url = f'{JOBKOREA_BASE}/Recruit/GI_Read/{match.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '잡코리아',
                        'sources': ['잡코리아'],
                        '_title_quality': jobkorea_title_quality(title),
                    }
                    current = jobs.get(url)
                    if current is None:
                        jobs[url] = candidate
                    else:
                        if len(candidate['body']) > len(current['body']):
                            current['body'] = candidate['body']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                        if candidate['_title_quality'] > current.get('_title_quality', -9999):
                            current['title'] = candidate['title']
                            current['_title_quality'] = candidate['_title_quality']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                    page_links += 1

                parsed_links += page_links
                # 검색 결과 페이지 구조가 바뀐 경우 조용히 '0건'으로 오인하지 않는다.
                raw_has_job_links = bool(
                    re.search(r'/Recruit/GI_Read/\d+', response.text, re.I)
                )
                if raw_has_job_links and page_parsed_detail_links == 0:
                    failed_pages += 1
                    errors.append(f'{query} p{page_no}: HTML에는 공고가 있으나 링크 파싱 0건')
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')

            time.sleep(0.15)

    status = {
        'ok': ok_pages > 0 and parsed_links > 0,
        'ok_pages': ok_pages,
        'failed_pages': failed_pages,
        'parsed_jobs': len(jobs),
        'parsed_links': parsed_links,
        'errors': errors[:5],
    }
    print(
        f'[INFO] jobkorea_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)} '
        f'parsed_links={parsed_links}'
    )
    for error in errors[:5]:
        print(f'[WARN] jobkorea direct: {error}', file=sys.stderr)

    direct_jobs = list(jobs.values())
    for job in direct_jobs:
        job.pop('_title_quality', None)
    direct_jobs = enrich_jobs_from_details(direct_jobs)
    return direct_jobs, status


def compact_job_title(title):
    text = normalize_text(title).lower()
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', text)
    text = re.sub(
        r'\b(?:채용|모집|공고|정규직|계약직|프리랜서|경력직|경력|신입|즉시지원)\b',
        ' ',
        text,
    )
    text = re.sub(r'[^0-9a-z가-힣]+', ' ', text)
    return normalize_text(text)


def title_tokens(title):
    return {
        token for token in compact_job_title(title).split()
        if len(token) >= 2 and token not in {'대전', '세종', '개발자', '채용', '모집'}
    }


def company_hint(title, body):
    text = normalize_text(f'{title} {body}')
    patterns = [
        r'(?:\(주\)|주식회사)\s*([가-힣A-Za-z0-9&._-]{2,40})',
        r'([가-힣A-Za-z0-9&._-]{2,40})\s*㈜',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            candidate = clean_company_name(m.group(1), title)
            if candidate:
                return candidate

    # 제목의 첫 대괄호가 회사명인 공고([솔탑], [메타바이오메드] 등)는 보조적으로 사용한다.
    m = re.match(r'^\[([^\]]{2,40})\]', normalize_text(title))
    if m:
        candidate = clean_company_name(m.group(1), title='')
        if candidate and candidate not in {'대전', '세종', '서울', '경기', '충남', '충북'}:
            return candidate
    return ''


def job_fingerprint(job):
    title = compact_job_title(job.get('title', ''))
    company = (
        clean_company_name(job.get('company', ''), job.get('title', ''))
        or company_hint(job.get('title', ''), job.get('body', ''))
    )
    return f'{company}|{title}' if company else title


def same_job(a, b):
    if not has_target_location(f"{a.get('title','')} {a.get('body','')}"):
        return False
    if not has_target_location(f"{b.get('title','')} {b.get('body','')}"):
        return False

    ca = (
        clean_company_name(a.get('company', ''), a.get('title', ''))
        or company_hint(a.get('title', ''), a.get('body', ''))
    )
    cb = (
        clean_company_name(b.get('company', ''), b.get('title', ''))
        or company_hint(b.get('title', ''), b.get('body', ''))
    )
    if ca and cb and ca != cb:
        return False

    ta = compact_job_title(a.get('title', ''))
    tb = compact_job_title(b.get('title', ''))
    if not ta or not tb:
        return False
    if ta == tb:
        return True

    ratio = SequenceMatcher(None, ta, tb).ratio()
    sa, sb = title_tokens(ta), title_tokens(tb)
    union = sa | sb
    jaccard = (len(sa & sb) / len(union)) if union else 0.0
    return ratio >= 0.90 or (len(sa & sb) >= 3 and jaccard >= 0.78)


def merge_duplicate_job(base, incoming):
    sources = list(dict.fromkeys(
        (base.get('sources') or [base.get('source')])
        + (incoming.get('sources') or [incoming.get('source')])
    ))
    sources = [s for s in sources if s]
    base['sources'] = sources

    bp = SOURCE_PRIORITY.get(base.get('source'), 0)
    ip = SOURCE_PRIORITY.get(incoming.get('source'), 0)
    if ip > bp:
        for key in ('title', 'url', 'source', 'company'):
            if incoming.get(key):
                base[key] = incoming.get(key, base.get(key))

    if not clean_company_name(base.get('company', ''), base.get('title', '')):
        incoming_company = clean_company_name(
            incoming.get('company', ''),
            incoming.get('title', ''),
        )
        if incoming_company:
            base['company'] = incoming_company

    if len(incoming.get('body', '')) > len(base.get('body', '')):
        base['body'] = incoming.get('body', '')

    base['salary'] = salary_info(base.get('title', ''), base.get('body', ''))
    base['short_pay'] = short_term_pay_info(base.get('title', ''), base.get('body', ''))
    base['score'] = max(base.get('score', 0), incoming.get('score', 0))
    return base


def dedupe_jobs_cross_source(jobs):
    unique = []
    by_url = {}
    for raw in jobs:
        job = dict(raw)
        job['url'] = normalize_url(job.get('url', ''))
        if not job['url']:
            continue
        job.setdefault('sources', [job.get('source') or domain_of(job['url'])])

        current = by_url.get(job['url'])
        if current is not None:
            merge_duplicate_job(current, job)
            continue

        duplicate = None
        for existing in unique:
            if same_job(existing, job):
                duplicate = existing
                break
        if duplicate is not None:
            merge_duplicate_job(duplicate, job)
            by_url[job['url']] = duplicate
        else:
            unique.append(job)
            by_url[job['url']] = job
    return unique


def saramin_card_text(anchor):
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))
    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break
        ids = set()
        for link in node.find_all('a', href=True):
            href = link.get('href') or ''
            m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
            if m:
                ids.add(m.group(1))
        if len(ids) > 1:
            break
        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue
        if len(ids) == 1:
            fallback = text
            if has_target_location(text):
                return text
    return fallback


def collect_saramin_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    errors = []

    for query in SARAMIN_DIRECT_QUERIES:
        for page_no in range(1, SARAMIN_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{SARAMIN_BASE}/zf_user/search',
                    params={
                        'searchword': query,
                        'recruitPage': page_no,
                        'recruitPageCount': 40,
                    },
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1
                soup = BeautifulSoup(response.text, 'html.parser')

                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
                    if not m:
                        continue
                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if not title or len(title) < 3:
                        continue
                    body = saramin_card_text(anchor)
                    if not has_target_location(body):
                        continue
                    url = f'{SARAMIN_BASE}/zf_user/jobs/view?rec_idx={m.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '사람인',
                        'sources': ['사람인'],
                    }
                    current = jobs.get(url)
                    if current is None or len(candidate['body']) > len(current['body']):
                        jobs[url] = candidate
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')
            time.sleep(0.12)

    status = {
        'ok': ok_pages > 0,
        'count': len(jobs),
        'failed_pages': failed_pages,
        'errors': errors[:3],
        'mode': '직접',
    }
    print(
        f'[INFO] saramin_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)}'
    )
    direct_jobs = enrich_jobs_from_details(list(jobs.values()))
    return direct_jobs, status


def collect_search_source(source_name, domain):
    jobs = {}
    errors = []
    ddgs = DDGS()
    for term in SOURCE_SEARCH_TERMS:
        query = f'site:{domain} {term}'
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='m',
                max_results=10,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url or domain not in domain_of(url):
                    continue
                if not has_target_location(f'{title} {body}'):
                    continue
                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': 0,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name,
                    'sources': [source_name],
                }
                current = jobs.get(url)
                if current is None or len(body) > len(current.get('body', '')):
                    jobs[url] = candidate
        except Exception as exc:
            errors.append(f'{term}: {type(exc).__name__}')
        time.sleep(0.05)

    status = {
        'ok': len(errors) < len(SOURCE_SEARCH_TERMS),
        'count': len(jobs),
        'failed_queries': len(errors),
        'errors': errors[:2],
        'mode': '검색',
    }
    print(
        f'[INFO] source={source_name} ok={status["ok"]} '
        f'jobs={len(jobs)} failed_queries={len(errors)}'
    )
    return list(jobs.values()), status


def collect_all_sources():
    jobkorea_jobs, jobkorea_raw = collect_jobkorea_direct()
    saramin_jobs, saramin_status = collect_saramin_direct()

    statuses = {
        '잡코리아': {
            'ok': jobkorea_raw.get('ok', False),
            'count': jobkorea_raw.get('parsed_jobs', 0),
            'failed_pages': jobkorea_raw.get('failed_pages', 0),
            'mode': '직접',
        },
        '사람인': saramin_status,
    }
    groups = [jobkorea_jobs, saramin_jobs]

    with ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(collect_search_source, name, domain): name
            for name, domain in SEARCH_SOURCES.items()
        }
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                jobs, status = future.result()
            except Exception as exc:
                jobs = []
                status = {
                    'ok': False,
                    'count': 0,
                    'errors': [f'{type(exc).__name__}: {exc}'],
                    'mode': '검색',
                }
            groups.append(jobs)
            statuses[name] = status

    merged = dedupe_jobs_cross_source([job for group in groups for job in group])
    print(
        f'[INFO] all_sources raw={sum(len(g) for g in groups)} '
        f'deduped={len(merged)} sources={len(statuses)}'
    )
    return merged, statuses


def parse_job_posted_date(title, body):
    text = normalize_text(f'{title} {body}')
    patterns = [
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})', 4),
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(\d{2})[./-](\d{1,2})[./-](\d{1,2})', 2),
    ]
    dates = []
    for pattern, year_digits in patterns:
        for m in re.finditer(pattern, text, re.I):
            try:
                year = int(m.group(1))
                if year_digits == 2:
                    year += 2000
                d = date(year, int(m.group(2)), int(m.group(3)))
                if date.today() - timedelta(days=370) <= d <= date.today() + timedelta(days=2):
                    dates.append(d)
            except Exception:
                pass
    if dates:
        return max(dates).isoformat(), '등록/수정일'

    # 검색 스니펫에 'N일 전'만 있는 경우도 가능한 범위에서 환산한다.
    m = re.search(r'(\d{1,2})\s*일\s*전', text)
    if m:
        days = int(m.group(1))
        if 0 <= days <= 30:
            return (date.today() - timedelta(days=days)).isoformat(), '검색표시'
    if '오늘' in text and any(term in text for term in ('등록', '수정', '게시')):
        return date.today().isoformat(), '검색표시'
    return '', ''


def archive_categories(job):
    cats = []
    title, body, url = job.get('title', ''), job.get('body', ''), job.get('url', '')
    if score_java_result(title, body, url) >= 0:
        cats.append('java_ai')
    if score_regular_dev_result(title, body, url) >= 0:
        cats.append('regular_dev')

    sal = salary_info(title, body)
    if score_salary_result(title, body, url) >= 0 and sal:
        if sal['monthly'] >= 500:
            cats.append('salary500')
        elif sal['monthly'] >= 450:
            cats.append('salary450')

    if score_short_term_result(title, body, url) >= 0:
        cats.append('short_term')
    return cats


def archive_locations(job):
    text = normalize_text(f"{job.get('title', '')} {job.get('body', '')}")
    out = []
    if re.search(r'(?<![가-힣A-Za-z0-9])대전(?:광역시)?(?![가-힣A-Za-z0-9])', text):
        out.append('대전')
    if re.search(r'(?<![가-힣A-Za-z0-9])세종(?:특별자치시)?(?![가-힣A-Za-z0-9])', text):
        out.append('세종')
    return out


def archive_entry(job, existing=None):
    today = today_kst()
    posted, posted_source = parse_job_posted_date(job.get('title', ''), job.get('body', ''))
    old = existing or {}

    salary = salary_info(job.get('title', ''), job.get('body', ''))
    short_pay = short_term_pay_info(job.get('title', ''), job.get('body', ''))
    sources = list(dict.fromkeys(
        (old.get('sources') or [])
        + (job.get('sources') or [job.get('source') or domain_of(job.get('url', ''))])
    ))
    sources = [x for x in sources if x]

    first_seen = old.get('firstSeen') or today
    old_posted = old.get('postedDate') or ''
    if old_posted and (not posted or old_posted < posted):
        posted = old_posted
        posted_source = old.get('dateSource') or posted_source

    company = (
        clean_company_name(job.get('company', ''), job.get('title', ''))
        or company_hint(job.get('title', ''), job.get('body', ''))
        or clean_company_name(old.get('company', ''), job.get('title', ''))
    )
    body = normalize_text(job.get('body', ''))
    if len(body) > 900:
        body = body[:897] + '...'

    entry = {
        'id': normalize_url(job.get('url', '')) or old.get('id') or job_fingerprint(job),
        'title': (
            clean_detail_title(job.get('title', ''), company)
            or clean_detail_title(old.get('title', ''), company)
            or '제목 없음'
        ),
        'company': company,
        'body': body or old.get('body', ''),
        'url': normalize_url(job.get('url', '')) or old.get('url', ''),
        'source': job.get('source') or old.get('source', ''),
        'sources': sources,
        'locations': archive_locations(job) or old.get('locations', []),
        'categories': archive_categories(job),
        'salary': salary,
        'shortPay': short_pay,
        'postedDate': posted or old_posted,
        'dateSource': posted_source or old.get('dateSource', '') or '수집일',
        'firstSeen': first_seen,
        'lastSeen': today,
    }
    if not entry['categories'] and old.get('categories'):
        entry['categories'] = old['categories']
    return entry


def load_job_archive():
    if not ARCHIVE_FILE.exists():
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}
    try:
        data = json.loads(ARCHIVE_FILE.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
            raise ValueError('invalid archive')
        return data
    except Exception as exc:
        print(f'[WARN] job archive load failed: {exc}', file=sys.stderr)
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}


def save_job_archive(all_jobs, source_statuses):
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = load_job_archive()
    old_jobs = previous.get('jobs', [])

    # URL과 공고 fingerprint 양쪽으로 기존 항목을 찾는다.
    by_url = {}
    by_fp = {}
    for old in old_jobs:
        if old.get('url'):
            by_url[normalize_url(old['url'])] = old
        if old.get('id'):
            by_fp[old['id']] = old

    merged = []
    used_old_ids = set()
    for job in all_jobs:
        cats = archive_categories(job)
        if not cats:
            continue
        url = normalize_url(job.get('url', ''))
        fp = job_fingerprint(job)
        old = by_url.get(url) or by_fp.get(fp)
        entry = archive_entry(job, old)
        merged.append(entry)
        if old:
            used_old_ids.add(id(old))

    # 오늘 검색에 안 잡힌 공고도 보관기간 동안은 웹 아카이브에 유지한다.
    for old in old_jobs:
        if id(old) not in used_old_ids:
            merged.append(old)

    # 사이트가 달라도 같은 공고는 하나로 합친다.
    result = []
    for item in merged:
        duplicate = None
        probe = {
            'title': item.get('title', ''),
            'body': item.get('body', ''),
            'url': item.get('url', ''),
        }
        for existing in result:
            ex_probe = {
                'title': existing.get('title', ''),
                'body': existing.get('body', ''),
                'url': existing.get('url', ''),
            }
            if normalize_url(item.get('url', '')) == normalize_url(existing.get('url', '')) or same_job(ex_probe, probe):
                duplicate = existing
                break
        if duplicate is None:
            result.append(item)
        else:
            duplicate['sources'] = list(dict.fromkeys(
                (duplicate.get('sources') or []) + (item.get('sources') or [])
            ))
            if item.get('postedDate', '') > duplicate.get('postedDate', ''):
                duplicate['postedDate'] = item.get('postedDate', '')
                duplicate['dateSource'] = item.get('dateSource', '')
            duplicate['lastSeen'] = max(duplicate.get('lastSeen', ''), item.get('lastSeen', ''))
            duplicate['firstSeen'] = min(
                x for x in [duplicate.get('firstSeen', ''), item.get('firstSeen', '')] if x
            )
            duplicate['categories'] = list(dict.fromkeys(
                (duplicate.get('categories') or []) + (item.get('categories') or [])
            ))

    cutoff = date.today() - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for item in result:
        effective = item.get('postedDate') or item.get('firstSeen') or today_kst()
        try:
            d = date.fromisoformat(effective)
        except Exception:
            d = date.today()
        if d >= cutoff:
            kept.append(item)

    kept.sort(
        key=lambda x: (
            x.get('postedDate') or x.get('firstSeen') or '',
            x.get('lastSeen') or '',
            x.get('title') or '',
        ),
        reverse=True,
    )
    payload = {
        'updatedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds'),
        'rangeDays': ARCHIVE_DAYS,
        'cutoffDate': cutoff.isoformat(),
        'sourceStatuses': source_statuses,
        'count': len(kept),
        'jobs': kept,
    }
    ARCHIVE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'[INFO] job_archive saved={len(kept)} cutoff={cutoff.isoformat()} path={ARCHIVE_FILE}')
    return len(kept)


def search_jobs():
    all_jobs, source_statuses = collect_all_sources()

    java_jobs = classify_jobs(all_jobs, score_java_result)
    regular_dev_jobs = classify_jobs(all_jobs, score_regular_dev_result)
    salary_jobs = classify_jobs(all_jobs, score_salary_result)
    short_term_jobs = classify_jobs(all_jobs, score_short_term_result)

    java_jobs.sort(key=lambda x: (-x['score'], x['title']))
    regular_dev_jobs.sort(key=lambda x: (-x['score'], x['title']))
    salary_jobs.sort(
        key=lambda x: (
            -(x['salary']['monthly'] if x['salary'] else 0),
            -x['score'],
            x['title'],
        )
    )
    short_term_jobs.sort(
        key=lambda x: (
            -(x['short_pay']['sort_value'] if x.get('short_pay') else 0),
            -x['score'],
            x['title'],
        )
    )
    return all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses


def short_body(body, limit=190):
    body = normalize_text(body)
    if len(body) > limit:
        return body[:limit - 3] + '...'
    return body


def append_java_section(lines, jobs):
    lines.extend([
        '① <b>Java/AI 맞춤 공고</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        tags = ' · '.join(tags_for(job['title'], job['body']))
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        lines.append(f'분류: {escape(tags)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_regular_dev_section(lines, jobs):
    lines.extend([
        '④ 💼 <b>개발자 정규직</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append('고용형태: 정규직')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_salary_section(lines, title, jobs):
    lines.extend([
        title,
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        salary = job.get('salary')
        salary_label = salary['label'] if salary else '급여 확인 필요'
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append(f'급여: {escape(salary_label)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_short_term_section(lines, jobs):
    lines.extend([
        '⑤ ⏱ <b>단기알바 · 초보/무경력</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('short_pay'):
            lines.append(f'급여: {escape(job["short_pay"]["label"])}')
        else:
            lines.append('급여: 공고 확인')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('우선 기준: 하루~1개월 · 초보/무경력 · 일정 조정 용이')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 일급/시급 우선 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def build_message(
    java_jobs, salary_500, salary_450, regular_dev_jobs, short_term_jobs,
    source_statuses,
):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    ok_sources = [
        f'{name} {status.get("count", 0)}'
        for name, status in source_statuses.items()
        if status.get('ok')
    ]
    failed_sources = [
        name for name, status in source_statuses.items()
        if not status.get('ok')
    ]
    if ok_sources:
        midpoint = max(1, (len(ok_sources) + 1) // 2)
        lines.append('✅ 수집: ' + ' · '.join(ok_sources[:midpoint]))
        if len(ok_sources) > midpoint:
            lines.append('   ' + ' · '.join(ok_sources[midpoint:]))
    if failed_sources:
        lines.append('⚠️ 수집 실패/제한: ' + ' · '.join(failed_sources))
    lines.append('')

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)
    append_short_term_section(lines, short_term_jobs)

    lines.append('※ 같은 공고는 개발자 정규직 → Java/AI → 급여 → 단기알바 순으로 한 번만 표시합니다.')
    lines.append('')
    lines.append('🔗 <a href="https://jkquant.pages.dev/job">최근 30일 전체 공고 보기</a>')
    return '\n'.join(lines).strip()


def send_via_jkquant(message, count):
    base = os.environ.get('JKQUANT_BASE', 'https://jkquant.pages.dev').rstrip('/')
    key = os.environ.get('AUTOTRADE_KEY', '').strip()
    if not key:
        raise RuntimeError('AUTOTRADE_KEY GitHub Secret이 필요합니다.')

    payload = json.dumps(
        {'text': message, 'count': count},
        ensure_ascii=False,
    ).encode('utf-8')

    proc = subprocess.run(
        [
            'curl',
            '-sS',
            '--max-time', '30',
            '-X', 'POST',
            '-H', f'x-monitor-key: {key}',
            '-H', 'content-type: application/json',
            '--data-binary', '@-',
            '-w', '\n%{http_code}',
            f'{base}/api/job-alert',
        ],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    output = proc.stdout.decode('utf-8', errors='replace')
    stderr = proc.stderr.decode('utf-8', errors='replace')
    if '\n' not in output:
        raise RuntimeError(f'job-alert endpoint invalid response: {output[:500]} {stderr[:300]}')

    body, status = output.rsplit('\n', 1)
    if proc.returncode != 0 or status.strip() != '200':
        raise RuntimeError(
            f'job-alert endpoint failed: curl={proc.returncode} HTTP {status.strip()} '
            f'{body[:500]} {stderr[:300]}'
        )

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'job-alert endpoint invalid JSON: {body[:500]}') from exc

    if not data.get('ok'):
        raise RuntimeError(f'job-alert endpoint error: {data}')


def seen_keys_for_job(job):
    keys = {job.get('url', '')}
    fp = job_fingerprint(job)
    if fp:
        keys.add('fp:' + fp)
    return {k for k in keys if k}


def is_job_seen(job, seen):
    return bool(seen_keys_for_job(job) & seen)


def main():
    force = os.environ.get('FORCE_JOB_ALERT') == '1'
    archive_only = os.environ.get('JOB_ALERT_ARCHIVE_ONLY') == '1'
    if not archive_only and not force and already_sent_today():
        print(f'[INFO] already sent today ({today_kst()} KST); skipping duplicate run.')
        return

    seen = load_seen()
    all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses = search_jobs()
    archive_count = save_job_archive(all_jobs, source_statuses)

    if archive_only:
        print(f'[INFO] ARCHIVE ONLY: {archive_count} jobs stored; Telegram skipped.')
        return

    # 정규직 개발자는 별도 ④ 구역에 우선 표시한다.
    new_regular_dev = [
        job for job in regular_dev_jobs
        if not is_job_seen(job, seen)
    ]
    regular_urls = {job['url'] for job in regular_dev_jobs}

    # Java/AI 구역은 정규직 개발자와 중복되지 않게 프로젝트/계약/AI 중심으로 표시한다.
    new_java = [
        job for job in java_jobs
        if not is_job_seen(job, seen) and job['url'] not in regular_urls
    ]
    java_urls = {job['url'] for job in java_jobs}

    # 급여 공고는 Java/AI 및 개발자 정규직에 나온 공고를 제외한다.
    new_salary = [
        job for job in salary_jobs
        if not is_job_seen(job, seen)
        and job['url'] not in java_urls
        and job['url'] not in regular_urls
    ]

    salary_500 = [
        job for job in new_salary
        if job.get('salary') and job['salary']['monthly'] >= 500
    ]
    salary_450 = [
        job for job in new_salary
        if job.get('salary') and 450 <= job['salary']['monthly'] < 500
    ]

    occupied_urls = (
        java_urls
        | regular_urls
        | {job['url'] for job in salary_jobs}
    )
    new_short_term = [
        job for job in short_term_jobs
        if not is_job_seen(job, seen) and job['url'] not in occupied_urls
    ]

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, short_term_matched={len(short_term_jobs)}, '
        f'new_java={len(new_java)}, new_regular_dev={len(new_regular_dev)}, '
        f'new_500={len(salary_500)}, new_450={len(salary_450)}, '
        f'new_short_term={len(new_short_term)}'
    )

    all_current_jobs = (
        list(java_jobs) + list(regular_dev_jobs)
        + list(salary_jobs) + list(short_term_jobs)
    )
    all_seen = set(seen)
    for job in all_current_jobs:
        all_seen.update(seen_keys_for_job(job))

    total_new = (
        len(new_java) + len(new_regular_dev)
        + len(salary_500) + len(salary_450)
        + len(new_short_term)
    )
    message = build_message(
        new_java, salary_500, salary_450, new_regular_dev, new_short_term,
        source_statuses,
    )

    if total_new == 0:
        succeeded = sum(1 for status in source_statuses.values() if status.get('ok'))
        if succeeded >= 2:
            message += '\n\n오늘은 수집에 성공한 사이트 기준 신규 공고가 없습니다.'
        else:
            message += '\n\n수집 성공 사이트가 부족해 오늘 결과를 0건으로 확정하지 않았습니다.'

    if os.environ.get('JOB_ALERT_DRY_RUN') == '1':
        print('[INFO] DRY RUN: Telegram send skipped.')
        print(message[:6000])
        return

    send_via_jkquant(message, total_new)
    save_seen(all_seen)
    mark_sent_today()
    print(f'[INFO] Telegram job notification sent via jkquant Pages Function. sent_date={today_kst()}')


if __name__ == '__main__':
    main()
, '', text)
    text = text.strip('[]{}<>|·•-–— ')
    if not text or len(text) < 2 or len(text) > 60:
        return ''
    if text in INVALID_COMPANY_EXACT:
        return ''
    if re.fullmatch(r'(?:대전|세종)(?:광역시|특별자치시)?', text):
        return ''
    if re.search(r'^(?:D-\d+|~\s*\d{1,2}/\d{1,2})
    try:
        parts = urlsplit(url)
        kept = []
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith('utm_') or lk in {'sc', 'track', 'tracking', 'ref', 'referer'}:
                continue
            kept.append((k, v))
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(kept), ''))
    except Exception:
        return url


def domain_of(url):
    try:
        return urlsplit(url).netloc.lower().replace('www.', '')
    except Exception:
        return ''


def is_trusted(url):
    domain = domain_of(url)
    return any(domain.endswith(d) for d in TRUSTED_DOMAINS)


def has_target_location(text):
    text = normalize_text(text or '')
    return bool(re.search(
        r'(?<![가-힣A-Za-z0-9])(?:대전(?:광역시)?|세종(?:특별자치시)?)(?![가-힣A-Za-z0-9])',
        text,
        re.I,
    ))


def salary_info(title, body):
    raw_text = f"{title} {body}"
    text = raw_text.lower().replace(',', '')
    candidates = []

    monthly_patterns = [
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})(?:\s*(?:~|-|–|〜)\s*(\d{3,4}))?\s*만원',
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})\s*만\s*원?',
    ]
    for pattern in monthly_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 200 <= low <= 3000:
                candidates.append({
                    'monthly': low,
                    'annual': low * 12,
                    'label': f'월 {low:,.0f}만원 이상 기준',
                })

    annual_patterns = [
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d{4,5})(?:\s*(?:~|-|–|〜)\s*(\d{4,5}))?\s*만원',
        r'(?:연봉|연\s*급여)\s*[:：]?\s*(\d{4,5})\s*(?:이상|부터)',
    ]
    for pattern in annual_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 2400 <= low <= 15000:
                candidates.append({
                    'monthly': low / 12.0,
                    'annual': low,
                    'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
                })

    korean_thousand = re.finditer(
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*천\s*만원',
        text,
    )
    for m in korean_thousand:
        low = float(m.group(1)) * 1000
        if 2400 <= low <= 15000:
            candidates.append({
                'monthly': low / 12.0,
                'annual': low,
                'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
            })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['monthly'])


def short_term_pay_info(title, body):
    text = f"{title} {body}".lower().replace(',', '')
    candidates = []

    daily_patterns = [
        r'(?:일급|일당)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
        r'(?:일급|일당)\s*[:：]?\s*(\d{4,7})\s*원',
        r'(?:하루|1일)\s*(?:급여|수입|일당)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
    ]
    for pattern in daily_patterns:
        for m in re.finditer(pattern, text):
            raw = float(m.group(1))
            won = raw * 10000 if raw < 1000 else raw
            if 30000 <= won <= 1000000:
                candidates.append({
                    'kind': 'daily',
                    'won': won,
                    'sort_value': won,
                    'label': f'일급 {won:,.0f}원',
                })

    hourly_patterns = [
        r'(?:시급)\s*[:：]?\s*(\d{4,6})\s*원',
    ]
    for pattern in hourly_patterns:
        for m in re.finditer(pattern, text):
            won = float(m.group(1))
            if 9000 <= won <= 100000:
                candidates.append({
                    'kind': 'hourly',
                    'won': won,
                    'sort_value': won * 8,
                    'label': f'시급 {won:,.0f}원',
                })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['sort_value'])


def is_entry_only(title, body):
    title_text = normalize_text(title).lower()
    body_text = normalize_text(body).lower()
    text = f'{title_text} {body_text}'

    # '신입·경력', '경력무관', '경력직' 등 경력자 지원 가능 신호가 있으면 허용한다.
    career_allowed = any(
        re.search(pattern, text, re.I)
        for pattern in CAREER_ALLOWED_PATTERNS
    )
    if career_allowed:
        return False

    # 명시적인 신입 전용 문구는 제외한다.
    if any(term in text for term in ENTRY_ONLY_EXPLICIT_TERMS):
        return True

    # 제목 자체가 '[신입]', '(신입)', '신입 개발자/엔지니어/사원 채용' 형태이고
    # 본문에도 경력자 지원 가능 신호가 없으면 신입 전용으로 본다.
    if re.search(r'(?:^|[\[\(\s])신입(?:[\]\)\s]|$)', title_text):
        if re.search(
            r'신입\s*(?:사원|개발자|엔지니어|직원|채용|모집|공채)',
            title_text,
            re.I,
        ) or re.search(r'^\s*[\[\(]?신입[\]\)]?', title_text, re.I):
            return True

    return False


def score_java_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999

    has_dev = any(term in text for term in DEV_REQUIRED_TERMS)
    has_ai = any(term in text for term in AI_TERMS)
    if not has_dev and not has_ai:
        return -999

    score = 0
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in CORE_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in PRIORITY_TERMS if t in text)
    if is_trusted(url):
        score += 5
    return score


def score_regular_dev_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if '정규직' not in text and '정규' not in text:
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999
    if not any(term in text for term in DEV_REQUIRED_TERMS):
        return -999

    # 신입 공고라도 경력 지원 가능 문구가 함께 있으면 허용하고,
    # 명백한 신입 전용 공고는 위 EXCLUDE_TERMS에서 걸러낸다.
    score = 12
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in REGULAR_DEV_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in ('경력', '시니어', '고급', '중급', '유지보수', '운영') if t in text)
    if is_trusted(url):
        score += 5
    return score


def salary_is_plausible(title, body, salary):
    if salary is None:
        return False
    text = f'{title} {body}'.lower()
    annual = salary.get('annual', 0)

    # 일반 채용공고에서 연 1.5억원을 넘는 '만원' 표기는 자릿수/구분자 파싱 오류인 경우가 많다.
    if annual > 15000:
        return False

    # 시급/일급 숫자를 월급으로 오인한 경우를 막는다.
    if salary.get('monthly', 0) > 3000:
        return False

    return True


def score_salary_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999

    salary = salary_info(title, body)
    if not salary_is_plausible(title, body, salary) or salary['monthly'] < 450:
        return -999

    if not is_trusted(url) and not any(term in text for term in JOB_TERMS):
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 5 if is_trusted(url) else 0
    score += min(15, int((salary['monthly'] - 450) / 10))
    score += 2 * sum(1 for t in JOB_TERMS if t in text)
    return score


def score_short_term_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if any(term in text for term in SHORT_TERM_EXCLUDE_TERMS):
        return -999

    has_short = any(term in text for term in SHORT_TERM_TERMS)
    has_easy_role = any(term in text for term in SHORT_TERM_ROLE_TERMS)
    has_no_exp = any(term in text for term in NO_EXPERIENCE_TERMS)

    if not has_short:
        return -999
    if not has_easy_role and not has_no_exp:
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 4 * sum(1 for t in NO_EXPERIENCE_TERMS if t in text)
    score += 3 * sum(1 for t in SHORT_TERM_ROLE_TERMS if t in text)
    score += 2 * sum(1 for t in ('하루', '당일', '1일', '요일협의', '요일 협의') if t in text)

    pay = short_term_pay_info(title, body)
    if pay:
        score += min(20, int(pay['sort_value'] / 10000))

    if is_trusted(url):
        score += 5
    return score


def tags_for(title, body):
    text = f"{title} {body}".lower()
    tags = []
    if any(t in text for t in ('java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov')):
        tags.append('Java')
    if any(t in text for t in ('sm', '유지보수', '운영')):
        tags.append('SM')
    if any(t in text for t in ('프리랜서', '계약직')):
        tags.append('프리/계약')
    if any(t in text for t in AI_TERMS):
        tags.append('AI')
    return tags or ['IT']


def study_hint(title, body):
    text = f"{title} {body}".lower()
    hints = []
    if any(t in text for t in ('spring boot', 'springboot')):
        hints.append('Spring Boot')
    if any(t in text for t in ('ai', 'llm', 'rag', 'agent', '생성형', '챗봇')):
        hints.append('Spring AI')
    if 'rag' in text or 'vector' in text or 'embedding' in text:
        hints.append('RAG/pgvector')
    if 'agent' in text or 'mcp' in text:
        hints.append('Tool Calling/MCP')
    if '전자정부' in text or 'egov' in text:
        hints.append('전자정부프레임워크')
    if not hints:
        hints = ['Spring Boot', 'REST API']
    return ', '.join(dict.fromkeys(hints[:3]))


def today_kst():
    return datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()


def already_sent_today():
    if not SENT_FILE.exists():
        return False
    try:
        return SENT_FILE.read_text(encoding='utf-8').strip() == today_kst()
    except Exception:
        return False


def mark_sent_today():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SENT_FILE.write_text(today_kst(), encoding='utf-8')


def load_seen():
    if not SEEN_FILE.exists():
        return set()
    try:
        data = json.loads(SEEN_FILE.read_text(encoding='utf-8'))
        return set(data.get('urls', []))
    except Exception:
        return set()


def save_seen(urls):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = sorted(urls)[-12000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_group(queries, scorer, source_name=None):
    merged = {}
    ddgs = DDGS()

    for query in queries:
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='w',
                max_results=15,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url:
                    continue

                score = scorer(title, body, url)
                if score < 0:
                    continue

                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': score,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name or domain_of(url),
                    'sources': [source_name or domain_of(url)],
                }
                current = merged.get(url)
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.35)

    return list(merged.values())


def merge_jobs(*groups):
    merged = {}
    for group in groups:
        for job in group:
            current = merged.get(job['url'])
            if current is None or job.get('score', 0) > current.get('score', 0):
                merged[job['url']] = job
    return list(merged.values())


def classify_jobs(jobs, scorer):
    result = []
    for job in jobs:
        score = scorer(job['title'], job['body'], job['url'])
        if score < 0:
            continue
        item = dict(job)
        item['score'] = score
        item['salary'] = salary_info(item['title'], item['body'])
        item['short_pay'] = short_term_pay_info(item['title'], item['body'])
        result.append(item)
    return result


def jobkorea_card_text(anchor):
    # 한 공고 카드의 경계를 'GI_Read 링크가 1개인 가장 가까운 조상'으로 잡는다.
    # 검색결과 전체 컨테이너를 읽어 옆 공고의 지역/급여가 섞이는 것을 막는다.
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))

    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break

        detail_ids = set()
        for link in node.find_all('a', href=True):
            match = re.search(r'/Recruit/GI_Read/(\d+)', link.get('href') or '', re.I)
            if match:
                detail_ids.add(match.group(1))

        if len(detail_ids) > 1:
            break

        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue

        if len(detail_ids) == 1:
            fallback = text
            has_location = any(loc in text for loc in LOCATION_TERMS)
            has_job_meta = any(
                term in text
                for term in (
                    '정규직', '계약직', '프리랜서', '경력', '학력',
                    '만원', '월급', '연봉', '상시채용', '마감',
                )
            )
            if has_location and has_job_meta:
                return text

    return fallback


def jobkorea_title_quality(title):
    text = normalize_text(title)
    lower = text.lower()
    score = min(len(text), 100)

    reward_terms = (
        '개발', 'java', 'spring', 'jsp', '백엔드', '프론트', '웹',
        '채용', '모집', '운영', '유지보수', '엔지니어', 'si', 'sm',
        'ai', '계약직', '정규직', '프리랜서',
    )
    score += 25 * sum(1 for term in reward_terms if term in lower)

    company_markers = ('㈜', '(주)', '주식회사', '관심기업', '벤처기업')
    if any(marker in text for marker in company_markers):
        score -= 80
    if text in {'벤처기업', '중소기업', '강소기업', '외국계'}:
        score -= 200
    return score


def collect_jobkorea_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    parsed_links = 0
    errors = []

    for query in JOBKOREA_DIRECT_QUERIES:
        for page_no in range(1, JOBKOREA_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{JOBKOREA_BASE}/Search',
                    params={'stext': query, 'Page_No': page_no},
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1

                soup = BeautifulSoup(response.text, 'html.parser')
                page_links = 0
                page_parsed_detail_links = 0
                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    match = re.search(r'/Recruit/GI_Read/(\d+)', href, re.I)
                    if not match:
                        continue

                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if (
                        not title
                        or len(title) < 2
                        or title in {'즉시지원', '홈페이지 지원', '스크랩', '관심기업'}
                    ):
                        continue

                    page_parsed_detail_links += 1
                    body = jobkorea_card_text(anchor)
                    if not has_target_location(body):
                        continue

                    url = f'{JOBKOREA_BASE}/Recruit/GI_Read/{match.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '잡코리아',
                        'sources': ['잡코리아'],
                        '_title_quality': jobkorea_title_quality(title),
                    }
                    current = jobs.get(url)
                    if current is None:
                        jobs[url] = candidate
                    else:
                        if len(candidate['body']) > len(current['body']):
                            current['body'] = candidate['body']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                        if candidate['_title_quality'] > current.get('_title_quality', -9999):
                            current['title'] = candidate['title']
                            current['_title_quality'] = candidate['_title_quality']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                    page_links += 1

                parsed_links += page_links
                # 검색 결과 페이지 구조가 바뀐 경우 조용히 '0건'으로 오인하지 않는다.
                raw_has_job_links = bool(
                    re.search(r'/Recruit/GI_Read/\d+', response.text, re.I)
                )
                if raw_has_job_links and page_parsed_detail_links == 0:
                    failed_pages += 1
                    errors.append(f'{query} p{page_no}: HTML에는 공고가 있으나 링크 파싱 0건')
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')

            time.sleep(0.15)

    status = {
        'ok': ok_pages > 0 and parsed_links > 0,
        'ok_pages': ok_pages,
        'failed_pages': failed_pages,
        'parsed_jobs': len(jobs),
        'parsed_links': parsed_links,
        'errors': errors[:5],
    }
    print(
        f'[INFO] jobkorea_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)} '
        f'parsed_links={parsed_links}'
    )
    for error in errors[:5]:
        print(f'[WARN] jobkorea direct: {error}', file=sys.stderr)

    for job in jobs.values():
        job.pop('_title_quality', None)
    return list(jobs.values()), status


def compact_job_title(title):
    text = normalize_text(title).lower()
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', text)
    text = re.sub(
        r'\b(?:채용|모집|공고|정규직|계약직|프리랜서|경력직|경력|신입|즉시지원)\b',
        ' ',
        text,
    )
    text = re.sub(r'[^0-9a-z가-힣]+', ' ', text)
    return normalize_text(text)


def title_tokens(title):
    return {
        token for token in compact_job_title(title).split()
        if len(token) >= 2 and token not in {'대전', '세종', '개발자', '채용', '모집'}
    }


def company_hint(title, body):
    text = f'{title} {body}'
    patterns = [
        r'(?:㈜|\(주\)|주식회사)\s*([가-힣A-Za-z0-9&._-]{2,30})',
        r'([가-힣A-Za-z0-9&._-]{2,30})\s+(?:대전|세종)(?:광역시|특별자치시)?\b',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(1).lower()
    return ''


def job_fingerprint(job):
    title = compact_job_title(job.get('title', ''))
    company = company_hint(job.get('title', ''), job.get('body', ''))
    return f'{company}|{title}' if company else title


def same_job(a, b):
    if not has_target_location(f"{a.get('title','')} {a.get('body','')}"):
        return False
    if not has_target_location(f"{b.get('title','')} {b.get('body','')}"):
        return False

    ca = company_hint(a.get('title', ''), a.get('body', ''))
    cb = company_hint(b.get('title', ''), b.get('body', ''))
    if ca and cb and ca != cb:
        return False

    ta = compact_job_title(a.get('title', ''))
    tb = compact_job_title(b.get('title', ''))
    if not ta or not tb:
        return False
    if ta == tb:
        return True

    ratio = SequenceMatcher(None, ta, tb).ratio()
    sa, sb = title_tokens(ta), title_tokens(tb)
    union = sa | sb
    jaccard = (len(sa & sb) / len(union)) if union else 0.0
    return ratio >= 0.90 or (len(sa & sb) >= 3 and jaccard >= 0.78)


def merge_duplicate_job(base, incoming):
    sources = list(dict.fromkeys(
        (base.get('sources') or [base.get('source')])
        + (incoming.get('sources') or [incoming.get('source')])
    ))
    sources = [s for s in sources if s]
    base['sources'] = sources

    bp = SOURCE_PRIORITY.get(base.get('source'), 0)
    ip = SOURCE_PRIORITY.get(incoming.get('source'), 0)
    if ip > bp:
        for key in ('title', 'url', 'source'):
            base[key] = incoming.get(key, base.get(key))

    if len(incoming.get('body', '')) > len(base.get('body', '')):
        base['body'] = incoming.get('body', '')

    base['salary'] = salary_info(base.get('title', ''), base.get('body', ''))
    base['short_pay'] = short_term_pay_info(base.get('title', ''), base.get('body', ''))
    base['score'] = max(base.get('score', 0), incoming.get('score', 0))
    return base


def dedupe_jobs_cross_source(jobs):
    unique = []
    by_url = {}
    for raw in jobs:
        job = dict(raw)
        job['url'] = normalize_url(job.get('url', ''))
        if not job['url']:
            continue
        job.setdefault('sources', [job.get('source') or domain_of(job['url'])])

        current = by_url.get(job['url'])
        if current is not None:
            merge_duplicate_job(current, job)
            continue

        duplicate = None
        for existing in unique:
            if same_job(existing, job):
                duplicate = existing
                break
        if duplicate is not None:
            merge_duplicate_job(duplicate, job)
            by_url[job['url']] = duplicate
        else:
            unique.append(job)
            by_url[job['url']] = job
    return unique


def saramin_card_text(anchor):
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))
    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break
        ids = set()
        for link in node.find_all('a', href=True):
            href = link.get('href') or ''
            m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
            if m:
                ids.add(m.group(1))
        if len(ids) > 1:
            break
        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue
        if len(ids) == 1:
            fallback = text
            if has_target_location(text):
                return text
    return fallback


def collect_saramin_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    errors = []

    for query in SARAMIN_DIRECT_QUERIES:
        for page_no in range(1, SARAMIN_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{SARAMIN_BASE}/zf_user/search',
                    params={
                        'searchword': query,
                        'recruitPage': page_no,
                        'recruitPageCount': 40,
                    },
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1
                soup = BeautifulSoup(response.text, 'html.parser')

                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
                    if not m:
                        continue
                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if not title or len(title) < 3:
                        continue
                    body = saramin_card_text(anchor)
                    if not has_target_location(body):
                        continue
                    url = f'{SARAMIN_BASE}/zf_user/jobs/view?rec_idx={m.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '사람인',
                        'sources': ['사람인'],
                    }
                    current = jobs.get(url)
                    if current is None or len(candidate['body']) > len(current['body']):
                        jobs[url] = candidate
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')
            time.sleep(0.12)

    status = {
        'ok': ok_pages > 0,
        'count': len(jobs),
        'failed_pages': failed_pages,
        'errors': errors[:3],
        'mode': '직접',
    }
    print(
        f'[INFO] saramin_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)}'
    )
    return list(jobs.values()), status


def collect_search_source(source_name, domain):
    jobs = {}
    errors = []
    ddgs = DDGS()
    for term in SOURCE_SEARCH_TERMS:
        query = f'site:{domain} {term}'
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='m',
                max_results=10,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url or domain not in domain_of(url):
                    continue
                if not has_target_location(f'{title} {body}'):
                    continue
                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': 0,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name,
                    'sources': [source_name],
                }
                current = jobs.get(url)
                if current is None or len(body) > len(current.get('body', '')):
                    jobs[url] = candidate
        except Exception as exc:
            errors.append(f'{term}: {type(exc).__name__}')
        time.sleep(0.05)

    status = {
        'ok': len(errors) < len(SOURCE_SEARCH_TERMS),
        'count': len(jobs),
        'failed_queries': len(errors),
        'errors': errors[:2],
        'mode': '검색',
    }
    print(
        f'[INFO] source={source_name} ok={status["ok"]} '
        f'jobs={len(jobs)} failed_queries={len(errors)}'
    )
    return list(jobs.values()), status


def collect_all_sources():
    jobkorea_jobs, jobkorea_raw = collect_jobkorea_direct()
    saramin_jobs, saramin_status = collect_saramin_direct()

    statuses = {
        '잡코리아': {
            'ok': jobkorea_raw.get('ok', False),
            'count': jobkorea_raw.get('parsed_jobs', 0),
            'failed_pages': jobkorea_raw.get('failed_pages', 0),
            'mode': '직접',
        },
        '사람인': saramin_status,
    }
    groups = [jobkorea_jobs, saramin_jobs]

    with ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(collect_search_source, name, domain): name
            for name, domain in SEARCH_SOURCES.items()
        }
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                jobs, status = future.result()
            except Exception as exc:
                jobs = []
                status = {
                    'ok': False,
                    'count': 0,
                    'errors': [f'{type(exc).__name__}: {exc}'],
                    'mode': '검색',
                }
            groups.append(jobs)
            statuses[name] = status

    merged = dedupe_jobs_cross_source([job for group in groups for job in group])
    print(
        f'[INFO] all_sources raw={sum(len(g) for g in groups)} '
        f'deduped={len(merged)} sources={len(statuses)}'
    )
    return merged, statuses


def parse_job_posted_date(title, body):
    text = normalize_text(f'{title} {body}')
    patterns = [
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})', 4),
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(\d{2})[./-](\d{1,2})[./-](\d{1,2})', 2),
    ]
    dates = []
    for pattern, year_digits in patterns:
        for m in re.finditer(pattern, text, re.I):
            try:
                year = int(m.group(1))
                if year_digits == 2:
                    year += 2000
                d = date(year, int(m.group(2)), int(m.group(3)))
                if date.today() - timedelta(days=370) <= d <= date.today() + timedelta(days=2):
                    dates.append(d)
            except Exception:
                pass
    if dates:
        return max(dates).isoformat(), '등록/수정일'

    # 검색 스니펫에 'N일 전'만 있는 경우도 가능한 범위에서 환산한다.
    m = re.search(r'(\d{1,2})\s*일\s*전', text)
    if m:
        days = int(m.group(1))
        if 0 <= days <= 30:
            return (date.today() - timedelta(days=days)).isoformat(), '검색표시'
    if '오늘' in text and any(term in text for term in ('등록', '수정', '게시')):
        return date.today().isoformat(), '검색표시'
    return '', ''


def archive_categories(job):
    cats = []
    title, body, url = job.get('title', ''), job.get('body', ''), job.get('url', '')
    if score_java_result(title, body, url) >= 0:
        cats.append('java_ai')
    if score_regular_dev_result(title, body, url) >= 0:
        cats.append('regular_dev')

    sal = salary_info(title, body)
    if score_salary_result(title, body, url) >= 0 and sal:
        if sal['monthly'] >= 500:
            cats.append('salary500')
        elif sal['monthly'] >= 450:
            cats.append('salary450')

    if score_short_term_result(title, body, url) >= 0:
        cats.append('short_term')
    return cats


def archive_locations(job):
    text = normalize_text(f"{job.get('title', '')} {job.get('body', '')}")
    out = []
    if re.search(r'(?<![가-힣A-Za-z0-9])대전(?:광역시)?(?![가-힣A-Za-z0-9])', text):
        out.append('대전')
    if re.search(r'(?<![가-힣A-Za-z0-9])세종(?:특별자치시)?(?![가-힣A-Za-z0-9])', text):
        out.append('세종')
    return out


def archive_entry(job, existing=None):
    today = today_kst()
    posted, posted_source = parse_job_posted_date(job.get('title', ''), job.get('body', ''))
    old = existing or {}

    salary = salary_info(job.get('title', ''), job.get('body', ''))
    short_pay = short_term_pay_info(job.get('title', ''), job.get('body', ''))
    sources = list(dict.fromkeys(
        (old.get('sources') or [])
        + (job.get('sources') or [job.get('source') or domain_of(job.get('url', ''))])
    ))
    sources = [x for x in sources if x]

    first_seen = old.get('firstSeen') or today
    old_posted = old.get('postedDate') or ''
    if old_posted and (not posted or old_posted < posted):
        posted = old_posted
        posted_source = old.get('dateSource') or posted_source

    company = company_hint(job.get('title', ''), job.get('body', '')) or old.get('company', '')
    body = normalize_text(job.get('body', ''))
    if len(body) > 900:
        body = body[:897] + '...'

    entry = {
        'id': old.get('id') or job_fingerprint(job) or normalize_url(job.get('url', '')),
        'title': job.get('title', '') or old.get('title', ''),
        'company': company,
        'body': body or old.get('body', ''),
        'url': normalize_url(job.get('url', '')) or old.get('url', ''),
        'source': job.get('source') or old.get('source', ''),
        'sources': sources,
        'locations': archive_locations(job) or old.get('locations', []),
        'categories': archive_categories(job),
        'salary': salary,
        'shortPay': short_pay,
        'postedDate': posted or old_posted,
        'dateSource': posted_source or old.get('dateSource', '') or '수집일',
        'firstSeen': first_seen,
        'lastSeen': today,
    }
    if not entry['categories'] and old.get('categories'):
        entry['categories'] = old['categories']
    return entry


def load_job_archive():
    if not ARCHIVE_FILE.exists():
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}
    try:
        data = json.loads(ARCHIVE_FILE.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
            raise ValueError('invalid archive')
        return data
    except Exception as exc:
        print(f'[WARN] job archive load failed: {exc}', file=sys.stderr)
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}


def save_job_archive(all_jobs, source_statuses):
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = load_job_archive()
    old_jobs = previous.get('jobs', [])

    # URL과 공고 fingerprint 양쪽으로 기존 항목을 찾는다.
    by_url = {}
    by_fp = {}
    for old in old_jobs:
        if old.get('url'):
            by_url[normalize_url(old['url'])] = old
        if old.get('id'):
            by_fp[old['id']] = old

    merged = []
    used_old_ids = set()
    for job in all_jobs:
        cats = archive_categories(job)
        if not cats:
            continue
        url = normalize_url(job.get('url', ''))
        fp = job_fingerprint(job)
        old = by_url.get(url) or by_fp.get(fp)
        entry = archive_entry(job, old)
        merged.append(entry)
        if old:
            used_old_ids.add(id(old))

    # 오늘 검색에 안 잡힌 공고도 30일 동안은 웹 아카이브에 유지한다.
    for old in old_jobs:
        if id(old) not in used_old_ids:
            merged.append(old)

    # 사이트가 달라도 같은 공고는 하나로 합친다.
    result = []
    for item in merged:
        duplicate = None
        probe = {
            'title': item.get('title', ''),
            'body': item.get('body', ''),
            'url': item.get('url', ''),
        }
        for existing in result:
            ex_probe = {
                'title': existing.get('title', ''),
                'body': existing.get('body', ''),
                'url': existing.get('url', ''),
            }
            if normalize_url(item.get('url', '')) == normalize_url(existing.get('url', '')) or same_job(ex_probe, probe):
                duplicate = existing
                break
        if duplicate is None:
            result.append(item)
        else:
            duplicate['sources'] = list(dict.fromkeys(
                (duplicate.get('sources') or []) + (item.get('sources') or [])
            ))
            if item.get('postedDate', '') > duplicate.get('postedDate', ''):
                duplicate['postedDate'] = item.get('postedDate', '')
                duplicate['dateSource'] = item.get('dateSource', '')
            duplicate['lastSeen'] = max(duplicate.get('lastSeen', ''), item.get('lastSeen', ''))
            duplicate['firstSeen'] = min(
                x for x in [duplicate.get('firstSeen', ''), item.get('firstSeen', '')] if x
            )
            duplicate['categories'] = list(dict.fromkeys(
                (duplicate.get('categories') or []) + (item.get('categories') or [])
            ))

    cutoff = date.today() - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for item in result:
        effective = item.get('postedDate') or item.get('firstSeen') or today_kst()
        try:
            d = date.fromisoformat(effective)
        except Exception:
            d = date.today()
        if d >= cutoff:
            kept.append(item)

    kept.sort(
        key=lambda x: (
            x.get('postedDate') or x.get('firstSeen') or '',
            x.get('lastSeen') or '',
            x.get('title') or '',
        ),
        reverse=True,
    )
    payload = {
        'updatedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds'),
        'rangeDays': ARCHIVE_DAYS,
        'cutoffDate': cutoff.isoformat(),
        'sourceStatuses': source_statuses,
        'count': len(kept),
        'jobs': kept,
    }
    ARCHIVE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'[INFO] job_archive saved={len(kept)} cutoff={cutoff.isoformat()} path={ARCHIVE_FILE}')
    return len(kept)


def search_jobs():
    all_jobs, source_statuses = collect_all_sources()

    java_jobs = classify_jobs(all_jobs, score_java_result)
    regular_dev_jobs = classify_jobs(all_jobs, score_regular_dev_result)
    salary_jobs = classify_jobs(all_jobs, score_salary_result)
    short_term_jobs = classify_jobs(all_jobs, score_short_term_result)

    java_jobs.sort(key=lambda x: (-x['score'], x['title']))
    regular_dev_jobs.sort(key=lambda x: (-x['score'], x['title']))
    salary_jobs.sort(
        key=lambda x: (
            -(x['salary']['monthly'] if x['salary'] else 0),
            -x['score'],
            x['title'],
        )
    )
    short_term_jobs.sort(
        key=lambda x: (
            -(x['short_pay']['sort_value'] if x.get('short_pay') else 0),
            -x['score'],
            x['title'],
        )
    )
    return all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses


def short_body(body, limit=190):
    body = normalize_text(body)
    if len(body) > limit:
        return body[:limit - 3] + '...'
    return body


def append_java_section(lines, jobs):
    lines.extend([
        '① <b>Java/AI 맞춤 공고</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        tags = ' · '.join(tags_for(job['title'], job['body']))
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        lines.append(f'분류: {escape(tags)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_regular_dev_section(lines, jobs):
    lines.extend([
        '④ 💼 <b>개발자 정규직</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append('고용형태: 정규직')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_salary_section(lines, title, jobs):
    lines.extend([
        title,
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        salary = job.get('salary')
        salary_label = salary['label'] if salary else '급여 확인 필요'
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append(f'급여: {escape(salary_label)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_short_term_section(lines, jobs):
    lines.extend([
        '⑤ ⏱ <b>단기알바 · 초보/무경력</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('short_pay'):
            lines.append(f'급여: {escape(job["short_pay"]["label"])}')
        else:
            lines.append('급여: 공고 확인')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('우선 기준: 하루~1개월 · 초보/무경력 · 일정 조정 용이')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 일급/시급 우선 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def build_message(
    java_jobs, salary_500, salary_450, regular_dev_jobs, short_term_jobs,
    source_statuses,
):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    ok_sources = [
        f'{name} {status.get("count", 0)}'
        for name, status in source_statuses.items()
        if status.get('ok')
    ]
    failed_sources = [
        name for name, status in source_statuses.items()
        if not status.get('ok')
    ]
    if ok_sources:
        midpoint = max(1, (len(ok_sources) + 1) // 2)
        lines.append('✅ 수집: ' + ' · '.join(ok_sources[:midpoint]))
        if len(ok_sources) > midpoint:
            lines.append('   ' + ' · '.join(ok_sources[midpoint:]))
    if failed_sources:
        lines.append('⚠️ 수집 실패/제한: ' + ' · '.join(failed_sources))
    lines.append('')

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)
    append_short_term_section(lines, short_term_jobs)

    lines.append('※ 같은 공고는 개발자 정규직 → Java/AI → 급여 → 단기알바 순으로 한 번만 표시합니다.')
    lines.append('')
    lines.append('🔗 <a href="https://jkquant.pages.dev/job">최근 30일 전체 공고 보기</a>')
    return '\n'.join(lines).strip()


def send_via_jkquant(message, count):
    base = os.environ.get('JKQUANT_BASE', 'https://jkquant.pages.dev').rstrip('/')
    key = os.environ.get('AUTOTRADE_KEY', '').strip()
    if not key:
        raise RuntimeError('AUTOTRADE_KEY GitHub Secret이 필요합니다.')

    payload = json.dumps(
        {'text': message, 'count': count},
        ensure_ascii=False,
    ).encode('utf-8')

    proc = subprocess.run(
        [
            'curl',
            '-sS',
            '--max-time', '30',
            '-X', 'POST',
            '-H', f'x-monitor-key: {key}',
            '-H', 'content-type: application/json',
            '--data-binary', '@-',
            '-w', '\n%{http_code}',
            f'{base}/api/job-alert',
        ],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    output = proc.stdout.decode('utf-8', errors='replace')
    stderr = proc.stderr.decode('utf-8', errors='replace')
    if '\n' not in output:
        raise RuntimeError(f'job-alert endpoint invalid response: {output[:500]} {stderr[:300]}')

    body, status = output.rsplit('\n', 1)
    if proc.returncode != 0 or status.strip() != '200':
        raise RuntimeError(
            f'job-alert endpoint failed: curl={proc.returncode} HTTP {status.strip()} '
            f'{body[:500]} {stderr[:300]}'
        )

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'job-alert endpoint invalid JSON: {body[:500]}') from exc

    if not data.get('ok'):
        raise RuntimeError(f'job-alert endpoint error: {data}')


def seen_keys_for_job(job):
    keys = {job.get('url', '')}
    fp = job_fingerprint(job)
    if fp:
        keys.add('fp:' + fp)
    return {k for k in keys if k}


def is_job_seen(job, seen):
    return bool(seen_keys_for_job(job) & seen)


def main():
    force = os.environ.get('FORCE_JOB_ALERT') == '1'
    archive_only = os.environ.get('JOB_ALERT_ARCHIVE_ONLY') == '1'
    if not archive_only and not force and already_sent_today():
        print(f'[INFO] already sent today ({today_kst()} KST); skipping duplicate run.')
        return

    seen = load_seen()
    all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses = search_jobs()
    archive_count = save_job_archive(all_jobs, source_statuses)

    if archive_only:
        print(f'[INFO] ARCHIVE ONLY: {archive_count} jobs stored; Telegram skipped.')
        return

    # 정규직 개발자는 별도 ④ 구역에 우선 표시한다.
    new_regular_dev = [
        job for job in regular_dev_jobs
        if not is_job_seen(job, seen)
    ]
    regular_urls = {job['url'] for job in regular_dev_jobs}

    # Java/AI 구역은 정규직 개발자와 중복되지 않게 프로젝트/계약/AI 중심으로 표시한다.
    new_java = [
        job for job in java_jobs
        if not is_job_seen(job, seen) and job['url'] not in regular_urls
    ]
    java_urls = {job['url'] for job in java_jobs}

    # 급여 공고는 Java/AI 및 개발자 정규직에 나온 공고를 제외한다.
    new_salary = [
        job for job in salary_jobs
        if not is_job_seen(job, seen)
        and job['url'] not in java_urls
        and job['url'] not in regular_urls
    ]

    salary_500 = [
        job for job in new_salary
        if job.get('salary') and job['salary']['monthly'] >= 500
    ]
    salary_450 = [
        job for job in new_salary
        if job.get('salary') and 450 <= job['salary']['monthly'] < 500
    ]

    occupied_urls = (
        java_urls
        | regular_urls
        | {job['url'] for job in salary_jobs}
    )
    new_short_term = [
        job for job in short_term_jobs
        if not is_job_seen(job, seen) and job['url'] not in occupied_urls
    ]

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, short_term_matched={len(short_term_jobs)}, '
        f'new_java={len(new_java)}, new_regular_dev={len(new_regular_dev)}, '
        f'new_500={len(salary_500)}, new_450={len(salary_450)}, '
        f'new_short_term={len(new_short_term)}'
    )

    all_current_jobs = (
        list(java_jobs) + list(regular_dev_jobs)
        + list(salary_jobs) + list(short_term_jobs)
    )
    all_seen = set(seen)
    for job in all_current_jobs:
        all_seen.update(seen_keys_for_job(job))

    total_new = (
        len(new_java) + len(new_regular_dev)
        + len(salary_500) + len(salary_450)
        + len(new_short_term)
    )
    message = build_message(
        new_java, salary_500, salary_450, new_regular_dev, new_short_term,
        source_statuses,
    )

    if total_new == 0:
        succeeded = sum(1 for status in source_statuses.values() if status.get('ok'))
        if succeeded >= 2:
            message += '\n\n오늘은 수집에 성공한 사이트 기준 신규 공고가 없습니다.'
        else:
            message += '\n\n수집 성공 사이트가 부족해 오늘 결과를 0건으로 확정하지 않았습니다.'

    if os.environ.get('JOB_ALERT_DRY_RUN') == '1':
        print('[INFO] DRY RUN: Telegram send skipped.')
        print(message[:6000])
        return

    send_via_jkquant(message, total_new)
    save_seen(all_seen)
    mark_sent_today()
    print(f'[INFO] Telegram job notification sent via jkquant Pages Function. sent_date={today_kst()}')


if __name__ == '__main__':
    main()
, text, re.I):
        return ''
    if any(token in text for token in ('입사지원', '홈페이지 지원', '즉시지원', '스크랩', '수정일')):
        return ''
    if title and normalize_text(title) == text:
        return ''
    return text


def is_generic_job_title(value):
    text = normalize_text(value)
    if not text or len(text) < 3:
        return True
    if text in GENERIC_JOB_TITLES:
        return True
    if re.fullmatch(r'(?:입사지원|홈페이지\s*지원|즉시지원|스크랩|관심기업)(?:\s*\d+)?', text):
        return True
    return False


def clean_detail_title(value, company=''):
    text = normalize_text(value)
    if not text:
        return ''
    text = re.sub(r'\s*(?:[-|｜]\s*)?(?:사람인|잡코리아)\s*
    try:
        parts = urlsplit(url)
        kept = []
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith('utm_') or lk in {'sc', 'track', 'tracking', 'ref', 'referer'}:
                continue
            kept.append((k, v))
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(kept), ''))
    except Exception:
        return url


def domain_of(url):
    try:
        return urlsplit(url).netloc.lower().replace('www.', '')
    except Exception:
        return ''


def is_trusted(url):
    domain = domain_of(url)
    return any(domain.endswith(d) for d in TRUSTED_DOMAINS)


def has_target_location(text):
    text = normalize_text(text or '')
    return bool(re.search(
        r'(?<![가-힣A-Za-z0-9])(?:대전(?:광역시)?|세종(?:특별자치시)?)(?![가-힣A-Za-z0-9])',
        text,
        re.I,
    ))


def salary_info(title, body):
    raw_text = f"{title} {body}"
    text = raw_text.lower().replace(',', '')
    candidates = []

    monthly_patterns = [
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})(?:\s*(?:~|-|–|〜)\s*(\d{3,4}))?\s*만원',
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})\s*만\s*원?',
    ]
    for pattern in monthly_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 200 <= low <= 3000:
                candidates.append({
                    'monthly': low,
                    'annual': low * 12,
                    'label': f'월 {low:,.0f}만원 이상 기준',
                })

    annual_patterns = [
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d{4,5})(?:\s*(?:~|-|–|〜)\s*(\d{4,5}))?\s*만원',
        r'(?:연봉|연\s*급여)\s*[:：]?\s*(\d{4,5})\s*(?:이상|부터)',
    ]
    for pattern in annual_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 2400 <= low <= 15000:
                candidates.append({
                    'monthly': low / 12.0,
                    'annual': low,
                    'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
                })

    korean_thousand = re.finditer(
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*천\s*만원',
        text,
    )
    for m in korean_thousand:
        low = float(m.group(1)) * 1000
        if 2400 <= low <= 15000:
            candidates.append({
                'monthly': low / 12.0,
                'annual': low,
                'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
            })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['monthly'])


def short_term_pay_info(title, body):
    text = f"{title} {body}".lower().replace(',', '')
    candidates = []

    daily_patterns = [
        r'(?:일급|일당)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
        r'(?:일급|일당)\s*[:：]?\s*(\d{4,7})\s*원',
        r'(?:하루|1일)\s*(?:급여|수입|일당)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
    ]
    for pattern in daily_patterns:
        for m in re.finditer(pattern, text):
            raw = float(m.group(1))
            won = raw * 10000 if raw < 1000 else raw
            if 30000 <= won <= 1000000:
                candidates.append({
                    'kind': 'daily',
                    'won': won,
                    'sort_value': won,
                    'label': f'일급 {won:,.0f}원',
                })

    hourly_patterns = [
        r'(?:시급)\s*[:：]?\s*(\d{4,6})\s*원',
    ]
    for pattern in hourly_patterns:
        for m in re.finditer(pattern, text):
            won = float(m.group(1))
            if 9000 <= won <= 100000:
                candidates.append({
                    'kind': 'hourly',
                    'won': won,
                    'sort_value': won * 8,
                    'label': f'시급 {won:,.0f}원',
                })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['sort_value'])


def is_entry_only(title, body):
    title_text = normalize_text(title).lower()
    body_text = normalize_text(body).lower()
    text = f'{title_text} {body_text}'

    # '신입·경력', '경력무관', '경력직' 등 경력자 지원 가능 신호가 있으면 허용한다.
    career_allowed = any(
        re.search(pattern, text, re.I)
        for pattern in CAREER_ALLOWED_PATTERNS
    )
    if career_allowed:
        return False

    # 명시적인 신입 전용 문구는 제외한다.
    if any(term in text for term in ENTRY_ONLY_EXPLICIT_TERMS):
        return True

    # 제목 자체가 '[신입]', '(신입)', '신입 개발자/엔지니어/사원 채용' 형태이고
    # 본문에도 경력자 지원 가능 신호가 없으면 신입 전용으로 본다.
    if re.search(r'(?:^|[\[\(\s])신입(?:[\]\)\s]|$)', title_text):
        if re.search(
            r'신입\s*(?:사원|개발자|엔지니어|직원|채용|모집|공채)',
            title_text,
            re.I,
        ) or re.search(r'^\s*[\[\(]?신입[\]\)]?', title_text, re.I):
            return True

    return False


def score_java_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999

    has_dev = any(term in text for term in DEV_REQUIRED_TERMS)
    has_ai = any(term in text for term in AI_TERMS)
    if not has_dev and not has_ai:
        return -999

    score = 0
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in CORE_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in PRIORITY_TERMS if t in text)
    if is_trusted(url):
        score += 5
    return score


def score_regular_dev_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if '정규직' not in text and '정규' not in text:
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999
    if not any(term in text for term in DEV_REQUIRED_TERMS):
        return -999

    # 신입 공고라도 경력 지원 가능 문구가 함께 있으면 허용하고,
    # 명백한 신입 전용 공고는 위 EXCLUDE_TERMS에서 걸러낸다.
    score = 12
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in REGULAR_DEV_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in ('경력', '시니어', '고급', '중급', '유지보수', '운영') if t in text)
    if is_trusted(url):
        score += 5
    return score


def salary_is_plausible(title, body, salary):
    if salary is None:
        return False
    text = f'{title} {body}'.lower()
    annual = salary.get('annual', 0)

    # 일반 채용공고에서 연 1.5억원을 넘는 '만원' 표기는 자릿수/구분자 파싱 오류인 경우가 많다.
    if annual > 15000:
        return False

    # 시급/일급 숫자를 월급으로 오인한 경우를 막는다.
    if salary.get('monthly', 0) > 3000:
        return False

    return True


def score_salary_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999

    salary = salary_info(title, body)
    if not salary_is_plausible(title, body, salary) or salary['monthly'] < 450:
        return -999

    if not is_trusted(url) and not any(term in text for term in JOB_TERMS):
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 5 if is_trusted(url) else 0
    score += min(15, int((salary['monthly'] - 450) / 10))
    score += 2 * sum(1 for t in JOB_TERMS if t in text)
    return score


def score_short_term_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if any(term in text for term in SHORT_TERM_EXCLUDE_TERMS):
        return -999

    has_short = any(term in text for term in SHORT_TERM_TERMS)
    has_easy_role = any(term in text for term in SHORT_TERM_ROLE_TERMS)
    has_no_exp = any(term in text for term in NO_EXPERIENCE_TERMS)

    if not has_short:
        return -999
    if not has_easy_role and not has_no_exp:
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 4 * sum(1 for t in NO_EXPERIENCE_TERMS if t in text)
    score += 3 * sum(1 for t in SHORT_TERM_ROLE_TERMS if t in text)
    score += 2 * sum(1 for t in ('하루', '당일', '1일', '요일협의', '요일 협의') if t in text)

    pay = short_term_pay_info(title, body)
    if pay:
        score += min(20, int(pay['sort_value'] / 10000))

    if is_trusted(url):
        score += 5
    return score


def tags_for(title, body):
    text = f"{title} {body}".lower()
    tags = []
    if any(t in text for t in ('java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov')):
        tags.append('Java')
    if any(t in text for t in ('sm', '유지보수', '운영')):
        tags.append('SM')
    if any(t in text for t in ('프리랜서', '계약직')):
        tags.append('프리/계약')
    if any(t in text for t in AI_TERMS):
        tags.append('AI')
    return tags or ['IT']


def study_hint(title, body):
    text = f"{title} {body}".lower()
    hints = []
    if any(t in text for t in ('spring boot', 'springboot')):
        hints.append('Spring Boot')
    if any(t in text for t in ('ai', 'llm', 'rag', 'agent', '생성형', '챗봇')):
        hints.append('Spring AI')
    if 'rag' in text or 'vector' in text or 'embedding' in text:
        hints.append('RAG/pgvector')
    if 'agent' in text or 'mcp' in text:
        hints.append('Tool Calling/MCP')
    if '전자정부' in text or 'egov' in text:
        hints.append('전자정부프레임워크')
    if not hints:
        hints = ['Spring Boot', 'REST API']
    return ', '.join(dict.fromkeys(hints[:3]))


def today_kst():
    return datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()


def already_sent_today():
    if not SENT_FILE.exists():
        return False
    try:
        return SENT_FILE.read_text(encoding='utf-8').strip() == today_kst()
    except Exception:
        return False


def mark_sent_today():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SENT_FILE.write_text(today_kst(), encoding='utf-8')


def load_seen():
    if not SEEN_FILE.exists():
        return set()
    try:
        data = json.loads(SEEN_FILE.read_text(encoding='utf-8'))
        return set(data.get('urls', []))
    except Exception:
        return set()


def save_seen(urls):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = sorted(urls)[-12000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_group(queries, scorer, source_name=None):
    merged = {}
    ddgs = DDGS()

    for query in queries:
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='w',
                max_results=15,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url:
                    continue

                score = scorer(title, body, url)
                if score < 0:
                    continue

                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': score,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name or domain_of(url),
                    'sources': [source_name or domain_of(url)],
                }
                current = merged.get(url)
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.35)

    return list(merged.values())


def merge_jobs(*groups):
    merged = {}
    for group in groups:
        for job in group:
            current = merged.get(job['url'])
            if current is None or job.get('score', 0) > current.get('score', 0):
                merged[job['url']] = job
    return list(merged.values())


def classify_jobs(jobs, scorer):
    result = []
    for job in jobs:
        score = scorer(job['title'], job['body'], job['url'])
        if score < 0:
            continue
        item = dict(job)
        item['score'] = score
        item['salary'] = salary_info(item['title'], item['body'])
        item['short_pay'] = short_term_pay_info(item['title'], item['body'])
        result.append(item)
    return result


def jobkorea_card_text(anchor):
    # 한 공고 카드의 경계를 'GI_Read 링크가 1개인 가장 가까운 조상'으로 잡는다.
    # 검색결과 전체 컨테이너를 읽어 옆 공고의 지역/급여가 섞이는 것을 막는다.
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))

    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break

        detail_ids = set()
        for link in node.find_all('a', href=True):
            match = re.search(r'/Recruit/GI_Read/(\d+)', link.get('href') or '', re.I)
            if match:
                detail_ids.add(match.group(1))

        if len(detail_ids) > 1:
            break

        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue

        if len(detail_ids) == 1:
            fallback = text
            has_location = any(loc in text for loc in LOCATION_TERMS)
            has_job_meta = any(
                term in text
                for term in (
                    '정규직', '계약직', '프리랜서', '경력', '학력',
                    '만원', '월급', '연봉', '상시채용', '마감',
                )
            )
            if has_location and has_job_meta:
                return text

    return fallback


def jobkorea_title_quality(title):
    text = normalize_text(title)
    lower = text.lower()
    score = min(len(text), 100)

    reward_terms = (
        '개발', 'java', 'spring', 'jsp', '백엔드', '프론트', '웹',
        '채용', '모집', '운영', '유지보수', '엔지니어', 'si', 'sm',
        'ai', '계약직', '정규직', '프리랜서',
    )
    score += 25 * sum(1 for term in reward_terms if term in lower)

    company_markers = ('㈜', '(주)', '주식회사', '관심기업', '벤처기업')
    if any(marker in text for marker in company_markers):
        score -= 80
    if text in {'벤처기업', '중소기업', '강소기업', '외국계'}:
        score -= 200
    return score


def collect_jobkorea_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    parsed_links = 0
    errors = []

    for query in JOBKOREA_DIRECT_QUERIES:
        for page_no in range(1, JOBKOREA_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{JOBKOREA_BASE}/Search',
                    params={'stext': query, 'Page_No': page_no},
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1

                soup = BeautifulSoup(response.text, 'html.parser')
                page_links = 0
                page_parsed_detail_links = 0
                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    match = re.search(r'/Recruit/GI_Read/(\d+)', href, re.I)
                    if not match:
                        continue

                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if (
                        not title
                        or len(title) < 2
                        or title in {'즉시지원', '홈페이지 지원', '스크랩', '관심기업'}
                    ):
                        continue

                    page_parsed_detail_links += 1
                    body = jobkorea_card_text(anchor)
                    if not has_target_location(body):
                        continue

                    url = f'{JOBKOREA_BASE}/Recruit/GI_Read/{match.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '잡코리아',
                        'sources': ['잡코리아'],
                        '_title_quality': jobkorea_title_quality(title),
                    }
                    current = jobs.get(url)
                    if current is None:
                        jobs[url] = candidate
                    else:
                        if len(candidate['body']) > len(current['body']):
                            current['body'] = candidate['body']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                        if candidate['_title_quality'] > current.get('_title_quality', -9999):
                            current['title'] = candidate['title']
                            current['_title_quality'] = candidate['_title_quality']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                    page_links += 1

                parsed_links += page_links
                # 검색 결과 페이지 구조가 바뀐 경우 조용히 '0건'으로 오인하지 않는다.
                raw_has_job_links = bool(
                    re.search(r'/Recruit/GI_Read/\d+', response.text, re.I)
                )
                if raw_has_job_links and page_parsed_detail_links == 0:
                    failed_pages += 1
                    errors.append(f'{query} p{page_no}: HTML에는 공고가 있으나 링크 파싱 0건')
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')

            time.sleep(0.15)

    status = {
        'ok': ok_pages > 0 and parsed_links > 0,
        'ok_pages': ok_pages,
        'failed_pages': failed_pages,
        'parsed_jobs': len(jobs),
        'parsed_links': parsed_links,
        'errors': errors[:5],
    }
    print(
        f'[INFO] jobkorea_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)} '
        f'parsed_links={parsed_links}'
    )
    for error in errors[:5]:
        print(f'[WARN] jobkorea direct: {error}', file=sys.stderr)

    for job in jobs.values():
        job.pop('_title_quality', None)
    return list(jobs.values()), status


def compact_job_title(title):
    text = normalize_text(title).lower()
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', text)
    text = re.sub(
        r'\b(?:채용|모집|공고|정규직|계약직|프리랜서|경력직|경력|신입|즉시지원)\b',
        ' ',
        text,
    )
    text = re.sub(r'[^0-9a-z가-힣]+', ' ', text)
    return normalize_text(text)


def title_tokens(title):
    return {
        token for token in compact_job_title(title).split()
        if len(token) >= 2 and token not in {'대전', '세종', '개발자', '채용', '모집'}
    }


def company_hint(title, body):
    text = f'{title} {body}'
    patterns = [
        r'(?:㈜|\(주\)|주식회사)\s*([가-힣A-Za-z0-9&._-]{2,30})',
        r'([가-힣A-Za-z0-9&._-]{2,30})\s+(?:대전|세종)(?:광역시|특별자치시)?\b',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(1).lower()
    return ''


def job_fingerprint(job):
    title = compact_job_title(job.get('title', ''))
    company = company_hint(job.get('title', ''), job.get('body', ''))
    return f'{company}|{title}' if company else title


def same_job(a, b):
    if not has_target_location(f"{a.get('title','')} {a.get('body','')}"):
        return False
    if not has_target_location(f"{b.get('title','')} {b.get('body','')}"):
        return False

    ca = company_hint(a.get('title', ''), a.get('body', ''))
    cb = company_hint(b.get('title', ''), b.get('body', ''))
    if ca and cb and ca != cb:
        return False

    ta = compact_job_title(a.get('title', ''))
    tb = compact_job_title(b.get('title', ''))
    if not ta or not tb:
        return False
    if ta == tb:
        return True

    ratio = SequenceMatcher(None, ta, tb).ratio()
    sa, sb = title_tokens(ta), title_tokens(tb)
    union = sa | sb
    jaccard = (len(sa & sb) / len(union)) if union else 0.0
    return ratio >= 0.90 or (len(sa & sb) >= 3 and jaccard >= 0.78)


def merge_duplicate_job(base, incoming):
    sources = list(dict.fromkeys(
        (base.get('sources') or [base.get('source')])
        + (incoming.get('sources') or [incoming.get('source')])
    ))
    sources = [s for s in sources if s]
    base['sources'] = sources

    bp = SOURCE_PRIORITY.get(base.get('source'), 0)
    ip = SOURCE_PRIORITY.get(incoming.get('source'), 0)
    if ip > bp:
        for key in ('title', 'url', 'source'):
            base[key] = incoming.get(key, base.get(key))

    if len(incoming.get('body', '')) > len(base.get('body', '')):
        base['body'] = incoming.get('body', '')

    base['salary'] = salary_info(base.get('title', ''), base.get('body', ''))
    base['short_pay'] = short_term_pay_info(base.get('title', ''), base.get('body', ''))
    base['score'] = max(base.get('score', 0), incoming.get('score', 0))
    return base


def dedupe_jobs_cross_source(jobs):
    unique = []
    by_url = {}
    for raw in jobs:
        job = dict(raw)
        job['url'] = normalize_url(job.get('url', ''))
        if not job['url']:
            continue
        job.setdefault('sources', [job.get('source') or domain_of(job['url'])])

        current = by_url.get(job['url'])
        if current is not None:
            merge_duplicate_job(current, job)
            continue

        duplicate = None
        for existing in unique:
            if same_job(existing, job):
                duplicate = existing
                break
        if duplicate is not None:
            merge_duplicate_job(duplicate, job)
            by_url[job['url']] = duplicate
        else:
            unique.append(job)
            by_url[job['url']] = job
    return unique


def saramin_card_text(anchor):
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))
    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break
        ids = set()
        for link in node.find_all('a', href=True):
            href = link.get('href') or ''
            m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
            if m:
                ids.add(m.group(1))
        if len(ids) > 1:
            break
        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue
        if len(ids) == 1:
            fallback = text
            if has_target_location(text):
                return text
    return fallback


def collect_saramin_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    errors = []

    for query in SARAMIN_DIRECT_QUERIES:
        for page_no in range(1, SARAMIN_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{SARAMIN_BASE}/zf_user/search',
                    params={
                        'searchword': query,
                        'recruitPage': page_no,
                        'recruitPageCount': 40,
                    },
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1
                soup = BeautifulSoup(response.text, 'html.parser')

                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
                    if not m:
                        continue
                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if not title or len(title) < 3:
                        continue
                    body = saramin_card_text(anchor)
                    if not has_target_location(body):
                        continue
                    url = f'{SARAMIN_BASE}/zf_user/jobs/view?rec_idx={m.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '사람인',
                        'sources': ['사람인'],
                    }
                    current = jobs.get(url)
                    if current is None or len(candidate['body']) > len(current['body']):
                        jobs[url] = candidate
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')
            time.sleep(0.12)

    status = {
        'ok': ok_pages > 0,
        'count': len(jobs),
        'failed_pages': failed_pages,
        'errors': errors[:3],
        'mode': '직접',
    }
    print(
        f'[INFO] saramin_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)}'
    )
    return list(jobs.values()), status


def collect_search_source(source_name, domain):
    jobs = {}
    errors = []
    ddgs = DDGS()
    for term in SOURCE_SEARCH_TERMS:
        query = f'site:{domain} {term}'
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='m',
                max_results=10,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url or domain not in domain_of(url):
                    continue
                if not has_target_location(f'{title} {body}'):
                    continue
                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': 0,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name,
                    'sources': [source_name],
                }
                current = jobs.get(url)
                if current is None or len(body) > len(current.get('body', '')):
                    jobs[url] = candidate
        except Exception as exc:
            errors.append(f'{term}: {type(exc).__name__}')
        time.sleep(0.05)

    status = {
        'ok': len(errors) < len(SOURCE_SEARCH_TERMS),
        'count': len(jobs),
        'failed_queries': len(errors),
        'errors': errors[:2],
        'mode': '검색',
    }
    print(
        f'[INFO] source={source_name} ok={status["ok"]} '
        f'jobs={len(jobs)} failed_queries={len(errors)}'
    )
    return list(jobs.values()), status


def collect_all_sources():
    jobkorea_jobs, jobkorea_raw = collect_jobkorea_direct()
    saramin_jobs, saramin_status = collect_saramin_direct()

    statuses = {
        '잡코리아': {
            'ok': jobkorea_raw.get('ok', False),
            'count': jobkorea_raw.get('parsed_jobs', 0),
            'failed_pages': jobkorea_raw.get('failed_pages', 0),
            'mode': '직접',
        },
        '사람인': saramin_status,
    }
    groups = [jobkorea_jobs, saramin_jobs]

    with ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(collect_search_source, name, domain): name
            for name, domain in SEARCH_SOURCES.items()
        }
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                jobs, status = future.result()
            except Exception as exc:
                jobs = []
                status = {
                    'ok': False,
                    'count': 0,
                    'errors': [f'{type(exc).__name__}: {exc}'],
                    'mode': '검색',
                }
            groups.append(jobs)
            statuses[name] = status

    merged = dedupe_jobs_cross_source([job for group in groups for job in group])
    print(
        f'[INFO] all_sources raw={sum(len(g) for g in groups)} '
        f'deduped={len(merged)} sources={len(statuses)}'
    )
    return merged, statuses


def parse_job_posted_date(title, body):
    text = normalize_text(f'{title} {body}')
    patterns = [
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})', 4),
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(\d{2})[./-](\d{1,2})[./-](\d{1,2})', 2),
    ]
    dates = []
    for pattern, year_digits in patterns:
        for m in re.finditer(pattern, text, re.I):
            try:
                year = int(m.group(1))
                if year_digits == 2:
                    year += 2000
                d = date(year, int(m.group(2)), int(m.group(3)))
                if date.today() - timedelta(days=370) <= d <= date.today() + timedelta(days=2):
                    dates.append(d)
            except Exception:
                pass
    if dates:
        return max(dates).isoformat(), '등록/수정일'

    # 검색 스니펫에 'N일 전'만 있는 경우도 가능한 범위에서 환산한다.
    m = re.search(r'(\d{1,2})\s*일\s*전', text)
    if m:
        days = int(m.group(1))
        if 0 <= days <= 30:
            return (date.today() - timedelta(days=days)).isoformat(), '검색표시'
    if '오늘' in text and any(term in text for term in ('등록', '수정', '게시')):
        return date.today().isoformat(), '검색표시'
    return '', ''


def archive_categories(job):
    cats = []
    title, body, url = job.get('title', ''), job.get('body', ''), job.get('url', '')
    if score_java_result(title, body, url) >= 0:
        cats.append('java_ai')
    if score_regular_dev_result(title, body, url) >= 0:
        cats.append('regular_dev')

    sal = salary_info(title, body)
    if score_salary_result(title, body, url) >= 0 and sal:
        if sal['monthly'] >= 500:
            cats.append('salary500')
        elif sal['monthly'] >= 450:
            cats.append('salary450')

    if score_short_term_result(title, body, url) >= 0:
        cats.append('short_term')
    return cats


def archive_locations(job):
    text = normalize_text(f"{job.get('title', '')} {job.get('body', '')}")
    out = []
    if re.search(r'(?<![가-힣A-Za-z0-9])대전(?:광역시)?(?![가-힣A-Za-z0-9])', text):
        out.append('대전')
    if re.search(r'(?<![가-힣A-Za-z0-9])세종(?:특별자치시)?(?![가-힣A-Za-z0-9])', text):
        out.append('세종')
    return out


def archive_entry(job, existing=None):
    today = today_kst()
    posted, posted_source = parse_job_posted_date(job.get('title', ''), job.get('body', ''))
    old = existing or {}

    salary = salary_info(job.get('title', ''), job.get('body', ''))
    short_pay = short_term_pay_info(job.get('title', ''), job.get('body', ''))
    sources = list(dict.fromkeys(
        (old.get('sources') or [])
        + (job.get('sources') or [job.get('source') or domain_of(job.get('url', ''))])
    ))
    sources = [x for x in sources if x]

    first_seen = old.get('firstSeen') or today
    old_posted = old.get('postedDate') or ''
    if old_posted and (not posted or old_posted < posted):
        posted = old_posted
        posted_source = old.get('dateSource') or posted_source

    company = company_hint(job.get('title', ''), job.get('body', '')) or old.get('company', '')
    body = normalize_text(job.get('body', ''))
    if len(body) > 900:
        body = body[:897] + '...'

    entry = {
        'id': old.get('id') or job_fingerprint(job) or normalize_url(job.get('url', '')),
        'title': job.get('title', '') or old.get('title', ''),
        'company': company,
        'body': body or old.get('body', ''),
        'url': normalize_url(job.get('url', '')) or old.get('url', ''),
        'source': job.get('source') or old.get('source', ''),
        'sources': sources,
        'locations': archive_locations(job) or old.get('locations', []),
        'categories': archive_categories(job),
        'salary': salary,
        'shortPay': short_pay,
        'postedDate': posted or old_posted,
        'dateSource': posted_source or old.get('dateSource', '') or '수집일',
        'firstSeen': first_seen,
        'lastSeen': today,
    }
    if not entry['categories'] and old.get('categories'):
        entry['categories'] = old['categories']
    return entry


def load_job_archive():
    if not ARCHIVE_FILE.exists():
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}
    try:
        data = json.loads(ARCHIVE_FILE.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
            raise ValueError('invalid archive')
        return data
    except Exception as exc:
        print(f'[WARN] job archive load failed: {exc}', file=sys.stderr)
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}


def save_job_archive(all_jobs, source_statuses):
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = load_job_archive()
    old_jobs = previous.get('jobs', [])

    # URL과 공고 fingerprint 양쪽으로 기존 항목을 찾는다.
    by_url = {}
    by_fp = {}
    for old in old_jobs:
        if old.get('url'):
            by_url[normalize_url(old['url'])] = old
        if old.get('id'):
            by_fp[old['id']] = old

    merged = []
    used_old_ids = set()
    for job in all_jobs:
        cats = archive_categories(job)
        if not cats:
            continue
        url = normalize_url(job.get('url', ''))
        fp = job_fingerprint(job)
        old = by_url.get(url) or by_fp.get(fp)
        entry = archive_entry(job, old)
        merged.append(entry)
        if old:
            used_old_ids.add(id(old))

    # 오늘 검색에 안 잡힌 공고도 30일 동안은 웹 아카이브에 유지한다.
    for old in old_jobs:
        if id(old) not in used_old_ids:
            merged.append(old)

    # 사이트가 달라도 같은 공고는 하나로 합친다.
    result = []
    for item in merged:
        duplicate = None
        probe = {
            'title': item.get('title', ''),
            'body': item.get('body', ''),
            'url': item.get('url', ''),
        }
        for existing in result:
            ex_probe = {
                'title': existing.get('title', ''),
                'body': existing.get('body', ''),
                'url': existing.get('url', ''),
            }
            if normalize_url(item.get('url', '')) == normalize_url(existing.get('url', '')) or same_job(ex_probe, probe):
                duplicate = existing
                break
        if duplicate is None:
            result.append(item)
        else:
            duplicate['sources'] = list(dict.fromkeys(
                (duplicate.get('sources') or []) + (item.get('sources') or [])
            ))
            if item.get('postedDate', '') > duplicate.get('postedDate', ''):
                duplicate['postedDate'] = item.get('postedDate', '')
                duplicate['dateSource'] = item.get('dateSource', '')
            duplicate['lastSeen'] = max(duplicate.get('lastSeen', ''), item.get('lastSeen', ''))
            duplicate['firstSeen'] = min(
                x for x in [duplicate.get('firstSeen', ''), item.get('firstSeen', '')] if x
            )
            duplicate['categories'] = list(dict.fromkeys(
                (duplicate.get('categories') or []) + (item.get('categories') or [])
            ))

    cutoff = date.today() - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for item in result:
        effective = item.get('postedDate') or item.get('firstSeen') or today_kst()
        try:
            d = date.fromisoformat(effective)
        except Exception:
            d = date.today()
        if d >= cutoff:
            kept.append(item)

    kept.sort(
        key=lambda x: (
            x.get('postedDate') or x.get('firstSeen') or '',
            x.get('lastSeen') or '',
            x.get('title') or '',
        ),
        reverse=True,
    )
    payload = {
        'updatedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds'),
        'rangeDays': ARCHIVE_DAYS,
        'cutoffDate': cutoff.isoformat(),
        'sourceStatuses': source_statuses,
        'count': len(kept),
        'jobs': kept,
    }
    ARCHIVE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'[INFO] job_archive saved={len(kept)} cutoff={cutoff.isoformat()} path={ARCHIVE_FILE}')
    return len(kept)


def search_jobs():
    all_jobs, source_statuses = collect_all_sources()

    java_jobs = classify_jobs(all_jobs, score_java_result)
    regular_dev_jobs = classify_jobs(all_jobs, score_regular_dev_result)
    salary_jobs = classify_jobs(all_jobs, score_salary_result)
    short_term_jobs = classify_jobs(all_jobs, score_short_term_result)

    java_jobs.sort(key=lambda x: (-x['score'], x['title']))
    regular_dev_jobs.sort(key=lambda x: (-x['score'], x['title']))
    salary_jobs.sort(
        key=lambda x: (
            -(x['salary']['monthly'] if x['salary'] else 0),
            -x['score'],
            x['title'],
        )
    )
    short_term_jobs.sort(
        key=lambda x: (
            -(x['short_pay']['sort_value'] if x.get('short_pay') else 0),
            -x['score'],
            x['title'],
        )
    )
    return all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses


def short_body(body, limit=190):
    body = normalize_text(body)
    if len(body) > limit:
        return body[:limit - 3] + '...'
    return body


def append_java_section(lines, jobs):
    lines.extend([
        '① <b>Java/AI 맞춤 공고</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        tags = ' · '.join(tags_for(job['title'], job['body']))
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        lines.append(f'분류: {escape(tags)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_regular_dev_section(lines, jobs):
    lines.extend([
        '④ 💼 <b>개발자 정규직</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append('고용형태: 정규직')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_salary_section(lines, title, jobs):
    lines.extend([
        title,
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        salary = job.get('salary')
        salary_label = salary['label'] if salary else '급여 확인 필요'
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append(f'급여: {escape(salary_label)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_short_term_section(lines, jobs):
    lines.extend([
        '⑤ ⏱ <b>단기알바 · 초보/무경력</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('short_pay'):
            lines.append(f'급여: {escape(job["short_pay"]["label"])}')
        else:
            lines.append('급여: 공고 확인')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('우선 기준: 하루~1개월 · 초보/무경력 · 일정 조정 용이')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 일급/시급 우선 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def build_message(
    java_jobs, salary_500, salary_450, regular_dev_jobs, short_term_jobs,
    source_statuses,
):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    ok_sources = [
        f'{name} {status.get("count", 0)}'
        for name, status in source_statuses.items()
        if status.get('ok')
    ]
    failed_sources = [
        name for name, status in source_statuses.items()
        if not status.get('ok')
    ]
    if ok_sources:
        midpoint = max(1, (len(ok_sources) + 1) // 2)
        lines.append('✅ 수집: ' + ' · '.join(ok_sources[:midpoint]))
        if len(ok_sources) > midpoint:
            lines.append('   ' + ' · '.join(ok_sources[midpoint:]))
    if failed_sources:
        lines.append('⚠️ 수집 실패/제한: ' + ' · '.join(failed_sources))
    lines.append('')

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)
    append_short_term_section(lines, short_term_jobs)

    lines.append('※ 같은 공고는 개발자 정규직 → Java/AI → 급여 → 단기알바 순으로 한 번만 표시합니다.')
    lines.append('')
    lines.append('🔗 <a href="https://jkquant.pages.dev/job">최근 30일 전체 공고 보기</a>')
    return '\n'.join(lines).strip()


def send_via_jkquant(message, count):
    base = os.environ.get('JKQUANT_BASE', 'https://jkquant.pages.dev').rstrip('/')
    key = os.environ.get('AUTOTRADE_KEY', '').strip()
    if not key:
        raise RuntimeError('AUTOTRADE_KEY GitHub Secret이 필요합니다.')

    payload = json.dumps(
        {'text': message, 'count': count},
        ensure_ascii=False,
    ).encode('utf-8')

    proc = subprocess.run(
        [
            'curl',
            '-sS',
            '--max-time', '30',
            '-X', 'POST',
            '-H', f'x-monitor-key: {key}',
            '-H', 'content-type: application/json',
            '--data-binary', '@-',
            '-w', '\n%{http_code}',
            f'{base}/api/job-alert',
        ],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    output = proc.stdout.decode('utf-8', errors='replace')
    stderr = proc.stderr.decode('utf-8', errors='replace')
    if '\n' not in output:
        raise RuntimeError(f'job-alert endpoint invalid response: {output[:500]} {stderr[:300]}')

    body, status = output.rsplit('\n', 1)
    if proc.returncode != 0 or status.strip() != '200':
        raise RuntimeError(
            f'job-alert endpoint failed: curl={proc.returncode} HTTP {status.strip()} '
            f'{body[:500]} {stderr[:300]}'
        )

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'job-alert endpoint invalid JSON: {body[:500]}') from exc

    if not data.get('ok'):
        raise RuntimeError(f'job-alert endpoint error: {data}')


def seen_keys_for_job(job):
    keys = {job.get('url', '')}
    fp = job_fingerprint(job)
    if fp:
        keys.add('fp:' + fp)
    return {k for k in keys if k}


def is_job_seen(job, seen):
    return bool(seen_keys_for_job(job) & seen)


def main():
    force = os.environ.get('FORCE_JOB_ALERT') == '1'
    archive_only = os.environ.get('JOB_ALERT_ARCHIVE_ONLY') == '1'
    if not archive_only and not force and already_sent_today():
        print(f'[INFO] already sent today ({today_kst()} KST); skipping duplicate run.')
        return

    seen = load_seen()
    all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses = search_jobs()
    archive_count = save_job_archive(all_jobs, source_statuses)

    if archive_only:
        print(f'[INFO] ARCHIVE ONLY: {archive_count} jobs stored; Telegram skipped.')
        return

    # 정규직 개발자는 별도 ④ 구역에 우선 표시한다.
    new_regular_dev = [
        job for job in regular_dev_jobs
        if not is_job_seen(job, seen)
    ]
    regular_urls = {job['url'] for job in regular_dev_jobs}

    # Java/AI 구역은 정규직 개발자와 중복되지 않게 프로젝트/계약/AI 중심으로 표시한다.
    new_java = [
        job for job in java_jobs
        if not is_job_seen(job, seen) and job['url'] not in regular_urls
    ]
    java_urls = {job['url'] for job in java_jobs}

    # 급여 공고는 Java/AI 및 개발자 정규직에 나온 공고를 제외한다.
    new_salary = [
        job for job in salary_jobs
        if not is_job_seen(job, seen)
        and job['url'] not in java_urls
        and job['url'] not in regular_urls
    ]

    salary_500 = [
        job for job in new_salary
        if job.get('salary') and job['salary']['monthly'] >= 500
    ]
    salary_450 = [
        job for job in new_salary
        if job.get('salary') and 450 <= job['salary']['monthly'] < 500
    ]

    occupied_urls = (
        java_urls
        | regular_urls
        | {job['url'] for job in salary_jobs}
    )
    new_short_term = [
        job for job in short_term_jobs
        if not is_job_seen(job, seen) and job['url'] not in occupied_urls
    ]

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, short_term_matched={len(short_term_jobs)}, '
        f'new_java={len(new_java)}, new_regular_dev={len(new_regular_dev)}, '
        f'new_500={len(salary_500)}, new_450={len(salary_450)}, '
        f'new_short_term={len(new_short_term)}'
    )

    all_current_jobs = (
        list(java_jobs) + list(regular_dev_jobs)
        + list(salary_jobs) + list(short_term_jobs)
    )
    all_seen = set(seen)
    for job in all_current_jobs:
        all_seen.update(seen_keys_for_job(job))

    total_new = (
        len(new_java) + len(new_regular_dev)
        + len(salary_500) + len(salary_450)
        + len(new_short_term)
    )
    message = build_message(
        new_java, salary_500, salary_450, new_regular_dev, new_short_term,
        source_statuses,
    )

    if total_new == 0:
        succeeded = sum(1 for status in source_statuses.values() if status.get('ok'))
        if succeeded >= 2:
            message += '\n\n오늘은 수집에 성공한 사이트 기준 신규 공고가 없습니다.'
        else:
            message += '\n\n수집 성공 사이트가 부족해 오늘 결과를 0건으로 확정하지 않았습니다.'

    if os.environ.get('JOB_ALERT_DRY_RUN') == '1':
        print('[INFO] DRY RUN: Telegram send skipped.')
        print(message[:6000])
        return

    send_via_jkquant(message, total_new)
    save_seen(all_seen)
    mark_sent_today()
    print(f'[INFO] Telegram job notification sent via jkquant Pages Function. sent_date={today_kst()}')


if __name__ == '__main__':
    main()
, '', text).strip()
    company = clean_company_name(company)
    if company:
        prefixes = [
            f'[{company}]',
            f'[{company.replace("(주)", "").replace("㈜", "").strip()}]',
        ]
        for prefix in prefixes:
            if prefix != '[]' and text.startswith(prefix):
                text = normalize_text(text[len(prefix):])
                break
    return '' if is_generic_job_title(text) else text


def _walk_jsonld(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_jsonld(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_jsonld(child)


def extract_detail_identity(html, source=''):
    soup = BeautifulSoup(html or '', 'html.parser')
    title = ''
    company = ''

    # 가장 신뢰도가 높은 schema.org JobPosting을 우선 사용한다.
    for script in soup.find_all('script'):
        typ = (script.get('type') or '').lower()
        if 'ld+json' not in typ:
            continue
        raw = script.string or script.get_text() or ''
        if not raw.strip():
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue
        for obj in _walk_jsonld(data):
            obj_type = obj.get('@type')
            types = obj_type if isinstance(obj_type, list) else [obj_type]
            if not any(str(t).lower() == 'jobposting' for t in types if t):
                continue
            candidate_title = normalize_text(obj.get('title') or obj.get('name') or '')
            org = obj.get('hiringOrganization') or obj.get('hiring_organization') or {}
            if isinstance(org, dict):
                candidate_company = normalize_text(org.get('name') or '')
            elif isinstance(org, str):
                candidate_company = normalize_text(org)
            else:
                candidate_company = ''
            candidate_company = clean_company_name(candidate_company, candidate_title)
            candidate_title = clean_detail_title(candidate_title, candidate_company)
            if candidate_title:
                title = candidate_title
            if candidate_company:
                company = candidate_company
            if title and company:
                return title, company

    # og:title / <title>은 대부분 "[회사] 공고제목 - 사이트명" 형태다.
    page_titles = []
    og = soup.find('meta', attrs={'property': 'og:title'})
    if og and og.get('content'):
        page_titles.append(normalize_text(og.get('content')))
    if soup.title and soup.title.string:
        page_titles.append(normalize_text(soup.title.string))

    for page_title in page_titles:
        m = re.match(r'^\[([^\[\]]{2,80})\]\s*(.+)
    try:
        parts = urlsplit(url)
        kept = []
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith('utm_') or lk in {'sc', 'track', 'tracking', 'ref', 'referer'}:
                continue
            kept.append((k, v))
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(kept), ''))
    except Exception:
        return url


def domain_of(url):
    try:
        return urlsplit(url).netloc.lower().replace('www.', '')
    except Exception:
        return ''


def is_trusted(url):
    domain = domain_of(url)
    return any(domain.endswith(d) for d in TRUSTED_DOMAINS)


def has_target_location(text):
    text = normalize_text(text or '')
    return bool(re.search(
        r'(?<![가-힣A-Za-z0-9])(?:대전(?:광역시)?|세종(?:특별자치시)?)(?![가-힣A-Za-z0-9])',
        text,
        re.I,
    ))


def salary_info(title, body):
    raw_text = f"{title} {body}"
    text = raw_text.lower().replace(',', '')
    candidates = []

    monthly_patterns = [
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})(?:\s*(?:~|-|–|〜)\s*(\d{3,4}))?\s*만원',
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})\s*만\s*원?',
    ]
    for pattern in monthly_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 200 <= low <= 3000:
                candidates.append({
                    'monthly': low,
                    'annual': low * 12,
                    'label': f'월 {low:,.0f}만원 이상 기준',
                })

    annual_patterns = [
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d{4,5})(?:\s*(?:~|-|–|〜)\s*(\d{4,5}))?\s*만원',
        r'(?:연봉|연\s*급여)\s*[:：]?\s*(\d{4,5})\s*(?:이상|부터)',
    ]
    for pattern in annual_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 2400 <= low <= 15000:
                candidates.append({
                    'monthly': low / 12.0,
                    'annual': low,
                    'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
                })

    korean_thousand = re.finditer(
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*천\s*만원',
        text,
    )
    for m in korean_thousand:
        low = float(m.group(1)) * 1000
        if 2400 <= low <= 15000:
            candidates.append({
                'monthly': low / 12.0,
                'annual': low,
                'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
            })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['monthly'])


def short_term_pay_info(title, body):
    text = f"{title} {body}".lower().replace(',', '')
    candidates = []

    daily_patterns = [
        r'(?:일급|일당)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
        r'(?:일급|일당)\s*[:：]?\s*(\d{4,7})\s*원',
        r'(?:하루|1일)\s*(?:급여|수입|일당)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
    ]
    for pattern in daily_patterns:
        for m in re.finditer(pattern, text):
            raw = float(m.group(1))
            won = raw * 10000 if raw < 1000 else raw
            if 30000 <= won <= 1000000:
                candidates.append({
                    'kind': 'daily',
                    'won': won,
                    'sort_value': won,
                    'label': f'일급 {won:,.0f}원',
                })

    hourly_patterns = [
        r'(?:시급)\s*[:：]?\s*(\d{4,6})\s*원',
    ]
    for pattern in hourly_patterns:
        for m in re.finditer(pattern, text):
            won = float(m.group(1))
            if 9000 <= won <= 100000:
                candidates.append({
                    'kind': 'hourly',
                    'won': won,
                    'sort_value': won * 8,
                    'label': f'시급 {won:,.0f}원',
                })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['sort_value'])


def is_entry_only(title, body):
    title_text = normalize_text(title).lower()
    body_text = normalize_text(body).lower()
    text = f'{title_text} {body_text}'

    # '신입·경력', '경력무관', '경력직' 등 경력자 지원 가능 신호가 있으면 허용한다.
    career_allowed = any(
        re.search(pattern, text, re.I)
        for pattern in CAREER_ALLOWED_PATTERNS
    )
    if career_allowed:
        return False

    # 명시적인 신입 전용 문구는 제외한다.
    if any(term in text for term in ENTRY_ONLY_EXPLICIT_TERMS):
        return True

    # 제목 자체가 '[신입]', '(신입)', '신입 개발자/엔지니어/사원 채용' 형태이고
    # 본문에도 경력자 지원 가능 신호가 없으면 신입 전용으로 본다.
    if re.search(r'(?:^|[\[\(\s])신입(?:[\]\)\s]|$)', title_text):
        if re.search(
            r'신입\s*(?:사원|개발자|엔지니어|직원|채용|모집|공채)',
            title_text,
            re.I,
        ) or re.search(r'^\s*[\[\(]?신입[\]\)]?', title_text, re.I):
            return True

    return False


def score_java_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999

    has_dev = any(term in text for term in DEV_REQUIRED_TERMS)
    has_ai = any(term in text for term in AI_TERMS)
    if not has_dev and not has_ai:
        return -999

    score = 0
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in CORE_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in PRIORITY_TERMS if t in text)
    if is_trusted(url):
        score += 5
    return score


def score_regular_dev_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if '정규직' not in text and '정규' not in text:
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999
    if not any(term in text for term in DEV_REQUIRED_TERMS):
        return -999

    # 신입 공고라도 경력 지원 가능 문구가 함께 있으면 허용하고,
    # 명백한 신입 전용 공고는 위 EXCLUDE_TERMS에서 걸러낸다.
    score = 12
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in REGULAR_DEV_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in ('경력', '시니어', '고급', '중급', '유지보수', '운영') if t in text)
    if is_trusted(url):
        score += 5
    return score


def salary_is_plausible(title, body, salary):
    if salary is None:
        return False
    text = f'{title} {body}'.lower()
    annual = salary.get('annual', 0)

    # 일반 채용공고에서 연 1.5억원을 넘는 '만원' 표기는 자릿수/구분자 파싱 오류인 경우가 많다.
    if annual > 15000:
        return False

    # 시급/일급 숫자를 월급으로 오인한 경우를 막는다.
    if salary.get('monthly', 0) > 3000:
        return False

    return True


def score_salary_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999

    salary = salary_info(title, body)
    if not salary_is_plausible(title, body, salary) or salary['monthly'] < 450:
        return -999

    if not is_trusted(url) and not any(term in text for term in JOB_TERMS):
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 5 if is_trusted(url) else 0
    score += min(15, int((salary['monthly'] - 450) / 10))
    score += 2 * sum(1 for t in JOB_TERMS if t in text)
    return score


def score_short_term_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if any(term in text for term in SHORT_TERM_EXCLUDE_TERMS):
        return -999

    has_short = any(term in text for term in SHORT_TERM_TERMS)
    has_easy_role = any(term in text for term in SHORT_TERM_ROLE_TERMS)
    has_no_exp = any(term in text for term in NO_EXPERIENCE_TERMS)

    if not has_short:
        return -999
    if not has_easy_role and not has_no_exp:
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 4 * sum(1 for t in NO_EXPERIENCE_TERMS if t in text)
    score += 3 * sum(1 for t in SHORT_TERM_ROLE_TERMS if t in text)
    score += 2 * sum(1 for t in ('하루', '당일', '1일', '요일협의', '요일 협의') if t in text)

    pay = short_term_pay_info(title, body)
    if pay:
        score += min(20, int(pay['sort_value'] / 10000))

    if is_trusted(url):
        score += 5
    return score


def tags_for(title, body):
    text = f"{title} {body}".lower()
    tags = []
    if any(t in text for t in ('java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov')):
        tags.append('Java')
    if any(t in text for t in ('sm', '유지보수', '운영')):
        tags.append('SM')
    if any(t in text for t in ('프리랜서', '계약직')):
        tags.append('프리/계약')
    if any(t in text for t in AI_TERMS):
        tags.append('AI')
    return tags or ['IT']


def study_hint(title, body):
    text = f"{title} {body}".lower()
    hints = []
    if any(t in text for t in ('spring boot', 'springboot')):
        hints.append('Spring Boot')
    if any(t in text for t in ('ai', 'llm', 'rag', 'agent', '생성형', '챗봇')):
        hints.append('Spring AI')
    if 'rag' in text or 'vector' in text or 'embedding' in text:
        hints.append('RAG/pgvector')
    if 'agent' in text or 'mcp' in text:
        hints.append('Tool Calling/MCP')
    if '전자정부' in text or 'egov' in text:
        hints.append('전자정부프레임워크')
    if not hints:
        hints = ['Spring Boot', 'REST API']
    return ', '.join(dict.fromkeys(hints[:3]))


def today_kst():
    return datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()


def already_sent_today():
    if not SENT_FILE.exists():
        return False
    try:
        return SENT_FILE.read_text(encoding='utf-8').strip() == today_kst()
    except Exception:
        return False


def mark_sent_today():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SENT_FILE.write_text(today_kst(), encoding='utf-8')


def load_seen():
    if not SEEN_FILE.exists():
        return set()
    try:
        data = json.loads(SEEN_FILE.read_text(encoding='utf-8'))
        return set(data.get('urls', []))
    except Exception:
        return set()


def save_seen(urls):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = sorted(urls)[-12000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_group(queries, scorer, source_name=None):
    merged = {}
    ddgs = DDGS()

    for query in queries:
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='w',
                max_results=15,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url:
                    continue

                score = scorer(title, body, url)
                if score < 0:
                    continue

                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': score,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name or domain_of(url),
                    'sources': [source_name or domain_of(url)],
                }
                current = merged.get(url)
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.35)

    return list(merged.values())


def merge_jobs(*groups):
    merged = {}
    for group in groups:
        for job in group:
            current = merged.get(job['url'])
            if current is None or job.get('score', 0) > current.get('score', 0):
                merged[job['url']] = job
    return list(merged.values())


def classify_jobs(jobs, scorer):
    result = []
    for job in jobs:
        score = scorer(job['title'], job['body'], job['url'])
        if score < 0:
            continue
        item = dict(job)
        item['score'] = score
        item['salary'] = salary_info(item['title'], item['body'])
        item['short_pay'] = short_term_pay_info(item['title'], item['body'])
        result.append(item)
    return result


def jobkorea_card_text(anchor):
    # 한 공고 카드의 경계를 'GI_Read 링크가 1개인 가장 가까운 조상'으로 잡는다.
    # 검색결과 전체 컨테이너를 읽어 옆 공고의 지역/급여가 섞이는 것을 막는다.
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))

    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break

        detail_ids = set()
        for link in node.find_all('a', href=True):
            match = re.search(r'/Recruit/GI_Read/(\d+)', link.get('href') or '', re.I)
            if match:
                detail_ids.add(match.group(1))

        if len(detail_ids) > 1:
            break

        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue

        if len(detail_ids) == 1:
            fallback = text
            has_location = any(loc in text for loc in LOCATION_TERMS)
            has_job_meta = any(
                term in text
                for term in (
                    '정규직', '계약직', '프리랜서', '경력', '학력',
                    '만원', '월급', '연봉', '상시채용', '마감',
                )
            )
            if has_location and has_job_meta:
                return text

    return fallback


def jobkorea_title_quality(title):
    text = normalize_text(title)
    lower = text.lower()
    score = min(len(text), 100)

    reward_terms = (
        '개발', 'java', 'spring', 'jsp', '백엔드', '프론트', '웹',
        '채용', '모집', '운영', '유지보수', '엔지니어', 'si', 'sm',
        'ai', '계약직', '정규직', '프리랜서',
    )
    score += 25 * sum(1 for term in reward_terms if term in lower)

    company_markers = ('㈜', '(주)', '주식회사', '관심기업', '벤처기업')
    if any(marker in text for marker in company_markers):
        score -= 80
    if text in {'벤처기업', '중소기업', '강소기업', '외국계'}:
        score -= 200
    return score


def collect_jobkorea_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    parsed_links = 0
    errors = []

    for query in JOBKOREA_DIRECT_QUERIES:
        for page_no in range(1, JOBKOREA_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{JOBKOREA_BASE}/Search',
                    params={'stext': query, 'Page_No': page_no},
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1

                soup = BeautifulSoup(response.text, 'html.parser')
                page_links = 0
                page_parsed_detail_links = 0
                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    match = re.search(r'/Recruit/GI_Read/(\d+)', href, re.I)
                    if not match:
                        continue

                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if (
                        not title
                        or len(title) < 2
                        or title in {'즉시지원', '홈페이지 지원', '스크랩', '관심기업'}
                    ):
                        continue

                    page_parsed_detail_links += 1
                    body = jobkorea_card_text(anchor)
                    if not has_target_location(body):
                        continue

                    url = f'{JOBKOREA_BASE}/Recruit/GI_Read/{match.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '잡코리아',
                        'sources': ['잡코리아'],
                        '_title_quality': jobkorea_title_quality(title),
                    }
                    current = jobs.get(url)
                    if current is None:
                        jobs[url] = candidate
                    else:
                        if len(candidate['body']) > len(current['body']):
                            current['body'] = candidate['body']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                        if candidate['_title_quality'] > current.get('_title_quality', -9999):
                            current['title'] = candidate['title']
                            current['_title_quality'] = candidate['_title_quality']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                    page_links += 1

                parsed_links += page_links
                # 검색 결과 페이지 구조가 바뀐 경우 조용히 '0건'으로 오인하지 않는다.
                raw_has_job_links = bool(
                    re.search(r'/Recruit/GI_Read/\d+', response.text, re.I)
                )
                if raw_has_job_links and page_parsed_detail_links == 0:
                    failed_pages += 1
                    errors.append(f'{query} p{page_no}: HTML에는 공고가 있으나 링크 파싱 0건')
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')

            time.sleep(0.15)

    status = {
        'ok': ok_pages > 0 and parsed_links > 0,
        'ok_pages': ok_pages,
        'failed_pages': failed_pages,
        'parsed_jobs': len(jobs),
        'parsed_links': parsed_links,
        'errors': errors[:5],
    }
    print(
        f'[INFO] jobkorea_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)} '
        f'parsed_links={parsed_links}'
    )
    for error in errors[:5]:
        print(f'[WARN] jobkorea direct: {error}', file=sys.stderr)

    for job in jobs.values():
        job.pop('_title_quality', None)
    return list(jobs.values()), status


def compact_job_title(title):
    text = normalize_text(title).lower()
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', text)
    text = re.sub(
        r'\b(?:채용|모집|공고|정규직|계약직|프리랜서|경력직|경력|신입|즉시지원)\b',
        ' ',
        text,
    )
    text = re.sub(r'[^0-9a-z가-힣]+', ' ', text)
    return normalize_text(text)


def title_tokens(title):
    return {
        token for token in compact_job_title(title).split()
        if len(token) >= 2 and token not in {'대전', '세종', '개발자', '채용', '모집'}
    }


def company_hint(title, body):
    text = f'{title} {body}'
    patterns = [
        r'(?:㈜|\(주\)|주식회사)\s*([가-힣A-Za-z0-9&._-]{2,30})',
        r'([가-힣A-Za-z0-9&._-]{2,30})\s+(?:대전|세종)(?:광역시|특별자치시)?\b',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(1).lower()
    return ''


def job_fingerprint(job):
    title = compact_job_title(job.get('title', ''))
    company = company_hint(job.get('title', ''), job.get('body', ''))
    return f'{company}|{title}' if company else title


def same_job(a, b):
    if not has_target_location(f"{a.get('title','')} {a.get('body','')}"):
        return False
    if not has_target_location(f"{b.get('title','')} {b.get('body','')}"):
        return False

    ca = company_hint(a.get('title', ''), a.get('body', ''))
    cb = company_hint(b.get('title', ''), b.get('body', ''))
    if ca and cb and ca != cb:
        return False

    ta = compact_job_title(a.get('title', ''))
    tb = compact_job_title(b.get('title', ''))
    if not ta or not tb:
        return False
    if ta == tb:
        return True

    ratio = SequenceMatcher(None, ta, tb).ratio()
    sa, sb = title_tokens(ta), title_tokens(tb)
    union = sa | sb
    jaccard = (len(sa & sb) / len(union)) if union else 0.0
    return ratio >= 0.90 or (len(sa & sb) >= 3 and jaccard >= 0.78)


def merge_duplicate_job(base, incoming):
    sources = list(dict.fromkeys(
        (base.get('sources') or [base.get('source')])
        + (incoming.get('sources') or [incoming.get('source')])
    ))
    sources = [s for s in sources if s]
    base['sources'] = sources

    bp = SOURCE_PRIORITY.get(base.get('source'), 0)
    ip = SOURCE_PRIORITY.get(incoming.get('source'), 0)
    if ip > bp:
        for key in ('title', 'url', 'source'):
            base[key] = incoming.get(key, base.get(key))

    if len(incoming.get('body', '')) > len(base.get('body', '')):
        base['body'] = incoming.get('body', '')

    base['salary'] = salary_info(base.get('title', ''), base.get('body', ''))
    base['short_pay'] = short_term_pay_info(base.get('title', ''), base.get('body', ''))
    base['score'] = max(base.get('score', 0), incoming.get('score', 0))
    return base


def dedupe_jobs_cross_source(jobs):
    unique = []
    by_url = {}
    for raw in jobs:
        job = dict(raw)
        job['url'] = normalize_url(job.get('url', ''))
        if not job['url']:
            continue
        job.setdefault('sources', [job.get('source') or domain_of(job['url'])])

        current = by_url.get(job['url'])
        if current is not None:
            merge_duplicate_job(current, job)
            continue

        duplicate = None
        for existing in unique:
            if same_job(existing, job):
                duplicate = existing
                break
        if duplicate is not None:
            merge_duplicate_job(duplicate, job)
            by_url[job['url']] = duplicate
        else:
            unique.append(job)
            by_url[job['url']] = job
    return unique


def saramin_card_text(anchor):
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))
    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break
        ids = set()
        for link in node.find_all('a', href=True):
            href = link.get('href') or ''
            m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
            if m:
                ids.add(m.group(1))
        if len(ids) > 1:
            break
        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue
        if len(ids) == 1:
            fallback = text
            if has_target_location(text):
                return text
    return fallback


def collect_saramin_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    errors = []

    for query in SARAMIN_DIRECT_QUERIES:
        for page_no in range(1, SARAMIN_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{SARAMIN_BASE}/zf_user/search',
                    params={
                        'searchword': query,
                        'recruitPage': page_no,
                        'recruitPageCount': 40,
                    },
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1
                soup = BeautifulSoup(response.text, 'html.parser')

                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
                    if not m:
                        continue
                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if not title or len(title) < 3:
                        continue
                    body = saramin_card_text(anchor)
                    if not has_target_location(body):
                        continue
                    url = f'{SARAMIN_BASE}/zf_user/jobs/view?rec_idx={m.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '사람인',
                        'sources': ['사람인'],
                    }
                    current = jobs.get(url)
                    if current is None or len(candidate['body']) > len(current['body']):
                        jobs[url] = candidate
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')
            time.sleep(0.12)

    status = {
        'ok': ok_pages > 0,
        'count': len(jobs),
        'failed_pages': failed_pages,
        'errors': errors[:3],
        'mode': '직접',
    }
    print(
        f'[INFO] saramin_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)}'
    )
    return list(jobs.values()), status


def collect_search_source(source_name, domain):
    jobs = {}
    errors = []
    ddgs = DDGS()
    for term in SOURCE_SEARCH_TERMS:
        query = f'site:{domain} {term}'
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='m',
                max_results=10,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url or domain not in domain_of(url):
                    continue
                if not has_target_location(f'{title} {body}'):
                    continue
                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': 0,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name,
                    'sources': [source_name],
                }
                current = jobs.get(url)
                if current is None or len(body) > len(current.get('body', '')):
                    jobs[url] = candidate
        except Exception as exc:
            errors.append(f'{term}: {type(exc).__name__}')
        time.sleep(0.05)

    status = {
        'ok': len(errors) < len(SOURCE_SEARCH_TERMS),
        'count': len(jobs),
        'failed_queries': len(errors),
        'errors': errors[:2],
        'mode': '검색',
    }
    print(
        f'[INFO] source={source_name} ok={status["ok"]} '
        f'jobs={len(jobs)} failed_queries={len(errors)}'
    )
    return list(jobs.values()), status


def collect_all_sources():
    jobkorea_jobs, jobkorea_raw = collect_jobkorea_direct()
    saramin_jobs, saramin_status = collect_saramin_direct()

    statuses = {
        '잡코리아': {
            'ok': jobkorea_raw.get('ok', False),
            'count': jobkorea_raw.get('parsed_jobs', 0),
            'failed_pages': jobkorea_raw.get('failed_pages', 0),
            'mode': '직접',
        },
        '사람인': saramin_status,
    }
    groups = [jobkorea_jobs, saramin_jobs]

    with ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(collect_search_source, name, domain): name
            for name, domain in SEARCH_SOURCES.items()
        }
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                jobs, status = future.result()
            except Exception as exc:
                jobs = []
                status = {
                    'ok': False,
                    'count': 0,
                    'errors': [f'{type(exc).__name__}: {exc}'],
                    'mode': '검색',
                }
            groups.append(jobs)
            statuses[name] = status

    merged = dedupe_jobs_cross_source([job for group in groups for job in group])
    print(
        f'[INFO] all_sources raw={sum(len(g) for g in groups)} '
        f'deduped={len(merged)} sources={len(statuses)}'
    )
    return merged, statuses


def parse_job_posted_date(title, body):
    text = normalize_text(f'{title} {body}')
    patterns = [
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})', 4),
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(\d{2})[./-](\d{1,2})[./-](\d{1,2})', 2),
    ]
    dates = []
    for pattern, year_digits in patterns:
        for m in re.finditer(pattern, text, re.I):
            try:
                year = int(m.group(1))
                if year_digits == 2:
                    year += 2000
                d = date(year, int(m.group(2)), int(m.group(3)))
                if date.today() - timedelta(days=370) <= d <= date.today() + timedelta(days=2):
                    dates.append(d)
            except Exception:
                pass
    if dates:
        return max(dates).isoformat(), '등록/수정일'

    # 검색 스니펫에 'N일 전'만 있는 경우도 가능한 범위에서 환산한다.
    m = re.search(r'(\d{1,2})\s*일\s*전', text)
    if m:
        days = int(m.group(1))
        if 0 <= days <= 30:
            return (date.today() - timedelta(days=days)).isoformat(), '검색표시'
    if '오늘' in text and any(term in text for term in ('등록', '수정', '게시')):
        return date.today().isoformat(), '검색표시'
    return '', ''


def archive_categories(job):
    cats = []
    title, body, url = job.get('title', ''), job.get('body', ''), job.get('url', '')
    if score_java_result(title, body, url) >= 0:
        cats.append('java_ai')
    if score_regular_dev_result(title, body, url) >= 0:
        cats.append('regular_dev')

    sal = salary_info(title, body)
    if score_salary_result(title, body, url) >= 0 and sal:
        if sal['monthly'] >= 500:
            cats.append('salary500')
        elif sal['monthly'] >= 450:
            cats.append('salary450')

    if score_short_term_result(title, body, url) >= 0:
        cats.append('short_term')
    return cats


def archive_locations(job):
    text = normalize_text(f"{job.get('title', '')} {job.get('body', '')}")
    out = []
    if re.search(r'(?<![가-힣A-Za-z0-9])대전(?:광역시)?(?![가-힣A-Za-z0-9])', text):
        out.append('대전')
    if re.search(r'(?<![가-힣A-Za-z0-9])세종(?:특별자치시)?(?![가-힣A-Za-z0-9])', text):
        out.append('세종')
    return out


def archive_entry(job, existing=None):
    today = today_kst()
    posted, posted_source = parse_job_posted_date(job.get('title', ''), job.get('body', ''))
    old = existing or {}

    salary = salary_info(job.get('title', ''), job.get('body', ''))
    short_pay = short_term_pay_info(job.get('title', ''), job.get('body', ''))
    sources = list(dict.fromkeys(
        (old.get('sources') or [])
        + (job.get('sources') or [job.get('source') or domain_of(job.get('url', ''))])
    ))
    sources = [x for x in sources if x]

    first_seen = old.get('firstSeen') or today
    old_posted = old.get('postedDate') or ''
    if old_posted and (not posted or old_posted < posted):
        posted = old_posted
        posted_source = old.get('dateSource') or posted_source

    company = company_hint(job.get('title', ''), job.get('body', '')) or old.get('company', '')
    body = normalize_text(job.get('body', ''))
    if len(body) > 900:
        body = body[:897] + '...'

    entry = {
        'id': old.get('id') or job_fingerprint(job) or normalize_url(job.get('url', '')),
        'title': job.get('title', '') or old.get('title', ''),
        'company': company,
        'body': body or old.get('body', ''),
        'url': normalize_url(job.get('url', '')) or old.get('url', ''),
        'source': job.get('source') or old.get('source', ''),
        'sources': sources,
        'locations': archive_locations(job) or old.get('locations', []),
        'categories': archive_categories(job),
        'salary': salary,
        'shortPay': short_pay,
        'postedDate': posted or old_posted,
        'dateSource': posted_source or old.get('dateSource', '') or '수집일',
        'firstSeen': first_seen,
        'lastSeen': today,
    }
    if not entry['categories'] and old.get('categories'):
        entry['categories'] = old['categories']
    return entry


def load_job_archive():
    if not ARCHIVE_FILE.exists():
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}
    try:
        data = json.loads(ARCHIVE_FILE.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
            raise ValueError('invalid archive')
        return data
    except Exception as exc:
        print(f'[WARN] job archive load failed: {exc}', file=sys.stderr)
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}


def save_job_archive(all_jobs, source_statuses):
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = load_job_archive()
    old_jobs = previous.get('jobs', [])

    # URL과 공고 fingerprint 양쪽으로 기존 항목을 찾는다.
    by_url = {}
    by_fp = {}
    for old in old_jobs:
        if old.get('url'):
            by_url[normalize_url(old['url'])] = old
        if old.get('id'):
            by_fp[old['id']] = old

    merged = []
    used_old_ids = set()
    for job in all_jobs:
        cats = archive_categories(job)
        if not cats:
            continue
        url = normalize_url(job.get('url', ''))
        fp = job_fingerprint(job)
        old = by_url.get(url) or by_fp.get(fp)
        entry = archive_entry(job, old)
        merged.append(entry)
        if old:
            used_old_ids.add(id(old))

    # 오늘 검색에 안 잡힌 공고도 30일 동안은 웹 아카이브에 유지한다.
    for old in old_jobs:
        if id(old) not in used_old_ids:
            merged.append(old)

    # 사이트가 달라도 같은 공고는 하나로 합친다.
    result = []
    for item in merged:
        duplicate = None
        probe = {
            'title': item.get('title', ''),
            'body': item.get('body', ''),
            'url': item.get('url', ''),
        }
        for existing in result:
            ex_probe = {
                'title': existing.get('title', ''),
                'body': existing.get('body', ''),
                'url': existing.get('url', ''),
            }
            if normalize_url(item.get('url', '')) == normalize_url(existing.get('url', '')) or same_job(ex_probe, probe):
                duplicate = existing
                break
        if duplicate is None:
            result.append(item)
        else:
            duplicate['sources'] = list(dict.fromkeys(
                (duplicate.get('sources') or []) + (item.get('sources') or [])
            ))
            if item.get('postedDate', '') > duplicate.get('postedDate', ''):
                duplicate['postedDate'] = item.get('postedDate', '')
                duplicate['dateSource'] = item.get('dateSource', '')
            duplicate['lastSeen'] = max(duplicate.get('lastSeen', ''), item.get('lastSeen', ''))
            duplicate['firstSeen'] = min(
                x for x in [duplicate.get('firstSeen', ''), item.get('firstSeen', '')] if x
            )
            duplicate['categories'] = list(dict.fromkeys(
                (duplicate.get('categories') or []) + (item.get('categories') or [])
            ))

    cutoff = date.today() - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for item in result:
        effective = item.get('postedDate') or item.get('firstSeen') or today_kst()
        try:
            d = date.fromisoformat(effective)
        except Exception:
            d = date.today()
        if d >= cutoff:
            kept.append(item)

    kept.sort(
        key=lambda x: (
            x.get('postedDate') or x.get('firstSeen') or '',
            x.get('lastSeen') or '',
            x.get('title') or '',
        ),
        reverse=True,
    )
    payload = {
        'updatedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds'),
        'rangeDays': ARCHIVE_DAYS,
        'cutoffDate': cutoff.isoformat(),
        'sourceStatuses': source_statuses,
        'count': len(kept),
        'jobs': kept,
    }
    ARCHIVE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'[INFO] job_archive saved={len(kept)} cutoff={cutoff.isoformat()} path={ARCHIVE_FILE}')
    return len(kept)


def search_jobs():
    all_jobs, source_statuses = collect_all_sources()

    java_jobs = classify_jobs(all_jobs, score_java_result)
    regular_dev_jobs = classify_jobs(all_jobs, score_regular_dev_result)
    salary_jobs = classify_jobs(all_jobs, score_salary_result)
    short_term_jobs = classify_jobs(all_jobs, score_short_term_result)

    java_jobs.sort(key=lambda x: (-x['score'], x['title']))
    regular_dev_jobs.sort(key=lambda x: (-x['score'], x['title']))
    salary_jobs.sort(
        key=lambda x: (
            -(x['salary']['monthly'] if x['salary'] else 0),
            -x['score'],
            x['title'],
        )
    )
    short_term_jobs.sort(
        key=lambda x: (
            -(x['short_pay']['sort_value'] if x.get('short_pay') else 0),
            -x['score'],
            x['title'],
        )
    )
    return all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses


def short_body(body, limit=190):
    body = normalize_text(body)
    if len(body) > limit:
        return body[:limit - 3] + '...'
    return body


def append_java_section(lines, jobs):
    lines.extend([
        '① <b>Java/AI 맞춤 공고</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        tags = ' · '.join(tags_for(job['title'], job['body']))
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        lines.append(f'분류: {escape(tags)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_regular_dev_section(lines, jobs):
    lines.extend([
        '④ 💼 <b>개발자 정규직</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append('고용형태: 정규직')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_salary_section(lines, title, jobs):
    lines.extend([
        title,
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        salary = job.get('salary')
        salary_label = salary['label'] if salary else '급여 확인 필요'
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append(f'급여: {escape(salary_label)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_short_term_section(lines, jobs):
    lines.extend([
        '⑤ ⏱ <b>단기알바 · 초보/무경력</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('short_pay'):
            lines.append(f'급여: {escape(job["short_pay"]["label"])}')
        else:
            lines.append('급여: 공고 확인')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('우선 기준: 하루~1개월 · 초보/무경력 · 일정 조정 용이')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 일급/시급 우선 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def build_message(
    java_jobs, salary_500, salary_450, regular_dev_jobs, short_term_jobs,
    source_statuses,
):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    ok_sources = [
        f'{name} {status.get("count", 0)}'
        for name, status in source_statuses.items()
        if status.get('ok')
    ]
    failed_sources = [
        name for name, status in source_statuses.items()
        if not status.get('ok')
    ]
    if ok_sources:
        midpoint = max(1, (len(ok_sources) + 1) // 2)
        lines.append('✅ 수집: ' + ' · '.join(ok_sources[:midpoint]))
        if len(ok_sources) > midpoint:
            lines.append('   ' + ' · '.join(ok_sources[midpoint:]))
    if failed_sources:
        lines.append('⚠️ 수집 실패/제한: ' + ' · '.join(failed_sources))
    lines.append('')

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)
    append_short_term_section(lines, short_term_jobs)

    lines.append('※ 같은 공고는 개발자 정규직 → Java/AI → 급여 → 단기알바 순으로 한 번만 표시합니다.')
    lines.append('')
    lines.append('🔗 <a href="https://jkquant.pages.dev/job">최근 30일 전체 공고 보기</a>')
    return '\n'.join(lines).strip()


def send_via_jkquant(message, count):
    base = os.environ.get('JKQUANT_BASE', 'https://jkquant.pages.dev').rstrip('/')
    key = os.environ.get('AUTOTRADE_KEY', '').strip()
    if not key:
        raise RuntimeError('AUTOTRADE_KEY GitHub Secret이 필요합니다.')

    payload = json.dumps(
        {'text': message, 'count': count},
        ensure_ascii=False,
    ).encode('utf-8')

    proc = subprocess.run(
        [
            'curl',
            '-sS',
            '--max-time', '30',
            '-X', 'POST',
            '-H', f'x-monitor-key: {key}',
            '-H', 'content-type: application/json',
            '--data-binary', '@-',
            '-w', '\n%{http_code}',
            f'{base}/api/job-alert',
        ],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    output = proc.stdout.decode('utf-8', errors='replace')
    stderr = proc.stderr.decode('utf-8', errors='replace')
    if '\n' not in output:
        raise RuntimeError(f'job-alert endpoint invalid response: {output[:500]} {stderr[:300]}')

    body, status = output.rsplit('\n', 1)
    if proc.returncode != 0 or status.strip() != '200':
        raise RuntimeError(
            f'job-alert endpoint failed: curl={proc.returncode} HTTP {status.strip()} '
            f'{body[:500]} {stderr[:300]}'
        )

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'job-alert endpoint invalid JSON: {body[:500]}') from exc

    if not data.get('ok'):
        raise RuntimeError(f'job-alert endpoint error: {data}')


def seen_keys_for_job(job):
    keys = {job.get('url', '')}
    fp = job_fingerprint(job)
    if fp:
        keys.add('fp:' + fp)
    return {k for k in keys if k}


def is_job_seen(job, seen):
    return bool(seen_keys_for_job(job) & seen)


def main():
    force = os.environ.get('FORCE_JOB_ALERT') == '1'
    archive_only = os.environ.get('JOB_ALERT_ARCHIVE_ONLY') == '1'
    if not archive_only and not force and already_sent_today():
        print(f'[INFO] already sent today ({today_kst()} KST); skipping duplicate run.')
        return

    seen = load_seen()
    all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses = search_jobs()
    archive_count = save_job_archive(all_jobs, source_statuses)

    if archive_only:
        print(f'[INFO] ARCHIVE ONLY: {archive_count} jobs stored; Telegram skipped.')
        return

    # 정규직 개발자는 별도 ④ 구역에 우선 표시한다.
    new_regular_dev = [
        job for job in regular_dev_jobs
        if not is_job_seen(job, seen)
    ]
    regular_urls = {job['url'] for job in regular_dev_jobs}

    # Java/AI 구역은 정규직 개발자와 중복되지 않게 프로젝트/계약/AI 중심으로 표시한다.
    new_java = [
        job for job in java_jobs
        if not is_job_seen(job, seen) and job['url'] not in regular_urls
    ]
    java_urls = {job['url'] for job in java_jobs}

    # 급여 공고는 Java/AI 및 개발자 정규직에 나온 공고를 제외한다.
    new_salary = [
        job for job in salary_jobs
        if not is_job_seen(job, seen)
        and job['url'] not in java_urls
        and job['url'] not in regular_urls
    ]

    salary_500 = [
        job for job in new_salary
        if job.get('salary') and job['salary']['monthly'] >= 500
    ]
    salary_450 = [
        job for job in new_salary
        if job.get('salary') and 450 <= job['salary']['monthly'] < 500
    ]

    occupied_urls = (
        java_urls
        | regular_urls
        | {job['url'] for job in salary_jobs}
    )
    new_short_term = [
        job for job in short_term_jobs
        if not is_job_seen(job, seen) and job['url'] not in occupied_urls
    ]

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, short_term_matched={len(short_term_jobs)}, '
        f'new_java={len(new_java)}, new_regular_dev={len(new_regular_dev)}, '
        f'new_500={len(salary_500)}, new_450={len(salary_450)}, '
        f'new_short_term={len(new_short_term)}'
    )

    all_current_jobs = (
        list(java_jobs) + list(regular_dev_jobs)
        + list(salary_jobs) + list(short_term_jobs)
    )
    all_seen = set(seen)
    for job in all_current_jobs:
        all_seen.update(seen_keys_for_job(job))

    total_new = (
        len(new_java) + len(new_regular_dev)
        + len(salary_500) + len(salary_450)
        + len(new_short_term)
    )
    message = build_message(
        new_java, salary_500, salary_450, new_regular_dev, new_short_term,
        source_statuses,
    )

    if total_new == 0:
        succeeded = sum(1 for status in source_statuses.values() if status.get('ok'))
        if succeeded >= 2:
            message += '\n\n오늘은 수집에 성공한 사이트 기준 신규 공고가 없습니다.'
        else:
            message += '\n\n수집 성공 사이트가 부족해 오늘 결과를 0건으로 확정하지 않았습니다.'

    if os.environ.get('JOB_ALERT_DRY_RUN') == '1':
        print('[INFO] DRY RUN: Telegram send skipped.')
        print(message[:6000])
        return

    send_via_jkquant(message, total_new)
    save_seen(all_seen)
    mark_sent_today()
    print(f'[INFO] Telegram job notification sent via jkquant Pages Function. sent_date={today_kst()}')


if __name__ == '__main__':
    main()
, page_title)
        if m:
            candidate_company = clean_company_name(m.group(1))
            candidate_title = clean_detail_title(m.group(2), candidate_company)
            if candidate_company and not company:
                company = candidate_company
            if candidate_title and not title:
                title = candidate_title
        elif not title:
            candidate_title = clean_detail_title(page_title)
            if candidate_title and len(candidate_title) <= 180:
                title = candidate_title

    selector_sets = {
        '사람인': {
            'title': ('.jv_header .tit_job', '.tit_job', 'h1'),
            'company': ('.jv_header .company a', '.jv_header .company', '.company_name a', '.company_name'),
        },
        '잡코리아': {
            'title': ('h1', '.titReadArea h3', '.recruit-info-title', '.tbRow h3'),
            'company': ('.coName', '.company-name', '.recruit-company-name', '.devTplCoName'),
        },
    }
    selectors = selector_sets.get(source, {})
    if not title:
        for selector in selectors.get('title', ()):
            node = soup.select_one(selector)
            candidate = clean_detail_title(node.get_text(' ', strip=True) if node else '')
            if candidate:
                title = candidate
                break
    if not company:
        for selector in selectors.get('company', ()):
            node = soup.select_one(selector)
            candidate = clean_company_name(node.get_text(' ', strip=True) if node else '', title)
            if candidate:
                company = candidate
                break

    return title, company


def title_from_card_body(body):
    text = normalize_text(body)
    if not text:
        return ''
    if '스크랩' in text:
        before = normalize_text(text.split('스크랩', 1)[0])
        if before and len(before) <= 180 and not is_generic_job_title(before):
            return before
    return ''


def fetch_job_identity(job):
    item = dict(job)
    try:
        response = requests.get(
            item.get('url', ''),
            headers=DETAIL_HEADERS,
            timeout=15,
        )
        if response.ok and response.text:
            detail_title, detail_company = extract_detail_identity(
                response.text,
                item.get('source', ''),
            )
            if detail_title:
                item['title'] = detail_title
            if detail_company:
                item['company'] = detail_company
    except Exception as exc:
        item['_identity_error'] = type(exc).__name__

    if is_generic_job_title(item.get('title', '')):
        fallback_title = title_from_card_body(item.get('body', ''))
        if fallback_title:
            item['title'] = fallback_title

    explicit_company = clean_company_name(
        item.get('company', ''),
        item.get('title', ''),
    )
    if explicit_company:
        item['company'] = explicit_company
    else:
        item.pop('company', None)
    return item


def enrich_jobs_from_details(jobs, workers=8):
    jobs = list(jobs or [])
    if not jobs:
        return jobs
    enriched = []
    failures = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for item in pool.map(fetch_job_identity, jobs):
            if item.pop('_identity_error', None):
                failures += 1
            enriched.append(item)
    print(
        f'[INFO] detail_identity enriched={len(enriched)} '
        f'failures={failures}'
    )
    return enriched


def normalize_url(url):
    try:
        parts = urlsplit(url)
        kept = []
        for k, v in parse_qsl(parts.query, keep_blank_values=True):
            lk = k.lower()
            if lk.startswith('utm_') or lk in {'sc', 'track', 'tracking', 'ref', 'referer'}:
                continue
            kept.append((k, v))
        return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(kept), ''))
    except Exception:
        return url


def domain_of(url):
    try:
        return urlsplit(url).netloc.lower().replace('www.', '')
    except Exception:
        return ''


def is_trusted(url):
    domain = domain_of(url)
    return any(domain.endswith(d) for d in TRUSTED_DOMAINS)


def has_target_location(text):
    text = normalize_text(text or '')
    return bool(re.search(
        r'(?<![가-힣A-Za-z0-9])(?:대전(?:광역시)?|세종(?:특별자치시)?)(?![가-힣A-Za-z0-9])',
        text,
        re.I,
    ))


def salary_info(title, body):
    raw_text = f"{title} {body}"
    text = raw_text.lower().replace(',', '')
    candidates = []

    monthly_patterns = [
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})(?:\s*(?:~|-|–|〜)\s*(\d{3,4}))?\s*만원',
        r'(?:월급|월\s*급여|월\s*수입|월\s*소득|월)\s*[:：]?\s*(\d{3,4})\s*만\s*원?',
    ]
    for pattern in monthly_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 200 <= low <= 3000:
                candidates.append({
                    'monthly': low,
                    'annual': low * 12,
                    'label': f'월 {low:,.0f}만원 이상 기준',
                })

    annual_patterns = [
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d{4,5})(?:\s*(?:~|-|–|〜)\s*(\d{4,5}))?\s*만원',
        r'(?:연봉|연\s*급여)\s*[:：]?\s*(\d{4,5})\s*(?:이상|부터)',
    ]
    for pattern in annual_patterns:
        for m in re.finditer(pattern, text):
            low = float(m.group(1))
            if 2400 <= low <= 15000:
                candidates.append({
                    'monthly': low / 12.0,
                    'annual': low,
                    'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
                })

    korean_thousand = re.finditer(
        r'(?:연봉|연\s*급여|연)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*천\s*만원',
        text,
    )
    for m in korean_thousand:
        low = float(m.group(1)) * 1000
        if 2400 <= low <= 15000:
            candidates.append({
                'monthly': low / 12.0,
                'annual': low,
                'label': f'연 {low:,.0f}만원 (월 환산 {low / 12.0:,.0f}만원)',
            })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['monthly'])


def short_term_pay_info(title, body):
    text = f"{title} {body}".lower().replace(',', '')
    candidates = []

    daily_patterns = [
        r'(?:일급|일당)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
        r'(?:일급|일당)\s*[:：]?\s*(\d{4,7})\s*원',
        r'(?:하루|1일)\s*(?:급여|수입|일당)?\s*[:：]?\s*(\d+(?:\.\d+)?)\s*만원',
    ]
    for pattern in daily_patterns:
        for m in re.finditer(pattern, text):
            raw = float(m.group(1))
            won = raw * 10000 if raw < 1000 else raw
            if 30000 <= won <= 1000000:
                candidates.append({
                    'kind': 'daily',
                    'won': won,
                    'sort_value': won,
                    'label': f'일급 {won:,.0f}원',
                })

    hourly_patterns = [
        r'(?:시급)\s*[:：]?\s*(\d{4,6})\s*원',
    ]
    for pattern in hourly_patterns:
        for m in re.finditer(pattern, text):
            won = float(m.group(1))
            if 9000 <= won <= 100000:
                candidates.append({
                    'kind': 'hourly',
                    'won': won,
                    'sort_value': won * 8,
                    'label': f'시급 {won:,.0f}원',
                })

    if not candidates:
        return None
    return max(candidates, key=lambda x: x['sort_value'])


def is_entry_only(title, body):
    title_text = normalize_text(title).lower()
    body_text = normalize_text(body).lower()
    text = f'{title_text} {body_text}'

    # '신입·경력', '경력무관', '경력직' 등 경력자 지원 가능 신호가 있으면 허용한다.
    career_allowed = any(
        re.search(pattern, text, re.I)
        for pattern in CAREER_ALLOWED_PATTERNS
    )
    if career_allowed:
        return False

    # 명시적인 신입 전용 문구는 제외한다.
    if any(term in text for term in ENTRY_ONLY_EXPLICIT_TERMS):
        return True

    # 제목 자체가 '[신입]', '(신입)', '신입 개발자/엔지니어/사원 채용' 형태이고
    # 본문에도 경력자 지원 가능 신호가 없으면 신입 전용으로 본다.
    if re.search(r'(?:^|[\[\(\s])신입(?:[\]\)\s]|$)', title_text):
        if re.search(
            r'신입\s*(?:사원|개발자|엔지니어|직원|채용|모집|공채)',
            title_text,
            re.I,
        ) or re.search(r'^\s*[\[\(]?신입[\]\)]?', title_text, re.I):
            return True

    return False


def score_java_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999

    has_dev = any(term in text for term in DEV_REQUIRED_TERMS)
    has_ai = any(term in text for term in AI_TERMS)
    if not has_dev and not has_ai:
        return -999

    score = 0
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in CORE_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in PRIORITY_TERMS if t in text)
    if is_trusted(url):
        score += 5
    return score


def score_regular_dev_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999
    if '정규직' not in text and '정규' not in text:
        return -999
    if any(term in text for term in JUNIOR_ONLY_TERMS):
        return -999
    if not any(term in text for term in DEV_REQUIRED_TERMS):
        return -999

    # 신입 공고라도 경력 지원 가능 문구가 함께 있으면 허용하고,
    # 명백한 신입 전용 공고는 위 EXCLUDE_TERMS에서 걸러낸다.
    score = 12
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 3 * sum(1 for t in REGULAR_DEV_TERMS if t in text)
    score += 3 * sum(1 for t in AI_TERMS if t in text)
    score += 2 * sum(1 for t in ('경력', '시니어', '고급', '중급', '유지보수', '운영') if t in text)
    if is_trusted(url):
        score += 5
    return score


def salary_is_plausible(title, body, salary):
    if salary is None:
        return False
    text = f'{title} {body}'.lower()
    annual = salary.get('annual', 0)

    # 일반 채용공고에서 연 1.5억원을 넘는 '만원' 표기는 자릿수/구분자 파싱 오류인 경우가 많다.
    if annual > 15000:
        return False

    # 시급/일급 숫자를 월급으로 오인한 경우를 막는다.
    if salary.get('monthly', 0) > 3000:
        return False

    return True


def score_salary_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if is_entry_only(title, body):
        return -999

    salary = salary_info(title, body)
    if not salary_is_plausible(title, body, salary) or salary['monthly'] < 450:
        return -999

    if not is_trusted(url) and not any(term in text for term in JOB_TERMS):
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 5 if is_trusted(url) else 0
    score += min(15, int((salary['monthly'] - 450) / 10))
    score += 2 * sum(1 for t in JOB_TERMS if t in text)
    return score


def score_short_term_result(title, body, url):
    text = f"{title} {body}".lower()

    if not has_target_location(text):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if any(term in text for term in SHORT_TERM_EXCLUDE_TERMS):
        return -999

    has_short = any(term in text for term in SHORT_TERM_TERMS)
    has_easy_role = any(term in text for term in SHORT_TERM_ROLE_TERMS)
    has_no_exp = any(term in text for term in NO_EXPERIENCE_TERMS)

    if not has_short:
        return -999
    if not has_easy_role and not has_no_exp:
        return -999

    score = 10
    score += 8 * sum(1 for t in LOCATION_TERMS if t in text)
    score += 4 * sum(1 for t in NO_EXPERIENCE_TERMS if t in text)
    score += 3 * sum(1 for t in SHORT_TERM_ROLE_TERMS if t in text)
    score += 2 * sum(1 for t in ('하루', '당일', '1일', '요일협의', '요일 협의') if t in text)

    pay = short_term_pay_info(title, body)
    if pay:
        score += min(20, int(pay['sort_value'] / 10000))

    if is_trusted(url):
        score += 5
    return score


def tags_for(title, body):
    text = f"{title} {body}".lower()
    tags = []
    if any(t in text for t in ('java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov')):
        tags.append('Java')
    if any(t in text for t in ('sm', '유지보수', '운영')):
        tags.append('SM')
    if any(t in text for t in ('프리랜서', '계약직')):
        tags.append('프리/계약')
    if any(t in text for t in AI_TERMS):
        tags.append('AI')
    return tags or ['IT']


def study_hint(title, body):
    text = f"{title} {body}".lower()
    hints = []
    if any(t in text for t in ('spring boot', 'springboot')):
        hints.append('Spring Boot')
    if any(t in text for t in ('ai', 'llm', 'rag', 'agent', '생성형', '챗봇')):
        hints.append('Spring AI')
    if 'rag' in text or 'vector' in text or 'embedding' in text:
        hints.append('RAG/pgvector')
    if 'agent' in text or 'mcp' in text:
        hints.append('Tool Calling/MCP')
    if '전자정부' in text or 'egov' in text:
        hints.append('전자정부프레임워크')
    if not hints:
        hints = ['Spring Boot', 'REST API']
    return ', '.join(dict.fromkeys(hints[:3]))


def today_kst():
    return datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()


def already_sent_today():
    if not SENT_FILE.exists():
        return False
    try:
        return SENT_FILE.read_text(encoding='utf-8').strip() == today_kst()
    except Exception:
        return False


def mark_sent_today():
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    SENT_FILE.write_text(today_kst(), encoding='utf-8')


def load_seen():
    if not SEEN_FILE.exists():
        return set()
    try:
        data = json.loads(SEEN_FILE.read_text(encoding='utf-8'))
        return set(data.get('urls', []))
    except Exception:
        return set()


def save_seen(urls):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    trimmed = sorted(urls)[-12000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_group(queries, scorer, source_name=None):
    merged = {}
    ddgs = DDGS()

    for query in queries:
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='w',
                max_results=15,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url:
                    continue

                score = scorer(title, body, url)
                if score < 0:
                    continue

                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': score,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name or domain_of(url),
                    'sources': [source_name or domain_of(url)],
                }
                current = merged.get(url)
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.35)

    return list(merged.values())


def merge_jobs(*groups):
    merged = {}
    for group in groups:
        for job in group:
            current = merged.get(job['url'])
            if current is None or job.get('score', 0) > current.get('score', 0):
                merged[job['url']] = job
    return list(merged.values())


def classify_jobs(jobs, scorer):
    result = []
    for job in jobs:
        score = scorer(job['title'], job['body'], job['url'])
        if score < 0:
            continue
        item = dict(job)
        item['score'] = score
        item['salary'] = salary_info(item['title'], item['body'])
        item['short_pay'] = short_term_pay_info(item['title'], item['body'])
        result.append(item)
    return result


def jobkorea_card_text(anchor):
    # 한 공고 카드의 경계를 'GI_Read 링크가 1개인 가장 가까운 조상'으로 잡는다.
    # 검색결과 전체 컨테이너를 읽어 옆 공고의 지역/급여가 섞이는 것을 막는다.
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))

    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break

        detail_ids = set()
        for link in node.find_all('a', href=True):
            match = re.search(r'/Recruit/GI_Read/(\d+)', link.get('href') or '', re.I)
            if match:
                detail_ids.add(match.group(1))

        if len(detail_ids) > 1:
            break

        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue

        if len(detail_ids) == 1:
            fallback = text
            has_location = any(loc in text for loc in LOCATION_TERMS)
            has_job_meta = any(
                term in text
                for term in (
                    '정규직', '계약직', '프리랜서', '경력', '학력',
                    '만원', '월급', '연봉', '상시채용', '마감',
                )
            )
            if has_location and has_job_meta:
                return text

    return fallback


def jobkorea_title_quality(title):
    text = normalize_text(title)
    lower = text.lower()
    score = min(len(text), 100)

    reward_terms = (
        '개발', 'java', 'spring', 'jsp', '백엔드', '프론트', '웹',
        '채용', '모집', '운영', '유지보수', '엔지니어', 'si', 'sm',
        'ai', '계약직', '정규직', '프리랜서',
    )
    score += 25 * sum(1 for term in reward_terms if term in lower)

    company_markers = ('㈜', '(주)', '주식회사', '관심기업', '벤처기업')
    if any(marker in text for marker in company_markers):
        score -= 80
    if text in {'벤처기업', '중소기업', '강소기업', '외국계'}:
        score -= 200
    return score


def collect_jobkorea_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    parsed_links = 0
    errors = []

    for query in JOBKOREA_DIRECT_QUERIES:
        for page_no in range(1, JOBKOREA_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{JOBKOREA_BASE}/Search',
                    params={'stext': query, 'Page_No': page_no},
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1

                soup = BeautifulSoup(response.text, 'html.parser')
                page_links = 0
                page_parsed_detail_links = 0
                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    match = re.search(r'/Recruit/GI_Read/(\d+)', href, re.I)
                    if not match:
                        continue

                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if (
                        not title
                        or len(title) < 2
                        or title in {'즉시지원', '홈페이지 지원', '스크랩', '관심기업'}
                    ):
                        continue

                    page_parsed_detail_links += 1
                    body = jobkorea_card_text(anchor)
                    if not has_target_location(body):
                        continue

                    url = f'{JOBKOREA_BASE}/Recruit/GI_Read/{match.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '잡코리아',
                        'sources': ['잡코리아'],
                        '_title_quality': jobkorea_title_quality(title),
                    }
                    current = jobs.get(url)
                    if current is None:
                        jobs[url] = candidate
                    else:
                        if len(candidate['body']) > len(current['body']):
                            current['body'] = candidate['body']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                        if candidate['_title_quality'] > current.get('_title_quality', -9999):
                            current['title'] = candidate['title']
                            current['_title_quality'] = candidate['_title_quality']
                            current['salary'] = salary_info(current['title'], current['body'])
                            current['short_pay'] = short_term_pay_info(current['title'], current['body'])
                    page_links += 1

                parsed_links += page_links
                # 검색 결과 페이지 구조가 바뀐 경우 조용히 '0건'으로 오인하지 않는다.
                raw_has_job_links = bool(
                    re.search(r'/Recruit/GI_Read/\d+', response.text, re.I)
                )
                if raw_has_job_links and page_parsed_detail_links == 0:
                    failed_pages += 1
                    errors.append(f'{query} p{page_no}: HTML에는 공고가 있으나 링크 파싱 0건')
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')

            time.sleep(0.15)

    status = {
        'ok': ok_pages > 0 and parsed_links > 0,
        'ok_pages': ok_pages,
        'failed_pages': failed_pages,
        'parsed_jobs': len(jobs),
        'parsed_links': parsed_links,
        'errors': errors[:5],
    }
    print(
        f'[INFO] jobkorea_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)} '
        f'parsed_links={parsed_links}'
    )
    for error in errors[:5]:
        print(f'[WARN] jobkorea direct: {error}', file=sys.stderr)

    for job in jobs.values():
        job.pop('_title_quality', None)
    return list(jobs.values()), status


def compact_job_title(title):
    text = normalize_text(title).lower()
    text = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', text)
    text = re.sub(
        r'\b(?:채용|모집|공고|정규직|계약직|프리랜서|경력직|경력|신입|즉시지원)\b',
        ' ',
        text,
    )
    text = re.sub(r'[^0-9a-z가-힣]+', ' ', text)
    return normalize_text(text)


def title_tokens(title):
    return {
        token for token in compact_job_title(title).split()
        if len(token) >= 2 and token not in {'대전', '세종', '개발자', '채용', '모집'}
    }


def company_hint(title, body):
    text = f'{title} {body}'
    patterns = [
        r'(?:㈜|\(주\)|주식회사)\s*([가-힣A-Za-z0-9&._-]{2,30})',
        r'([가-힣A-Za-z0-9&._-]{2,30})\s+(?:대전|세종)(?:광역시|특별자치시)?\b',
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return m.group(1).lower()
    return ''


def job_fingerprint(job):
    title = compact_job_title(job.get('title', ''))
    company = company_hint(job.get('title', ''), job.get('body', ''))
    return f'{company}|{title}' if company else title


def same_job(a, b):
    if not has_target_location(f"{a.get('title','')} {a.get('body','')}"):
        return False
    if not has_target_location(f"{b.get('title','')} {b.get('body','')}"):
        return False

    ca = company_hint(a.get('title', ''), a.get('body', ''))
    cb = company_hint(b.get('title', ''), b.get('body', ''))
    if ca and cb and ca != cb:
        return False

    ta = compact_job_title(a.get('title', ''))
    tb = compact_job_title(b.get('title', ''))
    if not ta or not tb:
        return False
    if ta == tb:
        return True

    ratio = SequenceMatcher(None, ta, tb).ratio()
    sa, sb = title_tokens(ta), title_tokens(tb)
    union = sa | sb
    jaccard = (len(sa & sb) / len(union)) if union else 0.0
    return ratio >= 0.90 or (len(sa & sb) >= 3 and jaccard >= 0.78)


def merge_duplicate_job(base, incoming):
    sources = list(dict.fromkeys(
        (base.get('sources') or [base.get('source')])
        + (incoming.get('sources') or [incoming.get('source')])
    ))
    sources = [s for s in sources if s]
    base['sources'] = sources

    bp = SOURCE_PRIORITY.get(base.get('source'), 0)
    ip = SOURCE_PRIORITY.get(incoming.get('source'), 0)
    if ip > bp:
        for key in ('title', 'url', 'source'):
            base[key] = incoming.get(key, base.get(key))

    if len(incoming.get('body', '')) > len(base.get('body', '')):
        base['body'] = incoming.get('body', '')

    base['salary'] = salary_info(base.get('title', ''), base.get('body', ''))
    base['short_pay'] = short_term_pay_info(base.get('title', ''), base.get('body', ''))
    base['score'] = max(base.get('score', 0), incoming.get('score', 0))
    return base


def dedupe_jobs_cross_source(jobs):
    unique = []
    by_url = {}
    for raw in jobs:
        job = dict(raw)
        job['url'] = normalize_url(job.get('url', ''))
        if not job['url']:
            continue
        job.setdefault('sources', [job.get('source') or domain_of(job['url'])])

        current = by_url.get(job['url'])
        if current is not None:
            merge_duplicate_job(current, job)
            continue

        duplicate = None
        for existing in unique:
            if same_job(existing, job):
                duplicate = existing
                break
        if duplicate is not None:
            merge_duplicate_job(duplicate, job)
            by_url[job['url']] = duplicate
        else:
            unique.append(job)
            by_url[job['url']] = job
    return unique


def saramin_card_text(anchor):
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))
    for _ in range(10):
        node = getattr(node, 'parent', None)
        if node is None:
            break
        ids = set()
        for link in node.find_all('a', href=True):
            href = link.get('href') or ''
            m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
            if m:
                ids.add(m.group(1))
        if len(ids) > 1:
            break
        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 1800:
            continue
        if len(ids) == 1:
            fallback = text
            if has_target_location(text):
                return text
    return fallback


def collect_saramin_direct():
    session = requests.Session()
    session.headers.update({
        'User-Agent': (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/154.0.0.0 Safari/537.36'
        ),
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
    })

    jobs = {}
    ok_pages = 0
    failed_pages = 0
    errors = []

    for query in SARAMIN_DIRECT_QUERIES:
        for page_no in range(1, SARAMIN_PAGES_PER_QUERY + 1):
            try:
                response = session.get(
                    f'{SARAMIN_BASE}/zf_user/search',
                    params={
                        'searchword': query,
                        'recruitPage': page_no,
                        'recruitPageCount': 40,
                    },
                    timeout=20,
                )
                response.raise_for_status()
                ok_pages += 1
                soup = BeautifulSoup(response.text, 'html.parser')

                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    m = re.search(r'(?:rec_idx=|/jobs/view\?rec_idx=)(\d+)', href, re.I)
                    if not m:
                        continue
                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if not title or len(title) < 3:
                        continue
                    body = saramin_card_text(anchor)
                    if not has_target_location(body):
                        continue
                    url = f'{SARAMIN_BASE}/zf_user/jobs/view?rec_idx={m.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '사람인',
                        'sources': ['사람인'],
                    }
                    current = jobs.get(url)
                    if current is None or len(candidate['body']) > len(current['body']):
                        jobs[url] = candidate
            except Exception as exc:
                failed_pages += 1
                errors.append(f'{query} p{page_no}: {type(exc).__name__} {exc}')
            time.sleep(0.12)

    status = {
        'ok': ok_pages > 0,
        'count': len(jobs),
        'failed_pages': failed_pages,
        'errors': errors[:3],
        'mode': '직접',
    }
    print(
        f'[INFO] saramin_direct ok={status["ok"]} ok_pages={ok_pages} '
        f'failed_pages={failed_pages} parsed_jobs={len(jobs)}'
    )
    return list(jobs.values()), status


def collect_search_source(source_name, domain):
    jobs = {}
    errors = []
    ddgs = DDGS()
    for term in SOURCE_SEARCH_TERMS:
        query = f'site:{domain} {term}'
        try:
            results = ddgs.text(
                query,
                region='kr-kr',
                safesearch='moderate',
                timelimit='m',
                max_results=10,
            )
            for item in results or []:
                title = normalize_text(item.get('title'))
                body = normalize_text(item.get('body'))
                url = normalize_url(item.get('href') or item.get('url') or '')
                if not url or domain not in domain_of(url):
                    continue
                if not has_target_location(f'{title} {body}'):
                    continue
                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': 0,
                    'salary': salary_info(title, body),
                    'short_pay': short_term_pay_info(title, body),
                    'source': source_name,
                    'sources': [source_name],
                }
                current = jobs.get(url)
                if current is None or len(body) > len(current.get('body', '')):
                    jobs[url] = candidate
        except Exception as exc:
            errors.append(f'{term}: {type(exc).__name__}')
        time.sleep(0.05)

    status = {
        'ok': len(errors) < len(SOURCE_SEARCH_TERMS),
        'count': len(jobs),
        'failed_queries': len(errors),
        'errors': errors[:2],
        'mode': '검색',
    }
    print(
        f'[INFO] source={source_name} ok={status["ok"]} '
        f'jobs={len(jobs)} failed_queries={len(errors)}'
    )
    return list(jobs.values()), status


def collect_all_sources():
    jobkorea_jobs, jobkorea_raw = collect_jobkorea_direct()
    saramin_jobs, saramin_status = collect_saramin_direct()

    statuses = {
        '잡코리아': {
            'ok': jobkorea_raw.get('ok', False),
            'count': jobkorea_raw.get('parsed_jobs', 0),
            'failed_pages': jobkorea_raw.get('failed_pages', 0),
            'mode': '직접',
        },
        '사람인': saramin_status,
    }
    groups = [jobkorea_jobs, saramin_jobs]

    with ThreadPoolExecutor(max_workers=5) as pool:
        future_map = {
            pool.submit(collect_search_source, name, domain): name
            for name, domain in SEARCH_SOURCES.items()
        }
        for future in as_completed(future_map):
            name = future_map[future]
            try:
                jobs, status = future.result()
            except Exception as exc:
                jobs = []
                status = {
                    'ok': False,
                    'count': 0,
                    'errors': [f'{type(exc).__name__}: {exc}'],
                    'mode': '검색',
                }
            groups.append(jobs)
            statuses[name] = status

    merged = dedupe_jobs_cross_source([job for group in groups for job in group])
    print(
        f'[INFO] all_sources raw={sum(len(g) for g in groups)} '
        f'deduped={len(merged)} sources={len(statuses)}'
    )
    return merged, statuses


def parse_job_posted_date(title, body):
    text = normalize_text(f'{title} {body}')
    patterns = [
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(20\d{2})[./-](\d{1,2})[./-](\d{1,2})', 4),
        (r'(?:등록일|수정일|게시일|공고일|시작일)\s*[:：]?\s*(\d{2})[./-](\d{1,2})[./-](\d{1,2})', 2),
    ]
    dates = []
    for pattern, year_digits in patterns:
        for m in re.finditer(pattern, text, re.I):
            try:
                year = int(m.group(1))
                if year_digits == 2:
                    year += 2000
                d = date(year, int(m.group(2)), int(m.group(3)))
                if date.today() - timedelta(days=370) <= d <= date.today() + timedelta(days=2):
                    dates.append(d)
            except Exception:
                pass
    if dates:
        return max(dates).isoformat(), '등록/수정일'

    # 검색 스니펫에 'N일 전'만 있는 경우도 가능한 범위에서 환산한다.
    m = re.search(r'(\d{1,2})\s*일\s*전', text)
    if m:
        days = int(m.group(1))
        if 0 <= days <= 30:
            return (date.today() - timedelta(days=days)).isoformat(), '검색표시'
    if '오늘' in text and any(term in text for term in ('등록', '수정', '게시')):
        return date.today().isoformat(), '검색표시'
    return '', ''


def archive_categories(job):
    cats = []
    title, body, url = job.get('title', ''), job.get('body', ''), job.get('url', '')
    if score_java_result(title, body, url) >= 0:
        cats.append('java_ai')
    if score_regular_dev_result(title, body, url) >= 0:
        cats.append('regular_dev')

    sal = salary_info(title, body)
    if score_salary_result(title, body, url) >= 0 and sal:
        if sal['monthly'] >= 500:
            cats.append('salary500')
        elif sal['monthly'] >= 450:
            cats.append('salary450')

    if score_short_term_result(title, body, url) >= 0:
        cats.append('short_term')
    return cats


def archive_locations(job):
    text = normalize_text(f"{job.get('title', '')} {job.get('body', '')}")
    out = []
    if re.search(r'(?<![가-힣A-Za-z0-9])대전(?:광역시)?(?![가-힣A-Za-z0-9])', text):
        out.append('대전')
    if re.search(r'(?<![가-힣A-Za-z0-9])세종(?:특별자치시)?(?![가-힣A-Za-z0-9])', text):
        out.append('세종')
    return out


def archive_entry(job, existing=None):
    today = today_kst()
    posted, posted_source = parse_job_posted_date(job.get('title', ''), job.get('body', ''))
    old = existing or {}

    salary = salary_info(job.get('title', ''), job.get('body', ''))
    short_pay = short_term_pay_info(job.get('title', ''), job.get('body', ''))
    sources = list(dict.fromkeys(
        (old.get('sources') or [])
        + (job.get('sources') or [job.get('source') or domain_of(job.get('url', ''))])
    ))
    sources = [x for x in sources if x]

    first_seen = old.get('firstSeen') or today
    old_posted = old.get('postedDate') or ''
    if old_posted and (not posted or old_posted < posted):
        posted = old_posted
        posted_source = old.get('dateSource') or posted_source

    company = company_hint(job.get('title', ''), job.get('body', '')) or old.get('company', '')
    body = normalize_text(job.get('body', ''))
    if len(body) > 900:
        body = body[:897] + '...'

    entry = {
        'id': old.get('id') or job_fingerprint(job) or normalize_url(job.get('url', '')),
        'title': job.get('title', '') or old.get('title', ''),
        'company': company,
        'body': body or old.get('body', ''),
        'url': normalize_url(job.get('url', '')) or old.get('url', ''),
        'source': job.get('source') or old.get('source', ''),
        'sources': sources,
        'locations': archive_locations(job) or old.get('locations', []),
        'categories': archive_categories(job),
        'salary': salary,
        'shortPay': short_pay,
        'postedDate': posted or old_posted,
        'dateSource': posted_source or old.get('dateSource', '') or '수집일',
        'firstSeen': first_seen,
        'lastSeen': today,
    }
    if not entry['categories'] and old.get('categories'):
        entry['categories'] = old['categories']
    return entry


def load_job_archive():
    if not ARCHIVE_FILE.exists():
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}
    try:
        data = json.loads(ARCHIVE_FILE.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), list):
            raise ValueError('invalid archive')
        return data
    except Exception as exc:
        print(f'[WARN] job archive load failed: {exc}', file=sys.stderr)
        return {'updatedAt': '', 'rangeDays': ARCHIVE_DAYS, 'jobs': []}


def save_job_archive(all_jobs, source_statuses):
    ARCHIVE_FILE.parent.mkdir(parents=True, exist_ok=True)
    previous = load_job_archive()
    old_jobs = previous.get('jobs', [])

    # URL과 공고 fingerprint 양쪽으로 기존 항목을 찾는다.
    by_url = {}
    by_fp = {}
    for old in old_jobs:
        if old.get('url'):
            by_url[normalize_url(old['url'])] = old
        if old.get('id'):
            by_fp[old['id']] = old

    merged = []
    used_old_ids = set()
    for job in all_jobs:
        cats = archive_categories(job)
        if not cats:
            continue
        url = normalize_url(job.get('url', ''))
        fp = job_fingerprint(job)
        old = by_url.get(url) or by_fp.get(fp)
        entry = archive_entry(job, old)
        merged.append(entry)
        if old:
            used_old_ids.add(id(old))

    # 오늘 검색에 안 잡힌 공고도 30일 동안은 웹 아카이브에 유지한다.
    for old in old_jobs:
        if id(old) not in used_old_ids:
            merged.append(old)

    # 사이트가 달라도 같은 공고는 하나로 합친다.
    result = []
    for item in merged:
        duplicate = None
        probe = {
            'title': item.get('title', ''),
            'body': item.get('body', ''),
            'url': item.get('url', ''),
        }
        for existing in result:
            ex_probe = {
                'title': existing.get('title', ''),
                'body': existing.get('body', ''),
                'url': existing.get('url', ''),
            }
            if normalize_url(item.get('url', '')) == normalize_url(existing.get('url', '')) or same_job(ex_probe, probe):
                duplicate = existing
                break
        if duplicate is None:
            result.append(item)
        else:
            duplicate['sources'] = list(dict.fromkeys(
                (duplicate.get('sources') or []) + (item.get('sources') or [])
            ))
            if item.get('postedDate', '') > duplicate.get('postedDate', ''):
                duplicate['postedDate'] = item.get('postedDate', '')
                duplicate['dateSource'] = item.get('dateSource', '')
            duplicate['lastSeen'] = max(duplicate.get('lastSeen', ''), item.get('lastSeen', ''))
            duplicate['firstSeen'] = min(
                x for x in [duplicate.get('firstSeen', ''), item.get('firstSeen', '')] if x
            )
            duplicate['categories'] = list(dict.fromkeys(
                (duplicate.get('categories') or []) + (item.get('categories') or [])
            ))

    cutoff = date.today() - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for item in result:
        effective = item.get('postedDate') or item.get('firstSeen') or today_kst()
        try:
            d = date.fromisoformat(effective)
        except Exception:
            d = date.today()
        if d >= cutoff:
            kept.append(item)

    kept.sort(
        key=lambda x: (
            x.get('postedDate') or x.get('firstSeen') or '',
            x.get('lastSeen') or '',
            x.get('title') or '',
        ),
        reverse=True,
    )
    payload = {
        'updatedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds'),
        'rangeDays': ARCHIVE_DAYS,
        'cutoffDate': cutoff.isoformat(),
        'sourceStatuses': source_statuses,
        'count': len(kept),
        'jobs': kept,
    }
    ARCHIVE_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    print(f'[INFO] job_archive saved={len(kept)} cutoff={cutoff.isoformat()} path={ARCHIVE_FILE}')
    return len(kept)


def search_jobs():
    all_jobs, source_statuses = collect_all_sources()

    java_jobs = classify_jobs(all_jobs, score_java_result)
    regular_dev_jobs = classify_jobs(all_jobs, score_regular_dev_result)
    salary_jobs = classify_jobs(all_jobs, score_salary_result)
    short_term_jobs = classify_jobs(all_jobs, score_short_term_result)

    java_jobs.sort(key=lambda x: (-x['score'], x['title']))
    regular_dev_jobs.sort(key=lambda x: (-x['score'], x['title']))
    salary_jobs.sort(
        key=lambda x: (
            -(x['salary']['monthly'] if x['salary'] else 0),
            -x['score'],
            x['title'],
        )
    )
    short_term_jobs.sort(
        key=lambda x: (
            -(x['short_pay']['sort_value'] if x.get('short_pay') else 0),
            -x['score'],
            x['title'],
        )
    )
    return all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses


def short_body(body, limit=190):
    body = normalize_text(body)
    if len(body) > limit:
        return body[:limit - 3] + '...'
    return body


def append_java_section(lines, jobs):
    lines.extend([
        '① <b>Java/AI 맞춤 공고</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        tags = ' · '.join(tags_for(job['title'], job['body']))
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        lines.append(f'분류: {escape(tags)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_regular_dev_section(lines, jobs):
    lines.extend([
        '④ 💼 <b>개발자 정규직</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append('고용형태: 정규직')
        if job.get('salary'):
            lines.append(f'급여: {escape(job["salary"]["label"])}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append(f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_salary_section(lines, title, jobs):
    lines.extend([
        title,
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        salary = job.get('salary')
        salary_label = salary['label'] if salary else '급여 확인 필요'
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        lines.append(f'급여: {escape(salary_label)}')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def append_short_term_section(lines, jobs):
    lines.extend([
        '⑤ ⏱ <b>단기알바 · 초보/무경력</b>',
        f'신규 {len(jobs)}건',
    ])
    if not jobs:
        lines.extend(['• 신규 없음', ''])
        return

    for idx, job in enumerate(jobs[:10], 1):
        body = short_body(job['body'])
        job_url = escape(job['url'], quote=True)
        job_title = escape(job['title'] or '제목 없음')
        lines.append(f'<b><a href="{job_url}">{idx}. {job_title}</a></b>')
        if job.get('short_pay'):
            lines.append(f'급여: {escape(job["short_pay"]["label"])}')
        else:
            lines.append('급여: 공고 확인')
        sources = ' / '.join(job.get('sources') or [job.get('source', '')])
        if sources:
            lines.append(f'출처: {escape(sources)}')
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('우선 기준: 하루~1개월 · 초보/무경력 · 일정 조정 용이')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 일급/시급 우선 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def build_message(
    java_jobs, salary_500, salary_450, regular_dev_jobs, short_term_jobs,
    source_statuses,
):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    ok_sources = [
        f'{name} {status.get("count", 0)}'
        for name, status in source_statuses.items()
        if status.get('ok')
    ]
    failed_sources = [
        name for name, status in source_statuses.items()
        if not status.get('ok')
    ]
    if ok_sources:
        midpoint = max(1, (len(ok_sources) + 1) // 2)
        lines.append('✅ 수집: ' + ' · '.join(ok_sources[:midpoint]))
        if len(ok_sources) > midpoint:
            lines.append('   ' + ' · '.join(ok_sources[midpoint:]))
    if failed_sources:
        lines.append('⚠️ 수집 실패/제한: ' + ' · '.join(failed_sources))
    lines.append('')

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)
    append_short_term_section(lines, short_term_jobs)

    lines.append('※ 같은 공고는 개발자 정규직 → Java/AI → 급여 → 단기알바 순으로 한 번만 표시합니다.')
    lines.append('')
    lines.append('🔗 <a href="https://jkquant.pages.dev/job">최근 30일 전체 공고 보기</a>')
    return '\n'.join(lines).strip()


def send_via_jkquant(message, count):
    base = os.environ.get('JKQUANT_BASE', 'https://jkquant.pages.dev').rstrip('/')
    key = os.environ.get('AUTOTRADE_KEY', '').strip()
    if not key:
        raise RuntimeError('AUTOTRADE_KEY GitHub Secret이 필요합니다.')

    payload = json.dumps(
        {'text': message, 'count': count},
        ensure_ascii=False,
    ).encode('utf-8')

    proc = subprocess.run(
        [
            'curl',
            '-sS',
            '--max-time', '30',
            '-X', 'POST',
            '-H', f'x-monitor-key: {key}',
            '-H', 'content-type: application/json',
            '--data-binary', '@-',
            '-w', '\n%{http_code}',
            f'{base}/api/job-alert',
        ],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

    output = proc.stdout.decode('utf-8', errors='replace')
    stderr = proc.stderr.decode('utf-8', errors='replace')
    if '\n' not in output:
        raise RuntimeError(f'job-alert endpoint invalid response: {output[:500]} {stderr[:300]}')

    body, status = output.rsplit('\n', 1)
    if proc.returncode != 0 or status.strip() != '200':
        raise RuntimeError(
            f'job-alert endpoint failed: curl={proc.returncode} HTTP {status.strip()} '
            f'{body[:500]} {stderr[:300]}'
        )

    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f'job-alert endpoint invalid JSON: {body[:500]}') from exc

    if not data.get('ok'):
        raise RuntimeError(f'job-alert endpoint error: {data}')


def seen_keys_for_job(job):
    keys = {job.get('url', '')}
    fp = job_fingerprint(job)
    if fp:
        keys.add('fp:' + fp)
    return {k for k in keys if k}


def is_job_seen(job, seen):
    return bool(seen_keys_for_job(job) & seen)


def main():
    force = os.environ.get('FORCE_JOB_ALERT') == '1'
    archive_only = os.environ.get('JOB_ALERT_ARCHIVE_ONLY') == '1'
    if not archive_only and not force and already_sent_today():
        print(f'[INFO] already sent today ({today_kst()} KST); skipping duplicate run.')
        return

    seen = load_seen()
    all_jobs, java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, source_statuses = search_jobs()
    archive_count = save_job_archive(all_jobs, source_statuses)

    if archive_only:
        print(f'[INFO] ARCHIVE ONLY: {archive_count} jobs stored; Telegram skipped.')
        return

    # 정규직 개발자는 별도 ④ 구역에 우선 표시한다.
    new_regular_dev = [
        job for job in regular_dev_jobs
        if not is_job_seen(job, seen)
    ]
    regular_urls = {job['url'] for job in regular_dev_jobs}

    # Java/AI 구역은 정규직 개발자와 중복되지 않게 프로젝트/계약/AI 중심으로 표시한다.
    new_java = [
        job for job in java_jobs
        if not is_job_seen(job, seen) and job['url'] not in regular_urls
    ]
    java_urls = {job['url'] for job in java_jobs}

    # 급여 공고는 Java/AI 및 개발자 정규직에 나온 공고를 제외한다.
    new_salary = [
        job for job in salary_jobs
        if not is_job_seen(job, seen)
        and job['url'] not in java_urls
        and job['url'] not in regular_urls
    ]

    salary_500 = [
        job for job in new_salary
        if job.get('salary') and job['salary']['monthly'] >= 500
    ]
    salary_450 = [
        job for job in new_salary
        if job.get('salary') and 450 <= job['salary']['monthly'] < 500
    ]

    occupied_urls = (
        java_urls
        | regular_urls
        | {job['url'] for job in salary_jobs}
    )
    new_short_term = [
        job for job in short_term_jobs
        if not is_job_seen(job, seen) and job['url'] not in occupied_urls
    ]

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, short_term_matched={len(short_term_jobs)}, '
        f'new_java={len(new_java)}, new_regular_dev={len(new_regular_dev)}, '
        f'new_500={len(salary_500)}, new_450={len(salary_450)}, '
        f'new_short_term={len(new_short_term)}'
    )

    all_current_jobs = (
        list(java_jobs) + list(regular_dev_jobs)
        + list(salary_jobs) + list(short_term_jobs)
    )
    all_seen = set(seen)
    for job in all_current_jobs:
        all_seen.update(seen_keys_for_job(job))

    total_new = (
        len(new_java) + len(new_regular_dev)
        + len(salary_500) + len(salary_450)
        + len(new_short_term)
    )
    message = build_message(
        new_java, salary_500, salary_450, new_regular_dev, new_short_term,
        source_statuses,
    )

    if total_new == 0:
        succeeded = sum(1 for status in source_statuses.values() if status.get('ok'))
        if succeeded >= 2:
            message += '\n\n오늘은 수집에 성공한 사이트 기준 신규 공고가 없습니다.'
        else:
            message += '\n\n수집 성공 사이트가 부족해 오늘 결과를 0건으로 확정하지 않았습니다.'

    if os.environ.get('JOB_ALERT_DRY_RUN') == '1':
        print('[INFO] DRY RUN: Telegram send skipped.')
        print(message[:6000])
        return

    send_via_jkquant(message, total_new)
    save_seen(all_seen)
    mark_sent_today()
    print(f'[INFO] Telegram job notification sent via jkquant Pages Function. sent_date={today_kst()}')


if __name__ == '__main__':
    main()
