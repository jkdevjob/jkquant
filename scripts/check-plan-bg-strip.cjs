#!/usr/bin/env node
'use strict';
/* 포트폴리오 '오늘' 칸 = 포트폴리오 실계좌 세션의 오늘 판단 (듀얼가드 plan v2.12.1 · 운영 v3.133.1 · 2026-11-11)
 * 사용자: "이거 이상한데 왜 운영에서 선택한 탭이 보이지? 운영에서 포트폴리오로 선택한 세션이 보여야지?"
 *   — 운영 › 듀얼가드 탭이 모의 세션을 보고 있으면 포트폴리오 '오늘' 칸에 '토스'(실계좌)의 판단이 안 왔다(그 창이 보는 세션만 셌다).
 * 고침: renderAlphaPlan 에 bg(화면 밖) 모드 — 계산 줄은 그대로 두고 화면에 쓰는 줄만 V 로 막았다. planPortfolioStrips 가 포트폴리오 세션마다
 *   그 세션 보유 · 시작자산 · 입금 · 공포 모드 문맥으로 돌려 바깥(index)에 bg:true 로 보낸다.
 * 실제 주문 경로(오늘 주문표)를 건드린 변경이라 큰 절차(감사 문서 장 · 고친 곳 전부 변이)로 확인한다:
 *   A 옛 함수(고치기 전 원문 · scripts/fixtures/renderAlphaPlan-plan-2.12.0.js) vs 새 함수(화면 모드) — 무작위 장면 400개에서 화면 글자 · 주문표 · 띠 · 부수효과가 한 글자도 같다
 *   B 새 함수 bg 모드 = 같은 보유를 화면에 올렸을 때의 띠(같은 장면 400개) · bg 는 화면 · 주문표 · 기록 창 · 기간 맞춤 표시를 안 건드린다 · 판정 불가는 {hold}
 *   C planBgTargets — 보고 있는 세션은 빼고 '현재 투자중'(DB 원장) + 포트폴리오에 넣은 실계좌 세션 · 보유 = 엔진 ledgerCalc(화면과 같은 반올림) · 공포 모드는 그 세션 시작일
 *   D planPortfolioStrips — 창 안에서만 · 로그인 · bg:true · paper:false · 세션 키 · 보류도 보냄 · planLivePanic 시작일 덮어쓰기
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const SRC={plan:fs.readFileSync(path.join(root,'plan.html'),'utf8'),eng:fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8'),
  old:fs.readFileSync(path.join(__dirname,'fixtures','renderAlphaPlan-plan-2.12.0.js'),'utf8')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('함수 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const constOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('상수 없음: '+marker);const e=src.indexOf(';',s);return src.slice(s,e+1);};
const lineOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('줄 없음: '+marker);return src.slice(s,src.indexOf('\n',s))+'\n';};
const NEW_SIG='function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)',OLD_SIG='function renderAlphaPlan(qTecl,qTqqq,qSgov)';

/* 결정적 난수(장면 재현) */
function rng(seed){let x=seed>>>0||1;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}
/* 평일 300일 · 세 종목 시세(마지막 날 = 확정 · 현재가는 조금 다름) */
function market(r){
  const D=[];for(let t=new Date('2025-06-02T00:00:00Z');D.length<300;t.setUTCDate(t.getUTCDate()+1)){const w=t.getUTCDay();if(w&&w<6)D.push(t.toISOString().slice(0,10));}
  const walk=(p0,vol,drift)=>{let p=p0;return D.map(()=>{p*=1+drift+(r()-.5)*2*vol;return Math.max(1,+p.toFixed(4));});};
  const T=walk(40+r()*80,.02+r()*.06,(r()-.45)*.004),Q=walk(30+r()*70,.015+r()*.05,(r()-.45)*.004),G=walk(100,.0004,.00012);
  const q=(c,ip)=>({rows:D.map((date,i)=>({date,close:c[i]})),settled:{date:D[D.length-1],close:c[c.length-1]},price:ip?+(c[c.length-1]*(1+(r()-.5)*.04)).toFixed(4):0});
  return {T:q(T,r()<.7),Q:q(Q,r()<.7),G:q(G,r()<.5),last:D[D.length-1]};
}
function scene(seed){
  const r=rng(seed),M=market(r);
  const tq=r()<.15?0:Math.floor(r()*180),qq=r()<.4?0:Math.floor(r()*160),sq=r()<.3?0:Math.floor(r()*120);
  const startCap=[20000,10000,5000,100000][Math.floor(r()*4)];
  const cash=r()<.1?startCap:(r()<.1?0:+((r()-.05)*6000).toFixed(2));
  const events=[{type:'trade',date:'2026-01-05',symbol:'SGOV',side:'buy',qty:1,price:100,fee:0}];
  if(r()<.35)events.push({type:'cash',kind:'dep',date:M.last,amount:+(100+r()*3000).toFixed(2)});
  if(r()<.1)events.push({type:'cash',kind:'dep',date:M.last,amount:+(50+r()*500).toFixed(2)});
  const k=r();let PX=null;
  if(k<.12)PX={error:'VIX·VXN 시세를 불러오는 중입니다'};
  else if(k<.40)PX={live:true,from:'2025-07-01',state:{armed:r()<.5,pf:r()<.5,ps:r()<.5},guard:r()<.5?'ON':'OFF',sigma:.2+r()*.9,sigma20:.3+r()*.8,iv:.3,params:{ma:50,band:.03},events:[]};
  else if(k<.52)PX={state:{armed:true,pf:r()<.5,ps:r()<.5},guard:r()<.5?'ON':'OFF',sigma:.2+r()*.9,params:{ma:50,band:.03},events:[]};
  return {seed,M,tq,qq,sq,cash,startCap,events,PX,hz:r()<.15};
}

