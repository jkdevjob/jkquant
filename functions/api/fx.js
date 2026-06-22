// Cloudflare Pages Function — GET /api/fx  → { rate, date }
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=3600",
};
const UA = "Mozilla/5.0 (compatible; JKQuant/1.0)";

export async function onRequestGet() {
  try {
    const r = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=KRW", { headers: { "User-Agent": UA }, cf: { cacheTtl: 3600 } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.KRW) {
        return new Response(JSON.stringify({ rate: +(+j.rates.KRW).toFixed(2), date: j.date || null, src: "exchangerate.host" }), { headers: JH });
      }
    }
  } catch (e) {}
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=KRW", { headers: { "User-Agent": UA }, cf: { cacheTtl: 3600 } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.KRW) {
        return new Response(JSON.stringify({ rate: +(+j.rates.KRW).toFixed(2), date: j.date || null, src: "frankfurter" }), { headers: JH });
      }
    }
  } catch (e) {}
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=5d", { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 3600 } });
    if (r.ok) {
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      const p = res && res.meta && res.meta.regularMarketPrice;
      if (p) return new Response(JSON.stringify({ rate: +(+p).toFixed(2), date: new Date().toISOString().slice(0, 10), src: "yahoo" }), { headers: JH });
    }
  } catch (e) {}
  return new Response(JSON.stringify({ error: "no fx" }), { status: 502, headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}

