// 11-08 — 적립 종목 따로 보기: AMDY(AMD 커버드콜 · 분배금 배당소득세 15.4%) vs AMD · SPCX(2026-06 상장) · 일수익 상관
const fs=require('fs'); const J=s=>JSON.parse(fs.readFileSync(__dirname+'/data/'+s+'.json'));
const mapOf=(a)=>{ const m={}; a.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; };
const f=(x,d=1)=>Number.isFinite(x)?x.toFixed(d):'-';
const ddOf=v=>{ let pk=0,m=0; v.forEach(x=>{ if(x>pk) pk=x; else m=Math.max(m,(pk-x)/pk); }); return m*100; };
const yrs=(a,b)=>(Date.parse(b)-Date.parse(a))/(365.25*864e5);
// ① AMDY vs AMD — 세전 총수익(조정 종가) · 세후(분배금 × (1−0.154) 를 그날 원가로 재투자) · 매일 1$ 적립
{ const A=J('AMDY'), B=J('AMD'); const ar=mapOf(A.raw), as=mapOf(A.series), bs=mapOf(B.series); const div={}; (A.dividends||[]).forEach(x=>div[x.date]=(div[x.date]||0)+x.amount);
  const ds=Object.keys(ar).filter(d=>bs[d]!=null).sort(); const d0=ds[0], d1=ds[ds.length-1];
  let u=1; const net=[]; for(const d of ds){ if(div[d]) u+=u*div[d]*(1-0.154)/ar[d]; net.push(u*ar[d]); }
  const preTR=as[d1]/as[d0], netTR=net[net.length-1]/net[0], amd=bs[d1]/bs[d0], px=ar[d1]/ar[d0], y=yrs(d0,d1);
  const sumDiv=Object.entries(div).filter(([d])=>d>=d0&&d<=d1).reduce((a,[,v])=>a+v,0);
  console.log(`AMDY vs AMD ${d0}~${d1} (${f(y,2)}년)`);
  console.log(`  AMD 주가 ×${f(amd,2)} (연 ${f((Math.pow(amd,1/y)-1)*100)}%) · MDD ${f(ddOf(ds.map(d=>bs[d])),0)}%`);
  console.log(`  AMDY 가격만 ×${f(px,2)} · 세전 분배 재투자 ×${f(preTR,2)} (연 ${f((Math.pow(preTR,1/y)-1)*100)}%) · 세후(15.4%) 재투자 ×${f(netTR,2)} (연 ${f((Math.pow(netTR,1/y)-1)*100)}%) · MDD 세전 ${f(ddOf(ds.map(d=>as[d])),0)}%`);
  console.log(`  분배금 합 ${f(sumDiv,2)}$/주 = 시작가의 ${f(sumDiv/ar[d0]*100,0)}% · 횟수 ${Object.keys(div).length}`);
  // 매일 1$ 적립
  const dca=(m)=>{ let un=0,paid=0; for(const d of ds){ un+=0.9975/m[d]; paid+=1; } return un*m[d1]/paid; };
  let un=0,paid=0; for(const d of ds){ if(div[d]) un+=un*div[d]*(1-0.154)/ar[d]; un+=0.9975/ar[d]; paid+=1; } const amdyNet=un*ar[d1]/paid;
  console.log(`  매일 1$ 적립 (${ds.length}일): 낸 돈 1$ 당 지금 가치 — AMD ${f(dca(bs),2)} · AMDY 세전 ${f(dca(as),2)} · AMDY 세후 ${f(amdyNet,2)}`);
  // 해마다
  for(const yy of ['2023','2024','2025','2026']){ const dd=ds.filter(d=>d.slice(0,4)===yy); if(dd.length<2) continue; const a=dd[0],b=dd[dd.length-1]; console.log(`    ${yy}: AMD ${f((bs[b]/bs[a]-1)*100,0)}% · AMDY 세전 ${f((as[b]/as[a]-1)*100,0)}%`); } }
// ② SPCX
{ const S=J('SPCX'); const s=S.series; const d0=s[0].date, d1=s[s.length-1].date; const v=s.map(x=>x.close); const r=[]; for(let i=1;i<v.length;i++) r.push(v[i]/v[i-1]-1);
  const sd=Math.sqrt(r.reduce((a,x)=>a+x*x,0)/r.length-(r.reduce((a,x)=>a+x,0)/r.length)**2)*Math.sqrt(252)*100; const hi=Math.max(...v), lo=Math.min(...v);
  let un=0; for(const x of s) un+=0.9975/x.close; const dcaV=un*v[v.length-1]/s.length;
  console.log(`\nSPCX ${d0}~${d1} (${s.length}일): 첫 종가 ${f(v[0],2)} → ${f(v[v.length-1],2)} (${f((v[v.length-1]/v[0]-1)*100,0)}%) · 최고 ${f(hi,2)} 최저 ${f(lo,2)} · MDD ${f(ddOf(v),0)}% · 연율 변동성 ${f(sd,0)}% · 매일 1$ 적립 1$ 당 ${f(dcaV,2)}`); }
// ③ 일수익 상관
const corr=(a,b,from,to)=>{ const ds=Object.keys(a).filter(d=>b[d]!=null&&d>=from&&d<=to).sort(); const x=[],y=[]; for(let i=1;i<ds.length;i++){ x.push(a[ds[i]]/a[ds[i-1]]-1); y.push(b[ds[i]]/b[ds[i-1]]-1); }
  const mx=x.reduce((p,q)=>p+q,0)/x.length, my=y.reduce((p,q)=>p+q,0)/y.length; let sxy=0,sxx=0,syy=0; for(let i=0;i<x.length;i++){ sxy+=(x[i]-mx)*(y[i]-my); sxx+=(x[i]-mx)**2; syy+=(y[i]-my)**2; } return sxy/Math.sqrt(sxx*syy); };
const T=['SOXL','TECL','TQQQ','USD','ROM','QLD','GOLDX','TSLA','AMD','AMDY','SPCX']; const M={}; for(const t of T) M[t]=mapOf(J(t).series);
for(const [from,to,lab,list] of [['2018-07-01','2026-10-19','2018-07~2026-10',['SOXL','TECL','TQQQ','USD','ROM','QLD','GOLDX','TSLA']],['2023-09-20','2026-10-19','2023-09~2026-10',['SOXL','TQQQ','USD','QLD','GOLDX','TSLA','AMD','AMDY']],['2026-06-15','2026-10-19','2026-06~10',['SOXL','TQQQ','USD','QLD','GOLDX','TSLA','SPCX']]]){
  console.log(`\n일수익 상관 ${lab}`); console.log('       '+list.map(t=>t.padStart(6)).join(''));
  for(const a of list) console.log(a.padEnd(7)+list.map(b=>f(corr(M[a],M[b],from,to),2).padStart(6)).join('')); }
