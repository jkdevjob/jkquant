#!/usr/bin/env node
// 잘되는 채널 찾기: 키워드로 유튜브 '채널' 검색 → 구독자 수 → 채널마다 최근 쇼츠 48편 조회수(중앙값·최고)를 모은다.
// 공개 검색·채널 쇼츠 탭만 씀(로그인·API 키 없이). 남의 영상·이미지는 저장하지 않고 숫자·제목만.
//   node trends/scan-channels.mjs              → trends/channels-YYYY-MM-DD.json/md (은퇴·노후)
//   node trends/scan-channels.mjs --tag mb     → trends/channels-YYYY-MM-DD-mb.json/md (경제·생활)
//   옵션: --top 25 (쇼츠 탭을 볼 채널 수), --min 30000 (최소 구독자)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const TAG = opt("tag", null);
const KW = {
  rn: ["노후준비", "국민연금", "은퇴", "연금", "노후자금", "기초연금", "퇴직연금", "주택연금", "50대 재테크", "시니어 정보", "건강보험료", "노후 생활비"],
  mb: ["경제", "경제 뉴스", "재테크", "경제 상식", "돈 공부", "부동산", "생활 꿀팁", "시사", "이슈 정리", "IT 뉴스", "경제 쇼츠", "카드뉴스"],
};
const keywords = KW[TAG || "rn"];
const TOP = +opt("top", 25), MIN = +opt("min", 30000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const num = (s) => { // "구독자 45.1만명" / "조회수 1.2만회" / "6.71천명" → 숫자
  const m = String(s || "").replace(/,/g, "").match(/([\d.]+)\s*(천|만|억)?/);
  return m ? Math.round(parseFloat(m[1]) * ({ 천: 1e3, 만: 1e4, 억: 1e8 }[m[2]] || 1)) : null;
};
const ytData = (h) => { const m = h.match(/var ytInitialData = (\{.*?\});<\/script>/s); return m ? JSON.parse(m[1]) : null; };
function collect(o, key, out = []) {
  if (!o || typeof o !== "object") return out;
  if (Array.isArray(o)) { o.forEach((x) => collect(x, key, out)); return out; }
  if (o[key]) out.push(o[key]);
  for (const k in o) if (k !== key) collect(o[k], key, out);
  return out;
}
async function get(url) {
  let last;
  for (const wait of [0, 2000, 5000]) {
    if (wait) await sleep(wait);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return ytData(await r.text());
    } catch (e) { last = e; }
  }
  throw last;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function main() {
  const chans = new Map(), errors = [];
  for (const kw of keywords) {
    try {
      const d = await get(`https://www.youtube.com/results?search_query=${encodeURIComponent(kw)}&sp=EgIQAg%253D%253D&hl=ko&gl=KR`);
      for (const c of collect(d || {}, "channelRenderer")) {
        // 한국어 화면에선 subscriberCountText 자리에 @핸들, videoCountText 자리에 '구독자 ○명'이 온다
        const subText = [c.videoCountText?.simpleText, c.subscriberCountText?.simpleText].find((s) => /구독자/.test(s || ""));
        const id = c.channelId, url = c.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl;
        if (!id || !url) continue;
        const cur = chans.get(id) || { id, name: c.title?.simpleText || "", url, subs: num(subText), keywords: [] };
        cur.keywords.push(kw);
        chans.set(id, cur);
      }
    } catch (e) { errors.push(`${kw}: ${e.message}`); }
    await sleep(1200);
  }
  const big = [...chans.values()].filter((c) => (c.subs || 0) >= MIN).sort((a, b) => b.subs - a.subs).slice(0, TOP);
  for (const c of big) {
    try {
      const d = await get(`https://www.youtube.com${c.url}/shorts?hl=ko&gl=KR`);
      const shorts = collect(d || {}, "shortsLockupViewModel").map((v) => {
        const m = (v.accessibilityText || "").match(/^(.*), 조회수 ([^-]+?)\s*-\s*Shorts/);
        return m ? { id: v.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId, title: m[1].trim(), views: num(m[2]) } : null;
      }).filter((x) => x && x.views != null);
      const v = shorts.map((s) => s.views);
      Object.assign(c, { shortsSeen: shorts.length, median: median(v), max: Math.max(0, ...v),
        hitRate: shorts.length ? +(v.filter((x) => x >= Math.max(10000, (c.subs || 0) * 0.1)).length / shorts.length).toFixed(2) : 0,
        top: [...shorts].sort((a, b) => b.views - a.views).slice(0, 5) });
    } catch (e) { errors.push(`${c.name}: ${e.message}`); }
    await sleep(1500);
  }
  big.sort((a, b) => (b.median || 0) - (a.median || 0));
  const base = path.join(__dirname, `channels-${today}${TAG ? "-" + TAG : ""}`);
  fs.writeFileSync(base + ".json", JSON.stringify({ date: today, tag: TAG || "rn", keywords, errors, channels: big }, null, 1) + "\n");
  const f = (n) => (n >= 1e4 ? `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}만` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}천` : `${n}`);
  const md = [`# 잘되는 채널 — ${today} (${TAG === "mb" ? "경제·생활" : "은퇴·노후"})`, "",
    `키워드 ${keywords.length}개로 채널 검색 → 구독자 ${f(MIN)} 이상 상위 ${big.length}곳의 최근 쇼츠 48편. **중앙값순**(지금 꾸준히 되는 곳). 히트율 = 최근 쇼츠 중 '1만 회 또는 구독자 10%' 넘은 비율.`, "",
    "| 채널 | 구독자 | 최근 쇼츠 중앙값 | 최고 | 히트율 | 최근 상위 제목 |", "|---|---:|---:|---:|---:|---|",
    ...big.map((c) => `| [${c.name}](https://www.youtube.com${c.url}) | ${f(c.subs || 0)} | ${f(c.median || 0)} | ${f(c.max || 0)} | ${Math.round((c.hitRate || 0) * 100)}% | ${(c.top || []).slice(0, 3).map((s) => `${s.title.slice(0, 38)}(${f(s.views)})`).join(" · ")} |`),
    "", errors.length ? `오류: ${errors.join(" / ")}` : ""].join("\n");
  fs.writeFileSync(base + ".md", md + "\n");
  console.log(`✔ ${path.relative(process.cwd(), base)}.md (채널 ${chans.size} → 분석 ${big.length})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
