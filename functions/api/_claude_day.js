// 단타(클로드) 전략별 '하루 마감 장부' — 웹 오늘 모의매매 이력과 Telegram 결과가 같은 원본을 쓴다.
// 원본: ①② = Worker gapdown ledger(KIS 모의투자 주문·체결), ③ = 업비트 60분봉(끝난 봉만), ④ = 밤 판단(nextSignal) + 마감 시세.
// 모든 함수는 마감 시점까지 들어온 자료만 받는다(미래 자료 없음). 순손익 = 비용(수수료·세금·미끄러짐) 뺀 값.
import { coinHoldToday, coinBreakoutDay } from "./claude-live.js";

export const COST = { kr: 0.23, etf: 0.13, coin: 0.14, us: 0.20 };          // 왕복 %, 연구·실시간과 같은 값
export const PAPER_CAPITAL = { coin: 10000000, soxl: 10000 };                // 주문 없는 칸의 모의 자금(원 · 달러)
export const NAMES = {
  opening: "① 시초가 · D-1 갭하락 과매도", daytrading: "② 데이트레이딩 · 코스닥150 레버리지 하락일 야간",
  crypto: "③ 비트코인 · BTC·ETH 어제 고가 돌파 하루 단타", soxl: "④ SOXL · 단기 과매도 반등(최대 5일)", overview: "📅 전일·당일 요약"
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
function stagesOf(ledger) {
  const m = {};
  for (const e of (ledger && Array.isArray(ledger.events) ? ledger.events : [])) if (e && e.stage) m[e.stage] = e.payload || {};
  return m;
}

// ① 08:59 동시호가 매수 → 15:30 종가 동시호가 매도. 15:40 체결조회(reconcile)까지 끝난 장부만 받는다.
export function openingDay(date, ledger, krOpen, marks = {}) {
  const r = { strategy: "opening", name: NAMES.opening, date, currency: "KRW", trades: [], open: [], measure: [] };
  if (!krOpen) return Object.assign(r, { status: "holiday", note: "국내 휴장" });
  const st = stagesOf(ledger), pre = st.preopen, rec = st.reconcile || {};
  if (!pre) return Object.assign(finish(r), { status: "closed", watched: 0, candidates: 0, entries: 0, note: "08:56 판단 기록 없음 — 점검" });
  const b = pre.breadth || {}, v2 = !!b.v2Signal;
  const pos = Object.fromEntries((rec.positions || []).map(p => [p.code, p]));
  const rows = [];
  for (const o of (pre.orders || []).filter(o => o.side === "buy" && o.vts && o.vts.ok)) {
    const p = pos[o.code] || {}, buy = p.buy || {}, sell = p.sell || {};
    if (!(buy.qty > 0)) continue;                                          // 체결 안 된 주문은 매매가 아니다
    const base = { name: o.name || o.code, code: o.code, entryTime: "09:00 시가(동시호가)", entryPrice: buy.avgPrice, qty: buy.qty, notional: buy.qty * buy.avgPrice };
    if (sell.qty > 0) {
      const net = pct(sell.avgPrice, buy.avgPrice) - COST.kr;
      rows.push(Object.assign(base, { exitTime: "15:30 종가(동시호가)", exitPrice: sell.avgPrice, pnlPct: net, pnlAmount: (base.notional * net) / 100, reason: "종가 청산" }));
    } else {
      const m = marks[o.code] || null;
      rows.push(Object.assign(base, { open: true, markPrice: m, pnlPct: m ? pct(m, buy.avgPrice) - COST.kr : null, reason: "매도 미체결" }));
    }
  }
  const accepted = (pre.orders || []).filter(o => o.side === "buy" && o.vts && o.vts.ok).length;
  if (accepted && !(rec.positions || []).length) r.warn = "매수 접수 " + accepted + "건인데 15:40 체결조회 기록 없음 — 점검";
  const done = rows.filter(x => !x.open), open = rows.filter(x => x.open);
  if (v2) { r.trades = done; r.open = open; }
  else r.measure = rows;                                                    // v2 매매일이 아니면 측정용 — 전략 손익에 넣지 않는다
  return Object.assign(finish(r), {
    status: "closed", watched: (pre.watchlist || {}).size || 0, candidates: b.qualified || 0, entries: v2 ? rows.length : 0,
    note: v2 ? "v2 매매일(통과 " + b.qualified + "종목)" : rows.length ? "v2 매매일 아님(통과 " + (b.qualified || 0) + "<5) — 측정용 모의매매는 전략 손익에 안 셈"
      : "매매 없음 — " + (pre.decisionReason || "조건 맞는 종목 없음")
  });
}

// ② 전날 15:20 종가 매수분을 오늘 09:00 시가 매도(실현) + 오늘 15:20 종가 매수(미청산, 내일 아침 매도)
export function etfDay(date, ledger, prevLedger, prevDate, krOpen) {
  const r = { strategy: "daytrading", name: NAMES.daytrading, date, currency: "KRW", trades: [], open: [], watched: 1 };
  if (!krOpen) return Object.assign(r, { status: "holiday", note: "국내 휴장" });
  const st = stagesOf(ledger), pst = stagesOf(prevLedger);
  const sold = ((st.etf_reconcile || {}).fills || {}).openSell || {}, bought = ((pst.etf_reconcile || {}).fills || {}).closeBuy || {};
  if (sold.qty > 0 && bought.qty > 0) {
    const net = pct(sold.avgPrice, bought.avgPrice) - COST.etf, notional = sold.qty * bought.avgPrice;
    r.trades.push({ name: "KODEX 코스닥150레버리지", code: "233740", entryTime: prevDate + " 15:30 종가", entryPrice: bought.avgPrice, exitTime: "09:00 시가",
      exitPrice: sold.avgPrice, qty: sold.qty, notional, pnlPct: net, pnlAmount: (notional * net) / 100, reason: "다음 날 시가 청산" });
  }
  const buy = st.etf_buy || null, nb = ((st.etf_reconcile || {}).fills || {}).closeBuy || {};
  if (nb.qty > 0) r.open.push({ name: "KODEX 코스닥150레버리지", code: "233740", entryTime: "15:30 종가", entryPrice: nb.avgPrice, qty: nb.qty, pnlPct: 0, reason: "내일 09:00 시가 매도" });
  return Object.assign(finish(r), {
    status: "closed", candidates: buy && buy.signal ? 1 : 0, entries: nb.qty > 0 ? 1 : 0,
    note: buy ? (buy.signal ? "15:21 예상 하락 " + (+buy.dropPct).toFixed(2) + "% → 종가 매수" : "15:21 예상 하락 " + (buy.dropPct == null ? "—" : (+buy.dropPct).toFixed(2) + "%") + " (기준 −3% 이하 아님) → 매수 없음")
      : "15:21 판단 기록 없음 — 점검"
  });
}

// ③ 한국시각 00:00 마감 하루(d 00:00 ~ d+1 00:00) — 그 안에서 청산된 매매는 실현, 00:00 에 들고 있는 매매는 미청산.
// 매매 규칙은 업비트 하루(09:00~다음 09:00) 기준 그대로: 업비트 하루 d-1 의 매수분은 d 09:00 에, d 의 매수분은 d+1 09:00 에 판다.
// coins: [{market, daily(최신순, 0=진행 중 업비트 하루), hourly(최신순 60분봉)}] — 00:00 전에 끝난 봉만 쓴다.
export function coinDay(date, coins, closeMs) {
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
      const h = coinHoldToday(daily.slice(idx), 20);                         // 그 업비트 하루의 판단(전날까지 확정 종가)
      if (!h) continue;
      if (h.hold && ud === date) r.candidates++;
      const s0 = Date.parse(ud + "T09:00:00+09:00");
      const bars = hourly.filter(b => t(b) >= s0 && t(b) < s0 + 864e5).sort((a, b) => t(a) - t(b));
      const res = coinBreakoutDay(h, bars, bars.length ? +bars[bars.length - 1].trade_price : null);
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
          reason: stopBar ? "손절 −5%" : "다음 날 09:00 청산" }));
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
    r.open.push({ name: "SOXL", entryTime: nyDate + " 09:30 시가", entryPrice: open, markPrice: close, pnlPct: pct(close, open) - COST.us / 2, reason: "오른 날 다음 시가 매도(최대 5일)" });
  } else if (nx.action === "sell" && entry && entry.entryPrice > 0) {
    const net = pct(open, +entry.entryPrice) - COST.us;
    r.trades.push({ name: "SOXL", entryTime: entry.date + " 시가", entryPrice: +entry.entryPrice, exitTime: nyDate + " 09:30 시가", exitPrice: open, notional: cap,
      pnlPct: net, pnlAmount: (cap * net) / 100, reason: nx.heldDays >= 5 ? "최대 5일 청산" : "반등 청산(오른 날 다음 시가)" });
  } else if (nx.holding && entry && entry.entryPrice > 0) {
    r.open.push({ name: "SOXL", entryTime: entry.date + " 시가", entryPrice: +entry.entryPrice, markPrice: close, pnlPct: pct(close, +entry.entryPrice) - COST.us / 2,
      reason: (nx.heldDays + 1) + "일째 보유 (최대 5일)" });
  }
  r.realizedBase = cap;
  return Object.assign(finish(r), { status: "closed",
    note: nx.action === "buy" ? "전날 확정 종가 RSI(2) " + (+nx.rsi2).toFixed(0) + " < 20 · 200일 평균 위 → 시가 매수" : nx.action === "sell" ? "시가 매도" : nx.holding ? "보유 유지" : "과매도 신호 없음 — 쉼",
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
