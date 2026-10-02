// Cloudflare Pages Function — GET /api/claude-lab
// 단타(클로드) 페이지(/claude) 전용 조회. 읽기 전용 — 주문·계좌 경로 없음.
// 탭 4개(시초가·데이트레이딩·비트코인·SOXL) 클로드 전략 + GPT 기준전략 같은 기간 비교(claude-lab/latest.json)
// 연구 결과와 VTS 실측은 scalping-data 브랜치의 이 전략 전용 폴더에서만 읽는다.

import { claudeAuthorized } from "./_claude_auth.js";
const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";

async function readRaw(path){
  const r=await fetch(RAW+path+"?t="+Date.now(),{headers:{"Accept":"application/json","User-Agent":"jkquant-claude-lab/1.0"}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("GitHub raw "+path+" HTTP "+r.status);
  return r.json();
}

export async function onRequestGet({request,env}){
  if(!(await claudeAuthorized(request,env)))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});   // 소유자만
  try{
    const [gd,etf,wl,lab]=await Promise.all([
      readRaw("opening-gapdown-research/latest.json"),
      readRaw("etf-overnight-research/latest.json"),
      readRaw("opening-gapdown-research/watchlist.json"),
      readRaw("claude-lab/latest.json")
    ]);
    return new Response(JSON.stringify({
      ok:true,
      gapdown:gd?{strategyVersion:gd.strategyVersion,from:gd.from,to:gd.to,designEnd:gd.designEnd,finalDataThrough:gd.finalDataThrough,
        generatedAt:gd.generatedAt,designSample:gd.designSample,outOfSample:gd.outOfSample,breadthFilter:gd.breadthFilter||null,
        live:gd.live,liveTrades:gd.liveTrades||[],watchlist:gd.watchlist}:null,
      etf:etf?{rule:etf.rule,designEnd:etf.designEnd,gate:etf.gate,generatedAt:etf.generatedAt,etf:etf.etf,d1v2:etf.d1v2,
        portfolio:etf.portfolio,live:etf.live,latestSignals:etf.latestSignals||[]}:null,
      lab:lab||null,
      watchlist:wl?{basedOn:wl.basedOn,basedOnStatus:wl.basedOnStatus,names:(wl.names||[]).slice(0,80)}:null
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
