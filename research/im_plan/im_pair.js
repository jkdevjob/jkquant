// 무매 잡음 바닥 + 짝지은 창 비교 — 실제 SOXL(2010-03~ · 5년 창 매월) · 합성 SYNSOXL_S(1994-05~ · 창 1995~) · 1만$·10만$
// ① 잡음: 같은 규칙을 원금만 ×1.0003·×1.001·×1.003·×1.01 로 바꿔 돌린다 — 규칙 차이가 아니라 정수 주·사이클 시점이 바뀌어 생기는 흔들림.
// ② 짝: 같은 5년 창에서 후보와 기준을 비교 — 둘 다 나은 창 · CAGR 높은/낮은 창 · MDD 낮은/높은 창 · 차이 중앙(하10·상10).
//    잡음 짝(원금만 바꾼 같은 규칙)과 나란히 보면, 후보의 '이긴 창 비율'이 잡음보다 큰지 바로 보인다.
// 사용: node im_pair.js            (짝 목록은 아래 PAIRS · 변형은 grid1 과 같은 이름)
//       PAIRS='기준:후보,기준:후보@1.003' node im_pair.js   — 짝을 바꿔서(@배수 = 원금만 바꾼 잡음 짝). 변형 값이 함수면 종목(TK)에 맞춰 만든다.
//       LABS='실제TQQQ:TQQQ:2010,합성TQQQ:SYNTQQQ_S:1990' — 다른 기초자산으로(이름:종목:창 시작 해)
// 점수: 창마다 둘 다 나음 +1 · 둘 다 나쁨 −1 · 그 밖 0 의 평균 — 이어진 12창(1년치 시작) 묶음 부트스트랩 2,000번으로 5~95% 구간(창이 겹쳐서 묶음으로 뽑는다).
const {open,stats}=require('./imh'); const fs=require('fs');
const V={ base:{}, autoNoY:{autoTp:true}, autoTp:{cashYield:true,autoTp:true}, m1age20:{cashYield:true,autoTp:true,m1:{maxAge:20}}, aNoM1:{cashYield:true,autoTp:true,auto:{M:{below:99}}},
  rp50:{autoTp:true,cashYield:true,cashSpread:0.005}, rp100:{autoTp:true,cashYield:true,cashSpread:0.01}, rpW5:{autoTp:true,sgov:{mode:'week',k:5,fee:0,spread:0.005}},
  aNoWeak:{cashYield:true,autoTp:true,auto:{noWeak:true}}, aNoHot:{cashYield:true,autoTp:true,auto:{A:{retHi:1e9}}}, aMma100:{cashYield:true,autoTp:true,auto:{M:{maLen:100}}}, aMma200:{cashYield:true,autoTp:true,auto:{M:{maLen:200}}},
  aGTp:TK=>({autoTp:true,sig:{guard:{tp:10,sym:TK.startsWith('SYN')?'SYNTQQQ':'TQQQ'}}}),
  // weak 빼기의 주변(10-28): M1 설정을 바꾼 기준마다 weak 를 빼 본다 · weak 이평 100/200 · 이자 없는 앱 조건
  aM05:{cashYield:true,autoTp:true,auto:{M:{below:0.05}}}, aM15:{cashYield:true,autoTp:true,auto:{M:{below:0.15}}},
  nwM05:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{below:0.05}}}, nwM15:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{below:0.15}}},
  nwMma100:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{maLen:100}}}, nwMma200:{cashYield:true,autoTp:true,auto:{noWeak:true,M:{maLen:200}}},
  nwNoHot:{cashYield:true,autoTp:true,auto:{noWeak:true,A:{retHi:1e9}}}, nwNoY:{autoTp:true,auto:{noWeak:true}},
  aMa100:{cashYield:true,autoTp:true,auto:{A:{maLen:100}}}, aMa200:{cashYield:true,autoTp:true,auto:{A:{maLen:200}}}, aLo15:{cashYield:true,autoTp:true,auto:{A:{lo:15}}},
  // 기본 조건 주변(10-30): 큰수 · 하방 LOC 줄 수 · 분할 — 익절 자동 · 이자 없음(앱 조건) 위에서
  aBig10:{autoTp:true,big:10}, aBig15:{autoTp:true,big:15}, aBig25:{autoTp:true,big:25}, aBig30:{autoTp:true,big:30},
  aRows0:{autoTp:true,rows:0}, aRows2:{autoTp:true,rows:2}, aRows4:{autoTp:true,rows:4}, aRows5:{autoTp:true,rows:5},
  aDiv18:{autoTp:true,divs:18}, aDiv22:{autoTp:true,divs:22},
  // 연속 하락일에만 새 사이클(10-31 사용자 질문): 큰수 0.01% = 전일 종가 LOC(그날 하락해야 체결) · dnGate = 전일까지 연속 하락 조건
  aDn1:{autoTp:true,big:0.01}, aDn2:{autoTp:true,big:0.01,sig:{dnGate:2}}, aDn3:{autoTp:true,big:0.01,sig:{dnGate:3}}, aBig1:{autoTp:true,big:1} };
