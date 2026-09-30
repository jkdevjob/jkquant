#!/usr/bin/env node
const fs=require('fs');
const open0=fs.readFileSync('functions/api/_opening.js','utf8');
const worker0=fs.readFileSync('worker/opening-scheduler/src/index.js','utf8');

function extractFn(src,marker){
  const i=src.indexOf(marker); if(i<0)throw new Error('missing '+marker);
  let j=src.indexOf('{',i),d=0,k=j;
  for(;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(!d)break;}}
  return src.slice(i,k+1);
}
function openingEnv(src){
  const a=src.indexOf('export const SHADOW_VARIANTS='),b=src.indexOf('\n\nexport const OPENING_FIXED_FRICTION_PCT',a);
  const variants=src.slice(a,b).replace('export const ','const ');
  return new Function([
    variants,
    'const OPENING_FIXED_FRICTION_PCT=.23;',
    'const OPENING_VTS_MIN_MATCHES=30;',
    'const OPENING_FALLBACK_TICKS_PER_SIDE=2.5;',
    extractFn(src,'export function openingKrTickSize(').replace('export ',''),
    extractFn(src,'export function openingFriction(').replace('export ',''),
    extractFn(src,'export function openingRsi14(').replace('export ',''),
    extractFn(src,'export function selloffShadowTrade(').replace('export ',''),
    'return {SHADOW_VARIANTS,selloffShadowTrade};'
  ].join('\n'))();
}
function workerEnv(src){
  return new Function([extractFn(src,'function liveEvent('),extractFn(src,'function collectEvents('),'return {collectEvents};'].join('\n'))();
}
function daily(gapPct){
  const ohlc=[],start=new Date('2026-07-31T00:00:00Z');
  for(let i=0;i<62;i++){
    const d=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
    const close=i<45?2000:2000-(i-44)*20;
    ohlc.push({date:d,open:close,high:close,low:close,close,vol:2000000});
  }
  const prev=ohlc[60].close; ohlc[61].open=prev*(1+gapPct/100);
  return {date:ohlc[61].date,daily:{ohlc}};
}
function openingProbe(src){
  try{
    const e=openingEnv(src),yes=daily(-3),no=daily(-1.5);
    const tr=e.selloffShadowTrade(yes.daily,yes.date,null);
    return !!tr&&e.selloffShadowTrade(no.daily,no.date,null)===null&&tr.rsiPrev<30&&tr.evidence.evaluationScope==='all_available';
  }catch(e){return false;}
}
function top3Probe(openSrc,workerSrc){
  try{
    const meta=openingEnv(openSrc).SHADOW_VARIANTS.find(x=>x.name==='opening_selloff_v1');
    const e=workerEnv(workerSrc),mk=(code,gap)=>({code,name:code,gap,entryTime:900,shadowEmitTime:904,strategyVersion:'opening_selloff_shadow_v1'});
    const parts=[
      {telegram:{},shadowEvents:[{...meta,buyEvents:[mk('A',-2.5),mk('B',-5)],sellEvents:[]}]},
      {telegram:{},shadowEvents:[{...meta,buyEvents:[mk('C',-3),mk('D',-4)],sellEvents:[]}]}
    ];
    const out=e.collectEvents('2026-09-30',904,parts).filter(x=>x.variant==='opening_selloff_v1'&&x.stage==='buy');
    return out.length===3&&out.map(x=>x.code).join(',')==='B,D,C'&&out.every(x=>x.alertDelivery?.sent===false);
  }catch(e){return false;}
}
function wiringProbe(src){
  return /const buyEvents=ok\.flatMap\(x=>Array\.isArray\(x\.buyEvents\)\?x\.buyEvents:\[\]\)/.test(src)
    && /executeVts\(env,kst\.date,buyEvents,sellEvents\)/.test(src)
    && !/const buyEvents=[^\n]*shadowEvents/.test(src);
}
if(!openingProbe(open0)||!top3Probe(open0,worker0)||!wiringProbe(worker0)){
  console.error('✗ production D-1 probe failed'); process.exit(1);
}
const muts=[
  ['all dates — old 2026-10-01 gate must fail',()=>[open0.replace('if(!v||!p)return null;','if(!v||!p)return null;if(String(date||"")<"2026-10-01")return null;'),worker0],(o,w)=>openingProbe(o)],
  ['gap threshold must stay <= -2%',()=>[open0.replace('gapMax:-2','gapMax:-1'),worker0],(o,w)=>openingProbe(o)],
  ['RSI threshold must stay <30',()=>[open0.replace('rsiMax:30','rsiMax:0'),worker0],(o,w)=>openingProbe(o)],
  ['global deepest selection must stay max 3',()=>[open0.replace('maxPicks:3','maxPicks:4'),worker0],(o,w)=>top3Probe(o,w)],
  ['shadow delivery must remain notification-off',()=>[open0,worker0.replace('const delivery={channel:"telegram",sent:false','const delivery={channel:"telegram",sent:true')],(o,w)=>top3Probe(o,w)],
  ['broker execute list must remain baseline-only',()=>[open0,worker0.replace('const buyEvents=ok.flatMap(x=>Array.isArray(x.buyEvents)?x.buyEvents:[]);','const buyEvents=ok.flatMap(x=>[...(x.buyEvents||[]),...(x.shadowEvents||[]).flatMap(v=>v.buyEvents||[])]);')],(o,w)=>wiringProbe(w)],
];
let fail=0;
for(const [name,mutate,probe] of muts){
  const [o,w]=mutate();
  if(probe(o,w)){console.error('✗ mutation survived: '+name);fail++;}
  else console.log('✓ mutation killed: '+name);
}
console.log(`${muts.length-fail}/${muts.length} PASS`);
process.exit(fail?1:0);
