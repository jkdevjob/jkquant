// 단타(클로드) 전략별 '하루 마감 장부' — 웹 오늘 모의매매 이력과 Telegram 결과가 같은 원본을 쓴다.
// 원본: ①②⑤ = Worker gapdown ledger(전략이 낸 주문 · 판단) + 그날 공식 시가 · 종가(bars), ③ = 업비트 60분봉(끝난 봉만), ④ = 밤 판단(nextSignal) + 마감 시세.
// ①②⑤ 정산(2026-10-22 사용자 "모의계좌로 판단하지 말고 그냥 모의계좌에 주문한 건으로 정산해야지 · 지금은 모의계좌가 안 되니까"):
//  모의투자 체결 여부와 상관없이 '주문한 건'(그날 메인이 고른 종목 · 신호)을 공식 시가 · 종가로 정산한다. 비용은 밤 계산과 같은 식.
//  장부에 basis="orders" · dayPct(그날 칸 값 = 종목 균등 평균) · settled(시세가 다 있었는지)를 남긴다 — 화면 · 밤 계산이 이 값을 그대로 쓴다.
//  모의투자 체결 · 거절은 줄마다 vts 로 측정용으로만 남긴다.
// 모든 함수는 마감 시점까지 들어온 자료만 받는다(미래 자료 없음). 순손익 = 비용(수수료·세금·미끄러짐) 뺀 값.
import { coinHoldToday, coinBreakoutDay, c30CostPct, d1CostPct, etfRuleCost, SETTLE_BASIS } from "./claude-live.js";
import { MAIN_DEFAULT, VTS_OFF, mainFor, openingCounts, openingPick } from "./_claude_main.js";

export const COST = { kr: 0.23, etf: 0.13, coin: 0.14, us: 0.20 };          // 왕복 %, 연구·실시간과 같은 값
export const PAPER_CAPITAL = { coin: 10000000, soxl: 10000 };                // 주문 없는 칸의 모의 자금(원 · 달러)
export const NAMES = {
  opening: "① 시초가 · D-1 갭하락 과매도", daytrading: "② 데이트레이딩 · 코스닥150 레버리지 하락일 야간",
  crypto: "③ 비트코인 · BTC·ETH 어제 고가 돌파 하루 단타", soxl: "④ SOXL · 단기 과매도 반등(최대 5일)",
  close30: "⑤ 종가 30분 · 코스닥150 레버리지 장 마감 30분 반등(실험)", overview: "📅 전일·당일 요약"
};
const pct = (a, b) => (a > 0 && b > 0 ? (a / b - 1) * 100 : null);

function finish(r) {
  const t = r.trades || [];
  r.exits = t.length;
  r.wins = t.filter(x => x.pnlPct > 0).length;
  r.losses = t.filter(x => x.pnlPct <= 0).length;
  r.winRate = t.length ? (r.wins / t.length) * 100 : null;
  r.realizedAmount = t.reduce((s, x) => s + (x.pnlAmount || 0), 0);
  const base = r.realizedBase != null ? r.realizedBase : t.reduce((s, x) => s + (x.notional || 0), 0);
  r.realizedPct = base > 0 ? (r.realizedAmount / base) * 100 : 0;
  delete r.realizedBase;
  return r;
}
// 신호 낸 조건 — 정산 줄마다 판단 시각 · 판단 가격 · 기준을 같이 남긴다(2026-10-22 사용자 "너가 모의투자 신호 보낸 조건으로 이력 남기고 정산").
// 시각은 그 단계 판단이 끝난 시각(finishedAt, 한국시각 HH:MM:SS).
export const kstClock = iso => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t + 9 * 36e5).toISOString().slice(11, 19) : null; };
const etfSignal = s => ({ at: kstClock(s.finishedAt), expectedPrice: (s.quote || {}).expectedPrice ?? null, basePrice: (s.quote || {}).basePrice ?? null,
  dropPct: s.dropPct ?? null, th: (s.rule || {}).dropMaxPct ?? null, version: s.strategyVersion || null, reason: s.decisionReason || "" });
function stagesOf(ledger) {
  const m = {};
  for (const e of (ledger && Array.isArray(ledger.events) ? ledger.events : [])) if (e && e.stage) m[e.stage] = e.payload || {};
  return m;
}

