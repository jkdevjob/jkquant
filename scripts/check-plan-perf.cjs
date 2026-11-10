#!/usr/bin/env node
'use strict';
/* 듀얼가드 분석 탭 '📊 투자 성과'(plan 2.8.0) — 넣은 돈 · 실현손익 · 평가손익 · 총손익 값 시험 + 변이 시험.
   사용자(11/11): "손절을 저렇게 많이 했는데 왜 평가손익에선 저렇게 나오지 · 처음에 2만으로 시작했는데" → "다른 전략탭 분석 참고해서 분석탭에 만들어" */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const SRC=fs.readFileSync('plan.html','utf8'),ENG=fs.readFileSync('plan-session-engine.js','utf8');
function fn(s,m){const a=s.indexOf(m);assert(a>=0,m);let i=s.indexOf('{',a),n=0;for(;i<s.length;i++){if(s[i]==='{')n++;if(s[i]==='}'&&!--n)return s.slice(a,i+1);}throw Error(m);}
const near=(a,b,m)=>assert.ok(Math.abs(a-b)<1e-6,(m||'')+' '+a+' ≠ '+b);
function load(src){
  const c={console};vm.createContext(c);c.window=c;vm.runInContext(ENG,c);
  vm.runInContext('const usd2=v=>"$"+(Number(v)||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});var alphaLedger=null;'
    +'function alphaEventList(ledger=alphaLedger){return JKPlanSessionEngine.ledgerEvents(ledger);}function alphaLedgerCalc(ledger=alphaLedger){return JKPlanSessionEngine.ledgerCalc(ledger);}'
    +fn(src,'function alphaPerfCalc(ledger,startCap,prices)')+fn(src,'function alphaPerfHtml(P)'),c);
  return c;
}
/* 시작 2만$ · TECL 100주 매수 → 입금 2,557.23 → 40주 손절(−800) → 분배금 12.5 · 지금 TECL 70 · SGOV 100.5 */
const LEDGER={base:{date:'2026-09-01',tecl:0,tqqq:0,sgov:0,cash:20000,avgTecl:null,avgTqqq:null,avgSgov:null},events:[
  {id:1,type:'trade',date:'2026-09-02',symbol:'TECL',side:'buy',qty:100,price:100,fee:10},
  {id:2,type:'trade',date:'2026-09-02',symbol:'SGOV',side:'buy',qty:50,price:100,fee:5},
  {id:3,type:'cash',date:'2026-10-03',kind:'dep',amount:2557.23},
  {id:4,type:'trade',date:'2026-10-23',symbol:'TECL',side:'sell',qty:40,price:80,fee:3.2},
  {id:5,type:'cash',date:'2026-11-02',kind:'div',amount:12.5},
  {id:6,type:'trade',date:'2026-11-03',symbol:'XYZ',side:'buy',qty:5,price:10,fee:1}]};   // 모르는 종목 — 엔진처럼 건너뛴다
