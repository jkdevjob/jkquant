import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultPaperSettings,changePaperSettings,PAPER_STRATEGIES} from '../functions/api/_paper-trading.js';
import {dayBrokerPlans,soxlBrokerPlans,closingBrokerPlans,tenbaggerBrokerPlans,validateBrokerPlan,krAt} from '../functions/api/_research-orders.js';
import {researchBroker,positionKey,exactOrderFill} from '../functions/api/_research-broker.js';
import {brokerRecords,uniqueRecords,recordsCsv} from '../functions/api/_trade-history.js';
import {openingOwnedQty,openingOrderRefs} from '../functions/api/_opening-execution.js';
import {onRequestPost as relay} from '../functions/api/research-kis.js';
import {onRequestGet as historyGet} from '../functions/api/trade-history.js';
import {cancelSoxlVts,_resetTokenForTest,researchVtsConnections} from '../functions/api/kis.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const DATE='2026-10-23',at=hm=>krAt(DATE,hm),toIso=n=>new Date(n).toISOString(),RealDate=Date;
const source={date:DATE,mainVariant:'vol_1.2',mode:'server-live-paper-no-order',strategyVersion:'day_v1',trades:[{id:'005930:1000',code:'005930',name:'삼성전자',signalTime:1000,entryTime:1001,entryPrice:10000,status:'open'}],shadowLedgers:{other:{trades:[{id:'000660:1000',code:'000660',entryPrice:1,entryTime:1001}]}}};
const mainPlan=()=>dayBrokerPlans(source,at(1002))[0];
function store(){
 const values=new Map();let tail=Promise.resolve();
 const st={values,get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{
  if(st.failIntent&&((typeof k==='object'&&Object.values(k).some(x=>x?.events?.at(-1)?.phase==='intent'))||v?.events?.at(-1)?.phase==='intent'))throw Error('intent storage down');
  if(st.failResult&&v?.events?.at(-1)?.phase==='result')throw Error('result storage down');
  if(st.failTracking&&k==='pending'){st.failTracking=false;throw Error('tracking write down');}
  if(st.breakTrackingAfterResult&&v?.events?.at(-1)?.phase==='result')st.failTracking=true;
  if(typeof k==='object'){for(const [name,value] of Object.entries(k))values.set(name,structuredClone(value));}else values.set(k,structuredClone(v));
 }};st.transaction=fn=>{const p=tail.then(()=>fn(st));tail=p.catch(()=>{});return p;};return st;
}
function world(strategy='gpt_daytrading',options={}){
 const st=store(),h={st,now:at(1002),calls:[],orders:[],fills:new Map(),mode:'accepted',noFill:false};
 h.settings=changePaperSettings(defaultPaperSettings(),{expectedRevision:0,strategy,enabled:true,budget:2000000,...(strategy==='gpt_tenbagger'?{exitArm:'stop12_trail35',pattern:'trend200'}:{})},toIso(at(900)));
 h.env={MONITOR_KEY:'fixture',SIGNAL_STORE:{idFromName:n=>n,get:()=>({fetch:async()=>Response.json({ok:true,settings:h.settings})})}};
 h.fetch=async(input,init)=>{
  const u=String(input);assert.match(u,/\/api\/research-kis$/);const b=JSON.parse(init.body);h.calls.push(b);
  if(b.action==='quote'){if(h.quoteHook)h.quoteHook();return Response.json({price:strategy==='gpt_soxl'?30:10000,market:'AMEX'});}
  if(b.action==='fx')return Response.json({rate:1400,date:DATE,asof:toIso(h.now),src:'fixture'});
  if(b.action==='order'){
   assert.equal((await st.get(positionKey(b.plan))).operations[b.side].status,'unverified','durable intent before HTTP');h.orders.push(b);
   if(h.mode==='unknown')throw Error('connection reset after submission');
   if(h.mode==='rejected')return Response.json({ok:false,msg:'잔고 부족',raw:{rt_cd:'1'}},{status:502});
   const no=String(1000+h.orders.length),fillQty=h.noFill?0:b.qty;
   h.fills.set(no,{orderDate:b.plan.sessionDate,code:b.plan.code,sideCode:b.side==='buy'?'02':'01',orderNo:no,fillQty,fillPrice:b.side==='buy'?100:102,fillAmount:fillQty*(b.side==='buy'?100:102),remainingQty:b.qty-fillQty,canceled:false,orderTime:'100200'});
   return Response.json({ok:true,orderNo:no,msg:'접수'});
  }
  if(b.action==='orders'){
   if(h.failInquiry)throw Error('inquiry down');
   const own=h.fills.get(b.orderNo);return Response.json({orders:[{orderDate:DATE,code:b.plan.code,sideCode:'02',orderNo:'99999',fillQty:9000,fillPrice:1,remainingQty:0},...(own?[own]:[])]});
  }
  if(b.action==='cancel'){
   if(h.cancelUnknown)throw Error('cancel response lost');
   const fill=h.fills.get(b.orderNo);fill.canceled=true;fill.remainingQty=0;return Response.json({ok:true,orderNo:'7000',raw:{rt_cd:'0'}});
  }throw Error('unexpected '+b.action);
 };
 h.call=async(p,handler=researchBroker)=>{const r=await handler(st,h.env,new Request('https://internal/research-execute',{method:'POST',body:JSON.stringify(p)}));return {status:r.status,...await r.json()};};
 h.reconcile=async(handler=researchBroker)=>{const r=await handler(st,h.env,new Request('https://internal/research-reconcile',{method:'POST',body:'{}'}));return r.json();};
 Object.assign(h,options);return h;
}
async function using(h,fn){
 const priorFetch=globalThis.fetch,priorTimeout=globalThis.setTimeout;
 globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[h.now]));}static now(){return h.now;}};
 globalThis.fetch=h.fetch;
 globalThis.setTimeout=(fn,delay,...args)=>delay===1200?priorTimeout(fn,0,...args):priorTimeout(fn,delay,...args);
 try{return await fn();}finally{globalThis.Date=RealDate;globalThis.fetch=priorFetch;globalThis.setTimeout=priorTimeout;}
}
test('six stock strategies connected, BTC unsupported, persisted switches stay OFF and arm is explicit',()=>{
 assert.deepEqual(PAPER_STRATEGIES.filter(s=>s.supported).map(x=>x.id),['gpt_opening','gpt_daytrading','gpt_closing30','gpt_closing_bet','gpt_soxl','gpt_tenbagger']);
 const s=defaultPaperSettings();assert.ok(Object.values(s.strategies).every(v=>!v.enabled));assert.throws(()=>changePaperSettings(s,{expectedRevision:0,strategy:'gpt_crypto',enabled:true,budget:2000000}));
 assert.throws(()=>changePaperSettings(s,{expectedRevision:0,strategy:'gpt_tenbagger',enabled:true,budget:2000000}));
 const a=changePaperSettings(s,{expectedRevision:0,strategy:'gpt_tenbagger',enabled:true,budget:2000000,exitArm:'hold1260',pattern:'trend200'},toIso(at(900)));
 assert.equal(a.strategies.gpt_tenbagger.exitArm,'hold1260');assert.equal(a.strategies.gpt_tenbagger.enabledSince,toIso(at(900)));
});
test('main-only plans exclude shadows, imports and partial entries while preserving deadline exits',()=>{
 const [p]=dayBrokerPlans(source,at(1002));assert.equal(p.code,'005930');assert.equal(p.variant,'vol_1.2');assert.equal(p.sourceId,source.trades[0].id);assert.equal(p.exitDueAt,toIso(at(1510)));
 assert.equal(dayBrokerPlans(source,at(1002),true).length,0);assert.equal(dayBrokerPlans({...source,mode:'historical-research-import-no-order'},at(1002)).length,0);
 const exit=dayBrokerPlans(source,at(1510),true);assert.equal(exit.length,1);assert.equal(exit[0].side,'sell');assert.equal(exit[0].source.reason,'broker_session_deadline');
 assert.match(validateBrokerPlan(p,at(1005)),/시각/);assert.equal(validateBrokerPlan(p,at(1002)),'');
});
const closingLedger={date:DATE,scans:[{partial:false}],events:['day','overnight'].flatMap(kind=>['baseline','shadow'].flatMap(variant=>['signal','buy'].map(stage=>({id:[kind,variant,stage].join(':'),date:DATE,code:'005930',name:'삼성전자',kind,variant,stage,createdAt:toIso(at(kind==='day'?1506:1522)),price:10000}))))};
test('closing broker uses pre-close/pre-open windows and identical entry/exit ownership, never 15:40/09:06 retro orders',()=>{
 const b=closingBrokerPlans(closingLedger,'day','buy',DATE)[0],s=closingBrokerPlans(closingLedger,'day','sell',DATE)[0];assert.equal(b.dueAt,toIso(at(1507)));assert.equal(s.dueAt,toIso(at(1523)));assert.equal(positionKey(b),positionKey(s));
 assert.equal(closingBrokerPlans(closingLedger,'day','buy',DATE).length,1);assert.notEqual(validateBrokerPlan(s,at(1540)),'');
 const overnight=closingBrokerPlans(closingLedger,'overnight','buy',DATE)[0],morning=closingBrokerPlans(closingLedger,'overnight','sell','2026-10-26')[0];assert.equal(positionKey(overnight),positionKey(morning));assert.equal(morning.dueAt,'2026-10-25T23:56:00.000Z');assert.equal(validateBrokerPlan(morning,Date.parse('2026-10-26T09:06:00+09:00')).length>0,true);
 assert.equal(closingBrokerPlans({...closingLedger,scans:[{partial:true}]},'day','buy',DATE).length,0);
 const worker=read('worker/opening-scheduler/src/index.js');assert.match(worker,/if\(hm===1523\)return "research_close"/);assert.match(worker,/brokerHm===856/);assert.match(worker,/runTenbaggerBroker/);
});
function tenbagger(){return {ok:true,schemaVersion:1,asOf:'2026-10-22',source:{asOf:'2026-10-22'},rulesSha256:'locked',records:[{id:'t',code:'005930',name:'삼성전자',registeredDate:'2026-10-22',registeredAt:'2026-10-22T10:30:00Z',signalDate:'2026-10-22',pattern:'trend200',strategyVersion:'1.0.0',rulesSha256:'locked',entryDate:null,revisionDates:[],arms:{hold1260:{status:'pending'},stop12_trail35:{status:'pending'}}}]};}
test('tenbagger uses fresh prospective registrations, chosen arm, prior-close exit signal and original identities',()=>{
 const d=tenbagger(),[p]=tenbaggerBrokerPlans(d,'2026-10-22',DATE,'stop12_trail35');assert.equal(p.side,'buy');assert.equal(p.variant,'trend200.stop12_trail35');assert.equal(p.triggerAt,d.records[0].registeredAt);
 for(const changed of [{...d,asOf:'2026-10-21'},{...d,records:[{...d.records[0],registeredDate:'2026-10-21'}]},{...d,records:[{...d.records[0],revisionDates:['2026-10-22']}]}])assert.equal(tenbaggerBrokerPlans(changed,'2026-10-22',DATE,'stop12_trail35').length,0);
 d.records[0].entryDate='2026-10-23';d.asOf=d.source.asOf='2026-10-26';d.records[0].arms.stop12_trail35.exitSignalDate='2026-10-26';
 const [s]=tenbaggerBrokerPlans(d,'2026-10-26','2026-10-27','stop12_trail35');assert.equal(s.side,'sell');assert.equal(positionKey(s),positionKey(p));assert.equal(tenbaggerBrokerPlans(d,'2026-10-26','2026-10-27','hold1260').length,0);
});
test('both closing strategies and the selected tenbagger hypothesis submit buys and exact-owned exits',async()=>{
 for(const kind of ['day','overnight','tenbagger']){
  const strategy=kind==='day'?'gpt_closing30':kind==='overnight'?'gpt_closing_bet':'gpt_tenbagger';
  const h=world(strategy);h.settings.strategies[strategy].enabledSince='2026-10-21T00:00:00Z';
  const p=kind==='tenbagger'?tenbaggerBrokerPlans(tenbagger(),'2026-10-22',DATE,'stop12_trail35')[0]:closingBrokerPlans(closingLedger,kind,'buy',DATE)[0];
  h.now=Date.parse(p.dueAt)+1000;
  await using(h,async()=>{
   const b=await h.call(p);assert.equal(b.position.operations.buy.status,'accepted',strategy);await h.reconcile();
   const s=kind==='tenbagger'?{...p,side:'sell',sessionDate:'2026-10-26',dueAt:'2026-10-26T06:23:00Z',expiresAt:'2026-10-26T06:27:00Z'}:closingBrokerPlans(closingLedger,kind,'sell',kind==='day'?DATE:'2026-10-26')[0];
   h.now=Date.parse(s.dueAt)+1000;const r=await h.call(s);assert.equal(r.position.operations.sell.status,'accepted',strategy);assert.equal(h.orders[1].qty,h.orders[0].qty);assert.equal(h.orders[1].priceType,'market');assert.equal(h.orders.length,2);
  });
 }
});
test('SOXL plan tracks USD fills, completed-bar exit decision and exact deadline without BTC substitution',()=>{
 const ms=Date.parse(DATE+'T10:00:00-04:00'),ledger={...source,strategy:'soxl',trades:[{id:'soxl:1000',entryMs:ms,entryPrice:30,signalTime:'09:55',entryTime:'10:00',deadlineMs:ms+90*60000}]};
 const [b]=soxlBrokerPlans(ledger,ms);assert.equal(b.strategy,'gpt_soxl');assert.equal(b.code,'SOXL');assert.equal(b.exitDueAt,toIso(ms+90*60000));
 assert.equal(soxlBrokerPlans({...ledger,strategy:'crypto'},ms).length,0);assert.equal(validateBrokerPlan(b,ms),'');
 const plans=soxlBrokerPlans({...ledger,trades:[{...ledger.trades[0],status:'closed',exitMs:ms+5*60000,reason:'stop'}]},ms+10*60000);assert.equal(plans[1].dueAt,toIso(ms+10*60000));
});
test('OFF/global permission, expired/previous signals and settings failures cannot reach quote/order HTTP',async()=>{
 const h=world();h.settings=defaultPaperSettings();await using(h,async()=>{const r=await h.call(mainPlan());assert.equal(r.position.operations.buy.status,'not_submitted');assert.equal(h.calls.length,0);});
 const old=world();old.settings.strategies.gpt_daytrading.enabledSince=toIso(at(1002));await using(old,async()=>{const r=await old.call(mainPlan());assert.match(r.position.operations.buy.reason,/ON 이전/);assert.equal(old.calls.length,0);});
 const stale=world();stale.now=at(1010);await using(stale,async()=>{const r=await stale.call(mainPlan());assert.equal(r.position.operations.buy.status,'not_submitted');assert.equal(stale.calls.length,0);});
 const down=world();down.env.SIGNAL_STORE.get=()=>({fetch:async()=>{throw Error('settings unavailable');}});await using(down,async()=>{assert.equal((await down.call(mainPlan())).status,503);assert.equal(down.calls.length,0);});
});
test('atomic duplicate claim, durable intent, budget sizing, accepted versus filled and exact-owned sale',async()=>{
 const h=world();await using(h,async()=>{
  const p=mainPlan(),results=await Promise.all([h.call(p),h.call(p)]);assert.equal(h.orders.length,1);assert.ok(results.some(r=>r.duplicate));assert.equal(h.orders[0].qty,194);
  let row=await h.st.get(positionKey(p));assert.equal(row.operations.buy.status,'accepted');assert.equal(row.operations.buy.fillQty,undefined);
  await h.reconcile();row=await h.st.get(positionKey(p));assert.equal(row.operations.buy.status,'filled');assert.equal(row.operations.buy.fillQty,194);
  h.now=at(1011);const sell={...p,side:'sell',dueAt:toIso(at(1011)),expiresAt:toIso(at(1013))};assert.equal((await h.call(sell)).ok,true);assert.equal(h.orders[1].qty,194);assert.equal(h.orders[1].side,'sell');
  await h.reconcile();row=await h.st.get(positionKey(p));const [view]=brokerRecords([row]);assert.equal(view.status,'closed');assert.equal(view.pnl,null);assert.equal(view.broker.heldQty,0);assert.equal(view.broker.grossRealized,388);assert.equal(view.broker.fees,null);assert.equal(view.broker.settlement,'fills_confirmed_fees_unknown');
  assert.equal(uniqueRecords([view])[0].broker.filledBuyQty,194);assert.match(recordsCsv([view]),/fills_confirmed_fees_unknown/);
 });
});
test('intent storage failure sends nothing; lost result/rejected POST never auto-reorders',async()=>{
 for(const phase of ['intent','result']){
  const h=world();h.st[phase==='intent'?'failIntent':'failResult']=true;await using(h,async()=>{
   const r=await h.call(mainPlan());assert.equal(r.status,503);assert.equal(h.orders.length,phase==='intent'?0:1);
   h.st.failIntent=h.st.failResult=false;const again=await h.call(mainPlan());if(phase==='result'){assert.equal(again.duplicate,true);assert.equal(again.position.operations.buy.status,'unverified');assert.equal(h.orders.length,1);}
  });
 }
 for(const mode of ['unknown','rejected']){const h=world('gpt_daytrading',{mode});await using(h,async()=>{const a=await h.call(mainPlan());assert.equal(a.position.operations.buy.status,mode==='unknown'?'unverified':'rejected');await h.call(mainPlan());assert.equal(h.orders.length,1);assert.equal(brokerRecords([a.position])[0].pnl,null);});}
});
test('an accepted receipt still reconciles and exits if the post-order index update fails',async()=>{
 const h=world();h.st.breakTrackingAfterResult=true;await using(h,async()=>{
  const p=mainPlan();assert.equal((await h.call(p)).status,503);assert.equal(h.orders.length,1);
  assert.ok((await h.st.get('pending')).includes(positionKey(p)));assert.ok((await h.st.get('watch')).includes(positionKey(p)));
  h.st.breakTrackingAfterResult=false;await h.reconcile();assert.equal((await h.st.get(positionKey(p))).operations.buy.status,'filled');
  h.now=at(1510);await h.reconcile();assert.equal(h.orders.length,2);assert.equal(h.orders[1].side,'sell');
 });
});
test('settings change while preparing an order stops before intent/order; missing buy cannot sell account shares',async()=>{
 const h=world();h.quoteHook=()=>h.settings=changePaperSettings(h.settings,{allOff:true,expectedRevision:h.settings.revision});await using(h,async()=>{const r=await h.call(mainPlan());assert.equal(r.position.operations.buy.status,'not_submitted');assert.equal(h.orders.length,0);});
 const noBuy=world();await using(noBuy,async()=>{const r=await noBuy.call({...mainPlan(),side:'sell'});assert.match(r.position.operations.sell.reason,/매수 주문 없음/);assert.equal(noBuy.calls.length,0);});
});
test('a new signal cannot add another budget to an unresolved holding of the same strategy and symbol',async()=>{
 const h=world();await using(h,async()=>{const p=mainPlan();await h.call(p);const r=await h.call({...p,sourceId:'different-signal'});assert.equal(h.orders.length,1);assert.match(r.position.operations.buy.reason,/기존 보유\/주문/);});
});
test('SOXL converts KRW budget using recorded live FX, cancels outstanding buy before selling only confirmed partial fill',async()=>{
 const h=world('gpt_soxl',{now:Date.parse(DATE+'T10:00:00-04:00'),noFill:true});
 const p={...mainPlan(),strategy:'gpt_soxl',code:'SOXL',sourceId:'soxl:1000',dueAt:toIso(h.now),expiresAt:toIso(h.now+6*60000),exitDueAt:toIso(h.now+90*60000)};
 await using(h,async()=>{
  await h.call(p);assert.equal(h.orders[0].priceType,'limit');assert.equal(h.orders[0].price,30.15);assert.equal(h.orders[0].qty,47);
  const own=h.fills.get('1001');own.fillQty=7;own.fillAmount=700;own.remainingQty=40;
  h.now+=60000;const r=await h.call({...p,side:'sell',dueAt:toIso(h.now),expiresAt:toIso(h.now+180000)});assert.equal(r.ok,true);
  const actions=h.calls.map(x=>x.action);assert.equal(actions.filter(x=>x==='cancel').length,1);assert.ok(actions.indexOf('cancel')<actions.lastIndexOf('order'));
  assert.equal(h.orders[1].qty,7);assert.equal(h.orders[1].price,29.85);assert.equal(r.position.operations.cancel_buy.status,'accepted');
 });
});
test('unknown cancellation or missing order evidence prevents sale and does not retry cancellation',async()=>{
 const h=world('gpt_soxl',{now:Date.parse(DATE+'T10:00:00-04:00'),noFill:true,cancelUnknown:true});const p={...mainPlan(),strategy:'gpt_soxl',code:'SOXL',sourceId:'s',dueAt:toIso(h.now),expiresAt:toIso(h.now+360000),exitDueAt:toIso(h.now+5400000)};
 await using(h,async()=>{await h.call(p);h.now+=60000;const s={...p,side:'sell',dueAt:toIso(h.now),expiresAt:toIso(h.now+180000)};assert.equal((await h.call(s)).status,503);assert.equal((await h.call(s)).status,503);assert.equal(h.orders.length,1);assert.equal(h.calls.filter(x=>x.action==='cancel').length,1);});
 assert.throws(()=>exactOrderFill({orderNo:'1',orderDate:DATE,qty:5},[{orderNo:'2',orderDate:DATE,code:'005930',sideCode:'02',fillQty:5,fillPrice:1}],'005930','buy'));
});
test('broker deadline driver exits owned holdings even without another market-data signal',async()=>{
 const h=world();await using(h,async()=>{const p=mainPlan();await h.call(p);await h.reconcile();
  for(let i=0;i<10;i++)await h.st.put('old'+i,{...await h.st.get(positionKey(p)),plan:{...p,exitDueAt:null},operations:{buy:{orderNo:'missing'+i,status:'accepted',orderDate:DATE,qty:1}},events:[]});
  await h.st.put('pending',Array.from({length:10},(_,i)=>'old'+i));
  h.now=at(1510);await h.reconcile();assert.equal(h.orders.length,2);assert.equal(h.orders[1].side,'sell');assert.equal(h.orders[1].plan.source.reason,'broker_session_deadline');});
});
test('opening strategy also uses its durable order IDs, excluding simultaneous manual/other strategy fills',()=>{
 const signal={code:'005930',entryTime:907},refs=openingOrderRefs(DATE,[signal],[signal]);const ledger={date:DATE,executionEvents:[{id:'i',phase:'intent',date:DATE,requests:refs},{id:'i:result',attemptId:'i',phase:'result',receipts:refs.map((r,i)=>({...r,status:'accepted',orderNo:String(10+i)}))}]};
 const rows=[{orderNo:'10',code:'005930',sideCode:'02',orderDate:DATE,fillQty:7,remainingQty:0},{orderNo:'11',code:'005930',sideCode:'01',orderDate:DATE,fillQty:2,remainingQty:0},{orderNo:'12',code:'005930',sideCode:'02',orderDate:DATE,fillQty:10000,remainingQty:0}];
 assert.deepEqual(openingOwnedQty(ledger,signal,rows),{qty:5,buyQty:7,soldQty:2,error:''});assert.throws(()=>openingOwnedQty(ledger,signal,rows.slice(1)));assert.throws(()=>openingOwnedQty(ledger,signal,[{...rows[0],remainingQty:2},rows[1]]));
});
const credentials={AUTOTRADE_KEY:'fixture',KIS_ENV:'real',KIS_REAL_APPKEY:'real-never-use',KIS_REAL_APPSECRET:'real-never-use',KIS_REAL_ACCOUNT:'99999999-01',KIS_VTS_APPKEY:'research-fixture',KIS_VTS_APPSECRET:'research-secret',KIS_VTS_ACCOUNT_KR:'12345678-01',KIS_VTS_ACCOUNT_US:'87654321-01'};
test('relay refuses anonymous/BTC/OFF before any broker call and validates immutable market/order type',async()=>{
 const h=world();await using(h,async()=>{
  const request=(body,auth=true)=>new Request('https://app/api/research-kis',{method:'POST',headers:auth?{'x-monitor-key':'fixture'}:{},body:JSON.stringify(body)});
  assert.equal((await relay({request:request({action:'order',plan:mainPlan()},false),env:credentials})).status,401);
  assert.equal((await relay({request:request({action:'order',plan:{...mainPlan(),strategy:'gpt_crypto',code:'KRW-BTC'}}),env:credentials})).status,400);assert.equal(h.calls.length,0);
  const prev=globalThis.fetch;globalThis.fetch=async()=>Response.json({ok:true,settings:defaultPaperSettings()});
  assert.equal((await relay({request:request({action:'order',plan:mainPlan(),settingsRevision:0}),env:credentials})).status,409);globalThis.fetch=prev;
 });
});
test('real-default environment still sends only vts host/account; SOXL cancel uses official VTTT1004U once',async()=>{
 const h=world(),calls=[];_resetTokenForTest();await using(h,async()=>{
  globalThis.fetch=async(input,init={})=>{
   const u=String(input);if(u.includes('/paper-settings'))return Response.json({ok:true,settings:h.settings});
   if(u.includes('/kis-token'))return Response.json({ok:true,token:null});
   assert.match(u,/^https:\/\/openapivts\.koreainvestment\.com:29443\//);const b=JSON.parse(init.body||'{}');calls.push({url:u,body:b,headers:init.headers});
   if(u.includes('/oauth2/tokenP'))return Response.json({access_token:'research-fixture-token-12345678901234567890',expires_in:86400});
   if(u.includes('/hashkey'))return Response.json({HASH:'fixture'});
   return Response.json({rt_cd:'0',output:{ODNO:'1001'},msg1:'접수'});
  };
  const req=new Request('https://app/api/research-kis',{method:'POST',headers:{'x-monitor-key':'fixture'},body:JSON.stringify({action:'order',plan:mainPlan(),side:'buy',qty:2,price:0,priceType:'market',market:'KRX',settingsRevision:h.settings.revision,env:'real'})});
  const r=await relay({request:req,env:credentials});assert.equal(r.status,200);let order=calls.find(x=>x.url.includes('/order-cash'));assert.equal(order.body.CANO,'12345678');assert.equal(order.headers.tr_id,'VTTC0802U');
  const c=await cancelSoxlVts(credentials,{code:'SOXL',orderNo:'1001',qty:2,market:'AMEX'});assert.equal(c.status,200);order=calls.find(x=>x.url.includes('order-rvsecncl'));assert.equal(order.body.CANO,'87654321');assert.equal(order.body.ORGN_ODNO,'1001');assert.equal(order.body.RVSE_CNCL_DVSN_CD,'02');assert.equal(order.headers.tr_id,'VTTT1004U');assert.equal(calls.filter(x=>x.url.includes('order-rvsecncl')).length,1);
  assert.equal(researchVtsConnections(credentials).us.ready,true);
 });_resetTokenForTest();
});
test('owner history and worker relay remain authenticated; historical refresh never calls the broker',async()=>{
 const src=read('worker/opening-scheduler/src/index.js').replace('import { DurableObject } from "cloudflare:workers";','class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}').replaceAll('../../../functions/api/',new URL('../functions/api/',import.meta.url).href);
 const w=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
 assert.equal(w.scheduleRoute(at(1523)),'research_close');assert.equal(w.scheduleRoute(Date.parse('2026-10-24T15:23:00+09:00')),null);
 for(const path of ['research-execute','research-reconcile','research-history'])assert.equal((await w.default.fetch(new Request('https://worker/'+path),{MONITOR_KEY:'fixture'})).status,401);
 const status=new Request('https://worker/broker-status',{headers:{'x-monitor-key':'fixture'}});assert.equal((await (await w.default.fetch(status,{MONITOR_KEY:'fixture'})).json()).version,'research_kis_vts_v1');
 const global=read('worker/global-intraday-scheduler/src/index.js'),refresh=global.split('async function refreshPaper(')[1].split('\nasync function run(')[0];assert.doesNotMatch(refresh,/sendResearchPlans|reconcileResearchBroker/);
 assert.match(read('functions/api/trade-history.js'),/brokerRecords/);assert.match(read('trade-history-ui.js'),/부분체결/);assert.match(read('settings-paper-trading.js'),/paper_arm_/);
});
test('history counts fully closed broker trades without inventing net PnL; canceled zero-fill entries stay unfilled',async()=>{
 const p={key:'broker:closed',date:DATE,plan:{...mainPlan(),strategy:'gpt_closing_bet'},operations:{buy:{status:'filled',fillQty:7,fillPrice:100},sell:{status:'filled',fillQty:7,fillPrice:102}},events:[]};
 const h=world();h.fetch=async input=>{
  const u=String(input);if(u.includes('identitytoolkit'))return Response.json({users:[{email:'jk82investing@gmail.com'}]});
  if(u.includes('/research-history?'))return Response.json({ok:true,positions:[p]});
  return Response.json({ok:true,ledgers:[],sourceWarnings:[]});
 };
 await using(h,async()=>{const r=await historyGet({request:new Request('https://app/api/trade-history?strategy=closing_bet&from='+DATE+'&to='+DATE,{headers:{Authorization:'Bearer fixture'}}),env:{AUTOTRADE_KEY:'fixture'}}),j=await r.json();assert.equal(j.total,1);assert.equal(j.summary.closed,1);assert.equal(j.trades[0].pnl,null);assert.equal(j.sourceWarnings.length,0);});
 const [canceled]=brokerRecords([{...p,operations:{buy:{status:'canceled',fillQty:0},sell:{}}}]);assert.equal(canceled.status,'signal');assert.equal(canceled.broker.heldQty,0);assert.equal(canceled.pnl,null);
});
test('value mutations fail for OFF bypass, lost durable intent, duplicate replay, wrong order ownership and false settlement',async()=>{
 const src=read('functions/api/_research-broker.js').replaceAll("'./_paper-trading.js'",JSON.stringify(new URL('../functions/api/_paper-trading.js',import.meta.url).href)).replaceAll("'./_research-orders.js'",JSON.stringify(new URL('../functions/api/_research-orders.js',import.meta.url).href));
 const mutate=async(a,b)=>{assert.ok(src.includes(a));return import('data:text/javascript;base64,'+Buffer.from(src.replace(a,b)).toString('base64'));};
 const off=await mutate("if(!conf.enabled)return '전략 모의투자 OFF';","if(false)return '전략 모의투자 OFF';"),h=world();h.settings.strategies.gpt_daytrading.enabled=false;
 await using(h,async()=>{await h.call(mainPlan(),off.researchBroker);assert.equal(h.orders.length,1,'mutant bypasses OFF');});
 const lost=await mutate('await remember(tx,key,row);','/* intent lost */');const l=world();await using(l,async()=>{const r=await l.call(mainPlan(),lost.researchBroker);assert.equal(r.status,503);assert.equal(l.orders.length,0,'HTTP fixture catches missing durable intent');assert.equal(l.calls.filter(x=>x.action==='order').length,1);});
 const ownership=await mutate('orderId(x.orderNo)===orderId(op.orderNo)','true');const op={orderNo:'1',orderDate:DATE,qty:7},rows=[{orderNo:'2',orderDate:DATE,code:'005930',sideCode:'02',fillQty:7,fillPrice:1,remainingQty:0}];assert.throws(()=>exactOrderFill(op,rows,'005930','buy'));assert.equal(ownership.exactOrderFill(op,rows,'005930','buy').fillQty,7);
 const duplicate=await import('data:text/javascript;base64,'+Buffer.from(src.replace('if(row?.operations[p.side])return {ok:true,duplicate:true,position:row};','if(false)return {ok:true,duplicate:true,position:row};').replace('if(row?.operations[p.side])return {claimed:false,position:row};','if(false)return {claimed:false,position:row};')).toString('base64'));
 const d=world();await using(d,async()=>{await d.call(mainPlan(),duplicate.researchBroker);await d.call(mainPlan(),duplicate.researchBroker);assert.equal(d.orders.length,2,'mutant replays a claimed order');});
 const deadline=await mutate('if(deadline>0&&now>=deadline&&now<=deadline+120000&&!p.operations.sell)','if(false)');const late=world();await using(late,async()=>{await late.call(mainPlan());await late.reconcile();late.now=at(1510);await late.reconcile(deadline.researchBroker);assert.equal(late.orders.length,1,'mutant loses mandatory broker exit');});
 const noFx=await mutate('Math.floor(conf.budget/fx.rate/price)','Math.floor(conf.budget/price)'),usd=world('gpt_soxl',{now:Date.parse(DATE+'T10:00:00-04:00')});
 await using(usd,async()=>{await usd.call({...mainPlan(),strategy:'gpt_soxl',code:'SOXL',sourceId:'usd',dueAt:toIso(usd.now),expiresAt:toIso(usd.now+360000),exitDueAt:toIso(usd.now+5400000)},noFx.researchBroker);assert.equal(usd.orders[0].qty,66334,'mutant wrongly spends KRW as USD');});
 const plans=read('functions/api/_research-orders.js'),stale=await import('data:text/javascript;base64,'+Buffer.from(plans.replace('if(now<due||now>expires)','if(false)')).toString('base64'));assert.notEqual(validateBrokerPlan(mainPlan(),at(1006)),'');assert.equal(stale.validateBrokerPlan(mainPlan(),at(1006)),'');
 const model=read('functions/api/_trade-history.js').replaceAll("'./_closing30.js'",JSON.stringify(new URL('../functions/api/_closing30.js',import.meta.url).href)).replaceAll("'./_opening-execution.js'",JSON.stringify(new URL('../functions/api/_opening-execution.js',import.meta.url).href));
 const bad=await import('data:text/javascript;base64,'+Buffer.from(model.replace("settlement:done?'fills_confirmed_fees_unknown':'unverified',pnl:null","settlement:'fills_confirmed_fees_unknown',pnl:0")).toString('base64'));
 const position={key:'p',date:DATE,plan:mainPlan(),operations:{buy:{status:'accepted'}},events:[]};assert.equal(brokerRecords([position])[0].broker.pnl,null);assert.equal(bad.brokerRecords([position])[0].broker.pnl,0);
});
