// SCHDX(11-10 · 사용자 "sgov대신 schd사면 어떨까") — SCHD 총수익(배당 재투자)에서 배당세 15.4% 를 뺀 곡선. 상장(2011-10-20) 전은 VEIPX(뱅가드 배당주 펀드 · 1988~) 총수익 − 연 0.5%(배당 3.3% × 15.4%)로 잇는다.
// 사용: node mk_schdx.js   → data/SCHDX.json · data/SYNSCHDX.json(같은 내용 · 합성 접두사용) + 대용 자료 점검 출력
const fs=require('fs'),path=require('path'); const L=s=>JSON.parse(fs.readFileSync(path.join(__dirname,'data',s+'.json')));
const S=L('SCHD'), V=L('VEIPX'); const raw={}; S.raw.forEach(x=>raw[x.date]=x.close);
const out=[]; let p=100; const first=S.series[0].date;
const v=V.series.filter(x=>x.date<=first); for(let i=0;i<v.length;i++){ if(i) p*=(v[i].close/v[i-1].close)*(1-0.005/252); out.push({date:v[i].date,close:p}); }
for(let i=1;i<S.series.length;i++){ const a=S.series[i-1],b=S.series[i]; const tr=b.close/a.close-1, pr=raw[b.date]/raw[a.date]-1, dv=Math.max(0,tr-pr); p*=1+pr+(dv>1e-4?dv*(1-0.154):dv); out.push({date:b.date,close:p}); }
for(const n of ['SCHDX','SYNSCHDX']) fs.writeFileSync(path.join(__dirname,'data',n+'.json'),JSON.stringify({symbol:n,series:out}));
const cagr=(a,s,e)=>{ const x=a.filter(z=>z.date>=s&&z.date<=e); const y=(Date.parse(x[x.length-1].date)-Date.parse(x[0].date))/365.25/864e5; return ((x[x.length-1].close/x[0].close)**(1/y)-1)*100; };
const mdd=(a,s,e)=>{ let pk=0,m=0; a.filter(z=>z.date>=s&&z.date<=e).forEach(z=>{ pk=Math.max(pk,z.close); m=Math.max(m,1-z.close/pk); }); return m*100; };
const mon=a=>{ const m={}; a.forEach(z=>m[z.date.slice(0,7)]=z.close); const k=Object.keys(m).sort(); const r={}; for(let i=1;i<k.length;i++) r[k[i]]=m[k[i]]/m[k[i-1]]-1; return r; };
const corr=(A,B,s)=>{ const a=mon(A),b=mon(B),k=Object.keys(a).filter(x=>x>=s&&b[x]!=null); const ma=k.reduce((t,x)=>t+a[x],0)/k.length, mb=k.reduce((t,x)=>t+b[x],0)/k.length; let c=0,va=0,vb=0; k.forEach(x=>{ c+=(a[x]-ma)*(b[x]-mb); va+=(a[x]-ma)**2; vb+=(b[x]-mb)**2; }); return c/Math.sqrt(va*vb); };
const f=x=>x.toFixed(1), E='2026-11-09';
console.log('SCHD 총수익 '+f(cagr(S.series,first,E))+'% · 배당세 뺀 SCHDX '+f(cagr(out,first,E))+'% · VEIPX '+f(cagr(V.series,first,E))+'% · SPY '+f(cagr(L('SPY').series,first,E))+'% (2011-10~) · 월수익 상관 SCHD~VEIPX '+corr(S.series,V.series,'2011-11').toFixed(3));
for(const [n,s,e] of [['닷컴','2000-03-10','2002-10-31'],['금융위기','2007-10-09','2009-03-31'],['2020','2020-02-15','2020-03-31'],['2022','2021-12-27','2022-12-31'],['2025','2025-02-01','2025-04-30']])
  console.log(n.padEnd(6),'낙폭 SCHDX',f(mdd(out,s,e)),'· SPY',f(mdd(L('SPY').series,s,e)),'· VEIPX',f(mdd(V.series,s,e)),(s>'2006-12'?'· VYM '+f(mdd(L('VYM').series,s,e))+' · DVY '+f(mdd(L('DVY').series,s,e)):''),(s>=first?'· SCHD '+f(mdd(S.series,s,e)):''));
