#!/usr/bin/env node
const fs=require('fs');
const open=fs.readFileSync('functions/api/_opening.js','utf8');
const worker=fs.readFileSync('worker/opening-scheduler/src/index.js','utf8');

function extractFn(src,marker){
  const i=src.indexOf(marker); if(i<0)throw new Error('missing '+marker);
  let j=src.indexOf('{',i),d=0,k=j;
  for(;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)break;}}
  return src.slice(i,k+1);
}
function openingEnv(src=open){
  const a=src.indexOf('export const SHADOW_VARIANTS=');
  const b=src.indexOf('\n\nexport const OPENING_FIXED_FRICTION_PCT',a);
  if(a<0||b<0)throw new Error('SHADOW_VARIANTS block missing');
  const variants=src.slice(a,b).replace('export const ','const ');
  const code=[
    variants,
    'const OPENING_FIXED_FRICTION_PCT=.23;',
    'const OPENING_VTS_MIN_MATCHES=30;',
    'const OPENING_FALLBACK_TICKS_PER_SIDE=2.5;',
    extractFn(src,'export function openingKrTickSize(').replace('export ',''),
    extractFn(src,'export function openingFriction(').replace('export ',''),
    extractFn(src,'export function openingRsi14(').replace('export ',''),
    extractFn(src,'export function selloffShadowTrade(').replace('export ',''),
    'return {SHADOW_VARIANTS,openingRsi14,selloffShadowTrade};'
  ].join('\n');
  return new Function(code)();
}
function workerEnv(src=worker){
  const code=[
    extractFn(src,'function liveEvent('),
    extractFn(src,'function collectEvents('),
    'return {collectEvents};'
  ].join('\n');
  return new Function(code)();
}
function daily(gapPct){
  const ohlc=[];
  const start=new Date('2026-07-31T00:00:00Z');
  for(let i=0;i<62;i++){
    const d=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
    let close=i<45?2000:2000-(i-44)*20;
    ohlc.push({date:d,open:close,high:close,low:close,close,vol:2000000});
  }
  const prev=ohlc[60].close;
  ohlc[61].open=prev*(1+gapPct/100);
  ohlc[61].high=ohlc[61].open;
  ohlc[61].low=ohlc[61].open;
  return {date:ohlc[61].date,daily:{ohlc}};
}
function probeOpening(src=open){
  const e=openingEnv(src);
  const yes=daily(-3), no=daily(-1.5);
  const tr=e.selloffShadowTrade(yes.daily,yes.date,null);
  const nr=e.selloffShadowTrade(no.daily,no.date,null);
  return !!tr && nr===null && tr.entryTime===900 && tr.shadowEmitTime===904 &&
    tr.rsiPrev<30 && tr.gap<=-2 && tr.prevTurnoverEok>=20 &&
    tr.evidence.evaluationScope==='all_available';
}
function probeTop3(src=worker){
  const e=workerEnv(src);
  const v={name:'opening_selloff_v1',params:{maxPicks:3}};
  const mk=(code,gap)=>({code,name:code,gap,entryTime:900,shadowEmitTime:904,strategyVersion:'opening_selloff_shadow_v1'});
  const parts=[
    {telegram:{},shadowEvents:[{...v,buyEvents:[mk('A',-2.5),mk('B',-5)],sellEvents:[]}]},
    {telegram:{},shadowEvents:[{...v,buyEvents:[mk('C',-3),mk('D',-4)],sellEvents:[]}]}
  ];
  const out=e.collectEvents('2026-09-30',904,parts).filter(x=>x.variant==='opening_selloff_v1'&&x.stage==='buy');
  return out.length===3 && out.map(x=>x.code).join(',')==='B,D,C' &&
    out.every(x=>x.alertDelivery&&x.alertDelivery.sent===false&&x.alertDelivery.reason==='shadow_strategy_not_notified');
}
if(!probeOpening())throw new Error('D-1 value probe failed');
if(!probeTop3())throw new Error('D-1 top3/orderless probe failed');
if(!/const buyEvents=ok\.flatMap\(x=>Array\.isArray\(x\.buyEvents\)\?x\.buyEvents:\[\]\)/.test(worker) ||
   !/executeVts\(env,kst\.date,buyEvents,sellEvents\)/.test(worker)){
  throw new Error('baseline-only executeVts wiring missing');
}
console.log('✓ D-1 values: RSI<30 + gap<=-2 + all-data scope + deepest 3');
console.log('✓ D-1 shadow is archived only; Telegram/order delivery disabled');
