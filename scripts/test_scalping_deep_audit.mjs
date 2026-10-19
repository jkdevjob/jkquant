import assert from 'node:assert/strict';
import {PresaleAlertStore} from "../worker/presale-alert/src/index.js";
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const mutation=process.env.SCALPING_DEEP_MUTATION?JSON.parse(readFileSync(0,'utf8')):{};
const workerPath=process.env.SCALPING_GLOBAL_PATH||new URL('../worker/global-intraday-scheduler/src/index.js',import.meta.url);
let workerSource=(mutation.global||readFileSync(workerPath,'utf8')).replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {};');
const worker=await import('data:text/javascript;base64,'+Buffer.from(workerSource).toString('base64'));
const openingSource=(mutation.opening||readFileSync(process.env.SCALPING_OPENING_PATH||new URL('../worker/opening-scheduler/src/index.js',import.meta.url),'utf8'))
  .replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {};')
  .replaceAll('../../../functions/api/',new URL('../functions/api/',import.meta.url).href);
const opening=await import('data:text/javascript;base64,'+Buffer.from(openingSource).toString('base64'));
const daily=await import(process.env.SCALPING_DAILY_MODULE||'../functions/api/scalping-daily-results.js');
const alert=await import(process.env.SCALPING_ALERT_MODULE||'../functions/api/scalping-alert.js');
const ui=mutation.ui||readFileSync(process.env.SCALPING_UI_PATH||new URL('../scalping.html',import.meta.url),'utf8');
const originalFetch=globalThis.fetch,originalCaches=globalThis.caches;
let failed=0,passed=0;
async function check(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
const date='2026-10-01';
function bar(minute,values={},soxl=false){
  const time=String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
  return {date,time,hm:Math.floor(minute/60)*100+minute%60,ms:Date.parse(date+'T'+time+':00'+(soxl?'-04:00':'+09:00')),o:101,h:101.1,l:100.9,c:101,v:100,...values};
}
const btc=[bar(0,{o:99,h:100,l:98,c:99}),bar(5,{o:99,h:101.2,l:99,c:101,v:150}),bar(10)];
const soxl=[bar(570,{o:99,h:100,l:98,c:99},true),bar(575,{o:99,h:100,l:98,c:99},true),bar(580,{o:99,h:100,l:98,c:99},true),bar(585,{o:99,h:101.2,l:99,c:101,v:150},true),bar(590,{},true)];
await check('BTC/SOXL delayed tail does not become an early time exit',()=>{
  assert.equal(worker.btcTrade(btc,bar(20).ms,date).exit,null);
  assert.equal(worker.soxlTrade(soxl,bar(600,{},true).ms,date).exit,null);
});
await check('unfinished candle cannot hit a stop/target; next-bar open is the fill',()=>{
  const partial=[...btc.slice(0,-1),bar(10,{h:120,l:80})];
  const t=worker.btcTrade(partial,bar(12).ms,date);
  assert.equal(t.entryPrice,101);assert.equal(t.exit,null);
  const closed=worker.btcTrade(partial,bar(16).ms,date);
  assert.equal(closed.exit.reason,'stop_same_bar');assert.equal(closed.exit.price,100.495);
  assert.ok(Math.abs(worker.paperLedger('crypto',date,closed,{friction:.14}).trades[0].pnlPct+.64)<1e-10);
});
await check('future or missing next candle never supplies a fabricated entry',()=>{
  assert.equal(worker.btcTrade(btc,bar(9).ms+59_000,date),null);
  const gap=[...btc.slice(0,-1),bar(15)];
  assert.equal(worker.btcTrade(gap,bar(20).ms,date).waiting,true);
});
await check('maximum holding horizon is required before time exit',()=>{
  const full=[...btc.slice(0,2),...Array.from({length:12},(_,i)=>bar(10+i*5))];
  assert.equal(worker.btcTrade(full,bar(69).ms,date).exit,null);
  const t=worker.btcTrade(full,bar(71).ms,date);
  assert.equal(t.exit.bar.hm,105);assert.equal(t.exit.reason,'time_exit');
  const gap=full.filter(x=>x.hm!==105);
  assert.equal(worker.btcTrade(gap,bar(75).ms,date).exit,null,'missing exit candle remains unconfirmed');
  const fullSoxl=[...soxl.slice(0,4),...Array.from({length:18},(_,i)=>bar(590+i*5,{},true))];
  assert.equal(worker.soxlTrade(fullSoxl,bar(679,{},true).ms,date).exit,null);
  assert.equal(worker.soxlTrade(fullSoxl,bar(681,{},true).ms,date).exit.bar.hm,1115);
  const late=[bar(0,{o:99,h:100,l:98,c:99}),bar(1315,{h:101.2,c:101,v:150}),...Array.from({length:24},(_,i)=>bar(1320+i*5))];
  assert.equal(worker.btcTrade(late,bar(1435).ms+11*60_000,date,{maxHoldBars:30}).exit.bar.hm,2355,'long variant closes at session boundary, no overnight');
});
await check('opening retry uses only archived full-universe operational events, never shadows or VTS orders',()=>{
  const event=(variant,targetHm,sent=true)=>({variant,targetHm,stage:'buy',code:'fixture',alertDelivery:{sent,error:sent?null:'fixture outage'},signal:{entryTime:targetHm,code:'fixture'}});
  const ledger={date,mainVariant:'baseline',scans:[{targetHm:907,partial:false,okShards:5},{targetHm:908,partial:true,okShards:4}],events:[event('baseline',907,false),event('shadow',907),event('baseline',908)]};
  const a=opening.recentOpeningAlertEvents(ledger,909);
  assert.equal(a.length,1);assert.equal(a[0].webOnly,false);assert.equal(a[0].eventId,'opening:'+date+':baseline:fixture:buy:0907');
  assert.equal(a[0].eventAt,'2026-10-01T00:08:00.000Z');
  assert.equal(opening.recentOpeningAlertEvents(ledger,916).length,0);
});
await check('actual zero-trade ledger wins; conflicting reconstruction is disclosed',()=>{
  const [x]=daily.mergeDaytradingSessions([{date,trades:0,noTrade:true,returnPct:0,source:'daytrading-paper-live',mainVariant:'baseline'}],
    [{date,trades:3,noTrade:false,returnPct:2,source:'daytrading-research',mainVariant:'baseline'}]);
  assert.equal(x.trades,0);assert.equal(x.returnPct,0);assert.equal(x.source,'daytrading-paper-live');
  assert.equal(x.sourceConflict.researchTrades,3);
});
await check('missing closed PnL is incomplete, never a finalized zero',()=>{
  const x=daily.liveLedgerSummary({date,trades:[{status:'closed',pnlPct:null}]},date,'global-paper-live');
  assert.equal(x.finalized,false);assert.equal(x.incomplete,true);assert.equal(x.returnPct,null);assert.equal(x.noTrade,false);
});
await check('imported research ledger cannot be labelled a live execution',()=>{
  const x=daily.liveLedgerSummary({date,mode:'historical-research-import-no-order',trades:[]},date,'global-paper-live');
  assert.equal(x.source,'historical-research-import');
});
function uiFn(start,end,bindings={}){
  return new Function(...Object.keys(bindings),ui.slice(ui.indexOf(start),ui.indexOf(end,ui.indexOf(start)))+';return '+start.match(/function (\w+)/)[1]+';')(...Object.values(bindings));
}
await check('pending result remains pending in both card and cockpit; null percentages stay blank',()=>{
  const pct=uiFn('function dailyResultPct(','function dailyResultCell(');
  assert.equal(pct(null),'—');assert.equal(pct(''),'—');
  const state=uiFn('function dailyResultState(','function dailyResultPct(');
  assert.equal(state({pending:true,date}).label,'대기');
  assert.equal(state({incomplete:true,returnPct:0,date}).returnPct,null);
  assert.equal(state({marketClosed:true,date}).label,'휴장');
  const el={innerHTML:''};
  const render=uiFn('function renderStrategyCockpit(','function setupUnifiedStrategyFlow(',{
    $:()=>el,STRATEGY_UI_META:{},DAILY_RESULT_CACHE:{crypto:{current:{date,pending:true}}},
    HISTORY_RISK_CACHE:{},SCORE_CACHE:{},DAILY1_CACHE:null,dailyResultState:state,cockpitPct:pct,esc:String,
    renderStrategyStatus(){},renderPlan(){}
  });
  render('crypto');assert.match(el.innerHTML,/cockpit-value">대기</);assert.ok(!el.innerHTML.includes('거래 없음'));assert.ok(!el.innerHTML.includes('+0.00%'));
});
await check('1-of-3 daytrading portfolio never divides by executed-trade count',()=>{
  const fn=uiFn('function dayTradingTodayMetrics(','async function loadDayTradingResearch(');
  assert.equal(fn({daily:[]},[{pnl:1.5}],date).accountReturnPct,.5);
  assert.equal(fn({daily:[{date,returnPct:null}]},[{pnl:1.5},{pnl:null}],date).accountReturnPct,.5);
  assert.equal(fn({daily:[]},[{pnl:1.5}],date,1).accountReturnPct,1.5);
});
await check('research day count never claims prospective validation; risk week is explicit',()=>{
  assert.ok(ui.includes('연구 표본은 실시간 모의투자 검증일이 아닙니다.'));
  assert.ok(!ui.includes('20일이면 판정'));
  assert.ok(!ui.includes('이번주 계좌수익'));
  assert.ok(ui.includes('조회 마지막 주'));
});
await check('logout during owner lookup or menu loading cannot reopen the app',async()=>{
  for(const pending of ['owner','menu']){
    const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},innerHTML:'',textContent:''});return nodes.get(id);};
    const user={uid:'fixture-owner',email:'fixture@example.test',getIdToken:async()=>'fixture-token'};
    let authCallback,releaseLookup,initialized=0;
    const delayed=new Promise(resolve=>releaseLookup=resolve);
    const ctx={console,AbortController,setTimeout,clearTimeout,clearInterval,$:node,esc:String,
      stopDailyLiveAuto(){},startDailyLiveAuto(){},stopLive(){},stopOpeningLive(){},stopGlobalPaperAuto(){},stopDayTradingPaperAuto(){},stopOpeningPaperAuto(){},STRATEGY_STATUS_TIMER:null,
      loadAll(){initialized++;},cloudLoad:async()=>true,setupUnifiedStrategyFlow(){},setupDaily1ShadowCards(){},startStrategyStatusAuto(){},
      loadStrategyScorecard:async()=>{},loadDaily1Shadow(){},restoreStrategy(){},
      window:{fb:{auth:{currentUser:user},onAuthStateChanged(_auth,cb){authCallback=cb;}}},
      JKAccess:{setAdmin(){},applyMenuConfig:async()=>{if(pending==='menu')await delayed;}}};
    ctx.window.JKAccess=ctx.JKAccess;
    ctx.fetch=async()=>{if(pending==='owner')await delayed;return new Response(JSON.stringify({isOwner:true}));};
    vm.runInNewContext(ui.slice(ui.indexOf("let me=null, OWNSRC="),ui.indexOf('if(window.fb) boot();'))+'\nboot();',ctx);
    const inflight=authCallback(user);
    await new Promise(resolve=>setImmediate(resolve));
    ctx.window.fb.auth.currentUser=null;await authCallback(null);releaseLookup();await inflight;
    assert.equal(node('app').style.display,'none');assert.equal(node('gate').style.display,'flex');assert.equal(initialized,0,pending);
  }
});
await check('Firestore read completing after logout cannot populate the old private ledger',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  const ctx={me:{uid:'fixture-owner'},SCALPING_AUTH_EPOCH:1,POS:['untouched'],LOG:[],KLOG:[],TOP2HIST:[],
    window:{fb:{getDoc:async()=>pending,doc:()=>({}),db:{}}},scalpClone:x=>x,setSync(){}};
  // Use the actual function in one shared lexical context so auth changes are visible after await.
  vm.runInNewContext(ui.slice(ui.indexOf('async function cloudLoad('),ui.indexOf('function setSync('))+'\nglobalThis.load=cloudLoad;',ctx);
  const inflight=ctx.load();ctx.me=null;ctx.SCALPING_AUTH_EPOCH++;
  release({exists:()=>true,data:()=>({scalp:{pos:['wrong account']}})});
  assert.equal(await inflight,false);assert.deepEqual(ctx.POS,['untouched']);
});
await check('promoted one-slot ledger has identical account return in history and chart',async()=>{
  const history=await import(process.env.SCALPING_HISTORY_MODULE||'../functions/api/scalping-history.js');
  const {rows,days}=history.durableTradeRows('daytrading',[{date,maxTrades:1,trades:[{status:'closed',pnl:1.5}]}]);
  assert.equal(history.dailyRisk(rows,'daytrading',days).daily[0].returnPct,1.5);
});
await check('today source failure is disclosed even when research fallback succeeds',async()=>{
  const kst=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const yesterday=new Date(Date.parse(kst+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  globalThis.fetch=async url=>{
    const s=String(url);
    if(s.includes('/paper?')&&s.includes('strategy=crypto'))return new Response('{}',{status:503});
    if(s.includes('/paper?'))return new Response(JSON.stringify({ok:true,ledger:null}));
    if(s.includes('crypto-research/baseline-decisions'))return new Response('date,action,pnlPct\n'+yesterday+',trade,1\n');
    if(s.endsWith('.csv'))return new Response('date,action,pnlPct\n');
    return new Response(JSON.stringify({trades:[],variants:[]}));
  };
  const j=await (await daily.onRequestGet({request:new Request('https://fixture.invalid/api/scalping-daily-results?refresh=1'),env:{AUTOTRADE_KEY:'fixture'}})).json();
  const x=j.strategies.find(x=>x.strategy==='crypto');
  assert.equal(x.previous.returnPct,1);assert.equal(x.previous.source,'crypto-research');
  assert.equal(x.status,'degraded');assert.ok(x.sourceWarnings.length);
  globalThis.fetch=originalFetch;
});
function fakeCache(){
  const rows=new Map();
  return {rows,async match(k){return rows.get(String(k))?.clone();},async put(k,v){rows.set(String(k),v.clone());},async delete(k){return rows.delete(String(k));}};
}
const alertEnv={AUTOTRADE_KEY:'fixture-monitor-key',TELEGRAM_BOT_TOKEN:'fixture-token',TELEGRAM_CHAT_ID:'fixture-chat'};
function telegramReceiptStore(){
  const rows=new Map();return new PresaleAlertStore({storage:{async get(k){return structuredClone(rows.get(k))},async put(k,v){rows.set(k,structuredClone(v))}}},{MONITOR_KEY:'fixture-monitor-key'});
}
const alertReq=body=>new Request('https://fixture.invalid/api/scalping-alert',{method:'POST',headers:{'content-type':'application/json','x-monitor-key':'fixture-monitor-key'},body:JSON.stringify({strategy:'crypto',stage:'buy',eventId:'fixture',date,lines:['fixture'],...body})});
await check('failed Telegram is retried, successful web push is not duplicated',async()=>{
  globalThis.caches={default:fakeCache()};let telegram=0,push=0;const receipts=telegramReceiptStore();
  globalThis.fetch=async (url,init)=>{
    if(String(url).endsWith('/signal-telegram'))return receipts.fetch(new Request(url,init));
    if(String(url).includes('api.telegram.org')){telegram++;return new Response(JSON.stringify(telegram===1?{ok:false,description:'fixture rejection'}:{ok:true,result:{message_id:1}}),{status:telegram===1?429:200});}
    push++;return new Response(JSON.stringify({ok:true,duplicate:push>1,delivery:{sent:1}}));
  };
  assert.equal((await alert.onRequestPost({request:alertReq({}),env:alertEnv})).status,502);
  const recovered=await (await alert.onRequestPost({request:alertReq({}),env:alertEnv})).json();
  assert.equal(telegram,2);assert.equal(recovered.messageId,1);assert.equal(recovered.webPush.ok,true);
});
await check('Telegram success cannot lock out a failed web push retry',async()=>{
  globalThis.caches={default:fakeCache()};let telegram=0,push=0;const receipts=telegramReceiptStore();
  globalThis.fetch=async (url,init)=>{
    if(String(url).endsWith('/signal-telegram'))return receipts.fetch(new Request(url,init));
    if(String(url).includes('api.telegram.org')){telegram++;return new Response(JSON.stringify({ok:true,result:{message_id:1}}));}
    push++;return new Response(JSON.stringify(push===1?{ok:false,error:'fixture push outage'}:{ok:true,delivery:{sent:1}}),{status:push===1?502:200});
  };
  assert.equal((await alert.onRequestPost({request:alertReq({}),env:alertEnv})).status,502);
  const recovered=await (await alert.onRequestPost({request:alertReq({}),env:alertEnv})).json();
  assert.equal(push,2);assert.equal(telegram,1);assert.equal(recovered.webPush.ok,true);
});
globalThis.fetch=originalFetch;globalThis.caches=originalCaches;
console.log(`Deep audit: ${passed} PASS / ${failed} FAIL`);
if(failed)process.exit(1);
