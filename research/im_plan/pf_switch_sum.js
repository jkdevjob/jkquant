// pf_switch.js 결과 요약(11-11) — 상태 묶음별 B(지금 옮김) ÷ A(사이클 끝까지 기다림) · 해(국면)별로 나눠 한 사건이 판을 정하는지 본다.
// 사용: node pf_switch_sum.js out.json [out2.json …]   env: BK=D,M (해별 표를 낼 묶음)
const fs=require('fs');
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b.length?b[Math.floor(p*(b.length-1))]:NaN; }, f=(x,d=3)=>Number.isFinite(x)?x.toFixed(d):'-';
const BK={D:x=>x.inv>=.90&&x.loss<=-.30, 'D-':x=>x.inv>=.80&&x.loss<=-.20, 'D+':x=>x.inv>=.95&&x.loss<=-.40, M:x=>x.inv>=.30&&x.inv<=.70&&x.loss<=-.05&&x.loss>=-.30,
  'D1':x=>x.inv>=.90&&x.loss<=-.30&&x.age!=null&&x.age<=250};   // D1 = D 중 사이클 나이 1년(250거래일) 안 — 사후 구분(갇힌 사이클 빼기 · 사전 기준 아님)
const YB=(process.env.BK||'D,M').split(',');
const line=R=>{ const rt=R.map(x=>x.ratio); return `n ${String(R.length).padStart(4)}(달 ${String(new Set(R.map(x=>x.t.slice(0,7))).size).padStart(3)}) · B÷A 중앙 ×${f(q(rt,.5))} [하10 ×${f(q(rt,.1))} · 상10 ×${f(q(rt,.9))}] · B 이긴 날 ${f(rt.filter(x=>x>1).length/R.length*100,0)}% · MDD 중앙 A ${f(q(R.map(x=>x.mddA),.5),1)} / B ${f(q(R.map(x=>x.mddB),.5),1)} · 최악 A ${f(Math.max(...R.map(x=>x.mddA)),1)} / B ${f(Math.max(...R.map(x=>x.mddB)),1)} · 사이클 못 끝냄 ${f(R.filter(x=>!x.tau).length/R.length*100,0)}% · 끝 ÷ 그날 평가액 중앙 A ${f(q(R.map(x=>x.A/x.V0),.5),2)} / B ${f(q(R.map(x=>x.B/x.V0),.5),2)}`+(R[0].C&&R[0].C[12]&&R[0].C[12].v!=null?' | 기한 C÷A '+Object.keys(R[0].C).map(N=>{ const c=R.map(x=>x.C[N].v/x.A); return `C${N} ×${f(q(c,.5))}[하10 ×${f(q(c,.1))}·상10 ×${f(q(c,.9))}] 잘림 ${f(R.filter(x=>x.C[N].cut).length/R.length*100,0)}% MDD ${f(q(R.map(x=>x.C[N].mdd),.5),1)}`; }).join(' · ')+` · C12÷B ×${f(q(R.map(x=>x.C[12].v/x.B),.5))}`:''); };
for(const file of process.argv.slice(2)){ const D=JSON.parse(fs.readFileSync(file,'utf8'));
  for(const ds of Object.keys(D.sets)) for(const cap of Object.keys(D.sets[ds])) for(const H of Object.keys(D.sets[ds][cap])){ const rows=D.sets[ds][cap][H];
    console.log(`\n=== ${ds} ${cap/1e4}만$ · ${H}년 뒤 · 공제 몫 ${f(D.meta.DEDW,3)}`);
    for(const [nm,fn] of Object.entries(BK)){ const R=rows.filter(fn); console.log(`  ${nm.padEnd(3)} ${R.length?line(R):'없음'}`); }
    for(const nm of YB){ const R=rows.filter(BK[nm]); const ys=[...new Set(R.map(x=>x.t.slice(0,4)))].sort();
      console.log(`  -- ${nm} 해별(결정한 해)`); for(const y of ys){ const Y=R.filter(x=>x.t.startsWith(y)); console.log(`     ${y} ${line(Y)}`); } } } }
