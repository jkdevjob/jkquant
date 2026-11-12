'use strict';
// Independent baseline reproduction. Original runIVS plus a diagnostic clone
// that only calls its own sell/tax functions at the final close.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {starts,dist,quant:q}=require('./operating-20261110.cjs');
const OUT=process.argv[2]||'/tmp/jkq-20261112-shannon.json',ROOT=path.resolve(__dirname,'../..');
(async()=>{await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh');const out={date:'2026-11-12',params:{s0:.55,N:40,band:.15,mode:'iv',pair:'cash',cost:true},engine:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'backtest.html'))).digest('hex'),audit:{nativeExact:0},sets:{}};
 for(const[ds,tk,file,y0]of[['tq','TQQQ','TQQQ',2010],['usd','USD','USD',2007],['tqsyn','SYNTQQQ_S','SYNTQQQ_S',1990],['usdsyn','USD','SYNUSD_S',1995]]){
  const{pg,close}=await open([{sym:tk,file}]);try{
   const irx=JSON.parse(fs.readFileSync(path.join(ROOT,'research/im_plan/data/IRX.json'))).series;
   const setup=await pg.evaluate(({tk,irx})=>{window.__IRX=Object.fromEntries(irx.filter(x=>x.date<='2026-11-11').map(x=>[x.date,x.close]));let s=runIVS.toString().replace('function runIVS(','function runIVSResearch(');
    const n='  settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);';if(s.split(n).length!==2)throw Error('IVS terminal hook changed');
    s=s.replace(n,'  if(window.__GPT_LIQ){if(A.sh>0)_sell(A,lc,A.sh);if(B.sh>0&&lc1>0)_sell(B,lc1,B.sh);}\n'+n);(0,eval)(s);
    const all=Object.keys(M[tk]).sort().filter(d=>d<='2026-11-11');return{first:all[45],last:all.at(-1)};},{tk,irx});
   const st=starts(setup.first,setup.last,y0),caps={};
   for(const cap of[10000,100000]){
    const result=await pg.evaluate(({tk,cap,st,first,last})=>{const all=Object.keys(M[tk]).sort().filter(d=>d<=last);let exact=0;
     const one=(s,e,audit)=>{const days=all.filter(d=>d>=s&&d<=e),args=[days,tk,cap,.55,40,.15,true,'iv','cash'];window.__GPT_LIQ=false;const native=runIVS(...args),same=runIVSResearch(...args);if(JSON.stringify(native)!==JSON.stringify(same))throw Error('IVS native differs');exact++;
      window.__GPT_LIQ=true;const liq=runIVSResearch(...args);window.__GPT_LIQ=false;
      const yrs=(Date.parse(days.at(-1))-Date.parse(days[0]))/(365.25*864e5),ann=f=>(Math.pow(Math.max(f,1e-12)/cap,1/yrs)-1)*100;
      return{ann:ann(native.final),netAnn:ann(liq.final),final:native.final,netFinal:liq.final,mdd:native.mdd,liquidatedPathMdd:liq.mdd,tax:native.tax,netTax:liq.tax,fees:native.fees,netFees:liq.fees,rebals:native.rebals,rebPerYear:native.rebals/yrs,terminalDifference:native.final-liq.final,zero:liq.final<=.01,first:days[0],last:days.at(-1),shares:native.endShares,netShares:liq.endShares};};
     return{full:one(first,last,true),win:st.map(([s,e])=>one(s,e)),exact};},{tk,cap,st,...setup});
    out.audit.nativeExact+=result.exact;const net=result.win.map(x=>({...x,ann:x.netAnn,final:x.netFinal,mdd:x.liquidatedPathMdd}));
    caps[cap]={...result,summary:{native:dist(result.win),liquidated:dist(net),omissionMedian:q(result.win.map(x=>x.terminalDifference)),rebPerYear:q(result.win.map(x=>x.rebPerYear)),netAnnDelta:q(result.win.map(x=>x.netAnn-x.ann))}};
    console.log(JSON.stringify({ds,cap,full:result.full,summary:caps[cap].summary}));
   }
   out.sets[ds]={tk,file,...setup,starts:st,caps};fs.writeFileSync(OUT,JSON.stringify(out));
  }finally{await close();}
 }
 console.log(JSON.stringify({audit:out.audit}));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
