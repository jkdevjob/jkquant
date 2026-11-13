'use strict';
// Independent signal/selector hooks. Native replay remains the trade simulator.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {quant:q,boot,taxCurve}=require('./operating-20261110.cjs');
const root=path.resolve(__dirname,'../..'),D=path.join(root,'research/im_plan'),END='2026-11-13';
const read=(s,sub='data')=>JSON.parse(fs.readFileSync(path.join(D,sub,s+'.json')));
const series=s=>read(s).series.filter(x=>x.close>0&&x.date<=END).sort((a,b)=>a.date.localeCompare(b.date));
const dollar=series('DXYNYB'),vix=series('VIX'),vxn=series('VXN');
const variants={U3:[126,-3,.60,0],U2:[126,-2,.60,0],U4:[126,-4,.60,0],S58:[126,-3,.58,0],S62:[126,-3,.62,0],N63:[63,-3,.60,0],N252:[252,-3,.60,0],L126:[126,-3,.60,126],L252:[126,-3,.60,252]};
const maps={};for(const[k,[n,th,val,lag]]of Object.entries(variants)){maps[k]=dollar.map((x,i)=>i>=n+lag&&100*(dollar[i-lag].close/dollar[i-lag-n].close-1)<=th?val:.55);}
function target(k,d){let a=-1,l=0,h=dollar.length-1;while(l<=h){const m=(l+h)>>1;if(dollar[m].date<=d){a=m;l=m+1;}else h=m-1;}return a<0?.55:maps[k][a];}
const src=fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8'),nat={};vm.runInNewContext(src,nat);let mod=src;
function patch(a,b){if(mod.split(a).length!==2)throw Error('native shape changed '+a);mod=mod.replace(a,()=>b);}
patch("function alphaRules(key){const k=String(key&&key.key||key||'');return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}","function alphaRules(key){const k=String(key&&key.key||key||'');if(__variants[k])return Object.assign({},ALPHA_RULES.panic,{key:k,gptU3:k});return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}");
patch('const s0=D.ivsS0,sigUse=pm?pm.sigma:sigma,','const s0=RULES.gptU3?__target(RULES.gptU3,S.dates[p]):D.ivsS0,sigUse=pm?pm.sigma:sigma,');
const ctx={__variants:variants,__target:target};vm.runInNewContext(mod,ctx);const E=ctx.JKPlanSessionEngine,N=nat.JKPlanSessionEngine,AT=require('../im_plan/planrule/aftertax');
const rows=(s,sub='data')=>{const j=read(s,sub);return {days:(sub==='data'?j.series:j.ohlcTrade).filter(x=>x.close>0&&x.date<=END).map(x=>({date:x.date,close:+x.close})),div:sub==='data'?[]:j.dividends||[]};};
const configs={lump10:[10000,0],lump100:[100000,0],user25:[25000,210],paper:[69244,69.24]};
const sources={real:()=>({T:rows('TECL','planrule/data'),Q:rows('TQQQ','planrule/data'),G:rows('SGOV','planrule/data'),first:'2011-04-01',half:'2016-04-01'}),syn:()=>({T:rows('SYNTECL'),Q:rows('SYNTQQQ'),G:rows('SYNBIL'),first:'2000-06-01',half:'2011-01-01',scaled:true}),oos:()=>({T:rows('SYNTECLN'),Q:rows('SYNTQQQ'),G:rows('SYNBIL_L'),first:'1990-06-01',half:'1995-01-01',scaled:true,until:'1999-12-01'})};
sources.oos87=()=>({...sources.oos(),first:'1987-01-01',half:'1988-07-01',until:'1989-12-01'});
const add=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+n);return d.toISOString().slice(0,10);};
const out={date:'2026-11-14',request:'R-20261114-1',end:END,variants,engine:crypto.createHash('sha256').update(src).digest('hex'),audit:{nativeExact:0,taxMatches:0,maxTaxDiff:0,orders:0},sets:{}};
function input(S,s,e){const o={horizon:5,startDate:s,endDate:e,vix,vxn};for(const[k,sym]of[['T','tecl'],['Q','tqqq'],['G','sgov']]){const a=S[k];if(S.scaled){const first=a.days.find(x=>x.date>=s),i=a.days.indexOf(first);if(!first)throw Error('missing start');o[sym]=a.days.slice(Math.max(0,i-330)).filter(x=>x.date<=e).map(x=>({date:x.date,close:x.close*(100/first.close)}));}else o[sym]=a.days;o[sym+'Div']=a.div;}return o;}
function one(o,k,P,M,audit){const opts={...o,rules:k,principal:P,monthlyAdd:M},R=E.replay(opts);if(!R.stats||!R.nav.length)throw Error(R.error||'empty replay');if(k==='panic'&&audit){if(JSON.stringify(R)!==JSON.stringify(N.replay(opts)))throw Error('native parity');out.audit.nativeExact++;}
const a=taxCurve(R),b=AT.afterTax(R),d=Math.abs(a.final-b.final);out.audit.maxTaxDiff=Math.max(d,out.audit.maxTaxDiff);if(d>1e-6)throw Error('tax mismatch');out.audit.taxMatches++;
for(const e of R.ledger.events)if(e.type==='trade'){if(!Number.isInteger(e.qty)||(e.signalDate&&e.signalDate>=e.date))throw Error('order convention');out.audit.orders++;}
return {ann:(Math.pow(Math.max(a.final,1e-12)/R.nav.at(-1).inflow,1/R.stats.yrs)-1)*100,final:a.final,mdd:R.stats.mdd,afterTaxMdd:a.mddUnit,tax:a.tax,zero:a.final<=.01};}
function pairs(rs,k,half){const da=rs.map(x=>x.r[k].ann-x.r.panic.ann),dm=rs.map(x=>x.r[k].mdd-x.r.panic.mdd);const halfA=rs.filter(x=>x.s<half),halfB=rs.filter(x=>x.s>=half);return {n:rs.length,ann:q(da),ci:boot(da),mdd:q(dm),maxMddDiff:Math.max(...rs.map(x=>x.r[k].mdd))-Math.max(...rs.map(x=>x.r.panic.mdd)),worstPairMdd:Math.max(...dm),front:q(halfA.map(x=>x.r[k].ann-x.r.panic.ann)),back:q(halfB.map(x=>x.r[k].ann-x.r.panic.ann)),win:da.filter(x=>x>1e-9).length,newTail:rs.filter(x=>x.r[k].mdd>=90&&x.r.panic.mdd<90).length,zero:rs.filter(x=>x.r[k].zero).length};}
const keys=['panic',...Object.keys(variants)],file=process.argv[2]||'/tmp/jkq-u3.json';
for(const ds of(process.env.DS||'real,syn,oos').split(',')){const S=sources[ds](),last=S.T.days.at(-1).date;out.sets[ds]={};
for(const name of(process.env.SETS||Object.keys(configs).join(',')).split(',')){const[P,M]=configs[name],rs=[];for(let s=S.first;add(s,60)<=last&&(!S.until||s<=S.until);s=add(s,1)){const e=add(s,60),o=input(S,s,e),r={};for(const k of keys)r[k]=one(o,k,P,M,rs.length===0);rs.push({s,e,r});}
const summary=Object.fromEntries(keys.slice(1).map(k=>[k,pairs(rs,k,S.half)]));out.sets[ds][name]={P,M,last,rows:rs,summary};fs.writeFileSync(file,JSON.stringify(out));console.log(JSON.stringify({ds,name,summary}));}}
console.log(JSON.stringify({audit:out.audit}));
