'use strict';
// Preregistered first-cycle budget experiment. Complete backtest.html via imh;
// only the first buy budget/T are changed in memory, never the trade simulator.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {starts,pair,dist,quant:q,mean}=require('./operating-20261110.cjs');
const ROOT=path.resolve(__dirname,'../..'),OUT=process.argv[2]||'/tmp/jkq-20261112-im.json';
const V={base:{m:1},F125:{m:1.25},F15:{m:1.5},F20:{m:2},F15B:{m:1.5,bull:true},F20B:{m:2,bull:true},PL3:{m:1,capMul:1.003}};
function firstSetup(t){const all=Object.keys(M[t]).sort().filter(d=>d<='2026-11-11');
    imAutoTp=true;imCostOn=true;imReverse=false;
    const native=[10000,100000].map(cap=>{const r=runIM(all,t,cap,20,20,true,20);return {cap,final:r.final,mdd:r.mdd,fees:r.fees,tax:r.tax,cycles:r.cycles};});
    const src=runIMx.toString(),needle='const buyLimit=prevC*';if(src.split(needle).length!==2)throw Error('First-day hook changed');
    (0,eval)(src.replace(needle,'window.__FIRST_M=window.__FIRST_GATE(d,tkr); '+needle));
    window.__FIRST_GATE=()=>1;window.__FIRST_M=1;window.__ORIGINAL_BUY=_imBuyPlan;
    _imBuyPlan=function(T,avg,sh,cash,divs,sb,ss,lim,pc,fee,rows,cur){const m=(sh===0&&T===0)?window.__FIRST_M:1;
     const plan=window.__ORIGINAL_BUY(T,avg,sh,cash,divs/m,sb,ss,lim,pc,fee,rows,cur);
     if(m===1)return plan;return plan.map(b=>({...b,dT:b.dT*m}));};
    // Ladder-only first-day fills count the same enlarged installment.
    const s=runIMx.toString(),nd='if(lf&&!mf) T+=1;';if(s.split(nd).length!==2)throw Error('First T hook changed');
    (0,eval)(s.replace(nd,'if(lf&&!mf) T+=(flat0?window.__FIRST_M:1);'));
    const ma={};let sum=0;for(let k=0;k<all.length;k++){sum+=M[t][all[k]][C];if(k>=200)sum-=M[t][all[k-200]][C];ma[all[k]]=k>=199?sum/200:null;}
    window.__FIRST_INDEX=Object.fromEntries(all.map((d,k)=>[d,k]));window.__FIRST_DAYS=all;window.__FIRST_MA=ma;
    return {first:all[0],last:all.at(-1),windowFirst:all[20],native};}
module.exports={firstSetup,V};
async function main(){await require('./run.cjs').prepareChromium();const {open}=require('../im_plan/imh');
 const out={date:'2026-11-12',V,jitter:[.99,1,1.01],engine:crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'backtest.html'))).digest('hex'),sets:{}};
 for(const [ds,tk,y0] of [['real','SOXL',2010],['syn','SYNSOXL_S',1995],['tq','TQQQ',2010],['tqsyn','SYNTQQQ_S',1990]]){
  const {pg,close}=await open([{sym:tk}]);try{
   const setup=await pg.evaluate(firstSetup,tk);
   const st=starts(setup.windowFirst,setup.last,y0),rows=[];
   for(const cap of [10000,100000])for(const [v,P]of Object.entries(V)){
    const r=await pg.evaluate(({tk,cap,P,st,native})=>{
     window.__FIRST_GATE=d=>{if(!P.bull)return P.m;const k=window.__FIRST_INDEX[d],pd=window.__FIRST_DAYS[k-1];return pd&&window.__FIRST_MA[pd]>0&&M[tk][pd][C]>window.__FIRST_MA[pd]?P.m:1;};
     const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
     const one=(s,e,j,trace=false)=>{const amount=cap*j*(P.capMul||1),r=RUN({tkr:tk,cap:amount,from:s,to:e||'2026-11-11',autoTp:true,big:20,trace}),yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5);
      if(P.m===1&&!P.capMul&&j===1&&!s){const n=native.find(x=>x.cap===cap);for(const k of ['final','mdd','fees','tax','cycles'])if(Math.abs(r[k]-n[k])>1e-7)throw Error('Native mismatch '+k);}
      let pk=amount,md=0,pd=r.first,mP='',mT='',min=Infinity;for(const[d,eq]of r.eqs){min=Math.min(min,eq);if(eq>pk){pk=eq;pd=d;}else if((pk-eq)/pk>md){md=(pk-eq)/pk;mP=pd;mT=d;}}
      if(r.final<pk&&(pk-r.final)/pk>md){md=(pk-r.final)/pk;mP=pd;mT=r.last;}
      return {ann:(Math.pow(Math.max(r.final,1e-12)/amount,1/yrs)-1)*100,mdd:md*100,final:r.final/(j*(P.capMul||1)),fees:r.fees,tax:r.tax,cycles:r.cycles,mP,mT,zero:r.final<=.01||min<=.01,...(trace?{trace:r.trace}:{} )};};
     const combine=a=>({ann:avg(a.map(x=>x.ann)),mdd:avg(a.map(x=>x.mdd)),final:avg(a.map(x=>x.final)),cycles:avg(a.map(x=>x.cycles)),zero:a.some(x=>x.zero)});
     const fullPaths=[.99,1,1.01].map(j=>one(undefined,undefined,j));
     const win=st.map(([s,e])=>combine([.99,1,1.01].map(j=>one(s,e,j))));
     return {full:combine(fullPaths),fullPaths,win};},{tk,cap,P,st,native:setup.native});
    rows.push({cap,v,...r});process.stderr.write(ds+' '+cap+' '+v+' complete\n');
   }
   const summary={};for(const cap of[10000,100000]){const b=rows.find(x=>x.cap===cap&&x.v==='base');summary[cap]={base:{full:b.full,windows:dist(b.win)}};
    for(const v of Object.keys(V).filter(v=>v!=='base')){const a=rows.find(x=>x.cap===cap&&x.v===v),dm=a.win.map((x,i)=>x.mdd-b.win[i].mdd),idx=st.map((x,i)=>i).filter(i=>st[i][0]<'2005-01-01');
     summary[cap][v]={fullDelta:{ann:a.full.ann-b.full.ann,mdd:a.full.mdd-b.full.mdd},pair:pair(a.win,b.win),dd90:q(dm,.9),tailTop:dm.map((d,i)=>({d,s:st[i][0],base:b.win[i],candidate:a.win[i]})).sort((x,y)=>y.d-x.d).slice(0,3),oos:idx.length?pair(idx.map(i=>a.win[i]),idx.map(i=>b.win[i])):null};}}
   out.sets[ds]={tk,...setup,starts:st,rows,summary};fs.writeFileSync(OUT,JSON.stringify(out));console.log(JSON.stringify({ds,summary}));
  }finally{await close();}
 }
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
