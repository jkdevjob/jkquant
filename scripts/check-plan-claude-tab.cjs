#!/usr/bin/env node
'use strict';
/* 자산플랜 v2.0.0 — 🤖 클로드 / ⚡ 지피티 탭 · 5년 '듀얼가드' 하나 (2026-11-08)
 * 사용자: "새규칙이 기존보다 낫지 않다면 버려 · 10. 15. 20년은 삭제하고 · 여기에도 클로드 버전과 지피티 버전으로 탭 만들자 ·
 *         넌 클로드 탭만 담당하고 현재 5년 플랜 전략 이름도 정하고".
 * 실제 파일(엔진 · 설정 모듈 · plan.html · index.html)의 함수를 그대로 돌려 값으로 확인하고,
 * 고친 곳을 옛 코드로 되돌린 변이가 빨간불인지 본다.
 *  A 엔진: 이름·판 · 규칙 하나 · 폐지 판정 · 폐지 기간·규칙 재생 거절 · 기본 규칙 결과는 옛 엔진과 글자까지 같음(기준값)
 *  B 설정 모듈: 무엇을 넘겨도 규칙은 base
 *  C plan.html: 기간 탭·규칙 선택 없음 · 클로드/지피티 탭 없음(2026-11-09 사용자: "듀얼가드 클로드 지피티는 탭 삭제해 너꺼 하나로 갈거야")
 *    · 화면 순서 · 폐지 세션 숨김(목록·선택·안내) · 딥링크
 *  D index.html: 모의 목록 이름 · 폐지 세션 빼기 · 캐시 판 · 엔진 판 같음
 *  (E 지피티 코드 경계 · F 지피티 저장 창구는 탭과 함께 2026-11-09 없앴다 — C2 가 '없음'을 본다)
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const SRC={eng:fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8'),set:fs.readFileSync(path.join(root,'plan-session-settings.js'),'utf8'),
  plan:fs.readFileSync(path.join(root,'plan.html'),'utf8'),idx:fs.readFileSync(path.join(root,'index.html'),'utf8'),
  gptFiles:fs.readdirSync(root).filter(f=>/^plan-gpt(?:-.+)?\.(?:js|css)$/.test(f))};   // 지피티 탭 파일 — 탭을 없앴으니 하나도 없어야 한다
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('함수 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const loadEngine=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};
const loadSettings=js=>{const m={exports:{}};vm.runInNewContext(js,{module:m,globalThis:{}});return m.exports;};
const fnv=s=>{let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}return h.toString(16);};

// ── 합성 시세(1,000 평일) — Guard −2% 구간 · TECL 고변동 구간 · 연말 급등 · SGOV 분배금. 기본 규칙의 모든 길(첫 진입·밴드·Guard 전환·월 투입)을 지난다.
const D=[];for(let t=new Date('2019-01-01T00:00:00Z');D.length<1000;t.setUTCDate(t.getUTCDate()+1)){const w=t.getUTCDay();if(w&&w<6)D.push(t.toISOString().slice(0,10));}
const START=300,DIP0=D.findIndex(d=>d>='2020-03-02'),DIP1=D.findIndex(d=>d>='2020-04-15'),RUN0=D.findIndex(d=>d>='2020-11-02'),Y21=D.findIndex(d=>d>='2021-01-01');
const tqqq=D.map((d,k)=>{let p=100*Math.pow(1.0002,k);if(k>=DIP0&&k<DIP1)p=102.2;else if(k>=DIP1&&k<RUN0)p=107;else if(k>=RUN0&&k<Y21)p=107*Math.pow(1.4,(k-RUN0+1)/(Y21-RUN0));else if(k>=Y21)p=107*1.4;return {date:d,close:p};});
const VOL0=D.findIndex(d=>d>='2020-06-01'),VOL1=D.findIndex(d=>d>='2020-07-15');
const tecl=[];{let p=50;for(let k=0;k<D.length;k++){const r=(k>=VOL0&&k<VOL1)?.0366:.02;if(k)p*=1+(k%2?r:-r/(1+r));tecl.push({date:D[k],close:p});}}
const sgov=D.map((d,k)=>({date:d,close:100*Math.pow(1.0001,k)})),sgovDiv=D.filter((d,k)=>k%21===5).map(d=>({date:d,amount:.35}));
const BASE={startDate:D[START],principal:100000,tecl,tqqq,sgov,sgovDiv};
/* 기준값 — 개편 전 엔진(main 0b2cb4c · plan-session-engine.js)으로 같은 자료를 돌린 결과. 개편 뒤에도 장부·평가액이 글자까지 같아야 한다. */
const GOLD={lump:{monthlyAdd:0,total:112072.65925706532,nTrade:8,ledger:'52510c9b',nav:'48ebfb5b'},
            monthly:{monthlyAdd:500,total:128292.50862924177,nTrade:82,ledger:'72bd28b2',nav:'50ed85a'}};

