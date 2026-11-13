// 운영 메뉴 ASAP 기준선(11-14 · 차례 맨 끝) — backtest.html runASAP(앱 엔진 그대로)을 앱 값(SOXL · base 10 · mid 50 · deep 100 · 비용 켬)으로
// ① 적립(매일 10$ · 하락장엔 리저브(SGOV 이자)에 쌓고 깊은 하락·반등 단계에서 씀) — 돈 가중 연수익(IRR 세전) · 청산세 뺀 IRR(낸 돈 1만$·10만$ 규모로 비례) · 엔진 MDD
//    짝: 같은 종목 그냥 적립(_dcaOne 매일 10$ · 하락 배수 1 · 비용 켬) — 같은 창 IRR 차
// ② 거치(목돈 1만$·10만$ 를 리저브로 시작 · 신규 적립 없음 · 리저브에서만 삼) — 세전 CAGR · 청산세 뺀 CAGR · 엔진 MDD · 짝: 첫날 전부 산 그냥 보유
// 실제 SOXL 2010~ · 합성 SYNSOXL_S 1995~ · 전체 기간 + 5년 창(매달 시작).
// 사용: node asap_base.js [out.json]   env: DS=soxl,soxlsyn
const {open}=require('./imh'); const fs=require('fs');
const OUT=process.argv[2]||'asap_base_out.json', DS=(process.env.DS||'soxl,soxlsyn').split(',');
const SETS={soxl:{sym:'SOXL',file:'SOXL',y0:2010},soxlsyn:{sym:'SOXL',file:'SYNSOXL_S',y0:1995}};
const PAGE=()=>{ const tx=(g,scale)=>g>0?Math.max(0,g*1350-250e4)*0.22/1350:0;
  const irrOf=(cf,fin,t,T)=>{ const f=x=>{ let s=0; for(const [d,a] of cf) s-=a*Math.pow(1+x,-t(d)); return s+fin*Math.pow(1+x,-T); }; let lo=-0.99,hi=5; if(f(lo)*f(hi)>0) return null; for(let k=0;k<100;k++){ const m=(lo+hi)/2; if(f(lo)*f(m)<=0) hi=m; else lo=m; } return (lo+hi)/2*100; };
  window.ASAPRUN=function(tkr,from,to){ const days=Object.keys(M[tkr]).sort().filter(d=>d>=from&&d<=to); const t=d=>(Date.parse(d)-Date.parse(days[0]))/(365.25*864e5), T=t(days[days.length-1]);
    const a=runASAP(days,tkr,{base:10,mid:50,deep:100,costOn:true}), b=_dcaOne(tkr,days,10,'daily',true,1);
    const at=(r,scale)=>{ const k=scale/r.invested, fin=r.final*k, cf=r.cf.map(([d,x])=>[d,x*k]); return irrOf(cf,fin-tx(fin-r.invested*k),t,T); };
    const L=cap=>{ const r=runASAP(days,tkr,{base:10,mid:50,deep:100,costOn:true,startCash:cap}); const c=(Math.pow(r.final/cap,1/T)-1)*100, ca=(Math.pow((r.final-tx(r.final-cap))/cap,1/T)-1)*100; return {c,ca,mdd:r.mdd,res:r.endReserve/r.final,n:r.trades}; };
    const p0=M[tkr][days[0]][C], p1=M[tkr][days[days.length-1]][C];
    return {first:days[0],last:days[days.length-1],T,inv:a.invested,fin:a.final,irr:irrOf(a.cf,a.final,t,T),at1:at(a,1e4),at10:at(a,1e5),mdd:a.mdd,n:a.trades,res:a.endReserve/a.final,
      dIrr:irrOf(b.cf,b.final,t,T),dAt1:at(b,1e4),dMdd:b.mdd,dInv:b.invested,L1:L(1e4),L10:L(1e5),bh:(Math.pow(p1/p0,1/T)-1)*100}; }; };
