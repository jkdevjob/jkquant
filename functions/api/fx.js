// Cloudflare Pages Function — GET /api/fx  → { rate, date }
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=60",
};
const UA = "Mozilla/5.0 (compatible; JKQuant/1.0)";
const HIST_JH = { ...JH, "Cache-Control": "public, max-age=86400" };

/* 과거 날짜의 환율. 모의 성과에서 '시작 시점 환율로 달러 환산'을 하려면
   오늘 값이 아니라 그 날의 값이 있어야 한다. 주말·공휴일이면 그 직전 영업일 값이 온다.
   frankfurter는 ECB 고시(한국시간 밤), 야후는 장중 종가라 몇 원 차이가 난다 — 둘 다 근사다. */
async function historical(date) {
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${date}?base=USD&symbols=KRW`, { headers: { "User-Agent": UA }, cf: { cacheTtl: 86400 } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.KRW) return { rate: +(+j.rates.KRW).toFixed(2), date: j.date || date, src: "frankfurter" };
    }
  } catch (e) {}
  // 야후 폴백 — 요청일 앞뒤 10일을 받아 그 날 이하의 마지막 값을 쓴다(휴장일 대비)
  try {
    const t = Math.floor(new Date(date + "T00:00:00Z").getTime() / 1000);
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&period1=${t - 864000}&period2=${t + 86400}`,
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 86400 } });
    if (r.ok) {
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      const ts = res && res.timestamp, cl = res && res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close;
      if (ts && cl) {
        for (let i = ts.length - 1; i >= 0; i--) {
          const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
          if (d <= date && cl[i] > 0) return { rate: +(+cl[i]).toFixed(2), date: d, src: "yahoo" };
        }
      }
    }
  } catch (e) {}
  return null;
}

export async function onRequestGet({ request }) {
  const want = new URL(request.url).searchParams.get("date");
  if (want && /^\d{4}-\d{2}-\d{2}$/.test(want)) {
    const h = await historical(want);
    if (h) return new Response(JSON.stringify(h), { headers: HIST_JH });
    return new Response(JSON.stringify({ error: "no fx for " + want }), { status: 502, headers: HIST_JH });
  }
  // 현재 환율은 장중 움직임을 반영하는 Yahoo KRW=X를 먼저 사용한다.
  // 일일 고시형 소스는 폴백으로만 둔다. 화면의 원화 환산이 과거/고시 환율에 묶이지 않게 한다.
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1m&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", "Accept": "application/json", "Referer": "https://finance.yahoo.com/" }, cf: { cacheTtl: 60 } });
    if (r.ok) {
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      const meta = res && res.meta;
      const p = meta && meta.regularMarketPrice;
      if (p) {
        const tm = meta && meta.regularMarketTime;
        const asof = tm ? new Date(tm * 1000).toISOString() : new Date().toISOString();
        return new Response(JSON.stringify({ rate: +(+p).toFixed(2), date: asof.slice(0, 10), asof, src: "yahoo-live" }), { headers: JH });
      }
    }
  } catch (e) {}
  // 실시간 소스 실패 시 일일 환율 소스로 폴백한다.
  try {
    const r = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=KRW", { headers: { "User-Agent": UA }, cf: { cacheTtl: 300 } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.KRW) {
        return new Response(JSON.stringify({ rate: +(+j.rates.KRW).toFixed(2), date: j.date || null, src: "exchangerate.host" }), { headers: JH });
      }
    }
  } catch (e) {}
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=KRW", { headers: { "User-Agent": UA }, cf: { cacheTtl: 300 } });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates && j.rates.KRW) {
        return new Response(JSON.stringify({ rate: +(+j.rates.KRW).toFixed(2), date: j.date || null, src: "frankfurter" }), { headers: JH });
      }
    }
  } catch (e) {}
  return new Response(JSON.stringify({ error: "no fx" }), { status: 502, headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}

