// maxret.js 결과를 창 시작 시기로 나눠 본다(앞뒤 절반 · 합성은 실제와 겹치지 않는 2005 년 전 시작) — node maxret_sub.js out.json 변형,…
const fs=require('fs'); const D=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const VS=(process.argv[3]||'').split(',').filter(Boolean);
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length, med=a=>{ const b=[...a].sort((x,y)=>x-y); return b.length?b[Math.floor((b.length-1)/2)]:NaN; };
const CUT={real:[['2010~15','0','2016'],['2016~21','2016','9']], syn:[['1995~04(실제와 안 겹침)','0','2005'],['2005~09','2005','2010'],['2010~21','2010','9']],
  tq:[['2010~15','0','2016'],['2016~21','2016','9']], tqsyn:[['1990~04(실제와 안 겹침)','0','2005'],['2005~09','2005','2010'],['2010~21','2010','9']]};
for(const ds of D.DS){ const S=D.sets[ds]; const N=S.starts.length;
  for(const cap of D.CAPS){ const W=v=>{ const R=S.res.filter(r=>r.cap===cap&&r.v===v); return Array.from({length:N},(_,k)=>[mean(R.map(r=>r.win[k][0])),mean(R.map(r=>r.win[k][1]))]); }; const b=W('base');
    for(const v of (VS.length?VS:Object.keys(D.VARS).filter(x=>x!=='base'))){ const a=W(v); const parts=CUT[ds].map(([nm,lo,hi])=>{ const ks=S.starts.map((s,k)=>[s[0],k]).filter(([s])=>s>=lo&&s<hi).map(([,k])=>k);
        const dc=ks.map(k=>a[k][0]-b[k][0]), dm=ks.map(k=>a[k][1]-b[k][1]); return `${nm} ${ks.length}창 CAGR 차 중앙 ${med(dc).toFixed(2)} · 높은 창 ${dc.filter(x=>x>0).length} · MDD 차 ${med(dm).toFixed(2)}`; });
      console.log(`${ds} ${cap/1000}k ${v.padEnd(9)} | ${parts.join(' | ')}`); } } }
