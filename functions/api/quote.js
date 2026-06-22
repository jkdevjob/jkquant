// Cloudflare Pages Function — GET /api/quote?symbol=TQQQ
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const INLINE_FINNHUB_KEY = "";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "TQQQ").toUpperCase().trim();
  const range = url.searchParams.get("range") || "1y";
  const debug = url.searchParams.get("debug") === "1";
  const wantIntraday = url.searchParams.get("intraday") !== "0";
  const FINNHUB_KEY = (env && env.FINNHUB_KEY) || INLINE_FINNHUB_KEY || "";
  const dbg = [];
  let series = [], ohlc = [], price = null, marketState = null, currency = "USD", src = null, intraday = null;

  if (FINNHUB_KEY) {
    try {
      const fr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`, { cf: { cacheTtl: 15 } });
      dbg.push(`finnhub quote: HTTP ${fr.status}`);
      if (fr.ok) { const fj = await fr.json(); if (fj && fj.c) { price = +fj.c; src = "finnhub"; } }
    } catch (e) { dbg.push(`finnhub: ${e.message}`); }
  }

  for (const host of ["query1", "query2"]) {
    try {
      const y = await yahooDaily(host, symbol, range, dbg);
      if (y && y.series.length) {
        series = y.series; ohlc = y.ohlc; if (price == null) price = y.price; marketState = y.marketState; currency = y.currency;
        if (!src) src = "yahoo-" + host;
        break;
      }

