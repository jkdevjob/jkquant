// Execute the page's real functions with deterministic UI/network fixtures.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'../plan.html'),'utf8');
function fnOf(src,marker){
  const start=src.indexOf(marker);assert(start>=0,marker);
  let i=src.indexOf('{',start),depth=0;
  for(;i<src.length;i++){if(src[i]==='{')depth++;if(src[i]==='}'&&!--depth)return src.slice(start,i+1);}
  throw Error(marker);
}
const fn=marker=>fnOf(html,marker);
function element(dataset={}){return {dataset,hidden:false,classList:{toggle(){}},setAttribute(k,v){this[k]=v;}};}
/* 탭마다 보이는 칸(화면 차례대로). 2026-11-11 사용자 "듀얼가드 분석에 리밸런싱 판단근거가 현재탭에 들어가야 할거 같은데"
   — 판단 근거(alphaEvidenceSection)는 현재 탭 3번(현재 계좌 다음). 연말 세금 점검 칸(alphaTaxSection)은 💰 포트폴리오로 옮겨 없다(2026-11-11). */
const VIEWS={current:['dgHero','alphaOrderSection','alphaAccountSection','alphaEvidenceSection'],analysis:['assetPaperPanel','alphaPerfSection','alphaMonthSection'],history:['alphaHistorySection'],explain:['alphaStrategySection']};
function viewCheck(src){
  const tabs=[...src.matchAll(/<button[^>]*data-asset-detail="([^"]+)"[^>]*>/g)].map(m=>Object.assign(element({assetDetail:m[1]}),{controls:((m[0].match(/aria-controls="([^"]*)"/)||[])[1]||'').split(/\s+/).filter(Boolean)}));
  const panels=[...src.matchAll(/<div[^>]*id="([^"]+)"[^>]*data-asset-view="([^"]+)"[^>]*>/g)].map(m=>Object.assign(element({assetView:m[2]}),{id:m[1],startHidden:/\shidden(?=[\s>])/.test(m[0])}));
  assert.deepEqual(tabs.map(x=>x.dataset.assetDetail),['current','analysis','history','explain']);
  // 처음 열 때(탭을 누르기 전)도 현재 탭 칸만 보인다 — 옮긴 칸에 hidden 이 남으면 첫 화면에서 빠진다
  assert.deepEqual(panels.filter(p=>!p.startHidden).map(p=>p.id),VIEWS.current,'첫 화면 = 현재 탭 칸');
  const c=vm.createContext({document:{querySelectorAll:s=>s==='[data-asset-detail]'?tabs:panels}});
  vm.runInContext(fnOf(src,'function setAssetDetail(name)'),c);
  for(const [name,ids] of Object.entries(VIEWS)){
    c.setAssetDetail(name);
    const shown=panels.filter(p=>!p.hidden).map(p=>p.id);
    assert.deepEqual(shown,ids,name+' 탭 칸');
    // 탭 단추 aria-controls = 그 탭 칸(머리 카드 dgHero 는 탭 줄 위라 뺀다)
    assert.deepEqual([...tabs.find(t=>t.dataset.assetDetail===name).controls].sort(),shown.filter(id=>id!=='dgHero').sort(),name+' aria-controls');
    assert.equal(tabs.filter(t=>t['aria-selected']==='true').length,1);
    assert.equal(tabs.find(t=>t.tabIndex===0).dataset.assetDetail,name);
  }
  c.setAssetDetail('invalid');assert.equal(tabs[0].tabIndex,0);
}
function divBlock(src,marker){   // marker 로 시작하는 <div …>…</div> 한 덩어리
  const a=src.indexOf(marker);assert(a>=0,marker);const re=/<div\b|<\/div>/g;re.lastIndex=a;let d=0,m;
  while((m=re.exec(src))){d+=m[0]==='<div'?1:-1;if(!d)return [a,re.lastIndex];}
  throw Error(marker);
}
function mutMoveBeforeAccount(src){   // 판단 근거를 현재 계좌 앞으로(차례만 틀림)
  const [a,b]=divBlock(src,'<div class="todaybox" id="alphaEvidenceSection"'),blk=src.slice(a,b),rest=src.slice(0,a)+src.slice(b);
  const at=rest.indexOf('<div class="card" id="alphaAccountSection"');assert(at>0);return rest.slice(0,at)+blk+'\n'+rest.slice(at);
}
async function main(){
  viewCheck(html);
  const MUT=[
    ['판단 근거가 분석 탭에 남음(옛 코드)',s=>s.replace('id="alphaEvidenceSection" data-asset-view="current">','id="alphaEvidenceSection" data-asset-view="analysis" hidden>')],
    ['판단 근거를 현재 탭으로 옮기며 hidden 을 남김',s=>s.replace('id="alphaEvidenceSection" data-asset-view="current">','id="alphaEvidenceSection" data-asset-view="current" hidden>')],
    ['판단 근거가 현재 계좌 앞(차례)',mutMoveBeforeAccount],
    ['현재 탭 aria-controls 옛 값(판단 근거 빠짐)',s=>s.replace('aria-controls="alphaOrderSection alphaAccountSection alphaEvidenceSection">현재','aria-controls="alphaOrderSection alphaAccountSection">현재')],
  ];
  let red=0;
  for(const [name,f] of MUT){const m=f(html);assert.notEqual(m,html,'변이 대상 없음: '+name);let caught=false;try{viewCheck(m);}catch(e){caught=true;}assert(caught,'변이가 안 잡힘: '+name);red++;}
  console.log('PASS analysis/history/explanation show only their sections · 판단 근거 = 현재 탭 · 변이 '+red+'/'+MUT.length+' red');

  const els={assetHistoryNote:element(),assetPaperResult:element()},classes=new Set();
  let selected={id:'paper',horizon:5,paper:true,simStart:'2025-01-02',settings:{startCapital:10000}},closed=0;
  let finish;
  const quote=new Promise(resolve=>{finish=resolve;});
  const p=vm.createContext({console,document:{body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},
    $:id=>els[id],activeAssetSession:()=>selected,setAssetDetail:()=>{},alphaCloseFillEditor:()=>closed++,alphaCloseEdit:()=>closed++,dgSheetClose:()=>closed++,
    applyAssetSettings:()=>{},alphaSyncInputs:()=>{},renderAlphaLedger:()=>{},renderAssetSessions:()=>{},render:()=>{},refreshAlphaFromCache:()=>{},
    refreshLive:async()=>{},cloneObj:x=>JSON.parse(JSON.stringify(x)),assetPaperStatsHtml:()=>'',assetRulesOf:()=>'base',planPanicIndexLoad:async()=>[null,null],   // 공포 모드 도우미(v3.129.0) — 없으면 재생이 ReferenceError 로 끝나 '늦게 끝난 재생' 경로를 못 본다
    fetchPlanQuote:()=>quote,
    window:{JKPlanSessionEngine:{replay:()=>({ledger:{base:{cash:12000},events:[]}})}},todayISO:()=> '2025-01-02'});
  vm.runInContext('let assetViewRevision=0,alphaLedger={base:{cash:999},events:[]},liveQuotes={};const assetPaperCache={};'+
    fn('function assetLedgerSeed(date,cap)')+fn('async function replayAssetPaperSession(x,applyView)')+fn('async function loadActiveAssetSessionView(refresh=true)'),p);
  const pending=p.loadActiveAssetSessionView(false);
  assert.equal(closed,3);   // 체결 칸 · 이력 수정 · 기록 창(2026-11-11)assert(classes.has('asset-paper-mode'));
  assert.equal(vm.runInContext('alphaLedger.base.cash',p),10000);
  selected={id:'live',horizon:10,paper:false,settings:{startCapital:5000},ledger:{base:{cash:5000},events:[]}};
  await p.loadActiveAssetSessionView(false);
  finish({settled:{date:'2025-01-03'},rows:[],dividends:[]});await pending;
  assert.equal(vm.runInContext('alphaLedger.base.cash',p),5000);
  assert(!classes.has('asset-paper-mode'));assert.equal(els.assetPaperResult.hidden,true);
  console.log('PASS delayed paper replay cannot replace selected live session; editors reset');

  const box={sessions:[{id:'a',name:'A',horizon:5},{id:'b',name:'B',horizon:5}],activeByHorizon:{5:'a'}};
  let loaded=0;
  const d=vm.createContext({assetPlanBox:()=>box,confirm:()=>true,cloneObj:x=>JSON.parse(JSON.stringify(x)),liveState:{plan:{sessions:box.sessions,activeByHorizon:box.activeByHorizon}},assetPaperCache:{},writeAssetSessionLocal:()=>{},saveOperatingState:async()=>true,loadActiveAssetSessionView:async()=>loaded++});
  vm.runInContext('var assetSwitchChain=Promise.resolve();'+fn('function assetSwitchIdle()')+fn('async function deleteAssetSession(id)'),d);   // 삭제도 앞 세션 전환이 끝난 뒤(2026-11-09)
  await d.deleteAssetSession('b');assert.equal(box.activeByHorizon[5],'a');assert.equal(loaded,1);
  await d.deleteAssetSession('a');assert.equal(box.activeByHorizon[5],'');assert.equal(loaded,2);
  console.log('PASS deleting inactive/active session preserves correct selection');
  require('./check-plan-history-pnl.cjs');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
