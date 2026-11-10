// 단독 규칙 '≥T 뒤 H일 든다'의 매매 내역 · 세후(해마다 실현이익의 22% 를 연말에 냄 — 공제 250만원은 원금 크기에 따라 달라 0 으로 둔 보수적 값 · 손실은 그해 안에서만 상계) · 그냥 들기는 끝날 한 번에 22%
const {series,q}=require('./inv_long');const R=series('SOXS','SOXL','SOXX'),n=R.length;const T=+(process.argv[2]||.7),H=+(process.argv[3]||120),FROM=process.argv[4]||'2010-03-11';
let last=-1e9,w=0,eq=1,cash=1,sh=0,cost=0,pk=1,mdd=0,yr='',rg=0,tax=0,ent=null;const trades=[],i0=R.findIndex(z=>z.date>=FROM);
for(let i=1;i<n;i++){const k=i-1;if(R[k].r>=T)last=k;const nw=(k-last<H)?1:0;if(i<=i0){w=nw;continue;}
  const y=R[i].date.slice(0,4);if(yr&&y!==yr){const t=Math.max(0,rg)*.22;tax+=t;cash-=t;rg=0;}yr=y;   // 연말 정산(현금에서 — 모자라면 음수로 두어 다음 매수에서 깎인다)
  if(nw!==w){const px=R[i].L;if(nw===1){const amt=Math.max(0,cash)*(1-0.001);sh=amt/px;cost=amt;cash=Math.min(0,cash);ent={d:R[i].date,px};}
    else{const pr=sh*px*(1-0.001);rg+=pr-cost;cash+=pr;trades.push({in:ent.d,out:R[i].date,ret:px/ent.px-1,days:Math.round((Date.parse(R[i].date)-Date.parse(ent.d))/864e5)});sh=0;cost=0;ent=null;}w=nw;}
  eq=cash+sh*R[i].L;pk=Math.max(pk,eq);mdd=Math.max(mdd,1-eq/pk);}
const yrs=(Date.parse(R[n-1].date)-Date.parse(R[i0].date))/(365.25*864e5);
const endTax=sh>0?Math.max(0,rg+sh*R[n-1].L-cost)*.22:Math.max(0,rg)*.22;const fin=eq-endTax;
const bh=R[n-1].L/R[i0].L,bhAfter=1+(bh-1)*.78;
console.log(`■ SOXS/SOXL ≥${T*100}% 뒤 ${H}거래일 보유 · ${R[i0].date}~${R[n-1].date} (${yrs.toFixed(1)}년)`);
console.log(`  세후: ×${fin.toFixed(1)} · 연 ${((Math.pow(fin,1/yrs)-1)*100).toFixed(1)}% · 최대 낙폭 ${(mdd*100).toFixed(1)}% · 낸 세금(원금 대비) ${(tax+endTax).toFixed(1)}배`);
console.log(`  그냥 들기 세후(끝날 22%): ×${bhAfter.toFixed(1)} · 연 ${((Math.pow(bhAfter,1/yrs)-1)*100).toFixed(1)}%`);
console.log(`  매매 ${trades.length}번(이긴 ${trades.filter(t=>t.ret>0).length}) · 지금 ${ent?'보유 중('+ent.d+' 매수 · '+((R[n-1].L/ent.px-1)*100).toFixed(0)+'%)':'현금'} · 마지막 신호일 ${last>=0?R[last].date:'-'}`);
for(const t of trades)console.log(`   ${t.in} → ${t.out} (${String(t.days).padStart(4)}일) ${(t.ret*100>=0?'+':'')+(t.ret*100).toFixed(0)}%`);
