// trio_exact.json 요약
const r=require(process.argv[2]); const N=r.meta.names; const f=(x,d=1)=>x==null||!Number.isFinite(x)?'  -':x.toFixed(d);
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }; const med=a=>q(a,.5);
const sg=x=>(x>=0?'+':'')+f(x);
for(const set of ['real','syn']){ if(!r[set]) continue; for(const cap of Object.keys(r[set])){ const R=r[set][cap]; const W=R.win; const cur=W.CUR;
  console.log(`\n══ ${set==='real'?'실제 2011~':'합성 2000~'} · ${cap/1e4}만$ · 5년 창 ${cur.length} (정확 재실행: 다리마다 원금×비중 · 공제는 비중만큼) ══`);
  console.log('  '+'전략'.padEnd(34)+'  연중앙 하위10% 최악 | MDD중앙/최악 | 반토막 | 지금보다: 차 중앙 · 하위10% · 이긴 창 · 둘다 나은 창');
  for(const k of Object.keys(W)){ const a=W[k]; const dc=a.map((x,i)=>x.c-cur[i].c);
    console.log(`  ${N[k].padEnd(34)} ${f(med(a.map(x=>x.c))).padStart(5)} ${f(q(a.map(x=>x.c),.1)).padStart(6)} ${f(Math.min(...a.map(x=>x.c))).padStart(6)} | -${f(med(a.map(x=>x.d)),0)}/-${f(Math.max(...a.map(x=>x.d)),0)} | ${f(a.filter(x=>x.mult<0.5).length/a.length*100,0).padStart(3)}% | ${sg(med(dc)).padStart(5)} ${sg(q(dc,.1)).padStart(5)} ${f(dc.filter(x=>x>0).length/a.length*100,0).padStart(3)}% ${f(a.filter((x,i)=>x.c>cur[i].c&&x.d<cur[i].d).length/a.length*100,0).padStart(3)}%`); }
  // 국면
  console.log('  · 국면 — 창 안에서 SOX 가 NDX 보다 많이 오른 창(반도체 우세) vs 아닌 창: 연 중앙 · MDD 중앙 · 지금보다 차 중앙');
  for(const semi of [true,false]){ const idx=cur.map((x,i)=>x.semi===semi?i:-1).filter(i=>i>=0); if(!idx.length){ console.log(`    ${semi?'반도체 우세':'나스닥 우세'}: 없음`); continue; }
    console.log(`    ${semi?'반도체 우세':'나스닥 우세'} ${idx.length}창: `+Object.keys(W).map(k=>`${k} ${f(med(idx.map(i=>W[k][i].c)))}/-${f(med(idx.map(i=>W[k][i].d)),0)}${k==='CUR'?'':'('+sg(med(idx.map(i=>W[k][i].c-cur[i].c)))+')'}`).join(' · ')); }
  // 적립
  const labs=Object.keys(cur[0].dca); const base=cur.map(x=>x.dca.USD);
  console.log(`  · 매일 2$ 적립 행선지 (단위 수익률 TWR 중앙 · MDD 중앙/최악 · 5년 뒤 평가액 중앙 — 낸 돈 ${f(med(cur.map(x=>x.paid)),0)}$) · 괄호 = '지금+USD 적립' 대비 평가액 중앙 비`);
  for(const k of Object.keys(W)){ const a=W[k]; console.log(`    ${N[k].padEnd(34)} `+labs.map(l=>`${l} ${f(med(a.map(x=>x.dca[l].c)))}/-${f(med(a.map(x=>x.dca[l].d)),0)}/-${f(Math.max(...a.map(x=>x.dca[l].d)),0)} ${f(med(a.map(x=>x.dca[l].fv))/1e3,1)}k(${f(med(a.map((x,i)=>x.dca[l].fv/base[i].fv)),3)})`).join(' · ')); }
  console.log('  · 전 구간 — 연 · MDD · 배수 · 샤프 · 소르티노 · 얼서 · 최장 물속(개월)');
  for(const k of Object.keys(R.full)){ const x=R.full[k]; console.log(`    ${N[k].padEnd(34)} ${f(x.c).padStart(5)} -${f(x.d,0).padStart(2)} ×${f(x.mult,1).padStart(6)} ${f(x.sharpe,2).padStart(5)} ${f(x.sortino,2).padStart(5)} ${f(x.ulcer).padStart(5)} ${f(x.uw,0).padStart(4)}`); }
  const labsC=Object.keys(R.crisis.CUR); console.log('  · 위기 낙폭(위기 직전 1년 고점 기준) — '+labsC.join(' · '));
  for(const k of Object.keys(R.crisis)){ console.log(`    ${N[k].padEnd(34)} `+labsC.map(l=>{ const z=R.crisis[k][l]; return z?('-'+f(z.dd,0)).padStart(4)+(z.rec!=null?`(${f(z.rec,0)}개월)`:'(미회복)'):'   -'; }).join(' ')); }
  console.log('  · 짝지은 부트스트랩(전 구간 일수익 · 2,000경로×5년 · 63일 블록) — 지금보다 연수익 높을 확률 · 둘 다 좋을 확률 · 차이 중앙/하위10%/상위10% · 5% 최악 연(지금→상대) · MDD 95%(지금→상대)');
  for(const k of Object.keys(R.boot)){ const b=R.boot[k]; console.log(`    ${N[k].padEnd(34)} ${f(b.pBetter,0).padStart(3)}% ${f(b.pBoth,0).padStart(3)}% | ${sg(b.dMed).padStart(5)} ${sg(b.d10).padStart(5)} ${sg(b.d90).padStart(5)} | ${f(b.a.c5).padStart(6)}→${f(b.b.c5).padStart(6)} | -${f(b.a.d95,0)}→-${f(b.b.d95,0)}`); } } }
