// 스트레스 진단 — 위기 구간마다 후보별 구간 손익 · 구간 안 최대 낙폭 · 전고점 회복까지 걸린 기간(개월)
// 후보는 처음부터 돌린 곡선을 잘라 본다(위기에 들어갈 때의 실제 상태 그대로). 1만$ · 비용·세금 포함.
// 사용: node stress.js
// 10-28: 플랜은 앱 조건(수수료 0.1%)으로 — 지금 플랜(TQQQ 는 Guard 바뀔 때만) · 새 플랜(Guard −3% + TECL 비대칭 + TQQQ 연 1회). 합성 무매는 SYNSOXL_S · 합성 플랜은 소수 주. 실제에 지금 진행 중인 2026-10 급락 구간을 더함.
const {open}=require('./imh'); const {prep,sim}=require('./px'); const {mk}=require('./plan_rules');
const toMap=eq=>{ const m={}; eq.forEach(([d,v])=>{ if(!String(d).endsWith('~')) m[d]=v; }); return m; };
const sum=(a,b,wa,wb)=>{ const m={}; Object.keys(b).forEach(d=>{ if(a[d]!=null) m[d]=a[d]*wa+b[d]*wb; }); return m; };
function judge(m,s,e,cap){ const ds=Object.keys(m).sort(); const pre=ds.filter(d=>d<s); if(!pre.length) return null;
  const v0=m[pre[pre.length-1]]; if(v0<cap*0.02) return '(이미 파산 상태 — 원금의 2% 미만)';
  const win=ds.filter(d=>d>=s&&d<=e); if(!win.length) return null;   // 플랜 곡선은 endTax:false 로 만든다(끝날 세금 미리 빼기 없음 — 진행 중 구간 낙폭이 부풀지 않게)
  // 낙폭은 그때까지의 최고점(구간 전 포함) 기준. 회복 = 바닥 뒤 그 최고점을 다시 넘은 날.
  let pk=Math.max(...pre.map(d=>m[d])), dd=0, tro=null, pkAt=pk; for(const d of win){ pk=Math.max(pk,m[d]); const x=(pk-m[d])/pk; if(x>dd){ dd=x; tro=d; pkAt=pk; } }
  const ret=m[win[win.length-1]]/v0-1; const rec=tro?ds.find(d=>d>tro&&m[d]>=pkAt):null;
  const mon=rec?Math.round((Date.parse(rec)-Date.parse(tro))/(30.44*864e5)):null;
  return `${(ret*100).toFixed(0).padStart(4)}% / 최고점 대비 낙폭 ${(dd*100).toFixed(0).padStart(2)}% (바닥 ${tro||'-'}) / 바닥→전고점 ${rec?String(mon).padStart(3)+'개월':' 아직'}`; }
(async()=>{ const {pg,close}=await open([{sym:'SOXL'},{sym:'SYNSOXL_S'}]);
  const runIM=async(o)=>toMap(await pg.evaluate(o=>{ const r=RUN(o); return r.eqs.map(x=>[x[0],x[1]]); },o));
  for(const [lab,TK,P,R,G,from,W] of [
    ['실제','SOXL',prep(['TECL','TQQQ']),'TECL','TQQQ','2011-01-01',[['2015 반도체 약세','2015-06-01','2016-02-29'],['2018 4분기','2018-09-01','2018-12-31'],['2020 코로나','2020-02-15','2020-03-31'],['2022 약세장','2021-12-27','2022-12-31'],['2024-25 관세','2024-07-10','2025-04-30'],['2026-10 급락(진행 중)','2026-10-01','2026-12-31']]],
    ['합성','SYNSOXL_S',prep(['SYNTECL','SYNTQQQ']),'SYNTECL','SYNTQQQ','2000-01-01',[['2000-02 닷컴','2000-03-10','2002-10-31'],['2007-09 금융위기','2007-10-09','2009-03-31'],['2011 유럽','2011-07-01','2011-10-31'],['2018 4분기','2018-09-01','2018-12-31'],['2020 코로나','2020-02-15','2020-03-31'],['2022 약세장','2021-12-27','2022-12-31']]]]){
    const plOf=p=>toMap(sim(P,Object.assign({cap:10000,from,fee:0.001,frac:lab==='합성',endTax:false},mk(P,R,G,p))).eq);
    const pl=plOf({gsb:1e9}), pln=plOf({gbOn:0.01,gbOff:0.03,sbDn:0,sbUp:0.15,gReb:'y'});
    const d0=Object.keys(pl).sort()[0]; const imA=await runIM({cap:10000,tkr:TK,from:d0,autoTp:true});
    const C={'무매 익절 자동':imA,'지금 플랜(앱)':pl,'새 플랜(앱+연1회)':pln,'무매1/3+지금 플랜2/3':sum(imA,pl,1/3,2/3),'무매1/3+새 플랜2/3':sum(imA,pln,1/3,2/3)};
    console.log(`\n■ ${lab} (${d0}~ 처음부터 돌린 곡선) — 구간 손익 / 최고점 대비 최대 낙폭(바닥 날짜) / 바닥에서 전고점 회복까지`);
    for(const [wn,s,e] of W){ console.log(`  [${wn} ${s}~${e}]`); for(const [k,m] of Object.entries(C)){ const j=judge(m,s,e,10000); if(j) console.log(`    ${k.padEnd(18)} ${j}`); } } }
  await close(); })().catch(e=>{console.error(e);process.exit(1);});
