// GET /api/global-intraday-status
// Read-only proxy for the Cloudflare BTC/SOXL paper-status Worker.
// No broker/exchange order path is exposed here.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const WORKER="https://jkquant-global-intraday-scheduler.mumae4.workers.dev";

export async function onRequestGet(){
  try{
    const r=await fetch(WORKER+"/status",{headers:{"Accept":"application/json"}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok){
      return new Response(JSON.stringify({ok:false,error:j.error||("worker HTTP "+r.status)}),{status:502,headers:JH});
    }
    return new Response(JSON.stringify(j),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
