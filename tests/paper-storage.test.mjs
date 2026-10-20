import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createPaperStore,packPaperDoc,hydratePaperDoc,previewPaperDoc,PAPER_HISTORY_FIELD} from '../jk-paper-store.mjs';

const clone=x=>JSON.parse(JSON.stringify(x));
// Firestore sorts stored map keys. Every cold snapshot below models that,
// including nested maps, rather than preserving the writer's insertion order.
const storedMap=v=>Array.isArray(v)?v.map(storedMap):v&&typeof v==='object'
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,storedMap(v[k])])):v;
const DEL={_delete:true};
function bytes(v){
  if(v==null||typeof v==='boolean')return 1;
  if(typeof v==='number')return 8;
  if(typeof v==='string')return Buffer.byteLength(v)+1;
  if(Array.isArray(v))return v.reduce((n,x)=>n+bytes(x),0);
  return Object.entries(v).reduce((n,[k,x])=>n+Buffer.byteLength(k)+1+bytes(x),0);
}
function fixture(){
  const sessions=Array.from({length:18},(_,i)=>({id:'p'+i,paper:true,name:'모의 '+i,
    settings:{ticker:i%2?'SOXL':'TECL',div:20,simSig:'original-'+i,simLast:'2026-10-15'},
    hist:[{ts:0,date:'2024-01-01',kind:'수동입력',amt:12345.67,note:'사용자 원본 😀'},
      ...Array.from({length:450},(_,j)=>({ts:j+1,date:'2026-10-15',kind:j%4?'매수':'매도',price:13.217,qty:7,fee:0.12345,cyc:3,sim:true,note:'거래 판단 근거와 수수료를 보존한다 😀'.repeat(3)})),
      {ts:9999,date:'2026-10-16',kind:'사용자 추가',amt:71.25}]}));
  return {stateV2:{activeTab:'inf',inf:{active:'p0',sessions},vr:{sessions:[]},ma:{sessions:[]},ivs:{sessions:[]},dca:{sessions:[]},asap:{sessions:[{id:'real',paper:false,hist:[{sim:true,amt:999,note:'실계좌는 어떤 행도 옮기지 않는다'}]}]}},
    stateV2Rev:4,scalp:{log:[{price:112,qty:3}]},fiveYearPlanV2:{alphaLedger:{events:[{id:'cash',amount:123}]}}};
}
function firestore(initial={}){
  const docs=new Map(Object.entries(initial).map(([k,v])=>[k,clone(v)])),reads=[],commits=[];
  let fail=null,retry=null;
  const db={};
  const doc=(db,...parts)=>({firestore:db,path:parts.join('/')});
  const snap=ref=>({ref,exists:()=>docs.has(ref.path),data:()=>docs.has(ref.path)?storedMap(clone(docs.get(ref.path))):undefined});
  const getDoc=async ref=>{reads.push(ref.path);return snap(ref);};
  const runTransaction=async(db,fn)=>{
    async function attempt(){
      const writes=[];let writing=false;
      const tx={get:async ref=>{assert(!writing,'transaction reads must precede writes');return getDoc(ref);},set:(ref,data,opt)=>{writing=true;writes.push({ref,data:clone(data),opt});}};
      const out=await fn(tx);return {out,writes};
    }
    let result=await attempt();
    if(retry){const callback=retry;retry=null;callback(docs);result=await attempt();}
    if(fail)throw fail;
    const next=new Map(docs);
    for(const {ref,data,opt} of result.writes){
      const value=opt?.merge?{...(next.get(ref.path)||{}),...data}:data;
      for(const k of Object.keys(value))if(value[k]?._delete)delete value[k];
      assert(bytes(value)<1048576,ref.path+' exceeds Firestore document limit: '+bytes(value));
      next.set(ref.path,clone(value));
    }
    docs.clear();for(const [k,v] of next)docs.set(k,v);
    commits.push(result.writes);return result.out;
  };
  const sdk={doc,getDoc,runTransaction,deleteField:()=>DEL};
  return {docs,reads,commits,db,sdk,ref:doc(db,'users','u1'),store:createPaperStore(sdk),setFailure:e=>{fail=e;},retryOnce:f=>{retry=f;}};
}
async function save(f,data){
  return f.store.runTransaction(f.db,async tx=>{
    const snap=await tx.get(f.ref),d=snap.data()||{};
    tx.set(f.ref,{stateV2:data.stateV2,stateV2Rev:(d.stateV2Rev||0)+1},{merge:true});return 'saved';
  });
}

