/* Lossless transport for generated paper histories. Trading engines still receive
   the original stateV2. User-entered rows and every real session stay in users/uid.
   Content-addressed parts are immutable: a reader of an older parent revision
   cannot accidentally load a newer ledger. No history is deleted by migration. */
export const PAPER_HISTORY_FIELD='paperHistoryV1';
export const PAPER_SPLIT_AT=600*1024;
const PART_CHARS=60000;
const COMMIT_BYTES=8*1024*1024,COMMIT_WRITES=450,UPLOAD_LANES=4;
const SESSION_REF='_jkPaperHistoryRef';
const BOXES=['inf','vr','ma','ivs','dca','asap'];
const copy=x=>JSON.parse(JSON.stringify(x));
const generated=h=>!!(h&&(h.sim||h.auto));
const userPath=p=>/^users\/[^/]+$/.test(p||'');
const hashPattern=/^[a-f0-9]{64}$/;
// Firestore map key order is not the JavaScript insertion order. The signature
// binds values and array order, while remaining independent of map key order.
const stableJson=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
/* Saving one real trade used to re-copy, re-split and re-hash every unchanged
   paper session (several MB) on each save. Packing is a pure function of the
   session's JSON text, so its result is remembered by that exact text (PACKED);
   a changed session has different text and is packed again. Which parts are
   written is still decided by the store's own per-account read cache. */
