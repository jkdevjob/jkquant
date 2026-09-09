// Cloudflare Pages Function — /api/universe?limit=100
// 스크리닝 유니버스: 네이버 m.stock 시가총액 순위(KOSPI+KOSDAQ)를 받아
// 거래대금(accumulatedTradingValue) 기준으로 재정렬해 상위 N을 돌려준다.
// 단타는 유동성이 생명이라 '거래대금 상위'가 사실상 후보 전체다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=180",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const num = (s) => parseInt(String(s == null ? "" : s).replace(/[^0-9]/g, ""), 10) || 0;

async function rank(market, size) {
  const r = await fetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=1&pageSize=${size}`, {
    headers: { "User-Agent": UA, "Referer": "https://m.stock.naver.com/" },
    cf: { cacheTtl: 180, cacheEverything: true },
  });
  if (!r.ok) throw new Error(market + " HTTP " + r.status);
  const j = await r.json();
  return (j.stocks || []).map((s) => ({
    code: String(s.itemCode || "").toUpperCase(),
    name: String(s.stockName || ""),
    market,
    amount: num(s.accumulatedTradingValue),   // 거래대금(백만원)
    cap: num(s.marketValue),                   // 시총(백만원)
    chg: parseFloat(String(s.fluctuationsRatio || "0")) || 0,
    close: num(s.closePrice),
  })).filter((x) => /^(?:\d{6}|\d{4}[A-Z]\d)$/.test(x.code));
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get("limit") || "100", 10);
  if (!(limit > 0)) limit = 100;
  limit = Math.min(limit, 250);
  try {
    const [a, b] = await Promise.all([
      rank("KOSPI", 200).catch(() => []),
      rank("KOSDAQ", 150).catch(() => []),
    ]);
    const all = a.concat(b);
    if (!all.length) return new Response(JSON.stringify({ error: "유니버스 조회 실패(네이버 응답 없음)" }), { status: 502, headers: JH });
    all.sort((x, y) => y.amount - x.amount);
    return new Response(JSON.stringify({ count: all.length, universe: all.slice(0, limit) }), { headers: JH });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: JH });
  }
}
