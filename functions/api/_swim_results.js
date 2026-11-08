// 수영대회 지난 대회 결과 중계 공용 — 수집기가 공개 자료(competitions.json)에 올린 결과만 허용한다(아무 주소나 대신 받아 주지 않는다).
// 결과지 내용(선수 이름 · 기록)은 저장소에 두지 않는다. 화면이 열 때 원래 사이트에서 가져와 그대로 넘긴다.
const RAW = "https://raw.githubusercontent.com/jkdevjob/jkquant/main/data/swim/competitions.json";
let MEM = { at: 0, doc: null };

export function _setDocForTest(doc) { MEM = { at: doc ? Date.now() : 0, doc }; }

export async function swimDoc(origin, { ttlMs = 10 * 60e3, fetchImpl = fetch } = {}) {
  if (MEM.doc && Date.now() - MEM.at < ttlMs) return MEM.doc;
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
