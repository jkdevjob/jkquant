/* 소유자 공통 수수료 읽기 — 단타 연구 서버 함수용 (2026-11-19 사용자: "단타 연구 봇에도 공통 수수료 적용해")
   설정 › 💸 수수료가 저장한 users/{uid}.commonFee 를 서비스 계정(FIREBASE_SERVICE_ACCOUNT)으로 읽는다. 읽기만 한다.
   uid: AUTOTRADE_UID → 없으면 소유자 메일(OWNER_EMAIL 첫 번째 · _claude_auth.ownersOf)로 profiles 에서 찾는다(autotrade.js 와 같은 방법).
   commonFee 칸만 받는다(mask) — 운영 장부 등 다른 칸은 내려받지 않는다.
   결과는 5분 둔다. 서비스 계정이 없거나 실패하면 기본 0.25% · source 'default' 와 이유(error)를 돌려준다 — 화면 · 기록이 출처를 보인다. */
import { FEE_DEFAULT, FEE_FIELD, feeValid } from "./_fee.js";
import { ownersOf } from "./_claude_auth.js";
import { setScalpFee } from "./_scalp_cost.js";

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));
const FS = (pid, path) => `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${path}`;

async function saToken(sa, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const head = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" })), body = b64urlStr(JSON.stringify(claim));
  const pem = String(sa.private_key || "").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body));
  const r = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + body + "." + b64url(sig) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("구글 토큰 발급 실패: " + (j.error_description || j.error || r.status));
  return j.access_token;
}
async function ownerUid(tok, pid, email, fetchImpl) {
  const r = await fetchImpl(FS(pid, "profiles") + "?pageSize=300", { headers: { authorization: "Bearer " + tok } });
  const j = await r.json().catch(() => ({}));
  for (const d of (j.documents || [])) {
    const e = d.fields && d.fields.email && d.fields.email.stringValue;
    if (e && e.toLowerCase() === String(email || "").toLowerCase()) return d.name.split("/").pop();
  }
  return null;
}
/* Firestore 타입 값 → 숫자 (commonFee.rate 만) */
export function rateFromFields(fields) {
  const m = fields && fields[FEE_FIELD] && fields[FEE_FIELD].mapValue && fields[FEE_FIELD].mapValue.fields;
  const v = m && m.rate;
  if (!v) return { rate: null, updated: null };
  const n = "doubleValue" in v ? +v.doubleValue : "integerValue" in v ? +v.integerValue : null;
  const u = m.updated ? ("integerValue" in m.updated ? +m.updated.integerValue : "doubleValue" in m.updated ? +m.updated.doubleValue : null) : null;
  return { rate: feeValid(n), updated: u };
}

let CACHE = null;
/* 요청마다 제한 시간(기본 3초) — 구글이 늦어도 연구 함수가 멈추지 않고 기본값으로 간다 */
function withTimeout(fetchImpl, ms) {
  return async (u, o = {}) => {
    if (typeof AbortController !== "function") return fetchImpl(u, o);
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
    try { return await fetchImpl(u, { ...o, signal: ac.signal }); } finally { clearTimeout(t); }
  };
}
export async function ownerFeeRate(env, { fetchImpl = fetch, now = Date.now(), ttlMs = 300e3, failTtlMs = 60e3, timeoutMs = 3000 } = {}) {
  if (CACHE && now - CACHE.at < (CACHE.v.error ? failTtlMs : ttlMs)) return CACHE.v;
  fetchImpl = withTimeout(fetchImpl, timeoutMs);
  let v;
  try {
    let sa = {};
    try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || "{}"); } catch (e) { throw new Error("FIREBASE_SERVICE_ACCOUNT 가 JSON 이 아닙니다"); }
    if (!sa.client_email || !sa.private_key) throw new Error("FIREBASE_SERVICE_ACCOUNT 없음");
    const pid = sa.project_id || "jk-invest";
    const tok = await saToken(sa, fetchImpl);
    const uid = String(env.AUTOTRADE_UID || "").trim() || await ownerUid(tok, pid, ownersOf(env)[0], fetchImpl);
    if (!uid) throw new Error("소유자 uid 를 찾지 못했습니다");
    const r = await fetchImpl(FS(pid, "users/" + uid) + "?mask.fieldPaths=" + FEE_FIELD, { headers: { authorization: "Bearer " + tok } });
    if (r.status === 404) v = { rate: FEE_DEFAULT, source: "default", updated: null, note: "사용자 문서 없음" };
    else {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("사용자 문서 읽기 실패 " + r.status);
      const x = rateFromFields(j.fields || {});
      v = x.rate == null ? { rate: FEE_DEFAULT, source: "default", updated: null, note: "저장된 공통 수수료 없음 — 기본값" }
                         : { rate: x.rate, source: "user", updated: x.updated };
    }
  } catch (e) { v = { rate: FEE_DEFAULT, source: "default", updated: null, error: String((e && e.message) || e) }; }
  CACHE = { at: now, v };
  return v;
}
export function _resetOwnerFeeForTest() { CACHE = null; }
/* 진입점용 — 소유자 율을 읽어 단타 비용 모듈에 넣고 그 값을 돌려준다(응답 · 기록에 남길 것) */
export async function useOwnerFee(env, opts = {}) {
  const v = await ownerFeeRate(env, opts);
  setScalpFee(v.rate, v.source);
  return { rate: v.rate, pct: Math.round(v.rate * 1e8) / 1e6, source: v.source, ...(v.error ? { error: v.error } : {}) };
}
