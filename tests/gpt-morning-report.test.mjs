import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PresaleAlertStore} from '../worker/presale-alert/src/index.js';
import {normalizeGptReport,enrichClosingReport,gptReportDue,gptReportMessage,GPT_REPORT_TABS} from '../functions/api/_gpt_morning_report.js';
import {onRequestGet,onRequestPost} from '../functions/api/gpt-morning-report.js';
const at=h=>Date.parse('2026-10-15T'+h+':00+09:00');
function report(now=at('07:00')){return {schema:1,date:'2026-10-15',preparedAt:new Date(now).toISOString(),mainSha:'a'.repeat(40),summary:'全탭 자료 검토 · 수익성 개선 미검증',sections:Object.keys(GPT_REPORT_TABS).map(tab=>({tab,status:'collecting',findings:'원본 표본 점검 <script> · 신규 시험 없음',nextTest:'비용 포함 시간순 검증',evidence:['https://github.com/jkdevjob/jkquant']}))};}
function fixture(Worker=PresaleAlertStore){
 const values=new Map(),push=[];let alarm=null;
 const storage={get:async k=>values.has(k)?structuredClone(values.get(k)):undefined,put:async(k,v)=>values.set(k,structuredClone(v)),list:async({prefix}={})=>new Map([...values].filter(([k])=>!prefix||k.startsWith(prefix))),delete:async k=>values.delete(k),getAlarm:async()=>alarm,setAlarm:async n=>alarm=n};
 const app=new Worker({storage},{MONITOR_KEY:'key',BASE_URL:'https://app.example'});
 values.set('sub:gpt',{endpoint:'https://push.example/gpt',topics:['gpt'],topicSchemaVersion:2});values.set('sub:other',{endpoint:'https://push.example/job',topics:['job'],topicSchemaVersion:2});
 app.pushOne=async(ep,topic)=>{push.push({ep,topic});return {ok:true,status:201};};
 const post=(body,key='key')=>app.fetch(new Request('https://worker.example/gpt-morning-report',{method:'POST',headers:{'content-type':'application/json','x-monitor-key':key},body:JSON.stringify(body)}));
 return {app,values,push,post,getAlarm:()=>alarm,fire:async()=>{alarm=null;await app.alarm();}};
}
async function clock(t,fn){const old=Date.now;Date.now=()=>t;try{return await fn();}finally{Date.now=old;}}
async function mockTelegram(fn,answer=()=>Response.json({ok:true})){const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,o)=>{calls.push({url:String(url),body:JSON.parse(o.body)});return answer(calls.length);};try{return await fn(calls);}finally{globalThis.fetch=old;}}
test('all research tabs, fresh date/SHA, unknown numbers never synthesized',()=>{
 const r=normalizeGptReport(report(),at('07:00'));assert.equal(r.sections.length,8);assert.equal(r.sections[7].tab,'duel');
 for(const b of [{...report(),sections:report().sections.slice(0,6)},{...report(),sections:[...report().sections.slice(0,6),report().sections[0]]},{...report(),date:'2026-10-14'},{...report(),preparedAt:'2026-10-15T20:00:00+09:00'},{...report(),mainSha:''}])assert.throws(()=>normalizeGptReport(b,at('07:00')));
 assert.ok(gptReportMessage(r).text.length<=3500);assert.match(gptReportMessage(r).url,/morningReport=2026-10-15$/);assert.equal(new URL(gptReportMessage(r).url).searchParams.get('strategy'),'daily');
});
test('anonymous prepare/read cannot write or expose report',async()=>{
 const x=fixture();await clock(at('07:00'),async()=>assert.equal((await x.post(report(),'')).status,401));assert.equal((await x.app.fetch(new Request('https://worker.example/gpt-morning-report'))).status,401);assert.equal(x.values.has('gpt-report:2026-10-15'),false);
});
test('07:00 queues exactly 08:00 KST; 07:59 sends nothing',async()=>{
 const x=fixture();await clock(at('07:00'),async()=>{assert.equal((await(await x.post(report())).json()).queued,true);assert.equal(x.getAlarm(),at('08:00'));});
 await clock(at('07:59'),()=>mockTelegram(async c=>{await x.fire();assert.equal(c.length,0);assert.equal(x.push.length,0);assert.equal(x.getAlarm(),at('08:00'));}));
});
test('08:00 delivers once to common GPT only and Telegram, then schedules tomorrow',async()=>{
 const x=fixture();await clock(at('07:00'),()=>x.post(report()));await clock(at('08:00'),()=>mockTelegram(async c=>{await x.fire();await x.fire();assert.equal(c.length,1);assert.deepEqual(x.push,[{ep:'https://push.example/gpt',topic:'gpt'}]);assert.equal(x.getAlarm(),gptReportDue('2026-10-16'));assert.equal(x.values.get('gpt-report-delivery:2026-10-15').telegram.result,'sent');}));
});
test('concurrent submission is immutable and one report per date',async()=>{
 const x=fixture();await clock(at('07:00'),async()=>{const r=await Promise.all([x.post(report()),x.post({...report(),summary:'later'})]);assert.equal((await r[1].json()).duplicate,true);assert.equal(x.values.get('gpt-report:2026-10-15').summary,report().summary);});
});
test('all five individual consents receive the morning report; partial consent does not',async()=>{
 const x=fixture(),all=['opening','daytrading','crypto','soxl','tenbagger_gpt'];
 x.values.set('sub:individual',{endpoint:'https://push.example/all',topics:all,topicSchemaVersion:2});
 x.values.set('sub:partial',{endpoint:'https://push.example/partial',topics:all.slice(0,4),topicSchemaVersion:2});
 await clock(at('07:00'),()=>x.post(report()));await clock(at('08:00'),()=>mockTelegram(async c=>{await x.fire();assert.equal(c.length,1);assert.deepEqual(x.push.map(p=>p.ep),['https://push.example/gpt','https://push.example/all']);}));
});
test('zero-recipient report can recover newly recognized full consent without replaying Telegram',async()=>{
 const x=fixture();x.values.delete('sub:gpt');await clock(at('07:00'),()=>x.post(report()));
 await mockTelegram(async c=>{
  await clock(at('08:00'),()=>x.fire());assert.equal(c.length,1);assert.equal(x.values.get('gpt-report-delivery:2026-10-15').push.eligible,0);
  x.values.set('sub:individual',{endpoint:'https://push.example/all',topics:['opening','daytrading','crypto','soxl','tenbagger_gpt'],topicSchemaVersion:2});
  await clock(at('08:01'),async()=>{const r=await(await x.post(report())).json();assert.equal(r.requeuedPush,true);assert.equal(x.getAlarm(),at('08:01')+1000);});
  await clock(at('08:02'),()=>x.fire());assert.equal(c.length,1);assert.equal(x.push.length,1);assert.equal(x.values.get('gpt-report-delivery:2026-10-15').push.sent,1);
  await clock(at('08:03'),async()=>{assert.equal((await(await x.post(report())).json()).requeuedPush,undefined);});
  assert.equal(x.values.get('gpt-report:2026-10-15').summary,report().summary);
 });
});
test('missing preparation still gives honest 08:00 blocked report for every tab',async()=>{
 const x=fixture();await clock(at('07:07'),()=>x.app.armGptMorningReport());await clock(at('08:00'),()=>mockTelegram(async c=>{await x.fire();const r=x.values.get('gpt-report:2026-10-15');assert.equal(r.missing,true);assert.equal(r.sections.length,8);assert.ok(r.sections.every(s=>s.status==='blocked'));assert.match(c[0].body.text,/미완료/);assert.doesNotMatch(c[0].body.text,/수익률.*0\.00/);}));
});
test('partial push retries failed device only; successful Telegram not replayed',async()=>{
 const x=fixture();x.values.set('sub:gpt2',{endpoint:'https://push.example/two',topics:['gpt'],topicSchemaVersion:2});let n=0;
 x.app.pushOne=async ep=>{x.push.push(ep);return ep.endsWith('two')&&n++===0?{ok:false,status:500}:{ok:true,status:201};};await clock(at('07:00'),()=>x.post(report()));
 await mockTelegram(async c=>{await clock(at('08:00'),()=>x.fire());assert.equal(x.getAlarm(),at('08:01'));await clock(at('08:01'),()=>x.fire());assert.equal(c.length,1);assert.equal(x.push.filter(ep=>ep.endsWith('gpt')).length,1);assert.equal(x.push.filter(ep=>ep.endsWith('two')).length,2);assert.equal(x.values.get('gpt-report-delivery:2026-10-15').push.sent,2);});
});
async function unknownFlow(Worker=PresaleAlertStore){
 const x=fixture(Worker);x.app.pushOne=async()=>({ok:false,status:500});await clock(at('07:00'),()=>x.post(report()));await mockTelegram(async c=>{await clock(at('08:00'),()=>x.fire());await clock(at('08:01'),()=>x.fire());assert.equal(c.length,1);assert.equal(x.values.get('gpt-report-delivery:2026-10-15').telegram.result,'unknown');},()=>{throw Error('timeout');});
}
test('uncertain Telegram delivery is recorded first and never retried',()=>unknownFlow());
test('definite Telegram rejection bounded to 3 attempts; never claims sent',async()=>{
 const x=fixture();await clock(at('07:00'),()=>x.post(report()));await clock(at('08:00'),()=>mockTelegram(async c=>{await x.fire();assert.equal(c.length,3);assert.equal(x.values.get('gpt-report-delivery:2026-10-15').telegram.result,'fail');},()=>Response.json({ok:false,definite:true},{status:502})));
});
test('late queue does not create a fake 08:00 receipt',async()=>{
 const x=fixture();await clock(at('09:00'),async()=>{const j=await(await x.post(report(at('09:00')))).json();assert.equal(Date.parse(j.dueAt),at('09:00')+1000);assert.equal(x.values.has('gpt-report-delivery:2026-10-15'),false);});
});
test('Pages owner gate, no-store and configured Telegram destination only',async()=>{
 assert.equal((await onRequestGet({request:new Request('https://app/api/gpt-morning-report'),env:{}})).status,401);assert.equal((await onRequestPost({request:new Request('https://app/api/gpt-morning-report',{method:'POST',body:'{}'}),env:{AUTOTRADE_KEY:'key'}})).status,401);
 await mockTelegram(async c=>{const r=await onRequestPost({request:new Request('https://app/api/gpt-morning-report',{method:'POST',headers:{'x-monitor-key':'key'},body:JSON.stringify({text:'[지피티 연구 리포트] test',chat_id:'wrong-room'})}),env:{AUTOTRADE_KEY:'key',TELEGRAM_BOT_TOKEN:'fixture',TELEGRAM_CHAT_ID:'existing-room'}});assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(c[0].body.chat_id,'existing-room');});
});
test('actual UI keeps all research tabs, escapes text and distinguishes unknown delivery',()=>{
 const ui=fs.readFileSync(new URL('../scalping.html',import.meta.url),'utf8'),code=ui.slice(ui.indexOf('function renderGptMorningReport'),ui.indexOf('async function loadGptMorningReport'));
 const c={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),scalpingKstStamp:s=>s};vm.createContext(c);vm.runInContext(code,c);
 const html=c.renderGptMorningReport({report:normalizeGptReport(report(),at('07:00')),delivery:{push:{sent:1},telegram:{result:'unknown'}}});assert.equal((html.match(/<details>/g)||[]).length,8);assert.match(html,/&lt;script>/);assert.match(html,/결과 미확인/);assert.doesNotMatch(html,/<script>/);
});
test('actual UI ignores delayed report after logout; Bearer and no-store',async()=>{
 const ui=fs.readFileSync(new URL('../scalping.html',import.meta.url),'utf8'),code=ui.slice(ui.indexOf('let GPT_MORNING_AT='),ui.indexOf('let DAILY_RESULTS_PAYLOAD='));let release,options;
 const node={innerHTML:'untouched'},c={me:{uid:'owner',getIdToken:async()=>'fixture'},SCALPING_AUTH_EPOCH:1,document:{hidden:false},location:{search:''},URLSearchParams,AbortController,Date,setTimeout:()=>1,clearTimeout:()=>{},$:()=>node,esc:String,scalpingKstStamp:String,fetch:async(u,o)=>{options=o;return new Promise(r=>release=r);}};
 vm.createContext(c);vm.runInContext(code,c);const p=c.loadGptMorningReport();await new Promise(setImmediate);assert.equal(options.cache,'no-store');assert.equal(options.headers.Authorization,'Bearer fixture');c.me=null;c.SCALPING_AUTH_EPOCH++;c.stopGptMorningReport();release(Response.json({ok:true,report:report()}));await p;assert.equal(node.innerHTML,'untouched');
});
test('publication uses safe file input and server queue, not delayed GitHub cron',()=>{
 const y=fs.readFileSync(new URL('../.github/workflows/gpt-morning-report.yml',import.meta.url),'utf8');assert.match(y,/branches: \[research\/gpt-morning\]/);assert.match(y,/--data-binary @\/tmp\/gpt-report.json/);assert.doesNotMatch(y,/cron:|sleep|inputs\./);
});
test('three value mutants: early time, omitted tab, replayed uncertain Telegram',async()=>{
 const file=new URL('../functions/api/_gpt_morning_report.js',import.meta.url),src=fs.readFileSync(file,'utf8').replaceAll('export ','');const early={};vm.createContext(early);vm.runInContext(src.replace('T08:00:00','T07:30:00'),early);assert.throws(()=>assert.equal(vm.runInContext("gptReportDue('2026-10-15')",early),at('08:00')),{name:'AssertionError'});
 const absent={};vm.createContext(absent);vm.runInContext(src.replace('Object.keys(GPT_REPORT_TABS).map','Object.keys(GPT_REPORT_TABS).slice(0,6).map'),absent);assert.throws(()=>assert.equal(absent.normalizeGptReport(report(),at('07:00')).sections.length,8),{name:'AssertionError'});
 const wf=new URL('../worker/presale-alert/src/index.js',import.meta.url),mutant=fs.readFileSync(wf,'utf8').replaceAll("['sent','unknown']","['sent']").replace(/from (["'])(\.\.?\/[^"']+)\1/g,(_,q,p)=>'from '+q+new URL(p,wf).href+q);const m=await import('data:text/javascript;base64,'+Buffer.from(mutant).toString('base64'));await assert.rejects(()=>unknownFlow(m.PresaleAlertStore),{name:'AssertionError'});
});

test('legacy seven-section report includes both closing models from fresh daily research',async()=>{
 const b=report();b.sections=b.sections.filter(s=>s.tab!=='closing30');
 await clock(at('07:00'),async()=>{
  const normalized=normalizeGptReport(b);assert.equal(normalized.sections.length,8);assert.equal(normalized.sections.find(s=>s.tab==='closing30').status,'blocked');
  const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({date:'2026-10-14',generatedAt:'2026-10-15T06:00:00+09:00',archiveDays:5,errors:[],variants:[{name:'baseline',kind:'day',summary:{trades:3}},{name:'baseline',kind:'overnight',summary:{trades:4}}]});
  try{const added=(await enrichClosingReport(normalized)).sections.find(s=>s.tab==='closing30');assert.equal(added.status,'collecting');assert.match(added.findings,/종가 30분 3건/);assert.match(added.findings,/종가 베팅 4건/);assert.equal(added.evidence.length,1);}
  finally{globalThis.fetch=old;}
 });
});
test('closing report source failure keeps honest blocked evidence, never fabricated zero results',async()=>{
 const b=report();b.sections=b.sections.filter(s=>s.tab!=='closing30');
 await clock(at('07:00'),async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('offline');};
  try{const s=(await enrichClosingReport(normalizeGptReport(b))).sections.find(s=>s.tab==='closing30');assert.equal(s.status,'blocked');assert.equal(s.evidence.length,0);assert.doesNotMatch(s.findings,/0건|0\.00%/);}
  finally{globalThis.fetch=old;}
 });
});