// ① 08:59 동시호가 매수 → 15:30 종가 동시호가 매도. 15:40 체결조회(reconcile)까지 끝난 장부만 받는다.
// main: 그날 ① 메인(_claude_main.mainFor) — 매매일 기준(통과 종목 수)과 장부에 넣을 종목(깊은 갭 topK · gapMax 이하). 없으면 기본 메인.
export function openingDay(date, ledger, krOpen, marks = {}, main = null, bars = {}) {
  const r = { strategy: "opening", name: NAMES.opening, date, currency: "KRW", basis: SETTLE_BASIS, trades: [], open: [], measure: [] };
  if (!krOpen) return Object.assign(r, { status: "holiday", note: "국내 휴장" });
  const st = stagesOf(ledger), pre = st.preopen, rec = st.reconcile || {};
  if (!pre) return Object.assign(finish(r), { status: "closed", settled: false, dayPct: null, watched: 0, candidates: 0, entries: 0, note: "08:56 판단 기록 없음 — 점검" });
  const M = main || mainFor([], "opening"), P = M.params, isDef = M.version === MAIN_DEFAULT.opening.version, lab = isDef ? "v2 매매일" : "메인 매매일";
  const b = pre.breadth || {}, v2 = b.qualified == null ? !!b.v2Signal : openingCounts(P, b.qualified);
  const src = (pre.picks || []).length ? pre.picks : (pre.orders || []).filter(o => o.side === "buy").map(o => ({ code: o.code, name: o.name, expectedGapPct: o.expectedGapPct }));
  const keep = new Set(openingPick(P, src));                                // 메인이 장부에 넣는 종목(깊은 갭 topK · gapMax 이하)
  const pos = Object.fromEntries((rec.positions || []).map(p => [String(p.code), p]));
  const ord = Object.fromEntries((pre.orders || []).filter(o => o.side === "buy").map(o => [String(o.code), o]));
  const rows = [];
  for (const p of src) {                                                    // 주문한 종목 = 그날 고른 종목(모의투자 체결과 상관없이)
    const code = String(p.code), bar = (bars || {})[code] || {}, o = ord[code] || {}, ps = pos[code] || {}, pb = ps.buy || {}, pv = ps.sell || {};
    const qty = +((o.sizing || {}).planned) || +o.qty || 0;                 // 주문한 수량(계좌 현금에 맞추기 전 계획)
    const vts = { ok: !!(o.vts && o.vts.ok), msg: String(o.vts ? o.vts.msg || "" : pre.ordersSkipped || "주문 기록 없음"), buyQty: +pb.qty || 0, buyAvg: pb.avgPrice ?? null, sellQty: +pv.qty || 0, sellAvg: pv.avgPrice ?? null };
    const signal = { at: kstClock(pre.finishedAt), expectedPrice: p.expectedPrice ?? null, basePrice: p.basePrice ?? null, expectedGapPct: p.expectedGapPct ?? null,
      rsi14Prev: p.rsi14Prev ?? null, qualified: b.qualified ?? null, recheck: !!(pre.recheck && pre.recheck.used), reason: pre.decisionReason || "" };
    const base = { name: p.name || o.name || code, code, entryTime: "09:00 시가(동시호가)", qty, vts, signal };
    if (+bar.open > 0 && +bar.close > 0) {
      const net = pct(+bar.close, +bar.open) - d1CostPct(+bar.open), notional = qty * +bar.open;
      rows.push(Object.assign(base, { entryPrice: +bar.open, exitTime: "15:30 종가(동시호가)", exitPrice: +bar.close, notional, pnlPct: net, pnlAmount: (notional * net) / 100, reason: "종가 청산" }));
    } else rows.push(Object.assign(base, { open: true, entryPrice: +bar.open || +p.expectedPrice || null, markPrice: (marks || {})[code] || null, pnlPct: null, reason: "시세 없음 — 점검" }));
  }
  const mine = rows.filter(x => keep.has(String(x.code))), extra = rows.filter(x => !keep.has(String(x.code)));
  const done = mine.filter(x => !x.open), open = mine.filter(x => x.open);
  if (v2) { r.trades = done; r.open = open; if (extra.length) r.measure = extra; }   // 메인이 고른 종목만 손익, 나머지 주문은 측정용
  else r.measure = rows;                                                    // 매매일이 아니면 측정용 — 전략 손익에 안 셈
  const nv = mine.filter(x => !x.vts.ok && x.vts.msg !== VTS_OFF);            // 모의투자를 꺼둔 날은 경고가 아니다
  if (v2 && nv.length) r.warn = "모의계좌 주문 안 됨 " + nv.length + "건(" + nv[0].vts.msg.replace(/^매수 생략 — /, "").replace(/ · 계획.*$/, "") + ") — 정산은 주문한 종목의 시가 · 종가로";
  if (v2 && open.length) r.warn = (r.warn ? r.warn + " · " : "") + "시세 없는 종목 " + open.length + "건 — 점검";
  const tv = done.map(x => x.pnlPct);
  return Object.assign(finish(r), {
    status: "closed", settled: !(v2 && open.length), dayPct: v2 && tv.length && !open.length ? tv.reduce((a, x) => a + x, 0) / tv.length : null,
    watched: (pre.watchlist || {}).size || 0, candidates: b.qualified || 0, entries: v2 ? mine.length : 0,
    strategyVersion: M.version, params: P,
    note: v2 ? lab + "(통과 " + b.qualified + "종목)" + (extra.length ? " · 장부 " + mine.length + "종목(메인 깊은 " + P.topK + (P.gapMax != null ? " · 갭 " + P.gapMax + "% 이하" : "") + ")" : "")
      : rows.length ? lab + " 아님(통과 " + (b.qualified || 0) + "<" + P.minQ + ") — 측정용 주문은 전략 손익에 안 셈"
      : "매매 없음 — " + (pre.decisionReason || "조건 맞는 종목 없음")
  });
}

