// 종가 30분 연구 엔진. 시점 고정(lookahead 방지), 종가 경매는 15:40 후 확정.
// 연구 장부는 항상 수집한다. KIS VTS는 별도 설정/원장으로 연결하며 기본 OFF다.
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
export const CLOSING_SHADOWS=Object.freeze(CLOSE_VARIANTS.filter(x=>x.id!=="baseline").map(x=>x.id));
// The factory is deterministic, as for opening/day/BTC/SOXL. A generation ID
// retains its original parameters even after retirement or main promotion.
export function generatedClosingVariant(name){
 if(!/^cf_g\d{4,}$/.test(String(name||'')))return null;
 let g=Number(String(name).slice(4))-1;if(!Number.isSafeInteger(g)||g<0||g>1000000)return null;
 const side=['dip','up'][g%2];g=Math.floor(g/2);
 const threshold=[0,1,2,3][g%4]*(side==='dip'?-1:1);g=Math.floor(g/4);
 return {id:name,label:'자동생성 '+name,side,threshold,volume:[0,1.5,2][g%3]};
}
export function closingVariant(name){return CLOSE_VARIANTS.find(v=>v.id===name)||generatedClosingVariant(name);}
// A session's chosen main is immutable; legacy sessions used baseline.
export function closingMainVariant(ledger,kind){return String(ledger?.closingMains?.[kind]||"baseline");}
export function closingRows(ledger){
 if(!ledger||!Array.isArray(ledger.events))return [];
 const map=new Map(),num=v=>v==null||v===''||!Number.isFinite(+v)?null:+v;
 // The DO sorts by targetHm, so a next-day 09:06 sell precedes its 15:30 buy.
 // Project stages in lifecycle order rather than relying on physical row order.
 for(const stage of ['signal','buy','sell'])for(const e of ledger.events){
  if(e?.stage!==stage||!['day','overnight'].includes(e.kind)||!e.variant||!e.code)continue;
  const id=[e.date||ledger.date,e.kind,e.variant,e.code].join(':');
  let x=map.get(id);
  if(!x){x={id,date:e.date||ledger.date,kind:e.kind,variant:e.variant,code:e.code,name:e.name||e.code,
   mainVariant:closingMainVariant(ledger,e.kind),signalTime:null,entryTime:null,exitTime:null,entryPrice:null,exitPrice:null,
   pnl:null,status:'signal',source:'server-paper-only',strategyVersion:e.decisionVersion||'closing30_v1',strategyParams:e.strategyParams||null};map.set(id,x);}
  if(stage==='signal'){x.signalTime=e.createdAt;x.signal=e.signal||null;}
  if(stage==='buy'){x.entryTime=e.priceAt||e.createdAt;x.entryCapturedAt=e.createdAt;x.entryPrice=num(e.price);x.status=x.entryPrice>0?'open':'unverified';}
  if(stage==='sell'){x.exitTime=e.priceAt||e.createdAt;x.exitCapturedAt=e.createdAt;x.exitPrice=num(e.price);x.pnl=num(e.pnl);
   x.status=x.entryPrice>0&&x.exitPrice>0&&x.pnl!==null?'closed':'unverified';}
 }
 return [...map.values()];
}
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
export function chooseClosingSignals(stockFeatures,model,limit=3,variants=CLOSE_VARIANTS){
  const all=[];
  for(const v of variants){
    const matches=stockFeatures.filter(s=>qualifying(s.feature,v))
      .sort((a,b)=>b.feature.liquidity-a.feature.liquidity||String(a.code).localeCompare(String(b.code)))
      .slice(0,limit);
    for(const x of matches)all.push({kind:model,variant:v.id,variantLabel:v.label,code:x.code,name:x.name,
      strategyParams:{...v,maxTrades:limit,frictionPct:CLOSE_FEES_PCT,signalCutoff:model==="day"?1504:1520,entry:model==="day"?"next_completed_minute_proxy":"official_close",exit:model==="day"?"official_close":"next_session_open"},signal:x.feature,signalHm:x.feature.signalHm,fillStatus:"signal_only",strategyVersion:"close30-paper-v1"});
  }
  return all;
}
export function closeNetPct(entry,exit,cost=CLOSE_FEES_PCT){
  return entry>0&&exit>0?(exit/entry-1)*100-cost:null;
}
