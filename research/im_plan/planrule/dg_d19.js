// 듀얼 가드 11-19 후보(06:52 · dg_d18.js 틀) — H 계절 크기(11~4월 .60 · 5~10월 .50) · L 금리 수준(s0 = .57 − 0.01×IRX%) · I 기대 인플레 T10YIE(≥ 2.5 → .50 · ≤ 1.75 → .60)
// 듀얼 가드 11-18 후보(06:52 · dg_d17.js 틀) — C 소비자 심리 UMCSENT(≤ 60 → s0 .60) · O 유가 급등 WTI 126일 ≥ +50%(→ .50) · J 실질금리 급등 DFII10 63일 ≥ +0.5%p(→ .50)
// 듀얼 가드 11-17 후보(06:52 · dg_d16.js 틀) — F 금융 여건 NFCI(느슨 → s0 .60) · V 변동성 위험 프리미엄(VIX − S&P500 20일 실현변동성 → .60) · M 통화량 M2 전년비(≥ 8% → .60)
// (아래 줄은 dg_d16 머리말 그대로) 듀얼 가드 11-16 후보(밀린 06:52 · dg_d14.js 틀)
// (아래 줄은 dg_d14 머리말 그대로) 듀얼 가드 11-14 후보(06:52 회차 · 새 정보원 셋) — 앱 엔진 replay 그대로(engine_var.js 고리: s0 날짜 함수 · gOvl 만) · v1.1(panic) 위 · v1.0(base) 참고.
// R 금리 변화 속도(^IRX 126 거래일 변화 → TECL σ 목표 s0 .60/.45) · S 반도체 선행(^SOX 200일선 이력 상태 + TQQQ > 50일선 → Guard 일찍 ON) · U 달러(DX-Y.NYB 126 거래일 변화율 → s0)
// 모든 바깥 정보는 신호일(전일) 확정 값 — 엔진이 S.dates[p](p = 오늘 − 1)로 부른다. 그날 값이 없으면 그 전 거래일 값.
// 자료: 실제 = planrule/data(체결가 · 배당) · 합성 = SYNTECL·SYNTQQQ·SYNBIL(창마다 시작가 100) · 표본 밖 1990~99 = SYNTECLN·SYNTQQQ·SYNBIL_L.
// 검산: p_chk(s0 → null · gOvl → null) 는 p_none(앱 v1.1)과 모든 창에서 같아야 한다.
// 사용: node dg_d14.js [out.json]   env: DS=real,syn,oos · SETS='2.5만,1억,1만,10만'
const fs=require('fs'),path=require('path'); const {afterTax}=require('./aftertax');
const DD=path.join(__dirname,'..','data'), PD=path.join(__dirname,'data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0||(s==='IRX'&&x.close!=null)) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
// 그 날짜 이하 마지막 자료의 인덱스
function idxOf(ks){ return d=>{ let lo=0,hi=ks.length-1,a=-1; while(lo<=hi){ const md=(lo+hi)>>1; if(ks[md]<=d){ a=md; lo=md+1; } else hi=md-1; } return a; }; }
// 126 거래일 변화(금리: 차 %p · 달러: 변화율 %)
function chg(map,n,rel,lag=0){ const ks=Object.keys(map).sort(), ix=idxOf(ks); return d=>{ const k=ix(d)-lag; if(k<n) return null; const a=map[ks[k]], b=map[ks[k-n]]; if(a==null||b==null) return null; return rel?(a/b-1)*100:a-b; }; }   // lag(11-14 위약): 그만큼 거래일 앞선 값
function upMap(rows,n=50){ const o={}; let s=0; const q=[]; for(const r of rows){ q.push(r.close); s+=r.close; if(q.length>n) s-=q.shift(); if(q.length===n) o[r.date]=r.close>s/n; } const kk=Object.keys(o).sort(), ix=idxOf(kk); return d=>{ const k=ix(d); return k<0?null:o[kk[k]]; }; }
let TQUP=()=>null;
// FRED CSV(observation_date,값) → {date:값}
const csv=f=>{ const o={}; fs.readFileSync(path.join(DD,f+'.csv'),'utf8').trim().split('\n').slice(1).forEach(l=>{ const [d,v]=l.split(','); if(v!==''&&v!=='.'&&!isNaN(+v)) o[d]=+v; }); return o; };
const NF=csv('NFCI'), M2=csv('M2SL');
const UM=csv('UMCSENT'), OIL=csv('DCOILWTICO'), RY=csv('DFII10');
const BE=csv('T10YIE'); const IRXm=(()=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,'IRX.json'))).series.forEach(x=>{ if(x.close!=null&&isFinite(+x.close)) m[x.date]=+x.close; }); return m; })();
// 신호일 이하 마지막 관측값(lag 관측일 늦춘 위약)
function lastV(map,lag=0){ const ks=Object.keys(map).sort(), ix=idxOf(ks); return d=>{ const k=ix(d)-lag; return k<0?null:map[ks[k]]; }; }
// 달력: 신호일의 달이 set 안이면 hi · 아니면 lo
const seas=(months,hi,lo)=>d=>months.includes(+d.slice(5,7))?hi:lo;
const clip=(x,a,b)=>Math.max(a,Math.min(b,x));
const lev=(a,b)=>{ const g=lastV(IRXm); return d=>{ const r=g(d); return r==null?null:clip(a-b*r,.50,.60); }; };
const levR=()=>{ const g=lastV(IRXm); return d=>{ const r=g(d); return r==null?null:clip(.53+0.01*r,.50,.60); }; };
const be2=(hiT,loT,hiOn=true,loOn=true,lag=0)=>{ const g=lastV(BE,lag); return d=>{ const x=g(d); if(x==null) return null; if(hiOn&&x>=hiT) return .50; if(loOn&&x<=loT) return .60; return null; }; };
// UMCSENT: 신호일이 속한 달의 직전 달 값(없으면 그 전 최신) · lagM 달 더 늦춘 위약
function umcF(lagM=0){ const ks=Object.keys(UM).sort(), ix=idxOf(ks); return d=>{ const y=+d.slice(0,4), m=+d.slice(5,7)-1-1-lagM; const t=y*12+m, key=Math.floor(t/12)+'-'+String(t%12+1).padStart(2,'0')+'-01'; const k=ix(key); return k<0?null:UM[ks[k]]; }; }
// 일 자료 n 관측일 변화(rel: % · 아니면 차) — 신호일 이하 마지막 관측일 기준 · lag 관측일 늦춘 위약 · 기준값 ≤ 0 이면 없음(rel)
function dchg(map,n,rel,lag=0){ const ks=Object.keys(map).sort(), ix=idxOf(ks); return d=>{ const k=ix(d)-lag; if(k<n) return null; const a=map[ks[k]], b=map[ks[k-n]]; if(a==null||b==null) return null; if(rel){ if(!(b>0)) return null; return (a/b-1)*100; } return a-b; }; }
// NFCI: 신호일보다 6일 이상 앞선 주(금요일) 값 · lagW 주 더 늦춘 위약
function nfciF(lagW=0){ const ks=Object.keys(NF).sort(), ix=idxOf(ks); return d=>{ const t=new Date(Date.parse(d)-6*864e5).toISOString().slice(0,10); const k=ix(t)-lagW; return k<0?null:NF[ks[k]]; }; }
// M2 전년 대비 %: 그달 판단엔 두 달 전 달 값(발표 지연) · lagM 달 더 늦춘 위약
function m2F(lagM=0){ return d=>{ const y=+d.slice(0,4), m=+d.slice(5,7)-1-2-lagM; const key=(yy,mm)=>{ const t=yy*12+mm; return Math.floor(t/12)+'-'+String(t%12+1).padStart(2,'0')+'-01'; }; const a=M2[key(y,m)], b=M2[key(y-1,m)]; return (a>0&&b>0)?(a/b-1)*100:null; }; }
// VRP = VIX − S&P500 20일 실현변동성(%) · 신호일 값 · lag 거래일 늦춘 위약
const GS=ser('GSPC'), VIXm=ser('VIX');
function vrpF(lag=0){ const ks=Object.keys(GS).filter(d=>VIXm[d]!=null).sort(), ix=idxOf(ks), gk=Object.keys(GS).sort(), gi={}; gk.forEach((d,k)=>gi[d]=k);
  const rv=d=>{ const k=gi[d]; if(k==null||k<21) return null; let s=0,s2=0; for(let j=k-19;j<=k;j++){ const r=Math.log(GS[gk[j]]/GS[gk[j-1]]); s+=r; s2+=r*r; } const m=s/20; return Math.sqrt(Math.max(0,(s2/20-m*m))*252)*100; };
  return d=>{ const k=ix(d)-lag; if(k<0) return null; const dd=ks[k], v=rv(dd); return v==null?null:VIXm[dd]-v; }; }