// ② 전날 15:21 신호(종가 매수 주문) → 오늘 09:00 시가 매도(실현) + 오늘 15:21 신호면 종가 매수(미청산, 내일 아침 매도).
// 주문한 건을 공식 종가 → 다음 날 시가로 정산(bars: {날짜: 233740 일봉}). 비용은 밤 계산 etf_variant 와 같은 식(0.03% + 2틱).
export function etfDay(date, ledger, prevLedger, prevDate, krOpen, bars = {}) {
  const N = "KODEX 코스닥150레버리지";
  const r = { strategy: "daytrading", name: NAMES.daytrading, date, currency: "KRW", basis: SETTLE_BASIS, trades: [], open: [], watched: 1 };
  if (!krOpen) return Object.assign(r, { status: "holiday", note: "국내 휴장" });
  const st = stagesOf(ledger), pst = stagesOf(prevLedger), bar = d => (bars || {})[d] || {};
  const pb = pst.etf_buy || null, buy = st.etf_buy || null;
  const vtsOf = (o, f, skipped) => ({ ok: !!(o && o.vts && o.vts.ok), msg: String(o && o.vts ? o.vts.msg || "" : skipped || "주문 기록 없음"), qty: +(f || {}).qty || 0, avg: (f || {}).avgPrice ?? null });
  let settled = true, dayPct = null;
  if (pb && pb.signal) {                                                    // 전날 주문한 건 — 오늘 시가 매도
    const bc = +bar(prevDate).close, so = +bar(date).open, o = pb.order || {}, qty = +((o.sizing || {}).planned) || +o.qty || 0;
    const vts = vtsOf(pb.order, ((pst.etf_reconcile || {}).fills || {}).closeBuy, pb.ordersSkipped);
    if (bc > 0 && so > 0) {
      const net = pct(so, bc) - etfRuleCost(bc), notional = qty * bc;
      r.trades.push({ name: N, code: "233740", entryTime: prevDate + " 15:30 종가", entryPrice: bc, exitTime: "09:00 시가", exitPrice: so, qty, notional,
        pnlPct: net, pnlAmount: (notional * net) / 100, reason: "다음 날 시가 청산", vts, signal: etfSignal(pb) });
      dayPct = net;
    } else {
      settled = false;
      r.open.push({ name: N, code: "233740", entryTime: prevDate + " 15:30 종가", entryPrice: bc || null, qty, pnlPct: null, reason: "시세 없음 — 점검", vts, signal: etfSignal(pb) });
    }
  }
  if (buy && buy.signal) {                                                  // 오늘 주문한 건 — 내일 시가 매도
    const bc = +bar(date).close, o = buy.order || {}, qty = +((o.sizing || {}).planned) || +o.qty || 0;
    r.open.push({ name: N, code: "233740", entryTime: "15:30 종가", entryPrice: bc || +((buy.quote || {}).expectedPrice) || null, qty, pnlPct: 0, reason: "내일 09:00 시가 매도",
      vts: vtsOf(buy.order, ((st.etf_reconcile || {}).fills || {}).closeBuy, buy.ordersSkipped), signal: etfSignal(buy) });
  }
  const nv = [...r.trades, ...r.open].filter(x => !x.vts.ok && x.vts.msg !== VTS_OFF);
  if (nv.length) r.warn = "모의계좌 주문 안 됨 " + nv.length + "건(" + nv[0].vts.msg.replace(/^매수 생략 — /, "").replace(/ · 계획.*$/, "") + ") — 정산은 주문한 건의 종가 · 시가로";
  if (!settled) r.warn = (r.warn ? r.warn + " · " : "") + "시세 없음 — 점검";
  return Object.assign(finish(r), {
    status: "closed", settled, dayPct, candidates: buy && buy.signal ? 1 : 0, entries: buy && buy.signal ? 1 : 0,
    strategyVersion: buy && buy.strategyVersion || MAIN_DEFAULT.daytrading.version,
    params: buy && buy.rule ? { code: "233740", th: buy.rule.dropMaxPct } : Object.assign({}, MAIN_DEFAULT.daytrading.params),
    note: buy ? (buy.signal ? "15:21 예상 하락 " + (+buy.dropPct).toFixed(2) + "% → 종가 매수" : "15:21 예상 하락 " + (buy.dropPct == null ? "—" : (+buy.dropPct).toFixed(2) + "%") + " (기준 " + String((buy.rule && buy.rule.dropMaxPct) ?? -3).replace("-", "−") + "% 이하 아님) → 매수 없음")
      : "15:21 판단 기록 없음 — 점검"
  });
}

