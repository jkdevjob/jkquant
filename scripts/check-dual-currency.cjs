'use strict';
// 합성 환율/금액은 표시 단위 시험 fixture일 뿐 투자 성과가 아니다.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'jk-money.js'),'utf8'),index=fs.readFileSync(path.join(root,'index.html'),'utf8');
function fn(s,marker){const at=s.indexOf(marker);assert(at>=0,marker);let i=s.indexOf('{',at),n=0;for(;i<s.length;i++){if(s[i]==='{')n++;if(s[i]==='}'&&!--n)return s.slice(at,i+1);}throw Error(marker);}
async function check(source=src){
  let calls=0,resolveFetch;const response=new Promise(r=>{resolveFetch=r;}),win={};
  const c={window:win,Date,AbortController,setTimeout,clearTimeout,fetch:u=>{calls++;assert.equal(u,'/api/fx');return response;}};
  vm.createContext(c);vm.runInContext(source,c);const M=win.JKMoney;
  assert.equal(M.usdText(100),'$100.00 (원화 환산 대기)','미확인 환율로 원화 금액을 만들지 않음');
  assert.equal(M.usdText(100,{rate:1500}),'$100.00 (150,000원)');assert.equal(M.usdText(-10,{rate:1500}),'$-10.00 (-15,000원)');
  assert.equal(M.usdText(null),'—');assert.equal(M.usdText(NaN),'—');
  resolveFetch({ok:true,json:async()=>({rate:1500,date:'2026-10-13',src:'unit-fixture'})});await M.loadFX();assert.equal(calls,1);assert.equal(M.getFX().rate,1500);
  assert.equal(M.usdText(100),'$100.00 (150,000원)');assert(M.usdHtml(100,{won:125000}).includes('125,000원'),'투입 원화는 시작 시점 입력 금액');
  const native={window:win,curCurrency:()=> 'usd',S:{paperViewCache:null},liveFX:1500,FX:1520.21};
  vm.createContext(native);
  for(const marker of ['function wnCur(v,cur)','function usd(v)','function px(v,cs)','function paperWon(v, rate)','function paperUsd(v)','function paperDualMoney(r,v,rate,wonValue)','function paperInflowText(r)','function paperFxFallback()'])vm.runInContext(fn(index,marker),native);
  assert.equal(native.wnCur(10,'krw'),'10₩','국내 종목에 달러 환산 없음');assert.equal(native.wnCur(10,'usd'),'$10.00 (15,000원)');
  assert.equal(native.px(10,'₩'),'10₩');assert.equal(native.px(10,'$'),'$10.00 (15,000원)');
  const USD={cur:'usd',total:120,inflow:100,inflowWon:125000,wonRate:1500};
  assert(native.paperDualMoney(USD,USD.total,USD.wonRate).includes('$120.00'));assert(native.paperDualMoney(USD,USD.total,USD.wonRate).includes('180,000원'));
  assert(native.paperInflowText(USD).includes('$100.00'));assert(native.paperInflowText(USD).includes('125,000원'));assert(!native.paperInflowText(USD).includes('150,000원'));
  assert.equal(native.paperDualMoney({cur:'krw'},200000,1),'200,000원');assert.equal(native.paperFxFallback(),1500);
  native.window={JKMoney:{getFX:()=>null}};assert.equal(native.paperFxFallback(),0,'하드코딩 환율은 새 병기 표시에 쓰지 않음');
  assert.deepEqual(USD,{cur:'usd',total:120,inflow:100,inflowWon:125000,wonRate:1500},'계산/원장 금액 불변');
  const plan=fs.readFileSync(path.join(root,'plan.html'),'utf8'),p={window:win};vm.createContext(p);
  vm.runInContext(plan.split('\n').find(l=>l.startsWith('const usd2=')),p);
  assert.equal(vm.runInContext('usd2(1.2)',p),'$1.20 (1,800원)','플랜의 실제 공용 호출도 소수2자리');
  p.window={};assert.equal(vm.runInContext('usd2(1.2)',p),'$1.20','포맷터 실패시에도 기본 달러 소수2자리');
  const bt=fs.readFileSync(path.join(root,'backtest.html'),'utf8'),b={window:win,isKRW:t=>t==='KR',fmt:v=>Math.round(v).toLocaleString(),curOf:t=>t==='KR'?'₩':'$'};vm.createContext(b);
  vm.runInContext(bt.split('\n').find(l=>l.startsWith('const fmtV=')),b);
  assert.equal(vm.runInContext('fmtV(10,"SOXL")',b),'$10 (15,000원)');assert.equal(vm.runInContext('fmtV(10,"KR")',b),'10₩');
  const rows=['$99 (999,999원)','$100 (200,000원)'].map(text=>({children:[{}, {textContent:text}],querySelector:()=>null})),sorted=[],tb={querySelectorAll:()=>rows,appendChild:r=>sorted.push(r)},th={dataset:{sdir:'asc'},closest:()=>({querySelector:()=>tb}),querySelector:()=>null,appendChild:()=>{}};
  th.parentElement={children:[{querySelector:()=>null,dataset:{}},th]};b.document={createElement:()=>({})};vm.runInContext(fn(bt,'function sortResultTable(th)'),b);b.sortResultTable(th);assert.equal(sorted[0].children[1].textContent,'$100 (200,000원)','원화 숫자를 이어붙이지 않고 원래 달러 금액으로 정렬');
  const claude=fs.readFileSync(path.join(root,'claude.html'),'utf8'),cl={window:win,esc:v=>String(v??''),num:(v,d)=>Number(v||0).toFixed(d),won:v=>Math.round(v||0).toLocaleString()+'원',pct:v=>v+'%',cls:()=>''};vm.createContext(cl);vm.runInContext(fn(claude,'function closedBox(c)'),cl);
  const ledger={currency:'USD',date:'2026-10-13',trades:[{name:'SOXL',entryPrice:10,exitPrice:9,pnlAmount:-10,pnlPct:-10}],open:[]},saved=JSON.stringify(ledger),html=cl.closedBox(ledger);
  assert(html.includes('$-10.00 (-15,000원)'),'달러 손실과 원화 손실의 부호도 함께 표시');assert.equal(JSON.stringify(ledger),saved,'연구 장부 불변');
  for(const f of fs.readdirSync(root).filter(x=>x.endsWith('.html')))assert(fs.readFileSync(path.join(root,f),'utf8').includes('/jk-money.js?v=1.0.0'),f+' 공용 포맷터');
}
(async()=>{
  await check();console.log('PASS USD/KRW 병기 — 실제 환율 경로/미확인 대기/원금 당시 원화/국내 구분/숫자 불변');
  for(const [label,mutant] of [
    ['환산 곱셈 반대로',src.replace('v*r:null','v/r:null')],
    ['당시 투입 원화 무시',src.replace("if(opt&&Object.prototype.hasOwnProperty.call(opt,'won'))return number(opt.won);","if(false)return number(opt.won);")],
    ['환율 미확인 때 고정값 사용',src.replace('fx&&fx.rate>0?fx.rate:null','fx&&fx.rate>0?fx.rate:1520.21')],
  ]){assert.notEqual(mutant,src);await assert.rejects(()=>check(mutant),assert.AssertionError,label);console.log('PASS 통화 변이 차단 '+label);}
  console.log('ALL PASS dual currency + 3/3 mutations');
})().catch(e=>{console.error(e);process.exitCode=1;});
