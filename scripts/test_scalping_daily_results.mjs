import assert from "node:assert/strict";
import {liveLedgerSummary,mergeSessions,mergeDaytradingSessions,completedGlobalCandidates} from "../functions/api/scalping-daily-results.js";

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
assert.equal(recovered[0].trades,3);
assert.equal(recovered[0].noTrade,false);
assert.equal(recovered[0].returnPct,-0.25);
assert.equal(recovered[0].source,"daytrading-research-confirmed");

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

console.log("ALL PASS — scalping today live results");
