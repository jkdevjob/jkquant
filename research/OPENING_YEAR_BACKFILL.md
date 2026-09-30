# F절: 과거 Top100 백필과 다음 거래일 시가 그림자

요청 기간: 2025-09-30~2026-09-30. `collect_scalping_data.py --backfill --start ... --end ...`로 재개한다.

## 원자료와 순위

- FinanceData/marcap의 **새로 다운로드한 KRX 연도별 일자 스냅샷**과 최근 일자별 fdr_krx_data_cache를 사용한다. 원천 URL·수집시각과 연도 파일 SHA256을 보존한다. 직접 KRX 로그인 세션이 설정된 환경에서는 KRX 조회도 지원한다.
- 각 날짜의 KOSPI/KOSDAQ 전체 행에서 실제 `Amount`를 내림차순 정렬한다. 현재 상장 목록과 교집합을 취하지 않아 이후 상폐된 종목도 해당일 원자료에 남는다. 연도 원자료의 기존 Rank는 시총 순위이므로 사용하지 않는다. 종가×거래량 근사도 쓰지 않는다.
- 기존 `research/collect_daily.py`는 실제 실행했으나 2026-09-30의 KRX-DELISTING이 빈 데이터프레임을 반환해 SecuGroup 단계에서 실패했다. 또한 이 스크립트는 실제 거래대금을 저장하지 않는다. 그래서 공개 일자별 전체 종목 스냅샷으로 대체했다.
- **당일 최종 거래대금 Top100은 사후 유니버스다. 아침에 실행 가능한 유니버스라고 해석하지 않는다.** 기존 운영 아카이브와 분리한 `data/scalping-backfill/archives`에 저장한다.
- KIS 09:00~10:00 분봉 원본을 전 종목 보존한다. VI·무거래 분의 빈칸은 합성하지 않는다. complete는 100종목에서 원자료 조회와 일봉 메타데이터를 확보했다는 뜻이며, 모든 종목 61봉을 뜻하지 않는다. observedMinutes/missingMinuteCount/fullWindowSymbols로 차이를 확인한다.
- 요청 전마다 08:30~15:40 KST를 차단한다(주말 포함). 요청 간격 0.7초 이상, 일시 오류 최대 4회 재시도. 3종목 연속 소스 실패 시 중단하며 원본 체크포인트를 남긴다. 비JSON/로그인 실패를 휴장일로 세지 않는다.
- 하루마다 manifest에 complete/partial/no_session/error와 봉 수를 보존한다. 종목별 원자적 저장을 하므로 실행 중단 후 재개 가능하다.

## hold_to_next_open

- 동일 기준전략 진입 신호와 가격. 당일 손절·익절·09:30 청산 없이 다음 **시장 거래일** 시가로 청산한다. 거래정지 때문에 해당 종목의 다음 관측일로 건너뛰지 않는다.
- 별도 `opening_hold_to_next_open_v1`. 주문은 내지 않으며 라이브 신호는 pending_next_open 상태로 저장된다. 야간 작업이 다음날 일봉 시가를 별도 보조 원자료에 저장해 연구 결과에 연결한다.
- 다음 시가 미확보·거래정지·기업행사 의심은 미확정으로 남기고 수익률 0으로 세지 않는다. 기존 비용 모델을 그대로 사용한다(기간별 세율을 새로 추정한 연구가 아니다).
- 설계에 사용한 2025-09~2026-09는 rawSummary에만 비교한다. 독립 평가는 2026-10-01부터다. 변형 수는 14개로 자동 집계하고 자동 승격은 없다. 다음날 청산이 학습/검증 경계를 넘으면 해당 폴드에서 제외한다.
- 기존 결과 파일이 달라지면 이전 signal-outcomes 원문을 revisions에 해시 이름으로 보존한다.

## 실행 및 결과 상태

- GitHub 작업 `opening-year-backfill.yml`: 요청 기간을 고정하고 1회 최대 4시간, 16:45·21:10·02:30 KST 재개. 날짜 수 때문에 허용 시간에 일찍 멈추지 않는다. 장중에는 실제 네트워크 요청을 하지 않는다. 시간 제한도 매 요청 전에 검사해 CI 강제 종료 전에 체크포인트를 보존한다.
- 45014K처럼 영문자로 끝나는 실제 우선주 코드도 분봉 조회에서 허용한다. 주문 경로의 코드 검증은 변경하지 않는다.
- 전체 manifest가 complete일 때 `data/opening-research-year`로 기준전략과 모든 14개 변형을 재계산한다. 누락이 있으면 1년 완료 결과를 발행하지 않는다.
- 2026-09-30 로컬 실제 점검: 2025-09-30 100종목 6,067봉. 기준 2건, 평균 비용 후 -1.5156%; hold 2건 -1.5077%. **하루 통합동작 점검일 뿐, 1년 검증 결과가 아니다.**
- 수익률은 거래당 연구 수익률이다. 동시 포지션·자금 제약을 구현한 포트폴리오 CAGR/MDD가 아니며 maxDrawdownSimple은 누적 거래 수익률 합산의 낙폭이다.

### Year-boundary calendar recovery (v1.27.2)

The 2025 annual archive ends on December 30. Missing CSV files outside annual coverage must not be treated as proof of a holiday. Explicit closures for 2025-12-31 and 2026-01-01 use the [Korea Investment market schedule notice](https://securities.koreainvestment.com/main/customer/notice/Notice.jsp?cmd=TF04ga000002&num=45922), which confirms December 30 as the final session and January 2 as the next opening. Unknown source errors still propagate. The next-open resolver now crosses that boundary without requesting missing holiday files. Tests verify the exact January 2 selection and failure propagation; a mutation removing confirmed closures must fail. Collector fixes on main trigger a checkpoint-resuming run.

### Final coverage recovery (v1.27.3)

The official notices confirm 10:00 regular-session opens on [2025-11-13](https://securities.miraeasset.com/bbs/board/message/view.do?categoryId=66&messageId=2335796) and [2026-01-02](https://securities.koreainvestment.com/main/customer/notice/Notice.jsp?cmd=TF04ga000002&num=45922). Collect the actual 10:00-11:00 opening hour for these two sessions, retain original timestamps, and record the schedule source and collection window. The existing research strategy still uses its fixed 09:00 entry schedule: these dates contribute no shifted 10:00 entries. Collecting all raw data does not mean the strategy traded every session. The annual report must disclose the two delayed sessions separately.

Window metadata is stored per symbol so an interrupted upgrade refetches remaining stale symbols. Sparse gaps are still visible; no candles are fabricated. Tests exercise actual-hour filtering, fixed-time research inputs, and partial checkpoint resumption; both regressions are killed by mutations. The historical read-only minhist validator also accepts four digits followed by two uppercase alphanumerics (0220WL); shared order validation remains unchanged.
