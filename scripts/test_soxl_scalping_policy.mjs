#!/usr/bin/env node
import fs from "node:fs";
const read=p=>fs.readFileSync(p,"utf8");
const policy=JSON.parse(read("scalping-policy.json"));
const yml=read(".github/workflows/soxl-research.yml");
const collector=read("scripts/collect_soxl_data.py");
const bt=read("scripts/backtest_soxl_intraday.py");
const worker=read("worker/global-intraday-scheduler/src/index.js");
const shadow=read("scripts/daily1_shadow_lab.py");
const lab=read("scripts/claude_lab.py");
const html=read("claude.html");
const live=read("functions/api/claude-live.js");
const tg=read("functions/api/claude-telegram.js");
const gpt=read("scalping.html");

function ok(v,msg){if(!v){console.error("✗ "+msg);process.exit(1)}console.log("✓ "+msg)}

ok(policy.defaultMaxHoldingTradingDays===1,"default stock holding <= 1 trading day");
ok(policy.absoluteMaxHoldingTradingDays===5,"absolute exceptional holding cap = 5 trading days");
ok(policy.stockStrategies.soxl.tradeSymbol==="SOXL"&&!policy.stockStrategies.soxl.allowTradeSymbolSubstitution,"SOXL trade symbol is locked to SOXL");
ok(policy.stockStrategies.opening.maxHoldingTradingDays===1&&policy.stockStrategies.daytrading.maxHoldingTradingDays===1&&policy.stockStrategies.soxl.maxHoldingTradingDays===1,"active stock tabs are <= 1 trading day");

ok(/cron: "10 20 \* \* 1-5"/.test(yml)&&/cron: "10 21 \* \* 1-5"/.test(yml),"SOXL post-close schedules cover DST and standard time");
ok(/TZ=America\/New_York date \+%H%M/.test(yml)&&/"\$NY_HM" -lt 1605/.test(yml),"early DST/EST run is gated until US close");
ok(/python \.app\/scripts\/collect_soxl_data\.py/.test(yml)&&!/Yahoo 외부수집은 건너뛰고/.test(yml),"push run no longer skips the first SOXL collection");
ok(/SYMBOL = os\.environ\.get\("JKQ_SOXL_SYMBOL", "SOXL"\)/.test(collector)&&/hm\(last_dt\) < 1555/.test(collector),"collector is SOXL-only and requires a completed session");
ok(/DATA = Path\("data"\) \/ "soxl" \/ "SOXL" \/ "5m"/.test(bt)&&/max_hold_bars: int = 18/.test(bt),"GPT SOXL baseline uses SOXL 5m and max 90-minute hold");
ok(/finance\/chart\/SOXL/.test(worker)&&/const SOXL_STRATEGY_VERSION="soxl_orb_v1"/.test(worker)&&!/TQQQ/.test(worker),"live SOXL worker trades SOXL only");
ok(/"code": "SOXL"/.test(shadow)&&/sim_exit\(a, ent_i, entry, 1\.0, 2\.0, 1555, 12/.test(shadow),"SOXL power-hour candidate exits by 15:55 ET");
ok(/version="soxl_power_hour_v1"/.test(lab)&&/trade="SOXL"/.test(lab)&&/maxHoldingDays=1/.test(lab)&&/us_soxl/.test(lab),"Claude SOXL research is SOXL-only and one-day");
ok(!/TQQQ/.test(html)&&/SOXL 파워아워 추세 지속/.test(html)&&/id="clVer">v2\.3\.0/.test(html),"Claude SOXL UI no longer exposes TQQQ strategy");
ok(!/TQQQ/.test(live)&&/globalPaper\(env,"soxl"\)/.test(live)&&/code:"SOXL"/.test(live),"Claude live SOXL reads SOXL intraday paper ledger");
ok(!/TQQQ/.test(tg)&&/us_soxl/.test(tg)&&/④ SOXL 지난 세션/.test(tg),"Claude Telegram reports SOXL, not TQQQ");
ok(/id="scVer">v1\.33\.0/.test(gpt)&&/SOXL만 매매 · 최대90분 · 당일 청산/.test(gpt),"GPT SOXL UI states SOXL-only same-day policy");

console.log("✓ SOXL same-day policy: ALL PASS");
