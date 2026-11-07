#!/usr/bin/env node
// 어제·최근 '은퇴·경제'에서 가장 핫했던 뉴스 찾기 — 주제 고르기 1단계(ISSUE_GUIDE 1장)
//   node trends/hot-news.mjs        → trends/hot-YYYY-MM-DD.md / .json (KST 날짜)
// 1) 네이버 경제·사회 섹션 헤드라인 묶음 + '관련뉴스 N건'(여러 언론이 같이 다룬 정도)
// 2) 네이버 많이 본 뉴스 / 댓글 많은 뉴스 (언론사별 상위 5개) 중 은퇴·경제 기사 — 사람들이 실제로 누른 것
// 3) 구글 뉴스(최근 1일) 은퇴 낱말별 기사 수 — 어제보다 크게 늘면 ▲
// 순위·건수는 이 출력에 있는 것만 근거로 쓴다. 지어내지 않는다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const RETIRE = /연금|퇴직|노후|은퇴|정년|건강보험|건보료|피부양자|IRP|고령자|시니어|중장년|요양|상속세|증여세|기초생활/;
const ECON = /금리|환율|코스피|코스닥|증시|주가|주식|국장|미장|서학개미|개미|반도체|삼성전자|하이닉스|물가|부동산|아파트|집값|전세|월세|대출|세금|관세|달러|원화|금값|비트코인|연준|한은|기준금리|국채|채권|예금|적금|ETF|배당|펀드|경기|성장률|수출|고용|실업|임금|연봉|월급|최저임금|예산|재정|기름값|유가|청약|분양/;
const NOT_MONEY = /감독|선수|대표팀|경기|리그|시즌|구단|국가대표|은퇴식|은퇴전|노후 ?(장비|시설|공동주택|건물|주택|차량|배관|와이파이|청사|다리|교량|아파트 정비)/;
const SKIP = /포토|\[사진\]|부고|인사\]|운세|날씨|살해|살인|흉기|폭행|성폭|숨져|숨진|사망|체포|구속|검찰|경찰|화재|사고/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url){
  for (const wait of [0, 1500, 4000]){
    if (wait) await sleep(wait);
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ko-KR,ko;q=0.9" } });
      if (!r.ok) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      const u8 = new TextDecoder("utf-8").decode(buf);
      return (u8.match(/\uFFFD/g) || []).length > 20 ? new TextDecoder("euc-kr").decode(buf) : u8;
    } catch {}
  }
  return "";
}
const un = s => s.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&middot;/g, "·").replace(/&#x3D;/g, "=").replace(/\s+/g, " ").trim();
const words = t => new Set((t.match(/[가-힣A-Za-z0-9]{2,}/g) || []).filter(w => !/^(있다|없다|이유|이번|올해|내년|오늘|어제|정부|대한|위해|관련|이후|이상|이하|단독|종합|속보)$/.test(w)));
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

// 1) 네이버 섹션 헤드라인 묶음
async function headlines(sid){
  const t = await get(`https://news.naver.com/section/${sid}`);
  const out = [];
  for (const blk of t.split('class="sa_item _SECTION_HEADLINE"').slice(1)){
    const title = un((blk.match(/sa_text_strong">([\s\S]*?)<\/strong>/) || [])[1] || "");
    if (!title || SKIP.test(title)) continue;
    out.push({
      sid, title,
      url: (blk.match(/href="(https:\/\/n\.news\.naver\.com\/mnews\/article\/[^"]+)"/) || [])[1] || "",
      lede: un((blk.match(/sa_text_lede">([\s\S]*?)<\/div>/) || [])[1] || "").slice(0, 120),
      press: un((blk.match(/sa_text_press">([\s\S]*?)<\/div>/) || [])[1] || ""),
      cluster: +((blk.match(/sa_text_cluster_num">(\d+)</) || [])[1] || 0),
    });
  }
  return out;
}
// 2) 네이버 언론사별 많이 본·댓글 많은 뉴스
async function ranking(kind){
  const t = await get(`https://news.naver.com/main/ranking/${kind}.naver`);
  const out = [];
  for (const box of t.split('class="rankingnews_box"').slice(1)){
    const press = un((box.match(/rankingnews_name">([^<]+)</) || [])[1] || "");
    const re = /<a href="(https:\/\/n\.news\.naver\.com\/article\/[^"]+)"[^>]*class="list_title[^"]*"[^>]*>([^<]+)<\/a>/g;
    let m, i = 0;
    while ((m = re.exec(box)) && i < 5){ i++; out.push({ press, rank: i, title: un(m[2]), url: m[1].split("?")[0] }); }
  }
  return out;
}
// 3) 구글 뉴스 최근 1일 기사 수
async function gnews(q){
  const t = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:1d")}&hl=ko&gl=KR&ceid=KR:ko`);
  const items = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({
    title: un((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/ - [^-]+$/, ""),
    source: un((m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || ""),
  }));
  return { q, n: items.length, sources: new Set(items.map(x => x.source)).size, top: items.slice(0, 4).map(x => `${x.title} (${x.source})`), items };
}

const heads = [...await headlines(101), ...(await headlines(102)).filter(h => RETIRE.test(h.title + h.lede))];
const pop = (await ranking("popularDay")).filter(x => RETIRE.test(x.title) || ECON.test(x.title));
const memo = (await ranking("popularMemo")).filter(x => RETIRE.test(x.title) || ECON.test(x.title));
const KEYS = ["국민연금", "기초연금", "퇴직연금", "퇴직금", "연금저축", "IRP", "건강보험료", "건보료", "정년연장", "주택연금", "노후", "은퇴",
  "연금개혁", "상속세", "증여세", "연말정산", "코스피", "환율", "금리", "집값", "전세", "대출", "물가"];
const gn = [];
for (const q of KEYS){ gn.push(await gnews(q)); await sleep(300); }
const prevFile = fs.readdirSync(__dirname).filter(f => /^hot-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.includes(today)).sort().pop();
const prevGn = prevFile ? Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, prevFile), "utf8")).gnews.map(g => [g.q, g.n])) : {};

// 구글 뉴스 기사들을 같은 이야기끼리 묶기(제목 낱말 3개 이상 겹치면 같은 묶음) → 다룬 언론사 수가 많을수록 핫
const seenT = new Set(), all = [];
for (const g of gn) for (const it of g.items){ if (seenT.has(it.title) || SKIP.test(it.title) || NOT_MONEY.test(it.title)) continue; seenT.add(it.title); all.push({ ...it, q: g.q, w: words(it.title) }); }
const clusters = [];
for (const it of all){
  let best = null, bo = 0;
  for (const c of clusters){ const o = overlap(it.w, c.w); if (o > bo){ bo = o; best = c; } }
  if (best && bo >= 3){ best.items.push(it); for (const w of it.w) best.cnt.set(w, (best.cnt.get(w) || 0) + 1); }
  else clusters.push({ w: new Set(it.w), cnt: new Map([...it.w].map(w => [w, 1])), items: [it] });
}
const gclusters = clusters.map(c => ({
  sources: new Set(c.items.map(x => x.source)).size, n: c.items.length,
  retire: c.items.some(x => RETIRE.test(x.title)), keys: [...new Set(c.items.map(x => x.q))],
  top: [...c.cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]),
  titles: c.items.slice(0, 4).map(x => `${x.title} (${x.source})`),
})).filter(c => c.sources >= 2).sort((a, b) => (b.sources + (b.retire ? 3 : 0)) - (a.sources + (a.retire ? 3 : 0)));

// 후보 점수: 헤드라인 묶음 크기 + 많이 본/댓글 순위에 겹치는 기사 + 은퇴 관련 가산
const cands = heads.map(h => {
  const w = words(h.title + " " + h.lede);
  const hitsPop = pop.filter(p => overlap(w, words(p.title)) >= 2);
  const hitsMemo = memo.filter(p => overlap(w, words(p.title)) >= 2);
  const retire = RETIRE.test(h.title + h.lede);
  const score = h.cluster + 8 * hitsPop.length + 5 * hitsMemo.length + (retire ? 20 : 0);
  return { ...h, retire, score, pop: hitsPop.map(p => `${p.press} ${p.rank}위: ${p.title}`), memo: hitsMemo.map(p => `${p.press} ${p.rank}위: ${p.title}`) };
}).sort((a, b) => b.score - a.score);

const L = [];
L.push(`# 핫이슈 후보 ${today} (KST, 네이버·구글 뉴스 공개 순위 기준)`, "");
L.push("점수 = 네이버 헤드라인 관련뉴스 수 + 많이 본 뉴스 겹침×8 + 댓글 많은 뉴스 겹침×5 + 은퇴 관련 20. ★ = 은퇴·노후 직접 관련.", "");
L.push("## 1. 후보 순위 (네이버 경제·사회 헤드라인 묶음)", "");
cands.slice(0, 15).forEach((c, i) => {
  L.push(`${i + 1}. ${c.retire ? "★ " : ""}**${c.title}** — 관련뉴스 ${c.cluster}건 · 점수 ${c.score} · ${c.press} ${c.url}`);
  if (c.lede) L.push(`   - ${c.lede}…`);
  for (const p of c.pop.slice(0, 3)) L.push(`   - 많이 본: ${p}`);
  for (const p of c.memo.slice(0, 2)) L.push(`   - 댓글 많은: ${p}`);
});
L.push("", "## 1-2. 구글 뉴스 최근 1일 — 같은 이야기를 다룬 언론사 수 순 (★ 은퇴 관련은 +3으로 정렬)", "");
gclusters.slice(0, 20).forEach((c, i) => {
  L.push(`${i + 1}. ${c.retire ? "★ " : ""}언론사 ${c.sources}곳 · 기사 ${c.n}건 · 핵심 낱말: ${c.top.join(" ")} (검색어 ${c.keys.join("·")})`);
  for (const t of c.titles.slice(0, 3)) L.push(`   - ${t}`);
});
L.push("", "## 2. 많이 본 뉴스 중 은퇴·경제 기사 (언론사별 상위 5)", "");
for (const p of pop.slice(0, 40)) L.push(`- ${RETIRE.test(p.title) ? "★ " : ""}[${p.press} ${p.rank}위] ${p.title} ${p.url}`);
L.push("", "## 3. 댓글 많은 뉴스 중 은퇴·경제 기사", "");
for (const p of memo.slice(0, 20)) L.push(`- ${RETIRE.test(p.title) ? "★ " : ""}[${p.press} ${p.rank}위] ${p.title} ${p.url}`);
L.push("", "## 4. 구글 뉴스 최근 1일 기사 수 (100건이 상한, ▲ = 어제 기록보다 1.5배 이상)", "");
for (const g of gn){
  const up = prevGn[g.q] && g.n >= prevGn[g.q] * 1.5 && g.n >= 10 ? " ▲" : "";
  L.push(`- ${g.q}: ${g.n}건 · 언론사 ${g.sources}곳${prevGn[g.q] != null ? ` (어제 기록 ${prevGn[g.q]})` : ""}${up}`);
  for (const t of g.top.slice(0, 2)) L.push(`   - ${t}`);
}
const md = L.join("\n") + "\n";
fs.writeFileSync(path.join(__dirname, `hot-${today}.md`), md);
fs.writeFileSync(path.join(__dirname, `hot-${today}.json`), JSON.stringify({ date: today, cands, gclusters, pop, memo, gnews: gn.map(({ items, ...g }) => g) }, null, 1));
console.log(md);
