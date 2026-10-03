// Execute the page's real functions with deterministic UI/network fixtures.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'../plan.html'),'utf8');
function fn(marker){
  const start=html.indexOf(marker);assert(start>=0,marker);
  let i=html.indexOf('{',start),depth=0;
  for(;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&!--depth)return html.slice(start,i+1);}
  throw Error(marker);
}
function element(dataset={}){return {dataset,hidden:false,classList:{toggle(){}},setAttribute(k,v){this[k]=v;}};}
async function main(){
  const tabs=[...html.matchAll(/<button[^>]*data-asset-detail="([^"]+)"[^>]*>/g)].map(m=>element({assetDetail:m[1]}));
  const panels=[...html.matchAll(/<div[^>]*id="([^"]+)"[^>]*data-asset-view="([^"]+)"[^>]*>/g)].map(m=>Object.assign(element({assetView:m[2]}),{id:m[1]}));
  assert.deepEqual(tabs.map(x=>x.dataset.assetDetail),['current','analysis','history','explain']);
  const c=vm.createContext({document:{querySelectorAll:s=>s==='[data-asset-detail]'?tabs:panels}});
  vm.runInContext(fn('function setAssetDetail(name)'),c);
  for(const [name,ids] of Object.entries({current:['alphaOrderSection','alphaAccountSection'],analysis:['assetPaperPanel','alphaEvidenceSection'],history:['alphaHistorySection','alphaResetSection'],explain:['alphaStrategySection']})){
    c.setAssetDetail(name);
    assert.deepEqual(panels.filter(p=>!p.hidden).map(p=>p.id),ids);
    assert.equal(tabs.filter(t=>t['aria-selected']==='true').length,1);
    assert.equal(tabs.find(t=>t.tabIndex===0).dataset.assetDetail,name);
  }
  c.setAssetDetail('invalid');assert.equal(tabs[0].tabIndex,0);
  console.log('PASS analysis/history/explanation show only their sections');

  const els={assetHistoryNote:element(),assetPaperResult:element()},classes=new Set();
  let selected={id:'paper',horizon:5,paper:true,simStart:'2025-01-02',settings:{startCapital:10000}},closed=0;
  let finish;
  const quote=new Promise(resolve=>{finish=resolve;});
  const p=vm.createContext({console,document:{body:{classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}}},
    $:id=>els[id],activeAssetSession:()=>selected,setAssetDetail:()=>{},alphaCloseFillEditor:()=>closed++,alphaCloseEdit:()=>closed++,
    applyAssetSettings:()=>{},alphaSyncInputs:()=>{},renderAlphaLedger:()=>{},renderAssetSessions:()=>{},render:()=>{},refreshAlphaFromCache:()=>{},
    refreshLive:async()=>{},cloneObj:x=>JSON.parse(JSON.stringify(x)),assetPaperStatsHtml:()=>'',fetchPlanQuote:()=>quote,
    window:{JKPlanSessionEngine:{replay:()=>({ledger:{base:{cash:12000},events:[]}})}},todayISO:()=> '2025-01-02'});
  vm.runInContext('let assetViewRevision=0,alphaLedger={base:{cash:999},events:[]},liveQuotes={};const assetPaperCache={};'+
    fn('function assetLedgerSeed(date,cap)')+fn('async function replayAssetPaperSession(x,applyView)')+fn('async function loadActiveAssetSessionView(refresh=true)'),p);
  const pending=p.loadActiveAssetSessionView(false);
  assert.equal(closed,2);assert(classes.has('asset-paper-mode'));
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
  vm.runInContext(fn('async function deleteAssetSession(id)'),d);
  await d.deleteAssetSession('b');assert.equal(box.activeByHorizon[5],'a');assert.equal(loaded,1);
  await d.deleteAssetSession('a');assert.equal(box.activeByHorizon[5],'');assert.equal(loaded,2);
  console.log('PASS deleting inactive/active session preserves correct selection');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
