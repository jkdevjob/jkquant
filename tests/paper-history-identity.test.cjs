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

/* ── 듀얼가드 화면(plan.html)도 같은 원장(stateV2)을 합쳐 저장한다 — 신분 규칙이 운영 화면과 같아야 한다 ──
   2026-11-10 사용자 화면: 밸류리밸런싱 모의 3줄의 투입이 $544 · $531 · $496, 세후 TR +27,000~39,000%.
   실제 시세로 다시 재 보니 첫 매수(init)와 잔돈(add) 두 줄이 빠진 장부의 값과 달러까지 같았다(TECL 거치: 투입 86,663 → 544.10 · 평가 689,445 → 352,932).
   듀얼가드 화면이 세션을 저장할 때(원격이 그새 바뀌었으면) 운영 원장의 모든 세션 기록을 ts 만으로 Map 에 넣어, 같은 밀리초에 만든 모의 기록의 머리를 뒤 체결이 덮었다. */
const planHtml=fs.readFileSync(process.env.JKQ_PLAN||path.join(__dirname,'../plan.html'),'utf8');
function fnOf(src,name){
  const start=src.indexOf('function '+name+'(');assert(start>=0,name);
  let i=src.indexOf('{',start),depth=0;
  for(;i<src.length;i++){if(src[i]==='{')depth++;else if(src[i]==='}'&&!--depth)return src.slice(start,i+1);}
  throw Error('unterminated '+name);
}
const planMethods=['cloneObj','planStableJson','planRecSem','planRecKey','planRecEntries','planRebaseRecords','planRebaseOperating','planOpHistoryMap','planMapSig','planOpHistorySig','planOpPreserves'];
function planRuntime(src=planHtml){const c=vm.createContext({console,Map,Set,JSON});vm.runInContext(planMethods.map(n=>fnOf(src,n)).join('\n'),c);return c;}
const withPlan=(st,name)=>{st.plan={activeByHorizon:{5:''},sessions:[{id:'p1',name:name||'모의',horizon:5,paper:true,settings:{alphaRules:'base'},ledger:null}]};return st;};

/* 오늘 일어난 일 그대로: 듀얼가드 화면(base=읽었던 원장)에서 세션 설정만 바꿔 저장 · 그새 운영 화면이 원장 판을 올렸다(remote). VR 기록은 누구도 안 건드렸다. */
function planSaveKeepsLedger(src){
  const P=planRuntime(src),c=runtime();
  const base=withPlan(state(rows)),cand=withPlan(state(rows),'공포 모의'),remote=withPlan(state(rows));
  cand.plan.sessions[0].settings.alphaRules='panic';remote.paperCommon={simStart:'2020-01-01'};
  const before=ledger(c,base);
  const out=clone(P.planRebaseOperating(base,cand,remote));
  assert.deepEqual(out.vr.sessions[0].hist,rows,'VR 모의 기록이 한 줄도 안 빠진다');
  assert.equal(out.vr.sessions[0].hist[0].init,true,'첫 매수가 맨 앞에 남는다');
  assert.deepEqual(ledger(c,out),before,'장부(보유 · Pool · 총투입)가 저장 전과 같다');
  assert.equal(ledger(c,out).grossIn,11100);assert.equal(ledger(c,out).qty,950);
  assert.equal(out.plan.sessions[0].settings.alphaRules,'panic','이 화면이 바꾼 것은 반영');
  // 원격에만 새로 생긴(ts 가 겹치는) 모의 기록도 받는다 — 오래 열어 둔 듀얼가드 창
  const b2=withPlan(state(rows.slice(0,2))),c2=withPlan(state(rows.slice(0,2)),'이름만 바꿈'),r2=withPlan(state(rows));
  assert.deepEqual(clone(P.planRebaseOperating(b2,c2,r2)).vr.sessions[0].hist,rows,'원격의 새 기록 5줄을 다 받는다');
  // 이 화면에서 한 줄을 지웠으면 그 줄만 빠진다(같은 ts 의 다른 줄은 남는다)
  const c3=withPlan(state(rows));c3.vr.sessions[0].hist.splice(2,1);
  assert.deepEqual(clone(P.planRebaseOperating(withPlan(state(rows)),c3,withPlan(state(rows)))).vr.sessions[0].hist,rows.filter((_,i)=>i!==2));
  // 지문: 겹친 ts 의 줄도 하나하나 센다 — 줄 하나가 빠지면 지문이 달라진다
  assert.equal(P.planOpHistoryMap(state(rows)).size,c._stateHistoryMap(state(rows)).size,'지문 줄 수 = 운영 화면');
  assert.notEqual(P.planOpHistorySig(state(rows)),P.planOpHistorySig(state(rows.slice(1))));
  assert.equal(P.planOpPreserves(state(rows.slice(2)),state(rows)),false,'머리 두 줄이 빠진 원장은 "보존"이 아니다');
}
test('plan page save keeps every generated VR row when timestamps collide (opening buy · change · fills)',()=>planSaveKeepsLedger(planHtml));

