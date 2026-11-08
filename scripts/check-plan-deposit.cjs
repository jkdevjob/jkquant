#!/usr/bin/env node
'use strict';
/* 자산플랜 입금 맞춤 (plan 2.0.1 · 2026-11-08)
 * 사용자: "당연히 고쳐야지 하던 안하던" — 모의 엔진(plan-session-engine.js replay)은 월 입금이 들어온 날 TECL·TQQQ·SGOV 전체를
 * 목표 비중으로 맞추는데(force), 운영 화면(plan.html renderAlphaPlan)은 입금이 TECL 밴드·Guard 신호를 안 건드리면 현금으로 두었다.
 * 실제 파일의 함수를 그대로 돌려 값으로 확인하고, 고친 곳을 되돌린 변이가 빨간불인지 본다.
 *  A alphaDepositPending — 장부 순서(날짜 → 기록 순)로 '마지막 체결 뒤 입금' 판정
 *  B 화면 값 — 밴드·Guard 안에서 입금 300$ → 전체 맞춤 주문 · 판단 문장 · 한눈에 띠 · 입금 없으면 유지
 *  C 모의 엔진과 같음 — 합성 시세(입금일 종가 = 전일 종가)로 엔진을 돌리고, 입금일마다 전날 장부 + 입금으로 운영 화면을 그려
 *    주문(종목·방향·주수)이 엔진의 그날 체결과 하나도 안 다른지 본다.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const SRC={plan:fs.readFileSync(path.join(root,'plan.html'),'utf8'),eng:fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('함수 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const constOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('상수 없음: '+marker);const e=src.indexOf(';',s);return src.slice(s,e+1);};
const loadEngine=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};

// ── 합성 시세 — 평일 760일. TECL 은 일수익 ±r 번갈아(σ20 이 0.2~0.8 로 오가 목표 w 가 움직인다) · TQQQ 는 큰 물결(SMA225 위아래 → Guard 전환)
//    · 달 첫 거래일은 세 종목 모두 전일 종가 그대로(입금일 체결가 = 신호가 → 엔진 체결과 운영 주문표가 같은 값으로 비교된다)
const D=[];for(let t=new Date('2022-01-03T00:00:00Z');D.length<760;t.setUTCDate(t.getUTCDate()+1)){const w=t.getUTCDay();if(w&&w<6)D.push(t.toISOString().slice(0,10));}
const first=new Set(D.map((d,i)=>i>0&&d.slice(0,7)!==D[i-1].slice(0,7)?i:-1).filter(i=>i>0));
const series=(f)=>{const out=[];for(let k=0;k<D.length;k++)out.push(first.has(k)?out[k-1]:f(k,out[k-1]));return out;};
const tc=series((k,prev)=>{if(!k)return 45;const r=.03+.02*Math.sin(k/37);return prev*(k%2?1+r:1-r/(1+r))*1.0009;});
const qc=series(k=>60*Math.pow(1.0006,k)*(1+.16*Math.sin(k/55)));
const sc=series(k=>100*Math.pow(1.00012,k));
const rows=a=>a.map((close,k)=>({date:D[k],close}));
const TE=rows(tc),TQ=rows(qc),SG=rows(sc);
const START=300,DEP=500;

function liveContext(S,E){
  const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{textContent:'',innerHTML:'',value:'',style:{},className:'',hidden:false,disabled:false});return els.get(id);};
  const c={$:el,document:{querySelectorAll:()=>[]},window:null,usd:x=>'$'+(+x).toFixed(2),usd2:x=>'$'+(+x).toFixed(2),
    alphaWeightHistory:()=>[],alphaSvg:()=>'',alphaCloseFillEditor:()=>{},alphaOrderHtml:()=>'',waitHtml:()=>'',
    activeHorizon:5,horizonRebalancePending:false,pendingAlphaOrders:[],setTxt:(id,v)=>el(id).textContent=v};
  vm.createContext(c);c.window=c;vm.runInContext(S.eng,c);
  vm.runInContext(constOf(S.plan,'const PATH_DEFAULTS={')+constOf(S.plan,'const ALPHA_FEE_RATE='),c);
  vm.runInContext('this.PATH_DEFAULTS=PATH_DEFAULTS;this.ALPHA_FEE_RATE=ALPHA_FEE_RATE;var alphaLedger={base:{},events:[]};',c);
  for(const m of ['function alphaFee(q,p)','function indicatorSeries(a,n)','function realizedVol(rows,n)','function alphaEventList(ledger=alphaLedger)','function alphaDepositPending(ledger=alphaLedger)',
    'function planStrategy()','function planStrategyLabel()','function alphaRuleSet()','function alphaExplainBounds(target,current,band)','function renderDualGuardStrip(o)','function renderAlphaPlan(qTecl,qTqqq,qSgov)'])vm.runInContext(fnOf(S.plan,m),c);
  return {c,el};
}

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  const E=loadEngine(S.eng);
  const {c,el}=liveContext(S,E);
  // ── A. 판정
  const P=evs=>{c.alphaLedger={base:{},events:evs};return vm.runInContext('alphaDepositPending()',c);};
  const tr=(date)=>({type:'trade',date,symbol:'SGOV',side:'buy',qty:1,price:100,fee:0});
  const dep=(date,amount)=>({type:'cash',kind:'dep',date,amount});
  t('A1 장부 비었거나 체결만 → 없음',P([])===null&&P([tr('2026-11-02')])===null);
  const a2=P([tr('2026-11-02'),dep('2026-11-05',300)]);
  t('A2 마지막 체결 뒤 입금 300$ → {11-05 · 300}',a2&&a2.date==='2026-11-05'&&a2.amount===300,JSON.stringify(a2));
  t('A3 입금 뒤 체결이 있으면 맞춘 돈 → 없음',P([dep('2026-11-05',300),tr('2026-11-06')])===null);
  const a4=P([tr('2026-11-02'),dep('2026-11-03',200),dep('2026-11-05',300)]);
  t('A4 체결 없이 입금 두 번 → 합 500 · 마지막 날짜',a4&&a4.amount===500&&a4.date==='2026-11-05',JSON.stringify(a4));
  const a5=P([dep('2026-11-03',200),tr('2026-11-04'),dep('2026-11-05',300)]);
  t('A5 앞 입금은 맞췄고 뒤 입금만 남음 → 300',a5&&a5.amount===300,JSON.stringify(a5));
  t('A6 같은 날: 입금 뒤에 적은 체결 → 맞춤 끝 · 입금 앞에 적은 체결 → 아직',P([dep('2026-11-05',300),tr('2026-11-05')])===null&&!!P([tr('2026-11-05'),dep('2026-11-05',300)]));
  t('A7 장부 순서는 날짜가 먼저(기록 순은 같은 날만) — 늦게 적었어도 날짜가 앞선 체결은 입금을 못 맞춘다',!!P([dep('2026-11-05',300),tr('2026-11-04')]));
  t('A8 배당·출금·0원·음수 입금은 해당 없음',P([tr('2026-11-02'),{type:'cash',kind:'div',date:'2026-11-03',amount:5},{type:'cash',kind:'wd',date:'2026-11-04',amount:50},dep('2026-11-05',0),dep('2026-11-05',-10)])===null);

  // ── B. 화면 값 — TECL 68 · TQQQ 38 · SGOV 2 · 현금 74.5 (= 1만$) · TECL σ 50.3% → w 1 · 슬리브 96.05% · Guard ON(79 > 63.459×1.01)
  const quote=close=>({rows:[{date:'2026-11-06',close}],settled:{date:'2026-11-06',close},price:close});
  const pos={aTeclQty:68,aTqqqQty:38,aSgovQty:2,aCash:74.5,startCapital:10000};
  const runB=(cash,events)=>{c.alphaLedger={base:{},events};c.num=(id,f=0)=>({...pos,aCash:cash}[id]??f);c.realizedVol=()=>.503;c.indicatorSeries=()=>[63.459];
    c.renderAlphaPlan(quote(98.875),quote(79),quote(100));return c.pendingAlphaOrders.map(o=>o.sym+' '+o.side+' '+o.qty).join(', ');};
  const b0=runB(74.5,[tr('2026-11-02')]);
  t('B1 입금 없음 → 유지(주문 0)',b0===''&&el('alphaDecision').innerHTML.includes('오늘 판단: 유지'),b0);
  const b1=runB(374.5,[tr('2026-11-02'),dep('2026-11-06',300)]);
  // 총 10,300: TECL floor(10300×0.7/98.875)=72(+4) · TQQQ floor(10300×0.3/79)=39(+1) · SGOV floor(100/100)=1(−1).
  // 매도 SGOV 1 → 쓸 돈 474.5 · TECL 4주 395.5 → 79.0 남음 · TQQQ 1주는 수수료 몫(79×1.001)이 모자라 0주.
  t('B2 밴드·Guard 안 · 입금 300$ → 전체 맞춤: SGOV 매도 1 · TECL 매수 4 (TQQQ 1주는 수수료 몫 부족)',b1==='SGOV sell 1, TECL buy 4',b1);
  t('B3 판단 문장: 리밸런싱 · TECL "기준 안이지만 입금 맞춤" · TQQQ "입금 맞춤으로 30%" · 입금(11-06) $300.00',el('alphaDecision').innerHTML.includes('리밸런싱/상태조정')&&el('alphaDecision').innerHTML.includes('안이지만 입금 맞춤으로 목표에 맞춥니다')
    &&el('alphaDecision').innerHTML.includes('입금 맞춤으로 30% 목표에 맞춥니다')&&el('alphaDecision').innerHTML.includes('입금(2026-11-06) $300.00 뒤 체결 기록이 없어'),el('alphaDecision').innerHTML.slice(0,300));
  t('B4 한눈에 띠: 주문 2건 · "입금 맞춤 $300.00"',el('dgStrip').innerHTML.includes('주문 2건')&&el('dgStrip').innerHTML.includes('입금 맞춤 $300.00 · SGOV 매도 1주 · TECL 매수 4주'),el('dgStrip').innerHTML.slice(0,400));
  t('B5 요약 트리거 줄에 입금 맞춤',el('alphaSummary').innerHTML.includes('입금 맞춤 $300.00'));
  const b2=runB(374.5,[dep('2026-11-06',300),tr('2026-11-06')]);
  t('B6 입금 뒤 체결을 적으면 맞춤 끝 → 그 상태에선 유지',b2==='',b2);
  const b3=runB(374.5,[tr('2026-11-02'),{type:'cash',kind:'div',date:'2026-11-06',amount:300}]);
  t('B7 같은 300$ 라도 배당이면 맞추지 않는다(모의 엔진도 배당은 다음 신호까지 현금)',b3==='',b3);

  // ── C. 모의 엔진과 같음
  c.realizedVol=undefined;c.indicatorSeries=undefined;vm.runInContext(fnOf(S.plan,'function indicatorSeries(a,n)')+fnOf(S.plan,'function realizedVol(rows,n)'),c);
  const R=E.replay({horizon:5,startDate:D[START],principal:20000,monthlyAdd:DEP,tecl:TE,tqqq:TQ,sgov:SG});
  t('C0 엔진 재생 정상',R.error===''&&R.nav.length>300,R.error);
  const navBy=new Map(R.nav.map(x=>[x.date,x]));
  const deps=R.ledger.events.filter(e=>e.type==='cash'&&e.kind==='dep');
  let same=0,traded=0,mism=[];
  for(const d of deps){
    const i=D.indexOf(d.date),prev=navBy.get(D[i-1]);if(!prev)continue;
    t('C1 입금일은 종가 그대로(시험 자료 확인) '+d.date,TE[i].close===TE[i-1].close&&TQ[i].close===TQ[i-1].close&&SG[i].close===SG[i-1].close);
    const eng=R.ledger.events.filter(e=>e.type==='trade'&&e.date===d.date).map(e=>e.symbol+' '+e.side+' '+e.qty).join(', ');
    c.alphaLedger={base:{},events:[tr(D[i-2]),dep(d.date,DEP)]};
    c.num=(id,f=0)=>({aTeclQty:prev.tecl,aTqqqQty:prev.tqqq,aSgovQty:prev.sgov,aCash:prev.cash+DEP,startCapital:20000}[id]??f);
    const q=(arr)=>({rows:arr.slice(0,i),settled:arr[i-1],price:arr[i-1].close});
    c.renderAlphaPlan(q(TE),q(TQ),q(SG));
    const live=c.pendingAlphaOrders.map(o=>o.sym+' '+o.side+' '+o.qty).join(', ');
    if(eng)traded++;
    if(live===eng)same++;else mism.push(d.date+' 엔진['+eng+'] 화면['+live+']');
  }
  t('C2 입금일 '+deps.length+'번 모두 운영 주문표 = 모의 엔진 체결(종목·방향·주수)',deps.length>=12&&same===deps.length,mism.slice(0,3).join(' | '));
  t('C3 시험이 무딘지 확인 — 입금일 대부분 엔진이 실제로 매매했다(맞춤이 없으면 갈릴 날)',traded>=deps.length*.8,traded+'/'+deps.length);
  return bad;
}

const bad=check(SRC);
if(bad.length){console.error('FAIL plan deposit:\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 자산플랜 입금 맞춤: 판정 8 · 화면 값(밴드 안 300$ → SGOV −1 · TECL +4) · 모의 엔진과 입금일 주문 전부 같음');
const MUT=[
  ['입금 맞춤 없음(옛 화면)',s=>s.replace("const needRebalance=teclHit||guardFlip||tqReb||force||horizonRebalancePending","const needRebalance=teclHit||guardFlip||tqReb||horizonRebalancePending")],
  ['입금 때 TECL 은 안 맞춤',s=>s.replace("const targetTq=(teclHit||force||horizonRebalancePending)","const targetTq=(teclHit||horizonRebalancePending)")],
  ['입금 때 TQQQ 는 안 맞춤',s=>s.replace("const targetQq=(guardFlip||tqReb||force||horizonRebalancePending)","const targetQq=(guardFlip||tqReb||horizonRebalancePending)")],
  ['체결을 적어도 맞춤이 안 끝남',s=>s.replace("    else if(e.type==='trade')dep=null;\n","")],
  ['배당도 입금처럼 맞춤',s=>s.replace("if(e.type==='cash'&&e.kind==='dep'&&+e.amount>0)","if(e.type==='cash'&&e.kind!=='wd'&&+e.amount>0)")],
  ['입금 합 대신 마지막 입금만',s=>s.replace("amount:(dep?dep.amount:0)+(+e.amount)}","amount:+e.amount}")],
];
let red=0;
for(const [name,m] of MUT){const js=m(SRC.plan);assert.notEqual(js,SRC.plan,'변이 대상 없음: '+name);let b;try{b=check({...SRC,plan:js});}catch(e){b=['예외 '+e.message];}
  if(b.length){red++;console.log('PASS 변이 빨간불: '+name+' ('+b.length+')');}else console.log('FAIL 변이가 초록: '+name);}
if(red!==MUT.length)process.exit(1);
console.log('ALL PASS plan deposit · 변이 '+red+'/'+MUT.length+' red');
