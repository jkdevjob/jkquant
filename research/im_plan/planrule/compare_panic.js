// 기준 듀얼가드 vs 공포 모드 — 전 구간 자세한 비교(11-10 · 사용자 "두 개 차이를 자세하게 비교해봐 매매수 등등")
// 앱 엔진 replay 그대로(engine_panic.js · 체결가 · 전일 종가 주수 · 배당 현금 · 수수료 0.1%) + 모의 목록 세후(panic_eval 과 같은 계산).
// 사용: SETS='1만,2.5만' VARS='{"공포":{"hi":40,"lo":35,"ma":50,"band":0.02,"sleeve":"min","k":3.0,"fbK":3.6}}' node compare_panic.js
const fs=require('fs'),path=require('path'); const D=__dirname;
const VARS=JSON.parse(process.env.VARS||'{"공포 모드":{"hi":40,"lo":35,"ma":50,"band":0.02,"sleeve":"min","k":3.0,"fbK":3.6}}'); const VK=Object.keys(VARS)[0];
const E=require('./engine_panic').load(VARS);
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const LAST=T.days[T.days.length-1].date;
const {afterTax}=require('./aftertax');   // 세후 = panic_eval · var_eval 과 같은 함수(11-10 고침 — 예전 사본은 SGOV 평가액을 빠뜨려 청산세가 0 이었다 · 지피티 검토에서 발견)
const run=(rules,P,M)=>{ E.__LOG.length=0; const R=E.replay({horizon:5,rules,startDate:'2011-04-01',endDate:LAST,principal:P,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div}); return {R,log:E.__LOG.slice(),at:afterTax(R)}; };
const f=(x,d=1)=>x.toFixed(d); const pct=x=>(x*100).toFixed(1); const mdd=a=>{ let pk=0,m=0,pkD='',md=null; for(const [d,v] of a){ if(v>pk){ pk=v; pkD=d; } else { const x=1-v/pk; if(x>m){ m=x; md=[pkD,d]; } } } return {m:m*100,at:md}; };
const SETS=(process.env.SETS||'1만,2.5만').split(','), CFG={'1만':[10000,0,'1만$ 거치'],'10만':[100000,0,'10만$ 거치'],'2.5만':[25000,210,'2.5만$ + 월 210$(실제 구성)'],'1억':[69244,69.24,'1억원+월 10만원']};
for(const key of SETS){ const [P,M,lab]=CFG[key]; console.log(`\n${'═'.repeat(28)} ${lab} · 2011-04-01~${LAST} · 앱 엔진 체결 ${'═'.repeat(28)}`);
  const A=run('base',P,M), B=run(VK,P,M); const yrs=A.R.stats.yrs;
  const sum=(R)=>{ const tr=R.ledger.events.filter(e=>e.type==='trade'); const by={}; let fee=0, val=0; for(const e of tr){ const k=e.symbol+' '+(e.side==='buy'?'매수':'매도'); by[k]=(by[k]||0)+1; fee+=+e.fee||0; val+=(+e.qty||0)*(+e.price||0); } return {n:tr.length,by,fee,val}; };
  const sa=sum(A.R), sb=sum(B.R); const avgEq=R=>R.nav.reduce((a,n)=>a+n.total,0)/R.nav.length;
  const taxA=A.at.tax, taxB=B.at.tax;
  const row=(nm,R,at,s,tax)=>{ const fin=R.nav[R.nav.length-1]; const m=mdd(R.nav.map(n=>[n.date,n.total])); return `  ${nm.padEnd(8)} 세후 연 ${f((Math.pow(Math.max(1e-9,at.final/fin.inflow),1/yrs)-1)*100)}% · 세전 연 ${f((Math.pow(fin.total/fin.inflow,1/yrs)-1)*100)}% · MDD ${f(m.m)}% (${m.at?m.at[0]+'→'+m.at[1]:''}) · 끝 세후 ${Math.round(at.final).toLocaleString()}$ (낸 돈 ${Math.round(fin.inflow).toLocaleString()}$ · ×${f(at.final/fin.inflow)}) · 세금 합 ${Math.round(tax).toLocaleString()}$ · 수수료 합 ${Math.round(s.fee).toLocaleString()}$ · 주문 ${s.n}건 (${(s.n/yrs).toFixed(1)}/년 · ${Object.entries(s.by).map(([k,v])=>k+' '+v).join(' · ')}) · 매매대금 ${Math.round(s.val).toLocaleString()}$ = 평균 평가액의 ${f(s.val/avgEq(R)/yrs,2)}배/년`; };
  console.log(row('기준',A.R,A.at,sa,taxA)); console.log(row(VK,B.R,B.at,sb,taxB));
  // 연도별
  console.log('\n  연도별(세전 %) 기준 / 공포 / 차 | 주문 수 기준/공포 | 양도세($, 그해 실현분 · 다음 해 납부) 기준/공포 | TQQQ 보유일 비율 기준/공포 | 평균 TECL 비중 기준/공포');
  const byY=(R)=>{ const o={}; let prev=null; for(const n of R.nav){ const y=n.date.slice(0,4); const t=o[y]=o[y]||{a:prev??n.total,b:n.total,on:0,n:0,wT:0}; t.b=n.total; t.on+=n.tqqq>0?1:0; t.n++; t.wT+=n.tecl*n.teclPx/n.total; prev=n.total; } return o; };
  const yA=byY(A.R), yB=byY(B.R); const trY=(R)=>{ const o={}; for(const e of R.ledger.events.filter(e=>e.type==='trade')){ const y=String(e.date).slice(0,4); o[y]=(o[y]||0)+1; } return o; }; const tA=trY(A.R), tB=trY(B.R);
  for(const y of Object.keys(yA).sort()){ const a=yA[y], b=yB[y]; const ra=(a.b/a.a-1)*100, rb=(b.b/b.a-1)*100; console.log(`  ${y}  ${ra.toFixed(1).padStart(6)} / ${rb.toFixed(1).padStart(6)} / ${(rb-ra>=0?'+':'')+(rb-ra).toFixed(1).padStart(5)} | ${String(tA[y]||0).padStart(2)}/${String(tB[y]||0).padStart(2)} | ${Math.round(A.at.byYear[y]||0).toLocaleString().padStart(6)}/${Math.round(B.at.byYear[y]||0).toLocaleString().padStart(6)} | ${pct(a.on/a.n).padStart(5)}/${pct(b.on/b.n).padStart(5)} | ${pct(a.wT/a.n).padStart(4)}/${pct(b.wT/b.n).padStart(4)}`); }
  // 비중·노출
  const expo=(R)=>{ let wT=0,wQ=0,wC=0,on=0; for(const n of R.nav){ wT+=n.tecl*n.teclPx/n.total; wQ+=n.tqqq*n.tqqqPx/n.total; wC+=1-(n.tecl*n.teclPx+n.tqqq*n.tqqqPx)/n.total; on+=n.tqqq>0?1:0; } const N=R.nav.length; return `TECL ${pct(wT/N)}% · TQQQ ${pct(wQ/N)}% · SGOV·현금 ${pct(wC/N)}% · TQQQ 보유일 ${pct(on/N)}%`; };
  console.log(`\n  평균 비중 — 기준: ${expo(A.R)} | ${VK}: ${expo(B.R)}`);
  // 낙폭 사건 비교(15% 넘는 것 · 기준 기준 사건 구간에서 두 전략 깊이)
  const navA=A.R.nav.map(n=>[n.date,n.total]), navB=B.R.nav.map(n=>[n.date,n.total]); const ep=[]; { let pk=0,pkI=0,inD=false,trI=0,trV=Infinity; for(let i=0;i<navA.length;i++){ const v=navA[i][1]; if(v>=pk){ if(inD) ep.push({pkI,trI,recI:i}); inD=false; pk=v; pkI=i; trV=Infinity; } else { if(1-v/pk>=0.15) inD=true; if(v<trV){ trV=v; trI=i; } } } if(inD) ep.push({pkI,trI,recI:null}); }
  console.log('\n  낙폭 사건(기준 15% 넘는 것) — 고점→바닥 · 기준 깊이 / 공포 깊이(같은 날 기준 고점 대비) · 회복(거래일) 기준/공포');
  const depthB=(pkI,trI)=>{ let pk=0; for(let i=0;i<=pkI;i++) pk=Math.max(pk,navB[i][1]); let lo=Infinity; for(let i=pkI;i<=trI;i++) lo=Math.min(lo,navB[i][1]); return (1-lo/pk)*100; };
  const recB=(pkI)=>{ let pk=0; for(let i=0;i<=pkI;i++) pk=Math.max(pk,navB[i][1]); for(let i=pkI+1;i<navB.length;i++) if(navB[i][1]>=pk) return i-pkI; return null; };
  for(const e of ep){ const da=(1-navA[e.trI][1]/navA[e.pkI][1])*100, db=depthB(e.pkI,e.trI); const rb=recB(e.pkI); console.log(`  ${navA[e.pkI][0]} → ${navA[e.trI][0]}  ${f(da).padStart(5)} / ${f(db).padStart(5)} ${Math.abs(db-da)>=0.5?(db<da?'◀ 공포 얕음':'▶ 공포 깊음'):''}  · 회복 ${e.recI?(e.recI-e.pkI):'미회복'} / ${rb??'미회복'}`); }
  // 모드 전환 기록
  console.log(`\n  ${VK} 상태 전환 기록(판정 = 전일 확정값 · 체결 = 그날 종가):`);
  for(const l of B.log) console.log(`  ${l.date} (신호 ${l.signal}) ${l.ev}${l.vix!=null?' · VIX '+l.vix.toFixed(1):''}${l.tqqq!=null?' · TQQQ '+l.tqqq.toFixed(2)+' / SMA225 '+l.sma225.toFixed(2)+' / SMA50 '+(l.sma50||0).toFixed(2):''}${l.sigma20!=null?' · TECL σ20 '+(l.sigma20*100).toFixed(0)+'% · k×VXN '+(l.iv*100).toFixed(0)+'%':''}`);
  // 구조가 다른 주문(날짜·종목·방향이 한쪽에만 있는 것 — 수량만 다른 것은 평가액 차이라 뺀다) · 연도별 묶음
  const trA=A.R.ledger.events.filter(e=>e.type==='trade'), trB=B.R.ledger.events.filter(e=>e.type==='trade'); const k3=e=>`${e.date}|${e.symbol}|${e.side}`; const sA=new Set(trA.map(k3)), sB=new Set(trB.map(k3));
  const oA=trA.filter(e=>!sB.has(k3(e))), oB=trB.filter(e=>!sA.has(k3(e))); const fmt=e=>`${e.symbol} ${e.side==='buy'?'매수':'매도'} ${Math.round(e.qty)}주@${(+e.price).toFixed(2)}`;
  console.log(`\n  구조가 다른 주문(날짜·종목·방향 기준) — 기준에만 ${oA.length}건 · ${VK}에만 ${oB.length}건 · 그 밖 ${trA.length-oA.length}건은 같은 날 같은 방향(수량만 평가액 차이로 다름)`);
  const days=[...new Set([...oA,...oB].map(e=>e.date))].sort(); for(const d of days){ const a=oA.filter(e=>e.date===d).map(fmt).join(', '), b=oB.filter(e=>e.date===d).map(fmt).join(', '); console.log(`  ${d}  기준: ${(a||'-').padEnd(34)} | ${VK}: ${b||'-'}`); }
  // 사건별 손익 기여 — 무장일 → 보통 복귀일 사이 두 곡선의 비율 변화(세전 평가액) 와 끝 비율
  const navMapA=Object.fromEntries(A.R.nav.map(n=>[n.date,n.total])), navMapB=Object.fromEntries(B.R.nav.map(n=>[n.date,n.total])); const dates=A.R.nav.map(n=>n.date);
  const at=(d,M)=>{ let v=null; for(const x of dates){ if(x>d) break; v=M[x]; } return v; };
  const ratio=d=>at(d,navMapB)/at(d,navMapA);
  console.log(`\n  사건별 기여(세전 평가액 비율 ${VK}/기준 · 무장 전날 → 보통 복귀/끝 · 그 뒤 60거래일):`);
  const eps=[]; let cur=null; for(const l of B.log){ if(l.ev==='무장'&&(!cur||l.date>cur.end)){ if(cur) eps.push(cur); cur={arm:l.date,end:l.date,events:[]}; } if(cur){ cur.events.push(l.ev); if(l.ev.startsWith('보통 복귀')||l.ev.startsWith('슬리브 공포 모드 끝')) cur.end=l.date; } } if(cur) eps.push(cur);
  const merged=[]; for(const e of eps){ const m=merged[merged.length-1]; if(m&&e.arm<=m.end) { m.end=e.end>m.end?e.end:m.end; m.events.push(...e.events); } else merged.push(e); }
  for(const e of merged){ const i0=Math.max(0,dates.indexOf(e.arm)-1), i1=dates.indexOf(e.end), i2=Math.min(dates.length-1,i1+60); const r0=ratio(dates[i0]); console.log(`  ${dates[i0]} → ${e.end} (${i1-i0}일): ×${(ratio(e.end)/r0).toFixed(3)} · +60일 ×${(ratio(dates[i2])/r0).toFixed(3)} · 빠른 모드 ON ${e.events.filter(x=>x.includes('빠른 모드 ON')||x.includes('다시 ON')).length}회 · 슬리브 ${e.events.filter(x=>x==='슬리브 공포 모드 시작').length}회`); }
  console.log(`  끝 비율(세전) ×${ratio(dates[dates.length-1]).toFixed(3)} · 세후 끝 ×${(B.at.final/A.at.final).toFixed(3)}`);
}
