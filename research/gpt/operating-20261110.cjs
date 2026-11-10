'use strict';
// Preregistered in RESEARCH_LOG_GPT.md before execution. Research-only string
// hooks around the complete, unchanged application pages / replay engine.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),D=path.join(ROOT,'research/im_plan');
const rd=s=>JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'),'utf8'));
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const quant=(a,p=.5)=>{const b=[...a].sort((x,y)=>x-y);return b.length?b[Math.floor((b.length-1)*p)]:null;};
function boot(a){let seed=20261110;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},r=[];
  for(let i=0;i<2000;i++){let x=[];while(x.length<a.length){const s=Math.floor(rnd()*a.length);for(let j=0;j<12&&x.length<a.length;j++)x.push(a[(s+j)%a.length]);}r.push(quant(x));}return [quant(r,.05),quant(r,.95)];}
const diff=(a,b,k)=>a.map((x,i)=>x[k]-b[i][k]);
function pair(a,b){const dc=diff(a,b,'ann'),dm=diff(a,b,'mdd'),ratio=a.map((x,i)=>x.final/b[i].final);
 return {n:a.length,ann:quant(dc),annCI:boot(dc),win:dc.filter(x=>x>1e-9).length,ratio:quant(ratio),mdd:quant(dm),maxMddDiff:Math.max(...a.map(x=>x.mdd))-Math.max(...b.map(x=>x.mdd)),
  worstPairMdd:Math.max(...dm),front:quant(dc.slice(0,Math.floor(dc.length/2))),back:quant(dc.slice(Math.floor(dc.length/2))),
  newTail:a.filter((x,i)=>x.mdd>=90&&b[i].mdd<90).length,zero:a.filter(x=>x.zero).length};}
