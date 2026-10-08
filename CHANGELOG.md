# JKQuant 변경 이력 (작업 근거 중심)

> 최초 작성: **2026-10-08**. 과거 모든 릴리스를 소급 수집한 전체 변경기록이 아니라, **실제 확인한 최근 main 커밋과 이번 감사 PR**부터 관리한다.
> 이전 상세 감사는 [AUDIT-SELF-REVIEW.md](AUDIT-SELF-REVIEW.md), [작업 기준](CLAUDE.md)에 남겨둔다.

## 미배포 — 2026-10-08 · 프로젝트 관리/기준 불일치 감사

- 신규 `REQUIREMENTS.md`, `TASKS.md`, `CHANGELOG.md`, `TEST_RESULTS.md` 및 README 안내를 만든다.
- `admin.html`: 관리자 내장 무한매수 큰수 기본값 15%를 사용자 기준 20%에 일치시킨다. **운영/백테 엔진과 기존 투자 세션·사용자 지정값은 변경하지 않는다.** 관리자 버전 v0.12.17.
- `worker/presale-alert/src/index.js`: 승인메일 관리자 상태 조회에 **발신 제공자**와 **실패 사유(최대 120자, 실패한 경우만)**를 추가한다. Worker 2.2.2.
- `admin.html`: 승인메일 발송 실패 때 목록에 원인을 표시한다. 화면 문자열은 `textContent`로 작성해 HTML로 실행되지 않도록 한다.
- 관련 가입 승인 단위검사·전체 회귀검사에 재발 방지 항목을 추가한다.
- 이 절은 **PR 단계의 변경 예정** 목록으로, CI/병합/배포가 끝나기 전까지 완료/운영 반영으로 간주하지 않는다.

## 2026-10-08 · 운영 main에 병합된 최근 확인 작업

| PR | 변경 | 구현 / 확인 근거 |
|---|---|---|
| [#466](https://github.com/jkdevjob/jkquant/pull/466) | 관리자 사용자 승인 목록의 모바일 행 구분선 연결, v0.12.16 | `main@8db957af`, Cloudflare Pages 성공(당시), [검증 실행](https://github.com/jkdevjob/jkquant/actions/runs/37727862861) |
| [#465](https://github.com/jkdevjob/jkquant/pull/465) | Gmail Apps Script 승인 메일 전송 **지원 코드**·기본 비밀키 배포 경로 추가 | `integrations/gmail-approval/Code.gs`, Worker, 관리자 연결. 실수신은 별도 검증 필요 |
| [#464](https://github.com/jkdevjob/jkquant/pull/464) | 데이트레이딩 매매알림 누락 재시도·전달 기록 개선 | GitHub PR 및 기존 코드 기록; 실전 모든 거래 알림 무누락 주장 아님 |
| [#461](https://github.com/jkdevjob/jkquant/pull/461) | 사용자 승인 시 웹푸시/메일 발송 요청·발송 상태 조회 | 관리자·Worker·모의 발송 테스트. 실제 모바일/메일 수신 별도 |
| [#455](https://github.com/jkdevjob/jkquant/pull/455) | 메뉴 전환 미리불러오기, 자산플랜 DB 로딩 안내, 모의성과 고정 열 선 | 화면/회귀 수정 근거; iOS 체감속도 실측 결과와 구분 |

## 변경 이력 작성 원칙

- **최종 사용자에게 영향을 주는 코드 변경**: 이유 / 대상 기능 / 버전 / PR·커밋 / 테스트 / 실제 배포·검증 여부 기록.
- **전략·주문/세금 변경**: 기존 수치의 폐기 범위·SIM_RULE_VER 검토·패리티와 원문 골든 추가.
- **문서만 변경**: 정본의 최신 SHA를 명시하고, 과거 기록을 현재의 참이라고 덮어쓰지 않는다.
- 배포된 적 없는 PR은 완료로 적지 않는다. GitHub PR 상태, Actions, 운영 Pages 배포는 각각 확인한다.
