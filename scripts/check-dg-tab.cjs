#!/usr/bin/env node
'use strict';
/* 운영 › 듀얼가드 탭을 다른 운영 탭처럼 (index v3.122.0 · plan v2.5.0 · 2026-11-09)
 * 사용자: "듀얼가드를 운영에 다른 탭과 같이 변경해 설정을 따로 빼고 세션을 위로 올리고 세션 누르면 이름과 모의투자등등 선택할수 있고
 *          세션 드래그 가능하게 / 다른 탭이랑 최대한 비슷하게 / 듀얼가드 접근시 또 로그인 하지 말고"
 * 실제 페이지 함수를 뽑아 그대로 돌린다(재구현 없음). 값 시험 + 변이(틀린 코드로 바꾸면 빨간불).
 *   A 세션 바꾸기는 한 번에 하나씩 — 빨리 연달아 바꿔도 앞 세션 장부가 뒤 세션에 옮겨 적히지 않는다 · 보고 있는 세션이면 아무것도 안 함
 *   B 설정 창은 앞 전환이 끝난 뒤에 연다(화면 장부가 그 세션 것이 된 다음에 화면 값을 거둔다)
 *   C 끌어서 순서 — 보이는 세션만 움직이고 숨긴 세션은 제자리 · 어긋나면 안 바꿈 · 저장 실패면 되돌림 · 합칠 때 이 탭 순서를 지킴
 *   D 세션 줄 — 현재 투자중 맨 앞 · ✕ 는 보고 있는 세션에만 · + 세션 맨 끝 · 보고 있는 칩을 누르면 세션 설정
 *   E 설정 창 두 갈래 — 세션(이름 · 모의투자 · 포트폴리오) / ⚙️ 설정(금액 · 시작일) · 시작일 칸은 갈래·종류에 맞게
 *   F 창 안에서 다시 로그인하지 않는다 — 로그인 상자 대신 운영 화면 로그인을 이어받음 · DB 다시 연결 상자는 그대로
 *   G 운영 화면 — 듀얼가드 창 미리 열기(모의 페이지 빼고) · 다른 탭도 보고 있는 칩을 누르면 세션 설정 · 상태줄 배지
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={idx:rd('index.html'),plan:rd('plan.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* 플랜 화면의 세션 상태를 vm 에 꾸린다 — 화면 장부(alphaLedger)는 '지금 보이는 세션' 장부다. 보기 바꾸기는 늦게 끝난다(실제 화면처럼). */
function planCtx(S,extra={}){
  const box={sessions:[
    {id:'A',name:'A 운영',horizon:5,paper:false,settings:{},ledger:{events:['a']}},
    {id:'H',name:'10년(폐지)',horizon:10,paper:false,settings:{},ledger:{events:['h']}},
    {id:'B',name:'B 운영',horizon:5,paper:false,settings:{},ledger:{events:['b']}},
    {id:'C',name:'C 모의',horizon:5,paper:true,simStart:'2025-01-02',settings:{},ledger:null}],activeByHorizon:{5:'A'}};
  const log={saves:0,loads:0,edits:[],alerts:[]};
  const c={box,log,activeHorizon:5,alphaLedger:{events:['a']},liveState:{},window:{JKPlanSessionEngine:{retiredReason:x=>+x.horizon!==5?'기간 폐지':''}},
    assetPlanBox:()=>box,assetSessionSettingsFromView:()=>({startCapital:1}),closeAssetSessionModal(){},clearRequestedAssetSessionLink(){},localSave(){},
    saveOperatingState:async()=>{log.saves++;await sleep(8);return c.saveOk!==false;},
    loadActiveAssetSessionView:async()=>{log.loads++;await sleep(8);const x=c.activeAssetSession();c.alphaLedger=JSON.parse(JSON.stringify(x?(x.ledger||{events:[]}):{events:['cur']}));},
    renderAssetSessions(){},alert:m=>log.alerts.push(m),console,setTimeout,Promise,JSON,Date,Map,Set,String,Number,Array,Math,...extra};
  vm.createContext(c);
  vm.runInContext('var assetSwitchChain=Promise.resolve();\n'+['function planRetired(x)','function activeAssetSession()','function cloneObj(v)','function writeAssetSessionLocal()',
    'function syncActiveAssetSessionFromView()','function assetSwitchIdle()','async function selectAssetSession(id)','function assetReorderList(sessions,order)','async function assetReorderSessions(order)'].map(m=>fnOf(S.plan,m)).join('\n'),c);
  return c;
}

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};

  // ── A. 한 번에 하나씩
  { const c=planCtx(S);
    const p1=c.selectAssetSession('B'),p2=c.selectAssetSession('C');await Promise.all([p1,p2]);
    t('A1 빨리 연달아 A → B → C: 각 세션 장부가 제 것 그대로(A=[a] · B=[b]) · 끝 화면은 C',JSON.stringify(c.box.sessions.map(x=>x.ledger&&x.ledger.events))==='[["a"],["h"],["b"],null]'&&c.box.activeByHorizon[5]==='C',
      JSON.stringify(c.box.sessions.map(x=>[x.id,x.ledger&&x.ledger.events])));
    const before=c.log.saves;await c.selectAssetSession('C');
    t('A2 보고 있는 세션을 다시 고르면 아무것도 안 한다(저장·다시 그리기 0번)',c.log.saves===before,c.log.saves-before);
    await c.selectAssetSession('');
    t('A3 현재 투자중으로 돌아가기도 같은 줄(장부 그대로 · 화면은 현재 투자중)',c.box.activeByHorizon[5]===''&&JSON.stringify(c.alphaLedger.events)==='["cur"]'); }

  // ── B. 설정 창은 앞 전환이 끝난 뒤
  { const c=planCtx(S);const el=()=>({value:'',checked:false,disabled:false,textContent:'',dataset:{},hidden:true});const E={};
    for(const id of ['assetSessionName','assetSessionPaper','assetSessionCapital','assetSessionMonthly','assetSessionTarget','assetSessionStart','assetSessionModalTitle','assetSessionCreate','assetSessionModalStrategy','assetSessionModal'])E[id]=el();
    Object.assign(c,{$:id=>E[id],openAssetSessionModal(){},syncAssetSessionModal(){},planStrategyLabel:()=>'듀얼가드 v1.0',planStrategyLabelOf:()=>'듀얼가드 v1.0',planPortfolio:true,assetEditingId:null,assetPfPick:true,planCurName:'토스 듀얼'});
    vm.runInContext(['function planCurLabel()','function setAssetModalMode(m)','function assetPfInit(on)','async function editAssetSession(mode)'].map(m=>fnOf(S.plan,m)).join('\n'),c);
    const p=c.selectAssetSession('B');const e=c.editAssetSession('session');await Promise.all([p,e]);
    t('B1 세션을 바꾸자마자 설정을 열어도 B 장부는 B 그대로(앞 세션 A 장부를 옮겨 적지 않음) · 창은 B 를 연다',JSON.stringify(c.box.sessions[2].ledger.events)==='["b"]'&&c.assetEditingId==='B'&&E.assetSessionModal.dataset.mode==='session',
      JSON.stringify([c.box.sessions[2].ledger,c.assetEditingId]));
    await c.editAssetSession('settings');
    t('B2 ⚙️ 설정은 settings 갈래 · 제목 "설정 · B 운영"',E.assetSessionModal.dataset.mode==='settings'&&/^설정 · B 운영/.test(E.assetSessionModalTitle.textContent),E.assetSessionModalTitle.textContent);
    await c.selectAssetSession('');await c.editAssetSession('session');
    t('H1 현재 투자중(본 장부)도 이름 칸이 열려 있고 지금 이름(토스 듀얼)이 들어 있다 · 모의투자로 바꾸기만 잠김',E.assetSessionName.disabled===false&&E.assetSessionName.value==='토스 듀얼'&&E.assetSessionPaper.disabled===true&&c.assetEditingId==='current',
      JSON.stringify([E.assetSessionName.disabled,E.assetSessionName.value,E.assetSessionPaper.disabled,c.assetEditingId])); }

  // ── C. 끌어서 순서
  { const c=planCtx(S);const L=c.box.sessions;
    const r1=c.assetReorderList(L,['C','A','B']).map(x=>x.id).join(),r2=c.assetReorderList(L,['C','A','B','Z']).map(x=>x.id).join(),r3=c.assetReorderList(L,['C','A','A']).map(x=>x.id).join(),r4=c.assetReorderList(L,['C','A']).map(x=>x.id).join();
    t('C1 보이는 세션(A·B·C)만 새 순서로 · 숨긴 10년 세션 H 는 제자리 → C,H,A,B',r1==='C,H,A,B',r1);
    t('C2 화면 순서와 목록이 어긋나면(없는 세션 Z · 겹침 A,A) 순서를 안 바꾼다 · 화면에 빠진 세션(B)은 제자리 — 어느 경우도 세션을 잃거나 겹치지 않는다',
      r2==='A,H,B,C'&&r3==='A,H,B,C'&&r4==='C,H,B,A',r2+' | '+r3+' | '+r4);
    const ok=await c.assetReorderSessions(['B','C','A']);
    t('C3 놓으면 저장 한 번 · 새 순서 B,H,C,A',ok===true&&c.box.sessions.map(x=>x.id).join()==='B,H,C,A'&&c.log.saves===1,c.box.sessions.map(x=>x.id).join());
    c.saveOk=false;const ok2=await c.assetReorderSessions(['A','B','C']);
    t('C4 저장이 안 되면 원래 순서로 되돌리고 알린다',ok2===false&&c.box.sessions.map(x=>x.id).join()==='B,H,C,A'&&c.log.alerts.length===1,c.box.sessions.map(x=>x.id).join()); }
  { const c={};vm.createContext(c);vm.runInContext(['function cloneObj(v)','function planStableJson(v)','function planRebaseRecords(base,candidate,remote)','function planRebaseOperating(base,candidate,remote)'].map(m=>fnOf(S.plan,m)).join('\n'),c);
    const s=(id,name)=>({id,name,horizon:5,paper:true,ledger:null});
    const base={plan:{sessions:[s('A','a'),s('B','b'),s('C','c')]}},cand={plan:{sessions:[s('C','c'),s('A','a'),s('B','b')]}},remote={plan:{sessions:[s('A','a'),s('B','b2'),s('C','c'),s('D','d')]}};
    const o1=c.planRebaseOperating(base,cand,remote).plan.sessions,o2=c.planRebaseOperating(base,JSON.parse(JSON.stringify(base)),remote).plan.sessions;
    t('C5 합칠 때(다른 기기가 먼저 저장) — 이 탭이 바꾼 순서 C,A,B 를 지키고 다른 기기에서 새로 생긴 세션 D 는 뒤(지우지 않음)',
      o1.map(x=>x.id).join()==='C,A,B,D',o1.map(x=>x.id+':'+x.name).join());
    t('C6 순서를 안 바꿨으면 받은 순서 그대로(A,B,C,D)',o2.map(x=>x.id).join()==='A,B,C,D',o2.map(x=>x.id).join()); }

  // ── D. 세션 줄
  { const V={assetSessionChips:{innerHTML:''},assetSessionState:{className:'',textContent:'',title:''}};
    const box={sessions:[{id:'A',name:'A 운영',horizon:5,paper:false},{id:'P',name:'모의<1>',horizon:5,paper:true,simStart:'2025-01-02'},{id:'H',name:'10년',horizon:10}],activeByHorizon:{5:'P'}};
    const c={window:{JKPlanSessionEngine:{STRATEGY:{name:'듀얼가드',version:'1.0'},retiredReason:x=>+x.horizon!==5?'x':''}},$:id=>V[id],assetPlanBox:()=>box,activeHorizon:5,dgDragEl:null,planCurName:'',planCurRules:'base'};
    vm.createContext(c);vm.runInContext(['function planCurLabel()','function planStrategy()','function planStrategyLabel()','function assetRulesOf(x)','function renderPlanVersion()','function planStrategyLabelOf(x)','function planRetired(x)','function assetSessionList(h=activeHorizon)','function activeAssetSession()','function renderAssetSessions()'].map(m=>fnOf(S.plan,m)).join('\n'),c);
    c.renderAssetSessions();const h=V.assetSessionChips.innerHTML,ids=[...h.matchAll(/data-asess="([^"]*)"/g)].map(m=>m[1]);
    t('D1 칩 차례: 현재 투자중(맨 앞) → 세션들 → + 세션(맨 끝) · 폐지 세션 없음',ids.join()===',A,P'&&/data-asess-add="1"[^>]*>\+ 세션<\/div>$/.test(h)&&!/10년/.test(h),ids.join());
    t('D2 ✕ 는 보고 있는 세션에만(P) · 모의 배지 · 이름은 글자로(<1> 이스케이프)',(h.match(/data-asess-del=/g)||[]).length===1&&/data-asess-del="P"/.test(h)&&/paperbadge">모의/.test(h)&&/모의&lt;1>/.test(h)&&/class="dg-sesschip on" data-asess="P"/.test(h),h.slice(0,300));
    const first0=(h.match(/^<div[^>]*data-asess=""[^>]*>([^<]*)<\/div>/)||['',''])[1];c.planCurName='토스 <듀얼>';c.renderAssetSessions();
    const first1=(V.assetSessionChips.innerHTML.match(/^<div[^>]*data-asess=""[^>]*>([^<]*)<\/div>/)||['',''])[1];
    t('H2 세션 줄 첫 칩 = 본 장부 이름(바꾸기 전 "현재 투자중" · 바꾼 뒤 그 이름 · 글자로 이스케이프)',first0==='현재 투자중'&&first1==='토스 &lt;듀얼>',JSON.stringify([first0,first1]));
    t('D3 상태줄 글자 — 운영 탭처럼 세션 이름 없이 전략 요약 · 모의 시작일(숨긴 예전 세션 수는 안 적음 · 2026-11-12)',V.assetSessionState.textContent==='듀얼가드 v1.0 · 모의 2025-01-02~'&&V.assetSessionState.className==='asset-session-state paper',V.assetSessionState.textContent);
    dgActivate:{ const L=[];const cc={activeAssetSession:()=>({id:'P'}),editAssetSession:m=>L.push('edit:'+m),selectAssetSession:id=>L.push('sel:'+id),$:()=>({hidden:true})};
      vm.createContext(cc);vm.runInContext(fnOf(S.plan,'function dgChipActivate(id)'),cc);cc.dgChipActivate('P');cc.dgChipActivate('A');cc.dgChipActivate('');
      t('D4 보고 있는 칩(P)을 누르면 세션 설정 · 다른 칩은 전환',L.join()==='edit:session,sel:A,sel:',L.join()); } }

  // ── H. 본 장부(현재 투자중) 이름 — 저장(원장 sessionName) · 읽기 · 포트폴리오
  { const M=(()=>{const c={};vm.createContext(c);vm.runInContext(rd('plan-session-settings.js'),c);return c.JKPlanSessionSettings;})();
    const P={};const el=(id,o={})=>P[id]=Object.assign({value:'',checked:false,disabled:false,textContent:'',hidden:false},o);
    el('assetSessionPaper',{checked:false});el('assetSessionName',{value:'  토스 듀얼가드  '});el('assetSessionCapital',{value:'20000'});el('assetSessionMonthly',{value:'0'});el('assetSessionTarget',{value:'150000'});
    el('assetSessionStart',{value:'2026-01-02'});el('assetSessionPf',{checked:true});el('assetSessionModal',{hidden:false});el('assetSessionCreate');
    const seen=[];const c={$:id=>P[id],window:{JKPlanSessionSettings:M},ensureLiveBoxes(){},assetModalRevision:1,assetModalHorizon:5,activeHorizon:5,assetEditingId:'current',assetSessionSaving:false,assetViewRevision:0,assetPaperCache:{},
      planPortfolio:true,planCurName:'',assetPlanBox:()=>({sessions:[],activeByHorizon:{}}),cloneObj:v=>JSON.parse(JSON.stringify(v)),alphaLedger:{base:{date:'2026-01-02',cash:20000},events:[]},
      assetSessionSettingsFromView:()=>({startCapital:20000,monthlyAdd:0,targetCapital:150000,startDate:'2026-01-02'}),confirm:()=>true,assetFxAt:async()=>1400,todayISO:()=>'2026-11-09',
      applyAssetSettings(){},alphaSyncInputs(){},localSave(){},saveOperatingState:async()=>true,closeAssetSessionModal(){},renderAssetSessions(){},loadActiveAssetSessionView:async()=>{},planSid:()=>'n',alert:m=>seen.push('alert:'+m)};
    c.cloudSave=async()=>{seen.push(c.planCurName);return true;};
    vm.createContext(c);vm.runInContext(['function planCurLabel()','function assetModalPaper()','async function createAssetSession()'].map(m=>fnOf(S.plan,m)).join('\n'),c);
    await c.createAssetSession();P.assetSessionName.value='현재 투자중';await c.createAssetSession();
    t('H3 현재 투자중 이름을 바꿔 저장하면 원장 저장 전에 이름이 들어감(앞뒤 빈칸 정리) · "현재 투자중"으로 되돌리면 빈칸(기본)',seen.join('|')==='토스 듀얼가드|',seen.join('|'));
    const r={$:()=>({type:'text',value:''}),planLinks:{},sleeveSessions:[],sleeveLedger:{},alphaLedger:{base:{},events:[]},planPortfolio:true,planCurName:'토스 듀얼',planCurRules:'base'};
    vm.createContext(r);vm.runInContext(fnOf(S.plan,'function readForm()'),r);const o=r.readForm();
    const a={$:()=>null,todayISO:()=>'2026-11-09',plusYears:s=>s,planSid:()=>'x',bindSleeveLedger(){},alphaSyncInputs(){},alphaFee:()=>0,ALPHA_FEE_RATE:0.001,planLinks:null,sleeveSessions:null,alphaLedger:null,planPortfolio:true,planCurName:''};
    vm.createContext(a);vm.runInContext(fnOf(S.plan,'function defaults()')+fnOf(S.plan,'function planLedgerFrom(o,all)')+fnOf(S.plan,'function apply(o)'),a);
    a.apply({sessionName:' 토스 듀얼 '});const n1=a.planCurName;a.apply({});const n2=a.planCurName;
    t('H4 이름은 원장(fiveYearPlanV2.sessionName)에 적고 읽는다 — 없으면 빈칸(기본 "현재 투자중")',o.sessionName==='토스 듀얼'&&n1==='토스 듀얼'&&n2==='',JSON.stringify([o.sessionName,n1,n2]));
    const pc={planLiveDoc:{sessionName:'토스 듀얼',startCapital:1,alphaLedger:{base:{cash:1},events:[{id:'e'}]}},PF:{over:{}},S:{plan:{sessions:[{id:'s1',name:'옛 이름',horizon:5,paper:false,settings:{},ledger:{base:{cash:1},events:[{id:'f'}]}}]}},planPaperRetired:()=>false};
    vm.createContext(pc);vm.runInContext(['function pfNum(v)','function pfWanted(x)','function pfPlanWanted(stored, ov)','function pfLedgerUsed(l)','function pfPlanLedgers(withOff)'].map(m=>fnOf(S.idx,m)).join('\n'),pc);
    const n3=pc.pfPlanLedgers().map(x=>x.name).join('|');pc.PF.over={cur:{ledger:pc.planLiveDoc.alphaLedger,name:'창 이름'},s1:{ledger:pc.S.plan.sessions[0].ledger,name:'새 이름'}};
    const n4=pc.pfPlanLedgers().map(x=>x.name).join('|');pc.planLiveDoc.sessionName='';pc.PF.over={};const n5=pc.pfPlanLedgers()[0].name;
    t('H5 포트폴리오 카드 이름 — 원장 이름 · 창이 방금 보낸 이름이 우선 · 없으면 "현재 투자중"',n3==='토스 듀얼|옛 이름'&&n4==='창 이름|새 이름'&&n5==='현재 투자중',JSON.stringify([n3,n4,n5])); }

  // ── E. 설정 창 두 갈래 · 시작일 칸
  { const mk=(mode,paper)=>{const E={assetSessionModal:{dataset:{mode}},assetSessionPaper:{checked:paper},assetSessionCapital:{disabled:false,value:''},assetSessionStart:{disabled:false,value:'',min:''},
        assetSessionStartWrap:{style:{display:'x'}},assetSessionStartLabel:{textContent:''},assetSessionPaperNote:{textContent:''}};
      const c={$:id=>E[id],assetPfUI(){},assetEditingId:'current',alphaLedger:{events:[]},assetPlanBox:()=>({sessions:[]}),window:{JKPlanSessionSettings:{hasLedgerActivity:()=>false}},Date};
      vm.createContext(c);vm.runInContext(fnOf(S.plan,'function assetModalPaper()')+fnOf(S.plan,'function syncAssetSessionModal()'),c);c.syncAssetSessionModal();return E.assetSessionStartWrap.style.display;};
    const v=[mk('session',true),mk('session',false),mk('settings',false),mk('settings',true)];
    t('E1 시작일 칸 — 세션 창: 모의일 때만(모의 시작일) · ⚙️ 설정: 운영일 때만(시작일)',JSON.stringify(v)==='["","none","","none"]',JSON.stringify(v));
    const P=S.plan,mod=P.slice(P.indexOf('id="assetSessionModal"'),P.indexOf('id="assetSessionCreate"'));
    t('E2 칸 나눔 — 이름·모의투자·포트폴리오는 세션 갈래 · 시작자산·월 추가·목표자산은 설정 갈래 · 갈래별 숨김 규칙',
      /class="field asm-session"[^>]*><label>세션 이름/.test(mod)&&/class="asset-session-pf asm-session" id="assetSessionPaperRow"/.test(mod)&&/class="asset-session-pf asm-session" id="assetSessionPfRow"/.test(mod)
      &&(mod.match(/class="field asm-settings"/g)||[]).length===3&&!/id="assetSessionKind"/.test(P)
      &&/#assetSessionModal\[data-mode="session"\] \.asm-settings\{display:none!important\}/.test(P)&&/#assetSessionModal\[data-mode="settings"\] \.asm-session\{display:none!important\}/.test(P));
    t('E3 상태줄 ⚙️ 설정 → settings 갈래 · 세션 줄 두 번 누름 → session 갈래(앞 전환이 끝난 뒤)',/\$\("assetSettingsBtn"\)\.addEventListener\("click",\(\)=>editAssetSession\('settings'\)\)/.test(P)
      &&/assetSwitchIdle\(\)\.then\(\(\)=>\{ if\(String\(\(activeAssetSession\(\)\|\|\{\}\)\.id\|\|''\)===id&&\$\("assetSessionModal"\)\.hidden\)editAssetSession\('session'\); \}\);/.test(P)); }

  // ── F. 창 안에서 다시 로그인하지 않는다
  { const calls=[];let iv=null;const U={uid:'u1'};
    const c={auth:{currentUser:null},updateCurrentUser:async(a,u)=>{calls.push(u);a.currentUser=u;},window:{parent:{fb:{auth:{currentUser:null}}}},
      document:{documentElement:{classList:{add(){},contains:()=>true}}},$:()=>({textContent:''}),setInterval:(f,ms)=>{iv=f;return 7;},clearInterval:()=>{iv=null;},console};
    c.window.parent.window=c.window.parent;
    vm.createContext(c);vm.runInContext('var planAdoptTimer=null;\n'+fnOf(S.plan,'async function planAdoptParentUser()')+fnOf(S.plan,'function planWaitParentUser()'),c);
    c.planWaitParentUser();await sleep(0);
    const waiting=calls.length===0&&!!iv;
    c.window.parent.fb.auth.currentUser=U;await iv();await sleep(0);
    t('F1 창 안 · 이 창의 로그인이 비면 로그인 상자 대신 기다림 → 운영 화면이 로그인하면 그 로그인을 이어받음(updateCurrentUser 한 번)',waiting&&calls.length===1&&calls[0]===U&&c.auth.currentUser===U&&iv===null,JSON.stringify({waiting,calls:calls.length}));
    const P=S.plan,cb=P.slice(P.indexOf('onAuthStateChanged(auth,async user=>{'));
    t('F2 onAuthStateChanged: 창 안이고 로그인이 없으면 이어받기로(로그인 상자 코드보다 먼저)',cb.indexOf('if(!user&&planEmbedded()){ planWaitParentUser(); return; }')>0&&cb.indexOf('if(!user&&planEmbedded())')<cb.indexOf('if(!user){ planLoginBoxReset();'));
    t('F3 창 안 화면: 로그인 상자 · 앱 첫 화면 로고 숨김 · DB 다시 연결 상자는 보임 · 8초 타이머도 로그인 상자로 안 바꿈',
      /html\.embed:not\(\.embed-dberr\) #authgate \.gbox\{display:none\}/.test(P)&&/html\.embed #authgate \.bootwait \.bw-logo,html\.embed #authgate \.bootwait \.bw-help\{display:none\}/.test(P)
      &&/document\.documentElement\.classList\.add\('embed-dberr'\)/.test(fnOf(P,'function showPlanDbRetry(e)'))&&/h\.classList\.remove\('embed-dberr'\)/.test(fnOf(P,'function planGate(on)'))
      &&/if\(h\.classList\.contains\('embed'\)\) return;[^\n]*\n  h\.classList\.remove\('had-user'\);/.test(P)&&/import \{[^}]*\bupdateCurrentUser\b[^}]*\} from "https:\/\/www\.gstatic\.com\/firebasejs\/12\.19\.0\/firebase-auth\.js"/.test(P)); }

  // ── G. 운영 화면
  { const runs=[];let tm=null;
    const mk=(paper,uid,frame)=>{const c={dgFrameEl:frame,curUid:uid,isPaperPage:()=>paper,dgEnsureFrame:()=>{runs.push('open');c.dgFrameEl={};},setTimeout:(f,ms)=>{tm=f;return 1;}};
      vm.createContext(c);vm.runInContext('var _dgPreloadTimer=null;\n'+fnOf(S.idx,'function dgPreload()'),c);return c;};
    const a=mk(false,'u1',null);a.dgPreload();a.dgPreload();const scheduled=!!tm;if(tm)tm();
    tm=null;const b=mk(true,'u1',null);b.dgPreload();const paperNo=!tm;
    tm=null;const d=mk(false,null,null);d.dgPreload();const noUser=!tm;
    tm=null;const e=mk(false,'u1',{});e.dgPreload();const hasFrame=!tm;
    t('G1 로그인 뒤 듀얼가드 창을 뒤에서 한 번만 미리 연다 · 모의 성과 페이지 · 로그인 전 · 이미 열린 창이면 안 연다',scheduled&&runs.join()==='open'&&paperNo&&noUser&&hasFrame,JSON.stringify({scheduled,runs,paperNo,noUser,hasFrame}));
    t('G2 미리 열기 자리 — DB 원장을 읽은 뒤(앱 시작 · DB 다시 연결 두 곳)',(S.idx.match(/pfPageAuto\(\);[^\n]*\n\s*dgPreload\(\);/g)||[]).length===2); }
  { let click=null;const L=[];const bar={addEventListener:(k,f)=>{if(k==='click')click=f;}};
    const c={$:id=>id==='sessbar'?bar:null,window:{addEventListener(){}},_dragEndAt:0,Date,tabBox:()=>({active:'s2'}),deleteSess:id=>L.push('del:'+id),openSess:()=>L.push('add'),switchSess:id=>L.push('sw:'+id),editSess:id=>L.push('edit:'+id),
      _dragChipOf:()=>null,_dragDown(){},_dragMove:()=>false,_dragStop(){},_dragEl:null,_dragStart:null};
    vm.createContext(c);vm.runInContext(fnOf(S.idx,'function setupSessbar()'),c);c.setupSessbar();
    const ev=sel=>({target:{closest:q=>q==='[data-sid]'&&sel?{getAttribute:()=>sel}:null},stopPropagation(){}});
    click(ev('s2'));click(ev('s1'));
    t('G3 다른 운영 탭도 — 보고 있는 칩(s2)을 누르면 세션 설정 · 다른 칩(s1)은 전환(듀얼가드 세션 줄과 같은 동작)',L.join()==='edit:s2,sw:s1',L.join()); }
  { // 두 번 누름의 둘째 누름이 막 열린 창 바깥에 떨어져도 안 닫힘 — 운영 세션 창 · 듀얼가드 세션 창
    let h=null;const m={classList:{set:new Set(['on']),remove(x){this.set.delete(x);}},addEventListener:(k,f)=>{h=f;}};let now=1000;
    const c={$:id=>id==='sessModal'?m:null,Date:{now:()=>now}};vm.createContext(c);
    vm.runInContext((S.idx.match(/\['setModal','sessModal','paperModal'\]\.forEach\([^\n]*/)||[''])[0],c);
    m._openedAt=1000;now=1200;if(h)h({target:m});const kept=m.classList.set.has('on');now=1600;if(h)h({target:m});const closed=!m.classList.set.has('on');
    const P=S.plan;
    t('G7 막 연 세션 창은 0.2초 뒤 바깥 누름(두 번 누름의 둘째)에 안 닫히고 0.6초 뒤엔 닫힘 · 듀얼가드 창도 같은 규칙 · 열 때 시각을 적음',!!h&&kept&&closed
      &&/\$\('sessModal'\)\._openedAt=Date\.now\(\);/.test(fnOf(S.idx,'function editSess(id)'))&&/if\(e\.target===\$\("assetSessionModal"\)&&Date\.now\(\)-assetModalOpenedAt>450\)closeAssetSessionModal\(\);/.test(P)
      &&/assetModalOpenedAt=Date\.now\(\);/.test(fnOf(P,'function openAssetSessionModal()')),JSON.stringify({kept,closed})); }
  { const V={dgStrip:{innerHTML:''},assetStatusBadges:{innerHTML:''}};
    const c={$:id=>V[id],usd2:v=>'$'+v,planEmbedPost(){},requestAnimationFrame:null};
    vm.createContext(c);vm.runInContext(fnOf(S.plan,'function renderDualGuardStrip(o)'),c);
    c.renderDualGuardStrip({date:'2026-11-06',orders:2,orderText:'TQQQ 매도 38주',need:true,teclNow:.2,teclTarget:.25,teclHit:false,gap:.05,band:.1,guard:'OFF',guardFlip:true,dist:-3,ma:225,upper:70,lower:60});
    const on=V.assetStatusBadges.innerHTML;c.renderDualGuardStrip(null);
    t('G4 상태줄 배지 = 아래 띠와 같은 값(Guard OFF · 주문 2건) · 불러오는 중엔 비움',/Guard OFF<\/span>/.test(on)&&/주문 2건<\/span>/.test(on)&&V.assetStatusBadges.innerHTML==='',on); }
  { const P=S.plan;
    t('G5 붙박이 세 줄 — 세션 줄(맨 위) · 상태줄(--dg-h1) · 상세 탭(--dg-h2) · 높이는 dgStickyOffsets 가 잰다',/\.dg-sessbar\{position:sticky;top:0;/.test(P)&&/\.dg-statusline\{position:sticky;top:var\(--dg-h1,49px\);/.test(P)
      &&/\.asset-detail-tabs\{position:sticky;top:var\(--dg-h2,88px\);/.test(P)&&/setProperty\('--dg-h1',h1\+'px'\);r\.setProperty\('--dg-h2',h2\+'px'\)/.test(fnOf(P,'function dgStickyOffsets()')));
    /* G8 (2026-11-11 사용자 "현재 분석 거래이력탭이 스크롤시 고정이 안되고 가려짐") — 운영 › 듀얼가드 창은 다른 탭을 보는 동안 숨어 있고,
       그때 잰 높이 0 이 남으면 상태줄 · 상세 탭이 맨 위(세션 줄 밑)에 겹쳐 가려졌다. 실제 함수 두 개를 그대로 돌린다. */
    const V={assetSessionChips:{offsetHeight:56},assetStatusline:{offsetHeight:55}},vars={},seen=[];let roCb=null;
    const c={$:id=>V[id],document:{documentElement:{style:{setProperty:(k,v)=>{vars[k]=v;}}}},ResizeObserver:class{constructor(cb){roCb=cb;}observe(el){seen.push(el);}}};
    vm.createContext(c);vm.runInContext('let dgStickyRO=null;var dgStickyH={h1:0,h2:0};function dgVpPaint(){}\n'+fnOf(P,'function dgStickyOffsets()')+'\n'+fnOf(P,'function dgStickyWatch()'),c);
    c.dgStickyOffsets();const vis=vars['--dg-h2'];
    V.assetSessionChips.offsetHeight=0;V.assetStatusline.offsetHeight=0;c.dgStickyOffsets();const hid=vars['--dg-h2'];   // 숨은 창 — 그대로 둔다
    c.dgStickyWatch();V.assetSessionChips.offsetHeight=56;V.assetStatusline.offsetHeight=85;if(roCb)roCb([]);const grown=vars['--dg-h2'];   // 다시 보임 · 상태줄 두 줄
    t('G8 숨은 창에서 잰 높이 0 은 버리고 · 두 줄 크기가 바뀌면 ResizeObserver 로 다시 잰다(상태줄 · 상세 탭이 맨 위에 겹쳐 가려지지 않게)',
      vis==='111px'&&hid==='111px'&&grown==='141px'&&vars['--dg-h1']==='56px'&&seen.length===2&&seen.includes(V.assetSessionChips)&&seen.includes(V.assetStatusline)
      &&/try\{dgStickyWatch\(\);\}catch\(e\)\{\}/.test(P),JSON.stringify({vis,hid,grown,seen:seen.length}));
    t('G6 끌기 — 손가락은 길게(350ms) · 집힌 뒤에만 스크롤 막음(touchmove passive:false) · 마우스는 창 전체 · 끈 직후 누름은 전환 아님',/const DG_DRAG_HOLD=350,DG_DRAG_SLOP=8;/.test(P)
      &&/bar\.addEventListener\("touchmove",e=>\{[^\n]*\},\{passive:false\}\)/.test(P)&&/window\.addEventListener\("mousemove"/.test(P)&&/window\.addEventListener\("mouseup"/.test(P)&&/if\(Date\.now\(\)-dgDragEndAt<250\)return;/.test(P)); }
  return bad;
}

const MUT=[
  ['세션 바꾸기: 앞 전환을 안 기다림(옛 코드)','plan',s=>s.replace("  await prev.catch(()=>{});\n  if(String((activeAssetSession()||{}).id||'')===String(id||''))return;","  if(String((activeAssetSession()||{}).id||'')===String(id||''))return;")],
  ['세션 바꾸기: 보고 있는 세션도 다시 저장','plan',s=>s.replace("  if(String((activeAssetSession()||{}).id||'')===String(id||''))return;   // 이미 보고 있는 세션","  // 이미 보고 있는 세션")],
  ['설정 창: 앞 전환을 안 기다림','plan',s=>s.replace("async function editAssetSession(mode){\n  await assetSwitchIdle();","async function editAssetSession(mode){")],
  ['순서: 숨긴 세션도 섞음','plan',s=>s.replace("const out=(sessions||[]).slice();slots.forEach((i,k)=>{out[i]=moving[k];});return out;","return moving.concat((sessions||[]).filter(x=>!(x&&pos.has(String(x.id)))));")],
  ['순서: 어긋나도 바꿈','plan',s=>s.replace("if(moving.length!==ids.length||pos.size!==ids.length)return (sessions||[]).slice();","")],
  ['순서: 저장 실패해도 안 되돌림','plan',s=>s.replace("if(!ok){b.sessions=before;writeAssetSessionLocal();","if(!ok){")],
  ['합치기: 이 탭 순서를 버림','plan',s=>s.replace("      out.plan.sessions.sort((a,c)=>rank(a)-rank(c));\n","")],
  ['세션 줄: ✕ 를 모든 세션에','plan',s=>s.replace("(on?'<span class=\"sessdel\" data-asess-del=\"'+q(x.id)+'\" title=\"세션 삭제\"> ✕</span>':'')","'<span class=\"sessdel\" data-asess-del=\"'+q(x.id)+'\" title=\"세션 삭제\"> ✕</span>'")],
  ['세션 줄: 보고 있는 칩을 눌러도 설정 안 열림','plan',s=>s.replace("if(String((activeAssetSession()||{}).id||'')===id){ if($(\"assetSessionModal\").hidden)editAssetSession('session'); return; }","")],
  ['설정 창: 시작일 칸 늘 보임','plan',s=>s.replace("$('assetSessionStartWrap').style.display=(mode==='settings')===!paper?'':'none';","$('assetSessionStartWrap').style.display='';")],
  ['창 안: 로그인 상자 띄움(옛 코드)','plan',s=>s.replace("  if(!user&&planEmbedded()){ planWaitParentUser(); return; }","")],
  ['창 안: 운영 로그인 안 이어받음','plan',s=>s.replace("    await updateCurrentUser(auth,pu);","    return false;")],
  ['창 안: 로그인 상자 CSS 되살림','plan',s=>s.replace("html.embed:not(.embed-dberr) #authgate .gbox{display:none}","")],
  ['운영: 모의 페이지에서도 미리 열기','idx',s=>s.replace("if(dgFrameEl||_dgPreloadTimer||!curUid||isPaperPage()) return;","if(dgFrameEl||_dgPreloadTimer||!curUid) return;")],
  ['운영: 미리 열기 안 부름','idx',s=>s.replace("      dgPreload();               // 듀얼가드 창을 뒤에서 미리 연다","      // dgPreload 없음")],
  ['다른 탭: 보고 있는 칩을 눌러도 설정 안 열림(옛 코드)','idx',s=>s.replace("if(chip){ const id=chip.getAttribute('data-sid'); if(String(tabBox().active)===String(id)) editSess(id); else switchSess(id); }","if(chip){switchSess(chip.getAttribute('data-sid'));}")],
  ['상태줄 배지 없음','plan',s=>s.replace("  if(sb)sb.innerHTML=o?(","  if(false)sb.innerHTML=o?(")],
  ['현재 투자중: 이름 칸 잠금(옛 코드)','plan',s=>s.replace("$('assetSessionName').disabled=false;$('assetSessionPaper').disabled=!x;","$('assetSessionName').disabled=!x;$('assetSessionPaper').disabled=!x;")],
  ['현재 투자중: 바꾼 이름을 원장 저장 전에 안 넣음','plan',s=>s.replace("      planCurName=String(x.name||'').trim()==='현재 투자중'?'':String(x.name||'').trim();","")],
  ['현재 투자중: 원장에 이름 안 적음','plan',s=>s.replace("  o.sessionName=String(planCurName||'').trim();","")],
  ['세션 줄: 첫 칩 이름 고정','plan',s=>s.replace("title=\"두 번 누르면 세션 설정\">'+q(planCurLabel())+(assetRulesOf(null)","title=\"두 번 누르면 세션 설정\">현재 투자중'+(assetRulesOf(null)")],
  ['포트폴리오: 현재 투자중 이름 무시','idx',s=>s.replace("name:String((o&&o.name)||(five&&five.sessionName)||'').trim()||'현재 투자중'","name:'현재 투자중'")],
  ['운영 세션 창: 막 연 창도 바깥 누름에 바로 닫힘(옛 코드)','idx',s=>s.replace("if(e.target===m && Date.now()-(m._openedAt||0)>450) m.classList.remove('on');","if(e.target===m) m.classList.remove('on');")],
  ['붙박이: 숨은 창에서도 높이 0 을 적음(옛 코드)','plan',s=>s.replace("if(!s1||!s2)return;   // 숨은 창","   // 숨은 창")],
  ['붙박이: 두 줄 크기가 바뀌어도 다시 안 잼','plan',s=>s.replace("dgStickyRO.observe(a);dgStickyRO.observe(b);","")],
  ['붙박이: 크기 감시를 안 붙임','plan',s=>s.replace("try{dgStickyWatch();}catch(e){}   // 세션 줄","// 세션 줄")],
  ['듀얼가드 세션 창: 막 연 창도 바깥 누름에 바로 닫힘','plan',s=>s.replace("if(e.target===$(\"assetSessionModal\")&&Date.now()-assetModalOpenedAt>450)closeAssetSessionModal();","if(e.target===$(\"assetSessionModal\"))closeAssetSessionModal();")],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 듀얼가드 탭 = 운영 탭: 한 번에 하나씩 전환(장부 섞임 없음) · 설정은 전환 뒤 · 끌어서 순서(숨긴 세션 제자리 · 실패 되돌림 · 합칠 때 순서) · 세션 줄 · 설정 두 갈래 · 창 안 로그인 이어받기 · 미리 열기 · 다른 탭 칩 · 배지');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS dg tab · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