// ⑤ 15:00 매수 → 15:30 종가 동시호가 매도(당일 청산). 주문한 건(15:00 신호)을 15:00 판단 가격 → 그날 공식 종가로 정산(bars: {날짜: 233740 일봉}).
// 비용은 실시간 화면 · 밤 계산과 같은 식(c30CostPct). 모의투자 체결은 측정용(vts).
export function close30Day(date, ledger, krOpen, bars = {}) {
  const r = { strategy: "close30", name: NAMES.close30, date, currency: "KRW", basis: SETTLE_BASIS, trades: [], open: [], watched: 1 };
  if (!krOpen) return Object.assign(r, { status: "holiday", note: "국내 휴장" });
  const st = stagesOf(ledger), buy = st.c30_buy || null, f = (st.c30_reconcile || {}).fills || {};
  const N = "KODEX 코스닥150레버리지";
  let settled = !!buy, dayPct = null;
  if (buy && buy.signal) {
    const p15 = +((buy.quote || {}).price) || 0, close = +((bars || {})[date] || {}).close || 0, o = buy.order || {};
    const qty = +((o.sizing || {}).planned) || +o.qty || 0;
    const vts = { ok: !!(o.vts && o.vts.ok), msg: String(o.vts ? o.vts.msg || "" : buy.ordersSkipped || "주문 기록 없음"), buyQty: +(f.buy || {}).qty || 0, buyAvg: (f.buy || {}).avgPrice ?? null,
      sellQty: +(f.sell || {}).qty || 0, sellAvg: (f.sell || {}).avgPrice ?? null };
    const signal = { at: kstClock(buy.finishedAt), price: (buy.quote || {}).price ?? null, sofarPct: buy.sofarPct ?? null, th: (buy.rule || {}).th ?? null,
      version: buy.strategyVersion || null, reason: buy.decisionReason || "" };
    if (p15 > 0 && close > 0) {
      const net = pct(close, p15) - c30CostPct(p15), notional = qty * p15;
      r.trades.push({ name: N, code: "233740", entryTime: "15:00", entryPrice: p15, exitTime: "15:30 종가(동시호가)", exitPrice: close, qty, notional,
        pnlPct: net, pnlAmount: (notional * net) / 100, reason: "종가 청산", vts, signal });
      dayPct = net;
    } else {
      settled = false;
      r.open.push({ name: N, code: "233740", entryTime: "15:00", entryPrice: p15 || null, qty, pnlPct: null, reason: "시세 없음 — 점검", vts, signal });
    }
    if (!vts.ok && vts.msg !== VTS_OFF) r.warn = "모의계좌 주문 안 됨(" + vts.msg.replace(/^매수 생략 — /, "").replace(/ · 계획.*$/, "") + ") — 정산은 15:00 가격 · 종가로";
  }
  const th = String((buy && buy.rule && buy.rule.th) ?? 0).replace("-", "−");
  return Object.assign(finish(r), {
    status: "closed", settled, dayPct, candidates: buy && buy.signal ? 1 : 0, entries: buy && buy.signal ? 1 : 0,
    strategyVersion: (buy && buy.strategyVersion) || MAIN_DEFAULT.close30.version,
    params: buy && buy.rule ? { code: "233740", th: buy.rule.th } : Object.assign({}, MAIN_DEFAULT.close30.params),
    note: !buy ? "15:00 판단 기록 없음 — 점검"
      : buy.signal ? "15:00 전일 대비 " + P(buy.sofarPct) + " → 매수"
      : "15:00 전일 대비 " + (buy.sofarPct == null ? "—" : P(buy.sofarPct)) + " (기준 " + th + "% 미만 아님) → 매수 없음"
  });
}

