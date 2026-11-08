// maxret.js 결과 요약 — node maxret_sum.js [maxret_out.json]
// 원금 ×JIT 벌을 창마다 평균 · 기준(base) 대비 같은 5년 창 차이: 중앙 [12창 묶음 부트스트랩 5~95%] · 높은 창 · MDD 차 중앙 · 둘 다 나음:나쁨
const fs=require('fs'); const D=JSON.parse(fs.readFileSync(process.argv[2]||'maxret_out.json','utf8'));
const qt=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qt(a,.5), mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const f1=x=>(x>=0?' ':'')+x.toFixed(1), f2=x=>(x>=0?'+':'')+x.toFixed(2);
function boot(d){ const B=12, nb=Math.ceil(d.length/B), out=[]; let s=12345; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648;
  for(let it=0;it<2000;it++){ const x=[]; for(let b=0;b<nb;b++){ const st=Math.floor(rnd()*d.length); for(let k=0;k<B;k++) x.push(d[(st+k)%d.length]); } out.push(med(x)); } return [qt(out,.05),qt(out,.95)]; }
const V=Object.keys(D.VARS), verdict={};
for(const ds of D.DS){ const S=D.sets[ds], N=S.starts.length;
  console.log(`\n=== ${ds} ${S.tk} ${S.first}~${S.last} · 5년 창 ${N} · 원금 ×{${D.JIT.join(',')}} 평균`);
  for(const cap of D.CAPS){ const A={};
    for(const v of V){ const R=S.res.filter(r=>r.cap===cap&&r.v===v); if(!R.length) continue;
      const R1=R.find(r=>r.j===1)||R[0]; A[v]={dd:R1.full.mP?(R1.full.mP+"→"+R1.full.mT):"", full:mean(R.map(r=>r.full.cagr)), mdd:mean(R.map(r=>r.full.mdd)), cyc:mean(R.map(r=>r.full.cycles)), flr:mean(R.map(r=>r.full.flr||0)), fee:R[0].full.sg?mean(R.map(r=>r.full.sg.fees/r.full.final*100)):null,
        win:Array.from({length:N},(_,k)=>[mean(R.map(r=>r.win[k][0])),mean(R.map(r=>r.win[k][1]))])}; }
    const b=A.base; console.log(`-- ${cap}$`);
    for(const v of V){ const a=A[v]; if(!a) continue; const wc=a.win.map(w=>w[0]), wm=a.win.map(w=>w[1]);
      let p=''; if(v!=='base'){ const dc=a.win.map((w,k)=>w[0]-b.win[k][0]), dm=a.win.map((w,k)=>w[1]-b.win[k][1]); const [lo,hi]=boot(dc);
        const both=a.win.filter((w,k)=>w[0]>b.win[k][0]&&w[1]<b.win[k][1]).length, worse=a.win.filter((w,k)=>w[0]<b.win[k][0]&&w[1]>b.win[k][1]).length;
        p=` | 짝: CAGR 차 중앙 ${f2(med(dc))} [${f2(lo)}~${f2(hi)}] · 높은 창 ${dc.filter(x=>x>0).length}/${N} · MDD 차 ${f2(med(dm))} · 둘다 나음:나쁨 ${both}:${worse}`;
        (verdict[v]=verdict[v]||[]).push(`${ds}${cap/1000}k 전체 ${f2(a.full-b.full)} 창 ${f2(med(dc))}[${f2(lo)}~${f2(hi)}] MDD ${f2(med(dm))}`); }
      console.log(`${v.padEnd(10)} 전체 ${f1(a.full)}/${a.mdd.toFixed(1)}${a.dd?" ("+a.dd+")":""} · 사이클 ${a.cyc.toFixed(0)}${a.flr?" · 바닥선 "+a.flr.toFixed(0):""} · 창 중앙 ${f1(med(wc))}/${med(wm).toFixed(1)} · 하10 ${f1(qt(wc,.1))}`+p); } } }
console.log('\n=== 한 줄 판정(기준 대비 · 전체 CAGR 차 · 5년 창 CAGR 차 중앙[5~95%] · MDD 차 중앙)');
for(const v of Object.keys(verdict)) console.log(`${v.padEnd(10)} ${verdict[v].join(' | ')}`);
