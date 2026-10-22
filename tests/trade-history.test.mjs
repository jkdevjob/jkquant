import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {record,paperRecords,openingRecords,closingRecords,tenbaggerRecords,uniqueRecords,filterRecords,recordsCsv,variantValid} from '../functions/api/_trade-history.js';
import {onRequestGet} from '../functions/api/trade-history.js';
import {summarizePaperLedger} from '../functions/api/scalping-live-results.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
globalThis.DurableObject=class{constructor(ctx){this.ctx=ctx;}};
const worker=async name=>import('data:text/javascript;base64,'+Buffer.from(read('worker/'+name+'-scheduler/src/index.js').replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=globalThis.DurableObject;')).toString('base64'));
const global=await worker('global-intraday'),day=await worker('daytrading');
function memoryStore(Class){
  const stores=new Map();
  return {idFromName:n=>n,get:n=>{if(!stores.has(n)){const values=new Map(),ctx={storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,structuredClone(v))}};stores.set(n,new Class(ctx));}const obj=stores.get(n);return {fetch:(input,init)=>obj.fetch(new Request(input,init))};},stores};
}
async function mockFetch(fn,run){const prev=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=prev;}}
const date='2026-10-21',kst=(h,m)=>Date.parse(date+'T'+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':00+09:00');
const base={date,code:'005930',name:'삼성전자',signalTime:1000,entryTime:1001,entryPrice:100,exitTime:1010,exitPrice:101,pnl:.75,status:'closed',strategyParams:{stopPct:1},strategyVersion:'v1'};
test('all named shadows including decimal and generated variants are selectable',()=>{
  for(const v of ['vol_1.0','stop_0.3_tp_0.6','cf_g0012','baseline'])assert.equal(variantValid(v),true);
  for(const v of ['../secret','<script>','x&to=2030',''])assert.equal(variantValid(v),false);
});
test('main and every shadow normalize without losing original conditions or zero returns',()=>{
  const ledger={date,mainVariant:'vol_1.0',trades:[{...base,pnl:0}],shadowLedgers:{baseline:{trades:[base]},retired:{trades:[{...base,status:'pending',entryPrice:null,exitPrice:null,pnl:null}]}}};
  const rows=paperRecords('daytrading',ledger);assert.equal(rows.length,3);
  assert.equal(rows[0].role,'main');assert.equal(rows[0].pnl,0);assert.deepEqual(rows[0].strategyParams,{stopPct:1});assert.equal(rows[1].role,'shadow');assert.equal(rows[2].entryPrice,null);
});
test('open marks never become realized returns; elapsed exit is an explicit missing record',()=>{
  const [r]=paperRecords('crypto',{date,mainVariant:'baseline',trades:[{...base,status:'open',exitPrice:null,exitTime:null,pnlPct:2,pnl:undefined,deadlineMs:1}]});
  assert.equal(r.status,'unverified');assert.equal(r.pnl,null);assert.equal(r.unrealizedPnl,2);
});
test('unfilled signal survives partial scan and is distinct from selected trades',()=>{
  const rows=paperRecords('daytrading',{date,trades:[base],signalEvents:[{...base,id:'selected',variant:'baseline'},{...base,id:'partial',code:'000660',variant:'vol_1.2',selectionEligible:false}]});
  assert.equal(rows.length,2);assert.equal(rows[1].status,'signal');assert.equal(rows[1].entryPrice,null);assert.equal(rows[1].reason,'partial_scan_unconfirmed');
});
test('opening original buy/sell join by variant, version and original entry',()=>{
  const buy={id:'b',stage:'buy',variant:'baseline',code:base.code,strategyVersion:'v1',targetHm:907,signal:{entryTime:907,entryPrice:100,strategyParams:{stop:1}}};
  const sell={...buy,id:'s',stage:'sell',targetHm:930,signal:{...buy.signal,exitTime:930,exitPrice:101,pnl:.75,reason:'time_exit'}};
  const rows=openingRecords({date,mainVariant:'baseline',events:[sell,buy]});assert.equal(rows.length,1);assert.equal(rows[0].status,'closed');assert.equal(rows[0].pnl,.75);assert.equal(rows[0].events.length,2);
  const missing=openingRecords({date:'2020-01-01',events:[buy]})[0];assert.equal(missing.status,'unverified');assert.equal(missing.exitPrice,null);assert.equal(missing.pnl,null);
  assert.equal(openingRecords({date,events:[buy,{...sell,signal:{...sell.signal,finalExitUnverified:true}}]})[0].pnl,null);
});
test('closing bet preserves official close/open price times and every variant',()=>{
  const events=['signal','buy','sell'].map((stage,i)=>({id:stage,kind:'overnight',variant:'dip_2',code:base.code,name:base.name,stage,createdAt:['2026-10-21T06:22:00Z','2026-10-21T06:40:00Z','2026-10-22T00:06:00Z'][i],price:[null,100,102][i],priceAt:i===1?'2026-10-21T15:30:00+09:00':i===2?'2026-10-22T09:00:00+09:00':null,pnl:i===2?1.77:null,strategyParams:{threshold:-2}}));
  const [r]=closingRecords({date,events});assert.equal(r.strategy,'closing_bet');assert.equal(r.role,'shadow');assert.equal(r.entryTime,'2026-10-21T15:30:00+09:00');assert.equal(r.exitTime,'2026-10-22T09:00:00+09:00');assert.equal(r.pnl,1.77);assert.deepEqual(r.strategyParams,{threshold:-2});
});
test('all tenbagger arms retain open, closed and missing absolute prices',()=>{
  const rows=tenbaggerRecords({rules:{parameters:{maxSessions:1260}},records:[{id:'t',...base,pattern:'trend200',entryDate:date,signalDate:'2026-10-20',entryPrice:null,netMarkPct:3,arms:{hold1260:{status:'open'},stop12_trail35:{status:'closed',exitDate:'2026-10-22',netReturnPct:-12.5}}}]});
  assert.equal(rows.length,2);assert.equal(rows[0].entryPrice,null);assert.equal(rows[0].pnl,null);assert.equal(rows[0].unrealizedPnl,3);assert.equal(rows[1].pnl,-12.5);
});
test('original and reconstruction stay separate; same original refresh is idempotent',()=>{
  const r=record('daytrading',base,'baseline','server-paper','baseline'),research={...r,recordOrigin:'research-reconstructed'};
  const rows=uniqueRecords([r,{...r,status:'open',pnl:null},research]);assert.equal(rows.length,2);assert.equal(rows[0].status,'closed');
  assert.equal(filterRecords(rows,new URLSearchParams({strategy:'daytrading',variant:'main',symbol:'삼성',from:date,to:date,origin:'paper'})).length,1);
  assert.equal(filterRecords(rows,new URLSearchParams({symbol:'000660'})).length,0);
});
test('CSV includes the full evidence snapshot and escapes formulas and quotes',()=>{
  const csv=recordsCsv([record('daytrading',{...base,name:'=HYPERLINK("bad")'},'vol_1.0')]);assert.match(csv,/strategyParams/);assert.match(csv,/'=HYPERLINK\(""bad""\)/);assert.match(csv,/"vol_1.0"/);assert.match(csv,/stopPct/);
});
test('owner-only endpoint refuses anonymous calls without reading a source',async()=>{
  let calls=0;await mockFetch(async()=>{calls++;throw Error('unexpected');},async()=>assert.equal((await onRequestGet({request:new Request('https://app/api/trade-history'),env:{}})).status,401));assert.equal(calls,0);
});
const request=q=>{const u=new URL('https://app/api/trade-history?strategy=crypto&from=2026-10-01&to=2026-10-21');for(const [k,v] of new URLSearchParams(q))u.searchParams.set(k,v);return new Request(u,{headers:{Authorization:'Bearer fixture'}});};
const sources=async input=>{
  const u=String(input);if(u.includes('identitytoolkit'))return Response.json({users:[{email:'jk82investing@gmail.com'}]});
  if(u.includes('variant-trades.csv'))return new Response('variant,date,code,name,signalTime,entryTime,entryPrice,exitTime,exitPrice,pnl,source\nvol_1.0,2026-10-21,KRW-BTC,비트코인,01:00,01:05,100,02:00,101,0.86,research-reconstructed\nbaseline,2026-10-20,KRW-BTC,비트코인,01:00,01:05,100,02:00,101,0.86,research-reconstructed');
  if(u.includes('/paper-history?'))return Response.json({ok:true,ledgers:[{date,mainVariant:'baseline',trades:[{...base,pnlPct:.86}],shadowLedgers:{'vol_1.0':{trades:[{...base,pnlPct:.86}]}}}]});
  throw Error('unexpected source '+u);
};
test('query pagination includes live and archived shadows; full CSV is independent of page size',async()=>mockFetch(sources,async()=>{
  const env={AUTOTRADE_KEY:'fixture'},r=await onRequestGet({request:request('variant=vol_1.0&pageSize=1'),env}),j=await r.json();assert.equal(r.status,200);assert.equal(j.total,2);assert.equal(j.trades.length,1);assert.equal(j.pages,2);assert.ok(j.variants.includes('vol_1.0'));
  const csv=await onRequestGet({request:request('variant=vol_1.0&pageSize=1&format=csv'),env});assert.equal(csv.status,200);assert.equal((await csv.text()).split('\r\n').length,3);
}));
test('bad date/filter rejected and source failure cannot silently produce a complete CSV',async()=>mockFetch(async(u,o)=>String(u).includes('/paper-history')?Response.json({ok:false},{status:503}):sources(u,o),async()=>{
  const env={AUTOTRADE_KEY:'fixture'};
  assert.equal((await onRequestGet({request:request('from=2026-02-30'),env})).status,400);
  const r=await onRequestGet({request:request('format=csv'),env});assert.equal(r.status,502);assert.match((await r.json()).sourceWarnings.join(''),/서버 장부/);
  const j=await (await onRequestGet({request:request(''),env})).json();assert.equal(j.status,'degraded');assert.equal(j.total,2);
}));
test('day reselection preserves original entries and retired shadows',()=>{
  const old={...base,id:'005930:1000'};const keep=day.retainedCandidates([old],[{...base,code:'000660',signalTime:959},{...base,code:'005930',entryPrice:999}],1);
  assert.equal(keep.length,1);assert.equal(keep[0].entryPrice,100);assert.equal(keep[0].code,'005930');
  const signals=day.daySignalEvidence([{mainParams:{volMult:1.5},signals:[base],shadowEvents:[{name:'vol_1.0',params:{volMult:1},signals:[base]}]}],date,'baseline');
  assert.equal(signals.length,2);assert.equal(signals[1].strategyParams.volMult,1);assert.equal(day.daySignalEvidence([{signals:[{...base,entryPrice:999}]}],date,'baseline',signals)[0].entryPrice,100);
});
test('day exact final bar missing never fabricates a 15:10 fill',()=>{
  const t={...base,status:'open',exitPrice:null,pnl:null,entryTime:1508,lastEvaluatedHm:null,frictionPct:.25};
  const row=(hm,c=100)=>({t:date+' '+String(hm).slice(0,2)+':'+String(hm).slice(2)+':00',o:c,h:c+.1,l:c-.1,c});
  const missing=day.applyBars(t,[row(1508),row(1509)],1510);assert.equal(missing.status,'open');assert.equal(missing.exitPrice,null);
  const closed=day.applyBars(t,[row(1508),row(1509),row(1510,100.5)],1510);assert.equal(closed.status,'closed');assert.ok(Math.abs(closed.pnl-.25)<1e-9);
});
test('day shadow evaluation shares source bars and retains filled positions on rescan',async()=>{
  const env={MONITOR_KEY:'fixture',PAPER_STORE:null,SNAPSHOT_STORE:null};env.SNAPSHOT_STORE=memoryStore(day.SnapshotStore);
  let reads=0;
  await mockFetch(async input=>{
    const url=String(input);if(url.includes('/api/kis?')){reads++;return Response.json({bars:[{t:date+' 10:01:00',o:100,h:100.1,l:99.9,c:100}]});}
    if(url.includes('/api/scalping-alert'))return Response.json({ok:true,webPush:{ok:true}});throw Error(url);
  },async()=>{
    const candidate={...base,status:undefined,entryPrice:undefined,exitPrice:undefined,signalTime:1000};
    const parts=[{mainParams:{volMult:1.5},signals:[candidate],shadowEvents:[{name:'vol_1.0',params:{volMult:1},signals:[candidate]}]}];
    const ledger=await day.reconcilePaper(env,date,1001,[candidate],'baseline',parts);assert.equal(reads,1);assert.equal(ledger.trades[0].entryPrice,100);assert.equal(ledger.shadowLedgers['vol_1.0'].trades[0].entryPrice,100);
    const next=await day.reconcilePaper(env,date,1001,[{...candidate,code:'000660'}],'baseline',[],true);assert.equal(next.trades[0].code,'005930');assert.ok(next.shadowLedgers['vol_1.0']);
  });
});
function btcBars(){return Array.from({length:30},(_,i)=>({date,ms:kst(0,0)+i*300000,hm:Math.floor(i*5/60)*100+i*5%60,time:String(Math.floor(i*5/60)).padStart(2,'0')+':'+String(i*5%60).padStart(2,'0'),o:100,h:i===0?100:i===1?101:100.2,l:99.9,c:i===0?100:i===1?101:100.1,v:i===1?20:10}));}
test('global captures all named/generated/retired shadows with distinct hold-time exits',()=>{
  const bars=btcBars(),now=kst(3,0),rows=global.globalShadowLedgers('crypto',date,bars,now,'baseline',{},['cf_g0001']);
  assert.equal(Object.keys(rows).length,Object.keys(global.BTC_VARIANTS).length);assert.ok(rows.cf_g0001);assert.equal(rows.hold_30m.trades[0].exitTime,'00:35');assert.equal(rows.hold_120m.trades[0].exitTime,'02:05');
  const next=global.globalShadowLedgers('crypto',date,[],now,'baseline',{'retired_v1':rows.hold_30m},[]);assert.equal(next.retired_v1.trades[0].entryPrice,100);assert.equal(next.retired_v1.trades[0].exitPrice,100.1);
});
test('stored ORB entries/parameters and closed fills survive changed replay data',()=>{
  const bars=btcBars(),p=global.BTC_VARIANTS.baseline,t=global.btcTrade(bars,kst(1,0),date,p);
  const old=global.paperLedger('crypto',date,t,{mainVariant:'baseline',params:p,friction:.14});
  const changed=global.storedOrbTrade('crypto',date,old,{...t,entryPrice:999},bars,kst(3,0),{...p,stopPct:9});assert.equal(changed.entryPrice,100);assert.equal(changed.params.stopPct,.5);
  const done=global.paperLedger('crypto',date,changed,{mainVariant:'baseline',params:p,friction:.14});
  const frozen=global.storedOrbTrade('crypto',date,done,null,[],kst(4,0),p);assert.equal(frozen.exit.price,done.trades[0].exitPrice);assert.equal(frozen.entryPrice,100);
});
test('midnight clock is 00:xx and authorized refresh never emits alerts/orders',async()=>{
  assert.equal(global.parts(kst(0,5),'Asia/Seoul').hm,5);
  assert.equal((await global.default.fetch(new Request('https://worker/refresh',{method:'POST',body:'{}'}),{})).status,401);
  const fn=read('worker/global-intraday-scheduler/src/index.js').split('async function refreshPaper(')[1].split('\nasync function run(')[0];assert.doesNotMatch(fn,/await alert\(|\/v1\/orders|op=order/);
});
test('UI uses a shared filtered view and discards a response after logout',async()=>{
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='trades_strategy'?'crypto':id==='trades_variant'?'all':'',innerHTML:'unchanged',textContent:''});return nodes.get(id);};
  let release;const c={document:{getElementById:node},Date,URLSearchParams,AbortController,URL,Intl,Blob,setTimeout,clearTimeout,SCALPING_AUTH_EPOCH:1,me:{getIdToken:async()=>'fixture'},fetch:async()=>new Promise(r=>release=r),esc:String,histPrice:String,histPct:String,showStrategy:()=>{}};
  vm.createContext(c);vm.runInContext(read('trade-history-ui.js'),c);const promise=c.loadTradeHistory();await new Promise(setImmediate);c.me=null;c.SCALPING_AUTH_EPOCH++;release(Response.json({ok:true}));await promise;assert.equal(node('trades_body').innerHTML,'unchanged');
  const ui=read('scalping.html');assert.match(ui,/data-strategy="closing_bet"/);assert.match(ui,/data-strategy="trades"/);assert.match(ui,/openTradeHistory\('closing_bet'\)/);
});
test('value mutants: shadow omission, reconstructed provenance loss, invented deadline fill',async()=>{
  const source=read('functions/api/_trade-history.js');
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(source.replace('...Object.entries(ledger.shadowLedgers||{})','...Object.entries({})')).toString('base64'));
  assert.throws(()=>assert.equal(mutant.paperRecords('daytrading',{date,trades:[base],shadowLedgers:{x:{trades:[base]}}}).length,2),assert.AssertionError);
  const collapsed=await import('data:text/javascript;base64,'+Buffer.from(source.replace("x.recordOrigin+':'+x.strategy","x.strategy")).toString('base64'));
  const x=record('crypto',base);assert.throws(()=>assert.equal(collapsed.uniqueRecords([x,{...x,recordOrigin:'server-paper'}]).length,2),assert.AssertionError);
  const src=read('worker/daytrading-scheduler/src/index.js').replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=globalThis.DurableObject;').replace('// No fill at 15:10 without the 15:10 completed candle.','if(t.status==="open"&&target>=PAPER_FINAL_EXIT_HM){t.status="closed";t.exitPrice=t.currentPrice;t.exitTime=1510;}');
  const fake=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
  assert.throws(()=>assert.equal(fake.applyBars({...base,status:'open',entryTime:1509,exitPrice:null},[{t:date+' 15:09:00',o:100,h:100,l:100,c:100}],1510).status,'open'),assert.AssertionError);
});

