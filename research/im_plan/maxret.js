// 무매 수익 극대화 후보 판정(11-09 · 사용자 "매일 규칙을 개선해서 수익률을 극대화할 방법을 연구하라")
// 앱 조건(익절 자동 · 이자 없음 · SOXL 20분할 복리 리버스 OFF 큰수 20 · 하방 3줄 · 수수료·양도세) 위에 VARS 변형을 얹고
// 실제 SOXL 2010~ · 합성 SYNSOXL_S 1995~ × 1만$·10만$ × 원금 ×JIT 벌(사이클 시점 잡음 평균) — 전체 기간 + 5년 창(매달 시작) 짝 비교.
// 실행: node maxret.js [out.json]   → node maxret_sum.js [out.json]
//   env: VARS='{"이름":{옵션}}'(안 주면 아래 기본 묶음) DS=real,syn CAPS=10000,100000 JIT=0.99,1,1.01 W=4
// 특수 옵션(페이지 안에서 처리 · 돌린 뒤 원래대로):
//   tgtDyn:{L,th,mult,cap} — 앱 백테스트의 '익절 동적 조절'(imTgtDyn · 전일까지 L일 상승률 > th% 면 그날 익절 % × mult, 최대 cap) 과 그 주변값
//   floor:true — 바닥선(imh o.floor): 올린 익절 동안 원래 익절선을 고가로 넘었다가 종가가 그 아래면 다음 날 시가에 익절분(3/4) 매도
//   sleeve:{real,syn,k,mode,fee,tax} — 잔금 중 k×1회분(자산/20)을 넘는 몫을 1배 지수에(imh sgov.sym · 전일 확정 수익률 · 옮길 때 수수료 · tax 면 양도세 장부에)
const {open}=require('./imh'); const fs=require('fs');
const DEF={ base:{},
  dyn:{tgtDyn:{L:20,th:8,mult:2,cap:30}},
  dyn_th5:{tgtDyn:{L:20,th:5,mult:2,cap:30}}, dyn_th12:{tgtDyn:{L:20,th:12,mult:2,cap:30}},
  dyn_cap25:{tgtDyn:{L:20,th:8,mult:2,cap:25}}, dyn_cap40:{tgtDyn:{L:20,th:8,mult:2,cap:40}}, dyn_m15:{tgtDyn:{L:20,th:8,mult:1.5,cap:30}},
  dyn_L10:{tgtDyn:{L:10,th:8,mult:2,cap:30}}, dyn_L40:{tgtDyn:{L:40,th:8,mult:2,cap:30}},
  sl_soxx10:{sleeve:{real:'SOXX',syn:'SOX',k:10,mode:'week',tax:true}}, sl_soxx5:{sleeve:{real:'SOXX',syn:'SOX',k:5,mode:'week',tax:true}},
  sl_soxx2:{sleeve:{real:'SOXX',syn:'SOX',k:2,mode:'week',tax:true}}, sl_qqq5:{sleeve:{real:'QQQ',syn:'NDX',k:5,mode:'week',tax:true}} };
const VARS=process.env.VARS?Object.assign({base:{}},JSON.parse(process.env.VARS)):DEF;
const DS=(process.env.DS||'real,syn').split(','), CAPS=(process.env.CAPS||'10000,100000').split(',').map(Number), JIT=(process.env.JIT||'0.99,1,1.01').split(',').map(Number);
const W=+(process.env.W||4), OUT=process.argv[2]||'maxret_out.json';
const SETS={ real:{tk:'SOXL',y0:2010,syms:[{sym:'SOXL'},{sym:'SOXX'},{sym:'QQQ'}]}, syn:{tk:'SYNSOXL_S',y0:1995,syms:[{sym:'SYNSOXL_S'},{sym:'SOX',file:'SOX'},{sym:'NDX',file:'NDX'}]},
  tq:{tk:'TQQQ',y0:2010,syms:[{sym:'TQQQ'},{sym:'QQQ'}]}, tqsyn:{tk:'SYNTQQQ_S',y0:1990,syms:[{sym:'SYNTQQQ_S'},{sym:'NDX',file:'NDX'}]} };   // tq·tqsyn: 다른 기초자산(나스닥 3배)으로 표본 밖 검사 — sleeve 는 real:'QQQ' 처럼 ds 이름으로