function el(extra={}){return Object.assign({hidden:false,dataset:{},tabIndex:0,attrs:{},_cls:new Set(),classList:{toggle(c,on){on?this.o._cls.add(c):this.o._cls.delete(c);},contains(c){return this.o._cls.has(c);}},setAttribute(k,v){this.attrs[k]=String(v);}},extra);}

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info?' · '+info:''));};
  const E=loadEngine(S.eng);
  // ── A. 엔진
  t('A1 전략 이름·판 — 듀얼가드 v1.0 · 클로드 담당',E.STRATEGY&&E.STRATEGY.name==='듀얼가드'&&E.STRATEGY.version==='1.0'&&E.STRATEGY.owner==='claude'&&/TECL 역분산 70%/.test(E.STRATEGY.summary),JSON.stringify(E.STRATEGY));
  t('A2 규칙은 base(공식) + panic(공포 모드 v1.1 · 실험적 확장 · 2026-11-10 승인 — 판정값은 base 와 같고 exp=true) — exp1·exp2·모르는 이름은 base',Object.keys(E.ALPHA_RULES).join()==='base,panic'&&E.alphaRules('panic').exp===true&&E.alphaRules('panic').guardOff===.01&&E.alphaRules('panic').bandUp===.10&&['exp1','exp2','zzz',undefined].every(k=>E.alphaRules(k).key==='base'&&E.alphaRules(k).exp===false)&&E.alphaRules('base').guardOff===.01&&E.alphaRules('base').bandUp===.10,Object.keys(E.ALPHA_RULES).join());
  const RR=x=>E.retiredReason(x);
  t('A3 폐지 판정 — 10·15·20년 · 새 규칙 · 공격형 / 5년 기본은 아님',
    RR({horizon:10})==='10년 추세+폭락매수'&&RR({horizon:15})==='15년 Shannon'&&RR({horizon:'20'})==='20년 듀얼모멘텀'&&RR({settings:{horizon:15}})==='15년 Shannon'
    &&RR({horizon:5,settings:{alphaRules:'exp1'}})==='새 규칙'&&RR({horizon:5,settings:{alphaRules:'exp2'}})==='공격형'&&RR({horizon:5,rules:'exp2'})==='공격형'
    &&RR({horizon:5,settings:{alphaRules:'base'}})===''&&RR({horizon:5})===''&&RR({})===''&&RR(null)==='',
    JSON.stringify([RR({horizon:10}),RR({horizon:5,settings:{alphaRules:'exp1'}}),RR({horizon:5})]));
  for(const o of [{horizon:10},{horizon:15},{horizon:20},{horizon:5,rules:'exp1'},{horizon:5,rules:'exp2'}]){
    const R=E.replay({...BASE,...o,monthlyAdd:0});
    t('A4 폐지 재생 거절 '+JSON.stringify(o),/^폐지된 세션 — /.test(R.error)&&R.stats===null&&R.nav.length===0&&R.ledger.events.length===0&&!!R.retired,R.error);
  }
  for(const [k,g] of Object.entries(GOLD)){
    const opt={...BASE,horizon:5,monthlyAdd:g.monthlyAdd},R=E.replay(opt),Rb=E.replay({...opt,rules:'base'}),Rn=E.replay({...opt,horizon:undefined});
    t('A5 기본 규칙 결과 = 개편 전 엔진('+k+' · 총액 '+g.total.toFixed(2)+' · 체결 '+g.nTrade+')',
      R.error===''&&R.stats.total===g.total&&R.stats.nTrade===g.nTrade&&fnv(JSON.stringify(R.ledger))===g.ledger&&fnv(JSON.stringify(R.nav))===g.nav,
      R.error+' '+(R.stats&&R.stats.total)+' '+(R.stats&&R.stats.nTrade)+' '+fnv(JSON.stringify(R.ledger))+' '+fnv(JSON.stringify(R.nav)));
    t('A5 '+k+' — rules 없음 = base = 기간 생략(5년)',JSON.stringify(R.ledger)===JSON.stringify(Rb.ledger)&&JSON.stringify(R.ledger)===JSON.stringify(Rn.ledger)&&R.rules==='base'&&R.horizon===5);
  }
  const dec=r=>E.alphaDecide({rules:r,w:.95,sleeveNow:1,teclQty:10,tqqqQty:10,tqqqClose:98,sma:100,tqqqWeight:.35,guardWeight:.30,yearStart:true});
  const d0=dec('base');
  t('A6 기본 판정 — TECL 5%p 많음 유지 · TQQQ −2% OFF 전환 · 1월 맞춤 없음',!d0.teclHit&&d0.guard==='OFF'&&d0.guardFlip&&!d0.tqReb&&Math.abs(d0.lower-99)<1e-9,JSON.stringify(d0));
  t('A6 예전 규칙 이름(exp1·exp2)을 넘겨도 판정은 기본과 같다',['exp1','exp2'].every(k=>JSON.stringify(dec(k))===JSON.stringify(d0)));
  t('A6 TECL 12%p 모자람 → 조정 · 첫 진입(0주) → 조정',E.alphaDecide({rules:'base',w:1,sleeveNow:.88,teclQty:10,tqqqQty:10,tqqqClose:100,sma:100}).teclHit&&E.alphaDecide({rules:'base',w:1,sleeveNow:0,teclQty:0,tqqqQty:0,tqqqClose:102,sma:100}).teclHit);
  t('A7 yearDoneAt: 12-31(목)→새해 · 12-30(수)→아님 · 12-29(금)→새해 · 06-30→아님',E.yearDoneAt('2026-12-31')&&!E.yearDoneAt('2026-12-30')&&E.yearDoneAt('2023-12-29')&&!E.yearDoneAt('2026-06-30'));

  // ── B. 설정 모듈
  const ST=loadSettings(S.set),opt={today:'2026-11-08',minStart:'2023-11-08',fx:1400};
  const seed={id:'s1',horizon:5,name:'a',paper:true,createdAt:1,settings:{startCapital:10000,monthlyAdd:0,targetCapital:50000,startDate:'2024-01-02',alphaRules:'exp1'},ledger:null};
  const inp={name:'모의',paper:true,capital:10000,monthly:0,target:50000,start:'2024-01-02'};
  const u=['exp1','exp2','base',undefined].map(r=>ST.update(seed,{...inp,rules:r},opt).settings.alphaRules);
  t('B1 설정 저장 — 무엇을 넘겨도(exp1·exp2·base·없음) 규칙은 base',u.every(x=>x==='base'),JSON.stringify(u));
  t('B2 다른 설정은 그대로',ST.update(seed,inp,opt).settings.startCapital===10000&&ST.update(seed,inp,opt).simStart==='2024-01-02');

  // ── C. plan.html
  const P=S.plan;
  t('C1 기간 탭·규칙 선택이 없다',!/data-horizon=/.test(P)&&!/id="horizonTabs"/.test(P)&&!/class="horizon-tab/.test(P)&&!/id="alphaRules"/.test(P)&&!/id="assetSessionRules/.test(P)&&!/function renderAlternativePlan/.test(P)&&!/function setHorizon/.test(P));
  const at=k=>P.indexOf(k);
  t('C2 클로드/지피티 탭 없음 — 탭·지피티 칸·plan-gpt.js·지피티 저장 창구 모두 없고 듀얼가드 화면 하나(세션 줄 → 상태줄 → 상세 탭 → 머리 카드 → 주문표 순 · 운영 탭과 같은 차례)',
    !/id="aiTabs"|class="ai-tab|data-ai=|id="pane-gpt"|id="pane-claude"|planGptRoot|plan-gpt\.js|PLANGPT_ACCOUNT|planGptAccount|function planAiTab|location\.hash==='#gpt'/.test(P)&&S.gptFiles.length===0
    &&at('id="assetSessionChips"')>0&&at('id="assetSessionChips"')<at('id="assetStatusline"')&&at('id="assetStatusline"')<at('id="assetDetailTabs"')&&at('id="assetDetailTabs"')<at('id="dgStrip"')
    &&at('id="dgStrip"')<at('id="alphaOrderSection"')&&at('id="alphaOrderSection"')<at('id="alphaStrategySection"')&&!/id="assetSessionCard"/.test(P),S.gptFiles.join());
  { // 폐지 세션 숨김 — 실제 assetSessionList · activeAssetSession · renderAssetSessions
    const L=[{id:'a',name:'기본 운영',horizon:5,paper:false,settings:{alphaRules:'base'}},{id:'b',name:'기본 모의',horizon:5,paper:true,simStart:'2025-01-02',settings:{}},
      {id:'h10',name:'10년 세션',horizon:10,paper:true,settings:{}},{id:'h15',name:'15년 세션',horizon:15,paper:false,settings:{}},{id:'h20',name:'20년 세션',horizon:20,paper:true,settings:{}},
      {id:'x1',name:'새 규칙 모의',horizon:5,paper:true,simStart:'2025-01-02',settings:{alphaRules:'exp1'}},{id:'x2',name:'공격형 모의',horizon:5,paper:true,simStart:'2025-01-02',settings:{alphaRules:'exp2'}}];
    const run=(active)=>{const box={sessions:JSON.parse(JSON.stringify(L)),activeByHorizon:{5:active}},V={assetSessionChips:{innerHTML:''},assetSessionState:{className:'',textContent:''}};
      const ctx=vm.createContext({window:{JKPlanSessionEngine:E},$:id=>V[id],assetPlanBox:()=>box,activeHorizon:5,dgDragEl:null,planCurName:'',planCurRules:'base',dgStickyOffsets(){} });
      for(const m of ['function planCurLabel()','function planStrategy()','function planStrategyLabel()','function assetRulesOf(x)','function renderPlanVersion()','function planStrategyLabelOf(x)','function planRetired(x)','function assetSessionList(h=activeHorizon)','function activeAssetSession()','function renderAssetSessions()'])vm.runInContext(fnOf(P,m),ctx);
      ctx.renderAssetSessions();return {list:ctx.assetSessionList().map(x=>x.id).join(),active:(ctx.activeAssetSession()||{}).id||'',chips:V.assetSessionChips.innerHTML,state:V.assetSessionState.textContent};};
    const r1=run('x1'),r2=run('b'),r3=run('h10');
    t('C4 세션 목록 — 5년 기본만(a·b) · 폐지 5개는 숨김(지우지 않음)',r1.list==='a,b',r1.list);
    t('C4 폐지 세션이 선택돼 있었으면 현재 투자중으로(x1·h10 → 없음) · 기본 모의는 그대로(b)',r1.active===''&&r3.active===''&&r2.active==='b',JSON.stringify([r1.active,r2.active,r3.active]));
    t('C5 칩에 폐지 세션 이름 없음 · 상태 줄에 "듀얼가드 v1.0" · 숨긴 수 5개 안내(운영 탭처럼 세션 이름 없이 전략 요약)',!/새 규칙 모의|공격형 모의|10년 세션|15년 세션|20년 세션/.test(r1.chips)&&/기본 운영/.test(r1.chips)&&/기본 모의/.test(r1.chips)
      &&r1.state==='듀얼가드 v1.0 · 숨긴 예전 세션 5개'&&r2.state==='듀얼가드 v1.0 · 모의 2025-01-02~ · 숨긴 예전 세션 5개',r1.state+' | '+r2.state);
  }
  t('C6 딥링크 — 5년 · 폐지 안 된 세션만 연다',/if\(q&&\+q\.horizon===5&&!planRetired\(q\)\)\{/.test(fnOf(P,'async function finishPlanOpen(user)')));
  t('C7 머리 카드 — 이름·판은 엔진 STRATEGY',/\$\("stageTitle"\)\.textContent=P\.name;renderPlanVersion\(\);/.test(fnOf(P,'function render()'))&&/if\(\$\('dgVer'\)\)\$\('dgVer'\)\.textContent=v;/.test(fnOf(P,'function renderPlanVersion()'))&&/id="stageTitle">듀얼가드<\/span><span class="dg-ver" id="dgVer">v1\.0<\/span>/.test(P));

  // ── D. index.html (모의 목록)
  const X=S.idx;
  { const opts=(st,win)=>{const ctx=vm.createContext({curOf:()=>'usd',wnCur:v=>v+'$',imRowsOf:()=>[],maCond:()=>({}),...(win?{window:win}:{})});vm.runInContext(fnOf(X,'function paperOpts(tab, st)'),ctx);return ctx.paperOpts('plan',st).join(' / ');};
    const a=opts({horizon:5,monthlyAdd:0},{JKPlanSessionEngine:E}),b=opts({horizon:5,monthlyAdd:70},{JKPlanSessionEngine:E}),c=opts({horizon:5,monthlyAdd:0},null);
    t('D1 모의 목록 설명 — "듀얼가드 v1.0"(\'5년\' 없음 · 2026-11-09 사용자: "5년이라는 말은 전부 지워") · 목돈/월 · 실험적 꼬리표 없음 · 엔진 없어도 같은 이름',a.startsWith('듀얼가드 v1.0')&&a.includes('목돈')&&b.includes('월')&&!/실험적|새 규칙|공격형|5년/.test(a+b+c)&&c.startsWith('듀얼가드 v1.0'),[a,b,c].join(' | ')); }
  /* 이름(2026-11-09 사용자: "듀얼 가드를 전부 듀얼가드로 바꾸고 5년이라는 말은 전부 지워") — 띄어 쓴 이름 없음 · 플랜 화면 글자(주석 뺀)에 '5년' 없음 ·
     원장 칸 이름 · 새 세션 기본 이름. 엔진 공용 주석(여러 파일이 같은 글자)은 화면에 안 보여 그대로 둔다. */
  { const code=x=>x.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"])\/\/[^\n]*/g,'$1').replace(/<!--[\s\S]*?-->/g,'');
    const left=(code(P).match(/[^\n]{0,30}(5년|5[ -]?YEAR)[^\n]{0,30}/gi)||[]);   // 영어 표기('5 YEAR' · '5-YEAR')도 — 2026-11-09 사용자 화면 '5 YEAR · DUAL GUARD'
    const leftPlan=((code(P)+'\n'+code(X)).match(/[^\n]{0,30}플랜[^\n]{0,30}/g)||[]);   // '플랜' → '듀얼가드'(2026-11-09 사용자: "이제 플랜이 아니야 듀얼이라고 해" · "어 전부 바꾸고")
    t('E1 이름: "듀얼가드"(띄어쓰기 없음 — 엔진·듀얼가드 화면·운영) · 듀얼가드 화면 글자에 "5년" 없음 · 화면 글자(주석 뺀 듀얼가드·운영)에 "플랜" 없음 · 원장 칸 이름 · 새 세션 기본 이름 · 엔진 폐지 안내',
      !/듀얼 가드/.test(S.eng+P+X)&&E.STRATEGY.name==='듀얼가드'&&!left.length&&!leftPlan.length&&/fiveYearPlanV2:'듀얼가드', fiveYearPlan:'듀얼가드\(옛\)'/.test(X)
      &&/\|\|'듀얼가드 세션';/.test(S.set)&&!/년 세션/.test(S.set)&&/error:'폐지된 세션 — '\+gone/.test(S.eng),JSON.stringify(left.concat(leftPlan))); }
  { const ctx=vm.createContext({window:{JKPlanSessionEngine:E}});vm.runInContext(fnOf(X,'function planPaperRetired(sess)'),ctx);
    const r=[{horizon:10},{horizon:5,settings:{alphaRules:'exp1'}},{horizon:5,settings:{alphaRules:'exp2'}},{horizon:5,settings:{alphaRules:'base'}},{horizon:5,settings:{}}].map(s=>ctx.planPaperRetired(s));
    t('D2 모의 목록 폐지 판정 = 엔진 retiredReason',JSON.stringify(r)==='[true,true,true,false,false]',JSON.stringify(r)); }
  { const fill=fnOf(X,'async function paperFillAll(opt)'),pre=fnOf(X,'async function paperPrefetchQuotes(opt)'),i=fill.indexOf("if(tab==='plan'){"),j=fill.indexOf('if(planPaperRetired(sess)){ _tick(); continue; }'),k=fill.indexOf('replayPlanPaper(sess)');
    t('D3 모의 목록 채우기 — 폐지 세션은 재생 전에 건너뜀 · 미리 받기도 남은 세션만',i>=0&&j>i&&k>j&&/if\(tab==='plan'\)\{ if\(!planPaperRetired\(sess\)\) \['TECL','TQQQ','SGOV'\]/.test(pre),[i,j,k].join()); }
  { const v=+((X.match(/const PAPER_VIEW_CACHE_VER=(\d+);/)||[])[1]),pv=(P.match(/plan-session-engine\.js\?v=(\d+)/)||[])[1],iv=(X.match(/plan-session-engine\.js\?v=(\d+)/)||[])[1];
    t('D4 지난 순위 캐시 판 ≥7 (폐지 세션 줄 · 옛 이름 글자 · ASAP 모의 줄 다시 셈) · 두 화면 엔진 판 같음(≥5)',v>=7&&pv===iv&&+pv>=5,JSON.stringify({v,pv,iv})); }

  return bad;
}

(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL plan claude tab:\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 듀얼가드 하나: 엔진(이름·규칙 하나·폐지 판정·재생 거절·기본 결과 = 개편 전) · 설정 · 클로드/지피티 탭 없음 · 폐지 세션 숨김 · 모의 목록');
  const MUT=[
    ['엔진: 새 규칙 벌 되살림','eng',s=>s.replace("  base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:0,exp:false},\n","  base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:0,exp:false},\n  exp1:{key:'exp1',name:'새 규칙 (실험적 확장)',guardOn:.01,guardOff:.03,bandDn:.01,bandUp:.15,tqReb:.02,exp:true},\n").replace("return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}","return ALPHA_RULES[k]||ALPHA_RULES.base;}")],
    ['엔진: 폐지 판정이 늘 빈칸','eng',s=>s.replace("function retiredReason(x){\n  if(!x)return '';","function retiredReason(x){\n  return '';")],
    ['엔진: 폐지 기간을 거절하지 않고 재생','eng',s=>s.replace("  if(gone)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'폐지된 세션 — '+gone,retired:gone};\n","")],
    ['엔진: 기본 규칙 Guard 끄기 −1% → −3%','eng',s=>s.replace("base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01","base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.03")],
    ['설정: 넘긴 규칙을 다시 저장','set',s=>s.replace("x.settings.alphaRules=input.rules==='panic'?'panic':'base';","if(input.rules!=null)x.settings.alphaRules=String(input.rules);")],
    ['플랜: 세션 목록이 폐지 세션도 보임','plan',s=>s.replace("sessions.filter(x=>x&&+x.horizon===+h&&!planRetired(x));}","sessions.filter(x=>x&&+x.horizon===+h);}")],
    ['플랜: 폐지 세션 선택이 살아남음','plan',s=>s.replace("x.id===id&&+x.horizon===+activeHorizon&&!planRetired(x))||null;","x.id===id&&+x.horizon===+activeHorizon)||null;")],
    ['플랜: 10년 탭 되살림','plan',s=>s.replace('  <div class="hero" id="dgHero"','  <button class="horizon-tab" data-horizon="10">10년</button>\n  <div class="hero" id="dgHero"')],
    ['플랜: 클로드/지피티 탭 되살림','plan',s=>s.replace('  <div class="hero" id="dgHero"','  <nav class="plan-tabs" id="aiTabs"><button class="ai-tab on" data-ai="claude">🤖 클로드</button><button class="ai-tab" data-ai="gpt">⚡ 지피티</button></nav>\n  <div class="hero" id="dgHero"')],
    ['플랜: 지피티 저장 창구 되살림','plan',s=>s.replace('onAuthStateChanged(auth,async user=>{','function setPlanGptAccount(user){window.PLANGPT_ACCOUNT=null;}\nonAuthStateChanged(auth,async user=>{')],
    ['플랜: 숨긴 세션 수 안내 없음','plan',s=>s.replace("tail=gone?' · 숨긴 예전 세션 '+gone+'개':''","tail=''")],
    ['모의 목록: 폐지 세션도 재생','idx',s=>s.replace("if(planPaperRetired(sess)){ _tick(); continue; }","")],
    ['모의 목록: 폐지 판정이 늘 아님','idx',s=>s.replace("function planPaperRetired(sess){const E=window.JKPlanSessionEngine;return !!(E&&E.retiredReason&&E.retiredReason(sess));}","function planPaperRetired(sess){return false;}")],
    ['모의 목록: 옛 이름(역분산+Guard)','idx',s=>s.replace("bits.push((PE&&PE.strategyLabel)?PE.strategyLabel(S0.alphaRules==='panic'?'panic':'base'):`${P.name} v${P.version}`);","bits.push('역분산+Guard');")],
    ['모의 목록: "5년" 되살림(옛 코드)','idx',s=>s.replace("bits.push((PE&&PE.strategyLabel)?PE.strategyLabel(S0.alphaRules==='panic'?'panic':'base'):`${P.name} v${P.version}`);","bits.push(`5년 ${P.name} v${P.version}`);")],
    ['플랜 화면: "5년" 글자 되살림','plan',s=>s.replace('<h2>6. 성장 시나리오</h2>','<h2>6. 5년 성장 시나리오</h2>')],
    ['엔진: 이름 띄어쓰기 되살림','eng',s=>s.replace("name:'듀얼가드',owner:'claude'","name:'듀얼 가드',owner:'claude'")],
    ['설정: 새 세션 기본 이름 "5년 세션"(옛 코드)','set',s=>s.replace("||'듀얼가드 세션';","||x.horizon+'년 세션';")],
    ['듀얼가드 화면: "플랜" 글자 되살림','plan',s=>s.replace('<label>듀얼가드 시작일</label>','<label>플랜 시작일</label>')],
    ['듀얼가드 화면: 머리글 "5 YEAR" 되살림(옛 코드)','plan',s=>s.replace("$('alphaHorizonEyebrow').textContent='DUAL GUARD · '+v;","$('alphaHorizonEyebrow').textContent='5 YEAR · DUAL GUARD · '+v;")],
    ['운영: "플랜" 글자 되살림','idx',s=>s.replace("듀얼가드 시작잔고에 평단을 넣으세요","플랜 시작잔고에 평단을 넣으세요")],   // 포트폴리오 연말 세금 점검 안내(2026-11-11 · 옛 대상 글자는 그 칸과 함께 바뀜)
    ['모의 목록 캐시 판: 옛 판(ASAP 줄 · 옛 이름 글자 그대로)','idx',s=>s.replace('const PAPER_VIEW_CACHE_VER=8;','const PAPER_VIEW_CACHE_VER=6;')],
    ['엔진: 폐지 안내 "폐지된 플랜"(옛 글자)','eng',s=>s.replace("error:'폐지된 세션 — '+gone","error:'폐지된 플랜 — '+gone")],
  ];
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert(m!==SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS plan claude tab · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e&&e.stack||e);process.exit(1);});
