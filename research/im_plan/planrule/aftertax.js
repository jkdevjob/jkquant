// 모의 목록 세후 계산(hist_at.js 와 같은 식) — 한 곳(11-10). var_eval.js · panic_eval.js · compare_panic.js 가 같이 쓴다.
// 11-10 지피티 검토(R-20261110-1)에서 compare_panic.js 가 따로 가진 사본이 SGOV 평가액을 빠뜨려 청산세가 0 으로 나온 것을 찾았다 — '같은 걸 두 군데서 세지 않는다'.
// 해마다 실현손익에 양도세(22% · 250만원 공제 · 환율 1350) · 끝날 보유분(TECL·TQQQ·SGOV 전부) 평가이익에 청산세. done() = {tr 세후 TR% · tax 세금 합 · final 세후 끝값 · byYear 해마다 세금}
const capGainTax=(pnl,dm=1)=>pnl>0?Math.max(0,pnl*1350-250e4*dm)*0.22/1350:0;   // dm(11-13): 공제 배율 — 사람당 공제를 여러 다리가 나눠 쓸 때(안 주면 1)
function acc(dm=1){ let N=0,Lost=0,year='',rg=0,taxPaid=0,last=null,feeLost=0; const byYear={}; const s=()=>Math.max(0,(N-Lost)/N);
  return { step(date,Eq,inflow,x){ if(!(Eq>0)||!(inflow>0)) return; const y=String(date).slice(0,4);
      if(!last){ N=Eq; year=y; last={E:Eq,inflow,realized:0,held:0,cost:0}; }
      if(y!==year){ const Tx=capGainTax(rg,dm); taxPaid+=Tx; byYear[year]=Tx; Lost+=Tx/(last.E/N); rg=0; year=y; }
      const dIn=inflow-last.inflow; if(dIn>0&&Eq-dIn>0) N+=dIn/((Eq-dIn)/N);
      const dR=(+x.realized||0)-last.realized; if(dR){ rg+=s()*dR; }
      last={E:Eq,inflow,realized:+x.realized||0,held:+x.held||0,cost:+x.cost||0}; },
    // 11-13 연말 정리 고리: 그해 실현이익(실계좌 $) · 생존 비율 · 수수료(장부 $)를 단위 손실로
    rgNow(){ return rg; }, surv(){ return s(); }, payFee(feeLedger){ if(last&&feeLedger>0){ Lost+=feeLedger/(last.E/N); feeLost+=feeLedger*s(); } },
    done(){ const k=s(), gainNow=rg+k*(last.held-last.cost), Tn=capGainTax(gainNow,dm); const final=k*last.E-Tn; byYear[year+'(진행·청산)']=Tn; return {tr:(final/last.inflow-1)*100,tax:taxPaid+Tn,final,byYear,feeLost}; } }; }
function afterTax(R,dm=1){ const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const pos={}, A=acc(dm); let i=0, realized=0;
  for(const n of R.nav){ while(i<ev.length&&ev[i].date<=n.date){ const e=ev[i++], qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } }
    let cost=0; for(const k in pos) cost+=pos[k].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); }
  return A.done(); }
/* 11-13 ⑥ 연말 세금 정리(앱 🧾 연말 세금 점검 · '팔고 바로 되사기') — 사후 장부: 해마다 마지막 거래일 종가에
   그해 실현이익 < 공제면 평가이익 종목을 (공제 − 실현이익)만큼 팔고 되사 원가를 올림(mode gain) · > 공제면 평가손실 종목을 넘친 만큼 팔고 되사 원가를 내림(mode loss)
   같은 날 같은 종가에 되사므로 보유 수량·경로는 그대로 · 수수료 fee × 2(판 값 기준)만 단위 손실로 뺀다. o={dm, mode:'both'|'gain'|'loss'|'none', fee}
   돌려줌: afterTax 와 같은 {tr,tax,final,byYear} + hv{g:채운 이익, l:상계한 손실, fees, n:정리한 해 수} (모두 실계좌 $) */
