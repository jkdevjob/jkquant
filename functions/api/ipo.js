// Cloudflare Pages Function — GET /api/ipo[?month=YYYY-MM]  → { items:[...], src, updated, range }
// 국내 공모주 일정.
//
// 소스 두 가지를 종목코드로 합친다.
//  1) 네이버 증시 캘린더(stock.naver.com/api/marketCalendars/v1/events/search, POST)
//     → 청약 시작/마감일·상장일·확정공모가·시초가. 날짜는 여기가 기준(정답).
//     모바일 IPO 목록은 청약이 끝나면 종목을 빼버려서, 상장 대기·상장일 종목
//     (예: 오늘 상장하는 종목)이 사라졌다. 캘린더는 지난 상장일도 남아 있다.
//     조회 구간은 최대 42일이라 기본은 오늘 기준 앞뒤 두 구간을 부른다.
//  2) 네이버 모바일 IPO 목록(m.stock.naver.com/api/stocks/ipo, 전체 페이지)
//     → 희망밴드·기관경쟁률·진행상태·주간사 등 부가정보.
const JH = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=900",
};
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MARKET = { D: "코스닥", Y: "코스피", K: "코넥스", KOSDAQ: "코스닥", KOSPI: "코스피", KONEX: "코넥스" };

function ymd8(s) {
  s = String(s || "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : "";
}
function num(v) {
  if (v == null) return null;
  const t = String(v).replace(/[,원\s]/g, "").replace(/:1$/, "");
  if (t === "" || /미정|-/.test(t) && !/^\d/.test(t)) return null;
  const n = +t;
  return isFinite(n) && n > 0 ? n : null;
}
// '2026. 10. 15.' → '2026-10-15'
function dotDate(s) {
  const m = String(s || "").match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
}
const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function addDays(d, n) { const x = new Date(d.getTime()); x.setUTCDate(x.getUTCDate() + n); return x; }
// KST 오늘(날짜만). Workers 는 UTC 로 돈다.
function kstToday() { const n = new Date(Date.now() + 9 * 3600e3); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); }

async function calendarEvents(from, to) {
  const r = await fetch("https://stock.naver.com/api/marketCalendars/v1/events/search", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/json", "Referer": "https://stock.naver.com/calendar", "Accept": "application/json" },
    body: JSON.stringify({ from, to, category: "ipo", codes: [], myStocksOnly: false }),
  });
  if (!r.ok) throw new Error("calendar HTTP " + r.status);
  const j = await r.json();
  const out = [];
  for (const g of (j && j.dateGroups) || []) {
    for (const e of g.events || []) out.push({ date: g.date, e });
  }
  return out;
}

async function mobileList() {
  const r = await fetch("https://m.stock.naver.com/api/stocks/ipo?pageSize=100", {
    headers: { "User-Agent": UA, "Accept": "application/json", "Referer": "https://m.stock.naver.com/" },
  });
  if (!r.ok) throw new Error("list HTTP " + r.status);
  const j = await r.json();
  return (j && j.ipoCoInfos) || [];
}

