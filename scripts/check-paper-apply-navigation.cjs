const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const html=fs.readFileSync(process.argv[2]||path.join(__dirname,'../index.html'),'utf8');
function fn(marker){const start=html.indexOf(marker);assert(start>=0,marker);let i=html.indexOf('{',start),d=0;for(;i<html.length;i++){if(html[i]==='{')d++;if(html[i]==='}'&&!--d)return html.slice(start,i+1);}throw Error(marker);}
const tabs=['inf','vr','ma','ivs','dca','asap'];
const clone=x=>JSON.parse(JSON.stringify(x));
function el(id,on=false){const set=new Set(on?['on']:[]);return {id,dataset:{b:id},value:'',checked:false,classList:{add:x=>set.add(x),remove:x=>set.delete(x),contains:x=>set.has(x),toggle(x,v){if(v)set.add(x);else set.delete(x);}}};}
async function creation(){
 for(const tab of tabs)for(const detail of ['anal','hist'])for(const paper of [true,false]){
  const chips=[el(tab+'-now'),el(tab+'-'+detail,true)],blocks=chips.map(x=>el(x.id,x.classList.contains('on')));
  const fields={sess_name:{value:'comparison'},sess_paper:{checked:paper},sess_simstart:{value:'2025-01-02'},sess_kis:{checked:false}};
  const original={id:'original',settings:{ticker:'SOXL',principal:10000,autoTp:true},hist:[{amt:12}]};
  const S={activeTab:tab,[tab]:{active:'original',sessions:[original]}};const before=clone(original);const saved=[];
  const c=vm.createContext({S,_sessEditId:null,kisOwner:false,console,
   $:id=>fields[id]||blocks.find(x=>x.id===id),
   document:{querySelector:q=>q.endsWith('.chip.on')?chips.find(x=>x.classList.contains('on')):q.endsWith('.chip')?chips[0]:chips.find(x=>q.includes('"'+x.id+'"')),querySelectorAll:q=>q.endsWith('.chip')?chips:blocks},
   tabBox:()=>S[tab],curStrat:()=>S[tab].sessions.find(x=>x.id===S[tab].active),defInfSettings:()=>({}),
   paperPreferredSimStart:()=> '2025-01-02',paperSeedNewSession:async(t,s)=>{s.paperFxRate=1400;return true;},
   saveLocal:()=>{},pushRemoteNow:async()=>{saved.push(clone(S));return true;},closeSess:()=>{},refreshAll:()=>{},confirm:()=>true,paperStart:s=>s.simStart});
  for(const name of ['Inf','Vr','Ma','Ivs','Dca','Asap'])c['new'+name+'Session']=name=>({id:'new',name,settings:{ticker:'SOXL'},hist:[]});
  vm.runInContext(fn('function resetSubnav(sec)')+fn('function keepSubnav(sec)')+fn('function goBlk(sec,blk,noScroll)')+fn('async function createSess()'),c);
  await c.createSess();
  assert.equal(S.activeTab,tab);assert.equal(S[tab].active,'new');assert.deepEqual(original,before);
  const expected=paper?tab+'-'+detail:tab+'-now';
  assert.equal(chips.find(x=>x.classList.contains('on')).id,expected);
  assert.equal(blocks.find(x=>x.classList.contains('on')).id,expected);
  assert.equal(saved[0][tab].sessions[1].paper, paper?true:undefined);
  if(paper){
   const fresh=S[tab].sessions[1];fresh.hist=[{sim:true,amt:31}];c._sessEditId='new';
   await c.createSess();assert.deepEqual(fresh.hist,[{sim:true,amt:31}]);assert.equal(chips.find(x=>x.classList.contains('on')).id,expected);
  }
 }
 console.log('PASS 24 strategy/detail/session combinations; paper create/edit preserves selected tab and existing records');
}
async function application(failLoader=false){
 const S={activeTab:'ma',paperCommon:{}};const saved=[];const old={};
 for(const t of tabs){S[t]={active:t+'-live',sessions:[{id:t+'-live',paper:false,settings:{ticker:'LIVE'},hist:[{amt:9}]},{id:t+'-paper',paper:true,settings:{ticker:t,simLast:'old'},hist:[{sim:true,amt:3}],simStart:'2025-01-01'}]};old[t]=clone(S[t].sessions[0]);}
 const fields={p_simstart:{value:'2025-02-03'},paperModal:el('modal')};
 const c=vm.createContext({S,console:{error(){}},setTimeout:()=>0,clearTimeout:()=>{},_paperFilling:false,_fillQuoteCache:null,lastQuote:{},curUid:'test',window:{fb:{}},saveTimer:null,stateCloudHydrated:true,lastPushedJSON:'',PAPER_TABS:tabs.map(t=>[t,t]),PAPER_CACHESYM:Object.fromEntries(tabs.map(t=>[t,()=>t])),PAPER_LOADERS:{},
  $:id=>fields[id],paperMinDate:()=> '2020-01-01',PAPER_MAX_YEARS:5,PAPER_RAW_WON_MIGRATION:1,
  paperSessions:()=>tabs.flatMap(t=>S[t].sessions.filter(s=>s.paper).map(s=>[t,s])),paperReadAmt:()=>null,
  confirm:()=>true,paperRememberForm:()=>{},saveLocal:()=>{},paperEnsureCommonWon:async()=>{},paperRepairLegacyStarts:async()=>{},syncPaperStart:()=>{},loadFX:async()=>{},
  paperViewCacheRead:()=>({rows:[]}),paperViewCacheFresh:()=>true,paperSummary:()=>[],
  divCashOn:()=>false,paperAuto:()=>{S[S.activeTab].sessions.find(s=>s.id===S[S.activeTab].active).hist.push({sim:true,amt:42});void c.pushRemoteNow();},
  vrSimForward:()=>{},infSimForward:()=>{},paperStat:(tab,s)=>({tab,id:s.id}),paperWonRate:()=>1,refreshAll:()=>{},setSync:()=>{},
  _commitStateRemote:async()=>{saved.push(clone(S));return true;},paperNote:''});
 for(const t of tabs)c.PAPER_LOADERS[t]=async()=>{await c.pushRemoteNow();assert.equal(saved.length,0,'temporary replay selection must never reach DB');await Promise.resolve();if(failLoader&&t==='vr')throw Error('quote unavailable');};
 vm.runInContext(fn('async function pushRemoteNow()')+fn('async function paperFillAll()')+fn('async function openPaper()')+fn('async function applyAllSimStart()'),c);
 c.refreshPaperView=async(force)=>{assert.equal(force,true);const rows=await c.paperFillAll();await c.pushRemoteNow();return rows;};
 await c.openPaper();assert.equal(saved.length,0,'normal paper open must not replay or write DB');
 assert.equal(S.activeTab,'ma');for(const t of tabs)assert.equal(S[t].active,t+'-live');
 saved.length=0;for(const t of tabs)S[t].sessions[1].hist=[{sim:true,amt:3}];
 await c.applyAllSimStart();assert.equal(S.activeTab,'ma');assert(saved.length>0);
 for(const snapshot of saved){assert.equal(snapshot.activeTab,'ma');for(const t of tabs)assert.equal(snapshot[t].active,t+'-live');}
 for(const t of tabs){assert.deepEqual(S[t].sessions[0],old[t]);const s=S[t].sessions[1];assert.equal(s.simStart,'2025-02-03');assert.deepEqual(clone(s.hist),failLoader&&t==='vr'?[]:[{sim:true,amt:42}]);}
 assert.equal(c._paperFilling,false);
 console.log('PASS normal paper open is read-only/fast; full apply keeps operating strategy/session and saves completed replay after restoration'+(failLoader?' (loader failure included)':''));
}
(async()=>{await creation();await application();await application(true);})().catch(e=>{console.error(e);process.exitCode=1;});

