// Cloudflare Pages Function — GET /api/opening-research
// scalping-data 브랜치에 매일 누적되는 연구 백테스트 latest.json 을 웹앱에 전달한다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

export async function onRequestGet(){
  const u="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/opening-research/latest.json";
  try{
    const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-opening-research/1.0"}});
    if(r.status===404){
      return new Response(JSON.stringify({ok:true,status:"collecting",archiveDays:0,variants:[]}),{headers:JH});
    }
    if(!r.ok)throw new Error("GitHub raw HTTP "+r.status);
    const j=await r.json();
    return new Response(JSON.stringify({ok:true,...j}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
