import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {closingRows,closingMainVariant,generatedClosingVariant,chooseClosingSignals} from '../functions/api/_closing30.js';
import {closingResult,closingDaily,readClosingLedgers} from '../functions/api/_closing30-results.js';
import {closingBrokerPlans} from '../functions/api/_research-orders.js';
import {closingRecords} from '../functions/api/_trade-history.js';
import {normalize,CATALOG} from '../functions/api/scalping-shadow-ranking.js';
import {autoPromotionDecision,effectiveFrom} from '../functions/api/scalping-auto-promotion.js';
import {summarizeClosingLedger} from '../functions/api/scalping-live-results.js';
import {closingComparison} from '../functions/api/scalping-duel.js';
const date='2026-10-23',at=(s='16:00',d=date)=>Date.parse(d+'T'+s+':00+09:00');
const event=(kind,stage,variant='baseline',extra={})=>({id:[date,kind,variant,'005930',stage].join(':'),kind,stage,variant,code:'005930',name:'삼성전자',date,
 targetHm:stage==='sell'&&kind==='overnight'?906:stage==='signal'?(kind==='day'?1506:1522):1540,
 price:stage==='buy'?100:stage==='sell'?102:null,pnl:stage==='sell'?1.77:null,
 createdAt:(kind==='overnight'&&stage==='sell'?'2026-10-26T00:06:00Z':'2026-10-23T06:40:00Z'),...extra});
const ledger=(kind='day',variant='baseline',stages=['signal','buy','sell'])=>({date,closingMains:{[kind]:variant},scans:[{targetHm:kind==='day'?1506:1522,capturedAt:'2026-10-23T06:22:00Z',partial:false,quoteErrors:0,failed:[]}],
 events:stages.map(s=>event(kind,s,variant)).sort((a,b)=>a.targetHm-b.targetHm)});
