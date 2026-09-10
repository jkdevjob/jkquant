// Cloudflare Pages Function — /api/owner
// "나만 보는" 화면(단타)의 접근 판정. 허용 목록은 절대 내보내지 않는다 —
// 로그인한 본인이 소유자인지(true/false)만 알려준다. (이메일 노출 방지)
//
//   OWNER_EMAIL : 허용 계정 = 이 앱에 구글 로그인하는 이메일(쉼표로 여러 개).
//                 한국투자증권 계정도, Cloudflare 계정도 아니다.
//   없으면 저장소 규약의 관리자 계정으로 폴백한다(잠김 방지).
//   주문 권한도 기본은 이 값을 그대로 쓴다 — kis.js orderOwners() 참고.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};
const FIREBASE_API_KEY_FALLBACK = "AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw"; // 공개 웹 키
const DEFAULT_OWNERS = ["jk82investing@gmail.com"];   // admin.html ADMIN_EMAILS 와 같은 규약

function resolveOwners(env) {
  // 화면 접근은 OWNER_EMAIL 만 본다. KIS_OWNER_EMAIL 은 '주문만 좁히는' 변수라 여기 끌어오지 않는다.
  const raw = String(env.OWNER_EMAIL || "").trim();
  if (raw) return { owners: raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean), source: "OWNER_EMAIL" };
  return { owners: DEFAULT_OWNERS, source: "default" };
}

export async function onRequestGet({ request, env }) {
  const { owners, source } = resolveOwners(env);
  const auth = request.headers.get("Authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  // 로그인 토큰이 없으면 판정 불가 — 목록은 알려주지 않는다
  if (!idToken) return new Response(JSON.stringify({ isOwner: false, source, needAuth: true }), { headers: JH });
  try {
    const key = env.FIREBASE_API_KEY || FIREBASE_API_KEY_FALLBACK;
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }),
    });
    const j = await r.json().catch(() => ({}));
    const u = j.users && j.users[0];
    const email = u ? String(u.email || "").toLowerCase() : "";
    if (!email) return new Response(JSON.stringify({ isOwner: false, source, error: "로그인 정보를 확인하지 못했습니다." }), { headers: JH });
    // email 은 '본인 것'이라 돌려줘도 된다(화면 안내용). 허용 목록은 끝까지 숨긴다.
    return new Response(JSON.stringify({ isOwner: owners.includes(email), email, source }), { headers: JH });
  } catch (e) {
    return new Response(JSON.stringify({ isOwner: false, source, error: String(e.message || e) }), { headers: JH });
  }
}
