#!/usr/bin/env node
// 발행 큐(queue/queue.json)에서 '지금 올릴 때가 된' 영상을 골라
// 인스타그램 릴스(·유튜브 쇼츠)로 올린다. GitHub Actions(.github/workflows/publish-social.yml, main 브랜치)가
// 한국 시간 09·12·18시 직후에 실행한다.
//
//   node publish-social.mjs            지금(한국 시간) 올릴 때가 된 항목 게시
//   옵션: --dry          올리지 않고 무엇을 올릴지·파일·문구 길이·키 상태만 확인
//         --only ig|yt   한쪽만(없으면 queue/publish.config.json 의 targets)
//         --id i20261113a  시각과 상관없이 이 항목(이미 올린 쪽은 건너뜀)
//         --date 2026-11-13 --now 12:05   지금을 이 날·이 시각(한국)으로 간주(점검용)
//
// 고르는 규칙(시각 기준, 여러 편이면 이른 것부터 모두)
//   각 항목의 게시 시각 = plan_at → metricool.at → date + slot 순으로 읽는다(한국 시간).
//   게시 시각이 '오늘'이고 지금 이전이며 아직 안 올린 것. late_window_min(기본 150분)보다 늦었으면 건너뛰고 보고.
//   같은 시각에 새 편과 예비(kind "buffer")가 같이 있으면 예비는 쉰다(예비는 루틴이 못 깨어난 날용).
//   이미 올린 것: queue/published.json 기록, queue.json 의 published.instagram/youtube(Metricool 시절 기록),
//   그리고 계정 최근 게시물(인스타 캡션 첫 줄·유튜브 제목)로 한 번 더 막는다.
//   예전의 '밀린 일반 영상을 하나씩' 규칙은 없앴다 — Metricool 로 이미 나간 영상을 다시 올릴 수 있어서.
//
// 환경변수
//   유튜브:  YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (범위 youtube.upload + youtube.readonly)
//            — GOOGLE_CLIENT_ID 등 GOOGLE_* 비밀값은 블로그(블로거) 키라 여기서 쓰지 않는다
//   인스타:  IG_ACCESS_TOKEN (인스타그램 로그인 장기 토큰, instagram_business_content_publish)
//            IG_USER_ID(선택, 없으면 me), IG_GRAPH_VERSION(선택, 기본 v23.0),
//            MEDIA_BASE_URL(선택, 영상 공개 주소 앞부분 — 없으면 커밋 고정 jsDelivr 주소)
//
// 저장소 없이 실행: 이 파일과 queue/queue.json 만 내려받아 두고 실행하면(REPO_SHA 로 커밋 고정 권장)
//   영상은 그 커밋에서 내려받고, 중복 게시는 계정의 최근 게시물로 막는다(유튜브는 youtube.readonly 필수).
// 종료 코드: 0 게시했거나 오늘 올릴 것 없음 · 2 모든 플랫폼이 키가 없어 건너뜀 · 1 오류
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE = path.join(__dirname, "queue", "queue.json");
const LOG = path.join(__dirname, "queue", "published.json");
const REPO = "jkdevjob/jkquant";
const BRANCH = "claude/instagram-reel-video-creation-wl16ee";
// 저장소 체크아웃 안에서 도는지. 아니면 공개 주소에서 받아 쓰고, 기록은 커밋되지 않는다.
const IN_REPO = (() => {
  try { execFileSync("git", ["ls-files", "--error-unmatch", "queue/queue.json"], { cwd: __dirname, stdio: "ignore" }); return true; }
  catch { return false; }
})();

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
  yt: { name: "유튜브", keys: ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN"] }, // GOOGLE_* 는 블로그(블로거) 키라 쓰지 않는다
  ig: { name: "인스타", keys: ["IG_ACCESS_TOKEN"] },
};
// 발행 설정(저장소 브랜치에 있어 main 을 건드리지 않고 바꿀 수 있다)
const CFG_PATH = path.join(__dirname, "queue", "publish.config.json");
const CFG = fs.existsSync(CFG_PATH) ? JSON.parse(fs.readFileSync(CFG_PATH, "utf8")) : {};
const targets = Object.keys(PLATFORMS).filter((p) => (ONLY ? ONLY === p : (CFG.targets || Object.keys(PLATFORMS)).includes(p)));
const LATE_MIN = Number(opt("late") || CFG.late_window_min || 150);
const NOW = opt("now") ? Date.parse(`${TODAY}T${opt("now")}+09:00`) : Date.now();
if (Number.isNaN(NOW)) throw new Error(`--now 형식은 HH:MM: ${opt("now")}`);

