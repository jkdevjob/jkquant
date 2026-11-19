#!/usr/bin/env node
'use strict';
/* 단타 연구 봇 공통 수수료 (단타 v1.50.0 · 클로드 v2.32.0 · 2026-11-19)
 * 사용자: "단타 연구 봇에도 공통 수수료 적용해"
 * 실제 서버 함수 · 워커 · 밤 스크립트 · 화면 코드를 임시 폴더에 그대로 복사해 돌린다(재구현 없음). 값 시험 + 변이 시험(고친 곳을 되돌리면 빨간불).
 *   S 규칙 — 왕복 비용 = 공통 율 × 2 + 수수료 아닌 몫(세금 · 미끄러짐) · 옛 수수료를 넣으면 옛 상수가 그대로 나온다 · 범위 밖 율은 기본 0.25%
 *   P 파이썬 = JS — scripts/scalp_cost.py 가 _scalp_cost.js 와 같은 값 · 클로드 연구실 FAIR_COST = 대결 COSTS · 전략 costRoundTripPct
 *   B 화면 — 단타(scalping.html SCALP_FEE) · 클로드(claude.html CL_NONFEE) 기본표 = 서버표 · 받은 율로 문구 · 시초가 마찰
 *   O 율 읽기 — 서비스 계정으로 소유자 users/{uid}.commonFee 만(mask) · 없으면 기본(출처 default) · 5분 캐시 · 실패 1분
 *   E /api/common-fee — 감시키(세 이름 중 하나) 또는 소유자만 · 율 · 왕복 · 수수료 아닌 몫 표
 *   F 워커 율 받기 — 성공 10분 · 실패 1분 · 401 이면 기본
 *   L 쓰는 곳 — 클로드 ①②⑤ 비용식 · 하루 마감 COST · 종가 30분 신호 스냅샷 · 순손익 · 시초가 마찰 · 대결 표 · 코인 알림 글
 *              · 워커(코인 · SOXL 지난 거래 마찰 유지 · 데이트레이딩 새 거래 율 · 옛 기록 0.25 · 종가 30분 매도 = 신호가 남긴 비용)
 *   W 배선 — 진입점마다 율을 넣는다(Pages useOwnerFee · Worker fetchCommonFee · 밤 워크플로 키) · 옛 상수 남지 않음 */
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),crypto=require('crypto');
const {execFileSync}=require('child_process'),{pathToFileURL}=require('url');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const FILES={sc:'functions/api/_scalp_cost.js',own:'functions/api/_owner_fee.js',ep:'functions/api/common-fee.js',live:'functions/api/claude-live.js',
  day:'functions/api/_claude_day.js',c30:'functions/api/_closing30.js',c30o:'functions/api/_closing30-outcomes.js',op:'functions/api/_opening.js',
  duel:'functions/api/_scalping_duel.js',push:'functions/api/_claude_push.js',vts:'functions/api/vts-reconcile.js',tg:'functions/api/claude-telegram.js',
  om:'functions/api/opening-monitor.js',cm:'functions/api/closing30-monitor.js',dl:'functions/api/scalping-duel.js',
  wd:'worker/daytrading-scheduler/src/index.js',wg:'worker/global-intraday-scheduler/src/index.js',wo:'worker/opening-scheduler/src/index.js',
  py:'scripts/scalp_cost.py',lab:'scripts/claude_lab.py',scl:'scalping.html',cl:'claude.html',
  wfD1:'.github/workflows/daily1-shadow-research.yml',wfCr:'.github/workflows/crypto-research.yml',wfSd:'.github/workflows/scalping-data.yml',
  wfGd:'.github/workflows/opening-gapdown-research.yml',wfNt:'.github/workflows/nightly-scalping-research.yml'};
const SRC=Object.fromEntries(Object.entries(FILES).map(([k,f])=>[k,rd(f)]));
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error('짝 없음 '+marker);};
const lineOf=(src,re)=>{const m=src.match(re);if(!m)throw Error('없음: '+re);return m[0];};
const near=(a,b,e=1e-9)=>Number.isFinite(+a)&&Number.isFinite(+b)&&Math.abs(a-b)<=e;
const J=x=>JSON.stringify(x);
const KINDS=['kr','krDay','etf','etfFlat','etfFair','coin','us'];

/* 원본 트리를 임시 폴더에 복사하고 S 의 내용으로 덮어쓴다 — 변이마다 새 폴더라 모듈 상태 · 캐시가 섞이지 않는다 */
function tree(S){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scalp-fee-'));
  const cp=(rel)=>{const from=path.join(root,rel),to=path.join(dir,rel);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);};
  for(const f of fs.readdirSync(path.join(root,'functions/api')))if(/\.(m?js)$/.test(f))cp('functions/api/'+f);
  for(const w of ['daytrading-scheduler','global-intraday-scheduler','opening-scheduler'])for(const f of fs.readdirSync(path.join(root,'worker',w,'src')))cp('worker/'+w+'/src/'+f);
  for(const f of ['jk-paper-store.mjs'])if(fs.existsSync(path.join(root,f)))cp(f);
  cp('scripts/scalp_cost.py');cp('scripts/claude_lab.py');
  for(const [k,rel] of Object.entries(FILES)){
    if(!/^(functions|worker|scripts)\//.test(rel))continue;
    let s=S[k];
    if(rel.startsWith('worker/'))s=s.replace('import { DurableObject } from "cloudflare:workers";','const DurableObject=class {};');
    if(k==='wd')s+='\nexport {blankTrade as __blankTrade};\n';
    fs.writeFileSync(path.join(dir,rel),s);
  }
  return dir;
}
const imp=(dir,rel)=>import(pathToFileURL(path.join(dir,rel)).href);

