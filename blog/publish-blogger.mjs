#!/usr/bin/env node
// 블로그 글(.md) → HTML 변환 → 구글 블로거에 게시.
//
//   node blog/publish-blogger.mjs blog/2026-10-26_oil-rate.md
//   옵션: --dry     게시하지 않고 HTML만 만들어 <파일>.html 로 저장
//         --draft   초안으로 올림(공개 안 됨)
//         --force   published.json 에 있어도 다시 올림
//         --revert  이미 게시한 글을 '초안'으로 되돌림(블로그에서 내림, 지우지는 않음)
//         --update  이미 게시·예약한 글의 제목·본문·라벨만 고침(주소·공개 시각 유지)
//   블로그 고르기: <!-- blog: maniac --> (매니악 브리핑). 없으면 은퇴노트. 목록은 blog/blogger_blogs.json.
//   예약 게시: 글 2행 아래에 <!-- publish_at: 2026-11-14T05:00:00+09:00 --> 를 쓰면 그 시각에 공개된다(지난 시각이면 바로 게시).
//
// 환경변수: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, BLOGGER_BLOG_ID
// 종료 코드: 0 게시 완료 또는 이미 게시됨 · 2 키 미설정(글은 그대로) · 1 오류
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, "published.json");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("사용법: node publish-blogger.mjs <글.md> [--dry] [--draft] [--force]");
  process.exit(1);
}

// ── 1. 글 파일 읽기 ──
const src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const lines = src.split("\n");
const titleLine = lines.find((l) => l.startsWith("# "));
if (!titleLine) {
  console.error("제목(# 으로 시작하는 줄)이 없습니다.");
  process.exit(1);
}
const title = titleLine.slice(2).trim();
const labelMatch = src.match(/<!--\s*labels:\s*(.+?)\s*-->/);
const labels = labelMatch ? labelMatch[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
const BLOGS = JSON.parse(fs.readFileSync(path.join(__dirname, "blogger_blogs.json"), "utf8"));
const blogKey = (src.match(/<!--\s*blog:\s*([a-z]+)\s*-->/) || [])[1] || "retire";
const BLOG = BLOGS[blogKey];
if (!BLOG) { console.error(`모르는 블로그: ${blogKey} (blog/blogger_blogs.json)`); process.exit(1); }
const atMatch = src.match(/<!--\s*publish_at:\s*(\S+)\s*-->/);
let publishAt = null;
if (atMatch) {
  const t = Date.parse(atMatch[1]);
  if (Number.isNaN(t)) { console.error(`publish_at 형식 오류: ${atMatch[1]} (예: 2026-11-14T05:00:00+09:00)`); process.exit(1); }
  if (t - Date.now() > 2 * 60e3) publishAt = new Date(t).toISOString();   // 2분 넘게 남았을 때만 예약
}
const dateMatch = path.basename(file).match(/^(\d{4})-(\d{2})-(\d{2})/);
const dateLabel = dateMatch ? `${dateMatch[1]}.${dateMatch[2]}.${dateMatch[3]}` : "";

// ── 2. HTML 변환 ──
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  let t = esc(s);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  return t;
}

const P = 'style="margin:0 0 10px;"';
const out = [];
if (dateLabel) out.push(`<p style="margin:0 0 18px;color:#8a8f98;font-size:13px;">${dateLabel} · ${BLOG.header}</p>`);
let list = null;
const images = [];
const flushList = () => {
  if (list) { out.push(`<ul style="margin:0 0 10px;padding-left:20px;font-size:14px;">${list.join("")}</ul>`); list = null; }
};
for (const raw of lines) {
  const l = raw.trim();
  if (!l || l === titleLine.trim() || /^<!--.*-->$/.test(l) || /^\[사진:.*\]$/.test(l)) { flushList(); continue; }
  // 이미지: ![캡션](blog/blogger_img/<날짜>_<이름>/00.png) — 저장소(공개)의 raw 주소로 넣는다.
  // 주소에는 그 이미지를 마지막으로 바꾼 커밋 해시를 써서, 브랜치가 바뀌어도 그림이 깨지지 않게 한다.
  const im = l.match(/^!\[([^\]]*)\]\((blog\/[^)\s]+\.(?:png|jpe?g|webp))\)$/i);
  if (im) {
    flushList();
    const [, cap, rel] = im;
    let src = rel;
    try { const sha = execSync(`git log -1 --format=%H -- "${rel}"`, { cwd: path.join(__dirname, ".."), encoding: "utf8" }).trim();
      if (sha) src = `https://raw.githubusercontent.com/jkdevjob/jkquant/${sha}/${rel}`; } catch {}
    if (src === rel) {
      if (!flags.has("--dry")) { console.error(`이미지가 아직 커밋되지 않았습니다: ${rel}`); process.exit(1); }
      src = path.relative(path.dirname(file), path.join(__dirname, "..", rel));
    }
    images.push(src);
    out.push(`<figure style="margin:18px 0 20px;text-align:center;"><img src="${src}" alt="${esc(cap)}" style="max-width:100%;height:auto;border-radius:6px;" loading="lazy">`
      + (cap ? `<figcaption style="margin-top:6px;color:#8a8f98;font-size:13px;">${esc(cap)}</figcaption>` : "") + `</figure>`);
    continue;
  }
  if (l.startsWith("- ")) { (list ||= []).push(`<li style="margin:4px 0;">${inline(l.slice(2))}</li>`); continue; }
  flushList();
  if (l === "---") { out.push('<hr style="border:none;border-top:1px solid #e3e3e3;margin:28px 0 18px;">'); continue; }
  if (l === "출처") { out.push('<h3 style="font-size:15px;margin:0 0 8px;color:#555;">출처</h3>'); continue; }
  if (l.startsWith("한줄 코멘트.")) {
    out.push(`<div style="margin:24px 0 16px;padding:16px 18px;background:#f5f3ee;border-left:4px solid #a9791f;border-radius:4px;">`
      + `<strong>한줄 코멘트.</strong>${inline(l.slice("한줄 코멘트.".length))}</div>`);
    continue;
  }
  if (l.startsWith("※")) { out.push(`<p style="margin:0 0 10px;color:#8a8f98;font-size:13px;">${inline(l)}</p>`); continue; }
  out.push(`<p ${P}>${inline(l)}</p>`);
}
flushList();
const html = `<div style="font-size:16px;line-height:1.9;color:#222;">\n${out.join("\n")}\n</div>`;

