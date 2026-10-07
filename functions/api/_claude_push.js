// 단타(클로드) 매수 · 매도 웹 알림 — 무엇을 언제 알릴지(순수 함수)와 웹 푸시 암호화(표준 RFC 8291 · VAPID RFC 8292).
// 판단 원본은 실시간 화면과 같은 /api/claude-live 응답 하나다(같은 걸 두 군데서 세지 않는다). Worker 가 5분마다 그 응답을 읽어
// 새로 생긴 매수 · 매도만 알림으로 보낸다. 알림 id 는 날짜 · 전략 · 종목 · 매수/매도로 만들어 같은 알림을 두 번 보내지 않는다.
// 알림이 실패해도 주문 · 장부에는 영향이 없다(주문 경로와 따로 돈다).

const KR_PCT = v => (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%";
const won = v => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US"));
export function kstDateOf(ms) { return new Date(ms + 9 * 36e5).toISOString().slice(0, 10); }
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

// live: /api/claude-live 응답 · nowMs: 지금 · sent: 이미 보낸 알림 {id: {at, price}} (③ 다음 날 09:00 매도 알림에 쓴다)
// 돌려주는 것: [{id, title, body, tag, url, price?}]
export function pushEvents(live, nowMs, sent = {}) {
  const T = (live && live.tabs) || {}, d = (live && live.today) || kstDateOf(nowMs), out = [];
  const add = (id, title, body, price) => out.push({ id, title, body, tag: id.split(":").slice(0, 2).join(":"), url: "/claude", price: price ?? null });
  // ① 시초가 — 08:56 판단 · 08:59 장전 동시호가 매수 / 15:20 종가 동시호가 매도
  const o = (T.opening && T.opening.rows) || [];
  const ob = o.filter(r => r.status && r.status !== "주문 실패");
  if (ob.length) add("open:" + d + ":buy", "🟢 ① 시초가 매수", ob.map(r => r.name + (r.expectedGapPct != null ? " (갭 " + KR_PCT(r.expectedGapPct) + ")" : "")).join(" · ")
    + " — 08:59 동시호가" + (o.length > ob.length ? " · 주문 실패 " + (o.length - ob.length) + "종목" : ""));
  const os = o.filter(r => r.realized && r.pnlPct != null);
  if (os.length) add("open:" + d + ":sell", "🔴 ① 시초가 매도", os.map(r => r.name + " " + KR_PCT(r.pnlPct)).join(" · ")
    + " · 평균 " + KR_PCT(os.reduce((a, r) => a + r.pnlPct, 0) / os.length));
  // ② 데이트레이딩 — 15:21 종가 매수 / 다음 거래일 08:56 시가 매도
  for (const r of (T.daytrading && T.daytrading.rows) || []) {
    if (/^오늘 15:30/.test(r.buyTime || "") && r.status === "보유중(오버나잇)")
      add("etf:" + d + ":buy", "🟢 ② 데이트레이딩 매수", r.name + " 종가 매수" + (r.dropPct != null ? " (오늘 " + KR_PCT(r.dropPct) + ")" : "") + " → 다음 거래일 시가 매도");
    if (/^오늘 09:00/.test(r.sellTime || "") && (r.status === "매도 접수" || r.status === "청산"))
      add("etf:" + d + ":sell", "🔴 ② 데이트레이딩 매도", r.name + " 시가 매도" + (r.realized && r.pnlPct != null ? " " + KR_PCT(r.pnlPct) : " 접수"));
  }
  // ③ 비트코인 — 업비트 하루(09:00 시작) 돌파 매수 · 손절 / 다음 날 09:00 매도
  const ud = kstDateOf(nowMs - 9 * 36e5), pud = addDays(ud, -1);
  const coins = (T.crypto && T.crypto.rows) || [];
  for (const r of coins) {
    const m = String(r.code || ""), nm = m.replace("KRW-", "");
    if (r.hold && r.buyTime) add("coin:" + ud + ":" + m + ":buy", "🟢 ③ " + nm + " 돌파 매수", nm + " " + r.buyTime + " " + won(r.buyPrice) + "원 매수 → 다음 날 09:00 매도", r.buyPrice);
    if (r.stopped) add("coin:" + ud + ":" + m + ":stop", "🔴 ③ " + nm + " 손절", nm + " 손절 " + won(r.stopPrice) + "원" + (r.pnlPct != null ? " " + KR_PCT(r.pnlPct) : ""));
  }
  for (const id of Object.keys(sent || {})) {                    // 어제 하루에 산 코인은 오늘 09:00 에 판다(손절된 것은 빼고)
    const mm = /^coin:(\d{4}-\d{2}-\d{2}):(KRW-[A-Z]+):buy$/.exec(id);
    if (!mm || mm[1] !== pud || sent["coin:" + pud + ":" + mm[2] + ":stop"]) continue;
    const nm = mm[2].replace("KRW-", ""), bp = +(sent[id] && sent[id].price), now = (coins.find(r => r.code === mm[2]) || {}).nowPrice;
    add("coin:" + pud + ":" + mm[2] + ":sell", "🔴 ③ " + nm + " 매도", nm + " 09:00 매도(어제 돌파분)" + (bp > 0 && now > 0 ? " 약 " + KR_PCT((now / bp - 1) * 100 - 0.14) : ""));
  }
  // ④ SOXL — 미국장 시가 매수 · 매도(전날 밤 마감 종가로 판단)
  const s = ((T.soxl && T.soxl.rows) || [])[0];
  if (s && /^보유중 \(시가 매수\)/.test(s.status || "")) add("soxl:" + String(s.buyTime || "").slice(0, 10) + ":buy", "🟢 ④ SOXL 매수", "SOXL 시가 매수 $" + Number(s.buyPrice).toFixed(2) + " → 오른 날 다음 시가 매도");
  if (s && /^청산 \(시가 매도\)/.test(s.status || "")) add("soxl:" + String(s.sellTime || "").slice(0, 10) + ":sell", "🔴 ④ SOXL 매도", "SOXL 시가 매도 $" + Number(s.sellPrice).toFixed(2) + (s.pnlPct != null ? " " + KR_PCT(s.pnlPct) : ""));
  return out;
}

// ── 웹 푸시 암호화 · 서명 (WebCrypto 만 — Worker · 브라우저 · Node 공통) ──
const te = new TextEncoder();
export function b64u(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s) {
  s = String(s || "").replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}
const cat = (...a) => { const n = a.reduce((x, y) => x + y.length, 0), o = new Uint8Array(n); let k = 0; for (const x of a) { o.set(x, k); k += x.length; } return o; };
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
const hkdf = async (salt, ikm, info, len) => (await hmac(await hmac(salt, ikm), cat(info, new Uint8Array([1])))).slice(0, len);

// RFC 8291 aes128gcm — sub: {keys:{p256dh, auth}}. test: {salt, asKeys} 를 넘기면 그 값으로(시험용 고정).
export async function encryptPayload(sub, payload, test = {}) {
  const ua = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = test.asKeys || await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode("WebPush: info\0"), ua, asPub), 32);
  const salt = test.salt || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, cat(te.encode(payload), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = asPub.length;
  return cat(head, asPub, ct);
}

// VAPID(RFC 8292) — jwk: ECDSA P-256 개인키 JWK(d,x,y). 돌려주는 값: Authorization 헤더 값
export async function vapidAuth(endpoint, jwk, nowSec = Math.floor(Date.now() / 1000), subject = "https://jkquant.pages.dev") {
  const aud = new URL(endpoint).origin;
  const h = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = b64u(te.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(h + "." + p)));
  const pub = cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y));
  return "vapid t=" + h + "." + p + "." + b64u(sig) + ", k=" + b64u(pub);
}
export function vapidPublic(jwk) { return b64u(cat(new Uint8Array([4]), unb64u(jwk.x), unb64u(jwk.y))); }

// 한 구독에 한 알림 보내기 — {ok, status, gone}(gone = 구독이 사라짐 → 지운다)
export async function sendPush(sub, msg, jwk, fetchImpl = fetch) {
  const body = await encryptPayload(sub, JSON.stringify(msg));
  const r = await fetchImpl(sub.endpoint, { method: "POST", body, headers: {
    Authorization: await vapidAuth(sub.endpoint, jwk), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" } });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
}
