// Value tests for the D-1 live path (pure parts). Usage: node scripts/test_opening_gapdown.mjs [functions/api dir]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || "functions/api");
const G = await import(pathToFileURL(path.join(dir, "_gapdown.js")).href);
const F = await import(pathToFileURL(path.join(dir, "opening-gapdown.js")).href);
const LV = await import(pathToFileURL(path.join(dir, "claude-live.js")).href);
const TG = await import(pathToFileURL(path.join(dir, "claude-telegram.js")).href);
const DAY = await import(pathToFileURL(path.join(dir, "_claude_day.js")).href);
const AUTH = await import(pathToFileURL(path.join(dir, "_claude_auth.js")).href);
const LAB = await import(pathToFileURL(path.join(dir, "claude-lab.js")).href);
const KRX = await import(pathToFileURL(path.join(dir, "_krx_calendar.js")).href);
let n = 0;
const pending = [];
const t = (name, fn) => { const r = fn(); if (r && r.then) pending.push(r.then(() => { n++; })); else n++; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

t("KRX calendar: 10/5 개천절 대체휴일 · 10/9 한글날 · 주말은 휴장, 10/6 은 개장, 목록 없는 해는 known=false", () => {
  assert.deepEqual(KRX.krxDay("2026-10-05"), { closed: true, reason: "krx_holiday", known: true });
  assert.equal(KRX.krxDay("2026-10-09").closed, true); assert.equal(KRX.krxDay("2026-12-31").closed, true);
  assert.equal(KRX.krxDay("2026-10-03").reason, "weekend");
  assert.deepEqual(KRX.krxDay("2026-10-06"), { closed: false, reason: "", known: true });
  assert.equal(KRX.krxDay("2030-03-04").known, false);
});
t("holiday: live/telegram say 휴장 instead of '주문 실패'", () => {
  const sm = LV.todaySummary("opening", { rows: [], decision: { reason: "krx_holiday" } }, 900);
  assert.ok(sm.noTrade && sm.why.includes("휴장"));
  const rows = LV.etfRows({ etf_buy: { signal: false, decisionReason: "krx_holiday", dropPct: null } }, {}, null, null);
  assert.equal(rows[0].note, "국내 휴장일");
  const pre = TG.compose("preopen", "2026-10-05", { tabs: { opening: { rows: [], decision: { reason: "krx_holiday" } }, daytrading: { rows: [] } } });
  assert.ok(pre.includes("국내 휴장일") && !pre.includes("주문 실패"));
});
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
  assert.ok(TG.compose("etfbuy", "2026-10-02", live).includes("② 매매 없음"));
  const none = TG.compose("preopen", "2026-10-02", { tabs: { opening: { rows: [], decision: { reason: "no_expected_gap_down" } } } });
  assert.ok(none.includes("매매 없음 (no_expected_gap_down)"));
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
t("day close ①: VTS fills → realized KRW net of cost; non-v2 day is measurement only; holiday", () => {
  const L = (picksOk, v2, sellQty) => ({ events: [
    { stage: "preopen", payload: { watchlist: { size: 8 }, breadth: { qualified: v2 ? 6 : 2, v2Signal: v2 }, decisionReason: "",
      orders: [{ side: "buy", code: "A", name: "가", vts: { ok: picksOk } }, { side: "buy", code: "B", name: "나", vts: { ok: true } }] } },
    { stage: "reconcile", payload: { positions: [{ code: "A", buy: { qty: 10, avgPrice: 1000 }, sell: { qty: sellQty, avgPrice: 1020 } },
                                                  { code: "B", buy: { qty: 5, avgPrice: 2000 }, sell: { qty: 5, avgPrice: 1980 } }] } }] });
  const r = DAY.openingDay("2026-10-05", L(true, true, 10), true);
  assert.equal(r.status, "closed"); assert.equal(r.watched, 8); assert.equal(r.candidates, 6); assert.equal(r.entries, 2); assert.equal(r.exits, 2);
  assert.equal(r.wins, 1); assert.equal(r.losses, 1); near(r.winRate, 50);
  near(r.trades[0].pnlPct, 2 - 0.23); near(r.trades[0].pnlAmount, 10000 * (2 - 0.23) / 100);
  near(r.realizedAmount, 10000 * 1.77 / 100 + 10000 * (-1 - 0.23) / 100); near(r.realizedPct, r.realizedAmount / 20000 * 100);
  const o = DAY.openingDay("2026-10-05", L(true, true, 0), true, { A: 1010 });
  assert.equal(o.open.length, 1); assert.equal(o.exits, 1); near(o.open[0].pnlPct, 1 - 0.23);
  const m = DAY.openingDay("2026-10-05", L(true, false, 10), true);
  assert.equal(m.entries, 0); assert.equal(m.trades.length, 0); assert.equal(m.measure.length, 2); assert.equal(m.realizedAmount, 0);
  assert.equal(DAY.openingDay("2026-10-05", null, false).status, "holiday");
  const txt = DAY.composeDay(r);
  assert.ok(txt.startsWith("[① 시초가 · D-1 갭하락 과매도 · 2026-10-05 종료]") && txt.includes("감시 8 / 후보 6 / 진입 2 / 청산 2") && txt.includes("승 1 / 패 1 / 승률 50.0%")
    && txt.includes("1. 가 09:00 시가(동시호가) 1,000 → 15:30 종가(동시호가) 1,020 +1.77% +177원 종가 청산") && txt.includes("미청산: 0"));
  const none = DAY.composeDay(DAY.openingDay("2026-10-05", { events: [{ stage: "preopen", payload: { watchlist: { size: 8 }, orders: [], decisionReason: "no_expected_gap_down" } }] }, true));
  assert.ok(none.includes("진입 0 / 청산 0") && none.includes("거래 없음") && none.includes("매매 없음 — no_expected_gap_down"));
  assert.ok(DAY.composeDay(DAY.openingDay("2026-10-05", null, false)).includes("휴장"));
});
t("day close ②: morning sell realized, evening buy is open position", () => {
  const prev = { events: [{ stage: "etf_reconcile", payload: { fills: { closeBuy: { qty: 100, avgPrice: 8000 } } } }] };
  const today = { events: [{ stage: "etf_reconcile", payload: { fills: { openSell: { qty: 100, avgPrice: 8200 }, closeBuy: { qty: 90, avgPrice: 7700 } } } },
                           { stage: "etf_buy", payload: { signal: true, dropPct: -3.4 } }] };
  const r = DAY.etfDay("2026-10-05", today, prev, "2026-10-02", true);
  assert.equal(r.exits, 1); near(r.trades[0].pnlPct, 2.5 - 0.13); near(r.realizedAmount, 800000 * (2.5 - 0.13) / 100);
  assert.equal(r.open.length, 1); assert.equal(r.entries, 1); assert.equal(r.candidates, 1);
});
t("day close ③: KST 00:00 day — realized = closed in the day, open = held at midnight, no bar after midnight used", () => {
  const D = (d, close, high) => ({ candle_date_time_kst: d + "T09:00:00", trade_price: close, high_price: high });
  // 업비트 하루: 10/05(오늘, 진행 중) · 10/04 · 10/03 … 20일 오르는 흐름
  const daily = [D("2026-10-05", 1, 1), D("2026-10-04", 120, 121), D("2026-10-03", 118, 119), ...Array.from({ length: 22 }, (_, i) => D("2026-09-" + String(30 - i).padStart(2, "0"), 100, 101))];
  const H = (kst, o, h, l, c) => ({ candle_date_time_kst: kst, opening_price: o, high_price: h, low_price: l, trade_price: c });
  const hourly = [];
  // 업비트 하루 10/04: 13시에 기준(10/03 고가 119) 돌파 → 10/05 09:00 청산(오늘 실현). 10/05 00:00~08:59 봉 포함.
  for (let k = 0; k < 24; k++) { const t0 = Date.parse("2026-10-04T09:00:00+09:00") + k * 36e5; const s = new Date(t0 + 9 * 36e5).toISOString().slice(0, 19);
    hourly.push(k === 4 ? H(s, 118, 120, 117.5, 119.5) : H(s, 119, 119, 118.9, 121)); }
  // 업비트 하루 10/05: 10시에 기준(10/04 고가 121) 돌파 → 자정에 보유(미청산). 자정 뒤 봉(급락)은 쓰면 안 된다.
  for (let k = 0; k < 24; k++) { const t0 = Date.parse("2026-10-05T09:00:00+09:00") + k * 36e5; const s = new Date(t0 + 9 * 36e5).toISOString().slice(0, 19);
    hourly.push(k === 0 ? H(s, 120.5, 120.9, 120.4, 120.8) : k === 1 ? H(s, 120, 122, 119.9, 121.5) : k >= 15 ? H(s, 100, 100, 50, 60) : H(s, 121.5, 121.6, 121.4, 123)); }
  const day = DAY.coinDay("2026-10-05", [{ market: "KRW-BTC", daily, hourly: hourly.reverse() }], Date.parse("2026-10-06T00:00:00+09:00"));
  assert.equal(day.exits, 1); assert.equal(day.trades[0].exitTime, "10-05 09:00"); assert.equal(day.trades[0].entryTime, "10-04 13:00");
  near(day.trades[0].pnlPct, (121 / (119 * 1.0005) - 1) * 100 - 0.14);
  assert.equal(day.open.length, 1); assert.equal(day.open[0].entryTime, "10-05 10:00"); near(day.open[0].markPrice, 123);   // 23시 봉 종가 — 자정 뒤 급락 안 씀
  assert.equal(day.entries, 1); near(day.realizedAmount, 10000000 * day.trades[0].pnlPct / 100);
  // ETH: 10/04 13시 매수 → 10/04 20시 손절(전날 한국 날짜) → 10/05 결과에는 없다
  const eh = [];
  for (let k = 0; k < 24; k++) { const t0 = Date.parse("2026-10-04T09:00:00+09:00") + k * 36e5; const s = new Date(t0 + 9 * 36e5).toISOString().slice(0, 19);
    eh.push(k === 4 ? H(s, 118, 120, 117.5, 119.5) : k === 11 ? H(s, 119, 119, 100, 101) : H(s, 119, 119, 118.9, 110)); }
  const d2 = DAY.coinDay("2026-10-05", [{ market: "KRW-ETH", daily, hourly: eh.reverse() }], Date.parse("2026-10-06T00:00:00+09:00"));
  assert.equal(d2.exits, 0); assert.equal(d2.open.length, 0);
  const d1 = DAY.coinDay("2026-10-04", [{ market: "KRW-ETH", daily: daily.slice(1), hourly: eh }], Date.parse("2026-10-05T00:00:00+09:00"));
  assert.equal(d1.exits, 1); assert.equal(d1.trades[0].reason, "손절 −5%"); assert.equal(d1.trades[0].exitTime, "10-04 20:00");
});
t("day close ④: SOXL session after the decision; holiday when no session; sell realized in USD", () => {
  const q = (d, o, c) => ({ ohlc: [{ date: "2026-10-02", open: 100, close: 100 }, { date: d, open: o, close: c }] });
  const sell = DAY.soxlDay("2026-10-05", { basedOn: "2026-10-02", action: "sell", heldDays: 2, holding: true }, q("2026-10-05", 106, 104), { date: "2026-10-01", entryPrice: "100" });
  near(sell.trades[0].pnlPct, 6 - 0.2); near(sell.realizedAmount, 10000 * 5.8 / 100); assert.equal(sell.exits, 1);
  assert.ok(DAY.composeDay(sell).includes("+$580.00"));
  const buy = DAY.soxlDay("2026-10-05", { basedOn: "2026-10-02", action: "buy", rsi2: 9, holding: false }, q("2026-10-05", 90, 92), null);
  assert.equal(buy.open.length, 1); assert.equal(buy.entries, 1); assert.equal(buy.exits, 0);
  assert.equal(DAY.soxlDay("2026-10-05", { basedOn: "2026-10-02", action: "none" }, q("2026-10-02", 1, 1), null).status, "holiday");
  assert.ok(DAY.soxlDay("2026-10-05", { basedOn: "2026-10-05", action: "none" }, q("2026-10-05", 1, 1), null).note.includes("밤 판단 없음"));
});
t("duel telegram: daily summary + empty start", () => {
  const d = { start: "2026-10-05", record: { claude: 3, gpt: 1, draw: 1 }, cumClaude: 2.4, cumGpt: -0.6,
              last: { date: "2026-10-09", claudePct: 0.4, gptPct: -0.2, winner: "claude" },
              tabs: { crypto: { cumClaude: 3, cumGpt: -1, last: { date: "2026-10-09", claude: 0.9, gpt: -0.3, winner: "claude" } }, soxl: { cumClaude: 0, cumGpt: 0, last: null } } };
  const t = TG.compose("duel", "2026-10-09", null, { duel: d });
  assert.ok(t.includes("합계(4탭 균등) 2026-10-09: 🤖 +0.40% vs GPT -0.20% → 🤖 승") && t.includes("누적 🤖 +2.40% vs GPT -0.60% · 3승 1패 1무")
    && t.includes("③ 비트코인: 10-09 🤖 +0.90% vs -0.30% 🤖 승") && t.includes("④ SOXL: 기록 없음"));
  assert.ok(TG.compose("duel", "2026-10-02", null, { duel: { start: "2026-10-05" } }).includes("아직 같은 날 기록 없음 — 2026-10-05 부터"));
});
t("claude auth: owner token or server key only; APIs answer 401 without it", async () => {
  const env = { OWNER_EMAIL: "me@x.com", OPENING_MONITOR_KEY: "k1" };
  const req = h => new Request("https://jkquant.pages.dev/api/claude-live", { headers: h });
  const look = async t => (t === "good" ? "Me@x.com" : "other@y.com");
  assert.equal(await AUTH.claudeAuthorized(req({ Authorization: "Bearer good" }), env, look), true);
  assert.equal(await AUTH.claudeAuthorized(req({ Authorization: "Bearer bad" }), env, look), false);
  assert.equal(await AUTH.claudeAuthorized(req({}), env, look), false);
  assert.equal(await AUTH.claudeAuthorized(req({ "x-monitor-key": "k1" }), env, look), true);
  assert.equal(await AUTH.claudeAuthorized(req({ "x-monitor-key": "nope" }), env, look), false);
  assert.deepEqual(AUTH.ownersOf({}), ["jk82investing@gmail.com"]);
  assert.equal(await AUTH.claudeAuthorized(req({}), { OWNER_EMAIL: "me@x.com" }, look), false);       // 서버키 미설정이어도 빈 값으로 통과 안 됨
  assert.equal((await LV.onRequestGet({ request: req({}), env })).status, 401);
  assert.equal((await LAB.onRequestGet({ request: req({}), env })).status, 401);
});
await Promise.all(pending);
console.log(`opening gap-down JS: ${n} ALL PASS`);
