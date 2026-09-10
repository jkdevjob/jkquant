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

/* 한 페이지(20행) 파싱 — 날짜·종가·전일비·등락률·거래량·기관순매매·외국인순매매·보유주수·보유율 */
function parsePage(html) {
  const out = [];
  // 표의 각 행: 날짜가 있는 tr 만 취한다
  const rows = html.split(/<tr[^>]*>/i).slice(1);
  for (const r of rows) {
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m =>
      m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
    if (tds.length < 9) continue;
    const d = tds[0].match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!d) continue;
    out.push({
      date: `${d[1]}-${d[2]}-${d[3]}`,
      close: num(tds[1]),
      vol: num(tds[4]),
      inst: num(tds[5]),      // 기관 순매매 (주)
      frgn: num(tds[6]),      // 외국인 순매매 (주)
      frgnHold: num(tds[7]),  // 외국인 보유주수
      frgnRate: num(tds[8]),  // 외국인 보유율 %
    });
  }
  return out;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const code = String(url.searchParams.get("code") || "").toUpperCase().trim();
  if (!KRCODE.test(code)) return json({ error: "종목코드가 올바르지 않습니다." }, 400);
  const pages = Math.min(30, Math.max(1, parseInt(url.searchParams.get("pages") || "3", 10)));
  const debug = url.searchParams.get("debug") === "1";

  const all = [];
  const notes = [];
  for (let p = 1; p <= pages; p++) {
    const u = `https://finance.naver.com/item/frgn.naver?code=${code}&page=${p}`;
    try {
      const r = await fetch(u, { headers: { "User-Agent": UA, Referer: "https://finance.naver.com/" } });
      if (!r.ok) { notes.push(`p${p} HTTP ${r.status}`); break; }
      const buf = await r.arrayBuffer();
      const html = new TextDecoder("euc-kr").decode(buf);   // 네이버 금융은 EUC-KR
      const rows = parsePage(html);
      if (!rows.length) { notes.push(`p${p} 행 없음`); break; }
      all.push(...rows);
    } catch (e) { notes.push(`p${p} ${String(e.message || e)}`); break; }
  }
  const seen = new Set(); const uniq = [];
  for (const r of all) { if (!seen.has(r.date)) { seen.add(r.date); uniq.push(r); } }
  uniq.sort((a, b) => a.date < b.date ? -1 : 1);
  return json(debug ? { code, n: uniq.length, notes, rows: uniq }
                    : { code, n: uniq.length, rows: uniq });
}
