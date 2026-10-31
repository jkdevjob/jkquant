#!/usr/bin/env node
'use strict';
/* 자산플랜 모의 엔진 — SGOV 상장 전 시작 세션의 예열 (2026-10-31)
 * 옛 엔진은 날짜 축을 TECL∩TQQQ∩SGOV 로 잘라, SGOV(2020-06 상장) 앞 이력이 통째로 사라졌다.
 * SMA225·변동성·모멘텀 예열이 상장일부터 다시 시작해 2020-01 시작 5년 플랜이 2021-04 까지 무거래(현금)였다.
 * 실제 엔진 파일을 그대로 돌려 값으로 확인하고, 고친 곳을 옛 코드로 되돌린 변이 4종이 빨간불인지 본다.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'..','plan-session-engine.js'),'utf8');
const load=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};

// 합성 시세 — 평일 900일. SGOV 는 600번째 날 상장(그 앞엔 시세 없음), 700번째 날 하루 빠짐.
const D=[];for(let t=new Date('2018-01-01T00:00:00Z');D.length<900;t.setUTCDate(t.getUTCDate()+1)){const w=t.getUTCDay();if(w&&w<6)D.push(t.toISOString().slice(0,10));}
const LIST=600,HOLE=700,START=400;
const tecl=D.map((d,k)=>({date:d,close:45*Math.pow(1.0009,k)*(1+.03*Math.sin(k/9))}));
const tqqq=D.map((d,k)=>({date:d,close:60*Math.pow(1.0008,k)*(1+.004*Math.sin(k/11))}));   // 완만 — 15년(60:40)이 밴드 밖으로 안 나간다
const sgov=D.map((d,k)=>({date:d,close:100*Math.pow(1.0001,k)})).filter((x,k)=>k>=LIST&&k!==HOLE);
const base={startDate:D[START],principal:100000,monthlyAdd:0,tecl,tqqq,sgov};
const trades=R=>R.ledger.events.filter(x=>x.type==='trade');

function check(E){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  const R5=E.replay({...base,horizon:5}),R15=E.replay({...base,horizon:15}),R10=E.replay({...base,horizon:10}),R20=E.replay({...base,horizon:20});
  // W1 시작일에 바로 산다 — 예열은 TECL·TQQQ 이력(시작 전 400일)으로 끝나 있다
  const f5=trades(R5)[0];
  t('W1 5년 첫 체결 = 시작일',f5&&f5.date===D[START],f5&&f5.date);
  t('W1 5년 시작일에 TECL·TQQQ 매수',trades(R5).filter(x=>x.date===D[START]&&x.side==='buy').map(x=>x.symbol).sort().join()==='TECL,TQQQ');
  const f10=trades(R10)[0];t('W1 10년 첫 체결 = 시작일 TQQQ',f10&&f10.date===D[START]&&f10.symbol==='TQQQ',f10&&(f10.date+' '+f10.symbol));
  // W2 상장 전엔 SGOV 를 못 산다 — 남는 돈은 현금, 평가액은 늘 유한
  for(const [h,R] of [[5,R5],[10,R10],[15,R15],[20,R20]]){
    t('W2 '+h+'년 상장 전 SGOV 체결 없음',trades(R).every(x=>x.symbol!=='SGOV'||x.date>D[LIST]));
    t('W2 '+h+'년 평가액 유한·현금 음수 없음',R.nav.length>0&&R.nav.every(x=>Number.isFinite(x.total)&&x.cash>=-1e-7),JSON.stringify(R.nav.find(x=>!Number.isFinite(x.total))||''));
  }
  const pre=R5.nav.find(x=>x.date===D[LIST-1]);
  t('W2 5년 상장 전날 현금 = 총액 − TECL − TQQQ (SGOV 0)',pre&&pre.sgov===0&&Math.abs(pre.total-pre.cash-pre.tecl*pre.teclPx-pre.tqqq*pre.tqqqPx)<1e-6);
  // W3 상장일(전일 확정)에 현금을 SGOV 로 — 15년(60:40)은 다른 이유로는 거래가 없어 이 규칙만 본다
  const s15=trades(R15).filter(x=>x.symbol==='SGOV');
  t('W3 15년 첫 SGOV 매수 = 상장 다음 거래일',s15[0]&&s15[0].date===D[LIST+1]&&s15[0].signalDate===D[LIST]&&s15[0].side==='buy',s15[0]&&s15[0].date);
  const n15=R15.nav.find(x=>x.date===D[LIST+1]);
  t('W3 15년 그날 현금 대부분이 SGOV 로(남은 현금 < SGOV 2주값)',n15&&n15.cash<2*n15.sgovPx,n15&&n15.cash.toFixed(2));
  // W4 상장 뒤 SGOV 시세가 하루 빠져도 평가액이 끊기지 않는다(직전 값으로 이음)
  for(const [h,R] of [[5,R5],[15,R15]]){
    const a=R.nav.find(x=>x.date===D[HOLE-1]),b=R.nav.find(x=>x.date===D[HOLE]);
    t('W4 '+h+'년 빠진 날 평가 연속',a&&b&&b.sgovPx===a.sgovPx&&b.total/a.total>0.97&&b.total/a.total<1.03,a&&b&&(a.total.toFixed(0)+'→'+b.total.toFixed(0)));
  }
  // W5 예열이 끝난 뒤 시작하면 앞 이력 길이와 무관 — 같은 장부
  const late={...base,startDate:D[800]},cut=x=>x.slice(500);
  for(const h of [5,10,15]){
    const a=E.replay({...late,horizon:h}),b=E.replay({...late,horizon:h,tecl:cut(tecl),tqqq:cut(tqqq)});
    t('W5 '+h+'년 예열 뒤 시작은 앞 이력과 무관',JSON.stringify(a.ledger.events)===JSON.stringify(b.ledger.events)&&a.stats.total===b.stats.total);
  }
  return bad;
}

const good=check(load(src));
assert.deepEqual(good,[],'실제 엔진: '+good.join(' | '));
// 변이 — 고친 곳을 옛 코드로 되돌리면 빨간불이어야 한다
const M=[
  ['M1 날짜 축을 다시 SGOV 교집합으로','&&qm.has(d)&&(!endDate||d<=endDate)','&&qm.has(d)&&sm.has(d)&&(!endDate||d<=endDate)',/^W1/],
  ['M2 상장일 SGOV 이동 규칙 제거','const sgNew=sp.SGOV>0&&!(p>0&&S.sgov[p-1]>0)&&cash>0;','const sgNew=false;',/^W3/],
  ['M3 빠진 날 직전 값 잇기 제거','if(sm.has(d))lastS=sm.get(d);return lastS;','return sm.has(d)?sm.get(d):null;',/^W4/],
  ['M4 시세 없는 SGOV 주수·주문 막는 장치 제거',null,null,/^W2/],
];
let red=0;
for(const [name,a,b,expect] of M){
  let js=src;
  if(a){assert.equal(js.split(a).length,2,name+': 원문 1곳');js=js.replace(a,b);}
  else{
    const g1='const sgQty=rest=>sp.SGOV>0?Math.max(0,Math.floor(Math.max(0,rest)/sp.SGOV)):0;',g2='if(dq<0&&px[sym]>0){',g3='if(dq>0&&px[sym]>0){';
    for(const g of [g1,g2,g3])assert.equal(js.split(g).length,2,name+': 원문 1곳 '+g.slice(0,30));
    js=js.replace(g1,'const sgQty=rest=>Math.max(0,Math.floor(Math.max(0,rest)/sp.SGOV));').replace(g2,'if(dq<0){').replace(g3,'if(dq>0){');
  }
  const r=check(load(js));
  assert(r.some(x=>expect.test(x)),name+' — 빨간불이 안 뜸: '+r.join(' | '));
  red++;
}
console.log('PLAN WARMUP: 5 groups PASS · mutations '+red+'/'+M.length+' red');
