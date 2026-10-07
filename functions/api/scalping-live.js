// GET /api/scalping-live — 단타(지피티) 웹 알림용 읽기 전용 현재 장부.
// 시초가/데이트레이딩/BTC/SOXL 서버가 이미 만든 신호·모의장부를 읽기만 하며 주문·전략 판정은 절대 다시 하지 않는다.
import { claudeAuthorized } from "./_claude_auth.js";

const JH={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const OPENING_FALLBACK="https://jkquant-opening-scheduler.mumae4.workers.dev";
const DAY_FALLBACK="https://jkquant-daytrading-scheduler.mumae4.workers.dev";
const GLOBAL_FALLBACK="https://jkquant-global-intraday-scheduler.mumae4.workers.dev";
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:JH});

function parts(tz,ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}
async function get(url,key){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),5000);
  try{
    const r=await fetch(url,{headers:{Accept:"application/json","x-monitor-key":key},signal:ac.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));
    return j;
  }finally{clearTimeout(timer);}
}
function openingMain(ledger){
  const main=String(ledger&&ledger.mainVariant||"baseline");
  return (ledger&&Array.isArray(ledger.events)?ledger.events:[])
    .filter(e=>e&&(e.stage==="buy"||e.stage==="sell")&&String(e.variant||"baseline")===main)
    .map(e=>({id:e.id,date:e.date,stage:e.stage,code:e.code,name:e.name,signal:e.signal||null}));
}
export async function onRequestGet({request,env}){
  if(!(await claudeAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);
  const kr=parts("Asia/Seoul"),ny=parts("America/New_York");
  const openKey=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  const globalKey=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!openKey||!globalKey)return json({ok:false,error:"monitor key missing"},500);
  const opening=String(env.OPENING_WORKER_URL||OPENING_FALLBACK).replace(/\/$/,"");
  const day=String(env.DAYTRADING_WORKER_URL||DAY_FALLBACK).replace(/\/$/,"");
  const global=String(env.GLOBAL_INTRADAY_WORKER_URL||GLOBAL_FALLBACK).replace(/\/$/,"");
  const reqs=[
    get(opening+"/events?date="+encodeURIComponent(kr),openKey),
    get(day+"/paper?date="+encodeURIComponent(kr),globalKey),
    get(global+"/paper?strategy=crypto&date="+encodeURIComponent(kr),globalKey),
    get(global+"/paper?strategy=soxl&date="+encodeURIComponent(ny),globalKey)
  ];
  const a=await Promise.allSettled(reqs);
  const value=i=>a[i].status==="fulfilled"?a[i].value:null;
  const err=i=>a[i].status==="rejected"?String(a[i].reason&&a[i].reason.message||a[i].reason):null;
  const o=value(0),d=value(1),c=value(2),s=value(3);
  const tabs={
    opening:{date:kr,events:openingMain(o&&o.ledger),error:err(0)},
    daytrading:{date:kr,trades:(d&&d.ledger&&d.ledger.trades)||[],error:err(1)},
    crypto:{date:kr,trades:(c&&c.ledger&&c.ledger.trades)||[],error:err(2)},
    soxl:{date:ny,trades:(s&&s.ledger&&s.ledger.trades)||[],error:err(3)}
  };
  const errors=Object.fromEntries(Object.entries(tabs).filter(([,v])=>v.error).map(([k,v])=>[k,v.error]));
  return json({ok:true,asOf:new Date().toISOString(),tabs,errors});
}