const MEMO_MAX=64,PACKED=new Map();
const memo=(map,key,value)=>{map.delete(key);map.set(key,value);while(map.size>MEMO_MAX)map.delete(map.keys().next().value);return value;};
function failure(message){return Object.assign(new Error(message),{code:'paper-history-unavailable'});}
async function sha(s){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
function partsOf(s){
  const out=[];
  for(let i=0;i<s.length;){
    let end=Math.min(i+PART_CHARS,s.length);
    if(end<s.length&&s.charCodeAt(end-1)>=0xD800&&s.charCodeAt(end-1)<=0xDBFF)end++;
    out.push(s.slice(i,end));i=end;
  }
  return out;
}
function valueBytes(v){
  if(v==null||typeof v==='boolean')return 1;
  if(typeof v==='number')return 8;
  if(typeof v==='string')return new TextEncoder().encode(v).length+1;
  if(Array.isArray(v))return v.reduce((n,x)=>n+valueBytes(x),0);
  return Object.entries(v).reduce((n,[k,x])=>n+new TextEncoder().encode(k).length+1+valueBytes(x),0);
}
function selected(d){
  if(!d?.stateV2)return [];
  if(!d[PAPER_HISTORY_FIELD]&&valueBytes(d)<PAPER_SPLIT_AT)return [];
  const out=[];
  for(const box of BOXES)for(const [index,s] of (d.stateV2[box]?.sessions||[]).entries()){
    if(s?.paper===true&&Array.isArray(s.hist)&&s.hist.some(generated)){
      const original=JSON.stringify(s);
      let m=PACKED.get(original);
      if(m)memo(PACKED,original,m);
      else{
        const stub=JSON.parse(original);   // = copy(s)
        stub.hist=stub.hist.filter(h=>!generated(h));
        stub[SESSION_REF]='0'.repeat(64);
        // Older app versions can safely replay this regenerable paper cache.
        if(stub.settings){delete stub.settings.simSig;delete stub.settings.simLast;}
        m=memo(PACKED,original,{stub:JSON.stringify(stub),texts:partsOf(original)});
      }
      // Callers change the stub (SESSION_REF), so every call gets its own copy.
      out.push({box,index,id:String(s.id||''),original,stub:JSON.parse(m.stub),texts:m.texts,memo:m});
    }
  }
  return out;
}
/* Same field widths as the eventual manifest, without asynchronous hashing.
   Used only for size diagnostics; never used to write or calculate a trade. */
export function previewPaperDoc(d){
  const rows=selected(d);if(!rows.length)return d;
  const out=copy(d),sessions=[];
  for(const r of rows){
    out.stateV2[r.box].sessions[r.index]=r.stub;
    sessions.push({box:r.box,index:r.index,id:r.id,hash:'0'.repeat(64),stubHash:'0'.repeat(64),chars:r.original.length,parts:r.texts.map(()=>'0'.repeat(64))});
  }
  out[PAPER_HISTORY_FIELD]={version:1,sessions};return out;
}
export async function packPaperDoc(d){
  const rows=selected(d),out=copy(d),parts=new Map();
  if(!rows.length){delete out[PAPER_HISTORY_FIELD];return {data:out,parts};}
  const sessions=[];
  for(const r of rows){
    const m=r.memo;
    if(!m.ids){const ids=[];for(const text of r.texts)ids.push(await sha(text));m.hash=await sha(r.original);m.ids=ids;}
    r.texts.forEach((text,i)=>parts.set(m.ids[i],{version:1,text}));
    const hash=m.hash;r.stub[SESSION_REF]=hash;
    if(!m.stubHash)m.stubHash=await sha(stableJson(r.stub));
    out.stateV2[r.box].sessions[r.index]=r.stub;
    sessions.push({box:r.box,index:r.index,id:r.id,hash,stubHash:m.stubHash,chars:r.original.length,parts:[...m.ids]});
  }
  out[PAPER_HISTORY_FIELD]={version:1,sessions};return {data:out,parts};
}
export async function hydratePaperDoc(d,readPart,options={}){
  // The order server needs only connected IM paper sessions. Browser reads use
  // the default (all sessions); excluded sessions must not be used by a caller.
  const wanted=(box,s)=>(!options.boxes||options.boxes.includes(box))&&(!options.session||options.session(s));
  const hasStub=s=>!!s&&Object.prototype.hasOwnProperty.call(s,SESSION_REF)&&!s.hist?.some(generated);
  const manifest=d?.[PAPER_HISTORY_FIELD];
  if(!manifest){
    if(BOXES.some(b=>d?.stateV2?.[b]?.sessions?.some(s=>wanted(b,s)&&hasStub(s))))throw failure('모의 기록의 분할 목록이 없습니다. 기존 원장을 보호하기 위해 저장을 중단합니다.');
    return d;
  }
  if(manifest.version!==1||!Array.isArray(manifest.sessions))throw failure('모의 기록 저장 형식을 확인할 수 없습니다. 새로고침 후 다시 시도해 주세요.');
  const out=copy(d),pending=new Map();
  const getPart=id=>{if(!pending.has(id))pending.set(id,Promise.resolve().then(()=>readPart(id)));return pending.get(id);};
  await Promise.all(manifest.sessions.map(async e=>{
    if(options.boxes&&!options.boxes.includes(e.box))return;
    if(!BOXES.includes(e.box)||!Number.isInteger(e.index)||!Array.isArray(e.parts)||!e.parts.length||!e.parts.every(x=>hashPattern.test(x)))throw failure('모의 기록의 분할 목록이 올바르지 않습니다.');
    const sessions=out.stateV2?.[e.box]?.sessions||[];
    let index=e.index;
    if(String(sessions[index]?.id||'')!==e.id){
      const matches=sessions.map((s,i)=>String(s?.id||'')===e.id?i:-1).filter(i=>i>=0);
      if(matches.length>1)throw failure('모의 세션 식별자가 중복되어 기록을 읽지 못했습니다.');
      index=matches[0];
    }
    const s=sessions[index];
    // An old client may have removed/reordered a session or embedded a complete
    // freshly replayed history. Its current state takes precedence over old parts.
    if(!s||String(s.id||'')!==e.id||s.paper!==true)return;
    if(!wanted(e.box,s))return;
    if(s.hist?.some(generated)){delete s[SESSION_REF];return;}
    if(await sha(stableJson(s))!==e.stubHash)throw failure('모의 설정과 저장 기록의 판이 다릅니다. 다른 열린 창을 새로고침해 주세요. 기록은 삭제하지 않았습니다.');
    // The store passes text it already verified from the same cached parts of the
    // same account (options.verified); every other read verifies every part again.
    const known=options.verified?.get(e);
    let text;
    if(typeof known==='string'&&known.length===e.chars)text=known;
    else{
      const texts=await Promise.all(e.parts.map(async id=>{
        const p=await getPart(id);
        if(!p||p.version!==1||typeof p.text!=='string'||await sha(p.text)!==id)throw failure('모의 기록 일부를 읽지 못했습니다. 전체 기록을 불러올 때까지 저장을 중단합니다.');
        return p.text;
      }));
      text=texts.join('');
      if(text.length!==e.chars||await sha(text)!==e.hash)throw failure('모의 기록 검증에 실패했습니다. 기존 기록은 보존됩니다.');
      options.verified?.set(e,text);
    }
    const original=JSON.parse(text);
    if(original.paper!==true||String(original.id||'')!==e.id||!Array.isArray(original.hist))throw failure('모의 세션 원본을 확인할 수 없습니다.');
    out.stateV2[e.box].sessions[index]=original;
  }));
  if(BOXES.some(b=>out.stateV2?.[b]?.sessions?.some(s=>wanted(b,s)&&hasStub(s))))throw failure('모의 기록의 분할 목록이 누락되었습니다. 전체 기록을 불러올 때까지 저장을 중단합니다.');
  return out;
}
/* Firebase adapter. Buffer writes until all reads and hashes finish, keeping
   parent + new parts atomic in the application's existing transaction. */
export function createPaperStore(sdk){
  const cache=new Map(),MAX_CACHE=256,verified=new Map();
  const remember=(key,value)=>{cache.set(key,value);while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);};
  const partRef=(ref,id)=>sdk.doc(ref.firestore,...ref.path.split('/'),'paperHistory',id);
  /* A session text verified earlier for this account is reused only while every
     one of its parts is still in this account's part cache — exactly the case in
     which the full check would read the same cached parts and pass again. */
  const verifiedFor=path=>{const key=e=>path+'|'+e.hash+'|'+e.parts.join(',');return {
    get:e=>{const t=verified.get(key(e));return t!==undefined&&e.parts.every(id=>cache.has(path+'/'+id))?memo(verified,key(e),t):undefined;},
    set:(e,text)=>{memo(verified,key(e),text);}};};
  async function read(ref,get){
    const snap=await get(ref);
    if(!userPath(ref.path)||!snap.exists())return snap;
    const raw=snap.data(),data=await hydratePaperDoc(raw,async id=>{
      const key=ref.path+'/'+id;
      if(cache.has(key))return cache.get(key);
      const p=await get(partRef(ref,id));
      if(!p.exists())throw failure('모의 기록 일부가 아직 도착하지 않았습니다. 연결을 확인한 뒤 다시 불러와 주세요.');
      const value=p.data();remember(key,value);return value;
    },{verified:verifiedFor(ref.path)});
    return new Proxy(snap,{get(target,key){if(key==='data')return ()=>data;if(key==='paperStorageData')return ()=>raw;const v=Reflect.get(target,key,target);return typeof v==='function'?v.bind(target):v;}});
  }
  const getDoc=ref=>read(ref,sdk.getDoc);
  /* One commit is capped (8 MiB, 500 writes). A full re-apply of many long paper
     sessions can need more. Parts are immutable, content-addressed and unreferenced
     until the parent lands, so with sdk.setDoc they are uploaded first, outside the
     transaction (a few at a time), and the transaction is run again: it then writes
     the parent plus whatever is still missing. A failed upload leaves only an
     unreferenced part; the parent, and so every reader, still sees the old ledger. */
  async function upload(parts,uploaded){
    const list=[...parts];let at=0;
    const worker=async()=>{while(at<list.length){const [key,w]=list[at++];await sdk.setDoc(w.ref,w.data);uploaded.add(key);remember(key,w.data);}};
    await Promise.all(Array.from({length:Math.min(UPLOAD_LANES,list.length)},worker));
  }
  async function runTransaction(db,callback,options){
    const uploaded=new Set();
    for(let pass=0;;pass++){
      const big={parts:null};
      try{return await attempt(db,callback,options,uploaded,pass===0&&typeof sdk.setDoc==='function'?big:null);}
      catch(e){if(!big.parts||e!==big.signal)throw e;}
      await upload(big.parts,uploaded);
    }
  }
  function attempt(db,callback,options,uploaded,big){
    return sdk.runTransaction(db,async tx=>{
      const writes=[],rawDocs=new Map();
      const get=async ref=>{const snap=await read(ref,r=>tx.get(r));if(userPath(ref.path))rawDocs.set(ref.path,snap.paperStorageData?snap.paperStorageData():snap.data()||{});return snap;};
      const wrapped=new Proxy(tx,{get(target,key){
        if(key==='get')return get;
        if(key==='set')return (ref,data,opt)=>{writes.push({ref,data,opt});return wrapped;};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      const result=await callback(wrapped),ready=[],newParts=new Map();
      for(const w of writes){
        if(!userPath(w.ref.path)||!Object.prototype.hasOwnProperty.call(w.data,'stateV2')){ready.push(w);continue;}
        if(!rawDocs.has(w.ref.path))throw failure('모의 원장을 읽기 전에 저장할 수 없습니다.');
        const raw=rawDocs.get(w.ref.path),logical={...raw,...w.data};
        const packed=await packPaperDoc(logical),data={...w.data,stateV2:packed.data.stateV2};
        data[PAPER_HISTORY_FIELD]=packed.data[PAPER_HISTORY_FIELD]||sdk.deleteField();
        for(const [id,p] of packed.parts){
          const key=w.ref.path+'/'+id;
          if(!cache.has(key)&&!uploaded.has(key)&&!newParts.has(key))newParts.set(key,{ref:partRef(w.ref,id),data:p});
        }
        ready.push({...w,data});
      }
      // The Firebase request limit applies to the whole atomic commit as well.
      const bytes=[...newParts.values(),...ready].reduce((n,w)=>n+new TextEncoder().encode(JSON.stringify(w.data)).length,0);
      if(bytes>COMMIT_BYTES||newParts.size+ready.length>COMMIT_WRITES){
        // Abort this attempt without writing; the parts go up first (see upload).
        if(big&&newParts.size){big.parts=newParts;big.signal=Object.assign(new Error('paper parts upload first'),{code:'paper-upload-first'});throw big.signal;}
        throw failure('한 번에 저장할 모의 기록이 너무 큽니다. 기록을 지우지 말고 세션별로 나누어 계산해 주세요.');
      }
      for(const w of newParts.values())tx.set(w.ref,w.data);
      for(const w of ready)tx.set(w.ref,w.data,w.opt);
      // Cache only reads or acknowledged commits, never uncommitted new parts.
      return {result,newParts};
    },options).then(({result,newParts})=>{for(const [key,w] of newParts)remember(key,w.data);return result;});
  }
  return {getDoc,runTransaction,previewPaperDoc};
}
