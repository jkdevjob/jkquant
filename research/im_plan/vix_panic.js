// VIX 공포 → 진정 재진입 가설 탐침(11-10): VIX 가 처음 ≥ HI 가 된 사건마다, 그 뒤 처음 < LO 로 내려온 날(진정일)과 지수(NDX) 경로를 본다.
// 비교: 진정일에 사면 → 6개월 · 12개월 뒤 수익, 그리고 '지금 Guard 규칙'(SYNTQQQ/TQQQ 종가 > SMA225×1.01)이 다시 켜지는 날까지의 수익.
const fs=require('fs'); const L=s=>{ const m={}; JSON.parse(fs.readFileSync('data/'+s+'.json','utf8')).series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; };
const HI=+(process.env.HI||40), LO=+(process.env.LO||30); const VI=L('VIX'), N=L('NDX'), Q=L('SYNTQQQ');
const ds=Object.keys(N).filter(d=>Q[d]&&d>='1990-01-01').sort(); const qa=ds.map(d=>Q[d]); const ma=[]; let s=0; for(let i=0;i<qa.length;i++){ s+=qa[i]; if(i>=225) s-=qa[i-225]; ma.push(i>=224?s/225:null); }
let lastVI=null; const vi=ds.map(d=>{ if(VI[d]!=null) lastVI=VI[d]; return lastVI; });
// Guard 상태(지금 규칙 ±1%) — 전일 종가 기준이지만 여기선 당일로 단순화
const g=[]; let st=null; for(let i=0;i<ds.length;i++){ const m=ma[i]; if(m==null){ g.push(null); continue; } if(st===null) st=qa[i]>m; if(qa[i]>m*1.01) st=true; else if(qa[i]<m*0.99) st=false; g.push(st); }
const idx=d=>ds.indexOf(d); const ret=(i,j)=>(N[ds[j]]/N[ds[i]]-1)*100;
console.log(`VIX ≥ ${HI} 사건 → 처음 < ${LO} (진정일) · NDX 수익: 진정일→6개월 · →12개월 · 진정일 → 지금 Guard 가 다시 켜지는 날(SMA225 +1%) 까지 · 그 사이 최저(진정일 대비)`);
let i=0; while(i<ds.length){ if(vi[i]!=null&&vi[i]>=HI){ const start=i; let pk=vi[i], pkD=ds[i]; let j=i; while(j<ds.length&&!(vi[j]<LO)){ if(vi[j]>pk){ pk=vi[j]; pkD=ds[j]; } j++; } if(j>=ds.length){ console.log(`  ${ds[start]} VIX≥${HI} … 아직 < ${LO} 아님`); break; }
    const calm=j; let k=calm; while(k<ds.length&&!(g[k]===true)) k++; const on=k<ds.length?k:null; const h6=Math.min(ds.length-1,calm+126), h12=Math.min(ds.length-1,calm+252);
    let lo=Infinity; for(let t=calm;t<=(on??h12);t++) lo=Math.min(lo,N[ds[t]]/N[ds[calm]]-1);
    console.log(`  ${ds[start]} ≥${HI} (최고 ${pk.toFixed(0)} ${pkD}) → 진정 ${ds[calm]} (${calm-start}일) | NDX +6개월 ${ret(calm,h6).toFixed(0)}% · +12개월 ${ret(calm,h12).toFixed(0)}% | Guard 재점등 ${on?ds[on]+' ('+(on-calm)+'일 뒤) 그때까지 NDX '+ret(calm,on).toFixed(0)+'%':'없음'} · 그 사이 최저 ${(lo*100).toFixed(0)}% · 진정일 Guard ${g[calm]?'ON':'OFF'}`);
    i=j; } else i++; }
