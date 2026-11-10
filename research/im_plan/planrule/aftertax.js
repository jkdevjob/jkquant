// 모의 목록 세후 계산(hist_at.js 와 같은 식) — 한 곳(11-10). var_eval.js · panic_eval.js · compare_panic.js 가 같이 쓴다.
// 11-10 지피티 검토(R-20261110-1)에서 compare_panic.js 가 따로 가진 사본이 SGOV 평가액을 빠뜨려 청산세가 0 으로 나온 것을 찾았다 — '같은 걸 두 군데서 세지 않는다'.
// 해마다 실현손익에 양도세(22% · 250만원 공제 · 환율 1350) · 끝날 보유분(TECL·TQQQ·SGOV 전부) 평가이익에 청산세. done() = {tr 세후 TR% · tax 세금 합 · final 세후 끝값 · byYear 해마다 세금}
const capGainTax=pnl=>pnl>0?Math.max(0,pnl*1350-250e4)*0.22/1350:0;
function acc(){ let N=0,Lost=0,year='',rg=0,taxPaid=0,last=null; const byYear={}; const s=()=>Math.max(0,(N-Lost)/N);
  return { step(date,Eq,inflow,x){ if(!(Eq>0)||!(inflow>0)) return; const y=String(date).slice(0,4);
      if(!last){ N=Eq; year=y; last={E:Eq,inflow,realized:0,held:0,cost:0}; }
      if(y!==year){ const Tx=capGainTax(rg); taxPaid+=Tx; byYear[year]=Tx; Lost+=Tx/(last.E/N); rg=0; year=y; }
      const dIn=inflow-last.inflow; if(dIn>0&&Eq-dIn>0) N+=dIn/((Eq-dIn)/N);
      const dR=(+x.realized||0)-last.realized; if(dR){ rg+=s()*dR; }
      last={E:Eq,inflow,realized:+x.realized||0,held:+x.held||0,cost:+x.cost||0}; },
    done(){ const k=s(), gainNow=rg+k*(last.held-last.cost), Tn=capGainTax(gainNow); const final=k*last.E-Tn; byYear[year+'(진행·청산)']=Tn; return {tr:(final/last.inflow-1)*100,tax:taxPaid+Tn,final,byYear}; } }; }
function afterTax(R){ const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const pos={}, A=acc(); let i=0, realized=0;
  for(const n of R.nav){ while(i<ev.length&&ev[i].date<=n.date){ const e=ev[i++], qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } }
    let cost=0; for(const k in pos) cost+=pos[k].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); }
  return A.done(); }
module.exports={capGainTax,acc,afterTax};
