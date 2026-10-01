// Value tests for the D-1 live path (pure parts). Usage: node scripts/test_opening_gapdown.mjs [functions/api dir]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || "functions/api");
const G = await import(pathToFileURL(path.join(dir, "_gapdown.js")).href);
const F = await import(pathToFileURL(path.join(dir, "opening-gapdown.js")).href);
const LV = await import(pathToFileURL(path.join(dir, "claude-live.js")).href);
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
t("live ③: hold from yesterday's close vs 20 completed closes; stop caps the day", () => {
  const c = [{ trade_price: 1 }, { trade_price: 120, candle_date_time_kst: "2026-10-01T09:00:00" }, ...Array.from({ length: 19 }, () => ({ trade_price: 100 }))];
  const h = LV.coinHoldToday(c);
  assert.equal(h.hold, true); near(h.ma, (120 + 19 * 100) / 20); assert.equal(h.basedOn, "2026-10-01");
  assert.equal(LV.coinHoldToday(c.slice(0, 10)), null);
  const up = LV.coinRow("KRW-BTC", { hold: 1 }, { opening_price: 100, low_price: 99, trade_price: 102 });
  near(up.pnlPct, 2); assert.equal(up.status, "보유중");
  const st = LV.coinRow("KRW-BTC", { hold: 1 }, { opening_price: 100, low_price: 95.9, trade_price: 101 });
  near(st.pnlPct, -4 - 0.1 - 0.14); assert.equal(st.status, "손절");
  assert.equal(LV.coinRow("KRW-ETH", { hold: 0 }, { opening_price: 100, low_price: 90, trade_price: 95 }).pnlPct, 0);
});
console.log(`opening gap-down JS: ${n} ALL PASS`);
