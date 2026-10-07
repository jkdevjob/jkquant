// 단타(클로드) 매수·매도 웹 알림 켜기/끄기 — 소유자만. 구독 정보는 Worker(Durable Object)에만 둔다(감시키로 전달).
import { claudeAuthorized } from "./_claude_auth.js";
import { WORKER } from "./_claude_main.js";
const JH = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: JH });
async function worker(env, op, body) {
  const key = String(env.OPENING_MONITOR_KEY || env.AUTOTRADE_KEY || "").trim();
  if (!key) return { ok: false, error: "감시키 없음" };
  const r = await fetch(WORKER + "/push-" + op, body ? { method: "POST", headers: { "content-type": "application/json", "x-monitor-key": key }, body: JSON.stringify(body) }
    : { headers: { "x-monitor-key": key } });
  return r.json().catch(() => ({ ok: false, error: "HTTP " + r.status }));
}
export async function onRequestGet({ request, env }) {
  if (!(await claudeAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  return json(await worker(env, "key"));
}
export async function onRequestPost({ request, env }) {
  if (!(await claudeAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  const b = await request.json().catch(() => ({}));
  if (b.action === "subscribe") return json(await worker(env, "subscribe", { subscription: b.subscription, ua: request.headers.get("user-agent") || "" }));
  if (b.action === "unsubscribe") return json(await worker(env, "unsubscribe", { endpoint: b.endpoint }));
  if (b.action === "test") return json(await worker(env, "test", {}));
  return json({ ok: false, error: "action 오류" }, 400);
}
