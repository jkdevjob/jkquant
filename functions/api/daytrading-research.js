// Cloudflare Pages Function — GET /api/daytrading-research
// scalping-data 브랜치의 누적 데이트레이딩 연구 결과를 전달한다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

export async function onRequestGet(){
  const u="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/daytrading-research/latest.json";
  try{
    const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-daytrading-research/1.0"}});
    if(r.status===404){
      return new Response(JSON.stringify({ok:true,status:"collecting",archiveDays:0,variants:[],latestDayTrades:[]}),{headers:JH});
    }
    if(!r.ok)throw new Error("GitHub raw HTTP "+r.status);
    const j=await r.json();
    return new Response(JSON.stringify({ok:true,...j}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
