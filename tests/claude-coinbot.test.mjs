// ③ 실투자 봇(bots/claude-coinbot) · 기록 엔드포인트(/api/claude-coinbot) · Worker /claude-real 값 시험.
// 가짜 업비트는 봇 코드와 따로 JWT(HS512) 서명 · query_hash 를 검사하고, identifier 를 한 번만 받는다(실제 업비트 규칙).
// 변이 시험(scripts/mutation_test_claude_coinbot.py)은 JKQ_COINBOT_ROOT 로 고친 사본을 가리킨다.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = process.env.JKQ_COINBOT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = p => import(pathToFileURL(path.join(ROOT, p)).href);
const B = await imp("bots/claude-coinbot/bot.mjs");
const LV = await imp("functions/api/claude-live.js");
const R = await imp("functions/api/_claude_real.js");
const EP = await imp("functions/api/claude-coinbot.js");

const ACCESS = "test-access-key", SECRET = "test-secret-key-0123456789";
const PIN = [{ tab: "crypto", version: "g_coin_ma15_s99_hi7_eth", effectiveFrom: "2026-10-14", promotedAt: "2026-10-12T19:18:16Z",
  params: { ma: 15, stopPct: 99, level: "prevhigh", k: 0.5, hiN: 7, lastEntryHour: null, tabSize: 0.8, markets: ["KRW-ETH"] } }];

