// '안 팔고 기다리기' 사건별(11-11) — 앱 엔진 · 같은 시작일 · 기본 v1.0 vs hold(TECL 절대 안 팔기 · 처음 70%) vs w1(σ 무시 · 70% 유지 · 밴드 10%p) · 세전 평가액
const fs=require('fs'),path=require('path'); const D=__dirname,R=path.join(D,'..','data'); const rd=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const BASEV={guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10};
const V={hold:Object.assign({},BASEV,{s0:10,bandDn:1e9,bandUp:1e9,holdT:true}),w1:Object.assign({},BASEV,{s0:10})};
const E=require('./engine_var').load(V); const q=f=>{ const j=rd(f); return {days:j.ohlcTrade.map(x=>({date:x.date,close:+x.close})).filter(x=>x.close>0),div:j.dividends||[]}; };
const REAL={T:q(path.join(D,'data','TECL.json')),Q:q(path.join(D,'data','TQQQ.json')),G:q(path.join(D,'data','SGOV.json'))};
const SYN=(()=>{ const T=q(path.join(R,'SYNTECL_S.json')),Q=q(path.join(R,'SYNTQQQ_S.json')); const I=rd(path.join(R,'IRX.json')).series.filter(x=>+x.close>=0).sort((a,b)=>a.date<b.date?-1:1);
  let p=100,j=0,r=0; const days=[]; for(const d of T.days.map(x=>x.date)){ while(j<I.length&&I[j].date<=d){ r=+I[j].close; j++; } if(days.length) p*=1+Math.max(0,r/100-0.0009)/252; days.push({date:d,close:p}); }
  return {T:{days:T.days,div:[]},Q:{days:Q.days,div:[]},G:{days,div:[]}}; })();
const run=(X,k,s,e,P)=>E.replay({horizon:5,rules:k,startDate:s,endDate:e,principal:P,monthlyAdd:0,tecl:X.T.days,tqqq:X.Q.days,sgov:X.G.days,teclDiv:X.T.div,tqqqDiv:X.Q.div,sgovDiv:X.G.div});
const at=(Rr,d)=>{ const n=Rr.nav.filter(x=>x.date<=d); return n[n.length-1]; };
for(const [lab,X,s,marks,P] of [
  ['지금 사건(9/23 2만$)',REAL,'2026-09-23',['2026-10-06','2026-10-31','2026-11-10'],20000],
  ['2022 약세장(2021-11-19 1만$)',REAL,'2021-11-19',['2022-06-16','2022-12-28','2023-12-29','2024-11-19'],10000],
  ['2020 V자(2020-02-19 1만$)',REAL,'2020-02-19',['2020-03-23','2020-06-30','2020-12-31'],10000],
  ['2018 4분기(2018-10-01 1만$)',REAL,'2018-10-01',['2018-12-24','2019-04-30','2019-12-31'],10000],
  ['닷컴(합성 2000-03-24 1만$)',SYN,'2000-03-24',['2002-10-09','2005-12-30','2010-12-31','2015-12-31'],10000],
  ['금융위기(합성 2007-10-31 1만$)',SYN,'2007-10-31',['2009-03-09','2010-12-31','2013-12-31'],10000]]){
  const rows=['base','hold','w1'].map(k=>{ const Rr=run(X,k,s,'',P); let pk=0,mdd=0; for(const n of Rr.nav){ if(n.date>marks[marks.length-1]) break; pk=Math.max(pk,n.total); mdd=Math.max(mdd,1-n.total/pk); }
    return `${k==='base'?'지금 규칙':k==='hold'?'안 팔고 보유':'σ 무시 70% 유지'}: `+marks.map(d=>{ const n=at(Rr,d); return d.slice(2)+' '+Math.round(n.total).toLocaleString('en-US')+'$'+(n.teclPx?' (TECL '+(n.tecl*n.teclPx/n.total*100).toFixed(0)+'%)':''); }).join(' → ')+` · 최대 낙폭 ${(mdd*100).toFixed(0)}%`; });
  console.log(`\n■ ${lab}\n  `+rows.join('\n  ')); }
