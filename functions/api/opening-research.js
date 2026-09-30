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
    const [base,nightly,gapdown]=await Promise.all([
      readRaw("opening-research/latest.json",false),
      readRaw("nightly-research/latest.json",false),
      readRaw("opening-gapdown-research/latest.json",false).catch(()=>null)
    ]);
    // D-1 연구는 화면 요약에 필요한 부분만 싣는다(원본 신호 목록은 scalping-data 에 그대로 있다).
    const gd=gapdown?{strategyVersion:gapdown.strategyVersion,from:gapdown.from,to:gapdown.to,designEnd:gapdown.designEnd,
      finalDataThrough:gapdown.finalDataThrough,designSample:gapdown.designSample,outOfSample:gapdown.outOfSample,
      live:gapdown.live,watchlist:gapdown.watchlist,generatedAt:gapdown.generatedAt}:null;
    if(!base){
      return new Response(JSON.stringify({
        ok:true,status:"collecting",archiveDays:0,variants:[],gapdown:gd,
        liveSignals:(nightly&&nightly.opening&&nightly.opening.liveSignals)||null,
        liveSignalsAsOf:(nightly&&nightly.generatedAt)||null
      }),{headers:JH});
    }
    return new Response(JSON.stringify({
      ok:true,...base,gapdown:gd,
      liveSignals:(nightly&&nightly.opening&&nightly.opening.liveSignals)||null,
      liveSignalsAsOf:(nightly&&nightly.generatedAt)||null
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
