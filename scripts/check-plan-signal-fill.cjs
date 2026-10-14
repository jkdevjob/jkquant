#!/usr/bin/env node
'use strict';
/* Uses the actual shared plan simulation source unchanged. Red/green numerical lookahead tests.
 * No independent alternative trading engine.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const enginePath=path.join(__dirname,'..','plan-session-engine.js');
const planPath=path.join(__dirname,'..','plan.html');
const indexPath=path.join(__dirname,'..','index.html');
const js=fs.readFileSync(enginePath,'utf8'),pl=fs.readFileSync(planPath,'utf8'),idx=fs.readFileSync(indexPath,'utf8');
const ctx={};vm.runInNewContext(js,ctx);
const E=ctx.JKPlanSessionEngine;
function eq(a,b){assert.equal(JSON.stringify(a),JSON.stringify(b));}
assert.equal(E.VERSION,2);assert.equal(E.ORDER_SIZING_BASIS,'previous-settled-close');
assert.match(pl,/plan-session-engine\.js\?v=2/);assert.match(idx,/plan-session-engine\.js\?v=2/);
// All horizon planned trade sizes are determined only with the previously settled price.
const fixed=s=>{assert(!/\b(?:ep\.TECL|ep\.TQQQ|ep\.SGOV)\b/.test(s));};
for(const part of [...js.matchAll(/if\(need\)\{\s*const (?:tt|tq)=([\s\S]*?)\s*targetShares=\{TECL:[\s\S]*?\};\s*\}/g)])fixed(part[0].replace(/targetOrders[\s\S]*$/,''));
const lines=[],t=new Date('2022-01-03T00:00:00Z');let n=0;
while(lines.length<700){
  if(t.getUTCDay()!==0&&t.getUTCDay()!==6){
    lines.push({date:t.toISOString().slice(0,10),
      TECL:45*Math.pow(1.00075,n)*(1+.035*Math.sin(n/8)),
      TQQQ:60*Math.pow(1.00065,n)*(1+.018*Math.sin(n/13)),
      SGOV:100*Math.pow(1.00012,n)});
    n++;
  }
  t.setUTCDate(t.getUTCDate()+1);
}
const signalIndex=329,execIndex=330,execDate=lines[execIndex].date,signalDate=lines[signalIndex].date;
function quotes(sym,mut={}){
  return lines.map((r,i)=>({date:r.date,close:r[sym]*(i===execIndex?(mut[sym]||1):1)}));
}
function run(y,mut={},end=execDate){
 const data={horizon:y,startDate:execDate,endDate:end,principal:100000,monthlyAdd:0,
  tecl:quotes('TECL',mut),tqqq:quotes('TQQQ',mut),sgov:quotes('SGOV',mut)};
 return E.replay(data);
}
let checks=0;
for(const h of [5,10,15,20]){
  const a=run(h),b=run(h,{TECL:1.23,TQQQ:1.10,SGOV:1.02});
  assert.equal(a.error,'');assert.equal(b.error,'');
  eq(a.lastDecision.target,b.lastDecision.target);
  eq(a.lastDecision.meta,b.lastDecision.meta);
  assert.equal(a.lastDecision.signalDate,signalDate);
  assert.equal(a.lastDecision.date,execDate);
  for(const R of [a,b]){
   const trades=R.ledger.events.filter(v=>v.type==='trade');
   assert(trades.length>0,'should have live orders');
   assert(trades.every(v=>v.signalDate===signalDate&&v.date===execDate&&v.qty>=1),'pre-signal day only');
   assert(R.nav.every(v=>v.cash>=-1e-7),'never permit cash overdraft');
  }
  // Forecast prices affect actual closing fills and cash feasibility, but not planned share target.
  assert.notEqual(a.stats.total,b.stats.total,'closing fill prices must affect P&L');
  checks++;
}
const cashBase=run(5),cashGap=run(5,{TECL:1.50,TQQQ:1.50,SGOV:1.50});
eq(cashBase.lastDecision.target,cashGap.lastDecision.target);
assert(cashGap.nav[0].cash>=0);
const baseBuys=cashBase.ledger.events.filter(v=>v.type==='trade'&&v.side==='buy');
const gapBuys=cashGap.ledger.events.filter(v=>v.type==='trade'&&v.side==='buy');
assert(gapBuys.reduce((n,x)=>n+x.qty,0)<=baseBuys.reduce((n,x)=>n+x.qty,0),'gap-up cannot increase affordable purchases');
assert(gapBuys.every(v=>v.price>0&&v.fee>=0));
checks++;
// Plan 'today' calculations must not recalculate intended quantities from an intraday or future close.
assert.match(pl,/Math\.floor\(signalTotal\*D\.teclWeight\*w\/ts\)/);
assert.match(pl,/Math\.floor\(signalTotal\*D\.guardWeight\/qs\)/);
assert.match(pl,/Math\.floor\(Math\.max\(0,signalTotal-targetTq\*ts-targetQq\*qs\)\/ss\)/);
assert.match(pl,/Math\.floor\(total\*targetW\.TECL\/ts\)/);
assert.match(pl,/Math\.floor\(total\*targetW\.TQQQ\/qs\)/);
assert.match(pl,/Math\.floor\(Math\.max\(0,total-targetTq\*ts-targetQq\*qs\)\/ss\)/);
checks++;
// Verify the regression's detection power: mutate a real formula back to forbidden next-close sizing.
const mutant=js.replace('Math.floor(total*D.teclWeight*w/sp.TECL)','Math.floor(total*D.teclWeight*w/ep.TECL)');
assert.notEqual(mutant,js);
const mutantCtx={};vm.runInNewContext(mutant,mutantCtx);
const bad=mutantCtx.JKPlanSessionEngine;
const opts={
 horizon:5,startDate:execDate,endDate:execDate,principal:100000,monthlyAdd:0,
 tecl:quotes('TECL',{TECL:1.23}),tqqq:quotes('TQQQ',{TQQQ:1.1}),sgov:quotes('SGOV',{SGOV:1.02})
};
const good=E.replay(opts),broken=bad.replay(opts);
assert.notEqual(good.lastDecision.target.TECL,broken.lastDecision.target.TECL,'regression detects future-close divisor');
checks++;
console.log('PLAN FILL LOOKAHEAD: '+checks+' groups PASS · horizons 5/10/15/20 · mutation red-check · cash & settlement correct');
