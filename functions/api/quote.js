// Cloudflare Pages Function — GET /api/quote?symbol=TQQQ[&range=1y][&debug=1]
// 엣지에서 시세 수집 → 동일 출처 반환. 키 불필요.
// 소스 다양화: Yahoo(query1/query2/fc) → Stooq. 디버그 모드로 각 소스 상태 확인 가능.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ───────────────────────────────────────────────────────────
// [선택] 실시간 시세를 100% 보장하려면 Finnhub 무료 키를 넣으세요.
//   1. https://finnhub.io 가입 (이메일만, 무료) → API key 복사
//   2. 아래 따옴표 안에 붙여넣기:  const INLINE_FINNHUB_KEY = "여기에키";
//   (또는 Cloudflare Pages → 설정 → 환경변수에 FINNHUB_KEY 추가)
// 키가 없으면 Yahoo→Stooq 폴백으로 동작합니다 (실시간이 막힐 수 있음).
const INLINE_FINNHUB_KEY = "";
// ───────────────────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbol = (url.searchParams.get("symbol") || "TQQQ").toUpperCase().trim();
  const range = url.searchParams.get("range") || "1y";
  const debug = url.searchParams.get("debug") === "1";
  const wantIntraday = url.searchParams.get("intraday") !== "0";

  // Finnhub 키: Cloudflare 환경변수(FINNHUB_KEY) 또는 아래 상수에 직접 입력
  const FINNHUB_KEY = (env && env.FINNHUB_KEY) || INLINE_FINNHUB_KEY || "";

  const dbg = [];
  let series = [], ohlc = [], price = null, marketState = null, currency = "USD", src = null, intraday = null;

  // ── 국내상장 ETF (6자리 숫자 종목코드, 예: 423920) → 네이버 금융 ──
  if (/^\d{6}$/.test(symbol)) {
    try {
      const kr = await naverDaily(symbol, range, dbg);
      if (kr && kr.series.length) {
        const last = kr.series[kr.series.length - 1];
        const out = { symbol, currency: "KRW", src: "naver", price: kr.price != null ? kr.price : last.close, marketState: null, last, series: kr.series, ohlc: kr.ohlc, intraday: null };
        if (debug) out.debug = dbg;
        return new Response(JSON.stringify(out), { headers: JH });
      }
    } catch (e) { dbg.push(`naver: ${e.message}`); }
    return new Response(JSON.stringify({ error: "no data", symbol, debug: dbg }), { status: 502, headers: JH });
  }

  // 0) Finnhub 실시간가 (키 있을 때) — 가장 정확한 현재가
  if (FINNHUB_KEY) {
    try {
      const fr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`, { cf: { cacheTtl: 15 } });
      dbg.push(`finnhub quote: HTTP ${fr.status}`);
      if (fr.ok) { const fj = await fr.json(); if (fj && fj.c) { price = +fj.c; src = "finnhub"; } }
    } catch (e) { dbg.push(`finnhub: ${e.message}`); }
  }

  // 1) range=max → Stooq 먼저 (전체 상장 이후 일간 데이터 확보)
  if (range === "max") {
    try {
      const s = await stooqDaily(symbol, dbg);
      if (s && s.ohlc && s.ohlc.length > 200) {
        series = s.series; ohlc = s.ohlc; if (!src) src = "stooq";
      }
    } catch (e) { dbg.push(`stooq-max: ${e.message}`); }
  }

  // 2) Yahoo daily — Stooq 미확보 시 또는 range≠max
  if (!series.length) for (const host of ["query1", "query2", "query1-fc"]) {
    const realHost = host === "query1-fc" ? "query1" : host;
    try {
      const y = await yahooDaily(realHost, symbol, range, dbg);
      if (y && y.series.length) {
        series = y.series; ohlc = y.ohlc; if (price == null) price = y.price; marketState = y.marketState; currency = y.currency;
        if (!src) src = "yahoo-" + realHost;
        break;
      }
    } catch (e) { dbg.push(`yahooDaily ${host}: ${e.message}`); }
  }

  // 3) Stooq 폴백 (Yahoo도 실패한 경우)
  if (!series.length) {
    try {
      const s = await stooqDaily(symbol, dbg);
      if (s && s.ohlc && s.ohlc.length) {
        series = s.series; ohlc = s.ohlc;
        if (price == null && s.series.length) price = s.series[s.series.length - 1].close;
        src = "stooq";
      }
    } catch (e) { dbg.push(`stooq: ${e.message}`); }
  }

  // 3) 실시간가 보강 (Yahoo quote)
  if (series.length && price == null) {
    try { const q = await yahooQuote(symbol, dbg); if (q && q.price != null) { price = q.price; marketState = q.marketState || marketState; } }
    catch (e) { dbg.push(`yahooQuote: ${e.message}`); }
  }

  // 4) 인트라데이
  if (wantIntraday && series.length) {
    try { intraday = await yahooIntraday(symbol, dbg); } catch (e) { dbg.push(`intraday: ${e.message}`); intraday = null; }
  }

  if (!series.length) {
    return new Response(JSON.stringify({ error: "no data", symbol, debug: dbg }), { status: 502, headers: JH });
  }
  const last = series[series.length - 1];
  if (price == null) price = last.close;

  const out = { symbol, currency, src, price: +(+price).toFixed(4), marketState, last, series, ohlc, intraday };
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
  const r = await fetch(u, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://finance.yahoo.com/", "Origin": "https://finance.yahoo.com" }, cf: { cacheTtl: 60 } });
  dbg && dbg.push(`yahooDaily ${host}: HTTP ${r.status}`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error("empty result");
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const adjA = (res.indicators && res.indicators.adjclose && res.indicators.adjclose[0] && res.indicators.adjclose[0].adjclose) || [];
  const closeA = adjA.length ? adjA : (q.close || []);  // adjclose 우선 (DRIP 반영), 없으면 raw close
  const openA = q.open || [], highA = q.high || [], lowA = q.low || [];
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
  dbg && dbg.push(`intraday: HTTP ${r.status}`);
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
  dbg && dbg.push(`yahooQuote: HTTP ${r.status}`);
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
      const r = await fetch(u, { headers: { "User-Agent": UA }, cf: { cacheTtl: 3600 } });
      dbg && dbg.push(`stooq ${host}: HTTP ${r.status}`);
      if (!r.ok) continue;
      const txt = await r.text();
      const rows = txt.trim().split("\n");
      if (rows.length < 2 || !/date/i.test(rows[0])) { dbg && dbg.push(`stooq ${host}: bad format`); continue; }
      const hdr = rows[0].split(",");
      const di=hdr.findIndex(h=>/date/i.test(h)), oi=hdr.findIndex(h=>/open/i.test(h));
      const hi=hdr.findIndex(h=>/high/i.test(h)), li=hdr.findIndex(h=>/low/i.test(h));
      const ci=hdr.findIndex(h=>/close/i.test(h));
      const series = [], ohlc = [];
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i].split(",");
        const c = +a[ci]; if (!(c > 0)) continue;
        const d = a[di];
        series.push({ date: d, close: +c.toFixed(4) });
        ohlc.push({ date: d,
          open:  oi>=0 && +a[oi]>0 ? +a[oi] : c,
          high:  hi>=0 && +a[hi]>0 ? +a[hi] : c,
          low:   li>=0 && +a[li]>0 ? +a[li] : c,
          close: +c.toFixed(4) });
      }
      series.reverse(); ohlc.reverse();  // Stooq는 최신순 → 오래된 것부터
      if (series.length) return { series, ohlc };
    } catch (e) { dbg && dbg.push(`stooq ${host}: ${e.message}`); }
  }
  return { series: [], ohlc: [] };
}
// 국내상장 종목/ETF 일봉 — 네이버 금융 (fchart siseJson)
// 응답은 엄격한 JSON이 아니라 JS 배열 리터럴 텍스트라서 정규화 후 파싱.
async function naverDaily(code, range, dbg) {
  // 기간 → 시작일 계산
  const days = range === "3mo" ? 90 : range === "6mo" ? 180 : range === "5d" ? 10 : 400;
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const u = `https://fchart.stock.naver.com/siseJson.nhn?symbol=${code}&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`;
  const r = await fetch(u, { headers: { "User-Agent": UA, "Referer": "https://finance.naver.com/" }, cf: { cacheTtl: 60 } });
  dbg && dbg.push(`naver ${code}: HTTP ${r.status}`);
  if (!r.ok) throw new Error("HTTP " + r.status);
  let txt = await r.text();
  // 텍스트 정규화: 작은따옴표 → 큰따옴표, 트레일링 콤마/개행 제거
  txt = txt.replace(/'/g, '"').replace(/\n/g, "").replace(/\t/g, "").trim();
  // 맨 끝 ] 앞의 콤마 정리
  txt = txt.replace(/,\s*]/g, "]");
  let arr;
  try { arr = JSON.parse(txt); } catch (e) {
    // 일부 응답은 끝에 잘린 콤마가 있어 한 번 더 시도
    txt = txt.replace(/,\s*$/, "");
    if (!txt.endsWith("]")) txt += "]";
    arr = JSON.parse(txt);
  }
  if (!Array.isArray(arr) || arr.length < 2) throw new Error("empty");
  // arr[0] = 헤더 ["날짜","시가","고가","저가","종가","거래량",...]
  const series = [], ohlc = [];
  for (let i = 1; i < arr.length; i++) {
    const row = arr[i];
    if (!row || row.length < 5) continue;
    const ds = String(row[0]); // 20260101
    const date = ds.length === 8 ? `${ds.slice(0,4)}-${ds.slice(4,6)}-${ds.slice(6,8)}` : ds;
    const o = +row[1], h = +row[2], l = +row[3], c = +row[4];
    if (!(c > 0)) continue;
    series.push({ date, close: c });
    ohlc.push({ date, open: o || c, high: h || c, low: l || c, close: c });
  }
  if (!series.length) throw new Error("no rows");
  return { series, ohlc, price: series[series.length - 1].close };
}
