// 내재변동성(VXN·VIX)이 TECL 다음 20일 실현변동성을 σ20(과거 20일)보다 잘 맞히나 — 슬리브 크기 결정에 새 정보가 되나(11-10 탐침)
const fs=require('fs'); const L=s=>{ const m={}; JSON.parse(fs.readFileSync('data/'+s+'.json','utf8')).series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; };
const T=L(process.argv[2]||'TECL'), VX=L('VXN'), VI=L('VIX'); const from=process.argv[3]||'2011-01-01', to=process.argv[4]||'2026-12-31';
const ds=Object.keys(T).sort(); const r=ds.map((d,i)=>i?Math.log(T[d]/T[ds[i-1]]):0);
const sd=(a)=>{ const m=a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/a.length*252); };
const rows=[]; let lastVX=null,lastVI=null;
for(let i=21;i<ds.length-21;i++){ const d=ds[i]; if(VX[d]!=null) lastVX=VX[d]; if(VI[d]!=null) lastVI=VI[d]; if(d<from||d>to||lastVX==null) continue;
  const back=sd(r.slice(i-19,i+1)), fwd=sd(r.slice(i+1,i+21)); rows.push({d,back,fwd,vxn:lastVX/100,vix:lastVI/100}); }
const corr=(a,b)=>{ const n=a.length, ma=a.reduce((x,y)=>x+y,0)/n, mb=b.reduce((x,y)=>x+y,0)/n; let sab=0,saa=0,sbb=0; for(let i=0;i<n;i++){ sab+=(a[i]-ma)*(b[i]-mb); saa+=(a[i]-ma)**2; sbb+=(b[i]-mb)**2; } return sab/Math.sqrt(saa*sbb); };
const med=a=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(b.length/2)]; };
const F=rows.map(x=>x.fwd), B=rows.map(x=>x.back), X=rows.map(x=>x.vxn), I=rows.map(x=>x.vix);
const kX=med(rows.map(x=>x.back/x.vxn)), kI=med(rows.map(x=>x.back/x.vix));
console.log(`${process.argv[2]||'TECL'} ${from}~${to} · ${rows.length}일 · σ20(과거)/VXN 비율 중앙 ${kX.toFixed(2)} · σ20/VIX ${kI.toFixed(2)} · σ20 중앙 ${(med(B)*100).toFixed(0)}% · 다음20일 σ 중앙 ${(med(F)*100).toFixed(0)}%`);
const mae=(p)=>med(rows.map((x,i)=>Math.abs(Math.log(p[i]/x.fwd))));
const show=(nm,p)=>console.log(`  ${nm.padEnd(26)} 상관(다음 20일 σ) ${corr(p,F).toFixed(3)} · 로그오차 중앙 ${mae(p).toFixed(3)} · 상관(log) ${corr(p.map(Math.log),F.map(Math.log)).toFixed(3)}`);
show('σ20 과거(지금 규칙)',B); show('k×VXN',X.map(v=>v*kX)); show('k×VIX',I.map(v=>v*kI));
show('max(σ20, k×VXN)',B.map((b,i)=>Math.max(b,X[i]*kX))); show('평균(σ20, k×VXN)',B.map((b,i)=>(b+X[i]*kX)/2)); show('기하평균(σ20, k×VXN)',B.map((b,i)=>Math.sqrt(b*X[i]*kX)));
show('max(σ20, k×VIX)',B.map((b,i)=>Math.max(b,I[i]*kI)));
// 큰 하락 전날: σ20 과 k×VXN 중 누가 더 높았나 (TECL 하루 −8% 넘게 빠진 날 전날)
let hiX=0,hiB=0,n=0; for(let i=1;i<rows.length;i++){ const d=rows[i].d; const j=ds.indexOf(d); if(j<1) continue; if(r[j]<=Math.log(0.92)){ n++; const prev=rows[i-1]; if(prev.vxn*kX>prev.back) hiX++; else hiB++; } }
console.log(`  TECL −8% 날 ${n}일 전날: k×VXN 쪽이 높았던 날 ${hiX} · σ20 쪽 ${hiB}`);
// 비중 = min(1, s0²/σ²) 의 평균(노출 수준) — 두 추정치가 같은 평균 노출인지
const w=(p)=>p.reduce((a,s)=>a+Math.min(1,.55*.55/(s*s)),0)/p.length; console.log(`  평균 슬리브 비중: σ20 ${(w(B)*100).toFixed(1)}% · k×VXN ${(w(X.map(v=>v*kX))*100).toFixed(1)}% · max ${(w(B.map((b,i)=>Math.max(b,X[i]*kX)))*100).toFixed(1)}% · 기하평균 ${(w(B.map((b,i)=>Math.sqrt(b*X[i]*kX)))*100).toFixed(1)}%`);
