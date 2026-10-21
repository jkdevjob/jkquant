const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const idx=read('index.html'),plan=read('plan.html'),scal=read('scalping.html'),ipo=read('ipo.html');

function fn(src,marker){
  const start=src.indexOf(marker);assert(start>=0,'missing '+marker);
  let i=src.indexOf('{',start),depth=0,inS=false,inD=false,inT=false,esc=false,line=false,block=false;
  for(;i<src.length;i++){
    const ch=src[i],nx=src[i+1];
    if(line){if(ch==='\n')line=false;continue;}
    if(block){if(ch==='*'&&nx==='/'){block=false;i++;}continue;}
    if(esc){esc=false;continue;}
    if(inS||inD||inT){
      if(ch==='\\'){esc=true;continue;}
      if(inS&&ch==="'")inS=false;else if(inD&&ch==='"')inD=false;else if(inT&&ch==='\`')inT=false;
      continue;
    }
    if(ch==='/'&&nx==='/'){line=true;i++;continue;}
    if(ch==='/'&&nx==='*'){block=true;i++;continue;}
    if(ch==="'"){inS=true;continue;} if(ch==='"'){inD=true;continue;} if(ch==='\`'){inT=true;continue;}
    if(ch==='{')depth++; else if(ch==='}'&&!--depth)return src.slice(start,i+1);
  }
  throw Error('unterminated '+marker);
}
function ok(name,cond){assert.ok(cond,name);console.log('PASS '+name);}

/* ── 운영 원장 ── */
ok('운영 stateV2는 Firestore transaction으로 저장',
  /runTransaction/.test(fn(idx,'async function _commitStateRemote(where)'))
  && /stateV2:candidate/.test(fn(idx,'async function _commitStateRemote(where)'))
  && /stateV2Rev:nr/.test(fn(idx,'async function _commitStateRemote(where)')));
ok('운영 DB revision 변경은 3-way rebase로 처리',
  /candidate=_rebaseStateOnRemote\(stateDbBase,candidate,remote\)/.test(fn(idx,'async function _commitStateRemote(where)')));
ok('운영 새로고침은 Firebase remote를 그대로 메모리 정본으로 사용',
  /S=JSON\.parse\(JSON\.stringify\(remote\)\)/.test(fn(idx,'async function pullRemote()')));
ok('다른 기기/탭 최신 이력 경고 팝업이 없음',
  !idx.includes('다른 기기/탭의 최신 거래이력이 감지되어')&&!idx.includes('DB에 더 최신 거래이력이 있어'));
ok('수동 무매 거래는 DB 성공 확인 후 입력창을 닫음',
  /const dbOk=await pushRemoteNow\(\)/.test(fn(idx,'async function sheetSaveInf()'))
  && /if\(!dbOk\)/.test(fn(idx,'async function sheetSaveInf()')));

const idxFns=['_histKeyPart','_histStableJson','_histSemanticKey','_histGroupKey','_histEntries','_rebaseRecordArray','_statePlainObject','_stateValEq','_rebaseObjectFields','_rebaseStateOnRemote','_repairLegacyMergeDupes']
  .map(n=>fn(idx,'function '+n+'(')).join('\n');
const IC=vm.createContext({console,Map,Set,JSON,sortHist:a=>a.sort((x,y)=>String(x.date||'').localeCompare(String(y.date||''))||((x.ts||0)-(y.ts||0)))});
vm.runInContext(idxFns,IC);
const mkState=hist=>({activeTab:'inf',inf:{sessions:[{id:'i1',hist}]},vr:{sessions:[]},ma:{sessions:[]},ivs:{sessions:[]},dca:{sessions:[]},asap:{sessions:[]},plan:{sessions:[]}});
const r1={ts:1,date:'2026-09-01',kind:'1회매수',price:10,qty:1};
const r2={ts:2,date:'2026-09-02',kind:'쿼터매도',price:11,qty:1};
ok('운영 3-way rebase: 다른 탭 추가 + 현재 탭 추가 모두 보존',(()=>{
  const base=mkState([r1]),local=mkState([r1,{ts:3,date:'2026-09-03',kind:'1회매수',price:9,qty:1}]);
  const remote=mkState([r1,r2]),m=IC._rebaseStateOnRemote(base,local,remote);
  return JSON.stringify(m.inf.sessions[0].hist.map(x=>x.ts).sort())===JSON.stringify([1,2,3]);
})());
ok('운영 3-way rebase: 현재 탭 명시적 삭제는 stale DB 행 때문에 부활하지 않음',(()=>{
  const base=mkState([r1,r2]),local=mkState([r1]);
  const remote=mkState([r1,r2,{ts:4,date:'2026-09-04',kind:'1회매수',price:8,qty:1}]);
  const m=IC._rebaseStateOnRemote(base,local,remote);
  return JSON.stringify(m.inf.sessions[0].hist.map(x=>x.ts).sort())===JSON.stringify([1,4]);
})());