test('small documents and non-user references retain their existing format',async()=>{
  const d={stateV2:{inf:{sessions:[{id:'one',paper:true,hist:[{sim:true,qty:2}]}]}},stateV2Rev:1};
  const packed=await packPaperDoc(d);assert.deepEqual(packed.data,d);assert.equal(packed.parts.size,0);
  const f=firestore({'users/u1':d});await save(f,d);
  assert(!f.docs.get('users/u1')[PAPER_HISTORY_FIELD]);
  assert.deepEqual((await f.store.getDoc(f.ref)).data().stateV2,d.stateV2);
  await f.store.runTransaction(f.db,async tx=>{tx.set(f.sdk.doc(f.db,'profiles','u1'),{name:'이름'});});
  assert.deepEqual(f.docs.get('profiles/u1'),{name:'이름'});
});

test('multi-MiB generated histories save atomically and cold-read exactly, including fees and manual row order',async()=>{
  const original=fixture();assert(bytes(original)>1048576);
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}},stateV2Rev:4,scalp:original.scalp,fiveYearPlanV2:original.fiveYearPlanV2}});
  assert.equal(await save(f,original),'saved');
  const stored=f.docs.get('users/u1');
  assert(bytes(stored)<80*1024,'base document stays small: '+bytes(stored));
  assert.equal(stored[PAPER_HISTORY_FIELD].sessions.length,18);
  for(const s of stored.stateV2.inf.sessions){
    assert.equal(s.hist.length,2,'both manual rows stay in base document');
    assert(!s.settings.simSig&&!s.settings.simLast,'old clients replay rather than trust a partial paper history');
  }
  assert.deepEqual(stored.stateV2.asap,original.stateV2.asap,'real sessions are never split');
  const cold=createPaperStore(f.sdk),snap=await cold.getDoc(f.ref),restored=snap.data();
  assert.notDeepEqual(Object.keys(stored.stateV2.inf.sessions[0]),Object.keys(snap.paperStorageData().stateV2.inf.sessions[0]),'stored map order differs from writer order');
  assert.deepEqual(restored.stateV2,original.stateV2,'all 8,136 rows and session settings survive exactly');
  assert.deepEqual(restored.scalp,original.scalp);assert.deepEqual(restored.fiveYearPlanV2,original.fiveYearPlanV2);
  assert.equal(restored.stateV2Rev,5);
  assert.deepEqual(snap.paperStorageData(),stored,'diagnostics can measure physical base document');
  assert.equal(bytes(previewPaperDoc({...original,stateV2Rev:5})),bytes(stored),'size preview measures stored representation');
  console.log('paper storage: logical '+bytes(original)+' bytes → base '+bytes(stored)+' bytes; '+(f.docs.size-1)+' parts');
});

test('unchanged histories are reused; editing one paper session writes only that session and the parent',async()=>{
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}}),d=fixture();await save(f,d);
  const snap=await f.store.getDoc(f.ref),next=snap.data();
  next.stateV2.inf.sessions[0].hist.at(-1).amt=999;
  await save(f,next);
  const writes=f.commits.at(-1);
  assert(writes.length<8,'only changed chunks, not every session: '+writes.length);
  assert.deepEqual((await createPaperStore(f.sdk).getDoc(f.ref)).data().stateV2,next.stateV2);
  const again=(await f.store.getDoc(f.ref)).data();await save(f,again);
  assert.equal(f.commits.at(-1).length,1,'unchanged parts do not consume writes');
});

