// 듀얼 가드 11-14 후보(06:52 회차 · 새 정보원 셋) — 앱 엔진 replay 그대로(engine_var.js 고리: s0 날짜 함수 · gOvl 만) · v1.1(panic) 위 · v1.0(base) 참고.
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
const IRX=ser('IRX'), DXY=ser('DXYNYB'), SOX=ser('SOX');
const irxD=chg(IRX,126,false), dxyD=chg(DXY,126,true);
// SOX 이력 상태: > SMA(n)×(1+b) 로 켜지고 < ×(1−b) 로 꺼짐
function soxState(n,b){ const ks=Object.keys(SOX).sort(), o={}; let s=0,on=null; const q=[]; for(const d of ks){ const x=SOX[d]; q.push(x); s+=x; if(q.length>n) s-=q.shift(); if(q.length===n){ const m=s/n; if(on==null) on=x>m; else if(!on&&x>m*(1+b)) on=true; else if(on&&x<m*(1-b)) on=false; o[d]=on; } } const ix=idxOf(Object.keys(o).sort()), kk=Object.keys(o).sort(); return d=>{ const k=ix(d); return k<0?null:o[kk[k]]; }; }
// TQQQ > 50일선(자료마다 · 비율이라 창마다 100 맞춤과 무관)
function upMap(rows,n=50){ const o={}; let s=0; const q=[]; for(const r of rows){ q.push(r.close); s+=r.close; if(q.length>n) s-=q.shift(); if(q.length===n) o[r.date]=r.close>s/n; } const kk=Object.keys(o).sort(), ix=idxOf(kk); return d=>{ const k=ix(d); return k<0?null:o[kk[k]]; }; }
let TQUP=()=>null;   // 자료마다 바꿔 끼움
const BASE={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const sR=(lo,hi)=>d=>{ const x=irxD(d); if(x==null) return null; return x<=lo?.60:x>=hi?.45:null; };
const sU=(up,dn)=>d=>{ const x=dxyD(d); if(x==null) return null; return x>=up?.45:x<=dn?.60:null; };
const gS=(n,b)=>{ const st=soxState(n,b); return (d,g)=>(g==='OFF'&&st(d)===true&&TQUP(d)===true)?'ON':null; };
const CANDS={ none:{}, chk:{s0:()=>null,gOvl:()=>null},
  R1:{s0:sR(-.5,Infinity)}, R2:{s0:sR(-Infinity,1.0)}, R3:{s0:sR(-.5,1.0)}, R3a:{s0:sR(-.25,.75)}, R3b:{s0:sR(-1.0,1.5)},
  S1:{gOvl:gS(200,.02)}, S1a:{gOvl:gS(200,0)}, S1b:{gOvl:gS(200,.05)}, S1c:{gOvl:gS(150,.02)},
  U1:{s0:sU(5,-3)}, U1a:{s0:sU(4,-2)}, U1b:{s0:sU(6,-4)}, U2:{s0:sU(5,-Infinity)}, U3:{s0:sU(Infinity,-3)} };
// PHASE=2(11-14 · 결과 본 뒤의 견고성 검사 · 선택용 아님): U3 의 이웃(문턱 −2 · −4% · s0 .58 · .62 · 보는 기간 63 · 252 거래일)과 시점 위약(같은 신호를 126 · 252 거래일 늦게)
const sU3=(dn,s0v,n=126,lag=0)=>{ const g=chg(DXY,n,true,lag); return d=>{ const x=g(d); return x==null?null:(x<=dn?s0v:null); }; };
if(process.env.PHASE==='2'){ for(const k of Object.keys(CANDS)) if(k!=='none'&&k!=='chk') delete CANDS[k];
  Object.assign(CANDS,{ U3:{s0:sU3(-3,.60)}, U3a:{s0:sU3(-2,.60)}, U3b:{s0:sU3(-4,.60)}, U3c:{s0:sU3(-3,.58)}, U3d:{s0:sU3(-3,.62)}, U3e:{s0:sU3(-3,.60,63)}, U3f:{s0:sU3(-3,.60,252)},
    U3s1:{s0:sU3(-3,.60,126,126)}, U3s2:{s0:sU3(-3,.60,126,252)} }); }
const MAIN=process.env.PHASE==='2'?['U3']:['R3','S1','U1'];
const V={}; for(const [c,x] of Object.entries(CANDS)){ V['p_'+c]=Object.assign({},BASE,{panic:PAN},x); if(MAIN.includes(c)) V['b_'+c]=Object.assign({},BASE,x); }
const E=require('./engine_var').load(V);
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
const DS=(process.env.DS||'real,syn,oos').split(','), OUT=process.argv[2]||'dg_d14_out.json';
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
