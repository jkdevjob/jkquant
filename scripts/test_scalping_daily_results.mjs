import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {liveLedgerSummary,mergeSessions,mergeDaytradingSessions,completedGlobalCandidates,soxlSessionCompletedAt,marketLedgerDateMatches,normalizeKstSessions,kstSessionDate,pairKst} from "../functions/api/scalping-daily-results.js";
import {dailyRisk as historyDailyRisk} from "../functions/api/scalping-history.js";

console.log("[scalping today] live ledger 우선/무매매/날짜 경계 값 시험");

const empty=liveLedgerSummary({
  date:"2026-10-02",updatedAt:"2026-10-03T05:05:00+09:00",
  strategyVersion:"soxl_orb_v1",trades:[]
},"2026-10-02","global-paper-live");
assert.equal(empty.noTrade,true);
assert.equal(empty.returnPct,0);
assert.equal(empty.trades,0);
assert.equal(empty.finalized,true);

const one=liveLedgerSummary({
  date:"2026-10-02",strategyVersion:"soxl_orb_v1",trades:[
    {status:"closed",pnlPct:1.2},{status:"closed",pnlPct:-0.4}
  ]
},"2026-10-02","global-paper-live");
assert.equal(one.noTrade,false);
assert.equal(one.trades,2);
assert.equal(one.wins,1);
assert.equal(one.losses,1);
assert.ok(Math.abs(one.returnPct-0.4)<1e-12);

const merged=mergeSessions(
  [{date:"2026-10-02",returnPct:0,noTrade:true,source:"global-paper-live"}],
  [{date:"2026-10-02",returnPct:9,source:"research"},{date:"2026-10-01",returnPct:1,source:"research"}]
);
assert.equal(merged.length,2);
assert.equal(merged[0].date,"2026-10-02");
assert.equal(merged[0].source,"global-paper-live");
assert.equal(merged[0].returnPct,0);
assert.equal(merged[1].date,"2026-10-01");

const recovered=mergeDaytradingSessions(
  [{date:"2026-10-02",returnPct:0,trades:0,noTrade:true,source:"daytrading-paper-live",mainVariant:"baseline"}],
  [{date:"2026-10-02",returnPct:-0.25,trades:3,noTrade:false,source:"daytrading-research",mainVariant:"baseline"}]
);
assert.equal(recovered[0].trades,0);
assert.equal(recovered[0].noTrade,true);
assert.equal(recovered[0].returnPct,0);
assert.equal(recovered[0].source,"daytrading-paper-live");
assert.equal(recovered[0].sourceConflict.researchTrades,3);
assert.equal(recovered[0].sourceConflict.researchReturnPct,-0.25);

const promotedNoTrade=mergeDaytradingSessions(
  [{date:"2026-10-02",returnPct:0,trades:0,noTrade:true,source:"daytrading-paper-live",mainVariant:"vol_2.0"}],
  [{date:"2026-10-02",returnPct:-0.25,trades:3,noTrade:false,source:"daytrading-research",mainVariant:"baseline"}]
);
assert.equal(promotedNoTrade[0].trades,0);
assert.equal(promotedNoTrade[0].noTrade,true);
assert.equal(promotedNoTrade[0].source,"daytrading-paper-live");

const now=Date.parse("2026-10-02T22:29:00Z"); // 10/03 07:29 KST = 10/02 18:29 ET
const crypto=completedGlobalCandidates("crypto",now);
const soxl=completedGlobalCandidates("soxl",now);
assert.equal(crypto[0],"2026-10-02"); // 한국 00:00~24:00 기준, 끝난 날
assert.equal(soxl[0],"2026-10-02");   // 미국 16:05 이후 끝난 거래일
assert.ok(!soxl.some(d=>["0","6"].includes(String(new Date(d+"T12:00:00Z").getUTCDay()))));

assert.equal(kstSessionDate("soxl","2026-10-02"),"2026-10-03");
assert.equal(kstSessionDate("crypto","2026-10-02"),"2026-10-02");
const alignedSoxl=pairKst("soxl","SOXL",{sessions:[
  {date:"2026-10-02",returnPct:0.7,trades:1,wins:1,losses:0,noTrade:false,finalized:true}
]},"2026-10-03");
assert.equal(alignedSoxl.marketTime,"KST");
assert.equal(alignedSoxl.current.date,"2026-10-03");
assert.equal(alignedSoxl.current.marketDate,"2026-10-02");
assert.equal(alignedSoxl.current.returnPct,0.7);
const alignedCrypto=pairKst("crypto","비트코인",{sessions:[
  {date:"2026-10-02",returnPct:0,trades:0,wins:0,losses:0,noTrade:true,finalized:true}
]},"2026-10-03");
assert.equal(alignedCrypto.current.date,"2026-10-03");
assert.equal(alignedCrypto.current.pending,true);
assert.equal(alignedCrypto.previous.date,"2026-10-02");

const dayHistory=historyDailyRisk([
  {date:"2026-10-01",pnl:3.0},
  {date:"2026-10-01",pnl:-1.0},
  {date:"2026-10-02",pnl:1.5}
],"daytrading");
assert.equal(dayHistory.daily.length,2);
assert.ok(Math.abs(dayHistory.daily[0].returnPct-(2/3))<1e-12); // 2% net / 3 fixed slots
assert.ok(Math.abs(dayHistory.daily[1].returnPct-0.5)<1e-12);   // one trade, two unused cash slots

