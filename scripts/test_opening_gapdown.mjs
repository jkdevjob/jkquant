// Value tests for the D-1 live path (pure parts). Usage: node scripts/test_opening_gapdown.mjs [functions/api dir]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || "functions/api");
const G = await import(pathToFileURL(path.join(dir, "_gapdown.js")).href);
const F = await import(pathToFileURL(path.join(dir, "opening-gapdown.js")).href);
const LV = await import(pathToFileURL(path.join(dir, "claude-live.js")).href);
const TG = await import(pathToFileURL(path.join(dir, "claude-telegram.js")).href);
let n = 0;
const t = (name, fn) => { fn(); n++; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const rule = { gapMax: -2, gapFloor: -29, picks: 3 };
t("expected gap uses KIS base price, falls back to watchlist close", () => {
  near(G.expectedGapPct({ expectedPrice: 9500, basePrice: 10000 }, 12345), -5);
  near(G.expectedGapPct({ expectedPrice: 9500 }, 10000), -5);
  assert.equal(G.expectedGapPct({ expectedPrice: 0, basePrice: 10000 }, 10000), null);
});
t("picks = 3 deepest gaps in (-29, -2], ties by code", () => {
  const rows = [
    { code: "000010", expectedGapPct: -1.99 }, { code: "000020", expectedGapPct: -2 },
    { code: "000030", expectedGapPct: -29 }, { code: "000040", expectedGapPct: -28.9 },
    { code: "000050", expectedGapPct: -5 }, { code: "000060", expectedGapPct: -5 },
    { code: "000070", expectedGapPct: null },
  ];
  assert.deepEqual(G.gapdownPicks(rows, rule).map(x => x.code), ["000040", "000050", "000060"]);
  assert.deepEqual(G.gapdownPicks(rows, { ...rule, picks: 0 }), []);
});
t("v2 breadth = every name inside the gap band (not capped at 3)", () => {
  const rows = [-1, -2, -3, -4, -5, -6, -30].map((g, i) => ({ code: "00001" + i, expectedGapPct: g }));
  assert.equal(G.gapdownPicks(rows, { ...rule, picks: 1e9 }).length, 5);
});
t("watchlist must be based on the previous weekday", () => {
  const wl = { strategyVersion: "opening_gapdown_v1", basedOn: "2026-10-02", rule, names: [] };
  assert.equal(G.watchlistUsable(wl, "2026-10-05").ok, true);            // 금 → 월
  assert.equal(G.watchlistUsable({ ...wl, basedOn: "2026-10-01" }, "2026-10-05").reason, "watchlist_stale");
  assert.equal(G.watchlistUsable({ ...wl, basedOn: "2026-10-05" }, "2026-10-05").reason, "watchlist_not_before_today");
  assert.equal(G.watchlistUsable({ ...wl, strategyVersion: "x" }, "2026-10-05").reason, "watchlist_invalid");
  assert.equal(G.watchlistUsable({ ...wl, rule: {} }, "2026-10-05").reason, "watchlist_rule_missing");
});
t("stage windows: buy only before 08:59:40, sell only in the closing auction", () => {
  assert.equal(F.stageWindow("quote", 85600), true);
  assert.equal(F.stageWindow("quote", 85915), false);
  assert.equal(F.stageWindow("preopen", 85939), true);
  assert.equal(F.stageWindow("preopen", 85940), false);
  assert.equal(F.stageWindow("preopen", 90000), false);
  assert.equal(F.stageWindow("close", 151959), false);
  assert.equal(F.stageWindow("close", 152100), true);
  assert.equal(F.stageWindow("close", 152800), false);
  assert.equal(F.stageWindow("reconcile", 153400), false);
  assert.equal(F.stageWindow("order", 100000), false);
});
t("strategy fills: pre-open buys and >=15:15 sells only", () => {
  const rows = [
    { sideCode: "02", orderTime: "085702", fillQty: 10, fillPrice: 1000, fillAmount: 10000, orderNo: "a" },
    { sideCode: "02", orderTime: "090512", fillQty: 7, fillPrice: 990, fillAmount: 6930, orderNo: "b" },   // 재돌파 전략 물량
    { sideCode: "01", orderTime: "091500", fillQty: 7, fillPrice: 995, fillAmount: 6965, orderNo: "c" },
    { sideCode: "01", orderTime: "152101", fillQty: 4, fillPrice: 1010, fillAmount: 4040, orderNo: "d" },
    { sideCode: "02", orderTime: "085800", fillQty: 0, fillPrice: 0, fillAmount: 0, orderNo: "e" },
  ];
  const f = F.strategyFills(rows);
  assert.equal(f.buy.qty, 10); assert.equal(f.buy.avgPrice, 1000);
  assert.equal(f.sell.qty, 4); assert.equal(f.sell.avgPrice, 1010);
});
t("candidates from the worker are limited to the watchlist and re-priced", () => {
  const wl = { names: [{ code: "000010", name: "A", rsi14: 20, prevClose: 10000 }] };
  const out = F.sanitizeCandidates([
    { code: "000010", expectedPrice: 9000, basePrice: 10000, expectedGapPct: -50 },
    { code: "999990", expectedPrice: 1, basePrice: 100, expectedGapPct: -10 },
    { code: "000010", expectedPrice: 1, basePrice: 10000 },
  ], wl);
  assert.equal(out.length, 1);
  near(out[0].expectedGapPct, -10);
  assert.equal(out[0].rsi14Prev, 20);
});
t("signal ids are per date/code/side (dedupe key)", () => {
  assert.equal(F.signalId("2026-10-01", "000010", "buy"), "gapdown:2026-10-01:000010:buy");
});
t("② ETF: drop vs base price, windows, fills split, ids", () => {
  near(F.etfDropPct({ expectedPrice: 9700, basePrice: 10000 }), -3);
  assert.equal(F.etfDropPct({ expectedPrice: 0, basePrice: 10000 }), null);
  assert.equal(F.ETF_RULE.dropMaxPct, -3);
  assert.equal(F.etfDecision(-3).signal, true);
  assert.equal(F.etfDecision(-2.99).signal, false);
  assert.equal(F.etfDecision(-7).signal, true);
  assert.equal(F.etfDecision(null).decisionReason, "expected_price_missing");
  assert.equal(F.ETF_RULE.code, "233740");
  assert.equal(F.stageWindow("etf_buy", 152100), true);
  assert.equal(F.stageWindow("etf_buy", 151900), false);
  assert.equal(F.stageWindow("etf_buy", 152800), false);
  assert.equal(F.stageWindow("etf_sell", 85600), true);
  assert.equal(F.stageWindow("etf_sell", 85940), false);
  const f = F.etfFills([
    { sideCode: "02", orderTime: "152105", fillQty: 30, fillAmount: 300000 },
    { sideCode: "02", orderTime: "100000", fillQty: 5, fillAmount: 50000 },     // 다른 매수
    { sideCode: "01", orderTime: "085630", fillQty: 30, fillAmount: 306000 },
    { sideCode: "01", orderTime: "093000", fillQty: 3, fillAmount: 30000 },     // 다른 매도
  ]);
  assert.equal(f.closeBuy.qty, 30); assert.equal(f.closeBuy.avgPrice, 10000);
  assert.equal(f.openSell.qty, 30); assert.equal(f.openSell.avgPrice, 10200);
  assert.equal(F.etfSignalId("2026-10-01", "sell"), "etf_dip:2026-10-01:233740:sell");
});
t("live ①: fill beats expected price, realized after sell, failed order flagged", () => {
  const st = { preopen: { picks: [{ code: "000010", name: "A", expectedPrice: 1000, expectedGapPct: -5 }, { code: "000020", name: "B", expectedPrice: 500 }],
                          orders: [{ code: "000010", side: "buy", vts: { ok: true } }, { code: "000020", side: "buy", vts: { ok: false, msg: "거절" } }] },
               reconcile: { positions: [{ code: "000010", buy: { avgPrice: 1010 }, sell: { avgPrice: 1050 } }] } };
  const r = LV.openingRows(st, { "000010": 1040, "000020": 480 });
  assert.equal(r[0].buyPrice, 1010); assert.equal(r[0].buyPriceKind, "체결");
  near(r[0].pnlPct, (1050 / 1010 - 1) * 100 - 0.23); assert.equal(r[0].realized, true); assert.equal(r[0].status, "청산");
  assert.equal(r[1].status, "주문 실패"); assert.equal(r[1].buyPriceKind, "예상");
});
t("live ②: yesterday's close buy sold at today's open; today's no-signal shown", () => {
  const prev = { etf_buy: { signal: true, quote: { expectedPrice: 8000 } }, etf_reconcile: { fills: { closeBuy: { avgPrice: 8010 } } } };
  const today = { etf_sell: { order: { vts: { ok: true } } }, etf_reconcile: { fills: { openSell: { avgPrice: 8200 } } }, etf_buy: { signal: false, dropPct: -1.2 } };
  const r = LV.etfRows(today, prev, "2026-10-01", 8300);
  near(r[0].pnlPct, (8200 / 8010 - 1) * 100 - 0.13); assert.equal(r[0].status, "청산");
  assert.equal(r[1].status, "매매 없음");
});
t("live ③: breakout of yesterday's high in an uptrend; stop and no-break are explicit", () => {
  const c = [{ trade_price: 1 }, { trade_price: 120, high_price: 125, candle_date_time_kst: "2026-10-01T09:00:00" }, ...Array.from({ length: 19 }, () => ({ trade_price: 100 }))];
  const h = LV.coinHoldToday(c);
  assert.equal(h.hold, true); near(h.ma, (120 + 19 * 100) / 20); assert.equal(h.basedOn, "2026-10-01"); assert.equal(h.level, 125);
  assert.equal(LV.coinHoldToday(c.slice(0, 10)), null);
  const B = (hh, o, hi, lo, cl) => ({ candle_date_time_kst: "2026-10-02T" + hh + ":00:00", opening_price: o, high_price: hi, low_price: lo, trade_price: cl });
  const bars = [B("09", 121, 124, 120, 123), B("10", 123, 127, 122, 126), B("11", 126, 128, 125, 127)];
  const r = LV.coinBreakoutDay(h, bars, 130);
  const e = 125 * 1.0005;
  assert.equal(r.buyTime, "10:00"); near(r.buyPrice, e); near(r.pnlPct, (130 / e - 1) * 100 - 0.14); assert.equal(r.hold, true);
  const gap = LV.coinBreakoutDay(h, [B("09", 126, 127, 125.5, 126)], 126);      // 시가가 이미 기준 위 → 시가에 산다
  near(gap.buyPrice, 126 * 1.0005);
  const st = LV.coinBreakoutDay(h, [B("10", 123, 127, 122, 126), B("11", 126, 126, 118, 119)], 119);
  assert.equal(st.stopped, true); near(st.pnlPct, -5 - 0.1 - 0.14);
  const nb = LV.coinBreakoutDay(h, [B("09", 121, 124, 120, 123)], 123);
  assert.equal(nb.hold, false); assert.equal(nb.pnlPct, 0); assert.ok(nb.status.startsWith("돌파 대기"));
  const down = LV.coinBreakoutDay({ ...h, hold: false }, bars, 130);
  assert.equal(down.pnlPct, 0); assert.ok(down.status.includes("20일 평균 아래"));
  const all = [B("10", 1, 1, 1, 1), { ...B("09", 1, 1, 1, 1), candle_date_time_kst: "2026-10-01T23:00:00" }, B("12", 1, 1, 1, 1)];
  assert.deepEqual(LV.barsOfDay(all, "2026-10-02", Date.parse("2026-10-02T11:30:00+09:00")).map(b => b.candle_date_time_kst), ["2026-10-02T10:00:00"]);
});
t("telegram: each kind says what happened, no-trade is explicit", () => {
  const live = { tabs: { opening: { rows: [{ name: "휴젤", buyPrice: 171200, buyPriceKind: "체결", expectedGapPct: -4.2, sellPrice: 174000, pnlPct: 1.41, status: "청산" }],
                                    decision: { reason: "x", breadth: { qualified: 6, v2Signal: true } } },
                         daytrading: { rows: [{ status: "매매 없음", note: "15:21 예상 하락 -1.20%" }] },
                         crypto: { tabPct: 0.4 }, soxl: { rows: [{ pnlPct: null }] } } };
  const pre = TG.compose("preopen", "2026-10-02", live);
  assert.ok(pre.includes("모의 매수 1종목") && pre.includes("v2 매매일 예") && pre.includes("휴젤"));
  const cl = TG.compose("close", "2026-10-02", live);
  assert.ok(cl.includes("① 갭하락 과매도 +1.41% (1종목 평균") && cl.includes("② 오늘 종가 매수: 없음") && cl.includes("장 시작 전"));
  assert.ok(TG.compose("etfbuy", "2026-10-02", live).includes("② 매매 없음"));
  const none = TG.compose("preopen", "2026-10-02", { tabs: { opening: { rows: [], decision: { reason: "no_expected_gap_down" } } } });
  assert.ok(none.includes("매매 없음 (no_expected_gap_down)"));
  const mo = TG.compose("morning", "2026-10-02", null, { coins: [{ name: "BTC", y: { action: "돌파 매수", buyTime: "13:00", pnlPct: 1 }, today: true, level: 115937000 }, { name: "ETH", y: { action: "손절", pnlPct: -5.24 }, today: false }],
                                                         us: { date: "2026-10-01", action: "exit", pnlPct: 1.2, next: "buy", holding: false } });
  assert.ok(mo.includes("BTC 어제 돌파 매수 13:00 +1.00% · 오늘 어제 고가 115,937,000 돌파 시 매수") && mo.includes("ETH 어제 손절 -5.24% · 오늘 쉼") && mo.includes("코인 칸 어제 -2.12% (탭 자금 80% -1.70%)") && mo.includes("④ SOXL 지난 세션 2026-10-01 시가 매도 +1.20% · 오늘 밤 시가 매수 (과매도 신호)"));
});
t("coin yesterday result uses the day before for its decision", () => {
  // 어제(10/01) 판단은 그 전날(09/30) 종가 120 과 고가 125 로 한다 — 어제 종가(90)·고가를 쓰면 룩어헤드
  const c = [{ trade_price: 1 }, { trade_price: 90, high_price: 140, candle_date_time_kst: "2026-10-01T09:00:00" },
             { trade_price: 120, high_price: 125 }, ...Array.from({ length: 19 }, () => ({ trade_price: 100 }))];
  const H = (hh, d, o, hi, lo, cl) => ({ candle_date_time_kst: d + "T" + hh + ":00:00", opening_price: o, high_price: hi, low_price: lo, trade_price: cl });
  const hc = [H("09", "2026-10-02", 1, 1, 1, 1), H("10", "2026-10-01", 124, 126, 123, 125), H("09", "2026-10-01", 122, 124, 121, 124), H("08", "2026-10-01", 1, 999, 1, 1)];
  const y = LV.coinDayResult(c, hc);
  assert.equal(y.date, "2026-10-01"); assert.equal(y.hold, true); assert.equal(y.buyTime, "10:00");
  near(y.pnlPct, (125 / (125 * 1.0005) - 1) * 100 - 0.14);
});
t("telegram weekly: account week, +5% check, contributions, shadow candidates, stale guard", () => {
  assert.equal(TG.mondayOf("2026-10-10"), "2026-10-05"); assert.equal(TG.mondayOf("2026-10-05"), "2026-10-05"); assert.equal(TG.mondayOf("2026-10-11"), "2026-10-05");
  const lab = { week: { weekStart: "2026-10-05", asOf: "2026-10-09", account: { weekPct: 5.06, hit5: true, plus1Days: 2, days: 5 },
                        parts: { opening_d1v2: { contribPct: 0.3, weekPct: 2, tradeDays: 1 }, us_soxl: { contribPct: 1.2, weekPct: 3, tradeDays: 1, through: "2026-10-08" } } },
                shadows: { crypto: [{ name: "평균 50일", promotion: { code: "candidate", text: "교체 후보 — x" } }, { name: "손절 −3%", promotion: { code: "keep", text: "기준 유지" } }] } };
  const w = TG.compose("weekly", "2026-10-10", null, { lab, weekStart: "2026-10-05" });
  assert.ok(w.includes("🏦 전체 계좌 +5.06% · 목표 +5% 달성 ✅") && w.includes("④ SOXL +1.20% (+3.0%, 매매 1일 · ~2026-10-08)"));
  assert.ok(w.includes("③ 평균 50일 — 교체 후보") && !w.includes("손절 −3% —"));
  const stale = TG.compose("weekly", "2026-10-17", null, { lab, weekStart: "2026-10-12" });
  assert.ok(stale.includes("⚠️ 이번 주 장부 요약이 없습니다") && !stale.includes("달성 ✅"));
});
t("today summary: tab return vs per-trade sum, account share, no-trade reason", () => {
  const op = LV.todaySummary("opening", { rows: [{ pnlPct: 3, status: "청산", buyPrice: 1 }, { pnlPct: -1, status: "청산", buyPrice: 1 }, { pnlPct: 1, status: "청산", buyPrice: 1 }],
                                          decision: { breadth: { qualified: 6, v2Signal: true } } }, 1600);
  near(op.tabPct, 1); near(op.sumPct, 3); near(op.accountPct, 0.3); assert.equal(op.trades, 3); assert.ok(op.why.startsWith("v2 매매일(통과 6종목)"));
  assert.equal(op.wins, 2); assert.equal(op.losses, 1);
  const m = LV.todaySummary("opening", { rows: [{ pnlPct: 2, status: "보유중" }, { pnlPct: null, status: "주문 실패" }], decision: { breadth: { qualified: 2, v2Signal: false } } }, 1000);
  const mf = LV.todaySummary("opening", { rows: [{ pnlPct: 2, status: "보유중", buyPrice: 1 }, { pnlPct: null, status: "주문 실패" }], decision: { breadth: { qualified: 6, v2Signal: true } } }, 1000);
  near(mf.tabPct, 2); assert.equal(mf.trades, 1); assert.ok(mf.why.includes("주문 실패 1건"));
  assert.equal(m.tabPct, 0); assert.equal(m.trades, 0); assert.equal(m.accountPct, 0); near(m.measurePct, 2); assert.ok(m.why.includes("측정용 모의 매수") && m.why.includes("칸 수익률에는 안 셈"));
  const z = LV.todaySummary("opening", { rows: [], decision: { reason: "no_expected_gap_down" } }, 1000);
  assert.equal(z.tabPct, 0); assert.equal(z.sumPct, 0); assert.ok(z.noTrade); assert.ok(z.why.includes("예상 갭 −2%~−29% 인 종목 없음"));
  assert.equal(LV.todaySummary("opening", { rows: [] }, 850).why, "08:56 판단 전");
  const e = LV.todaySummary("daytrading", { rows: [{ buyPrice: 100, sellTime: "오늘 09:00 시가", status: "청산", pnlPct: 1.5 },
                                                  { status: "매매 없음", note: "15:21 예상 하락 -1.00% (기준 −3% 이하)" }] }, 1600);
  near(e.tabPct, 1.5); assert.equal(e.trades, 1); assert.ok(e.why.includes("시가 매도(청산)") && e.why.includes("오늘 매수 없음"));
  assert.equal(LV.todaySummary("daytrading", { rows: [] }, 1400).why, "15:21 판단 전");
  const c = LV.todaySummary("crypto", { rows: [{ name: "BTC", hold: true, status: "보유중", pnlPct: 2 }, { name: "ETH", hold: false, pnlPct: 0, status: "쉼 — 어제 종가가 20일 평균 아래" }], basketPct: 1 }, 1000);
  near(c.tabPct, 1); near(c.sumPct, 2); near(c.accountPct, 0.3); assert.equal(c.trades, 1); assert.ok(c.why.includes("ETH 쉼"));
  const u = LV.todaySummary("soxl", { rows: [{ hold: false, pnlPct: null, status: "쉼 — 200일 평균 아래" }] }, 1000);
  assert.equal(u.trades, 0); assert.equal(u.tabPct, 0); assert.ok(u.why.includes("쉼"));
  near(LV.todaySummary("soxl", { rows: [{ hold: true, pnlPct: 2, session: "정규장", status: "보유중" }] }, 2300).accountPct, 0.8);
  const T2 = { opening: { today: { tabPct: 2, noTrade: false, weight: 0.3, accountPct: 0.6 } }, daytrading: { today: { tabPct: 1, noTrade: false, weight: 0.3, accountPct: 0.3 } } };
  LV.applyKrSplit(T2); near(T2.opening.today.accountPct, 0.3); near(T2.daytrading.today.accountPct, 0.15);
  const T3 = { opening: { today: { tabPct: 2, noTrade: false, weight: 0.3, accountPct: 0.6 } }, daytrading: { today: { tabPct: 0, noTrade: true, weight: 0.3, accountPct: 0 } } };
  LV.applyKrSplit(T3); near(T3.opening.today.accountPct, 0.6);
});
t("soxl live: planned open buy/sell executes only in the session after the decision", () => {
  const q = (date, open, c, prev) => ({ price: c, ohlc: [{ date: "2026-10-01", open: prev, close: prev }, { date, open, close: c }], intraday: { regular: { c }, date } });
  const nxB = { basedOn: "2026-10-01", action: "buy", holding: false, heldDays: 0, close: 100, ma: 90, rsi2: 8 };
  const pre = LV.soxlLive(nxB, q("2026-10-01", 100, 100, 100), null);
  assert.equal(pre.status, "다음 미국장 시가 매수 예정"); assert.equal(pre.pnlPct, null);
  const on = LV.soxlLive(nxB, q("2026-10-02", 98, 101, 100), null);
  assert.equal(on.buyPrice, 98); near(on.pnlPct, (101 / 98 - 1) * 100 - 0.1); assert.ok(on.status.startsWith("보유중"));
  const nxS = { basedOn: "2026-10-01", action: "sell", holding: true, heldDays: 2, close: 100, ma: 90, rsi2: 70 };
  const sold = LV.soxlLive(nxS, q("2026-10-02", 103, 99, 100), null);
  near(sold.pnlPct, 3 - 0.1); assert.equal(sold.realized, true); assert.equal(sold.sellPrice, 103);
  const flat = LV.soxlLive({ basedOn: "2026-10-01", action: "none", holding: false, heldDays: 0, close: 100, ma: 90, rsi2: 55 }, q("2026-10-02", 98, 101, 100), null);
  assert.equal(flat.pnlPct, 0); assert.ok(flat.status.includes("과매도 아님"));
  assert.equal(LV.soxlLive({ basedOn: "2026-10-01", holdNext: true, signalClose: 100, ma: 90 }, q("2026-10-02", 98, 101, 100), null).status, "판단 없음(밤 계산 점검)");
  const sm = LV.todaySummary("soxl", { rows: [sold] }, 600); assert.equal(sm.trades, 1); near(sm.accountPct, (3 - 0.1) * 0.4);
  assert.equal(LV.todaySummary("soxl", { rows: [flat] }, 600).trades, 0);
});
t("telegram us_close + morning ② sell result", () => {
  const u = TG.compose("us_close", "2026-10-03", null, { soxl: { last: { date: "2026-10-02", action: "exit", pnlPct: 2.1, entryPrice: 140, exitPrice: 146, heldDays: 2 },
                                                              next: { action: "none", holding: false, rsi2: 70, ma: 120, close: 150 } } });
  assert.ok(u.includes("2026-10-02 미국장 마감 — ④ SOXL") && u.includes("오늘: 시가 146.00 매도 · 매수가 140.00 · 2일 보유") && u.includes("다음 세션: 쉼 (RSI(2) 70 · 200일 평균 위)"));
  const b = TG.compose("us_close", "2026-10-03", null, { soxl: { last: { date: "2026-10-02", action: "flat" }, next: { action: "buy", rsi2: 8, ma: 120, close: 130 } } });
  assert.ok(b.includes("오늘: 매매 없음") && b.includes("다음 세션: 시가 매수 (RSI(2) 8 · 200일 평균 위)"));
  const live = { tabs: { daytrading: { rows: [{ sellTime: "오늘 09:00 시가", status: "매도 접수", pnlPct: 1.2 }] } } };
  assert.ok(TG.compose("morning", "2026-10-02", live, { coins: [] }).includes("② ETF 야간 오늘 09:00 시가 매도 +1.20% · 매도 접수"));
  assert.ok(TG.compose("morning", "2026-10-02", { tabs: {} }, { coins: [] }).includes("② ETF 야간 오늘 아침 매도할 보유분 없음"));
});
console.log(`opening gap-down JS: ${n} ALL PASS`);
