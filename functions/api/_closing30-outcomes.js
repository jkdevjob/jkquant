// Post-signal labels use only observations inside the recorded holding period.
// 순손익 비용 = 거래세 0.20 + 공통 수수료 × 2(_scalp_cost.js · 2026-11-19 전 0.23). 남긴 costPct 가 그때 쓴 값이다.
import {scalpCostPct} from './_scalp_cost.js';
// A missing horizon or incomplete path is null, never an interpolated zero.
export function closingOutcomes(entryPrice,entryAt,exitPrice,exitAt,bars=[],costPct=null){
  const start=Date.parse(String(entryAt||'').replace(' ','T')+(String(entryAt||'').includes('+')||String(entryAt||'').endsWith('Z')?'':'+09:00'));
  const end=Date.parse(exitAt),valid=entryPrice>0&&exitPrice>0&&Number.isFinite(start)&&end>=start;
  const observations=valid?[...new Map(bars.map(x=>({...x,ms:Date.parse(String(x.t).replace(' ','T')+(String(x.t).includes('+')||String(x.t).endsWith('Z')?'':'+09:00'))}))
    .filter(x=>x.ms>start&&x.ms<=end&&+x.close>0).map(x=>[x.ms,x])).values()].sort((a,b)=>a.ms-b.ms):[];
  const horizons=Object.fromEntries([5,10,20,30].map(m=>{
    const target=start+m*60000,b=observations.find(x=>x.ms===target);
    return [m,{returnPct:b?(b.close/entryPrice-1)*100:null,at:b?.t||null,
      reason:b?null:!valid?'entry/exit missing':target>end?'after strategy exit':'exact completed minute missing or market closed'}];
  }));
  const expected=valid?Math.floor((end-start)/60000):0,complete=expected>0&&observations.length===expected&&observations.every((x,i)=>x.ms===start+(i+1)*60000);
  const observedMfePct=observations.length?Math.max(0,...observations.map(x=>((+x.high||+x.close)/entryPrice-1)*100)):null;
  const observedMaePct=observations.length?Math.min(0,...observations.map(x=>((+x.low||+x.close)/entryPrice-1)*100)):null;
  const hits=Object.fromEntries([1,2,-1,-2].map(level=>{
    const hit=observations.find(x=>level>0?((+x.high||+x.close)/entryPrice-1)*100>=level:((+x.low||+x.close)/entryPrice-1)*100<=level);
    return [String(level),{hit:hit?true:complete?false:null,firstAt:hit?.t||null,minutes:hit?(hit.ms-start)/60000:null}];
  }));
  const cost=costPct!=null&&Number.isFinite(+costPct)?+costPct:scalpCostPct('kr');   // 신호가 남긴 비용이 있으면 그 값
  return {schema:1,horizons,mfePct:complete?observedMfePct:null,maePct:complete?observedMaePct:null,
    observedMfePct,observedMaePct,hits,complete,observedMinutes:observations.length,expectedMinutes:expected,
    reason:complete?null:'incomplete minute path; observed extrema are lower bounds on excursions',
    finalNetPnlPct:valid?(exitPrice/entryPrice-1)*100-cost:null,
    observations:observations.map(({ms,...x})=>x),costPct:cost};
}
