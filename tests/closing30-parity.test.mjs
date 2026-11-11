import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {closingDaySummary,flattenClosingLedger,closingCoverage} from '../functions/api/_closing30-ledger.js';
import {summarizeClosingLedger,sessionClock} from '../functions/api/scalping-live-results.js';
import {closingSessions} from '../functions/api/scalping-daily-results.js';
import {closingResearchVariants} from '../functions/api/_closing30.js';
import {closingOutcomes} from '../functions/api/_closing30-outcomes.js';
import {readSignalLedger,writeSignalLedger} from '../functions/api/_closing30-storage.js';
import {closingRecords} from '../functions/api/_trade-history.js';
import {normalize} from '../functions/api/scalping-shadow-ranking.js';
import {autoPromotionDecision,effectiveFrom} from '../functions/api/scalping-auto-promotion.js';

const date='2026-11-10',at=hm=>date+'T'+hm+':00+09:00';
const event=(stage,variant='baseline',kind='day',price=null,pnl=null)=>({date,kind,variant,code:'005930',name:'삼성전자',
  stage,price,pnl,createdAt:at(stage==='signal'?'15:06':stage==='buy'?'15:07':'15:40'),
  priceAt:stage==='buy'?at('15:06'):stage==='sell'?at('15:30'):null,
  signal:{signalTime:date+' 15:04',gapPct:1,volume:100,turnover:10000,reason:'dip condition'},
  strategyParams:{maxTrades:3,frictionPct:.23},strategyVersion:'close30-paper-v1'});
function ledger(events=[],extra={}){return {date,updatedAt:at('15:40'),events,
  scans:[1506,1522,1540].map(targetHm=>({targetHm,partial:false,failed:[],quoteErrors:0})),...extra};}
const closed=(variant='baseline',pnl=.77)=>[event('signal',variant),event('buy',variant,'day',100),event('sell',variant,'day',101,pnl)];

