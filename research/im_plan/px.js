// 범용 비중 엔진 — target(k) 는 전일(k-1)까지 확정 자료로 자산별 목표비중을 낸다. 목표와 band 넘게 벌어지거나 0↔보유 전환이면 그 자산만 당일 종가로 맞춘다.
const fs=require('fs'),path=require('path'); const D=path.join(__dirname,'data');
const load=s=>JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).series;
function prep(syms,opt){ const S={}; syms.forEach(s=>{ S[s]={}; load(s).forEach(x=>{ if(x.close>0) S[s][x.date]=x.close; }); });
  const irx={}; load('IRX').forEach(x=>irx[x.date]=x.close);
  const dates=Object.keys(S[syms[0]]).filter(d=>syms.every(s=>S[s][d]>0)).sort();
  const C={}; syms.forEach(s=>C[s]=dates.map(d=>S[s][d]));
  const O={};   // opt.ohlc(11-10): 시가·고가·저가(자료의 ohlc 는 종가와 같은 조정 척도 — 확인 11-10) · 없는 날은 종가로 채움 · 범위 기반 변동성(plan_rules volEst)용
  if(opt&&opt.ohlc) syms.forEach(s=>{ const m={}; (JSON.parse(fs.readFileSync(path.join(D,s+'.json'))).ohlc||[]).forEach(x=>{ if(x.close>0&&x.high>0&&x.low>0) m[x.date]=x; });
    O[s]={o:dates.map(d=>m[d]?m[d].open||m[d].close:S[s][d]),h:dates.map(d=>m[d]?m[d].high:S[s][d]),l:dates.map(d=>m[d]?m[d].low:S[s][d])}; });
  return {S,irx,dates,C,syms,O}; }
