// 시중 매매법 공용 모의(11-12 · 사용자 "시중에 좋은 매매법 찾아서 백테스트 해봐") — 듀얼 가드 앱 엔진(plan-session-engine.js)과 같은 규약:
//   신호·주수 = 전일 확정 종가(체결가 ohlcTrade) · 체결 = 당일 종가 · 매도 먼저 → 매수(남은 현금 한도) · 수수료 alphaFee(0.1% · 10$ 이하 0 · 센트 내림)
//   배당 = 현금(dividends) · 월 입금 = 그달 첫 거래일(앱과 같음) · MDD = 평가액÷낸 돈 의 최대 낙폭(앱 stats 와 같은 식)
//   세후 = planrule/aftertax.js acc()(해마다 실현이익 22% · 250만원 공제 · 환율 1350 · 끝날 평가이익 청산세) — 듀얼 가드 모의 목록과 같은 계산.
// 전략 = {name, syms:[...], decide(ctx) → 목표 비중 {SYM:w}(합 ≤ 1 · 나머지 현금) | null(오늘은 그대로) · deposit?(ctx) → 입금 날 산 비중(없으면 마지막 목표 비중)}
// ctx: i(오늘) · p(=i−1 신호일) · date · sig(신호일) · cal · c(s,k)=체결가 종가 · a(s,k)=배당 조정 종가(총수익 · 모멘텀용) · pos · cash · total(신호일 값) · newMonth · newQuarter · first · st(전략 상태)
const fs=require('fs'),path=require('path'); const {acc}=require('../planrule/aftertax');
const DD=path.join(__dirname,'..','data'); const FEE_RATE=.001;
const fee=(q,p)=>{ const g=Math.max(0,q*p); return g<=10?0:Math.floor(g*FEE_RATE*100)/100; };
const CACHE={};
function load(sym){ if(CACHE[sym]) return CACHE[sym]; const j=JSON.parse(fs.readFileSync(path.join(DD,sym+'.json'),'utf8'));
  const raw={}, adj={}, div={}; (j.ohlcTrade||j.ohlc||j.series).forEach(x=>{ if(+x.close>0) raw[x.date]=+x.close; }); (j.series||[]).forEach(x=>{ if(+x.close>0) adj[x.date]=+x.close; });
  (j.dividends||[]).forEach(x=>{ if(+x.amount>0) div[x.date]=(div[x.date]||0)+(+x.amount); });
  for(const d in raw) if(!(d in adj)) adj[d]=raw[d];
  const dates=Object.keys(raw).sort(), idx={}; dates.forEach((d,k)=>idx[d]=k);
  return CACHE[sym]={raw,adj,div,dates,idx}; }