test('next-day 09:06 sell sorted before its buy still settles, with original timestamps and nulls preserved',()=>{
 const l=ledger('overnight'),before=JSON.stringify(l),rows=closingRows(l);
 assert.equal(rows[0].status,'closed');assert.equal(rows[0].pnl,1.77);
 assert.equal(rows[0].exitTime,'2026-10-26T00:06:00Z');assert.equal(JSON.stringify(l),before);
 l.events.find(x=>x.stage==='sell').pnl=null;assert.equal(closingRows(l)[0].status,'unverified');
});
test('main and ten shadows keep independent history roles and fixed three-slot account return',()=>{
 const l=ledger('day','dip_2');l.events.push(...ledger().events);
 const r=closingResult(l,'day',at());assert.equal(r.trades,1);assert.equal(r.returnPct,.59);assert.equal(r.finalized,true);
 const records=closingRecords(l);assert.equal(records.find(x=>x.variant==='dip_2').role,'main');assert.equal(records.find(x=>x.variant==='baseline').role,'shadow');
 assert.equal(closingMainVariant({date},'day'),'baseline');
 assert.equal(closingDaily([l],'closing30',at())[0].returnPct,r.returnPct);
});
test('no signal only with successful kind-specific scan; missing, partial and unknown exit never create zero',()=>{
 const l=ledger('day','baseline',[]);assert.equal(closingResult(l,'day',at()).returnPct,0);
 assert.equal(closingResult({...l,scans:[]},'day',at()).noTrade,false);
 assert.equal(closingResult({...l,scans:[{targetHm:1506,partial:true}]},'day',at()).returnPct,null);
 const held=ledger('day','baseline',['signal','buy']);assert.equal(closingResult(held,'day',at()).state,'unavailable');
 assert.equal(closingDaily([held],'closing30',at()).length,0);
 const overnight=ledger('overnight','baseline',['signal','buy']);assert.equal(closingResult(overnight,'overnight',at()).state,'holding');
 assert.equal(closingResult(overnight,'overnight',at('09:07','2026-10-26')).returnPct,null);
 assert.equal(closingResult(overnight,'overnight',at('09:07','2026-10-26')).state,'unavailable');
});
test('live endpoint projection includes schedules, holidays, correct session date and same settlement',()=>{
 assert.equal(summarizeClosingLedger('closing30',null,at('15:00')).state,'scheduled');
 assert.equal(summarizeClosingLedger('closing30',ledger(),at()).returnPct,.59);
 assert.equal(summarizeClosingLedger('closing30',{...ledger(),date:'2026-10-22'},at()).returnPct,null);
 assert.equal(summarizeClosingLedger('closing30',null,at('16:00','2026-10-24')).state,'market_closed');
});
test('broker plan consumes only the session-locked main and keeps paper signal identity',()=>{
 for(const kind of ['day','overnight'])for(const side of ['buy','sell']){
  const l=ledger(kind,'dip_2');l.events.push(...ledger(kind).events);
  const plans=closingBrokerPlans(l,kind,side,date,at());assert.equal(plans.length,1);
  assert.equal(plans[0].variant,'dip_2');assert.equal(plans[0].sourceId,kind+':dip_2:005930');
 }
});
test('both closing strategies enter shared ranking and seven distinct-session promotion gate',()=>{
 for(const strategy of ['closing30','closing_bet']){
  assert.equal(CATALOG[strategy].length,10);
  const section={candidates:[{name:'dip_2',trades:60,researchScore:88,sampleReady:true,status:'review',mddOk:true,profitFactorOk:true}],
   lifecycle:{autoPromotionCandidate:'dip_2',leader:{name:'dip_2',consecutiveResearchSessions:7}}};
  assert.equal(normalize(strategy,section).rows[0].name,'dip_2');assert.equal(autoPromotionDecision(strategy,section).ok,true);
  section.lifecycle.leader.consecutiveResearchSessions=6;assert.equal(autoPromotionDecision(strategy,section).ok,false);
  section.lifecycle.leader.consecutiveResearchSessions=7;section.candidates[0].sampleReady=false;assert.equal(autoPromotionDecision(strategy,section).ok,false);
  assert.equal(effectiveFrom(strategy,at('20:00')),'2026-10-26');
 }
});
test('private closing reader rejects partial source coverage and never writes',async()=>{
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(u,opts)=>{calls.push({u:String(u),opts});return Response.json({ok:true,ledgers:[ledger()],sourceWarnings:['missing original']});};
 try{await assert.rejects(readClosingLedgers({AUTOTRADE_KEY:'fixture'},{from:date,to:date}),/missing original/);assert.equal(calls[0].opts.method,undefined);}
 finally{globalThis.fetch=old;}
});
test('closing factory IDs reproduce stable parameters and coexist with baseline/retired observations',()=>{
 assert.deepEqual(generatedClosingVariant('cf_g0004'),{id:'cf_g0004',label:'자동생성 cf_g0004',side:'up',threshold:1,volume:0});
 assert.equal(generatedClosingVariant('cf_g0003').threshold,-1);assert.equal(generatedClosingVariant('__proto__'),null);
 const rules=[generatedClosingVariant('cf_g0003'),generatedClosingVariant('cf_g0004')];
 const xs=chooseClosingSignals([{code:'005930',name:'삼성전자',feature:{intradayPct:-2,liquidity:10,volumeRatio:2}}],'day',3,rules);
 assert.equal(xs.length,1);assert.equal(xs[0].variant,'cf_g0003');assert.equal(xs[0].strategyParams.threshold,-1);
});
test('closing duel compares completed main originals at fixed slots without altering four-tab total',()=>{
 const cr=[{date,ledger:{events:[{id:'close:close30',payload:{date,status:'closed',trades:[{entryPrice:100,exitPrice:101}]}}]}}];
 const x=closingComparison(cr,{operationalSessions:[{date,trades:[{entryPrice:100,exitPrice:102}]}]});
 assert.equal(x.days.length,1);assert.ok(Math.abs(x.days[0].gpt.pnlPct-1.75/3)<1e-8);
 assert.ok(Math.abs(x.days[0].claude.pnlPct-.85)<1e-8);assert.equal(x.record.claude,1);
 assert.equal(closingComparison(cr,{operationalSessions:[]}).days.length,0);
});
test('screenshot parity: cumulative table and automatic analysis actually render all six strategies',()=>{
 const ui=fs.readFileSync(new URL('../scalping.html',import.meta.url),'utf8');
 const take=name=>{const start=ui.indexOf('function '+name+'(');const end=ui.slice(start+1).search(/\n(?:async )?function /);return ui.slice(start,start+1+end);};
 const names=['opening','daytrading','crypto','soxl','closing30','closing_bet'];
 const table={innerHTML:''},auto={innerHTML:''},meta={textContent:''};
 const c={SCORE_CACHE:Object.fromEntries(names.map(n=>[n,{trades:2,winRate:50,avgPnl:.3,required:40,edge:10,progress:'원본'}])),
  SHADOW_RANK_CACHE:{generatedAt:'fixture',rankings:Object.fromEntries(names.map(n=>[n,{rows:[{name:'dip_2',researchScore:80}],shadowCount:10,lifecycle:{leader:{name:'dip_2',consecutiveResearchSessions:2}}}]))},
  PROMOTION_STATE:{},$:id=>id==='strategy_overview_body'?table:id==='daily_auto_improve_body'?auto:meta,esc:String,scalpingKstStamp:String,
  selectedMainVariant:()=> 'baseline',pendingMainVariant:()=>null,shadowLabel:(_k,n)=>n};
 vm.createContext(c);vm.runInContext(take('renderStrategyOverview')+'\n'+take('renderDailyAutoImprove')+'\nrenderStrategyOverview();renderDailyAutoImprove();',c);
 assert.equal((table.innerHTML.match(/<tr>/g)||[]).length,7);
 assert.equal((auto.innerHTML.match(/class="auto-improve-card"/g)||[]).length,6);
 assert.match(table.innerHTML,/종가 30분/);assert.match(table.innerHTML,/개별 종목 종가 베팅/);
 const old=take('renderStrategyOverview').replace("'soxl','closing30','closing_bet'","'soxl'");
 vm.runInContext(old+'\nrenderStrategyOverview();',c);assert.notEqual((table.innerHTML.match(/<tr>/g)||[]).length,7);
});
const workerSource=fs.readFileSync(new URL('../worker/opening-scheduler/src/index.js',import.meta.url),'utf8');
const loadWorker=src=>import('data:text/javascript;base64,'+Buffer.from(src.replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {constructor(ctx,env){this.ctx=ctx;this.env=env;}};')
 .replaceAll('../../../functions/api/',new URL('../functions/api/',import.meta.url).href)+'\nexport {closingAlert,closingApi,runClosing30,appendLedger,readLedger};').toString('base64'));
