'use strict';
// R-20261111-2: native replay, rule-selector hook only. Independent tax ledger
// and paired summaries; no copy of the application's trade simulator.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {quant:q,boot,taxCurve}=require('./operating-20261110.cjs');
const root=path.resolve(__dirname,'../..'),D=path.join(root,'research/im_plan');
const src=fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8'),needle="function alphaRules(key){const k=String(key&&key.key||key||'');return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}";
if(src.split(needle).length!==2)throw Error('Native rule selector changed');
const variants={A3h:{guardOn:.005,guardOff:.03},n25:{guardOn:.005,guardOff:.025},n03:{guardOn:.003,guardOff:.03},n07:{guardOn:.007,guardOff:.03},n35:{guardOn:.005,guardOff:.035}};
const c={__GPT_RULES:variants},n={};vm.runInNewContext(src,n);
vm.runInNewContext(src.replace(needle,"function alphaRules(key){const k=String(key&&key.key||key||'');const p=k.startsWith('P'),v=__GPT_RULES[p?k.slice(1):k];if(v)return Object.assign({},p?ALPHA_RULES.panic:ALPHA_RULES.base,v,{key:k,exp:true});return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}"),c);
const E=c.JKPlanSessionEngine,N=n.JKPlanSessionEngine,standard=require('../im_plan/planrule/aftertax');
const rd=(dir,s)=>JSON.parse(fs.readFileSync(path.join(dir,s+'.json'),'utf8'));
const quote=(dir,s)=>{const j=rd(dir,s);return {days:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
const data=path.join(D,'data'),pd=path.join(D,'planrule/data'),vix=rd(data,'VIX').series,vxn=rd(data,'VXN').series;
function synthetic(tk,qk){const T=quote(data,tk),Q=quote(data,qk),I=rd(data,'IRX').series.filter(x=>x.close>=0).sort((a,b)=>a.date.localeCompare(b.date));let p=100,j=0,r=0;const days=[];
 for(const x of T.days){while(j<I.length&&I[j].date<=x.date)r=I[j++].close;if(days.length)p*=1+Math.max(0,r/100-.0009)/252;days.push({date:x.date,close:p});}return {T,Q,G:{days,div:[]}};}
const real={T:quote(pd,'TECL'),Q:quote(pd,'TQQQ'),G:quote(pd,'SGOV')};
const SETS={real:{X:real,from:'2011-04-01',last:real.T.days.at(-1).date,winFrom:'2011-04-01',winTo:'2021-11-01',half:'2016-04-01'},syn:{X:synthetic('SYNTECL_S','SYNTQQQ_S'),from:'2000-01-01',last:'2026-11-10',winFrom:'2000-01-01',winTo:'2021-10-01',half:'2011-01-01'},oos:{X:synthetic('SYNTECLN','SYNTQQQ'),from:'1987-01-01',last:'1999-12-31',winFrom:'1987-01-01',winTo:'1995-01-01',half:'1991-01-01'}};
const configs={lump10:[10000,0],lump100:[100000,0],user25:[25000,210],paper:[69244,69.24]},out={date:'2026-11-11',request:'R-20261111-2',variants,engineSha256:crypto.createHash('sha256').update(src).digest('hex'),sets:{},audit:{nativeExact:0,taxMatches:0,maxTaxDifference:0,integer:true,priorSignals:true}};
const add=(d,m)=>{const t=new Date(d+'T00:00:00Z');t.setUTCMonth(t.getUTCMonth()+m);return t.toISOString().slice(0,10);};
function one(X,key,start,end,P,M){const o={horizon:5,rules:key,startDate:start,endDate:end,principal:P,monthlyAdd:M,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix,vxn};const R=E.replay(o);if(!R.stats||!R.nav.length)throw Error(R.error||'No replay');
 if(key==='base'&&start==='2011-04-01'){const B=N.replay(o);if(JSON.stringify(B)!==JSON.stringify(R))throw Error('Native replay mismatch');out.audit.nativeExact++;}
 const at=taxCurve(R),ref=standard.afterTax(R),delta=Math.abs(at.final-ref.final);out.audit.maxTaxDifference=Math.max(out.audit.maxTaxDifference,delta);if(delta>1e-6)throw Error('Independent tax ledger mismatch');out.audit.taxMatches++;
 for(const e of R.ledger.events)if(e.type==='trade'){if(e.qty!==Math.floor(e.qty))throw Error('Fractional native replay order');if(e.signalDate&&e.signalDate>=e.date)throw Error('Non-prior signal');}
 return {ann:(Math.pow(Math.max(at.final,1e-9)/R.nav.at(-1).inflow,1/R.stats.yrs)-1)*100,final:at.final,mdd:R.stats.mdd,afterTaxMdd:at.mddUnit,tax:at.tax,trades:R.stats.nTrade};}
function dist(rows){return {ann:q(rows.map(x=>x.ann)),worstAnn:Math.min(...rows.map(x=>x.ann)),mdd:q(rows.map(x=>x.mdd)),maxMdd:Math.max(...rows.map(x=>x.mdd))};}
function pairs(rows,key,base,half){const da=rows.map(x=>x.r[key].ann-x.r[base].ann),dm=rows.map(x=>x.r[key].mdd-x.r[base].mdd),front=rows.filter(x=>x.s<half),back=rows.filter(x=>x.s>=half);return {n:rows.length,ann:q(da),annCI:boot(da),mdd:q(dm),maxMddDiff:Math.max(...rows.map(x=>x.r[key].mdd))-Math.max(...rows.map(x=>x.r[base].mdd)),worstPairMdd:Math.max(...dm),front:q(front.map(x=>x.r[key].ann-x.r[base].ann)),back:q(back.map(x=>x.r[key].ann-x.r[base].ann)),win:da.filter(x=>x>1e-9).length,bothBetter:rows.filter(x=>x.r[key].ann>x.r[base].ann+1e-9&&x.r[key].mdd<=x.r[base].mdd+1e-9).length,bothWorse:rows.filter(x=>x.r[key].ann<x.r[base].ann-1e-9&&x.r[key].mdd>x.r[base].mdd-1e-9).length,newTail:rows.filter(x=>x.r[key].mdd>=90&&x.r[base].mdd<90).length,distribution:dist(rows.map(x=>x.r[key]))};}
for(const[ds,S]of Object.entries(SETS)){out.sets[ds]={};const keys=['base',...Object.keys(variants),'panic','PA3h','Pn25'];
 for(const[name,[P,M]]of Object.entries(configs)){if(ds!=='real'&&name==='paper')continue;const full=Object.fromEntries(keys.map(k=>[k,one(S.X,k,S.from,S.last,P,M)])),rows=[];
  for(let s=S.winFrom;s<=S.winTo&&add(s,60)<=S.last;s=add(s,1)){const end=add(s,60);rows.push({s,r:Object.fromEntries(keys.map(k=>[k,one(S.X,k,s,end,P,M)]))});}
  const summary={base:dist(rows.map(x=>x.r.base)),panic:dist(rows.map(x=>x.r.panic))};for(const k of Object.keys(variants))summary[k]=pairs(rows,k,'base',S.half);for(const k of ['PA3h','Pn25'])summary[k]=pairs(rows,k,'panic',S.half);
  out.sets[ds][name]={P,M,full,rows,summary};fs.writeFileSync(process.argv[2]||'/tmp/jkq-20261111-guard.json',JSON.stringify(out));console.log(JSON.stringify({ds,name,full,summary}));
 }
}
console.log(JSON.stringify({audit:out.audit}));