/* 화면 문맥 — renderAlphaPlan 이 읽고 쓰는 것 전부를 가짜 요소로 */
function ctx(fnText){
  const els=new Map(),el=id=>{if(!els.has(id))els.set(id,{textContent:'',innerHTML:'',value:'',style:{},className:'',hidden:false,disabled:false});return els.get(id);};
  const log={strip:[],live:[],blocked:[],close:0,bgStrips:0};
  class FixedDate extends Date{toLocaleTimeString(){return '12:00:00';}}
  const c={$:el,document:{querySelectorAll:()=>[]},window:null,Date:FixedDate,console:{warn(){},log(){}},
    alphaWeightHistory:(tr,D,n,S0)=>[tr.length,n,S0],alphaSvg:(lines,o)=>'svg:'+JSON.stringify([lines.map(l=>(l.values||[]).length),o]),alphaCloseFillEditor:()=>{log.close++;},
    alphaOrderHtml:(...a)=>'<o>'+JSON.stringify(a)+'</o>',waitHtml:(a,b)=>'<w>'+a+'|'+b+'</w>',
    activeHorizon:5,horizonRebalancePending:false,pendingAlphaOrders:[],alphaOrderHold:'x',
    renderLivePanic:PX=>log.live.push(PX?JSON.stringify(PX):'null'),alphaPanicBlocked:why=>{log.blocked.push(why);c.pendingAlphaOrders=[];c.alphaOrderHold=why;},
    renderDualGuardStrip:o=>log.strip.push(JSON.parse(JSON.stringify(o))),planPortfolioStrips:()=>{log.bgStrips++;},activeAssetSession:()=>null,curPX:null};
  vm.createContext(c);c.window=c;vm.runInContext(SRC.eng,c);
  vm.runInContext(constOf(SRC.plan,'const PATH_DEFAULTS={')+constOf(SRC.plan,'const ALPHA_FEE_RATE=')+'\n'+lineOf(SRC.plan,'const num=')+lineOf(SRC.plan,'const usd=')+lineOf(SRC.plan,'const usd2='),c);
  vm.runInContext('this.PATH_DEFAULTS=PATH_DEFAULTS;var alphaLedger={base:{},events:[]};var planCurRules="base";function alphaPanicNext(d,on){return curPX;}',c);
  for(const m of ['function alphaFee(q,p)','function indicatorSeries(a,n)','function realizedVol(rows,n)','function alphaEventList(ledger=alphaLedger)','function alphaDepositPending(ledger=alphaLedger)',
    'function planStrategy()','function planStrategyLabel()','function assetRulesOf(x)','function planStrategyLabelOf(x)','function alphaPanicApply(PX,sigma,decGuard)','function alphaRuleSet()','function alphaExplainBounds(target,current,band)'])
    vm.runInContext(fnOf(SRC.plan,m),c);
  vm.runInContext(fnText,c);
  return {c,els,el,log};
}
/* 장면을 화면에 올린다 — 보유 칸(alphaSyncInputs 가 채우는 것) · 시작자산 · 장부 · 공포 모드 · 기간 맞춤 표시 */
function load(C,s){
  const {c,el}=C;el('aTeclQty').value=String(s.tq);el('aTqqqQty').value=String(s.qq);el('aSgovQty').value=String(s.sq);el('aCash').value=String(s.cash);el('startCapital').value=String(s.startCap);
  c.alphaLedger={base:{},events:s.events};c.curPX=s.PX;c.horizonRebalancePending=s.hz;c.pendingAlphaOrders=[];c.alphaOrderHold='x';
}
function snap(C){
  const o={};for(const [k,v] of C.els)o[k]={t:v.textContent,h:v.innerHTML,v:v.value,c:v.className,hid:v.hidden,dis:v.disabled,l:v.style.left||'',w:v.style.width||''};
  return JSON.stringify({o,orders:C.c.pendingAlphaOrders,hold:C.c.alphaOrderHold,hz:C.c.horizonRebalancePending,strip:C.log.strip,live:C.log.live,blocked:C.log.blocked,close:C.log.close});
}
const bgOf=(C,s)=>({tq:s.tq,qq:s.qq,sq:s.sq,cash:s.cash,startCap:Math.max(1,s.startCap),dep:C.c.alphaDepositPending({base:{},events:s.events}),panic:()=>s.PX});

