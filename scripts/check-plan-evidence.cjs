'use strict';
// UI value fixtures; these are not market data or investment-performance tests.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('plan.html','utf8');
function fn(s,m){const a=s.indexOf(m);assert(a>=0,m);let i=s.indexOf('{',a),n=0;for(;i<s.length;i++){if(s[i]==='{')n++;if(s[i]==='}'&&!--n)return s.slice(a,i+1);}throw Error(m);}
function check(source=src){
  const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{textContent:'old',innerHTML:'',style:{}});return els.get(id);};
  const D={teclWeight:.70,guardWeight:.30,ivsLook:20,ivsS0:.55,ivsBand:.10,guardMA:225,guardBand:.01};
  const c={PATH_DEFAULTS:{alpha:D},horizonStrategy:()=>({years:5,key:'ivsGuard',name:'5년'}),document:{querySelectorAll:()=>[]},$:el,activeHorizon:5,horizonRebalancePending:false,setTxt:(id,v)=>el(id).textContent=v};
  vm.createContext(c);vm.runInContext(fn(source,'function renderHorizonCopy()'),c);c.renderHorizonCopy();
  assert.equal(el('alphaEv1Label').textContent,'TECL σ20');assert(el('alphaEv2Sub').textContent.includes('σ20'));assert(el('alphaEv2Sub').textContent.includes('최대70%'));
  assert(el('alphaExplain').innerHTML.includes('10%p를 초과'));assert.equal(el('alphaEv3Label').textContent,'TECL 몫 안의 현재 비율');
  el('alphaEv1Label').textContent='TQQQ 추세';el('alphaEv2Sub').textContent='10년';c.renderHorizonCopy();assert.equal(el('alphaEv1Label').textContent,'TECL σ20','다른 기간에서 돌아와도5년 설명 복원');
  Object.assign(c,{realizedVol:(rows,n)=>{assert.equal(n,20);return .503;},indicatorSeries:(rows,n)=>{assert.equal(n,225);return [63.459];},num:(id,f=0)=>({aTeclQty:64,aTqqqQty:38,aSgovQty:6,aCash:70,startCapital:10000}[id]??f),usd:x=>'$'+x.toFixed(2),alphaWeightHistory:()=>[],alphaSvg:()=>'',alphaCloseFillEditor:()=>{},ALPHA_FEE_RATE:.001,alphaFee:()=>0,alphaOrderHtml:()=>'',waitHtml:()=>'',pendingAlphaOrders:[]});
  vm.runInContext(fn(source,'function alphaExplainBounds(target,current,band)'),c);   // renderAlphaPlan 이 부르는 도우미(plan 1.43.35 에서 추가) — 없으면 시험이 ReferenceError
  vm.runInContext(fn(source,'function renderAlphaPlan(qTecl,qTqqq,qSgov)'),c);
  const quote=(close)=>({rows:[{date:'2026-10-12',close}],settled:{date:'2026-10-12',close},price:close});
  c.renderAlphaPlan(quote(98.875),quote(79),quote(100));
  assert.equal(el('alphaTargetW').textContent,'100.0%');assert.equal(el('alphaCurrentW').textContent,'90.4%');assert(el('alphaWeightGap').textContent.includes('전체 자산의 63.3%'));assert(el('alphaWeightGap').textContent.includes('9.6%p'));
  assert.equal(el('alphaGuardState').textContent,'ON');assert(el('alphaDecision').innerHTML.includes('오늘 판단: 유지'));assert.equal(c.pendingAlphaOrders.length,0);
  assert(!source.includes('TECL σ15'));assert(!source.includes('N15 · s0 55%'));assert(!source.includes('17.5%p 이상 벌어질'));
}
check();console.log('PASS native plan UI: σ20/config labels,70% sleeve,90.4%→63.3%,9.6pp hold,Guard ON,tab restoration');
for(const [label,mutant]of [['옛 지표 이름',src.replace("'TECL σ'+PATH_DEFAULTS.alpha.ivsLook","'TECL σ15'")],['전체비중과 슬리브 혼동',src.replace("(curTeclW*100).toFixed(1)","(sleeveNow*100).toFixed(1)")]]){assert.notEqual(mutant,src);assert.throws(()=>check(mutant),assert.AssertionError);console.log('PASS evidence mutation '+label);}
console.log('ALL PASS plan evidence +2/2 mutations');
