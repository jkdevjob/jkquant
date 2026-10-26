import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PAPER_STRATEGIES,defaultPaperSettings,changePaperSettings,validPaperSettings,paperPermission} from '../functions/api/_paper-trading.js';
import {openingOrderRefs,openingExecutionResult,openingBroker} from '../functions/api/_opening-execution.js';
import {onRequest} from '../functions/api/paper-trading-settings.js';
import {openingRecords,uniqueRecords,recordsCsv} from '../functions/api/_trade-history.js';
import {summarizeOpeningLedger} from '../functions/api/scalping-live-results.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const dataImport=src=>import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
const workerSrc=read('worker/opening-scheduler/src/index.js');
async function loadWorker(src=workerSrc){return dataImport(src.replace('import { DurableObject } from "cloudflare:workers";', 'class DurableObject{constructor(ctx,env){this.ctx=ctx;this.env=env}}')
 .replace(/"\.\.\/\.\.\/\.\.\/functions\/api\/([^"]+)"/g,(_,f)=>JSON.stringify(new URL('../functions/api/'+f,import.meta.url).href)));}
const W=await loadWorker(),date='2026-10-22',envKey={AUTOTRADE_KEY:'fixture',MONITOR_KEY:'fixture'};
const signal={code:'005930',name:'삼성전자',entryTime:907,entryPrice:100000,exitTime:930,exitPrice:101000,pnl:.75};
const event=(stage,variant='baseline')=>({id:variant+':'+stage,stage,date,variant,code:signal.code,name:signal.name,targetHm:stage==='buy'?907:930,strategyVersion:'v1',signal:{...signal}});
function memoryStore(Class=W.OpeningSignalStore){
 const objects=new Map();const h={failPhase:'',objects,idFromName:n=>n,get(name){
  if(!objects.has(name)){
   const values=new Map();let tail=Promise.resolve();
   const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>{
    if(typeof k==='object'){for(const [a,b] of Object.entries(k))values.set(a,structuredClone(b));return;}
    if(k==='ledger'&&h.failPhase&&v.executionEvents?.at(-1)?.phase===h.failPhase)throw Error('storage unavailable');
    values.set(k,structuredClone(v));
   }};
   storage.transaction=fn=>{const r=tail.then(()=>fn(storage));tail=r.catch(()=>{});return r;};
   const obj=new Class({storage},envKey);objects.set(name,{values,obj});
  }const {obj}=objects.get(name);return {fetch:(input,init)=>obj.fetch(new Request(input,init))};
 }};return h;
}
function world(worker=W){
 const store=memoryStore(worker.OpeningSignalStore),env={...envKey,SIGNAL_STORE:store},calls=[];
 store.get(date);store.objects.get(date).values.set('ledger',{date,mainVariant:'baseline',scans:[],events:[event('buy'),event('sell')]});
 const h={store,env,calls,mode:'off',async fetch(input,init={}){
  const u=String(input);calls.push(u);
  if(u.includes('identitytoolkit'))return Response.json({users:[{email:h.member?'member@example.com':'jk82investing@gmail.com'}]});
  if(u.endsWith('/paper-settings')){
   if(h.mode==='down')throw Error('settings unavailable');
   if(h.mode==='bad')return Response.json({ok:true,settings:{schema:1}});
   if(h.mode==='on')return Response.json({ok:true,settings:changePaperSettings(defaultPaperSettings(),{expectedRevision:0,strategy:'gpt_opening',enabled:true,budget:300000})});
   return worker.default.fetch(new Request(u,init),env);
  }
  if(u.includes('/api/kis?op=order&'))return Response.json(h.reject?{ok:false,raw:{rt_cd:'1'},msg:'주문 거절'}:{ok:true,orderNo:'12345',msg:'접수'}, {status:h.reject?502:200});
  if(u.endsWith('/api/opening-execute')){
   assert.equal(store.objects.get(date).values.get('ledger').executionEvents.at(-1).phase,'intent','intent durably saved before HTTP');
   if(h.throwExecute)throw Error('connection reset');
   return h.executeResponse||Response.json({ok:true,enabled:false,reason:'전략 모의투자 OFF',events:[]});
  }throw Error('unexpected fetch '+u);
 },ledger:()=>structuredClone(store.objects.get(date).values.get('ledger'))};return h;
}
async function mocked(h,fn){const old=globalThis.fetch;globalThis.fetch=h.fetch.bind(h);try{return await fn();}finally{globalThis.fetch=old;}}
const ownerRequest=(method='GET',patch)=>new Request('https://app/api/paper-trading-settings',{method,headers:{Authorization:'Bearer fixture'},...(patch?{body:JSON.stringify(patch)}:{})});
const patch={expectedRevision:0,strategy:'gpt_opening',enabled:true,budget:300000};
test('research strategies (GPT 7 · Claude 5) default OFF; malformed/unsupported/budget settings rejected',()=>{
 const s=defaultPaperSettings();assert.equal(PAPER_STRATEGIES.length,12);assert.ok(Object.values(s.strategies).every(x=>x.enabled===false));assert.ok(validPaperSettings(s));
 for(const change of [{...patch,budget:9999},{...patch,budget:100000001},{...patch,budget:1.5},{...patch,enabled:'true'},{...patch,strategy:'gpt_crypto'},{...patch,strategy:'claude_crypto'},{...patch,strategy:'claude_unknown'}])assert.throws(()=>changePaperSettings(s,change));
 assert.equal(s.revision,0);assert.equal(s.strategies.gpt_opening.enabled,false);
 assert.throws(()=>changePaperSettings(s,{...patch,expectedRevision:1}),e=>e.status===409);
});
test('owner API writes durable settings; reload, global stop and all-OFF persist without order calls',async()=>{
 const h=world();await mocked(h,async()=>{
  let r=await onRequest({request:ownerRequest(),env:h.env}),j=await r.json();assert.equal(j.settings.revision,0);assert.equal(j.strategies.length,12);
  r=await onRequest({request:ownerRequest('POST',patch),env:h.env});j=await r.json();assert.equal(r.status,200);assert.equal(j.settings.strategies.gpt_opening.enabled,true);assert.equal(j.settings.strategies.gpt_opening.budget,300000);
  j=await (await onRequest({request:ownerRequest(),env:{...h.env,SCALPING_VTS_AUTO:'0'}})).json();assert.equal(j.settings.revision,1);assert.equal(j.globalStopped,true);
  j=await (await onRequest({request:ownerRequest('POST',{allOff:true,expectedRevision:1,secret:'must not persist'}),env:h.env})).json();assert.equal(j.settings.revision,2);assert.ok(Object.values(j.settings.strategies).every(x=>!x.enabled));
  assert.doesNotMatch(JSON.stringify(h.store.objects.get('__paper_settings__').values.get('paperSettingsHistory')),/must not persist/);
  assert.ok(h.calls.every(u=>!u.includes('/api/kis')&&!u.includes('opening-execute')));
 });
});
test('CAS concurrent writes cannot silently overwrite another browser; existing settings preserved',async()=>{
 const h=world(),req=p=>new Request('https://worker/paper-settings',{method:'POST',headers:{'x-monitor-key':'fixture'},body:JSON.stringify(p)});
 const rs=await Promise.all([W.default.fetch(req(patch),h.env),W.default.fetch(req({...patch,budget:500000}),h.env)]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);
 const s=h.store.objects.get('__paper_settings__').values.get('paperSettings');assert.equal(s.revision,1);assert.equal(s.strategies.gpt_opening.budget,300000);
});
test('settings owner/monitor authorization and method validation prevent unauthorized reads/writes',async()=>{
 const h=world();await mocked(h,async()=>{
  const no=new Request('https://app/api/paper-trading-settings');assert.equal((await onRequest({request:no,env:h.env})).status,401);assert.equal(h.calls.length,0);
  h.member=true;assert.equal((await onRequest({request:ownerRequest('POST',patch),env:h.env})).status,401);assert.equal(h.store.objects.has('__paper_settings__'),false);
  assert.equal((await W.default.fetch(new Request('https://worker/paper-settings'),h.env)).status,401);
  h.member=false;assert.equal((await onRequest({request:ownerRequest('DELETE'),env:h.env})).status,405);
 });
});
async function executionEndpoint(src=read('functions/api/opening-execute.js')){
 return (await dataImport(src.replace(/'\.\/(_paper-trading|_opening-execution)\.js'/g,(_,f)=>JSON.stringify(new URL('../functions/api/'+f+'.js',import.meta.url).href))+'\n// isolated '+Math.random())).onRequestPost;
}
async function atOpening(fn){const old=globalThis.Date,now=old.parse(date+'T09:08:00+09:00');globalThis.Date=class extends old{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}};try{return await fn();}finally{globalThis.Date=old;}}
const executeReq=()=>new Request('https://app/api/opening-execute',{method:'POST',headers:{'x-monitor-key':'fixture'},body:JSON.stringify({date,buyEvents:[signal],sellEvents:[]})});
async function checkGuard(endpoint){
 endpoint ||= await executionEndpoint();
 for(const mode of ['off','down','bad']){
  const h=world();h.mode=mode;
  await mocked(h,()=>atOpening(async()=>{const r=await endpoint({request:executeReq(),env:h.env}),j=await r.json();assert.equal(j.enabled,false);assert.equal(r.status,mode==='off'?200:503);assert.equal(h.calls.filter(u=>u.includes('/api/kis')).length,0);}));
 }
}
test('OFF, absent settings and config outages all stop the actual order handler before KIS calls',()=>checkGuard());
test('only ON enables VTS budget sizing; explicit rejection differs from accepted order receipt',async()=>{
 for(const reject of [false,true]){
  const endpoint=await executionEndpoint(),h=world();h.mode='on';h.reject=reject;
  await mocked(h,()=>atOpening(async()=>{const j=await (await endpoint({request:executeReq(),env:h.env})).json();assert.equal(j.events[0].qty,3);assert.equal(j.events[0].vts.ok,!reject);assert.equal(j.events[0].vts.rejected,reject);assert.equal(h.calls.filter(u=>u.includes('/api/kis')).length,1);
   const intent={id:'i',date,requests:openingOrderRefs(date,[signal])},result=openingExecutionResult(intent,j,200);assert.equal(result.ordersOk,!reject);assert.equal(result.receipts[0].status,reject?'rejected':'accepted');
  }));
 }
});
test('global stop and anonymous execution do not read settings or place orders',async()=>{
 const endpoint=await executionEndpoint(),h=world();await mocked(h,async()=>{
  assert.equal((await endpoint({request:new Request('https://app/api/opening-execute',{method:'POST'}),env:h.env})).status,401);
  assert.equal((await (await endpoint({request:executeReq(),env:{...h.env,SCALPING_VTS_AUTO:'0'}})).json()).enabled,false);assert.equal(h.calls.length,0);
  assert.equal((await paperPermission(h.env,'gpt_crypto')).enabled,false);assert.equal(h.calls.length,0);
 });
});
test('durable intent/result keeps rejection and OFF separate from closed strategy paper PnL',async()=>{
 for(const disabled of [false,true]){
  const h=world();if(!disabled)h.executeResponse=Response.json({ok:true,enabled:true,events:[{signalId:openingOrderRefs(date,[signal])[0].signalId,qty:3,submittedAt:'2026-10-22T00:08:00Z',vts:{ok:false,rejected:true,msg:'잔고 부족'}}]});
  await mocked(h,async()=>{const r=await W.executeVts(h.env,date,[signal],[]);assert.equal(r.ordersOk,false);assert.equal(r.counts[disabled?'not_submitted':'rejected'],1);});
  const ledger=h.ledger();assert.equal(ledger.executionEvents.length,2);const [r]=openingRecords(ledger);assert.equal(r.status,'closed');assert.equal(r.pnl,.75);assert.equal(r.broker.pnl,null);assert.equal(r.broker.buy,disabled?'not_submitted':'rejected');assert.equal(r.broker.settlement,'unverified');assert.match(recordsCsv([r]),/broker/);
 }
});
test('storage failure before intent prevents HTTP; result-write failure leaves durable unknown intent',async()=>{
 for(const phase of ['intent','result']){
  const h=world();h.store.failPhase=phase;
  await mocked(h,()=>assert.rejects(()=>W.executeVts(h.env,date,[signal],[]),/storage unavailable/));
  assert.equal(h.calls.filter(u=>u.includes('opening-execute')).length,phase==='intent'?0:1);
  const ledger=h.ledger();assert.equal(ledger.executionEvents?.length||0,phase==='intent'?0:1);
  if(phase==='result')assert.equal(openingRecords(ledger)[0].broker.buy,'unverified');
 }
});
test('HTTP loss is stored as unknown without automatic retry; stale/alert skip stores reason without HTTP',async()=>{
 const h=world();h.throwExecute=true;
 await mocked(h,async()=>{const r=await W.executeVts(h.env,date,[signal],[]);assert.equal(r.ordersOk,false);assert.equal(r.counts.unverified,1);assert.equal(h.calls.length,1);
  const blocked=await W.executeVts(h.env,date,[signal],[],'오래된 신호');assert.equal(blocked.counts.not_submitted,1);assert.equal(h.calls.length,1);
 });assert.equal(h.ledger().executionEvents.length,4);assert.equal(openingRecords(h.ledger())[0].broker.buy,'unverified');
});
test('HTTP error retains per-order acknowledgements; malformed JSON stays unknown, never filled',async()=>{
 for(const malformed of [false,true]){
  const h=world();h.executeResponse=malformed?new Response('bad JSON',{status:502}):Response.json({ok:false,enabled:true,error:'partial error',events:[{signalId:openingOrderRefs(date,[signal])[0].signalId,qty:3,submittedAt:'2026-10-22T00:08:00Z',vts:{ok:true,orderNo:'42'}}]},{status:500});
  await mocked(h,()=>W.executeVts(h.env,date,[signal],[]));const b=openingRecords(h.ledger())[0].broker;
  assert.equal(b.buy,malformed?'unverified':'accepted');assert.equal(b.settlement,'unverified');assert.equal(b.pnl,null);assert.equal(h.calls.length,1);
 }
});
test('DO journal is immutable and requires matching original main signal and preceding intent',async()=>{
 const h=world(),post=e=>h.store.get(date).fetch('https://internal/execution',{method:'POST',body:JSON.stringify(e)});
 const intent={id:'i',phase:'intent',date,at:'now',requests:openingOrderRefs(date,[signal])};
 assert.equal((await post({...intent,requests:openingOrderRefs(date,[{...signal,code:'000660'}])})).status,409);
 const result=openingExecutionResult(intent,{ok:true,enabled:false},200);assert.equal((await post(result)).status,409);
 assert.equal((await post(intent)).status,200);assert.equal((await post(intent)).status,200);assert.equal((await post({...intent,at:'changed'})).status,409);
 assert.equal((await post(result)).status,200);assert.equal((await post({...result,ordersOk:true})).status,409);assert.equal(h.ledger().executionEvents.length,2);
});
test('final session recovery cannot report success for a rejected sell',async()=>{
 const h=world();h.store.objects.get(date).values.get('ledger').events=[event('buy')];
 h.executeResponse=Response.json({ok:true,enabled:true,events:[{signalId:openingOrderRefs(date,[],[signal])[0].signalId,submittedAt:'2026-10-22T00:31:00Z',qty:3,vts:{ok:false,rejected:true,msg:'매도 거절'}}]});
 await mocked(h,async()=>{const r=await W.forceOpeningSessionClose(h.env,date,'baseline',930);assert.equal(r.ok,false);assert.equal(r.counts.rejected,1);});
 const [r]=openingRecords(h.ledger());assert.equal(r.status,'unverified');assert.equal(r.pnl,null);assert.equal(r.broker.sell,'rejected');
});
test('archive/live merge keeps final paper results and newer broker receipts in either source order',()=>{
 const h=world(),old=h.ledger(),intent={id:'i',phase:'intent',date,at:'a',requests:openingOrderRefs(date,[signal])};
 const next={...old,executionEvents:[intent,openingExecutionResult(intent,{ok:true,enabled:false,reason:'OFF'},200)]};
 for(const ledgers of [[old,next],[next,old]]){const [r]=uniqueRecords(ledgers.flatMap(openingRecords));assert.equal(r.pnl,.75);assert.equal(r.broker.buy,'not_submitted');assert.equal(r.broker.attempts.length,1);}
 const shadow={...next,events:[event('buy','shadow'),event('sell','shadow')]};assert.equal(openingRecords(shadow)[0].broker,undefined);
 assert.equal(openingRecords(old)[0].broker.buy,'unrecorded');
});
test('more than twenty earlier daily signals cannot block a later original signal audit',async()=>{
 const h=world(),ledger=h.store.objects.get(date).values.get('ledger');
 ledger.events=Array.from({length:25},(_,i)=>({...event('buy'),id:'b'+i,code:String(100000+i),signal:{...signal,code:String(100000+i)}}));
 const last=ledger.events.at(-1).signal;await mocked(h,()=>W.executeVts(h.env,date,[last],[]));assert.equal(h.ledger().executionEvents.length,2);
});
test('opening daily return and history UI explicitly separate strategy paper PnL from KIS settlement',()=>{
 const ledger={date,mainVariant:'baseline',events:[event('buy'),event('sell')],scans:Array.from({length:27},(_,i)=>({targetHm:904+i,partial:false,okShards:5,quoteErrors:0,capturedAt:date+'T00:31:00Z'}))};
 const row=summarizeOpeningLedger(ledger,Date.parse(date+'T10:00:00+09:00'));assert.equal(row.pnlBasis,'strategy-paper');assert.equal(row.realizedReturnPct,.75);
 const c={esc:String,histPrice:(_s,v)=>String(v),histPct:String,Intl,Date};vm.createContext(c);vm.runInContext(read('trade-history-ui.js'),c);
 const html=c.tradeHistoryRow(openingRecords(ledger)[0]);assert.match(html,/결과 원본 없음/);assert.match(html,/체결정산 미확인/);assert.doesNotMatch(html,/체결 완료/);
});
function uiHarness(src=read('settings-paper-trading.js')){
 const nodes=new Map(),events={},tabs=['notifications','paper'].map(name=>({dataset:{settingsTab:name},classList:{toggle(){}},setAttribute(){},addEventListener(){}}));
 let buttons=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',disabled:false,addEventListener(){}});return nodes.get(id);};
 const root={_html:'',get innerHTML(){return this._html;},set innerHTML(html){this._html=html;buttons=[];
  for(const [,attrs] of html.matchAll(/<input\b([^>]+)>/g)){const id=/id="([^"]+)"/.exec(attrs)?.[1];if(id)nodes.set(id,{checked:/\bchecked\b/.test(attrs),value:/value="([^"]+)"/.exec(attrs)?.[1]||'',disabled:/\bdisabled\b/.test(attrs)});}
  for(const [,id,tail] of html.matchAll(/<button[^>]*data-paper-save="([^"]+)"([^>]*)>/g))buttons.push({dataset:{paperSave:id},disabled:/\bdisabled\b/.test(tail),addEventListener(){}});
 },querySelectorAll:()=>buttons};nodes.set('paperTradingSettings',root);
 const user={getIdToken:async()=>'fixture'},requests=[];let server=defaultPaperSettings();
 const h={node,requests,user,get html(){return root.innerHTML;},fail:false,defer:null,set server(v){server=v;},get server(){return server;}};
 const c={document:{getElementById:node,addEventListener:(n,fn)=>events[n]=fn,querySelectorAll:q=>q==='[data-settings-tab]'?tabs:q==='[data-settings-panel]'?[]:[...buttons,...[...nodes.values()].filter(n=>'checked'in n),node('paperAllOff'),node('paperReload')]},window:{jkAuth:{currentUser:user},addEventListener:(n,fn)=>events[n]=fn},location:{hash:''},AbortController,setTimeout,clearTimeout,
  fetch:async(u,opt)=>{requests.push(opt);if(h.defer)return h.defer(opt);if(h.fail)return Response.json({ok:false,error:'저장 실패'},{status:503});if(opt.method==='POST')server=changePaperSettings(server,JSON.parse(opt.body));return Response.json({ok:true,settings:server,strategies:PAPER_STRATEGIES});}};
 vm.createContext(c);vm.runInContext(src,c);h.c=c;h.events=events;h.buttons=()=>buttons;return h;
}
async function checkUI(src){
 const h=uiHarness(src);await h.c.loadPaperSettings();assert.equal((h.html.match(/>OFF<\/span>/g)||[]).length,12);assert.equal(h.node('paper_enabled_gpt_crypto').disabled,true);assert.equal(h.node('paper_enabled_claude_crypto').disabled,true);assert.equal(h.node('paper_enabled_claude_opening').disabled,false);
 for(const s of PAPER_STRATEGIES.filter(s=>s.supported))assert.equal(h.node('paper_enabled_'+s.id).disabled,false);
 h.node('paper_enabled_gpt_opening').checked=true;h.node('paper_budget_gpt_opening').value='500000';await h.c.savePaperSetting('gpt_opening');assert.equal(h.server.strategies.gpt_opening.enabled,true);assert.equal(h.server.strategies.gpt_opening.budget,500000);assert.match(h.html,/>ON<\/span>/);
 await h.c.savePaperSetting(null,true);assert.ok(Object.values(h.server.strategies).every(x=>!x.enabled));assert.equal(JSON.parse(h.requests.at(-1).body).expectedRevision,1);
 h.node('paper_enabled_gpt_opening').checked=true;h.fail=true;await h.c.savePaperSetting('gpt_opening');assert.match(h.node('paperTradingMessage').textContent,/저장 실패/);assert.doesNotMatch(h.html,/>ON<\/span>/);assert.equal(h.node('paperReload').disabled,false);
}
test('actual settings UI renders all twelve OFF, saves per-strategy budget, all OFF and failed writes honestly',()=>checkUI());
test('logout/user switch drops stale responses and new login still loads server settings',async()=>{
 const h=uiHarness();let release;h.defer=()=>new Promise(r=>release=r);const old=h.c.loadPaperSettings();await new Promise(setImmediate);
 h.c.window.jkAuth.currentUser=null;h.events['jk-settings-auth']();assert.equal(h.html,'');
 h.defer=null;h.c.window.jkAuth.currentUser={getIdToken:async()=>'new'};h.events['jk-settings-auth']();await new Promise(setImmediate);
 release(Response.json({ok:true,settings:changePaperSettings(defaultPaperSettings(),patch),strategies:PAPER_STRATEGIES}));await old;
 assert.equal((h.html.match(/>OFF<\/span>/g)||[]).length,12);assert.doesNotMatch(h.html,/>ON<\/span>/);
});
test('value mutants catch default ON, missing order guard, top-level success and unrecorded intents',async()=>{
 const defaults=read('functions/api/_paper-trading.js'),mutant=await dataImport(defaults.replace('enabled:false,budget:2000000','enabled:true,budget:2000000'));
 assert.equal(Object.values(mutant.defaultPaperSettings().strategies).every(x=>!x.enabled),false);
 const execute=read('functions/api/opening-execute.js'),unguarded=execute.replace('if(!permission.enabled)return json','if(false)return json');assert.notEqual(unguarded,execute);await assert.rejects(async()=>checkGuard(await executionEndpoint(unguarded)),{name:'AssertionError'});
 const helper=read('functions/api/_opening-execution.js'),wrong=await dataImport(helper.replace('receipts.length>0&&counts.accepted===receipts.length','response.ok===true'));
 const intent={id:'i',date,requests:openingOrderRefs(date,[signal])};assert.notEqual(wrong.openingExecutionResult(intent,{ok:true,enabled:false},200).ordersOk,openingExecutionResult(intent,{ok:true,enabled:false},200).ordersOk);
 const noIntent=workerSrc.replace('await appendExecution(env,intent);','// removed durable intent');assert.notEqual(noIntent,workerSrc);const MW=await loadWorker(noIntent),h=world(MW);h.store.failPhase='intent';
 await mocked(h,async()=>{await MW.executeVts(h.env,date,[signal],[]).catch(()=>{});assert.equal(h.calls.filter(u=>u.includes('opening-execute')).length,1,'old mutant sends HTTP without durable intent');});
 const brokerWrong=await dataImport(helper.replace("settlement:'unverified',pnl:null","settlement:'unverified',pnl:0"));assert.notEqual(brokerWrong.openingBroker([],[]).pnl,null);
});
test('value mutants catch stale settings overwrite, mutable journal and archived receipt loss',async()=>{
 const defaults=read('functions/api/_paper-trading.js'),noCas=await dataImport(defaults.replace('!patch||patch.expectedRevision!==current.revision','!patch'));
 const current=changePaperSettings(defaultPaperSettings(),patch);assert.throws(()=>changePaperSettings(current,patch),e=>e.status===409);assert.equal(noCas.changePaperSettings(current,patch).revision,2);
 const mutableSrc=workerSrc.replace('if(old)return JSON.stringify(old)','if(false)return JSON.stringify(old)');assert.notEqual(mutableSrc,workerSrc);
 const MW=await loadWorker(mutableSrc),h=world(MW),post=e=>h.store.get(date).fetch('https://internal/execution',{method:'POST',body:JSON.stringify(e)});
 const intent={id:'i',phase:'intent',date,at:'a',requests:openingOrderRefs(date,[signal])},result=openingExecutionResult(intent,{ok:true,enabled:false},200);
 await post(intent);await post(result);assert.notEqual((await post({...result,ordersOk:true})).status,409);
 const history=read('functions/api/_trade-history.js'),lostSrc=history.replace('broker:mergeOpeningBroker(old?.broker,x.broker)','broker:old?.broker||x.broker').replace("'./_opening-execution.js'",JSON.stringify(new URL('../functions/api/_opening-execution.js',import.meta.url).href));
 const lost=await dataImport(lostSrc),old=world().ledger(),next={...old,executionEvents:[intent,result]};
 assert.equal(uniqueRecords([old,next].flatMap(openingRecords))[0].broker.buy,'not_submitted');assert.notEqual(lost.uniqueRecords([old,next].flatMap(openingRecords))[0].broker.buy,'not_submitted');
});
