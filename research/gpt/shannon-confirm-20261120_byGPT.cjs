'use strict';
// Preregistered S2-30. Native replay and native IVS fill/settlement observers.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {boot, starts, quant} = require('./operating-20261110.cjs');
const {loadCashEngine,setupSecondary,combineCash} = require('./portfolio-taxcash-20261113.cjs');

const root=path.resolve(__dirname,'../..');
const end='2026-11-18', weight=5/6;
const cases={base:null,'S2-30':[2,.30],'S2-25':[2,.25],'S2-35':[2,.35],'S3-30':[3,.30]};
const scopes={
  real:{names:['TECL','TQQQ','SGOV'],real:true,shannon:'USD',from:'2011-04-01',half:'2016-04-01'},
  syn:{names:['SYNTECL','SYNTQQQ','SYNBIL'],shannon:'SYNUSD_S',from:'2000-06-01',half:'2011-01-01'},
  oos:{names:['SYNTECLN','SYNTQQQ','SYNBIL_L'],shannon:'SYNUSD_S',from:'1994-08-01',half:'1997-03-01',lastStart:'1999-12-01'}
};
const sizes={lump10:[10000,0],lump100:[100000,0],user:[30000,210]};

function setupConfirmation() {
  const original=__observeIVS.toString();
  const anchor="if(eqP>0 && Math.abs(w-A.sh*pc/eqP)>band){";
  const init="let taxTrades=0;";
  if (original.split(anchor).length!==2 || original.split(init).length!==2) throw Error('Native IVS band hook changed');
  const observed=original.replace(init,init+' let priorSide=0, consecutive=0;')
    .replace(anchor,`const gap=eqP>0?w-A.sh*pc/eqP:0;
      let allow=eqP>0&&Math.abs(gap)>band;
      if(window.__gptConfirm&&i>0){
        const [days,emergency]=window.__gptConfirm;
        const side=allow?Math.sign(gap):0;
        consecutive=side?(side===priorSide?consecutive+1:1):0;
        priorSide=side;
        if(allow){
          allow=consecutive>=days||Math.abs(gap)>=emergency;
          if(allow){
            if(consecutive<days)window.__gptCounts.emergency++;
            else window.__gptCounts.confirmed++;
            priorSide=0;consecutive=0;
          }else window.__gptCounts.skipped++;
        }
      }
      if(allow){`);
  (0,eval)(observed);
  window.__gptSecondary=o=>{
    window.__gptConfirm=o.confirm;
    window.__gptCounts={emergency:0,confirmed:0,skipped:0};
    try {
      const result=window.__getSecondary(o);
      return {...result,counts:window.__gptCounts};
    } finally { window.__gptConfirm=null; }
  };
}
function source(name,real=false) {
  const directory=path.join(root,'research/im_plan',real?'planrule/data':'data');
  const j=JSON.parse(fs.readFileSync(path.join(directory,name+'.json')));
  return {bars:(real?j.ohlcTrade:j.series).filter(x=>x.date<=end&&+x.close>0)
    .map(x=>({date:x.date,close:+x.close})), dividends:real?(j.dividends||[]).filter(d=>d.date<=end):[]};
}
function rescale(bars,s,e) {
  const i=bars.findIndex(x=>x.date>=s);
  if(i<0) throw Error('Synthetic start absent');
  const multiplier=100/bars[i].close;
  return bars.slice(Math.max(0,i-330)).filter(x=>x.date<=e).map(x=>({date:x.date,close:x.close*multiplier}));
}
function externalCash(replay,cap,monthly) {
  const cash=[[replay.nav[0].date,cap]];
  let last=cap*weight;
  for (const n of replay.nav) {
    const added=n.inflow-last;
    if (added>1e-8) {
      if (Math.abs(added-monthly)>1e-8) throw Error('Incorrect contribution');
      cash.push([n.date,added]);
    }
    last=n.inflow;
  }
  return cash;
}
function xirr(cash,endDate,final) {
  const endTime=Date.parse(endDate);
  const flows=cash.map(([day,amount])=>[amount,(endTime-Date.parse(day))/(365.25*864e5)]);
  let low=-25,high=5;
  if (final<=flows.at(-1)[0]&&flows.at(-1)[1]===0) return -100;
  for(let i=0;i<70;i++){
    const mid=(low+high)/2;
    if(flows.reduce((a,[v,y])=>a+v*Math.exp(mid*y),0)>final)high=mid;
    else low=mid;
  }
  return Math.expm1((low+high)/2)*100;
}
function summarize(rows,key,half) {
  const b=rows.map(r=>r.values.base), a=rows.map(r=>r.values[key]);
  const delta=(prop)=>a.map((v,i)=>v[prop]-b[i][prop]);
  const ann=delta('irr'),mdd=delta('mdd'),ratios=a.map((v,i)=>v.final/b[i].final);
  const part=first=>rows.map((r,i)=>(r.start<half)===first?ratios[i]:null).filter(v=>v!=null);
  const distribution=k=>quant(a.map(v=>v[k]));
  const worst=ratios.indexOf(Math.min(...ratios)), worstDraw=mdd.indexOf(Math.max(...mdd));
  return {n:a.length,ratio:quant(ratios),ratioCI:boot(ratios),annDelta:quant(ann),annCI:boot(ann),
    wins:ratios.filter(x=>x>1+1e-9).length,front:quant(part(true)),back:quant(part(false)),
    final:distribution('final'),deltaFinal:quant(delta('final')),minFinal:Math.min(...a.map(v=>v.final)),
    irr:distribution('irr'),return:distribution('return'),mdd:distribution('mdd'),deltaMdd:quant(mdd),
    maxMdd:Math.max(...a.map(v=>v.mdd)),deltaMaxMdd:Math.max(...a.map(v=>v.mdd))-Math.max(...b.map(v=>v.mdd)),
    maxPairMdd:mdd[worstDraw],maxPairMddStart:rows[worstDraw].start,worstRatio:ratios[worst],
    worstStart:rows[worst].start,worstBaseline:b[worst],worstCandidate:a[worst],
    deltaFees:quant(delta('fees')),deltaTax:quant(delta('tax')),deltaTrades:quant(delta('trades')),
    skips:quant(a.map(v=>v.gates.skipped)),emergencies:quant(a.map(v=>v.gates.emergency)),
    newTail:a.filter((v,i)=>v.mdd>=90&&b[i].mdd<90).length,zero:a.filter(v=>v.final<=.01).length};
}
async function main() {
  await require('./run.cjs').prepareChromium();
  const {open}=require('../im_plan/imh');
  const instrumented=loadCashEngine();
  const context={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8'),context);
  const original=context.JKPlanSessionEngine;
  if(original.FEE_RATE!==.0025) throw Error('Unexpected default app fee');
  const vix=source('VIX').bars,vxn=source('VXN').bars;
  const result={end,fee:original.FEE_RATE,cases,audit:{originalReplay:0,originalIvs:0,personTax:0,maxTaxError:0},scopes:{}};
  for(const name of (process.env.DS||Object.keys(scopes).join(',')).split(',')){
    const scope=scopes[name], data=scope.names.map(s=>source(s,scope.real));
    const windows=starts(scope.from,data[0].bars.at(-1).date,+scope.from.slice(0,4))
      .filter(([s])=>!scope.lastStart||s<=scope.lastStart);
    const {pg,close}=await open([{sym:'USD',file:scope.shannon}]);
    try {
      await pg.evaluate(setupSecondary);
      await pg.evaluate(setupConfirmation);
      const browserFee=await pg.evaluate(()=>costOf('USD').fee);
      if(browserFee!==original.FEE_RATE) throw Error('App cost split');
      const out=result.scopes[name]={};
      for(const [label,[cap,monthlyAdd]] of Object.entries(sizes)){
        const all=[];
        for(const [start,finish] of windows){
          const options={rules:'panic',horizon:5,principal:cap*weight,monthlyAdd,startDate:start,endDate:finish,vix,vxn};
          ['tecl','tqqq','sgov'].forEach((sym,i)=>{
            options[sym]=scope.real?data[i].bars:rescale(data[i].bars,start,finish);
            options[sym+'Div']=data[i].dividends;
          });
          if(!all.length){
            const ordinary=original.replay(options);
            if(JSON.stringify(ordinary)!==JSON.stringify(instrumented.replay(options)))throw Error('Original replay parity');
            result.audit.originalReplay++;
            await pg.evaluate(o=>window.__gptSecondary(o),{tkr:'USD',cap:cap*(1-weight),w:1-weight,s:start,e:finish,close:false,confirm:null});
            result.audit.originalIvs++;
          }
          const mapped=await pg.evaluate(({cap,w,s,e,variants})=>Object.fromEntries(Object.entries(variants)
            .map(([key,confirm])=>[key,window.__gptSecondary({tkr:'USD',cap,w,s,e,confirm,close:true})])),
            {cap:cap*(1-weight),w:1-weight,s:start,e:finish,variants:cases});
          const values={};
          let firstCash=null, firstShares=null;
          for(const [key,side] of Object.entries(mapped)){
            const replay=instrumented.replay({...options,gptTax:{secondary:side,harvest:false,harvestDates:[]}});
            if(!replay.stats)throw Error(replay.error||'Dual replay missing');
            const facts=combineCash(replay,side,cap,weight), cash=externalCash(replay,cap,monthlyAdd);
            const lastDay=replay.nav.at(-1).date;
            if(firstCash&&JSON.stringify(firstCash)!==JSON.stringify(cash)) throw Error('Unpaired cash flows');
            firstCash=cash;
            const shares=[replay.nav[0].tecl,replay.nav[0].tqqq,replay.nav[0].sgov];
            if(firstShares&&JSON.stringify(firstShares)!==JSON.stringify(shares)) throw Error('Different initial dual fill');
            firstShares=shares;
            if(Math.abs(facts.inflow-cash.reduce((s,x)=>s+x[1],0))>1e-7)throw Error('External cash conservation');
            result.audit.personTax++;
            result.audit.maxTaxError=Math.max(result.audit.maxTaxError,facts.taxError);
            values[key]={final:facts.final,return:100*(facts.final/facts.inflow-1),mdd:facts.mdd,fees:facts.fees,
              tax:facts.tax,trades:facts.trades,irr:xirr(cash,lastDay,facts.final),gates:side.counts};
          }
          all.push({start,finish,values});
        }
        const summary=Object.fromEntries(Object.keys(cases).map(k=>[k,summarize(all,k,scope.half)]));
        out[label]={summary,rows:all};
        fs.writeFileSync(process.argv[2],JSON.stringify(result));
        console.log(name,label,JSON.stringify(Object.fromEntries(Object.entries(summary)
          .map(([k,s])=>[k,[s.ratio,s.annDelta,s.deltaMdd,s.deltaMaxMdd,s.n]]))));
      }
    } finally { await close(); }
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
