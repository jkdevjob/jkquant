// 종가 30분 연구 엔진. 시점 고정(lookahead 방지), 종가 경매는 15:40 후 확정.
// 매매는 종이모의(paper)만. 실계좌/KIS VTS 주문 경로에 연결하지 않는다.
export const CLOSE_VARIANTS=Object.freeze([
  {id:"baseline",label:"기준 · 장마감 반등",side:"dip",threshold:0,volume:0},
  {id:"dip_1",label:"−1% 이하 낙폭",side:"dip",threshold:-1,volume:0},
  {id:"dip_2",label:"−2% 이하 낙폭",side:"dip",threshold:-2,volume:0},
  {id:"dip_3",label:"−3% 이하 낙폭",side:"dip",threshold:-3,volume:0},
  {id:"dip_volume",label:"낙폭 · 막판 거래량 증가",side:"dip",threshold:0,volume:1.5},
  {id:"dip_vol2",label:"낙폭 · 거래량 2배",side:"dip",threshold:0,volume:2},
  {id:"momentum",label:"상승 추세 (대조군)",side:"up",threshold:0,volume:0},
  {id:"up_1",label:"+1% 이상 (대조군)",side:"up",threshold:1,volume:0},
  {id:"up_volume",label:"상승 · 거래량 증가",side:"up",threshold:0,volume:1.5},
  {id:"flat",label:"보합 · 근소 낙폭",side:"flat",threshold:1,volume:0},
  {id:"all",label:"모든 종목 (대조군)",side:"all",threshold:0,volume:0},
]);
export const CLOSE_FEES_PCT=.23;
export const closeHm=t=>Number(String(t||"").slice(11,13))*100+Number(String(t||"").slice(14,16));
export function snapAt(raw,cutoff){
  return (raw||[]).filter(x=>closeHm(x.t)>=900&&closeHm(x.t)<=cutoff&&+x.close>0)
    .sort((a,b)=>String(a.t).localeCompare(String(b.t)));
}
export function closeFeature(rows,prevClose,cutoff){
  const bars=snapAt(rows,cutoff),last=bars.at(-1);
  if(!last||bars.length<20||!(+prevClose>0)||closeHm(last.t)<cutoff-2)return null;
  const intradayPct=(+last.close/prevClose-1)*100;
  const recent=bars.slice(-5),older=bars.slice(-20,-5);
  const volumeRatio=older.length&&recent.length?recent.reduce((s,x)=>s+(+x.vol||0),0)/5/
    Math.max(1,older.reduce((s,x)=>s+(+x.vol||0),0)/older.length):0;
  const liquidity=recent.reduce((s,x)=>s+(+x.vol||0)*(+x.close||0),0);
  return {signalHm:closeHm(last.t),signalPrice:+last.close,intradayPct,volumeRatio,liquidity,
    signalTime:String(last.t),source:"KIS 1분봉 · 완성된 분봉만"};
}
export function qualifying(f,v){
  if(!f)return false;
  if(v.volume&&f.volumeRatio<v.volume)return false;
  if(v.side==="up")return f.intradayPct>v.threshold;
  if(v.side==="dip")return f.intradayPct<v.threshold;
  if(v.side==="flat")return Math.abs(f.intradayPct)<v.threshold;
  return true;
}
export function chooseClosingSignals(stockFeatures,model,limit=3){
  const all=[];
  for(const v of CLOSE_VARIANTS){
    const matches=stockFeatures.filter(s=>qualifying(s.feature,v))
      .sort((a,b)=>b.feature.liquidity-a.feature.liquidity||String(a.code).localeCompare(String(b.code)))
      .slice(0,limit);
    for(const x of matches)all.push({kind:model,variant:v.id,variantLabel:v.label,code:x.code,name:x.name,
      signal:x.feature,signalHm:x.feature.signalHm,fillStatus:"signal_only",strategyVersion:"close30-paper-v1"});
  }
  return all;
}
export function closeNetPct(entry,exit,cost=CLOSE_FEES_PCT){
  return entry>0&&exit>0?(exit/entry-1)*100-cost:null;
}
