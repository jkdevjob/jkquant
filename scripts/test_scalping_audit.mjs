import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const history=await import(process.env.SCALPING_HISTORY_MODULE||'../functions/api/scalping-history.js');
const trend=await import(process.env.SCALPING_TREND_MODULE||'../functions/api/scalping-trend.js');
const daily=await import(process.env.SCALPING_DAILY_MODULE||'../functions/api/scalping-daily-results.js');
const {pairKst}=daily;
const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
const env={AUTOTRADE_KEY:'test-only-monitor-key'};
const csv='date,entryTimeKst,exitTimeKst,entryPrice,exitPrice,pnlPct\n2026-10-01,00:40,01:35,100,101,1\n';
const response=x=>new Response(JSON.stringify(x));
const req=strategy=>new Request('https://example.test/api/scalping-history?strategy='+strategy+'&range=all');
const closed=(date,pnlPct)=>({date,trades:[{status:'closed',pnlPct,entryPrice:100,exitPrice:100}],strategyVersion:'test'});
try{
  let calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('/paper-history'))return response({ok:true,ledgers:[closed('2026-10-01',-0.14),{date:'2026-10-02',trades:[]}]});
    return new Response(csv);
  };
  let j=await (await history.onRequestGet({request:req('crypto'),env})).json();
  assert.equal(j.status,'ok');assert.equal(j.trades.length,1);assert.equal(j.trades[0].pnl,-0.14);
  assert.equal(j.summary.dailySeries.find(x=>x.date==='2026-10-02').returnPct,0);
  assert.equal(calls.length,2);
  console.log('PASS history: completed live ledger overrides research, genuine no-trade day remains');

  globalThis.fetch=async url=>String(url).includes('/paper-history')
    ?response({ok:true,ledgers:[closed('2026-10-01',0.5)]}):new Response('',{status:404});
  j=await (await history.onRequestGet({request:req('crypto'),env})).json();
  assert.equal(j.trades[0].pnl,0.5);assert.equal(j.status,'ok');
  console.log('PASS history: missing CSV cannot hide live ledger');

  globalThis.fetch=async url=>String(url).includes('/paper-history')?new Response('',{status:503}):new Response(csv);
  j=await (await history.onRequestGet({request:req('crypto'),env})).json();
  assert.equal(j.trades[0].pnl,1);assert.equal(j.status,'degraded');assert.ok(j.sourceWarnings.length);
  console.log('PASS history: failing live source preserves archive and exposes warning');

  globalThis.setTimeout=(fn,_ms,...args)=>originalTimer(fn,10,...args);
  globalThis.fetch=(url,init)=>String(url).includes('/paper-history')
    ?new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}))
    :Promise.resolve(new Response(csv));
  j=await (await history.onRequestGet({request:req('crypto'),env})).json();
  assert.equal(j.status,'degraded');assert.equal(j.trades[0].pnl,1);
  globalThis.setTimeout=originalTimer;
  console.log('PASS history: hung live request aborts and returns remaining data');

  const budgets=[];
  globalThis.setTimeout=(fn,ms,...args)=>{budgets.push(ms);return originalTimer(fn,ms,...args);};
  globalThis.fetch=async()=>response({ok:true,ledgers:[]});
  await history.durableLedgers(env,'crypto',8);
  await history.durableLedgers(env,'crypto',3650);
  globalThis.setTimeout=originalTimer;
  assert.deepEqual(budgets,[5000,15000]);
  console.log('PASS history: small latest-ledger queries stay fast; full history has a bounded 15s budget');

  assert.equal(history.durableTradeRows('crypto',[closed('2026-10-01',null)]).days.length,0);
  assert.equal(history.durableTradeRows('crypto',[{date:'2026-10-01',trades:[{status:'open',pnlPct:1}]}]).days.length,0);
  let series=trend.mergeTrendLedger('crypto',{daily:[{date:'2026-10-01',returnPct:5,trades:1}]},[
    {date:'2026-10-01',trades:[]},closed('2026-10-02',1)
  ]);
  assert.equal(series.daily[0].returnPct,0);assert.ok(Math.abs(series.daily[1].cumulativePct-1)<1e-9);
  series=trend.mergeTrendLedger('daytrading',{daily:[]},[{date:'2026-10-01',trades:[{status:'closed',pnl:1.5}]}]);
  assert.equal(series.daily[0].returnPct,0.5);
  console.log('PASS chart: completed/no-trade/invalid-PnL guards and history account-return parity');

  const data={schema:1,strategies:{opening:{daily:[]},daytrading:{daily:[]},crypto:{daily:[]},soxl:{daily:[{date:'2026-10-01',returnPct:2,trades:1}]}}};
  globalThis.fetch=async url=>{
    if(String(url).includes('/event-history'))return response({ok:true,ledgers:[],sourceWarnings:[]});
    if(String(url).includes('/paper-history')){
      assert.equal(new URL(url).searchParams.get('limit'),'8');
      const strategy=new URL(url).searchParams.get('strategy');
      return response({ok:true,ledgers:strategy==='crypto'?[closed('2026-10-11',-0.14),closed('2099-01-01',5)]:[]});
    }
    return response(data);
  };
  j=await (await trend.onRequestGet({env})).json();
  assert.equal(j.latestCompletedDate,'2026-10-11');
  assert.equal(j.strategies.soxl.daily[0].date,'2026-10-02');
  assert.equal(j.strategies.soxl.daily[0].marketDate,'2026-10-01');
  assert.equal(j.strategies.crypto.daily.length,1);
  assert.equal(j.sourceWarnings.length,0);
  console.log('PASS chart endpoint: latest live completion, KST SOXL alignment, future exclusion');

  const state=pairKst('crypto','BTC',{sessions:[],error:'source failure'},'2026-10-12');
  assert.equal(state.status,'error');assert.equal(state.current.pending,true);assert.notEqual(state.current.noTrade,true);
  assert.equal(pairKst('crypto','BTC',{sessions:[]},'2026-10-12').status,'degraded'); // 지난 날짜의 누락 장부는 무기한 수집중이 아니다
  let activeSources=0,maxSources=0;
  globalThis.fetch=async()=>{
    activeSources++;maxSources=Math.max(maxSources,activeSources);
    await new Promise(resolve=>queueMicrotask(resolve));activeSources--;
    return new Response('',{status:503});
  };
  j=await (await daily.onRequestGet({request:new Request('https://example.test/api/scalping-daily-results?refresh=1'),env})).json();
  assert.equal(j.ok,true);
  assert.ok(maxSources>=4,'independent strategy sources must run concurrently');
  for(const name of ['opening','daytrading','crypto','soxl'])assert.equal(j.strategies.find(x=>x.strategy===name).status,'error');
  console.log('PASS today: missing/error source never reported as healthy no-trade result');

  const ui=readFileSync(process.env.SCALPING_UI_PATH||new URL('../scalping.html',import.meta.url),'utf8');
  const start=ui.indexOf('function scalpingKstStamp('),end=ui.indexOf('function dailyResultPct(',start);
  const f=new Function(ui.slice(start,end)+';return {scalpingKstStamp,paperMissingText};')();
  assert.match(f.scalpingKstStamp('2026-10-11T23:55:08Z'),/2026-10-12 08:55 KST/);
  assert.equal(f.scalpingKstStamp(null),'—');assert.match(f.paperMissingText('crypto'),/매매없음으로 확정하지/);
  console.log('PASS UI: Korean update timestamp and missing-ledger distinction');
}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
