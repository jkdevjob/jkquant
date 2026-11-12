// 듀얼 가드 '다시 사는 쪽' 후보(11-12 · 사용자 "공포 모드 켜놨어, 다시 사는 쪽 연구 바로 해봐") — 기준 = 공포 모드 v1.1(사용자 실제 세션).
// 앱 엔진 replay 그대로(engine_var.js 의 panicStep 고리 bOff · cool · oneShot · ts · rel 만 — 안 주면 앱 그대로 · 688건 다름 0 확인).
// 견고성(지금 v1.1 값의 이웃 · 후보 아님): hi45 · lo30 · lo38 · ma40 · ma60 · b1 · b3 · k28 · k32
// 후보: K1 빠른 모드 끄는 선만 SMA50×0.96(이웃 .97 .94) · K2 빠른 선 SMA20(30) · K3 진정 뒤 TECL σ 상한 2.0×VXN(2.5) · K4 한 번만(쉬기 20 · 10 · 40거래일)
//       K5 기간구조 진정 VIX÷VIX3M < .95(.90 · 1.00) · K6 상대 진정 VIX ≤ .6×무장 뒤 최고(.5 · .7)
// 자료·창·세후는 dg_ovl.js 와 같다: 실제 = planrule/data(체결가·배당) · 합성 = SYNTECL·SYNTQQQ·SYNBIL(창마다 시작가 100) · 표본 밖 1990~99 = SYNTECLN·SYNTQQQ·SYNBIL_L(VXN 없음 → fbK×VIX).
// 사용: node reentry_eval.js [out.json]   env: DS=real,syn,oos · SETS='2.5만,1억,1만,10만' · ONLY='K1,K3'(이름 앞부분)
const fs=require('fs'),path=require('path'); const {afterTax}=require('./aftertax');
const DD=path.join(__dirname,'..','data'), PD=path.join(__dirname,'data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXm=ser('VIX'), VIX3M=ser('VIX3M'), VXNm=ser('VXN'); const VIXr=toRows(VIXm), VXNr=toRows(VXNm);
const TS={}; for(const d of Object.keys(VIXm)) if(VIX3M[d]>0) TS[d]=VIXm[d]/VIX3M[d];
function look(map){ const ks=Object.keys(map).sort(); return d=>{ if(d in map) return map[d]; let lo=0,hi=ks.length-1,a=-1; while(lo<=hi){ const md=(lo+hi)>>1; if(ks[md]<=d){ a=md; lo=md+1; } else hi=md-1; } return a>=0?map[ks[a]]:null; }; }
const tsAt=look(TS);
const BASE={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const VARS={ hi45:{hi:45}, lo30:{lo:30}, lo38:{lo:38}, ma40:{ma:40}, ma60:{ma:60}, b1:{band:.01}, b3:{band:.03}, k28:{k:2.8,fbK:3.36}, k32:{k:3.2,fbK:3.84},
  K1:{bOff:.04}, K1a:{bOff:.03}, K1b:{bOff:.06}, K2:{ma:20}, K2a:{ma:30}, K3:{k:2.0,fbK:2.4}, K3a:{k:2.5,fbK:3.0},
  K4:{oneShot:true}, K4c:{cool:20}, K4c10:{cool:10}, K4c40:{cool:40}, K5:{ts:.95}, K5a:{ts:.90}, K5b:{ts:1.00}, K6:{rel:.6}, K6a:{rel:.5}, K6b:{rel:.7} };
const ONLY=process.env.ONLY?process.env.ONLY.split(','):null;
const NAMES=Object.keys(VARS).filter(k=>!ONLY||ONLY.some(o=>k.startsWith(o)));
const V={}; for(const k of NAMES) V[k]=Object.assign({},BASE,{panic:Object.assign({},PAN,VARS[k])},k.startsWith('K5')?{tsAt}:{});
const E=require('./engine_var').load(V);
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
const DS=(process.env.DS||'real,syn,oos').split(','), OUT=process.argv[2]||'reentry_out.json';
const CFG={'2.5만':[25000,210],'1억':[69244,69.24],'1만':[10000,0],'10만':[100000,0]};
const SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const SRC={ real:()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',rescale:false,half:'2016-04-01'}; },
  syn:()=>({T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',rescale:true,half:'2011-01-01'}),
  oos:()=>({T:srows('SYNTECLN'),Q:srows('SYNTQQQ'),G:srows('SYNBIL_L'),div:[[],[],[]],s0:'1990-06-01',rescale:true,half:'1995-01-01',until:'1999-12-01'}) };
const res={meta:{made:new Date().toISOString(),vars:VARS,names:NAMES}};
for(const ds of DS){ const S=SRC[ds](); const LAST=S.T[S.T.length-1].date; res[ds]={};
  const keys=['base','panic'].concat(NAMES);
  for(const key of SETS){ const [P,M]=CFG[key]; const rows=[]; const t0=Date.now();
    for(let s=S.s0; addM(s,60)<=LAST&&(!S.until||s<=S.until); s=addM(s,1)){ const e=addM(s,60);
      const T=S.rescale?cut(S.T,s,e):S.T, Q=S.rescale?cut(S.Q,s,e):S.Q, G=S.rescale?cut(S.G,s,e):S.G; if(!T||!Q||!G) continue;
      const r={s}; let ok=true;
      for(const k of keys){ const R=E.replay({horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T,tqqq:Q,sgov:G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix:VIXr,vxn:VXNr});
        if(!R.stats){ ok=false; break; } const at=afterTax(R), tr=R.ledger.events.filter(x=>x.type==='trade');
        r[k]={a:(Math.pow(Math.max(1e-9,1+at.tr/100),1/R.stats.yrs)-1)*100,m:R.stats.mdd,nq:tr.filter(x=>x.symbol==='TQQQ').length/R.stats.yrs,nt:tr.filter(x=>x.symbol==='TECL').length/R.stats.yrs,fv:at.final}; }
      if(ok) rows.push(r); }
    res[ds][key]=rows;
    const line=(k,ref)=>{ const d=rows.map(r=>r[k].a-r[ref].a), dm=rows.map(r=>r[k].m-r[ref].m), h1=rows.filter(r=>r.s<S.half).map(r=>r[k].a-r[ref].a), h2=rows.filter(r=>r.s>=S.half).map(r=>r[k].a-r[ref].a);
      const both=rows.filter(r=>r[k].a>r[ref].a&&r[k].m<=r[ref].m).length, worse=rows.filter(r=>r[k].a<r[ref].a&&r[k].m>r[ref].m).length, same=rows.filter(r=>Math.abs(r[k].fv-r[ref].fv)<1e-6).length;
      const wM=Math.max(...rows.map(r=>r[k].m))-Math.max(...rows.map(r=>r[ref].m));
      return `${k.padEnd(6)} 연 차 중앙 ${f(qq(d,.5))} · 평균 ${f(d.reduce((a,b)=>a+b,0)/d.length)} · 낮은 창 ${(d.filter(x=>x<0).length/rows.length*100).toFixed(0)}% · 같은 창 ${same} · 둘다 나음:나쁨 ${both}:${worse} · 앞/뒤 ${f(h1.length?qq(h1,.5):0)}/${f(h2.length?qq(h2,.5):0)} · MDD 차 중앙 ${f(qq(dm,.5),1)} · 최악 MDD 차 ${f(wM,1)} · TQQQ ${qq(rows.map(r=>r[k].nq),.5).toFixed(1)} · TECL ${qq(rows.map(r=>r[k].nt),.5).toFixed(0)}회/년`; };
    const st=k=>`세후 연 중앙 ${qq(rows.map(r=>r[k].a),.5).toFixed(1)} · 최악 ${Math.min(...rows.map(r=>r[k].a)).toFixed(1)} · MDD 중앙 ${qq(rows.map(r=>r[k].m),.5).toFixed(1)} · 최악 ${Math.max(...rows.map(r=>r[k].m)).toFixed(1)}`;
    console.log(`\n■ ${ds} ${key} · 5년 창 ${rows.length} · v1.0 ${st('base')} | v1.1 ${st('panic')} · ${((Date.now()-t0)/1000).toFixed(0)}초`);
    for(const k of NAMES) console.log('  '+line(k,'panic')); }
  fs.writeFileSync(OUT,JSON.stringify(res)); }
console.error('→ '+OUT);
