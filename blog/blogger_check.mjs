#!/usr/bin/env node
// 블로거 연결 점검: blog/blogger_blogs.json 의 블로그마다 이 키로 접근되는지(이름·주소·글 수)만 본다. 글은 쓰지 않는다.
// GitHub Actions(blogger-publish)에서 blogger_blogs.json 이 바뀔 때 돈다.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BLOGS = JSON.parse(fs.readFileSync(path.join(__dirname, "blogger_blogs.json"), "utf8"));
const need = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN"];
if (need.some((k) => !process.env[k])) { console.log("키 미설정 — 점검 건너뜀"); process.exit(2); }
const t = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN, grant_type: "refresh_token" }) }).then((r) => r.json());
if (!t.access_token) { console.error(`토큰 발급 실패: ${t.error}`); process.exit(1); }
let fail = 0;
for (const [k, b] of Object.entries(BLOGS)) {
  const id = b.id || process.env[b.idEnv];
  if (!id) { console.log(`${k}: 블로그 ID 없음`); fail = 1; continue; }
  const r = await fetch(`https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(id)}?view=AUTHOR`, { headers: { Authorization: `Bearer ${t.access_token}` } });
  const j = await r.json();
  if (r.ok) console.log(`${k}: 접근 OK · ${j.name} · ${j.url} · 글 ${j.posts?.totalItems ?? "?"}개`);
  else { console.log(`${k}: 접근 실패(HTTP ${r.status}) ${j.error?.message || ""}`); fail = 1; }
}
process.exit(fail);
