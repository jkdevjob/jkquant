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
      if (fr.ok) { const fj = await fr.json(); if (fj && fj.c) { price = +fj.c; src = "finnhub"; } }
    } catch (e) {}
  }

  for (const host of ["query1", "query2"]) {
    try {
      const y = await yahooDaily(host, symbol, range, dbg);
      if (y && y.series.length) {
        series = y.series; ohlc = y.ohlc; if (price == null) price = y.price; marketState = y.marketState; currency = y.currency;
        if (!src) src = "yahoo-" + host;
        break;
      }
    } catch (e) { dbg.push(`yahooDaily ${host}: ${e.message}`); }
  }

  if (!series.length) {
    try {
      const s = await stooqDaily(symbol, dbg);
      if (s.series.length) {
        series = s.series;
        ohlc = s.series.map(d => ({ date: d.date, open: d.close, high: d.close, low: d.close, close: d.close }));
        if (price == null) price = s.series[s.series.length - 1].close;
        src = "stooq";
      }
    } catch (e) { dbg.push(`stooq: ${e.message}`); }
  }

  if (series.length && price == null) {
    try { const q = await yahooQuote(symbol, dbg); if (q && q.price != null) { price = q.price; marketState = q.marketState || marketState; } } catch (e) {}
  }

  if (wantIntraday && series.length) {
    try { intraday = await yahooIntraday(symbol, dbg); } catch (e) { intraday = null; }
  }

  if (!series.length) {
    return new Response(JSON.stringify({ error: "no data", symbol, debug: dbg }), { status: 502, headers: JH });
  }
  const last = series[series.length - 1];
  if (price == null) price = last.close;
  const out = { symbol, currency, src, price: +(+price).toFixed(4), marketState, last, series, ohlc: ohlc.slice(-20), intraday };
  if (debug) out.debug = dbg;
  return new Response(JSON.stringify(out), { headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type",
  }});
}

async function yahooDaily(host, symbol, range, dbg) {
  const u = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${encodeURIComponent(range)}&includePrePost=false`;
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error("empty result");
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const closeA = q.close || [], openA = q.open || [], highA = q.high || [], lowA = q.low || [];
  const series = [], ohlc = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closeA[i]; if (c == null) continue;
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    series.push({ date: d, close: +(+c).toFixed(4) });
    ohlc.push({ date: d, open: openA[i] != null ? +(+openA[i]).toFixed(4) : +c, high: highA[i] != null ? +(+highA[i]).toFixed(4) : +c, low: lowA[i] != null ? +(+lowA[i]).toFixed(4) : +c, close: +(+c).toFixed(4) });
  }
  const meta = res.meta || {};
  return { series, ohlc, price: meta.regularMarketPrice != null ? +meta.regularMarketPrice : null, marketState: meta.marketState || null, currency: meta.currency || "USD" };
}

async function yahooIntraday(symbol, dbg) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d&includePrePost=true`;
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 60 } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error("empty");
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const O = q.open || [], H = q.high || [], L = q.low || [], C = q.close || [];
  const meta = res.meta || {};
  const tp = meta.currentTradingPeriod || {};
  const regStart = tp.regular ? tp.regular.start : null, regEnd = tp.regular ? tp.regular.end : null;
  const preStart = tp.pre ? tp.pre.start : null, postEnd = tp.post ? tp.post.end : null;
  function agg(f) {
    let o = null, h = -Infinity, l = Infinity, c = null, has = false;
    for (let i = 0; i < ts.length; i++) { if (!f(ts[i])) continue; const ci = C[i]; if (ci == null) continue; if (!has) { o = O[i] != null ? O[i] : ci; has = true; } if (H[i] != null && H[i] > h) h = H[i]; if (L[i] != null && L[i] < l) l = L[i]; c = ci; }
    if (!has) return null; return { o: +(+o).toFixed(2), h: +(+h).toFixed(2), l: +(+l).toFixed(2), c: +(+c).toFixed(2) };
  }
  const pre = (preStart != null && regStart != null) ? agg(t => t >= preStart && t < regStart) : null;
  const regular = (regStart != null && regEnd != null) ? agg(t => t >= regStart && t < regEnd) : agg(() => true);
  const post = (regEnd != null) ? agg(t => t >= regEnd && (postEnd == null || t < postEnd + 60)) : null;
  const dateStr = ts.length ? new Date(ts[ts.length - 1] * 1000).toISOString().slice(0, 10) : null;
  if (!pre && !regular && !post) return null;
  return { pre, regular, post, date: dateStr };
}

async function yahooQuote(symbol, dbg) {
  const u = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 30 } });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const q = j && j.quoteResponse && j.quoteResponse.result && j.quoteResponse.result[0];
  if (!q) throw new Error("empty");
  return { price: q.regularMarketPrice != null ? +q.regularMarketPrice : null, marketState: q.marketState || null };
}

async function stooqDaily(symbol, dbg) {
  for (const host of ["stooq.com", "stooq.pl"]) {
    try {
      const u = `https://${host}/q/d/l/?s=${symbol.toLowerCase()}.us&i=d`;
      const r = await fetch(u, { headers: { "User-Agent": UA }, cf: { cacheTtl: 60 } });
      if (!r.ok) continue;
      const txt = await r.text();
      const lines = txt.trim().split("\n");
      if (lines.length < 2 || !/date/i.test(lines[0])) continue;
      const hdr = lines[0].split(","), di = hdr.indexOf("Date"), ci = hdr.indexOf("Close");
      const series = [];
      for (let i = 1; i < lines.length; i++) { const a = lines[i].split(","), c = +a[ci]; if (c > 0) series.push({ date: a[di], close: +c.toFixed(4) }); }
      if (series.length) return { series };
    } catch (e) {}
  }
  return { series: [] };
}