/* 가짜 구글(토큰 · profiles · users 문서) — 요청 주소를 남긴다 */
function fakeGoogle({rate,status=200,profiles=true,calls=[]}={}){
  return async(u,o={})=>{
    calls.push(String(u));
    const res=(code,obj)=>({ok:code>=200&&code<300,status:code,json:async()=>obj});
    if(String(u).startsWith('https://oauth2.googleapis.com/token'))return res(200,{access_token:'tok'});
    if(String(u).includes('/documents/profiles?'))return res(200,{documents:profiles?[{name:'projects/p/databases/(default)/documents/profiles/U1',fields:{email:{stringValue:'owner@test.example'}}}]:[]});
    if(String(u).includes('/documents/users/U1'))return status!==200?res(status,{}):res(200,{fields:rate===undefined?{}:{commonFee:{mapValue:{fields:{rate:Number.isInteger(rate)?{integerValue:String(rate)}:{doubleValue:rate},updated:{integerValue:'123'}}}}}});
    return res(404,{});
  };
}
const KEY=crypto.generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
const SA=JSON.stringify({client_email:'sa@test.example',private_key:KEY,project_id:'p'});
const ENV={FIREBASE_SERVICE_ACCOUNT:SA,OWNER_EMAIL:'owner@test.example'};

/* 화면 함수 묶음 */
function sclCtx(S,fee){
  const c={console,Math,Number,isFinite,document:{querySelectorAll:()=>[],getElementById:()=>null}};vm.createContext(c);
  vm.runInContext(lineOf(S.scl,/let SCALP_FEE=\{[^\n]*\};/)+'\n'+['function scalpCost(','function scalpFeeLabel(','function openingFixedFrictionPct(','function duelCostNote(','function openingKrTickSize(','function openingFrictionPct(']
    .map(m=>fnOf(S.scl,m)).join('\n')+'\nconst OPENING_VTS_MIN_MATCHES=30, OPENING_FALLBACK_TICKS_PER_SIDE=2.5;let OPENING_FRICTION_CAL={completeMatches:0,observedRoundTripSlippagePct:null};\n'
    +(fee?'SCALP_FEE='+J(fee)+';':'')+'\nthis.SCALP_FEE=SCALP_FEE;',c);
  return c;
}
function clCtx(S,live){
  const c={console,Math,Number,isFinite,LIVE:live};vm.createContext(c);
  vm.runInContext(lineOf(S.cl,/var CL_NONFEE=\{[^\n]*\};/)+'\n'+['function clFeeRate(','function clCost(','function clFeeLabel(','function duelCostNote('].map(m=>fnOf(S.cl,m)).join('\n')+'\nthis.CL_NONFEE=CL_NONFEE;',c);
  return c;
}

