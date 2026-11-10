'use strict';
// Independent sampling/statistics for the request's px synthetic/OOS criteria.
const fs=require('node:fs');const {prep,sim,stats}=require('../im_plan/px');const {mk}=require('../im_plan/plan_rules');
const {quant,boot}=require('./operating-20261110.cjs');
const cfg={G35S30:{hi:40,lo:35,ma:50,band:.02,sleeve:'min',k:3,fbK:3.6}};
cfg.lo30={...cfg.G35S30,lo:30};cfg.k28={...cfg.G35S30,k:2.8};cfg.band1={...cfg.G35S30,band:.01};cfg.band3={...cfg.G35S30,band:.03};
const out={type:'fractional adjusted-price px proxy as requested; not integer replay',sets:{}};
for(const end of ['2026-10-19','2026-11-09'])for(const [ds,ts,from,y0,to] of [['syn','SYNTECL','2000-01-01',2000,end],['oos','SYNTECLN','1987-01-01',1987,'1999-12-31']]){
 const P=prep([ts,'SYNTQQQ']);const n=P.dates.filter(d=>d<=to).length;P.dates=P.dates.slice(0,n);for(const s of P.syms)P.C[s]=P.C[s].slice(0,n);
 for(const cap of [10000,100000]){let base=null;const res={};
  for(const [name,v] of [['base',null],...Object.entries(cfg)]){
   const p={gsb:1e9,fee:.001,...(v?{panic:v}:{})};
   const run=(s,e)=>stats(sim(P,{cap,fee:.001,frac:true,sizePrev:true,...mk(P,ts,'SYNTQQQ',p),from:s,to:e}).eq,cap);
   const windows=[];for(let y=y0;y<=2021;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(e<=to)windows.push({s,...run(s,e)});}
   const full=run(from,to);if(name==='base')base=windows;
   const d=windows.map((x,i)=>x.cagr-base[i].cagr);
   res[name]={full,windows:windows.length,annMedian:quant(windows.map(x=>x.cagr)),delta:quant(d),ci:boot(d),mddMedian:quant(windows.map(x=>x.mdd)),mddMax:Math.max(...windows.map(x=>x.mdd)),lowEarly:quant(d.filter((_,i)=>windows[i].s<'2006')),mid:quant(d.filter((_,i)=>windows[i].s>='2006'&&windows[i].s<'2011'))};
  }
  out.sets[`${end}_${ds}_${cap}`]=res;process.stderr.write(`${end} ${ds} ${cap} proxy done\n`);
 }
}
fs.writeFileSync(process.argv[2]||'/tmp/jkq-r1-proxy.json',JSON.stringify(out));console.log(JSON.stringify(out,null,2));
