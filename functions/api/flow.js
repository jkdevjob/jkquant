// Cloudflare Pages Function — GET /api/flow?code=005930[&pages=10]
// 외국인·기관 일별 순매매. 24절에서 "검증 못 한 데이터"로 남겨둔 수급을 채우기 위한 것.
// 네이버 금융의 투자자별 매매동향 표를 파싱한다. 키 불필요.
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const KRCODE = /^(?:\d{6}|\d{4}[A-Z]\d)$/;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: JH });
const num = (t) => { const v = String(t).replace(/[,\s]/g, "").replace(/&nbsp;/g, ""); 
  if (!v || v === "-") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/* 네이버 모바일 API 응답 → 표준형
   foreignerPureBuyQuant / organPureBuyQuant / individualPureBuyQuant 는
   "+4,266,985" 처럼 부호와 콤마가 섞여 온다. */
function n(v) {
  if (v == null) return null;
  const t = String(v).replace(/[,%\s]/g, "");
  if (!t || t === "-") return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
}
function parseTrend(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => {
    const d = String(r.bizdate || "");
    if (!/^\d{8}$/.test(d)) return null;
    return {
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      close: n(r.closePrice),
      frgn: n(r.foreignerPureBuyQuant),        // 외국인 순매수 (주)
      inst: n(r.organPureBuyQuant),            // 기관 순매수 (주)
      indi: n(r.individualPureBuyQuant),       // 개인 순매수 (주)
      frgnRate: n(r.foreignerHoldRatio),       // 외국인 보유율 %
      accVol: n(r.accumulatedTradingVolume),
    };
  }).filter(Boolean);
}

/* 수급 데이터 소스 후보 — 네이버가 Next.js 로 바뀌며 옛 표가 사라졌다.
   어디서 받을 수 있는지 찾기 위한 탐색. URL 은 코드에 고정한다(열린 프록시 방지). */
function probeUrls(code) {
  return [
    ["naver-m-trend",   `https://m.stock.naver.com/api/stock/${code}/trend`],
    ["naver-m-investor",`https://m.stock.naver.com/api/stock/${code}/investor`],
    ["naver-api-trend", `https://api.stock.naver.com/stock/${code}/trend`],
    ["naver-frgn-json", `https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&count=30&timeframe=day`],
    ["naver-m-integ",   `https://m.stock.naver.com/api/stock/${code}/integration`],
    ["naver-m-price",   `https://m.stock.naver.com/api/stock/${code}/price?pageSize=30&page=1`],
  ];
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").toUpperCase().trim();
  if (!KRCODE.test(code)) return json({ error: "종목코드가 올바르지 않습니다." }, 400);
  const pages = Math.min(30, Math.max(1, parseInt(url.searchParams.get("pages") || "3", 10)));
  const debug = url.searchParams.get("debug") === "1";

  if (url.searchParams.get("probe") === "1") {
    const res = [];
    for (const [name, u] of probeUrls(code)) {
      try {
        const r = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://m.stock.naver.com/" } });
        const t = await r.text();
        res.push({ name, status: r.status, len: t.length,
          head: t.slice(0, 260).replace(/\s+/g, " "),
          hasFlow: /외국인|기관|foreign|institution|frgn|orgn/i.test(t) });
      } catch (e) { res.push({ name, error: String(e.message || e) }); }
    }
    return json({ code, probe: res });
  }

  const all = [];
  const notes = [];
  {
    const u = `https://m.stock.naver.com/api/stock/${code}/trend`;
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://m.stock.naver.com/", accept: "application/json" } });
      if (!r.ok) notes.push(`HTTP ${r.status}`);
      else {
        const j = await r.json().catch(() => null);
        const rows = parseTrend(j);
        if (!rows.length) notes.push("파싱 결과 없음");
        all.push(...rows);
      }
    } catch (e) { notes.push(String(e.message || e)); }
  }
  const seen = new Set(); const uniq = [];
  for (const r of all) { if (!seen.has(r.date)) { seen.add(r.date); uniq.push(r); } }
  uniq.sort((a, b) => a.date < b.date ? -1 : 1);
  return json(debug ? { code, n: uniq.length, notes, rows: uniq }
                    : { code, n: uniq.length, rows: uniq });
}