(async()=>{ const out={sets:{}}; const q=(a,p)=>{ const b=[...a].filter(x=>x!=null).sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f1=x=>x==null?'-':x.toFixed(1);
  for(const ds of DS){ const S=SETS[ds]; const {pg,close}=await open([{sym:S.sym,file:S.file}]); await pg.evaluate(PAGE);
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),S.sym), END=all[all.length-1], F0=all[0];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<F0) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>END) continue; starts.push([s,e]); }
    const full=await pg.evaluate(a=>ASAPRUN(...a),[S.sym,F0,END]); const W=[];
    for(const [s,e] of starts){ const r=await pg.evaluate(a=>ASAPRUN(...a),[S.sym,s,e]); W.push(Object.assign({s},r)); }
    out.sets[ds]={sym:S.sym,file:S.file,full,win:W};
    const dI=W.map(x=>x.irr!=null&&x.dIrr!=null?x.irr-x.dIrr:null).filter(x=>x!=null), h=(fl)=>{ const z=W.filter(fl).map(x=>x.irr-x.dIrr).filter(x=>!isNaN(x)); return f1(q(z,.5)); }, mid=S.y0===2010?'2016-01-01':'2008-01-01';
    console.log(`\n■ ${ds} ${S.file} 전체 ${full.first}~${full.last}: 적립 낸 돈 ${(full.inv/1e3).toFixed(1)}k$ → ${(full.fin/1e3).toFixed(1)}k$ · IRR ${f1(full.irr)} · 청산세 뺀(1만$ 규모) ${f1(full.at1)} · MDD ${f1(full.mdd)} · 끝 리저브 ${(full.res*100).toFixed(0)}% | 그냥 적립 IRR ${f1(full.dIrr)} · MDD ${f1(full.dMdd)} | 거치 1만$ CAGR ${f1(full.L1.c)} (세후 ${f1(full.L1.ca)}) · MDD ${f1(full.L1.mdd)} · 10만$ ${f1(full.L10.c)} · 그냥 보유 ${f1(full.bh)}`);
    console.log(`  5년 창 ${W.length}: 적립 IRR 중앙 ${f1(q(W.map(x=>x.irr),.5))} · 하10 ${f1(q(W.map(x=>x.irr),.1))} · 최악 ${f1(Math.min(...W.map(x=>x.irr??99)))} · 청산세 뺀(1만$) 중앙 ${f1(q(W.map(x=>x.at1),.5))} · (10만$) ${f1(q(W.map(x=>x.at10),.5))} · MDD 중앙 ${f1(q(W.map(x=>x.mdd),.5))} · 최악 ${f1(Math.max(...W.map(x=>x.mdd)))} · 매수 ${f1(q(W.map(x=>x.n/x.T),.5))}회/년`
      +` | 그냥 적립 대비 IRR 짝 차 중앙 ${f1(q(dI,.5))} · 나은 창 ${(dI.filter(x=>x>0).length/dI.length*100).toFixed(0)}% · 앞/뒤 ${h(x=>x.s<mid)}/${h(x=>x.s>=mid)} · 그냥 적립 IRR 중앙 ${f1(q(W.map(x=>x.dIrr),.5))} · MDD 중앙 ${f1(q(W.map(x=>x.dMdd),.5))}`);
    console.log(`  거치 1만$: CAGR 중앙 ${f1(q(W.map(x=>x.L1.c),.5))} · 세후 ${f1(q(W.map(x=>x.L1.ca),.5))} · 최악 ${f1(Math.min(...W.map(x=>x.L1.c)))} · MDD 중앙 ${f1(q(W.map(x=>x.L1.mdd),.5))} · 최악 ${f1(Math.max(...W.map(x=>x.L1.mdd)))} · 끝 리저브 중앙 ${f1(q(W.map(x=>x.L1.res*100),.5))}% | 10만$ CAGR 중앙 ${f1(q(W.map(x=>x.L10.c),.5))} · 세후 ${f1(q(W.map(x=>x.L10.ca),.5))} | 그냥 보유 CAGR 중앙 ${f1(q(W.map(x=>x.bh),.5))} · 최악 ${f1(Math.min(...W.map(x=>x.bh)))}`);
    await close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
