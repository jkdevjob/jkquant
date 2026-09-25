// Cloudflare Pages Function — /api/kis
// 한국투자증권(KIS) OpenAPI 프록시. 브라우저는 KIS를 직접 못 부른다(CORS·시크릿 노출).
// 시크릿은 Cloudflare Pages 환경변수로만 둔다. 주문은 Firebase 로그인(소유자)만 허용한다.
//
// ── 필요한 환경변수 (Cloudflare Pages → 설정 → 환경 변수) ──
//   ── 환경별로 따로 둔다 (실전과 모의는 앱키·계좌·도메인이 전부 다르다) ──
//   KIS_VTS_APPKEY  / KIS_VTS_APPSECRET  : 모의투자용 앱키
//   KIS_REAL_APPKEY / KIS_REAL_APPSECRET : 실전용 앱키
//   ※ 이름을 뒤에 붙여도 읽는다 — KIS_APPKEY_REAL 처럼 써도 같다.
//   ── 계좌번호는 시장별로도 갈릴 수 있다 ──
//   한투 모의투자는 국내주식 모의계좌와 해외주식 모의계좌를 각각 신청한다.
//   앱키는 같은데 계좌번호만 다른 경우가 실제로 있어서, 시장 전용 값을 먼저 본다.
//   KIS_VTS_ACCOUNT_KR / KIS_VTS_ACCOUNT_US    : 있으면 이걸 쓴다
//   KIS_VTS_ACCOUNT                            : 없으면 환경 공통으로 내려간다
//   KIS_REAL_ACCOUNT_KR / KIS_REAL_ACCOUNT_US / KIS_REAL_ACCOUNT : 실전도 같은 규칙
//   ── 예전 방식(하나만 쓸 때) — KIS_ENV 가 가리키는 환경의 값으로 취급한다 ──
//   KIS_APPKEY        : KIS 개발자센터에서 발급한 appkey
//   KIS_APPSECRET     : appsecret
//   KIS_ACCOUNT       : 계좌번호 "12345678-01" (앞 8자리-상품 2자리)
//   KIS_ENV           : "vts"(모의투자·기본) 또는 "real"(실전) — 요청에 env가 없을 때의 기본값
//   OWNER_EMAIL       : 이 앱에 구글 로그인하는 "주인" 계정(쉼표로 여러 개).
//                       단타 화면 노출·진단·주문이 전부 이걸 본다. 보통 이 하나만 있으면 된다.
//   KIS_OWNER_EMAIL   : (선택) 주문만 더 좁게 제한하고 싶을 때. 없으면 OWNER_EMAIL 을 그대로 쓴다.
//   ※ 둘 다 KIS 계정이나 Cloudflare 계정이 아니라 "구글 로그인 이메일"이다.
//   FIREBASE_API_KEY  : (선택) 없으면 아래 상수 사용
//
// 지원: op=config(상태) · op=diag(자가진단) · op=approval(웹소켓키) · op=price · op=balance · POST op=order
//
// ── 네 갈래 = 환경(실전·모의) × 시장(국내·해외) ──
//   환경은 요청의 env=vts|real 로 고른다(없으면 KIS_ENV). 키·계좌·도메인이 여기서 갈린다.
//   시장은 고를 필요가 없다 — code 가 6자리면 국내, 영문 티커면 해외로 알아서 간다.
//   그래서 kr-vts · kr-real · us-vts · us-real 네 조합이 모두 열린다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};
const FIREBASE_API_KEY_FALLBACK = "AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw"; // 공개 웹 키
const KRCODE = /^(?:\d{6}|\d{4}[A-Z]\d)$/;
// 미국 티커. 국내 6자리와 겹치지 않으므로 code 하나로 국내/해외를 가른다.
const USSYM = /^[A-Z]{1,5}$/;
/* 같은 거래소인데 시세와 주문이 쓰는 코드가 다르다 — KIS 문서가 그렇게 돼 있다.
   SOXL·TECL은 NYSE Arca 상장인데 KIS에서는 AMEX(AMS)로 잡힌다.
   종목마다 어디인지 외우지 않고, 시세가 나오는 거래소를 찾아 그걸 주문에도 쓴다. */
const EXCD_TRY = ["NAS", "AMS", "NYS"];
const EXCD_ORD = { NAS: "NASD", AMS: "AMEX", NYS: "NYSE" };

const base = (env) => (String(env.KIS_ENV || "vts").toLowerCase() === "real"
  ? "https://openapi.koreainvestment.com:9443"
  : "https://openapivts.koreainvestment.com:29443");
const isReal = (env) => String(env.KIS_ENV || "vts").toLowerCase() === "real";

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: JH }); }

/* 요청이 고른 환경의 자격증명으로 env 를 갈아끼운다.
   base()·acct()·isReal()·getToken() 이 전부 env 를 읽으므로, 여기서 한 번 바꿔 주면
   아래 코드는 손대지 않아도 된다. 토큰 캐시도 base(env) 로 키를 잡아 환경별로 갈린다. */
const HOST = { vts: "https://openapivts.koreainvestment.com:29443", real: "https://openapi.koreainvestment.com:9443" };
function wantEnv(v, env) {
  const w = String(v || "").toLowerCase();
  if (w === "real" || w === "vts") return w;
  return String(env.KIS_ENV || "vts").toLowerCase() === "real" ? "real" : "vts";
}
/* 앱키·시크릿은 환경(실전·모의)으로 갈리고, 계좌번호는 시장으로도 갈릴 수 있다.
   한투 모의투자는 국내주식 모의계좌와 해외주식 모의계좌를 각각 신청하기 때문에
   같은 앱키를 쓰면서 계좌번호만 다른 경우가 실제로 있다.
   그래서 계좌는 시장별 값을 먼저 보고, 없으면 환경 공통 값으로 내려간다. */
