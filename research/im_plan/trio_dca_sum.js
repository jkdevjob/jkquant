// trio_dca.json 요약 — 기준 = 지금(무매 1만 + 플랜 기본 2만 + 지금 바구니 매일 10$). 칸 = 실제 전체·앞(~2013-10)·뒤(2018-10~) · 합성 2000~05·2006~10·2011~ × 원금 1만·3만·10만
const r=require(process.argv[2]); const LN=r.meta.lname, DN=r.meta.dname; const f=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'-';
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }, med=a=>q(a,.5);
const CAPS=Object.keys(r.real).map(Number); const SUB={real:{ALL:s=>true,A:s=>s<='2013-10-01',B:s=>s>='2018-10-01'}, syn:{EARLY:s=>s<='2005-10-01',MID:s=>s>='2006-01-01'&&s<='2010-10-01',LATE:s=>s>='2011-01-01',ALL:s=>true}};
const nStrat=(L,D)=>r.meta.lumps[L].length+(['CASH','PLAN','PROP'].includes(D)?0:1);
const cell=(set,cap,sub,L,D)=>{ const R=r[set]&&r[set][cap]; if(!R||!R.win[L]||!R.win[L][D]) return null; const idx=R.windows.map((s,i)=>SUB[set][sub](s)?i:-1).filter(i=>i>=0);
  const a=idx.map(i=>R.win[L][D][i]), b=idx.map(i=>R.win.L0.BASKET[i]); if(a.some(x=>!x)) return null;
  const ratio=a.map((x,i)=>x.fv/b[i].fv);
  return {n:idx.length,c:med(a.map(x=>x.c)),cMin:Math.min(...a.map(x=>x.c)),d:med(a.map(x=>x.d)),dMax:Math.max(...a.map(x=>x.d)),fv:med(a.map(x=>x.fv)),fv10:q(a.map(x=>x.fv),.1),fvMin:Math.min(...a.map(x=>x.fv)),
    paid:med(idx.map(i=>R.paid[i])),ratio:med(ratio),r10:q(ratio,.1),win:ratio.filter(x=>x>1).length/idx.length*100,both:a.filter((x,i)=>x.fv>b[i].fv&&x.d<b[i].d).length/idx.length*100,bd:med(b.map(x=>x.d)),bdMax:Math.max(...b.map(x=>x.d)),bc:med(b.map(x=>x.c))}; };
const Ls=Object.keys(r.meta.lumps), Ds=r.real[CAPS[0]].dca;
// ① 국면 최악 기준 순위
const CELLS=[]; for(const cap of CAPS){ for(const s of ['ALL','A','B']) CELLS.push(['real',cap,s]); for(const s of ['EARLY','MID','LATE']) CELLS.push(['syn',cap,s]); }
const rows=[]; for(const L of Ls) for(const D of Ds){ let mn=Infinity, ok=true, okX=true, avg=0, k=0; for(const [set,cap,sub] of CELLS){ const x=cell(set,cap,sub,L,D); if(!x){ if(set==='syn'&&D==='TSLA'){ continue; } ok=false; break; } mn=Math.min(mn,(x.ratio-1)*100); avg+=(x.ratio-1)*100; k++; if(x.d>x.bd+1e-9) ok=false; if(x.dMax>x.bdMax+2) okX=false; }
  if(k) rows.push({L,D,mn,avg:avg/k,ok,okX,n:nStrat(L,D)}); }
const nm=(L,D)=>`${LN[L]} | 적립 ${DN[D]}`;
console.log(`칸 ${CELLS.length}개(실제 전체·앞·뒤 · 합성 2000~05·2006~10·2011~ × ${CAPS.map(c=>c/1e4+'만').join('·')}$) · 기준 = ${nm('L0','BASKET')}`);
for(const [title,flt] of [['중앙 MDD 가 모든 칸에서 지금 이하 · 최악 MDD 지금+2 이하',x=>x.ok&&x.okX],['중앙 MDD 가 모든 칸에서 지금 이하(최악 MDD 무시)',x=>x.ok]]){
  const L=rows.filter(flt).sort((a,b)=>b.mn-a.mn); console.log(`\n▶ ${title} — ${L.length}개 · 칸 최소 5년 뒤 평가액 비(짝 중앙) 순`);
  for(const n of [1,2,3]){ const s=L.filter(x=>x.n===n).slice(0,8); if(!s.length) continue; console.log(`  전략 ${n}개`); for(const x of s) console.log(`    ${nm(x.L,x.D).padEnd(62)} 칸 최소 ${(x.mn>=0?'+':'')+f(x.mn)}% · 평균 ${(x.avg>=0?'+':'')+f(x.avg)}%`); } }
