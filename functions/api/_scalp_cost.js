/* 단타 연구 비용 — 한 곳 (2026-11-19 사용자: "단타 연구 봇에도 공통 수수료 적용해")
   왕복 비용(%) = 수수료(공통 율 × 2) + 수수료 아닌 몫(세금 · 미끄러짐).
   공통 율은 설정 › 💸 수수료(users/{uid}.commonFee · 편도 · 기본 0.25%) — _fee.js · jk-fee.js 와 같은 규칙.
   예전 상수에서 뺀 수수료 몫(왕복): 국내 주식 · ETF 0.015% × 2 = 0.03 · 코인(업비트) 0.05% × 2 = 0.10 · 미국 0.10% × 2 = 0.20.
   수수료 아닌 몫은 그대로 둔다:
     kr      0.20  국내 주식 거래세(코스피 0.05 + 농특세 0.15 / 코스닥 0.20)          예전 0.23 = 0.20 + 0.03
     krDay   0.22  국내 주식 데이트레이딩 · 대결 표 마찰 0.25 의 세금 0.20 + 미끄러짐 0.02   예전 0.25 = 0.22 + 0.03
     etf     0     국내 ETF(거래세 없음) — 호가 미끄러짐은 각 식이 틱으로 더한다          예전 0.03 + 틱
     etfFlat 0.10  ETF 고정 마찰 0.13 의 미끄러짐                                   예전 0.13 = 0.10 + 0.03
     etfFair 0.12  대결 표 ETF 0.15 의 미끄러짐                                     예전 0.15 = 0.12 + 0.03
     coin    0.04  업비트 미끄러짐 0.02 × 2                                        예전 0.14 = 0.04 + 0.10
     us      0     미국 — 예전 마찰 0.20 은 수수료 0.10 × 2                           예전 0.20 = 0 + 0.20
   율은 진입점이 요청 · 실행마다 넣는다(Pages: _owner_fee.js 가 사용자 문서에서 · Worker · 밤 스크립트: /api/common-fee).
   못 받으면 기본 0.25% — 출처(source)를 기록에 같이 남긴다. 과거 기록의 frictionPct 는 덮어쓰지 않는다(단타 누적 원칙). */
import { FEE_DEFAULT, feeValid } from "./_fee.js";

export const SCALP_COST_MODEL = "common-fee-v1";
export const NON_FEE_PCT = Object.freeze({ kr: 0.20, krDay: 0.22, etf: 0, etfFlat: 0.10, etfFair: 0.12, coin: 0.04, us: 0 });

let RATE = FEE_DEFAULT, SOURCE = "default";
const r6 = x => Math.round(x * 1e6) / 1e6;
const rateOf = r => { const x = feeValid(r); return x == null ? FEE_DEFAULT : x; };

/* 진입점이 부른다 — 받은 율이 0~2% 밖이거나 없으면 기본값 · 출처 'default' */
export function setScalpFee(rate, source = "set") {
  const x = feeValid(rate);
  RATE = x == null ? FEE_DEFAULT : x;
  SOURCE = x == null ? "default" : String(source || "set");
  return RATE;
}
export function scalpFeeRate() { return RATE; }
export function scalpFeeSource() { return SOURCE; }
/* 수수료 왕복 % — 편도 율 × 2 × 100 */
export function feeRoundTripPct(rate = RATE) { return r6(2 * rateOf(rate) * 100); }
/* 종류별 왕복 비용 % (틱 미끄러짐 뺀 몫) */
export function scalpCostPct(kind, rate = RATE) {
  if (!Object.prototype.hasOwnProperty.call(NON_FEE_PCT, kind)) throw new Error("단타 비용 종류를 모릅니다: " + kind);
  return r6(NON_FEE_PCT[kind] + feeRoundTripPct(rate));
}
/* 기록용 — 신호 · 장부 파라미터 스냅샷에 그대로 넣는다 */
export function scalpCostSnapshot(kind, rate = RATE, source = SOURCE) {
  return { costModel: SCALP_COST_MODEL, feeRatePct: r6(rateOf(rate) * 100), feeSource: source,
           feeRoundTripPct: feeRoundTripPct(rate), nonFeePct: NON_FEE_PCT[kind], costPct: scalpCostPct(kind, rate) };
}
/* Worker · 다른 서버용 — Pages /api/common-fee 에서 율을 받는다(감시키). 실패하면 기본값 · 'default'.
   받은 값은 10분, 실패는 1분 둔다(실패가 오래 남지 않게) */
let CACHE = null;
export async function fetchCommonFee(base, key, { fetchImpl = fetch, now = Date.now(), timeoutMs = 5000, ttlMs = 600e3, failTtlMs = 60e3 } = {}) {
  if (CACHE && now - CACHE.at < (CACHE.v.error ? failTtlMs : ttlMs)) return CACHE.v;
  let v = { rate: FEE_DEFAULT, source: "default" };
  try {
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
    try {
      const r = await fetchImpl(String(base || "").replace(/\/$/, "") + "/api/common-fee",
        { headers: { "x-monitor-key": String(key || ""), accept: "application/json" }, ...(ac ? { signal: ac.signal } : {}) });
      const j = await r.json().catch(() => ({}));
      const x = r.ok && j && j.ok ? feeValid(j.rate) : null;
      if (x != null) v = { rate: x, source: String(j.source || "user") };
      else v = { rate: FEE_DEFAULT, source: "default", error: "HTTP " + r.status };
    } finally { if (t) clearTimeout(t); }
  } catch (e) { v = { rate: FEE_DEFAULT, source: "default", error: String((e && e.message) || e) }; }
  CACHE = { at: now, v };
  return v;
}
export function _resetScalpFeeForTest() { RATE = FEE_DEFAULT; SOURCE = "default"; CACHE = null; }
