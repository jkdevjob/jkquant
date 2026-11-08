// 무매 원금 크기 효과(11-09) — 같은 규칙(익절 자동 · 이자 없음 · SOXL 20분할 복리 리버스 OFF 큰수 20 · 하방 LOC 3줄)을
// 3천 ~ 30만$ 로 돌려, 정수 주(앱 그대로)와 소수 주를 같은 창에서 비교한다.
//   모드 Ir3 : 정수 주 · 공제 250만원(앱 그대로) · 하방 3줄
//        I03 : 정수 주 · 공제 0(세금 22% 비례 — 사람 단위 공제를 플랜·다른 계좌가 먼저 쓴다고 볼 때) · 하방 3줄
//        I00 : 정수 주 · 공제 0 · 하방 0줄(하방 1주 줄의 몫을 떼어 본다)
//        Fr  : 소수 주 근사 — 원금 ×K 로 돌리고 공제도 ×K, 결과는 ÷K (하방 1주 줄은 1/K 주라 사라진다)
//        F0  : 소수 주 근사 · 공제 0 — 원금과 무관한 '크기 없는' 기준
//   정수 모드는 원금 ×JIT 다섯 벌(사이클 시점 잡음 · 10-27 잡음 바닥)을 창마다 평균한다.
//   capGainTax 만 페이지 안에서 감싼다(__ded 가 null 이면 원래 함수 그대로 — 앱 값과 센트까지 같음 확인).
// 실행: node capsize.js [out.json]   env: TK=SOXL Y0=2010 CAPS=3000,6000,… JIT=0.98,… MODES=Ir3,I03,I00,Fr,F0 W=3(병렬 브라우저)
const {open}=require('./imh'); const fs=require('fs');
const TK=process.env.TK||'SOXL', Y0=+(process.env.Y0||2010), K=1000, DED=2.5e6;
const CAPS=(process.env.CAPS||'3000,6000,10000,30000,100000,300000').split(',').map(Number);
const JIT=(process.env.JIT||'0.98,0.99,1,1.01,1.02').split(',').map(Number);
const MODES=(process.env.MODES||'Ir3,I03,I00,Fr,F0').split(',');
const W=+(process.env.W||3), OUT=process.argv[2]||'capsize_out.json';
const jobs=[];
for(const cap of CAPS) for(const mode of MODES){ const frac=mode[0]==='F', real=mode[1]==='r', rows=mode.length>2?+mode[2]:3;
  for(const j of (frac?[1]:JIT)) jobs.push({mode,cap,j,capRun:frac?cap*K:cap*j,ded:real?(frac?DED*K:null):0,rows,trace:mode==='Ir3'&&j===1}); }
async function worker(pg,starts,F0,res){
  while(jobs.length){ const jb=jobs.shift();
    // 통계는 페이지 안에서(imh stats 와 같은 식) — 일별 자산 배열을 Node 로 옮기지 않아 브라우저 여러 개가 실제로 나란히 돈다
    const run=async(o)=>{ await pg.evaluate(x=>{window.__ded=x;},jb.ded); return pg.evaluate(o=>{ const r=RUN(o);
      const yrs=(Date.parse(r.last)-Date.parse(r.first))/(365.25*864e5), cagr=(Math.pow(r.final/o.cap,1/yrs)-1)*100;
      let pk=0,mdd=0; for(const [,e] of r.eqs){ if(e>pk)pk=e; else mdd=Math.max(mdd,(pk-e)/pk); } if(r.final<pk) mdd=Math.max(mdd,(pk-r.final)/pk);
      const out={cagr,mdd:mdd*100,final:r.final,cycles:r.cycles,tax:r.tax,q:null};
      if(o.trace){ // 사이클 시작일 아침의 1회매수금 ÷ 전일 종가(= 1회매수금이 몇 주인가)
        const tr=r.trace.tr, idx={}; tr.forEach((x,k)=>idx[x[0]]=k); const q=[];
        for(const [d] of r.trace.cyc){ const k=idx[d]; if(k>0){ const p=tr[k-1]; q.push(p[2]/20/p[1]); } }
        out.q=q; }
      return out; },o); };
    const base={autoTp:true,tkr:TK,cap:jb.capRun,rows:jb.rows};
    const sf=await run(Object.assign({from:F0,trace:jb.trace},base));
    const win=[]; for(const [s,e] of starts){ const st=await run(Object.assign({from:s,to:e},base)); win.push([st.cagr,st.mdd]); }
    res.push(Object.assign({},jb,{full:{cagr:sf.cagr,mdd:sf.mdd,cycles:sf.cycles,final:sf.final*(jb.cap/jb.capRun),tax:sf.tax*(jb.cap/jb.capRun)},win,q:sf.q}));
    process.stderr.write('.'); }
}
(async()=>{ const pages=[]; for(let w=0;w<W;w++) pages.push(await open([{sym:TK}]));
  for(const {pg} of pages) await pg.evaluate(()=>{ window.__cgt0=window.__cgt0||capGainTax; window.__ded=null;
    capGainTax=function(p,t){ if(window.__ded==null) return window.__cgt0(p,t); const C=costOf(t); if(!(p>0)||!C.taxRate) return 0; return Math.max(0,p*C.krw-window.__ded)*C.taxRate/C.krw; }; });
  const all=await pages[0].pg.evaluate(t=>Object.keys(M[t]).sort(),TK), F0=all[0];
  const starts=[]; for(let y=Y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`; if(s<all[20]) continue; const e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>all[all.length-1]) continue; starts.push([s,e]); }
  const res=[]; const t0=Date.now();
  await Promise.all(pages.map(({pg})=>worker(pg,starts,F0,res)));
  fs.writeFileSync(OUT,JSON.stringify({TK,Y0,K,CAPS,JIT,MODES,first:F0,last:all[all.length-1],starts,res}));
  console.error(`\n${res.length} jobs · ${starts.length} 창 · ${((Date.now()-t0)/1000).toFixed(0)}s → ${OUT}`);
  for(const p of pages) await p.close(); })().catch(e=>{console.error(e);process.exit(1);});