// 봇과 따로 만든 검사 — 업비트 문서: Bearer JWT · HS512 · query_hash = SHA512(인코딩 안 한 쿼리 · POST 는 본문 key=value&)
function verifyJwt(auth, query, seen) {
  assert.ok(String(auth || "").startsWith("Bearer "), "Bearer 없음");
  const [h, p, s] = auth.slice(7).split(".");
  assert.equal(s, crypto.createHmac("sha512", SECRET).update(h + "." + p).digest("base64url"), "서명 불일치");
  const head = JSON.parse(Buffer.from(h, "base64url").toString()), pay = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(head.alg, "HS512"); assert.equal(pay.access_key, ACCESS);
  assert.match(pay.nonce, /^[0-9a-f-]{36}$/); assert.ok(!seen.has(pay.nonce), "nonce 재사용"); seen.add(pay.nonce);
  if (query) { assert.equal(pay.query_hash, crypto.createHash("sha512").update(query).digest("hex")); assert.equal(pay.query_hash_alg, "SHA512"); }
  else assert.equal(pay.query_hash, undefined);
}
class FakeUpbit {
  constructor(o) { Object.assign(this, { krw: 1_000_000, eth: 0, fee: 0.0005, orders: [], used: new Set(), posts: [], nonces: new Set(), failPost: null }, o); this.high = this.open = this.px; }
  tick(px) { this.px = px; this.high = Math.max(this.high, px); }
  fetch = async (url, init = {}) => {
    const u = new URL(url), p = u.pathname, method = init.method || "GET";
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { date: new Date().toUTCString() } });
    if (p === "/v1/ticker") return J([{ market: "KRW-ETH", trade_date: this.day.replace(/-/g, ""), trade_price: this.px, high_price: this.high, opening_price: this.open }]);
    if (p === "/v1/candles/days") return J(this.candles.slice(0, +u.searchParams.get("count")));
    const body = init.body ? JSON.parse(init.body) : null;
    verifyJwt(init.headers.Authorization, method === "GET" ? u.search.slice(1) : Object.entries(body).map(([k, v]) => k + "=" + v).join("&"), this.nonces);
    if (p === "/v1/accounts") return J([{ currency: "KRW", balance: String(this.krw), locked: "0" }, { currency: "ETH", balance: String(this.eth), locked: "0" }]);
    if (p === "/v1/orders/chance") return J({ bid_fee: String(this.fee), ask_fee: String(this.fee) });
    if (p === "/v1/order") {
      const id = u.searchParams.get("uuid"), ident = u.searchParams.get("identifier");
      const o = this.orders.find(x => (id ? x.uuid === id : x.identifier === ident));
      return o ? J(o) : J({ error: { name: "order_not_found" } }, 404);
    }
    if (p === "/v1/orders" && method === "POST") {
      this.posts.push(body);
      if (this.onPost) this.onPost(body);
      if (this.failPost === "throw") throw new Error("network down");
      if (this.failPost && this.failPost.status) return J({ error: { name: this.failPost.name } }, this.failPost.status);
      if (this.used.has(body.identifier)) return J({ error: { name: "duplicated_identifier" } }, 400);
      this.used.add(body.identifier);
      let o;
      if (body.side === "bid") {
        const amt = +body.price, fee = amt * this.fee;
        if (amt < 5000) return J({ error: { name: "under_min_total_bid" } }, 400);
        if (amt + fee > this.krw) return J({ error: { name: "insufficient_funds_bid" } }, 400);
        const vol = amt / this.px; this.krw -= amt + fee; this.eth += vol;
        o = { uuid: crypto.randomUUID(), side: "bid", state: "cancel", identifier: body.identifier, paid_fee: String(fee), trades: [{ price: String(this.px), volume: String(vol), funds: String(amt) }] };
        if (this.zeroFill) { this.krw += amt + fee; this.eth -= vol; o = { ...o, paid_fee: "0", trades: [] }; }
      } else {
        const vol = +body.volume;
        if (vol > this.eth + 1e-12) return J({ error: { name: "insufficient_funds_ask" } }, 400);
        const funds = vol * this.px, fee = funds * this.fee; this.eth -= vol; this.krw += funds - fee;
        o = { uuid: crypto.randomUUID(), side: "ask", state: "done", identifier: body.identifier, paid_fee: String(fee), trades: [{ price: String(this.px), volume: String(vol), funds: String(funds) }] };
      }
      this.orders.push(o);
      if (this.failPost === "throw-after") throw new Error("timeout after send");
      const { trades, ...pub } = o;
      return J({ ...pub, state: "wait" }, 201);
    }
    throw new Error("unexpected " + method + " " + p);
  };
}
// 업비트 일봉(최신순) — D(진행 중) + 확정 n일. closes/highs: 오래된 순
function dayCandles(D, closes, highs, todayOpen) {
  const out = [{ candle_date_time_kst: D + "T09:00:00", opening_price: todayOpen, high_price: todayOpen, low_price: todayOpen, trade_price: todayOpen }];
  for (let i = closes.length - 1; i >= 0; i--) {
    const d = B.addDays(D, -(closes.length - i));
    out.push({ candle_date_time_kst: d + "T09:00:00", opening_price: closes[i], high_price: highs[i], low_price: closes[i] * 0.97, trade_price: closes[i] });
  }
  return out;
}
const UP = Array.from({ length: 20 }, (_, i) => 2_800_000 + i * 10_000), DOWN = Array.from({ length: 20 }, (_, i) => 3_200_000 - i * 10_000);
function setup({ closes = UP, krw = 1_000_000, eth = 0, dry = false, events = PIN, paused = false, start = "2026-11-16T09:00:05+09:00", store = B.memoryStore(), report } = {}) {
  const D = B.upbitDay(Date.parse(start)), highs = closes.map(c => Math.round(c * 1.01)), last = closes[closes.length - 1];
  const ex = new FakeUpbit({ krw, eth, day: D, px: last, candles: dayCandles(D, closes, highs, last) });
  const s = { ex, D, store, reports: [], now: Date.parse(start), level: Math.max(...highs.slice(-7)), closes, highs, paused };
  s.bot = new B.Bot({ api: B.upbitClient({ accessKey: ACCESS, secretKey: SECRET, fetchImpl: ex.fetch }), store,
    report: report || (async m => { s.reports.push(m); return { ok: true, recorded: true, fresh: true, telegram: "sent" }; }),
    now: () => s.now, mainConfig: async () => ({ ok: true, events }), paused: () => s.paused, env: { BUDGET_KRW: "600000", DRY_RUN: dry ? "1" : "0" }, sleep: async () => {} });
  s.at = t => { s.now = Date.parse(t); };
  // 다음 업비트 하루로 — 오늘 봉을 확정(고가 = 그날 최고 · 종가 = 지금)하고 새 봉을 연다
  s.nextDay = (t, open) => {
    s.closes = [...s.closes, s.ex.px]; s.highs = [...s.highs, s.ex.high];
    s.at(t); s.D = B.upbitDay(s.now); s.ex.day = s.D; s.ex.open = s.ex.high = s.ex.px = open;
    s.ex.candles = dayCandles(s.D, s.closes, s.highs, open);
  };
  return s;
}
const ids = s => s.reports.filter(m => m.op === "report").map(m => m.id);

