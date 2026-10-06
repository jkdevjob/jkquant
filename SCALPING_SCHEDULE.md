# JKQuant 단타 스케줄 정책

사용자에게 보이는 정시 알림은 **Cloudflare Worker Cron**이 담당한다.
GitHub Actions의 `schedule`은 지연될 수 있으므로 **연구·수집·보관만 수행하며 사용자 Telegram을 직접 보내지 않는다.**

## 운영 / Telegram

| 전략/기능 | 시간 | 실행 주체 | 비고 |
|---|---|---|---|
| 시초가 실시간 스캔 | 국내 개장일 09:05~09:31 KST | opening Worker | 개장일 KIS 확인 후 실행 |
| 시초가 마감요약 | 국내 개장일 09:31 KST | opening Worker | 장부 기반 |
| 갭하락 장전 판단 | 국내 개장일 08:56 KST | opening Worker | 클로드 탭 |
| 갭하락 종가 처리 | 국내 개장일 15:21 / 15:40 KST | opening Worker | 매도판단 / 체결대조 |
| 데이트레이딩 스냅샷 | 국내 개장일 09:55 KST | daytrading Worker | Top100 고정 |
| 데이트레이딩 실시간 감시 | 국내 개장일 10:00~15:35 KST 중심 | daytrading Worker | 1분 Cron |
| 데이트레이딩 마감요약 | 국내 개장일 15:35 KST | daytrading Worker | 장부 기반 |
| BTC 장중 감시 | 매일 00:05~23:05 KST | global Worker | 24/7, 5분봉 전략 |
| BTC 마감 ⑤⑥ | 매일 00:05 KST | global Worker | 전일 장부 + 최신 연구통계 |
| SOXL 장중 감시 | NYSE 개장일 09:35~16:05 ET | global Worker | 실제 09:30 ET 봉 확인 |
| SOXL 마감 ⑤⑥ | NYSE 개장일 16:05 ET | global Worker | 당일 장부 + 최신 연구통계 |
| GPT·클로드 대결 | 국내 개장일 18:10 KST | opening Worker | 날짜별 중복방지 |
| 클로드 BTC 마감 | 매일 00:05~00:31 KST retry window | opening Worker | 클로드 탭 장부 |
| 클로드 SOXL 마감 | NYSE 개장일 16:05~16:31 ET retry window | opening Worker | 클로드 탭 장부 |
| 클로드 국내 마감 | 국내 개장일 15:56 KST | opening Worker | 15:40 실패 backup |

## GitHub 연구 / 보관

| 작업 | 예약 | 역할 |
|---|---|---|
| BTC 누적 연구 | 매일 09:20 KST | 전일 확정 UTC 원본 수집 + 백테스트 |
| SOXL 누적 연구 | 평일 21:15 UTC | 미국 정규장 종료 후 수집 + 백테스트 |
| 데이트레이딩 연구 | 평일 10:30 / 17:00 KST | Worker 스냅샷 보관 / 장마감 연구 |
| 시초가 장마감 보관 | 평일 09:40 / 10:40 KST | Worker 원장 아카이브 |
| 시초가 분봉 연구 | 평일 16:10 KST | Top100 분봉 + 누적 백테스트 |
| 갭하락 연구 | 평일 18:40 / 23:40 / 다음날 07:30 KST | 실측·일봉·다음 거래일 명단 |
| VTS 읽기전용 대조 | 평일 09:45 / 17:30 KST | 체결 감사자료 저장 |
| +1% 그림자 연구 | 매일 09:45 / 평일 17:30 KST | 네 전략 그림자 연구 |
| 야간 통합 연구 | 매일 19:10 / 20:10 KST backup | 통합 점수·가드된 자동승격 |
| GPT·클로드 대결 workflow | 수동만 | Worker 장애 시 fallback |

## 불변 규칙

- GitHub Actions 예약 작업은 사용자 Telegram을 직접 발송하지 않는다.
- BTC를 제외한 모든 주식 단타는 **개장일 확인이 전략 실행보다 먼저**다.
- 연구 작업이 지연돼도 실시간 모의장부와 마감 알림 시간은 영향을 받지 않아야 한다.
- 연구통계가 현재 세션보다 늦으면 Telegram에 **연구자료 기준일**을 별도로 표시한다.