// ② 원금별 상세 — 주요 조합
const PICK=(process.env.PICK||'L0:BASKET,L0:CASH,L0:PLAN,L1:BASKET,L1:PLAN,L1:QLD,L1:GOLD,L1:QLD_G3,L2:BASKET,L2:PLAN,L2:QLD,L2:QQQ,L2:GOLD,L2:QLD_G2,L2:QLD_G3,L2:QQQ_G3,L2:LEV_G2,L2:USD,L2:CASH,L3:PLAN,L4:PLAN,L4:QLD_G3,L5:PLAN,L6:PLAN,L6:QLD,L8:PLAN,L8:QLD,L7:BASKET').split(',').map(x=>x.split(':'));
for(const set of ['real','syn']) for(const cap of CAPS){ if(!r[set]||!r[set][cap]) continue; const b=cell(set,cap,'ALL','L0','BASKET'); if(!b) continue;
  console.log(`\n══ ${set==='real'?'실제 2011~':'합성 2000~'} · 원금 ${cap/1e4}만$ + 매일 10$ (5년 창 ${b.n} · 낸 돈 중앙 ${f(b.paid/1e3,1)}k$) ══`);
  console.log('  '+'조합'.padEnd(62)+' 수익(TWR) 중앙/최악 | MDD 중앙/최악 | 5년 뒤 평가액 중앙 · 하위10% · 최악 | 지금 대비 평가액 비 중앙 · 하위10% · 이긴 창 · 둘다');
  for(const [L,D] of PICK){ const x=cell(set,cap,'ALL',L,D); if(!x) continue; console.log(`  ${nm(L,D).padEnd(62)} ${f(x.c).padStart(5)}/${f(x.cMin).padStart(6)} | −${f(x.d,0)}/−${f(x.dMax,0)} | ${f(x.fv/1e3,1).padStart(6)}k ${f(x.fv10/1e3,1).padStart(6)}k ${f(x.fvMin/1e3,1).padStart(6)}k | ${f(x.ratio,3)} ${f(x.r10,3)} ${f(x.win,0).padStart(3)}% ${f(x.both,0).padStart(3)}%`); } }
// ③ 적립 행선지만 — 일시금을 '플랜(새) 5/6 + 섀넌 1/6' 으로 고정하고 적립만 바꿈 (3만$)
for(const set of ['real','syn']){ const cap=30000; if(!r[set]||!r[set][cap]) continue; console.log(`\n적립 행선지 비교 (${set==='real'?'실제':'합성'} · 일시금 = ${LN.L2} · 3만$) — 평가액 중앙 · 지금 바구니 대비 비 중앙 · MDD 중앙/최악`);
  const base=cell(set,cap,'ALL','L2','BASKET'); for(const D of Ds){ const x=cell(set,cap,'ALL','L2',D); if(!x) continue; const R=r[set][cap]; const rr=med(R.windows.map((s,i)=>R.win.L2[D][i].fv/R.win.L2.BASKET[i].fv));
    console.log(`  ${DN[D].padEnd(26)} ${f(x.fv/1e3,1).padStart(6)}k · ${f(rr,3)} · −${f(x.d,0)}/−${f(x.dMax,0)} · 수익 ${f(x.c)}%`); } }
// ④ 위기 낙폭(창 안 · 위기 1년 전부터 들어 있던 창들의 중앙) — 3만$
for(const set of ['real','syn']){ const cap=30000; const R=r[set]&&r[set][cap]; if(!R) continue; const labs=[...new Set(R.win.L0.BASKET.flatMap(x=>Object.keys(x.cr)))];
  console.log(`\n위기 낙폭 (${set==='real'?'실제':'합성'} · 3만$ · 그 위기를 품은 5년 창들의 중앙) — ${labs.join(' · ')}`);
  for(const [L,D] of PICK.slice(0,20)){ if(!R.win[L]||!R.win[L][D]) continue; console.log(`  ${nm(L,D).padEnd(62)} `+labs.map(l=>{ const v=R.win[L][D].map(x=>x&&x.cr[l]).filter(Number.isFinite); return v.length?('−'+f(med(v),0)).padStart(4):'   -'; }).join(' ')); } }
