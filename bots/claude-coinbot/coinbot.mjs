#!/usr/bin/env node
// ③ 실투자 봇 실행기 — 사용자 서버(systemd claude-coinbot)에서 돈다. 설치 · 사용법은 같은 폴더 README.md.
//   node coinbot.mjs            봇 실행(멈추지 않고 돈다 — systemd 가 다시 켠다)
//   node coinbot.mjs --check    설치 확인(시계 · 시세 · 메인 · 키 · 주문 권한 · 보고) — 실제 주문은 내지 않는다
//   node coinbot.mjs --status   지금 상태(보유 · 오늘 계획 · 보낼 알림)
// 설정(~/.claude-coinbot/env · systemd EnvironmentFile): UPBIT_ACCESS_KEY · UPBIT_SECRET_KEY · COINBOT_REPORT_KEY · BUDGET_KRW(기본 600000) ·
//   DRY_RUN(기본 1 = 시험 · 0 = 실전) · COINBOT_BASE_URL(기본 https://jkquant.pages.dev) · COINBOT_DIR(상태 폴더)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Bot, STRATEGY, MARKET, MIN_ORDER_KRW, upbitClient, reporter, fetchMainConfig, planOf, strategyCheck, entryDecision, upbitDay, freeOf } from "./bot.mjs";
import { coinDaysNeeded } from "../../functions/api/_claude_main.js";
import { REAL_HEAD } from "../../functions/api/_claude_real.js";

const env = process.env;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = env.COINBOT_DIR || path.join(os.homedir(), ".claude-coinbot");
const DRY = String(env.DRY_RUN ?? "1") !== "0";
const STATE = path.join(DIR, DRY ? "state-dry.json" : "state-live.json");   // 시험 · 실전 상태를 섞지 않는다
const PAUSE = path.join(DIR, "PAUSE");
const FILLS = path.join(DIR, "fills.csv");
const log = (...a) => console.log(new Date().toISOString(), ...a);

