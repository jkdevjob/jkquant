// 사용: node plan_open.js — 플랜 체결을 다음 날 종가 대신 다음 날 시가로(사용자 질문 11-02)
// 플랜 체결을 '다음 날 종가'(연구 기본) 대신 '다음 날 시가'(한국 밤 11:30 장 시작 직후)로 — 신호는 그대로 전일 확정 종가
const px=require('./px'); const {mk}=require('./plan_rules'); const fs=require('fs');
const P=px.prep(['TECL','TQQQ']); const O={}; for(const s of ['TECL','TQQQ']){ const m={}; JSON.parse(fs.readFileSync(__dirname+'/data/'+s+'.json')).ohlc.forEach(x=>m[x.date]=x.open); O[s]=P.dates.map(d=>m[d]>0?m[d]:null); }
function simX(o,useOpen){ const {dates,C,irx}=P; const syms=o.assets; const cap=o.cap, fee=o.fee; const i0=Math.max(dates.findIndex(d=>d>=o.from),o.warm||260), i1=dates.length-1;
  let cash=cap,q={},basis={},yearPnl=0,yr=null,lastIrx=0,prev=null; syms.forEach(s=>{q[s]=0;basis[s]=0;}); const eq=[]; const DED=250e4/1350; const st={};
  for(let k=i0;k<=i1;k++){ const d=dates[k]; if(irx[d]!=null) lastIrx=irx[d]; if(prev&&cash>0){ const g=Math.max(1,Math.round((Date.parse(d)-Date.parse(prev))/864e5)); cash+=cash*Math.max(0,lastIrx/100-0.0009)*(1-0.154)*g/365; } prev=d;
    const y=d.slice(0,4); if(yr===null) yr=y; else if(y!==yr){ if(yearPnl>0) cash-=Math.max(0,yearPnl-DED)*0.22; yearPnl=0; yr=y; }
    const kp=k-1, pp={}; syms.forEach(s=>pp[s]=C[s][kp]); const tot=cash+syms.reduce((a,s)=>a+q[s]*pp[s],0); const cur={}; syms.forEach(s=>cur[s]=q[s]*pp[s]/tot);
    const tgt=o.target(kp,cur,st); const ex={}; syms.forEach(s=>ex[s]=(useOpen&&O[s][k])?O[s][k]:C[s][k]);
    const todo=syms.filter(s=>{ const t=tgt[s]||0; return (t===0)!==(q[s]===0)||Math.abs(t-cur[s])>o.bandOf(s,t,cur[s]); });
    for(const s of todo){ const want=Math.floor(tot*(tgt[s]||0)/ex[s]); if(want<q[s]){ const n=q[s]-want,g=n*ex[s],b=basis[s]/q[s]*n; cash+=g-g*fee; yearPnl+=g-g*fee-b; basis[s]-=b; q[s]=want; } }
    for(const s of todo){ const want=Math.floor(tot*(tgt[s]||0)/ex[s]); if(want>q[s]){ const n=Math.min(want-q[s],Math.floor(cash/(ex[s]*(1+fee)))); if(n>0){ const g=n*ex[s]; cash-=g+g*fee; basis[s]+=g+g*fee; q[s]+=n; } } }
    eq.push([d,cash+syms.reduce((a,s)=>a+q[s]*C[s][k],0)]); }
  if(yearPnl>0) eq[eq.length-1][1]-=Math.max(0,yearPnl-DED)*0.22; return eq; }
for(const [nm,p] of [['지금 앱 플랜',{gsb:1e9,fee:0.001}],['새 규칙(운영형)',{gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}]]) for(const cap of [10000,100000]){
  const r=[false,true].map(u=>{ const o=Object.assign({cap,from:'2011-01-01',fee:0.001},mk(P,'TECL','TQQQ',p)); return px.stats(simX(o,u),cap); });
  console.log(`${nm} ${cap/1e4}만$ | 다음 날 종가 체결 ${r[0].cagr.toFixed(1)}/${r[0].mdd.toFixed(1)} · 다음 날 시가 체결 ${r[1].cagr.toFixed(1)}/${r[1].mdd.toFixed(1)}`); }
