// pf_dual.js 결과 요약 — D 듀얼 100% · C 듀얼 5/6 + 섀넌 1/6 · C3 듀얼 2/3 + 섀넌 1/3
// 사용: node pf_dual_sum.js pf_dual_out.json   (FROM_REAL=2016-01-01 ONLY=real 로 만든 파일도 그대로 · 한 길에 세전 곡선이 있으면 연도별 수익률도)
const R=require(require('path').resolve(process.argv[2]||'pf_dual_out.json'));
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qq(a,.5);
const f=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d), k=x=>(x/1e3).toFixed(1)+'k', p0=x=>x.toFixed(0)+'%';
const C=R.meta.combos, n=x=>x.split(' ')[0];
const crisis={real:[['2018 4분기','2018-09-20','2018-12-31'],['코로나','2020-02-12','2020-04-30'],['2022','2021-11-15','2022-12-31'],['2024~25','2024-07-01','2025-05-30']],
              syn:[['닷컴','2000-03-01','2002-12-31'],['금융위기','2007-10-01','2009-06-30'],['2022','2021-11-15','2022-12-31']]};
const ddIn=(curve,a,b)=>{ let pk=0,dd=0; for(const [d,v] of curve){ if(d<a||d>b) continue; if(v>pk) pk=v; else if(pk>0) dd=Math.max(dd,(pk-v)/pk); } return dd*100; };
for(const lab of ['real','syn'].filter(x=>R[x])){ const L=R[lab]; console.log(`\n■ ${lab==='real'?'실제':'합성'} ${L.wins[0]}~${lab==='syn'?'(닷컴·금융위기 포함)':''} · 분기 시작 5년 창 ${L.wins.length}개 · 자료 끝 ${L.end}`);
  for(const [cl] of R.meta.cfg){ const X=L[cl], rows=X.rows; console.log(`  [${cl}]`);
    for(const c of C){ const fv=rows.map(r=>r[c].held), cg=rows.map(r=>r[c].cagrH), cl2=rows.map(r=>r[c].cagrL), md=rows.map(r=>r[c].mdd), loss=rows.filter(r=>r[c].held<r[c].inflow).length, half=rows.filter(r=>r[c].held<r[c].inflow*.5).length;
      console.log(`    ${c.padEnd(16)} 평가액 중앙 ${k(med(fv))} · 하위10% ${k(qq(fv,.1))} · 최악 ${k(Math.min(...fv))} | 세후 연 중앙 ${f(med(cg))}% · 하위10% ${f(qq(cg,.1))}% · 최악 ${f(Math.min(...cg))}% · 다 팔면 ${f(med(cl2))}% | MDD 중앙 ${med(md).toFixed(1)} · 상위10% ${qq(md,.9).toFixed(1)} · 최악 ${Math.max(...md).toFixed(1)} | 원금 아래 ${loss} · 반토막 ${half}`); }
    const wins=Object.fromEntries(C.map(c=>[c,0])); for(const r of rows){ let b=C[0]; for(const c of C) if(r[c].held>r[b].held) b=c; wins[b]++; }
    console.log(`    창마다 1등: `+C.map(c=>`${n(c)} ${wins[c]}`).join(' · '));
    const pair=(a,b,key='held',flt=()=>true)=>{ const r=rows.filter(x=>flt(x.s)); if(!r.length) return '—'; const rat=r.map(x=>x[a][key]/x[b][key]); return `×${med(rat).toFixed(3)}(${p0(r.filter(x=>x[a][key]>x[b][key]).length/r.length*100)})`; };
    const dm=(a,b)=>{ const d=rows.map(r=>r[a].mdd-r[b].mdd); return `MDD 차 중앙 ${f(med(d))}%p · 작은 창 ${p0(d.filter(x=>x<0).length/d.length*100)}`; };
    console.log(`    짝(앞÷뒤 · 높은 창): ${n(C[1])}÷${n(C[0])} ${pair(C[1],C[0])} · ${n(C[2])}÷${n(C[0])} ${pair(C[2],C[0])} · ${n(C[2])}÷${n(C[1])} ${pair(C[2],C[1])} | 다 팔면 ${pair(C[1],C[0],'liq')} · ${pair(C[2],C[0],'liq')} · ${pair(C[2],C[1],'liq')}`);
    console.log(`      ${n(C[1])}−${n(C[0])} ${dm(C[1],C[0])} | ${n(C[2])}−${n(C[0])} ${dm(C[2],C[0])} | ${n(C[2])}−${n(C[1])} ${dm(C[2],C[1])}`);
    const sp=lab==='real'?[['2011~15',s=>s<'2016-01-01'],['2016~',s=>s>='2016-01-01']]:[['2000~04',s=>s<'2005-01-01'],['2005~09',s=>s>='2005-01-01'&&s<'2010-01-01'],['2010~',s=>s>='2010-01-01']];
    console.log(`    시기별: `+sp.map(([nm,fl])=>`${nm} ${n(C[1])}÷${n(C[0])} ${pair(C[1],C[0],'held',fl)} · ${n(C[2])}÷${n(C[0])} ${pair(C[2],C[0],'held',fl)}`).join(' | '));
    const P=X.path; console.log(`    한 길 ${P.s}~(${P.yrs.toFixed(1)}년): `+C.map(c=>`${n(c)} ${f(P[c].cagrH)}%/${P[c].mdd.toFixed(1)}`).join(' · ')+'  (세후 연/MDD)');
    if(P[C[0]].curvePre){ console.log(`      세전 곡선 MDD: `+C.map(c=>`${n(c)} ${P[c].mddPre.toFixed(1)}`).join(' · '));
      const yr={}; for(const c of C){ yr[c]={}; let prevY=null, base=null, last=null; for(const [d,v] of P[c].curvePre){ const y=d.slice(0,4); if(y!==prevY){ if(prevY) yr[c][prevY]=(last/base-1)*100; base=last??v; prevY=y; } last=v; } yr[c][prevY]=(last/base-1)*100; }
      console.log(`      연도별(세전 · ${C.map(n).join('/')} · 둘째−첫째): `+Object.keys(yr[C[0]]).map(y=>`${y} ${C.map(c=>f(yr[c][y],0)).join('/')} (${f(yr[C[1]][y]-yr[C[0]][y])})`).join(' · ')); }
    console.log(`      위기 낙폭(${C.map(n).join('·')}): `+crisis[lab].map(([nm,a,b])=>`${nm} ${C.map(c=>ddIn(P[c].curve,a,b).toFixed(0)).join('/')}`).join(' · '));
    const lg=Object.keys(rows[0].legs); console.log(`      섀넌 다리(5년 뒤 ÷ 넣은 돈 중앙): `+lg.map(id=>{ const w=+id.split('@')[1], cap=R.meta.cfg.find(z=>z[0]===cl)[1]*w; return `${id} ×${med(rows.map(r=>r.legs[id].final/cap)).toFixed(2)} · 넣은 돈 아래 ${rows.filter(r=>r.legs[id].final<cap).length}창`; }).join(' · ')); } }
