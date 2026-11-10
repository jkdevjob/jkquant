// 해마다 차이(세전 · 1e6 원금으로 정수 주 왜곡 없앰) — 어느 해·사건이 차이를 만드는지 · VARS 의 키는 base/panic 계열 둘 다
const fs=require('fs'),path=require('path'); const D=__dirname,R=path.join(D,'..','data');
const PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6}, BASEV={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10};
const VB=JSON.parse(process.env.VARS||'{"A3h":{"guardOn":0.005,"guardOff":0.03},"A3":{"guardOff":0.03}}'); const V={}; for(const [k,v] of Object.entries(VB)){ V[k]=Object.assign({},BASEV,v); V['P'+k]=Object.assign({},BASEV,v,{panic:PAN,version:'1.1'}); }
const E=require('./engine_var').load(V); const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const ix=s=>rd(path.join(R,s+'.json')).series.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close}));
const VIX=ix('VIX'),VXN=ix('VXN'); const X={T:q(path.join(D,'data','TECL.json')),Q:q(path.join(D,'data','TQQQ.json')),G:q(path.join(D,'data','SGOV.json'))};
const run=k=>E.replay({horizon:5,rules:k,startDate:process.env.FROM||'2011-04-01',endDate:'',principal:1e6,monthlyAdd:0,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix:VIX,vxn:VXN});
const yr=R2=>{ const o={}; let prev=null; for(const n of R2.nav){ const y=n.date.slice(0,4); if(!o[y]) o[y]={a:prev??n.total}; o[y].b=n.total; prev=n.total; } const r={}; for(const y in o) r[y]=(o[y].b/o[y].a-1)*100; return r; };
const tq=R2=>R2.ledger.events.filter(e=>e.type==='trade'&&e.symbol==='TQQQ').map(e=>e.date.slice(2)+(e.side==='buy'?'↑':'↓'));
for(const [b,ks] of [['base',Object.keys(VB)],['panic',Object.keys(VB).map(k=>'P'+k)]]){ const B=run(b), yb=yr(B);
  for(const k of ks){ const K=run(k), yk=yr(K); const tb=new Set(tq(B)), tk=new Set(tq(K));
    console.log(`\n■ ${k} − ${b} 해마다(세전 %p): `+Object.keys(yb).map(y=>`${y} ${(yk[y]-yb[y]>=0?'+':'')+(yk[y]-yb[y]).toFixed(1)}`).join(' · '));
    console.log(`  TQQQ 주문 — ${b} 에만: ${[...tb].filter(x=>!tk.has(x)).join(' ')}\n  ${k} 에만: ${[...tk].filter(x=>!tb.has(x)).join(' ')}`); } }
