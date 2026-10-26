// Internal-only read-only archive bridge for GitHub nightly research.
// Server key required; never exposes the private Worker ledger to anonymous users.
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const response=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:H});
export async function onRequestGet({request,env}){
 const keys=[env.OPENING_MONITOR_KEY,env.AUTOTRADE_KEY].map(x=>String(x||"")).filter(Boolean);
 const want=request.headers.get("x-monitor-key")||"";
 if(!want||!keys.includes(want))return response({ok:false,error:"unauthorized"},401);
 const date=new URL(request.url).searchParams.get("date")||"";
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return response({ok:false,error:"invalid date"},400);
 const base=String(env.OPENING_WORKER_URL||"https://jkquant-opening-scheduler.mumae4.workers.dev").replace(/\/$/,"");
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),9000);
 try{
   const r=await fetch(base+"/closing-ledger?date="+date,{headers:{"x-monitor-key":want,"accept":"application/json"},signal:ac.signal});
   const j=await r.json().catch(()=>({ok:false,error:"invalid worker response"}));
   if(!r.ok||!j.ok)return response({ok:false,error:j.error||"Worker query failed",upstreamStatus:r.status},502);
   return response({ok:true,date,ledger:j.ledger||null});
 }catch(e){return response({ok:false,error:"closing ledger connection unavailable",detail:String(e.message||e).slice(0,150)},502);}
 finally{clearTimeout(timer);}
}
