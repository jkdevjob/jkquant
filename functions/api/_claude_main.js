// 단타(클로드) 메인 전략 — 탭마다 하나. 승격 버튼으로 바뀌고, 그 기록은 Worker(claude-config)에 쌓기만 한다(덮어쓰지 않음).
// 실시간 화면(claude-live) · 하루 마감 장부/텔레그램(_claude_day · claude-telegram) · ② VTS 주문(opening-gapdown)이
// 모두 이 파일 하나로 "그 날짜에 유효한 메인"을 고른다. 밤 계산(scripts/claude_lab.py MAIN_DEFAULT)과 기본값이 같아야 한다(회귀가 비교).

export const WORKER = "https://jkquant-opening-scheduler.mumae4.workers.dev";
export const TABS = ["opening", "daytrading", "crypto", "soxl"];
export const MAIN_DEFAULT = {
  opening: { version: "opening_gapdown_v1+v2filter", name: "① D-1 갭하락 과매도 v2", params: { minQ: 5, topK: 3, gapMax: null } },
  daytrading: { version: "etf_dip_overnight_v1", name: "② 코스닥150 레버리지 하락일 야간", params: { code: "233740", th: -3.0 } },
  crypto: { version: "coin_breakout_v1", name: "③ BTC·ETH 어제 고가 돌파 하루 단타",
    params: { ma: 20, stopPct: 5.0, level: "prevhigh", k: 0.5, hiN: 1, lastEntryHour: null, tabSize: 0.8, markets: ["KRW-BTC", "KRW-ETH"] } },
  soxl: { version: "soxl_rsi2_meanrev_v1", name: "④ SOXL 단기 과매도 반등 (최대 5일)", params: { rsiMax: 20.0, rsiN: 2, ibsMax: 1.0, downDays: 0, ma: 200, maxHoldDays: 5, tabSize: 0.5 } },
};

const num = (v, lo, hi) => { const x = Number(v); if (!Number.isFinite(x) || x < lo || x > hi) throw new Error("범위 밖 값 " + v + " (" + lo + "~" + hi + ")"); return x; };
const int = (v, lo, hi) => { const x = num(v, lo, hi); if (!Number.isInteger(x)) throw new Error("정수가 아님 " + v); return x; };
// 승격으로 들어올 수 있는 변수와 범위 — 주문 경로가 그대로 실행할 수 있는 것만. 보유 최대 5일(사용자 규칙) · ② 는 233740 만(주문 경로 전용).
// ③ hiN: 최근 N일 고가 돌파(1 = 어제 고가). ④ rsiMax 100 = RSI 조건 없음 · ibsMax 1 = 종가 위치 조건 없음 · downDays 0 = 연속 하락 조건 없음(셋 다 꺼지면 거절).
export function validateParams(tab, p) {
  p = p || {};
  if (tab === "opening") return { minQ: int(p.minQ, 1, 30), topK: int(p.topK, 1, 3), gapMax: p.gapMax == null ? null : num(p.gapMax, -29, -2) };
  if (tab === "daytrading") {
    if (String(p.code) !== "233740") throw new Error("② 주문 경로는 233740 전용 — 다른 종목은 승격 불가");
    return { code: "233740", th: num(p.th, -10, -0.5) };
  }
  if (tab === "crypto") {
    const mk = Array.isArray(p.markets) ? p.markets.map(String) : [];
    if (!mk.length || mk.some(m => m !== "KRW-BTC" && m !== "KRW-ETH") || new Set(mk).size !== mk.length) throw new Error("코인 목록 오류");
    if (p.level !== "prevhigh" && p.level !== "vb") throw new Error("기준선 방식 오류");
    return { ma: int(p.ma, 2, 200), stopPct: num(p.stopPct, 0.5, 99), level: p.level, k: num(p.k, 0, 2), hiN: int(p.hiN ?? 1, 1, 20),
      lastEntryHour: p.lastEntryHour == null ? null : int(p.lastEntryHour, 10, 23), tabSize: num(p.tabSize, 0.1, 1), markets: mk };
  }
  if (tab === "soxl") {
    const o = { rsiMax: num(p.rsiMax, 1, 100), rsiN: int(p.rsiN, 2, 5), ibsMax: num(p.ibsMax ?? 1, 0.05, 1), downDays: int(p.downDays ?? 0, 0, 5),
      ma: int(p.ma, 0, 250), maxHoldDays: int(p.maxHoldDays, 1, 5), tabSize: num(p.tabSize, 0.1, 1) };
    if (o.rsiMax >= 100 && o.ibsMax >= 1 && !o.downDays) throw new Error("④ 진입 조건 없음");
    return o;
  }
  throw new Error("탭 오류");
}

