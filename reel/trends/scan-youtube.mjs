#!/usr/bin/env node
// 유튜브에서 은퇴·노후 분야 영상의 최근 흐름을 모은다(공개 검색 결과만, 로그인·API 키 없이).
//   node trends/scan-youtube.mjs            → trends/YYYY-MM-DD.json, trends/YYYY-MM-DD.md
//   옵션: --keywords "노후준비,국민연금"   (기본: 아래 KEYWORDS)
// 수집: 키워드마다 ① 이번 달 쇼츠 ② 이번 주 쇼츠 ③ 이번 달 일반 영상(조회수순).
// 영상 페이지는 유튜브가 봇 확인(429)으로 막아서, 검색 결과에 보이는 제목·조회수·게시 시점만 쓴다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYWORDS = ["노후준비", "은퇴준비", "국민연금", "퇴직연금", "퇴직금", "연금저축", "IRP", "노후자금",
  "50대 재테크", "60대 재테크", "은퇴 후 생활비", "기초연금", "주택연금", "건강보험료 은퇴"];
// 검색 필터(sp): 이번 달+쇼츠 / 이번 주+쇼츠 / 조회수순+이번 달+동영상
const SP = { monthShorts: "EgQIBBAJ", weekShorts: "EgQIAxAJ", monthLongByViews: "CAMSBAgEEAE%3D" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const argv = process.argv.slice(2);
const kwArg = argv.includes("--keywords") ? argv[argv.indexOf("--keywords") + 1] : null;
const keywords = kwArg ? kwArg.split(",").map(s => s.trim()).filter(Boolean) : KEYWORDS;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// "조회수 1.2만회" → 12000, "조회수 123,456회" → 123456
function parseViews(s){
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/([\d.]+)\s*(천|만|억)?\s*회/);
  if (!m) return null;
  const mul = { "천": 1e3, "만": 1e4, "억": 1e8 }[m[2]] || 1;
  return Math.round(parseFloat(m[1]) * mul);
}
function ytData(html){
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  return m ? JSON.parse(m[1]) : null;
}
function collect(o, key, out = []){
  if (!o || typeof o !== "object") return out;
  if (Array.isArray(o)){ o.forEach(x => collect(x, key, out)); return out; }
  if (o[key]) out.push(o[key]);
  for (const k in o) if (k !== key) collect(o[k], key, out);
  return out;
}
async function search(q, sp){
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=${sp}&hl=ko&gl=KR`;
  let last;
  for (const wait of [0, 2000, 5000, 10000]){ // 연결이 끊기면 잠깐 쉬었다가 다시
    if (wait) await sleep(wait);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ytData(await r.text());
    } catch (e){ last = e; }
  }
  throw last;
}
function shortsFrom(d){
  return collect(d, "shortsLockupViewModel").map(v => {
    const acc = v.accessibilityText || "";
    const id = v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
    const m = acc.match(/^(.*), (조회수 [^-]+?)\s*-\s*Shorts/);
    return id && m ? { id, type: "shorts", title: m[1].trim(), views: parseViews(m[2]), url: `https://www.youtube.com/shorts/${id}` } : null;
  }).filter(Boolean);
}
function longFrom(d){
  return collect(d, "videoRenderer").map(v => ({
    id: v.videoId, type: "video",
    title: v.title?.runs?.map(r => r.text).join("") || "",
    views: parseViews(v.viewCountText?.simpleText),
    published: v.publishedTimeText?.simpleText || "",
    length: v.lengthText?.simpleText || "",
    channel: v.ownerText?.runs?.[0]?.text || "",
    url: `https://www.youtube.com/watch?v=${v.videoId}`,
  })).filter(v => v.id);
}

// 제목 패턴(무엇이 잘 먹히는지 보는 용도)
const PATTERNS = {
  "질문형(?)": t => /\?/.test(t),
  "숫자 포함": t => /\d/.test(t),
  "나이 언급(40~70대·OO세)": t => /[4-7]0대|\d{2}세/.test(t),
  "돈 액수(만원·억)": t => /\d[\d,.]*\s*(만\s*원|만원|억|원)/.test(t),
  "N가지·순위": t => /\d+\s*(가지|개|위)|TOP|top/.test(t),
  "손해·후회·경고": t => /후회|손해|망|절대|위험|조심|큰일|폭탄|모르면|하지\s*마/.test(t),
  "꿀팁·방법": t => /방법|꿀팁|비법|하는\s*법|이렇게/.test(t),
  "국민연금": t => /국민연금/.test(t),
  "퇴직(금·연금)": t => /퇴직/.test(t),
  "연금저축·IRP": t => /연금저축|IRP|irp/.test(t),
  "건강보험·세금": t => /건강보험|건보|세금|소득세/.test(t),
};

