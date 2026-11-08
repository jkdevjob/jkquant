import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {advanceHoldingLab,emptyHoldingLab,holdingPublic,holdingMs,HOLDING_VERSION,mainHoldingParams} from '../functions/api/_gpt-holding-lab.js';
import {closingWindow,chooseClosingSignals} from '../functions/api/_closing30.js';
import {closingBrokerPlans,soxlBrokerPlans,validateBrokerPlan} from '../functions/api/_research-orders.js';
import {closingRecords} from '../functions/api/_trade-history.js';
import {readHoldingState,writeHoldingState} from '../functions/api/_gpt-holding-storage.js';
import {rebreakTrade} from '../functions/api/_opening.js';
const date='2026-11-09',at=hm=>holdingMs(date,hm);
function seed(strategy='crypto',hm=1000){return {id:'entry',sourceId:strategy+':entry',strategyVersion:'original-main-v1',params:{stopPct:5,takeProfitPct:10},mode:'live',date,code:strategy==='crypto'?'KRW-BTC':strategy==='soxl'?'SOXL':'005930',entryMs:at(hm),entryPrice:100,stopPct:5,takeProfitPct:10,frictionPct:.2,slots:1,closeOnly:strategy==='opening'};}
function bar(code,hm,c=100,changes={}){return {code,date,hm,ms:at(hm),durationMs:300000,o:c,h:c,l:c,c,...changes};}
function input(strategy,s,hm,bars=[]){return {strategy,now:at(hm)+2000,sessionDate:date,seeds:s?[s]:[],bars,sources:[{source:'original app fixture'}],errors:[]};}
test('only prospective live entries seed independent cash cohorts; missing or imported data is not a zero return',()=>{
 const s=seed(),a=advanceHoldingLab(null,input('crypto',s,1005));
 assert.equal(a.arms.hold_24h.trades.length,1);assert.equal(a.arms.no_time.trades[0].strategyVersion,HOLDING_VERSION+'@no_time');
 assert.equal(a.arms.main.trades[0].sourceVersion,s.strategyVersion);assert(a.arms.main.cash>=0);
 const repeated=advanceHoldingLab(a,input('crypto',s,1006));assert.equal(repeated.arms.hold_24h.trades.length,1);
 for(const x of [{...s,mode:'import'},{...s,entryMs:at(900)}]){
  const r=advanceHoldingLab(null,input('crypto',x,1005));assert.equal(r.arms.main.trades.length,0);assert.equal(r.arms.main.skipped[0].reason,'late_or_imported_entry');
 }
 assert.equal(holdingPublic(emptyHoldingLab('crypto')).arms[0].summary.returnPct,null);
});
test('future candles are ignored and a missing deadline remains unverified until its actual candle arrives',()=>{
 const s=seed(),start=advanceHoldingLab(null,input('crypto',s,1005,[bar(s.code,1000)]));
 const future=advanceHoldingLab(start,input('crypto',s,1005,[bar(s.code,1005,120)]));
 assert.equal(future.arms.no_time.trades[0].status,'open');
 let r=advanceHoldingLab(start,input('crypto',s,1205,[]));assert.equal(r.arms.hold_120m.trades[0].status,'unverified');
 const bars=Array.from({length:23},(_,i)=>{const m=10*60+5+i*5;return bar(s.code,Math.floor(m/60)*100+m%60);});
 r=advanceHoldingLab(r,input('crypto',s,1205,bars));assert.equal(r.arms.hold_120m.trades[0].status,'closed');
 assert.equal(r.arms.hold_120m.trades[0].exitMs,at(1200));assert(Math.abs(r.arms.hold_120m.trades[0].pnlPct+.2)<1e-9);
});
test('24 hour cap crosses midnight by elapsed time; no-time cohort retains its risk exits',()=>{
 const s=seed('crypto',2200);let st=advanceHoldingLab(null,input('crypto',s,2205,[bar(s.code,2200)]));
 const bars=Array.from({length:287},(_,i)=>{const ms=s.entryMs+(i+1)*300000,d=new Date(ms+9*3600000).toISOString();return {...bar(s.code,0,100.1),date:d.slice(0,10),ms,hm:+d.slice(11,13)*100+(+d.slice(14,16))};});
 st=advanceHoldingLab(st,{...input('crypto',s,2205,bars),now:s.entryMs+86400000+2000,sessionDate:'2026-11-10',seeds:[]});
 assert.equal(st.arms.hold_24h.trades[0].exitMs,s.entryMs+86400000);assert.equal(st.arms.no_time.trades[0].status,'open');
 const ms=s.entryMs+86400000;st=advanceHoldingLab(st,{strategy:'crypto',now:ms+302000,sessionDate:'2026-11-10',bars:[{...bar(s.code,2200,94),date:'2026-11-10',ms,o:94,h:100,l:93}],seeds:[]});
 const t=st.arms.no_time.trades[0];assert.equal(t.exitPrice,94);assert.equal(t.exitReason,'stop');
});
test('occupied capital skips later signals and never extends a losing trade or injects cash',()=>{
 const s=seed(),st=advanceHoldingLab(null,input('crypto',s,1005,[bar(s.code,1000)]));
 const next={...s,sourceId:'second',entryMs:at(1005)};
 const r=advanceHoldingLab(st,input('crypto',next,1010,[bar(s.code,1005,99)]));
 assert.equal(r.arms.no_time.skipped[0].reason,'capital_occupied');assert.equal(r.arms.no_time.trades.length,1);
 assert(r.arms.no_time.equity<r.capital);assert(r.arms.no_time.mddPct<0);
});
test('operating reference copies the original outcome; later source revisions are flagged without rewriting it',()=>{
 const s=seed(),st=advanceHoldingLab(null,input('crypto',s,1005,[bar(s.code,1000)]));
 const closed={...s,exitMs:at(1005),exitPrice:101,pnlPct:.8};
 const r=advanceHoldingLab(st,input('crypto',closed,1010));assert.equal(r.arms.main.trades[0].pnlPct,.8);
 const changed=advanceHoldingLab(r,input('crypto',{...closed,entryPrice:99,exitPrice:105,pnlPct:5},1010));
 assert.equal(changed.arms.main.trades[0].pnlPct,.8);assert.equal(changed.arms.main.trades[0].entryPrice,100);assert.equal(changed.arms.main.trades[0].sourceRevision,true);
});
test('opening 10:00 cohort keeps entry and risk rules and exits by its exact deadline',()=>{
 const s=seed('opening',929),st=advanceHoldingLab(null,input('opening',s,930,[]));
 const bars=Array.from({length:30},(_,i)=>{const m=9*60+30+i;return bar(s.code,Math.floor(m/60)*100+m%60,100,{durationMs:60000});});
 const r=advanceHoldingLab(st,input('opening',s,1001,bars));const t=r.arms.exit_1000.trades[0];
 assert.equal(t.entryMs,s.entryMs);assert.equal(t.exitMs,at(1000));assert.equal(t.exitReason,'time_exit');
 const hit=advanceHoldingLab(st,input('opening',s,931,[bar(s.code,930,94,{durationMs:60000})]));assert.equal(hit.arms.exit_1000.trades[0].exitReason,'stop');
});
test('day next-open cohort uses an observed next trading-session open, including a holiday gap',()=>{
 const s=seed('daytrading',1519);let st=advanceHoldingLab(null,input('daytrading',s,1520,[bar(s.code,1519,100,{durationMs:60000})]));
 st=advanceHoldingLab(st,{...input('daytrading',s,1532,[bar(s.code,1530,100,{durationMs:60000})]),sessionEndMs:at(1531)});
 const r=advanceHoldingLab(st,{strategy:'daytrading',now:holdingMs('2026-11-12',905),sessionDate:'2026-11-12',seeds:[],bars:[{...bar(s.code,900,102,{o:101,durationMs:60000}),date:'2026-11-12',ms:holdingMs('2026-11-12',900)}]});
 assert.equal(r.arms.next_open.trades[0].exitPrice,101);assert.equal(r.arms.next_open.trades[0].exitReason,'next_session_open');
});
test('a missing previous-session close cannot silently become a verified overnight exit',()=>{
 const s=seed('daytrading',1519),st=advanceHoldingLab(null,{...input('daytrading',s,1520,[bar(s.code,1519,100,{durationMs:60000})]),sessionEndMs:at(1531)});
 const r=advanceHoldingLab(st,{strategy:'daytrading',now:holdingMs('2026-11-10',905),sessionDate:'2026-11-10',seeds:[],bars:[{...bar(s.code,900,101,{durationMs:60000}),date:'2026-11-10',ms:holdingMs('2026-11-10',900)}]});
 assert.equal(r.arms.next_open.trades[0].status,'unverified');assert.equal(r.arms.next_open.trades[0].exitPrice,undefined);
});
test('risk exits before a new signal release capital, while later exits cannot fund that entry',()=>{
 const s=seed(),st=advanceHoldingLab(null,input('crypto',s,1005,[bar(s.code,1000)]));
 const next={...s,sourceId:'next',entryMs:at(1010)};
 const bars=[bar(s.code,1005,94),bar(s.code,1010,100)];
 const r=advanceHoldingLab(st,input('crypto',next,1015,bars));
 assert.equal(r.arms.no_time.trades.length,2);assert.equal(r.arms.no_time.trades[0].exitMs,at(1010));
 assert(r.arms.no_time.trades[1].notional<st.capital);
 const early=advanceHoldingLab(st,input('crypto',{...next,entryMs:at(1005)},1010,bars));
 assert.equal(early.arms.no_time.skipped[0].reason,'capital_occupied');
});
test('main caps apply only to the new prospective date and retain stricter existing limits',()=>{
 assert.equal(mainHoldingParams('crypto','2026-11-08',{maxHoldBars:24}).maxHoldBars,24);
 assert.equal(mainHoldingParams('crypto',date,{maxHoldBars:24}).maxHoldBars,12);
 assert.equal(mainHoldingParams('soxl',date,{maxHoldBars:24}).maxHoldBars,18);
 assert.equal(mainHoldingParams('crypto',date,{maxHoldBars:6}).maxHoldBars,6);
 const st=emptyHoldingLab('crypto');st.arms.main.trades=[{status:'closed',notional:1000,pnlPct:2},{status:'closed',notional:500,pnlPct:-1}];
 assert.equal(holdingPublic(st).arms[0].summary.profitFactor,4);
});
test('30/60 minute closing windows are versioned, share 15:15 exit and retire only new overnight entries',()=>{
 assert.equal(closingWindow('day','2026-11-06').entryHm,1507);
 assert.equal(closingWindow('day',date).entryHm,1445);assert.equal(closingWindow('hour',date).entryHm,1415);
 assert.equal(closingWindow('day',date).exitHm,1515);assert.equal(closingWindow('hour',date).exitHm,1515);
 assert.equal(closingWindow('overnight',date),null);assert.deepEqual(chooseClosingSignals([],'overnight',3,date),[]);
});
test('closing price API uses the close already completed at its 15:15 deadline and never the following minute',async()=>{
 const {onRequestGet}=await import('../functions/api/closing30-monitor.js'),oldFetch=globalThis.fetch,oldNow=Date.now;
 Date.now=()=>at(1516)+2000;
 globalThis.fetch=async u=>Response.json(String(u).includes('minute=1')?{minutes:[{t:date+' 15:14',close:101,vol:1},{t:date+' 15:15',close:999,vol:2}]}:{ohlc:[{date:'2026-11-06',open:100,close:100},{date,open:100,close:500}]});
 try{
  for(const stage of ['day_exit','hour_exit']){
   const response=await onRequestGet({request:new Request('https://app/api/closing30-monitor?op=price-batch&date='+date+'&stage='+stage+'&inputs='+encodeURIComponent(JSON.stringify(['005930'])),{headers:{'x-monitor-key':'fixture'}}),env:{AUTOTRADE_KEY:'fixture'}});
   const body=await response.json();assert.equal(response.status,200);assert.equal(body.prices[0].price,101);assert.match(body.prices[0].priceAt,/15:14/);
  }
 }finally{globalThis.fetch=oldFetch;Date.now=oldNow;}
});
test('modern broker orders use 14:45 / 15:15, cannot submit hour shadows or new overnight buys; legacy exits survive',()=>{
 const e=(kind,stage)=>({id:kind+stage,kind,stage,variant:'baseline',code:'005930',createdAt:new Date(at(1444)).toISOString(),strategyVersion:'closing30_1515_v2'});
 const l={date,events:['day','hour','overnight'].flatMap(k=>['signal','buy'].map(s=>e(k,s))),scans:[]};
 const [buy]=closingBrokerPlans(l,'day','buy',date),[sell]=closingBrokerPlans(l,'day','sell',date);
 assert.equal(Date.parse(buy.dueAt),at(1445));assert.equal(Date.parse(sell.dueAt),at(1515));assert.equal(validateBrokerPlan(buy,at(1445)),'');assert.equal(validateBrokerPlan(sell,at(1515)),'');
 assert.equal(closingBrokerPlans(l,'hour','buy',date).length,0);assert.equal(closingBrokerPlans(l,'overnight','buy',date).length,0);
 assert.match(validateBrokerPlan({...buy,strategy:'gpt_closing_bet'},at(1445)),/중단/);
 assert.equal(closingBrokerPlans({...l,date:'2026-11-06'},'overnight','sell',date).length,1);
 const rows=closingRecords(l);assert.equal(rows.find(r=>r.variant==='hour_baseline').role,'shadow');
});
test('holding API remains owner-only and internal quotes reject anonymous calls before fetching',async()=>{
 const a=await import('../functions/api/gpt-holding-lab.js'),b=await import('../functions/api/gpt-holding-quotes.js');
 for(const m of [a,b])assert.equal((await m.onRequestGet({request:new Request('https://app/api/test'),env:{}})).status,401);
});
test('holding UI distinguishes no prospective entry, missing sources and original strategy versions',async()=>{
 const src=fs.readFileSync(new URL('../scalping.html',import.meta.url),'utf8'),el={innerHTML:''};
 let lab=holdingPublic(emptyHoldingLab('crypto'));
 const ctx={me:{getIdToken:async()=>'fixture'},$:()=>el,esc:x=>String(x),scalpingKstStamp:x=>x,histPrice:(_,x)=>String(x),fetch:async()=>Response.json({ok:true,evaluationStart:date,labs:[lab]})};
 vm.createContext(ctx);vm.runInContext(src.slice(src.indexOf('async function loadHoldingTimeLab('),src.indexOf('let HOLDING_LAB_TIMER=')),ctx);
 await ctx.loadHoldingTimeLab('crypto');assert.match(el.innerHTML,/등록된 전향 진입 없음 · 미검증/);assert.match(el.innerHTML,/10,000,000/);
 const s=seed();lab=holdingPublic(advanceHoldingLab(null,{...input('crypto',s,1005,[bar(s.code,1000)]),errors:[{error:'source missing'}]}));
 await ctx.loadHoldingTimeLab('crypto');assert.match(el.innerHTML,/원천 확인 필요/);assert.match(el.innerHTML,/original-main-v1/);assert.match(el.innerHTML,/source missing/);
});
test('SOXL counts actual trading sessions, honors an early-close timestamp and does not count a holiday',()=>{
 const entry=Date.parse('2026-11-25T15:50:00-05:00'),end=Date.parse('2026-11-25T16:00:00-05:00');
 const s={...seed('soxl'),date:'2026-11-25',entryMs:entry};
 const first=[0,1].map(i=>({code:'SOXL',date:'2026-11-25',hm:1550+i*5,ms:entry+i*300000,durationMs:300000,o:100,h:100,l:100,c:100}));
 let st=advanceHoldingLab(null,{strategy:'soxl',now:entry+302000,sessionDate:'2026-11-25',sessionEndMs:end,seeds:[s],bars:first});
 const open=Date.parse('2026-11-27T09:30:00-05:00'),early=Date.parse('2026-11-27T13:00:00-05:00');
 const next=Array.from({length:42},(_,i)=>{const minute=570+i*5;return {code:'SOXL',date:'2026-11-27',hm:Math.floor(minute/60)*100+minute%60,ms:open+i*300000,durationMs:300000,o:100,h:100,l:100,c:100};});
 st=advanceHoldingLab(st,{strategy:'soxl',now:early+2000,sessionDate:'2026-11-27',sessionEndMs:early,seeds:[],bars:[...first,...next]});
 assert.equal(st.arms.hold_2sessions.trades[0].exitMs,early);assert.deepEqual(st.arms.hold_2sessions.trades[0].sessions,['2026-11-25','2026-11-27']);
 assert.equal(st.arms.hold_5sessions.trades[0].status,'open');
});
test('trade-partitioned durable storage reloads all source identities without a growing single trade array',async()=>{
 const values=new Map(),storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),list:async({prefix})=>new Map([...values].filter(([k])=>k.startsWith(prefix)))};
 const s=seed(),st=advanceHoldingLab(null,input('crypto',s,1005,[bar(s.code,1000)]));
 await writeHoldingState(storage,st,null);assert.equal(values.get('holdingLab').arms.no_time.trades.length,0);
 const restored=await readHoldingState(storage);assert.deepEqual(restored.arms.no_time.trades,st.arms.no_time.trades);
 await writeHoldingState(storage,restored,restored);assert.equal([...values.keys()].filter(k=>k.startsWith('holdingTrade:')).length,4);
});
test('SOXL main respects an actual early close and VTS exit expires before that session ends',async()=>{
 const src=fs.readFileSync(new URL('../worker/global-intraday-scheduler/src/index.js',import.meta.url),'utf8');
 const load=s=>import('data:text/javascript;base64,'+Buffer.from(s.replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {};').replaceAll('../../../functions/api/',new URL('../functions/api/',import.meta.url).href)+'\nexport {soxlSessionParams};').toString('base64'));
 async function probe(m){
  const d='2026-11-27',entryMs=Date.parse(d+'T11:35:00-05:00'),end=Date.parse(d+'T13:00:00-05:00');
  const bars=Array.from({length:17},(_,i)=>({date:d,ms:entryMs+i*300000,sessionEndMs:end,o:100,h:100,l:100,c:100}));
  const p=m.soxlSessionParams(mainHoldingParams('soxl',d,{maxHoldBars:24,stopPct:10,takeProfitPct:20}),bars,d);
  const t=m.orbExit(bars,{hm:1135,ms:entryMs,o:100},end+2000,p,960);
  assert.equal(t.deadlineMs,end);assert.equal(t.exit.bar.ms+300000,end);
  assert.throws(()=>m.soxlSessionParams(p,[],d),/unconfirmed/);
  const ledger={date:d,strategy:'soxl',mode:'server-live-paper-no-order',trades:[{id:'early',entryMs,entryPrice:100,deadlineMs:end,sessionEndMs:end,status:'open'}]};
  const [sell]=soxlBrokerPlans(ledger,end-120000).filter(x=>x.side==='sell');
  assert.equal(Date.parse(sell.dueAt),end-120000);assert(Date.parse(sell.expiresAt)<end);
  assert.notEqual(validateBrokerPlan(sell,end),'');
 }
 await probe(await load(src));
 const mutant=src.replace('params.sessionEndMs>0?params.sessionEndMs:Infinity','Infinity');assert.notEqual(mutant,src);
 await assert.rejects(async()=>probe(await load(mutant)),assert.AssertionError);
});
test('09:30 opening exit uses the already completed 09:29 bar and rejects a fresh 09:29 entry',()=>{
 const prices=[103,103,103,104,103.6,104.2,...Array(24).fill(104.1)];
 const rows=prices.map((close,i)=>({t:date+' 09:'+String(i).padStart(2,'0'),close,high:close,vol:i===5?500:100}));
 rows.push({t:date+' 09:30',close:200,high:200,vol:9000});
 const t=rebreakTrade(rows,{open:103,prevClose:100},930,{beforeDeadline:true});
 assert.equal(t.exitTime,930);assert.equal(t.exitPrice,104.1);assert.equal(t.strategyVersion,'opening_rebreak_intraday_v2');
 assert.equal(t.evidence.finalExitPriceUnconfirmed,undefined);assert.match(t.evidence.finalExitPriceModel,/09:29/);
 const locked=rebreakTrade(rows,{open:103,prevClose:100},930,{beforeDeadline:true,exitPolicy:'next_session_open'});
 assert.equal(locked.exitTime,930);assert.equal(locked.evidence.exitPolicy,undefined);
});
test('value mutations catch disabled risk exits, stale seeding and missing 24-hour deadline',async()=>{
 const file=new URL('../functions/api/_gpt-holding-lab.js',import.meta.url),src=fs.readFileSync(file,'utf8');
 const load=txt=>import('data:text/javascript;base64,'+Buffer.from(txt).toString('base64'));
 const s=seed();
 for(const [before,after,probe] of [
  ['if(low<=stop)','if(false)',m=>assert.equal(m.advanceHoldingLab(null,input('crypto',s,1005,[bar(s.code,1000,94)])).arms.no_time.trades[0].status,'closed')],
  ["now-s.entryMs>10*60_000","false",m=>assert.equal(m.advanceHoldingLab(null,input('crypto',{...s,entryMs:at(900)},1005)).arms.main.trades.length,0)],
  ["Math.min(+params.maxHoldBars||0,strategy==='crypto'?12:18)","+params.maxHoldBars",m=>assert.equal(m.mainHoldingParams('crypto',date,{maxHoldBars:24}).maxHoldBars,12)],
  ["t.lastBarMs+b.durationMs!==st.sessionEnds[t.lastSession]","false",m=>{
    const d=seed('daytrading',1519),st=m.advanceHoldingLab(null,{...input('daytrading',d,1520,[bar(d.code,1519,100,{durationMs:60000})]),sessionEndMs:at(1531)});
    const r=m.advanceHoldingLab(st,{strategy:'daytrading',now:holdingMs('2026-11-10',905),sessionDate:'2026-11-10',seeds:[],bars:[{...bar(d.code,900,101,{durationMs:60000}),date:'2026-11-10',ms:holdingMs('2026-11-10',900)}]});
    assert.equal(r.arms.next_open.trades[0].status,'unverified');
  }],
  ["minutes:1440","minutes:1",m=>assert.equal(m.emptyHoldingLab('crypto').arms.hold_24h.minutes,1440)]
 ]){assert(src.includes(before));probe(await load(src));const bad=await load(src.replace(before,after));assert.throws(()=>probe(bad),assert.AssertionError);}
});
