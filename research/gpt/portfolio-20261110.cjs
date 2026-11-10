'use strict';
// L9:PLAN year-end loss harvesting. Full application replay / runIVS, with
// research-only order insertion. No application, tax or price loader edits.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {quant,boot,taxCurve,metadata}=require('./operating-20261110.cjs');
const D=path.resolve(__dirname,'../im_plan'),W=5/6;
function load(){let src=fs.readFileSync(path.join(D,'../../plan-session-engine.js'),'utf8');
 const rep=(a,b)=>{if(src.split(a).length!==2)throw Error('harvest hook '+a);src=src.replace(a,b);};
 rep('let cash=principal,inflow=principal,','const __harvestLog=[];let cash=principal,inflow=principal,');
 rep('      if(need){\n        const r=targetOrders',`      const __planned=[];
      if(opt.gptHarvest!=null&&date.slice(5,7)==='12'&&+date.slice(8,10)>=28&&(!S.dates[i+1]||S.dates[i+1].slice(0,4)!==date.slice(0,4))){
        const book={};let rg=0;for(const e of ledger.events){if(e.date>=date||e.type!=='trade')continue;const b=book[e.symbol]||(book[e.symbol]={q:0,c:0});if(e.side==='buy'){b.q+=e.qty;b.c+=e.qty*e.price+e.fee;}else if(b.q>0){const c=b.c/b.q*e.qty;if(e.date.slice(0,4)===date.slice(0,4))rg+=e.qty*e.price-e.fee-c;b.q-=e.qty;b.c-=c;if(b.q<1e-9)b.q=b.c=0;}}
        let needLoss=rg-250e4/1350*(opt.gptDedW??1);
        for(const sym of ['TECL','TQQQ','SGOV']){const b=book[sym];if(!(needLoss>0&&b&&b.q>0&&sp[sym]>0))continue;const avg=b.c/b.q;if(sp[sym]>avg*(1-opt.gptHarvest))continue;const q=Math.min(b.q,Math.ceil(needLoss/(avg-sp[sym]+sp[sym]*FEE_RATE)));if(q>0){__planned.push({sym,q,signalDate:S.dates[p]});needLoss-=q*(avg-sp[sym]+sp[sym]*FEE_RATE);}}
      }
      if(need){
        const r=targetOrders`);
 rep('      lastDecision={date,signalDate:',`      for(const h of __planned){
        let q=Math.min(h.q,pos[h.sym]);const price=ep[h.sym];if(!(q>0&&price>0))continue;
        if(alphaFee(q,price)*2>cash)q=Math.min(q,Math.floor(Math.max(0,cash)/(price*FEE_RATE*2)));
        if(!(q>0)||alphaFee(q,price)*2>cash+1e-9)continue;
        const fee=alphaFee(q,price),gross=q*price;
        cash+=gross-fee;pos[h.sym]-=q;addTrade(ledger,date,'sell',h.sym,q,price,fee,seq++,h.signalDate);
        cash-=gross+fee;pos[h.sym]+=q;addTrade(ledger,date,'buy',h.sym,q,price,fee,seq++,h.signalDate);nTrade+=2;
        __harvestLog.push({date,symbol:h.sym,qty:q,fee:2*fee,signalDate:h.signalDate});
      }
      lastDecision={date,signalDate:`);
 rep('return {horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,','return {researchHarvest:__harvestLog,horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,');
 const c={};vm.runInNewContext(src,c);return c.JKPlanSessionEngine;
}
const read=s=>{const j=JSON.parse(fs.readFileSync(path.join(D,'planrule/data',s+'.json'),'utf8'));return {days:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
function summary(rows,key){const a=rows.map(x=>x.v[key]),b=rows.map(x=>x.v.base),rat=a.map((x,i)=>x.final/b[i].final),dm=a.map((x,i)=>x.mdd-b[i].mdd),part=f=>quant(rat.filter((_,i)=>f(rows[i].s)));
 return {n:rows.length,final:quant(a.map(x=>x.final)),final10:quant(a.map(x=>x.final),.1),finalMin:Math.min(...a.map(x=>x.final)),ratio:quant(rat),ratioCI:boot(rat),higher:rat.filter(x=>x>1+1e-10).length,front:part(s=>s<'2016-01-01'),back:part(s=>s>='2016-01-01'),mdd:quant(a.map(x=>x.mdd)),mddMax:Math.max(...a.map(x=>x.mdd)),deltaMdd:quant(dm),deltaMaxMdd:Math.max(...a.map(x=>x.mdd))-Math.max(...b.map(x=>x.mdd)),lossCount:a.filter(x=>x.final<x.inflow).length,halfCount:a.filter(x=>x.final<x.inflow*.5).length,harvestCount:quant(a.map(x=>x.harvestCount)),harvestFees:quant(a.map(x=>x.harvestFees)),taxDelta:quant(a.map((x,i)=>x.planTax-b[i].planTax))};}
(async()=>{
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'SOXL'},{sym:'USD'}]);
 const out={...metadata(),mode:'portfolio L9:PLAN',W,monthly:210,sets:{},caveat:'one deduction split by capital weight; no double deduction, cross-leg netting remains approximation; no mixed pre/post tax TWR used'};
 try{
  await pg.evaluate(()=>{
   window.__nativeIVS=runIVS;window.__nativeCost=costOf;
   let c=costOf.toString();if(!c.includes('deduct:COST_DEDUCT,'))throw Error('cost hook');(0,eval)('costOf='+c.replace('deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),'));
   let s=runIVS.toString();const a='const eq=cash+A.sh*c+B.sh*c1;';if(s.split(a).length!==2)throw Error('IVS daily hook');s=s.replace(a,a+'window.__curve.push([d,eq]);');(0,eval)('window.__probeIVS='+s);
  });
  const E=load(),c={};vm.runInNewContext(fs.readFileSync(path.join(D,'../../plan-session-engine.js'),'utf8'),c);const N=c.JKPlanSessionEngine,T=read('TECL'),Q=read('TQQQ'),G=read('SGOV'),end=T.days.at(-1).date;
  const st=[];for(let y=2011;y<=2021;y++)for(const m of [1,4,7,10]){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s>='2011-04-01'&&e<=end)st.push([s,e]);}
  const existing=fs.existsSync('/tmp/jkq-pf-base.json')?JSON.parse(fs.readFileSync('/tmp/jkq-pf-base.json','utf8')):null;
  for(const cap of [10000,30000,100000]){const rows=[];let maxBaselineDiff=0;
   for(const [s,e] of st){
    const S=await pg.evaluate(({cap,s,e})=>{window.__DEDW=1/6;window.__curve=[];const days=Object.keys(M.USD).sort().filter(d=>d>=s&&d<=e),r=window.__probeIVS(days,'USD',cap/6,.55,40,.15,true,'iv','cash');
     if(s==='2011-04-01'){const n=window.__nativeIVS(days,'USD',cap/6,.55,40,.15,true,'iv','cash');if(r.final!==n.final||r.mdd!==n.mdd||r.tax!==n.tax)throw Error('native IVS mismatch');}
     const curve=window.__curve;curve[curve.length-1][1]=r.final;window.__DEDW=1;return {final:r.final,curve,tax:r.tax};},{cap,s,e});
    const sm=Object.fromEntries(S.curve),v={};
    for(const [name,loss] of [['base',null],['h5',.05],['h25',.025],['h10',.1]]){
     const o={horizon:5,rules:'base',startDate:s,endDate:e,principal:cap*W,monthlyAdd:210,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div};if(loss!=null){o.gptHarvest=loss;o.gptDedW=W;}
     const R=E.replay(o);if(!R.stats)throw Error(R.error);
     if(name==='base'&&s==='2011-04-01'){const r=N.replay(o);if(JSON.stringify(R.nav)!==JSON.stringify(r.nav)||JSON.stringify(R.ledger)!==JSON.stringify(r.ledger))throw Error('native replay mismatch');}
     const at=taxCurve(R,W,true);let nav=1,peak=1,mdd=0,prev=cap,inflow=cap*W,lastS=null;
     for(const n of at.curve){const iv=sm[n.date]??lastS;if(iv==null)continue;lastS=iv;const total=n.total+iv,F=n.inflow-inflow;nav*=(total-F)/prev;peak=Math.max(peak,nav);mdd=Math.max(mdd,(peak-nav)/peak);prev=total;inflow=n.inflow;}
     if(!Number.isFinite(mdd)||at.final<0)throw Error('invalid tax curve');
     const h=R.researchHarvest;v[name]={final:at.final+S.final,planTax:at.tax,ivsTax:S.tax,mdd:100*mdd,inflow:R.last.inflow+cap/6,harvestCount:h.length,harvestFees:h.reduce((x,r)=>x+r.fee,0)};
    }
    if(existing){const b=existing[cap]['5/6'].find(x=>x.s===s);maxBaselineDiff=Math.max(maxBaselineDiff,Math.abs(v.base.final-b.fv));if(Math.abs(v.base.final-b.fv)>.005)throw Error('pf_app baseline final mismatch');}
    rows.push({s,e,v});
   }
   out.sets[cap]={rows,maxBaselineFinalDiff:maxBaselineDiff,summary:Object.fromEntries(['base','h5','h25','h10'].map(k=>[k,summary(rows,k)]))};process.stderr.write(`portfolio ${cap} ${rows.length} windows done\n`);
  }
 }finally{await close();}
 fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-harvest.json',JSON.stringify(out));for(const [cap,s] of Object.entries(out.sets))console.log(JSON.stringify({cap,baselineDiff:s.maxBaselineFinalDiff,summary:s.summary}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
