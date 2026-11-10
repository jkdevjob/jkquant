'use strict';
// R-20261110-1: fresh replay of all windows, independent tax and paired stats.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {quant,boot,mean,starts,taxCurve,metadata}=require('./operating-20261110.cjs');
const D=path.resolve(__dirname,'../im_plan'),P={hi:40,lo:35,ma:50,band:.02,sleeve:'min',k:3,fbK:3.6};
const V={G35S30:P,lo30:{...P,lo:30},k28:{...P,k:2.8},band1:{...P,band:.01},band3:{...P,band:.03}};
const E=require('../im_plan/planrule/engine_panic').load(V),c={};vm.runInNewContext(fs.readFileSync(path.join(D,'../../plan-session-engine.js'),'utf8'),c);const N=c.JKPlanSessionEngine;
const read=s=>{const j=JSON.parse(fs.readFileSync(path.join(D,'planrule/data',s+'.json'),'utf8'));return {days:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
const T=read('TECL'),Q=read('TQQQ'),G=read('SGOV');
const out={...metadata(),request:'R-20261110-1',V,ends:{},engineBaselineIdentical:true};
function summarize(rows,k){const b=rows.map(x=>x.r.base),a=rows.map(x=>x.r[k]),d=a.map((x,i)=>x.ann-b[i].ann),dm=a.map((x,i)=>x.mdd-b[i].mdd),front=d.filter((_,i)=>rows[i].s<'2016-04-01'),back=d.filter((_,i)=>rows[i].s>='2016-04-01');
 return {n:a.length,ann:quant(a.map(x=>x.ann)),annWorst:Math.min(...a.map(x=>x.ann)),mdd:quant(a.map(x=>x.mdd)),mddMax:Math.max(...a.map(x=>x.mdd)),deltaAnn:quant(d),ci:boot(d),deltaMdd:quant(dm),deltaMaxMdd:Math.max(...a.map(x=>x.mdd))-Math.max(...b.map(x=>x.mdd)),front:quant(front),back:quant(back),higher:d.filter(x=>x>1e-9).length,lower:d.filter(x=>x<-1e-9).length,both:rows.filter((x,i)=>d[i]>0&&dm[i]<=0).length,worse:rows.filter((x,i)=>d[i]<0&&dm[i]>0).length,zero:a.filter(x=>x.final<=.01).length};}
for(const end of ['2026-11-06','2026-11-09']){
 const st=starts('2011-04-01',end,2011).filter(([s])=>s>='2011-04-01'),sets={};
 for(const [name,P0,M] of [['10k',10000,0],['100k',100000,0],['25kMonthly',25000,210],['paper',69244,69.24]]){
  const run=(s,e,k)=>{const o={horizon:5,rules:k,startDate:s,endDate:e,principal:P0,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div},r=E.replay(o);if(!r.stats)throw Error(r.error);
   if(k==='base'&&s==='2011-04-01'&&e===end){const n=N.replay(o);if(JSON.stringify(r)!==JSON.stringify(n))throw Error('baseline original mismatch');}
   for(const x of r.ledger.events)if(x.type==='trade'&&x.signalDate>=x.date)throw Error('lookahead');
   const at=taxCurve(r);return {ann:(Math.pow(at.final/r.last.inflow,1/r.stats.yrs)-1)*100,mdd:r.stats.mdd,final:at.final,tax:at.tax};};
  const keys=['base',...Object.keys(V)],full=Object.fromEntries(keys.map(k=>[k,run('2011-04-01',end,k)])),rows=st.map(([s,e])=>({s,e,r:Object.fromEntries(keys.map(k=>[k,run(s,e,k)]))})),summary=Object.fromEntries(keys.map(k=>[k,summarize(rows,k)]));
  sets[name]={P:P0,M,full,summary,rows};process.stderr.write(`${end} ${name} reproduced\n`);
 }
 out.ends[end]=sets;
}
fs.writeFileSync(process.argv[2]||'/tmp/jkq-r1.json',JSON.stringify(out));
for(const [end,sets] of Object.entries(out.ends))for(const [name,s] of Object.entries(sets))console.log(JSON.stringify({end,name,full:s.full,summary:s.summary}));
