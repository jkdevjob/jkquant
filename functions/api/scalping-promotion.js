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
  try{
    const pairs=await Promise.all(Object.keys(WORKERS).map(async strategy=>[strategy,await workerConfig(env,strategy)]));
    return json({ok:true,effective:"next-new-session",autoPromotion:false,configs:Object.fromEntries(pairs)});
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
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
    const config=await workerConfig(env,strategy,"POST",{
      variant,updatedBy:who.email,source:variant==="baseline"?"owner-baseline-revert":"owner-promotion-button"
    });
    return json({
      ok:true,strategy,variant,config,researchGeneratedAt:generatedAt,
      effective:"next-new-session",autoPromotion:false,
      note:"현재 시작된 세션은 기존 메인전략으로 끝내고 다음 새 세션부터 선택 전략을 메인으로 잠급니다."
    });
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
}
