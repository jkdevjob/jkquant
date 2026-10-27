import {readClosingLedgers,closingDaily} from './_closing30-results.js';
// GET /api/scalping-trend
// Tiny precomputed payload for the Today cumulative-return chart.
// Read-only. Research CSVs are precomputed; eight recent completed live ledgers override them.
import {historyFetch,durableLedgers,durableTradeRows,dailyRisk} from "./scalping-history.js";

const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/scalping-trend/latest.json";
const H={
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"public, max-age=60, s-maxage=300, stale-while-revalidate=1800"
};

export function mergeTrendLedger(name,base,ledgers){
  const db=durableTradeRows(name,ledgers),live=dailyRisk(db.rows,name,db.days).daily;
  const daily=new Map((base.daily||[]).map(x=>[x.date,x]));
  for(const x of live)daily.set(x.date,x);
  let eq=1;
  return {...base,durableDbDays:db.days.length,daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>{
    eq*=1+Number(x.returnPct||0)/100;
    return {...x,cumulativePct:(eq-1)*100};
  })};
}
export async function onRequestGet({env={}}={}){
  try{
    const r=await historyFetch(RAW,{
      headers:{"Accept":"application/json","User-Agent":"jkquant-scalping-trend/1.0"},
      cf:{cacheEverything:true,cacheTtl:300}
    });
    if(!r.ok)throw new Error("trend data HTTP "+r.status);
    const text=await r.text();
    const j=JSON.parse(text);
    if(!j||j.schema!==1||!j.strategies)throw new Error("invalid trend data");
    const names=["daytrading","crypto","soxl"];
    const latest=await Promise.allSettled(names.map(name=>durableLedgers(env,name,8)));
    j.sourceWarnings=[];
    latest.forEach((r,i)=>{
      const name=names[i];
      if(r.status==="fulfilled")j.strategies[name]=mergeTrendLedger(name,j.strategies[name]||{daily:[]},r.value);
      else j.sourceWarnings.push(name+" 최신 모의장부 조회 실패: "+String(r.reason?.message||r.reason));
    });
    try{
      const to=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
      const from=new Date(Date.parse(to+'T00:00:00Z')-39*86400000).toISOString().slice(0,10);
      const ls=await readClosingLedgers(env,{from,to,limit:40});
      for(const name of ['closing30','closing_bet']){
        const daily=new Map((j.strategies[name]?.daily||[]).map(x=>[x.date,x]));
        // A newer incomplete original removes an obsolete finalized projection.
        for(const l of ls)daily.delete(l.date);
        for(const x of closingDaily(ls,name))daily.set(x.date,x);
        let eq=1;
        j.strategies[name]={source:'closing30-durable-paper-ledger',daily:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>{eq*=1+x.returnPct/100;return {...x,cumulativePct:(eq-1)*100};})};
      }
    }catch(e){j.sourceWarnings.push('종가 원장 조회 실패: '+String(e.message||e));}
    if(j.strategies.soxl)j.strategies.soxl.daily=(j.strategies.soxl.daily||[]).map(x=>{
      const marketDate=x.marketDate||x.date;
      return {...x,marketDate,date:new Date(Date.parse(marketDate+"T00:00:00Z")+86400000).toISOString().slice(0,10)};
    });
    j.dateRule="Asia/Seoul · SOXL dates use the Korean date containing the U.S. session close";
    j.latestCompletedDate=Object.values(j.strategies).flatMap(x=>x.daily||[]).map(x=>x.date).sort().at(-1)||null;
    j.generatedAt=new Date().toISOString();
    j.sourceRule="원래 기준전략 연구 재구성 + 최근 8개 완료 DB 세션(운영 모의장부 또는 과거 연구 이관) 혼합입니다. 전체 운영 메인 성과가 아니며 진행 중 세션은 제외합니다.";
    return new Response(JSON.stringify(j),{headers:j.sourceWarnings.length?{...H,"Cache-Control":"no-store"}:H});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{
      status:502,
      headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
    });
  }
}
