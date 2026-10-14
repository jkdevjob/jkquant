#!/usr/bin/env node
'use strict';
/*
 * Research only: uses complete plan-session-engine.js, production /api/quote
 * and exact quoteToDaily() function read from plan.html. Not merged into live strategy.
 * US ETF trade-basis daily prices, actual dividends and brokerage fee from engine.
 */
const fs=require('fs'),vm=require('vm');
const P=fs.readFileSync('plan.html','utf8'),E=fs.readFileSync('plan-session-engine.js','utf8');
const sandbox={};vm.runInNewContext(E,{window:sandbox,console});
const engine=sandbox.JKPlanSessionEngine;
const start=P.indexOf('function quoteToDaily('),end=P.indexOf('\nconst MKT_CLOSE_MIN=',start);
if(start<0||end<0)throw Error('Actual quoteToDaily code not found in plan.html');
const quoteToDaily=new Function(P.slice(start,end)+';return quoteToDaily;')();
const D=engine.DEFAULTS[5],baseline=JSON.parse(JSON.stringify(D));
if(baseline.ivsS0!==.55||baseline.guardMA!==225||baseline.guardBand!==.01)throw Error('Unexpected source defaults');
const fmt=x=>Number.isFinite(x)?+x.toFixed(3):null;
const key=x=>JSON.stringify(x);
const syms=['TECL','TQQQ','SGOV'];
async function quote(sym){
 const u='https://jkquant.pages.dev/api/quote?symbol='+sym+'&range=max&div=1&intraday=0';
 const r=await fetch(u,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(60000)});
 if(!r.ok)throw Error(sym+' HTTP '+r.status);
 const j=await r.json();
 if(j.priceBasis!=='trade'||!j.ohlcTrade?.length)throw Error(sym+' missing TRADE-basis prices, cannot validate');
 const q=quoteToDaily(sym,j);
 if(q.days.length!==j.ohlcTrade.length)throw Error(sym+' converted lengths mismatch');
 if(!q.days.length||!q.dividends)throw Error(sym+' no daily bars');
 return {symbol:sym,rows:q.days,div:q.dividends,source:j.src,basis:q.priceBasis,first:q.days[0].date,last:q.days.at(-1).date,divCount:q.dividends.length};
}
const stats=r=>{if(!r||r.error||!r.stats)throw Error('Engine replay error '+(r?.error||'empty'));const s=r.stats;return {cagr:fmt(s.cagr),mdd:fmt(s.mdd),ret:fmt(s.ret),end:fmt(s.total),trades:s.nTrade,from:s.from,to:s.to};};
const cfg={};
let data,cap=100000,nSim=0;
const T={train:['2021-07-01','2024-05-31'],holdout:['2024-06-03',null],full:['2021-07-01',null]};
function replay(c,window,capital=cap){
 Object.assign(D,baseline,c);
 const t=T[window],end=t[1]||data.end;
 const r=engine.replay({horizon:5,startDate:t[0],endDate:end,principal:capital,monthlyAdd:0,
  tecl:data.by.TECL.rows,tqqq:data.by.TQQQ.rows,sgov:data.by.SGOV.rows,
  teclDiv:data.by.TECL.div,tqqqDiv:data.by.TQQQ.div,sgovDiv:data.by.SGOV.div});
 nSim++;
 return stats(r);
}
const trainScore=r=>r.cagr-.38*r.mdd;
const print=(prefix,obj)=>console.log(prefix+' '+JSON.stringify(obj));
function findPareto(ary,window){
 return ary.filter(a=>!ary.some(b=>b!==a&&b[window].cagr>=a[window].cagr&&b[window].mdd<=a[window].mdd&&(b[window].cagr>a[window].cagr||b[window].mdd<a[window].mdd)));
}
async function run(){
 const qs=await Promise.all(syms.map(quote)),by=Object.fromEntries(qs.map(x=>[x.symbol,x]));
 const last=qs.map(q=>q.last).sort()[0],first=qs.map(q=>q.first).sort().at(-1);
 data={qs,by,end:last};T.holdout[1]=last;T.full[1]=last;
 print('DATA',qs.map(q=>({symbol:q.symbol,source:q.source,basis:q.basis,first:q.first,last:q.last,n:q.rows.length,div:q.divCount})));
 print('RESEARCH', {protocol:'production quote -> actual quoteToDaily -> complete JKPlanSessionEngine.replay',
  engineVersion:engine.VERSION,baseline,capital:cap,firstCommon:first,end:last,
  windows:T,limitations:['trade at next-day close: ex-post exact sizing, not pre-close order feasibility','income tax, FX and execution slippage absent'],
  policy:'research branch only; no operation defaults changed'});
 const base={c:baseline,train:replay(baseline,'train'),holdout:replay(baseline,'holdout'),full:replay(baseline,'full')};
 print('BASELINE',base);
 const vars={
  ivsS0:[.45,.50,.55,.60,.65],
  ivsLook:[10,20,30,40],
  ivsBand:[.05,.075,.10,.15],
  guardMA:[175,200,225,250],
  guardBand:[.005,.01,.02],
 };
 const combos=[];
 for(const ivsS0 of vars.ivsS0)
 for(const ivsLook of vars.ivsLook)
 for(const ivsBand of vars.ivsBand)
 for(const guardMA of vars.guardMA)
 for(const guardBand of vars.guardBand){
  const c={...baseline,ivsS0,ivsLook,ivsBand,guardMA,guardBand};
  const tr=replay(c,'train');
  combos.push({c,train:tr,score:fmt(trainScore(tr))});
 }
 combos.sort((a,b)=>b.score-a.score);
 const front=findPareto(combos,'train');
 print('GRID',{count:combos.length,trainPareto:front.length,topTrain:combos.slice(0,8).map(x=>({c:x.c,score:x.score,train:x.train}))});
 // The fixed holdout does not participate in fitting the train score.
 // Evaluate top 36 train configurations + Pareto boundary + one-variable contrasts.
 const selected=new Map();
 for(const a of combos.slice(0,36))selected.set(key(a.c),a);
 for(const a of front.filter((x,i)=>i%Math.max(1,Math.floor(front.length/30))===0))selected.set(key(a.c),a);
 selected.set(key(baseline),{c:baseline,train:base.train,score:fmt(trainScore(base.train))});
 for(const [name,vals] of Object.entries(vars))for(const val of vals){
  const c={...baseline,[name]:val};
  selected.set(key(c),combos.find(x=>key(x.c)===key(c))||{c,train:replay(c,'train'),score:0});
 }
 const results=[...selected.values()].map(x=>({...x,holdout:replay(x.c,'holdout'),full:replay(x.c,'full')}));
 const improving=results.filter(x=>x.full.cagr>base.full.cagr&&x.full.mdd<base.full.mdd
    && x.holdout.cagr>=base.holdout.cagr&&x.holdout.mdd<=base.holdout.mdd);
 print('CANDIDATES',{evaluated:results.length,improveBothFullAndHoldout:improving.length});
 const sorted=results.slice().sort((a,b)=> (b.full.cagr-.3*b.full.mdd) - (a.full.cagr-.3*a.full.mdd));
 print('ROBUST_TOP',improving.sort((a,b)=>b.full.cagr-a.full.cagr).slice(0,12).map(x=>({c:x.c,train:x.train,holdout:x.holdout,full:x.full})));
 print('BALANCED_TOP',sorted.slice(0,12).map(x=>({c:x.c,train:x.train,holdout:x.holdout,full:x.full})));
 // Risk ratio sensitivity and position rounding: consistent variant, actual engine.
 const finalists=improving.slice(0,5).concat(sorted.slice(0,5));
 const unique=new Map(finalists.map(x=>[key(x.c),x]));
 const weights=[.60,.70,.80];
 const cross=[];
 for(const item of [base,...unique.values()]){
  for(const w of weights){
   const c={...item.c,teclWeight:w,guardWeight:1-w};
   const tr=replay(c,'train'),ho=replay(c,'holdout'),fu=replay(c,'full');
   cross.push({c,train:tr,holdout:ho,full:fu});
  }
 }
 cross.sort((a,b)=>(b.full.cagr-.3*b.full.mdd)-(a.full.cagr-.3*a.full.mdd));
 print('WEIGHT_SENS',cross.slice(0,15));
 // Selected candidate rolling 1y/3y and tiny 5y window, plus $10k rounding.
 const check=[base,...cross.slice(0,5)];
 const uniqueChecks=[...new Map(check.map(z=>[key(z.c),z])).values()];
 const rollYears=[1,3,5],rolling=[];
 const date0=new Date('2021-07-01T00:00:00Z'),ending=new Date(last+'T00:00:00Z');
 function iso(d){return d.toISOString().slice(0,10)}
 for(const item of uniqueChecks){
  const group={c:item.c,smallCap:{full:replay(item.c,'full',10000),holdout:replay(item.c,'holdout',10000)},roll:{}};
  for(const years of rollYears){
    const arr=[];
    for(let d=new Date(date0);;d.setUTCMonth(d.getUTCMonth()+1)){
      const en=new Date(d);en.setUTCFullYear(en.getUTCFullYear()+years);
      if(en>ending)break;
      // Set candidate in engine explicitly before replay.
      Object.assign(D,baseline,item.c);
      // recompute after applying config so no stale default.
      const actual=engine.replay({horizon:5,startDate:iso(d),endDate:iso(en),principal:cap,monthlyAdd:0,
        tecl:data.by.TECL.rows,tqqq:data.by.TQQQ.rows,sgov:data.by.SGOV.rows,
        teclDiv:data.by.TECL.div,tqqqDiv:data.by.TQQQ.div,sgovDiv:data.by.SGOV.div});
      nSim++;
      const z=stats(actual);
      arr.push({start:iso(d),cagr:z.cagr,mdd:z.mdd});
    }
    const cagr=arr.map(x=>x.cagr).sort((a,b)=>a-b),mdds=arr.map(x=>x.mdd).sort((a,b)=>b-a);
    group.roll[years+'y']={n:arr.length,minCagr:cagr[0]??null,p10Cagr:cagr[Math.floor(cagr.length*.1)]??null,
      medianCagr:cagr[Math.floor(cagr.length*.5)]??null,worstMdd:mdds[0]??null};
  }
  rolling.push(group);
 }
 print('ROLLING',rolling);
 print('DONE',{simulations:nSim,officialLiveStrategyUnchanged:true});
}
run().catch(e=>{console.error('RESEARCH_ERROR',e.stack||String(e));process.exitCode=1;});
