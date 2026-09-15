// Cloudflare Pages Function — GET /api/krsearch?q=레몬  → { items:[{code,name,market}] }
// 국내 개별종목 자동완성. 네이버 자동완성(ac.stock.naver.com)을 중계한다.
// /api/search 는 국내 ETF 목록만 훑어 개별종목(레몬헬스케어 등)이 안 잡히므로 공모주 기록 검색용으로 둔다.
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=600",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(20, Math.max(1, +url.searchParams.get("limit") || 12));
  if (!q) return new Response(JSON.stringify({ items: [] }), { headers: JH });
  try {
    const u = `https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock&st=1`;
    const r = await fetch(u, {
      headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" },
      cf: { cacheTtl: 600 },
    });
    if (r.ok) {
      const j = await r.json();
      const items = ((j && j.items) || [])
        .filter((x) => x && x.code && (x.nationCode === "KOR" || !x.nationCode))
        .map((x) => ({ code: String(x.code).toUpperCase(), name: x.name || "", market: x.typeName || "" }))
        .slice(0, limit);
      return new Response(JSON.stringify({ items, src: "naver-ac" }), { headers: JH });
    }
  } catch (e) {}
  return new Response(JSON.stringify({ items: [], error: "search failed" }), { status: 502, headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
