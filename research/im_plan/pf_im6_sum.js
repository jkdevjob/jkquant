// pf_im6.js 결과 요약 — 듀얼 5/6 + 무매 1/6 vs 듀얼 5/6 + 섀넌 USD 1/6 (같은 듀얼 다리 · 다리만 다름)
// 사용: node pf_im6_sum.js pf_im6_out.json
const R=require(require('path').resolve(process.argv[2]||'pf_im6_out.json'));
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qq(a,.5);
const f=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d), k=x=>(x/1e3).toFixed(1)+'k', p0=x=>x.toFixed(0)+'%';
const NM={im:'듀얼+무매',iv:'듀얼+섀넌'};
const crisis={real:[['2018 4분기','2018-09-20','2018-12-31'],['코로나','2020-02-12','2020-04-30'],['2022','2021-11-15','2022-12-31'],['2024~25 관세','2024-07-01','2025-05-30']],
              syn:[['닷컴','2000-03-01','2002-12-31'],['금융위기','2007-10-01','2009-06-30'],['2022','2021-11-15','2022-12-31']]};
const ddIn=(curve,a,b)=>{ let pk=0,dd=0; for(const [d,v] of curve){ if(d<a||d>b) continue; if(v>pk) pk=v; else if(pk>0) dd=Math.max(dd,(pk-v)/pk); } return dd*100; };
for(const lab of ['real','syn']){ const L=R[lab]; console.log(`\n■ ${lab==='real'?'실제 2011-04~':'합성 2000-04~(닷컴·금융위기 포함)'} · 분기 시작 5년 창 ${L.wins.length}개 · 자료 끝 ${L.end}`);
  for(const [cl] of R.meta.cfg){ const X=L[cl], rows=X.rows; if(!rows||!rows.length) continue;
    console.log(`  [${cl}]`);
    for(const c of ['im','iv']){ const fv=rows.map(r=>r[c].held), cg=rows.map(r=>r[c].cagrH), cl2=rows.map(r=>r[c].cagrL), md=rows.map(r=>r[c].mdd), loss=rows.filter(r=>r[c].held<r.inflow).length, half=rows.filter(r=>r[c].held<r.inflow*.5).length;
      console.log(`    ${NM[c].padEnd(6)} 평가액 중앙 ${k(med(fv))} · 하위10% ${k(qq(fv,.1))} · 최악 ${k(Math.min(...fv))} | 세후 연 중앙 ${f(med(cg))}% · 최악 ${f(Math.min(...cg))}% · 다 팔면 중앙 ${f(med(cl2))}% | MDD 중앙 ${med(md).toFixed(1)} · 최악 ${Math.max(...md).toFixed(1)} | 원금 아래 ${loss} · 반토막 ${half}`); }
    const pr=(flt,key)=>{ const r=rows.filter(x=>flt(x.s)); if(!r.length) return '—'; const rat=r.map(x=>x.iv[key]/x.im[key]); return `×${med(rat).toFixed(3)} · 섀넌 쪽이 높은 창 ${p0(r.filter(x=>x.iv[key]>x.im[key]).length/r.length*100)} (${r.length}창)`; };
    const dmdd=rows.map(r=>r.iv.mdd-r.im.mdd), dcg=rows.map(r=>r.iv.cagrH-r.im.cagrH);
    console.log(`    짝 비교(섀넌÷무매): 들고 있음 ${pr(()=>true,'held')} · 다 팔면 ${pr(()=>true,'liq')}`);
    if(lab==='real') console.log(`      시작 2011~15 ${pr(s=>s<'2016-01-01','held')} · 2016~ ${pr(s=>s>='2016-01-01','held')} · 2018-10~ ${pr(s=>s>='2018-10-01','held')}`);
    else console.log(`      시작 2000~04 ${pr(s=>s<'2005-01-01','held')} · 2005~09 ${pr(s=>s>='2005-01-01'&&s<'2010-01-01','held')} · 2010~ ${pr(s=>s>='2010-01-01','held')}`);
    console.log(`      연수익 차(섀넌−무매) 중앙 ${f(med(dcg),2)}%p · 하위10% ${f(qq(dcg,.1),2)} · 최악 ${f(Math.min(...dcg),2)} | MDD 차 중앙 ${f(med(dmdd))}%p · 섀넌 쪽 MDD 가 작은 창 ${p0(dmdd.filter(x=>x<0).length/dmdd.length*100)}`);
    const P=X.path; if(P){ console.log(`    한 길 ${P.s}~(${P.yrs.toFixed(1)}년): `+['im','iv'].map(c=>`${NM[c]} 세후 연 ${f(P[c].cagrH)}% · 다 팔면 ${f(P[c].cagrL)}% · MDD ${P[c].mdd.toFixed(1)}`).join(' | '));
      console.log(`      위기 낙폭: `+crisis[lab].map(([n,a,b])=>`${n} ${ddIn(P.im.curve,a,b).toFixed(0)} vs ${ddIn(P.iv.curve,a,b).toFixed(0)}`).join(' · ')+' (무매 vs 섀넌, %)'); } } }