if (flags.has("--dry")) {
  const htmlPath = file.replace(/\.md$/, ".html");
  fs.writeFileSync(htmlPath, `<meta charset="utf-8"><title>${esc(title)}</title><h1>${esc(title)}</h1>\n${html}`);
  console.log(`미리보기 저장: ${htmlPath}`);
  console.log(`블로그: ${BLOG.name}\n제목: ${title}\n라벨: ${labels.join(", ") || "(없음)"}\n문단: ${out.length}개 · 이미지: ${images.length}개`);
  process.exit(0);
}

// ── 3. 중복 게시 방지 ──
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
const key = path.basename(file);
if (log[key] && !flags.has("--force") && !flags.has("--revert") && !flags.has("--update")) {
  console.log(`이미 게시됨: ${log[key].url}`);
  process.exit(0);
}

if (flags.has("--update")) {
  if (!log[key] || !log[key].id) { console.error(`게시 기록이 없어 고칠 수 없습니다: ${key}`); process.exit(1); }
  if (log[key].reverted) { console.error(`초안으로 내린 글은 고치지 않습니다: ${key}`); process.exit(1); }
}
if (flags.has("--revert")) {
  if (!log[key]) { console.error(`게시 기록이 없어 되돌릴 수 없습니다: ${key}`); process.exit(1); }
  if (log[key].reverted) { console.log(`이미 초안으로 되돌림: ${key}`); process.exit(0); }
}

// ── 4. 인증 ──
const need = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", ...(BLOG.id ? [] : [BLOG.idEnv])];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.log(`키 미설정으로 게시를 건너뜁니다: ${missing.join(", ")}`);
  process.exit(2);
}

async function accessToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const hint = j.error === "invalid_grant"
      ? "갱신 토큰이 만료되었거나 취소되었습니다. OAuth 동의 화면이 '테스트' 상태면 7일마다 만료됩니다 — '프로덕션'으로 바꾼 뒤 토큰을 다시 발급하세요."
      : "클라이언트 ID/비밀번호를 확인하세요.";
    throw new Error(`토큰 발급 실패(${j.error}): ${hint}`);
  }
  return j.access_token;
}

// ── 5. 게시 ──
try {
  const token = await accessToken();
  const blogId = BLOG.id || process.env[BLOG.idEnv];
  if (flags.has("--update")) {
    const r = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(log[key].id)}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title, content: html, labels }) });
    const j = await r.json();
    if (!r.ok) throw new Error(`글 고치기 실패(HTTP ${r.status}): ${j.error?.message || JSON.stringify(j).slice(0, 300)}`);
    Object.assign(log[key], { title, updatedAt: new Date().toISOString(), status: j.status, url: j.url || log[key].url });
    fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log(`글 고침: ${key} · status ${j.status} · ${j.url || ""}`);
    process.exit(0);
  }
  if (flags.has("--revert")) {
    const r = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/${encodeURIComponent(log[key].id)}/revert`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    if (!r.ok) throw new Error(`초안 되돌리기 실패(HTTP ${r.status}): ${j.error?.message || JSON.stringify(j).slice(0, 300)}`);
    Object.assign(log[key], { reverted: true, revertedAt: new Date().toISOString(), draft: true, status: j.status });
    fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
    console.log(`초안으로 되돌림: ${key} (status ${j.status})`);
    process.exit(0);
  }
  const url = `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts`
    + (flags.has("--draft") ? "?isDraft=true" : "");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "blogger#post", title, content: html, labels, ...(publishAt ? { published: publishAt } : {}) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`게시 실패(HTTP ${r.status}): ${j.error?.message || JSON.stringify(j).slice(0, 300)}`);
  log[key] = { blog: blogKey, id: j.id, url: j.url || "(초안)", title, at: new Date().toISOString(), draft: flags.has("--draft"), status: j.status, ...(publishAt ? { publishAt } : {}) };
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`${flags.has("--draft") ? "초안 저장" : publishAt ? `예약 게시(${publishAt})` : "게시 완료"}: ${j.url || j.id} · status ${j.status}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
