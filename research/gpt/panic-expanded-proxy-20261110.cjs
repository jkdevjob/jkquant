'use strict';
// Additional preregistered neighborhood/control/cost tests from the new review.
const fs=require('node:fs'),{prep,sim,stats}=require('../im_plan/px'),{mk}=require('../im_plan/plan_rules');
const {quant,boot}=require('./operating-20261110.cjs');
const P={hi:40,lo:35,ma:50,band:.02,sleeve:'min',k:3,fbK:3.6};
const V={main:P,ctl25:{hi:0,lo:25,ma:50,band:.02},ctl30:{hi:0,lo:30,ma:50,band:.02},hi38:{...P,hi:38},hi42:{...P,hi:42},hi45:{...P,hi:45},lo33:{...P,lo:33},lo37:{...P,lo:37},ma40:{...P,ma:40},ma60:{...P,ma:60},b15:{...P,band:.015},b25:{...P,band:.025},k28:{...P,k:2.8,fbK:3.35},k32:{...P,k:3.2,fbK:3.85}};
const out={end:'2026-11-09',sets:{},priceBasis:'adjusted/fractional synthetic proxy, never mislabeled native replay'};
for(const[ds,t,q,y0]of [['real','TECL','TQQQ',2011],['syn','SYNTECL','SYNTQQQ',2000]]){
 const S=prep([t,q]),last=S.dates.at(-1),starts=[];for(let y=y0;y<=2021;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(e<=last)starts.push([s,e]);}
 for(const cap of [10000,100000]){const res={};
  for(const fee of [.001,.0025]){
   const names=fee===.001?Object.entries({base:null,...V}):[['base',null],['main',P]];let base=null;
   for(const[name,panic]of names){const o={cap,fee,frac:ds==='syn',sizePrev:true,...mk(S,t,q,{gsb:1e9,fee,...(panic?{panic}:{})})},run=(from,to)=>stats(sim(S,{...o,from,to}).eq,cap),win=starts.map(([s,e])=>run(s,e)),full=run(ds==='syn'?'2000-01-01':'2011-01-01',last);if(!panic)base=win;
    const d=win.map((x,i)=>x.cagr-base[i].cagr),dm=win.map((x,i)=>x.mdd-base[i].mdd),eps=.05;
    res[fee+'_'+name]={full,n:win.length,delta:quant(d),ci:boot(d),mdd:quant(dm),both:d.filter((x,i)=>x>=-eps&&dm[i]<=eps&&(x>eps||dm[i]<-eps)).length,worse:d.filter((x,i)=>x<=eps&&dm[i]>=-eps&&(x<-eps||dm[i]>eps)).length,lower:d.filter(x=>x<0).length,annMedian:quant(win.map(x=>x.cagr)),mddMedian:quant(win.map(x=>x.mdd)),maxMdd:Math.max(...win.map(x=>x.mdd))};
    process.stderr.write(`${ds} ${cap} ${fee} ${name}\n`);
   }
  }
  out.sets[`${ds}_${cap}`]=res;
 }
}
fs.writeFileSync(process.argv[2]||'/tmp/jkq-r1-expanded.json',JSON.stringify(out));console.log(JSON.stringify(out,null,2));
