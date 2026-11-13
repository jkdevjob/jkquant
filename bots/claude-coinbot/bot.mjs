// ③ 실투자 봇 — 업비트 KRW-ETH 를 사용자 서버(고정 IP)에서 실제로 사고판다.
// 사용자 2026-11-13 "100만원 소액으로 가자 4는 직접 3은 자동으로" · "당연히 A로"(고정 IP 무료 클라우드 서버).
// 업비트 Open API 의 주문 키는 허용 IP 등록이 필수라, 고정 IP 가 없는 Cloudflare Worker · GitHub Actions 에서는 주문을 낼 수 없다.
//
// 판단은 실시간 화면(functions/api/claude-live.js coinHoldToday)과 같은 함수 · 같은 메인(사용자 고정 g_coin_ma15_s99_hi7_eth)이다.
//   어제 종가 > 15일 평균인 날, 그날(09:00 시작) 고가가 최근 7일 고가를 넘으면 산다 → 다음 날 09:00 에 판다 · 손절 없음.
// 지키는 것
//  · 예산(BUDGET_KRW · 기본 60만 원) 안에서만 산다. 산 수량만 판다(계좌의 다른 ETH 는 건드리지 않는다).
//  · 업비트 하루에 매수 한 번 · 매도 한 번. 주문마다 고유 identifier(jkq-c3-<날짜>-buy|sell) — 업비트는 쓴 값을 다시 받지 않는다.
//  · 주문은 자동으로 다시 내지 않는다. 보내기 전에 상태를 먼저 저장하고, 결과를 모르면 identifier 로 조회만 한다. 실패하면 알리고 멈춘다.
//  · 메인이 고정 전략과 다르면(고정을 풀었거나 변수가 다르면) 사지 않고 알린다 — 실투자 전략은 사용자 확인 없이 바뀌지 않는다.
//  · PAUSE 파일이 있으면 새로 사지 않는다(보유분 09:00 매도는 한다). DRY_RUN 이 "0" 이 아니면 주문을 내지 않는 시험 모드다.
//  · 알림 · 기록 실패가 주문을 막지 않는다(보낼 것은 쌓아 두고 다시 보낸다 — 같은 기록 id 는 Worker 장부가 한 번만 받는다).
import crypto from "node:crypto";
import { coinHoldToday } from "../../functions/api/claude-live.js";
import { cleanEvents, coinDaysNeeded, mainFor, validateParams } from "../../functions/api/_claude_main.js";
import { REAL_HEAD, realId } from "../../functions/api/_claude_real.js";

export const STRATEGY = Object.freeze({ version: "g_coin_ma15_s99_hi7_eth",
  params: Object.freeze({ ma: 15, stopPct: 99, level: "prevhigh", k: 0.5, hiN: 7, lastEntryHour: null, tabSize: 0.8, markets: Object.freeze(["KRW-ETH"]) }) });
export const MARKET = "KRW-ETH", COIN = "ETH";
export const MIN_ORDER_KRW = 5000;        // 업비트 원화 시장 최소 주문
export const DEFAULT_FEE = 0.0005;        // 업비트 원화 시장 수수료(주문 가능 정보를 못 받을 때)
// 실행 안전장치(전략 규칙 아님): 돌파를 늦게 봤으면(서버 재시작 등) 연구 장부의 매수가 기준(그날 시가와 돌파 기준 중 높은 것)보다
// 1% 넘게 오른 값으로는 따라 사지 않는다 — 그 아래로 오면 산다. 끝내 못 사면 skip 기록(연구 장부와 다른 날로 남는다).
export const CHASE_PCT = 1.0;
export const MAIN_CONFIG_URL = "https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/claude-lab/main-config.json";
export const STATE_V = 1;
export const PENDING_MS = 120000;         // 보낸 결과를 모를 때 '안 들어갔다'고 정하기 전에 기다리는 시간(업비트 처리가 늦을 수 있다)

