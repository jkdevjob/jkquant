#!/usr/bin/env node
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('index.html','utf8');
const a=src.indexOf('function paperAfterTaxAcc('),b=src.indexOf('/* ── 모의 MDD — 최대 낙폭 ──',a);
const c=src.indexOf('function planAfterTax('),d=src.indexOf('function paperStatPlan(',c);
assert(a>0&&b>a&&c>0&&d>c);
const raw=src.slice(a,b),env={costOf:()=>({fee:.0025}),capGainTax:v=>Math.max(0,v)*.22,Math,Number};
vm.createContext(env);vm.runInContext(raw+'\n'+src.slice(c,d),env);
const near=(x,y)=>assert(Math.abs(x-y)<1e-8,String(x)+' not '+String(y));
let n=0;
const p=env.paperAfterTaxAcc('SOXL',{addFee:false}),series=[];
for(const [i,price] of [100,200,130].entries()){
 p.step('2024-01-0'+(i+1),price,100,{realized:0,turnover:0,held:price,cost:100});
 series.push({final:p.mark().final,inflow:100});
 near(p.mark().final,p.done().final);
}
/* 다 판다고 볼 때 매도 수수료(공통 율 0.25%)를 모든 전략에 뗀다(2026-11-19) — 평가 200: 수수료 0.5 · 과세 99.5 · 130: 0.325 · 29.675 */
const F2=200-(100-0.5)*.22-0.5, F3=130-(30-0.325)*.22-0.325;
near(series[1].final,F2);near(series[2].final,F3);
near(env.paperAfterTaxDrawdown(series).pct,(F2-F3)/F2*100);n++;
const q=env.paperAfterTaxAcc('SOXL',{addFee:false});
q.step('2023-12-29',150,100,{realized:50,held:0,cost:0});
near(q.mark().final,139);
q.step('2024-01-03',180,100,{realized:50,held:0,cost:0});
assert(q.mark().final<180);near(q.done().final,q.mark().final);n++;
const m=env.paperAfterTaxMetrics({tr:200},{pct:40},5);
near(m.atCagr,(Math.pow(3,.2)-1)*100);
near(m.atMar,m.atCagr/40);
near(m.growMar,Math.pow(m.atCagr/100,1.5)/.4);
const negative=env.paperAfterTaxMetrics({tr:-20},{pct:30},5);
assert(negative.atCagr<0&&negative.atMar<0&&negative.growMar<0);
assert.equal(env.paperAfterTaxMetrics({tr:20},{pct:0},5).growMar,null);n++;
const trade={type:'trade',date:'2024-01-01',symbol:'TECL',side:'buy',qty:10,price:10,fee:0};
const nav=[100,200,130].map((total,i)=>({
 date:'2024-01-0'+(i+1),total,inflow:100,tecl:10,teclPx:total/10,tqqq:0,sgov:0
}));
const plan=env.planAfterTax({ledger:{events:[trade]},nav});
near(plan.afterTaxMdd.pct,(F2-F3)/F2*100);near(plan.tr,F3-100);n++;
for(const key of ['atcagr','atmdd','atmar','growmar'])
 assert(src.includes("paperSortTable('"+key+"',this)")&&src.includes('data-'+key+'='),key);
const order=['atr','atcagr','atmdd','atmar','growmar','ret'].map(k=>src.indexOf("paperSortTable('"+k+"',this)"));
assert(order.every((v,i)=>v>0&&(i===0||v>order[i-1])));
assert(src.includes('colspan="12" style="color:var(--faint)"'));
assert(src.includes('const PAPER_VIEW_CACHE_VER=10;'));
assert(src.includes('paperAfterTaxMetrics(_at,_at&&_at.afterTaxMdd,z.yrs)'));
assert(src.includes('paperAfterTaxMetrics(mdd&&mdd.afterTax,mdd&&mdd.afterTaxMdd,yrs)'));n++;
const altered=raw.replace('Math.max(0,+p.final)/p.inflow','Math.max(0,+p.inflow)/p.inflow');
assert.notEqual(altered,raw);
const bad={costOf:env.costOf,capGainTax:env.capGainTax,Math,Number};
vm.createContext(bad);vm.runInContext(altered,bad);
assert.notEqual(bad.paperAfterTaxDrawdown(series).pct,env.paperAfterTaxDrawdown(series).pct);
n++;
console.log('AFTERTAX_RISK_TEST_PASS '+n+' cases: taxes, drawdown, CAGR, plan, UI, mutation');