const dbNoTrade=historyDailyRisk([
  {date:"2026-10-01",pnl:1.5}
],"daytrading",["2026-10-01","2026-10-02"]);
assert.equal(dbNoTrade.daily.length,2);
assert.equal(dbNoTrade.daily[1].date,"2026-10-02");
assert.equal(dbNoTrade.daily[1].returnPct,0); // durable DB no-trade date remains in cumulative curve

const openingHistory=historyDailyRisk([
  {date:"2026-10-01",pnl:3.0},
  {date:"2026-10-01",pnl:-1.0}
],"opening");
assert.equal(openingHistory.daily[0].returnPct,1.0); // existing equal-weight opening rule remains unchanged


// SOXL은 ET 16:05 이후에만 확정: 10/08 한국 오전은 미국 10/07 장이 맞다.
const beforeClose=Date.parse("2026-10-07T20:04:00Z"); // ET 16:04, KST 10/08 05:04
const afterClose=Date.parse("2026-10-07T20:05:00Z");  // ET 16:05, KST 10/08 05:05
assert.equal(soxlSessionCompletedAt("2026-10-07",beforeClose),false);
assert.equal(soxlSessionCompletedAt("2026-10-07",afterClose),true);
assert.equal(soxlSessionCompletedAt("2026-10-08",afterClose),false);
assert.equal(soxlSessionCompletedAt("2026-10-03",afterClose),false); // 토요일 휴장
assert.equal(marketLedgerDateMatches({date:"2026-10-06"},"2026-10-07"),false);
assert.equal(marketLedgerDateMatches({date:"2026-10-07"},"2026-10-07"),true);
const candidate={sessions:[{date:"2026-10-07",returnPct:-1.4,trades:1}]};
assert.equal(normalizeKstSessions("soxl",candidate,beforeClose).length,0);
const after=normalizeKstSessions("soxl",candidate,afterClose);
assert.equal(after.length,1);
assert.equal(after[0].date,"2026-10-08");
assert.equal(after[0].marketDate,"2026-10-07");
// 사용자 화면: KST 10/08에 미국 10/08 거래가 있었다는 오독을 방지한다.
const ui=readFileSync(new URL("../scalping.html",import.meta.url),"utf8");
const cellFn=ui.slice(ui.indexOf("function dailyResultCell("),ui.indexOf("const DAILY_CHART_COLORS="));
assert.ok(cellFn.startsWith("function dailyResultCell("));
const stateFn=ui.slice(ui.indexOf('function dailyResultState('),ui.indexOf('function dailyResultCell('));
const sourceFn=ui.slice(ui.indexOf('function scalpingResultSource('),ui.indexOf('const DAILY_TREND_STEP='));
const renderCell=new Function("esc",stateFn+sourceFn+cellFn+"; return dailyResultCell;")(
  s=>String(s).replaceAll("&","&amp;").replaceAll("<","&lt;"));
const rendered=renderCell({...after[0],wins:0,losses:1,noTrade:false},"최근","soxl");
assert.match(rendered,/최근 · 미국 10-07장/);
assert.match(rendered,/한국 2026-10-08 새벽 마감 기준/);
assert.match(rendered,/-1\.40%/);
assert.ok(!rendered.includes("미국 10-08장"));
const wait=renderCell({date:"2026-10-09",marketDate:"2026-10-08",pending:true,pendingReason:"미국 정규장 종료 대기"},"최근","soxl");
assert.match(wait,/미국 10-08장/);assert.match(wait,/>대기</);

console.log("ALL PASS — scalping today live results");


const missingPriorCrypto=pairKst("crypto","비트코인",{sessions:[]},"2026-10-22");
assert.equal(missingPriorCrypto.current.pending,true,'current crypto may await same-day close');
assert.equal(missingPriorCrypto.previous.date,'2026-10-21');
assert.equal(missingPriorCrypto.previous.unavailable,true,'yesterday must not wait forever');
assert.equal(missingPriorCrypto.previous.pending,undefined);
assert.equal(missingPriorCrypto.previous.returnPct,null,'no fake zero profit for lost ledger');
assert.equal(missingPriorCrypto.status,'degraded');
const missingKr=pairKst("opening","시초가",{sessions:[]},"2026-10-22",[{date:"2026-10-21",open:true}]);
assert.equal(missingKr.previous.unavailable,true,'previous open market day without archival is unverified');
const sat=pairKst("opening","시초가",{sessions:[]},"2026-10-18");
assert.equal(sat.previous.marketClosed,true,'Saturday remains a real market holiday');

const incompletePrior=pairKst("crypto","비트코인",{sessions:[{date:"2026-10-21",pending:true,finalized:false,returnPct:null}]},"2026-10-22");
assert.equal(incompletePrior.previous.unavailable,true,'incomplete recorded previous crypto is also unverified');
assert.equal(incompletePrior.previous.pending,false,'incomplete previous session cannot remain pending');
assert.equal(incompletePrior.previous.returnPct,null);
