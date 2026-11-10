// 후보 A(끄는 밴드만 넓히기) 확인 — 앱 엔진 그대로(engine_var.js · 전일 종가 주수 · 다음 날 종가 체결 · 배당 · 수수료) · 모의 목록 세후(aftertax.js) · 실제 + 합성(SYN*_S · 국채 = ^IRX)
// 기본 v1.0 계열은 base 와, 공포 모드 v1.1 계열은 panic 과 짝지어 본다(11-11 사전 등록 기준 ①~⑤).
// 사용: node planrule/whip_eval.js   (VARS 로 바꿔 끼우기 · FAM='base'|'panic'|'both' · SETS · SYN=0 이면 합성 생략)
const fs=require('fs'),path=require('path'); const D=__dirname, R=path.join(D,'..','data');
const PAN={hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6};
const DEF={A2:{guardOff:.02},A3:{guardOff:.03},A2h:{guardOn:.005,guardOff:.02},A3h:{guardOn:.005,guardOff:.03}};
const VB=JSON.parse(process.env.VARS||'null')||DEF;
const BASEV={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10};
const V={}; for(const [k,v] of Object.entries(VB)){ V[k]=Object.assign({},BASEV,v); V['P'+k]=Object.assign({},BASEV,v,{panic:PAN,version:'1.1'}); }
const E=require('./engine_var').load(V);
const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const ix=s=>rd(path.join(R,s+'.json')).series.filter(x=>x.close>0).map(x=>({date:x.date,close:+x.close}));
const VIX=ix('VIX'),VXN=ix('VXN');
const REAL={T:q(path.join(D,'data','TECL.json')),Q:q(path.join(D,'data','TQQQ.json')),G:q(path.join(D,'data','SGOV.json'))};
const SYN=(()=>{ const T=q(path.join(R,'SYNTECL_S.json')),Q=q(path.join(R,'SYNTQQQ_S.json')); const I=rd(path.join(R,'IRX.json')).series.filter(x=>+x.close>=0).sort((a,b)=>a.date<b.date?-1:1);
  let p=100,j=0,r=0; const days=[]; for(const d of T.days.map(x=>x.date)){ while(j<I.length&&I[j].date<=d){ r=+I[j].close; j++; } if(days.length) p*=1+Math.max(0,r/100-0.0009)/252; days.push({date:d,close:p}); }
  return {T:{days:T.days,div:[]},Q:{days:Q.days,div:[]},G:{days,div:[]}}; })();
// 표본 밖 1987~1999(11-11): TECL 대용 SYNTECLN(NDX 3배 + TECL 비용 · synth.js) · TQQQ = SYNTQQQ · 국채 = ^IRX — planoos.js 와 같은 대용
const OOSX=(()=>{ const T=q(path.join(R,'SYNTECLN.json')),Q=q(path.join(R,'SYNTQQQ.json')); const I=rd(path.join(R,'IRX.json')).series.filter(x=>+x.close>=0).sort((a,b)=>a.date<b.date?-1:1);
  let p=100,j=0,r=0; const days=[]; for(const d of T.days.map(x=>x.date)){ while(j<I.length&&I[j].date<=d){ r=+I[j].close; j++; } if(days.length) p*=1+Math.max(0,r/100-0.0009)/252; days.push({date:d,close:p}); }
  return {T:{days:T.days,div:[]},Q:{days:Q.days,div:[]},G:{days,div:[]}}; })();
const {afterTax}=require('./aftertax');
const run=(X,rules,s,e,P,M)=>{ const Rr=E.replay({horizon:5,rules,startDate:s,endDate:e,principal:P,monthlyAdd:M,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div,vix:VIX,vxn:VXN});
  if(!Rr.stats) return null; const at=afterTax(Rr), tr=Rr.ledger.events.filter(x=>x.type==='trade');
  return {mdd:Rr.stats.mdd,ann:(Math.pow(Math.max(1e-9,1+at.tr/100),1/Rr.stats.yrs)-1)*100,nQ:tr.filter(x=>x.symbol==='TQQQ').length/Rr.stats.yrs,nT:tr.filter(x=>x.symbol==='TECL').length/Rr.stats.yrs}; };