/* 이름을 앞에 붙이든 뒤에 붙이든 받는다 — KIS_REAL_APPKEY 와 KIS_APPKEY_REAL 둘 다.
   사람이 손으로 넣는 값이라 어느 쪽으로 적었는지로 안 되는 건 버그다. */
const pickVar = (env, names) => { for (const n of names) if (env[n]) return env[n]; return ""; };
function withEnv(env, want, market) {
  const w = wantEnv(want, env);
  const W = w.toUpperCase();                               // VTS | REAL
  const mk = market === "us" || market === "kr" ? market : "";
  const MK = mk.toUpperCase();                             // KR | US | ''
  // 예전처럼 키를 하나만 둔 경우 — KIS_ENV 가 가리키는 환경에서만 그 값을 쓴다.
  // 그래야 모의 키로 실전 주문이 나가는 사고가 안 난다.
  const legacy = String(env.KIS_ENV || "vts").toLowerCase() === "real" ? "real" : "vts";
  const fb = (k) => (legacy === w ? env[k] || "" : "");
  const two = (f) => [`KIS_${W}_${f}`, `KIS_${f}_${W}`];   // 앞 / 뒤
  const acctNames = [
    ...(MK ? [`KIS_${W}_ACCOUNT_${MK}`, `KIS_ACCOUNT_${W}_${MK}`, `KIS_ACCOUNT_${MK}_${W}`,
              `KIS_${MK}_ACCOUNT_${W}`] : []),            // 시장 전용이 먼저
    ...two("ACCOUNT"),                                     // 환경 공통
  ];
  return Object.assign({}, env, {
    KIS_APPKEY: pickVar(env, two("APPKEY")) || fb("KIS_APPKEY"),
    KIS_APPSECRET: pickVar(env, two("APPSECRET")) || fb("KIS_APPSECRET"),
    KIS_ACCOUNT: pickVar(env, acctNames) || fb("KIS_ACCOUNT"),
    KIS_ENV: w,
    KIS_MARKET: mk,
  });
}
/* 네 갈래의 준비 상태. 계좌가 시장별로 갈릴 수 있으므로 네 개를 각각 따져야 한다 —
   환경 단위로만 보면 '국내는 되는데 국외는 계좌가 없는' 경우를 놓친다. */
function modeList(env) {
  const out = [];
  for (const m of ["vts", "real"]) {
    for (const [mk, label] of [["kr", "국내"], ["us", "국외"]]) {
      const e = withEnv(env, m, mk);
      out.push({ id: mk + "-" + m, market: mk, env: m,
        label: label + (m === "vts" ? " 모의투자" : " 실전투자"),
        ready: configured(e),
        // 어디가 비었는지 알아야 고칠 수 있다 (값은 담지 않는다)
        missing: ["APPKEY", "APPSECRET", "ACCOUNT"].filter((k) => !e["KIS_" + k]).map((k) => {
          const W = m.toUpperCase();
          // 앞뒤 어느 쪽으로 넣어도 읽으므로 둘 다 적어 준다
          return `KIS_${W}_${k}` + (k === "ACCOUNT" ? `(_${mk.toUpperCase()})` : "") + ` 또는 KIS_${k}_${W}`;
        }),
      });
    }
  }
  return out;
}
function configured(env) { return !!(env.KIS_APPKEY && env.KIS_APPSECRET && env.KIS_ACCOUNT); }
function acct(env) {
  const a = String(env.KIS_ACCOUNT || "").replace(/\s/g, "");
  const m = a.match(/^(\d{8})-?(\d{2})$/);
  return m ? { cano: m[1], prod: m[2] } : null;
}

// ── 초당 요청 제한(rate limit) 대응 ──
// KIS 모의투자는 초당 2건, 실전도 20건으로 막혀 있다. 연달아 쏘면 EGW00201 로 거절된다.
// 거절은 "요청이 아예 접수되지 않았다"는 뜻이라 되쏘는 게 안전하다(주문 제외 — 아래 주석 참고).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE_LIMITED = (j) => /EGW00201|초당\s*거래건수/i.test(JSON.stringify(j || {}));

// 읽기 호출 전용. 제한에 걸리면 간격을 벌려가며 다시 시도한다.
async function readJson(url, init, tries = 3) {
  let j = {};
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(400 * i);                 // 400ms → 800ms
    const r = await fetch(url, init);
    j = await r.json().catch(() => ({}));
    if (!RATE_LIMITED(j)) return j;
  }
  return j;
}

// ── 접근 토큰 ──
// KIS 는 토큰 발급을 1분에 1회로 막는다. 그런데 Cloudflare 는 요청마다 다른 인스턴스를
// 쓸 수 있어서 모듈 변수 캐시가 자주 비어 있다 — 그때마다 새로 발급하다 제한에 걸렸다.
// 그래서 인스턴스 밖(엣지 캐시)에도 둔다. 캐시 키는 라우팅되지 않는 내부 호스트라
// 바깥에서 이 URL 로 토큰을 꺼내갈 수는 없다.
let _tok = { at: 0, token: null, env: null };
const TOKKEY = (env) => "https://kis-token.internal/" + encodeURIComponent(base(env));
const TOK_TTL = 6 * 60 * 60;                                   // KIS 토큰 수명은 24시간 — 여유있게 6시간만 쓴다