test('permission or quota failure leaves both parent and parts unchanged; retry does not trust uncommitted parts',async()=>{
  const original={stateV2:{inf:{sessions:[]}},stateV2Rev:1},f=firestore({'users/u1':original});
  f.setFailure(Object.assign(new Error('permission denied'),{code:'permission-denied'}));
  await assert.rejects(save(f,fixture()),{code:'permission-denied'});
  assert.equal(f.docs.size,1);assert.deepEqual(f.docs.get('users/u1'),original);
  f.setFailure(null);await save(f,fixture());
  assert.deepEqual((await createPaperStore(f.sdk).getDoc(f.ref)).data().stateV2,fixture().stateV2);
});

test('missing or corrupt parts block reads and subsequent saves rather than returning a shortened history',async()=>{
  for(const corrupt of [false,true]){
    const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}});await save(f,fixture());
    const id=f.docs.get('users/u1')[PAPER_HISTORY_FIELD].sessions[0].parts[0],path='users/u1/paperHistory/'+id;
    if(corrupt)f.docs.set(path,{version:1,text:'changed'});else f.docs.delete(path);
    const cold=createPaperStore(f.sdk),before=clone(f.docs.get('users/u1'));
    await assert.rejects(cold.getDoc(f.ref),{code:'paper-history-unavailable'});
    await assert.rejects(cold.runTransaction(f.db,async tx=>{await tx.get(f.ref);tx.set(f.ref,{stateV2:{inf:{sessions:[]}}},{merge:true});}),{code:'paper-history-unavailable'});
    assert.deepEqual(f.docs.get('users/u1'),before);
  }
});

test('a missing manifest or a missing session entry cannot silently become an empty paper ledger',async()=>{
  for(const removeWhole of [false,true]){
    const p=await packPaperDoc(fixture()),d=clone(p.data);
    if(removeWhole)delete d[PAPER_HISTORY_FIELD];else d[PAPER_HISTORY_FIELD].sessions.pop();
    await assert.rejects(hydratePaperDoc(d,id=>p.parts.get(id)),{code:'paper-history-unavailable'});
  }
});

test('an older parent snapshot remains readable after a newer save; user deletion stays deleted',async()=>{
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}}),d=fixture();await save(f,d);
  const old=clone(f.docs.get('users/u1')),next=(await f.store.getDoc(f.ref)).data();
  next.stateV2.inf.sessions[0].hist=next.stateV2.inf.sessions[0].hist.filter(h=>h.ts!==0);
  next.stateV2.inf.sessions[0].hist.push({sim:true,ts:10000,price:99,qty:3});await save(f,next);
  const read=id=>f.docs.get('users/u1/paperHistory/'+id);
  assert.deepEqual((await hydratePaperDoc(old,read)).stateV2,d.stateV2,'old revision never picks up new parts');
  const current=(await createPaperStore(f.sdk).getDoc(f.ref)).data();
  assert(!current.stateV2.inf.sessions[0].hist.some(h=>h.ts===0));
  assert(current.stateV2.inf.sessions[0].hist.some(h=>h.ts===10000));
});

test('one oversized Unicode record round-trips, including a surrogate pair on a part boundary',async()=>{
  const d={stateV2:{inf:{sessions:[{id:'unicode',paper:true,hist:[{sim:true,note:('x'.repeat(59999)+'😀한글').repeat(12)}]}]}},stateV2Rev:1};
  const p=await packPaperDoc(d);assert(p.parts.size>1);
  for(const part of p.parts.values()){
    assert(Buffer.byteLength(part.text)<256*1024);
    assert.equal(Buffer.from(part.text,'utf8').toString('utf8'),part.text,'no split surrogate');
  }
  assert.deepEqual((await hydratePaperDoc(p.data,id=>p.parts.get(id))).stateV2,d.stateV2);
});