// ── 날짜 · 표시 ──
export const upbitDay = ms => new Date(ms).toISOString().slice(0, 10);          // 업비트 하루는 09:00 KST 시작 = UTC 날짜
export const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const kstHm = ms => new Date(ms + 9 * 36e5).toISOString().slice(11, 16);
const won = v => (v == null || !isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US"));
const pctS = v => (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%";
const errName = j => String((j && j.error && (j.error.name || j.error.message)) || "").slice(0, 80);

// ── 판단(순수 함수) ──
// 메인 확인 — 그날 유효한 ③ 메인(Worker 승격 기록 사본)이 고정 전략과 버전 · 변수 모두 같아야 산다.
export function strategyCheck(events, day) {
  const m = mainFor(cleanEvents(events), "crypto", day);
  const want = JSON.stringify(validateParams("crypto", { ...STRATEGY.params, markets: [...STRATEGY.params.markets] }));
  if (m.version !== STRATEGY.version) return { ok: false, main: m.version, why: "③ 메인이 " + m.version + " (봇은 " + STRATEGY.version + " 만)" };
  if (JSON.stringify(m.params) !== want) return { ok: false, main: m.version, why: "③ 메인 변수가 봇과 다름" };
  return { ok: true, main: m.version };
}
// 그날 계획 — 업비트 일봉(최신순). c[0] 이 그날(진행 중)이고 c[1] 이 어제(확정)여야 한다.
export function planOf(candles, day, P = STRATEGY.params) {
  const c = Array.isArray(candles) ? candles : [];
  if (!c.length || String(c[0].candle_date_time_kst || "").slice(0, 10) !== day) return { ready: false, why: "일봉이 아직 " + day + " 로 안 넘어감" };
  const h = coinHoldToday(c, P);
  if (!h || h.basedOn !== addDays(day, -1)) return { ready: false, why: "확정 일봉 부족" };
  return { ready: true, day, hold: !!h.hold, level: h.level, prevClose: h.prevClose, ma: h.ma, basedOn: h.basedOn };
}
// 지금 살지 — 업비트 현재가(ticker: 그날 09:00 부터의 시가 · 고가 · 현재가). 연구 장부와 같은 조건: 그날 고가가 기준을 '넘으면'(>).
export function entryDecision(plan, t, chase = CHASE_PCT) {
  if (!plan || !plan.ready || !plan.hold || !t) return { buy: false };
  if (String(t.trade_date || "") !== plan.day.replace(/-/g, "")) return { buy: false, why: "시세가 아직 전날" };
  const hi = +t.high_price, px = +t.trade_price, op = +t.opening_price;
  if (!(hi > 0 && px > 0 && op > 0) || !(hi > plan.level)) return { buy: false };
  const ref = Math.max(op, plan.level);
  if (px > ref * (1 + chase / 100)) return { buy: false, late: true, ref, why: "늦게 확인 — 기준 " + won(ref) + "원 +" + chase + "% 넘음(지금 " + won(px) + "원)" };
  return { buy: true, ref, price: px };
}
// 매수 금액 — 예산과 (원화 잔고 ÷ (1 + 수수료)) 중 작은 쪽을 1,000원 단위로 내림. 최소 주문 미만이면 0.
export function buyAmount(budget, krwFree, fee = DEFAULT_FEE) {
  const a = Math.floor(Math.min(+budget || 0, (+krwFree || 0) / (1 + (+fee || 0))) / 1000) * 1000;
  return a >= MIN_ORDER_KRW ? a : 0;
}
// 매도 수량 — 산 수량과 지금 쓸 수 있는 잔고 중 작은 쪽(소수 8자리 내림)
export function sellVolume(posVol, coinFree) { return Math.floor(Math.min(+posVol || 0, +coinFree || 0) * 1e8) / 1e8; }
// 주문 조회 결과 → 체결 합계(trades 는 개별 주문 조회에만 온다)
export function fillOf(o) {
  const tr = Array.isArray(o && o.trades) ? o.trades : [];
  const volume = tr.reduce((s, x) => s + (+x.volume || 0), 0), funds = tr.reduce((s, x) => s + (+x.funds || 0), 0);
  return { volume, funds, price: volume > 0 ? funds / volume : null, fee: +(o && o.paid_fee) || 0, state: String((o && o.state) || "") };
}
const terminal = o => o && (o.state === "done" || o.state === "cancel");
export function freeOf(accounts, cur) { const a = (Array.isArray(accounts) ? accounts : []).find(x => x && x.currency === cur); return a ? +a.balance || 0 : 0; }

// ── 업비트 REST(인증: JWT HS512 · query_hash = SHA512(인코딩 안 한 쿼리 문자열)) ──
const b64u = b => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const SAFE = /^[A-Za-z0-9_.:\-]+$/;
export function queryOf(params) {
  return Object.entries(params || {}).map(([k, v]) => {
    if (!SAFE.test(k) || !SAFE.test(String(v))) throw new Error("쿼리 값 형식 오류: " + k);   // 인코딩이 필요 없는 값만 — 해시와 주소가 같은 문자열
    return k + "=" + v;
  }).join("&");
}
export function upbitJwt(accessKey, secretKey, query = "", nonce = crypto.randomUUID()) {
  const payload = { access_key: accessKey, nonce };
  if (query) Object.assign(payload, { query_hash: crypto.createHash("sha512").update(query, "utf8").digest("hex"), query_hash_alg: "SHA512" });
  const head = b64u(JSON.stringify({ alg: "HS512", typ: "JWT" })), body = b64u(JSON.stringify(payload));
  return head + "." + body + "." + b64u(crypto.createHmac("sha512", secretKey).update(head + "." + body).digest());
}
export function upbitClient({ accessKey = "", secretKey = "", fetchImpl = (...a) => fetch(...a), base = "https://api.upbit.com", timeoutMs = 10000 } = {}) {
  async function req(method, path, params = null, auth = false) {
    const q = params && method === "GET" ? queryOf(params) : "";
    const headers = { Accept: "application/json" };
    if (auth) {
      if (!accessKey || !secretKey) throw new Error("업비트 키 없음");
      headers.Authorization = "Bearer " + upbitJwt(accessKey, secretKey, method === "GET" ? q : queryOf(params || {}));
    }
    let body;
    if (method === "POST") { headers["Content-Type"] = "application/json; charset=utf-8"; body = JSON.stringify(params || {}); }
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchImpl(base + path + (q ? "?" + q : ""), { method, headers, body, signal: ac.signal });
      const j = await r.json().catch(() => null);
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: j, date: r.headers && r.headers.get ? r.headers.get("date") : null };
    } finally { clearTimeout(t); }
  }
  return {
    accounts: () => req("GET", "/v1/accounts", null, true),
    chance: () => req("GET", "/v1/orders/chance", { market: MARKET }, true),
    order: q => req("GET", "/v1/order", q, true),
    place: body => req("POST", "/v1/orders", body, true),
    ticker: () => req("GET", "/v1/ticker", { markets: MARKET }),
    days: n => req("GET", "/v1/candles/days", { market: MARKET, count: n }),
  };
}
export async function fetchMainConfig(fetchImpl = (...a) => fetch(...a), url = MAIN_CONFIG_URL) {
  try {
    const r = await fetchImpl(url + "?t=" + Date.now(), { headers: { Accept: "application/json" } });
    const j = await r.json().catch(() => null);
    return r.ok && j && Array.isArray(j.events) ? { ok: true, events: j.events } : { ok: false, error: "HTTP " + r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
// 보고(기록 + 텔레그램) — Pages /api/claude-coinbot · 봇 전용 키
export function reporter({ base = "https://jkquant.pages.dev", key = "", fetchImpl = (...a) => fetch(...a), timeoutMs = 15000 } = {}) {
  return async msg => {
    if (!key) return { ok: false, definite: true, error: "보고 키 없음(COINBOT_REPORT_KEY)" };
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetchImpl(base.replace(/\/$/, "") + "/api/claude-coinbot", { method: "POST", signal: ac.signal,
        headers: { "content-type": "application/json", "x-coinbot-key": key }, body: JSON.stringify(msg) });
      const j = await r.json().catch(() => ({}));
      return { ...j, ok: r.ok && !!j.ok, status: r.status };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
    finally { clearTimeout(t); }
  };
}
export function memoryStore(init = null) {
  let v = init ? JSON.parse(JSON.stringify(init)) : null;
  return { load: async () => (v ? JSON.parse(JSON.stringify(v)) : null), save: async s => { v = JSON.parse(JSON.stringify(s)); }, peek: () => v };
}

// ── 봇 ──
// api: upbitClient · store: {load, save} · report: reporter · now: () => ms · mainConfig: () => {ok, events} · paused: () => bool
// env: {BUDGET_KRW, DRY_RUN} · ver: 봇 판(git 커밋) · sleep: 주문 조회 사이 쉬기
export class Bot {
  constructor({ api, store, report = async () => ({ ok: true }), now = () => Date.now(), mainConfig = () => fetchMainConfig(), paused = () => false,
    env = {}, ver = "", log = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    Object.assign(this, { api, store, report, now, mainConfig, paused, env, ver, log, sleep });
    this.budget = Math.max(0, Math.floor(+env.BUDGET_KRW || 600000));
    this.dry = String(env.DRY_RUN ?? "1") !== "0";                 // 기본은 시험 — DRY_RUN=0 일 때만 실주문
    this.state = null;
  }
  get mode() { return this.dry ? "시험 모드(주문 안 냄)" : "실전"; }
  async init() {
    const s = await this.store.load();
    const fresh = !s || s.v !== STATE_V;
    this.state = fresh ? { v: STATE_V, position: null, days: {}, outbox: [], seq: 0, notes: {} } : s;
    if (fresh && !this.dry) await this.recover();                   // 상태 파일이 없으면(새 설치 · 잃어버림) 업비트 주문 기록으로 보유를 되살린다
    const quiet = this.state.notes.startAt && this.now() - this.state.notes.startAt < 36e5;   // 계속 다시 켜지면(오류 반복) 시작 알림은 한 시간에 한 번
    this.state.notes.startAt = this.now();
    await this.save();
    if (!quiet) await this.emit({ op: "event", text: REAL_HEAD + "🤖 ETH 실투자 봇 시작 — " + this.mode + " · 예산 " + won(this.budget) + "원 · 전략 " + STRATEGY.version + (this.ver ? " · 판 " + this.ver : "") });
    return this;
  }
  async save() { await this.store.save(this.state); }
  dayOf(d) { return this.state.days[d] || (this.state.days[d] = {}); }
  idOf(d, side) { return "jkq-c3-" + d + "-" + side; }

  // 상태를 잃었을 때 — 오늘 · 어제 매수 identifier 를 조회해 팔지 않은 매수가 있으면 보유로 되살린다(주문은 내지 않는다)
  async recover() {
    const D = upbitDay(this.now());
    for (const d of [addDays(D, -1), D]) {
      const b = await this.api.order({ identifier: this.idOf(d, "buy") });
      if (!b.ok || !terminal(b.json)) continue;
      const f = fillOf(b.json);
      this.dayOf(d).buy = { status: "done", identifier: this.idOf(d, "buy"), uuid: b.json.uuid, ...f, recovered: true };
      const s = await this.api.order({ identifier: this.idOf(d, "sell") });
      if (s.ok && terminal(s.json)) { this.dayOf(d).sell = { status: "done", identifier: this.idOf(d, "sell"), uuid: s.json.uuid, ...fillOf(s.json), recovered: true }; this.state.position = null; continue; }
      if (s.status !== 404) { this.dayOf(d).sell = { status: "unknown", identifier: this.idOf(d, "sell") }; }
      if (f.volume > 0) this.state.position = { day: d, volume: f.volume, funds: f.funds, fee: f.fee, price: f.price, uuid: b.json.uuid, recovered: true };
    }
  }

  // 한 번 돌기 — 반환: {day, watching} (watching 이면 돌파를 기다리는 중 → 짧게 다시)
  async step() {
    if (!this.state) await this.init();
    const t = this.now(), D = upbitDay(t), out = { day: D, watching: false };
    await this.resolvePending(D);
    const pos = this.state.position;
    if (pos && pos.day < D && !pos.sellFailed) await this.sell(pos);           // 어제(또는 그 전) 산 것 — 오늘 09:00 지나면 판다(먼저)
    else if (pos && pos.sellFailed) await this.checkManualClose(pos);
    const day = this.dayOf(D);
    if (!day.plan || !day.plan.ready) await this.loadPlan(D);
    const plan = day.plan;
    if (plan && plan.ready && plan.hold && !day.buy && !this.state.position && day.check && day.check.ok) {
      if (this.paused()) {
        if (!day.pauseNoted) { day.pauseNoted = true; await this.save(); await this.emit({ op: "event", text: REAL_HEAD + "⏸️ ETH 실투자 — 일시정지(PAUSE 파일) · 오늘 새로 사지 않음" }); }
      } else {
        out.watching = true;
        const tk = await this.api.ticker();
        const tick = tk.ok && Array.isArray(tk.json) ? tk.json[0] : null;
        const dec = entryDecision(plan, tick);
        if (tick && +tick.high_price > (day.dayHigh || 0)) day.dayHigh = +tick.high_price;
        if (dec.buy) await this.buy(D, plan, dec);
        else if (dec.late && !day.lateNoted) { day.lateNoted = true; await this.save(); await this.emit({ op: "event", text: REAL_HEAD + "⏳ ETH 실투자 — " + dec.why + " · 기준 +" + CHASE_PCT + "% 아래로 오면 삼" }); }
      }
    }
    await this.flush();
    await this.weekly(t);
    return out;
  }

  async loadPlan(D) {
    const day = this.dayOf(D);
    const r = await this.api.days(coinDaysNeeded(STRATEGY.params) + 3);
    const plan = planOf(r.ok ? r.json : null, D);
    if (!plan.ready) return;
    const mc = await this.mainConfig();
    day.check = mc.ok ? strategyCheck(mc.events, D) : { ok: true, unverified: true, why: "메인 기록을 못 받음 — 고정 전략으로 진행" };
    day.plan = plan;
    this.closeYesterday(D, r.json);                                     // 어제 하루가 끝났다 — 연구 장부는 샀는데 실투자는 안 산 날이면 skip 기록
    await this.save();
    if (!day.check.ok) await this.emit({ op: "event", text: REAL_HEAD + "⚠️ ETH 실투자 — " + day.check.why + " · 오늘 사지 않음(봇 전략을 바꾸려면 사용자 확인)" });
  }
  closeYesterday(D, candles) {
    const Y = addDays(D, -1), y = this.state.days[Y], c1 = Array.isArray(candles) ? candles[1] : null;
    if (!y || !y.plan || !y.plan.ready || !y.plan.hold || y.buy || y.skipRecorded || !c1) return;
    if (String(c1.candle_date_time_kst || "").slice(0, 10) !== Y || !(+c1.high_price > y.plan.level)) return;
    y.skipRecorded = true;
    const why = !y.check || !y.check.ok ? (y.check && y.check.why) || "메인 확인 실패" : y.pauseNoted ? "일시정지" : y.lateNoted ? "늦게 확인 — 기준 +" + CHASE_PCT + "% 넘어 안 따라 삼" : "봇이 돌지 않음";
    this.queue({ op: "report", id: realId(Y, "skip"), date: Y, payload: { mode: this.dry ? "dry" : "live", level: y.plan.level, dayHigh: +c1.high_price, why, ver: this.ver },
      text: REAL_HEAD + "⏭️ ETH 실투자 — " + Y + " 연구 장부는 돌파 매수, 실투자는 안 삼(" + why + ")" });
  }

  async buy(D, plan, dec) {
    const day = this.dayOf(D), id = this.idOf(D, "buy");
    if (this.dry) {
      const amount = this.budget, vol = amount / dec.price;
      day.buy = { status: "done", dry: true, identifier: id, amount, volume: vol, funds: amount, fee: amount * DEFAULT_FEE, price: dec.price, at: this.now() };
      this.state.position = { day: D, volume: vol, funds: amount, fee: amount * DEFAULT_FEE, price: dec.price, dry: true };
      await this.save();
      return this.emit({ op: "event", text: REAL_HEAD + "🧪 ETH 시험 — 실전이면 지금 매수: " + kstHm(this.now()) + " " + won(dec.price) + "원 · " + won(amount) + "원 (기준 " + won(plan.level) + "원 돌파) → 내일 09:00 매도" });
    }
    const acc = await this.api.accounts();
    if (!acc.ok) { day.buy = { status: "failed", identifier: id, error: "잔고 조회 실패 " + acc.status + " " + errName(acc.json), at: this.now() }; await this.save(); return this.reportError(D, "매수", day.buy.error); }
    const ch = await this.api.chance().catch(() => null);
    const fee = ch && ch.ok && ch.json && +ch.json.bid_fee >= 0 ? +ch.json.bid_fee : DEFAULT_FEE;
    const amount = buyAmount(this.budget, freeOf(acc.json, "KRW"), fee);
    if (!amount) { day.buy = { status: "failed", identifier: id, error: "원화 부족(" + won(freeOf(acc.json, "KRW")) + "원)", at: this.now() }; await this.save(); return this.reportError(D, "매수", day.buy.error); }
    day.buy = { status: "sending", identifier: id, amount, ref: dec.ref, level: plan.level, at: this.now() };
    await this.save();                                                    // 보내기 전에 먼저 적는다 — 중간에 꺼져도 다시 보내지 않고 조회한다
    let r;
    try { r = await this.api.place({ market: MARKET, side: "bid", ord_type: "price", price: String(amount), identifier: id }); }
    catch (e) { day.buy.status = "unknown"; day.buy.error = String(e.message || e); await this.save(); return; }
    if (r.ok && r.json && r.json.uuid) { day.buy.status = "sent"; day.buy.uuid = r.json.uuid; await this.save(); return this.settle(D, "buy"); }
    if (r.status >= 500) { day.buy.status = "unknown"; day.buy.error = "HTTP " + r.status; await this.save(); return; }
    day.buy.status = "failed"; day.buy.error = r.status + " " + errName(r.json); await this.save();
    return this.reportError(D, "매수", day.buy.error);
  }

  async sell(pos) {
    const day = this.dayOf(pos.day), id = this.idOf(pos.day, "sell");
    if (day.sell) return;                                                // 이미 보냈다(결과는 resolvePending) · 실패면 다시 내지 않는다
    const tk = await this.api.ticker(), px = tk.ok && Array.isArray(tk.json) && tk.json[0] ? +tk.json[0].trade_price : 0;
    if (!(px > 0)) return;                                               // 시세를 못 받았다 — 다음 번에(주문은 아직 안 냈다)
    if (this.dry || pos.dry) {
      const proceeds = pos.volume * px, fee = proceeds * DEFAULT_FEE;
      day.sell = { status: "done", dry: true, identifier: id, volume: pos.volume, funds: proceeds, fee, price: px, at: this.now() };
      this.state.position = null;
      await this.save();
      const net = proceeds - fee - (pos.funds + pos.fee);
      return this.emit({ op: "event", text: REAL_HEAD + "🧪 ETH 시험 — 실전이면 지금 매도: " + kstHm(this.now()) + " " + won(px) + "원 · 손익 " + pctS(net / (pos.funds + pos.fee) * 100) + " (" + won(net) + "원)" });
    }
    const acc = await this.api.accounts();
    if (!acc.ok) { day.sell = { status: "failed", identifier: id, error: "잔고 조회 실패 " + acc.status + " " + errName(acc.json), at: this.now() }; pos.sellFailed = true; await this.save(); return this.reportError(pos.day, "매도", day.sell.error); }
    const vol = sellVolume(pos.volume, freeOf(acc.json, COIN));
    if (vol * px < MIN_ORDER_KRW) {
      day.sell = { status: "gone", identifier: id, why: "ETH 잔고가 없음 — 직접 판 것으로 봄", at: this.now() };
      this.state.position = null; await this.save();
      return this.emit({ op: "event", text: REAL_HEAD + "ℹ️ ETH 실투자 — " + pos.day + " 매수분이 계좌에 없어 매도하지 않음(직접 판 것으로 봄)" });
    }
    day.sell = { status: "sending", identifier: id, volume: vol, at: this.now() };
    await this.save();
    let r;
    try { r = await this.api.place({ market: MARKET, side: "ask", ord_type: "market", volume: vol.toFixed(8), identifier: id }); }
    catch (e) { day.sell.status = "unknown"; day.sell.error = String(e.message || e); await this.save(); return; }
    if (r.ok && r.json && r.json.uuid) { day.sell.status = "sent"; day.sell.uuid = r.json.uuid; await this.save(); return this.settle(pos.day, "sell"); }
    if (r.status >= 500) { day.sell.status = "unknown"; day.sell.error = "HTTP " + r.status; await this.save(); return; }
    day.sell.status = "failed"; day.sell.error = r.status + " " + errName(r.json); pos.sellFailed = true; await this.save();
    return this.reportError(pos.day, "매도", day.sell.error);
  }

  // 보낸 주문 결과 확인 — 체결이 끝날 때까지 몇 번 조회(시장가는 곧 끝난다). 다 못 보면 다음 step 의 resolvePending 이 이어서 본다.
  async settle(d, side, tries = 6) {
    const o = this.dayOf(d)[side];
    for (let i = 0; i < tries; i++) {
      const r = await this.api.order(o.uuid ? { uuid: o.uuid } : { identifier: o.identifier });
      if (r.ok && terminal(r.json)) return this.finish(d, side, r.json);
      await this.sleep(500);
    }
  }
  async resolvePending(D) {
    for (const d of Object.keys(this.state.days).filter(x => x >= addDays(D, -3)).sort()) {
      for (const side of ["buy", "sell"]) {
        const o = this.state.days[d][side];
        if (!o || !["sending", "unknown", "sent"].includes(o.status)) continue;
        const r = await this.api.order(o.uuid ? { uuid: o.uuid } : { identifier: o.identifier });
        if (r.ok && terminal(r.json)) { await this.finish(d, side, r.json); continue; }
        if (r.status === 404 && o.status !== "sent" && this.now() - (+o.at || 0) >= PENDING_MS) {   // 2분 지나도 업비트에 그 주문이 없다 = 안 들어갔다 → 다시 내지 않는다(실패로 알림)
          o.status = "failed"; o.error = "주문이 들어가지 않음(" + (o.error || "응답 없음") + ")";
          if (side === "sell" && this.state.position) this.state.position.sellFailed = true;
          await this.save();
          await this.reportError(d, side === "buy" ? "매수" : "매도", o.error);
        }
      }
    }
  }
  async finish(d, side, order) {
    const day = this.dayOf(d), o = day[side], f = fillOf(order);
    if (o.status === "done") return;
    if (!(f.volume > 0)) {                                               // 끝났는데 체결이 없다(취소 등) — 실패로 알리고 다시 내지 않는다
      Object.assign(o, { status: "failed", uuid: order.uuid, error: "체결 없음(" + order.state + ")" });
      if (side === "sell" && this.state.position) this.state.position.sellFailed = true;
      await this.save();
      return this.reportError(d, side === "buy" ? "매수" : "매도", o.error);
    }
    Object.assign(o, { status: "done", uuid: order.uuid, ...f, doneAt: this.now() });
    const mode = "live";
    if (side === "buy") {
      this.state.position = { day: d, volume: f.volume, funds: f.funds, fee: f.fee, price: f.price, uuid: order.uuid };
      await this.save();
      const plan = day.plan || {};
      this.queue({ op: "report", id: realId(d, "buy"), date: d, payload: { mode, side: "buy", identifier: o.identifier, uuid: order.uuid, at: o.at, price: f.price, volume: f.volume, funds: f.funds, fee: f.fee,
        level: plan.level, ref: o.ref, amount: o.amount, ver: this.ver },
        text: REAL_HEAD + "🟢 ETH 실투자 매수\n" + kstHm(this.now()) + " " + won(f.price) + "원 · " + f.volume.toFixed(6) + " ETH · " + won(f.funds) + "원 (최근 7일 고가 " + won(plan.level) + "원 돌파)\n→ 다음 날 09:00 매도" });
    } else {
      const pos = this.state.position, cost = pos ? pos.funds + pos.fee : 0, net = f.funds - f.fee - cost;
      this.state.position = null;
      await this.save();
      this.queue({ op: "report", id: realId(d, "sell"), date: d, payload: { mode, side: "sell", identifier: o.identifier, uuid: order.uuid, at: o.at, price: f.price, volume: f.volume, funds: f.funds, fee: f.fee,
        buyPrice: pos && pos.price, cost, net, pnlPct: cost > 0 ? net / cost * 100 : null, ver: this.ver },
        text: REAL_HEAD + "🔴 ETH 실투자 매도\n" + kstHm(this.now()) + " " + won(f.price) + "원 · 손익 " + (cost > 0 ? pctS(net / cost * 100) : "—") + " (" + (net >= 0 ? "+" : "") + won(net) + "원 · 수수료 포함)" });
    }
    await this.flush();
  }
  async checkManualClose(pos) {                                         // 매도 실패 뒤 — 사용자가 업비트에서 직접 팔았으면 보유를 닫는다
    const n = this.state.notes;
    if (n.manualAt && this.now() - n.manualAt < 6e5) return;
    n.manualAt = this.now();
    const acc = await this.api.accounts(), tk = await this.api.ticker();
    const px = tk.ok && Array.isArray(tk.json) && tk.json[0] ? +tk.json[0].trade_price : 0;
    if (acc.ok && px > 0 && freeOf(acc.json, COIN) * px < MIN_ORDER_KRW) {
      this.state.position = null; await this.save();
      await this.emit({ op: "event", text: REAL_HEAD + "ℹ️ ETH 실투자 — " + pos.day + " 매수분이 계좌에 없음(직접 판 것으로 봄) · 다음 신호부터 다시 자동" });
    } else await this.save();
  }
  async reportError(d, what, err) {
    this.queue({ op: "report", id: realId(d, "error"), date: d, payload: { mode: "live", what, error: String(err).slice(0, 300), ver: this.ver },
      text: REAL_HEAD + "⚠️ ETH 실투자 — " + what + " 주문 실패(" + String(err).slice(0, 120) + ") · 자동으로 다시 내지 않음 — 업비트 앱에서 확인해 주세요" });
    await this.flush();
  }

  // 알림 · 기록 — 쌓아 두고 보낸다. 실패하면 다음에 다시(기록은 같은 id 한 번만 · 이미 알림을 보냈으면 tg:false).
  queue(msg) { this.state.outbox.push({ n: ++this.state.seq, msg, tries: 0, next: 0 }); }
  async emit(msg) { this.queue(msg); await this.save(); await this.flush(); }
  async flush() {
    const now = this.now(), keep = [];
    for (const it of this.state.outbox) {
      if (it.next > now) { keep.push(it); continue; }
      const r = await this.report(it.msg).catch(e => ({ ok: false, error: String(e) }));
      if (r.ok) continue;
      if (r.telegram === "sent") it.msg = { ...it.msg, tg: false };
      it.tries++;
      if (r.definite && r.status && r.status < 500 && r.status !== 401) { this.log("보고 거절(버림) " + r.status + " " + (r.error || "")); continue; }
      if (it.tries >= 50) { this.log("보고 50번 실패(버림) " + (it.msg.id || it.msg.text.slice(0, 40))); continue; }
      it.next = now + Math.min(36e5, 6e4 * 2 ** Math.min(it.tries, 6));
      keep.push(it);
    }
    const changed = keep.length !== this.state.outbox.length || keep.some((x, i) => x !== this.state.outbox[i]);
    this.state.outbox = keep;
    if (changed || keep.length) await this.save();
  }
  // 매주 월요일 09:05 뒤 한 번 — 봇이 살아 있는지 · 지난 7일 매매
  async weekly(t) {
    const k = new Date(t + 9 * 36e5), wd = k.getUTCDay(), hm = k.getUTCHours() * 100 + k.getUTCMinutes(), d = k.toISOString().slice(0, 10);
    if (wd !== 1 || hm < 905 || this.state.notes.weekly === d) return;
    this.state.notes.weekly = d;
    const D = upbitDay(t), last = Object.keys(this.state.days).filter(x => x >= addDays(D, -7) && x < D);
    const sells = last.map(x => this.state.days[x].sell).filter(s => s && s.status === "done");
    const buys = last.filter(x => this.state.days[x].buy && this.state.days[x].buy.status === "done").length;
    // 최근 60일만 남긴다
    for (const x of Object.keys(this.state.days)) if (x < addDays(D, -60)) delete this.state.days[x];
    await this.emit({ op: "event", text: REAL_HEAD + "🤖 ETH 실투자 봇 정상 — " + this.mode + " · 지난 7일 매수 " + buys + "번 · 매도 " + sells.length + "번 · 예산 " + won(this.budget) + "원" + (this.ver ? " · 판 " + this.ver : "") });
  }
}
