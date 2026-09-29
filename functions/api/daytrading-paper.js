// GET /api/daytrading-paper
// 브라우저의 소유자 로그인만 허용하고, Cloudflare daytrading scheduler의
// Durable Object 장중 모의장부를 서버측 secret으로 읽어 전달한다.
// 주문 API는 호출하지 않는다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FIREBASE_API_KEY_FALLBACK="AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw";
const DEFAULT_OWNERS=["jk82investing@gmail.com"];
const WORKER_FALLBACK="https://jkquant-daytrading-scheduler.mumae4.workers.dev";

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function kstDate(){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
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
  const key=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!key)return json({ok:false,error:"daytrading monitor key missing"},500);
  const url=new URL(request.url);
  const date=String(url.searchParams.get("date")||kstDate());
  const worker=String(env.DAYTRADING_WORKER_URL||WORKER_FALLBACK).replace(/\/$/,"");
  try{
    const r=await fetch(worker+"/paper?date="+encodeURIComponent(date),{
      headers:{"Accept":"application/json","x-monitor-key":key}
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)return json({ok:false,error:j.error||("worker HTTP "+r.status)},502);
    return json({ok:true,date,ledger:j.ledger||null});
  }catch(e){
    return json({ok:false,error:String(e.message||e)},502);
  }
}
