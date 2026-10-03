// GET /api/scalping-shadow-ranking
// Read-only consolidated shadow-strategy leaderboard from nightly research.
// Baseline strategies are excluded; ranking is research triage only.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/latest.json";
const CATALOG={
  opening:["hold_to_next_open","today_combo_v1","pb_max_0.5","amount_1.5","entry_by_0915","entry_by_0920","gap_3_6","vol_1.5","stop_0.7","tp_1.0","pb_max_0.7","amount_1.8","entry_by_0910","gap_2_5","vol_1.8","combo_pb07_amt15","combo_e0920_vol15","gap_25_55","stop_0.9_tp_1.8","combo_pb05_e0920"],
  daytrading:["vol_2.0","lookback_30","vwap_slope_0.2","entry_by_1400","session_min_2","stop_0.8","tp_1.5","vol_1.2","lookback_10","max_trades_1","vwap_slope_0.15","entry_by_1330","session_max_6","vol_1.8","lookback_15","combo_vol18_lb15","combo_slope15_e1400","session_min_1_5","session_max_5","combo_lb30_vol12"],
  crypto:["no_vwap","vol_1.0","vol_1.5","range_15m","range_30m","stop_0.3_tp_0.6","stop_0.7_tp_1.4","hold_30m","hold_120m","entry_by_1800","range_10m","vol_1.3","stop_0.4_tp_0.8","hold_90m","entry_by_2000","combo_range10_vol13","combo_novwap_vol15","stop_0.6_tp_1.2","hold_45m","entry_by_2100"],
  soxl:["range_5m","range_30m","vol_0.8","vol_1.2","no_vwap","stop_0.8_tp_1.6","stop_1.5_tp_3.0","hold_45m","hold_120m","entry_by_1030","range_10m","vol_1.5","stop_1.0_tp_2.0","hold_60m","entry_by_1100","combo_range10_vol12","combo_novwap_vol12","stop_0.9_tp_1.8","hold_75m","entry_by_1045"]
};
const MIN_TRADES={opening:30,daytrading:30,crypto:50,soxl:30};
const PROMOTION_MIN_SCORE=60;
const NON_PROMOTABLE=new Set(["opening:hold_to_next_open"]);
function isPromotionEligible(kind,row){
  if(!row||NON_PROMOTABLE.has(kind+":"+String(row.name||"")))return false;
  return row.review===true&&row.sampleReady===true&&row.riskOk===true&&Number(row.researchScore)>=PROMOTION_MIN_SCORE;
}
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d;}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function fallbackScore(kind,x){
  const all=n(x.allAvgEdgePct,x.avgPnlEdgePct);
  const validation=n(x.validationAvgEdgePct,x.holdoutAvgEdgePct!=null?x.holdoutAvgEdgePct:(x.last20AvgEdgePct!=null?x.last20AvgEdgePct:x.oosAvgEdgePct));
  const recent=n(x.recentEdgePct,x.last20AvgEdgePct!=null?x.last20AvgEdgePct:x.holdoutAvgEdgePct);
  const risk=(x.mddOk!==false&&x.profitFactorOk!==false);
  const trades=n((x.scoreParts||{}).trades,x.allTrades!=null?x.allTrades:x.trades);
  const min=MIN_TRADES[kind]||30,sf=clamp(trades/min,0,1);
  const raw=50+20*Math.tanh(all/.20)+25*Math.tanh(validation/.20)+10*Math.tanh(recent/.75)+5*(risk?1:-1);
  return {score:clamp(50+(raw-50)*sf,0,100),sampleFactor:sf,trades,minTrades:min};
}
function normalize(kind,report){
  const by=new Map((report&&report.candidates||[]).map(x=>[String(x.name||""),x]));
  const life=report&&report.lifecycle||{};
  const activeSet=new Set(Array.isArray(life.activeCandidates)&&life.activeCandidates.length?life.activeCandidates:CATALOG[kind].slice(0,10));
  const retiredSet=new Set((life.retired||[]).map(x=>String(x&&x.name||"")));
  const rows=CATALOG[kind].map(name=>{
    const x=by.get(name)||{name,status:"collecting"};
    const fb=fallbackScore(kind,x);
    const score=Number.isFinite(Number(x.researchScore))?Number(x.researchScore):fb.score;
    const sf=Number.isFinite(Number(x.sampleFactor))?Number(x.sampleFactor):fb.sampleFactor;
    const parts=x.scoreParts||{};
    const trades=n(parts.trades,x.allTrades!=null?x.allTrades:x.trades);
    const row={
      name,status:x.status||"collecting",rank:null,
      researchScore:+score.toFixed(2),sampleFactor:sf,sampleReady:Object.prototype.hasOwnProperty.call(x,"sampleReady")?x.sampleReady===true:sf>=1,
      trades,validationTrades:n(x.holdoutTrades,x.oosTrades),
      allEdgePct:n(x.allAvgEdgePct,x.avgPnlEdgePct),
      validationEdgePct:n(x.validationAvgEdgePct,x.holdoutAvgEdgePct!=null?x.holdoutAvgEdgePct:(x.last20AvgEdgePct!=null?x.last20AvgEdgePct:x.oosAvgEdgePct)),
      recentEdgePct:n(x.recentEdgePct,x.last20AvgEdgePct!=null?x.last20AvgEdgePct:x.holdoutAvgEdgePct),
      riskOk:x.mddOk!==false&&x.profitFactorOk!==false,
      review:x.status==="review",
      liveCompatible:!NON_PROMOTABLE.has(kind+":"+name),
      active:activeSet.has(name),
      lifecycleStatus:retiredSet.has(name)?"retired":(activeSet.has(name)?"active":"reserve")
    };
    row.promotionEligible=isPromotionEligible(kind,row);
    return row;
  });
  const active=rows.filter(x=>x.active&&!retiredSet.has(x.name));
  active.sort((a,b)=>(a.trades<=0)-(b.trades<=0)||b.researchScore-a.researchScore||b.sampleFactor-a.sampleFactor||a.name.localeCompare(b.name));
  active.forEach((x,i)=>x.rank=i+1);
  const reserve=rows.filter(x=>!x.active&&!retiredSet.has(x.name)).sort((a,b)=>b.researchScore-a.researchScore||a.name.localeCompare(b.name));
  const retired=rows.filter(x=>retiredSet.has(x.name));
  return {
    strategy:kind,
    status:report&&report.status||"collecting",
    from:report&&report.from||null,to:report&&report.to||null,
    shadowCount:active.length,minRequired:10,totalCandidatePool:rows.length,
    rankingRule:report&&report.rankingRule||{
      version:"v1",minShadowStrategies:10,
      formula:"50 + sampleFactor × (20·tanh(allEdge/0.20) + 25·tanh(validationEdge/0.20) + 10·tanh(recentEdge/0.75) + 5·riskSign), clipped 0~100",
      sampleFactor:"min(1, trades/minTrades)"
    },
    promotionRule:{
      automatic:true,minScore:PROMOTION_MIN_SCORE,leaderResearchSessions:7,
      requirements:["rank #1 for 7 distinct research sessions","strategy-specific review gate","sampleReady","riskOk","liveCompatible","researchScore >= "+PROMOTION_MIN_SCORE],
      effective:"next-new-session"
    },
    lifecycle:life,
    rows:active,
    reserveRows:reserve,
    retiredRows:retired
  };
}
export async function onRequestGet(){
  try{
    const r=await fetch(RAW+"?t="+Date.now(),{headers:{"Accept":"application/json","User-Agent":"jkquant-shadow-ranking/1.0"}});
    if(!r.ok)throw new Error("nightly research HTTP "+r.status);
    const j=await r.json();
    const rankings={};
    for(const k of Object.keys(CATALOG))rankings[k]=normalize(k,j[k]||{});
    return json({ok:true,generatedAt:j.generatedAt||null,date:j.date||null,autoPromotion:true,rankings});
  }catch(e){return json({ok:false,error:String(e.message||e)},502);}
}
export {CATALOG,normalize,fallbackScore,isPromotionEligible,PROMOTION_MIN_SCORE,NON_PROMOTABLE};
