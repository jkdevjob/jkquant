// pf_mix.js 결과 요약 — A 듀얼4/6+무매1/6+섀넌1/6 · B 듀얼5/6+무매1/6 · C 듀얼5/6+섀넌1/6 (+ 무매 공식 설정 감도 A0·B0)
// 사용: node pf_mix_sum.js pf_mix_out.json
const R=require(require('path').resolve(process.argv[2]||'pf_mix_out.json'));
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qq(a,.5);
const f=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d), k=x=>(x/1e3).toFixed(1)+'k', p0=x=>x.toFixed(0)+'%';
const C=R.meta.combos, MAIN=C.slice(0,3);
const crisis={real:[['2018 4분기','2018-09-20','2018-12-31'],['코로나','2020-02-12','2020-04-30'],['2022','2021-11-15','2022-12-31'],['2024~25','2024-07-01','2025-05-30']],
              syn:[['닷컴','2000-03-01','2002-12-31'],['금융위기','2007-10-01','2009-06-30'],['2022','2021-11-15','2022-12-31']]};
const ddIn=(curve,a,b)=>{ let pk=0,dd=0; for(const [d,v] of curve){ if(d<a||d>b) continue; if(v>pk) pk=v; else if(pk>0) dd=Math.max(dd,(pk-v)/pk); } return dd*100; };
for(const lab of ['real','syn']){ const L=R[lab]; console.log(`\n■ ${lab==='real'?'실제 2011-04~':'합성 2000-04~(닷컴·금융위기 포함)'} · 분기 시작 5년 창 ${L.wins.length}개 · 자료 끝 ${L.end}`);
  for(const [cl] of R.meta.cfg){ const X=L[cl], rows=X.rows; console.log(`  [${cl}]`);
    for(const c of C){ const fv=rows.map(r=>r[c].held), cg=rows.map(r=>r[c].cagrH), cl2=rows.map(r=>r[c].cagrL), md=rows.map(r=>r[c].mdd), loss=rows.filter(r=>r[c].held<r[c].inflow).length, half=rows.filter(r=>r[c].held<r[c].inflow*.5).length;
      console.log(`    ${c.padEnd(18)} 평가액 중앙 ${k(med(fv))} · 하위10% ${k(qq(fv,.1))} · 최악 ${k(Math.min(...fv))} | 세후 연 중앙 ${f(med(cg))}% · 최악 ${f(Math.min(...cg))}% · 다 팔면 ${f(med(cl2))}% | MDD 중앙 ${med(md).toFixed(1)} · 최악 ${Math.max(...md).toFixed(1)} | 원금 아래 ${loss} · 반토막 ${half}`); }
    // 1등 횟수(들고 있음) — 세 구성
    const wins=Object.fromEntries(MAIN.map(c=>[c,0])); for(const r of rows){ let b=MAIN[0]; for(const c of MAIN) if(r[c].held>r[b].held) b=c; wins[b]++; }
    console.log(`    창마다 1등(A·B·C): `+MAIN.map(c=>`${c.split(' ')[0]} ${wins[c]}`).join(' · '));
    const pair=(a,b,key='held',flt=()=>true)=>{ const r=rows.filter(x=>flt(x.s)); const rat=r.map(x=>x[a][key]/x[b][key]); return `×${med(rat).toFixed(3)}(${p0(r.filter(x=>x[a][key]>x[b][key]).length/r.length*100)})`; };
    const n=x=>x.split(' ')[0];
    console.log(`    짝(앞÷뒤 · 높은 창): A÷B ${pair(C[0],C[1])} · A÷C ${pair(C[0],C[2])} · C÷B ${pair(C[2],C[1])} | 다 팔면 A÷B ${pair(C[0],C[1],'liq')} · A÷C ${pair(C[0],C[2],'liq')} · C÷B ${pair(C[2],C[1],'liq')}`);
    const sp=lab==='real'?[['2011~15',s=>s<'2016-01-01'],['2016~',s=>s>='2016-01-01']]:[['2000~04',s=>s<'2005-01-01'],['2005~09',s=>s>='2005-01-01'&&s<'2010-01-01'],['2010~',s=>s>='2010-01-01']];
    console.log(`    시기별: `+sp.map(([nm,fl])=>`${nm} A÷B ${pair(C[0],C[1],'held',fl)} · A÷C ${pair(C[0],C[2],'held',fl)} · C÷B ${pair(C[2],C[1],'held',fl)}`).join(' | '));
    console.log(`    무매 설정 감도(익절 자동 ÷ 공식 20% 고정): B÷B0 ${pair(C[1],C[4])} · A÷A0 ${pair(C[0],C[3])} · MDD 중앙 B ${med(rows.map(r=>r[C[1]].mdd)).toFixed(1)} vs B0 ${med(rows.map(r=>r[C[4]].mdd)).toFixed(1)} · 최악 ${Math.max(...rows.map(r=>r[C[1]].mdd)).toFixed(1)} vs ${Math.max(...rows.map(r=>r[C[4]].mdd)).toFixed(1)}`);
    const P=X.path; console.log(`    한 길 ${P.s}~(${P.yrs.toFixed(1)}년): `+C.map(c=>`${n(c)} ${f(P[c].cagrH)}%/${P[c].mdd.toFixed(1)}`).join(' · ')+'  (세후 연/MDD)');
    console.log(`      위기 낙폭(A·B·C): `+crisis[lab].map(([nm,a,b])=>`${nm} ${MAIN.map(c=>ddIn(P[c].curve,a,b).toFixed(0)).join('/')}`).join(' · '));
    const lg=rows.map(r=>r.legs); console.log(`      다리(1/6 · 5년 뒤 중앙): 무매 ${k(med(lg.map(x=>x.im.final)))} · 무매 공식 ${k(med(lg.map(x=>x.im0.final)))} · 섀넌 ${k(med(lg.map(x=>x.iv.final)))} · 무매가 1/6 원금 아래로 끝난 창 ${lg.filter(x=>x.im.final<rows[0][C[0]].inflow*0+(R.meta.cfg.find(z=>z[0]===cl)[1]/6)).length} · 섀넌 ${lg.filter(x=>x.iv.final<(R.meta.cfg.find(z=>z[0]===cl)[1]/6)).length}`); } }
