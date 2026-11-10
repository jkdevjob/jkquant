'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const D=path.resolve(__dirname,'../im_plan'),ROOT=path.resolve(__dirname,'../..');
const modernPx=require('../im_plan/px'),modernRules=require('../im_plan/plan_rules');
function oldModule(file,px){const m={exports:{}},src=execFileSync('git',['show','5459d4d:research/im_plan/'+file],{cwd:ROOT,encoding:'utf8'});vm.runInNewContext(src,{module:m,exports:m.exports,require:n=>n==='./px'?px:require(n),__dirname:D,process,console});return m.exports;}
const oldPx=oldModule('px.js'),oldRules=oldModule('plan_rules.js',oldPx),baseline=[];
for(const [ds,t,q]of [['real','TECL','TQQQ'],['syn','SYNTECL','SYNTQQQ']])for(const cap of [10000,100000])for(const sizePrev of [false,true]){
 const P=modernPx.prep([t,q]),cfg={gsb:1e9,fee:.001},o={cap,fee:.001,frac:ds==='syn',sizePrev,from:ds==='syn'?'2000-01-01':'2011-01-01'},a=oldPx.sim(P,{...o,...oldRules.mk(P,t,q,cfg)}),b=modernPx.sim(P,{...o,...modernRules.mk(P,t,q,cfg)});
 baseline.push({ds,cap,sizePrev,exact:JSON.stringify(a.eq)===JSON.stringify(b.eq),max:Math.max(...a.eq.map((x,i)=>Math.abs(x[1]-b.eq[i][1])))});
}
const {independent,VARS,volatility,guard}=require('./panic-independent-20261110.cjs'),{taxCurve}=require('./operating-20261110.cjs'),E=independent();
const q=s=>{const j=JSON.parse(fs.readFileSync(path.join(D,'planrule/data',s+'.json'),'utf8'));return {rows:j.ohlcTrade.map(x=>({date:x.date,close:x.close})),div:j.dividends||[]};},T=q('TECL'),Q=q('TQQQ'),G=q('SGOV');
const params={horizon:5,startDate:'2011-04-01',endDate:'2026-11-09',principal:10000,monthlyAdd:0,tecl:T.rows,tqqq:Q.rows,sgov:G.rows,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div};
const taxOmission={};for(const rules of ['base','main']){const r=E.replay({...params,rules}),tx=taxCurve(r),last=r.last;
 // compare_panic afterTaxPath omits SGOV from held but includes its tax basis.
 const omission=last.sgov*(last.sgovPx||0),k=(tx.final+tx.terminalTax)/last.total;
 const impliedWrongTax=Math.max(0,tx.terminalTax-.22*k*omission),wrongFinal=(tx.final+tx.terminalTax)-impliedWrongTax;
 taxOmission[rules]={correct:tx.final,correctTotalTax:tx.tax,terminalTax:tx.terminalTax,sgovValue:omission,k,impliedWrongTax,impliedWrongFinal:wrongFinal};
}
const full=E.replay({...params,rules:'main'}),trace=full.researchTrace,transitions=[];let prev={};for(const t of trace){const changes={};for(const k of ['gArm','gFast','sArm','sFast'])if(t[k]!==prev[k])changes[k]=t[k];if(Object.keys(changes).length)transitions.push({date:t.date,signalDate:t.signalDate,...changes});prev=t;}
const P=modernPx.prep(['TECL','TQQQ']),sig=modernPx.ind.vol(P.C.TECL,20),slow=modernPx.ind.ma(P.C.TQQQ,225),fast=modernPx.ind.ma(P.C.TQQQ,50),rd=s=>Object.fromEntries(JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'),'utf8')).series.map(x=>[x.date,x.close])),vi=rd('VIX'),vn=rd('VXN'),ownState={normal:null,gArm:false,gFast:false,sArm:false,sFast:false},refState={},target=modernRules.mk(P,'TECL','TQQQ',{gsb:1e9,fee:.001,panic:{...VARS.main,sleeve:'min'}}).target;
let held=false;const targetDifferences=[];for(let k=P.dates.findIndex(d=>d>='2011-01-01')-1;k<P.dates.length-1;k++){const d=P.dates[k];volatility(sig[k],vi[d],vn[d],VARS.main,ownState);const a=guard(P.C.TQQQ[k],slow[k],fast[k],vi[d],held,VARS.main,ownState)==='ON';held=a;const b=target(k,{},refState).TQQQ>0;if(a!==b)targetDifferences.push({signalDate:d,executionDate:P.dates[k+1],own:a,reference:b,priceOverMA50:P.C.TQQQ[k]/fast[k]});}
const lookahead=[];for(const endDate of ['2011-09-19','2020-04-28','2025-05-09']){const vx={...vi,[endDate]:999},nx={...vn,[endDate]:.01},mutant=independent({VIX:vx,VXN:nx}),a=E.replay({...params,rules:'main',endDate}),b=mutant.replay({...params,rules:'main',endDate});lookahead.push({endDate,sameDayVixMutated:true,ledgerExact:JSON.stringify(a.ledger)===JSON.stringify(b.ledger),navExact:JSON.stringify(a.nav)===JSON.stringify(b.nav)});}
const out={baseline,taxOmission,transitions,targetDifferences,lookahead};fs.writeFileSync(process.argv[2]||'/tmp/jkq-r1-audit.json',JSON.stringify(out));console.log(JSON.stringify(out,null,2));
