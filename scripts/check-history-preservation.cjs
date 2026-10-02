const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const idx=read('index.html'),plan=read('plan.html'),scal=read('scalping.html'),ipo=read('ipo.html'),admin=read('admin.html'),autotrade=read('functions/api/autotrade.js');

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
      if(inS&&ch==="'")inS=false;
      else if(inD&&ch==='"')inD=false;
      else if(inT&&ch==='\`')inT=false;
      continue;
    }
    if(ch==='/'&&nx==='/'){line=true;i++;continue;}
    if(ch==='/'&&nx==='*'){block=true;i++;continue;}
    if(ch==="'"){inS=true;continue;}
    if(ch==='"'){inD=true;continue;}
    if(ch==='\`'){inT=true;continue;}
    if(ch==='{')depth++;
    else if(ch==='}'&&!--depth)return src.slice(start,i+1);
  }
  throw Error('unterminated '+marker);
}
function ok(name,cond){assert.ok(cond,name);console.log('PASS '+name);}

/* 1. 운영 메인 — 새 기기/다중 탭/구버전 클라이언트 */
ok('운영 Firebase 쓰기는 transaction + protected stateV2Rev', idx.includes('runTransaction')&&idx.includes('stateV2Rev:nr')&&idx.includes('stateV2:candidate'));
ok('로그인 사용자는 cloud hydrate 전 fresh state를 local 최신값으로 만들지 않음',
  /if\(!hadValidLocal\)\{[\s\S]*if\(!curUid\)saveLocal\(\);/.test(fn(idx,'function load()')));
ok('운영 cloud read 실패는 원격 덮어쓰기 없이 pending으로 두고 방해 팝업을 띄우지 않음',
  /stateCloudHydrated=false/.test(fn(idx,'async function pullRemote()'))
  && /stateCloudPending=true/.test(fn(idx,'async function pullRemote()'))
  && !idx.includes('⚠️ 거래이력 보호:')
  && !idx.includes('클라우드 저장을 잠갔습니다'));
ok('운영 원장은 DB revision 충돌 시 stale 이력을 자동 병합하지 않고 저장을 중단',
  /stateCloudHistorySig/.test(idx)
  && /remoteChanged=rev!==stateCloudRev\|\|\(stateCloudHistorySig!==''&&remoteSig!==stateCloudHistorySig\)/.test(fn(idx,'async function _commitStateRemote(where)'))
  && /REMOTE_HISTORY_CONFLICT/.test(fn(idx,'async function _commitStateRemote(where)'))
  && !/candidate=_mergeHistorySafeState\(candidate,remote\)/.test(fn(idx,'async function _commitStateRemote(where)')));

const idxFns=[
  '_histKeyPart','_histStableJson','_histSemanticKey','_histGroupKey',
  '_stateHistoryMap','_historyPreserves','_historyRelation','_historyCount','_historySignature',
  '_mergeRecordArrays','_repairLegacyMergeDupes','_mergeHistorySafeState'
].map(n=>fn(idx,'function '+n+'(')).join('\n');
const IC=vm.createContext({console,Map,Set,JSON,sortHist:a=>a.sort((x,y)=>String(x.date||'').localeCompare(String(y.date||''))||((x.ts||0)-(y.ts||0)))});
vm.runInContext(idxFns,IC);
const mkState=hist=>({inf:{sessions:[{id:'i1',hist}]},vr:{sessions:[{id:'v1',hist:[]}]},plan:{sessions:[]}});
const r1={ts:1,date:'2026-09-01',kind:'buy',price:10,qty:1};
const r2={ts:2,date:'2026-09-02',kind:'sell',price:11,qty:1};
const remote=mkState([r1,r2]), empty=mkState([]), plus=mkState([r1,r2,{ts:3,date:'2026-09-03',kind:'buy',price:9,qty:1}]);
const edited=mkState([{...r1,price:12},r2]);
ok('빈 local은 remote 거래이력을 보존하지 못한다고 판정',IC._historyPreserves(empty,remote)===false);
ok('remote 전체 + 새 거래 local은 remote를 보존한다고 판정',IC._historyPreserves(plus,remote)===true);
ok('같은 ts 거래내용이 바뀐 상태도 자동병합에서 현재 입력값을 유지',(()=>{
  const m=IC._mergeHistorySafeState(edited,remote),h=m.inf.sessions[0].hist;
  return h.length===2&&h.find(x=>x.ts===1).price===12&&h.some(x=>x.ts===2);
})());
/* v3.108.1 회귀: ts/id가 없는 예전 거래는 Firestore 왕복 때 객체 필드 순서가 달라지면
   JSON.stringify 결과가 달라져 같은 매수/매도를 두 번 합쳤다. 그 중복이 보유수량·T·실현손익을
   틀어 무매 cycleEnd/분석값까지 깨뜨렸다. canonical JSON으로 같은 행을 알아봐야 한다. */
const legacyA={date:'2026-08-03',kind:'1회매수',price:10,qty:2};
const legacyB={qty:2,price:10,kind:'1회매수',date:'2026-08-03'};
ok('legacy 거래는 객체 필드 순서가 달라도 같은 이력으로 판정',(()=>{
  const rel=IC._historyRelation(mkState([legacyA]),mkState([legacyB]));
  return rel.equal===true;
})());
ok('legacy 같은 거래를 cloud merge 해도 한 줄만 남음',(()=>{
  const m=IC._mergeHistorySafeState(mkState([legacyA]),mkState([legacyB]));
  return m.inf.sessions[0].hist.length===1;
})());
ok('현재 원장에 없는 identity-less 옛 행을 자동으로 되살리지 않음',(()=>{
  const stale={date:'2026-07-31',kind:'절반매수',price:8,qty:1};
  const m=IC._mergeHistorySafeState(mkState([r1]),mkState([r1,stale]));
  return m.inf.sessions[0].hist.length===1&&m.inf.sessions[0].hist[0].ts===1;
})());
ok('v3.108.1이 이미 만든 legacy 동일행 중복도 frozen legacy 기준으로 복구',(()=>{
  const base=mkState([legacyA]);
  const dup=mkState([legacyA,legacyB,{ts:99,date:'2026-10-03',kind:'1회매수',price:12,qty:1}]);
  const n=IC._repairLegacyMergeDupes(dup,base),h=dup.inf.sessions[0].hist;
  return n===1&&h.length===2&&h.filter(x=>!x.ts).length===1&&h.some(x=>x.ts===99);
})());
const splitLocal=mkState([r1,{ts:3,date:'2026-09-03',kind:'buy',price:9,qty:1}]);
const splitRemote=mkState([r1,r2,{ts:4,date:'2026-09-04',kind:'sell',price:12,qty:1}]);
ok('서로 다른 탭에서 추가한 거래는 자동병합 후 하나도 빠지지 않음',(()=>{
  const m=IC._mergeHistorySafeState(splitLocal,splitRemote),ts=m.inf.sessions[0].hist.map(x=>x.ts).sort();
  return JSON.stringify(ts)===JSON.stringify([1,2,3,4]);
})());
ok('일반 save는 거래 입력 즉시 Firebase 저장 promise를 반환',
  fn(idx,'function save()').includes('return pushRemoteNow()')
  && fn(idx,'async function pushRemote()').includes('pushRemoteNow()'));
ok('브라우저 운영 캐시는 거래이력을 제거하고 저장',
  /function _stateCacheCopy\(st\)/.test(idx)
  && /b\.sessions\.forEach\(ss=>\{ if\(ss\)ss\.hist=\[\]; \}\)/.test(idx)
  && /JSON\.stringify\(_stateCacheCopy\(S\)\)/.test(fn(idx,'function saveLocal()')));
ok('로그인 후 새로고침은 local 거래이력이 아니라 Firebase remote를 그대로 정본으로 사용',
  /S=JSON\.parse\(JSON\.stringify\(remote\)\)/.test(fn(idx,'async function pullRemote()'))
  && !/_historyRelation\(local,remote\)/.test(fn(idx,'async function pullRemote()')));
ok('로그인 사용자는 storage 이벤트로 운영 원장을 갈아끼우지 않음',
  /if\(curUid\)return/.test(idx.slice(idx.indexOf("window.addEventListener('storage'"),idx.indexOf('/* ── Firebase Firestore',idx.indexOf("window.addEventListener('storage'")))));

/* 2. 모의 기록 재생 — 빈 중간 장부를 cloud에 올리지 않는다 */
const all=fn(idx,'async function applyAllSimStart()');
const pSave=all.indexOf('saveLocal();'),pReplay=all.indexOf('await openPaper()'),pPush=all.indexOf('await pushRemoteNow()');
ok('모의 전체적용은 local blank -> replay -> cloud 순서',pSave>=0&&pReplay>pSave&&pPush>pReplay);
ok('replay 전 cloud push 없음',all.slice(0,pReplay).indexOf('pushRemoteNow')<0);
const repair=fn(idx,'async function paperRepairLegacyStarts');
const resetAt=repair.indexOf('x.hist=[]');
ok('자동 시작일 복구도 hist 비운 뒤 즉시 cloud push 안 함',
  resetAt>=0&&repair.slice(resetAt).indexOf('await pushRemoteNow()')<0);

/* 3. 자산플랜 현재원장 + 운영세션 + QLD/SGOV */
ok('자산플랜 fiveYearPlan 쓰기는 transaction + protected fiveYearPlanV2Rev',
  plan.includes('runTransaction')&&plan.includes('fiveYearPlanV2Rev:nr')&&plan.includes('fiveYearPlanV2:candidate'));
ok('자산플랜 운영 state도 protected stateV2 transaction',
  /stateV2Rev:nr/.test(fn(plan,'async function saveOperatingState()'))
  && /stateV2:candidate/.test(fn(plan,'async function saveOperatingState()')));
ok('자산플랜 cloud 확인 전 fiveYearPlan remote write 금지',
  /if\(!planCloudHydrated\)/.test(fn(plan,'async function cloudSave()')));
ok('명시적 삭제·초기화 백업은 브라우저 영구저장이 아니라 메모리만 사용',
  /let planManualBackupMemory=null/.test(plan)
  && !fn(plan,'function planManualBackup(reason)').includes('localStorage.setItem')
  && fn(plan,'async function delLedgerTrade(id)').includes("planManualBackup('sleeve-trade-delete:")
  && fn(plan,'async function resetLedger()').includes("planManualBackup('sleeve-ledger-reset:")
  && fn(plan,'async function alphaDeleteEvent(id)').includes("planManualBackup('alpha-event-delete:")
  && fn(plan,'async function alphaResetLedger()').includes("planManualBackup('alpha-ledger-reset')"));
ok('QLD/SGOV 한 건 삭제도 confirm 필수',fn(plan,'async function delLedgerTrade(id)').includes('if(!confirm('));
ok('5년플랜 브라우저 캐시는 alpha/sleeve 거래이력을 제거',
  /function planSettingsCacheCopy\(o\)/.test(plan)
  && /x\.alphaLedger&&Array\.isArray\(x\.alphaLedger\.events\)\)x\.alphaLedger\.events=\[\]/.test(plan)
  && /x\.sleeveLedger&&Array\.isArray\(x\.sleeveLedger\.trades\)\)x\.sleeveLedger\.trades=\[\]/.test(plan));
