# JKQuant 검증 결과와 미확인 사항

> **진위 기준:** 명령 실행/CI 원본 로그로 확인한 숫자만 PASS로 작성한다. 코드가 있다는 것, PR 병합, Cloudflare 배포, 실제 Gmail 수신 또는 백테 성과는 각각 다른 검증 단계이다.

## A. 2026-10-08 · 감사 시작 이전 최신 main 확인

| 항목 | 근거 | 결과 |
|---|---|---|
| 당시 `main` 기준 | `8db957af256665b23ba033a9e5ff89b7302b7ef0` (#466) | **확인** |
| GitHub Actions 전체 회귀 | [Run #37727862861](https://github.com/jkdevjob/jkquant/actions/runs/37727862861), `check` 작업 로그 | **2,740 PASS / 0 FAIL**, 작업 성공 |
| 관리자 사용자 목록 UI | #466 코드 변경·회귀·해당 Pages 배포 상태 | **구현+CI 통과**; 실기기 줄 정렬 별도 확인 |
| 개인 Gmail 자동 발송 | Apps Script/Worker/GitHub 비밀값 등록·단위검사 기록 | **실수신 미검증**. CI는 모의 발송이므로 실메일 도착 증거 아님 |
| 투자전략 실제 성과 | 이번 문서 감사에는 실데이터 앱 백테 실행 결과 없음 | **미검증**. 과거 숫자를 신규 실측처럼 쓰지 않음 |

## B. 2026-10-08 · PR #467 CI/배포 완료 · 실사용 검증은 별도

| 테스트 ID | 검증하려는 회귀 | 기대값 | 현재 상태 |
|---|---|---|---|
| V-01 | 관리자 무한매수 내장 기본 큰수 vs 운영/백테 | 모두 20%; 기존 장부·사용자 설정 일괄 변경 없음 | **정적/회귀 PASS + Pages 배포 성공** |
| V-02 | 승인 메일 실패 정보의 관리자 전용 반환 | 비관리자 403; 관리자 오류·제공자 조회; 성공 시 옛 오류 제거 | **단위검사 7/7 PASS + Worker 배포 성공** |
| V-03 | 관리자 실패 표시 XSS 방지 | 상태 문구 `textContent`로 렌더링 | **회귀 PASS + Pages 배포 성공** |
| V-04 | 전체 회귀 유지 | `regression-check.js` ALL PASS + 관련 검증/Worker 번들 | [PR CI #37729987963](https://github.com/jkdevjob/jkquant/actions/runs/37729987963) **2,742 PASS / 0 FAIL** |
| V-05 | Cloudflare Pages/Worker | `main@cd4a714a` 병합 후 Pages/Worker 배포 작업 성공 | **배포 성공 확인**; 직접 실제 URL GET/사용자 화면 미검증 |
| V-06 | 실제 가입 승인 메일 수신 | 실제 테스트 수신자의 편지함에 정확히 1건 + 관리자 오류 상태 일치 | **실사용 계정/메일함 검증 필요** |

검증 근거: [PR #467](https://github.com/jkdevjob/jkquant/pull/467) · [PR CI 실행](https://github.com/jkdevjob/jkquant/actions/runs/37729987963) · [main 검증 작업](https://github.com/jkdevjob/jkquant/actions/runs/37730501030) · [Worker 배포 작업](https://github.com/jkdevjob/jkquant/actions/runs/37730501082).

## C. 검증 실패 시 기록 방식

```text
시각 / main SHA / PR 또는 브랜치
실행 환경, URL, 테스트 명령
기대값 → 실제값 / 오류 메시지 (개인 키·계정 토큰 제외)
영향 범위 / 고친 코드 / 실패해도 유지해야 할 장부
조치 상태: 완료, 실패, 미검증, 외부 조치 필요
재실행 결과: 링크 + 실제 ALL PASS 숫자
```

**절대 금지:** 테스트를 통과시키려고 기대값을 약화하기; 일부 함수/독립 파이썬 결과를 공식 앱 성과로 쓰기; 운영 URL 반영 전 배포 완료라고 쓰기.

## D. 신규 Work/감사자가 다시 실행할 절차

1. 최신 `main` SHA를 확인하고 본 문서 표의 기준을 최신으로 갱신한다.
2. `node scripts/check-before-push.cjs` (**전체**, 오프라인 생략으로 최종 통과 주장 금지).
3. 엔진/백테 변경이면 `node regression-check.js index.html backtest.html testdata` + 관련 원문 골든·변이 검사를 포함한다.
4. PR CI 통과를 확인하고 main 반영 후 동일 SHA에 연결된 실제 배포까지 확인한다.
5. 알림·로그인·원장·자동주문처럼 외부 서비스가 있어야 하는 기능은 **가짜 API 검증**과 **실사용 동작 검증**을 구분하여 별도 기록한다.

[요구사항](REQUIREMENTS.md) · [작업 목록](TASKS.md) · [변경 내역](CHANGELOG.md)

## E. 2026-10-09 · 부동산 GPT 투자판단 v1.9.0

- 기준: 변경 시작 main@c5441bbb → 최신 main@89aa80ef에 맞춤, 작업 브랜치 codex/realestate-decision-20261009, [PR #469](https://github.com/jkdevjob/jkquant/pull/469).
- node --test tests/realestate-decision.test.cjs: **14 PASS / 0 FAIL**, 핵심 변이 3개 검출.
- 예제 검증: 공급가격 5억 + 확장 2천만 + 부대 2% + 추가 1천만 = 총 5.4억, 대출 2.5억 → 자기자금 2.9억. 현금 3억에서 비상자금 2천만 제외 → 1천만 부족. 전세금 변경은 초기 필요자금을 변경하지 않음.
- 계약 검증: 매수 5억·취득비 4천만, 매도 6.2억·매도비 6백만·세금 1천만·이자/보유비 2천만 → 실현손익 4천4백만. 대출 원금 2.5억은 비용으로 차감하지 않음. 저장 후 동일 수치 및 원래 이벤트 보존.
- 개인 문서 경로·revision 충돌·읽는 중 계정 전환 차단 시험 PASS. 실제 Firebase 쓰기와 실계정 접근은 **미검증**.
- 정적 모바일 10페이지, 상단 고정 11경로 × 4폭 및 변이 3개, 앱 직접 브라우저 저장 정책 검사 PASS.
- 전체 로컬 검사 check-before-push.cjs: **43단계 PASS**, Worker dry-run 포함. 기존 전체 회귀 **2,742 PASS / 0 FAIL**. 최종 소스 및 main 반영 전 GitHub CI는 별도 확인한다.
- Chromium 모바일 390·360px: 첫 투자판단 진입, 마감 후보 제외, 자금 저장, 관심 → 매수 → 시세 → 매도, 저장 실패 입력 보존, 해제 거래 제외, 신규분양 자동수집 및 기준 거래일, 가로 넘침 없음, 신규분양 직접 링크 **PASS**. 모의 계정/API에서 예제 실현손익 6,360만원·이벤트 4개, 브라우저 오류 0. 실기기/PWA 및 실제 Firebase/공식 API 결과와 구분한다.
- GitHub 최종 CI 및 배포 결과는 [PR #469 검사](https://github.com/jkdevjob/jkquant/pull/469/checks)에서 확인한다. 실제 본인 Firebase 쓰기와 실기기/PWA는 별도 검증이 필요하다.
- 실제 운영 공개 API: status 설정 있음 및 유성구 2026-09 매매 정상 응답(262건 → 해제·직거래 등 제외 후 242건), 공유 정규화·후보 생성 확인. 전세는 서비스키 미등록/해당 API 미연결, 청약홈은 HTTP 401 미등록 인증키로 실패. 서버 인증/활용신청 보완이 남아 있다. 조회 실패를 공고 없음으로 표시하지 않고 부분 수집에서도 매매 자료는 보존한다.
