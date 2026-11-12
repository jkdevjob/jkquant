// 듀얼 가드 'SPY 밴드' 후보(11-12 추가 회차 4 · 시중 매매법 2차에서 나온 정보) — 앱 엔진 replay 그대로(engine_var.js 의 gOvl·wMul 고리만) · v1.0(base) · v1.1(panic) 위.
// 후보: G1 TQQQ Guard = SPY 총수익 200일선 +4% ON / −3% OFF(덮어쓰기) · 이웃 +3/−2 · +5/−4 | G2 = G1 + SPY OFF 동안 TECL × 0(이웃 × 0.5) | G3 = TECL 만 SPY OFF 동안 × 0. 신호는 전일 확정(엔진이 S.dates[p] 로 묻는다).
// 자료: 실제 = planrule/data(체결가 · 배당) · 합성 = data/SYNTECL·SYNTQQQ·SYNBIL(단기국채 대용 · 창마다 시작가 100 으로 맞춰 정수 주 왜곡 줄임) · 표본 밖 1987~99 = SYNTECLN·SYNTQQQ·SYNBIL_L.
// 사용: node dg_spy.js [out.json]   env: DS=real,syn,oos · SETS='2.5만,1억,1만,10만'
const fs=require('fs'),path=require('path'); const {afterTax}=require('./aftertax');
const DD=path.join(__dirname,'..','data'), PD=path.join(__dirname,'data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXm=ser('VIX'), VXNm=ser('VXN');
const VIXr=toRows(VIXm), VXNr=toRows(VXNm);
// SPY 총수익(배당 조정 · 1993-01~) · 그 전은 ^GSPC 가격을 이어 붙임(비율만 쓰므로 수준은 상관없음)
const SPYm=ser('SPY'), GSm=ser('GSPC'); const s0=Object.keys(SPYm).sort()[0]; const kS=SPYm[s0]/GSm[s0];
const TR={}; for(const d of Object.keys(GSm)) if(d<s0) TR[d]=GSm[d]*kS; for(const d of Object.keys(SPYm)) TR[d]=SPYm[d];
const CAL=Object.keys(TR).sort();
function stSPY(up,dn,n=200){ const o={}, q=[]; let s=0, on=null; for(const d of CAL){ const x=TR[d]; q.push(x); s+=x; if(q.length>n) s-=q.shift();
    if(q.length===n){ const ma=s/n; if(on==null) on=x>ma; else if(!on&&x>ma*(1+up)) on=true; else if(on&&x<ma*(1-dn)) on=false; o[d]=on?'ON':'OFF'; } } return o; }
// 엔진의 날짜가 달력에 없으면 그 전 거래일 값
function look(map){ const ks=Object.keys(map).sort(); return d=>{ if(d in map) return map[d]; let lo=0,hi=ks.length-1,a=-1; while(lo<=hi){ const md=(lo+hi)>>1; if(ks[md]<=d){ a=md; lo=md+1; } else hi=md-1; } return a>=0?map[ks[a]]:null; }; }
const BASE={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10}, PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const SIG={m:stSPY(.04,.03), a:stSPY(.03,.02), b:stSPY(.05,.04)};
const CANDS={ none:{}, G1:{g:SIG.m}, G1a:{g:SIG.a}, G1b:{g:SIG.b}, G2:{g:SIG.m,w:[SIG.m,0]}, G2h:{g:SIG.m,w:[SIG.m,.5]}, G3:{w:[SIG.m,0]} };
const V={}; for(const [c,x] of Object.entries(CANDS)){ const add={}; if(x.g){ const f=look(x.g); add.gOvl=(d,g)=>f(d); } if(x.w){ const f=look(x.w[0]), m=x.w[1]; add.wMul=d=>f(d)==='OFF'?m:1; }
  V['b_'+c]=Object.assign({},BASE,add); V['p_'+c]=Object.assign({},BASE,{panic:PAN},add); }
const E=require('./engine_var').load(V);
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
const DS=(process.env.DS||'real,syn,oos').split(','), OUT=process.argv[2]||'dg_spy_out.json';
const CFG={'2.5만':[25000,210],'1억':[69244,69.24],'1만':[10000,0],'10만':[100000,0]};
const SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=2)=>(x>=0?'+':'')+x.toFixed(d);
// 창마다 시작가 100 으로(합성 · 표본 밖) — 앞 330 거래일(지표 준비)부터 끝날까지
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const SRC={ real:()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',rescale:false,half:'2016-04-01'}; },
  syn:()=>({T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',rescale:true,half:'2011-01-01'}),
  oos:()=>({T:srows('SYNTECLN'),Q:srows('SYNTQQQ'),G:srows('SYNBIL_L'),div:[[],[],[]],s0:'1990-06-01',rescale:true,half:'1995-01-01',until:'1999-12-01'}) };
const res={meta:{made:new Date().toISOString(),cands:Object.keys(CANDS)}};
for(const ds of DS){ const S=SRC[ds](); const LAST=S.T[S.T.length-1].date; res[ds]={};
  const keys=['b_none','p_none'].concat(Object.keys(CANDS).filter(c=>c!=='none'&&(!S.only||S.only.includes(c))).flatMap(c=>['b_'+c,'p_'+c]));
  for(const key of SETS){ const [P,M]=CFG[key]; const rows=[];
    for(let s=S.s0; addM(s,60)<=LAST&&(!S.until||s<=S.until); s=addM(s,1)){ const e=addM(s,60);
      const T=S.rescale?cut(S.T,s,e):S.T, Q=S.rescale?cut(S.Q,s,e):S.Q, G=S.rescale?cut(S.G,s,e):S.G; if(!T||!Q||!G) continue;
      const r={s}; let ok=true;
      for(const k of ['base','panic'].concat(keys)){ const R=E.replay({horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T,tqqq:Q,sgov:G,teclDiv:S.div[0],tqqqDiv:S.div[1],sgovDiv:S.div[2],vix:VIXr,vxn:VXNr});
        if(!R.stats){ ok=false; break; } const at=afterTax(R), tr=R.ledger.events.filter(x=>x.type==='trade');
        r[k]={a:(Math.pow(Math.max(1e-9,1+at.tr/100),1/R.stats.yrs)-1)*100,m:R.stats.mdd,nq:tr.filter(x=>x.symbol==='TQQQ').length/R.stats.yrs,nt:tr.filter(x=>x.symbol==='TECL').length/R.stats.yrs}; }
      if(ok) rows.push(r); }
    res[ds][key]=rows;
    const line=(k,ref)=>{ const d=rows.map(r=>r[k].a-r[ref].a), dm=rows.map(r=>r[k].m-r[ref].m), h1=rows.filter(r=>r.s<S.half).map(r=>r[k].a-r[ref].a), h2=rows.filter(r=>r.s>=S.half).map(r=>r[k].a-r[ref].a);
      const both=rows.filter(r=>r[k].a>r[ref].a&&r[k].m<=r[ref].m).length, worse=rows.filter(r=>r[k].a<r[ref].a&&r[k].m>r[ref].m).length;
      const wM=Math.max(...rows.map(r=>r[k].m))-Math.max(...rows.map(r=>r[ref].m));
      return `${k.padEnd(10)} 연 차 중앙 ${f(qq(d,.5))} · 낮은 창 ${(d.filter(x=>x<0).length/rows.length*100).toFixed(0)}% · 둘다 나음:나쁨 ${both}:${worse} · 앞/뒤 ${f(h1.length?qq(h1,.5):0)}/${f(h2.length?qq(h2,.5):0)} · MDD 차 중앙 ${f(qq(dm,.5),1)} · 최악 MDD 차 ${f(wM,1)} · TQQQ ${qq(rows.map(r=>r[k].nq),.5).toFixed(1)} · TECL ${qq(rows.map(r=>r[k].nt),.5).toFixed(0)}회/년`; };
    const st=k=>`세후 연 중앙 ${qq(rows.map(r=>r[k].a),.5).toFixed(1)} · 최악 ${Math.min(...rows.map(r=>r[k].a)).toFixed(1)} · MDD 중앙 ${qq(rows.map(r=>r[k].m),.5).toFixed(1)} · 최악 ${Math.max(...rows.map(r=>r[k].m)).toFixed(1)}`;
    console.log(`\n■ ${ds} ${key} · 5년 창 ${rows.length} · v1.0 ${st('base')} | v1.1 ${st('panic')}`);
    for(const k of keys) console.log('  '+line(k,k.startsWith('p_')?'panic':'base')); }
  fs.writeFileSync(OUT,JSON.stringify(res)); }
console.error('→ '+OUT);