const ind={
  // (11-10) 범위 기반 변동성 — Yang-Zhang(밤 사이 + 시가→종가 + Rogers-Satchell) · Garman-Klass(밤 사이 점프 포함) · 지수가중(EWMA, RiskMetrics λ) — 모두 전일까지 · 연율
  yz(C,O,n){ const out=[]; const lo=[],lc=[],rs=[]; for(let k=0;k<C.length;k++){ if(k<1){ lo.push(0); lc.push(0); rs.push(0); out.push(null); continue; }
      const o=O.o[k],h=O.h[k],l=O.l[k],c=C[k]; lo.push(Math.log(o/C[k-1])); lc.push(Math.log(c/o)); rs.push(Math.log(h/c)*Math.log(h/o)+Math.log(l/c)*Math.log(l/o));
      if(k<n){ out.push(null); continue; } let mo=0,mc=0,vo=0,vc=0,vr=0; for(let j=k-n+1;j<=k;j++){ mo+=lo[j]; mc+=lc[j]; } mo/=n; mc/=n; for(let j=k-n+1;j<=k;j++){ vo+=(lo[j]-mo)**2; vc+=(lc[j]-mc)**2; vr+=rs[j]; } vo/=(n-1); vc/=(n-1); vr/=n;
      const kk=0.34/(1.34+(n+1)/(n-1)); out.push(Math.sqrt(Math.max(0,vo+kk*vc+(1-kk)*vr)*252)); } return out; },
  gk(C,O,n){ const out=[], t=[]; for(let k=0;k<C.length;k++){ if(k<1){ t.push(0); out.push(null); continue; } const o=O.o[k],h=O.h[k],l=O.l[k],c=C[k];
      t.push(0.5*Math.log(h/l)**2-(2*Math.log(2)-1)*Math.log(c/o)**2+Math.log(o/C[k-1])**2); if(k<n){ out.push(null); continue; } let s=0; for(let j=k-n+1;j<=k;j++) s+=t[j]; out.push(Math.sqrt(Math.max(0,s/n)*252)); } return out; },
  ewma(a,lam,warm){ const out=[]; let v=null; for(let k=0;k<a.length;k++){ if(k<1){ out.push(null); continue; } const r=Math.log(a[k]/a[k-1]); v=v==null?r*r:lam*v+(1-lam)*r*r; out.push(k<(warm||20)?null:Math.sqrt(v*252)); } return out; },
  ma(a,n){ const o=[];let s=0; for(let k=0;k<a.length;k++){ s+=a[k]; if(k>=n) s-=a[k-n]; o.push(k>=n-1?s/n:null);} return o; },
  vol(a,n){ const o=[]; for(let k=0;k<a.length;k++){ if(k<n){o.push(null);continue;} let r=[]; for(let j=k-n+1;j<=k;j++) r.push(a[j]/a[j-1]-1); const m=r.reduce((x,y)=>x+y,0)/n; o.push(Math.sqrt(r.reduce((x,y)=>x+(y-m)**2,0)/n*252)); } return o; },
};
function sim(P,o){ const {dates,C,irx}=P; const syms=o.assets; const cap=o.cap||10000, fee=o.fee??.0025, tax=o.tax??true, band=o.band??0.05;
  const i0=Math.max(dates.findIndex(d=>d>=(o.from||'0')), o.warm||260), i1=o.to?dates.findLastIndex(d=>d<=o.to):dates.length-1;
  let cash=cap, q={}, basis={}, yearPnl=0, yr=null, lastIrx=0, prevDate=null; syms.forEach(s=>{q[s]=0;basis[s]=0;});
  const eq=[]; const KRW=1350, DED=250e4/KRW*(o.dedMul??1); let turn=0;   // o.dedMul(11-08): 공제 배율 — 한 사람 공제를 여러 계좌가 비중만큼 나눠 쓸 때(trio_exact)
  const st={}; // 규칙 상태(히스테리시스 등)
  // o.deferDec(11-08): {sym, days, taxable} — 그해 남은 거래일이 days 보다 적을 때 sym 의 '이익 나는' 매도를 다음 해 첫 거래일로 미룬다(목표는 그대로라 해가 바뀌면 보통 규칙이 다시 판다). taxable 이면 공제를 넘는 이익일 때만. 안 주면 기존과 같다.
  const remY=o.deferDec?(()=>{ const r=new Array(dates.length).fill(0); for(let k=dates.length-2;k>=0;k--) r[k]=dates[k+1].slice(0,4)===dates[k].slice(0,4)?r[k+1]+1:0; return r; })():null; let deferN=0;
  // o.dep(11-08): 적립을 앱 플랜 monthlyAdd 처럼 — 날마다 o.dep.perDay 씩 쌓아 두었다가 달이 바뀐 첫 거래일 아침에 현금으로 넣고 그날 모든 종목을 목표로 맞춘다(강제 리밸런싱).
  //   들어온 돈은 o.flows 에 [날짜, 금액] · 끝날 아직 못 넣은 돈은 현금으로 더한다(낸 돈 합이 매일 적립과 같게). 안 주면 기존과 같다.
  //   o.dep.every(11-10): 넣는 달 간격 — 2·3·6·12 면 (월−1)%every===0 인 달(3 = 1·4·7·10월)의 첫 거래일에만 넣고 그동안은 쌓아 둔다(밖에 두는 돈 · 이자 없음). 안 주면 매달.
  let depPend=0, depForce=false; if(o.dep) o.flows=o.flows||[];
  for(let k=i0;k<=i1;k++){ const d=dates[k];
    depForce=false; if(o.dep&&k>i0){ if(d.slice(0,7)!==dates[k-1].slice(0,7)&&depPend>0&&(!(o.dep.every>1)||(+d.slice(5,7)-1)%o.dep.every===0)){ cash+=depPend; o.flows.push([d,depPend]); depPend=0; depForce=true; } depPend+=o.dep.perDay; }
    if(irx[d]!=null) lastIrx=irx[d];
    if(prevDate&&cash>0){ const gap=Math.max(1,Math.round((Date.parse(d)-Date.parse(prevDate))/864e5)); cash+=cash*Math.max(0,lastIrx/100-0.0009)*(tax?(1-0.154):1)*gap/365; }
    prevDate=d; const y=d.slice(0,4); if(yr===null) yr=y; else if(y!==yr){ const _t=(tax&&yearPnl>0)?Math.max(0,yearPnl-DED)*0.22:0; cash-=_t; if(o.ylog) o.ylog.push([yr,yearPnl,_t,d]); yearPnl=0; yr=y; }   // o.ylog: 해마다 [해, 실현손익, 세금, 낸 날](11-05)
    const kp=k-1; const pp={}; syms.forEach(s=>pp[s]=C[s][kp]); const tot=cash+syms.reduce((a,s)=>a+q[s]*pp[s],0);
    const cur={}; syms.forEach(s=>cur[s]=q[s]*pp[s]/tot);
    const tgt=o.target(kp,cur,st);
    const px={}; syms.forEach(s=>px[s]=C[s][k]);
    const todo=syms.filter(s=>{ const t=tgt[s]||0; if(depForce) return t>0||q[s]>0; return (t===0)!==(q[s]===0) || Math.abs(t-cur[s])>(o.bandOf?o.bandOf(s,t,cur[s]):band); });   // depForce: 적립금 들어온 날은 전부 목표로   // bandOf(종목, 목표, 현재) — 내릴 때·올릴 때 밴드를 따로 줄 수 있다
    // 매도 먼저
    // o.frac: 소수 주 — 합성 자료처럼 1주 값이 원금보다 비쌀 때(2000년 합성 TQQQ 67,137$) 정수 주가 매매 자체를 막는 왜곡을 없앤다
    const shares=x=>o.frac?x:Math.floor(x);   // o.cnt={}: 매매 기록(종목별 [날짜, 's'|'b', 금액/총자산]) — 안 주면 계산은 그대로
    // o.sizePrev(11-08): 주수를 전일 종가로 정한다(앱 플랜 엔진 ORDER_SIZING_BASIS 'previous-settled-close' 와 같게) — 안 주면 기존(당일 종가)
    for(const s of todo){ const want=shares(tot*(tgt[s]||0)/(o.sizePrev?pp[s]:px[s])); if(want<q[s]){ const n=q[s]-want, g=n*px[s], b=basis[s]/q[s]*n;
      if(o.deferDec&&s===o.deferDec.sym&&want>0&&remY[k]<o.deferDec.days){ const gain=g-g*fee-b; if(gain>0&&(!o.deferDec.taxable||yearPnl+gain>DED)){ deferN++; continue; } }   // 12월 이연(전량 청산 = Guard·규칙 0 목표는 미루지 않음)
      cash+=g-g*fee; yearPnl+=g-g*fee-b; basis[s]-=b; q[s]=want; turn+=g; if(o.cnt) (o.cnt[s]=o.cnt[s]||[]).push([d,'s',g/tot]); } }
    for(const s of todo){ const want=shares(tot*(tgt[s]||0)/(o.sizePrev?pp[s]:px[s])); if(want>q[s]){ const n=Math.min(want-q[s],shares(cash/(px[s]*(1+fee)))); if(n>0){ const g=n*px[s]; cash-=g+g*fee; basis[s]+=g+g*fee; q[s]+=n; turn+=g; if(o.cnt) (o.cnt[s]=o.cnt[s]||[]).push([d,'b',g/tot]); } } }
    if(o.hvIn){ const H=o.hvIn; o._hvLast=o._hvLast||{}; for(const s of syms){ if(!(q[s]>0)) continue; const avg=basis[s]/q[s], p0=px[s]; const unr=(p0-avg)*q[s]; if(!(unr<0)||-unr<H.loss*basis[s]) continue; if(!(yearPnl>DED)) continue; if(o._hvLast[s]!=null&&k-o._hvLast[s]<(H.gap??21)) continue;
        const per=avg-p0+p0*fee*2; if(per<=0) continue; const need=yearPnl-DED; let n=Math.min(q[s],o.frac?need/per:Math.ceil(need/per)); if(n<=0) continue;
        const g=n*p0, realized=g-g*fee-avg*n; cash+=g-g*fee; yearPnl+=realized; basis[s]-=avg*n; cash-=g+g*fee; basis[s]+=g+g*fee; turn+=2*g; o._hvLast[s]=k; if(o.hvlog) o.hvlog.push([d,s,-realized]); } }   // o.hvIn(11-10): 연중 손실 수확 — 평가손실 ≥ loss×원가 · 올해 실현이익이 공제를 넘을 때 그 넘는 만큼만 팔고 되산다(같은 종목 gap 일에 한 번 · 수수료 양쪽 · 노출 그대로)
    // o.harvest(11-07): 연말(그해 마지막 거래일 종가) 실현손익을 250만원 공제(DED)에 맞춘다 — 공제 미달이면 평가이익을 팔고 바로 되사 공제를 채움(원가 상향 · 미래 세금↓) · 공제 초과면 평가손실을 팔고 되사 상계(이월공제 없음 → 공제까지만). 수수료 양쪽. 안 주면 기존과 같다.
    if(o.harvest&&(k===i1||dates[k+1].slice(0,4)!==d.slice(0,4))){ const H=o.harvest; let gH=0,lH=0;
      for(const s of syms){ if(!(q[s]>0)) continue; const avg=basis[s]/q[s], p0=px[s];
        if(H.gain!==false&&p0>avg&&yearPnl<DED){ const per=p0-avg-p0*fee; if(per<=0) continue; const need=DED-yearPnl; let n=Math.min(q[s],o.frac?need/per:Math.floor(need/per)); if(n<=0) continue;
          const g=n*p0, realized=g-g*fee-avg*n; cash+=g-g*fee; yearPnl+=realized; basis[s]-=avg*n; cash-=g+g*fee; basis[s]+=g+g*fee; turn+=2*g; gH+=realized; }
        else if(H.loss!==false&&p0<avg&&yearPnl>DED){ const per=avg-p0+p0*fee; const need=yearPnl-DED; let n=Math.min(q[s],o.frac?need/per:Math.ceil(need/per)); if(n<=0) continue;
          const g=n*p0, realized=g-g*fee-avg*n; cash+=g-g*fee; yearPnl+=realized; basis[s]-=avg*n; cash-=g+g*fee; basis[s]+=g+g*fee; turn+=2*g; lH+=-realized; } }
      if(o.hlog) o.hlog.push([d.slice(0,4),gH,lH]); }
    if(o.daily) o.daily.push({d,cash,q:Object.assign({},q),px:Object.assign({},px),st:Object.assign({},st)});   // o.daily(11-10): 날마다 상태(현금·주수·종가·규칙 상태) 기록 — 해부용 · 안 주면 기존과 같다
    eq.push([d,cash+syms.reduce((a,s)=>a+q[s]*px[s],0)]); }
  if(o.dep&&depPend>0){ eq[eq.length-1][1]+=depPend; o.flows.push([eq[eq.length-1][0],depPend]); depPend=0; }   // 못 넣은 적립금은 현금
  if(o.liq){ for(const s of syms){ if(q[s]>0){ const g=q[s]*C[s][i1]; yearPnl+=g-g*fee-basis[s]; eq[eq.length-1][1]-=g*fee; } } }   // liq: 끝날 전부 판다 — 수수료 + 그 이익을 올해 실현분에 넣어 아래 세금
  { const _t=(tax&&yearPnl>0&&o.endTax!==false)?Math.max(0,yearPnl-DED)*0.22:0; eq[eq.length-1][1]-=_t; if(o.ylog) o.ylog.push([yr,yearPnl,_t,eq[eq.length-1][0]]); }   // 끝날 올해 실현이익 세금을 미리 뺀다(청산 가치) — 진행 중 구간 낙폭을 잴 때는 endTax:false
  return {eq,turn,deferN}; }
