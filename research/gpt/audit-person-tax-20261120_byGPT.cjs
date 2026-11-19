'use strict';
// Check the current portfolio UI's actual source builder against the shared tax engine.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const TC=require('../../plan-tax-check.js');
const engine={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../plan-session-engine.js'),'utf8'),engine);
const E=engine.JKPlanSessionEngine;
const html=fs.readFileSync(path.join(__dirname,'../../index.html'),'utf8');
const section=(start,end)=>{
  const a=html.indexOf(start), b=html.indexOf(end,a+start.length);
  if(a<0||b<0)throw Error('Portfolio tax source builder changed');
  return html.slice(a,b);
};
const box={pfSessName:r=>r.tab,pfPositions:()=>null};
vm.runInNewContext(section('const PF_TAX_KEEP=', '/* 지금 활성 세션')+
  section('function pfTaxSources(', 'function pfTaxCheck(')+'this.make=pfTaxSources;',box);
const price=1350, fxSeries=[{date:'1900-01-01',close:price}], fee=E.alphaFee;
const buyDate='2026-01-15', sellDate='2026-11-10';
const row=(date,side,symbol,qty,p,appliedFee=fee(qty,p))=>({type:'trade',date,side,symbol,qty,price:p,fee:appliedFee});
const data=[
  {tab:'plan',key:'dg',px:{TECL:650},ledgerRef:{base:{},events:[
    row(buyDate,'buy','TECL',20,500,0),row(sellDate,'sell','TECL',10,750,0)]}},
  {tab:'ivs',key:'sh',price:50,hold:{sym:'USD',qty:5},trades:[
    row(buyDate,'buy','USD',10,100),row(sellDate,'sell','USD',5,80)]},
  {tab:'inf',key:'im',price:15,hold:{sym:'SOXL',qty:5},trades:[
    row(buyDate,'buy','SOXL',10,20),row(sellDate,'sell','SOXL',5,10)]},
  {tab:'ivs',key:'domestic',cur:'krw'}
];
const flow=(rows)=>box.make(rows,TC,TC.fxFn(fxSeries),2026,E);
const evaluate=(rows)=>{
  const {sources}=flow(rows);
  const r=TC.portfolio({sources,fxSeries,year:2026});
  assert.equal(r.ok,true);
  return r;
};
const result=evaluate(data), mapped=flow(data);
assert.equal(mapped.meta.domestic,1);
assert.equal(result.sources.map(s=>s.kind).join(','),'plan,trades,trades');
assert.equal(result.sources.map(s=>s.harvest).join(','),'true,true,false');
assert.equal(result.suggestions.some(s=>s.tab==='inf'),false);
assert.equal(result.ded,2500000);
const expectedPlan=7500-fee(10,750)-(5000+fee(10,500));
const expectedShannon=400-fee(5,80)-(500+fee(5,100));
const expectedIM=50-fee(5,10)-(100+fee(5,20));
const tot=expectedPlan+expectedShannon+expectedIM, expectedTax=(tot*price-2500000)*.22;
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
near(result.sources[0].realized.avgUsd,expectedPlan);
near(result.sources[1].realized.avgUsd,expectedShannon);
near(result.total.avg,tot*price);
near(result.tax.avg,expectedTax);
near(result.tax.fifo,expectedTax);
const broken=evaluate([data[0],{...data[1],hold:{sym:'USD',qty:6}}]);
assert.equal(broken.sources[1].kind,'est');
assert.equal(broken.sources[1].harvest,false);
assert.equal(broken.suggestions.some(s=>s.tab==='ivs'),false);
console.log(JSON.stringify({fee:E.FEE_RATE,once:result.ded,realized:tot,tax:result.tax.avg,
  sources:result.sources.map(s=>({kind:s.kind,harvest:s.harvest,pnl:s.realized.avgUsd})),
  excludedDomestic:mapped.meta.domestic,mismatchedHoldings:broken.sources[1].kind}));
