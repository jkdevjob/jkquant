// 수영대회 지난 대회 결과 중계 공용 — 수집기가 공개 자료(competitions.json)에 올린 결과만 허용한다(아무 주소나 대신 받아 주지 않는다).
// 결과지 내용(선수 이름 · 기록)은 저장소에 두지 않는다. 화면이 열 때 원래 사이트에서 가져와 그대로 넘긴다.
const RAW = "https://raw.githubusercontent.com/jkdevjob/jkquant/main/data/swim/competitions.json";
let MEM = { at: 0, doc: null }, LAST_FORCE = 0;

export function _setDocForTest(doc) { MEM = { at: doc ? Date.now() : 0, doc }; LAST_FORCE = 0; }

export async function swimDoc(origin, { ttlMs = 10 * 60e3, fetchImpl = fetch, force = false } = {}) {
  if (!force && MEM.doc && Date.now() - MEM.at < ttlMs) return MEM.doc;
  const urls = [RAW + "?ts=" + Math.floor(Date.now() / 60e3), String(origin || "") + "/data/swim/competitions.json"];
  let best = null;
  for (const u of urls) {
    try {
      const r = await fetchImpl(u, { headers: { accept: "application/json", "user-agent": "JKQuant-Swim-Results/1.0" } });
      if (!r.ok) continue;
      const doc = await r.json();
      if (doc && Array.isArray(doc.competitions) && (!best || String(doc.data_changed_at || "") > String(best.data_changed_at || ""))) best = doc;
    } catch (e) { /* 다음 주소 */ }
  }
  if (best) { MEM = { at: Date.now(), doc: best }; return best; }
  if (MEM.doc) return MEM.doc;
  throw new Error("수영대회 자료를 읽지 못함");
}

// 목록에서 찾고, 없으면 자료를 새로 읽어 한 번 더 찾는다 — 매일 수집이 방금 새 결과를 올렸는데 기억해 둔 자료(10분)가
// 예전 것이면 '목록에 없는 파일'로 거절된다(2026-11-08 운영에서 실제로 겪음). 새로 읽기는 1분에 한 번만(아무 주소로 두드려도 원본을 계속 읽지 않게).
export async function findFresh(origin, find, { fetchImpl = fetch, docLoader = swimDoc, now = Date.now() } = {}) {
  let hit = find(await docLoader(origin, { fetchImpl }));
  if (!hit && now - LAST_FORCE > 60e3) {
    LAST_FORCE = now;
    hit = find(await docLoader(origin, { fetchImpl, force: true }));
  }
  return hit;
}

export function findFile(doc, url) {
  for (const c of (doc && doc.competitions) || [])
    for (const r of c.results || [])
      if (r && r.kind === "files")
        for (const f of r.files || [])
          if (f && f.url === url) return { file: f, post: r.direct ? "" : String(r.url || ""), comp: c };
  return null;
}

export function findSystem(doc, sys, toCd, classCd) {
  for (const c of (doc && doc.competitions) || [])
    for (const r of c.results || [])
      if (r && r.kind === "system" && r.sys === sys && r.toCd === toCd && r.classCd === classCd) return { result: r, comp: c };
  return null;
}

export const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } });

export const edgeCache = () => (typeof caches !== "undefined" && caches.default) || null;
