// GET/POST /api/scalping-strategy-promotion
// Owner-only manual promotion of a validated shadow strategy.
// POST never changes a running session: it stores an effectiveFrom date and workers lock each session's mainVariant.

import {normalize} from "./scalping-shadow-ranking.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FIREBASE_API_KEY_FALLBACK="AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS=["jk82investing@gmail.com"];
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/latest.json";
const WORKERS={
  opening:{env:"OPENING_WORKER_URL",fallback:"https://jkquant-opening-scheduler.mumae4.workers.dev"},
  daytrading:{env:"DAYTRADING_WORKER_URL",fallback:"https://jkquant-daytrading-scheduler.mumae4.workers.dev"},
  crypto:{env:"GLOBAL_INTRADAY_WORKER_URL",fallback:"https://jkquant-global-intraday-scheduler.mumae4.workers.dev",query:"crypto"},
  soxl:{env:"GLOBAL_INTRADAY_WORKER_URL",fallback:"https://jkquant-global-intraday-scheduler.mumae4.workers.dev",query:"soxl"}
};
// Research-only variants that the current live exit engine cannot safely make main.
const NON_PROMOTABLE={opening:new Set(["hold_to_next_open"])};

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function owners(env){
  const raw=String(env.OWNER_EMAIL||"").trim();
  return raw?raw.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean):DEFAULT_OWNERS;
}
async function ownerIdentity(request,env){
  const auth=request.headers.get("Authorization")||"",idToken=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!idToken)return null;
  try{
    const key=env.FIREBASE_API_KEY||FIREBASE_API_KEY_FALLBACK;
    const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+key,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})
    });
    const j=await r.json().catch(()=>({})),u=j.users&&j.users[0];
    const email=u?String(u.email||"").toLowerCase():"";
    return email&&owners(env).includes(email)?{email,uid:String(u.localId||"")}:null;
  }catch(e){return null;}
}
function monitorKey(env){return String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();}
function workerUrl(env,kind){
  const w=WORKERS[kind];return String(env[w.env]||w.fallback).replace(/\/$/,"");
}
function configUrl(env,kind){
  const w=WORKERS[kind];let u=workerUrl(env,kind)+"/config";
  if(w.query)u+="?strategy="+encodeURIComponent(w.query);
  return u;
}
async function workerConfig(env,kind,method="GET",body=null){
  const key=monitorKey(env);if(!key)throw new Error("monitor key missing");
  const opt={method,headers:{"Accept":"application/json","x-monitor-key":key}};
  if(body){opt.headers["content-type"]="application/json";opt.body=JSON.stringify(body);}
  const r=await fetch(configUrl(env,kind),opt),j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("worker "+kind+" HTTP "+r.status));
  return j.config||null;
}
function dateParts(ms,tz){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",weekday:"short",hour12:false}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:(+g("hour")||0)*100+(+g("minute")||0),weekday:g("weekday")};
}
function shiftDate(date,days){
  const [y,m,d]=date.split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
function weekday(date){return new Date(date+"T12:00:00Z").getUTCDay();}
function nextWeekday(date,includeToday){
  let d=includeToday?date:shiftDate(date,1);
  for(let i=0;i<8;i++){const w=weekday(d);if(w!==0&&w!==6)return d;d=shiftDate(d,1);}
  return d;
}
function effectiveFrom(kind,now=Date.now()){
  if(kind==="crypto"){const p=dateParts(now,"Asia/Seoul");return shiftDate(p.date,1);}
  if(kind==="opening"||kind==="daytrading"){
    const p=dateParts(now,"Asia/Seoul"),isWeekday=!["Sat","Sun"].includes(p.weekday);
    return nextWeekday(p.date,isWeekday&&p.hm<900);
  }
  const p=dateParts(now,"America/New_York"),isWeekday=!["Sat","Sun"].includes(p.weekday);
  return nextWeekday(p.date,isWeekday&&p.hm<930);
}
async function latestRanking(kind){
  const r=await fetch(RAW+"?t="+Date.now(),{headers:{"Accept":"application/json","User-Agent":"jkquant-strategy-promotion/1.0"}});
  if(!r.ok)throw new Error("nightly research HTTP "+r.status);
  const report=await r.json();
  return {report,ranking:normalize(kind,report[kind]||{})};
}
function operationallyPromotable(kind,variant){
  return !(NON_PROMOTABLE[kind]&&NON_PROMOTABLE[kind].has(variant));
}
function promotionEligible(kind,row){
  return !!(row&&row.review&&row.sampleReady&&row.riskOk&&operationallyPromotable(kind,row.name));
}

export async function onRequestGet({request,env}){
  const who=await ownerIdentity(request,env);if(!who)return json({ok:false,error:"unauthorized"},401);
  const u=new URL(request.url),kind=String(u.searchParams.get("strategy")||"").toLowerCase();
  if(kind&&!WORKERS[kind])return json({ok:false,error:"unsupported strategy"},400);
  try{
    if(kind){
      const [{ranking},config]=await Promise.all([latestRanking(kind),workerConfig(env,kind)]);
      const rows=ranking.rows.map(x=>({...x,promotionEligible:promotionEligible(kind,x),operationallyPromotable:operationallyPromotable(kind,x.name)}));
      return json({ok:true,strategy:kind,config,ranking:{...ranking,rows},nextEffectiveFrom:effectiveFrom(kind)});
    }
    const configs={};
    for(const k of Object.keys(WORKERS))configs[k]=await workerConfig(env,k);
    return json({ok:true,configs});
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
}

export async function onRequestPost({request,env}){
  const who=await ownerIdentity(request,env);if(!who)return json({ok:false,error:"unauthorized"},401);
  let b={};try{b=await request.json();}catch(e){}
  const kind=String(b.strategy||"").toLowerCase(),variant=String(b.variant||"");
  if(!WORKERS[kind]||!variant)return json({ok:false,error:"strategy/variant required"},400);
  try{
    const {ranking}=await latestRanking(kind);
    const row=ranking.rows.find(x=>x.name===variant);
    if(!row)return json({ok:false,error:"unknown shadow strategy"},404);
    if(!promotionEligible(kind,row)){
      return json({ok:false,error:"promotion gate not passed",gate:{
        review:!!row.review,sampleReady:!!row.sampleReady,riskOk:!!row.riskOk,operationallyPromotable:operationallyPromotable(kind,variant)
      }},409);
    }
    const before=await workerConfig(env,kind),from=effectiveFrom(kind);
    if(String(before&&before.selectedVariant||"baseline")===variant){
      return json({ok:true,unchanged:true,strategy:kind,variant,effectiveFrom:before.effectiveFrom||from,config:before});
    }
    const config=await workerConfig(env,kind,"POST",{
      variant,effectiveFrom:from,updatedBy:who.email,source:"owner-manual-promotion-button",
      researchScore:row.researchScore,rank:row.rank
    });
    return json({ok:true,strategy:kind,variant,effectiveFrom:from,previousVariant:String(before&&before.selectedVariant||"baseline"),config,
      note:"Running/current session remains locked; new main strategy starts from effectiveFrom."});
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
}

export {effectiveFrom,promotionEligible,operationallyPromotable};
