#!/usr/bin/env node
'use strict';
// Historical research ONLY. Exact plan quote conversion + complete plan replay.
// Compare current model, ex-ante share sizing and higher commission. No live changes.
const fs=require('fs'),vm=require('vm');
const source=fs.readFileSync('plan-session-engine.js','utf8');
const plan=fs.readFileSync('plan.html','utf8');
const start=plan.indexOf('function quoteToDaily('),end=plan.indexOf('\nconst MKT_CLOSE_MIN=',start);
if(start<0||end<0)throw Error('live quote converter missing');
const qt=new Function(plan.slice(start,end)+';return quoteToDaily;')();
function build(s){const target={};vm.runInNewContext(s,{window:target,console});return target.JKPlanSessionEngine;}
const normal=build(source);
let stress=source;
const changes=[
 ['Math.floor(total*D.teclWeight*w/ep.TECL)','Math.floor(total*D.teclWeight*w/sp.TECL)'],
 ['Math.floor(total*D.guardWeight/ep.TQQQ)','Math.floor(total*D.guardWeight/sp.TQQQ)'],
 ['Math.floor(Math.max(0,total-tt*ep.TECL-tq*ep.TQQQ)/ep.SGOV)','Math.floor(Math.max(0,total-tt*sp.TECL-tq*sp.TQQQ)/sp.SGOV)']
];
for(const [a,b] of changes){
 if(stress.indexOf(a)<0)throw Error('ex ante sizing patch missing '+a);
 stress=stress.replace(a,b);
}
const feasible=build(stress);
const costly=build(source.replace('const FEE_RATE=.001;','const FEE_RATE=.002;'));
const configurations=[
 {id:'BASE',c:{teclWeight:.7,guardWeight:.3,ivsLook:20,ivsS0:.55,ivsBand:.1,guardMA:225,guardBand:.01}},
 {id:'A_60_40_band125',c:{teclWeight:.6,guardWeight:.4,ivsLook:20,ivsS0:.55,ivsBand:.125,guardMA:225,guardBand:.01}},
 {id:'B_65_35_band125',c:{teclWeight:.65,guardWeight:.35,ivsLook:20,ivsS0:.55,ivsBand:.125,guardMA:225,guardBand:.01}},
 {id:'C_60_40_band15',c:{teclWeight:.6,guardWeight:.4,ivsLook:20,ivsS0:.55,ivsBand:.15,guardMA:225,guardBand:.01}}
];
const fmt=x=>+x.toFixed(3),get=x=>({cagr:fmt(x.stats.cagr),mdd:fmt(x.stats.mdd),end:fmt(x.stats.total),trades:x.stats.nTrade});
async function fetchQ(symbol){
 const r=await fetch('https://jkquant.pages.dev/api/quote?symbol='+symbol+'&range=max&div=1&intraday=0',{signal:AbortSignal.timeout(55000)});
 if(!r.ok)throw Error(symbol+' '+r.status);const j=await r.json();
 if(j.priceBasis!=='trade'||!j.ohlcTrade?.length)throw Error(symbol+' has wrong price basis');
 const q=qt(symbol,j);return {name:symbol,rows:q.days,div:q.dividends,end:q.days.at(-1).date};
}
(async()=>{
 const q=await Promise.all(['TECL','TQQQ','SGOV'].map(fetchQ)),data=Object.fromEntries(q.map(x=>[x.name,x]));
 const end=q.map(x=>x.end).sort()[0];
 const params={tecl:data.TECL.rows,tqqq:data.TQQQ.rows,sgov:data.SGOV.rows,
  teclDiv:data.TECL.div,tqqqDiv:data.TQQQ.div,sgovDiv:data.SGOV.div,monthlyAdd:0,horizon:5};
 function run(e,c,cap,s='2021-07-01',t=end){
  Object.assign(e.DEFAULTS[5],c);
  const r=e.replay({...params,principal:cap,startDate:s,endDate:t});
  if(!r.stats)throw Error('replay failed '+r.error);
  return get(r);
 }
 console.log('VALID_META '+JSON.stringify({last:end,priceBasis:'trade',defaultVersion:normal.VERSION,variants:configurations.map(x=>x.id)}));
 for(const x of configurations){
  const caps=[10000,25000,75000,100000];
  const out={id:x.id,c:x.c};
  for(const cap of caps)out['cap_'+cap]={full:run(normal,x.c,cap),holdout:run(normal,x.c,cap,'2024-06-03',end)};
  out.exAnte={full:run(feasible,x.c,75000),holdout:run(feasible,x.c,75000,'2024-06-03',end)};
  out.doubleFee={full:run(costly,x.c,75000),holdout:run(costly,x.c,75000,'2024-06-03',end)};
  for(const yrs of [1,3,5]){
   const rolls=[],now=new Date(end+'T00:00:00Z');
   for(let d=new Date('2021-07-01T00:00:00Z');;d.setUTCMonth(d.getUTCMonth()+1)){
    const z=new Date(d);z.setUTCFullYear(z.getUTCFullYear()+yrs);
    if(z>now)break;
    rolls.push({date:d.toISOString().slice(0,10),...run(normal,x.c,75000,d.toISOString().slice(0,10),z.toISOString().slice(0,10))});
   }
   const cs=rolls.map(x=>x.cagr).sort((a,b)=>a-b),md=rolls.map(x=>x.mdd).sort((a,b)=>b-a);
   out['rolling_'+yrs+'y']={n:rolls.length,worstCagr:cs[0]??null,p10Cagr:cs[Math.floor(cs.length*.1)]??null,medianCagr:cs[Math.floor(cs.length*.5)]??null,worstMdd:md[0]??null};
  }
  console.log('VALID '+JSON.stringify(out));
 }
 console.log('VALID_DONE '+JSON.stringify({cashFlow:'actual dividends',priceData:'official /api/quote',allTests:configurations.length}));
})().catch(e=>{console.error('VALID_ERROR '+(e.stack||String(e)));process.exitCode=1;});
