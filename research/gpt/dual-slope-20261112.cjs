'use strict';
// Native replay plus a signal-only sigma hook. No trading/accounting rewrite.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {quant:q,boot,taxCurve,starts,mean}=require('./operating-20261110.cjs');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan'),OUT=process.argv[2]||'/tmp/jkq-20261112-dual.json';
const src=fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8');
const variants={S10K25:{slope:10,k:2.5},S5K25:{slope:5,k:2.5},S15K25:{slope:15,k:2.5},S10K23:{slope:10,k:2.3},S10K27:{slope:10,k:2.7},UK25:{slope:0,k:2.5}};
const ctx={__GPT_RULES:variants},nat={};vm.runInNewContext(src,nat);let mod=src;
const replace=(a,b)=>{if(mod.split(a).length!==2)throw Error('Hook changed '+a.slice(0,60));mod=mod.replace(a,b);};
replace("function alphaRules(key){const k=String(key&&key.key||key||'');return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}","function alphaRules(key){const k=String(key&&key.key||key||'');if(__GPT_RULES[k])return Object.assign({},ALPHA_RULES.panic,{key:k,gpt:__GPT_RULES[k]});if(k==='A3h'||k==='n25')return Object.assign({},ALPHA_RULES.base,{key:k,guardOn:.005,guardOff:k==='A3h'?.03:.025});return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}");
replace('const panicAt=(st,p,posOn,sigma,mv)=>panicStep(st,{rules:RULES,vix:vixA[p],vxn:vxnA[p],tqqqClose:S.tqqq[p],sma:mv,fast:fastMA[p],sigma,posOn});',`const panicAt=(st,p,posOn,sigma,mv)=>{const r=panicStep(st,{rules:RULES,vix:vixA[p],vxn:vxnA[p],tqqqClose:S.tqqq[p],sma:mv,fast:fastMA[p],sigma,posOn});const X=RULES.gpt;if(X&&st.ps&&(!X.slope||(p>=X.slope&&fastMA[p]>fastMA[p-X.slope]))){const iv=vxnA[p]>0?vxnA[p]/100*X.k:(vixA[p]>0?vixA[p]/100*X.k*1.2:null);if(iv!=null)r.sigma=Math.min(sigma,iv);}return r;};`);
// Optional signal trace is research metadata only; it never changes a decision.
mod=mod.replace('if(iv!=null)r.sigma=Math.min(sigma,iv);','if(iv!=null)r.sigma=Math.min(sigma,iv);if(typeof __GPT_TRACE!=="undefined")__GPT_TRACE.push({signalDate:S.dates[p],sigma,original:r.iv,chosen:r.sigma,k:X.k,slope:X.slope});');
vm.runInNewContext(mod,ctx);const E=ctx.JKPlanSessionEngine,N=nat.JKPlanSessionEngine,AT=require('../im_plan/planrule/aftertax');
const rd=(dir,s)=>JSON.parse(fs.readFileSync(path.join(dir,s+'.json'),'utf8'));
const quote=(dir,s)=>{const j=rd(dir,s);return {days:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
const data=path.join(D,'data'),pd=path.join(D,'planrule/data'),vix=rd(data,'VIX').series.filter(x=>x.date<='2026-11-11'),vxn=rd(data,'VXN').series.filter(x=>x.date<='2026-11-11');
function synthetic(tk,qk){const T=quote(data,tk),Q=quote(data,qk),I=rd(data,'IRX').series.filter(x=>x.close>=0).sort((a,b)=>a.date.localeCompare(b.date));let p=100,j=0,r=0;const days=[];for(const x of T.days){while(j<I.length&&I[j].date<=x.date)r=I[j++].close;if(days.length)p*=1+Math.max(0,r/100-.0009)/252;days.push({date:x.date,close:p});}return {T,Q,G:{days,div:[]},synthetic:true};}
const SETS={real:{X:{T:quote(pd,'TECL'),Q:quote(pd,'TQQQ'),G:quote(pd,'SGOV')},first:'2011-04-01',last:'2026-11-11',half:'2016-04-01'},syn:{X:synthetic('SYNTECL','SYNTQQQ'),first:'2000-06-01',last:'2026-11-11',half:'2011-01-01'},oos:{X:synthetic('SYNTECLN','SYNTQQQ'),first:'1990-01-01',last:'2004-12-31',half:'1995-01-01'},oos8799:{X:synthetic('SYNTECLN','SYNTQQQ'),first:'1987-01-01',last:'1999-12-31',half:'1991-01-01'}};
// The native replay has no split-event input. Synthetic unsplit series are
// rescaled to 100 at each account start (integer proxy, not actual split path).
function scale(X,s){if(!X.synthetic)return X;return Object.fromEntries(['T','Q','G'].map(k=>{const a=X[k],first=a.days.find(x=>x.date>=s),factor=100/first.close;return[k,{days:a.days.map(x=>({date:x.date,close:x.close*factor})),div:[]}];}));}
const configs={lump10:[10000,0],lump100:[100000,0],user25:[25000,210],paper:[69244,69.24]};
const out={date:'2026-11-12',variants,engineSha:crypto.createHash('sha256').update(src).digest('hex'),syntheticConvention:'unsplit synthetic, start price 100 per window, native integer replay proxy; not actual split-event equivalence',audit:{nativeExact:0,taxMatches:0,maxTaxDiff:0},sets:{},replication:{}};
function one(X,k,s,e,P,M){X=scale(X,s);const o={horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix,vxn},R=E.replay(o);if(!R.stats||!R.nav.length)throw Error(R.error||'Empty');
 if((k==='base'||k==='panic')&&s==='2011-04-01'&&(e==='2026-11-11'||e==='2016-04-01')){if(JSON.stringify(R)!==JSON.stringify(N.replay(o)))throw Error('Native baseline differs');out.audit.nativeExact++;}
 const at=taxCurve(R),ref=AT.afterTax(R),delta=Math.abs(at.final-ref.final);out.audit.maxTaxDiff=Math.max(out.audit.maxTaxDiff,delta);if(delta>1e-6)throw Error('Tax differs');out.audit.taxMatches++;
 for(const ev of R.ledger.events)if(ev.type==='trade'&&(!Number.isInteger(ev.qty)||(ev.signalDate&&ev.signalDate>=ev.date)))throw Error('Integer/prior signal');
 return {ann:(Math.pow(Math.max(at.final,1e-12)/R.nav.at(-1).inflow,1/R.stats.yrs)-1)*100,final:at.final,mdd:R.stats.mdd,afterTaxMdd:at.mddUnit,tax:at.tax,trades:R.stats.nTrade};}
function dist(r){return {ann:q(r.map(x=>x.ann)),ann10:q(r.map(x=>x.ann),.1),annMin:Math.min(...r.map(x=>x.ann)),mdd:q(r.map(x=>x.mdd)),mddMax:Math.max(...r.map(x=>x.mdd))};}
function pairs(rows,k,b,half){const da=rows.map(x=>x.r[k].ann-x.r[b].ann),dm=rows.map(x=>x.r[k].mdd-x.r[b].mdd),front=rows.filter(x=>x.s<half),back=rows.filter(x=>x.s>=half);return{n:rows.length,ann:q(da),annMean:mean(da),annCI:boot(da),mdd:q(dm),maxMddDiff:Math.max(...rows.map(x=>x.r[k].mdd))-Math.max(...rows.map(x=>x.r[b].mdd)),worstPairMdd:Math.max(...dm),front:q(front.map(x=>x.r[k].ann-x.r[b].ann)),back:q(back.map(x=>x.r[k].ann-x.r[b].ann)),win:da.filter(x=>x>1e-9).length,newTail:rows.filter(x=>x.r[k].mdd>=90&&x.r[b].mdd<90).length,afterTaxMdd:q(rows.map(x=>x.r[k].afterTaxMdd-x.r[b].afterTaxMdd)),distribution:dist(rows.map(x=>x.r[k]))};}
// Revisit the outstanding original request first, exact original cutoff.
if(process.env.SKIP_REPLICATION!=='1')for(const[name,[P,M]]of Object.entries(configs)){const S=SETS.real,keys=['base','A3h','n25'],rows=starts(S.first,'2026-11-10',2011).map(([s,e])=>({s,r:Object.fromEntries(keys.map(k=>[k,one(S.X,k,s,e,P,M)]))}));out.replication[name]={cutoff:'2026-11-10',summary:{A3h:pairs(rows,'A3h','base',S.half),n25:pairs(rows,'n25','base',S.half)}};fs.writeFileSync(OUT,JSON.stringify(out));console.log(JSON.stringify({replication:name,result:out.replication[name]}));}
for(const[ds,S]of Object.entries(SETS).filter(([k])=>(process.env.DS||'real,syn,oos').split(',').includes(k))){out.sets[ds]={};for(const[name,[P,M]]of Object.entries(configs)){
 const keys=ds==='real'?['base','A3h','n25','panic',...Object.keys(variants)]:['panic',...Object.keys(variants)],full=Object.fromEntries(keys.map(k=>[k,one(S.X,k,S.first,S.last,P,M)]));
 const windows=starts(S.first,S.last,+S.first.slice(0,4)).filter(([s])=>ds!=='oos'||s<'2000-01-01'),rows=[];
 for(const[s,e]of windows)rows.push({s,r:Object.fromEntries(keys.map(k=>[k,one(S.X,k,s,e,P,M)]))});
 const summary={panic:dist(rows.map(x=>x.r.panic))};for(const k of Object.keys(variants))summary[k]=pairs(rows,k,'panic',S.half);if(ds==='real'){summary.base=dist(rows.map(x=>x.r.base));for(const k of['A3h','n25'])summary[k]=pairs(rows,k,'base',S.half);}
 out.sets[ds][name]={P,M,full,rows,summary};fs.writeFileSync(OUT,JSON.stringify(out));console.log(JSON.stringify({ds,name,full,summary}));
}}
console.log(JSON.stringify({audit:out.audit}));
if(process.env.DETAIL==='1'){
 out.details={};const S=SETS.real;
 for(const k of['S10K25','S5K25','UK25']){ctx.__GPT_TRACE=[];const R=E.replay({horizon:5,rules:k,startDate:S.first,endDate:S.last,principal:25000,monthlyAdd:210,tecl:S.X.T.days,tqqq:S.X.Q.days,sgov:S.X.G.days,teclDiv:S.X.T.div,tqqqDiv:S.X.Q.div,sgovDiv:S.X.G.div,vix,vxn});if(R.error)throw Error(R.error);
  const counts={};for(const t of ctx.__GPT_TRACE){const y=t.signalDate.slice(0,4);counts[y]=(counts[y]||0)+1;}
  out.details[k]={signalDays:ctx.__GPT_TRACE,byYear:counts,events:R.panic&&R.panic.events};
 }
 fs.writeFileSync(OUT,JSON.stringify(out));console.log(JSON.stringify({detailYears:Object.fromEntries(Object.entries(out.details).map(([k,x])=>[k,x.byYear]))}));
}
