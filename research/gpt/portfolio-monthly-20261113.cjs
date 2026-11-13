'use strict';
// Preregistered USD monthly trend sleeve. The complete app page supplies
// runIVS/runMA200, fills, integer shares, dividends, lots, and tax liquidations.
// Only monthly signal inputs, observation, a native terminal sell, and a
// documented cross-account tax difference are injected in memory.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan');
const {quant,boot}=require('./operating-20261110.cjs');
const {afterTax}=require('../im_plan/planrule/aftertax');
const W=5/6,END='2026-11-12',DEDUCT=250e4/1350;
const rd=(s,sub='data')=>JSON.parse(fs.readFileSync(path.join(D,sub,s+'.json'),'utf8'));
const series=s=>rd(s).series.filter(x=>x.date<=END&&x.close>0).map(x=>({date:x.date,close:+x.close}));
const quote=s=>{const j=rd(s,'planrule/data');return {rows:j.ohlcTrade.filter(x=>x.date<=END&&x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tx=x=>Math.max(0,x-DEDUCT)*.22;
function dualTax(R,w){
  const events=R.ledger.events.filter(x=>x.type==='trade'),pos={},curve=[],years={};
  let i=0,realized=0,N=0,lost=0,year='',rg=0,last=null,paid=0;
  const surv=()=>Math.max(0,(N-lost)/N),tax=g=>Math.max(0,g-DEDUCT*w)*.22;
  for(const n of R.nav){
    while(i<events.length&&events[i].date<=n.date){const e=events[i++],p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){p.q+=e.qty;p.c+=e.qty*e.price+e.fee;}
      else{if(e.qty>p.q+1e-7)throw Error('DG oversell');const c=p.c/p.q*e.qty;realized+=e.qty*e.price-e.fee-c;p.q-=e.qty;p.c-=c;if(p.q<1e-9)p.q=p.c=0;}}
    const y=n.date.slice(0,4);if(!last){N=n.total;year=y;last={E:n.total,inflow:n.inflow,realized:0};}
    if(y!==year){const t=tax(rg);years[year]={gain:rg,tax:t};paid+=t;lost+=t/(last.E/N);rg=0;year=y;}
    const flow=n.inflow-last.inflow;if(flow>0&&n.total-flow>0)N+=flow/((n.total-flow)/N);
    const k=surv();rg+=k*(realized-last.realized);
    last={E:n.total,inflow:n.inflow,realized,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0),cost:Object.values(pos).reduce((a,p)=>a+p.c,0)};
    curve.push({date:n.date,total:k*n.total,inflow:n.inflow});
  }
  const gain=rg+surv()*(last.held-last.cost),terminal=tax(gain),final=surv()*last.E-terminal;
  years[year]={gain,tax:terminal,terminal:true};curve.at(-1).total=final;
  const reference=afterTax(R,w);
  if(Math.abs(reference.final-final)>1e-6||Math.abs(reference.tax-paid-terminal)>1e-6)throw Error('DG afterTax parity');
  return {final,tax:paid+terminal,years,curve};
}
function combine(P,S,principal){
  const sm=new Map(S.curve.map(x=>[x.date,x.eq]));let prev=principal,inflow=principal*P.weight,nav=1,pk=1,mdd=0,min=Infinity;
  for(const n of P.curve){if(!sm.has(n.date))throw Error('secondary missing date '+n.date);const val=n.total+sm.get(n.date),flow=n.inflow-inflow;
    if(!(prev>0&&val>0))throw Error('zero aggregate account');nav*=(val-flow)/prev;pk=Math.max(pk,nav);mdd=Math.max(mdd,(pk-nav)/pk);min=Math.min(min,val);prev=val;inflow=n.inflow;}
  return {final:P.final+S.final,mdd:100*mdd,inflow:inflow+principal*(1-P.weight),tax:P.tax+S.tax,fees:S.fees,trades:S.trades,minimum:min,secondary:S.final,years:S.years};
}
function summary(rows,k,half){
  const a=rows.map(x=>x.v[k]),b=rows.map(x=>x.v.base),rat=a.map((x,i)=>x.final/b[i].final),da=a.map((x,i)=>(Math.pow(x.final/x.inflow,1/rows[i].yrs)-Math.pow(b[i].final/b[i].inflow,1/rows[i].yrs))*100),dm=a.map((x,i)=>x.mdd-b[i].mdd);
  const part=f=>{const ix=rows.map((x,i)=>f(x.s)?i:-1).filter(i=>i>=0);return {n:ix.length,ratio:quant(ix.map(i=>rat[i])),ann:quant(ix.map(i=>da[i]))};};
  return {n:a.length,ratio:quant(rat),ratioCI:boot(rat),ratio10:quant(rat,.1),ratio90:quant(rat,.9),annDelta:quant(da),annCI:boot(da),wins:rat.filter(x=>x>1+1e-9).length,
    mdd:quant(a.map(x=>x.mdd)),maxMdd:Math.max(...a.map(x=>x.mdd)),deltaMdd:quant(dm),deltaMaxMdd:Math.max(...a.map(x=>x.mdd))-Math.max(...b.map(x=>x.mdd)),worstPairMdd:Math.max(...dm),
    front:part(s=>s<half),back:part(s=>s>=half),oosEarly:part(s=>s<'2006-01-01'),oosLate:part(s=>s>='2006-01-01'&&s<'2011-01-01'),
    finalMedian:quant(a.map(x=>x.final)),finalMin:Math.min(...a.map(x=>x.final)),annualMedian:quant(a.map((x,i)=>(Math.pow(x.final/x.inflow,1/rows[i].yrs)-1)*100)),
    halfLoss:a.filter(x=>x.final<x.inflow*.5).length,zero:a.filter(x=>x.final<=.01).length,newTail:a.filter((x,i)=>x.mdd>=90&&b[i].mdd<90).length,
    worstRatio:rows[rat.indexOf(Math.min(...rat))].s,bestRatio:rows[rat.indexOf(Math.max(...rat))].s};
}
// A closed month's signal is known only on that month's final observed day;
// runMA200 consumes the previous day's signal at the next day's fill.
function browserSetup(){
  const patch=(src,a,b)=>{if(src.split(a).length!==2)throw Error('page shape changed '+a.slice(0,90));return src.replace(a,()=>b);};
  window.__nativeIVS=runIVS;window.__nativeMA=runMA200;
  let c=costOf.toString();c=patch(c,'deduct:COST_DEDUCT,','deduct:COST_DEDUCT*(window.__DEDW??1),');(0,eval)('costOf='+c);
  window.__buildMonthly=(tkr,n)=>{
    const dts=dtsOf(tkr),levels={},monthEnds=[],signals={};let level=100,prev=null,month='',last=null,on=false,warm=0;
    for(const d of dts){const close=M[tkr][d][C];if(prev!=null)level*=(close+divPerShare(tkr,d))/prev;levels[d]=level;prev=close;
      if(month&&d.slice(0,7)!==month){monthEnds.push(last);if(monthEnds.length>=n){const avg=monthEnds.slice(-n).reduce((a,e)=>a+levels[e],0)/n;
        if(levels[last]>avg)on=true;else if(levels[last]<avg)on=false;}else warm++;
        signals[last]=on;}
      signals[d]=on;month=d.slice(0,7);last=d;
    }
    // The final (possibly incomplete) month is never consumed as a new signal.
    return {above:signals,dts,warmN:0,warmMonths:warm,ends:monthEnds};
  };
  window.__jointTax=(pnl,y)=>{
    const a=window.__taxCtx;
    if(!a.joint)return capGainTax(pnl,a.tkr);
    const dg=a.dual[y];if(!dg)throw Error('missing DG year '+y);
    const st=a.years[y]||(a.years[y]={gain:0,paid:0,dgGain:dg.gain,dgTax:dg.tax});st.gain+=pnl;
    const target=Math.max(0,st.gain+dg.gain-250e4/1350)*.22-dg.tax,due=target-st.paid;st.target=target;return due;
  };
  window.__recordTax=(year,paid)=>{const a=window.__taxCtx;if(a.joint)a.years[year].paid+=paid;};
  window.__taxDebt=()=>Object.values(window.__taxCtx.years).reduce((s,x)=>s+Math.max(0,x.target-x.paid),0);
  let iv=runIVS.toString().replace('function runIVS(','function __gptIVS(');
  iv=patch(iv,'const owed=capGainTax(yearPnl, tkr);','const owed=window.__jointTax(yearPnl,curYear);');
  iv=patch(iv,'taxTotal+=owed-due;','taxTotal+=owed-due;window.__recordTax(curYear,owed-due);');
  iv=patch(iv,'const eq=cash+A.sh*c+B.sh*c1;','const eq=cash+A.sh*c+B.sh*c1;window.__curve.push({date:d,eq:eq-window.__taxDebt()});');
  iv=patch(iv,'  settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);','  if(window.__liquidate){if(A.sh>0)_sell(A,lc,A.sh);if(X1&&B.sh>0)_sell(B,lc1,B.sh);}\n  settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);');
  iv=patch(iv,'return {invested:cap,final:fin,','window.__end={cash,shares:A.sh,price:lc,basis:A.lot.basis,yearPnl};return {invested:cap,final:fin,');
  (0,eval)(iv);
  let ma=runMA200.toString().replace('function runMA200(','function __gptMA(');
  ma=patch(ma,'const {above,dts,warmN}=_maAbove(tkr,N,SHORT,O.buy,O.sell);','const {above,dts,warmN}=window.__monthly||_maAbove(tkr,N,SHORT,O.buy,O.sell);');
  ma=patch(ma,'const owed=capGainTax(yearPnl, tkr);','const owed=window.__jointTax(yearPnl,curYear);');
  ma=patch(ma,'taxTotal+=owed-due;','taxTotal+=owed-due;window.__recordTax(curYear,owed-due);');
  ma=patch(ma,'const eq=cash+shares*c;','const eq=cash+shares*c;window.__curve.push({date:d,eq:eq-window.__taxDebt()});');
  // Reuse the exact native signal-driven sell body for the terminal sell.
  const sellStart=ma.indexOf('}else if(!want && shares>0){')+'}else if(!want && shares>0){'.length;
  const sellEnd=ma.indexOf('\n    }',sellStart),sellBody=ma.slice(sellStart,sellEnd);
  if(!sellBody.includes('lotSell(LOT,shares,c,fee)'))throw Error('native MA sell body');
  ma=patch(ma,'  settleToStable(()=>_settle(tradeBar(tkr,days[days.length-1])[C]), ()=>yearPnl);',
    '  if(window.__liquidate&&shares>0){const c=tradeBar(tkr,days[days.length-1])[C];'+sellBody+'}\n  settleToStable(()=>_settle(tradeBar(tkr,days[days.length-1])[C]), ()=>yearPnl);');
  ma=patch(ma,'return {invested:cap,final:fin,','window.__end={cash,shares,basis:LOT.basis,yearPnl};return {invested:cap,final:fin,');
  (0,eval)(ma);
  window.__secondary=({tkr,cap,s,e,w,kind,joint,dual,liquidate=true})=>{
    window.__DEDW=w;window.__curve=[];window.__liquidate=liquidate;window.__taxCtx={joint,tkr,dual,years:{}};
    const days=dtsOf(tkr).filter(d=>d>=s&&d<=e);window.__monthly=kind.startsWith('F')?window.__monthlyMaps[+kind.slice(1)]:null;
    const r=kind==='ivs'?__gptIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'):__gptMA(days,tkr,cap,200,true,{buy:'ma',sell:'ma',short:50,park:'bill'});
    if(liquidate&&window.__end.shares>1e-8)throw Error('native terminal sale incomplete');
    const debt=window.__taxDebt(),curve=window.__curve;curve.at(-1).eq=r.final-debt;
    if(!joint&&!liquidate){const native=kind==='ivs'?__nativeIVS(days,tkr,cap,.55,40,.15,true,'iv','cash'):__nativeMA(days,tkr,cap,200,true,{buy:'ma',sell:'ma',short:50,park:'bill'});
      if(r.final!==native.final||r.tax!==native.tax||r.fees!==native.fees||r.trades!==native.trades)throw Error('native secondary parity');}
    window.__DEDW=1;
    return {final:r.final-debt,tax:r.tax+debt,paidTax:r.tax,debt,fees:r.fees,trades:r.trades,curve,years:window.__taxCtx.years,end:window.__end};
  };
}
function sources(ds){
  if(ds==='real'){const T=quote('TECL'),Q=quote('TQQQ'),G=quote('SGOV');return {T:T.rows,Q:Q.rows,G:G.rows,div:[T.div,Q.div,G.div],from:'2011-04-01',half:'2016-04-01',tkr:'USD',file:'USD'};}
  if(ds==='syn')return {T:series('SYNTECL'),Q:series('SYNTQQQ'),G:series('SYNBIL'),div:[[],[],[]],from:'2000-06-01',half:'2011-01-01',rescale:true,tkr:'USD',file:'SYNUSD_S'};
  return {T:series('SYNTECLN'),Q:series('SYNTQQQ'),G:series('SYNBIL_L'),div:[[],[],[]],from:'1990-06-01',until:'1999-12-01',half:'1995-01-01',rescale:true,tkr:'TQQQ',file:'SYNTQQQ_S'};
}
function cut(rows,s,e){const k=rows.findIndex(x=>x.date>=s);if(k<330)throw Error('warmup insufficient');const scale=100/rows[k].close;return rows.slice(k-330).filter(x=>x.date<=e).map(x=>({date:x.date,close:x.close*scale}));}
async function main(){
  await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),ctx={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8'),ctx);const E=ctx.JKPlanSessionEngine;
  const out={date:'2026-11-13',end:END,native:true,dualRule:'panic',variants:['base','F10','F9','F11'],taxConvention:'DG native afterTax virtual units; secondary native tax with one-person difference; refund kept in secondary',
    files:Object.fromEntries(['backtest.html','plan-session-engine.js','research/im_plan/planrule/aftertax.js','research/im_plan/data/USD.json','research/im_plan/data/SYNUSD_S.json'].map(p=>[p,hash(path.join(ROOT,p))])),sets:{},orientation:{},audit:{secondaryNative:0,dualTax:0,personTax:0,maxPersonTaxError:0,terminalNative:0}};
  const DS=(process.env.DS||'real,syn,oos').split(',');
  for(const ds of DS){const S=sources(ds),{pg,close}=await open([{sym:'SOXL'},{sym:S.tkr,file:S.file}]);
    try{
      await pg.evaluate(browserSetup);await pg.evaluate(tkr=>{window.__monthlyMaps=Object.fromEntries([9,10,11].map(n=>[n,window.__buildMonthly(tkr,n)]));},S.tkr);
      const st=[];for(let y=+S.from.slice(0,4);y<=2021;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s>=S.from&&e<=END&&(!S.until||s<=S.until))st.push([s,e]);}
      out.sets[ds]={};
      for(const [name,cap,monthly]of [['10k',10000,0],['100k',100000,0],['user',30000,210]]){
        const rows=[],orientation=[];let terminalOmissionMax=0,nettingDelta=[],closedDelta=[];
        for(const [s,e] of st){
          const options={horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*W,monthlyAdd:monthly,
            tecl:S.rescale?cut(S.T,s,e):S.T,tqqq:S.rescale?cut(S.Q,s,e):S.Q,sgov:S.rescale?cut(S.G,s,e):S.G,
            teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix:series('VIX'),vxn:series('VXN')};
          const R=E.replay(options);if(!R.stats)throw Error(R.error);const P={...dualTax(R,W),weight:W};out.audit.dualTax++;
          const run=(kind,joint,liquidate=true,w=W,P0=P)=>pg.evaluate(windowArgs=>window.__secondary(windowArgs),{tkr:S.tkr,cap:cap*(1-w),s,e,w:1-w,kind,joint,dual:P0.years,liquidate});
          const baseS=await run('ivs',true),v={base:combine(P,baseS,cap)};
          for(const kind of ['F10','F9','F11']){const Z=await run(kind,true);v[kind]=combine(P,Z,cap);}
          for(const [kind,x]of Object.entries(v)){
            const expected=Object.values(x.years).reduce((a,t)=>a+tx(t.dgGain+t.gain),0),err=Math.abs(expected-x.tax);out.audit.personTax++;out.audit.maxPersonTaxError=Math.max(out.audit.maxPersonTaxError,err);
            if(err>1e-5)throw Error('one-person tax audit '+ds+' '+name+' '+s+' '+kind+' '+err+' '+JSON.stringify(x.years));
          }
          // Audit native split-deduction and terminal conventions on the same paths.
          const oldS=await run('ivs',false,false),splitS=await run('ivs',false,true);out.audit.secondaryNative++;out.audit.terminalNative++;
          const legacy=combine(P,oldS,cap),split=combine(P,splitS,cap);terminalOmissionMax=Math.max(terminalOmissionMax,oldS.final-splitS.final);
          nettingDelta.push(v.base.final/split.final);closedDelta.push(split.final/legacy.final);
          if(ds==='real'){
            const w=2/3,R2=E.replay({...options,principal:cap*w}),P2={...dualTax(R2,w),weight:w};const Z=await run('ivs',false,false,w,P2);
            orientation.push({s,ratio:legacy.final/(P2.final+Z.final)});
          }
          rows.push({s,e,yrs:R.stats.yrs,v,legacy:{final:legacy.final,mdd:legacy.mdd},split:{final:split.final,mdd:split.mdd},terminalOmission:oldS.final-splitS.final});
          if(rows.length%32===0)process.stderr.write(`${ds} ${name}: ${rows.length}/${st.length}\n`);
        }
        const sum=Object.fromEntries(['base','F10','F9','F11'].map(k=>[k,summary(rows,k,S.half)]));
        out.sets[ds][name]={cap,monthly,rows,summary:sum,audit:{terminalOmissionMax,terminalRatio:quant(closedDelta),nettingRatio:quant(nettingDelta)}};
        if(ds==='real'){out.orientation[name]={n:orientation.length,ratio:quant(orientation.map(x=>x.ratio)),wins:orientation.filter(x=>x.ratio>1).length,front:quant(orientation.filter(x=>x.s<S.half).map(x=>x.ratio)),back:quant(orientation.filter(x=>x.s>=S.half).map(x=>x.ratio))};}
        fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-monthly-20261113.json',JSON.stringify(out));
        console.log(JSON.stringify({ds,name,summary:sum,audit:out.sets[ds][name].audit,orientation:out.orientation[name]}));
      }
    }finally{await close();}
  }
  console.log(JSON.stringify({audit:out.audit,orientation:out.orientation}));return out;
}
module.exports={dualTax,combine,summary,browserSetup,main};
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
