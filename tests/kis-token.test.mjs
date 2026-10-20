// 한투 접근 토큰 하루 한 번 — node --test tests/kis-token.test.mjs
// 2026-10-20 한투 알림톡: "접근 토큰은 1일 1회 발급 원칙이며, 유효기간 내 잦은 토큰 발급 발생 시 이용이 제한될 수 있습니다."
// 예전 kis.js 는 6시간만 쓰고 데이터센터마다 따로 보관해 하루에 여러 번 새로 받았다.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 변이 시험(scripts/mutation_test_kis_token.py)은 사본 경로를 넘긴다 — 작업 파일은 건드리지 않는다
const KIS_SRC = process.env.JKQ_KIS_SRC || path.join(root, "functions/api/kis.js");
const WORKER_SRC = process.env.JKQ_WORKER_SRC || path.join(root, "worker/opening-scheduler/src/index.js");
const K = await import(pathToFileURL(KIS_SRC).href);
const VTS = "https://openapivts.koreainvestment.com:29443", REAL = "https://openapi.koreainvestment.com:9443";
const WK = "https://jkquant-opening-scheduler.mumae4.workers.dev/kis-token";
const ENV = { KIS_ENV: "vts", KIS_APPKEY: "PSappkey-vts", KIS_APPSECRET: "secret-vts", AUTOTRADE_KEY: "mk" };
const REALENV = { KIS_ENV: "real", KIS_APPKEY: "PSappkey-real", KIS_APPSECRET: "secret-real", AUTOTRADE_KEY: "mk" };

// 가짜 세상: 한투 토큰 발급 · 엣지 캐시(데이터센터 하나) · Worker 저장소
function world({ workerDown = false, expiredAt = "" } = {}) {
  const w = { issued: [], central: new Map(), edge: new Map(), edgeTtl: new Map(), worker: [], other: [] };
  globalThis.caches = { default: {
    match: async u => (w.edge.has(String(u)) ? new Response(w.edge.get(String(u))) : undefined),
    put: async (u, r) => { w.edge.set(String(u), await r.text()); w.edgeTtl.set(String(u), +(/max-age=(\d+)/.exec(r.headers.get("cache-control") || "") || [])[1]); },
    delete: async u => w.edge.delete(String(u)) } };
  globalThis.fetch = async (u, init = {}) => {
    u = String(u);
    if (u.endsWith("/oauth2/tokenP")) {
      w.issued.push(u);
      return new Response(JSON.stringify({ access_token: "TOKEN-" + w.issued.length + "-abcdefghijklmnopqrstuvwxyz", expires_in: 86400,
        ...(expiredAt ? { access_token_token_expired: expiredAt } : {}) }));
    }
    if (u.startsWith(WK)) {
      w.worker.push({ url: u, method: init.method, key: init.headers["x-monitor-key"], raw: init.body || "", body: init.body ? JSON.parse(init.body) : null });
      if (workerDown) throw new Error("worker down");
      if (init.method === "GET") { const t = w.central.get(new URL(u).searchParams.get("k")); return new Response(JSON.stringify(t ? { ok: true, ...t } : { ok: true, token: null })); }
      const b = JSON.parse(init.body);
      if (b.drop) { if (w.central.get(b.k)?.token === b.drop) w.central.delete(b.k); }
      else w.central.set(b.k, { token: b.token, exp: b.exp });
      return new Response(JSON.stringify({ ok: true }));
    }
    w.other.push({ url: u, auth: init.headers && init.headers.authorization });
    return new Response(JSON.stringify({ rt_cd: "1", msg_cd: "EGW00123", msg1: "기간이 만료된 token 입니다." }), { status: 500 });
  };
  return w;
}
const fresh = () => K._resetTokenForTest();

test("모의투자: 한 번 받으면 다른 인스턴스 · 다른 데이터센터도 같은 토큰을 쓴다(하루 한 번)", async () => {
  const w = world(); fresh();
  const t1 = await K.getToken(ENV);
  assert.equal(w.issued.length, 1);
  const k = await K.tokenId(ENV);
  assert.match(k, /^[0-9a-f]{16}$/);
  const c = w.central.get(k);
  assert.equal(c.token, t1); assert.ok(Math.abs(c.exp - (Date.now() + 864e5)) < 5000);        // 24시간 그대로 맡긴다
  assert.ok(w.worker.every(x => x.key === "mk"));
  // Worker 로는 이름표 · 토큰 · 만료만 — 앱키 · 비밀키 · 계좌는 안 간다
  const post = w.worker.find(x => x.method === "POST");
  assert.deepEqual(Object.keys(post.body).sort(), ["exp", "k", "token"]);
  assert.ok(w.worker.every(x => !/PSappkey|secret/.test(x.url + x.raw)));
  fresh(); w.edge.clear();                                                                     // 새 인스턴스 · 다른 데이터센터
  assert.equal(await K.getToken(ENV), t1); assert.equal(w.issued.length, 1);
  const calls = w.worker.length;
  assert.equal(await K.getToken(ENV), t1); assert.equal(w.worker.length, calls);              // 같은 인스턴스는 메모리에서
  fresh();                                                                                     // 같은 데이터센터 새 인스턴스는 엣지 캐시에서
  assert.equal(await K.getToken(ENV), t1); assert.equal(w.issued.length, 1); assert.equal(w.worker.length, calls);
});