async function main(){
  const all = new Map();
  const add = (v, kw, tag) => {
    const cur = all.get(v.id) || { ...v, keywords: [], tags: [] };
    if (!cur.keywords.includes(kw)) cur.keywords.push(kw);
    if (!cur.tags.includes(tag)) cur.tags.push(tag);
    if ((v.views ?? 0) > (cur.views ?? 0)) cur.views = v.views;
    all.set(v.id, cur);
  };
  const errors = [];
  for (const kw of keywords){
    for (const [tag, sp] of Object.entries(SP)){
      try {
        const d = await search(kw, sp);
        const list = tag.includes("Shorts") ? shortsFrom(d || {}) : longFrom(d || {});
        list.forEach(v => add(v, kw, tag));
      } catch (e){ errors.push(`${kw}/${tag}: ${e.message}`); }
      await sleep(1200);
    }
  }
  const items = [...all.values()].filter(v => v.views != null);
  const shorts = items.filter(v => v.type === "shorts").sort((a, b) => b.views - a.views);
  const longs = items.filter(v => v.type === "video").sort((a, b) => b.views - a.views);
  const week = shorts.filter(v => v.tags.includes("weekShorts"));

  const patternStats = (list) => Object.fromEntries(Object.entries(PATTERNS).map(([k, f]) => {
    const hit = list.filter(v => f(v.title));
    const avg = hit.length ? Math.round(hit.reduce((s, v) => s + v.views, 0) / hit.length) : 0;
    return [k, { count: hit.length, share: list.length ? +(hit.length / list.length).toFixed(2) : 0, avgViews: avg }];
  }));
  const top = shorts.slice(0, 40);
  const report = {
    date: today, keywords, errors,
    counts: { shorts: shorts.length, weekShorts: week.length, longs: longs.length },
    topShortsMonth: shorts.slice(0, 25), topShortsWeek: week.slice(0, 15), topLongMonth: longs.slice(0, 15),
    patternsTopShorts: patternStats(top), patternsAllShorts: patternStats(shorts),
    medianShortViews: shorts.length ? shorts[Math.floor(shorts.length / 2)].views : 0,
  };
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(path.join(__dirname, `${today}.json`), JSON.stringify(report, null, 2) + "\n");

  const fmt = (n) => n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}만` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}천` : String(n);
  const md = [];
  md.push(`# 유튜브 은퇴·노후 분야 동향 — ${today}`, "");
  md.push(`키워드 ${keywords.length}개 · 이번 달 쇼츠 ${shorts.length}편(이번 주 ${week.length}) · 이번 달 일반 영상 ${longs.length}편 · 쇼츠 조회수 중앙값 ${fmt(report.medianShortViews)}`, "");
  md.push("## 이번 주 쇼츠 상위", "", "| 조회수 | 제목 | 키워드 |", "|---:|---|---|");
  week.slice(0, 15).forEach(v => md.push(`| ${fmt(v.views)} | [${v.title.replace(/\|/g, "/").slice(0, 70)}](${v.url}) | ${v.keywords.join(", ")} |`));
  md.push("", "## 이번 달 쇼츠 상위", "", "| 조회수 | 제목 | 키워드 |", "|---:|---|---|");
  shorts.slice(0, 25).forEach(v => md.push(`| ${fmt(v.views)} | [${v.title.replace(/\|/g, "/").slice(0, 70)}](${v.url}) | ${v.keywords.join(", ")} |`));
  md.push("", "## 이번 달 일반 영상 상위(조회수순)", "", "| 조회수 | 제목 | 채널 | 길이 | 게시 |", "|---:|---|---|---|---|");
  longs.slice(0, 15).forEach(v => md.push(`| ${fmt(v.views)} | [${v.title.replace(/\|/g, "/").slice(0, 60)}](${v.url}) | ${v.channel} | ${v.length} | ${v.published} |`));
  md.push("", "## 제목 패턴 (쇼츠 상위 40편 기준)", "", "| 패턴 | 비율 | 평균 조회수 |", "|---|---:|---:|");
  Object.entries(report.patternsTopShorts).sort((a, b) => b[1].share - a[1].share)
    .forEach(([k, s]) => md.push(`| ${k} | ${Math.round(s.share * 100)}% | ${fmt(s.avgViews)} |`));
  if (errors.length) md.push("", "## 수집 오류", "", ...errors.map(e => `- ${e}`));
  fs.writeFileSync(path.join(__dirname, `${today}.md`), md.join("\n") + "\n");
  console.log(`✔ trends/${today}.md (쇼츠 ${shorts.length} · 이번 주 ${week.length} · 일반 ${longs.length}${errors.length ? ` · 오류 ${errors.length}` : ""})`);
}
main().catch(e => { console.error(e); process.exit(1); });
