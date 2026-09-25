#!/usr/bin/env python3
import json
import os
import re
import sys
import time
from html import escape
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from ddgs import DDGS

CACHE_DIR = Path(".job-alert-cache")
SEEN_FILE = CACHE_DIR / "seen.json"

SEARCH_QUERIES = [
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

LOCATION_TERMS = ('대전', '세종')
CORE_TERMS = (
    'java', 'jsp', 'spring', 'spring boot', '전자정부', 'egov',
    '백엔드', 'sm', '유지보수', 'si', '프리랜서', '계약직',
)
AI_TERMS = (
    'ai', 'llm', 'rag', 'agent', '생성형', '챗봇', 'spring ai',
    'langchain4j', 'mcp', 'vector', 'embedding',
)
PRIORITY_TERMS = (
    '프리랜서', '계약직', 'sm', '유지보수', '공공', '정부',
    '연구원', '연구소', '전자정부', '고급', '중급',
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


def score_result(title, body, url):
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

    domain = domain_of(url)
    if any(domain.endswith(d) for d in TRUSTED_DOMAINS):
        score += 5
    if '서울' in text and not any(t in text for t in LOCATION_TERMS):
        score -= 10
    if '경기' in text and not any(t in text for t in LOCATION_TERMS):
        score -= 10

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
    # 최근 URL만 유지해 캐시가 무한히 커지지 않게 제한한다.
    trimmed = list(urls)[-2000:]
    SEEN_FILE.write_text(
        json.dumps({'urls': trimmed}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )


def search_jobs():
    merged = {}
    ddgs = DDGS()

    for query in SEARCH_QUERIES:
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

                score = score_result(title, body, url)
                if score < 0:
                    continue

                current = merged.get(url)
                candidate = {
                    'title': title,
                    'body': body,
                    'url': url,
                    'score': score,
                }
                if current is None or candidate['score'] > current['score']:
                    merged[url] = candidate
        except Exception as exc:
            print(f'[WARN] search failed: {query}: {exc}', file=sys.stderr)

        time.sleep(0.4)

    return sorted(merged.values(), key=lambda x: (-x['score'], x['title']))


def split_message(text, limit=3900):
    if len(text) <= limit:
        return [text]

    chunks = []
    current = ''
    for block in text.split('\n\n'):
        candidate = block if not current else current + '\n\n' + block
        if len(candidate) <= limit:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = block
    if current:
        chunks.append(current)
    return chunks


def send_telegram(message):
    token = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
    chat_id = os.environ.get('TELEGRAM_CHAT_ID', '').strip()

    if not token or not chat_id:
        raise RuntimeError(
            'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID GitHub Secrets가 필요합니다.'
        )

    endpoint = f'https://api.telegram.org/bot{token}/sendMessage'
    for chunk in split_message(message):
        response = requests.post(
            endpoint,
            json={
                'chat_id': chat_id,
                'text': chunk,
                'parse_mode': 'HTML',
                'disable_web_page_preview': True,
            },
            timeout=20,
        )
        response.raise_for_status()


def build_message(new_jobs):
    lines = [
        '🔎 <b>대전·세종 Java·AI 신규 공고</b>',
        f'신규 {len(new_jobs)}건',
        '',
    ]

    for idx, job in enumerate(new_jobs[:10], 1):
        tags = ' · '.join(tags_for(job['title'], job['body']))
        body = job['body']
        if len(body) > 220:
            body = body[:217] + '...'

        lines.extend([
            f'<b>{idx}. {escape(job["title"] or "제목 없음")}</b>',
            f'분류: {escape(tags)}',
            f'내용: {escape(body)}' if body else '내용: 검색 요약 없음',
            f'공부 포인트: {escape(study_hint(job["title"], job["body"]))}',
            f'<a href="{escape(job["url"], quote=True)}">공고 보기</a>',
            '',
        ])

    if len(new_jobs) > 10:
        lines.append(f'※ 상위 10건만 표시 / 추가 신규 {len(new_jobs) - 10}건 있음')

    return '\n'.join(lines).strip()


def main():
    seen = load_seen()
    jobs = search_jobs()

    new_jobs = [job for job in jobs if job['url'] not in seen]
    print(f'[INFO] matched={len(jobs)}, new={len(new_jobs)}')

    all_seen = seen | {job['url'] for job in jobs}
    save_seen(all_seen)

    # 이전 요구사항 유지: 적합한 신규 공고가 없으면 텔레그램을 보내지 않는다.
    if not new_jobs:
        print('[INFO] no new matching jobs; Telegram message skipped.')
        return

    send_telegram(build_message(new_jobs))
    print('[INFO] Telegram notification sent.')


if __name__ == '__main__':
    main()
