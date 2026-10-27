import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TimerEngine,DEFAULT_CONFIG,normalizeConfig,buildTimeline,locate} from '../workout-engine.mjs';
import {createWorkoutStore} from '../workout-store.mjs';

test('reference workout is 21 minutes; zero rest does not consume a round',()=>{
 const p=buildTimeline(DEFAULT_CONFIG);assert.equal(p.total,1260000);assert.equal(p.segments.length,22);assert.equal(p.segments[1].label,'운동');assert.equal(p.segments[20].round,20);assert.equal(p.segments[21].kind,'cooldown');
});
test('tabata transitions at exact boundaries and omits only the last rest',()=>{
 const c={...DEFAULT_CONFIG,prepare:10,cooldown:30,rounds:8,skipLastRest:true,blocks:[{id:'w',label:'운동',kind:'work',seconds:20},{id:'r',label:'휴식',kind:'rest',seconds:10}]},p=buildTimeline(c);
 assert.equal(p.total,270000);assert.equal(locate(p,10000).segment.label,'운동');assert.equal(locate(p,30000).segment.label,'휴식');assert.equal(locate(p,40000).segment.round,2);assert.equal(locate(p,240000).segment.kind,'cooldown');assert.equal(locate(p,270000).segment,null);
});
test('wall clock, not tick count, catches up after a hidden tab',()=>{
 let now=1000;const e=new TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now+=215000;const s=e.snapshot();assert.equal(s.segment.round,4);assert.equal(s.remaining,55000);assert.equal(s.elapsed,215000);
});
test('pause excludes paused time and resume preserves the current interval',()=>{
 let now=0;const e=new TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now=15000;e.pause();now=70000;assert.equal(e.snapshot().remaining,15000);e.start();now=75000;assert.equal(e.snapshot().remaining,10000);
});
test('skip advances just one stage and records skipped time separately',()=>{
 let now=0;const e=new TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now=5000;e.skip();let s=e.snapshot();assert.equal(s.segment.round,1);assert.equal(s.remaining,60000);assert.equal(s.activeMs,5000);assert.equal(s.skipCount,1);now+=10000;assert.equal(e.snapshot().activeMs,15000);
});
test('skip while paused never resumes the clock',()=>{
 let now=0;const e=new TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now=5000;e.pause();e.skip();now=80000;assert.equal(e.status,'paused');assert.equal(e.snapshot().remaining,60000);assert.equal(e.snapshot().activeMs,5000);
});
test('completion is stable, and restart and reset clear elapsed/skipped time',()=>{
 let now=0;const e=new TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now=1500000;assert.equal(e.snapshot().status,'finished');assert.equal(e.snapshot().activeMs,1260000);e.start();assert.equal(e.snapshot().elapsed,0);now+=2000;e.skip();e.reset();assert.equal(e.snapshot().skipCount,0);assert.equal(e.snapshot().elapsed,0);assert.equal(e.status,'idle');
});
test('custom workout blocks execute in order on every round',()=>{
 const c={...DEFAULT_CONFIG,rounds:2,prepare:0,cooldown:0,blocks:[{id:'a',label:'A',kind:'work',seconds:15},{id:'b',label:'B',kind:'work',seconds:20},{id:'r',label:'쉬기',kind:'rest',seconds:5}]},p=buildTimeline(c);assert.equal(p.total,80000);assert.deepEqual(p.segments.map(s=>s.label),['A','B','쉬기','A','B','쉬기']);assert.equal(locate(p,40000).segment.round,2);
});
test('invalid saved input is bounded and cannot create an empty infinite workout',()=>{
 const c=normalizeConfig({rounds:-5,prepare:Infinity,cooldown:100000,blocks:[],name:'a'.repeat(90)});assert.equal(c.rounds,1);assert.equal(c.prepare,30);assert.equal(c.cooldown,3599);assert.equal(c.name.length,50);assert.ok(buildTimeline(c).total>0);assert.equal(normalizeConfig({rounds:100000}).rounds,999);
});
function fixture(){
 const notifications=[],writes=[],historyWrites=[];let state={revision:0};
 const store=createWorkoutStore({readState:async()=>state,readHistory:async()=>[],writeState:async(uid,patch,expected)=>{assert.equal(expected,state.revision);writes.push({uid,patch});state={...state,...patch,revision:state.revision+1};return state;},writeHistory:async(uid,record)=>historyWrites.push({uid,record}),notify:d=>notifications.push(d)});
 return {store,notifications,writes,historyWrites};
}
test('settings and routines use account-scoped ordered revisions',async()=>{
 const f=fixture();await f.store.open('A');await Promise.all([f.store.save({settings:{sound:false}}),f.store.save({routines:[]})]);assert.equal(f.writes.length,2);assert.equal(f.writes[0].uid,'A');assert.deepEqual(f.writes[1].patch,{routines:[]});
});
test('late data from a signed-out account is never rendered',async()=>{
 let resolve;const events=[];const s=createWorkoutStore({readState:()=>new Promise(r=>{resolve=r;}),readHistory:async()=>[],notify:d=>events.push(d)});const pending=s.open('A');s.close('B');resolve({revision:10,config:{name:'private'}});await pending;assert.equal(s.ready,false);assert.equal(s.uid,'B');assert.equal(events.filter(e=>e.state==='ready').length,0);
});
test('queued settings changes cannot cross accounts',async()=>{
 let release;const writes=[];const s=createWorkoutStore({readState:async()=>({revision:0}),readHistory:async()=>[],writeState:async(uid)=>{writes.push(uid);await new Promise(r=>{release=r;});return {revision:1};}});await s.open('A');const first=s.save({settings:{sound:false}});await new Promise(r=>setImmediate(r));const second=s.save({config:DEFAULT_CONFIG});s.close('B');release();await assert.rejects(first,{code:'stale_account'});await assert.rejects(second,{code:'stale_account'});assert.deepEqual(writes,['A']);
});
test('load failure and revision conflict fail closed for writes',async()=>{
 const s=createWorkoutStore({readState:async()=>{throw Error('offline');},readHistory:async()=>[]});await assert.rejects(s.open('A'));await assert.rejects(s.save({config:DEFAULT_CONFIG}));
 const conflict=createWorkoutStore({readState:async()=>({revision:0}),readHistory:async()=>[],writeState:async()=>{throw Object.assign(Error('conflict'),{code:'conflict'});}});await conflict.open('A');await assert.rejects(conflict.save({config:DEFAULT_CONFIG}),{code:'conflict'});assert.equal(conflict.ready,false);
});
test('completion retries preserve the same session identifier',async()=>{
 const f=fixture();await f.store.open('A');const r={id:'session-1',activeMs:1260000};await f.store.saveHistory(r);await f.store.saveHistory(r);assert.deepEqual(f.historyWrites.map(x=>[x.uid,x.record.id]),[['A','session-1'],['A','session-1']]);f.store.close();await assert.rejects(f.store.saveHistory(r));
});
test('every existing menu links once to workout; new page uses shared access/header',()=>{
 for(const name of fs.readdirSync('.').filter(x=>x.endsWith('.html'))){const source=fs.readFileSync(name,'utf8');if(!source.includes('jkmenu-pop'))continue;assert.equal((source.match(/<a\b[^>]*href="\/workout"/g)||[]).length,1,name);}
 const source=fs.readFileSync('workout.html','utf8');assert.match(source,/<title>JK 투자 — 운동 타이머<\/title>/);assert.match(source,/jk-access\.js" data-guard="1"/);assert.match(source,/jk-ui\.js\?v=1\.1\.0/);const access=fs.readFileSync('jk-access.js','utf8');assert.match(access,/path:'\/workout',label:'운동 타이머',mode:'public'/);assert.match(access,/'\/workout\.html':'\/workout'/);assert.match(fs.readFileSync('jk-ui.js','utf8'),/'\/workout':'운동 타이머'/);
});
test('essential timer invariants detect deliberate regressions',async()=>{
 const source=fs.readFileSync('workout-engine.mjs','utf8');
 const mutants=[
  ["config.skipLastRest&&round===config.rounds&&b.kind==='rest'","false",m=>{const p=m.buildTimeline({...DEFAULT_CONFIG,rounds:2,prepare:0,cooldown:0,skipLastRest:true,blocks:[{id:'w',kind:'work',label:'운동',seconds:20},{id:'r',kind:'rest',label:'휴식',seconds:10}]});assert.equal(p.total,50000);}],
  ['now-this.anchor','0',m=>{let now=0;const e=new m.TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now=5000;assert.equal(e.snapshot().remaining,25000);}],
  ['this.skipped+=snap.remaining','this.skipped+=0',m=>{let now=0;const e=new m.TimerEngine(DEFAULT_CONFIG,()=>now);e.start();now=5000;e.skip();assert.equal(e.snapshot().activeMs,5000);}]
 ];
 for(const [from,to,check]of mutants){assert.ok(source.includes(from));const changed=source.replace(from,to),m=await import('data:text/javascript;base64,'+Buffer.from(changed).toString('base64'));assert.throws(()=>check(m),{code:'ERR_ASSERTION'});}
});
