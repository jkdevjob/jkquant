// '다시 사는 쪽' 후보 해마다 비교(11-12) — 실제 2011-04~ 한 번에(또는 env S·E) · 해마다 세전 시간가중 수익(입금 뺌) · 그해 끝 TECL 비중 · 공포 사건 날짜
// 사용: KEYS=panic,K3,K3a node re_years.js   env: P=25000 M=210 · DS=real|syn
const fs=require('fs'),path=require('path'); const {afterTax}=require('./aftertax');
const DD=path.join(__dirname,'..','data'), PD=path.join(__dirname,'data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const BASE={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const VARS={K3:{k:2.0,fbK:2.4},K3a:{k:2.5,fbK:3.0},k28:{k:2.8,fbK:3.36},k32:{k:3.2,fbK:3.84},K2a:{ma:30},ma40:{ma:40},lo30:{lo:30}};
const V={}; for(const k in VARS) V[k]=Object.assign({},BASE,{panic:Object.assign({},PAN,VARS[k])});
const E=require('./engine_var').load(V);
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const DS=process.env.DS||'real';
const X=DS==='real'?(()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div]}; })():{T:toRows(ser('SYNTECL')),Q:toRows(ser('SYNTQQQ')),G:toRows(ser('SYNBIL')),div:[[],[],[]]};
const KEYS=(process.env.KEYS||'panic,K3,K3a').split(','), P=+(process.env.P||25000), M=+(process.env.M||210);
const S=process.env.S||(DS==='real'?'2011-04-01':'2000-06-01'), Eend=process.env.E||'2026-11-10';
const out={};
for(const k of KEYS){ const R=E.replay({horizon:5,rules:k,startDate:S,endDate:Eend,principal:P,monthlyAdd:M,tecl:X.T,tqqq:X.Q,sgov:X.G,teclDiv:X.div[0],tqqqDiv:X.div[1],sgovDiv:X.div[2],vix:VIXr,vxn:VXNr});
  const at=afterTax(R); const yr={}; let prev=null;
  for(const n of R.nav){ const y=n.date.slice(0,4); if(!yr[y]) yr[y]={u:1,tw:[]}; if(prev){ const F=n.inflow-prev.inflow; yr[y].u*=(n.total-F)/prev.total; } yr[y].tw.push(n.tecl*n.teclPx/n.total); prev=n; }
  out[k]={yr,at,stats:R.stats,log:(R.panic&&R.panic.log)||[]}; }
const ys=Object.keys(out[KEYS[0]].yr);
console.log(`${DS} ${S}~${Eend} · ${P}$+월${M}$ · 해마다 세전 수익%(입금 뺌) · 괄호 = 그해 TECL 평균 비중%`);
console.log('해   '+KEYS.map(k=>k.padStart(16)).join(''));
for(const y of ys){ console.log(y+' '+KEYS.map(k=>{ const o=out[k].yr[y]; const tw=o.tw.reduce((a,b)=>a+b,0)/o.tw.length*100; return `${((o.u-1)*100).toFixed(1).padStart(8)}(${tw.toFixed(0).padStart(2)})`.padStart(16); }).join('')); }
for(const k of KEYS) console.log(`${k}: 세후 끝값 ${(out[k].at.final/1e3).toFixed(1)}k · 세후 연 ${((Math.pow(1+out[k].at.tr/100,1/out[k].stats.yrs)-1)*100).toFixed(1)} · MDD ${out[k].stats.mdd.toFixed(1)} · 세금 ${(out[k].at.tax/1e3).toFixed(1)}k`);
const evs=out[KEYS[0]].log.filter(e=>/sleeve|fast|armed|normal/.test(e.ev)).map(e=>`${e.signalDate} ${e.ev}${e.vix?'('+(+e.vix).toFixed(0)+')':''}`); console.log('사건(v1.1): '+evs.join(' · '));
