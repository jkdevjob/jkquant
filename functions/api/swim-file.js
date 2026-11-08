// 수영대회 결과지 받기 · 보기 — GET /api/swim-file?u=<파일 주소>
// 수집기가 공개 자료에 올린 결과 파일만 원래 사이트에서 받아 그대로 넘긴다(저장소에 복사하지 않음 · 엣지 캐시 6시간).
// 그누보드 게시판은 글을 먼저 열어야 받기가 허용된다(바로 받으면 '잘못된 접근입니다' 안내 화면) → 글 → 파일 순서로 같은 쿠키로 받는다.
// 받은 바이트가 파일 형식(PDF · 엑셀 · 한글 · 그림)과 맞지 않으면 넘기지 않는다 — 안내 화면을 결과지로 내려보내지 않는다.
import { swimDoc, findFile, findFresh, json, edgeCache } from "./_swim_results.js";

export const TYPES = {
  pdf: "application/pdf", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", xls: "application/vnd.ms-excel",
  hwp: "application/x-hwp", hwpx: "application/hwp+zip", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip: "application/zip",
  jpg: "image/jpeg", png: "image/png", gif: "image/gif",
};
export const MAX_BYTES = 40 * 1024 * 1024;
const UA = "Mozilla/5.0 (compatible; JKQuantSwim/1.0; +https://jkquant.pages.dev/swim)";

// 같은 이름이 두 번 오면(경기도 연맹: 글을 열며 PHPSESSID 를 새로 바꿔 두 번 보냄) 브라우저처럼 나중 값을 쓴다 —
// 둘 다 보내면 PHP 는 앞의(버려진) 세션을 읽어 '잘못된 접근'이 된다(2026-11-08 실제 확인).
export function cookieHeader(headers, jar = new Map()) {
  const list = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : (headers.get("set-cookie") ? [headers.get("set-cookie")] : []);
  for (const c of list) {
    const kv = String(c).split(";")[0].trim(), i = kv.indexOf("=");
    if (i <= 0 || /[\s;]/.test(kv.slice(0, i))) continue;
    jar.delete(kv.slice(0, i));                    // 같은 이름은 나중 값(자리도 뒤로)
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return [...jar].map(([k, v]) => k + "=" + v).join("; ");
}

export function disposition(name, ext) {
  let n = String(name || "").replace(/[\r\n"\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "result";
  if (!new RegExp("\\." + ext + "$", "i").test(n)) n += "." + ext;
  const ascii = n.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(n)}`;
}

const head = (b, n) => Array.from(b.subarray(0, n));
const starts = (b, sig) => sig.every((x, i) => b[i] === x);
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], ZIP = [0x50, 0x4b, 0x03, 0x04];
export function sniffOk(ext, bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const text = String.fromCharCode(...head(b, 1024));
  if (/alert\s*\(|잘못된 접근/.test(new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 4096))) && b.length < 64 * 1024) return false;
  switch (ext) {
    case "pdf": return text.includes("%PDF");
    case "xlsx": case "docx": case "hwpx": case "zip": return starts(b, ZIP);
    case "xls": return starts(b, OLE) || /<table/i.test(text);     // 표를 HTML 로 저장한 '.xls' 도 있다
    case "doc": case "hwp": return starts(b, OLE);
    case "jpg": return starts(b, [0xff, 0xd8, 0xff]);
    case "png": return starts(b, [0x89, 0x50, 0x4e, 0x47]);
    case "gif": return text.startsWith("GIF8");
    default: return false;
  }
}

export function encodedUrl(u) {
  try { return new URL(u).href; } catch (e) { return encodeURI(String(u)); }
}

export async function fetchUpstream(ent, fetchImpl = fetch) {
  const headers = { "user-agent": UA, "accept-language": "ko-KR,ko;q=0.9", accept: "*/*" };
  if (ent.post) {
    // 글 주소가 다른 주소로 넘기면(30x) 그 사이에 받은 쿠키도 모은다 — 자동 따라가기는 중간 응답의 쿠키를 버린다
    const jar = new Map();
    let url = ent.post, ck = "";
    for (let hop = 0; hop < 4; hop++) {
      const p = await fetchImpl(encodedUrl(url), { headers: ck ? { ...headers, cookie: ck } : headers, redirect: "manual" });
      ck = cookieHeader(p.headers, jar);
      try { await p.arrayBuffer(); } catch (e) { /* 본문은 버린다 */ }
      const loc = p.status >= 300 && p.status < 400 ? p.headers.get("location") : "";
      if (!loc) break;
      url = new URL(loc, url).href;
    }
    if (ck) headers.cookie = ck;
    headers.referer = ent.post;
  }
  // 부산 연맹 첨부처럼 띄어쓰기 · 한글이 그대로 든 주소는 인코딩해서 요청한다. 연결이 한 번 끊기면 한 번 더.
  const target = encodedUrl(ent.file.url);
  try { return await fetchImpl(target, { headers, redirect: "follow" }); }
  catch (e) { return fetchImpl(target, { headers, redirect: "follow" }); }
}

export async function handle(request, { fetchImpl = fetch, waitUntil = null, docLoader = swimDoc } = {}) {
  const u = new URL(request.url), want = u.searchParams.get("u") || "";
  if (!/^https?:\/\/\S/.test(want)) return json({ ok: false, error: "파일 주소가 없습니다" }, 400);
  let ent;
  try { ent = await findFresh(u.origin, d => findFile(d, want), { fetchImpl, docLoader }); }
  catch (e) { return json({ ok: false, error: "수영대회 자료를 읽지 못했습니다" }, 503); }
  if (!ent) return json({ ok: false, error: "수영대회 결과 목록에 없는 파일입니다" }, 403);
  const ext = String(ent.file.ext || "").toLowerCase();
  if (!TYPES[ext]) return json({ ok: false, error: "지원하지 않는 파일 형식" }, 415);
  const cache = edgeCache(), key = new Request("https://swim-file.cache/v1/" + encodeURIComponent(want));
  let buf = null;
  const hit = cache ? await cache.match(key) : null;
  if (hit) buf = new Uint8Array(await hit.arrayBuffer());
  if (!buf) {
    let up;
    try { up = await fetchUpstream(ent, fetchImpl); } catch (e) { return json({ ok: false, error: "원래 사이트에 연결하지 못했습니다", source: ent.post || want }, 502); }
    if (!up.ok) return json({ ok: false, error: "원래 사이트 응답 " + up.status, source: ent.post || want }, 502);
    if (+(up.headers.get("content-length") || 0) > MAX_BYTES) return json({ ok: false, error: "파일이 너무 큽니다(40MB 초과)" }, 413);
    buf = new Uint8Array(await up.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return json({ ok: false, error: "파일이 너무 큽니다(40MB 초과)" }, 413);
    if (!sniffOk(ext, buf))
      return json({ ok: false, error: "원래 사이트가 파일 대신 안내 화면을 보냈습니다 — 원문 글에서 직접 받아 주세요", source: ent.post || want }, 502);
    if (cache) {
      const put = cache.put(key, new Response(buf, { headers: { "content-type": TYPES[ext], "cache-control": "public, max-age=21600" } }));
      if (waitUntil) waitUntil(put); else await put;
    }
  }
  return new Response(buf, { status: 200, headers: {
    "content-type": TYPES[ext], "content-disposition": disposition(ent.file.name, ext), "content-length": String(buf.byteLength),
    "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox",
  } });
}

export async function onRequestGet(context) {
  return handle(context.request, { waitUntil: context.waitUntil ? p => context.waitUntil(p) : null });
}