export function fileStore(file) {
  return {
    load: async () => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } },
    save: async s => {                                                  // 임시 파일에 쓰고 디스크에 내린 뒤 바꾼다 — 쓰다 꺼져도 앞 상태가 남는다
      const tmp = file + ".tmp", fd = fs.openSync(tmp, "w", 0o600);
      try { fs.writeSync(fd, JSON.stringify(s, null, 1)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    },
  };
}
function version() { try { return execFileSync("git", ["-C", HERE, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch (e) { return ""; } }
function fillsCsv(state) {                                             // 체결 기록 사본(사람이 보는 용) — 상태 파일이 정본
  const rows = ["day,side,status,price,volume,funds,fee,identifier,uuid"];
  for (const [d, x] of Object.entries(state.days || {}).sort()) for (const side of ["buy", "sell"]) {
    const o = x[side]; if (!o || o.status !== "done" || o.dry) continue;
    rows.push([d, side, o.status, o.price, o.volume, o.funds, o.fee, o.identifier, o.uuid].join(","));
  }
  return rows.join("\n") + "\n";
}

async function check() {
  const ok = [], bad = [], api = upbitClient({ accessKey: env.UPBIT_ACCESS_KEY, secretKey: env.UPBIT_SECRET_KEY });
  const say = (good, msg) => { (good ? ok : bad).push(msg); console.log((good ? "✅ " : "❌ ") + msg); };
  console.log("③ 실투자 봇 설치 확인 — 주문은 내지 않습니다. 모드: " + (DRY ? "시험(DRY_RUN=1)" : "실전(DRY_RUN=0)") + " · 예산 " + (+env.BUDGET_KRW || 600000).toLocaleString("en-US") + "원 · 상태 " + DIR);
  console.log("Node " + process.version + " · 봇 판 " + (version() || "?"));
  const t = await api.ticker().catch(e => ({ ok: false, error: String(e) }));
  say(t.ok, "업비트 시세 받기" + (t.ok ? " — ETH " + Math.round(+t.json[0].trade_price).toLocaleString("en-US") + "원" : " 실패 " + (t.status || t.error)));
  if (t.date) { const skew = Math.abs(Date.parse(t.date) - Date.now()) / 1000; say(skew < 5, "서버 시계 차이 " + skew.toFixed(1) + "초" + (skew < 5 ? "" : " — 시간 맞추기(timedatectl) 필요")); }
  const D = upbitDay(Date.now()), d = await api.days(coinDaysNeeded(STRATEGY.params) + 3).catch(() => ({ ok: false }));
  const plan = planOf(d.ok ? d.json : null, D);
  say(plan.ready, "오늘(" + D + ") 계획 — " + (plan.ready ? (plan.hold ? "돌파 대기: " + Math.round(plan.level).toLocaleString("en-US") + "원 넘으면 매수" : "쉼: 어제 종가 " + Math.round(plan.prevClose).toLocaleString("en-US") + " < 15일 평균 " + Math.round(plan.ma).toLocaleString("en-US")) : plan.why));
  if (plan.ready && t.ok) console.log("   지금 판단: " + JSON.stringify(entryDecision(plan, t.json[0])));
  const mc = await fetchMainConfig();
  if (mc.ok) { const c = strategyCheck(mc.events, D); say(c.ok, "③ 메인 = 봇 전략(" + STRATEGY.version + ")" + (c.ok ? "" : " — " + c.why)); }
  else say(false, "메인 기록 받기 실패 " + mc.error + " (봇은 고정 전략으로 진행)");
  if (!env.UPBIT_ACCESS_KEY || !env.UPBIT_SECRET_KEY) say(false, "업비트 키 없음 — " + path.join(DIR, "env") + " 에 UPBIT_ACCESS_KEY · UPBIT_SECRET_KEY");
  else {
    const a = await api.accounts().catch(e => ({ ok: false, error: String(e) }));
    const why = a.json && a.json.error ? a.json.error.name + " " + (a.json.error.message || "") : a.status || a.error;
    say(a.ok, "업비트 키 · 허용 IP(자산조회)" + (a.ok ? " — 원화 " + Math.round(freeOf(a.json, "KRW")).toLocaleString("en-US") + "원 · ETH " + freeOf(a.json, "ETH") : " 실패 " + why + (/ip/i.test(String(why)) ? " — 업비트 허용 IP 에 이 서버 IP 를 넣었는지 확인" : "")));
    const c = await api.chance().catch(e => ({ ok: false, error: String(e) }));
    say(c.ok, "주문 조회 권한(주문 가능 정보)" + (c.ok ? " — 수수료 " + (+c.json.bid_fee * 100).toFixed(3) + "%" : " 실패 " + (c.json && c.json.error ? c.json.error.name : c.status || c.error)));
    // 주문하기 권한 — 최소 금액(5,000원)보다 작은 1,000원 매수를 보내 업비트가 '최소 금액 미만'으로 거절하는지 본다(체결되지 않는다)
    const p = await api.place({ market: MARKET, side: "bid", ord_type: "price", price: "1000", identifier: "jkq-c3-check-" + Date.now() }).catch(e => ({ ok: false, error: String(e) }));
    const name = p.json && p.json.error ? p.json.error.name : "";
    const perm = !p.ok && /min|under|total|minimum/i.test(name) && !/scope|authorization|ip/i.test(name);
    say(perm, "주문하기 권한(1,000원 시험 주문 → 최소 금액 미만 거절 기대)" + (perm ? " — 거절 확인(" + name + ")" : " — 응답 " + (p.status || "") + " " + (name || p.error || JSON.stringify(p.json || {}).slice(0, 120))
      + (p.ok ? " ⚠️ 시험 주문이 들어감 — 업비트 앱에서 확인" : "")));
  }
  const rep = reporter({ base: env.COINBOT_BASE_URL || "https://jkquant.pages.dev", key: env.COINBOT_REPORT_KEY || "" });
  const r = await rep({ op: "event", text: REAL_HEAD + "🔧 ETH 실투자 봇 설치 확인 — " + (bad.length ? "문제 " + bad.length + "개" : "모두 통과") + " · " + (DRY ? "시험 모드" : "실전") });
  say(r.ok, "알림 보내기(Cloudflare CLAUDE_COINBOT_KEY · 텔레그램)" + (r.ok ? " — 텔레그램을 확인하세요" : " 실패 " + (r.status || "") + " " + (r.error || "")));
  console.log("\n결과: 통과 " + ok.length + " · 문제 " + bad.length + (bad.length ? " — README.md '문제가 있을 때'를 보세요" : ""));
  process.exitCode = bad.length ? 1 : 0;
}

async function run() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const store = fileStore(STATE);
  const bot = new Bot({ api: upbitClient({ accessKey: env.UPBIT_ACCESS_KEY, secretKey: env.UPBIT_SECRET_KEY }), store,
    report: reporter({ base: env.COINBOT_BASE_URL || "https://jkquant.pages.dev", key: env.COINBOT_REPORT_KEY || "" }),
    mainConfig: () => fetchMainConfig(), paused: () => fs.existsSync(PAUSE), env, ver: version(), log });
  if (!DRY && (!env.UPBIT_ACCESS_KEY || !env.UPBIT_SECRET_KEY)) { log("실전인데 업비트 키가 없음 — 멈춤"); process.exit(2); }
  let stop = false, lastErr = { msg: "", at: 0 };
  process.on("SIGTERM", () => { stop = true; }); process.on("SIGINT", () => { stop = true; });
  await bot.init();
  log("시작 —", bot.mode, "· 예산", bot.budget, "· 상태", STATE);
  while (!stop) {
    let st = null;
    try { st = await bot.step(); fs.writeFileSync(FILLS, fillsCsv(bot.state), { mode: 0o600 }); }
    catch (e) {
      const msg = String(e && e.message || e);
      log("오류", msg);
      if (msg !== lastErr.msg || Date.now() - lastErr.at > 36e5) {         // 같은 오류 알림은 한 시간에 한 번
        lastErr = { msg, at: Date.now() };
        await bot.emit({ op: "event", text: REAL_HEAD + "⚠️ ETH 실투자 봇 오류 — " + msg.slice(0, 200) + " (계속 다시 시도)" }).catch(() => {});
      }
    }
    const k = new Date(Date.now() + 9 * 36e5), hm = k.getUTCHours() * 100 + k.getUTCMinutes();
    const nearOpen = hm >= 859 && hm < 903;                              // 09:00 앞뒤 — 매도 · 새 계획을 바로
    const wait = st && st.watching || nearOpen ? 2000 : 15000;
    for (let s = 0; s < wait && !stop; s += 500) await new Promise(r => setTimeout(r, 500));
  }
  log("멈춤(신호)");
}

async function status() {
  const s = await fileStore(STATE).load();
  if (!s) return console.log("상태 없음 — 아직 안 돌았음(" + STATE + ")");
  const D = upbitDay(Date.now()), day = s.days[D] || {};
  console.log(JSON.stringify({ mode: DRY ? "시험" : "실전", position: s.position, today: { plan: day.plan, check: day.check, buy: day.buy }, outbox: s.outbox.length, paused: fs.existsSync(PAUSE) }, null, 1));
}

const arg = process.argv[2] || "";
if (arg === "--check") await check();
else if (arg === "--status") await status();
else if (!arg) await run();
else { console.log("사용: node coinbot.mjs [--check | --status]"); process.exitCode = 2; }
