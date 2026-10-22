// 단타(클로드) 전략별 매매 이력 조회 API — node --test tests/claude-history.test.mjs
// 사용자 요청(2026-10-22): "모든 탭 그림자 전략 포함 모든 매매이력 기록하고 조회 가능하게 만들어".
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const H = await import(pathToFileURL(process.env.JKQ_HISTORY_SRC || path.join(root, "functions/api/claude-history.js")).href);
const P = q => H.historyPath(new URLSearchParams(q));

test("읽을 파일 경로: 목록 · 탭/버전만 — 경로 문자 · 모르는 탭은 막는다", () => {
  assert.deepEqual(P("index=1"), { path: "index.json" });
  assert.deepEqual(P("tab=opening&version=g_open_q7_k3_gap3"), { path: "opening/g_open_q7_k3_gap3.json" });
  assert.deepEqual(P("tab=opening&version=opening_gapdown_v1%2Bv2filter"), { path: "opening/opening_gapdown_v1%2Bv2filter.json" });   // + 는 인코딩
  assert.deepEqual(P("tab=crypto&version=coin_breakout_v1:KRW-BTC"), { path: "crypto/coin_breakout_v1%3AKRW-BTC.json" });
  for (const q of ["tab=opening&version=../latest", "tab=opening&version=a/b", "tab=opening&version=..", "tab=opening&version=", "tab=x&version=v1",
    "tab=opening&version=" + "a".repeat(81), "tab=opening&version=a%20b", "version=v1"])
    assert.ok(P(q).error, q);
});

test("소유자 확인 없이는 401 — GitHub 를 부르지 않는다", async () => {
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called++; return new Response("{}"); };
  try {
    const r = await H.onRequestGet({ request: new Request("https://p.test/api/claude-history?index=1"), env: {} });
    assert.equal(r.status, 401);
    assert.equal(called, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("감시키로 부르면 파일을 그대로 돌려주고 · 없으면 404 · 잘못된 요청은 400", async () => {
  const realFetch = globalThis.fetch, urls = [];
  globalThis.fetch = async (u) => {
    urls.push(String(u));
    if (String(u).includes("/history/opening/missing.json")) return new Response("", { status: 404 });
    return new Response(JSON.stringify({ version: "v1", backtest: [] }));
  };
  const env = { OPENING_MONITOR_KEY: "mk" }, req = q => new Request("https://p.test/api/claude-history?" + q, { headers: { "x-monitor-key": "mk" } });
  try {
    let r = await H.onRequestGet({ request: req("tab=opening&version=v1"), env });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).data, { version: "v1", backtest: [] });
    assert.ok(urls[0].startsWith("https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/claude-lab/history/opening/v1.json?t="));
    r = await H.onRequestGet({ request: req("tab=opening&version=missing"), env });
    assert.equal(r.status, 404);
    r = await H.onRequestGet({ request: req("tab=opening&version=../x"), env });
    assert.equal(r.status, 400);
    assert.equal(urls.length, 2);
  } finally { globalThis.fetch = realFetch; }
});
