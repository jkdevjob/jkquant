#!/usr/bin/env node
// "사람들이 지금 가장 궁금해하는 것" 모으기 — 주제 고르기 1순위 자료
//   node trends/curious.mjs        → trends/curious-YYYY-MM-DD.md / .json
// 1) 구글·유튜브 검색 자동완성: 사람들이 실제로 치는 질문(씨앗 낱말 + 빈칸/언제/얼마/왜 …)
//    어제 목록에 없던 새 자동완성은 ★ — 갑자기 궁금해진 것
// 2) 구글 트렌드 한국 급상승 검색어(검색량 어림값 + 관련 기사 제목) 중 돈·연금·시장과 닿는 것
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEEDS = ["국민연금", "기초연금", "퇴직연금", "퇴직금", "연금저축", "IRP", "건강보험료", "노후", "은퇴", "정년",
  "코스피", "환율", "금리", "부동산", "주택연금", "유족연금", "연말정산", "세금"];
const TAILS = [" ", " 언제", " 얼마", " 왜", " 2026"];
const MONEY = /연금|코스피|코스닥|주가|주식|증시|환율|금리|부동산|아파트|세금|세액|건보|건강보험|퇴직|노후|은퇴|정년|물가|예금|적금|대출|금값|비트코인|반도체|삼성전자|하이닉스|기준금리|한은|연준|관세/;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function get(url){
  for (const wait of [0, 1500, 4000]){
    if (wait) await sleep(wait);
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ko-KR,ko;q=0.9" } });
      if (r.ok) return await r.text();
    } catch {}
  }
  return null;
}
async function suggest(q, yt){
  const u = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ko${yt ? "&ds=yt" : ""}&q=${encodeURIComponent(q)}`;
  const t = await get(u);
  try { return JSON.parse(t)[1] || []; } catch { return []; }
}

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const outDir = __dirname;
const prevFile = fs.readdirSync(outDir).filter(f => /^curious-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.includes(today)).sort().pop();
const prev = new Set(prevFile ? JSON.parse(fs.readFileSync(path.join(outDir, prevFile), "utf8")).suggestions.map(s => s.q) : []);

// 1) 자동완성 — 여러 꼬리로 물어봐서 자주·앞자리에 나오는 것일수록 점수가 높다
const score = new Map();
for (const seed of SEEDS){
  for (const tail of TAILS){
    for (const yt of [false, true]){
      const list = await suggest(seed + tail, yt);
      list.forEach((q, i) => {
        q = q.trim();
        if (!q || q === seed) return;
        const s = score.get(q) || { q, seed, score: 0, yt: false, web: false };
        s.score += 10 - Math.min(i, 9);
        if (yt) s.yt = true; else s.web = true;
        score.set(q, s);
      });
      await sleep(250);
    }
  }
}
const suggestions = [...score.values()].sort((a, b) => b.score - a.score).map(s => ({ ...s, new: prevFile ? !prev.has(s.q) : false }));

// 2) 구글 트렌드 한국 급상승
const rss = await get("https://trends.google.com/trending/rss?geo=KR") || "";
const trends = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
  const x = m[1];
  const pick = (re) => (x.match(re) || [])[1] || "";
  const news = [...x.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)].map(n => n[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim());
  const title = pick(/<title>([\s\S]*?)<\/title>/).trim();
  return { title, traffic: pick(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/).trim(), news, money: MONEY.test(title + " " + news.join(" ")) };
});

fs.writeFileSync(path.join(outDir, `curious-${today}.json`), JSON.stringify({ date: today, suggestions, trends }, null, 1));

const bySeed = {};
for (const s of suggestions) (bySeed[s.seed] ||= []).push(s);
let md = `# 사람들이 지금 궁금해하는 것 — ${today}\n\n` +
  `구글·유튜브 자동완성(씨앗 ${SEEDS.length}개 × ${TAILS.length}가지) + 구글 트렌드 한국 급상승. ★ = 어제(${prevFile ? prevFile.slice(8, 18) : "기록 없음"})엔 없던 자동완성.\n\n` +
  `## 돈과 닿는 급상승 검색어\n\n` +
  (trends.filter(t => t.money).map(t => `- **${t.title}** (${t.traffic}) — ${t.news.slice(0, 2).join(" / ")}`).join("\n") || "- (오늘은 없음)") +
  `\n\n## 새로 뜬 자동완성 ★ (점수순)\n\n` +
  (suggestions.filter(s => s.new).slice(0, 25).map(s => `- ★ ${s.q} (${s.score}${s.yt ? " · 유튜브" : ""})`).join("\n") || "- (없음)") +
  `\n\n## 씨앗별 상위 자동완성\n\n` +
  SEEDS.map(seed => `- **${seed}**: ` + (bySeed[seed] || []).slice(0, 8).map(s => (s.new ? "★" : "") + s.q.replace(seed, "").trim()).join(" · ")).join("\n") +
  `\n\n## 전체 급상승 검색어\n\n` + trends.map(t => `${t.title}(${t.traffic})`).join(" · ") + "\n";
fs.writeFileSync(path.join(outDir, `curious-${today}.md`), md);
console.log(`✔ trends/curious-${today}.md (자동완성 ${suggestions.length}개 · 새로 ${suggestions.filter(s => s.new).length} · 급상승 ${trends.length}개 중 돈 관련 ${trends.filter(t => t.money).length})`);
