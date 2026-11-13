'use strict';
// Independent accounting audit, not another trade simulator.
const fs=require('node:fs'),path=require('node:path');
const {loadCashEngine,setupSecondary,source}=require('./portfolio-taxcash-20261113.cjs');
const TC=require('../../plan-tax-check.js'),ROOT=path.resolve(__dirname,'../..');
const ser=s=>JSON.parse(fs.readFileSync(path.join(ROOT,'research/im_plan/data',s+'.json'))).series;
function auditLedger(R,S,monthly){
 const p={TECL:{q:0,avg:0},TQQQ:{q:0,avg:0},SGOV:{q:0,avg:0}},gains={},fees=[],ev=R.ledger.events;
 let cash=R.ledger.base.cash,i=0,maxCash=0,deposits=0,dividends=0,paid=0;
 for(const n of R.nav){
  while(i<ev.length&&ev[i].date<=n.date){const e=ev[i++];
   if(e.type==='cash'){if(e.kind==='tax'){cash-=e.amount;paid+=e.amount;}
    else if(e.kind==='taxRefund'){cash+=e.amount;paid-=e.amount;}
    else if(e.kind==='dep'){cash+=e.amount;deposits+=e.amount;}
    else if(e.kind==='div'){cash+=e.amount;dividends+=e.amount;}
    else throw Error('unknown flow '+e.kind);
   }else if(e.type==='trade'){
    if(e.qty<0||!Number.isInteger(e.qty))throw Error('DG noninteger order');const a=p[e.symbol];
    if(e.side==='buy'){cash-=e.qty*e.price+e.fee;a.avg=(a.avg*a.q+e.qty*e.price+e.fee)/(a.q+e.qty);a.q+=e.qty;}
    else{if(e.qty>a.q)throw Error('independent oversell');cash+=e.qty*e.price-e.fee;const y=e.date.slice(0,4);gains[y]=(gains[y]||0)+(e.price-a.avg)*e.qty-e.fee;a.q-=e.qty;if(!a.q)a.avg=0;}
    fees.push(e.fee);
   }
  }
  maxCash=Math.max(maxCash,Math.abs(cash-n.cash));if(Math.abs(cash-n.cash)>1e-6)throw Error('cash ledger mismatch');
  if(p.TECL.q!==n.tecl||p.TQQQ.q!==n.tqqq||p.SGOV.q!==n.sgov)throw Error('holdings ledger mismatch');
  const nav=cash+n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0);if(Math.abs(nav-n.total)>1e-6)throw Error('independent NAV mismatch');
 }
 const months=new Set(R.nav.map(x=>x.date.slice(0,7))).size-1;if(Math.abs(deposits-months*monthly)>1e-6)throw Error('duplicate deposit');
 if(Math.abs(R.last.inflow-(R.ledger.base.cash+deposits))>1e-6)throw Error('tax counted as investor withdrawal');
 let expected=0,maxTax=0;
 for(const [y,s]of Object.entries(S.years)){const t=Math.max(0,(gains[y]||0)+s.gain-250e4/1350)*.22;expected+=t;const d=Math.abs(t-s.paid-(R.gptTax.paid[y]||0));maxTax=Math.max(maxTax,d);if(d>1e-6)throw Error('independent year tax mismatch');}
 const all=paid+S.tax;if(Math.abs(expected-all)>1e-6)throw Error('independent total tax mismatch');
 for(const h of R.gptTax.harvestLog)if(!(h.signalDate<h.date))throw Error('harvest same-day signal');
 return {navDays:R.nav.length,trades:fees.length,maxCashError:maxCash,maxTaxError:maxTax,deposit:deposits,dividends,paid,totalPersonalTax:all,harvests:R.gptTax.harvestLog.length,taxSales:R.gptTax.taxLog.filter(x=>x.raised>0).length};
}
(async()=>{
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),{pg,close}=await open([{sym:'USD'},{sym:'SOXL'}]),E=loadCashEngine(),S=source('real'),vix=ser('VIX'),vxn=ser('VXN'),out={date:'2026-11-13',cases:[],mutations:[]};
 try{
  await pg.evaluate(setupSecondary);const hd=[];for(let y=2010;y<=2025;y++){const a=S.T.filter(x=>x.date.slice(0,4)===String(y)&&x.date<=TC.lastTradeDate(y));if(a.length)hd.push(a.at(-1).date);}
  for(const start of ['2015-01-01','2017-01-01','2020-01-01']){
   const end=`${+start.slice(0,4)+5}${start.slice(4)}`,z=await pg.evaluate(o=>window.__getSecondary(o),{tkr:'USD',cap:5000,w:1/6,s:start,e:end,close:true});
   for(const harvest of [false,true]){
    const R=E.replay({horizon:5,rules:'panic',startDate:start,endDate:end,principal:25000,monthlyAdd:210,tecl:S.T,tqqq:S.Q,sgov:S.G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix,vxn,gptTax:{secondary:z,harvest,margin:.9,harvestDates:hd}});
    out.cases.push({start,harvest,...auditLedger(R,z,210)});
   }
  }
  const start='2017-01-01',end='2020-01-02',z=await pg.evaluate(o=>window.__getSecondary(o),{tkr:'USD',cap:5000,w:1/6,s:start,e:end,close:true});
  const opts={horizon:5,rules:'panic',startDate:start,endDate:end,principal:25000,monthlyAdd:210,tecl:S.T,tqqq:S.Q,sgov:S.G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix,vxn,gptTax:{secondary:z,harvest:true,margin:.9,harvestDates:hd}},B=E.replay(opts);
  for(const sym of ['tecl','tqqq']){
   const changed=opts[sym].map(x=>x.date===end?{...x,close:x.close*.5}:x),R=E.replay({...opts,[sym]:changed});
   if(JSON.stringify(R.lastDecision.target)!==JSON.stringify(B.lastDecision.target)||R.lastDecision.need!==B.lastDecision.need||R.lastDecision.meta.guard!==B.lastDecision.meta.guard)throw Error('current price changes prior policy intent');
   out.mutations.push({symbol:sym,date:end,ordinaryIntentUnchanged:true});
  }
 }finally{await close();}
 fs.writeFileSync(process.argv[2]||'/tmp/jkq-pf-taxcash-audit-20261113.json',JSON.stringify(out));console.log(JSON.stringify(out));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
