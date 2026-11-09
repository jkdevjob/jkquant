// 포트폴리오 매일 연구(11-09~) — trio_dca.js 출력에서 후보를 기준선(L11 · 플랜에 매달)과 같은 5년 창끼리 짝지어 본다.
// 사용: node pf_sum.js out.json   env: BASE=L11:PLAN  CANDS=L13:PLAN,L9:PLAN,…(안 주면 기준 말고 전부)
// 칸: 실제 전체 · 앞(2011~15 시작) · 뒤(2016~ 시작) | 합성 전체 · 표본 밖 EARLY(2000~05) · MID(2006~10) · LATE(2011~) × 1만$ · 3만$ · 10만$
// 값: 평가액 짝 비 중앙(후보 ÷ 기준) · 이긴 창 % · 단위 수익(TWR) 짝 차 중앙 · MDD 중앙/최악(후보 vs 기준)
// (짝을 안 지은 중앙끼리 빼면 분포 모양 차이로 부호가 뒤집힐 수 있다 — 11-09 확인 · 그래서 짝 차만 쓴다)
const r=require(require('path').resolve(process.argv[2]||'pf_w_out.json')); const LN=r.meta.lname, DN=r.meta.dname;
const q=(a,p)=>{ const b=a.filter(Number.isFinite).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }, med=a=>q(a,.5), f=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'-';
const [BL,BD]=(process.env.BASE||'L11:PLAN').split(':');
const SUB={real:[['전체',s=>true],['앞 2011~15',s=>s<'2016-01-01'],['뒤 2016~',s=>s>='2016-01-01']], syn:[['전체',s=>true],['표본밖 2000~05',s=>s<'2006-01-01'],['표본밖 2006~10',s=>s>='2006-01-01'&&s<'2011-01-01'],['2011~',s=>s>='2011-01-01']]};
const sets=Object.keys(r).filter(k=>k!=='meta'); const caps=Object.keys(r[sets[0]]).map(Number);
const all=[]; for(const L of Object.keys(r[sets[0]][caps[0]].win)) for(const D of Object.keys(r[sets[0]][caps[0]].win[L])) if(!(L===BL&&D===BD)) all.push(L+':'+D);
const CANDS=process.env.CANDS?process.env.CANDS.split(','):all;
const cell=(set,cap,flt,L,D)=>{ const R=r[set][cap]; const idx=R.windows.map((s,i)=>flt(s)?i:-1).filter(i=>i>=0); const a=idx.map(i=>R.win[L][D][i]), b=idx.map(i=>R.win[BL][BD][i]);
  if(!idx.length||a.some(x=>!x)||b.some(x=>!x)) return null; const ratio=a.map((x,i)=>x.fv/b[i].fv);
  return {n:idx.length,ratio:med(ratio),win:ratio.filter(x=>x>1).length/idx.length*100,fv:med(a.map(x=>x.fv)),dc:med(a.map((x,i)=>x.c-b[i].c)),d:med(a.map(x=>x.d)),dB:med(b.map(x=>x.d)),dX:Math.max(...a.map(x=>x.d)),dXB:Math.max(...b.map(x=>x.d))}; };
console.log(`자료 끝 ${r.meta.end} · 기준 = ${LN[BL]} | 적립 ${DN[BD]} · 창 실제 ${r.real?r.real[caps[0]].windows.length:'-'} · 합성 ${r.syn?r.syn[caps[0]].windows.length:'-'}`);
for(const set of sets) for(const cap of caps){ const R=r[set][cap]; const b=R.windows.map((s,i)=>R.win[BL][BD][i]);
  console.log(`  기준 ${set} ${cap/1e4}만$: 평가액 중앙 ${f(med(b.map(x=>x.fv))/1e3)}k · 하10 ${f(q(b.map(x=>x.fv),.1)/1e3)}k · 최악 ${f(Math.min(...b.map(x=>x.fv))/1e3)}k · 연 중앙 ${f(med(b.map(x=>x.c)))} · MDD 중앙 ${f(med(b.map(x=>x.d)),0)} · 최악 ${f(Math.max(...b.map(x=>x.d)),0)}`); }
for(const id of CANDS){ const [L,D]=id.split(':'); console.log(`\n■ ${LN[L]} | 적립 ${DN[D]}  (vs 기준)`);
  for(const set of sets) for(const cap of caps){ const parts=SUB[set].map(([nm,flt])=>{ const x=cell(set,cap,flt,L,D); return x?`${nm} ×${f(x.ratio,3)} ${f(x.win,0)}%`:`${nm} -`; });
    const x=cell(set,cap,()=>true,L,D);
    console.log(`  ${set.padEnd(4)} ${String(cap/1e4).padStart(2)}만$ | ${parts.join(' · ')} | 연(TWR) 짝 차 중앙 ${(x.dc>=0?"+":"")+f(x.dc,2)}%p · MDD 중앙 ${f(x.d,1)}/${f(x.dB,1)} · 최악 ${f(x.dX,1)}/${f(x.dXB,1)}`); } }
