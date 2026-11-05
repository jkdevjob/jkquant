const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(process.env.JKQ_INDEX||path.join(__dirname,'../index.html'),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function fn(name){
  const start=html.indexOf('function '+name+'(');assert(start>=0,name);
  let i=html.indexOf('{',start),depth=0;
  for(;i<html.length;i++){if(html[i]==='{')depth++;else if(html[i]==='}'&&!--depth)return html.slice(start,i+1);}
  throw Error('unterminated '+name);
}
const methods=['_histKeyPart','_histStableJson','_histSemanticKey','_histGroupKey','_histEntries',
  '_stateHistoryMap','_historySignature','_rebaseRecordArray','_statePlainObject','_stateValEq',
  '_rebaseObjectFields','_rebaseStateOnRemote','sortHist','computeVr','simSig','paperResetGen','paperDataReady','paperSyncSig'];
function runtime(){
  const c=vm.createContext({console,Map,Set,JSON,current:null,curStrat:()=>c.current,PAPER_CACHESYM:{vr:()=>'TECL'}});
  vm.runInContext(html.match(/const SIM_KEYS=\{[\s\S]*?\n\};/)[0]+'\n'+html.match(/const SIM_RULE_VER=\d+;/)[0]+'\n'+methods.map(fn).join('\n'),c);
  return c;
}
const settings={ticker:'TECL',initAmt:11000,mode:.5,formula:'basic',g:10,add:0,autoCyc:false,band:15,vrModel:'ladder',divmode:'reinv',startv:11000,startCyc:1,startpool:0};
// A fast replay can give the opening buy, its change, and later fills the same ts.
// These are separate real ledger entries even when the wall clock has not moved.
const rows=[
  {type:'buy',date:'2018-01-02',price:10,qty:1000,fee:25,init:true,cyc:0,sim:true,ts:1},
  {type:'add',date:'2018-01-02',amt:975,cyc:0,sim:true,ts:2},
  {type:'sell',date:'2018-01-19',price:12,qty:100,fee:3,cyc:1,sim:true,ts:1},
  {type:'buy',date:'2018-02-01',price:8,qty:50,fee:1,cyc:1,sim:true,ts:2},
  {type:'div',date:'2018-02-02',amt:4,cyc:1,sim:true,ts:1},
  {type:'add',date:'2018-02-02',amt:100,cyc:1,auto:true,ts:2},
  {type:'wd',date:'2018-02-03',amt:10,cyc:1,auto:true,ts:1},
];
function state(hist){return {activeTab:'vr',inf:{sessions:[{id:'real',paper:false,hist:[]}]},vr:{active:'v',sessions:[{id:'v',paper:true,settings:clone(settings),hist:clone(hist)}]},plan:{sessions:[]}};}
function ledger(c,s){c.current=s.vr.sessions[0];const r=c.computeVr();return clone(Object.fromEntries(['qty','pool','grossIn','initBuy','totadd','totwd','cost','realized','fees'].map(k=>[k,r[k]])));}

test('save/reload preserves opening buy, change, quantities, cash and principal when generated timestamps collide',()=>{
  const c=runtime(),base=state([]),local=state(rows),before=ledger(c,local);
  assert.equal(before.grossIn,11100);
  assert.equal(before.qty,950);
  const saved=clone(c._rebaseStateOnRemote(base,local,base));
  assert.deepEqual(saved.vr.sessions[0].hist,rows);
  assert.deepEqual(ledger(c,saved),before);
  assert.equal(c._stateHistoryMap(local).size,c._stateHistoryMap(saved).size);
  assert.equal(c._historySignature(local),c._historySignature(saved));
});

test('two tabs with colliding generated timestamps retain both sets of new trades and repeated saves are idempotent',()=>{
  const c=runtime(),base=state(rows.slice(0,2)),local=state(rows.slice(0,4)),remote=state([...rows.slice(0,2),...rows.slice(4)]);
  const saved=clone(c._rebaseStateOnRemote(base,local,remote));
  assert.deepEqual(saved.vr.sessions[0].hist,rows);
  const again=clone(c._rebaseStateOnRemote(local,local,saved));
  assert.deepEqual(again,saved);
});

test('generated identities survive JSON/Firestore field reordering; manual edits keep their original identity',()=>{
  const c=runtime(),a=rows[0],b=Object.fromEntries(Object.entries(a).reverse());
  assert.equal(c._histKeyPart(a),c._histKeyPart(b));
  const manual={type:'buy',date:'2026-11-01',price:20,qty:3,ts:1};
  assert.equal(c._histKeyPart(manual),c._histKeyPart({...manual,date:'2026-11-02',qty:4}));
  assert.notEqual(c._histKeyPart(manual),c._histKeyPart(a));
  assert.equal(c._histKeyPart({...a,id:'trade-1'}),'id:trade-1');
});

test('editing or deleting one generated fill does not lose another fill with the same old timestamp',()=>{
  const c=runtime(),base=state(rows),local=state(rows);
  local.vr.sessions[0].hist[2].qty=90;
  local.vr.sessions[0].hist.splice(3,1);
  const saved=clone(c._rebaseStateOnRemote(base,local,base));
  assert.deepEqual(saved.vr.sessions[0].hist,local.vr.sessions[0].hist);
  assert.equal(saved.vr.sessions[0].hist[0].init,true);
});

test('VR migration rebuilds damaged generated rows once, preserving manual entries and real accounts',()=>{
  const c=runtime(),manual={type:'add',date:'2018-01-02',amt:100,ts:99};
  const s=state(rows.slice(2)).vr.sessions[0];s.hist.unshift(clone(manual));
  s.settings.simSig='r14|TECL|0.5|basic|10|0|11000|false|15|ladder|reinv';
  const oldSig=s.settings.simSig;
  assert.notEqual(c.simSig('vr',s.settings),oldSig);
  assert.equal(c.paperSyncSig('vr',s),true);
  assert.deepEqual(clone(s.hist),[manual]);
  assert.equal(s.settings.startv,0);
  assert.equal(s.settings.startCyc,undefined);
  assert.equal(c.paperSyncSig('vr',s),false);
  const real=state(rows).vr.sessions[0];real.paper=false;const before=clone(real);
  assert.equal(c.paperSyncSig('vr',real),false);
  assert.deepEqual(clone(real),before);
});

test('migration waits for matching quotes; unrelated strategy signatures stay unchanged',()=>{
  const c=runtime(),s=state(rows).vr.sessions[0],before=clone(s);
  c.PAPER_CACHESYM.vr=()=>'';
  assert.equal(c.paperSyncSig('vr',s),false);
  assert.deepEqual(clone(s),before);
  const inf={ticker:'SOXL',div:20,target:20,big:20,rows:3,revGap:5,reverse:false,tgtDyn:false,principal:10000,compound:true,divmode:'reinv',engine:'v40',shortMA:30,loPct:6};
  assert.equal(c.simSig('inf',inf),'r14|SOXL|20|20|20|3|5|false|false|10000|true|reinv|v40|30|6');
});
