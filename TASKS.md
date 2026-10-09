# JKQuant 작업 현황 · 우선순위

> 갱신 기준: **2026-10-09**, 감사 병합 `main@cd4a714a` (#467), 부동산 작업 기준 `main@89aa80ef` → [PR #469](https://github.com/jkdevjob/jkquant/pull/469).  
> 아래는 작업 근거가 확인된 항목만 등록한다. **PR 열림 ≠ 기능 미완료**, **CI 통과 ≠ 운영 검증**.

| ID | 요청일/확인일 | 우선순위 | 내용 | 현재 상태 | 근거 / 다음 작업 |
|---|---|---|---|---|---|
| JK-001 | 2026-10-08 | P1 | `REQUIREMENTS.md`, `TASKS.md`, `CHANGELOG.md`, `TEST_RESULTS.md` 작성 및 README 연결 | **완료(코드·PR 병합)** | 점검 시 네 문서 부재 → [#467](https://github.com/jkdevjob/jkquant/pull/467)에서 생성, `main@cd4a714a`에 반영 |
| JK-002 | 2026-10-08 | P1 | 관리자 내장 무한매수 기본 큰수 **15% → 20%** 기준 일치 | **수정 완료(CI·Pages 배포 성공)** | `admin.html`의 `STRATEGY_DEFAULT_BUILTIN.inf.big`이 15였는데 `index.html`과 `backtest.html`의 `IM_BIG_DEFAULT=20`, 프로젝트 기본값 자료는 20. **기존 세션·사용자 지정 기본값은 보존** |
| JK-003 | 2026-10-08 | P1 | 가입 승인 메일의 실패 원인을 관리자 사용자 목록에 제공자와 함께 표시 | **수정 완료(CI·Worker 배포 성공)** | `approvalNotify`는 실패 사유를 저장했지만 `approvalStatus`는 사유를 반환하지 않았음. 관리자에게만 안전하게 제공하고 UI는 textContent 표시 |
| JK-004 | 2026-10-08 | P1 | 실제 Gmail 발신 및 수신 테스트 | **미검증 (실계정 필요)** | Apps Script 실행·승인·Worker secrets 업로드 성공 기록은 존재. 그러나 승인 대상 사용자 실제 수신/발신함/스팸함과 Apps Script 실행 이력까지 일치한 증거는 없음. 테스트 승인 계정으로 실패/성공 상황 재현 후 완료 가능 |
| JK-005 | 2026-10-08 | P1 | 백테/운영/모의/서버/플랜 주문·체결 패리티의 **현행** 실제 환경 점검 | **범위별 기존 CI PASS / 전체 실운영 미검증** | `AUDIT-SELF-REVIEW.md`, `regression-check.js`, `CLAUDE.md`. 이번에는 거래 파라미터나 역사적 성과를 재최적화하지 않음; 실제 `backtest.html` 전체 환경의 새 성과 검증은 별도 실행 |
| JK-006 | 2026-10-08 | P2 | GitHub 열린 PR 10건의 현행 main 재비교 및 중복/충돌 정리 | **대기** | 점검 시 열린 PR: #206, #292, #295, #309, #321, #325, #339, #344, #365, #454. 상당수는 이전 main 기준의 오래된 PR임. **내용 미대조 상태이므로 승인 없이 자동 병합/폐기 금지** |
| JK-007 | 2026-10-08 | P2 | JOB 공고 만료·삭제·업체명 매핑·새 공고 알림의 실제 사용자 경로 검증 | **미검증** | 코드/워크플로 존재만 확인. 마감 공고 클릭·데이터 정합성 및 알림 누르기 실제 동작은 현 단계에서 측정하지 않음 |
| JK-008 | 2026-10-08 | P2 | 모바일 메뉴 전환 속도·탭/헤더 고정 실기기 검증 | **정적/회귀검사 존재 · 실기기 미검증** | `scripts/check-mobile-pages.cjs`, `scripts/check-sticky-layout.cjs` 및 과거 PR #455·#466. iOS 실제 홈 화면 PWA 로딩·스크롤 테스트가 추가로 필요 |
| JK-009 | 2026-10-08 | P2 | 관리자 승인 메일과 웹푸시의 실제 수신/발송 기록 비교 | **미검증** | `tests/approval-notification.test.mjs`는 모의 API·서명 검증; 실제 Gmail/FCM/Push delivery는 외부 실기기 검증 필요 |
| JK-010 | 2026-10-09 | P1 | 부동산 GPT: 오늘·후보·내 자금·관심/보유의 판단 및 매수·매도 기록 연결, 신규분양 자동조회·마감 보정 | **구현·로컬검사 완료 / 실계정·iPhone 미검증** | [PR #469](https://github.com/jkdevjob/jkquant/pull/469), 부동산 v1.9.0. 단위/변이 14개·모바일 Chromium 390/360px 및 부분 조회 흐름 PASS, 로컬 CI 43단계·기존 회귀 2,742 PASS. 운영 매매 API 정상, 전세/청약홈은 인증·활용신청 보완 필요. GitHub 최종 CI·배포 결과는 PR, 실제 Firebase 쓰기·iPhone은 별도 확인 |

## #467 배포·검증 결과

- 변경: 관리자 v0.12.17 · 승인 알림 Worker v2.2.2 · 문서 정본 4종.
- 검증: [PR CI #37729987963](https://github.com/jkdevjob/jkquant/actions/runs/37729987963) **2,742 PASS / 0 FAIL**.
- 배포: Cloudflare Pages 및 승인 알림 Worker 배포 작업 **성공**. 앱 실제 HTTP/아이폰/Gmail 수신 검증은 별도.

## 최신 기준에서 이미 구현이 확인된 사례

| 기능 | 확인 범위 | 판정 |
|---|---|---|
| 관리자 사용자 승인·차단 | `admin.html`, `firestore.rules` 및 회귀검사 | 구현 존재·회귀 통과 / 새 사용자 실제 이용 확인은 별도 |
| 개인 승인 웹푸시/메일 발신 경로 | `worker/presale-alert/src/index.js` · `Code.gs` · 승인 알림 단위검사 | 구현 존재 / 실수신 미검증 |
| 상단 고정과 모바일 공통 검사 | `jk-ui.js` · 모바일/고정 체크 스크립트 · CI | 구현·CI 존재 / 실제 iOS 검증 별도 |
| 무한매수 공식값 비교 및 골든 | `regression-check.js`, `AUDIT-SELF-REVIEW.md` | 기존 시험 존재 / 이번 감사에서는 공식 백테 전체 재실행·성과 확정하지 않음 |

## 다음 Work 시작 체크리스트

1. 먼저 `git log -1` 또는 GitHub branch API로 최신 `main` SHA를 확인하고 이 문서의 날짜/근거를 재검토한다.
2. `REQUIREMENTS.md`와 `AUDIT-SELF-REVIEW.md`, 관련 소스의 최신 규칙을 비교한다.
3. '구현 완료'도 실기기/실메일 검증이 남았으면 운영 완료로 단정하지 않고 별도 항목을 유지한다.
4. 문제를 재현 가능한 입력·출력과 함께 테스트로 남긴 뒤 고치고, CI와 실제 운영을 구분해 `TEST_RESULTS.md`에 기록한다.
5. 완료되지 않은 일은 사유와 재현 조건을 유지한다. 기존 사용자 금융 원장/거래/전략 기본값의 일괄 변경 금지.

**우선순위 정의:** P0 = 자산·보안·주문 즉시 위험, P1 = 핵심 불일치/기능 문제, P2 = 품질·사용성·추가 검증. 예시는 해당 위험이 실제로 재현된 경우에만 P0로 올린다.
