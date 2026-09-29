#!/usr/bin/env python3
import json
import os
import re
import sys
import time
import subprocess
from html import escape
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup
from ddgs import DDGS

CACHE_DIR = Path(".job-alert-cache")
SEEN_FILE = CACHE_DIR / "seen.json"

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
    'site:jobkorea.co.kr 대전 Java JSP Spring',
    'site:jobkorea.co.kr 세종 Java JSP Spring',
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
    'site:jobkorea.co.kr 대전 개발자 정규직 Java Spring',
    'site:jobkorea.co.kr 세종 개발자 정규직 Java Spring',
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
    'site:jobkorea.co.kr 대전 연봉 6000',
    'site:jobkorea.co.kr 세종 연봉 6000',
    'site:jobkorea.co.kr 대전 연봉 5400',
    'site:jobkorea.co.kr 세종 연봉 5400',
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
]
JOBKOREA_PAGES_PER_QUERY = 2

LOCATION_TERMS = ('대전', '세종')
CORE_TERMS = (
    'java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov',
    '백엔드', 'sm', '유지보수', 'si', '프리랜서', '계약직',
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
    '신입만', '신입 전용', '인턴만', '마감되었습니다', '채용마감',
)
TRUSTED_DOMAINS = (
    'jobkorea.co.kr', 'saramin.co.kr', 'imjob.co.kr', 'work24.go.kr',
    'wanted.co.kr', 'jumpit.saramin.co.kr', 'career.co.kr',
    'alba.co.kr', 'albamon.com',
)


def normalize_text(value):
    return re.sub(r'\s+', ' ', (value or '')).strip()


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
            if 2400 <= low <= 50000:
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
        if 2400 <= low <= 50000:
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


def score_java_result(title, body, url):
    text = f"{title} {body}".lower()

    if not any(term in text for term in LOCATION_TERMS):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999

    has_core = any(term in text for term in CORE_TERMS)
    has_ai = any(term in text for term in AI_TERMS)
    if not has_core and not has_ai:
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

    if not any(term in text for term in LOCATION_TERMS):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999
    if '정규직' not in text and '정규' not in text:
        return -999
    if not any(term in text for term in REGULAR_DEV_TERMS):
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


def score_salary_result(title, body, url):
    text = f"{title} {body}".lower()

    if not any(term in text for term in LOCATION_TERMS):
        return -999
    if any(term in text for term in EXCLUDE_TERMS):
        return -999

    salary = salary_info(title, body)
    if salary is None or salary['monthly'] < 450:
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

    if not any(term in text for term in LOCATION_TERMS):
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
    trimmed = sorted(urls)[-4000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_group(queries, scorer):
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
    node = anchor
    fallback = normalize_text(anchor.get_text(' ', strip=True))
    for _ in range(8):
        node = getattr(node, 'parent', None)
        if node is None:
            break
        text = normalize_text(node.get_text(' ', strip=True))
        if not text or len(text) > 2200:
            continue
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
                for anchor in soup.find_all('a', href=True):
                    href = anchor.get('href') or ''
                    match = re.search(r'/Recruit/GI_Read/(\d+)', href, re.I)
                    if not match:
                        continue

                    title = normalize_text(anchor.get_text(' ', strip=True))
                    if not title or len(title) < 2:
                        continue

                    body = jobkorea_card_text(anchor)
                    if not any(loc in body for loc in LOCATION_TERMS):
                        continue

                    url = f'{JOBKOREA_BASE}/Recruit/GI_Read/{match.group(1)}'
                    candidate = {
                        'title': title,
                        'body': body,
                        'url': url,
                        'score': 0,
                        'salary': salary_info(title, body),
                        'short_pay': short_term_pay_info(title, body),
                        'source': '잡코리아 직접',
                    }
                    current = jobs.get(url)
                    if current is None or len(candidate['body']) > len(current['body']):
                        jobs[url] = candidate
                    page_links += 1

                parsed_links += page_links
                # 검색 결과 페이지 구조가 바뀐 경우 조용히 '0건'으로 오인하지 않는다.
                page_text = normalize_text(soup.get_text(' ', strip=True))
                if ('총 ' in page_text or '채용정보' in page_text) and page_links == 0:
                    failed_pages += 1
                    errors.append(f'{query} p{page_no}: 공고 링크 파싱 0건')
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

    return list(jobs.values()), status


def search_jobs():
    direct_jobs, jobkorea_status = collect_jobkorea_direct()

    # 검색엔진은 보조 수단으로 유지하고, 잡코리아 직접 수집 결과를 우선 합친다.
    java_jobs = merge_jobs(
        classify_jobs(direct_jobs, score_java_result),
        search_group(JAVA_AI_QUERIES, score_java_result),
    )
    regular_dev_jobs = merge_jobs(
        classify_jobs(direct_jobs, score_regular_dev_result),
        search_group(REGULAR_DEV_QUERIES, score_regular_dev_result),
    )
    salary_jobs = merge_jobs(
        classify_jobs(direct_jobs, score_salary_result),
        search_group(SALARY_QUERIES, score_salary_result),
    )
    short_term_jobs = merge_jobs(
        classify_jobs(direct_jobs, score_short_term_result),
        search_group(SHORT_TERM_QUERIES, score_short_term_result),
    )

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
    return java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, jobkorea_status


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
        if body:
            lines.append(f'내용: {escape(body)}')
        lines.append('우선 기준: 하루~1개월 · 초보/무경력 · 일정 조정 용이')
        lines.append('')

    if len(jobs) > 10:
        lines.extend([f'※ 일급/시급 우선 상위 10건 표시 / 추가 {len(jobs) - 10}건', ''])


def build_message(
    java_jobs, salary_500, salary_450, regular_dev_jobs, short_term_jobs,
    jobkorea_status,
):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    if jobkorea_status.get('ok'):
        lines.extend([
            f'✅ 잡코리아 직접 수집: 후보 {jobkorea_status.get("parsed_jobs", 0)}건 확인',
            '',
        ])
    else:
        lines.extend([
            '⚠️ <b>잡코리아 직접 수집 실패</b> — 신규 없음으로 간주하지 않습니다.',
            '',
        ])

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)
    append_short_term_section(lines, short_term_jobs)

    lines.append('※ 같은 공고는 Java/AI → 개발자 정규직 → 급여 → 단기알바 순으로 한 번만 표시합니다.')
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


