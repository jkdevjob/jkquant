// Cloudflare Pages Function — GET /api/soxl-bars
// Fixed, read-only SOXL 5-minute research-data proxy.
// Keeps GitHub Actions off Yahoo's rate-limited runner IPs. No order/account path.

const JH={
  "Content-Type":"application/json; charset=utf-8",
  "Access-Control-Allow-Origin":"*",
  "Cache-Control":"public, max-age=120",
};
const UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function onRequestGet(){
  const symbol="SOXL";
  const debug=[];
  for(const host of ["query1","query2"]){
    const u=`https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?interval=5m&range=60d&includePrePost=false&events=div%2Csplits`;
    try{
      const r=await fetch(u,{
        headers:{"User-Agent":UA,"Accept":"application/json","Referer":"https://finance.yahoo.com/","Origin":"https://finance.yahoo.com"},
        cf:{cacheTtl:120}
      });
      debug.push(`${host}: HTTP ${r.status}`);
      if(!r.ok)continue;
      const j=await r.json();
      const res=j&&j.chart&&j.chart.result&&j.chart.result[0];
      const ts=res&&res.timestamp||[];
      const q=res&&res.indicators&&res.indicators.quote&&res.indicators.quote[0]||{};
      if(!res||!ts.length||!(q.close||[]).length)continue;
      return new Response(JSON.stringify({ok:true,symbol,sourceHost:host,result:res}),{headers:JH});
    }catch(e){
      debug.push(`${host}: ${String(e&&e.message||e)}`);
    }
  }
  return new Response(JSON.stringify({ok:false,error:"SOXL 5m source unavailable",debug}),{status:502,headers:{...JH,"Cache-Control":"no-store"}});
}

export async function onRequestOptions(){
  return new Response(null,{headers:{
    "Access-Control-Allow-Origin":"*",
    "Access-Control-Allow-Methods":"GET, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type",
  }});
}
