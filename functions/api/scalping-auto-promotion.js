// POST /api/scalping-auto-promotion
// Nightly research-only service path. Authorized by the shared monitor key.
// It promotes only a 7-distinct-research-session active #1 candidate that also
// passes the existing sample/validation/risk/live-compatibility promotion gate.
// The selected main becomes effective only from the next new session.

import { normalize } from "./scalping-shadow-ranking.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const WORKERS={
  opening:{env:"OPENING_WORKER_URL",fallback:"https://jkquant-opening-scheduler.mumae4.workers.dev"},
  daytrading:{env:"DAYTRADING_WORKER_URL",fallback:"https://jkquant-daytrading-scheduler.mumae4.workers.dev"},
  crypto:{env:"GLOBAL_INTRADAY_WORKER_URL",fallback:"https://jkquant-global-intraday-scheduler.mumae4.workers.dev"},
  soxl:{env:"GLOBAL_INTRADAY_WORKER_URL",fallback:"https://jkquant-global-intraday-scheduler.mumae4.workers.dev"}
};
const REQUIRED_LEADER_SESSIONS=7;
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function monitorKey(env){return String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();}
function authorized(request,env){const want=monitorKey(env),got=request.headers.get("x-monitor-key")||"";return !!want&&got===want;}
function workerUrl(env,strategy){const d=WORKERS[strategy];return String(env[d.env]||d.fallback).replace(/\/$/,"");}
function configUrl(env,strategy){const base=workerUrl(env,strategy);return (strategy==="crypto"||strategy==="soxl")?base+"/config?strategy="+encodeURIComponent(strategy):base+"/config";}
async function workerConfig(env,strategy,method="GET",body=null){
  const key=monitorKey(env);if(!key)throw new Error("monitor key missing");
  const init={method,headers:{"Accept":"application/json","x-monitor-key":key}};
  if(body){init.headers["content-type"]="application/json";init.body=JSON.stringify(body);}
  const r=await fetch(configUrl(env,strategy),init),j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("worker config HTTP "+r.status));
  return j.config||null;
}
function dateParts(ms,tz){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:(+g("hour")||0)*100+(+g("minute")||0),weekday:g("weekday")};
}
function shiftDate(date,days){const [y,m,d]=String(date).split("-").map(Number);return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);}
function weekday(date){return new Date(String(date)+"T12:00:00Z").getUTCDay();}
function nextWeekday(date,includeToday){let d=includeToday?date:shiftDate(date,1);for(let i=0;i<8;i++){const w=weekday(d);if(w!==0&&w!==6)return d;d=shiftDate(d,1);}return d;}
export function effectiveFrom(strategy,now=Date.now()){
  if(strategy==="crypto"){const p=dateParts(now,"Asia/Seoul");return shiftDate(p.date,1);}
  if(strategy==="opening"||strategy==="daytrading"){
    const p=dateParts(now,"Asia/Seoul"),wd=!["Sat","Sun"].includes(p.weekday);
    return nextWeekday(p.date,wd&&p.hm<900);
  }
  const p=dateParts(now,"America/New_York"),wd=!["Sat","Sun"].includes(p.weekday);
  return nextWeekday(p.date,wd&&p.hm<930);
}
function sessionDateNow(strategy,now=Date.now()){return dateParts(now,strategy==="soxl"?"America/New_York":"Asia/Seoul").date;}
function activeVariant(config,strategy,now=Date.now()){
  const c=config||{},selected=String(c.selectedVariant||"baseline"),prev=String(c.previousVariant||"baseline");
  return c.effectiveFrom&&sessionDateNow(strategy,now)<String(c.effectiveFrom)?prev:selected;
}
export function autoPromotionDecision(strategy,section){
  const life=section&&section.lifecycle||{},leader=life.leader||{};
  const candidate=String(life.autoPromotionCandidate||"");
  if(!candidate)return {ok:false,reason:String(life.autoPromotionReason||"no auto promotion candidate")};
  if(String(leader.name||"")!==candidate)return {ok:false,reason:"leader/candidate mismatch"};
  if(Number(leader.consecutiveResearchSessions||0)<REQUIRED_LEADER_SESSIONS)return {ok:false,reason:"leader streak below 7"};
  const ranking=normalize(strategy,section||{}),row=(ranking.rows||[]).find(x=>x.name===candidate);
  if(!row)return {ok:false,reason:"candidate not active"};
  if(row.rank!==1)return {ok:false,reason:"candidate is not active rank #1"};
  if(!row.promotionEligible)return {ok:false,reason:"existing promotion gate not passed"};
  return {ok:true,candidate,row,ranking};
}
export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  let report={};try{report=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  const results={};
  for(const strategy of Object.keys(WORKERS)){
    try{
      const decision=autoPromotionDecision(strategy,report[strategy]||{});
      if(!decision.ok){results[strategy]={status:"skipped",reason:decision.reason};continue;}
      const before=await workerConfig(env,strategy);
      const candidate=decision.candidate;
      if(String(before&&before.selectedVariant||"baseline")===candidate){
        results[strategy]={status:"already-selected",variant:candidate,effectiveFrom:before&&before.effectiveFrom||null};
        continue;
      }
      const from=effectiveFrom(strategy),previousVariant=activeVariant(before,strategy),row=decision.row;
      const config=await workerConfig(env,strategy,"POST",{
        variant:candidate,effectiveFrom:from,previousVariant,
        updatedBy:"nightly-auto-evolution",source:"auto-7-session-leader",
        researchScore:row.researchScore,rank:row.rank
      });
      results[strategy]={status:"promoted",variant:candidate,previousVariant,effectiveFrom:from,researchScore:row.researchScore,config};
    }catch(e){results[strategy]={status:"error",error:String(e.message||e)};}
  }
  return json({ok:true,requiredLeaderResearchSessions:REQUIRED_LEADER_SESSIONS,effective:"next-new-session",results});
}