async function check(S){
  const bad=[],t=(name,ok,info)=>{if(!ok)bad.push(name+(info?' — '+String(info).slice(0,300):''));};
  const dir=tree(S);
  const realFetch=globalThis.fetch;
  try{
    const C=await imp(dir,FILES.sc);
    /* S 규칙 */
    C._resetScalpFeeForTest();
    t('S1 기본 0.25% — 국내 0.70 · 데이트레이딩 0.72 · ETF 0.50 · ETF 고정 0.60 · 대결 ETF 0.62 · 코인 0.54 · 미국 0.50',
      J(KINDS.map(k=>C.scalpCostPct(k)))===J([0.7,0.72,0.5,0.6,0.62,0.54,0.5]),J(KINDS.map(k=>C.scalpCostPct(k))));
    t('S2 옛 수수료를 넣으면 옛 상수 — 국내 0.015%: 0.23 · 0.25 · 0.03 · 0.13 · 0.15 / 업비트 0.05%: 0.14 / 미국 0.10%: 0.20',
      J(['kr','krDay','etf','etfFlat','etfFair'].map(k=>C.scalpCostPct(k,0.00015)))===J([0.23,0.25,0.03,0.13,0.15])&&C.scalpCostPct('coin',0.0005)===0.14&&C.scalpCostPct('us',0.001)===0.2);
    C.setScalpFee(0.03,'user');const r1=[C.scalpFeeRate(),C.scalpFeeSource()];C.setScalpFee('abc','user');const r2=[C.scalpFeeRate(),C.scalpFeeSource()];
    C.setScalpFee(0,'user');const r3=[C.scalpFeeRate(),C.scalpCostPct('kr'),C.scalpCostPct('us')];
    t('S3 범위 밖(3% · 글자) → 기본 0.25% · 출처 default / 0% 는 그대로(국내 = 세금 0.20 · 미국 0)',
      J(r1)===J([0.0025,'default'])&&J(r2)===J([0.0025,'default'])&&J(r3)===J([0,0.2,0]),J([r1,r2,r3]));
    C.setScalpFee(0.001,'user');
    t('S4 기록 스냅샷(0.1%) — 비용 모형 · 율 · 출처 · 수수료 왕복 · 수수료 아닌 몫 · 합',
      J(C.scalpCostSnapshot('kr'))===J({costModel:'common-fee-v1',feeRatePct:0.1,feeSource:'user',feeRoundTripPct:0.2,nonFeePct:0.2,costPct:0.4}),J(C.scalpCostSnapshot('kr')));

    /* P 파이썬 = JS */
    const pyEnv={...process.env,JKQ_COMMON_FEE:'0.001'};for(const k of ['JKQ_FEE_KEY','KEY','JKQ_MONITOR_KEY','MONITOR_KEY','AUTOTRADE_KEY'])delete pyEnv[k];
    let py=null;
    try{
      py=JSON.parse(execFileSync('python3',['-c',[
        'import json, scalp_cost as SC, claude_lab as L',
        'out={"info":SC.fee_info(),"fair":L.FAIR_COST,"coinbo":L.COIN_BO["costRoundTripPct"],"soxlmr":L.SOXL_MR["costRoundTripPct"],"btc":L.BTC["costRoundTripPct"],"rates":{}}',
        'for r in [0.0025,0.001,0,0.00015,0.0005,0.02]:',
        '    out["rates"][str(r)]=[SC.cost_pct(k, r) for k in '+J(KINDS)+']',
        'SC.set_fee(0.5); out["bad"]=SC.fee_info()',
        'print(json.dumps(out))'].join('\n')],{cwd:path.join(dir,'scripts'),env:pyEnv,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
    }catch(e){bad.push('P0 파이썬 실행 실패 — '+String(e.stderr||e.message).slice(0,300));}
    if(py){
      const same=Object.entries(py.rates).every(([r,v])=>J(v)===J(KINDS.map(k=>C.scalpCostPct(k,+r))));
      t('P1 scalp_cost.py = _scalp_cost.js — 율 6개 × 종류 7개(0.25 · 0.1 · 0 · 0.015 · 0.05 · 2%)',same,J(py.rates));
      t('P2 파이썬 율 출처 — 환경변수 JKQ_COMMON_FEE 0.1% · 범위 밖(50%)은 기본 0.25% · default',py.info.rate===0.001&&py.info.source==='env'&&py.bad.rate===0.0025&&py.bad.source==='default',J([py.info,py.bad]));
      C.setScalpFee(0.001,'env');const D=await imp(dir,FILES.duel),cs=JSON.parse(J(D.COSTS));
      t('P3 클로드 연구실 FAIR_COST(0.1%) = 대결 COSTS — 국내 · 대결 ETF · 코인 · 미국',
        near(py.fair.opening,cs.gpt.opening)&&near(py.fair.daytrading_stock,cs.gpt.daytrading)&&near(py.fair.daytrading_etf,cs.claude.daytrading)&&near(py.fair.crypto,cs.gpt.crypto)&&near(py.fair.soxl,cs.gpt.soxl)
        &&J(cs)===J({gpt:{opening:0.42,daytrading:0.42,crypto:0.24,soxl:0.2},claude:{opening:0.42,daytrading:0.32,crypto:0.24,soxl:0.2}}),J([py.fair,cs]));
      t('P4 클로드 전략 왕복 비용(0.1%) — 코인 돌파 · BTC 0.24 · SOXL 과매도 0.20',py.coinbo===0.24&&py.btc===0.24&&py.soxlmr===0.2,J([py.coinbo,py.btc,py.soxlmr]));
    }

    /* B 화면 */
    const sc0=sclCtx(S),scN=sc0.SCALP_FEE.nonFeePct;
    t('B1 단타 화면 기본표 = 서버표(NON_FEE_PCT) · 기본 율 0.25% · 왕복 0.5',J(scN)===J(C.NON_FEE_PCT)&&sc0.SCALP_FEE.rate===0.0025&&sc0.SCALP_FEE.roundTripPct===0.5,J(sc0.SCALP_FEE));
    const sc1=sclCtx(S,{rate:0.001,source:'user',roundTripPct:0.2,nonFeePct:C.NON_FEE_PCT});
    t('B2 단타 화면(0.1% 받음) — 국내 0.40 · 데이트레이딩 0.42 · 시초가 마찰 = 0.40 + 2.5틱 × 2 · 문구 율 0.1%',
      sc1.scalpCost('kr')===0.4&&sc1.scalpCost('krDay')===0.42&&near(sc1.openingFrictionPct(15000,{completeMatches:0}),0.4+2*2.5*10/15000*100)&&sc1.scalpFeeLabel()==='0.1%'
      &&/코인 양쪽 0\.24% · 미국 양쪽 0\.20%/.test(sc1.duelCostNote({}))&&/국내 시초가·데이트레이딩 0\.25%/.test(sc1.duelCostNote({costs:{gpt:{opening:0.25}}})),
      J([sc1.scalpCost('kr'),sc1.openingFrictionPct(15000,{completeMatches:0}),sc1.duelCostNote({})]));
    const cl0=clCtx(S,null),cl1=clCtx(S,{fee:{rate:0.001,source:'user'}}),cl2=clCtx(S,{fee:{rate:5}});
    t('B3 클로드 화면 기본표 = 서버표 · 받은 율(0.1%) 코인 0.24 · 범위 밖은 기본(코인 0.54) · 대결 문구는 밤 계산 표 먼저',
      J(cl0.CL_NONFEE)===J(C.NON_FEE_PCT)&&cl1.clCost('coin')===0.24&&cl1.clCost('us')===0.2&&cl2.clCost('coin')===0.54&&cl0.clCost('kr')===0.7
      &&/ETF 0\.15%/.test(cl1.duelCostNote({costs:{daytrading_etf:0.15}}))&&/공통 수수료 0\.1% × 2/.test(cl1.duelCostNote({})),
      J([cl0.CL_NONFEE,cl1.clCost('coin'),cl2.clCost('coin'),cl1.duelCostNote({})]));

    /* O 율 읽기(서비스 계정) */
    const O=await imp(dir,FILES.own);
    const calls=[];O._resetOwnerFeeForTest();
    const v1=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0.001,calls}),now:1e6});
    const n1=calls.length,v1b=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0.002,calls}),now:1e6+299e3});
    const v1c=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0.002,calls}),now:1e6+301e3});
    t('O1 소유자 문서의 commonFee 만 읽는다(mask) · 율 0.1% · 출처 user · 5분 안은 다시 안 읽고 5분 뒤 다시',
      v1.rate===0.001&&v1.source==='user'&&v1.updated===123&&calls.some(u=>/\/documents\/users\/U1\?mask\.fieldPaths=commonFee$/.test(u))&&v1b.rate===0.001&&calls.length>n1&&v1c.rate===0.002,J([v1,v1b,v1c,calls]));
    O._resetOwnerFeeForTest();const v2=await O.ownerFeeRate({},{now:1});
    O._resetOwnerFeeForTest();const v3=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({}),now:1});
    O._resetOwnerFeeForTest();const v4=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0}),now:1});
    O._resetOwnerFeeForTest();const v5=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0.001,status:500}),now:1});
    const v5b=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0.001}),now:1+61e3});
    O._resetOwnerFeeForTest();const v6=await O.ownerFeeRate(ENV,{fetchImpl:fakeGoogle({rate:0.5}),now:1});
    t('O2 서비스 계정 없음 · 저장 안 함 · 범위 밖(50%) → 기본 0.25% · default / 0% 저장은 0 · user / 읽기 실패는 기본 + 이유 · 1분 뒤 다시',
      v2.rate===0.0025&&v2.source==='default'&&/FIREBASE_SERVICE_ACCOUNT/.test(v2.error)&&v3.source==='default'&&v3.rate===0.0025&&!v3.error&&v4.rate===0&&v4.source==='user'
      &&v5.source==='default'&&/500/.test(v5.error)&&v5b.rate===0.001&&v5b.source==='user'&&v6.source==='default'&&v6.rate===0.0025,J([v2,v3,v4,v5,v5b,v6]));
    O._resetOwnerFeeForTest();C._resetScalpFeeForTest();
    const u1=await O.useOwnerFee(ENV,{fetchImpl:fakeGoogle({rate:0.001}),now:5});
    t('O3 useOwnerFee — 읽은 율을 비용 모듈에 넣는다(국내 0.40) · 돌려준 값에 율 · 출처',u1.rate===0.001&&u1.source==='user'&&C.scalpCostPct('kr')===0.4&&C.scalpFeeSource()==='user',J(u1));

    /* E /api/common-fee */
    O._resetOwnerFeeForTest();globalThis.fetch=fakeGoogle({rate:0.001});
    const E=await imp(dir,FILES.ep),req=h=>new Request('https://p.test/api/common-fee',{headers:h});
    const e0=await E.onRequestGet({request:req({}),env:{...ENV,AUTOTRADE_KEY:'k1'}});
    const e1=await E.onRequestGet({request:req({'x-monitor-key':'k2'}),env:{...ENV,DAYTRADING_MONITOR_KEY:'k2',AUTOTRADE_KEY:'k1'}});
    const e2=await E.onRequestGet({request:req({'x-monitor-key':'k1'}),env:{...ENV,DAYTRADING_MONITOR_KEY:'k2',AUTOTRADE_KEY:'k1'}});
    const e3=await E.onRequestGet({request:req({'x-monitor-key':'zz'}),env:{...ENV,AUTOTRADE_KEY:'k1'}});
    const j1=await e1.json();
    t('E1 키 없음 · 틀린 키 401 / 감시키(DAYTRADING · AUTOTRADE 어느 쪽이든) 200 — 율 0.1% · 왕복 0.2 · 출처 user · 수수료 아닌 몫 표',
      e0.status===401&&e3.status===401&&e1.status===200&&e2.status===200&&j1.ok===true&&j1.rate===0.001&&j1.pct===0.1&&j1.roundTripPct===0.2&&j1.source==='user'
      &&J(j1.nonFeePct)===J(C.NON_FEE_PCT)&&j1.costModel==='common-fee-v1',J([e0.status,e1.status,e2.status,e3.status,j1]));
    globalThis.fetch=realFetch;

    /* F 워커 율 받기 */
    C._resetScalpFeeForTest();const fcalls=[];
    const okF=async(u,o)=>{fcalls.push([u,o&&o.headers&&o.headers['x-monitor-key']]);return {ok:true,status:200,json:async()=>({ok:true,rate:0.001,source:'user'})};};
    const f1=await C.fetchCommonFee('https://pages.test/','mk',{fetchImpl:okF,now:1e6}),f1b=await C.fetchCommonFee('https://pages.test','mk',{fetchImpl:okF,now:1e6+599e3});
    const nOk=fcalls.length;
    C._resetScalpFeeForTest();
    const no=async()=>({ok:false,status:401,json:async()=>({ok:false})});
    const f2=await C.fetchCommonFee('https://pages.test','x',{fetchImpl:no,now:1e6}),f2b=await C.fetchCommonFee('https://pages.test','x',{fetchImpl:okF,now:1e6+61e3});
    t('F1 워커 — /api/common-fee 에 감시키 · 10분 둔다 · 401 은 기본 0.25% · 이유 · 실패는 1분 뒤 다시',
      f1.rate===0.001&&f1.source==='user'&&nOk===1&&fcalls[0][0]==='https://pages.test/api/common-fee'&&fcalls[0][1]==='mk'&&f1b.rate===0.001
      &&f2.rate===0.0025&&f2.source==='default'&&/401/.test(f2.error)&&f2b.rate===0.001,J([f1,f1b,f2,f2b,fcalls]));

    /* L 쓰는 곳 — 0.1% 로 둔다(수수료 왕복 0.2) */
    C.setScalpFee(0.001,'user');
    const LV=await imp(dir,FILES.live),DY=await imp(dir,FILES.day);
    t('L1 클로드 ① 시초가 = 세금 0.20 + 0.2 + 1.5틱 × 2 · ② ETF = 0.2 + 2틱 · ⑤ 종가 30분 = 0.2 + 반 호가',
      near(LV.d1CostPct(1000),0.4+3*1/1000*100)&&near(LV.etfRuleCost(8000),0.2+2*5/8000*100)&&near(LV.c30CostPct(9800),0.2+2.5/9800*100)&&near(LV.c30CostPct(0),0.2),
      J([LV.d1CostPct(1000),LV.etfRuleCost(8000),LV.c30CostPct(9800)]));
    t('L2 클로드 하루 마감 COST(0.1%) — 국내 0.40 · ETF 0.30 · 코인 0.24 · 미국 0.20',J({...DY.COST})===J({kr:0.4,etf:0.3,coin:0.24,us:0.2}),J({...DY.COST}));
    const C30=await imp(dir,FILES.c30),CO=await imp(dir,FILES.c30o);
    const sig=C30.chooseClosingSignals([{code:'A',name:'가',feature:{intradayPct:-1,volumeRatio:2,liquidity:9,signalHm:1504}}],'day',3,[{id:'all',label:'모두',side:'all',threshold:0,volume:0}])[0];
    const at=x=>'2026-11-10T'+x+':00+09:00',oc=CO.closingOutcomes(100,at('15:06'),101,at('15:30'),[]),ocL=CO.closingOutcomes(100,at('15:06'),101,at('15:30'),[],0.23);
    t('L3 종가 30분 — 신호 스냅샷 frictionPct 0.40 · 율 0.1 · 비용 모형 / 순손익 = 1 − 0.40 · 신호가 남긴 옛 비용(0.23)이면 그 값',
      sig&&sig.strategyParams.frictionPct===0.4&&sig.strategyParams.feeRatePct===0.1&&sig.strategyParams.costModel==='common-fee-v1'&&near(C30.closeNetPct(100,101),0.6)
      &&near(oc.finalNetPnlPct,0.6)&&oc.costPct===0.4&&near(ocL.finalNetPnlPct,0.77)&&ocL.costPct===0.23,J([sig&&sig.strategyParams,oc.finalNetPnlPct,ocL.finalNetPnlPct]));
    const OP=await imp(dir,FILES.op),fr=OP.openingFriction(15000,null);
    t('L4 시초가 마찰 — 고정 0.40(세금 0.20 + 0.2) + 2.5틱 × 2 · 기록에 비용 모형 · 율',
      fr.fixedPct===0.4&&near(fr.totalPct,0.4+2*2.5*10/15000*100)&&fr.costModel==='common-fee-v1'&&fr.feeRatePct===0.1,J(fr));
    const D2=await imp(dir,FILES.duel);
    t('L5 대결 같은 비용표 — 시초가 매매 1% → 1 − 0.42 · 클로드 ② ETF 0.32',near(D2.sideDay([{gross:1,entry:100,exit:101}],D2.COSTS.gpt.opening),1-0.42)&&D2.COSTS.claude.daytrading===0.32,
      J([D2.sideDay([{gross:1,entry:100,exit:101}],D2.COSTS.gpt.opening),D2.COSTS.claude.daytrading]));
    const PU=await imp(dir,FILES.push);
    const pl={today:'2026-10-07',tabs:{crypto:{rows:[{code:'KRW-BTC',hold:false,nowPrice:121000000}]}}},sent={'coin:2026-10-06:KRW-BTC:buy':{at:1,price:110000000}},now=Date.parse('2026-10-07T10:30:00+09:00');
    const pe=(live)=>(PU.pushEvents(live,now,sent).find(e=>e.id==='coin:2026-10-06:KRW-BTC:sell')||{}).body;
    C.setScalpFee(0.0025,'default');
    t('L6 코인 매도 알림 글 — /api/claude-live 가 준 율(0.1%) 로 10 − 0.24 · 율 없으면 지금 율(기본 0.54)',
      pe({...pl,fee:{rate:0.001}})==='BTC 09:00 매도(어제 돌파분) 약 +9.76%'&&pe(pl)==='BTC 09:00 매도(어제 돌파분) 약 +9.46%',J([pe({...pl,fee:{rate:0.001}}),pe(pl)]));
    C.setScalpFee(0.001,'user');
    const WG=await imp(dir,FILES.wg);
    const tr={signal:{time:'00:05',ms:1},entry:{time:'00:10',ms:2,hm:10,o:100},entryPrice:100,exit:{bar:{time:'01:00',ms:3,c:101},price:101,reason:'take_profit'},params:{}};
    const lNew=WG.paperLedger('crypto','2026-10-01',tr,{friction:C.scalpCostPct('coin'),now:4});
    const lOld=WG.paperLedger('crypto','2026-10-01',tr,{friction:C.scalpCostPct('coin'),previous:{trades:[{frictionPct:0.14,firstRecordedAt:'x'}]},now:4});
    const old={frictionPct:0.14,trades:[{status:'closed',frictionPct:0.14,signalTime:'00:05',signalMs:1,entryTime:'00:10',entryMs:2,entryHm:10,entryPrice:100,exitTime:'01:00',exitMs:3,exitPrice:101,reason:'take_profit'}]};
    const kept=WG.storedOrbTrade('crypto','2026-10-01',old,{friction:0.24,params:{}},[],5,{});
    t('L7 코인 · SOXL 워커 — 새 거래 마찰 0.24(0.04 + 0.2) · 율 기록 / 이미 남은 거래는 그때 0.14 그대로(손익 = 1 − 0.14) · 지난 거래 이어받기도 0.14',
      lNew.trades[0].frictionPct===0.24&&near(lNew.trades[0].pnlPct,1-0.24)&&lNew.trades[0].costModel==='common-fee-v1'&&lNew.trades[0].feeRatePct===0.1
      &&lOld.trades[0].frictionPct===0.14&&near(lOld.trades[0].pnlPct,1-0.14)&&lOld.frictionPct===0.14&&kept.friction===0.14,J([lNew.trades[0],lOld.trades[0],kept.friction]));
    const WD=await imp(dir,FILES.wd);
    const bt=WD.__blankTrade({code:'005930',signalTime:1000,signalPrice:100},'2026-10-01');
    const bars=[{t:'2026-10-01T10:02:00',o:101,h:101,l:101,c:101}];
    const keptOld=WD.applyBars({...bt,frictionPct:0.25,entryPrice:100,status:'open',entryTime:1001},bars,1003),noField=WD.applyBars({...bt,frictionPct:undefined,entryPrice:100,status:'open',entryTime:1001},bars,1003);
    const fresh=WD.applyBars({...bt,entryPrice:100,status:'open',entryTime:1001},bars,1003);
    t('L8 데이트레이딩 워커 — 새 거래 마찰 0.42(0.22 + 0.2) · 율 기록(미실현 1 − 0.42) / 남긴 0.25 · 칸 없는 옛 기록은 그때 0.25',
      bt.frictionPct===0.42&&bt.feeRatePct===0.1&&bt.costModel==='common-fee-v1'&&near(fresh.unrealizedPnl,1-0.42)&&near(keptOld.unrealizedPnl,1-0.25)&&near(noField.unrealizedPnl,1-0.25),
      J([bt.frictionPct,bt.feeRatePct,fresh.unrealizedPnl,keptOld.unrealizedPnl,noField.unrealizedPnl]));
    const WO=await imp(dir,FILES.wo);
    t('L9 종가 30분 매도(워커) — 신호가 남긴 비용(0.23) 그대로 · 없거나 0 이면 지금 율(0.40)',
      WO.closingSellCost({strategyParams:{frictionPct:0.23}})===0.23&&WO.closingSellCost({})===0.4&&WO.closingSellCost({strategyParams:{frictionPct:0}})===0.4,
      J([WO.closingSellCost({strategyParams:{frictionPct:0.23}}),WO.closingSellCost({})]));
  }catch(e){bad.push('던짐 '+(e&&e.stack||e).toString().slice(0,400));}
  finally{globalThis.fetch=realFetch;try{fs.rmSync(dir,{recursive:true,force:true});}catch(e){}}

  /* W 배선 */
  t('W1 Pages 진입점이 율을 넣는다 — 클로드 실시간 · 하루 마감 알림 · 종가 30분 · 시초가 감시 · 대결(GET · POST)',
    /out\.fee=await useOwnerFee\(env\);/.test(S.live)&&/\n  await useOwnerFee\(env\);/.test(S.tg)&&/\n await useOwnerFee\(env\);/.test(S.cm)&&/\n  await useOwnerFee\(env\);/.test(S.om)
    &&/const \{error,\.\.\.fee\}=await useOwnerFee\(env\|\|\{\}\);/.test(S.dl)&&/\n  await useOwnerFee\(env\);\n  try\{\n    const b=await request\.json\(\)/.test(S.dl));
  t('W2 워커가 실행마다 율을 받는다 — 데이트레이딩 runScheduled · 코인/SOXL run · /refresh · 종가 30분',
    /async function runScheduled\(controller,env\)\{\n  if\(!env\.MONITOR_KEY\)throw new Error\("MONITOR_KEY secret missing"\);\n  await useCommonFee\(env\);/.test(S.wd)
    &&/async function run\(env\)\{\n  if\(!env\.MONITOR_KEY\)throw new Error\("MONITOR_KEY secret missing"\);\n  await useCommonFee\(env\);/.test(S.wg)
    &&/await useCommonFee\(env\);\n        return json\(\{ok:true,ledger:await refreshPaper\(env,strategy,date\)\}\);/.test(S.wg)
    &&/\{const v=await fetchCommonFee\(baseUrl\(env\),env\.MONITOR_KEY\);setScalpFee\(v\.rate,v\.source\);\}/.test(S.wo));
  const stepHasKey=(wf,script)=>{const i=wf.indexOf('.app/scripts/'+script);if(i<0)return false;const s=wf.lastIndexOf('- name:',i);return /(JKQ_FEE_KEY|KEY|JKQ_MONITOR_KEY|MONITOR_KEY): \$\{\{ secrets\.AUTOTRADE_KEY \}\}/.test(wf.slice(s,i));};
  t('W3 밤 연구 단계가 감시키를 넘긴다 — daily1 · 코인 · 시초가 · D-1 · ETF 야간 · 클로드 연구실 · 종가 30분',
    stepHasKey(S.wfD1,'daily1_shadow_lab.py')&&stepHasKey(S.wfCr,'backtest_crypto_orb.py')&&stepHasKey(S.wfSd,'backtest_opening_rebreak.py')&&stepHasKey(S.wfGd,'backtest_opening_gapdown.py')
    &&stepHasKey(S.wfGd,'backtest_etf_overnight.py')&&stepHasKey(S.wfGd,'claude_lab.py')&&stepHasKey(S.wfNt,'nightly_closing30_research.py'));
  const legacy=[[S.live,/KR_COST=0\.23|0\.03\+2\*\(p>=2000|return 0\.23\+|const half=0\.1;/],[S.day,/kr: 0\.23, etf: 0\.13/],[S.c30,/CLOSE_FEES_PCT=\.23/],[S.c30o,/\*100-\.23/],
    [S.op,/OPENING_FIXED_FRICTION_PCT=\.23/],[S.duel,/opening:0\.25,daytrading:0\.25/],[S.push,/\* 100 - 0\.14\)/],[S.wd,/const PAPER_FRICTION_PCT=0\.25/],[S.wg,/friction:\.14|friction:\.20|\?\.14:\.20/],
    [S.wo,/\*100-\.23;/],[S.scl,/OPENING_FIXED_FRICTION_PCT=0\.23/],[S.cl,/국내 주식 0\.25% · ETF 0\.15% · 코인 0\.14%/],[S.lab,/"crypto": 0\.14, "soxl": 0\.20\}|costRoundTripPct=0\.14/]];
  t('W4 옛 비용 상수가 남지 않는다(클로드 실시간 · 마감 · 종가 30분 · 시초가 · 대결 · 알림 · 워커 3 · 화면 2 · 클로드 연구실)',legacy.every(([s,re])=>!re.test(s)),
    legacy.filter(([s,re])=>re.test(s)).map(([,re])=>String(re)).join(' '));
  t('W5 모의체결 대조 — 그 거래가 남긴 마찰과 비교(옛 0.25 칸은 이어 보기용으로 남김)',
    /internalFrictionPct:Number\.isFinite\(\+t\.frictionPct\)&&t\.frictionPct!=null\?\+t\.frictionPct:0\.25,/.test(S.vts)&&/frictionGapVsInternalPct:avgDrag==null\|\|!internalFriction\.length\?null:avgDrag-avg\(internalFriction\),/.test(S.vts)
    &&/frictionGapVsInternal025Pct:avgDrag==null\?null:avgDrag-0\.25,/.test(S.vts));
  return bad;
}

const MUT=[
  ['규칙: 국내 세금 몫에 옛 수수료까지(0.23 · 두 번 셈)','sc',s=>s.replace('NON_FEE_PCT = Object.freeze({ kr: 0.20,','NON_FEE_PCT = Object.freeze({ kr: 0.23,')],
  ['규칙: 수수료를 한쪽만(× 1)','sc',s=>s.replace('return r6(2 * rateOf(rate) * 100);','return r6(rateOf(rate) * 100);')],
  ['규칙: 받은 율을 무시(늘 기본)','sc',s=>s.replace('  RATE = x == null ? FEE_DEFAULT : x;\n','  RATE = FEE_DEFAULT;\n')],
  ['규칙: 범위 검사 없음(3% 받음)','sc',s=>s.replace('import { FEE_DEFAULT, feeValid } from "./_fee.js";','import { FEE_DEFAULT } from "./_fee.js";\nconst feeValid = r => (Number.isFinite(+r) && r !== null && r !== "" ? +r : null);')],
  ['워커 받기: 실패도 10분 둔다','sc',s=>s.replace('(CACHE.v.error ? failTtlMs : ttlMs)','ttlMs')],
  ['파이썬: 코인 미끄러짐 0.14(JS 와 다름)','py',s=>s.replace('"coin": 0.04,','"coin": 0.14,')],
  ['파이썬: 수수료 한쪽만','py',s=>s.replace('return _r6(2 * _rate_or_default(rate) * 100)','return _r6(_rate_or_default(rate) * 100)')],
  ['파이썬: 환경변수 율 무시','py',s=>s.replace('    env = fee_valid(os.environ.get("JKQ_COMMON_FEE"))\n','    env = None\n')],
  ['율 읽기: 문서 전체를 받는다(mask 없음)','own',s=>s.replace('"?mask.fieldPaths=" + FEE_FIELD','""')],
  ['율 읽기: 저장 안 한 사람도 출처 user','own',s=>s.replace('note: "저장된 공통 수수료 없음 — 기본값" }','note: "저장된 공통 수수료 없음 — 기본값", source: "user" }')],
  ['율 읽기: 캐시가 안 끝남','own',s=>s.replace('if (CACHE && now - CACHE.at < (CACHE.v.error ? failTtlMs : ttlMs)) return CACHE.v;\n  fetchImpl','if (CACHE) return CACHE.v;\n  fetchImpl')],
  ['율 읽기: useOwnerFee 가 비용 모듈에 안 넣음','own',s=>s.replace('  setScalpFee(v.rate, v.source);\n','')],
  ['엔드포인트: 인증 없음','ep',s=>s.replace('if (!(feeKeyOk(request, env) || await claudeAuthorized(request, env)))','if (false)')],
  ['엔드포인트: AUTOTRADE_KEY 만 받음','ep',s=>s.replace('[env.DAYTRADING_MONITOR_KEY, env.OPENING_MONITOR_KEY, env.AUTOTRADE_KEY]','[env.AUTOTRADE_KEY]')],
  ['클로드 ①: 세금 빠짐(ETF 식)','live',s=>s.replace('export function d1CostPct(p){return scalpCostPct("kr")+','export function d1CostPct(p){return scalpCostPct("etf")+')],
  ['클로드 ⑤: 옛 수수료 0.03','live',s=>s.replace('const f=scalpCostPct("etf");return px>0?f+','const f=0.03;return px>0?f+')],
  ['클로드 마감: 코인 옛 0.14','day',s=>s.replace('get coin() { return scalpCostPct("coin"); }','get coin() { return 0.14; }')],
  ['종가 30분: 신호 스냅샷 옛 0.23','c30',s=>s.replace('frictionPct:closeFeesPct(),','frictionPct:.23,')],
  ['종가 30분: 신호가 남긴 비용 무시','c30o',s=>s.replace("const cost=costPct!=null&&Number.isFinite(+costPct)?+costPct:scalpCostPct('kr');","const cost=scalpCostPct('kr');")],
  ['시초가: 고정 몫 옛 0.23','op',s=>s.replace('export function openingFixedFrictionPct(){return scalpCostPct("kr");}','export function openingFixedFrictionPct(){return .23;}')],
  ['대결: 클로드 ② 를 주식 비용으로','duel',s=>s.replace('get daytrading(){return scalpCostPct("etfFair");}','get daytrading(){return scalpCostPct("krDay");}')],
  ['코인 알림: 응답의 율 무시','push',s=>s.replace('const coinCost = scalpCostPct("coin", live && live.fee ? live.fee.rate : undefined);','const coinCost = scalpCostPct("coin");')],
  ['코인 워커: 지난 거래 마찰을 지금 율로 다시 씀','wg',s=>s.replace('friction=keep?Number(kept.frictionPct):Number(opts.friction||0);','friction=Number(opts.friction||0);')],
  ['코인 워커: 이어받은 거래 마찰을 새 율로','wg',s=>s.replace('    params:p,exit:{bar:{time:x.exitTime,ms:x.exitMs,c:x.exitPrice},price:x.exitPrice,reason:x.reason},friction:fr,','    params:p,exit:{bar:{time:x.exitTime,ms:x.exitMs,c:x.exitPrice},price:x.exitPrice,reason:x.reason},friction:candidate?.friction,')],
  ['데이트레이딩 워커: 새 거래도 옛 0.25','wd',s=>s.replace('frictionPct:paperFrictionPct(),...feeSnap(),\n    source:"kis-minhist-paper"','frictionPct:LEGACY_FRICTION_PCT,...feeSnap(),\n    source:"kis-minhist-paper"')],
  ['데이트레이딩 워커: 옛 기록을 지금 율로','wd',s=>s.replace('    t.unrealizedPnl=(t.currentPrice/t.entryPrice-1)*100-Number(t.frictionPct||LEGACY_FRICTION_PCT);','    t.unrealizedPnl=(t.currentPrice/t.entryPrice-1)*100-Number(t.frictionPct||paperFrictionPct());')],
  ['종가 30분 워커: 신호가 남긴 비용 무시','wo',s=>s.replace('return Number.isFinite(fp)&&fp>0?fp:scalpCostPct("kr");}','return scalpCostPct("kr");}')],
  ['단타 화면: 받은 왕복을 안 씀','scl',s=>s.replace("return Math.round(((n==null?0:+n)+(+SCALP_FEE.roundTripPct||0))*1e6)/1e6;","return Math.round(((n==null?0:+n)+0.5)*1e6)/1e6;")],
  ['단타 화면: 기본표 국내 0.23','scl',s=>s.replace("nonFeePct:{kr:0.20,krDay:0.22,","nonFeePct:{kr:0.23,krDay:0.22,")],
  ['클로드 화면: 늘 0.25%','cl',s=>s.replace('return isFinite(r)&&r>=0&&r<=0.02?r:0.0025}','return 0.0025}')],
  ['클로드 연구실: 대결 ETF 를 ETF 고정 몫으로','lab',s=>s.replace('"daytrading_etf": SC.cost_pct("etfFair")','"daytrading_etf": SC.cost_pct("etfFlat")')],
  ['클로드 연구실: 코인 돌파 옛 0.14','lab',s=>s.replace('tabSize=0.8, costRoundTripPct=SC.cost_pct("coin")','tabSize=0.8, costRoundTripPct=0.14')],
  ['배선: 클로드 실시간이 율을 안 넣음','live',s=>s.replace('out.fee=await useOwnerFee(env);','out.fee={rate:0.0025,source:"default"};')],
  ['배선: 코인 워커가 율을 안 받음','wg',s=>s.replace('  await useCommonFee(env);   // 이번 실행의 새 거래 마찰','  // 이번 실행의 새 거래 마찰')],
  ['배선: daily1 단계에 키 없음','wfD1',s=>s.replace('          JKQ_FEE_KEY: ${{ secrets.AUTOTRADE_KEY }}   # 단타 비용','          JKQ_X: none   # 단타 비용')],
  ['모의체결 대조: 0.25 고정 비교(옛 코드)','vts',s=>s.replace('internalFrictionPct:Number.isFinite(+t.frictionPct)&&t.frictionPct!=null?+t.frictionPct:0.25,','internalFrictionPct:0.25,')],
];
(async()=>{
  const t0=Date.now(),bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 단타 공통 수수료: 규칙(옛 수수료 = 옛 상수 · 범위) · 파이썬 = JS · 화면 2 · 율 읽기(mask · 캐시 · 기본) · /api/common-fee 인증 · 워커 받기 · 쓰는 곳 9 · 배선');
  let red=0;
  for(const [name,key,mut] of MUT){
    const S2={...SRC,[key]:mut(SRC[key])};
    if(S2[key]===SRC[key]){console.error('FAIL 변이 대상 없음: '+name);process.exit(1);}
    let b;try{b=await check(S2);}catch(e){b=['던짐 '+e.message];}
    if(b.length){red++;console.log('PASS 변이 빨간불: '+name);}else{console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  }
  console.log(`ALL PASS scalp fee · 변이 ${red}/${MUT.length} red · ${((Date.now()-t0)/1000).toFixed(1)}s`);
})();