test("만료 1시간 안이면 새로 받는다 · 1시간 넘게 남으면 그대로 · 앱키를 바꾸면 옛 토큰을 안 쓴다", async () => {
  const w = world(); fresh();
  const k = await K.tokenId(ENV);
  w.central.set(k, { token: "OLD-TOKEN-abcdefghijklmnopqrstuvwxyz", exp: Date.now() + 30 * 60e3 });
  const t = await K.getToken(ENV);
  assert.equal(w.issued.length, 1); assert.notEqual(t, "OLD-TOKEN-abcdefghijklmnopqrstuvwxyz");
  fresh(); w.edge.clear();
  w.central.set(k, { token: "KEEP-TOKEN-abcdefghijklmnopqrstuvwxyz", exp: Date.now() + 2 * 3600e3 });
  assert.equal(await K.getToken(ENV), "KEEP-TOKEN-abcdefghijklmnopqrstuvwxyz"); assert.equal(w.issued.length, 1);
  fresh(); w.edge.set("https://kis-token.internal/v2/" + k, JSON.stringify({ token: "EDGE-OLD-abcdefghijklmnopqrstuvwxyz", exp: Date.now() + 30 * 60e3 }));
  assert.equal(await K.getToken(ENV), "KEEP-TOKEN-abcdefghijklmnopqrstuvwxyz");                // 엣지 캐시도 만료 1시간 안이면 안 쓴다
  // 모의투자 재신청으로 앱키가 바뀌면 — 같은 서버 주소여도 이름표가 달라 새로 받는다
  const env2 = { ...ENV, KIS_APPKEY: "PSappkey-vts-NEW" };
  assert.notEqual(await K.tokenId(env2), k);
  const t2 = await K.getToken(env2);
  assert.equal(w.issued.length, 2); assert.notEqual(t2, "KEEP-TOKEN-abcdefghijklmnopqrstuvwxyz");
});

test("실전 토큰은 Worker 에 보내지 않는다 · 엣지 캐시에는 6시간이 아니라 만료 1시간 전까지 · 실전 · 모의를 번갈아 써도 서로 안 덮는다", async () => {
  const w = world(); fresh();
  const t = await K.getToken(REALENV);
  assert.equal(w.issued.length, 1); assert.ok(w.issued[0].startsWith(REAL)); assert.equal(w.worker.length, 0);
  const saved = JSON.parse([...w.edge.values()][0]), ttl = [...w.edgeTtl.values()][0];
  assert.equal(saved.token, t); assert.ok(saved.exp - Date.now() > 23 * 3600e3);
  assert.ok(ttl > 23 * 3600 - 60 && ttl <= 23 * 3600, String(ttl));                           // 캐시도 만료 1시간 전까지(예전 6시간)
  fresh();
  assert.equal(await K.getToken(REALENV), t); assert.equal(w.issued.length, 1); assert.equal(w.worker.length, 0);
  const v = await K.getToken(ENV);                                                             // op=holiday 처럼 한 인스턴스가 둘 다 쓴다
  assert.equal(w.issued.length, 2); assert.ok(w.issued[1].startsWith(VTS));
  w.edge.clear(); const calls = w.worker.length;
  assert.equal(await K.getToken(REALENV), t); assert.equal(await K.getToken(ENV), v);          // 메모리에서 — 다시 받거나 묻지 않는다
  assert.equal(w.issued.length, 2); assert.equal(w.worker.length, calls);
  assert.ok(w.worker.every(x => !x.raw.includes(t) && !x.url.includes(t)));                    // 실전 토큰은 한 번도 Worker 로 안 갔다
});

