'use strict';
// R-20261119-2: per-symbol paired windows and native terminal liquidation check.
const fs=require('node:fs');
const {boot,quant,starts}=require('./operating-20261110.cjs');
const end=process.env.END||'2026-11-18';
const synthetic={SOXL:'SYNSOXL_S',USD:'SYNUSD_S',TECL:'SYNTECL_S',QLD:'SYNQLD_S',TQQQ:'SYNTQQQ_S'};
const caps=[10000,100000,30000], bands=[15,17.5,20,22.5];

function setup(){
  let source=runVR.toString().replace('function runVR(','function __terminalVR(');
  const close='const lc=tradeBar(tkr,days[days.length-1])[C];';
  const yrs='const calYrs=(new Date(days[days.length-1])-new Date(days[0]))/(365.25*864e5);';
  if(source.split(close).length!==2||source.split(yrs).length!==2)throw Error('VR terminal hook changed');
  source=source.replace(close,close+' if(shares>0)pool+=_vsellQ(shares,lc);')
    .replace(yrs,'mdd=Math.max(mdd,mddPeak>0?1-fin/mddPeak:0); '+yrs);
  (0,eval)(source);
  window.__vrSuite=({ticker,dates,windows,caps,bands})=>{
    const rows=[];
    for(const [s,e] of windows){
      const days=dates.filter(d=>d>=s&&d<=e), first=days[0],last=days.at(-1),t=Date.parse(last);
      const byCap={};
      for(const cap of caps){
        byCap[cap]={};
        for(const band of bands){
          const opts={initAmt:cap,bandPct:band,contrib:100,G:10,mode:.75,formula:'basic',costOn:true,model:'ladder',startV:0,startPool:0};
          const app=runVR(days,ticker,opts), closed=__terminalVR(days,ticker,opts);
          if(closed.shares!==0||closed.invested!==app.invested||closed.trades!==app.trades||
            JSON.stringify(closed.cf)!==JSON.stringify(app.cf))throw Error('VR liquidation changed pre-close flows');
          const cfs=app.cf.map(([d,v])=>[v,(t-Date.parse(d))/(365.25*864e5)]);
          const annual=amount=>{
            if(!(amount>0))return -100;
            let lo=-20,hi=5;
            for(let i=0;i<62;i++){
              const m=(lo+hi)/2;
              if(cfs.reduce((a,[v,dt])=>a+v*Math.exp(m*dt),0)>amount)hi=m;else lo=m;
            }
            return Math.expm1((lo+hi)/2)*100;
          };
          byCap[cap][band]={invested:app.invested,ann:annual(app.final),final:app.final,mdd:app.mdd,
            closedAnn:annual(closed.final),closedFinal:closed.final,closedMdd:closed.mdd,
            trades:app.trades/closed.yrs,fees:closed.fees,tax:closed.tax};
        }
      }
      rows.push({s,e,first,last,byCap});
    }
    return rows;
  };
}
function compare(rows,cap,band){
  const a=rows.map(r=>r.byCap[cap][band]), b=rows.map(r=>r.byCap[cap][15]);
  for(let i=0;i<a.length;i++)if(a[i].invested!==b[i].invested)throw Error('Unmatched VR contributions');
  const diff=k=>a.map((r,i)=>r[k]-b[i][k]);
  const ratios=k=>a.map((r,i)=>r[k]/b[i][k]);
  const median=k=>quant(diff(k)), ann=diff('ann'), closed=diff('closedAnn'), half=Math.floor(rows.length/2);
  const split=xs=>[quant(xs.slice(0,half)),quant(xs.slice(half))];
  const max=(k,rs)=>Math.max(...rs.map(x=>x[k]));
  const worst=closed.indexOf(Math.min(...closed));
  return {n:rows.length,ann:quant(ann),annCI:boot(ann),wins:ann.filter(v=>v>1e-9).length,half:split(ann),
    ratio:quant(ratios('final')),deltaMdd:median('mdd'),deltaMaxMdd:max('mdd',a)-max('mdd',b),
    closedAnn:quant(closed),closedCI:boot(closed),closedHalf:split(closed),closedRatio:quant(ratios('closedFinal')),
    closedDeltaFinal:median('closedFinal'),closedDeltaMdd:median('closedMdd'),
    closedDeltaMaxMdd:max('closedMdd',a)-max('closedMdd',b),worstClosedAnn:closed[worst],worstStart:rows[worst].s,
    oos:quant(closed.filter((_,i)=>rows[i].s<'2000-01-01')),
    deltaTrades:median('trades'),deltaFees:median('fees'),deltaTax:median('tax'),
    baseClosedFinal:quant(b.map(r=>r.closedFinal)),closedFinal:quant(a.map(r=>r.closedFinal)),
    baseMdd:quant(b.map(r=>r.closedMdd)),closedMdd:quant(a.map(r=>r.closedMdd)),
    newTail:a.filter((r,i)=>r.closedMdd>=90&&b[i].closedMdd<90).length,zero:a.filter(r=>r.closedFinal<=.01).length};
}
async function main(){
  await require('./run.cjs').prepareChromium();
  const {open}=require('../im_plan/imh');
  const symbol=process.env.TK||'SOXL',result={symbol,end,scopes:{}};
  for(const [scope,ticker] of [['real',symbol],['syn',synthetic[symbol]]]){
    if(!ticker)continue;
    const {pg,close}=await open([{sym:ticker}]);
    try{
      await pg.evaluate(setup);
      const dates=await pg.evaluate(({t,end})=>dtsOf(t).filter(d=>d<=end),{t:ticker,end});
      const windows=starts(dates[20],dates.at(-1),Math.max(1990,+dates[0].slice(0,4)));
      const rows=await pg.evaluate(o=>window.__vrSuite(o),{ticker,dates,windows,caps,bands});
      const stats=Object.fromEntries(caps.map(cap=>[cap,Object.fromEntries(bands.slice(1).map(b=>[b,compare(rows,cap,b)]))]));
      result.scopes[scope]={ticker,rows,stats};
      fs.writeFileSync(process.argv[2],JSON.stringify(result));
      console.log(symbol,scope,rows.length,JSON.stringify(caps.map(cap=>[stats[cap][20].ann,stats[cap][20].closedAnn])));
    }finally{await close();}
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
