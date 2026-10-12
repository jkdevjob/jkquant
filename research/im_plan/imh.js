// 무매 연구 하네스 — backtest.html 실제 엔진(runIM)을 브라우저에서 그대로 돌리고, 연구용 고리만 주입한다.
let PW; try{ PW=require('playwright'); }catch(e){ PW=require('/opt/node22/lib/node_modules/playwright'); } const {chromium}=PW; const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..'), DATA=path.join(__dirname,'data');
async function open(syms){
  const srv=http.createServer((q,r)=>{ let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p);
    if(p.startsWith('/api/')||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ r.writeHead(404); return r.end(); }
    r.writeHead(200,{'content-type':f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html; charset=utf-8'}); fs.createReadStream(f).pipe(r); }).listen(0);
  const port=srv.address().port; const b=await chromium.launch(); const pg=await b.newPage();
  pg.on('pageerror',()=>{}); await pg.route(u=>!u.href.startsWith('http://127.0.0.1:'+port), r=>r.abort());
  await pg.goto('http://127.0.0.1:'+port+'/backtest.html',{waitUntil:'domcontentloaded'}); await pg.waitForTimeout(500);
  for(const s of syms){ const j=fs.readFileSync(path.join(DATA,(s.file||s.sym)+'.json'),'utf8');
    const n=await pg.evaluate(([sym,txt,synth])=>{ const j=JSON.parse(txt); const bag=newPriceBag(); absorbQuote(bag,j); const rows=commitPriceBag(sym,bag); return rows?rows.length:0; },[s.sym,j]); if(!n) throw new Error('load '+s.sym); }
  await pg.evaluate(SETUP);
  return {pg, close:async()=>{ await b.close(); srv.close(); }};
}
// 페이지 안: runIM 원문 + 고리 → runIMx
const SETUP=`(()=>{
  let src=runIM.toString().replace('function runIM(','function runIMx(');
  const inj=(a,b)=>{ const p=src.split(a); if(p.length!==2) throw new Error('inject '+a.slice(0,40)+' x'+(p.length-1)); src=p[0]+b+p[1]; };
  inj('let cash=cap,shares=0,','let __res=0; let cash=cap,shares=0,');
  inj('if(imCycleEnds(soldToday, shares)){shares=0;avg=0;cycles++;','if(imCycleEnds(soldToday, shares)){cash+=__res;__res=0;shares=0;avg=0;cycles++;');
  inj('if(shares<1e-9){ shares=0;avg=0;cycles++; inReverse=false;','if(shares<1e-9){ cash+=__res;__res=0; shares=0;avg=0;cycles++; inReverse=false;');
  inj('const fin=cash+shares*','cash+=__res;__res=0; const fin=cash+shares*');
  inj('const buyLimit=prevC*(1+bigPct/100);','const buyLimit=prevC*(1+bigPct/100); if(__H.rate){ const _r=__H.rate(d,i); if(cash>0) cash+=cash*_r; if(__res>0) __res+=__res*_r; if(__H.savedYield&&savedProfit>0) savedProfit+=savedProfit*_r; }\\n    if(__H.exit&&shares>0&&__H.exit(d,i,tkr)){ _sell(o,shares,0); cash+=__res;__res=0; shares=0;avg=0;T=0;inReverse=false;cycleStart=String();cycles++; __H.exits++; }');
  inj('{ const eq=cash+shares*c+savedProfit-addedCash; if(eq>mddPeak)','{ const eq=cash+__res+shares*c+savedProfit-addedCash; __H.eqs.push([d,eq,savedProfit]); if(eq>mddPeak)');
  inj('const buys=_imBuyPlan(','if((flat0||__H.divsDaily)&&__H.divsAt){ const _nd=__H.divsAt(d,i,tkr); if(_nd&&_nd!==divs){ divs=_nd; starSlope=starBase*0.1*20/divs; } }\\n    if(flat0&&__H.tpAt){ const _tp=__H.tpAt(d,i,tkr); if(_tp&&_tp!==curTP){ curTP=_tp; starBase=_tp; starSlope=starBase*0.1*20/divs; exitMul=1-starBase/100; } }\\n    const buys=(flat0&&__H.gate&&!__H.gate(d,i,tkr))?[]:_imBuyPlan(');
  inj('if(flat0&&__H.tpAt)','if(flat0&&__H.budget&&__res===0){ const _b=__H.budget(d,i,tkr); if(_b<1){ __res=cash*(1-_b); cash-=__res; } }\\n    if(flat0&&__H.tpAt)');
  window.__H={eqs:[]};
  (0,eval)(src);
  window.RUN=function(o){
    const tkr=o.tkr||'SOXL', all=Object.keys(M[tkr]).sort(), days=all.filter(d=>d>=(o.from||'0')&&d<=(o.to||'9'));
    const C0=C; const closes=all.map(d=>M[tkr][d][C0]); const idx={}; all.forEach((d,k)=>idx[d]=k);
    const ma=n=>{ const out=[];let s=0; for(let k=0;k<closes.length;k++){ s+=closes[k]; if(k>=n) s-=closes[k-n]; out.push(k>=n-1?s/n:null);} return out; };
    const MA={}; const maOf=n=>MA[n]||(MA[n]=ma(n));
    const vol=n=>{ const out=[]; for(let k=0;k<closes.length;k++){ if(k<n){out.push(null);continue;} let m=0,r=[]; for(let j=k-n+1;j<=k;j++){ r.push(closes[j]/closes[j-1]-1);} m=r.reduce((a,b)=>a+b,0)/n; out.push(Math.sqrt(r.reduce((a,b)=>a+(b-m)*(b-m),0)/n*252)); } return out; };
    const VOL={}; const volOf=n=>VOL[n]||(VOL[n]=vol(n));
    const IRX=window.__IRX||{}; const irxDates=Object.keys(IRX).sort();
    let lastIrx=0, li=0; const irxAt=d=>{ while(li<irxDates.length&&irxDates[li]<=d){ lastIrx=IRX[irxDates[li]]; li++; } return lastIrx; };
    let prevD=null;
    __H={eqs:[]};
    if(o.cashYield){ __H.rate=(d,i)=>{ const r=irxAt(d); const gap=prevD?Math.max(1,Math.round((Date.parse(d)-Date.parse(prevD))/864e5)):1; prevD=d; return Math.max(0,(r/100-0.0009))*(1-0.154)*gap/365; }; }
    const P=k=>k-1;  // 전일 확정 지표
    const sig=o.sig||{};
    if(sig.gateMA){ const m=maOf(sig.gateMA); __H.gate=(d)=>{ const k=P(idx[d]); return !(m[k]>0) || closes[k]>m[k]*(1+(sig.gateBand||0)); }; }
    if(sig.bearDivs){ const m=maOf(sig.bearMA||150); __H.divsAt=(d)=>{ const k=P(idx[d]); return (m[k]>0&&closes[k]<m[k])?sig.bearDivs:o.divs||20; }; }
    if(sig.volDivs){ const v=volOf(sig.volN||60); __H.divsAt=(d)=>{ const k=P(idx[d]); const x=v[k]; if(!(x>0)) return o.divs||20; return x>sig.volHi?sig.volDivs:(o.divs||20); }; }
    if(sig.bearTP){ const m=maOf(sig.bearMA||150); __H.tpAt=(d)=>{ const k=P(idx[d]); return (m[k]>0&&closes[k]<m[k])?sig.bearTP:(o.tgt||20); }; }
    if(sig.daily) __H.divsDaily=true;
    __H.exits=0; __H.savedYield=!!o.savedYield;
    if(sig.budget){ const v=volOf(sig.bN||60); __H.budget=(d)=>{ const k=P(idx[d]); const x=v[k]; if(!(x>0)) return 1; return Math.max(sig.bMin||0,Math.min(1,Math.pow(sig.bT/x,sig.bPow||2))); }; }
    if(sig.exitMA){ const m=maOf(sig.exitMA); const lo=1-(sig.exitBand||0), hi=1+(sig.enterBand||0); let on=true;
      const st={}; for(let k=1;k<closes.length;k++){ const kk=k-1; if(m[kk]>0){ if(on&&closes[kk]<m[kk]*lo) on=false; else if(!on&&closes[kk]>m[kk]*hi) on=true; } st[all[k]]=on; }
      __H.exit=(d)=>st[d]===false; __H.gate=(d)=>st[d]!==false; }
    if(sig.slowMA){ const m=maOf(sig.slowMA); __H.divsAt=(d)=>{ const k=P(idx[d]); return (m[k]>0&&closes[k]<m[k]*(1-(sig.slowBand||0)))?sig.slowDivs:(o.divs||20); }; __H.divsDaily=true; }
    if(typeof o.autoTp==='boolean') imAutoTp=o.autoTp; else imAutoTp=false;
    imCostOn=o.cost!==false; imReverse=!!o.reverse;
    const r=runIMx(days,tkr,o.cap||10000,o.divs||20,o.tgt||20,o.compound!==false,o.big);
    return {exits:__H.exits, final:r.final, mdd:r.mdd, cycles:r.cycles, tax:r.tax, fees:r.fees, eqs:__H.eqs, first:days[0], last:days[days.length-1], n:days.length};
  };
})()`;
function stats(r,cap){ const yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5); const cagr=(Math.pow(r.final/cap,1/yrs)-1)*100;
  let pk=0,mdd=0; for(const [,e] of r.eqs){ if(e>pk)pk=e; else mdd=Math.max(mdd,(pk-e)/pk); } if(r.final<pk) mdd=Math.max(mdd,(pk-r.final)/pk);
  return {cagr, mdd:mdd*100, mar:cagr/(mdd*100), final:r.final, yrs}; }
module.exports={open,stats};
