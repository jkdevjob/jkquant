#!/usr/bin/env node
// 발행 큐(queue/queue.json)에서 오늘 올릴 영상 하나를 골라
// 인스타그램 릴스 + 유튜브 쇼츠로 올린다. 매일 한 번 예약 작업이 실행한다.
//
//   node publish-social.mjs            오늘(한국 시간) 올릴 항목 게시
//   옵션: --dry          올리지 않고 무엇을 올릴지·파일·문구 길이만 확인
//         --only ig|yt   한쪽만
//         --id w2d1      날짜와 상관없이 이 항목(이미 올린 쪽은 건너뜀)
//         --date 2026-11-02   오늘 날짜를 이 날로 간주
//
// 고르는 규칙: 날짜가 오늘 이하이면서 아직 안 올린 가장 오래된 항목 하나.
//   키를 늦게 넣어도 밀린 영상이 하루 한 편씩 순서대로 나간다(한꺼번에 몰아 올리지 않음).
//   오늘 이미 한 편 올렸으면 그 플랫폼은 쉰다.
//
// 환경변수
//   유튜브:  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YT_REFRESH_TOKEN (범위 youtube.upload)
//   인스타:  IG_ACCESS_TOKEN (인스타그램 로그인 장기 토큰, instagram_business_content_publish)
//            IG_USER_ID(선택, 없으면 me), IG_GRAPH_VERSION(선택, 기본 v23.0),
//            MEDIA_BASE_URL(선택, 영상 공개 주소 앞부분 — 없으면 커밋 고정 jsDelivr 주소)
// 종료 코드: 0 게시했거나 오늘 올릴 것 없음 · 2 모든 플랫폼이 키가 없어 건너뜀 · 1 오류
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.join(__dirname, "queue", "queue.json");
const LOG = path.join(__dirname, "queue", "published.json");
const REPO = "jkdevjob/jkquant";

// ── 인자 ──
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = flag("dry");
const ONLY = opt("only");
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const TODAY = opt("date") || kstToday();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const queue = JSON.parse(fs.readFileSync(QUEUE, "utf8")).items;
const log = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, "utf8")) : { items: {}, meta: {} };
log.items ||= {};
log.meta ||= {};
const saveLog = () => fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + "\n");

// ── 플랫폼 ──
const PLATFORMS = {
  yt: { name: "유튜브", keys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "YT_REFRESH_TOKEN"] },
  ig: { name: "인스타", keys: ["IG_ACCESS_TOKEN"] },
};
const targets = Object.keys(PLATFORMS).filter((p) => !ONLY || ONLY === p);

const done = (id, p) => Boolean(log.items[id]?.[p]);
const postedToday = (p) => Object.values(log.items).some((e) => e[p]?.at && kstDate(e[p].at) === TODAY);
function kstDate(iso) { return new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10); }

