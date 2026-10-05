#!/usr/bin/env python3
import inspect
import job_alert as j


def run():
    a = {
        'title': '대전 Java 개발자 채용',
        'company': '테스트회사',
        'body': '대전 Java 개발자 정규직 채용',
        'url': 'https://www.jobkorea.co.kr/Recruit/GI_Read/1001',
    }
    repost = dict(a, url='https://www.jobkorea.co.kr/Recruit/GI_Read/1002')
    assert j.same_job(a, repost) is False, 'same-site different posting IDs must not merge'

    cross = dict(a, url='https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=2002')
    assert j.same_job(a, cross) is True, 'cross-site duplicate should still merge'

    deadline, source = j.parse_job_deadline('테스트 채용', '~ 10/31(토) 입사지원')
    assert deadline.endswith('-10-31') and source == '지원마감일'

    tomorrow = j.today_date_kst() + j.timedelta(days=1)
    yesterday = j.today_date_kst() - j.timedelta(days=1)
    explicit, explicit_source = j.parse_job_deadline(
        '테스트 채용',
        f'채용시 조기마감 가능 · 지원마감: {tomorrow.isoformat()}',
    )
    assert explicit == tomorrow.isoformat()
    assert explicit_source == '지원마감일', 'explicit support deadline must beat 채용시 fallback'
    assert j.content_close_reason('테스트 채용', f'지원마감 {tomorrow.isoformat()}', explicit) == ''
    assert '마감일 경과' in j.content_close_reason(
        '테스트 채용',
        f'지원마감 {yesterday.isoformat()}',
        yesterday.isoformat(),
    )
    assert j.content_close_reason(
        '[대전] 기록물관리시스템 개발자 구인',
        '상주 모집종료 예상 금액 500만원 ~ 700만원',
        '',
    ) == '원문 마감 표시'
    assert j.content_close_reason(
        '테스트 채용',
        '삭제된 채용 공고입니다.',
        '',
    ) == '원문 마감 표시'

    detail_html = f"""
    <html><head>
      <script type="application/ld+json">
      {{"@context":"https://schema.org","@type":"JobPosting",
        "title":"대전 Java 개발자","validThrough":"{tomorrow.isoformat()}T23:59:59+09:00",
        "hiringOrganization":{{"@type":"Organization","name":"테스트회사"}}}}
      </script>
    </head><body>지원마감 {tomorrow.isoformat()}</body></html>
    """
    structured_deadline, structured_source = j.extract_detail_deadline(
        detail_html,
        '대전 Java 개발자',
        '잡코리아',
    )
    assert structured_deadline == tomorrow.isoformat()
    assert structured_source == '구조화데이터:validThrough'

    expired_job = {
        **a,
        'deadline': yesterday.isoformat(),
        'deadlineSource': '지원마감일',
    }
    assert j.classify_jobs([expired_job], j.score_java_result) == [], (
        'expired postings must never be sent as active/new matches'
    )
    closed_detail_job = {
        **a,
        '_urlState': 'closed',
        '_urlReason': '원문 마감 표시',
    }
    assert j.classify_jobs([closed_detail_job], j.score_java_result) == [], (
        'detail pages confirmed closed must never be sent as active/new matches'
    )
    missing_detail_job = {
        **a,
        '_urlState': 'missing',
        '_urlReason': 'HTTP 404',
    }
    assert j.classify_jobs([missing_detail_job], j.score_java_result) == [], (
        'deleted detail pages must never be sent as active/new matches'
    )

    albamon = j.normalize_search_result_title(
        '알바몬',
        '알바몬',
        'Sep 16, 2026 · 매장관리·판매 ... (단기/경력무관) 습관 기록 앱 데이터 알바. 시간협의 · 대전 전체',
    )
    assert albamon != '알바몬' and '데이터 알바' in albamon

    assert j.is_non_job_record(
        '임준희(@b49d83a1a216494a) | 법무법인 세종 전문위원',
        '총 팔로워 4 팔로잉 2 게시물 0 프로필 게시물 AI 커리어 요약',
        'https://www.rocketpunch.com/@b49d83a1a216494a',
    )
    assert j.is_non_job_record(
        '2026년 주식회사 데이터메이커 채용 | 인크루트',
        '회사 소개 및 기업정보',
        'https://www.incruit.com/company/1680406293/job',
    )

    assert j.is_non_job_record(
        '대전 cj 후기 용돈 벌어보려고 갔는데',
        '자유 알바몬 커뮤니티 개발자어쩌고',
        'https://community.albamon.com/post/detail/947080',
    )
    assert j.is_non_job_record(
        '제목 없음',
        '대전광역시 서구 연봉 10,780만원',
        'https://www.work24.go.kr/wk/a/b/1500/empDetailAuthView.do?wantedAuthNo=TEST',
    )
    assert j.score_salary_result(
        '시설관리 기술직',
        '대전 정규직 연봉 10,780만원',
        'https://www.work24.go.kr/test',
    ) < 0, 'salary tab must stay developer/IT focused'

    assert j.company_hint(
        '매니플레이터 제어 엔지니어',
        '매니플레이터 제어 엔지니어 ㈜라이온로보틱스 대전 유성구'
    ) == '라이온로보틱스'
    assert j.clean_company_name('엔지니어') == ''
    assert j.clean_company_name('신입/경력') == ''
    assert j.clean_company_name('대전/IT') == ''
    assert j.clean_company_name('상상스토리/세종') == '상상스토리'
    deadline, source = j.parse_job_deadline(
        '초급 중급 고급 프리랜서 JAVA 웹개발자 모십니다.',
        '대전 ~08/02 (일) ㈜다올앤컴퍼니 기업인증'
    )
    assert deadline == '2026-08-02' and source == '지원마감일'
    assert j.content_close_reason('테스트', '', deadline).startswith('마감일 경과')

    albamon_dead_html = '''
    <html><body>
    본 정보는 메이크잇 (MakeIt) 에서 제공한 자료를 바탕으로 알바몬이 편집 및
    그 표현방법을 수정하여 완성한 것입니다. 본 정보는 알바몬의 동의없이
    무단전재 또는 재배포할 수 없으며 구직활동 이외의 용도로 사용할 수 없습니다.
    </body></html>
    '''
    assert j.source_detail_invalid_reason(albamon_dead_html, '알바몬') == '알바몬 삭제/빈 상세페이지'

    albamon_live_html = '''
    <html><body><h1>테스트 채용</h1>
    <div>근무조건</div><div>급여</div><div>근무기간</div><div>접수방법</div>
    </body></html>
    '''
    assert j.source_detail_invalid_reason(albamon_live_html, '알바몬') == ''

    assert j.identity_quality_issue({
        'title': 'SW 개발자(백엔드) 채용 공고 (대전)',
        'company': '',
        'body': '[신입/경력] SW 개발자(백엔드) 채용 공고 (대전)',
        'url': 'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=54929576',
    }) == 'missing_company'
    assert j.identity_quality_issue({
        'title': '대전 Java 개발자 채용',
        'company': '테스트회사',
        'body': '대전 Java Spring 정규직',
        'url': 'https://www.jobkorea.co.kr/Recruit/GI_Read/1001',
    }) == ''


    assert j.is_listing_or_search_url(
        'https://www.albamon.com/jobs/area/home?areas=G000'
    )
    assert j.is_listing_or_search_url(
        'https://yw.work24.go.kr/search?query=ai'
    )
    assert j.is_target_dev_job(
        '공공 JAVA PL 구인의 건(대전)',
        'JAVA Spring 웹개발자'
    )
    assert not j.is_target_dev_job(
        '로봇 기구설계 개발자',
        '대전 기계·기계설비 설계엔지니어'
    )
    assert not j.is_target_dev_job(
        '의약화학 연구원 채용',
        '대전 바이오 제약 연구원 연봉 6000만원'
    )

    meta = j.attach_job_metadata({
        'title': 'Java 개발자 채용',
        'body': '대전 유성구 경력 5~12년 대졸↑ 정규직·계약직 Java Spring',
    })
    assert meta['employmentTypes'] == ['정규직', '계약직']
    assert meta['career'] == '경력 5~12년'
    assert meta['education'] == '대졸↑'
    assert not j.response_points_to_job_detail(
        'https://www.jobkorea.co.kr/Recruit/GI_Read/12345',
        'https://www.jobkorea.co.kr/',
    )
    assert not j.response_points_to_job_detail(
        'https://www.saramin.co.kr/zf_user/jobs/view?rec_idx=12345',
        'https://www.saramin.co.kr/zf_user/search?searchword=java',
    )
    assert j.response_points_to_job_detail(
        'https://www.jobkorea.co.kr/Recruit/GI_Read/12345',
        'https://www.jobkorea.co.kr/Recruit/GI_Read/12345',
    )

    assert j.is_listing_or_search_url('https://www.albamon.com/total-search?keyword=대전+단기')
    assert j.is_listing_or_search_url('https://www.alba.co.kr/search/Search?wsSrchWord=대전')
    assert j.is_listing_or_search_url('https://search.incruit.com/list/search.asp?col=job&kw=java')
    assert not j.is_listing_or_search_url('https://www.wanted.co.kr/gigs/projects/13524')

    retry_src = inspect.getsource(j._ddgs_search_with_retry)
    assert "('kr-kr', 'm')" in retry_src and "('wt-wt', None)" in retry_src
    collect_src = inspect.getsource(j.collect_search_source)
    assert "broad = f'\"{domain}\" {fallback_term}'" in collect_src
    assert "domain not in domain_of(url)" in collect_src
    all_src = inspect.getsource(j.collect_all_sources)
    assert "degraded_sources" in all_src
    assert "serial_recovery=1" in all_src
    assert "retry_failed <= previous_failed" in all_src

    missing = {
        **a,
        'sources': ['잡코리아'],
        'status': 'active',
        'missCount': j.DIRECT_MISS_CLOSE_THRESHOLD - 1,
        '_urlState': 'missing',
        '_urlReason': 'HTTP 404',
        'firstSeen': j.today_kst(),
        'lastSeen': j.today_kst(),
    }
    closed = j.apply_unseen_status(
        missing,
        {'잡코리아': {'ok': True, 'mode': '직접'}},
    )
    assert closed['status'] == 'closed'
    assert closed['missCount'] == j.DIRECT_MISS_CLOSE_THRESHOLD

    missing_once = dict(missing, missCount=0)
    missing_once_result = j.apply_unseen_status(
        missing_once,
        {'잡코리아': {'ok': True, 'mode': '직접'}},
    )
    assert missing_once_result['status'] == 'closed'
    assert 'HTTP 404' in missing_once_result['closeReason']

    unknown = dict(missing, _urlState='unknown', _urlReason='HTTP 403', missCount=0)
    unknown_result = j.apply_unseen_status(
        unknown,
        {'잡코리아': {'ok': True, 'mode': '직접'}},
    )
    assert unknown_result['status'] == 'unverified'
    assert 'HTTP 403' in unknown_result['closeReason']

    active = dict(missing, _urlState='active', missCount=2)
    active_result = j.apply_unseen_status(
        active,
        {'잡코리아': {'ok': True, 'mode': '직접'}},
    )
    assert active_result['status'] == 'active'
    assert active_result['missCount'] == 0

    old_expired = {
        **a,
        'deadline': yesterday.isoformat(),
        'deadlineSource': '지원마감일',
        'status': 'active',
        'firstSeen': j.today_kst(),
    }
    carried = j.archive_entry(a, old_expired)
    assert carried['deadline'] == yesterday.isoformat()
    assert carried['status'] == 'closed'
    assert '마감일 경과' in carried['closeReason']

    detail_closed = j.archive_entry(
        {**a, '_urlState': 'closed', '_urlReason': '원문 마감 표시'},
        None,
    )
    assert detail_closed['status'] == 'closed'
    assert detail_closed['closeReason'] == '원문 마감 표시'

    print('JOB logic tests: PASS')


if __name__ == '__main__':
    run()