// ③ 한국시각 00:00 마감 하루(d 00:00 ~ d+1 00:00) — 그 안에서 청산된 매매는 실현, 00:00 에 들고 있는 매매는 미청산.
// 매매 규칙은 업비트 하루(09:00~다음 09:00) 기준 그대로: 업비트 하루 d-1 의 매수분은 d 09:00 에, d 의 매수분은 d+1 09:00 에 판다.
// coins: [{market, daily(최신순, 0=진행 중 업비트 하루), hourly(최신순 60분봉)}] — 00:00 전에 끝난 봉만 쓴다.
// mainOn(업비트 하루 날짜) → 그 하루의 ③ 메인. 없으면 기본 메인.
export function coinDay(date, coins, closeMs, mainOn = null) {
  const r = { strategy: "crypto", name: NAMES.crypto, date, currency: "KRW", trades: [], open: [], watched: 0, candidates: 0, entries: 0 };
  const dayStart = Date.parse(date + "T00:00:00+09:00"), dayEnd = closeMs || dayStart + 864e5;
  const slot = PAPER_CAPITAL.coin / Math.max(1, coins.length);
  const t = b => Date.parse(String(b.candle_date_time_kst) + "+09:00");
  const hm = ms => new Date(ms + 9 * 36e5).toISOString().slice(5, 16).replace("T", " ");
  for (const c of coins) {
    const name = c.market.replace("KRW-", "");
    r.watched++;
    const daily = c.daily || [], hourly = (c.hourly || []).filter(b => t(b) + 36e5 <= dayEnd);   // 마감 전에 끝난 봉만
    for (const k of [1, 0]) {                                                   // 업비트 하루: 전날(d-1 09:00 시작) · 오늘(d 09:00 시작)
      const ud = new Date(dayStart - k * 864e5 + 9 * 36e5).toISOString().slice(0, 10);
      const idx = daily.findIndex(x => String(x.candle_date_time_kst || "").slice(0, 10) === ud);
      if (idx < 0) continue;
      const P = (mainOn ? mainOn(ud) : mainFor([], "crypto")).params;
      if (!P.markets.includes(c.market)) continue;                           // 그 하루의 메인에 없는 코인
      const h = coinHoldToday(daily.slice(idx), P);                          // 그 업비트 하루의 판단(전날까지 확정 종가)
      if (!h) continue;
      if (h.hold && ud === date) r.candidates++;
      const s0 = Date.parse(ud + "T09:00:00+09:00");
      const bars = hourly.filter(b => t(b) >= s0 && t(b) < s0 + 864e5).sort((a, b) => t(a) - t(b));
      const res = coinBreakoutDay(h, bars, bars.length ? +bars[bars.length - 1].trade_price : null, P);
      if (!res || !res.hold) continue;
      const entryBar = bars.find(b => String(b.candle_date_time_kst).slice(11, 16) === res.buyTime) || bars[0];
      const entryMs = t(entryBar);
      const stopBar = res.stopped ? bars.find(b => t(b) >= entryMs && +b.low_price <= res.stopPrice) : null;
      const exitMs = stopBar ? t(stopBar) : s0 + 864e5;                        // 손절 봉 또는 다음 날 09:00
      const row = { name, entryTime: hm(entryMs), entryPrice: res.buyPrice, notional: slot };
      if (entryMs >= dayStart && entryMs < dayEnd) r.entries++;
      if (exitMs >= dayStart && exitMs < dayEnd && (stopBar || bars.length === 24)) {
        const exitPrice = stopBar ? res.stopPrice : +bars[bars.length - 1].trade_price;
        r.trades.push(Object.assign(row, { exitTime: hm(exitMs), exitPrice, pnlPct: res.pnlPct, pnlAmount: (slot * res.pnlPct) / 100,
          reason: stopBar ? "손절 −" + P.stopPct + "%" : "다음 날 09:00 청산" }));
      } else if (exitMs >= dayEnd) {
        const mark = bars.length ? +bars[bars.length - 1].trade_price : null;
        r.open.push(Object.assign(row, { markPrice: mark, pnlPct: mark ? pct(mark, res.buyPrice) - COST.coin : null, reason: "다음 09:00 매도 예정" }));
      }
    }
  }
  r.realizedBase = PAPER_CAPITAL.coin;                                       // 코인 칸(두 코인 반반) 기준 수익률
  return Object.assign(finish(r), { status: "closed", note: "한국시각 00:00 마감 · 매매 규칙은 업비트 하루(09:00~다음 09:00) 그대로",
    capitalNote: "코인 칸 모의 자금 " + PAPER_CAPITAL.coin.toLocaleString("en-US") + "원(두 코인 반반)" });
}