function dist(a){return {n:a.length,ann:quant(a.map(x=>x.ann)),ann10:quant(a.map(x=>x.ann),.1),annMin:Math.min(...a.map(x=>x.ann)),mdd:quant(a.map(x=>x.mdd)),mddMax:Math.max(...a.map(x=>x.mdd)),final:quant(a.map(x=>x.final)),zero:a.filter(x=>x.zero).length};}
function starts(first,last,y0){const a=[];for(let y=y0;y<=+last.slice(0,4)-5;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`;if(s>=first&&e<=last)a.push([s,e]);}return a;}
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function metadata(){return {date:'2026-11-10',end:'2026-11-09',files:Object.fromEntries(['backtest.html','plan-session-engine.js','research/im_plan/imh.js'].map(f=>[f,hash(path.join(ROOT,f))]))};}
async function infinite(){
 await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh');
 const out={...metadata(),mode:'im',jitter:[.99,1,1.01],variants:{base:.25,q8:.125,q6:1/6,q10:.1},sets:{}};
 for(const [ds,tk,y0] of [['real','SOXL',2010],['syn','SYNSOXL_S',1995],['tq','TQQQ',2010],['tqsyn','SYNTQQQ_S',1990]]){
  const {pg,close}=await open([{sym:tk}]);try{
   const setup=await pg.evaluate(tk=>{
    const src=runIMx.toString();window.__Q=.25;
    const replace=(s,a,b)=>{if(s.split(a).length!==2)throw Error('quarter hook '+a);return s.replace(a,b);};
    let s=replace(src,'const q1=isq(orig/4,orig);','const q1=isq(orig*window.__Q,orig);');
    s=replace(s,'if(tpHit){ T*=0.25;','if(tpHit){ T*=window.__Q;');
    s=replace(s,'if(qtHit) T*=0.75;','if(qtHit) T*=(1-window.__Q);');
    (0,eval)(s);
    const all=Object.keys(M[tk]).sort();
    return {first:all[0],last:all.at(-1),windowFirst:all[20]};
   },tk);
   const st=starts(setup.windowFirst,setup.last,y0),rows=[];
   for(const cap of [10000,100000])for(const [v,f] of Object.entries(out.variants)){
    const r=await pg.evaluate(({tk,cap,v,f,st})=>{
     window.__Q=f;const avg=x=>x.reduce((s,z)=>s+z,0)/x.length;
     const single=(from,to,j)=>{
      const r=RUN({tkr:tk,cap:cap*j,from,to,autoTp:true,big:20}),yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5);
      let pk=cap*j,mdd=0,pd=r.first,mP='',mT='',min=Infinity;
      for(const [d,e] of r.eqs){min=Math.min(min,e);if(e>pk){pk=e;pd=d;}else if((pk-e)/pk>mdd){mdd=(pk-e)/pk;mP=pd;mT=d;}}
      if(r.final<pk&&(pk-r.final)/pk>mdd){mdd=(pk-r.final)/pk;mP=pd;mT=r.last;}
      if(f===.25&&j===1&&from===undefined){imAutoTp=true;imCostOn=true;imReverse=false;const n=runIM(Object.keys(M[tk]).sort(),tk,cap,20,20,true,20);if(Math.abs(n.final-r.final)>1e-7||n.cycles!==r.cycles)throw Error('native runIM baseline mismatch');}
      return {ann:(Math.pow(Math.max(0,r.final)/(cap*j),1/yrs)-1)*100,mdd:mdd*100,final:r.final/j,cycles:r.cycles,mP,mT,zero:r.final<=.01||min<=.01};
     };
     const combine=rs=>({ann:avg(rs.map(x=>x.ann)),mdd:avg(rs.map(x=>x.mdd)),final:avg(rs.map(x=>x.final)),cycles:avg(rs.map(x=>x.cycles)),zero:rs.some(x=>x.zero)});
     const full=[.99,1,1.01].map(j=>single(undefined,undefined,j));
     const win=st.map(([s,e])=>combine([.99,1,1.01].map(j=>single(s,e,j))));
     return {cap,v,full:combine(full),fullPaths:full,win};
    },{tk,cap,v,f,st});rows.push(r);process.stderr.write(`${ds} ${cap} ${v} done\n`);
   }
   out.sets[ds]={tk,...setup,starts:st,rows,summary:{}};
   for(const cap of [10000,100000]){const b=rows.find(x=>x.cap===cap&&x.v==='base');out.sets[ds].summary[cap]={base:{full:b.full,windows:dist(b.win)}};
    for(const v of Object.keys(out.variants).filter(x=>x!=='base')){const a=rows.find(x=>x.cap===cap&&x.v===v);out.sets[ds].summary[cap][v]={full:a.full,fullDelta:{ann:a.full.ann-b.full.ann,mdd:a.full.mdd-b.full.mdd},pair:pair(a.win,b.win),paths:a.fullPaths};
     if(ds==='syn'||ds==='tqsyn'){const n=st.filter(([s])=>s<'2005').length;out.sets[ds].summary[cap][v].oos=pair(a.win.slice(0,n),b.win.slice(0,n));}}
   }
  }finally{await close();}
 }
 return out;
}
function irr(cf,final,last){const t0=Date.parse(cf[0][0]),end=(Date.parse(last)-t0)/(365.25*864e5),flows=cf.map(([d,a])=>[(Date.parse(d)-t0)/(365.25*864e5),a]);
 const val=r=>flows.reduce((s,[t,a])=>s+a*Math.exp((end-t)*r),0)-final;
 let lo=-100,hi=100;for(let i=0;i<180;i++){const m=(lo+hi)/2;if(val(m)>0)hi=m;else lo=m;}return (Math.exp((lo+hi)/2)-1)*100;}
async function asap(){await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh'),out={...metadata(),mode:'asap',sets:{}};
 for(const [ds,tk,y0] of [['real','SOXL',2010],['syn','SYNSOXL_S',1995]]){const {pg,close}=await open([{sym:tk}]);try{
  const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),tk),st=starts(all[0],all.at(-1),y0),rows=[];
  for(const cap of [0,10000,100000]){const r=await pg.evaluate(({tk,cap,st})=>{
   function one(s,e){const days=Object.keys(M[tk]).sort().filter(d=>(!s||d>=s)&&(!e||d<=e)),o={base:10,mid:50,deep:100,costOn:true};if(cap)o.startCash=cap;
    const r=runASAP(days,tk,o),yrs=(Date.parse(days.at(-1))-Date.parse(days[0]))/(365.25*864e5);
    return {final:r.final,invested:r.invested,ret:r.ret,mdd:r.mdd,ann:cap?(Math.pow(r.final/cap,1/yrs)-1)*100:null,cf:r.cf,trades:r.trades,endShares:r.endShares,endReserve:r.endReserve,last:days.at(-1),zero:r.final<=.01};}
   return {full:one(),win:st.map(([s,e])=>one(s,e))};},{tk,cap,st});
   for(const x of [r.full,...r.win]){x.irr=irr(x.cf,x.final,x.last);if(!cap)x.ann=x.irr;delete x.cf;}
   rows.push({cap,label:cap?'official startCash lump mode; daily amounts unchanged':'application default accumulation; no initial principal',...r,summary:dist(r.win)});process.stderr.write(`${ds} ASAP ${cap} done\n`);}
  out.sets[ds]={tk,first:all[0],last:all.at(-1),starts:st,rows};
 }finally{await close();}}return out;}
// The same marked-to-market tax convention as hist_at/var_eval: one personal
// deduction, annual realized gains, terminal unrealized gains, virtual unit burn.
// Additional daily after-tax unit NAV is reported separately from replay MDD.
function taxCurve(R,dedW=1,withCurve=false){const curve=[],pos={},ev=R.ledger.events.filter(x=>x.type==='trade'),tx=g=>Math.max(0,g-250e4/1350*dedW)*.22;
 let N=0,lost=0,year='',rg=0,last=null,i=0,realized=0,paid=0,pk=1,mdd=0;
 for(const n of R.nav){while(i<ev.length&&ev[i].date<=n.date){const e=ev[i++],p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});if(e.side==='buy'){p.q+=e.qty;p.c+=e.qty*e.price+e.fee;}else{if(e.qty>p.q+1e-7)throw Error('oversell');const c=p.c/p.q*e.qty;realized+=e.qty*e.price-e.fee-c;p.q-=e.qty;p.c-=c;if(p.q<1e-9)p.q=p.c=0;}}
  if(!(n.total>0)||!(n.inflow>0))throw Error('zero account');const y=n.date.slice(0,4);
  if(!last){N=n.total;year=y;last={E:n.total,inflow:n.inflow,realized:0,held:0,cost:0};}
  if(y!==year){const tax=tx(rg);paid+=tax;lost+=tax/(last.E/N);rg=0;year=y;}
  const inflow=n.inflow-last.inflow;if(inflow>0&&n.total-inflow>0)N+=inflow/((n.total-inflow)/N);
  const k=Math.max(0,(N-lost)/N);rg+=k*(realized-last.realized);
  last={E:n.total,inflow:n.inflow,realized,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0),cost:Object.values(pos).reduce((s,p)=>s+p.c,0)};
  const unit=(N-lost)/N*n.total/N;pk=Math.max(pk,unit);mdd=Math.max(mdd,(pk-unit)/pk);if(withCurve)curve.push({date:n.date,total:k*n.total,inflow:n.inflow});
 }
 const k=Math.max(0,(N-lost)/N),terminalTax=tx(rg+k*(last.held-last.cost)),final=k*last.E-terminalTax;
 if(withCurve)curve[curve.length-1].total=final;
 return {final,tax:paid+terminalTax,taxPaid:paid,terminalTax,mddUnit:mdd*100,...(withCurve?{curve}:{})};}
function dual(){
 const src=fs.readFileSync(path.join(ROOT,'plan-session-engine.js'),'utf8'),ctx={};vm.runInNewContext(src,ctx);const native=ctx.JKPlanSessionEngine;
 const needle='targetShares={TECL:tt,TQQQ:tq,SGOV:ts};';if(src.split(needle).length!==2)throw Error('deposit hook shape changed');
 const hook=`${needle}
 if(opt.gptDepositBand!=null&&force&&!teclHit&&!guardFlip&&!tqReb&&!first&&!sgNew){
   const wants={TECL:total*D.teclWeight*w,TQQQ:guard==='ON'?total*D.guardWeight:0,SGOV:Math.max(0,total*(1-D.teclWeight*w-(guard==='ON'?D.guardWeight:0)))};
   const gaps={};for(const sym of ['TECL','TQQQ','SGOV']){const gap=wants[sym]-pos[sym]*sp[sym];gaps[sym]=sp[sym]>0&&gap>total*opt.gptDepositBand?gap:0;}
   const sum=Object.values(gaps).reduce((s,x)=>s+x,0),budget=Math.max(0,Math.min(monthlyAdd,cash))/(1+FEE_RATE);
   targetShares={...pos};if(sum>0)for(const sym of ['TECL','TQQQ','SGOV'])if(gaps[sym]>0)targetShares[sym]+=Math.floor(Math.min(gaps[sym],budget*gaps[sym]/sum)/sp[sym]);
 }`;
 const c={};vm.runInNewContext(src.replace(needle,hook),c);const E=c.JKPlanSessionEngine;
 const q=s=>{const j=JSON.parse(fs.readFileSync(path.join(D,'planrule/data',s+'.json'),'utf8'));return {days:j.ohlcTrade.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close})),div:j.dividends||[]};};
 const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'),last=T.days.at(-1).date,st=starts('2011-04-01',last,2011);
 const cfg={lump10:[10000,0],lump100:[100000,0],dep10:[10000,210],dep100:[100000,210],user25:[25000,210],paper:[69244,69.24]},out={...metadata(),mode:'dual',last,starts:st,sets:{},reproduction:{}};
 for(const [name,[P,M]] of Object.entries(cfg)){
  const run=(from,to,band)=>{const o={horizon:5,rules:'base',startDate:from,endDate:to,principal:P,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div};if(band!=null)o.gptDepositBand=band;
   const r=E.replay(o);if(!r.stats)throw Error(r.error);if(band==null&&from==='2011-04-01'&&to===last){const n=native.replay(o);if(JSON.stringify(n)!==JSON.stringify(r))throw Error('replay baseline differs');out.reproduction[name]='all replay fields identical to unmodified original';}
   for(const e of r.ledger.events)if(e.type==='trade'&&e.signalDate&&e.signalDate>=e.date)throw Error('non-prior signal');
   const at=taxCurve(r);return {ann:(Math.pow(Math.max(at.final,0)/r.last.inflow,1/r.stats.yrs)-1)*100,final:at.final,mdd:r.stats.mdd,mddUnit:at.mddUnit,tax:at.tax,trades:r.stats.nTrade,inflow:r.last.inflow,zero:at.final<=.01};};
  const rows=[];for(const [v,band] of [['base',null],['under1',.01],['under0',0],['under2',.02]]){const full=run('2011-04-01',last,band),win=st.map(([s,e])=>run(s,e,band));rows.push({v,full,win});process.stderr.write(`dual ${name} ${v} done\n`);}
  const b=rows[0],summary={base:{full:b.full,windows:dist(b.win)}};
  for(const a of rows.slice(1)){summary[a.v]={full:a.full,fullDelta:{ann:a.full.ann-b.full.ann,mdd:a.full.mdd-b.full.mdd},pair:pair(a.win,b.win),afterTaxUnitMddDiff:quant(a.win.map((x,i)=>x.mddUnit-b.win[i].mddUnit))};}
  out.sets[name]={P,M,rows,summary};
 }
 // Do not replace integer shares with fractions to hide unaffordable synthetic
 // prices. Synthetic replay feasibility is an audit, not claimed validation.
 out.syntheticFeasibility=Object.fromEntries(['SYNTECL','SYNTQQQ'].map(s=>{const a=rd(s).ohlcTrade.filter(x=>x.date>='2000-01-01');return [s,{first:a[0],maxClose:Math.max(...a.map(x=>x.close)),note:'unchanged replay has no split-event option; px uses fractional adjusted-price proxy, not equivalent'}];}));
 return out;
}
module.exports={quant,mean,boot,pair,dist,starts,taxCurve,metadata};
if(require.main===module)(async()=>{const mode=process.argv[2],out=mode==='im'?await infinite():mode==='asap'?await asap():mode==='dual'?dual():null;if(!out)throw Error('mode im|asap|dual required');const file=process.argv[3];if(file)fs.writeFileSync(file,JSON.stringify(out));const small=JSON.parse(JSON.stringify(out));for(const s of Object.values(small.sets)){if(s.rows)s.rows=s.rows.map(({win,...r})=>r);delete s.starts;}delete small.starts;console.log(JSON.stringify(small,null,2));})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