const PX={TECL:70,TQQQ:50,SGOV:100.5};
function check(src){
  const c=load(src),P=c.alphaPerfCalc(LEDGER,20000,PX);
  // 넣은 돈 = 시작 + 입금 − 출금 · 보유원가가 아니다
  near(P.principal,22557.23,'넣은 돈');near(P.netFlow,2557.23);near(P.start,20000);
  // 팔아서 확정된 손실은 평가손익이 아니라 실현손익에
  near(P.realized,-800,'실현손익');assert.equal(P.sells,1);assert.equal(P.unknownSells,0);near(P.realizedPct,-800/22557.23*100);
  near(P.unreal,-1775,'평가손익(TECL 60주 −1,800 + SGOV 50주 +25)');near(P.by.TECL.unreal,-1800);near(P.by.SGOV.unreal,25);assert.equal(P.by.TQQQ.unreal,null);
  near(P.by.TECL.realized,-800);near(P.by.SGOV.realized,0);assert.equal(P.by.TECL.sells,1);assert.equal(P.by.TECL.qty,60);
  // 총 자산 · 총손익 · 분해가 딱 맞는다(그 밖 0)
  near(P.invested,4200);near(P.idle,5025+10751.53);near(P.total,19976.53,'총 자산');near(P.pnl,-2580.70,'총손익');near(P.ret,-2580.70/22557.23*100);
  near(P.divIn,12.5);near(P.fees,18.2,'수수료(모르는 종목 줄 제외)');near(P.other,0,'실현 + 평가 + 분배금 − 수수료 = 총손익');
  near(P.buyAmt,15000);near(P.sellAmt,3200);assert.equal(P.pending,false);assert.equal(P.unknownCost,false);
  // 출금은 넣은 돈에서 빠진다 · 넣은 돈이 0 이면 수익률은 빈칸
  const W=c.alphaPerfCalc({base:LEDGER.base,events:LEDGER.events.concat([{id:9,type:'cash',date:'2026-11-05',kind:'wd',amount:1000}])},20000,PX);
  near(W.principal,21557.23);near(W.total,18976.53);near(W.pnl,-2580.70,'출금은 손익이 아니다');
  assert.equal(c.alphaPerfCalc({base:{cash:0},events:[]},0,PX).ret,null);
  // 시세가 아직 없으면 합계를 내지 않는다
  const N=c.alphaPerfCalc(LEDGER,20000,{SGOV:100.5});assert.equal(N.pending,true);
  // 평단 없는 매도 · 평단 미등록 보유 — 숨기지 않고 센다
  const U=c.alphaPerfCalc({base:{date:'2026-09-01',tecl:10,tqqq:5,sgov:0,cash:100,avgTecl:null,avgTqqq:null},events:[{id:1,type:'trade',date:'2026-09-02',symbol:'TECL',side:'sell',qty:4,price:50,fee:0}]},1000,PX);
  assert.equal(U.unknownSells,1);assert.equal(U.unknownCost,true);near(U.realized,0);assert.ok(Math.abs(U.other)>1,'설명 못 한 몫은 그 밖으로');
  // 화면
  const h=c.alphaPerfHtml(P);assert.ok(!/NaN|undefined|Infinity/.test(h));
  assert.ok(h.includes('총 실현손익 · 매도 1건')&&h.includes('id="alphaPerfRealized" style="color:var(--red)">$-800.00</span>'),'실현손익 머리');
  assert.ok(h.includes('id="alphaPerfPnl" style="color:var(--red)">$-2,580.70</span><span class="p" style="color:var(--red)">-11.44%</span>'),'총손익 · 넣은 돈 대비');
  assert.ok(h.includes('<div class="k">넣은 돈</div><div class="v">$22,557.23</div><div class="k" style="margin-top:2px">시작 $20,000.00 · 입금−출금 +$2,557.23</div>'));
  assert.ok(h.includes('투자 중 (TECL · TQQQ)</div><div class="v">$4,200.00')&&h.includes('대기 (SGOV · 현금)</div><div class="v">$15,776.53')&&h.includes('<i style="width:21.0%">'));
  assert.ok(h.includes('├ 실현손익')&&h.includes('├ 평가손익')&&h.includes('├ 분배금')&&h.includes('└ 수수료</td><td style="color:var(--red)">−$18.20')&&!h.includes('그 밖 <small>'),'분해 네 줄 · 그 밖은 0 이면 숨김');
  assert.ok(h.includes('<td>TECL <small>60주 · 매도 1건</small></td><td style="color:var(--red)">$-800.00</td><td style="color:var(--red)">$-1,800.00</td><td style="color:var(--red)">$-2,600.00</td>'));
  assert.ok(h.includes('<td>SGOV <small>50주</small></td><td style="color:var(--dim)">+$0.00</td><td style="color:var(--green)">+$25.00</td>'));
  assert.ok(h.includes('팔아서 확정된 손익은 여기 실현손익에 따로'));
  const hn=c.alphaPerfHtml(N);assert.ok(hn.includes('id="alphaPerfPnl" style="color:var(--red)">시세 대기')||hn.includes('">시세 대기</span>'));assert.ok(!/NaN|undefined/.test(hn));
  const hu=c.alphaPerfHtml(U);assert.ok(hu.includes('평단이 없던 매도 1건')&&hu.includes('└ 그 밖')&&hu.includes('평단 미등록'));
  // 연결
  assert.ok(src.includes('<div class="todaybox" id="alphaPerfSection" data-asset-view="analysis" hidden>')&&src.indexOf('id="alphaPerfSection"')<src.indexOf('id="alphaEvidenceSection"'),'분석 탭 · 판단 근거 앞');
  assert.ok(src.includes("if(typeof renderAlphaPerf==='function')renderAlphaPerf();"),'계좌 카드와 같이 다시 그린다');
  assert.ok(src.includes("el.innerHTML=alphaPerfHtml(alphaPerfCalc(alphaLedger,num('startCapital'),prices));"));
  assert.ok(src.includes('<div class="k">평가손익 (보유분 · 확정 손익은 분석 탭)</div>'),'현재 탭 평가손익은 보유분만이라고 적는다');
}
check(SRC);
const MUT=[
  ['넣은 돈에서 입출금 빠짐','const principal=Math.max(0,(+startCap||0)+(+S.netFlow||0))','const principal=Math.max(0,(+startCap||0))'],
  ['실현손익을 평가손익에 섞음(확정 손실이 사라짐)',"if(t&&Number.isFinite(t.profit)){realized+=t.profit;by[sym].realized+=t.profit;}else unknownSells++;","if(t&&Number.isFinite(t.profit)){by[sym].realized+=t.profit;}else unknownSells++;"],
  ['분해에서 수수료 빠짐','const other=pnl-(realized+unreal+S.divIn-fees);','const other=pnl-(realized+unreal+S.divIn);'],
  ['총손익을 보유원가 대비로','pnl=total-principal;','pnl=unreal;'],
];
let red=0;for(const [name,a,b] of MUT){assert.equal(SRC.split(a).length,2,'변이 대상 한 곳: '+name);let ok=false;try{check(SRC.replace(a,b));}catch(e){ok=true;}assert.ok(ok,'변이가 안 잡힘: '+name);red++;}
console.log('ALL PASS plan perf · 변이 '+red+'/'+MUT.length+' red');
