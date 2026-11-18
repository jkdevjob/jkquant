// 포트폴리오 ⑬ (11-18) 적립 하락 배수 — 듀얼 가드 v1.1 월 입금(달 첫 거래일 · 앱 엔진 replay 'panic' 그대로)에 engine_var.js opt.depAmt 고리만 씀
// 신호 = 입금 날 전일 TQQQ 체결가 종가 ≤ 그 n일 단순 이평(기본 200) · Guard 판 = 전일 TQQQ 가 SMA225 ±1% 히스테리시스로 OFF
// A: 하락 달엔 × k(낸 돈 늘어남 → 세후 IRR 차) · AR 위약(같은 창에서 A2 의 하락 달 비율만큼 무작위 달 × 2 · 고정 씨앗)
// B: 같은 예산 — 평소 달 keep 만 넣고 나머지는 따로 모음(이자 없음) · 하락 달엔 210 + 모은 돈 전부 · 끝에 남은 모은 돈은 현금으로 더함(세후 끝값 비)
// 세후 = aftertax.js afterTax(R, 5/6 — 섀넌과 공제를 나눠 씀) · IRR = 사용자가 낸 돈 흐름(A: 실제 입금 · B: 매달 210 그대로) 대비 세후 끝값(+ 남은 모은 돈)
// 사용: node dep_dip.js [out.json]   env: DS=real,syn,oos · SETS='2.5만,1억,1만,10만'
const fs=require('fs'),path=require('path'); const {afterTax}=require('./aftertax');
const DD=path.join(__dirname,'..','data'), PD=path.join(__dirname,'data');
const ser=s=>{ const m={}; JSON.parse(fs.readFileSync(path.join(DD,s+'.json'))).series.forEach(x=>{ if(x.close>0) m[x.date]=+x.close; }); return m; };
const toRows=m=>Object.keys(m).sort().map(d=>({date:d,close:m[d]}));
const VIXr=toRows(ser('VIX')), VXNr=toRows(ser('VXN'));
const E=require('./engine_var').load({});
const qd=s=>{ const j=JSON.parse(fs.readFileSync(path.join(PD,s+'.json'))); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const srows=s=>toRows(ser(s));
const DS=(process.env.DS||'real,syn,oos').split(','), OUT=process.argv[2]||'dep_dip_out.json';
const CFG={'2.5만':[25000,210],'1억':[69244,69.24],'1만':[10000,210],'10만':[100000,210]};
const SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return (y+Math.floor(mo/12))+'-'+String(mo%12+1).padStart(2,'0')+'-01'; };
function cut(rows,s,e){ const i0=rows.findIndex(x=>x.date>=s); if(i0<0) return null; const a=Math.max(0,i0-330); const r=rows.slice(a).filter(x=>x.date<=e); const k=100/rows[i0].close; return r.map(x=>({date:x.date,close:x.close*k})); }
const SRC={ real:()=>{ const T=qd('TECL'),Q=qd('TQQQ'),G=qd('SGOV'); return {T:T.days,Q:Q.days,G:G.days,div:[T.div,Q.div,G.div],s0:'2011-04-01',rescale:false,half:'2016-04-01'}; },
  syn:()=>({T:srows('SYNTECL'),Q:srows('SYNTQQQ'),G:srows('SYNBIL'),div:[[],[],[]],s0:'2000-06-01',rescale:true,half:'2011-01-01'}),
  oos:()=>({T:srows('SYNTECLN'),Q:srows('SYNTQQQ'),G:srows('SYNBIL_L'),div:[[],[],[]],s0:'1990-06-01',rescale:true,half:'1995-01-01',until:'1999-12-01'}) };