const qq=(a,p)=>{ const b=[...a].sort((x,y)=>x-y); return b[Math.floor(p*(b.length-1))]; };
const addM=(d,m)=>{ const y=+d.slice(0,4), mo=+d.slice(5,7)-1+m; return `${y+Math.floor(mo/12)}-${String(mo%12+1).padStart(2,'0')}-01`; };
const f=(x,d=1)=>(x>=0?'+':'')+x.toFixed(d), g=(x,d=1)=>x.toFixed(d);
const CFG={'2.5만':[25000,210,'2.5만$ + 월 210$(실제 구성)'],'1억':[69244,69.24,'1억원 + 월 10만원'],'1만':[10000,0,'1만$ 거치'],'10만':[100000,0,'10만$ 거치']};
const FAM=process.env.FAM||'both';
const fams=[]; if(process.env.CMP==='panic') fams.push(['panic',Object.keys(VB)]);   // CMP=panic: VARS 키(공포 모드 값을 스스로 가진 후보)를 공포 모드 v1.1 과 짝지음
else { if(FAM!=='panic') fams.push(['base',Object.keys(VB)]); if(FAM!=='base') fams.push(['panic',Object.keys(VB).map(k=>'P'+k)]); }
function block(lab,X,from,last,winFrom,winTo,half,sets){
  for(const key of sets){ const [P,M,nm]=CFG[key];
    const keys=fams.flatMap(([b,ks])=>[b,...ks]);
    const full=Object.fromEntries(keys.map(k=>[k,run(X,k,from,last,P,M)]));
    console.log(`\n■ ${lab} · ${nm} · 전 구간 ${from.slice(0,7)}~ 세후 연/MDD · 주문/년 TQQQ: `+keys.map(k=>`${k} ${g(full[k].ann)}/${g(full[k].mdd)} · ${g(full[k].nQ,1)}`).join(' | '));
    const rows=[]; for(let s=winFrom; s<=winTo&&addM(s,60)<=last; s=addM(s,1)){ const e=addM(s,60); const r=Object.fromEntries(keys.map(k=>[k,run(X,k,s,e,P,M)])); if(keys.every(k=>r[k])) rows.push({s,r}); }
    for(const [b,ks] of fams){ const bs={med:qq(rows.map(x=>x.r[b].ann),.5),min:Math.min(...rows.map(x=>x.r[b].ann)),mm:qq(rows.map(x=>x.r[b].mdd),.5),mx:Math.max(...rows.map(x=>x.r[b].mdd))};
      console.log(`  [${b}] 5년 창 ${rows.length}개 · 세후 연 중앙 ${g(bs.med)} · 최악 ${g(bs.min)} · MDD 중앙 ${g(bs.mm)} · 최악 ${g(bs.mx)}`);
      for(const k of ks){ const d=rows.map(x=>x.r[k].ann-x.r[b].ann), dm=rows.map(x=>x.r[k].mdd-x.r[b].mdd);
        const both=rows.filter(x=>x.r[k].ann>x.r[b].ann+1e-9&&x.r[k].mdd<=x.r[b].mdd+1e-9).length, worse=rows.filter(x=>x.r[k].ann<x.r[b].ann-1e-9&&x.r[k].mdd>x.r[b].mdd-1e-9).length;
        const h1=rows.filter(x=>x.s<half).map(x=>x.r[k].ann-x.r[b].ann), h2=rows.filter(x=>x.s>=half).map(x=>x.r[k].ann-x.r[b].ann);
        const mx=Math.max(...rows.map(x=>x.r[k].mdd));
        console.log(`   ${k.padEnd(5)} 중앙 ${g(qq(rows.map(x=>x.r[k].ann),.5))} · 연 차 중앙 ${f(qq(d,.5),2)} (하10 ${f(qq(d,.1),2)} · 상10 ${f(qq(d,.9),2)}) · 낮은 창 ${g(d.filter(v=>v<-1e-9).length/rows.length*100,0)}% · MDD 차 중앙 ${f(qq(dm,.5))} · 최악 MDD ${g(mx)}(${f(mx-bs.mx)}) · 둘 다 나음 ${both} : 둘 다 나쁨 ${worse} | 앞 절반 ${f(qq(h1,.5),2)} · 뒤 절반 ${f(qq(h2,.5),2)}`); } } }
}
const LR=REAL.T.days[REAL.T.days.length-1].date, LS=SYN.T.days[SYN.T.days.length-1].date;
const SETS=(process.env.SETS||'2.5만,1억,1만,10만').split(',');
if(process.env.REAL!=='0') block('실제(앱 엔진 · 체결가)',REAL,'2011-04-01',LR,'2011-04-01','2021-11-01','2016-04-01',SETS);
if(process.env.OOS==='1') block('표본 밖 1987~1999(SYNTECLN · SYNTQQQ · 국채 ^IRX)',OOSX,'1987-01-01','1999-12-31','1987-01-01','1995-01-01','1991-01-01',(process.env.SSETS||'2.5만,1만,10만').split(','));
if(process.env.SYN!=='0') block('합성(SYN_S · 국채 ^IRX)',SYN,'2000-01-01',LS,'2000-01-01','2021-10-01','2011-01-01',(process.env.SSETS||'2.5만,1만,10만').split(','));
