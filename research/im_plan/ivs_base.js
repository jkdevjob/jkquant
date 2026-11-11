// 운영 메뉴 섀넌(역분산) 기준선(11-12) — backtest.html runIVS 를 앱 운영 기본값 그대로(index.html defIvsSettings: TQQQ · iv · s0 55 · σ 40일 · 밴드 15%p ·
// 단기국채 대기 · 비용·세금)로 실제 TQQQ 2010~ · USD 2007~(사용자 실제 종목) · 합성 SYNTQQQ_S 1990~ · SYNUSD_S 1995~ × 1만$·10만$ · 전체 기간 + 5년 창(매달 시작).
// 값: 세후 CAGR(엔진 끝값 — 해마다 실현 세금 냄 · 끝날 미실현 이익 세금은 안 뺌) · 엔진 MDD · 리밸런싱/년 · 참고: 같은 기간 그냥 보유(세전 · 첫날 → 끝날 종가)
// 사용: node ivs_base.js [out.json]   env: DS=tq,usd,tqsyn,usdsyn · CAPS=10000,100000 · P='{"s0":0.55,"N":40,"band":0.15}'(후보 시험용 · 기본 = 앱)
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'ivs_base_out.json', DS=(process.env.DS||'tq,usd,tqsyn,usdsyn').split(','), CAPS=(process.env.CAPS||'10000,100000').split(',').map(Number);
const P=Object.assign({s0:.55,N:40,band:.15,mode:'iv',pair:'cash'},JSON.parse(process.env.P||'{}'));
const SETS={tq:{sym:'TQQQ',file:'TQQQ',y0:2010},usd:{sym:'USD',file:'USD',y0:2007},tqsyn:{sym:'SYNTQQQ_S',file:'SYNTQQQ_S',y0:1990},usdsyn:{sym:'USD',file:'SYNUSD_S',y0:1995}};
const PAGE=()=>{ window.IVSRUN=function(tkr,from,to,cap,P){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=runIVS(days,tkr,cap,P.s0,P.N,P.band,true,P.mode,P.pair);
  const yrs=(Date.parse(days[days.length-1])-Date.parse(days[0]))/(365.25*864e5), p0=M[tkr][days[0]][C], p1=M[tkr][days[days.length-1]][C];
  return {final:r.final,cagr:(Math.pow(Math.max(r.final,1e-9)/cap,1/yrs)-1)*100,mdd:r.mdd,reb:(r.rebals||r.trades||0)/yrs,bh:(Math.pow(p1/p0,1/yrs)-1)*100,first:days[0],last:days[days.length-1]}; }; };
(async()=>{ const out={P,sets:{}}; const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f1=x=>x.toFixed(1);
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.sym,file:S.file}]);
    const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.sym), END=all[all.length-1], F0=all[Math.min(all.length-1,P.N+5)];   // 전체 기간은 σ 창이 찬 뒤부터
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<F0) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    out.sets[ds]={sym:S.sym,file:S.file,first:F0,last:END,starts:starts.map(x=>x[0]),caps:{}};
    for(const cap of CAPS){ const full=await pg.evaluate(a=>IVSRUN(...a),[S.sym,F0,END,cap,P]); const W=[];
      for(const [s,e] of starts){ const r=await pg.evaluate(a=>IVSRUN(...a),[S.sym,s,e,cap,P]); W.push({s,c:r.cagr,mdd:r.mdd,reb:r.reb,bh:r.bh}); }
      out.sets[ds].caps[cap]={full,win:W};
      console.log(`${ds} ${S.file} ${cap/1e4}만$ | 전체 ${F0}~${END}: 세후 CAGR ${f1(full.cagr)} · MDD ${f1(full.mdd)} · 리밸런싱 ${f1(full.reb)}회/년 | 그냥 보유(세전) ${f1(full.bh)}`
        +` || 5년 창 ${W.length}: CAGR 중앙 ${f1(q(W.map(x=>x.c),.5))} · 하10 ${f1(q(W.map(x=>x.c),.1))} · 최악 ${f1(Math.min(...W.map(x=>x.c)))} · MDD 중앙 ${f1(q(W.map(x=>x.mdd),.5))} · 최악 ${f1(Math.max(...W.map(x=>x.mdd)))} | 그냥 보유 중앙 ${f1(q(W.map(x=>x.bh),.5))} · 최악 ${f1(Math.min(...W.map(x=>x.bh)))} · 섀넌이 높은 창 ${W.filter(x=>x.c>x.bh).length}/${W.length}`); }
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