const sUp=(g,th,s0v)=>d=>{ const x=g(d); return x==null?null:(x>=th?s0v:null); };
const sDn=(g,th,s0v)=>d=>{ const x=g(d); return x==null?null:(x<=th?s0v:null); };
const BASE={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const W6=[11,12,1,2,3,4], W6c=[10,11,12,1,2,3], W6d=[12,1,2,3,4,5], W6p=[2,3,4,5,6,7];
const CANDS={ none:{}, chk:{s0:()=>null,gOvl:()=>null,decHold:()=>false},
  H1:{s0:seas(W6,.60,.50)}, H1a:{s0:seas(W6,.58,.52)}, H1b:{s0:seas(W6,.62,.48)}, H1c:{s0:seas(W6c,.60,.50)}, H1d:{s0:seas(W6d,.60,.50)}, H1P:{s0:seas(W6p,.60,.50)},
  L1:{s0:lev(.57,.01)}, L1a:{s0:lev(.565,.005)}, L1b:{s0:lev(.58,.015)}, L1c:{s0:lev(.58,.01)}, L1R:{s0:levR()},
  I1:{s0:be2(2.5,1.75)}, I1a:{s0:be2(2.4,1.85)}, I1b:{s0:be2(2.6,1.65)}, I1c:{s0:be2(2.5,1.75,true,false)}, I1d:{s0:be2(2.5,1.75,false,true)}, I1L:{s0:be2(2.5,1.75,true,true,252)} };
const MAIN=['H1','L1','I1'];
const V={}; for(const [c,x] of Object.entries(CANDS)){ V['p_'+c]=Object.assign({},BASE,{panic:PAN},x); if(MAIN.includes(c)) V['b_'+c]=Object.assign({},BASE,x); }
const E=require('./engine_var').load(V);
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
const DS=(process.env.DS||'real,syn,oos').split(','), OUT=process.argv[2]||'dg_d19_out.json';
const CFG={'2.5만':[25000,210],'1억':[69244,69.24],'1만':[10000,0],'10만':[100000,0]};
const SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const SRC={ real:()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',rescale:false,half:'2016-04-01'}; },
  syn:()=>({T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',rescale:true,half:'2011-01-01'}),
  oos:()=>({T:srows('SYNTECLN'),Q:srows('SYNTQQQ'),G:srows('SYNBIL_L'),div:[[],[],[]],s0:'1990-06-01',rescale:true,half:'1995-01-01',until:'1999-12-01'}) };
const res={meta:{made:new Date().toISOString(),cands:Object.keys(CANDS)}};
for(const ds of DS){ const S=SRC[ds](); const LAST=S.T[S.T.length-1].date; res[ds]={}; TQUP=upMap(S.Q,50); 
  const keys=['p_none','p_chk'].concat(Object.keys(CANDS).filter(c=>c!=='none'&&c!=='chk').flatMap(c=>MAIN.includes(c)?['p_'+c,'b_'+c]:['p_'+c]));
  for(const key of SETS){ const [P,M]=CFG[key]; const rows=[]; const t0=Date.now();
    for(let s=S.s0; addM(s,60)<=LAST&&(!S.until||s<=S.until); s=addM(s,1)){ const e=addM(s,60);
      const T=S.rescale?cut(S.T,s,e):S.T, Q=S.rescale?cut(S.Q,s,e):S.Q, G=S.rescale?cut(S.G,s,e):S.G; if(!T||!Q||!G) continue;
      const r={s}; let ok=true;
      for(const k of ['base','panic'].concat(keys)){ const R=E.replay({horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T,tqqq:Q,sgov:G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix:VIXr,vxn:VXNr});
        if(!R.stats){ ok=false; break; } const at=afterTax(R), tr=R.ledger.events.filter(x=>x.type==='trade');
        r[k]={a:(Math.pow(Math.max(1e-9,1+at.tr/100),1/R.stats.yrs)-1)*100,m:R.stats.mdd,fv:at.final,nq:tr.filter(x=>x.symbol==='TQQQ').length/R.stats.yrs,nt:tr.filter(x=>x.symbol==='TECL').length/R.stats.yrs}; }
      if(ok) rows.push(r); }
    res[ds][key]=rows;
    const chk=rows.filter(r=>Math.abs(r.p_chk.fv-r.panic.fv)>1e-6||Math.abs(r.p_none.fv-r.panic.fv)>1e-6).length;
    const line=(k,ref)=>{ const d=rows.map(r=>r[k].a-r[ref].a), dm=rows.map(r=>r[k].m-r[ref].m), h1=rows.filter(r=>r.s<S.half).map(r=>r[k].a-r[ref].a), h2=rows.filter(r=>r.s>=S.half).map(r=>r[k].a-r[ref].a);
      const both=rows.filter(r=>r[k].a>r[ref].a&&r[k].m<=r[ref].m).length, worse=rows.filter(r=>r[k].a<r[ref].a&&r[k].m>r[ref].m).length, same=rows.filter(r=>Math.abs(r[k].fv-r[ref].fv)<1e-6).length;
      const wM=Math.max(...rows.map(r=>r[k].m))-Math.max(...rows.map(r=>r[ref].m));
      return `${k.padEnd(7)} 연 차 중앙 ${f(qq(d,.5))} · 평균 ${f(d.reduce((a,b)=>a+b,0)/d.length)} · 낮은 창 ${(d.filter(x=>x<0).length/rows.length*100).toFixed(0)}% · 같은 창 ${same} · 둘다 나음:나쁨 ${both}:${worse} · 앞/뒤 ${f(h1.length?qq(h1,.5):0)}/${f(h2.length?qq(h2,.5):0)} · MDD 차 중앙 ${f(qq(dm,.5),1)} · 최악 MDD 차 ${f(wM,1)} · TQQQ ${qq(rows.map(r=>r[k].nq),.5).toFixed(1)} · TECL ${qq(rows.map(r=>r[k].nt),.5).toFixed(1)}회/년`; };
    const st=k=>`세후 연 중앙 ${qq(rows.map(r=>r[k].a),.5).toFixed(1)} · 최악 ${Math.min(...rows.map(r=>r[k].a)).toFixed(1)} · MDD 중앙 ${qq(rows.map(r=>r[k].m),.5).toFixed(1)} · 최악 ${Math.max(...rows.map(r=>r[k].m)).toFixed(1)}`;
    console.log(`\n■ ${ds} ${key} · 5년 창 ${rows.length} · v1.0 ${st('base')} | v1.1 ${st('panic')} · 검산(p_chk·p_none ≠ 앱 v1.1) ${chk}창 · ${((Date.now()-t0)/1000).toFixed(0)}초`);
    for(const k of keys.filter(k=>k!=='p_none'&&k!=='p_chk')) console.log('  '+line(k,k.startsWith('p_')?'panic':'base')); }
  fs.writeFileSync(OUT,JSON.stringify(res)); }
console.error('→ '+OUT);
