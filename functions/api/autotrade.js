// Cloudflare Pages Function — /api/autotrade
//
// 앱을 열지 않아도 무한매수법 세션의 오늘 주문을 한투에 낸다.
// 브라우저가 켜져 있어야만 주문이 나가던 걸 서버가 대신한다.
//
// 흐름: 서비스 계정으로 Firestore에서 세션을 읽는다 → _im.js 로 오늘 주문을 계산한다
//       → /api/kis 로 주문을 낸다 → 결과를 Firestore(autotrade/{uid})에 남긴다.
//
// ── 필요한 환경변수 (Cloudflare Pages → 설정 → 환경 변수) ──
//   AUTOTRADE_KEY            : 이 엔드포인트를 부를 때 쓰는 비밀 문자열. 아무 문자열이나.
//                              깃허브 액션에도 같은 값을 Secret 으로 넣는다.
//   FIREBASE_SERVICE_ACCOUNT : Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 →
//                              '새 비공개 키 생성' 으로 받은 JSON 전체를 그대로 붙여넣는다.
//   AUTOTRADE_UID            : (선택) 대상 사용자 uid. 없으면 OWNER_EMAIL 로 profiles 에서 찾는다.
//   AUTOTRADE_ENABLE         : (선택) "0" 이면 계산만 하고 주문은 내지 않는다(드라이런).
//
// 안전 규약
//   · 주문은 절대 자동 재시도하지 않는다 — 응답이 유실되면 이중 주문이 된다.
//   · 같은 날 같은 세션에 두 번 내지 않는다 (autotrade/{uid} 의 lastRun 날짜로 막는다).
//   · 리버스모드 세션은 건너뛴다 — 규칙을 다 옮기지 않았다.
//   · 실계좌 세션(paper=false)은 KIS_ENV 가 real 이라 진짜 돈이 나간다. dry 로 먼저 확인할 것.

import { imOrders } from "./_im.js";

const JH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: JH });
const KRCODE = /^(?:\d{6}|\d{4}[A-Z]\d)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 서비스 계정으로 구글 액세스 토큰을 받는다 ──
   Workers 에는 Node 의 crypto 가 없다. WebCrypto 로 RS256 JWT 를 직접 서명한다. */
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

async function googleToken(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
  const head = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64urlStr(JSON.stringify(claim));
  // PEM → DER (pkcs8)
  const pem = String(sa.private_key || "").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + body));
  const jwt = head + "." + body + "." + b64url(sig);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("구글 토큰 발급 실패: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

/* ── Firestore REST — 타입 붙은 JSON 을 평범한 값으로 푼다 ── */
function unwrap(v) {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return +v.integerValue;
  if ("doubleValue" in v) return +v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unwrap);
  if ("mapValue" in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = unwrap(x); return o; }
  return null;
}
function wrap(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(wrap) } };
  const fields = {}; for (const [k, x] of Object.entries(v)) fields[k] = wrap(x);
  return { mapValue: { fields } };
}
const FS = (pid, path) => `https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${path}`;