const legacyA={date:'2026-08-03',kind:'1회매수',price:10,qty:2};
const legacyB={qty:2,price:10,kind:'1회매수',date:'2026-08-03'};
ok('v3.108.1 legacy 중복 복구는 frozen legacy 기준 초과행만 제거',(()=>{
  const base=mkState([legacyA]),cur=mkState([legacyA,legacyB,{ts:9,date:'2026-10-03',kind:'1회매수',price:12,qty:1}]);
  const n=IC._repairLegacyMergeDupes(cur,base),h=cur.inf.sessions[0].hist;
  return n===1&&h.length===2&&h.filter(x=>!x.ts).length===1&&h.some(x=>x.ts===9);
})());

ok('쿼터매도 수량은 보유÷4 내림 규칙',
  /const qSell=Math\.floor\(c\.qty\/4\)/.test(fn(idx,'function infSuggest(kind)'))
  && /'쿼터매도':\s*\{price:close, qty:Math\.min\(qSell,c\.qty\)\}/.test(fn(idx,'function infSuggest(kind)')));
ok('쿼터매도 입력 화면에 계산 수량을 명시',
  idx.includes('보유 ${nfix(_c0.qty||0,0)}주 → 쿼터매도 ${_q}주 (보유÷4 내림)'));
ok('무매 사이클 종료선은 cycleEnd 판정 결과로 렌더',
  /h\.cycleEnd\?/.test(fn(idx,'function renderInfHist()'))
  && /imCycleEnds/.test(fn(idx,'function computeInf()')));

/* ── 5년 자산플랜 ── */
ok('5년플랜 fiveYearPlanV2 transaction 저장',
  /runTransaction/.test(fn(plan,'async function cloudSave()'))
  && /fiveYearPlanV2:candidate/.test(fn(plan,'async function cloudSave()'))
  && /fiveYearPlanV2Rev:nr/.test(fn(plan,'async function cloudSave()')));
ok('5년플랜 동시수정은 DB base 기준 3-way rebase',
  /candidate=planRebaseFiveYear\(planDbState,candidate,remote\)/.test(fn(plan,'async function cloudSave()'))
  && /candidate=planRebaseOperating\(planStateDbBase,candidate,remote\)/.test(fn(plan,'async function saveOperatingState()')));
ok('현금 기록 삭제는 DB 결과를 기다리고 실패 시 롤백',
  /const ok=await cloudSave\(\)/.test(fn(plan,'async function alphaDeleteEvent(id)'))
  && /alphaLedger=before/.test(fn(plan,'async function alphaDeleteEvent(id)')));
ok('현금 기록 추가도 DB 결과를 기다리고 실패 시 롤백',
  /const ok=await cloudSave\(\)/.test(fn(plan,'async function alphaAddCashEvent()'))
  && /alphaLedger=before/.test(fn(plan,'async function alphaAddCashEvent()')));
ok('5년플랜 cloudLoad는 Firebase 현재 원장을 직접 적용',
  /apply\(cloneObj\(v\)\)/.test(fn(plan,'async function cloudLoad(user)'))
  && !/planRecoveryRead|planRecoveryScore/.test(fn(plan,'async function cloudLoad(user)')));
ok('5년플랜 2026-10-03 오전 legacy 값은 1회만 Firebase 정본으로 이관',
  /PLAN_LEGACY_RESTORE_MARK/.test(plan)
  && /restoreMorningPlanFromLegacy\(user\)/.test(fn(plan,'async function cloudLoad(user)'))
  && /fiveYearPlanV2=cloneObj\(legacyFive\)/.test(fn(plan,'function planLegacyRestorePatch('))
  && /op\.plan=cloneObj\(legacyState\.plan\)/.test(fn(plan,'function planLegacyRestorePatch(')));
