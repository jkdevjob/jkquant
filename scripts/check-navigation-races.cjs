const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
let html=fs.readFileSync(process.argv[2]||'index.html','utf8');
if(process.env.NAV_MUTATION==='overwrite')html=html.replace('S=next;ensureBoxes();','S=candidate;ensureBoxes();');
if(process.env.NAV_MUTATION==='parallel')html=html.replace('stateSaveQueue.then(()=>{','Promise.resolve().then(()=>{');
if(process.env.NAV_MUTATION==='quote')html=html.replaceAll(' || curStrat().settings!==st','');
function fn(marker){const start=html.indexOf(marker);assert(start>=0,marker);let i=html.indexOf('{',start),d=0;for(;i<html.length;i++){if(html[i]==='{')d++;if(html[i]==='}'&&!--d)return html.slice(start,i+1);}throw Error(marker);}
const clone=x=>JSON.parse(JSON.stringify(x)),tabs=['inf','vr','ma','ivs','dca','asap'];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function saves(destination){
 const base={activeTab:'ivs'};for(const t of tabs)base[t]={active:'TECL',sessions:[{id:'TECL',hist:[],settings:{ticker:'TECL'}},{id:'TQQQ',hist:[],settings:{ticker:'TQQQ'}}]};
 let remote=clone(base);remote.ivs.active='TQQQ';remote.dca.sessions[0].hist=[{ts:1,date:'2026-01-01',qty:1}];
 let rev=2,active=0,max=0;const gates=[],writes=[],renders=[];
 const c=vm.createContext({S:clone(base),curUid:'u',stateCloudHydrated:true,stateCloudRev:1,stateCloudHistorySig:'',stateDbBase:clone(base),stateCloudPending:false,lastPushedJSON:'',saveTimer:null,stateSaveQueue:Promise.resolve(),_paperFilling:false,console,setSync(){},_staleStateGuard(){},validState:()=>true,_historySignature:x=>JSON.stringify(x),ensureBoxes(){},refreshAll(){renders.push(clone(c.S));},sortHist:a=>a,window:{fb:{db:{},doc(){},async runTransaction(db,callback){active++;max=Math.max(max,active);const gate=deferred();gates.push(gate);await gate.promise;const tx={get:async()=>({exists:()=>true,data:()=>({stateV2:clone(remote),stateV2Rev:rev})}),set(ref,data){remote=clone(data.stateV2);rev=data.stateV2Rev;writes.push(clone(remote));}};try{return await callback(tx);}finally{active--;}}}}});
 const names=['_histKeyPart','_histStableJson','_histSemanticKey','_histGroupKey','_histEntries','_rebaseRecordArray','_statePlainObject','_stateValEq','_rebaseObjectFields','_rebaseStateOnRemote'];
 c.dbSizeReport=()=>{}; // 기록 크기 표시는 화면 일 — 저장 경쟁 시험과 무관
 vm.runInContext(names.map(n=>fn('function '+n+'(')).join('\n')+fn('function dbStateBytes(json)')+fn('async function _commitStateRemote(where)')+fn('async function pushRemoteNow()'),c);
 const runTransaction=c.window.fb.runTransaction;
 c.window.fb.runTransaction=(db,callback)=>runTransaction(db,async tx=>{
   // An aborted Firestore attempt must not leak its remote-only fields into retry.
   await callback({get:async()=>({exists:()=>true,data:()=>({stateV2:{...clone(remote),retryOnly:'discard'},stateV2Rev:rev+100})}),set(){}});
   return callback(tx);
 });
 const first=c.pushRemoteNow();await tick();
 c.S.activeTab=destination;c.S.dca.active='TQQQ';c.S.dca.sessions[1].settings.amount=77;
 const second=c.pushRemoteNow();await tick();assert.equal(max,1,'saves must be serialized');
 gates[0].resolve();await first;await tick();
 assert.equal(c.S.activeTab,destination,'late commit must not select Shannon');assert.equal(c.S.ivs.active,'TECL','remote selection must not move current window');assert.equal(c.S.dca.active,'TQQQ');assert.equal(c.S.dca.sessions[1].settings.amount,77,'pending settings edit preserved');assert.equal(c.S.dca.sessions[0].hist.length,1,'remote history preserved');
 gates[1].resolve();await second;assert.equal(remote.activeTab,destination);assert.equal(remote.dca.sessions[1].settings.amount,77);assert.equal(remote.dca.sessions[0].hist.length,1);
 assert(renders.every(x=>x.activeTab===destination));assert.equal(active,0);
 assert.equal(remote.retryOnly,undefined,'aborted transaction fields must not be resurrected');
 const transaction=c.window.fb.runTransaction;
 c.console={error(){},warn(){}};c.window.fb.runTransaction=async()=>{throw Error('temporary DB failure');};
 c.S.dca.sessions[1].settings.amount=88;
 assert.equal(await c.pushRemoteNow(),false);assert.equal(c.S.activeTab,destination);assert.equal(c.S.dca.sessions[1].settings.amount,88);
 c.window.fb.runTransaction=transaction;const recovered=c.pushRemoteNow();await tick();gates[2].resolve();assert.equal(await recovered,true);assert.equal(remote.dca.sessions[1].settings.amount,88);
 console.log('PASS delayed DB commits: '+destination+' navigation/settings and remote history preserved, writes serialized');
}
async function quotes(){
 for(const crossTab of [false,true])for(const [tab,name] of [['inf','loadInfData'],['vr','loadVrChart'],['ma','loadMaData'],['ivs','loadIvsData'],['dca','loadDcaData'],['asap','loadAsapData'],['vr','fetchQuote']]){
  let st={ticker:'TECL'},gate=deferred(),writes=0;const fields={};
  const c=vm.createContext({S:{activeTab:tab},curStrat:()=>({settings:st}),$:id=>fields[id]||(fields[id]={}),tickerLabel:x=>x,fetchDaily:()=>gate.promise,infQuoteCache:null,vrChartData:null,lastQuote:{},maQuoteData:null,ivsQuoteData:null,ivsQuote1:null,dcaQuoteData:null,asapQuoteData:null,ivsX1Of:()=> 'XLK',_afterQuote:()=>{writes++;}});
  c.fetchDailyDiv=()=>gate.promise;
  vm.runInContext(fn('async function '+name+'('),c);
  const pending=c[name](name==='fetchQuote'?'vr':true);if(crossTab)c.S.activeTab=tab==='ma'?'ivs':'ma';else st={ticker:'TQQQ'};
  gate.resolve({symbol:'TECL',days:[{close:10}],last:{close:10},price:10});await pending;
  assert.equal(writes,0,name+' rejected stale session');assert.equal(c.lastQuote.vr,undefined);assert.equal(c.infQuoteCache,null);assert.equal(c.ivsQuoteData,null);
 }
 console.log('PASS 7 quote paths x session/strategy navigation reject stale responses before cache/UI updates');
}
(async()=>{for(const t of tabs)await saves(t);await quotes();})().catch(e=>{console.error(e);process.exitCode=1;});