ok('5년플랜 새로고침은 Firebase 현재 원장을 직접 적용하고 과거 로컬 백업을 자동선택하지 않음',
  /apply\(cloneObj\(v\)\)/.test(fn(plan,'async function cloudLoad(user)'))
  && !/planRecoveryScore/.test(fn(plan,'async function cloudLoad(user)'))
  && !/_cloud_previous|_cloud_recovery|_manual_backup/.test(fn(plan,'async function cloudLoad(user)')));
ok('현금/거래 삭제는 DB 응답을 기다리고 실패 시 롤백',
  /const ok=await cloudSave\(\)/.test(fn(plan,'async function alphaDeleteEvent(id)'))
  && /alphaLedger=before/.test(fn(plan,'async function alphaDeleteEvent(id)'))
  && /const ok=await cloudSave\(\)/.test(fn(plan,'async function delLedgerTrade(id)')));
ok('쿼터매도 입력 화면이 보유÷4 내림 수량을 명시',
  /보유 \$\{nfix\(_c0\.qty\|\|0,0\)\}주 → 쿼터매도 \$\{_q\}주 \(보유÷4 내림\)/.test(idx));

const pFns=[
  'planOpHistoryMap','planOpPreserves','planMapSig','planOpHistorySig',
  'planHistoryMap','planHistoryPreserves','planHistoryRelation','planHistorySig'
].map(n=>fn(plan,'function '+n+'(')).join('\n');
const PC=vm.createContext({console,Map,JSON});
vm.runInContext(pFns,PC);
const pr={alphaLedger:{base:{date:'2026-09-01',tecl:1,tqqq:0,sgov:0,cash:100},events:[{id:'e1',type:'trade',date:'2026-09-02',symbol:'TECL',side:'buy',qty:1,price:10}]},
  sleeveSessions:[{id:'sl1',ledger:{startQLD:0,startSGOV:1,startCash:100,trades:[{id:'t1',date:'2026-09-03',symbol:'SGOV',side:'buy',qty:1,price:100}]}}]};
