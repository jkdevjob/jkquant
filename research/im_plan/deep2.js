// deep2.js — '빨리 많이' 심층 2 (11-07): T 연말 세금 최적화(px harvest) · U 물밑 기간 · M 블록 부트스트랩 몬테카를로(5년 결과 분포·꼬리) · S 슬리브 종목(SOXL)
// 사용: node deep2.js [T,U,M,S]   앱 조건(수수료 0.1% · 양도세 22% 연 정산 · 전일 신호 → 당일 종가 체결)
const {prep,sim,stats,q}=require('./px'); const {mk}=require('./plan_rules');
const CUR={gsb:1e9,fee:0.001}, NEW={gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}, AGG={...NEW,s0:.60};
const SEC=process.argv[2]?process.argv[2].split(','):['T','U','M','S'];
const f=x=>x.toFixed(1), f2=x=>x.toFixed(2), sg=x=>(x>0?'+':'')+f(x);
const real=prep(['TECL','TQQQ']), syn=prep(['SYNTECL','SYNTQQQ']);
const run=(P,R,G,p,cap,o2)=>sim(P,Object.assign({cap,fee:p.fee},mk(P,R,G,p),P===syn?{frac:true}:{},o2||{}));
const V={'지금 앱':CUR,'새 규칙':NEW,'공격형(s0 .60)':AGG};
const wins=(P,R,G,p,cap,o2)=>{ const out=[], last=P.dates[P.dates.length-1]; for(let y=2011;y<=2021;y++) for(let m=1;m<=12;m++){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue; out.push(stats(run(P,R,G,p,cap,Object.assign({from:s,to:e},o2||{})).eq,cap)); } return out; };

if(SEC.includes('T')){ console.log('\n■ T. 연말 세금 최적화 — 실현손익을 250만원 공제에 맞춤(공제 미달 → 평가이익 팔고 바로 되사기 · 공제 초과 → 평가손실 팔고 되사기 · 수수료 0.1%×2 · 손실 이월 없음 가정) · 실제 2011~ · 세후');
  for(const cap of [1e4,3e4,1e5]) for(const [nm,p] of Object.entries(V)){ const a=stats(run(real,'TECL','TQQQ',p,cap,{from:'2011-01-01'}).eq,cap); const row=[`${nm} ${cap/1e4}만$: 기본 ${f(a.cagr)}/${f(a.mdd)} ×${f(a.fin/cap)}`];
    for(const [hn,H] of [['공제 채우기만',{gain:true,loss:false}],['손실 상계만',{gain:false,loss:true}],['둘 다',{gain:true,loss:true}]]){ const hlog=[]; const r=run(real,'TECL','TQQQ',p,cap,{from:'2011-01-01',harvest:H,hlog}); const s=stats(r.eq,cap); const gH=hlog.reduce((x,y)=>x+y[1],0), lH=hlog.reduce((x,y)=>x+y[2],0), yrs=hlog.filter(x=>x[1]>0||x[2]>0).length;
      row.push(`${hn} ${f(s.cagr)}/${f(s.mdd)} ×${f(s.fin/cap)} (${sg(s.cagr-a.cagr)}%p · 이익 실현 ${Math.round(gH)}$ · 손실 상계 ${Math.round(lH)}$ · ${yrs}해)`); }
    console.log('  '+row.join(' | ')); }
  for(const cap of [1e4,1e5]){ const wb=wins(real,'TECL','TQQQ',NEW,cap), wh=wins(real,'TECL','TQQQ',NEW,cap,{harvest:{gain:true,loss:true}}); const dc=wh.map((x,i)=>x.cagr-wb[i].cagr);
    console.log(`  새 규칙 ${cap/1e4}만$ 5년 창 131개: 둘 다 적용 ΔCAGR 중앙 ${sg(q(dc,.5))} · 하10 ${sg(q(dc,.1))} · 상90 ${sg(q(dc,.9))} · 좋아진 창 ${dc.filter(x=>x>0.05).length} · 나빠진 창 ${dc.filter(x=>x<-0.05).length}`); }
  for(const cap of [1e4,1e5]){ const a=stats(run(real,'TECL','TQQQ',NEW,cap,{from:'2011-01-01',tax:false}).eq,cap); console.log(`  (참고) 새 규칙 ${cap/1e4}만$ 세금 없음(비과세 상한): ${f(a.cagr)} ×${f(a.fin/cap)}`); } }

