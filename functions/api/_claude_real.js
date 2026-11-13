// ③ 실투자 봇 기록 형식 — 봇(사용자 서버 bots/claude-coinbot) · Pages(/api/claude-coinbot) · Worker(/claude-real)가 같은 검사를 쓴다.
// 사용자 2026-11-13 "100만원 소액으로 가자 4는 직접 3은 자동으로" · "당연히 A로"(고정 IP 무료 클라우드 서버에서 업비트 주문).
// 기록 id = real:coin:<업비트 하루(09:00 시작) 날짜>:<buy|sell|skip|error> — 하루에 종류마다 한 번(Worker 장부는 같은 id 를 두 번 쌓지 않는다).
// 매도도 산 날(그 업비트 하루) 날짜로 적는다 — 연구 장부(그날 돌파 매수 → 다음 09:00 매도)와 같은 날짜로 비교한다.
export const REAL_HEAD = "[클로드 연구 비트코인] ";
export const REAL_KINDS = Object.freeze(["buy", "sell", "skip", "error"]);
export const REAL_PAYLOAD_MAX = 2000;
const REAL_RE = /^real:coin:(\d{4}-\d{2}-\d{2}):(buy|sell|skip|error)$/;

export function realId(date, kind) { return "real:coin:" + date + ":" + kind; }

// b: {id, date, payload} → {ok, id, date, kind, payload} | {ok:false, error}. payload 는 2000자 이하 객체(값만 — 키 · 토큰 같은 비밀은 봇이 넣지 않는다).
export function realRecord(b) {
  b = b || {};
  const id = String(b.id || ""), date = String(b.date || ""), m = REAL_RE.exec(id);
  if (!m || m[1] !== date) return { ok: false, error: "id(real:coin:YYYY-MM-DD:buy|sell|skip|error) · date 오류" };
  const p = b.payload && typeof b.payload === "object" && !Array.isArray(b.payload) ? b.payload : null;
  const raw = p ? JSON.stringify(p) : "";
  if (!p || raw.length > REAL_PAYLOAD_MAX) return { ok: false, error: "payload(객체 · " + REAL_PAYLOAD_MAX + "자 이하)" };
  return { ok: true, id, date, kind: m[2], payload: JSON.parse(raw) };
}

// 텔레그램 본문 — 머리말 [클로드 연구 비트코인] 로 시작 · 1500자 이하(claude-telegram ALERT_HEAD 와 같은 머리말)
export function realText(t) {
  const s = String(t || "");
  return s.startsWith(REAL_HEAD) && s.length <= 1500 ? s : null;
}
