# 연구(지피티) 매일 심층 연구 — 지피티 작업 지시서

사용자 지시(2026-11-09): "지피티도 똑같이 할수 있게 지시서 만들어". 연구(클로드) 메뉴를 클로드가 매일 연구하는 방식 그대로,
지피티가 **연구(지피티) 메뉴 전략을 매일 깊게 연구하고 08:00 에 보고**한다.
공용 작업 규칙은 저장소 루트의 `CLAUDE.md` 를 그대로 따른다 — 버전 · 검사 ALL PASS · 값 시험과 변이 시험 · 룩어헤드 금지 · 단타 데이터 누적 원칙 · 작업 상태 보고 원칙.
보고는 한국어로, 결과와 핵심 숫자만 짧게. 이 문서가 바뀌면 다음 날 루틴부터 바뀐 내용을 따른다.

## 1. 누가 무엇을

| | 지피티 | 클로드 |
|---|---|---|
| 메뉴 | 연구(지피티) `/scalping` · `scalping.html`(머리말 `#scVer`) | 연구(클로드) `/claude` · `claude.html` |
| 탭 | 오늘 · 시초가 · 데이트레이딩 · 비트코인 · SOXL · 종가 30분 · 개별 종목 종가 베팅 · 텐배거 · 클로드 대결 · 전체 매매이력 | ① 시초가 · ② 데이트레이딩 · ③ 비트코인 · ④ SOXL · ⑤ 종가 30분 · 🔟 텐배거 |
| 매일 시작 | 07:00 KST | 07:07 KST |
| 08:00 보고 | `[지피티 연구 리포트]` — `research/gpt-morning` 브랜치 JSON → 푸시 서버 08:00 알람 | `[클로드 연구 리포트]` — `claude-research-report.yml` |
| 연구 기록 | `GPT-SCALPING-RESEARCH.md` · 번호 **G1, G2, …** | `CLAUDE-SCALPING-RESEARCH.md` · 번호 R1, R2, … |
| 연구 스크립트 | `scripts/gpt_research/gNN_*.py` (또는 `.mjs`) | `scripts/research/rNN_*.py` |

- 자산플랜 · 운영 메뉴는 다른 대화가 맡는다. 다루지 않는다.
- 클로드 대결 탭은 클로드 자료(`data/claude-lab/` · `data/claude-live/` · `CLAUDE-SCALPING-RESEARCH.md`)를 **읽기만** 한다.

## 2. 고칠 수 있는 것 · 건드리지 않는 것

- **지피티 파일 — 고칠 수 있음**
  - 화면: `scalping.html` · `tenbagger-gpt.js` · `tenbagger-gpt.css`
  - 서버(`functions/api/`): 시초가(`_opening.js` · `_opening-execution.js` · `opening-research.js` · `opening-execute.js` · `opening-monitor.js` · `opening-summary.js`) · 데이트레이딩(`_daytrading.js` · `daytrading-*.js`) · 종가(`_closing30.js` · `closing30-*.js`) · `crypto.js` · `crypto-research.js` · `soxl-research.js` · `global-paper.js` · `scalping-*.js` · `_scalping_duel.js` · `daily1-shadow.js` · `tenbagger-research.js` · `_research-broker.js` · `_research-orders.js` · `_gpt_morning_report.js` · `gpt-morning-report.js`
  - Worker: `worker/daytrading-scheduler` · `worker/global-intraday-scheduler`
  - 지피티 수집 · 연구 스크립트와 워크플로 · `research/gpt-morning/` · `GPT-SCALPING-RESEARCH.md` · `scripts/gpt_research/`
- **클로드 파일 — 건드리지 않음**
  - 이름에 `claude` 가 들어간 파일 전부: `claude.html` · `claude-*.js` · `functions/api/_claude_*.js` · `functions/api/claude-*.js` · `scripts/claude_lab.py` · `CLAUDE-SCALPING-RESEARCH.md` · `claude-research-report.yml` · `tenbagger-claude*` · `scripts/tenbagger_claude/` · `data/claude-*`
  - 클로드 ①②⑤ 전략 · 주문: `functions/api/opening-gapdown.js` · `_gapdown.js` · `scripts/backtest_opening_gapdown.py` · `scripts/backtest_etf_overnight.py` · `opening-gapdown-research.yml` · `scripts/test_opening_gapdown.*` · `scripts/mutation_test_opening_gapdown.py`
  - 클로드 연구: `scripts/research/` · `scripts/news_collect.py` · `news-collect.yml` · `r10-dart-research.yml` · `research/daily` 브랜치
