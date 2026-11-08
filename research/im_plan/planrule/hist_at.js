// 앱 엔진 + 모의 목록의 세후 TR(planAfterTax · paperAfterTaxAcc 그대로) — 기본 vs 새 규칙 vs 공격형, 과거 여러 시작일
const fs=require('fs'),vm=require('vm'),path=require('path'); const D=__dirname;
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(D,'..','..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const LAST='2026-11-06';
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
const run=(rules,s,e,P,M)=>{ const R=E.replay({horizon:5,rules,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div}); if(!R.stats) return null; const at=afterTax(R); return {ret:R.stats.ret,mdd:R.stats.mdd,atr:at.tr,yrs:R.stats.yrs}; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
// 확인: 사용자 세션 세후 TR 재현(목록: 기본 +11.2 · 새 +8.8 · 공격 +12.1)
for(const k of ['base','exp1','exp2']){ const r=run(k,'2026-01-02',LAST,69244,69.24); console.log(`재현 ${k}: TR ${r.ret.toFixed(1)} · 세후 TR ${r.atr.toFixed(1)} · MDD ${r.mdd.toFixed(1)}`); }
const SETS=(process.env.SETS||'paper,lump20,dep25').split(','); const CFG={paper:[69244,69.24,'1억원 + 월 10만원(모의와 같음)'],lump20:[20000,0,'2만$ 거치(지금 플랜)'],dep25:[25000,210,'2.5만$ + 월 210$(추천 2전략)']};
for(const cfg of SETS){ const [P,M,lab]=CFG[cfg]; console.log(`\n■ ${lab}`);
  for(const [nm,months] of [['10개월',10],['1년',12],['3년',36],['5년',60]]){ const rows=[]; for(let s='2011-04-01'; addM(s,months)<=LAST; s=addM(s,1)){ const e=addM(s,months); const b=run('base',s,e,P,M), n=run('exp1',s,e,P,M), x=run('exp2',s,e,P,M); if(b&&n&&x) rows.push({s,b,n,x}); }
    const ann=(r,k)=>(Math.pow(1+r[k].atr/100,1/r[k].yrs)-1)*100;   // 세후 TR 을 연율로(적립이 작아 근사)
    const dn=rows.map(r=>ann(r,'n')-ann(r,'b')), dx=rows.map(r=>ann(r,'x')-ann(r,'b')), mn=rows.map(r=>r.n.mdd-r.b.mdd), mx=rows.map(r=>r.x.mdd-r.b.mdd);
    console.log(`  ${nm} ${rows.length}개: 새 규칙 — 세후 연수익 차 중앙 ${qq(dn,.5).toFixed(2)}%p (하위10% ${qq(dn,.1).toFixed(2)} · 상위10% ${qq(dn,.9).toFixed(2)}) · 기본보다 낮은 구간 ${(dn.filter(x=>x<0).length/rows.length*100).toFixed(0)}% · MDD 차 중앙 ${qq(mn,.5).toFixed(1)} · MDD 작은 구간 ${(mn.filter(x=>x<0).length/rows.length*100).toFixed(0)}% | 공격형 — ${qq(dx,.5).toFixed(2)}%p · 낮은 구간 ${(dx.filter(x=>x<0).length/rows.length*100).toFixed(0)}% · MDD 차 ${qq(mx,.5).toFixed(1)}`); }
  const b=run('base','2011-04-01',LAST,P,M), n=run('exp1','2011-04-01',LAST,P,M), x=run('exp2','2011-04-01',LAST,P,M); const a=r=>(Math.pow(1+r.atr/100,1/r.yrs)-1)*100;
  console.log(`  전 구간 2011-04~: 세후 연 기본 ${a(b).toFixed(1)} · 새 ${a(n).toFixed(1)} · 공격 ${a(x).toFixed(1)} | MDD ${b.mdd.toFixed(1)} · ${n.mdd.toFixed(1)} · ${x.mdd.toFixed(1)}`); }
