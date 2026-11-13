#!/usr/bin/env node
// 인스타 참고 자료 모으기(공식 그래프 API만): 해시태그 인기 게시물 + 참고 계정(비즈니스·크리에이터)의 최근 게시물 반응.
// GitHub Actions(.github/workflows/ig-refs.yml)가 비밀값으로 돌리고 결과를 reel/trends/ig_refs/<날짜>.json 으로 커밋한다.
//   IG_ACCESS_TOKEN, IG_USER_ID  — 은퇴노트 키(시스템 사용자 키, graph.facebook.com)
//   설정: reel/trends/ig_refs.config.json  { "<채널>": { "hashtags": [...], "accounts": [...] } }
// 목적: 잘되는 표지·첫 문장·형식의 '패턴'을 읽기 위한 것 — 남의 문구·화면을 그대로 쓰지 않는다.
// 해시태그 검색은 7일에 30개 해시태그까지(인스타 제한) — 채널별 4~6개만 쓴다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "ig_refs.config.json"), "utf8"));
const TOKEN = process.env.IG_ACCESS_TOKEN, UID = process.env.IG_USER_ID;
const V = process.env.IG_GRAPH_VERSION || "v23.0";
const HOST = `https://graph.facebook.com/${V}`;
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
if (!TOKEN || !UID) { console.error("IG_ACCESS_TOKEN·IG_USER_ID 없음"); process.exit(2); }

async function get(pathAndQuery, params = {}) {
  const u = `${HOST}/${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}` + new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(u);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${j.error?.code ?? r.status} ${j.error?.message || ""}`.trim());
  return j;
}
const score = (m) => (m.like_count || 0) + 3 * (m.comments_count || 0);
const slim = (m, extra = {}) => ({
  id: m.id, type: m.media_product_type || m.media_type, likes: m.like_count ?? null, comments: m.comments_count ?? null,
  at: m.timestamp, url: m.permalink, thumb: m.thumbnail_url || (m.media_type === "IMAGE" ? m.media_url : null) || null,
  caption: (m.caption || "").slice(0, 160), ...extra });

const out = { date: today, note: "공식 그래프 API(해시태그 top_media · business_discovery). 패턴 참고용 — 문구·화면 복사 금지.", channels: {} };
const errors = [];
for (const [ch, c] of Object.entries(CFG.channels || {})) {
  const items = [];
  for (const tag of c.hashtags || []) {
    try {
      const s = await get("ig_hashtag_search", { user_id: UID, q: tag });
      const hid = s.data?.[0]?.id;
      if (!hid) { errors.push(`${ch} #${tag}: 해시태그 없음`); continue; }
      const t = await get(`${hid}/top_media`, { user_id: UID, fields: "id,media_type,media_product_type,caption,like_count,comments_count,permalink,timestamp,media_url", limit: "30" });
      for (const m of t.data || []) items.push(slim(m, { from: `#${tag}` }));
    } catch (e) { errors.push(`${ch} #${tag}: ${e.message}`); }
  }
  const accounts = [];
  for (const name of c.accounts || []) {
    try {
      const f = `business_discovery.username(${name}){username,name,followers_count,media_count,media.limit(25){id,media_type,media_product_type,caption,like_count,comments_count,permalink,timestamp,media_url,thumbnail_url}}`;
      const j = await get(UID, { fields: f });
      const b = j.business_discovery || {};
      const media = (b.media?.data || []).map((m) => slim(m, { from: `@${name}` }));
      const med = media.map(score).sort((a, b) => a - b)[Math.floor(media.length / 2)] || 0;
      accounts.push({ username: b.username, followers: b.followers_count, posts: b.media_count, median_score: med });
      // 계정 안에서 평소보다 2배 넘게 반응한 게시물(그 계정의 '히트')만 참고 목록에
      for (const m of media) if (score(m) >= 2 * Math.max(med, 1)) items.push({ ...m, vs_median: +(score(m) / Math.max(med, 1)).toFixed(1) });
    } catch (e) { errors.push(`${ch} @${name}: ${e.message}`); }
  }
  const seen = new Set();
  const top = items.filter((m) => !seen.has(m.id) && seen.add(m.id)).sort((a, b) => (b.vs_median || 0) - (a.vs_median || 0) || score(b) - score(a)).slice(0, 40);
  out.channels[ch] = { accounts, top };
}
out.errors = errors;
const dir = path.join(__dirname, "ig_refs");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${today}.json`), JSON.stringify(out, null, 1) + "\n");
console.log(`[${today}] ` + Object.entries(out.channels).map(([k, v]) => `${k}: 참고 ${v.top.length}개 · 계정 ${v.accounts.length}`).join(" / "));
for (const e of errors) console.log("  ! " + e);
