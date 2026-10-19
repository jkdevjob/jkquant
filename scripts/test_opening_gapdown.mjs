// Value tests for the D-1 live path (pure parts). Usage: node scripts/test_opening_gapdown.mjs [functions/api dir]
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import vm from "node:vm";

const dir = path.resolve(process.argv[2] || "functions/api");
const G = await import(pathToFileURL(path.join(dir, "_gapdown.js")).href);
const F = await import(pathToFileURL(path.join(dir, "opening-gapdown.js")).href);
const LV = await import(pathToFileURL(path.join(dir, "claude-live.js")).href);
const TG = await import(pathToFileURL(path.join(dir, "claude-telegram.js")).href);
const DAY = await import(pathToFileURL(path.join(dir, "_claude_day.js")).href);
const AUTH = await import(pathToFileURL(path.join(dir, "_claude_auth.js")).href);
const LAB = await import(pathToFileURL(path.join(dir, "claude-lab.js")).href);
const KRX = await import(pathToFileURL(path.join(dir, "_krx_calendar.js")).href);
const MAIN = await import(pathToFileURL(path.join(dir, "_claude_main.js")).href);
const FT = await import(pathToFileURL(path.join(dir, "_firebase_token.js")).href);
const PU = await import(pathToFileURL(path.join(dir, "_claude_push.js")).href);
import nodeCrypto from "node:crypto";
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
t("main record: 범위 검사(보유 ≤5일 · ② 233740 전용) · 효력일 전에는 옛 메인 · 검사에 떨어진 기록은 버림", () => {
  assert.throws(() => MAIN.validateParams("soxl", { rsiMax: 20, rsiN: 2, ma: 200, maxHoldDays: 6, tabSize: 0.5 }));
  assert.throws(() => MAIN.validateParams("daytrading", { code: "122630", th: -3 }));
  assert.deepEqual(MAIN.validateParams("daytrading", { code: "233740", th: -4 }), { code: "233740", th: -4 });
  const ev = MAIN.cleanEvents([
    { payload: { tab: "daytrading", version: "g_etf_th4", params: { th: -4 }, effectiveFrom: "2026-10-07", promotedAt: "a" } },
    { payload: { tab: "soxl", version: "bad", params: { maxHoldDays: 9 }, effectiveFrom: "2026-10-07", promotedAt: "b" } },
    { payload: { tab: "daytrading", version: "bad2", params: { code: "122630" }, effectiveFrom: "2026-10-08", promotedAt: "c" } }]);
  assert.deepEqual(ev.map(e => e.version), ["g_etf_th4"]);
  assert.equal(MAIN.mainFor(ev, "daytrading", "2026-10-06").version, "etf_dip_overnight_v1");
  assert.equal(MAIN.mainFor(ev, "daytrading", "2026-10-07").params.th, -4);
  assert.equal(MAIN.mainFor(ev, "daytrading").version, "g_etf_th4");
  assert.deepEqual(MAIN.openingPick({ topK: 2, gapMax: -5 }, [{ code: "A", expectedGapPct: -3 }, { code: "B", expectedGapPct: -9 }, { code: "C", expectedGapPct: -6 }]), ["B", "C"]);
  assert.deepEqual(MAIN.openingPick({ topK: 3, gapMax: -5 }, [{ code: "A", expectedGapPct: -3 }, { code: "B", expectedGapPct: -9 }]), ["B"]);
});
t("② 주문: 그날 메인 하락 기준으로 판단 · 기록을 못 읽으면 기본 −3% 로 하고 그 사실을 남긴다", () => {
  const ev = MAIN.cleanEvents([{ tab: "daytrading", version: "g_etf_th4", params: { th: -4 }, effectiveFrom: "2026-10-07", promotedAt: "a" }]);
  const r = F.etfRuleFor({ ok: true, events: ev }, "2026-10-07");
  assert.equal(r.rule.dropMaxPct, -4); assert.equal(r.rule.version, "g_etf_th4"); assert.equal(r.ruleSource, "main-config");
  assert.equal(F.etfRuleFor({ ok: true, events: ev }, "2026-10-06").rule.dropMaxPct, -3);
  const f = F.etfRuleFor({ ok: false, error: "x" }, "2026-10-07");
  assert.equal(f.rule.dropMaxPct, -3); assert.ok(f.ruleSource.startsWith("default"));
  assert.equal(F.etfRuleFor({ ok: true, events: [{ tab: "daytrading", version: "z", effectiveFrom: "2026-10-01", params: { code: "122630", th: -2 } }] }, "2026-10-07").rule.dropMaxPct, -3);
  assert.equal(F.etfDecision(-3.5, -4).signal, false); assert.equal(F.etfDecision(-4.2, -4).signal, true);
  assert.equal(F.etfDecision(-3.5, -4).decisionReason, "no_signal_drop_above_-4%");
  const plan = F.etfBuyPlan(r, { expectedPrice: 9650, basePrice: 10000 });           // −3.5%: 기본(−3)이면 매수, 메인 −4 면 안 삼
  near(plan.dropPct, -3.5); assert.equal(plan.signal, false);
  assert.equal(F.etfBuyPlan(f, { expectedPrice: 9650, basePrice: 10000 }).signal, true);
});
t("① 메인 변수: 매매일 기준(minQ) · 장부 종목(깊은 topK) — 장중 화면과 마감 장부가 같게", () => {
  const rows = [{ code: "A", pnlPct: 3, status: "청산", buyPrice: 1, expectedGapPct: -9 }, { code: "B", pnlPct: -1, status: "청산", buyPrice: 1, expectedGapPct: -5 },
    { code: "C", pnlPct: 1, status: "청산", buyPrice: 1, expectedGapPct: -3 }];
  const m1 = { version: "g_open_q5_k1", params: { minQ: 5, topK: 1, gapMax: null } };
  const one = LV.todaySummary("opening", { rows, decision: { breadth: { qualified: 6 } }, main: m1 }, 1000);
  near(one.tabPct, 3); assert.equal(one.trades, 1); assert.ok(one.why.includes("장부에는 1종목"));
  const m7 = { version: "g_open_q7_k3", params: { minQ: 7, topK: 3, gapMax: null } };
  const no = LV.todaySummary("opening", { rows, decision: { breadth: { qualified: 6 } }, main: m7 }, 1000);
  assert.equal(no.noTrade, true); assert.ok(no.why.includes("6<7"));
  const L = { events: [
    { stage: "preopen", payload: { watchlist: { size: 8 }, breadth: { qualified: 6, v2Signal: true }, decisionReason: "",
      picks: [{ code: "A", expectedGapPct: -9 }, { code: "B", expectedGapPct: -5 }],
      orders: [{ side: "buy", code: "A", name: "가", vts: { ok: true } }, { side: "buy", code: "B", name: "나", vts: { ok: true } }] } },
    { stage: "reconcile", payload: { positions: [{ code: "A", buy: { qty: 10, avgPrice: 1000 }, sell: { qty: 10, avgPrice: 1020 } },
                                                  { code: "B", buy: { qty: 5, avgPrice: 2000 }, sell: { qty: 5, avgPrice: 1980 } }] } }] };
  const d1 = DAY.openingDay("2026-10-06", L, true, {}, m1);
  assert.equal(d1.trades.length, 1); assert.equal(d1.trades[0].code, "A"); assert.equal(d1.measure.length, 1); assert.equal(d1.strategyVersion, "g_open_q5_k1");
  const d7 = DAY.openingDay("2026-10-06", L, true, {}, m7);
  assert.equal(d7.trades.length, 0); assert.equal(d7.measure.length, 2);
});
t("③ 메인 변수: 변동성 돌파 기준선 · 밤(21시~) 돌파 안 삼 · 손절폭 · 메인에 없는 코인은 마감 장부에서 뺀다", () => {
  const c = [{ trade_price: 1, opening_price: 121 }, { trade_price: 120, high_price: 125, low_price: 115, candle_date_time_kst: "2026-10-01T09:00:00" }, ...Array.from({ length: 19 }, () => ({ trade_price: 100 }))];
  const vb = LV.coinHoldToday(c, { ...MAIN.MAIN_DEFAULT.crypto.params, level: "vb", k: 0.5 });
  assert.ok(vb, "판단 없음");
  near(vb.level, 121 + 0.5 * 10);
  const P = { ...MAIN.MAIN_DEFAULT.crypto.params, lastEntryHour: 21, stopPct: 3 };
  const h = LV.coinHoldToday(c, P);
  const B = (hh, o, hi, lo, cl) => ({ candle_date_time_kst: "2026-10-02T" + hh + ":00:00", opening_price: o, high_price: hi, low_price: lo, trade_price: cl });
  const night = LV.coinBreakoutDay(h, [B("20", 120, 124, 119, 123), B("21", 123, 130, 122, 129)], 129, P);
  assert.equal(night.hold, false); assert.ok(night.status.includes("21시 전까지"));
  const day = LV.coinBreakoutDay(h, [B("10", 123, 127, 121, 126), B("11", 126, 126, 120, 121)], 121, P);
  near(day.stopPrice, 125 * 1.0005 * 0.97); assert.equal(day.stopped, true); near(day.pnlPct, -3 - 0.1 - 0.14);
  const D = (d, close, high) => ({ candle_date_time_kst: d + "T09:00:00", trade_price: close, high_price: high });
  const daily = [D("2026-10-05", 1, 1), D("2026-10-04", 120, 121), D("2026-10-03", 118, 119), ...Array.from({ length: 22 }, (_, i) => D("2026-09-" + String(30 - i).padStart(2, "0"), 100, 101))];
  const Hh = (kst, o, hi, l, cl) => ({ candle_date_time_kst: kst, opening_price: o, high_price: hi, low_price: l, trade_price: cl });
  const hourly = [];
  for (let k = 0; k < 24; k++) { const t0 = Date.parse("2026-10-04T09:00:00+09:00") + k * 36e5; const s = new Date(t0 + 9 * 36e5).toISOString().slice(0, 19);
    hourly.push(k === 4 ? Hh(s, 118, 120, 117.5, 119.5) : Hh(s, 119, 119, 118.9, 121)); }
  const btcOnly = () => ({ params: { ...MAIN.MAIN_DEFAULT.crypto.params, markets: ["KRW-BTC"] } });
  const eth = DAY.coinDay("2026-10-05", [{ market: "KRW-ETH", daily, hourly: hourly.slice().reverse() }], Date.parse("2026-10-06T00:00:00+09:00"), btcOnly);
  assert.equal(eth.exits, 0); assert.equal(eth.open.length, 0);
  const btc = DAY.coinDay("2026-10-05", [{ market: "KRW-BTC", daily, hourly: hourly.slice().reverse() }], Date.parse("2026-10-06T00:00:00+09:00"), btcOnly);
  assert.equal(btc.exits, 1);
});
t("worker: 휴장일엔 08:56 휴장 알림 한 번만 · 15:21/15:40 은 아예 안 함 · 개장일은 그대로", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(process.env.JKQ_WORKER_SRC || new URL("../worker/opening-scheduler/src/index.js", import.meta.url), "utf8");
  const a = src.indexOf("export function krHolidayAction("), b = src.indexOf("\n}\n", a) + 2;
  const f = new Function("krxDay", src.slice(a, b).replace("export ", "") + "\nreturn krHolidayAction;")(KRX.krxDay);
  assert.equal(f("preopen", "2026-10-09"), "notice"); assert.equal(f("close", "2026-10-09"), "skip"); assert.equal(f("reconcile", "2026-10-09"), "skip");
  assert.equal(f("preopen", "2026-10-08"), "run"); assert.equal(f("close", "2026-10-08"), "run");
});
t("로그인 토큰 서버 검증: 서명·프로젝트·만료·키를 직접 확인 · 공개키를 못 받으면 infra(예전 방식으로) · 소유자 판정에 그대로 쓰임", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  const other = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const b64 = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const sign = async (pl, { kid = "k1", key = kp.privateKey } = {}) => {
    const h = b64({ alg: "RS256", kid, typ: "JWT" }), p = b64(pl);
    const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(h + "." + p))).toString("base64url");
    return h + "." + p + "." + sig;
  };
  const base = { aud: "jk-invest", iss: "https://securetoken.google.com/jk-invest", sub: "u1", iat: now - 10, auth_time: now - 10, exp: now + 3000, email: "JK82investing@gmail.com", email_verified: true };
  FT._setKeysForTest([{ ...jwk, kid: "k1" }]);
  assert.deepEqual(await FT.verifyFirebaseToken(await sign(base)), { ok: true, email: "jk82investing@gmail.com", uid: "u1" });
  assert.equal((await FT.verifyFirebaseToken(await sign({ ...base, aud: "other" }))).ok, false);
  assert.equal((await FT.verifyFirebaseToken(await sign({ ...base, exp: now - 1 }))).ok, false);
  assert.equal((await FT.verifyFirebaseToken(await sign(base, { kid: "zz" }))).reason, "모르는 키");
  const bad = await FT.verifyFirebaseToken(await sign(base, { key: other.privateKey }));
  assert.equal(bad.ok, false); assert.ok(!bad.infra);
  const tok = await sign(base), parts = tok.split(".");
  const forged = parts[0] + "." + b64({ ...base, email: "attacker@x.com" }) + "." + parts[2];
  assert.equal((await FT.verifyFirebaseToken(forged)).reason, "서명 불일치");
  const req = h => ({ headers: { get: k => h[k.toLowerCase()] || null } });
  assert.equal(await AUTH.claudeAuthorized(req({ authorization: "Bearer " + tok }), { OWNER_EMAIL: "jk82investing@gmail.com" }), true);
  assert.equal(await AUTH.claudeAuthorized(req({ authorization: "Bearer " + await sign({ ...base, email: "x@y.com" }) }), { OWNER_EMAIL: "jk82investing@gmail.com" }), false);
  FT._setKeysForTest(null, -1);
  const f0 = globalThis.fetch; globalThis.fetch = async () => { throw new Error("down"); };
  try { const r = await FT.verifyFirebaseToken(tok); assert.equal(r.infra, true); } finally { globalThis.fetch = f0; }
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
t("watchlist must be based on the previous KRX trading day (휴장일 건너뜀)", () => {
  const wl = { strategyVersion: "opening_gapdown_v1", basedOn: "2026-10-02", rule, names: [] };
  assert.equal(G.watchlistUsable(wl, "2026-10-05").ok, true);            // 금 → 월
  assert.equal(G.watchlistUsable({ ...wl, basedOn: "2026-10-01" }, "2026-10-05").reason, "watchlist_stale");
  assert.equal(G.watchlistUsable(wl, "2026-10-06").ok, true);            // 10/5 휴장 → 직전 거래일 10/2 명단을 쓴다
  assert.equal(G.watchlistUsable({ ...wl, basedOn: "2026-10-01" }, "2026-10-06").reason, "watchlist_stale");
  assert.equal(G.watchlistUsable({ ...wl, basedOn: "2026-10-08" }, "2026-10-12").ok, true);   // 10/9 한글날(금) → 월요일은 목요일 명단
  assert.equal(G.watchlistUsable({ ...wl, basedOn: "2026-10-07" }, "2026-10-12").reason, "watchlist_stale");
  assert.equal(G.prevKrxDay("2026-10-06"), "2026-10-02");
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
t("새 구조 변수: ③ 최근 N일 고가(hiN) · ④ IBS · 연속 하락 · RSI 끄기 — 범위 검사 · 기준선 · 쉬는 이유 · 마감 장부 문구", () => {
  const S = MAIN.MAIN_DEFAULT.soxl.params, C = MAIN.MAIN_DEFAULT.crypto.params;
  assert.deepEqual(MAIN.validateParams("soxl", { ...S, rsiMax: 100, ibsMax: 0.3 }), { ...S, rsiMax: 100, ibsMax: 0.3 });
  assert.throws(() => MAIN.validateParams("soxl", { ...S, rsiMax: 100 }), /진입 조건 없음/);       // 조건이 하나도 없으면 거절(Python 과 같게)
  assert.throws(() => MAIN.validateParams("soxl", { ...S, ibsMax: 0.01 }));
  assert.throws(() => MAIN.validateParams("soxl", { ...S, downDays: 6 }));
  assert.equal(MAIN.validateParams("crypto", { ...C, hiN: 10 }).hiN, 10);
  assert.throws(() => MAIN.validateParams("crypto", { ...C, hiN: 21 }));
  assert.equal(MAIN.validateParams("crypto", { ...C, hiN: undefined }).hiN, 1);                // 옛 승격 기록(hiN 없음)은 어제 고가
  assert.equal(MAIN.coinDaysNeeded({ ...C, ma: 5, hiN: 10 }), 10);                            // 최근 10일 고가면 확정 일봉 10개가 있어야 판단(평균 5일보다 길다)
  assert.equal(MAIN.coinDaysNeeded({ ...C, ma: 20, hiN: 3 }), 20);
  assert.equal(MAIN.coinDaysNeeded({ ...C, ma: 5, level: "vb", hiN: 10 }), 5);
  const D = (d, close, high) => ({ candle_date_time_kst: d + "T09:00:00", trade_price: close, high_price: high, low_price: close - 1, opening_price: close });
  const c = [D("2026-10-06", 1, 999), D("2026-10-05", 120, 121), D("2026-10-04", 118, 140), D("2026-10-03", 117, 125), ...Array.from({ length: 20 }, () => D("2026-09-20", 100, 101))];
  assert.equal(LV.coinHoldToday(c, C).level, 121);
  const h3 = LV.coinHoldToday(c, { ...C, hiN: 3 });
  assert.equal(h3.level, 140); assert.equal(h3.hiN, 3);
  assert.equal(LV.coinHoldToday(c, { ...C, level: "vb", hiN: 3 }).hiN, 1);                   // 변동성 돌파는 고가 일수를 쓰지 않는다
  assert.equal(LV.coinHoldToday(c.slice(0, 3), { ...C, ma: 2, hiN: 3 }), null);               // 고가 일수만큼 확정 봉이 없으면 판단 안 함
  const wait = LV.coinBreakoutDay(h3, [], null, { ...C, hiN: 3 });
  assert.ok(wait.status.includes("최근 3일 고가"));
  const q = { price: 100, ohlc: [{ date: "2026-10-01", open: 100, close: 100 }, { date: "2026-10-02", open: 99, close: 100 }], intraday: { regular: { c: 100 }, date: "2026-10-02" } };
  const flat = LV.soxlLive({ basedOn: "2026-10-01", action: "none", holding: false, heldDays: 0, close: 100, ma: 0, maDays: 0, rsi2: 55, why: "IBS 0.62 > 0.3" }, q, null);
  assert.equal(flat.status, "쉼 — IBS 0.62 > 0.3");
  const day = DAY.soxlDay("2026-10-02", { basedOn: "2026-10-01", action: "buy", holding: false, heldDays: 0, close: 100, ma: 0, maDays: 0, rsi2: 55, entryRule: "종가 위치(IBS) ≤ 0.3 · 2일 연속 하락" }, q, null);
  assert.equal(day.note, "전날 확정 종가 종가 위치(IBS) ≤ 0.3 · 2일 연속 하락 → 시가 매수");
  const none = DAY.soxlDay("2026-10-02", { basedOn: "2026-10-01", action: "none", holding: false, heldDays: 0, close: 100, why: "연속 하락 1일 < 2일" }, q, null);
  assert.equal(none.note, "신호 없음(연속 하락 1일 < 2일) — 쉼");
});
t("알림(웹 · 텔레그램 공용): 매수·매도 때만 · [클로드 연구 탭] 머리말 · ① 메인 매매일 · 메인 종목만 · ③ 다음 날 09:00 매도 · 손절은 매도 알림 안 함", () => {
  const now = Date.parse("2026-10-07T10:30:00+09:00");                       // 업비트 하루 10/7 · 어제 10/6
  const M = { params: { minQ: 5, topK: 3, gapMax: -3 } };
  const live = { today: "2026-10-07", tabs: {
    opening: { main: M, decision: { breadth: { qualified: 6 } },
      rows: [{ code: "1", name: "가", status: "보유중", expectedGapPct: -5.2 }, { code: "2", name: "나", status: "주문 실패", expectedGapPct: -4.1 },
             { code: "3", name: "다", status: "청산", realized: true, pnlPct: 2.0, expectedGapPct: -3.5 }, { code: "4", name: "라", status: "청산", realized: true, pnlPct: -1.0, expectedGapPct: -2.5 }] },
    daytrading: { rows: [{ name: "KODEX", buyTime: "2026-10-06 15:30 종가", sellTime: "오늘 09:00 시가", status: "청산", realized: true, pnlPct: 0.8 },
                         { name: "KODEX", buyTime: "오늘 15:30 종가", status: "보유중(오버나잇)", dropPct: -3.4 }] },
    crypto: { rows: [{ code: "KRW-BTC", hold: true, buyTime: "10:00", buyPrice: 120000000, stopped: false, nowPrice: 121000000 },
                     { code: "KRW-ETH", hold: true, buyTime: "09:00", buyPrice: 3700000, stopped: true, stopPrice: 3515000, pnlPct: -5.24, nowPrice: 3600000 }] },
    soxl: { rows: [{ status: "보유중 (시가 매수)", buyTime: "2026-10-06 시가", buyPrice: 150.5 }] } } };
  const sent = { "coin:2026-10-06:KRW-BTC:buy": { at: 1, price: 110000000 }, "coin:2026-10-06:KRW-ETH:buy": { at: 1, price: 1 }, "coin:2026-10-06:KRW-ETH:stop": { at: 1 },
    "coin:2026-10-05:KRW-BTC:buy": { at: 1, price: 100 } };                                         // 이틀 전 매수분은 이미 어제 09:00 에 팔았다 — 다시 알리지 않는다
  const ev = PU.pushEvents(live, now, sent), ids = ev.map(e => e.id).sort();
  assert.deepEqual(ids, ["coin:2026-10-06:KRW-BTC:sell", "coin:2026-10-07:KRW-BTC:buy", "coin:2026-10-07:KRW-ETH:buy", "coin:2026-10-07:KRW-ETH:stop",
    "etf:2026-10-07:buy", "etf:2026-10-07:sell", "open:2026-10-07:buy", "open:2026-10-07:sell", "soxl:2026-10-06:buy"]);
  const by = Object.fromEntries(ev.map(e => [e.id, e]));
  assert.ok(ev.every(e => /^\[클로드 연구 (시초가|데이트레이딩|비트코인|SOXL)\] (🟢|🔴) /.test(e.title)), ev.map(e => e.title).join(" / "));   // 머리말 · 매수/매도만
  assert.equal(by["open:2026-10-07:buy"].title, "[클로드 연구 시초가] 🟢 매수");
  assert.equal(by["open:2026-10-07:buy"].body, "가 (갭 -5.20%) · 다 (갭 -3.50%) — 08:59 동시호가 → 15:30 종가 매도 · 주문 실패 1종목");   // 갭 −3% 이하(메인)만 · 주문 실패는 매수로 안 셈
  assert.equal(by["open:2026-10-07:sell"].body, "다 +2.00% · 평균 +2.00% — 15:30 종가");                 // '라'(갭 −2.5%)는 메인 종목 아님(측정용)
  assert.equal(by["etf:2026-10-07:buy"].title, "[클로드 연구 데이트레이딩] 🟢 매수");
  assert.equal(by["coin:2026-10-06:KRW-BTC:sell"].title, "[클로드 연구 비트코인] 🔴 BTC 매도");
  assert.equal(by["coin:2026-10-06:KRW-BTC:sell"].body, "BTC 09:00 매도(어제 돌파분) 약 +9.86%");      // 121/110 − 1 − 비용 0.14
  assert.equal(by["soxl:2026-10-06:buy"].title, "[클로드 연구 SOXL] 🟢 매수");
  assert.equal(by["coin:2026-10-07:KRW-BTC:buy"].price, 120000000);                                 // 다음 날 매도 알림이 쓸 매수가
  assert.ok(!ids.includes("coin:2026-10-06:KRW-ETH:sell"));                                          // 어제 손절한 코인은 09:00 매도 없음
  assert.equal(PU.alertText(by["etf:2026-10-07:buy"]), "[클로드 연구 데이트레이딩] 🟢 매수\nKODEX 종가 매수 (오늘 -3.40%) → 다음 거래일 09:00 시가 매도\n\n자세히: jkquant.pages.dev/claude");
  // ① 메인 매매일이 아니면(통과 4 < 5) 주문이 있어도 체결 측정용 — 알리지 않는다. 판단 기록이 없어도 알리지 않는다
  const notMain = { ...live, tabs: { ...live.tabs, opening: { ...live.tabs.opening, decision: { breadth: { qualified: 4 } } } } };
  assert.ok(!PU.pushEvents(notMain, now, sent).some(e => e.id.startsWith("open:")));
  assert.ok(!PU.pushEvents({ ...live, tabs: { ...live.tabs, opening: { rows: live.tabs.opening.rows } } }, now, sent).some(e => e.id.startsWith("open:")));
  assert.deepEqual(PU.pushEvents({ today: "2026-10-07", tabs: { opening: { main: M, decision: { breadth: { qualified: 9 } }, rows: [{ code: "1", name: "가", status: "주문 실패", expectedGapPct: -5 }] },
    daytrading: { rows: [{ status: "매매 없음" }, { name: "KODEX", buyTime: "오늘 15:30 종가", status: "주문 실패", dropPct: -4 }] },
    crypto: { rows: [{ code: "KRW-BTC", hold: false }] }, soxl: { rows: [{ status: "쉼 — RSI(2) 80 ≥ 20" }] } } }, now, {}), []);   // 매매 없음 · 주문 실패는 실제 매수가 아니다 — 알림 없음
});
t("웹 알림 암호화(RFC 8291) — 받는 쪽 표준 복호화로 원문 복원 · VAPID 서명 검증", async () => {
  const ua = nodeCrypto.createECDH("prime256v1"); ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: PU.b64u(ua.getPublicKey()), auth: PU.b64u(auth) } };
  const msg = JSON.stringify({ title: "🟢 ① 시초가 매수", body: "가 · 나 — 08:59 동시호가" });
  const enc = Buffer.from(await PU.encryptPayload(sub, msg));
  // 받는 쪽(브라우저)이 하는 복호화를 Node 기본 암호 모듈로 따로 구현
  const salt = enc.subarray(0, 16), rs = enc.readUInt32BE(16), idlen = enc[20], asPub = enc.subarray(21, 21 + idlen), ct = enc.subarray(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const shared = ua.computeSecret(asPub);
  const H = (salt, ikm, info, len) => Buffer.from(nodeCrypto.hkdfSync("sha256", ikm, salt, info, len));
  const ikm = H(auth, shared, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPub]), 32);
  const cek = H(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0"), 16), nonce = H(salt, ikm, Buffer.from("Content-Encoding: nonce\0"), 12);
  let pt;
  try {
    const dec = nodeCrypto.createDecipheriv("aes-128-gcm", cek, nonce);
    dec.setAuthTag(ct.subarray(ct.length - 16));
    pt = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()]);
  } catch (e) { assert.fail("받는 쪽 복호화 실패: " + e.message); }
  assert.equal(pt[pt.length - 1], 2);                                     // 마지막 레코드 구분자
  assert.equal(pt.subarray(0, pt.length - 1).toString("utf8"), msg);
  // VAPID: ES256 서명이 공개키로 검증되고, aud = 받는 서비스 주소, k = 같은 공개키
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const hdr = await PU.vapidAuth(sub.endpoint, jwk, 1000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(hdr);
  assert.equal(k, PU.vapidPublic(jwk));
  const [h, p, sg] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(PU.unb64u(p)).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.exp, 1000 + 12 * 3600);
  assert.ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey, PU.unb64u(sg), new TextEncoder().encode(h + "." + p)));
  let got = null;
  const r = await PU.sendPush(sub, { title: "x" }, jwk, async (url, init) => { got = { url, init }; return { status: 410 }; });
  assert.equal(r.gone, true); assert.equal(got.init.headers["Content-Encoding"], "aes128gcm"); assert.ok(got.init.headers.Authorization.startsWith("vapid t="));
});
t("worker 알림: 5분 감시가 새 매수·매도만 웹 알림 + 텔레그램(같은 사건 · [클로드 연구 탭]) · 텔레그램 거절만 3번까지 · 사라진 구독은 지움 · 경로는 감시키", async () => {
  const fs = await import("node:fs"), os = await import("node:os");
  let src = fs.readFileSync(process.env.JKQ_WORKER_SRC || new URL("../worker/opening-scheduler/src/index.js", import.meta.url), "utf8");
  src = src.replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}")
    .replace(/"\.\.\/\.\.\/\.\.\/functions\/api\/([^"]+)"/g, (_, f) => JSON.stringify(pathToFileURL(path.join(dir, f)).href));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wk-")), "worker.mjs"); fs.writeFileSync(tmp, src);
  const W = await import(pathToFileURL(tmp).href);
  const mem = new Map(); let alarmAt = null;
  const env = { MONITOR_KEY: "mk", BASE_URL: "https://pages.test", SIGNAL_STORE: { idFromName: n => n, get: n => ({ fetch: (u, i) => { assert.equal(n, "claudepush"); return store.fetch(new Request(u, i)); } }) } };
  const store = new W.OpeningSignalStore({ storage: { get: async k => mem.get(k), put: async (k, v) => { mem.set(k, v); },
    getAlarm: async () => alarmAt, setAlarm: async t => { alarmAt = t; } } }, env);
  const ua = nodeCrypto.createECDH("prime256v1"); ua.generateKeys();
  const sub = { endpoint: "https://push.test/s1", keys: { p256dh: PU.b64u(ua.getPublicKey()), auth: PU.b64u(nodeCrypto.randomBytes(16)) } };
  const op = { main: { params: { minQ: 5, topK: 3, gapMax: null } }, decision: { breadth: { qualified: 6 } } };
  let live = { ok: true, today: "2026-10-07", tabs: { opening: { ...op, rows: [{ code: "000001", name: "가", status: "보유중", expectedGapPct: -4 }] }, daytrading: { rows: [] }, crypto: { rows: [] }, soxl: { rows: [] } } };
  const posts = [], tgs = [], oldFetch = globalThis.fetch;
  let tgReply = { ok: true };
  globalThis.fetch = async (u, init = {}) => {
    u = String(u);
    if (u.endsWith("/api/claude-live")) { assert.equal(init.headers["x-monitor-key"], "mk"); return new Response(JSON.stringify(live)); }
    if (u.startsWith("https://push.test/")) { posts.push(u); return new Response("", { status: u.endsWith("gone") ? 410 : 201 }); }
    if (u.endsWith("/api/claude-telegram")) { const b = JSON.parse(init.body); assert.equal(b.op, "event"); tgs.push(b.text); return new Response(JSON.stringify(tgReply), { status: tgReply.ok ? 200 : 502 }); }
    throw new Error("unexpected fetch " + u);
  };
  try {
    const call = (p, body, key = "mk") => W.default.fetch(new Request("https://w.test" + p, body ? { method: "POST", headers: { "x-monitor-key": key }, body: JSON.stringify(body) } : { headers: { "x-monitor-key": key } }), env).then(r => r.json());
    assert.equal((await call("/push-key", null, "bad")).ok, false);                                  // 감시키 없이는 못 씀
    const k1 = await call("/push-key"), k2 = await call("/push-key");
    assert.ok(k1.ok && k1.publicKey.length > 80); assert.equal(k1.publicKey, k2.publicKey);          // 서명키는 처음 한 번만 만든다
    assert.equal((await call("/push-subscribe", { subscription: sub })).count, 1);
    assert.ok(alarmAt > Date.now() && alarmAt % 3e5 === 0);                                            // 구독하면 5분 감시 알람이 걸린다
    assert.equal((await call("/push-subscribe", { subscription: { ...sub, endpoint: "https://push.test/gone" } })).count, 2);
    const now = Date.parse("2026-10-07T09:00:00+09:00");
    const r1 = await W.claudePushWatch(env, now);
    assert.equal(r1.fresh, 1); assert.deepEqual(posts.sort(), ["https://push.test/gone", "https://push.test/s1"]);
    assert.equal(r1.dropped, 1); assert.equal((await call("/push-key")).subscribers, 1);            // 410 받은 구독은 지운다
    assert.deepEqual(tgs, ["[클로드 연구 시초가] 🟢 매수\n가 (갭 -4.00%) — 08:59 동시호가 → 15:30 종가 매도\n\n자세히: jkquant.pages.dev/claude"]);   // 텔레그램도 같은 사건 · 같은 머리말
    posts.length = 0; tgs.length = 0;
    assert.equal((await W.claudePushWatch(env, now + 3e5)).fresh || 0, 0); assert.deepEqual(posts, []); assert.deepEqual(tgs, []);   // 같은 매수는 다시 안 보냄
    live.tabs.opening.rows[0] = { code: "000001", name: "가", status: "청산", realized: true, pnlPct: 1.2, expectedGapPct: -4 };
    tgReply = { ok: false, definite: true, error: "Too Many Requests" };                            // 텔레그램이 거절 → 다음 감시에서 텔레그램만 다시
    alarmAt = null;
    await store.alarm();                                                                              // 저장소 알람이 감시를 돌리고 다음 5분 알람을 다시 건다
    assert.deepEqual(posts, ["https://push.test/s1"]);                                                // 매수는 이미 보냄 — 새로 생긴 매도 한 건만
    assert.ok(alarmAt > Date.now() && alarmAt % 3e5 === 0);
    assert.equal(tgs.length, 1); assert.ok(tgs[0].startsWith("[클로드 연구 시초가] 🔴 매도\n가 +1.20%"));
    posts.length = 0; tgs.length = 0;
    const r3 = await W.claudePushWatch(env, now + 6e5);                                               // 거절된 텔레그램만 다시(웹 알림은 다시 안 보냄)
    assert.deepEqual(posts, []); assert.equal(tgs.length, 1); assert.deepEqual(r3.telegram, [{ id: "open:2026-10-07:sell", result: "fail" }]);
    tgs.length = 0;
    await W.claudePushWatch(env, now + 9e5); assert.equal(tgs.length, 1);                              // 세 번째(마지막) 시도
    tgs.length = 0; tgReply = { ok: true };
    await W.claudePushWatch(env, now + 12e5); assert.deepEqual(tgs, []);                              // 3번 거절되면 더 보내지 않는다
    const sentMap = (await store.pushOp("sent", {})).sent;
    assert.equal(sentMap["open:2026-10-07:sell"].tgTries, 3); assert.equal(sentMap["open:2026-10-07:buy"].tg, "sent");
    tgReply = { ok: false, definite: false, error: "HTTP 502" };                                       // 보냈는지 모르면 다시 보내지 않는다(중복 방지)
    live.tabs.opening.rows.push({ code: "000002", name: "나", status: "청산", realized: true, pnlPct: -0.5, expectedGapPct: -3 });
    live.tabs.daytrading.rows = [{ name: "KODEX", buyTime: "오늘 15:30 종가", status: "보유중(오버나잇)", dropPct: -3.4 }];
    await W.claudePushWatch(env, now + 15e5); assert.equal(tgs.length, 1); tgs.length = 0;
    await W.claudePushWatch(env, now + 18e5); assert.deepEqual(tgs, []);
    live = null; posts.length = 0; alarmAt = null;
    await store.alarm();                                                                              // 감시가 실패해도(자료 없음) 다음 알람은 꼭 건다
    assert.ok(alarmAt > Date.now()); assert.deepEqual(posts, []);
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(W.nextPushAt(Date.UTC(2026, 9, 7, 0, 3, 10)), Date.UTC(2026, 9, 7, 0, 5));
  assert.equal(W.nextPushAt(Date.UTC(2026, 9, 7, 0, 5)), Date.UTC(2026, 9, 7, 0, 10));
});
t("①② 매수 직전 현금 확인: 살 수 있는 만큼만 · 0주면 주문 안 함(사유 기록) · 조회 실패면 계획대로 · 재시도 없음", async () => {
  assert.deepEqual(F.sizeToBuyable(738, { qty: 210, cash: 2000000 }), { qty: 210, planned: 738, capped: true, cash: 2000000, note: "계좌 현금에 맞춰 738→210주" });
  assert.equal(F.sizeToBuyable(10, { qty: 50, cash: 9e6 }).qty, 10);
  assert.equal(F.sizeToBuyable(10, { error: "초당 요청 제한" }).qty, 10);                         // 조회 실패 → 계획대로(주문을 막지 않음)
  assert.equal(F.sizeToBuyable(10, { qty: 0, cash: 1000 }).qty, 0);
  const calls = [], old = globalThis.fetch;
  let can = 0;
  globalThis.fetch = async (u, init = {}) => {
    u = String(u); calls.push(u);
    assert.equal(init.headers["x-autotrade-key"], "ak");
    if (u.includes("op=buyable")) { assert.ok(u.includes("env=vts")); return new Response(JSON.stringify({ code: "233740", cash: 1, qty: can })); }
    if (u.includes("op=order")) { const b = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, orderNo: "1", qty: b.qty })); }
    throw new Error("unexpected " + u);
  };
  try {
    const x = { code: "233740", name: "KODEX" };
    const r0 = await F.sizedBuy("https://o", { AUTOTRADE_KEY: "ak" }, "2026-10-07", x, 738, { id: "t0" });
    assert.equal(r0.qty, 0); assert.equal(r0.vts.ok, false); assert.ok(r0.vts.msg.includes("매수가능 0주"));
    assert.ok(!calls.some(u => u.includes("op=order")));                                         // 0주면 주문을 내지 않는다
    can = 210; calls.length = 0;
    const r1 = await F.sizedBuy("https://o", { AUTOTRADE_KEY: "ak" }, "2026-10-07", x, 738, { id: "t1" });
    assert.equal(r1.qty, 210); assert.equal(r1.vts.ok, true); assert.equal(r1.sizing.capped, true);
    assert.deepEqual(r1.sizing.lookup.map(x => x.limitMs), [6000]);                              // 조회 기록이 장부에 남는다
    assert.equal(calls.filter(u => u.includes("op=order")).length, 1);
  } finally { globalThis.fetch = old; }
});
t("①② 매수가능 조회 지연(2026-10-12 ② 2.5초 초과 → 835주 거절 재현): 6초까지 기다림 · 실패하면 조회만 한 번 더 · 마감 안에서만 · 주문은 안 냄", async () => {
  const env = { AUTOTRADE_KEY: "ak" }, code = "233740";
  const mk = steps => {                                                       // 조회 응답 차례: {ms, body, status} · ms<0 이면 응답 없음(제한시간까지 매달림)
    const f = (u, init = {}) => {
      f.calls.push(String(u)); assert.equal(init.headers["x-autotrade-key"], "ak");
      const step = steps.shift() || { ms: 0, body: { error: "no plan" }, status: 502 };
      return new Promise((res, rej) => {
        const tm = step.ms >= 0 ? setTimeout(() => res(new Response(JSON.stringify(step.body), { status: step.status || 200 })), step.ms) : null;
        init.signal && init.signal.addEventListener("abort", () => { clearTimeout(tm); rej(new DOMException("The operation was aborted.", "AbortError")); });
      });
    };
    f.calls = []; return f;
  };
  const seq = arr => () => arr.length > 1 ? arr.shift() : arr[0];
  await Promise.all([
    (async () => {                                                            // ⓐ 제한 6초(옛 2.5초는 느린 모의투자 응답을 끊고 계획 835주를 냈다)
      const f = mk([{ ms: 0, body: { code, cash: 1000000, qty: 120 } }]);
      const a = await F.lookupBuyable("https://o", env, code, 0, undefined, f);
      assert.equal(a.qty, 120); assert.deepEqual(a.tries.map(x => [x.limitMs, x.error]), [[6000, undefined]]);
      assert.ok(f.calls[0].includes("op=buyable") && f.calls[0].includes("env=vts"));
    })(),
    (async () => {                                                            // ⓑ 첫 조회 실패(초당 제한) → 조회만 한 번 더 → 120주(계획 835주가 아니라)
      const f = mk([{ ms: 0, body: { error: "초당 요청 제한 — 잠시 후 다시" }, status: 502 }, { ms: 0, body: { code, cash: 1000000, qty: 120 } }]);
      const b = await F.lookupBuyable("https://o", env, code, 0, undefined, f);
      assert.equal(b.qty, 120); assert.equal(b.tries.length, 2); assert.equal(b.tries[0].error, "초당 요청 제한 — 잠시 후 다시");
      assert.equal(F.sizeToBuyable(835, b).qty, 120);
      assert.equal(f.calls.length, 2); assert.ok(f.calls.every(u => u.includes("op=buyable")));          // 읽기만 — 주문은 여기서 나가지 않는다
    })(),
    (async () => {                                                            // ⓒ 두 번 다 실패 → 계획 수량 그대로(주문을 막지 않음) · 마지막 실패 사유가 남는다
      const f = mk([{ ms: 0, body: { error: "e1" }, status: 502 }, { ms: 0, body: { error: "e2" }, status: 502 }]);
      const c = await F.lookupBuyable("https://o", env, code, 0, undefined, f);
      assert.equal(c.error, "e2"); assert.deepEqual(c.tries.map(x => x.error), ["e1", "e2"]);
      assert.equal(F.sizeToBuyable(835, c).qty, 835); assert.ok(F.sizeToBuyable(835, c).note.includes("e2"));
    })(),
    (async () => {                                                            // ⓓ ① 마감 08:59:40 — 주문 몫 4초를 남긴 시간만 기다리고, 시간이 없으면 다시 묻지 않는다
      const f = mk([{ ms: -1 }]);
      const d = await F.lookupBuyable("https://o", env, code, 85940, seq([85935, 85937]), f);
      assert.equal(d.tries.length, 1); assert.equal(d.tries[0].limitMs, 1000); assert.ok(d.tries[0].ms >= 900 && d.tries[0].ms < 2500, JSON.stringify(d.tries));
      assert.equal(d.error, "응답 지연 1.0초 초과");
    })(),
    (async () => {
      const f = mk([]);
      const e = await F.lookupBuyable("https://o", env, code, 85940, () => 85937, f);
      assert.deepEqual(e.tries, []); assert.equal(e.error, "마감 임박 — 조회 생략"); assert.equal(f.calls.length, 0);
      assert.equal(F.sizeToBuyable(14, e).qty, 14);
      const g = await F.lookupBuyable("https://o", env, code, 85940, () => 85600, mk([]));               // 마감이 멀면 평소대로 6초 · 2번
      assert.deepEqual(g.tries.map(x => x.limitMs), [6000, 6000]);
    })(),
  ]);
});
t("① 현금이 모자라면 남은 종목에 고르게(2026-10-15 사용자 승인) · 한투 모의 초당 2건 — 조회 · 주문 사이 1.1초(10/15 클래시스 '초당 거래건수 초과' 재현)", async () => {
  await Promise.all(pending.slice());                                         // 전역 fetch · 호출 간격 기록을 쓰므로 앞 시험이 다 끝난 뒤에
  assert.deepEqual(F.sizeToBuyable(79, { qty: 120, cash: 3944327 }, 3),
    { qty: 40, planned: 79, capped: true, cash: 3944327, buyable: 120, split: 3, note: "현금 부족 — 매수가능 120주를 남은 3종목에 고르게: 79→40주" });
  assert.deepEqual(F.sizeToBuyable(10, { qty: 50, cash: 9e6 }, 3), { qty: 10, planned: 10, capped: false, cash: 9e6, note: "" });   // 넉넉하면 계획 그대로
  assert.deepEqual(F.sizeToBuyable(79, { qty: 120, cash: 1 }), F.sizeToBuyable(79, { qty: 120, cash: 1 }, 1));                          // ② · 한 종목은 그대로
  assert.equal(F.sizeToBuyable(79, { error: "x" }, 3).qty, 79);                                                                       // 조회 실패면 계획대로
  // 2026-10-14 재현: 현금 3,944,327원 · 시장가 매수는 상한가(기준가 ×1.3)로 묶인다 · 계획 = 200만 원 ÷ 예상가(클래시스 79 · 코스맥스엔비티 398 · 휴젤 12주)
  const run = even => {
    let cash = 3944327; const held = [];
    const ps = [{ planned: 79, up: 36000 }, { planned: 398, up: 7090 }, { planned: 12, up: 220500 }];
    ps.forEach((p, i) => { const s = F.sizeToBuyable(p.planned, { qty: Math.floor(cash / p.up), cash }, even ? ps.length - i : 1); cash -= s.qty * p.up; held.push(s.qty * p.up); });
    return held;
  };
  assert.deepEqual(run(false), [2844000, 1098950, 0]);                                    // 옛 방식: 앞 두 종목이 다 쓰고 휴젤 0주
  assert.deepEqual(run(true), [1296000, 1318740, 1323000]);                               // 고르게: 세 종목 모두 약 130만 원씩
  assert.equal(F.kisWaitMs(5000, 0), 0); assert.equal(F.kisWaitMs(1500, 1000), 600); assert.equal(F.kisWaitMs(2200, 1000), 0);
  // 장전 매수 차례: 깊은 갭 순서 · 남은 종목 수 3 → 2 → 1 · 계획 = 200만 원 ÷ 예상가 · 08:59:40 뒤는 내지 않음
  const seen = [], picks = [{ code: "214150", expectedPrice: 25300 }, { code: "222040", expectedPrice: 5020 }, { code: "145020", expectedPrice: 158000 }];
  const fake = async (o, e, d, x, planned, meta) => { seen.push([x.code, planned, meta.split, meta.deadline]); return { code: x.code, qty: planned }; };
  const pb = await F.preopenBuys("https://o", {}, "2026-10-14", picks, 2000000, { buy: fake, hms: () => 85700 });
  assert.deepEqual(seen, [["214150", 79, 3, 85940], ["222040", 398, 2, 85940], ["145020", 12, 1, 85940]]); assert.equal(pb.length, 3);
  seen.length = 0;
  const late = await F.preopenBuys("https://o", {}, "2026-10-14", picks, 2000000, { buy: fake, hms: () => 85940 });
  assert.deepEqual(seen, []); assert.ok(late.every(o => o.qty === 0 && /08:59:40 이후/.test(o.vts.msg)));
  const calls = [], old = globalThis.fetch;
  let can = 9;
  globalThis.fetch = async (u, init = {}) => {
    u = String(u); calls.push([u.includes("op=buyable") ? "buyable" : u.includes("op=order") ? "order" : u, Date.now()]);
    if (u.includes("op=buyable")) return new Response(JSON.stringify({ code: "214150", cash: 331969, qty: can }));
    if (u.includes("op=order")) { const b = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true, orderNo: "1", qty: b.qty })); }
    throw new Error("unexpected " + u);
  };
  try {
    const env = { AUTOTRADE_KEY: "ak" };
    F._resetPacingForTest();                                                  // 앞 시험의 주문 간격(2.5초)이 조회→주문 간격을 가리지 않게
    const a = await F.sizedBuy("https://o", env, "2026-10-15", { code: "214150", name: "클래시스" }, 80, { id: "even-a", split: 2 });   // 9주 ÷ 남은 2종목
    assert.equal(a.qty, 4); assert.equal(a.vts.ok, true); assert.deepEqual([a.sizing.buyable, a.sizing.split, a.sizing.capped], [9, 2, true]);
    can = 2;
    const z = await F.sizedBuy("https://o", env, "2026-10-15", { code: "298040", name: "효성중공업" }, 5, { id: "even-z", split: 3 });   // 2주 ÷ 3 = 0 → 주문 없음 · 사유
    assert.equal(z.qty, 0); assert.equal(z.vts.msg, "매수 생략 — 매수가능 2주를 남은 3종목에 나누면 0주 · 계획 5주");
    assert.deepEqual(calls.map(c => c[0]), ["buyable", "order", "buyable"]);                   // 0주면 주문을 내지 않는다
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i][1] - calls[i - 1][1] >= 1090, JSON.stringify(calls));   // 조회→주문 · 주문→다음 조회 모두 1.1초 넘게(옛 0.6초)
  } finally { globalThis.fetch = old; }
});
t("① 칸 · 합계는 체결분만(밤 마감 장부와 같게) — 2026-10-15 체결 1 · 실패 2 인데 칸 +5.98% · 합계 +17.93% 로 보였다", () => {
  const rows = [{ code: "094170", pnlPct: 8.97, status: "보유중", buyPrice: 19600, expectedGapPct: -15.46 },
                { code: "298040", pnlPct: 1.09, status: "주문 실패", buyPrice: 1813000, expectedGapPct: -15.08 },
                { code: "214150", pnlPct: 7.87, status: "주문 실패", buyPrice: 25000, expectedGapPct: -10.23 }];
  const s = LV.todaySummary("opening", { rows, decision: { breadth: { qualified: 43, v2Signal: true } } }, 1342);
  near(s.tabPct, 8.97); near(s.sumPct, 8.97); assert.deepEqual([s.trades, s.wins, s.losses], [1, 1, 0]); assert.ok(s.why.includes("주문 실패 2건"));
  const m = LV.todaySummary("opening", { rows, decision: { breadth: { qualified: 3, v2Signal: false } } }, 1342);   // 매매일 아님 — 측정값도 체결분만
  near(m.measurePct, 8.97); assert.equal(m.tabPct, 0);
});
t("③ · ④ 칸: 더 살 수 없는 날은 하루가 안 끝나도 '매매없음'(2026-10-15 08:33 전일 칸 '매매 전' 혼동) · 살 수 있으면 언제까지인지", () => {
  const P = { ma: 20, stopPct: 5, level: "prevhigh", k: 0.5, hiN: 1, lastEntryHour: null, tabSize: 0.8, markets: ["KRW-BTC", "KRW-ETH"] };
  const day = i => LV.addDays("2026-10-14", -i);
  const at = s => Date.parse(s + "+09:00");
  const mk = up => Array.from({ length: 26 }, (_, i) => ({ candle_date_time_kst: day(i) + "T09:00:00", opening_price: 100, trade_price: up ? 125 - i : 100 + i, high_price: up ? 126 - i : 101 + i, low_price: 90 }));
  const bars = Array.from({ length: 24 }, (_, k) => ({ candle_date_time_kst: (k < 15 ? "2026-10-13" : "2026-10-14") + "T" + String((9 + k) % 24).padStart(2, "0") + ":00:00",
    opening_price: 100, high_price: 101, low_price: 99, trade_price: 100 })).reverse();     // 어느 봉도 기준선(어제 고가)을 못 넘음
  const rest = LV.coinDayCell("2026-10-13", ["KRW-BTC", "KRW-ETH"].map(m => ({ market: m, daily: mk(false), hourly: bars })), P, at("2026-10-14T08:33:00"));
  assert.deepEqual([rest.v, rest.final, rest.decided, rest.note], ["no_trade", true, true, "BTC·ETH 쉼(추세 평균 아래)"]);       // 둘 다 쉼 → 더 살 수 없음
  const wait = LV.coinDayCell("2026-10-13", ["KRW-BTC", "KRW-ETH"].map(m => ({ market: m, daily: mk(true), hourly: bars })), P, at("2026-10-14T08:33:00"));
  assert.deepEqual([wait.v, wait.final, wait.decided], ["no_trade", false, undefined]);
  assert.equal(wait.note, "아직 매수 없음 — BTC·ETH 돌파 없음 · 10/14 09:00 전까지 돌파하면 매수");
  const late = LV.coinDayCell("2026-10-13", ["KRW-BTC", "KRW-ETH"].map(m => ({ market: m, daily: mk(true), hourly: bars })), { ...P, lastEntryHour: 21 }, at("2026-10-13T22:00:00"));
  assert.deepEqual([late.v, late.final, late.decided], ["no_trade", true, true]);                                                  // 밤 돌파 금지 21시 뒤
  const early = LV.coinDayCell("2026-10-13", ["KRW-BTC", "KRW-ETH"].map(m => ({ market: m, daily: mk(true), hourly: bars })), { ...P, lastEntryHour: 21 }, at("2026-10-13T20:00:00"));
  assert.equal(early.final, false); assert.ok(early.note.endsWith("10/13 21:00 전까지 돌파하면 매수"));
  const nx = { basedOn: "2026-10-12", close: 128.4, action: null, holding: false };
  const q4 = { ohlc: [{ date: "2026-10-12", open: 130, close: 128.4 }, { date: "2026-10-13", open: 126, close: 127.5 }], price: 127.5, marketState: "REGULAR" };
  assert.deepEqual(LV.soxlDayCell(nx, q4, 0.5).cell, { v: "no_trade", final: true, decided: true, src: "rule", trades: 0 });       // 정규장 중이어도 살 것 · 가진 것 없음
  assert.deepEqual(LV.soxlDayCell(nx, { ...q4, marketState: "POST" }, 0.5).cell, { v: "no_trade", final: true, src: "rule", trades: 0 });
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
t("알림 이름은 연구(클로드) — 켜짐 확인 알림 제목 · 서비스워커 기본 제목 · 설정 카드 이름과 켜기/실패 안내에 '단타' 없음", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), read = f => fs.readFileSync(path.join(root, f), "utf8");
  // ① 켜기 직후 자동으로 한 번 · '테스트 알림' 버튼 — Worker 가 보내는 시험 알림
  const tm = read("worker/opening-scheduler/src/index.js").match(/if\(op==="test"\)[^\n]*?title:"([^"]*)",body:"([^"]*)"/);
  assert.ok(tm, "시험 알림 줄"); assert.equal(tm[1], "🔔 연구(클로드) 알림 켜짐"); assert.ok(!/단타/.test(tm[1] + tm[2]));
  // ② 서비스워커 — 제목이 없는 알림의 기본 제목 · 제목이 있으면 그대로
  const on = {}, shown = [];
  vm.runInNewContext(read("claude-sw.js"), { self: { addEventListener: (k, f) => { on[k] = f; }, registration: { showNotification: t => { shown.push(t); return Promise.resolve(); } } } });
  for (const d of [{ body: "b" }, { title: "[클로드 연구 시초가] 🟢 매수", body: "b" }]) on.push({ data: { json: () => d, text: () => "" }, waitUntil() {} });
  assert.deepEqual(shown, ["JK 투자 연구(클로드)", "[클로드 연구 시초가] 🟢 매수"]);
  // ③ 설정 → 알림 카드 — 실제 스크립트를 돌려 이름 · 켜기 성공 · 끄기 실패 안내를 본다
  const host = { innerHTML: "", btn: {}, querySelectorAll() { return [...this.innerHTML.matchAll(/data-a="(\w+)"/g)].map(m => ({ getAttribute: () => m[1], addEventListener: (k, f) => { host.btn[m[1]] = f; } })); } };
  const alerts = [], tick = () => new Promise(r => setTimeout(r, 0));
  const P = { state: async () => "off", iosNeedsHome: () => false, enable: async () => "on", disable: async () => { throw new Error("거절"); }, test: async () => {} };
  vm.runInNewContext(read("settings-claude-push.js"), { window: { ClaudePush: P, jkAuth: null }, document: { getElementById: id => id === "claudePushSettings" ? host : null }, alert: m => alerts.push(m) });
  await tick();
  assert.match(host.innerHTML, /<div class="alert-name">⚡ 연구\(클로드\) · 매수·매도<\/div>/); assert.match(host.innerHTML, /매일 아침 08:00 연구 리포트도 보냅니다/);
  host.btn.on(); await tick();
  assert.match(host.innerHTML, /data-a="off"/);
  host.btn.off(); await tick();
  assert.deepEqual(alerts, ["연구(클로드) 매수·매도 알림을 켰습니다.", "연구(클로드) 알림 설정 실패: 거절"]);
  assert.ok(!/단타/.test(host.innerHTML + alerts.join("")));
});
t("오늘 탭 전일·당일 칸(밤 확정 전 값): ① 마감 장부·장중 요약 · ② 밤 계산과 같은 식(10/13 −5.953%) · ③ 업비트 하루 · ④ SOXL 세션 → 한국 다음 날 칸", () => {
  // 날짜 도우미 — 10/12(월) 직전 거래일은 10/8(10/9 한글날 · 주말)
  assert.equal(LV.addDays("2026-10-14", -1), "2026-10-13"); assert.equal(LV.prevKrDay("2026-10-14"), "2026-10-13"); assert.equal(LV.prevKrDay("2026-10-12"), "2026-10-08");
  // ① 마감 장부(VTS 체결) — 메인 종목 균등 평균 · 미청산은 시세 평가로 '진행' · 거래 없으면 매매 없음
  const c1 = LV.openingClosedCell({ status: "closed", trades: [{ pnlPct: -3.49 }, { pnlPct: 1.72 }], open: [] });
  near(c1.v, -0.885); assert.deepEqual([c1.final, c1.src, c1.trades, c1.wins, c1.losses], [true, "vts", 2, 1, 1]);
  const c1o = LV.openingClosedCell({ status: "closed", trades: [{ pnlPct: 1 }], open: [{ pnlPct: -2 }] });
  near(c1o.v, -0.5); assert.equal(c1o.final, false); assert.match(c1o.note, /매도 미체결 1건/);
  assert.equal(LV.openingClosedCell({ status: "closed", trades: [], open: [], note: "매매 없음 — x" }).v, "no_trade");
  assert.equal(LV.openingClosedCell({ status: "holiday" }).v, "holiday"); assert.equal(LV.openingClosedCell(null), null);
  // ① 오늘 — 휴장 · 마감 장부 우선 · 08:56 판단 전은 모름 · 매매일 아님 · 장중 요약(+10.75%, 2건)
  assert.equal(LV.openingTodayCell(null, null, true).v, "holiday");
  near(LV.openingTodayCell({ decision: {}, today: { tabPct: 9, trades: 1 } }, { status: "closed", trades: [{ pnlPct: 2 }] }, false).v, 2);
  assert.equal(LV.openingTodayCell({ decision: null, today: { tabPct: 0, trades: 0, noTrade: true } }, null, false), null);
  const nt1 = LV.openingTodayCell({ decision: {}, today: { noTrade: true, why: "메인 매매일 아님" } }, null, false);
  assert.deepEqual([nt1.v, nt1.final, nt1.note], ["no_trade", true, "메인 매매일 아님"]);
  const lv1 = LV.openingTodayCell({ decision: {}, today: { tabPct: 10.75, trades: 2, wins: 2, losses: 0 } }, null, false);
  assert.deepEqual([lv1.v, lv1.final, lv1.trades], [10.75, false, 2]);
  // ② 실제 10/12 → 10/13: 15:21 신호(예상 7185) · 모의투자 매수 실패(현금 부족) → 규칙대로 10/12 종가 7175 → 10/13 시가 6760, 비용 0.03%+2틱
  const buy = { etf_buy: { signal: true, quote: { expectedPrice: 7185 } }, etf_reconcile: { fills: { closeBuy: { qty: 0 }, openSell: { qty: 0 } } } };
  const e2 = LV.etfDayCell(buy, {}, { buyClose: 7175, sellOpen: 6760 }, false);
  near(e2.v, (6760 / 7175 - 1) * 100 - (0.03 + 2 * 5 / 7175 * 100)); near(e2.v, -5.953344947735195);         // 밤 계산 장부와 같은 값
  assert.deepEqual([e2.final, e2.src, e2.trades], [true, "rule", 1]); assert.match(e2.note, /모의투자 매수 안 됨/);
  assert.deepEqual(LV.etfDayCell({ etf_buy: { signal: false } }, {}, { buyClose: 7000, sellOpen: 6935 }, false).v, "no_trade");   // 10/13 신호 없음 → 10/14 매매 없음
  assert.equal(LV.etfDayCell(buy, {}, { buyClose: 7175 }, false), null);                                 // 시가 전
  assert.equal(LV.etfDayCell(null, {}, { buyClose: 7175, sellOpen: 6760 }, false), null);                 // 매수일 판단 기록 없음
  assert.equal(LV.etfDayCell(null, null, null, true).v, "holiday");
  const filled = { etf_buy: { signal: true }, etf_reconcile: { fills: { closeBuy: { qty: 10, avgPrice: 7180 } } } };
  near(LV.etfDayCell(filled, {}, { sellOpen: 7300 }, false).v, (7300 / 7180 - 1) * 100 - (0.03 + 2 * 5 / 7180 * 100));   // 종가 없으면 체결가
  assert.match(LV.etfDayCell(filled, {}, { sellOpen: 7300 }, false).note, /매수일 종가 대신 체결가/);
  // ③ 업비트 하루 10/13(10/13 09:00 ~ 10/14 09:00): 오르는 추세 · 10/12 고가 125 를 11:00 봉이 돌파 → 마지막 봉 130 에 매도
  const P = { ma: 20, stopPct: 5, level: "prevhigh", k: 0.5, hiN: 1, lastEntryHour: null, tabSize: 0.8, markets: ["KRW-BTC", "KRW-ETH"] };
  const day = i => LV.addDays("2026-10-14", -i);
  const daily = Array.from({ length: 26 }, (_, i) => ({ candle_date_time_kst: day(i) + "T09:00:00", opening_price: 100, trade_price: 125 - i, high_price: 125 - i + (i === 2 ? 1 : 0), low_price: 90 }));
  daily[2].high_price = 125;                                                                                // 10/12 고가 = 돌파 기준선
  const hour = (d, h) => d + "T" + String(h).padStart(2, "0") + ":00:00";
  const bars = [];
  for (let k = 0; k < 24; k++) { const h = (9 + k) % 24, d = k < 15 ? "2026-10-13" : "2026-10-14";
    bars.push({ candle_date_time_kst: hour(d, h), opening_price: k < 2 ? 120 : 124, high_price: k < 2 ? 121 : 131, low_price: k < 2 ? 119 : 123, trade_price: k === 23 ? 130 : 126 }); }
  const coins = ["KRW-BTC", "KRW-ETH"].map(m => ({ market: m, daily, hourly: bars.slice().reverse() }));
  const at = s => Date.parse(s + "+09:00");
  const fin = LV.coinDayCell("2026-10-13", coins, P, at("2026-10-14T10:30:00"));
  const pnl = (130 / (125 * 1.0005) - 1) * 100 - 0.14;
  near(fin.v, pnl * 0.8); assert.deepEqual([fin.final, fin.trades, fin.src], [true, 2, "rule"]);
  const mid = LV.coinDayCell("2026-10-13", coins, P, at("2026-10-13T15:30:00"));                           // 진행 중 — 15:00 봉 종가 126 으로 평가
  near(mid.v, ((126 / (125 * 1.0005) - 1) * 100 - 0.14) * 0.8); assert.equal(mid.final, false);
  assert.equal(LV.coinDayCell("2026-10-13", coins, P, at("2026-10-13T08:59:00")), null);                    // 시작 전
  assert.equal(LV.coinDayCell("2026-10-13", coins.map(c => ({ ...c, hourly: c.hourly.slice(0, 20) })), P, at("2026-10-14T10:30:00")), null);   // 끝난 하루인데 봉 부족
  const flat = LV.coinDayCell("2026-10-13", coins.map(c => ({ ...c, hourly: c.hourly.map(b => ({ ...b, high_price: 124 })) })), P, at("2026-10-14T10:30:00"));
  assert.deepEqual([flat.v, flat.final], ["no_trade", true]); assert.equal(flat.note, "BTC·ETH 돌파 없음");
  // ④ SOXL: 밤 판단(10/12 종가 128.40 · 보유) 다음 세션 10/13 종가 127.57 → 한국 10/14 칸 = −0.6464% × 칸 자금(밤 계산 SOXL 칸과 같은 값)
  const nx = { basedOn: "2026-10-12", close: 128.39999389648438, action: null, holding: true };
  const q4 = { ohlc: [{ date: "2026-10-12", open: 130, close: 128.4 }, { date: "2026-10-13", open: 126, close: 127.56999969482422 }], price: 127.56999969482422, marketState: "POST" };
  const s4 = LV.soxlDayCell(nx, q4, 0.5);
  assert.equal(s4.date, "2026-10-14"); near(s4.cell.v / 0.5, -0.6464129603692137); assert.equal(s4.cell.final, true);
  const r4 = LV.soxlDayCell(nx, { ...q4, price: 130, marketState: "REGULAR" }, 0.5);
  near(r4.cell.v, ((130 / 128.39999389648438 - 1) * 100) * 0.5); assert.equal(r4.cell.final, false);         // 정규장 중 — 진행
  near(LV.soxlDayCell({ ...nx, action: "buy", holding: false }, q4, 0.5).cell.v, ((127.56999969482422 / 126 - 1) * 100 - 0.1) * 0.5);
  const sl = LV.soxlDayCell({ ...nx, action: "sell" }, { ...q4, marketState: "REGULAR" }, 0.5);
  near(sl.cell.v, ((126 / 128.39999389648438 - 1) * 100 - 0.1) * 0.5); assert.equal(sl.cell.final, true);    // 시가 매도는 장중에도 끝난 값
  assert.equal(LV.soxlDayCell({ ...nx, basedOn: "2026-10-13" }, q4, 0.5), null);                             // 밤 계산이 이미 확정한 세션
  assert.equal(LV.soxlDayCell({ ...nx, holding: false }, q4, 0.5).cell.v, "no_trade");
});
t("매일 08:00 연구 리포트: 머리말 [클로드 연구 리포트] · 글 길이 · 링크 고정(/claude) · Worker /push-report 는 감시키 · 같은 날 한 번 · 웹 알림 + 텔레그램(op=report) · 거절만 3번 · 모름은 한 번", async () => {
  await Promise.all(pending.slice());                                         // 전역 fetch 를 바꾸므로 앞 시험이 다 끝난 뒤에
  const ok = PU.reportMsg({ date: "2026-10-15", title: "[클로드 연구 리포트] 10/15", push: "① −1.12%", text: "[클로드 연구 리포트] 10/15\n…", url: "https://evil.test" });
  assert.deepEqual([ok.ok, ok.id, ok.url, ok.tag], [true, "report:2026-10-15", "/claude", "claude-report"]);   // 받은 글의 링크는 쓰지 않는다
  for (const bad of [{ title: "연구 리포트" }, { text: "리포트" }, { push: "" }, { push: "x".repeat(301) }, { text: "[클로드 연구 리포트]" + "x".repeat(3500) }, { date: "10/15" }])
    assert.equal(PU.reportMsg({ date: "2026-10-15", title: "[클로드 연구 리포트] 10/15", push: "p", text: "[클로드 연구 리포트] t", ...bad }).ok, false, JSON.stringify(bad).slice(0, 40));
  const fs = await import("node:fs"), os = await import("node:os");
  let src = fs.readFileSync(process.env.JKQ_WORKER_SRC || new URL("../worker/opening-scheduler/src/index.js", import.meta.url), "utf8");
  src = src.replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}")
    .replace(/"\.\.\/\.\.\/\.\.\/functions\/api\/([^"]+)"/g, (_, f) => JSON.stringify(pathToFileURL(path.join(dir, f)).href));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wk-")), "worker.mjs"); fs.writeFileSync(tmp, src);
  const W = await import(pathToFileURL(tmp).href);
  const mem = new Map(); let alarmAt = null;
  const env = { MONITOR_KEY: "mk", BASE_URL: "https://pages.test", SIGNAL_STORE: { idFromName: n => n, get: () => ({ fetch: (u, i) => store.fetch(new Request(u, i)) }) } };
  const store = new W.OpeningSignalStore({ storage: { get: async k => mem.get(k), put: async (k, v) => { mem.set(k, v); }, getAlarm: async () => alarmAt, setAlarm: async t => { alarmAt = t; } } }, env);
  const ua = nodeCrypto.createECDH("prime256v1"); ua.generateKeys();
  const sub = { endpoint: "https://push.test/s1", keys: { p256dh: PU.b64u(ua.getPublicKey()), auth: PU.b64u(nodeCrypto.randomBytes(16)) } };
  const posts = [], tgs = [], oldFetch = globalThis.fetch; let tgReplies = [];
  globalThis.fetch = async (u, init = {}) => {
    u = String(u);
    if (u.startsWith("https://push.test/")) { posts.push(u); return new Response("", { status: 201 }); }
    if (u.endsWith("/api/claude-telegram")) { const b = JSON.parse(init.body); assert.equal(b.op, "report"); assert.equal(init.headers["x-monitor-key"], "mk"); tgs.push(b.text);
      const r = tgReplies.shift() || { ok: true }; return new Response(JSON.stringify(r), { status: r.ok ? 200 : 502 }); }
    throw new Error("unexpected fetch " + u);
  };
  try {
    const call = (p, body, key = "mk") => W.default.fetch(new Request("https://w.test" + p, { method: "POST", headers: { "x-monitor-key": key }, body: JSON.stringify(body) }), env).then(async r => ({ status: r.status, j: await r.json() }));
    await call("/push-subscribe", { subscription: sub });
    const rep = d => ({ date: d, title: "[클로드 연구 리포트] " + d.slice(5), push: "① −1.12% · ② 매매 없음 · 연구 R5", text: "[클로드 연구 리포트] " + d.slice(5) + "\n① …\n자세히: jkquant.pages.dev/claude" });
    assert.equal((await call("/push-report", rep("2026-10-15"), "bad")).status, 401);                  // 감시키 없이는 못 씀
    assert.equal((await call("/push-report", { ...rep("2026-10-15"), title: "연구 리포트" })).status, 400);
    assert.deepEqual([posts.length, tgs.length], [0, 0]);
    const r1 = await call("/push-report", rep("2026-10-15"));
    assert.equal(r1.status, 200); assert.equal(r1.j.id, "report:2026-10-15"); assert.equal(r1.j.push.subs, 1); assert.deepEqual(r1.j.telegram, { result: "sent", tries: 1 });
    assert.deepEqual(posts, ["https://push.test/s1"]); assert.deepEqual(tgs, [rep("2026-10-15").text]);
    const r2 = await call("/push-report", rep("2026-10-15"));                                          // 같은 날 다시 불러도 안 보냄
    assert.equal(r2.j.duplicate, true); assert.deepEqual([posts.length, tgs.length], [1, 1]);
    tgReplies = [1, 2, 3].map(() => ({ ok: false, definite: true, error: "거절" }));
    const r3 = await call("/push-report", rep("2026-10-16"));                                          // 텔레그램 거절은 3번까지
    assert.deepEqual([r3.j.telegram.result, r3.j.telegram.tries, tgs.length], ["fail", 3, 4]);
    tgReplies = [{ ok: false, error: "timeout" }];
    const r4 = await call("/push-report", rep("2026-10-17"));                                          // 보냈는지 모르면 다시 보내지 않음
    assert.deepEqual([r4.j.telegram.result, r4.j.telegram.tries, tgs.length], ["unknown", 1, 5]);
  } finally { globalThis.fetch = oldFetch; }
});
t("실시간 API 전체 실행(가짜 원천 · 10/14 09:41 KST): 200 · 탭마다 days 칸 — ① 어제 마감 장부 −0.885 · 오늘 장중 +7.27 / ② 어제 −5.953 · 오늘 매매 없음 / ③ 메인 바뀐 날도 어제·오늘 칸(BTC+ETH → ETH) / ④ 밤 계산 확정분 없음", async () => {
  await Promise.all(pending.slice());                                         // 전역 fetch · 시계를 바꾸므로 앞 시험이 다 끝난 뒤에
  const oldFetch = globalThis.fetch, oldNow = Date.now, NOW = Date.parse("2026-10-14T09:41:00+09:00");
  const W = "https://jkquant-opening-scheduler.mumae4.workers.dev", RAWB = "https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
  const ev = (stage, payload) => ({ stage, payload });
  const GAP = {
    "2026-10-14": { events: [ev("preopen", { picks: [{ code: "000001", name: "가", expectedPrice: 1000, expectedGapPct: -5 }, { code: "000002", name: "나", expectedPrice: 2000, expectedGapPct: -4 }],
      orders: [{ side: "buy", code: "000001", vts: { ok: true } }, { side: "buy", code: "000002", vts: { ok: true } }], breadth: { qualified: 30 } })] },
    "2026-10-13": { events: [ev("etf_buy", { signal: false, dropPct: -2.44 }), ev("etf_reconcile", { fills: { closeBuy: { qty: 0 }, openSell: { qty: 0 } } })] },
    "2026-10-12": { events: [ev("etf_buy", { signal: true, quote: { expectedPrice: 7185 } }), ev("etf_reconcile", { fills: { closeBuy: { qty: 0 }, openSell: { qty: 0 } } })] } };
  const CLOSE = { "2026-10-13": { events: [{ id: "close:opening", payload: { status: "closed", trades: [{ pnlPct: -3.49 }, { pnlPct: 1.72 }], open: [] } }] } };
  const Q = { "000001": { price: 1100, ohlc: [] }, "000002": { price: 2100, ohlc: [] },
    "233740": { price: 6900, ohlc: [{ date: "2026-10-12", open: 7900, close: 7175 }, { date: "2026-10-13", open: 6760, close: 7000 }, { date: "2026-10-14", open: 6935, close: 6900 }] },
    SOXL: { price: 127.57, marketState: "CLOSED", ohlc: [{ date: "2026-10-13", open: 126, close: 127.57 }] } };
  const day = i => LV.addDays("2026-10-14", -i);
  const daily = Array.from({ length: 30 }, (_, i) => ({ candle_date_time_kst: day(i) + "T09:00:00", opening_price: 100, trade_price: 100 + i, high_price: 101 + i, low_price: 99 }));   // 내림세 → 쉼
  const hourly = Array.from({ length: 48 }, (_, k) => { const d = new Date(NOW - k * 36e5 + 9 * 36e5).toISOString();          // 최신순 · 0 = 진행 중 09:00 봉
    return { candle_date_time_kst: d.slice(0, 13) + ":00:00", opening_price: 100, high_price: 101, low_price: 99, trade_price: 100 }; });
  const J = o => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (u) => {
    u = String(u);
    if (u.startsWith(W + "/claude-config")) return J({ ok: true, events: [{ tab: "crypto", version: "g_coin_ma15_s99_hi7_eth", effectiveFrom: "2026-10-14", promotedAt: "2026-10-12T19:18:16Z",
      params: { ma: 15, stopPct: 99, level: "prevhigh", k: 0.5, hiN: 7, lastEntryHour: null, tabSize: 0.8, markets: ["KRW-ETH"] } }] });   // 실제 승격 기록 — 10/14 부터 ETH 만
    if (u.startsWith(W + "/gapdown?date=")) return J({ ok: true, ledger: GAP[u.split("date=")[1]] || { events: [] } });
    if (u.startsWith(W + "/claude?date=")) return J({ ok: true, ledger: CLOSE[u.split("date=")[1]] || { events: [] } });
    if (u.includes("/api/quote?symbol=")) { const sym = decodeURIComponent(u.split("symbol=")[1].split("&")[0]); return Q[sym] ? J(Q[sym]) : new Response("{}", { status: 404 }); }
    if (u.includes("api.upbit.com/v1/ticker")) return J([{ market: "KRW-BTC", trade_price: 100 }, { market: "KRW-ETH", trade_price: 100 }]);
    if (u.includes("api.upbit.com/v1/candles/days")) return J(daily);
    if (u.includes("api.upbit.com/v1/candles/minutes/60")) return J(hourly);
    if (u.startsWith(RAWB + "claude-lab/latest.json")) return J({ tabs: { soxl: { nextSignal: { basedOn: "2026-10-13", close: 127.57, action: null, holding: true, heldDays: 6, rsi2: 0, ma: 121 } } } });
    if (u.startsWith(RAWB + "claude-lab/soxl-mr-decisions.csv")) return new Response("date,strategyVersion,action,pnlPct\n2026-10-13,v1,hold,-0.646\n");
    throw new Error("unexpected fetch " + u);
  };
  Date.now = () => NOW;
  try {
    const r = await LV.onRequestGet({ request: new Request("https://p.test/api/claude-live", { headers: { "x-monitor-key": "k" } }), env: { OPENING_MONITOR_KEY: "k" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j).slice(0, 300)); assert.equal(j.today, "2026-10-14");
    const D = k => j.tabs[k].days;
    near(D("opening")["2026-10-13"].v, -0.885); assert.equal(D("opening")["2026-10-13"].src, "vts");
    near(D("opening")["2026-10-14"].v, ((10 - 0.23) + (5 - 0.23)) / 2); assert.equal(D("opening")["2026-10-14"].final, false);
    near(D("daytrading")["2026-10-13"].v, -5.953344947735195); assert.equal(D("daytrading")["2026-10-14"].v, "no_trade");
    assert.deepEqual([D("crypto")["2026-10-13"].v, D("crypto")["2026-10-13"].final, D("crypto")["2026-10-14"].final, D("crypto")["2026-10-14"].decided], ["no_trade", true, true, true]);   // 오늘도 쉼 — 더 살 수 없어 끝난 값
    assert.equal(D("crypto")["2026-10-13"].note, "BTC·ETH 쉼(추세 평균 아래)");                      // 어제는 그 전 메인(BTC+ETH) — BTC 봉도 받았다
    assert.equal(D("crypto")["2026-10-14"].note, "ETH 쉼(추세 평균 아래)");                           // 오늘은 새 메인(ETH 만)
    assert.deepEqual(j.tabs.crypto.rows.map(x => x.code), ["KRW-ETH"]);                                 // 탭 표시는 지금 메인 코인만(칸 계산용 BTC 는 안 섞음)
    assert.deepEqual(D("soxl"), {});                                                   // 10/13 세션은 밤 계산이 이미 확정 — 실시간 칸 없음
    assert.ok(Array.isArray(j.tabs.opening.rows) && j.tabs.opening.rows.length === 2);   // 기존 응답(알림이 읽는 rows)은 그대로
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; }
});
t("텔레그램 엔드포인트: 실제 매수·매도(op=event, [클로드 연구 탭] 머리말)만 보냄 · 판단·주간·대결·교체·마감 결과는 보내지 않음 · 예외: 매일 08:00 연구 리포트(op=report, [클로드 연구 리포트])", async () => {
  await Promise.all(pending.slice());                                         // 전역 fetch 를 바꾸므로 앞 시험이 다 끝난 뒤에(파일 맨 끝)
  const old = globalThis.fetch, sentTexts = [];
  globalThis.fetch = async (u, init = {}) => {
    if (String(u).includes("api.telegram.org")) { sentTexts.push(JSON.parse(init.body).text); return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } })); }
    throw new Error("unexpected fetch " + u);
  };
  const env = { OPENING_MONITOR_KEY: "k", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" };
  const post = b => TG.onRequestPost({ request: new Request("https://p.test/api/claude-telegram", { method: "POST", headers: { "x-monitor-key": "k" }, body: JSON.stringify(b) }), env }).then(async r => ({ status: r.status, j: await r.json() }));
  try {
    const ok = await post({ op: "event", text: "[클로드 연구 시초가] 🟢 매수\n가 — 08:59" });
    assert.equal(ok.status, 200); assert.equal(ok.j.messageId, 7); assert.deepEqual(sentTexts, ["[클로드 연구 시초가] 🟢 매수\n가 — 08:59"]);
    const bad = await post({ op: "event", text: "🟢 ① 시초가 매수" });                                // 머리말 없는 글은 거절(정의된 실패)
    assert.equal(bad.status, 400); assert.equal(bad.j.definite, true);
    for (const b of [{ kind: "preopen", date: "2026-10-13" }, { kind: "etfbuy", date: "2026-10-13" }, { kind: "weekly", date: "2026-10-17" },
                     { kind: "duel", date: "2026-10-13" }, { kind: "promote", date: "2026-10-13", event: { tab: "crypto" } }, { op: "send", strategy: "opening", date: "2026-10-13", result: {} }]) {
      const r = await post(b); assert.equal(r.status, 200); assert.equal(r.j.skipped, "buy_sell_only", JSON.stringify(b));
    }
    assert.equal(sentTexts.length, 1);                                                                // 매수·매도 말고는 하나도 안 보냄
    const rp = await post({ op: "report", text: "[클로드 연구 리포트] 10/15\n① 시초가 …" });              // 사용자 요청(2026-10-14) 매일 08:00 리포트
    assert.equal(rp.status, 200); assert.equal(sentTexts.length, 2); assert.ok(sentTexts[1].startsWith("[클로드 연구 리포트] 10/15"));
    const rb = await post({ op: "report", text: "연구 리포트 10/15" });                                  // 머리말 없으면 거절(정의된 실패)
    assert.equal(rb.status, 400); assert.equal(rb.j.definite, true); assert.equal(sentTexts.length, 2);
    assert.equal((await post({ op: "nope" })).status, 400);
  } finally { globalThis.fetch = old; }
});
await Promise.all(pending);
console.log(`opening gap-down JS: ${n} ALL PASS`);
