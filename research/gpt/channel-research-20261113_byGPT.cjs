'use strict';
// Preregistered signal-only experiments. Trading, shares, dividends and taxes
// are executed by the complete app page or the native session replay.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan'),END='2026-11-12';
const {starts,pair,dist,quant:q,boot,taxCurve}=require('./operating-20261110.cjs');
const CV={C55_20:[55,20],C50_20:[50,20],C60_20:[60,20],C55_15:[55,15],C55_25:[55,25]};
const rd=(s,sub='data')=>JSON.parse(fs.readFileSync(path.join(D,sub,s+'.json'),'utf8'));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,f))).digest('hex');
const metadata=mode=>({date:'2026-11-13',end:END,mode,variants:CV,files:Object.fromEntries(['backtest.html','plan-session-engine.js','research/im_plan/imh.js','research/im_plan/GPT_DAILY_GUIDE.md'].map(f=>[f,hash(f)]))});
function channel(a,n,x){
 const out=[];let on=false;
 for(let i=0;i<a.length;i++){
  if(i>=Math.max(n,x)){let hi=-Infinity,lo=Infinity;for(let k=i-n;k<i;k++)hi=Math.max(hi,a[k]);for(let k=i-x;k<i;k++)lo=Math.min(lo,a[k]);
   if(a[i]>hi)on=true;else if(a[i]<lo)on=false;
  }out.push(on);
 }return out;
}
function summary(rows,base='base'){
 const b=rows.find(x=>x.v===base),out={[base]:{full:b.full,windows:dist(b.win)}};
 for(const a of rows.filter(x=>x.v!==base))out[a.v]={full:a.full,recent:a.recent,pair:pair(a.win,b.win),fullDelta:{ann:a.full.ann-b.full.ann,mdd:a.full.mdd-b.full.mdd},afterTaxMdd:q(a.win.map((x,i)=>x.afterTaxMdd-b.win[i].afterTaxMdd)),worst:a.win.map((x,i)=>({i,ann:x.ann-b.win[i].ann,mdd:x.mdd-b.win[i].mdd,ratio:x.final/b.win[i].final})).sort((a,b)=>a.ann-b.ann).slice(0,3)};
 return out;
}
function quote(s,sub='planrule/data'){const j=rd(s,sub);return {days:j.ohlcTrade.filter(x=>x.date<=END&&x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};}
function synthetic(t,q){const T=quote(t,'data'),Q=quote(q,'data'),I=rd('IRX').series.filter(x=>x.close>=0).sort((a,b)=>a.date.localeCompare(b.date));let p=100,j=0,r=0;const days=[];
 for(const x of T.days){while(j<I.length&&I[j].date<=x.date)r=I[j++].close;if(days.length)p*=1+Math.max(0,r/100-.0009)/252;days.push({date:x.date,close:p});}return {T,Q,G:{days,div:[]},synthetic:true};}
function scaled(X,s){if(!X.synthetic)return X;return Object.fromEntries(['T','Q','G'].map(k=>{const a=X[k],first=a.days.find(x=>x.date>=s);if(!first)throw Error('missing synthetic start');const f=100/first.close;return [k,{days:a.days.map(x=>({date:x.date,close:x.close*f})),div:[]}];}));}
function sets(){return {
 real:{X:{T:quote('TECL'),Q:quote('TQQQ'),G:quote('SGOV')},first:'2011-04-01',last:END,half:'2016-04-01'},
 syn:{X:synthetic('SYNTECL','SYNTQQQ'),first:'2000-06-01',last:END,half:'2011-01-01'},
 oos:{X:synthetic('SYNTECLN','SYNTQQQ'),first:'1987-01-01',last:'1999-12-31',half:'1991-01-01'}
 };}
function dual(outFile){
 const src=fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8'),native={};vm.runInNewContext(src,native);
 let mod=src;const patch=(a,b)=>{if(mod.split(a).length!==2)throw Error('native shape changed '+a.slice(0,55));mod=mod.replace(a,()=>b);};
 patch("function alphaRules(key){const k=String(key&&key.key||key||'');return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}","function alphaRules(key){const k=String(key&&key.key||key||'');return __CV[k]?Object.assign({},ALPHA_RULES.panic,{key:k,channel:__CV[k]}):(k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base);}");
 patch('const div={TECL:mapDiv(opt.teclDiv),','const __channel=RULES.channel?__channelFn(S.tqqq,RULES.channel[0],RULES.channel[1]):null;const div={TECL:mapDiv(opt.teclDiv),');
 patch("if(pm){guard=pm.guard;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}","if(pm){guard=pm.guard;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}if(__channel&&!(pst&&pst.pf)){guard=__channel[p]?'ON':'OFF';guardFlip=(guard==='ON')!==(pos.TQQQ>0);}");
 const ctx={__CV:CV,__channelFn:channel};vm.runInNewContext(mod,ctx);const E=ctx.JKPlanSessionEngine,N=native.JKPlanSessionEngine,AT=require('../im_plan/planrule/aftertax');
 const vix=rd('VIX').series.filter(x=>x.date<=END),vxn=rd('VXN').series.filter(x=>x.date<=END),configs={lump10:[10000,0],lump100:[100000,0],user25:[25000,210],paper:[69244,69.24]};
 const out={...metadata('dual'),syntheticConvention:'native integer replay; unsplit synthetic start price 100 per window, not actual split-event equivalence',audit:{nativeExact:0,taxMatches:0,maxTaxDiff:0,priorSignals:0},sets:{}};
 function one(X,k,s,e,P,M,audit=false){X=scaled(X,s);const o={horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix,vxn};
  const R=E.replay(o);if(!R.stats||!R.nav.length)throw Error(R.error||'empty replay');
  if(k==='panic'&&audit){if(JSON.stringify(R)!==JSON.stringify(N.replay(o)))throw Error('native replay parity');out.audit.nativeExact++;}
  const at=taxCurve(R),ref=AT.afterTax(R);out.audit.maxTaxDiff=Math.max(out.audit.maxTaxDiff,Math.abs(at.final-ref.final));if(Math.abs(at.final-ref.final)>1e-6)throw Error('tax mismatch');out.audit.taxMatches++;
  for(const ev of R.ledger.events)if(ev.type==='trade'){if(!Number.isInteger(ev.qty)||(ev.signalDate&&ev.signalDate>=ev.date))throw Error('share/prior signal');out.audit.priorSignals++;}
  return {ann:(Math.pow(Math.max(at.final,1e-12)/R.nav.at(-1).inflow,1/R.stats.yrs)-1)*100,final:at.final,mdd:R.stats.mdd,afterTaxMdd:at.mddUnit,tax:at.tax,trades:R.stats.nTrade,zero:at.final<=.01};
 }
 for(const [ds,S]of Object.entries(sets()).filter(([k])=>(process.env.DS||'real,syn,oos').split(',').includes(k))){out.sets[ds]={};
  for(const[name,[P,M]]of Object.entries(configs)){
   const st=starts(S.first,S.last,+S.first.slice(0,4)),rows=[];
   for(const v of ['panic',...Object.keys(CV)]){const full=one(S.X,v,S.first,S.last,P,M,true),recent=S.last>='2025-01-01'?one(S.X,v,'2020-01-01',S.last,P,M):null;
    const win=st.map(([s,e],i)=>one(S.X,v,s,e,P,M,i===0));rows.push({v,full,recent,win});process.stderr.write(`dual ${ds} ${name} ${v} done\n`);}
   out.sets[ds][name]={P,M,starts:st,rows,summary:summary(rows,'panic')};fs.writeFileSync(outFile,JSON.stringify(out));
  }
 }
 console.log(JSON.stringify({mode:'dual',audit:out.audit,summary:Object.fromEntries(Object.entries(out.sets).map(([ds,s])=>[ds,Object.fromEntries(Object.entries(s).map(([name,x])=>[name,Object.fromEntries(Object.entries(x.summary).map(([v,a])=>[v,a.pair||a.windows]))]))]))}));return out;
}
// The app function is evaluated only inside a complete backtest.html page.
function rotationSetup(variants){
 const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('page shape changed '+a.slice(0,70));return s.replace(a,()=>b);};
 window.__NATIVE_MA=runMA200;window.__channelMaps={};window.__signal=null;window.__terminal=false;window.__curve=[];
 window.__makeChannels=(tk)=>{const dts=dtsOf(tk),cl=dts.map(d=>M[tk][d][C]),maps={};
  for(const[v,[n,x]]of Object.entries(variants)){const above={};let on=false;for(let i=0;i<cl.length;i++){
   if(i>=Math.max(n,x)){let hi=-Infinity,lo=Infinity;for(let k=i-n;k<i;k++)hi=Math.max(hi,cl[k]);for(let k=i-x;k<i;k++)lo=Math.min(lo,cl[k]);if(cl[i]>hi)on=true;else if(cl[i]<lo)on=false;}above[dts[i]]=on;
  }maps[v]={above,dts,warmN:Math.max(n,x)+1};}window.__channelMaps=maps;};
 let s=runMA200.toString().replace('function runMA200(','function __CHANNEL_MA(');
 s=patch(s,'const {above,dts,warmN}=_maAbove(tkr,N,SHORT,O.buy,O.sell);','const {above,dts,warmN}=window.__signal||_maAbove(tkr,N,SHORT,O.buy,O.sell);');
 s=patch(s,'const eq=cash+shares*c;','const eq=cash+shares*c;window.__curve.push([d,eq]);');
 const start=s.indexOf('}else if(!want && shares>0){')+'}else if(!want && shares>0){'.length,end=s.indexOf('\n    }',start),body=s.slice(start,end);
 if(!body.includes('lotSell(LOT,shares,c,fee)'))throw Error('native terminal sell body');
 s=patch(s,'  settleToStable(()=>_settle(tradeBar(tkr,days[days.length-1])[C]), ()=>yearPnl);','  if(window.__terminal&&shares>0){const c=tradeBar(tkr,days[days.length-1])[C];'+body+'}\n  settleToStable(()=>_settle(tradeBar(tkr,days[days.length-1])[C]), ()=>yearPnl);');
 (0,eval)(s);
 window.__maOne=({tk,cap,v,s,e,terminal})=>{const days=dtsOf(tk).filter(d=>d>=s&&d<=e),o={buy:'ma',sell:'ma',park:'cash'};window.__curve=[];window.__terminal=terminal;window.__signal=v==='base'?null:window.__channelMaps[v];
  const r=__CHANNEL_MA(days,tk,cap,200,true,o);if(v==='base'&&!terminal){const n=__NATIVE_MA(days,tk,cap,200,true,o);if(JSON.stringify(n)!==JSON.stringify(r))throw Error('native MA parity');}
  if(terminal&&r.endShares>1e-7)throw Error('terminal holdings');const yrs=(Date.parse(days.at(-1))-Date.parse(days[0]))/(365.25*864e5);
  return {ann:(Math.pow(Math.max(r.final,1e-12)/cap,1/yrs)-1)*100,final:r.final,mdd:r.mdd,afterTaxMdd:r.mdd,tax:r.tax,fees:r.fees,trades:r.trades,timeIn:r.timeIn,zero:r.final<=.01||window.__curve.some(x=>x[1]<=.01),native:r,curve:window.__curve};
 };
}
async function rotation(outFile){await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),out={...metadata('rotation'),audit:{nativeExact:0,signalPrefix:0},sets:{}};
 for(const[ds,tk,y0]of [['real','SOXL',2010],['syn','SYNSOXL_S',1995],['tq','TQQQ',2010],['tqsyn','SYNTQQQ_S',1990]].filter(([k])=>(process.env.DS||'real,syn,tq,tqsyn').split(',').includes(k))){
  const {pg,close}=await open([{sym:tk}]);try{await pg.evaluate(rotationSetup,CV);const setup=await pg.evaluate(tk=>{__makeChannels(tk);const all=dtsOf(tk).filter(d=>d<='2026-11-12');return {first:all[260],last:all.at(-1)};},tk),st=starts(setup.first,setup.last,y0),rows=[];
   for(const cap of [10000,100000])for(const v of ['base',...Object.keys(CV)]){
    const r=await pg.evaluate(({tk,cap,v,st,setup})=>{const one=(s,e,terminal=true)=>{const r=__maOne({tk,cap,v,s,e,terminal});delete r.native;delete r.curve;return r;};
     return {nativeFull:one(setup.first,setup.last,false),full:one(setup.first,setup.last),recent:setup.last>='2025-01-01'?one('2020-01-01',setup.last):null,win:st.map(([s,e])=>one(s,e))};},{tk,cap,v,st,setup});
    if(v==='base')out.audit.nativeExact++;rows.push({cap,v,...r});process.stderr.write(`rotation ${ds} ${cap} ${v} done\n`);
   }
   const sm={};for(const cap of[10000,100000])sm[cap]=summary(rows.filter(x=>x.cap===cap));
   // Prefix invariance directly checks that future closes cannot alter signals.
   const audit=await pg.evaluate(tk=>{const map=__channelMaps.C55_20,dts=map.dts,i=Math.floor(dts.length*.6),cl=dts.map(d=>M[tk][d][C]);let on=false;for(let k=0;k<=i;k++){if(k>=55){const h=Math.max(...cl.slice(k-55,k)),l=Math.min(...cl.slice(k-20,k));if(cl[k]>h)on=true;else if(cl[k]<l)on=false;}if(on!==map.above[dts[k]])throw Error('future signal leakage');}return {prefixDays:i+1};},tk);out.audit.signalPrefix+=audit.prefixDays;
   out.sets[ds]={tk,...setup,starts:st,rows,summary:sm};fs.writeFileSync(outFile,JSON.stringify(out));
  }finally{await close();}
 }
 console.log(JSON.stringify({mode:'rotation',audit:out.audit,summary:Object.fromEntries(Object.entries(out.sets).map(([ds,x])=>[ds,Object.fromEntries(Object.entries(x.summary).map(([cap,s])=>[cap,Object.fromEntries(Object.entries(s).map(([v,a])=>[v,a.pair||a.windows]))]))]))}));return out;
}
function imSetup({tk,gateTk}){
 const src=runIMx.toString(),needle='imRowsOf({rows:__H.rows})';if(src.split(needle).length!==2)throw Error('LOC hook shape');(0,eval)(src.replace(needle,'imRowsOf({rows:window.__ROWS_AT(d)})'));
 const ds=dtsOf(gateTk),cl=ds.map(d=>M[gateTk][d][C]),at={},prior={},ma=[];let sum=0,on=false;
 for(let i=0;i<ds.length;i++){sum+=cl[i];if(i>=225)sum-=cl[i-225];ma.push(i>=224?sum/225:null);prior[ds[i]]=on;
  if(ma[i]>0){if(cl[i]>ma[i]*1.01)on=true;else if(cl[i]<ma[i]*.99)on=false;}at[ds[i]]=on;
 }
 window.__GATE_PRIOR=prior;window.__GATE_AT=at;window.__ROWS_AT=()=>3;
 const all=dtsOf(tk).filter(d=>d<='2026-11-12');return {first:all[0],last:all.at(-1),windowFirst:all[20],gateFirst:ds[0],gateLast:ds.at(-1)};
}
async function im(outFile){await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),V={base:3,G0:0,G1:1,G2:2,PL3:3},out={...metadata('im'),variants:V,jitter:[.99,1,1.01],audit:{nativeExact:0},sets:{}};
 for(const[ds,tk,gk,y0]of [['real','SOXL','TQQQ',2010],['syn','SYNSOXL_S','SYNTQQQ_S',1995],['tq','TQQQ','TQQQ',2010],['tqsyn','SYNTQQQ_S','SYNTQQQ_S',1990]].filter(([k])=>(process.env.DS||'real,syn,tq,tqsyn').split(',').includes(k))){
  const {pg,close}=await open([...new Set([tk,gk])].map(sym=>({sym})));try{const setup=await pg.evaluate(imSetup,{tk,gateTk:gk}),st=starts(setup.windowFirst,setup.last,y0),rows=[];
   for(const cap of[10000,100000])for(const[v,weakRows]of Object.entries(V)){
    const r=await pg.evaluate(({tk,cap,v,weakRows,st,setup})=>{window.__ROWS_AT=d=>{if(window.__GATE_PRIOR[d]==null)throw Error('missing previous guard '+d);return window.__GATE_PRIOR[d]?3:weakRows;};const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
     function one(s,e,j){const mul=v==='PL3'?1.003:1,P=cap*j*mul,r=RUN({tkr:tk,cap:P,from:s,to:e,autoTp:true,big:20}),yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5);
      if(v==='base'&&j===1&&s===setup.first){imAutoTp=true;imCostOn=true;imReverse=false;const n=runIM(dtsOf(tk).filter(d=>d>=s&&d<=e),tk,P,20,20,true,20);for(const k of['final','mdd','fees','tax','cycles'])if(Math.abs(n[k]-r[k])>1e-7)throw Error('native IM parity '+k);}
      let pk=P,mdd=0,min=Infinity;for(const[d,eq]of r.eqs){min=Math.min(min,eq);pk=Math.max(pk,eq);mdd=Math.max(mdd,(pk-eq)/pk);}mdd=Math.max(mdd,(pk-r.final)/pk);
      return {ann:(Math.pow(Math.max(r.final,1e-12)/P,1/yrs)-1)*100,final:r.final/(j*mul),mdd:mdd*100,afterTaxMdd:mdd*100,cycles:r.cycles,fees:r.fees,tax:r.tax,zero:r.final<=.01||min<=.01};
     }
     const comb=a=>({ann:avg(a.map(x=>x.ann)),final:avg(a.map(x=>x.final)),mdd:avg(a.map(x=>x.mdd)),afterTaxMdd:avg(a.map(x=>x.afterTaxMdd)),cycles:avg(a.map(x=>x.cycles)),zero:a.some(x=>x.zero)});
     const run=(s,e)=>comb([.99,1,1.01].map(j=>one(s,e,j)));return {full:run(setup.first,setup.last),recent:run('2020-01-01',setup.last),win:st.map(([s,e])=>run(s,e))};},{tk,cap,v,weakRows,st,setup});
    rows.push({cap,v,...r});if(v==='base')out.audit.nativeExact++;process.stderr.write(`im ${ds} ${cap} ${v} done\n`);
   }
   const sm={};for(const cap of[10000,100000]){const rs=rows.filter(x=>x.cap===cap);sm[cap]=summary(rs);const b=rs[0];for(const a of rs.slice(1)){const dm=a.win.map((x,i)=>x.mdd-b.win[i].mdd);sm[cap][a.v].mdd90=q(dm,.9);const ix=st.map(([s],i)=>s<'2005-01-01'?i:-1).filter(i=>i>=0);sm[cap][a.v].oos=ix.length?pair(ix.map(i=>a.win[i]),ix.map(i=>b.win[i])):null;}}
   out.sets[ds]={tk,gateTk:gk,...setup,starts:st,rows,summary:sm};fs.writeFileSync(outFile,JSON.stringify(out));
  }finally{await close();}
 }
 console.log(JSON.stringify({mode:'im',audit:out.audit,summary:Object.fromEntries(Object.entries(out.sets).map(([ds,x])=>[ds,Object.fromEntries(Object.entries(x.summary).map(([cap,s])=>[cap,Object.fromEntries(Object.entries(s).map(([v,a])=>[v,a.pair||a.windows]))]))]))}));return out;
}
module.exports={channel,CV,rotationSetup,imSetup,dual,rotation,im,sets,END};
if(require.main===module){const mode=process.argv[2],f=process.argv[3]||`/tmp/jkq-channel-${mode}-20261113.json`;Promise.resolve().then(()=>mode==='dual'?dual(f):mode==='rotation'?rotation(f):mode==='im'?im(f):Promise.reject(Error('dual|rotation|im'))).catch(e=>{console.error(e.stack||e);process.exitCode=1;});}
