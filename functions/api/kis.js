// Cloudflare Pages Function — /api/kis
// 한국투자증권(KIS) OpenAPI 프록시. 브라우저는 KIS를 직접 못 부른다(CORS·시크릿 노출).
// 시크릿은 Cloudflare Pages 환경변수로만 둔다. 주문은 Firebase 로그인(소유자)만 허용한다.
//
// ── 필요한 환경변수 (Cloudflare Pages → 설정 → 환경 변수) ──
//   KIS_APPKEY        : KIS 개발자센터에서 발급한 appkey
//   KIS_APPSECRET     : appsecret
//   KIS_ACCOUNT       : 계좌번호 "12345678-01" (앞 8자리-상품 2자리)
//   KIS_ENV           : "vts"(모의투자·기본) 또는 "real"(실전)
//   KIS_OWNER_EMAIL   : 주문을 허용할 계정 이메일(쉼표로 여러 개). 없으면 주문은 전면 차단.
//   FIREBASE_API_KEY  : (선택) 없으면 아래 상수 사용
//
// 지원: op=config(상태) · op=diag(자가진단) · op=approval(웹소켓키) · op=price · op=balance · POST op=order

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
};
const FIREBASE_API_KEY_FALLBACK = "AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw"; // 공개 웹 키
const KRCODE = /^(?:\d{6}|\d{4}[A-Z]\d)$/;

const base = (env) => (String(env.KIS_ENV || "vts").toLowerCase() === "real"
  ? "https://openapi.koreainvestment.com:9443"
  : "https://openapivts.koreainvestment.com:29443");
const isReal = (env) => String(env.KIS_ENV || "vts").toLowerCase() === "real";

function json(obj, status = 200) { return new Response(JSON.stringify(obj), { status, headers: JH }); }
function configured(env) { return !!(env.KIS_APPKEY && env.KIS_APPSECRET && env.KIS_ACCOUNT); }
function acct(env) {
  const a = String(env.KIS_ACCOUNT || "").replace(/\s/g, "");
  const m = a.match(/^(\d{8})-?(\d{2})$/);
  return m ? { cano: m[1], prod: m[2] } : null;
}