test('SDK transaction retry gets a fresh remote state and does not leak writes from the abandoned attempt',async()=>{
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}},stateV2Rev:1}}),d=fixture();
  f.retryOnce(docs=>docs.set('users/u1',{stateV2:{inf:{sessions:[]}},stateV2Rev:42,scalp:{remote:'preserved'}}));
  await save(f,d);
  const out=(await createPaperStore(f.sdk).getDoc(f.ref)).data();
  assert.equal(out.stateV2Rev,43);assert.deepEqual(out.scalp,{remote:'preserved'});
  assert.deepEqual(out.stateV2,d.stateV2);assert.equal(f.commits.length,1);
});

test('cache is scoped to account, and stale embedded full histories take precedence over an old manifest',async()=>{
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}}),d=fixture();await save(f,d);
  const old=f.docs.get('users/u1');
  f.docs.set('users/u2',clone(old));
  await assert.rejects(f.store.getDoc(f.sdk.doc(f.db,'users','u2')),{code:'paper-history-unavailable'},'must not reuse u1 parts');
  const embedded={...old,stateV2:d.stateV2};embedded.stateV2.inf.sessions[0].hist.push({sim:true,ts:123456,qty:1});
  f.docs.set('users/u1',embedded);
  assert.deepEqual((await createPaperStore(f.sdk).getDoc(f.ref)).data().stateV2,embedded.stateV2);
});

test('order-server hydration reads only connected IM sessions, while normal browser reads remain complete',async()=>{
  const d=fixture();d.stateV2.inf.sessions[0].kis=true;
  d.stateV2.vr.sessions=clone(d.stateV2.inf.sessions).map((s,i)=>({...s,id:'vr'+i}));
  const p=await packPaperDoc(d),selected=p.data[PAPER_HISTORY_FIELD].sessions.find(x=>x.box==='inf'&&x.id==='p0'),reads=[];
  const allowed=new Set(selected.parts);
  const out=await hydratePaperDoc(storedMap(p.data),id=>{reads.push(id);assert(allowed.has(id),'unrelated history must not consume server requests');return p.parts.get(id);},
    {boxes:['inf'],session:s=>s?.paper===true&&!!s.kis});
  assert.deepEqual(out.stateV2.inf.sessions[0],d.stateV2.inf.sessions[0]);
  assert.equal(reads.length,allowed.size);assert(reads.length<5);
  assert.deepEqual((await hydratePaperDoc(storedMap(p.data),id=>p.parts.get(id))).stateV2,d.stateV2,'browser defaults still hydrate every session');
  await assert.rejects(hydratePaperDoc(p.data,()=>null,{boxes:['inf'],session:s=>s?.paper===true&&!!s.kis}),{code:'paper-history-unavailable'});
});

test('session reorder hydrates by identity, and an explicitly cleared history removes the manifest without reviving rows',async()=>{
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}}),d=fixture();await save(f,d);
  const raw=f.docs.get('users/u1');raw.stateV2.inf.sessions.reverse();f.docs.set('users/u1',raw);
  const reversed=(await createPaperStore(f.sdk).getDoc(f.ref)).data();
  assert.deepEqual(reversed.stateV2.inf.sessions,d.stateV2.inf.sessions.toReversed());
  reversed.stateV2.inf.sessions.forEach(s=>{s.hist=s.hist.filter(h=>!h.sim&&!h.auto);});
  await save(f,reversed);
  assert(!f.docs.get('users/u1')[PAPER_HISTORY_FIELD]);
  assert.deepEqual((await createPaperStore(f.sdk).getDoc(f.ref)).data().stateV2,reversed.stateV2);
});

/* 2026-10-20: 실거래 한 건을 저장할 때마다 바뀌지 않은 모의 세션 수 MB 를 다시 복사·분할·해시했다(아이폰에서 '한참 가만히').
   같은 글자면 같은 결과라 원문 글자로 기억해 다시 쓴다. 쓰는 내용은 그대로여야 하고, 바뀐 세션은 새로 계산해야 한다. */
