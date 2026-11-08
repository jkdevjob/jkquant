// capsize.js 결과 요약 — node capsize_sum.js [capsize_out.json]
// 정수 모드는 원금 ×JIT 벌을 창마다 평균한 값 · 짝 비교는 같은 창 차이의 중앙값과 12창 묶음 부트스트랩 5~95%
const fs=require('fs'); const D=JSON.parse(fs.readFileSync(process.argv[2]||'capsize_out.json','utf8'));
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>q(a,.5), mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const f1=x=>(x>=0?' ':'')+x.toFixed(1), f2=x=>(x>=0?'+':'')+x.toFixed(2);
const N=D.starts.length;
const pick=(cap,mode)=>D.res.filter(r=>r.cap===cap&&r.mode===mode);
function agg(cap,mode){ const R=pick(cap,mode); if(!R.length) return null;
  const win=[]; for(let k=0;k<N;k++) win.push([mean(R.map(r=>r.win[k][0])),mean(R.map(r=>r.win[k][1]))]);
  const sdw=R.length>1?med(Array.from({length:N},(_,k)=>{ const v=R.map(r=>r.win[k][0]), m=mean(v); return Math.sqrt(mean(v.map(x=>(x-m)**2))); })):0;
  return {n:R.length, cagr:mean(R.map(r=>r.full.cagr)), cagrLo:Math.min(...R.map(r=>r.full.cagr)), cagrHi:Math.max(...R.map(r=>r.full.cagr)),
    mdd:mean(R.map(r=>r.full.mdd)), mddLo:Math.min(...R.map(r=>r.full.mdd)), mddHi:Math.max(...R.map(r=>r.full.mdd)), cyc:mean(R.map(r=>r.full.cycles)),
    tax:mean(R.map(r=>r.full.tax)), final:mean(R.map(r=>r.full.final)), win, sdw, q:(R.find(r=>r.q)||{}).q||null}; }
function boot(d){ const B=12, nb=Math.ceil(d.length/B), out=[]; let s=12345; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  for(let it=0;it<2000;it++){ const x=[]; for(let b=0;b<nb;b++){ const st=Math.floor(rnd()*d.length); for(let k=0;k<B;k++) x.push(d[(st+k)%d.length]); } out.push(med(x)); }
  return [q(out,.05),q(out,.95)]; }
function pair(a,b){ if(!a||!b) return '—'; const dc=a.win.map((w,k)=>w[0]-b.win[k][0]), dm=a.win.map((w,k)=>w[1]-b.win[k][1]);
  const both=a.win.filter((w,k)=>w[0]>b.win[k][0]&&w[1]<b.win[k][1]).length, worse=a.win.filter((w,k)=>w[0]<b.win[k][0]&&w[1]>b.win[k][1]).length;
  const [lo,hi]=boot(dc); return `CAGR 차 중앙 ${f2(med(dc))} [${f2(lo)}~${f2(hi)}] · 높은 창 ${dc.filter(x=>x>0).length}/${N} · MDD 차 중앙 ${f2(med(dm))} · 둘 다 나음:나쁨 ${both}:${worse}`; }
console.log(`${D.TK} ${D.first}~${D.last} · 5년 창 ${N}개(${D.starts[0][0]}~${D.starts[N-1][0]} 시작) · 정수 모드 원금 ×{${D.JIT.join(',')}} 평균 · K=${D.K}`);
const A={}; for(const cap of D.CAPS){ A[cap]={}; for(const m of D.MODES) A[cap][m]=agg(cap,m); }
console.log('\n[전체 기간 CAGR/MDD · 사이클 · 5년 창 중앙 CAGR/MDD · 하10 CAGR · 최악 MDD]');
for(const cap of D.CAPS){ for(const m of D.MODES){ const a=A[cap][m]; if(!a) continue;
  const wc=a.win.map(w=>w[0]), wm=a.win.map(w=>w[1]);
  console.log(`${String(cap).padStart(6)} ${m.padEnd(3)} | 전체 ${f1(a.cagr)}/${a.mdd.toFixed(1)}`+(a.n>1?` (벌 ${a.cagrLo.toFixed(1)}~${a.cagrHi.toFixed(1)} · MDD ${a.mddLo.toFixed(1)}~${a.mddHi.toFixed(1)})`:'                          ')+` · 사이클 ${a.cyc.toFixed(0)} · 세금 ${(a.tax/cap*100).toFixed(0)}%원금 | 창 중앙 ${f1(med(wc))}/${med(wm).toFixed(1)} · 하10 ${f1(q(wc,.1))} · 최악MDD ${Math.max(...wm).toFixed(1)}`+(a.n>1?` · 창 벌 σ ${a.sdw.toFixed(2)}`:'')); }
  console.log(''); }
console.log('[짝 비교 — 같은 5년 창]');
for(const cap of D.CAPS){ const a=A[cap];
  console.log(`${String(cap).padStart(6)} 정수 vs 소수(앱 공제) Ir3−Fr : ${pair(a.Ir3,a.Fr)}`);
  console.log(`${String(cap).padStart(6)} 정수 vs 소수(공제 0)  I03−F0 : ${pair(a.I03,a.F0)}`);
  console.log(`${String(cap).padStart(6)} 내림만(하방 0줄)      I00−F0 : ${pair(a.I00,a.F0)}`);
  console.log(`${String(cap).padStart(6)} 하방 3줄의 몫         I03−I00: ${pair(a.I03,a.I00)}`);
  console.log(`${String(cap).padStart(6)} 공제의 몫(정수)       Ir3−I03: ${pair(a.Ir3,a.I03)}`);
  const Q=(a.Ir3||{}).q; if(Q) console.log(`${String(cap).padStart(6)} 1회매수금 = SOXL 몇 주(사이클 시작 ${Q.length}번): 중앙 ${med(Q).toFixed(1)} · 하10 ${q(Q,.1).toFixed(1)} · 최소 ${Math.min(...Q).toFixed(1)} · 5주 미만 ${Q.filter(x=>x<5).length} · 10주 미만 ${Q.filter(x=>x<10).length}`);
  console.log(''); }
