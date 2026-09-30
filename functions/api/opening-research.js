// Cloudflare Pages Function — GET /api/opening-research
// Cumulative backtest + exact live-alert research from the scalping-data branch.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";

async function readRaw(path,required=false){
  const r=await fetch(RAW+path,{headers:{"Accept":"application/json","User-Agent":"jkquant-opening-research/2.0"}});
  if(r.status===404&&!required)return null;
  if(!r.ok)throw new Error("GitHub raw "+path+" HTTP "+r.status);
  return r.json();
}

export async function onRequestGet(){
  try{
    const [base,nightly]=await Promise.all([
      readRaw("opening-research/latest.json",false),
      readRaw("nightly-research/latest.json",false)
    ]);
    if(!base){
      return new Response(JSON.stringify({
        ok:true,status:"collecting",archiveDays:0,variants:[],
        liveSignals:(nightly&&nightly.opening&&nightly.opening.liveSignals)||null,
        shadowStrategies:(nightly&&nightly.opening&&nightly.opening.shadowStrategies)||[],
        liveSignalsAsOf:(nightly&&nightly.generatedAt)||null
      }),{headers:JH});
    }
    return new Response(JSON.stringify({
      ok:true,...base,
      liveSignals:(nightly&&nightly.opening&&nightly.opening.liveSignals)||null,
      shadowStrategies:(nightly&&nightly.opening&&nightly.opening.shadowStrategies)||[],
      liveSignalsAsOf:(nightly&&nightly.generatedAt)||null
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
