// GET/POST /api/scalping-promotion
// Owner-only manual promotion of a reviewed GPT shadow strategy.
// Promotion never mutates an already-started session; each worker locks the selected main at its next new session.

import { CATALOG, normalize } from "./scalping-shadow-ranking.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FIREBASE_API_KEY_FALLBACK="AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS=["jk82investing@gmail.com"];
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/latest.json";
const WORKERS={
  opening:{env:"OPENING_WORKER_URL",fallback:"https://jkquant-opening-scheduler.mumae4.workers.dev"},
  daytrading:{env:"DAYTRADING_WORKER_URL",fallback:"https://jkquant-daytrading-scheduler.mumae4.workers.dev"},
  crypto:{env:"GLOBAL_INTRADAY_WORKER_URL",fallback:"https://jkquant-global-intraday-scheduler.mumae4.workers.dev"},
  soxl:{env:"GLOBAL_INTRADAY_WORKER_URL",fallback:"https://jkquant-global-intraday-scheduler.mumae4.workers.dev"}
};
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function owners(env){
  const raw=String(env.OWNER_EMAIL||"").trim();
  return raw?raw.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean):DEFAULT_OWNERS;
}
async function ownerInfo(request,env){
  const auth=request.headers.get("Authorization")||"",idToken=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!idToken)return {ok:false,error:"로그인이 필요합니다."};
  try{
    const key=env.FIREBASE_API_KEY||FIREBASE_API_KEY_FALLBACK;
    const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+key,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})
    });
    const j=await r.json().catch(()=>({})),u=j.users&&j.users[0],email=u?String(u.email||"").toLowerCase():"";
    if(!email||!owners(env).includes(email))return {ok:false,error:"소유자 계정만 메인전략을 변경할 수 있습니다."};
    return {ok:true,email};
  }catch(e){return {ok:false,error:"로그인 정보를 확인하지 못했습니다."};}
}
function monitorKey(env){return String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();}
function monitorAuthorized(request,env){
  const got=String(request.headers.get("x-monitor-key")||"").trim();
  const want=monitorKey(env);
  return !!want&&got===want;
}
function workerUrl(env,strategy){
  const d=WORKERS[strategy];if(!d)return "";
  return String(env[d.env]||d.fallback).replace(/\/$/,"");
}
function configUrl(env,strategy){
  const base=workerUrl(env,strategy);
  return (strategy==="crypto"||strategy==="soxl")?base+"/config?strategy="+encodeURIComponent(strategy):base+"/config";
}
async function workerConfig(env,strategy,method="GET",body=null){
  const key=monitorKey(env);if(!key)throw new Error("monitor key missing");
  const init={method,headers:{"Accept":"application/json","x-monitor-key":key}};
  if(body){init.headers["content-type"]="application/json";init.body=JSON.stringify(body);}
  const r=await fetch(configUrl(env,strategy),init);
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("worker config HTTP "+r.status));
  return j.config||null;
}
function dateParts(ms,tz){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:(+g("hour")||0)*100+(+g("minute")||0),weekday:g("weekday")};
}
function shiftDate(date,days){
  const [y,m,d]=String(date).split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
function weekday(date){return new Date(String(date)+"T12:00:00Z").getUTCDay();}
function nextWeekday(date,includeToday){
  let d=includeToday?date:shiftDate(date,1);
  for(let i=0;i<8;i++){const w=weekday(d);if(w!==0&&w!==6)return d;d=shiftDate(d,1);}
  return d;
}
export function effectiveFrom(strategy,now=Date.now()){
  if(strategy==="crypto"){
    const p=dateParts(now,"Asia/Seoul");
    return shiftDate(p.date,1);
  }
  if(strategy==="opening"||strategy==="daytrading"){
    const p=dateParts(now,"Asia/Seoul"),wd=!["Sat","Sun"].includes(p.weekday);
    return nextWeekday(p.date,wd&&p.hm<900);
  }
  const p=dateParts(now,"America/New_York"),wd=!["Sat","Sun"].includes(p.weekday);
  return nextWeekday(p.date,wd&&p.hm<930);
}
function sessionDateNow(strategy,now=Date.now()){
  return dateParts(now,strategy==="soxl"?"America/New_York":"Asia/Seoul").date;
}
function activeVariant(config,strategy,now=Date.now()){
  const c=config||{},selected=String(c.selectedVariant||"baseline"),prev=String(c.previousVariant||"baseline");
  return c.effectiveFrom&&sessionDateNow(strategy,now)<String(c.effectiveFrom)?prev:selected;
}
function decorateConfig(config,strategy,now=Date.now()){
  const c=config||{selectedVariant:"baseline"};
  const active=activeVariant(c,strategy,now);
  return {...c,activeVariant:active,pendingVariant:active!==String(c.selectedVariant||"baseline")?String(c.selectedVariant||"baseline"):null};
}
async function latestRanking(strategy){
  const r=await fetch(RAW+"?t="+Date.now(),{headers:{"Accept":"application/json","User-Agent":"jkquant-promotion/1.0"}});
  if(!r.ok)throw new Error("nightly research HTTP "+r.status);
  const j=await r.json();
  return {generatedAt:j.generatedAt||null,ranking:normalize(strategy,j[strategy]||{})};
}
function allowedVariant(strategy,variant){
  return variant==="baseline"||!!((CATALOG[strategy]||[]).includes(variant));
}
export function promotionDecision(strategy,variant,ranking){
  if(!WORKERS[strategy])return {ok:false,reason:"unsupported strategy"};
  if(variant==="baseline")return {ok:true,revert:true,reason:"owner baseline revert"};
  if(!allowedVariant(strategy,variant))return {ok:false,reason:"unknown variant"};
  const row=(ranking&&ranking.rows||[]).find(x=>x.name===variant);
  if(!row)return {ok:false,reason:"ranking unavailable"};
  if(!row.liveCompatible)return {ok:false,reason:"live incompatible"};
  if(!row.promotionEligible)return {ok:false,reason:"promotion gate not passed"};
  return {ok:true,revert:false,row};
}
export async function onRequestGet({request,env}){
  const who=await ownerInfo(request,env);if(!who.ok)return json({ok:false,error:who.error},401);
  const configs={},errors={},nextEffectiveFrom={};
  await Promise.all(Object.keys(WORKERS).map(async strategy=>{
    try{configs[strategy]=decorateConfig(await workerConfig(env,strategy),strategy);}
    catch(e){errors[strategy]=String(e.message||e);}
    nextEffectiveFrom[strategy]=effectiveFrom(strategy);
  }));
  return json({ok:true,effective:"next-new-session",autoPromotion:true,configs,errors,nextEffectiveFrom});
}
export async function onRequestPut({request,env}){
  if(!monitorAuthorized(request,env))return json({ok:false,error:"unauthorized"},401);
  let report={};try{report=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  const reportDate=String(report.date||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDate))return json({ok:false,error:"nightly report date required"},400);
  const today=dateParts(Date.now(),"Asia/Seoul").date;
  if(reportDate!==today)return json({ok:false,error:"stale nightly report",reportDate,today},409);
  if(report.mode!=="nightly-research-auto-lifecycle"||!report.guardrail||report.guardrail.liveStrategyAutoChange!==true){
    return json({ok:false,error:"auto-promotion lifecycle report required"},409);
  }

  const results={};
  for(const strategy of Object.keys(WORKERS)){
    try{
      const sr=report[strategy]||{},life=sr.lifecycle||{},auto=life.autoPromotion||{};
      const variant=String(auto.variant||"");
      if(auto.enabled!==true||auto.eligible!==true){
        results[strategy]={ok:true,action:"skip",reason:String(auto.reason||"자동승격 조건 미충족")};
        continue;
      }
      if(Number(life.leaderDays||0)<7){
        results[strategy]={ok:false,action:"blocked",reason:"7일 연속 1위 미충족"};
        continue;
      }
      if(!allowedVariant(strategy,variant)){
        results[strategy]={ok:false,action:"blocked",reason:"unknown variant"};
        continue;
      }
      const ranking=normalize(strategy,sr);
      const row=(ranking.rows||[]).find(x=>x.name===variant);
      const decision=promotionDecision(strategy,variant,ranking);
      if(!decision.ok||!row||row.rank!==1){
        results[strategy]={ok:false,action:"blocked",reason:decision.reason||"현재 1위/승격 게이트 불일치"};
        continue;
      }
      const before=await workerConfig(env,strategy);
      const currentSelected=String(before&&before.selectedVariant||"baseline");
      if(currentSelected===variant){
        results[strategy]={ok:true,action:"unchanged",variant,reason:"이미 선택된 메인전략"};
        continue;
      }
      const from=effectiveFrom(strategy),previousVariant=activeVariant(before,strategy);
      const config=decorateConfig(await workerConfig(env,strategy,"POST",{
        variant,effectiveFrom:from,previousVariant,
        updatedBy:"nightly-research",source:"auto-promotion-7d-leader",
        researchScore:row.researchScore,rank:row.rank
      }),strategy);
      results[strategy]={
        ok:true,action:"promoted",variant,previousVariant,effectiveFrom:from,
        researchScore:row.researchScore,leaderDays:Number(life.leaderDays||0),config
      };
    }catch(e){
      results[strategy]={ok:false,action:"error",reason:String(e.message||e)};
    }
  }
  return json({ok:true,reportDate,autoPromotion:true,effective:"next-new-session",results});
}

export async function onRequestPost({request,env}){
  const who=await ownerInfo(request,env);if(!who.ok)return json({ok:false,error:who.error},401);
  let b={};try{b=await request.json();}catch(e){return json({ok:false,error:"JSON body 오류"},400);}
  const strategy=String(b.strategy||"").toLowerCase(),variant=String(b.variant||"");
  if(!WORKERS[strategy]||!allowedVariant(strategy,variant))return json({ok:false,error:"지원하지 않는 전략 또는 그림자전략입니다."},400);
  try{
    let generatedAt=null,ranking=null,decision;
    if(variant==="baseline")decision=promotionDecision(strategy,variant,null);
    else{
      const latest=await latestRanking(strategy);generatedAt=latest.generatedAt;ranking=latest.ranking;
      decision=promotionDecision(strategy,variant,ranking);
    }
    if(!decision.ok)return json({ok:false,error:"승격 조건을 충족하지 못했습니다.",reason:decision.reason,ranking},409);
    const before=await workerConfig(env,strategy);
    const from=effectiveFrom(strategy),previousVariant=activeVariant(before,strategy);
    const row=decision.row||null;
    const config=decorateConfig(await workerConfig(env,strategy,"POST",{
      variant,effectiveFrom:from,previousVariant,
      updatedBy:who.email,source:variant==="baseline"?"owner-baseline-revert":"owner-promotion-button",
      researchScore:row?row.researchScore:null,rank:row?row.rank:null
    }),strategy);
    return json({
      ok:true,strategy,variant,previousVariant,effectiveFrom:from,config,researchGeneratedAt:generatedAt,
      effective:"next-new-session",autoPromotion:false,
      note:"현재 시작된 세션은 기존 메인전략으로 끝내고 "+from+" 새 세션부터 선택 전략을 메인으로 잠급니다."
    });
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
}
