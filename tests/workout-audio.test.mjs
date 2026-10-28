import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {WorkoutAudio} from '../workout-audio.mjs';
import {TimerEngine,DEFAULT_CONFIG} from '../workout-engine.mjs';

function fixture({state='suspended',resumePending=false,speech=true}={}){
 const events=[],words=[],nodes=[],timers=new Map(),problems=[];let timerId=0;
 const platform={navigator:{audioSession:{}},document:{visibilityState:'visible'},
  setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
 Object.defineProperty(platform.navigator.audioSession,'type',{set(type){events.push('session:'+type);}});
 class Context{
  constructor(){events.push('create');this.state=state;this.currentTime=10;this.destination={};}
  resume(){events.push('resume');if(resumePending)return new Promise(()=>{});this.state='running';return Promise.resolve();}
  createBuffer(){return {};}
  createBufferSource(){return {connect(){},disconnect(){},start(){events.push('primer');}};}
  createOscillator(){const n={frequency:{value:0},connect(){},disconnect(){},start(at){n.started=at;},stop(at){n.stopped=at;}};nodes.push(n);return n;}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
 }
 platform.AudioContext=Context;
 if(speech){
  platform.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  platform.speechSynthesis={paused:false,cancel(){events.push('cancel');},resume(){events.push('speech-resume');},getVoices:()=>[{lang:'en-US',name:'English'},{lang:'ko-KR',name:'Korean'}],speak(u){words.push(u);events.push('say:'+u.text);}};
 }
 const audio=new WorkoutAudio(platform,message=>problems.push(message));
 function advance(ms){for(const [id,t]of [...timers])if(t.ms<=ms){timers.delete(id);t.fn();}}
 return {audio,platform,events,words,nodes,timers,problems,advance};
}

test('iPhone playback session and both audio/speech activation happen synchronously in the gesture',()=>{
 const f=fixture({resumePending:true});f.audio.unlockFromGesture();
 assert.deepEqual(f.events.slice(0,4),['session:playback','create','resume','primer']);
 assert.equal(f.words[0].text,'시작');assert.equal(f.words[0].lang,'ko-KR');assert.equal(f.words[0].voice.name,'Korean');assert.equal(f.words[0].volume,1);
});
test('five seconds reads 오 사 삼 이 일 even when optional phase narration is disabled',()=>{
 const f=fixture();f.audio.configure({sound:true,voice:false});f.audio.unlockFromGesture({prime:false});
 for(let n=5;n>=1;n--)f.audio.countdown(n,'work:'+n);
 assert.deepEqual(f.words.map(w=>w.text),['오','사','삼','이','일']);
});
test('the actual app tick speaks once per second on 6→5→4→3→2→1, despite frequent rendering',()=>{
 const source=fs.readFileSync('workout.js','utf8'),start=source.indexOf('function renderTick(){'),end=source.indexOf('function swElapsed()',start);
 const f=fixture();f.audio.configure({sound:true,voice:false});f.audio.unlockFromGesture({prime:false});
 let now=0;const engine=new TimerEngine({...DEFAULT_CONFIG,prepare:0,cooldown:0,rounds:1,blocks:[{id:'w',label:'운동',kind:'work',seconds:6}]},()=>now);engine.start();
 const el={style:{setProperty(){}},classList:{toggle(){}},querySelector(){return {};},setAttribute(){}};
 const ctx={engine,config:{rounds:1},mode:'round',document:{visibilityState:'visible'},soundPlayer:f.audio,$:()=>el,lastIndex:-1,lastCue:'',justStarted:true,sessionId:null,finishedId:null,pad:n=>String(n).padStart(2,'0'),duration:x=>String(x),svg:()=>'',esc:x=>x,beep(){},announce(){}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 for(now=0;now<6000;now+=1000){ctx.renderTick();ctx.renderTick();}
 assert.deepEqual(f.words.map(w=>w.text),['오','사','삼','이','일']);
});
test('no zero or old missed numbers; each round has its own countdown identity',()=>{
 const f=fixture();for(const [n,key]of [[6,'x:6'],[5,'x:5'],[5,'x:5'],[3,'x:3'],[0,'x:0'],[5,'y:5']])f.audio.countdown(n,key);
 assert.deepEqual(f.words.map(w=>w.text),['오','삼','오']);
});
test('boundary cancels the spoken countdown and holds a real beep for at least 700ms',()=>{
 const f=fixture();f.audio.unlockFromGesture({prime:false});f.audio.countdown(1,'x:1');
 assert.equal(f.audio.boundary(),true);const n=f.nodes.at(-1);
 assert.equal(n.frequency.value,1046);assert.ok(n.stopped-n.started>=.7);assert.equal(f.events.at(-1),'cancel');
 f.audio.boundary('done');assert.ok(f.nodes.at(-1).stopped-f.nodes.at(-1).started>=.9);
});
test('master mute stops speech, tones and preview callbacks; explicit countdown OFF is respected',()=>{
 const f=fixture();f.audio.preview();assert.equal(f.timers.size,5);
 f.audio.configure({sound:false,countdown:true,voice:true});assert.equal(f.timers.size,0);
 f.audio.countdown(4,'x:4');f.audio.boundary();assert.equal(f.words.length,1);assert.equal(f.nodes.length,0);
 f.audio.configure({sound:true,countdown:false});f.audio.countdown(4,'y:4');assert.equal(f.words.length,1);
});
test('hidden page does not speak stale countdowns or make a boundary beep',()=>{
 const f=fixture();f.audio.unlockFromGesture({prime:false});f.platform.document.visibilityState='hidden';f.audio.countdown(5,'x:5');f.audio.boundary();assert.equal(f.words.length,0);assert.equal(f.nodes.length,0);
});
test('preview reproduces all five words and the long final beep; reset cancels the remainder',()=>{
 const f=fixture();f.audio.preview();f.advance(5000);
 assert.deepEqual(f.words.map(w=>w.text),['오','사','삼','이','일']);assert.equal(f.nodes.length,1);assert.ok(f.nodes[0].stopped-f.nodes[0].started>=.9);
 const g=fixture();g.audio.preview();g.audio.reset();g.advance(5000);assert.deepEqual(g.words.map(w=>w.text),['오']);assert.equal(g.nodes.length,0);
});
test('a countdown cancels delayed phase narration so it cannot cover a number',()=>{
 const f=fixture();f.audio.configure({sound:true,voice:true});f.audio.unlockFromGesture({prime:false});f.audio.boundary();f.audio.announce('운동');assert.equal(f.timers.size,1);f.audio.countdown(5,'x:5');assert.equal(f.timers.size,0);assert.deepEqual(f.words.map(w=>w.text),['오']);
});
test('interrupted Safari audio context is resumed; failures are visible and do not reject the timer',async()=>{
 const f=fixture({state:'interrupted'});assert.equal(await f.audio.unlockFromGesture(),true);assert.ok(f.events.includes('resume'));
 const g=fixture();g.platform.AudioContext=class{constructor(){throw Error('blocked');}};assert.equal(await g.audio.unlockFromGesture(),false);assert.equal(g.problems.length,1);
});
test('missing or rejected speech falls back to a short sound and reports the problem once',()=>{
 const f=fixture({speech:false});f.audio.unlockFromGesture({prime:false});f.audio.countdown(5,'x:5');f.audio.countdown(4,'x:4');assert.equal(f.nodes.length,2);assert.equal(f.problems.length,1);
 const g=fixture();g.audio.unlockFromGesture({prime:false});g.audio.countdown(5,'x:5');g.words[0].onerror({error:'not-allowed'});assert.equal(g.nodes.length,1);assert.equal(g.problems.length,1);
});
test('the actual start action never awaits an unresolved audio permission promise',()=>{
 const source=fs.readFileSync('workout.js','utf8'),start=source.indexOf('function toggleStart(){'),end=source.indexOf('async function finish(',start),calls=[];
 const ctx={needAccount:()=>true,mode:'round',engine:{status:'idle',start(){calls.push('timer-start');},snapshot:()=>({})},newId:()=> 'id',Date,initAudio:()=>{calls.push('audio-unlock');return new Promise(()=>{});},soundPlayer:{reset(){},stop(){}},acquireWake(){},renderTick(){},sessionId:null,sessionStarted:0,finishedId:null,lastIndex:-1,lastCue:'',justStarted:false};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\ntoggleStart();',ctx);assert.deepEqual(calls,['audio-unlock','timer-start']);
});
test('old saved settings inherit the five-second default and the page offers a real sound preview',()=>{
 const source=fs.readFileSync('workout.js','utf8'),html=fs.readFileSync('workout.html','utf8');
 assert.match(source,/settings=\{sound:true,countdown:true,voice:false/);assert.match(source,/settings=\{\.\.\.settings,\.\.\.data\.data\?\.settings\}/);
 assert.match(html,/5초 소리 확인/);assert.match(html,/workoutVer">v1\.0\.1/);assert.match(html,/workout\.js\?v=1\.0\.1/);
});
test('three regressions are detected by observed spoken words and audio routing',async()=>{
 const source=fs.readFileSync('workout-audio.mjs','utf8');
 const mutants=[
  ["second>5","second>3",m=>{const f=fixture(),a=new m.WorkoutAudio(f.platform);for(let n=5;n>=1;n--)a.countdown(n,'x:'+n);assert.deepEqual(f.words.map(w=>w.text),['오','사','삼','이','일']);}],
  ["if(key===this.lastCountKey)return false;","if(false)return false;",m=>{const f=fixture(),a=new m.WorkoutAudio(f.platform);a.countdown(5,'x:5');a.countdown(5,'x:5');assert.equal(f.words.length,1);}],
  ["p.navigator.audioSession.type='playback'","p.navigator.audioSession.type='auto'",m=>{const f=fixture(),a=new m.WorkoutAudio(f.platform);a.unlockFromGesture();assert.equal(f.events[0],'session:playback');}]
 ];
 for(const [from,to,check]of mutants){assert.ok(source.includes(from));const m=await import('data:text/javascript;base64,'+Buffer.from(source.replace(from,to)).toString('base64'));assert.throws(()=>check(m),{code:'ERR_ASSERTION'});}
});
