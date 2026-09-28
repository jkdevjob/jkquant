#!/usr/bin/env python3
import json
import os
import re
import sys
import time
import subprocess
from html import escape
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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
                }
                current = merged.get(url)
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.35)

    return list(merged.values())


def search_jobs():
    java_jobs = search_group(JAVA_AI_QUERIES, score_java_result)
    regular_dev_jobs = search_group(REGULAR_DEV_QUERIES, score_regular_dev_result)
    salary_jobs = search_group(SALARY_QUERIES, score_salary_result)

    java_jobs.sort(key=lambda x: (-x['score'], x['title']))
    regular_dev_jobs.sort(key=lambda x: (-x['score'], x['title']))
    salary_jobs.sort(
        key=lambda x: (
            -(x['salary']['monthly'] if x['salary'] else 0),
            -x['score'],
            x['title'],
        )
    )
    return java_jobs, regular_dev_jobs, salary_jobs


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


def build_message(java_jobs, salary_500, salary_450, regular_dev_jobs):
    lines = [
        '🔎 <b>대전·세종 일자리 알림</b>',
        '',
    ]

    append_java_section(lines, java_jobs)
    append_salary_section(lines, '② 🔥 <b>월 500만 이상 · 직종무관</b>', salary_500)
    append_salary_section(lines, '③ 👍 <b>월 450~499만 · 직종무관</b>', salary_450)
    append_regular_dev_section(lines, regular_dev_jobs)

    lines.append('※ 같은 공고가 여러 조건에 걸리면 Java/AI → 개발자 정규직 → 급여 구역 순으로 한 번만 표시합니다.')
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
    java_jobs, regular_dev_jobs, salary_jobs = search_jobs()

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

    print(
        f'[INFO] java_matched={len(java_jobs)}, regular_dev_matched={len(regular_dev_jobs)}, '
        f'salary_matched={len(salary_jobs)}, new_java={len(new_java)}, '
        f'new_regular_dev={len(new_regular_dev)}, new_500={len(salary_500)}, '
        f'new_450={len(salary_450)}'
    )

    all_seen = (
        seen
        | {job['url'] for job in java_jobs}
        | {job['url'] for job in regular_dev_jobs}
        | {job['url'] for job in salary_jobs}
    )
    save_seen(all_seen)

    total_new = len(new_java) + len(new_regular_dev) + len(salary_500) + len(salary_450)
    message = build_message(new_java, salary_500, salary_450, new_regular_dev)

    if total_new == 0:
        message += '\n\n오늘은 네 조건 모두 신규 공고가 없습니다.'

    send_via_jkquant(message, total_new)
    print('[INFO] Telegram job notification sent via jkquant Pages Function.')


if __name__ == '__main__':
    main()
