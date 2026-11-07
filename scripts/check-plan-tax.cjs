#!/usr/bin/env node
'use strict';
/* 🧾 연말 세금 점검 (plan 1.47.0 · 2026-11-07) — plan-tax-check.js 값 시험 + plan.html 연결 + 변이.
 * 사용자: "해"(연말 세금 점검 카드 — 연구 11-07 심층 2: 공제 채우기·손실 상계 세후 CAGR +0.3~0.5%p).
 * 해외주식 양도세: 결제일(미국 T+1 · 2024-05-28 전 T+2) 기준 1년 실현손익 · 공제 250만원 · 22% · 원화 = 결제일 환율(환차손익 포함).
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const SRC={mod:fs.readFileSync(path.join(root,'plan-tax-check.js'),'utf8'),plan:fs.readFileSync(path.join(root,'plan.html'),'utf8')};
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
  const ctx=vm.createContext({});vm.runInContext(fnOf(S.plan,'function alphaEventList(')+fnOf(S.plan,'function alphaLedgerCalc('),ctx);
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
  // ── B. plan.html 연결
  t('B1 현재 탭 카드 · 상태 · 입력',/id="alphaTaxSection" data-asset-view="current"/.test(S.plan)&&S.plan.includes('id="taxBody"')&&S.plan.includes('id="taxStatus"')&&S.plan.includes('<input id="taxOtherKrw"'));
  t('B2 스크립트 · 계좌 렌더에서 호출 · 설정 저장(defaults·readForm)',S.plan.includes('<script src="/plan-tax-check.js?v=1"></script>')&&fnOf(S.plan,'function renderAlphaLedger(').includes('renderTaxCheck();')&&/taxOtherKrw:0/.test(fnOf(S.plan,'function defaults()'))&&fnOf(S.plan,'function readForm()').includes('"taxOtherKrw"'));
  // B3 실제 renderTaxCheck 를 돌려 화면 글자 확인(12-20 · 공제 채우기)
  const els={};const el=id=>els[id]||(els[id]={textContent:'',innerHTML:'',className:'',value:''});el('taxOtherKrw').value='0';
  const W={JKPlanTaxCheck:T};
  const c2=vm.createContext({window:W,$:el,liveQuotes:{TECL:{price:80},TQQQ:{settled:{close:0}},SGOV:null},alphaLedger:{base:{date:'2026-01-02',tecl:10,avgTecl:50},events:[]},
    todayISO:()=>'2026-12-20',num:(id,fb)=>{const v=Number(el(id).value);return Number.isFinite(v)?v:fb;},usd2:v=>'$'+(+v).toFixed(2),alphaFee:(q,p)=>{const g=q*p;return g<=10?0:Math.floor(g*0.1)/100;},assetPaperMode:()=>false,fetch:()=>{throw Error('no fetch');}});
  vm.runInContext('const planFx={series:'+JSON.stringify(FXF)+',loading:null,error:""};'+lineOf(S.plan,'const taxKrw=')+'\n'+fnOf(S.plan,'function taxRoomText(')+fnOf(S.plan,'function renderTaxCheck()'),c2);
  c2.renderTaxCheck();
  const html=el('taxBody').innerHTML;
  t('B3 화면: 공제 채우기 가능 · TECL 10주 팔고 되사기 · 마감 2026-12-30 · 선입선출/이동평균',el('taxStatus').textContent==='공제 채우기 가능'&&html.includes('TECL 10주 팔고 같은 날 10주 되사기')&&html.includes('2026-12-30')&&html.includes('선입선출')&&html.includes('이동평균'),el('taxStatus').textContent+' · '+html.slice(0,160));
  return bad;
}

const bad=check(SRC);
if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 연말 세금 점검: 결제일 T+1/T+2 · 마지막 체결일 · 환율 찾기 · 선입선출/이동평균 원화 실현손익(312,116 / 269,398.5) · 12-31 매도 다음 해 · 수량 = 화면 장부 · 공제 채우기 n 최대 · 손실 상계 298,188 · 환율 함정 · 평단 미등록 · 화면 연결');
const MUT=[
  ['시작잔고 원가를 지금 환율로(환차손익 무시)','mod',s=>s.replace("const cu=avg!=null?q*avg:0,r=fx(settleDate(d)||d);","const cu=avg!=null?q*avg:0,r=fx('9999-12-31');")],
  ['결제일 = 체결일(T+1 무시)','mod',s=>s.replace("let n=String(trade)>='2024-05-28'?1:2;","let n=0;")],
  ['선입선출 대신 이동평균 원가','mod',s=>s.replace("fifo:{usd:pu-fu,krw:pk-fk}","fifo:{usd:pu-au,krw:pk-ak}")],
  ['공제 채우기 여유 없앰(100% 까지)','mod',s=>s.replace("margin=o.margin??0.9","margin=o.margin??1")],
];
for(const [name,key,mut] of MUT){
  const m=mut(SRC[key]);assert(m!==SRC[key],'변이 대상 없음: '+name);
  let failed=false;try{failed=check({...SRC,[key]:m}).length>0;}catch(e){failed=true;}
  if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  console.log('PASS 변이 빨간불: '+name);
}