test('today card stops showing held trades after the recorded deadline or final minute',()=>{
  const row=summarizePaperLedger('daytrading',{date,mode:'server-live-paper-no-order',trades:[{...base,status:'open',exitTime:null,exitPrice:null,unrealizedPnl:1}],updatedAt:new Date(kst(15,11)).toISOString()},kst(15,11));
  assert.equal(row.state,'unavailable');assert.equal(row.open,0);assert.equal(row.unverified,1);assert.equal(row.returnPct,null);
  const btc=summarizePaperLedger('crypto',{date,mode:'server-live-paper-no-order',trades:[{...base,entryTime:'01:00',status:'open',pnlPct:1,strategyParams:{maxHoldBars:6}}]},kst(1,31));
  assert.equal(btc.state,'unavailable');assert.equal(btc.positions[0].status,'unverified');
});
test('value mutants: lost stored entry and retired variants are detected',async()=>{
  const src=read('worker/global-intraday-scheduler/src/index.js').replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=globalThis.DurableObject;');
  const lost=await import('data:text/javascript;base64,'+Buffer.from(src.replace('const x=old?.trades?.[0];if(!x)return candidate;','return candidate; const x=old?.trades?.[0];')).toString('base64'));
  const old={trades:[{...base,entryPrice:100}],strategyParams:global.BTC_VARIANTS.baseline};
  assert.throws(()=>assert.equal(lost.storedOrbTrade('crypto',date,old,{entryPrice:999},btcBars(),kst(3,0),global.BTC_VARIANTS.baseline).entryPrice,100),assert.AssertionError);
  const retired=await import('data:text/javascript;base64,'+Buffer.from(src.replace('...Object.keys(previous),','')).toString('base64'));
  assert.throws(()=>assert.ok(retired.globalShadowLedgers('crypto',date,[],kst(3,0),'baseline',{retired:{trades:[base],strategyParams:global.BTC_VARIANTS.baseline}}).retired),assert.AssertionError);
});
