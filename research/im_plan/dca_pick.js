// 11-08 사용자 "3번을 끝내고 1번에 적립하라고? 아까는 usd랑 gldm에 하라며" — 일시금(플랜 기본 2/3 + 섀넌 USD 1/3)을 고정하고 적립처만 비교. 입력: trio_dca.js 를 SIZEPREV=1 로 돌린 출력(trio_dca_sp.json · 같은 폴더).
const r=require('./trio_dca_sp.json'); const LN=r.meta.lname, DN=r.meta.dname; const f=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'-';
const q=(a,p)=>{ const b=a.filter(x=>Number.isFinite(x)).sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }, med=a=>q(a,.5);
const SUB={real:{ALL:s=>true,A:s=>s<='2013-10-01',B:s=>s>='2018-10-01'}, syn:{EARLY:s=>s<='2005-10-01',MID:s=>s>='2006-01-01'&&s<='2010-10-01',LATE:s=>s>='2011-01-01',ALL:s=>true}};
const cell=(set,cap,sub,L,D,BL='L0',BD='BASKET')=>{ const R=r[set]&&r[set][cap]; if(!R||!R.win[L]||!R.win[L][D]) return null; const idx=R.windows.map((s,i)=>SUB[set][sub](s)?i:-1).filter(i=>i>=0);
  const a=idx.map(i=>R.win[L][D][i]), b=idx.map(i=>R.win[BL][BD][i]); if(a.some(x=>!x)||b.some(x=>!x)) return null; const ratio=a.map((x,i)=>x.fv/b[i].fv);
  return {n:idx.length,c:med(a.map(x=>x.c)),d:med(a.map(x=>x.d)),dMax:Math.max(...a.map(x=>x.d)),fv:med(a.map(x=>x.fv)),ratio:med(ratio),win:ratio.filter(x=>x>1).length/idx.length*100}; };
const CAPS=Object.keys(r.real).map(Number);
const CELLS=[]; for(const cap of CAPS){ for(const s of ['ALL','A','B']) CELLS.push(['real',cap,s]); for(const s of ['EARLY','MID','LATE']) CELLS.push(['syn',cap,s]); }
const PICK=[['L0','BASKET'],['L11','PLAN'],['L11','USD_G3'],['L11','BASKET'],['L11','USD'],['L11','GOLD'],['L11','CASH'],['L9','PLAN'],['L9','USD_G3']];
console.log('자료 끝',r.meta.end,'· 기준 = 지금(무매 1만 + 플랜 기본 2만 + 지금 바구니)');
for(const [L,D] of PICK){
  const a=cell('real',30000,'ALL',L,D), s=cell('syn',30000,'ALL',L,D);
  let mn=Infinity; for(const [set,cap,sub] of CELLS){ const x=cell(set,cap,sub,L,D); if(x) mn=Math.min(mn,(x.ratio-1)*100); }
  console.log(`${(LN[L]+' | 적립 '+DN[D]).padEnd(52)} 실제3만: 평가액 ${f(a.fv/1e3,1)}k · 지금 대비 ${f(a.ratio,3)} · 이긴 창 ${f(a.win,0)}% · MDD ${f(a.d,0)}/${f(a.dMax,0)} | 합성3만: ${f(s.ratio,3)} · ${f(s.win,0)}% · MDD ${f(s.d,0)}/${f(s.dMax,0)} | 18칸 최소 ${f(mn)}%`);
}
// 같은 일시금(기본 2/3 + 섀넌 1/3)에서 적립처만 비교: 플랜에 매달 vs USD7·금3 (짝 비)
for(const set of ['real','syn']) for(const cap of CAPS){ const R=r[set][cap]; const rr=med(R.windows.map((s,i)=>R.win.L11.USD_G3[i].fv/R.win.L11.PLAN[i].fv)); const w=R.windows.filter((s,i)=>R.win.L11.USD_G3[i].fv>R.win.L11.PLAN[i].fv).length/R.windows.length*100;
  const dP=med(R.win.L11.PLAN.map(x=>x.d)), dU=med(R.win.L11.USD_G3.map(x=>x.d)), mP=Math.max(...R.win.L11.PLAN.map(x=>x.d)), mU=Math.max(...R.win.L11.USD_G3.map(x=>x.d));
  console.log(`  [${set} ${cap/1e4}만$] USD7·금3 ÷ 플랜에 매달: 평가액 비 중앙 ${f(rr,3)} · USD7·금3 이 큰 창 ${f(w,0)}% · MDD 중앙 ${f(dP,0)} vs ${f(dU,0)} · 최악 ${f(mP,0)} vs ${f(mU,0)}`); }
