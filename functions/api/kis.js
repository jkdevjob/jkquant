// Cloudflare Pages Function — /api/kis
// 한국투자증권(KIS) OpenAPI 프록시. 브라우저는 KIS를 직접 못 부른다(CORS·시크릿 노출).
// 시크릿은 Cloudflare Pages 환경변수로만 둔다. 주문은 Firebase 로그인(소유자)만 허용한다.
//
// ── 필요한 환경변수 (Cloudflare Pages → 설정 → 환경 변수) ──
//   KIS_APPKEY        : KIS 개발자센터에서 발급한 appkey
//   KIS_APPSECRET     : appsecret
//   KIS_ACCOUNT       : 계좌번호 "12345678-01" (앞 8자리-상품 2자리)
//   KIS_ENV           : "vts"(모의투자·기본) 또는 "real"(실전)
//   OWNER_EMAIL       : 이 앱에 구글 로그인하는 "주인" 계정(쉼표로 여러 개).
//                       단타 화면 노출·진단·주문이 전부 이걸 본다. 보통 이 하나만 있으면 된다.
//   KIS_OWNER_EMAIL   : (선택) 주문만 더 좁게 제한하고 싶을 때. 없으면 OWNER_EMAIL 을 그대로 쓴다.
//   ※ 둘 다 KIS 계정이나 Cloudflare 계정이 아니라 "구글 로그인 이메일"이다.
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
      hasOwner: orderOwners(env).length > 0 });
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
