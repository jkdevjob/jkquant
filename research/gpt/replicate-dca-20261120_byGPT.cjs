'use strict';
// R-20261118-1, then a fixed-budget comparison and a causal reserve rule.
const fs=require('node:fs');
const {boot,quant,starts}=require('./operating-20261110.cjs');
const originalCutoff='2026-11-10', marketCutoff='2026-11-18';
const sets={
  real:{symbol:'USD',file:'USD',from:2007,half:'2014-06-01'},
  syn:{symbol:'USD',file:'SYNUSD_S',from:1995,half:'2008-06-01'},
  oos:{symbol:'TQQQ',file:'SYNTQQQ_S',from:1990,half:'2005-06-01'}
};

function browserCase(){
  const native=_dcaOne.toString();
  const a='const a=dip?amt*MUL:amt;';
  const b='if(i%10===0){ snap.push([d,p>0?sh*p+dcash:null]);';
  if(native.split(a).length!==2||native.split(b).length!==2)throw Error('DCA native hook changed');
  (0,eval)(native.replace('function _dcaOne(','function __observeDca(')
    .replace(a,'const a=window.__dailyBudget?window.__dailyBudget(dip,amt):dip?amt*MUL:amt;')
    .replace(b,'window.__dcaObservation.path.push([sh*p+dcash,inv]); '+b));
  const oldBuy=buyQty;
  buyQty=function(cash,price,fee,integer){
    const q=oldBuy(cash,price,fee,integer);
    if(window.__dcaObservation){
      window.__dcaObservation.cost+=q*price*(1+fee);
      window.__dcaObservation.shares+=q;
    }
    return q;
  };
  function irr(flows,first,last,final){
    const when=Date.parse(last), start=Date.parse(first);
    const years=flows.map(([date])=>(when-Date.parse(date))/(365.25*864e5));
    if(when===start||!(final>0))throw Error('DCA IRR insufficient dates or equity');
    let lo=-20,hi=5;
    for(let i=0;i<62;i++){
      const mid=(lo+hi)/2; let pv=0;
      for(let j=0;j<flows.length;j++)pv+=flows[j][1]*Math.exp(mid*years[j]);
      if(pv>final)hi=mid;else lo=mid;
    }
    return Math.expm1((lo+hi)/2)*100;
  }
  const historicalTax=(final,paid)=>Math.max(0,(final-paid)*1350-250e4)*.22/1350;
  window.__compareDca=({ticker,windows,cutoff})=>{
    const full=dtsOf(ticker).filter(d=>d<=cutoff);
    let parity=0, budgetCheck=0;
    const rows=windows.map(([start,end],rowIndex)=>{
      const days=full.filter(d=>d>=start&&d<=end);
      const [first,last]=[days[0],days.at(-1)];
      const original={}, fixed={};
      for(const mul of [1,1.5,2,3]){
        const r=_dcaOne(ticker,days,10,'daily',true,mul);
        original[mul]={inflow:r.invested,final:r.final,mdd:r.mdd,irr:irr(r.cf,first,last,r.final),
          nDip:r.nDip,afterTax:{}};
        for(const cap of [10000,100000,30000]){
          const scale=cap/r.invested, gross=r.final*scale;
          original[mul].afterTax[cap]=irr(r.cf.map(([d,v])=>[d,v*scale]),first,last,gross-historicalTax(gross,cap));
        }
      }
      for(const capital of [10000,100000,30000]){
        const normal=capital/days.length;
        const flows=days.map(day=>[day,normal]);
        fixed[capital]={};
        for(const [key,mul,portion] of [['base',1,0],['D15',1.5,0],['D2',2,0],['D3',3,0],['reserve',2,1/3]]){
          let reserve=0, spentReserve=0;
          const observed={shares:0,cost:0,path:[]};
          window.__dcaObservation=observed;
          window.__dailyBudget=portion?(down)=>{
            reserve+=normal*portion;
            const usual=normal*(1-portion), extra=down?Math.min(reserve,2*normal-usual):0;
            reserve-=extra;spentReserve+=extra;return usual+extra;
          }:null;
          // D15/D2/D3 normalize the whole historical window's weighted budget ex post.
          const amount=portion?normal:10*capital/original[mul].inflow;
          const r=__observeDca(ticker,days,amount,'daily',true,mul);
          window.__dcaObservation=null;window.__dailyBudget=null;
          if(rowIndex===0&&!portion) {
            if(JSON.stringify(r)!==JSON.stringify(_dcaOne(ticker,days,amount,'daily',true,mul)))throw Error('Native DCA parity');
            parity++;
          }
          if(Math.abs(r.invested+reserve-capital)>1e-6)throw Error('Matched deposit failed');
          budgetCheck++;
          if(Math.abs(observed.shares*srcOf(ticker)[last][C]+r.endCash-r.final)>1e-6)throw Error('DCA holdings mismatch');
          const afterSale=saleNet(r.final-r.endCash,observed.cost,true,ticker)+r.endCash;
          const final=afterSale+reserve;
          let peak=capital,mdd=0;
          observed.path.forEach(([equity,invested],i)=>{
            if(portion&&invested>(i+1)*normal+1e-6)throw Error('Reserve used future funds');
            const value=capital-invested+(i===days.length-1?afterSale:equity);
            peak=Math.max(peak,value);mdd=Math.max(mdd,1-value/peak);
          });
          fixed[capital][key]={final,irr:irr(flows,first,last,final),mdd:mdd*100,nativeMdd:r.mdd,
            invested:r.invested,costBasis:observed.cost,reserve,spentReserve,dividend:r.divCashTotal};
        }
      }
      return {start,end,first,last,original,fixed};
    });
    return {rows,parity,budgetCheck};
  };
}
function stats(rows,difference,half){
  const d=rows.map(difference), min=Math.min(...d), i=d.indexOf(min);
  const qscope=scope=>quant(d.filter((_,i)=>(rows[i].start<half)===scope));
  return {n:d.length,median:quant(d),ci:boot(d),win:d.filter(v=>v>1e-9).length,min,minStart:rows[i].start,
    front:qscope(true),back:qscope(false)};
}
function summarize(rows,study) {
  const original={};
  for(const mul of [1.5,2,3]){
    const x=(r,k)=>r.original[mul][k], b=(r,k)=>r.original[1][k];
    original[mul]={irr:stats(rows,r=>x(r,'irr')-b(r,'irr'),study.half),
      inputs:quant(rows.map(r=>x(r,'inflow')/b(r,'inflow'))),
      afterTax:Object.fromEntries([10000,100000,30000].map(cap=>[cap,stats(rows,r=>x(r,'afterTax')[cap]-b(r,'afterTax')[cap],study.half)])),
      deltaMdd:quant(rows.map(r=>x(r,'mdd')-b(r,'mdd'))),
      deltaMaxMdd:Math.max(...rows.map(r=>x(r,'mdd')))-Math.max(...rows.map(r=>b(r,'mdd')))};
  }
  const fixed={};
  for(const capital of [10000,100000,30000]){
    fixed[capital]={};
    for(const key of ['D15','D2','D3','reserve']){
      const x=(r,k)=>r.fixed[capital][key][k], b=(r,k)=>r.fixed[capital].base[k];
      const dd=rows.map(r=>x(r,'mdd')-b(r,'mdd'));
      fixed[capital][key]={irr:stats(rows,r=>x(r,'irr')-b(r,'irr'),study.half),
        ratio:stats(rows,r=>x(r,'final')/b(r,'final')-1,study.half),
        baseFinal:quant(rows.map(r=>b(r,'final'))),candidateFinal:quant(rows.map(r=>x(r,'final'))),
        deltaFinal:quant(rows.map(r=>x(r,'final')-b(r,'final'))),
        mdd:quant(rows.map(r=>x(r,'mdd'))),deltaMdd:quant(dd),worstPairMdd:Math.max(...dd),
        deltaMaxMdd:Math.max(...rows.map(r=>x(r,'mdd')))-Math.max(...rows.map(r=>b(r,'mdd'))),
        newTail:rows.filter(r=>x(r,'mdd')>=90&&b(r,'mdd')<90).length,reserve:quant(rows.map(r=>x(r,'reserve')))};
    }
  }
  return {original,fixed};
}
async function main(){
  await require('./run.cjs').prepareChromium();
  const {open}=require('../im_plan/imh');
  const cutoff=process.env.LATEST?marketCutoff:originalCutoff;
  const out={cutoff,marketCutoff,sets:{}};
  for(const id of (process.env.DS||Object.keys(sets).join(',')).split(',')){
    const set=sets[id],{pg,close}=await open([{sym:set.symbol,file:set.file}]);
    try{
      await pg.evaluate(browserCase);
      const date=await pg.evaluate(s=>dtsOf(s)[0],set.symbol);
      const windows=starts(date,cutoff,set.from);
      const data=await pg.evaluate(o=>window.__compareDca(o),{ticker:set.symbol,cutoff,windows});
      const summary=summarize(data.rows,set);
      out.sets[id]={...data,summary};
      fs.writeFileSync(process.argv[2],JSON.stringify(out));
      console.log(id,data.rows.length,summary.original[2].irr.median,summary.fixed[30000].D2.irr.median,summary.fixed[30000].reserve.irr.median);
    }finally{await close();}
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
