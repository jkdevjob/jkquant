// 스트레스 진단 — 위기 구간마다 후보별 구간 손익 · 구간 안 최대 낙폭 · 전고점 회복까지 걸린 기간(개월)
// 후보는 처음부터 돌린 곡선을 잘라 본다(위기에 들어갈 때의 실제 상태 그대로). 1만$ · 비용·세금 포함.
// 사용: node stress.js
const {open}=require('./imh'); const {prep,sim}=require('./px'); const {mk}=require('./plan_rules');
const toMap=eq=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); return m; };
const sum=(a,b,wa,wb)=>{ const m={}; Object.keys(b).forEach(d=>{ if(a[d]!=null) m[d]=a[d]*wa+b[d]*wb; }); return m; };
function judge(m,s,e,cap){ const ds=Object.keys(m).sort(); const pre=ds.filter(d=>d<s); if(!pre.length) return null;
  const v0=m[pre[pre.length-1]]; if(v0<cap*0.02) return '(이미 파산 상태 — 원금의 2% 미만)';
  const win=ds.filter(d=>d>=s&&d<=e); if(!win.length) return null;
  // 낙폭은 그때까지의 최고점(구간 전 포함) 기준. 회복 = 바닥 뒤 그 최고점을 다시 넘은 날.
  let pk=Math.max(...pre.map(d=>m[d])), dd=0, tro=null, pkAt=pk; for(const d of win){ pk=Math.max(pk,m[d]); const x=(pk-m[d])/pk; if(x>dd){ dd=x; tro=d; pkAt=pk; } }
  const ret=m[win[win.length-1]]/v0-1; const rec=tro?ds.find(d=>d>tro&&m[d]>=pkAt):null;
  const mon=rec?Math.round((Date.parse(rec)-Date.parse(tro))/(30.44*864e5)):null;
  return `${(ret*100).toFixed(0).padStart(4)}% / 최고점 대비 낙폭 ${(dd*100).toFixed(0).padStart(2)}% (바닥 ${tro||'-'}) / 바닥→전고점 ${rec?String(mon).padStart(3)+'개월':' 아직'}`; }
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL'}]);
  const runIM=async(o)=>toMap(await pg.evaluate(o=>{ const r=RUN(o); return r.eqs.map(x=>[x[0],x[1]]); },o));
  for(const [lab,TK,P,R,G,from,W] of [
    ['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',[['2015 반도체 약세','2015-06-01','2016-02-29'],['2018 4분기','2018-09-01','2018-12-31'],['2020 코로나','2020-02-15','2020-03-31'],['2022 약세장','2021-12-27','2022-12-31'],['2024-25 관세','2024-07-10','2025-04-30']]],
    ['합성','SYNSOXL',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',[['2000-02 닷컴','2000-03-10','2002-10-31'],['2007-09 금융위기','2007-10-09','2009-03-31'],['2011 유럽','2011-07-01','2011-10-31'],['2018 4분기','2018-09-01','2018-12-31'],['2020 코로나','2020-02-15','2020-03-31'],['2022 약세장','2021-12-27','2022-12-31']]]]){
    const pl=toMap(sim(P,Object.assign({cap:10000,from},mk(P,R,G,{}))).eq), plg=toMap(sim(P,Object.assign({cap:10000,from},mk(P,R,G,{gbOn:0.01,gbOff:0.03}))).eq);
    const d0=Object.keys(pl).sort()[0]; const imB=await runIM({cap:10000,tkr:TK,from:d0}), imA=await runIM({cap:10000,tkr:TK,from:d0,autoTp:true});
    const plga=toMap(sim(P,Object.assign({cap:10000,from},mk(P,R,G,{gbOn:0.01,gbOff:0.03,sbDn:0,sbUp:0.15}))).eq);
    const C={'무매 기본':imB,'무매 익절 자동':imA,'플랜':pl,'플랜 Guard −3%':plg,'플랜 Guard−3%+TECL비대칭':plga,'무매1/3+플랜2/3 따로':sum(imA,pl,1/3,2/3)};
    console.log(`\n■ ${lab} (${d0}~ 처음부터 돌린 곡선) — 구간 손익 / 최고점 대비 최대 낙폭(바닥 날짜) / 바닥에서 전고점 회복까지`);
    for(const [wn,s,e] of W){ console.log(`  [${wn} ${s}~${e}]`); for(const [k,m] of Object.entries(C)){ const j=judge(m,s,e,10000); if(j) console.log(`    ${k.padEnd(18)} ${j}`); } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
