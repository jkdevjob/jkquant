// 사용: node guard_exits.js — Guard OFF 매도 뒤 되산 값 · 그사이 가장 깊은 하락(사용자 질문 11-02)
// Guard OFF 로 TQQQ 를 판 뒤 무슨 일이 있었나 — 앱 규칙(±1%) · 새 규칙(나올 때 −3%) · 실제 2011~
const {prep,sim,stats}=require('./px'); const {mk}=require('./plan_rules');
const P=prep(['TECL','TQQQ']); const C=P.C.TQQQ, D=P.dates, ix={}; D.forEach((d,i)=>ix[d]=i);
for(const [nm,p] of [['앱(±1%)',{gsb:1e9,fee:0.001}],['새 규칙(−3%·연1회)',{gbOn:0.01,gbOff:0.03,sbDn:0.01,sbUp:0.15,gReb:'y',fee:0.001}],['Guard 없음(TQQQ 늘 30%)',{gsb:1e9,fee:0.001,gbOn:-1,gbOff:10}]]){
  const o=Object.assign({cap:10000,from:'2011-01-01',fee:0.001},mk(P,'TECL','TQQQ',p)); o.cnt={}; const r=sim(P,o), s=stats(r.eq,10000);
  const tq=(o.cnt.TQQQ||[]).filter(x=>x[2]>0.15);   // Guard 전환(비중 15% 넘는 매매)만
  const ex=[]; for(let i=0;i<tq.length;i++) if(tq[i][1]==='s'){ const re=tq.slice(i+1).find(x=>x[1]==='b'); const k0=ix[tq[i][0]], k1=re?ix[re[0]]:D.length-1; let lo=C[k0]; for(let k=k0;k<=k1;k++) lo=Math.min(lo,C[k]);
    ex.push({d:tq[i][0], px:C[k0], re:re?re[0]:'(아직)', rpx:C[k1], days:k1-k0, cost:C[k1]/C[k0]-1, dip:lo/C[k0]-1}); }
  const n=ex.length, back=ex.filter(x=>x.re!=='(아직)'), worse=back.filter(x=>x.cost>0), better=back.filter(x=>x.cost<=0);
  const avg=a=>a.length?a.reduce((p,q)=>p+q,0)/a.length:0;
  console.log(`\n■ ${nm}: 2011~ ${s.cagr.toFixed(1)}/${s.mdd.toFixed(1)} · Guard OFF 매도 ${n}번`);
  if(n){ console.log(`  되살 때 판 값보다 비쌌음 ${worse.length}번(평균 +${(avg(worse.map(x=>x.cost))*100).toFixed(1)}%) · 쌌음 ${better.length}번(평균 ${(avg(better.map(x=>x.cost))*100).toFixed(1)}%) · 판 뒤 다시 살 때까지 가장 깊은 하락 평균 ${(avg(ex.map(x=>x.dip))*100).toFixed(1)}%`);
    console.log('  큰 하락을 피한 매도(판 뒤 −25% 넘게 더 빠짐): '+ex.filter(x=>x.dip<-0.25).map(x=>`${x.d} ${x.px.toFixed(2)}→최저 ${(x.dip*100).toFixed(0)}% · 되삼 ${x.re} ${(x.cost*100).toFixed(0)}%`).join(' | '));
    console.log('  최근 6번: '+ex.slice(-6).map(x=>`${x.d} 판 ${x.px.toFixed(2)} → ${x.re} ${x.rpx.toFixed(2)}(${x.cost>=0?'+':''}${(x.cost*100).toFixed(0)}%, ${x.days}일)`).join(' | ')); } }
