// 사용자 모의(자산플랜 5년 · 월 69.24$) 재현 — 앱 엔진 그대로(main plan-session-engine.js) · 체결가(ohlcTrade) + 배당 이벤트
const fs=require('fs'),vm=require('vm'),path=require('path'); const D=__dirname;
const ctx={}; vm.runInNewContext(fs.readFileSync(path.join(D,'..','..','..','plan-session-engine.js'),'utf8'),ctx); const E=ctx.JKPlanSessionEngine;
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const END='2026-11-06';
const run=(rules,start,principal,monthly)=>E.replay({horizon:5,rules,startDate:start,endDate:END,principal,monthlyAdd:monthly,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
const target={base:{ret:13.3,mdd:34.2},exp1:{ret:10.1,mdd:34.1},exp2:{ret:14.5,mdd:35.9}};
const days=T.days.map(x=>x.date).filter(d=>d>='2025-06-01'&&d<='2026-04-30');
const res=[]; for(const p of [69244,20000,10000]) for(const d of days){ let err=0; const o={}; for(const k of ['base','exp1','exp2']){ const R=run(k,d,p,69.24); const s=R.stats; if(!s){ err=1e9; break; } o[k]=s; err+=(s.ret-target[k].ret)**2+(s.mdd-target[k].mdd)**2; } res.push({p,d,err,o}); }
res.sort((a,b)=>a.err-b.err);
for(const x of res.slice(0,8)) console.log(x.p, x.d, 'err', x.err.toFixed(2), Object.entries(x.o).map(([k,s])=>`${k} TR ${s.ret.toFixed(1)} MDD ${s.mdd.toFixed(1)} CAGR ${s.cagr.toFixed(1)} 거래 ${s.nTrade}`).join(' | '));
