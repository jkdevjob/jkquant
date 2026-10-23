import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {marketDayCache,marketDayEvidence,MARKET_DAY_TTL_MS} from '../functions/api/_market-day-cache.js';
const date='2026-10-23',key='fixture-monitor';
const evidence=(open=true)=>({ok:true,market:'KRX',date,open,opndYn:open?'Y':'N',source:'KIS/CTCA0903R',env:'real',checkedAt:new Date().toISOString()});
const environment={AUTOTRADE_KEY:key,KIS_VTS_APPKEY:'fixture-vts-key',KIS_VTS_APPSECRET:'fixture-vts-secret',KIS_REAL_APPKEY:'fixture-real-key',KIS_REAL_APPSECRET:'fixture-real-secret'};
const file=new URL('../functions/api/kis.js',import.meta.url);
const source=fs.readFileSync(file,'utf8');
let sequence=0;
const fresh=()=>import(file.href+'?market-test='+ ++sequence);
function world({open=true,invalidFlag=false,sourceDown=false,sharedDown=false,cacheHelper=marketDayCache,concurrent=false}={}){
  const values=new Map([['original-trade-ledger',{events:[{id:'immutable'}]}]]),calls=[],writes=[];
  const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{values.set(k,structuredClone(v));writes.push(v);}};
  const fetch=async(url,init={})=>{
    const u=new URL(url);calls.push({url:u,method:init.method||'GET'});
    if(u.pathname==='/market-day'){
      if(sharedDown)throw Error('cache unavailable');
      assert.equal(init.headers['x-monitor-key'],key);
      return cacheHelper(storage,new Request(url,init));
    }
    assert.equal(u.hostname,'openapi.koreainvestment.com','VTS calendar lookup must not occur');
    if(u.pathname==='/oauth2/tokenP'){
      if(concurrent)values.set('market-day:'+date,evidence(open));
      return sourceDown?Response.json({error_description:'token issuance rate limit'},{status:429}):Response.json({access_token:'fixture-real-token-abcdefghijklmnopqrstuvwxyz',expires_in:86400});
    }
    assert(u.pathname.endsWith('/quotations/chk-holiday'),'read-only calendar query only');
    assert.equal(init.headers.tr_id,'CTCA0903R');
    return Response.json({rt_cd:'0',output:[{bass_dt:date.replaceAll('-',''),opnd_yn:invalidFlag?'':open?'Y':'N'}]});
  };
  return {values,calls,writes,fetch};
}
async function using(w,fn){
  const previous=globalThis.fetch,previousCaches=globalThis.caches;
  globalThis.fetch=w.fetch;globalThis.caches=undefined;
  try{return await fn();}finally{globalThis.fetch=previous;globalThis.caches=previousCaches;}
}
const read=(pages,d=date)=>pages.onRequestGet({request:new Request('https://app.test/api/kis?op=holiday&env=vts&market=kr&date='+d.replaceAll('-','')),env:environment});

