// Cloudflare Pages Function — GET /api/common-fee
// 공통 수수료(설정 › 💸 수수료 · users/{uid}.commonFee · 편도)를 단타 연구 봇(Worker · 밤 스크립트)에 알려 준다. 읽기 전용.
// 2026-11-19 사용자: "단타 연구 봇에도 공통 수수료 적용해". 값은 사용자 문서 한 곳 — 여기는 그 값을 옮겨 줄 뿐 따로 저장하지 않는다.
// 인증: 감시키(x-monitor-key — DAYTRADING_MONITOR_KEY · OPENING_MONITOR_KEY · AUTOTRADE_KEY 중 하나) 또는 소유자 로그인 토큰.
// 응답: {ok, rate(비율), pct, roundTripPct, source('user'|'default'), updated, error?, costModel, nonFeePct}.
import { claudeAuthorized } from "./_claude_auth.js";
import { ownerFeeRate } from "./_owner_fee.js";
import { SCALP_COST_MODEL, NON_FEE_PCT, feeRoundTripPct } from "./_scalp_cost.js";

const JH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: JH });

export function feeKeyOk(request, env) {
  const got = String(request.headers.get("x-monitor-key") || "");
  if (!got) return false;
  return [env.DAYTRADING_MONITOR_KEY, env.OPENING_MONITOR_KEY, env.AUTOTRADE_KEY]
    .map(k => String(k || "").trim()).filter(Boolean).some(k => k === got);
}
export async function commonFeeResponse(env, opts = {}) {
  const v = await ownerFeeRate(env, opts);
  return { ok: true, rate: v.rate, pct: Math.round(v.rate * 1e8) / 1e6, roundTripPct: feeRoundTripPct(v.rate), source: v.source,
           updated: v.updated == null ? null : v.updated, ...(v.error ? { error: v.error } : {}), ...(v.note ? { note: v.note } : {}),
           costModel: SCALP_COST_MODEL, nonFeePct: NON_FEE_PCT };
}
export async function onRequestGet({ request, env }) {
  if (!(feeKeyOk(request, env) || await claudeAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  return json(await commonFeeResponse(env));
}