def main():
    seen = load_seen()
    java_jobs, regular_dev_jobs, salary_jobs, short_term_jobs, jobkorea_status = search_jobs()

    new_java = [job for job in java_jobs if job['url'] not in seen]
    java_urls = {job['url'] for job in java_jobs}

    # Java/AI와 겹치는 정규직 공고는 Java/AI 구역에 우선 표시한다.
    new_regular_dev = [
        job for job in regular_dev_jobs
        if job['url'] not in seen and job['url'] not in java_urls
    ]
    regular_urls = {job['url'] for job in regular_dev_jobs}

    # 급여 공고는 Java/AI 및 개발자 정규직에 나온 공고를 제외한다.
    new_salary = [
        job for job in salary_jobs
        if job['url'] not in seen
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
        if job['url'] not in seen and job['url'] not in occupied_urls
    ]

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, short_term_matched={len(short_term_jobs)}, '
        f'new_java={len(new_java)}, new_regular_dev={len(new_regular_dev)}, '
        f'new_500={len(salary_500)}, new_450={len(salary_450)}, '
        f'new_short_term={len(new_short_term)}'
    )

    all_seen = (
        seen
        | {job['url'] for job in java_jobs}
        | {job['url'] for job in regular_dev_jobs}
        | {job['url'] for job in salary_jobs}
        | {job['url'] for job in short_term_jobs}
    )

    if os.environ.get('JOB_ALERT_DRY_RUN') != '1':
        save_seen(all_seen)

    total_new = (
        len(new_java) + len(new_regular_dev)
        + len(salary_500) + len(salary_450)
        + len(new_short_term)
    )
    message = build_message(
        new_java, salary_500, salary_450, new_regular_dev, new_short_term,
        jobkorea_status,
    )

    if total_new == 0:
        if jobkorea_status.get('ok'):
            message += '\n\n오늘은 다섯 조건 모두 신규 공고가 없습니다.'
        else:
            message += '\n\n잡코리아 수집이 실패해 오늘 결과를 0건으로 확정하지 않았습니다.'

    if os.environ.get('JOB_ALERT_DRY_RUN') == '1':
        print('[INFO] DRY RUN: Telegram send skipped.')
        print(message[:6000])
        return

    send_via_jkquant(message, total_new)
    print('[INFO] Telegram job notification sent via jkquant Pages Function.')


if __name__ == '__main__':
    main()