// Worker 기록(쌓인 순서 그대로) → 쓸 수 있는 승격 기록만, 효력일 순. 변수는 기본값 위에 덮고 검사를 통과해야 한다.
export function cleanEvents(raw) {
  const out = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const e = (x && x.payload) || x || {};
    if (!TABS.includes(e.tab) || !e.version || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.effectiveFrom || ""))) continue;
    try {
      out.push({ tab: e.tab, version: String(e.version), name: String(e.name || e.version), rule: String(e.rule || ""), effectiveFrom: e.effectiveFrom,
        promotedAt: String(e.promotedAt || ""), params: validateParams(e.tab, Object.assign({}, MAIN_DEFAULT[e.tab].params, e.params || {})) });
    } catch (err) { /* 검사에 떨어진 기록은 쓰지 않는다 */ }
  }
  return out.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.promotedAt.localeCompare(b.promotedAt));
}
// date(그 시장의 날짜 YYYY-MM-DD)에 유효한 메인. date 없으면 가장 최근 승격(내일부터 적용분 포함).
export function mainFor(events, tab, date) {
  let best = null;
  for (const e of events || []) if (e.tab === tab && (!date || e.effectiveFrom <= date)) best = e;
  if (best) return Object.assign({}, best, { params: Object.assign({}, best.params) });
  const m = MAIN_DEFAULT[tab];
  return { tab, version: m.version, name: m.name, rule: "", effectiveFrom: null, promotedAt: "", params: JSON.parse(JSON.stringify(m.params)) };
}
export function kstDate(ms = Date.now()) {
  return new Date(ms + 9 * 36e5).toISOString().slice(0, 10);
}
// 승격은 다음 날부터 — 장중에 규칙이 바뀌지 않게
export function effectiveFromKst(ms = Date.now()) { return kstDate(ms + 864e5); }

// Worker 에서 승격 기록을 읽는다. 실패하면 {ok:false} — 부르는 쪽이 기본값으로 갈지, 표시할지 정한다.
export async function loadMainEvents(env, timeoutMs = 4000) {
  const key = String(env.OPENING_MONITOR_KEY || env.AUTOTRADE_KEY || "").trim();
  if (!key) return { ok: false, events: [], error: "감시키 없음" };
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const r = await fetch(WORKER + "/claude-config", { headers: { "x-monitor-key": key, Accept: "application/json" }, signal: ac ? ac.signal : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, events: [], error: j.error || ("HTTP " + r.status) };
    return { ok: true, events: cleanEvents(j.events) };
  } catch (e) { return { ok: false, events: [], error: String(e.message || e) }; }
  finally { if (t) clearTimeout(t); }
}

// ① 회계: 그날 메인 기준 매매일인지(통과 종목 수) · 장부에 넣을 종목(깊은 갭 topK, gapMax 이하). 주문은 그대로 깊은 3종목(측정용 포함)이다.
export function openingCounts(p, qualified) { return (Number(qualified) || 0) >= (p.minQ || 5); }
export function openingPick(p, picks) {
  return (Array.isArray(picks) ? picks : []).filter(x => p.gapMax == null || (Number.isFinite(+x.expectedGapPct) && +x.expectedGapPct <= p.gapMax))
    .map((x, i) => [x, i]).sort((a, b) => {                                   // 갭 깊은 순(값 없으면 원래 순서 — 주문은 이미 깊은 순)
      const ga = +a[0].expectedGapPct, gb = +b[0].expectedGapPct;
      return (Number.isFinite(ga) && Number.isFinite(gb) ? ga - gb : 0) || a[1] - b[1];
    }).slice(0, p.topK || 3).map(([x]) => String(x.code));
}