function afterTaxH(R,o={}){ const dm=o.dm??1, mode=o.mode||'both', FEE=o.fee??0.001, D=250e4*dm/1350;
  const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const pos={}, A=acc(dm); let i=0, realized=0; const hv={g:0,l:0,fees:0,n:0};
  const NV=R.nav;
  for(let t=0;t<NV.length;t++){ const n=NV[t]; while(i<ev.length&&ev[i].date<=n.date){ const e=ev[i++], qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } }
    const px={TECL:n.teclPx,TQQQ:n.tqqqPx,SGOV:n.sgovPx||0};
    const yEnd=t+1<NV.length&&NV[t+1].date.slice(0,4)!==n.date.slice(0,4);
    if(yEnd&&mode!=='none'&&t>0){ const k=A.surv(), rgY=A.rgNow()+k*(realized-(A._lastR??0));   // 그해 실현이익(실계좌 $ · 오늘 체결분까지)
      const L=[]; for(const sym in pos){ const p=pos[sym], v=p.q*(px[sym]||0); if(p.q>0&&v>0) L.push({sym,p,v,g:v-p.c}); }
      let fees=0;
      if((mode==='both'||mode==='gain')&&rgY<D){ let room=(D-rgY)/k; for(const x of L.filter(x=>x.g>0).sort((a,b)=>b.g-a.g)){ if(room<=0) break; const h=Math.min(room,x.g), f=h/x.g; x.p.c+=h; realized+=h; room-=h; fees+=FEE*2*f*x.v; hv.g+=h*k; } }
      else if((mode==='both'||mode==='loss')&&rgY>D){ let ex=(rgY-D)/k; for(const x of L.filter(x=>x.g<0).sort((a,b)=>a.g-b.g)){ if(ex<=0) break; const l=Math.min(ex,-x.g), f=l/(-x.g); x.p.c-=l; realized-=l; ex-=l; fees+=FEE*2*f*x.v; hv.l+=l*k; } }
      if(fees>0){ hv.fees+=fees*k; hv.n++; } A._pendFee=fees; }
    let cost=0; for(const k2 in pos) cost+=pos[k2].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); A._lastR=realized;
    if(A._pendFee){ A.payFee(A._pendFee); A._pendFee=0; } }
  const r=A.done(); r.hv=hv; return r; }
/* 11-13 ⑥-b 앱 절차 그대로 — 해마다 앱의 마감일(plan-tax-check.js lastTradeDate · 결제일이 그해 안인 마지막 거래일)에 앱 check() 를 부르고
   (장부 = 그날까지 엔진 체결 + 앞선 해의 정리 체결 · 가격 = 그날 종가 · 환율 1350 고정 · 공제 = 250만원 × dm ÷ 생존 비율 — 실계좌가 장부 × 생존 비율이라서)
   제안(정수 주 · 공제 채우기는 남은 공제의 90% · 손실 상계는 수수료보다 이득일 때만)을 '같은 날 같은 값에 팔고 되사기' 체결로 장부에 넣는다. 수수료 = 엔진 alphaFee × 2.
   o={TC:JKPlanTaxCheck, fee:alphaFee, dm, margin} · 돌려줌: afterTax 와 같음 + hv{g:채운 이익, l:상계한 손실, fees, n:정리한 해, nSug:제안 수}(실계좌 $) */
function afterTaxApp(R,o){ const TC=o.TC, feeFn=o.fee, dm=o.dm??1;
  const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const extra=[], pos={}, A=acc(dm); let i=0, realized=0; const hv={g:0,l:0,fees:0,n:0,nSug:0,fill:0,offset:0,mixed:0};
  const apply=e=>{ const qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
    if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } };
  const NV=R.nav, dl={}; for(const n of NV){ const y=n.date.slice(0,4); if(!(y in dl)) dl[y]=TC.lastTradeDate(y); }
  const hd={}; for(const n of NV){ const y=n.date.slice(0,4); if(n.date<=dl[y]) hd[y]=n.date; }   // 마감일 이하 마지막 자료 날
  const FX=[{date:'1900-01-01',close:1350}];
  for(let t=0;t<NV.length;t++){ const n=NV[t]; while(i<ev.length&&ev[i].date<=n.date) apply(ev[i++]);
    const y=n.date.slice(0,4); let fees=0;
    if(hd[y]===n.date&&t>0&&t<NV.length-1&&n.date.slice(5)>='12-01'){ const k=A.surv();
      const C=TC.check({ledger:{base:R.ledger.base,events:ev.slice(0,i).concat(extra)},prices:{TECL:n.teclPx,TQQQ:n.tqqqPx,SGOV:n.sgovPx||0},feeFn,fxSeries:FX,year:y,dedKrw:250e4*dm/k,rate:.22,margin:o.margin});
      if(C.ok){ hv[C.mode]=(hv[C.mode]||0)+1;
        for(const sg of C.suggestions){ const f1=feeFn(sg.qty,sg.price), es={type:'trade',date:n.date,side:'sell',symbol:sg.symbol,qty:sg.qty,price:sg.price,fee:f1}, eb={type:'trade',date:n.date,side:'buy',symbol:sg.symbol,qty:sg.qty,price:sg.price,fee:f1};
          const r0=realized; extra.push(es,eb); apply(es); apply(eb); fees+=2*f1; const dr=(realized-r0)*k; if(dr>=0) hv.g+=dr; else hv.l-=dr; hv.nSug++; }
        if(fees>0){ hv.fees+=fees*k; hv.n++; } } }
    let cost=0; for(const s2 in pos) cost+=pos[s2].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); A._lastR=realized;
    if(fees>0) A.payFee(fees); }
  const r=A.done(); r.hv=hv; return r; }
module.exports={capGainTax,acc,afterTax,afterTaxH,afterTaxApp};
