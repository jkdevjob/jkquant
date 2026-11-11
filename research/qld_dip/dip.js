// 적립식 QQQ → (하락 때) QLD 전환 전략 — 스크린샷 규칙 그대로 + 비교군
//  · 첫날 원금 P 를 넣고, 달이 바뀐 첫 거래일마다 M 을 넣는다(넣은 날 종가에 산다 · 수수료 0.1%)
//  · 그날 무엇을 살지는 전일 종가까지로 정한다(룩어헤드 없음)
//      idx: 나스닥100(^NDX)이 그때까지의 최고 종가 대비 15% 이상 아래
//      avg: QQQ 가 내 QQQ 평균 매수가 대비 15% 이상 아래
//      or : 둘 중 하나
//    해당하면 새 돈은 QLD, 아니면 QQQ. 가진 QQQ·QLD 는 팔지 않는다(스크린샷 '운영 팁').
//  · 확장(실험) back: QLD 를 산 뒤 나스닥100이 '전환 때의 전고점'을 되찾으면 다음 적립일에 QLD 를 전부 팔아 QQQ 로 — 스크린샷에 없는 규칙
//  · 세금: 해외주식 양도세 22% · 연 250만원 공제(1,350원/$ → 1,852$) — 판 해 이익에 매기고 다음 적립금에서 먼저 낸다. 끝날 다 판다고 보고 한 번 더 셈
//  · 정수 주: 실제 거래 단위 가격(조정종가 × 이후 분할 배수)으로 내림 · 남는 돈은 다음 달로. frac 이면 소수 주
const FEE=0.001,TAX=0.22,DED=2500000/1350;
function run(S,o){
  const {dates,N,Q,L,UQ,UL}=S;
  const i0=dates.findIndex(d=>d>=o.from), i1=o.to?dates.findLastIndex(d=>d<=o.to):dates.length-1;
  const P=o.P, M=o.M, rule=o.rule, th=o.th??0.15;
  let cash=0,qa=0,la=0,qCost=0,lCost=0;      // qa·la = 조정 주수(가치 = 주수 × 조정종가) · 원가는 달러
  let paid=0,yearPnl=0,yr=dates[i0].slice(0,4),taxDue=0,taxPaid=0;
  let peakAt=null, nQ=0,nL=0, toL=0, conv=0;
  const flows=[], curve=[];
  let pk=0; for(let k=0;k<i0;k++) pk=Math.max(pk,N[k]);   // 시작 전 역사까지 본 전고점
  let lastMonth=null;
  const buy=(sym,k,amt)=>{ if(!(amt>0)) return 0;
    const u=sym==='Q'?UQ[k]:UL[k], px=sym==='Q'?Q[k]:L[k], per=u*(1+FEE);
    const n=o.frac?amt/per:Math.floor(amt/per); if(!(n>0)) return 0;
    const cost=n*per, adj=n*u/px;              // 실제 n주 = 조정 주수 n×u/px
    if(sym==='Q'){qa+=adj;qCost+=cost;nQ++;} else {la+=adj;lCost+=cost;nL++;}
    return cost; };
  for(let k=i0;k<=i1;k++){
    const d=dates[k], y=d.slice(0,4), mo=d.slice(0,7);
    if(y!==yr){ const t=Math.max(0,yearPnl-DED)*TAX; taxDue+=t; yearPnl=0; yr=y; }
    let dep=0;
    if(k===i0) dep=P; else if(mo!==lastMonth) dep=M;
    lastMonth=mo;
    if(dep>0){
      paid+=dep; flows.push([d,-dep]); cash+=dep;
      if(taxDue>0){ const t=Math.min(cash,taxDue); cash-=t; taxDue-=t; taxPaid+=t; }
      // 판단 = 전일 종가까지
      const kp=k-1; const pkPrev=kp>=0?pk:N[k];
      const ddIdx=kp>=0?1-N[kp]/pkPrev:0;
      const avgCond=(qa>0&&kp>=0)? (Q[kp] <= (1-th)*(qCost/qa)) : false;
      const idxCond=kp>=0 && ddIdx>=th;
      // hi52(다른 해석 · 실험): '전고점'을 최근 1년(252거래일) 최고 종가로 볼 때
      let h52=0; if(kp>=0){ for(let j=Math.max(0,kp-251);j<=kp;j++) h52=Math.max(h52,N[j]); }
      const h52Cond=kp>=0 && N[kp]<=(1-th)*h52;
      let toQLD = rule==='qqq'?false : rule==='qld'?true : rule==='idx'?idxCond : rule==='avg'?avgCond : rule==='or'?(idxCond||avgCond) : rule==='hi52'?h52Cond
                : rule==='mix'?null : false;
      // 확장 back: 전환 때 전고점을 되찾았으면 QLD 전부 → QQQ (QLD 를 새로 사기 전에)
      if(o.back && la>0 && peakAt!=null && kp>=0 && N[kp]>=peakAt){
        const val=la*L[k], fee=val*FEE, net=val-fee; yearPnl+=net-lCost; la=0; lCost=0; cash+=net; conv++; peakAt=null;
        if(!toQLD){ /* 그대로 아래에서 QQQ 로 */ } }
      if(rule==='mix'){ // 타이밍 없는 대조군: 새 돈의 w 만큼 늘 QLD
        const a=cash*o.w; cash-=buy('L',k,a); cash-=buy('Q',k,cash); toL+=a; }
      else if(toQLD){ if(peakAt==null) peakAt=(rule==='hi52'?h52:pkPrev); const c=buy('L',k,cash); cash-=c; toL+=c; }
      else cash-=buy('Q',k,cash);
      if(o.trace) o.trace.push([d,rule==='mix'?'mix':(toQLD?'L':'Q')]);
    }
    pk=Math.max(pk,N[k]);
    const v=cash+qa*Q[k]+la*L[k];
    curve.push([d,v,paid]);
  }
  // 끝날 다 판다고 보고 세금
  const kE=i1, vEnd=cash+qa*Q[kE]+la*L[kE];
  const gainEnd=(qa*Q[kE]+la*L[kE])*(1-FEE)-(qCost+lCost);
  const taxEnd=Math.max(0,yearPnl+gainEnd-DED)*TAX+taxDue;
  const after=vEnd-(qa*Q[kE]+la*L[kE])*FEE-taxEnd;
  return {from:dates[i0],to:dates[kE],paid,vEnd,after,taxPaid,taxEnd,curve,flows,qlShare:(la*L[kE])/Math.max(1e-9,qa*Q[kE]+la*L[kE]),toL,nQ,nL,conv};
}
// 돈 가중 연수익(XIRR) — 낸 돈(−)과 끝 값(+)
function xirr(flows,endDate,endVal){
  const t0=Date.parse(flows[0][0]); const cf=flows.map(([d,v])=>[(Date.parse(d)-t0)/(365.25*864e5),v]).concat([[(Date.parse(endDate)-t0)/(365.25*864e5),endVal]]);
  const f=r=>cf.reduce((s,[t,v])=>s+v/Math.pow(1+r,t),0);
  let lo=-0.99,hi=3; for(let i=0;i<200;i++){ const m=(lo+hi)/2; if(f(m)>0) lo=m; else hi=m; } return (lo+hi)/2;
}
// 위험: (1) 넣은 돈 대비 가장 깊은 평가손실 = min(V/누적투입 − 1) · (2) 앱 모의 목록 MDD = '총자산 ÷ 그때까지 넣은 돈'의 고점 대비 최대 하락
function risk(curve){ let worst=0,pk=0,mdd=0,wd=null,md=null;
  for(const [d,v,p] of curve){ const r=v/p; if(r-1<worst){worst=r-1;wd=d;} if(r>pk)pk=r; else if(1-r/pk>mdd){mdd=1-r/pk;md=d;} }
  return {worst,worstAt:wd,mdd,mddAt:md}; }
module.exports={run,xirr,risk,FEE,TAX,DED};
