#!/usr/bin/env node
'use strict';
/* 공통 수수료 (운영 v3.139.0 · 백테 v2.19.0 · 듀얼가드 v2.15.0 · 설정 v1.8.0 · 2026-11-19)
 * 사용자: "전부 다 고치는데 수수료는 전부 똑같이 적용하고 기본 공통으로 사용할 수수료를 설정에서 탭하나 더 만들어서 거기에 기본 0.25로 입력해
 *          그 값을 가져다가 모든 수수료에 적용해 지금 수수료 적용되지 않는 전략들도 전부"
 * 실제 페이지 · 서버 · 엔진 함수를 떼어 가짜 화면에서 돌린다(재구현 없음). 값 시험 + 변이 시험(고친 곳을 되돌리면 빨간불).
 *   S 설정 탭 — 💸 수수료 단추 · 칸(기본 0.25) · 읽기 · 저장(사용자 문서 merge) · 잘못된 값 거절 · 관리자 하위 탭 목록
 *   K 규칙 — 브라우저 jk-fee.js = 서버 _fee.js (같은 문서 → 같은 율 · 없거나 0~2% 밖이면 0.25%)
 *   L 장부 — 수수료 = 거래금액 × 율(0.25% · 0.1% 두 번) · 기록의 fee 칸은 안 씀 · 시작 보유(seed) 0
 *            무매(앱 · 서버 · 플랜 셋 다 같은 잔금) · VR(앱 · 플랜) · 로테 · 섀넌 · 적립 · ASAP · 듀얼가드(엔진) · 플랜 슬리브
 *   O 주문 — 무매 매수 수량 = 배정금 ÷ (주문가 × (1+율)) 내림(서버 값 · 앱 주문표 · 모의 · 플랜 배선)
 *   P 모의 지문 — 율이 바뀌면 다시 만든다(simSig · 모의 목록 줄 · 듀얼가드 저장본)
 *   W 배선 — 사용자 문서 → 운영(setCommonFee · 엔진 setFeeRate · 화면 글자) · 플랜(planApplyFee) · 백테(jkBtSetFee 를 설정 되살리기 전에)
 *            · 서버(feeRateFromDoc → imOrders) · costOf 국내도 같은 율 · 세후 '다 판다' 매도 수수료 모든 탭 · 두 번 떼지 않음 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const FILES={idx:'index.html',plan:'plan.html',bt:'backtest.html',set:'settings.html',setjs:'settings-fee.js',fee:'jk-fee.js',sfee:'functions/api/_fee.js',
  im:'functions/api/_im.js',at:'functions/api/autotrade.js',eng:'plan-session-engine.js',acc:'jk-access.js'};
const SRC=Object.fromEntries(Object.entries(FILES).map(([k,f])=>[k,rd(f)]));
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const lineOf=(src,re)=>{const m=src.match(re);if(!m)throw Error('없음: '+re);return m[0];};
const near=(a,b,e=1e-9)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=e;
const J=x=>JSON.stringify(x);
const RATES=[0.0025,0.001];

/* 운영(index.html) 함수 묶음 — 무매 장부(computeInf)가 부르는 것까지 · JK_FEE 는 var 로 넣어 율을 바꿔 가며 부른다 */
function idxCtx(S,R,extra){
  const at=S.idx.indexOf('const KIND_T=');
  const names=['computeInf','imBuy1','imBuyOrders','imBigPct','imRowsOf','imTickRound','vrTick','vrTickDn','imStarPx','imBuyPx','starPct','reverseT','isBuy','isSell','isAmtKind',
    'imCycleEnds','imDayOpenAfter','revSupported','revEnabled','imRevBuyQty','computeVr','maLedger','ivsPos','computeDca','_dcaRawMap','asapPos'];
  const c=Object.assign({console,__strat:null,curStrat:()=>c.__strat,dcaQuoteData:null,nfix:(v,n)=>(+v).toFixed(n)},extra||{});
  vm.createContext(c);
  vm.runInContext('var JK_FEE='+R+';\n'+S.idx.slice(at,S.idx.indexOf('};',at)+2)+'\n'+
    'const REV_DIVS=[20,40], IM_BIG_DEFAULT=20, IM_ROWS_DEFAULT=3; let _infReplayAsOf="", _infResume=null;\n'+
    names.map(n=>{const m=S.idx.match(new RegExp('\\n(function '+n.replace('$','\\$')+'\\([^)]*\\))'));if(!m)throw Error('없음 '+n);return fnOf(S.idx,m[1]);}).join('\n'),c);
  return c;
}
/* 플랜(plan.html) 무매 · VR · 슬리브 사본 — ALPHA_FEE_RATE 를 var 로 */
function planCtx(S,R){
  const P=S.plan,c={console,sleeveLedger:null};vm.createContext(c);
  vm.runInContext('var ALPHA_FEE_RATE='+R+';\n'+P.slice(P.indexOf('const KIND_T='),P.indexOf(';',P.indexOf("'절반매수+지정가매도(애프터)'"))+1)+'\n'
    +[/const isBuyKind=[^\n]*/,/const isSellKind=[^\n]*/,/const REV_DIVS_PLAN=[^\n]*/,/function reverseTPlan[^\n]*/,/function imCycleEnds\(soldToday, qtyAtDayEnd\)[^\n]*/].map(re=>lineOf(P,re)).join('\n')+'\n'
    +['function imDayOpenAfter(hist, i)','function calcInfState(sess)','function calcVrState(sess)','function ledgerCalc(){','function alphaFee(q,p)'].map(m=>fnOf(P,m)).join('\n'),c);
  return c;
}
const loadEngine=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};
const server=S=>new Function(S.im.replace(/export /g,'')+'\nreturn {imCompute,imOrders};')();

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,400):''));};

  // ── S. 설정 탭 ──
  t('S1 설정 화면 — 💸 수수료 단추 · 칸(기본 0.25 · 0~2% · 0.01 단위) · 저장 단추 · jk-fee.js 다음 settings-fee.js · 사용자 문서 도구를 넘긴다 · 머리 v1.8.1(11/19 모의투자 카드 지피티 표시 · 번호 순으로 v1.8.0 → v1.8.1)',
    /data-settings-tab="fee">💸 수수료<\/button>/.test(S.set)&&/data-settings-panel="fee"/.test(S.set)&&/id="feeRatePct" min="0" max="2" step="0\.01"[^>]*value="0\.25"/.test(S.set)
    &&/id="feeSave"/.test(S.set)&&S.set.indexOf('/jk-fee.js')>0&&S.set.indexOf('/jk-fee.js')<S.set.indexOf('/settings-fee.js')&&/window\.jkSettingsDb=\{db,doc,getDoc,setDoc\};/.test(S.set)
    &&/>v1\.8\.1</.test(S.set));
  t("S1 관리자 하위 탭 목록(jk-access.js) — 설정 페이지 탭 셋(알림 · 모의투자 · 수수료)",/'\/settings':\{[^}]*items:\[\['notifications','🔔 알림'\],\['paper','🧪 모의투자'\],\['fee','💸 수수료'\]\]\}/.test(S.acc));
  const setH=(docData,user)=>{
    const els={feeRatePct:{value:'0.25'},feeMessage:{textContent:''},feeSave:{disabled:false,addEventListener(){}}},calls=[];
    const win={jkAuth:{currentUser:user||null},jkSettingsDb:{db:'DB',doc:(db,c,id)=>c+'/'+id,getDoc:async()=>({exists:()=>docData!=null,data:()=>docData}),setDoc:async(p,d,o)=>{calls.push([p,JSON.parse(J(d)),o]);}},addEventListener(){}};
    const c={window:win,document:{getElementById:id=>els[id]||null,addEventListener(){},querySelectorAll:()=>[]},location:{hash:''},console,Date};
    vm.createContext(c);vm.runInContext(S.fee,c);vm.runInContext(S.setjs,c);
    return {els,calls,F:win.jkFeeSettings};
  };
  { const A=setH(null,null);await A.F.loadFee();const m1=A.els.feeMessage.textContent;A.els.feeRatePct.value='0.3';await A.F.saveFee();
    t('S2 로그인 전 — 불러오기 · 저장 둘 다 안내만 · 쓰기 없음',/로그인 후/.test(m1)&&/로그인 후 저장/.test(A.els.feeMessage.textContent)&&A.calls.length===0,J([m1,A.els.feeMessage.textContent,A.calls]));
    const B=setH({stateV2:{}},{uid:'u1'});await B.F.loadFee();
    t('S2 저장값 없는 문서 — 칸 0.25 · 기본 0.25% 안내',B.els.feeRatePct.value==='0.25'&&/기본 0\.25%/.test(B.els.feeMessage.textContent),J([B.els.feeRatePct.value,B.els.feeMessage.textContent]));
    const C=setH({commonFee:{rate:0.001,updated:1}},{uid:'u1'});await C.F.loadFee();
    t('S2 저장값 0.1% — 칸 0.1 · 저장된 수수료 안내',C.els.feeRatePct.value==='0.1'&&/저장된 수수료 0\.1%/.test(C.els.feeMessage.textContent),J([C.els.feeRatePct.value,C.els.feeMessage.textContent]));
    C.els.feeRatePct.value='0.3';await C.F.saveFee();const w=C.calls[0]||[];
    t('S2 저장 0.3 → users/u1 에 {commonFee:{rate:0.003, updated}} · merge:true(문서의 다른 칸 그대로) · 저장했다고 안내',C.calls.length===1&&w[0]==='users/u1'&&near(w[1].commonFee.rate,0.003)&&w[1].commonFee.updated>0
      &&Object.keys(w[1]).join()==='commonFee'&&w[2]&&w[2].merge===true&&/저장했습니다 — 0\.3%/.test(C.els.feeMessage.textContent),J([C.calls,C.els.feeMessage.textContent]));
    const D=setH({},{uid:'u1'});const bads=['3','-0.1','','abc','2.01'];for(const v of bads){D.els.feeRatePct.value=v;await D.F.saveFee();}
    t('S2 잘못된 값(3 · −0.1 · 빈칸 · 문자 · 2.01) — 저장 안 함 · 범위 안내',D.calls.length===0&&/0 ~ 2% 사이/.test(D.els.feeMessage.textContent),J([D.calls,D.els.feeMessage.textContent]));
    D.els.feeRatePct.value='2';await D.F.saveFee();D.els.feeRatePct.value='0';await D.F.saveFee();
    t('S2 경계 2% · 0% 는 받는다',D.calls.length===2&&near(D.calls[0][1].commonFee.rate,0.02)&&D.calls[1][1].commonFee.rate===0,J(D.calls)); }

  // ── K. 규칙 — 브라우저 = 서버 ──
  { const kc={};vm.createContext(kc);vm.runInContext(S.fee,kc);const KB=kc.JKFee,KS=new Function(S.sfee.replace(/export /g,'')+'\nreturn {FEE_DEFAULT,FEE_MAX,feeValid,feeRateFromDoc};')();
    const docs=[undefined,null,{},{commonFee:null},{commonFee:{}},{commonFee:{rate:0.001}},{commonFee:{rate:'0.002'}},{commonFee:{rate:-1}},{commonFee:{rate:0.5}},{commonFee:{rate:''}},{commonFee:{rate:null}},{commonFee:0.001},{commonFee:{rate:0}},{commonFee:{rate:0.02}},{commonFee:{rate:0.0201}},{commonFee:{rate:'x'}}];
    const a=docs.map(d=>KB.fromDoc(d)),b=docs.map(d=>KS.feeRateFromDoc(d));
    t('K1 같은 문서 → 같은 율(브라우저 jk-fee.js = 서버 _fee.js · 16가지) · 기본 0.25% · 최대 2%',J(a)===J(b)&&KB.DEFAULT===0.0025&&KS.FEE_DEFAULT===0.0025&&KB.MAX===0.02&&KS.FEE_MAX===0.02
      &&J(a)===J([0.0025,0.0025,0.0025,0.0025,0.0025,0.001,0.002,0.0025,0.0025,0.0025,0.0025,0.0025,0,0.02,0.0025,0.0025]),J([a,b]));
    t('K2 화면 % ↔ 율 — 0.25 → 0.0025 · 2.5(%) 는 범위 밖 · 빈칸 null · 0.0025 → "0.25" · 0.001 → "0.1" · 잘못된 저장값은 던진다',
      KB.fromPct('0.25')===0.0025&&KB.fromPct(' 0.1 ')===0.001&&KB.fromPct('2.5')===null&&KB.fromPct('')===null&&KB.fromPct(null)===null&&KB.pct(0.0025)==='0.25'&&KB.pct(0.001)==='0.1'
      &&(()=>{try{KB.docPatch(0.5);return false;}catch(e){return true;}})()&&J(Object.keys(KB.docPatch(0.003,7)))==='["commonFee"]'&&KB.docPatch(0.003,7).commonFee.updated===7); }

  // ── L. 장부 — 수수료 = 거래금액 × 율 ──
  for(const R of RATES){
    const c=idxCtx(S,R), pc=planCtx(S,R), SV=server(S), E=loadEngine(S.eng); E.setFeeRate(R);
    // L1 무매 — 복리 · 단리 · 복합 · 앱 = 서버 = 플랜
    const st={ticker:'SOXL',div:20,target:20,principal:10000,compound:true};
    const H=[{date:'2026-01-05',kind:'1회매수',price:100,qty:10},{date:'2026-01-06',kind:'지정가매도',price:120,qty:10}];
    c.__strat={settings:{...st},hist:H};const a=c.computeInf();
    t(`L1 무매 ${R*100}% — 수수료 = (1,000 + 1,200) × 율 · 잔금 = 10,000 + 200 − 수수료 · 평단은 수수료 제외`,near(a.fees,2200*R)&&near(a.bal,10200-2200*R)&&near(a.realized,200)&&a.feeRate===R,J([a.fees,a.bal,a.realized]));
    c.__strat={settings:{...st,compound:false},hist:H};const a2=c.computeInf();
    t(`L1 무매 단리 ${R*100}% — 사이클 끝 인출 = 200 − 수수료(이미 나간 돈) · 잔금은 원금 10,000`,near(a2.saved,200-2200*R)&&near(a2.bal,10000),J([a2.saved,a2.bal]));
    const HX=[{date:'2026-01-05',kind:'1회매수',price:100,qty:8,tManual:8},{date:'2026-01-06',kind:'지정가매도+1회매수',sellPrice:110,sellQty:8,buyPrice:105,buyQty:3},
      {date:'2026-01-07',kind:'출금',amt:50},{date:'2026-01-08',kind:'배당',amt:7},{date:'2026-01-09',kind:'쿼터매도',price:106,qty:1}];
    c.__strat={settings:{...st},hist:HX};const ax=c.computeInf(),bx=SV.imCompute({...st},HX,null,R),px=pc.calcInfState({settings:{...st},hist:HX});
    const fx=(800+880+315+106)*R;
    t(`L1 무매 ${R*100}% — 복합(지정가매도+1회매수) 두 다리 모두 수수료 · 출금 · 배당은 수수료 없음 · 앱 = 서버 = 플랜 잔금`,near(ax.fees,fx)&&near(ax.bal,bx.bal)&&near(ax.bal,px.bal)&&near(bx.fees,fx)&&near(px.fees,fx)&&ax.qty===bx.qty&&ax.qty===px.qty,J([ax.bal,bx.bal,px.bal,ax.fees,fx]));
    // L2 VR — 손 기록(수수료 칸 없음)도 · 기록 칸 무시 · 이어받은 보유(seed) 0 · 앱 = 플랜 Pool
    const vst={ticker:'TQQQ',startpool:1000,startv:0,band:15,mode:0.75,g:10,formula:'basic',add:0};
    const VH=[{type:'buy',date:'2026-01-02',price:100,qty:10,cyc:0,init:true},{type:'buy',date:'2026-01-10',price:50,qty:4,cyc:0,fee:999},{type:'sell',date:'2026-01-12',price:60,qty:2,cyc:0}];
    c.__strat={settings:{...vst},hist:VH};const v=c.computeVr(),pv=pc.calcVrState({settings:{...vst},hist:VH});
    t(`L2 VR ${R*100}% — Pool = 1,000 − 200(1+율) + 120(1−율) · 기록 칸 999 무시 · 첫 매수 원가에도 수수료 · 플랜 사본 같은 Pool`,near(v.pool,1000-200*(1+R)+120*(1-R))&&near(v.fees,1320*R)&&near(v.initBuy,1000*(1+R))&&near(pv.pool,v.pool),J([v.pool,v.fees,v.initBuy,pv.pool]));
    c.__strat={settings:{...vst,startv:1000},hist:[{type:'buy',date:'2026-01-02',price:100,qty:10,cyc:0,init:true,seed:true,fee:0}]};const vs=c.computeVr();
    t(`L2 VR ${R*100}% — 이어받은 보유(seed)는 매매가 아니라 수수료 0`,vs.fees===0,vs.fees);
    // L3 로테
    const L=c.maLedger([{type:'in',date:'2026-01-02',price:80,qty:100,fee:0},{type:'out',date:'2026-02-02',price:90,fee:0}],90,10000);
    t(`L3 로테 ${R*100}% — 현금 = 10,000 − 8,000(1+율) + 9,000(1−율) · 기록 칸 0 무시 · 실현손익 수수료 차감`,near(L.cash,10000-8000*(1+R)+9000*(1-R))&&near(L.fees,17000*R)&&near(L.realized,1000-17000*R),J([L.cash,L.fees,L.realized]));
    // L4 섀넌
    const P=c.ivsPos(10000,[{type:'buy',leg:'lev',date:'2026-01-02',price:50,qty:20,amt:1000,fee:5},{type:'sell',leg:'lev',date:'2026-01-05',price:60,qty:10,amt:600,fee:0},
      {type:'buy',leg:'x1',date:'2026-01-01',price:100,qty:5,amt:500,fee:0,seed:true}]);
    t(`L4 섀넌 ${R*100}% — 현금 = 10,000 − 1,000(1+율) + 600(1−율) − 시작 보유 500(수수료 0) · 기록 칸(5 · 0) 무시`,near(P.cash,10000-1000*(1+R)+600*(1-R)-500)&&near(P.fees,1600*R)&&P.rows.find(r=>r.h.seed).fee===0,J([P.cash,P.fees]));
    // L5 적립
    c.__strat={settings:{ticker:'USD',amount:100},hist:[{date:'2026-01-02',amt:100,price:50},{date:'2026-02-02',amt:200,price:40,mul:2}]};const d=c.computeDca();
    const dsh=100/(50*(1+R))+200/(40*(1+R));
    t(`L5 적립 ${R*100}% — 주수 = 적립금 ÷ (가격 × (1+율)) · 수수료 = 적립금 × 율/(1+율) · 넣은 돈 300 그대로`,near(d.pos.shares,dsh)&&near(d.pos.fees,300-300/(1+R))&&near(d.pos.inv,300)&&d.pos.feeRate===R,J(d.pos));
    // L6 ASAP
    const A=c.asapPos([{type:'sgov',amt:500},{type:'buy',price:20,qty:999,amt:100,from:'reserve'},{type:'sell',price:25,qty:2,amt:50}]);
    const ash=100/(20*(1+R));
    t(`L6 ASAP ${R*100}% — 주수 = 금액 ÷ (가격 × (1+율))(기록 qty 999 무시) · 리저브 −100 · 매도 실현 = 대금 − 수수료 − 원가`,near(A.shares,ash-2)&&near(A.reserve,400)&&near(A.fees,100-100/(1+R)+50*R)&&near(A.realized,50-50*R-2*20*(1+R)),J(A));
    // L7 듀얼가드 엔진
    const EL=E.ledgerCalc({base:{date:'2026-01-01',cash:10000,tecl:5,avgTecl:90},events:[{id:'1',type:'trade',date:'2026-01-02',symbol:'TECL',side:'buy',qty:10,price:100,fee:0},
      {id:'2',type:'trade',date:'2026-01-03',symbol:'TECL',side:'sell',qty:3,price:110,fee:99}]});
    t(`L7 듀얼가드 ${R*100}% — 현금 = 10,000 − 1,000(1+율) + 330(1−율) · 기록 칸(0 · 99) 무시 · 시작 잔고(base) 수수료 없음 · alphaFee = 거래금액 × 율(무료 구간 · 센트 내림 없음)`,
      near(EL.cash,10000-1000*(1+R)+330*(1-R))&&EL.tecl===12&&near(E.alphaFee(1,10),10*R)&&near(E.alphaFee(20,100),2000*R)&&E.FEE_RATE===R&&near(pc.alphaFee(20,100),2000*R),J([EL.cash,E.alphaFee(1,10),E.FEE_RATE]));
    // L8 플랜 슬리브(QLD · SGOV)
    pc.sleeveLedger={startQLD:0,startSGOV:0,startCash:1000,trades:[{symbol:'QLD',side:'buy',qty:10,price:50},{symbol:'QLD',side:'sell',qty:5,price:60}]};const sl=pc.ledgerCalc();
    t(`L8 플랜 슬리브 ${R*100}% — 현금 = 1,000 − 500(1+율) + 300(1−율)`,near(sl.cash,1000-500*(1+R)+300*(1-R))&&sl.qld===5,J(sl));
  }

  // ── O. 주문 수량 ──
  { const SV=server(S),st={ticker:'SOXL',div:20,target:20,principal:12000,big:20,rows:0,compound:true};
    const q=R=>(SV.imOrders({st,hist:[],close:50,days:[{date:'2026-01-02',close:50}],fee:R}).orders||[]).filter(o=>o.side==='buy').map(o=>o.qty+'@'+o.price).join();
    const q0=q(0),q1=q(0.0025),qd=(SV.imOrders({st,hist:[],close:50,days:[{date:'2026-01-02',close:50}]}).orders||[]).filter(o=>o.side==='buy').map(o=>o.qty+'@'+o.price).join();
    t('O1 서버 무매 첫 매수 — 배정 600 · 주문가 60: 율 0 → 10주 · 0.25% → 9주(600 ÷ (60 × 1.0025)) · 율을 안 주면 기본 0.25%',q0==='10@60'&&q1==='9@60'&&qd===q1,J([q0,q1,qd]));
    const rnd=fnOf(S.idx,'function renderOrder()'),sim=fnOf(S.idx,'function infSimForward(startFrom)'),rec=fnOf(S.idx,'function infRecordBuy(c, close, prevClose)');
    const FEEARG="fee:(typeof JK_FEE!=='undefined'?JK_FEE:0.0025), cur:curOf(st)";
    t('O2 앱 무매 주문 — 운영 주문표 · 모의 · 기록 시트 셋 다 같은 공통 율로 수량을 낸다(배정금 = 매수금 + 수수료)',rnd.includes(FEEARG)&&sim.includes(FEEARG)&&rec.includes(FEEARG)&&!/fee:0, cur/.test(rnd+sim+rec));
    t('O2 플랜 무매 주문 · 서버 주문 — 같은 율',/fee:ALPHA_FEE_RATE, cur:'usd'/.test(fnOf(S.plan,'function imOrders(sess,price,rows)'))&&/rows: imRowsOf\(st\), fee: c\.feeRate, cur \}\)\)/.test(S.im)); }

  // ── P. 모의 지문 ──
  { const sigOf=R=>{const c={console};vm.createContext(c);vm.runInContext('var JK_FEE='+R+';\n'+lineOf(S.idx,/const SIM_RULE_VER=\d+;/)+'\n'+lineOf(S.idx,/const SIM_OPT_KEYS=[^\n]*/)+'\n'
      +fnOf(S.idx,'const SIM_KEYS={')+';\n'+fnOf(S.idx,'function simSig(tab,st)'),c);return ['inf','vr','ma','ivs','dca','asap'].map(tb=>c.simSig(tb,{ticker:'SOXL',div:20})).join(' / ');};
    const s1=sigOf(0.0025),s2=sigOf(0.001),s3=sigOf(0.0025);
    t('P1 모의 지문(simSig)에 공통 율 — 여섯 전략 모두 율이 바뀌면 지문이 바뀐다(기록을 처음부터) · 같은 율이면 같다 · 규약 판 15 이상',
      s1!==s2&&s1===s3&&s1.split(' / ').every(x=>/^r(\d+)\|f0\.0025\|/.test(x)&&+x.match(/^r(\d+)/)[1]>=15)&&s2.split(' / ').every(x=>/\|f0\.001\|/.test(x)),[s1,s2].join(' ‖ '));
    const rowSig=R=>{const c={console,S:{paperCommon:{}},window:{JKPlanSessionEngine:{ENGINE_FP:'x'}}};vm.createContext(c);vm.runInContext('var JK_FEE='+R+';\n'+fnOf(S.idx,'function paperRowSig(tab,x)'),c);
      return c.paperRowSig('inf',{id:'a',settings:{ticker:'SOXL'},hist:[]});};
    t('P2 모의 목록 줄 서명에 공통 율 — 율이 바뀌면 줄을 다시 센다',rowSig(0.0025)!==rowSig(0.001)&&rowSig(0.0025)===rowSig(0.0025),[rowSig(0.0025),rowSig(0.001)].join());
    const E=loadEngine(S.eng),o={horizon:5,rules:'base',startDate:'2025-01-02',principal:20000,monthlyAdd:0};E.setFeeRate(0.0025);const g1=E.paperRunSig(o);E.setFeeRate(0.001);const g2=E.paperRunSig(o);E.setFeeRate(0.0025);
    t('P3 듀얼가드 저장본 서명(paperRunSig)에 공통 율 — 바뀌면 다시 재생 · 엔진 기본 율 0.25% · 범위 밖은 무시',g1!==g2&&/\|f0\.0025$/.test(g1)&&E.paperRunSig(o)===g1&&E.setFeeRate(0.5)===0.0025&&E.setFeeRate('x')===0.0025,[g1,g2].join(' / ')); }

  // ── W. 배선 ──
  { // 운영 — 사용자 문서 → setCommonFee → JK_FEE · 엔진 · 화면 글자
    const kc={};vm.createContext(kc);vm.runInContext(S.fee,kc);
    const spans=[{textContent:'0.25%'},{textContent:'0.25%'}],eng=[];
    const c={console,window:{JKFee:kc.JKFee,JKPlanSessionEngine:{setFeeRate:r=>eng.push(r)}},document:{querySelectorAll:q=>q==='.jk-fee-pct'?spans:[]}};
    vm.createContext(c);vm.runInContext('var JK_FEE=0.0025;\n'+fnOf(S.idx,'function jkFeePctText()')+'\n'+fnOf(S.idx,'function setCommonFee(r)')+'\nthis.get=()=>JK_FEE;',c);
    c.setCommonFee(kc.JKFee.fromDoc({commonFee:{rate:0.001}}));const g1=c.get(),t1=spans.map(s=>s.textContent).join();
    c.setCommonFee(5);const g2=c.get();
    t('W1 운영 setCommonFee — 문서 0.1% → JK_FEE 0.001 · 듀얼가드 엔진에도 · 화면 글자 0.1% · 잘못된 값은 기본 0.25%',g1===0.001&&eng[0]===0.001&&t1==='0.1%,0.1%'&&g2===0.0025&&eng[1]===0.0025,J([g1,eng,t1,g2]));
    const pr=fnOf(S.idx,'async function pullRemote(){'),i1=pr.indexOf('setCommonFee(window.JKFee?window.JKFee.fromDoc(d):null);'),i2=pr.indexOf('const hasV2=');
    t('W1 운영 pullRemote — 사용자 문서를 읽자마자(장부를 되살리기 전에) 공통 율을 받는다 · jk-fee.js · 엔진 캐시 판 10',i1>0&&i2>i1&&/<script src="\/jk-fee\.js\?v=1\.0\.0"><\/script>/.test(S.idx)&&/plan-session-engine\.js\?v=10"/.test(S.idx)&&/plan-session-engine\.js\?v=10"/.test(S.plan),i1+'/'+i2);
    // 플랜
    const pe=[],pc2={console,window:{JKFee:kc.JKFee,JKPlanSessionEngine:{setFeeRate:r=>pe.push(r)}},document:{querySelectorAll:()=>[]}};pc2.JKPlanSessionEngine=pc2.window.JKPlanSessionEngine;
    vm.createContext(pc2);vm.runInContext('var ALPHA_FEE_RATE=0.0025;\n'+fnOf(S.plan,'function planApplyFee(d)')+'\nthis.get=()=>ALPHA_FEE_RATE;',pc2);
    const r1=pc2.planApplyFee({commonFee:{rate:0.001}}),v1=pc2.get(),r2=pc2.planApplyFee({}),v2=pc2.get();
    t('W2 플랜 planApplyFee — 문서 0.1% → ALPHA_FEE_RATE · 엔진 둘 다 0.001 · 없으면 0.25% · 문서를 읽는 두 곳(운영 원장 · 플랜 원장) 모두 부른다',
      r1===0.001&&v1===0.001&&pe[0]===0.001&&r2===0.0025&&v2===0.0025&&(S.plan.match(/planApplyFee\(d\);/g)||[]).length===2&&/<script src="\/jk-fee\.js\?v=1\.0\.0"><\/script>/.test(S.plan),J([r1,v1,pe,r2,v2]));
    // 백테
    const lb=fnOf(S.bt,'async function loadBacktestUserState(uid)'),j1=lb.indexOf('window.jkBtSetFee(window.JKFee?window.JKFee.fromDoc(d):null)'),j2=lb.indexOf('restoreBtStateFrom');
    const bc={console,window:{JKFee:kc.JKFee},document:{querySelectorAll:()=>[]}};vm.createContext(bc);vm.runInContext('var JK_FEE=0.0025;\n'+fnOf(S.bt,'function jkBtSetFee(r)')+'\nthis.get=()=>JK_FEE;',bc);
    bc.jkBtSetFee(0.001);const b1=bc.get();bc.jkBtSetFee(-1);const b2=bc.get();
    t('W3 백테 — 설정을 되살리기(다시 돌리기) 전에 사용자 문서의 율을 받는다 · jkBtSetFee 0.1% · 잘못된 값 0.25% · jk-fee.js · 머리에 지금 율 표시 · v2.19.0',
      j1>0&&j2>j1&&b1===0.001&&b2===0.0025&&/<script src="\/jk-fee\.js\?v=1\.0\.0"><\/script>/.test(S.bt)&&/비용 반영 수수료 = 공통 <span class="jk-fee-pct">/.test(S.bt)&&/id="btVer"[^>]*>v2\.19\.0</.test(S.bt),J([j1,j2,b1,b2]));
    // costOf — 국내도 같은 율 (운영 · 백테 글자 그대로 같다)
    for(const [nm,src] of [['운영',S.idx],['백테',S.bt]]){
      const cc={console};vm.createContext(cc);vm.runInContext('var JK_FEE=0.001;\n'+lineOf(src,/const COST_FEE=[^\n]*/)+'\n'+lineOf(src,/const isKRW=[^\n]*/)+'\n'+lineOf(src,/const KR_STOCK_ETF=new Set\(\[[\s\S]*?\]\);/)+'\n'
        +lineOf(src,/const krCode=[^\n]*/)+'\n'+lineOf(src,/const krTaxRate=[^\n]*/)+'\n'+fnOf(src,'function costOf(t)'),cc);
      t(`W4 ${nm} costOf — 미국 · 국내(069500 · 0104N0) 모두 공통 율 0.1% (예전 국내 0.015%) · 세금은 그대로`,cc.costOf('SOXL').fee===0.001&&cc.costOf('069500').fee===0.001&&cc.costOf('0104N0').fee===0.001&&cc.costOf('SOXL').taxRate===0.22&&cc.costOf('069500').taxRate===0,J([cc.costOf('SOXL'),cc.costOf('069500')]));
    }
    t('W4 백테 모멘텀 로테 — 미국 = 공통 율 + 슬리피지 0.05% · 국내 = 공통 율(고정 0.30% · 0.015% 아님)',/get fee\(\)\{ return costOf\('SPY'\)\.fee\+COST_SLIP; \}/.test(S.bt)&&/get fee\(\)\{ return costOf\('069500'\)\.fee; \}/.test(S.bt)&&!/fee:0\.0030/.test(S.bt)&&!/fee:0\.00015/.test(S.bt));
    // 서버
    t('W5 서버 자동주문 — 사용자 문서 → feeRateFromDoc → imOrders(fee) · 앱과 같은 규칙 파일(_fee.js)',/import \{ feeRateFromDoc \} from "\.\/_fee\.js";/.test(S.at)&&/const fee = feeRateFromDoc\(rawDoc\);/.test(S.at)&&/imOrders\(\{ st, hist: s\.hist \|\| \[\], close, days, fee \}\)/.test(S.at));
    // 세후 — 다 판다고 볼 때 매도 수수료 모든 탭 · 두 번 떼지 않음
    const ac={console,costOf:()=>({fee:0.0025}),capGainTax:()=>0,Math,Number};vm.createContext(ac);vm.runInContext(fnOf(S.idx,'function paperAfterTaxAcc(sym, opt)'),ac);
    const A=ac.paperAfterTaxAcc('SOXL',{});A.step('2024-01-02',1000,1000,{realized:0,turnover:1000,held:1000,cost:1000});const fin=A.done();
    t('W6 세후 — 수수료를 센 장부(addFee 없음)도 다 판다고 볼 때 매도 수수료 0.25% 를 뗀다 · 장부의 매수 수수료를 다시 붙이지 않는다 · 더 붙일 탭 없음',
      fin&&near(fin.final,1000-2.5)&&near(fin.fee,2.5)&&/const PAPER_NOFEE_TABS=new Set\(\[\]\);/.test(S.idx),J(fin)); }
  return bad;
}