async function fsGet(tok, pid, path) {
  const r = await fetch(FS(pid, path), { headers: { authorization: "Bearer " + tok } });
  if (r.status === 404) return null;
  const j = await r.json().catch(() => ({}));
  if (!j.fields) return null;
  const o = {}; for (const [k, x] of Object.entries(j.fields)) o[k] = unwrap(x);
  return o;
}
async function fsSet(tok, pid, path, obj) {
  const fields = {}; for (const [k, v] of Object.entries(obj)) fields[k] = wrap(v);
  await fetch(FS(pid, path), {
    method: "PATCH", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}
// OWNER_EMAIL 로 uid 를 찾는다 — 환경변수를 하나 덜 두려고 profiles 를 훑는다
async function findUid(tok, pid, email) {
  const r = await fetch(FS(pid, "profiles") + "?pageSize=300", { headers: { authorization: "Bearer " + tok } });
  const j = await r.json().catch(() => ({}));
  for (const d of (j.documents || [])) {
    const e = d.fields && d.fields.email && d.fields.email.stringValue;
    if (e && e.toLowerCase() === email.toLowerCase()) return d.name.split("/").pop();
  }
  return null;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // 아무나 주문을 낼 수 없게 막는다. 키는 쿼리나 헤더 어느 쪽으로 줘도 된다.
  const key = url.searchParams.get("key") || request.headers.get("x-autotrade-key") || "";
  if (!env.AUTOTRADE_KEY || key !== env.AUTOTRADE_KEY) return json({ error: "권한 없음" }, 401);
  // dry=1 이면 계산만 하고 주문은 내지 않는다. 환경변수로도 막을 수 있다.
  const dry = url.searchParams.get("dry") === "1" || String(env.AUTOTRADE_ENABLE || "") === "0";

  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || "{}"); }
  catch (e) { return json({ error: "FIREBASE_SERVICE_ACCOUNT 가 JSON 이 아닙니다" }, 400); }
  if (!sa.client_email || !sa.private_key) return json({ error: "FIREBASE_SERVICE_ACCOUNT 가 없습니다" }, 400);
  const pid = sa.project_id || "jk-invest";

  const out = { at: new Date().toISOString(), dry, sessions: [] };
  try {
    const tok = await googleToken(sa, "https://www.googleapis.com/auth/datastore");
    const uid = env.AUTOTRADE_UID || await findUid(tok, pid, String(env.OWNER_EMAIL || "").split(",")[0].trim());
    if (!uid) return json({ error: "대상 uid 를 찾지 못했습니다 — AUTOTRADE_UID 를 넣어 주세요" }, 400);
    out.uid = uid;

    const doc = await fsGet(tok, pid, "users/" + uid);
    const state = doc && doc.state;
    if (!state || !state.inf || !state.inf.sessions) return json({ ...out, error: "저장된 세션이 없습니다" }, 404);

    // 오늘 이미 돌았으면 다시 내지 않는다 — 이중 주문 방지
    const today = new Date().toISOString().slice(0, 10);
    const prev = await fsGet(tok, pid, "autotrade/" + uid);
    if (!dry && prev && prev.lastDate === today) return json({ ...out, skipped: "오늘 이미 실행했습니다", lastDate: today });

    for (const s of state.inf.sessions) {
      const row = { name: s.name, id: s.id, paper: !!s.paper };
      if (!s.kis) { row.skip = "한투 연결 꺼짐"; out.sessions.push(row); continue; }
      const st = s.settings || {};
      const sym = String(st.ticker || "").toUpperCase();
      row.ticker = sym;

      // 확정 종가 — 앱과 같은 시세 경로를 쓴다
      let close = 0, days = null;
      try {
        const q = await (await fetch(url.origin + "/api/quote?symbol=" + encodeURIComponent(sym) + "&intraday=0")).json();
        days = q.series || null;
        const oh = q.ohlc || [];
        close = oh.length ? +oh[oh.length - 1].close : 0;
      } catch (e) { row.skip = "시세 실패: " + (e.message || e); out.sessions.push(row); continue; }
      row.close = close;

      const { orders, skip } = imOrders({ st, hist: s.hist || [], close, days });
      if (skip) { row.skip = skip; out.sessions.push(row); continue; }
      row.orders = orders.map((o) => ({ ...o, price: Math.round(o.price * (KRCODE.test(sym) ? 1 : 100)) / (KRCODE.test(sym) ? 1 : 100) }));
      if (!orders.length) { row.skip = "낼 주문 없음"; out.sessions.push(row); continue; }
      if (dry) { row.sent = "드라이런 — 주문 안 냄"; out.sessions.push(row); continue; }

      // 세션 종류가 환경을 정한다 — 모의 세션은 모의계좌, 실계좌 세션은 실전계좌
      const kisEnv = s.paper ? "vts" : "real";
      row.env = kisEnv;
      row.results = [];
      for (let i = 0; i < row.orders.length; i++) {
        if (i) await sleep(700);                       // 모의투자 초당 2건 제한
        const o = row.orders[i];
        try {
          const r = await fetch(url.origin + "/api/kis?op=order&internal=1", {
            method: "POST",
            headers: { "content-type": "application/json", "x-autotrade-key": env.AUTOTRADE_KEY },
            body: JSON.stringify({ env: kisEnv, side: o.side, code: sym, qty: o.qty, price: o.price, priceType: "limit" }),
          });
          const j = await r.json().catch(() => ({}));
          row.results.push({ kind: o.kind, ok: !!j.ok, msg: j.msg || j.error || "응답 없음", orderNo: j.orderNo || "" });
        } catch (e) {
          // 재시도하지 않는다 — 응답이 유실된 경우 이미 접수됐을 수 있다
          row.results.push({ kind: o.kind, ok: false, msg: "전송 실패: " + (e.message || e) });
        }
      }
      out.sessions.push(row);
    }

    if (!dry) await fsSet(tok, pid, "autotrade/" + uid, { lastDate: today, lastRun: out.at, log: JSON.stringify(out.sessions).slice(0, 8000) });
    return json(out);
  } catch (e) {
    return json({ ...out, error: String(e.message || e) }, 500);
  }
}