test('closing uses the locked paper main, fixed cash slots and original version/params',()=>{
  const l=ledger([...closed('baseline',9),...closed('dip_2',-.23)],{paperMainVariants:{day:'dip_2'}});
  const frozen=JSON.stringify(l),s=closingDaySummary(l,'closing30');
  assert.equal(s.trades,1);assert.equal(s.slots,3);assert.equal(s.returnPct,-.23/3);assert.equal(s.mainVariant,'dip_2');
  assert.equal(s.finalized,true);assert.equal(s.positions[0].strategyVersion,'close30-paper-v1');
  assert.deepEqual(s.positions[0].strategyParams,{maxTrades:3,frictionPct:.23});
  assert.equal(s.positions[0].entryTime,at('15:06'));assert.equal(JSON.stringify(l),frozen);
  assert.equal(flattenClosingLedger(l).length,2);
  const history=closingRecords(l),main=history.find(x=>x.role==='main');
  assert.equal(main.variant,'dip_2');assert.equal(main.signalTime,date+' 15:04');assert.equal(main.pnl,-.23);
  assert.deepEqual(main.strategyParams,s.positions[0].strategyParams);
});
test('missing scan, failed/partial source and pending fills never become zero/no-trade',()=>{
  for(const change of [l=>l.scans.splice(0,1),l=>l.scans[0].partial=true,l=>l.scans[0].quoteErrors=1,l=>l.scans.splice(2,1)]){
    const l=ledger();change(l);const s=closingDaySummary(l,'closing30');
    assert.equal(s.returnPct,null);assert.equal(s.noTrade,false);assert.equal(s.finalized,false);
  }
  assert.equal(closingDaySummary(ledger(),'closing30').returnPct,0);
  assert.equal(closingDaySummary(ledger(),'closing30').noTrade,true);
  for(const events of [[event('signal')],[event('signal'),event('buy','baseline','day',100)]]){
    assert.equal(closingDaySummary(ledger(events),'closing30').returnPct,null);
  }
  const invalid=ledger(closed());invalid.events.at(-1).pnl=null;
  assert.equal(closingDaySummary(invalid,'closing30').returnPct,null);
});
test('live closing clocks, holidays, before scan and overnight holdings stay explicit',()=>{
  assert.equal(sessionClock('closing30',Date.parse(at('15:05'))).before,true);
  assert.equal(summarizeClosingLedger('closing30',null,Date.parse(at('14:00'))).state,'scheduled');
  assert.equal(summarizeClosingLedger('closing30',null,Date.parse(at('15:07'))).state,'unavailable');
  const l=ledger(closed());const r=summarizeClosingLedger('closing30',l,Date.parse(at('15:40')));
  assert.equal(r.state,'closed');assert.equal(r.returnPct,.77/3);assert.equal(r.finalized,true);
  const held=ledger([event('signal','baseline','overnight'),event('buy','baseline','overnight',100)]);
  const h=summarizeClosingLedger('closing_bet',held,Date.parse(at('16:00')));
  assert.equal(h.state,'holding');assert.equal(h.returnPct,null);assert.equal(h.noTrade,false);
  assert.equal(summarizeClosingLedger('closing30',null,Date.parse('2026-11-14T15:40:00+09:00')).state,'market_closed');
  const carry=summarizeClosingLedger('closing_bet',held,Date.parse('2026-11-11T08:00:00+09:00'));
  assert.equal(carry.state,'holding');assert.equal(carry.originDate,date);assert.equal(carry.returnPct,null);
  const overdue=summarizeClosingLedger('closing_bet',held,Date.parse('2026-11-11T09:07:00+09:00'));
  assert.equal(overdue.state,'unavailable');assert.equal(overdue.noTrade,false);
});
test('completed result reader uses one read per date for both kinds, isolates missing sources',async()=>{
  const old=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{calls.push(String(url));assert.equal(init.headers['x-monitor-key'],'fixture');
    const d=new URL(url).searchParams.get('date');if(d!==date)throw Error('unavailable');return Response.json({ok:true,ledger:ledger(closed())});};
  try{const r=await closingSessions({AUTOTRADE_KEY:'fixture'},Date.parse('2026-11-11T07:00:00+09:00'));
    assert.equal(calls.length,2);assert.equal(r.closing30.sessions[0].returnPct,.77/3);
    assert.equal(r.closing30.sourceWarnings.length,1);assert.equal(r.closing_bet.sessions[0].returnPct,0);
  }finally{globalThis.fetch=old;}
});
test('closing candidate factory starts after registration and validates supported parameters',()=>{
  const life={generatedPool:[{name:'cf_g0001',createdAfter:date,params:{side:'dip',threshold:-1,volume:1.2}}]};
  assert.equal(closingResearchVariants(life,date).some(x=>x.id==='cf_g0001'),false);
  assert.equal(closingResearchVariants(life,'2026-11-11').some(x=>x.id==='cf_g0001'),true);
  for(const params of [{side:'invalid',threshold:1,volume:1},{side:'dip',threshold:-99,volume:1},{side:'dip',threshold:-1,volume:99}]){
    assert.equal(closingResearchVariants({generatedPool:[{...life.generatedPool[0],params}]},'2026-11-11').some(x=>x.id==='cf_g0001'),false);
  }
});
test('common closing ranking requires all review gates AND seven distinct leader sessions',()=>{
  const candidate={name:'dip_2',status:'review',sampleReady:true,allTrades:60,holdoutTrades:30,mddOk:true,profitFactorOk:true,researchScore:80};
  const section={candidates:[candidate],lifecycle:{activeCandidates:['dip_2'],autoPromotionCandidate:'dip_2',leader:{name:'dip_2',consecutiveResearchSessions:7}}};
  for(const kind of ['closing30','closing_bet']){
    assert.equal(normalize(kind,section).rows[0].promotionEligible,true);assert.equal(autoPromotionDecision(kind,section).ok,true);
    for(const patch of [{status:'collecting'},{sampleReady:false},{mddOk:false},{researchScore:59.9}]){
      assert.equal(autoPromotionDecision(kind,{...section,candidates:[{...candidate,...patch}]}).ok,false);
    }
    assert.equal(autoPromotionDecision(kind,{...section,lifecycle:{...section.lifecycle,leader:{name:'dip_2',consecutiveResearchSessions:6}}}).ok,false);
    assert.equal(effectiveFrom(kind,Date.parse('2026-11-13T19:10:00+09:00')),'2026-11-16');
  }
});
test('outcomes exclude after-exit spikes and keep missing 30-minute/overnight horizons null',()=>{
  const bars=Array.from({length:24},(_,i)=>{const minute=7+i;return {t:date+' 15:'+String(minute).padStart(2,'0'),close:100+minute/100,high:101.5,low:99.5};});
  const r=closingOutcomes(100,at('15:06'),101,at('15:30'),[...bars,{t:date+' 15:31',close:999,high:999,low:1}]);
  assert.equal(r.complete,true);assert.equal(r.horizons[5].at,date+' 15:11');assert.equal(r.horizons[30].returnPct,null);
  assert.ok(Math.abs(r.mfePct-1.5)<1e-10);assert.ok(Math.abs(r.maePct+.5)<1e-10);assert.equal(r.hits['1'].hit,true);
  assert.equal(r.hits['2'].hit,false);assert.ok(Math.abs(r.finalNetPnlPct-.77)<1e-10);
  const missing=closingOutcomes(100,at('15:06'),101,at('15:30'),bars.slice(1));assert.equal(missing.mfePct,null);assert.equal(missing.hits['2'].hit,null);
  const overnight=closingOutcomes(100,at('15:30'),101,'2026-11-11T09:00:00+09:00',[]);
  assert.equal(overnight.horizons[5].returnPct,null);assert.equal(overnight.maePct,null);assert.equal(overnight.complete,false);
});
test('value mutations detect fixed-slot scaling and a path extending beyond the recorded exit',async()=>{
  const reducer=fs.readFileSync(new URL('../functions/api/_closing30-ledger.js',import.meta.url),'utf8');
  const changed=reducer.replace('complete?sum/3:null','complete?sum/Math.max(1,all.length):null');assert.notEqual(changed,reducer);
  const m=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'));
  assert.throws(()=>assert.equal(m.closingDaySummary(ledger(closed()),'closing30').returnPct,.77/3),{name:'AssertionError'});
  const outcomes=fs.readFileSync(new URL('../functions/api/_closing30-outcomes.js',import.meta.url),'utf8');
  const mutant=outcomes.replace('x.ms<=end','true');assert.notEqual(mutant,outcomes);
  const o=await import('data:text/javascript;base64,'+Buffer.from(mutant).toString('base64'));
  const r=o.closingOutcomes(100,at('15:06'),101,at('15:30'),[{t:date+' 15:31',close:999,high:999,low:1}]);
  assert.throws(()=>assert.equal(r.observedMfePct,null),{name:'AssertionError'});
});
test('chunked closing storage retains all events within value limit and detects missing chunks',async()=>{
  const values=new Map(),storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{assert.ok(Buffer.byteLength(JSON.stringify(v))<128*1024);values.set(k,structuredClone(v));},transaction:async fn=>fn(storage)};
  const events=Array.from({length:500},(_,i)=>({...event('signal'),id:String(i),detail:'관측'.repeat(200)}));
  const l=ledger(events,{closingResearch:true});await writeSignalLedger(storage,l);
  assert.ok(values.get('ledger').closingEventChunks>1);assert.deepEqual((await readSignalLedger(storage)).events,events);
  values.delete('closingEvents:1');await assert.rejects(()=>readSignalLedger(storage),/chunk missing/);
  const legacy=ledger(closed());values.set('ledger',legacy);assert.deepEqual(await readSignalLedger(storage),legacy);
});
test('Today renders six equal result/auto-improvement/overview rows from common registries',()=>{
  const ui=fs.readFileSync(new URL('../scalping.html',import.meta.url),'utf8'),nodes={daily_auto_improve_body:{},daily_auto_improve_meta:{},strategy_overview_body:{}};
  const labels=ui.slice(ui.indexOf('const DAILY_RESULT_LABELS='),ui.indexOf('function scalpingKstStamp'));
  const render=ui.slice(ui.indexOf('function renderDailyAutoImprove'),ui.indexOf('async function refreshDailyAutoImprove'));
  const overview=ui.slice(ui.indexOf('function renderStrategyOverview'),ui.indexOf('async function loadStrategyScorecard'));
  const ctx={$:id=>nodes[id],esc:String,shadowLabel:(_k,n)=>n,selectedMainVariant:()=>'baseline',pendingMainVariant:()=>null,
    SHADOW_RANK_CACHE:{rankings:{}},PROMOTION_STATE:{},SCORE_CACHE:{}};
  for(const k of ['opening','daytrading','crypto','soxl','closing30','closing_bet']){ctx.SHADOW_RANK_CACHE.rankings[k]={rows:[],lifecycle:{}};ctx.SCORE_CACHE[k]={trades:0,winRate:null,avgPnl:null,progress:'collecting'};}
  vm.createContext(ctx);vm.runInContext(labels+render+overview+';renderDailyAutoImprove();renderStrategyOverview();',ctx);
  for(const label of ['종가 30분','개별 종목 종가 베팅']){assert.ok(nodes.daily_auto_improve_body.innerHTML.includes(label));assert.ok(nodes.strategy_overview_body.innerHTML.includes(label));}
  assert.equal((nodes.daily_auto_improve_body.innerHTML.match(/class="auto-improve-card"/g)||[]).length,6);
  const mutant=labels.replace(",closing30:'🌇 종가 30분',closing_bet:'🌙 개별 종목 종가 베팅'",'');
  assert.notEqual(mutant,labels);vm.runInNewContext(mutant+render+';renderDailyAutoImprove();',{...ctx});
  assert.equal((nodes.daily_auto_improve_body.innerHTML.match(/class="auto-improve-card"/g)||[]).length,4);
});
