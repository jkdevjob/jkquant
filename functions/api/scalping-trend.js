// GET /api/scalping-trend
// Tiny precomputed payload for the Today cumulative-return chart.
// Read-only. The expensive CSV/Worker merge is done ahead of time by GitHub workflows.

const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/scalping-trend/latest.json";
const H={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"public, max-age=60, s-maxage=300, stale-while-revalidate=1800"
};

export async function onRequestGet(){
  try{
    const r=await fetch(RAW,{
      headers:{"Accept":"application/json","User-Agent":"jkquant-scalping-trend/1.0"},
      cf:{cacheEverything:true,cacheTtl:300}
    });
    if(!r.ok)throw new Error("trend data HTTP "+r.status);
    const text=await r.text();
    const j=JSON.parse(text);
    if(!j||j.schema!==1||!j.strategies)throw new Error("invalid trend data");
    return new Response(text,{headers:H});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{
      status:502,
      headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
    });
  }
}