const codeOf = (c) => String(c || "").replace(/^A/, "").toUpperCase();
const TITLE_SUFFIX = /\s*(상장일|청약\s*시작일|청약\s*마감일|청약일|환불일|수요예측[^\s]*)\s*$/;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const month = url.searchParams.get("month");   // 'YYYY-MM' (선택)
  let windows;
  if (/^\d{4}-\d{2}$/.test(month || "")) {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)), last = new Date(Date.UTC(y, m, 0));
    windows = [[fmt(addDays(first, -6)), fmt(addDays(last, 6))]];      // 달력 앞뒤 여백 포함(≤42일)
  } else {
    const t = kstToday();
    windows = [[fmt(addDays(t, -40)), fmt(t)], [fmt(addDays(t, 1)), fmt(addDays(t, 41))]];
  }

  const [calR, listR] = await Promise.allSettled([
    Promise.all(windows.map(([a, b]) => calendarEvents(a, b))).then((xs) => xs.flat()),
    mobileList(),
  ]);
  const byCode = new Map();
  const get = (code, name) => {
    if (!byCode.has(code)) byCode.set(code, { name: name || "", code, poPrice: null, bandLo: null, bandHi: null,
      subStart: "", subEnd: "", listDate: "", openPrice: null, leadManager: "", instRate: null, subRate: null,
      status: "", market: "", url: "" });
    const it = byCode.get(code);
    if (!it.name && name) it.name = name;
    return it;
  };

  // 1) 캘린더 — 날짜의 기준
  if (calR.status === "fulfilled") {
    for (const { date, e } of calR.value) {
      const code = codeOf(e.productKey && e.productKey.itemCode);
      if (!code) continue;
      const type = String(e.eventKey || "").split(":")[3] || "";
      const name = String(e.title || "").replace(TITLE_SUFFIX, "").trim();
      const it = get(code, name);
      if (type === "IPO_SUBSCRIPTION_START") it.subStart = date;
      else if (type === "IPO_SUBSCRIPTION_END") it.subEnd = date;
      else if (type === "IPO_LISTING") it.listDate = date;
      for (const inf of e.information || []) {
        const v = inf && inf.value;
        if (inf.label === "확정공모가") it.poPrice = num(v) ?? it.poPrice;
        else if (inf.label === "시초가") it.openPrice = num(v) ?? it.openPrice;
        else if (inf.label === "경쟁률") it.subRate = num(v) ?? it.subRate;
        else if (inf.label === "상장일" && !it.listDate) it.listDate = dotDate(v);
      }
      if (!it.url && e.endUrl) it.url = e.endUrl.mobile || e.endUrl.pc || "";
    }
  }

  // 2) 모바일 목록 — 부가정보(밴드·기관경쟁률·상태·주간사). 날짜는 캘린더 값이 없을 때만 채운다.
  if (listR.status === "fulfilled") {
    for (const x of listR.value) {
      const code = codeOf(x.itemCode);
      if (!code) continue;
      const it = get(code, x.itemName);
      it.bandLo = num(x.expectedPoStart) ?? it.bandLo;
      it.bandHi = num(x.expectedPoEnd) ?? it.bandHi;
      it.poPrice = it.poPrice ?? num(x.poPrice);
      it.instRate = num(x.instituteCompRate) ?? it.instRate;
      it.subRate = it.subRate ?? num(x.subscriptCompRate);
      it.status = x.ipoStatus || it.status;
      it.leadManager = x.leadManager || it.leadManager;
      it.market = MARKET[x.marketClasses] || it.market;
      if (!it.subStart) it.subStart = ymd8(x.poStartDate);
      if (!it.subEnd) it.subEnd = ymd8(x.poEndDate);
      if (!it.listDate) it.listDate = ymd8(x.listedDueDate);
      if (!it.url) it.url = x.endUrl || "";
    }
  }

  // 상태 보정: 목록에서 빠진(청약 끝난) 종목은 날짜로 상태를 적는다
  const today = fmt(kstToday());
  const items = [...byCode.values()].filter((x) => x.name).map((x) => {
    if (!x.status) {
      if (x.listDate && x.listDate <= today) x.status = "상장";
      else if (x.listDate) x.status = "상장예정";
      else if (x.subEnd && x.subEnd < today) x.status = "청약완료";
      else if (x.subStart && x.subStart <= today) x.status = "청약";
    } else if (x.listDate && x.listDate <= today) x.status = "상장";
    return x;
  });

  if (!items.length) {
    const err = [calR, listR].filter((r) => r.status === "rejected").map((r) => String(r.reason && r.reason.message || r.reason));
    return new Response(JSON.stringify({ items: [], error: err.join(" | ") || "no data" }), { status: 502, headers: JH });
  }
  return new Response(JSON.stringify({
    items, src: calR.status === "fulfilled" ? "naver-calendar+list" : "naver-list",
    range: windows, updated: Date.now(),
  }), { headers: JH });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