- **공용 — 꼭 필요할 때만 최소로**
  - `worker/opening-scheduler`(클로드 ①②⑤ 와 지피티 시초가가 같이 쓴다) · `worker/presale-alert`(웹 푸시 · 텔레그램)
  - 설정 › 모의투자(`_paper-trading.js` · `paper-trading-settings.js` · `settings-paper-trading.js`) · `kis.js` · `_krx_calendar.js` · `_market-day-cache.js` · `telegram.js`
  - `regression-check.js` · `scripts/check-before-push.cjs` · `.github/workflows/check.yml` · `CLAUDE.md` · 상태 문서 4개(`REQUIREMENTS.md` · `TASKS.md` · `CHANGELOG.md` · `TEST_RESULTS.md`)
  - 공용 파일을 고치면 양쪽 시험이 모두 초록이어야 하고 PR 에 그렇게 적는다. 상태 문서는 지피티 장만 더한다. `CLAUDE.md` 는 사용자가 원할 때만 고친다.
- 어느 쪽 파일인지 애매하면 고치기 전에 사용자에게 묻는다.

## 3. 처음 한 번 (이 지시서를 받은 날)

1. 최신 main SHA 를 확인하고 끝까지 읽는다.
   - `CLAUDE.md` · 이 문서 · `research/gpt-morning/README.md`(보고 계약 — 칸 수는 지금 코드대로 여덟 개, 4장 4번) · `SCALPING_DATA_SPEC.md` · `SCALPING_SCHEDULE.md`
   - `REQUIREMENTS.md` · `TASKS.md` · `CHANGELOG.md` · `TEST_RESULTS.md` 의 지피티 장 · 최근 7일 `research/gpt-morning/*-research.json`
   - 지피티 승격 · 순위 코드: `functions/api/scalping-auto-promotion.js` · `scalping-promotion.js` · `scalping-shadow-ranking.js` · `scripts/daily1_shadow_lab.py`
2. 연구 기록 `GPT-SCALPING-RESEARCH.md` 를 main 에 만든다(PR). 틀은 `CLAUDE-SCALPING-RESEARCH.md` 와 같다.
   - **원칙** · **할 일 목록**(기대 효과 큰 순 · `# · 주제 · 왜 · 상태`) · **연구 기록**(최근 순 · 날짜 · 번호 · 사전 등록 장과 결과 장)
   - 할 일은 최근 아침 보고의 nextTest · blocked 항목과 그림자 순위에서 뽑는다.
3. 매일 07:00 KST 예약 작업의 지시를 6장 문구로 바꾼다. 아침 검토 예약은 하나만 남긴다(두 번 돌지 않게).
4. `research/gpt-morning` 브랜치에 11/03 · 11/04 · 11/09 아침 보고 제출이 없다. 그날은 푸시 서버가 '연구 준비 미완료' 보고를 대신 보내게 되어 있다. 원인(예약 미실행 · 제출 실패 · 검증 거절)을 찾아 `TASKS.md` 에 적는다.
5. 사용자에게 묻는다. 11/08 사용자 규칙 "텐배거를 제외한 전략은 매매가 하루를 넘기면 안 된다"는 연구(클로드) 메뉴에 받은 지시다. 연구(지피티) 메뉴에도 적용하는지 확인한다. 개별 종목 종가 베팅은 밤을 넘긴다.
6. 사용자에게 3줄로 보고한다: 읽은 정본과 main SHA · 예약 상태와 다음 실행 시각 · 첫 연구 주제.

## 4. 매일 루틴 (07:00 KST)

목표: **07:50 까지 보고 제출** — 08:00 에 푸시 서버가 보낸다. 늦어지면 연구 범위를 줄여서라도 08:00 전에 낸다. 08:00 까지 없으면 서버가 '연구 준비 미완료' 보고를 대신 보낸다.

