// 듀얼 가드 공격 다이얼(11-08 · 사용자 "공격형은 어디갔어? 그냥 기본으로 해?") — 기본 규칙 + TECL 목표 변동성 s0 .60 (새 규칙 없이)
// vs 기본(.55) vs 옛 공격형(새 규칙 + .60). 앱 엔진 replay 그대로(전일 종가 주수 · 체결가 · 배당 현금) + 모의 목록 세후 TR(hist_at.js 와 같은 계산).
const fs=require('fs'),vm=require('vm'),path=require('path'); const D=__dirname;
// 11-09: 앱 엔진이 규칙 하나만 받게 바뀌어(main 합침) 연구 규칙 벌은 engine_var.js 로 끼운다 — 옛 공격형(exp2)도 같은 값으로 다시 정의.
const E=require('./engine_var').load({b58:{guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,s0:.58},b60:{guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,s0:.60},
  b65:{guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,s0:.65},oldAgg:{guardOn:.01,guardOff:.03,bandDn:.01,bandUp:.15,tqReb:.02,s0:.60}});
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const LAST=T.days[T.days.length-1].date;
const capGainTax=pnl=>pnl>0?Math.max(0,pnl*1350-250e4)*0.22/1350:0;
function acc(){ let N=0,Lost=0,year='',rg=0,taxPaid=0,last=null; const s=()=>Math.max(0,(N-Lost)/N);
  return { step(date,Eq,inflow,x){ if(!(Eq>0)||!(inflow>0)) return; const y=String(date).slice(0,4);
      if(!last){ N=Eq; year=y; last={E:Eq,inflow,realized:0,held:0,cost:0}; }
      if(y!==year){ const Tx=capGainTax(rg); taxPaid+=Tx; Lost+=Tx/(last.E/N); rg=0; year=y; }
      const dIn=inflow-last.inflow; if(dIn>0&&Eq-dIn>0) N+=dIn/((Eq-dIn)/N);
      const dR=(+x.realized||0)-last.realized; if(dR){ rg+=s()*dR; }
      last={E:Eq,inflow,realized:+x.realized||0,held:+x.held||0,cost:+x.cost||0}; },
    done(){ const k=s(), gainNow=rg+k*(last.held-last.cost), Tn=capGainTax(gainNow); const final=k*last.E-Tn; return {tr:(final/last.inflow-1)*100,tax:taxPaid+Tn}; } }; }
function afterTax(R){ const ev=R.ledger.events.filter(e=>e.type==='trade').sort((a,b)=>String(a.date).localeCompare(String(b.date))); const pos={}, A=acc(); let i=0, realized=0;
  for(const n of R.nav){ while(i<ev.length&&ev[i].date<=n.date){ const e=ev[i++], qn=+e.qty||0, px=+e.price||0, fee=+e.fee||0, p=pos[e.symbol]||(pos[e.symbol]={q:0,c:0});
      if(e.side==='buy'){ p.q+=qn; p.c+=qn*px+fee; } else if(qn>0&&p.q>0){ const qq=Math.min(qn,p.q), avg=p.c/p.q; realized+=qq*px-fee-avg*qq; p.q-=qq; p.c-=avg*qq; if(p.q<1e-9){ p.q=0; p.c=0; } } }
    let cost=0; for(const k in pos) cost+=pos[k].c; A.step(n.date,+n.total,+n.inflow,{realized,cost,held:n.tecl*n.teclPx+n.tqqq*n.tqqqPx+n.sgov*(n.sgovPx||0)}); }
  return A.done(); }