// 전일(i−1) 확정 신호 — S.tqqq 는 replay 안의 TQQQ 종가 배열(날짜 축 S.dates)
const smaDip=n=>(S,i)=>{ const p=i-1; if(p<n-1) return false; let s=0; for(let k=p-n+1;k<=p;k++) s+=S.tqqq[k]; return S.tqqq[p]<=s/n; };
const guardOff=()=>{ let st=null, upto=-1; return (S,i)=>{ const p=i-1; for(let k=Math.max(upto+1,224);k<=p;k++){ let s=0; for(let j=k-224;j<=k;j++) s+=S.tqqq[j]; const m=s/225, c=S.tqqq[k]; st=c>m*1.01?'ON':c<m*0.99?'OFF':(st||'ON'); upto=k; } return st==='OFF'; }; };
// 판 만들기 — 창마다 새로(상태가 있는 판이 있어서)
function mk(v,M){ const base=M; let res=0, nDip=0, nAll=0;
  const A=(sig,k)=>({fn:(date,i,S)=>{ nAll++; const d=sig(S,i); if(d) nDip++; return d?base*k:base; }, info:()=>({res:0,nDip,nAll})});
  const B=(sig,keep)=>({fn:(date,i,S)=>{ nAll++; if(sig(S,i)){ nDip++; const x=base+res; res=0; return x; } res+=base-keep; return keep; }, info:()=>({res,nDip,nAll})});
  switch(v){
    case 'A2': return A(smaDip(200),2); case 'A15': return A(smaDip(200),1.5); case 'A3': return A(smaDip(200),3);
    case 'A150': return A(smaDip(150),2); case 'A250': return A(smaDip(250),2); case 'AG': return A(guardOff(),2);
    case 'B': return B(smaDip(200),M*2/3); case 'B2': return B(smaDip(200),M/2); case 'B3': return B(smaDip(200),M*5/6);
  } }