0. 최신 main SHA · `CLAUDE.md` · 이 문서 · `GPT-SCALPING-RESEARCH.md` · `TASKS.md` 의 지피티 미확인 줄을 확인한다.
1. **어제 결과 점검** — 탭마다 실제 원천으로 본다.
   - 공개 API: `/api/scalping-daily-results` · `/api/scalping-history?strategy=…` · `/api/scalping-shadow-ranking` · `/api/tenbagger-research` 등
   - `scalping-data` 브랜치(읽기만): `data/opening-history` · `opening-research` · `daytrading-research` · `daytrading-live` · `crypto-research` · `soxl-research` · `soxl` · `closing30` · `nightly-research` · `daily1-shadow` · `tenbagger-forward` · `vts-reconcile` 등
   - 확정과 미확정 · 원본 감시 누락 · 버전 공란 · 원천 불일치를 나눠 적는다.
   - 수집이나 밤 연구가 빠졌거나 실패했으면 원인을 찾고 `workflow_dispatch` 로 다시 돌린다.
2. **버그 · 자료 문제**는 원인을 보고에 적는다. 고치는 일은 보고를 낸 뒤에 한다(5번).
3. **연구** — 탭마다 '더 나은 방향'을 찾는다. 할 일 목록과 그림자 순위에서 기대 효과가 큰 것부터 **하루 1~2개를 깊게** 한다. 번호는 연구 기록의 마지막 G 다음.
   - 결과를 보기 전에 가설 · 후보 · 판정 기준을 연구 기록에 먼저 적고 커밋한다. 사전 등록 커밋이 결과 커밋보다 앞이어야 한다. 결과를 본 뒤 기준을 바꾸지 않는다.
   - 과거 자료 **시간순(걸어가기) 검증**: 그 시점까지의 자료로 고르고 다음 구간에서 잰다. 전체 기간 최고값은 근거가 아니다.
   - 운영과 **같은 엔진 · 같은 비용 · 실제 원천**으로 잰다. 같은 걸 두 군데서 세지 않는다. 간이 엔진 값은 공식 성과가 아니다.
   - 비용 포함 수익 · 매매 빈도 · MDD · 최악일 · +1% 달성일 · PF 를 지금 메인과 같은 표로 비교한다.
   - 통과 기준(사전 등록): 클로드와 같은 위험 관문 — MDD ≥ −25% · 최악일 ≥ −15% · 비용 뒤 기대값 > 0 · 매매한 해의 60% 이상 플러스(자료가 짧으면 시간순 구간마다) · 시간순 검증에서 메인 이상.
   - 지피티의 기존 관문도 모두 넘어야 한다 — 그림자 검토 기준(전향 20일 · 20건 이상 · PF ≥ 1.10 · MDD ≥ −15% · 최악일 ≥ −8% · `scripts/daily1_shadow_lab.py`)과 그동안 보고에서 써 온 비용 +0.10%p 스트레스.
   - 통과한 것 중 기존 주문 경로 안의 변수는 그림자 후보로 넣는다. 메인 교체는 기존 자동 승격 규칙대로만 한다 — 서로 다른 연구 세션 7번 연속 1위 · 표본(시초가 · 데이트레이딩 · SOXL 30건 · 비트코인 50건) · 위험 · 운영 호환 · 연구 점수 60 이상(`scalping-auto-promotion.js` · `scalping-shadow-ranking.js`).
   - **새 종류 전략 · 주문 경로 변경은 근거와 함께 사용자에게 먼저 묻는다.**
   - 모의 장부 실측은 매매일 20일 이후에 판단한다. 표본이 모자라면 '쌓는 중'으로 적고 결론을 내지 않는다.
   - 통과 · 탈락 모두 연구 기록(할 일 표 줄 + 결과 장)과 `TASKS.md` 에 남긴다. 스크립트는 `scripts/gpt_research/gNN_*.py` 로 남긴다.
   - 미국 종목 백테스트 보고는 원금 1만$ · 10만$ 두 버전으로 한다.