async function getToken(env) {
  const now = Date.now();
  if (_tok.token && _tok.env === base(env) && now - _tok.at < TOK_TTL * 1000) return _tok.token;

  const cache = (typeof caches !== "undefined" && caches.default) || null;
  if (cache) {
    try {
      const hit = await cache.match(TOKKEY(env));
      if (hit) {
        const t = (await hit.text()).trim();
        if (t) { _tok = { at: now, token: t, env: base(env) }; return t; }
      }
    } catch (e) { /* 캐시는 있으면 좋은 것 — 없으면 그냥 발급한다 */ }
  }

  const r = await fetch(base(env) + "/oauth2/tokenP", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("KIS 토큰 발급 실패: " + (j.error_description || j.msg1 || r.status));
  _tok = { at: now, token: j.access_token, env: base(env) };
  if (cache) {
    try {
      await cache.put(TOKKEY(env), new Response(j.access_token, {
        headers: { "cache-control": "max-age=" + TOK_TTL, "content-type": "text/plain" } }));
    } catch (e) { /* 저장 실패해도 동작은 한다 */ }
  }
  return j.access_token;
}

async function hashkey(env, body) {
  const r = await fetch(base(env) + "/uapi/hashkey", {
    method: "POST",
    headers: { "content-type": "application/json", appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return j.HASH || "";
}

// ── 사이트 소유자 판정 ──
// 여기 나오는 이메일은 전부 "이 웹앱에 구글 로그인하는 계정"이다.
// 한국투자증권 계정도, Cloudflare 계정도 아니다. KIS 쪽 신원은 앱키·앱시크릿·계좌번호가 전담한다.
const DEFAULT_OWNERS = ["jk82investing@gmail.com"];
/* ── 해외(미국) 주식 ──
   시세·잔고·주문이 서로 다른 엔드포인트와 거래소 코드를 쓴다.
   여기서 한 번 감싸 두면 호출하는 쪽은 국내와 똑같이 code 하나만 넘기면 된다. */

// 시세가 나오는 거래소를 찾는다. 한 번 찾으면 주문·잔고에도 그 거래소를 쓴다.
async function usPrice(env, sym, excdHint) {
  const token = await getToken(env);
  const tries = excdHint ? [excdHint] : EXCD_TRY;
  let last = null;
  for (const excd of tries) {
    const qs = new URLSearchParams({ AUTH: "", EXCD: excd, SYMB: sym });
    const j = await readJson(base(env) + "/uapi/overseas-price/v1/quotations/price?" + qs, {
      headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET,
        tr_id: "HHDFS00000300", custtype: "P" },
    });
    last = j;
    const o = j.output || {};
    if (+o.last > 0) {
      return { ok: true, code: sym, excd, market: EXCD_ORD[excd], price: +o.last,
        open: +o.open || 0, high: +o.high || 0, low: +o.low || 0,
        chgRate: +o.rate || 0, volume: +o.tvol || 0, cur: "USD" };
    }
  }
  return { ok: false, error: RATE_LIMITED(last) ? "초당 요청 제한 — 잠시 후 다시"
    : ((last && last.msg1) || "해외 시세 조회 실패 — 티커나 거래소를 확인하세요"),
    rateLimited: RATE_LIMITED(last) };
}

// 해외 잔고는 거래소별로 따로 물어야 한다 — 세 곳을 합쳐서 준다.
/* 잔고 조회(3012R)에는 남은 돈이 없다. 예전엔 cash 에 frcr_pchs_amt1(외화'매입'금액 — 보유분을 산 돈)을,
   evalTotal 에 tot_evlu_pfls_amt(총평가'손익')를 넣어 이름과 뜻이 달랐다. 쓰는 화면이 없어 빼고,
   남은 돈은 매수가능금액조회(usBuyable)로 따로 받는다. 모의는 초당 2건이라 거래소 사이에 간격을 둔다. */
async function usBalance(env) {
  const a = acct(env); if (!a) return { error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" };
  const token = await getToken(env);
  const tr = isReal(env) ? "TTTS3012R" : "VTTS3012R";
  const holdings = []; const errs = [];
  for (const [i, excd] of ["NASD", "NYSE", "AMEX"].entries()) {
    if (i) await sleep(550);
    const qs = new URLSearchParams({ CANO: a.cano, ACNT_PRDT_CD: a.prod, OVRS_EXCG_CD: excd,
      TR_CRCY_CD: "USD", CTX_AREA_FK200: "", CTX_AREA_NK200: "" });
    const j = await readJson(base(env) + "/uapi/overseas-stock/v1/trading/inquire-balance?" + qs, {
      headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET,
        tr_id: tr, custtype: "P" },
    });
    if (String(j.rt_cd) !== "0") { if (j.msg1) errs.push(excd + ": " + j.msg1); continue; }
    (j.output1 || []).filter(x => +x.ovrs_cblc_qty > 0).forEach(x => holdings.push({
      code: x.ovrs_pdno, name: x.ovrs_item_name, market: excd,
      qty: +x.ovrs_cblc_qty, avg: +x.pchs_avg_pric, cur: +x.now_pric2, pl: +x.evlu_pfls_rt,
    }));
  }
  return { holdings, cur: "USD", errs: errs.length ? errs : undefined };
}

/* 해외 주문가능금액 — '이 계좌에 달러가 있나'. 매수가능금액조회(모의 VTTS3007R · 실전 TTTS3007R)는
   종목 · 가격을 받아 그 값으로 얼마까지 살 수 있는지 준다. 통합증거금을 안 쓰면 ovrs_ord_psbl_amt
   (해외주문가능금액), 쓰면 frcr_ord_psbl_amt1(외화주문가능금액1)이 맞는 값이라 둘 다 넘긴다.
   읽기만 한다 — 주문 엔드포인트는 부르지 않는다. */
async function usBuyable(env, code, price, excd) {
  const a = acct(env); if (!a) return { error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" };
  const token = await getToken(env);
  const qs = new URLSearchParams({ CANO: a.cano, ACNT_PRDT_CD: a.prod, OVRS_EXCG_CD: excd,
    OVRS_ORD_UNPR: (+price).toFixed(2), ITEM_CD: code });
  const j = await readJson(base(env) + "/uapi/overseas-stock/v1/trading/inquire-psamount?" + qs, {
    headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET,
      tr_id: isReal(env) ? "TTTS3007R" : "VTTS3007R", custtype: "P" },
  });
  if (String(j.rt_cd) !== "0") return { error: RATE_LIMITED(j) ? "초당 요청 제한 — 잠시 후 다시" : (j.msg1 || "주문가능금액 조회 실패") };
  const o = j.output || {};
  return { code, price: +price, excd, amt: +o.ovrs_ord_psbl_amt || 0, frcrAmt1: +o.frcr_ord_psbl_amt1 || 0,
    maxQty: +o.max_ord_psbl_qty || +o.ovrs_max_ord_psbl_qty || 0, exrt: +o.exrt || 0 };
}

function parseEmails(raw) {
  return String(raw || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
function siteOwners(env) {
  const raw = parseEmails(env.OWNER_EMAIL);
  return raw.length ? raw : DEFAULT_OWNERS;
}
// 주문 허용 계정. 기본은 사이트 주인과 동일 —— 관리할 변수를 OWNER_EMAIL 하나로 줄인다.
// KIS_OWNER_EMAIL 은 선택이고, 넣으면 "주문만 더 좁게" 제한하는 용도로만 쓴다.
function orderOwners(env) {
  const narrow = parseEmails(env.KIS_OWNER_EMAIL);
  return narrow.length ? narrow : siteOwners(env);
}
async function emailOfToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) return "";
  const key = env.FIREBASE_API_KEY || FIREBASE_API_KEY_FALLBACK;
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  const j = await r.json().catch(() => ({}));
  const u = j.users && j.users[0];
  return u ? String(u.email || "").toLowerCase() : "";
}

// ── Firebase ID 토큰 검증 (소유자만 주문) ──
async function verifyOwner(request, env) {
  const owners = orderOwners(env);
  /* 자동 주문(/api/autotrade)은 사람이 없어 로그인 토큰이 없다.
     그 대신 AUTOTRADE_KEY 를 요구한다 — 키가 비어 있으면 이 길은 아예 닫혀 있다.
     (빈 값끼리 같다고 통과시키면 키를 안 넣은 사이트가 무방비가 된다.) */
  const ak = request.headers.get("x-autotrade-key") || "";
  if (env.AUTOTRADE_KEY && ak && ak === env.AUTOTRADE_KEY) return { ok: true, email: "autotrade", auto: true };
  const auth = request.headers.get("Authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!idToken) return { ok: false, msg: "로그인이 필요합니다." };
  const key = env.FIREBASE_API_KEY || FIREBASE_API_KEY_FALLBACK;
  const r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + key, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  const j = await r.json().catch(() => ({}));
  const u = j.users && j.users[0];
  const email = u && String(u.email || "").toLowerCase();
  if (!email) return { ok: false, msg: "로그인 정보를 확인하지 못했습니다." };
  if (!owners.includes(email)) return { ok: false, msg: `${email} 계정에는 주문 권한이 없습니다.` };
  return { ok: true, email };
}

// ── GET: config / price / balance ──
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const op = url.searchParams.get("op") || "config";
  const rawEnv = env;                                   // config·diag 는 네 갈래를 전부 훑어야 한다

  if (op === "config") {
    const modes = modeList(rawEnv);
    const cur = wantEnv(url.searchParams.get("env"), rawEnv);
    /* 이 사람이 주문을 낼 수 있는 계정인지 같이 알려준다.
       서버는 어차피 막지만, 못 낼 사람에게 '주문 내기' 버튼을 보여주면
       남의 계좌로 주문이 나갈 것처럼 보인다. 화면에서 아예 감추려면 이 값이 필요하다. */
    let owner = false;
    if (request.headers.get("Authorization")) {
      try { owner = (await verifyOwner(request, rawEnv)).ok === true; } catch (e) { owner = false; }
    }
    return json({
      owner,
      // 예전 필드 — 단타 화면이 아직 이걸 읽는다. 뜻을 바꾸지 않는다.
      configured: configured(withEnv(rawEnv, cur, url.searchParams.get("market"))), env: cur,
      hasOwner: orderOwners(rawEnv).length > 0,
      defaultEnv: wantEnv(null, rawEnv),
      modes,                                            // kr-vts · kr-real · us-vts · us-real
      ready: modes.filter((m) => m.ready).map((m) => m.id),
    });
  }
  // 시장은 code 로 정해진다 — 계좌가 시장별로 갈릴 수 있어 여기서 같이 넘긴다
  { const c = String(url.searchParams.get("code") || "").toUpperCase();
    const mk = url.searchParams.get("market") || (c ? (USSYM.test(c) ? "us" : "kr") : "");
    env = withEnv(env, url.searchParams.get("env"), mk); }
  if (op === "diag") {
    // 계좌번호·예수금·이메일이 담기므로 소유자만 볼 수 있다
    const who = await emailOfToken(request, env);
    if (!who || !siteOwners(env).includes(who)) {
      return json({ error: who ? `${who} 계정에는 진단 권한이 없습니다.` : "로그인이 필요합니다(소유자 전용).",
                    needAuth: true }, 401);
    }
    const checks = [];
    const add = (k, ok, det) => checks.push({ k, ok, det });
    // "변수 자체가 없음" 과 "변수는 있는데 값이 빔"을 구분한다 — 유형을 비밀로 바꿀 때 값이 날아가는 경우가 있다
    const state = (k, showTail) => {
      const has = Object.prototype.hasOwnProperty.call(env, k);
      const v = env[k];
      if (v && String(v).length) return { ok: true, det: `설정됨 (${String(v).length}자${showTail ? ", …" + String(v).slice(-4) : ""})` };
      if (has) return { ok: false, det: "변수는 있으나 값이 비어 있음 — 값을 다시 입력하고 저장하세요" };
      return { ok: false, det: "변수 자체가 없음 — 이름 철자/환경(Production)을 확인하세요" };
    };
    { const r1 = state("KIS_APPKEY", true);  add("KIS_APPKEY", r1.ok, r1.det); }
    { const r2 = state("KIS_APPSECRET", false); add("KIS_APPSECRET", r2.ok, r2.det); }
    // 이 배포가 실제로 어떤 변수들을 보고 있는지 (이름만, 값은 절대 안 나감)
    // Cloudflare 가 배포마다 넣어주는 값 — "지금 보고 있는 화면이 어느 배포인지"를 못 박는다.
    // 변수를 고친 뒤 배포가 갱신됐는지 추측하지 않고 확인할 수 있다.
    add("이 배포", true,
      (env.CF_PAGES_COMMIT_SHA ? "커밋 " + String(env.CF_PAGES_COMMIT_SHA).slice(0, 7) : "커밋 정보 없음")
      + (env.CF_PAGES_BRANCH ? " · " + env.CF_PAGES_BRANCH : ""));
    add("이 배포가 보는 KIS_* 변수", true, Object.keys(env).filter(k => /^KIS_|^OWNER_/.test(k)).sort().join(", ") || "(없음)");
    const a = acct(env);
    add("KIS_ACCOUNT", !!a, a ? `${a.cano}-${a.prod} 형식 정상` : (env.KIS_ACCOUNT ? "형식 오류 — 12345678-01 처럼 넣으세요" : "없음"));
    const narrow = parseEmails(env.KIS_OWNER_EMAIL);
    const ords = orderOwners(env);
    add("주문 허용 계정 (구글 로그인 이메일)", ords.length > 0,
      narrow.length ? `KIS_OWNER_EMAIL 로 따로 제한 중 — ${narrow.join(", ")}`
                    : `OWNER_EMAIL 과 동일 — ${ords.join(", ")}`);
    add("KIS_ENV", true, isReal(env) ? "real (실전 — 진짜 돈)" : "vts (모의투자)");

    if (env.KIS_APPKEY && env.KIS_APPSECRET) {
      let token = null;
      // 토큰은 도메인별로 따로 발급된다 — vts 도메인에서 성공했다면 그 키는 모의투자용 키가 맞다
      try {
        token = await getToken(env);
        add("접근토큰 발급", true, isReal(env)
          ? "성공 — 실전용 앱키가 맞습니다"
          : "성공 — 모의투자용 앱키가 맞습니다 (키는 정상)");
      }
      catch (e) { add("접근토큰 발급", false, String(e.message || e)); }
      if (token) {
        try {
          const j = await readJson(base(env) + "/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=005930", {
            headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: "FHKST01010100", custtype: "P" },
          });
          const p = j.output && j.output.stck_prpr;
          add("시세조회 (삼성전자)", !!p, p ? `현재가 ${Number(p).toLocaleString()}원` : (j.msg1 || "실패"));
        } catch (e) { add("시세조회 (삼성전자)", false, String(e.message || e)); }
        await sleep(600);   // 다음 호출이 초당 제한에 걸리지 않게 간격을 둔다
        if (a) {
          try {
            const tr = isReal(env) ? "TTTC8434R" : "VTTC8434R";
            const qs = new URLSearchParams({ CANO: a.cano, ACNT_PRDT_CD: a.prod, AFHR_FLPR_YN: "N", OFL_YN: "",
              INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00",
              CTX_AREA_FK100: "", CTX_AREA_NK100: "" });
            const j = await readJson(base(env) + "/uapi/domestic-stock/v1/trading/inquire-balance?" + qs, {
              headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: tr, custtype: "P" },
            });
            const ok2 = String(j.rt_cd) === "0";
            const cash = j.output2 && j.output2[0] && j.output2[0].dnca_tot_amt;
            let why = j.msg1 || "실패";
            // 실전 계좌번호를 모의(vts)에 넣는 실수가 잦다 — 에러코드로 바로 짚어준다
            if (RATE_LIMITED(j)) {
              why += " — 초당 요청 제한입니다. 계좌·키 문제가 아니니 몇 초 뒤 점검을 다시 누르세요";
            } else if (/INVALID_CHECK_ACNO|ACNO/i.test(JSON.stringify(j))) {
              why += isReal(env)
                ? " — 실전 계좌번호가 맞는지 확인하세요"
                : " — 앱키는 정상이므로 계좌번호만 틀렸습니다. 모의투자는 실전과 계좌번호가 다릅니다. "
                  + "KIS 홈페이지 > 모의투자 > 주식/선물옵션 모의투자 > 참가신청확인 에서 모의계좌번호(8자리-2자리)를 확인해 "
                  + "KIS_ACCOUNT 를 그 번호로 바꾸세요";
            }
            add("계좌 조회", ok2, ok2 ? `정상 · 예수금 ${Number(cash || 0).toLocaleString()}원` : why);
          } catch (e) { add("계좌 조회", false, String(e.message || e)); }
        }
      }
    }
    // 로그인 계정이 주문 권한과 맞는지 (Authorization 헤더가 있을 때만)
    if ((request.headers.get("Authorization") || "").startsWith("Bearer ")) {
      const g = await verifyOwner(request, env);
      add("로그인 계정 주문 권한", g.ok, g.ok ? `${g.email} — 주문 가능`
        : g.msg + ` — OWNER_EMAIL 을 ${who} 로 맞추세요. `
                + `KIS_OWNER_EMAIL 이 따로 있으면 그게 우선하니, 안 쓸 거면 그 변수를 지우면 됩니다`);
    }
    return json({ env: isReal(env) ? "real" : "vts", checks, allOk: checks.every(c => c.ok) });
  }
  if (!configured(env)) return json({ error: "KIS 키가 설정되지 않았습니다. Cloudflare 환경변수를 확인하세요." }, 400);

  try {
    if (op === "approval") {
      // 실시간(웹소켓) 접속키. 시크릿은 서버에 두고 approval_key만 내보낸다.
      const g = await verifyOwner(request, env);
      if (!g.ok) return json({ error: g.msg }, 401);
      const r = await fetch(base(env) + "/oauth2/Approval", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", appkey: env.KIS_APPKEY, secretkey: env.KIS_APPSECRET }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.approval_key) return json({ error: "접속키 발급 실패: " + (j.msg1 || r.status) }, 502);
      return json({ approval_key: j.approval_key, ws: isReal(env)
        ? "ws://ops.koreainvestment.com:21000/tryitout/H0STCNT0"
        : "ws://ops.koreainvestment.com:31000/tryitout/H0STCNT0", env: isReal(env) ? "real" : "vts" });
    }
    // 과거 날짜의 1분봉. 네이버는 7거래일이 한계라 9:00~9:30 을 몇 달치 검증할 방법이 없었다.
    // KIS 는 날짜를 지정해 그 시각까지의 분봉 120개를 준다 — 아침 30분이면 한 번에 다 들어온다.
    // op=price 와 같은 공개 시세라 별도 인증을 두지 않는다.
    if (op === "minhist") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const date = String(url.searchParams.get("date") || "").replace(/\D/g, "");   // YYYYMMDD
      const hour = String(url.searchParams.get("hour") || "093000").replace(/\D/g, "");
      if (!KRCODE.test(code)) return json({ error: "종목코드가 올바르지 않습니다." }, 400);
      if (!/^\d{8}$/.test(date)) return json({ error: "날짜는 YYYYMMDD 형식입니다." }, 400);
      const token = await getToken(env);
      const qs = new URLSearchParams({ FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: code,
        FID_INPUT_DATE_1: date, FID_INPUT_HOUR_1: hour.padStart(6, "0"),
        FID_PW_DATA_INCU_YN: "N", FID_FAKE_TICK_INCU_YN: "N" });
      const j = await readJson(base(env) + "/uapi/domestic-stock/v1/quotations/inquire-time-dailychartprice?" + qs, {
        headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET,
          tr_id: "FHKST03010230", custtype: "P" },
      });
      if (String(j.rt_cd) !== "0") {
        return json({ error: j.msg1 || "분봉 조회 실패", code: j.msg_cd || "",
          rateLimited: RATE_LIMITED(j) }, 502);
      }
      const bars = (j.output2 || []).filter(x => x && x.stck_cntg_hour).map(x => ({
        t: String(x.stck_bsop_date || date) + String(x.stck_cntg_hour).padStart(6, "0"),
        o: +x.stck_oprc, h: +x.stck_hgpr, l: +x.stck_lwpr, c: +x.stck_prpr, v: +x.cntg_vol,
      })).filter(b => b.c > 0).sort((a, b) => a.t < b.t ? -1 : 1);
      return json({ code, date, bars, n: bars.length });
    }
    // 이 함수가 바깥으로 나갈 때 쓰는 IP. 증권사 API 중에는 허용 IP 등록을 요구하는 곳이 있어
    // (예: 토스증권 오픈API) 우리 구조로 쓸 수 있는지 판단하려면 이 값이 고정인지 봐야 한다.
    if (op === "egress") {
      const out = [];
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch("https://cloudflare.com/cdn-cgi/trace", { cf: { cacheTtl: 0 } });
          const t = await r.text();
          const m = t.match(/^ip=(.+)$/m), c = t.match(/^colo=(.+)$/m);
          out.push({ ip: m ? m[1] : "?", colo: c ? c[1] : "?" });
        } catch (e) { out.push({ error: String(e.message || e) }); }
      }
      const uniq = [...new Set(out.map(x => x.ip))];
      return json({ calls: out, uniqueIps: uniq.length,
        note: uniq.length > 1 ? "호출마다 IP가 다르다 — 허용 IP 등록이 필요한 API는 쓸 수 없다"
                              : "이번 호출들은 같은 IP였지만 고정이라는 보장은 아니다" });
    }
    if (op === "price") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      if (USSYM.test(code)) {                       // 미국 티커 — 해외 경로
        const r = await usPrice(env, code, String(url.searchParams.get("excd") || "").toUpperCase() || null);
        return r.ok ? json(r) : json({ error: r.error, rateLimited: r.rateLimited }, 502);
      }
      if (!KRCODE.test(code)) return json({ error: "종목코드가 올바르지 않습니다." }, 400);
      const token = await getToken(env);
      const j = await readJson(base(env) + "/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=" + code, {
        headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: "FHKST01010100", custtype: "P" },
      });
      const o = j.output || {};
      if (!o.stck_prpr) return json({ error: RATE_LIMITED(j) ? "초당 요청 제한 — 잠시 후 다시" : (j.msg1 || "시세 조회 실패"),
        rateLimited: RATE_LIMITED(j) }, 502);
      return json({ code, price: +o.stck_prpr, open: +o.stck_oprc, high: +o.stck_hgpr, low: +o.stck_lwpr,
        chgRate: +o.prdy_ctrt, volume: +o.acml_vol });
    }
    if (op === "balance") {
      const g = await verifyOwner(request, env);
      if (!g.ok) return json({ error: g.msg }, 401);
      if (String(url.searchParams.get("market") || "").toLowerCase() === "us") {
        const r = await usBalance(env);
        if (r.error) return json(r, 400);
        // 종목을 주면 그 종목 현재가로 주문가능금액 · 최대 수량도 같이 준다(앱 '한투 계좌 확인')
        const code = String(url.searchParams.get("code") || "").toUpperCase();
        if (USSYM.test(code)) {
          await sleep(550);
          const q = await usPrice(env, code);
          if (q.ok) { await sleep(550); r.buyable = await usBuyable(env, code, q.price, q.market); }
          else r.buyable = { error: "시세 조회 실패 — " + q.error };
        }
        return json(r);
      }
      const a = acct(env); if (!a) return json({ error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" }, 400);
      const token = await getToken(env);
      const tr = isReal(env) ? "TTTC8434R" : "VTTC8434R";
      const qs = new URLSearchParams({ CANO: a.cano, ACNT_PRDT_CD: a.prod, AFHR_FLPR_YN: "N", OFL_YN: "",
        INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00",
        CTX_AREA_FK100: "", CTX_AREA_NK100: "" });
      const j = await readJson(base(env) + "/uapi/domestic-stock/v1/trading/inquire-balance?" + qs, {
        headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: tr, custtype: "P" },
      });
      const holdings = (j.output1 || []).filter(x => +x.hldg_qty > 0)
        .map(x => ({ code: x.pdno, name: x.prdt_name, qty: +x.hldg_qty, avg: +x.pchs_avg_pric, cur: +x.prpr, pl: +x.evlu_pfls_rt }));
      const sum = (j.output2 && j.output2[0]) || {};
      return json({ holdings, cash: +sum.dnca_tot_amt || 0, evalTotal: +sum.tot_evlu_amt || 0 });
    }
    if (op === "orders") {
      // Read-only order/fill inquiry. Used only to compare manually placed KIS VTS
      // mock trades with our internal paper fills; it never submits an order.
      const g = await verifyOwner(request, env);
      if (!g.ok) return json({ error: g.msg }, 401);
      if (isReal(env)) return json({ error: "orders 조회는 이 화면에서 KIS 모의투자(vts)만 허용합니다." }, 400);
      const a = acct(env); if (!a) return json({ error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" }, 400);
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const odno = String(url.searchParams.get("odno") || "").replace(/\D/g, "");
      const rawDate = String(url.searchParams.get("date") || "").replace(/\D/g, "");
      const now = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"})
        .format(new Date()).replace(/-/g,"");
      const date = /^\d{8}$/.test(rawDate) ? rawDate : now;
      if (code && !KRCODE.test(code)) return json({ error: "종목코드 오류" }, 400);

      const token = await getToken(env);
      const qs = new URLSearchParams({
        CANO:a.cano, ACNT_PRDT_CD:a.prod,
        INQR_STRT_DT:date, INQR_END_DT:date,
        SLL_BUY_DVSN_CD:"00", INQR_DVSN:"00", PDNO:code,
        CCLD_DVSN:"00", ORD_GNO_BRNO:"", ODNO:odno,
        INQR_DVSN_3:"00", INQR_DVSN_1:"",
        CTX_AREA_FK100:"", CTX_AREA_NK100:"",
        EXCG_ID_DVSN_CD:"KRX"
      });
      const path="/uapi/domestic-stock/v1/trading/inquire-daily-ccld?"+qs;
      const headers=(tr)=>({ authorization:"Bearer "+token, appkey:env.KIS_APPKEY, appsecret:env.KIS_APPSECRET, tr_id:tr, custtype:"P" });
      let j=await readJson(base(env)+path,{headers:headers("VTTC0081R")});
      let trId="VTTC0081R";
      if(String(j.rt_cd)!=="0"&&!RATE_LIMITED(j)){
        await sleep(650);
        const j2=await readJson(base(env)+path,{headers:headers("VTTC8001R")});
        if(String(j2.rt_cd)==="0"){j=j2;trId="VTTC8001R";}
      }
      if(String(j.rt_cd)!=="0") return json({ error: RATE_LIMITED(j)?"초당 요청 제한 — 잠시 후 다시":(j.msg1||"체결조회 실패"),
        code:j.msg_cd||"", rateLimited:RATE_LIMITED(j), trId },502);

      const rows=(j.output1||[]).map(x=>({
        orderDate:x.ord_dt||"", orderTime:x.ord_tmd||"", notifyTime:x.infm_tmd||"", orderNo:x.odno||"",
        originalOrderNo:x.orgn_odno||"", sideCode:x.sll_buy_dvsn_cd||"",
        side:x.sll_buy_dvsn_cd_name||"", code:x.pdno||"", name:x.prdt_name||"",
        orderType:x.ord_dvsn_name||"", orderQty:+x.ord_qty||0, orderPrice:+x.ord_unpr||0,
        fillQty:+x.tot_ccld_qty||0, fillPrice:+x.avg_prvs||0, fillAmount:+x.tot_ccld_amt||0,
        remainingQty:+x.rmn_qty||0, rejectedQty:+x.rjct_qty||0, canceled:String(x.cncl_yn||"")==="Y"
      }));
      const s=Array.isArray(j.output2)?(j.output2[0]||{}):(j.output2||{});
      return json({
        env:"vts", trId, date, code, orderNo:odno, orders:rows,
        summary:{
          totalOrderQty:+s.tot_ord_qty||0,
          totalFillQty:+s.tot_ccld_qty||0,
          totalFillAmount:+s.tot_ccld_amt||0,
          estimatedCosts:+s.prsm_tlex_smtl||0,
          purchaseAvgPrice:+s.pchs_avg_pric||0
        }
      });
    }
    return json({ error: "알 수 없는 op" }, 400);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}

// ── POST: order ──
export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const op = url.searchParams.get("op") || "order";
  if (op !== "order") return json({ error: "알 수 없는 op" }, 400);
  // 키 확인은 환경을 고른 뒤에 한다 — 어느 환경 키가 없는지 말해야 고칠 수 있다

  const g = await verifyOwner(request, env);
  if (!g.ok) return json({ error: g.msg }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  // 주문은 환경을 반드시 명시적으로 받는다 — 기본값에 기대면 실전에 잘못 나갈 수 있다
  { const c = String(body.code || "").toUpperCase();
    env = withEnv(env, body.env || url.searchParams.get("env"), USSYM.test(c) ? "us" : "kr"); }
  if (!configured(env)) return json({ error: `${isReal(env) ? "실전" : "모의투자"} 키가 설정되지 않았습니다.` }, 400);
  const side = String(body.side || "").toLowerCase();          // buy | sell
  const code = String(body.code || "").toUpperCase();
  const qty = parseInt(body.qty, 10);
  const priceType = String(body.priceType || "limit");         // limit | market
  const us = USSYM.test(code);
  /* 미국 주문구분(ORD_DVSN). 기본은 지금까지와 같은 "00"(지정가)다.
     31~34 는 MOO/LOO/MOC/LOC 로 알려져 있으나 공개 문서마다 순서가 엇갈려
     어느 숫자가 LOC 인지 확정하지 못했다. 그래서 값을 코드에 박지 않고
     부르는 쪽이 정해 보내게 하고, 실제로 무엇이 쓰였는지 응답에 담아 돌려준다.
     — 숫자를 찍어 맞히는 대신, 한 번 넣어 보고 답을 읽어서 알아낸다. */
  const DVSN_OK = ["00", "31", "32", "33", "34"];
  const wantDvsn = DVSN_OK.includes(String(body.ordDvsn || "")) ? String(body.ordDvsn) : "00";
  // 미국 주식은 호가가 소수점이다 — 국내처럼 반올림하면 115.76이 116이 되어 딴 주문이 된다
  const price = priceType === "market" ? 0 : (us ? Math.round((+body.price || 0) * 100) / 100 : Math.round(+body.price || 0));
  if (!us && !KRCODE.test(code)) return json({ error: "종목코드 오류" }, 400);
  if (!(qty > 0)) return json({ error: "수량 오류" }, 400);
  if (priceType === "limit" && !(price > 0)) return json({ error: "지정가 가격 오류" }, 400);
  if (side !== "buy" && side !== "sell") return json({ error: "side 오류" }, 400);

  const a = acct(env); if (!a) return json({ error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" }, 400);
  const real = isReal(env);

  // ── 미국 주식 주문 ──
  if (us) {
    // KIS 미국 주문은 지정가만 받는다. 시장가를 조용히 지정가로 바꾸면 의도와 다른 값에 체결된다.
    if (priceType === "market") return json({ error: "미국 주식은 지정가만 주문할 수 있습니다. 가격을 정해 주세요." }, 400);
    // 거래소를 모르면 시세로 찾아 쓴다 — 종목마다 어디 상장인지 외울 필요가 없다
    let mkt = String(body.market || "").toUpperCase();
    if (!["NASD", "NYSE", "AMEX"].includes(mkt)) {
      const q = await usPrice(env, code);
      if (!q.ok) return json({ error: "거래소를 찾지 못했습니다 — " + q.error }, 502);
      mkt = q.market;
    }
    const trU = side === "buy" ? (real ? "TTTT1002U" : "VTTT1002U") : (real ? "TTTT1006U" : "VTTT1001U");
    const send = async (dvsn) => {
      const ordU = { CANO: a.cano, ACNT_PRDT_CD: a.prod, OVRS_EXCG_CD: mkt, PDNO: code,
        ORD_QTY: String(qty), OVRS_ORD_UNPR: price.toFixed(2), ORD_SVR_DVSN_CD: "0", ORD_DVSN: dvsn };
      const token = await getToken(env);
      const hk = await hashkey(env, ordU);
      const r = await fetch(base(env) + "/uapi/overseas-stock/v1/trading/order", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token,
          appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: trU, custtype: "P", hashkey: hk },
        body: JSON.stringify(ordU),
      });
      const j = await r.json().catch(() => ({}));
      return { j, ok: String(j.rt_cd) === "0" };
    };
    const dressed = (dvsn, j, ok, extra) => {
      const msg = ok ? (j.msg1 || "주문 접수")
        : RATE_LIMITED(j) ? "초당 요청 제한에 걸려 주문이 접수되지 않았습니다 — 잠시 후 다시 누르세요"
        : (j.msg1 || "주문 실패");
      return json({ ok, env: real ? "real" : "vts", market: mkt, side, code, qty, price, priceType: "limit",
        ordDvsn: dvsn, orderNo: j.output && (j.output.ODNO || j.output.odno), msg, raw: j, ...extra },
        ok ? 200 : 502);
    };
    try {
      let { j, ok } = await send(wantDvsn);
      /* 여기서만은 한 번 더 보낸다. 재시도 금지는 "접수됐는지 모를 때" 의 규칙인데
         (그물이 끊기거나 응답이 없으면 이미 들어갔을 수 있으니 두 번 내면 이중 주문이다)
         지금은 한투가 답을 줘서 "안 받았다" 고 말한 경우다. 안 받은 주문은 없는 주문이니
         다른 주문구분으로 다시 내도 겹치지 않는다. 던져진 예외나 초당제한은 해당 없다. */
      if (!ok && wantDvsn !== "00" && !RATE_LIMITED(j)) {
        const first = { code: wantDvsn, msg: j.msg1 || "주문 실패", rt: String(j.msg_cd || j.rt_cd || "") };
        ({ j, ok } = await send("00"));
        return dressed("00", j, ok, { fellBack: true, firstTry: first });
      }
      return dressed(wantDvsn, j, ok, {});
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  }

  const tr = side === "buy" ? (real ? "TTTC0802U" : "VTTC0802U") : (real ? "TTTC0801U" : "VTTC0801U");
  const ord = { CANO: a.cano, ACNT_PRDT_CD: a.prod, PDNO: code,
    ORD_DVSN: priceType === "market" ? "01" : "00", ORD_QTY: String(qty), ORD_UNPR: String(price) };

  try {
    const token = await getToken(env);
    const hk = await hashkey(env, ord);
    const r = await fetch(base(env) + "/uapi/domestic-stock/v1/trading/order-cash", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + token,
        appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: tr, custtype: "P", hashkey: hk },
      body: JSON.stringify(ord),
    });
    const j = await r.json().catch(() => ({}));
    const ok = String(j.rt_cd) === "0";
    // 주문은 절대 자동 재시도하지 않는다 — 응답이 유실된 경우 이중 주문이 될 수 있다.
    // 제한에 걸렸으면 사람이 보고 다시 누르게 한다.
    const msg = ok ? (j.msg1 || "주문 접수")
      : RATE_LIMITED(j) ? "초당 요청 제한에 걸려 주문이 접수되지 않았습니다 — 잠시 후 다시 누르세요"
      : (j.msg1 || "주문 실패");
    return json({ ok, env: real ? "real" : "vts", side, code, qty, price, priceType,
      orderNo: j.output && (j.output.ODNO || j.output.odno), msg, raw: j }, ok ? 200 : 502);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