const run=(rules,s,e,P,M)=>{ const R=E.replay({horizon:5,rules,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
  if(!R.stats) return null; const at=afterTax(R), nT=R.ledger.events.filter(x=>x.type==='trade'&&x.symbol==='TECL').length;
  return {ret:R.stats.ret,mdd:R.stats.mdd,atr:at.tr,yrs:R.stats.yrs,ann:(Math.pow(Math.max(1e-9,1+at.tr/100),1/R.stats.yrs)-1)*100,teclPerYr:nT/R.stats.yrs}; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const f=(x,d=1)=>x.toFixed(d);
// 0) 확인 — 사용자 모의(1억원·월 10만원·2026-01-02~) 목록 숫자 재현: 기본 세후 11.2 · 공격형 12.1
console.log('자료 끝',LAST);
for(const k of ['base','oldAgg','b60']){ const r=run(k,'2026-01-02',LAST,69244,69.24); console.log(`2026-01-02~ 1억+월10만 ${k}: TR ${f(r.ret)} · 세후 TR ${f(r.atr)} · MDD ${f(r.mdd)}`); }
const KEYS=['base','b58','b60','b65','oldAgg'];
const SETS=[['1만$ 거치',10000,0],['10만$ 거치',100000,0],['2만$ 거치(지금 플랜)',20000,0],['1억원+월 10만원(모의)',69244,69.24]];
for(const [lab,P,M] of SETS){
  console.log(`\n■ ${lab}`);
  const full=Object.fromEntries(KEYS.map(k=>[k,run(k,'2011-04-01',LAST,P,M)]));
  console.log('  전 구간 2011-04~ 세후 연/MDD/TECL 주문 연: '+KEYS.map(k=>`${k} ${f(full[k].ann)}/${f(full[k].mdd)}/${f(full[k].teclPerYr,0)}`).join(' · '));
  for(const [a,b] of [['2011-04-01','2016-01-01'],['2016-01-01','2021-01-01'],['2021-01-01',LAST]]){
    const r=Object.fromEntries(['base','b60','oldAgg'].map(k=>[k,run(k,a,b,P,M)]));
    console.log(`  구간 ${a.slice(0,7)}~${b.slice(0,7)}: `+['base','b60','oldAgg'].map(k=>`${k} ${f(r[k].ann)}/${f(r[k].mdd)}`).join(' · '));
  }
  for(const [nm,months] of [['1년',12],['3년',36],['5년',60]]){
    const rows=[]; for(let s='2011-04-01'; addM(s,months)<=LAST; s=addM(s,1)){ const e=addM(s,months); const r=Object.fromEntries(['base','b60','oldAgg'].map(k=>[k,run(k,s,e,P,M)])); if(r.base&&r.b60&&r.exp2) rows.push(r); }
    const d=rows.map(r=>r.b60.ann-r.base.ann), m=rows.map(r=>r.b60.mdd-r.base.mdd);
    const both=rows.filter(r=>r.b60.ann>r.base.ann&&r.b60.mdd<=r.base.mdd).length, worse=rows.filter(r=>r.b60.ann<r.base.ann&&r.b60.mdd>r.base.mdd).length;
    const med=k=>qq(rows.map(r=>r[k].ann),.5), wst=k=>qq(rows.map(r=>r[k].ann),0), mm=k=>qq(rows.map(r=>r[k].mdd),.5), mw=k=>qq(rows.map(r=>r[k].mdd),1);
    console.log(`  ${nm} 창 ${rows.length}개 · 세후 연 중앙/최악 · MDD 중앙/최악 — 기본 ${f(med('base'))}/${f(wst('base'))} · ${f(mm('base'))}/${f(mw('base'))} | 기본+.60 ${f(med('b60'))}/${f(wst('b60'))} · ${f(mm('b60'))}/${f(mw('b60'))} | 옛 공격형 ${f(med('oldAgg'))}/${f(wst('oldAgg'))} · ${f(mm('oldAgg'))}/${f(mw('oldAgg'))}`);
    console.log(`     기본+.60 − 기본: 연 차 중앙 ${f(qq(d,.5),2)}%p(하위10% ${f(qq(d,.1),2)} · 상위10% ${f(qq(d,.9),2)}) · 기본보다 낮은 창 ${f(d.filter(x=>x<0).length/rows.length*100,0)}% · MDD 차 중앙 ${f(qq(m,.5))} · 둘 다 나음 ${both} vs 둘 다 나쁨 ${worse}`);
  }
}