const pe={alphaLedger:{base:{date:'2026-09-01',tecl:1,tqqq:0,sgov:0,cash:100},events:[]},sleeveSessions:[]};
const pp=JSON.parse(JSON.stringify(pr));pp.alphaLedger.events.push({id:'e2',type:'cash',date:'2026-09-04',kind:'div',amount:1});
ok('fiveYearPlan 빈/누락 원장은 기존 alpha+sleeve 이력을 보존하지 못함',PC.planHistoryPreserves(pe,pr)===false);
ok('기존 원장 + 새 이벤트는 기존 이력을 전부 보존',PC.planHistoryPreserves(pp,pr)===true);

const opRemote={inf:{sessions:[{id:'s',hist:[r1,r2]}]},vr:{sessions:[]},plan:{sessions:[{id:'p',ledger:{base:{cash:100},events:[{id:'p1',type:'trade'}]}}]}};
const opLocal=JSON.parse(JSON.stringify(opRemote));opLocal.inf.sessions[0].hist.pop();
ok('plan 운영 state에서도 기록 한 건 빠진 후보는 remote 보존 실패',PC.planOpPreserves(opLocal,opRemote)===false);

/* 4. 단타 KIS 주문 감사이력 — append-only */
const scSave=fn(scal,'function cloudSave()');
ok('KIS cloud save가 transaction에서 remote+local KLOG 합집합',scSave.includes('runTransaction')
  && scSave.includes('old&&Array.isArray(old.kis)')&&scSave.includes('...KLOG')&&scSave.includes('const kisBy=new Map()'));
