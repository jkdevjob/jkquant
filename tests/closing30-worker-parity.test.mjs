import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {closingBrokerPlans} from '../functions/api/_research-orders.js';
const file=new URL('../worker/opening-scheduler/src/index.js',import.meta.url);
const source=fs.readFileSync(file,'utf8');
const load=async(src=source)=>import('data:text/javascript;base64,'+Buffer.from(src
  .replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {};')
  .replaceAll('../../../functions/api/',new URL('../functions/api/',import.meta.url).href)
  +'\nexport {closingPaperMain};').toString('base64'));
function storage(){
  const data=new Map(),st={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),transaction:async fn=>fn(st)};
  return st;
}
async function harness(src=source){
  const mod=await load(src),stores=new Map();
  const env={SIGNAL_STORE:{idFromName:x=>x,get:id=>{
    if(!stores.has(id)){const s=new mod.OpeningSignalStore();s.ctx={storage:storage()};s.env=env;stores.set(id,s);}
    return {fetch:async(url,init)=>stores.get(id).fetch(new Request(url,init))};
  }}};
  return {mod,env,call:async(path,body,id='__closing_paper_config__')=>{
    const r=await env.SIGNAL_STORE.get(id).fetch('https://internal'+path,body?{method:'POST',body:JSON.stringify(body)}:{});
    return {status:r.status,...await r.json()};
  }};
}
const date='2026-11-10',append={date,mainVariant:'baseline',paperKind:'day',paperMainVariant:'dip_2',
  scanId:'closing:'+date+':closing_day_signal',targetHm:1506,events:[{id:'original',kind:'day',variant:'dip_2',code:'005930',stage:'signal'}]};

test('closing paper config has separate day/overnight namespaces and validates parameters',async()=>{
  const h=await harness(),q='/closing-config?strategy=closing30';
  assert.equal((await h.call(q)).config.selectedVariant,'baseline');
  assert.equal((await h.call(q,{variant:'invented',effectiveFrom:'2026-11-11'})).status,400);
  assert.equal((await h.call(q,{variant:'cf_g0001',params:{side:'dip',threshold:-99,volume:1},effectiveFrom:'2026-11-11'})).status,400);
  const a=await h.call(q,{variant:'dip_2',effectiveFrom:'2026-11-11',source:'auto-7-session-leader'});
  assert.equal(a.config.paperOnly,true);assert.equal(a.config.selectedVariant,'dip_2');
  assert.equal((await h.call('/closing-config?strategy=closing_bet')).config.selectedVariant,'baseline');
  assert.equal((await h.call('/config',null,'__gpt_opening_strategy_config__')).config.selectedVariant,'baseline');
  assert.equal((await h.mod.closingPaperMain(h.env,date,'day')).variant,'baseline');
  assert.equal((await h.mod.closingPaperMain(h.env,'2026-11-11','day')).variant,'dip_2');
});
test('same-day main and original event are immutable across retries and later config promotion',async()=>{
  const h=await harness(),id='closing30:'+date;
  await h.call('/append',append,id);
  await h.call('/append',{...append,paperMainVariant:'dip_3',events:[{...append.events[0],variant:'dip_3'}]},id);
  await h.call('/closing-config?strategy=closing30',{variant:'dip_3',effectiveFrom:date});
  const l=(await h.call('/ledger',null,id)).ledger;
  assert.equal(l.paperMainVariants.day,'dip_2');assert.equal(l.events.length,1);assert.equal(l.events[0].variant,'dip_2');
  assert.equal((await h.mod.closingPaperMain(h.env,date,'day')).variant,'dip_2');
  // Research-main promotion does not turn on a broker or change the established broker baseline.
  const brokerLedger={...l,scans:[],events:[...l.events,{id:'base',code:'000660',variant:'baseline',kind:'day',stage:'signal',createdAt:date+'T15:06:00+09:00'}]};
  const plans=closingBrokerPlans(brokerLedger,'day','buy',date);
  assert.equal(plans.length,1);assert.equal(plans[0].code,'000660');assert.equal(plans[0].variant,'baseline');
});
test('value mutation catches rewriting the locked paper main',async()=>{
  const mutant=source.replace("if(!ledger.paperMainVariants[b.paperKind])",'if(true)');assert.notEqual(mutant,source);
  const h=await harness(mutant),id='closing30:'+date;
  await h.call('/append',append,id);await h.call('/append',{...append,paperMainVariant:'dip_3'},id);
  await assert.rejects(async()=>assert.equal((await h.call('/ledger',null,id)).ledger.paperMainVariants.day,'dip_2'),{name:'AssertionError'});
});