function mkRand(f,seed,M){ let s=seed>>>0||1; const rnd=()=>(s=(s*1103515245+12345)%2147483648)/2147483648; let nDip=0,nAll=0; return {fn:()=>{ nAll++; const d=rnd()<f; if(d) nDip++; return d?M*2:M; }, info:()=>({res:0,nDip,nAll})}; }
const VARS=['A2','A15','A3','A150','A250','AG','B','B2','B3'];
const ann=(tr,yrs)=>(Math.pow(Math.max(1e-9,1+tr/100),1/yrs)-1)*100;
function irr(cfs,fin,t0,t1){ const t=d=>(Date.parse(d)-Date.parse(t0))/(365.25*864e5), T=t(t1); const f=x=>{ let s=0; for(const [d,a] of cfs) s-=a*Math.pow(1+x,-t(d)); return s+fin*Math.pow(1+x,-T); }; let lo=-0.99,hi=5; if(f(lo)*f(hi)>0) return null; for(let k=0;k<100;k++){ const m=(lo+hi)/2; if(f(lo)*f(m)<=0) hi=m; else lo=m; } return (lo+hi)/2*100; }
// 입금 흐름(실제로 넣은 돈) — nav 의 inflow 증가분
const flows=R=>{ const out=[[R.nav[0].date,+R.nav[0].inflow]]; for(let k=1;k<R.nav.length;k++){ const d=+R.nav[k].inflow-+R.nav[k-1].inflow; if(d>1e-9) out.push([R.nav[k].date,d]); } return out; };
const qq=(a,p)=>{ const b=[...a].filter(x=>x!=null).sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; }, f=(x,d=2)=>x==null?'-':(x>=0?'+':'')+x.toFixed(d);
const res={meta:{made:new Date().toISOString(),vars:VARS}};
for(const ds of DS){ const S0=SRC[ds](); const LAST=S0.T[S0.T.length-1].date; res[ds]={};
  for(const key of SETS){ const [P,M]=CFG[key]; const rows=[]; const t0=Date.now(); let chk=0;
    for(let s=S0.s0; addM(s,60)<=LAST&&(!S0.until||s<=S0.until); s=addM(s,1)){ const e=addM(s,60);
      const T=S0.rescale?cut(S0.T,s,e):S0.T, Q=S0.rescale?cut(S0.Q,s,e):S0.Q, G=S0.rescale?cut(S0.G,s,e):S0.G; if(!T||!Q||!G) continue;
      const base={horizon:5,rules:'panic',startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:T,tqqq:Q,sgov:G,teclDiv:S0.div[0],tqqqDiv:S0.div[1],sgovDiv:S0.div[2],vix:VIXr,vxn:VXNr};
      const R0=E.replay(base); if(!R0.stats) continue;
      const Rc=E.replay(Object.assign({depAmt:()=>M},base)); if(Math.abs(Rc.nav[Rc.nav.length-1].total-R0.nav[R0.nav.length-1].total)>1e-6) chk++;   // 검산: 고리로 같은 금액을 주면 앱과 같아야
      const a0=afterTax(R0,5/6), last=R0.nav[R0.nav.length-1].date, yrs=R0.stats.yrs;
      const r={s,yrs,base:{fv:a0.final,irr:irr(flows(R0),a0.final,R0.nav[0].date,last),mdd:R0.stats.mdd,a:ann(a0.tr,yrs),inflow:+R0.nav[R0.nav.length-1].inflow}};
      for(const v of VARS){ const H=mk(v,M); const R=E.replay(Object.assign({depAmt:H.fn},base)); if(!R.stats){ r[v]=null; continue; } const a=afterTax(R,5/6), I=H.info();
        const fin=a.final+I.res, isB=v.startsWith('B');
        r[v]={fv:fin,irr:irr(isB?flows(R0):flows(R),fin,R.nav[0].date,last),mdd:R.stats.mdd,dip:I.nDip/Math.max(1,I.nAll),inflow:+R.nav[R.nav.length-1].inflow}; }
      { const fr=r.A2?r.A2.dip:0; const H=mkRand(fr,Date.parse(s)/864e5,M); const R=E.replay(Object.assign({depAmt:H.fn},base)); const a=afterTax(R,5/6); r.AR={fv:a.final,irr:irr(flows(R),a.final,R.nav[0].date,last),mdd:R.stats.mdd,dip:fr,inflow:+R.nav[R.nav.length-1].inflow}; }
      rows.push(r); }
    res[ds][key]=rows;
    console.log('\n■ '+ds+' '+key+' · 5년 창 '+rows.length+' · v1.1 세후 IRR 중앙 '+qq(rows.map(r=>r.base.irr),.5).toFixed(2)+' · 하락 달 비율 중앙 '+(qq(rows.map(r=>r.A2.dip),.5)*100).toFixed(0)+'% · 검산(같은 금액 고리 ≠ 앱) '+chk+'창 · '+((Date.now()-t0)/1000).toFixed(0)+'초');
    for(const v of ['A2','A15','A3','A150','A250','AG','AR','B','B2','B3']){ const isB=v.startsWith('B');
      const d=rows.map(r=>isB?(r[v].fv/r.base.fv-1)*100:(r[v].irr-r.base.irr)), di=rows.map(r=>r[v].irr-r.base.irr);
      const h1=rows.filter(r=>r.s<S0.half).map((r,k)=>isB?(r[v].fv/r.base.fv-1)*100:(r[v].irr-r.base.irr)), h2=rows.filter(r=>r.s>=S0.half).map(r=>isB?(r[v].fv/r.base.fv-1)*100:(r[v].irr-r.base.irr));
      const wM=Math.max(...rows.map(r=>r[v].mdd))-Math.max(...rows.map(r=>r.base.mdd)), dm=rows.map(r=>r[v].mdd-r.base.mdd);
      console.log('  '+v.padEnd(5)+(isB?' 세후 끝값 차(%) 중앙 ':' 세후 IRR 차 중앙 ')+f(qq(d,.5))+' · 나은 창 '+(d.filter(x=>x>1e-9).length/d.length*100).toFixed(0)+'% · 앞/뒤 '+f(qq(h1,.5))+'/'+f(qq(h2,.5))+' · 10% '+f(qq(d,.1))+' · 최소 '+f(Math.min(...d))+(isB?' · IRR 차 중앙 '+f(qq(di,.5)):'')+' · MDD 차 중앙 '+f(qq(dm,.5),1)+' · 최악 MDD 차 '+f(wM,1)+(v.startsWith('A')?' · 낸 돈 비 중앙 ×'+qq(rows.map(r=>r[v].inflow?r[v].inflow/r.base.inflow:null),.5).toFixed(2):'')); }
    fs.writeFileSync(OUT,JSON.stringify(res)); } }
console.error('→ '+OUT);
