import assert from "node:assert/strict";
import {DUEL_START,COSTS,TOTAL_WEIGHT,WIN_EDGE_PCT,grossPct,normalizeClaudeEvents,normalizeTrades,sideDay,winner,buildDuel} from "../functions/api/_scalping_duel.js";

const T=["opening","daytrading","crypto","soxl"];
const empty=()=>Object.fromEntries(T.map(k=>[k,new Map()]));
const cov=()=>Object.fromEntries(T.map(k=>[k,new Set()]));
const trade=(e,x,n="X")=>normalizeTrades([{name:n,entryPrice:e,exitPrice:x}])[0];

console.log("[scalping duel] 규칙 값 시험");
assert.equal(DUEL_START,"2026-10-05");                                  // 규칙2
assert.equal(TOTAL_WEIGHT,0.25); assert.equal(WIN_EDGE_PCT,0.01);       // 규칙5,6
assert.deepEqual(COSTS,{gpt:{opening:.25,daytrading:.25,crypto:.14,soxl:.20},claude:{opening:.25,daytrading:.15,crypto:.14,soxl:.20}}); // 규칙3
assert.ok(Math.abs(grossPct(100,101)-1)<1e-12);

const ce=normalizeClaudeEvents([
 {date:"2026-10-04",ledger:{events:[{id:"close:opening",payload:{date:"2026-10-04",status:"closed",trades:[{entryPrice:100,exitPrice:110}]}}]}},
 {date:"2026-10-05",ledger:{events:[
   {id:"close:opening",payload:{date:"2026-10-05",status:"holiday",trades:[{entryPrice:100,exitPrice:200}]}},
   {id:"close:daytrading",payload:{date:"2026-10-05",status:"closed",trades:[]}},
   {id:"other",payload:{date:"2026-10-05",status:"closed",trades:[{entryPrice:100,exitPrice:200}]}}
 ]}},
 {date:"2026-10-06",ledger:{events:[{id:"close:crypto",payload:{date:"2026-10-06",status:"closed",trades:[
   {name:"BTC",entryPrice:100,exitPrice:101},{name:"ETH",entryPrice:100,exitPrice:99}
 ]}}]}}
]);
assert.equal(ce.opening.size,0);                                       // 규칙1: 시작 전/holiday/비-close 제외
assert.equal(ce.daytrading.has("2026-10-05"),true);                    // no-trade closed도 기록
assert.equal(ce.crypto.get("2026-10-06").trades[0].slot,.5);           // 규칙4: BTC/ETH 반반
assert.ok(Math.abs(sideDay(ce.crypto.get("2026-10-06").trades,.14)-(-.14))<1e-9); // +0.86%와 -1.14% 반반 = -0.14%

const cr=empty(),gt=empty(),gc=cov();
cr.opening.set("2026-10-05",{trades:[trade(100,101)]});
cr.opening.set("2026-10-06",{trades:[]});
cr.opening.set("2026-10-07",{trades:[trade(100,102)]});
gt.opening.set("2026-10-05",[trade(100,100.5)]);
gt.opening.set("2026-10-08",[trade(100,110)]);
gc.opening.add("2026-10-05");gc.opening.add("2026-10-06");gc.opening.add("2026-10-08");
const d=buildDuel({claudeRecords:cr,gptTrades:gt,gptCoverage:gc});
assert.deepEqual(d.tabs.opening.days.map(x=>x.date),["2026-10-05","2026-10-06"]); // 규칙2: 교집합만
assert.deepEqual(d.tabs.opening.pending.map(x=>x.date),["2026-10-07","2026-10-08"]); // 한쪽만 기록 대기
assert.ok(Math.abs(d.tabs.opening.days[0].gpt.pnlPct-.25)<1e-9);       // 0.5 gross - 0.25
assert.ok(Math.abs(d.tabs.opening.days[0].claude.pnlPct-.75)<1e-9);   // 1 gross - 0.25
assert.equal(d.tabs.opening.days[0].winner,"claude");
assert.equal(d.tabs.opening.days[1].gpt.pnlPct,0);assert.equal(d.tabs.opening.days[1].claude.pnlPct,0); // 매매없음=0
assert.equal(winner(.0100001,0),"gpt");assert.equal(winner(.01,0),"draw"); // 규칙6 정확한 >0.01

// 규칙5: 네 탭 25%씩
const cr2=empty(),gt2=empty(),gc2=cov();
for(const [i,k] of T.entries()){
  cr2[k].set("2026-10-05",{trades:[trade(100,101+i)]});
  gt2[k].set("2026-10-05",[trade(100,100)]);
  gc2[k].add("2026-10-05");
}
const d2=buildDuel({claudeRecords:cr2,gptTrades:gt2,gptCoverage:gc2});
const expectedClaude=.25*((1-.25)+(2-.15)+(3-.14)+(4-.20));
const expectedGpt=.25*((0-.25)+(0-.25)+(0-.14)+(0-.20));
assert.ok(Math.abs(d2.total.days[0].claudePct-expectedClaude)<1e-9);
assert.ok(Math.abs(d2.total.days[0].gptPct-expectedGpt)<1e-9);

// 규칙7: 소스 날짜를 임의 KST/US 변환하지 않고 그대로 키로 사용
cr2.soxl.set("2026-10-06",{trades:[]});gc2.soxl.add("2026-10-06");
const d3=buildDuel({claudeRecords:cr2,gptTrades:gt2,gptCoverage:gc2});
assert.ok(d3.tabs.soxl.days.some(x=>x.date==="2026-10-06"));

console.log("[scalping duel] 변이 시험");
function killed(label,mutantCheck){assert.equal(mutantCheck(),true,"변이를 못 잡음: "+label);console.log("  ✓ "+label+" 변이 적발");}
killed("시작일 무시",()=>["2026-10-04","2026-10-05"].filter(x=>x>=DUEL_START).length!==2);
killed("한쪽만 있는 날 포함",()=>new Set(["2026-10-05","2026-10-06","2026-10-07","2026-10-08"]).size!==d.tabs.opening.days.length);
killed("비용 다르게",()=>Math.abs((grossPct(100,101)-.10)-d.tabs.opening.days[0].claude.pnlPct)>1e-9);
killed("합계 25% 균등 아님",()=>Math.abs((.4*(1-.25)+.2*(2-.15)+.2*(3-.14)+.2*(4-.20))-d2.total.days[0].claudePct)>1e-9);
console.log("ALL PASS — scalping duel rules");
