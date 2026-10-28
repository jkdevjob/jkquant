#!/usr/bin/env node
// 블로그 글(.md) → HTML 변환 → 구글 블로거에 게시.
//
//   node blog/publish-blogger.mjs blog/2026-10-26_oil-rate.md
//   옵션: --dry     게시하지 않고 HTML만 만들어 <파일>.html 로 저장
//         --draft   초안으로 올림(공개 안 됨)
//         --force   published.json 에 있어도 다시 올림
//
// 환경변수: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, BLOGGER_BLOG_ID
// 종료 코드: 0 게시 완료 또는 이미 게시됨 · 2 키 미설정(글은 그대로) · 1 오류
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
if (dateLabel) out.push(`<p style="margin:0 0 18px;color:#8a8f98;font-size:13px;">${dateLabel} · 은퇴노트 경제 노트</p>`);
let list = null;
const flushList = () => {
  if (list) { out.push(`<ul style="margin:0 0 10px;padding-left:20px;font-size:14px;">${list.join("")}</ul>`); list = null; }
};
for (const raw of lines) {
  const l = raw.trim();
  if (!l || l === titleLine.trim() || /^<!--.*-->$/.test(l) || /^\[사진:.*\]$/.test(l)) { flushList(); continue; }
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
  console.log(`제목: ${title}\n라벨: ${labels.join(", ") || "(없음)"}\n문단: ${out.length}개`);
  process.exit(0);
}

// ── 3. 중복 게시 방지 ──
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : {};
const key = path.basename(file);
if (log[key] && !flags.has("--force")) {
  console.log(`이미 게시됨: ${log[key].url}`);
  process.exit(0);
}

// ── 4. 인증 ──
const need = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "BLOGGER_BLOG_ID"];
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
  const blogId = process.env.BLOGGER_BLOG_ID;
  const url = `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts`
    + (flags.has("--draft") ? "?isDraft=true" : "");
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "blogger#post", title, content: html, labels }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`게시 실패(HTTP ${r.status}): ${j.error?.message || JSON.stringify(j).slice(0, 300)}`);
  log[key] = { id: j.id, url: j.url || "(초안)", title, at: new Date().toISOString(), draft: flags.has("--draft") };
  fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");
  console.log(`${flags.has("--draft") ? "초안 저장" : "게시 완료"}: ${j.url || j.id}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
