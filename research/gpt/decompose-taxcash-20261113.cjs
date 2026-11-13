'use strict';
// Post-hoc attribution only. No new candidate selection or revised threshold.
const fs=require('node:fs'),path=require('node:path');
const {loadCashEngine,setupSecondary,source,combineCash}=require('./portfolio-taxcash-20261113.cjs');
const {summary}=require('./portfolio-monthly-20261113.cjs'),TC=require('../../plan-tax-check.js');
(async()=>{
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'USD'},{sym:'SOXL'}]),E=loadCashEngine(),S=source('real'),D=path.resolve(__dirname,'../im_plan/data'),ser=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series,vix=ser('VIX'),vxn=ser('VXN');
 const ref=JSON.parse(fs.readFileSync('/tmp/jkq-pf-taxcash-real-20261113.json')),out={date:'2026-11-13',postHoc:true,maxParity:0,sets:{}};
 const hd=[];for(let y=2010;y<=2025;y++){const a=S.T.filter(x=>x.date.slice(0,4)===String(y)&&x.date<=TC.lastTradeDate(y));if(a.length)hd.push(a.at(-1).date);}
 try{await pg.evaluate(setupSecondary);
  for(const [name,set]of Object.entries(ref.sets.real)){const {cap,monthly}=set,rows=[];let fills=0,offsets=0;
   for(const rr of set.rows){const s=rr.s,e=rr.e,w=5/6,z=await pg.evaluate(o=>window.__getSecondary(o),{tkr:'USD',cap:cap*(1-w),w:1-w,s,e,close:true});const v={base:rr.v.base};
    for(const [key,onlyMode]of [['H90',null],['fill','fill'],['offset','offset']]){
     const R=E.replay({horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*w,monthlyAdd:monthly,tecl:S.T,tqqq:S.Q,sgov:S.G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix,vxn,gptTax:{secondary:z,harvest:true,margin:.9,harvestDates:hd,onlyMode}});
     v[key]=combineCash(R,z,cap,w);
     if(key==='H90'){for(const fld of ['final','mdd','tax','fees']){const diff=Math.abs(v[key][fld]-rr.v.H90[fld]);out.maxParity=Math.max(out.maxParity,diff);if(diff>1e-6)throw Error('new diagnostic option changed default '+fld);}
      fills+=R.gptTax.harvestLog.filter(x=>x.proposalMode==='fill').length;offsets+=R.gptTax.harvestLog.filter(x=>x.proposalMode==='offset').length;}
    }
    rows.push({s,e,yrs:rr.yrs,v});
   }
   out.sets[name]={cap,monthly,rows,fills,offsets,summary:Object.fromEntries(['H90','fill','offset'].map(k=>[k,summary(rows,k,'2016-04-01')]))};
   fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-taxcash-decomposition-20261113.json',JSON.stringify(out));console.log(JSON.stringify({name,fills,offsets,summary:out.sets[name].summary}));
  }
 }finally{await close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