ok('KIS 삭제/전체삭제 UI는 원본을 지우지 않음',
  !fn(scal,'function delKlog(i)').includes('splice(')&&!fn(scal,'function clearKlog()').includes('KLOG=[]'));
ok('단타 로그인은 local+cloud 이력 merge 후 화면 초기화',/loadAll\(\);await cloudLoad\(\);/.test(scal));

/* 5. 구버전 클라이언트 격리 — canonical field는 V2만 */
ok('운영 앱은 legacy state를 fallback으로만 읽고 stateV2에만 쓴다',
  /validState\(d\.stateV2\)\?d\.stateV2:d\.state/.test(idx)
  && /tx\.set\(ref,\{stateV2:candidate/.test(idx)
  && !/tx\.set\(ref,\{state:candidate/.test(idx));
ok('자산플랜도 stateV2/fiveYearPlanV2에만 쓴다',
  /stateV2:candidate/.test(plan)&&/fiveYearPlanV2:candidate/.test(plan)
  && !/tx\.set\(ref,\{state:candidate/.test(plan)
  && !/tx\.set\(ref,\{fiveYearPlan:candidate/.test(plan));
ok('관리자 기존세션 적용도 protected stateV2만 갱신',
  /stateV2:state/.test(admin)&&/stateV2Rev:nr/.test(admin)&&!/state,updated:now,stateRev:nr/.test(admin));
ok('서버 자동주문은 stateV2 정본을 우선 읽음',/doc\.stateV2 \|\| doc\.state/.test(autotrade));

/* 6. 공모주 기록 — remote replace 금지 */
ok('IPO 기록은 transaction에서 remote+local union',fn(ipo,'function save()').includes('runTransaction')
  && fn(ipo,'function save()').includes('ipoMergeRecords(ipoNorm(old).records,local)'));
ok('IPO remote load도 replace 대신 merge',fn(ipo,'window.ipoOnRemote=function(remote)').includes('ipoMergeRecords(n.records,IPO.records)'));

console.log('ALL HISTORY PRESERVATION CHECKS PASS');