const PUB_KEY = { ig: "instagram", yt: "youtube" };
const done = (id, p) => Boolean(log.items[id]?.[p]) || Boolean(queue.find((q) => q.id === id)?.published?.[PUB_KEY[p]]);
function kstDate(iso) { return new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10); }
const kstHM = (t) => new Date(t + 9 * 3600e3).toISOString().slice(11, 16);

// 항목의 게시 시각(ms). plan_at → metricool.at → date+slot
function plannedAt(q) {
  const s = q.plan_at || q.metricool?.at || (q.date && q.slot ? `${q.date}T${q.slot}+09:00` : null);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? null : t;
}

// 플랫폼별로 지금 올릴 항목들(이른 것부터)과 너무 늦어 건너뛸 항목들
function due(p) {
  if (opt("id")) {
    const it = queue.find((q) => q.id === opt("id"));
    if (!it) throw new Error(`큐에 없는 id: ${opt("id")}`);
    return { items: done(it.id, p) ? [] : [it], missed: [] };
  }
  const today = queue
    .filter((q) => { const t = plannedAt(q); return t != null && kstDate(new Date(t).toISOString()) === TODAY; })
    .sort((a, b) => plannedAt(a) - plannedAt(b));
  const items = [], missed = [];
  for (const q of today) {
    const t = plannedAt(q);
    if (done(q.id, p) || t > NOW) continue;
    if (q.kind === "buffer" && today.some((o) => o !== q && o.kind !== "buffer" && plannedAt(o) === t)) continue;
    if (NOW - t > LATE_MIN * 60e3) { missed.push(q); continue; }
    items.push(q);
  }
  return { items, missed };
}

// 인스타 캡션: API 로는 'AI 정보' 표시를 켤 수 없어서 캡션에 한 줄로 밝힌다(해시태그 줄 앞).
function igCaption(item) {
  const note = CFG.ig_ai_note;
  if (!note || item.caption.includes(note)) return item.caption;
  const lines = item.caption.split("\n");
  const last = lines.length - 1;
  if (lines[last].trim().startsWith("#")) { lines.splice(last, 0, note, ""); return lines.join("\n"); }
  return item.caption + "\n\n" + note;
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
  if ([...igCaption(item)].length > 2200) problems.push("인스타 캡션 2,200자 초과");
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
      client_id: process.env.YT_CLIENT_ID,
      client_secret: process.env.YT_CLIENT_SECRET,
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
// 인스타 키 종류에 따라 주소가 다르다:
//   인스타 로그인 토큰(60일, 연장 필요) → graph.instagram.com, 계정은 me
//   통합 로그인(Unified login)·비즈니스용 Facebook 로그인의 시스템 사용자 토큰(만료 없음) → graph.facebook.com, 계정 ID 필요
// IG_API_HOST(instagram|facebook) 또는 publish.config.json 의 ig_api_host 로 정하고, 없으면 첫 호출 때 둘 다 시험해 고른다.
let IG_HOST = process.env.IG_API_HOST || CFG.ig_api_host || null;
let IG_UID = process.env.IG_USER_ID || null;
const IG_VER = () => process.env.IG_GRAPH_VERSION || "v23.0";
const IG = () => `https://graph.${IG_HOST === "facebook" ? "facebook" : "instagram"}.com/${IG_VER()}`;
async function igReady() {
  if (IG_HOST && (IG_UID || IG_HOST === "instagram")) return;
  const tok = process.env.IG_ACCESS_TOKEN;
  const get = async (u) => { const r = await fetch(u + (u.includes("?") ? "&" : "?") + new URLSearchParams({ access_token: tok })); const j = await r.json().catch(() => ({})); return r.ok && !j.error ? j : null; };
  if (!IG_HOST) {
    if (await get(`https://graph.instagram.com/${IG_VER()}/${IG_UID || "me"}?fields=username`)) IG_HOST = "instagram";
    else IG_HOST = "facebook";
  }
  if (IG_HOST === "facebook" && !IG_UID) {
    // 시스템 사용자 토큰에 맡겨진 인스타 계정을 찾아본다(찾으면 IG_USER_ID 로 저장해 두기를 권함)
    const fb = `https://graph.facebook.com/${IG_VER()}`;
    const a = await get(`${fb}/me/assigned_instagram_accounts?fields=id,username`);
    const b = a?.data?.length ? null : await get(`${fb}/me/accounts?fields=instagram_business_account{id,username}`);
    const found = a?.data?.[0] || b?.data?.map((x) => x.instagram_business_account).find(Boolean);
    if (!found) throw new Error("인스타 계정 ID를 찾지 못함 — 메타 화면에 보이는 인스타 계정 숫자 ID를 GitHub 비밀값 IG_USER_ID 로 넣어 주세요");
    IG_UID = found.id;
  }
}
const igUid = () => IG_UID || "me";

// 저장소 없이 돌 때 쓸 커밋(REPO_SHA 가 없으면 브랜치 최신 커밋)
let remoteSha;
async function repoSha() {
  if (remoteSha) return remoteSha;
  if (process.env.REPO_SHA) return (remoteSha = process.env.REPO_SHA);
  if (IN_REPO) return (remoteSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: __dirname, encoding: "utf8" }).trim());
  const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`브랜치 커밋 조회 실패(HTTP ${r.status})`);
  return (remoteSha = (await r.json()).sha);
}

