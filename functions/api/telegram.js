// Cloudflare Pages Function — /api/telegram
// 단타 시초가 신호를 Telegram Bot API로 전송한다.
// TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID 는 Cloudflare Secret/환경변수에만 둔다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const FIREBASE_API_KEY_FALLBACK = "AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS = ["jk82investing@gmail.com"];

function owners(env) {
  const raw = String(env.OWNER_EMAIL || "").trim();
  return raw
    ? raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_OWNERS;
}

async function ownerFromRequest(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) return { ok: false, status: 401, error: "로그인이 필요합니다." };

  try {
    const key = env.FIREBASE_API_KEY || FIREBASE_API_KEY_FALLBACK;
    const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    const j = await r.json().catch(() => ({}));
    const u = j.users && j.users[0];
    const email = u ? String(u.email || "").toLowerCase() : "";
    if (!email) return { ok: false, status: 401, error: "로그인 정보를 확인하지 못했습니다." };
    if (!owners(env).includes(email)) return { ok: false, status: 403, error: "소유자 계정만 사용할 수 있습니다." };
    return { ok: true, email };
  } catch (e) {
    return { ok: false, status: 500, error: "로그인 확인 중 오류가 발생했습니다." };
  }
}

function configured(env) {
  return !!(String(env.TELEGRAM_BOT_TOKEN || "").trim() && String(env.TELEGRAM_CHAT_ID || "").trim());
}

export async function onRequestGet({ request, env }) {
  const own = await ownerFromRequest(request, env);
  if (!own.ok) return new Response(JSON.stringify({ ok: false, error: own.error }), { status: own.status, headers: JH });
  return new Response(JSON.stringify({ ok: true, configured: configured(env) }), { headers: JH });
}

export async function onRequestPost({ request, env }) {
  const own = await ownerFromRequest(request, env);
  if (!own.ok) return new Response(JSON.stringify({ ok: false, error: own.error }), { status: own.status, headers: JH });

  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!token || !chatId) {
    return new Response(JSON.stringify({ ok: false, configured: false, error: "Telegram 환경변수가 설정되지 않았습니다." }), { status: 503, headers: JH });
  }

  let body = {};
  try { body = await request.json(); } catch (_) {}
  const title = String(body.title || "JK 퀀트 알림").slice(0, 120);
  const text = String(body.body || "").slice(0, 3000);
  const msg = text ? "🔥 " + title + "\n\n" + text : "🔥 " + title;

  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        disable_web_page_preview: true,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) {
      return new Response(JSON.stringify({ ok: false, configured: true, error: "Telegram 전송에 실패했습니다." }), { status: 502, headers: JH });
    }
    return new Response(JSON.stringify({ ok: true, configured: true }), { headers: JH });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, configured: true, error: "Telegram 연결 중 오류가 발생했습니다." }), { status: 502, headers: JH });
  }
}
