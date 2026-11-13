'use strict';
// Direction check only: same physical-tax policy, two starting allocations.
const fs=require('node:fs'),path=require('node:path');
const {loadCashEngine,setupSecondary,source,combineCash}=require('./portfolio-taxcash-20261113.cjs');
const {quant,boot}=require('./operating-20261110.cjs');
(async()=>{
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'USD'},{sym:'SOXL'}]),S=source('real'),E=loadCashEngine(),root=path.resolve(__dirname,'../im_plan/data');
 const ser=s=>JSON.parse(fs.readFileSync(path.join(root,s+'.json'))).series,vix=ser('VIX'),vxn=ser('VXN'),out={date:'2026-11-13',end:'2026-11-12',sets:{}};
 try{await pg.evaluate(setupSecondary);
  for(const [name,cap,monthly]of [['10k',10000,0],['100k',100000,0],['user',30000,210]]){const rows=[];
   for(let y=2011;y<=2021;y++)for(let m=1;m<=12;m++){
    const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s<'2011-04-01'||e>'2026-11-12')continue;const r={s,e};
    for(const [k,w]of [['5/6',5/6],['2/3',2/3]]){
     const z=await pg.evaluate(o=>window.__getSecondary(o),{tkr:'USD',cap:cap*(1-w),w:1-w,s,e,close:true});
     const R=E.replay({horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*w,monthlyAdd:monthly,tecl:S.T,tqqq:S.Q,sgov:S.G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix,vxn,gptTax:{secondary:z,harvest:false,harvestDates:[]}});
     r[k]=combineCash(R,z,cap,w);
    }
    r.ratio=r['5/6'].final/r['2/3'].final;r.dm=r['5/6'].mdd-r['2/3'].mdd;rows.push(r);
   }
   const q=rows.map(r=>r.ratio),part=f=>quant(rows.filter(r=>f(r.s)).map(r=>r.ratio));
   out.sets[name]={cap,monthly,rows,summary:{n:rows.length,ratio:quant(q),ci:boot(q),wins:q.filter(x=>x>1).length,front:part(s=>s<'2016-04-01'),back:part(s=>s>='2016-04-01'),deltaMdd:quant(rows.map(r=>r.dm)),deltaWorstMdd:Math.max(...rows.map(r=>r['5/6'].mdd))-Math.max(...rows.map(r=>r['2/3'].mdd))}};
   fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-cash-allocation-20261113.json',JSON.stringify(out));console.log(JSON.stringify({name,summary:out.sets[name].summary}));
  }
 }finally{await close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
