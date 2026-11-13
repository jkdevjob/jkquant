'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {browserSetup,dualTax}=require('./portfolio-monthly-20261113.cjs');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan');
const rd=(s,sub='data')=>JSON.parse(fs.readFileSync(path.join(D,sub,s+'.json')));
const q=s=>{const j=rd(s,'planrule/data');return {p:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:x.close})),d:j.dividends||[]};};
(async()=>{
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'USD'},{sym:'SOXL'}]);const ctx={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8'),ctx);const E=ctx.JKPlanSessionEngine;
 const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'),out={date:'2026-11-13',parity:{n:0,maxFinalError:0},signal:{},taxCases:[],maNativeCases:0};
 try{
  await pg.evaluate(browserSetup);
  for(const cap of [10000/6,30000/6,100000/6])for(const s of ['2011-04-01','2016-04-01','2021-04-01']){
   const e=`${+s.slice(0,4)+5}${s.slice(4)}`;
   await pg.evaluate(o=>window.__secondary(o),{tkr:'USD',cap,s,e,w:1/6,kind:'ma',joint:false,liquidate:false,dual:{}});out.maNativeCases++;
   const Z=await pg.evaluate(o=>window.__secondary(o),{tkr:'USD',cap,s,e,w:1/6,kind:'ma',joint:false,liquidate:true,dual:{}});if(Z.end.shares!==0)throw Error('native MA liquidation');
  }
  const input=await pg.evaluate(()=>dtsOf('USD').map(d=>[d,M.USD[d][C],divPerShare('USD',d)]));
  let tr=100;const x=input.map(([d,c,dv],i)=>{if(i)tr*=(c+dv)/input[i-1][1];return {d,tr};});
  for(const n of [9,10,11]){
   const ends=[],expected={};let hold=false;
   for(let i=0;i<x.length;i++){
    if(i+1<x.length&&x[i+1].d.slice(0,7)!==x[i].d.slice(0,7)){ends.push(x[i]);if(ends.length>=n){const sma=ends.slice(-n).reduce((s,r)=>s+r.tr,0)/n;if(x[i].tr>sma)hold=true;else if(x[i].tr<sma)hold=false;}}
    expected[x[i].d]=hold;
   }
   const actual=await pg.evaluate(n=>window.__buildMonthly('USD',n).above,n),diff=input.filter(([d])=>expected[d]!==actual[d]);if(diff.length)throw Error('independent monthly signal mismatch '+n+' '+JSON.stringify(diff[0]));out.signal[n]={dates:input.length,different:0};
  }
  out.mutations=await pg.evaluate(()=>{
   const rows=[];for(const d of ['2018-02-02','2020-03-02','2025-05-01','2026-11-12']){const dates=dtsOf('USD'),k=dates.indexOf(d),p=dates[k-1],original=M.USD[d][C],b=window.__buildMonthly('USD',10).above;
    try{M.USD[d][C]=original*.1;const a=window.__buildMonthly('USD',10).above;const earlier=dates.slice(0,k).filter(x=>a[x]!==b[x]);if(earlier.length)throw Error('current day leaks into earlier signal');rows.push({date:d,signalDate:p,before:b[p],after:a[p],earlierChanges:earlier.length});}finally{M.USD[d][C]=original;}}
   return rows;
  });
  const ref=JSON.parse(fs.readFileSync('/tmp/jkq-pf-app-20261113.json'));
  for(const cap of [10000,30000,100000])for(const w of [2/3,5/6])for(const row of ref[cap][w===2/3?'2/3':'5/6']){
   const s=row.s,e=`${+s.slice(0,4)+5}${s.slice(4)}`,R=E.replay({horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*w,monthlyAdd:210,tecl:T.p,tqqq:Q.p,sgov:G.p,teclDiv:T.d,tqqqDiv:Q.d,sgovDiv:G.d}),P=dualTax(R,w);
   const Z=await pg.evaluate(o=>window.__secondary(o),{tkr:'USD',cap:cap*(1-w),s,e,w:1-w,kind:'ivs',joint:false,liquidate:false,dual:P.years});
   const err=Math.abs(P.final+Z.final-row.fv);out.parity.n++;out.parity.maxFinalError=Math.max(out.parity.maxFinalError,err);if(err>1e-6)throw Error('pf_app full baseline parity '+err);
  }
  // Hand-calculable gain/loss and unused-deduction cases for the joint callback.
  for(const [dg,sg]of [[5000,-1000],[0,4000],[-3000,5000],[1000,500],[5000,1000]]){
   const D=250e4/1350,dgtax=Math.max(0,dg-D*5/6)*.22,expected=Math.max(0,dg+sg-D)*.22;
   const val=await pg.evaluate(({dg,sg,dgtax})=>{window.__taxCtx={joint:true,tkr:'USD',dual:{2020:{gain:dg,tax:dgtax}},years:{}};return window.__jointTax(sg,'2020');},{dg,sg,dgtax});
   if(Math.abs(val+dgtax-expected)>1e-8)throw Error('manual tax case');out.taxCases.push({dg,sg,dgTax:dgtax,secondaryDifference:val,total:expected});
  }
  const R=E.replay({horizon:5,rules:'panic',startDate:'2011-04-01',endDate:'2026-11-12',principal:25000,monthlyAdd:210,tecl:T.p,tqqq:Q.p,sgov:G.p,teclDiv:T.d,tqqqDiv:Q.d,sgovDiv:G.d,vix:rd('VIX').series,vxn:rd('VXN').series});
  out.market={end:R.last.date,tecl:R.last.teclPx,tqqq:R.last.tqqqPx,panic:R.panic,lastDecision:R.lastDecision};
 }finally{await close();}
 fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-audit-20261113.json',JSON.stringify(out));console.log(JSON.stringify(out));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
