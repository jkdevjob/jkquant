// pf_dual.js 섀넌 비중 격자(WS=...) 요약 — 비중마다 듀얼 100%(W0.0) 와 창마다 짝 · MDD · 하위 성과
// 사용: node pf_dual_grid_sum.js pf_dual_grid.json
const R=require(require('path').resolve(process.argv[2]||'pf_dual_grid.json'));
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qq(a,.5), mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const C=R.meta.combos, B=C[0];
for(const lab of ['real','syn']) for(const [cl] of R.meta.cfg){ const L=R[lab]; if(!L) continue;
  for(const [nm,flt] of (lab==='real'?[['전체',()=>true],['2016~ 시작',s=>s>='2016-01-01']]:[['전체',()=>true]])){
    const rows=L[cl].rows.filter(r=>flt(r.s)); console.log(`\n■ ${lab==='real'?'실제':'합성'} ${cl} · ${nm} · 5년 창 ${rows.length}`);
    console.log('  섀넌 비중 | 짝 비 중앙(평균) · 100%보다 높은 창 | 세후 연 중앙 | 하위10% 평가 | MDD 중앙 · 최악 | 원금 아래 · 반토막');
    for(const c of C){ const rat=rows.map(r=>r[c].held/r[B].held), md=rows.map(r=>r[c].mdd), fv=rows.map(r=>r[c].held);
      console.log(`  ${c.slice(1).padStart(5)}% | ×${med(rat).toFixed(3)}(×${mean(rat).toFixed(3)}) · ${(rows.filter(r=>r[c].held>r[B].held).length/rows.length*100).toFixed(0)}% | ${med(rows.map(r=>r[c].cagrH)).toFixed(1)}% | ${(qq(fv,.1)/1e3).toFixed(1)}k | ${med(md).toFixed(1)} · ${Math.max(...md).toFixed(1)} | ${rows.filter(r=>r[c].held<r[c].inflow).length} · ${rows.filter(r=>r[c].held<r[c].inflow*.5).length}`); } }
  const P=R[lab][cl].path; console.log(`  한 길 ${P.s}~(${P.yrs.toFixed(1)}년) 세후 연/MDD: `+C.map(c=>`${c.slice(1)}% ${P[c].cagrH.toFixed(1)}/${P[c].mdd.toFixed(1)}`).join(' · ')); }