// 플랫폼별로 오늘 올릴 항목 고르기
function pick(p) {
  if (opt("id")) {
    const it = queue.find((q) => q.id === opt("id"));
    if (!it) throw new Error(`큐에 없는 id: ${opt("id")}`);
    return done(it.id, p) ? null : it;
  }
  if (postedToday(p)) return null;
  return queue.filter((q) => q.date <= TODAY && !done(q.id, p)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}

// ── 사전 점검(--dry 에서도 실행) ──
function check(item) {
  const problems = [];
  const file = path.join(__dirname, item.file);
  if (!fs.existsSync(file)) problems.push(`파일 없음: ${item.file}`);
  else {
    const mb = fs.statSync(file).size / 1048576;
    if (mb > 300) problems.push(`파일이 너무 큼(${mb.toFixed(1)}MB)`);
    const sec = durationOf(file);
    if (sec != null && (sec < 3 || sec > 180)) problems.push(`길이 ${sec.toFixed(1)}초(쇼츠·릴스는 3~180초)`);
  }
  if ([...item.caption].length > 2200) problems.push("인스타 캡션 2,200자 초과");
  if ((item.caption.match(/#[^\s#]+/g) || []).length > 30) problems.push("해시태그 30개 초과");
  if ([...item.yt_title].length > 100) problems.push("유튜브 제목 100자 초과");
  if (/[<>]/.test(item.yt_title + item.caption)) problems.push("유튜브는 제목·설명에 < > 를 허용하지 않음");
  return problems;
}
function durationOf(file) {
  try {
    const ff = path.join(__dirname, "node_modules", "@ffmpeg-installer", "linux-x64", "ffmpeg");
    if (!fs.existsSync(ff)) return null;
    const r = spawnSync(ff, ["-i", file], { encoding: "utf8" });
    const m = r.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
  } catch { return null; }
}

// ── 유튜브 ──
async function googleToken() {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.YT_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const hint = j.error === "invalid_grant"
      ? "갱신 토큰이 만료·취소됨. OAuth 동의 화면이 '테스트' 상태면 7일마다 만료되니 '프로덕션'으로 바꾸고 다시 발급하세요."
      : "클라이언트 ID/비밀번호를 확인하세요.";
    throw new Error(`구글 토큰 발급 실패(${j.error}): ${hint}`);
  }
  return j.access_token;
}

// 기록(published.json)이 푸시되지 못했어도 같은 영상을 두 번 올리지 않도록 채널 최근 업로드에서 제목을 찾는다.
// youtube.readonly 범위가 없으면 확인을 건너뛴다.
let ytGuardOff = false;
async function ytExisting(token, item) {
  const get = (u) => fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const ch = await get("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true");
  if (!ch.ok) { ytGuardOff = true; return null; }
  const uploads = (await ch.json()).items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return null;
  const pl = await get(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=25&playlistId=${uploads}`);
  if (!pl.ok) { ytGuardOff = true; return null; }
  const hit = ((await pl.json()).items || []).find((v) => v.snippet?.title === item.yt_title);
  if (!hit) return null;
  const id = hit.snippet.resourceId?.videoId;
  return { video_id: id, url: `https://www.youtube.com/shorts/${id}`, at: hit.snippet.publishedAt, recovered: true };
}

async function uploadYouTube(item, token) {
  const file = path.join(__dirname, item.file);
  const bytes = fs.readFileSync(file);
  const meta = {
    snippet: {
      title: item.yt_title,
      description: item.yt_description || item.caption,
      tags: item.tags || [],
      categoryId: "27", // 교육
      defaultLanguage: "ko",
      defaultAudioLanguage: "ko",
    },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
  // 1) 업로드 세션 열기
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(bytes.length),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error(`유튜브 업로드 시작 실패(HTTP ${init.status}): ${await errText(init)}`);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("유튜브 업로드 주소(Location)를 받지 못함");
  // 2) 영상 보내기(파일이 작아 한 번에)
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: bytes });
  if (!put.ok) throw new Error(`유튜브 업로드 실패(HTTP ${put.status}): ${await errText(put)}`);
  const v = await put.json();
  const privacy = v.status?.privacyStatus;
  return {
    video_id: v.id,
    url: `https://www.youtube.com/shorts/${v.id}`,
    privacy,
    note: privacy && privacy !== "public" ? `공개 상태가 '${privacy}'로 잡힘 — 스튜디오에서 확인 필요` : undefined,
  };
}

// ── 인스타그램 ──
const IG = () => `https://graph.instagram.com/${process.env.IG_GRAPH_VERSION || "v23.0"}`;

// 인스타 서버가 내려받을 공개 주소. 저장소가 공개라 커밋된 파일을 jsDelivr(커밋 고정)로 연다.
function mediaUrl(item) {
  if (process.env.MEDIA_BASE_URL) return process.env.MEDIA_BASE_URL.replace(/\/$/, "") + "/" + item.file;
  const rel = path.relative(path.join(__dirname, ".."), path.join(__dirname, item.file)).split(path.sep).join("/");
  const sha = execFileSync("git", ["log", "-1", "--format=%H", "--", rel], { cwd: path.join(__dirname, ".."), encoding: "utf8" }).trim();
  if (!sha) throw new Error(`${item.file} 이 아직 커밋되지 않아 공개 주소가 없음`);
  return `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/${rel}`;
}

async function igCall(method, url, params) {
  const body = method === "POST" ? new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN }) : undefined;
  const q = method === "GET" ? "?" + new URLSearchParams({ ...params, access_token: process.env.IG_ACCESS_TOKEN }) : "";
  const r = await fetch(url + q, { method, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {};
    const hint = e.code === 190 ? " — 토큰이 만료·무효. 메타 개발자 앱에서 새 장기 토큰을 발급해 IG_ACCESS_TOKEN 교체" : "";
    throw new Error(`인스타 API 오류(HTTP ${r.status}, code ${e.code ?? "?"}): ${e.message || JSON.stringify(j).slice(0, 200)}${hint}`);
  }
  return j;
}

// 같은 이유로 인스타 최근 게시물에서 캡션 첫 줄이 같은 것을 찾는다.
async function igExisting(item) {
  const first = item.caption.split("\n")[0].trim();
  const r = await igCall("GET", `${IG()}/${process.env.IG_USER_ID || "me"}/media`, { fields: "caption,permalink,timestamp", limit: "25" });
  const hit = (r.data || []).find((m) => (m.caption || "").split("\n")[0].trim() === first);
  return hit ? { media_id: hit.id, url: hit.permalink, at: hit.timestamp, recovered: true } : null;
}

async function publishInstagram(item) {
  const videoUrl = mediaUrl(item);
  const head = await fetch(videoUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`영상 공개 주소 접근 실패(HTTP ${head.status}): ${videoUrl}`);
  const uid = process.env.IG_USER_ID || "me";
  // 1) 컨테이너 만들기
  const c = await igCall("POST", `${IG()}/${uid}/media`, {
    media_type: "REELS", video_url: videoUrl, caption: item.caption, share_to_feed: "true",
  });
  // 2) 인스타가 영상을 처리할 때까지 대기(최대 10분)
  let status = "IN_PROGRESS";
  for (let i = 0; i < 40 && status === "IN_PROGRESS"; i++) {
    await sleep(15000);
    const s = await igCall("GET", `${IG()}/${c.id}`, { fields: "status_code,status" });
    status = s.status_code;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`인스타 영상 처리 실패(${status}): ${s.status || ""}`);
  }
  if (status !== "FINISHED") throw new Error(`인스타 영상 처리가 10분 안에 끝나지 않음(${status})`);
  // 3) 게시
  const m = await igCall("POST", `${IG()}/${uid}/media_publish`, { creation_id: c.id });
  const info = await igCall("GET", `${IG()}/${m.id}`, { fields: "permalink" }).catch(() => ({}));
  return { media_id: m.id, url: info.permalink || "(링크 조회 실패 — 앱에서 확인)", video_url: videoUrl };
}

// 장기 토큰(60일) 연장 — 7일에 한 번. 토큰 값은 어디에도 출력·저장하지 않는다.
async function refreshIgToken() {
  const last = log.meta.ig_refreshed_at ? Date.parse(log.meta.ig_refreshed_at) : 0;
  if (Date.now() - last < 7 * 86400e3) return null;
  const r = await fetch("https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({
    grant_type: "ig_refresh_token", access_token: process.env.IG_ACCESS_TOKEN,
  }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) return `인스타 토큰 연장 실패: ${j.error?.message || r.status}`;
  log.meta.ig_refreshed_at = new Date().toISOString();
  saveLog();
  const days = Math.floor((j.expires_in || 0) / 86400);
  const changed = j.access_token !== process.env.IG_ACCESS_TOKEN;
  return `인스타 토큰 연장됨(만료까지 ${days}일)` + (changed ? " — 새 토큰 값이 발급됨: 만료 전에 메타 앱에서 토큰을 다시 받아 IG_ACCESS_TOKEN 교체 권장" : "");
}