function world(module){
 const data=new Map();const env={MONITOR_KEY:'fixture',SIGNAL_STORE:{idFromName:x=>x,get(id){
  if(!data.has(id)){const rows=new Map(),storage={get:async k=>structuredClone(rows.get(k)),put:async(k,v)=>rows.set(k,structuredClone(v))};data.set(id,new module.OpeningSignalStore({storage},env));}
  return {fetch:(url,init)=>data.get(id).fetch(url instanceof Request?url:new Request(url,init))};
 }}};return env;
}
test('session locks each closing main independently; later config never relabels original trades',async()=>{
 const m=await loadWorker(workerSource),env=world(m);
 await m.appendLedger(env,{date,targetHm:1506,scanId:'day',closingMains:{day:'dip_2'},events:[event('day','signal','dip_2')]},'closing30');
 await m.appendLedger(env,{date,targetHm:1522,scanId:'night',closingMains:{overnight:'momentum',day:'dip_3'},events:[event('overnight','signal','momentum')]},'closing30');
 const l=await m.readLedger(env,date,'closing30');assert.deepEqual(l.closingMains,{day:'dip_2',overnight:'momentum'});
 const response=await m.default.fetch(new Request('https://worker/config?strategy=closing30',{headers:{'x-monitor-key':'fixture'}}),env);
 assert.equal((await response.json()).config.selectedVariant,'baseline');
 assert.equal((await m.default.fetch(new Request('https://worker/config?strategy=closing30'),env)).status,401);
 const req=(strategy,variant)=>new Request('https://worker/config?strategy='+strategy,{method:'POST',headers:{'x-monitor-key':'fixture','content-type':'application/json'},body:JSON.stringify({variant,effectiveFrom:'2026-10-26'})});
 await m.default.fetch(req('closing30','dip_3'),env);
 const night=await m.default.fetch(new Request('https://worker/config?strategy=closing_bet',{headers:{'x-monitor-key':'fixture'}}),env);
 assert.equal((await night.json()).config.selectedVariant,'baseline');assert.deepEqual((await m.readLedger(env,date,'closing30')).closingMains,l.closingMains);
 assert.equal((await m.default.fetch(req('closing30','__proto__'),env)).status,400);
});
test('promoted main alone sends alerts, retains closing subtype and suppresses shadow baseline',async()=>{
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(u,o)=>{calls.push(JSON.parse(o.body));return Response.json({ok:true});};
 try{const m=await loadWorker(workerSource);await m.closingAlert({MONITOR_KEY:'fixture'},date,{...event('day','buy','dip_2'),mainVariant:'dip_2'},'buy');
  await m.closingAlert({MONITOR_KEY:'fixture'},date,{...event('day','buy'),mainVariant:'dip_2'},'buy');
  assert.equal(calls.length,1);assert.equal(calls[0].kind,'day');assert.match(calls[0].eventId,/:dip_2:/);
 }finally{globalThis.fetch=old;}
});
test('critical mutants are caught by settlement, main-only order and alert values',async()=>{
 const source=fs.readFileSync(new URL('../functions/api/_closing30.js',import.meta.url),'utf8');
 const bad=await import('data:text/javascript;base64,'+Buffer.from(source.replace("for(const stage of ['signal','buy','sell'])","for(const stage of ['sell','signal','buy'])")).toString('base64'));
 assert.notEqual(bad.closingRows(ledger('overnight'))[0].status,'closed');
 const orders=fs.readFileSync(new URL('../functions/api/_research-orders.js',import.meta.url),'utf8');
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(orders.replace("x.variant===String(ledger.closingMains?.[kind]||'baseline')","x.variant==='baseline'")).toString('base64'));
 assert.equal(mutant.closingBrokerPlans(ledger('day','dip_2'),'day','buy',date,at()).length,0);
 const m=await loadWorker(workerSource.replace('if(e.variant!==String(e.mainVariant||"baseline"))return;','if(e.variant!=="baseline")return;'));
 const old=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;return Response.json({ok:true});};
 try{await m.closingAlert({MONITOR_KEY:'fixture'},date,{...event('day','buy','dip_2'),mainVariant:'dip_2'},'buy');assert.equal(count,0);}finally{globalThis.fetch=old;}
});

