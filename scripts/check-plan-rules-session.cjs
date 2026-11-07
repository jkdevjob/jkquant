#!/usr/bin/env node
'use strict';
/* 자산플랜 세션 설정의 '5년 규칙' 선택 (plan 1.45.0 · 2026-11-07) + 공격형 exp2 (plan 1.46.0)
 * 사용자: "자산플랜 세션 설정에서 선택할 수 있게 하라고 — 그래서 모의투자로 비교해보게" · "오로지 돈을 빨리 많이".
 * 규칙 벌(base 기본 · exp1 새 규칙 · exp2 공격형 = 새 규칙 + TECL 목표 변동성 .60 — 둘 다 실험적 확장)은 세션마다 settings.alphaRules 로 저장되고,
 * 모의 재생·화면 판정·세션 칩·모의투자 목록이 그 값을 쓴다. 실제 파일의 함수를 그대로 돌려 값으로 확인하고, 되돌린 변이가 빨간불인지 본다.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const SRC={set:fs.readFileSync(path.join(root,'plan-session-settings.js'),'utf8'),plan:fs.readFileSync(path.join(root,'plan.html'),'utf8'),idx:fs.readFileSync(path.join(root,'index.html'),'utf8'),eng:fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);assert(s>=0,'함수 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const loadSettings=js=>{const m={exports:{}};vm.runInNewContext(js,{module:m});return m.exports;};
const loadEngine=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};
const els=map=>Object.fromEntries(Object.entries(map).map(([k,v])=>[k,typeof v==='object'&&v!==null?v:{value:v}]));
const HELPERS=S=>fnOf(S.plan,'function alphaRuleKey(')+fnOf(S.plan,'function assetRuleName(');   // 규칙 이름 도우미(엔진이 있으면 엔진 이름)

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  const ENG=loadEngine(S.eng);
  // ── F. 설정 모듈: rules → settings.alphaRules
  const E=loadSettings(S.set),opt={today:'2026-11-06',minStart:'2023-11-06',fx:1350};
  const seed={id:'s1',horizon:5,name:'a',paper:true,createdAt:1,settings:{startCapital:10000,monthlyAdd:0,targetCapital:50000,startDate:'2024-01-02'},ledger:null};
  const inp={name:'새 규칙 모의',paper:true,capital:10000,monthly:0,target:50000,start:'2024-01-02'};
  const a=E.update(seed,{...inp,rules:'exp1'},opt),a2=E.update(seed,{...inp,rules:'exp2'},opt),b=E.update(seed,{...inp,rules:'base'},opt),c=E.update(seed,{...inp,rules:'zzz'},opt),d=E.update(a,inp,opt),e=E.update(seed,inp,opt);
  t('F1 update: rules exp1 → exp1 · exp2 → exp2',a.settings.alphaRules==='exp1'&&a2.settings.alphaRules==='exp2',JSON.stringify([a.settings.alphaRules,a2.settings.alphaRules]));
  t('F2 update: base → base · 모르는 값 → base',b.settings.alphaRules==='base'&&c.settings.alphaRules==='base');
  t('F3 update: rules 안 주면 기존 값 그대로(exp1 유지) · 없던 세션엔 안 생김',d.settings.alphaRules==='exp1'&&!('alphaRules' in e.settings));
  t('F4 update: 다른 설정은 그대로',a.settings.startCapital===10000&&a.simStart==='2024-01-02'&&a.paper===true&&a.name==='새 규칙 모의');
  // ── G. plan.html
  t('G1 세션 모달·화면 선택에 base · exp1 · exp2',/id="assetSessionRules"[^>]*>[\s\S]*?value="base"[\s\S]*?value="exp1"[\s\S]*?value="exp2"/.test(S.plan)&&/id="alphaRules">[\s\S]*?value="base"[\s\S]*?value="exp1"[\s\S]*?value="exp2"/.test(S.plan)&&S.plan.includes('id="assetSessionRulesWrap"'));
  const run=async(horizon,rules,editId,box)=>{
    const V=els({assetSessionKind:'paper',assetSessionName:'모의',assetSessionCapital:'10000',assetSessionMonthly:'0',assetSessionTarget:'50000',assetSessionStart:'2024-01-02',assetSessionRules:rules,assetSessionModal:{hidden:false},assetSessionCreate:{disabled:false}});
    let saves=0;const ctx=vm.createContext({console,window:{JKPlanSessionSettings:E},$:id=>V[id],ensureLiveBoxes(){},assetPlanBox:()=>box,confirm:()=>true,alert:m=>{throw Error(m);},assetFxAt:async()=>1350,todayISO:()=>opt.today,
      assetSessionSettingsFromView:()=>({startCapital:10000,monthlyAdd:0,targetCapital:50000,startDate:'2024-01-02',engine:'asset-plan-v2'}),saveOperatingState:async()=>saves++,renderAssetSessions(){},loadActiveAssetSessionView:async()=>{},planSid:()=>'n'+(box.sessions.length+1)});
    vm.runInContext(`let assetSessionSaving=false,assetModalRevision=1,assetModalHorizon=${horizon},activeHorizon=${horizon},assetEditingId=${JSON.stringify(editId)},assetViewRevision=0;const assetPaperCache={};`+fnOf(S.plan,'function closeAssetSessionModal()')+fnOf(S.plan,'async function createAssetSession()'),ctx);
    await ctx.createAssetSession();return saves;};
  const box={sessions:[],activeByHorizon:{}};
  const p=(async()=>{
    await run(5,'exp1',null,box);await run(5,'base',null,box);await run(10,'exp1',null,box);await run(5,'exp2',null,box);
    t('G2 createAssetSession: 5년 모의 세션(exp1 · base · exp2) · 10년은 규칙 없음',box.sessions.length===4&&box.sessions[0].settings.alphaRules==='exp1'&&box.sessions[1].settings.alphaRules==='base'&&!('alphaRules' in box.sessions[2].settings)&&box.sessions[3].settings.alphaRules==='exp2',JSON.stringify(box.sessions.map(x=>x.settings.alphaRules)));
    await run(5,'base',box.sessions[0].id,box);
    t('G2b 세션 수정으로 exp1 → base',box.sessions.length===4&&box.sessions[0].settings.alphaRules==='base');
  })();
  const view=(horizon,key)=>{const V=els({startCapital:'20000',targetCapital:'150000',monthlyAdd:'0',targetIncome:'0',stageMode:'auto',startDate:'2024-01-02',targetDate:'2029-01-02'});
    const ctx=vm.createContext({$:id=>V[id],activeHorizon:horizon,alphaRuleSet:()=>({key}),todayISO:()=>opt.today,plusYears:(s,n)=>s});
    vm.runInContext("const num=(id,fallback=0)=>{const v=Number($(id).value);return Number.isFinite(v)?v:fallback};"+fnOf(S.plan,'function assetSessionSettingsFromView('),ctx);return ctx.assetSessionSettingsFromView();};
  t('G3 settingsFromView: 5년 → alphaRules = 화면 선택 · 10년 → 없음',view(5,'exp1').alphaRules==='exp1'&&view(5,'exp2').alphaRules==='exp2'&&view(5,'base').alphaRules==='base'&&!('alphaRules' in view(10,'exp1')));
  const apply=st=>{const V=els({startCapital:'',targetCapital:'',monthlyAdd:'',targetIncome:'',stageMode:'',startDate:'',targetDate:'',alphaRules:'exp1'});
    const ctx=vm.createContext({$:id=>V[id],activeHorizon:5,todayISO:()=>opt.today,plusYears:(s,n)=>s,window:{JKPlanSessionEngine:ENG}});vm.runInContext(HELPERS(S)+fnOf(S.plan,'function applyAssetSettings('),ctx);ctx.applyAssetSettings({paper:false,settings:st});return V.alphaRules.value;};
  t('G4 applyAssetSettings: exp1/exp2 세션 → 화면 같은 값 · 규칙 없거나 모르는 세션 → base',apply({alphaRules:'exp1',startDate:'2024-01-02'})==='exp1'&&apply({alphaRules:'exp2',startDate:'2024-01-02'})==='exp2'&&apply({startDate:'2024-01-02'})==='base'&&apply({alphaRules:'zzz',startDate:'2024-01-02'})==='base');
  const chips=(list,active)=>{const V=els({assetSessionChips:{innerHTML:''},assetSessionState:{className:'',textContent:''}});
    const ctx=vm.createContext({$:id=>V[id],window:{JKPlanSessionEngine:ENG},assetPlanBox:()=>({sessions:list}),assetSessionList:()=>list,activeAssetSession:()=>active,horizonStrategy:()=>({name:'역분산+Guard'})});
    vm.runInContext(HELPERS(S)+fnOf(S.plan,'function assetRuleTag(')+fnOf(S.plan,'function renderAssetSessions()'),ctx);ctx.renderAssetSessions();return V;};
  const L=[{id:'x1',horizon:5,name:'새',paper:true,simStart:'2024-01-02',settings:{alphaRules:'exp1'}},{id:'x2',horizon:5,name:'기본',paper:true,simStart:'2024-01-02',settings:{alphaRules:'base'}},{id:'x3',horizon:5,name:'공격',paper:true,simStart:'2024-01-02',settings:{alphaRules:'exp2'}}];
  const v1=chips(L,L[0]),v2=chips(L,L[1]),v3=chips(L,L[2]);
  t('G5 세션 칩: exp1 "새 규칙" · exp2 "공격형" 꼬리표 한 번씩 · 상태 줄에 규칙',(v1.assetSessionChips.innerHTML.match(/새 규칙/g)||[]).length===1&&(v1.assetSessionChips.innerHTML.match(/공격형/g)||[]).length===1&&v1.assetSessionState.textContent.includes('새 규칙(실험적 확장)')&&!v2.assetSessionState.textContent.includes('실험적')&&v3.assetSessionState.textContent.includes('공격형(실험적 확장)'),v1.assetSessionChips.innerHTML.slice(0,200));
  const stats=rules=>{const ctx=vm.createContext({usd2:v=>String(v),window:{JKPlanSessionEngine:ENG}});vm.runInContext(HELPERS(S)+fnOf(S.plan,'function assetPaperStatsHtml('),ctx);return ctx.assetPaperStatsHtml({name:'n'},{rules,orderSizingVersion:2,stats:{from:'2024-01-02',to:'2026-11-05',ret:1,mdd:1,cagr:1,total:1}});};
  t('G6 모의 결과 머리: 규칙 표시(exp1 새 규칙 · exp2 공격형 · base 기본)',stats('exp1').includes('새 규칙(실험적 확장)')&&stats('exp2').includes('공격형(실험적 확장)')&&stats('base').includes('기본 규칙')&&!stats('base').includes('실험적'));
  t('G7 모의 재생 replay 에 rules:(x.settings&&x.settings.alphaRules)',S.plan.includes("rules:(x.settings&&x.settings.alphaRules)||'base'"));
  // 화면 판정의 TECL 목표 변동성이 규칙 벌을 따른다(공격형 .60)
  const s0pct=key=>{const ctx=vm.createContext({window:{JKPlanSessionEngine:ENG},$:()=>({value:key}),PATH_DEFAULTS:{alpha:{ivsS0:.55}}});vm.runInContext(fnOf(S.plan,'function alphaRuleSet()')+fnOf(S.plan,'function alphaS0Pct()'),ctx);return ctx.alphaS0Pct();};
  t('G8 화면 s0: base·exp1 55% · exp2 60%',s0pct('base')==='55'&&s0pct('exp1')==='55'&&s0pct('exp2')==='60',JSON.stringify([s0pct('base'),s0pct('exp1'),s0pct('exp2')]));
  t('G9 renderAlphaPlan 의 w 가 규칙 벌 s0 로',S.plan.includes("S0=AR.s0??D.ivsS0,w=Math.min(1,(S0*S0)/(sigma*sigma))")&&S.plan.includes("alphaWeightHistory(tr,D,60,S0)"));
  // ── H. index.html 모의투자 목록
  const opts=st=>{const ctx=vm.createContext({curOf:()=>'usd',wnCur:v=>v+'$',imRowsOf:()=>[],maCond:()=>({})});vm.runInContext(fnOf(S.idx,'function paperOpts(tab, st)'),ctx);return ctx.paperOpts('plan',st);};
  t('H1 모의투자 목록: exp1 "새 규칙(실험적)" · exp2 "공격형(실험적)" · base·10년은 없음',opts({horizon:5,alphaRules:'exp1'}).includes('새 규칙(실험적)')&&opts({horizon:5,alphaRules:'exp2'}).includes('공격형(실험적)')&&!opts({horizon:5,alphaRules:'base'}).some(x=>x.includes('실험적'))&&!opts({horizon:10,alphaRules:'exp2'}).some(x=>x.includes('실험적')),JSON.stringify(opts({horizon:5,alphaRules:'exp2'})));
  t('H2 모의투자 재생 replayPlanPaper 에 rules:sess.settings.alphaRules',S.idx.includes("rules:sess.settings.alphaRules||'base'"));
  return p.then(()=>bad);
}

(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 세션 설정 5년 규칙: update rules(exp1·exp2·base·모름) · 모달 저장(5년 exp1/base/exp2 · 10년 없음 · 수정) · settingsFromView · applyAssetSettings · 칩/상태 · 모의 결과 머리 · 화면 s0 · 모의투자 목록');
  const MUT=[
    ['설정 모듈이 rules 를 저장하지 않음','set',s=>s.replace("if(input.rules!=null){const rk=String(input.rules);x.settings.alphaRules=(rk==='exp1'||rk==='exp2')?rk:'base';}","")],
    ['설정 모듈이 exp2 를 거부(옛 판)','set',s=>s.replace("(rk==='exp1'||rk==='exp2')?rk:'base'","(rk==='exp1')?rk:'base'")],
    ['모달 저장이 rules 를 넘기지 않음','plan',s=>s.replace("rules:(+assetModalHorizon===5&&$('assetSessionRules'))?$('assetSessionRules').value:undefined","rules:undefined")],
    ['화면 설정 → 세션 설정에 규칙 없음','plan',s=>s.replace("...(+activeHorizon===5?{alphaRules:alphaRuleSet().key}:{})","...{}")],
    ['세션 규칙이 화면 선택에 반영되지 않음','plan',s=>s.replace("if($('alphaRules'))$('alphaRules').value=alphaRuleKey(st.alphaRules);","")],
    ['화면 판정 s0 가 규칙 벌을 안 따름(늘 .55)','plan',s=>s.replace("function alphaS0Pct(){return ((alphaRuleSet().s0??PATH_DEFAULTS.alpha.ivsS0)*100).toFixed(0);}","function alphaS0Pct(){return (PATH_DEFAULTS.alpha.ivsS0*100).toFixed(0);}")],
    ['모의투자 목록에 규칙 표시 없음','idx',s=>s.replace("if(y===5&&S0.alphaRules&&S0.alphaRules!=='base')bits.push(S0.alphaRules==='exp2'?'공격형(실험적)':'새 규칙(실험적)');","")],
    ['엔진에 공격형 벌이 없음','eng',s=>s.replace(/\n  exp2:\{[^\n]*\n/,"\n")],
  ];
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert(m!==SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    console.log('PASS 변이 빨간불: '+name);
  }
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1);});