const MULT=[1.0003,1.001,1.003,1.01];
const PAIRS=process.env.PAIRS?process.env.PAIRS.split(',').map(x=>x.split(':')):[].concat(MULT.map(m=>['base','base@'+m]), MULT.map(m=>['autoNoY','autoNoY@'+m]),
  [['autoTp','m1age20'],['autoTp','aNoM1'],['autoNoY','autoTp'],['autoNoY','rp50'],['autoNoY','rp100'],['autoNoY','rpW5']]);
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=x=>x.toFixed(1);
const LABS=(process.env.LABS||'실제:SOXL:2010,합성:SYNSOXL_S:1995').split(',').map(x=>{ const [a,b,c]=x.split(':'); return [a,b,+c]; });
function boot(sc,L=12,B=2000){ let z=12345; const rnd=()=>{ z=(z*1103515245+12345)%2147483648; return z/2147483648; }; const n=sc.length, m=[];
  for(let b=0;b<B;b++){ let t=0,c=0; while(c<n){ const st=Math.floor(rnd()*(n-L+1)); for(let i=0;i<L&&c<n;i++,c++) t+=sc[st+i]; } m.push(t/n); }
  m.sort((x,y)=>x-y); return [m[Math.floor(.05*B)],m[Math.floor(.95*B)]]; }
(async()=>{ const {pg,close}=await open([...new Set(['SOXL','SYNSOXL_S','TQQQ','SYNTQQQ'].concat(LABS.map(x=>x[1])))].map(sym=>({sym})));
  const irx={}; require('./data/IRX.json').series.forEach(x=>irx[x.date]=x.close); await pg.evaluate(x=>{window.__IRX=x;},irx);
  const out={};
  for(const [lab,TK,Y0] of LABS){
    const all=await pg.evaluate(t=>Object.keys(M[t]).sort(),TK); const starts=[];
    for(let y=Y0;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(s<all[20]||e>all[all.length-1]) continue; starts.push([s,e]); }
    for(const cap0 of [10000,100000]){ const C={};
      const get=async key=>{ if(C[key]) return C[key]; const [k,ms]=key.split('@'), cap=cap0*(+ms||1), o=typeof V[k]==='function'?V[k](TK):V[k];
        const full=stats(await pg.evaluate(o=>RUN(o),Object.assign({cap,from:all[0],tkr:TK},o)),cap); const w=[];
        for(const [s,e] of starts) w.push(stats(await pg.evaluate(o=>RUN(o),Object.assign({cap,from:s,to:e,tkr:TK},o)),cap));
        return C[key]={full,w}; };
      console.log(`\n■ ${lab} ${cap0/1e4}만$ — 창 ${starts.length}개`);
      for(const [a,b] of PAIRS){ const A=await get(a), B=await get(b); const dc=B.w.map((x,i)=>x.cagr-A.w[i].cagr), dm=B.w.map((x,i)=>x.mdd-A.w[i].mdd), e=0.05;
        const sc=dc.map((x,i)=>(x>=-e&&dm[i]<=e&&(x>e||dm[i]<-e))?1:(x<=e&&dm[i]>=-e&&(x<-e||dm[i]>e))?-1:0), both=sc.filter(x=>x>0).length, worse=sc.filter(x=>x<0).length, ci=boot(sc);
        const r={both,worse,cUp:dc.filter(x=>x>e).length,cDn:dc.filter(x=>x<-e).length,mDn:dm.filter(x=>x<-e).length,mUp:dm.filter(x=>x>e).length,
          dcMed:q(dc,.5),dc10:q(dc,.1),dc90:q(dc,.9),dmMed:q(dm,.5),dm10:q(dm,.1),dm90:q(dm,.9),score:(both-worse)/sc.length,ci,
          fullA:A.full,fullB:B.full,medA:[q(A.w.map(x=>x.cagr),.5),q(A.w.map(x=>x.mdd),.5)],medB:[q(B.w.map(x=>x.cagr),.5),q(B.w.map(x=>x.mdd),.5)]};
        (out[lab+cap0]=out[lab+cap0]||{})[a+'|'+b]=r;
        console.log(`  ${(b+' vs '+a).padEnd(26)} 전체 ${f(r.fullA.cagr)}/${f(r.fullA.mdd)} → ${f(r.fullB.cagr)}/${f(r.fullB.mdd)} · 롤링 중앙 ${f(r.medA[0])}/${f(r.medA[1])} → ${f(r.medB[0])}/${f(r.medB[1])} | 둘 다 나음 ${both} 둘 다 나쁨 ${worse} (점수 ${r.score.toFixed(2)} · ${r.ci[0].toFixed(2)}~${r.ci[1].toFixed(2)}) · CAGR ↑${r.cUp} ↓${r.cDn} · MDD ↓${r.mDn} ↑${r.mUp} | 차이 CAGR ${f(r.dcMed)} (${f(r.dc10)}~${f(r.dc90)}) · MDD ${f(r.dmMed)} (${f(r.dm10)}~${f(r.dm90)})`); } } }
  fs.writeFileSync(process.env.OUT||'im_pair_out.json',JSON.stringify(out)); await close(); })().catch(e=>{console.error(e);process.exit(1);});