ok('5년플랜 legacy 복구는 브라우저에 다시 쓰지 않고 성공 후 옛 키 삭제',
  !/setItem\s*\(/.test(fn(plan,'async function restoreMorningPlanFromLegacy(user)'))
  && /planClearLegacyKeys\(store,user\)/.test(fn(plan,'async function restoreMorningPlanFromLegacy(user)'))
  && /JKAccess\.isAdminEmail\(user\.email\)/.test(fn(plan,'async function restoreMorningPlanFromLegacy(user)')));
ok('5년플랜 복구 보호모드·브라우저 메모리 백업 제거',
  !/planRecovery|planManualBackup|planForceLocalSave|복구 보호모드/.test(plan));
ok('5년플랜 체결 입력·수정은 DB 실패 시 화면 원복',
  /const ok=await cloudSave\(\)/.test(fn(plan,'async function alphaSaveFills()'))
  && /alphaLedger=before/.test(fn(plan,'async function alphaSaveFills()'))
  && /const ok=await cloudSave\(\)/.test(fn(plan,'async function alphaSaveEdit()'))
  && /alphaLedger=before/.test(fn(plan,'async function alphaSaveEdit()')));

const pFns=['planStableJson','planRecEntries','planRebaseRecords','planRebaseFiveYear']
  .map(n=>fn(plan,'function '+n+'(')).join('\n');
const PC=vm.createContext({console,Map,JSON,cloneObj:x=>JSON.parse(JSON.stringify(x))});
vm.runInContext(pFns,PC);
const pbase={alphaLedger:{base:{date:'2026-09-01',cash:100},events:[
  {id:'cash-old',type:'cash',date:'2026-09-02',kind:'dep',amount:1000},
  {id:'e1',type:'trade',date:'2026-09-03',symbol:'SGOV',side:'buy',qty:1,price:100}
]},sleeveSessions:[]};
ok('5년플랜: 삭제한 현금투입은 reload/rebase 후 다시 생기지 않음',(()=>{
  const local=JSON.parse(JSON.stringify(pbase));local.alphaLedger.events=local.alphaLedger.events.filter(x=>x.id!=='cash-old');
  const remote=JSON.parse(JSON.stringify(pbase));remote.alphaLedger.events.push({id:'cash-new',type:'cash',date:'2026-09-04',kind:'div',amount:2});
  const m=PC.planRebaseFiveYear(pbase,local,remote),ids=m.alphaLedger.events.map(x=>x.id).sort();
  return JSON.stringify(ids)===JSON.stringify(['cash-new','e1'].sort());
})());

/* ── 단타 사용자 데이터 ── */
ok('단타 pos/log/top2는 Firebase transaction + 3-way rebase',
  /runTransaction/.test(fn(scal,'function cloudSave()'))
  && /scalpRebase\(base\.pos,candidate\.pos,remote\.pos/.test(fn(scal,'function cloudSave()'))
  && /scalpRebase\(base\.log,candidate\.log,remote\.log/.test(fn(scal,'function cloudSave()'))
  && /scalpRebase\(base\.top2,candidate\.top2,remote\.top2/.test(fn(scal,'function cloudSave()')));
ok('단타 KIS 감사이력은 DB remote+candidate append union',
  /scalpMergeAppend\(remote\.kis\|\|\[\],candidate\.kis,'kis'\)/.test(fn(scal,'function cloudSave()')));
ok('단타 분봉 아카이브는 날짜별 Firestore 하위문서',
  /'scalpArchive',d/.test(fn(scal,'async function saveArch()'))
  && /collection\(window\.fb\.db,'users',me\.uid,'scalpArchive'\)/.test(fn(scal,'async function loadArch()')));
ok('단타 수동 거래 추가·삭제는 Firebase 저장 실패 시 롤백',
  /await saveL\(\)/.test(fn(scal,'async function addTrade()'))
  && /LOG=before/.test(fn(scal,'async function addTrade()'))
  && /await saveL\(\)/.test(fn(scal,'async function delTrade(i)'))
  && /LOG=before/.test(fn(scal,'async function delTrade(i)')));
ok('단타 소유자 권한 확인은 무한대기하지 않음',
  /AbortController/.test(fn(scal,'async function checkOwner(user)'))
  && /8000/.test(fn(scal,'async function checkOwner(user)')));

const sFns=['scalpClone','scalpStable','scalpEntries','scalpRebase'].map(n=>fn(scal,'function '+n+'(')).join('\n');
const SC=vm.createContext({console,Map,JSON});
vm.runInContext(sFns,SC);
ok('단타 3-way rebase도 명시적 삭제 미부활 + 원격 신규 보존',(()=>{
  const a={ts:1,code:'A'},b={ts:2,code:'B'},c={ts:3,code:'C'};
  const m=SC.scalpRebase([a,b],[a],[a,b,c],'pos');
  return m.length===2&&m.some(x=>x.ts===1)&&m.some(x=>x.ts===3)&&!m.some(x=>x.ts===2);
})());

/* ── 공모주 사용자 기록 ── */
ok('IPO 기록은 Firebase transaction + delete-safe 3-way rebase',
  /runTransaction/.test(fn(ipo,'async function save()'))
  && /ipoRebaseRecords\(base,candidate,remote\)/.test(fn(ipo,'async function save()')));
const iFns=['ipoClone','ipoRecKey','ipoRebaseRecords'].map(n=>fn(ipo,'function '+n+'(')).join('\n');
const IP=vm.createContext({console,Map,JSON});
vm.runInContext(iFns,IP);
ok('IPO 명시적 삭제는 stale remote 때문에 부활하지 않음',(()=>{
  const a={id:'a',name:'A'},b={id:'b',name:'B'},c={id:'c',name:'C'};
  const m=IP.ipoRebaseRecords([a,b],[a],[a,b,c]);
  return m.map(x=>x.id).sort().join(',')==='a,c';
})());

/* ── 무매 기록하기 (2026-10-20 사용자: '기록하기 누르면 한참 가만히 있다가 저장') ──
   DB 확인까지 기다리는 동안 버튼이 그대로라 또 누르게 되고, 그러면 같은 거래가 두 번 들어갔다.
   실패하면 화면 장부에 남긴 채 '다시 기록'을 안내해 다시 누르면 두 건이 됐다. 실제 함수를 값으로 굴린다. */
const sheetCase=()=>{
  const el={sh_save:{textContent:'기록하기',disabled:false},sh_date:{value:'2026-10-20'},sh_price:{value:'97.55'},sh_qty:{value:'6'},sh_tman_on:{checked:false}};
  const log=[],hist=[];let resolve=null,pushes=0;
  const ctx=vm.createContext({console:{...console,error:()=>log.push('logged')},JSON,Date,Math,String,
    $:id=>el[id],shKind:'1회매수',curStrat:()=>({hist}),isCx:()=>false,unComma:v=>String(v).replace(/,/g,''),
    sortHist:a=>a,saveLocal:()=>{},alert:()=>log.push('alert'),refreshInf:()=>log.push('refresh'),closeSheet:()=>log.push('close'),
    requestAnimationFrame:f=>{log.push('frame');f();},setTimeout:f=>{f();return 0;},setInterval:()=>1,clearInterval:()=>{},
    pushRemoteNow:()=>{pushes++;return new Promise(r=>{resolve=r;});},computeInf:()=>({bal:1e9}),wn:String,confirm:()=>true});
  vm.runInContext('let _shSaving=false;\n'+fn(idx,'function sheetBusy(id)')+'\n'+fn(idx,'async function sheetSaveInf()'),ctx);
  return {ctx,el,log,hist,done:v=>resolve(v),pushes:()=>pushes};
};
(async()=>{
  { const t=sheetCase(), a=t.ctx.sheetSaveInf(), b=t.ctx.sheetSaveInf();
    ok('무매 기록하기: 누르자마자 저장 중 표시 · 저장을 기다리는 중 또 눌러도 한 건 · DB 요청도 한 번',
      t.hist.length===1 && t.pushes()===1 && t.el.sh_save.disabled===true && /저장 중/.test(t.el.sh_save.textContent));
    t.done(true); await a; await b;
    ok('무매 기록하기: DB 성공이면 창부터 닫고 그다음 화면을 다시 그린다 · 버튼은 원래대로',
      JSON.stringify(t.log)==='["close","frame","refresh"]' && t.el.sh_save.disabled===false && t.el.sh_save.textContent==='기록하기'); }
  { const t=sheetCase(), a=t.ctx.sheetSaveInf(); t.done(false); await a;
    const failed=t.hist.length===0 && t.log.includes('alert') && !t.log.includes('close') && t.el.sh_save.disabled===false;
    const b=t.ctx.sheetSaveInf(); t.done(true); await b;
    ok('무매 기록하기: DB 저장 실패면 화면 장부에서도 빼고 창은 남긴다 — 다시 누르면 정확히 한 건',failed && t.hist.length===1 && t.pushes()===2); }
  { const t=sheetCase(); t.ctx.pushRemoteNow=()=>Promise.reject(new Error('network'));
    await t.ctx.sheetSaveInf();
    ok('무매 기록하기: 저장 중 오류도 실패와 같다 — 기록 빼고 버튼 풀림',t.hist.length===0 && t.el.sh_save.disabled===false && t.log.includes('alert')); }
  /* 운영 저장은 원장 전체를 문자열로 한 번만 바꾸고 거기서 꺼내 쓴다(2026-10-20 — 수 MB 라 왕복 복사가 저장 시간을 늘렸다).
     저장되는 원장 · 다음 비교 기준(stateDbBase) · 마지막 저장본(lastPushedJSON)이 예전과 같은 값이어야 한다. */
  { const names=['_historySignature','_stateHistoryMap','validState','dbPlanWrite','fsDocParts','fsDocBytes','fsValueBytes','utf8Len','_staleStateGuard'];
    const docs=new Map(),C=vm.createContext({console,JSON,Date,Math,Map,Set,Object,Array,String,
      setSync:()=>{},dbSizeReport:()=>{},dbErrKind:()=>'other',dbErrBytes:()=>0,ensureBoxes:()=>{},refreshAll:()=>{},
      window:{fb:{db:{},doc:(db,...p)=>({path:p.join('/')}),deleteField:()=>null,
        runTransaction:async(db,f)=>{const w=[];const out=await f({get:async r=>({exists:()=>docs.has(r.path),data:()=>JSON.parse(JSON.stringify(docs.get(r.path)))}),set:(r,d)=>w.push([r.path,d])});
          for(const [k,d] of w)docs.set(k,JSON.parse(JSON.stringify({...(docs.get(k)||{}),...d})));return out;}}}});
    vm.runInContext(idxFns+'\n'+names.map(n=>fn(idx,'function '+n+'(')).join('\n')+'\n'+fn(idx,'async function _commitStateRemote(where)')
      +"\nconst DB_DOC_LIMIT=1048576, DB_DOC_WARN=Math.round(DB_DOC_LIMIT*0.8), DB_LEGACY_KEYS=['state','updated','stateRev'];"
      +"\nvar S="+JSON.stringify({activeTab:'inf',_updated:5,inf:{active:'i1',sessions:[{id:'i1',hist:[r1,r2]}]},vr:{sessions:[{id:'v',hist:[]}]},ma:{sessions:[]},ivs:{sessions:[]},dca:{sessions:[]},asap:{sessions:[]},plan:{sessions:[]}})+";"
      +"\nvar curUid='u1',stateCloudHydrated=true,stateCloudRev=0,stateCloudHistorySig='',stateDbBase=null,stateCloudPending=true,lastPushedJSON='',_dbPlan=null,_dbForceArchive=false,_dbArchiveBlocked=false,_dbArchivedNote='';",C);
    const before=JSON.stringify(C.S),t0=Date.now(),okSave=await C._commitStateRemote('t');
    const stored=docs.get('users/u1').stateV2;
    ok('운영 저장: 원장 문자열을 한 번만 만들어도 저장 원장 = 기준본 = 마지막 저장본 · 화면 원장은 그대로 · 저장 시각 갱신',
      okSave===true && C.lastPushedJSON===JSON.stringify(stored) && JSON.stringify(C.stateDbBase)===JSON.stringify(stored)
      && JSON.stringify(C.S)===before && stored._updated>=t0 && JSON.stringify({...stored,_updated:5})===before && docs.get('users/u1').stateV2Rev===1); }
  console.log('ALL HISTORY PRESERVATION CHECKS PASS');
})().catch(e=>{console.error(e);process.exit(1);});
