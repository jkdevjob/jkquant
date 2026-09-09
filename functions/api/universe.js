// Cloudflare Pages Function — /api/universe?limit=100
// 스크리닝 유니버스: 네이버 m.stock 시가총액 순위(KOSPI+KOSDAQ)를 받아
// 거래대금(accumulatedTradingValue) 기준으로 재정렬해 상위 N을 돌려준다.
// 단타는 유동성이 생명이라 '거래대금 상위'가 사실상 후보 전체다.
// ※ m.stock는 pageSize 최대 100. 그 이상은 빈 응답 → 페이지로 나눠 받는다.

const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=180",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const num = (s) => parseInt(String(s == null ? "" : s).replace(/[^0-9]/g, ""), 10) || 0;
const KRCODE = /^(?:\d{6}|\d{4}[A-Z]\d)$/;

// 라이브 조회가 막혔을 때만 쓰는 폴백(유동성 상위 대형주). 스크리닝은 이걸로도 돈다.
const FALLBACK = [
  ["005930","삼성전자"],["000660","SK하이닉스"],["373220","LG에너지솔루션"],["207940","삼성바이오로직스"],
  ["005380","현대차"],["005935","삼성전자우"],["012450","한화에어로스페이스"],["105560","KB금융"],
  ["035420","NAVER"],["000270","기아"],["068270","셀트리온"],["005490","POSCO홀딩스"],
  ["329180","HD현대중공업"],["055550","신한지주"],["012330","현대모비스"],["028260","삼성물산"],
  ["006400","삼성SDI"],["034020","두산에너빌리티"],["066570","LG전자"],["003670","포스코퓨처엠"],
  ["096770","SK이노베이션"],["009540","HD한국조선해양"],["033780","KT&G"],["086790","하나금융지주"],
  ["015760","한국전력"],["051910","LG화학"],["035720","카카오"],["032830","삼성생명"],
  ["402340","SK스퀘어"],["009150","삼성전기"],["010130","고려아연"],["259960","크래프톤"],
  ["011200","HMM"],["247540","에코프로비엠"],["086520","에코프로"],["196170","알테오젠"],
  ["091990","셀트리온제약"],["247540","에코프로비엠"],["028300","HLB"],["068760","셀트리온제약"],
].filter((v,i,a)=>a.findIndex(x=>x[0]===v[0])===i).map(([code,name])=>({code,name,market:"",amount:0,cap:0,chg:0,close:0}));

async function rankPage(market, page, size) {
  const r = await fetch(`https://m.stock.naver.com/api/stocks/marketValue/${market}?page=${page}&pageSize=${size}`, {
    headers: { "User-Agent": UA, "Referer": "https://m.stock.naver.com/", "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(market + " HTTP " + r.status);
  const j = await r.json();
  return (j.stocks || []).map((s) => ({
    code: String(s.itemCode || "").toUpperCase(),
    name: String(s.stockName || ""),
    market,
    amount: num(s.accumulatedTradingValue),   // 거래대금(백만원)
    cap: num(s.marketValue),
    chg: parseFloat(String(s.fluctuationsRatio || "0")) || 0,
    close: num(s.closePrice),
  })).filter((x) => KRCODE.test(x.code) && !/금리|채권|국고|통안|CD금리|머니마켓|MMF|단기통안/.test(x.name));
}
async function rank(market, pages) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    try { const rows = await rankPage(market, p, 100); if (!rows.length) break; out.push(...rows); }
    catch (e) { break; }
  }
  return out;
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  let limit = parseInt(url.searchParams.get("limit") || "100", 10);
  if (!(limit > 0)) limit = 100;
  limit = Math.min(limit, 200);
  try {
    const [a, b] = await Promise.all([ rank("KOSPI", 2), rank("KOSDAQ", 1) ]);
    let all = a.concat(b).filter((x, i, arr) => arr.findIndex((y) => y.code === x.code) === i);
    let source = "naver";
    if (!all.length) { all = FALLBACK.slice(); source = "fallback"; }
    else all.sort((x, y) => y.amount - x.amount);
    return new Response(JSON.stringify({ count: all.length, source, universe: all.slice(0, limit) }), { headers: JH });
  } catch (e) {
    return new Response(JSON.stringify({ count: FALLBACK.length, source: "fallback", universe: FALLBACK.slice(0, limit), warn: String(e.message || e) }), { headers: JH });
  }
}
