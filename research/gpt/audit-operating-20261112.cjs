'use strict';
const fs=require('node:fs');
const {firstSetup}=require('./im-first-20261112.cjs');
(async()=>{await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh');const out={date:'2026-11-12',nativeExact:0,orders:0,sets:{}};
 for(const tk of['SOXL','SYNSOXL_S','TQQQ','SYNTQQQ_S']){const{pg,close}=await open([{sym:tk}]);try{
  await pg.evaluate(firstSetup,tk);
  const r=await pg.evaluate(tk=>{const all=Object.keys(M[tk]).sort().filter(d=>d<='2026-11-11'),periods=[[all[0],'2026-11-11'],['2017-04-01','2022-04-01'],['2018-10-01','2023-10-01'],['2021-06-01','2026-06-01']];let exact=0,orders=0;const traces=[];
   window.__FIRST_GATE=()=>1;const wrapped=_imBuyPlan;
   for(const cap of[10000,100000])for(const[s,e]of periods){const days=all.filter(d=>d>=s&&d<=e);_imBuyPlan=window.__ORIGINAL_BUY;imAutoTp=true;imCostOn=true;imReverse=false;const n=runIM(days,tk,cap,20,20,true,20);_imBuyPlan=wrapped;
    const h=RUN({tkr:tk,cap,from:s,to:e,autoTp:true,big:20});for(const k of['final','mdd','fees','tax','cycles'])if(Math.abs(h[k]-n[k])>1e-7)throw Error('Baseline mismatch '+k);exact++;}
   for(const cash of[10000,100000])for(const pc of[10,50,300])for(const m of[1,1.25,1.5,2]){
    window.__FIRST_M=m;const lim=pc*1.2,fee=.0025,plan=_imBuyPlan(0,0,0,cash,20,20,2,lim,pc,fee,3,'usd');
    const expected=imBuyOrders({first:true,half:false,buy1:cash/20*m,bal:cash,firstPrice:lim,starPrice:imBuyPx(0),avg:0,rows:3,fee,cur:'usd'}).map(o=>({lim:o.price,q:o.q,dT:o.dT*m,kind:o.kind,ladder:o.ladder}));
    if(JSON.stringify(plan)!==JSON.stringify(expected))throw Error('Budget or T transformation differs');
    const reserved=plan.reduce((s,b)=>s+b.q*b.lim*(1+fee),0);if(reserved>cash+1e-6||plan.some(b=>!Number.isInteger(b.q)))throw Error('Cash conservation/integer order');
    // A non-first installment must ignore the enlarged first-day multiplier.
    if(JSON.stringify(_imBuyPlan(4,pc,20,cash,20,20,2,lim,pc,fee,3,'usd'))!==JSON.stringify(window.__ORIGINAL_BUY(4,pc,20,cash,20,20,2,lim,pc,fee,3,'usd')))throw Error('Later installment altered');orders++;
   }
   if(tk==='SOXL')for(const cap of[10000,100000])for(const m of[1,1.5])for(const j of[.99,1,1.01]){window.__FIRST_GATE=()=>m;const r=RUN({tkr:tk,cap:cap*j,from:'2018-10-01',to:'2023-10-01',autoTp:true,big:20,trace:true}),first=r.trace.tr.find(x=>x[3]>0);if(!first||Math.abs(first[5]-m)>1e-9)throw Error('First filled T differs');
    let peak=cap*j,md=0,pd='',a='',b='';for(const[d,eq]of r.eqs){if(eq>peak){peak=eq;pd=d;}else if((peak-eq)/peak>md){md=(peak-eq)/peak;a=pd;b=d;}}
    traces.push({cap,j,m,first:first.slice(0,8),final:r.final,mdd:md*100,peak:a,trough:b,cycles:r.cycles,fees:r.fees,tax:r.tax});}
   return{exact,orders,traces};},tk);
  out.nativeExact+=r.exact;out.orders+=r.orders;out.sets[tk]=r;
 }finally{await close();}}
 fs.writeFileSync('/tmp/jkq-20261112-audit.json',JSON.stringify(out));console.log(JSON.stringify(out));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
