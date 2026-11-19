import assert from "node:assert/strict";
import {DUEL_START,COSTS,TOTAL_WEIGHT,WIN_EDGE_PCT,grossPct,normalizeClaudeEvents,normalizeTrades,sideDay,winner,buildDuel} from "../functions/api/_scalping_duel.js";
import {setScalpFee} from "../functions/api/_scalp_cost.js";

const T=["opening","daytrading","crypto","soxl"];
const empty=()=>Object.fromEntries(T.map(k=>[k,new Map()]));
const cov=()=>Object.fromEntries(T.map(k=>[k,new Set()]));
const trade=(e,x,n="X")=>normalizeTrades([{name:n,entryPrice:e,exitPrice:x}])[0];

console.log("[scalping duel] 규칙 값 시험");
assert.equal(DUEL_START,"2026-10-05");                                  // 규칙2
assert.equal(TOTAL_WEIGHT,0.25); assert.equal(WIN_EDGE_PCT,0.01);       // 규칙5,6
// 규칙3 같은 비용표 = 공통 수수료 × 2 + 수수료 아닌 몫(_scalp_cost.js). 기본 율 0.25% 면 국내 0.72 · ETF 0.62 · 코인 0.54 · 미국 0.50
const costsNow=()=>JSON.parse(JSON.stringify(COSTS));
assert.deepEqual(costsNow(),{gpt:{opening:.72,daytrading:.72,crypto:.54,soxl:.5},claude:{opening:.72,daytrading:.62,crypto:.54,soxl:.5}});
setScalpFee(0.00015);assert.deepEqual([COSTS.gpt.opening,COSTS.claude.daytrading],[.25,.15]);   // 옛 국내 수수료(0.015%)면 옛 표(0.25 · 0.15)
setScalpFee(0.0005);assert.equal(COSTS.gpt.crypto,.14);setScalpFee(0.001);assert.equal(COSTS.claude.soxl,.2);   // 옛 업비트 0.05% · 미국 0.10%
setScalpFee(0.0025);
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
assert.ok(Math.abs(d.tabs.opening.days[0].gpt.pnlPct-(.5-.72))<1e-9);   // 0.5 gross - 0.72(국내 0.22 + 공통 수수료 0.25% × 2)
assert.ok(Math.abs(d.tabs.opening.days[0].claude.pnlPct-(1-.72))<1e-9); // 1 gross - 0.72
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
const expectedClaude=.25*((1-.72)+(2-.62)+(3-.54)+(4-.5));
const expectedGpt=.25*((0-.72)+(0-.72)+(0-.54)+(0-.5));
assert.ok(Math.abs(d2.total.days[0].claudePct-expectedClaude)<1e-9);
assert.ok(Math.abs(d2.total.days[0].gptPct-expectedGpt)<1e-9);

// 규칙7: 소스 날짜를 임의 KST/US 변환하지 않고 그대로 키로 사용
cr2.soxl.set("2026-10-06",{trades:[]});gc2.soxl.add("2026-10-06");
const d3=buildDuel({claudeRecords:cr2,gptTrades:gt2,gptCoverage:gc2});
assert.ok(d3.tabs.soxl.days.some(x=>x.date==="2026-10-06"));

