// 2026-01-02 ~ 11-06 · 원금 69,244$ · 월 69.24$ — 기본 vs 새 규칙 차이를 규칙 조각별로 나눈다(앱 엔진에 조각 규칙 벌을 끼워 넣음)
const fs=require('fs'),vm=require('vm'),path=require('path'); const D=__dirname;
let src=fs.readFileSync(path.join(D,'..','..','..','plan-session-engine.js'),'utf8');
const anchor="  exp2:{key:'exp2'"; if(!src.includes(anchor)) throw new Error('anchor');
src=src.replace(anchor,"  gOff:{key:'gOff',name:'Guard 끄기 −3% 만',guardOn:.01,guardOff:.03,bandDn:.10,bandUp:.10,tqReb:0,exp:true},\n  band:{key:'band',name:'TECL 비대칭 밴드만',guardOn:.01,guardOff:.01,bandDn:.01,bandUp:.15,tqReb:0,exp:true},\n  dnOnly:{key:'dnOnly',name:'줄일 때 1%p 만',guardOn:.01,guardOff:.01,bandDn:.01,bandUp:.10,tqReb:0,exp:true},\n  upOnly:{key:'upOnly',name:'늘릴 때 15%p 만',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.15,tqReb:0,exp:true},\n  reb:{key:'reb',name:'TQQQ 해마다 맞춤만',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:.02,exp:true},\n"+anchor);
const ctx={}; vm.runInNewContext(src,ctx); const E=ctx.JKPlanSessionEngine;
const q=s=>{ const j=JSON.parse(fs.readFileSync(path.join(D,'data',s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const T=q('TECL'),Q=q('TQQQ'),G=q('SGOV'); const START=process.env.START||'2026-01-02', END='2026-11-06', P=+(process.env.P||69244), M=+(process.env.M||69.24);
const run=rules=>E.replay({horizon:5,rules,startDate:START,endDate:END,principal:P,monthlyAdd:M,tecl:T.days,tqqq:Q.days,sgov:G.days,teclDiv:T.div,tqqqDiv:Q.div,sgovDiv:G.div});
const R={}; for(const k of ['base','gOff','band','dnOnly','upOnly','reb','exp1','exp2']) R[k]=run(k);
console.log(`${START}~${END} · 원금 ${P} · 월 ${M}`);
for(const [k,r] of Object.entries(R)){ const s=r.stats, tr=r.ledger.events.filter(e=>e.type==='trade'); const avgW=r.nav.reduce((a,x)=>a+x.tecl*x.teclPx/x.total,0)/r.nav.length*100, avgQ=r.nav.reduce((a,x)=>a+x.tqqq*x.tqqqPx/x.total,0)/r.nav.length*100;
  console.log(`  ${k.padEnd(7)} TR ${s.ret.toFixed(1).padStart(5)} · MDD ${s.mdd.toFixed(1)} · 거래 ${String(tr.length).padStart(3)} (TECL ${tr.filter(e=>e.symbol==='TECL').length} · TQQQ ${tr.filter(e=>e.symbol==='TQQQ').length}) · 평균 비중 TECL ${avgW.toFixed(1)}% TQQQ ${avgQ.toFixed(1)}% · 수수료 ${tr.reduce((a,e)=>a+(+e.fee||0),0).toFixed(0)}$`); }
// 달마다 가치 비(새/기본) · Guard 바뀐 날
const mon=k=>{ const o={}; for(const x of R[k].nav) o[x.date.slice(0,7)]=x; return o; }; const mb=mon('base'), me=mon('exp1'), mx=mon('exp2');
console.log('\n  달말 총자산 — 기본 · 새 · 공격형 · (새−기본) · 그 달 TECL 매매 횟수 기본/새');
for(const m of Object.keys(mb)){ const nb=R.base.ledger.events.filter(e=>e.type==='trade'&&e.symbol==='TECL'&&e.date.slice(0,7)===m).length, ne=R.exp1.ledger.events.filter(e=>e.type==='trade'&&e.symbol==='TECL'&&e.date.slice(0,7)===m).length;
  console.log(`    ${m} ${mb[m].total.toFixed(0).padStart(7)} ${me[m].total.toFixed(0).padStart(7)} ${mx[m].total.toFixed(0).padStart(7)} (${(me[m].total-mb[m].total>=0?'+':'')+(me[m].total-mb[m].total).toFixed(0)}) · ${nb}/${ne}`); }
const flips=k=>{ const out=[]; let prev=null; for(const x of R[k].nav){ const on=x.tqqq>0; if(prev!==null&&on!==prev) out.push(x.date+(on?' ON':' OFF')+' TQQQ '+x.tqqqPx.toFixed(2)); prev=on; } return out; };
console.log('\n  TQQQ 보유 켜짐/꺼짐 — 기본:', flips('base').join(' · '));
console.log('  TQQQ 보유 켜짐/꺼짐 — 새  :', flips('exp1').join(' · '));
