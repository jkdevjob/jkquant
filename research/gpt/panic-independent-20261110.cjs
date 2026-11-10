'use strict';
// Independent state-machine implementation from GPT_REVIEW_PANIC section 1.
// engine_panic was read earlier, so this is not represented as a blind review.
// No code is copied from its injected strings; only native replay is patched.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {quant,boot,taxCurve}=require('./operating-20261110.cjs'),D=path.resolve(__dirname,'../im_plan');
const quote=s=>JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'),'utf8')).series;
const table=s=>Object.fromEntries(quote(s).filter(x=>x.close>0).map(x=>[x.date,x.close]));
const P={hi:40,lo:35,ma:50,band:.02,k:3,fbK:3.6,sleeve:true};
const VARS={base:null,main:P,G:{...P,lo:30,sleeve:false},GS30:{...P,lo:30},S30:{...P,noGuard:true},ctl25:{...P,noArm:true,lo:25,sleeve:false},ctl30:{...P,noArm:true,lo:30,sleeve:false},hi38:{...P,hi:38},hi42:{...P,hi:42},hi45:{...P,hi:45},lo33:{...P,lo:33},lo37:{...P,lo:37},ma40:{...P,ma:40},ma60:{...P,ma:60},b15:{...P,band:.015},b25:{...P,band:.025},k28:{...P,k:2.8,fbK:3.35},k32:{...P,k:3.2,fbK:3.85}};
function volatility(s,vix,vxn,config,state){
 if(!config?.sleeve)return s;
 if(vix!=null&&vix>=config.hi)state.sArm=true;
 if(state.sArm&&vix!=null&&vix<config.lo){state.sArm=false;state.sFast=true;}
 const implied=vxn!=null?vxn*config.k/100:(vix!=null?vix*config.fbK/100:null);
 if(state.sFast&&implied!=null){if(s<=implied)state.sFast=false;else return Math.min(s,implied);}
 return s;
}
function guard(price,slow,fast,vix,held,config,state){
 if(!config||config.noGuard)return null;
 if(state.normal===null)state.normal=price>slow;
 if(price>slow*1.01)state.normal=true;else if(price<slow*.99)state.normal=false;
 if(vix!=null&&vix>=config.hi)state.gArm=true;
 if(config.noArm)state.gArm=true;
 if(state.normal){state.gFast=false;state.gArm=false;return 'ON';}
 if(!state.gFast){if(state.gArm&&vix!=null&&vix<config.lo&&fast>0&&price>fast*(1+config.band)){state.gFast=true;return 'ON';}return 'OFF';}
 if(price>fast*(1+config.band))return 'ON';if(price<fast*(1-config.band))return 'OFF';return held?'ON':'OFF';
}
function independent(overrides={}){let src=fs.readFileSync(path.join(D,'../../plan-session-engine.js'),'utf8');const rep=(a,b)=>{if(src.split(a).length!==2)throw Error('independent hook '+a);src=src.replace(a,b);};
 rep('const tma225=sma(S.tqqq,225);',`const tma225=sma(S.tqqq,225),_cfg=VARS[opt.rules]||null,_fast=sma(S.tqqq,(_cfg||{}).ma||50),_state={normal:null,gArm:false,gFast:false,sArm:false,sFast:false},_trace=[];let _prevState='';
 const ff=m=>{let last=null;return S.dates.map(d=>{if(m[d]>0)last=m[d];return last;});};const _vix=ff(VIX),_vxn=ff(VXN);`);
 rep('const s0=D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));','const s0=D.ivsS0,_used=volatility(sigma,_vix[p],_vxn[p],_cfg,_state),w=Math.min(1,(s0*s0)/(_used*_used));');
 rep('const {teclHit,guard,guardFlip,tqReb}=dec;',`let {teclHit,guard:guardValue,guardFlip,tqReb}=dec;
 const custom=guard(sp.TQQQ,mv,_fast[p],_vix[p],pos.TQQQ>0,_cfg,_state);if(custom!=null){guardValue=custom;guardFlip=(guardValue==='ON')!==(pos.TQQQ>0);}const guard=guardValue;
 const stateNow=JSON.stringify(_state);if(stateNow!==_prevState){_trace.push({date,signalDate:S.dates[p],..._state,vix:_vix[p],vxn:_vxn[p],sigma,used:_used,guard});_prevState=stateNow;}`);
 // Avoid a shadowed identifier: native replay declares const guard below the
 // injection; call the externally supplied state machine through its own name.
 src=src.replace('const custom=guard(sp.TQQQ,','const custom=guardMachine(sp.TQQQ,');
 rep('return {horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,','return {researchState:_state,researchTrace:_trace,horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,');
 const c={VARS,VIX:overrides.VIX||table('VIX'),VXN:overrides.VXN||table('VXN'),volatility,guardMachine:guard};vm.runInNewContext(src,c);return c.JKPlanSessionEngine;
}
module.exports={volatility,guard,VARS,independent};
if(require.main===module){
const E=independent(),read=s=>{const j=JSON.parse(fs.readFileSync(path.join(D,'planrule/data',s+'.json'),'utf8'));return {days:j.ohlcTrade.map(x=>({date:x.date,close:x.close})),div:j.dividends||[]};},T=read('TECL'),Q=read('TQQQ'),G=read('SGOV');
const Ref=require('../im_plan/planrule/engine_panic').load({main:{...P,sleeve:'min'}});
const out={variants:VARS,sets:{},cross:{},data:{}};
function run(name,s,e,cap,monthly,keep=false){const o={horizon:5,rules:name,startDate:s,endDate:e,principal:cap,monthlyAdd:monthly,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div},r=E.replay(o);if(!r.stats)throw Error(r.error);
 const tx=taxCurve(r);const metrics={ann:(Math.pow(tx.final/r.last.inflow,1/r.stats.yrs)-1)*100,mdd:r.stats.mdd,final:tx.final,tax:tx.tax,annualTax:tx.taxPaid,terminalTax:tx.terminalTax,fees:r.ledger.events.filter(x=>x.type==='trade').reduce((s,x)=>s+x.fee,0)};
 if(keep)return {metrics,raw:r,opt:o};return metrics;
}
const st=[];for(let y=2011;y<=2021;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s>='2011-04-01'&&e<='2026-11-06')st.push([s,e]);}
for(const [label,cap,monthly]of [['10k',10000,0],['100k',100000,0],['user',25000,210],['paper',69244,69.24]]){
 const keys=label==='user'?Object.keys(VARS):['base','main'],rows=st.map(([s,e])=>({s,e,r:Object.fromEntries(keys.map(k=>[k,run(k,s,e,cap,monthly)]))})),summary={};
 for(const key of keys){const b=rows.map(x=>x.r.base),a=rows.map(x=>x.r[key]),d=a.map((x,i)=>x.ann-b[i].ann),dm=a.map((x,i)=>x.mdd-b[i].mdd);const part=f=>{const ix=rows.map((x,i)=>f(x)?i:-1).filter(i=>i>=0),dc=ix.map(i=>d[i]),dd=ix.map(i=>dm[i]);return {n:ix.length,delta:quant(dc),both:dc.filter((x,i)=>x>0&&dd[i]<=0).length,worse:dc.filter((x,i)=>x<0&&dd[i]>0).length};};
  summary[key]={delta:quant(d),ci:boot(d),mdd:quant(dm),deltaMaxMdd:Math.max(...a.map(x=>x.mdd))-Math.max(...b.map(x=>x.mdd)),front:part(x=>x.s<'2016-04-01'),back:part(x=>x.s>='2016-04-01'),no2025:part(x=>!(x.s<='2025-04-08'&&x.e>='2025-04-08')),no2020or2025:part(x=>!((x.s<='2025-04-08'&&x.e>='2025-04-08')||(x.s<='2020-03-16'&&x.e>='2020-03-16'))),both:part(()=>true).both,worse:part(()=>true).worse};}
 const fullBase=run('base','2011-04-01','2026-11-06',cap,monthly,true),full=run('main','2011-04-01','2026-11-06',cap,monthly,true),ref=Ref.replay({...full.opt,rules:'main'});
 const A=full.raw.ledger.events.filter(x=>x.type==='trade'),B=ref.ledger.events.filter(x=>x.type==='trade'),key=x=>[x.date,x.symbol,x.side].join('|'),setA=new Set(A.map(key)),baseTrades=fullBase.raw.ledger.events.filter(x=>x.type==='trade'),setB=new Set(baseTrades.map(key));
 const changed={onlyCandidate:A.filter(x=>!setB.has(key(x))),onlyBase:baseTrades.filter(x=>!setA.has(key(x)))};
 out.cross[label]={maxNavDifference:Math.max(...full.raw.nav.map((x,i)=>Math.abs(x.total-ref.nav[i].total))),ledgerExact:JSON.stringify(full.raw.ledger)===JSON.stringify(ref.ledger),structuralReferenceDifferences:A.map(key).filter((x,i)=>x!==B[i]&&x!==key(B[i]||{})),changed,trace:full.raw.researchTrace,full:full.metrics,base:fullBase.metrics};
 // The pair of raw reference ledgers above is the authoritative exact comparison.
 out.sets[label]={summary,rows};process.stderr.write(`independent ${label} done\n`);
}
out.current=run('main','2011-04-01','2026-11-09',25000,210,true).raw.researchState;
const dates=['2011-08-08','2015-08-24','2018-12-24','2020-03-16','2022-03-07','2024-08-05','2025-04-08'];out.data.sample=dates.map(d=>({date:d,VIX:table('VIX')[d],VXN:table('VXN')[d]}));
for(const s of ['VIX','VXN']){const m=table(s);out.data[s]={first:quote(s)[0],last:quote(s).at(-1),missingOnEquity:T.days.filter(x=>x.date>=quote(s)[0].date&&!m[x.date]).map(x=>x.date),bad:quote(s).filter(x=>!(x.close>0)).map(x=>x.date)};}
fs.writeFileSync(process.argv[2]||'/tmp/jkq-r1-independent.json',JSON.stringify(out));console.log(JSON.stringify({summary:Object.fromEntries(Object.entries(out.sets).map(([k,s])=>[k,s.summary])),cross:Object.fromEntries(Object.entries(out.cross).map(([k,x])=>[k,{ledgerExact:x.ledgerExact,maxNavDifference:x.maxNavDifference,changed:[x.changed.onlyBase.length,x.changed.onlyCandidate.length],full:x.full,base:x.base}])),current:out.current,data:out.data},null,2));
}
