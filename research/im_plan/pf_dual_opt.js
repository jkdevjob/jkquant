// 11-09 사용자: "앞으로 반도체 시장이 어떨지 예측해보고 섀넌 비중 최적화 해봐"
// pf_dual.js 결과(격자 0~1/3 · 섀넌 100%)로 창마다 '반도체 국면'을 나누고, 국면 확률(믿음)마다 기하 성장(창 5년 뒤 평가액 log 평균)을 가장 크게 하는 섀넌 비중을 찾는다.
//   국면 = 같은 창의 섀넌 100% ÷ 듀얼 100% (q) — 강세 q>1.10 · 보통 0.90~1.10 · 약세 q<0.90
//   비중 w 의 평가액 ≈ (1−w)·듀얼 + w·섀넌 (다리 사이 재조정 없음 → 창마다 선형 · 격자 실측과의 차이를 같이 적는다)
//   MDD 는 선형이 아니라 격자 실측값(0·1/12·1/8·1/6·1/5·1/4·1/3·1)만 쓴다.
// 사용: node pf_dual_opt.js pf_dual_grid.json pf_dual_s100.json
const G=require(require('path').resolve(process.argv[2])), S=require(require('path').resolve(process.argv[3]));
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, med=a=>qq(a,.5), mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
const GW=G.meta.combos, WV=GW.map(c=>+c.slice(1)/100);
const REG=[['강세',q=>q>1.10],['보통',q=>q>=0.90&&q<=1.10],['약세',q=>q<0.90]];
const WS=[0,1/12,1/8,1/6,1/5,1/4,1/3,0.4,0.5,0.75,1];
for(const lab of ['real','syn']) for(const cl of ['1만$','10만$']){
  const rs=S[lab][cl].rows, rg=G[lab][cl].rows, D=r=>r['W0.0'].held, Sv=r=>r['W100.0'].held;
  const W=rs.map((r,i)=>({s:r.s,q:Sv(r)/D(r),g:rg[i]})); if(W.some((w,i)=>w.s!==rg[i].s)) throw Error('창 어긋남');
  // 선형 근사 확인 — 격자 실측 ÷ 선형
  const lin=GW.map((c,k)=>{ const w=WV[k]; return med(W.map(x=>x.g[c].held/(D(x.g)*((1-w)+w*x.q)))); });
  console.log(`\n■ ${lab==='real'?'실제 2011~':'합성 2000~'} ${cl} · 창 ${W.length} · 선형 근사 오차(격자 실측 ÷ 선형 중앙): `+lin.map((v,k)=>GW[k].slice(1)+'% '+v.toFixed(4)).join(' · '));
  const by=REG.map(([n,f])=>[n,W.filter(x=>f(x.q))]);
  console.log('  국면 창 수: '+by.map(([n,a])=>`${n} ${a.length}(${(a.length/W.length*100).toFixed(0)}%) · 시작 ${a.length?a.map(x=>x.s.slice(0,4)).filter((v,i,z)=>z.indexOf(v)===i).join(','):'—'}`).join(' | '));
  console.log('  국면별 q 중앙: '+by.map(([n,a])=>`${n} ${a.length?med(a.map(x=>x.q)).toFixed(2):'—'}`).join(' · '));
  // 국면별 비중마다 log(평가액 ÷ 듀얼) 평균(=기하 성장 차이, 5년) — 선형 모형
  const g=(a,w)=>a.length?mean(a.map(x=>Math.log((1-w)+w*x.q))):0;
  console.log('  국면별 5년 기하 성장 차이(듀얼 대비 %): 비중 '+WS.map(w=>(w*100).toFixed(0)+'%').join(' / '));
  for(const [n,a] of by) console.log(`    ${n.padEnd(3)} `+WS.map(w=>((Math.exp(g(a,w))-1)*100).toFixed(1)).join(' / '));
  // 격자 실측 MDD — 국면별 중앙·최악
  for(const [n,a] of by){ if(!a.length) continue; console.log(`    ${n} MDD 중앙/최악(실측): `+GW.map(c=>`${c.slice(1)}% ${med(a.map(x=>x.g[c].mdd)).toFixed(1)}/${Math.max(...a.map(x=>x.g[c].mdd)).toFixed(1)}`).join(' · ')+` · 100% ${med(a.map(x=>{const r=rs.find(z=>z.s===x.s); return r['W100.0'].mdd;})).toFixed(1)}/${Math.max(...a.map(x=>{const r=rs.find(z=>z.s===x.s); return r['W100.0'].mdd;})).toFixed(1)}`); }
  // 믿음(국면 확률)마다 최적 비중 — 기하 성장 최대(0~1, 0.5% 간격)
  const beliefs=[['낙관(강세 50·보통 30·약세 20)',[.5,.3,.2]],['중립(1/3씩)',[1/3,1/3,1/3]],['역사 빈도',by.map(([n,a])=>a.length/W.length)],['신중(강세 25·보통 40·약세 35)',[.25,.4,.35]],['비관(강세 20·보통 30·약세 50)',[.2,.3,.5]]];
  for(const [bn,p] of beliefs){ let best=0,bv=-1e9; for(let w=0;w<=1.0001;w+=0.005){ const v=by.reduce((s,[n,a],k)=>s+p[k]*g(a,w),0); if(v>bv){bv=v;best=w;} }
    const at=w=>by.reduce((s,[n,a],k)=>s+p[k]*g(a,w),0);
    console.log(`  믿음 ${bn}: 최적 섀넌 ${(best*100).toFixed(1)}% · 듀얼 100% 대비 5년 +${((Math.exp(bv)-1)*100).toFixed(2)}% · 1/6 이면 ${((Math.exp(at(1/6))-1)*100).toFixed(2)}% · 1/4 이면 ${((Math.exp(at(1/4))-1)*100).toFixed(2)}%`); }
}
