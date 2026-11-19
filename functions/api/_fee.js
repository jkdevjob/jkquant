/* 공통 수수료 — 서버(무매 주문 계산 · autotrade)가 사용자 문서에서 읽는 규칙. 브라우저 jk-fee.js 와 같은 규칙이어야 한다
   (scripts/check-common-fee.cjs 가 같은 입력에 같은 값인지 본다).
   users/{uid}.commonFee = {rate, updated} · rate 는 비율(0.0025 = 0.25%) · 없거나 0~2% 밖이면 기본 0.25%. */
export const FEE_DEFAULT = 0.0025, FEE_MAX = 0.02, FEE_FIELD = "commonFee";
export function feeValid(r) { const x = +r; return (r !== null && r !== "" && Number.isFinite(x) && x >= 0 && x <= FEE_MAX) ? x : null; }
export function feeRateFromDoc(d) { const c = d && d[FEE_FIELD]; const x = (c && typeof c === "object") ? feeValid(c.rate) : null; return x == null ? FEE_DEFAULT : x; }
