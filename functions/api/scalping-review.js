// Cloudflare Pages Function — GET /api/scalping-review?strategy=opening|daytrading|crypto|soxl&limit=7
// Recent immutable nightly research records from scalping-data.
// Read-only: no order path, no strategy mutation.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const DIR="https://api.github.com/repos/jkdevjob/jkquant/contents/data/nightly-research?ref=scalping-data";
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/";

function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function baseline(x){
  const a=x&&x.variants||[];
  return a.find(v=>v&&v.name==="baseline"||(v&&v.params&&v.params.name==="baseline"))||null;
}
function candidate(x){
  const a=x&&x.candidates||[];
  return a.find(v=>v&&v.status==="review")||a[0]||null;
}
function baseMetrics(strategy,x){
  const b=baseline(x);
  if(!b)return {trades:0,avgPnl:null,compoundReturnPct:null,maxDrawdownPct:null,profitFactor:null};
  if(strategy==="opening"){
    const w=b.windows&&((b.windows.last20&&b.windows.last20.trades)?b.windows.last20:b.windows.all)||{};
    return {trades:n(w.trades)||0,avgPnl:n(w.avgPnl),compoundReturnPct:null,maxDrawdownPct:null,profitFactor:null};
  }
  if(strategy==="daytrading"){
    return {
      trades:n(b.trades)||0,avgPnl:n(b.avgPnl),compoundReturnPct:n(b.portfolioReturnPct),
      maxDrawdownPct:n(b.portfolioMddPct),profitFactor:n(b.profitFactor)
    };
  }
  return {
    trades:n(b.trades)||0,avgPnl:n(b.avgPnl),compoundReturnPct:n(b.compoundReturnPct),
    maxDrawdownPct:n(b.maxDrawdownPct),profitFactor:n(b.profitFactor)
  };
}
function candMetrics(strategy,x){
  const c=candidate(x); if(!c)return null;
  const edge=strategy==="daytrading"?n(c.avgPnlEdgePct):
    strategy==="opening"?n(c.last20AvgEdgePct):
    n(c.holdoutAvgEdgePct??c.oosAvgEdgePct??c.allAvgEdgePct);
  return {name:c.name||"",status:c.status||"collecting",edgePct:edge,trades:n(c.trades??c.last20Trades??c.allTrades)||0};
}
function flags(strategy,root,x,b,c){
  const out=[];
  if(!x||x.status==="collecting")out.push("표본 수집 중");
  if(b.avgPnl!=null&&b.avgPnl<0)out.push("기준 기대값 음수");
  if(b.maxDrawdownPct!=null&&b.maxDrawdownPct<=-10)out.push("누적 낙폭 -10% 이하");
  if(c&&c.status==="review")out.push("그림자 교체 검토 후보");
  if(strategy==="opening"){
    const ls=x&&x.liveSignals||{};
    if(Number(ls.deliveryFailures||0)>0)out.push("Telegram 실패 "+Number(ls.deliveryFailures||0)+"건");
    if(Number(ls.partialScans||0)>0)out.push("부분 스캔 "+Number(ls.partialScans||0)+"건");
  }
  if(strategy==="opening"||strategy==="daytrading"){
    const ex=((root.execution||{}).strategies||[]).find(z=>z.strategy===strategy);
    if(ex&&ex.calibrationStatus!=="reviewable")out.push("VTS 실행비용 보정 수집 중");
  }
  return out;
}
async function getJson(url,required=true){
  const r=await fetch(url,{headers:{"Accept":"application/json","User-Agent":"jkquant-scalping-review/1.0"}});
  if(r.status===404&&!required)return null;
  if(!r.ok)throw new Error("GitHub HTTP "+r.status);
  return r.json();
}

export async function onRequestGet({request}){
  try{
    const u=new URL(request.url),strategy=(u.searchParams.get("strategy")||"").toLowerCase();
    if(!["opening","daytrading","crypto","soxl"].includes(strategy)){
      return new Response(JSON.stringify({ok:false,error:"strategy must be opening|daytrading|crypto|soxl"}),{status:400,headers:JH});
    }
    const limit=Math.min(14,Math.max(1,parseInt(u.searchParams.get("limit")||"7",10)||7));
    const list=await getJson(DIR);
    const files=(Array.isArray(list)?list:[])
      .map(x=>String(x.name||""))
      .filter(x=>/^\d{4}-\d{2}-\d{2}\.json$/.test(x))
      .sort().reverse().slice(0,limit);
    const docs=(await Promise.all(files.map(f=>getJson(RAW+f,false)))).filter(Boolean);
    const records=docs.map(root=>{
      const x=root[strategy]||{},b=baseMetrics(strategy,x),c=candMetrics(strategy,x);
      return {
        date:root.date||"",
        generatedAt:root.generatedAt||"",
        status:x.status||"collecting",
        baseline:b,
        candidate:c,
        flags:flags(strategy,root,x,b,c),
        autoPromotion:false
      };
    });
    return new Response(JSON.stringify({
      ok:true,strategy,records,
      guardrail:"기준전략 자동변경 OFF · 충분한 prospective/OOS 표본 뒤 검토 후보만 표시"
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