test('plan page and operations page give every record the same identity',()=>{
  const P=planRuntime(),c=runtime();
  const samples=[...rows,Object.fromEntries(Object.entries(rows[0]).reverse()),{type:'buy',date:'2026-11-01',price:20,qty:3,ts:1},{type:'buy',date:'2026-11-01',price:20,qty:3,ts:1,id:'t-1'},
    {type:'sell',date:'2026-11-02',price:21,qty:1},{id:'planpaper_20260102_1',date:'2026-01-02',type:'trade',symbol:'TECL'},{date:'2020-01-02',kind:'buy',price:1,qty:2,ts:5,sim:true}];
  for(const r of samples)assert.equal(P.planRecKey(r),c._histKeyPart(r),JSON.stringify(r));
  assert.equal(P.planRecKey(rows[0]),P.planRecKey(Object.fromEntries(Object.entries(rows[0]).reverse())),'칸 순서와 무관');
  assert.notEqual(P.planRecKey(rows[0]),P.planRecKey(rows[2]),'같은 ts 의 다른 거래는 다른 신분');
  assert.equal(P.planRecKey({type:'sell',date:'2026-11-02',price:21,qty:1}),'');
});

test('mutations: restoring the timestamp-only identity in plan.html is caught',()=>{
  const muts=[
    ['생성 기록도 ts 만(옛 동작)',s=>s.replace("  if(r&&r.ts!=null&&(r.sim||r.auto))return 'generated:'+String(r.ts)+'|'+planRecSem(r);\n","")],
    ['합치기가 옛 키를 직접 계산',s=>s.replace("    let k=planRecKey(r);","    let k=r&&r.id!=null?'id:'+String(r.id):r&&r.ts!=null?'ts:'+String(r.ts):'';")],
    ['내용 키에 내용이 없음',s=>s.replace("  const o={};Object.keys(x).filter(k=>k!=='id'&&k!=='ts').sort().forEach(k=>{o[k]=x[k];});\n  return planStableJson(o);","  return '';")],
    ['지문이 ts 만 봄',s=>s.replace("        const id=planRecKey(r)||'fallback:'+String(r&&r.date||'')+':'+String(r&&(r.kind||r.type)||'')+':'+i;","        const id=r&&r.id!=null?'id:'+r.id:r&&r.ts!=null?'ts:'+r.ts:'fallback:'+i;")],
  ];
  for(const [name,f] of muts){const m=f(planHtml);assert.notEqual(m,planHtml,'변이가 들어가야 한다: '+name);assert.throws(()=>planSaveKeepsLedger(m),assert.AssertionError,'변이 생존: '+name);}
});

test('damaged VR paper ledgers are rebuilt once more (ledger3) and the stale list cache is dropped',()=>{
  const c=runtime(),s=state(rows.slice(2)).vr.sessions[0];
  assert.match(c.simSig('vr',s.settings),/^r\d+\|ledger3\|/);
  s.settings.simSig=c.simSig('vr',s.settings).replace('ledger3|','ledger2|');   // 어제까지의 지문 — 머리가 빠진 장부
  assert.equal(c.paperSyncSig('vr',s),true,'다시 만든다');assert.deepEqual(clone(s.hist),[]);assert.equal(c.paperSyncSig('vr',s),false,'한 번만');
  assert.ok(+((html.match(/const PAPER_VIEW_CACHE_VER=(\d+);/)||[])[1])>=8,'지난 목록 값(머리 빠진 장부로 센 것)을 다시 센다');
});