// ④ 미국 정규장 마감(16:00 ET) 뒤. nx = 밤 계산(전날 확정 종가)의 오늘 할 일, q = 마감 시세, entry = 가장 최근 매수 기록.
export function soxlDay(nyDate, nx, q, entry) {
  const r = { strategy: "soxl", name: NAMES.soxl, date: nyDate, currency: "USD", trades: [], open: [], watched: 1, candidates: 0, entries: 0 };
  const ohlc = (q && q.ohlc) || [], sess = ohlc[ohlc.length - 1] || null;
  if (!sess || sess.date !== nyDate) return Object.assign(r, { status: "holiday", note: "미국 휴장(오늘 세션 없음)" });
  if (!nx || nx.action === undefined || nx.basedOn >= nyDate) return Object.assign(finish(r), { status: "closed", note: "밤 판단 없음 — 점검" });
  const close = +sess.close, open = +sess.open, cap = PAPER_CAPITAL.soxl;
  if (nx.action === "buy") {
    r.candidates = 1; r.entries = 1;
    r.open.push({ name: "SOXL", entryTime: nyDate + " 09:30 시가", entryPrice: open, markPrice: close, pnlPct: pct(close, open) - COST.us / 2, reason: "오른 날 다음 시가 매도(최대 " + (nx.maxHoldDays || 5) + "일)" });
  } else if (nx.action === "sell" && entry && entry.entryPrice > 0) {
    const net = pct(open, +entry.entryPrice) - COST.us;
    r.trades.push({ name: "SOXL", entryTime: entry.date + " 시가", entryPrice: +entry.entryPrice, exitTime: nyDate + " 09:30 시가", exitPrice: open, notional: cap,
      pnlPct: net, pnlAmount: (cap * net) / 100, reason: nx.heldDays >= (nx.maxHoldDays || 5) ? "최대 " + (nx.maxHoldDays || 5) + "일 청산" : "반등 청산(오른 날 다음 시가)" });
  } else if (nx.holding && entry && entry.entryPrice > 0) {
    r.open.push({ name: "SOXL", entryTime: entry.date + " 시가", entryPrice: +entry.entryPrice, markPrice: close, pnlPct: pct(close, +entry.entryPrice) - COST.us / 2,
      reason: (nx.heldDays + 1) + "일째 보유 (최대 " + (nx.maxHoldDays || 5) + "일)" });
  }
  r.realizedBase = cap;
  return Object.assign(finish(r), { status: "closed",
    strategyVersion: nx.version || MAIN_DEFAULT.soxl.version,
    note: nx.action === "buy" ? "전날 확정 종가 " + (nx.entryRule || "RSI(" + (nx.rsiN || 2) + ") " + (+nx.rsi2).toFixed(0) + " < " + (nx.rsiMax ?? 20) + ((nx.maDays ?? 200) ? " · " + (nx.maDays ?? 200) + "일 평균 위" : "")) + " → 시가 매수"
      : nx.action === "sell" ? "시가 매도" : nx.holding ? "보유 유지" : (nx.why ? "신호 없음(" + nx.why + ") — 쉼" : "과매도 신호 없음 — 쉼"),
    capitalNote: "모의 자금 $" + cap.toLocaleString("en-US") });
}

