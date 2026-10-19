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
  inj('const buyLimit=prevC*(1+bigPct/100);','const buyLimit=prevC*(1+bigPct/100); if(__H.sg){ const G=__H.sg, _r=__H.sgRate(d), unit=(cash+shares*prevC)/divs; if(G.S>0){ const y=G.S*_r; G.S+=y; cash+=y; G.yld+=y; }; const mv=x=>{ if(Math.abs(x)<1) return; const f=Math.abs(x)*G.fee; G.S+=x; cash-=f; G.fees+=f; G.n++; };; if(G.mode==="week"){ const wk=Math.floor((Date.parse(d)/864e5+3)/7); if(wk!==G.wk){ G.wk=wk; mv(Math.max(0,cash-G.k*unit)-G.S); } } else if(!(shares>0)&&T===0){ mv(Math.max(0,cash-G.k*unit)-G.S); }; if(G.S>0&&cash-G.S<2*unit){ mv(-Math.min(G.S, G.mode==="week"?(2*unit-(cash-G.S)):G.k*unit)); } }');
  inj('{ const eq=cash+shares*c+savedProfit-addedCash; if(eq>mddPeak)','{ const eq=cash+__res+shares*c+savedProfit-addedCash; __H.eqs.push([d,eq,savedProfit]); if(eq>mddPeak)');
  inj('const buys=_imBuyPlan(','if((flat0||__H.divsDaily)&&__H.divsAt){ const _nd=__H.divsAt(d,i,tkr); if(_nd&&_nd!==divs){ divs=_nd; starSlope=starBase*0.1*20/divs; } }\\n    if(flat0&&__H.tpAt){ const _tp=__H.tpAt(d,i,tkr); if(_tp&&_tp!==curTP){ curTP=_tp; starBase=_tp; starSlope=starBase*0.1*20/divs; exitMul=1-starBase/100; } }\\n    const buys=(flat0&&__H.gate&&!__H.gate(d,i,tkr))?[]:_imBuyPlan(');
  inj('if(flat0&&__H.tpAt)','if(flat0&&__H.budget&&__res===0){ const _b=__H.budget(d,i,tkr); if(_b<1){ __res=cash*(1-_b); cash-=__res; } }\\n    if(flat0&&__H.tpAt)');
  inj('let __res=0;','let __res=0, __m1x=false, __m1pause=false, __age=0, __m1rev=false;');
  inj('if(AUTO&&cycleStart&&shares>0&&curTP===20){','if(cycleStart&&shares>0) __age++;\\n    if(__H.m1&&__H.m1.revertAfter&&__m1x&&!__m1rev&&curTP===10&&__age>__H.m1.revertAfter){ curTP=targetPct;starBase=targetPct;starSlope=starBase*0.1*20/divs;exitMul=1-starBase/100;__m1rev=true; if(__H.trace) __H.m1d.push("rev:"+d); }\\n    if(AUTO&&cycleStart&&shares>0&&curTP===20&&!__m1x){');
  inj('if(P&&P.tp===10){curTP=10;starBase=10;starSlope=starBase*0.1*20/divs;exitMul=1-starBase/100;m1N++;}','if(P&&P.tp===10){ const _m=__H.m1||{}; m1N++; __m1x=true; if(__H.trace) __H.m1d.push(d);\\n        if(_m.maxAge&&__age>_m.maxAge){ }\\n        else if(_m.mode==="tpOnly"){ curTP=10; }\\n        else if(_m.mode==="starOnly"){ starBase=10;starSlope=starBase*0.1*20/divs;exitMul=1-starBase/100; }\\n        else if(_m.mode==="pause"){ __m1pause=true; }\\n        else if(_m.mode==="pauseTp"){ __m1pause=true; curTP=10;starBase=10;starSlope=starBase*0.1*20/divs;exitMul=1-starBase/100; }\\n        else { curTP=10;starBase=10;starSlope=starBase*0.1*20/divs;exitMul=1-starBase/100; } }');
  inj('const buys=(flat0&&__H.gate','const buys=(__m1pause&&!flat0)?[]:(flat0&&__H.gate');
  inj('if(AUTO && flat0 && shares>0){ cycleStart=d;','if(flat0 && shares>0){ __m1x=false; __m1pause=false; __age=0; __m1rev=false; if(__H.trace) __H.cyc.push([d,curTP]); }\\n    if(AUTO && flat0 && shares>0){ cycleStart=d;');
  inj('    if(i%10===0)snap.push([d,cash+shares*c+savedProfit-addedCash]);\\n    peakInvested=Math.max(peakInvested, cap-cash);\\n  });','    if(__H.trace) __H.tr.push([d,c,cash,shares,avg,T,curTP,starBase]);\\n    if(i%10===0)snap.push([d,cash+shares*c+savedProfit-addedCash]);\\n    peakInvested=Math.max(peakInvested, cap-cash);\\n  });');
  inj('if(tp!==curTP){ curTP=tp; starBase=tp;','if(tp!==curTP){ curTP=tp; starBase=(__H.m1&&__H.m1.all)?targetPct:tp;');
  inj('const buys=(__m1pause&&!flat0)','if(__H.m1&&__H.m1.slope20){ starSlope=((__H.m1.slope20==="all"||__m1x)?targetPct:starBase)*0.1*20/divs; }\\n    const buys=(__m1pause&&!flat0)');
  inj('const buyLimit=prevC*(1+bigPct/100);','const buyLimit=prevC*(1+((__H.bigAt&&__H.bigAt(d)!=null)?__H.bigAt(d):bigPct)/100);');
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
    if(o.sgov){ let pd=null; __H.sgRate=(d)=>{ const r=irxAt(d); const gap=pd?Math.max(1,Math.round((Date.parse(d)-Date.parse(pd))/864e5)):1; pd=d; return Math.max(0,(r/100-0.0009))*(1-0.154)*gap/365; }; __H.sg={mode:o.sgov.mode,k:o.sgov.k||10,fee:o.sgov.fee!=null?o.sgov.fee:0.0026,S:0,fees:0,yld:0,n:0,wk:null}; }
    const _A0=Object.assign({},IM_AUTOTP), _M0=Object.assign({},IM_AUTOTP_M1); window.__imAutoTP0=window.__imAutoTP0||imAutoTP; imAutoTP=window.__imAutoTP0;
    if(o.auto){ Object.assign(IM_AUTOTP,o.auto.A||{}); Object.assign(IM_AUTOTP_M1,o.auto.M||{}); if(o.auto.noWeak) imAutoTP=(b,d)=>{ const P=window.__imAutoTP0(b,d); if(P) P.tp=P.hot?IM_AUTOTP.lo:IM_AUTOTP.hi; return P; }; }
    if(o.cashYield){ __H.rate=(d,i)=>{ const r=irxAt(d); const gap=prevD?Math.max(1,Math.round((Date.parse(d)-Date.parse(prevD))/864e5)):1; prevD=d; return Math.max(0,(r/100-0.0009))*(1-0.154)*gap/365; }; }
    const P=k=>k-1;  // 전일 확정 지표
    const sig=o.sig||{};
    if(sig.gateMA){ const m=maOf(sig.gateMA); __H.gate=(d)=>{ const k=P(idx[d]); return !(m[k]>0) || closes[k]>m[k]*(1+(sig.gateBand||0)); }; }
    if(sig.bearDivs){ const m=maOf(sig.bearMA||150); __H.divsAt=(d)=>{ const k=P(idx[d]); return (m[k]>0&&closes[k]<m[k])?sig.bearDivs:o.divs||20; }; }
    if(sig.volDivs){ const v=volOf(sig.volN||60); __H.divsAt=(d)=>{ const k=P(idx[d]); const x=v[k]; if(!(x>0)) return o.divs||20; return x>sig.volHi?sig.volDivs:(o.divs||20); }; }
    if(sig.bearTP){ const m=maOf(sig.bearMA||150); __H.tpAt=(d)=>{ const k=P(idx[d]); return (m[k]>0&&closes[k]<m[k])?sig.bearTP:(o.tgt||20); }; }
    if(sig.daily) __H.divsDaily=true;
    if(sig.guard){ const g=sig.guard, gs=g.sym||'TQQQ', gd=Object.keys(M[gs]).sort(), gc=gd.map(x=>M[gs][x][C0]), gn=g.ma||225, gb=g.band==null?0.01:g.band;
      const gm=[]; { let sm=0; for(let k=0;k<gc.length;k++){ sm+=gc[k]; if(k>=gn) sm-=gc[k-gn]; gm.push(k>=gn-1?sm/gn:null); } }
      let on=null; const gst=[]; for(let k=0;k<gd.length;k++){ if(gm[k]>0){ if(on===null) on=gc[k]>gm[k]; if(gc[k]>gm[k]*(1+gb)) on=true; else if(gc[k]<gm[k]*(1-gb)) on=false; } gst.push(on); }
      const off=(d)=>{ let a=0,b=gd.length; while(a<b){ const m=(a+b)>>1; if(gd[m]<d) a=m+1; else b=m; } const j=a-1; return j>=0&&gst[j]===false; };   // 전일 확정 — d 보다 앞선 마지막 날의 Guard 상태
      if(g.tp) __H.tpAt=(d)=>off(d)?g.tp:(o.autoTp?null:(o.tgt||20));
      if(g.big!=null) __H.bigAt=(d)=>off(d)?g.big:null;
      __H.guardOff=off; }
    __H.exits=0; __H.savedYield=!!o.savedYield;
    if(sig.budget){ const v=volOf(sig.bN||60); __H.budget=(d)=>{ const k=P(idx[d]); const x=v[k]; if(!(x>0)) return 1; return Math.max(sig.bMin||0,Math.min(1,Math.pow(sig.bT/x,sig.bPow||2))); }; }
    if(sig.exitMA){ const m=maOf(sig.exitMA); const lo=1-(sig.exitBand||0), hi=1+(sig.enterBand||0); let on=true;
      const st={}; for(let k=1;k<closes.length;k++){ const kk=k-1; if(m[kk]>0){ if(on&&closes[kk]<m[kk]*lo) on=false; else if(!on&&closes[kk]>m[kk]*hi) on=true; } st[all[k]]=on; }
      __H.exit=(d)=>st[d]===false; __H.gate=(d)=>st[d]!==false; }
    if(sig.slowMA){ const m=maOf(sig.slowMA); __H.divsAt=(d)=>{ const k=P(idx[d]); return (m[k]>0&&closes[k]<m[k]*(1-(sig.slowBand||0)))?sig.slowDivs:(o.divs||20); }; __H.divsDaily=true; }
    __H.m1=o.m1||null; if(o.trace){ __H.trace=true; __H.tr=[]; __H.m1d=[]; __H.cyc=[]; }
    if(typeof o.autoTp==='boolean') imAutoTp=o.autoTp; else imAutoTp=false;
    imCostOn=o.cost!==false; imReverse=!!o.reverse;
    const r=runIMx(days,tkr,o.cap||10000,o.divs||20,o.tgt||20,o.compound!==false,o.big);
    Object.assign(IM_AUTOTP,_A0); Object.assign(IM_AUTOTP_M1,_M0); imAutoTP=window.__imAutoTP0;
    return {trace:o.trace?{tr:__H.tr,m1d:__H.m1d,cyc:__H.cyc}:null, sg:__H.sg?{fees:__H.sg.fees,yld:__H.sg.yld,n:__H.sg.n}:null, exits:__H.exits, final:r.final, mdd:r.mdd, cycles:r.cycles, tax:r.tax, fees:r.fees, eqs:__H.eqs, first:days[0], last:days[days.length-1], n:days.length};
  };
})()`;
function stats(r,cap){ const yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5); const cagr=(Math.pow(r.final/cap,1/yrs)-1)*100;
  let pk=0,mdd=0; for(const [,e] of r.eqs){ if(e>pk)pk=e; else mdd=Math.max(mdd,(pk-e)/pk); } if(r.final<pk) mdd=Math.max(mdd,(pk-r.final)/pk);
  return {cagr, mdd:mdd*100, mar:cagr/(mdd*100), final:r.final, yrs}; }
module.exports={open,stats};