const PAGE_RUN=()=>{ window.RUN2=function(o){
  const x=Object.assign({},o); delete x.tgtDyn; delete x.sleeve;
  if(o.sleeve){ const s=o.sleeve; x.sgov={sym:s[o.ds],k:s.k||10,mode:s.mode||'week',fee:s.fee!=null?s.fee:0.0026,tax:!!s.tax}; }
  if(o.tgtDyn){ const g=o.tgtDyn; window.__mom0=window.__mom0||_imMom; window.__tgt0=window.__tgt0||_imTgtOf;
    _imMom=function(t,L){ return window.__mom0(t,g.L||L); }; _imTgtOf=function(b,m){ return (m!=null&&m>g.th)?Math.min(b*g.mult,g.cap):b; }; imTgtDyn=true; }
  let r; try{ r=RUN(x); } finally { if(o.tgtDyn){ imTgtDyn=false; _imMom=window.__mom0; _imTgtOf=window.__tgt0; } }
  const yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5), cagr=(Math.pow(Math.max(r.final,1e-9)/o.cap,1/yrs)-1)*100;
  let pk=0,mdd=0,pd=null,mP=null,mT=null; for(const [d,e] of r.eqs){ if(e>pk){pk=e;pd=d;} else { const dd=(pk-e)/pk; if(dd>mdd){mdd=dd;mP=pd;mT=d;} } } if(r.final<pk&&(pk-r.final)/pk>mdd){ mdd=(pk-r.final)/pk; mP=pd; mT=r.last; }
  return {cagr,mdd:mdd*100,final:r.final,cycles:r.cycles,sg:r.sg,mP,mT,flr:r.flrN}; }; };   // mP·mT: 최대 낙폭의 고점·바닥 날짜
(async()=>{ const out={VARS,DS,CAPS,JIT,sets:{}};
  for(const ds of DS){ const S=SETS[ds]; const pages=[]; for(let w=0;w<W;w++){ const p=await open(S.syms); await p.pg.evaluate(PAGE_RUN); pages.push(p); }
    const all=await pages[0].pg.evaluate(t=>Object.keys(M[t]).sort(),S.tk), F0=all[0];
    const starts=[]; for(let y=S.y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<all[20]) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>all[all.length-1]) continue; starts.push([s,e]); }
    const jobs=[]; for(const cap of CAPS) for(const v of Object.keys(VARS)) for(const j of JIT) jobs.push({cap,v,j});
    const res=[]; const t0=Date.now();
    await Promise.all(pages.map(async({pg})=>{ while(jobs.length){ const jb=jobs.shift(); const capRun=jb.cap*jb.j;
      const base=Object.assign({autoTp:true,tkr:S.tk,cap:capRun,ds},VARS[jb.v]);
      const f=await pg.evaluate(o=>RUN2(o),Object.assign({from:F0},base)); const win=[];
      for(const [s,e] of starts){ const r=await pg.evaluate(o=>RUN2(o),Object.assign({from:s,to:e},base)); win.push([r.cagr,r.mdd]); }
      res.push({cap:jb.cap,v:jb.v,j:jb.j,full:{cagr:f.cagr,mdd:f.mdd,cycles:f.cycles,final:f.final/jb.j,sg:f.sg,mP:f.mP,mT:f.mT,flr:f.flr},win}); process.stderr.write('.'); } }));
    out.sets[ds]={tk:S.tk,first:F0,last:all[all.length-1],starts,res}; console.error(`\n${ds}: ${res.length} 벌 · 창 ${starts.length} · ${((Date.now()-t0)/1000).toFixed(0)}s`);
    for(const p of pages) await p.close(); }
  fs.writeFileSync(OUT,JSON.stringify(out)); console.error('→ '+OUT); })().catch(e=>{console.error(e);process.exit(1);});