// 메시지 — 마감 장부(result) 하나만으로 만든다(다시 계산하지 않는다)
function money(v, cur) {
  if (v == null || !isFinite(v)) return "—";
  const s = v >= 0 ? "+" : "-", a = Math.abs(v);
  return cur === "USD" ? s + "$" + a.toFixed(2) : s + Math.round(a).toLocaleString("en-US") + "원";
}
const P = v => (v == null || !isFinite(v) ? "—" : (v >= 0 ? "+" : "") + (+v).toFixed(2) + "%");
const N = v => (v == null || !isFinite(v) ? "—" : +v >= 1000 ? Math.round(+v).toLocaleString("en-US") : (+v).toFixed(2));
export function composeDay(r) {
  const L = ["[" + r.name + " · " + r.date + " 종료]"];
  if (r.status === "holiday") { L.push("휴장 — 거래 결과 없음 (" + (r.note || "") + ")"); return L.join("\n"); }
  L.push("감시 " + (r.watched || 0) + " / 후보 " + (r.candidates || 0) + " / 진입 " + (r.entries || 0) + " / 청산 " + (r.exits || 0));
  L.push("승 " + (r.wins || 0) + " / 패 " + (r.losses || 0) + " / 승률 " + (r.winRate == null ? "—" : r.winRate.toFixed(1) + "%"));
  L.push("실현수익률 " + P(r.realizedPct) + " · 실현손익 " + money(r.realizedAmount, r.currency) + " (비용 뺀 순손익)");
  if (r.note) L.push(r.note);
  if (r.warn) L.push("⚠️ " + r.warn);
  if ((r.trades || []).length) {
    L.push("");
    r.trades.forEach((x, i) => L.push((i + 1) + ". " + x.name + " " + x.entryTime + " " + N(x.entryPrice) + " → " + x.exitTime + " " + N(x.exitPrice) + " " + P(x.pnlPct) + " " + money(x.pnlAmount, r.currency) + " " + x.reason));
  } else L.push("거래 없음");
  L.push("");
  L.push("미청산: " + (r.open || []).length);
  for (const x of r.open || []) L.push(" · " + x.name + " " + x.entryTime + " " + N(x.entryPrice) + (x.markPrice ? " → 현재 " + N(x.markPrice) : "") + " " + P(x.pnlPct) + " (" + x.reason + ")");
  if ((r.measure || []).length) {
    L.push("측정용(전략 손익 제외): " + r.measure.map(x => x.name + " " + P(x.pnlPct)).join(" · "));
  }
  if (r.capitalNote) L.push(r.capitalNote);
  L.push("모의투자 · 자세히: jkquant.pages.dev/claude");
  return L.join("\n");
}
export function composeOverview(date, recs) {
  const L = ["[" + NAMES.overview + " · " + date + " 국내장 종료]"];
  for (const k of ["opening", "daytrading", "crypto", "soxl"]) {
    const r = recs[k];
    if (!r) { L.push(NAMES[k].split(" · ")[0] + ": 마감 장부 없음"); continue; }
    L.push(NAMES[k].split(" · ")[0] + " (" + r.date + "): " + (r.status === "holiday" ? "휴장" : "진입 " + (r.entries || 0) + " · 청산 " + (r.exits || 0) +
      " · 실현 " + P(r.realizedPct) + " " + money(r.realizedAmount, r.currency) + " · 미청산 " + (r.open || []).length));
  }
  L.push("③ 코인은 한국시각 00:00, ④ SOXL 은 미국장 마감 기준 마지막 마감 장부입니다.");
  L.push("모의투자 · 자세히: jkquant.pages.dev/claude");
  return L.join("\n");
}
