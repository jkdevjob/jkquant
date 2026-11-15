'use strict';
// Extra calendar-boundary and zero-hook checks; no app or shared-tool edits.
const fs=require('node:fs'),path=require('node:path');
const {engine,setupIM,source,secondary,combine,ledgerAudit}=require('./portfolio-staged-20261115_byGPT.cjs');
const {setupSecondary}=require('./portfolio-taxcash-20261113.cjs');
const D=path.resolve(__dirname,'../im_plan/data'),ser=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series;
function cut(a,s,e){const i=a.findIndex(x=>x.date>=s),k=100/a[i].close;return a.slice(Math.max(0,i-330)).filter(x=>x.date<=e).map(x=>({date:x.date,close:x.close*k}));}
(async()=>{await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh'),E=engine(),out={date:'2026-11-15',cases:[],nativeIVS:0,maxPendingError:0};
for(const ds of['real','syn','oos']){const S=source(ds),{pg,close}=await open([{sym:S.tk,file:S.tf},{sym:S.ut,file:S.uf}]);try{await pg.evaluate(setupSecondary);await pg.evaluate(setupIM);
for(const s of(ds==='real'?['2011-04-01','2015-12-01','2018-12-01']:[S.from]))for(const P of[10000,100000,30000]){const e=String(+s.slice(0,4)+5)+s.slice(4),monthly=P===30000?210:0,days=await pg.evaluate(({s,e,tk})=>dtsOf(tk).filter(d=>d>=s&&d<=e),{s,e,tk:S.tk}),IM=await pg.evaluate(o=>__imBridge(o),{tk:S.tk,cap:P/3,s,e,audit:true});
const base=await secondary(pg,IM,S.ut,P,s,e,days,'base');
if(base.entry){await pg.evaluate(o=>__getSecondary(o),{tkr:S.ut,cap:base.budget,w:1/6,s:base.entry,e,close:false});out.nativeIVS++;}
for(const key of['base','C3']){const z=key==='base'?base:await secondary(pg,IM,S.ut,P,s,e,days,key),R=E.replay({horizon:5,rules:'panic',principal:P*2/3,monthlyAdd:monthly,startDate:s,endDate:e,tecl:S.scale?cut(S.T,s,e):S.T,tqqq:S.scale?cut(S.Q,s,e):S.Q,sgov:S.scale?cut(S.G,s,e):S.G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix:ser('VIX'),vxn:ser('VXN'),gptTransfers:z.transfers,gptTax:{secondary:z,harvest:false,harvestDates:[]}});
if(!R.stats)throw Error(R.error);const r=combine(R,z,P,monthly),a=ledgerAudit(R,monthly,z.transfers);
if(z.entry){if(z.entry<=IM.tau||z.transfers.some(t=>t.date<=IM.tau))throw Error('same-day transition');const total=IM.cash-z.budget;
if(Math.abs(z.transfers.reduce((a,t)=>a+t.amount,0)+z.pending-total)>1e-7)throw Error('internal cash reused');
for(const d of days){const expected=d<z.entry?0:total-z.transfers.filter(t=>t.date<=d).reduce((a,t)=>a+t.amount,0),actual=z.daily[d].eq-base.daily[d].eq,err=Math.abs(expected-actual);out.maxPendingError=Math.max(out.maxPendingError,err);if(err>1e-7)throw Error('daily pending-cash mismatch');}}
out.cases.push({ds,s,P,key,entry:z.entry,scheduled:z.scheduled,final:r.final,taxError:r.taxError,audit:a});}
}}finally{await close();}}
fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf15-staged-audit.json',JSON.stringify(out));console.log(JSON.stringify({cases:out.cases.length,nativeIVS:out.nativeIVS,days:out.cases.reduce((a,x)=>a+x.audit.days,0),maxPendingError:out.maxPendingError,maxCashError:Math.max(...out.cases.map(x=>x.audit.maxErr)),maxTaxError:Math.max(...out.cases.map(x=>x.taxError))}));})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