// 영상 파일이 없으면(저장소 없이, 또는 Actions 의 일부만 체크아웃) 그 커밋에서 내려받는다.
async function ensureLocal(item) {
  const file = path.join(__dirname, item.file);
  if (fs.existsSync(file)) return;
  const url = `https://raw.githubusercontent.com/${REPO}/${await repoSha()}/reel/${item.file}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`영상 내려받기 실패(HTTP ${r.status}): ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// 인스타 서버가 내려받을 공개 주소. 저장소가 공개라 커밋된 파일을 jsDelivr(커밋 고정)로 연다.
async function mediaUrl(item) {
  if (process.env.MEDIA_BASE_URL) return process.env.MEDIA_BASE_URL.replace(/\/$/, "") + "/" + item.file;
  const rel = `reel/${item.file}`;
  if (!IN_REPO) return `https://cdn.jsdelivr.net/gh/${REPO}@${await repoSha()}/${rel}`;
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
  await igReady();
  const r = await igCall("GET", `${IG()}/${igUid()}/media`, { fields: "caption,permalink,timestamp", limit: "25" });
  const hit = (r.data || []).find((m) => (m.caption || "").split("\n")[0].trim() === first);
  return hit ? { media_id: hit.id, url: hit.permalink, at: hit.timestamp, recovered: true } : null;
}

async function publishInstagram(item) {
  const videoUrl = await mediaUrl(item);
  const head = await fetch(videoUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`영상 공개 주소 접근 실패(HTTP ${head.status}): ${videoUrl}`);
  await igReady();
  const uid = igUid();
  // 1) 컨테이너 만들기
  const c = await igCall("POST", `${IG()}/${uid}/media`, {
    media_type: "REELS", video_url: videoUrl, caption: igCaption(item), share_to_feed: "true",
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
  if (IG_HOST === "facebook") return null; // 시스템 사용자 토큰은 만료되지 않아 연장하지 않는다
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
if (!DRY && CFG.enabled === false) {
  console.log(`[${TODAY} KST] 발행 꺼짐(queue/publish.config.json 의 enabled=false) — 아무것도 올리지 않음`);
  process.exit(0);
}
const report = [];
let keySkips = 0, failed = false;

for (const p of targets) {
  const P = PLATFORMS[p];
  // 점검 모드: 키가 실제로 통하는지 먼저 확인(인스타는 계정 이름을 받아 본다). 키 값은 출력하지 않는다.
  if (DRY) {
    const miss = P.keys.filter((k) => !process.env[k]);
    if (miss.length) report.push(`${P.name} 키: 없음(${miss.join(", ")})`);
    else if (p === "ig") {
      try {
        await igReady();
        const me = await igCall("GET", `${IG()}/${igUid()}`, { fields: "username" });
        report.push(`${P.name} 키: 통함 — 계정 @${me.username} (${IG_HOST === "facebook" ? "만료 없는 시스템 사용자 키" : "인스타 로그인 키, 60일·자동 연장"}${process.env.IG_USER_ID ? "" : `, 계정 ID ${igUid()} — IG_USER_ID 로 저장 권장`})`);
      } catch (e) { failed = true; report.push(`${P.name} 키: 안 통함 — ${e.message}`); }
    } else {
      try {
        const tk = await googleToken();
        const ch = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${tk}` } });
        const title = ch.ok ? (await ch.json()).items?.[0]?.snippet?.title : null;
        report.push(`${P.name} 키: 통함${title ? ` — 채널 '${title}'` : " (채널 이름 확인 못 함 — youtube.readonly 범위 확인)"}`);
      }
      catch (e) { failed = true; report.push(`${P.name} 키: 안 통함 — ${e.message}`); }
    }
  }
  const { items, missed } = due(p);
  for (const q of missed) report.push(`${P.name}: ${q.id}(${kstHM(plannedAt(q))}) ${LATE_MIN}분 넘게 지나 건너뜀 — 다시 쓰려면 plan_at 을 새로 잡기`);
  if (!items.length) { report.push(`${P.name}: 지금 올릴 항목 없음`); continue; }
  const missing = P.keys.filter((k) => !process.env[k]);
  if (DRY) {
    for (const item of items) {
      try { await ensureLocal(item); } catch (e) { failed = true; report.push(`${P.name}: ${item.id} ${e.message}`); continue; }
      const problems = check(item);
      if (problems.length) { failed = true; report.push(`${P.name}: ${item.id} 점검 실패 — ${problems.join(" / ")}`); continue; }
      let extra = "";
      if (p === "ig") { try { extra = ` · 공개 주소 ${await mediaUrl(item)}`; } catch (e) { extra = ` · ${e.message}`; } }
      report.push(`${P.name}: ${item.id}(${kstHM(plannedAt(item))}) 올릴 예정 · ${item.file}${extra}` + (missing.length ? ` · 키 없음: ${missing.join(", ")}` : " · 키 있음"));
    }
    continue;
  }
  if (missing.length) { keySkips++; report.push(`${P.name}: 키 미설정으로 건너뜀(${missing.join(", ")})`); continue; }
  let token = null;
  try { if (p === "yt") token = await googleToken(); }
  catch (e) { failed = true; report.push(`${P.name}: ${e.message}`); continue; }
  for (const item of items) {
    try {
      // 계정에 이미 올라가 있는데 기록만 빠진 항목은 기록만 되살린다
      const prior = p === "yt" ? await ytExisting(token, item) : await igExisting(item);
      if (prior) {
        (log.items[item.id] ||= {})[p] = prior;
        saveLog();
        report.push(`${P.name}: ${item.id} 이미 올라가 있어 기록만 복구 → ${prior.url}`);
        continue;
      }
      // 저장소 없이 돌면 기록이 남지 않으니, 계정 확인이 안 되면 올리지 않는다(같은 영상이 또 올라가는 것 방지)
      if (p === "yt" && ytGuardOff && !IN_REPO)
        throw new Error("저장소 없이 실행 중이라 중복 확인이 필요한데 갱신 토큰에 youtube.readonly 범위가 없음 — SOCIAL_SETUP.md 대로 두 범위로 다시 발급");
      await ensureLocal(item);
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
}
if (ytGuardOff) report.push("유튜브 중복 확인 생략(갱신 토큰에 youtube.readonly 범위 없음)");

if (!DRY && targets.includes("ig") && PLATFORMS.ig.keys.every((k) => process.env[k])) {
  const msg = await refreshIgToken().catch((e) => `인스타 토큰 연장 오류: ${e.message}`);
  if (msg) report.push(msg);
}

// 앞으로 잡힌 항목(지금 이후, 아직 안 올린 것)
const upcoming = queue
  .filter((q) => { const t = plannedAt(q); return t != null && t > NOW && targets.some((p) => !done(q.id, p)); })
  .sort((a, b) => plannedAt(a) - plannedAt(b))
  .map((q) => `${q.id}(${kstDate(new Date(plannedAt(q)).toISOString()).slice(5)} ${kstHM(plannedAt(q))})`);
report.push(`앞으로 잡힌 항목: ${upcoming.length ? upcoming.slice(0, 8).join(", ") : "없음 — 루틴이 새 영상을 큐에 넣어야 함"}`);

const code = failed ? 1 : !DRY && keySkips > 0 && keySkips === targets.length ? 2 : 0;
console.log(`[${TODAY} KST]${DRY ? " (점검만)" : ""}\n` + report.join("\n"));
// 매 실행 결과를 남겨 예약 작업이 커밋 → 저장소에서 실행 여부를 확인할 수 있게
if (!DRY) {
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
  fs.writeFileSync(path.join(__dirname, "queue", "last_run.txt"), `${now} KST · exit ${code}\n${report.join("\n")}\n`);
}
process.exit(code);
