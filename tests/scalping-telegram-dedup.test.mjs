import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PresaleAlertStore} from '../worker/presale-alert/src/index.js';
import * as pages from '../functions/api/scalping-alert.js';

const key='fixture-monitor',env={AUTOTRADE_KEY:key,TELEGRAM_BOT_TOKEN:'fixture-token',TELEGRAM_CHAT_ID:'existing-room'};
const date=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const signal=()=>({strategy:'crypto',stage:'sell',eventId:'btc-orb@baseline:00:05:sell:01:05',date:date(),time:'01:05',eventAt:new Date().toISOString(),lines:['KRW-BTC · 메인 baseline · 시간청산']});
async function fixture(run,{Worker=PresaleAlertStore,reply,slowReceiptRead=false}={}){
  const oldFetch=globalThis.fetch,oldCaches=globalThis.caches,state=new Map(),telegram=[],push=[];
  let unavailable=false,completionLost=false;
  const storage={async get(k){const value=structuredClone(state.get(k));if(slowReceiptRead&&k.startsWith('signal-telegram:'))await new Promise(r=>setTimeout(r,10));return value},async put(k,v){if(unavailable)throw Error('storage unavailable');state.set(k,structuredClone(v))},async getAlarm(){return null},async list({prefix}){return new Map([...state].filter(([k])=>k.startsWith(prefix)))}};
  let app;const restart=()=>{app=new Worker({storage},{MONITOR_KEY:key});app.notifyAll=async()=>{push.push('attempt');return {eligible:1,sent:1,failed:0,removed:0,sentKeys:['fixture-device']};};};restart();
  globalThis.caches=undefined;
  globalThis.fetch=async(u,init={})=>{
    const path=new URL(u).pathname;
    if(path==='/signal'||path==='/signal-telegram'){
      if(completionLost&&JSON.parse(init.body).op==='complete')return Response.json({ok:false,error:'completion response lost'},{status:503});
      return app.fetch(new Request(u,init));
    }
    assert.ok(String(u).startsWith('https://api.telegram.org/botfixture-token/sendMessage'),'no other network destination');
    const body=JSON.parse(init.body);assert.equal(body.chat_id,'existing-room');telegram.push(body);
    return reply?reply(telegram.length):Response.json({ok:true,result:{message_id:telegram.length}});
  };
  const post=(b=signal(),module=pages)=>module.onRequestPost({request:new Request('https://app.test/api/scalping-alert',{method:'POST',headers:{'x-monitor-key':key},body:JSON.stringify(b)}),env});
  const receipt=b=>app.fetch(new Request('https://push.test/signal-telegram',{method:'POST',headers:{'x-monitor-key':key},body:JSON.stringify(b)}));
  try{return await run({post,receipt,state,telegram,push,restart,get app(){return app},storageDown(){unavailable=true},loseCompletion(){completionLost=true}});}
  finally{globalThis.fetch=oldFetch;globalThis.caches=oldCaches;}
}

