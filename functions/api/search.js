// Cloudflare Pages Function — GET /api/search?q=SOX
// 티커 자동완성. 해외는 야후 검색을 중계하고, 국내는 ETF 전체 목록을 받아 부분일치로 훑는다.
//
// 왜 국내만 목록을 받아오나:
//   야후·네이버 검색은 둘 다 앞부분 일치라, 'TIGER 200타겟위클리커버드콜'을
//   '200'이나 '커버드콜'로는 못 찾는다. 게다가 야후엔 국내 ETF가 영문명으로만 실려
//   한글 조각으로는 아예 안 잡힌다. 이름 가운데 토막으로 찾으려면 목록이 있어야 한다.
//   국내 ETF는 1100여 종(260KB)이라 엣지에 6시간 캐시해두고 매 요청 훑어도 싸다.
// 해외는 종목 수가 자릿수가 달라 같은 방법을 못 쓴다 — 야후 검색 그대로 둔다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=600",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 앱이 다루는 것만 남긴다. 선물(FUTURE)·통화 같은 건 티커 칸에 들어가도 시세가 안 붙는다.
const KEEP = new Set(["ETF", "EQUITY", "INDEX", "MUTUALFUND"]);

// 국내 종목코드: 옛 6자리 숫자(069500)와 2024년부터 나온 신형(0104N0) 두 가지뿐이다.
const KR_CODE = /^(?:\d{6}|\d{4}[A-Z]\d)$/;
const HANGUL = /[ㄱ-ㆎ가-힣]/;

// 네이버 ETF 전체 목록. EUC-KR로 내려오므로 바이트로 받아 직접 디코딩한다
// (Response.text()는 Content-Type의 charset과 무관하게 UTF-8로 읽어 한글이 깨진다).
const KR_URL = "https://finance.naver.com/api/sise/etfItemList.nhn";
const KR_TTL = 6 * 3600e3;
let _krCache = { at: 0, list: [] };

async function krEtfList() {
  if (_krCache.list.length && Date.now() - _krCache.at < KR_TTL) return _krCache.list;
  const r = await fetch(KR_URL, {
    headers: { "User-Agent": UA, "Referer": "https://finance.naver.com/sise/etf.naver" },
    cf: { cacheTtl: 21600, cacheEverything: true },
  });
  if (!r.ok) throw new Error("kr list HTTP " + r.status);
  const j = JSON.parse(new TextDecoder("euc-kr").decode(await r.arrayBuffer()));
  const list = (j && j.result && j.result.etfItemList || [])
    .map((x) => ({ symbol: String(x.itemcode || "").toUpperCase(), name: String(x.itemname || ""), cap: +x.marketSum || 0 }))
    .filter((x) => KR_CODE.test(x.symbol));
  if (list.length) _krCache = { at: Date.now(), list };   // 빈 응답으로 캐시를 덮지 않는다
  return _krCache.list;
}

// 'KODEX 200'과 'kodex200'을 같은 것으로 본다 — 공백·기호를 털고 대문자로.
const norm = (s) => String(s || "").toUpperCase().replace(/[\s()[\]{}·,.&+/-]/g, "");

/* 부분일치 검색(LIKE %q%). 공백으로 끊은 토막을 각각 이름 어디서든 찾는다.
   '200'으로 'TIGER 200타겟위클리커버드콜'이 걸리게 하려는 것이 목적이다.

   순위는 점수 하나로 뭉개지 않고 기준을 차례로 본다 — 어느 기준이 이겼는지 읽히게.
     1) 종목코드를 통째로 친 것          2) 맞은 토막 수(많이 맞은 게 먼저)
     3) 코드 앞부분 일치                 4) 이름 맨 앞에서 시작
     5) 시가총액 큰 것                   6) 이름 안에서 더 앞
   시총이 위에 있는 이유: '커버드콜'처럼 100개가 걸리는 말은 이름만 봐선 순서를
   정할 근거가 없다. 그럴 땐 실제로 거래되는 큰 것부터 보여주는 게 맞다.
   '이름 안에서 더 앞'을 위에 뒀더니 브랜드명이 짧다는 이유로 '1Q 200액티브'가
   'KODEX 200'을 밀어냈다 — 글자 위치는 '무엇을 찾는지'와 상관이 없었다.

   코드 앞부분 일치는 4자 이상일 때만 본다. '200'을 코드로 치는 사람은 없는데
   200250·200030 같은 게 'KODEX 200'을 밀어내고 앞에 서던 문제가 있었다. */
