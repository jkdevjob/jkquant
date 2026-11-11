#!/usr/bin/env node
'use strict';
/* 🧾 연말 세금 점검 (plan 1.47.0 · 2026-11-07) — plan-tax-check.js 값 시험 + plan.html 연결 + 변이.
 * 사용자: "해"(연말 세금 점검 카드 — 연구 11-07 심층 2: 공제 채우기·손실 상계 세후 CAGR +0.3~0.5%p).
 * 해외주식 양도세: 결제일(미국 T+1 · 2024-05-28 전 T+2) 기준 1년 실현손익 · 공제 250만원 · 22% · 원화 = 결제일 환율(환차손익 포함).
 * 2026-11-11 사용자 "듀얼가드 현재에 연말 세금 점검 양도세는 포트폴리오로 들어가서 포트폴리오에 속한 전략 전부로 판단해야지"
 *   → 점검은 💰 포트폴리오(index.html pfTaxCheck)로 · 셈은 portfolio()(전략 여럿 · 공제 한 번 · 팔고 되사기 후보는 규칙이 안 바뀌는 전략만).
 *   A11~A14 = buildTrades · portfolio() 값 시험 · B = 듀얼가드 화면에서 빠짐 · 포트폴리오 연결.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const SRC={mod:fs.readFileSync(path.join(root,'plan-tax-check.js'),'utf8'),plan:fs.readFileSync(path.join(root,'plan.html'),'utf8'),eng:fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8'),idx:fs.readFileSync(path.join(root,'index.html'),'utf8')};
const load=js=>{const m={exports:{}};vm.runInNewContext(js,{module:m});return m.exports;};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);assert(s>=0,'없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const lineOf=(src,start)=>{const s=src.indexOf(start);assert(s>=0,'없음: '+start);return src.slice(s,src.indexOf('\n',s));};
const near=(a,b,e=0.02)=>Math.abs(a-b)<=e;
const tr=(date,symbol,side,qty,price,fee)=>({type:'trade',date,symbol,side,qty,price,fee});

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  const T=load(S.mod);
  // A1~A2 결제일 · 그 해 마지막 체결일
  t('A1 결제일: 12-30→12-31 · 12-31→다음 해 01-04 · 2022(T+2) 12-28→12-30 · 금→월',T.settleDate('2026-12-30')==='2026-12-31'&&T.settleDate('2026-12-31')==='2027-01-04'&&T.settleDate('2022-12-28')==='2022-12-30'&&T.settleDate('2026-11-06')==='2026-11-09',
    [T.settleDate('2026-12-30'),T.settleDate('2026-12-31'),T.settleDate('2022-12-28'),T.settleDate('2026-11-06')].join());
  t('A2 마지막 체결일: 2023 12-27(T+2) · 2024 12-30 · 2026 12-30 · 2028 12-28',T.lastTradeDate(2023)==='2023-12-27'&&T.lastTradeDate(2024)==='2024-12-30'&&T.lastTradeDate(2026)==='2026-12-30'&&T.lastTradeDate(2028)==='2028-12-28',
    [2023,2024,2026,2028].map(y=>T.lastTradeDate(y)).join());
  // A3 환율 찾기: 그날 없으면 직전 · 처음보다 앞이면 첫 값
  const f=T.fxFn([{date:'2026-01-05',close:1400},{date:'2026-01-02',close:1390},{date:'2026-01-09',close:1410}]);
  t('A3 환율: 01-07 → 01-05 값 · 2025 → 첫 값 · last',f('2026-01-07')===1400&&f('2025-12-01')===1390&&f.last.date==='2026-01-09'&&f.last.rate===1410);
  // A4 선입선출 · 이동평균 원화 실현손익(취득·양도 환율 다름 · 수수료 필요경비)
  const FX1=[{date:'2026-01-05',close:1400},{date:'2026-03-03',close:1450},{date:'2026-06-02',close:1380},{date:'2026-11-06',close:1356}];
  const L1={base:{date:'2026-01-02',tecl:10,tqqq:0,sgov:0,cash:0,avgTecl:50},events:[tr('2026-03-02','TECL','buy',10,60,0.6),tr('2026-06-01','TECL','sell',15,70,1.05)]};
  const B1=T.build(L1,T.fxFn(FX1)),s1=B1.sells[0];
  t('A4 선입선출 원화 312,116 · 달러 248.65',near(s1.fifo.krw,312116)&&near(s1.fifo.usd,248.65),JSON.stringify(s1.fifo));
  t('A4b 이동평균 원화 269,398.5 · 달러 223.5',near(s1.avg.krw,269398.5)&&near(s1.avg.usd,223.5),JSON.stringify(s1.avg));
  t('A4c 남은 5주 원가(선입선출 = 두 번째 lot 절반 · 435,435원)',B1.pos.TECL.qty===5&&B1.pos.TECL.lots.length===1&&near(B1.pos.TECL.lots[0].costKrw,435435),JSON.stringify(B1.pos.TECL.lots));
  // A5 12-31 체결 매도는 다음 해(결제일 01-04) 세금
  const L2={base:{date:'2026-01-02',tecl:10,avgTecl:50},events:[tr('2026-12-31','TECL','sell',10,80,0.8)]};
  const C2=T.check({ledger:L2,prices:{TECL:80},fxSeries:FX1,year:'2026'}),C2b=T.check({ledger:L2,prices:{TECL:80},fxSeries:FX1,year:'2027'});
  t('A5 12-31 매도 → 2026 실현 0 · 2027 실현 있음',C2.realized.n===0&&C2b.realized.n===1&&C2b.realized.fifo>0,JSON.stringify([C2.realized,C2b.realized]));
  // A6 수량이 화면 장부(alphaLedgerCalc)와 같다 — 현금 기록 · 보정 기록 섞어서
  const L3={base:{date:'2025-03-03',tecl:5,tqqq:3,sgov:2,cash:1000,avgTecl:40,avgTqqq:30,avgSgov:100},events:[
    tr('2025-04-01','TECL','buy',4,45,0),{type:'cash',date:'2025-04-02',kind:'div',amount:5},tr('2025-05-01','TQQQ','sell',2,35,0),
    {type:'reconcile',date:'2025-06-02',snapshot:{tecl:9,tqqq:1,sgov:2,cash:900,avgTecl:42,avgTqqq:30,avgSgov:100}},tr('2025-07-01','SGOV','sell',1,101,0),tr('2025-08-01','TECL','sell',3,50,0)]};
  const ctx=vm.createContext({});vm.runInContext(S.eng,ctx);vm.runInContext(fnOf(S.plan,'function alphaEventList(')+fnOf(S.plan,'function alphaLedgerCalc('),ctx);   // 장부 계산은 엔진 ledgerCalc 한 곳(2026-11-09)
  const A=ctx.alphaLedgerCalc(L3),B3=T.build(L3,T.fxFn([{date:'2025-01-02',close:1300}]));
  t('A6 수량 = 화면 장부(TECL·TQQQ·SGOV)',B3.pos.TECL.qty===A.tecl&&B3.pos.TQQQ.qty===A.tqqq&&B3.pos.SGOV.qty===A.sgov&&B3.notes.includes('reconcile'),JSON.stringify([B3.pos.TECL.qty,A.tecl,B3.pos.TQQQ.qty,A.tqqq,B3.pos.SGOV.qty,A.sgov]));
  // A7 공제 채우기: 두 방식 다 남은 공제 × 0.9 이하 · 한 주 더 팔면 넘는다
  const FXF=[{date:'2026-01-02',close:1350}],L4={base:{date:'2026-01-02',tecl:1000,avgTecl:50},events:[]};
  const C4=T.check({ledger:L4,prices:{TECL:80},fxSeries:FXF,year:'2026'}),s4=C4.suggestions[0];
  const lim=0.9*2500000,nxt=s4&&T.simSell(T.build(L4,T.fxFn(FXF)).pos.TECL,s4.qty+1,80,1350);
  t('A7 공제 채우기: TECL n주 · 실현 ≤ 225만원 · n+1주면 넘음',C4.mode==='fill'&&s4&&s4.symbol==='TECL'&&s4.realized.fifo.krw<=lim&&s4.realized.avg.krw<=lim&&s4.realized.fifo.krw>2000000&&(nxt.fifo.krw>lim||nxt.avg.krw>lim),JSON.stringify(s4&&{q:s4.qty,f:s4.realized.fifo.krw}));
  // A8 손실 상계: 공제 초과 이익 + TQQQ 원화 평가손실 → 줄어드는 세금 22% × 1,355,400 = 298,188 · 수수료 뺀 몫 287,388
  const L5={base:{date:'2026-01-02',tecl:100,tqqq:100,avgTecl:50,avgTqqq:50},events:[tr('2026-06-01','TECL','sell',100,100,10)]};
  const C5=T.check({ledger:L5,prices:{TQQQ:40},fxSeries:FXF,year:'2026'}),s5=C5.suggestions[0];
  t('A8 손실 상계: 초과 4,236,500 · TQQQ 100주 · 세금 −298,188 · 순 287,388',C5.mode==='offset'&&near(-C5.room.fifo,4236500)&&s5&&s5.symbol==='TQQQ'&&s5.qty===100&&near(s5.taxKrw,298188)&&near(s5.netKrw,287388),JSON.stringify(s5&&{q:s5.qty,tax:s5.taxKrw,net:s5.netKrw,room:C5.room}));
  // A9 환율 함정: 달러로는 손실(50 → 45)인데 그사이 환율 1200 → 1500 이라 원화로는 이익 → 팔라고 하면 안 된다
  const FXT=[{date:'2026-01-05',close:1200},{date:'2026-06-02',close:1300},{date:'2026-11-06',close:1500}];
  const C6=T.check({ledger:L5,prices:{TQQQ:45},fxSeries:FXT,year:'2026'}),p6=C6.positions.find(p=>p.symbol==='TQQQ');
  t('A9 환율 함정: 달러 손실 · 원화 이익 → 상계 제안 없음',C6.mode==='offset'&&C6.suggestions.length===0&&p6&&p6.unreal.fifo.usd<0&&p6.unreal.fifo.krw>0,JSON.stringify({m:C6.mode,s:C6.suggestions.length,u:p6&&p6.unreal}));
  // A10 평단 미등록 종목은 제안에서 뺀다
  const C7=T.check({ledger:{base:{date:'2026-01-02',tecl:10,avgTecl:null},events:[]},prices:{TECL:80},fxSeries:FXF,year:'2026'});
  t('A10 평단 미등록 → unknown · 제안 없음',C7.positions[0].unknown===true&&C7.suggestions.length===0);
  // ── A11 운영 체결 목록(buildTrades) — 종목 여럿 · 소수 주(적립) · 산 날 · 판 날 환율 · 선입선출/이동평균
  { const FXA=[{date:'2026-01-01',close:1300},{date:'2026-03-01',close:1400},{date:'2026-06-01',close:1500}];
    const TR=[{date:'2026-01-05',symbol:'usd',side:'buy',qty:0.5,price:100,fee:0},{date:'2026-02-02',symbol:'SMH',side:'buy',qty:2,price:50,fee:0.1},
      {date:'2026-03-10',symbol:'USD',side:'buy',qty:0.25,price:120,fee:0},{date:'2026-06-10',symbol:'USD',side:'sell',qty:0.5,price:150,fee:0}];
    const B=T.buildTrades(TR,T.fxFn(FXA)),s0=B.sells[0];
    t('A11 소수 주: 선입선출 원화 47,500 · 이동평균 41,166.67 · 남은 USD 0.25주(두 번째 lot) · SMH 2주 원가 130,130원(수수료 포함)',
      B.sells.length===1&&near(s0.fifo.krw,47500)&&near(s0.avg.krw,41166.667)&&near(s0.fifo.usd,25)&&near(B.pos.USD.qty,0.25,1e-9)&&B.pos.USD.lots.length===1&&near(B.pos.USD.lots[0].costKrw,42000)&&B.pos.SMH.qty===2&&near(B.pos.SMH.costKrw,130130),
      JSON.stringify({s0,usd:B.pos.USD,smh:B.pos.SMH&&B.pos.SMH.costKrw})); }
  // ── A12 포트폴리오 · 손실 상계 — 실현손익은 전략 전부 합(공제 한 번) · 팔고 되사기 후보에서 뺀 전략(무매)은 제안 없음
  const FXC=[{date:'2025-01-01',close:1000}];
  { const P={key:'P',label:'듀얼가드',tab:'plan',kind:'plan',harvest:true,prices:{TQQQ:40},
      ledger:{base:{date:'2026-01-02',tecl:100,tqqq:100,avgTecl:50,avgTqqq:50},events:[tr('2026-05-01','TECL','sell',100,80,0)]}};
    const V={key:'V',label:'섀넌',tab:'ivs',kind:'trades',harvest:true,prices:{USD:90},expect:{USD:5},
      trades:[{date:'2026-02-02',symbol:'USD',side:'buy',qty:10,price:100,fee:0},{date:'2026-04-01',symbol:'USD',side:'sell',qty:5,price:120,fee:0}]};
    const I={key:'I',label:'무한매수법',tab:'inf',kind:'trades',harvest:false,why:'평단으로 매도 시점을 정하는 전략',prices:{SOXL:5},expect:{SOXL:100},
      trades:[{date:'2026-01-10',symbol:'SOXL',side:'buy',qty:100,price:20,fee:0}]};
    const R=T.portfolio({sources:[P,V,I],fxSeries:FXC,year:'2026'}),S=R.suggestions;
    t('A12 상계: 실현 300만(듀얼가드) + 10만(섀넌) = 310만 · 공제 한 번 → 초과 60만 · 세금 13.2만',R.mode==='offset'&&near(R.total.fifo,3100000)&&near(R.room.fifo,-600000)&&near(R.tax.fifo,132000),JSON.stringify({t:R.total,r:R.room,x:R.tax}));
    t('A12b 제안: 섀넌 USD 5주(세금 −11,099) → 듀얼가드 TQQQ 55주(−120,901 · 순 116,501) · 무매 SOXL 은 손실이 더 커도 제안 없음(규칙이 바뀌는 전략)',
      S.length===2&&S[0].key==='V'&&S[0].symbol==='USD'&&S[0].qty===5&&near(S[0].taxKrw,11099)&&S[1].key==='P'&&S[1].symbol==='TQQQ'&&S[1].qty===55&&near(S[1].taxKrw,120901)&&near(S[1].netKrw,116501)&&!S.some(x=>x.key==='I'),
      JSON.stringify(S.map(x=>[x.key,x.symbol,x.qty,Math.round(x.taxKrw),Math.round(x.netKrw)])));
    const pI=R.positions.find(p=>p.key==='I');
    t('A12c 지금 팔면: 무매 SOXL −150만원 · 제안에서 뺌(이유 그대로)',pI&&pI.harvest===false&&pI.why.includes('평단')&&near(pI.unreal.fifo.krw,-1500000),JSON.stringify(pI)); }
  // ── A13 포트폴리오 · 공제 채우기 — 다른 전략(무매)이 이미 쓴 공제를 빼고 남은 만큼만(듀얼가드 혼자 보면 75주 · 전부 보면 15주)
  { const I={key:'I',label:'무한매수법',tab:'inf',kind:'trades',harvest:false,why:'평단',prices:{},expect:{},
      trades:[{date:'2026-01-10',symbol:'SOXL',side:'buy',qty:100,price:10,fee:0},{date:'2026-03-02',symbol:'SOXL',side:'sell',qty:100,price:30,fee:0}]};
    const P={key:'P',label:'듀얼가드',tab:'plan',kind:'plan',harvest:true,prices:{TECL:80},ledger:{base:{date:'2026-01-02',tecl:1000,avgTecl:50},events:[]}};
    const R=T.portfolio({sources:[I,P],fxSeries:FXC,year:'2026'}),s0=R.suggestions[0];
    t('A13 채우기: 무매 실현 200만 → 남은 공제 50만 · 90% 45만 안 → TECL 15주(확정 448,800원 · 세금 −98,736)',R.mode==='fill'&&near(R.room.fifo,500000)&&R.suggestions.length===1&&s0.key==='P'&&s0.qty===15&&near(s0.realized.fifo.krw,448800)&&near(s0.taxKrw,98736),
      JSON.stringify({room:R.room,s:R.suggestions.map(x=>[x.key,x.qty,x.realized.fifo.krw])})); }
  // ── A14 체결로 다시 센 보유가 그 전략 계산과 다르면 → 추정(실현 = estKrw · 보유 = estPositions · 제안 없음)
  { const base={key:'X',label:'밸류리밸런싱',tab:'vr',kind:'trades',harvest:true,prices:{TQQQ:60},trades:[{date:'2026-01-05',symbol:'TQQQ',side:'buy',qty:10,price:50,fee:0}],
      estKrw:123456,estN:2,estPositions:[{symbol:'TQQQ',qty:12,price:60,costUsd:600}]};
    const R=T.portfolio({sources:[{...base,expect:{TQQQ:12}}],fxSeries:FXC,year:'2026'}),S=R.sources[0],p=R.positions[0];
    const ok=T.portfolio({sources:[{...base,expect:{TQQQ:10}}],fxSeries:FXC,year:'2026'});
    t('A14 보유가 다름(체결 10주 · 전략 12주) → 추정: 실현 123,456원 · 지금 팔면 ≈ (720−600)×1,000 · 제안 없음 · 같으면 체결 그대로',
      S.est&&S.kind==='est'&&near(S.realized.fifo,123456)&&S.realized.n===2&&p&&p.est&&p.harvest===false&&p.qty===12&&near(p.unreal.fifo.krw,120000)&&/다시 센 보유/.test(p.estWhy)&&R.suggestions.length===0
      &&ok.sources[0].kind==='trades'&&!ok.sources[0].est&&ok.positions[0].qty===10,JSON.stringify({S,p,ok:ok.sources[0].kind})); }
  // ── A15 선입선출 함정 — 오래된 lot 이 싸서 한 주는 이익인데 다 팔면 두 방식 모두 손실 → 후보에서 빼면 안 된다(실제 화면 VR 134주)
  { const E={key:'E',label:'다른 전략',tab:'ivs',kind:'est',estKrw:3000000,estN:1,harvest:false};
    const B={key:'B',label:'밸류리밸런싱',tab:'vr',kind:'trades',harvest:true,prices:{TQQQ:70},expect:{TQQQ:20},
      trades:[{date:'2026-01-05',symbol:'TQQQ',side:'buy',qty:10,price:50,fee:0},{date:'2026-02-02',symbol:'TQQQ',side:'buy',qty:10,price:100,fee:0}]};
    const R=T.portfolio({sources:[E,B],fxSeries:FXC,year:'2026'}),s0=R.suggestions[0];
    t('A15 선입선출 함정: 초과 50만 · 한 주는 선입선출 이익(+19,930) · 20주 다 팔면 두 방식 −101,400 → TQQQ 20주 제안(세금 −22,308 · 순 19,508)',
      R.mode==='offset'&&near(R.room.fifo,-500000)&&R.suggestions.length===1&&s0.key==='B'&&s0.qty===20&&near(s0.realized.fifo.krw,-101400)&&near(s0.taxKrw,22308)&&near(s0.netKrw,19508),
      JSON.stringify(R.suggestions.map(x=>[x.key,x.qty,x.realized.fifo.krw,x.taxKrw,x.netKrw]))); }
  // ── B. 듀얼가드 화면에서 빠짐(사람당 한 번인 공제를 장부 하나로 판단하지 않는다) · 포트폴리오가 그린다
  const al=fnOf(S.plan,'function renderAlphaLedger(');
  t('B1 듀얼가드: 세금 점검 칸 · 다른 해외주식 입력 · 계산 · 모듈 스크립트 없음(설정 저장 목록에서도 뺌)',!/id="alphaTaxSection"/.test(S.plan)&&!/id="taxBody"/.test(S.plan)&&!/taxOtherKrw/.test(S.plan)
    &&!/function renderTaxCheck/.test(S.plan)&&!/<script src="\/plan-tax-check\.js/.test(S.plan)&&!/renderTaxCheck/.test(al)&&!/alphaTaxSection/.test(S.plan));
  t('B2 듀얼가드 현재 계좌 카드에 포트폴리오로 가는 안내(창 밖으로 열림)',/id="alphaTaxMoved"[^>]*>🧾 연말 세금 점검\(해외주식 양도세\)은 <a href="\/portfolio" target="_top">💰 포트폴리오<\/a>/.test(S.plan)
    &&S.plan.indexOf('id="alphaTaxMoved"')>S.plan.indexOf('id="alphaAccountSection"')&&S.plan.indexOf('id="alphaTaxMoved"')<S.plan.indexOf('id="alphaEvidenceSection"'));
  t('B3 포트폴리오가 새 모듈(v=2)을 불러 portfolio() 로 센다',S.idx.includes('<script src="/plan-tax-check.js?v=2"></script>')&&/T\.portfolio\(\{sources, fxSeries:fxDays, year\}\)/.test(fnOf(S.idx,'function pfTaxCheck('))
    &&/pfTaxHtml\(PF\.tax,T\)/.test(fnOf(S.idx,'function pfRender()')));
  return bad;
}

const bad=check(SRC);
if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 포트폴리오 연말 세금 점검(A11~A14 · B) · 결제일 T+1/T+2 · 마지막 체결일 · 환율 찾기 · 선입선출/이동평균 원화 실현손익(312,116 / 269,398.5) · 12-31 매도 다음 해 · 수량 = 화면 장부 · 공제 채우기 n 최대 · 손실 상계 298,188 · 환율 함정 · 평단 미등록 · 화면 연결');
const MUT=[
  ['시작잔고 원가를 지금 환율로(환차손익 무시)','mod',s=>s.replace("const cu=avg!=null?q*avg:0,r=fx(settleDate(d)||d);","const cu=avg!=null?q*avg:0,r=fx('9999-12-31');")],
  ['결제일 = 체결일(T+1 무시)','mod',s=>s.replace("let n=String(trade)>='2024-05-28'?1:2;","let n=0;")],
  ['선입선출 대신 이동평균 원가','mod',s=>s.replace("fifo:{usd:pu-fu,krw:pk-fk}","fifo:{usd:pu-au,krw:pk-ak}")],
  ['공제 채우기 여유 없앰(100% 까지)','mod',s=>s.replace("margin=o.margin??0.9","margin=o.margin??1")],
  ['체결 목록: 소수 주 버림(적립)','mod',s=>s.replace("const s=String(e.symbol||'').toUpperCase(),q=+e.qty||0,p=+e.price||0","const s=String(e.symbol||'').toUpperCase(),q=Math.floor(+e.qty||0),p=+e.price||0")],
  ['체결 목록: 보유가 달라도 믿음','mod',s=>s.replace("if(s.expect&&!sameQty(B.pos,s.expect))","if(false&&s.expect)")],
  ['팔고 되사기: 제외한 전략(무매)도 후보','mod',s=>s.replace("positions.filter(p=>p.harvest&&!p.est&&!p.unknown&&p.price>0)","positions.filter(p=>!p.est&&!p.unknown&&p.price>0)")],
  ['공제 판단: 마지막 세션 실현손익만 셈(다른 전략 빠짐)','mod',s=>s.replace("const rf=sources.reduce((a,x)=>a+x.realized.fifo,0),ra=sources.reduce((a,x)=>a+x.realized.avg,0);","const rf=sources.length?sources[sources.length-1].realized.fifo:0,ra=sources.length?sources[sources.length-1].realized.avg:0;")],
  ['팔고 되사기: 한 주 손익으로 후보를 거름(옛 코드 · 오래된 lot 이 이익이면 통째로 빠짐)','mod',s=>s.replace("      .sort((a,b)=>b.per-a.per);","      .filter(c=>c.per>0).sort((a,b)=>b.per-a.per);")],
  ['듀얼가드 현재 탭에 세금 점검 칸이 남음(옛 코드)','plan',s=>s.replace('      <div class="card" id="alphaHistorySection"','      <div class="card" id="alphaTaxSection" data-asset-view="current"><div id="taxBody"></div></div>\n      <div class="card" id="alphaHistorySection"')],
];
for(const [name,key,mut] of MUT){
  const m=mut(SRC[key]);assert(m!==SRC[key],'변이 대상 없음: '+name);
  let failed=false;try{failed=check({...SRC,[key]:m}).length>0;}catch(e){failed=true;}
  if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  console.log('PASS 변이 빨간불: '+name);
}
console.log('ALL PASS plan tax · 변이 '+MUT.length+'/'+MUT.length+' red');