test("판단 — 실시간 화면과 같은 함수(coinHoldToday) · 그날 일봉 확인 · 고가가 기준을 '넘으면' · 늦게 본 돌파는 기준 +1% 까지만", () => {
  const D = "2026-11-16", highs = UP.map(c => Math.round(c * 1.01)), c = dayCandles(D, UP, highs, UP[19]);
  const plan = B.planOf(c, D), h = LV.coinHoldToday(c, B.STRATEGY.params);
  assert.deepEqual([plan.ready, plan.hold, plan.level, plan.prevClose, plan.basedOn], [true, true, h.level, h.prevClose, "2026-11-15"]);
  assert.equal(plan.level, Math.max(...highs.slice(-7)));
  assert.equal(B.planOf(c, "2026-11-17").ready, false);                                   // 일봉이 아직 그날로 안 넘어감 → 계획 없음
  assert.equal(B.planOf(dayCandles(D, DOWN, DOWN, DOWN[19]), D).hold, false);              // 어제 종가 < 15일 평균 → 쉼
  const tk = (px, hi, op = UP[19], day = "20261116") => ({ trade_date: day, trade_price: px, high_price: hi, opening_price: op });
  assert.equal(B.entryDecision(plan, tk(plan.level, plan.level)).buy, false);               // 같으면 안 산다(> 만)
  assert.equal(B.entryDecision(plan, tk(plan.level + 1, plan.level + 1)).buy, true);
  assert.equal(B.entryDecision(plan, tk(plan.level + 1, plan.level + 1, UP[19], "20261115")).buy, false);   // 시세가 전날
  const late = B.entryDecision(plan, tk(Math.ceil(plan.level * 1.0101), plan.level * 1.02));
  assert.deepEqual([late.buy, late.late], [false, true]);
  assert.equal(B.entryDecision(plan, tk(Math.floor(plan.level * 1.0099), plan.level * 1.02)).buy, true);
  const gap = B.entryDecision(plan, tk(plan.level * 1.025, plan.level * 1.03, plan.level * 1.02));   // 09:00 시가가 기준 위 — 연구 장부도 시가에 산다
  assert.deepEqual([gap.buy, gap.ref], [true, plan.level * 1.02]);
  assert.equal(B.entryDecision({ ...plan, hold: false }, tk(plan.level * 2, plan.level * 2)).buy, false);
});
test("금액 · 수량 · 메인 확인 · 쿼리 문자열", () => {
  assert.equal(B.buyAmount(600000, 1_000_000), 600000);
  assert.equal(B.buyAmount(600000, 300000), 299000);                                     // 수수료 자리를 남기고 1,000원 단위 내림
  assert.equal(B.buyAmount(600000, 600000), 599000);
  assert.equal(B.buyAmount(600000, 5000), 0);                                            // 최소 주문 5,000원 미만
  assert.equal(B.sellVolume(0.123456789, 1), 0.12345678);
  assert.equal(B.sellVolume(0.5, 0.2), 0.2);                                             // 잔고가 적으면 잔고만큼(산 것보다 더 팔지 않는다)
  assert.deepEqual(B.strategyCheck(PIN, "2026-11-16"), { ok: true, main: "g_coin_ma15_s99_hi7_eth" });
  const other = [...PIN, { ...PIN[0], version: "g_coin_ma5_s10_hi_both", effectiveFrom: "2026-11-12", params: { ...PIN[0].params, ma: 5, stopPct: 10, hiN: 1, markets: ["KRW-BTC", "KRW-ETH"] } }];
  assert.equal(B.strategyCheck(other, "2026-11-16").ok, false);
  assert.equal(B.strategyCheck(other, "2026-11-11").ok, true);
  assert.equal(B.strategyCheck([{ ...PIN[0], params: { ...PIN[0].params, stopPct: 10 } }], "2026-11-16").ok, false);   // 같은 이름 · 다른 변수도 안 산다
  assert.equal(B.queryOf({ market: "KRW-ETH", count: 18 }), "market=KRW-ETH&count=18");
  assert.throws(() => B.queryOf({ a: "x y" }));
});
test("돌파일 — 한 번만 시장가 매수(예산 60만 원 · identifier) → 다음 날 09:00 산 수량만 시장가 매도 · 기록 2건", async () => {
  const s = setup({ eth: 0.5 });                                                          // 계좌에 원래 있던 ETH 0.5 는 건드리지 않는다
  await s.bot.step();
  assert.equal(s.ex.posts.length, 0);
  s.at("2026-11-16T10:23:00+09:00"); s.ex.tick(s.level + 1000); await s.bot.step();
  assert.deepEqual(s.ex.posts, [{ market: "KRW-ETH", side: "bid", ord_type: "price", price: "600000", identifier: "jkq-c3-2026-11-16-buy" }]);
  const vol = 600000 / (s.level + 1000);
  assert.ok(Math.abs(s.bot.state.position.volume - vol) < 1e-12);
  s.at("2026-11-16T11:00:00+09:00"); s.ex.tick(s.level + 9000); await s.bot.step();
  s.at("2026-11-17T08:59:50+09:00"); await s.bot.step();
  assert.equal(s.ex.posts.length, 1);                                                    // 하루 한 번 · 09:00 전에는 팔지 않는다
  s.nextDay("2026-11-17T09:00:02+09:00", s.level + 5000); await s.bot.step();          // 새 기준(어제 고가 +9000)보다 아래에서 시작 — 팔기만
  assert.equal(s.ex.posts.length, 2);
  assert.deepEqual(s.ex.posts[1], { market: "KRW-ETH", side: "ask", ord_type: "market", volume: (Math.floor(vol * 1e8) / 1e8).toFixed(8), identifier: "jkq-c3-2026-11-16-sell" });
  assert.ok(Math.abs(s.ex.eth - 0.5) < 1e-7);
  assert.equal(s.bot.state.position, null);
  assert.deepEqual(ids(s), ["real:coin:2026-11-16:buy", "real:coin:2026-11-16:sell"]);
  const [b, x] = s.reports.filter(m => m.op === "report");
  assert.ok(b.text.startsWith(R.REAL_HEAD + "🟢 ETH 실투자 매수\n10:23 ") && x.text.startsWith(R.REAL_HEAD + "🔴 ETH 실투자 매도\n09:00 "));
  const cost = 600000 * 1.0005, gross = Math.floor(vol * 1e8) / 1e8 * (s.level + 5000), net = gross * (1 - 0.0005) - cost;
  assert.ok(Math.abs(x.payload.net - net) < 1e-6 && Math.abs(x.payload.pnlPct - net / cost * 100) < 1e-9, JSON.stringify(x.payload));
  assert.ok(R.realRecord(b).ok && R.realRecord(x).ok);
  s.at("2026-11-17T12:00:00+09:00"); s.ex.tick(s.level + 10000); await s.bot.step();   // 11/17 기준 = 어제 고가(+9000) — 넘음
  assert.equal(s.ex.posts.length, 3);                                                    // 새 날(11/17)은 새 신호 — 자기 identifier
  assert.equal(s.ex.posts[2].identifier, "jkq-c3-2026-11-17-buy");
});
test("쉬는 날 · 시험 모드 · 일시정지 · 메인 다름 — 주문 없음(일시정지에도 보유분 09:00 매도는 한다)", async () => {
  const rest = setup({ closes: DOWN });
  for (const t of ["09:00:05", "10:00:00", "15:00:00", "23:00:00"]) { rest.at("2026-11-16T" + t + "+09:00"); rest.ex.tick(rest.ex.px * 1.2); await rest.bot.step(); }
  assert.equal(rest.ex.posts.length, 0);
  const dry = setup({ dry: true });
  await dry.bot.step(); dry.at("2026-11-16T10:00:00+09:00"); dry.ex.tick(dry.level + 5000); await dry.bot.step();
  dry.nextDay("2026-11-17T09:00:02+09:00", dry.level); await dry.bot.step();
  assert.equal(dry.ex.posts.length, 0); assert.deepEqual(ids(dry), []);
  assert.equal(dry.reports.filter(m => /🧪 ETH 시험 — 실전이면 지금 (매수|매도)/.test(m.text)).length, 2);
  assert.ok(dry.ex.nonces.size === 0);                                                    // 시험 모드는 키를 쓰는 호출도 안 한다
  const p = setup({ paused: true });
  await p.bot.step(); p.at("2026-11-16T10:00:00+09:00"); p.ex.tick(p.level + 5000); await p.bot.step(); await p.bot.step();
  assert.equal(p.ex.posts.length, 0);
  assert.equal(p.reports.filter(m => /일시정지/.test(m.text)).length, 1);
  p.paused = false; p.bot.state.days["2026-11-16"].buy = undefined;
  const q = setup({ start: "2026-11-16T10:00:00+09:00" });
  q.ex.tick(q.level + 5000); await q.bot.step(); assert.equal(q.ex.posts.length, 1);
  q.paused = true; q.nextDay("2026-11-17T09:00:02+09:00", q.level + 9000); await q.bot.step();
  assert.equal(q.ex.posts.length, 2); assert.equal(q.ex.posts[1].side, "ask");
  const other = setup({ events: [...PIN, { ...PIN[0], version: "g_coin_ma5_s10_hi_both", effectiveFrom: "2026-11-15", params: { ...PIN[0].params, ma: 5 } }] });
  await other.bot.step(); other.at("2026-11-16T10:00:00+09:00"); other.ex.tick(other.level + 5000); await other.bot.step();
  assert.equal(other.ex.posts.length, 0);
  assert.equal(other.reports.filter(m => /③ 메인이 g_coin_ma5_s10_hi_both/.test(m.text)).length, 1);
});
test("보내기 전에 상태부터 저장 · 체결 0 은 보유가 아니다 · 기본은 시험 모드", async () => {
  const s = setup({ start: "2026-11-16T10:00:00+09:00" });
  const seen = [];
  s.ex.onPost = b => seen.push(b.side + ":" + s.store.peek().days["2026-11-16"][b.side === "bid" ? "buy" : "sell"].status);
  s.ex.tick(s.level + 1000); await s.bot.step();
  s.nextDay("2026-11-17T09:00:02+09:00", s.closes[0]); await s.bot.step();
  assert.deepEqual(seen, ["bid:sending", "ask:sending"]);                               // 꺼져도 다시 보내지 않게 — 보내는 순간 저장돼 있다
  const z = setup({ start: "2026-11-16T10:00:00+09:00" });
  z.ex.zeroFill = true; z.ex.tick(z.level + 1000); await z.bot.step(); await z.bot.step();
  assert.equal(z.bot.state.position, null); assert.equal(z.ex.posts.length, 1);
  assert.equal(z.bot.state.days["2026-11-16"].buy.status, "failed");
  assert.deepEqual(ids(z), ["real:coin:2026-11-16:error"]);
  assert.equal(new B.Bot({ api: null, store: B.memoryStore() }).dry, true);               // DRY_RUN 이 없으면 시험
  assert.equal(new B.Bot({ api: null, store: B.memoryStore(), env: { DRY_RUN: "false" } }).dry, true);   // "0" 만 실전
});
test("주문 실패 · 결과 모름 — 다시 내지 않는다(identifier 로 조회만) · 잃어버린 상태는 주문 기록으로 되살린다", async () => {
  const f = setup({ start: "2026-11-16T10:00:00+09:00" });
  f.ex.failPost = { status: 400, name: "insufficient_funds_bid" }; f.ex.tick(f.level + 1000);
  await f.bot.step(); f.at("2026-11-16T10:05:00+09:00"); await f.bot.step(); f.at("2026-11-16T15:00:00+09:00"); await f.bot.step();
  assert.equal(f.ex.posts.length, 1);
  assert.deepEqual(ids(f), ["real:coin:2026-11-16:error"]);
  assert.match(f.reports.find(m => m.id === "real:coin:2026-11-16:error").text, /매수 주문 실패\(400 insufficient_funds_bid\) · 자동으로 다시 내지 않음/);
  const a = setup({ start: "2026-11-16T10:00:00+09:00" });                             // 보냈는데 응답이 끊김 — 실제로는 들어감
  a.ex.failPost = "throw-after"; a.ex.tick(a.level + 1000); await a.bot.step();
  assert.equal(a.bot.state.days["2026-11-16"].buy.status, "unknown");
  a.ex.failPost = null; a.at("2026-11-16T10:00:20+09:00"); await a.bot.step();
  assert.equal(a.ex.posts.length, 1); assert.equal(a.bot.state.days["2026-11-16"].buy.status, "done");
  assert.ok(a.bot.state.position.volume > 0); assert.deepEqual(ids(a), ["real:coin:2026-11-16:buy"]);
  const n = setup({ start: "2026-11-16T10:00:00+09:00" });                             // 보내다 끊김 — 안 들어감
  n.ex.failPost = "throw"; n.ex.tick(n.level + 1000); await n.bot.step();
  n.ex.failPost = null; n.at("2026-11-16T10:01:00+09:00"); await n.bot.step();
  assert.equal(n.bot.state.days["2026-11-16"].buy.status, "unknown");                   // 2분 전에는 '안 들어갔다'고 정하지 않는다
  n.at("2026-11-16T10:02:30+09:00"); await n.bot.step(); n.at("2026-11-16T11:00:00+09:00"); await n.bot.step();
  assert.equal(n.ex.posts.length, 1); assert.equal(n.bot.state.days["2026-11-16"].buy.status, "failed");
  assert.deepEqual(ids(n), ["real:coin:2026-11-16:error"]);
  const l = setup({ start: "2026-11-16T10:00:00+09:00" });                             // 산 뒤 상태 파일을 잃음 → 새 봇이 identifier 로 되살려 다음 날 판다
  l.ex.tick(l.level + 1000); await l.bot.step();
  const vol = l.bot.state.position.volume;
  const l2 = new B.Bot({ api: B.upbitClient({ accessKey: ACCESS, secretKey: SECRET, fetchImpl: l.ex.fetch }), store: B.memoryStore(), report: async () => ({ ok: true }),
    now: () => l.now, mainConfig: async () => ({ ok: true, events: PIN }), env: { DRY_RUN: "0" }, sleep: async () => {} });
  l.at("2026-11-16T15:00:00+09:00"); await l2.init();
  assert.equal(l2.state.position.volume, vol); assert.equal(l2.state.position.day, "2026-11-16");
  await l2.step(); assert.equal(l.ex.posts.length, 1);                                  // 같은 날 다시 사지 않는다
  l.nextDay("2026-11-17T09:00:03+09:00", l.level); l2.now = () => l.now; await l2.step();
  assert.equal(l.ex.posts.length, 2); assert.equal(l.ex.posts[1].identifier, "jkq-c3-2026-11-16-sell");
});
test("09:00 — 어제 산 것을 먼저 팔고 오늘 돌파면 산다 · ETH 가 없으면(직접 팜) 팔지 않음 · 늦게 본 돌파는 따라 사지 않고 skip 기록", async () => {
  const s = setup({ start: "2026-11-16T10:00:00+09:00" });
  s.ex.tick(s.level + 1000); await s.bot.step();
  s.nextDay("2026-11-17T09:00:01+09:00", s.level * 1.05); await s.bot.step();            // 새 날이 기준 위에서 시작
  assert.deepEqual(s.ex.posts.map(p => p.side + ":" + p.identifier), ["bid:jkq-c3-2026-11-16-buy", "ask:jkq-c3-2026-11-16-sell", "bid:jkq-c3-2026-11-17-buy"]);
  const g = setup({ start: "2026-11-16T10:00:00+09:00" });
  g.ex.tick(g.level + 1000); await g.bot.step();
  g.ex.eth = 0;                                                                           // 사용자가 업비트에서 직접 팔았다
  g.nextDay("2026-11-17T09:00:01+09:00", g.closes[0]); await g.bot.step();
  assert.equal(g.ex.posts.length, 1); assert.equal(g.bot.state.position, null);
  assert.ok(g.reports.some(m => /매수분이 계좌에 없어 매도하지 않음/.test(m.text)));
  const late = setup({ start: "2026-11-16T15:00:00+09:00" });                           // 봇이 늦게 켜짐 — 이미 기준 +2%
  late.ex.high = late.level * 1.03; late.ex.px = Math.round(late.level * 1.02); await late.bot.step(); await late.bot.step();
  assert.equal(late.ex.posts.length, 0);
  assert.equal(late.reports.filter(m => /늦게 확인/.test(m.text)).length, 1);
  late.nextDay("2026-11-17T09:00:01+09:00", late.closes[0]); await late.bot.step();
  assert.deepEqual(ids(late), ["real:coin:2026-11-16:skip"]);
  assert.match(late.reports.find(m => m.id === "real:coin:2026-11-16:skip").payload.why, /늦게 확인/);
  const back = setup({ start: "2026-11-16T15:00:00+09:00" });                           // 늦게 봤지만 기준 +1% 아래로 돌아오면 산다
  back.ex.high = back.level * 1.03; back.ex.px = Math.round(back.level * 1.02); await back.bot.step();
  back.at("2026-11-16T16:00:00+09:00"); back.ex.px = Math.round(back.level * 1.005); await back.bot.step();
  assert.equal(back.ex.posts.length, 1);
});
test("알림 · 기록 실패가 주문을 막지 않는다 — 쌓아 두고 다시(이미 텔레그램을 보냈으면 tg:false) · 시작 알림은 한 시간에 한 번", async () => {
  const got = []; let fail = true;
  const s = setup({ start: "2026-11-16T10:00:00+09:00", report: async m => { got.push(m); return fail ? { ok: false, telegram: "sent", error: "worker down" } : { ok: true }; } });
  s.ex.tick(s.level + 1000); await s.bot.step();
  assert.equal(s.ex.posts.length, 1); assert.ok(s.bot.state.position);
  assert.ok(s.bot.state.outbox.some(x => x.msg.id === "real:coin:2026-11-16:buy" && x.msg.tg === false));
  fail = false; s.at("2026-11-16T11:00:00+09:00"); await s.bot.step();
  assert.equal(s.bot.state.outbox.length, 0);
  assert.equal(got.filter(m => m.id === "real:coin:2026-11-16:buy").at(-1).tg, false);
  const st = B.memoryStore(), mk = () => setup({ store: st, start: "2026-11-16T10:00:00+09:00" });
  const a = mk(); await a.bot.init(); const b = mk(); b.at("2026-11-16T10:30:00+09:00"); await b.bot.init(); const c = mk(); c.at("2026-11-16T11:30:00+09:00"); await c.bot.init();
  assert.deepEqual([a, b, c].map(x => x.reports.filter(m => /봇 시작/.test(m.text)).length), [1, 0, 1]);
});
test("기록 형식(_claude_real) — id 날짜 = date · 종류 4가지 · payload 2000자 · 머리말", () => {
  assert.deepEqual(R.realRecord({ id: "real:coin:2026-11-16:buy", date: "2026-11-16", payload: { a: 1 } }), { ok: true, id: "real:coin:2026-11-16:buy", date: "2026-11-16", kind: "buy", payload: { a: 1 } });
  for (const b of [{ id: "real:coin:2026-11-16:buy", date: "2026-11-17", payload: {} }, { id: "real:coin:2026-11-16:hold", date: "2026-11-16", payload: {} },
    { id: "real:soxl:2026-11-16:buy", date: "2026-11-16", payload: {} }, { id: "real:coin:2026-11-16:buy", date: "2026-11-16", payload: [1] },
    { id: "real:coin:2026-11-16:buy", date: "2026-11-16", payload: { x: "y".repeat(2000) } }, { id: "real:coin:2026-11-16:buy", date: "2026-11-16" }])
    assert.equal(R.realRecord(b).ok, false, JSON.stringify(b).slice(0, 80));
  assert.equal(R.realText("[클로드 연구 비트코인] 🟢 x"), "[클로드 연구 비트코인] 🟢 x");
  assert.equal(R.realText("[클로드 연구 시초가] 🟢 x"), null);
  assert.equal(R.realText(R.REAL_HEAD + "x".repeat(1500)), null);
});
test("엔드포인트 /api/claude-coinbot — 봇 전용 키만 · 기록 먼저 → 처음 기록이면 텔레그램 · 장부가 못 받으면 502(봇이 다시)", async () => {
  const KEY = "k".repeat(40), env = { CLAUDE_COINBOT_KEY: KEY, OPENING_MONITOR_KEY: "mk", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" };
  const calls = [], old = globalThis.fetch; let worker = { ok: true, fresh: true }, wStatus = 200;
  globalThis.fetch = async (u, init = {}) => {
    u = String(u); calls.push({ u, init });
    if (u.endsWith("/claude-real")) return new Response(JSON.stringify(worker), { status: wStatus });
    if (u.startsWith("https://api.telegram.org/")) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
    throw new Error("unexpected " + u);
  };
  const post = async (body, key = KEY) => { const r = await EP.onRequestPost({ request: new Request("https://p.test/api/claude-coinbot", { method: "POST", headers: { "x-coinbot-key": key }, body: JSON.stringify(body) }), env }); return { status: r.status, j: await r.json() }; };
  const rec = { op: "report", id: "real:coin:2026-11-16:buy", date: "2026-11-16", payload: { price: 1 }, text: R.REAL_HEAD + "🟢 ETH 실투자 매수" };
  try {
    assert.equal((await post(rec, "bad")).status, 401);
    assert.equal((await post(rec, "k".repeat(39) + "x")).status, 401);
    assert.equal((await EP.onRequestPost({ request: new Request("https://p.test", { method: "POST", headers: { "x-coinbot-key": "short" }, body: "{}" }), env: { CLAUDE_COINBOT_KEY: "short" } })).status, 401);   // 짧은 키는 설정 오류 — 받지 않는다
    assert.equal(calls.length, 0);
    let r = await post(rec);
    assert.deepEqual([r.status, r.j.recorded, r.j.fresh, r.j.telegram], [200, true, true, "sent"]);
    assert.deepEqual(calls.map(c => c.u.includes("claude-real") ? "worker" : "tg"), ["worker", "tg"]);   // 기록 먼저
    assert.equal(calls[0].init.headers["x-monitor-key"], "mk");
    assert.deepEqual(JSON.parse(calls[0].init.body), { id: rec.id, date: rec.date, payload: rec.payload });
    assert.equal(JSON.parse(calls[1].init.body).text, rec.text);
    calls.length = 0; worker = { ok: true, fresh: false };
    r = await post(rec); assert.deepEqual([r.j.telegram, calls.length], ["skipped", 1]);   // 이미 있던 기록 — 같은 알림 되풀이 안 함
    calls.length = 0; worker = { ok: true, fresh: true };
    r = await post({ ...rec, tg: false }); assert.deepEqual([r.j.telegram, calls.length], ["skipped", 1]);
    calls.length = 0; wStatus = 500; worker = { ok: false, error: "down" };
    r = await post(rec); assert.deepEqual([r.status, r.j.ok, r.j.telegram], [502, false, "sent"]);   // 장부가 못 받아도 알림은 · 봇은 다시 보낸다
    wStatus = 200; calls.length = 0;
    for (const bad of [{ ...rec, date: "2026-11-17" }, { ...rec, id: "real:coin:2026-11-16:x" }, { ...rec, text: "[클로드 연구 SOXL] x" }, { ...rec, op: "order" }])
      assert.equal((await post(bad)).status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal(calls.length, 0);
    r = await post({ op: "event", text: R.REAL_HEAD + "🤖 봇 시작" }); assert.deepEqual([r.status, r.j.telegram, calls.map(c => c.u.slice(0, 24))], [200, "sent", ["https://api.telegram.org"]]);
  } finally { globalThis.fetch = old; }
});
test("Worker /claude-real — 감시키 · POST 만 · 형식 검사 · claude:{날짜} 장부에 한 번만(fresh)", async () => {
  let src = fs.readFileSync(path.join(ROOT, "worker/opening-scheduler/src/index.js"), "utf8");
  src = src.replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}")
    .replace(/"\.\.\/\.\.\/\.\.\/functions\/api\/([^"]+)"/g, (_, f) => JSON.stringify(pathToFileURL(path.join(ROOT, "functions/api", f)).href));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wk-real-")), "worker.mjs"); fs.writeFileSync(tmp, src);
  const W = await import(pathToFileURL(tmp).href);
  const stores = new Map();
  const env = { MONITOR_KEY: "mk", SIGNAL_STORE: { idFromName: n => n, get: n => {
    if (!stores.has(n)) { const mem = new Map(); stores.set(n, new W.OpeningSignalStore({ storage: { get: async k => mem.get(k), put: async (k, v) => { mem.set(k, v); } } }, env)); }
    const st = stores.get(n); return { fetch: (u, i) => st.fetch(new Request(u, i)) };
  } } };
  const call = async (body, { key = "mk", method = "POST" } = {}) => { const r = await W.default.fetch(new Request("https://w.test/claude-real", { method, headers: { "x-monitor-key": key }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }), env); return { status: r.status, j: await r.json() }; };
  const rec = { id: "real:coin:2026-11-16:buy", date: "2026-11-16", payload: { price: 3000000, volume: 0.2 } };
  assert.equal((await call(rec, { key: "bad" })).status, 401);
  assert.equal((await call(null, { method: "GET" })).status, 405);
  assert.equal((await call({ ...rec, date: "2026-11-15" })).status, 400);
  assert.deepEqual((await call(rec)).j, { ok: true, fresh: true });
  assert.deepEqual((await call({ ...rec, payload: { price: 1 } })).j, { ok: true, fresh: false });     // 같은 id 는 덮어쓰지 않는다
  const r = await W.default.fetch(new Request("https://w.test/claude?date=2026-11-16", { headers: { "x-monitor-key": "mk" } }), env).then(x => x.json());
  const ev = r.ledger.events.filter(e => e.id === rec.id);
  assert.equal(ev.length, 1); assert.equal(ev[0].stage, "real"); assert.deepEqual(ev[0].payload, rec.payload);
});
