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

/* 미국 상장 전 종목 목록(나스닥트레이더 공식 파일, 1.3만 종·약 1MB).
   야후 검색은 이름 앞부분만 봐서 'covered call'·'ultrapro' 같은 가운데 토막으론
   아무것도 안 나왔다. 국내와 같은 이유로 목록을 받아 부분일치로 훑는다.
   야후를 버리지는 않는다 — 티커를 치는 경우엔 야후의 인기도 순위가 더 낫고,
   여기 없는 해외 거래소 종목(TQQQ.TO 같은)도 야후만 잡는다. */
const US_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt";
const US_TTL = 12 * 3600e3;
let _usCache = { at: 0, list: [] };

async function usSymbolList() {
  if (_usCache.list.length && Date.now() - _usCache.at < US_TTL) return _usCache.list;
  const r = await fetch(US_URL, { headers: { "User-Agent": UA }, cf: { cacheTtl: 43200, cacheEverything: true } });
  if (!r.ok) throw new Error("us list HTTP " + r.status);
  const lines = (await r.text()).split("\n");
  const list = [];
  for (let i = 1; i < lines.length; i++) {
    // 컬럼: 0 거래여부 | 1 티커 | 2 종목명 | 3 상장거래소 | 4 시장구분 | 5 ETF | 6 호가단위 | 7 테스트종목
    const c = lines[i].split("|");
    if (c.length < 12) continue;                       // 맨 끝 'File Creation Time' 줄
    if (c[7] === "Y") continue;                        // 테스트용 가짜 종목
    const symbol = c[1].trim().toUpperCase();
    if (!symbol || /[^A-Z0-9.]/.test(symbol)) continue;
    list.push({ symbol, name: c[2].trim(), etf: c[5] === "Y" });
  }
  if (list.length) _usCache = { at: Date.now(), list };   // 빈 응답으로 캐시를 덮지 않는다
  return _usCache.list;
}

// 'KODEX 200'과 'kodex200'을 같은 것으로 본다 — 공백·기호를 털고 대문자로.
const norm = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z가-힣ㄱ-ㆎ]/g, "");

/* 이름을 털어 붙이되, 각 글자가 '낱말의 첫 글자'였는지 같이 기억한다.
   해외 이름은 낱말이 띄어져 있어 아무 데나 걸리면 엉뚱한 게 나온다 —
   'TQQQ'가 'ProShares ShorT QQQ'의 가운데에 걸리던 식이다. 낱말 첫머리만 인정한다.
   낱말 경계로 보는 것: 기호·공백 다음, 소문자→대문자(UltraPro), 글자↔숫자(MidCap400). */
function normHead(str) {
  const s = String(str || "");
  let n = "", head = [], atHead = true, prev = "";
  for (const ch of s) {
    if (!/[0-9A-Za-z가-힣ㄱ-ㆎ]/.test(ch)) { atHead = true; prev = ""; continue; }
    const isUp = ch >= "A" && ch <= "Z", isDigit = ch >= "0" && ch <= "9";
    const prevLower = prev >= "a" && prev <= "z", prevDigit = prev >= "0" && prev <= "9";
    const prevAlpha = /[A-Za-z]/.test(prev);
    if ((isUp && prevLower) || (isDigit && prevAlpha) || (!isDigit && prevDigit)) atHead = true;
    n += ch.toUpperCase(); head.push(atHead); atHead = false; prev = ch;
  }
  return { n, head };
}

/* 부분일치 검색(LIKE %q%). 공백으로 끊은 토막을 각각 이름 어디서든 찾는다.
   '200'으로 'TIGER 200타겟위클리커버드콜'이 걸리게 하려는 것이 목적이다.
   코드 앞부분 일치는 4자 이상일 때만 본다 — '200'을 코드로 치는 사람은 없는데
   200250·200030 같은 게 'KODEX 200'을 밀어내고 앞에 서던 문제가 있었다. */
function sift(list, q, boundary) {
  const toks = q.split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return [];
  const qn = norm(q);
  const byCode = qn.length >= 4;
  const out = [];
  for (const it of list) {
    const { n, head } = normHead(it.name);
    const codeExact = it.symbol === qn ? 1 : 0;
    const codePrefix = !codeExact && byCode && it.symbol.startsWith(qn) ? 1 : 0;
    let hit = codeExact || codePrefix, first = 1e9;
    for (const t of toks) {
      // 알파벳 한 글자짜리 토막은 아무 이름에나 걸려 목록을 버린다. 한글은 한 자도 뜻이 있다
      if (t.length < 2 && !HANGUL.test(t)) continue;
      // 국내 이름은 '200타겟위클리커버드콜'처럼 붙여 쓰므로 낱말 경계를 따지지 않는다
      let i = n.indexOf(t);
      while (boundary && i >= 0 && !head[i]) i = n.indexOf(t, i + 1);
      if (i >= 0) { hit++; if (i < first) first = i; }
    }
    if (!hit) continue;
    out.push({ it, hit, codeExact, codePrefix, head: head[0] && n.startsWith(toks[0]) ? 1 : 0,
               first: Math.min(first, 99), len: Math.min(n.length, 99) });
  }
  return out;
}

