'use strict';
const fs=require('node:fs');const{starts,pair,dist}=require('./operating-20261110.cjs');
const END='2026-11-13';
function setup(){
 window.__DCA_NATIVE=_dcaOne;window.__DCA_HITS=_dcaHits;window.__DCA_PHASE=0;
 _dcaHits=function(days,freq){const h=window.__DCA_HITS(days,freq);if(_dcaFreq(freq)!=='weekly'||!window.__DCA_PHASE)return h;const out=days.map(()=>false),groups=[];for(let i=0;i<days.length;i++){if(h[i])groups.push([]);groups.at(-1).push(i);}for(const g of groups)out[g[Math.min(window.__DCA_PHASE,g.length-1)]]=true;return out;};
 let s=_dcaOne.toString().replace('function _dcaOne(','function __DCA_OBS('),nd='    if(i%10===0){ snap.push([d,p>0?sh*p+dcash:null]);';if(s.split(nd).length!==2)throw Error('DCA observation shape');s=s.replace(nd,'    window.__DCA_CURVE.push([d,sh*p+dcash,inv]);\n'+nd);(0,eval)(s);
 window.__DCA_BUY_NATIVE=buyQty;buyQty=function(amt,price,fee,integer){const q=window.__DCA_BUY_NATIVE(amt,price,fee,integer);if(window.__DCA_RECORD){window.__DCA_BASIS+=q*price*(1+fee);window.__DCA_QTY+=q;window.__DCA_FEES+=q*price*fee;}return q;};
 window.__dcaOne=({tk,P,s,e,key})=>{const days=dtsOf(tk).filter(d=>d>=s&&d<=e),freq=key==='base'?'daily':'weekly';window.__DCA_PHASE=key==='W1'?1:key==='W2'?2:0;dcaDipMul=1;dcaReinv=true;const hits=_dcaCount(days,freq),amt=P/hits;
 window.__DCA_RECORD=true;window.__DCA_BASIS=0;window.__DCA_QTY=0;window.__DCA_FEES=0;window.__DCA_CURVE=[];
 const r=__DCA_OBS(tk,days,amt,freq,true,1),basis=window.__DCA_BASIS,qty=window.__DCA_QTY,fees=window.__DCA_FEES;window.__DCA_RECORD=false;
 const n=key==='base'?runDCA1(tk,days,P,true):window.__DCA_NATIVE(tk,days,amt,freq,true,1);if(JSON.stringify(n)!==JSON.stringify(r))throw Error('DCA native parity');
 const lc=srcOf(tk)[days.at(-1)][C];if(Math.abs(qty*lc+r.endCash-r.final)>1e-6)throw Error('DCA quantity conservation');if(Math.abs(r.invested-P)>1e-6)throw Error('DCA total budget');
 const after=saleNet(r.final-r.endCash,basis,true,tk)+r.endCash,yrs=(Date.parse(days.at(-1))-Date.parse(days[0]))/(365.25*864e5);let peak=P,md=0,min=P,maxReserveError=0;
 for(let i=0;i<__DCA_CURVE.length;i++){const[d,stock,inv]=__DCA_CURVE[i],reserve=P-inv;if(reserve<-.000001)throw Error('DCA borrowed capital');const v=(i===__DCA_CURVE.length-1?after:stock)+Math.max(0,reserve);peak=Math.max(peak,v);md=Math.max(md,(peak-v)/peak);min=Math.min(min,v);maxReserveError=Math.max(maxReserveError,Math.abs(inv+reserve-P));}
 return {final:after,ann:(Math.pow(Math.max(after,1e-12)/P,1/yrs)-1)*100,mdd:md*100,nativeFinal:r.final,nativeMdd:r.mdd,invested:r.invested,basis,fees,terminalCost:r.final-after,trades:r.trades,zero:min<=.01||after<=.01,maxReserveError,yrs};};
 window.__dcaDefault=({tk,s,e})=>{window.__DCA_PHASE=0;dcaDipMul=1;dcaReinv=true;const r=__DCA_NATIVE(tk,dtsOf(tk).filter(d=>d>=s&&d<=e),10,'daily',true,1);return {final:r.final,invested:r.invested,mdd:r.mdd,trades:r.trades};};
}
async function main(){await require('./run.cjs').prepareChromium();const{open}=require('../im_plan/imh'),out={date:'2026-11-16',end:END,sets:{},audit:{nativeExact:0,maxReserveError:0}};
for(const[ds,tk,file,y0]of[['real','USD','USD',2007],['syn','USD','SYNUSD_S',1995],['tq','TQQQ','TQQQ',2010],['tqsyn','TQQQ','SYNTQQQ_S',1990]].filter(([d])=>(process.env.DS||'real,syn,tq,tqsyn').split(',').includes(d))){const{pg,close}=await open([{sym:tk,file}]);try{await pg.evaluate(setup);const all=await pg.evaluate(({tk,END})=>dtsOf(tk).filter(d=>d<=END),{tk,END}),st=starts(all[0],all.at(-1),y0),rows=[];
 for(const P of[10000,100000,30000])for(const key of['base','W0','W1','W2']){const r=await pg.evaluate(({tk,P,key,all,st})=>({full:__dcaOne({tk,P,key,s:all[0],e:all.at(-1)}),win:st.map(([s,e])=>__dcaOne({tk,P,key,s,e}))}),{tk,P,key,all,st});rows.push({P,key,...r});out.audit.nativeExact+=r.win.length+1;for(const x of[r.full,...r.win])out.audit.maxReserveError=Math.max(out.audit.maxReserveError,x.maxReserveError);process.stderr.write(`${ds} ${P} ${key} done\n`);}
 const defaults=await pg.evaluate(({tk,all,st})=>({full:__dcaDefault({tk,s:all[0],e:all.at(-1)}),win:st.map(([s,e])=>__dcaDefault({tk,s,e}))}),{tk,all,st}),summary={};for(const P of[10000,100000,30000]){const b=rows.find(x=>x.P===P&&x.key==='base');summary[P]={base:{full:b.full,dist:dist(b.win)}};for(const k of['W0','W1','W2']){const a=rows.find(x=>x.P===P&&x.key===k),idx=st.map((x,i)=>i).filter(i=>st[i][0]<'2005-01-01');summary[P][k]={pair:pair(a.win,b.win),fullDelta:{ann:a.full.ann-b.full.ann,mdd:a.full.mdd-b.full.mdd},oos:idx.length?pair(idx.map(i=>a.win[i]),idx.map(i=>b.win[i])):null};}}
 out.sets[ds]={tk,file,starts:st,rows,defaults,summary};fs.writeFileSync(process.argv[2]||'/tmp/jkq-op16-dca.json',JSON.stringify(out));console.log(JSON.stringify({ds,summary}));}finally{await close();}}
console.log(JSON.stringify({audit:out.audit}));}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