function underwater(eq){ let pk=eq[0][1],pkD=eq[0][0]; const per=[]; let cur=null; for(const [d,v] of eq){ if(v>=pk){ if(cur){cur.end=d;cur.days=(Date.parse(d)-Date.parse(cur.start))/864e5;per.push(cur);cur=null;} pk=v;pkD=d; } else { if(!cur) cur={start:pkD,dd:0}; cur.dd=Math.max(cur.dd,(pk-v)/pk); } } if(cur){cur.end=null;cur.days=(Date.parse(eq[eq.length-1][0])-Date.parse(cur.start))/864e5;cur.open=true;per.push(cur);} return per; }
if(SEC.includes('U')){ console.log('\n■ U. 물밑 기간 — 전고점 아래 머문 시간(10% 넘게 빠진 구간만 · 실제 2011~ 1만$ · 끝날 세금 안 뺀 곡선)');
  for(const [nm,p] of Object.entries({...V,'s0 .65':{...NEW,s0:.65},'변동성 무시(w=1)':{...NEW,s0:9}})){ const eq=run(real,'TECL','TQQQ',p,1e4,{from:'2011-01-01',endTax:false}).eq, per=underwater(eq).filter(x=>x.dd>=0.10).sort((a,b)=>b.days-a.days);
    const yr=d=>(d/365.25).toFixed(1), span=(Date.parse(eq[eq.length-1][0])-Date.parse(eq[0][0]))/864e5, tot=per.reduce((a,x)=>a+x.days,0)/span;
    console.log(`  ${nm}: ${per.length}번 · 1년 넘는 것 ${per.filter(x=>x.days>365).length}번 · 2년 넘는 것 ${per.filter(x=>x.days>730).length}번 · 가장 긴 ${yr(per[0].days)}년(${per[0].start}→${per[0].end||'진행 중'} · 낙폭 ${f(per[0].dd*100)}) · 둘째 ${per[1]?yr(per[1].days)+'년('+per[1].start+' · 낙폭 '+f(per[1].dd*100)+')':'-'} · 물밑에 있던 시간 ${(tot*100).toFixed(0)}%`); } }

function boot(P,R,G,from,n,L,years,seed){ const i0=P.dates.findIndex(d=>d>=from), rT=[],rG=[],ir=[]; let last=0; for(let k=i0+1;k<P.dates.length;k++){ rT.push(P.C[R][k]/P.C[R][k-1]); rG.push(P.C[G][k]/P.C[G][k-1]); if(P.irx[P.dates[k]]!=null) last=P.irx[P.dates[k]]; ir.push(last); }
  const N=rT.length, len=Math.round(252*years); let s=seed; const rnd=()=>{ s=(s*1103515245+12345)&0x7fffffff; return s/0x7fffffff; };
  const dates=P.dates.slice(i0,i0+len+1); const paths=[]; for(let p=0;p<n;p++){ const T=[100],Gp=[100],irx={[dates[0]]:ir[0]}; let c=0; while(c<len){ const st=Math.floor(rnd()*N); for(let t=0;t<L&&c<len;t++,c++){ const j=(st+t)%N; T.push(T[T.length-1]*rT[j]); Gp.push(Gp[Gp.length-1]*rG[j]); irx[dates[c+1]]=ir[j]; } } paths.push({dates,C:{[R]:T,[G]:Gp},irx,syms:[R,G]}); } return paths; }
