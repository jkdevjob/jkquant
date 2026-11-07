#!/usr/bin/env node
'use strict';
/* 5년 플랜 규칙 벌 — 새 규칙 '실험적 확장' (plan 1.44.0 · 2026-11-06)
 * 실제 엔진 파일(plan-session-engine.js)을 그대로 돌려 값으로 확인하고, 고친 곳을 되돌린 변이가 빨간불인지 본다.
 * base(공식 규칙): Guard 켜기 +1%·끄기 −1% · TECL 슬리브 밴드 10%p 대칭 · TQQQ 는 Guard 바뀔 때만.
 * exp1(실험): Guard 끄기 −3% · TECL 줄일 때 1%p·늘릴 때 15%p · TQQQ 해 첫 거래일에 30%와 2%p 넘게 벌어졌으면 30%로.
 * rules 를 안 주면 base 와 글자까지 같은 결과(기존 세션·모의 결과 불변).
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','plan-session-engine.js'),'utf8');
const load=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};
const trades=(R,sym)=>R.ledger.events.filter(x=>x.type==='trade'&&(!sym||x.symbol===sym));

// ── 합성 시세 — 평일 2019-01-01 부터 1,000일. SGOV 는 처음부터 있음(상장 문제는 check-plan-warmup 이 본다)
const D=[];for(let t=new Date('2019-01-01T00:00:00Z');D.length<1000;t.setUTCDate(t.getUTCDate()+1)){const w=t.getUTCDay();if(w&&w<6)D.push(t.toISOString().slice(0,10));}
const START=300;   // 시작 전 300일 = SMA225·σ20 예열
// TQQQ: 완만한 상승(SMA225 보다 +2.3% → 시작일 Guard ON) → [DIP) 구간 102.2 로 뚝(SMA ≈104.3 의 −2.0%: 기본은 OFF · 새 규칙은 ON) → 107 회복(+2.6%: 기본 되삼) → 2020-11~12 급등(+40%) → 2021 평평
const DIP0=D.findIndex(d=>d>='2020-03-02'),DIP1=D.findIndex(d=>d>='2020-04-15');
const RUN0=D.findIndex(d=>d>='2020-11-02'),Y21=D.findIndex(d=>d>='2021-01-01');
const tqqq=D.map((d,k)=>{let p=100*Math.pow(1.0002,k);if(k>=DIP0&&k<DIP1)p=102.2;else if(k>=DIP1&&k<RUN0)p=107;else if(k>=RUN0&&k<Y21)p=107*Math.pow(1.4,(k-RUN0+1)/(Y21-RUN0));else if(k>=Y21)p=107*1.4;return {date:d,close:p};});
// TECL: 일수익 ±r 번갈아(σ20 ≈ r×√252×0.98). r=2% → σ 32% → w=1(상한) · 정수 주라 슬리브 현재 ≈0.98(톱니 ±1.4%). [VOL0,VOL1) 구간 r=3.66% → σ 57% → w≈0.93 (줄이기 3~6%p: 기본 유지 · 새 규칙 매도)
const VOL0=D.findIndex(d=>d>='2020-06-01'),VOL1=D.findIndex(d=>d>='2020-07-15');   // 시작(2020-02) 뒤 · Guard 사건(3~4월·11~12월) 사이
const tecl=[];{let p=50;for(let k=0;k<D.length;k++){const r=(k>=VOL0&&k<VOL1)?.0366:.02;if(k)p*=1+(k%2?r:-r/(1+r));tecl.push({date:D[k],close:p});}}   // −r/(1+r) 로 되돌려 가격이 안 흐른다
const sgov=D.map((d,k)=>({date:d,close:100*Math.pow(1.0001,k)}));
const base={startDate:D[START],principal:100000,monthlyAdd:0,tecl,tqqq,sgov};

function check(E){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  // A. 순수 판정 함수
  const d1=E.alphaDecide({rules:'base',w:.95,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:98,sma:100,tqqqWeight:.30,guardWeight:.30,yearStart:false});
  const d2=E.alphaDecide({rules:'exp1',w:.95,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:98,sma:100,tqqqWeight:.30,guardWeight:.30,yearStart:false});
  t('A1 기본: TECL 5%p 많음 → 유지 · TQQQ −2% → OFF 전환',!d1.teclHit&&d1.guard==='OFF'&&d1.guardFlip,JSON.stringify(d1));
  t('A2 새 규칙: TECL 5%p 많음 → 줄임 · TQQQ −2% → ON 유지',d2.teclHit&&d2.guard==='ON'&&!d2.guardFlip&&Math.abs(d2.lower-97)<1e-9,JSON.stringify(d2));
  const d3=E.alphaDecide({rules:'exp1',w:1,sleeveNow:.88,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100,tqqqWeight:.30,guardWeight:.30,yearStart:false});
  const d4=E.alphaDecide({rules:'base',w:1,sleeveNow:.88,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100,tqqqWeight:.30,guardWeight:.30,yearStart:false});
  t('A3 TECL 12%p 모자람 → 새 규칙 유지(15%p 안) · 기본 늘림(10%p 초과)',!d3.teclHit&&d4.teclHit);
  const d5=E.alphaDecide({rules:'exp1',w:1,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100,tqqqWeight:.35,guardWeight:.30,yearStart:true});
  const d6=E.alphaDecide({rules:'exp1',w:1,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100,tqqqWeight:.35,guardWeight:.30,yearStart:false});
  const d7=E.alphaDecide({rules:'base',w:1,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100,tqqqWeight:.35,guardWeight:.30,yearStart:true});
  const d8=E.alphaDecide({rules:'exp1',w:1,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100,tqqqWeight:.315,guardWeight:.30,yearStart:true});
  t('A4 TQQQ 35% · 해 첫 거래일 → 새 규칙만 30% 맞춤(연중·기본·1.5%p 는 아님)',d5.tqReb&&!d6.tqReb&&!d7.tqReb&&!d8.tqReb);
  const d9=E.alphaDecide({rules:'exp1',w:1,sleeveNow:1,teclQty:10,tqqqQty:0,tqqqClose:96,sma:100,tqqqWeight:0,guardWeight:.30,yearStart:true});
  t('A5 Guard OFF 보유 0 · 해 첫 거래일 → 맞춤 없음',!d9.tqReb&&d9.guard==='OFF'&&!d9.guardFlip);
  t('A6 첫 진입(TECL 0주)은 두 규칙 다 teclHit',E.alphaDecide({rules:'base',w:1,sleeveNow:0,teclQty:0,tqqqQty:0,tqqqClose:102,sma:100,tqqqWeight:0,guardWeight:.3}).teclHit&&E.alphaDecide({rules:'exp1',w:1,sleeveNow:0,teclQty:0,tqqqQty:0,tqqqClose:102,sma:100,tqqqWeight:0,guardWeight:.3}).teclHit);
  t('A7 모르는 규칙 이름·빈 값은 기본 규칙',E.alphaRules('zzz').key==='base'&&E.alphaRules().key==='base'&&E.alphaRules('exp1').exp===true&&E.alphaRules('base').exp===false);
  t('A8 yearDoneAt: 12-31(목)→새해 · 12-30(수)→아님 · 12-29(금 · 31이 주말)→새해 · 06-30→아님',E.yearDoneAt('2026-12-31')&&!E.yearDoneAt('2026-12-30')&&E.yearDoneAt('2023-12-29')&&!E.yearDoneAt('2026-06-30'));
  // B. 재생: rules 없음 == base (글자까지)
  const R0=E.replay({...base,horizon:5}),RB=E.replay({...base,horizon:5,rules:'base'}),RX=E.replay({...base,horizon:5,rules:'exp1'});
  t('B1 rules 없음 == base',JSON.stringify(R0.ledger)===JSON.stringify(RB.ledger)&&R0.rules==='base'&&RB.rules==='base'&&RX.rules==='exp1');
  // C. Guard −1.6% 구간: 기본은 OFF 로 팔았다가 회복에 되사고, 새 규칙은 안 판다
  const dipSellB=trades(RB,'TQQQ').filter(x=>x.side==='sell'&&x.date>=D[DIP0]&&x.date<D[DIP1]),dipSellX=trades(RX,'TQQQ').filter(x=>x.side==='sell'&&x.date>=D[DIP0]&&x.date<D[DIP1]);
  t('C1 기본: −1.6% 구간에서 TQQQ 매도 1번',dipSellB.length===1&&dipSellB[0].date===D[DIP0+1],JSON.stringify(dipSellB));
  t('C2 새 규칙: 같은 구간 TQQQ 매도 없음(−3% 안)',dipSellX.length===0,JSON.stringify(dipSellX));
  t('C3 기본: 회복 뒤 TQQQ 되삼',trades(RB,'TQQQ').some(x=>x.side==='buy'&&x.date>=D[DIP1]&&x.date<D[RUN0]));
  // D. TECL σ 56% 구간(w≈0.95): 새 규칙만 TECL 을 조금 판다(5%p), 기본은 유지
  const volSellB=trades(RB,'TECL').filter(x=>x.side==='sell'&&x.date>D[VOL0]&&x.date<=D[VOL1+5]),volSellX=trades(RX,'TECL').filter(x=>x.side==='sell'&&x.date>D[VOL0]&&x.date<=D[VOL1+5]);
  t('D1 기본: TECL 매도 없음(10%p 안)',volSellB.length===0,JSON.stringify(volSellB.map(x=>x.date+':'+x.qty)));
  t('D2 새 규칙: TECL 매도 있음(1%p 넘음)',volSellX.length>=1,JSON.stringify(volSellX.map(x=>x.date+':'+x.qty)));
  // E. 해 첫 거래일(2021-01-04): TQQQ 가 11~12월 +40% 로 30% → 약 37%. 새 규칙만 그날 30% 로 판다 · 기본은 그날 TQQQ 거래 없음
  const y21=D[Y21],sellX=trades(RX,'TQQQ').filter(x=>x.date===y21),sellB=trades(RB,'TQQQ').filter(x=>x.date===y21);
  const navX=RX.nav.find(x=>x.date===y21),wBefore=RX.nav.find(x=>x.date===D[Y21-1]);
  t('E1 새 규칙: 2021-01-04 TQQQ 매도(신호일 12-31) · 그 뒤 비중 ≈30%',sellX.length===1&&sellX[0].side==='sell'&&sellX[0].signalDate===D[Y21-1]&&navX&&Math.abs(navX.tqqq*navX.tqqqPx/navX.total-.30)<.02,JSON.stringify(sellX)+' '+(navX&&(navX.tqqq*navX.tqqqPx/navX.total).toFixed(3)));
  t('E2 그 전날 TQQQ 비중 > 32%',wBefore&&wBefore.tqqq*wBefore.tqqqPx/wBefore.total>.32,wBefore&&(wBefore.tqqq*wBefore.tqqqPx/wBefore.total).toFixed(3));
  t('E3 기본: 그날 TQQQ 거래 없음',sellB.length===0,JSON.stringify(sellB));
  t('E4 두 규칙 다 평가액 유한 · 현금 음수 없음',[RB,RX].every(R=>R.nav.every(x=>Number.isFinite(x.total)&&x.cash>=-1e-7)));
  // F. exp2 공격형(2026-11-07) — 새 규칙과 같은 판정에 TECL 목표 변동성 .55 → .60. σ57% 구간: 새 규칙 w .93(줄이기 매도) · 공격형 w 1(상한) → 매도 없음
  const RA=E.replay(Object.assign({},base,{rules:'exp2'}));
  const volSellA=trades(RA,'TECL').filter(x=>x.side==='sell'&&x.date>D[VOL0]&&x.date<=D[VOL1+5]);
  t('F1 공격형: σ57% 구간 TECL 매도 없음(목표 w=1) · 새 규칙은 매도',volSellA.length===0&&volSellX.length>=1&&RA.rules==='exp2',JSON.stringify(volSellA.map(x=>x.date+':'+x.qty)));
  t('F2 공격형: TQQQ 매매(Guard −3% · 1월 맞춤)는 새 규칙과 같은 날·같은 방향',trades(RA,'TQQQ').map(x=>x.date+x.side).join()===trades(RX,'TQQQ').map(x=>x.date+x.side).join());
  t('F3 규칙 벌: exp2 s0 .60 · 실험 표시 · base·exp1 은 s0 없음(공식 .55)',E.alphaRules('exp2').s0===.60&&E.alphaRules('exp2').exp===true&&E.alphaRules('base').s0===undefined&&E.alphaRules('exp1').s0===undefined);
  t('F4 공격형 평가액 유한 · 현금 음수 없음',RA.nav.every(x=>Number.isFinite(x.total)&&x.cash>-1e-6));
  return bad;
}
const E=load(src),bad=check(E);
if(bad.length){console.error('FAIL plan rules exp:\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS plan rules exp: 판정 8 · 재생 동일성 · Guard −3% · TECL 비대칭 · TQQQ 해 첫 거래일 30% (base 는 글자까지 예전과 같음)');
// ── 변이: 고친 곳을 되돌리면 빨간불이어야 한다
const MUT=[
  ['공격형 s0 무시(늘 공식 .55)',s=>s.replace("const s0=RULES.s0??D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));","const s0=D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));")],
  ['새 규칙 Guard 끄기 −3% → −1%',s=>s.replace("guardOn:.01,guardOff:.03,bandDn:.01,bandUp:.15","guardOn:.01,guardOff:.01,bandDn:.01,bandUp:.15")],
  ['새 규칙 TECL 줄일 때 1%p → 10%p',s=>s.replace("guardOff:.03,bandDn:.01,bandUp:.15","guardOff:.03,bandDn:.10,bandUp:.15")],
  ['해 첫 거래일 TQQQ 맞춤 제거',s=>s.replace("const tqReb=R.tqReb>0&&!!a.yearStart","const tqReb=false&&R.tqReb>0&&!!a.yearStart")],
  ['재생이 규칙을 안 받음(늘 기본)',s=>s.replace("const RULES=alphaRules(opt.rules);","const RULES=alphaRules('base');")],
  ['기본 규칙이 바뀜(끄기 −1% → −3%)',s=>s.replace("base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01","base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.03")],
];
let red=0;
for(const [name,m] of MUT){const js=m(src);assert.notEqual(js,src,'변이 적용 안 됨: '+name);const b=check(load(js));if(b.length){red++;console.log('PASS 변이 빨간불: '+name+' ('+b.length+')');}else console.log('FAIL 변이가 초록: '+name);}
if(red!==MUT.length)process.exit(1);
console.log('ALL PASS plan rules exp · 변이 '+red+'/'+MUT.length);
