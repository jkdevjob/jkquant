#!/usr/bin/env node
'use strict';
/* Executable-order stress optimization. Not the official deployed engine.
 * Uses the COMPLETE plan-session-engine.js with only target quantity's price basis
 * switched from unavailable next close to known previous close. Actual fill = next close.
 * Official /api/quote -> plan.html quoteToDaily() -> plan replay, no external price CSV.
 */
const fs=require('fs'),vm=require('vm');
const P=fs.readFileSync('plan.html','utf8');
const fn=P.slice(P.indexOf('function quoteToDaily('),P.indexOf('\nconst MKT_CLOSE_MIN=',P.indexOf('function quoteToDaily(')));
const quoteToDaily=new Function(fn+';return quoteToDaily;')();
let src=fs.readFileSync('plan-session-engine.js','utf8');
const repl=[
 ['Math.floor(total*D.teclWeight*w/ep.TECL)','Math.floor(total*D.teclWeight*w/sp.TECL)'],
 ['Math.floor(total*D.guardWeight/ep.TQQQ)','Math.floor(total*D.guardWeight/sp.TQQQ)'],
 ['Math.floor(Math.max(0,total-tt*ep.TECL-tq*ep.TQQQ)/ep.SGOV)','Math.floor(Math.max(0,total-tt*sp.TECL-tq*sp.TQQQ)/sp.SGOV)']];
for(const [a,b] of repl){if(!src.includes(a))throw Error('source changed '+a);src=src.replace(a,b);}
const o={};vm.runInNewContext(src,{window:o,console});
const e=o.JKPlanSessionEngine;
const D=e.DEFAULTS[5],base={...D};
const fmt=x=>+x.toFixed(3),stats=x=>({cagr:fmt(x.stats.cagr),mdd:fmt(x.stats.mdd),end:fmt(x.stats.total),trades:x.stats.nTrade});
const print=(label,o)=>console.log(label+' '+JSON.stringify(o));
let qData,last,n=0; const windows={train:['2021-07-01','2024-05-31'],hold:['2024-06-03',null],full:['2021-07-01',null]};
async function q(sym){
 const res=await fetch('https://jkquant.pages.dev/api/quote?symbol='+sym+'&range=max&div=1&intraday=0',{signal:AbortSignal.timeout(50000)});
 if(!res.ok)throw Error('quote '+sym+' '+res.status);const obj=await res.json();
 if(obj.priceBasis!=='trade'||!obj.ohlcTrade?.length)throw Error('data invalid '+sym);
 const d=quoteToDaily(sym,obj);
 return {sym,rows:d.days,div:d.dividends,from:d.days[0].date,to:d.days.at(-1).date};
}
function run(c,what,cap=75000){
 Object.assign(D,base,c);
 const [start,end]=windows[what];
 const r=e.replay({horizon:5,startDate:start,endDate:end||last,principal:cap,monthlyAdd:0,
  tecl:qData.TECL.rows,tqqq:qData.TQQQ.rows,sgov:qData.SGOV.rows,
  teclDiv:qData.TECL.div,tqqqDiv:qData.TQQQ.div,sgovDiv:qData.SGOV.div});
 if(!r.stats)throw Error(r.error||'stats missing');
 n++;return stats(r);
}
const score=x=>x.cagr-.38*x.mdd;
(async()=>{
 const ql=await Promise.all(['TECL','TQQQ','SGOV'].map(q));qData=Object.fromEntries(ql.map(z=>[z.sym,z]));last=ql.map(z=>z.to).sort()[0];
 print('EX_META',{last,method:'official complete plan replay with ONLY ex-ante sizing quantities using known previous close',capital:75000,baseline:base});
 const b={c:base,train:run(base,'train'),hold:run(base,'hold'),full:run(base,'full')};
 print('EX_BASELINE',b);
 let cfg=[];
 for(const teclWeight of [.5,.55,.60,.65,.7,.75,.8])
 for(const ivsLook of [10,20,30])
 for(const ivsS0 of [.45,.5,.55,.6])
 for(const ivsBand of [.05,.075,.1,.125,.15])
 for(const guardMA of [200,225,250]){
  const c={...base,teclWeight,guardWeight:1-teclWeight,ivsLook,ivsS0,ivsBand,guardMA};
  const train=run(c,'train');
  cfg.push({c,train,score:fmt(score(train))});
 }
 cfg.sort((a,b)=>b.score-a.score);
 const front=cfg.filter(x=>!cfg.some(y=>y!==x && y.train.cagr>=x.train.cagr && y.train.mdd<=x.train.mdd &&
   (y.train.cagr>x.train.cagr||y.train.mdd<x.train.mdd)));
 const sel=new Map(cfg.slice(0,65).map(x=>[JSON.stringify(x.c),x]));
 front.filter((v,i)=>i%Math.max(1,Math.floor(front.length/30))===0).forEach(x=>sel.set(JSON.stringify(x.c),x));
 for(const c of [base,
    {...base,teclWeight:.6,guardWeight:.4,ivsBand:.125},
    {...base,teclWeight:.6,guardWeight:.4,ivsBand:.15},
    {...base,teclWeight:.65,guardWeight:.35,ivsBand:.125}]){
   const k=JSON.stringify(c);if(!sel.has(k))sel.set(k,{c,train:run(c,'train'),score:null});
 }
 const out=[...sel.values()].map(x=>({...x,hold:run(x.c,'hold'),full:run(x.c,'full')}));
 const dual=out.filter(x=>x.full.cagr>b.full.cagr&&x.full.mdd<b.full.mdd
     &&x.hold.cagr>=b.hold.cagr&&x.hold.mdd<=b.hold.mdd);
 print('EX_GRID',{count:cfg.length,trainPareto:front.length,selected:out.length,dual:dual.length,
   topTrain:cfg.slice(0,8).map(x=>({c:x.c,train:x.train}))});
 print('EX_DUAL',dual.slice().sort((a,b)=>b.full.cagr-a.full.cagr).slice(0,15));
 print('EX_BALANCED',out.slice().sort((a,b)=>score(b.full)-score(a.full)).slice(0,12));
 const valid=[];
 for(const x of dual.slice().sort((a,b)=>score(b.full)-score(a.full)).slice(0,6)){
    let c=x.c;
    valid.push({c,base:x,cap100:{full:run(c,'full',100000),hold:run(c,'hold',100000)},
      cap25:{full:run(c,'full',25000),hold:run(c,'hold',25000)}});
 }
 print('EX_CAPITAL',valid);
 print('EX_DONE',{simulations:n});
})().catch(err=>{console.error('EX_ERROR',err.stack||String(err));process.exitCode=1;});
