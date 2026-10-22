import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import {onRequestGet} from '../functions/api/closing30-monitor.js';
const date='2026-10-22',env={AUTOTRADE_KEY:'fixture'},storage=new AsyncLocalStorage();
const codes=Array.from({length:50},(_,i)=>String(i+1).padStart(6,'0'));
function minutes(code){
 const n=Number(code),step=1000+n;
 return [...Array.from({length:65},(_,i)=>{const m=14*60+20+i;return {t:date+' '+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'),close:95,high:95,vol:(i+1)*step};}),
  {t:date+' 15:30',close:99999,high:99999,vol:999999999}];
}
async function fixture(fn=onRequestGet,failCode=null){
 const oldFetch=globalThis.fetch,oldNow=Date.now,budgets=[];
 Date.now=()=>Date.parse(date+'T15:40:00+09:00');
 const invoke=async(q,key='fixture')=>{
  const budget={count:0};budgets.push(budget);
  return storage.run(budget,()=>fn({request:new Request('https://app/api/closing30-monitor?'+q,{headers:{'x-monitor-key':key}}),env}));
 };
 globalThis.fetch=async(input,init)=>{
  const current=storage.getStore();if(++current.count>50)throw Error('Too many subrequests by single Worker invocation');
  const url=new URL(String(input));
  if(url.pathname==='/api/closing30-monitor'){
   assert.equal(init.headers['x-monitor-key'],'fixture');
   return invoke(url.searchParams.toString());
  }
  if(url.pathname==='/api/universe')return Response.json({universe:codes.map(code=>({code,name:'종목'+code}))});
  if(url.pathname==='/api/quote'){
   const code=url.searchParams.get('symbol');if(code===failCode)return Response.json({error:'source unavailable'},{status:502});
   return Response.json(url.searchParams.has('minute')?{minutes:minutes(code)}:{ohlc:[{date:'2026-10-21',open:100,close:100},{date,open:100,close:100+Number(code)/100}]});
  }
  throw Error('unexpected source '+url);
 };
 return {invoke,budgets,close(){globalThis.fetch=oldFetch;Date.now=oldNow;}};
}
async function scan(fn=onRequestGet,failCode=null){
 const x=await fixture(fn,failCode);try{return {data:await (await x.invoke('op=scan&kind=day&date='+date)).json(),budgets:x.budgets};}finally{x.close();}
}
test('Top50 complete universe stays within 50 subrequests per invocation with the same global winners',async()=>{
 const {data,budgets}=await scan();assert.equal(data.ok,true);assert.equal(data.scanned,50);assert.equal(data.valid,50);assert.equal(data.partial,false);assert.equal(data.errors.length,0);
 assert.deepEqual(data.signals.filter(x=>x.variant==='baseline').map(x=>x.code),['000050','000049','000048']);
 assert.ok(data.signals.every(x=>x.signal.signalPrice===95)); // 15:30 future spike excluded.
 assert.ok(budgets.length>1);assert.ok(budgets.every(x=>x.count<=50));assert.equal(budgets[0].count,6);
});
test('all 35 price lookups preserve official prices and times without hitting the request budget',async()=>{
 const x=await fixture();try{
  const j=await (await x.invoke('op=prices&stage=overnight_entry&date='+date+'&codes='+codes.slice(0,35).join(','))).json();
  assert.equal(j.prices.length,35);assert.equal(j.errors.length,0);assert.equal(j.missing,0);
  assert.equal(j.prices.find(x=>x.code==='000035').price,100.35);
  assert.ok(j.prices.every(x=>x.priceAt===date+'T15:30:00+09:00'));
  assert.ok(x.budgets.every(x=>x.count<=50));assert.equal(x.budgets[0].count,4);
 }finally{x.close();}
});
test('real quote failure is still partial and never converted into a complete no-trade day',async()=>{
 const {data}=await scan(onRequestGet,'000025');assert.equal(data.partial,true);assert.equal(data.valid,49);assert.ok(data.errors.some(x=>x.code==='000025'));assert.equal(data.scanned,50);
});
test('internal batches require the same key and reject oversized or malformed input before quotes',async()=>{
 const x=await fixture();try{
  assert.equal((await x.invoke('op=feature-batch&kind=day&date='+date+'&inputs='+encodeURIComponent(JSON.stringify(codes.map(code=>({code})))))).status,400);
  assert.equal((await x.invoke('op=price-batch&stage=day_exit&date='+date+'&inputs='+encodeURIComponent('["../x"]'))).status,400);
  assert.equal((await x.invoke('op=feature-batch&kind=day&date='+date+'&inputs=[]','wrong')).status,401);
  assert.ok(x.budgets.every(x=>x.count===0));
 }finally{x.close();}
});
test('value mutants catch one large batch and narrowing the universe within each batch',async()=>{
 const file=new URL('../functions/api/closing30-monitor.js',import.meta.url);
 const source=fs.readFileSync(file,'utf8').replace(/from "(\.\/[^\"]+)"/g,(_,p)=>'from "'+new URL(p,file).href+'"');
 for(const mutant of [source.replace('BATCH_SIZE=10','BATCH_SIZE=50'),source.replace('j.features||j.prices||[]','(j.features||j.prices||[]).slice(0,3)')]){
  const mod=await import('data:text/javascript;base64,'+Buffer.from(mutant).toString('base64'));
  const {data}=await scan(mod.onRequestGet);
  assert.throws(()=>{assert.equal(data.partial,false);assert.equal(data.valid,50);assert.deepEqual(data.signals.filter(x=>x.variant==='baseline').map(x=>x.code),['000050','000049','000048']);},assert.AssertionError);
 }
});
