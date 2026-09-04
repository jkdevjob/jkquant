// Cloudflare Pages Function — GET /api/search?q=SOX
// 티커 자동완성. 야후 검색을 엣지에서 중계해 동일 출처로 돌려준다.
// 전체 ETF 목록을 파일로 들고 있지 않는 이유: 신규 상장·상장폐지가 잦아 금세 낡는다.
// 라이브 검색이면 오늘 상장한 ETF도 바로 잡힌다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=600",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 앱이 다루는 것만 남긴다. 선물(FUTURE)·통화 같은 건 티커 칸에 들어가도 시세가 안 붙는다.
const KEEP = new Set(["ETF", "EQUITY", "INDEX", "MUTUALFUND"]);

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(20, Math.max(1, +url.searchParams.get("limit") || 10));
  if (q.length < 1) return new Response(JSON.stringify({ items: [] }), { headers: JH });

  const u = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}`
          + `&quotesCount=${limit * 2}&newsCount=0&listsCount=0&enableFuzzyQuery=false`;
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 600 } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const seen = new Set(), items = [];
    for (const x of (j.quotes || [])) {
      const t = String(x.quoteType || "").toUpperCase();
      if (!KEEP.has(t)) continue;
      let sym = String(x.symbol || "").toUpperCase();
      if (!sym) continue;
      // 국내상장 ETF는 앱이 6자리 종목코드(네이버 경로)로 다룬다 — 야후의 .KS/.KQ를 벗긴다
      const kr = /^(\d{6})\.(KS|KQ)$/.exec(sym);
      if (kr) sym = kr[1];
      if (seen.has(sym)) continue;
      seen.add(sym);
      items.push({
        symbol: sym,
        name: String(x.shortname || x.longname || "").slice(0, 60),
        type: t,
        exchange: String(x.exchange || ""),
        kr: !!kr,
      });
      if (items.length >= limit) break;
    }
    return new Response(JSON.stringify({ items }), { headers: JH });
  } catch (e) {
    return new Response(JSON.stringify({ items: [], error: e.message }), { headers: JH });
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  }});
}
