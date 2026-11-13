'use strict';
// Full native replay and runIVS. Research-only hooks settle personal tax in
// actual cash and insert the existing app tax-check's prior-day order intent.
// No alternative fill simulator, app edits, virtual tax unit burn, or deposits
// invented to fund taxes. Every DG sale/buy calls native targetOrders.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan'),END='2026-11-12';
const TC=require('../../plan-tax-check.js');
const {summary,dualTax}=require('./portfolio-monthly-20261113.cjs');
function loadCashEngine(){
 let src=fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8');
 const rep=(a,b)=>{if(src.split(a).length!==2)throw Error('cash hook '+a);src=src.replace(a,()=>b);};
 rep('  const nav=[];\n\n  for(let i=startIdx;',`  const nav=[];
  const GP=opt.gptTax||null,book={},gains={},paid={},taxLog=[],harvestLog=[];let bi=0;
  const scan=()=>{while(bi<ledger.events.length){const e=ledger.events[bi++];if(e.type!=='trade')continue;const b=book[e.symbol]||(book[e.symbol]={q:0,c:0});
    if(e.side==='buy'){b.q+=e.qty;b.c+=e.qty*e.price+e.fee;}else{if(e.qty>b.q+1e-7)throw Error('tax book oversell');const cost=b.c/b.q*e.qty,y=e.date.slice(0,4);gains[y]=(gains[y]||0)+e.qty*e.price-e.fee-cost;b.q-=e.qty;b.c-=cost;if(b.q<1e-9)b.q=b.c=0;}}};
  const execute=(target,px,date,signalDate)=>{const r=targetOrders(target,pos,px,cash,date,signalDate,ledger,seq);cash=r.cash;nTrade+=r.nTrade;seq=r.seq;scan();};
  const settle=(y,px,date,signalDate)=>{scan();const sy=GP.secondary.years[y];if(!sy)throw Error('missing secondary tax year '+y);
    const expected=Math.max(0,(gains[y]||0)+sy.gain-250e4/1350)*.22,owed=expected-sy.paid-(paid[y]||0);let raised=0;
    if(owed>cash+1e-8){for(const sym of ['SGOV','TECL','TQQQ']){if(cash>=owed-1e-8)break;const p=px[sym];if(!(pos[sym]>0&&p>0))continue;
      let q=Math.min(pos[sym],Math.ceil((owed-cash)/(p*(1-FEE_RATE))));while(q<pos[sym]&&cash+q*p-alphaFee(q,p)<owed-1e-8)q++;
      if(q>0){const before=cash;execute(Object.assign({},pos,{[sym]:pos[sym]-q}),px,date,signalDate);raised+=cash-before;}}}
    if(owed>cash+1e-6)throw Error('personal tax cannot be funded '+date+' '+owed+' '+cash);
    cash-=owed;paid[y]=(paid[y]||0)+owed;
    if(Math.abs(owed)>1e-9){addCash(ledger,date,owed>=0?'tax':'taxRefund',Math.abs(owed),seq++);}
    taxLog.push({date,year:y,gain:gains[y]||0,secondaryGain:sy.gain,secondaryPaid:sy.paid,expected,paid:owed,raised});
    const actual=(paid[y]||0)+sy.paid;if(Math.abs(actual-expected)>1e-6)throw Error('personal tax mismatch');};
  const intent=(date,prev,sp)=>{if(!GP.harvest||!GP.harvestDates.includes(date))return [];
    scan();const sd=GP.secondary.daily[prev];if(!sd)throw Error('missing prior secondary gains');
    const r=__TC.check({ledger,prices:sp,feeFn:alphaFee,fxSeries:[{date:'1900-01-01',close:1350}],year:date.slice(0,4),otherKrw:sd.pnl*1350,dedKrw:250e4,rate:.22,margin:GP.margin});
    return r.ok&&(!GP.onlyMode||GP.onlyMode===r.mode)?r.suggestions.map(x=>Object.assign({signalDate:prev,proposalMode:r.mode},x)):[];};
  for(let i=startIdx;`);
 rep('      let total=pos.TECL*sp.TECL+pos.TQQQ*sp.TQQQ+pos.SGOV*(sp.SGOV||0)+cash;',
     '      const __intent=GP?intent(date,S.dates[p],sp):[];\n      let total=pos.TECL*sp.TECL+pos.TQQQ*sp.TQQQ+pos.SGOV*(sp.SGOV||0)+cash;');
 rep('      lastDecision={date,signalDate:S.dates[p],need,meta,target:{...targetShares}};',`      lastDecision={date,signalDate:S.dates[p],need,meta,target:{...targetShares}};
      if(GP){
        scan();
        for(const h of __intent){const p=ep[h.symbol];let q=Math.min(Math.floor(h.qty),pos[h.symbol]);if(!(p>0))continue;
          while(q>0&&(2*alphaFee(q,p)>cash||cash+q*p-alphaFee(q,p)<q*p*(1+FEE_RATE)+.01))q--;if(!(q>0))continue;
          const before=pos[h.symbol],c0=cash;
          execute(Object.assign({},pos,{[h.symbol]:before-q}),ep,date,h.signalDate);
          execute(Object.assign({},pos,{[h.symbol]:before}),ep,date,h.signalDate);
          if(pos[h.symbol]!==before)throw Error('harvest did not repurchase same shares');
          harvestLog.push({date,signalDate:h.signalDate,symbol:h.symbol,qty:q,fee:c0-cash,proposalMode:h.proposalMode});
        }
        if(i>startIdx&&date.slice(0,4)!==S.dates[p].slice(0,4))settle(S.dates[p].slice(0,4),ep,date,S.dates[p]);
        if(i===S.dates.length-1){execute({TECL:0,TQQQ:0,SGOV:0},ep,date,S.dates[p]);settle(date.slice(0,4),ep,date,S.dates[p]);}
        for(const sym of ['TECL','TQQQ','SGOV'])if(Math.abs((book[sym]?.q||0)-pos[sym])>1e-7)throw Error('book holdings mismatch');
        if(cash<-.000001)throw Error('negative cash');
      }`);
 rep('  if(PN){\n    /* 화면용:',`  if(GP){scan();out.gptTax={gains,paid,taxLog,harvestLog};}
  if(PN){
    /* 화면용:`);
 const ctx={__TC:TC};vm.runInNewContext(src,ctx);return ctx.JKPlanSessionEngine;
}
function setupSecondary(){
 window.__nativeIVS=runIVS;
 let c=costOf.toString();const ck='deduct:COST_DEDUCT,';if(c.split(ck).length!==2)throw Error('cost shape');c=c.replace(ck,'deduct:COST_DEDUCT*(window.__DEDW??1),');(0,eval)('costOf='+c);
 let s=runIVS.toString().replace('function runIVS(','function __observeIVS(');
 const rep=(a,b)=>{if(s.split(a).length!==2)throw Error('IVS tax observation '+a);s=s.replace(a,()=>b);};
 rep('    const _t0=trades;','    const __pnl=yearPnl;const _t0=trades;');
 rep('taxTotal+=owed-due; taxTrades+=trades-_t0;','taxTotal+=owed-due; taxTrades+=trades-_t0;window.__taxRead.push({year:curYear,gain:__pnl,paid:owed-due});');
 rep('const eq=cash+A.sh*c+B.sh*c1;','const eq=cash+A.sh*c+B.sh*c1;window.__dailyRead[d]={eq,pnl:yearPnl};');
 rep('  settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);','  if(window.__closeIVS){if(A.sh>0)_sell(A,lc,A.sh);if(X1&&B.sh>0)_sell(B,lc1,B.sh);}\n  settleToStable(()=>_settle(lc,lc1), ()=>yearPnl);');
 rep('return {invested:cap,final:fin,','window.__endRead={cash,shares:A.sh,yearPnl};return {invested:cap,final:fin,');(0,eval)(s);
 window.__getSecondary=({tkr,cap,w,s,e,close})=>{
  window.__DEDW=w;window.__closeIVS=close;window.__taxRead=[];window.__dailyRead={};const days=dtsOf(tkr).filter(d=>d>=s&&d<=e);
  const r=__observeIVS(days,tkr,cap,.55,40,.15,true,'iv','cash');if(close&&window.__endRead.shares>1e-9)throw Error('secondary close incomplete');
  if(!close){const n=__nativeIVS(days,tkr,cap,.55,40,.15,true,'iv','cash');for(const key of ['final','tax','fees','trades'])if(r[key]!==n[key])throw Error('native IVS parity '+key);}
  const daily=window.__dailyRead;daily[days.at(-1)].eq=r.final;
  const years={};for(const x of window.__taxRead){const a=years[x.year]||(years[x.year]={gain:0,paid:0});a.gain+=x.gain;a.paid+=x.paid;}
  const sum=Object.values(years).reduce((a,x)=>a+x.paid,0);if(Math.abs(sum-r.tax)>1e-7)throw Error('secondary paid mismatch');
  window.__DEDW=1;return {final:r.final,tax:r.tax,fees:r.fees,trades:r.trades,years,daily};
 };
}
const rd=(s,sub='data')=>JSON.parse(fs.readFileSync(path.join(D,sub,s+'.json'),'utf8'));
const ser=s=>rd(s).series.filter(x=>x.date<=END&&x.close>0).map(x=>({date:x.date,close:+x.close}));
const q=s=>{const j=rd(s,'planrule/data');return {p:j.ohlcTrade.filter(x=>x.date<=END&&x.close>0).map(x=>({date:x.date,close:+x.close})),d:j.dividends||[]};};
function source(ds){if(ds==='real'){const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV');return {T:T.p,Q:Q.p,G:G.p,div:[T.d,Q.d,G.d],from:'2011-04-01',half:'2016-04-01',tkr:'USD',file:'USD'};}
 if(ds==='syn')return {T:ser('SYNTECL'),Q:ser('SYNTQQQ'),G:ser('SYNBIL'),div:[[],[],[]],from:'2000-06-01',half:'2011-01-01',rescale:true,tkr:'USD',file:'SYNUSD_S'};
 return {T:ser('SYNTECLN'),Q:ser('SYNTQQQ'),G:ser('SYNBIL_L'),div:[[],[],[]],from:'1990-06-01',until:'1999-12-01',half:'1995-01-01',rescale:true,tkr:'TQQQ',file:'SYNTQQQ_S'};}
function cut(rows,s,e){const k=rows.findIndex(x=>x.date>=s),m=100/rows[k].close;if(k<330)throw Error('warmup');return rows.slice(k-330).filter(x=>x.date<=e).map(x=>({date:x.date,close:x.close*m}));}
function datesForHarvest(T,offset){const dates=T.map(x=>x.date),out=[];for(const y of new Set(dates.map(d=>d.slice(0,4)))){const dl=TC.lastTradeDate(y);if(dates.at(-1)<dl)continue;const a=dates.filter(d=>d.slice(0,4)===y&&d<=dl);if(a.length>offset)out.push(a[a.length-1-offset]);}return out;}
function combineCash(R,S,cap,w){let prev=cap,lastIn=cap*w,u=1,pk=1,md=0;for(const n of R.nav){const s=S.daily[n.date];if(!s)throw Error('secondary date gap');const v=n.total+s.eq,flow=n.inflow-lastIn;if(!(v>0&&prev>0))throw Error('zero portfolio');u*=(v-flow)/prev;pk=Math.max(pk,u);md=Math.max(md,(pk-u)/pk);prev=v;lastIn=n.inflow;}
 const a=R.gptTax,paid=Object.values(a.paid).reduce((s,x)=>s+x,0)+S.tax,expected=Object.entries(S.years).reduce((s,[y,x])=>s+Math.max(0,(a.gains[y]||0)+x.gain-250e4/1350)*.22,0);
 if(Math.abs(paid-expected)>1e-6)throw Error('full tax audit '+(paid-expected));
 if(R.last.tecl||R.last.tqqq||R.last.sgov)throw Error('DG terminal holdings');
 return {final:R.last.total+S.final,inflow:R.last.inflow+cap*(1-w),mdd:md*100,tax:paid,taxError:Math.abs(paid-expected),fees:R.ledger.events.filter(e=>e.type==='trade').reduce((a,e)=>a+e.fee,0)+S.fees,
  trades:R.stats.nTrade+S.trades,harvestCount:a.harvestLog.length,harvestFees:a.harvestLog.reduce((s,x)=>s+x.fee,0),taxSales:a.taxLog.filter(x=>x.raised>0).length,taxLog:a.taxLog,harvestLog:a.harvestLog};
}
async function main(){
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),E=loadCashEngine(),ctx={};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8'),ctx);const N=ctx.JKPlanSessionEngine;
 const out={date:'2026-11-13',end:END,sets:{},audit:{nativeReplay:0,nativeIVS:0,personalTax:0,maxTaxError:0},orientation:{},files:Object.fromEntries(['backtest.html','plan-session-engine.js','plan-tax-check.js','research/im_plan/data/USD.json'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]))};
 const DS=(process.env.DS||'real,syn,oos').split(','),V={base:null,H90:[.9,0],H80:[.8,0],H95:[.95,0],E90:[.9,1]},vix=ser('VIX'),vxn=ser('VXN');
 for(const ds of DS){const S=source(ds),harvestDates=[datesForHarvest(S.T,0),datesForHarvest(S.T,1)],{pg,close}=await open([{sym:S.tkr,file:S.file},{sym:'SOXL'}]);try{
  await pg.evaluate(setupSecondary);out.sets[ds]={};const st=[];for(let y=+S.from.slice(0,4);y<=2021;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s>=S.from&&e<=END&&(!S.until||s<=S.until))st.push([s,e]);}
  const LIMIT=+(process.env.LIMIT||0);if(LIMIT)st.splice(LIMIT);
  for(const [name,cap,monthly]of [['10k',10000,0],['100k',100000,0],['user',30000,210]]){const rows=[],orientation=[];
   for(const [s,e]of st){const w=5/6,opts={horizon:5,rules:'panic',startDate:s,endDate:e,principal:cap*w,monthlyAdd:monthly,tecl:S.rescale?cut(S.T,s,e):S.T,tqqq:S.rescale?cut(S.Q,s,e):S.Q,sgov:S.rescale?cut(S.G,s,e):S.G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix,vxn};
    const R0=E.replay(opts),RN=N.replay(opts);if(JSON.stringify(R0)!==JSON.stringify(RN))throw Error('native replay mismatch');out.audit.nativeReplay++;
    const z=await pg.evaluate(o=>window.__getSecondary(o),{tkr:S.tkr,cap:cap*(1-w),w:1-w,s,e,close:true});
    const z0=await pg.evaluate(o=>window.__getSecondary(o),{tkr:S.tkr,cap:cap*(1-w),w:1-w,s,e,close:false});out.audit.nativeIVS++;
    const old=dualTax(RN,w),v={};
    for(const [key,a]of Object.entries(V)){const o={...opts,gptTax:{secondary:z,harvest:!!a,margin:a?a[0]:.9,harvestDates:harvestDates[a?a[1]:0]}};
     const r=E.replay(o);if(!r.stats)throw Error(r.error);v[key]=combineCash(r,z,cap,w);out.audit.personalTax++;out.audit.maxTaxError=Math.max(out.audit.maxTaxError,v[key].taxError);}
    if(ds==='real'){const w2=2/3,r2=N.replay({...opts,principal:cap*w2}),z2=await pg.evaluate(o=>window.__getSecondary(o),{tkr:S.tkr,cap:cap*(1-w2),w:1-w2,s,e,close:false});const p2=dualTax(r2,w2);orientation.push((old.final+z0.final)/(p2.final+z2.final));}
    rows.push({s,e,yrs:RN.stats.yrs,v,canonical:old.final+z0.final,physicalVsCanonical:v.base.final/(old.final+z0.final)});
    if(rows.length%32===0)process.stderr.write(`${ds} ${name} ${rows.length}/${st.length}\n`);
   }
   out.sets[ds][name]={cap,monthly,rows,summary:Object.fromEntries(Object.keys(V).map(k=>[k,summary(rows,k,S.half)]))};if(ds==='real')out.orientation[name]=orientation;
   fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-taxcash-20261113.json',JSON.stringify(out));console.log(JSON.stringify({ds,name,summary:out.sets[ds][name].summary}));
  }
 }finally{await close();}}
 console.log(JSON.stringify({audit:out.audit}));return out;
}
module.exports={loadCashEngine,setupSecondary,source,combineCash};
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