if(SEC.includes('M')){ const NP=400, L=63, YRS=6;
  for(const [lab,P,R,G,from] of [['실제 2011~ 풀',real,'TECL','TQQQ','2011-01-01'],['합성 2000~ 풀(닷컴·금융위기 포함)',syn,'SYNTECL','SYNTQQQ','2000-01-01']]){
    const paths=boot(P,R,G,from,NP,L,YRS,20261107); const t0=paths[0].dates[252];
    console.log(`\n■ M. 블록 부트스트랩 몬테카를로 — ${lab} · 일수익 ${L}일 블록 · ${NP}경로 × 5년(1년 예열) · 1만$ · 소수 주 · 세후`);
    console.log('  변형 | 5년 배수 중앙 · 하10 · 하5 · 하1 · 최악 | MDD 중앙 · 상90 · 상99 | P(배수<1) · P(<0.5) · P(MDD>50) · P(MDD>70)');
    for(const [nm,p] of [['지금 앱',CUR],['새 규칙',NEW],['공격형(s0 .60)',AGG],['s0 .65',{...NEW,s0:.65}],['변동성 무시(w=1)',{...NEW,s0:9}]]){ const M=[],D=[];
      for(const Q of paths){ const o=Object.assign({cap:1e4,fee:p.fee,frac:true},mk(Q,R,G,p),{from:t0}); const st=stats(sim(Q,o).eq,1e4); M.push(st.fin/1e4); D.push(st.mdd); }
      console.log(`  ${nm.padEnd(16)} | ×${f2(q(M,.5))} · ×${f2(q(M,.1))} · ×${f2(q(M,.05))} · ×${f2(q(M,.01))} · ×${f2(Math.min(...M))} | ${f(q(D,.5))} · ${f(q(D,.9))} · ${f(q(D,.99))} | ${(M.filter(x=>x<1).length/NP*100).toFixed(0)}% · ${(M.filter(x=>x<.5).length/NP*100).toFixed(0)}% · ${(D.filter(x=>x>50).length/NP*100).toFixed(0)}% · ${(D.filter(x=>x>70).length/NP*100).toFixed(0)}%`); }
    { const M=[],D=[]; for(const Q of paths){ const a=Q.C[R].slice(252); M.push(a[a.length-1]/a[0]); let pk=0,m=0; for(const v of a){ pk=Math.max(pk,v); m=Math.max(m,(pk-v)/pk); } D.push(m*100); }
      console.log(`  ${'TECL 보유(세전)'.padEnd(16)} | ×${f2(q(M,.5))} · ×${f2(q(M,.1))} · ×${f2(q(M,.05))} · ×${f2(q(M,.01))} · ×${f2(Math.min(...M))} | ${f(q(D,.5))} · ${f(q(D,.9))} · ${f(q(D,.99))} | ${(M.filter(x=>x<1).length/NP*100).toFixed(0)}% · ${(M.filter(x=>x<.5).length/NP*100).toFixed(0)}% · ${(D.filter(x=>x>50).length/NP*100).toFixed(0)}% · ${(D.filter(x=>x>70).length/NP*100).toFixed(0)}%`); } } }

if(SEC.includes('S')){ console.log('\n■ S. 슬리브 종목 — TECL 대신 SOXL(반도체 3배) · 새 규칙 · 1만$ (SOXL 은 2010-03 상장 → 예열 뒤 2011-02 시작)');
  const Pr=prep(['SOXL','TQQQ']), Ps=prep(['SYNSOXL_S','SYNTQQQ']);
  for(const [nm,p] of [['TECL(기준)',NEW],['SOXL',NEW],['SOXL s0 .65',{...NEW,s0:.65}],['SOXL s0 .75',{...NEW,s0:.75}],['SOXL s0 .85',{...NEW,s0:.85}]]){ const useS=nm.startsWith('SOXL'); const P=useS?Pr:real, R=useS?'SOXL':'TECL';
    const a=stats(sim(P,Object.assign({cap:1e4,fee:.001},mk(P,R,'TQQQ',p),{from:'2011-01-01'})).eq,1e4), W=[]; for(let y=2011;y<=2021;y++)for(let m=1;m<=12;m++){const s=`${y}-${String(m).padStart(2,'0')}-01`,e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>P.dates[P.dates.length-1]) continue; W.push(stats(sim(P,Object.assign({cap:1e4,fee:.001},mk(P,R,'TQQQ',p),{from:s,to:e})).eq,1e4));}
    const PS=useS?Ps:syn, RS=useS?'SYNSOXL_S':'SYNTECL'; const b=stats(sim(PS,Object.assign({cap:1e4,fee:.001,frac:true},mk(PS,RS,'SYNTQQQ',p),{from:'2000-01-01'})).eq,1e4), b2=stats(sim(PS,Object.assign({cap:1e4,fee:.001,frac:true},mk(PS,RS,'SYNTQQQ',p),{from:'2010-01-01'})).eq,1e4);
    console.log(`  ${nm}: 실제 ${f(a.cagr)}/${f(a.mdd)} ×${f(a.fin/1e4)} · 5년 롤링 중앙 ${f(q(W.map(x=>x.cagr),.5))}/${f(q(W.map(x=>x.mdd),.5))} 하10 ${f(q(W.map(x=>x.cagr),.1))} 최악MDD ${f(Math.max(...W.map(x=>x.mdd)))} · 합성 2000~ ${f(b.cagr)}/${f(b.mdd)} · 합성 2010~ ${f(b2.cagr)}/${f(b2.mdd)}`); } }
