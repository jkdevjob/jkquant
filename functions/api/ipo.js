// Cloudflare Pages Function — GET /api/ipo  → { items:[...], src, updated }
// 국내 공모주 일정. 네이버 모바일 IPO API를 정규화해서 돌려준다.
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=1800",
};
const UA = "Mozilla/5.0 (compatible; JKQuant/1.0)";

function ymd(s) {
  s = String(s || "");
  if (!/^\d{8}$/.test(s)) return "";
  return s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
}
function num(v) {
  if (v == null || v === "") return null;
  const n = +String(v).replace(/,/g, "");
  return isFinite(n) ? n : null;
}
const MARKET = { D: "코스닥", Y: "코스피", K: "코넥스" };

export async function onRequestGet() {
  try {
    const r = await fetch("https://m.stock.naver.com/api/stocks/ipo", {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      cf: { cacheTtl: 1800 },
    });
    if (r.ok) {
      const j = await r.json();
      const arr = (j && j.ipoCoInfos) || [];
      const items = arr.map((x) => ({
        name: x.itemName || "",
        code: String(x.itemCode || "").replace(/^A/, ""),
        poPrice: num(x.poPrice),
        bandLo: num(x.expectedPoStart),
        bandHi: num(x.expectedPoEnd),
        subStart: ymd(x.poStartDate),
        subEnd: ymd(x.poEndDate),
        listDate: ymd(x.listedDueDate),
        leadManager: x.leadManager || "",
        instRate: num(x.instituteCompRate),
        subRate: num(x.subscriptCompRate),
        status: x.ipoStatus || "",
        market: MARKET[x.marketClasses] || x.marketClasses || "",
        url: x.endUrl || "",
      })).filter((x) => x.name);
      return new Response(JSON.stringify({ items, src: "naver", updated: Date.now() }), { headers: JH });
    }
  } catch (e) {}
  return new Response(JSON.stringify({ items: [], error: "fetch failed" }), { status: 502, headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