test('saving again reuses packing and verification of unchanged sessions (same bytes, far fewer hashes); a changed session is hashed afresh',async()=>{
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}});await save(f,fixture());
  const subtle=globalThis.crypto.subtle,real=subtle.digest;let n=0;
  subtle.digest=function(...a){n++;return real.apply(this,a);};
  try{
    const cur=(await f.store.getDoc(f.ref)).data(),before=clone(Object.fromEntries(f.docs));
    n=0;await save(f,cur);
    const manifest=f.docs.get('users/u1')[PAPER_HISTORY_FIELD];
    assert(n<=manifest.sessions.length,`unchanged sessions must not be re-split and re-hashed: ${n} digests for ${manifest.sessions.length} sessions`);
    assert.deepEqual(manifest,before['users/u1'][PAPER_HISTORY_FIELD]);
    for(const [k,v] of Object.entries(before))if(k!=='users/u1')assert.deepEqual(f.docs.get(k),v,k);
    const next=(await f.store.getDoc(f.ref)).data();next.stateV2.inf.sessions[3].hist.push({sim:true,ts:777,price:1,qty:1});
    await save(f,next);
    const e=f.docs.get('users/u1')[PAPER_HISTORY_FIELD].sessions.find(x=>x.id==='p3');
    assert.equal(e.hash,createHash('sha256').update(JSON.stringify(next.stateV2.inf.sessions[3])).digest('hex'),'changed session is packed from its new text');
    assert.deepEqual((await createPaperStore(f.sdk).getDoc(f.ref)).data().stateV2,next.stateV2);
  }finally{delete subtle.digest;if(subtle.digest!==real)subtle.digest=real;}
});

// 이미 검증한 원문은 이 계정의 조각이 캐시에 다 남아 있을 때만 다시 쓴다 — 밀려났으면 저장소에서 다시 읽고 검사한다
async function evictedPartScenario(store){
  const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}});if(store)f.store=store(f.sdk);
  await save(f,fixture());await f.store.getDoc(f.ref);
  // 조각은 내용 주소라 같은 글자면 하나로 합쳐진다 — 줄마다 번호를 달아 조각 260개가 서로 다르게 한다
  const big={stateV2:{inf:{sessions:[{id:'big',paper:true,hist:Array.from({length:260},(_,i)=>({sim:true,note:String(i).padStart(6,'0')+'y'.repeat(60000)}))}]},vr:{sessions:[]}}};
  const p=await packPaperDoc(big);assert(p.parts.size>256,'distinct parts: '+p.parts.size);
  f.docs.set('users/u9',storedMap(p.data));for(const [id,v] of p.parts)f.docs.set('users/u9/paperHistory/'+id,v);
  await f.store.getDoc(f.sdk.doc(f.db,'users','u9'));   // 다른 계정의 조각 260개가 캐시(256)를 밀어낸다
  f.docs.delete('users/u1/paperHistory/'+f.docs.get('users/u1')[PAPER_HISTORY_FIELD].sessions[0].parts[0]);
  return f.store.getDoc(f.ref);
}
test('verified reuse needs every part still in this account cache: after eviction a missing part blocks the read again',async()=>{
  await assert.rejects(evictedPartScenario(),{code:'paper-history-unavailable'});
});

test('memo invariants reject an id-keyed pack memo and reuse without the cache check (2 mutations)',async()=>{
  const source=readFileSync(new URL('../jk-paper-store.mjs',import.meta.url),'utf8');
  const load=async(pairs)=>{let s=source;for(const [from,to] of pairs){assert(s.includes(from),'mutation target '+from);s=s.replace(from,to);}
    return import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));};
  { const m=await load([['let m=PACKED.get(original);','let m=PACKED.get(String(s.id));'],['m=memo(PACKED,original,','m=memo(PACKED,String(s.id),']]);
    const f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}});f.store=m.createPaperStore(f.sdk);
    const d=fixture();await save(f,d);const next=clone(d);next.stateV2.inf.sessions[3].hist.push({sim:true,ts:777,price:1,qty:1});await save(f,next);
    let detected=false;try{assert.deepEqual((await m.createPaperStore(f.sdk).getDoc(f.ref)).data().stateV2,next.stateV2);}catch{detected=true;}
    assert(detected,'must reject mutation: id-keyed pack memo'); }
  { const m=await load([["e.parts.every(id=>cache.has(path+'/'+id))?","true?"]]);
    // 위 시험은 '거절되어야 한다'를 본다 — 고친 코드를 빼면 거절이 사라져 그 시험이 빨간불이 된다
    const outcome=await evictedPartScenario(m.createPaperStore).then(()=>'read',()=>'blocked');
    assert.equal(outcome,'read','mutation must change the outcome the eviction test checks: reuse without the cache check'); }
});

