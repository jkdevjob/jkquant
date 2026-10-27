import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {sessionClock,summarizeOpeningLedger as opening,summarizePaperLedger as paper,onRequestGet} from '../functions/api/scalping-live-results.js';
const now=Date.parse('2026-10-14T10:02:00+09:00');
const stamp=t=>new Date(t).toISOString();
const ledger=(trades=[],extra={})=>({date:'2026-10-14',updatedAt:stamp(now),trades,...extra});
const scan=(events=[],extra={})=>({date:'2026-10-14',mainVariant:'baseline',events,scans:Array.from({length:27},(_,i)=>({targetHm:904+i,capturedAt:'2026-10-14T09:31:00+09:00',okShards:5,quoteErrors:0,...extra}))});
const event=(stage,pnl,variant='baseline')=>({stage,variant,code:'A',name:'종목',signal:{entryTime:910,exitTime:930,pnl}});
test('09:39 opening finished: original complete empty scan is no signal, not pending',()=>{
 const r=opening(scan(),Date.parse('2026-10-14T09:39:00+09:00'));
 assert.equal(r.state,'no_signal');assert.equal(r.returnPct,0);assert.equal(r.noTrade,true);assert.equal(r.stale,false);assert.equal(r.finalized,false);
});
test('scheduled start, holidays and missing/old/imported ledger never invent zero',()=>{
 assert.equal(paper('daytrading',null,Date.parse('2026-10-14T09:41:00+09:00')).state,'scheduled');
 assert.equal(opening(null,Date.parse('2026-10-14T09:04:00+09:00')).state,'scheduled');
 assert.equal(opening(null,now).returnPct,null);
 assert.equal(paper('crypto',ledger([],{date:'2026-10-13'}),now).state,'unavailable');
 assert.equal(paper('crypto',ledger([],{mode:'historical-research-import-no-order'}),now).returnPct,null);
 assert.equal(paper('daytrading',null,Date.parse('2026-10-17T12:00:00+09:00')).state,'market_closed');
});
test('partial scan or quote failure is unverified, never zero/no-trade',()=>{
 for(const extra of [{partial:true},{okShards:4},{quoteErrors:1},{failed:['x']}]){
  const r=opening(scan([],extra),now);assert.equal(r.state,'unavailable');assert.equal(r.noTrade,false);assert.equal(r.returnPct,null);
 }
});
test('a missing 09:06 scan cannot become no signal just because the 09:30 scan succeeded',()=>{
 const l=scan();l.scans=l.scans.filter(s=>s.targetHm!==906);
 const r=opening(l,now);
 assert.equal(r.state,'unavailable');assert.equal(r.sourceIncomplete,true);
 assert.equal(r.noTrade,false);assert.equal(r.returnPct,null);assert.equal(r.realizedReturnPct,null);
 assert.deepEqual(r.scanCoverage.missingTargets,[906]);assert.match(r.reason,/09:06/);
});
test('earlier quote failure, duplicate minutes and missing final scan retain incomplete coverage',()=>{
 const bad=scan();bad.scans[2].quoteErrors=1;
 assert.deepEqual(opening(bad,now).scanCoverage.failedTargets,[906]);
 assert.equal(opening(bad,now).state,'unavailable');
 const duplicate=scan();duplicate.scans[2]={...duplicate.scans[3]};
 assert.equal(duplicate.scans.length,27);assert.equal(opening(duplicate,now).noTrade,false);
 const final=scan();final.scans.pop();assert.deepEqual(opening(final,now).scanCoverage.missingTargets,[930]);
 // A successful retry of that same minute can complete its coverage.
 bad.scans.push({...bad.scans[2],quoteErrors:0});assert.equal(opening(bad,now).state,'no_signal');
});
test('active session checks completed minutes without requiring future scans; known trades survive gaps',()=>{
 const active=scan();active.scans=active.scans.filter(s=>s.targetHm<=910);
 const r=opening(active,Date.parse('2026-10-14T09:11:00+09:00'));
 assert.equal(r.state,'no_signal');assert.equal(r.scanCoverage.expected,7);assert.equal(r.scanCoverage.complete,true);
 const traded=scan([event('buy',null),event('sell',1.25)]);traded.scans=traded.scans.filter(s=>s.targetHm!==906);
 const known=opening(traded,now);assert.equal(known.trades,1);assert.equal(known.closed,1);
 assert.equal(known.realizedReturnPct,1.25);assert.equal(known.returnPct,null);assert.equal(known.state,'unavailable');
});
test('active monitor stops: elapsed missing minutes cannot stay no signal behind its last scan',()=>{
 const l=scan();l.scans=l.scans.filter(s=>s.targetHm<=910);
 // The 09:11 target may still be in flight at 09:12; earlier completed scans stay valid.
 assert.equal(opening(l,Date.parse('2026-10-14T09:12:00+09:00')).state,'no_signal');
 const stopped=opening(l,Date.parse('2026-10-14T09:16:00+09:00'));
 assert.deepEqual(stopped.scanCoverage.missingTargets,[911,912,913,914]);
 assert.equal(stopped.state,'unavailable');assert.equal(stopped.returnPct,null);
 assert.equal(stopped.noTrade,false);assert.equal(stopped.sourceIncomplete,true);
 assert.equal(opening(l,Date.parse('2026-10-14T09:31:00+09:00')).scanCoverage.missingTargets.at(-1),930);
});
test('opening only promoted main original events, excludes baseline and shadow',()=>{
 const l=scan([event('buy',null),event('sell',99),event('buy',null,'promoted'),event('sell',-1.25,'promoted'),event('buy',null,'shadow')]);l.mainVariant='promoted';
 const r=opening(l,now);assert.equal(r.trades,1);assert.equal(r.returnPct,-1.25);assert.equal(r.state,'closed');assert.equal(r.losses,1);
});
test('opening holding has unknown MTM, closed missing PnL does not become zero',()=>{
 assert.equal(opening(scan([event('buy',null)]),now).returnPct,null);
 const r=opening(scan([event('buy',null),event('sell',null)]),now);assert.equal(r.state,'unavailable');assert.equal(r.returnPct,null);
});
test('day account MTM and realized are divided by ledger slots, not trade count',()=>{
 const r=paper('daytrading',ledger([{status:'closed',pnl:-1.25},{status:'open',unrealizedPnl:2}],{maxTrades:3}),now);
 assert.equal(r.returnPct,0.25);assert.equal(r.realizedReturnPct,-1.25/3);assert.equal(r.state,'holding');assert.equal(r.closed,1);assert.equal(r.open,1);
 assert.equal(paper('daytrading',ledger([{status:'closed',pnl:-1.25}],{maxTrades:1}),now).returnPct,-1.25);
});
test('pending, null MTM, malformed status and missing array remain unknown',()=>{
 for(const t of [{status:'pending'},{status:'open',unrealizedPnl:null},{status:'closed',pnl:null},{status:'weird'}])assert.equal(paper('daytrading',ledger([t]),now).returnPct,null);
 assert.equal(paper('crypto',{date:'2026-10-14'},now).state,'unavailable');
 assert.equal(paper('daytrading',ledger(),now).state,'no_signal');
});
test('crypto uses stored cost-inclusive MTM unchanged; detects delay and future timestamp',()=>{
 assert.equal(paper('crypto',ledger([{status:'open',pnlPct:1.37}],{slots:1}),now).returnPct,1.37);
 assert.equal(paper('crypto',ledger([],{updatedAt:stamp(now-9*60000)}),now).stale,true);
 assert.equal(paper('crypto',ledger([],{updatedAt:stamp(now+2*60000)}),now).stale,true);
 assert.equal(paper('daytrading',ledger([],{updatedAt:stamp(now-60*60000)}),Date.parse('2026-10-14T09:50:00+09:00')).stale,false);
});
test('SOXL ET ledger date and KST close display date through DST/session boundary',()=>{
 const active=sessionClock('soxl',Date.parse('2026-10-14T23:00:00+09:00'));
 assert.equal(active.ledgerDate,'2026-10-14');assert.equal(active.date,'2026-10-15');assert.equal(active.activeUS,true);
 const morning=sessionClock('soxl',now);assert.equal(morning.ledgerDate,'2026-10-13');assert.equal(morning.date,'2026-10-14');
 const r=paper('soxl',{date:'2026-10-13',trades:[{status:'closed',pnlPct:2}],updatedAt:'2026-10-14T05:00:00+09:00'},now);assert.equal(r.returnPct,2);assert.equal(r.stale,false);
 const winter=sessionClock('soxl',Date.parse('2026-11-04T23:45:00+09:00'));assert.equal(winter.activeUS,true);assert.equal(winter.date,'2026-11-05');
});
test('endpoint owner gate makes no upstream request for anonymous user',async()=>{
 const old=globalThis.fetch;let reads=0;globalThis.fetch=async()=>{reads++;throw Error('unexpected');};
 try{const r=await onRequestGet({request:new Request('https://test/api/scalping-live-results'),env:{}});assert.equal(r.status,401);assert.equal(reads,0);assert.equal(r.headers.get('cache-control'),'no-store');}finally{globalThis.fetch=old;}
});
test('owner endpoint reads only immutable /events and /paper; isolates source failure',async()=>{
 const old=globalThis.fetch,oldNow=Date.now;const calls=[];Date.now=()=>now;
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url:String(url),opts});
  if(String(url).includes('accounts:lookup'))return Response.json({users:[{email:'owner@test'}]});
  const u=new URL(url);if(u.searchParams.get('strategy')==='crypto')throw Error('source down');
  return Response.json({ok:true,ledger:u.pathname==='/events'?scan():ledger([],{date:u.searchParams.get('date')})});
 };
 try{
  const r=await onRequestGet({request:new Request('https://test/api/scalping-live-results',{headers:{Authorization:'Bearer fixture'}}),env:{OWNER_EMAIL:'owner@test',DAYTRADING_MONITOR_KEY:'fixture',OPENING_MONITOR_KEY:'fixture'}});
  const j=await r.json();assert.equal(j.strategies.length,6);assert.equal(j.strategies.find(x=>x.strategy==='crypto').current.state,'unavailable');assert.equal(j.strategies.find(x=>x.strategy==='opening').current.state,'no_signal');
  for(const c of calls.slice(1)){assert.ok(['/events','/paper','/closing-ledger'].includes(new URL(c.url).pathname));assert.equal(c.opts.method,undefined);assert.equal(c.opts.headers['x-monitor-key'],'fixture');}
 }finally{globalThis.fetch=old;Date.now=oldNow;}
});
const ui=fs.readFileSync(new URL('../scalping.html',import.meta.url),'utf8');
const block=ui.slice(ui.indexOf('const DAILY_RESULTS_TTL_MS='),ui.indexOf('let GPT_MORNING_AT='))+ui.slice(ui.indexOf('let DAILY_RESULTS_PAYLOAD='),ui.indexOf('function renderDailyStrategyResultsPayload'));
function browser(source=block){
 const intervals=[],listeners={},renders=[];
 const ctx={me:{uid:'owner',getIdToken:async()=>'token'},SCALPING_AUTH_EPOCH:1,DAILY_RESULT_CACHE:{opening:{old:true}},document:{hidden:false,addEventListener:(k,f)=>listeners[k]=f},window:{addEventListener:(k,f)=>listeners[k]=f},AbortController,Date,Intl,Map,
 setInterval:(f,ms)=>{intervals.push({f,ms});return intervals.length;},clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},loadDailyStrategyResults:async()=>{},loadGptMorningReport:async()=>{},stopGptMorningReport:()=>{},renderDailyStrategyResultsPayload:j=>renders.push(j),fetch:async()=>Response.json({ok:true,kstDate:'2026-10-14',strategies:[]})};
 vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,intervals,listeners,renders,run:s=>vm.runInContext(s,ctx)};
}
test('merge overlays only same-day current, never mutates previous/history',()=>{
 const b=browser();b.run("DAILY_LIVE_PAYLOAD={kstDate:'2026-10-14',strategies:[{strategy:'opening',current:{live:true,returnPct:2}}]}");
 const original={kstDate:'2026-10-14',strategies:[{strategy:'opening',previous:{returnPct:-1},current:{pending:true}}]};
 const result=b.ctx.mergeDailyLivePayload(original);assert.equal(result.strategies[0].current.returnPct,2);assert.equal(result.strategies[0].previous,original.strategies[0].previous);assert.equal(original.strategies[0].current.pending,true);
 const old={...original,kstDate:'2026-10-13'};assert.equal(b.ctx.mergeDailyLivePayload(old),old);
});
test('30-second single timer, resume events, hidden skip, token/no-store and coalescing',async()=>{
 const b=browser();let calls=0,resolve;let options;
 b.ctx.fetch=async(u,o)=>{calls++;options=o;return new Promise(r=>resolve=r);};
 b.ctx.startDailyLiveAuto();b.ctx.startDailyLiveAuto();await new Promise(setImmediate);assert.equal(b.intervals.length,1);assert.equal(b.intervals[0].ms,30000);assert.equal(calls,1);assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer token');
 b.ctx.resumeDailyLive();assert.equal(calls,1);assert.ok(b.listeners.online&&b.listeners.focus&&b.listeners.visibilitychange);
 resolve(Response.json({ok:true,kstDate:'2026-10-14',strategies:[]}));await b.run('DAILY_LIVE_PROMISE');
 b.ctx.document.hidden=true;b.intervals[0].f();await Promise.resolve();assert.equal(calls,1);
});
test('logout cancels in-flight, clears caches and discards older authenticated response',async()=>{
 const b=browser();let resolve;
 b.ctx.fetch=async()=>new Promise(r=>resolve=r);const p=b.ctx.refreshDailyLiveResults();await new Promise(setImmediate);
 b.ctx.me=null;b.ctx.SCALPING_AUTH_EPOCH++;b.ctx.stopDailyLiveAuto();resolve(Response.json({ok:true,kstDate:'2026-10-14',strategies:[]}));await p;
 assert.equal(b.renders.length,0);assert.equal(b.run('DAILY_LIVE_PAYLOAD'),null);assert.equal(b.ctx.DAILY_RESULT_CACHE.opening,undefined);
});
test('source failure renders unavailable with null, never zero',async()=>{
 const b=browser();b.ctx.fetch=async()=>{throw Error('offline');};await b.ctx.refreshDailyLiveResults();
 assert.equal(b.renders.length,1);for(const x of b.renders[0].strategies){assert.equal(x.current.state,'unavailable');assert.equal(x.current.returnPct,null);}
});
test('live card escapes source/position names, marks unknown and provisional, no target achievement',()=>{
 const code=ui.slice(ui.indexOf('function dailyLiveState'),ui.indexOf('const DAILY_CHART_COLORS'));
 const ctx={esc:x=>String(x).replaceAll('<','&lt;'),scalpingKstStamp:x=>x||'—'};vm.createContext(ctx);vm.runInContext(code,ctx);
 const out=ctx.dailyResultCell({live:true,date:'2026-10-14',state:'holding',returnPct:2,open:1,reason:'<error>',positions:[{name:'<img>',status:'open'}]},'당일');
 assert.match(out,/잠정값/);assert.match(out,/&lt;img>/);assert.doesNotMatch(out,/<img>|\+1% 달성/);
 assert.match(ctx.dailyResultCell({live:true,state:'unavailable',returnPct:null},'당일'),/실행 미확인/);
});
test('mutants: missing numeric null guard, main variant filter and polling interval rejected by values',async()=>{
 const original=fs.readFileSync(new URL('../functions/api/scalping-live-results.js',import.meta.url),'utf8');
 const executable=original.replace(/^import .*;\n/gm,'').replace(/export async function/g,'async function').replace(/export \{[^}]*\};/g,'');
 const base={CLOSING_LABELS:{closing30:'종가 30분',closing_bet:'종가 베팅'},tzParts:(zone,t)=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:p.year+'-'+p.month+'-'+p.day,hm:Number(p.hour)*100+Number(p.minute)};},shiftIso:()=>'',isNyseSessionDate:()=>true,krxDay:()=>({closed:false}),Response,Date};
 for(const [mutate,verify] of [
  [s=>s.replace("v==null||v===''||",''),c=>assert.equal(c.summarizePaperLedger('daytrading',ledger([{status:'closed',pnl:null}]),now).returnPct,null)],
  [s=>s.replace('partial=!coverage.complete','partial=!openingScanOkay(latest)'),c=>{const l=scan();l.scans=l.scans.filter(s=>s.targetHm!==906);assert.equal(c.summarizeOpeningLedger(l,now).state,'unavailable');}],
  [s=>s.replace('Math.max(last,clock.hm-2)','last'),c=>{const l=scan();l.scans=l.scans.filter(s=>s.targetHm<=910);assert.equal(c.summarizeOpeningLedger(l,Date.parse('2026-10-14T09:16:00+09:00')).state,'unavailable');}],
  [s=>s.replace('e.variant===variant&&',''),c=>{const l=scan([event('buy',null),event('sell',99),event('buy',null,'promoted'),event('sell',-1.25,'promoted')]);l.events[0].signal.entryTime=900;l.events[1].signal.entryTime=900;l.mainVariant='promoted';assert.equal(c.summarizeOpeningLedger(l,now).trades,1);}]
 ]){const c={...base};vm.createContext(c);vm.runInContext(mutate(executable),c);assert.throws(()=>verify(c),{name:'AssertionError'});}
 const b=browser(block.replace('DAILY_LIVE_INTERVAL_MS=30000','DAILY_LIVE_INTERVAL_MS=60000'));b.ctx.startDailyLiveAuto();assert.throws(()=>assert.equal(b.intervals[0].ms,30000),{name:'AssertionError'});
});


test('09:30 finalization never leaves a previous opening buy as normal held or fake closed',()=>{
 const at=Date.parse('2026-10-14T09:39:00+09:00');
 const unresolved=opening(scan([event('buy',null)]),at);
 assert.equal(unresolved.state,'unavailable');assert.equal(unresolved.open,1);
 assert.equal(unresolved.returnPct,null);assert.match(unresolved.reason,/청산/);
 const buy=event('buy',null),end=event('sell',null);
 end.signal.finalExitUnverified=true;
 const attempted=opening(scan([buy,end]),at);
 assert.equal(attempted.open,0);assert.equal(attempted.unverified,1);
 assert.equal(attempted.state,'unavailable');assert.equal(attempted.returnPct,null);
 assert.match(attempted.sourceWarning,/체결/);
});
