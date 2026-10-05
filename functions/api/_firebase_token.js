// Firebase 로그인 토큰(ID token)을 서버 안에서 직접 검증한다 — 매 요청마다 Google(identitytoolkit)에 묻지 않는다.
// 2026-10-05: 단타 두 화면 로그인이 '권한 확인 응답 없음(8초)'으로 막힘 → 요청마다 바깥 API 를 부르던 길을 없앤다.
// 검증: RS256 서명(Google 공개키 JWK, 캐시) · aud = 프로젝트 · iss = securetoken · exp/iat · sub. 이메일은 토큰 안의 email.
// 결과: {ok:true,email,uid} · {ok:false,reason}(토큰이 틀림 — 거절) · {ok:false,infra:true,reason}(공개키를 못 받음 — 부르는 쪽이 예전 방식으로 확인)
export const PROJECT_ID = "jk-invest";
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let MEM = { keys: null, exp: 0 };

export function _setKeysForTest(keys, ttlMs = 3600e3) { MEM = { keys, exp: Date.now() + ttlMs }; }

function b64urlBytes(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJson(s) { return JSON.parse(new TextDecoder().decode(b64urlBytes(s))); }

async function googleKeys(timeoutMs) {
  if (MEM.keys && Date.now() < MEM.exp) return MEM.keys;
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(JWK_URL, { signal: ac.signal, cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!r.ok) throw new Error("JWK HTTP " + r.status);
    const j = await r.json();
    const m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
    MEM = { keys: j.keys || [], exp: Date.now() + Math.min(6 * 3600, m ? +m[1] : 3600) * 1000 };
    return MEM.keys;
  } finally { clearTimeout(t); }
}

export async function verifyFirebaseToken(idToken, { projectId = PROJECT_ID, nowSec = Math.floor(Date.now() / 1000), timeoutMs = 3000 } = {}) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "형식 오류" };
  let h, p;
  try { h = b64urlJson(parts[0]); p = b64urlJson(parts[1]); } catch (e) { return { ok: false, reason: "형식 오류" }; }
  if (h.alg !== "RS256" || !h.kid) return { ok: false, reason: "알고리즘 오류" };
  if (p.aud !== projectId || p.iss !== "https://securetoken.google.com/" + projectId) return { ok: false, reason: "다른 프로젝트 토큰" };
  if (!(p.exp > nowSec) || !(p.iat <= nowSec + 300) || !(p.auth_time <= nowSec + 300) || !p.sub) return { ok: false, reason: "만료/시간 오류" };
  let keys;
  try { keys = await googleKeys(timeoutMs); } catch (e) { return { ok: false, infra: true, reason: "공개키 못 받음: " + String(e.message || e) }; }
  const jwk = (keys || []).find(k => k.kid === h.kid);
  if (!jwk) return { ok: false, reason: "모르는 키" };
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
    if (!ok) return { ok: false, reason: "서명 불일치" };
  } catch (e) { return { ok: false, reason: "서명 확인 오류" }; }
  const email = String(p.email || "").toLowerCase();
  if (!email || p.email_verified === false) return { ok: false, reason: "이메일 없음" };
  return { ok: true, email, uid: p.sub };
}