test("한투가 알려준 만료 시각(한국시간)을 쓴다 — 6시간 안 재요청엔 예전 토큰이 와서 24시간이 다 남지 않는다", async () => {
  const exp = Math.floor((Date.now() + 3 * 3600e3) / 1000) * 1000;                             // 3시간 뒤
  const kst = new Date(exp + 9 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
  const w = world({ expiredAt: kst }); fresh();
  await K.getToken(ENV);
  assert.equal(w.central.get(await K.tokenId(ENV)).exp, exp);
  const w2 = world({ expiredAt: "2099-01-01 00:00:00" }); fresh();                              // 이상한 값이어도 24시간을 넘기지 않는다
  await K.getToken(ENV);
  assert.ok(w2.central.get(await K.tokenId(ENV)).exp - Date.now() <= 864e5);
});

test("감시키가 없거나 Worker 가 안 되면 예전처럼 직접 받는다(호출을 막지 않음)", async () => {
  let w = world(); fresh();
  await K.getToken({ KIS_ENV: "vts", KIS_APPKEY: "a", KIS_APPSECRET: "b" });
  assert.equal(w.issued.length, 1); assert.equal(w.worker.length, 0);
  w = world({ workerDown: true }); fresh();
  assert.match(await K.getToken(ENV), /^TOKEN-1-/); assert.equal(w.issued.length, 1);
});

test("한투가 토큰을 거절하면 그 토큰만 버리고 다음 호출에서 새로 받는다 · 다른 곳이 새로 받은 토큰은 지우지 않는다", async () => {
  const w = world(); fresh();
  const t1 = await K.getToken(ENV), k = await K.tokenId(ENV);
  const r = await K.getToken(REALENV);
  await K.dropToken(t1);
  assert.equal(w.central.has(k), false); assert.equal(w.edge.size, 1);                         // 모의 것만 — 실전 엣지 캐시는 그대로
  assert.equal(await K.getToken(REALENV), r);
  const t2 = await K.getToken(ENV);
  assert.notEqual(t2, t1); assert.equal(w.issued.length, 3);
  const newer = JSON.stringify({ token: "NEWER-TOKEN-abcdefghijklmnopqrstuvwxyz", exp: Date.now() + 20 * 3600e3 });
  w.central.set(k, JSON.parse(newer)); w.edge.set("https://kis-token.internal/v2/" + k, newer);   // 다른 인스턴스가 막 새로 받아 맡김
  await K.dropToken(t2);                                                                        // 내 것(t2) 만 버린다
  assert.equal(w.central.get(k).token, "NEWER-TOKEN-abcdefghijklmnopqrstuvwxyz");
  assert.equal(JSON.parse(w.edge.get("https://kis-token.internal/v2/" + k)).token, "NEWER-TOKEN-abcdefghijklmnopqrstuvwxyz");
  let calls = w.worker.length;
  assert.equal(await K.getToken(ENV), "NEWER-TOKEN-abcdefghijklmnopqrstuvwxyz"); assert.equal(w.issued.length, 3);
  assert.equal(w.worker.length, calls);                                                         // 엣지 캐시에서 — Worker 에 묻지도 않는다
  await K.dropToken("UNKNOWN-abcdefghijklmnopqrstuvwxyz");                                     // 모르는 토큰 — 아무것도 안 지운다
  assert.equal(w.worker.length, calls);
  assert.equal(await K.getToken(ENV), "NEWER-TOKEN-abcdefghijklmnopqrstuvwxyz"); assert.equal(w.issued.length, 3);
  // 실제 조회 경로: 예상체결가 조회가 EGW00123 을 받으면 그 요청에 쓴 토큰을 버린다
  fresh(); w.edge.clear(); w.central.clear();
  const t3 = await K.getToken(ENV);
  const res = await K.onRequestGet({ request: new Request("https://p.test/api/kis?op=expected&env=vts&code=005930"), env: { ...ENV, KIS_ACCOUNT: "50000000-01" } });
  assert.equal(w.other.length, 1); assert.equal(w.other[0].auth, "Bearer " + t3); assert.notEqual(res.status, 200);   // 거절은 다시 묻지 않는다(초당제한과 다름)
  assert.equal(w.central.has(k), false);
  assert.notEqual(await K.getToken(ENV), t3); assert.equal(w.issued.length, 5);
});

test("주문이 토큰 거절을 받으면 토큰만 버리고 주문은 다시 내지 않는다(국내 · 미국 주문구분 되던짐도 안 함)", async () => {
  const w = world(); fresh();
  const env = { ...ENV, KIS_ACCOUNT: "50000000-01" }, k = await K.tokenId(ENV);
  const post = (body) => K.onRequestPost({ request: new Request("https://p.test/api/kis?op=order", { method: "POST",
    headers: { "x-autotrade-key": "mk", "content-type": "application/json" }, body: JSON.stringify({ env: "vts", ...body }) }), env });
  const t1 = await K.getToken(env);
  const kr = await post({ side: "buy", code: "005930", qty: 1, price: 70000 });
  assert.equal(kr.status, 502); assert.equal(w.other.filter(x => x.url.endsWith("/trading/order-cash")).length, 1);
  assert.equal(w.central.has(k), false);
  const t2 = await K.getToken(env); assert.notEqual(t2, t1);
  const us = await post({ side: "buy", code: "SOXL", market: "AMEX", qty: 1, price: 100, ordDvsn: "34" });
  assert.equal(us.status, 502); assert.equal(w.other.filter(x => x.url.endsWith("/overseas-stock/v1/trading/order")).length, 1);
  assert.equal((await us.json()).fellBack, undefined);
  assert.equal(w.central.has(k), false); assert.notEqual(await K.getToken(env), t2);
});

test("Pages 의 저장소 주소는 단타(클로드) Worker 주소와 같다", () => {
  const kis = fs.readFileSync(KIS_SRC, "utf8");
  const main = fs.readFileSync(path.join(root, "functions/api/_claude_main.js"), "utf8");
  const a = (kis.match(/const TOK_WORKER = "([^"]+)"/) || [])[1], b = (main.match(/export const WORKER = "([^"]+)"/) || [])[1];
  assert.ok(a && b); assert.equal(a, b); assert.equal(a + "/kis-token", WK);
});

test("Worker: 감시키 없으면 401 · 맡김/꺼냄/같은 토큰만 지움 · 만료는 지금+25시간 안 · 앱키 해시 이름표만", async () => {
  let src = fs.readFileSync(WORKER_SRC, "utf8");
  src = src.replace('import { DurableObject } from "cloudflare:workers";', "class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}")
    .replace(/"\.\.\/\.\.\/\.\.\/functions\/api\/([^"]+)"/g, (_, f) => JSON.stringify(pathToFileURL(path.join(root, "functions/api", f)).href));
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kt-")), "worker.mjs"); fs.writeFileSync(tmp, src);
  const W = await import(pathToFileURL(tmp).href);
  const now = Date.now(), k = "0123456789abcdef", tok = "TOKEN-abcdefghijklmnopqrstuvwxyz";
  assert.deepEqual(W.kisTokenRecord({ k, token: tok, exp: now + 864e5 }, now), { k, token: tok, exp: now + 864e5 });
  for (const bad of [{ k: "PSappkey", token: tok, exp: now + 864e5 }, { k, token: "short", exp: now + 864e5 }, { k, token: tok + " x", exp: now + 864e5 },
    { k, token: tok, exp: now + 26 * 3600e3 }, { k, token: tok, exp: now - 1 }, { k, token: tok, exp: now + 30e3 }, { k, drop: "" }, null])
    assert.equal(W.kisTokenRecord(bad, now), null, JSON.stringify(bad));
  assert.deepEqual(W.kisTokenRecord({ k, drop: tok }, now), { k, drop: tok });
  const mem = new Map();                                                                       // 실제 저장소처럼 복사본을 주고받는다
  const store = new W.OpeningSignalStore({ storage: { get: async x => structuredClone(mem.get(x)), put: async (x, v) => { mem.set(x, structuredClone(v)); } } }, {});
  const env = { MONITOR_KEY: "mk", SIGNAL_STORE: { idFromName: n => n, get: n => { assert.equal(n, "__kis_token__"); return { fetch: (u, i) => store.fetch(new Request(u, i)) }; } } };
  const call = (p, body, key = "mk") => W.default.fetch(new Request("https://w.test" + p, body ? { method: "POST", headers: { "x-monitor-key": key }, body: JSON.stringify(body) } : { headers: { "x-monitor-key": key } }), env);
  assert.equal((await call("/kis-token?k=" + k, null, "wrong")).status, 401);
  assert.equal((await call("/kis-token", { k, token: tok, exp: now + 864e5 }, "")).status, 401);
  assert.equal(mem.size, 0);
  assert.equal((await call("/kis-token", { k: "PSappkey", token: tok, exp: now + 864e5 })).status, 400);
  assert.equal((await (await call("/kis-token", { k, token: tok, exp: now + 864e5 })).json()).ok, true);
  assert.deepEqual(await (await call("/kis-token?k=" + k)).json(), { ok: true, token: tok, exp: now + 864e5 });
  await call("/kis-token", { k, drop: "OTHER-abcdefghijklmnopqrstuvwxyz" });                     // 다른 토큰은 안 지운다
  assert.equal((await (await call("/kis-token?k=" + k)).json()).token, tok);
  await call("/kis-token", { k, drop: tok });
  assert.equal((await (await call("/kis-token?k=" + k)).json()).token, null);
  mem.set("kisTokens", { [k]: { token: tok, exp: now - 1 } });                                   // 만료된 것은 돌려주지 않고 다음 저장 때 지운다
  assert.equal((await (await call("/kis-token?k=" + k)).json()).token, null);
  const k2 = "fedcba9876543210";
  await call("/kis-token", { k: k2, token: tok, exp: now + 864e5 });
  assert.deepEqual(Object.keys(mem.get("kisTokens")), [k2]);
});