function check(S){
  const bad=[],t=(n,cond,info)=>{if(!cond)bad.push(n+(info?' · '+info:''));};
  const NEWF=fnOf(S.plan,NEW_SIG),OLDF=fnOf(S.old,OLD_SIG);
  const N=400;let diffA=0,firstA='',diffB=0,firstB='',touched=0,firstT='',holds=0,orderScenes=0,bgCalls=0;
  for(let k=1;k<=N;k++){
    const s=scene(k*7919);
    // A — 옛 함수 vs 새 함수(화면 모드)
    const O=ctx(OLDF),W=ctx(NEWF);load(O,s);load(W,s);
    O.c.renderAlphaPlan(s.M.T,s.M.Q,s.M.G);W.c.renderAlphaPlan(s.M.T,s.M.Q,s.M.G);
    const so=snap(O),sw=snap(W);if(so!==sw){diffA++;if(!firstA)firstA='장면 '+s.seed+' · '+so.slice(0,160)+' ≠ '+sw.slice(0,160);}
    if(JSON.parse(sw).orders.length)orderScenes++;bgCalls+=W.log.bgStrips;
    // B — bg 모드 = 화면 띠(기간 맞춤 표시 없이) · 화면 무사
    const V=ctx(NEWF);load(V,{...s,hz:false});V.c.renderAlphaPlan(s.M.T,s.M.Q,s.M.G);
    const viewStrip=V.log.strip.length?V.log.strip[0]:null;
    const G=ctx(NEWF);load(G,{...s,hz:true});G.el('aTeclQty').value='999';G.el('aCash').value='-1';   // 화면 칸에 엉뚱한 값 — bg 가 읽으면 틀린다
    G.c.curPX={error:'보고 있는 세션의 공포 모드(bg 가 쓰면 안 됨)'};   // 화면이 보는 세션의 공포 모드 문맥도 엉뚱하게
    const before=snap(G),ret=G.c.renderAlphaPlan(s.M.T,s.M.Q,s.M.G,bgOf(G,s)),after=snap(G);
    if(before!==after||G.log.bgStrips){touched++;if(!firstT)firstT='장면 '+s.seed;}
    if(s.PX&&s.PX.error){holds++;if(!(ret&&ret.hold===s.PX.error&&!viewStrip)){diffB++;if(!firstB)firstB='보류 장면 '+s.seed+' '+JSON.stringify(ret);}}
    else if(JSON.stringify(JSON.parse(JSON.stringify(ret||null)))!==JSON.stringify(viewStrip)){diffB++;if(!firstB)firstB='장면 '+s.seed+' bg '+JSON.stringify(ret).slice(0,200)+' ≠ 화면 '+JSON.stringify(viewStrip).slice(0,200);}
  }
  t('A 옛 함수 = 새 함수(화면 모드) — 무작위 '+N+'장면 화면 글자 · 주문표 · 띠 · 공포 모드 카드 · 보류 · 기록 창 · 기간 맞춤 표시 전부 같음(주문 있는 장면 '+orderScenes+')',diffA===0&&orderScenes>40,firstA);
  t('A2 화면 모드는 매번 포트폴리오 세션 뒤 계산을 부른다',bgCalls===N,String(bgCalls));
  t('B bg 모드 = 같은 보유를 화면에 올렸을 때의 띠(같은 '+N+'장면) · 판정 불가 '+holds+'장면은 {hold}',diffB===0&&holds>20,firstB);
  t('B2 bg 모드는 화면 · 주문표(pendingAlphaOrders) · 기록 창 · 기간 맞춤 표시 · 공포 모드 카드를 안 건드리고 화면 칸 보유도 안 읽는다',touched===0,firstT);

  // ── C planBgTargets
  { const c={window:null,console:{warn(){}},sent:[],act:null,sessions:[],planDbState:null,planCurRules:'base',panicCalls:[]};
    vm.createContext(c);c.window=c;vm.runInContext(SRC.eng,c);
    vm.runInContext(constOf(S.plan,'const ALPHA_FEE_RATE=')+'\n'+lineOf(S.plan,'const todayISO=')+fnOf(S.plan,'function alphaFee(q,p)')+fnOf(S.plan,'function alphaEventList(ledger=alphaLedger)')
      +fnOf(S.plan,'function alphaDepositPending(ledger=alphaLedger)')+fnOf(S.plan,'function assetRulesOf(x)')+fnOf(S.plan,'function planLedgerFrom(o,all)')+fnOf(S.plan,'function assetLedgerSeed(date,cap)')
      +'\nvar alphaLedger={base:{},events:[]};function plusYears(s,n){return s;}function activeAssetSession(){return act;}function assetSessionList(){return sessions;}'
      +'function planLivePanic(x,d,on,start){panicCalls.push([x?x.id:"cur",d,on,start]);return {live:true,state:{pf:false,ps:false},guard:"ON",sigma:.5};}\n'
      +fnOf(S.plan,'function defaults()')+fnOf(S.plan,'function planBgTargets()'),c);
    const L=(tecl,cash,ev=[])=>({base:{date:'2026-01-02',tecl,tqqq:0,sgov:0,cash,avgTecl:50,avgTqqq:null,avgSgov:null},events:ev,feeModel:'toss-us-0.1-v1'});
    const dep={type:'cash',kind:'dep',date:'2026-11-10',amount:300};
    c.planDbState={startCapital:20000,startDate:'2026-03-02',alphaRules:'panic',portfolio:true,sessionName:'토스',alphaLedger:L(100,1234.567,[dep])};
    const paper={id:'p1',paper:true,name:'모의',settings:{startCapital:10000}},r1={id:'r1',name:'둘째 계좌',portfolio:true,settings:{startCapital:5000,startDate:'2026-05-01',alphaRules:'base'},ledger:L(7,88)};
    const off={id:'r2',name:'뺀 계좌',portfolio:false,settings:{startCapital:3000},ledger:L(1,1)};
    c.sessions=[paper,r1,off];c.act=paper;
    const T=vm.runInContext('planBgTargets()',c),cur=T.find(x=>x.key==='cur'),s1=T.find(x=>x.key==='r1');
    t('C1 탭이 모의 세션을 보면: 현재 투자중(토스 · DB 원장) + 포트폴리오에 넣은 실계좌(둘째 계좌) — 모의 · 뺀 세션 · 보고 있는 세션 없음',
      T.map(x=>x.key).join(',')==='cur,r1'&&cur.name==='토스'&&s1.name==='둘째 계좌',JSON.stringify(T.map(x=>[x.key,x.name])));
    t('C2 보유 · 현금 = 엔진 장부(시작 1234.567 + 입금 300 → 화면 칸과 같은 반올림 1534.57) · 시작자산 · 입금 맞춤',cur.bg.tq===100&&cur.bg.qq===0&&cur.bg.cash===1534.57&&cur.bg.startCap===20000&&cur.bg.dep&&cur.bg.dep.amount===300
      &&s1.bg.tq===7&&s1.bg.cash===88&&s1.bg.startCap===5000&&s1.bg.dep===null,JSON.stringify([cur.bg,s1.bg]));
    const p0=cur.bg.panic('2026-11-10',true),p1=s1.bg.panic('2026-11-10',false);
    t('C3 공포 모드: 현재 투자중은 DB 원장 시작일(03-02)로 planLivePanic · 기본 규칙 세션은 null',p0&&p0.live&&p1===null&&c.panicCalls.length===1&&JSON.stringify(c.panicCalls[0])==='["cur","2026-11-10",true,"2026-03-02"]',JSON.stringify(c.panicCalls));
    c.act=null;const T2=vm.runInContext('planBgTargets()',c);
    t('C4 탭이 현재 투자중을 보면 그건 빼고(화면이 이미 알림) 다른 실계좌만',T2.map(x=>x.key).join(',')==='r1',JSON.stringify(T2.map(x=>x.key)));
    c.act=r1;c.planDbState.portfolio=false;const T3=vm.runInContext('planBgTargets()',c);
    t('C5 현재 투자중을 포트폴리오에서 뺐으면 안 셈 · 보고 있는 세션(둘째 계좌)도 안 셈',T3.length===0,JSON.stringify(T3.map(x=>x.key))); }

  // ── D planPortfolioStrips · planLivePanic 시작일 덮어쓰기
  { const sent=[],c={window:null,console:{warn(){}},location:{origin:'https://jk.example'},emb:true,user:{uid:'u1'},
      targets:[{key:'cur',name:'토스',bg:{tq:1}},{key:'r1',name:'둘째',bg:{tq:2}},{key:'r3',name:'셋째',bg:{tq:3}}]};
    vm.createContext(c);c.window={parent:{postMessage:(m,o)=>sent.push([m,o])}};c.document={documentElement:{classList:{contains:k=>k==='embed'&&c.emb}}};
    vm.runInContext('var auth={get currentUser(){return user;}};function planBgTargets(){return targets;}function renderAlphaPlan(a,b,c2,bg){return bg.tq===3?null:(bg.tq===2?{hold:"VIX 없음"}:{orders:1,guard:"ON"});}\n'+fnOf(S.plan,'function planPortfolioStrips(qTecl,qTqqq,qSgov)'),c);
    c.planPortfolioStrips({},{},{});
    const m0=sent[0]&&sent[0][0],m1=sent[1]&&sent[1][0];
    t('D1 창 안 · 로그인이면 세션마다 bg:true · paper:false · 세션 키 · 같은 출처로 보냄(보류도) · 띠 없는 세션은 안 보냄',sent.length===2&&m0.type==='jk-dg'&&m0.bg===true&&m0.paper===false&&m0.key==='cur'&&m0.uid==='u1'&&m0.strip.orders===1&&!m0.ledger
      &&m1.key==='r1'&&m1.strip.hold==='VIX 없음'&&sent[0][1]==='https://jk.example',JSON.stringify(sent));
    sent.length=0;c.emb=false;c.planPortfolioStrips({},{},{});const a=sent.length;c.emb=true;c.user=null;c.planPortfolioStrips({},{},{});
    t('D2 창 밖(/plan 바로)이거나 로그인 전이면 안 보냄',a===0&&sent.length===0);
    const pl=fnOf(S.plan,'function planLivePanic(x,signalDate,posOn,startOverride)');
    t('D3 planLivePanic — 시작일 덮어쓰기(startOverride)가 있으면 그것 · 없으면 예전대로(세션 설정 · 화면 시작일) · 기억은 여러 개(번갈아 세도 재생 안 반복)',
      /const s0=String\(startOverride!=null\?startOverride:\(x\?\(\(x\.settings&&x\.settings\.startDate\)\|\|''\):\(\(\$\('startDate'\)\|\|\{\}\)\.value\|\|''\)\)\)/.test(pl)
      &&/planLivePanicMemo\.has\(key\)/.test(pl)&&/const planLivePanicMemo=new Map\(\);/.test(S.plan)); }
  return bad;
}