// 대결 API 요청 한도(Cloudflare 한 번 실행 50) — 클로드 날짜 파일 60개 · 밤 묶음(duel-index.json) 이 있으면 지난 날은 묶음 · 최근 6일만 날짜 파일
console.log("[scalping duel] 요청 한도 · 묶음 = 날짜 파일 값 시험");
const SDsrc=(await import("node:fs")).readFileSync(new URL("../functions/api/scalping-duel.js",import.meta.url),"utf8");
const loadSD=async src=>import("data:text/javascript;base64,"+Buffer.from(src.replace(/from\s+(["'])\.\/([^"']+)\1/g,(m,q,f)=>"from "+q+new URL("../functions/api/"+f,import.meta.url).href+q)).toString("base64"));
const dayN=i=>new Date(Date.parse("2026-10-05T00:00:00Z")+i*864e5).toISOString().slice(0,10);
const dates=Array.from({length:60},(_,i)=>dayN(i)),NOW=Date.parse(dates[59]+"T12:00:00+09:00");
const fileOf=dd=>({ok:true,date:dd,ledger:{events:[{id:"close:crypto",payload:{date:dd,status:"closed",trades:[{name:"BTC",entryPrice:100,exitPrice:101+(+dd.slice(8))%3}]}},{id:"buy:x",payload:{}}]}});
const idxBody={schema:1,files:dates.slice(0,59).map(dd=>({date:dd,ledger:{events:fileOf(dd).ledger.events.filter(e=>e.id.startsWith("close:"))}}))};
const fakeGh=(withIndex,calls)=>async u=>{const url=String(u);calls.push(url);
  if(url.includes("/branches/"))return Response.json({commit:{sha:"s"}});
  if(url.includes("/git/trees/"))return Response.json({tree:[...dates.map(dd=>({path:"data/claude-live/"+dd+".json"})),...(withIndex?[{path:"data/claude-live/duel-index.json"}]:[])]});
  const m=url.match(/claude-live\/(\d{4}-\d{2}-\d{2})\.json/);if(m)return new Response(JSON.stringify(fileOf(m[1])));
  if(url.includes("claude-live/duel-index.json"))return new Response(JSON.stringify(idxBody));
  return new Response("",{status:404});};
async function duelCalls(src,withIndex){
  const SD=await loadSD(src),calls=[],real=globalThis.fetch;globalThis.fetch=fakeGh(withIndex,calls);
  try{const paths=dates.map(dd=>"data/claude-live/"+dd+".json").concat(withIndex?["data/claude-live/duel-index.json"]:[]);
    const r=await SD.claudeLiveFiles(paths,NOW),nFiles=calls.length;calls.length=0;const rep=await SD.loadReport(NOW);
    return {r,nFiles,nReport:calls.length,rep};}
  finally{globalThis.fetch=real;}
}
const withIdx=await duelCalls(SDsrc,true),noIdx=await duelCalls(SDsrc,false);
const recs=r=>JSON.stringify([...normalizeClaudeEvents(r.files).crypto.entries()]);
assert.equal(withIdx.nFiles,1+7);                                    // 묶음 1 + 최근 6일(11/27~12/03 · 7개 날짜)
assert.equal(noIdx.nFiles,60);                                      // 묶음 없으면 예전처럼 날짜 파일 60개(한도 넘음)
assert.ok(withIdx.nReport<=20,String(withIdx.nReport));               // 대결 보고서 전체(목록 2 · 묶음 · 최근 · CSV 6) — 한도 50 안
assert.equal(recs(withIdx.r),recs(noIdx.r));                           // 묶음으로 센 마감 기록 = 날짜 파일로 센 기록(60일 모두)
assert.equal(normalizeClaudeEvents(withIdx.r.files).crypto.size,60);
assert.equal(JSON.stringify(withIdx.rep.tabs.crypto.days),JSON.stringify(noIdx.rep.tabs.crypto.days));
console.log("  ✓ 요청: 묶음 있으면 날짜 파일 "+withIdx.nFiles+"개 · 보고서 "+withIdx.nReport+"개(예전 "+noIdx.nReport+"개) · 기록 같음");
console.log("[scalping duel] 변이 시험");
function killed(label,mutantCheck){assert.equal(mutantCheck(),true,"변이를 못 잡음: "+label);console.log("  ✓ "+label+" 변이 적발");}
killed("시작일 무시",()=>["2026-10-04","2026-10-05"].filter(x=>x>=DUEL_START).length!==2);
killed("한쪽만 있는 날 포함",()=>new Set(["2026-10-05","2026-10-06","2026-10-07","2026-10-08"]).size!==d.tabs.opening.days.length);
killed("비용 다르게",()=>Math.abs((grossPct(100,101)-.10)-d.tabs.opening.days[0].claude.pnlPct)>1e-9);
killed("합계 25% 균등 아님",()=>Math.abs((.4*(1-.25)+.2*(2-.15)+.2*(3-.14)+.2*(4-.20))-d2.total.days[0].claudePct)>1e-9);
{const mut=SDsrc.replace("if(d<recentFrom&&have.has(d)){files.push(have.get(d));continue;}","");assert.notEqual(mut,SDsrc);
 const m=await duelCalls(mut,true);killed("묶음 안 읽음(날짜 파일 60개 · 한도 넘음)",()=>m.nReport>50);}
{const mut=SDsrc.replace("if(d<recentFrom&&have.has(d))","if(have.has(d))");assert.notEqual(mut,SDsrc);
 const m=await duelCalls(mut,true);killed("최근 6일도 묶음(새로 받은 사본 무시)",()=>m.nFiles!==1+7);}
console.log("ALL PASS — scalping duel rules");
