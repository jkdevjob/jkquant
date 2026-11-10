// TECL 줄이기 매도 뒤 '다음 매수' 가격(11-11) — 앱 엔진 기본/공포 모드 장부 · 1e6 원금 · 매도 한 건마다 그다음 TECL 매수 체결가와 비교(비싸게 되삼 = +)
const fs=require('fs'),path=require('path'); const D=__dirname,R=path.join(D,'..','data'); const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const E=require('./engine_var').load({}); const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const ix=s=>rd(path.join(R,s+'.json')).series.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close}));
const X={T:q(path.join(D,'data','TECL.json')),Q:q(path.join(D,'data','TQQQ.json')),G:q(path.join(D,'data','SGOV.json'))};
for(const rules of ['base','panic']){ const Rr=E.replay({horizon:5,rules,startDate:'2011-04-01',endDate:'',principal:1e6,monthlyAdd:0,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix:ix('VIX'),vxn:ix('VXN')});
  const ev=Rr.ledger.events.filter(e=>e.type==='trade'&&e.symbol==='TECL'); const out=[];
  for(let i=0;i<ev.length;i++){ const e=ev[i]; if(e.side!=='sell') continue; const nb=ev.slice(i+1).find(x=>x.side==='buy'); if(!nb) continue; out.push({d:e.date,p:+e.price,v:e.qty*e.price,pb:+nb.price,db:nb.date,prem:nb.price/e.price-1}); }
  const up=out.filter(x=>x.prem>0), w=a=>a.reduce((s,x)=>s+x.v,0), wp=a=>a.reduce((s,x)=>s+x.v*x.prem,0)/Math.max(1,w(a));
  const med=a=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor((b.length-1)/2)]; };
  console.log(`${rules}: TECL 매도 ${out.length}건 — 다음 매수가 더 비쌈 ${up.length}건(${(up.length/out.length*100).toFixed(0)}% · 웃돈 중앙 +${(med(up.map(x=>x.prem))*100).toFixed(1)}%) · 더 쌈 ${out.length-up.length}건(중앙 ${(med(out.filter(x=>x.prem<=0).map(x=>x.prem))*100).toFixed(1)}%) · 금액 가중 평균 ${(wp(out)*100).toFixed(1)}% · 매도 금액 상위 5건: ${out.slice().sort((a,b)=>b.v-a.v).slice(0,5).map(x=>x.d+'→'+x.db+' '+(x.prem>=0?'+':'')+(x.prem*100).toFixed(0)+'%').join(' · ')}`); }