test('value invariants reject disabled splitting, lost rows, uncommitted parts and insertion-order signatures (4 mutations)',async()=>{
  const source=readFileSync(new URL('../jk-paper-store.mjs',import.meta.url),'utf8');
  const mutations=[
    ['disabled splitting','const rows=selected(d),out=copy(d),parts=new Map();','const rows=[],out=copy(d),parts=new Map();'],
    ['lost row','out.stateV2[e.box].sessions[index]=original;','original.hist.pop();out.stateV2[e.box].sessions[index]=original;'],
    ['uncommitted cache','newParts.set(key,{ref:partRef(w.ref,id),data:p});','newParts.set(key,{ref:partRef(w.ref,id),data:p});remember(key,p);'],
    ['map order signature','sha(stableJson(r.stub))','sha(JSON.stringify(r.stub))']
  ];
  for(const [name,from,to] of mutations){
    assert(source.includes(from),'mutation target '+name);
    const mutated=await import('data:text/javascript;base64,'+Buffer.from(source.replace(from,to)).toString('base64'));
    let detected=false;
    try{
      const d=fixture(),f=firestore({'users/u1':{stateV2:{inf:{sessions:[]}}}});f.store=mutated.createPaperStore(f.sdk);
      if(name==='uncommitted cache'){
        f.setFailure(new Error('network write rejected'));await assert.rejects(save(f,d));f.setFailure(null);
      }
      await save(f,d);
      const restored=(await mutated.createPaperStore(f.sdk).getDoc(f.ref)).data();
      assert.deepEqual(restored.stateV2,d.stateV2);
    }catch{detected=true;}
    assert(detected,'must reject mutation: '+name);
  }
});

test('all current stateV2 consumers use the adapter, including server order calculations',()=>{
  const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
  for(const f of ['index.html','admin.html','plan.html']){
    assert.match(read(f),/createPaperStore/);assert.match(read(f),/jk-paper-store\.mjs\?v=1\.0\.1/);
  }
  const server=read('functions/api/autotrade.js');
  assert.match(server,/await hydratePaperDoc\(rawDoc/);
  assert(server.indexOf('await hydratePaperDoc(rawDoc')<server.indexOf('const { orders, skip } = imOrders('));
  assert.match(read('firestore.rules'),/match \/\{document=\*\*\}.*?isMine\(uid\) && approved\(\)/s);
  assert(!/모의 세션을 지우거나/.test(read('index.html')));
  const html=read('index.html');
  const functions=html.slice(html.indexOf('function utf8Len(s)'),html.indexOf('const DB_FIELD_LABEL='));
  const constants='const DB_DOC_LIMIT=1048576, DB_DOC_WARN=Math.round(1048576*0.8);\n';
  const plan=new Function('window',constants+functions+';return dbPlanWrite;')({JKPaperStore:{previewPaperDoc}});
  const old={stateV2:{inf:{sessions:[]}},state:{note:'x'.repeat(860*1024)}};
  const fields={stateV2:{inf:{sessions:[{id:'p',paper:true,hist:[{sim:true,note:'x'.repeat(500*1024)}]}]}}};
  const prediction=plan('users/u1',old,fields,false,true);
  assert(prediction.archive,'large legacy copy is archived');
  assert(prediction.parts.find(p=>p.k==='stateV2').bytes>500*1024,'after archiving, size preview re-evaluates the actual unsplit small state');
});
