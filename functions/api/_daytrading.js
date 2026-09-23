// 데이트레이딩 서버 공용 신호 규칙.
// 실시간 Naver 1분 데이터와 장마감 KIS 재구성을 최대한 같은 관측정보로 맞춘다.
// 실전 주문은 하지 않는다.

export const DAY_BASE_PARAMS=Object.freeze({
  startHm:1000,
  entryCutoff:1430,
  lookback:20,
  slopeN:10,
  minSessionRet:1.0,
  maxSessionRet:8.0,
  minVwapSlope:0.10,
  volMult:1.5,
});

export const DAY_SHADOW_VARIANTS=Object.freeze([
  {name:"vol_2.0",label:"거래량≥2.0배",params:{volMult:2.0}},
  {name:"lookback_30",label:"직전30분 고점",params:{lookback:30}},
  {name:"vwap_slope_0.2",label:"VWAP기울기≥0.2%",params:{minVwapSlope:0.20}},
  {name:"entry_by_1400",label:"14:00 이전",params:{entryCutoff:1400}},
  {name:"session_min_2",label:"세션상승≥2%",params:{minSessionRet:2.0}},
]);

const hmOf=t=>+String(t||"").slice(11,13)*100 + +String(t||"").slice(14,16);

export function minuteVolume(rows){
  const a=(rows||[]).map(x=>({...x})).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")));
  let prevDay="",prevCum=0;
  for(const x of a){
    const d=String(x.t||"").slice(0,10),cum=Math.max(0,+x.vol||0);
    x.vol=d===prevDay?Math.max(0,cum-prevCum):cum;
    prevDay=d;prevCum=cum;
  }
  return a;
}

export function daySignal(rows,cutoffHm=1430,overrides={}){
  const p={...DAY_BASE_PARAMS,...(overrides||{})};
  const a=(rows||[]).filter(x=>{
    const hm=hmOf(x.t);
    return hm>=900&&hm<=Math.min(cutoffHm,p.entryCutoff);
  }).sort((x,y)=>String(x.t||"").localeCompare(String(y.t||"")))
    .map(x=>({t:x.t,hm:hmOf(x.t),c:+x.close||0,v:+x.vol||0}))
    .filter(x=>x.c>0);

  if(a.length<Math.max(p.lookback,p.slopeN)+2)return null;

  // 실시간 Naver에는 O/H/L이 없으므로 신호용 세션 기준가는 09:00 1분 종가다.
  const sessionBase=a[0].c;
  if(!(sessionBase>0))return null;

  const vwap=[];let pv=0,vv=0;
  for(const x of a){
    pv+=x.c*x.v;vv+=x.v;
    vwap.push(pv/Math.max(1,vv));
  }

  const start=Math.max(p.startHm,+overrides.snapshotHm+5||p.startHm);
  for(let i=Math.max(p.lookback,p.slopeN);i<a.length;i++){
    const x=a[i];
    if(x.hm<start)continue;
    if(x.hm>p.entryCutoff)break;
    const prev=a.slice(i-p.lookback,i);
    const priorHigh=Math.max(...prev.map(z=>z.c));
    const avgVol=prev.reduce((s,z)=>s+z.v,0)/prev.length;
    const volRatio=x.v/Math.max(1,avgVol);
    const vw=vwap[i],old=vwap[i-p.slopeN];
    const slope=old>0?(vw/old-1)*100:-999;
    const sessionRet=(x.c/sessionBase-1)*100;
    if(sessionRet<p.minSessionRet||sessionRet>p.maxSessionRet)continue;
    if(!(x.c>vw&&slope>=p.minVwapSlope))continue;
    if(!(x.c>priorHigh&&volRatio>=p.volMult))continue;
    const breakoutPct=(x.c/priorHigh-1)*100;
    return {
      signalTime:x.hm,signalPrice:x.c,sessionBase,sessionRet,vwap:vw,vwapSlope:slope,
      priorHigh,breakoutPct,volRatio,
      score:volRatio*Math.max(.01,breakoutPct+.05)*Math.max(.01,slope+.05),
    };
  }
  return null;
}
