const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm");
const E=require("../realestate-gpt-decision-engine.js");
const now=new Date("2026-10-09T07:00:00Z"),review={comparables:true,supply:true,conditions:true},market={stale:false,entry:true,exit:false};
const p={id:"sample",kind:"apt",city:"대전",name:"시험 단지",asOf:"2026-10-08",featured:{area:84,price:500e6,expansion:20e6},
  benchmarks:{conservative:{price:650e6,date:"2026-09-20"},jeonse:{price:350e6,date:"2026-09"}},
  recentComparables:[1,2,3].map(i=>({date:"2026-09-"+(20+i),area:84,price:650e6,floor:i}))};
const s={...E.DEFAULTS,cash:300e6,reserve:20e6,monthlyLimit:2e6,ltvPct:50,extraCost:10e6};
const near=(a,b)=>assert.ok(Math.abs(a-b)<.02,a+" != "+b);
test("공식 거래 금액 단위·해제·직거래·미확인 월세 구분",()=>{
  const raw={aptNm:"단지",umdNm:"가동",excluUseAr:"84.9",dealYear:"2026",dealMonth:"9",dealDay:"3",dealAmount:" 50,000 ",deposit:"30,000",monthlyRent:"0"};
  assert.equal(E.normaliseRtms(raw,"trade").price,500e6);
  assert.equal(E.normaliseRtms({...raw,cdealType:"O"},"trade"),null);
  assert.equal(E.normaliseRtms({...raw,cdealDay:"2026-10-01"},"trade"),null);
  assert.equal(E.normaliseRtms({...raw,dealingGbn:"직거래"},"trade"),null);
  assert.equal(E.normaliseRtms({...raw,monthlyRent:""},"rent").monthly,null);
  assert.equal(E.normaliseRtms({...raw,dealAmount:""},"trade").price,null);
});
test("빈칸과 확인된 0은 다르다; 잘못된 날짜와 서울 날짜 경계",()=>{
  assert.equal(E.number(""),null);assert.equal(E.number("  \t"),null);assert.equal(E.number(null),null);assert.equal(E.number(0),0);
  assert.equal(E.validDate("2026-02-30"),false);assert.equal(E.today(new Date("2026-10-08T15:00:00Z")),"2026-10-09");
});
test("총비용·초기 현금: 비상자금은 제외하고 전세는 먼저 차감하지 않는다",()=>{
  const x=E.plan(p,s);
  assert.equal(x.total,540e6);assert.equal(x.loan,250e6);assert.equal(x.own,290e6);assert.equal(x.available,280e6);assert.equal(x.cashShortfall,10e6);
  near(x.referenceLimit,544117647.0588235);near(x.affordabilityLimit,480769230.7692308);
  const leaseChanged=E.plan({...p,benchmarks:{...p.benchmarks,jeonse:{price:999e6}}},s);assert.equal(leaseChanged.own,x.own);
});
test("무이자 원리금과 금리 스트레스; 상환 한도로 가격 제한",()=>{
  assert.equal(E.payment(12e6,0,1),1e6);assert.equal(E.payment(0,4,30),0);
  near(E.payment(100e6,6,30),599550.5251527569);
  const x=E.plan(p,{...s,cash:900e6,monthlyLimit:1e6});
  near(x.affordabilityLimit,333583228.7986271);assert.ok(x.stressedMonthly>x.monthly);
});
test("자금 부족과 가격 부담을 점수보다 먼저 드러낸다",()=>{
  assert.equal(E.evaluate(p,s,{},review,market,now).code,"cash");
  assert.equal(E.evaluate(p,{...s,cash:900e6},{askPrice:560e6},review,market,now).code,"price");
  assert.equal(E.evaluate(p,{...s,cash:900e6},{},review,market,now).code,"review");
});
test("미확인 확장비·자금·수집 누락은 조건 통과로 표시하지 않는다",()=>{
  const base={...s,cash:900e6};
  assert.equal(E.evaluate({...p,featured:{...p.featured,expansion:null}},base,{},review,market,now).total,null);
  for(const sample of [{...p,collectionIncomplete:true},{...p,asOf:"2026-09-01"},{...p,recentComparables:[]},
    {...p,kind:"presale",officialIncomplete:true,offer:{applyStart:"2026-10-08",applyEnd:"2026-10-10"}}, {...p,kind:"presale",offer:{}}]){
    const x=E.evaluate(sample,base,{},review,market,now);assert.equal(x.code,"check");assert.ok(x.missing.length);
  }
  assert.notEqual(E.evaluate(p,{...base,cash:null},{},review,market,now).code,"review");
  assert.notEqual(E.evaluate(p,base,{},review,{...market,stale:true},now).code,"review");
});
test("스냅샷의 예정 문구보다 당일 마감일을 우선한다",()=>{
  const presale={...p,kind:"presale",offer:{status:"예정",applyStart:"2026-10-08",applyEnd:"2026-10-08"}};
  assert.equal(E.offerStatus(presale,now),"접수 마감");assert.equal(E.evaluate(presale,s,{},review,market,now).code,"closed");
  assert.equal(E.offerStatus({...presale,offer:{applyStart:"2026-10-09",applyEnd:"2026-10-09"}},now),"접수 중");
});
test("기존 아파트 실거래를 현재 살 수 있는 매물가격으로 사용하지 않는다",()=>{
  const rows=E.apartmentCandidates([{apt:"단지",umd:"가동",price:500e6,area:84,date:"2026-09-03"},
    {apt:"단지",umd:"가동",price:900e6,area:84,date:"2026-09-04",cancelled:true},
    {apt:"단지",umd:"나동",price:800e6,area:84,date:"2026-09-05"}],[],{lawd:"30200",city:"대전",area:84,now});
  assert.equal(rows.length,2);assert.ok(rows.every(x=>x.featured.price===null));
  assert.ok(rows.some(x=>x.benchmarks.conservative.price===500e6));assert.equal(rows.reduce((n,x)=>n+x.tradeCount,0),2);
});
test("미래 거래·면적 차이·월세와 과거 90일 밖의 거래를 제외한다",()=>{
  const sample=t=>({apt:"단지",umd:"가동",price:500e6,area:84,date:"2026-09-03",...t});
  const rows=E.apartmentCandidates([sample({}),sample({date:"2026-10-10"}),sample({area:114}),sample({date:"2025-09-01"})],
    [{apt:"단지",umd:"가동",area:84,deposit:350e6,date:"2026-09-01",monthly:100},{apt:"단지",umd:"가동",area:84,deposit:300e6,date:"2026-09-01",monthly:0}],
    {lawd:"30200",city:"대전",area:84,now});
  assert.equal(rows[0].tradeCount,1);assert.equal(rows[0].benchmarks.jeonse.price,300e6);
});
const watch={id:"sample",stage:"watch",property:p,plan:{askPrice:500e6},review,events:[E.event("watch",{property:p},now)]};
test("계약 등록은 원래 계획을 보존하며 미래 계약/미입력 비용을 막는다",()=>{
  const held=E.registerPurchase(watch,{price:500e6,expenses:40e6,loan:250e6,date:"2026-09-01"},now);
  assert.equal(watch.stage,"watch");assert.equal(watch.events.length,1);assert.equal(held.events.length,2);assert.equal(held.purchase.expenses,40e6);
  assert.throws(()=>E.registerPurchase(watch,{price:500e6,expenses:null,loan:0,date:"2026-09-01"},now));
  assert.throws(()=>E.registerPurchase(watch,{price:500e6,expenses:0,loan:0,date:"2026-10-10"},now));
  const mutable={property:{name:"원래 이름"}},ev=E.event("plan",mutable,now);mutable.property.name="변경";assert.equal(ev.details.property.name,"원래 이름");
});
test("매도 점검: 손익분기/목표가·시장 약화/오래된 시세 구분",()=>{
  const held={...E.registerPurchase(watch,{price:500e6,expenses:40e6,loan:250e6,date:"2026-09-01"},now),
    quote:{price:620e6,date:"2026-10-08"},targetPrice:600e6,sellCostPct:1,estimatedTax:10e6,holdingCosts:20e6};
  const x=E.holding(held,market,now);near(x.breakeven,575757575.7575758);assert.equal(x.profit,438e5);assert.equal(x.code,"sell");
  assert.equal(E.holding({...held,quote:{price:620e6,date:"2026-01-01"}},market,now).code,"update");
  assert.equal(E.holding({...held,estimatedTax:null},market,now).profit,null);
  assert.equal(E.holding({...held,targetPrice:null,estimatedTax:null},market,now).code,"check");
  assert.equal(E.holding({...held,targetPrice:null},{...market,exit:true},now).code,"sell");
});
test("실현손익은 실제 비용 차감, 대출 원금 중복 차감 없음, 이벤트 보존",()=>{
  const held=E.registerPurchase(watch,{price:500e6,expenses:40e6,loan:250e6,date:"2026-09-01"},now);
  const sold=E.registerSale(held,{price:620e6,expenses:6e6,tax:10e6,holdingCosts:20e6,date:"2026-10-01"},now);
  assert.equal(sold.sale.profit,44e6);assert.equal(sold.events.length,3);assert.equal(held.events.length,2);
  assert.equal(JSON.parse(JSON.stringify(sold)).sale.profit,44e6);
  assert.throws(()=>E.registerSale(held,{price:620e6,expenses:0,tax:0,holdingCosts:0,date:"2026-08-01"},now));
});
test("세 가지 변이가 핵심 값/보류 시험에 잡힌다",()=>{
  const source=fs.readFileSync(require.resolve("../realestate-gpt-decision-engine.js"),"utf8");
  const mutations=[
    ["if(v===null||v===undefined||typeof v===\"string\"&&v.trim()===\"\"||typeof v===\"boolean\")return null;","",api=>assert.equal(api.number(""),null)],
    ["if(validDate(o.applyEnd)&&o.applyEnd<d)return \"접수 마감\";","",api=>assert.equal(api.offerStatus({...p,kind:"presale",offer:{status:"예정",applyStart:"2026-10-08",applyEnd:"2026-10-08"}},now),"접수 마감")],
    ["const profit=price-item.purchase.price-item.purchase.expenses-expenses-tax-holdingCosts;","const profit=price-item.purchase.price-item.purchase.expenses-expenses-tax-holdingCosts-item.purchase.loan;",api=>{
      const held=api.registerPurchase(watch,{price:500e6,expenses:40e6,loan:250e6,date:"2026-09-01"},now);
      assert.equal(api.registerSale(held,{price:620e6,expenses:6e6,tax:10e6,holdingCosts:20e6,date:"2026-10-01"},now).sale.profit,44e6);
    }]
  ];
  for(const [from,to,check] of mutations){assert.ok(source.includes(from));const context={module:{exports:{}},Intl,Date};vm.runInNewContext(source.replace(from,to),context);assert.throws(()=>check(context.module.exports));}
});
test("개인 기록은 본인 하위 문서만 쓰고 다른 기기 수정·계정 전환을 막는다",async()=>{
  const html=fs.readFileSync(require.resolve("../realestate.html"),"utf8");
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/mg,"");
  const auth={currentUser:{uid:"owner-a"}},calls=[];let callbacks,state={schemaVersion:1,revision:3,items:[],settings:{}},switchDuringRead=false;
  const snap=()=>({exists:()=>true,data:()=>state});
  const context={window:{dispatchEvent(){}},navigator:{userAgent:"",maxTouchPoints:0},Date,CustomEvent:function(){},
    initializeApp:()=>({}),getAuth:()=>auth,initializeFirestore:()=>({}),doc:(_db,...parts)=>parts.join("/"),
    getDoc:async ref=>{calls.push(["get",ref]);return snap();},setDoc(){},onAuthStateChanged(){},signInWithPopup(){},GoogleAuthProvider:function(){},signOut(){},
    runTransaction:async(_db,fn)=>fn({get:async()=>{if(switchDuringRead)auth.currentUser={uid:"owner-b"};return snap();},
      set:(ref,value)=>{calls.push(["set",ref]);state=value;}}),
    JKAccess:{guard:(_fb,c)=>{callbacks=c;}}};
  vm.runInNewContext(source,context);callbacks.onOk({uid:"owner-a"});
  const account=context.window.REGPT_ACCOUNT;
  await account.load();assert.deepEqual(calls,[["get","users/owner-a/realestateGpt/notebook"]]);
  await assert.rejects(()=>account.save({items:[],settings:{}},2),/다른 기기/);assert.equal(calls.length,1);
  await account.save({items:[],settings:{}},3);assert.equal(state.revision,4);assert.equal(calls[1][1],"users/owner-a/realestateGpt/notebook");
  switchDuringRead=true;await assert.rejects(()=>account.save({items:[],settings:{}},4),/계정/);assert.equal(calls.length,2);
  callbacks.onUser();assert.equal(context.window.REGPT_ACCOUNT,null);
});
