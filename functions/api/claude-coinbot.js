// Cloudflare Pages Function — POST /api/claude-coinbot
// ③ 실투자 봇(사용자 고정 IP 서버 · bots/claude-coinbot)이 부른다. 주문을 만들지 않는다 — 기록과 알림만.
// 사용자 2026-11-13 "4는 직접 3은 자동으로" · "당연히 A로": 업비트 주문 키는 허용 IP 가 필요해 주문은 사용자 서버가 내고, 여기는
//  ① 실투자 체결 기록을 Worker 장부(claude:{업비트 하루})에 한 번만 쌓고(먼저 — 텔레그램 실패가 기록을 막지 않는다)
//  ② 처음 쌓인 기록이면 텔레그램([클로드 연구 비트코인] 머리말)을 보낸다.
// 인증은 봇 전용 키 하나(CLAUDE_COINBOT_KEY · 헤더 x-coinbot-key) — 감시키 · 소유자 권한을 서버 밖으로 내보내지 않는다.
// 이 키로 할 수 있는 것은 이 두 가지뿐이다(쌓기만 · 덮어쓰기 없음 · 정해진 머리말 글만).
//  op=report {id, date, payload, text, tg?}: 기록 + 알림. tg:false 면 알림 생략(앞 시도에서 이미 보냄).
//  op=event {text}: 알림만(봇 시작 · 주간 확인 · 설치 확인 · 오류).
import { realRecord, realText } from "./_claude_real.js";
import { sendOnce } from "./claude-telegram.js";
import { WORKER } from "./_claude_main.js";

const JH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: JH }); }
// 길이가 같을 때 글자를 모두 비교한다(앞 글자만 맞는지로 키를 알아내지 못하게)
export function coinbotKeyOk(request, env) {
  const want = String(env.CLAUDE_COINBOT_KEY || "").trim(), got = String(request.headers.get("x-coinbot-key") || "");
  if (want.length < 32 || got.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

export async function onRequestPost({ request, env }) {
  if (!coinbotKeyOk(request, env)) return json({ ok: false, definite: true, error: "unauthorized" }, 401);
  let b = {};
  try { b = await request.json(); } catch (e) { return json({ ok: false, definite: true, error: "JSON body 오류" }, 400); }
  const text = realText(b.text);
  if (!text) return json({ ok: false, definite: true, error: "text(머리말 [클로드 연구 비트코인] · 1500자 이하)" }, 400);
  if (b.op === "event") {
    const t = await sendOnce(env, text);
    return json({ ok: t.ok, telegram: t.ok ? "sent" : "fail", definite: !t.ok && !!t.definite }, t.ok ? 200 : 502);
  }
  if (b.op !== "report") return json({ ok: false, definite: true, error: "op(report|event)" }, 400);
  const v = realRecord(b);
  if (!v.ok) return json({ ...v, definite: true }, 400);
  const key = String(env.OPENING_MONITOR_KEY || env.AUTOTRADE_KEY || "").trim();
  let recorded = false, fresh = false, error = "";
  try {
    const r = await fetch(WORKER + "/claude-real", { method: "POST", headers: { "content-type": "application/json", "x-monitor-key": key },
      body: JSON.stringify({ id: v.id, date: v.date, payload: v.payload }) });
    const j = await r.json().catch(() => ({}));
    recorded = r.ok && !!j.ok; fresh = recorded && !!j.fresh; error = recorded ? "" : String(j.error || ("HTTP " + r.status));
  } catch (e) { error = String(e.message || e); }
  // 처음 쌓였거나(fresh) 장부가 안 받았으면(봇이 나중에 다시 보낸다) 알린다 — 이미 있던 기록이면 같은 알림을 되풀이하지 않는다
  let telegram = "skipped";
  if (b.tg !== false && (fresh || !recorded)) { const t = await sendOnce(env, text); telegram = t.ok ? "sent" : "fail"; }
  return json({ ok: recorded, recorded, fresh, telegram, ...(error ? { error } : {}) }, recorded ? 200 : 502);
}