async function coldIsolates(pagesLoader=fresh){
  const w=world();
  await using(w,async()=>{
    const first=await read(await pagesLoader());assert.equal(first.status,200);assert.equal((await first.json()).open,true);
    assert.equal(w.calls.filter(c=>c.url.pathname==='/oauth2/tokenP').length,1);
    for(let i=0;i<5;i++){
      const r=await read(await pagesLoader());assert.equal(r.status,200);assert.equal((await r.json()).open,true);
    }
    assert.equal(w.calls.filter(c=>c.url.hostname==='openapi.koreainvestment.com').length,2,'fresh Pages locations reuse persisted evidence, no token or holiday query');
    assert.equal(w.calls.filter(c=>c.url.hostname==='openapivts.koreainvestment.com').length,0,'unsupported VTS calendar query is never attempted');
    assert.equal(w.writes.length,1);
    assert.doesNotMatch(JSON.stringify(w.writes),/token|appkey|secret|fixture-/i,'cache stores exchange-day facts only');
    assert.deepEqual(w.values.get('original-trade-ledger'),{events:[{id:'immutable'}]});
  });
}
test('운영 누락 재현: Pages 인스턴스 6개가 개장일 한 번 확인 후 같은 영속 근거를 재사용한다',()=>coldIsolates());
test('공식 휴장 N도 공유하며 시세·주문 없이 false를 유지한다',async()=>{
  const w=world({open:false});await using(w,async()=>{
    assert.equal((await(await read(await fresh())).json()).open,false);
    assert.equal((await(await read(await fresh())).json()).open,false);
    assert.equal(w.calls.filter(c=>c.url.pathname.endsWith('/chk-holiday')).length,1);
  });
});
test('개장일 공유 근거가 있으면 토큰 발급 장애에도 감시 가능; 근거 없으면 unknown으로 차단한다',async()=>{
  const w=world({sourceDown:true});w.values.set('market-day:'+date,evidence());
  await using(w,async()=>{assert.equal((await read(await fresh())).status,200);assert.equal(w.calls.length,1);});
  w.values.delete('market-day:'+date);
  await using(w,async()=>{const r=await read(await fresh());assert.equal(r.status,502);assert.equal((await r.json()).unknown,true);});
});
test('동시 위치가 공식 답을 저장한 경우 실패 후 근거만 다시 읽고 토큰 재발급은 하지 않는다',async()=>{
  const w=world({sourceDown:true,concurrent:true});await using(w,async()=>{
    const r=await read(await fresh());assert.equal(r.status,200);assert.equal((await r.json()).open,true);
    assert.equal(w.calls.filter(c=>c.url.pathname==='/oauth2/tokenP').length,1);
    assert.equal(w.calls.filter(c=>c.url.pathname==='/market-day').length,2);
  });
});
test('공유 저장소 장애 때는 공식 응답만 쓰며 유효한 개장 Y/N 누락을 휴장으로 확정하지 않는다',async()=>{
  for(const [options,status] of [[{sharedDown:true},200],[{invalidFlag:true},502]]){
    const w=world(options);await using(w,async()=>{const r=await read(await fresh());assert.equal(r.status,status);if(status===502)assert.equal((await r.json()).unknown,true);});
  }
});
test('잘못된 날짜·출처·오래된 값·미래 시간·Y/N 불일치는 공유 근거가 아니다',async()=>{
  const now=Date.now(),good=evidence();
  assert(marketDayEvidence(good,date,now));
  for(const bad of [{...good,date:'2026-10-22'},{...good,source:'weekday guess'},{...good,open:false},{...good,checkedAt:null},
    {...good,checkedAt:new Date(now-MARKET_DAY_TTL_MS).toISOString()},{...good,checkedAt:new Date(now+90001).toISOString()}])
    assert.equal(marketDayEvidence(bad,date,now),null);
  const w=world({sourceDown:true});w.values.set('market-day:'+date,{...good,checkedAt:new Date(now-MARKET_DAY_TTL_MS).toISOString()});
  await using(w,async()=>{assert.equal((await read(await fresh())).status,502);assert.equal((await read(await fresh(),'2026-02-30')).status,400);});
});
test('Worker 공유 경로는 인증·검증 없이 저장하지 않으며 원본 매매를 건드리지 않는다',async()=>{
  const workerSource=fs.readFileSync(new URL('../worker/opening-scheduler/src/index.js',import.meta.url),'utf8')
    .replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {constructor(ctx,env){this.ctx=ctx;this.env=env;}};')
    .replaceAll('../../../functions/api/',new URL('../functions/api/',import.meta.url).href);
  const module=await import('data:text/javascript;base64,'+Buffer.from(workerSource).toString('base64'));
  const values=new Map(),storage={get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)};
  const store=new module.OpeningSignalStore({storage},{}),env={MONITOR_KEY:key,SIGNAL_STORE:{idFromName:x=>x,get:()=>({fetch:r=>store.fetch(r)})}};
  const call=(method,body,authorized=true)=>module.default.fetch(new Request('https://worker.test/market-day?date='+date,{method,headers:{...(authorized?{'x-monitor-key':key}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env);
  assert.equal((await call('POST',evidence(),false)).status,401);assert.equal(values.size,0);
  assert.equal((await call('PUT')).status,405);
  assert.equal((await call('POST',{...evidence(),open:false})).status,400);assert.equal(values.size,0);
  assert.equal((await call('POST',evidence())).status,200);
  assert.equal((await(await call('GET')).json()).evidence.open,true);assert.equal(values.size,1);
});
test('값 변이: 공유 조회·실전 조회 전용·유효 Y/N·날짜·만료 검증 누락은 실패한다',async()=>{
  const load=async s=>import('data:text/javascript;base64,'+Buffer.from(s.replace('"./_market-day-cache.js"',JSON.stringify(new URL('../functions/api/_market-day-cache.js',import.meta.url).href))).toString('base64'));
  const mutant=source.replace('if (shared) return responseFor(shared);','');assert.notEqual(mutant,source);
  await assert.rejects(()=>coldIsolates(()=>load(mutant+'\n// instance '+ ++sequence)),{name:'AssertionError'});
  const unsupported=source.replace("const order = ['real'];","const order = ['vts','real'];");
  assert.notEqual(unsupported,source);
  await assert.rejects(()=>coldIsolates(()=>load(unsupported+'\n// instance '+ ++sequence)),{name:'AssertionError'});
  const noFlagCheck=source.replace('if (![\'Y\',\'N\'].includes(opndYn)) throw new Error("응답에 유효한 개장 여부가 없습니다.");','');
  assert.notEqual(noFlagCheck,source);
  const invalid=world({invalidFlag:true});
  await assert.rejects(()=>using(invalid,async()=>assert.equal((await read(await load(noFlagCheck))).status,502)),{name:'AssertionError'});
  const cacheFile=new URL('../functions/api/_market-day-cache.js',import.meta.url),cacheSource=fs.readFileSync(cacheFile,'utf8');
  for(const [from,to,value] of [
    ['value.date !== date','false',{...evidence(),date:'2026-10-22'}],
    ['now - at >= MARKET_DAY_TTL_MS','false',{...evidence(),checkedAt:new Date(Date.now()-MARKET_DAY_TTL_MS).toISOString()}]
  ]){
    assert(cacheSource.includes(from));const m=await import('data:text/javascript;base64,'+Buffer.from(cacheSource.replace(from,to)).toString('base64'));
    assert.throws(()=>assert.equal(m.marketDayEvidence(value,date),null),{name:'AssertionError'});
  }
});
