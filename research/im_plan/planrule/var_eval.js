// 듀얼 가드 후보 비교(11-09 · 매일 연구용) — 앱 엔진 replay 그대로(engine_var.js 로 규칙 값만 끼움 · 전일 종가 주수 · 체결가 · 배당 현금)
// + 모의 목록 세후 TR(hist_at.js 와 같은 계산). 사용: VARS='{"g15":{"guardOn":0.015,"guardOff":0.015}}' node var_eval.js
// 보는 것: 1만$·10만$·2만$·1억+월10만 · 전 구간 세후 연/MDD/TECL·TQQQ 주문 수 · 구간 3개 · 5년 창(매달 시작) 중앙/최악 · 기본과 짝 · 앞·뒤 절반(표본 밖)
const fs=require('fs'),path=require('path'); const D=__dirname;
const BASEV={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10};
const VARS=JSON.parse(process.env.VARS||'{}'); const V={}; for(const [k,v] of Object.entries(VARS)) V[k]=Object.assign({},BASEV,v);
const E=require('./engine_var').load(V);
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
  if(!R.stats) return null; const at=afterTax(R), tr=R.ledger.events.filter(x=>x.type==='trade');
  return {mdd:R.stats.mdd,yrs:R.stats.yrs,ann:(Math.pow(Math.max(1e-9,1+at.tr/100),1/R.stats.yrs)-1)*100,nT:tr.filter(x=>x.symbol==='TECL').length/R.stats.yrs,nQ:tr.filter(x=>x.symbol==='TQQQ').length/R.stats.yrs}; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const f=(x,d=1)=>(x>=0&&d>=0?'':'')+x.toFixed(d);
const KEYS=['base',...Object.keys(V)], HALF='2016-04-01';
console.log('자료 끝',LAST,'· 후보',JSON.stringify(VARS));
const SETS=(process.env.SETS||'1만,10만,2만,1억').split(','), CFG={'1만':[10000,0,'1만$ 거치'],'10만':[100000,0,'10만$ 거치'],'2만':[20000,0,'2만$ 거치(지금 플랜)'],'1억':[69244,69.24,'1억원+월 10만원']};
for(const key of SETS){ const [P,M,lab]=CFG[key]; console.log(`\n■ ${lab}`);
  const full=Object.fromEntries(KEYS.map(k=>[k,run(k,'2011-04-01',LAST,P,M)]));
  console.log('  전 구간 2011-04~ 세후 연/MDD · 주문/년 TECL·TQQQ: '+KEYS.map(k=>`${k} ${f(full[k].ann)}/${f(full[k].mdd)} · ${f(full[k].nT,0)}·${f(full[k].nQ,1)}`).join(' | '));
  for(const [a,b] of [['2011-04-01','2016-01-01'],['2016-01-01','2021-01-01'],['2021-01-01',LAST]]){ const r=Object.fromEntries(KEYS.map(k=>[k,run(k,a,b,P,M)]));
    console.log(`  구간 ${a.slice(0,7)}~${b.slice(0,7)}: `+KEYS.map(k=>`${k} ${f(r[k].ann)}/${f(r[k].mdd)}`).join(' · ')); }
  const rows=[]; for(let s='2011-04-01'; addM(s,60)<=LAST; s=addM(s,1)){ const e=addM(s,60); const r=Object.fromEntries(KEYS.map(k=>[k,run(k,s,e,P,M)])); if(KEYS.every(k=>r[k])) rows.push({s,r}); }
  const st=(k,flt=()=>true)=>{ const R=rows.filter(flt); return {n:R.length,med:qq(R.map(x=>x.r[k].ann),.5),min:Math.min(...R.map(x=>x.r[k].ann)),mMed:qq(R.map(x=>x.r[k].mdd),.5),mMax:Math.max(...R.map(x=>x.r[k].mdd))}; };
  const b=st('base'); console.log(`  5년 창 ${b.n}개 · 기본: 세후 연 중앙 ${f(b.med)} · 최악 ${f(b.min)} · MDD 중앙 ${f(b.mMed)} · 최악 ${f(b.mMax)}`);
  for(const k of Object.keys(V)){ const x=st(k), d=rows.map(r=>r.r[k].ann-r.r.base.ann), dm=rows.map(r=>r.r[k].mdd-r.r.base.mdd);
    const both=rows.filter(r=>r.r[k].ann>r.r.base.ann&&r.r[k].mdd<=r.r.base.mdd).length, worse=rows.filter(r=>r.r[k].ann<r.r.base.ann&&r.r[k].mdd>r.r.base.mdd).length;
    const h1=rows.filter(r=>r.s<HALF).map(r=>r.r[k].ann-r.r.base.ann), h2=rows.filter(r=>r.s>=HALF).map(r=>r.r[k].ann-r.r.base.ann);
    console.log(`  ${k.padEnd(6)} 중앙 ${f(x.med)} · 최악 ${f(x.min)} · MDD 중앙 ${f(x.mMed)} · 최악 ${f(x.mMax)} | 기본 대비 연 차 중앙 ${f(qq(d,.5),2)} (하10 ${f(qq(d,.1),2)} · 상10 ${f(qq(d,.9),2)}) · 낮은 창 ${f(d.filter(v=>v<0).length/rows.length*100,0)}% · MDD 차 중앙 ${f(qq(dm,.5))} · 둘 다 나음 ${both} : 둘 다 나쁨 ${worse} | 앞 절반(~${HALF.slice(0,7)}) ${f(qq(h1,.5),2)} · 뒤 절반 ${f(qq(h2,.5),2)}`); }
}
