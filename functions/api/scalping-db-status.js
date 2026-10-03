// GET /api/scalping-db-status
// Owner-only integrity status for BTC/SOXL Durable Object historical backfill.
const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FIREBASE_API_KEY_FALLBACK="AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS=["jk82investing@gmail.com"];
const WORKER_FALLBACK="https://jkquant-global-intraday-scheduler.mumae4.workers.dev";
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function owners(env){
  const raw=String(env.OWNER_EMAIL||"").trim();
  return raw?raw.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean):DEFAULT_OWNERS;
}
async function ownerAuthorized(request,env){
  const auth=request.headers.get("Authorization")||"",idToken=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!idToken)return false;
  try{
    const key=env.FIREBASE_API_KEY||FIREBASE_API_KEY_FALLBACK;
    const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+key,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken})
    });
    const j=await r.json().catch(()=>({})),u=j.users&&j.users[0],email=u?String(u.email||"").toLowerCase():"";
    return !!email&&owners(env).includes(email);
  }catch(e){return false;}
}
async function one(worker,key,strategy){
  const r=await fetch(worker+"/paper-backfill-status?strategy="+encodeURIComponent(strategy),{
    headers:{"Accept":"application/json","x-monitor-key":key}
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)return {strategy,ok:false,error:j.error||("worker HTTP "+r.status)};
  const s=j.state||{};
  return {
    strategy,ok:true,done:!!s.done,total:Number(s.total||0),verified:Number(s.verified||0),
    imported:Number(s.imported||0),existing:Number(s.existing||0),issues:Array.isArray(s.issues)?s.issues:[],
    indexedDates:Number(j.indexedDates||0),integrityOk:!!j.integrityOk,updatedAt:s.updatedAt||null
  };
}
export async function onRequestGet({request,env}){
  if(!(await ownerAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);
  const key=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!key)return json({ok:false,error:"global intraday monitor key missing"},500);
  const worker=String(env.GLOBAL_INTRADAY_WORKER_URL||WORKER_FALLBACK).replace(/\/$/,"");
  try{
    const [crypto,soxl]=await Promise.all([one(worker,key,"crypto"),one(worker,key,"soxl")]);
    const allDone=[crypto,soxl].every(x=>x.ok&&x.done&&x.integrityOk);
    return json({ok:true,allDone,crypto,soxl});
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
}
