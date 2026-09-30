// Value tests for the D-1 live path (pure parts). Usage: node scripts/test_opening_gapdown.mjs [functions/api dir]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || "functions/api");
const G = await import(pathToFileURL(path.join(dir, "_gapdown.js")).href);
const F = await import(pathToFileURL(path.join(dir, "opening-gapdown.js")).href);
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
console.log(`opening gap-down JS: ${n} ALL PASS`);