const bad=check(SRC);
if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 포트폴리오 오늘 칸 = 포트폴리오 세션 판단: 옛 함수 = 새 함수(화면 400장면) · bg = 화면 띠(400장면) · bg 는 화면 무사 · 대상 세션 · 보내기');
const MUT=[
  ['bg 가 화면 주문표를 덮음','plan',s=>s.replace("  if(V){pendingAlphaOrders=orders.map(o=>({...o}));alphaOrderHold='';}","  pendingAlphaOrders=orders.map(o=>({...o}));alphaOrderHold='';")],
  ['bg 가 주문 칸을 그림','plan',s=>s.replace("  if(V)$('alphaActions').innerHTML=","  $('alphaActions').innerHTML=")],
  ['bg 가 화면 보유 칸을 읽음(옛 코드 · 탭이 보는 세션 값)','plan',s=>s.replace("const tq=B?B.tq:Math.max(0,Math.floor(num('aTeclQty')))","const tq=Math.max(0,Math.floor(num('aTeclQty')))")],
  ['bg 가 현금을 화면에서 읽음','plan',s=>s.replace(",cash=B?B.cash:num('aCash');",",cash=num('aCash');")],
  ['bg 가 공포 모드를 보고 있는 세션 것으로','plan',s=>s.replace("const PX=B?B.panic(qTecl.settled.date,qq>0):alphaPanicNext(qTecl.settled.date,qq>0);","const PX=alphaPanicNext(qTecl.settled.date,qq>0);")],
  ['bg 가 기간 맞춤 표시를 따름','plan',s=>s.replace(",hz=B?false:horizonRebalancePending;",",hz=horizonRebalancePending;")],
  ['bg 가 기간 맞춤 표시를 지움','plan',s=>s.replace("  if(V&&horizonRebalancePending)horizonRebalancePending=false;","  if(horizonRebalancePending)horizonRebalancePending=false;")],
  ['bg 판정 불가를 띠 없이 버림','plan',s=>s.replace("return B?{hold:PX.error}:undefined;}","return;}")],
  ['화면 모드가 포트폴리오 세션 뒤 계산을 안 부름','plan',s=>s.replace("  if(V&&typeof planPortfolioStrips==='function')planPortfolioStrips(qTecl,qTqqq,qSgov);","")],
  ['대상: 보고 있는 세션도 셈','plan',s=>s.replace("if(!x||x.paper||x.portfolio===false||(act&&x.id===act.id))continue;","if(!x||x.paper||x.portfolio===false)continue;")],
  ['대상: 포트폴리오에서 뺀 세션도 셈','plan',s=>s.replace("if(!x||x.paper||x.portfolio===false||(act&&x.id===act.id))continue;","if(!x||x.paper||(act&&x.id===act.id))continue;")],
  ['대상: 현재 투자중을 안 셈(옛 코드)','plan',s=>s.replace("  if(act&&planDbState&&planDbState.portfolio!==false){   // '현재 투자중'(본 장부) — 다른 세션을 보고 있을 때만","  if(false){")],
  ['대상: 현금 반올림이 화면과 다름','plan',s=>s.replace("cash:Number((+S.cash||0).toFixed(2)),startCap,","cash:+S.cash||0,startCap,")],
  ['대상: 공포 모드 시작일을 화면 것으로','plan',s=>s.replace("panic:panicOn?((d,on)=>planLivePanic(panicX,d,on,start)):(()=>null)}});","panic:panicOn?((d,on)=>planLivePanic(panicX,d,on)):(()=>null)}});")],
  ['보내기: bg 표시 없음(받는 쪽이 보는 중 표시를 덮음)','plan',s=>s.replace("{type:'jk-dg',v:1,uid:u.uid,key:t.key,paper:false,bg:true,strip:{...strip},name:t.name}","{type:'jk-dg',v:1,uid:u.uid,key:t.key,paper:false,strip:{...strip},name:t.name}")],
  ['보내기: 창 밖에서도 보냄','plan',s=>s.replace("function planPortfolioStrips(qTecl,qTqqq,qSgov){\n  if(!document.documentElement.classList.contains('embed')||window.parent===window)return;","function planPortfolioStrips(qTecl,qTqqq,qSgov){")],
  ['공포 모드 시작일 덮어쓰기 무시','plan',s=>s.replace("const s0=String(startOverride!=null?startOverride:(","const s0=String((")],
];
let red=0;
for(const [name,key,mut] of MUT){
  const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
  let failed=false;try{failed=check({...SRC,[key]:m}).length>0;}catch(e){failed=true;}
  if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  red++;console.log('PASS 변이 빨간불: '+name);
}
console.log('ALL PASS plan bg strip · 변이 '+red+'/'+MUT.length+' red');