4. **보고 제출** — 계약은 `research/gpt-morning/README.md` 의 schema 1, 검증은 `scripts/validate-gpt-morning-report.mjs`(= `functions/api/_gpt_morning_report.js`).
   - `date`(오늘 KST) · `preparedAt`(실제 작성 시각) · `mainSha`(40자리) · `summary`(260자 이하)
   - `sections` 여덟 칸: `today` · `opening` · `daytrading` · `crypto` · `soxl` · `closing30`(종가 30분 · 개별 종목 종가 베팅) · `tenbagger` · `duel`
   - 칸마다 `status`(verified · collecting · blocked · no_change) · `findings`(700자) · `nextTest`(350자) · `evidence`(HTTPS 4개 이하 · verified 는 근거 필수)
   - 칸 내용: 어제 결과(매매 / 매매 없음 · 순손익 · 확정 여부)와 점검(문제 · 사용자가 할 일). 오늘 연구는 그 탭 칸에 '가설 → 결과 → 다음'으로, 한 줄 결론은 `summary` 에 쓴다. 실제로 확인하지 못한 것은 미확인이라고 쓴다.
   - `research/gpt-morning` 브랜치에 `YYYY-MM-DD.json`(한 번 쓰면 덮어쓰지 않음)과 `latest.json` 을 커밋한다. `gpt-morning-report.yml` 이 검증하고 서버에 예약하면 08:00 알람이 웹 푸시 · 텔레그램으로 보낸다.
   - 실행 로그에서 `ok` · `queued` · `dueAt` 을 확인한다. 실패하면 고쳐서 08:00 전에 다시 낸다. 전날 발송 결과(push · telegram 영수증)는 확인한 만큼 다음 보고에 적는다.
   - 보고 제출 단계는 운영 코드 · 전략 · 주문 · 장부를 바꾸지 않는다.
5. **반영** — 연구 기록과 고친 것을 main 에 넣는다.
   - 코드를 실행할 수 있으면 `node scripts/check-before-push.cjs` 전 단계 PASS → 지피티 작업 브랜치에 푸시 → PR(Ready) → `check.yml` 초록 → squash merge. 빨간불이면 병합하지 않는다.
   - 고친 것마다 값 시험 + 변이 시험(옛 코드로 되돌리면 빨간불)을 넣는다.
   - 페이지를 바꿨으면 `scalping.html` 머리말 `#scVer` 를 올리고 `curl` 로 배포된 버전을 확인한다.
   - main 이 움직이면 합치고 다시 검사한다. 문서 충돌은 양쪽 줄을 다 남긴다.
   - 주문 경로 배포는 15:45 뒤나 08:30 전에만 한다.
6. 사용자에게 한국어 3~5줄로 보고한다: 탭별 어제 결과 · 연구 결론 · 고친 것 · 보고 제출 결과.

## 5. 지킬 것

- 실전 주문은 사용자 승인 없이 만들지 않는다. `KIS_ENV` 는 vts. 주문은 자동으로 다시 내지 않는다. 실계좌 키는 읽기 전용이라도 먼저 묻는다.
- 모의투자 주문 켜기(설정 › 모의투자)는 사용자가 직접 하거나 지시할 때만 한다.
- 비밀값(KIS 키 · 토큰 · 감시키)은 대화 · 커밋 · 보고에 넣지 않는다. 보고에는 개인정보 · 계좌 식별자 · 실계좌 주문과 잔액을 넣지 않는다.
- 백필은 08:30~15:40 KST 에 돌리지 않는다. 08:56 무렵에는 KIS 를 부르지 않는다(클로드 ① 장전 판단 · 주문 시각).
- 텔레그램 실패가 주문 · 기록을 막지 않게 한다.
- `scalping-data` 브랜치에 손으로 푸시하지 않는다(봇 자료 · 읽기만). main 은 PR squash merge 로만 바꾼다.
- 기록된 원본 · 장부를 고쳐 쓰지 않는다. 다시 계산한 것은 따로 표시한다(`SCALPING_DATA_SPEC.md`).
- 공식 결과와 실험 결과를 같은 이름으로 보이지 않는다. 근거가 없으면 '실험적 확장'으로 표시하거나 막는다.
- 단위검사 PASS 만으로 백테 수익률 · 알림 실제 수신 · 실거래 주문을 확인했다고 쓰지 않는다.
- 커밋 메시지에 CI 건너뛰기 표시를 글자로도 쓰지 않는다. 병합 커밋에 들어가면 배포가 건너뛰어진다.
- 사용자에게 물을 것은 대화 글로 묻는다.

## 6. 매일 예약 작업에 넣을 지시

```
[연구(지피티) 매일 심층 연구 — 07:00 KST]
jkdevjob/jkquant 최신 main 의 docs/GPT_DAILY_RESEARCH.md 를 읽고 '4. 매일 루틴'과 '5. 지킬 것'을 그대로 한다.
보고는 07:50 까지 research/gpt-morning 브랜치에 제출하고, 끝나면 이 대화에 한국어 3~5줄로 보고한다.
```
