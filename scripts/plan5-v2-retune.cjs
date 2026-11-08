#!/usr/bin/env node
'use strict';
/* NO REIMPLEMENTATION: official plan-session-engine.js v2 and plan.html quoteToDaily from latest main.
   Official JKQuant /api/quote, trade-basis close & dividend events, fee model unchanged.
   Research branch only, does not change live defaults or production.
*/
const fs=require('fs'),vm=require('vm');
const p=fs.readFileSync('plan.html','utf8'),eSrc=fs.readFileSync('plan-session-engine.js','utf8');
const ctx={};vm.runInNewContext(eSrc,ctx);const E=ctx.JKPlanSessionEngine;
if(E.VERSION!==2||E.ORDER_SIZING_BASIS!=='previous-settled-close')throw Error('not version2 settlement engine');
const i=p.indexOf('function quoteToDaily('),j=p.indexOf('\nconst MKT_CLOSE_MIN=',i);
if(i<0||j<0)throw Error('missing real quote converter');
const quoteToDaily=new Function(p.slice(i,j)+';return quoteToDaily;')();
const vars={teclWeight:[.5,.55,.6,.65,.7,.75],ivsLook:[15,20,30],ivsS0:[.5,.55,.6],ivsBand:[.075,.10,.125,.15],guardBand:[.005,.01,.02]};
const base={...E.DEFAULTS[5]},capital=75000;const metrics=x=>({cagr:+x.stats.cagr.toFixed(3),mdd:+x.stats.mdd.toFixed(3),ending:+x.stats.total.toFixed(2),trades:x.stats.nTrade});
const print=(name,x)=>console.log(name+' '+JSON.stringify(x));
const wins={train:['2021-07-01','2024-05-31'],hold:['2024-06-03',null],full:['2021-07-01',null]};
let dat,last,calls=0;
async function load(symbol){
 const endpoint='https://jkquant.pages.dev/api/quote?symbol='+symbol+'&range=max&div=1&intraday=0';
 const r=await fetch(endpoint,{signal:AbortSignal.timeout(60000),headers:{Accept:'application/json'}});
 if(!r.ok)throw Error('quote '+symbol+' HTTP '+r.status);
 const b=await r.json();if(b.priceBasis!=='trade'||!b.ohlcTrade?.length)throw Error(symbol+' trade prices unavailable');
 const q=quoteToDaily(symbol,b);
 if(q.days.length<300||q.dividends.length<2)throw Error(symbol+' missing data');
 return{symbol,rows:q.days,div:q.dividends,source:b.src,basis:q.priceBasis,from:q.days[0].date,to:q.days.at(-1).date,n:q.days.length};
}
function run(c,win,initial=capital){
 const v=E.DEFAULTS[5];Object.assign(v,base,c);
 const [start,end]=wins[win];
 const result=E.replay({horizon:5,startDate:start,endDate:end||last,principal:initial,monthlyAdd:0,
   tecl:dat.TECL.rows,tqqq:dat.TQQQ.rows,sgov:dat.SGOV.rows,
   teclDiv:dat.TECL.div,tqqqDiv:dat.TQQQ.div,sgovDiv:dat.SGOV.div});
 if(result.error||result.orderSizingVersion!==2||!result.stats)throw Error('unexpected engine replay failure '+result.error);
 calls++;return metrics(result);
}
const score=x=>x.cagr-.38*x.mdd;
(async()=>{
 const qs=await Promise.all(['TECL','TQQQ','SGOV'].map(load));
 dat=Object.fromEntries(qs.map(v=>[v.symbol,v]));last=qs.map(v=>v.to).sort()[0];
 print('V2_DATA',qs.map(({symbol,source,basis,from,to,n,div})=>({symbol,source,basis,from,to,n,dividends:div.length})));
 print('V2_METHOD',{last,baseline:base,capital,periods:wins,gridDimensions:vars,note:'official v2 share sizing previous settled close; fill next trading close; no taxes/FX/slippage, trades use engine fees'});
 const original={c:base,train:run(base,'train'),hold:run(base,'hold'),full:run(base,'full')};
 print('V2_BASELINE',original);
 const set=new Map();
 for(const teclWeight of vars.teclWeight)for(const ivsLook of vars.ivsLook)for(const ivsS0 of vars.ivsS0)
 for(const ivsBand of vars.ivsBand)for(const guardBand of vars.guardBand){
  const c={...base,teclWeight,guardWeight:1-teclWeight,ivsLook,ivsS0,ivsBand,guardBand};
  const train=run(c,'train');set.set(JSON.stringify(c),{c,train,trainScore:+score(train).toFixed(3)});
 }
 const all=[...set.values()].sort((a,b)=>b.trainScore-a.trainScore);
 const pfront=all.filter(x=>!all.some(y=>y!==x&&y.train.cagr>=x.train.cagr&&y.train.mdd<=x.train.mdd&&(y.train.cagr>x.train.cagr||y.train.mdd<x.train.mdd)));
 print('V2_GRID',{n:all.length,paretoTrain:pfront.length,topTrain:all.slice(0,12).map(x=>({c:x.c,train:x.train}))});
 const shortlist=new Map();
 for(const z of all.slice(0,40))shortlist.set(JSON.stringify(z.c),z);
 for(const z of pfront)shortlist.set(JSON.stringify(z.c),z);
 for(const x of [
 base,{...base,teclWeight:.60,guardWeight:.40,ivsBand:.125},
 {...base,teclWeight:.55,guardWeight:.45},
 {...base,teclWeight:.65,guardWeight:.35,ivsBand:.125},
 {...base,teclWeight:.6,guardWeight:.4,ivsBand:.15}
 ]) {
  const k=JSON.stringify(x);shortlist.set(k,set.get(k)||{c:x,train:run(x,'train'),trainScore:null});
 }
 const checked=[...shortlist.values()].map(x=>({...x,hold:run(x.c,'hold'),full:run(x.c,'full')}));
 const beat=checked.filter(x=>x.full.cagr>original.full.cagr&&x.full.mdd<original.full.mdd&&
  x.hold.cagr>=original.hold.cagr&&x.hold.mdd<=original.hold.mdd);
 print('V2_VALIDATION',{checked:checked.length,strictDualImprovers:beat.length});
 print('V2_STRICT',beat.slice().sort((a,b)=>b.full.cagr-a.full.cagr).slice(0,12));
 print('V2_TRAIN_TOP',checked.slice().sort((a,b)=>b.trainScore-a.trainScore).slice(0,12));
 const fixed=[
  {name:'old_operation',c:base},
  {name:'former_old_best_60_40_band125',c:{...base,teclWeight:.6,guardWeight:.4,ivsBand:.125}},
  {name:'risk_55_45_band10',c:{...base,teclWeight:.55,guardWeight:.45}},
  {name:'65_35_band125',c:{...base,teclWeight:.65,guardWeight:.35,ivsBand:.125}},
  {name:'60_40_band15',c:{...base,teclWeight:.6,guardWeight:.4,ivsBand:.15}}
 ];
 print('V2_FIXED',fixed.map(z=>({name:z.name,c:z.c,train:run(z.c,'train'),hold:run(z.c,'hold'),full:run(z.c,'full'),small:run(z.c,'full',25000)})));
 print('V2_DONE',{simulations:calls,liveDefaultsUnchanged:JSON.stringify(base)===JSON.stringify({teclWeight:.7,guardWeight:.3,ivsLook:20,ivsS0:.55,ivsBand:.1,guardMA:225,guardBand:.01})});
})().catch(x=>{console.error('V2_ERROR '+(x.stack||String(x)));process.exitCode=1;});
