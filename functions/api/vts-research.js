// Cloudflare Pages Function — GET /api/vts-research
// Read-only cumulative KIS VTS execution-quality research.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

export async function onRequestGet(){
  const u="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/vts-research/latest.json";
  try{
    const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-vts-research/1.0"}});
    if(r.status===404){
      return new Response(JSON.stringify({ok:true,status:"collecting",archiveDays:0,strategies:[],latest:{reports:[]}}),{headers:JH});
    }
    if(!r.ok)throw new Error("GitHub raw HTTP "+r.status);
    const j=await r.json();
    return new Response(JSON.stringify({ok:true,...j}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