/* 국내 순위. 기준을 점수 하나로 뭉개지 않고 차례로 본다 — 어느 기준이 이겼는지 읽히게.
   마지막 손잡이가 시가총액인 이유: '커버드콜'처럼 100개가 걸리는 말은 이름만 봐선
   순서를 정할 근거가 없다. 그럴 땐 실제로 거래되는 큰 것부터 보여주는 게 맞다.
   '이름 안에서 더 앞'을 위에 뒀더니 브랜드명이 짧다는 이유로 '1Q 200액티브'가
   'KODEX 200'을 밀어냈다 — 글자 위치는 '무엇을 찾는지'와 상관이 없었다. */
function krSearch(list, q, limit) {
  return sift(list, q, false).sort((a, b) =>
      b.codeExact - a.codeExact || b.hit - a.hit || b.codePrefix - a.codePrefix ||
      b.head - a.head || b.it.cap - a.it.cap || a.first - b.first)
    .slice(0, limit).map(({ it }) => ({
      symbol: it.symbol, name: it.name.slice(0, 60), type: "ETF", exchange: "KRX", kr: true,
    }));
}

/* 해외 순위. 국내와 달리 시가총액이 목록에 없다. 대신 ETF 여부를 쓴다 —
   이 앱은 ETF를 다루므로 같은 말이 걸리면 ETF가 먼저다. 그다음이 짧은 이름:
   'Schwab US Dividend Equity ETF'가 'Schwab US Dividend Equity ETF 2x Daily'보다
   찾는 것일 확률이 높다. 마지막은 티커 알파벳순 — 같은 조건이면 순서가 흔들리지 않게. */
function usSearch(list, q, limit) {
  return sift(list, q, true).sort((a, b) =>
      b.codeExact - a.codeExact || b.hit - a.hit || b.codePrefix - a.codePrefix ||
      b.it.etf - a.it.etf || b.head - a.head || a.len - b.len ||
      (a.it.symbol < b.it.symbol ? -1 : a.it.symbol > b.it.symbol ? 1 : 0))
    .slice(0, limit).map(({ it }) => ({
      symbol: it.symbol, name: it.name.slice(0, 60), type: it.etf ? "ETF" : "EQUITY", exchange: "US", kr: false,
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
  // 한글 질의는 야후·미국 목록이 답을 못 낸다(국내 종목이 영문명으로만 실려 있다)
  const [krR, usR, yhR] = await Promise.allSettled([
    krEtfList().then((l) => krSearch(l, q, limit)),
    hangul ? [] : usSymbolList().then((l) => usSearch(l, q, limit)),
    hangul ? [] : yahooSearch(q, limit),
  ]);
  const val = (r) => (r.status === "fulfilled" ? r.value : []);
  const krItems = val(krR), usItems = val(usR), yhItems = val(yhR);

  /* 순서를 가르는 것은 '티커를 쳤나, 이름을 쳤나'다.
       숫자만        → 국내 종목코드거나 'KODEX 200' 쪽이다.
       짧은 한 토막  → 티커다. 야후의 인기도 순위가 목록 훑기보다 낫다 (SCHD·TQQQ).
       그 밖         → 이름 조각이다. 목록 부분일치가 먼저 ('covered call'·'ultrapro').
     야후는 이름 앞부분만 보므로 이름 조각을 맡기면 엉뚱한 걸 앞에 세운다. */
  const tickerish = /^[A-Za-z0-9.]{1,5}$/.test(q);
  const order = hangul || /^[\d\s]+$/.test(q) ? [krItems, yhItems, usItems]
              : tickerish                       ? [yhItems, usItems, krItems]
              :                                   [usItems, krItems, yhItems];

  // 국내 종목은 한글 이름이 있으면 그걸 쓴다 — 야후는 영문명뿐이라 알아보기 어렵다
  const krName = new Map(krItems.map((x) => [x.symbol, x.name]));
  const seen = new Set(), items = [];
  for (const x of [].concat(...order)) {
    if (seen.has(x.symbol)) continue;
    seen.add(x.symbol);
    items.push(krName.has(x.symbol) ? { ...x, name: krName.get(x.symbol), kr: true } : x);
    if (items.length >= limit) break;
  }
  const err = [krR, usR, yhR].filter((r) => r.status === "rejected")
    .map((r) => String((r.reason && r.reason.message) || r.reason));
  const body = { items };
  if (!items.length && err.length) body.error = err.join(" | ");
  return new Response(JSON.stringify(body), { headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  }});
}
