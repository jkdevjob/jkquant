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
t("웹 알림: 매수·매도 때만 · 같은 알림 id · ③ 다음 날 09:00 매도 · 손절은 매도 알림 안 함", () => {
  const now = Date.parse("2026-10-07T10:30:00+09:00");                       // 업비트 하루 10/7 · 어제 10/6
  const live = { today: "2026-10-07", tabs: {
    opening: { rows: [{ name: "가", status: "보유중", expectedGapPct: -5.2 }, { name: "나", status: "주문 실패" },
                      { name: "다", status: "청산", realized: true, pnlPct: 2.0 }, { name: "라", status: "청산", realized: true, pnlPct: -1.0 }] },
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
  assert.equal(by["open:2026-10-07:buy"].body, "가 (갭 -5.20%) · 다 · 라 — 08:59 동시호가 · 주문 실패 1종목");   // 주문 실패는 매수로 안 셈
  assert.equal(by["open:2026-10-07:sell"].body, "다 +2.00% · 라 -1.00% · 평균 +0.50%");
  assert.equal(by["coin:2026-10-06:KRW-BTC:sell"].body, "BTC 09:00 매도(어제 돌파분) 약 +9.86%");      // 121/110 − 1 − 비용 0.14
  assert.equal(by["coin:2026-10-07:KRW-BTC:buy"].price, 120000000);                                 // 다음 날 매도 알림이 쓸 매수가
  assert.ok(!ids.includes("coin:2026-10-06:KRW-ETH:sell"));                                          // 어제 손절한 코인은 09:00 매도 없음
  assert.deepEqual(PU.pushEvents({ today: "2026-10-07", tabs: { opening: { rows: [{ name: "가", status: "주문 실패" }] }, daytrading: { rows: [{ status: "매매 없음" }] },
    crypto: { rows: [{ code: "KRW-BTC", hold: false }] }, soxl: { rows: [{ status: "쉼 — RSI(2) 80 ≥ 20" }] } } }, now, {}), []);   // 매매 없는 날은 알림 없음
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
t("worker 웹 알림: 5분 감시가 새 매수·매도만 한 번 보냄 · 사라진 구독은 지움 · 알림 감시는 장 일정과 따로 · 경로는 감시키", async () => {
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
  let live = { ok: true, today: "2026-10-07", tabs: { opening: { rows: [{ name: "가", status: "보유중" }] }, daytrading: { rows: [] }, crypto: { rows: [] }, soxl: { rows: [] } } };
  const posts = [], oldFetch = globalThis.fetch;
  globalThis.fetch = async (u, init = {}) => {
    u = String(u);
    if (u.endsWith("/api/claude-live")) { assert.equal(init.headers["x-monitor-key"], "mk"); return new Response(JSON.stringify(live)); }
    if (u.startsWith("https://push.test/")) { posts.push(u); return new Response("", { status: u.endsWith("gone") ? 410 : 201 }); }
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
    posts.length = 0;
    assert.equal((await W.claudePushWatch(env, now + 3e5)).fresh || 0, 0); assert.deepEqual(posts, []);   // 같은 매수는 다시 안 보냄
    live.tabs.opening.rows[0] = { name: "가", status: "청산", realized: true, pnlPct: 1.2 };
    alarmAt = null;
    await store.alarm();                                                                              // 저장소 알람이 감시를 돌리고 다음 5분 알람을 다시 건다
    assert.deepEqual(posts, ["https://push.test/s1"]);                                                // 매수는 이미 보냄 — 새로 생긴 매도 한 건만
    assert.ok(alarmAt > Date.now() && alarmAt % 3e5 === 0);
    live = null; posts.length = 0; alarmAt = null;
    await store.alarm();                                                                              // 감시가 실패해도(자료 없음) 다음 알람은 꼭 건다
    assert.ok(alarmAt > Date.now()); assert.deepEqual(posts, []);
  } finally { globalThis.fetch = oldFetch; }
  assert.equal(W.nextPushAt(Date.UTC(2026, 9, 7, 0, 3, 10)), Date.UTC(2026, 9, 7, 0, 5));
  assert.equal(W.nextPushAt(Date.UTC(2026, 9, 7, 0, 5)), Date.UTC(2026, 9, 7, 0, 10));
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
