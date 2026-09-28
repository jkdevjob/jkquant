const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..');
const E=require(process.env.PLAN_SETTINGS_PATH||path.join(root,'plan-session-settings.js'));
const html=fs.readFileSync(process.env.PLAN_HTML_PATH||path.join(root,'plan.html'),'utf8');
const opt={today:'2026-09-28',minStart:'2023-09-28',fx:1350};
const live={id:'keep',horizon:10,name:'old',paper:false,settings:{startCapital:10000,monthlyAdd:100,targetCapital:80000,startDate:'2025-01-02'},ledger:{base:{date:'2025-01-02',cash:10000},events:[{type:'trade',symbol:'TQQQ',qty:2,price:50}]}};
const input={name:'changed',paper:false,capital:10000,monthly:200,target:90000,start:'2025-01-02'};
const original=JSON.stringify(live);
const changed=E.update(live,input,opt);
assert.equal(changed.id,'keep');assert.equal(changed.horizon,10);assert.equal(changed.name,'changed');
assert.equal(changed.settings.monthlyAdd,200);assert.equal(changed.settings.targetCapital,90000);
assert.deepEqual(changed.ledger,live.ledger);assert.equal(JSON.stringify(live),original);
assert.throws(()=>E.update(live,{...input,capital:20000},opt));
assert.throws(()=>E.update(live,{...input,start:'2025-02-02'},opt));
for(const bad of [{capital:Infinity},{monthly:-1},{target:NaN},{start:'2025-02-30'},{start:'2026-09-29'}])assert.throws(()=>E.update(live,{...input,...bad},opt));
let paper=E.update(live,{...input,paper:true,capital:20000,start:'2024-01-02'},opt);
assert.deepEqual(paper.ledger,live.ledger);assert.equal(paper.simStart,'2024-01-02');assert.equal(paper.paperFxRate,1350);
assert.equal(paper.settings.targetDate,'2034-01-02');
paper=E.update(paper,{...input,paper:true,capital:30000,start:'2024-02-02'},opt);
const restored=E.update(paper,{...input,capital:30000,start:'2024-02-02'},opt);
assert.equal(restored.settings.startCapital,10000);assert.equal(restored.settings.startDate,'2025-01-02');
assert.deepEqual(restored.ledger,live.ledger);assert.equal(restored.liveSettings,undefined);
const fresh=E.update({...live,paper:true,ledger:null,simStart:'2025-01-02'},{...input,capital:5000},opt);
assert.equal(fresh.ledger.base.cash,5000);assert.deepEqual(fresh.ledger.events,[]);
const newPaper=E.update({...live,paper:true,ledger:null},{...input,paper:true,capital:5000},opt);
assert.equal(newPaper.ledger,null);assert.equal(newPaper.liveSettings,undefined);
const oldPaper={...live,paper:true,simStart:'2020-01-02',ledger:null};
assert.equal(E.update(oldPaper,{...input,paper:true,start:'2020-01-02'},opt).simStart,'2020-01-02');
assert.throws(()=>E.update(oldPaper,{...input,paper:true,start:'2021-01-02'},opt));
assert.throws(()=>E.update(paper,{...input,paper:true}, {...opt,fx:Infinity}));
console.log('PASS settings validation, immutable edits, real ledger preserved across mode changes');
function fn(marker){
  const start=html.indexOf(marker);assert(start>=0,marker);let i=html.indexOf('{',start),depth=0;
  for(;i<html.length;i++){if(html[i]==='{')depth++;if(html[i]==='}'&&!--depth)return html.slice(start,i+1);}
  throw Error(marker);
}
async function fixture(cancel,creating=false){
  let resolveFx,saves=0,loads=0;
  const fx=new Promise(r=>resolveFx=r),box={sessions:[JSON.parse(original)],activeByHorizon:{10:'keep'}};
  const values={assetSessionKind:'paper',assetSessionName:'edited',assetSessionCapital:'20000',assetSessionMonthly:'250',assetSessionTarget:'90000',assetSessionStart:'2025-01-02'};
  const els=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value}]));
  els.assetSessionModal={hidden:false};els.assetSessionCreate={disabled:false};
  const c=vm.createContext({console,window:{JKPlanSessionSettings:E},$:id=>els[id],ensureLiveBoxes(){},assetPlanBox:()=>box,
    confirm:()=>true,alert:m=>{throw Error(m);},assetFxAt:()=>fx,todayISO:()=>opt.today,assetSessionSettingsFromView:()=>live.settings,
    saveOperatingState:async()=>saves++,renderAssetSessions(){},loadActiveAssetSessionView:async()=>loads++,planSid:()=> 'new'});
  vm.runInContext("let assetSessionSaving=false,assetModalRevision=1,assetModalHorizon=10,activeHorizon=10,assetEditingId='keep',assetViewRevision=0;const assetPaperCache={keep:'old'};"+fn('function closeAssetSessionModal()')+fn('async function createAssetSession()'),c);
  if(creating)vm.runInContext('assetEditingId=null',c);
  const pending=c.createAssetSession();await c.createAssetSession();
  if(cancel==='close')c.closeAssetSessionModal();
  if(cancel==='horizon')vm.runInContext('activeHorizon=5',c);
  resolveFx(1350);await pending;
  if(cancel){assert.equal(JSON.stringify(box.sessions[0]),original);assert.equal(saves,0);assert.equal(loads,0);}
  else if(creating){
    assert.equal(box.sessions.length,2);assert.equal(box.sessions[1].id,'new');assert.equal(box.sessions[1].paper,true);
    assert.equal(box.sessions[1].ledger,null);assert.equal(box.sessions[1].liveSettings,undefined);
    assert.equal(box.activeByHorizon[10],'new');assert.equal(JSON.stringify(box.sessions[0]),original);assert.equal(saves,1);
  }else{
    assert.equal(box.sessions.length,1);assert.equal(box.sessions[0].id,'keep');assert.equal(box.sessions[0].settings.startCapital,20000);
    assert.equal(box.sessions[0].settings.monthlyAdd,250);assert.deepEqual(box.sessions[0].ledger,live.ledger);
    assert.equal(saves,1);assert.equal(loads,1);assert.equal(vm.runInContext('assetPaperCache.keep',c),undefined);
  }
  assert.equal(els.assetSessionCreate.disabled,false);
}
(async()=>{await fixture();await fixture(null,true);await fixture('close');await fixture('horizon');console.log('PASS actual page save: create/edit, duplicate click, modal cancellation, horizon switch, replay cache invalidation');})().catch(e=>{console.error(e);process.exitCode=1;});