const MUT=[
  ['설정: 저장할 때 merge 빠짐(운영 장부를 지움)','setjs',s=>s.replace("C.K.docPatch(r), {merge:true});","C.K.docPatch(r));")],
  ['설정: 저장값 안 읽고 늘 0.25','setjs',s=>s.replace("const inp=el('feeRatePct'); if(inp) inp.value=C.K.pct(r);","const inp=el('feeRatePct'); if(inp) inp.value='0.25';")],
  ['설정: 범위 검사 없음(2% 넘게 받음)','fee',s=>s.replace("x>=0&&x<=MAX","x>=0")],
  ['서버 규칙: 기본 0.1%(브라우저와 다름)','sfee',s=>s.replace('return x == null ? FEE_DEFAULT : x;','return x == null ? 0.001 : x;')],
  ['하위 탭 목록에 수수료 탭 빠짐','acc',s=>s.replace(",['fee','💸 수수료']","")],
  ['무매: 잔금에서 수수료 안 뺌(옛 코드)','idx',s=>s.replace("const bal=st.principal+realized+divTotal-inv-withdrawn-saved-fees;","const bal=st.principal+realized+divTotal-inv-withdrawn-saved;")],
  ['무매: 단리 인출 판정에 수수료 안 뺌','idx',s=>s.replace("const cashNow=P0+realized+divTotal-withdrawn-saved-fees;","const cashNow=P0+realized+divTotal-withdrawn-saved;")],
  ['무매: 복합 매수 다리 수수료 빠짐','idx',s=>s.replace("inv+=bp*bq; totbuy+=bp*bq; fee+=bp*bq*FR; } };","inv+=bp*bq; totbuy+=bp*bq; } };")],
  ['VR: 기록의 수수료 칸(옛 코드 · 손 기록 0)','idx',s=>s.replace("const FR=(typeof JK_FEE!=='undefined')?JK_FEE:0.0025, feeOf=(h,amt)=>h.seed?0:amt*FR;","const FR=(typeof JK_FEE!=='undefined')?JK_FEE:0.0025, feeOf=(h,amt)=>+h.fee||0;")],
  ['VR: 이어받은 보유에도 수수료','idx',s=>s.replace("feeOf=(h,amt)=>h.seed?0:amt*FR;","feeOf=(h,amt)=>amt*FR;")],
  ['로테: 기록 칸 우선(옛 코드)','idx',s=>s.replace("      const gross=pr*sq;\n      const fee=x.seed?0:gross*FEE;","      const gross=pr*sq;\n      const fee=(x.fee!=null?+x.fee:gross*FEE);")],
  ['섀넌: 기록의 수수료 칸(옛 코드)','idx',s=>s.replace("fee=h.seed?0:amt*FR;\n    if(!(q>0)){ rows.push(r); continue; }","fee=+h.fee||0;\n    if(!(q>0)){ rows.push(r); continue; }")],
  ['적립: 수수료 없이 주수(옛 코드)','idx',s=>s.replace("const q=a/(p*f1); inv+=a;","const q=a/p; inv+=a;")],
  ['ASAP: 기록 qty 그대로(옛 코드 · 수수료 없음)','idx',s=>s.replace("q=p>0?amt/(p*f1):q0;","q=q0;")],
  ['ASAP: 매도 수수료 빠짐','idx',s=>s.replace("fee=amt*FR;\n      realized+=amt-fee-avg*q;","fee=0;\n      realized+=amt-fee-avg*q;")],
  ['듀얼가드: 기록의 수수료 칸(옛 코드)','eng',s=>s.replace("fee=e.seed?0:alphaFee(q,p),k=sym==='TECL'","fee=Math.max(0,+e.fee||0),k=sym==='TECL'")],
  ['듀얼가드: 토스 식(10$ 이하 무료 · 센트 내림)','eng',s=>s.replace("return gross*FEE_RATE;","return gross<=10?0:Math.floor(gross*FEE_RATE*100)/100;")],
  ['듀얼가드: 저장본 서명에 율 빠짐','eng',s=>s.replace(",'f'+FEE_RATE].join('|');}","].join('|');}")],
  ['서버 무매: 잔금에 수수료 없음','im',s=>s.replace('const bal = (+st.principal || 0) + realized + divTotal - inv - withdrawn - saved - fees;','const bal = (+st.principal || 0) + realized + divTotal - inv - withdrawn - saved;')],
  ['서버 무매: 주문 수량 수수료 0(옛 코드)','im',s=>s.replace('rows: imRowsOf(st), fee: c.feeRate, cur }))','rows: imRowsOf(st), fee: 0, cur }))')],
  ['서버 자동주문: 율을 안 넘김','at',s=>s.replace('imOrders({ st, hist: s.hist || [], close, days, fee })','imOrders({ st, hist: s.hist || [], close, days })')],
  ['플랜 무매: 잔금에 수수료 없음','plan',s=>s.replace("const bal=(+st.principal||0)+realized+divTotal-inv-withdrawn-saved-fees;","const bal=(+st.principal||0)+realized+divTotal-inv-withdrawn-saved;")],
  ['플랜 VR: 기록의 수수료 칸','plan',s=>s.replace("fee=h.seed?0:amt*ALPHA_FEE_RATE,q=+h.qty||0;","fee=+h.fee||0,q=+h.qty||0;")],
  ['플랜 슬리브: 수수료 안 뺌(옛 코드)','plan',s=>s.replace("cash+=buy?-amt*(1+ALPHA_FEE_RATE):amt*(1-ALPHA_FEE_RATE);","cash+=buy?-amt:amt;")],
  ['플랜: 문서를 읽는 한 곳에서 율을 안 받음','plan',s=>s.replace("    planApplyFee(d);   // 공통 수수료율(설정 › 💸 수수료) — 장부를 그리기 전에","")],
  ['운영 주문표: 수량 수수료 0(옛 코드)','idx',s=>s.replace("avg:c.avg, rows, fee:(typeof JK_FEE!=='undefined'?JK_FEE:0.0025), cur:curOf(st)});","avg:c.avg, rows, fee:0, cur:curOf(st)});")],
  ['모의 지문에 율 빠짐','idx',s=>s.replace("return 'r'+SIM_RULE_VER+'|f'+((typeof JK_FEE!=='undefined')?JK_FEE:0.0025)+'|'+","return 'r'+SIM_RULE_VER+'|'+")],
  ['모의 목록 줄 서명에 율 빠짐','idx',s=>s.replace(", (typeof JK_FEE!=='undefined')?JK_FEE:0.0025]);   // 공통 수수료율 — 바꾸면 모든 줄을 다시 센다","]);")],
  ['운영: 문서에서 율을 안 받음','idx',s=>s.replace("    setCommonFee(window.JKFee?window.JKFee.fromDoc(d):null);\n","")],
  ['운영: 엔진에 율을 안 넘김','idx',s=>s.replace("if(E&&E.setFeeRate) E.setFeeRate(JK_FEE);","")],
  ['costOf: 국내 0.015%(옛 코드)','idx',s=>s.replace("? {fee:F, slip:COST_SLIP, taxRate:krTaxRate(t),","? {fee:0.00015, slip:COST_SLIP, taxRate:krTaxRate(t),")],
  ['세후: 수수료 센 장부는 매도 수수료 안 뗌(옛 코드)','idx',s=>s.replace("liq=k*liqRate*last.held","liq=k*feeRate*last.held")],
  ['세후: 무매 · 적립 · ASAP 에 수수료를 또 붙임(두 번)','idx',s=>s.replace("const PAPER_NOFEE_TABS=new Set([]);","const PAPER_NOFEE_TABS=new Set(['inf','dca','asap']);")],
  ['백테: 설정을 되살린 뒤에 율을 받음','bt',s=>s.replace("  if(typeof window.jkBtSetFee==='function')window.jkBtSetFee(window.JKFee?window.JKFee.fromDoc(d):null);   // 공통 수수료율 — 설정을 되살리기(다시 돌리기) 전에\n","").replace("if(typeof window.restoreBtStateFrom==='function')window.restoreBtStateFrom(d.backtestState||null);","if(typeof window.restoreBtStateFrom==='function')window.restoreBtStateFrom(d.backtestState||null);\n  if(typeof window.jkBtSetFee==='function')window.jkBtSetFee(window.JKFee?window.JKFee.fromDoc(d):null);")],
];
(async()=>{
  const t0=Date.now(),bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 공통 수수료: 설정 탭(읽기 · 저장 merge · 범위) · 브라우저 = 서버 규칙 · 장부 9벌 × 율 2개(거래금액 × 율 · 기록 칸 무시 · seed 0 · 앱 = 서버 = 플랜) · 주문 수량 · 모의 지문 3곳 · 배선(운영 · 플랜 · 백테 · 서버) · costOf 국내 · 세후 매도 수수료');
  let red=0;
  for(const [name,key,mut] of MUT){
    const S2={...SRC,[key]:mut(SRC[key])};
    if(S2[key]===SRC[key]){console.error('FAIL 변이 대상 없음: '+name);process.exit(1);}
    let b;try{b=await check(S2);}catch(e){b=['던짐 '+e.message];}
    if(b.length){red++;console.log('PASS 변이 빨간불: '+name);}else{console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  }
  console.log(`ALL PASS common fee · 변이 ${red}/${MUT.length} red · ${((Date.now()-t0)/1000).toFixed(1)}s`);
})();