function krSearch(list, q, limit) {
  const toks = q.split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return [];
  const qn = norm(q);
  const byCode = qn.length >= 4;
  const out = [];
  for (const it of list) {
    const n = norm(it.name);
    const codeExact = it.symbol === qn ? 1 : 0;
    const codePrefix = !codeExact && byCode && it.symbol.startsWith(qn) ? 1 : 0;
    let hit = codeExact || codePrefix, first = 1e9;
    for (const t of toks) {
      // 알파벳 한 글자짜리 토막은 아무 이름에나 걸려 목록을 버린다. 한글은 한 자도 뜻이 있다
      if (t.length < 2 && !HANGUL.test(t)) continue;
      const i = n.indexOf(t);
      if (i >= 0) { hit++; if (i < first) first = i; }
    }
    if (!hit) continue;
    out.push({ it, hit, codeExact, codePrefix, head: n.startsWith(toks[0]) ? 1 : 0, first: Math.min(first, 99) });
  }
  out.sort((a, b) =>
    b.codeExact - a.codeExact || b.hit - a.hit || b.codePrefix - a.codePrefix ||
    b.head - a.head || b.it.cap - a.it.cap || a.first - b.first);
  return out.slice(0, limit).map(({ it }) => ({
    symbol: it.symbol, name: it.name.slice(0, 60), type: "ETF", exchange: "KRX", kr: true,
  }));
}

async function yahooSearch(q, limit) {
  const u = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}`
          + `&quotesCount=${limit * 2}&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  const r = await fetch(u, {
    headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/" },
    cf: { cacheTtl: 600 },
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const out = [];
  for (const x of (j.quotes || [])) {
    const t = String(x.quoteType || "").toUpperCase();
    if (!KEEP.has(t)) continue;
    let sym = String(x.symbol || "").toUpperCase();
    if (!sym) continue;
    // 국내상장 ETF는 앱이 종목코드(네이버 경로)로 다룬다 — 야후의 .KS/.KQ를 벗긴다
    const kr = /^([0-9][0-9A-Z]{5})\.(KS|KQ)$/.exec(sym);
    if (kr && KR_CODE.test(kr[1])) sym = kr[1];
    out.push({
      symbol: sym,
      name: String(x.shortname || x.longname || "").slice(0, 60),
      type: t,
      exchange: String(x.exchange || ""),
      kr: !!kr,
    });
  }
  return out;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(20, Math.max(1, +url.searchParams.get("limit") || 10));
  if (q.length < 1) return new Response(JSON.stringify({ items: [] }), { headers: JH });

  const hangul = HANGUL.test(q);
  // 한글 질의는 야후가 답을 못 낸다(국내 종목이 영문명으로만 실려 있다) — 국내만 찾는다.
  const [krR, yhR] = await Promise.allSettled([
    krEtfList().then((l) => krSearch(l, q, limit)),
    hangul ? Promise.resolve([]) : yahooSearch(q, limit),
  ]);
  const krItems = krR.status === "fulfilled" ? krR.value : [];
  const yhItems = yhR.status === "fulfilled" ? yhR.value : [];

  /* 순서: 숫자만 친 질의는 국내 종목코드·'KODEX 200' 쪽을 먼저 본다.
     알파벳이 섞이면 해외를 먼저 — 'SCHD'를 쳤는데 국내 목록이 앞을 채우면 곤란하다. */
  const krFirst = hangul || /^[\d\s]+$/.test(q);
  const first = krFirst ? krItems : yhItems, second = krFirst ? yhItems : krItems;

  // 국내 종목은 한글 이름이 있으면 그걸 쓴다 — 야후는 영문명뿐이라 알아보기 어렵다
  const krName = new Map(krItems.map((x) => [x.symbol, x.name]));
  const seen = new Set(), items = [];
  for (const x of [...first, ...second]) {
    if (seen.has(x.symbol)) continue;
    seen.add(x.symbol);
    items.push(krName.has(x.symbol) ? { ...x, name: krName.get(x.symbol), kr: true } : x);
    if (items.length >= limit) break;
  }
  const err = [krR, yhR].filter((r) => r.status === "rejected").map((r) => String(r.reason && r.reason.message || r.reason));
  const body = { items };
  if (!items.length && err.length) body.error = err.join(" | ");
  return new Response(JSON.stringify(body), { headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  }});
}
