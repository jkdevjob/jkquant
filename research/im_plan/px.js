// 범용 비중 엔진 — target(k) 는 전일(k-1)까지 확정 자료로 자산별 목표비중을 낸다. 목표와 band 넘게 벌어지거나 0↔보유 전환이면 그 자산만 당일 종가로 맞춘다.
const fs=require('fs'),path=require('path'); const D=path.join(__dirname,'data');
const load=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series;
function prep(syms){ const S={}; syms.forEach(s=>{ S[s]={}; load(s).forEach(x=>{ if(x.close>0) S[s][x.date]=x.close; }); });
  const irx={}; load('IRX').forEach(x=>irx[x.date]=x.close);
  const dates=Object.keys(S[syms[0]]).filter(d=>syms.every(s=>S[s][d]>0)).sort();
  const C={}; syms.forEach(s=>C[s]=dates.map(d=>S[s][d]));
  return {S,irx,dates,C,syms}; }
const ind={
  ma(a,n){ const o=[];let s=0; for(let k=0;k<a.length;k++){ s+=a[k]; if(k>=n) s-=a[k-n]; o.push(k>=n-1?s/n:null);} return o; },
  vol(a,n){ const o=[]; for(let k=0;k<a.length;k++){ if(k<n){o.push(null);continue;} let r=[]; for(let j=k-n+1;j<=k;j++) r.push(a[j]/a[j-1]-1); const m=r.reduce((x,y)=>x+y,0)/n; o.push(Math.sqrt(r.reduce((x,y)=>x+(y-m)**2,0)/n*252)); } return o; },
};
function sim(P,o){ const {dates,C,irx}=P; const syms=o.assets; const cap=o.cap||10000, fee=o.fee??.0025, tax=o.tax??true, band=o.band??0.05;
  const i0=Math.max(dates.findIndex(d=>d>=(o.from||'0')), o.warm||260), i1=o.to?dates.findLastIndex(d=>d<=o.to):dates.length-1;
  let cash=cap, q={}, basis={}, yearPnl=0, yr=null, lastIrx=0, prevDate=null; syms.forEach(s=>{q[s]=0;basis[s]=0;});
  const eq=[]; const KRW=1350, DED=250e4/KRW; let turn=0;
  const st={}; // 규칙 상태(히스테리시스 등)
  for(let k=i0;k<=i1;k++){ const d=dates[k];
    if(irx[d]!=null) lastIrx=irx[d];
    if(prevDate&&cash>0){ const gap=Math.max(1,Math.round((Date.parse(d)-Date.parse(prevDate))/864e5)); cash+=cash*Math.max(0,lastIrx/100-0.0009)*(tax?(1-0.154):1)*gap/365; }
    prevDate=d; const y=d.slice(0,4); if(yr===null) yr=y; else if(y!==yr){ if(tax&&yearPnl>0) cash-=Math.max(0,yearPnl-DED)*0.22; yearPnl=0; yr=y; }
    const kp=k-1; const pp={}; syms.forEach(s=>pp[s]=C[s][kp]); const tot=cash+syms.reduce((a,s)=>a+q[s]*pp[s],0);
    const cur={}; syms.forEach(s=>cur[s]=q[s]*pp[s]/tot);
    const tgt=o.target(kp,cur,st);
    const px={}; syms.forEach(s=>px[s]=C[s][k]);
    const todo=syms.filter(s=>{ const t=tgt[s]||0; return (t===0)!==(q[s]===0) || Math.abs(t-cur[s])>(o.bandOf?o.bandOf(s,t,cur[s]):band); });   // bandOf(종목, 목표, 현재) — 내릴 때·올릴 때 밴드를 따로 줄 수 있다
    // 매도 먼저
    // o.frac: 소수 주 — 합성 자료처럼 1주 값이 원금보다 비쌀 때(2000년 합성 TQQQ 67,137$) 정수 주가 매매 자체를 막는 왜곡을 없앤다
    const shares=x=>o.frac?x:Math.floor(x);   // o.cnt={}: 매매 기록(종목별 [날짜, 's'|'b', 금액/총자산]) — 안 주면 계산은 그대로
    for(const s of todo){ const want=shares(tot*(tgt[s]||0)/px[s]); if(want<q[s]){ const n=q[s]-want, g=n*px[s], b=basis[s]/q[s]*n; cash+=g-g*fee; yearPnl+=g-g*fee-b; basis[s]-=b; q[s]=want; turn+=g; if(o.cnt) (o.cnt[s]=o.cnt[s]||[]).push([d,'s',g/tot]); } }
    for(const s of todo){ const want=shares(tot*(tgt[s]||0)/px[s]); if(want>q[s]){ const n=Math.min(want-q[s],shares(cash/(px[s]*(1+fee)))); if(n>0){ const g=n*px[s]; cash-=g+g*fee; basis[s]+=g+g*fee; q[s]+=n; turn+=g; if(o.cnt) (o.cnt[s]=o.cnt[s]||[]).push([d,'b',g/tot]); } } }
    eq.push([d,cash+syms.reduce((a,s)=>a+q[s]*px[s],0)]); }
  if(tax&&yearPnl>0) eq[eq.length-1][1]-=Math.max(0,yearPnl-DED)*0.22;
  return {eq,turn}; }
function stats(eq,cap){ const a=eq[0][0], b=eq[eq.length-1][0], fin=eq[eq.length-1][1]; const yrs=(Date.parse(b)-Date.parse(a))/(365.25*864e5);
  let pk=0,m=0; eq.forEach(([,v])=>{ if(v>pk)pk=v; else m=Math.max(m,(pk-v)/pk); }); return {cagr:(Math.pow(Math.max(fin,1e-9)/cap,1/yrs)-1)*100, mdd:m*100, fin}; }
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
function roll(P,o,y0,y1){ const R=[]; const last=P.dates[P.dates.length-1]; for(let y=y0;y<=y1;y++) for(let m=1;m<=12;m+=1){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue; R.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,o.cap||10000)); }
  return {n:R.length, cMed:q(R.map(x=>x.cagr),.5), cP10:q(R.map(x=>x.cagr),.1), cMin:Math.min(...R.map(x=>x.cagr)), mMed:q(R.map(x=>x.mdd),.5), mP90:q(R.map(x=>x.mdd),.9), mMax:Math.max(...R.map(x=>x.mdd))}; }
module.exports={prep,sim,stats,roll,ind,q};