async function concurrent(Worker=PresaleAlertStore){
  await fixture(async x=>{
    const b=signal(),responses=await Promise.all(Array.from({length:20},()=>x.post({...b})));
    assert.ok(responses.every(r=>r.ok));assert.equal(x.telegram.length,1);assert.equal(x.push.length,1);
    assert.match(x.telegram[0].text,/^\[지피티 연구 비트코인\] 🔴 매도/);
  },{Worker});
}
test('20 simultaneous requests, no cache: one Telegram and one push',()=>concurrent());
async function simultaneousClaims(Worker=PresaleAlertStore){
  await fixture(async x=>{
    const b={...signal(),op:'claim'},r=await Promise.all(Array.from({length:10},async()=> (await x.receipt(b)).json()));
    assert.equal(r.filter(x=>x.claimed).length,1,'only one durable send permit');
  },{Worker,slowReceiptRead:true});
}
test('concurrent claims cannot race while the durable read is pending',()=>simultaneousClaims());
test('restart and separate Pages module cannot replay an accepted event',async()=>{
  await fixture(async x=>{
    const b=signal();assert.equal((await x.post(b)).status,200);x.restart();
    const file=new URL('../functions/api/scalping-alert.js',import.meta.url),other=await import(file.href+'?separate-pages-location');
    const j=await(await x.post(b,other)).json();assert.equal(j.duplicate,true);assert.equal(j.telegram.status,'sent');
    assert.equal(x.telegram.length,1);assert.equal(x.push.length,1);
  });
});
async function unknown(Worker=PresaleAlertStore){
  await fixture(async x=>{
    const b=signal();await x.post(b);x.restart();const j=await(await x.post(b)).json();
    assert.equal(x.telegram.length,1);assert.equal(j.telegram.status,'unknown');
  },{Worker,reply:()=>{throw Error('connection lost after possible acceptance')}});
}
test('timeout after possible acceptance is never retried, even after restart',()=>unknown());
test('5xx and malformed Telegram responses are unknown, not definite rejection',async()=>{
  for(const reply of [()=>Response.json({ok:false},{status:503}),()=>new Response('not JSON'),()=>Response.json({ok:true,result:{}})])
    await fixture(async x=>{const b=signal();await x.post(b);await x.post(b);assert.equal(x.telegram.length,1);},{reply});
});
test('definite 429 rejection retries Telegram only; successful push is preserved',async()=>{
  await fixture(async x=>{
    const b=signal();assert.equal((await x.post(b)).status,502);
    const j=await(await x.post(b)).json();assert.equal(j.telegram.status,'sent');
    assert.equal(x.telegram.length,2);assert.equal(x.push.length,1);await x.post(b);assert.equal(x.telegram.length,2);
  },{reply:n=>n===1?Response.json({ok:false,description:'retry later'},{status:429}):Response.json({ok:true,result:{message_id:42}})});
});
test('definite rejection is bounded to three attempts',async()=>{
  await fixture(async x=>{const b=signal();for(let i=0;i<6;i++)await x.post(b);assert.equal(x.telegram.length,3);assert.equal(x.push.length,1);},
    {reply:()=>Response.json({ok:false,description:'forbidden'},{status:403})});
});
test('push failure retries push only, never the successful Telegram',async()=>{
  await fixture(async x=>{
    let attempts=0;x.app.notifyAll=async()=>({eligible:1,sent:++attempts===1?0:1,failed:attempts===1?1:0,removed:0,sentKeys:attempts===1?[]:['device']});
    const b=signal();assert.equal((await x.post(b)).status,502);assert.equal((await x.post(b)).status,200);
    assert.equal(attempts,2);assert.equal(x.telegram.length,1);
  });
});
test('receipt storage outage fails closed without direct Telegram fallback',async()=>{
  await fixture(async x=>{x.storageDown();assert.equal((await x.post()).status,500);assert.equal(x.telegram.length,0);});
});
test('lost completion keeps the pre-send unknown receipt and blocks replay',async()=>{
  await fixture(async x=>{x.loseCompletion();const b=signal();const j=await(await x.post(b)).json();assert.equal(j.telegram.status,'unknown');x.restart();await x.post(b);assert.equal(x.telegram.length,1);});
});
test('authentication, one-use tokens, buy/sell separation and webOnly are preserved',async()=>{
  await fixture(async x=>{
    const b=signal();assert.equal((await x.app.fetch(new Request('https://push.test/signal-telegram',{method:'POST',body:'{}'}))).status,401);
    const c=await(await x.receipt({...b,op:'claim'})).json();
    assert.equal((await x.receipt({...b,op:'complete',token:'wrong',receipt:{status:'sent',messageId:1}})).status,409);
    assert.equal((await x.receipt({...b,op:'complete',token:c.token,receipt:{status:'failed'}})).status,400);
    await x.post({...b,eventId:'buy',stage:'buy'});await x.post({...b,eventId:'sell'});await x.post({...b,eventId:'web-only',webOnly:true});
    assert.equal(x.telegram.length,2);assert.ok(x.telegram[0].text.includes('🟢 매수'));
    const health=await(await x.app.fetch(new Request('https://push.test/health'))).json();
    assert.equal(health.telegramSignalDedup.store,'durable-object');assert.equal(health.lastTelegramDeliveries.crypto.status,'sent');
    assert.ok(!JSON.stringify(health).includes('existing-room'));
  });
});
test('stale signals and summaries send neither channel',async()=>{
  await fixture(async x=>{
    const b=signal();assert.equal((await(await x.post({...b,eventAt:new Date(Date.now()-21*60_000).toISOString()})).json()).skipped,'stale_or_future_signal');
    await x.post({...b,stage:'summary'});assert.equal(x.telegram.length,0);assert.equal(x.push.length,0);
  });
});
test('alert-only deployment keeps the historical ledger backfill out of scope',()=>{
  const y=fs.readFileSync(new URL('../.github/workflows/deploy-global-intraday-scheduler.yml',import.meta.url),'utf8');
  assert.match(y,/git diff --quiet "\$BEFORE_SHA" HEAD -- worker\/global-intraday-scheduler scripts\/backfill_scalping_paper.py/);
  assert.match(y,/if: steps\.ledger_scope\.outputs\.backfill == 'true'/);
  assert.match(y,/\[ "\$EVENT_NAME" = "workflow_dispatch" \]/);
});
test('value mutants: replayed sent receipt, replayed unknown, missing serialization',async()=>{
  const file=new URL('../worker/presale-alert/src/index.js',import.meta.url),source=fs.readFileSync(file,'utf8');
  for(const [from,to,check] of [
    ['if(previous&&(previous.status!=="failed"||previous.tries>=3))','if(false)',concurrent],
    ['previous.status!=="failed"','previous.status==="sent"',unknown],
    ['(this.signalTelegramQueue||Promise.resolve()).catch(()=>{}).then(()=>this.tradingTelegramReceipt(request))','Promise.resolve(this.tradingTelegramReceipt(request))',simultaneousClaims]
  ]){
    assert.ok(source.includes(from));
    const mutant=source.replace(from,to).replace(/from (["'])(\.\.?\/[^"']+)\1/g,(_,q,p)=>'from '+q+new URL(p,file).href+q);
    const m=await import('data:text/javascript;base64,'+Buffer.from(mutant).toString('base64'));
    await assert.rejects(()=>check(m.PresaleAlertStore),{name:'AssertionError'},'mutant must fail: '+from);
  }
});
