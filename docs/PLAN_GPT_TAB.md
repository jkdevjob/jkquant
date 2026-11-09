# 자산플랜 ⚡ 지피티 탭 — 지피티 작업 계약

자산플랜(`/plan`)은 담당 탭이 두 개다. **🤖 클로드 탭**은 클로드가 맡고(5년 '듀얼 가드'), **⚡ 지피티 탭**은 지피티가 맡는다.
두 탭은 화면 · 장부 · 엔진 · 연구를 섞지 않는다. 공용 작업 규칙은 저장소 루트의 `CLAUDE.md` 를 그대로 따른다.

## 1. 지피티가 고칠 수 있는 것

| 무엇 | 어디 |
|---|---|
| 화면 진입점 | `plan-gpt.js` — `#planGptRoot` 안을 그린다 |
| 새 화면·엔진 파일 | `plan-gpt-*.js` · `plan-gpt.css` (이 이름으로만) |
| 자료 · 연구 · 시험 | `data/plan-gpt/` · `research/gpt-plan/` · `scripts/check-plan-gpt*.cjs` |
| `plan.html` | 아래 세 곳만 — ① `#pane-gpt` 블록 안(자리표시 글자) ② 그 바로 아래 `plan-gpt` 스크립트·스타일 태그와 캐시 판(`?v=x.y.z`) ③ 머리말 버전 `<span class="ver">` |
| CI | `.github/workflows/check.yml` 에 지피티 시험 단계 추가 |

## 2. 건드리지 않는 것

- `plan.html` 의 `#pane-claude` 안과 그 스크립트(`renderAlphaPlan` 등) · `plan-session-engine.js` · `plan-session-settings.js` · `plan-tax-check.js`
- Firestore `users/{uid}` 문서의 `fiveYearPlanV2` · `stateV2` — 클로드 탭·운영 장부다. **읽지도 쓰지도 않는다.**
- 클로드 연구(`research/daily` 브랜치의 `research/im_plan/`) · 클로드 시험(`scripts/check-plan-*.cjs` 중 `check-plan-gpt*` 가 아닌 것)
- `index.html` 모의 목록(공용) — 지피티 전략을 모의 목록에 넣고 싶으면 **사용자에게 먼저 묻는다**

## 3. 페이지가 주는 것

- **로그인 · 이용 승인** — 페이지가 처리한다. 지피티 칸은 승인된 사용자에게만 보인다.
- **탭** — `#aiTabs` 의 ⚡ 지피티 버튼 · 주소 `/plan#gpt` 로 바로 열린다 · 숨김은 `#pane-gpt[hidden]`.
- **화면 위치(2026-11-09)** — 플랜 화면은 운영(`/`) 맨 왼쪽 **듀얼 가드** 탭 안에 창으로 들어간다(`/plan?embed=1`). 메뉴의 '자산플랜' 자리는 '💰 포트폴리오'가 됐다.
  - 창 안에서는 이 페이지 머리말·메뉴가 숨고(`html.embed`), 링크는 바깥 창에서 열린다(`<base target="_top">`). ⚡ 지피티 칸도 그 안의 탭으로 보인다.
  - 주소 `/plan` · `/plan#gpt` 로 바로 열면 평소 화면이다. 지피티 칸은 두 경우 모두 그대로 그리면 된다(창 높이는 바깥이 정하고 안에서 스크롤한다).
- **저장 창구 `window.PLANGPT_ACCOUNT`** — 로그인·승인 뒤 열리고 `plangpt-account` 이벤트로 알린다. 로그아웃·승인 취소·계정 바뀜이면 `null`.
  - `uid`
  - `load()` → `users/{uid}/planGpt/notebook` 문서. 없으면 `{schemaVersion:1, revision:0, settings:{}, items:[]}`
  - `save(next, expectedRevision)` → 저장된 revision 이 `expectedRevision` 과 같을 때만 저장하고 revision +1 · 다르면 오류('다른 기기에서 기록이 바뀌었습니다')
  - 계정이 바뀌면 읽기·쓰기 모두 오류. Firestore 문서 한도 1MB — 큰 자료는 나눠 둔다.
- **시세** — `/api/quote?symbol=TQQQ&range=max&div=1&intraday=0`
  - `series` 배당 조정 종가 · `ohlcTrade` 실제 체결가(`priceBasis:'trade'`) · `dividends` 배당 · `price` 현재가 · `marketState`
  - 환율 `/api/fx?date=YYYY-MM-DD` → `{rate}` · 종목 찾기 `/api/search?q=`
- **돈 표시** — `window.JKMoney.usdText(v)` (달러·원화 병기 — 앱 공용 규칙)

```js
// plan-gpt.js — 저장 창구 쓰는 법
async function onAccount(){
  const A=window.PLANGPT_ACCOUNT; if(!A) return;          // 로그아웃 · 아직 로그인 전
  const nb=await A.load();                                  // 내 칸만
  // … 화면 그리기 …
  // 저장: await A.save({...nb, items:[...]}, nb.revision);
}
window.addEventListener('plangpt-account', onAccount);
onAccount();                                                // 이미 열려 있으면 바로
```

## 4. 공용 규칙 (CLAUDE.md 요약)

- 버전은 x.y.z — 고칠 때마다 `plan-gpt.js?v=` 판과 머리말 버전을 올린다.
- `node scripts/check-before-push.cjs` ALL PASS → PR → squash merge → `curl` 로 배포된 버전 확인.
- 고친 것마다 **값 시험 + 변이 시험**(옛 코드로 되돌리면 빨간불).
- **룩어헤드 금지** — 종가 신호는 전일까지 확정된 지표로 정하고 당일 종가에 체결.
- 백테스트는 앱과 같은 체결(전일 종가로 주수 · 다음 날 종가 · 수수료 0.1% · 해외주식 양도세 22% · 250만원 공제) · **1만$ · 10만$ 두 버전**.
- 공식 규칙과 실험을 같은 이름으로 보이지 않는다 — 근거가 없으면 '실험적 확장'으로 표시한다.
- 무한매수법 내용은 재가공·편집·정리해 다른 공간(개인 홈페이지·유튜브 등)에 제공하지 않는다.
- 상태 문서(`REQUIREMENTS.md` · `TASKS.md` · `CHANGELOG.md` · `TEST_RESULTS.md`)에 지피티 탭 항목을 적는다.

## 5. 클로드 쪽 시험이 보는 계약 (어기면 빨간불)

`scripts/check-plan-claude-tab.cjs` 가 본다.

- `plan.html` 에 `<div class="ai-pane" id="pane-gpt" … hidden>` 과 `<script src="/plan-gpt.js?v=x.y.z" defer></script>` 가 있고, `<!-- /#pane-claude -->` 뒤에 온다.
- `plan-gpt.js` · `plan-gpt-*.js` 는 주석을 뺀 코드에서 `JKPlanSessionEngine` · `alphaLedger` · `liveState` · `renderAlphaPlan` · `fiveYearPlanV2` · `stateV2` · `planDbState` 를 쓰지 않는다.
- 저장 창구는 `users/{uid}/planGpt/notebook` 만 열고, revision 이 다르면 저장을 거절한다.
