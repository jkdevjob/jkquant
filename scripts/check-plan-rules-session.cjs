#!/usr/bin/env node
'use strict';
/* 자산플랜 세션 설정의 '5년 규칙' 선택 (plan 1.45.0 · 2026-11-07)
 * 사용자: "자산플랜 세션 설정에서 선택할 수 있게 하라고 — 그래서 모의투자로 비교해보게".
 * 규칙 벌(base 기본 · exp1 새 규칙 실험적 확장)은 세션마다 settings.alphaRules 로 저장되고, 모의 재생·화면 판정·세션 칩·모의투자 목록이 그 값을 쓴다.
 * 실제 파일(plan-session-settings.js · plan.html · index.html)의 함수를 그대로 돌려 값으로 확인하고, 되돌린 변이가 빨간불인지 본다.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const SRC={set:fs.readFileSync(path.join(root,'plan-session-settings.js'),'utf8'),plan:fs.readFileSync(path.join(root,'plan.html'),'utf8'),idx:fs.readFileSync(path.join(root,'index.html'),'utf8')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);assert(s>=0,'함수 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const loadSettings=js=>{const m={exports:{}};vm.runInNewContext(js,{module:m});return m.exports;};
const els=map=>Object.fromEntries(Object.entries(map).map(([k,v])=>[k,typeof v==='object'&&v!==null?v:{value:v}]));

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  // ── F. 설정 모듈: rules → settings.alphaRules
  const E=loadSettings(S.set),opt={today:'2026-11-06',minStart:'2023-11-06',fx:1350};
  const seed={id:'s1',horizon:5,name:'a',paper:true,createdAt:1,settings:{startCapital:10000,monthlyAdd:0,targetCapital:50000,startDate:'2024-01-02'},ledger:null};
  const inp={name:'새 규칙 모의',paper:true,capital:10000,monthly:0,target:50000,start:'2024-01-02'};
  const a=E.update(seed,{...inp,rules:'exp1'},opt),b=E.update(seed,{...inp,rules:'base'},opt),c=E.update(seed,{...inp,rules:'zzz'},opt),d=E.update(a,inp,opt),e=E.update(seed,inp,opt);
  t('F1 update: rules exp1 → settings.alphaRules exp1',a.settings.alphaRules==='exp1',JSON.stringify(a.settings));
  t('F2 update: base → base · 모르는 값 → base',b.settings.alphaRules==='base'&&c.settings.alphaRules==='base');
  t('F3 update: rules 안 주면 기존 값 그대로(exp1 유지) · 없던 세션엔 안 생김',d.settings.alphaRules==='exp1'&&!('alphaRules' in e.settings));
  t('F4 update: 다른 설정은 그대로',a.settings.startCapital===10000&&a.simStart==='2024-01-02'&&a.paper===true&&a.name==='새 규칙 모의');
  // ── G. plan.html
  t('G1 세션 모달에 5년 규칙 선택(base · exp1)',/id="assetSessionRules"[^>]*>[\s\S]*?value="base"[\s\S]*?value="exp1"/.test(S.plan)&&S.plan.includes('id="assetSessionRulesWrap"'));
  // G2 실제 createAssetSession: 모달 값이 세션에 저장된다(5년) · 10년은 규칙 없음 · 수정도 반영
  const run=async(horizon,rules,editId,box)=>{
    const V=els({assetSessionKind:'paper',assetSessionName:'모의',assetSessionCapital:'10000',assetSessionMonthly:'0',assetSessionTarget:'50000',assetSessionStart:'2024-01-02',assetSessionRules:rules,assetSessionModal:{hidden:false},assetSessionCreate:{disabled:false}});
    let saves=0;const ctx=vm.createContext({console,window:{JKPlanSessionSettings:E},$:id=>V[id],ensureLiveBoxes(){},assetPlanBox:()=>box,confirm:()=>true,alert:m=>{throw Error(m);},assetFxAt:async()=>1350,todayISO:()=>opt.today,
      assetSessionSettingsFromView:()=>({startCapital:10000,monthlyAdd:0,targetCapital:50000,startDate:'2024-01-02',engine:'asset-plan-v2'}),saveOperatingState:async()=>saves++,renderAssetSessions(){},loadActiveAssetSessionView:async()=>{},planSid:()=>'n'+(box.sessions.length+1)});
    vm.runInContext(`let assetSessionSaving=false,assetModalRevision=1,assetModalHorizon=${horizon},activeHorizon=${horizon},assetEditingId=${JSON.stringify(editId)},assetViewRevision=0;const assetPaperCache={};`+fnOf(S.plan,'function closeAssetSessionModal()')+fnOf(S.plan,'async function createAssetSession()'),ctx);
    await ctx.createAssetSession();return saves;};
  const box={sessions:[],activeByHorizon:{}};
  const p=(async()=>{
    await run(5,'exp1',null,box);await run(5,'base',null,box);await run(10,'exp1',null,box);
    t('G2 createAssetSession: 5년 모의 세션 둘(exp1 · base) · 10년은 규칙 없음',box.sessions.length===3&&box.sessions[0].settings.alphaRules==='exp1'&&box.sessions[1].settings.alphaRules==='base'&&!('alphaRules' in box.sessions[2].settings),JSON.stringify(box.sessions.map(x=>x.settings.alphaRules)));
    await run(5,'base',box.sessions[0].id,box);
    t('G2b 세션 수정으로 exp1 → base',box.sessions.length===3&&box.sessions[0].settings.alphaRules==='base');
  })();
  // G3 assetSessionSettingsFromView: 5년이면 화면 선택값, 그 밖엔 없음
  const view=(horizon,key)=>{const V=els({startCapital:'20000',targetCapital:'150000',monthlyAdd:'0',targetIncome:'0',stageMode:'auto',startDate:'2024-01-02',targetDate:'2029-01-02'});
    const ctx=vm.createContext({$:id=>V[id],activeHorizon:horizon,alphaRuleSet:()=>({key}),todayISO:()=>opt.today,plusYears:(s,n)=>s});
    vm.runInContext("const num=(id,fallback=0)=>{const v=Number($(id).value);return Number.isFinite(v)?v:fallback};"+fnOf(S.plan,'function assetSessionSettingsFromView('),ctx);return ctx.assetSessionSettingsFromView();};
  t('G3 settingsFromView: 5년 → alphaRules = 화면 선택 · 10년 → 없음',view(5,'exp1').alphaRules==='exp1'&&view(5,'base').alphaRules==='base'&&!('alphaRules' in view(10,'exp1')));
  // G4 applyAssetSettings: 세션 규칙이 화면 선택으로
  const apply=st=>{const V=els({startCapital:'',targetCapital:'',monthlyAdd:'',targetIncome:'',stageMode:'',startDate:'',targetDate:'',alphaRules:'exp1'});
    const ctx=vm.createContext({$:id=>V[id],activeHorizon:5,todayISO:()=>opt.today,plusYears:(s,n)=>s});vm.runInContext(fnOf(S.plan,'function applyAssetSettings('),ctx);ctx.applyAssetSettings({paper:false,settings:st});return V.alphaRules.value;};
  t('G4 applyAssetSettings: exp1 세션 → 화면 exp1 · 규칙 없는 세션 → base',apply({alphaRules:'exp1',startDate:'2024-01-02'})==='exp1'&&apply({startDate:'2024-01-02'})==='base');
  // G5 세션 칩·상태 줄
  const chips=(list,active)=>{const V=els({assetSessionChips:{innerHTML:''},assetSessionState:{className:'',textContent:''}});
    const ctx=vm.createContext({$:id=>V[id],assetPlanBox:()=>({sessions:list}),assetSessionList:()=>list,activeAssetSession:()=>active,horizonStrategy:()=>({name:'역분산+Guard'})});
    vm.runInContext(fnOf(S.plan,'function assetRuleTag(')+fnOf(S.plan,'function renderAssetSessions()'),ctx);ctx.renderAssetSessions();return V;};
  const L=[{id:'x1',horizon:5,name:'새',paper:true,simStart:'2024-01-02',settings:{alphaRules:'exp1'}},{id:'x2',horizon:5,name:'기본',paper:true,simStart:'2024-01-02',settings:{alphaRules:'base'}}];
  const v1=chips(L,L[0]),v2=chips(L,L[1]);
  t('G5 세션 칩: exp1 세션에만 "새 규칙" 꼬리표 · 상태 줄에 규칙',(v1.assetSessionChips.innerHTML.match(/새 규칙/g)||[]).length===1&&v1.assetSessionChips.innerHTML.indexOf('새 규칙')<v1.assetSessionChips.innerHTML.indexOf('기본')&&v1.assetSessionState.textContent.includes('새 규칙(실험적 확장)')&&!v2.assetSessionState.textContent.includes('새 규칙'));
  // G6 모의 결과 머리에 규칙
  const stats=rules=>{const ctx=vm.createContext({usd2:v=>String(v)});vm.runInContext(fnOf(S.plan,'function assetPaperStatsHtml('),ctx);return ctx.assetPaperStatsHtml({name:'n'},{rules,orderSizingVersion:2,stats:{from:'2024-01-02',to:'2026-11-05',ret:1,mdd:1,cagr:1,total:1}});};
  t('G6 모의 결과 머리: 규칙 표시',stats('exp1').includes('새 규칙(실험적 확장)')&&stats('base').includes('기본 규칙')&&!stats('base').includes('새 규칙'));
  // G7 재생이 세션 규칙을 넘긴다
  t('G7 모의 재생 replay 에 rules:(x.settings&&x.settings.alphaRules)',S.plan.includes("rules:(x.settings&&x.settings.alphaRules)||'base'"));
  // ── H. index.html 모의투자 목록
  const opts=st=>{const ctx=vm.createContext({curOf:()=>'usd',wnCur:v=>v+'$',imRowsOf:()=>[],maCond:()=>({})});vm.runInContext(fnOf(S.idx,'function paperOpts(tab, st)'),ctx);return ctx.paperOpts('plan',st);};
  t('H1 모의투자 목록: 5년 exp1 세션에 "새 규칙(실험적)" · base·10년은 없음',opts({horizon:5,alphaRules:'exp1'}).includes('새 규칙(실험적)')&&!opts({horizon:5,alphaRules:'base'}).some(x=>x.includes('새 규칙'))&&!opts({horizon:10,alphaRules:'exp1'}).some(x=>x.includes('새 규칙')),JSON.stringify(opts({horizon:5,alphaRules:'exp1'})));
  t('H2 모의투자 재생 replayPlanPaper 에 rules:sess.settings.alphaRules',S.idx.includes("rules:sess.settings.alphaRules||'base'"));
  return p.then(()=>bad);
}

(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 세션 설정 5년 규칙: update rules 4 · 모달 저장(5년 exp1/base · 10년 없음 · 수정) · settingsFromView · applyAssetSettings · 칩/상태 · 모의 결과 머리 · 모의투자 목록');
  // ── 변이: 고친 곳을 되돌리면 빨간불
  const MUT=[
    ['설정 모듈이 rules 를 저장하지 않음','set',s=>s.replace("if(input.rules!=null)x.settings.alphaRules=String(input.rules)==='exp1'?'exp1':'base';","")],
    ['모달 저장이 rules 를 넘기지 않음','plan',s=>s.replace("rules:(+assetModalHorizon===5&&$('assetSessionRules'))?$('assetSessionRules').value:undefined","rules:undefined")],
    ['화면 설정 → 세션 설정에 규칙 없음','plan',s=>s.replace("...(+activeHorizon===5?{alphaRules:alphaRuleSet().key}:{})","...{}")],
    ['세션 규칙이 화면 선택에 반영되지 않음','plan',s=>s.replace("if($('alphaRules'))$('alphaRules').value=st.alphaRules==='exp1'?'exp1':'base';","")],
    ['모의투자 목록에 규칙 표시 없음','idx',s=>s.replace("if(y===5&&S0.alphaRules==='exp1')bits.push('새 규칙(실험적)');","")],
  ];
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert(m!==SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    console.log('PASS 변이 빨간불: '+name);
  }
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1);});
