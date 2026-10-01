// Cloudflare Pages Function — GET /api/daily1-shadow
// Read-only prospective paper/research report for the four +1% shadow candidates.
// No broker/order/account path is present here.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/daily1-shadow/latest.json";

export async function onRequestGet(){
  try{
    const r=await fetch(RAW+"?t="+Date.now(),{
      headers:{"Accept":"application/json","User-Agent":"jkquant-daily1-shadow/1.0"}
    });
    if(r.status===404){
      return new Response(JSON.stringify({ok:true,status:"collecting",report:null}),{headers:JH});
    }
    if(!r.ok)throw new Error("daily1 shadow raw HTTP "+r.status);
    const report=await r.json();
    return new Response(JSON.stringify({ok:true,status:"ok",report}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
