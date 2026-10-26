// Cloudflare Pages Function — GET /api/claude-history
// 단타(클로드) 전략별 매매 이력(메인 · 그림자 · 퇴출) 조회. 읽기 전용 — 주문 · 계좌 경로 없음. 소유자만.
// 사용자 요청(2026-10-22): "모든 탭 그림자 전략 포함 모든 매매이력 기록하고 조회 가능하게 만들어".
// 원본: 밤 계산(scripts/claude_lab.py write_history)이 scalping-data 브랜치에 쓰는 data/claude-lab/history/{탭}/{버전}.json · index.json.
//  ?index=1             → 탭별 전략 목록(상태 · 매매 수 · 매일 기록 일수)
//  ?tab=..&version=..   → 그 전략의 과거 계산 · 매일 기록 · 실시간 마감 장부

import { claudeAuthorized } from "./_claude_auth.js";
const JH = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const RAW = "https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/claude-lab/history/";
export const HIST_TABS = ["opening", "daytrading", "crypto", "soxl", "close30"];
export const VERSION_RE = /^[A-Za-z0-9_.+:-]{1,80}$/;              // 밤 계산 VERSION_RE 와 같다 — 경로 문자(/ ..)는 받지 않는다
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: JH });

// 요청 → 읽을 파일 경로(검사 통과한 것만). 틀리면 {error}
export function historyPath(params) {
  if (params.get("index") === "1") return { path: "index.json" };
  const tab = String(params.get("tab") || ""), version = String(params.get("version") || "");
  if (!HIST_TABS.includes(tab)) return { error: "tab 오류" };
  if (!VERSION_RE.test(version) || version.includes("..")) return { error: "version 오류" };
  return { path: tab + "/" + encodeURIComponent(version) + ".json" };
}

export async function onRequestGet({ request, env }) {
  if (!(await claudeAuthorized(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
  const q = historyPath(new URL(request.url).searchParams);
  if (q.error) return json({ ok: false, error: q.error }, 400);
  try {
    const r = await fetch(RAW + q.path + "?t=" + Date.now(), { headers: { Accept: "application/json", "User-Agent": "jkquant-claude-history/1.0" } });
    if (r.status === 404) return json({ ok: false, error: "아직 기록 없음 — 밤 계산 뒤 생깁니다" }, 404);
    if (!r.ok) return json({ ok: false, error: "GitHub raw HTTP " + r.status }, 502);
    return json({ ok: true, data: await r.json() });
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 502);
  }
}
