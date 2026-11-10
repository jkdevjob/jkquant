'use strict';
// Annual contribution routing, preregistered after the earlier completed run.
// Whole native replay/runIVS. Research hooks add external cash only; no custom
// trade simulator, position reset, withdrawal, or app file modification.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {quant,boot,taxCurve,metadata}=require('./operating-20261110.cjs'),D=path.resolve(__dirname,'../im_plan'),W=5/6,MADD=210;
const V={base:null,annual:1/6,low:.15,high:11/60,proportional:'fixed'};
function plan(){let s=fs.readFileSync(path.join(D,'../../plan-session-engine.js'),'utf8'),key='const date=S.dates[i],month=date.slice(0,7);let force=false;';
 if(s.split(key).length!==2)throw Error('plan cash hook changed');
 s=s.replace(key,key+`const extra=(opt.gptFlows||{})[date]||0;if(extra>0){cash+=extra;inflow+=extra;addCash(ledger,date,'dep',extra,seq++);force=true;}`);
 const c={};vm.runInNewContext(s,c);return c.JKPlanSessionEngine;
}
const read=s=>{const j=JSON.parse(fs.readFileSync(path.join(D,'planrule/data',s+'.json'),'utf8'));return {rows:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
function summarize(rows,key){const a=rows.map(x=>x.v[key]),b=rows.map(x=>x.v.base),rat=a.map((x,i)=>x.final/b[i].final),dm=a.map((x,i)=>x.mdd-b[i].mdd),subset=f=>{const ix=rows.map((x,i)=>f(x.s)?i:-1).filter(i=>i>=0),r=ix.map(i=>rat[i]);return {n:r.length,ratio:quant(r),win:r.filter(x=>x>1+1e-10).length};};
 return {n:rows.length,ratio:quant(rat),ratioCI:boot(rat),win:rat.filter(x=>x>1+1e-10).length,final:quant(a.map(x=>x.final)),p10:quant(a.map(x=>x.final),.1),min:Math.min(...a.map(x=>x.final)),mdd:quant(a.map(x=>x.mdd)),maxMdd:Math.max(...a.map(x=>x.mdd)),deltaMdd:quant(dm),deltaMaxMdd:Math.max(...a.map(x=>x.mdd))-Math.max(...b.map(x=>x.mdd)),front:subset(s=>s<'2016-01-01'),back:subset(s=>s>='2016-01-01'),loss:a.filter(x=>x.final<x.inflow).length,half:a.filter(x=>x.final<x.inflow*.5).length,zero:a.filter(x=>x.final<=.01).length,usdDeposits:quant(a.map(x=>x.usdDeposits)),feesDelta:quant(a.map((x,i)=>x.fees-b[i].fees)),taxDelta:quant(a.map((x,i)=>x.tax-b[i].tax)),tradesDelta:quant(a.map((x,i)=>x.trades-b[i].trades))};}
(async()=>{
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'SOXL'},{sym:'USD'}]),E=plan(),nc={};vm.runInNewContext(fs.readFileSync(path.join(D,'../../plan-session-engine.js'),'utf8'),nc);const N=nc.JKPlanSessionEngine;
 const T=read('TECL'),Q=read('TQQQ'),G=read('SGOV'),ud=new Set(JSON.parse(fs.readFileSync(path.join(D,'data/USD.json'),'utf8')).series.map(x=>x.date)),tm=new Set(T.rows.map(x=>x.date)),dates=Q.rows.map(x=>x.date).filter(d=>tm.has(d)),end=dates.at(-1);
 if(dates.some(d=>d>='2011-04-01'&&!ud.has(d)))throw Error('USD missing common equity day');
 const st=[];for(let y=2011;y<=2021;y++)for(const m of [1,4,7,10]){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s>='2011-04-01'&&e<=end)st.push([s,e]);}
 await pg.evaluate(()=>{
  window.__originalIVS=runIVS;let c=costOf.toString();if(!c.includes('deduct:COST_DEDUCT,'))throw Error('cost hook');(0,eval)('costOf='+c.replace('deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'));
  let s=runIVS.toString();const rep=(a,b)=>{if(s.split(a).length!==2)throw Error('IVS hook '+a);s=s.replace(a,b);};
  rep('days.forEach((d,i)=>{','days.forEach((d,i)=>{cash+=(window.__gptFlows||{})[d]||0;');
  rep('const eq=cash+A.sh*c+B.sh*c1;','const eq=cash+A.sh*c+B.sh*c1;window.__gptCurve.push([d,eq]);');
  rep('settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);','if(!window.__gptPlanning)settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);');
  (0,eval)('window.__flowIVS='+s);
 });
 const out={...metadata(),type:'new contribution-allocation candidate',end,variants:V,sets:{},baseline:{planExact:true,ivsExact:true,expectedPortfolioFinalMaxDifference:0},audit:{monthlyTotal:MADD,annualBudget:2520,priorOnly:true,noHoldingsTransfers:true},caveat:'same L9 split-deduction approximation; exact cross-leg netting and synthetic integer replay not claimed'};
 const old=fs.existsSync('/tmp/jkq-pf-base.json')?JSON.parse(fs.readFileSync('/tmp/jkq-pf-base.json','utf8')):null;
 try{
  for(const cap of [10000,30000,100000]){const rows=[];
   for(const [start,finish]of st){const ds=dates.filter(d=>d>=start&&d<=finish),dep=[];let month=start.slice(0,7);for(const d of ds){if(d.slice(0,7)!==month){month=d.slice(0,7);dep.push(d);}}
    const replay=(flows,to)=>E.replay({horizon:5,rules:'base',startDate:start,endDate:to,principal:cap*W,monthlyAdd:0,gptFlows:flows,tecl:T.rows,tqqq:Q.rows,sgov:G.rows,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
    const ivs=(flows,to,planning)=>pg.evaluate(({initial,from,to,flows,planning})=>{window.__gptFlows=flows;window.__gptPlanning=planning;window.__gptCurve=[];window.__DEDW=1/6;
     const days=Object.keys(M.USD).sort().filter(d=>d>=from&&d<=to),r=window.__flowIVS(days,'USD',initial,.55,40,.15,true,'iv','cash'),curve=window.__gptCurve;
     if(!planning&&!Object.values(flows).some(x=>x>0)){const n=window.__originalIVS(days,'USD',initial,.55,40,.15,true,'iv','cash');if(r.final!==n.final||r.tax!==n.tax||r.fees!==n.fees)throw Error('native IVS baseline changed');}
     if(!planning)curve[curve.length-1][1]=r.final;window.__DEDW=1;
     return {final:r.final,curve,fees:r.fees,tax:r.tax,trades:r.trades};},{initial:cap/6,from:start,to,flows,planning});
    const v={};
    for(const [name,target]of Object.entries(V)){
     const fp=Object.fromEntries(dep.map(d=>[d,MADD])),fs0=Object.fromEntries(dep.map(d=>[d,0])),decisions=[];
     if(target!=null)for(const d of dep.filter(d=>d.slice(5,7)==='01'&&d.slice(0,4)>start.slice(0,4))){
      const prev=dates[dates.indexOf(d)-1],R=replay(fp,prev);if(!R.stats)throw Error(R.error);const at=taxCurve(R,W),S=await ivs(fs0,prev,true);
      const Pvalue=at.final+at.terminalTax,Svalue=S.final;
      const perS=target==='fixed'?35:Math.min(MADD,Math.max(0,(target*(Pvalue+Svalue+2520)-Svalue)/12));
      decisions.push({date:d,signalDate:prev,plan:Pvalue,shannon:Svalue,perS,perP:MADD-perS});
      for(const date of dep.filter(x=>x.slice(0,4)===d.slice(0,4))){if(date<d)throw Error('retroactive flow');fp[date]=MADD-perS;fs0[date]=perS;}
     }
     for(const d of dep)if(Math.abs(fp[d]+fs0[d]-MADD)>1e-8)throw Error('flow conservation');
     const R=replay(fp,finish);if(!R.stats)throw Error(R.error);const at=taxCurve(R,W,true),S=await ivs(fs0,finish,false);
     if(name==='base'){const B=N.replay({horizon:5,rules:'base',startDate:start,endDate:finish,principal:cap*W,monthlyAdd:MADD,tecl:T.rows,tqqq:Q.rows,sgov:G.rows,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
      if(JSON.stringify(B.nav)!==JSON.stringify(R.nav)||JSON.stringify(B.ledger)!==JSON.stringify(R.ledger))throw Error('native replay baseline changed');
      if(old){const b=old[cap]['5/6'].find(x=>x.s===start);if(b){const delta=Math.abs(at.final+S.final-b.fv);out.baseline.expectedPortfolioFinalMaxDifference=Math.max(out.baseline.expectedPortfolioFinalMaxDifference,delta);if(delta>.005)throw Error('L9 final baseline mismatch');}}
     }
     const sm=Object.fromEntries(S.curve);let unit=1,peak=1,mdd=0,previous=cap,lastS=null,flowTotal=0;
     for(const n of at.curve){const sv=sm[n.date]??lastS;if(sv==null)throw Error('Shannon daily gap');lastS=sv;const val=n.total+sv,inflow=(fp[n.date]||0)+(fs0[n.date]||0);unit*=(val-inflow)/previous;peak=Math.max(peak,unit);mdd=Math.max(mdd,(peak-unit)/peak);previous=val;flowTotal+=inflow;}
     if(Math.abs(flowTotal-dep.length*MADD)>1e-6)throw Error('contribution counted twice');
     const tr=R.ledger.events.filter(x=>x.type==='trade');
     v[name]={final:at.final+S.final,mdd:mdd*100,inflow:cap+flowTotal,fees:S.fees+tr.reduce((s,x)=>s+x.fee,0),tax:S.tax+at.tax,trades:S.trades+tr.length,usdDeposits:Object.values(fs0).reduce((s,x)=>s+x,0),decisions};
    }
    rows.push({s:start,e:finish,v});
   }
   out.sets[cap]={rows,summary:Object.fromEntries(Object.keys(V).map(k=>[k,summarize(rows,k)]))};process.stderr.write(`contribution ${cap}: ${rows.length} windows\n`);
  }
 }finally{await close();}
 fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-contribution.json',JSON.stringify(out));for(const[cap,s]of Object.entries(out.sets))console.log(JSON.stringify({cap,summary:s.summary}));console.log(JSON.stringify({baseline:out.baseline}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