test('source 500 retries only GET once; authentication errors and failed sources never submit orders',async()=>{
 const m=await loadWorker(workerSource),old=globalThis.fetch;let calls=[];
 globalThis.fetch=async(u,init)=>{calls.push({u:String(u),init});return calls.length===1?Response.json({error:'source down'},{status:500}):Response.json({ok:true,signals:[]});};
 try{
  assert.equal((await m.closingApi({MONITOR_KEY:'fixture'},{op:'scan',kind:'day',date})).ok,true);assert.equal(calls.length,2);
  assert(calls.every(x=>x.init.method===undefined&&x.u.includes('/api/closing30-monitor?')));
  calls=[];globalThis.fetch=async(u,init)=>{calls.push({u,init});return Response.json({error:'unauthorized'},{status:401});};
  await assert.rejects(m.closingApi({MONITOR_KEY:'fixture'},{op:'scan',kind:'day',date}),/unauthorized/);assert.equal(calls.length,1);
  globalThis.fetch=async()=>Response.json({error:'source down'},{status:500});
  const env=world(m),oldNow=Date.now;Date.now=()=>at('15:06');
  try{await assert.rejects(m.runClosing30('closing_day_signal',{scheduledTime:at('15:06')},env),/source down/);}finally{Date.now=oldNow;}
  const l=await m.readLedger(env,date,'closing30');assert.equal(l.scans[0].partial,true);assert.equal(l.events.length,0);
  assert.equal(closingResult(l,'day',at()).returnPct,null);
 }finally{globalThis.fetch=old;}
});
