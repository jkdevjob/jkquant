// 대한체육회 경기결과 시스템(result.sports.or.kr) 중계 — GET /api/swim-result?sys=SW&classCd=D2&toCd=…&op=events|rounds|round
// 수집기가 공개 자료에 올린 대회만 · 한 번에 원래 사이트 한 요청 · 결과 표를 글자로만 풀어 돌려준다(HTML 을 화면에 넣지 않음 · 저장 안 함).
//   events: 대회의 종별 · 세부종목 목록(INF202)   rounds: 한 종목의 예선 · 결승 목록(INF301)   round: 한 경기의 순위 · 기록 표(INF306)
// SW(대한수영연맹)와 UW(대한수중핀수영협회)는 같은 화면 구조다. UW 는 경기 열쇠에 종목 · 종별을 함께 넘긴다.
import { swimDoc, findSystem, json, edgeCache } from "./_swim_results.js";

export const OPS = {
  events: { path: "INF202.do", body: p => ({ classCd: p.classCd, toCd: p.toCd, pageIndex: "1" }) },
  rounds: { path: "INF301.do", body: p => ({ classCd: p.classCd, toCd: p.toCd, kindCd: p.kind, detailClassCd: p.dc,
    searchKindCd: p.kind, searchDetailClassCd: p.dc, pageIndex: "1" }) },
  round: { path: "INF306.do", body: p => ({ classCd: p.classCd, toCd: p.toCd, kindCd: p.kind, detailClassCd: p.dc, rhCd: p.rh,
    gubun: "T", pageIndex: "1" }) },
};
const RX = { sys: /^(SW|UW)$/, classCd: /^\w{1,4}$/, toCd: /^\d{6,14}$/, kind: /^\w{1,4}$/, dc: /^\w{2,12}$/, rh: /^\w{1,10}$/ };
const NEED = { events: [], rounds: ["kind", "dc"], round: ["kind", "dc", "rh"] };

const ENT = { "&#34;": '"', "&quot;": '"', "&#39;": "'", "&apos;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
export const unent = s => String(s || "").replace(/&#34;|&quot;|&#39;|&apos;|&amp;|&lt;|&gt;|&nbsp;/g, m => ENT[m])
  .replace(/&#(\d{1,6});/g, (_, n) => String.fromCodePoint(+n));
export const text = s => unent(String(s || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const noComments = h => String(h || "").replace(/<!--[\s\S]*?-->/g, "");
const cellsOf = tr => [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
const quoted = s => [...unent(s).matchAll(/["']([^"']*)["']/g)].map(m => m[1]);

export function parseEvents(html) {
  const out = [], seen = new Set();
  for (const m of noComments(html).matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
    const f = /fnEventSchedule\(([^)]*)\)/.exec(unent(m[1])) || /fnEventSchedule\(([^)]*)\)/.exec(unent(m[2]));
    if (!f) continue;
    const [kind, dc] = quoted(f[1]);
    if (!kind || !dc || seen.has(dc)) continue;
    seen.add(dc);
    const c = cellsOf(m[2]);
    out.push({ kind, dc, group: c[0] || "", event: c[1] || "", type: c[2] || "", entries: c[3] || "", teams: c[4] || "" });
  }
  return out;
}

export function parseRounds(html) {
  const out = [], seen = new Set();
  for (const m of noComments(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const f = /fnGameResult\(([^)]*)\)/.exec(unent(m[1]));
    if (!f) continue;
    const [rh, dc, kind] = quoted(f[1]);
    if (!rh || seen.has(rh + "|" + (dc || ""))) continue;
    seen.add(rh + "|" + (dc || ""));
    const c = cellsOf(m[1]);
    out.push({ rh, dc: dc || "", kind: kind || "", date: c[0] || "", label: c[1] || "" });
  }
  return out;
}

export function parseRound(html) {
  const tables = [];
  for (const t of noComments(html).matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const body = t[1], th = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(body);
    if (!th) continue;
    const headRow = [...th[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(x => text(x[1]));
    if (!headRow.some(x => /순위|기록/.test(x))) continue;
    const tb = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(body);
    const rows = [];
    for (const r of (tb ? tb[1] : "").matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)) {
      if (/\bid\s*=\s*["']?subResult/i.test(r[1]) || /display\s*:\s*none/i.test(r[1])) continue;     // 구간 기록(숨김 줄)
      const c = cellsOf(r[2]);
      if (!c.length) continue;
      if (c.length === 1) rows.push({ section: c[0] });
      else rows.push({ cells: c });
    }
    const cap = /<caption\b[^>]*>([\s\S]*?)<\/caption>/i.exec(body);
    tables.push({ caption: cap ? text(cap[1]) : "", head: headRow, rows });
  }
  return { tables };
}

export function params(u) {
  const p = {};
  for (const k of ["sys", "classCd", "toCd", "op", "kind", "dc", "rh"]) p[k] = (u.searchParams.get(k) || "").trim();
  if (!OPS[p.op]) return { error: "op 는 events · rounds · round 중 하나" };
  for (const k of ["sys", "classCd", "toCd", ...NEED[p.op]]) if (!RX[k].test(p[k])) return { error: k + " 형식 오류" };
  return { p };
}

export async function handle(request, { fetchImpl = fetch, waitUntil = null, docLoader = swimDoc } = {}) {
  const u = new URL(request.url), { p, error } = params(u);
  if (error) return json({ ok: false, error }, 400);
  let doc;
  try { doc = await docLoader(u.origin, { fetchImpl }); } catch (e) { return json({ ok: false, error: "수영대회 자료를 읽지 못했습니다" }, 503); }
  if (!findSystem(doc, p.sys, p.toCd, p.classCd)) return json({ ok: false, error: "수영대회 결과 목록에 없는 대회입니다" }, 403);
  const cache = edgeCache();
  const key = new Request(`https://swim-result.cache/v1/${p.sys}/${p.op}/${p.classCd}/${p.toCd}/${p.kind}/${p.dc}/${p.rh}`);
  let html = "";
  const hit = cache ? await cache.match(key) : null;
  if (hit) html = await hit.text();
  else {
    let r;
    try {
      r = await fetchImpl(`https://result.sports.or.kr/${p.sys}/${OPS[p.op].path}`, { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 (compatible; JKQuantSwim/1.0; +https://jkquant.pages.dev/swim)" },
        body: new URLSearchParams(OPS[p.op].body(p)).toString() });
    } catch (e) { return json({ ok: false, error: "결과 시스템에 연결하지 못했습니다" }, 502); }
    if (!r.ok) return json({ ok: false, error: "결과 시스템 응답 " + r.status }, 502);
    html = await r.text();
    if (cache) {
      const put = cache.put(key, new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=21600" } }));
      if (waitUntil) waitUntil(put); else await put;
    }
  }
  const out = p.op === "events" ? { events: parseEvents(html) } : p.op === "rounds" ? { rounds: parseRounds(html) } : parseRound(html);
  return json({ ok: true, op: p.op, ...out }, 200, { "cache-control": "private, max-age=600" });
}

export async function onRequestGet(context) {
  return handle(context.request, { waitUntil: context.waitUntil ? p => context.waitUntil(p) : null });
}