// ── 접근 토큰 (웜 아이솔레이트 동안 캐시) ──
let _tok = { at: 0, token: null, env: null };
async function getToken(env) {
  const now = Date.now();
  if (_tok.token && _tok.env === base(env) && now - _tok.at < 60 * 60 * 1000) return _tok.token;
  const r = await fetch(base(env) + "/oauth2/tokenP", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("KIS 토큰 발급 실패: " + (j.error_description || j.msg1 || r.status));
  _tok = { at: now, token: j.access_token, env: base(env) };
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

// ── 사이트 소유자 판정 (OWNER_EMAIL → KIS_OWNER_EMAIL → 기본값) ──
const DEFAULT_OWNERS = ["jk82investing@gmail.com"];
function siteOwners(env) {
  const raw = String(env.OWNER_EMAIL || env.KIS_OWNER_EMAIL || "").trim();
  return raw ? raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : DEFAULT_OWNERS;
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
  const owners = String(env.KIS_OWNER_EMAIL || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!owners.length) return { ok: false, msg: "KIS_OWNER_EMAIL 환경변수가 없어 주문이 차단돼 있습니다." };
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

  if (op === "config") {
    return json({ configured: configured(env), env: isReal(env) ? "real" : "vts",
      hasOwner: !!(env.KIS_OWNER_EMAIL || "").trim() });
  }
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
    add("이 배포가 보는 KIS_* 변수", true, Object.keys(env).filter(k => /^KIS_|^OWNER_/.test(k)).sort().join(", ") || "(없음)");
    const a = acct(env);
    add("KIS_ACCOUNT", !!a, a ? `${a.cano}-${a.prod} 형식 정상` : (env.KIS_ACCOUNT ? "형식 오류 — 12345678-01 처럼 넣으세요" : "없음"));
    const owners = String(env.KIS_OWNER_EMAIL || "").split(",").map(x => x.trim()).filter(Boolean);
    add("KIS_OWNER_EMAIL", owners.length > 0, owners.length ? `${owners.length}개 등록 (${owners[0]})` : "없음 — 주문이 전면 차단됩니다");
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
          const r = await fetch(base(env) + "/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=005930", {
            headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: "FHKST01010100", custtype: "P" },
          });
          const j = await r.json().catch(() => ({}));
          const p = j.output && j.output.stck_prpr;
          add("시세조회 (삼성전자)", !!p, p ? `현재가 ${Number(p).toLocaleString()}원` : (j.msg1 || "실패 HTTP " + r.status));
        } catch (e) { add("시세조회 (삼성전자)", false, String(e.message || e)); }
        if (a) {
          try {
            const tr = isReal(env) ? "TTTC8434R" : "VTTC8434R";
            const qs = new URLSearchParams({ CANO: a.cano, ACNT_PRDT_CD: a.prod, AFHR_FLPR_YN: "N", OFL_YN: "",
              INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00",
              CTX_AREA_FK100: "", CTX_AREA_NK100: "" });
            const r = await fetch(base(env) + "/uapi/domestic-stock/v1/trading/inquire-balance?" + qs, {
              headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: tr, custtype: "P" },
            });
            const j = await r.json().catch(() => ({}));
            const ok2 = String(j.rt_cd) === "0";
            const cash = j.output2 && j.output2[0] && j.output2[0].dnca_tot_amt;
            let why = j.msg1 || "실패";
            // 실전 계좌번호를 모의(vts)에 넣는 실수가 잦다 — 에러코드로 바로 짚어준다
            if (/INVALID_CHECK_ACNO|ACNO/i.test(JSON.stringify(j))) {
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
        : g.msg + ` (KIS_OWNER_EMAIL 을 ${who} 로 바꾸거나, 등록된 계정으로 로그인하세요)`);
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
    if (op === "price") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      if (!KRCODE.test(code)) return json({ error: "종목코드가 올바르지 않습니다." }, 400);
      const token = await getToken(env);
      const r = await fetch(base(env) + "/uapi/domestic-stock/v1/quotations/inquire-price?fid_cond_mrkt_div_code=J&fid_input_iscd=" + code, {
        headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: "FHKST01010100", custtype: "P" },
      });
      const j = await r.json().catch(() => ({}));
      const o = j.output || {};
      if (!o.stck_prpr) return json({ error: j.msg1 || "시세 조회 실패" }, 502);
      return json({ code, price: +o.stck_prpr, open: +o.stck_oprc, high: +o.stck_hgpr, low: +o.stck_lwpr,
        chgRate: +o.prdy_ctrt, volume: +o.acml_vol });
    }
    if (op === "balance") {
      const g = await verifyOwner(request, env);
      if (!g.ok) return json({ error: g.msg }, 401);
      const a = acct(env); if (!a) return json({ error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" }, 400);
      const token = await getToken(env);
      const tr = isReal(env) ? "TTTC8434R" : "VTTC8434R";
      const qs = new URLSearchParams({ CANO: a.cano, ACNT_PRDT_CD: a.prod, AFHR_FLPR_YN: "N", OFL_YN: "",
        INQR_DVSN: "02", UNPR_DVSN: "01", FUND_STTL_ICLD_YN: "N", FNCG_AMT_AUTO_RDPT_YN: "N", PRCS_DVSN: "00",
        CTX_AREA_FK100: "", CTX_AREA_NK100: "" });
      const r = await fetch(base(env) + "/uapi/domestic-stock/v1/trading/inquire-balance?" + qs, {
        headers: { authorization: "Bearer " + token, appkey: env.KIS_APPKEY, appsecret: env.KIS_APPSECRET, tr_id: tr, custtype: "P" },
      });
      const j = await r.json().catch(() => ({}));
      const holdings = (j.output1 || []).filter(x => +x.hldg_qty > 0)
        .map(x => ({ code: x.pdno, name: x.prdt_name, qty: +x.hldg_qty, avg: +x.pchs_avg_pric, cur: +x.prpr, pl: +x.evlu_pfls_rt }));
      const sum = (j.output2 && j.output2[0]) || {};
      return json({ holdings, cash: +sum.dnca_tot_amt || 0, evalTotal: +sum.tot_evlu_amt || 0 });
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
  if (!configured(env)) return json({ error: "KIS 키가 설정되지 않았습니다." }, 400);

  const g = await verifyOwner(request, env);
  if (!g.ok) return json({ error: g.msg }, 401);

  let body = {};
  try { body = await request.json(); } catch (e) {}
  const side = String(body.side || "").toLowerCase();          // buy | sell
  const code = String(body.code || "").toUpperCase();
  const qty = parseInt(body.qty, 10);
  const priceType = String(body.priceType || "limit");         // limit | market
  const price = priceType === "market" ? 0 : Math.round(+body.price || 0);
  if (!KRCODE.test(code)) return json({ error: "종목코드 오류" }, 400);
  if (!(qty > 0)) return json({ error: "수량 오류" }, 400);
  if (priceType === "limit" && !(price > 0)) return json({ error: "지정가 가격 오류" }, 400);
  if (side !== "buy" && side !== "sell") return json({ error: "side 오류" }, 400);

  const a = acct(env); if (!a) return json({ error: "KIS_ACCOUNT 형식 오류(예: 12345678-01)" }, 400);
  const real = isReal(env);
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
    return json({ ok, env: real ? "real" : "vts", side, code, qty, price, priceType,
      orderNo: j.output && (j.output.ODNO || j.output.odno), msg: j.msg1 || (ok ? "주문 접수" : "주문 실패"), raw: j }, ok ? 200 : 502);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}
