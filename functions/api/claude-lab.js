// Cloudflare Pages Function — GET /api/claude-lab
// 클로드 전략 페이지(/claude) 전용 조회. 읽기 전용 — 주문·계좌 경로 없음.
// ① opening_gapdown_v1/v2 (D-1 갭하락 과매도) · ② etf_dip_overnight_v1 (코스닥150 레버리지 하락일 야간)
// 연구 결과와 VTS 실측은 scalping-data 브랜치의 이 전략 전용 폴더에서만 읽는다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";

async function readRaw(path){
  const r=await fetch(RAW+path+"?t="+Date.now(),{headers:{"Accept":"application/json","User-Agent":"jkquant-claude-lab/1.0"}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("GitHub raw "+path+" HTTP "+r.status);
  return r.json();
}

export async function onRequestGet(){
  try{
    const [gd,etf,wl]=await Promise.all([
      readRaw("opening-gapdown-research/latest.json"),
      readRaw("etf-overnight-research/latest.json"),
      readRaw("opening-gapdown-research/watchlist.json")
    ]);
    return new Response(JSON.stringify({
      ok:true,
      gapdown:gd?{strategyVersion:gd.strategyVersion,from:gd.from,to:gd.to,designEnd:gd.designEnd,finalDataThrough:gd.finalDataThrough,
        generatedAt:gd.generatedAt,designSample:gd.designSample,outOfSample:gd.outOfSample,breadthFilter:gd.breadthFilter||null,
        live:gd.live,liveTrades:gd.liveTrades||[],watchlist:gd.watchlist}:null,
      etf:etf?{rule:etf.rule,designEnd:etf.designEnd,gate:etf.gate,generatedAt:etf.generatedAt,etf:etf.etf,d1v2:etf.d1v2,
        portfolio:etf.portfolio,live:etf.live,latestSignals:etf.latestSignals||[]}:null,
      watchlist:wl?{basedOn:wl.basedOn,basedOnStatus:wl.basedOnStatus,names:(wl.names||[]).slice(0,80)}:null
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
