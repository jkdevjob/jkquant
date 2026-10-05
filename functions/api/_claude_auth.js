// 단타(클로드) 접근 판정 — 화면·자료 API 는 소유자만. 허용 목록은 /api/owner 와 같은 규약(OWNER_EMAIL, 없으면 관리자 계정).
// 서버끼리 부르는 경로(Worker·Telegram)는 감시키(x-monitor-key)로 통과한다. 허용 목록은 밖으로 내보내지 않는다.
import { verifyFirebaseToken } from "./_firebase_token.js";
const FIREBASE_API_KEY_FALLBACK = "AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";   // 공개 웹 키
const DEFAULT_OWNERS = ["jk82investing@gmail.com"];                          // owner.js 와 같은 규약

export function ownersOf(env) {
  const raw = String(env.OWNER_EMAIL || "").trim();
  return raw ? raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_OWNERS;
}
export function monitorKeyOk(request, env) {
  const want = String(env.OPENING_MONITOR_KEY || env.AUTOTRADE_KEY || "").trim();
  const got = request.headers.get("x-monitor-key") || "";
  return !!want && got === want;
}
export async function claudeAuthorized(request, env, lookup = null) {
  if (monitorKeyOk(request, env)) return true;
  const auth = request.headers.get("Authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) return false;
  try {
    const email = lookup ? await lookup(idToken) : await (async () => {
      const v = await verifyFirebaseToken(idToken);                         // 서버 안에서 서명 확인(빠름) — 공개키를 못 받을 때만 Google 에 묻는다
      if (v.ok) return v.email;
      if (!v.infra) return "";
      const key = env.FIREBASE_API_KEY || FIREBASE_API_KEY_FALLBACK;
      const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }) });
      const j = await r.json().catch(() => ({}));
      const u = j.users && j.users[0];
      return u ? String(u.email || "").toLowerCase() : "";
    })();
    return !!email && ownersOf(env).includes(String(email).toLowerCase());
  } catch (e) { return false; }
}
