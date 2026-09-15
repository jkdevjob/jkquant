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

import { imOrders, settledLast, staleDays, STALE_MAX_DAYS } from "./_im.js";

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

/* 주문 간격은 세션을 넘어서도 이어져야 한다. 예전엔 세션 안에서만 700ms 를 뒀고
   (for 문의 i 가 세션마다 0 부터 다시 시작한다) 세션이 바뀌는 순간은 간격이 0 이었다.
   게다가 주문 1건은 hashkey + order 로 API 를 두 번 부른다. 그래서 12건을 내던 날
   초당 4~6회가 나가 전부 "초당 요청 제한"에 걸렸다 — 한 건도 접수되지 않았다.
   한투 모의는 초당 2회다. 1건당 2회를 쓰므로 건당 1.2초를 둔다. */
const ORDER_GAP_MS = 1200;
let _lastOrderAt = 0;
async function paceOrder() {
  const wait = _lastOrderAt ? ORDER_GAP_MS - (Date.now() - _lastOrderAt) : 0;
  if (wait > 0) await sleep(wait);
  _lastOrderAt = Date.now();
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  // 아무나 주문을 낼 수 없게 막는다. 키는 쿼리나 헤더 어느 쪽으로 줘도 된다.
  const key = url.searchParams.get("key") || request.headers.get("x-autotrade-key") || "";
  if (!env.AUTOTRADE_KEY || key !== env.AUTOTRADE_KEY) return json({ error: "권한 없음" }, 401);
  // dry=1 이면 계산만 하고 주문은 내지 않는다. 환경변수로도 막을 수 있다.
  const dry = url.searchParams.get("dry") === "1" || String(env.AUTOTRADE_ENABLE || "") === "0";
  /* 미국 주문구분. 안 주면 지금까지와 같은 "00"(지정가)라서 평소 주문은 아무것도 달라지지 않는다.
     LOC 가 몇 번인지 알아보려고 손으로 돌릴 때만 ordDvsn=34 처럼 붙여 부른다.
     거절당하면 /api/kis 가 알아서 "00" 으로 한 번 떨어뜨리고, 무엇으로 나갔는지 기록에 남긴다. */
  const ordDvsn = ["31", "32", "33", "34"].includes(url.searchParams.get("ordDvsn") || "")
    ? url.searchParams.get("ordDvsn") : "00";

  let sa;
  try { sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT || "{}"); }
  catch (e) { return json({ error: "FIREBASE_SERVICE_ACCOUNT 가 JSON 이 아닙니다" }, 400); }
  if (!sa.client_email || !sa.private_key) return json({ error: "FIREBASE_SERVICE_ACCOUNT 가 없습니다" }, 400);
  const pid = sa.project_id || "jk-invest";

  const out = { at: new Date().toISOString(), dry, ordDvsn, sessions: [] };
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

      /* 확정 종가 — 앱과 같은 시세 경로, 같은 규약.
         마지막 봉을 그냥 쓰면 안 된다. 자동 주문은 마감 20분 전에 도는데
         그 시각 오늘 봉의 close 는 종가가 아니라 장중 현재가다. */
      let close = 0, days = null;
      try {
        const q = await (await fetch(url.origin + "/api/quote?symbol=" + encodeURIComponent(sym) + "&intraday=0")).json();
        days = q.series || null;
        const bar = settledLast(q.series || q.ohlc || [], st.cur);
        close = bar ? +bar.close : 0;
        row.closeDate = bar ? bar.date : null;
      } catch (e) { row.skip = "시세 실패: " + (e.message || e); out.sessions.push(row); continue; }
      row.close = close;
      /* 묵은 종가로는 주문하지 않는다. 시세사가 봉을 늦게 올리는 일이 실제로 있는데
         (야후가 9/14 봉을 마감 4시간 뒤에 올렸다) 사람이라면 이상한 걸 알아채지만
         자동 주문은 그대로 내버린다. 낡은 가격으로 낸 주문은 되돌릴 수가 없다. */
      const stale = staleDays(row.closeDate, st.cur);
      if (stale > STALE_MAX_DAYS) {
        row.skip = `종가가 ${stale}일 묵었습니다 (${row.closeDate}) — 시세가 안 올라와 건너뜁니다`;
        out.sessions.push(row); continue;
      }
      row.staleDays = stale;

      const { orders, skip } = imOrders({ st, hist: s.hist || [], close, days });
      if (skip) { row.skip = skip; out.sessions.push(row); continue; }
      row.orders = orders.map((o) => ({ ...o, price: Math.round(o.price * (KRCODE.test(sym) ? 1 : 100)) / (KRCODE.test(sym) ? 1 : 100) }));
      if (!orders.length) { row.skip = "낼 주문 없음"; out.sessions.push(row); continue; }
      if (dry) { row.sent = "드라이런 — 주문 안 냄"; out.sessions.push(row); continue; }

      // 세션 종류가 환경을 정한다 — 모의 세션은 모의계좌, 실계좌 세션은 실전계좌
      const kisEnv = s.paper ? "vts" : "real";
      row.env = kisEnv;
      /* 아직 어느 번호가 LOC 인지 모른다. 틀렸으면 MOC(장마감 시장가)로 나가서
         정한 값이 아니라 아무 값에나 체결된다. 모르는 번호는 모의계좌에서만 넣어 본다 —
         실계좌는 알아낸 뒤에 열어 준다. */
      /* 2026-09-15 실측: 모의계좌에 34 를 넣으니 한투가 이렇게 답했다 —
           "모의투자 주문처리가 안되었습니다(지정가만 가능한 상품입니다)" (40650000)
         모의는 지정가만 받는다. 그러니 모의에 34 를 보내는 건 거절이 확정된 요청을
         한 번 더 쏘는 것뿐이고, 그만큼 초당 제한만 잡아먹는다(실제로 그래서 그날
         주문이 전부 제한에 걸렸다). LOC 가 몇 번인지는 실계좌에서만 알 수 있다. */
      const dvsn = ordDvsn !== "00" ? "00" : ordDvsn;
      if (dvsn !== ordDvsn) row.dvsnNote = kisEnv === "vts"
        ? `모의는 지정가만 받습니다 — 주문구분 ${ordDvsn} 은 보내지 않고 지정가로 냅니다`
        : `주문구분 ${ordDvsn} 은 아직 실계좌에 보내지 않습니다 — 지정가로 냅니다`;
      row.ordDvsn = dvsn;
      row.results = [];
      for (let i = 0; i < row.orders.length; i++) {
        await paceOrder();                             // 세션이 바뀌어도 간격은 이어진다
        const o = row.orders[i];
        try {
          const r = await fetch(url.origin + "/api/kis?op=order&internal=1", {
            method: "POST",
            headers: { "content-type": "application/json", "x-autotrade-key": env.AUTOTRADE_KEY },
            body: JSON.stringify({ env: kisEnv, side: o.side, code: sym, qty: o.qty, price: o.price, priceType: "limit", ordDvsn: dvsn }),
          });
          const j = await r.json().catch(() => ({}));
          row.results.push({ kind: o.kind, ok: !!j.ok, msg: j.msg || j.error || "응답 없음", orderNo: j.orderNo || "",
            ordDvsn: j.ordDvsn || "", fellBack: !!j.fellBack, firstTry: j.firstTry || null });
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