function stats(eq,cap){ const a=eq[0][0], b=eq[eq.length-1][0], fin=eq[eq.length-1][1]; const yrs=(Date.parse(b)-Date.parse(a))/(365.25*864e5);
  let pk=0,m=0; eq.forEach(([,v])=>{ if(v>pk)pk=v; else m=Math.max(m,(pk-v)/pk); }); return {cagr:(Math.pow(Math.max(fin,1e-9)/cap,1/yrs)-1)*100, mdd:m*100, fin}; }
const q=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
function roll(P,o,y0,y1){ const R=[]; const last=P.dates[P.dates.length-1]; for(let y=y0;y<=y1;y++) for(let m=1;m<=12;m+=1){ const s=`${y}-${String(m).padStart(2,'0')}-01`, e=`${y+5}-${String(m).padStart(2,'0')}-01`; if(e>last) continue; R.push(stats(sim(P,Object.assign({},o,{from:s,to:e})).eq,o.cap||10000)); }
  return {n:R.length, cMed:q(R.map(x=>x.cagr),.5), cP10:q(R.map(x=>x.cagr),.1), cMin:Math.min(...R.map(x=>x.cagr)), mMed:q(R.map(x=>x.mdd),.5), mP90:q(R.map(x=>x.mdd),.9), mMax:Math.max(...R.map(x=>x.mdd))}; }
module.exports={prep,sim,stats,roll,ind,q};