async function errText(r) {
  const t = await r.text().catch(() => "");
  try { const j = JSON.parse(t); return j.error?.message || t.slice(0, 300); } catch { return t.slice(0, 300); }
}

// ── 실행 ──
const report = [];
let keySkips = 0, failed = false;

for (const p of targets) {
  const P = PLATFORMS[p];
  let item = pick(p);
  if (!item) { report.push(`${P.name}: 오늘 올릴 항목 없음`); continue; }
  const missing = P.keys.filter((k) => !process.env[k]);
  if (DRY) {
    const problems = check(item);
    if (problems.length) { failed = true; report.push(`${P.name}: ${item.id} 점검 실패 — ${problems.join(" / ")}`); continue; }
    let extra = "";
    if (p === "ig") { try { extra = ` · 공개 주소 ${mediaUrl(item)}`; } catch (e) { extra = ` · ${e.message}`; } }
    report.push(`${P.name}: ${item.id}(${item.date}) 올릴 예정 · ${item.file}${extra}` + (missing.length ? ` · 키 없음: ${missing.join(", ")}` : " · 키 있음"));
    continue;
  }
  if (missing.length) { keySkips++; report.push(`${P.name}: 키 미설정으로 건너뜀(${missing.join(", ")})`); continue; }
  try {
    const token = p === "yt" ? await googleToken() : null;
    // 계정에 이미 올라가 있는데 기록만 빠진 항목은 기록을 되살리고 다음 항목으로
    while (item) {
      const prior = p === "yt" ? await ytExisting(token, item) : await igExisting(item);
      if (!prior) break;
      (log.items[item.id] ||= {})[p] = prior;
      saveLog();
      report.push(`${P.name}: ${item.id} 이미 올라가 있어 기록만 복구 → ${prior.url}`);
      item = pick(p);
    }
    if (!item) { report.push(`${P.name}: 오늘 올릴 항목 없음`); continue; }
    const problems = check(item);
    if (problems.length) throw new Error(`점검 실패 — ${problems.join(" / ")}`);
    const res = p === "yt" ? await uploadYouTube(item, token) : await publishInstagram(item);
    (log.items[item.id] ||= {})[p] = { ...res, at: new Date().toISOString() };
    saveLog();
    report.push(`${P.name}: ${item.id} 게시 완료 → ${res.url}` + (res.note ? ` (${res.note})` : ""));
  } catch (e) {
    failed = true;
    report.push(`${P.name}: ${item.id} 실패 — ${e.message}`);
  }
}
if (ytGuardOff) report.push("유튜브 중복 확인 생략(갱신 토큰에 youtube.readonly 범위 없음)");

if (!DRY && targets.includes("ig") && PLATFORMS.ig.keys.every((k) => process.env[k])) {
  const msg = await refreshIgToken().catch((e) => `인스타 토큰 연장 오류: ${e.message}`);
  if (msg) report.push(msg);
}

// 남은 큐
const left = queue.filter((q) => targets.some((p) => !done(q.id, p))).map((q) => `${q.id}(${q.date})`);
report.push(`남은 항목: ${left.length ? left.join(", ") : "없음 — 다음 주 영상을 큐에 추가해야 함"}`);

console.log(`[${TODAY} KST]${DRY ? " (점검만)" : ""}\n` + report.join("\n"));
process.exit(failed ? 1 : !DRY && keySkips > 0 && keySkips === targets.length ? 2 : 0);
