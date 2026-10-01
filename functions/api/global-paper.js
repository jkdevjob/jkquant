// GET /api/global-paper?strategy=crypto|soxl
// Owner-only read proxy for Cloudflare global intraday scheduler paper ledgers.
// Read-only: no broker/exchange order path.

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

export async function onRequestGet({request,env}){
  if(!(await ownerAuthorized(request,env)))return json({ok:false,error:"unauthorized"},401);
  const u=new URL(request.url);
  const strategy=String(u.searchParams.get("strategy")||"").toLowerCase();
  if(!["crypto","soxl"].includes(strategy))return json({ok:false,error:"unsupported strategy"},400);
  const key=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!key)return json({ok:false,error:"global intraday monitor key missing"},500);
  const worker=String(env.GLOBAL_INTRADAY_WORKER_URL||WORKER_FALLBACK).replace(/\/$/,"");
  const date=String(u.searchParams.get("date")||"");
  const qs=new URLSearchParams({strategy}); if(date)qs.set("date",date);
  try{
    const r=await fetch(worker+"/paper?"+qs.toString(),{
      headers:{"Accept":"application/json","x-monitor-key":key}
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)return json({ok:false,error:j.error||("worker HTTP "+r.status)},502);
    return json({ok:true,strategy:j.strategy||strategy,date:j.date||date,ledger:j.ledger||null});
  }catch(e){
    return json({ok:false,error:String(e.message||e)},502);
  }
}
