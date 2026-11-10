// 운영 메뉴 로테이션(200일선) 기준선(11-11) — backtest.html runMA200 을 앱 기본값 그대로(SOXL · 합성 1배지수 200일선 · 매수·매도 '200선' · 대피 현금 ·
// 비용·세금 켬 · 전일 신호 → 당일 종가)로 실제 SOXL 2010~ · 합성 SYNSOXL_S 1995~ · (참고) TQQQ 2010~ × 1만$·10만$ · 전체 기간 + 5년 창(매달 시작).
// 값: 세후 CAGR · 엔진 MDD · 매매/년 · 보유 비율 · 참고: 같은 기간 그냥 보유(세전 · 수수료 없음 · 첫날 종가 → 끝날 종가)
// 사용: node ma_base.js [out.json]   env: DS=real,syn,tq · CAPS=10000,100000 · OPT='{"buy":"ma","sell":"ma","park":"cash"}'(후보 시험용 · 기본 = 앱)
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'ma_base_out.json', DS=(process.env.DS||'real,syn,tq').split(','), CAPS=(process.env.CAPS||'10000,100000').split(',').map(Number);
const OPT=process.env.OPT?JSON.parse(process.env.OPT):null, N=+(process.env.N||200);
const SETS={real:{tk:'SOXL',y0:2010},syn:{tk:'SYNSOXL_S',y0:1995},tq:{tk:'TQQQ',y0:2010}};
const PAGE=()=>{ window.MARUN=function(tkr,from,to,cap,N,opt){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const r=runMA200(days,tkr,cap,N,true,opt||undefined);
  const yrs=(Date.parse(days[days.length-1])-Date.parse(days[0]))/(365.25*864e5), p0=M[tkr][days[0]][C], p1=M[tkr][days[days.length-1]][C];
  return {final:r.final,cagr:(Math.pow(Math.max(r.final,1e-9)/cap,1/yrs)-1)*100,mdd:r.mdd,tr:r.trades/yrs,timeIn:r.timeIn,tax:r.tax,fees:r.fees,warm:r.warmDays,bh:(Math.pow(p1/p0,1/yrs)-1)*100,first:days[0],last:days[days.length-1]}; }; };
(async()=>{ const out={opt:OPT,N,sets:{}}; const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f1=x=>x.toFixed(1);
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.tk}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.tk), END=all[all.length-1];
    // 전체 기간은 이평선이 생긴 뒤부터(워밍업 200일을 '보유'로 넣지 않는다 — 엔진 주석의 621% vs 187% 함정)
    const F0=all[Math.min(all.length-1,N+60)];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<F0) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    out.sets[ds]={tk:S.tk,first:F0,last:END,starts:starts.map(x=>x[0]),caps:{}};
    for(const cap of CAPS){ const full=await pg.evaluate(a=>MARUN(...a),[S.tk,F0,END,cap,N,OPT]); const W=[];
      for(const [s,e] of starts){ const r=await pg.evaluate(a=>MARUN(...a),[S.tk,s,e,cap,N,OPT]); W.push({s,c:r.cagr,mdd:r.mdd,tr:r.tr,tin:r.timeIn,bh:r.bh,warm:r.warm}); }
      out.sets[ds].caps[cap]={full,win:W};
      console.log(`${ds} ${S.tk} ${cap/1e4}만$ | 전체 ${F0}~${END}: 세후 CAGR ${f1(full.cagr)} · MDD ${f1(full.mdd)} · 매매 ${f1(full.tr)}회/년 · 보유 ${f1(full.timeIn)}% | 그냥 보유(세전) ${f1(full.bh)}`
        +` || 5년 창 ${W.length}: CAGR 중앙 ${f1(q(W.map(x=>x.c),.5))} · 하10 ${f1(q(W.map(x=>x.c),.1))} · 최악 ${f1(Math.min(...W.map(x=>x.c)))} · MDD 중앙 ${f1(q(W.map(x=>x.mdd),.5))} · 최악 ${f1(Math.max(...W.map(x=>x.mdd)))} · 보유 중앙 ${f1(q(W.map(x=>x.tin),.5))}% | 그냥 보유 중앙 ${f1(q(W.map(x=>x.bh),.5))} · 최악 ${f1(Math.min(...W.map(x=>x.bh)))} · 로테이션이 높은 창 ${W.filter(x=>x.c>x.bh).length}/${W.length}`); }
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
