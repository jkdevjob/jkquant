'use strict';
// UI value fixtures; these are not market data or investment-performance tests.
// 2026-11-08: 5년 플랜 하나 · 규칙 하나(새 규칙·공격형 폐지) · 🤖 듀얼가드 한눈에 띠(오늘 판단 · TECL 전체 비중 · Guard · 다음 경계).
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('plan.html','utf8');
function fn(s,m){const a=s.indexOf(m);assert(a>=0,m);let i=s.indexOf('{',a),n=0;for(;i<s.length;i++){if(s[i]==='{')n++;if(s[i]==='}'&&!--n)return s.slice(a,i+1);}throw Error(m);}
function check(source=src){
  const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{textContent:'old',innerHTML:'',style:{}});return els.get(id);};
  const D={teclWeight:.70,guardWeight:.30,ivsLook:20,ivsS0:.55,ivsBand:.10,guardMA:225,guardBand:.01};
  const c={PATH_DEFAULTS:{alpha:D},horizonStrategy:()=>({years:5,key:'dualGuard',name:'5년 · 듀얼가드'}),document:{querySelectorAll:()=>[]},$:el,activeHorizon:5,horizonRebalancePending:false,setTxt:(id,v)=>el(id).textContent=v};
  vm.createContext(c);c.window=c;vm.runInContext(fs.readFileSync('plan-session-engine.js','utf8'),c);   // 판정(alphaDecide)·전략 이름(STRATEGY)은 모의 엔진과 같은 글자
  vm.runInContext("var planCurRules='base';function activeAssetSession(){return null;}",c);
  for(const m of ['function planStrategy()','function planStrategyLabel()','function assetRulesOf(x)','function renderPlanVersion()','function alphaRuleSet()','function renderHorizonCopy()'])vm.runInContext(fn(source,m),c);
  c.renderHorizonCopy();
  assert.equal(el('alphaEv1Label').textContent,'TECL σ20');assert(el('alphaEv2Sub').textContent.includes('σ20'));assert(el('alphaEv2Sub').textContent.includes('최대70%'));
  assert(el('alphaEv2Sub').textContent.includes('w=(55%/σ20)²'),el('alphaEv2Sub').textContent);   // 목표 변동성은 공식 55% 하나(공격형 60% 폐지)
  assert(el('alphaExplain').innerHTML.includes('10%p를 초과'));assert.equal(el('alphaEv3Label').textContent,'TECL 몫 안의 현재 비율');
  assert(el('alphaExplain').innerHTML.includes('듀얼가드 v1.0'),'설명 머리에 전략 이름·판');
  assert(el('alphaStrategyTitle').textContent.startsWith('듀얼가드'),el('alphaStrategyTitle').textContent);
  assert(el('alphaValidation').innerHTML.includes('연 30.9% · MDD 40.6%'),'앱 엔진 체결로 다시 잰 값');
  Object.assign(c,{realizedVol:(rows,n)=>{assert.equal(n,20);return .503;},indicatorSeries:(rows,n)=>{assert.equal(n,225);return [63.459];},num:(id,f=0)=>({aTeclQty:64,aTqqqQty:38,aSgovQty:6,aCash:70,startCapital:10000}[id]??f),usd:x=>'$'+x.toFixed(2),usd2:x=>'$'+x.toFixed(2),alphaWeightHistory:()=>[],alphaSvg:()=>'',alphaCloseFillEditor:()=>{},ALPHA_FEE_RATE:.001,alphaFee:()=>0,alphaOrderHtml:()=>'',waitHtml:()=>'',pendingAlphaOrders:[]});
  vm.runInContext(fn(source,'function alphaExplainBounds(target,current,band)'),c);   // renderAlphaPlan 이 부르는 도우미(plan 1.43.35 에서 추가) — 없으면 시험이 ReferenceError
  vm.runInContext(fn(source,'function renderDualGuardStrip(o)'),c);
  vm.runInContext('var alphaLedger={base:{},events:[]};'+fn(source,'function alphaEventList(ledger=alphaLedger)')+fn(source,'function alphaDepositPending(ledger=alphaLedger)'),c);   // 입금 맞춤 판정(plan 2.0.1) — 이 시험의 장부엔 입금이 없다
  vm.runInContext('var assetPaperCache={};function renderLivePanic(){}'+fn(source,'function planStrategyLabelOf(x)')+fn(source,'function alphaPanicNext(signalDate,posOn)')+fn(source,'function alphaPanicApply(PX,sigma,decGuard)'),c);   // 공포 모드 도우미(v2.6.0) — 현재 투자중은 늘 null(기본 판정)
  vm.runInContext(fn(source,'function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)'),c);
  const quote=(close)=>({rows:[{date:'2026-10-12',close}],settled:{date:'2026-10-12',close},price:close});
  c.renderAlphaPlan(quote(98.875),quote(79),quote(100));
  assert.equal(el('alphaTargetW').textContent,'100.0%');assert.equal(el('alphaCurrentW').textContent,'90.4%');assert(el('alphaWeightGap').textContent.includes('전체 자산의 63.3%'));assert(el('alphaWeightGap').textContent.includes('9.6%p'));
  assert.equal(el('alphaGuardState').textContent,'ON');assert(el('alphaDecision').innerHTML.includes('오늘 판단: 유지'));assert.equal(c.pendingAlphaOrders.length,0);
  // 한눈에 띠 — renderAlphaPlan 이 센 값 그대로: 유지 · TECL 전체 63.3% → 70.0% · 몫 기준 9.6%p · Guard ON +24.49% · 다음 OFF 경계 63.459×0.99
  const strip=()=>el('dgStrip').innerHTML;
  assert(strip().includes('<div class="v">유지</div>'),strip());
  assert(strip().includes('63.3% → 70.0%'),strip());
  assert(strip().includes('TECL 몫 기준 9.6%p 차이 · 10%p 넘으면 조정'),strip());
  assert(strip().includes('<div class="v">ON</div>')&&strip().includes('SMA225 대비 +24.49%'),strip());
  assert(strip().includes('OFF $62.82 미만'),strip());
  assert(strip().includes('2026-10-12 신호'),strip());
  // 기본 규칙: TQQQ 62.2 는 SMA 63.459 의 −2.0% → OFF 로 전환(매도). 예전 '새 규칙'(끄기 −3%)이면 ON 유지였다.
  c.renderAlphaPlan(quote(98.875),quote(62.2),quote(100));
  assert.equal(el('alphaGuardState').textContent,'OFF');assert(el('alphaDecision').innerHTML.includes('리밸런싱/상태조정'));assert(c.pendingAlphaOrders.some(o=>o.sym==='TQQQ'&&o.side==='sell'));
  assert(el('alphaGuardLevels').textContent.includes('OFF $62.82'),el('alphaGuardLevels').textContent);   // 63.459×0.99
  assert(strip().includes('class="dg-chip go"')&&strip().includes('주문 '+c.pendingAlphaOrders.length+'건'),strip());
  assert(strip().includes('TQQQ 매도 38주'),strip());
  assert(strip().includes('<div class="v">OFF 전환</div>')&&strip().includes('ON $64.09 초과'),strip());   // 63.459×1.01
  // 예전 화면 선택값(#alphaRules=exp1)이 남아 있어도 규칙은 기본 하나 — 판정·설명 모두 그대로
  el('alphaRules').value='exp1';c.renderHorizonCopy();
  assert(!el('alphaExplain').innerHTML.includes('실험적 확장'));assert(el('alphaKpi2Sub').textContent.includes('±1.0%'));
  c.renderAlphaPlan(quote(98.875),quote(62.2),quote(100));
  assert.equal(el('alphaGuardState').textContent,'OFF');assert(!el('alphaDecision').innerHTML.includes('새 규칙'));
  assert(!source.includes('TECL σ15'));assert(!source.includes('N15 · s0 55%'));assert(!source.includes('17.5%p 이상 벌어질'));
  // 불러오는 중 띠
  c.renderDualGuardStrip(null);assert(strip().includes('시세를 불러오는 중'));
}
check();console.log('PASS native plan UI: σ20/config labels,70% sleeve,90.4%→63.3%,9.6pp hold,Guard ON/OFF,듀얼가드 한눈에 띠,stale exp1 ignored');
for(const [label,mutant]of [
  ['옛 지표 이름',src.replace("'TECL σ'+PATH_DEFAULTS.alpha.ivsLook","'TECL σ15'")],
  ['전체비중과 슬리브 혼동',src.replace("(curTeclW*100).toFixed(1)","(sleeveNow*100).toFixed(1)")],
  ['띠: 전체 비중 자리에 슬리브 비중',src.replace("teclNow:curTeclW,","teclNow:sleeveNow,")],
  ['띠: 다음 경계 ON/OFF 뒤바뀜',src.replace("o.guard==='ON'?'OFF '+usd2(o.lower)+' 미만':'ON '+usd2(o.upper)+' 초과'","o.guard==='ON'?'ON '+usd2(o.upper)+' 초과':'OFF '+usd2(o.lower)+' 미만'")],
]){assert.notEqual(mutant,src,label);assert.throws(()=>check(mutant),assert.AssertionError);console.log('PASS evidence mutation '+label);}
console.log('ALL PASS plan evidence +4/4 mutations');
