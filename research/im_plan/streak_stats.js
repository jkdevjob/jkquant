// 연속 상승일 · 연속 하락일 통계(사용자 질문 10-31) — 'N일 연속 오른/내린 뒤' 다음 날·5일·20일 수익률이 우연보다 기우는가
// 연속일 = 종가가 전일 종가보다 높으면 상승(+1), 낮으면 하락(−1), 같으면 끊김. N 은 그날 종가까지 센 길이(그날 종가로 확정).
// 사용: node streak_stats.js [종목,…]   (기본 SOXL · SOX · SYNSOXL) · 앞뒤 절반을 나눠 같은 방향인지 본다
const fs=require('fs'), path=require('path');
const load=s=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',s+'.json'))).series.filter(x=>x.close>0);
const f=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
function analyze(sym,from,to){ const a=load(sym).filter(x=>x.date>=(from||'0')&&x.date<=(to||'9')); const C=a.map(x=>x.close), n=C.length;
  const st=new Array(n).fill(0); for(let k=1;k<n;k++){ const d=C[k]>C[k-1]?1:C[k]<C[k-1]?-1:0; st[k]=d===0?0:(Math.sign(st[k-1])===d?st[k-1]+d:d); }
  const fwd=(k,h)=>k+h<n?C[k+h]/C[k]-1:null; const G={};
  for(let k=1;k<n-1;k++){ const s=Math.max(-6,Math.min(6,st[k])); if(!s) continue; const g=G[s]=G[s]||{n:0,r1:[],r5:[],r20:[]}; g.n++; g.r1.push(fwd(k,1)); if(fwd(k,5)!=null) g.r5.push(fwd(k,5)); if(fwd(k,20)!=null) g.r20.push(fwd(k,20)); }
  const all1=[]; for(let k=1;k<n-1;k++) all1.push(fwd(k,1)); const m=x=>x.reduce((p,q)=>p+q,0)/x.length, sd=x=>{ const u=m(x); return Math.sqrt(x.reduce((p,q)=>p+(q-u)**2,0)/(x.length-1)); };
  const base={m1:m(all1), up:all1.filter(x=>x>0).length/all1.length, sd:sd(all1)};
  // 연속일 길이 분포(끝난 연속의 길이)
  const runs={up:{},dn:{}}; for(let k=1;k<n;k++){ const s=st[k], nx=k+1<n?st[k+1]:0; if(s&&Math.sign(nx)!==Math.sign(s)){ const b=s>0?runs.up:runs.dn, L=Math.min(8,Math.abs(s)); b[L]=(b[L]||0)+1; } }
  return {sym,first:a[0].date,last:a[n-1].date,n,G,base,runs}; }
function show(R){ console.log(`\n■ ${R.sym} ${R.first}~${R.last} (${R.n}일) — 무조건 다음 날 평균 ${f(R.base.m1*100)}% · 오른 날 ${(R.base.up*100).toFixed(1)}%`);
  const tot=k=>Object.values(R.runs[k]).reduce((a,b)=>a+b,0);
  console.log('  끝난 연속 길이 분포 — 상승 '+Object.entries(R.runs.up).map(([L,c])=>`${L==8?'8+':L}일 ${(c/tot('up')*100).toFixed(0)}%`).join(' · ')+'\n                     하락 '+Object.entries(R.runs.dn).map(([L,c])=>`${L==8?'8+':L}일 ${(c/tot('dn')*100).toFixed(0)}%`).join(' · '));
  console.log('  그날까지 연속 | 횟수 | 다음 날 평균(t) · 오를 확률 | 5일 뒤 평균 · 오를 확률 | 20일 뒤 평균');
  for(const s of [-6,-5,-4,-3,-2,-1,1,2,3,4,5,6]){ const g=R.G[s]; if(!g) continue; const m=x=>x.reduce((p,q)=>p+q,0)/x.length;
    const t=(m(g.r1)-R.base.m1)/(R.base.sd/Math.sqrt(g.n));
    console.log(`  ${(s>0?'상승 ':'하락 ')+Math.abs(s)+(Math.abs(s)===6?'+':'')+'일'} | ${String(g.n).padStart(4)} | ${f(m(g.r1)*100)}% (${f(t,1)}) · ${(g.r1.filter(x=>x>0).length/g.n*100).toFixed(0)}% | ${f(m(g.r5)*100)}% · ${(g.r5.filter(x=>x>0).length/g.r5.length*100).toFixed(0)}% | ${f(m(g.r20)*100)}%`); } }
const syms=(process.argv[2]||'SOXL,SOX,SYNSOXL').split(',');
for(const s of syms){ show(analyze(s)); }
console.log('\n— 앞뒤 절반 · 다음 날 평균(%) 비교 (같은 방향이면 덜 우연)');
for(const [s,mid] of [['SOXL','2018-06-30'],['SOX','2010-03-10'],['SYNSOXL','2010-03-10']]){ const A=analyze(s,null,mid), B=analyze(s,mid,null);
  console.log(`  ${s.padEnd(8)} ${A.first.slice(0,4)}~${mid.slice(0,4)} | ${mid.slice(0,4)}~${B.last.slice(0,4)} — `+[-4,-3,-2,-1,1,2,3,4].map(k=>{ const m=g=>g?g.r1.reduce((p,q)=>p+q,0)/g.r1.length*100:NaN; return `${k>0?'↑':'↓'}${Math.abs(k)} ${m(A.G[k]).toFixed(2)}/${m(B.G[k]).toFixed(2)}`; }).join(' · ')); }