// 공통 달력: 모든 종목에 체결가가 있는 날(교집합)
function calendar(syms){ let ds=null; for(const s of syms){ const k=new Set(Object.keys(load(s).raw)); ds=ds?ds.filter(d=>k.has(d)):[...k]; } return ds.sort(); }
// opt.rescale: 창마다 종목 가격을 시작일 100 으로 곱해 맞춘다(합성 자료의 정수 주 왜곡 줄이기 · 비율 신호는 그대로) · opt.map: 전략 종목 이름 → 자료 이름(합성 대체)
function run(strat,{start,end,principal,monthly=0,rescale=false,map=null}){
  const syms=strat.syms, src=s=>(map&&map[s])||s, cal=calendar(syms.map(src)); const i0=cal.findIndex(d=>d>=start); if(i0<0) return null;
  const iEnd=(()=>{ let k=cal.length-1; while(k>=0&&cal[k]>end) k--; return k; })(); if(iEnd<=i0) return null;
  const D={}; for(const s of syms){ const X=load(src(s)); const f=rescale?100/X.raw[cal[i0]]:1;
    if(f===1) D[s]=X; else { const raw={},adj={},div={}; for(const d in X.raw) raw[d]=X.raw[d]*f; for(const d in X.adj) adj[d]=X.adj[d]*f; for(const d in X.div) div[d]=X.div[d]*f; D[s]={raw,adj,div,dates:X.dates,idx:X.idx}; } }
  const C=s=>D[s].raw, A=s=>D[s].adj;
  MAP=map; const pos={}; syms.forEach(s=>pos[s]=0); let cash=principal, inflow=principal, nTr=0, lastW=null; const st={}; const nav=[]; const A_=acc();
  const book={}; syms.forEach(s=>book[s]={q:0,c:0}); let realized=0; let lastMonth=cal[i0].slice(0,7);
  const trades=[];
  for(let i=i0;i<=iEnd;i++){ const date=cal[i], month=date.slice(0,7); let dep=false;
    if(month!==lastMonth){ if(monthly>0){ cash+=monthly; inflow+=monthly; dep=true; } lastMonth=month; }
    for(const s of syms){ const dv=D[s].div[date]; if(dv&&pos[s]>0) cash+=pos[s]*dv; }
    const p=i-1, sig=cal[p];
    const totalP=syms.reduce((t,s)=>t+pos[s]*C(s)[sig],0)+cash;
    const ctx={i,p,date,sig,cal,c:(s,k)=>C(s)[cal[k]],a:(s,k)=>A(s)[cal[k]],pos,cash,total:totalP,first:i===i0,dep,
      newMonth:i===i0||cal[p].slice(0,7)!==month, newQuarter:i===i0||(cal[p].slice(0,7)!==month&&['01','04','07','10'].includes(month.slice(5,7))), st};
    let W=strat.decide(ctx); let buyOnly=false;
    if(!W&&dep){ W=strat.deposit?strat.deposit(ctx):lastW; buyOnly=true; }
    if(W){ if(!buyOnly) lastW=W;
      const px={}; syms.forEach(s=>px[s]=C(s)[date]);
      const tgt={}; for(const s of syms){ const w=+W[s]||0; tgt[s]=buyOnly?pos[s]+Math.max(0,Math.floor(cash*w/C(s)[sig])):Math.max(0,Math.floor(totalP*w/C(s)[sig])); }
      for(const s of syms){ const dq=tgt[s]-pos[s]; if(dq<0){ const q=-dq,f=fee(q,px[s]); cash+=q*px[s]-f; const b=book[s], avg=b.c/b.q; realized+=q*px[s]-f-avg*q; b.q-=q; b.c-=avg*q; if(b.q<=0){b.q=0;b.c=0;} pos[s]-=q; nTr++; trades.push([date,s,-q,px[s]]); } }
      for(const s of syms){ const dq=tgt[s]-pos[s]; if(dq>0){ const mx=Math.floor(cash/(px[s]*(1+FEE_RATE))), q=Math.min(dq,mx); if(q>0){ const f=fee(q,px[s]); cash-=q*px[s]+f; book[s].q+=q; book[s].c+=q*px[s]+f; pos[s]+=q; nTr++; trades.push([date,s,q,px[s]]); } } } }
    const held=syms.reduce((t,s)=>t+pos[s]*C(s)[date],0), total=held+cash, cost=syms.reduce((t,s)=>t+book[s].c,0);
    nav.push({date,total,inflow}); A_.step(date,total,inflow,{realized,cost,held}); }
  let peak=-Infinity,mdd=0; for(const x of nav){ const u=x.total/x.inflow; if(u>peak) peak=u; else mdd=Math.max(mdd,(peak-u)/peak); }
  const yrs=Math.max(.05,(Date.parse(nav[nav.length-1].date)-Date.parse(nav[0].date))/(365.25*864e5)), at=A_.done();
  return {nav,trades,nTr,yrs,mdd:mdd*100,final:nav[nav.length-1].total,inflow,at,ann:(Math.pow(Math.max(1e-9,1+at.tr/100),1/yrs)-1)*100,pre:(Math.pow(Math.max(1e-9,nav[nav.length-1].total/inflow),1/yrs)-1)*100}; }
// 지표 도우미 — 종목 자기 시세 전체(공통 달력보다 앞 포함)에서 신호일(그날 포함)까지만 본다
let MAP=null; const L=s=>load((MAP&&MAP[s])||s);
const at=(s,d)=>{ const X=L(s); if(d in X.idx) return X.idx[d]; let lo=0,hi=X.dates.length-1,a=-1; while(lo<=hi){ const m=(lo+hi)>>1; if(X.dates[m]<=d){a=m;lo=m+1;} else hi=m-1; } return a; };
const H={
  px:(ctx,s,adj=false)=>{ const X=L(s), k=at(s,ctx.sig); return k<0?null:(adj?X.adj:X.raw)[X.dates[k]]; },
  sma:(ctx,s,n,adj=false)=>{ const X=L(s), k=at(s,ctx.sig); if(k-n+1<0) return null; let t=0; for(let j=k-n+1;j<=k;j++) t+=(adj?X.adj:X.raw)[X.dates[j]]; return t/n; },
  // 달 끝 조정 종가 n 개(신호일이 첫째 · 그 앞 달들의 마지막 거래일) — 월간 모멘텀용(신호일 = 달 마지막 거래일일 때 정확)
  monthEnds:(ctx,s,n)=>{ const X=L(s); let k=at(s,ctx.sig); if(k<0) return null; const out=[X.adj[X.dates[k]]]; let m=X.dates[k].slice(0,7);
    while(k>0&&out.length<n){ k--; const mk=X.dates[k].slice(0,7); if(mk!==m){ out.push(X.adj[X.dates[k]]); m=mk; } } return out.length===n?out:null; },
  ret:(ctx,s,months)=>{ const e=H.monthEnds(ctx,s,months+1); return e?e[0]/e[months]-1:null; },
};
module.exports={run,load,calendar,H,fee};
