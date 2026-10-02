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
ok('운영 cloud read 실패 중 remote write 잠금',
  /stateCloudHydrated=false/.test(fn(idx,'async function pullRemote()'))
  && /클라우드 원장을 확인하지 못해 안전을 위해 클라우드 저장을 잠갔습니다/.test(idx));
ok('구버전 client가 revision 없이 쓴 변경도 history fingerprint로 감지',
  /stateCloudHistorySig/.test(idx)
  && /remoteChanged=rev!==stateCloudRev\|\|\(stateCloudHistorySig!==''&&remoteSig!==stateCloudHistorySig\)/.test(fn(idx,'async function _commitStateRemote(where)')));

const idxFns=[
  '_histKeyPart','_stateHistoryMap','_historyPreserves','_historyRelation','_historyCount','_historySignature'
].map(n=>fn(idx,'function '+n+'(')).join('\n');
const IC=vm.createContext({console,Map,JSON});
vm.runInContext(idxFns,IC);
const mkState=hist=>({inf:{sessions:[{id:'i1',hist}]},vr:{sessions:[{id:'v1',hist:[]}]},plan:{sessions:[]}});
const r1={ts:1,date:'2026-09-01',kind:'buy',price:10,qty:1};
const r2={ts:2,date:'2026-09-02',kind:'sell',price:11,qty:1};
const remote=mkState([r1,r2]), empty=mkState([]), plus=mkState([r1,r2,{ts:3,date:'2026-09-03',kind:'buy',price:9,qty:1}]);
const edited=mkState([{...r1,price:12},r2]);
ok('빈 local은 remote 거래이력을 보존하지 못한다고 판정',IC._historyPreserves(empty,remote)===false);
ok('remote 전체 + 새 거래 local은 remote를 보존한다고 판정',IC._historyPreserves(plus,remote)===true);
ok('같은 ts 거래내용이 바뀐 충돌은 양쪽 자동덮어쓰기 금지',
  IC._historyPreserves(edited,remote)===false&&IC._historyPreserves(remote,edited)===false);

/* 2. 모의 기록 재생 — 빈 중간 장부를 cloud에 올리지 않는다 */
const all=fn(idx,'async function applyAllSimStart()');
const pSave=all.indexOf('saveLocal();'),pReplay=all.indexOf('await openPaper()'),pPush=all.indexOf('await pushRemoteNow()');
ok('모의 전체적용은 local blank -> replay -> cloud 순서',pSave>=0&&pReplay>pSave&&pPush>pReplay);
ok('replay 전 cloud push 없음',all.slice(0,pReplay).indexOf('pushRemoteNow')<0);
const repair=fn(idx,'async function repairPaperStart');
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
ok('명시적 삭제·초기화 전에 local recovery snapshot',plan.includes('function planManualBackup(reason)')
  && fn(plan,'function delLedgerTrade(id)').includes("planManualBackup('sleeve-trade-delete:")
  && fn(plan,'function resetLedger()').includes("planManualBackup('sleeve-ledger-reset:")
  && fn(plan,'async function alphaDeleteEvent(id)').includes("planManualBackup('alpha-event-delete:")
  && fn(plan,'async function alphaResetLedger()').includes("planManualBackup('alpha-ledger-reset')"));
ok('QLD/SGOV 한 건 삭제도 confirm 필수',fn(plan,'function delLedgerTrade(id)').includes('if(!confirm('));

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
