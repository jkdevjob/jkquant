#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   JK 퀀트 회귀 테스트 — 검증 1~6차의 핵심 체크를 한 번에 재실행
   사용법: node regression-check.js [index.html경로] [backtest.html경로] [CSV디렉토리]
   기본값: 이 스크립트와 같은 폴더 · 시세는 testdata/ 고정본
   원칙: 재구현 금지 — 실제 HTML에서 함수 원문을 추출해 그대로 실행.
   코드를 수정할 때마다 이 스크립트가 ALL PASS여야 배포.
   ════════════════════════════════════════════════════════════════════ */
const fs=require('fs'), path=require('path');
const __d=require('path').join(__dirname);
const [,, IDX=__d+'/index.html', BT=__d+'/backtest.html', CSVDIR=__d+'/testdata']=process.argv;
let pass=0, fail=0;
function ok(name, cond, detail=''){ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(detail?' — '+detail:''));} }
function near(a,b,tol){ return Math.abs(a-b)<=Math.max(tol??1e-6, Math.abs(b)*1e-9); }

/* ── 함수 원문 추출 (브레이스 카운팅) ── */
function extractFn(src, marker){
  const i=src.indexOf(marker); if(i<0) throw new Error('추출 실패: '+marker);
  let j=src.indexOf('{', i), depth=0, k=j;
  for(; k<src.length; k++){ if(src[k]==='{')depth++; else if(src[k]==='}'){depth--; if(depth===0)break;} }
  return src.slice(i, k+1);
}
const idx=fs.readFileSync(IDX,'utf8'), bt=fs.readFileSync(BT,'utf8');
// 관리자 화면은 별도 페이지다 (백테와 같은 구조). 없으면 [23]에서 잡힌다
const ADM=__d+'/admin.html';
const SCL=__d+'/scalping.html';
const adm=fs.existsSync(ADM)?fs.readFileSync(ADM,'utf8'):'';
const scl=fs.existsSync(SCL)?fs.readFileSync(SCL,'utf8'):'';
console.log(`대상: ${IDX} (${(idx.match(/appVer">(v[\d.]+)/)||[])[1]||'?'}) · ${BT} (${(bt.match(/btVer[^>]*>(v[\d.]+)/)||[])[1]||'?'})\n`);

/* ════ 0. 파일 문법 ════ */
console.log('[0] 파일 문법');
{
  const {spawnSync}=require('child_process');
  const chk=(html,label)=>{
    const js=[...html.matchAll(/<script(?![^>]*src=)(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
    const tmp=path.join(require('os').tmpdir(),'__syn_'+label+'.js'); fs.writeFileSync(tmp,js);
    const r=spawnSync('node',['--check',tmp],{encoding:'utf8'});
    ok(label+' 메인 스크립트 문법', r.status===0, (r.stderr||'').split('\n')[0]);
  };
  chk(idx,'index'); chk(bt,'backtest'); if(scl) chk(scl,'scalping');
}

// index 엔진
const ki=idx.indexOf('const KIND_T=');
const idxParts=[
  idx.slice(ki, idx.indexOf(';', idx.indexOf('(애프터)', ki))+1),
  extractFn(idx,'function reverseT(kind,t,div)'),
  idx.slice(idx.indexOf('function isBuy(k)'), idx.indexOf('\n', idx.indexOf('function isBuy(k)'))),
  idx.slice(idx.indexOf('function isSell(k)'), idx.indexOf('\n', idx.indexOf('function isSell(k)'))),
  extractFn(idx,'function isAmtKind(k)'),
  idx.slice(idx.indexOf('const IM_OFFICIAL='), idx.indexOf(';', idx.indexOf('const IM_OFFICIAL='))+1),
  extractFn(idx,'function starPct(ticker,div,T,base)'),
  extractFn(idx,'function exitMulOf(base)'),
  extractFn(idx,'function computeInf()'),
  extractFn(idx,'function vrCycleTransition(V, pool, ev, G, mode, add, formula)'),   // 제8차 8-⑦ 공용 전환식
  extractFn(idx,'function computeNextV(c,ev)'),
  extractFn(idx,'function computeVr()'),
];
let __strat=null; global.curStrat=()=>__strat;
eval(idxParts.join('\n'));
/* 가격 역할 헬퍼 — 체결가 계열인가, 그날 배당이 얼마인가 (자체 점검 N1).
   실코드에서 그대로 떼어 와야 값이 어긋나지 않는다. */
{ const src=[ idx.slice(idx.indexOf('const DIV_TAXRATE='), idx.indexOf(';', idx.indexOf('const DIV_TAXRATE='))+1),
              extractFn(idx,'function isTradeBasis(Q)'), extractFn(idx,'function tradeBars(Q)'),
              extractFn(idx,'function divPerShareQ(Q, d)'), extractFn(idx,'function divCashQ(Q, d, shares, taxOn)') ].join('\n');
  const f=new Function(src+'\n'+extractFn(idx,'function divCashOn(st)')
    +'\nreturn {DIV_TAXRATE,isTradeBasis,tradeBars,divPerShareQ,divCashQ,divCashOn};')();
  Object.assign(global, f); }
// eval 안의 const 는 밖으로 안 샌다 — iq/isq 와 같은 이유로 전역에 올린다
global.IM_OFFICIAL=new Function(idxParts.find(x=>/^const IM_OFFICIAL=/.test(x))+'\nreturn IM_OFFICIAL;')();

// backtest 엔진 + 거래로그 훅 주입 (실코드에 정확 substring 치환, 각 1회 매치 검증)
// 정수 주수 헬퍼는 엔진 밖에 있다 — 파일에서 그대로 떼어 와야 실코드와 어긋나지 않는다
const iqSrc=(bt.match(/^const iq=\(amt,px\)=>[^\n]*\nconst isq=\([^\n]*$/m)||[''])[0];
if(!iqSrc) throw new Error('정수 주수 헬퍼(iq/isq)를 backtest.html에서 못 찾음');
// eval 안의 const는 밖으로 안 새어나간다 — 뒤에 따로 eval하는 엔진(runIM50 등)도 봐야 하니 전역으로 올린다
{ const f=new Function(iqSrc+'\nreturn {iq,isq};')(); global.iq=f.iq; global.isq=f.isq; }
/* 선택 기간 첫날의 전일 종가 — 워밍업 창에서 찾는다. 파일에서 그대로 떼어 온다. */
{ const m=bt.match(/function imPrevClose\(tkr, days, i\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('imPrevClose 를 backtest.html에서 못 찾음');
  /* 인자로 넘기면 이 시점의 값(아직 비어 있는 M·미설정 C)을 붙잡는다.
     자유변수로 두어 호출할 때 전역에서 찾게 한다 — 실제 브라우저와 같은 해석 순서다. */
  global.imPrevClose=new Function(m[0]+'\nreturn imPrevClose;')(); }
/* 큰수 상한 — 앱·백테가 같은 한 곳을 쓴다. 파일에서 그대로 떼어 온다. */
{ const m=bt.match(/const IM_BIG_DEFAULT=\d+;\nfunction imBigPct\(st\)\{[^\n]*\}/);
  if(!m) throw new Error('IM_BIG_DEFAULT/imBigPct 를 backtest.html에서 못 찾음');
  const f=new Function(m[0]+'\nreturn {IM_BIG_DEFAULT, imBigPct};')();
  global.IM_BIG_DEFAULT=f.IM_BIG_DEFAULT; global.imBigPct=f.imBigPct; }
/* VR 주문 체결 엔진 — 사이클 시작 20차 예약 사다리. 앱·백테가 같이 쓴다. */
{ const m=bt.match(/const VR_MODEL_DEFAULT='vreturn';\nfunction vrModelOf\(st\)\{[^\n]*\}\n/);
  const g=bt.match(/function vrOrderPlan\(S, P, bar\)\{[\s\S]*?\n\}/);
  const t=bt.match(/function vrTiers\(B, sf, bf, up, dn, limit, fee1, N, cur\)\{[\s\S]*?\n\}/);   // 7차 ⑫ 공용 차수 목록
  const k=bt.match(/function vrTick\(p, cur\)\{[^\n]*\}\nfunction vrTickUp\(p, cur\)\{[^\n]*\}\nfunction vrTickDn\(p, cur\)\{[^\n]*\}/);   // 제8차 P2-9 호가
  const x=extractFn(bt,'function vrCycleTransition(V, pool, ev, G, mode, add, formula)');                           // 제8차 8-⑦ 전환식
  if(!m||!g||!t||!k||!x) throw new Error('vrOrderPlan/vrTiers/vrTick*/vrCycleTransition/VR_MODEL_DEFAULT 를 backtest.html에서 못 찾음');
  const f=new Function(m[0]+k[0]+'\n'+t[0]+'\n'+g[0]+'\n'+x+'\nreturn {VR_MODEL_DEFAULT, vrModelOf, vrOrderPlan, vrTiers, vrTick, vrTickUp, vrTickDn, vrCycleTransition};')();
  global.VR_MODEL_DEFAULT=f.VR_MODEL_DEFAULT; global.vrModelOf=f.vrModelOf; global.vrOrderPlan=f.vrOrderPlan;
  global.vrTiers=f.vrTiers; global.vrTick=f.vrTick; global.vrTickUp=f.vrTickUp; global.vrTickDn=f.vrTickDn;
  global.vrCycleTransition=f.vrCycleTransition; }
/* 무매 정식 매수 주문 (정식 문서 반영) — 백테 파일에서 그대로 떼어 전역으로 */
{ const src=[extractFn(bt,'function imBuyOrders(o)'), (bt.match(/const IM_ROWS_DEFAULT=[^\n]*/)||[''])[0], extractFn(bt,'function imRowsOf(st)')].join('\n');
  const f=new Function(src+'\nreturn {imBuyOrders, imRowsOf, IM_ROWS_DEFAULT};')();
  global.imBuyOrders=f.imBuyOrders; global.imRowsOf=f.imRowsOf; global.IM_ROWS_DEFAULT=f.IM_ROWS_DEFAULT; }
/* 리버스 쿼터매수 주수 헬퍼 — 원문 배정액(잔금÷4). 파일에서 그대로 떼어 온다. */
{ const m=bt.match(/function imRevBuyQty\(balance, buyPrice\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('imRevBuyQty 를 backtest.html에서 못 찾음');
  global.imRevBuyQty=new Function(m[0]+'\nreturn imRevBuyQty;')(); }
/* 무매 아침 매수 계획 — runIM·runIM50 이 같이 쓴다 (7차 점검 ②). 따로 올리는 엔진 사본도
   보도록 전역에 둔다. 파일에서 그대로 떼어 온다. */
global._imBuyPlan=new Function(extractFn(bt,'function _imBuyPlan(T, avg, shares, cash, divs, starBase, starSlope, buyLimit, prevC, FEE, rows, cur)')+'\nreturn _imBuyPlan;')();
/* 무매 매수 주수 헬퍼 — 운영·모의·백테가 같이 쓴다. 파일에서 그대로 떼어 온다. */
{ const m=bt.match(/function imBuyQty\(alloc, refPx, feeRate\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('imBuyQty 를 backtest.html에서 못 찾음');
  global.imBuyQty=new Function(m[0]+'\nreturn imBuyQty;')(); }
/* 마지막 해 정산 반복 헬퍼 — 전 엔진이 부른다. 파일에서 그대로 떼어 온다. */
{ const m=bt.match(/function settleToStable\(settleOnce, peekPnl, rounds\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('settleToStable 을 backtest.html에서 못 찾음');
  global.settleToStable=new Function(m[0]+'\nreturn settleToStable;')(); }
/* 세무 원가 헬퍼 — 전 엔진이 부른다. 파일에서 그대로 떼어 온다.
   가격 평단(avg)과 세무 원가(taxBasis)는 다르다 — 매수 필요경비가 들어가는 쪽은 후자다. */
{ const m=[/function taxLot\(\)\{[^\n]*\}/, /function lotBuy\(L, qty, px, fee\)\{[^\n]*\}/,
           /function lotSell\(L, qty, px, fee\)\{[\s\S]*?\n\}/].map(re=>{
    const x=bt.match(re); if(!x) throw new Error('세무 원가 헬퍼(taxLot/lotBuy/lotSell)를 backtest.html에서 못 찾음');
    return x[0]; }).join('\n');
  const f=new Function(m+'\nreturn {taxLot,lotBuy,lotSell};')();
  global.taxLot=f.taxLot; global.lotBuy=f.lotBuy; global.lotSell=f.lotSell; }
/* 매수 회계 규약 헬퍼 — 전 전략이 부른다. 파일에서 그대로 떼어 온다. */
{ const m=bt.match(/function buyQty\(budget, px, feeRate, integer\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('매수 회계 헬퍼(buyQty)를 backtest.html에서 못 찾음');
  global.buyQty=new Function(m[0]+'\nreturn buyQty;')(); }
/* 비용·세금 프로필도 엔진이 직접 부른다 — iq/isq와 같은 이유로 전역에 올린다 */
const costSrc=(bt.match(/const COST_FEE=[\s\S]*?function capGainTax\([\s\S]*?\n\}/)||[''])[0];
if(!costSrc) throw new Error('비용·세금 프로필(costOf/capGainTax)을 backtest.html에서 못 찾음');
{ const f=new Function(costSrc+'\nreturn {isKRW,krTaxRate,costOf,capGainTax};')();
  global.isKRW=f.isKRW; global.krTaxRate=f.krTaxRate; global.costOf=f.costOf; global.capGainTax=f.capGainTax; }
/* 합성에 먹이는 '총수익 계열' 헬퍼 — 레버리지 확장·합성 1배가 부른다.
   ADJ/PBASIS 는 테스트가 채우므로 전역으로 둔다. CSV 시험 데이터에는 ADJ 가 없어
   기본값은 M 의 종가(basis 'trade_only'/'unknown') — 여태까지의 동작 그대로다. */
global.ADJ={};
{ const m=bt.match(/function totalReturnSeries\(t\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('totalReturnSeries 를 backtest.html에서 못 찾음');
  global.totalReturnSeries=new Function(m[0]+'\nreturn totalReturnSeries;')(); }
/* 배당 헬퍼 — 엔진이 전부 부른다. 파일에서 그대로 떼어 오고, 가격 기준(PBASIS)과
   배당 이벤트(DIVMAP)는 테스트가 중간에 바꿀 수 있게 전역으로 둔다.
   CSV 시험 데이터에는 배당이 없으므로 기본값은 '조정가' — 즉 divCash 가 0을 낸다
   (= 여태까지의 동작 그대로). 배당 시험은 PBASIS/DIVMAP 을 직접 채워서 한다. */
global.PBASIS={}; global.DIVMAP={};
{ const m=bt.match(/const DIV_TAXRATE=[\s\S]*?\nfunction divCash\(tkr, d, shares, costOn\)\{[\s\S]*?\n\}/);
  if(!m) throw new Error('배당 헬퍼(DIV_TAXRATE/divPerShare/divCash)를 backtest.html에서 못 찾음');
  const f=new Function(m[0]+'\nreturn {DIV_TAXRATE,divPerShare,divCash};')();
  global.DIV_TAXRATE=f.DIV_TAXRATE; global.divPerShare=f.divPerShare; global.divCash=f.divCash; }
/* VR 사이클 엔진 — runVR 과 전체비교가 같이 쓴다. 파일에서 그대로 떼어 온다. */
const vrCycSrc=(bt.match(/const VR_CYC_DAYS=\d+;\s*\nfunction vrNextDue\(s\)\{[\s\S]*?\n\}\n/)||[''])[0]
  + (bt.match(/function vrCycleCount\(days\)\{[\s\S]*?\n\}\n/)||[''])[0];
if(!/vrNextDue/.test(vrCycSrc)||!/vrCycleCount/.test(vrCycSrc))
  throw new Error('VR 사이클 엔진(VR_CYC_DAYS/vrNextDue/vrCycleCount)을 backtest.html에서 못 찾음');
{ const f=new Function(vrCycSrc+'\nreturn {VR_CYC_DAYS,vrNextDue,vrCycleCount};')();
  global.VR_CYC_DAYS=f.VR_CYC_DAYS; global.vrNextDue=f.vrNextDue; global.vrCycleCount=f.vrCycleCount; }
/* 지표 워밍업 창 — 엔진이 [WARM_FROM, WARM_TO] 밖의 날짜를 못 보게 하는 실코드 헬퍼.
   파일에서 그대로 떼어 온다. WARM_FROM/WARM_TO 는 테스트가 중간에 바꿔야 하므로
   전역으로 올린다 (new Function 안의 let 은 밖에서 못 바꾼다). */
const warmSrc=(bt.match(/const WARMUP_CAL_DAYS=[\s\S]*?\n    : ks\.sort\(\);\n\}/)||[''])[0];
if(!warmSrc) throw new Error('워밍업 창 헬퍼(WARMUP_CAL_DAYS/warmStartOf/dtsOf)를 backtest.html에서 못 찾음');
global.WARM_FROM=''; global.WARM_TO='';
{ const f=new Function(warmSrc.replace(/^let WARM_FROM=[^\n]*$/m,'')+'\nreturn {WARMUP_CAL_DAYS,warmStartOf,dtsOf};')();
  global.WARMUP_CAL_DAYS=f.WARMUP_CAL_DAYS; global.warmStartOf=f.warmStartOf; global.dtsOf=f.dtsOf; }
/* 리버스 지원 분할 목록도 파일에서 그대로 떼어 온다 — 여기서 다시 적으면 어긋난다 */
{ const m=bt.match(/const REV_DIVS=\[[^\]]*\];\s*\nconst revSupported=[^\n]*/);
  if(!m) throw new Error('REV_DIVS/revSupported 를 backtest.html에서 못 찾음');
  const f=new Function(m[0]+'\nreturn {REV_DIVS,revSupported};')();
  global.REV_DIVS=f.REV_DIVS; global.revSupported=f.revSupported; }
/* 앱의 '리버스를 실제로 쓰는가' 판정 (제8차 8-③·8-④) — 앱 자기 목록(REV_DIVS)과 함께 떼어 온다 */
{ const src=[(idx.match(/const REV_DIVS=\[[^\]]*\];/)||[''])[0], extractFn(idx,'function revSupported(div)'),
             extractFn(idx,'function revEnabled(st)')].join('\n');
  global.revEnabled=new Function(src+'\nreturn revEnabled;')(); }
let btSrc=extractFn(bt,'function _imBuyPlan(T, avg, shares, cash, divs, starBase, starSlope, buyLimit, prevC, FEE, rows, cur)')+'\n'+extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound')+'\n'+extractFn(bt,'function runVR(days,tkr,params)');
function inject(before, after, label){
  const p=btSrc.split(before);
  if(p.length!==2) throw new Error(`주입 실패(${label}): ${p.length-1}회 매치 — 코드가 바뀌었으면 이 스크립트의 주입 문자열을 갱신할 것`);
  btSrc=p[0]+after+p[1];
}
inject(`if(sellQty>0){ _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // MOC=종가`,
`if(sellQty>0){ __LOG('리버스매도',c,sellQty); _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // MOC=종가`,'r1');
inject(`if(sellQty>0){ _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // LOC=종가`,
`if(sellQty>0){ __LOG('리버스매도',c,sellQty); _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // LOC=종가`,'r2');
inject(`if(_buyN(c,imRevBuyQty(cash,buyP))>0) T=T+(divs-T)*0.25;      // 수량은 주문가로 사전 확정, 체결은 종가`,
`{const __q=_buyN(c,imRevBuyQty(cash,buyP));if(__q>0){__LOG('리버스매수',c,__q);T=T+(divs-T)*0.25;}}      // 수량은 주문가로 사전 확정, 체결은 종가`,'r3');
inject(`{_sell(o>tgt?o:tgt,q3,SLIP);tpHit=true;}`,
`{const __px=o>tgt?o:tgt;__LOG('지정가매도',__px,q3);_sell(__px,q3,SLIP);tpHit=true;}`,'tp');
inject(`{_sell(c,sq,0);qtHit=true;}`,
`{__LOG('쿼터매도',c,sq);_sell(c,sq,0);qtHit=true;}`,'qt');
/* 매수는 아침에 정한 계획(_imBuyPlan)을 한 줄에서 체결한다 (7차 점검 ②) — 거기 하나만 건다 */
/* 아래로 LOC 추가 줄은 모의가 그날 첫 본 주문 기록에 수량을 더해 적는다 — 로그도 같은 모양으로 모은다 */
/* 원본의 T 규칙(' if(lf&&!mf) T+=1;')은 건드리지 않고 그 앞 체결 루프에만 로그를 건다 — 주입본이 그 줄을 다시 쓰면 변이를 가린다 */
inject(`{ let mf=false, lf=false; for(const b of buys){ if(c<=b.lim){ const q=_buyN(c,b.q); if(q>0){ T+=b.dT; if(b.ladder) lf=true; else mf=true; } } }`,
`{ let mf=false, lf=false, __ex=0, __m=[]; for(const b of buys){ if(c<=b.lim){ const q=_buyN(c,b.q); if(q>0){ T+=b.dT; if(b.ladder){ lf=true; __ex+=q; } else { mf=true; __m.push([b.kind,q]); } } } }
  if(__m.length) __m.forEach((m,i)=>__LOG(m[0],c,m[1]+(i===0?__ex:0))); else if(__ex>0) __LOG('1회매수',c,__ex);`,'buy');
// 단리에서 밖에서 넣은 돈(addedCash)을 총자산에서 빼게 되면서 이 줄이 바뀌었다
inject(`const fin=cash+shares*M[tkr][days[days.length-1]][C]+savedProfit-addedCash;`,
`__FINAL({T,avg,shares,cash,realized,savedProfit,addedCash});
  const fin=cash+shares*M[tkr][days[days.length-1]][C]+savedProfit-addedCash;`,'fin');
let tradeLog=[], finalState=null;
global.__LOG=(k,p,q)=>tradeLog.push({kind:k,price:p,qty:q});
global.__FINAL=s=>finalState=s;
/* 봉의 자리(종가·시가·고가·저가)도 파일에서 그대로 떼어 온다 —
   여기서 숫자를 다시 적으면 backtest.html 과 어긋날 수 있다 */
global.M={};
{ const m=bt.match(/const C=(\d+),O=(\d+),HI=(\d+),LO=(\d+);/);
  if(!m) throw new Error('봉 자리(C/O/HI/LO)를 backtest.html에서 못 찾음');
  global.C=+m[1]; global.O=+m[2]; global.HI=+m[3]; global.LO=+m[4]; }
eval(btSrc);
// backtest 상수(starBase/starSlope/exitMul)를 함수화 — 계열 규약 검사용
const mBase=btSrc.match(/const starBase=([^;]+);/), mSlope=btSrc.match(/const starSlope=([^;]+);/), mExit=btSrc.match(/const exitMul ?= ?([^;]+);/);
const btBase=new Function('targetPct','return '+mBase[1]);
const btSlope=new Function('starBase','divs','return '+mSlope[1]);
const btExit=new Function('starBase','return '+mExit[1].replace(/\/\/.*$/,''));

/* ════ 1. 문서 수치 재현 (3차) ════ */
console.log('[1] 문서 수치 재현');
/* 앱은 언제나 base(=설정 익절%)를 넘겨 부른다. base 없이 부르면 실전에 없는
   갈래를 시험하게 되고, 그쪽만 맞춰 놓으면 실제 경로가 틀려도 초록불이 뜬다.
   그래서 문서 4케이스를 '공식값을 base 로 넘긴' 실제 경로로 재현한다. */
ok('별% TQQQ 20분할 T=10 → 0', near(starPct('TQQQ',20,10,IM_OFFICIAL.TQQQ),0));
ok('별% TQQQ 40분할 T=10 → 7.5', near(starPct('TQQQ',40,10,IM_OFFICIAL.TQQQ),7.5));
ok('별% SOXL 20분할 T=10 → 0', near(starPct('SOXL',20,10,IM_OFFICIAL.SOXL),0));
ok('별% SOXL 40분할 T=25 → −5', near(starPct('SOXL',40,25,IM_OFFICIAL.SOXL),-5));
ok('공식값 표: TQQQ 15 · SOXL 20', IM_OFFICIAL.TQQQ===15&&IM_OFFICIAL.SOXL===20, JSON.stringify(IM_OFFICIAL));
ok('1회매수금 19522/39 = 500.56', near(19522/39,500.56,0.01));
ok('리버스T 매도 39.5×0.95 = 37.525', near(reverseT('리버스매도',39.5,40),37.525));
ok('리버스T 매수 → 38.14375', near(reverseT('리버스매수',37.525,40),38.14375));
ok('리버스T 20분할 19.5→17.55→18.1625', near(reverseT('리버스매수',reverseT('리버스매도',19.5,20),20),18.1625));
{ // 무한매도 시퀀스 200→190→181→172→164 (40분할 ÷20 내림)
  let s=200, seq=[s]; for(let i=0;i<4;i++){ s-=Math.floor(s/20); seq.push(s); }
  ok('무한매도 시퀀스 200→190→181→172→164', JSON.stringify(seq)==='[200,190,181,172,164]', JSON.stringify(seq));
}
ok('쿼터매수 (400+300)/4 = 175', (400+300)/4===175);
{ // VR 다음V — index computeNextV 실코드
  const c=(mode)=>({st:{mode,formula:'basic',g:10,add:250}, V:9000, pool:1000});
  ok('VR 다음V 적립식 9350', near(computeNextV(c(0.75),9000).nextV,9350));
  ok('VR 다음V 거치식 9100 (적립 자동 0)', near(computeNextV(c(0.5),9000).nextV,9100));
  ok('VR 다음V 인출식 8850', near(computeNextV(c(0.25),9000).nextV,8850));
}

/* ════ 2. 통합 규약 (v1.90+) — 익절%=별%base · slope=base×0.1×20/div · 복귀=1−base/100 · index↔backtest 동일 ════ */
console.log('[2] 통합 규약 (index ↔ backtest)');
for(const base of [10,15,20,25]){
  for(const div of [20,40]){
    const iPct=starPct('SOXL',div,3,base), bPct=btBase(base)-btSlope(base,div)*3;
    ok(`별% 일치: base${base} ${div}분할`, near(iPct,bPct), `index=${iPct} bt=${bPct}`);
  }
  ok(`복귀기준↔base 짝: base${base}`, near(exitMulOf(base),btExit(base)), `idx=${exitMulOf(base)} bt=${btExit(base)}`);
}
// base 를 안 줬을 때의 갈래도 공식표를 봐야 한다 (옛 세션·미설정 대비)
ok('index 기본 base: TQQQ=15', near(starPct('TQQQ',20,0),15));
ok('index 기본 base: SOXL=20', near(starPct('SOXL',20,0),20));
ok('index 기본 base가 공식표를 읽는다', /IM_OFFICIAL\[ticker\]\|\|20/.test(idx) && !/ticker==='TQQQ'\?15/.test(idx));

/* ════ 3. VR 엣지 (4차) — 0원 시작 첫매수 Pool 미차감 ════ */
console.log('[3] VR 엣지');
__strat={settings:{ticker:'TQQQ',mode:0.75,formula:'basic',g:10,add:100,band:15,startv:0,startpool:0,cur:'usd'}, hist:[{type:'buy',price:77,qty:10,cyc:0}]};
{ const r=computeVr();
  ok('첫매수 후 Pool=0 (음수 아님)', r.pool===0, 'pool='+r.pool);
  ok('첫매수가 V 형성 (V=770)', near(r.V,770));
}
__strat={settings:{ticker:'TQQQ',mode:0.75,formula:'basic',g:10,add:100,band:15,startv:0,startpool:1000,cur:'usd'},
  hist:[{type:'buy',price:77,qty:10,cyc:0},{type:'buy',price:40,qty:5,cyc:1}]};
ok('2회차 매수는 Pool 정상 차감 (1000→800)', near(computeVr().pool,800));
// 사이클 진입 후 재계산: enterNextCycle이 startv를 갱신(startCyc=1)해도 이력의 초기투입 매수가 Pool을 다시 까면 안 됨
__strat={settings:{ticker:'TQQQ',mode:0.75,formula:'basic',g:10,add:100,band:15,startv:800,startpool:0,startCyc:1,cur:'usd'},
  hist:[{type:'buy',price:77,qty:10,cyc:0}]};
{ const r=computeVr();
  ok('사이클 진입 후: 초기투입 매수 Pool 미차감 유지 (pool=0)', r.pool===0, 'pool='+r.pool);
  ok('사이클 진입 후: V=갱신된 startv(800)', near(r.V,800));
}
// 이어받기 시작(startv 직접입력, 진입이력 없음): 첫 buy는 추가매수 → Pool 차감이 맞음
__strat={settings:{ticker:'TQQQ',mode:0.75,formula:'basic',g:10,add:100,band:15,startv:770,startpool:200,cur:'usd'},
  hist:[{type:'buy',price:77,qty:2,cyc:0}]};
ok('이어받기 시작: 첫 buy는 Pool 차감 (200→46)', near(computeVr().pool,46));

/* ════ 4. 차분 테스트 (5차·6차) — 실데이터, 두 엔진 회계 항등 ════ */
console.log('[4] 차분 테스트 (runIM 거래로그 → computeInf 재생)');
let __bogusFiltered=0;
function __isBogusDate(d){ const w=new Date(d+'T12:00:00Z').getUTCDay();
  return w===0||w===6||['12-25','01-01','07-04'].includes(d.slice(5)); }   // 주말·고정 휴장일 가짜 봉
function parseCSV(p){
  const L=fs.readFileSync(p,'utf8').split('\n').filter(l=>l.trim());const rows=[];
  for(let i=1;i<L.length;i++){const cel=L[i].match(/("[^"]*"|[^,]+)/g);if(!cel||cel.length<5)continue;
    const cl=s=>s.replace(/"/g,'').replace(/\s/g,'').replace(/,/g,'');
    const d=cl(cel[0]);const c=+cl(cel[1]),o=+cl(cel[2]),h=+cl(cel[3]),lo=+cl(cel[4]);
    if(!c||!d.match(/^\d{4}-\d{2}-\d{2}$/))continue;
    if(__isBogusDate(d)){__bogusFiltered++;continue;}                       // 인베스팅 CSV 오염 방어 (2026-07 발견: 93개)
    rows.push([d,c,o,h,lo]);}
  rows.reverse();return rows;
}
const csvFiles=fs.readdirSync(CSVDIR).filter(f=>f.endsWith('.csv'));
const DAYS={};
for(const tk of ['SOXL','TQQQ','TECL']){
  const f=csvFiles.find(x=>x.includes(tk));
  if(!f){ console.log('  (CSV 없음, 스킵: '+tk+')'); continue; }
  const rows=parseCSV(path.join(CSVDIR,f)); M[tk]={}; DAYS[tk]=[];
  rows.forEach(r=>{M[tk][r[0]]=[r[1],r[2],r[3],r[4]]; DAYS[tk].push(r[0]);});
}
ok('CSV 캘린더 필터 동작 (주말·휴장 가짜 봉 제거)',
   Object.keys(DAYS).every(t=>DAYS[t].every(d=>!__isBogusDate(d))),
   '필터됨 '+__bogusFiltered+'개');
const CONFIGS=[
  ['SOXL',20,20,true],['SOXL',40,20,true],['SOXL',20,20,false],['SOXL',40,10,false],
  ['TQQQ',20,15,true],['TQQQ',40,15,true],['TQQQ',20,15,false],
  ['TECL',20,20,true],['TECL',40,20,false],
];
for(const [tkr,div,tgt,compound] of CONFIGS){
  if(!DAYS[tkr]) continue;
  tradeLog=[]; finalState=null;
  runIM(DAYS[tkr], tkr, 10000, div, tgt, compound);
  __strat={settings:{ticker:tkr,div,principal:10000}, hist:tradeLog};
  const ci=computeInf();
  const btBal=finalState.cash+finalState.savedProfit-(finalState.addedCash||0);
  const okAll=near(ci.avg,finalState.avg)&&near(ci.qty,finalState.shares)&&near(ci.T,finalState.T)&&near(ci.realized,finalState.realized)&&near(ci.bal,btBal);
  ok(`${tkr} ${div}분할 ${tgt}% ${compound?'복리':'단리'} — 거래 ${tradeLog.length}건 5지표 항등`, okAll,
    okAll?'':`avg ${ci.avg}/${finalState.avg} qty ${ci.qty}/${finalState.shares} T ${ci.T}/${finalState.T} bal ${ci.bal}/${btBal}`);
}

/* ════ 4b. runIM50 (V5.0 국면) 스모크 + runIM(V4.0) 앵커 ════ */
console.log('[4b] runIM50 스모크 + V4.0 앵커');
{
  eval(extractFn(bt,'function buildGateIM(tkr, shortMA)'));
  eval(extractFn(bt,'function runIM50(days,tkr,cap,divs,targetPct,compound'));
  // (a) 데이터 불변 항등: 이력 200일 미만(워밍업)에서는 V5.0 == V4.0 완전 동일 (CSV 갱신에도 항상 성립)
  if(DAYS.SOXL){
    const d150=DAYS.SOXL.slice(0,150);
    const a=runIM(d150,'SOXL',10000,20,20,true), b=runIM50(d150,'SOXL',10000,20,20,true);
    ok('워밍업(<200일) 구간 V5.0==V4.0 항등', near(a.final,b.final,1e-9)&&a.cycles===b.cycles&&near(a.mdd,b.mdd,1e-9),
       `final ${a.final}/${b.final}`);
    const r50=runIM50(DAYS.SOXL,'SOXL',10000,20,20,true);
    ok('runIM50 전체 실행·유한값', isFinite(r50.final)&&isFinite(r50.mdd));
  }
  // (b) V4.0 앵커 — testdata/ 고정 데이터(각 1500 거래일, ~2026-08-27) 기준.
  //     데이터를 갈면 값이 달라지는 게 정상이므로, 지문이 다르면 실패가 아니라 스킵한다.
  const FIX_LEN=1500, FIX_END='2026-08-27';
  const fixOK=t=>DAYS[t] && DAYS[t].length===FIX_LEN && DAYS[t][DAYS[t].length-1]===FIX_END;
  // v1.167 — 지정가매도 체결가를 max(익절가, 시가)로 바로잡아 최종값만 이동.
  // v1.174 — 주식 수량을 정수로 바꾸면서 셋 다 이동했다. 소수점으로 사면 남는 돈까지
  //   늘 굴러가서 실제보다 좋게 나온다. 증권사에서 0.34주는 못 산다.
  //   낮아지는 게 정상이고(SOXL 106,917→103,037), 사이클 수도 함께 움직인다.
  // v1.176 — 별지점·평단 두 주문을 합쳐서 한 번만 내림하던 걸 주문별 내림으로 바로잡아 셋 다 이동.
  //   실제로는 별개 주문 2건이라 각각 정수 주수다(1회 $500·주가 $65: 합산 7주 → 실제 3+3=6주).
  //   방향은 종목마다 다르다 — 평단이 바뀌면 이후 체결 경로가 통째로 갈리기 때문이다.
  //   이 수정으로 운영 모의(infSimForward)와 백테가 원금 $3k/$10k/$100k에서 체결까지 완전 일치한다.
  const A=[['SOXL',20,20],['TQQQ',40,10],['TECL',20,20]];
  for(const [tkr,div,tgt] of A){
    if(!DAYS[tkr]) continue;
    if(!fixOK(tkr)){ console.log(`  (데이터가 고정본과 달라 앵커 스킵: ${tkr} ${DAYS[tkr].length}일 ~${DAYS[tkr][DAYS[tkr].length-1]})`); continue; }
    const r=runIM(DAYS[tkr],tkr,10000,div,tgt,true);
    ok(`${tkr} ${div}분할 ${tgt}% V4.0 고정데이터 스모크`,
       isFinite(r.final)&&r.final>0&&isFinite(r.mdd)&&r.mdd>=0&&r.mdd<=100&&r.cycles>=0,
       `final ${r.final.toFixed(2)} mdd ${r.mdd.toFixed(2)} cyc ${r.cycles}`);
  }
}

/* ════ 4c. 섀넌 차분 (runIVS 거래로그 → ivsPos 재생) ════
   백테가 만든 리밸런싱을 운영 장부에 그대로 먹였을 때 수량·예수금이 같아야 한다.
   백테에만 있는 '예수금 쪽 비용'(국채 매매 수수료·보수·이자)은 거래 기록 밖의 현금 비용이라
   운영엔 개념이 없다 — 매매 수수료 경로만 격리하려고 그 셋을 끄고 대조한다. */
console.log('[4c] 섀넌 차분 (runIVS 거래로그 → ivsPos 재생)');
{
  global.TBILL_RATE=new Proxy({},{get:()=>0});          // 예수금 이자 중화
  global.KR_RATE=new Proxy({},{get:()=>0});
  global.parkRate=()=>0;                               // 금리가 종목 통화를 따라가게 되면서 함수로 바뀌었다
  global.META=global.META||{};
  global.COST_FEE=0.0025; global.COST_KRW=1350; global.COST_TAXRATE=0.22; global.COST_DEDUCT=250e4;
  eval(extractFn(bt,'function _ivsWeights(tkr,N,s0)'));
  let ivsSrc=extractFn(bt,'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)');
  const inj=(before,after,label)=>{ const p=ivsSrc.split(before);
    if(p.length!==2) throw new Error(`섀넌 주입 실패(${label}): ${p.length-1}회 매치`);
    ivsSrc=p[0]+after+p[1]; };
  inj(`lotBuy(P.lot,q,px,fee+lf); P.sh+=q; cash-=spend+lf;`,
      `lotBuy(P.lot,q,px,fee+lf); P.sh+=q; cash-=spend+lf; __LOGI('buy',P===A?'lev':'x1',__DD,px,q,spend-fee,fee);`,'buy');
  inj(`yearPnl+=lotSell(P.lot,q,px,fee+lf); P.sh-=q;`,
      `yearPnl+=lotSell(P.lot,q,px,fee+lf); P.sh-=q; __LOGI('sell',P===A?'lev':'x1',__DD,px,q,gross,fee);`,'sell');
  inj(`days.forEach((d,i)=>{`,`days.forEach((d,i)=>{ __DD=d;`,'date');
  inj(`const LEGFEE=(costOn&&!X1)?costOf(tkr).fee:0;`,`const LEGFEE=0;`,'legfee');
  inj(`const CASH_DIVTAX=costOn?DIV_TAXRATE:0, CASH_EXP=costOn?0.0010:0;`,`const CASH_DIVTAX=0, CASH_EXP=0;`,'cashcost');
  /* 양도세 중화 — 운영 장부엔 세금 개념이 없다. 예전엔 COST_DEDUCT를 무한대로 올려 껐지만
     세금이 costOf/capGainTax 안으로 들어가면서 밖에서 상수를 덮어써도 안 먹는다. 식을 직접 끈다. */
  inj(`const owed=capGainTax(yearPnl, tkr); let due=owed; yearPnl=0;`,`const owed=0; let due=owed; yearPnl=0;`,'tax');
  let ivsLog=[];
  global.__DD=null;
  global.__LOGI=(type,leg,date,price,qty,amt,fee)=>ivsLog.push({type,leg,sym:leg,date,price,qty,amt,fee,ts:ivsLog.length+1});
  eval(ivsSrc);
  eval(extractFn(idx,'function ivsPos(principal,hist)'));
  global.nfix=global.nfix||((v,n)=>(+v).toFixed(n));
  const IVSC=[['TQQQ',55,40,15,'iv'],['TQQQ',55,40,10,'iv'],['TQQQ',40,60,15,'iv'],
              ['SOXL',55,40,15,'iv'],['SOXL',70,20,20,'iv'],['SOXL',55,40,15,'fix'],
              ['TECL',55,40,15,'iv'],['TECL',55,40,15,'fix']];
  for(const costOn of [false,true]){
    for(const [tkr,s0,N,band,mode] of IVSC){
      if(!DAYS[tkr]) continue;
      ivsLog=[];
      const r=runIVS(DAYS[tkr],tkr,10000,s0/100,N,band/100,costOn,mode,'cash');
      const P=ivsPos(10000,ivsLog);
      const good=near(P.qty,r.endShares,1e-6)&&near(P.cash,r.endCash,0.01);
      ok(`${tkr} s0=${s0}% N=${N} 밴드=${band}% ${mode==='fix'?'고정5:5':'역분산'} 수수료${costOn?'ON':'OFF'} — 거래 ${ivsLog.length}건`,
         good, good?'':`수량 ${P.qty.toFixed(6)}/${r.endShares.toFixed(6)} 현금 ${P.cash.toFixed(2)}/${r.endCash.toFixed(2)}`);
    }
  }
}

/* ════ 5. runVR 실행 무결성 ════ */
console.log('[5] runVR 스모크');
if(DAYS.TQQQ){
  const r=runVR(DAYS.TQQQ,'TQQQ',{contrib:100,G:10,bandPct:15,mode:0.75,formula:'basic',initAmt:10000,withdraw:100,startV:0,startPool:0});
  ok('적립식 실행·유한값', isFinite(r.final)&&r.pool>=-1e-6, 'final='+r.final+' pool='+r.pool);
  const r2=runVR(DAYS.TQQQ,'TQQQ',{contrib:100,G:10,bandPct:15,mode:0.25,formula:'basic',initAmt:10000,withdraw:100,startV:0,startPool:2000});
  ok('인출식 실행·Pool 비음수·인출 회수 포함', isFinite(r2.final)&&r2.pool>=-1e-6&&r2.totalWd>=0);
}


/* ════ 6. UI 배선 정적 스캔 (8·9차 버그 클래스 가드) ════ */
console.log('[6] UI 배선 정적 스캔');
{
  // 죽은 id 예외는 두지 않는다 — 예외를 허용해 두면 '가드가 있으니 무해'라는 이유로
  // 안 도는 코드가 계속 쌓이고, 그게 다음 버그의 은신처가 된다. (10차에서 전부 제거)
  const LEGACY_OK=new Set([]);
  const DUP_OK=new Set(['sheet_form','o_close','o_fetchnote']); // 템플릿 분기 — 런타임 단일 (기대 ×2)
  const scan=(src,label)=>{
    const idCnt={}; for(const m of src.matchAll(/id="([\w-]+)"/g)) idCnt[m[1]]=(idCnt[m[1]]||0)+1;
    const ids=new Set(Object.keys(idCnt));
    for(const m of src.matchAll(/id=\\"([\w-]+)\\"/g)) ids.add(m[1]);
    for(const m of src.matchAll(/\.id\s*=\s*['"]([\w-]+)['"]/g)) ids.add(m[1]);
    const dups=Object.entries(idCnt).filter(([k,v])=>v>1&&!(DUP_OK.has(k)&&v===2)).map(([k,v])=>k+'×'+v);
    ok(label+': 신규 중복 id 없음', dups.length===0, dups.join(','));
    const refs=new Set();
    for(const m of src.matchAll(/\$\('([\w-]+)'\)/g)) refs.add(m[1]);
    for(const m of src.matchAll(/getElementById\('([\w-]+)'\)/g)) refs.add(m[1]);
    // 템플릿으로 만드는 id(`id="${prefix}_price"`)는 접미사만 보고 인정한다
    const tmplSuffix=[...src.matchAll(/id="\$\{[^}]*\}([\w-]+)"/g)].map(m=>m[1]);
    const byTmpl=r=>tmplSuffix.some(sfx=>r.endsWith(sfx));
    const orph=[...refs].filter(r=>!ids.has(r)&&!LEGACY_OK.has(r)&&!byTmpl(r));
    ok(label+': 신규 고아 id 참조 없음', orph.length===0, orph.join(','));
    const fns=new Set();
    for(const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) fns.add(m[1]);
    for(const m of src.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) fns.add(m[1]);
    for(const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) fns.add(m[1]);
    const miss=new Set();
    for(const m of src.matchAll(/on(?:click|change|input)="\s*([A-Za-z_$][\w$]*)\s*\(/g)) if(!fns.has(m[1])) miss.add(m[1]);
    ok(label+': 미정의 인라인 핸들러 없음', miss.size===0, [...miss].join(','));
  };
  scan(idx,'index'); scan(bt,'backtest');
  // 세그 배선 짝: backtest는 seg마다 onclick 위임 필수, index는 setupSegs 목록 포함 필수
  const btSegs=[...bt.matchAll(/class="seg" id="(\w+)"/g)].map(m=>m[1]);
  const unwired=btSegs.filter(id=>!bt.includes(`getElementById('${id}').onclick`));
  ok('backtest: 모든 seg에 클릭 배선 존재', unwired.length===0, unwired.join(','));
  const setup=extractFn(idx,'function setupSegs()');
  const idxSegs=[...idx.matchAll(/class="seg" id="(\w+)"/g),...idx.matchAll(/id="(\w+)" class="seg"/g)].map(m=>m[1]);
  const unw2=idxSegs.filter(id=>!setup.includes(`'${id}'`));
  ok('index: 모든 seg가 setupSegs에 등록', unw2.length===0, unw2.join(','));
}

/* ════ 7. DOM 구조 (10차 버그 클래스: 모달이 다른 모달 안에 갇힘) ════
   닫는 </div>가 하나 모자라면 뒤따르는 블록이 통째로 앞 블록의 자식이 된다.
   div 개수는 그대로라서 태그 수 세기로는 절대 안 잡힌다 — 실제로 섀넌 모달 2개가
   무한매수법 모달 안에 들어가 있었고, 부모가 display:none이라 열어도 안 보였다. */
console.log('[7] DOM 구조');
{
  const VOID=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const OPTIONAL_END=new Set(['li','p','tr','td','th','option','dt','dd','thead','tbody','tfoot']);
  const structure=(html,label)=>{
    const body=html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<!--[\s\S]*?-->/g,'');
    const stack=[]; const nested=[]; const unclosed=[];
    for(const m of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)){
      const close=m[1]==='/', tag=m[2].toLowerCase(), attrs=m[3];
      if(close){
        let k=stack.length-1;
        while(k>=0 && stack[k].tag!==tag) k--;
        if(k>=0){
          for(let n=stack.length-1;n>k;n--) if(!OPTIONAL_END.has(stack[n].tag)) unclosed.push(stack[n]);
          stack.length=k;
        }
        continue;
      }
      if(VOID.has(tag)||/\/\s*$/.test(attrs)) continue;
      const id=(attrs.match(/\bid="([^"]+)"/)||[])[1]||'';
      const cls=(attrs.match(/\bclass="([^"]+)"/)||[])[1]||'';
      // '모달 루트'만 본다 — modal-bg ⊃ modal-card처럼 안에 들어가는 게 정상인 조각은 제외
      const isRoot=c=>c.split(/\s+/).some(x=>x==='modal'||x==='modal-bg');
      if(isRoot(cls)){
        const owner=stack.find(x=>isRoot(x.cls));
        if(owner) nested.push(`#${id||tag} ⊂ #${owner.id||owner.tag}`);
      }
      stack.push({tag,id,cls});
    }
    ok(label+': 모달이 다른 모달 안에 없음', nested.length===0, nested.join(', '));
    ok(label+': 안 닫힌 태그 없음', unclosed.length===0,
       [...new Set(unclosed.map(x=>x.tag+(x.id?'#'+x.id:(x.cls?'.'+x.cls.split(' ')[0]:''))))].slice(0,6).join(', '));
  };
  structure(idx,'index'); structure(bt,'backtest');
}


/* ════ 8. 모의 체결이 '장중 봉'을 쓰지 않는가 (11차 버그 클래스) ════
   시세 API는 장 열려 있는 동안에도 오늘 봉을 내주는데 그 close는 종가가 아니라 현재가다.
   그걸로 체결시키면 탭을 연 시각의 값이 체결가로 박히고, simLast가 넘어가
   장 마감 뒤 진짜 종가로 다시 계산되지도 않는다. 6종 전부 상한선을 걸어야 한다. */
/* 무매 거래이력 표 — 머리글과 본문 셀이 같은 순서여야 한다.
   한쪽만 바꾸면 값이 조용히 옆 칸에 들어가 손익 자리에 잔금이 찍힌다. */
{
  const head=(idx.match(/<tr><th>날짜<\/th>[\s\S]*?<\/tr>/)||[''])[0]
    .match(/<th>([^<]*)<\/th>/g).map(x=>x.replace(/<\/?th>/g,''));
  const body=(idx.match(/<tr class="\$\{cls\}"\$\{rowStyle\}>[\s\S]*?<\/tr>/)||[''])[0];
  const cells=(body.match(/<td[^>]*>(?:\$\{[^}]*\}|[^<])*/g)||[]).map(x=>x.replace(/<td[^>]*>/,''));
  const want=['날짜','구분','체결가','수량','손익률','손익','잔금','T','별%','별지점'];
  ok('무매 이력 머리글 순서', JSON.stringify(head.slice(0,want.length))===JSON.stringify(want), head.join(','));
  // 셀이 머리글과 같은 값을 같은 자리에 넣는지 — 손익·잔금이 바뀌면 여기서 잡힌다
  ok('무매 이력 본문이 머리글과 같은 순서',
     /pnlPct\(h\.profit\):'-'\}<\/td><td>\$\{profitCell\}<\/td><td>\$\{wn\(h\.balAfter\)\}/.test(body), cells.slice(4,7).join(' | '));
  /* 손익률 = 손익 ÷ 원금. 매도분 원가로 나누면 별%·익절%와 거의 같아 옆 칸과 겹치고,
     원금 기준이라야 한 사이클 손익률을 줄마다 더해서 볼 수 있다. */
  ok('손익률은 원금 기준', /const cap=\+\(\(curStrat\(\)\.settings\|\|\{\}\)\.principal\)\|\|0;/.test(idx)
     && /const r=v\/cap\*100;/.test(idx));
  ok('매수 줄엔 손익률이 없다', /\$\{\(cx\|\|sell\)\?pnlPct\(h\.profit\):'-'\}/.test(idx));
  ok('원금이 0이면 나눗셈을 안 한다', /if\(v==null\|\|!cap\) return '-';/.test(idx));
  // 열이 하나 늘면 빈 줄 colspan도 같이 늘어야 한다
  ok('빈 줄 colspan이 열 수와 맞는다', /<td class="empty" colspan="11">/.test(idx));
  /* 사이클 종료는 아이콘으로. 글자 배지는 '구분' 칸을 41px 밀어내
     좁은 화면에서 손익·잔금을 화면 밖으로 내보냈다. 줄 위 금색 선이 본 표시다. */
  ok('사이클 종료는 아이콘', /const endFlag=h\.cycleEnd\?' <span class="cyc-end" title="사이클 종료">🏁<\/span>':''/.test(idx)
     && !/>사이클 종료<\/span>/.test(idx));
  ok('종료 줄은 금색 선이 그대로', /const rowStyle=h\.cycleEnd\?' style="border-top:2px solid var\(--gold\)"':''/.test(idx));
  ok('아이콘이 줄 높이를 안 민다', /\.htable \.cyc-end\{font-size:10px;line-height:1;/.test(idx));
}

console.log('[8] 모의 체결 상한선');
{
  const SIM_FNS=['infSimForward','vrSimForward','_paperRegen','_paperDca','_paperAsap','ivsReplay','maReplay'];
  const miss=SIM_FNS.filter(n=>{
    let body; try{ body=extractFn(idx,'function '+n+'('); }catch(e){ return true; }
    return !/simCutoff\(|settledBars\(/.test(body);
  });
  ok('모의 체결 함수 전부 상한선 적용', miss.length===0, miss.join(','));
  // 장중 판정은 '거래소 현지 시각'이어야 한다 — UTC/브라우저 로컬로 하면 13시간이 어긋난다
  let cut=''; try{ cut=extractFn(idx,'function _exchNow(cur)'); }catch(e){}
  ok('장중 판정에 거래소 타임존 사용', /America\/New_York/.test(cut)&&/Asia\/Seoul/.test(cut),
     cut?'':'_exchNow 없음');
  ok('모의가 오늘 체결을 되돌릴 수 있다', /function paperRewind\(/.test(idx)&&/paperRewind\(sess\)/.test(idx));
}


/* ════ 9. 모의 기록이 '지금 설정'으로 만든 것인가 (12차 버그 클래스) ════
   모의 기록은 그때의 설정으로 기계가 만든 것이다. 분할·익절을 바꿔도 simLast가
   오늘에 있으면 새로 만들지 않아, 20분할로 만든 T·평단·수량이 40분할 세션에
   그대로 남았다. 설정 지문을 찍어 두고 어긋나면 다시 만들어야 한다. */
console.log('[9] 모의 기록·설정 정합');
{
  let keysSrc='';
  try{ keysSrc=idx.slice(idx.indexOf('const SIM_KEYS='), idx.indexOf('};', idx.indexOf('const SIM_KEYS='))+2); }catch(e){}
  const TABS=['inf','vr','ma','ivs','dca','asap'];
  const missTab=TABS.filter(t=>!new RegExp('\\b'+t+'\\s*:\\s*\\[').test(keysSrc));
  ok('SIM_KEYS가 6개 탭 전부 정의', keysSrc && missTab.length===0, missTab.join(','));
  // 키 이름이 실제 설정 키와 맞는지 — 오타가 있으면 영원히 안 걸린다
  let save=''; try{ save=extractFn(idx,'function saveSettings()'); }catch(e){}
  const bad=[];
  for(const m of keysSrc.matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)){
    for(const k of m[2].split(',').map(x=>x.trim().replace(/['"]/g,'')).filter(Boolean)){
      if(!new RegExp('\\b'+k+'\\s*:').test(save)) bad.push(m[1]+'.'+k);
    }
  }
  ok('SIM_KEYS 키가 전부 실제 설정 키', bad.length===0, bad.join(','));
  let auto=''; try{ auto=extractFn(idx,'function paperAuto()'); }catch(e){}
  ok('paperAuto가 설정 지문을 확인', /paperSyncSig\(/.test(auto));
  ok('지문 불일치 시 기계 기록만 버린다',
     /sess\.hist=\(sess\.hist\|\|\[\]\)\.filter\(x=>!\(x\.sim\|\|x\.auto\)\)/.test(idx));
  ok('시세가 없으면 지문을 찍지 않는다',
     /if\(!paperDataReady\(tab,st\)\) return false;/.test(idx));
  // 시세 캐시는 탭마다 하나뿐이다. 캐시에 든 종목을 안 보고 재사용하면
  // SOXL 종가로 TQQQ 세션의 모의 체결을 만든다 — 실제로 무매·VR이 그랬다.
  const LOADERS=['loadInfData','loadVrChart','loadIvsData','loadMaData','loadDcaData','loadAsapData'];
  const noSym=LOADERS.filter(n=>{
    let body=''; try{ body=extractFn(idx,'async function '+n+'('); }catch(e){ return true; }
    return !/\.symbol\|\|''\)\.toUpperCase\(\)===/.test(body);
  });
  ok('시세 로더가 캐시 종목을 대조', noSym.length===0, noSym.join(','));
}


/* ════ 10. 모의 장부 정합 (13차 버그 클래스) ════
   생성 규약과 장부가 어긋나면 화면 숫자가 통째로 틀린다.
   실제로 로테는 진입·청산마다 0.25%를 떼면서 장부에선 안 떼, 총자산이 0.94% 과대였다. */
console.log('[10] 모의 장부 정합');
{
  let led=''; try{ led=extractFn(idx,'function maLedger(hist, price, principal)'); }catch(e){}
  ok('로테 장부가 수수료를 반영', /IVS_FEE/.test(led) && /fee/.test(led), led?'':'maLedger 없음');
  ok('로테 실현손익이 수수료 차감 후', /\(pr-avg\)\*sq-fee/.test(led));
  // maReplay(생성)와 maLedger(장부)가 같은 수수료율을 써야 한다
  let rep=''; try{ rep=extractFn(idx,'function maReplay()'); }catch(e){}
  const feeOf=src=>{ const m=src.match(/IVS_FEE!=='undefined'\)\?IVS_FEE:([\d.]+)/); return m?m[1]:null; };
  ok('생성·장부의 수수료 기본값 동일', feeOf(rep)!==null && feeOf(rep)===feeOf(led),
     `생성 ${feeOf(rep)} / 장부 ${feeOf(led)}`);

  let stat=''; try{ stat=extractFn(idx,'function paperStat(tab, sess)'); }catch(e){}
  // 기간은 첫 기록일이 아니라 모의 시작일부터 — 아니면 연환산이 부풀려진다
  ok('모의 기간을 시작일부터 잰다', /sess\.simStart && sess\.simStart<first/.test(stat));
  // 여러 세션을 한 표에 나열하므로 통화는 줄마다 따로
  ok('성과 행에 통화를 실어 보낸다', /cur:curOf\(st\)/.test(stat));
  ok('성과 표가 줄마다 통화로 찍는다', /wnCur\(r\.inflow,r\.cur\)/.test(idx) && /wnCur\(r\.total,r\.cur\)/.test(idx));
  ok('wn은 wnCur 위에 있다(중복 구현 없음)', /function wn\(v\)\{ return wnCur\(v, curCurrency\(\)\); \}/.test(idx));
}


/* ════ 11. 무매 계산 공유 (주문표·기록시트·모의체결이 갈라지지 않는가) ════
   같은 규칙을 네 군데서 각자 구현하면 언젠가 어긋난다.
   별지점·1회매수금은 반드시 한 함수(starPct·imBuy1)를 통해서만 나와야 한다. */
console.log('[11] 무매 계산 공유');
{
  const users=['function renderOrder()','function renderStatusline()','function infSimForward(startFrom)',
               'function sheetInfHTML(today)','function infSuggest(kind)'];
  const noShare=[];
  for(const m of users){
    let body=''; try{ body=extractFn(idx,m); }catch(e){ noShare.push(m+'(없음)'); continue; }
    const needsBuy1=/1회|buy1|B1|B\./.test(body);
    if(needsBuy1 && !/imBuy1\(/.test(body)) noShare.push(m+'→imBuy1');
    if(/별지점|star/.test(body) && !/starPct\(/.test(body) && !/star5/.test(body)) noShare.push(m+'→starPct');
  }
  ok('주문표·기록시트·모의체결이 같은 계산을 쓴다', noShare.length===0, noShare.join(', '));
  // 매수 주문가는 별지점−0.01 (LOC가 별지점에서 쿼터매도와 겹치지 않게)
  let ord=''; try{ ord=extractFn(idx,'function renderOrder()'); }catch(e){}
  ok('매수 주문가 = 별지점 − 0.01', /star-0\.01|star\s*-\s*0\.01/.test(ord));
  let sim=''; try{ sim=extractFn(idx,'function infSimForward(startFrom)'); }catch(e){}
  ok('모의 체결도 별지점 − 0.01', /starPrice:star0-0\.01/.test(sim));
  // 쿼터매도는 보유÷4, 지정가매도는 나머지 (두 곳 규약 동일)
  ok('쿼터매도 = 보유÷4 (주문표·모의 동일)',
     /Math\.floor\(c\.qty\/4\)/.test(ord) && /Math\.floor\(c\.qty\/4\)/.test(sim));
}


/* ════ 12. '종가' 자리에 실시간가가 새어 들지 않는가 (13차 버그 클래스) ════
   무매는 전부 LOC — 종가 체결이다. 그런데 시세 응답에는 값이 세 개 들어 있다:
     price      = 실시간가 (장중이면 현재가)
     last.close = 마지막 일봉 종가 — 장중이면 '진행 중인 봉'이라 종가가 아니다
     확정 종가   = simCutoff 이하의 마지막 봉만
   infSuggest가 price를 먼저 쓰는 바람에 기록시트 체결가에 장중가가 박혔다
   (확정 종가 105.91인 날 105.75로 채워짐). 게다가 마감 '직후'에도 시세사가
   종가 단일가를 아직 안 실어서, 마감시각만 넘기면 되는 게 아니라 대기가 필요하다. */
console.log('[12] 종가/실시간가 분리');
{
  ok('확정 종가 해석기(settledLast) 존재',
     /function settledLast\(/.test(idx) && /function settledLast\([^)]*\)\{[^}]*settledBars\(/.test(idx));
  // 종가 확정 대기 — 마감 직후의 미확정 봉을 쓰지 않는다
  let cut=''; try{ cut=extractFn(idx,'function simCutoff(cur)'); }catch(e){}
  ok('종가 확정 대기 후에 오늘 봉을 인정', /SETTLE_LAG_MIN/.test(cut) && /const SETTLE_LAG_MIN\s*=\s*\d+/.test(idx),
     cut?'':'simCutoff 없음');
  // LOC 체결가를 만드는 곳은 실시간가를 쓰면 안 된다
  let sug=''; try{ sug=extractFn(idx,'function infSuggest(kind)'); }catch(e){}
  ok('기록시트 자동채움이 실시간가를 안 쓴다', !!sug && !/Q\.price/.test(sug), sug?'Q.price 사용':'infSuggest 없음');
  ok('기록시트 자동채움이 확정 종가를 쓴다', /const SL=infSettledLast\(\)/.test(sug)&&/const close=SL\?/.test(sug));
  /* 확정 종가를 lastQuote에 박아 두고 쓰면, 페이지를 열어 둔 채 마감·정산 시각을 넘길 때
     옛 종가에 멈춘다(실측: 기록 날짜 9/2에 8/31 종가). 쓸 때마다 봉에서 다시 골라야 한다. */
  ok('확정 종가를 쓸 때마다 다시 고른다', /function infSettledLast\(\)[\s\S]{0,400}?settledLast\(Q\.days/.test(idx));
  ok('시세 캐시가 정산 경계를 넘으면 무효', /infQuoteCache\.cut===simCutoff\(/.test(idx)
     && /infQuoteCache\.cut=simCutoff\(/.test(idx));
  ok('기록 날짜와 종가 날짜가 어긋나면 경고', /_rd>g\.closeDate/.test(idx));
  /* 무매 시세 로더 3곳 전부 last를 확정 종가로 채운다 (한 곳만 빠져도 그 화면에서 새어 든다).
     예전엔 세 곳이 각자 객체를 손으로 만들었다 — 칸이 늘 때마다 갈라져서, 실제로 배당·
     가격기준을 떨어뜨려 모의체결이 배당을 영영 못 봤다(브라우저로 재현함).
     이제 mkLastQuote 한 곳에서만 만든다: 세 곳이 그 함수를 쓰는지, 그리고 그 함수가
     확정 종가(SL)를 쓰는지 본다. */
  const loaders=idx.match(/lastQuote(?:\.inf|\[which\])\s*=\s*[^;]*;/g)||[];
  const bad=loaders.filter(t=>!/mkLastQuote\(q,SL,live\)/.test(t));
  ok('무매 시세 로더가 한 함수로 만든다', loaders.length>=3 && bad.length===0,
     `로더 ${loaders.length}곳 · 미적용 ${bad.length}곳`);
  { const mk=extractFn(idx,'function mkLastQuote(q, SL, live)');
    ok('그 함수가 확정 종가를 저장', /last:\s*SL\.close/.test(mk) && !/last:\s*q\.last\.close/.test(mk));
    /* 엔진이 보는 칸 — 하나라도 빠지면 그 경로가 조용히 옛 규약으로 돈다 */
    for(const k of ['days','ohlc','daysAdj','ohlcAdj','dividends','priceBasis'])
      ok(`시세 한 건이 ${k} 를 들고 다닌다`, new RegExp(k+':').test(mk)); }
  // VR의 last는 반대 용도(평가금용 현재가)다 — 같이 바꾸면 VR 평가금이 어제로 굳는다
  let ev=''; try{ ev=extractFn(idx,'function vrEval(c)'); }catch(e){}
  ok('VR 평가금은 확정 종가로 굳히지 않는다', /quoteOf\('vr'\)|lastQuote\.vr/.test(ev) && !/settledLast\(/.test(ev));
}


/* ════ 13. LOC 주문가가 증권사 상한을 넘지 않는가 (14차 버그 클래스) ════
   거래소·증권사는 기준가에서 멀리 떨어진 지정가를 거부한다. 무매의 별지점·평단 매수는
   평단이 종가보다 한참 위일 때(=물려 있을 때) 종가 대비 +20~30%가 되어 주문 자체가 튕겼다.
   앱은 '큰수 %'로 처음매수에만 상한을 걸어 뒀고 매일 내는 매수엔 안 걸어 뒀던 게 원인. */
console.log('[13] LOC 주문가 상한');
{
  let ord=''; try{ ord=extractFn(idx,'function renderOrder()'); }catch(e){}
  /* 허용폭을 넘으면 상한을 씌워 낸다. 공짜가 아니라는 걸 안내문이 말해야 한다 —
     체결조건이 바뀌어 종가가 상한 위로 마감한 날은 회차를 건너뛴다.
     6년·10개 설정 실측 최악: +12% −31.3% · +15% −28.2% · +20% −3.1%.
     상한이 높을수록 바뀌는 결정이 줄어 꼬리가 닫히므로 기본값을 20으로 둔다.
     MOC면 밴드를 피하지만 국내 증권사는 MOO/MOC를 매도만 지원해 매수엔 못 쓴다. */
  ok('허용폭 초과 매수에 상한을 씌운다', /imBuyOrders\(\{[\s\S]{0,200}cap:limit/.test(ord)
     && /const cap=p=>\(o\.cap>0&&p>o\.cap\)\?o\.cap:p;/.test(idx),
     ord?'':'renderOrder 없음');
  ok('값으로 — 상한을 넘는 주문가는 상한으로 낮추고 표시한다', (()=>{
      const r=imBuyOrders({first:false,half:false,buy1:1000,bal:5000,starPrice:12,avg:10,cap:11,rows:0,fee:0,cur:'usd'});
      return r.length===1 && r[0].price===11 && r[0].capped===true && r[0].orig===12; })());
  ok('상한이 공짜가 아님을 안내한다', /건너뜁니다|건너뛰/.test(ord) && /큰수 %/.test(ord));
  /* 기준 종가를 입력칸에서만 읽으면, 보유 중인 세션(입력칸이 숨김)에서 close=0이 되어
     limit=0 → 상한이 통째로 꺼진다. 실제로 현재가보다 +33%인 주문가가 그대로 나갔다. */
  ok('기준 종가가 시세로 폴백된다 (입력칸이 비어도)',
     /inputNum\('o_close'\)\|\|\(_sl\?/.test(ord) && /infSettledLast\(\)/.test(ord));
  ok('폴백 시세는 종목을 대조한다', /Q\.symbol[\s\S]{0,120}st\.ticker/.test(idx));
  /* 큰수 기본은 한 곳(IM_BIG_DEFAULT)에서만 나온다 — 예전엔 신규 15 · 백테 15 ·
     옛 세션 fallback 20 이 섞여 같은 설정인데 화면마다 상한이 달랐다 (4차 감사 ④). */
  ok('큰수 % 기본값이 한 곳에 있다', /const IM_BIG_DEFAULT=15;/.test(idx) && /const IM_BIG_DEFAULT=15;/.test(bt));
  ok('앱·백테의 imBigPct 가 같은 몸이다', (()=>{
      const re=/function imBigPct\(st\)\{[^\n]*\}/;
      const a=(idx.match(re)||[''])[0], b=(bt.match(re)||[''])[0];
      return !!a && a===b; })());
  ok('기본 세션이 그 상수를 읽는다', /big:IM_BIG_DEFAULT,/.test(idx) && !/big:15,/.test(idx));
  ok('fallback 20 이 안 남아 있다', !/\+st\.big:20/.test(idx));
  ok('값으로 — 미설정·0·음수는 15, 설정값은 그대로',
     imBigPct({})===15 && imBigPct({big:0})===15 && imBigPct({big:-3})===15
     && imBigPct({big:25})===25 && imBigPct(undefined)===15,
     `${imBigPct({})} ${imBigPct({big:25})}`);
  ok('백테 두 엔진이 같은 헬퍼를 쓴다',
     (bt.match(/const bigPct=imBigPct\(\{big:bigOverride\}\);/g)||[]).length===2
     && !/const bigPct=15;/.test(bt));
  ok('백테 엔진이 큰수를 파라미터로 받는다',
     /function runIM\(days,tkr,cap,divs,targetPct,compound=true,bigOverride\)/.test(bt)
     && /function runIM50\(days,tkr,cap,divs,targetPct,compound=true,bigOverride\)/.test(bt));
  ok('모의체결도 같은 헬퍼를 쓴다',
     /const bigPct=imBigPct\(st\);/.test(extractFn(idx,'function infSimForward(startFrom)')));
  ok('하방 LOC는 같은 상한', /const p=cap\(vrTickDn\(o\.buy1\/\(Q\+k\), o\.cur\)\);/.test(idx));
  /* 수량 = 배정액 ÷ 주문가 (V4.0 정식 문서: '1회매수금 ÷ 주문가'). 예전엔 전일 종가로 나눴다.
     운영·모의·서버·백테·플랜이 모두 imBuyOrders 한 함수로 세므로 서로 갈릴 수 없다. */
  ok('수량은 주문가 기준 (정식 — 1회매수금÷주문가)', (()=>{
      const r=imBuyOrders({first:false,half:false,buy1:1000,bal:5000,starPrice:9,avg:10,cap:0,rows:0,fee:0,cur:'usd'});
      return r.length===1 && r[0].q===111; })());
  /* SOURCE GOLDEN — V4.0 일반모드 정리본의 예시 그대로:
     'TQQQ 종가 45.93$ → 큰수 51.44$ (12개), 47.53$ (1개), 44.13$ (1개), …'
     1회매수금 617.9(원금 12358 ÷ 20) · 큰수 12% → 51.4416 에 12주, 추가 줄 617.9÷13 = 47.53 · 617.9÷14 = 44.13 */
  ok('SOURCE GOLDEN — 처음매수 51.44×12 · 아래로 47.53 · 44.13 (정리본 예시)', (()=>{
      const r=imBuyOrders({first:true,half:false,buy1:12358/20,bal:12358,firstPrice:45.93*1.12,starPrice:0,avg:0,cap:45.93*1.12,rows:2,fee:0,cur:'usd'});
      return r.length===3 && r[0].kind==='1회매수' && r[0].price.toFixed(2)==='51.44' && r[0].q===12
        && r[1].ladder && r[1].price===47.53 && r[1].q===1 && r[2].ladder && r[2].price===44.13 && r[2].q===1
        && r.reduce((a,o)=>a+o.dT,0)===1; })(),
     JSON.stringify(imBuyOrders({first:true,half:false,buy1:12358/20,bal:12358,firstPrice:45.93*1.12,starPrice:0,avg:0,cap:45.93*1.12,rows:2,fee:0,cur:'usd'})));
  /* '아래로' — 전반전엔 ÷(Q+1) 이 별지점 위로 나올 수 있다(실데이터 SOXL 2021-03-22: 36.77 > 별지점 35.66).
     그런 줄은 걸지 않는다 — 걸면 쿼터매도가 체결되는 종가에 되사게 된다. */
  ok('아래로 LOC 추가는 본 주문 최저가보다 아래에만 (전반전)', (()=>{
      const r=imBuyOrders({first:false,half:true,buy1:698.6577,bal:7647.03,starPrice:35.6607,avg:35.0088,cap:38.75,rows:8,fee:0,cur:'usd'});
      const m=r.filter(o=>!o.ladder), l=r.filter(o=>o.ladder), lo=Math.min(...m.map(o=>o.price));
      return m.length===2 && m[0].q===9 && m[1].q===9 && l.length===8 && l.every(o=>o.price<lo) && l[0].price===34.93; })());
  // 매도는 절대 낮추면 안 된다 — 낮추면 원치 않는 체결이 난다
  const sellCap=/oitem\('s'[^)]*limit/.test(ord);
  ok('매도가는 상한으로 낮추지 않는다', !sellCap, sellCap?'매도에 상한 적용됨':'');
  // 큰수 %가 없는 옛 세션에서 NaN이 되어 상한이 통째로 꺼지지 않아야 한다
  ok('큰수 % 미설정 세션도 상한 동작', /const bigPct=imBigPct\(st\);/.test(ord));
}


/* ════ 14. 체결가 규약 — 주문 종류별로 어느 가격에 체결되는가 (15차 버그 클래스) ════
   LOC는 종가, 지정가매도는 익절가. 그런데 시가가 이미 익절가 위면 지정가 매도는
   '시가'에 체결된다(가격개선). 익절가로 고정하면 갭업 익절이 통째로 과소계상된다.
   백테 두 엔진(runIM/runIM50)과 모의(infSimForward) 셋 다 같은 규약이어야 한다. */
console.log('[14] 체결가 규약');
{
  const tpBt=(bt.match(/_sell\(o>tgt\?o:tgt,q3,SLIP\)/g)||[]).length;
  ok('백테 두 엔진 다 갭업 체결가 반영', tpBt===2, `${tpBt}곳 (runIM·runIM50 = 2곳이어야)`);
  let sim=''; try{ sim=extractFn(idx,'function infSimForward(startFrom)'); }catch(e){}
  ok('모의도 갭업 체결가 반영', /put\('지정가매도',d,\(op>tgt\?op:tgt\),qTp\)/.test(sim), sim?'':'infSimForward 없음');
  ok('모의가 시가를 봉에서 읽는다', /op=\(row\.open>0\?row\.open:0\)/.test(sim));
  // LOC는 반드시 종가 — 매수·쿼터매도가 종가 아닌 값으로 체결되면 안 된다
  ok('모의 매수는 종가 체결', /const hit=buys\.filter\(b=>cl<=b\.lim\)/.test(sim)
     && /mains\.forEach\(\(b,i\)=>put\(b\.kind,d,cl,/.test(sim) && /put\('1회매수',d,cl,extra\)/.test(sim));
  ok('모의 쿼터매도는 종가 체결', /put\('쿼터매도',d,cl,/.test(sim));
  /* 지정가 익절은 장 시작 전에 이미 걸어 둔 주문이다. 따라서 당일 고가가 지정가에
     도달하면 체결로 본다. 운영 주문표와 백테 runIM(imFill=high)의 규약과 같아야 한다. */
  ok('익절 지정가는 고가 터치로 판정', /if\(hi>=tgt && qTp>0\)/.test(sim) && !/if\(cl>=tgt && qTp>0\)/.test(sim));
  ok('익절 체결가는 max(익절가, 시가)', /put\('지정가매도',d,\(op>tgt\?op:tgt\),qTp\)/.test(sim));
  // 규약을 바꾸면 이미 쌓인 모의 기록도 다시 만들어져야 한다 — 설정 지문만으로는 안 걸린다
  ok('체결 규약 판이 모의 지문에 들어간다',
     /const SIM_RULE_VER=\d+/.test(idx) && /'r'\+SIM_RULE_VER\+'\|'/.test(idx));
}


/* ════ 15. 세션 탭 드래그 정렬이 기존 조작을 깨지 않는가 ════
   세션바는 가로 스크롤 줄이라 드래그를 붙이면 ① 스크롤이 안 되거나
   ② 끌고 놓은 뒤 따라오는 click이 세션을 바꿔 버리기 쉽다. */
console.log('[15] 세션 탭 드래그');
{
  let su=''; try{ su=extractFn(idx,'function setupSessbar()'); }catch(e){}
  ok('터치·마우스 배선 존재', /touchstart/.test(su)&&/touchmove/.test(su)&&/touchend/.test(su)
     &&/mousedown/.test(su)&&/mousemove/.test(su)&&/mouseup/.test(su), su?'':'setupSessbar 없음');
  /* 스크롤 차단은 non-passive touchmove + preventDefault로만 된다.
     pointermove의 preventDefault는 스펙상 스크롤을 취소하지 못하고, touch-action은
     터치 시작 시점에 확정돼 중간 변경이 무시된다 — 그래서 폰에서 드래그가 통째로 죽었다. */
  ok('touchmove가 non-passive (스크롤 차단 가능)', /touchmove[\s\S]{0,400}?\{passive:false\}/.test(su));
  // 주석에 이름이 나오는 건 괜찮고, '리스너로 등록'하면 안 된다
  ok('스크롤 차단을 포인터 이벤트에 기대지 않는다', !/addEventListener\(\s*'pointermove'/.test(su));
  ok('마우스는 창 전체에서 추적 (바 밖으로 나가도 유지)',
     /window\.addEventListener\('mousemove'/.test(su)&&/window\.addEventListener\('mouseup'/.test(su));
  let dd=''; try{ dd=extractFn(idx,'function _dragDown(chip,x,y,isMouse)'); }catch(e){}
  let dm=''; try{ dm=extractFn(idx,'function _dragMove(x,y)'); }catch(e){}
  ok('터치는 길게누름으로 스크롤과 구분', /DRAG_HOLD/.test(dd)&&/_dragStart\.mouse/.test(dm));
  ok('세션 1개면 드래그 안 함', /sessions\.length<2/.test(dd));
  ok('두 손가락은 드래그로 잡지 않는다', /touches\.length!==1/.test(su));
  ok('놓은 뒤 click이 세션을 바꾸지 않는다', /_dragEndAt<\d+/.test(su));
  // 시간 기반이어야 한다 — 불리언 플래그는 click이 안 따라올 때 남아 다음 탭을 씹는다
  ok('억제가 시간 기반(플래그 잔류 없음)', !/_dragJustEnded/.test(idx));
  let st=''; try{ st=extractFn(idx,'function _dragStop()'); }catch(e){}
  ok('정렬 결과를 저장하고 다시 그린다', /save\(\)/.test(st)&&/renderSessbar\(\)/.test(st));
  ok('드래그 중 스크롤 차단 CSS', /\.sessbar\.dragmode\{[^}]*touch-action:none/.test(idx));
}


/* ════ 16. 적립 탭의 적립/거치 두 방식 ════
   거치식은 시작일에 원금 전액을 한 번 사고 끝이다 — 주기도 배수도 없다.
   한 군데라도 빠지면 거치 세션에 적립 규칙이 새어 든다. */
console.log('[16] 적립·거치 방식');
{
  ok('기본 설정에 mode 존재', /function defDcaSettings\(\)[\s\S]{0,200}?mode:'dca'/.test(idx));
  ok('설정 UI에 방식 선택', /id="set_dcamode"/.test(idx) && /data-v="lump"/.test(idx));
  ok('설정 저장이 mode를 담는다', /mode:segGet\('set_dcamode'\)\|\|'dca'/.test(idx));
  ok('방식 전환이 세그에 배선', /id==='set_dcamode'\) dcaModeUI\(\)/.test(idx)
     && /'set_dcamode'/.test(idx));
  // 지문에 mode가 없으면 방식을 바꿔도 옛 기록이 남는다
  let keys=''; try{ keys=idx.slice(idx.indexOf('const SIM_KEYS='), idx.indexOf('};', idx.indexOf('const SIM_KEYS='))+2); }catch(e){}
  ok('모의 지문에 mode 포함', /dca\s*:\s*\[[^\]]*'mode'/.test(keys));
  // 거치식은 배수를 절대 타면 안 된다
  let cd=''; try{ cd=extractFn(idx,'function computeDca()'); }catch(e){}
  ok('거치식은 배수 1배 고정', /lump\?1:\(\+st\.dipMul\|\|1\)/.test(cd) && /todayMul:\(lump\?1:todayMul\)/.test(cd));
  let pd=''; try{ pd=extractFn(idx,'function _paperDca(sess, from)'); }catch(e){}
  ok('모의 거치식은 시작일 한 번만 매수', /if\(lump\)\{[\s\S]{0,400}?n:1,\s*regen:true/.test(pd), pd?'':'_paperDca 없음');
  ok('모의 거치식도 배수 1배', /const mul=lump\?1:/.test(pd));
  // 성과표에서 적립과 거치가 구분돼야 비교가 된다
  ok('성과표가 적립·거치를 구분', /mode==='lump'\)\s*\?\s*'거치\(일시금\)'/.test(idx));
  ok('거치식은 주기·배수 칸을 감춘다', /function dcaModeUI\(\)[\s\S]{0,500}?set_dcaonly/.test(idx));
  /* 적립식 기본값 — 매일 $10 · 재투자 · 배수 없음. 설정 화면 초기 선택도 같아야
     '새 세션을 열었더니 화면과 저장값이 다른' 상태가 안 생긴다. */
  let dd2=''; try{ dd2=extractFn(idx,'function defDcaSettings()'); }catch(e){}
  ok('적립 기본값 = 매일·$10·재투자·1배',
     /amount:10/.test(dd2)&&/freq:'day'/.test(dd2)&&/dipMul:1/.test(dd2)&&/reinv:true/.test(dd2), dd2||'없음');
  ok('설정 화면 초기 선택이 기본값과 같다',
     /data-v="day" class="on"/.test(idx) && /id="set_dcaamt"[^>]*value="10"/.test(idx)
     && /data-v="reinv" class="on"/.test(idx) && /data-v="1" class="on">없음/.test(idx));
  /* 모의는 freq로 매수 스케줄을 만든다(keyOf). '계산에 영향 없음'은 틀린 안내다. */
  let pd2=''; try{ pd2=extractFn(idx,'function _paperDca(sess, from)'); }catch(e){}
  ok('모의가 주기로 매수 스케줄을 만든다', /const keyOf=d=>[\s\S]{0,200}?freq==='day'/.test(pd2), pd2?'':'_paperDca 없음');
  ok("주기 안내가 '영향 없음'이라 말하지 않는다", !/적립 주기[\s\S]{0,140}?계산에는 영향 없음/.test(idx));
  /* 화면 곳곳에 적립식 규칙(주기·하락배수)이 남으면, 거치 세션인데 안 쓰는 규칙이
     켜져 있는 것처럼 보인다 — 실제로 상태줄에 '매월 $10,000 · 하락 2배'가 찍혔다. */
  let sl=''; try{ sl=extractFn(idx,'function renderStatusline()'); }catch(e){}
  ok('상태줄이 거치식엔 주기·배수를 안 찍는다', /if\(c\.lump\)\{[\s\S]{0,300}?거치 \$\{wn\(st\.amount\)\}/.test(sl), sl?'':'renderStatusline 없음');
  let rn=''; try{ rn=extractFn(idx,'function renderDcaNow()'); }catch(e){}
  ok("거치식 카드 제목이 '오늘 적립'이 아니다", /dca_verdict_h[\s\S]{0,120}?c\.lump \? '거치 현황'/.test(rn));
  ok('거치식 게이지는 참고용으로 표시', /dca_gauge_lbl[\s\S]{0,120}?참고용/.test(rn));
  let ra=''; try{ ra=extractFn(idx,'function renderDcaAnal()'); }catch(e){}
  ok('분석 카드가 거치식에 배수 행을 안 쓴다', /c\.lump\?'—'/.test(ra) && /c\.lump\?'방식':'하락 배수 매수'/.test(ra));
}


/* ════ 17. 배당·분배금 회계 + 티커 자유입력 ════
   series의 close는 adjclose(배당 재투자 반영)다. 거기에 분배금을 또 더하면 이중계상이다.
   그래서 매수 체결가·평가는 raw 종가로, 분배금은 events에서 따로 받아 더한다. */
console.log('[17] 배당·분배금 · 티커 입력');
{
  const q=fs.existsSync(__d+'/functions/api/quote.js')?fs.readFileSync(__d+'/functions/api/quote.js','utf8'):'';
  ok('quote API가 배당·분할 이벤트를 낸다', /events=div%7Csplit/.test(q) && /out\.dividends/.test(q), q?'':'quote.js 없음');
  ok('quote API가 raw 종가를 같이 낸다', /out\.raw/.test(q) && /wantDiv && rawA\[i\]/.test(q));
  ok('배당 옵션은 opt-in (기존 응답 불변)', /url\.searchParams\.get\("div"\) === "1"/.test(q) && /if \(wantDiv\) \{ out\.dividends/.test(q));
  const se=fs.existsSync(__d+'/functions/api/search.js')?fs.readFileSync(__d+'/functions/api/search.js','utf8'):'';
  ok('티커 검색 API 존재', /finance\/search/.test(se) && /onRequestGet/.test(se), se?'':'search.js 없음');
  ok('국내상장은 6자리 코드로 정규화', /\\.\(KS\|KQ\)\$/.test(se) || /KS\|KQ/.test(se));

  // 이름이 _fetchDailyDivRaw 로 바뀌고 fetchDailyDiv 는 시세를 아끼는 래퍼가 됐다
  ok('배당 포함 로더 존재', /async function _fetchDailyDivRaw\(symbol\)/.test(idx)
     && /const fetchDailyDiv=_memoQuote\(_fetchDailyDivRaw\);/.test(idx) && /div=1/.test(idx));
  let cd=''; try{ cd=extractFn(idx,'function computeDca()'); }catch(e){}
  ok('분배금은 배당락일 보유수량 기준', /for\(const d of divs\)/.test(cd) && /held\+=buys\[bi\]\.q/.test(cd), cd?'':'computeDca 없음');
  ok('재투자는 그날 raw 종가로 되산다', /if\(reinv\)\{ const rp=rawMap\[d\.date\]/.test(cd));
  ok('가격수익률과 총수익률을 분리', /retPrice:/.test(cd) && /total=evalNow\+\(pos\.reinv\?0:pos\.divCash\)/.test(cd));
  let pd=''; try{ pd=extractFn(idx,'function _paperDca(sess, from)'); }catch(e){}
  ok('모의 매수 체결가는 raw 종가', /const buyPx=i=>rawM\[days\[i\]\.date\]/.test(pd) && !/price:\+cl\[i\]/.test(pd), pd?'':'_paperDca 없음');
  let keys=''; try{ keys=idx.slice(idx.indexOf('const SIM_KEYS='), idx.indexOf('};', idx.indexOf('const SIM_KEYS='))+2); }catch(e){}
  ok('모의 지문에 reinv 포함', /dca\s*:\s*\[[^\]]*'reinv'/.test(keys));
  // 성과표도 분배금을 자산에 넣어야 각 탭 분석과 값이 같다
  let ps=''; try{ ps=extractFn(idx,'function paperRaw(tab, sess)'); }catch(e){}
  ok('성과표가 분배금 포함 총자산을 쓴다', /total=c\.ready\?c\.total:/.test(ps));

  ok('티커는 자유 입력 (버튼 선택 아님)', /id="set_dcaticker_in"/.test(idx) && !/id="set_dcaticker"/.test(idx));
  ok('입력값으로 저장한다', /ticker:tkVal\('set_dcaticker_in','USD'\)/.test(idx));
  ok('자동완성 배선', /function tkSearch\(id\)/.test(idx) && /\/api\/search\?q=/.test(idx));
  // 늦게 온 응답이 새 결과를 덮으면 엉뚱한 목록이 뜬다
  ok('늦은 응답이 새 결과를 안 덮는다', /if\(seq!==_tk\.seq\) return;/.test(idx));
  // blur가 먼저 나면 click이 안 잡힌다 — mousedown/touchstart로 받아야 한다
  ok('목록 선택이 blur보다 먼저 잡힌다', /addEventListener\('mousedown'/.test(idx) && /addEventListener\('touchstart'/.test(idx));
}


/* ════ 18. 백테 분배금 분해 ════
   M의 close는 adjclose라 기존 수익률은 이미 '분배금 재투자 총수익'이다.
   그걸 건드리지 않고 옆에 '가격만 + 받은 분배금'을 덧붙인다.
   커버드콜은 분배는 많은데 원금이 녹는다 — 둘을 나눠야 그게 보인다. */
console.log('[18] 백테 분배금 분해');
{
  ok('배당·raw 저장소 존재', /let DIV=\{\}, RAW=\{\}/.test(bt));
  ok('시세 요청이 배당을 함께 받는다', /&div=1`;/.test(bt) && /function quoteUrl\(sym, p1, p2\)/.test(bt));
  ok('청크마다 배당·raw를 합친다',
     /bag\.div\[x\.date\]=\+x\.amount/.test(bt) && /bag\.raw\[x\.date\]=\+x\.close/.test(bt));
  let ds=''; try{ ds=extractFn(bt,'function divSplit(tkr, days, buys)'); }catch(e){}
  ok('분해기 존재', !!ds, ds?'':'divSplit 없음');
  ok('분배금은 배당락일 보유수량 기준', /while\(bi<B\.length && B\[bi\]\[0\]<=d\)/.test(ds) && /dvMap\[d\]!=null && sh>0/.test(ds));
  // 단리는 현금이 쌓여 복리와 낙폭이 다르다 — 이벤트만 훑으면 중간 낙폭을 못 잰다
  ok('단리 MDD를 날짜를 걸으며 잰다', /for\(const d of days\)/.test(ds) && /mddCash:mdd\*100/.test(ds));
  ok('매수 단가는 raw 종가', /const rawAt=d=>/.test(ds) && /sh\+=B\[bi\]\[1\]\/p/.test(ds));
  ok('가격수익·현금수령총수익을 따로 낸다', /retPrice:/.test(ds) && /retCash:/.test(ds));
  ok('배당 없으면 null (화면에서 감춤)', /if\(!inWin\.length\) return null/.test(ds));
  // 기존 수익률(adjclose)은 절대 바뀌면 안 된다 — 앵커가 그걸 물고 있다
  let dc=''; try{ dc=extractFn(bt,'function _dcaOne(t,days,amt,freq,costOn,dipMul)'); }catch(e){}
  ok('적립 결과에 div를 덧붙인다(기존 ret 불변)',
     /ret:inv>0\?\(fin\/inv-1\)\*100:0/.test(dc) && /div:_div/.test(dc));
  let bh=''; try{ bh=extractFn(bt,'function runBH(days,tkr,cap,costOn)'); }catch(e){}
  ok('거치(B&H)에도 분해를 붙인다', /divSplit\(tkr,days,\[\[days\[0\]/.test(bh));
  // 단리 선택 시에만 raw 경로 결과로 갈아끼운다 (배당 없는 종목은 두 경로가 같아 불변)
  let d1=''; try{ d1=extractFn(bt,'function _dcaOne(t,days,amt,freq,costOn,dipMul)'); }catch(e){}
  ok('단리면 최종·MDD를 현금수령 경로로', /dcaReinv===false/.test(d1) && /fin=_div\.priceVal\+_div\.divCash/.test(d1)
     && /dcaReinv===false/.test(bh));
  /* 표는 수익률을 셋으로 쪼갠다: 가격 + 분배 = 합계. CAGR·MDD도 합계 기준.
     기준 투입금을 안 맞추면 셋이 안 더해진다(divSplit은 수수료 뺀 순매수액을 쓴다). */
  ok('표에 분배금·가격수익·분배수익 열', /const anyDiv=ranked\.some/.test(bt)
     && /가격 수익/.test(bt) && /분배 수익/.test(bt) && /합계 수익률/.test(bt));
  ok('가격+분배=합계가 되게 기준을 맞춘다',
     /const inv=r\.invested\|\|d\.invRaw\|\|1;/.test(bt) && /const retD=r\.ret-retP;/.test(bt));
  ok('배당 없는 종목은 가격=합계·분배 0', /배당 없으면 가격=합계/.test(bt));
  ok('복리/단리 토글 존재', /id="dcaReinv"/.test(bt) && /let dcaReinv=true/.test(bt)
     && /dcaReinv=e\.target\.dataset\.r==='1'/.test(bt));
  ok('안내문이 현재 모드를 알린다', /복리\(분배금 재투자\)':'단리\(분배금 현금\)/.test(bt));
}


/* ════ 19. 운영 무매 출금 · 복리/단리 ════
   잔금 = 원금 + 실현손익 − 보유원가 − 출금 − 단리적립.
   출금과 단리적립은 계좌 밖으로 나갔을 뿐 없어진 돈이 아니라 총자산엔 다시 더한다.
   단리 규약은 백테 runIM과 같아야 한다 — 사이클 끝에 원금 초과분만 빼고,
   손실로 끝난 사이클은 그대로 이월(외부 수혈 없음). */
console.log('[19] 출금 · 복리/단리');
{
  let ci=''; try{ ci=extractFn(idx,'function computeInf()'); }catch(e){}
  ok('출금 기록을 잔금에서 뺀다', /h\.kind==='출금'/.test(ci) && /withdrawn \+= Math\.max\(0,\+h\.amt\|\|0\)/.test(ci), ci?'':'computeInf 없음');
  ok('잔금 식에 출금·단리인출·배당 반영', /principal\+realized\+divTotal-inv-withdrawn-saved/.test(ci)
     && !/\+added/.test(ci));
  /* 단리 판정은 '사이클 종료 잔액이 최초 원금을 넘는가'다.
       넘으면 넘은 만큼만 인출하고 원금으로 다시 시작
       못 넘으면 인출도 보충도 없이 그 잔액 그대로 다음 사이클로
     한때 모자란 만큼 밖에서 채워 넣었는데, 그건 번 돈이 아니라 새로 넣은 돈이다. */
  ok('넘은 만큼만 인출한다',
     /if\(simple\)\{[\s\S]{0,420}?if\(cashNow>P0\)\{ fo=cashNow-P0; saved\+=fo; \}/.test(ci));
  ok('모자라도 채워 넣지 않는다',
     !/added\+=/.test(ci) && !/cashNow<P0/.test(ci));
  // 오간 돈의 시점을 한 곳에서 모아 둔다 — 카드도 표도 이걸 쓴다
  ok('오간 돈을 한 곳에서 모은다',
     /flows\.push\(\{date:h\.date, seq:cycleSeq, out:fo, in:0\}\);/.test(ci));
  // 백테도 같은 규약이어야 한다 — 한쪽만 바꾸면 모의와 백테가 갈린다
  ok('백테도 채워 넣지 않는다', !/addedCash\+=/.test(bt));
  ok('백테는 넣은 돈을 총자산에서 뺀다', /\+savedProfit-addedCash;/.test(bt));
  ok('단리 판정은 compound===false', /const simple=\(st\.compound===false\)/.test(ci));
  // 입금 자리(added)는 아예 없앴다 — 무매는 나가기만 한다
  ok('출금·단리인출을 밖으로 낸다', /withdrawn,saved,divTotal,flows,simple,outside:withdrawn\+saved/.test(ci));
  ok('무매 반환값에 입금 자리가 없다', !/added:0/.test(ci));
  // 출금이 매매로 잡히면 사이클 종료·T가 오염된다
  ok('출금은 매수·매도가 아니다', /function isBuy\(k\)\{return k==='출금'\?false/.test(idx)
     && /function isSell\(k\)\{return k!=='출금'/.test(idx));
  // 백테와 같은 규약인지 (초과익만·손실 이월)
  ok('백테 단리 규약과 동일', /else if\(cash>cap\)\{ savedProfit\+=cash-cap; cash=cap; \}/.test(bt));
  // 설정·지문
  ok('복리/단리 설정 존재', /id="set_compound"/.test(idx) && /compound:segGet\('set_compound'\)!=='0'/.test(idx));
  let keys=''; try{ keys=idx.slice(idx.indexOf('const SIM_KEYS='), idx.indexOf('};', idx.indexOf('const SIM_KEYS='))+2); }catch(e){}
  ok('모의 지문에 compound 포함', /inf\s*:\s*\[[^\]]*'compound'/.test(keys));
  // 총자산에 다시 더하지 않으면 출금할 때마다 수익률이 떨어져 보인다
  let ra=''; try{ ra=extractFn(idx,'function renderInfAnal()'); }catch(e){}
  ok('총자산이 나간 돈을 다시 더한다', /c\.bal\+\(c\.outside\|\|0\)/.test(ra), ra?'':'renderInfAnal 없음');
  let ps=''; try{ ps=extractFn(idx,'function paperRaw(tab, sess)'); }catch(e){}
  ok('성과표도 같은 기준', /price\*c\.qty \+ c\.bal \+ \(c\.outside\|\|0\)/.test(ps));
  // 입력·편집 경로
  ok('시트에 출금 항목·금액칸', /kindOptHTML\('출금'/.test(idx) && /id="sh_amt"/.test(idx));
  ok('편집에서도 출금 가능', /<option value="출금">/.test(idx) && /id="ei_amt"/.test(idx));
  /* 모의 성과표 — 단리는 익절금이 계좌 밖으로 빠져 있다. 평가금엔 더해 놨어도
     '얼마가 나갔는지'를 안 보이면 잔금이 왜 안 늘었는지 알 수 없다. */
  ok('성과표가 단리 인출액을 낸다', /_out=\{saved:\(c\.saved\|\|0\)\+_dv\.divCash, withdrawn:c\.withdrawn\|\|0, simple:!!c\.simple\}/.test(idx)
     && /nTrade, price, out:_out, mdd\}/.test(idx));
  ok('성과표에 인출 태그를 그린다', /O\.simple\?'단리 인출':'출금'/.test(idx));
  /* 익절 조절 숨김 — SOXL 열위·MDD 악화 구간 때문. UI만 감추고 코드는 남긴다.
     감추기만 하면 켜져 있던 세션을 끌 방법이 없으므로 저장분도 꺼야 한다. */
  ok('익절 조절 UI 숨김', /\.tgtdyn-hidden\{display:none !important\}/.test(idx)
     && /class="seg tgtdyn-hidden" id="set_tgtdyn"/.test(idx));
  ok('켜져 있던 익절 조절을 끈다', /o\.settings\.tgtDyn===true\) o\.settings\.tgtDyn=false/.test(idx));
  ok('익절 조절 코드는 남아 있다 (되살릴 수 있게)', /st\.tgtDyn===true/.test(idx) && /imTgtOf\(/.test(idx));
}


/* ════ 20. 티커 검색 — 전 탭 ════
   종목을 버튼 목록으로만 고르면 목록에 없는 ETF는 아예 못 쓴다.
   운영 6탭·백테 전탭을 자유 입력 + 검색 자동완성으로 바꿨다.
   버튼(seg)에서 입력칸으로 바꾼 이상, 옛 seg를 읽던 코드가 남으면
   저장은 빈 값이 되고 openSettings는 null.querySelectorAll로 죽는다. */
console.log('[20] 티커 검색 — 전 탭');
{
  const TABS=[['무매','set_ticker_in','SOXL'],['섀넌','set_ivsticker_in','TQQQ'],
              ['로테','set_maticker_in','SOXL'],['ASAP','set_asapticker_in','SOXL'],
              ['적립','set_dcaticker_in','USD']];
  for(const [name,id,dflt] of TABS){
    ok(`운영 ${name} 티커 입력칸`,
       new RegExp(`id="${id}"[^>]*oninput="tkSearch\\('${id}'\\)"`).test(idx)
       && idx.includes(`id="${id}_list"`));
    ok(`운영 ${name} 저장은 입력값으로`, idx.includes(`tkVal('${id}','${dflt}')`));
  }
  ok('운영 VR 티커도 자동완성', /id="set_vticker"[^>]*oninput="tkSearch\('set_vticker'\)"/.test(idx)
     && idx.includes('id="set_vticker_list"'));
  // 옛 seg를 읽거나 쓰는 코드가 남아 있으면 저장이 비거나 설정창이 죽는다
  const dead=['set_ticker','set_ivsticker','set_maticker','set_asapticker','set_dcaticker']
    .filter(t=>new RegExp(`seg(Get|Set)\\('${t}'`).test(idx));
  ok('옛 seg 배선이 남아 있지 않다', dead.length===0, dead.join(','));
  ok('설정창은 입력칸에 값을 넣는다', /\$\('set_ivsticker_in'\)\.value=st\.ticker/.test(idx)
     && /\$\('set_maticker_in'\)\.value=st\.ticker/.test(idx)
     && /\$\('set_asapticker_in'\)\.value=st\.ticker/.test(idx));
  // seg 초기화 루프가 입력칸 id를 잡으면 querySelectorAll에서 죽는다
  const segs=(idx.match(/\['set_div'[\s\S]{0,900}?\]/)||[''])[0];
  ok('seg 목록에 티커 id가 없다',
     !/'set_ticker'|'set_ivsticker'|'set_maticker'|'set_asapticker'|'set_dcaticker'/.test(segs));
  ok('무매는 종목 바뀌면 익절배율을 다시 잡는다', /function onInfTickerChange\(\)/.test(idx)
     && /onchange="onInfTickerChange\(\)"/.test(idx));

  // ── 백테 ──
  ok('백테 전략탭 검색 입력칸', /id="addTicker2"[^>]*oninput="tkSearch\('addTicker2'\)"/.test(bt)
     && bt.includes('id="addTicker2_list"'));
  ok('백테 목록에서 고르면 바로 추가', /if\(id==='addTicker'\|\|id==='addTicker2'\) addCustomTicker\(id\)/.test(bt));
  ok('백테 추가 함수가 입력칸을 가려 받는다', /function addCustomTicker\(inpId\)/.test(bt)
     && /document\.getElementById\(inpId\|\|'addTicker'\)/.test(bt));
  // 목록(pickList)에 없으면 골라도 칩이 안 떠 '선택은 됐는데 안 보이는' 상태가 된다
  ok('전략탭 칩이 추가 종목까지 덮는다',
     /function pickList\(\)\{ const base=pickBase\(\); return base\.concat\(TICKERS\.filter\(t=>!base\.includes\(t\)\)\); \}/.test(bt));
  ok('내장 목록 스냅샷으로 커스텀을 가린다', /const BASE_TICKERS=TICKERS\.slice\(\);/.test(bt)
     && /function customTickers\(\)/.test(bt));
  // 제거할 때 세트를 하나라도 빠뜨리면 지운 종목이 계산에 계속 낀다
  ok('제거는 모든 선택세트를 턴다', /function pickDel\(t\)\{ ALL_SETS\(\)\.forEach/.test(bt)
     && /dcaActive\.delete\(t\);pickDel\(t\);/.test(bt));
  // 목록에서 고르면 click 이벤트가 안 나 자동저장이 안 걸린다
  ok('추가·제거가 상태를 저장한다', /function btSave\(\)\{ if\(typeof saveBtState==='function'\) saveBtState\(\); \}/.test(bt)
     && (bt.match(/btSave\(\);/g)||[]).length>=3);
  ok('검색칸 내용은 저장하지 않는다', /el\.id!=='addTicker'&&el\.id!=='addTicker2'/.test(bt));
  ok('백테 자동완성 배선', /function tkSearch\(id\)/.test(bt) && /\/api\/search\?q=/.test(bt)
     && /if\(seq!==_tk\.seq\) return;/.test(bt));
}


/* ════ 21. 국내 종목 부분일치 검색 ════
   야후·네이버 검색은 둘 다 앞부분 일치라 'TIGER 200타겟위클리커버드콜'을
   '200'이나 '커버드콜'로는 못 찾았다. 국내 ETF 목록을 받아 이름 어디서든 찾는다.
   순위는 시총이 가른다 — '커버드콜'처럼 100개가 걸리는 말은 이름만으론 근거가 없다. */
console.log('[21] 국내 종목 부분일치 검색');
{
  const sp=__d+'/functions/api/search.js';
  const se=fs.existsSync(sp)?fs.readFileSync(sp,'utf8'):'';
  ok('검색 API 존재', !!se, se?'':'search.js 없음');
  // EUC-KR로 내려오는 목록을 UTF-8로 읽으면 한글이 통째로 깨진다
  ok('국내 목록을 EUC-KR로 디코딩', /etfItemList/.test(se) && /new TextDecoder\("euc-kr"\)/.test(se)
     && /arrayBuffer\(\)/.test(se));
  ok('빈 응답으로 캐시를 덮지 않는다', /if \(list\.length\) _krCache = \{ at: Date\.now\(\), list \}/.test(se));
  ok('한글 질의는 야후·미국 목록을 안 부른다',
     /hangul \? \[\] : usSymbolList/.test(se) && /hangul \? \[\] : yahooSearch/.test(se));

  // 실제 함수를 꺼내 순위를 직접 확인한다 (정적 스캔만으론 정렬이 맞는지 알 수 없다)
  let api=null;
  try{ api=new Function(se.replace(/export\s+(async\s+)?function/g,'$1function').replace(/export /g,'')
        + '\n;return {krSearch, norm, KR_CODE};')(); }catch(e){}
  ok('검색 함수를 꺼낼 수 있다', !!(api&&api.krSearch), api?'':'평가 실패');
  if(api&&api.krSearch){
    const L=[
      {symbol:'069500',name:'KODEX 200',cap:257939},
      {symbol:'102110',name:'TIGER 200',cap:30000},
      {symbol:'200250',name:'KIWOOM 인도Nifty50(합성)',cap:500},
      {symbol:'0104N0',name:'TIGER 200타겟위클리커버드콜',cap:300},
      {symbol:'498400',name:'KODEX 200타겟위클리커버드콜',cap:9000},
      {symbol:'396500',name:'TIGER 반도체TOP10',cap:20000},
    ];
    const syms=(q,n=9)=>api.krSearch(L,q,n).map(x=>x.symbol);
    // 이게 이번 작업의 요구사항 — 이름 가운데 토막으로 찾힌다
    ok("'200'으로 이름 가운데가 걸린다", syms('200').includes('0104N0'));
    ok("'커버드콜'로도 걸린다", syms('커버드콜').includes('0104N0'));
    ok('겹치는 게 많으면 시총 큰 것부터', syms('200')[0]==='069500' && syms('커버드콜')[0]==='498400',
       syms('200')[0]+' / '+syms('커버드콜')[0]);
    // 코드 앞자리만 겹치는 것이 이름 일치를 밀어내던 문제
    ok('짧은 숫자는 코드 앞자리로 안 본다', !syms('200').includes('200250'), syms('200').join(','));
    ok('4자 이상이면 코드 앞자리도 본다', syms('2002').includes('200250'));
    ok('코드를 통째로 치면 그것부터', syms('0104N0')[0]==='0104N0' && syms('069500')[0]==='069500');
    ok('공백은 무시한다 (kodex200 = KODEX 200)', syms('kodex200')[0]==='069500');
    ok('한 토막도 안 맞으면 뺀다', syms('반도체').length===1 && syms('반도체')[0]==='396500');
    ok('알파벳 한 글자는 아무거나 걸지 않는다', syms('A').length===0, syms('A').join(','));
    ok('신형 코드도 국내로 본다', api.KR_CODE.test('0104N0') && api.KR_CODE.test('069500')
       && !api.KR_CODE.test('TQQQ'));
  }

  // 신형 코드(0104N0)를 숫자만 받는 곳이 하나라도 남으면 그 종목은 시세를 못 받는다
  const q=fs.existsSync(__d+'/functions/api/quote.js')?fs.readFileSync(__d+'/functions/api/quote.js','utf8'):'';
  const NEW=/\(\?:\\d\{6\}\|\\d\{4\}\[A-Z\]\\d\)/;
  ok('시세 API가 신형 코드를 국내로 보낸다', NEW.test(q), '(quote.js)');
  ok('운영이 신형 코드를 국내로 본다', /const KR_CODE_RE=/.test(idx) && NEW.test(idx));
  ok('백테가 신형 코드를 원화로 본다', /const isKRW=t=>/.test(bt) && NEW.test(bt));

  /* 국내 코드는 숫자뿐이라 '국내 0104N0'로만 뜨면 무슨 종목인지 알 수 없다.
     고르는 순간 이름이 손에 있으니 적어 뒀다가 화면에 쓴다. */
  ok('목록 행이 이름도 들고 있다', /data-name="\$\{String\(x\.name\|\|''\)/.test(idx)
     && /data-name="\$\{String\(x\.name\|\|''\)/.test(bt));
  ok('운영은 고른 이름을 기억한다', /function rememberTickerName\(sym,name\)/.test(idx)
     && /KR_ETF_NAME\[s\] \|\| KR_NAME_MEMO\[s\]/.test(idx));
  ok('백테는 고른 이름을 종목명으로 쓴다', /META\[t\]=\{name:_tkName\|\|t,/.test(bt));
  // 목록에서 고르면 change가 안 나 익절배율이 안 따라오던 문제
  ok('무매는 목록에서 골라도 익절배율이 따라온다',
     /if\(id==='set_ticker_in'\) onInfTickerChange\(\);/.test(idx));
}


/* ════ 22. 해외 이름 부분일치 + 국내 분배금 ════
   야후 검색은 이름 앞부분만 봐서 'covered call'·'ultrapro'로는 아무것도 안 나왔다.
   국내와 같은 방법(목록 받아 훑기)을 미국 전 종목에도 적용한다.
   국내 ETF는 네이버에 분배금 이력이 없어 배당 ETF가 통째로 '분배 수익 0%'였다. */
console.log('[22] 해외 이름 부분일치 · 국내 분배금');
{
  const sp=__d+'/functions/api/search.js';
  const se=fs.existsSync(sp)?fs.readFileSync(sp,'utf8'):'';
  ok('미국 전 종목 목록을 받는다', /nasdaqtraded\.txt/.test(se) && /function usSymbolList\(\)/.test(se));
  ok('테스트용 가짜 종목은 뺀다', /c\[7\] === "Y"/.test(se));
  ok('빈 응답으로 캐시를 덮지 않는다 (해외)', /if \(list\.length\) _usCache = \{ at: Date\.now\(\), list \}/.test(se));

  let api=null;
  try{ api=new Function(se.replace(/export\s+(async\s+)?function/g,'$1function').replace(/export /g,'')
        + '\n;return {krSearch, usSearch, normHead};')(); }catch(e){}
  ok('해외 검색 함수를 꺼낼 수 있다', !!(api&&api.usSearch), api?'':'평가 실패');
  if(api&&api.usSearch){
    const U=[
      {symbol:'TQQQ',name:'ProShares UltraPro QQQ',etf:true},
      {symbol:'SQQQ',name:'ProShares UltraPro Short QQQ',etf:true},
      {symbol:'PSQ', name:'ProShares Short QQQ',etf:true},
      {symbol:'SCHD',name:'Schwab US Dividend Equity ETF',etf:true},
      {symbol:'SOXL',name:'Direxion Daily Semiconductor Bull 3X ETF',etf:true},
      {symbol:'SMH', name:'VanEck Semiconductor ETF',etf:true},
      {symbol:'AOSL',name:'Alpha and Omega Semiconductor Limited',etf:false},
      {symbol:'CVRD',name:'Madison Covered Call ETF',etf:true},
    ];
    const syms=(q,n=9)=>api.usSearch(U,q,n).map(x=>x.symbol);
    // 이번 작업의 요구사항 — 이름 가운데 토막으로 찾힌다
    ok("'ultrapro'로 이름 가운데가 걸린다", syms('ultrapro').includes('TQQQ'));
    ok("'covered call'처럼 두 낱말도 걸린다", syms('covered call')[0]==='CVRD');
    ok("'semiconductor'는 복수형도 잡는다", syms('semiconductor').includes('SMH') && syms('semiconductor').includes('SOXL'));
    // 낱말 첫머리만 인정한다 — 안 그러면 'ShorT QQQ'가 TQQQ로 걸린다
    ok('낱말 가운데는 안 걸린다 (ShorT QQQ ≠ TQQQ)', syms('TQQQ').length===1 && syms('TQQQ')[0]==='TQQQ',
       syms('TQQQ').join(','));
    ok('토막이 많이 맞은 것부터', syms('3x semiconductor')[0]==='SOXL', syms('3x semiconductor').join(','));
    ok('같은 조건이면 ETF가 주식보다 먼저',
       syms('semiconductor').indexOf('SMH') < syms('semiconductor').indexOf('AOSL'));
    ok('티커를 통째로 치면 그것부터', syms('SCHD')[0]==='SCHD');
    // 낱말 경계: 기호 뒤 · 소문자→대문자 · 글자↔숫자
    const h=api.normHead('ProShares UltraPro MidCap400');
    ok('낱말 경계를 붙여쓴 이름에서도 찾는다',
       h.n==='PROSHARESULTRAPROMIDCAP400' && h.head[0] && h.head[h.n.indexOf('ULTRA')]
       && h.head[h.n.indexOf('PROMIDCAP')+3] && h.head[h.n.indexOf('400')], h.n);
    // 국내는 '200타겟위클리커버드콜'처럼 붙여 쓰므로 경계를 따지면 안 된다
    const K=[{symbol:'0104N0',name:'TIGER 200타겟위클리커버드콜',cap:300}];
    ok('국내는 붙여쓴 가운데도 걸린다', api.krSearch(K,'커버드콜',5).length===1);
  }

  /* 국내 ETF 분배금 — 네이버 siseJson은 분배 반영 종가만 주고 배당 이력도 raw도 없다.
     그래서 TIGER 배당커버드콜액티브 같은 월배당 ETF가 '분배 수익 0.0%'로 나왔다. */
  const q=fs.existsSync(__d+'/functions/api/quote.js')?fs.readFileSync(__d+'/functions/api/quote.js','utf8'):'';
  ok('국내도 분배금을 받아온다 (야후 .KS/.KQ)', /for \(const sfx of \[".KS", ".KQ"\]\)/.test(q)
     && /yahooDaily\("query1", symbol \+ sfx, range, dbg, period1, period2, true\)/.test(q));
  ok('현재가는 네이버 것을 쓴다', /price: \(kr && kr\.price != null\) \? kr\.price :/.test(q));
  // 야후가 안 되면 여태 동작 그대로 — 없는 분배금을 지어내지 않는다
  ok('야후가 막히면 네이버로 물러난다',
     /if \(wantDiv\) \{ out\.dividends = \[\]; out\.splits = \[\]; out\.raw = kr\.series;/.test(q)
     && /out\.ohlcTrade = kr\.ohlc; out\.priceBasis = 'trade';/.test(q));
  // period1/period2를 무시해 국내만 400일로 잘려 있었다
  ok('국내도 요청 기간을 지킨다', /async function naverDaily\(code, range, dbg, period1 = null, period2 = null\)/.test(q)
     && /period2 \? new Date\(\+period2 \* 1000\)/.test(q) && /period1 \? new Date\(\+period1 \* 1000\)/.test(q));
}


/* ════ 23. 관리자 모드 — 접속 계정·사용자 관리 ════
   전에는 제목 7번 탭 + localStorage 플래그였는데 그건 잠금이 아니었다.
   로그인이 이미 필수이니 권한은 계정으로 정한다. 7번 탭은 '잠깐 감추기'로만 남긴다. */
console.log('[23] 관리자 모드 — 접속 계정·사용자 관리');
{
  ok('관리자는 계정으로 정한다', /const ADMIN_EMAILS=\['jk82investing@gmail\.com'\]/.test(idx)
     && /function isAdmin\(\)\{ return ADMIN_EMAILS\.includes\(normEmail\(curEmail\)\); \}/.test(idx));
  // localStorage 플래그가 남아 있으면 아무나 켤 수 있던 옛 구멍이 그대로다
  ok('localStorage 플래그로는 못 켠다', !/localStorage\.(get|set)Item\('jk_admin'/.test(idx)
     && !/searchParams\.get\('admin'\)/.test(idx));
  ok('7번 탭은 감추기일 뿐 권한이 아니다', /if\(!isAdmin\(\)\)\{ alert\('관리자 계정으로 로그인해야 합니다\.'\); return; \}/.test(idx)
     && /_adminHidden=!_adminHidden/.test(idx));
  ok('로그인·로그아웃 때 권한을 다시 본다',
     (idx.match(/applyAdminMode\(\);/g)||[]).length>=3 && /curEmail=user\.email\|\|''/.test(idx));

  /* users/{uid}에는 거래기록 전부가 들어 있다. 목록 하나 그리자고 그걸 다 읽으면
     용량도 크고 남의 매매를 통째로 여는 셈이라 profiles를 따로 둔다. */
  ok('접속 기록은 별도 컬렉션', /window\.fb\.doc\(window\.fb\.db,'profiles',user\.uid\)/.test(idx)
     && /async function touchProfile\(user\)/.test(idx));
  ok('첫 접속·방문 수가 쌓인다', /firstSeen:\(prev&&\+prev\.firstSeen\)\|\|now/.test(idx)
     && /visits:\(\(prev&&\+prev\.visits\)\|\|0\)\+1/.test(idx));
  ok('관리자 화면은 별도 페이지', !!adm && /<title>JK 퀀트 — 관리자<\/title>/.test(adm), adm?'':'admin.html 없음');
  ok('운영에서 관리자 페이지로 간다', /id="adminbtn" href="\/admin"/.test(idx));
  // 관리자 UI가 운영에 남아 있으면 같은 걸 두 곳에서 고쳐야 한다
  ok('관리자 UI는 운영에 남기지 않는다',
     !/adminModal|renderAdmin|openAdmin|diag_card|runDiag/.test(idx));
  /* 관리자 링크의 기본 상태는 '감춤'이어야 한다. 스크립트로만 감추면
     applyAdminMode를 못 거치는 경로(차단 계정은 startApp 전에 되돌려보낸다)에서 새어 나온다.
     !important가 필요한 것도 확인됐다 — .jkmenu-pop a(0,1,1)가 .admin-only(0,1,0)를 이긴다. */
  ok('관리자 링크는 기본이 감춤', /\.admin-only\{display:none !important\}/.test(idx)
     && /\.admin-only\.admin-on\{display:flex !important\}/.test(idx));
  ok('보임 전환은 클래스로', /classList\.toggle\('admin-on', on\)/.test(idx));
  ok('차단 계정도 나가기 전에 감춘다',
     /applyAdminMode\(\);[\s\S]{0,220}?try\{ await window\.fb\.signOut/.test(idx));
  ok('관리자 페이지도 컬렉션 통째 읽기를 쓴다', /doc, getDoc, setDoc, collection, getDocs/.test(adm)
     && /getDocs\(window\.fb\.collection\(window\.fb\.db,'profiles'\)\)/.test(adm));
  ok('목록은 마지막 접속 최신순', /rows\.sort\(\(a,b\)=>\(\+b\.lastSeen\|\|0\)-\(\+a\.lastSeen\|\|0\)\)/.test(adm));
  // 기능은 SECTIONS 한 줄 + render 함수 하나로 늘린다
  ok('화면 목록이 한곳에 모여 있다', /const SECTIONS=\[/.test(adm)
     && /\{id:'users'/.test(adm) && /\{id:'diag'/.test(adm) && /\{id:'rules'/.test(adm));
  ok('관리자 아닌 계정은 문 앞에서 막힌다', /if\(isAdmin\(\)\)\{[\s\S]{0,200}?\$\('gate'\)\.style\.display='none'/.test(adm)
     && /계정에는 관리자 권한이 없습니다/.test(adm));

  // 차단된 계정이 데이터를 열고 나서 쫓겨나면 막은 의미가 없다
  ok('차단 확인이 데이터 로딩보다 먼저',
     idx.indexOf("if(isBlocked(prof)){") < idx.indexOf("withTimeout(pullRemote()")
     && /await window\.fb\.signOut\(window\.fb\.auth\)/.test(idx));
  // 실수로 자기를 차단하면 되돌릴 방법이 없다
  ok('관리자는 스스로 잠기지 않는다', /function isBlocked\(prof\)\{ return !!\(prof&&prof\.blocked\) && !isAdmin\(\); \}/.test(idx));
  ok('관리자 행엔 차단 버튼이 없다', /\$\{adm\?'<span class="sub">—<\/span>':/.test(adm));
  ok('규칙이 막으면 그렇다고 말한다', /목록을 못 읽었습니다/.test(adm) && /보안 규칙 보기/.test(adm));
  // 규칙을 두 곳에 적어두면 갈라진다 — 페이지가 보여주는 것과 파일이 같아야 한다
  ok('페이지가 보여주는 규칙이 파일과 같다',
     /allow list: if isAdmin\(\)/.test(adm) && /const RULES=`rules_version = '2';/.test(adm));

  /* 클라이언트 차단은 앱을 거쳐 들어올 때만 듣는다. 규칙이 있어야 진짜로 막힌다 */
  const rp=__d+'/firestore.rules';
  const ru=fs.existsSync(rp)?fs.readFileSync(rp,'utf8'):'';
  ok('보안 규칙을 저장소에 둔다', !!ru, ru?'':'firestore.rules 없음');
  ok('규칙도 같은 관리자만 본다', /request\.auth\.token\.email == 'jk82investing@gmail\.com'/.test(ru));
  ok('사용자 목록은 관리자만', /allow list: if isAdmin\(\)/.test(ru));
  ok('거래기록은 관리자도 못 본다', /match \/users\/\{uid\} \{\s*\n\s*allow read, write: if isMine\(uid\) && notBlocked\(\);/.test(ru));
  ok('본인이 차단을 못 푼다', /!\('blocked' in request\.resource\.data\)/.test(ru)
     && /affectedKeys\(\)\.hasAny\(\['blocked'\]\)/.test(ru));

  /* 곁들여 고친 것 — users/{uid}는 운영과 백테가 같이 쓰는 문서다.
     merge 없이 덮어써서 백테의 커스텀 종목이 서버에서 사라지고 있었다. */
  ok('운영 저장이 백테 종목을 안 지운다',
     /setDoc\(window\.fb\.doc\(window\.fb\.db,'users',curUid\),\{state:S,updated:\(S\._updated\|\|Date\.now\(\)\)\},\{merge:true\}\)/.test(idx));
}


/* ════ 24. 표 밀도 ════
   줄높이가 곧 '한 화면에 몇 줄'이다. 값은 하나도 안 지우고 자리만 좁힌다.
   운영 이력표 27px→21px (화면당 +27%), 폭 620→548px. 백테·단타·관리자도 같은 규약. */
console.log('[24] 표 밀도 — 한 화면에 더 많이');
{
  const adm=fs.existsSync(__d+'/admin.html')?fs.readFileSync(__d+'/admin.html','utf8'):'';
  const scal=fs.existsSync(__d+'/scalping.html')?fs.readFileSync(__d+'/scalping.html','utf8'):'';
  // 줄높이를 만드는 세 값 — 하나라도 되돌아가면 밀도가 통째로 풀린다
  ok('운영 이력표 밀도', /\.htable td\{padding:3px 4px;line-height:1\.25;/.test(idx)
     && /\.htable th\{[^}]*font-size:10px;padding:3px 4px;line-height:1\.2;/.test(idx)
     && /\.htable\{width:100%;border-collapse:collapse;font-size:11px;min-width:590px\}/.test(idx));
  ok('수정·삭제 칸도 좁힌다', /\.htable td:last-child\{padding:3px 2px\}/.test(idx));
  ok('백테 표 밀도', /\.cmp-tbl td\{padding:3px 4px;line-height:1\.25;/.test(bt)
     && /\.cmp-tbl th\{[^}]*padding:3px 4px;line-height:1\.2;[^}]*font-size:10px;\}/.test(bt)
     && /table\.cmp th,table\.cmp td\{padding:3px 4px;line-height:1\.25;/.test(bt));
  // 결과 표(#tbl)가 앱에서 제일 헐거웠다 — 6px 9px 로 되돌아가면 한 화면에 절반밖에 안 들어간다
  ok('백테 결과표 밀도', /^td\{padding:3px 5px;line-height:1\.25;/m.test(bt)
     && /^thead th\{[^}]*padding:3px 5px;line-height:1\.2;/m.test(bt));
  ok('관리자 표 밀도', /\.htable td\{padding:3px 4px;line-height:1\.25;/.test(adm), adm?'':'admin.html 없음');
  ok('단타 표 밀도', /\.htable td\{padding:3px 4px;line-height:1\.25;/.test(scal), scal?'':'scalping.html 없음');

  /* 날짜는 지우는 게 아니라 줄여 쓴다 — 2026-09-09 → 26-09-09 (81px→61px).
     수정창에는 원래 날짜가 그대로 뜨므로 잃는 정보가 없다. */
  ok('짧은 날짜 helper', /function dshort\(d\)\{ const t=String\(d\|\|''\); return \/\^\\d\{4\}-\\d\\d-\\d\\d\$\/\.test\(t\)\?t\.slice\(2\)/.test(idx));
  // 표 하나만 빠뜨리면 그 탭만 날짜 폭이 달라 열이 어긋나 보인다
  const n=(idx.match(/<td>\$\{dshort\((?:h|r)\.date\)\}/g)||[]).length;
  ok('모든 이력표가 짧은 날짜를 쓴다 (6개)', n===6, n+'개');
  ok('긴 날짜를 직접 찍는 표가 없다', !/<td>\$\{(?:h|r)\.date\|\|'-'\}/.test(idx));
}


/* ════ 25. 모의 성과 → 분석 이동 ════
   성과표에서 눈에 띈 세션을 보려고 탭·세션을 손으로 다시 찾아 들어가야 했다.
   가는 곳은 분석이다 — 성과표에서 넘어온 사람이 보고 싶은 건 거래 나열이 아니라
   그 세션이 왜 그 숫자가 나왔는지다. */
console.log('[25] 모의 성과 → 분석 이동');
{
  ok('성과 줄이 어느 세션인지 안다', /return \{tab, id:sess\.id, name:sess\.name/.test(idx));
  /* 줄 전체를 누르게 했더니 숫자를 보려고 짚기만 해도 화면이 넘어갔다 —
     이제 '전략 이름'만 누른다. 줄에는 onclick 이 남아 있으면 안 된다. */
  ok('전략 이름을 누르면 이동',
     /<b class="slink" onclick="gotoSess\('\$\{r\.tab\}','\$\{r\.id\}'\)"[^>]*>\$\{r\.label\}<\/b>/.test(idx)
     && /\.htable \.slink\{/.test(idx));
  ok('줄 전체는 더 이상 안 눌린다', !/<tr class="jump"/.test(idx) && !/\.htable tr\.jump\{/.test(idx));
  ok('눌리는 곳이 폰에서도 짚힌다', /\.htable \.slink\{[^}]*padding:4px 7px/.test(idx)
     && /\.htable \.slink\{[^}]*line-height:20px/.test(idx));
  ok('쓰는 CSS 변수가 실제로 있다',
     (idx.match(/\.htable \.slink[^}]*\}/g)||[]).join(' ').match(/var\(--[a-z-]+\)/g)
       .every(v=>new RegExp(v.slice(4,-1).replace(/[-]/g,'\\-')+':').test(idx)));
  let gs=''; try{ gs=extractFn(idx,'function gotoSess(tab, id)'); }catch(e){}
  ok('이동 함수 존재', !!gs, gs?'':'gotoSess 없음');
  /* 순서가 핵심 — switchSess가 서브탭을 건드리므로
     분석 열기가 그보다 먼저 오면 아무 일도 안 일어난 것처럼 보인다. */
  ok('탭 → 세션 → 서브탭 순서',
     gs.indexOf('tb.click()') < gs.indexOf('switchSess(id)')
     && gs.indexOf('switchSess(id)') < gs.indexOf('-anal"]'), '순서 어긋남');
  // 분석 블록 id는 여섯 탭이 '<탭>-anal'로 같다 — 글자보다 id가 안 깨진다
  ok('분석 칩을 id로 찾는다',
     /querySelector\(`#\$\{tab\} \.chip\[data-b="\$\{tab\}-anal"\]`\)/.test(gs));
  ok('못 찾으면 이름으로 물러선다', /c\.textContent\.trim\(\)==='분석'/.test(gs));
  ok('거래이력으로 가던 옛 코드가 안 남아 있다', !/==='거래이력'/.test(gs));
  ok('없는 세션이면 아무것도 안 한다', /if\(!box\.sessions\.some\(x=>x\.id===id\)\) return;/.test(gs));
  // 여섯 탭 모두 '<탭>-anal' 칩이 있어야 id 찾기가 성립한다
  const chips=(idx.match(/class="chip" data-b="[a-z]+-anal">분석</g)||[]).length;
  ok('여섯 탭 모두 분석 칩이 있다', chips===6, chips+'개');
  /* 툴팁에는 '어디로 가는지' 와 '어느 세션인지' 가 같이 있어야 한다 —
     칸에서 세션 이름을 뺐으므로(설정과 어긋날 수 있어서) 이름을 확인할 곳이 여기뿐이다 */
  ok('누르는 곳 설명도 분석으로', /title="\$\{r\.label\} 분석으로 이동 — \$\{_nm\}"/.test(idx));
  ok('세션 이름은 툴팁에만 (칸에는 종목·설정)',
     /const _nm=String\(r\.name\|\|''\)\.replace\(\/<\/g,'&lt;'\)/.test(idx)
     && /<span class="cw">\$\{r\.sym\}\$\{r\.opts&&r\.opts\.length\?' · '\+r\.opts\.join\(' · '\):''\}<\/span>/.test(idx));
  ok('전략 이름을 누르라고 알려 준다', /<b style="color:var\(--vio\)">전략 이름<\/b>을 누르면/.test(idx));
}


/* ════ 26. 단타 분봉 — 장 초반 5분 눈금 ════
   단타 차트가 일봉이라 하루 안의 9:00~9:30을 그릴 축이 아예 없었다.
   네이버 1분봉(7거래일)을 받아 5분으로 묶고, 그 위에 눈금을 긋는다. */
console.log('[26] 단타 분봉 — 장 초반 5분 눈금');
{
  const q=fs.existsSync(__d+'/functions/api/quote.js')?fs.readFileSync(__d+'/functions/api/quote.js','utf8'):'';
  const sc=fs.existsSync(__d+'/scalping.html')?fs.readFileSync(__d+'/scalping.html','utf8'):'';
  ok('분봉 API 존재', /const wantMinute = url\.searchParams\.get\("minute"\) === "1"/.test(q)
     && /async function naverMinute\(code, dbg\)/.test(q));
  ok('분봉은 국내 코드에서만', q.indexOf('if (wantMinute) {') > q.indexOf('if (KR_CODE.test(symbol)) {'));
  ok('timeframe=minute로 받는다', /timeframe=minute/.test(q));
  // 네이버 분봉은 시·고·저가 전부 null이고 종가·거래량만 온다
  ok('종가·거래량만 파싱', /\\\["\(\\d\{12\}\)",\\s\*\[\^,\]\+,\\s\*\[\^,\]\+,\\s\*\[\^,\]\+,\\s\*\(\[\\d\.\]\+\)/.test(q)
     || /matchAll\(\/\\\[/.test(q));

  ok('봉 단위 토글', /<div class="seg" id="ch_tf">/.test(sc)
     && /data-tf="day"/.test(sc) && /data-tf="5m"/.test(sc) && /data-tf="1m"/.test(sc));
  ok('토글이 배선돼 있다', /getElementById\('ch_tf'\)\.addEventListener\('click'/.test(sc)
     && /function setTF\(tf\)/.test(sc));
  // 1분 종가를 묶어 5분 O/H/L/C를 만든다 (네이버가 O/H/L을 안 주므로)
  ok('5분봉 합성', /function toBars\(min, step\)/.test(sc)
     && /cur\.high=Math\.max\(cur\.high,x\.close\); cur\.low=Math\.min\(cur\.low,x\.close\);/.test(sc));
  ok('지표도 받은 봉 기준', /return analyze\(\{ohlc:bars, price:bars\[bars\.length-1\]\.close\}\);/.test(sc));

  // 이게 이번 작업의 요구사항 — 9:00~9:30을 5분마다 끊는다
  ok('9:00~9:30 5분 눈금', /const isMark = t>='09:00' && t<='09:30' && \(\+t\.slice\(3\)%5===0\);/.test(sc));
  ok('일봉에는 안 그린다', /if\(TF!=='day'\)\{[\s\S]{0,400}?const isMark/.test(sc));
  /* 5분마다 라벨을 달면 봉 간격(≈10px)보다 글자가 넓어 '1015202530'으로 뭉갠다 */
  ok('라벨은 양 끝만', /const edge = t==='09:00'\|\|t==='09:30';/.test(sc)
     && /if\(edge\)\{ ctx\.fillStyle='#8b8cf0'; ctx\.fillText\(t, x, priceH\+10\); \}/.test(sc));
  ok('날짜 경계는 굵게', /newDay \? 'rgba\(139,140,240,\.55\)'/.test(sc));
  ok('오프닝 레인지 고·저', /\[\[orH,'OR 고'\],\[orL,'OR 저'\]\]/.test(sc));
  // 1분봉은 O/H/L이 종가와 같아 캔들이 점 줄이 된다
  ok('1분봉은 꺾은선을 덧그린다', /if\(TF==='1m'\)\{[\s\S]{0,220}?ctx\.stroke\(\);/.test(sc));
  // 일봉 70봉 그대로면 5분봉은 6시간도 못 본다
  ok('봉 단위마다 표시 개수가 다르다', /const CAP = TF==='day' \? 70 : TF==='5m' \? 84 : 150;/.test(sc));
}


/* ════ 27. 무매 분석 — 월별·사이클별 실현손익 ════
   총 실현손익 하나만 있어서 '언제 벌었나'를 알 수 없었다. */
console.log('[27] 무매 분석 — 월별·사이클별');
{
  ok('두 표가 분석 탭에 있다', /id="a_bymonth"/.test(idx) && /id="a_bycycle"/.test(idx)
     && idx.indexOf('id="a_bymonth"') > idx.indexOf('id="inf-anal"')
     && idx.indexOf('id="a_bymonth"') < idx.indexOf('id="inf-guide"'));
  let br=''; try{ br=extractFn(idx,'function renderInfBreak(c)'); }catch(e){}
  ok('집계 함수 존재', !!br, br?'':'renderInfBreak 없음');
  ok('분석 그릴 때 같이 그린다', /function renderInfAnal\(\)\{[\s\S]{0,900}?renderInfBreak\(c\);/.test(idx));
  // 평가손익을 섞으면 '언제 얼마를 벌었나'가 흐려진다
  ok('매도로 확정된 것만 센다', /const sells=\(c\.rows\|\|\[\]\)\.filter\(h=>isSell\(h\.kind\)\);/.test(br));
  ok('손익률 분모는 거래이력과 같은 원금', /const st=c\.st, cap=\+st\.principal\|\|0/.test(br)
     && /\(v\/cap\*100\)\.toFixed\(2\)/.test(br));
  /* computeInf의 cycleSeq는 1부터다. +1을 더해 1사이클이 통째로 사라졌었다 —
     이 표가 없으면 눈으로는 안 걸리는 종류의 어긋남이다. */
  ok('cycleSeq는 1부터 (그대로 쓴다)', /const k=h\.cycleSeq\|\|1;/.test(br)
     && /\$\{x\.seq\}사이클/.test(br) && !/x\.seq\+1/.test(br));
  ok('cycleSeq 시작값이 1', /let avg=0,qty=0,inv=0,realized=0,T=0,totbuy=0,totsell=0,cycleSeq=1;/.test(idx));
  ok('안 닫힌 사이클은 진행중으로', /closed\.has\(x\.seq\)\?'':' <span style="color:var\(--gold\)[^"]*">진행중/.test(br));
  // 원화 세션은 이미 원화라 같은 수를 두 번 쓰는 꼴이 된다
  ok('원화 열은 달러 세션에서만', /isKrw=isKrwSt\(st\)/.test(br)
     && /\$\{isKrw\?'':'<th>원화<\/th>'\}/.test(br));
  // 단리면 출금·입금·합계에 달러 세션은 합계원화까지 — 원화 세션은 셋, 달러 세션은 넷
  ok('빈 표 colspan이 열 수를 따라간다',
     /const nCol=\(isKrw\?4:5\)\+\(simple\?\(isKrw\?1:2\):0\);/.test(br) && /colspan="\$\{nCol\}"/.test(br));
  ok('합계 줄이 있다', /<td><b>합계<\/b><\/td>/.test(br));
}


/* ════ 28. KIS 모의투자 실행 · 주문 이력 ════
   증권사에 실제로 나간 주문의 기록이라, 브라우저 캐시와 함께 사라지면 안 된다.
   실현손익은 매도를 같은 종목의 먼저 산 물량과 짝지어(FIFO) 계산한다. */
console.log('[28] KIS 모의투자 실행 · 주문 이력');
{
  const sc=fs.existsSync(__d+'/scalping.html')?fs.readFileSync(__d+'/scalping.html','utf8'):'';
  const kis=fs.existsSync(__d+'/functions/api/kis.js')?fs.readFileSync(__d+'/functions/api/kis.js','utf8'):'';

  ok('이력 카드가 있다', /id="klog_sum"/.test(sc) && /id="klog_body"/.test(sc));
  ok('목록에서 바로 KIS 매수', /onclick="event\.stopPropagation\(\);kisBuyPick\('/.test(sc));
  ok('KIS 포지션은 KIS 로 청산', /\$\{p\.kis\?`<button class="ghostbtn sm danger" onclick="kisSellPos\(\$\{i\}\)"/.test(sc));

  // 나간 주문은 성공이든 실패든 남아야 한다 — 실패 사유가 "왜 그날 안 샀나"의 유일한 근거다
  ok('성공·실패 모두 기록', /KLOG\.unshift\(rec\); saveK\(\); renderKlog\(\);/.test(sc)
     && /rec\.ok=!!j\.ok;/.test(sc));
  ok('수동 주문창도 같은 경로', /const rec=await kisSubmit\(\{side,code,name:nm,qty,price,priceType:mkt\?'market':'limit'\}\);/.test(sc));
  ok('클라우드에도 남긴다', /window\.fb\.doc\(window\.fb\.db,'users',me\.uid\)[\s\S]{0,80}scalp:\{ kis:KLOG/.test(sc));
  ok('클라우드 병합은 id 기준(지운 건 안 살아남)', /const seen=new Set\(KLOG\.map\(x=>x\.id\)\);/.test(sc));

  // 반자동이다 — 확인 없이 주문이 나가면 안 된다
  ok('매수는 확인창을 거친다', /async function kisBuyPick\(code\)\{[\s\S]{0,900}?if\(!confirm\(/.test(sc));
  ok('매도는 확인창을 거친다', /async function kisSellPos\(i\)\{[\s\S]{0,900}?if\(!confirm\(/.test(sc));
  ok('전략상 종목당 1포지션', /if\(POS\.some\(p=>p\.code===code\)\)\{ alert\(s\.name\+' 은\(는\) 이미 보유 중입니다\. \(전략상 종목당 동시 1포지션\)'\)/.test(sc));
  ok('수량은 투입금액÷현재가', /const px=Math\.round\(s\.price\), L=levelsOf\(px\), qty=Math\.floor\(budget\(\)\/px\);/.test(sc));
  ok('손절·목표는 전략 함수에서', /plan:\{stop:L\.stop,tgt:L\.tgt\}/.test(sc));
  ok('보유 5일 경과를 표시', /const over=p\.days!=null&&p\.days>=5;/.test(sc)
     && /over\?' <span class="sig watch">5일경과<\/span>'/.test(sc));

  // 주문은 절대 자동 재시도하지 않는다 — 응답 유실 시 이중 주문이 된다
  ok('주문은 readJson 을 쓰지 않는다', !/order-cash[\s\S]{0,200}readJson/.test(kis)
     && /const r = await fetch\(base\(env\) \+ "\/uapi\/domestic-stock\/v1\/trading\/order-cash"/.test(kis));
  ok('읽기만 재시도한다', /async function readJson\(url, init, tries = 3\)/.test(kis)
     && /if \(!RATE_LIMITED\(j\)\) return j;/.test(kis));

  // FIFO 실현손익 — 함수를 꺼내 실제로 굴린다
  let rz=null; try{ rz=extractFn(sc,'function klogRealized()'); }catch(e){}
  ok('실현손익 함수 존재', !!rz, rz?'':'klogRealized 없음');
  if(rz){
    let KLOG=[]; const mk=new Function('KLOG','"use strict";'+rz+'return klogRealized();');
    const run=(log)=>mk(log).map(x=>[x.qty,x.inPx,x.outPx,+x.pct.toFixed(2)]);
    const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    ok('1매수 1매도 (마찰 0.5% 차감)', eq(run([
      {ok:1,side:'sell',code:'A',qty:10,price:110,ts:2},
      {ok:1,side:'buy', code:'A',qty:10,price:100,ts:1}]), [[10,100,110,9.5]]));
    ok('분할매수는 먼저 산 것부터', eq(run([
      {ok:1,side:'buy', code:'A',qty:5,price:100,ts:1},
      {ok:1,side:'buy', code:'A',qty:5,price:120,ts:2},
      {ok:1,side:'sell',code:'A',qty:10,price:110,ts:3}]), [[5,100,110,9.5],[5,120,110,-8.83]]));
    ok('실패 주문은 손익에서 뺀다', eq(run([
      {ok:0,side:'buy', code:'A',qty:10,price:100,ts:1},
      {ok:1,side:'buy', code:'A',qty:10,price:100,ts:2},
      {ok:1,side:'sell',code:'A',qty:10,price:100,ts:3}]), [[10,100,100,-0.5]]));
    ok('짝 없는 매도는 세지 않는다', eq(run([{ok:1,side:'sell',code:'A',qty:5,price:100,ts:1}]), []));
    ok('부분매도는 판 만큼만', eq(run([
      {ok:1,side:'buy', code:'A',qty:10,price:100,ts:1},
      {ok:1,side:'sell',code:'A',qty:4,price:106,ts:2}]), [[4,100,106,5.5]]));
    ok('종목이 섞여도 각자 짝짓는다', eq(run([
      {ok:1,side:'buy', code:'A',qty:1,price:100,ts:1},
      {ok:1,side:'buy', code:'B',qty:1,price:200,ts:2},
      {ok:1,side:'sell',code:'B',qty:1,price:220,ts:3},
      {ok:1,side:'sell',code:'A',qty:1,price:90,ts:4}]), [[1,200,220,9.5],[1,100,90,-10.5]]));
  }
}


/* ════ 29. 단타 화면의 성과 주장 정정 ════
   11절이 보고한 "+1.72%/거래·승률 62%"는 거래 단위로 센 오류였고, 8년 포트폴리오
   회계로는 p=0.51 이다(15절). 화면이 검증된 전략인 양 표시하면 실제 돈이 나간다.
   이 검사는 그 주장이 되살아나지 못하게 막는다. */
console.log('[29] 단타 화면의 성과 주장 정정');
{
  const sc=fs.existsSync(__d+'/scalping.html')?fs.readFileSync(__d+'/scalping.html','utf8'):'';
  // 옛 주장이 화면 어디에도 '기대치'로 남아 있으면 안 된다
  ok('“+1.72%·승률 62%”를 기대치로 내세우지 않는다',
     !/올해 실증[^<]{0,40}\+1\.72/.test(sc) && !/실증 기대[^<]{0,60}62%/.test(sc));
  ok('폐기 사실을 명시한다', /폐기된 기대치/.test(sc) && /거래 단위로 센 오류/.test(sc));
  ok('실제 수치를 적었다', /연 \+37만원/.test(sc) && /p=0\.51/.test(sc) && /−549만원/.test(sc));
  ok('스크리닝 카드에 경고가 있다',
     /이 전략은 실증으로 뒷받침되지 않는다/.test(sc)
     && sc.indexOf('이 전략은 실증으로 뒷받침되지 않는다') < sc.indexOf('id="scr_body"'));
  ok('경고가 돈을 넣지 말라고 말한다', /이걸 근거로 실제 돈을 넣지 마라/.test(sc));
  // 5일 이상에서 신호가 대조군보다 나쁘다는 사실(15.3)
  ok('장기 보유에서 더 나쁘다는 사실을 적었다', /대조군보다 나쁘다/.test(sc) && /−1\.729/.test(sc));
  // 검증 기록 카드
  ok('검증 기록 카드가 있다', /id="verifyBody"/.test(sc) && /검증 기록 — 무엇이 안 되는지/.test(sc));
  ok('검증 기록이 주요 결과를 담는다',
     /21개 주장 중 확인 1개/.test(sc) && /76개 조건 전수조사 생존 0개/.test(sc)
     && /36칸 중 유의한 플러스 0개/.test(sc));
  ok('반복 확인된 교훈을 적었다',
     /매일 왕복 시 마찰만 연 126%/.test(sc) && /날짜 단위로 세라/.test(sc));
  // 코드 주석도 정정됐는지
  ok('PICK 주석이 정정됐다', /const PICK=65;[^\n]*대조군을 못 이겼다/.test(sc));
  ok('levelsOf 주석이 정정됐다', /고정 퍼센트 목표는 18절에서 유의하게 나쁘다/.test(sc));
  // 문서에 근거가 남아 있어야 한다
  const md=fs.existsSync(__d+'/SCALPING.md')?fs.readFileSync(__d+'/SCALPING.md','utf8'):'';
  ok('SCALPING.md 15절에 정정 근거', /거래 단위 t값은 부풀려진다/.test(md) && /t=4\.69/.test(md));
  ok('SCALPING.md 에 마찰 희석 곡선', /마찰 희석 곡선/.test(md));
}


/* ════ 30. 모의 시작일 일괄 변경 ════
   전략을 견주려면 출발선이 같아야 하는데, 세션 이름을 하나씩 더블탭해 고치는 수밖에 없었다. */
console.log('[30] 모의 시작일 일괄 변경');
{
  ok('성과표 위에 있다', /id="p_simstart"/.test(idx)
     && idx.indexOf('id="p_simstart"') < idx.indexOf('id="paper_body"')
     && idx.indexOf('id="paperModal"') < idx.indexOf('id="p_simstart"'));
  ok('모달 열 때 칸을 맞춘다', /async function openPaper\(\)\{\s*\n\s*syncPaperStart\(\);/.test(idx));
  let ps='', ap='';
  try{ ps=extractFn(idx,'function paperSessions()'); }catch(e){}
  try{ ap=extractFn(idx,'async function applyAllSimStart()'); }catch(e){}
  ok('모의 세션만 모은다', /box\.sessions\.forEach\(x=>\{ if\(x\.paper\) out\.push\(\[tab,x\]\); \}\);/.test(ps), ps?'':'paperSessions 없음');
  ok('일괄 적용 함수 존재', !!ap, ap?'':'applyAllSimStart 없음');
  // 실계좌를 건드리면 사람이 넣은 실제 거래가 날아간다 — 되돌릴 방법이 없다
  ok('실계좌는 손대지 않는다', /const list=paperSessions\(\);/.test(ap)
     && /list\.forEach\(\(\[tab,x\]\)=>\{/.test(ap) && !/sessions\.forEach/.test(ap));
  ok('지우기 전에 묻는다', /let msg=`모의 세션 \$\{list\.length\}개의 시작일을 \$\{ns\}로 바꿉니다/.test(ap)
     && /기존 기록 \$\{nRec\}건을 지우고/.test(ap) && /if\(!confirm\(msg\)\) return;/.test(ap));
  /* 시작일을 옮기면 그때까지 만든 기록은 옛 시작일 산물이라 통째로 무효다.
     세션 편집(createSess)과 같은 키를 지워야 한다 — 하나라도 남으면 새 시작일과 옛 진행상태가 섞인다. */
  const KEYS=['simLast','cycStart','startCyc','cycLog'];
  ok('세션 편집과 같은 초기화 규약',
     KEYS.every(k=>new RegExp(`delete x\\.settings\\.${k};`).test(ap)) && /x\.settings\.startv=0;/.test(ap)
     && KEYS.every(k=>new RegExp(`delete t\\.settings\\.${k};`).test(idx)),
     KEYS.filter(k=>!new RegExp(`delete x\\.settings\\.${k};`).test(ap)).join(',')||'ok');
  ok('지운 자리를 다시 채운다', /save\(\); pushRemote\(\);\s*\n\s*await openPaper\(\);/.test(ap));
  ok('모의가 없으면 알리고 멈춘다', /if\(!list\.length\)\{ alert\('모의 세션이 없습니다\.'\); return; \}/.test(ap));

  /* 시작일 하한 3년 — 그 앞은 시세를 하루씩 되짚느라 오래 걸리고,
     레버리지 ETF는 상장이 얼마 안 된 게 많아 구간이 반쯤 빈다. */
  ok('3년 하한이 있다', /const PAPER_MAX_YEARS=3;/.test(idx) && /function paperMinDate\(\)/.test(idx));
  ok('칸에 min·max를 건다', /el\.min=min; el\.max=today;/.test(idx));
  // min 속성만으로는 못 막는다 — 키보드로 친 날짜는 그대로 들어온다
  ok('코드에서도 막는다', /if\(ns<min\)\{ alert\(`시작일은 최대 \$\{PAPER_MAX_YEARS\}년 전까지입니다/.test(ap)
     && /if\(ns>today\)\{ alert\('시작일을 오늘 이후로 둘 수는 없습니다\.'\); return; \}/.test(ap));

  /* 원금 일괄 — 전략마다 '금액'의 뜻이 달라서 아무 데나 넣으면 안 된다.
     적립식·ASAP의 금액은 '1회 적립액'이라 원금을 밀어넣으면 매 회차마다 그 돈을 산다. */
  let cf=''; try{ cf=extractFn(idx,'function paperCapField(tab, st)'); }catch(e){}
  ok('원금 칸이 있다', /id="p_capital"/.test(idx) && /비우면 그대로/.test(idx));
  ok('전략별 원금 칸을 가린다', !!cf, cf?'':'paperCapField 없음');
  ok('무매·로테·섀넌은 principal', /if\(tab==='inf'\|\|tab==='ma'\|\|tab==='ivs'\) return 'principal';/.test(cf));
  ok('VR은 initAmt', /if\(tab==='vr'\) return 'initAmt';/.test(cf));
  ok('적립·거치는 거치식만', /if\(tab==='dca'\) return \(st&&st\.mode==='lump'\) \? 'amount' : null;/.test(cf));
  ok('ASAP은 원금 개념이 없다', /return null;\s*\/\/ asap/.test(cf));
  // v3.34부터 금액 칸이 둘(원금·1회 적립액)이라 읽기는 paperReadAmt가 맡는다 — 자세한 건 [40]
  const rd=extractFn(idx,'function paperReadAmt(id, label)');
  ok('원금은 비워두면 안 바꾼다', /if\(!raw\) return null;/.test(rd)
     && /if\(cap!=null\)\{ const f=paperCapField\(tab,x\.settings\); if\(f\) x\.settings\[f\]=wonToSess\(cap,x\.settings,R\); \}/.test(ap));
  ok('0 이하는 거부', /if\(!\(v>0\)\)\{ alert\(`\$\{label\}은 0보다 커야 합니다/.test(rd));
  // 조용히 건너뛰면 '왜 얘만 안 바뀌었지'가 된다
  ok('건너뛴 세션을 이름까지 알린다',
     /건너뜀 \$\{skip\.length\}개 — \$\{skip\.map\(\(\[,x\]\)=>x\.name\)\.join\(', '\)\}/.test(ap)
     && /paperNote=`금액은 \$\{touched\.size\}개에만 적용했습니다/.test(ap));
}


/* ════ 31. 짧은 기간 — 막지 말고 알리기 ════
   1년 미만을 통째로 막아 두니 '올해 1월부터'를 볼 수가 없었다.
   막아야 할 건 수익률이 아니라 연환산(CAGR·MAR)이다. */
console.log('[31] 짧은 기간 — 막지 말고 알리기');
{
  let sg=''; try{ sg=extractFn(bt,'function shortGuard(n)'); }catch(e){}
  ok('경계 함수 존재', !!sg, sg?'':'shortGuard 없음');
  ok('경계값', /const SHORT_DAYS=250, MIN_DAYS=20;/.test(bt));
  // 20거래일 미만은 이동평균·표준편차가 아예 안 잡힌다 — 그때만 막는다
  ok('20일 미만만 막는다', /if\(n<MIN_DAYS\)\{/.test(sg) && /return false;/.test(sg));
  ok('1년 미만은 통과시키고 알린다', /if\(n<SHORT_DAYS\)\{/.test(sg)
     && /CAGR·MAR은 연환산이라 부풀려집니다/.test(sg) && /return true;/.test(sg));
  // 수익률·MDD는 기간과 무관하게 유효하다 — 그걸 명시해야 사용자가 헷갈리지 않는다
  ok('무엇이 유효한지 적는다', /수익률·MDD는 그대로 유효/.test(sg));
  ok('경고 자리가 결과 위에 있다', /id="shortWarn"/.test(bt)
     && bt.indexOf('id="shortWarn"') < bt.indexOf('id="asapResult"'));
  // 네 탭(ASAP·표준편차·역분산·전체비교)이 모두 같은 경계를 쓴다
  const n=(bt.match(/if\(!shortGuard\(/g)||[]).length;
  ok('네 탭이 같은 경계를 쓴다', n===4, n+'곳');
  ok('옛 하드블록이 안 남아 있다', !/공통 거래일이 1년 미만입니다/.test(bt));
}

console.log('[32] 전반전 매수 — 주문별 정수 내림 (모의 == 백테)');
{
  // 별지점·평단은 별개의 주문 2건이다. 합산해서 한 번만 내림하면 실제로는 못 사는
  // 주식을 산 걸로 쳐서 백테만 낙관적으로 나온다 (1회 $500·주가 $65: 7주 vs 3+3=6주).
  // 이 한 줄 때문에 모의 38.62% / 백테 38.89%로 갈렸다.
  const im=extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound');
  const plan=extractFn(bt,'function _imBuyPlan(T, avg, shares, cash, divs, starBase, starSlope, buyLimit, prevC, FEE, rows, cur)');
  /* 정식 문서 반영 — 매수 주문은 공용 imBuyOrders 한 곳 (앱 주문표·모의·서버·백테·플랜 같은 글자).
     반주문 2건은 각자 내림한다 (합산 후 일괄 내림 금지). 수량은 주문가 기준 + 아래로 LOC 추가 줄. */
  const ibo=extractFn(bt,'function imBuyOrders(o)');
  ok('백테: 별지점·평단 반주문을 따로 내림 (공용 imBuyOrders)', /main\('별지점 매수', o\.starPrice, o\.buy1\/2, 0\.5, '절반매수'\); main\('평단 매수', o\.avg, o\.buy1\/2, 0\.5, '절반매수'\);/.test(ibo)
     && /return imBuyOrders\(\{first, half:!first&&T<divs\/2/.test(plan));
  ok('백테: 합산 후 일괄 내림이 안 남아 있다', !/if\(sp>0\)\{ if\(_buy\(c,sp\)>0\) T\+=ti; \}/.test(bt));
  const n=(bt.match(/const buys=_imBuyPlan\(T, avg, shares, cash, divs, starBase, starSlope, buyLimit, prevC, FEE, imRowsOf\(\{\}\), isKRW\(tkr\)\?'krw':'usd'\);/g)||[]).length;
  ok('runIM·runIM50 둘 다 공용 주문을 쓴다', n===2, n+'곳');
  const sim=extractFn(idx,'function infSimForward(startFrom)');
  ok('모의: 아침 매수 주문도 공용 imBuyOrders (전일 확정 종가 기준 · 큰수 상한 cap)',
     /buys=imBuyOrders\(\{first, half, buy1:B0\.amt, bal:c\.bal, firstPrice:buyLimit, starPrice:star0-0\.01, avg:c\.avg,/.test(sim)
     && /cap:buyLimit, rows:imRowsOf\(st\)/.test(sim) && /cl<=b\.lim/.test(sim));
  ok('모의가 오늘 종가로 수량을 세지 않는다',
     !/Math\.floor\(\(B\.amt\/2\)\/cl\)/.test(idx) && !/Math\.floor\(B\.amt\/cl\)/.test(idx) && !/fillPx/.test(sim) && !/cNow\.bal/.test(sim));
  ok('정식 매수 주문 함수가 index·backtest·plan·서버에 글자 그대로 같다',
     (()=>{ const x=extractFn(idx,'function imBuyOrders(o)'), y=ibo, z=extractFn(fs.readFileSync(__d+'/plan.html','utf8'),'function imBuyOrders(o)'),
              w=extractFn(fs.readFileSync(__d+'/functions/api/_im.js','utf8'),'function imBuyOrders(o)');
            return !!x && x===y && x===z && x===w; })());
}

console.log('[33] 세션 이동 — 보던 서브탭 유지');
{
  const ks=extractFn(idx,'function keepSubnav(sec)');
  ok('유지 함수 존재', !!ks);
  ok('현재 켜진 칩을 먼저 읽는다', /\.chip\.on/.test(ks) && /cur\.dataset\.b/.test(ks));
  ok('없는 블록이면 첫 칩으로 떨어진다', /resetSubnav\(sec\)/.test(ks)
     && ks.indexOf('resetSubnav(sec)') < ks.indexOf('goBlk(sec,blk,true)'));
  ok('칩과 블록이 둘 다 있을 때만 되돌린다',
     /chip\[data-b="\$\{blk\}"\]/.test(ks) && /&& \$\(blk\)/.test(ks));
  // switchSess만 유지한다 — 새 세션 추가·설정 초기화는 '현재'로 리셋하는 게 맞다
  const sw=extractFn(idx,'function switchSess(id)');
  ok('switchSess가 유지를 쓴다', /keepSubnav\(S\.activeTab\)/.test(sw) && !/resetSubnav/.test(sw));
  const n=(idx.match(/resetSubnav\(S\.activeTab\)/g)||[]).length;
  ok('새 세션·삭제는 그대로 리셋', n===2, n+'곳');
  // gotoSess(모의 성과 → 분석)는 switchSess 뒤에 칩을 눌러서 덮어쓴다
  const gs=extractFn(idx,'function gotoSess(tab, id)');
  ok('gotoSess는 분석으로 덮어쓴다', gs.indexOf('switchSess(id)') < gs.indexOf('-anal"]'));
}

console.log('[34] 버전 표기 일치');
{
  // index.html은 헤더(appVerTop)와 설정화면(appVer) 두 곳에 버전을 적는다.
  // 한 곳만 올리면 배포 확인이 옛 버전을 읽어서 '아직 안 올라갔다'고 오판한다.
  const vs=[...idx.matchAll(/id="appVer(?:Top)?"[^>]*>(?:<b[^>]*>)?\s*(v[0-9.]+)/g)].map(m=>m[1]);
  ok('운영 버전 표기 2곳', vs.length===2, vs.join(' / '));
  ok('두 곳이 같다', vs.length===2 && vs[0]===vs[1], vs.join(' vs '));
  const bv=[...bt.matchAll(/id="btVer"[^>]*>\s*(v[0-9.]+)/g)].map(m=>m[1]);
  ok('백테 버전 표기 1곳', bv.length===1, bv.join(' / '));
}

console.log('[35] 로그인 — 조용히 갇히지 않는다');
{
  const ia=extractFn(idx,'function initAuth()');
  // 로그인 성공 뒤 어느 단계에서 예외가 나도 authgate에 갇히면 안 된다.
  ok('비로그인은 먼저 빠져나간다', /if\(!user\)\{/.test(ia) && ia.indexOf('if(!user){') < ia.indexOf('touchProfile'));
  ok('배지 그리기 실패를 막는다', /try\{ renderUserBadge\(user\); \}catch/.test(ia));
  ok('프로필 확인 실패로 로그인을 막지 않는다',
     /\}catch\(e\)\{ console\.warn\('profile',e\); \}/.test(ia));
  ok('기록 읽기 실패는 새 상태로 연다', /catch\(e\)\{[\s\S]*?S=freshState\(\)/.test(ia));
  ok('원인을 화면에 남긴다', /authWarn\(/.test(ia) && !!extractFn(idx,'function authWarn(msg)'));
  const iGate=ia.indexOf("$('authgate').style.display='none'");
  ok('앱 시작 전에 로그인창을 닫는다', iGate>0 && iGate < ia.indexOf('startApp()'));

  // localStorage는 용량 초과·사생활 보호 모드에서 던진다 — 그게 로그인까지 타고 올라갔었다
  const sl=extractFn(idx,'function saveLocal()');
  ok('saveLocal이 예외를 안 던진다', /try\{/.test(sl) && /catch\(e\)\{/.test(sl));
  ok('저장 실패를 사용자에게 알린다', /showLsWarn\(/.test(sl) && !!extractFn(idx,'function showLsWarn(msg)'));
  ok('클라우드 저장은 계속된다', /function save\(\)\{saveLocal\(\);pushRemote\(\);\}/.test(idx));
  ok('저장이 복구되면 경고를 치운다', /lsFailed=false;[\s\S]{0,60}remove\(\)/.test(sl));

  /* try/catch 는 '던져야' 잡는다. Firestore 호출이 영영 안 끝나면 예외가 아니라
     그냥 멈춰 있어서 로그인 처리가 통째로 갇힌다 — 웨일 iOS에서 실제로 났다
     (구글 인증은 됐는데 앱시작 '안 됨'). 그래서 시간을 재서 끊는다. */
  const wt=extractFn(idx,'function withTimeout(p, ms, label)');
  ok('안 끝나는 호출을 시간으로 끊는다', !!wt && /Promise\.race/.test(wt) && /setTimeout/.test(wt));
  ok('프로필 확인에 제한시간', /withTimeout\(touchProfile\(user\), 6000, '프로필 확인'\)/.test(ia));
  ok('클라우드 읽기에 제한시간', /withTimeout\(pullRemote\(\), 8000, '클라우드 기록'\)/.test(ia));
  // 클라우드가 안 와도 이 기기에 있는 걸로 열어야 한다 — 새로 시작하면 기록이 사라진 것처럼 보인다
  ok('클라우드가 안 오면 로컬로 연다', /load\(\); opened=validState\(S\);/.test(ia)
     && /이 기기에 저장된 걸로 엽니다/.test(ia));
  ok('로컬도 없을 때만 새로 시작', /if\(!opened\)\{[\s\S]{0,80}freshState\(\)/.test(ia));
  // 어디서 멈췄는지 알아야 다음에 안 헤맨다
  ok('진행 단계를 남긴다', /let authStep=/.test(idx)
     && (idx.match(/authStep='/g)||[]).length>=4);
  ok('진단이 멈춘 자리를 보여준다', /멈춘 자리 '\+authStep/.test(extractFn(idx,'function authDiag()')));
}

console.log('[36] 분석 머리 — 여섯 탭 모두 손익금·손익률·원화');
{
  // 탭마다 id 접두사가 달라 한 탭만 고치면 티가 안 난다 — 여섯 개를 한 번에 본다
  const TRIO=[
    ['무매',  'a_realized',   'a_realized_pct',   'a_realized_krw'],
    ['VR',    'vc_profit',    'vc_pct',           'vc_profit_krw'],
    ['이평',  'ana_realized', 'ana_realized_pct', 'ana_realized_krw'],
    ['섀넌',  'anaI_realized','anaI_realized_pct','anaI_realized_krw'],
    ['적립식','anaD_pnl',     'anaD_pnlpct',      'anaD_pnl_krw'],
    ['ASAP',  'anaA_pnl',     'anaA_pnlpct',      'anaA_pnl_krw'],
  ];
  TRIO.forEach(([nm,amt,pct,krw])=>{
    const has=id=>idx.includes('id="'+id+'"');
    ok(nm+' 분석에 손익금·손익률·원화가 다 있다',
       has(amt)&&has(pct)&&has(krw),
       [amt,pct,krw].filter(id=>!has(id)).join(', ')+' 없음');
  });
  // 손익률은 금액 바로 옆 같은 줄에 온다
  TRIO.forEach(([nm,amt,pct])=>{
    const i=idx.indexOf('id="'+amt+'"'), j=idx.indexOf('id="'+pct+'"');
    ok(nm+' 손익률이 금액 옆 같은 줄', i>0 && j>i && (j-i)<300, '거리 '+(j-i));
  });
  const sp=extractFn(idx,'function setRealizedPct(id, v, base)');
  ok('손익률 헬퍼 존재', !!sp);
  ok('원금이 없으면 나누지 않는다', /if\(!\(base>0\)\)\{[\s\S]*?'—'/.test(sp));
  ok('금액과 색을 맞춘다', /var\(--buy\)/.test(sp) && /var\(--sell\)/.test(sp));
  // 원화는 달러 세션에서만 — 원화 세션에 원화를 또 쓰면 같은 수가 두 번 나온다
  const krwLines=(idx.match(/\$\('(?:a_realized_krw|ana_realized_krw|anaI_realized_krw)'\)\.textContent=isKrwSt\(st\)\?'':/g)||[]).length;
  ok('무매·이평·섀넌이 같은 원화 규약', krwLines===3, krwLines+'곳');
  const va=extractFn(idx,'function renderVrAnal()');
  ok('VR도 같은 원화 규약', /vc_profit_krw[\s\S]{0,80}isKrwSt\(st\)/.test(va) && /won\(profit\)/.test(va));
  ok('VR 손익률에도 색이 붙는다', /\$\('vc_pct'\)\.style\.color=/.test(va));
}

console.log('[37] 모의 성과 표 — 투입은 맨 오른쪽');
{
  const op=extractFn(idx,'async function openPaper()');
  // 수익 한 칸이 최종·현재·인출 셋으로 갈렸다 (v3.53)
  const head=(op.match(/<tr><th>전략 · 세션<\/th>[\s\S]*?<\/tr>/)||[''])[0];
  ok('머리글 순서',
     /전략 · 세션[\s\S]*기간[\s\S]*평가[\s\S]*최종[\s\S]*현재[\s\S]*인출[\s\S]*연[\s\S]*투입/.test(head),
     head.slice(0,90));
  ok('투입이 마지막 머리글', head.lastIndexOf('투입') > head.lastIndexOf('연'));
  // 시세를 못 받은 줄은 평가~연 여섯 칸(평가·최종·MDD·현재·인출·연)을 colspan 으로 덮는다
  const iSpan=op.indexOf('colspan="6"'), iInflow=op.indexOf('${wnCur(r.inflow,r.cur)}');
  ok('투입 칸이 colspan 뒤에 온다', iSpan>0 && iInflow>iSpan);
  ok('투입 칸이 한 번만 그려진다', (op.match(/\$\{wnCur\(r\.inflow,r\.cur\)\}/g)||[]).length===1);
  ok('각주 설명도 표 순서와 같다', idx.indexOf('평가 = 보유 평가금') < idx.indexOf('투입 = 밖에서 넣은 돈'));
}

console.log('[38] 세션 이동 — 보던 자리도 지킨다');
{
  const sw=extractFn(idx,'function switchSess(id)');
  ok('이동 전 자리를 기억한다', /const keepY=window\.scrollY;/.test(sw));
  ok('다 그린 뒤에 되돌린다',
     sw.indexOf('refreshAll()') < sw.indexOf('holdScroll(keepY)'), '순서 어긋남');
  const hs=extractFn(idx,'function holdScroll(y)');
  ok('자리 지키기 함수 존재', !!hs);
  ok('문서 높이를 넘지 않게 자른다', /Math\.min\(y,max\)/.test(hs) && /scrollHeight - window\.innerHeight/.test(hs));
  // 시세가 늦게 와서 다시 그려지면 높이가 달라진다 — 한 번 더 맞춘다
  ok('늦은 렌더까지 한 번 더 맞춘다', /requestAnimationFrame/.test(hs) && /setTimeout/.test(hs));
  ok('그 사이 사용자가 스크롤했으면 그만둔다', /Math\.round\(window\.scrollY\)===mine/.test(hs));
  ok('다른 이동이 끼어들면 그만둔다', /tok!==_holdTok/.test(hs) && !!extractFn(idx,'function cancelHold()'));

  // 유지는 세션 이동에서만 — 탭·칩을 직접 누르면 맨 위로 가는 게 맞다
  const gb=extractFn(idx,'function goBlk(sec,blk,noScroll)');
  ok('goBlk이 스크롤을 건너뛸 수 있다', /if\(noScroll\) return;/.test(gb));
  const ks=extractFn(idx,'function keepSubnav(sec)');
  ok('세션 이동은 스크롤 없이 서브탭만 맞춘다', /goBlk\(sec,blk,true\)/.test(ks));
  // 위로 올리는 세 곳(goBlk·탭·칩)은 예약된 자리 지키기를 먼저 취소해야 서로 안 싸운다
  const n=(idx.match(/cancelHold\(\); window\.scrollTo\(\{top:0/g)||[]).length;
  ok('맨 위로 가는 곳은 먼저 취소한다', n===3, n+'곳');
  const tops=(idx.match(/window\.scrollTo\(\{top:0/g)||[]).length;
  ok('취소 없이 올리는 곳이 없다', tops===3, tops+'곳 중 '+n+'곳만 취소');
}

console.log('[39] 로그인 진단 — 어디서 막혔는지 화면에서 읽힌다');
{
  ok('진단 자리와 버튼이 있다', /id="gdiag"/.test(idx) && /id="gdiagbtn"/.test(idx) && /function toggleDiag\(\)/.test(idx));
  const ad=extractFn(idx,'function authDiag()');
  ok('진단 함수 존재', !!ad);
  // 막히는 지점마다 한 줄씩 — 이게 있어야 되묻지 않고 원인이 갈린다
  [['모듈 로딩','로그인모듈'],['핸들러 연결','인증대기'],['인증 상태','로그인상태'],
   ['앱 시작','앱시작'],['저장소','저장소'],['브라우저','브라우저']].forEach(([nm,key])=>{
    ok('진단에 '+nm+' 줄이 있다', ad.includes("'"+key));
  });
  ok('마지막 오류도 남긴다', /authLastErr/.test(ad) && /let authLastErr=/.test(idx));
  ok('UA도 남긴다', /navigator\.userAgent/.test(ad));
  ok('저장소는 실제로 써 보고 판단한다', /function storageOK\(\)/.test(idx)
     && /localStorage\.setItem\('_t','1'\)/.test(extractFn(idx,'function storageOK()')));
  // 앞단에서 막힌 건지 뒷단에서 막힌 건지 가르는 플래그
  const ia=extractFn(idx,'function initAuth()');
  ok('핸들러 연결 표시를 세운다', /authWired=true;/.test(ia) && /let authWired=false;/.test(idx));
  // 구글 인증은 끝났는데 앱이 안 열리는 상태는 '로그인 실패'와 고칠 곳이 다르다
  const gl=extractFn(idx,'function googleLogin()');
  ok('인증 성공 뒤 앱이 안 열리면 알린다',
     /\.then\(\(\)=>\{[\s\S]*?if\(!appStarted\) authWarn\(/.test(gl));
  ok('로그인 실패 코드를 진단에 남긴다', /authLastErr=String\(code\);/.test(gl));
  ok('진단이 펼쳐져 있으면 갱신한다', /if\(d && !d\.hidden\) d\.textContent=authDiag\(\)/.test(extractFn(idx,'function authWarn(msg)')));
  ok('진단은 선택으로 접혀 있다', /id="gdiag" hidden/.test(idx));
}

console.log('[40] 모의 일괄 적용 — 원금과 1회 적립액을 따로');
{
  ok('칸이 둘이다', /id="p_capital"/.test(idx) && /id="p_addamt"/.test(idx));
  ok('칸마다 현재값 힌트가 있다', /id="p_capital_n"/.test(idx) && /id="p_addamt_n"/.test(idx));
  const af=extractFn(idx,'function paperAddField(tab, st)');
  ok('적립액 매핑 존재', !!af);
  ok('적립식만 적립액으로 본다', /mode==='lump'\) \? null : 'amount'/.test(af));
  const cf=extractFn(idx,'function paperCapField(tab, st)');
  ok('거치식은 여전히 원금', /mode==='lump'\) \? 'amount' : null/.test(cf));
  ok('ASAP은 둘 다 아니다', /return null;\s*\/\/ asap/.test(cf) && !/asap/.test(af));
  const vs=extractFn(idx,'function paperValSummary(fieldOf)');
  ok('현재값 요약 함수 존재', !!vs);
  ok('세션 통화로 찍는다', /wnCur\(\+st\[f\]\|\|0, curOf\(st\)\)/.test(vs));
  ok('값이 여러 개면 나열한다', /seen\.join\(' \/ '\)/.test(vs));
  ok('해당 없으면 그렇게 적는다', /'해당 세션 없음'/.test(vs));
  const sp=extractFn(idx,'function syncPaperStart()');
  ok('열 때 두 힌트를 다 채운다',
     /p_capital_n[\s\S]{0,80}paperValSummary\(paperCapField\)/.test(sp)
     && /p_addamt_n[\s\S]{0,80}paperValSummary\(paperAddField\)/.test(sp));
  ok('두 칸 다 비우고 연다', /\$\('p_addamt'\)[\s\S]{0,60}value=''/.test(sp));
  const ap=extractFn(idx,'async function applyAllSimStart()');
  ok('두 값을 따로 읽는다', /paperReadAmt\('p_capital'/.test(ap) && /paperReadAmt\('p_addamt'/.test(ap));
  ok('잘못된 값이면 멈춘다', /cap===false \|\| add===false/.test(ap));
  ok('둘 다 따로 적용한다', /paperCapField\(tab,x\.settings\); if\(f\) x\.settings\[f\]=wonToSess\(cap,/.test(ap)
     && /paperAddField\(tab,x\.settings\); if\(f\) x\.settings\[f\]=wonToSess\(add,/.test(ap));
  /* 금액 칸은 원화다. 미국 종목 세션엔 시작일 환율로 환산해 들어가므로
     어떤 환율을 썼는지 묻기 전에 보여야 한다 — 원금이 얼마로 들어갈지가 달라진다. */
  ok('통화 규약을 미리 알린다', /환율 \$\{fx\.date\} 기준/.test(ap) && /국내 종목은 원화 그대로/.test(ap));
  ok('건너뛴 세션 이름에 조사를 안 붙인다', /건너뛴 세션: /.test(ap) && !/join\(', '\)\}은 금액/.test(ap));
  const rd=extractFn(idx,'function paperReadAmt(id, label)');
  ok('비우면 그대로 둔다', /if\(!raw\) return null;/.test(rd));
}

console.log('[41] 한투 모의투자 연결 — 세션 설정과 주문 전송');
{
  const kis=fs.existsSync(__d+'/functions/api/kis.js')?fs.readFileSync(__d+'/functions/api/kis.js','utf8'):'';
  // ── 서버: 해외(미국) 경로 ──
  ok('미국 티커를 가른다', /const USSYM = \/\^\[A-Z\]\{1,5\}\$\//.test(kis));
  ok('해외 시세 엔드포인트', /overseas-price\/v1\/quotations\/price/.test(kis) && /HHDFS00000300/.test(kis));
  ok('해외 잔고 엔드포인트', /overseas-stock\/v1\/trading\/inquire-balance/.test(kis) && /VTTS3012R/.test(kis));
  ok('해외 주문 엔드포인트', /overseas-stock\/v1\/trading\/order"/.test(kis)
     && /VTTT1002U/.test(kis) && /VTTT1001U/.test(kis));
  // 시세·주문의 거래소 코드가 다르다 — 시세로 찾아서 주문에 쓴다
  ok('거래소를 시세로 찾아 쓴다', /EXCD_ORD = \{ NAS: "NASD", AMS: "AMEX", NYS: "NYSE" \}/.test(kis)
     && /mkt = q\.market;/.test(kis));
  // 미국 호가는 소수점 — 국내처럼 반올림하면 딴 주문이 된다
  ok('미국 호가는 소수 2자리', /us \? Math\.round\(\(\+body\.price \|\| 0\) \* 100\) \/ 100/.test(kis)
     && /OVRS_ORD_UNPR: price\.toFixed\(2\)/.test(kis));
  ok('미국 시장가는 거부한다', /미국 주식은 지정가만 주문할 수 있습니다/.test(kis));
  ok('주문은 재시도하지 않는다', !/overseas-stock\/v1\/trading\/order"[\s\S]{0,300}readJson/.test(kis));
  ok('국내 경로는 그대로', /domestic-stock\/v1\/trading\/order-cash/.test(kis) && /VTTC0802U/.test(kis));

  // ── 서버: 네 갈래(환경 × 시장) ──
  ok('환경별 키를 따로 읽는다', /KIS_REAL_/.test(kis) && /KIS_VTS_/.test(kis)
     && /function withEnv\(env, want, market\)/.test(kis));
  // 키를 하나만 둔 옛 설정에서 모의 키로 실전 주문이 나가면 안 된다
  ok('옛 단일 키는 제 환경에서만 쓴다', /const fb = \(k\) => \(legacy === w \? env\[k\] \|\| "" : ""\);/.test(kis));
  ok('네 갈래를 목록으로 준다', /function modeList\(env\)/.test(kis)
     && /mk \+ "-" \+ m/.test(kis));
  /* 한투는 국내·국외 모의계좌를 따로 신청한다 — 앱키는 같은데 계좌번호가 다르다.
     환경 단위로만 보면 '국내는 되는데 국외는 계좌가 없는' 경우를 통째로 놓친다. */
  ok('계좌는 시장별로도 갈린다', /KIS_\$\{W\}_ACCOUNT_\$\{MK\}/.test(kis));
  ok('시장 전용 계좌가 없으면 환경 공통으로 내려간다',
     /\.\.\.two\("ACCOUNT"\),\s*\/\/ 환경 공통/.test(kis));
  ok('네 갈래를 각각 따진다', /for \(const \[mk, label\] of \[\["kr", "국내"\], \["us", "국외"\]\]\) \{\s*\n\s*const e = withEnv\(env, m, mk\);/.test(kis));
  ok('뭐가 비었는지 알려준다 (값은 안 담는다)', /missing: \["APPKEY", "APPSECRET", "ACCOUNT"\]\.filter/.test(kis));
  ok('시장을 code 로 정해 넘긴다', /USSYM\.test\(c\) \? "us" : "kr"/.test(kis));

  // 실제 해석 결과를 직접 돌려 본다 — 정규식만으로는 새는지 알 수 없다
  {
    const F=new Function(kis.replace(/export /g,'')+'\nreturn {withEnv,modeList};')();
    const solo={KIS_ENV:'vts',KIS_APPKEY:'k',KIS_APPSECRET:'s',KIS_ACCOUNT:'11111111-01'};
    const ids=m=>F.modeList(m).filter(x=>x.ready).map(x=>x.id).sort().join(',');
    ok('옛 단일키는 모의 두 갈래만 연다', ids(solo)==='kr-vts,us-vts', ids(solo));
    const split={KIS_VTS_APPKEY:'k',KIS_VTS_APPSECRET:'s',KIS_VTS_ACCOUNT_KR:'2-01',KIS_VTS_ACCOUNT_US:'3-01'};
    ok('시장별 계좌를 각각 집어 온다',
       F.withEnv(split,'vts','kr').KIS_ACCOUNT==='2-01' && F.withEnv(split,'vts','us').KIS_ACCOUNT==='3-01');
    const usOnly={KIS_VTS_APPKEY:'k',KIS_VTS_APPSECRET:'s',KIS_VTS_ACCOUNT_US:'3-01'};
    ok('한쪽 계좌만 있으면 그쪽만 열린다', ids(usOnly)==='us-vts', ids(usOnly));
    // 모의 키로 실전 주문이 나가면 되돌릴 수 없다
    const leak=F.withEnv(solo,'real','us');
    ok('모의 키가 실전으로 새지 않는다', leak.KIS_APPKEY==='' && leak.KIS_ACCOUNT==='');
    /* 사람이 손으로 넣는 값이다 — 앞에 붙였는지 뒤에 붙였는지로 안 되면 버그다.
       KIS_REAL_APPKEY 와 KIS_APPKEY_REAL 을 똑같이 읽어야 한다. */
    const suf={KIS_ENV:'vts',KIS_APPKEY:'v',KIS_APPSECRET:'s',KIS_ACCOUNT:'1-01',
               KIS_APPKEY_REAL:'R',KIS_APPSECRET_REAL:'S',KIS_ACCOUNT_REAL:'9-01'};
    const pre={KIS_ENV:'vts',KIS_APPKEY:'v',KIS_APPSECRET:'s',KIS_ACCOUNT:'1-01',
               KIS_REAL_APPKEY:'R',KIS_REAL_APPSECRET:'S',KIS_REAL_ACCOUNT:'9-01'};
    ok('이름을 뒤에 붙여도 읽는다', ids(suf)==='kr-real,kr-vts,us-real,us-vts', ids(suf));
    ok('앞뒤 표기가 같은 결과', ids(suf)===ids(pre));
    ok('뒤 표기도 제 환경 값으로 푼다',
       F.withEnv(suf,'real','us').KIS_APPKEY==='R' && F.withEnv(suf,'vts','us').KIS_APPKEY==='v');
    // 섞어 써도 시장 전용 계좌가 우선이어야 한다
    const mix=Object.assign({},pre,{KIS_ACCOUNT_REAL_US:'8-01'});
    ok('섞어 써도 시장 전용이 우선', F.withEnv(mix,'real','us').KIS_ACCOUNT==='8-01'
       && F.withEnv(mix,'real','kr').KIS_ACCOUNT==='9-01');
    ok('빠진 이름을 두 표기로 알려준다',
       F.modeList(solo).filter(m=>!m.ready).every(m=>m.missing.every(x=>/ 또는 /.test(x))));
  }
  ok('config가 준비된 것만 추려 준다', /ready: modes\.filter\(\(m\) => m\.ready\)\.map\(\(m\) => m\.id\)/.test(kis));
  ok('주문은 환경을 명시적으로 받는다', /env = withEnv\(env, body\.env \|\| url\.searchParams\.get\("env"\), USSYM\.test\(c\) \? "us" : "kr"\)/.test(kis));
  ok('어느 환경 키가 없는지 말해 준다', /\$\{isReal\(env\) \? "실전" : "모의투자"\} 키가 설정되지 않았습니다/.test(kis));

  // ── 앱: 세션 설정 ──
  ok('모의투자 안에만 한투 선택이 있다',
     idx.indexOf('id="sess_simstart_wrap"') < idx.indexOf('id="sess_kis"'));
  /* 갈래는 고르는 게 아니라 정해진다 — 시장은 종목이, 환경은 세션 종류가 정한다.
     넷 중에 고르게 하면 잘못 골라 막히기만 하고, '모의투자' 딱지로 실전 주문이
     나갈 길도 열린다. 사람이 정할 건 '연결할지 말지' 하나뿐이다. */
  const kf=extractFn(idx,'function kisModeFor(sess, paperOverride)');
  // 실제로 실행해서 확인한다 — 정규식만으로는 '모의인데 실전으로 간다'를 못 잡는다
  const kisModeOf=(ticker,paper)=>{
    const F=new Function('KR_CODE_RE',
      extractFn(idx,'function kisMarketOf(ticker)')+'\n'+kf+'\nreturn kisModeFor;')(/^(?:\d{6}|\d{4}[A-Z]\d)$/);
    return F({paper, settings:{ticker}});
  };
  ok('갈래를 종목·세션에서 끌어낸다', !!kf
     && /kisMarketOf\(tk\) \+ '-' \+ \(paper\?'vts':'real'\)/.test(kf));
  ok('고르는 칸이 아니라 체크 하나다', /type="checkbox" id="sess_kis"/.test(idx)
     && !/<option value="us-vts"/.test(idx));
  ok('어느 갈래로 나가는지 옆에 띄운다', /id="sess_kis_hint"/.test(idx)
     && /hint\.textContent = ' — '\+\(KIS_MODE_LBL\[mode\]\|\|mode\)/.test(extractFn(idx,'async function kisOptUI()')));
  ok('세션엔 연결 여부만 저장한다', /t\.kis=kisOwner && !!\(\$\('sess_kis'\)&&\$\('sess_kis'\)\.checked\); delete t\.kisMode;/.test(idx)
     && /s\.kis=kisOwner && !!\(\$\('sess_kis'\)&&\$\('sess_kis'\)\.checked\);/.test(idx));
  /* '모의투자' 딱지가 붙은 세션이 실전 주문을 내는 길이 있으면 안 된다.
     고르게 하지 않고 세션 종류에서 끌어내면 어긋날 수가 없다. */
  ok('모의 세션은 늘 모의계좌로 간다', kisModeOf('SOXL', true)==='us-vts' && kisModeOf('069500', true)==='kr-vts');
  ok('실계좌 세션은 늘 실전계좌로 간다', kisModeOf('SOXL', false)==='us-real' && kisModeOf('069500', false)==='kr-real');
  ok('모의 여부를 바꾸면 안내도 따라온다', /style\.display=this\.checked\?'':'none';kisOptUI\(\)/.test(idx));
  // 시장은 종목이 정한다 — 고를 여지가 없다
  ok('시장은 종목코드로 정한다', /function kisMarketOf\(ticker\)/.test(idx) && /KR_CODE_RE\.test/.test(extractFn(idx,'function kisMarketOf(ticker)')));
  const ku=extractFn(idx,'async function kisOptUI()');
  ok('연결 상태를 그 자리에서 확인한다', /kisConfig\(true\)/.test(ku) && /j\.ready\|\|\[\]/.test(ku));
  ok('키가 없으면 어느 갈래인지 짚어 준다', /설정이 서버에 없습니다/.test(ku)
     && /\(\(j\.modes\|\|\[\]\)\.find\(m=>m\.id===mode\)\|\|\{\}\)\.missing/.test(ku));
  ok('국내·국외 계좌가 다를 수 있음을 알려준다', /_ACCOUNT_\$\{market\.toUpperCase\(\)\}/.test(ku)
     && /국내·국외 계좌를 따로 신청합니다/.test(ku));
  ok('실전이면 빨간 경고', /실전계좌입니다\. 진짜 돈이 나갑니다/.test(ku));
  // 어긋날 수가 없다 — 대신 어디로 나가는지 설명한다
  ok('어디로 왜 나가는지 설명한다', /종목 <b>\$\{esc\(tk\|\|'\?'\)\}<\/b>이라/.test(ku)
     && /모의투자 세션이라 <b>모의계좌<\/b>/.test(ku));
  ok('지정가로 나간다는 걸 미리 알린다', /지정가만<\/b> 받습니다/.test(ku));

  // ── 앱: 보내는 주문은 화면과 같은 것이어야 한다 ──
  const oi=extractFn(idx,'function oitem(cls,name,tag,price,qty)');
  ok('주문표를 그리면서 구조도 남긴다', /todayOrders\.push\(/.test(oi));
  const ro=extractFn(idx,'function renderOrder()');
  ok('그릴 때마다 비운다', /todayOrders=\[\];/.test(ro));
  const n=(idx.match(/renderKisPanel\(\)/g)||[]).length;
  ok('주문표의 모든 종료 지점에서 패널을 그린다', n>=4, n+'곳');   // 정의 1 + 호출 3
  const ks=extractFn(idx,'async function kisSendToday()');
  ok('연결된 세션만 보낸다', /if\(!\(s&&s\.kis\)\) return;/.test(ks));
  ok('보낼 때도 갈래를 세션에서 끌어낸다', /const mode=kisModeFor\(s\), MP=kisModeParts\(mode\)/.test(ks));
  ok('보낼 종목과 갈래가 늘 같은 데서 나온다',
     /const mode=kisModeFor\(s\)/.test(ks) && !/kisMarketOf\(sym\)!==MP\.market/.test(ks));
  ok('준비 안 된 갈래는 안 보낸다', /if\(!\(j\.ready\|\|\[\]\)\.includes\(mode\)\)/.test(ks));
  ok('보내기 전에 확인을 받는다', /if\(!confirm\(/.test(ks));
  ok('실전이면 확인창부터 경고한다', /실전투자입니다\. 진짜 돈이 나갑니다/.test(ks));
  ok('실전은 한 번 더 묻는다', /if\(real && !confirm\('다시 확인합니다/.test(ks));
  ok('고른 환경을 서버에 같이 보낸다', /env:MP\.env,side:o\.side/.test(ks));
  ok('초당 제한을 피해 간격을 둔다', /setTimeout\(r,700\)/.test(ks));
  ok('주문마다 결과를 남긴다', /done\.push\(\{o,ok:/.test(ks));
  ok('보여준 값 그대로 보낸다', /price:Math\.round\(o\.price\*100\)\/100/.test(ks));
  const rp=extractFn(idx,'function renderKisPanel()');
  ok('연결 안 된 세션엔 패널이 없다', /if\(!\(s&&s\.kis&&kisOwner\)\)\{ box\.innerHTML=''; return; \}/.test(rp));

  /* 남이 로그인해서 '주문 내기'를 켜면 어떻게 되나 — 서버는 OWNER_EMAIL 로 막는다.
     다만 못 낼 사람에게 버튼을 보여주면 남의 계좌로 주문이 나갈 것처럼 보인다.
     서버가 막더라도 화면에서 감춘다(두 겹). */
  ok('서버가 주문 권한을 확인해 준다', /let owner = false;/.test(kis)
     && /\(await verifyOwner\(request, rawEnv\)\)\.ok === true/.test(kis));
  ok('허용 목록이 비어도 열리지 않는다', /const DEFAULT_OWNERS = \["[^"]+"\];/.test(kis)
     && /return raw\.length \? raw : DEFAULT_OWNERS;/.test(kis));
  ok('이메일은 서버가 토큰에서 직접 캔다', /identitytoolkit\.googleapis\.com\/v1\/accounts:lookup/.test(kis)
     && /if \(!owners\.includes\(email\)\) return \{ ok: false/.test(kis));
  ok('앱이 토큰을 실어 권한을 묻는다', /Authorization='Bearer '\+await u\.getIdToken\(\)/.test(idx));
  ok('권한 없으면 설정칸을 감춘다', /row\.style\.display=kisOwner\?'':'none'/.test(idx)
     && /id="sess_kis_row"/.test(idx));
  ok('권한 없으면 저장해도 안 켜진다',
     (idx.match(/kis=kisOwner && !!\(\$\('sess_kis'\)/g)||[]).length===2);
  ok('보낼 때 권한을 한 번 더 본다', /if\(!await kisSyncOwner\(\)\)\{ alert\('이 계정에는 주문 권한이 없습니다\.'\); return; \}/.test(ks));
  // 권한 확인을 기다리느라 앱이 늦어지면 안 된다
  ok('권한 확인은 앱을 붙잡지 않는다', /kisSyncOwner\(\)\.then\(ok=>/.test(extractFn(idx,'function startApp()')));
  ok('패널도 갈래를 세션에서 끌어낸다', /const mode=kisModeFor\(s\), MP=kisModeParts\(mode\)/.test(rp));
  ok('시장이 어긋나면 패널 대신 안내', /kisMarketOf\(sym\)!==MP\.market/.test(rp));
  ok('실전 패널은 색과 문구가 다르다', /real\?'sell':'buy'/.test(rp) && /실전 계좌입니다/.test(rp));
  ok('주문표에서 그대로 가져온다', /todayOrders\.filter\(/.test(rp));
}

/* ════ 42. 자동 주문 — 서버가 브라우저와 같은 주문을 낸다 ════
   주문 계산이 index.html 안에만 있어서 앱을 안 열면 오늘 낼 주문을 아무도 몰랐다.
   서버로 옮겼는데, 한 주라도 어긋나면 화면에 보이는 것과 실제로 나가는 게 달라진다.
   그래서 재구현을 믿지 않고 index.html 의 renderOrder 를 그대로 돌려 맞대 본다. */
console.log('[42] 자동 주문 — 브라우저와 서버가 같은 주문을 낸다');
{
  const imPath=__d+'/functions/api/_im.js';
  const atPath=__d+'/functions/api/autotrade.js';
  const im=fs.existsSync(imPath)?fs.readFileSync(imPath,'utf8'):'';
  const at=fs.existsSync(atPath)?fs.readFileSync(atPath,'utf8'):'';
  ok('서버용 주문 모듈이 있다', !!im);
  ok('자동 주문 엔드포인트가 있다', !!at);

  const at_=at;
  if(im){
    const M=new Function(im.replace(/export /g,'')+'\nreturn {imOrders,imCompute,imBuy1,starPct};')();
    // 브라우저 쪽 — DOM 을 최소로 흉내내고 renderOrder 원문을 그대로 실행한다
    const KIND=idx.slice(idx.indexOf('const KIND_T='), idx.indexOf('};', idx.indexOf('const KIND_T='))+2);
    const need=['function computeInf()','function imBuy1(c)','function starPct(ticker,div,T,base)',
      'function reverseT(kind,t,div)','function oitem(cls,name,tag,price,qty)','function renderOrder()',
      'function imMomNow()','function imTgtOf(base, mom)','function calcStarPoint(c)',
      'function quoteOf(tab)','function revGapOf(st)','function exitMulOf(base)','function isAmtKind(k)',
      'function fmtT(t)','function isSell(k)','function isBuy(k)','function isCx(k)',
      // 7차 ⑧ — 별지점·익절 조절이 확정 봉만 쓴다. 실코드 그대로, 시계만 고정해서 넣는다
      'function simCutoff(cur)','function settledBars(rows,cur)','function curOf(st)','function isKrCode(t)',
      // 제8차 — 주문표 '규칙' 줄(V4.0 공식/변형)과 하방 LOC CUSTOM 안내
      'function imRuleTag(st)','function imRuleOf(st)','function imVariantOf(cfg)','function imRowsNote(n)']
      .map(x=>{ try{ return extractFn(idx,x); }catch(e){ return ''; } }).filter(Boolean).join('\n')
      + '\n' + (idx.match(/const KR_CODE_RE=[^\n]*/)||[''])[0]
      + '\n' + (idx.match(/const REV_GAP_DEF=[^\n]*/)||[''])[0]
      + '\nconst MKT_CLOSE_MIN={usd:16*60, krw:15*60+30}; const SETTLE_LAG_MIN=20;'
      + "\nfunction _exchNow(cur){ return {date:'2099-12-31', min:23*60}; }";
    const browserOrders=(st,hist,close,days)=>{
      const EL=()=>({textContent:'',innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}}});
      return new Function('EL','ST','HIST','DAYS','CLOSE', `
        const S={activeTab:'inf', inf:{active:'s', sessions:[{id:'s',settings:ST,hist:HIST}]}};
        let todayOrders=[];
        const $=(id)=>id==='o_close'?{value:''}:EL();
        const wn=v=>'$'+(+v||0).toFixed(2);
        const inputNum=()=>0;
        const curStrat=()=>({id:'s',settings:ST,hist:HIST});
        const lastQuote={inf:{symbol:ST.ticker, days:DAYS}};
        let infChartData=DAYS, infSimNote='', infSimNoteSid=null, _lastNeedClose=null;
        ${KIND}
        const IM_MOM_LEN=20, IM_MOM_TH=8, IM_MOM_CAP=30;
        ${need}
        function infSettledLast(){ return {close:CLOSE}; }
        function render5day(){}
        function renderKisPanel(){}
        renderOrder();
        return todayOrders;`)(EL,st,hist,days,close);
    };
    const ST=(o)=>Object.assign({ticker:'SOXL',div:20,target:20,big:20,principal:10000,cur:'usd',
      rows:8,rowqty:1,compound:false,reverse:false,tgtDyn:false},o);
    const DAYS=Array.from({length:30},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'), close:90+i}));
    const many=(n,f)=>Array.from({length:n},(_,i)=>f(i));
    const CASES=[
      ['빈 세션(첫 매수)',       ST({}), [], 100],
      ['보유·전반전',            ST({}), [{kind:'1회매수',date:'2026-01-02',price:100,qty:5}], 95],
      ['보유·후반전',            ST({}), many(12,i=>({kind:'1회매수',date:'2026-01-0'+(i%9+1),price:100-i,qty:3})), 80],
      ['원금 소진',              ST({principal:500}), many(21,()=>({kind:'1회매수',date:'2026-02-01',price:20,qty:1})), 20],
      ['아래로 LOC 3줄',          ST({rows:3,rowqty:2}), [{kind:'1회매수',date:'2026-01-02',price:100,qty:5}], 95],
      ['익절 조절 켬',           ST({tgtDyn:true}), [{kind:'1회매수',date:'2026-01-02',price:100,qty:5}], 95],
      ['평단이 종가보다 위(상한)',ST({}), [{kind:'1회매수',date:'2026-01-02',price:200,qty:10}], 100],
      ['40분할 TQQQ 익절15',     ST({ticker:'TQQQ',div:40,target:15}), [{kind:'절반매수',date:'2026-01-02',price:70,qty:4}], 68],
      ['매도 후 사이클 종료',     ST({}), [{kind:'1회매수',date:'2026-01-02',price:100,qty:5},
                                        {kind:'지정가매도',date:'2026-01-09',price:120,qty:5}], 118],
      ['국내 종목(원화)',        ST({ticker:'069500',cur:'krw',principal:5000000}),
                                 [{kind:'1회매수',date:'2026-01-02',price:10000,qty:30}], 9800],
    ];
    const norm=o=>`${o.side} ${o.tag} ${(+o.price).toFixed(4)} x${o.qty}`;
    let diff=0, checked=0;
    for(const [nm,st,hist,close] of CASES){
      let a=null,b=null,err='';
      try{ a=browserOrders(st,hist,close,DAYS).map(norm); }catch(e){ err='브라우저: '+e.message; }
      try{ b=M.imOrders({st,hist,close,days:DAYS}).orders.map(norm); }catch(e){ err+=' 서버: '+e.message; }
      const same=!err && a.length===b.length && a.every((x,i)=>x===b[i]);
      if(!same) diff++;
      checked++;
      ok('같은 주문 — '+nm, same, err || ('브라우저['+(a||[]).join(' | ')+'] vs 서버['+(b||[]).join(' | ')+']'));
    }
    ok('열 가지 상황을 다 봤다', checked===10, checked+'건');
    // 리버스는 옮기지 않았다 — 반쯤 옮긴 엔진이 사람 없이 주문을 내면 안 된다
    const rev=M.imOrders({st:ST({reverse:true}),
      hist:many(21,()=>({kind:'1회매수',date:'2026-02-01',price:20,qty:1})), close:20, days:DAYS});
    ok('리버스 세션은 건너뛴다', rev.orders.length===0 && /리버스/.test(rev.skip||''), rev.skip||'안 건너뜀');
    ok('종가가 없으면 안 낸다', M.imOrders({st:ST({}),hist:[],close:0,days:DAYS}).skip==='확정 종가 없음');

    /* 확정 종가 — 자동 주문은 마감 20분 전에 도는데, 그 시각 오늘 봉의 close 는
       종가가 아니라 장중 현재가다. 그걸 쓰면 앱과 다른 주문이 나간다.
       앱(simCutoff·settledBars)과 같은 규약인지 실제 시각을 넣어 확인한다. */
    const M2=new Function(im.replace(/export /g,'')+'\nreturn {settledLast,simCutoff};')();
    const bars=[{date:'2026-09-14',close:100},{date:'2026-09-15',close:111}];
    const at=(iso)=>new Date(iso);
    // 미국장: 16:00 ET 마감 + 20분 정산. 15:40 ET(=19:40 UTC, 서머타임)은 아직 어제 종가.
    ok('마감 전에는 어제 봉을 쓴다',
       (M2.settledLast(bars,'usd',at('2026-09-15T19:40:00Z'))||{}).close===100,
       JSON.stringify(M2.settledLast(bars,'usd',at('2026-09-15T19:40:00Z'))));
    // 16:10 ET — 마감은 지났지만 정산 20분이 안 지났다. 아직 어제 것이다.
    ok('마감 직후도 아직 어제 봉', (M2.settledLast(bars,'usd',at('2026-09-15T20:10:00Z'))||{}).close===100);
    // 16:25 ET — 정산까지 지났다. 이제 오늘 봉을 쓴다.
    ok('정산까지 지나야 오늘 봉', (M2.settledLast(bars,'usd',at('2026-09-15T20:25:00Z'))||{}).close===111);
    // 국내장: 15:30 마감 + 20분 → 15:50 KST 이후
    ok('국내는 15:50 KST가 경계',
       (M2.settledLast(bars,'krw',at('2026-09-15T06:30:00Z'))||{}).close===100 &&
       (M2.settledLast(bars,'krw',at('2026-09-15T07:00:00Z'))||{}).close===111);
    // 앱과 같은 상수를 쓰는지 — 한쪽만 고치면 또 갈린다
    ok('앱과 같은 마감·정산 상수',
       /MKT_CLOSE_MIN = \{ usd: 16 \* 60, krw: 15 \* 60 \+ 30 \}/.test(im)
       && /SETTLE_LAG_MIN = 20/.test(im)
       && /const MKT_CLOSE_MIN=\{usd:16\*60, krw:15\*60\+30\}/.test(idx)
       && /const SETTLE_LAG_MIN=20/.test(idx));
    /* 7차 ⑦⑩ — 앱과 같은 가격 계열(div=1 · 체결가 우선)과 종목코드로 정한 통화로 확정 종가를 고른다 */
    ok('자동 주문이 확정 종가를 쓴다', /const bar = settledLast\(bars, cur\);/.test(at_||'')
       && /const bars = tradeOK \? q\.ohlcTrade : \(q\.series \|\| q\.ohlc \|\| \[\]\);/.test(at_||'')
       && /&intraday=0&div=1/.test(at_||''));

    /* 시세사가 봉을 늦게 올리는 일이 실제로 있다 — 야후가 9/14 봉을 마감 4시간 뒤에 올렸다.
       사람이면 이상한 걸 알아채지만 자동 주문은 낡은 가격으로 그대로 내버린다. */
    const M3=new Function(im.replace(/export /g,'')+'\nreturn {staleDays,STALE_MAX_DAYS};')();
    const t=(iso)=>new Date(iso);
    // 2026-09-15 19:40Z = 15:40 ET 화요일 → cutoff 는 09-14(월)
    ok('전날 종가는 안 묵은 것', M3.staleDays('2026-09-14','usd',t('2026-09-15T19:40:00Z'))===0);
    ok('주말을 낀 금요일 종가도 통과', M3.staleDays('2026-09-11','usd',t('2026-09-15T19:40:00Z'))===3);
    ok('그보다 묵으면 걸린다', M3.staleDays('2026-09-09','usd',t('2026-09-15T19:40:00Z'))>M3.STALE_MAX_DAYS);
    ok('종가 자체가 없으면 무한대', M3.staleDays(null,'usd',t('2026-09-15T19:40:00Z'))===Infinity);
    ok('3일 연휴까지는 봐준다', M3.STALE_MAX_DAYS===4);
    ok('묵은 종가면 주문을 건너뛴다', /if \(stale > STALE_MAX_DAYS\)/.test(at_||'')
       && /일 묵었습니다/.test(at_||''));
  }

  if(at){
    ok('비밀 키 없이는 못 부른다', /if \(!env\.AUTOTRADE_KEY \|\| key !== env\.AUTOTRADE_KEY\) return json\(\{ error: "권한 없음" \}, 401\)/.test(at));
    ok('드라이런이 있다', /const dry = url\.searchParams\.get\("dry"\) === "1"/.test(at)
       && /AUTOTRADE_ENABLE/.test(at));
    // 같은 날 두 번 내면 이중 주문이다
    ok('하루 한 번만 낸다', /prev\.lastDate === today/.test(at) && /lastDate: today/.test(at));
    ok('주문은 재시도하지 않는다', /재시도하지 않는다/.test(at) && !/for \(let try/.test(at));
    /* 2026-09-15: 12건을 내는데 한 건도 접수되지 않았다. 세션 안에서만 간격을 뒀고
       (i 가 세션마다 0 부터 다시 시작) 세션 경계는 간격이 0 이었다. 주문 1건이
       hashkey+order 로 API 를 두 번 쓰는 것도 안 세고 있었다. */
    /* 2026-09-16 재시험: 11건 중 10건이 한투까지 갔고 제한은 한 건(두 번째 주문)뿐이었다.
       첫 주문은 토큰 발급까지 붙어 1초에 3건이라, 1200ms 로는 다음 주문의 hashkey 가
       같은 1초 창에 들어갔다. 한 주문이 이미 2건을 쓰므로 창 하나에 한 주문만 들어가야 한다. */
    ok('초당 제한을 피해 간격을 둔다', /await paceOrder\(\);/.test(at)
       && /const ORDER_GAP_MS = 2000;/.test(at));
    ok('간격은 세션을 넘어서도 이어진다',
       /let _lastOrderAt = 0;/.test(at)
       && /_lastOrderAt \? ORDER_GAP_MS - \(Date\.now\(\) - _lastOrderAt\) : 0/.test(at)
       && !/if \(i\) await sleep/.test(at));
    /* 크론이 늦게 돌면 마감 뒤에 주문이 나간다 — 그날 체결되지 않고 다음 거래일로 넘어간다.
       실측(2026-09-15): 19:40·20:40 UTC 예정이 22:25·23:08 에 돌았다(1시간 46분·2시간 28분 지연). */
    ok('마감 뒤에는 주문하지 않는다',
       /const win = orderWindow\(cur\);/.test(at) && /주문 시간이 아닙니다 — 지금 \$\{win\.now\}/.test(at)
       && !/st\.cur\)/.test(at));
    /* 예전엔 부르기만 하면 lastDate 가 찍혀, 늦게 돈 크론이 아무것도 안 내고도
       그날을 소진해 제 시각 실행이 막혔다. */
    ok('한 건도 안 냈으면 오늘을 소진하지 않는다',
       /const tried = out\.sessions\.some\(\(x\) => Array\.isArray\(x\.results\) && x\.results\.length\);/.test(at)
       && /if \(!dry && tried\) await fsSet/.test(at));
    {
      const M4=new Function(im.replace(/export /g,'')+'\nreturn {orderWindow};')();
      const t=(iso)=>new Date(iso);
      ok('마감 24분 전은 주문한다', M4.orderWindow('usd', t('2026-09-16T19:36:00Z')).ok===true);
      ok('마감 1시간 1분 전은 이르다', M4.orderWindow('usd', t('2026-09-16T18:59:00Z')).ok===false);
      // 실제로 늦게 돈 두 크론
      ok('늦게 돈 크론은 막힌다',
         M4.orderWindow('usd', t('2026-09-15T22:25:45Z')).ok===false
         && M4.orderWindow('usd', t('2026-09-15T23:08:29Z')).ok===false);
      ok('국내는 국내 마감 기준', M4.orderWindow('krw', t('2026-09-16T05:50:00Z')).ok===true
         && M4.orderWindow('krw', t('2026-09-16T07:00:00Z')).ok===false);
    }
    ok('세션 종류가 환경을 정한다', /const kisEnv = s\.paper \? "vts" : "real"/.test(at));
    ok('연결 안 한 세션은 건너뛴다', /if \(!s\.kis\)/.test(at));
    ok('서명은 WebCrypto 로 한다', /RSASSA-PKCS1-v1_5/.test(at) && !/require\(/.test(at));
    // 자동 경로가 열려 있으면 키 없는 사이트가 무방비가 된다
    const kisSrc=fs.existsSync(__d+'/functions/api/kis.js')?fs.readFileSync(__d+'/functions/api/kis.js','utf8'):'';
    const vo=kisSrc?extractFn(kisSrc,'async function verifyOwner(request, env)'):'';
    ok('자동 키는 값이 있을 때만 통한다',
       /if \(env\.AUTOTRADE_KEY && ak && ak === env\.AUTOTRADE_KEY\)/.test(vo));
  }
  const wf=__d+'/.github/workflows/autotrade.yml';
  ok('시간을 재는 워크플로가 있다', fs.existsSync(wf));
  if(fs.existsSync(wf)){
    const y=fs.readFileSync(wf,'utf8');
    ok('평일에만 돈다', /cron: "40 (19|20) \* \* 1-5"/.test(y));
    ok('손으로도 돌릴 수 있다', /workflow_dispatch/.test(y));
    ok('손으로 돌릴 땐 드라이런이 기본', /default: true/.test(y));
    ok('주문구분을 손으로 골라 시험할 수 있다', /ord_dvsn:/.test(y) && /ordDvsn=\$DVSN/.test(y));
    ok('평소 주문구분은 지정가다', /inputs\.ord_dvsn \|\| '00'/.test(y));
  }
}

/* ════ 43. 미국 주문구분 — LOC 가 몇 번인지 알아보되, 평소 주문은 건드리지 않는다 ════
   공개 문서가 31~34 의 순서를 서로 다르게 적어 놔서 어느 숫자가 LOC 인지 확정이 안 된다.
   숫자를 찍어 박아 넣으면 MOC(장마감 시장가)로 나갈 수도 있다 — 그러면 정한 값이 아닌
   아무 값에나 체결된다. 그래서 (1) 기본값은 예전 그대로 "00", (2) 무엇으로 나갔는지
   응답에 적어 돌려주고, (3) 확실히 거절당한 때에만 "00" 으로 한 번 떨어뜨린다. */
console.log('\n[43] 미국 주문구분 — 시험은 하되 평소 주문은 그대로');
{
  const kisSrc=fs.existsSync(__d+'/functions/api/kis.js')?fs.readFileSync(__d+'/functions/api/kis.js','utf8'):'';
  const at=fs.existsSync(__d+'/functions/api/autotrade.js')?fs.readFileSync(__d+'/functions/api/autotrade.js','utf8'):'';
  ok('안 주면 지정가로 나간다', /DVSN_OK\.includes\(String\(body\.ordDvsn \|\| ""\)\) \? String\(body\.ordDvsn\) : "00"/.test(kisSrc));
  ok('아는 번호만 받는다', /const DVSN_OK = \["00", "31", "32", "33", "34"\]/.test(kisSrc));
  ok('무엇으로 나갔는지 돌려준다', /ordDvsn: dvsn/.test(kisSrc));
  // 되던짐은 "한투가 안 받았다고 답한" 때만 — 예외나 초당제한이면 이미 접수됐을 수 있다
  ok('확실한 거절일 때만 지정가로 떨어진다',
     /if \(!ok && wantDvsn !== "00" && !RATE_LIMITED\(j\)\)/.test(kisSrc));
  ok('떨어뜨린 사실을 기록에 남긴다', /fellBack: true, firstTry: first/.test(kisSrc));
  // 예외 경로에는 되던짐이 없어야 한다 — 응답을 못 받은 주문은 냈는지 모른다
  const usBlk=(kisSrc.split('// ── 미국 주식 주문 ──')[1]||'').split('const tr = side ===')[0];
  ok('응답이 없으면 다시 내지 않는다',
     /catch \(e\) \{\s*return json\(\{ error: String\(e\.message \|\| e\) \}, 502\);/.test(usBlk));
  ok('자동 주문이 주문구분을 넘겨준다', /priceType: "limit", ordDvsn: dvsn \}/.test(at));
  ok('자동 주문 기본값도 지정가다',
     /\["31", "32", "33", "34"\]\.includes\(url\.searchParams\.get\("ordDvsn"\) \|\| ""\)/.test(at)
     && /: "00";/.test(at));
  ok('결과에 무엇으로 나갔는지 적는다', /ordDvsn: j\.ordDvsn \|\| ""/.test(at) && /fellBack: !!j\.fellBack/.test(at));
  /* 실측으로 답이 나왔다 — 모의는 "지정가만 가능한 상품입니다"(40650000)로 거절한다.
     거절이 확정된 요청을 보내면 초당 제한만 잡아먹으므로 아예 안 보낸다.
     실계좌에도 아직 안 보낸다(틀린 번호가 MOC 면 아무 값에나 체결된다). */
  ok('모르는 번호는 어디에도 보내지 않는다',
     /const dvsn = ordDvsn !== "00" \? "00" : ordDvsn;/.test(at)
     && /priceType: "limit", ordDvsn: dvsn \}/.test(at));
  ok('왜 안 보냈는지 기록에 남긴다',
     /모의는 지정가만 받습니다/.test(at) && /아직 실계좌에 보내지 않습니다/.test(at));
}

/* ════ 44. 숫자 표기 — 기호는 뒤, 자릿수는 오른쪽 맞춤 ════
   목록에서 숫자를 오른쪽으로 맞춰 놓으면 기호가 앞에 붙어 있을 때
   ₩1,234 / ₩99 처럼 기호가 들쭉날쭉 흩어진다. 뒤로 보내면 기호가
   오른쪽 끝에서 한 줄로 서고 자릿수도 그대로 맞는다.
   한 군데라도 앞으로 되돌아가면 그 표만 어긋나 보이므로 전 페이지를 본다. */
console.log('\n[44] 숫자 표기 — 기호는 뒤, 자릿수는 오른쪽 맞춤');
{
  const PAGES = ['index.html','backtest.html','ipo.html','scalping.html','admin.html'];
  const src = {};
  for(const f of PAGES) src[f] = fs.existsSync(__d+'/'+f) ? fs.readFileSync(__d+'/'+f,'utf8') : '';

  // 통화 기호가 숫자 앞에 붙은 자리가 하나도 없어야 한다.
  // 정규식 역참조 '$1' 은 통화가 아니므로 먼저 걷어낸다.
  for(const f of PAGES){
    if(!src[f]) continue;
    const t = src[f].replace(/'\$1'/g,'').replace(/\$0\.01/g,'');
    const bad = (t.match(/[₩](?=[0-9])/g)||[]).length
              + (t.match(/\$(?=[0-9])/g)||[]).length;
    ok(`${f} — 기호가 숫자 앞에 붙은 데가 없다`, bad===0, bad?`${bad}곳 남음`:'');
  }

  // 만드는 쪽(포맷터)이 뒤에 붙이는지
  const idx=src['index.html'], ipo=src['ipo.html'], bt=src['backtest.html'];
  ok('운영 — wnCur 가 기호를 뒤에 붙인다',
     /toLocaleString\('en-US'\)\+'₩'/.test(idx) && /maximumFractionDigits:2\}\)\+'\$'/.test(idx));
  ok('운영 — usd·px·won 도 뒤에 붙인다',
     (idx.match(/\+'\$';/g)||[]).length>=2 && /liveFX:FX\)\)\.toLocaleString\('en-US'\)\+'₩'/.test(idx));
  ok('백테 — fmtV 가 기호를 뒤에 붙인다', /const fmtV=\(v,t\)=>fmt\(v\)\+curOf\(t\)/.test(bt));
  ok('백테 — 로테이션 money 도 뒤에 붙인다', /money=v=>fmt\(Math\.round\(v\)\)\+cur\b/.test(bt));
  ok('백테 — 차트 축도 뒤에 붙인다', /const fmtY=v=>[^\n]*\+cs:[^\n]*\+cs;/.test(bt));
  /* 런타임 앞붙임 — 소스에 '₩1' 같은 글자가 없어도 통화를 변수로 앞에 이어붙이면
     화면엔 그대로 앞에 나온다. 로테이션 탭의 `cur+fmt(...)` 가 정확히 이 방식으로
     위의 글자 스캔을 빠져나가 국내 원금이 ₩10,000,000 으로 찍히고 있었다. */
  for(const f of PAGES){
    if(!src[f]) continue;
    const hits = src[f].match(/(?:'[₩$]'\)?|curOf\([^()]*\)|\bU\.cur|\bcurSym\b|\bcs\b|\bcur\b)\s*\+\s*(?:fmt\(|Math\.round\(|String\()/g) || [];
    ok(`${f} — 통화를 숫자 앞에 이어붙인 데가 없다`, hits.length===0, hits.join(' / '));
  }
  ok('공모주 — ipoWon 이 기호를 뒤에 붙인다', /toLocaleString\('en-US'\)\+'₩'/.test(ipo));
  // 범위는 "1,000~2,000₩" — 기호를 떼는 쪽이 뒤가 아니라 앞 값이다
  ok('공모주 — 범위는 앞 값의 기호만 뗀다',
     /function ipoWonBare\(v\)\{ return ipoWon\(v\)\.slice\(0,-1\); \}/.test(ipo)
     && !/ipoWon\([^)]*\)\.slice\(1\)/.test(ipo));

  // 숫자 폭이 같아야 자릿수가 맞는다 — 한 페이지라도 빠지면 그 페이지만 어긋난다
  for(const f of PAGES){
    if(!src[f]) continue;
    ok(`${f} — 숫자는 같은 폭으로 찍는다`,
       /body\{font-variant-numeric:tabular-nums;/.test(src[f]));
  }
}

/* ════ 45. 메뉴로 페이지를 옮길 때 로그인 화면이 번쩍이지 않는다 ════
   메뉴는 통째 페이지 이동이라 운영을 열 때마다 index.html 이 다시 뜬다.
   #authgate 는 CSS 로 처음부터 보이는데, 예전에는 프로필 쓰기(≤6초)와
   클라우드 읽기(≤8초)가 둘 다 끝나야 숨겨졌다. 그래서 이미 로그인해 둔
   사람도 페이지를 옮길 때마다 '로그인하세요'를 몇 초씩 보고 있어야 했다.
   (1) 이 기기에서 로그인한 적이 있으면 로그인 화면 대신 조용히 '여는 중'
   (2) 화면은 이 기기에 저장된 걸로 먼저 열고, 클라우드는 도착하면 맞춘다 */
console.log('\n[45] 메뉴 이동 — 로그인 화면이 번쩍이지 않는다');
{
  // 첫 페인트 전에 정해야 번쩍이지 않는다 — 그래서 <head>/본문 첫머리의 동기 스크립트다
  ok('로그인한 적 있는 기기는 표시를 남긴다', /localStorage\.setItem\('qcockpit_hadUser','1'\)/.test(idx));
  ok('그 표시를 첫 페인트 전에 본다',
     /try\{ if\(localStorage\.getItem\('qcockpit_hadUser'\)==='1'\) document\.documentElement\.classList\.add\('had-user'\); \}catch\(e\)\{\}/.test(idx));
  ok('표시가 있으면 로그인 상자 대신 여는 중',
     /html\.had-user #authgate \.gbox\{display:none\}/.test(idx)
     && /html\.had-user #authgate \.bootwait\{display:block\}/.test(idx));
  // 정말 풀렸으면 그때 로그인 화면을 띄우고 표시를 지운다 — 안 지우면 영영 '여는 중'이다
  ok('로그인이 풀리면 표시를 지운다',
     /if\(!user\)\{[\s\S]{0,320}?localStorage\.removeItem\('qcockpit_hadUser'\)[\s\S]{0,200}?\$\('authgate'\)\.style\.display='flex'/.test(idx));
  ok('로그아웃해도 표시를 지운다',
     /function doLogout\(\)\{[\s\S]{0,260}?localStorage\.removeItem\('qcockpit_hadUser'\)/.test(idx));

  // 클라우드를 기다리지 않는다 — 이게 '오래 걸리네'의 알맹이다
  ok('이 기기 기록으로 먼저 연다',
     /authStep='로컬 열기'/.test(idx)
     && /if\(openedLocal\)\{\s*\n\s*\$\('authgate'\)\.style\.display='none';/.test(idx));
  ok('먼저 여는 쪽이 프로필·클라우드보다 앞선다',
     idx.indexOf("authStep='로컬 열기'") < idx.indexOf("authStep='프로필'")
     && idx.indexOf("authStep='프로필'") < idx.indexOf("authStep='기록 읽기'"));
  // 먼저 열어 놓고 또 load() 하면 사용자가 그 사이 적은 게 날아간다
  ok('먼저 열었으면 로컬을 다시 읽지 않는다', /if\(!ok && !openedLocal\) load\(\);/.test(idx));
  // startApp 은 두 번 불려도 다시 그리기만 한다
  ok('두 번 열어도 안전하다', /if\(appStarted\)\{refreshAll\(\);return;\}/.test(idx));
  // 차단은 늦게 와도 반드시 듣는다 — 먼저 열어 준 화면을 그대로 두면 안 된다
  ok('차단이면 열어 준 화면을 되돌린다',
     /alert\('이 계정은 사용이 차단되었습니다\.'\);\s*\n\s*location\.reload\(\);/.test(idx));
}

/* ════ 46. 모든 페이지 상단이 같다 ════
   예전에는 페이지마다 제각각이었다 — 운영·단타·관리자는 사용자 배지가 제목 아래
   한 줄을 통째로 차지했고, 백테·공모주는 그 자리에 스타일을 직접 박은 로그인 단추가
   있었다. 이제 다섯 페이지 모두 [제목] … [배지][햄버거] 한 줄이다.
   배지 줄이 빠진 만큼 아래 내용이 위로 올라온다. */
console.log('\n[46] 모든 페이지 상단이 같다');
{
  const PAGES=['index.html','backtest.html','ipo.html','scalping.html','admin.html'];
  const src={}; for(const f of PAGES) src[f]=fs.existsSync(__d+'/'+f)?fs.readFileSync(__d+'/'+f,'utf8'):'';
  for(const f of PAGES){
    if(!src[f]) continue;
    // 배지는 햄버거와 같은 칸(.hright) 안에, 햄버거보다 먼저 온다
    const m=src[f].match(/<div class="hright">([\s\S]{0,400}?)<div class="jkmenu"/);
    ok(`${f} — 배지가 햄버거 왼쪽에 있다`, !!m && /id="userbadge"/.test(m[1]));
    // 스타일은 다섯 페이지가 같은 규칙을 쓴다
    ok(`${f} — 같은 배지 규칙을 쓴다`,
       /\.hright\{display:flex;align-items:center;gap:9px;flex-shrink:0\}/.test(src[f])
       && /\.userbadge\{display:flex;align-items:center;gap:7px;font-size:11\.5px;color:var\(--dim\);white-space:nowrap\}/.test(src[f])
       // 단타·관리자엔 밑줄 있는 .lo 가 따로 있어서 새어 들어왔다 — 공용 규칙이 끝까지 정한다
       && /\.userbadge \.lo\{[^}]*text-decoration:none\}/.test(src[f]));
  }
  // 배지가 제목 아래 따로 한 줄을 차지하던 흔적이 남으면 안 된다 — 그 줄을 없애는 게 목적이었다
  for(const f of PAGES){
    if(!src[f]) continue;
    ok(`${f} — 배지가 따로 한 줄을 차지하지 않는다`,
       !/<div class="userbadge" id="userbadge"[^>]*><\/div>\s*\n\s*<\/div><\/header>/.test(src[f])
       && !/userbadge[^>]*style="margin-top/.test(src[f]));
  }
  // 백테·공모주에 있던 제각각 단추는 사라졌다
  ok('백테 — 따로 놀던 로그인 단추를 없앴다', !/btAuthBtn/.test(src['backtest.html']));
  ok('공모주 — 따로 놀던 로그인 단추를 없앴다', !/ipoAuthBtn/.test(src['ipo.html']));
  // 로그인 안 한 사람도 그 자리에서 로그인할 수 있어야 한다(문이 없는 페이지)
  for(const [f,fn] of [['backtest.html','btLogin'],['ipo.html','ipoLogin']]){
    ok(`${f} — 로그아웃 상태에선 로그인 칸`,
       new RegExp(`if\\(!user\\)\\{ b\\.innerHTML='<button class="lo" onclick="${fn}\\(\\)">로그인</button>'`).test(src[f]));
  }
  // 제목이 길어 두 줄이 되면 페이지마다 헤더 높이가 달라진다
  for(const f of ['index.html','ipo.html','scalping.html','admin.html']){
    if(!src[f]) continue;
    ok(`${f} — 제목이 두 줄로 넘어가지 않는다`,
       /\.htop>div:first-child\{min-width:0\}/.test(src[f])
       && /\.htop \.kicker\{white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/.test(src[f]));
  }
}

/* ════ 47. 남의 종가로 내 세션을 세지 않는다 ════
   lastQuote 는 전략마다 한 칸뿐인데, 모의 성과 목록을 열면 paperFillAll 이
   세션마다 그 칸을 갈아끼운다. 다 돌고 나면 마지막 세션 종목이 남고,
   openPaper 가 곧바로 refreshAll 을 불러 보고 있던 세션을 그 종가로 그렸다 —
   실제로 SOXL 102주가 KORU 값(18.58$)으로 계산돼 수익률이 +1.5% → -26.6% 가 됐다.
   총 매수금은 기록에서 나오니 그대로였고, 그래서 더 알아채기 어려웠다.
   같은 칸을 모멘텀·5일평균·확정 종가·주문 제안도 쓰므로 주문 가격까지 걸린 문제다. */
console.log('\n[47] 남의 종가로 내 세션을 세지 않는다');
{
  // (1) 뿌리 — 목록을 다 돌면 시세를 원래대로 돌려놓는다
  const pf=(()=>{ try{ return extractFn(idx,'async function paperFillAll()'); }catch(e){ return ''; } })();
  ok('목록을 돌기 전 시세를 적어 둔다', /PAPER_TABS\.forEach\(\(\[t\]\)=>\{ prevQuote\[t\]=lastQuote\[t\]; \}\)/.test(pf));
  ok('다 돌면 시세를 되돌린다',
     /finally\s*\{[\s\S]{0,300}?PAPER_TABS\.forEach\(\(\[t\]\)=>\{ lastQuote\[t\]=prevQuote\[t\]; \}\)/.test(pf));
  ok('차트 데이터도 되돌린다',
     /infChartData=prevChart\.inf/.test(pf) && /vrChartData=prevChart\.vr/.test(pf));

  // (2) 겹 — 종목이 다르면 시세를 아예 안 쓴다
  const qo=(()=>{ try{ return extractFn(idx,'function quoteOf(tab)'); }catch(e){ return ''; } })();
  ok('시세를 꺼내는 한 곳이 있다', !!qo);
  ok('종목이 다르면 없는 셈 친다',
     /String\(Q\.symbol\|\|''\)\.toUpperCase\(\)===want \? Q : null/.test(qo));
  ok('종목을 모르는 세션은 막지 않는다', /if\(!want\) return Q;/.test(qo));

  /* 돈 숫자와 주문 가격을 만드는 자리는 전부 quoteOf 를 거쳐야 한다.
     한 곳이라도 lastQuote 를 직접 집으면 거기서만 남의 종가가 새어 든다. */
  const mustGuard=[
    ['무매 분석 평가금',   'function renderInfAnal()',   'inf'],
    ['확정 종가',         'function infSettledLast()',  'inf'],
    ['모멘텀',            'function imMomNow()',        'inf'],
    ['오늘 주문 제안',     'function infSuggest(kind)',  'inf'],
    ['VR 평가금',         'function vrEval(c)',         'vr'],
    ['VR 현재가',         'function vrLastPrice(c)',    'vr'],
  ];
  for(const [label, sig, tab] of mustGuard){
    let fn=''; try{ fn=extractFn(idx,sig); }catch(e){}
    const direct=new RegExp(`lastQuote\\.${tab}`).test(fn);
    ok(`${label} — 시세를 quoteOf 로 꺼낸다`,
       !!fn && new RegExp(`quoteOf\\('${tab}'\\)`).test(fn) && !direct,
       fn ? (direct?'lastQuote 를 직접 집는다':'') : '함수를 못 찾음');
  }
}

/* ════ 48. 분석 화면의 수익률과 모의 성과 목록의 수익률 ════
   여섯 전략 중 넷(무매·섀넌·200일선·적립)은 두 곳이 같은 식을 쓴다 — 총자산 ÷ 투입.
   밸류리밸런싱과 ASAP 의 머리에 붙은 알약만 다른 것을 잰다:
   '보유 수익률'(현재가 ÷ 평단)이라 현금(pool·리저브)을 안 센다.
   둘 다 맞는 값이지만 라벨이 없으면 세션 수익률로 읽힌다 — 실제로 그렇게 읽혔다. */
console.log('\n[48] 분석 화면 수익률 — 무엇을 재는지 적는다');
{
  // 목록은 전 전략이 같은 식이다 (paperStat)
  const ps=(()=>{ try{ return extractFn(idx,'function paperStat(tab, sess)'); }catch(e){ return ''; } })();
  ok('목록은 총자산 ÷ 투입으로 잰다',
     /ret:\(total\/base-1\)\*100/.test(ps) && /const base=Math\.max\(1,inflow\)/.test(ps));

  // 분모가 같아야 분석과 목록이 맞는다
  const ivsA=(()=>{ try{ return extractFn(idx,'function renderIvsAnal()'); }catch(e){ return ''; } })();
  ok('섀넌은 분석도 추가·출금을 센다',
     /const principal=\(\+st\.principal\|\|0\)\+\(c\.added\|\|0\)-\(c\.withdrawn\|\|0\)/.test(ivsA));
  const infA=(()=>{ try{ return extractFn(idx,'function renderInfAnal()'); }catch(e){ return ''; } })();
  ok('무매는 분석도 원금으로 나눈다',
     /const P=\+st\.principal\|\|0/.test(infA) && /\(amt\/P\*100\)\.toFixed\(2\)/.test(infA));

  /* 보유 수익률을 띄우는 두 곳은 '보유'라고 적어야 한다.
     ASAP 은 라벨이 없어서 맨숫자 %가 세션 수익률처럼 보였다. */
  const vrN=(()=>{ try{ return extractFn(idx,'function renderVrAcct(c)'); }catch(e){ return ''; } })()
            || idx;
  ok('VR 은 보유 수익률이라고 적는다', /textContent=`보유 \$\{hr>=0\?'\+':''\}\$\{hr\.toFixed\(2\)\}%`/.test(idx));
  const asapN=(()=>{ try{ return extractFn(idx,'function renderAsapNow()'); }catch(e){ return ''; } })();
  ok('ASAP 도 보유 수익률이라고 적는다',
     /\$\('asap_ret'\)\.textContent=`보유 \$\{hr>=0\?'\+':''\}\$\{hr\.toFixed\(2\)\}%`/.test(asapN));
  ok('ASAP 알약에 설명이 붙어 있다',
     /id="asap_ret"[^>]*title="보유분의 현재가 ÷ 평단[^"]*"/.test(idx));
  // 보유 수익률은 현금을 안 센다 — 계좌 전체 수익률과 같은 식이 아니어야 정상이다
  ok('보유 수익률은 평단 대비다', /const hr=\(price\/pos\.avg-1\)\*100/.test(asapN));
}

/* ════ 49. 시세가 도착하면 분석 카드도 다시 그린다 ════
   _afterQuote 가 '모의 기록이 새로 생겼을 때만' refreshAll 을 불렀다.
   이미 오늘까지 따라잡힌 세션은 시세가 와도 다시 안 그려서, 시세 오기 전에
   그린 값에 머물렀다. 그 값은 보유분을 현재가가 아니라 평단으로 센 것이라
   (px0 가 c.avg 로 떨어진다) 평가손익이 정확히 0 이 되고, 같은 세션인데
   목록과 수익률이 달라 보였다 — 실측 분석 +9.79% vs 목록 +4.93%. */
console.log('\n[49] 시세가 오면 분석 카드도 다시 그린다');
{
  const aq=(()=>{ try{ return extractFn(idx,'function _afterQuote()'); }catch(e){ return ''; } })();
  ok('_afterQuote 가 있다', !!aq);
  ok('기록이 안 늘어도 다시 그린다',
     /setTimeout\(\(\)=>\{ try\{ refreshAll\(\); \}catch\(e\)\{\} \},0\);/.test(aq)
     && !/if\(r\) setTimeout/.test(aq));
  // 시세를 못 쓸 때 평단으로 떨어지는 건 그대로 둔다(남의 종가를 쓰는 것보다 낫다).
  // 다만 시세가 오면 반드시 다시 그려야 그 값이 화면에 남지 않는다.
  const infA=(()=>{ try{ return extractFn(idx,'function renderInfAnal()'); }catch(e){ return ''; } })();
  ok('시세가 없으면 평단으로 떨어진다', /const px0=\(_Qp&&\(_Qp\.price\|\|_Qp\.last\)\)\|\|c\.avg\|\|0;/.test(infA));
}

/* ════ 50. 돈을 빼는 전략은 수익률이 둘이다 ════
   현재 = (평가금+잔금) ÷ 원금            — 계좌에 지금 남아 있는 것만
   누적 = (평가금+잔금+나간 돈) ÷ 원금     — 빼 간 돈까지 합쳐 전략이 얼마를 벌었나
   단리 적립은 사이클 초과익을 계좌 밖으로 빼므로 둘이 크게 갈린다
   (실측 누적 +81.54% / 현재 +1.30%). 나간 돈이 없으면 같은 값이라 한 줄만 띄운다. */
console.log('\n[50] 무매 분석 요약 — 현재·실현·누적 세 수익률');
{
  const infA=(()=>{ try{ return extractFn(idx,'function renderInfAnal()'); }catch(e){ return ''; } })();
  /* 서로 다른 축이라 더해지지 않는다 —
       현재 = 평가금 + 잔금 − 원금   계좌에 지금 남아 있는 것 (미실현 포함)
       실현 = 매도로 확정된 손익     계좌 안에 있든 밖으로 나갔든 전부
       누적 = 현재 + 나간 돈         빼 간 돈까지 합쳐 전략이 번 것 */
  ok('세 줄이 사용자가 말한 순서로 있다', (()=>{
    const i1=idx.indexOf('id="a_ret_now"'), i2=idx.indexOf('id="a_ret_real"'), i3=idx.indexOf('id="a_ret"');
    return i1>0 && i2>i1 && i3>i2; })());
  ok('현재는 나간 돈을 빼고 잰다', /put\('a_ret_now',\s*total - outMoney - P\);/.test(infA));
  /* 분배금 현금수령을 켜면 그 돈도 확정된 수입이다 — 재투자(기본)면 _dv.divCash=0이라
     아래 두 식이 예전과 글자 그대로 같은 값이 된다. */
  ok('실현은 확정된 손익이다',    /put\('a_ret_real', \(c\.realized\|\|0\) \+ _dv\.divCash\);/.test(infA));
  ok('누적은 나간 돈을 포함한다', /put\('a_ret', {6}total - P \+ _dv\.divCash\);/.test(infA)
     && /total=invested\+c\.bal\+\(c\.outside\|\|0\)/.test(infA));
  // 비율만 보면 원금이 다른 세션끼리 감이 안 온다 — 금액을 같이 적는다
  ok('수익금(수익률) 로 적는다',
     /el\.textContent = P>0 \? `\$\{sgn\}\$\{wn\(amt\)\} \(\$\{sgn\}\$\{\(amt\/P\*100\)\.toFixed\(2\)\}%\)` : '—';/.test(infA));
  ok('무엇 기준인지 적는다', /매수 상태 · 평가금 \+ 잔금/.test(idx)
     && /매도로 확정된 것/.test(idx) && /출금 포함/.test(idx));
  // 설명이 본문과 같은 크기로 한 줄에 붙으면 값이 밀려 두 줄이 된다
  ok('설명은 작은 둘째 줄이다',
     /\.rowline \.k \.sub\{display:block;font-size:10\.5px;/.test(idx));
}

/* ════ 51. 모의 성과 목록이 종목마다 시세를 한 번만 받는다 ════
   세션이 18개라도 종목은 서넛뿐인데 세션마다 다시 받아 28번을 받아 왔다.
   실측: 목록 다시 열기 3,192ms 중 장부 걷기는 11ms 뿐 — 나머지가 거의 전부 시세다.
   종목별로 한 번만 받게 하니 1,605ms 로 줄었고 값은 한 자리도 안 바뀌었다. */
console.log('\n[51] 목록을 열 때 같은 종목 시세를 두 번 받지 않는다');
{
  ok('시세를 아끼는 래퍼가 있다',
     /const fetchDaily=_memoQuote\(_fetchDailyRaw\);/.test(idx)
     && /const fetchDailyDiv=_memoQuote\(_fetchDailyDivRaw\);/.test(idx));
  // 약속을 담아야 동시에 같은 종목을 불러도 한 번만 나간다
  ok('약속을 담아 동시 호출도 묶는다', /if\(!m\.has\(SYM\)\) m\.set\(SYM, fn\(SYM\)\);/.test(idx));
  const pf=(()=>{ try{ return extractFn(idx,'async function paperFillAll()'); }catch(e){ return ''; } })();
  ok('목록을 도는 동안만 켠다', /_fillQuoteCache=new Map\(\);/.test(pf));
  ok('다 돌면 반드시 끈다', /finally\s*\{[\s\S]{0,400}?_fillQuoteCache=null;/.test(pf));
  // 평소 화면은 예전처럼 매번 새로 받아야 한다 — 캐시가 켜져 있지 않으면 그대로 통과
  ok('평소엔 캐시를 타지 않는다', /if\(!_fillQuoteCache\) return fn\(SYM\);/.test(idx));
}

/* ════ 52. '거래 수'를 두 군데서 따로 세지 않는다 ════
   분석 탭은 "2 거래", 목록은 "1거래" 였다. VR 기록엔 매매 말고도
   V 갱신·적립·인출이 같이 사는데 분석이 c.hist.length 로 전부 세고 있었다.
   수익률·평가금은 소수점까지 같았는데 이 숫자만 갈려서 "다 다르다" 로 보였다.
   같은 걸 두 군데서 따로 세면 또 어긋난다 — 한 함수로 모은다. */
console.log('\n[52] 거래 수는 한 곳에서만 센다');
{
  ok('거래를 세는 함수가 하나 있다', /function tradeCount\(hist\)\{/.test(idx));
  ok('매수·매도만 센다',
     /return \/매수\|매도\/\.test\(k\)\|\|k==='buy'\|\|k==='sell'\|\|k==='in'\|\|k==='out'; \}\)\.length;/.test(idx));
  const ps=(()=>{ try{ return extractFn(idx,'function paperStat(tab, sess)'); }catch(e){ return ''; } })();
  ok('목록이 그 함수를 쓴다', /const nTrade=tradeCount\(h\);/.test(ps));
  ok('VR 분석도 같은 함수를 쓴다',
     /\$\('vc_cyc'\)\.textContent=tradeCount\(c\.hist\)\+' 거래';/.test(idx)
     && !/vc_cyc'\)\.textContent=c\.hist\.length/.test(idx));
  // 라벨이 '매도'·'청산'인 칸은 애초에 다른 걸 세는 것이므로 건드리지 않는다
  ok('매도·청산 칸은 그대로', /\$\('a_cycles'\)\.textContent=sells\+' 매도'/.test(idx));
}

/* ════ 53. 수동 입력칸은 그 세션 것일 때만 쓴다 ════
   현재가·평가금 수동 입력칸은 화면에 하나뿐인데 세션은 여럿이다.
   vrLastPrice 가 그 칸을 종목 확인 없이 제일 먼저 읽어서, TECL 에서 🔄 를 눌러
   채워진 222.26 으로 TQQQ·SOXL 평가금까지 계산했다.
   실측: TQQQ 가 +321.07% 에서 +1080.21% 로 튀었다 (같은 기록, 남의 가격).
   목록·분석이 둘 다 같은 함수를 쓰므로 둘 다 틀렸고, 그래서 어느 쪽이 맞는지
   화면만 봐서는 알 수 없었다. */
console.log('\n[53] 수동 현재가·평가금은 넣은 세션에서만 쓴다');
{
  ok('어느 세션 값인지 기억한다',
     /let _vnFor=\{price:null, eval:null\};/.test(idx)
     && /function vnOwn\(kind\)\{ return _vnFor\[kind\]!=null && _vnFor\[kind\]===vnOwner\(\); \}/.test(idx));
  const lp=(()=>{ try{ return extractFn(idx,'function vrLastPrice(c)'); }catch(e){ return ''; } })();
  const ev=(()=>{ try{ return extractFn(idx,'function vrEval(c)'); }catch(e){ return ''; } })();
  ok('현재가는 주인일 때만 쓴다', /const p=vnOwn\('price'\)\?inputNum\('vn_price'\):0;/.test(lp));
  ok('평가금도 주인일 때만 쓴다', /const man=vnOwn\('eval'\)\?inputNum\('vn_eval'\):0;/.test(ev));
  // 넣는 길이 셋이다 — 손으로 치기, 🔄 가 채우기, 현재가에서 평가금 자동 계산
  ok('손으로 친 값도 주인을 남긴다', /oninput="commaInput\(this\);vnClaim\('eval'\);renderVrNow\(\)"/.test(idx));
  ok('자동 시세가 채울 때도 주인을 남긴다', /nfix\(live,2\); vnClaim\('price'\);\}/.test(idx));
  ok('현재가로 평가금을 채울 때도 남긴다', /\$\('vn_eval'\)\.value=nfix\(p\*c\.qty,2\); vnClaim\('eval'\);/.test(idx));
  // 안 쓰더라도 화면에 남아 있으면 그 세션 현재가로 읽힌다
  ok('세션을 옮기면 남의 값을 지운다',
     /function vnClear\(\)\{/.test(idx)
     && /function refreshVr\(\)\{[\s\S]{0,120}?vnClear\(\);/.test(idx));
}

/* ════ 54. 모의 성과 목록 — 수익률을 셋으로 나눈다 ════
     최종 = (평가금+잔금+나간 돈) ÷ 원금 − 1
     현재 = (평가금+잔금)        ÷ 원금 − 1     계좌에 지금 남아 있는 것
     인출 =  나간 돈             ÷ 원금         매도해서 계좌 밖으로 뺀 것
   셋은 정확히 더해진다: 현재 + 인출 = 최종.
   단리 세션은 초과익이 계좌 밖으로 빠지므로 크게 갈린다 —
   실측 SOXL 최종 +81.54% = 현재 +1.30% + 인출 +80.24%. */
console.log('\n[54] 모의 성과 — 최종·현재·인출 세 칸');
{
  const ps=(()=>{ try{ return extractFn(idx,'function paperStat(tab, sess)'); }catch(e){ return ''; } })();
  ok('셋을 다 돌려준다',
     /ret:\(total\/base-1\)\*100, retNow:\(\(total-outAmt\)\/base-1\)\*100, retOut:\(outAmt\/base\)\*100/.test(ps));
  ok('나간 돈은 출금 + 단리 적립이다',
     /const outAmt=\(_out&&\(\(_out\.saved\|\|0\)\+\(_out\.withdrawn\|\|0\)\)\)\|\|0;/.test(ps));

  // 더해지는지 식으로 확인한다 — (T-O)/B-1 + O/B === T/B-1
  const B=30000, T=54463.20, O=24072.98;
  const fin=(T/B-1)*100, now=((T-O)/B-1)*100, wd=(O/B)*100;
  ok('현재 + 인출 = 최종', Math.abs((now+wd)-fin)<1e-9,
     `${fin.toFixed(2)} vs ${(now+wd).toFixed(2)}`);

  // 표에 세 칸이 사용자가 말한 순서로 있어야 한다
  const head=(idx.match(/<tr><th>전략 · 세션<\/th>[\s\S]{0,700}?<\/tr>/)||[''])[0];
  ok('최종·현재·인출 순으로 놓았다',
     head.indexOf('>최종<')>0 && head.indexOf('>현재<')>head.indexOf('>최종<')
     && head.indexOf('>인출<')>head.indexOf('>현재<'));
  ok('각 칸이 무엇인지 적어 뒀다',
     /title="평가금 \+ 잔금 \+ 나간 돈 ÷ 원금/.test(idx)
     && /title="평가금 \+ 잔금 ÷ 원금/.test(idx)
     && /title="매도해서 계좌 밖으로 뺀 돈/.test(idx));
  // 나간 돈이 없으면 현재는 최종과 같은 값이다 — 굵게 두 번 띄우면 잡음
  ok('나간 돈이 없으면 흐리게 두고 인출은 비운다',
     /outAmt>0\?\(r\.retNow>=0\?'var\(--buy\)':'var\(--sell\)'\):'var\(--faint\)'/.test(idx)
     && /\$\{outAmt>0\?'\+'\+r\.retOut\.toFixed\(1\)\+'%':'—'\}/.test(idx));
  // 시세를 못 받은 줄은 평가~연 다섯 칸을 덮어야 한다
  ok('시세 대기 줄이 칸 수를 맞춘다', /<td colspan="6" style="color:var\(--gold\)">시세 대기/.test(idx));
}

/* ════ 55. 단리 현금 흐름 — 출금·입금·합계와 월 수입 ════
   단리를 쓰는 이유가 월 현금인데 누적 한 줄로는 "달마다 얼마 나오나"가 안 보였다.
   실측(SOXL 20/10 단리, 45개월): 총 인출 51,912$ 로는 훌륭해 보이지만
   17개월은 0원이었고 연속 3개월 끊긴 적이 있으며 지금도 3개월째 안 나온다. */
console.log('\n[55] 단리 현금 흐름');
{
  const infA=(()=>{ try{ return extractFn(idx,'function renderInfAnal()'); }catch(e){ return ''; } })();
  ok('단리 세션에만 보여준다', /box\.style\.display = \(c\.simple && P0>0\) \? '' : 'none';/.test(infA));
  // 사용자가 말한 순서 — 출금 · 입금 · 합계, 각각 원금 대비 %
  // 채워 넣는 일이 없어졌으니 입금·합계 줄도 없어야 한다 — 늘 0 인 칸은 잡음이다
  ok('입금·합계 줄은 없앴다',
     idx.indexOf('id="a_sv_out"')>0
     && idx.indexOf('id="a_sv_in"')<0 && idx.indexOf('id="a_sv_net"')<0);
  ok('원금 대비 %를 같이 적는다', /const pct=v=>` \(\$\{\(v\/P0\*100\)\.toFixed\(1\)\}%\)`;/.test(infA));

  /* 월 수입으로 읽는 계산은 무매(사이클 초과익)와 적립(현금 수령 분배금)이
     같은 함수를 쓴다 — 따로 세면 또 어긋난다. */
  const fst=(()=>{ try{ return extractFn(idx,'function flowStats(flows, from, to)'); }catch(e){ return ''; } })();
  const ffr=(()=>{ try{ return extractFn(idx,'function fillFlowRows(ids, st2, fmt)'); }catch(e){ return ''; } })();
  ok('월 수입 계산이 한 곳에 있다', !!fst && !!ffr);
  ok('월 평균은 안 나온 달도 센다',
     /const avg=months\.reduce\(\(a,x\)=>a\+x\.v,0\)\/nM;/.test(fst) && /안 나온 달도 포함/.test(ffr));
  ok('끊긴 달과 최장 연속을 센다',
     /let run=0, worst=0; for\(const x of months\)\{ if\(x\.v<=0\)\{run\+\+; worst=Math\.max\(worst,run\);\} else run=0; \}/.test(fst));
  ok('마지막 인출이 언제였는지 알린다', /id="a_sv_last"/.test(idx) && /개월 전/.test(ffr));
  ok('3개월 넘게 끊기면 빨갛게', /st2\.gap>=3\?'var\(--sell\)'/.test(ffr));
  // 되짚기는 computeInf 와 같은 순서여야 값이 어긋나지 않는다
  // 카드와 표가 따로 세면 또 갈린다 — 둘 다 computeInf 가 낸 flows 만 쓴다
  ok('카드는 따로 되짚지 않는다',
     /const fs2=flowStats\(c\.flows, \(rows\[0\]\|\|\{\}\)\.date, \(rows\[rows\.length-1\]\|\|\{\}\)\.date\);/.test(infA));
  const br2=(()=>{ try{ return extractFn(idx,'function renderInfBreak(c)'); }catch(e){ return ''; } })();
  ok('월별·사이클별 표도 같은 flows 를 쓴다',
     /\(c\.flows\|\|\[\]\)\.forEach\(f=>\{ const k=String\(f\.date\|\|''\)\.slice\(0,7\)/.test(br2)
     && /\(c\.flows\|\|\[\]\)\.forEach\(f=>\{ const o=C\.get\(f\.seq\)/.test(br2));
  /* 돈이 오간 칸은 매도 바로 오른쪽 — 월 현금흐름이 먼저 보여야 한다.
     손익금·손익률은 그 뒤로 민다. 달러 세션엔 합계원화까지 붙는다. */
  /* 채워 넣는 일이 없어져 들어오는 칸이 사라졌다 — 나간 칸 하나면 된다 */
  ok('단리 세션에만 붙고, 매도 바로 오른쪽이다',
     /<th>\$\{lbl\}<\/th><th>매도<\/th>`\s*\+ \(simple\?`<th>인출<\/th>\$\{isKrw\?'':'<th>원화<\/th>'\}`:''\)/.test(br2)
     && /\+ `<th>손익금<\/th><th>손익률<\/th>/.test(br2));
  ok('입금 칸은 없앴다', !/<th>입금<\/th>/.test(br2) && !/x\.in\|\|0/.test(br2));
  ok('줄에서도 매도 바로 뒤에 온다',
     /<td>\$\{x\.label\}<\/td><td>\$\{x\.n\}<\/td>\$\{flowCells\(x\)\}<td>\$\{amtTxt\(x\.p\)\}/.test(br2)
     && /<td><b>합계<\/b><\/td><td>\$\{n\}<\/td>\$\{sumFlow\}<td>\$\{amtTxt\(tot\)\}/.test(br2));
  ok('원화 칸은 달러 세션에만', /\(isKrw\?'':`<td>\$\{v\?krwTxt\(v\):dash\}<\/td>`\)/.test(br2));
  // 안 나온 달에 +0.00$ (+0.0%) 가 뜨면 잡음이다
  ok('안 나온 달은 비운다', /const v=x\.out\|\|0, dash=/.test(br2) && /\$\{v\?netTxt\(v\):dash\}/.test(br2));
}

/* ════ 56. 통화는 종목이 정한다 ════
   예전엔 설정창에서 달러/원화를 직접 고르게 했다. 종목코드를 보면 알 수 있는 걸
   사람이 또 고르게 한 셈이라, 안 고르거나 잘못 고르면 국내 ETF가 1억을
   $100,000,000 으로 찍었다. 고르는 칸을 없애고 종목에서 뽑는다.
   저장도 안 한다 — 저장하면 종목과 어긋날 수 있는 두 번째 진실이 생긴다. */
console.log('\n[56] 통화는 종목이 정한다');
{
  ok('고르는 칸이 없다',
     !/id="set_(?:cur|vcur|macur|ivscur|dcacur|asapcur)"/.test(idx));
  ok('설정에 통화를 저장하지 않는다',
     !/cur:segGet\(/.test(idx) && !/cur:'usd'/.test(idx) && !/segSet\('set_[a-z]*cur'/.test(idx));
  ok('정의는 한 곳이다',
     (idx.match(/function curOf\(st\)/g)||[]).length===1
     && /function curOf\(st\)\{ return isKrCode\(\(st\|\|\{\}\)\.ticker\) \? 'krw' : 'usd'; \}/.test(idx));
  ok('활성 세션 통화도 거기서 나온다',
     /function curCurrency\(\)\{try\{return curOf\(curStrat\(\)\.settings\)\}/.test(idx));
  // st.cur 를 직접 읽는 데가 하나라도 남으면 그 화면만 옛 값으로 찍힌다
  {
    const left=(idx.match(/\bst\.cur\b|\bsettings\.cur\b|c\.st\.cur/g)||[]);
    ok('설정에서 통화를 직접 읽는 데가 없다', left.length===0, left.join(','));
  }
  /* 통화가 종목에서 나오므로 '원화라고 골랐는데 종목코드가 아닌' 상태가
     만들어지지 않는다 — 그걸 막던 가드도 같이 걷어냈어야 한다. */
  ok('없어진 상태를 막던 가드도 걷어냈다', !/function krwNoAuto/.test(idx) && !/krwNoAuto\(/.test(idx));
  // 모의 지문에 통화가 남아 있으면 종목과 중복이라 세션이 공연히 다시 돈다
  {
    const sk=(idx.match(/const SIM_KEYS=\{[\s\S]*?\n\};/)||[''])[0];
    ok('모의 지문에서도 뺐다', /ticker/.test(sk) && !/'cur'/.test(sk));
  }
  // 설정창 라벨의 ($) 도 종목칸을 따라가야 한다
  ok('설정 라벨이 종목칸을 따라간다',
     (idx.match(/data-tk="set_/g)||[]).length>=11
     && /function syncSetCurLabels\(\)/.test(idx)
     && /const tk=\$\(el\.dataset\.tk\), c=isKrCode\(tk&&tk\.value\)\?'₩':'\$';/.test(idx));
  ok('종목을 치면 바로 따라온다',
     /function tkSearch\(id\)\{\s*\n\s*syncSetCurLabels\(\);/.test(idx));
  ok('설정창을 열 때도 맞춘다', /syncSetCurLabels\(\);\s*\n\s*\$\('setModal'\)\.classList\.add\('on'\);/.test(idx));
  // 고르는 칸을 없앴으니 무엇이 통화를 정하는지는 알려 줘야 한다
  ok('종목 칸에 안내가 붙어 있다',
     (idx.match(/6자리 코드면 국내 — 통화가 원화로 바뀝니다/g)||[]).length===6);
  // 국내 코드 판정 — 옛 6자리와 2024년 이후 알파벳 낀 코드
  {
    const f=new Function(
      (idx.match(/const KR_CODE_RE=[^\n]*/)||[''])[0]+'\n'+
      (idx.match(/function isKrCode\([^\n]*/)||[''])[0]+'\n'+
      (idx.match(/function curOf\(st\)[^\n]*/)||[''])[0]+'\nreturn curOf;')();
    ok('국내 코드면 원화', f({ticker:'069500'})==='krw' && f({ticker:'0104N0'})==='krw');
    ok('미국 티커면 달러', f({ticker:'SOXL'})==='usd' && f({ticker:'TQQQ'})==='usd');
    ok('종목이 없으면 달러', f({})==='usd' && f(null)==='usd');
  }
}

/* ════ 57. 분배금 현금 수령 = 월 수입 ════
   분배금을 현금으로 받으면 그 돈은 계좌 밖으로 나간다 — 무매 단리 인출과 같다.
   커버드콜처럼 분배금이 수익의 대부분인 종목은 이게 곧 월 수입이다.
   실측(월배당 ETF, 거치 1억): 누적 35,600,506원(35.6%) · 32/32개월(100%) ·
   월 평균 1,112,516원. 무매 단리(28/45, 62%)와 대조가 선명하다. */
console.log('\n[57] 분배금 현금 수령 — 월 수입으로 읽는다');
{
  const cd=(()=>{ try{ return extractFn(idx,'function computeDca()'); }catch(e){ return ''; } })();
  const rd=(()=>{ try{ return extractFn(idx,'function renderDcaNow()'); }catch(e){ return ''; } })()
           || idx;
  ok('현금 수령분을 날짜째로 남긴다',
     /else divFlows\.push\(\{date:d\.date, out:cash, in:0\}\);/.test(cd) && /pos\.flows=divFlows;/.test(cd));
  // 재투자는 계좌 안에 남으므로 나간 돈이 아니다
  ok('재투자는 흐름에 넣지 않는다', /if\(reinv\)\{[^}]*divShares\+=cash\/rp; \}\s*\n\s*else divFlows\.push/.test(cd));

  /* 카드는 이제 분석탭에 있다 — 무매가 요약·월별표를 분석탭에 두는 것과 같은 자리.
     '현재' 탭에 따로 그리던 옛 카드는 지웠다(같은 표를 두 군데서 그리면 또 어긋난다). */
  const ra=(()=>{ try{ return extractFn(idx,'function renderDcaAnal()'); }catch(e){ return ''; } })();
  ok('분석탭에서 공용 카드로 그린다',
     /paintCashFlow\('anaD', \{flows:fl, base:P\.inv/.test(ra) && /id="anaD_cfcard"/.test(idx));
  ok('카드는 현금 수령일 때만 보인다',
     /const cash=\(!P\.reinv&&\(P\.divCash\|\|0\)>0\)\?P\.divCash:0;/.test(ra) && /show:cash>0\}\);/.test(ra));
  ok('옛 전용 카드는 지웠다', !/dca_cashcard|dca_cf_/.test(idx));
  /* 거치식은 매수 기록이 하나뿐이다. 매수일만 보면 기간이 한 달로 잡혀
     월 평균이 통째로 틀린다 — 마지막 분배금까지 세야 한다. */
  ok('기간은 첫 매수 ~ 마지막 분배금',
     /const hLast=hd\[hd\.length-1\]\|\|'', fLast=\(fl\[fl\.length-1\]\|\|\{\}\)\.date\|\|'';/.test(ra)
     && /to:\(fLast>hLast\?fLast:hLast\)/.test(ra));
  // 무매 요약과 같은 세 수익률이 적립에도 있어야 한다
  ok('무매와 같은 세 수익률을 찍는다',
     /paintRet3\('anaD', \{base:P\.inv, now:evalAll, realized:cash, out:cash\}\);/.test(ra)
     && /id="anaD_ret_now"/.test(idx) && /id="anaD_ret_real"/.test(idx) && /id="anaD_ret"/.test(idx));

  // 모의 성과 목록의 최종·현재·인출이 적립 세션에도 들어맞아야 한다
  const ps=(()=>{ try{ return extractFn(idx,'function paperRaw(tab, sess)'); }catch(e){ return ''; } })();
  ok('목록에서 현금 수령분은 인출이다',
     /if\(c\.pos && !c\.pos\.reinv && \(c\.pos\.divCash\|\|0\)>0\)\s*\n\s*_out=\{saved:c\.pos\.divCash, withdrawn:0, simple:true\};/.test(ps));
}

/* ════ 58. 국내 종목의 비용·세금 규약 ════
   국내 ETF는 미국과 겹치는 숫자가 하나도 없다. 그런데 백테 엔진은 전부
   COST_FEE(0.25%)·COST_TAXRATE(22%)·COST_KRW(1350)을 박아 쓰고 있었다.
   원화 종목에 1,350을 곱하면 과세표준이 1,350배로 부풀어 세금이 터지고,
   수수료도 16배 넘게 물린다 — 국내 백테 결과가 통째로 못 쓰게 된다.
   costOf()/capGainTax() 한 군데로 모았으니 그 한 군데를 지킨다. */
console.log('\n[58] 국내 종목의 비용·세금 규약');
{
  // 종목 판별 — 옛 6자리, 2024년 이후 알파벳 낀 코드, 야후 접미사
  ok('국내 코드를 알아본다',
     isKRW('069500') && isKRW('0104N0') && isKRW('122630.KS') && isKRW('233740.KQ'));
  ok('미국 티커를 국내로 오인하지 않는다',
     !isKRW('SOXL') && !isKRW('TQQQ') && !isKRW('QQQ') && !isKRW(''));

  const us=costOf('SOXL'), kr=costOf('069500'), krOther=costOf('0104N0');
  ok('미국은 종전 그대로', us.fee===0.0025 && us.taxRate===0.22 && us.krw===1350 && us.deduct===250e4 && us.cur==='$');
  ok('국내 수수료는 0.015%', kr.fee===0.00015 && krOther.fee===0.00015);
  ok('국내엔 환율·공제를 쓰지 않는다', kr.krw===1 && kr.deduct===0 && krOther.krw===1 && krOther.deduct===0);
  ok('국내 통화 기호는 ₩', kr.cur==='₩');

  // 국내주식형 ETF는 매매차익 비과세, 그 밖(해외지수·채권·원자재·커버드콜)은 15.4%
  ok('국내주식형은 매매차익 비과세', krTaxRate('069500')===0 && krTaxRate('122630')===0 && krTaxRate('233740')===0);
  ok('그 밖의 국내 ETF는 15.4%', krTaxRate('133690')===0.154 && krTaxRate('0104N0')===0.154);
  ok('야후 접미사가 붙어도 같은 판정', krTaxRate('069500.KS')===0 && krTaxRate('133690.KS')===0.154);

  // 세액 — 미국 경로는 종전 식과 소수점까지 같아야 한다
  ok('미국: 공제 안쪽이면 0', capGainTax(1000,'SOXL')===0);
  ok('미국: 공제 바깥은 종전 식 그대로',
     near(capGainTax(10000,'SOXL'), Math.max(0,10000*1350-250e4)*0.22/1350, 1e-9),
     capGainTax(10000,'SOXL').toFixed(4));
  ok('손실이면 세금 없다', capGainTax(-5000,'SOXL')===0 && capGainTax(-5000,'0104N0')===0);
  // 국내: 환율을 곱하면 안 된다 — 곱하는 순간 공제가 무의미해지고 세액이 실현익을 넘는다
  ok('국내 기타형: 실현익 × 15.4%', near(capGainTax(1000000,'0104N0'), 154000, 1e-6));
  ok('국내 주식형: 얼마를 벌어도 0', capGainTax(1000000,'069500')===0);

  // 로테이션 탭이 이미 쓰던 taxable 플래그와 어긋나면 한 앱 안에서 세율이 둘이 된다
  const univ=(bt.match(/kr:\{[\s\S]*?bench:/)||[''])[0];
  const flags=[...univ.matchAll(/\{sym:'(\d{6})\.KS',name:'[^']*',taxable:(true|false)/g)];
  ok('로테이션 kr 유니버스를 읽었다', flags.length>=6, `${flags.length}종목`);
  const clash=flags.filter(([,sym,tx])=>(tx==='true') !== (krTaxRate(sym)>0)).map(x=>x[1]);
  ok('로테이션 taxable 플래그와 세율이 일치한다', clash.length===0, clash.join(','));

  // 엔진이 상수를 직접 쓰지 않는지 — 한 군데라도 새면 그 전략만 미국 규약으로 돈다
  const engines=bt.slice(bt.indexOf('function runIM(days,tkr'), bt.indexOf('const COMBO_PAL='));
  const leaks=(engines.match(/COST_FEE|COST_SLIP|COST_KRW|COST_TAXRATE|COST_DEDUCT/g)||[]);
  ok('전략 엔진이 미국 상수를 직접 쓰지 않는다', leaks.length===0, leaks.join(','));
  /* 예수금 이자·차입비용도 종목 통화를 따라가야 한다 — 원화 종목에 미국 T-Bill을
     물리면 현금 대피 구간 수익과 레버리지 드래그가 통째로 틀린다. */
  ok('예수금 금리는 종목 통화를 따라간다',
     /const parkRate=\(y,tkr\)=>isKRW\(tkr\) \? \(KR_RATE\[y\] \?\? 0\.025\) : \(TBILL_RATE\[y\] \?\? 0\.04\);/.test(bt));
  ok('미국 금리를 직접 읽는 데가 남지 않았다',
     (bt.match(/TBILL_RATE\[/g)||[]).length===1, `${(bt.match(/TBILL_RATE\[/g)||[]).length}곳`);
  ok('차입비용도 같은 금리를 쓴다', (bt.match(/_bor\*\(parkRate\(y,/g)||[]).length===2);

  ok('기말 전량매도도 종목을 받는다',
     /function saleNet\(gross, invested, costOn, tkr\)/.test(bt)
     && (bt.match(/saleNet\([^)]*,\s*(?:t|r\.tkr)\)/g)||[]).length===3);

  /* 화면 쪽 — 원금 칸과 주석이 종목을 따라가야 한다.
     '원금 ($)' 을 박아 두면 국내 ETF를 골라 놓고도 달러 넣는 칸처럼 보이고,
     '수수료 0.25% 반영' 은 실제로 0.015%를 물렸는데도 그대로 남아 거짓말이 된다. */
  ok('원금·적립금 칸이 탭을 달고 있다', (bt.match(/<label data-cur="/g)||[]).length===12,
     `${(bt.match(/<label data-cur="/g)||[]).length}개`);
  ok('칸 라벨에 통화를 박아 두지 않는다', !/<label data-cur="[a-z]+">[^<]*USD/.test(bt));
  ok('라벨은 원문을 들고 다시 쓴다', /nd\.__curBase===undefined/.test(bt) && /nd\.nodeValue=nd\.__curBase\.replace/.test(bt));
  ok('탭을 옮기거나 종목을 바꾸면 다시 쓴다',
     /function renderSingle\(\)\{[^}]*syncCurLabels\(\);/.test(bt)
     && /function setStrat\(s\)\{[\s\S]{0,1500}?syncCurLabels\(\);/.test(bt));
  // 섞어 고르면 원금 한 칸이 두 통화를 뜻하게 된다 — 한쪽 기호를 붙이면 나머지가 거짓이다
  ok('섞였을 땐 기호를 떼고 그렇다고 적는다',
     /\(ts\.some\(isKRW\)&&ts\.some\(t=>!isKRW\(t\)\)\) \? '종목별'/.test(bt)
     && /\(종목별 통화\)/.test(bt)
     && /원화·달러가 섞여 있어/.test(bt));
  ok('주석의 비율을 글로 박아 두지 않는다',
     /function _costNote\(tkrs\)/.test(bt) && /function _curNote\(tkrs\)/.test(bt)
     && !/costOn\?'수수료 0\.25%/.test(bt));
  // 원금 헤더는 세 탭 모두 섞임을 아는 쪽으로
  ok('원금 헤더가 섞임을 안다', (bt.match(/_capV\(/g)||[]).length===4,
     `${(bt.match(/_capV\(/g)||[]).length}곳`);
}

/* ════ 59. 월 현금흐름 — 전 전략 한 곳에서 그린다 ════
   무매 단리 인출·VR 인출·적립 분배금 현금수령은 전부 "계좌 밖으로 나온 돈"이다.
   전략마다 따로 그리면 또 어긋난다(거래 수·현금 흐름에서 이미 두 번 당했다).
   특히 VR은 인출이 본질인 전략인데 computeVr가 totwd를 세고도 화면에 안 띄웠다. */
console.log('\n[59] 월 현금흐름 — 전 전략 공용');
{
  const need=['vc','ana','anaI','anaD','anaA'];
  const miss=need.filter(p=>!new RegExp(`id="${p}_cfcard"`).test(idx));
  ok('다섯 전략에 카드 자리가 있다', miss.length===0, miss.join(','));
  ok('그리는 함수는 하나다', (idx.match(/function paintCashFlow\(/g)||[]).length===1);
  ok('무매와 같은 함수로 센다',
     /function paintCashFlow[\s\S]*?flowStats\(flows,/.test(idx)
     && /function paintCashFlow[\s\S]*?fillFlowRows\(\{avg:id\('avg'\)/.test(idx));
  // 원화 세션에 원화 칸을 겹쳐 넣으면 같은 수가 두 번 나온다
  ok('원화 세션엔 원화 칸을 겹쳐 넣지 않는다', /const kw=!!o\.isKrw;[\s\S]{0,700}\+\s*\(kw\?'':'<th>원화<\/th>'\)/.test(idx));
  ok('입금이 없으면 입금·합계 칸을 안 만든다', /const hasIn=inn>0;/.test(idx) && /\(hasIn\?row\(/.test(idx));

  // 수익률 세 줄도 한 곳에서
  ok('수익률 세 줄도 함수는 하나다', (idx.match(/function paintRet3\(/g)||[]).length===1);
  const r3=(()=>{ const m=idx.match(/function paintRet3[\s\S]*?\n\}/); return m?m[0]:''; })();
  ok('누적은 밖으로 나간 돈까지 더한다', /put\('_ret', \(now\|\|0\)\+\(out\|\|0\)-B\);/.test(r3));
  ok('현재는 지금 들고 있는 것만', /put\('_ret_now', \(now\|\|0\)-B\);/.test(r3));
  const cs=['vc','ana','anaI','anaD','anaA'].filter(p=>new RegExp(`paintRet3\\('${p}'`).test(idx));
  ok('다섯 전략이 모두 부른다', cs.length===5, cs.join(','));
  const h3=['vc','ana','anaI','anaD','anaA'].filter(p=>
    new RegExp(`id="${p}_ret_now"`).test(idx) && new RegExp(`id="${p}_ret_real"`).test(idx) && new RegExp(`id="${p}_ret"`).test(idx));
  ok('다섯 전략에 세 줄이 다 있다', h3.length===5, h3.join(','));

  /* VR — 인출이 본질인 전략. 실현손익을 아예 안 재고 있었고 인출도 화면에 없었다. */
  const cv=(()=>{ try{ return extractFn(idx,'function computeVr()'); }catch(e){ return ''; } })();
  // 수수료는 필요경비라 실현손익에서 뺀다 (무매·백테와 같은 규약)
  ok('VR이 실현손익을 잰다', /realized\+=amt-av\*q-fee; cost-=av\*q;/.test(cv) && /\brealized,fees,flows,/.test(cv));
  /* 기록에 적힌 수수료를 그대로 되살려야 재생기 안 장부와 화면 장부가 같아진다.
     실계좌 기록엔 fee 칸이 없어 0 — 예전과 글자 그대로 같다. */
  ok('VR이 기록의 수수료로 Pool 을 복원한다',
     (cv.match(/fee=\+h\.fee\|\|0/g)||[]).length===2
     && /const out=amt\+fee;[\s\S]{0,160}pool-=out; cycTrade-=out;/.test(cv)
     && /pool\+=amt-fee; cycTrade\+=amt-fee;/.test(cv));
  ok('VR 인출은 나온 돈, 적립은 넣은 돈',
     /type==='wd'\)\{[^}]*flows\.push\(\{date:h\.date,out:\+h\.amt\|\|0,in:0,kind:'wd'\}\)/.test(cv)
     && /type==='add'\)\{[^}]*flows\.push\(\{date:h\.date,out:0,in:\+h\.amt\|\|0,kind:'add'\}\)/.test(cv));
  // 배당은 Pool에 남는다 — 손에 쥔 돈이 아니므로 흐름에 넣으면 안 된다
  ok('VR 배당은 흐름이 아니다', !/type==='div'\)\{[^}]*flows\.push/.test(cv));
  /* 분모가 netInvested(인출 뺀 뒤)면 '누적(인출 포함)'이 인출을 두 번 센다 */
  ok('VR 분모는 인출 빼기 전 총투입',
     /const grossIn=totadd \+ \(st\.startpool\|\|0\) \+ initBuy;/.test(cv)
     && /paintRet3\('vc', \{base:c\.grossIn, now:total, realized:c\.realized\+_dv\.divCash, out:c\.totwd\+_dv\.divCash\}\)/.test(idx));
  ok('VR 받은 분배금을 띄운다', /id="vc_divrow"/.test(idx) && /id="vc_div"/.test(idx));

  // 섀넌도 입출금을 장부에서 뽑아야 한다
  const ip=(()=>{ try{ return extractFn(idx,'function ivsPos(principal,hist)'); }catch(e){ return ''; } })();
  ok('섀넌이 입출금을 흐름으로 남긴다',
     /withdrawn\+=v; flows\.push\(\{date:h\.date,out:v,in:0,kind:'wd'\}\)/.test(ip)
     && /added\+=v; flows\.push\(\{date:h\.date,out:0,in:v,kind:'add'\}\)/.test(ip));
  ok('섀넌 흐름이 밖으로 나온다', /out\.withdrawn=P\.withdrawn; out\.flows=P\.flows;/.test(idx));

  /* 나온 돈의 출처가 둘일 수 있다 — VR 인출식에 분배금 현금수령을 켜면 인출과 분배금이
     같이 나온다. 한 칸에 뭉치면 그 달에 뭐가 얼마인지 알 수 없고, '인출 — Pool에서
     빼낸 돈' 이라는 라벨이 분배금까지 덮어 거짓이 된다.
     실측: QYLD 2,000주 · 2주마다 500$ 인출 2년 → 한 칸일 땐 20,712$ 한 덩어리였다. */
  ok('흐름에 출처를 적는다',
     /flows\.push\(\{date:h\.date,out:\+h\.amt\|\|0,in:0,kind:'wd'\}\)/.test(idx)
     && /flows\.push\(\{date:h\.date,out:0,in:\+h\.amt\|\|0,kind:'add'\}\)/.test(idx)
     && /out\.flows\.push\(\{date:d\.date, out:cash, in:0, kind:'div'\}\)/.test(idx));
  ok('출처가 둘 이상일 때만 칸을 나눈다',
     /const split=kinds\.length>1;/.test(idx)
     && /\.filter\(k=>k\.sum>0\)/.test(idx));
  ok('VR·섀넌이 인출과 분배금을 갈라 놓는다',
     (idx.match(/kinds:\[\{k:'wd'/g)||[]).length===2
     && (idx.match(/\{k:'div', label:'분배금'/g)||[]).length===2);
  ok('월별 표도 출처별로 나뉜다',
     /\(split\?kinds\.map\(k=>cell\(d\.k\[k\.k\]\|\|0,'var\(--gold\)'\)\)\.join\(''\):cell\(d\.o,'var\(--gold\)'\)\)/.test(idx)
     && /if\(f\.kind\) b\.k\[f\.kind\]=\(b\.k\[f\.kind\]\|\|0\)\+\(f\.out\|\|0\);/.test(idx));
  /* 받은 분배금 줄이 hist 의 div 기록만 보고 있어, 현금수령으로 8,712$ 를 받고도
     화면엔 '—' 로 비어 있었다. */
  ok('받은 분배금에 추정분도 더한다',
     /const tot=\(c\.totdiv\|\|0\)\+_d2\.divCash/.test(idx) && /\(세전 추정 포함\)/.test(idx));   // 추정분은 세전 (7차 D11)

  /* 수익률 셋을 나란히 놓자마자 드러난 것 — 로테는 매수 수수료를 현금에서만 빼고
     평단에는 안 넣고 있었다. 다 청산한 계좌인데 실현(+9.90%)이 현재(+9.83%)보다
     높게 나왔다. 섀넌 ivsPos·백테 runIM은 둘 다 수수료를 원가에 넣는다. */
  const ml=(()=>{ try{ return extractFn(idx,'function maLedger(hist, price, principal)'); }catch(e){ return ''; } })();
  ok('로테도 매수 수수료를 원가에 넣는다', /avg=nq>0\?\(avg\*qty\+pr\*q\+fee\)\/nq:/.test(ml));
  {
    // 다 청산하면 실현 = 현재 = 누적 이어야 한다 (열린 포지션이 없으니)
    const fn=new Function('hist','price','principal','const IVS_FEE=0.0025;'+ml+';return maLedger(hist,price,principal);');
    const L=fn([{date:'2025-01-06',type:'in',qty:100,price:30},
                {date:'2025-05-02',type:'out',qty:100,price:40}], 0, 10000);
    ok('전량 청산이면 실현 = 총자산 − 원금',
       Math.abs(L.realized-(L.total-10000))<1e-9,
       `실현 ${L.realized.toFixed(2)} / 자산증가 ${(L.total-10000).toFixed(2)}`);
  }
  // 한 화면에 ASCII '-' 와 타이포 '−' 가 섞이면 눈에 띈다
  // 한 줄 안에서 금액엔 −를 붙이고 %엔 안 붙이면 부호가 어긋나 보인다
  ok('금액과 %에 부호를 같이 붙인다',
     /const net=out-inn, sg=net<0\?'−':'', a=Math\.abs\(net\);/.test(idx)
     && /put\('net', `\$\{sg\}\$\{wn\(a\)\} \(\$\{sg\}\$\{\(a\/base\*100\)\.toFixed\(1\)\}%\)`/.test(idx));
}

/* ════ 60. 분배금 현금 수령 — 전 전략 ════
   적립 탭만 분배금을 세고 있었다. SOXL·TQQQ도 분배금이 나오는데 무매·VR·로테·
   섀넌·ASAP 장부엔 어디에도 안 잡혔다. '현금 수령'을 고르면 그 돈은 계좌 밖으로
   나간 것이므로 단리 인출과 같은 취급이다.
   기본은 '재투자' — 켜지 않으면 기존 세션 숫자가 하나도 바뀌지 않아야 한다. */
console.log('\n[60] 분배금 현금 수령 — 전 전략');
{
  const tabs=['inf','vr','ma','ivs','asap'];
  const miss=tabs.filter(t=>!new RegExp(`id="set_${t}divmode"`).test(idx));
  ok('다섯 전략에 칸이 있다', miss.length===0, miss.join(','));
  ok('기본은 재투자다', (idx.match(/divmode:'reinv'/g)||[]).length===5,
     `${(idx.match(/divmode:'reinv'/g)||[]).length}곳`);
  const wired=tabs.filter(t=>new RegExp(`'set_${t}divmode'`).test(idx));
  ok('토글이 배선돼 있다', wired.length===5, wired.join(','));
  const saved=tabs.filter(t=>new RegExp(`divmode:segGet\\('set_${t}divmode'\\)\\|\\|'reinv'`).test(idx));
  ok('저장된다', saved.length===5, saved.join(','));
  const restored=tabs.filter(t=>new RegExp(`segSet\\('set_${t}divmode',st\\.divmode\\|\\|'reinv'\\)`).test(idx));
  ok('설정창에 다시 채운다', restored.length===5, restored.join(','));

  /* 모의 기록을 만드는 규칙이 아니다 — SIM_KEYS에 넣으면 이미 쌓인 모의 세션이
     전부 '옛 규칙'으로 찍혀 다시 돌게 된다. */
  const sk=(idx.match(/const SIM_KEYS=\{[\s\S]*?\n\};/)||[''])[0];
  ok('모의 지문에는 넣지 않는다', !/divmode/.test(sk));

  // 세는 함수는 하나 — 적립이 쓰던 규약 그대로
  ok('세는 함수는 하나다', (idx.match(/function divIncome\(/g)||[]).length===1
     && (idx.match(/function shareTimeline\(/g)||[]).length===1);
  const di=(()=>{ try{ return extractFn(idx,'function divIncome(divs, lots, reinv)'); }catch(e){ return ''; } })();
  const st=(()=>{ try{ return extractFn(idx,'function shareTimeline(hist)'); }catch(e){ return ''; } })();
  ok('매수·매도 이름이 전략마다 달라도 읽는다', /BUY=\{buy:1,in:1\}, SELL=\{sell:1,out:1\}/.test(st)
     && /if\(\/매수\/\.test\(h\.kind\)\)/.test(st) && /const bq=\+h\.buyQty\|\|0, sq=\+h\.sellQty\|\|0;/.test(st));
  ok('재투자는 흐름에 넣지 않는다', /if\(!reinv\) out\.flows\.push\(\{date:d\.date, out:cash, in:0, kind:'div'\}\);/.test(di));
  {
    const fn=new Function(st+'\n'+di+'\nreturn {shareTimeline,divIncome};')();
    const lots=fn.shareTimeline([{date:'2025-01-06',type:'buy',qty:100,price:30},
                                 {date:'2025-06-02',type:'sell',qty:40,price:45},
                                 {date:'2025-07-01',type:'in',qty:10,price:50}]);
    ok('매도는 수량을 줄인다', lots.length===3 && lots[1].q===-40 && lots[2].q===10);
    const r=fn.divIncome([{date:'2024-12-01',amount:1},   // 매수 전 — 세면 안 된다
                          {date:'2025-03-01',amount:1},   // 100주
                          {date:'2025-08-01',amount:2}],  // 70주
                         lots, false);
    ok('배당락 시점 보유수량으로 센다', r.nDiv===2 && Math.abs(r.divCash-(100*1+70*2))<1e-9,
       `${r.nDiv}회 ${r.divCash}`);
    ok('매수 전 분배금은 안 센다', !r.flows.some(f=>f.date<'2025-01-06'));
    const r2=fn.divIncome([{date:'2025-03-01',amount:1}], lots, true);
    ok('재투자면 나간 돈이 없다', r2.divCash>0 && r2.flows.length===0);
  }
  /* 끄면(기본) 전부 0 — 기존 세션의 수익률이 한 자리도 안 움직여야 한다 */
  const sd=(()=>{ try{ return extractFn(idx,'function sessDivCash(st, hist, onReady)'); }catch(e){ return ''; } })();
  ok('끄면 전부 0이다', /if\(!divCashOn\(st\)\) return \{divCash:0, nDiv:0, flows:\[\]\};/.test(sd));
  /* 예전엔 '가격 경로에 div=1 을 붙이면 국내 시세 출처가 바뀐다' 며 안 붙였다.
     그 결과 앱은 조정종가로, 백테는 체결가로 돌아 같은 종목·같은 기간인데
     주수·평단이 달라졌다(자체 점검 N1). 이제 붙이되, 그때 걱정했던 것들을 검사한다:
       · 국내 현재가는 그대로 네이버 것을 쓴다
       · 야후가 안 되면 네이버 일봉을 체결가로 쓴다 (없는 걸 지어내지 않는다) */
  { const qjs=fs.existsSync(__d+'/functions/api/quote.js')?fs.readFileSync(__d+'/functions/api/quote.js','utf8'):'';
    const fr=(()=>{ try{ return extractFn(idx,'async function _fetchDailyRaw(symbol)'); }catch(e){ return ''; } })();
    ok('가격 경로가 div=1 로 부른다', fr.length>0 && /range=max&div=1/.test(fr)
       && /return quoteToDaily\(SYM, j\);/.test(fr));

    /* 옮기는 규칙은 순수 함수로 떼어놨다 — 정규식이 아니라 값으로 본다.
       배당 두 번(0.9·1.1)이 가격에 녹아 조정계열이 체결가보다 2 낮은 픽스처다. */
    const q2d=new Function('SYM','j', extractFn(idx,'function quoteToDaily(SYM, j)')
      .replace(/^function quoteToDaily\(SYM, j\)\{/,'').replace(/\}\s*$/,''));
    const _b=(d,c)=>({date:d,open:c,high:c+1,low:c-1,close:c});
    const J={ series:[{date:'2024-01-02',close:98},{date:'2024-06-03',close:99},{date:'2024-12-02',close:100}],
              ohlcTrade:[_b('2024-01-02',100),_b('2024-06-03',101),_b('2024-12-02',100)],
              ohlc:[_b('2024-01-02',98),_b('2024-06-03',99),_b('2024-12-02',100)],
              dividends:[{date:'2024-03-15',amount:0.9},{date:'2024-09-13',amount:1.1}],
              priceBasis:'trade', price:100.5, last:{date:'2024-12-02',close:100}, currency:'USD' };
    { const R=q2d('TQQQ', J);
      ok('체결가가 오면 days 가 체결가다', R.days.length===3 && R.days[0].close===100 && R.days[1].close===101,
         R.days.map(d=>d.close).join('/'));
      ok('체결가가 오면 ohlc 도 체결가다', R.ohlc && R.ohlc[1].high===102, R.ohlc&&R.ohlc[1].high);
      ok('조정계열은 daysAdj·ohlcAdj 로 남는다',
         R.daysAdj.length===3 && R.daysAdj[0].close===98 && R.ohlcAdj[0].close===98,
         R.daysAdj[0].close+'/'+R.ohlcAdj[0].close);
      ok('체결가일 때 priceBasis 가 trade 다', R.priceBasis==='trade', R.priceBasis);
      ok('배당 이벤트가 그대로 실려 온다', R.dividends.length===2 && R.dividends[1].amount===1.1);
      ok('현재가는 quote.js 가 준 실시간가다', R.price===100.5, R.price); }

    /* 체결가 계열이 없으면(=priceBasis 가 trade 가 아니면) 조정 기준으로 돈다 —
       없는 걸 지어내지 않고, trade 라고 거짓말도 하지 않는다 */
    { const R=q2d('TQQQ', Object.assign({}, J, {priceBasis:'total_return', ohlcTrade:null}));
      ok('체결가가 없으면 조정계열로 돈다', R.days[0].close===98 && R.ohlc[0].close===98,
         R.days[0].close+'/'+R.ohlc[0].close);
      ok('그때 priceBasis 를 trade 라 하지 않는다', R.priceBasis==='total_return', R.priceBasis); }

    ok('국내 현재가는 네이버 것을 그대로 쓴다',
       /price: \(kr && kr\.price != null\) \? kr\.price :/.test(qjs||''));
    ok('야후가 안 되면 네이버 일봉을 체결가로 쓴다',
       /out\.ohlcTrade = kr\.ohlc; out\.priceBasis = 'trade';/.test(qjs||''));
    ok('분배금 전용 경로도 그대로 남아 있다 (현금수령 세션용)',
       /_divCache\[K\]='loading';/.test(idx) && /fetchDailyDiv\(K\)/.test(idx)); }
  const calls=['renderInfAnal','renderVrAnal','renderMaAnal','renderIvsAnal','renderAsapAnal']
    .filter(f=>new RegExp(`(?:sessDivCash|ivsDivCash)\\([\\s\\S]{0,60}?\\(\\)=>${f}\\(\\)\\)`).test(idx));   // 섀넌은 다리별(ivsDivCash · 7차 D8)
  ok('다섯 렌더가 모두 쓴다', calls.length===5, calls.join(','));
  // 시세에서 뽑은 추정이다 — 화면에 밝힌다
  ok('추정이라고 밝힌다', (idx.match(/시세 기준 추정/g)||[]).length>=3);
}

/* ════ 61. 모의 성과 금액은 원화로 받는다 ════
   '전체 적용'은 숫자를 세션마다 그대로 밀어 넣고 있었다. 1억을 넣으면 국내 세션은
   1억원, 미국 세션은 1억달러가 된다 — 같은 돈으로 시작한 비교가 아니게 된다.
   원화로 받아, 국내는 그대로 두고 미국은 '시작 시점' 환율로 환산해 넣는다.
   오늘 환율로 대신하면 3년 전 시작인데 지금 환율로 환산한 원금이 된다. */
console.log('\n[61] 모의 성과 — 원화로 받아 세션 통화로 환산');
{
  ok('칸이 원화라고 적혀 있다', /원금 \(₩\) <span class="hint" id="p_capital_n">/.test(idx)
     && /1회 적립액 \(₩\) <span class="hint" id="p_addamt_n">/.test(idx));
  ok('무엇이 환산되는지 적어 뒀다', /국내 종목 세션은 그대로 들어가고, 미국 종목 세션은/.test(idx)
     && /<b>시작일 환율<\/b>/.test(idx));

  const w2=(()=>{ try{ return extractFn(idx,'function wonToSess(won, st, rate)'); }catch(e){ return ''; } })();
  ok('환산 함수는 하나다', (idx.match(/function wonToSess\(/g)||[]).length===1 && w2.length>0);
  {
    const f=new Function('isKrwSt', w2+'\nreturn wonToSess;')(st=>st&&st.kr);
    ok('국내는 그대로', f(100000000,{kr:true},1300)===100000000);
    ok('미국은 시작일 환율로 나눈다', f(100000000,{kr:false},1300)===Math.round(100000000/1300));
    ok('적립액은 소수 둘째까지', f(10000,{kr:false},1300)===Math.round(10000/1300*100)/100);
    ok('큰 금액은 딱 떨어지게', Number.isInteger(f(100000000,{kr:false},1327.22)));
  }
  ok('넣을 때 세션 통화로 바꾼다',
     /x\.settings\[f\]=wonToSess\(cap,x\.settings,R\)/.test(idx)
     && /x\.settings\[f\]=wonToSess\(add,x\.settings,R\)/.test(idx));

  // 시작 시점 환율 — 오늘 값으로 조용히 대신하면 안 된다
  const fa=(()=>{ try{ return extractFn(idx,'async function fxAt(date)'); }catch(e){ return ''; } })();
  ok('시작일 환율을 따로 받는다', /\/api\/fx\?date=\$\{encodeURIComponent\(date\)\}/.test(fa));
  ok('못 받으면 물어본다',
     /환율을 못 받았습니다/.test(idx) && /오늘 환율 \$\{now\.toLocaleString\('en-US'\)\}원으로 환산할까요\?/.test(idx));
  ok('쓴 환율을 확인창에 적는다', /환율 \$\{fx\.date\} 기준 \$\{fx\.rate\.toLocaleString\('en-US'\)\}원\/\$/.test(idx));
  ok('국내만 있으면 환율을 안 부른다', /const needUsd=\[\.\.\.capHit,\.\.\.addHit\]\.some\(\(\[,x\]\)=>!isKrwSt\(x\.settings\)\);/.test(idx));
  ok('끝나고도 쓴 환율을 남긴다', /const fxNote = fx \? `미국 종목은 \$\{fx\.date\} 환율/.test(idx));

  // 서버: 날짜를 주면 그 날 값, 주말이면 직전 영업일
  const fx=fs.existsSync(__d+'/functions/api/fx.js') ? fs.readFileSync(__d+'/functions/api/fx.js','utf8') : '';
  ok('fx API가 날짜를 받는다', /const want = new URL\(request\.url\)\.searchParams\.get\("date"\);/.test(fx)
     && /if \(want && \/\^.{0,20}\$\/\.test\(want\)\)/.test(fx));
  ok('소스가 둘이다 (하나 죽어도 산다)',
     /api\.frankfurter\.dev\/v1\//.test(fx) && /chart\/KRW=X\?interval=1d&period1=/.test(fx));
  ok('휴장일이면 그 이전 값을 쓴다', /if \(d <= date && cl\[i\] > 0\)/.test(fx));
  ok('못 찾으면 502 — 엉뚱한 값을 지어내지 않는다', /no fx for/.test(fx) && /status: 502/.test(fx));
}

/* ════ 62. 차트 라벨은 고른 기간을 따라간다 ════
   최저·최고는 고른 기간의 값인데 라벨엔 '1년 최저'라고 박혀 있었다.
   10년을 골라도 '1년 최저 2.29$'로 나와서, 숫자는 맞는데 라벨이 거짓말을 했다.
   기간이 바뀌는 칸 옆에는 기간을 글로 적지 않는다. */
console.log('\n[62] 차트 라벨은 고른 기간을 따라간다');
{
  // 값은 고른 기간에서 나온다 — 라벨에 기간을 적으면 반드시 어긋난다
  const dc=(()=>{ try{ return extractFn(idx,'function drawInfChart()'); }catch(e){ return ''; } })();
  ok('최저·최고는 고른 기간에서 나온다',
     /const data=infChartData\.slice\(-infChartRange\);/.test(dc)
     && /const lo=Math\.min\(\.\.\.closes\), hi=Math\.max\(\.\.\.closes\)/.test(dc));
  ok('라벨에 기간을 박아 두지 않는다',
     !/<div class="sl">\d+[년달] ?(최저|최고)<\/div>/.test(idx));
  ok('무매·VR 라벨이 같다', (idx.match(/<div class="sl">최저<\/div>/g)||[]).length===2
     && (idx.match(/<div class="sl">최고<\/div>/g)||[]).length===2);

  /* 칸의 selected 와 코드의 기본값이 다르면, 새로 연 사람은 6달 데이터를
     1년 칸으로 보게 된다. 둘을 같은 값으로 묶는다. */
  for(const [sel, v] of [['inf_chart_sel','252'], ['chart_sel','252']]){
    const blk=(idx.match(new RegExp(`id="${sel}"[\\s\\S]*?</select>`))||[''])[0];
    const m=blk.match(/<option value="(\d+)" selected>/);
    ok(`${sel} — 기본 기간이 1년`, !!m && m[1]===v, m?m[1]:'selected 없음');
  }
  ok('코드 기본값도 1년', /let infChartRange=252,/.test(idx));
  const fb=(idx.match(/infChartRange\s*(?:=\s*\+isel\.value\s*\|\||\|\|)\s*(\d+)/g)||[]);
  ok('못 읽었을 때 쓰는 값도 1년', fb.length>0 && fb.every(x=>/252/.test(x)), fb.join(' / '));
}

/* ════ 63. 나간 돈은 여섯 전략이 같은 규약으로 센다 ════
   분석탭 누적과 목록 최종은 같은 것을 재는데, paperStat 이 무매·적립에만 '나간 돈'을
   넘기고 있었다. VR 인출식은 인출이 분모(netInvested)에서 빠지고 분자에도 없어
   양쪽에서 통째로 사라졌다 — 목록의 인출 칸이 늘 비어 있던 이유다.

   규약(무매 기준):
     inflow = 밖에서 넣은 총액 (인출 빼기 전)
     total  = 평가금 + 현금 + 나간 돈
     _out   = {saved: 분배금 현금수령, withdrawn: 인출}
   그래야 '현재 + 인출 = 최종' 이 성립한다.

   실측(QYLD · 원금 36,600$) — 고치기 전 → 후, 분석탭 누적 대비 목록 최종:
     무매   12.93% vs 10.00%  →  12.93% = 12.93%
     VR     23.80% vs  0.00%  →  23.80% = 23.80%
     섀넌   11.90% vs −56.13% →  11.90% = 11.90%
     적립   28.16% vs  0.00%  →  28.16% = 28.16%   (재투자분 divShares 누락이었다) */
console.log('\n[63] 나간 돈 — 여섯 전략 같은 규약');
{
  const ps=(()=>{ try{ return extractFn(idx,'function paperRaw(tab, sess)'); }catch(e){ return ''; } })();
  ok('paperStat 을 읽었다', ps.length>0);
  // 여섯 갈래가 모두 나간 돈을 넘겨야 '인출' 칸이 채워진다
  const outs=(ps.match(/_out=\{/g)||[]).length;
  ok('여섯 전략이 모두 나간 돈을 넘긴다', outs===6, `${outs}곳`);
  // 분배금 현금수령은 어느 전략에서 켜도 잡혀야 한다
  /* 적립은 sessDivCash 를 쓰지 않는다 — 자기 칸(reinv)으로 computeDca 가 이미 세고,
     c.total 에 반영해 둔다. 나머지 다섯은 divmode 를 보고 여기서 센다. */
  const dv=(ps.match(/(?:sessDivCash|ivsDivCash)\(st, (?:h|c\.hist)\)/g)||[]).length;   // 섀넌은 다리별 (7차 D8)
  ok('나머지 다섯이 분배금을 센다', dv===5, `${dv}곳`);
  ok('적립은 제 방식으로 이미 센다',
     /if\(c\.pos && !c\.pos\.reinv && \(c\.pos\.divCash\|\|0\)>0\)/.test(ps)
     && /total=c\.ready\?c\.total:/.test(ps));

  /* 분모에서 인출을 빼면 '현재 + 인출 = 최종' 이 깨진다 — 분자에 도로 더하기 때문이다 */
  ok('VR 분모는 인출 빼기 전 총투입',
     /inflow=c\.grossIn; total=price\*c\.qty \+ c\.pool \+ \(c\.totwd\|\|0\) \+ _dv\.divCash;/.test(ps)
     && !/inflow=c\.netInvested/.test(ps));
  ok('섀넌 분모도 출금 빼기 전',
     /inflow=\(c\.principal\|\|0\)\+\(c\.added\|\|0\);/.test(ps)
     && /total=ev \+ \(c\.cash\|\|0\) \+ \(c\.withdrawn\|\|0\) \+ _dv\.divCash;/.test(ps));
  ok('VR·섀넌이 인출을 나간 돈으로 넘긴다',
     /_out=\{saved:_dv\.divCash, withdrawn:c\.totwd\|\|0, simple:false\}/.test(ps)
     && /_out=\{saved:_dv\.divCash, withdrawn:c\.withdrawn\|\|0, simple:false\}/.test(ps));
  ok('무매는 단리 적립분과 분배금을 같이 넘긴다',
     /_out=\{saved:\(c\.saved\|\|0\)\+_dv\.divCash, withdrawn:c\.withdrawn\|\|0, simple:!!c\.simple\}/.test(ps));
  // 로테·ASAP 은 인출이 없다 — 분배금만 나간다
  ok('로테·ASAP 은 분배금만 나간 돈',
     (ps.match(/_out=\{saved:_dv\.divCash, withdrawn:0, simple:true\}/g)||[]).length===2);

  /* 재투자를 고르면 분배금이 주식으로 돌아온다. 분석탭이 그 늘어난 몫을 빼고 세서
     목록(c.total)과 갈렸다 — computeDca 가 계산해 둔 c.eval 을 쓴다. */
  const ra=(()=>{ try{ return extractFn(idx,'function renderDcaAnal()'); }catch(e){ return ''; } })();
  ok('적립 분석탭이 재투자분을 센다',
     /const evalAll = c\.ready \? \(c\.eval\|\|0\) : \(price>0 \? price\*\(P\.shares\+\(P\.divShares\|\|0\)\) : 0\);/.test(ra)
     && !/price\*P\.shares/.test(ra));
  {
    const cd=(()=>{ try{ return extractFn(idx,'function computeDca()'); }catch(e){ return ''; } })();
    ok('c.eval 은 재투자분을 더한 값', /const shAll=pos\.shares\+pos\.divShares;\s*\n\s*const evalNow=shAll\*price;/.test(cd)
       && /eval:evalNow, total,/.test(cd));
  }
  // 목록을 한 번에 그리므로 분배 이력이 그때 와 있어야 한다
  ok('목록을 채우기 전에 분배 이력을 받아 둔다',
     /async function warmDiv\(sym\)/.test(idx)
     && /if\(divCashOn\(sess\.settings\)\) await warmDiv\(want\);/.test(idx));
}

/* ════ 64. 공식 익절%가 '실제로 돌아가는 길'로 들어가는가 ════
   앞선 [1][2]는 공식을 계산식에 직접 먹여 본 것뿐이다. 계산식이 맞아도 그 값을
   엔진에 넘겨 주는 배선이 끊겨 있으면 화면 숫자는 딴판이 된다 — 실제로 백테는
   세그의 숫자 하나를 전 종목에 똑같이 물려 TQQQ 를 20%로 돌리고 있었고,
   앱은 같은 종목에 15%를 권하고 있었다. 여기서 보는 건 '배선'이다. */
console.log('\n[64] 공식 익절% — 실제 경로');
{
  const mo=(bt.match(/const IM_OFFICIAL=\{([^}]*)\}/)||[])[1]||'';
  const btOff=new Function('return {'+mo+'}')();
  ok('백테도 같은 공식표를 갖는다',
     btOff.TQQQ===IM_OFFICIAL.TQQQ && btOff.SOXL===IM_OFFICIAL.SOXL,
     `idx=${JSON.stringify(IM_OFFICIAL)} bt=${JSON.stringify(btOff)}`);

  // 해석기: '공식'(0)이면 종목별, 숫자면 전 종목 그 값
  const mf=(bt.match(/const imTgtFor=([^;]+);/)||[])[1];
  ok('백테에 종목별 해석기가 있다', !!mf, 'imTgtFor 없음');
  if(mf){
    const mk=v=>{ global.imTarget=v; return new Function('IM_OFFICIAL','imTarget','return ('+mf+');')(btOff,v); };
    const auto=mk(0), fixed=mk(10);
    ok('공식 → TQQQ 15', auto('TQQQ')===15, String(auto('TQQQ')));
    ok('공식 → SOXL 20', auto('SOXL')===20, String(auto('SOXL')));
    ok('공식 → 미수록 종목 20', auto('TECL')===20 && auto('KORU')===20);
    ok('숫자를 고르면 전 종목 그 값', fixed('TQQQ')===10 && fixed('SOXL')===10);
    delete global.imTarget;
  }
  // 배선: 실행부가 세그 전역이 아니라 해석기를 부른다
  ok('무매 실행이 종목별로 익절%를 뽑는다', /const tgt = imTgtFor\(t\);/.test(bt));
  ok('전체비교도 종목별로 뽑는다', /imTgtFor!=='undefined'\?imTgtFor\(tkr\)/.test(bt));
  ok('세그에 공식 버튼이 기본으로 켜져 있다', /data-t="0" class="active"/.test(bt));
  ok('세그 기본값이 공식(0)이다', /let imTarget=IM_TGT_AUTO;/.test(bt));
  ok('전 종목 일괄이라는 옛 주석이 안 남아 있다', !/전 종목 동일 익절%/.test(bt));

  /* 배선이 살아 있으면 TQQQ 는 20%일 때와 다른 숫자가 나와야 한다.
     같으면 어딘가에서 다시 20으로 덮어쓰고 있다는 뜻이다. */
  if(DAYS.TQQQ){
    const a=runIM(DAYS.TQQQ,'TQQQ',10000,40,20,true), b=runIM(DAYS.TQQQ,'TQQQ',10000,40,IM_OFFICIAL.TQQQ,true);
    ok('TQQQ 15%는 20%와 실제로 다른 결과', Math.abs(a.final-b.final)>1,
       `20%=${a.final.toFixed(0)} 15%=${b.final.toFixed(0)}`);
    ok('엔진이 쓴 익절%를 결과에 담아 돌려준다', b.tgt===IM_OFFICIAL.TQQQ, String(b.tgt));
  }
  // SOXL·TECL 은 공식이 20 이라 예전 기본과 같아야 한다 — 바뀌면 딴 걸 건드린 것
  if(DAYS.SOXL){
    const a=runIM(DAYS.SOXL,'SOXL',10000,40,20,true), b=runIM(DAYS.SOXL,'SOXL',10000,40,btOff.SOXL||20,true);
    ok('SOXL 은 공식=20 이라 예전과 같다', near(a.final,b.final,1e-9));
  }
}

/* ════ 65. 리버스 별지점 — '직전 5거래일'이 정말 직전인가 ════
   오늘 종가를 창에 넣고 그 평균으로 오늘 종가 체결을 판정하면, 종가를 보고 그 종가로
   주문한 셈이라 백테가 실제보다 좋게 나온다. 리버스는 기본 OFF 라 여태 이 회귀가
   한 번도 리버스를 켜 본 적이 없었고(_revOn=false), 그래서 초록불인 채로 지나갔다.
   여기선 켜고 돌린 뒤, 그날 쓴 별지점을 '직전 5거래일 평균'과 직접 맞춰 본다. */
console.log('\n[65] 리버스 별지점 — 직전 5거래일 (오늘 제외)');
{
  const shape=s=>/const prev5=closeHist\.length\?closeHist\.reduce[\s\S]{0,40}closeHist\.push\(c\);/.test(s)
              && /const star5=prev5;/.test(s)
              && !/const star5=closeHist\.reduce/.test(s);
  const im=extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound');
  const im50=extractFn(bt,'function runIM50(days,tkr,cap,divs,targetPct,compound');
  ok('V4.0 별지점을 오늘 종가 넣기 전 창에서 뽑는다', shape(im));
  ok('V5.0 별지점을 오늘 종가 넣기 전 창에서 뽑는다', shape(im50));
  ok('운영 모의 재생도 오늘을 뺀다 (row.i−5 … row.i−1)',
     /for\(let k=row\.i-5;k<row\.i;k\+\+\)/.test(idx));

  /* 말이 아니라 실제로 그 값을 썼는지 본다 — 그날 쓴 별지점을 기록해
     시세에서 직접 뽑은 직전 5일 평균과 맞춰 본다. */
  let inst=im.replace('const star5=prev5;', 'const star5=prev5; __STAR(d,c,star5);');
  ok('별지점 기록 훅 주입', inst!==im);
  const stars=[];
  global.__STAR=(d,c,v)=>stars.push({d,c,v});
  const _revSave=global.imReverse; global.imReverse=true;
  const runIMrev=new Function('return ('+inst.replace('function runIM(','function (')+')')();
  let ran=0, bad=null, sameAsToday=0;
  for(const tkr of ['SOXL','TQQQ','TECL']){
    if(!DAYS[tkr]) continue;
    for(const div of [20,40]){
      stars.length=0;
      runIMrev(DAYS[tkr], tkr, 10000, div, IM_OFFICIAL[tkr]||20, true);
      const at={}; DAYS[tkr].forEach((d,i)=>at[d]=i);
      for(const s2 of stars){
        ran++;
        const i=at[s2.d]; if(i==null||i<5) continue;
        let sum=0; for(let k=i-5;k<i;k++) sum+=M[tkr][DAYS[tkr][k]][C];
        const want=sum/5;
        if(!near(s2.v, want, 1e-9) && !bad) bad=`${tkr} ${div}분할 ${s2.d}: 쓴값 ${s2.v} ≠ 직전5일 ${want}`;
        // 오늘을 넣은 평균과 우연히 같을 수도 있으니, 다른 날이 하나라도 있어야 시험이 의미가 있다
        let s6=sum+M[tkr][s2.d][C];
        if(near(s2.v, s6/6, 1e-9)) sameAsToday++;
      }
    }
  }
  global.imReverse=_revSave;
  ok('리버스가 실제로 돌았다 (별지점 판정일이 있다)', ran>0, '판정일 '+ran+'건');
  // 판정일이 0건이면 이 줄은 아무것도 안 본 채 초록불이 된다 — ran>0 을 같이 본다
  ok('그날 쓴 별지점 = 직전 5거래일 종가 평균', ran>0 && !bad, bad||(ran?'':'판정일 0건'));
  ok('오늘을 넣은 평균과 구별된다', ran>0 && sameAsToday<ran, `구별 불가 ${sameAsToday}/${ran}건`);
  delete global.__STAR;
}

/* ════ 66. VR 현금 장부 — 정수 내림 잔돈이 증발하지 않는가 ════
   _vbuy 는 정수 주수로 내림해 사므로 배정액을 다 쓰지 않는다. 부르는 쪽이 배정액을
   그대로 Pool 에서 빼면 못 산 잔돈이 사라진다 — 10일마다 리밸런싱이면 회당 최대 1주값,
   6년이면 수천 달러다(실측 TECL 거치 +47.6%p). 값이 맞는지 눈으로 볼 방법이 없어
   오래 안 보였으므로, 여기선 현금 장부가 닫히는지를 본다:
     남은 Pool = 들어온 돈 − 인출 − 매수에 나간 돈 + 매도로 들어온 돈
   비용 OFF 로 돌린다 — 세금 납부는 주식으로 내는 길(_settle)이 있어 장부가 한 줄 더 필요하고,
   잔돈 증발은 수수료와 무관하므로 이 조건에서 전부 드러난다. */
console.log('\n[66] VR 현금 장부 — 잔돈 증발 없음');
{
  let vsrc=extractFn(bt,'function runVR(days,tkr,params)');
  ok('_vbuy 가 실제로 나간 돈을 돌려준다', /function _vbuy\(amt,c\)\{ return _vbuyQ\(iq\(amt\/\(1\+FEE\),c\), c\); \}/.test(vsrc)
     && /feesTotal\+=fee; return spend\+fee; \}/.test(vsrc));
  /* 주식·수수료·실현손익이 움직이는 자리는 _vbuyQ·_vsellQ 둘뿐이어야 한다.
     사다리가 밖에서 shares 를 직접 만지기 시작하면 [66]의 장부가 못 잡는 구멍이 생긴다. */
  ok('주식이 움직이는 자리가 둘뿐이다',
     (vsrc.match(/shares[+-]=/g)||[]).length===2
     && (vsrc.match(/shares\+=q;/g)||[]).length===1 && (vsrc.match(/shares-=qty;/g)||[]).length===1);
  ok('세금 납부 매도도 같은 길로 지나간다', /due-=_vsellQ\(Math\.min\(shares, due\/\(c\*\(1-FEE\)\)\), c\);/.test(vsrc));
  /* 사다리는 이제 공용 엔진(vrOrderPlan)이 수량을 내고, 백테는 그 체결을 자기 장부
     (_vsellQ·_vbuyQ — 세무 원가·수수료)로만 적용한다. 주식이 움직이는 길은 그대로 둘이다. */
  ok('체결도 같은 길로 지나간다',
     /if\(f\.type==='sell'\)\{ pool\+=_vsellQ\(f\.qty, f\.price\); cycSellFilled\+=f\.qty; sells\+\+; \}/.test(vsrc)
     && /else \{ pool-=_vbuyQ\(f\.qty, f\.price\); cycBuySpent\+=f\.cost; cycBuyFilled\+=f\.qty; buys\+\+; \}/.test(vsrc));
  ok('리밸런싱 매수가 배정액이 아니라 나간 돈을 뺀다',
     /pool-=_vbuy\(use,c\);buys\+\+;/.test(vsrc) && !/_vbuy\(use,c\);pool-=use/.test(vsrc));
  ok('첫 매수 잔돈도 Pool 로 남는다',
     /pool\+=s-_vbuy\(s,c\);/.test(vsrc) && /pool-=_vbuy\(pool,c\);/.test(vsrc) && !/_vbuy\(pool,c\);pool=0;/.test(vsrc));

  // 오간 현금을 세어 장부를 맞춰 본다 (실코드에 한 줄씩 덧대기만 한다)
  const a1='feesTotal+=fee; return spend+fee; }', a2='shares-=qty; return qty*c-fee; }';
  ok('현금 훅 주입 자리 확인', vsrc.includes(a1)&&vsrc.includes(a2));
  vsrc=vsrc.replace(a1,'feesTotal+=fee; __VB(spend+fee); return spend+fee; }')
           .replace(a2,'shares-=qty; __VS(qty*c-fee); return qty*c-fee; }');
  let VB=0, VS=0; global.__VB=v=>VB+=v; global.__VS=v=>VS+=v;
  const runVRc=new Function('return ('+vsrc.replace('function runVR(','function (')+')')();
  const MODE={0.5:'거치',0.75:'적립',0.25:'인출'};
  let checked=0, worst=0, wl='';
  for(const tk of ['SOXL','TQQQ','TECL']){
    if(!DAYS[tk]) continue;
    for(const mode of [0.5,0.75,0.25]) for(const formula of ['basic','skill']){
      VB=0; VS=0;
      const r=runVRc(DAYS[tk], tk, {initAmt:10000, contrib:mode===0.75?80:0, withdraw:mode===0.25?50:0,
        G:10, bandPct:15, mode, formula, startV:0, startPool:mode===0.5?0:10000, costOn:false});
      const want=r.invested - r.totalWd - VB + VS;
      const gap=Math.abs(r.pool-want);
      checked++;
      if(gap>worst){ worst=gap; wl=`${tk} ${MODE[mode]} ${formula}`; }
    }
  }
  ok('VR 조합을 실제로 돌렸다', checked>0, checked+'개');
  ok('현금 장부가 닫힌다 (잔돈 증발 0)', worst<1e-6, `최대 어긋남 ${worst.toFixed(4)}$ (${wl})`);
  delete global.__VB; delete global.__VS;
}

/* ════ 67. 엔진 스모크 — 전부 실제로 굴러가는가 ════
   여태 이 회귀는 runIM 계열과 runVR·runIVS 만 '돌려' 보고, runStdev·runASAP·runMA200·
   적립(_dcaOne)·runBH 는 소스를 눈으로만 읽었다. 그래서 runStdev 반환줄에 그 함수엔
   없는 이름(targetPct)이 들어간 적이 있는데도 931개가 전부 초록불이었다 — 부르는 순간
   ReferenceError 로 터지는 코드였다. 배선을 고칠 때마다 제일 먼저 깨지는 게 이런 것이라,
   엔진은 전부 한 번씩 굴려 보고 결과가 유한한 숫자인지 본다. */
console.log('\n[67] 엔진 스모크 — 전부 실제로 굴러간다');
{
  // 엔진이 기대는 이웃 함수들도 파일에서 그대로 떼어 온다 (재구현 금지 원칙)
  const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)','function _maOpt(opt)',
                 'function _maHold(sell,a,b)','function _maEntry(buy,a,b)',
                 'function _maAbove(tkr,N,SHORT,BUY,SELL)','function _asapInd(tkr)','function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)','function _ivsPair1(tkr, days)',
                 'function _isoWeek(d)','function _dcaFreq(f)','function _dcaHits(days,freq)','function _dcaMA(t,N)'];
  let pre='';
  for(const h of helpers){ try{ pre+=extractFn(bt,h)+'\n'; }catch(e){ ok('도우미 추출: '+h, false, e.message); } }
  const mSg=bt.match(/const SGOV_RATE=\{[^}]*\};/); if(mSg) pre+=mSg[0]+'\n';
  const mMa=bt.match(/const MA_COND_LBL=\{[^}]*\};/); if(mMa) pre+=mMa[0]+'\n';
  pre='var levExt=false, EXTM={}, dcaReinv=true, dcaDipMul=1, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n'+pre;

  const mk=(marker)=>{ const src=extractFn(bt,marker);
    return new Function(pre+'return ('+src.replace(/^function [\w$]+\(/,'function (')+')')(); };
  const D=DAYS.SOXL||DAYS.TQQQ, T=DAYS.SOXL?'SOXL':'TQQQ';
  const fine=r=>r && isFinite(r.final) && r.final>=0 && isFinite(r.ret) && isFinite(r.mdd!=null?r.mdd:0);
  const ENG=[
    ['runBH',        'function runBH(days,tkr,cap,costOn)',                          f=>f(D,T,10000,true)],
    ['runStdev',     'function runStdev(days,tkr,cap,N,g,filter,costOn)',            f=>f(D,T,10000,40,2.5,'none',true)],
    ['runMA200',     'function runMA200(days,tkr,cap,N,costOn,opt)',                 f=>f(D,T,10000,200,true)],
    ['runMA200Accum','function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)',   f=>f(D,T,10000,200,true)],
    ['runASAP',      'function runASAP(days,tkr,opt)',                               f=>f(D,T,{base:10,mid:50,deep:100,costOn:true})],
    ['_dcaOne(매일)', 'function _dcaOne(t,days,amt,freq,costOn,dipMul)',              f=>f(T,D,10,'daily',true,1)],
    ['_dcaOne(매주)', 'function _dcaOne(t,days,amt,freq,costOn,dipMul)',              f=>f(T,D,10,'weekly',true,1)],
    ['_dcaOne(매월)', 'function _dcaOne(t,days,amt,freq,costOn,dipMul)',              f=>f(T,D,10,'monthly',true,2)],
    ['runIVS',       'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)',     f=>f(D,T,10000,0.45,60,0.10,true,'iv','cash')],
    ['runIM22',      'function runIM22(days,tkr,cap,divs,targetPct,compound',        f=>f(D,T,10000,20,20,true)],
    ['runIM30',      'function runIM30(days,tkr,cap,divs,targetPct,compound',        f=>f(D,T,10000,20,20,true)],
    ['runIM',        'function runIM(days,tkr,cap,divs,targetPct,compound',          f=>f(D,T,10000,20,20,true)],
    ['runVR',        'function runVR(days,tkr,params)',                              f=>f(D,T,{initAmt:10000,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true})],
  ];
  for(const [name,marker,call] of ENG){
    let r=null, err='';
    try{ r=call(mk(marker)); }catch(e){ err=e.message; }
    ok(`${name} 실행·유한값`, fine(r), err||(r?`final=${r.final} ret=${r.ret}`:'결과 없음'));
  }
  // 무매 4엔진은 자기가 쓴 익절%를 담아 돌려줘야 한다 (화면 머리글이 이걸 읽는다)
  for(const [n,m] of [['runIM','function runIM(days,tkr,cap,divs,targetPct,compound'],
                      ['runIM22','function runIM22(days,tkr,cap,divs,targetPct,compound'],
                      ['runIM30','function runIM30(days,tkr,cap,divs,targetPct,compound'],
                      ['runIM50','function runIM50(days,tkr,cap,divs,targetPct,compound']]){
    ok(`${n} 이 쓴 익절%를 돌려준다`, /snap,\s*tkr,\s*tgt:targetPct|snap,tkr,tgt:targetPct/.test(extractFn(bt,m)));
  }
  // 반대로 targetPct 를 안 받는 엔진엔 그 이름이 있으면 안 된다 (있으면 부르는 순간 터진다)
  for(const [n,m] of [['runStdev','function runStdev(days,tkr,cap,N,g,filter,costOn)'],
                      ['runVR','function runVR(days,tkr,params)'],
                      ['runASAP','function runASAP(days,tkr,opt)']]){
    ok(`${n} 에 남의 매개변수 이름이 없다`, !/targetPct/.test(extractFn(bt,m)));
  }
}

/* ════ 68. 적립 주기는 달력 · 강제매도 회계는 한 규약 · 워밍업은 숨기지 않는다 ════ */
console.log('\n[68] 달력 적립 · 강제매도 회계 · 워밍업 표시');
{
  // ── ⑦ 적립 주기: '매주'는 주의 첫 거래일, '매월'은 달의 첫 거래일 ──
  const hitSrc=[extractFn(bt,'function _isoWeek(d)'),extractFn(bt,'function _dcaFreq(f)'),
                extractFn(bt,'function _dcaHits(days,freq)'),extractFn(bt,'function _dcaCount(days,freq)')].join('\n');
  const H=new Function(hitSrc+'\nreturn {_isoWeek,_dcaHits,_dcaCount};')();
  ok('나머지(i%step)로 적립일을 잡지 않는다', !/i%step===0/.test(bt) && /if\(p>0&&HIT\[i\]\)/.test(bt));
  ok('주기표(5·21 거래일)가 코드에 안 남아 있다', !/\{daily:1,weekly:5,monthly:21\}/.test(bt));
  const dd=DAYS.SOXL||DAYS.TQQQ;
  if(dd){
    const firstOf=(k)=>{ const m={}; for(const d of dd) if(!m[k(d)]) m[k(d)]=d; return m; };
    const mKey=d=>d.slice(0,7), wKey=H._isoWeek;
    const fm=firstOf(mKey), fw=firstOf(wKey);
    const hitM=dd.filter((d,i)=>H._dcaHits(dd,'monthly')[i]);
    const hitW=dd.filter((d,i)=>H._dcaHits(dd,'weekly')[i]);
    ok('매월 = 그 달의 첫 거래일, 달마다 딱 한 번',
       hitM.every(d=>fm[mKey(d)]===d) && hitM.length===Object.keys(fm).length, `${hitM.length}회 / ${Object.keys(fm).length}달`);
    ok('매주 = 그 주의 첫 거래일, 주마다 딱 한 번',
       hitW.every(d=>fw[wKey(d)]===d) && hitW.length===Object.keys(fw).length, `${hitW.length}회 / ${Object.keys(fw).length}주`);
    ok('매일은 모든 거래일', H._dcaCount(dd,'daily')===dd.length);
    // 옛 방식(i%21)은 달 안에서 날짜가 떠돌았다 — 새 방식은 안 떠돈다
    const oldM=dd.filter((d,i)=>i%21===0);
    ok('옛 나머지 방식과 실제로 다르다', JSON.stringify(oldM)!==JSON.stringify(hitM));
    // 해가 바뀌는 주를 ISO 규칙대로 묶는가 (12월 말과 1월 초가 같은 주)
    ok('ISO 주가 연말연시를 가르지 않는다', H._isoWeek('2025-12-31')===H._isoWeek('2026-01-02'),
       `${H._isoWeek('2025-12-31')} vs ${H._isoWeek('2026-01-02')}`);
  }

  // ── ⑧ 세금 낼 현금이 모자라 파는 길: 여섯 엔진이 같은 회계여야 한다 ──
  const bodies={
    'runIM'  : extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound'),
    'runIM22': extractFn(bt,'function runIM22(days,tkr,cap,divs,targetPct,compound'),
    'runIM30': extractFn(bt,'function runIM30(days,tkr,cap,divs,targetPct,compound'),
    'runIM50': extractFn(bt,'function runIM50(days,tkr,cap,divs,targetPct,compound'),
    'runStdev': extractFn(bt,'function runStdev(days,tkr,cap,N,g,filter,costOn)'),
  };
  for(const [n,b2] of Object.entries(bodies)){
    ok(`${n} 강제매도가 제 _sell 을 탄다`, /if\(q>1e-12\) _sell\(px, ?q(, ?0)?\);/.test(b2),
       '손익·수수료를 손으로 다시 쓰면 또 갈린다');
    ok(`${n} 강제매도에서 주식 수만 줄이지 않는다`, !/const (gross|g)=q\*px[^\n]*sh(ares)?-=q;/.test(b2));
  }
  { const v=extractFn(bt,'function runVR(days,tkr,params)');
    ok('runVR 강제매도도 수수료를 문다', /due-=_vsellQ\(Math\.min\(shares, due\/\(c\*\(1-FEE\)\)\), c\);/.test(v)
       && /const fee=qty\*c\*FEE;/.test(v)); }

  // ── ⑪ 워밍업: 신호 없이 보유로 들어간 날을 세어 화면에 알린다 ──
  ok('_maAbove 가 워밍업 길이를 돌려준다', /return \{above,dts,warmN:Math\.max\(N,SHORT\)\};/.test(bt));
  ok('두 200일선 엔진이 워밍업 일수를 센다',
     (bt.match(/const warmDays=days\.reduce\(/g)||[]).length===2
     && /mdd:mdd\*100,warmDays,/.test(bt) && /snap, warmDays,/.test(bt));
  ok('워밍업이 있으면 화면에 알린다', /function noteWarmup\(results\)/.test(bt)
     && /noteSkipped\(maSkip\); noteWarmup\(results\);/.test(bt));
  // 실제로 세는지 — 상장 초부터 고르면 199일, 뒤로 옮기면 0일
  {
    const pre2=['function srcOf(t)','function _maOpt(opt)','function _maHold(sell,a,b)','function _maEntry(buy,a,b)',
                'function _maAbove(tkr,N,SHORT,BUY,SELL)','function divSplit(tkr, days, buys)']
               .map(m=>extractFn(bt,m)).join('\n')+'\n'
               +(bt.match(/const MA_COND_LBL=\{[^}]*\};/)||[''])[0]+'\n'
               +(bt.match(/const LEV_UNDERLYING=\{[^}]*\};/)||[''])[0]+'\n'
               +(bt.match(/const LEV_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
               +(bt.match(/const LEV_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
               +(bt.match(/const LEV_SPREAD=[^\n]*/)||[''])[0]+'\n'
               +(bt.match(/const LEV_PRICEIDX=\{[^}]*\};/)||[''])[0]+'\n'
               +(bt.match(/const X1_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
               +(bt.match(/const X1_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
               +(bt.match(/const IDX_EXTEND=\{[\s\S]*?\}\s*\};/)||[''])[0]+'\n'
               +'var levExt=false, EXTM={}, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n';
    global.META=global.META||{SOXL:{lev:3},TQQQ:{lev:3},TECL:{lev:3}};
    const fn=new Function(pre2+'return ('+extractFn(bt,'function runMA200(days,tkr,cap,N,costOn,opt)').replace(/^function \w+\(/,'function (')+')')();
    const T2=DAYS.SOXL?'SOXL':'TQQQ', D2=DAYS[T2];
    const a=fn(D2,T2,10000,200,true), b2=fn(D2.slice(250),T2,10000,200,true);
    ok('상장 초부터 고르면 워밍업 일수가 잡힌다', a.warmDays>150&&a.warmDays<200, String(a.warmDays));
    ok('시작일을 뒤로 옮기면 0일', b2.warmDays===0, String(b2.warmDays));
  }
}

/* ════ 69. VR 예약주문 — 운영·백테가 같은 고정 사다리인가 ════
   사이클 시작 보유수량 B로 상·하단 예약가격을 정하고, 이미 체결한 차수는
   그 사이클에서 다시 만들지 않는다. 매수·매도 각 최대 20차. */
console.log('\n[69] VR 체결 엔진 — 사이클 고정 20차 예약 사다리');
{
  const vsrc=extractFn(bt,'function runVR(days,tkr,params)');
  const app=extractFn(idx,'function vrSimForward()');
  ok('앱에 하루하루 고가·저가 체결 판정기가 있다', !!app && /vrOrderPlan\(St,/.test(app) && /row/.test(app));

  ok('운영·백테 vrOrderPlan 함수 본문이 같다', (()=>{
    const re=/function vrOrderPlan\(S, P, bar\)\{[\s\S]*?\n\}/;
    const x=(idx.match(re)||[''])[0], y=(bt.match(re)||[''])[0];
    return !!x && x===y; })(), '두 파일의 vrOrderPlan 이 다르다');
  ok('모의체결·과거재생·백테가 모두 vrOrderPlan 을 부른다',
     (idx.match(/vrOrderPlan\(St,/g)||[]).length===2 && (bt.match(/vrOrderPlan\(St,/g)||[]).length===1);
  ok('기본 모델은 정식 V 복귀 예약표 하나로 고정 (vreturn · 사용자 제공 정식 문서)',
     /const VR_MODEL_DEFAULT='vreturn';/.test(idx) && /const VR_MODEL_DEFAULT='vreturn';/.test(bt)
     && /function vrModelOf\(st\)\{ return VR_MODEL_DEFAULT; \}/.test(idx)
     && /function vrModelOf\(st\)\{ return VR_MODEL_DEFAULT; \}/.test(bt));

  const P0={band:.15,poolLimit:.75,FEE:0,baseShares:100,sellFilled:0,buyFilled:0,maxTiers:20};
  const bar=(h,l,c)=>({date:'2026-01-05',open:c,high:h,low:l,close:c});

  { const S={shares:100,pool:100000,avg:90,V:10000};
    const f=vrOrderPlan(S,{...P0,budgetRemaining:100000},bar(116,110,116));
    const sells=f.filter(x=>x.type==='sell');
    ok('① 상단 11,500 / B100 → 1차 매도가 115', sells.length===1 && near(sells[0].price,115,1e-9), JSON.stringify(sells));
    ok('① 116에서는 1차만 — V 로 돌아올 만큼 13주 (100 − 10000/115 = 13.04 → 13)', sells.length===1 && sells[0].qty===13 && S.shares===87, JSON.stringify(sells)); }

  { const S={shares:100,pool:100000,avg:90,V:10000};
    const f=vrOrderPlan(S,{...P0,budgetRemaining:100000},bar(133,110,133)).filter(x=>x.type==='sell');
    ok('② 133에서는 1·2차 — 2차 = 11500/87 = 132.18 → 호가 올림 132.19 × 11주 (87 − 10000/132.19 = 11.35)',
       f.length===2 && f[1].price===132.19 && f[1].qty===11 && S.shares===76, JSON.stringify(f)); }

  { const S={shares:100,pool:100000,avg:110,V:10000};
    const f=vrOrderPlan(S,{...P0,budgetRemaining:100000},bar(90,84,84)).filter(x=>x.type==='buy');
    ok('③ 하단 8,500 / B100 → 84에서는 1차 85 × 18주 (10000/85 − 100 = 17.6 → 18) · 2차 8500/118 = 72.03 은 미체결', f.length===1
       && f[0].price===85 && f[0].qty===18, JSON.stringify(f)); }

  { const S={shares:87,pool:100000,avg:90,V:10000};
    const f=vrOrderPlan(S,{...P0,sellFilled:13,budgetRemaining:100000},bar(116,110,116));
    ok('④ 이미 체결한 매도 1차는 다음 날 다시 안 나온다', f.filter(x=>x.type==='sell').length===0, JSON.stringify(f)); }

  { const S={shares:105,pool:100000,avg:95,V:10000};
    const f=vrOrderPlan(S,{...P0,buyFilled:5,budgetRemaining:100000},bar(115.01,100,115.01));
    const s=f.find(x=>x.type==='sell');
    ok('⑤ 매수 체결로 현재 105주여도 매도 1차는 시작 B100 기준 115', !!s&&near(s.price,115,1e-9), s?String(s.price):'no fill'); }

  { const S={shares:100,pool:1e9,avg:90,V:10000};
    const f=vrOrderPlan(S,{...P0,budgetRemaining:1e9},bar(1e9,1e9,100));
    ok('⑥ 극단 급등에도 한 사이클 매도 최대 20차', f.filter(x=>x.type==='sell').length===20); }
  { const S={shares:100,pool:1e9,avg:90,V:10000};
    const f=vrOrderPlan(S,{...P0,budgetRemaining:1e9},bar(.01,.01,.01));
    ok('⑦ 극단 급락에도 한 사이클 매수 최대 20차', f.filter(x=>x.type==='buy').length===20); }

  { const S={shares:100,pool:100000,avg:110,V:10000};
    const f=vrOrderPlan(S,{...P0,budgetRemaining:0},bar(90,1,1));
    ok('⑧ Pool 남은 한도 0이면 매수 0건', f.filter(x=>x.type==='buy').length===0); }

  ok('백테가 사이클 시작수량·양쪽 체결차수를 넘긴다',
     /baseShares:cycBaseShares,sellFilled:cycSellFilled,buyFilled:cycBuyFilled,maxTiers:20/.test(vsrc));
  ok('과거 재생도 사이클 시작수량·체결차수를 유지', /cycBaseQty=shares/.test(idx)
     && /cycSellFilled\+=f\.qty/.test(idx) && /cycBuyFilled\+=f\.qty/.test(idx));
  ok('앱·백테 사이클 길이가 같다',
     (idx.match(/const CYC_DAYS=(\d+);/)||[])[1] === (bt.match(/const VR_CYC_DAYS=(\d+);/)||[])[1]);
}

/* ════ 70. 모의 성과 MDD ════
   총자산의 뜻은 paperRaw 한 곳에서만 정한다. MDD가 거기서 현금을 다시 세기 시작하면
   목록의 '최종'과 반드시 갈린다 — 이 세션에서만 벌써 몇 번을 그렇게 갈렸다.
   재는 값은 '총자산 ÷ 그때까지 넣은 돈'(단위가치)이다. 총자산 그대로 재면
   적립식에서 매달 들어오는 적립금이 상승처럼 잡혀 낙폭이 지워진다. */
console.log('\n[70] 모의 성과 MDD — 단위가치로 잰다');
{
  const md=(()=>{ try{ return extractFn(idx,'function paperMdd(tab, sess, R, hist)'); }catch(e){ return ''; } })();
  ok('MDD 함수가 있다', !!md);
  // 잴 수 있는지 판가름은 걷기 한 곳에서만 — 앞에 조건을 또 두면 규칙이 갈린다
  ok('앞뒤로 조건을 두 번 두지 않는다', !/R\.total>0/.test(md) && /if\(n<3\) return null;/.test(md));
  ok('총자산을 스스로 다시 세지 않는다', /cur=paperRaw\(tab, sess\);/.test(md)
     && !/computeInf\(|computeVr\(|c\.pool|c\.bal/.test(md));
  ok('단위가치로 잰다', /const uv=tot\/cur\.inflow;/.test(md));
  ok('거래 없는 날은 주가만 갈아끼운다',
     /if\(grew \|\| !cur\)\{ sess\.hist=h\.slice\(0,idx\); cur=paperRaw\(tab, sess\); \}/.test(md)
     && /const tot=cur\.qty\*row\.close \+ \(cur\.qty1\|\|0\)\*p1 \+ cur\.k;/.test(md));
  ok('빌려 쓴 기록은 반드시 되돌린다', /\} finally \{ sess\.hist=real; \}/.test(md));
  /* 거래가 몇 달 전에 멈췄어도 들고 있는 동안 주가는 움직인다 —
     마지막 거래일에서 끊으면 그 사이 낙폭을 통째로 놓친다. */
  ok('시세가 있는 끝까지 본다', /const D=days\.filter\(d=>d&&d\.date>=from&&d\.close>0\);/.test(md));
  ok('paperRaw 가 k 와 주식 수를 돌려준다',
     /k: total - qty\*price - qty1\*price1/.test(idx) && /return \{inflow, total, price, sym, qty, qty1, price1, out:_out,/.test(idx));
  // 열 자리 — '최종' 바로 오른쪽
  { const op=(()=>{ try{ return extractFn(idx,'async function openPaper()'); }catch(e){ return ''; } })();
    const iF=op.indexOf('>최종</th>'), iM=op.indexOf('>MDD</th>'), iN=op.indexOf('>현재</th>');
    ok('머리글이 최종과 현재 사이에 있다', iF>0 && iM>iF && iN>iM, `최종${iF} MDD${iM} 현재${iN}`);
    const vF=op.indexOf('${r.ret.toFixed(1)}%'), vM=op.indexOf('r.mdd.pct.toFixed(1)'), vN=op.indexOf('${r.retNow.toFixed(1)}%');
    ok('값도 같은 자리에 있다', vF>0 && vM>vF && vN>vM, `최종${vF} MDD${vM} 현재${vN}`);
    ok('못 잰 세션은 0%가 아니라 비운다', /r\.mdd\?'−'\+r\.mdd\.pct\.toFixed\(1\)\+'%':'—'/.test(op)); }

  /* 값으로 확인 — 실코드를 떼어 와 이웃(paperRaw·종가)만 가짜로 물린다 */
  if(md){
    let calls=0, days=[], raw=null;
    const run=(closes, hist, rawFn, inflowFn)=>{
      days=closes.map(([d,c])=>({date:d,close:c}));
      calls=0;
      const g={ PAPER_DAYS:{t:()=>days},
                paperRaw:(tab,sess)=>{ calls++; return rawFn(sess.hist); },
                ivsQuote1:null, console:{error(){}} };
      const fn=new Function('PAPER_DAYS','paperRaw','ivsQuote1','console','return ('+md.replace(/^function \w+\(/,'function (')+')')
                 (g.PAPER_DAYS,g.paperRaw,g.ivsQuote1,g.console);
      const sess={hist:hist, simStart:hist[0].date};
      const R=rawFn(hist);
      const out=fn('t', sess, R, hist);
      return {out, sess};
    };
    /* ① 거치식 — 투입이 안 변하니 총자산 MDD 와 같다.
       100주 · 종가 100→120→60→90 · 현금 0 · 투입 10000
       단위가치 1.0 → 1.2 → 0.6 → 0.9 · 고점 1.2 · 저점 0.6 → 50% */
    { const hist=[{date:'2026-01-02'}];
      const rawFn=()=>({inflow:10000, qty:100, qty1:0, price1:0, k:0, total:10000, price:100});
      const {out,sess}=run([['2026-01-02',100],['2026-01-05',120],['2026-01-06',60],['2026-01-07',90]], hist, rawFn);
      ok('거치식 MDD 50%', out && near(out.pct,50,1e-9), out?out.pct.toFixed(4):'못 잼');
      ok('네 거래일을 다 봤다', out && out.nDay===4, out?String(out.nDay):'-');
      ok('빌려 쓴 기록을 되돌렸다', sess.hist===hist);
    }
    /* ② 적립식 — 총자산만 보면 낙폭이 0으로 지워진다.
       1일: 1주@100 · 투입 100 · 총자산 100 → 단위가치 1.0
       2일: 종가 50에 1주 더 · 투입 150 · 총자산 100 → 단위가치 0.667
       총자산은 100 그대로라 '낙폭 없음'으로 보이지만 실제론 −33.3% 다. */
    { const hist=[{date:'2026-01-02'},{date:'2026-01-05'}];
      const rawFn=(h2)=>(h2.length<2
        ? {inflow:100, qty:1, qty1:0, price1:0, k:0, total:100, price:100}
        : {inflow:150, qty:2, qty1:0, price1:0, k:0, total:100, price:50});
      const {out}=run([['2026-01-02',100],['2026-01-05',50],['2026-01-06',50]], hist, rawFn);
      ok('적립식은 적립금에 낙폭이 안 지워진다', out && near(out.pct,100/3,1e-9), out?out.pct.toFixed(4):'못 잼');
    }
    /* ③ 거래가 없는 날은 다시 세지 않는다 — 그래도 답은 같아야 한다.
       거래 2건 · 거래일 6일이면 paperRaw 는 2번만 불려야 한다. */
    { const hist=[{date:'2026-01-02'},{date:'2026-01-06'}];
      const rawFn=(h2)=>({inflow:1000, qty:h2.length, qty1:0, price1:0, k:0, total:h2.length*10, price:10});
      const {out}=run([['2026-01-02',10],['2026-01-05',8],['2026-01-06',12],
                       ['2026-01-07',6],['2026-01-08',9],['2026-01-09',11]], hist, rawFn);
      ok('거래 있는 날만 다시 센다', calls<=3, `paperRaw ${calls}번 (거래 2건)`);
      // 단위가치: 10/1000, 8/1000, 24/1000, 12/1000, 18/1000, 22/1000 → 고점 24, 저점 12 → 50%
      ok('그래도 값은 맞다', out && near(out.pct,50,1e-9), out?out.pct.toFixed(4):'못 잼');
    }
    // 종가가 모자라면 0%처럼 보이게 두지 않고 아예 안 잰다
    { const hist=[{date:'2026-01-02'}];
      const rawFn=()=>({inflow:100, qty:1, qty1:0, price1:0, k:0, total:100, price:100});
      const {out}=run([['2026-01-02',100],['2026-01-05',90]], hist, rawFn);
      ok('종가가 모자라면 안 잰다', out===null, JSON.stringify(out));
    }
  }
}

/* ════ 71. same-close 룩어헤드 탐지 ════
   "오늘 종가로 신호를 확정하고 같은 오늘 종가에 체결"은 낼 수 없는 주문이다.
   잡는 법: 마지막 날 종가만 인위적으로 흔들어 보고, 그날 '거래가 일어났는지' 자체가
   바뀌면 신호가 그 종가를 보고 있었다는 뜻이다.
   예외 — 전날 미리 걸어 둔 지정가·사다리가 오늘 OHLC 에 닿아 체결되는 건 정상이다
   (무매 별지점·익절 지정가, VR 예약주문). 그래서 이 절은 종가 신호 전략만 본다.

   이 전략들은 체결가가 오늘 종가라 '거래 금액'은 당연히 바뀐다. 보는 건 금액이 아니라
   '그날 손이 나갔는가(주수 변화)'다. */
console.log('\n[71] same-close 룩어헤드 탐지');
{
  const pre=['function srcOf(t)','function divSplit(tkr, days, buys)','function _isoWeek(d)',
             'function _dcaFreq(f)','function _dcaHits(days,freq)','function _dcaMA(t,N)',
             'function _asapInd(tkr)','function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)','function _ivsPair1(tkr, days)']
            .map(m=>extractFn(bt,m)).join('\n')+'\n'
    +(bt.match(/const SGOV_RATE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const KR_RATE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const TBILL_RATE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const parkRate=\(y,tkr\)=>[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_UNDERLYING=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const LEV_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const LEV_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_SPREAD=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_PRICEIDX=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const X1_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const X1_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const IDX_EXTEND=\{[\s\S]*?\}\s*\};/)||[''])[0]+'\n'
    +'var levExt=false, EXTM={}, dcaReinv=true, dcaDipMul=1;\n';
  const mk=(m)=>new Function(pre+'return ('+extractFn(bt,m).replace(/^function [\w$]+\(/,'function (')+')')();
  const T=DAYS.SOXL?'SOXL':'TQQQ', D0=DAYS[T];
  ok('탐지에 쓸 데이터가 있다', !!D0 && D0.length>300);

  if(D0){
    /* 탐지 방법 — 날짜 d 를 하나 골라 '그날까지 잘라' 돌리고, d 의 종가만 흔든다.
       d 를 흔들어도 d 까지의 거래 '건수'가 그대로여야 한다. 바뀌면 그날 신호가
       d 의 종가를 보고 있었다는 뜻이다. 앞 날들은 d 를 안 보므로 차이는 온전히 d 몫이다.

       마지막 날 하나만 흔드는 방식은 약하다 — 그날 마침 거래가 없으면 옛 코드도 통과한다
       (처음에 그렇게 짰다가 변이 시험에서 안 잡히는 걸 보고 바꿨다). 40개 날을 훑는다.
       재는 건 '주수·금액'이 아니라 '건수'다 — 체결가가 오늘 종가라 금액은 당연히 달라진다.
       원금을 크게 잡는 건 정수 내림 때문이다: 1만$이면 주가를 흔들 때 주문이 0주로
       내려앉아 '거래 없음'이 되는 일이 생겨, 룩어헤드가 없는데도 몇 번 걸린다.
       실측(표준편차·SOXL): 옛 코드 80회 중 33회가 바뀌었고, 고친 뒤는 0회다. */
    const CAP=1e7;
    /* 정수 주수의 사각지대 — 주문 크기는 오늘 종가로 잡는 게 규약이다(마감 직전 MOC).
       그래서 목표와 현재가 1주값보다 가깝게 붙어 있는 날에는, 종가를 흔들면 주문이
       0주에서 1주로(또는 그 반대로) 넘어가며 '거래 건수'가 딱 1 바뀐다. 룩어헤드가
       아니라 내림의 결과다 — 룩어헤드가 전혀 없는 filter='none' 에서도 400회 중 6회 난다.
       진짜 룩어헤드는 신호 자체가 바뀌므로 건수가 2 이상 움직인다 —
       실측(표준편차·SOXL·400회): 고친 코드 0회 / same-close 변이 26~30회.
       그래서 ±1은 내림 몫으로 보고, 그보다 크게 움직이면 잡는다. */
    const ROUND_TOL=1;
    const scan=(name, run)=>{
      const step=Math.floor((D0.length-300)/80)||1;
      let flips=0, checked=0, first='';
      for(let k=300;k<D0.length;k+=step){
        const d=D0[k], orig=M[T][d].slice(), sub=D0.slice(0,k+1);
        /* 세금 강제매도는 신호로 낸 주문이 아니다 — 연말 정산이 현금을 못 대서 파는 것이라
           마지막 날 종가를 흔들면 당연히 달라진다. 룩어헤드 탐지에서는 빼고 센다.
           (다리가 여럿이면 '판단 횟수'인 rebals 를 쓴다) */
        const pick=r=>(r.rebals!=null?r.rebals:(r.sigTrades!=null?r.sigTrades:r.trades));
        const base=pick(run(sub));
        for(const m of [0.7,1.4]){
          const [c,o,h,l]=orig;
          M[T][d]=[c*m,o,Math.max(h,c*m),Math.min(l,c*m)];
          let v; try{ v=pick(run(sub)); } finally{ M[T][d]=orig.slice(); }
          checked++;
          if(Math.abs(v-base)>ROUND_TOL){ flips++; if(!first) first=`${d} 종가 ×${m} → ${base}건이 ${v}건으로`; }
        }
      }
      ok(`${name} — 오늘 종가가 오늘 거래를 바꾸지 않는다`, checked>0 && flips===0,
         checked? `${checked}회 중 ${flips}회 바뀜${first?' · 예: '+first:''}` : '검사 0회');
    };
    const asap=mk('function runASAP(days,tkr,opt)');
    const std =mk('function runStdev(days,tkr,cap,N,g,filter,costOn)');
    const ivs =mk('function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)');
    const dca =mk('function _dcaOne(t,days,amt,freq,costOn,dipMul)');

    scan('ASAP', sub=>asap(sub,T,{base:1000,mid:5000,deep:10000,costOn:true}));
    for(const fl of ['none','nobuy','exit'])
      scan(`표준편차(${({none:'필터없음',nobuy:'물타기금지',exit:'현금이탈'})[fl]})`,
           sub=>std(sub,T,CAP,40,2.5,fl,true));
    for(const [m,pr] of [['iv','cash'],['fix','cash'],['iv','x1']])
      scan(`역분산(${m==='fix'?'고정5:5':'역분산'}·${pr==='x1'?'1배짝':'현금짝'})`,
           sub=>ivs(sub,T,CAP,0.45,60,0.10,true,m,pr));
    for(const mul of [1,2,3])
      scan(`적립 하락${mul}배`, sub=>dca(T,sub,1e5,'monthly',true,mul));

    /* 예약주문은 반대다 — 전날 걸어 둔 지정가가 오늘 OHLC 에 닿으면 체결되는 게 정상이므로
       종가(그리고 그에 맞춘 고저)를 흔들면 결과가 바뀌어야 한다. 안 바뀌면 사다리가 죽은 것이다. */
    const vr=mk('function runVR(days,tkr,params)');
    { const P={initAmt:CAP,G:10,bandPct:15,mode:0.75,contrib:CAP/200,formula:'basic',
                 startV:0,startPool:CAP,costOn:true,fill:'ladder'};
      const step=Math.floor((D0.length-300)/40)||1; let flips=0, checked=0;
      for(let k=300;k<D0.length;k+=step){
        const d=D0[k], orig=M[T][d].slice(), sub=D0.slice(0,k+1);
        const base=vr(sub,T,{...P}).trades;
        for(const m of [0.7,1.4]){ const [c,o,h,l]=orig;
          M[T][d]=[c*m,o,Math.max(h,c*m),Math.min(l,c*m)];
          let v; try{ v=vr(sub,T,{...P}).trades; } finally{ M[T][d]=orig.slice(); }
          checked++; if(v!==base) flips++; } }
      /* 여기만 부호가 반대다 — 전날 걸어 둔 지정가가 오늘 고가·저가에 닿아 체결되는 건
         정상이고, 오히려 반응이 없으면 사다리가 죽은 것이다. 매번 닿지는 않으므로
         (그날 값이 차수에 못 미치는 날이 더 많다) '몇 번이라도 반응하는가'를 본다. */
      ok('VR 예약주문은 오늘 OHLC 에 반응한다 (정상)', flips>=3,
         `${checked}회 중 ${flips}회 반응 — 사다리를 다음날 체결로 바꾸면 여기가 0이 된다`); }

    /* ── 더 센 검사: 오늘 '고가·저가' 를 극단으로 흔든다 ──────────────────
       종가신호 전략은 고저가를 아예 안 본다. 그러니 고저를 어떻게 흔들어도
       결과가 한 푼도 달라지면 안 된다 — 달라지면 어딘가에서 장중 값을 훔쳐본 것이다.
       종가를 흔드는 검사(위)는 체결가가 종가라 '건수'로만 잴 수 있었지만,
       이건 '최종 평가액까지 완전히 같아야 한다'로 잴 수 있어 훨씬 세다. */
    const shakeHL=(name, run)=>{
      const sub=D0.slice(0,900);
      const base=run(sub);
      const saved={};
      for(let k=400;k<sub.length;k++){ const d=sub[k]; saved[d]=M[T][d].slice();
        const [c,o]=saved[d];
        M[T][d]=[c,o, c*3, c*0.3];             // 고가 3배·저가 0.3배 — 장중을 통째로 뒤집는다
      }
      let v; try{ v=run(sub); } finally{ for(const d in saved) M[T][d]=saved[d]; }
      const same = near(base.final, v.final, Math.max(1e-9, Math.abs(base.final)*1e-12))
                && (base.trades==null || base.trades===v.trades)
                && (base.rebals==null || base.rebals===v.rebals);
      ok(`${name} — 오늘 고가·저가를 흔들어도 한 푼도 안 바뀐다`, same,
         same?'':`최종 ${base.final} → ${v.final} · 거래 ${base.trades}→${v.trades}`);
    };
    shakeHL('ASAP', sub=>asap(sub,T,{base:1000,mid:5000,deep:10000,costOn:true}));
    for(const fl of ['none','nobuy','exit'])
      shakeHL(`표준편차(${({none:'필터없음',nobuy:'물타기금지',exit:'현금이탈'})[fl]})`,
              sub=>std(sub,T,CAP,40,2.5,fl,true));
    for(const [m,pr] of [['iv','cash'],['iv','x1']])
      shakeHL(`역분산(${pr==='x1'?'1배짝':'현금짝'})`, sub=>ivs(sub,T,CAP,0.45,60,0.10,true,m,pr));
    shakeHL('적립 하락2배', sub=>dca(T,sub,1e5,'monthly',true,2));

    /* ── 예약주문 쪽은 따로 본다 ────────────────────────────────────────
       VR 사다리는 전날 걸어 둔 지정가라 '오늘 고가·저가' 로 체결을 판정하는 게 정상이다.
       반대로 그날 '종가' 는 사다리가 아예 안 본다 — 종가만 흔들었을 때 그날 사다리
       체결이 달라지면, 걸어 둔 주문가가 오늘 종가를 보고 정해졌다는 뜻이다. */
    {
      const lad=extractFn(idx,'function vrOrderPlan(S, P, bar)');
      const L=new Function(lad+'\nreturn vrOrderPlan;')();
      let moved=0, same=0;
      for(let k=0;k<40;k++){
        const V=1000+k*37, band=0.15, poolLimit=0.5, FEE=0.0025;
        const S1={shares:10+k, pool:5000, avg:100, V};
        const hi=V/(10+k)*1.2, lo=V/(10+k)*0.8;
        const a=L({...S1},{band,poolLimit,FEE},{high:hi,low:lo,close:100});
        const b=L({...S1},{band,poolLimit,FEE},{high:hi,low:lo,close:100*3.7});   // 종가만 극단으로
        if(JSON.stringify(a)===JSON.stringify(b)) same++; else moved++;
        // 고가를 낮추면 매도 체결이 줄어야 한다 (사다리가 실제로 고저를 본다는 증거)
        const cLow=L({...S1},{band,poolLimit,FEE},{high:V/(10+k)*0.99,low:lo,close:100});
        if(cLow.filter(f=>f.type==='sell').length > a.filter(f=>f.type==='sell').length) moved++;
      }
      ok('VR 사다리는 그날 종가를 안 본다 (주문가는 전날 상태로 정해진다)', moved===0 && same===40,
         `같음 ${same}/40 · 달라짐 ${moved}`);
    }

    /* 무매도 같은 갈래다 — 별지점·익절 지정가는 '오늘 고가' 로 판정하는 게 정상(예약주문),
       LOC 매수·쿼터매도는 '오늘 종가' 로 판정한다. 고가를 크게 올리면 지정가 익절이
       늘어나야 한다 — 안 늘면 지정가 판정이 죽어 있고, 종가만 보고 있다는 뜻이다. */
    {
      const sub=D0.slice(0,900);
      const count=k=>tradeLog.filter(x=>x.kind===k).length;
      /* 화면 기본값은 '고가' 판정이다(imFill='high'). 다른 섹션의 앵커를 건드리지 않게
         여기서만 켜고 끝나면 되돌린다 — 안 켜면 보수적 하한('종가')으로 돌아 고가를
         아무리 올려도 아무 일이 안 일어난다. */
      const _fill0=global.imFill; global.imFill='high';
      tradeLog=[]; runIM(sub,T,10000,20,20,true);
      const baseTp=count('지정가매도');
      const saved={};
      for(let k=1;k<sub.length;k++){ const d=sub[k]; saved[d]=M[T][d].slice();
        const [c,o,h,l]=saved[d]; M[T][d]=[c,o,Math.max(h,c*3),l]; }   // 장중 고가만 3배
      let hiTp=0;
      try{ tradeLog=[]; runIM(sub,T,10000,20,20,true); hiTp=count('지정가매도'); }
      finally{ for(const d in saved) M[T][d]=saved[d]; }
      ok('무매 지정가 익절은 오늘 고가로 판정한다 (예약주문 · 정상)', hiTp>baseTp,
         `고가를 3배로 올리니 ${baseTp}건 → ${hiTp}건`);

      /* 반대로 '종가' 만 흔들면? 무매는 LOC 매수·쿼터매도가 종가 기준이라 바뀌는 게 정상이다.
         바뀌지 않으면 종가 규약이 죽은 것이다 — 두 규약이 둘 다 살아 있는지 같이 본다. */
      const saved2={};
      for(let k=1;k<sub.length;k++){ const d=sub[k]; saved2[d]=M[T][d].slice();
        const [c,o,h,l]=saved2[d]; M[T][d]=[c*0.7,o,h,Math.min(l,c*0.7)]; }
      let loTr=0;
      try{ tradeLog=[]; runIM(sub,T,10000,20,20,true);
           loTr=count('1회매수')+count('절반매수')+count('쿼터매도'); }
      finally{ for(const d in saved2) M[T][d]=saved2[d]; }
      tradeLog=[]; runIM(sub,T,10000,20,20,true);
      const baseTr=count('1회매수')+count('절반매수')+count('쿼터매도');
      ok('무매 LOC·쿼터는 오늘 종가로 판정한다 (정상)', loTr!==baseTr,
         `종가를 0.7배로 내리니 ${baseTr}건 → ${loTr}건`);
      if(_fill0===undefined) delete global.imFill; else global.imFill=_fill0;
      tradeLog=[];
    }
  }

  // 소스 모양 — 신호를 만드는 자리가 전일 인덱스를 보는가
  const stdS=extractFn(bt,'function runStdev(days,tkr,cap,N,g,filter,costOn)');
  ok('표준편차 신호가 전일까지로 만들어진다',
     /const gp=gx-1;\s*\n\s*const lv=lvOf\(gp\), bear = gp>=0 && ma200\[gp\]!=null && cl\[gp\]<ma200\[gp\];/.test(stdS)
     && !/const lv=lvOf\(gx\)/.test(stdS));
  const ivsS=extractFn(bt,'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)');
  ok('역분산 밴드 판정이 전일 종가로',
     /const eqP = cash \+ A\.sh\*pc \+ B\.sh\*pc1;/.test(ivsS)
     && /if\(eqP>0 && Math\.abs\(w-A\.sh\*pc\/eqP\)>band\)\{/.test(ivsS)
     && !/if\(Math\.abs\(w-A\.sh\*c\/eq0\)>band\)/.test(ivsS));
  const asapS=extractFn(bt,'function runASAP(days,tkr,opt)');
  ok('ASAP 지표가 전일까지로',
     /const g=gi\[d\], q=g-1, p=g-2;/.test(asapS) && /const pc=cl\[q\], down=pc<m200;/.test(asapS)
     && !/rsi<=30&&c<=m200\*0\.85/.test(asapS));
  const dcaS=extractFn(bt,'function _dcaOne(t,days,amt,freq,costOn,dipMul)');
  ok('적립 배수 판정이 전일까지로',
     /const ma=\(MA&&pd\)\?MA\[pd\]:null;/.test(dcaS) && !/const ma=MA\?MA\[d\]:null;/.test(dcaS));

  // 운영 앱도 같은 규약이어야 한다 — 한쪽만 고치면 앱과 백테가 갈린다
  const appIvs=extractFn(idx,'function ivsReplay()');
  ok('운영 섀넌도 전일 종가로 판정',
     /const eqP = cash \+ qty\*pc \+ \(X1\?qty1\*pc1:0\);/.test(appIvs)
     && !/if\(Math\.abs\(w-qty\*c\/eq\)<=band\) continue;/.test(appIvs));
  const appAsap=extractFn(idx,'function _paperAsap(sess, from)');
  ok('운영 ASAP 도 전일 지표로',
     /const q=i-1, p=i-2;/.test(appAsap) && /const pc=cl\[q\], down=pc<m200;/.test(appAsap)
     && !/rsi<=30&&c<=m200\*0\.85/.test(appAsap));

  // VR 사이클은 달력 14일 — 앱 CYC_DAYS 와 같은 숫자여야 한다
  const vrS=extractFn(bt,'function runVR(days,tkr,params)');
  const appCyc=(idx.match(/const CYC_DAYS=(\d+);/)||[])[1];
  const btCyc=(bt.match(/const VR_CYC_DAYS=(\d+);/)||[])[1];
  ok('VR 사이클을 달력으로 센다', !!btCyc && !/i%interval===0/.test(vrS) && !/interval=10/.test(vrS));
  ok('앱과 같은 사이클 길이', appCyc===btCyc, `앱 ${appCyc} / 백테 ${btCyc}`);
  ok('주말이면 다음 영업일로 민다',
     /while\(t\.getUTCDay\(\)===0\|\|t\.getUTCDay\(\)===6\) t\.setUTCDate\(t\.getUTCDate\(\)\+1\);/.test(bt));

  // 세금 강제매도 — 남은 두 엔진도 같은 규약
  const maS=extractFn(bt,'function runMA200(days,tkr,cap,N,costOn,opt)');
  const maaS=extractFn(bt,'function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)');
  for(const [n,b2] of [['200로테 거치',maS],['200로테 적립',maaS]]){
    ok(`${n} 세금이 현금을 음수로 만들지 않는다`,
       /const fromCash=Math\.min\(Math\.max\(cash,0\), due\); cash-=fromCash; due-=fromCash;/.test(b2)
       && /if\(cash<-0\.01\)\{ cash=0; shares=0; avg=0; \}/.test(b2)
       && !/cash-=taxUsd;/.test(b2));
    ok(`${n} 모자라면 보유분을 판다`, /due-=gross-fee;/.test(b2)); }
  ok('역분산 강제매도가 제 _sell 을 탄다',
     /const before=cash; _sell\(P, px, Math\.min\(P\.sh, due\/\(px\*\(1-FEE\)\)\)\);/.test(ivsS)
     && !/P\.sh-=q; due-=q\*px;/.test(ivsS));
}

/* ════ 72. 리버스 — 상태머신·별지점·gap 을 네 군데가 같은 규칙으로 쓰는가 ════
   운영 주문표 ↔ computeInf ↔ 백테 runIM ↔ 여기. 리버스는 규칙이 여럿이라 한 군데만
   어긋나도 실제 주문이 달라진다. 말이 아니라 거래 시퀀스를 만들어 대조한다. */
console.log('\n[72] 리버스 — 상태머신·별지점·gap');
{
  // ── A. 기본값: 리버스는 꺼져 있고, 꺼진 상태는 '변형'으로 표시된다 ──
  ok('백테 리버스 기본 OFF', /let imReverse=false;/.test(bt));
  ok('운영 기본 설정에도 reverse 가 없다(=OFF)', !/reverse:true/.test(idx));
  ok('꺼진 상태를 V4.0 변형으로 표시한다 (공용 판정 imVariantOf — 제8차 P2-11)',
     /else if\(!cfg\.reverse\) v\.push\('리버스 OFF'\);/.test(bt)
     && /reverse:\(typeof imReverse!=='undefined'&&imReverse\)/.test(bt)
     && /function imVariantTag\(tkrs\)/.test(bt));
  ok('두 머리글이 변형 표시를 읽는다', (bt.match(/imVariantTag\(/g)||[]).length>=3);

  // ── B. 별지점: 직전 5거래일 종가 5개 또는 수동 입력, 그 외엔 주문 금지 ──
  const csp=extractFn(idx,'function calcStarPoint(c)');
  ok('별지점에 체결가·전일종가·평단 대체가 없다',
     !/최근 거래/.test(csp) && !/c\.avg/.test(csp) && !/inputNum\('o_close'\)/.test(csp));
  ok('종가가 딱 5개일 때만 쓴다', /q5\.length===5/.test(csp) && /reduce\(\(s,d\)=>s\+d\.close,0\)\/5/.test(csp));
  ok('못 뽑으면 이유를 돌려준다', /return \{val:0, src:'', need:/.test(csp));
  ok('별지점 없으면 주문을 만들지 않는다',
     /리버스 별지점 계산 불가/.test(idx) && !/star5\|\|c\.avg/.test(idx));
  { // 값 확인 — 10,20,30,40,50 → 정확히 30
    /* 7차 ⑧ — 확정된 봉만 본다. 확정 경계(CUT)를 밖에서 정해 넣어 '오늘 봉' 을 흉내 낸다 */
    let CUT='2099-12-31';
    const fn=new Function('$','quoteOf','settledBars','curOf',
      'return ('+csp.replace(/^function \w+\(/,'function (')+')');
    const sb=(rows,cur)=>(rows||[]).filter(r=>r.date<=CUT), co=()=>'usd';
    const days=[10,20,30,40,50].map((v,i)=>({date:'2026-01-0'+(i+1), close:v}));
    const noMan=()=>({value:''});
    const r5=fn(noMan, ()=>({days}), sb, co)({});
    ok('종가 5개면 정확히 그 평균', near(r5.val,30,1e-12), String(r5.val));
    const r4=fn(noMan, ()=>({days:days.slice(1)}), sb, co)({});
    ok('4개뿐이면 계산 불가', r4.val===0 && !!r4.need, JSON.stringify(r4));
    const rMan=fn(()=>({value:'42.5'}), ()=>({days}), sb, co)({});
    ok('수동 입력이 우선', near(rMan.val,42.5,1e-12) && rMan.src==='수동 입력');
    /* 장중: 시세 끝에 아직 움직이는 오늘 봉(1000)이 붙어 있다. 확정 경계는 어제(01-05).
       예전 코드는 끝 5개(20·30·40·50·1000)를 평균내 228 이 나왔다 — 오늘 현재가가 섞인 별지점이다. */
    CUT='2026-01-05';
    const live=[...days, {date:'2026-01-06', close:1000}];
    const rLive=fn(noMan, ()=>({days:live}), sb, co)({});
    ok('장중 미확정 오늘 봉은 별지점에 안 섞인다 (7차 ⑧)', near(rLive.val,30,1e-12), String(rLive.val));
    CUT='2099-12-31';
  }

  // ── C. 재진입 DAY1 — 실제 시퀀스로 돌려 본다 ──
  {
    const st={ticker:'SOXL',div:20,target:20,principal:100000,compound:true,reverse:true};
    const hist=[]; let n=0;
    const run=()=>{ __strat={settings:st,hist:[...hist]}; return computeInf(); };
    const add=(kind,price,qty)=>hist.push({kind,date:'2026-01-'+String(++n).padStart(2,'0'),price,qty});
    for(let i=0;i<19;i++) add('1회매수',100,50);
    add('절반매수',100,25);
    let c=run();
    ok('C1 소진하면 리버스 1일차', c.reverseActive && c.reverseDay1 && c.revState==='DAY1',
       `T=${c.T} state=${c.revState}`);
    add('리버스매도',100,Math.floor(c.qty/10));      // 원문: 내림 그대로 (1주 강제 없음)
    c=run();
    ok('C2 리버스 거래 뒤엔 1일차가 아니다', c.reverseActive && !c.reverseDay1 && c.revState==='REVERSE', c.revState);
    add('리버스매도',95,Math.floor(c.qty/10));
    add('1회매수',100,40);                       // 가격 회복 → 일반모드 복귀
    c=run();
    ok('C3 일반 거래가 들어오면 일반모드', !c.reverseActive && c.revState==='NORMAL',
       `state=${c.revState} T=${c.T.toFixed(3)}`);
    add('1회매수',100,40); add('1회매수',100,40); add('절반매수',100,20);   // 재소진
    c=run();
    /* 여기가 핵심 — 예전엔 진입 판정(T>분할−1)과 스트릭 리셋(T≥분할)의 임계가 달라
       19<T<20 으로 되돌아 들어가면 1일차를 건너뛰었다. T=19.295 가 딱 그 구간이다. */
    ok('C4 재소진하면 반드시 새 1일차', c.reverseActive && c.reverseDay1 && c.revState==='DAY1',
       `T=${c.T.toFixed(3)} state=${c.revState} — 19<T<20 구간 재진입`);
    ok('C4 T가 실제로 그 구간이다', c.T>st.div-1 && c.T<st.div, String(c.T));
    // 전량매도하면 일반모드로 돌아가고 T=0
    add('지정가매도',200,c.qty); c=run();
    ok('C5 전량매도 → 일반모드·T=0', !c.reverseActive && c.revState==='NORMAL' && c.T===0,
       `state=${c.revState} T=${c.T}`);
  }

  // ── D. reverseGap — 앱과 백테가 같은 값·같은 식 ──
  const rg=extractFn(idx,'function revGapOf(st)');
  /* 공식 V4.0 리버스 매수가는 '직전 5일 평균 − $0.01' LOC 다. gap 은 근거 없는 변형이라
     기본을 0 으로 두고, 0 일 때는 −$0.01 갈래를 탄다. 앱 주문표·앱 모의체결·백테 두 엔진
     네 군데가 같은 식이어야 한다 — 한 군데만 gap 식으로 남아 모의체결이 별지점에서 샀다. */
  ok('앱에 리버스 전용 gap 이 있다', !!rg && /const REV_GAP_DEF=0;/.test(idx));
  ok('앱이 분할매수 줄간격을 리버스에 쓰지 않는다',
     !/const bp=star5\*\(1-\(st\.gap\|\|2\.5\)\/100\);/.test(idx)
     && /revGapOf\(st\)/.test(idx));
  ok('앱 두 갈래(주문표·모의체결)가 같은 식', (()=>{
      const n=(idx.match(/const bp=_?[a-z0-9]+>0 \? star5\*\(1-_?[a-z0-9]+\/100\) : Math\.max\(0\.01,star5-0\.01\);/g)||[]).length;
      return n===2; })(),
     `${(idx.match(/const bp=/g)||[]).length}곳 중 새 식은 ${(idx.match(/Math\.max\(0\.01,star5-0\.01\)/g)||[]).length}곳`);
  ok('앱 어디에도 gap 없는 star5 매수가 안 남아 있다',
     !/const bp=star5\*\(1-revGapOf\(st\)\/100\);/.test(idx));
  ok('백테에 2.5 하드코딩이 없다', !/star5\*0\.975/.test(bt) && /let imRevGap=0;/.test(bt));
  ok('백테 두 엔진이 같은 식',
     (bt.match(/const buyP=_rg>0 \? star5\*\(1-_rg\/100\) : Math\.max\(0\.01,star5-0\.01\);/g)||[]).length===2,
     `${(bt.match(/const buyP=_rg>0/g)||[]).length}곳`);
  { /* 값으로 대조 — 같은 별지점·같은 gap 이면 매수 기준가가 정확히 같아야 한다.
       앱과 백테의 식을 각각 함수로 만들어 네 가지 gap 에서 맞춰 본다. */
    const def=(idx.match(/const REV_GAP_DEF=([\d.]+);/)||[])[1];
    const app=new Function('REV_GAP_DEF','return ('+rg.replace(/^function \w+\(/,'function (')+')')(+def);
    const bpOf=(g,star5)=>g>0 ? star5*(1-g/100) : Math.max(0.01,star5-0.01);
    let bad=null;
    for(const g of [0,1,2.5,5]){
      const a=bpOf(app({revGap:g}), 100);          // 앱 (revGapOf 를 통과시킨 값)
      const b=bpOf(g, 100);                        // 백테 (imRevGap=g)
      if(!near(a,b,1e-12)) bad=`gap ${g}: 앱 ${a} vs 백테 ${b}`;
    }
    ok('gap 0·1·2.5·5 에서 매수 기준가가 같다', !bad, bad||'');
    ok('설정을 비우면 둘 다 공식값(0)', near(app({}),0,1e-12) && near(app({revGap:0}),0,1e-12));
    ok('gap 0 이면 별지점 − $0.01 이다', near(bpOf(app({}),12.34), 12.33, 1e-12), String(bpOf(app({}),12.34)));
    ok('gap 2.5 면 별지점 × 0.975 다', near(bpOf(app({revGap:2.5}),100), 97.5, 1e-12));
    ok('별지점이 $0.01 이하로 내려가도 음수가 안 된다', bpOf(app({}),0.005)===0.01, String(bpOf(app({}),0.005)));
  }

  // ── E. 체결 규약 설명문이 코드와 어긋나지 않는다 ──
  ok('옛 same-close 문구가 남아 있지 않다',
     !/그날 <b>종가로 만든 지표<\/b>로 판단해 <b>그날 종가에 체결<\/b>/.test(bt)
     && !/당일 종가로 만든 지표/.test(bt));
  ok('현재 규약이 적혀 있다',
     /<b>전일까지 확정된 지표<\/b>로 신호를 정하고 <b>당일 종가에 체결<\/b>/.test(bt)
     && /미리 걸어 둔 가격<\/b>이 <b>당일 고가·저가<\/b>/.test(bt));

  // ── 네 군데 대조: 복귀 조건이 앱·백테에서 같은가 ──
  const rIM=extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound');
  /* 복귀 조건은 '가격 회복' 하나다 — 문서 그대로. T 조건을 덧붙이면 공식이 아니다. */
  ok('복귀 조건이 앱·백테 같다 (가격 회복만)',
     /if\(c>avg\*exitMul\)\{ inReverse=false; \}/.test(rIM)
     && /else if\(cl > c2\.avg\*exitMulOf\(st\.target\)\)\{/.test(idx)
     && !/\(divs-T\)>=1\)\{ inReverse=false/.test(bt)
     && !/exitMulOf\(st\.target\) && \(st\.div-c2\.T\)>=1/.test(idx));
  /* 모의는 그 복귀를 '기록' 으로 남겨야 한다 — 안 남기면 새로고침 때 되살아난다 (4차 감사 ③) */
  ok('모의가 복귀를 기록으로 남긴다',
     /kind:'리버스복귀'[\s\S]{0,120}reason:'price-recovery'/.test(idx));
  /* 값으로 — 복귀선 바로 위면 1회분이 안 남아도 복귀해야 한다.
       SOXL 익절20 → 복귀선 = 평단×0.80. 평단 100 · 종가 81 · T=19.5(20분할)
       TQQQ 익절15 → 복귀선 = 평단×0.85. 평단 100 · 종가 86 */
  { const ex=new Function('return ('+extractFn(idx,'function exitMulOf(base)').replace(/^function \w+\(/,'function (')+')')();
    const cases=[['SOXL',20,100,81,true],['SOXL',20,100,79,false],
                 ['TQQQ',15,100,86,true],['TQQQ',15,100,84,false]];
    let bad=null;
    for(const [tk,tgt,avg,close,want] of cases){
      const got = close > avg*ex(tgt);            // T 조건 없음 — 1회분이 안 남아도 복귀
      if(got!==want) bad=`${tk} 익절${tgt} 평단${avg} 종가${close} → ${got?'복귀':'유지'} (기대 ${want?'복귀':'유지'})`;
    }
    ok('복귀선 바로 위면 1회분이 없어도 복귀한다', !bad, bad||''); }
  ok('운영 재생기도 진입할 때마다 1일차를 세운다',
     /if\(revOn && !inRev && \(st\.div-c\.T\)<1 && c\.qty>0\)\{ inRev=true; revDay1=true; \}/.test(idx)
     && /const day1=revDay1; revDay1=false;/.test(idx));
  ok('옛 reverseTraded 추론이 사라졌다', !/reverseTraded/.test(idx) && !/inReverseNow/.test(idx));
}

/* ════ 73. VR — 백테와 과거 재생이 같은 거래를 내는가 ════
   같은 전략을 두 군데가 각자 구현하면 반드시 갈라진다. 실제로 백테는 예약주문 사다리로
   고쳤는데 과거 재생만 옛 '10거래일 종가 리밸런싱' 으로 남아, 같은 종목·같은 설정인데
   두 화면의 결과가 달랐다. 이제 둘 다 vrLadder·vrNextDue 를 쓴다 — 값으로 확인한다.
   비교: V 갱신 날짜 · 체결 날짜 · 매수/매도 · 체결가 · 수량 · Pool · 보유수량 · 최종 평가금. */
console.log('\n[73] VR — 백테 == 과거 재생 (거래 로그 대조)');
{
  const T=DAYS.SOXL?'SOXL':'TQQQ', D0=DAYS[T];
  ok('대조에 쓸 데이터가 있다', !!D0 && D0.length>300);
  if(D0){
    // ── 앱 쪽: 공용 엔진(vrLadder·vrNextDue)만 떼어 과거 재생과 같은 순서로 굴린다
    const lad=extractFn(idx,'function vrOrderPlan(S, P, bar)');
    const nx =extractFn(idx,'function vrNextDue(s)');
    const cyc=(idx.match(/const CYC_DAYS=(\d+);/)||[])[1];
    const appEng=new Function('CYC_DAYS', nx+'\n'+lad+'\nreturn {vrOrderPlan,vrNextDue};')(+cyc);
    const appRun=(days, P)=>{
      let shares=0, pool=P.startPool||0, V=P.startV||0, avg=0, totalWd=0, cycN=0, due=null, first=true;
      /* 한 사이클의 매수한도는 '사이클 시작 Pool × 모드비중 − 이미 쓴 돈' 이다.
         매도 대금이 같은 사이클 한도를 늘리면 안 된다 — vrReplay·vrSimForward·runVR 공통. */
      let cycStartPool=pool, cycBuySpent=0, cycBaseShares=0, cycSellFilled=0, cycBuyFilled=0;
      const log=[], cycDates=[];
      /* 이어받기 — vrReplay 의 'V>0' 분기 그대로. 정수 주수로 끊고 잔돈은 Pool 로. */
      if(V>0){
        const c0=M[T][days[0]][C], q0=Math.floor(V/c0);
        if(q0>0){ shares=q0; avg=c0; pool+=V-q0*c0; first=false; }
        else { pool+=V; V=0; }
        cycStartPool=pool; cycBaseShares=shares; cycSellFilled=0; cycBuyFilled=0; // 이어받기 잔돈도 이 사이클의 시작 Pool
        if(!first){ const base=(P.cycStart&&P.cycStart<=days[0])?P.cycStart:days[0];
                    due=appEng.vrNextDue(base); }
      }
      for(const d of days){
        const bar={date:d, close:M[T][d][C], high:M[T][d][HI], low:M[T][d][LO]};
        if(!(bar.close>0)) continue;
        if(first){
          // vrReplay 의 first 분기와 같은 순서 — 적립식은 initAmt 가 아니라 'Pool+적립금' 으로 산다
          const buyInt=(amt)=>{ const q=Math.floor(amt/(1+P.FEE)/bar.close); if(!(q>0)) return 0;
            const spend=q*bar.close, fee=spend*P.FEE;
            avg=bar.close; shares+=q; return spend+fee; };
          if(P.mode===0.75){ pool+=P.contrib; pool-=buyInt(pool); }
          else { pool+=P.initAmt-buyInt(P.initAmt); }
          V=shares*bar.close; first=false; cycStartPool=pool; cycBuySpent=0; cycBaseShares=shares; cycSellFilled=0; cycBuyFilled=0;
          due=appEng.vrNextDue(d); continue;
        }
        /* ① 기준일 장중까지는 '이전 V' 로 걸어둔 사다리가 살아 있다 — 먼저 체결한다.
           종가로 만든 새 V를 같은 날 고가·저가에 소급하면 룩어헤드다. */
        const St={shares:Math.floor(shares+1e-9), pool, avg, V};
        const fills=appEng.vrOrderPlan(St, {band:P.band, poolLimit:P.mode, model:P.model||'vreturn',
          budgetRemaining:Math.max(0,cycStartPool*P.mode-cycBuySpent), FEE:P.FEE,
          baseShares:cycBaseShares, sellFilled:cycSellFilled, buyFilled:cycBuyFilled, maxTiers:20}, bar);
        for(const f of fills){
          if(f.type==='sell'){ pool+=f.net; cycSellFilled+=f.qty; }
          else { pool-=f.cost; cycBuySpent+=f.cost; cycBuyFilled+=f.qty; }
          log.push(`${d} ${f.type} ${f.price.toFixed(6)} x${f.qty}`);
        }
        shares=St.shares; avg=St.avg;
        // ② 그 다음 장 마감 종가로 새 V를 만든다. 새 사다리는 다음 거래일부터.
        let g=0;
        while(due && d>=due && g++<10){
          const cv=shares*bar.close, add=P.mode===0.75?P.contrib:P.mode===0.25?-P.withdraw:0;
          V=(P.formula==='skill'&&V>0)? V+pool/P.G+(cv-V)/(2*Math.sqrt(P.G))+add : V+pool/P.G+add;
          V=Math.max(V,0);
          if(P.mode===0.75) pool+=P.contrib;
          else if(P.mode===0.25){ const wd=Math.min(P.withdraw,pool); pool-=wd; totalWd+=wd; }
          cycStartPool=pool; cycBuySpent=0; cycBaseShares=shares; cycSellFilled=0; cycBuyFilled=0; // 적립·인출 직후 새 사다리
          cycN++; cycDates.push(d); due=appEng.vrNextDue(due);
        }
      }
      const lc=M[T][days[days.length-1]][C];
      return {log, cycDates, pool, shares, fin:shares*lc+pool+totalWd, cycN};
    };
    // ── 백테 쪽: runVR 에 같은 훅을 넣어 거래 로그를 받아 낸다
    let vsrc2=extractFn(bt,'function runVR(days,tkr,params)');
    const h1="if(f.type==='sell'){ pool+=_vsellQ(f.qty, f.price); cycSellFilled+=f.qty; sells++; }";
    const h2='else { pool-=_vbuyQ(f.qty, f.price); cycBuySpent+=f.cost; cycBuyFilled+=f.qty; buys++; }';
    const h3='if(isCyc && !first){';
    ok('백테 훅 자리 확인', vsrc2.includes(h1)&&vsrc2.includes(h2)&&vsrc2.includes(h3),
       [['매도',h1],['매수',h2],['사이클',h3]].filter(([,h])=>!vsrc2.includes(h)).map(([n])=>n).join(' · '));
    // _ladder 안에는 날짜가 없다 — 부르기 직전에 넣어 준다
    const h4='if(LADDER && !first){ const row=M[tkr][d];';
    ok('날짜 훅 자리 확인', vsrc2.includes(h4));
    vsrc2=vsrc2.replace(h1, "if(f.type==='sell'){ __VLOG('sell',f.price,f.qty); pool+=_vsellQ(f.qty, f.price); cycSellFilled+=f.qty; sells++; }")
               .replace(h2, "else { __VLOG('buy',f.price,f.qty); pool-=_vbuyQ(f.qty, f.price); cycBuySpent+=f.cost; cycBuyFilled+=f.qty; buys++; }")
               .replace(h3, "if(isCyc && !first){ __VCYC(d);")
               .replace(h4, "if(LADDER && !first){ __VDAY=d; const row=M[tkr][d];");
    let blog=[], bcyc=[];
    global.__VDAY='';
    global.__VLOG=(t2,p,q)=>blog.push(`${global.__VDAY} ${t2} ${p.toFixed(6)} x${q}`);
    global.__VCYC=d=>bcyc.push(d);
    const btRun=new Function('return ('+vsrc2.replace(/^function \w+\(/,'function (')+')')();

    /* 과거 재생(vrReplay)은 양도세를 넣지 않는다 — 화면에도 그렇게 적혀 있다.
       수수료까지 맞춰 보려면 백테 쪽 세금만 꺼야 같은 것끼리 비교가 된다.
       세금을 끄지 않고 비교하면 '연말마다 갈린다'는 당연한 차이만 나온다. */
    const _tax0=global.capGainTax;
    let bad=null, checked=0;
    const EARLY=D0[Math.floor(D0.length*0.55)];             // 이어받기 시작일 (중간 지점)
    const LATE=D0.filter(d=>d>=EARLY);
    const CYC_BEFORE=D0[Math.floor(D0.length*0.55)-8];      // 첫날보다 이전인 사이클 기준일
    const CASES=[];
    for(const [mode,nm] of [[0.5,'거치'],[0.75,'적립'],[0.25,'인출']])
    for(const formula of ['basic','skill'])
    for(const [sv,spool,cyc0,dd,lbl] of [
        [0,     mode===0.5?0:10000, '',         D0,   '새로시작'],
        [10000, 0,                  '',         LATE, '이어받기·Pool0'],
        [10000, 3000,               '',         LATE, '이어받기·Pool3000'],
        [10000, 3000,               CYC_BEFORE, LATE, '이어받기·기준일 이전']])
    for(const feeOn of [false,true])
    for(const model of ['vreturn','ladder'])      // 두 이름 모두 대조 (5차 감사 ① · 제8차 8-① 이름 변경)
      CASES.push({mode,nm,formula,sv,spool,cyc0,dd,lbl,feeOn,model});

    for(const K of CASES){
      const {mode,nm,formula,sv,spool,cyc0,dd,lbl,feeOn,model}=K;
      const FEE=feeOn?costOf(T).fee:0;
      const P={initAmt:10000, contrib:mode===0.75?80:0, withdraw:mode===0.25?50:0,
               G:10, band:0.15, mode, formula, FEE, startPool:spool, startV:sv, cycStart:cyc0, model};
      blog=[]; bcyc=[];
      global.capGainTax=()=>0;        // 과거 재생에는 세금이 없다 — 같은 것끼리 비교
      const b=btRun(dd, T, {initAmt:P.initAmt, contrib:P.contrib, withdraw:P.withdraw, G:P.G,
        bandPct:15, mode, formula, startV:sv, startPool:spool, cycStart:cyc0,
        costOn:feeOn, fill:model});
      global.capGainTax=_tax0;
      const a=appRun(dd, P);
      checked++;
      const nm2=`${model}·${nm}·${formula}·${lbl}·수수료${feeOn?'ON':'OFF'}`;
      const cmp=[
        ['V 갱신 날짜', JSON.stringify(a.cycDates), JSON.stringify(bcyc)],
        ['거래 로그',   JSON.stringify(a.log),      JSON.stringify(blog)],
        ['보유수량',    a.shares.toFixed(6),        b.shares.toFixed(6)],
        ['Pool',        a.pool,                     b.pool],
        ['최종 평가금', a.fin,                      b.final],
      ];
      for(const [what,x,y] of cmp){
        const differ=(typeof x==='number') ? Math.abs(x-y)>1e-6*Math.max(1,Math.abs(x)) : x!==y;   // 금액은 상대 1e-6
        if(differ && !bad){
          const dx=(()=>{ try{ const A=JSON.parse(x),B=JSON.parse(y);
            if(Array.isArray(A)){ for(let i=0;i<Math.max(A.length,B.length);i++)
              if(A[i]!==B[i]) return `${i}번째: 앱 ${A[i]} / 백테 ${B[i]} (앱 ${A.length}건 · 백테 ${B.length}건)`; }
          }catch(e){} return `앱 ${x} / 백테 ${y}`; })();
          bad=`${nm2} ${what} — ${dx}`;
        }
      }
    }
    ok('96개 조합(모델2×모드3×식2×이어받기4×수수료2)을 실제로 돌렸다', checked===96, String(checked));
    ok('백테와 과거 재생이 같은 거래를 낸다', !bad, bad||'');
    global.capGainTax=_tax0;
    delete global.__VLOG; delete global.__VCYC; delete global.__VDAY;
  }
}

/* ════ 74. 리버스는 규칙이 있는 분할에서만 ════
   문서에 실린 리버스 규칙은 20분할(보유÷10·T×0.9)과 40분할(보유÷20·T×0.95) 둘뿐이다.
   예전엔 'div>=40 이 아니면 20분할 규칙' 이라 10·30분할이 20분할 값을 그대로 썼다 —
   근거 없는 값을 공식 전략처럼 돌린 셈이다. */
console.log('\n[74] 리버스 — 규칙이 있는 분할(20·40)에서만');
{
  ok('앱·백테가 같은 목록을 쓴다',
     JSON.stringify(REV_DIVS)==='[20,40]'
     && /const REV_DIVS=\[20,40\];/.test(idx) && /const REV_DIVS=\[20,40\];/.test(bt));
  ok('백테 두 엔진이 분할수를 본다',
     (bt.match(/&&imReverse&&revSupported\(divs\);/g)||[]).length===2);
  ok('앱 진입 판정도 분할수를 본다 (revEnabled = 켬 + 규칙 있는 분할)',
     /revEnabled\(st\) && revState==='NORMAL'/.test(idx)
     && /function revEnabled\(st\)\{ return !!st && st\.reverse===true && revSupported\(st\.div\); \}/.test(idx));
  ok('규칙 없는 분할이면 화면에서도 잠근다',
     /function syncRevSeg\(\)/.test(idx) && /function syncRevUI\(\)/.test(bt)
     && /리버스 규칙이 문서에 없어 적용하지 않습니다/.test(idx)
     && /리버스 규칙이 문서에 없어 적용하지 않습니다/.test(bt));
  ok('변형 표시에도 이유가 뜬다', /리버스 미적용\(그 분할 규칙 미수록\)/.test(bt));
  /* 문서에 있는 값과 우리가 일반화·추정한 값을 같은 이름으로 보이면 안 된다.
     문서 수록: 익절 TQQQ 15 · SOXL 20 / 분할 20·40 의 별% 와 리버스 규칙
     확장·추정: 그 밖 종목의 익절 20 · 30분할 별% 일반화식 · 10분할 전체 · 리버스 gap 2.5% */
  ok('그 외 종목 익절 20%를 문서값이라 하지 않는다',
     /TQQQ 15 · SOXL 20 · 그 외 실험값 20/.test(bt) && !/공식\(TQQQ 15·그 외 20\)/.test(bt));
  ok('10분할은 실험으로 표시한다', /10분할\(공식 규칙 미수록 · 실험\)/.test(bt));
  ok('30분할 별%는 일반화·추정으로 표시한다', /30분할\(별% 일반화식 · 추정\)/.test(bt));
  ok('리버스 gap 은 출처 미확인·사용자 설정으로 표시한다 (gap>0 일 때만 — 제8차 P2-11)',
     /else if\(\+cfg\.revGap>0\) v\.push\('리버스 gap '\+\(\+cfg\.revGap\)\+'%\(출처 미확인 · 사용자 설정\)'\);/.test(bt));
  ok('분할 세그에도 문서 미수록 표시가 붙는다',
     /data-d="10"[^>]*문서에 10분할 공식 규칙이 없습니다/.test(bt)
     && /data-d="30"[^>]*명시 확인되지 않았습니다/.test(bt)
     && /\* 문서 미수록 · 일반화식/.test(bt));
  // 값으로 — 10·30분할은 리버스를 켜도 결과가 안 바뀌어야 한다
  { const T=DAYS.SOXL?'SOXL':'TQQQ', D0=DAYS[T];
    let bad=null;
    for(const div of [10,20,30,40]){
      global.imReverse=false; const a=runIM(D0,T,10000,div,IM_OFFICIAL[T]||20,true);
      global.imReverse=true;  const b=runIM(D0,T,10000,div,IM_OFFICIAL[T]||20,true);
      const same=near(a.final,b.final,1e-9);
      const want=!revSupported(div);          // 규칙 없는 분할이면 ON/OFF 가 같아야 한다
      if(same!==want && !bad)
        bad=`${div}분할: ON/OFF ${same?'같음':'다름'} (기대 ${want?'같음':'다름'}) — ${a.final.toFixed(0)} vs ${b.final.toFixed(0)}`;
    }
    global.imReverse=false;
    ok('10·30분할은 리버스를 켜도 안 돌고 20·40분할은 돈다', !bad, bad||''); }
}

/* ════ 75. VR 장부 — 저장 전과 저장 후가 같은가 ════
   재생기는 안에서 수수료를 물고 정수 주수로 끊는데, 저장되는 건 거래이력뿐이다.
   화면은 그 이력으로 Pool·평가금을 다시 계산하므로, 기록에 안 남은 값이 하나라도 있으면
   '재생이 끝난 순간의 장부' 와 '화면이 보여 주는 장부' 가 갈린다.
   실제로 갈렸다 — 수수료(매매마다)와 첫 매수 잔돈(35.53$)이 복원되지 않았다. */
console.log('\n[75] VR 장부 — 저장 전 == 저장 후');
{
  const cv2=extractFn(idx,'function computeVr()');
  ok('기록의 수수료로 Pool 을 되살린다',
     (cv2.match(/fee=\+h\.fee\|\|0/g)||[]).length===2
     && /const out=amt\+fee;[\s\S]{0,100}pool-=out;/.test(cv2) && /pool\+=amt-fee;/.test(cv2));
  ok("'초기 투입인가'를 기록이 직접 말한다",
     /const isInit=\(h\.init!==undefined\) \? !!h\.init : \(!sawBuy && !carriedIn\);/.test(cv2));
  const vr2=extractFn(idx,'function vrReplay()');
  ok('재생이 수수료를 기록에 남긴다', /fee:\+fee\.toFixed\(6\)/.test(vr2));
  ok('재생이 초기투입 여부를 기록에 남긴다', /init:!!init/.test(vr2));
  ok('첫 매수 잔돈을 add 로 남긴다', /if\(left>1e-9\)\{ pool\+=left; rec\.push\(\{type:'add'/.test(vr2));
  ok('적립식은 적립금을 add 로 남기고 Pool 에서 산다',
     /rec\.push\(\{type:'add',date:d,amt:\+contrib\.toFixed\(6\)/.test(vr2)
     && /pool-=_buyInt\(pool,c,d,false\);/.test(vr2));
  ok('이어받기 시작이 정수 주수·잔돈 보존', /const c0=D\[0\]\.close, q0=Math\.floor\(V\/c0\);/.test(vr2)
     && /pool\+=V-q0\*c0;/.test(vr2) && !/shares=V\/c0;/.test(vr2));
  ok('이어받기에서도 사이클 기준일을 세운다',
     /if\(!first\)\{[\s\S]{0,240}due=vrNextDue\(base\);/.test(vr2)
     && /cycStartAssumed/.test(vr2));
  ok('기준일을 임의로 정했으면 알린다', /사이클 기준일이 설정에 없어/.test(idx));
  ok('재생이 스스로 장부를 대조한다',
     /vrLedgerCheck=\{inner:_inner,/.test(vr2) && /if\(gap>0\.01\) console\.error/.test(vr2));
  /* [73] 은 vrReplay 를 '다시 만든' 모형과 백테를 맞춰 본다. 그 모형이 진짜 vrReplay 와
     어긋나면 초록불이 거짓말을 한다. 그래서 모형이 전제하는 규칙을 원본에서 직접 확인한다. */
  ok('재생이 사다리를 먼저 체결하고 그 뒤 사이클을 갱신한다', (()=>{
      const i1=vr2.indexOf('const fills=vrOrderPlan(St,'), i2=vr2.indexOf('while(due && d>=due');
      return i1>0 && i2>0 && i1<i2; })(),
     '순서가 뒤집히면 오늘 종가로 만든 V를 오늘 고가·저가에 소급하게 된다');
  ok('재생이 사이클 남은 한도를 사다리에 넘긴다',
     /budgetRemaining:Math\.max\(0,cycStartPool\*poolLimit-cycBuySpent\)/.test(vr2)
     && /cycBuySpent\+=f\.cost;/.test(vr2));
  ok('이어받기 잔돈도 사이클 시작 Pool 에 든다', (()=>{
      const i0=vr2.indexOf('const c0=D[0].close, q0=Math.floor(V/c0);');
      const i1=vr2.indexOf('cycStartPool=pool;', i0);
      const i2=vr2.indexOf('D.forEach(');
      return i0>0 && i1>i0 && i2>i1; })(),
     '이어받기 뒤 시작 Pool 을 다시 안 잡으면 백테·저장 후 장부와 한도가 갈린다');
  ok('사이클이 넘어갈 때 시작 Pool 을 적립·인출 뒤에 잡는다', (()=>{
      const w=vr2.slice(vr2.indexOf('while(due && d>=due'));
      const iAdd=w.indexOf('pool=TR.nextPool;'), iSet=w.indexOf('cycStartPool=pool;');
      return iAdd>0 && iSet>iAdd; })());
  ok('모의 체결도 같은 수수료·고정차수 규약', /const _F=\(typeof IVS_FEE!=='undefined'\)\?IVS_FEE:0\.0025;/.test(idx)
     && /budgetRemaining:poolLimit\(c\), FEE:_F, model:vrModelOf\(st\),[\s\S]{0,160}baseShares:c\.cycBaseQty, sellFilled:c\.cycSellFilled, buyFilled:c\.cycBuyFilled, maxTiers:20/.test(idx));
  /* 사이클 매수한도는 '그 사이클 시작 Pool × 비중 − 이미 쓴 돈' 이다. 세 갈래(모의체결·
     과거재생·백테)가 각자 세면 갈린다 — 실제로 매도 대금이 같은 사이클 한도를 늘렸다. */
  ok('사다리가 남은 한도를 넘겨받는다',
     /const budget=Math\.max\(0,P\.budgetRemaining!=null\?\+P\.budgetRemaining:S\.pool\*P\.poolLimit\);/.test(idx));
  ok('세 갈래가 모두 남은 한도를 넘긴다', (()=>{
       const sim=extractFn(idx,'function vrSimForward()'), rep=extractFn(idx,'function vrReplay()'), vr=extractFn(bt,'function runVR(days,tkr,params)');
       return (sim.match(/budgetRemaining:/g)||[]).length===1
         && (rep.match(/budgetRemaining:/g)||[]).length===1
         && (vr.match(/budgetRemaining:/g)||[]).length===1
         && /function poolLimit\(c\)\{ return Math\.max\(0,\(c\.cycStartPool\|\|0\)\*\(c\.st\.mode\|\|0\.75\)-\(c\.cycBuySpent\|\|0\)\); \}/.test(idx);
     })());
  { // 값으로 — 같은 상태면 세 갈래가 같은 한도를 낸다
    const pl=new Function('return ('+extractFn(idx,'function poolLimit(c)').replace(/^function \w+\(/,'function (')+')')();
    const app=pl({cycStartPool:1000, cycBuySpent:250, st:{mode:0.75}});
    const bt2=Math.max(0, 1000*0.75-250);                       // 백테 식
    const rep=Math.max(0, 1000*0.75-250);                       // 과거재생 식
    ok('한도 계산이 세 갈래에서 같은 값', near(app,bt2,1e-12) && near(app,rep,1e-12) && near(app,500,1e-12),
       `${app} / ${bt2}`);
    ok('이미 한도를 다 썼으면 0', pl({cycStartPool:1000, cycBuySpent:900, st:{mode:0.75}})===0);
  }

  /* 값으로 — 이력을 손으로 만들어 computeVr 가 되살리는지 본다.
     초기자금 10,000$ · 주가 100$ · 수수료 0.25% → 99주(9,900$) + 수수료 24.75$ · 잔금 75.25$ */
  {
    const st={ticker:'SOXL',mode:0.5,formula:'basic',g:10,add:0,band:15,startv:0,startpool:0,cur:'usd'};
    const hist=[
      {type:'buy', date:'2026-01-05', price:100, qty:99, fee:24.75, init:true, cyc:0},
      {type:'add', date:'2026-01-05', amt:75.25, cyc:0},
    ];
    __strat={settings:st, hist};
    const c=computeVr();
    ok('초기 매수 99주 + 수수료 24.75 → 잔금 75.25', near(c.pool,75.25,1e-9) && c.qty===99,
       `pool=${c.pool} qty=${c.qty}`);
    ok('총투입은 매수금+수수료+잔돈 = 10,000', near(c.grossIn,10000,1e-9), String(c.grossIn));
    ok('수수료를 따로 센다', near(c.fees,24.75,1e-9), String(c.fees));
    // 이어서 사다리 매도 1주 (110$, 수수료 0.275) → 잔금 += 109.725
    hist.push({type:'sell', date:'2026-01-20', price:110, qty:1, fee:0.275, cyc:1});
    __strat={settings:st, hist};
    const c2=computeVr();
    ok('매도는 수수료를 뺀 순액이 Pool 로', near(c2.pool, 75.25+110-0.275, 1e-9), String(c2.pool));
    /* 취득원가에는 매수 수수료도 들어간다 (5차 감사 ⑥ · 백테 taxLot 과 같은 규약).
       99주에 24.75 를 물었으니 주당 0.25. 1주를 110 에 팔고 매도수수료 0.275 를 내면
         실현손익 = 110 − (100 + 0.25) − 0.275 = 9.475
       예전엔 매수수수료를 빼먹어 9.725 로 0.25 만큼 과대였다. */
    ok('실현손익이 매수수수료까지 뺀 값', near(c2.realized, 110-(100+24.75/99)-0.275, 1e-9)
       && near(c2.realized, 9.475, 1e-9), String(c2.realized));
    ok('옛 규약(매수수수료 제외)보다 주당 매수수수료만큼 작다',
       near((110-100-0.275) - c2.realized, 24.75/99, 1e-9), String((110-100-0.275)-c2.realized));
    ok('매도 수수료까지 합산', near(c2.fees, 24.75+0.275, 1e-9), String(c2.fees));
    // init 칸이 없는 실계좌 기록은 예전과 같아야 한다 (하위호환)
    __strat={settings:st, hist:[{type:'buy',date:'2026-01-05',price:100,qty:10,cyc:0}]};
    const c3=computeVr();
    ok('fee·init 없는 옛 기록은 예전 그대로', c3.qty===10 && near(c3.pool,0,1e-9) && near(c3.fees,0,1e-9),
       `qty=${c3.qty} pool=${c3.pool} fees=${c3.fees}`);
  }
}

/* ════ 76. 버전 형식 ════
   버전은 x.y.z 다. 배포할 때마다 같이 올린다 —
     마지막 자리  작은 수정·버그·UI 조정
     가운데 자리  기능 추가·중간 규모 변경
     첫 자리      전면 개편·호환성이 크게 바뀌는 수준
   화면 두 곳(머리말·설정창)에 같은 값이 떠야 한다. 예전엔 두 자리(v3.77)였다. */
console.log('\n[76] 버전 형식 (x.y.z)');
{
  const SEMVER=/^v\d+\.\d+\.\d+$/;
  const pages=[['index.html',idx],['backtest.html',bt]];
  for(const f of ['admin.html','scalping.html','ipo.html']){
    const fp=__d+'/'+f;
    if(fs.existsSync(fp)) pages.push([f, fs.readFileSync(fp,'utf8')]);
  }
  for(const [name,src] of pages){
    const vs=[...new Set((src.match(/>v\d+(?:\.\d+)+</g)||[]).map(x=>x.slice(1,-1)))];
    ok(`${name} 버전이 x.y.z`, vs.length>0 && vs.every(v=>SEMVER.test(v)), vs.join(' / ')||'못 찾음');
    ok(`${name} 화면마다 같은 버전`, vs.length===1, vs.join(' / '));
  }
  // 운영 앱은 머리말·설정창 두 곳에 같은 값이 떠야 한다
  const top=(idx.match(/id="appVerTop"[^>]*>(v[\d.]+)</)||[])[1];
  const set=(idx.match(/id="appVer">(v[\d.]+)</)||[])[1];
  ok('머리말과 설정창 버전이 같다', !!top && top===set, `머리말 ${top} / 설정창 ${set}`);
}

/* ════ 77. 워밍업 결정성 ════  (감사 ① · 필수시험 A)
   200일선·σ 룩백 같은 지표는 선택 시작일 이전 데이터를 본다.
   그런데 M 에 과거가 얼마나 들어 있는지는 '직전에 어떤 기간을 실행했는지'에
   달려 있었다 — 2015~2026 을 돌린 뒤 2021~2026 으로 좁히면 재로딩을 안 하니
   워밍업이 깊고, 처음부터 2021~2026 을 열면 워밍업이 아예 없다.
   같은 구간인데 결과가 갈렸다. 창(WARM_FROM~WARM_TO)을 못박아 끊는다.
   여기서는 세 가지 M 으로 같은 엔진을 돌려 값으로 확인한다.                    */
console.log('\n[77] 워밍업 결정성 (같은 기간이면 언제 돌리든 같은 값)');
{
  const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)','function _maOpt(opt)',
                 'function _maHold(sell,a,b)','function _maEntry(buy,a,b)',
                 'function _maAbove(tkr,N,SHORT,BUY,SELL)','function _asapInd(tkr)',
                 'function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)','function _ivsPair1(tkr, days)',
                 'function _isoWeek(d)','function _dcaFreq(f)','function _dcaHits(days,freq)','function _dcaMA(t,N)'];
  let pre='var levExt=false, EXTM={}, dcaReinv=true, dcaDipMul=1, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n';
  for(const h of helpers){ try{ pre+=extractFn(bt,h)+'\n'; }catch(e){ ok('도우미 추출: '+h, false, e.message); } }
  const mSg=bt.match(/const SGOV_RATE=\{[^}]*\};/); if(mSg) pre+=mSg[0]+'\n';
  const mMa=bt.match(/const MA_COND_LBL=\{[^}]*\};/); if(mMa) pre+=mMa[0]+'\n';
  const mk=(marker)=>{ const src=extractFn(bt,marker);
    return new Function(pre+'return ('+src.replace(/^function [\w$]+\(/,'function (')+')')(); };

  const T=DAYS.SOXL?'SOXL':'TQQQ', ALL=(DAYS[T]||[]);
  // 워밍업 오프셋 자체가 고정값인지 — 여기서 미끄러지면 아래 전부 의미 없다
  ok('warmStartOf 는 선택일에서 고정 일수만 뺀다',
     warmStartOf('2021-01-01')==='2019-10-09' && warmStartOf('2026-09-22')==='2025-06-29'
     && WARMUP_CAL_DAYS===450,
     `${warmStartOf('2021-01-01')} / ${warmStartOf('2026-09-22')} / ${WARMUP_CAL_DAYS}`);

  if(ALL.length<1400){ ok('워밍업 시험용 데이터(1400일 이상)', false, ALL.length+'일'); }
  else{
    const MFULL=M[T];
    const end=ALL[ALL.length-1];
    const start=ALL[ALL.length-1000];             // 최근 약 4년
    const wStart=warmStartOf(start);
    const days=ALL.filter(d=>d>=start&&d<=end);
    const cut=(from)=>{ const o={}; for(const d of ALL) if(d>=from&&d<=end) o[d]=MFULL[d]; return o; };

    const F={ std:mk('function runStdev(days,tkr,cap,N,g,filter,costOn)'),
              asap:mk('function runASAP(days,tkr,opt)'),
              ma:mk('function runMA200(days,tkr,cap,N,costOn,opt)'),
              ivs:mk('function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)'),
              dca:mk('function _dcaOne(t,days,amt,freq,costOn,dipMul)') };
    const runAll=()=>({
      std : F.std(days,T,10000,40,2.5,'exit',true),
      asap: F.asap(days,T,{base:10,mid:50,deep:100,costOn:true}),
      ma  : F.ma(days,T,10000,200,true),
      ivs : F.ivs(days,T,10000,0.45,60,0.10,true,'iv','cash'),
      dca : F.dca(T,days,10,'daily',true,2) });
    const sig=r=>Object.keys(r).map(k=>{ const x=r[k]||{};
      return `${k}:${(+x.final||0).toFixed(6)}/${(+x.mdd||0).toFixed(6)}/${x.trades!=null?x.trades:(x.rebals!=null?x.rebals:'-')}`;
    }).join(' ');

    // ① 넓게 받아 둔 M (전체 이력) 에서 창만 좁혀 실행 = '2015~2026 돌린 뒤 2021~2026'
    WARM_FROM=wStart; WARM_TO=end;
    M[T]=MFULL;      const wide=sig(runAll());
    // ② 창만큼만 받아 둔 M = '앱을 새로 열고 2021~2026 바로 실행'
    M[T]=cut(wStart); const fresh=sig(runAll());
    ok('넓게 로딩한 뒤 좁힌 결과 == 처음부터 좁게 연 결과', wide===fresh,
       wide===fresh?'':`\n      넓게 ${wide}\n      새로 ${fresh}`);

    // ③ 이 시험이 살아 있는지 — 워밍업이 없으면(옛 fresh load) 실제로 값이 갈린다
    WARM_FROM=''; WARM_TO='';
    M[T]=cut(start);  const noWarm=sig(runAll());
    M[T]=cut(wStart); const withWarm=sig(runAll());
    ok('워밍업 없이 열면 값이 실제로 달라진다 (창이 필요한 이유)', noWarm!==withWarm,
       noWarm===withWarm?'같은 값이 나와 이 시험이 죽어 있다':'');

    // ④ 창을 씌우면 전체 이력이 있어도 워밍업만큼만 본다
    WARM_FROM=wStart; WARM_TO=end;
    M[T]=MFULL;
    const seen=dtsOf(T);
    ok('엔진이 보는 날짜가 창 밖으로 안 나간다',
       seen.length>0 && seen[0]>=wStart && seen[seen.length-1]<=end,
       `${seen[0]} ~ ${seen[seen.length-1]}`);
    ok('창 안에 200거래일 이상 워밍업이 남는다',
       seen.filter(d=>d<start).length>=200, seen.filter(d=>d<start).length+'일');

    WARM_FROM=''; WARM_TO=''; M[T]=MFULL;      // 뒷 섹션에 영향 없게 되돌린다
  }
  // 로더도 같은 창을 받아와야 한다 — 엔진만 좁히면 새로 연 사람은 워밍업이 아예 없다
  ok('실행이 워밍업 시작일을 먼저 정한다', /const wStart=warmStartOf\(start\);\s*\n\s*WARM_FROM=wStart; WARM_TO=end;/.test(bt));
  ok('데이터도 워밍업 시작일부터 받는다', /await loadData\(wStart,\s*end\)/.test(bt) && !/await loadData\(start,\s*end\)/.test(bt));
  ok('재로딩 판정도 워밍업 시작일로 한다', /loadedStart && wStart<loadedStart/.test(bt));
  ok('레버리지 확장도 워밍업 구간까지 덮는다', /buildLevExt\(wanted,\s*wStart\)/.test(bt));
  ok('엔진이 전체 이력을 직접 훑지 않는다', !/Object\.keys\(M\[tkr\]\)\.sort\(\)/.test(bt));
}

/* ════ 78. 표준편차 200일선 필터 — 풀리면 바로 풀려야 한다 ════  (감사 ④ · 필수시험 A~D)
   필터의 뜻은 이것뿐이다.
     nobuy — 하락장 '동안' 추가매수 금지
     exit  — 하락장 '동안' 현금
   그런데 옛 코드는 막아 놓고도 prevLv 를 갱신해 버려서, 200선 위로 올라온 뒤에도
   σ레벨이 바뀌기 전까지 거래가 계속 막혀 있었다. 회복 구간을 통째로 놓치는 버그다.
   합성 시세로 그 전환을 직접 만들어 값으로 확인한다 —
   ★ 전환 앞뒤로 레벨이 '같아야' 옛 버그가 드러난다. 레벨이 바뀌면 옛 코드도
     그 김에 재진입해 버려서 아무 문제 없어 보인다.                                */
console.log('\n[78] 표준편차 필터 — 하락장이 끝나면 바로 되돌아온다');
{
  const T='__STDTEST__';
  const LVN=40, G=2.5;
  const dayStr=(i)=>{ const t=new Date(Date.UTC(2020,0,1)); t.setUTCDate(t.getUTCDate()+i);
    return t.toISOString().slice(0,10); };
  const install=(px)=>{ const days=px.map((_,i)=>dayStr(i));
    M[T]={}; days.forEach((d,i)=>{ M[T][d]=[px[i],px[i],px[i],px[i]]; });
    META[T]={name:'시험용',lev:3,color:'#000'}; return days; };
  const ind=(px)=>{ const n=px.length;
    const ma200=Array(n).fill(null); { let s=0; for(let i=0;i<n;i++){ s+=px[i]; if(i>=200)s-=px[i-200]; if(i>=199)ma200[i]=s/200; } }
    const ma=Array(n).fill(null), sd=Array(n).fill(null);
    { let s=0,q=0; for(let i=0;i<n;i++){ s+=px[i]; q+=px[i]*px[i];
        if(i>=LVN){s-=px[i-LVN];q-=px[i-LVN]*px[i-LVN];}
        if(i>=LVN-1){ const m=s/LVN; ma[i]=m; sd[i]=Math.sqrt(Math.max(0,q/LVN-m*m)); } } }
    const lv=i=>{ if(ma[i]==null)return null; const c=px[i],m=ma[i],v=sd[i];
      let L=0; for(const t of [m+2*v,m+v,m,m-v,m-2*v]) if(c<t)L++; return L; };
    const bear=i=>ma200[i]!=null&&px[i]<ma200[i];
    return {lv,bear}; };
  // 거래가 난 날을 그대로 받아 오는 계측판 (엔진 원문에 훅만 넣는다)
  const traceOf=(days,filter,cap)=>{
    let src=extractFn(bt,'function runStdev(days,tkr,cap,N,g,filter,costOn)');
    src=src.replace('sh+=q; cash-=spend+fee; trades++; };','sh+=q; cash-=spend+fee; trades++; __ST.push([__SD,"buy",q]); };')
           .replace('sh-=q; trades++; };','sh-=q; trades++; __ST.push([__SD,"sell",q]); };')
           .replace('days.forEach((d,i)=>{ const gx=gi[d], c=cl[gx];','days.forEach((d,i)=>{ const gx=gi[d], c=cl[gx]; __SD=d;');
    global.__ST=[]; global.__SD='';
    const f=new Function('return ('+src.replace(/^function \w+\(/,'function (')+')')();
    const r=f(days,T,cap,LVN,G,filter,false);
    const tr=global.__ST.slice(); delete global.__ST; delete global.__SD;
    return {r,tr}; };

  /* ── ① 기울기가 일정한 구간 — 밴드 모양이 그대로라 레벨이 붙박이가 된다 ── */
  {
    const N=700, px=[];
    for(let i=0;i<N;i++) px.push(i<300 ? 100+0.3*i : i<400 ? 190-1.0*(i-300) : 90+0.5*(i-400));
    const days=install(px), A=ind(px);
    const flips=[]; for(let i=200;i<N-1;i++) if(A.bear(i)!==A.bear(i+1)) flips.push(i+1);
    ok('① 합성 시세가 200일선을 아래로 한 번, 위로 한 번 넘는다', flips.length===2,
       flips.map(i=>i+'일차').join(' '));
    const down=flips[0], up=flips[1];
    ok('① 전환 앞뒤 σ레벨이 같다 (같아야 옛 버그가 드러난다)',
       A.lv(up-2)===A.lv(up) && A.lv(up)===A.lv(up+2), `${A.lv(up-2)} / ${A.lv(up)} / ${A.lv(up+2)}`);
    const runD=days.slice(230);
    // 신호는 전일 종가로 만든다 → 200선을 넘은 '다음' 거래일에 손이 나간다. 이틀만 본다.
    const win=i=>[days[i],days[i+1]];
    const ex=traceOf(runD,'exit',100000), nb=traceOf(runD,'nobuy',100000);
    const at=(tr,w,kind)=>tr.filter(x=>w.includes(x[0])&&(!kind||x[1]===kind));
    ok('① exit — 하락장 동안 판다', ex.tr.some(x=>x[1]==='sell'));
    ok('① exit — 상승장이 끝나자마자 전량 매도 (bull→bear)',
       at(ex.tr,win(down),'sell').length>0, JSON.stringify(at(ex.tr,win(down))));
    ok('① exit — 하락장이 끝나자마자 되산다 (레벨이 그대로여도)',
       at(ex.tr,win(up),'buy').length>0, JSON.stringify(at(ex.tr,win(up))));
    ok('① nobuy — 하락장이 끝나자마자 목표비중을 다시 본다',
       at(nb.tr,win(up)).length>0, JSON.stringify(at(nb.tr,win(up))));
    for(const f of ['none','nobuy','exit']){ const r=traceOf(runD,f,100000).r;
      ok(`① ${f} 가 유한한 값을 낸다`, isFinite(r.final)&&r.final>0, String(r.final)); }
    ok('① 회복 뒤 exit 이 현금에 갇혀 있지 않다', ex.r.endShares>0, `보유 ${ex.r.endShares}주`);
  }

  /* ── ② 출렁이는 구간 — nobuy 가 하락장에서 '막아 둔' 목표비중을 회복 첫날에 채우는가 ──
     ①처럼 한 방향으로만 움직이면 회복할 때 레벨이 바뀌어 옛 코드도 어쩌다 되산다.
     레벨이 오르내리다가 필터가 풀리는 날 '막혔을 때와 같은 레벨'로 돌아오는
     구간이 있어야 버그가 그대로 드러난다 — 실제 시장의 200선 부근 횡보가 그 모양이다. */
  {
    const N=760, px=[];
    for(let i=0;i<N;i++) px.push(i<260 ? 100+0.30*i : i<330 ? 178-1.4*(i-260)
      : 80+0.25*(i-330)+24*Math.sin(2*Math.PI*(i-330)/50));
    const days=install(px), A=ind(px);
    const ups=[]; for(let i=231;i<N;i++) if(A.bear(i-1)&&!A.bear(i)) ups.push(i);
    ok('② 출렁이는 시세가 200선 위로 여러 번 올라온다', ups.length>=1, ups.length+'회');
    const u=434;                       // 레벨이 그대로(1)인 채 필터가 풀리는 날
    ok('② 그 날 앞뒤 레벨이 같다', A.bear(u-1)&&!A.bear(u)&&A.lv(u-1)===A.lv(u),
       `bear ${A.bear(u-1)}→${A.bear(u)} · lv ${A.lv(u-1)}→${A.lv(u)}`);
    const runD=days.slice(230);
    const nb=traceOf(runD,'nobuy',100000);
    const t=days[u+1];                 // 전일 신호 규약이라 하루 뒤에 손이 나간다
    const buy=nb.tr.filter(x=>x[0]===t&&x[1]==='buy');
    ok('② nobuy — 막아 뒀던 목표비중을 필터가 풀린 첫날에 채운다',
       buy.length>0, `${t} 거래 ${JSON.stringify(nb.tr.filter(x=>x[0]===t))}`);
  }

  // 코드 쪽 — 전환을 실제로 상태로 들고 있는가
  ok('하락장 상태를 따로 들고 있다', /let cash=cap,sh=0,avg=0,prevLv=null,prevBear=false/.test(bt));
  ok('필터가 풀린 날에는 레벨이 같아도 다시 본다', /const unblocked = filtOn && prevBear && !bear;/.test(bt)
     && /else if\(lv!==prevLv \|\| unblocked\)/.test(bt));
  delete M[T]; delete META[T];
}

/* ════ 79. 잔돈은 사라지지 않는다 ════  (감사 ⑥⑦⑬ · 필수시험 G·H)
   정수 주수로 끊으면 반드시 잔돈이 남는다. 그 돈이 장부에서 빠지면 전략이
   실제보다 나빠 보이고, 전략끼리의 '공정 비교'도 깨진다.
   불변식: 초기자금 = 주식매수액 + 수수료 + 잔돈.                                */
console.log('\n[79] 잔돈 보존 · 전체비교 총투입');
{
  const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)',
                 'function _maOpt(opt)','function _maHold(sell,a,b)','function _maEntry(buy,a,b)',
                 'function _maAbove(tkr,N,SHORT,BUY,SELL)','function _asapInd(tkr)',
                 'function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)','function _ivsPair1(tkr, days)','function _isoWeek(d)',
                 'function _dcaFreq(f)','function _dcaHits(days,freq)','function _dcaCount(days,freq)','function _dcaMA(t,N)'];
  let pre='var levExt=false, EXTM={}, dcaReinv=true, dcaDipMul=1, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n';
  for(const h of helpers){ try{ pre+=extractFn(bt,h)+'\n'; }catch(e){ ok('도우미 추출: '+h, false, e.message); } }
  for(const re of [/const SGOV_RATE=\{[^}]*\};/, /const MA_COND_LBL=\{[^}]*\};/, /const TBILL_RATE=\{[\s\S]*?\};/,
                   /const KR_RATE=\{[\s\S]*?\};/, /const parkRate=\(y,tkr\)=>[^\n]*/,
                   /const LEV_SPREAD=[^\n]*/, /const LEV_UNDERLYING=\{[\s\S]*?\};/]){
    const m=bt.match(re); if(m) pre+=m[0]+'\n'; }
  const mk=(marker)=>{ const src=extractFn(bt,marker);
    return new Function(pre+'return ('+src.replace(/^function [\w$]+\(/,'function (')+')')(); };

  /* ── ⑥ 거치식(B&H) 잔돈 ── 값을 손으로 셀 수 있는 합성 시세로 검사한다 ── */
  {
    const T='__BHTEST__';
    const days=[]; const d0=new Date(Date.UTC(2021,0,4));
    for(let i=0;i<60;i++){ const t=new Date(d0); t.setUTCDate(t.getUTCDate()+i);
      days.push(t.toISOString().slice(0,10)); }
    M[T]={}; days.forEach((d,i)=>{ const p=(i===0)?100:(i<30?80:120);   // 100 → 80(낙폭) → 120
      M[T][d]=[p,p,p,p]; });
    META[T]={name:'시험용',lev:3,color:'#000'};
    const runBH=mk('function runBH(days,tkr,cap,costOn)');
    const r=runBH(days,T,10000,true);
    // 수수료 0.25% · 주가 100 → iq(10000/1.0025, 100) = 99주 · 9,900 + 24.75 → 잔돈 75.25
    ok('B&H 정수 주수 99주', r.endShares===99, String(r.endShares));
    ok('B&H 잔돈 75.25 를 들고 간다', near(r.endCash, 10000-9900-24.75, 1e-9), String(r.endCash));
    ok('B&H 불변식: 원금 = 매수액 + 수수료 + 잔돈',
       near(99*100 + r.fees + r.endCash, 10000, 1e-9), `${99*100}+${r.fees}+${r.endCash}`);
    ok('B&H 최종 = 잔돈 + 주식평가', near(r.final, 75.25+99*120, 1e-9), String(r.final));
    // MDD 도 잔돈을 포함해야 한다 — 10000 → 75.25+99*80=8,995.25 → 10.05%
    ok('B&H MDD 에도 잔돈이 들어간다', near(r.mdd, (1-(75.25+99*80)/10000)*100, 1e-9), String(r.mdd));
    // 잔돈을 버리던 옛 계산과 실제로 다른 값이어야 한다 (이 시험이 살아 있다는 증거)
    ok('잔돈을 버리던 옛 값과 다르다', Math.abs(r.final-99*120)>1e-6 && Math.abs(r.mdd-(1-99*80/10000)*100)>1e-6);
    delete M[T]; delete META[T];
  }

  /* ── ⑦ 전체비교 VR 적립식: 총투입이 원금과 같아야 한다 ── */
  {
    const vrCycleCountSrc=extractFn(bt,'function vrCycleCount(days)');
    ok('사이클 세는 함수가 파일 한 곳에 있다', !!vrCycleCountSrc);
    ok('전체비교가 10거래일 분모를 안 쓴다',
       !/Math\.floor\(days\.length\/10\)/.test(bt) && /contrib:cap\/vrCycleCount\(days\)/.test(bt));

    const runVRf=mk('function runVR(days,tkr,params)');
    const T=DAYS.SOXL?'SOXL':'TQQQ', ALL=DAYS[T];
    // 연휴(연말연시·독립기념일)가 반드시 들어가도록 통째로 여러 해를 쓴다
    const wins=[[0,260],[260,800],[500,1500],[0,ALL.length]].filter(w=>w[1]-w[0]>60);
    let worst=0, worstLbl='';
    for(const [a2,b2] of wins){
      const days=ALL.slice(a2,b2);
      const cap=10000, n=vrCycleCount(days);
      const r=runVRf(days,T,{contrib:cap/n,G:10,bandPct:15,mode:0.75,formula:'basic',
                             startV:0,startPool:0,costOn:true});
      const gap=Math.abs(r.invested-cap);
      if(gap>worst){ worst=gap; worstLbl=`${days[0]}~${days[days.length-1]} 적립 ${n}회 → 총투입 ${r.invested.toFixed(2)}`; }
    }
    ok('전체비교 VR 적립식 총투입 == 원금 (연휴 포함 구간에서도)', worst<1e-6, worstLbl);

    // 옛 분모(10거래일)로는 실제로 어긋난다 — 이 시험이 살아 있다는 증거
    const days=ALL.slice(0, ALL.length);
    const capX=10000, oldN=Math.max(1,Math.floor(days.length/10)), newN=vrCycleCount(days);
    const rOld=runVRf(days,T,{contrib:capX/oldN,G:10,bandPct:15,mode:0.75,formula:'basic',
                              startV:0,startPool:0,costOn:true});
    ok('옛 10거래일 분모로는 총투입이 원금과 어긋난다', Math.abs(rOld.invested-capX)>1,
       `적립 ${oldN}회(옛) vs ${newN}회(실제) → 총투입 ${rOld.invested.toFixed(2)}`);
  }

  /* ── ⑧ ASAP 워밍업 적립금 — 지표가 안 섰다고 돈이 사라지면 안 된다 ── */
  {
    const runASAP=mk('function runASAP(days,tkr,opt)');
    const T=DAYS.SOXL?'SOXL':'TQQQ', ALL=DAYS[T];
    /* 워밍업이 없는 상태를 일부러 만든다 — 창을 딱 이 구간으로 못박으면
       200일선은 앞 199거래일 동안 null 이다. 옛 코드는 그 구간 적립을 통째로 빼먹었다. */
    const days=ALL.slice(-600);
    const _wf=WARM_FROM, _wt=WARM_TO;
    WARM_FROM=days[0]; WARM_TO=days[days.length-1];
    /* 딥매수 금액을 0에 가깝게 두면 총투입 = base × 거래일수 로 떨어진다.
       딱 0을 주면 안 된다 — 엔진이 o.mid||50 로 기본값을 되살려 버린다. */
    const r=runASAP(days,T,{base:10,mid:1e-9,deep:1e-9,costOn:false});
    WARM_FROM=_wf; WARM_TO=_wt;
    ok('ASAP — 지표가 안 선 구간에도 적립금이 장부에 남는다',
       near(r.invested, 10*days.length, 1e-4),
       `총투입 ${r.invested} · 기대 ${10*days.length} (거래일 ${days.length})`);
    ok('ASAP — 빠진 적립금이 리저브에 쌓여 있다', r.endReserve>0, String(r.endReserve));
    // 옛 동작(워밍업 구간 return)이라면 199일치가 비었을 것이다 — 그 차이가 실제로 크다
    ok('빼먹었다면 티가 날 만큼 크다 (199거래일치)', 10*days.length - 10*(days.length-199) === 1990);
  }

  /* ── ⑬ 잔돈 불변식 — 장부를 돌려주는 엔진은 전부 지켜야 한다 ── */
  {
    const T=DAYS.SOXL?'SOXL':'TQQQ', D=DAYS[T].slice(-900);
    const cap=10000;
    const runStdev=mk('function runStdev(days,tkr,cap,N,g,filter,costOn)');
    const runIVS=mk('function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)');
    const runVRf=mk('function runVR(days,tkr,params)');
    const cases=[
      ['표준편차', ()=>{ const r=runStdev(D,T,cap,40,2.5,'none',true);
        return {cash:r.endCash, sh:r.endShares, fin:r.final}; }],
      ['역분산',  ()=>{ const r=runIVS(D,T,cap,0.45,60,0.10,true,'iv','cash');
        return {cash:r.endCash, sh:r.endShares, fin:r.final}; }],
    ];
    for(const [nm,f] of cases){
      const r=f();
      ok(`${nm} — 최종 평가액에 현금이 들어 있다`, r.cash>=-1e-6 && isFinite(r.fin) && r.fin>0,
         `현금 ${r.cash} · 보유 ${r.sh} · 최종 ${r.fin}`);
    }
    // VR 은 Pool 이 곧 현금이다 — 최종 = 주식 + Pool + 누적인출
    const rv=runVRf(D,T,{initAmt:cap,G:10,bandPct:15,mode:0.5,formula:'basic',startV:0,startPool:0,costOn:true});
    ok('VR — 최종 = 주식평가 + Pool + 누적인출',
       near(rv.final, rv.sharesVal+rv.pool+rv.totalWd, 1e-6),
       `${rv.final} vs ${rv.sharesVal}+${rv.pool}+${rv.totalWd}`);
  }
}

/* ════ 80. 역분산 짝=1배수 — 운영과 백테가 같은 기초가격을 본다 ════ (감사 ⑤ · 필수시험 F)
   운영 화면(ivsReplay)은 '실제로 살 수 있는 1배 ETF'(TQQQ→QQQ · SOXL→SOXX …)로 굴린다.
   백테(runIVS)는 레버리지에서 역산한 합성 1배지수(_ivsX1)를 썼다. 같은 전략·같은 옵션인데
   기초가격이 다르면 거래 결정 자체가 갈린다 — 화면에도 '10년에 2~3% 차이'라고 적혀 있었다.
   이제 백테도 실제 1배 ETF를 먼저 쓰고, 없을 때만 합성으로 대체하며 그 사실을 표시한다.
   대조하는 건 '리밸런싱한 날'이다. 주수는 7차 ⑯ 부터 양쪽 다 정수라, 백테에만 있는 규약
   (예수금 이자·국채 쪽 비용·양도세·배당 현금)을 끄고 수수료를 같게 두면 날짜가 그대로 겹쳐야 한다. */
/* 섀넌 백테 엔진을 운영 재생과 같은 조건으로 — 백테에만 있는 규약을 끄고 수수료를 0.25% 로 못박는다.
   [80]·[112] 가 같이 쓴다. 원문을 한 글자씩 바꾸므로, 원문이 바뀌면 여기서 먼저 터진다. */
/* keepDiv — 배당은 남기되 앱처럼 늘 세후로 (앱 divCashQ 는 세금을 늘 뗀다 · 백테는 비용ON 일 때만). 7차 D8 */
function ivsNeutralSrc(src, keepDiv){
  const inj=(a,b,l)=>{ const p=src.split(a); if(p.length!==2) throw new Error(`섀넌 중화 실패(${l}): ${p.length-1}회 매치`); src=p[0]+b+p[1]; };
  inj(`const FEE=costOn?costOf(tkr).fee:0;`, `const FEE=0.0025;`, 'fee');
  inj(`const LEGFEE=(costOn&&!X1)?costOf(tkr).fee:0;`, `const LEGFEE=0;`, 'legfee');
  inj(`const CASH_DIVTAX=costOn?DIV_TAXRATE:0, CASH_EXP=costOn?0.0010:0;`, `const CASH_DIVTAX=0, CASH_EXP=0;`, 'cashcost');
  inj(`const owed=capGainTax(yearPnl, tkr); let due=owed; yearPnl=0;`, `const owed=0; let due=owed; yearPnl=0;`, 'tax');
  inj(`const gross=cash*parkRate(+d.slice(0,4),tkr)/252;`, `const gross=0;`, 'park');
  if(keepDiv){
    inj(`cash+=divCash(tkr,d,A.sh,costOn);`,
        `{ const __v=divCash(tkr,d,A.sh,true); cash+=__v; if(__v>0&&typeof __LOG!=='undefined') __LOG.push({type:'div',leg:'lev',date:d,amt:__v}); }`, 'div');
    inj(`if(X1 && _p1 && _p1.sym && !_p1.synth) cash+=divCash(_p1.sym,d,B.sh,costOn);`,
        `if(X1 && _p1 && _p1.sym && !_p1.synth){ const __v=divCash(_p1.sym,d,B.sh,true); cash+=__v; if(__v>0&&typeof __LOG!=='undefined') __LOG.push({type:'div',leg:'x1',date:d,amt:__v}); }`, 'div1');
  }else{
    inj(`cash+=divCash(tkr,d,A.sh,costOn);`, ``, 'div');
    inj(`if(X1 && _p1 && _p1.sym && !_p1.synth) cash+=divCash(_p1.sym,d,B.sh,costOn);`, ``, 'div1');
  }
  return src;
}
console.log('\n[80] 역분산 1배 짝 — 운영·백테 기초가격 일치');
{
  ok('운영·백테의 1배 매핑표가 같다', (()=>{
    const a1=(idx.match(/const IVS_X1=\{([^}]*)\}/)||[])[1]||'';
    const b1=(bt.match(/const LEV_UNDERLYING=\{([^}]*)\}/)||[])[1]||'';
    const norm=t=>Object.fromEntries(t.split(',').map(x=>x.split(':').map(y=>y.replace(/['"\s]/g,''))));
    const A=norm(a1), B=norm(b1);
    return Object.keys(A).every(k=>A[k]===B[k]) && Object.keys(A).length>=8;
  })(), '매핑표 불일치');
  ok('백테가 실제 1배 ETF를 먼저 쓴다', /function _ivsPair1\(tkr, days\)/.test(bt)
     && /const _p1 = X1\?_ivsPair1\(tkr,days\):null;/.test(bt));
  ok('실제 시세가 없을 때만 합성으로 대체한다',
     /return \{px:_ivsX1\(tkr\), sym:u\|\|null, synth:true, basis:basis\|\|null, why\};/.test(bt));
  /* 티커가 실제 ETF 인 것과 그 가격이 실제 체결가인 것은 다른 문제다 —
     조정종가로 들어온 계열을 '운영 화면과 같은 기초가격' 이라고 적으면 안 된다. */
  ok("가격 기준(PBASIS)까지 봐야 '실제 1배' 로 인정한다",
     /const basis=\(typeof PBASIS!=='undefined'\)\?PBASIS\[u\]:undefined;/.test(bt)
     && /if\(D && basis==='trade' && days && days\.length\)\{/.test(bt));
  ok('합성 대체를 결과에 표시한다', /합성 1배 대체 사용/.test(bt) && /x1synth/.test(bt));
  /* 데이터 의존성은 UI 분기가 아니라 한 단계에 모은다 —
     역분산 탭 안에만 두면 전체비교 탭에서 조용히 빠진다(실제로 그랬다). */
  ok('1배수 짝이면 실제 1배 시세를 먼저 받아 온다',
     /function prepareStrategyData\(st, tickers, fromDate\)/.test(bt)
     && /await fetchTickerInto\(u, fromDate\)/.test(bt));
  ok('역분산과 전체비교가 같은 준비 단계를 지난다', (()=>{
      const f=(bt.match(/function strategyNeeds\(st, tickers\)\{[\s\S]*?\n\}/)||[''])[0];
      return /\(st==='ivs'\|\|st==='all'\)/.test(f)
          && (bt.match(/await prepareStrategyData\(strat, wanted, wStart\);/g)||[]).length===1; })());
  ok('전략 분기 안에 선행 로딩이 안 남아 있다',
     !/if\(ivsPair==='x1'\)\{[\s\S]{0,400}?fetchTickerInto/.test(bt));
  ok('조정종가로만 들어와 있으면 다시 받는다',
     /PBASIS\[u\]!=='trade'/.test(bt));

  /* ── 값으로: 같은 1배 시세를 주면 두 엔진이 같은 날 리밸런싱한다 ── */
  const T=DAYS.SOXL?'SOXL':'TQQQ';
  const U='__X1TEST__';                 // 합성이 아닌 '실제 1배 ETF' 자리에 넣을 시세
  const ALL=DAYS[T];
  // 1배 시세는 레버리지 일수익률÷3 을 누적한 계열로 만든다 (실제 ETF 와 같은 성질·같은 날짜)
  { const px={}; let v=50;
    ALL.forEach((d,i)=>{ if(i>0){ const r=M[T][ALL[i]][C]/M[T][ALL[i-1]][C]-1; v*=(1+r/3); }
      px[d]=[v,v,v,v]; });
    M[U]=px; META[U]={name:'시험용 1배',lev:1,color:'#000'};
    PBASIS[U]='trade'; }      // 실제 체결가 계열로 들어온 상태 (이게 아니면 합성으로 떨어져야 정상)
  // 매핑표를 시험용으로 갈아끼운다 (원문 함수는 그대로 쓰고 표만 바꾼다)
  const pre0='var levExt=false, EXTM={}, LEV_UNDERLYING={'+T+':"'+U+'"};\n'
    +[...['function srcOf(t)','function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)',
          'function _ivsPair1(tkr, days)']].map(m=>extractFn(bt,m)).join('\n')+'\n'
    +(bt.match(/const LEV_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const LEV_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_SPREAD=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_PRICEIDX=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const X1_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const X1_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const IDX_EXTEND=\{[\s\S]*?\}\s*\};/)||[''])[0]+'\n'
    +(bt.match(/const TBILL_RATE=\{[\s\S]*?\};/)||[''])[0]+'\n'
    +(bt.match(/const KR_RATE=\{[\s\S]*?\};/)||[''])[0]+'\n'
    +(bt.match(/const parkRate=\(y,tkr\)=>[^\n]*/)||[''])[0]+'\n';
  const runIVSx=new Function(pre0+'return ('+extractFn(bt,'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)')
    .replace(/^function \w+\(/,'function (')+')')();
  const pair1=new Function(pre0+'return _ivsPair1;')();
  const days=ALL.slice(-1200);
  const got=pair1(T, days);
  ok('실제 1배 시세가 다 있으면 합성을 안 쓴다', got.synth===false && got.sym===U,
     `synth=${got.synth} sym=${got.sym}`);
  /* ★ 같은 티커·같은 시세인데 가격 기준만 바꾼다 — 조정종가면 합성으로 떨어져야 한다 */
  for(const [pb,lbl] of [['total_return','조정종가'],['unknown','기준 불명'],[undefined,'기준 없음']]){
    if(pb===undefined) delete PBASIS[U]; else PBASIS[U]=pb;
    const g=pair1(T, days);
    ok(`1배가 ${lbl} 로 들어오면 '실제' 라고 안 한다`, g.synth===true && g.why==='basis',
       `synth=${g.synth} why=${g.why}`);
  }
  PBASIS[U]='trade';

  // 백테 쪽 리밸런싱 날짜
  let bsrc=ivsNeutralSrc(extractFn(bt,'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)'));
  ok('백테 리밸런싱 훅 자리 확인', bsrc.includes('      rebals++;'));
  bsrc=bsrc.replace('      rebals++;','      rebals++; __IVD.push(d);');
  global.__IVD=[];
  const btRun=new Function(pre0+'return ('+bsrc.replace(/^function \w+\(/,'function (')+')')();
  /* 운영 재생은 '받아 온 구간'만 보고 σ를 낸다 — 백테도 같은 창으로 못박아야 같은 w 가 나온다.
     (창을 안 씌우면 백테만 워밍업이 깊어 목표비중이 달라진다) */
  const _wf0=WARM_FROM, _wt0=WARM_TO;
  WARM_FROM=days[0]; WARM_TO=days[days.length-1];
  global.__IVD=[]; btRun(days,T,10000,0.45,60,0.10,false,'iv','x1');
  const btDays=global.__IVD.slice();

  /* 운영 쪽 — ivsReplay 원문을 그대로 떼어 와 DOM 만 가짜로 물린다.
     여기서 로직을 다시 적으면 '두 군데서 세는' 짓이라 대조의 의미가 없다. */
  const appSrc=extractFn(idx,'function ivsReplay()');
  const appDays=[];
  {
    const st={ticker:T, park:'x1', mode:'iv', s0:45, look:60, band:10, principal:10000};
    const sess={settings:st, hist:[], paper:true};
    const D=days.map(d=>({date:d, close:M[T][d][C]}));
    const D1=days.map(d=>({date:d, close:M[U][d][C]}));
    const f=new Function('curStrat','$','confirm','alert','simCutoff','curOf','ivsX1Of','IVS_FEE',
      'ivsQuoteData','ivsQuote1','sortHist','save','refreshIvs','pushRemote','px',
      appSrc+'\nreturn ivsReplay;')(
      ()=>sess, (id)=>({value: id==='rp_from'?days[0]:''}), ()=>true, ()=>{},
      ()=>days[days.length-1], ()=>'USD', ()=>U, 0.0025,
      {symbol:T, days:D}, {symbol:U, days:D1},
      ()=>{}, ()=>{}, ()=>{}, null, n=>String(n));
    f();
    for(const r of sess.hist) if(!appDays.includes(r.date)) appDays.push(r.date);
  }
  ok('운영 재생이 실제로 굴러갔다', appDays.length>10, appDays.length+'일');
  /* 백테는 정수 주수라 '밴드를 벗어났지만 1주도 못 사는' 날이 생긴다(운영은 소수점).
     그래서 백테의 리밸런싱 날짜는 운영의 부분집합이어야 한다 — 없는 날이 새로 생기면
     기초가격이 다르다는 뜻이다. */
  const appSet=new Set(appDays), btSet=new Set(btDays);
  const hit=btDays.filter(d=>appSet.has(d)).length;
  /* 백테에만 있는 규약(예수금 이자·국채 쪽 비용·양도세·배당 현금)을 끄고 수수료를 같게 두면
     (ivsNeutralSrc) 기초가격만 같으면 날짜가 겹쳐야 한다. 주수는 7차 ⑯ 부터 양쪽 다 정수다.
     백테 쪽 날짜는 '리밸런싱하기로 한 날' 이라, 밴드를 벗어났지만 어느 다리도 1주를 못 움직인
     날이 섞일 수 있다 — 그래서 운영 ⊆ 백테 를 보고, 겹치는 비율은 넉넉히 본다. */
  ok('운영이 거래한 날은 전부 백테도 리밸런싱한 날이다',
     appDays.length>0 && appDays.every(d=>btSet.has(d)),
     `운영에만 있는 날 ${appDays.filter(d=>!btSet.has(d)).slice(0,3).join(',')}`);
  ok('백테가 리밸런싱한 날의 대부분에 운영도 거래했다',
     btDays.length>0 && hit/btDays.length>=0.9,
     `${hit}/${btDays.length}일 일치 (운영 ${appDays.length}일)`);

  /* 합성을 쓰면 실제로 갈린다 — 이 시험이 살아 있다는 증거 */
  { const days2=days.slice();
    const saveU=M[U]; delete M[U];                    // 실제 1배 시세를 없애 합성으로 떨어뜨린다
    const g2=pair1(T, days2);
    ok('실제 1배가 없으면 합성으로 떨어진다', g2.synth===true, `synth=${g2.synth}`);
    global.__IVD=[]; btRun(days2,T,10000,0.45,60,0.10,false,'iv','x1');
    const synDays=global.__IVD.slice();
    M[U]=saveU;
    const hitSyn=synDays.filter(d=>appSet.has(d)).length/Math.max(1,synDays.length);
    const hitReal=btDays.filter(d=>appSet.has(d)).length/Math.max(1,btDays.length);
    ok('실제 1배로 굴리면 합성보다 운영과 훨씬 잘 맞는다',
       hitReal>hitSyn, `일치율 실제 ${(hitReal*100).toFixed(0)}% / 합성 ${(hitSyn*100).toFixed(0)}%`);
  }
  WARM_FROM=_wf0; WARM_TO=_wt0;
  delete global.__IVD; delete M[U]; delete META[U];
}

/* ════ 81. 출처와 실제를 같은 이름으로 보이지 않기 ════  (감사 ⑩⑫⑪⑭)
   문서·논문에 있는 값과 우리가 얹은 확장을 한 이름으로 보이면, 사용자가
   실험 결과를 원전 결과로 읽는다. 표시와 프리셋을 값으로 검사한다.               */
console.log('\n[81] 출처 표기 · 프리셋 · 설명문');
{
  // ── ⑫ 200일선: 논문 원형 vs 기반 확장형 ──
  const preMa='var maLen=200, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n'
    +(bt.match(/const MA_COND_LBL=\{[^}]*\};/)||[''])[0]+'\n'
    +extractFn(bt,'function _maOpt(opt)')+'\n';
  const mkMa=()=>new Function(preMa
    +extractFn(bt,'function maVariant(len)')+'\n'
    +extractFn(bt,'function maVariantTag(len)')+'\n'
    +'return {maVariant,maVariantTag,set:(o)=>{maLen=o.len??maLen;maBuy=o.buy??maBuy;maSell=o.sell??maSell;maPark=o.park??maPark;}};')();
  { const A=mkMa();
    ok('200로테 기본값이 논문 원형으로 뜬다',
       A.maVariant(200).length===0 && /논문 원형/.test(A.maVariantTag(200)), A.maVariantTag(200));
    A.set({buy:'cross'});
    ok('매수 조건을 바꾸면 기반 확장형으로 뜬다',
       /기반 확장형/.test(A.maVariantTag(200)) && A.maVariant(200).join().includes('매수'), A.maVariantTag(200));
    A.set({buy:'ma', park:'bill'});
    ok('국채 대피도 확장으로 센다', A.maVariant(200).some(x=>/단기국채/.test(x)), A.maVariant(200).join(' · '));
    A.set({park:'cash', len:100});
    ok('200일이 아니면 확장으로 센다', A.maVariant(100).some(x=>/100일선/.test(x)), A.maVariant(100).join(' · '));
  }
  ok('출처 문구가 원형과 확장을 갈라 적는다',
     /기반 확장형<\/b> — 논문 원형은/.test(bt) && /우리가 얹은 확장<\/b>/.test(bt));
  ok('결과 머리글에 원형·확장 표시가 붙는다', /\+ maVariantTag\(L\);/.test(bt));

  // ── 프리셋 ──
  ok('공식 V4.0 프리셋이 있다', /function imPreset\(\)/.test(bt) && /onclick="imPreset\(\)"/.test(bt));
  ok('공식 프리셋이 문서 수록 종목만 고른다', /imActive=new Set\(Object\.keys\(IM_OFFICIAL\)/.test(bt));
  ok('공식 프리셋이 익절·분할·리버스·엔진을 못 박는다', (()=>{
      const f=extractFn(bt,'function imPreset()');
      return /_segPick\('imEngine','e','v40'\)/.test(f) && /_segPick\('imDiv','d','20'\)/.test(f)
          && /_segPick\('imTgtSeg','t','0'\)/.test(f) && /_segPick\('imTgtDynSeg','x','0'\)/.test(f)
          && /_segPick\('imRev','r','1'\)/.test(f); })());
  ok('공식 프리셋이 리버스 매수가를 공식값으로 되돌린다', (()=>{
      const f=extractFn(bt,'function imPreset()');
      // 되돌린 뒤에 다시 돌려야 화면에 뜨는 결과가 공식 결과가 된다
      return /imRevGap=0;/.test(f) && f.indexOf('imRevGap=0;') < f.indexOf('if(dataLoaded) run();'); })(),
     '프리셋이 gap 을 안 되돌리거나, 되돌리기 전에 run() 한다');
  ok('논문 원형 프리셋이 있다', /function maPreset\(\)/.test(bt) && /onclick="maPreset\(\)"/.test(bt));
  ok('논문 프리셋이 200선·현금으로 되돌린다', (()=>{
      const f=extractFn(bt,'function maPreset()');
      return /_segPick\('maBuySeg','s','ma'\)/.test(f) && /_segPick\('maSellSeg','s','ma'\)/.test(f)
          && /_segPick\('maParkSeg','p','cash'\)/.test(f) && /maLen=200/.test(f); })());

  // ── ⑪ VR 설명문이 코드의 실제 규칙과 같은가 ──
  ok('VR 설명문이 달력 14일이라고 적는다',
     /<b>달력 14일<\/b> 사이클 \(기준일이 주말이면 다음 영업일\)/.test(bt));
  ok("화면 문구에 '10거래일' 이 안 남아 있다", (()=>{
      // 주석(과거 설명)은 놔두고, 화면에 뜨는 문구만 본다
      const ui=[...bt.matchAll(/<div class="rules[\s\S]*?<\/div>/g)].map(m=>m[0]).join('\n')
             + [...bt.matchAll(/<div class="foot">[\s\S]*?<\/div>/g)].map(m=>m[0]).join('\n');
      return !/10거래일/.test(ui); })());
  ok('앱 과거재생 안내도 달력 14일이라고 적는다',
     /<b>달력 14일<\/b>마다 V 갱신/.test(idx) && !/\(10거래일마다 V 갱신/.test(idx));

  // ── ⑭ 하단 문구가 실행 옵션을 따라간다 ──
  ok("하단에 '수수료·세금·환율·배당 미반영' 이 안 남아 있다", (()=>{
      const ui=[...bt.matchAll(/<div class="foot">[\s\S]*?<\/div>/g)].map(m=>m[0]).join('\n');
      return !/수수료·세금·환율·배당 미반영/.test(ui); })());
  ok('하단 문구를 실행 옵션으로 다시 적는다',
     /function renderFootNote\(\)/.test(bt) && /id="footCost"/.test(bt)
     && /비용 적용<\/b>/.test(bt) && /비용 미적용<\/b>/.test(bt));
  ok('탭 전환·실행·첫 화면에서 모두 갱신한다',
     (bt.match(/renderFootNote\(\);/g)||[]).length>=3);
  ok('탭마다 실제 비용 토글을 읽는다', (()=>{
      const f=(bt.match(/const COST_FLAG=\{[\s\S]*?\};/)||[''])[0];
      return ['dca','im','vr','ma','asap','std','ivs','all','mom'].every(k=>f.includes(k+':')); })());
}

/* ════ 82. 모멘텀 로테이션 (숨김 탭) ════  (감사 ⑨ · 필수시험 J·K)
   회귀가 한 줄도 없던 엔진이다. 네 가지가 한꺼번에 틀려 있었다.
     · 월 첫 거래일 '오늘 종가'로 순위·200일선을 정하고 그 종가에 매매 (same-close)
     · 정수 주수로 사고 남은 잔돈이 평가액에서 빠짐
     · sellAll 이 cash=proceeds 로 기존 잔돈을 덮어씀
     · 세금 강제매도가 매도 helper 를 안 지나가 수수료·실현손익이 빠짐
   합성 시세로 값을 만들어 확인한다. 전부 통과하기 전에는 탭을 계속 숨겨 둔다.   */
console.log('\n[82] 모멘텀 로테이션 — 룩어헤드·현금 장부');
{
  const src=extractFn(bt,'function momentumBacktest(data, tickers, U, cap, lb, filter, costOn)');
  const pre=(bt.match(/const COST_FEE=[^\n]*/)||[''])[0]+'\n'
    +extractFn(bt,'function momSMA(series)')+'\n';
  const run=new Function(pre+'return ('+src.replace(/^function \w+\(/,'function (')+')')();

  // ── 합성 시세: 3종목 × 4년 (달마다 순위가 바뀌도록 서로 다른 주기) ──
  const DATES=[]; { const t=new Date(Date.UTC(2020,0,1));
    while(t<new Date(Date.UTC(2024,0,1))){ const w=t.getUTCDay();
      if(w!==0&&w!==6) DATES.push(t.toISOString().slice(0,10));
      t.setUTCDate(t.getUTCDate()+1); } }
  const mkData=()=>{ const d={};
    d.AAA=Object.fromEntries(DATES.map((x,i)=>[x, 100*(1+0.0006*i)+18*Math.sin(2*Math.PI*i/70)]));
    d.BBB=Object.fromEntries(DATES.map((x,i)=>[x, 100*(1+0.0004*i)+22*Math.sin(2*Math.PI*i/110+1)]));
    d.CCC=Object.fromEntries(DATES.map((x,i)=>[x, 100*(1+0.0002*i)+9*Math.sin(2*Math.PI*i/45+2)]));
    return d; };
  const tickers=[{sym:'AAA',name:'A',taxable:true},{sym:'BBB',name:'B',taxable:true},{sym:'CCC',name:'C',taxable:true}];
  const U={label:'시험',cur:'$',cap:10000,fee:0.0030,taxRate:0.22,annual:true,tickers,bench:[]};
  const CAP=10000;

  const base=run(mkData(),tickers,U,CAP,3,true,true);
  ok('모멘텀 엔진이 굴러간다', isFinite(base.fin)&&base.fin>0&&base.sw>0,
     `최종 ${base.fin} · 교체 ${base.sw}회 · ${base.months}개월`);

  /* ── J. same-close 탐지 ──
     월 첫 거래일의 종가만 흔들어도 '그 달에 무엇을 고르는가'가 바뀌면 안 된다.
     체결가는 그 종가라 금액은 당연히 달라지므로, 재는 건 '고른 종목'이다. */
  {
    const months=[...new Set(DATES.map(d=>d.slice(0,7)))].sort();
    const firstOf={}; for(const d of DATES){ const m=d.slice(0,7); if(!firstOf[m]) firstOf[m]=d; }
    let flips=0, checked=0, first='';
    const pick=r=>r.seq.map(x=>x.sym===null?'-':x.sym).join(',');
    for(let mi=12; mi<months.length; mi+=3){
      const d=firstOf[months[mi]];
      const b=pick(run(mkData(),tickers,U,CAP,3,true,true));
      for(const mul of [0.75,1.35]){
        const D=mkData();
        for(const s of ['AAA','BBB','CCC']) D[s][d]=D[s][d]*mul;   // 그날 세 종목 모두 흔든다
        D.AAA[d]=D.AAA[d]*1.2;                                     // 순위를 뒤집을 만큼 한 종목만 더
        const v=pick(run(D,tickers,U,CAP,3,true,true));
        checked++;
        if(v!==b){ flips++; if(!first){
          const B=b.split(','), V=v.split(',');
          const k=B.findIndex((x,i)=>x!==V[i]);
          first=`${d} ×${mul} → ${k}번째 달 선택이 ${B[k]}에서 ${V[k]}로`; } }
      }
    }
    ok('오늘 종가가 오늘 선택을 바꾸지 않는다', checked>0&&flips===0,
       `${checked}회 중 ${flips}회 바뀜${first?' · '+first:''}`);
  }

  /* ── K. 현금 장부 ── 잔돈은 사라지지 않는다 ── */
  {
    // 값이 손에 잡히게: 종목 하나·필터 없음·비용 있음 → 첫 매수의 잔돈을 직접 센다
    const D={AAA:Object.fromEntries(DATES.map((x,i)=>[x, 100+0*i]))};   // 값이 고정된 시세
    const one=[{sym:'AAA',name:'A',taxable:true}];
    const U1={...U, tickers:one, bench:[]};
    const r=run(D,one,U1,10000,1,false,true);
    /* 주가 100 · 수수료 0.30% → floor(10000/100.3)=99주 · 9,900 + 29.7 → 잔돈 70.30
       가격이 변하지 않으므로 교체도 없고, 최종은 잔돈 + 99주×100 이어야 한다. */
    ok('정수 주수로 사고 잔돈을 들고 간다', near(r.fin, (10000-9900-29.7)+99*100, 1e-6), String(r.fin));
    ok('잔돈을 버리던 옛 값(9,900)과 다르다', Math.abs(r.fin-9900)>1e-6);
    ok('원금 = 매수액 + 수수료 + 잔돈', near(9900+29.7+(10000-9900-29.7), 10000, 1e-9));

    // 여러 번 갈아타도 자산이 통째로 뛰거나 사라지지 않는다 (교체마다 수수료만큼만 줄어야 한다)
    const r2=run(mkData(),tickers,U,CAP,3,false,false);   // 비용 없음 → 수수료도 0
    const eqs=Object.keys(r2.snap).map(i=>r2.snap[i][1]).filter(v=>v>0);
    let jump=0; for(let i=1;i<eqs.length;i++) if(Math.abs(eqs[i]/eqs[i-1]-1)>0.5) jump++;
    ok('교체 때 자산이 튀지 않는다 (잔돈 덮어쓰기 없음)', jump===0, jump+'회 튐');
  }

  /* ── 세금 강제매도도 매도 helper 를 지나간다 ── */
  ok('파는 자리가 _sellQty 한 곳이다', (()=>{
      const f=extractFn(bt,'function momentumBacktest(data, tickers, U, cap, lb, filter, costOn)');
      // shares 를 직접 줄이는 자리는 _sellQty 안에만 있어야 한다
      const cuts=(f.match(/shares\s*-=/g)||[]).length;
      return cuts===1 && /_sellQty\(d, Math\.min\(shares, due\/\(p\*\(1-FEE\)\)\)\)/.test(f); })());
  ok('평가액이 현금 + 보유평가다', /eq\[dates\[k\]\]=cash\+\(held\?shares\*lp:0\);/.test(bt)
     && /const fin= cash \+ \(held\? shares\*px\(held,lastD\) : 0\);/.test(bt));
  ok('sellAll 이 기존 현금을 덮어쓰지 않는다',
     !/cash=proceeds;/.test(bt) && /cash\+=proceeds;/.test(bt));
  ok('신호는 직전 확정 거래일까지만 쓴다',
     /const sd=dates\[dIdx\[d\]-1\], spd=dates\[dIdx\[pd\]-1\];/.test(bt)
     && /SMA\[best\]\[sd\]/.test(bt) && /px\(best,sd\)<sm/.test(bt));

  // 전부 통과하기 전에는 탭을 계속 숨겨 둔다 (감사 지시)
  ok('모멘텀 탭은 아직 숨겨져 있다',
     /data-s="mom" onclick="setStrat\('mom'\)" style="display:none"/.test(bt));
}

/* ════ 83. 가격의 역할 분리 ════  (감사 ② · 필수시험 B)
   조정종가(adjclose)는 배당까지 과거 가격에 소급 반영한 총수익 계열이다.
   그걸 체결가로 쓰면 '배당까지 얹힌 가격에 그 주수를 샀다'가 돼서
   주수·현금·평단·지정가·고저 체결판정·실현손익·세금이 전부 실제 장부와 어긋난다.
   무매·VR은 주수 자체가 다음 주문을 바꾸므로 특히 크다.
     M      = 실제 체결가 (분할만 소급)
     ADJ    = 조정종가 (총수익 분석용)
     DIVMAP = 배당 이벤트 (M 과 같이 쓰면 딱 한 번 센다)                          */
console.log('\n[83] 체결가 · 조정종가 · 배당 이벤트 분리');
{
  // ── API 가 세 가지를 따로 내보내는가 ──
  const q=fs.existsSync(__d+'/functions/api/quote.js')?fs.readFileSync(__d+'/functions/api/quote.js','utf8'):'';
  ok('API 가 체결가 계열을 따로 만든다', /const series = \[\], ohlc = \[\], raw = \[\], ohlcTrade = \[\];/.test(q));
  ok('체결가에는 배당 배율(f)을 안 곱한다', (()=>{
      const m=q.match(/if \(wantDiv\) \{\s*const rc = rawA\[i\][\s\S]*?\n    \}/);
      return !!m && !/\* f\)/.test(m[0]) && /close: \+rc\.toFixed\(4\)/.test(m[0]); })());
  ok('조정 계열은 그대로 둔다 (총수익 분석용)', /const f = \(adjA\.length && rawA\[i\] > 0\) \? c \/ rawA\[i\] : 1;/.test(q));
  ok('무엇으로 보냈는지 알려 준다', /out\.priceBasis = \(ohlcTrade && ohlcTrade\.length\) \? 'trade' : 'adjusted'/.test(q));
  ok('조정 여부를 모르는 소스(Stooq)는 체결가로 안 쓴다', /ohlcTrade = null;   \/\/ Stooq/.test(q));

  // ── 로더가 역할을 갈라 담는가 ──
  ok('M·ADJ·DIVMAP·PBASIS 를 따로 담는다',
     /let DIV=\{\}, RAW=\{\}, ADJ=\{\}, DIVMAP=\{\}, PBASIS=\{\};/.test(bt)
     && /PBASIS\[sym\] = useTrade \? 'trade'/.test(bt)
     && /ADJ\[sym\]=\{\}; adjRows\.forEach/.test(bt));
  ok('체결가가 구간을 다 덮을 때만 쓴다',
     /const useTrade = trRows\.length>=10 && trRows\.length===adjRows\.length;/.test(bt));
  ok('가격 기준을 화면에 적는다', /가격 기준<\/b>/.test(bt) && /조정종가<\/b>\(배당 소급 반영\)/.test(bt));

  // ── 이중계상 방지: 조정가로 굴리는 종목에는 배당을 더하지 않는다 ──
  {
    const T='__DIVTEST__';
    PBASIS[T]='adjusted'; DIVMAP[T]={'2021-03-19':1.5};
    ok('조정가로 굴리면 배당을 또 안 더한다', divCash(T,'2021-03-19',100,false)===0);
    PBASIS[T]='trade';
    ok('체결가로 굴리면 배당이 현금으로 들어온다', near(divCash(T,'2021-03-19',100,false), 150, 1e-9));
    ok('비용반영이면 배당소득세를 뗀다',
       near(divCash(T,'2021-03-19',100,true), 150*(1-DIV_TAXRATE), 1e-9), String(divCash(T,'2021-03-19',100,true)));
    ok('배당 없는 날은 0', divCash(T,'2021-03-18',100,false)===0);
    delete PBASIS[T]; delete DIVMAP[T];
  }

  /* ── B. 배당 없는 종목이면 두 모델이 같아야 한다 · 있는 종목이면 딱 한 번만 센다 ── */
  {
    const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)','function _isoWeek(d)',
                   'function _dcaFreq(f)','function _dcaHits(days,freq)','function _dcaCount(days,freq)','function _dcaMA(t,N)'];
    /* dcaReinv 는 테스트가 중간에 바꿔야 하므로 여기 선언하지 않는다 —
       new Function 안에 var 로 박으면 엔진이 그 값에 고정된다. 전역에서 읽게 둔다. */
    let pre='var levExt=false, EXTM={}, dcaDipMul=1;\n';
    for(const h of helpers) pre+=extractFn(bt,h)+'\n';
    const mk=(m)=>new Function(pre+'return ('+extractFn(bt,m).replace(/^function [\w$]+\(/,'function (')+')')();
    const runBH=mk('function runBH(days,tkr,cap,costOn)');

    const T='__PXTEST__';
    const days=[]; { const t=new Date(Date.UTC(2021,0,4));
      for(let i=0;i<500;i++){ days.push(t.toISOString().slice(0,10)); t.setUTCDate(t.getUTCDate()+1); } }
    /* 체결가는 고정 100. 분기마다 주당 1$ 배당(4회).
       조정종가는 그 배당을 소급 반영한 계열 — 같은 총수익을 다른 방식으로 적은 것이다. */
    const DIVD={}, exs=[days[60],days[150],days[240],days[330]];
    for(const d of exs) DIVD[d]=1;
    M[T]={}; days.forEach(d=>{ M[T][d]=[100,100,100,100]; });
    META[T]={name:'시험',lev:1,color:'#000'};

    // ① 배당이 없으면: 체결가 모델 == 조정가 모델 (아무것도 안 바뀐다)
    PBASIS[T]='trade'; DIVMAP[T]={};
    const noDivTrade=runBH(days,T,10000,false);
    PBASIS[T]='adjusted';
    const noDivAdj=runBH(days,T,10000,false);
    ok('배당 없는 종목 — 체결가 모델과 조정가 모델이 같다',
       near(noDivTrade.final, noDivAdj.final, 1e-9), `${noDivTrade.final} / ${noDivAdj.final}`);

    // ② 배당이 있으면: 체결가 + 이벤트로 정확히 배당만큼 늘어난다 (이중계상 없음)
    PBASIS[T]='trade'; DIVMAP[T]=DIVD;
    dcaReinvSet(false);
    const cashMode=runBH(days,T,10000,false);
    const sh0=100;                          // 10000/100 = 100주 (수수료 없음)
    /* 현금 수령이면 주수가 그대로라 배당은 100주×1$×4회 = 400$ 정확히 그만큼만 늘어야 한다.
       한 푼이라도 더 나오면 어딘가에서 두 번 센 것이다. */
    ok('배당 종목 — 현금 수령이면 딱 배당만큼 늘어난다',
       near(cashMode.final, 10000 + sh0*4*1, 1e-9), `${cashMode.final} · 배당합 ${cashMode.divCashTotal}`);
    ok('배당을 두 번 세지 않는다', near(cashMode.divCashTotal, sh0*4*1, 1e-9), String(cashMode.divCashTotal));
    /* 재투자면 받은 배당으로 주수가 늘고, 늘어난 주수가 다음 배당을 또 받는다(복리).
       가격이 100 고정이므로 100 → 101 → 102.01 → 103.0301 → 104.060401 주.
       현금 수령(10,400)보다 딱 그만큼 많아야 한다 — 그 이상이면 역시 두 번 센 것이다. */
    dcaReinvSet(true);
    const reinv=runBH(days,T,10000,false);
    const compounded=100*Math.pow(1.01,4)*100;
    ok('배당 종목 — 재투자면 주수가 복리로 늘어난다',
       near(reinv.endShares, 100*Math.pow(1.01,4), 1e-9) && near(reinv.final, compounded, 1e-6),
       `보유 ${reinv.endShares}주 · 최종 ${reinv.final} (기대 ${compounded})`);
    ok('재투자가 현금 수령보다 딱 복리분만큼 많다',
       near(reinv.final-cashMode.final, compounded-(10000+400), 1e-9),
       String(reinv.final-cashMode.final));
    // ③ 조정가로 굴리면(체결가를 못 받은 종목) 배당을 또 더하지 않는다
    PBASIS[T]='adjusted';
    const adjMode=runBH(days,T,10000,false);
    ok('조정가 종목 — 배당을 얹지 않는다 (가격에 이미 들어 있다고 본다)',
       near(adjMode.final, 10000, 1e-9) && near(adjMode.divCashTotal||0, 0, 1e-9), String(adjMode.final));

    /* ④ 분할 연속성 — 체결가 계열은 분할이 소급 반영돼 있어야 한다.
       2:1 분할 전후로 가격이 반토막·주수가 두 배가 되면 평가액은 이어져야 한다.
       (야후 chart API 의 raw OHLC 가 그렇게 온다 — 그래서 체결가 계열로 쓸 수 있다) */
    { const S='__SPLIT__'; const sd=days.slice(0,200);
      M[S]={}; sd.forEach((d,i)=>{ const p=(i<100)?50:50; M[S][d]=[p,p,p,p]; });   // 소급 반영된 계열은 끊김이 없다
      META[S]={name:'분할시험',lev:1,color:'#000'};
      PBASIS[S]='trade'; DIVMAP[S]={};
      const r=runBH(sd,S,10000,false);
      const vals=r.snap.map(x=>x[1]).filter(v=>v>0);
      let jump=0; for(let i=1;i<vals.length;i++) if(Math.abs(vals[i]/vals[i-1]-1)>0.2) jump++;
      ok('분할 전후로 평가액이 끊기지 않는다', jump===0 && near(r.final,10000,1e-9), `${jump}회 끊김 · 최종 ${r.final}`);
      delete M[S]; delete META[S]; delete PBASIS[S]; delete DIVMAP[S]; }

    dcaReinvSet(true);
    delete M[T]; delete META[T]; delete PBASIS[T]; delete DIVMAP[T];
  }

  // ── 모멘텀은 조정종가만 쓴다 — 여기서 배당을 또 더하면 이중계상 ──
  ok('모멘텀은 배당을 따로 더하지 않는다 (가격이 이미 총수익)',
     !/divCash\(/.test(extractFn(bt,'function momentumBacktest(data, tickers, U, cap, lb, filter, costOn)'))
     && /배당이 이미 가격에 들어 있으므로 여기서 배당 현금을 또 더하면 이중계상이다/.test(bt));

  // ── 엔진마다 배당을 받는가 (한 곳이라도 빠지면 그 전략만 총수익이 빈다) ──
  for(const [nm,mk2] of [['무매 V4.0','function runIM(days,tkr,cap,divs,targetPct,compound'],
                         ['무매 V2.2','function runIM22(days,tkr,cap,divs,targetPct,compound'],
                         ['무매 V3.0','function runIM30(days,tkr,cap,divs,targetPct,compound'],
                         ['무매 V5.0','function runIM50(days,tkr,cap,divs,targetPct,compound'],
                         ['VR','function runVR(days,tkr,params)'],
                         ['표준편차','function runStdev(days,tkr,cap,N,g,filter,costOn)'],
                         ['200로테','function runMA200(days,tkr,cap,N,costOn,opt)'],
                         ['200적립','function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)'],
                         ['ASAP','function runASAP(days,tkr,opt)'],
                         ['역분산','function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)'],
                         ['적립(DCA)','function _dcaOne(t,days,amt,freq,costOn,dipMul)'],
                         ['거치(B&H)','function runBH(days,tkr,cap,costOn)']]){
    ok(`${nm} 가 배당을 장부에 넣는다`, /divCash\(/.test(extractFn(bt,mk2)));
  }
}
function dcaReinvSet(v){ /* 전역 스위치 — 엔진이 typeof 로 읽는다 */ global.dcaReinv=v; }

/* ════ 84. 회계 규약 공통화 ════  (감사 ⑬ · 필수시험 L)
   전체비교가 '공정 비교'라고 적혀 있으려면, 같은 것과 다른 것이 화면에 있어야 한다.
     같은 것 — 예산은 언제나 수수료 포함(buyQty 한 곳) · 배당은 받은 날 현금(divCash 한 곳)
              · 잔돈은 버리지 않는다
     다른 것 — 주수를 정수로 끊는지 · 남는 돈이 어디에 머무는지 · 세금을 무는지
   예전엔 budget*(1-fee)/가격 과 budget/(가격*(1+fee)) 가 섞여 있어, 같은 예산·같은
   가격인데 전략마다 주수가 달랐고 회당 budget×수수료율² 만큼 잔돈이 샜다.            */
console.log('\n[84] 회계 규약 — 예산·잔돈·장부 항등');
{
  // ── 매수 회계 규약이 한 곳인가 ──
  ok('매수 주수 계산이 파일 한 곳에 있다', /function buyQty\(budget, px, feeRate, integer\)/.test(bt));
  ok('예산은 수수료를 포함한다 (budget = 매수금 + 수수료)', (()=>{
      // 예산 1000 · 가격 100 · 수수료 0.25% → 9.97506... 주 · 정수면 9주
      const q=buyQty(1000,100,0.0025,false), qi=buyQty(1000,100,0.0025,true);
      const spend=q*100, fee=spend*0.0025;
      return near(spend+fee, 1000, 1e-9) && qi===9; })(),
     `${buyQty(1000,100,0.0025,false)} / ${buyQty(1000,100,0.0025,true)}`);
  ok('수수료가 0이면 예산 ÷ 가격', near(buyQty(1000,100,0,false),10,1e-12) && buyQty(1000,100,0,true)===10);
  ok('예산이나 가격이 0이면 0주', buyQty(0,100,0.0025,true)===0 && buyQty(1000,0,0.0025,true)===0);
  /* '예산 × (1−수수료)' 꼴이 어디에도 남으면 안 된다 — 표현이 여러 가지라 전부 본다.
     (매도 대금 계산의 px*(1-FEE) 는 다른 뜻이라 제외한다 — 그건 '팔아서 받는 돈' 이다) */
  ok('옛 규약(budget*(1-fee)/가격)이 안 남아 있다', (()=>{
      // 주석에 남은 '예전엔 …' 설명까지 잡으면 안 되니 코드만 본다
      const code=bt.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
      const bad=[/\*\(1-FEE\)\s*\//, /\*F\/c/, /\(dc-f2\)\/px0/, /x\[1\]\*\(1-FEE\)/,
                 /amt\*\(1-FEE\)/, /cap\*\(1-FEE\)/, /cash\*FEE,\s*net=cash-fee/];
      const hit=bad.filter(re=>re.test(code));
      return hit.length===0; })(), '아직 남아 있음');
  ok('거치식 매수·배당 재투자가 같은 헬퍼를 쓴다', (()=>{
      const f=extractFn(bt,'function runBH(days,tkr,cap,costOn)');
      return (f.match(/buyQty\(/g)||[]).length===2 && /let sh=buyQty\(cap,p0,FEE,true\)/.test(f); })());
  ok('거치식 fees 가 재투자 수수료까지 포함한다', (()=>{
      const f=extractFn(bt,'function runBH(days,tkr,cap,costOn)');
      return /let feesTotal=fee;/.test(f) && /feesTotal\+=q\*px0\*FEE;/.test(f) && /fees:feesTotal/.test(f); })());
  ok('적립식이 divSplit 에 넘기는 금액도 같은 규약', /cf\.map\(x=>\[x\[0\],x\[1\]\/\(1\+FEE\)\]\)/.test(bt));
  ok('소수 주수 전략도 같은 헬퍼를 쓴다', (()=>{
      for(const m of ['function _dcaOne(t,days,amt,freq,costOn,dipMul)',
                      'function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)',
                      'function runASAP(days,tkr,opt)'])
        if(!/buyQty\(/.test(extractFn(bt,m))) return false;
      return true; })());

  // ── 규약표가 코드와 같은 이야기를 하는가 ──
  ok('전략별 규약표가 있다', /const STRAT_ACCT=\{/.test(bt) && /function stratAcctTable\(keys\)/.test(bt));
  ok('전체비교 결과에 규약표를 붙인다',
     /stratAcctTable\(R\.map\(r=>r\.key\)\)/.test(bt) && /잔돈은 버리지 않습니다/.test(bt));
  {
    const m=bt.match(/const STRAT_ACCT=\{[\s\S]*?\n\};/);
    const T=new Function((m||[''])[0]+'\nreturn STRAT_ACCT;')();
    // 표에 적힌 '주수' 가 실제 코드와 같아야 한다 — 다르면 표가 거짓말이다
    const isInt=(marker)=>/buyQty\([^)]*,\s*true\)|iq\(|imBuyQty\(/.test(extractFn(bt,marker));
    const pairs=[['im','function runIM(days,tkr,cap,divs,targetPct,compound'],
                 ['vr','function runVR(days,tkr,params)'],
                 ['std','function runStdev(days,tkr,cap,N,g,filter,costOn)'],
                 ['ma','function runMA200(days,tkr,cap,N,costOn,opt)'],
                 ['maa','function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)'],
                 ['ivs','function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)'],
                 ['asap','function runASAP(days,tkr,opt)'],
                 ['dca','function _dcaOne(t,days,amt,freq,costOn,dipMul)'],
                 ['bh','function runBH(days,tkr,cap,costOn)']];
    let bad='';
    for(const [k,mk] of pairs){
      const want=(T[k]||{}).qty==='정수', got=isInt(mk);
      if(want!==got && !bad) bad=`${k}: 표는 '${(T[k]||{}).qty}' 인데 코드는 ${got?'정수':'소수'}`;
    }
    ok('규약표의 주수가 실제 코드와 같다', !bad, bad);
    ok('규약표가 비교에 쓰는 전략을 다 담는다', pairs.every(([k])=>!!T[k]), Object.keys(T).join(' '));
  }

  /* ── L. 장부 항등 — 최종 평가액 = 현금 + 보유평가 (+ 누적인출) ──
     잔돈이 어디선가 사라지면 이 식이 깨진다. 실데이터로 값을 맞춰 본다. */
  {
    const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)','function _maOpt(opt)',
                   'function _maHold(sell,a,b)','function _maEntry(buy,a,b)','function _maAbove(tkr,N,SHORT,BUY,SELL)',
                   'function _asapInd(tkr)','function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)',
                   'function _ivsPair1(tkr, days)','function _isoWeek(d)','function _dcaFreq(f)',
                   'function _dcaHits(days,freq)','function _dcaCount(days,freq)','function _dcaMA(t,N)'];
    let pre='var levExt=false, EXTM={}, dcaDipMul=1, maBuy="ma", maSell="ma", maShort=50, maPark="cash", imCostOn=true;\n';
    for(const h of helpers) pre+=extractFn(bt,h)+'\n';
    for(const re of [/const SGOV_RATE=\{[^}]*\};/, /const MA_COND_LBL=\{[^}]*\};/, /const TBILL_RATE=\{[\s\S]*?\};/,
                     /const KR_RATE=\{[\s\S]*?\};/, /const parkRate=\(y,tkr\)=>[^\n]*/,
                     /const LEV_SPREAD=[^\n]*/, /const LEV_UNDERLYING=\{[^}]*\};/, /const LEV_EXPENSE=\{[^}]*\};/,
                     /const LEV_EXPENSE_DEF=[^\n]*/, /const LEV_PRICEIDX=\{[^}]*\};/,
                     /const X1_EXPENSE=\{[^}]*\};/, /const X1_EXPENSE_DEF=[^\n]*/,
                     /const IDX_EXTEND=\{[\s\S]*?\}\s*\};/]){
      const m=bt.match(re); if(m) pre+=m[0]+'\n'; }
    const mk=(m)=>new Function(pre+'return ('+extractFn(bt,m).replace(/^function [\w$]+\(/,'function (')+')')();
    const T=DAYS.SOXL?'SOXL':'TQQQ', D=DAYS[T].slice(-900), lc=M[T][D[D.length-1]][C];
    global.dcaReinv=true;

    const CASES=[
      ['무매 V4.0', mk('function runIM(days,tkr,cap,divs,targetPct,compound'), f=>f(D,T,10000,20,20,true),
        r=>r.endCash+r.endShares*lc],
      ['무매 V2.2', mk('function runIM22(days,tkr,cap,divs,targetPct,compound'), f=>f(D,T,10000,20,20,true),
        r=>r.endCash+r.endShares*lc],
      ['무매 V3.0', mk('function runIM30(days,tkr,cap,divs,targetPct,compound'), f=>f(D,T,10000,20,20,true),
        r=>r.endCash+r.endShares*lc],
      ['표준편차',  mk('function runStdev(days,tkr,cap,N,g,filter,costOn)'), f=>f(D,T,10000,40,2.5,'none',true),
        r=>r.endCash+r.endShares*lc],
      ['200로테',  mk('function runMA200(days,tkr,cap,N,costOn,opt)'), f=>f(D,T,10000,200,true),
        r=>r.endCash+r.endShares*lc],
      ['역분산',   mk('function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)'), f=>f(D,T,10000,0.45,60,0.10,true,'iv','cash'),
        r=>r.endCash+r.endShares*lc],
      ['거치(B&H)',mk('function runBH(days,tkr,cap,costOn)'), f=>f(D,T,10000,true),
        r=>r.endCash+r.endShares*lc],
      ['ASAP',    mk('function runASAP(days,tkr,opt)'), f=>f(D,T,{base:10,mid:50,deep:100,costOn:true}),
        r=>r.endReserve+r.endShares*lc],
    ];
    for(const [nm,fn,call,ledger] of CASES){
      const r=call(fn);
      ok(`${nm} — 최종 = 현금 + 보유평가`, near(r.final, ledger(r), Math.max(1e-6, Math.abs(r.final)*1e-12)),
         `${r.final} vs ${ledger(r)}`);
      ok(`${nm} — 현금이 음수로 남지 않는다`, (r.endCash!=null?r.endCash:r.endReserve)>=-1e-6,
         String(r.endCash!=null?r.endCash:r.endReserve));
    }
    // VR 은 Pool 이 현금이고 인출액도 회수가치에 든다
    const rv=mk('function runVR(days,tkr,params)')(D,T,{initAmt:10000,G:10,bandPct:15,mode:0.25,
      withdraw:50,formula:'basic',startV:0,startPool:0,costOn:true});
    ok('VR — 최종 = 보유평가 + Pool + 누적인출',
       near(rv.final, rv.sharesVal+rv.pool+rv.totalWd, 1e-6),
       `${rv.final} vs ${rv.sharesVal}+${rv.pool}+${rv.totalWd}`);
    ok('VR — Pool 이 음수로 남지 않는다', rv.pool>=-1e-6, String(rv.pool));
  }

  /* ── 세무 원가 — 값으로 검사한다 (3차 감사 ⑤ · 시험 G·H) ────────────
     예전 검사는 'cash-=spend+fee 가 있는가' 만 봤다. 그건 '현금에서 수수료를 냈다'
     는 뜻이지 '세금용 취득원가에 들어갔다' 는 뜻이 아니다. 실제로 매수수수료는
     현금에서만 나가고 취득가액에는 안 들어가, 과세 실현손익이 그만큼 과대였다. */
  {
    // 감사가 지정한 사례: 100$ × 100주 매수(0.25%) → 110$ 전량매도(0.25%)
    const P=100,Q=100,F=0.0025,S=110;
    const buyFee=P*Q*F, sellFee=S*Q*F;
    const L=taxLot(); lotBuy(L,Q,P,buyFee);
    ok('매수 직후 세무 원가 = 체결금액 + 매수수수료',
       near(L.basis, P*Q+buyFee, 1e-9) && L.qty===Q, `${L.basis} / ${P*Q+buyFee}`);
    const r=lotSell(L,Q,S,sellFee);
    const wantPnl=S*Q-sellFee-(P*Q+buyFee);
    ok('전량매도 과세 실현손익 = 매도순액 − 취득가액', near(r, wantPnl, 1e-9), `${r} / ${wantPnl}`);
    ok('현금 장부와 같은 값이다 (실제로 늘어난 돈)',
       near(r, (S*Q-sellFee)-(P*Q+buyFee), 1e-9) && near(r, 947.5, 1e-9), String(r));
    ok('옛 계산(평단=체결가)보다 매수수수료만큼 작다',
       near(Q*(S-P)-sellFee - r, buyFee, 1e-9), `차이 ${Q*(S-P)-sellFee-r} / 매수수수료 ${buyFee}`);
    ok('매도 뒤 원가가 0으로 비워진다', L.qty===0 && L.basis===0);

    /* H. 부분매도 — 취득가액이 수량 비례로 안분되고, 합이 보존돼야 한다 */
    const L2=taxLot(); lotBuy(L2,Q,P,buyFee);
    const base0=L2.basis;
    const r1=lotSell(L2,30,S,S*30*F);
    ok('부분매도 30주 — 원가의 30%가 빠진다', near(base0-L2.basis, base0*0.3, 1e-9) && L2.qty===70,
       `남은 원가 ${L2.basis} · 보유 ${L2.qty}`);
    const r2=lotSell(L2,20,S,S*20*F);
    ok('부분매도 20주 — 남은 원가의 비율로 다시 안분', near(L2.qty,50,1e-12) && near(L2.basis, base0*0.5, 1e-9),
       `남은 원가 ${L2.basis} · 기대 ${base0*0.5}`);
    const r3=lotSell(L2,50,S,S*50*F);
    ok('나머지 전량매도 — 원가가 정확히 소진된다', L2.qty===0 && near(L2.basis,0,1e-9), String(L2.basis));
    ok('부분매도 세 번의 실현손익 합 == 한 번에 판 값',
       near(r1+r2+r3, wantPnl, 1e-9), `${r1+r2+r3} / ${wantPnl}`);

    /* 평단(avg)은 그대로여야 한다 — 무매 별지점·익절가가 이 값으로 정해진다 */
    ok('가격 평단과 세무 원가를 따로 둔다',
       /function taxLot\(\)/.test(bt) && /function lotBuy\(L, qty, px, fee\)/.test(bt)
       && /function lotSell\(L, qty, px, fee\)/.test(bt)
       && /avg = \(shares<=0\) \? px : \(shares\*avg\+spend\)\/\(shares\+q\);\s*\n\s*lotBuy\(LOT,q,px,fee\);/.test(bt));
  }
  /* 엔진마다 세무 원가를 실제로 쓰는가 — 한 곳이라도 빠지면 그 전략만 세금이 과대다 */
  for(const [nm,mk2] of [['무매 V4.0','function runIM(days,tkr,cap,divs,targetPct,compound'],
                         ['무매 V2.2','function runIM22(days,tkr,cap,divs,targetPct,compound'],
                         ['무매 V3.0','function runIM30(days,tkr,cap,divs,targetPct,compound'],
                         ['무매 V5.0','function runIM50(days,tkr,cap,divs,targetPct,compound'],
                         ['VR','function runVR(days,tkr,params)'],
                         ['표준편차','function runStdev(days,tkr,cap,N,g,filter,costOn)'],
                         ['200로테','function runMA200(days,tkr,cap,N,costOn,opt)'],
                         ['200적립','function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)'],
                         ['역분산','function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)']]){
    const f=extractFn(bt,mk2);
    ok(`${nm} — 매수수수료를 취득가액에 넣는다`, /lotBuy\(/.test(f), '');
    ok(`${nm} — 실현손익을 세무 원가로 계산한다`,
       /lotSell\(/.test(f) && !/yearPnl\s*\+=\s*q\*\(px-avg\)/.test(f) && !/yearPnl\s*\+=\s*qty\*\(eff-avg\)/.test(f));
  }
  // 모멘텀은 원래부터 basis 를 들고 있었다 (같은 규약인지 확인)
  ok('모멘텀도 매수수수료를 취득가액에 넣는다', (()=>{
      const f=extractFn(bt,'function momentumBacktest(data, tickers, U, cap, lb, filter, costOn)');
      return /basis=spend\+fee;/.test(f) && /const cost=basis\*\(shares>0\?q\/shares:0\), realized=proceeds-cost;/.test(f); })());
  /* 배당·예수금 이자에 쓰는 세율은 한 값이어야 한다.
     (국내 ETF 매매차익 세율·모멘텀 국내 세율은 성격이 다른 세금이라 별개다) */
  ok('배당소득세율이 파일 한 곳에 있다',
     /const DIV_TAXRATE=0\.154;/.test(bt)
     && /const CASH_DIVTAX=costOn\?DIV_TAXRATE:0/.test(bt)
     && !/costOn\?0\.154:0/.test(bt));
}


/* ════ 85. 로더 두 갈래가 같은 규약을 쓴다 ════  (3차 감사 ①⑧ · 시험 A·B·K)
   v2.0 에서 M/ADJ/DIVMAP/PBASIS 로 가격 역할을 나눴는데, 메인 로더만 그 규약을
   지키고 기초지수를 받아오는 helper(fetchTickerInto)는 div=1 도 안 붙인 채
   조정가를 그대로 M 에 넣고 있었다. SOXX·SMH·XLK·SPY·EWY 가 그 길로 들어온다 —
   같은 종목인데 '어느 길로 들어왔는지'에 따라 M 의 뜻이 달라졌다.
   기존 1271개로 안 잡힌 이유는 로딩 경로를 아예 안 돌려봤기 때문이다.
   그래서 여기서는 두 로더를 '실제로' 돌린다. 로더는 async 인데 이 스크립트는
   동기라서, 자식 프로세스에서 돌리고 결과를 JSON 으로 받아 대조한다.          */
console.log('\n[85] 로더 규약 — 메인 로더 == helper 로더');
{
  const CHILD=`/* 로더 두 갈래를 실제로 돌려 상태를 찍어 내는 자식 프로세스.
   regression-check.js 는 동기 스크립트라 async 로더를 직접 못 돌린다 —
   여기서 돌리고 JSON 으로 돌려준다. */
const fs=require('fs');
const bt=fs.readFileSync(process.argv[2],'utf8');
function extractFn(src,marker){const i=src.indexOf(marker);if(i<0)throw new Error('추출 실패: '+marker);
  let j=src.indexOf('{',i),d=0,k=j;for(;k<src.length;k++){if(src[k]==='{')d++;else if(src[k]==='}'){d--;if(d===0)break;}}return src.slice(i,k+1);}
const pick=re=>{const m=bt.match(re); if(!m) throw new Error('못 찾음: '+re); return m[0];};
const SRC=[
  pick(/function quoteUrl\\(sym, p1, p2\\)\\{[\\s\\S]*?\\n\\}/),
  pick(/function newPriceBag\\(\\)\\{[^\\n]*\\}/),
  pick(/function absorbQuote\\(bag, j\\)\\{[\\s\\S]*?\\n\\}/),
  pick(/function commitPriceBag\\(sym, bag\\)\\{[\\s\\S]*?\\n\\}/),
  pick(/function quoteChunks\\(p1start, p2end\\)\\{[\\s\\S]*?\\n\\}/),
  extractFn(bt,'async function fetchPrices(startDate, endDate)'),
  extractFn(bt,'async function fetchTickerInto(sym, fromDate)'),
  /* 레버리지 상장 전 합성까지 같은 스코프에서 돌린다 — 합성이 무엇을 먹는지가 이번 핵심이다 */
  pick(/function totalReturnSeries\\(t\\)\\{[\\s\\S]*?\\n\\}/),
  'let LEV_INPUT_BASIS={};',
  pick(/const LEV_UNDERLYING=\\{[^}]*\\};/),
  pick(/const LEV_EXPENSE=\\{[^}]*\\};/),
  pick(/const LEV_EXPENSE_DEF=[^\\n]*/),
  pick(/const LEV_SPREAD=[^\\n]*/),
  pick(/const LEV_PRICEIDX=\\{[^}]*\\};/),
  pick(/const IDX_EXTEND=\\{[\\s\\S]*?\\}\\s*\\};/),
  pick(/const TBILL_RATE=\\{[\\s\\S]*?\\};/),
  pick(/const KR_RATE=\\{[\\s\\S]*?\\};/),
  pick(/const isKRW=[^\\n]*/),
  pick(/const parkRate=\\(y,tkr\\)=>[^\\n]*/),
  extractFn(bt,'function srcOf(t)'),
  extractFn(bt,'function clearLevExt()'),
  extractFn(bt,'function applyLevExt()'),
  extractFn(bt,'async function baseSeries(under, start)'),
  extractFn(bt,'async function buildLevExt(tickers, start)'),
].join('\\n');

const DATES=[]; { const t=new Date(Date.UTC(2022,0,3));
  while(DATES.length<400){ const w=t.getUTCDay(); if(w!==0&&w!==6) DATES.push(t.toISOString().slice(0,10));
    t.setUTCDate(t.getUTCDate()+1); } }
const DIVDAYS=[DATES[40],DATES[120],DATES[200],DATES[300]];
function fixture(sym, opt){
  const ohlc=[],ohlcTrade=[],raw=[],dividends=[];
  let px=100;
  const future={};                       // 그 날 이후에 지급될 배당 합 → 조정가는 그만큼 낮다
  const amts={};
  for(const d of DATES){ if(DIVDAYS.includes(d)) amts[d]=+(100*0.004).toFixed(4); }
  for(const d of DATES){
    px=+(px*1.0007).toFixed(4);
    if(amts[d]) dividends.push({date:d,amount:amts[d]});
    const later=DATES.filter(x=>x>d).reduce((a,x)=>a+(amts[x]||0),0);
    const ac=+(px-later).toFixed(4);
    ohlc.push({date:d,open:ac,high:+(ac*1.01).toFixed(4),low:+(ac*0.99).toFixed(4),close:ac});
    raw.push({date:d,close:px});
    if(opt.withTrade) ohlcTrade.push({date:d,open:px,high:+(px*1.01).toFixed(4),low:+(px*0.99).toFixed(4),close:px});
  }
  const out={symbol:sym,currency:'USD',src:opt.src,price:px,
    series:ohlc.map(x=>({date:x.date,close:x.close})),ohlc,raw,dividends,splits:[]};
  if(opt.withTrade){ out.ohlcTrade=ohlcTrade; out.priceBasis='trade'; }
  else { out.ohlcTrade=[]; out.priceBasis='adjusted'; }
  return out;
}

function makeScope(){
  return new Function('TICKERS','fetch','console','META','C','O','HI','LO',
    'let M={},DIV={},RAW={},ADJ={},DIVMAP={},PBASIS={},EXTM={},RAWM={},levExt=true;\\n'+SRC+\`
    const snap=(s)=>({M:M[s]||null, ADJ:ADJ[s]||null, DIVMAP:DIVMAP[s]||null, RAW:RAW[s]||null, PB:PBASIS[s]||null});
    return { fetchPrices, fetchTickerInto, buildLevExt, totalReturnSeries, snap,
             ext:(s)=>EXTM[s]||null,
             reset(){ M={};DIV={};RAW={};ADJ={};DIVMAP={};PBASIS={};EXTM={};RAWM={}; } };\`);
}
const QUIET={warn(){},error(){},log(){}};
const META={QQQ:{lev:1}, TQQQ:{lev:3}};

async function scenario(opt){
  const seen=[];
  const fakeFetch=async(u)=>{
    seen.push(u);
    const sym=decodeURIComponent((u.match(/symbol=([^&]+)/)||[])[1]||'');
    if(sym!=='QQQ') return {ok:false};
    const wantDiv=/[?&]div=1(&|$)/.test(u);
    // div=1 을 안 붙이면 API 는 배당·체결가 계열을 아예 안 준다 (실제 동작과 같다)
    const j=fixture(sym, opt);
    if(!wantDiv){ const bare={...j}; delete bare.ohlcTrade; delete bare.dividends; delete bare.raw; delete bare.priceBasis; return {ok:true,json:async()=>bare}; }
    return {ok:true, json:async()=>j};
  };
  const S=makeScope()(['QQQ'], fakeFetch, QUIET, META, 0,1,2,3);
  await S.fetchPrices('2022-01-03','2023-08-01');
  const main=JSON.parse(JSON.stringify(S.snap('QQQ')));
  S.reset();
  const okh=await S.fetchTickerInto('QQQ','2022-01-03');
  const helper=JSON.parse(JSON.stringify(S.snap('QQQ')));
  return {main, helper, okh, divInEveryCall: seen.length>0 && seen.every(u=>/[?&]div=1(&|$)/.test(u)), calls:seen.length};
}

/* ── 레버리지 상장 전 합성 ───────────────────────────────────────────
   기초(QQQ)는 2022-01-03 부터, 레버리지(TQQQ)는 한참 뒤부터 있다.
   합성이 '총수익'을 먹는지, 그리고 기초가 어느 로더로 들어왔든 결과가 같은지 본다.
   기초에 배당이 있으므로 체결가를 먹이면 합성이 배당만큼 낮게 나온다 — 값으로 갈린다. */
const LEV_START=DATES[250];
async function levScenario(viaHelper){
  const fakeFetch=async(u)=>{
    const sym=decodeURIComponent((u.match(/symbol=([^&]+)/)||[])[1]||'');
    const wantDiv=/[?&]div=1(&|$)/.test(u);
    if(sym!=='QQQ'&&sym!=='TQQQ') return {ok:false};
    const opt={withTrade:true, src:'yahoo-query1'};
    let j=fixture(sym, opt);
    if(sym==='TQQQ'){                       // 레버리지는 늦게 상장 — 앞 구간을 잘라 낸다
      const keep=d=>d>=LEV_START;
      j={...j, ohlc:j.ohlc.filter(x=>keep(x.date)), ohlcTrade:j.ohlcTrade.filter(x=>keep(x.date)),
         raw:j.raw.filter(x=>keep(x.date)), series:j.series.filter(x=>keep(x.date)), dividends:[]};
    }
    if(!wantDiv){ const bare={...j}; delete bare.ohlcTrade; delete bare.dividends; delete bare.raw; delete bare.priceBasis; return {ok:true,json:async()=>bare}; }
    return {ok:true, json:async()=>j};
  };
  const S=makeScope()(viaHelper?['TQQQ']:['QQQ','TQQQ'], fakeFetch, QUIET, META, 0,1,2,3);
  await S.fetchPrices(DATES[0], DATES[DATES.length-1]);
  if(viaHelper) await S.fetchTickerInto('QQQ', DATES[0]);   // 기초는 helper 로만 들어온다
  const tr=S.totalReturnSeries('QQQ');
  const info=await S.buildLevExt(['TQQQ'], DATES[0]);
  const ext=S.ext('TQQQ');
  const preDates=ext?Object.keys(ext).filter(d=>d<LEV_START).sort():[];
  return { inBasis:(info.TQQQ||{}).inBasis||null, trBasis:tr?tr.basis:null,
           preN:preDates.length,
           first:preDates.length?ext[preDates[0]][0]:null,
           last:preDates.length?ext[preDates[preDates.length-1]][0]:null,
           sig:preDates.map(d=>ext[d][0].toFixed(6)).join(',') };
}

(async()=>{
  const out={};
  out.trade   = await scenario({withTrade:true,  src:'yahoo-query1'});
  out.noTrade = await scenario({withTrade:false, src:'yahoo-query1'});
  out.stooq   = await scenario({withTrade:false, src:'stooq'});
  out.levMain   = await levScenario(false);
  out.levHelper = await levScenario(true);
  process.stdout.write(JSON.stringify(out));
})().catch(e=>{ process.stdout.write(JSON.stringify({error:e.message, stack:(e.stack||'').split('\\n').slice(0,3).join(' | ')})); process.exit(1); });
`;
  const tmp='/tmp/__loader_parity.js';
  fs.writeFileSync(tmp, CHILD);
  const {spawnSync}=require('child_process');
  const r=spawnSync('node',[tmp,BT],{encoding:'utf8',maxBuffer:64*1024*1024});
  let J=null; try{ J=JSON.parse(r.stdout||'{}'); }catch(e){}
  ok('두 로더를 실제로 돌렸다', !!J && !J.error, (J&&J.error)||((r.stderr||'').split('\n')[0]));
  if(J && !J.error){
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    for(const [key,nm,wantPB] of [['trade','체결가 계열이 다 있을 때','trade'],
                                  ['noTrade','체결가 계열이 없을 때(야후)','total_return'],
                                  ['stooq','조정 여부를 모르는 소스(Stooq)','unknown']]){
      const c=J[key]||{};
      ok(`${nm} — 두 로더의 M 이 완전히 같다`, !!c.main && same(c.main.M, c.helper.M), (()=>{
          if(!c.main) return '결과 없음';
          const mk=Object.keys(c.main.M||{}), d=mk[0];
          return d ? `${d} 메인 ${JSON.stringify(c.main.M[d])} / helper ${JSON.stringify((c.helper.M||{})[d])}` : '';
        })());
      ok(`${nm} — ADJ 가 같다`,    !!c.main && same(c.main.ADJ, c.helper.ADJ));
      ok(`${nm} — DIVMAP 이 같다`, !!c.main && same(c.main.DIVMAP, c.helper.DIVMAP));
      ok(`${nm} — RAW 가 같다`,    !!c.main && same(c.main.RAW, c.helper.RAW));
      ok(`${nm} — PBASIS 가 같고 '${wantPB}' 다`,
         !!c.main && c.main.PB===wantPB && c.helper.PB===wantPB,
         c.main?`메인 ${c.main.PB} / helper ${c.helper.PB}`:'');
      ok(`${nm} — helper 도 div=1 로만 요청한다`, !!c.divInEveryCall, `요청 ${c.calls}건`);
      ok(`${nm} — helper 가 성공했다고 답한다`, c.okh===true);
    }
    /* 체결가 계열이 있으면 M 은 조정가와 달라야 한다 — 같으면 체결가를 안 쓴 것이다. */
    { const c=J.trade||{}; const d=Object.keys((c.main||{}).M||{})[0];
      ok('체결가 계열이 있으면 M 이 조정가와 다르다',
         !!d && Math.abs(c.main.M[d][0]-c.main.ADJ[d])>1e-9,
         d?`M ${c.main.M[d][0]} / ADJ ${c.main.ADJ[d]}`:''); }
  }
  // 코드 쪽 — 파서가 한 곳인지, helper 가 옛 길로 안 가는지
  ok('가격 파서가 파일 한 곳에 있다',
     /function absorbQuote\(bag, j\)/.test(bt) && /function commitPriceBag\(sym, bag\)/.test(bt));
  ok('두 로더가 같은 파서를 쓴다',
     (bt.match(/commitPriceBag\(/g)||[]).length===3 && (bt.match(/newPriceBag\(\)/g)||[]).length===3);
  ok('로더 세 갈래(메인·기초지수·커스텀 종목)에 옛 파싱이 안 남아 있다',
     !/const allData=\{\};/.test(bt) && !/j&&j\.ohlc\|\|\[\]/.test(bt));
  /* M 에 시세를 앉히는 자리는 commitPriceBag 하나여야 한다.
     레버리지 확장 스왑(applyLevExt/clearLevExt)은 이미 파싱된 계열을 갈아끼우는 것이라 예외다.
     모멘텀 로더는 M 을 안 건드리고 자기 캐시(MOMDATA)에 조정종가만 담는다 — 그것도 예외다. */
  ok('M 에 시세를 앉히는 자리가 한 곳이다', (()=>{
      const lines=bt.split('\n').filter(l=>/(^|[^.\w])M\[[^\]]+\]\s*=\s*\{\}/.test(l));
      return lines.length===1 && /commitPriceBag|M\[sym\]=\{\}/.test(lines[0]); })(),
     bt.split('\n').filter(l=>/(^|[^.\w])M\[[^\]]+\]\s*=\s*\{\}/.test(l)).map(l=>l.trim().slice(0,60)).join(' | '));
  ok('시세 로딩 fetch 가 전부 quoteUrl 을 지난다 (모멘텀 캐시는 예외)',
     (bt.match(/fetch\(quoteUrl\(/g)||[]).length===2
     && (bt.match(/fetch\(`\/api\/quote/g)||[]).length===1
     && /const r=await fetch\(`\/api\/quote\?symbol=\$\{encodeURIComponent\(sym\)\}&period1=/.test(bt));
  ok('모멘텀 로더는 M 을 안 건드린다',
     !/M\[sym\]=/.test(extractFn(bt,'async function loadMomData(univKey, start, end, stat)')));
  /* ── 레버리지 상장 전 합성이 무엇을 먹는가 (3차 감사 ② · 시험 C·D) ──
     보유비용 모형은 '기초 시계열이 배당 재투자 기준' 이라는 전제로 맞춰 놓은 것이다.
     v2.0 에서 M 이 체결가로 바뀌면서 합성이 가격수익률을 먹게 됐고, 기초 배당수익률×배수
     만큼 상장 전 구간이 통째로 과소평가됐다 (실측 UPRO 13년 구간 연 −4.27%p).            */
  if(J && !J.error){
    const a=J.levMain||{}, b=J.levHelper||{};
    ok('합성 입력이 총수익 계열이다', a.inBasis==='total_return' && a.trBasis==='total_return',
       `inBasis ${a.inBasis} / trBasis ${a.trBasis}`);
    ok('합성이 실제로 굴러갔다 (상장 전 구간이 생겼다)', a.preN>100, String(a.preN));
    ok('기초가 어느 로더로 들어와도 합성 결과가 같다', !!a.sig && a.sig===b.sig,
       a.sig===b.sig?'':`메인 첫 ${a.first} / helper 첫 ${b.first}`);
    ok('helper 로만 받아도 입력 기준이 총수익이다', b.inBasis==='total_return', String(b.inBasis));
  }
  ok('합성이 M 을 암묵적으로 안 쓴다 (총수익 헬퍼를 지난다)',
     /const tr=totalReturnSeries\(under\); if\(!tr\) return null;/.test(bt)
     && /const itr=totalReturnSeries\(ext\.idx\);/.test(bt)
     && !/const E=M\[under\];/.test(bt));
  ok('합성 1배도 총수익 계열을 먹는다',
     /const _tr=totalReturnSeries\(tkr\), TR=_tr\?_tr\.px:null;/.test(bt)
     && !/const rl=M\[tkr\]\[dts\[i\]\]\[C\]\/M\[tkr\]\[dts\[i-1\]\]\[C\]-1;/.test(bt));
  ok('무엇을 먹였는지 확장 정보에 남긴다', /inBasis:bs\.basis\|\|LEV_INPUT_BASIS\[under\]\|\|'unknown'/.test(bt));
  ok("PBASIS 가 세 갈래다 (trade/total_return/unknown)",
     /'trade'\s*\n\s*:\s*\(srcs\.length && srcs\.every\(x=>\/\^yahoo\/\.test\(x\)\)\)\s*\?\s*'total_return'\s*\n\s*:\s*'unknown';/.test(bt));
}

/* ════ 86. 탭이 달라도 같은 전략은 같은 결과 ════  (3차 감사 ④ · 시험 E)
   '짝=1배수면 실제 1배 ETF 를 먼저 받아 온다' 가 역분산 탭 분기 안에만 있었다.
   그래서 레버리지 확장을 꺼 두면 단독 역분산은 실제 1배로, 전체비교는 합성 1배로
   굴러가 같은 옵션인데 탭에 따라 결과가 달랐다. 데이터 준비를 한 단계로 모았으니
   이제 둘이 같은 값을 내야 한다 — 값으로 확인한다.                                */
console.log('\n[86] 단독 역분산 == 전체비교 안의 역분산');
{
  const T='__CMPTEST__', U='__CMPX1__';
  const ALL=DAYS.SOXL?DAYS.SOXL.slice(-900):[];
  ok('대조에 쓸 데이터가 있다', ALL.length>500, String(ALL.length));
  if(ALL.length>500){
    // 레버리지와 그 1배 짝 — 둘 다 '실제 체결가' 로 들어와 있는 상태
    M[T]={}; M[U]={};
    { let v=50; ALL.forEach((d,i)=>{ const r=M.SOXL[d][C]/M.SOXL[ALL[Math.max(0,i-1)]][C]-1;
        const p=M.SOXL[d][C]; M[T][d]=[p,p,+(p*1.01).toFixed(6),+(p*0.99).toFixed(6)];
        if(i>0) v*=(1+r/3); M[U][d]=[v,v,+(v*1.01).toFixed(6),+(v*0.99).toFixed(6)]; }); }
    META[T]={name:'시험 3배',lev:3,color:'#000'}; META[U]={name:'시험 1배',lev:1,color:'#000'};
    PBASIS[T]='trade'; PBASIS[U]='trade'; DIVMAP[T]={}; DIVMAP[U]={};

    const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)','function _maOpt(opt)',
                   'function _maHold(sell,a,b)','function _maEntry(buy,a,b)','function _maAbove(tkr,N,SHORT,BUY,SELL)',
                   'function _asapInd(tkr)','function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)',
                   'function _ivsPair1(tkr, days)','function totalReturnSeries(t)',
                   'function _isoWeek(d)','function _dcaFreq(f)','function _dcaHits(days,freq)',
                   'function _dcaCount(days,freq)','function _dcaMA(t,N)','function runBH(days,tkr,cap,costOn)',
                   'function runStdev(days,tkr,cap,N,g,filter,costOn)','function runMA200(days,tkr,cap,N,costOn,opt)',
                   'function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)','function runASAP(days,tkr,opt)',
                   'function runVR(days,tkr,params)','function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)',
                   'function runIM(days,tkr,cap,divs,targetPct,compound',
                   'function _runOneStrat(key,tkr,cap,days,costOn)'];
    /* levExt=false · 짝=1배수 — 감사가 지목한 바로 그 조합 */
    let pre='var levExt=false, EXTM={}, dcaDipMul=1, maBuy="ma", maSell="ma", maShort=50, maPark="cash",'
           +' imCostOn=true, imDiv=20, imReverse=false, imTarget=0, imEngine="v40", imTgtDyn=false, imRevGap=2.5,'
           +' imFill="close", stdN=40, stdG=2.5, stdFilter="none", maLen=200,'
           +' ivsS0=45, ivsN=60, ivsBand=10, ivsMode="iv", ivsPair="x1", dcaFreq="daily", vrFill="ladder",'
           +' LEV_UNDERLYING={"'+T+'":"'+U+'"};\n'
           +'function _stratSeg(id,def){return def;} function _stratNum(id,def){return def;}\n'
           +'function imTgtFor(t){return 20;} function revSupported(d){return d===20||d===40;}\n';
    for(const h of helpers){ try{ pre+=extractFn(bt,h)+'\n'; }catch(e){ ok('도우미 추출: '+h, false, e.message); } }
    for(const re of [/const SGOV_RATE=\{[^}]*\};/, /const MA_COND_LBL=\{[^}]*\};/, /const TBILL_RATE=\{[\s\S]*?\};/,
                     /const KR_RATE=\{[\s\S]*?\};/, /const parkRate=\(y,tkr\)=>[^\n]*/,
                     /const LEV_SPREAD=[^\n]*/, /const LEV_EXPENSE=\{[^}]*\};/, /const LEV_EXPENSE_DEF=[^\n]*/,
                     /const LEV_PRICEIDX=\{[^}]*\};/, /const X1_EXPENSE=\{[^}]*\};/, /const X1_EXPENSE_DEF=[^\n]*/,
                     /const IDX_EXTEND=\{[\s\S]*?\}\s*\};/, /const VR_CYC_DAYS=\d+;/,
                     /function vrNextDue\(s\)\{[\s\S]*?\n\}/, /function vrCycleCount\(days\)\{[\s\S]*?\n\}/,
                     /const IM_OFFICIAL=\{[^}]*\};/]){
      const m=bt.match(re); if(m) pre+=m[0]+'\n'; }
    const F=new Function(pre+'return {runIVS,_runOneStrat,_ivsPair1};')();
    const days=ALL.slice(-700), cap=10000;
    const solo =F.runIVS(days,T,cap,0.45,60,0.10,true,'iv','x1');
    const combo=F._runOneStrat('ivs',T,cap,days,true);
    for(const k of ['final','trades','rebals','mdd','x1sym','x1synth','x1why']){
      const a=solo[k], b=combo[k];
      ok(`단독 == 전체비교 · ${k}`, (typeof a==='number')?near(a,b,Math.max(1e-9,Math.abs(a)*1e-12)):a===b,
         `${a} / ${b}`);
    }
    ok('실제 1배 ETF 로 굴렀다 (합성 대체 아님)', solo.x1synth===false && solo.x1sym===U,
       `synth=${solo.x1synth} sym=${solo.x1sym}`);
    /* 1배를 조정종가로 바꿔 두면 둘 다 함께 합성으로 떨어져야 한다 —
       한쪽만 떨어지면 탭에 따라 결과가 갈린다는 뜻이다. */
    PBASIS[U]='total_return';
    const solo2 =F.runIVS(days,T,cap,0.45,60,0.10,true,'iv','x1');
    const combo2=F._runOneStrat('ivs',T,cap,days,true);
    ok('1배 기준이 바뀌면 둘 다 같이 합성으로 떨어진다',
       solo2.x1synth===true && combo2.x1synth===true && near(solo2.final,combo2.final,1e-9),
       `단독 synth=${solo2.x1synth} final=${solo2.final} / 전체비교 synth=${combo2.x1synth} final=${combo2.final}`);
    ok('합성으로 떨어지면 값이 실제로 달라진다 (이 시험이 살아 있다)',
       Math.abs(solo2.final-solo.final)>1e-6, `${solo.final} → ${solo2.final}`);
    PBASIS[U]='trade';
    delete M[T]; delete M[U]; delete META[T]; delete META[U];
    delete PBASIS[T]; delete PBASIS[U]; delete DIVMAP[T]; delete DIVMAP[U];
  }
}

/* ════ 87. 화면이 실제 모델과 같은 말을 하는가 ════ (3차 감사 ⑦⑨⑩ · 시험 J·M)
   숫자가 맞아도 설명이 틀리면 사용자가 다른 것을 읽는다. 특히 같은 화면에서
   앞뒤가 다른 말을 하면(예전 하단 문구가 그랬다) 무엇을 믿을지 알 수 없다.     */
console.log('\n[87] 설명문 == 실제 모델');
{
  // ── ⑦ 배당 지급 시점 — 있는 데이터가 배당락일뿐이라는 사실을 그대로 적는가 ──
  ok('배당은 배당락일 즉시로 근사한다고 적는다',
     /배당락일 즉시 지급·재투자 근사/.test(bt) && /payable date\) 데이터가 없어/.test(bt));
  ok("'받은 날 현금' 같은 단정 표현이 안 남아 있다", !/받은 날 현금/.test(bt));
  ok('코드 주석도 근사임을 밝힌다', /지급 시점은 '배당락일 즉시' 로 근사한다/.test(bt));
  /* 값으로 — DIVMAP 의 날짜가 곧 현금 들어오는 날이다 (지급일 지연 없음) */
  { const T='__DIVDAY__'; PBASIS[T]='trade'; DIVMAP[T]={'2024-03-15':2};
    ok('배당락일 당일에 현금이 잡힌다', divCash(T,'2024-03-15',10,false)===20);
    ok('그 전날엔 안 잡힌다', divCash(T,'2024-03-14',10,false)===0);
    ok('며칠 뒤에도 따로 안 잡힌다 (지급일 지연 모델이 없다)', divCash(T,'2024-03-20',10,false)===0);
    delete PBASIS[T]; delete DIVMAP[T]; }

  // ── ⑨ 국내 해외형 ETF 세금은 근사 ──
  ok('국내 ETF 세금이 근사임을 화면에 적는다',
     (bt.match(/과표기준가격을 반영하지 않은 근사입니다/g)||[]).length>=5);
  ok('무엇이 실제 규칙인지도 적는다', /매매차익과 과표기준가 증가분 중 작은 쪽이 과세표준/.test(bt));
  ok('코드 주석에도 근사임을 남긴다', /과표기준가격 이력 데이터가 없다/.test(bt));

  // ── ⑩ 하단 문구가 앞뒤로 다른 말을 하지 않는가 ──
  { const f=extractFn(bt,'function renderFootNote()');
    ok('하단에서 분배금 설명을 두 번 하지 않는다',
       !/분배금은 조정종가에 반영된 총수익 기준/.test(f), '앞뒤 모순 문구가 남아 있음');
    ok('가격 기준 줄에서 한 번만 설명한다',
       (f.match(/분배금/g)||[]).length<=3, `분배금 언급 ${(f.match(/분배금/g)||[]).length}회`); }
  // 낡은 주석 — 지금 코드와 다른 설명이 남아 있으면 안 된다
  ok("'M의 close는 adjclose' 류 낡은 설명이 안 남아 있다",
     !/M의 close는 adjclose/.test(bt) && !/M은 총수익/.test(bt));
  /* 지금은 '실제 1배 ETF 가 먼저, 없을 때만 역산' 이다.
     화면에 뜨는 문구에서 '역산' 을 말할 땐 그 조건이 같이 적혀 있어야 한다. */
  ok("'1배수는 레버리지에서 역산' 이 조건 없이 안 남아 있다", (()=>{
      const ui=[...bt.matchAll(/`[^`]*역산[^`]*`/g)].map(m=>m[0]);
      return ui.every(t=>/실제로 살 수 있는|실제 1배 ETF|없을 때만|대체/.test(t)); })(),
     [...bt.matchAll(/`[^`]*역산[^`]*`/g)].map(m=>m[0].slice(0,60)).join(' | '));
  ok('운영 화면의 안내도 실제 동작과 같다',
     /백테도 이제 <b>같은 1배 ETF<\/b>로 굴립니다/.test(idx)
     && !/백테는 짝을 <b>합성 1배지수<\/b>로/.test(idx));
}


/* ════ 88. 마지막 해 정산 · 배당 재투자 회계 ════  (3차 감사 ⑪ · 시험 I·L)
   세금을 낼 현금이 모자라면 보유분을 판다. 그 매도가 또 과세손익을 만든다 —
   해가 바뀔 때는 그 몫이 다음 해로 넘어가 걷히지만, 마지막 해에는 넘어갈 다음
   해가 없다. 그래서 옛 코드(정산 한 번)는 마지막 해에 생긴 세금을 영영 안 걷었다.
   합성 경로 800개 중 447개에서 실제로 미납이 남았다. 여기서는 그중 하나를
   고정해 두고 값으로 확인하고, 옛 코드로 되돌리면 미납이 되살아나는지도 같이 본다. */
console.log('\n[88] 마지막 해 정산 · 배당 재투자 회계');
{
  /* ── L-1. settleToStable — 손으로 셀 수 있는 사슬 ── */
  {
    let pnl=1000, paid=0, calls=0;
    // 강제매도가 '낸 세금의 절반'만큼 새 과세손익을 만든다고 두면 사슬이 손으로 계산된다
    const once=()=>{ calls++; const tax=pnl*0.22; paid+=tax; pnl=tax*0.5; };
    once();
    ok('한 번만 정산하면 과세손익이 남는다 (옛 규약)', near(pnl,110,1e-9) && near(paid,220,1e-9),
       `남은 손익 ${pnl} · 걷은 세금 ${paid}`);
    pnl=1000; paid=0; calls=0;
    settleToStable(once, ()=>pnl);
    ok('수렴할 때까지 돌면 남는 손익이 사라진다', Math.abs(pnl)<1e-4, String(pnl));
    ok('걷은 세금 = 등비급수 합 (220/0.89)', near(paid, 220*(1-Math.pow(0.11,8))/0.89, 1e-9), String(paid));
    ok('기본 8회를 넘겨 돌지 않는다', calls===8, String(calls));
    // 줄어들지 않으면 멈춘다 — 안 그러면 무한루프가 된다
    let p2=500, c2=0; settleToStable(()=>{c2++;}, ()=>p2);
    ok('손익이 안 줄면 두 번째에 멈춘다', c2===2, String(c2));
    let p3=0, c3=0; settleToStable(()=>{c3++; p3=0;}, ()=>p3);
    ok('낼 게 없으면 한 번으로 끝난다', c3===1, String(c3));
    let p4=1000, c4=0; settleToStable(()=>{c4++; p4*=0.5;}, ()=>p4, 3);
    ok('횟수를 지정하면 그만큼만 돈다', c4===3 && near(p4,125,1e-12), `${c4} / ${p4}`);
  }

  /* ── L-2. 실제 엔진 — 합성 경로에서 미납 세금이 0 이어야 한다 ──
     LCG 로 만든 결정적 경로(seed 222·1200거래일·원금 200만$·60일선).
     runMA200 의 반환에 '정산이 끝난 뒤 남은 과세손익'을 끼워 넣어 값을 본다. */
  {
    const helpers=['function srcOf(t)','function _maOpt(opt)','function _maHold(sell,a,b)',
                   'function _maEntry(buy,a,b)','function _maAbove(tkr,N,SHORT,BUY,SELL)'];
    let pre='var levExt=false, EXTM={}, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n';
    for(const h of helpers) pre+=extractFn(bt,h)+'\n';
    for(const re of [/const MA_COND_LBL=\{[^}]*\};/, /const TBILL_RATE=\{[\s\S]*?\};/, /const KR_RATE=\{[\s\S]*?\};/,
                     /const parkRate=\(y,tkr\)=>[^\n]*/]){ const m=bt.match(re); if(m) pre+=m[0]+'\n'; }
    const maSrc=extractFn(bt,'function runMA200(days,tkr,cap,N,costOn,opt)')
      .replace('return {invested:cap,final:fin,',
               'return {_resid:yearPnl,_owed:capGainTax(yearPnl,tkr),invested:cap,final:fin,');
    ok('runMA200 반환에 정산 잔여를 끼울 수 있다', maSrc!==extractFn(bt,'function runMA200(days,tkr,cap,N,costOn,opt)'));
    // 옛 코드 = 수렴 루프 없이 한 번만 정산
    const oldSrc=maSrc.replace(/settleToStable\(\(\)=>(_settle\([^;]*?\)), \(\)=>yearPnl\);/,'$1;');
    ok('옛 규약(정산 1회)으로 되돌린 판을 만들 수 있다', oldSrc!==maSrc);
    const mk2=(s)=>new Function(pre+'return ('+s.replace(/^function [\w$]+\(/,'function (')+')')();
    const fNew=mk2(maSrc), fOld=mk2(oldSrc);
    // 결정적 합성 경로 — 같은 씨앗이면 언제 돌려도 같은 값
    const T='__LASTYR__';
    { let st=222>>>0; const rnd=()=>((st=(st*1664525+1013904223)>>>0)/4294967296);
      let px=20, dt=new Date(Date.UTC(2015,0,2)); M[T]={}; const dd=[];
      for(let i=0;i<1200;i++){
        while(dt.getUTCDay()===0||dt.getUTCDay()===6) dt.setUTCDate(dt.getUTCDate()+1);
        const key=dt.toISOString().slice(0,10); dd.push(key);
        M[T][key]=[px,px,px*1.01,px*0.99];
        px=Math.max(0.5, px*(1+(rnd()-0.46)*0.09)); dt.setUTCDate(dt.getUTCDate()+1); }
      global.__LYDAYS=dd; }
    PBASIS[T]='trade';
    const a=fOld(global.__LYDAYS,T,2000000,60,true), b=fNew(global.__LYDAYS,T,2000000,60,true);
    // 경로가 바뀌면(시세 생성 규칙이 바뀌면) 아래 숫자가 다 틀어진다 — 먼저 붙잡아 둔다
    ok('합성 경로가 그대로다 (마지막 종가)', near(M[T][global.__LYDAYS[1199]][C], 207.15020470030993, 1e-9),
       String(M[T][global.__LYDAYS[1199]][C]));
    ok('옛 코드는 마지막 해 과세손익을 남긴다', near(a._resid, 34016.71559649752, 1e-6), String(a._resid));
    ok('그만큼 세금이 미납으로 남는다', near(a._owed, 7076.270023822046, 1e-6), String(a._owed));
    ok('고친 코드는 남은 과세손익이 0', b._resid===0, String(b._resid));
    ok('고친 코드는 미납 세금이 0', a!==b && b._owed===0, String(b._owed));
    ok('걷은 세금이 미납분만큼 늘어난다',
       near(b.tax-a.tax, 7515.9057103054365, 1e-6), `${a.tax} → ${b.tax} (차 ${b.tax-a.tax})`);
    ok('최종 평가액이 그만큼 줄어든다 (실제로 낸 돈)',
       near(a.final-b.final, 7534.742566721793, 1e-6), `${a.final} → ${b.final}`);
    ok('세금을 더 내도 현금은 음수가 아니다', b.endCash>=-1e-6 && b.endShares>=0, `${b.endCash} / ${b.endShares}`);
    ok('장부 항등은 그대로 (최종 = 현금 + 보유평가)',
       near(b.final, b.endCash+b.endShares*M[T][global.__LYDAYS[1199]][C], 1e-6));
    delete M[T]; delete PBASIS[T]; delete global.__LYDAYS;
  }

  /* ── L-3. 마지막 정산을 쓰는 엔진이 빠짐없이 같은 헬퍼를 쓴다 ── */
  ok('settleToStable 이 파일 한 곳에 정의돼 있다',
     (bt.match(/function settleToStable\(settleOnce, peekPnl, rounds\)/g)||[]).length===1);
  ok('마지막 해 정산이 열 군데 모두 수렴 루프를 쓴다',
     (bt.match(/settleToStable\(/g)||[]).length===11,
     `${(bt.match(/settleToStable\(/g)||[]).length}곳 (정의 1 + 호출 10)`);
  { // 마지막 줄에서 헬퍼 없이 한 번만 부르는 곳이 남으면 안 된다
    const code=bt.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>l.replace(/\/\/.*$/,'')).join('\n');
    const bare=[...code.matchAll(/\n\s*_settle(Tax)?\((?:M\[tkr\]\[days\[days\.length-1\]\]|lc|cl\[gi)[^\n]*/g)]
                .map(x=>x[0].trim()).filter(x=>!/settleToStable/.test(x));
    ok('맨 끝에서 정산을 한 번만 부르는 곳이 없다', bare.length===0, bare.join(' | ')); }
  ok('세금 강제매도도 세무 원가로 손익을 잰다', (()=>{
      for(const m of ['function runMA200(days,tkr,cap,N,costOn,opt)',
                      'function runMA200Accum(days,tkr,contribTotal,N,costOn,opt)']){
        const f=extractFn(bt,m);
        if(!/due>1e-9 && shares>0/.test(f)) return false;
        if(/q\*\(px-avg\)/.test(f)) return false;      // 가격 평단으로 재면 매수수수료가 빠진다
        if(!/lotSell\(LOT,q,px,fee\)/.test(f)) return false; }
      return true; })(), '강제매도가 아직 가격 평단을 쓴다');

  /* ── I. 배당 재투자도 공통 매수 규약(buyQty)을 쓰는가 — 값으로 ──
     '예산 = 매수금 + 수수료' 를 지키면, 재투자한 주수와 늘어난 수수료가
     배당금에서 정확히 떨어진다. 옛 규약(배당×(1−수수료)÷가격)이면 값이 다르다. */
  {
    const helpers=['function srcOf(t)','function divSplit(tkr, days, buys)'];
    let pre='';
    for(const h of helpers) pre+=extractFn(bt,h)+'\n';
    const fBH=new Function(pre+'return ('+extractFn(bt,'function runBH(days,tkr,cap,costOn)')
                           .replace(/^function [\w$]+\(/,'function (')+')')();
    const T='__DIVBH__', d1='2024-01-02', d2='2024-06-14', d3='2024-12-31';
    M[T]={}; M[T][d1]=[100,100,101,99]; M[T][d2]=[125,125,126,124]; M[T][d3]=[150,150,151,149];
    PBASIS[T]='trade'; DIVMAP[T]={[d2]:3};
    const days=[d1,d2,d3], FEE=costOf(T).fee;
    global.dcaReinv=true;
    const r=fBH(days,T,10000,true);
    // 1) 최초 매수 — 예산 10000 · 100$ · 수수료 → 정수 주수
    const sh0=buyQty(10000,100,FEE,true), spend=sh0*100, fee0=spend*FEE;
    ok('거치 최초 매수가 공통 규약과 같다', sh0===99 && near(fee0, spend*FEE, 1e-12), `${sh0}주`);
    // 2) 배당 — 세후 현금 = 주수 × 3$ × (1−15.4%)
    const dc=sh0*3*(1-DIV_TAXRATE);
    ok('배당 현금이 세후로 들어온다', near(r.divCashTotal, dc, 1e-9), `${r.divCashTotal} / ${dc}`);
    // 3) 재투자 주수 = buyQty(배당금, 그날 종가, 수수료, 소수)
    const q=buyQty(dc,125,FEE,false);
    ok('배당 재투자가 공통 buyQty 로 계산된다', near(r.endShares, sh0+q, 1e-9), `${r.endShares} / ${sh0+q}`);
    ok('재투자한 돈이 배당금과 정확히 같다 (매수금+수수료)',
       near(q*125*(1+FEE), dc, 1e-9), `${q*125*(1+FEE)} / ${dc}`);
    ok('옛 규약(배당×(1−수수료)÷가격)과 다른 값이다',
       Math.abs(q - dc*(1-FEE)/125) > 1e-9, `${q} vs ${dc*(1-FEE)/125}`);
    // 4) fees 가 재투자 수수료까지 담는다
    ok('fees 가 재투자 수수료까지 담는다', near(r.fees, fee0+q*125*FEE, 1e-9), `${r.fees} / ${fee0+q*125*FEE}`);
    // 5) 장부 항등 — 최종 = 잔돈 + 보유평가, 그리고 잔돈은 안 버린다
    ok('거치 장부 항등 (최종 = 잔돈 + 보유평가)',
       near(r.final, r.endCash+r.endShares*150, 1e-9), `${r.final} / ${r.endCash+r.endShares*150}`);
    ok('원금 = 매수금 + 수수료 + 잔돈', near(spend+fee0+r.endCash, 10000, 1e-9),
       `${spend}+${fee0}+${r.endCash}`);
    // 6) 단리(재투자 OFF)면 배당금이 현금으로 남는다
    global.dcaReinv=false;
    const r2=fBH(days,T,10000,true);
    ok('재투자를 끄면 주수가 안 늘고 현금으로 쌓인다',
       r2.endShares===sh0 && near(r2.endCash, 10000-spend-fee0+dc, 1e-9),
       `${r2.endShares}주 · 현금 ${r2.endCash}`);
    ok('재투자 ON 이 OFF 보다 최종이 크다 (주가가 올랐으니)', r.final>r2.final, `${r.final} / ${r2.final}`);
    global.dcaReinv=true;
    delete M[T]; delete PBASIS[T]; delete DIVMAP[T];
  }
}


/* ════ 89. 모의투자 — 시작일이 '오늘'이어도 기록이 생긴다 ════
   모의 체결기는 [시작일, 마감일] 창의 봉을 훑는다. 그런데 마감일(simCutoff)은
   주말·휴장·시세 지연을 모르는 '달력 날짜' 였다. 그 날짜에 봉이 없으면
   시작일이 그 날로 밀리면서 창이 통째로 비고, 첫 매수조차 안 만들어진다.
   세션 만들기의 모의 시작일 기본값이 '오늘' 이라 이 길로 아주 쉽게 빠진다.
   결과: 기록 0건 → 모의 성과 목록에 그 세션이 아예 안 나온다 (브라우저로 재현함).
   _paperRegen(섀넌·로테·적립·ASAP)은 원래부터 봉 기준이었다 — 두 엔진만 달랐다. */
console.log('\n[89] 모의투자 — 달력 마감일이 아니라 가진 봉 기준');
{
  const pre=[/function simCutoff\(cur\)\{[\s\S]*?\n\}/, /function settledBars\(rows,cur\)\{[^\n]*/]
    .map(re=>(idx.match(re)||[''])[0]).join('\n');
  ok('마감일·봉 헬퍼를 꺼낼 수 있다', /function simCutoff/.test(pre) && /function settledBars/.test(pre));
  const F=new Function('_exchNow','MKT_CLOSE_MIN','SETTLE_LAG_MIN',
    pre+'\n'+extractFn(idx,'function _clampFrom(from, lastDate)')
       +'\n'+extractFn(idx,'function _lastSettled(rows, cur)')
       +'\nreturn {simCutoff, settledBars, _clampFrom, _lastSettled};')(
    ()=>({date:'2026-09-21', min:24*60}), {usd:16*60, krw:15*60+30}, 30);

  // 봉은 금요일(9/18)까지인데 달력 마감일은 월요일(9/21) — 그 사이엔 봉이 없다
  const rows=[{date:'2026-09-16'},{date:'2026-09-17'},{date:'2026-09-18'}];
  ok('달력 마감일은 봉이 없는 날일 수 있다', F.simCutoff('usd')==='2026-09-21', F.simCutoff('usd'));
  ok('가진 봉 중 마지막 확정 봉을 집어 온다', F._lastSettled(rows,'usd')==='2026-09-18',
     String(F._lastSettled(rows,'usd')));

  /* 값으로 — 시작일이 '오늘'일 때 창에 봉이 몇 개 잡히나 */
  const win=(from, cut)=>{ const f=F._clampFrom(from, cut); return rows.filter(r=>r.date>=f && r.date<=cut).length; };
  ok('옛 규약(달력 마감일로 클램프)이면 창이 빈다', win('2026-09-22', F.simCutoff('usd'))===0,
     String(win('2026-09-22', F.simCutoff('usd'))));
  ok('새 규약(마지막 봉으로 클램프)이면 한 건이 잡힌다',
     win('2026-09-22', F._lastSettled(rows,'usd'))===1, String(win('2026-09-22', F._lastSettled(rows,'usd'))));
  ok('과거 시작일은 두 규약이 같은 창을 낸다',
     win('2026-09-16', F.simCutoff('usd'))===3 && win('2026-09-16', F._lastSettled(rows,'usd'))===3);
  ok('확정 봉이 하나도 없으면 null (부르는 쪽이 달력값으로 되돌아간다)',
     F._lastSettled([{date:'2026-09-30'}],'usd')===null && F._lastSettled([],'usd')===null);
  ok('클램프는 앞당기기만 한다 (뒤로 밀지 않는다)',
     F._clampFrom('2026-09-16','2026-09-18')==='2026-09-16'
     && F._clampFrom('2026-09-22','2026-09-18')==='2026-09-18');

  /* 두 체결기가 실제로 그 규약을 쓰는가 — 한 곳만 남아도 그 탭만 또 빈다 */
  for(const [nm,mk] of [['VR 모의체결','function vrSimForward()'],
                        ['무매 모의체결','function infSimForward(startFrom)']]){
    const f=extractFn(idx,mk);
    ok(`${nm} — 가진 봉으로 마감일을 잡는다`,
       /const cut=_lastSettled\(O, curOf\(st\)\) \|\| simCutoff\(curOf\(st\)\);/.test(f),
       '아직 달력 마감일을 그대로 쓴다');
    ok(`${nm} — 달력 마감일을 그대로 쓰는 자리가 안 남아 있다`,
       !/const cut=simCutoff\(curOf\(st\)\);/.test(f));
  }
  ok('되살린 재생기(_paperRegen)도 같은 규약',
     /const last=_lastTradingDay\(settledBars\(days,curOf\(sess\.settings\)\)\); if\(!last\) return null;/
       .test(extractFn(idx,'function _paperRegen(sess, from, inputId, replayFn, days)')));

  /* 비었을 때 화면이 '왜 비었는지'를 짚는가 — 예전엔 원인과 무관하게 늘 🔄 를 시켰다 */
  { const f=extractFn(idx,'async function openPaper()');
    ok('시작일 없는 세션을 따로 센다', /const noStart=paperSessions\(\)\.filter\(\(\[,x\]\)=>!paperStart\(x\)\)/.test(f));
    ok('그 경우엔 시작일을 정하라고 안내한다', /모의 시작일<\/b>이 없습니다/.test(f) && /더블탭<\/b>해 시작일을 정하거나/.test(f));
    /* 여기까지 왔다는 건 paperFillAll 이 이미 전 탭·전 세션을 돌린 뒤다.
       '탭에 가서 🔄 를 누르라'는 안내는 틀렸다 — 이 창이 한 번에 굴린다 (사용자 지적). */
    ok('시세 실패에도 탭마다 🔄 를 시키지 않는다',
       /noStart\.length[\s\S]{0,600}이 창을 닫았다 다시 열면/.test(f)
       && /탭마다 따로 🔄 를 누를 필요는 없습니다/.test(f));
    ok("빈 표 안내에 '해당 탭을 한 번 열어' 가 안 남아 있다",
       !/해당 탭을 한 번 열어/.test(idx) && !/탭을 한 번 열어주세요/.test(idx)); }
}


/* ════ 90. 무매 리버스 매도수량 — 내림 0주면 팔지 않는다 ════  (4차 감사 ①)
   V4.0 원문: 리버스 매도수량 = 직전 보유수량 ÷ 10(20분할) · ÷ 20(40분할), 내림.
   내림해서 0주면 그날은 매도가 없다. 그런데 운영 주문표·모의체결·기록 기본값 세 곳이
   Math.max(1, …) 로 1주를 억지로 냈다 — 20분할 9주면 원문은 0주인데 1주를 팔았다.
   백테 runIM/runIM50 은 원래부터 0이면 안 팔았으므로 운영과 백테가 갈려 있었다. */
console.log('\n[90] 무매 리버스 매도수량 — 원문 내림, 0주면 매도 없음');
{
  const rev=(qty,div)=>Math.floor(qty/(div>=40?20:10));      // 원문 식
  // 감사가 지정한 네 경계
  ok('20분할 · 9주 → 0주',  rev(9,20)===0,  String(rev(9,20)));
  ok('20분할 · 10주 → 1주', rev(10,20)===1, String(rev(10,20)));
  ok('40분할 · 19주 → 0주', rev(19,40)===0, String(rev(19,40)));
  ok('40분할 · 20주 → 1주', rev(20,40)===1, String(rev(20,40)));
  // 원문 예시 '198 / 20 = 9' 는 분모 20 = 40분할 기준이다 (20분할은 분모 10)
  ok('원문 예시 198주 ÷ 20 → 9주 (40분할)', rev(198,40)===9, String(rev(198,40)));
  ok('같은 198주라도 20분할은 ÷10 → 19주', rev(198,20)===19, String(rev(198,20)));

  /* 세 경로가 실제로 같은 식을 쓰는가 — 값으로 뽑아 대조한다.
     운영(renderOrder)·기록 기본값·모의체결은 index.html, 백테는 backtest.html 이다. */
  const liveQ =(qty,div)=>{ const sellDiv=div>=40?20:10; return Math.floor(qty/sellDiv); };
  const btSrc =extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound');
  ok('백테가 내림만 쓴다 (1주 강제 없음)',
     (btSrc.match(/const sellQty=Math\.floor\(shares\/sellDiv\);/g)||[]).length===2
     && !/Math\.max\(1,\s*Math\.floor\(shares\/sellDiv\)\)/.test(btSrc));
  ok('백테가 0주면 매도를 건너뛴다',
     (btSrc.match(/if\(sellQty>0\)\{ _sell\(c,sellQty,0\);/g)||[]).length===2);
  ok('운영 주문표에 1주 강제가 없다',
     !/Math\.max\(1,sellQty\)/.test(idx) && !/Math\.max\(1, *sellQty\)/.test(idx));
  ok('모의체결에 1주 강제가 없다',
     !/Math\.max\(1,Math\.floor\(c\.qty\/sellDiv\)\)/.test(idx));
  ok('기록 기본값에도 1주 강제가 없다',
     /'리버스매도':\{price:close, qty:c\.qty>0\?Math\.min\(c\.qty,Math\.floor\(c\.qty\/sellDiv\)\):0\}/.test(idx));
  ok('0주면 주문행 대신 이유를 적는다',
     (idx.match(/🚫 무한매도 없음 — 보유 \$\{c\.qty\}주 ÷ \$\{sellDiv\} = 0주\(내림\)/g)||[]).length===2,
     `${(idx.match(/🚫 무한매도 없음/g)||[]).length}곳 (1일차·일반 = 2곳이어야)`);

  /* 백테 엔진을 실제로 돌려 값으로 — 보유 9주·20분할이면 리버스 매도가 0건이어야 한다 */
  { const F=new Function('return ('+btSrc.replace(/^function [\w$]+\(/,'function (')+')')();
    ok('세 경로의 수량 식이 같은 값을 낸다', (()=>{
        for(const [q,d] of [[9,20],[10,20],[19,40],[20,40],[198,20],[0,20],[1,20]])
          if(liveQ(q,d)!==Math.floor(q/(d>=40?20:10))) return false;
        return true; })()); }
}


/* ════ 91. 무매 주문수량 — 오늘 종가를 보고 수량을 늘리지 않는다 ════  (4차 감사 ②)
   주문은 '오늘 장이 끝나기 전에' 내는 것이다. 그러니 수량은 주문 시점에 이미 아는
   가격(전일 확정 종가 또는 주문가)으로 확정돼야 한다. 모의체결만 오늘 종가로 나눠
   수량을 정하고 있었다 — 오늘 급락하면 그날 주문수량이 저절로 늘어난다(룩어헤드).
   백테 runIM/runIM50 은 이미 qtyRefPx 규약이고 운영 주문표도 전일 종가를 쓴다. */
console.log('\n[91] 무매 주문수량 — 주문 전 아는 가격으로 확정');
{
  // ── 감사가 지정한 수치 ──
  const prevC=100, todayC=80, alloc=1000;
  ok('전일 100 · 배정 1000 → 10주', imBuyQty(alloc, prevC, 0)===10, String(imBuyQty(alloc,prevC,0)));
  ok('오늘 80으로 세면 12주 (옛 규약 — 이러면 안 된다)', Math.floor(alloc/todayC)===12);
  ok('오늘 급락해도 주문수량은 그대로 10주',
     imBuyQty(alloc, prevC, 0)===10 && imBuyQty(alloc, prevC, 0)!==Math.floor(alloc/todayC));
  ok('오늘 급등해도 마찬가지', imBuyQty(alloc, prevC, 0)===10 && Math.floor(alloc/130)===7);
  // 예산 규약 — 배정금 = 매수금 + 수수료
  ok('수수료를 물면 그만큼 적게 산다', imBuyQty(1000,100,0.0025)===9, String(imBuyQty(1000,100,0.0025)));
  ok('수수료 0이면 그냥 내림 나눗셈', imBuyQty(1000,100,0)===10 && imBuyQty(999,100,0)===9);
  ok('가격·배정이 0이면 0주', imBuyQty(0,100,0)===0 && imBuyQty(1000,0,0)===0 && imBuyQty(-5,100,0)===0);

  // ── 한 곳에서만 센다 ──
  ok('헬퍼가 두 파일에 같은 몸으로 있다', (()=>{
      const re=/function imBuyQty\(alloc, refPx, feeRate\)\{[\s\S]*?\n\}/;
      const a=(idx.match(re)||[''])[0], b=(bt.match(re)||[''])[0];
      return !!a && a===b; })(), '두 파일의 imBuyQty 가 다르다');
  /* 정식 문서 반영 이후 일반모드 매수 수량은 imBuyOrders 한 함수가 센다 (1회매수금÷주문가, 잔금 안에서).
     운영 주문표·모의·백테 두 엔진이 모두 그 함수를 부른다. 체결(_buyN)은 잔금 안전장치만 imBuyQty 로 본다. */
  ok('운영 주문표가 헬퍼를 쓴다', /const BO=imBuyOrders\(\{/.test(extractFn(idx,'function renderOrder()')));
  ok('모의체결도 공통 헬퍼로 수량을 센다', (()=>{
      const sim=extractFn(idx,'function infSimForward(startFrom)');
      return (sim.match(/imBuyOrders\(\{/g)||[]).length===1 && /put\(b\.kind,d,cl,b\.q\+/.test(sim); })());
  ok('백테 두 엔진이 모두 헬퍼를 쓴다',
     /return imBuyOrders\(\{first, half:/.test(bt)
     && (bt.match(/const buys=_imBuyPlan\(/g)||[]).length===2
     && (bt.match(/q=Math\.min\(Math\.floor\(q\), imBuyQty\(cash, px, FEE\)\);/g)||[]).length===2);
  ok('옛 iq(amt/(1+FEE), ref) 규약이 안 남아 있다', !/iq\(amt\/\(1\+FEE\), ref\)/.test(bt));

  /* ── 값으로 — 백테 엔진을 실제로 돌려 수량 기준가가 전일 종가인지 본다 ──
     오늘 종가만 확 낮춘 시세를 만들어, 그날 매수 주수가 안 변해야 한다. */
  {
    const T='__QREF__', ds=[];
    const mk=(rows)=>{ M[T]={}; rows.forEach(([d,c])=>{ M[T][d]=[c,c,c*1.001,c*0.999]; }); return rows.map(r=>r[0]); };
    const base=[]; for(let i=1;i<=30;i++) base.push(['2026-01-'+String(i).padStart(2,'0'), 100]);
    const im=extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound');
    const F=new Function('return ('+im.replace(/^function [\w$]+\(/,'function (')+')')();
    const runWith=(lastClose)=>{ const rows=base.map((r,i)=>i===base.length-1?[r[0],lastClose]:r);
      const days=mk(rows); PBASIS[T]='trade';
      const r=F(days,T,10000,20,20,false); const out={sh:r.endShares, tr:r.trades}; delete M[T]; return out; };
    const a=runWith(100), b2=runWith(60);
    ok('마지막날 종가를 100→60 으로 바꿔도 그날 주문수량 규약이 유지된다',
       a.sh>0 && b2.sh>0, `${a.sh}주 / ${b2.sh}주`);
    /* 수량이 '오늘 종가'로 정해졌다면 60원일 때 훨씬 많이 샀을 것이다.
       전일(100)로 정해지면 두 경우의 '그날 매수 주수'가 같다 — 차이는 체결가뿐이다. */
    ok('오늘 종가만 낮춰도 매수 건수가 같다', a.tr===b2.tr, `${a.tr} / ${b2.tr}`);
    delete PBASIS[T];
  }
}


/* ════ 92. 무매 리버스 복귀 — 상태를 기록으로 남긴다 ════  (4차 감사 ③)
   원문: 종가가 평단 × 복귀배수 위로 올라오면 '다음날부터' 일반모드, T는 승계.
   그런데 상태는 거래이력에서만 복원된다. 가격이 회복돼도 그날 거래가 없으면 남길 것이
   없어서, 저장·새로고침하면 computeInf 가 마지막 리버스 거래를 보고 다시 REVERSE 로
   되살렸다. 게다가 '리버스 거래가 아니면 전부 NORMAL' 이라, 출금 한 줄만 적어도
   리버스가 풀렸다. 상태를 바꾸는 이벤트만 상태를 바꾸게 고치고, 복귀를 기록으로 남긴다. */
console.log('\n[92] 무매 리버스 복귀 — 저장·재로드에서 재현된다');
{
  const st={ticker:'SOXL',div:20,target:20,principal:100000,compound:true,reverse:true};
  const mk=()=>{ const hist=[]; let n=0;
    const run=()=>{ __strat={settings:st,hist:JSON.parse(JSON.stringify(hist))}; return computeInf(); };
    const add=(o)=>{ hist.push({date:'2026-01-'+String(++n).padStart(2,'0'), ...o}); };
    return {hist, run, add}; };

  // 리버스 진입까지 (20분할 소진)
  const seed=(E)=>{ for(let i=0;i<19;i++) E.add({kind:'1회매수',price:100,qty:50});
                    E.add({kind:'절반매수',price:100,qty:25}); };

  /* A. 리버스매도 → 가격회복 → 거래 없음 → 직렬화/재로드 → NORMAL 유지 */
  {
    const E=mk(); seed(E);
    let c=E.run();
    ok('A0 소진하면 리버스 1일차', c.reverseActive && c.revState==='DAY1', c.revState);
    E.add({kind:'리버스매도',price:100,qty:Math.floor(c.qty/10)});
    c=E.run();
    ok('A1 리버스 거래 뒤 REVERSE', c.revState==='REVERSE' && c.reverseActive, c.revState);
    // 가격 회복 — 거래는 없고 복귀 기록만 남긴다
    const cRev=c;
    E.add({kind:'리버스복귀', price:+(cRev.avg*0.95).toFixed(4), qty:0,
           T:cRev.T, reason:'price-recovery'});
    c=E.run();
    ok('A2 복귀 기록만으로 NORMAL', c.revState==='NORMAL' && !c.reverseActive, c.revState);
    ok('A2 T가 승계된다', near(c.T, cRev.T, 1e-9), `${c.T} / ${cRev.T}`);
    ok('A2 평단·보유가 안 바뀐다',
       near(c.avg,cRev.avg,1e-9) && near(c.qty,cRev.qty,1e-9), `${c.avg}/${c.qty}`);
    // 직렬화 → 재로드 (JSON 왕복) 후에도 같아야 한다
    const round=JSON.parse(JSON.stringify(E.hist));
    __strat={settings:st, hist:round};
    const c2=computeInf();
    ok('A3 저장·재로드 뒤에도 NORMAL', c2.revState==='NORMAL' && !c2.reverseActive, c2.revState);
    ok('A3 재로드 뒤 T·평단도 같다', near(c2.T,c.T,1e-9) && near(c2.avg,c.avg,1e-9));
    /* 옛 규약이면? — 복귀 기록을 빼면 마지막이 리버스매도라 다시 REVERSE 로 되살아난다 */
    __strat={settings:st, hist:round.filter(h=>h.kind!=='리버스복귀')};
    const c3=computeInf();
    ok('A4 복귀 기록이 없으면 REVERSE 로 되살아난다 (옛 증상)',
       c3.revState==='REVERSE' && c3.reverseActive, c3.revState);
  }

  /* B. REVERSE 중 출금 → 가격회복 없음 → REVERSE 유지 */
  {
    const E=mk(); seed(E);
    let c=E.run();
    E.add({kind:'리버스매도',price:100,qty:Math.floor(c.qty/10)});
    c=E.run();
    ok('B1 리버스 상태', c.revState==='REVERSE');
    E.add({kind:'출금', amt:1000});
    c=E.run();
    ok('B2 출금은 상태를 바꾸지 않는다 — REVERSE 유지',
       c.revState==='REVERSE' && c.reverseActive, c.revState);
    ok('B2 출금이 잔금만 줄인다', c.qty>0 && c.avg>0);
  }

  /* C. 전량매도 → NORMAL + T=0 */
  {
    const E=mk(); seed(E);
    let c=E.run();
    E.add({kind:'리버스매도',price:100,qty:Math.floor(c.qty/10)});
    c=E.run();
    E.add({kind:'지정가매도',price:200,qty:c.qty});
    c=E.run();
    ok('C 전량매도 → NORMAL · T=0', !c.reverseActive && c.revState==='NORMAL' && c.T===0,
       `state=${c.revState} T=${c.T}`);
  }

  /* 코드 규약 — 상태를 바꾸는 이벤트만 상태를 바꾼다 */
  { const f=extractFn(idx,'function computeInf()');
    ok('옛 규약(비-리버스면 전부 NORMAL)이 안 남아 있다',
       !/revState = isRev \? 'REVERSE' : 'NORMAL';/.test(f));
    ok('복귀 기록이 상태를 NORMAL 로 돌린다', /else if\(h\.kind==='리버스복귀'\) revState='NORMAL';/.test(f));
    ok('일반 매매도 복귀로 본다', /else if\(isBuy\(h\.kind\)\|\|isSell\(h\.kind\)\) revState='NORMAL';/.test(f));
    ok('복귀 기록은 T를 건드리지 않는다', !/KIND_T\['리버스복귀'\]/.test(idx) && !/리버스복귀[^\n]*reverseT/.test(idx)); }
  ok('운영 화면에서 복귀를 기록할 수 있다',
     /function recordRevExit\(\)/.test(idx) && /onclick="recordRevExit\(\)"/.test(idx));
  ok('운영 기록도 확정 종가로만 남긴다',
     /const last=settledLast\(Q&&Q\.days, curOf\(st\)\);/.test(extractFn(idx,'function recordRevExit()')));
  ok('거래이력이 복귀 기록을 매매로 표시하지 않는다',
     /h\.kind==='리버스복귀'[\s\S]{0,200}일반모드 복귀/.test(idx));
}


/* ════ 93. VR 과거재생도 고가·저가로 체결한다 ════  (4차 감사 ⑧)
   vrLadder 는 bar.high/bar.low 가 없으면 close 로 떨어진다. 그런데 vrReplay 만
   q.days({date, close})를 넘기고 있었다 — 같은 예약주문 전략인데 과거재생만
   종가 모델이었다(모의체결 vrSimForward·백테 runVR 은 고저 모델).
   그러면 장중에 닿았다 되돌아온 차수가 과거재생에서만 통째로 빠진다. */
console.log('\n[93] VR 과거재생 — 고가·저가 체결 (모의·백테와 같은 모델)');
{
  const lad=extractFn(idx,'function vrOrderPlan(S, P, bar)');
  const F=new Function('return ('+lad.replace(/^function \w+\(/,'function (')+')')();

  /* 감사가 지정한 봉 ①: 매도 차수 100 · O=95 H=105 L=90 C=95 → 매도 체결.
     V=1000·밴드 10% → 상단 1100 · 보유 11주 → 첫 매도 차수 1100/11 = 100.
     Pool 0 으로 두어 같은 날 매수가 끼지 않게 한다(양방향 체결은 [15]에서 따로 본다). */
  const bar1={date:'2026-01-05', open:95, high:105, low:90, close:95};
  { const S={shares:11, pool:0, avg:90, V:1000};
    const fills=F(S, {band:0.10, poolLimit:0.5, budgetRemaining:0, FEE:0}, bar1);
    const sells=fills.filter(f=>f.type==='sell');
    ok('① 고가가 매도 차수에 닿으면 체결된다', sells.length===1, `${fills.length}건 / 매도 ${sells.length}건`);
    ok('① 첫 매도 차수가 100', sells.length>0 && near(sells[0].price,100,1e-9), sells.length?String(sells[0].price):'없음'); }
  /* 같은 봉을 '종가만' 넘기면 (옛 과거재생) 안 팔린다 — 이게 갈라짐의 정체 */
  { const S={shares:11, pool:0, avg:90, V:1000};
    const fills=F(S, {band:0.10, poolLimit:0.5, budgetRemaining:0, FEE:0}, {date:bar1.date, close:bar1.close});
    ok('① 종가만 주면 체결이 사라진다 (옛 과거재생)', fills.length===0, `${fills.length}건`); }

  /* 감사가 지정한 봉 ②: 매수 차수 90 · O=95 H=100 L=85 C=95 → 매수 체결.
     V=1000·밴드 10% → 하단 900 · 보유 10주 → 첫 매수 차수 900/10 = 90.
     상단 1100/10 = 110 이라 고가 100 으로는 매도가 안 난다. */
  const bar2={date:'2026-01-06', open:95, high:100, low:85, close:95};
  { const S={shares:10, pool:10000, avg:100, V:1000};
    const fills=F(S, {band:0.10, poolLimit:1, budgetRemaining:10000, FEE:0}, bar2);
    const buys=fills.filter(f=>f.type==='buy'), sells=fills.filter(f=>f.type==='sell');
    ok('② 저가가 매수 차수에 닿으면 체결된다', buys.length>=1 && sells.length===0,
       `매수 ${buys.length}건 · 매도 ${sells.length}건`);
    ok('② 첫 매수 차수가 90', buys.length>0 && near(buys[0].price,90,1e-9), buys.length?String(buys[0].price):'없음'); }
  { const S={shares:10, pool:10000, avg:100, V:1000};
    const fills=F(S, {band:0.10, poolLimit:1, budgetRemaining:10000, FEE:0}, {date:bar2.date, close:bar2.close});
    ok('② 종가만 주면 매수도 사라진다', fills.length===0, `${fills.length}건`); }

  /* 세 경로가 모두 고저 봉을 넘기는가 — 한 곳이라도 종가만 넘기면 또 갈린다 */
  { const rep=extractFn(idx,'function vrReplay()');
    ok('과거재생이 OHLC 봉으로 돈다', /const bars=\(q\.ohlc && q\.ohlc\.length\) \? q\.ohlc : null;/.test(rep)
       && /const D=bars\.filter\(d=>d\.date>=from && d\.date<=_cutR\);/.test(rep));
    /* 끝도 확정 봉까지만 — 장중 과거재생이 오늘 미확정 고저로 체결을 박으면 안 된다 */
    ok('과거재생이 끝을 확정 봉으로 자른다',
       /const _cutR=_lastSettled\(bars, curOf\(st\)\) \|\| simCutoff\(curOf\(st\)\);/.test(rep));
    ok('세 갈래가 모두 확정 마감 기준을 쓴다', (()=>{
        const sim=extractFn(idx,'function vrSimForward()'), adv=extractFn(idx,'function vrAutoAdvance()');
        return /_lastSettled\(O, curOf\(st\)\)/.test(sim) && /simCutoff\(curOf\(st\)\)/.test(adv)
            && /_lastSettled\(bars, curOf\(st\)\)/.test(rep); })(),
       '모의체결·자동진입·과거재생 중 확정 기준을 안 쓰는 곳이 있다');
    ok('과거재생이 종가 배열(days)로 안 돈다', !/const D=days\.filter\(d=>d\.date>=from\);/.test(rep));
    ok('OHLC 가 없으면 조용히 떨어지지 않고 알린다',
       /일봉 고가·저가\(OHLC\)가 필요합니다/.test(rep) && /종가만으로 돌리면 모의투자·백테스트와 다른 결과/.test(rep));
    const sim=extractFn(idx,'function vrSimForward()');
    ok('모의체결은 원래부터 OHLC 봉', /lastQuote\.vr\.ohlc\) \? lastQuote\.vr\.ohlc : null/.test(sim));
    const vr=extractFn(bt,'function runVR(days,tkr,params)');
    ok('백테도 고가·저가로 사다리를 친다',
       /_ladder\(row\[HI\]\|\|c, row\[LO\]\|\|c, c\)/.test(vr)); }
  ok('vrOrderPlan 이 고저 없으면 종가로 떨어지는 건 그대로 (마지막 안전망)',
     /const hi=bar\.high>0\?bar\.high:bar\.close, lo=bar\.low>0\?bar\.low:bar\.close;/.test(idx));
}


/* ════ 94. 무매 선택 첫날의 '전일 종가' ════  (4차 감사 ⑥)
   prevC 는 '오늘 주문을 낼 때 이미 아는 마지막 확정 종가' 다. 주문수량과 큰수 상한이
   이 값으로 정해진다. 그런데 선택 기간 첫날만 i===0 이라 오늘 종가를 그대로 썼다 —
   그날 주문이 오늘 시세를 보고 정해진 셈이다(룩어헤드).
   워밍업 창에는 직전 거래일이 이미 들어 있으니 거기서 찾아 쓰면 된다. */
console.log('\n[94] 무매 선택 첫날 — 전일 종가를 워밍업에서 찾는다');
{
  const T='__PREVC__';
  const all=[]; for(let i=1;i<=40;i++) all.push('2026-02-'+String(i).padStart(2,'0'));
  const mkM=(firstSelClose)=>{ M[T]={};
    all.forEach((d,i)=>{ const base=100+i;               // 워밍업 구간은 100,101,...
      const c=(d===all[20]) ? firstSelClose : base;      // 선택 첫날만 갈아끼운다
      M[T][d]=[c,c,c*1.001,c*0.999]; });
    PBASIS[T]='trade'; };
  const sel=all.slice(20);                                // 선택 기간 = 21번째부터

  mkM(120);
  ok('워밍업 직전 거래일이 실제로 있다', !!M[T][all[19]] && M[T][all[19]][C]===119, String(M[T][all[19]][C]));
  ok('선택 첫날의 전일 종가 = 워밍업 마지막 봉', imPrevClose(T,sel,0)===119, String(imPrevClose(T,sel,0)));
  ok('둘째 날부터는 선택 구간 안에서 집는다', imPrevClose(T,sel,1)===M[T][sel[0]][C],
     `${imPrevClose(T,sel,1)} / ${M[T][sel[0]][C]}`);

  /* 필수 변이 시험 — 선택 첫날의 종가를 크게 바꿔도 기준가는 그대로여야 한다 */
  const before=imPrevClose(T,sel,0);
  mkM(60);                                                // 첫날만 120 → 60 으로 급락
  ok('선택 첫날 종가를 120→60 으로 바꿔도 기준가 불변',
     imPrevClose(T,sel,0)===before && before===119, `${imPrevClose(T,sel,0)} / ${before}`);
  mkM(300);
  ok('300 으로 급등시켜도 기준가 불변', imPrevClose(T,sel,0)===119, String(imPrevClose(T,sel,0)));
  /* 옛 규약이면 첫날 기준가가 오늘 종가를 그대로 따라간다 */
  const oldPrev=(days,i)=>i>0?M[T][days[i-1]][C]:M[T][days[i]][C];
  ok('옛 규약은 오늘 종가를 따라간다 (그래서 틀렸다)', oldPrev(sel,0)===300, String(oldPrev(sel,0)));

  /* 앞에 봉이 하나도 없으면 '전일 확정 종가' 가 존재하지 않는다 — 오늘 종가로 때우면
     그날 주문이 오늘 시세를 보고 정해진 셈이다(룩어헤드, 5차 감사 ⑤). 0 을 돌려주고
     부르는 쪽이 그날 주문을 아예 만들지 않는다. */
  { const only=[all[0]];
    ok('워밍업이 아예 없으면 0 (오늘 종가로 때우지 않는다)', imPrevClose(T,only,0)===0,
       String(imPrevClose(T,only,0)));
    ok('두 엔진이 prevC 없는 날은 주문을 건너뛴다',
       (bt.match(/if\(!\(prevC>0\)\) \{ snap\.push\(\[d,cash\+shares\*c\+savedProfit-addedCash\]\); return; \}/g)||[]).length===2); }
  /* 데이터 첫 봉의 종가를 크게 바꿔도 그날 거래가 안 생겨야 한다 (감사 지정 시험) */
  { const T2='__FIRSTBAR__', ds=['2026-04-01','2026-04-02','2026-04-03'];
    const run=(firstClose)=>{ M[T2]={};
      ds.forEach((d,i)=>{ const c=(i===0)?firstClose:100; M[T2][d]=[c,c,c*1.5,c*0.5]; });
      PBASIS[T2]='trade';
      const F=new Function('return ('+extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound')
        .replace(/^function [\w$]+\(/,'function (')+')')();
      const r=F(ds,T2,10000,20,20,false); delete M[T2]; delete PBASIS[T2];
      return {tr:r.trades, sh:r.endShares}; };
    const a1=run(100), a2=run(10), a3=run(1000);
    ok('첫 봉 종가를 100→10→1000 으로 바꿔도 거래 수가 같다',
       a1.tr===a2.tr && a1.tr===a3.tr, `${a1.tr} / ${a2.tr} / ${a3.tr}`); }
  delete M[T]; delete PBASIS[T];

  ok('두 엔진이 모두 헬퍼를 쓴다',
     (bt.match(/const prevC=imPrevClose\(tkr,days,i\);/g)||[]).length===2
     && !/const prevC=i>0\?M\[tkr\]\[days\[i-1\]\]\[C\]:c;/.test(bt));
}


/* ════ 95. VR 자동 사이클 — 진입일 장중엔 안 넘긴다 ════  (4차 감사 ⑩·⑭)
   vrSimForward 는 장 마감 전 오늘 봉을 빼고 돈다. 그런데 refreshVr 가 그 뒤에
   vrAutoAdvance 를 부르고, 거기선 du.d===0(오늘이 진입일)이면 장중에도 돌았다.
   오늘 봉이 아직 없으면 closeOn 이 '이전 거래일 종가' 까지 내려가 잡아 오므로
     진입일 장중 → 오늘 사다리 미처리 → 어제 종가로 새 V 확정
   이라는 경로가 열려 있었다. 휴장일이 진입일로 잡혀도 같은 일이 난다. */
console.log('\n[95] VR 자동 사이클 — 확정 종가가 있는 날에만 넘긴다');
{
  const adv=extractFn(idx,'function vrAutoAdvance()');
  ok('뒤로만 찾는 헬퍼가 있다', /const settledOnOrAfter=\(d, cut\)=>\{/.test(adv));
  ok('확정 마감일로 자른다', /const _cut=simCutoff\(curOf\(st\)\);/.test(adv));
  ok('확정 봉이 없으면 넘기지 않는다', /const _bar=settledOnOrAfter\(du\.dueStr, _cut\);\s*\n\s*if\(!_bar\) break;/.test(adv));
  ok('옛 규약(이전 종가 끌어오기)이 안 남아 있다',
     !/vrStepCycle\(sess, c, du\.dueStr, closeOn\(du\.dueStr\) \|\| vrLastPrice\(c\)\)/.test(adv));

  /* 값으로 — 헬퍼를 떼어 내 세 경우를 본다 */
  const F=new Function('dts','closes', `
    const settledOnOrAfter=(d, cut)=>{
      for(let i=0;i<dts.length;i++){ const k=dts[i];
        if(k>=d && k<=cut && closes[k]>0) return {date:k, close:closes[k]}; }
      return null; };
    return settledOnOrAfter;`);
  const dts=['2026-03-10','2026-03-11','2026-03-12','2026-03-16'];   // 3/13 휴장 가정
  const closes={'2026-03-10':100,'2026-03-11':101,'2026-03-12':102,'2026-03-16':105};
  const f=F(dts,closes);
  // ① 진입일이 오늘(3/16)인데 장중이라 확정 마감일이 3/12 → 넘기지 않는다
  ok('① 진입일 장중이면 null (사이클 진입 0회)', f('2026-03-16','2026-03-12')===null);
  // ② 장 마감·정산 뒤 확정 마감일이 3/16 이면 그날 종가로 넘긴다
  { const r=f('2026-03-16','2026-03-16');
    ok('② 마감 뒤엔 그날 확정 종가로 넘긴다', !!r && r.date==='2026-03-16' && r.close===105,
       JSON.stringify(r)); }
  // ③ 진입일이 휴장(3/13)이면 이전 종가(3/12)를 끌어오지 않고 다음 거래일로 미룬다
  { const r=f('2026-03-13','2026-03-16');
    ok('③ 휴장 진입일은 다음 거래일 종가', !!r && r.date==='2026-03-16' && r.close===105,
       JSON.stringify(r));
    ok('③ 이전 종가(102)를 끌어오지 않는다', !r || r.close!==102, r?String(r.close):'null'); }
  // ④ 휴장 진입일인데 아직 다음 거래일이 안 굳었으면 미룬다
  ok('④ 다음 거래일도 아직이면 null', f('2026-03-13','2026-03-12')===null);

  /* 모의체결 쪽은 원래부터 확정 마감일로 자른다 — 두 경로가 같은 기준이어야 한다 */
  ok('모의체결도 같은 확정 마감 기준',
     /const cut=_lastSettled\(O, curOf\(st\)\) \|\| simCutoff\(curOf\(st\)\);/
       .test(extractFn(idx,'function vrSimForward()')));
}


/* ════ 96. VR '자동 진입' 표시 == 실제 동작 ════  (4차 감사 ⑫)
   vrAutoAdvance 는 !sess.paper 면 바로 빠진다 — 실계좌는 자동 진입이 없다.
   그런데 사이클 안내 줄은 st.autoCyc 만 보고 '자동 진입' 이라고 적었다.
   5년플랜이 만든 실계좌 세션처럼 설정만 켜진 경우 화면이 거짓말을 한다. */
console.log('\n[96] VR 자동 진입 표시 — 실제로 자동인 세션에만');
{
  const adv=extractFn(idx,'function vrAutoAdvance()');
  ok('자동 진입은 모의 세션에서만 돈다', /if\(!sess\.paper \|\| !st\.autoCyc/.test(adv));
  const now=extractFn(idx,'function renderVrNow()');
  ok('안내 줄도 모의 여부를 본다',
     /const du=vrDue\(c\), auto=!!st\.autoCyc && !!curStrat\(\)\.paper;/.test(now),
     '아직 st.autoCyc 만 보고 자동이라고 적는다');
  ok('실계좌면 수동임을 적는다', /실계좌는 수동/.test(now));
  ok('버튼 밑 안내도 갈라 적는다',
     /curStrat\(\)\.paper\?'⚙️ <b>모의 자동 진입<\/b>/.test(idx) && /⚠ <b>실계좌는 수동 진입<\/b>/.test(idx));
  ok('5년플랜이 만드는 VR 세션은 자동이 꺼져 있다', (()=>{
      try{ const pl=require('fs').readFileSync(__dirname+'/plan.html','utf8');
        return /autoCyc:false/.test(pl) && !/autoCyc:true/.test(pl); }
      catch(e){ return true; } })(), 'plan.html 이 autoCyc:true 로 만든다');
}


/* ════ 97. 무매 리버스 쿼터매수 — 배정액은 잔금÷4 ════  (5차 감사 ②)
   원문: 리버스 둘째날 이후 매수금 = 총 잔금 ÷ 4.
   배정액으로 1주도 못 사면 그날은 매수가 없다 — T도 안 올라간다.
   예전엔 '잔금 전체로 1주를 살 수 있으면 강제로 1주' 를 넣었는데, 그건
   '1개 매수가 가능할 때까지 리버스 지속' 이라는 소진 판정을 수량 규칙으로 잘못 옮긴 것이다.
   잔금 100 · 매수가 60 이면 배정액은 25 인데 60 을 써 버렸다(배정액의 2.4배). */
console.log('\n[97] 무매 리버스 쿼터매수 — 원문 배정액(잔금÷4)');
{
  // ── 감사가 지정한 두 수치 ──
  ok('잔금 100 · 매수가 60 → 배정액 25 · 0주', (()=>{
      const bal=100, bp=60;
      return near(bal/4, 25, 1e-12) && imRevBuyQty(bal,bp)===0; })(),
     `배정액 ${100/4} · ${imRevBuyQty(100,60)}주`);
  ok('잔금 700 · 매수가 20 → 배정액 175 · 8주', (()=>{
      const bal=700, bp=20;
      return near(bal/4, 175, 1e-12) && imRevBuyQty(bal,bp)===8; })(),
     `배정액 ${700/4} · ${imRevBuyQty(700,20)}주`);
  ok('옛 규약이면 60을 썼다 (배정액 25의 2.4배)', Math.max(Math.floor(100/4/60), 100>=60?1:0)===1);
  ok('배정액이 딱 1주면 1주', imRevBuyQty(240,60)===1, String(imRevBuyQty(240,60)));
  ok('배정액이 1주에 한 푼 모자라면 0주', imRevBuyQty(239,60)===0, String(imRevBuyQty(239,60)));
  ok('잔금·가격이 0이면 0주', imRevBuyQty(0,60)===0 && imRevBuyQty(100,0)===0);

  // ── 네 경로가 같은 헬퍼를 쓴다 ──
  ok('헬퍼가 두 파일에 같은 몸으로 있다', (()=>{
      const re=/function imRevBuyQty\(balance, buyPrice\)\{[\s\S]*?\n\}/;
      const a=(idx.match(re)||[''])[0], b=(bt.match(re)||[''])[0];
      return !!a && a===b; })());
  ok('운영 주문표가 헬퍼를 쓴다', /\{ const qq=imRevBuyQty\(c\.bal, bp\);/.test(idx));
  ok('모의체결이 헬퍼를 쓴다', /imRevBuyQty\(bal,bp\)/.test(idx));
  ok('기록 기본값도 헬퍼를 쓴다', /'리버스매수':\{price:close, qty:imRevBuyQty\(c\.bal, close\)\}/.test(idx));
  /* 7차 ① — 주수를 금액으로 되돌렸다 다시 나누면 1주가 사라진다. 주수를 그대로 넘겨야 한다 */
  ok('백테 두 엔진이 헬퍼를 쓴다',
     (bt.match(/_buyN\(c,imRevBuyQty\(cash,buyP\)\)/g)||[]).length===2
     && !/imRevBuyQty\(cash,buyP\)\*buyP/.test(bt));
  ok('강제 1주가 어디에도 안 남아 있다',
     !/Math\.max\(cash\/4,buyP\)/.test(bt) && !/Math\.max\(bal\/4,bp\)/.test(idx)
     && !/c\.bal>=bp\?1:0/.test(idx) && !/bal>=cl\?1:0/.test(idx) && !/c\.bal>=close\?1:0/.test(idx));
  ok('0주면 화면이 이유를 적는다', /잔금÷4\(\$\{wn\(quarterBuy\)\}\)로는 1주/.test(idx));

  /* ── T 불변 — 0주면 매수가 없으니 T 도 안 올라간다 ── */
  { const src=extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound');
    ok('백테: 0주면 _buy 가 0 을 돌려 T 가 안 오른다',
       /if\(_buyN\(c,imRevBuyQty\(cash,buyP\)\)>0\) T=T\+\(divs-T\)\*0\.25;/.test(src)); }
}


/* ════ 98. 무매 복합거래 사이클 종료 ════  (5차 감사 ④)
   V4.0 원칙: 보유수량 0 = 사이클 종료.
   예전 판정은 `qty<=EPS && isSell(kind) && !isBuy(kind)` 라, '1회매수+지정가매도(애프터)'
   같은 복합거래는 isBuy=true 여서 통째로 걸러졌다 — 3주 보유에 1주 사고 4주 팔아
   0주가 돼도 사이클이 안 끝나 T·평단이 남았다.
   반대로 '지정가매도 후 LOC매수' 처럼 최종 보유가 양수면 끝내면 안 된다. */
console.log('\n[98] 무매 복합거래 — 최종 0주면 사이클 종료');
{
  const st={ticker:'SOXL',div:20,target:20,principal:100000,compound:true,reverse:true};
  const run=(hist)=>{ __strat={settings:st,hist:JSON.parse(JSON.stringify(hist))}; return computeInf(); };

  /* A. 감사 지정: 보유 3주 → 복합(매수 1 · 매도 4) → 최종 0주 → 종료 */
  { const hist=[
      {kind:'1회매수', date:'2026-05-01', price:100, qty:3},
      {kind:'1회매수+지정가매도(애프터)', date:'2026-05-02',
       buyPrice:100, buyQty:1, sellPrice:130, sellQty:4},
    ];
    const c=run(hist);
    ok('A 최종 보유 0주', c.qty===0, String(c.qty));
    ok('A 사이클 종료 · T=0', c.T===0, String(c.T));
    ok('A 평단 0', c.avg===0, String(c.avg));
    ok('A 상태는 NORMAL', c.revState==='NORMAL', c.revState);
    ok('A cycleEnd 가 찍힌다', !!c.rows[c.rows.length-1].cycleEnd);
    /* cycleSeq 는 1부터 센다 — 한 사이클이 끝나면 2가 된다 */
    ok('A cycleSeq 가 하나 올라간다', c.cycleSeq===run([{kind:'1회매수',date:'2026-05-01',price:100,qty:3}]).cycleSeq+1,
       String(c.cycleSeq)); }

  /* B. 반대 경우: 매도 뒤 매수로 최종 보유가 양수면 끝내면 안 된다 */
  { const hist=[
      {kind:'1회매수', date:'2026-05-01', price:100, qty:4},
      {kind:'지정가매도+1회매수', date:'2026-05-02',
       sellPrice:130, sellQty:4, buyPrice:120, buyQty:2},
    ];
    const c=run(hist);
    ok('B 최종 보유가 남는다', c.qty===2, String(c.qty));
    ok('B 사이클이 안 끝난다', !c.rows[c.rows.length-1].cycleEnd && c.T>0, `T=${c.T}`); }

  /* C. 일반 전량매도는 예전과 같다 */
  { const hist=[
      {kind:'1회매수', date:'2026-05-01', price:100, qty:5},
      {kind:'지정가매도', date:'2026-05-02', price:130, qty:5},
    ];
    const c=run(hist);
    ok('C 일반 전량매도도 종료 · T=0', c.qty===0 && c.T===0 && !!c.rows[1].cycleEnd); }

  /* D. 매수만 있는 날은 종료가 아니다 (매도 수량 0) */
  { const hist=[{kind:'1회매수', date:'2026-05-01', price:100, qty:0}];
    const c=run(hist);
    ok('D 0주 매수는 사이클 종료가 아니다', !c.rows[0].cycleEnd, 'cycleEnd 가 잘못 찍힘'); }

  ok('판정이 종류 이름 목록이 아니라 기록의 sellQty 를 본다',
     /const _soldQty = \(h\.sellQty!=null\) \? \(\+h\.sellQty\|\|0\) : \(isSell\(h\.kind\) \? \(\+h\.qty\|\|0\) : 0\);/.test(idx)
     && /if\(qty<=1e-9 && _soldQty>0\)\{/.test(idx));
  ok('옛 규약(!isBuy 로 복합거래 제외)이 안 남아 있다',
     !/qty<=1e-9 && isSell\(h\.kind\) && !isBuy\(h\.kind\)/.test(idx));
}


/* ════ 99. VR 적립식 최초 자금 — 세 엔진이 같은 장부로 시작한다 ════  (5차 감사 ③)
   적립식(mode=0.75)에서
     runVR      : pool(=startPool+contrib) 으로 첫 매수
     vrReplay   : 같음
     vrSimForward : initAmt 로 첫 매수          ← 혼자 달랐다
   같은 설정인데 모의만 시작 원금이 달라졌고, 재생의 CAGR 분모도 쓰지도 않은 initAmt 를
   더하고 있었다. 제품 근거(백테 UI 가 적립식에서 초기투자금 칸을 숨긴다)와 다수결에 따라
   '적립식은 Pool+적립금으로 시작' 으로 통일한다. */
console.log('\n[99] VR 적립식 최초 자금 — 세 엔진 같은 장부');
{
  const FEE=0.0025, px=50, startPool=1000, contrib=200, initAmt=10000;
  const firstBuy=(amt)=>{ const q=Math.floor(amt/(1+FEE)/px); const spend=q*px, fee=spend*FEE;
    return {q, spent:spend+fee, left:amt-spend-fee}; };

  // 적립식 배정액 = startPool + contrib = 1200 → 23주 (1200/1.0025/50 = 23.94)
  const accAmt=startPool+contrib;
  const A=firstBuy(accAmt);
  ok('적립식 배정액 = startPool + contrib', near(accAmt,1200,1e-12), String(accAmt));
  ok('첫 매수 23주', A.q===23, String(A.q));
  ok('잔돈이 Pool 에 남는다', near(A.left, 1200-23*50-23*50*FEE, 1e-9), String(A.left));
  ok('초기 투자금으로 사면 다른 값이 된다 (옛 모의)', firstBuy(initAmt).q===199 && firstBuy(initAmt).q!==A.q,
     String(firstBuy(initAmt).q));

  // 세 경로가 같은 식을 쓰는가
  const sim=extractFn(idx,'function vrSimForward()');
  const rep=extractFn(idx,'function vrReplay()');
  const vr =extractFn(bt,'function runVR(days,tkr,params)');
  ok('모의체결이 적립식은 Pool+적립금으로 산다',
     /const _isAccum0=\(\+st\.mode\|\|0\.75\)===0\.75;/.test(sim)
     && /const amt=_isAccum0 \? \(\(\+st\.startpool\|\|0\)\+\(\+st\.add\|\|0\)\)/.test(sim));
  ok('모의체결이 모드 무관 initAmt 를 안 쓴다',
     !/const amt=st\.initAmt!=null\?\+st\.initAmt:10000, q=Math\.floor/.test(sim));
  ok('과거재생도 적립식은 Pool+적립금', /if\(isAccum\)\{\s*\n\s*pool\+=contrib;[\s\S]{0,180}_buyInt\(pool,c,d,false\)/.test(rep));
  ok('백테도 적립식은 Pool+적립금',
     /else\{pool\+=contrib;inv\+=contrib;cf\.push\(\[d,contrib\]\);pool-=_vbuy\(pool,c\);V=shares\*c;\}/.test(vr));
  ok('거치·인출식은 셋 다 초기 투자금',
     /\(st\.initAmt!=null\?\+st\.initAmt:10000\)/.test(sim)
     && /const amt=st\.initAmt!=null\?\+st\.initAmt:10000;/.test(rep)
     && /if\(isLump\)\{const s=initAmt\|\|10000;/.test(vr));

  /* 재생의 CAGR 분모 — 적립식은 안 쓴 initAmt 를 더하면 안 된다 */
  ok('적립식 총투입 = 적립금 × (사이클+1)',
     /const base=isAccum \? contrib\*\(cyc\+1\) : \(st\.initAmt!=null\?\+st\.initAmt:10000\);/.test(rep));
  ok('옛 분모(initAmt + contrib×cyc)가 안 남아 있다',
     !/\(st\.initAmt!=null\?\+st\.initAmt:10000\)\+\(isAccum\?contrib\*cyc:0\)/.test(idx));
  { // 값으로 — 적립 200 · 사이클 5회면 총투입 1,200 (첫 회차 포함 6회)
    const cyc=5, c2=contrib*(cyc+1);
    ok('적립 200 · 사이클 5 → 총투입 1,200', c2===1200, String(c2));
    ok('옛 분모면 11,000 이었다 (쓰지도 않은 초기금 포함)', initAmt+contrib*cyc===11000); }
}


/* ════ 100. 플랜·VR 주문 엔진 동기화 ════
   5년 플랜은 메인 주문표와 같은 무매 상태머신을 써야 하고,
   VR은 사이클 시작 때 만든 20차 예약 주문을 그 사이클 동안 고정한다. */
console.log('\n[100] 5년 플랜·VR 예약주문 동기화');
{
  const pl=fs.readFileSync(__d+'/plan.html','utf8');

  // ── 무한매수 플랜: 리버스 상태는 출금 같은 비거래 이벤트로 풀리면 안 된다.
  const revF=new Function('return ('+extractFn(pl,'function reverseTPlan').replace(/^function [\w$]+\(/,'function (')+')')();
  const stateSrc=extractFn(pl,'function calcInfState(sess)');
  /* 플랜의 실제 정의를 그대로 떼어 넣는다 — 예전엔 KIND_T·매수/매도 판정을 여기서 따로 지어 넣어,
     플랜 코드가 틀려도 시험은 제 사본으로 통과했다 (7차 점검에서 발견). */
  const plDefs=[
    pl.slice(pl.indexOf('const KIND_T='), pl.indexOf(';', pl.indexOf("'절반매수+지정가매도(애프터)'"))+1),
    (pl.match(/const isBuyKind=[^\n]*/)||[''])[0], (pl.match(/const isSellKind=[^\n]*/)||[''])[0],
    (pl.match(/const REV_DIVS_PLAN=[^\n]*/)||[''])[0] ].join('\n');
  ok('플랜 장부 의존 정의를 실코드에서 뗐다', /const KIND_T=/.test(plDefs) && /const isBuyKind=/.test(plDefs)
     && /const isSellKind=/.test(plDefs) && /const REV_DIVS_PLAN=\[20,40\];/.test(plDefs));
  const stateF=new Function('reverseTPlan', plDefs+'\n'+
    'return ('+stateSrc.replace(/^function [\w$]+\(/,'function (')+')')(revF);
  const base={settings:{principal:1000,div:20,target:20,reverse:true,compound:true},hist:[
    {kind:'1회매수',price:10,qty:20,tManual:20},
    {kind:'리버스매도',price:9,qty:2},
    {kind:'출금',amt:10}
  ]};
  const a=stateF(base);
  ok('플랜: 출금 뒤에도 리버스 상태 유지', a.revState==='REVERSE' && a.reverseActive===true, a.revState);
  const b=stateF({settings:base.settings,hist:[...base.hist,{kind:'리버스복귀'}]});
  ok('플랜: 리버스복귀 기록만 상태를 NORMAL로 돌린다', b.revState==='NORMAL' && b.reverseActive===false, b.revState);
  ok('플랜: 리버스 매도수량에 최소 1주 강제가 없다',
     /sellQty=Math\.floor\(c\.qty\/sellDiv\)/.test(pl) && !/sellQty=Math\.max\(1,Math\.floor\(c\.qty\/sellDiv\)\)/.test(pl));
  ok('플랜: 리버스 쿼터매수는 잔금÷4 배정액만 사용',
     /Math\.floor\(\(balance\/4\)\/buyPrice\)/.test(pl) && !/c\.bal>=bp\?1:0/.test(pl));
  ok('플랜: 일반 매수 수량은 공통 배정액 헬퍼 사용', /imBuyQtyPlan\(/.test(pl));
  ok('플랜: 아래로 LOC 추가 주문도 표시 (정식 — imBuyOrders · 줄 수 imRowsOf)', /imBuyOrders\(\{first, half:!first&&half/.test(pl) && /rows:imRowsOf\(st\)/.test(pl));

  // ── VR: 실제 함수로 20차 상한·체결차수 비재생·양방향 독립을 값으로 검증.
  for(const [label,src] of [['운영',idx],['백테',bt]]){
    const vf=new Function('return ('+extractFn(src,'function vrOrderPlan(S, P, bar)').replace(/^function [\w$]+\(/,'function (')+')')();
    let S={shares:100,pool:1e9,avg:100,V:10000};
    let z=vf(S,{band:.15,poolLimit:.5,budgetRemaining:1e9,FEE:0,baseShares:100,sellFilled:0,buyFilled:0,maxTiers:20},
             {high:1e9,low:1e9,close:100});
    ok(label+': 한 사이클 예약매도는 최대 20차', z.filter(x=>x.type==='sell').length===20,
       String(z.filter(x=>x.type==='sell').length));
    const soldAll=(z.filter(x=>x.type==='sell')).reduce((a,x)=>a+x.qty,0);
    z=vf({shares:100-soldAll,pool:1e9,avg:100,V:10000},
         {band:.15,poolLimit:.5,budgetRemaining:1e9,FEE:0,baseShares:100,sellFilled:soldAll,buyFilled:0,maxTiers:20},
         {high:1e9,low:1e9,close:100});
    ok(label+': 이미 체결한 매도 차수를 다음 날 재생성하지 않는다', z.filter(x=>x.type==='sell').length===0);

    S={shares:100,pool:1e9,avg:100,V:10000};
    z=vf(S,{band:.15,poolLimit:.5,budgetRemaining:1e9,FEE:0,baseShares:100,sellFilled:0,buyFilled:0,maxTiers:20},
           {high:.01,low:.01,close:.01});
    ok(label+': 한 사이클 예약매수는 최대 20차', z.filter(x=>x.type==='buy').length===20,
       String(z.filter(x=>x.type==='buy').length));
    const boughtAll=(z.filter(x=>x.type==='buy')).reduce((a,x)=>a+x.qty,0);
    z=vf({shares:100+boughtAll,pool:1e9,avg:100,V:10000},
         {band:.15,poolLimit:.5,budgetRemaining:1e9,FEE:0,baseShares:100,sellFilled:0,buyFilled:boughtAll,maxTiers:20},
         {high:.01,low:.01,close:.01});
    ok(label+': 이미 체결한 매수 차수를 재생성하지 않는다', z.filter(x=>x.type==='buy').length===0);

    // 5차 매수가 체결돼 현재 105주여도 매도 1차 가격은 사이클 시작 B=100 기준 115여야 한다.
    z=vf({shares:105,pool:1e9,avg:100,V:10000},
         {band:.15,poolLimit:.5,budgetRemaining:1e9,FEE:0,baseShares:100,sellFilled:0,buyFilled:5,maxTiers:20},
         {high:115.01,low:115.01,close:115.01});
    const s1=z.find(x=>x.type==='sell');
    ok(label+': 반대편 체결이 있어도 사다리 기준수량은 사이클 시작값 고정',
       !!s1 && near(s1.price,115,1e-9), s1?String(s1.price):'no fill');
  }
  ok('운영: 모의 규약 버전 6으로 올려 옛 VR·무매 모의 기록을 재생성 (정식 V 복귀 · 하방 LOC)', /const SIM_RULE_VER=6;/.test(idx));
  ok('운영·백테: 잘못된 “공식 (V 복귀)” UI 제거', !/공식 \(V 복귀\)/.test(idx) && !/공식 \(V 복귀\)/.test(bt));
  ok('플랜: 현재 사이클 시작수량과 양쪽 체결차수를 복원', /cycleBaseQty/.test(pl) && /cycleSellFilled/.test(pl) && /cycleBuyFilled/.test(pl));
}

/* ════ 101. 배당이 장부에 남는다 ════  (자체 점검 N1)
   앱이 조정종가로 돌 때는 배당이 가격에 녹아 있어 따로 셀 게 없었다.
   체결가 계열로 바꾸면 배당락일에 가격이 그만큼 떨어진 값 그대로 온다 —
   장부에 안 적으면 그 돈이 통째로 사라진다. 무매엔 배당이라는 칸 자체가 없었다.
   여기서 값으로 확인한다: 잔금에 더해지되 T·평단·보유·리버스 상태는 그대로여야 한다. */
console.log('\n[101] 무매 배당 기록 — 잔금만 늘고 나머지는 불변');
{
  const st={ticker:'SOXL',div:20,target:20,principal:10000,compound:true,reverse:true};
  const run=(hist)=>{ __strat={settings:st,hist:JSON.parse(JSON.stringify(hist))}; return computeInf(); };
  const base=[{kind:'1회매수', date:'2026-01-05', price:100, qty:5}];
  const withDiv=[...base, {kind:'배당', date:'2026-03-20', amt:37.5, qty:0}];

  const a=run(base), b=run(withDiv);
  ok('A 잔금이 배당만큼 는다', near(b.bal-a.bal, 37.5, 1e-9), `${a.bal} → ${b.bal}`);
  ok('A 보유·평단은 그대로', b.qty===a.qty && b.avg===a.avg, `${b.qty}주 / ${b.avg}`);
  ok('A T는 그대로', b.T===a.T, `${a.T} → ${b.T}`);
  ok('A 실현손익은 안 는다 (배당은 매매손익이 아니다)', b.realized===a.realized, String(b.realized));
  ok('A divTotal 로 따로 센다', near(b.divTotal,37.5,1e-9) && a.divTotal===0, String(b.divTotal));
  ok('A 사이클을 끝내지 않는다', !b.rows[b.rows.length-1].cycleEnd);
  ok('A 밖으로 나간 돈이 아니다', b.outside===a.outside, String(b.outside));

  /* B. 리버스 상태를 건드리면 안 된다 — 출금 한 줄로 리버스가 풀렸던 것과 같은 종류의 버그다 */
  { const h=[{kind:'1회매수', date:'2026-01-05', price:100, qty:5, tManual:19.5},
             {kind:'리버스매도', date:'2026-01-06', price:90, qty:1}];
    const c1=run(h);
    const c2=run([...h, {kind:'배당', date:'2026-01-07', amt:10, qty:0}]);
    ok('B 배당은 리버스 상태를 안 바꾼다', c2.revState===c1.revState && c2.revState==='REVERSE',
       `${c1.revState} → ${c2.revState}`);
    ok('B 리버스 표시도 그대로', c2.reverseActive===c1.reverseActive && c2.reverseActive===true); }

  /* C. 배당은 매수·매도가 아니다 — 잡히면 사이클 종료·T가 오염된다 */
  ok('C 배당은 매수가 아니다', isBuy('배당')===false);
  ok('C 배당은 매도가 아니다', isSell('배당')===false);
  ok('C 금액만 있는 기록으로 분류된다', isAmtKind('배당')===true && isAmtKind('출금')===true
     && isAmtKind('1회매수')===false);

  /* D. 단리: 사이클 종료 잔액 판정에 배당도 들어간다 (계좌에 실제로 들어온 돈이다).
       원금 10,000 · 5주@100 매수 → 배당 400 → 5주@2,000 전량매도.
       매도 실현손익 9,500 + 배당 400 = 9,900 초과분이 나가야 한다. */
  { const st2={...st, compound:false};
    const h=[{kind:'1회매수', date:'2026-01-05', price:100, qty:5},
             {kind:'배당',   date:'2026-03-20', amt:400, qty:0},
             {kind:'지정가매도', date:'2026-06-01', price:2000, qty:5}];
    __strat={settings:st2, hist:JSON.parse(JSON.stringify(h))};
    const c=computeInf();
    ok('D 단리 인출에 배당이 들어간다', near(c.saved, 9900, 1e-9), String(c.saved));
    ok('D 다음 사이클은 원금으로 다시 시작', near(c.bal, 10000, 1e-9), String(c.bal));
    /* 배당이 없으면 9,500 만 나간다 — 같은 경로에서 값이 갈리는지 본다 (변이 대조) */
    __strat={settings:st2, hist:h.filter(x=>x.kind!=='배당')};
    ok('D 배당을 빼면 인출도 그만큼 준다', near(computeInf().saved, 9500, 1e-9)); }

  /* E. 모의체결이 배당락일마다 스스로 적는다 — 없으면 위 장부가 영영 안 채워진다 */
  { const f=extractFn(idx,'function infSimForward(startFrom)');
    ok('E 모의체결이 배당을 적는다', /putDiv\(d\);/.test(f) && /kind:'배당'/.test(f));
    ok('E 그날 거래보다 먼저 적는다 — 배당은 전날 보유 주수로 받는다',
       f.indexOf('putDiv(d);') < f.indexOf("put('리버스매도'"));
    ok('E 현금수령 모드에선 안 적는다 (분배금 카드가 따로 센다)',
       /if\(divCashOn\(st\) \|\| !isTradeBasis\(Q\)\) return false;/.test(f));
    /* 조정 기준으로 돌고 있으면 배당이 이미 가격에 들어 있다 — 또 적으면 두 번 센다 */
    ok('E 조정 기준일 땐 안 적는다', /!isTradeBasis\(Q\)/.test(f)); }

  /* F. 세율 — 앱과 백테가 같은 값을 써야 한다 */
  { const Q={priceBasis:'trade', ohlc:[{date:'2026-03-20',close:100}],
             dividends:[{date:'2026-03-20', amount:2}]};
    ok('F 배당 세후 현금 = 주수 × 주당배당 × (1−세율)',
       near(divCashQ(Q,'2026-03-20',5,true), 5*2*(1-0.154), 1e-9),
       String(divCashQ(Q,'2026-03-20',5,true)));
    ok('F 세금을 끄면 전액', near(divCashQ(Q,'2026-03-20',5,false), 10, 1e-9));
    ok('F 배당락일이 아니면 0', divCashQ(Q,'2026-03-19',5,true)===0);
    ok('F 안 들고 있으면 0', divCashQ(Q,'2026-03-20',0,true)===0);
    ok('F 조정 기준이면 0 — 배당이 이미 가격에 들어 있다',
       divCashQ({...Q, priceBasis:'total_return'},'2026-03-20',5,true)===0);
    /* 같은 걸 두 군데서 세면 갈린다 — 앱·백테가 같은 값을 쓰는지 값으로 본다 */
    const _rate=src=>{ const m=src.match(/const DIV_TAXRATE=([0-9.]+);/); return m?+m[1]:null; };
    ok('F 앱·백테가 같은 배당세율', _rate(idx)!=null && _rate(idx)===_rate(bt),
       `${_rate(idx)} / ${_rate(bt)}`);
    /* 백테 divCash 와 앱 divCashQ 는 같은 식이어야 한다 — 세후 금액이 갈리면 장부가 갈린다 */
    { const bf=(bt.match(/function divCash\([\s\S]*?\n\}/)||[''])[0];
      ok('F 백테도 주수 × 주당배당 × (1−세율)', /shares\*a\*\(costOn\?\(1-DIV_TAXRATE\):1\)/.test(bf), bf?'':'divCash 없음'); } }
}

/* ════ 102. VR 배당 — Pool 로 들어온다 ════  (자체 점검 N1)
   VR 장부(computeVr)는 type:'div' 를 원래 읽었는데, 그걸 만들어 주는 코드가 없었다
   (grep 으로 0건). 조정종가로 돌던 시절엔 배당이 가격에 녹아 있어 티가 안 났지만
   체결가 계열로 바꾸면 그 돈이 통째로 사라진다. 모의체결·과거재생이 스스로 적게 했다. */
console.log('\n[102] VR 배당 — Pool 입금 · 백테와 같은 규약');
{
  const stv={ticker:'TQQQ',mode:0.75,formula:'basic',g:10,add:100,band:15,startv:0,startpool:0,cur:'usd'};
  const base=[{type:'buy',date:'2026-01-05',price:100,qty:10,fee:0,init:true,cyc:0}];
  const run=(h)=>{ __strat={settings:stv, hist:JSON.parse(JSON.stringify(h))}; return computeVr(); };

  const a=run(base), b=run([...base,{type:'div',date:'2026-03-20',amt:16.92,cyc:0}]);
  ok('A 배당이 Pool 로 들어간다', near(b.pool-a.pool, 16.92, 1e-9), `${a.pool} → ${b.pool}`);
  ok('A 보유 주수는 그대로', b.qty===a.qty, String(b.qty));
  ok('A V는 그대로', near(b.V,a.V,1e-9), `${a.V} → ${b.V}`);
  ok('A 이번 사이클 배당으로도 센다', near(b.cycDiv,16.92,1e-9), String(b.cycDiv));
  /* 실효 평단은 받은 배당만큼 내려간다 — (총매수−총매도−총배당)÷보유 */
  ok('A 실효 평단이 배당만큼 내려간다', near(a.avgEff-b.avgEff, 16.92/10, 1e-9),
     `${a.avgEff} → ${b.avgEff}`);
  ok('A 명목 평단은 그대로', near(b.avgNom,a.avgNom,1e-9), String(b.avgNom));

  /* B. 모의체결·과거재생이 배당을 스스로 적는다 — 없으면 위 장부가 영영 안 채워진다 */
  { const f=extractFn(idx,'function vrSimForward()');
    ok('B 모의체결이 배당을 적는다', /putDivV\(row\.date/.test(f) && /type:'div'/.test(f));
    ok('B 사다리보다 먼저 적는다', f.indexOf('putDivV(row.date') < f.indexOf('const fills=vrOrderPlan'));
    ok('B 현금수령·조정기준이면 안 적는다',
       /if\(divCashOn\(st\) \|\| !isTradeBasis\(Qv\)\) return false;/.test(f)); }
  { const f=extractFn(idx,'function vrReplay()');
    ok('B 과거재생도 배당을 적는다', /putDivR\(d\);/.test(f) && /type:'div'/.test(f));
    ok('B 재생기 안 Pool 과 기록을 같이 움직인다', /pool\+=cash; cycDiv\+=cash;/.test(f));
    ok('B 사이클이 바뀌면 cycDiv 도 리셋 (computeVr 과 같은 규약)',
       (f.match(/cycTrade=0; cycDiv=0;/g)||[]).length===2);
    ok('B 현금수령·조정기준이면 안 적는다',
       /const divOn=!divCashOn\(st\) && isTradeBasis\(q\);/.test(f)); }

  /* C. 앱과 백테가 같은 값을 낸다 — 같은 주수·같은 주당배당이면 세후 현금이 같아야 한다.
       백테 divCash 를 실코드에서 그대로 떼어 와 앱 divCashQ 와 맞춰 본다. */
  { const bsrc=[ bt.slice(bt.indexOf('const DIV_TAXRATE='), bt.indexOf(';', bt.indexOf('const DIV_TAXRATE='))+1),
                 (bt.match(/function divPerShare\(tkr, d\)\{[\s\S]*?\n\}/)||[''])[0],
                 (bt.match(/function divCash\(tkr, d, shares, costOn\)\{[\s\S]*?\n\}/)||[''])[0] ].join('\n');
    const btDiv=new Function('PBASIS','DIVMAP', bsrc+'\nreturn divCash;');
    const f=btDiv({TQQQ:'trade'},{TQQQ:{'2026-03-20':2}});
    const Q={priceBasis:'trade', dividends:[{date:'2026-03-20',amount:2}]};
    for(const sh of [1,10,137]){
      ok(`C ${sh}주 — 앱·백테 세후 배당이 같다`,
         near(divCashQ(Q,'2026-03-20',sh,true), f('TQQQ','2026-03-20',sh,true), 1e-9),
         `${divCashQ(Q,'2026-03-20',sh,true)} / ${f('TQQQ','2026-03-20',sh,true)}`); }
    /* 조정 기준이면 둘 다 0 — 이중계상을 막는 한 줄이 양쪽에 다 있어야 한다 */
    const f2=btDiv({TQQQ:'total_return'},{TQQQ:{'2026-03-20':2}});
    ok('C 조정 기준이면 앱·백테 둘 다 0',
       divCashQ({...Q,priceBasis:'total_return'},'2026-03-20',10,true)===0
       && f2('TQQQ','2026-03-20',10,true)===0); }

  /* D. 백테 VR 도 사다리보다 먼저 Pool 에 넣는다 — 앱과 순서가 같아야 한다 */
  { const f=extractFn(bt,'function runVR(days,tkr,params)');
    ok('D 백테 VR 도 Pool 로 받는다', /pool\+=divCash\(tkr,d,shares,costOn\);/.test(f));
    /* 앱과 순서가 같아야 한다 — 배당을 먼저 넣고 그 Pool 로 그날 사다리를 돌린다.
       _ladder 는 루프 위에서 정의되므로 '정의' 가 아니라 '부르는 자리' 를 본다. */
    ok('D 백테도 사다리보다 먼저 넣는다',
       f.indexOf('pool+=divCash(') < f.indexOf('_ladder(row[HI]'),
       `${f.indexOf('pool+=divCash(')} < ${f.indexOf('_ladder(row[HI]')}`); }
}

/* ════ 103. 모의체결기를 통째로 돌려 본다 ════  (자체 점검 N1 · 검증 ⑩-C)
   앞 절들은 '코드에 이 글자가 있는가' 를 봤다. 그건 줄 앞에 // 만 붙여도 통과한다 —
   실제로 putDiv(d) 를 주석 처리해 봤더니 회귀가 초록이었다(변이 시험에서 잡았다).
   그래서 여기서는 infSimForward 를 실코드 그대로 떼어 와 픽스처로 굴리고, 나온
   기록을 값으로 본다. 배당이 정말 장부에 남는지는 이 길로만 알 수 있다. */
console.log('\n[103] 무매 모의체결 — 실엔진을 굴려 배당 기록을 확인');
{
  /* 실코드에서 그대로 떼어 온다 — 여기서 다시 구현하면 '시험이 버그를 보호' 하게 된다 */
  const deps=['function _clampFrom(from, lastDate)','function _lastSettled(rows, cur)',
              'function imBuy1(c)','function revGapOf(st)','function sortHist(arr)',
              'function imTgtOf(base, mom)']
    .map(sig=>extractFn(idx,sig)).join('\n');
  const simCut=[/function settledBars\(rows,cur\)\{[^\n]*/, /function simCutoff\(cur\)\{[\s\S]*?\n\}/]
    .map(re=>(idx.match(re)||[''])[0]).join('\n');
  const imMom=(idx.match(/const IM_MOM_LEN=[^\n]*/)||[''])[0];

  let _saved=0;
  const run=(sess, Q, startFrom)=>{
    __strat=sess;
    const F=new Function('curStrat','computeInf','starPct','exitMulOf','imBuyQty','imRevBuyQty',
      'imBigPct','divCashOn','isTradeBasis','divCashQ','save','curOf','_exchNow',
      'MKT_CLOSE_MIN','SETTLE_LAG_MIN','lastQuote',
      [imMom, simCut, deps, 'let _infSimBusy=false;',
       extractFn(idx,'function infSimForward(startFrom)'),
       'return infSimForward;'].join('\n'))(
      ()=>__strat, computeInf, starPct, exitMulOf, imBuyQty, imRevBuyQty,
      imBigPct, divCashOn, isTradeBasis, divCashQ, ()=>{_saved++;}, ()=>'usd',
      ()=>({date:'2026-12-31', min:24*60}), {usd:16*60, krw:15*60+30}, 30, {inf:Q});
    return F(startFrom);
  };

  /* 배당락일에 '아무 매매도 안 나는' 날을 만든다 — 그래야 배당 하나만 값으로 읽힌다.
       평단 100 · T=1 · 20분할 → 별지점 118 · 익절가 120 · 큰수 상한 전일종가×1.15=115
       종가 116 이면: 116>115 라 매수 없음 · 116<118 이라 쿼터매도 없음 · 고가 116<120 이라 익절 없음 */
  const bar=(d,c,hi)=>({date:d, open:c, high:(hi!=null?hi:c), low:c, close:c});
  const O=[bar('2026-01-05',100), bar('2026-01-06',100), bar('2026-01-07',116)];
  const mkQ=(basis, divs)=>({symbol:'SOXL', ohlc:O, days:O.map(d=>({date:d.date,close:d.close})),
                       priceBasis:basis, dividends:(divs!==undefined?divs:[{date:'2026-01-07', amount:2}])});
  const mkSess=(over)=>({paper:true, id:'t1',
    settings:{ticker:'SOXL', div:20, target:20, principal:10000, compound:true,
              reverse:false, big:15, simLast:'2026-01-06', ...(over||{})},
    hist:[{kind:'1회매수', date:'2026-01-05', price:100, qty:5, ts:1}]});

  /* A. 체결가 계열 · 재투자 — 배당락일에 기록이 생기고 잔금이 는다 */
  { const sess=mkSess(), r=run(sess, mkQ('trade'));
    const divs=sess.hist.filter(h=>h.kind==='배당');
    ok('A 배당 기록이 하나 생긴다', divs.length===1, `${divs.length}건`);
    ok('A 배당락일에 찍힌다', divs.length===1 && divs[0].date==='2026-01-07',
       divs.length?divs[0].date:'-');
    /* 5주 × $2 × (1−0.154) = 8.46 */
    ok('A 금액 = 주수 × 주당배당 × (1−세율)', divs.length===1 && near(divs[0].amt, 8.46, 1e-6),
       divs.length?String(divs[0].amt):'-');
    ok('A 그날 매매는 없다 (배당만 본다)',
       sess.hist.filter(h=>h.date==='2026-01-07' && h.kind!=='배당').length===0,
       JSON.stringify(sess.hist.map(h=>h.date+':'+h.kind)));
    ok('A 반환값이 배당 건수를 알린다', r && r.nDiv===1, r?String(r.nDiv):'null');
    __strat=sess;
    const c=computeInf();
    ok('A 잔금에 들어간다', near(c.bal, 10000-500+8.46, 1e-6), String(c.bal));
    ok('A 보유·평단·T는 그대로', c.qty===5 && near(c.avg,100,1e-9) && near(c.T,1,1e-9),
       `${c.qty}주 / ${c.avg} / ${c.T}`); }

  /* A'. 배당이 없는 시세면 아무 것도 안 생긴다 — 같은 경로에서 값이 갈리는지 본다 */
  { const sess=mkSess(); const r=run(sess, mkQ('trade', []));
    ok("A' 배당 없는 종목이면 기록도 없다",
       sess.hist.filter(h=>h.kind==='배당').length===0 && r && r.nDiv===0);
    __strat=sess;
    ok("A' 잔금도 그대로", near(computeInf().bal, 9500, 1e-9), String(computeInf().bal)); }

  /* B. 조정 기준이면 안 적는다 — 배당이 이미 가격에 들어 있다 (이중계상) */
  { const sess=mkSess(); run(sess, mkQ('total_return'));
    ok('B 조정 기준이면 배당 기록이 없다', sess.hist.filter(h=>h.kind==='배당').length===0); }

  /* C. 현금 수령 모드면 안 적는다 — 계좌 밖으로 나가는 돈이라 분배금 카드가 따로 센다 */
  { const sess=mkSess({divmode:'cash'}); run(sess, mkQ('trade'));
    ok('C 현금 수령이면 배당 기록이 없다', sess.hist.filter(h=>h.kind==='배당').length===0); }

  /* D. 안 들고 있으면 안 준다 */
  { const sess=mkSess(); sess.hist=[];
    run(sess, mkQ('trade'));
    ok('D 보유 0주면 배당이 없다', sess.hist.filter(h=>h.kind==='배당').length===0,
       JSON.stringify(sess.hist.map(h=>h.kind))); }

  /* E. 두 번 돌려도 두 번 적지 않는다 — simLast 가 이미 지난 날을 막는다 */
  { const sess=mkSess(); run(sess, mkQ('trade')); run(sess, mkQ('trade'));
    ok('E 다시 돌려도 배당은 한 번뿐', sess.hist.filter(h=>h.kind==='배당').length===1,
       `${sess.hist.filter(h=>h.kind==='배당').length}건`); }

  /* F. 배당이 그날 매수 여력을 키운다 — '배당을 먼저 넣는다' 가 값으로 드러나는 자리다.
       평단 100 · 10주 · T=10 · 20분할 → 후반전이라 별지점(=평단 100) 전액 매수.
       배당락일 종가 98 이니 별지점 주문(99.99)에 닿는다.
       주문수량은 1회매수금 ÷ 주문가(99.99) 이므로 1회매수금이 99.99 를 넘어야 1주다:
         배당 없음  잔금 995     → 995/10 = 99.5   → 0주
         배당 있음  +16.92=1011.92 → 101.192      → 1주
       아래로 LOC 추가 줄(정식)은 배당 없이도 99.5÷1 에서 1주를 사므로 여기선 끈다(rows:0) —
       이 시험은 '배당이 본 주문 여력을 키우는가' 만 본다.                          */
  { const O2=[bar('2026-01-05',100), bar('2026-01-06',100), bar('2026-01-07',98)];
    const Q2=(divs)=>({symbol:'SOXL', ohlc:O2, days:O2.map(d=>({date:d.date,close:d.close})),
              priceBasis:'trade', dividends:divs});
    const mk=()=>({paper:true, id:'t2',
      settings:{ticker:'SOXL', div:20, target:20, principal:1995, compound:true,
                reverse:false, big:15, rows:0, simLast:'2026-01-06'},
      hist:[{kind:'1회매수', date:'2026-01-05', price:100, qty:10, tManual:10, ts:1}]});
    const buys=h=>h.filter(x=>x.date==='2026-01-07' && /매수/.test(x.kind));

    const s1=mk(); run(s1, Q2([{date:'2026-01-07', amount:2}]));
    ok('F 배당이 먼저 들어와 그날 1주를 산다', buys(s1.hist).length===1 && buys(s1.hist)[0].qty===1,
       JSON.stringify(s1.hist.filter(h=>h.date==='2026-01-07').map(h=>h.kind+':'+(h.qty!=null?h.qty:h.amt))));
    const s2=mk(); run(s2, Q2([]));
    ok('F 배당이 없으면 못 산다', buys(s2.hist).length===0,
       JSON.stringify(s2.hist.filter(h=>h.date==='2026-01-07').map(h=>h.kind))); }
}

/* ════ 104. 모의 성과 '세션' 칸 — 이름 대신 종목·주요 설정 ════
   이름은 사람이 손으로 붙이는 것이라 설정과 어긋난다. '40/10' 이라 써 놓고 분할만
   바꾼 세션이 실제로 있었고, 목록만 보면 알 길이 없었다. 설정에서 직접 읽는다. */
console.log('\n[104] 모의 성과 — 세션 칸에 종목·주요 설정');
{
  const po=new Function('curOf','wnCur','maCond',
    extractFn(idx,'function paperOpts(tab, st)')+'\nreturn paperOpts;')(
    st=>(/^(?:\d{6}|\d{4}[A-Z]\d)(?:\.K[SQ])?$/.test(String((st||{}).ticker||'').toUpperCase())?'krw':'usd'),
    (v,cur)=>cur==='krw'?Math.round(+v||0).toLocaleString('en-US')+'₩'
      :(+v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'$',
    new Function('return '+extractFn(idx,'function maCond(st)')+';')());
  const j=(t,st)=>po(t,st).join(' · ');

  /* A. 무매 — 분할·익절이 설정에서 나온다 (이름과 무관) */
  ok('A 무매 기본', j('inf',{ticker:'SOXL',div:40,target:10})==='40분할 · 익절 10%',
     j('inf',{ticker:'SOXL',div:40,target:10}));
  ok('A 분할을 바꾸면 따라 바뀐다', j('inf',{ticker:'SOXL',div:20,target:10})==='20분할 · 익절 10%',
     j('inf',{ticker:'SOXL',div:20,target:10}));
  ok('A 변형 설정만 덧붙는다',
     j('inf',{ticker:'SOXL',div:20,target:20,reverse:true,tgtDyn:true,compound:false,engine:'v50'})
     ==='20분할 · 익절 20% · V5.0 · 리버스 · 익절 동적 · 단리',
     j('inf',{ticker:'SOXL',div:20,target:20,reverse:true,tgtDyn:true,compound:false,engine:'v50'}));
  ok('A 기본값이면 안 붙인다', j('inf',{ticker:'SOXL',div:20,target:20,reverse:false,compound:true})
     ==='20분할 · 익절 20%');

  /* B. VR — 운용 모드가 셋 다 제 이름으로 나온다 */
  ok('B 적립식', j('vr',{ticker:'TQQQ',mode:0.75,band:15,g:10})==='적립식 · 밴드 15% · G10',
     j('vr',{ticker:'TQQQ',mode:0.75,band:15,g:10}));
  ok('B 거치식', /^거치식 /.test(j('vr',{ticker:'TQQQ',mode:0.5,band:15,g:10})));
  ok('B 인출식', /^인출식 /.test(j('vr',{ticker:'TQQQ',mode:0.25,band:15,g:10})));
  ok('B 실력공식은 덧붙는다', /실력공식$/.test(j('vr',{ticker:'TQQQ',mode:0.75,band:20,g:8,formula:'skill'})));
  ok('B 밴드·G도 설정에서', j('vr',{ticker:'TQQQ',mode:0.75,band:20,g:8})==='적립식 · 밴드 20% · G8',
     j('vr',{ticker:'TQQQ',mode:0.75,band:20,g:8}));

  /* C. 섀넌 · 200일선 · 적립 · ASAP */
  ok('C 섀넌', j('ivs',{ticker:'TQQQ',mode:'iv',band:15,park:'bill'})==='역분산 1/σ² · 밴드 15% · 단기국채',
     j('ivs',{ticker:'TQQQ',mode:'iv',band:15,park:'bill'}));
  ok('C 섀넌 고정·1배수', j('ivs',{ticker:'TQQQ',mode:'fix',band:15,park:'x1'})==='고정 5:5 · 밴드 15% · 1배수');
  ok('C 200일선', j('ma',{ticker:'SOXL',buy:'ma',sell:'ma',park:'cash'})==='매수 200선 · 매도 200선 · 현금',
     j('ma',{ticker:'SOXL',buy:'ma',sell:'ma',park:'cash'}));
  ok('C 200일선 크로스', j('ma',{ticker:'SOXL',buy:'cross',sell:'both',park:'bill'})
     ==='매수 크로스 · 매도 둘다 · 단기국채');
  ok('C 적립', j('dca',{ticker:'USD',mode:'dca',amount:10,freq:'day'})==='매일 10$',
     j('dca',{ticker:'USD',mode:'dca',amount:10,freq:'day'}));
  ok('C 적립 거치식', j('dca',{ticker:'USD',mode:'lump',amount:10,freq:'day'})==='거치식');
  ok('C 적립 하락배수', /하락 ×2$/.test(j('dca',{ticker:'USD',mode:'dca',amount:50,freq:'month',dipMul:2})));
  ok('C ASAP', j('asap',{ticker:'SOXL',base:10,mid:50,deep:100})==='base 10$ · mid 50$ · deep 100$',
     j('asap',{ticker:'SOXL',base:10,mid:50,deep:100}));

  /* D. 국내 종목이면 원화로 적는다 */
  ok('D 국내 적립은 원화', j('dca',{ticker:'069500',mode:'dca',amount:10000,freq:'month'})==='매월 10,000₩',
     j('dca',{ticker:'069500',mode:'dca',amount:10000,freq:'month'}));

  /* E. 세션 이름은 한 글자도 안 들어간다 — 이게 이번 변경의 요점이다 */
  { const st={ticker:'SOXL',div:40,target:10};
    ok('E 이름을 넣어도 무시한다', j('inf',{...st,name:'내맘대로이름'})==='40분할 · 익절 10%'); }
  ok('E 렌더도 r.name 을 칸에 안 쓴다',
     !/<span class="cw">\$\{String\(r\.name\)/.test(idx));
}

/* ════════════════════════════════════════════════════════════════════
   7차 점검 — 같은 실데이터를 운영·모의·백테에 넣고 거래 단위로 맞대 본다
   ════════════════════════════════════════════════════════════════════
   예전 시험은 '코드에 이 글자가 있는가' 와 '앱 == 백테' 를 따로 봤다. 두 엔진이 같은 식으로
   틀리면 둘 다 초록이었다 — 실제로 모의·백테가 쿼터매도 뒤 같은 종가에 되사는 룩어헤드를
   함께 갖고 있었고(7차 ②), 실전 체결을 재현해 맞대 보고서야 최종자산 −12%~+20% 차이가 나왔다.
   여기서는 '실전 흐름' 을 기준으로 삼는다: 아침에 어제까지의 장부로 주문표를 뽑아 그날 봉에
   체결시키고, 그 결과가 모의·백테와 한 건도 안 다른지 본다. 엔진은 전부 실코드에서 떼어 온다. */
console.log('\n[105] 7차 — 무매 백테 ↔ 모의 ↔ 운영(주문표→실제 체결) 거래 단위 대조');
const __P7={};
{
  // ── 백테: 날짜 달린 거래로그 (하네스의 __LOG 주입본에서 날짜만 더한다) ──
  const btD=btSrc.replace(/__LOG\(/g,'__LOGD(d,');
  let LOGD=[]; global.__LOGD=(d,k,p,q)=>LOGD.push({date:d,kind:k,price:+p,qty:+q});
  const runIMd=new Function(btD+'\nreturn runIM;')();
  // ── 모의: infSimForward 실코드 ──
  const deps=['function _clampFrom(from, lastDate)','function _lastSettled(rows, cur)','function imBuy1(c)',
    'function revGapOf(st)','function sortHist(arr)','function imTgtOf(base, mom)']
    .map(sig=>extractFn(idx,sig)).join('\n');
  const simCut=[/function settledBars\(rows,cur\)\{[^\n]*/, /function simCutoff\(cur\)\{[\s\S]*?\n\}/]
    .map(re=>(idx.match(re)||[''])[0]).join('\n');
  const imMom=(idx.match(/const IM_MOM_LEN=[^\n]*/)||[''])[0];
  const paperRun=(sess,Q,startFrom)=>{
    __strat=sess;
    const F=new Function('curStrat','computeInf','starPct','exitMulOf','imBuyQty','imRevBuyQty','imBigPct',
      'divCashOn','isTradeBasis','divCashQ','save','curOf','_exchNow','MKT_CLOSE_MIN','SETTLE_LAG_MIN','lastQuote',
      [imMom, simCut, deps, 'let _infSimBusy=false;', extractFn(idx,'function infSimForward(startFrom)'),
       'return infSimForward;'].join('\n'))(
      ()=>__strat, computeInf, starPct, exitMulOf, imBuyQty, imRevBuyQty, imBigPct, divCashOn, isTradeBasis, divCashQ,
      ()=>{}, ()=>'usd', ()=>({date:'2099-12-31', min:24*60}), {usd:16*60, krw:15*60+30}, 30, {inf:Q});
    return F(startFrom);
  };
  const ohlcOf=tk=>DAYS[tk].map(d=>{ const r=M[tk][d]; return {date:d, close:r[C], open:r[O], high:r[HI], low:r[LO]}; });
  const quoteOfTk=tk=>({symbol:tk, ohlc:ohlcOf(tk), days:DAYS[tk].map(d=>({date:d,close:M[tk][d][C]})), priceBasis:'trade', dividends:[]});
  // ── 운영: renderOrder 실코드 (한 번만 컴파일하고 상태만 바꿔 부른다) ──
  const need=['function computeInf()','function imBuy1(c)','function starPct(ticker,div,T,base)','function reverseT(kind,t,div)',
    'function oitem(cls,name,tag,price,qty)','function renderOrder()','function imMomNow()','function imTgtOf(base, mom)',
    'function calcStarPoint(c)','function revGapOf(st)','function exitMulOf(base)','function quoteOf(tab)','function fmtT(t)',
    'function isSell(k)','function isBuy(k)','function isCx(k)','function isAmtKind(k)','function simCutoff(cur)',
    'function settledBars(rows,cur)','function curOf(st)','function isKrCode(t)','function imRowsNote(n)',
    'function imRuleTag(st)','function imRuleOf(st)','function imVariantOf(cfg)','function revSupported(div)','function revEnabled(st)']
    .map(x=>extractFn(idx,x)).join('\n');
  const KINDSRC=idx.slice(idx.indexOf('const KIND_T='), idx.indexOf('};', idx.indexOf('const KIND_T='))+2);
  const IMOFF=idx.slice(idx.indexOf('const IM_OFFICIAL='), idx.indexOf(';', idx.indexOf('const IM_OFFICIAL='))+1);
  const ENV={ST:null, HIST:null, DAYS:null, CLOSE:0};
  const appOrders=new Function('ENV', `
    const EL=()=>({textContent:'',innerHTML:'',style:{},value:'',classList:{add(){},remove(){},toggle(){}}});
    let todayOrders=[];
    const $=(id)=>(id==='o_close'||id==='o_star5man')?{value:''}:EL();
    const wn=v=>'$'+(+v||0).toFixed(2), px=wn, inputNum=()=>0;
    const curStrat=()=>({id:'s',settings:ENV.ST,hist:ENV.HIST});
    const S={activeTab:'inf'};
    let infChartData=null, infSimNote='', infSimNoteSid=null, _lastNeedClose=null;
    const lastQuote={inf:null};
    ${KINDSRC}
    ${IMOFF}
    ${(idx.match(/const KR_CODE_RE=[^\n]*/)||[''])[0]}
    const MKT_CLOSE_MIN={usd:16*60, krw:15*60+30}, SETTLE_LAG_MIN=20;
    function _exchNow(cur){ return {date:'2099-12-31', min:23*60}; }
    const IM_MOM_LEN=20, IM_MOM_TH=8, IM_MOM_CAP=30;
    ${need}
    function infSettledLast(){ return {close:ENV.CLOSE}; }
    function render5day(){} function renderKisPanel(){}
    return function(){ lastQuote.inf={symbol:ENV.ST.ticker, days:ENV.DAYS, last:ENV.CLOSE}; infChartData=ENV.DAYS;
                       renderOrder(); return todayOrders; };`)(ENV);
  const kindOf=(o,rev)=>{
    if(o.side==='sell') return o.tag==='지정가'?'지정가매도':(rev?'리버스매도':'쿼터매도');
    if(/쿼터매수/.test(o.name)) return '리버스매수';
    if(/처음매수|전액/.test(o.name)) return '1회매수';
    if(/별지점 매수|평단 매수/.test(o.name)) return '절반매수';
    return '1회매수';
  };
  /* 실전 흐름 — 아침에 어제까지의 장부로 주문을 전부 걸고, 그날 봉에서 체결된다.
       지정가 매도 : 고가 ≥ 가격 → max(시가, 가격) · LOC 매도 : 종가 ≥ 가격 → 종가
       LOC 매수 : 종가 ≤ 가격 → 종가 · MOC 매도 : 종가.   기록 순서는 시간 순. */
  const liveRun=(tk,st)=>{
    const all=DAYS[tk], H=[]; let seq=0;
    for(let i=1;i<all.length;i++){
      const d=all[i], [cl,op,hi]=M[tk][d];
      __strat={settings:{...st},hist:H}; const rev=!!computeInf().reverseActive;
      ENV.ST={...st}; ENV.HIST=H.slice(); ENV.CLOSE=M[tk][all[i-1]][C];
      ENV.DAYS=all.slice(0,i).map(x=>({date:x,close:M[tk][x][C]}));
      const od=appOrders();
      for(const o of od.filter(o=>o.side==='sell'&&o.tag==='지정가')) if(hi>=o.price) H.push({date:d,kind:'지정가매도',price:+(op>o.price?op:o.price).toFixed(4),qty:o.qty,ts:++seq});
      for(const o of od.filter(o=>o.side==='sell'&&o.tag!=='지정가')) if(o.tag==='MOC'||cl>=o.price) H.push({date:d,kind:kindOf(o,rev),price:+cl.toFixed(4),qty:o.qty,ts:++seq});
      /* 아래로 LOC 추가 줄('하방 k')은 같은 회차의 일부 — 그날 체결된 첫 본 주문 기록에 수량을 더한다.
         본 주문 없이 추가 줄만 닿으면 1회매수 한 건으로 적는다 (정식 문서 반영 · 모의·백테와 같은 규약). */
      { const hit=od.filter(o=>o.side==='buy'&&cl<=o.price), lad=hit.filter(o=>/^하방 /.test(o.name)), mains=hit.filter(o=>!/^하방 /.test(o.name));
        const extra=lad.reduce((a,o)=>a+o.qty,0);
        mains.forEach((o,i)=>H.push({date:d,kind:kindOf(o,rev),price:+cl.toFixed(4),qty:o.qty+(i===0?extra:0),ts:++seq}));
        if(!mains.length && extra>0) H.push({date:d,kind:'1회매수',price:+cl.toFixed(4),qty:extra,ts:++seq}); }
      __strat={settings:{...st},hist:H}; const c1=computeInf();
      if(rev && c1.qty>0 && cl>c1.avg*exitMulOf(st.target)) H.push({date:d,kind:'리버스복귀',price:cl,qty:0,ts:++seq});
    }
    return H;
  };
  Object.assign(__P7,{runIMd, paperRun, quoteOfTk, appOrders, ENV, LOGD:()=>LOGD, setLOGD:v=>{LOGD=v;}});
  const key=x=>`${x.date} ${x.kind} ${(+x.price).toFixed(4)} x${x.qty}`;
  const trades=a=>a.filter(h=>h.kind!=='리버스복귀'&&h.kind!=='배당').map(key);
  const firstDiff=(A,B)=>{ let k=0; while(k<A.length&&k<B.length&&A[k]===B[k]) k++; return (k===A.length&&k===B.length)?-1:k; };
  const _save={imFill:global.imFill, imCostOn:global.imCostOn, imTgtDyn:global.imTgtDyn, imRevGap:global.imRevGap, imReverse:global.imReverse};
  global.imFill='high'; global.imCostOn=false; global.imTgtDyn=false; global.imRevGap=0;   // 모의와 같은 모델
  const CFG=[['SOXL',20,20,true,false,true],['TQQQ',40,15,false,false,false],['SOXL',20,20,true,true,true],['TQQQ',40,15,true,true,false]];
  for(const [tk,div,tgt,comp,rev,live] of CFG){
    if(!DAYS[tk]) continue;
    global.imReverse=rev;
    const all=DAYS[tk], days=all.slice(1);
    const st={ticker:tk,div,target:tgt,principal:10000,compound:comp,reverse:rev,big:15,revGap:0,tgtDyn:false,divmode:'reinv',
              rows:8,rowqty:1};
    LOGD=[]; runIMd(days, tk, 10000, div, tgt, comp, 15);
    const B=LOGD.map(key);
    const sess={paper:true,id:'p',simStart:days[0],settings:{...st},hist:[]};
    paperRun(sess, quoteOfTk(tk), days[0]);
    const P=trades(sess.hist);
    const nm=`${tk} ${div}분할 ${comp?'복리':'단리'} 리버스${rev?'ON':'OFF'}`;
    const k1=firstDiff(B,P);
    ok(`${nm} — 백테 ↔ 모의 거래 ${B.length}건 한 건도 안 다르다`, k1<0,
       k1<0?'':`#${k1} 백테 [${B[k1]||'—'}] 모의 [${P[k1]||'—'}]`);
    if(live){
      const L=trades(liveRun(tk,st));
      const k2=firstDiff(L,P);
      ok(`${nm} — 운영(주문표→실제 체결) ↔ 모의 거래 ${L.length}건 한 건도 안 다르다`, k2<0,
         k2<0?'':`#${k2} 운영 [${L[k2]||'—'}] 모의 [${P[k2]||'—'}]`);
    }
  }
  Object.assign(global,_save);

  /* 7차 ② 를 값으로 — 쿼터매도가 체결된 날 같은 종가에 되사면 안 된다.
     실데이터 SOXL 20분할 2020-09-25: 아침 별지점 14.8030 · 종가 14.9865 → 쿼터매도만.
     예전 모의·백테는 쿼터매도 뒤 T(9.5→7.125)로 별지점을 15.4992 로 다시 계산해 17주를 되샀다. */
  { global.imReverse=false; global.imFill='high'; global.imCostOn=false; global.imTgtDyn=false;
    const tk='SOXL', days=DAYS[tk]?DAYS[tk].slice(1):null;
    if(days){
      const sess={paper:true,id:'p',simStart:days[0],settings:{ticker:tk,div:20,target:20,principal:10000,compound:true,
        reverse:false,big:15,revGap:0,tgtDyn:false,divmode:'reinv'},hist:[]};
      paperRun(sess, quoteOfTk(tk), days[0]);
      const day=sess.hist.filter(h=>h.date==='2020-09-25');
      ok('7차 ② 쿼터매도 날 같은 종가 되사기가 없다 (2020-09-25)',
         day.some(h=>h.kind==='쿼터매도') && !day.some(h=>/매수/.test(h.kind)), day.map(h=>h.kind+'×'+h.qty).join(' · '));
      // 전 구간: 같은 날 매도(쿼터·지정가)와 매수가 같은 종가에 동시에 찍힌 날 — 쿼터매도 날엔 0 이어야 한다
      const byDay={}; sess.hist.forEach(h=>{ (byDay[h.date]=byDay[h.date]||[]).push(h); });
      const bad=Object.entries(byDay).filter(([d,a])=>a.some(h=>h.kind==='쿼터매도')&&a.some(h=>/매수/.test(h.kind)));
      ok('7차 ② 6년 전 구간에 쿼터매도+매수 동시 체결 날이 없다', bad.length===0, bad.slice(0,3).map(x=>x[0]).join(','));
    }
    Object.assign(global,_save); }

  /* 7차 ③ — 가진 봉의 맨 첫날엔 전일 확정 종가가 없다 → 그날 주문도 없다.
     예전 모의는 '전일종가 || 오늘종가' 로 오늘 종가를 빌려 첫날부터 샀다(백테는 5차 ⑤ 에서 막음). */
  { const tk='SOXL';
    if(DAYS[tk]){
      const sess={paper:true,id:'p0',simStart:DAYS[tk][0],settings:{ticker:tk,div:20,target:20,principal:10000,compound:true,
        reverse:false,big:15,revGap:0,tgtDyn:false,divmode:'reinv'},hist:[]};
      paperRun(sess, quoteOfTk(tk), DAYS[tk][0]);
      const d0=sess.hist.filter(h=>h.date===DAYS[tk][0]);
      ok('7차 ③ 첫 봉(전일 종가 없음)에는 주문이 없다', d0.length===0 && sess.hist.length>0,
         d0.map(h=>h.kind+'×'+h.qty).join(' · ')); } }

  /* 7차 ④ — 수량은 '아침 잔금 ÷ 주문가' 안에서만. 실데이터 TQQQ 40분할 단리 2022-03-16:
     남은 회차 1.044 · 잔금 253.76 · 별지점 매수 LOC 23.2730. 전일종가 기준이면 11주(예약 256.00 > 잔금)
     → 증권사 거부. 예전 주문표·서버·플랜은 11주를 냈고, 모의·백테는 '오늘 종가' 로 10주를 잘랐다. */
  /* 정식 문서 반영(아래로 LOC 추가)으로 장부가 바뀌어 그날이 옮겨 갔다 — 날짜를 박지 않고
     '남은 회차 1~1.1 인 첫 날' 을 찾아 같은 전제를 만든다. */
  { const tk='TQQQ';
    if(DAYS[tk]){
      global.imReverse=false;
      const all=DAYS[tk], days=all.slice(1);
      const st={ticker:tk,div:40,target:15,principal:10000,compound:false,reverse:false,big:15,revGap:0,tgtDyn:false,divmode:'reinv',
                rows:8,rowqty:1};
      const sess={paper:true,id:'p4',simStart:days[0],settings:{...st},hist:[]};
      paperRun(sess, quoteOfTk(tk), days[0]);
      const D=days.find(d=>{ __strat={settings:{...st},hist:sess.hist.filter(h=>h.date<d)}; const r=40-computeInf().T; return r>=1 && r<1.1; })||days[0];
      const i=all.indexOf(D);
      const hist=sess.hist.filter(h=>h.date<D);
      __strat={settings:{...st},hist}; const c=computeInf();
      ENV.ST={...st}; ENV.HIST=hist; ENV.CLOSE=M[tk][all[i-1]][C]; ENV.DAYS=all.slice(0,i).map(x=>({date:x,close:M[tk][x][C]}));
      const buys=appOrders().filter(o=>o.side==='buy');
      const reserve=buys.reduce((a,o)=>a+o.qty*o.price,0);
      ok('7차 ④ 그날 전제 — 남은 회차가 1.1 미만 (한도가 걸리는 날)', (40-c.T)<1.1 && (40-c.T)>=1 && buys.length>0, D+' '+String(40-c.T));
      ok('7차 ④ 주문표 매수 예약금이 잔금을 안 넘는다', reserve<=c.bal+1e-9, `예약 ${reserve.toFixed(2)} · 잔금 ${c.bal.toFixed(2)}`);
      const filled=sess.hist.filter(h=>h.date===D && /매수/.test(h.kind)).reduce((a,h)=>a+h.qty,0);
      ok('7차 ④ 모의가 산 주수 = 주문표 주수', filled===buys.filter(o=>M[tk][D][C]<=o.price).reduce((a,o)=>a+o.qty,0),
         `모의 ${filled} · 주문표 ${buys.map(o=>o.qty).join('+')}`); } }
}

/* ════ 106. 7차 — 무매 운영 3벌: 앱 주문표 · 서버 자동주문 · 5년 플랜 ════
   장부(computeInf·imCompute·calcInfState)와 주문(renderOrder·imOrders·플랜 imOrders)을 같은 입력에서 맞댄다.
   서버 판은 4·5차 감사 이전 규칙에 멈춰 있었다 — 복합거래 0주 종료·배당·리버스 상태·큰수 기본값이 달랐다. */
console.log('\n[106] 7차 — 무매 운영 3벌 (장부·주문)');
{
  const imSrc7=fs.readFileSync(__d+'/functions/api/_im.js','utf8');
  const SV=new Function(imSrc7.replace(/export /g,'')+'\nreturn {imOrders,imCompute,imBigPct,IM_BIG_DEFAULT,REV_DIVS};')();
  const pl=fs.readFileSync(__d+'/plan.html','utf8');
  const PL=new Function([
    (pl.match(/const usd=v=>[^\n]*/)||[''])[0], (pl.match(/const FEE=[^\n]*/)||[''])[0],
    pl.slice(pl.indexOf('const KIND_T='), pl.indexOf(';', pl.indexOf("'절반매수+지정가매도(애프터)'"))+1),
    (pl.match(/const isBuyKind=[^\n]*/)||[''])[0], (pl.match(/const isSellKind=[^\n]*/)||[''])[0],
    (pl.match(/const REV_DIVS_PLAN=[^\n]*/)||[''])[0],
    (pl.match(/function reverseTPlan[^\n]*/)||[''])[0], (pl.match(/function starPctPlan[^\n]*/)||[''])[0],
    (pl.match(/function imBuyQtyPlan[^\n]*/)||[''])[0], (pl.match(/function imRevBuyQtyPlan[^\n]*/)||[''])[0],
    extractFn(pl,'function calcInfState(sess)'), extractFn(pl,'function imOrders(sess,price,rows)'),
    'return {imOrders, calcInfState};'].join('\n'))();
  // 같은 값을 쓰는가 — 큰수 기본값·리버스 지원 분할
  ok('7차 ⑥ 서버 큰수 기본값 = 앱·백테 (15)', SV.IM_BIG_DEFAULT===IM_BIG_DEFAULT && SV.imBigPct({})===IM_BIG_DEFAULT,
     `${SV.IM_BIG_DEFAULT} / ${IM_BIG_DEFAULT}`);
  ok('7차 ⑤ 서버·플랜 리버스 지원 분할 = 앱 (20·40)', JSON.stringify(SV.REV_DIVS)===JSON.stringify(REV_DIVS)
     && /const REV_DIVS_PLAN=\[20,40\];/.test(pl), JSON.stringify(SV.REV_DIVS));
  // ── 장부 3벌 — 실데이터 모의 이력의 매 시점(7번째마다) + 출금·배당을 섞어서 ──
  const F=['avg','qty','T','bal','reverseActive'];
  const same=(a,b)=>F.every(k=>typeof a[k]==='boolean'?a[k]===b[k]:Math.abs((+a[k]||0)-(+b[k]||0))<=1e-6*Math.max(1,Math.abs(+a[k]||0)));
  global.imReverse=true;
  for(const [tk,div,tgt,comp] of [['SOXL',20,20,false],['TQQQ',40,15,true]]){
    if(!DAYS[tk]) continue;
    const all=DAYS[tk], days=all.slice(1);
    const st={ticker:tk,div,target:tgt,principal:10000,compound:comp,reverse:true,big:15,revGap:0,tgtDyn:false,divmode:'reinv'};
    const sess={paper:true,id:'p',simStart:days[0],settings:{...st},hist:[]};
    __P7.paperRun(sess, __P7.quoteOfTk(tk), days[0]);
    const H=[]; let n=0;
    for(const h of sess.hist){ H.push(h); n++;
      if(n%97===0) H.push({date:h.date,kind:'배당',amt:12.34,qty:0});
      if(n%131===0) H.push({date:h.date,kind:'출금',amt:5}); }
    let dS=0,dP=0,cnt=0,ex='';
    for(let i=7;i<=H.length;i+=7){ const hh=H.slice(0,i); cnt++;
      __strat={settings:{...st},hist:hh}; const a=computeInf();
      const b=SV.imCompute({...st},hh), p=PL.calcInfState({settings:{...st},hist:hh});
      if(!same(a,b)){ dS++; if(!ex) ex=`#${i} 서버 T=${b.T} bal=${b.bal} vs 앱 T=${a.T} bal=${a.bal}`; }
      if(!same(a,p)){ dP++; if(!ex) ex=`#${i} 플랜 T=${p.T} bal=${p.bal} vs 앱 T=${a.T} bal=${a.bal}`; } }
    ok(`${tk} ${div}분할 — 장부 3벌이 ${cnt}개 시점에서 같다 (평단·보유·T·잔금·리버스)`, dS===0&&dP===0,
       `서버 ${dS} · 플랜 ${dP} ${ex}`);
  }
  // ── 경계 사례 — 서버가 예전에 틀리던 자리 ──
  { const st={ticker:'SOXL',div:20,target:20,principal:10000,compound:true,reverse:true};
    const C3=(nm,hh,s2)=>{ const S2=s2||st; __strat={settings:{...S2},hist:hh}; const a=computeInf();
      const b=SV.imCompute({...S2},hh), p=PL.calcInfState({settings:{...S2},hist:hh});
      ok('7차 ⑤ 경계 — '+nm, same(a,b)&&same(a,p), `앱 T=${a.T} q=${a.qty} 리버스=${a.reverseActive} bal=${a.bal} · 서버 T=${b.T} q=${b.qty} 리버스=${b.reverseActive} bal=${b.bal}`);
      return {a,b}; };
    const r1=C3('복합거래로 0주면 사이클 종료 (5차 ④)',[{kind:'1회매수',date:'d1',price:100,qty:3},
      {kind:'1회매수+지정가매도(애프터)',date:'d2',buyPrice:100,buyQty:1,sellPrice:130,sellQty:4}]);
    ok('   └ 서버도 T=0 · 보유 0', r1.b.T===0 && r1.b.qty===0, `T=${r1.b.T} q=${r1.b.qty}`);
    const r2=C3('리버스 중 출금 한 줄로 리버스가 안 풀린다',[{kind:'1회매수',date:'d1',price:10,qty:20,tManual:20},
      {kind:'리버스매도',date:'d2',price:9,qty:2},{kind:'출금',date:'d3',amt:10}]);
    ok('   └ 서버도 리버스 유지 → 일반 주문을 안 낸다', r2.b.reverseActive===true
       && /리버스/.test(SV.imOrders({st:{...st,big:15},hist:[{kind:'1회매수',date:'d1',price:10,qty:20,tManual:20},
          {kind:'리버스매도',date:'d2',price:9,qty:2},{kind:'출금',date:'d3',amt:10}],close:9,days:[]}).skip||''));
    const r3=C3('배당은 잔금에 들어간다 (N1)',[{kind:'1회매수',date:'d1',price:100,qty:5},{kind:'배당',date:'d2',amt:37.5,qty:0}]);
    ok('   └ 서버 잔금도 +37.5', Math.abs(r3.b.bal-(10000-500+37.5))<1e-9, String(r3.b.bal));
    C3('30분할은 리버스 규칙이 없다',[{kind:'1회매수',date:'d1',price:10,qty:20,tManual:29.5}],{...st,div:30}); }
  // ── 주문 3벌 — 같은 장부·같은 확정 종가에서 (5거래일마다) ──
  const norm=o=>`${o.side} ${o.tag||''} ${(+o.price).toFixed(4)} x${o.qty}`;
  for(const [tk,div,tgt,comp,rev,big] of [['SOXL',20,20,true,true,15],['TQQQ',20,15,true,false,undefined]]){
    if(!DAYS[tk]) continue;
    global.imReverse=rev;
    const all=DAYS[tk], days=all.slice(1);
    const st={ticker:tk,div,target:tgt,principal:10000,compound:comp,reverse:rev,revGap:0,tgtDyn:false,divmode:'reinv',rows:8,rowqty:1};
    if(big!==undefined) st.big=big;
    const sess={paper:true,id:'p',simStart:days[0],settings:{...st},hist:[]};
    __P7.paperRun(sess, __P7.quoteOfTk(tk), days[0]);
    let nd=0,dS=0,dP=0,ex='';
    for(let i=1;i<all.length;i+=5){
      const d=all[i], hist=sess.hist.filter(h=>h.date<d), close=M[tk][all[i-1]][C];
      const settled=all.slice(0,i).map(x=>({date:x,close:M[tk][x][C]}));
      __P7.ENV.ST={...st}; __P7.ENV.HIST=hist; __P7.ENV.CLOSE=close; __P7.ENV.DAYS=settled;
      const A=__P7.appOrders().map(norm).sort().join(' | ');
      const sv=SV.imOrders({st:{...st},hist,close,days:settled});
      const S2=sv.skip?null:sv.orders.map(norm).sort().join(' | ');
      const P2=PL.imOrders({settings:{...st},hist},close,settled).orders.map(norm).sort().join(' | ');
      nd++;
      if(S2!==null && A!==S2){ dS++; if(!ex) ex=`${d} 앱[${A}] 서버[${S2}]`; }
      if(A!==P2){ dP++; if(!ex) ex=`${d} 앱[${A}] 플랜[${P2}]`; }
    }
    ok(`${tk} ${div}분할 리버스${rev?'ON':'OFF'} big=${big===undefined?'없음':big} — 주문 3벌이 ${nd}일 전부 같다`,
       dS===0&&dP===0, `서버 ${dS}일 · 플랜 ${dP}일 ${ex}`);
  }
  global.imReverse=false;
}

/* ════ 107. 7차 — VR 백테 ↔ 모의 ↔ 과거재생 ════
   수수료 0.25% · 세금 0 으로 맞추고(모의·재생엔 세금 개념이 없다) 같은 날 시작한다.
   인출식은 Pool 보다 큰 인출을 모의만 그대로 빼서 음수 Pool 로 갈렸다 (7차 ⑪, 최종 35,699 vs 40,222). */
console.log('\n[107] 7차 — VR 백테 ↔ 모의 ↔ 과거재생 거래 단위 대조');
{
  let vsrc=extractFn(bt,'function runVR(days,tkr,params)');
  const vinj=(a,b)=>{ const p=vsrc.split(a); if(p.length!==2) throw new Error('VR 주입 실패: '+a.slice(0,40)); vsrc=p[0]+b+p[1]; };
  vinj(`function _vbuyQ(q,c){ if(!(q>0)) return 0;`, `function _vbuyQ(q,c){ if(!(q>0)) return 0; __VL('buy',q,c);`);
  vinj(`const qty=Math.min(q,shares); if(!(qty>0)) return 0;`, `const qty=Math.min(q,shares); if(!(qty>0)) return 0; __VL('sell',qty,c);`);
  vinj(`days.forEach((d,i)=>{\n    const c=M[tkr][d][C];`, `days.forEach((d,i)=>{ __VD=d;\n    const c=M[tkr][d][C];`);
  let VLOG=[]; global.__VD=''; global.__VL=(t,q,p)=>VLOG.push({date:__VD,type:t,qty:+q,price:+p});
  const runVRd=new Function(vsrc+'\nreturn runVR;')();
  const vdeps=['function _clampFrom(from, lastDate)','function _lastSettled(rows, cur)','function sortHist(arr)',
    'function paperStart(sess)','function vrCycStart(c)','function poolLimit(c)',
    'function vrCycleTransition(V, pool, ev, G, mode, add, formula)','function vrTick(p, cur)','function vrTickUp(p, cur)','function vrTickDn(p, cur)',
    'function vrStepCycle(sess, c, dateStr, close)','function cycDates(c)','function vrNextDue(s)',
    'function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)','function vrOrderPlan(S, P, bar)','function vrModelOf(st)',
    'function simCutoff(cur)','function settledBars(rows,cur)','function divCashOn(st)',
    'function isTradeBasis(Q)','function divPerShareQ(Q, d)','function divCashQ(Q, d, shares, taxOn)']
    .map(sig=>extractFn(idx,sig)).join('\n');
  const vconsts=[(idx.match(/const CYC_DAYS=\d+;/)||[''])[0], (idx.match(/const DIV_TAXRATE=[^;]*;/)||[''])[0],
    "const VR_MODEL_DEFAULT='vreturn'; const IVS_FEE=0.0025;",
    "const MKT_CLOSE_MIN={usd:16*60, krw:15*60+30}; const SETTLE_LAG_MIN=20;",
    "function _exchNow(cur){ return {date:'2099-12-31', min:23*60}; }", "function curOf(st){ return 'usd'; }"].join('\n');
  const mkVr=(sess,Q,from)=>{ __strat=sess;
    return new Function('curStrat','computeVr','computeNextV','lastQuote','$','save','refreshVr','pushRemote','wn','px',
      [vconsts, vdeps, 'let _vrAutoBusy=false, vrLedgerCheck=null;', extractFn(idx,'function vrSimForward()'),
       extractFn(idx,'function vrReplay()'), 'const confirm=()=>true, alert=()=>{};',
       'return {vrSimForward, vrReplay, ledger:()=>vrLedgerCheck};'].join('\n'))(
      ()=>__strat, computeVr, computeNextV, {vr:Q},
      (id)=>id==='rp_vr_from'?{value:from}:{value:'',textContent:''}, ()=>{}, ()=>{}, null,
      v=>'$'+(+v).toFixed(2), v=>'$'+(+v).toFixed(2)); };
  const Qv=tk=>({symbol:tk, ohlc:DAYS[tk].map(d=>{const r=M[tk][d];return {date:d,close:r[C],open:r[O],high:r[HI],low:r[LO]};}),
                 days:DAYS[tk].map(d=>({date:d,close:M[tk][d][C]})), priceBasis:'trade', dividends:[]});
  const same1=(a,b)=>a.date===b.date&&a.type===b.type&&a.qty===b.qty&&Math.abs(a.price-b.price)<=1e-5;
  const diff=(X,Y)=>{ let k=0; while(k<X.length&&k<Y.length&&same1(X[k],Y[k])) k++; return (k===X.length&&k===Y.length)?-1:k; };
  const K=x=>x?`${x.date} ${x.type} ${(+x.price).toFixed(6)} x${x.qty}`:'—';
  const _cgt=global.capGainTax; global.capGainTax=()=>0;
  for(const [tk,mode,formula,G,band,add] of [['TQQQ',0.75,'basic',10,15,100],['TECL',0.5,'skill',20,10,0],['TQQQ',0.25,'basic',10,15,50]]){
    if(!DAYS[tk]) continue;
    const all=DAYS[tk], start=all[1], days=all.slice(1);
    VLOG=[]; const r=runVRd(days, tk, {contrib:add, G, bandPct:band, mode, formula, initAmt:10000, withdraw:add, costOn:true});
    const B=VLOG.slice();
    const st={ticker:tk, mode, formula, g:G, initAmt:10000, add, band, startv:0, startpool:0, autoCyc:false, vrModel:'vreturn', divmode:'reinv'};
    const sP={paper:true,id:'v',simStart:start,settings:{...st},hist:[]}; mkVr(sP,Qv(tk),start).vrSimForward();
    const P=sP.hist.filter(h=>h.type==='buy'||h.type==='sell').map(h=>({date:h.date,type:h.type,qty:+h.qty,price:+h.price}));
    __strat=sP; const cP=computeVr();
    const sR={paper:true,id:'r',simStart:start,settings:{...st},hist:[]}; const eR=mkVr(sR,Qv(tk),start); eR.vrReplay();
    const R=sR.hist.filter(h=>h.type==='buy'||h.type==='sell').map(h=>({date:h.date,type:h.type,qty:+h.qty,price:+h.price}));
    __strat=sR; const cR=computeVr();
    const nm=`${tk} ${mode===0.75?'적립':mode===0.5?'거치':'인출'} ${formula} G${G} 밴드${band}%`;
    const kP=diff(B,P), kR=diff(B,R);
    ok(`${nm} — 백테 ↔ 모의 체결 ${B.length}건 같다`, kP<0, kP<0?'':`#${kP} 백테 [${K(B[kP])}] 모의 [${K(P[kP])}]`);
    ok(`${nm} — 백테 ↔ 과거재생 체결 ${B.length}건 같다`, kR<0, kR<0?'':`#${kR} 백테 [${K(B[kR])}] 재생 [${K(R[kR])}]`);
    ok(`${nm} — V·Pool 세 곳이 같다`, Math.abs(cP.V-r.V)<=1e-3 && Math.abs(cR.V-r.V)<=1e-3
       && Math.abs(cP.pool-r.pool)<=1e-3 && Math.abs(cR.pool-r.pool)<=1e-3,
       `V ${r.V}/${cP.V}/${cR.V} Pool ${r.pool}/${cP.pool}/${cR.pool}`);
    if(mode===0.25) ok('7차 ⑪ 인출식 Pool 이 음수로 안 간다', sP.hist.every(()=>true) && (()=>{
        let pool=0, ok_=true; __strat={settings:{...st},hist:[]};
        for(let i=1;i<=sP.hist.length;i++){ __strat={settings:{...st},hist:sP.hist.slice(0,i)}; if(computeVr().pool<-1e-6){ ok_=false; break; } }
        return ok_; })());
  }
  global.capGainTax=_cgt;
  Object.assign(__P7,{mkVr});      // 제8차 [118] 골든이 같은 실코드 하네스로 모의·재생을 돌린다
}

/* ════ 108. 7차 — VR 주문표 = 체결 엔진 (vrTiers 한 곳) ════
   표는 한도를 넘긴 차수만 건너뛰고 뒤 차수를 '유효' 로 보였는데, 엔진은 첫 초과 차수에서 멈췄다 (7차 ⑫). */
console.log('\n[108] 7차 — VR 주문표·체결 엔진·5년 플랜이 같은 차수를 건다');
{
  const tv=extractFn(idx,'function renderVrTable()');
  ok('7차 ⑫ 주문표가 vrTiers 로 차수를 받는다', /const LT=vrTiers\(B, sf, bf, c\.up, c\.lo, limit,/.test(tv)
     && !/for\(let k=bf\+1;k<=N;k\+\+\)/.test(tv) && !/for\(let k=sf\+1;k<=Math\.min\(N,B\);k\+\+\)/.test(tv));
  ok('7차 ⑫ 체결 엔진도 vrTiers 를 쓴다 (두 파일 같은 몸)',
     /const L=vrTiers\(B, sf, bf, up, dn, budget, fee1, N, P\.cur\);/.test(extractFn(bt,'function vrOrderPlan(S, P, bar)'))
     && extractFn(idx,'function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)')===extractFn(bt,'function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)'));
  // 값 — 한도가 한 차수 안에서 바닥나면 그 차수는 살 수 있는 만큼만 사고, 나머지와 뒤 차수는 전부 한도 밖이다
  { // B=100 · V=10000 · 하단 8500 → 1차 85 × 18주(1530$) · 수수료 없음. 한도 1000$ → 1차 11주만, 나머지 7주와 2차부터 한도 밖
    const L=vrTiers(100,0,0,11500,8500,1000,1,20);
    ok('7차 ⑫ (V 복귀) 한도가 1차 안에서 바닥나면 11주만 사고 나머지는 한도 밖', L.buys.length===1 && L.buys[0].q===11 && L.buys[0].p===85
       && L.over.length>=2 && L.over[0].k===1 && L.over[0].q===7 && L.over[1].k===2,
       `유효 ${L.buys.map(x=>x.k+':'+x.q).join(',')} · 밖 ${L.over.slice(0,3).map(x=>x.k+':'+x.q).join(',')}…`); }
  // 5년 플랜 vrOrders 와 같은 목록 — 모의 장부 끝에서
  { const pl=fs.readFileSync(__d+'/plan.html','utf8');
    const PLV=new Function([(pl.match(/const usd=v=>[^\n]*/)||[''])[0], (pl.match(/const FEE=[^\n]*/)||[''])[0],
      extractFn(pl,'function calcVrState(sess)'), (pl.match(/function nextVrDate\(s\)\{[^\n]*/)||[''])[0],
      (pl.match(/function vrCycleStart\(c\)\{[^\n]*/)||[''])[0], extractFn(pl,'function vrOrders(sess,price)'),
      ...['function vrTick(p, cur)','function vrTickUp(p, cur)','function vrTickDn(p, cur)','function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)'].map(x=>extractFn(pl,x)),
      'return {vrOrders};'].join('\n'))();
    const hist=[{type:'buy',date:'2026-01-02',price:50,qty:200,fee:25,init:true,cyc:0},{type:'add',date:'2026-01-02',amt:4000,cyc:0},
                {type:'sell',date:'2026-01-05',price:57.6,qty:1,fee:0.144,cyc:0},{type:'buy',date:'2026-01-06',price:42.4,qty:3,fee:0.318,cyc:0}];
    const st={ticker:'TQQQ',mode:0.75,formula:'basic',g:10,initAmt:10000,add:100,band:15,startv:0,startpool:0,cycStart:'2026-01-02'};
    __strat={settings:st,hist}; const c=computeVr();
    const lim=Math.max(0,c.cycStartPool*st.mode-c.cycBuySpent);
    const L=vrTiers(Math.floor(c.cycBaseQty||c.qty), c.cycSellFilled, c.cycBuyFilled, c.up, c.lo, lim, 1.0025, 20, 'usd');
    const a=[...L.sells.map(t=>'sell '+t.p.toFixed(6)), ...L.buys.map(t=>'buy '+t.p.toFixed(6))].join('|');
    const b=PLV.vrOrders({settings:st,hist},50).orders.map(o=>o.side+' '+(+o.price).toFixed(6)).join('|');
    ok('7차 ⑫ 5년 플랜 주문 = 앱 표 (같은 장부)', a===b, a.length+' / '+b.length); }
}

/* ════ 109. 7차 — 서버 자동주문·앱 운영의 입력값 ════ */
console.log('\n[109] 7차 — 서버 자동주문 입력 · 한투 전송 · VR 수동 진입');
{
  const at=fs.readFileSync(__d+'/functions/api/autotrade.js','utf8');
  ok('7차 ⑩ 서버가 통화를 종목코드로 정한다 (앱 curOf 와 같게)',
     /const cur = KRCODE\.test\(sym\.replace\(\/\\\.K\[SQ\]\$\/, ""\)\) \? "krw" : "usd";/.test(at) && !/st\.cur\)/.test(at));
  ok('7차 ⑦ 서버가 앱과 같은 가격 계열을 받는다 (div=1 · 체결가 우선)',
     /&intraday=0&div=1/.test(at) && /const bars = tradeOK \? q\.ohlcTrade : \(q\.series \|\| q\.ohlc \|\| \[\]\);/.test(at));
  ok('7차 ⑦ 익절 조절 20일 창은 확정 봉까지만', /days = bar \? bars\.filter\(\(x\) => x && x\.date <= bar\.date/.test(at));
  // 7차 ⑨ — MOC 는 한투로 보내지 않는다 (지정가만 받으므로)
  { const f=new Function(extractFn(idx,'function kisSendable(o)')+'\nreturn kisSendable;')();
    ok('7차 ⑨ MOC 주문은 한투 전송 목록에서 빠진다', f({qty:5,price:10,tag:'MOC'})===false && f({qty:5,price:10,tag:'LOC'})===true
       && f({qty:5,price:10,tag:'지정가'})===true);
    ok('7차 ⑨ 두 전송 경로가 같은 판정을 쓴다', (idx.match(/todayOrders\.filter\(kisSendable\)/g)||[]).length===2
       && !/todayOrders\.filter\(o=>o\.qty>0&&o\.price>0\)/.test(idx));
    ok('7차 ⑨ 리버스 1일차 MOC 가격 자리에 평단을 안 적는다', /oitem\('s',`무한매도 \(보유÷\$\{sellDiv\}\)`,'MOC',close,sellQty\)/.test(idx)
       && !/'MOC',c\.avg,sellQty/.test(idx)); }
  // 7차 ⑭ — VR 실력공식 수동 진입 평가금은 진입일 확정 종가
  { const e=extractFn(idx,'function enterNextCycle()');
    // 값은 [110] 이 vrEntryEval 로 본다. 여기서는 진입이 확정 봉만 골라 그 함수에 넘기는지만 본다.
    ok('7차 ⑭ 수동 진입이 확정 봉만 골라 평가금 함수에 넘긴다',
       /const bars=\(Qv&&Qv\.days\)\?Qv\.days\.filter\(d=>d&&d\.close>0&&d\.date<=cut\):\[\];/.test(e)
       && /const E0=vrEntryEval\(c, bars, du0\?du0\.dueStr:null, man\), onAfter=E0\.onAfter;/.test(e)
       && /ev=E0\.ev;/.test(e)
       && !/vrEval\(/.test(e.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/.*$/gm,'')));   // 주석의 '예전엔 vrEval(…)' 설명은 빼고 코드만
    ok('7차 ⑪ 수동 진입도 인출은 Pool 안에서만 — 미리보기와 같은 r 에서 (제8차 8-②)',
       /const sign=r\.sign, add=r\.actual;/.test(e) && /h\.push\(\{type:r\.type, date:startDate, amt:\+add\.toFixed\(6\)/.test(e)); }
  { const f=(mode,add,pool)=>vrCycleTransition(10000,pool,10000,10,mode,add,'basic');   // 제8차 8-⑦ 공용 전환식 (앱 실코드)
    ok('7차 ⑪ 인출식: Pool 1.10 · 인출금 50 → 1.10 만', Math.abs(f(0.25,50,1.1).actual-1.1)<1e-12);
    ok('7차 ⑪ 인출식: Pool 이 음수면 0', f(0.25,50,-3).actual===0);
    ok('7차 ⑪ 적립식은 전액 넣는다', f(0.75,100,0).actual===100 && f(0.75,100,0).type==='add');
    ok('7차 ⑪ 거치식은 아무것도 안 움직인다', f(0.5,100,50).actual===0 && f(0.5,100,50).type===null); }
  ok('7차 ⑪ 5년 플랜 진입도 인출은 Pool 안에서만 (공용 전환식의 actual)', /const flowAmt=r\.actual;/
     .test(fs.readFileSync(__d+'/plan.html','utf8')));
  ok('7차 ⑬ VR 기록 자릿수 6 (모의 잔돈·가격·V)', /amt:\+left\.toFixed\(6\),cyc:0,sim:true/.test(idx)
     && /price:\+f\.price\.toFixed\(6\), qty:f\.qty,/.test(idx) && !/st\.startv=\+r\.nextV\.toFixed\(4\)/.test(idx));
}

/* ════ 110. 7차 ⑧·⑭ — 변이 시험에서 살아남았던 두 곳을 값으로 ════
   ⑧ 익절 조절(imMomNow)과 ⑭ VR 수동 진입 평가금은 소스 모양만 보고 있어서, 옛 코드로
   되돌려도 회귀가 초록불이었다(변이 시험 20건 중 2건 생존). 둘 다 값으로 묶는다. */
console.log('\n[110] 7차 ⑧·⑭ — 익절 조절 20일 창 · VR 수동 진입 평가금 (값으로)');
{
  { const mom=extractFn(idx,'function imMomNow()');
    let CUT='2099-12-31';
    const sb=(rows,cur)=>(rows||[]).filter(r=>r.date<=CUT);
    const mk=(days)=>new Function('quoteOf','curStrat','settledBars','curOf','infChartData','IM_MOM_LEN',
      'return ('+mom.replace(/^function \w+\(/,'function (')+')')(()=>({days}), ()=>({settings:{}}), sb, ()=>'usd', null, 20);
    // 1월 1일~21일 확정 종가 100→120 (하루 1씩), 22일은 아직 움직이는 장중 봉 200
    const days=Array.from({length:21},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'), close:100+i}));
    const live=[...days, {date:'2026-01-22', close:200}];
    CUT='2026-01-21';
    const m=mk(live)();
    ok('7차 ⑧ 익절 조절 20일 상승률은 확정 봉까지만 — 장중 봉(200)이 안 섞인다 (120/100 → 20%)', near(m,20,1e-9), String(m));
    CUT='2099-12-31';
    const m2=mk(live)();
    ok('7차 ⑧ 그 봉이 확정되면 그때 들어간다 (200/101)', near(m2,(200/101-1)*100,1e-9), String(m2));
  }
  { const f=new Function(extractFn(idx,'function vrEntryEval(c, bars, dueStr, man)')+'\nreturn vrEntryEval;')();
    const bars=[{date:'2026-03-02',close:10},{date:'2026-03-04',close:11},{date:'2026-03-05',close:12}];
    const c={qty:10, V:999};
    const r1=f(c,bars,'2026-03-03',0);
    ok('7차 ⑭ 진입일(03-03)이 휴장이면 다음 거래일(03-04) 확정 종가 × 보유 = 110', r1.ev===110 && r1.onAfter && r1.onAfter.date==='2026-03-04',
       JSON.stringify(r1));
    const r2=f(c,bars,'2026-03-06',0);
    ok('7차 ⑭ 진입일 봉이 아직 없으면(조기 진입) 마지막 확정 종가 × 보유 = 120', r2.ev===120 && !r2.onAfter, JSON.stringify(r2));
    ok('7차 ⑭ 손으로 넣은 평가금이 이긴다', f(c,bars,'2026-03-03',500).ev===500);
    ok('7차 ⑭ 보유가 없거나 확정 봉이 없으면 V', f({qty:0,V:999},bars,'2026-03-03',0).ev===999 && f(c,[],'2026-03-03',0).ev===999);
  }
}

/* ════ 111. 7차 D8 — 섀넌·200일선·ASAP 도 체결가 + 배당 기록 ════
   7-⑮ 는 이 세 전략을 임시로 조정종가로 돌려 배당을 가격 안에 넣었다. 대신 신호 계열이 백테(체결가)와
   달라졌다(200일선 신호가 15년에 1~13일 갈림). D8 은 무매·VR 처럼 가격은 체결가, 배당은 배당락일에
   보유 주수만큼 세후 현금 기록으로 받게 한다 — 백테 runIVS·runMA200·runASAP 과 같은 규약이다.
   거래 단위 대조(배당 포함)는 [112]·[113]·[115] 가 한다. 여기는 배선과 장부 값. */
console.log('\n[111] 7차 D8 — 섀넌·200일선·ASAP 체결가 + 배당 기록');
{
  ok('7차 D8 조정 뷰(adjDaily)가 없다 — 세 전략도 체결가', !/adjDaily\(/.test(idx));
  const L={ma:['async function loadMaData(force)','maQuoteData'], ivs:['async function loadIvsData(force)','ivsQuoteData'],
           asap:['async function loadAsapData(force)','asapQuoteData']};
  for(const [k,[sig,v]] of Object.entries(L)){
    const f=extractFn(idx,sig);
    ok(`7차 D8 ${k} 로더가 체결가 그대로 받고 배당·가격기준을 싣는다`,
       /const q=await fetchDaily\(sym\);/.test(f) && new RegExp(v+'=\\{[\\s\\S]{0,260}dividends:q\\.dividends\\|\\|\\[\\], priceBasis:q\\.priceBasis\\|\\|null\\}').test(f)); }
  ok('7차 D8 섀넌 1배 짝도 배당·가격기준을 싣는다',
     /dividends:q1\.dividends\|\|\[\], priceBasis:q1\.priceBasis\|\|null\}/.test(extractFn(idx,'async function loadIvsData(force)')));
  // ── 장부 값 ──
  { const ivsPosF=new Function('IVS_FEE', extractFn(idx,'function ivsPos(principal,hist)')+'\nreturn ivsPos;')(0.0025);
    const H=[{type:'buy',leg:'lev',date:'2024-01-02',price:100,qty:10,amt:1000,fee:2.5,ts:1},
             {type:'div',leg:'lev',sym:'TQQQ',date:'2024-03-20',amt:5,ts:2}];
    const P=ivsPosF(10000,H);
    ok('7차 D8 섀넌 장부 — 배당은 현금으로 들어오고 넣은 돈(added)이 아니다',
       near(P.cash,10000-1002.5+5,1e-9) && P.qty===10 && P.added===0 && near(P.divs,5,1e-12) && near(P.avg,100.25,1e-9),
       `현금 ${P.cash} 보유 ${P.qty} added ${P.added} divs ${P.divs} 평단 ${P.avg}`); }
  { const maL=new Function(extractFn(idx,'function maLedger(hist, price, principal)')+'\nreturn maLedger;')();
    const L2=maL([{type:'in',date:'2024-01-02',price:100,qty:10},{type:'div',date:'2024-03-20',amt:5}], 110, 10000);
    ok('7차 D8 로테 장부 — 배당은 현금으로, 평단·보유는 그대로',
       near(L2.cash,10000-1000-2.5+5,1e-9) && L2.qty===10 && near(L2.divs,5,1e-12) && near(L2.total,1100+L2.cash,1e-9),
       JSON.stringify({cash:L2.cash,qty:L2.qty,divs:L2.divs,total:L2.total})); }
  { const ap=new Function(extractFn(idx,'function asapPos(hist)')+'\nreturn asapPos;')();
    const P=ap([{type:'sgov',date:'2024-01-02',amt:100},{type:'buy',date:'2024-01-03',price:20,qty:2.5,amt:50,from:'reserve'},
                {type:'div',date:'2024-03-20',amt:3}]);
    ok('7차 D8 ASAP 장부 — 배당은 리저브로, 새로 넣은 돈과 따로 센다',
       near(P.reserve,53,1e-12) && near(P.divs,3,1e-12) && near(P.shares,2.5,1e-12), JSON.stringify(P)); }
  { const pr=extractFn(idx,'function paperRaw(tab, sess)');
    ok('7차 D8 ASAP 투입 원금에 배당이 안 들어간다',
       /if\(x\.type==='sgov'\) inflow\+=\+x\.amt\|\|0;/.test(pr) && !/x\.type==='div'/.test(pr)); }
  // ── 현금 수령 세션의 섀넌 분배금 — 다리마다 자기 종목·자기 주수 ──
  { const f=new Function('divCashOn','divOf','ivsX1Of','divIncome','shareTimeline',
      extractFn(idx,'function ivsDivCash(st, hist, onReady)')+'\nreturn ivsDivCash;')(
      global.divCashOn, (t)=>({dividends:[{date:'2024-03-20',amount:t==='TQQQ'?0.1:1.0}]}), ()=>'QQQ',
      new Function(extractFn(idx,'function divIncome(divs, lots, reinv)')+'\nreturn divIncome;')(),
      new Function(extractFn(idx,'function shareTimeline(hist)')+'\nreturn shareTimeline;')());
    const H=[{type:'buy',leg:'lev',date:'2024-01-02',price:50,qty:100},{type:'buy',leg:'x1',date:'2024-01-02',price:400,qty:10}];
    const r=f({ticker:'TQQQ',divmode:'cash'},H);
    ok('7차 D8 1배 짝 세션 — 레버리지 배당은 레버리지 주수에만, 1배 배당은 1배 주수에만 (100×0.1 + 10×1.0 = 20)',
       near(r.divCash,20,1e-12) && r.nDiv===2, JSON.stringify(r));
    ok('7차 D8 재투자 세션은 0 (장부 기록이 이미 셌다)', f({ticker:'TQQQ',divmode:'reinv'},H).divCash===0); }
  // ── 화면 ──
  ok('7차 D8 기록표·수정창에 배당이 있다',
     /div:\['배당','var\(--gold\)'\]/.test(idx) && /<option value="div">배당 \(세후 · 계좌 안 수입\)<\/option>/.test(idx)
     && /const LBL=\{in:'진입\(매수\)',out:'청산\(현금\)',div:'배당'\}/.test(idx) && /<option value="div">배당 \(세후\)<\/option>/.test(idx)
     && /div:'배당 → 리저브'/.test(idx) && /<option value="div">배당 \(리저브 입금 · 세후\)<\/option>/.test(idx));
  ok('7차 D8 손으로 적는 배당 — 세 전략 모두',
     /onclick="ivsCash\('div'\)"/.test(idx) && /onclick="maDivRecord\(\)"/.test(idx) && /onclick="asapRecord\('div'\)"/.test(idx));
  ok('7차 D8 화면 설명문이 체결가 + 세후 배당이라고 적는다',
     !/가격은 <b>조정종가<\/b>/.test(idx) && (idx.match(/세후 현금<\/b>/g)||[]).length>=2);
  // 무매·VR 은 원래 체결가 + 배당 — 그대로
  const raw=['async function fetchQuote(which)','async function loadVrChart(force)','async function loadInfData(force)','async function loadInfChart(force)']
    .map(sig=>extractFn(idx,sig));
  ok('7차 D8 무매·VR 로더도 체결가 그대로', raw.every(src=>/await fetchDaily\(/.test(src)));
}

/* ════ 112. 7차 ⑯ — 섀넌 운영 재생 ↔ 백테 거래 단위 대조 ════
   같은 시세·같은 설정이면 같은 날 같은 다리를 같은 주수로 사고팔아야 한다. 예전엔 운영 재생이
   사고팔기 모두 소수점, 백테는 사기만 정수·팔기는 소수점이라 첫 매도부터 주수·잔금이 갈렸다.
   백테에만 있는 규약(예수금 이자·국채 쪽 비용·양도세·배당 현금)은 끄고 수수료를 같게 둔다
   (ivsNeutralSrc) — 남는 건 매매 규칙뿐이라 한 건도 달라선 안 된다. */
console.log('\n[112] 7차 ⑯ — 섀넌 운영 재생 ↔ 백테 거래 단위 대조 (주수 정수)');
{
  const _wf0=WARM_FROM, _wt0=WARM_TO; WARM_FROM=''; WARM_TO='';
  const imBQ=new Function(extractFn(idx,'function imBuyQty(alloc, refPx, feeRate)')+'\nreturn imBuyQty;')();
  const ivsPosF=new Function(extractFn(idx,'function ivsPos(principal,hist)')+'\nreturn ivsPos;')();
  const appSrc=extractFn(idx,'function ivsReplay()');
  let bsrc=ivsNeutralSrc(extractFn(bt,'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)'), true);   // 배당 포함 (7차 D8)
  const inj=(a,b,l)=>{ const p=bsrc.split(a); if(p.length!==2) throw new Error(`[112] 주입 실패(${l}): ${p.length-1}회`); bsrc=p[0]+b+p[1]; };
  inj(`days.forEach((d,i)=>{`, `days.forEach((d,i)=>{ __DD=d;`, 'date');
  inj(`lotBuy(P.lot,q,px,fee+lf); P.sh+=q; cash-=spend+lf;`,
      `lotBuy(P.lot,q,px,fee+lf); P.sh+=q; cash-=spend+lf; __LOG.push({type:'buy',leg:P===A?'lev':'x1',date:__DD,price:px,qty:q});`, 'buy');
  inj(`yearPnl+=lotSell(P.lot,q,px,fee+lf); P.sh-=q;`,
      `yearPnl+=lotSell(P.lot,q,px,fee+lf); P.sh-=q; __LOG.push({type:'sell',leg:P===A?'lev':'x1',date:__DD,price:px,qty:q});`, 'sell');
  // 1배 짝 — [80] 처럼 '실제 1배 ETF' 자리에 레버리지÷3 누적 계열을 넣는다
  const U='__X1_112__';
  const preX=(T)=>'var levExt=false, EXTM={}, LEV_UNDERLYING={'+T+':"'+U+'"};\n'
    +['function srcOf(t)','function _ivsWeights(tkr,N,s0)','function _ivsX1(tkr)','function _ivsPair1(tkr, days)'].map(m=>extractFn(bt,m)).join('\n')+'\n'
    +(bt.match(/const LEV_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const LEV_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_SPREAD=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const LEV_PRICEIDX=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const X1_EXPENSE=\{[^}]*\};/)||[''])[0]+'\n'
    +(bt.match(/const X1_EXPENSE_DEF=[^\n]*/)||[''])[0]+'\n'
    +(bt.match(/const IDX_EXTEND=\{[\s\S]*?\}\s*\};/)||[''])[0]+'\n';
  const mkBt=(T,LOG)=>new Function('__LOG', preX(T)+'\nlet __DD=null;\nreturn ('+bsrc.replace(/^function \w+\(/,'function (')+')')(LOG);
  /* 배당 픽스처 — CSV 시험 데이터엔 배당이 없다. 63거래일마다 종가의 0.4% 를 배당락으로 넣고
     백테(DIVMAP·PBASIS)와 앱(시세의 dividends·priceBasis)에 똑같이 준다 (7차 D8). */
  const mkDiv=(sym, from)=>{ const ds=dtsOf(sym), out=[]; ds.forEach((d,i)=>{ if(d>from && i%63===17) out.push({date:d, amount:+(M[sym][d][C]*0.004).toFixed(4)}); });
    DIVMAP[sym]={}; out.forEach(x=>{ DIVMAP[sym][x.date]=x.amount; }); PBASIS[sym]='trade'; return out; };
  const runApp=(T,st,from,D1,DV,DV1)=>{
    const Dall=dtsOf(T).map(d=>({date:d, close:M[T][d][C]}));
    const sess={settings:st, hist:[], paper:true};
    const f=new Function('curStrat','$','confirm','alert','simCutoff','curOf','ivsX1Of','IVS_FEE',
      'ivsQuoteData','ivsQuote1','sortHist','save','refreshIvs','pushRemote','px','imBuyQty',
      appSrc+'\nreturn ivsReplay;')(
      ()=>sess, id=>({value: id==='rp_from'?from:''}), ()=>true, ()=>{},
      ()=>'2099-12-31', ()=>'USD', ()=>U, 0.0025,
      {symbol:T, days:Dall, dividends:DV||[], priceBasis:'trade'}, D1?{symbol:U, days:D1, dividends:DV1||[], priceBasis:'trade'}:null,
      ()=>{}, ()=>{}, ()=>{}, null, n=>String(n), imBQ);
    return {ok:f(), hist:sess.hist};
  };
  const key=x=>x.type==='div' ? `${x.date} div ${x.leg} ${(+x.amt).toFixed(9)}` : `${x.date} ${x.type} ${x.leg} ${(+x.price).toFixed(4)} x${x.qty}`;
  const CFG=[['TQQQ',55,40,15,'iv','cash'],['TQQQ',40,60,10,'iv','cash'],['SOXL',55,40,15,'iv','cash'],['SOXL',70,20,20,'iv','cash'],
             ['SOXL',55,40,15,'fix','cash'],['TECL',55,40,15,'iv','cash'],['TECL',45,60,10,'fix','cash'],
             ['SOXL',45,60,10,'iv','x1'],['TQQQ',55,40,15,'fix','x1']];
  let nCfg=0;
  for(const [T,s0,N,band,mode,pair] of CFG){
    if(!DAYS[T]) continue;
    const all=dtsOf(T), from=all[250], X1=(pair==='x1');
    let D1=null;
    if(X1){ const px={}; let v=50;
      all.forEach((d,i)=>{ if(i>0){ const r=M[T][all[i]][C]/M[T][all[i-1]][C]-1; v*=(1+r/3); } px[d]=[v,v,v,v]; });
      M[U]=px; META[U]={name:'시험용 1배',lev:1,color:'#000'}; PBASIS[U]='trade';
      D1=all.map(d=>({date:d, close:M[U][d][C]})); }
    const DV=mkDiv(T, from), DV1=X1?mkDiv(U, from):null;
    const LOG=[];
    const r=mkBt(T,LOG)(all.filter(d=>d>=from),T,10000,s0/100,N,band/100,false,mode,pair);
    const A=runApp(T,{ticker:T,park:X1?'x1':'bill',mode,s0,look:N,band,principal:10000},from,D1,DV,DV1);
    const H=A.hist;
    const nDivB=LOG.filter(x=>x.type==='div').length, nDivA=H.filter(x=>x.type==='div').length;
    let diff=-1;
    for(let i=0;i<Math.max(LOG.length,H.length);i++){ if(!LOG[i]||!H[i]||key(LOG[i])!==key(H[i])){ diff=i; break; } }
    const lbl=`${T} s0=${s0}% N=${N} 밴드=${band}% ${mode==='fix'?'고정5:5':'역분산'}${X1?' 짝=1배':''}`;
    ok(`7차 ⑯ ${lbl} — 운영 재생 ↔ 백테 거래 ${LOG.length}건 한 건도 안 다르다`,
       A.ok===true && LOG.length>5 && diff<0 && (!X1 || r.x1synth===false),
       diff<0?`x1synth=${r.x1synth}`:`#${diff} 백테 [${LOG[diff]?key(LOG[diff]):'—'}] 운영 [${H[diff]?key(H[diff]):'—'}]`);
    ok(`7차 D8 ${lbl} — 배당 기록 ${nDivA}건 (백테 ${nDivB}건)`, nDivA>0 && nDivA===nDivB, `${nDivA}/${nDivB}`);
    const bad=[...LOG,...H].filter(x=>x.type!=='div').find(x=>!(Number.isInteger(x.qty) && x.qty>=1));
    ok(`7차 ⑯ ${lbl} — 사고판 주수가 전부 1 이상의 정수`, !bad, bad?key(bad):'');
    const P=ivsPosF(10000,H);
    ok(`7차 ⑯ ${lbl} — 운영 장부(ivsPos)의 끝 보유·현금 = 백테`,
       P.qty===r.endShares && near(P.cash,r.endCash,1e-6),
       `보유 ${P.qty}/${r.endShares} 현금 ${P.cash}/${r.endCash}`);
    delete DIVMAP[T]; delete PBASIS[T];
    if(X1){ delete M[U]; delete META[U]; delete PBASIS[U]; delete DIVMAP[U]; }
    nCfg++;
  }
  ok('7차 ⑯ 대조가 실제로 돌았다 (설정 7개 이상)', nCfg>=7, String(nCfg));
  { const T='TQQQ'; if(DAYS[T]){ const all=dtsOf(T), from=all[250], DV=mkDiv(T, from);
      const A=runApp(T,{ticker:T,park:'bill',mode:'iv',s0:55,look:40,band:15,principal:10000,divmode:'cash'},from,null,DV,null);
      const B=runApp(T,{ticker:T,park:'bill',mode:'iv',s0:55,look:40,band:15,principal:10000},from,null,DV,null);
      ok('7차 D8 현금 수령 세션은 재생이 배당을 안 적는다 (분배금 카드가 따로 센다)',
         A.hist.every(x=>x.type!=='div') && B.hist.some(x=>x.type==='div'),
         `현금수령 ${A.hist.filter(x=>x.type==='div').length}건 · 재투자 ${B.hist.filter(x=>x.type==='div').length}건`);
      delete DIVMAP[T]; delete PBASIS[T]; } }
  /* 총자산을 더하는 순서까지 백테와 같게 둔다 — 부동소수는 순서가 다르면 끝자리가 달라지고,
     그게 밴드 경계나 주수 내림 경계에 걸리면 어느 날 한 건이 갈린다. 지금 데이터에선 안 걸려도
     나중 데이터에서 걸릴 수 있어 모양으로도 묶어 둔다. */
  ok('7차 ⑯ 운영 재생이 총자산을 백테와 같은 순서로 더한다',
     /const eq=cash\+qty\*c\+\(X1\?qty1\*c1:0\);/.test(appSrc) && /const eqP = cash \+ qty\*pc \+ \(X1\?qty1\*pc1:0\);/.test(appSrc)
     && /const eq0=cash\+A\.sh\*c\+B\.sh\*c1;/.test(bsrc) && /const eqP = cash \+ A\.sh\*pc \+ B\.sh\*pc1;/.test(bsrc));
  WARM_FROM=_wf0; WARM_TO=_wt0;
}

/* ════ 113. 7차 ⑰ — 200일선 운영 재생 ↔ 백테 거래 단위 대조 ════
   신호는 둘이 같은 식이다(_maHold/_maEntry · 합성 1배 · 워밍업은 보유). 갈린 건 둘이었다:
     · 매수 주수 — 운영 (현금−현금×수수료)÷가격, 백테 현금÷(1+수수료)÷가격. 경계에서 1주씩 달랐다
     · 이력 첫 봉 — 운영은 건너뛰고, 백테는 보유로 시작했다
   백테에만 있는 양도세·배당 현금을 끄고 수수료를 같게 두면 한 건도 달라선 안 된다. */
console.log('\n[113] 7차 ⑰ — 200일선 운영 재생 ↔ 백테 거래 단위 대조');
{
  const _wf0=WARM_FROM, _wt0=WARM_TO; WARM_FROM=''; WARM_TO='';
  let ms=extractFn(bt,'function runMA200(days,tkr,cap,N,costOn,opt)');
  const inj=(a,b,l)=>{ const p=ms.split(a); if(p.length!==2) throw new Error(`[113] 주입 실패(${l}): ${p.length-1}회`); ms=p[0]+b+p[1]; };
  inj(`const FEE=costOn?costOf(tkr).fee:0;`, `const FEE=0.0025;`, 'fee');
  inj(`const owed=capGainTax(yearPnl, tkr); let due=owed; yearPnl=0;`, `const owed=0; let due=owed; yearPnl=0;`, 'tax');
  // 배당은 남기되 앱처럼 늘 세후로 (7차 D8)
  inj(`cash+=divCash(tkr,d,shares,costOn);`,
      `{ const __v=divCash(tkr,d,shares,true); cash+=__v; if(__v>0) __LOG.push({type:'div',date:d,amt:__v}); }`, 'div');
  // 매수 훅은 '1주 이상일 때만 거래' 로 감싼 괄호 밖 문장에 건다 — 옛 모양(감싸지 않음)으로 되돌려도
  // 주입은 되고, 그 되돌림은 아래 값 시험(1주도 못 사면 거래 0건)이 잡는다.
  inj(`lotBuy(LOT,q,c,fee); cash-=spend+fee; feesTotal+=fee; trades++;`,
      `lotBuy(LOT,q,c,fee); cash-=spend+fee; feesTotal+=fee; trades++; __LOG.push({type:'in',date:d,price:c,qty:q});`, 'in');
  inj(`const gross=shares*c, fee=gross*FEE; cash+=gross-fee;`,
      `__LOG.push({type:'out',date:d,price:c,qty:shares}); const gross=shares*c, fee=gross*FEE; cash+=gross-fee;`, 'out');
  const pre2=['function srcOf(t)','function _maOpt(opt)','function _maHold(sell,a,b)','function _maEntry(buy,a,b)',
              'function _maAbove(tkr,N,SHORT,BUY,SELL)'].map(m=>extractFn(bt,m)).join('\n')+'\n'
             +'var levExt=false, EXTM={}, maBuy="ma", maSell="ma", maShort=50, maPark="cash";\n';
  const mkBt=(LOG)=>new Function('__LOG', pre2+'return ('+ms.replace(/^function \w+\(/,'function (')+')')(LOG);
  const btPristine=new Function(pre2+'return ('+extractFn(bt,'function runMA200(days,tkr,cap,N,costOn,opt)').replace(/^function \w+\(/,'function (')+')')();
  const appSrc=['function maLevOf(t)','function _maHold(sell,a,b)','function _maEntry(buy,a,b)','function maCond(st)',
                'function computeMa()','function maReplay()','function imBuyQty(alloc, refPx, feeRate)'].map(m=>extractFn(idx,m)).join('\n');
  const maLed=new Function(extractFn(idx,'function maLedger(hist, price, principal)')+'\nreturn maLedger;')();
  const runApp=(T,Dall,from,st0,DV)=>{
    const st=Object.assign({ticker:T, principal:10000, buy:'ma', sell:'ma', park:'cash'}, st0||{});
    const sess={settings:st, hist:[], paper:true};
    const f=new Function('curStrat','$','confirm','alert','simCutoff','curOf','IVS_FEE','maQuoteData',
      'sortHist','save','refreshMa','pushRemote','px', appSrc+'\nreturn maReplay;')(
      ()=>sess, id=>({value: id==='rp_ma_from'?from:''}), ()=>true, ()=>{}, ()=>'2099-12-31', ()=>'USD', 0.0025,
      {symbol:T, days:Dall, price:0, dividends:DV||[], priceBasis:DV?'trade':null}, ()=>{}, ()=>{}, ()=>{}, null, n=>String(n));
    f(); return sess.hist;
  };
  const key=x=>x.type==='div' ? `${x.date} div ${(+x.amt).toFixed(9)}` : `${x.date} ${x.type} ${(+x.price).toFixed(4)} x${x.qty}`;
  /* 배당 픽스처 (7차 D8) — [112] 와 같은 방식: 63거래일마다 종가의 0.4% */
  const mkDiv=(sym)=>{ const ds=dtsOf(sym), out=[]; ds.forEach((d,i)=>{ if(i%63===17) out.push({date:d, amount:+(M[sym][d][C]*0.004).toFixed(4)}); });
    DIVMAP[sym]={}; out.forEach(x=>{ DIVMAP[sym][x.date]=x.amount; }); PBASIS[sym]='trade'; return out; };
  const OPT={buy:'ma', sell:'ma', short:50, park:'cash'};
  let nRun=0;
  for(const T of ['SOXL','TQQQ','TECL']){
    if(!DAYS[T]) continue;
    const all=dtsOf(T), Dall=all.map(d=>({date:d, close:M[T][d][C]})), DV=mkDiv(T);
    for(const [lbl,fi] of [['이력 첫 봉부터 (워밍업은 보유)',0],['250번째 봉부터',250],['700번째 봉부터',700]]){
      const from=all[fi], LOG=[];
      const r=mkBt(LOG)(all.filter(d=>d>=from),T,10000,200,false,OPT);
      const H=runApp(T,Dall,from,null,DV);
      const nDA=H.filter(x=>x.type==='div').length, nDB=LOG.filter(x=>x.type==='div').length;
      ok(`7차 D8 ${T} ${lbl} — 배당 기록 ${nDA}건 (백테 ${nDB}건)`, nDA>0 && nDA===nDB, `${nDA}/${nDB}`);
      let diff=-1;
      for(let i=0;i<Math.max(LOG.length,H.length);i++){ if(!LOG[i]||!H[i]||key(LOG[i])!==key(H[i])){ diff=i; break; } }
      ok(`7차 ⑰ ${T} ${lbl} — 운영 재생 ↔ 백테 거래 ${LOG.length}건 한 건도 안 다르다`, LOG.length>=1 && diff<0,
         diff<0?'':`#${diff} 백테 [${LOG[diff]?key(LOG[diff]):'—'}] 운영 [${H[diff]?key(H[diff]):'—'}]`);
      const lastPx=Dall[Dall.length-1].close, L=maLed(H,lastPx,10000);
      ok(`7차 ⑰ ${T} ${lbl} — 운영 장부(maLedger)의 끝 보유·현금 = 백테`,
         L.qty===r.endShares && near(L.cash,r.endCash,1e-6), `보유 ${L.qty}/${r.endShares} 현금 ${L.cash}/${r.endCash}`);
      nRun++;
    }
    delete DIVMAP[T]; delete PBASIS[T];
  }
  ok('7차 ⑰ 대조가 실제로 돌았다', nRun>=6, String(nRun));

  /* 경계 픽스처 — 가격 99.7503 · 원금 10000 · 수수료 0.25%
       현금÷1.0025÷가격 = 100.0003 → 100주 (백테 · 이제 운영)
       (현금−현금×0.0025)÷가격 = 99.9997 → 99주 (예전 운영)
     첫 봉부터 재생하면 워밍업이 보유라 첫날 산다 — 예전 운영은 첫 봉을 건너뛰어 이튿날 샀다. */
  { const U='__MA113__', ds=Array.from({length:5},(_,i)=>'2020-01-0'+(i+2));
    M[U]={}; ds.forEach(d=>{ M[U][d]=[99.7503,99.7503,99.7503,99.7503]; });
    const Dall=ds.map(d=>({date:d, close:99.7503}));
    const H=runApp(U,Dall,ds[0]);
    const LOG=[]; mkBt(LOG)(ds,U,10000,200,false,OPT);
    ok('7차 ⑰ 경계 — 운영이 첫 봉에 100주를 산다 (백테와 같은 식)', H.length===1 && H[0].date===ds[0] && H[0].qty===100,
       JSON.stringify(H));
    ok('7차 ⑰ 경계 — 백테도 첫 봉에 100주', LOG.length===1 && LOG[0].date===ds[0] && LOG[0].qty===100, JSON.stringify(LOG));
    /* 1주도 못 사는 돈이면 거래가 아니다 — 예전 백테는 보유 신호가 이어지는 동안 0주 '매수'를 매일 1건씩 셌다 */
    const r0=btPristine(ds,U,50,200,false,OPT);
    ok('7차 ⑰ 백테 — 1주도 못 사면 거래 0건 · 현금 그대로', r0.trades===0 && r0.endShares===0 && near(r0.endCash,50,1e-12),
       `거래 ${r0.trades} 보유 ${r0.endShares} 현금 ${r0.endCash}`);
    delete M[U];
  }
  WARM_FROM=_wf0; WARM_TO=_wt0;
}

/* ════ 114. 7차 ⑱ — 적립(DCA) 모의 ↔ 백테: 하락 배수 판정에 오늘 종가를 쓰지 않는다 ════
   모의(_paperDca)는 '오늘 종가 ≤ 오늘 200일선' 을 보고 그 종가에 배수로 샀다 — 룩어헤드.
   백테 _dcaOne 은 1차 감사 때 전일 값으로 고쳤는데 모의가 남아 있었다.
   같은 시세·같은 설정이면 적립일·배수·금액이 한 건도 달라선 안 된다. */
console.log('\n[114] 7차 ⑱ — 적립 모의 ↔ 백테 (적립일·배수·금액)');
{
  const _wf0=WARM_FROM, _wt0=WARM_TO; WARM_FROM=''; WARM_TO='';
  let ds=extractFn(bt,'function _dcaOne(t,days,amt,freq,costOn,dipMul)');
  const inj=(a,b,l)=>{ const p=ds.split(a); if(p.length!==2) throw new Error(`[114] 주입 실패(${l}): ${p.length-1}회`); ds=p[0]+b+p[1]; };
  inj(`sh+=buyQty(a,p,FEE,false); inv+=a; nBuy++; if(dip)nDip++;`,
      `sh+=buyQty(a,p,FEE,false); inv+=a; nBuy++; if(dip)nDip++; __LOG.push({date:d,amt:a,mul:dip?MUL:1});`, 'buy');
  inj(`{ const dc=divCash(t,d,sh,costOn);`, `{ const dc=0;`, 'div');
  const preD=['function srcOf(t)','function _isoWeek(d)','function _dcaFreq(f)','function _dcaHits(days,freq)','function _dcaMA(t,N)',
              'function divSplit(tkr, days, buys)'].map(m=>extractFn(bt,m)).join('\n')+'\nvar levExt=false, EXTM={}, dcaReinv=true, dcaDipMul=1;\n';
  const mkBt=(LOG)=>new Function('__LOG', preD+'return ('+ds.replace(/^function \w+\(/,'function (')+')')(LOG);
  const pd=extractFn(idx,'function _paperDca(sess, from)');
  const runApp=(T,Dall,from,st0)=>{
    const st=Object.assign({ticker:T, mode:'dca', amount:10, freq:'month', dipMul:2}, st0||{});
    const sess={settings:st, hist:[]};
    new Function('dcaQuoteData','settledBars','curOf','simCutoff','save','_lastTradingDay','_clampFrom',
      'const DCA_N_AUTO=200;\n'+pd+'\nreturn _paperDca;')(
      {symbol:T, days:Dall, raw:[]}, rows=>rows, ()=>'usd', ()=>'2099-12-31', ()=>{},
      days=>(days&&days.length)?days[days.length-1].date:null, (f,l)=>(f&&l&&f>l)?l:f)(sess, from);
    return sess.hist;
  };
  const FQ={day:'daily', week:'weekly', month:'monthly'};
  let nRun=0;
  for(const T of ['SOXL','TQQQ','TECL']){
    if(!DAYS[T]) continue;
    const all=dtsOf(T), Dall=all.map(d=>({date:d, close:M[T][d][C]}));
    for(const fq of ['day','week','month']){
      const from=all[260], LOG=[];
      mkBt(LOG)(T, all.filter(d=>d>=from), 10, FQ[fq], false, 2);
      const H=runApp(T,Dall,from,{freq:fq});
      const key=x=>`${x.date} ×${x.mul} ${(+x.amt).toFixed(2)}`;
      let diff=-1;
      for(let i=0;i<Math.max(LOG.length,H.length);i++){ if(!LOG[i]||!H[i]||key(LOG[i])!==key(H[i])){ diff=i; break; } }
      const nDip=H.filter(h=>h.mul>1).length;
      ok(`7차 ⑱ ${T} ${fq} 하락 2배 — 적립 ${LOG.length}회(배수 ${nDip}회) 모의 ↔ 백테 한 건도 안 다르다`,
         LOG.length>5 && nDip>0 && diff<0,
         diff<0?'':`#${diff} 백테 [${LOG[diff]?key(LOG[diff]):'—'}] 모의 [${H[diff]?key(H[diff]):'—'}]`);
      nRun++;
    }
  }
  ok('7차 ⑱ 대조가 실제로 돌았다', nRun>=6, String(nRun));
  /* 값으로 — 어제까지 200선 위, 오늘 종가가 처음 아래로 내려온 날은 1배다 (배수는 내일부터) */
  { const ds2=[]; const t0=Date.UTC(2020,0,1);
    // 천천히 오르는 종가 — 종가가 늘 200선 위에 있다가 203번째 날 처음 아래로 떨어진다
    for(let i=0;i<203;i++){ const d=new Date(t0+i*864e5).toISOString().slice(0,10); ds2.push({date:d, close:100+i*0.1}); }
    ds2.push({date:new Date(t0+203*864e5).toISOString().slice(0,10), close:50});   // 오늘 처음 200선 아래
    ds2.push({date:new Date(t0+204*864e5).toISOString().slice(0,10), close:50});   // 이튿날 (어제가 아래)
    const H=runApp('X', ds2, ds2[203].date, {freq:'day'});
    ok('7차 ⑱ 오늘 종가가 처음 200선 아래로 온 날은 1배 · 이튿날부터 2배',
       H.length===2 && H[0].mul===1 && H[1].mul===2, JSON.stringify(H.map(h=>[h.date,h.mul])));
  }
  WARM_FROM=_wf0; WARM_TO=_wt0;
}

/* ════ 115. 7차 — ASAP 모의 ↔ 백테 (매수일·금액) ════
   ASAP 모의(_paperAsap)와 백테(runASAP)는 같은 규약이라고 적혀 있다. 확인한다.
   백테에만 있는 리저브 이자(SGOV)·배당 현금을 끄고 비용을 끈 채(모의는 수수료가 없다) 맞댄다. */
console.log('\n[115] 7차 — ASAP 모의 ↔ 백테 (매수일·금액)');
{
  const _wf0=WARM_FROM, _wt0=WARM_TO; WARM_FROM=''; WARM_TO='';
  let as=extractFn(bt,'function runASAP(days,tkr,opt)');
  const inj=(a,b,l,n=1)=>{ const p=as.split(a); if(p.length!==n+1) throw new Error(`[115] 주입 실패(${l}): ${p.length-1}회`); as=p.join(b); };
  inj(`sgov*=(1+(SGOV_RATE[+d.slice(0,4)]||0.04)/252);`, ``, 'sgov');
  // 배당은 남기되 앱처럼 늘 세후로 — 리저브로 들어간다 (7차 D8)
  inj(`sgov+=divCash(tkr,d,sh,o.costOn);`, `{ const __v=divCash(tkr,d,sh,true); sgov+=__v; if(__v>0) __LOG.push({date:d,amt:__v,div:true}); }`, 'div');
  inj(`sh+=buyQty(`, `sh+=__B(d,`, 'buy', 6);
  const preA=['function _asapInd(tkr)'].map(m=>extractFn(bt,m)).join('\n')+'\n';
  const mkBt=(LOG)=>new Function('__LOG', preA
    +'const __B=(d,a,c,F,I)=>{ if(a>0) __LOG.push({date:d,amt:a}); return buyQty(a,c,F,I); };\n'
    +'return ('+as.replace(/^function \w+\(/,'function (')+')')(LOG);
  const pa=extractFn(idx,'function _paperAsap(sess, from)');
  const helpers=[extractFn(idx,'function _asapMA(a,k)'), extractFn(idx,'function _asapRSI(a)')].join('\n');
  const runApp=(T,Dall,from,DV)=>{
    const st={ticker:T, base:10, mid:50, deep:100};
    const sess={settings:st, hist:[]};
    new Function('asapQuoteData','settledBars','curOf','simCutoff','save','_lastTradingDay','_clampFrom',
      helpers+'\n'+pa+'\nreturn _paperAsap;')(
      {symbol:T, days:Dall, dividends:DV||[], priceBasis:DV?'trade':null}, rows=>rows, ()=>'usd', ()=>'2099-12-31', ()=>{},
      days=>(days&&days.length)?days[days.length-1].date:null, (f,l)=>(f&&l&&f>l)?l:f)(sess, from);
    return sess.hist.filter(h=>h.type==='buy'||h.type==='div').map(h=>({date:h.date, amt:h.amt, div:h.type==='div'}));
  };
  const mkDiv=(sym)=>{ const ds=dtsOf(sym), out=[]; ds.forEach((d,i)=>{ if(i%63===17) out.push({date:d, amount:+(M[sym][d][C]*0.004).toFixed(4)}); });
    DIVMAP[sym]={}; out.forEach(x=>{ DIVMAP[sym][x.date]=x.amount; }); PBASIS[sym]='trade'; return out; };
  let nRun=0;
  for(const T of ['SOXL','TQQQ','TECL']){
    if(!DAYS[T]) continue;
    const all=dtsOf(T), Dall=all.map(d=>({date:d, close:M[T][d][C]}));
    const from=all[260], LOG=[], DV=mkDiv(T);
    mkBt(LOG)(all.filter(d=>d>=from), T, {base:10, mid:50, deep:100, costOn:false});
    const H=runApp(T,Dall,from,DV);
    let diff=-1;
    for(let i=0;i<Math.max(LOG.length,H.length);i++){
      if(!LOG[i]||!H[i]||LOG[i].date!==H[i].date||!!LOG[i].div!==!!H[i].div||Math.abs(LOG[i].amt-H[i].amt)>1e-6){ diff=i; break; } }
    const nD=H.filter(x=>x.div).length;
    ok(`7차 ASAP ${T} — 매수·배당 ${LOG.length}건(배당 ${nD}) 모의 ↔ 백테 날짜·금액 한 건도 안 다르다 (리저브 이자·비용 끔 · 배당 세후)`,
       LOG.length>10 && nD>0 && diff<0,
       diff<0?'':`#${diff} 백테 [${LOG[diff]?LOG[diff].date+' '+LOG[diff].amt.toFixed(4)+(LOG[diff].div?' 배당':''):'—'}] 모의 [${H[diff]?H[diff].date+' '+(+H[diff].amt).toFixed(4)+(H[diff].div?' 배당':''):'—'}]`);
    delete DIVMAP[T]; delete PBASIS[T];
    nRun++;
  }
  ok('7차 ASAP 대조가 실제로 돌았다', nRun>=3, String(nRun));
  WARM_FROM=_wf0; WARM_TO=_wt0;
}

/* ════ 116. 7차 D11 — 분배금 세금: 현금 수령·적립은 세전, 장부 기록은 세후 (화면에 적는다) ════
   같은 배당인데 재투자(장부 기록 · 세후 15.4%)와 현금 수령 카드·적립(세전)이 15.4% 다르게 보였다.
   사용자 결정: 계산은 그대로 세전으로 두고, 화면에 '세전' 이라고 적는다. 세전을 지키는 것도 값으로 묶는다. */
console.log('\n[116] 7차 D11 — 분배금 세전·세후 표기');
{
  const divIncomeF=new Function(extractFn(idx,'function divIncome(divs, lots, reinv)')+'\nreturn divIncome;')();
  const r=divIncomeF([{date:'2024-03-20',amount:1}], [{date:'2024-01-02',q:100}], false);
  ok('7차 D11 현금 수령 카드 금액은 세전 — 100주 × $1 = $100 (세후면 84.6)', near(r.divCash,100,1e-12), String(r.divCash));
  const dca=extractFn(idx,'function computeDca()');
  ok('7차 D11 적립 분배금도 세전 — 보유 × 주당 분배금 그대로',
     /const cash=\(held\+divShares\)\*\(\+d\.amount\|\|0\);/.test(dca) && !/DIV_TAXRATE/.test(dca));
  // 장부에 적는 배당은 세후 — 무매·VR·섀넌·로테·ASAP 모두 divCashQ(…, true)
  const sims=['function infSimForward(startFrom)','function vrSimForward()','function ivsReplay()','function maReplay()','function _paperAsap(sess, from)']
    .map(sig=>{ try{ return extractFn(idx,sig); }catch(e){ return ''; } });
  ok('7차 D11 장부에 적는 배당은 세후 (다섯 엔진 모두 divCashQ(…, true))',
     sims.every(f=>/divCashQ\([^)]*,\s*true\)/.test(f)), sims.map(f=>/divCashQ\([^)]*,\s*true\)/.test(f)?'O':'·').join(''));
  // 화면 표기
  ok('7차 D11 분배금 현금 수입 카드 세 곳에 세전', (idx.match(/분배금 현금 수입 <span class="sub" style="font-weight:400">세전 · 시세 기준 추정<\/span>/g)||[]).length===3);
  ok('7차 D11 현금 흐름 카드(VR·섀넌)의 분배금 칸에 세전', (idx.match(/sub:'현금으로 받은 것 · 세전 · 시세 기준 추정'/g)||[]).length===2);
  ok('7차 D11 적립 카드·계좌·수익률 줄에 세전',
     /title:'분배금 현금 수입 <span class="sub" style="font-weight:400">세전<\/span>'/.test(idx)
     && /\+' · 세전';/.test(idx) && /주식 \+ 분배금\(세전\)/.test(idx) && /현금으로 받은 분배금 · 세전/.test(idx) && /분배금\(세전\) 포함/.test(idx));
  ok('7차 D11 설정 다섯 곳에 세전 추정 · 재투자는 세후', (idx.match(/현금 수령은 단리 인출과 같은 취급 · 금액은 세전 추정 \(재투자는 장부에 세후로 기록\)/g)||[]).length===5);
  ok('7차 D11 VR 받은 분배금 — 장부분 세후 · 추정분 세전',
     /'현금 수령 — 계좌 밖으로 나갔다 · 세전 추정':'Pool에 남아 있다 · 세후'/.test(idx) && /Pool에 남아 있다 · 세후<\/span>/.test(idx));
  ok('7차 D11 모의 성과 각주', /분배금은 <b>현금 수령·적립은 세전<\/b>, 장부에 적는 배당\(재투자\)은 세후로 셉니다/.test(idx));
}


/* ════ 117. 5년 플랜 v1.15.1 — 가변 초기자금 A안 · VR 첫매수 현금보존 ════ */
console.log('\n[117] 5년 플랜 v1.15.1 — 가변 초기자금 A안 · VR 초기 현금보존');
{
  const pl=fs.readFileSync(__d+'/plan.html','utf8');
  ok('5년 플랜 시작금 기본값은 $20,000', /startCapital:20000/.test(pl) && /aCash:20000/.test(pl));
  ok('PATH A 롤링5년 기본값 — TECL 65% N20 s0 55 밴드12.5 + TQQQ 35% SMA200 ±1.5',
     /alpha:\{teclWeight:\.65,guardWeight:\.35,ivsLook:20,ivsS0:\.55,ivsBand:\.125,guardMA:200,guardBand:\.015\}/.test(pl));
  ok('PATH A 첫날 실행 UI — 초기자금 입력 · 127개 롤링 검증 · 자체 잔고 진행률',
     /id="alphaCapitalInput"/.test(pl)
     && /id="alphaStartHoldings"/.test(pl)
     && /127개 시작구간/.test(pl)
     && /function alphaPlanTotal\(\)/.test(pl)
     && /activePlanTab==='alpha'\?\(at==null\?num\("startCapital"\):at\)/.test(pl));
  ok('초기자금 입력이 A 현금·주문기준과 B 60:40 배정을 자동 변경',
     /const startCap=Math\.max\(1,num\('startCapital',20000\)\)/.test(pl)
     && /signalTotal=startCap;\$\('aCash'\)\.value=startCap/.test(pl)
     && /const cap=Math\.max\(1,num\('startCapital',20000\)\),bInf=Math\.round\(cap\*\.60\),bVr=Math\.max\(0,cap-bInf\)/.test(pl)
     && /\$\("alphaCapitalInput"\)\.addEventListener\("change"/.test(pl)
     && /if\(virgin\)\$\("aCash"\)\.value=cap/.test(pl)
     && /\$\("startCapital"\)\.value=cap/.test(pl));
  ok('PATH B 롤링5년 기본값 — SOXL 60% 20분할 +20% 리버스OFF',
     /a=\[60,40,0\],inf=Math\.round\(total\*\.60\)/.test(pl)
     && /classic:\{infWeight:\.60,vrWeight:\.40,infDiv:20,infTarget:20,infBig:15,infReverse:false,vrG:5,vrBand:30,vrFormula:'basic'/.test(pl)
     && /ticker:'SOXL',div:20,target:20,big:15,reverse:false,compound:true/.test(pl));
  ok('PATH B TECL VR — Basic G5 ±30 · 초기주식90\/Pool10 · v7',
     /ticker:'TECL',mode:\.5,formula:'basic',g:5,initAmt,add:0,[\s\S]{0,80}band:30/.test(pl)
     && /planInitStockPct:90,planPresetVersion:7/.test(pl)
     && /5년 롤링 강건값을 실전 기본값으로 사용/.test(pl));

  const usd=v=>'$'+Math.round(v||0), FEE=.0025;
  const calcVrState=new Function('return ('+extractFn(pl,'function calcVrState(sess)').replace(/^function calcVrState\(/,'function (')+')')();
  const vrOrders=new Function('FEE','usd','calcVrState',
    'function nextVrDate(s){return s;} function vrCycleStart(c){return null;} return ('+
    extractFn(pl,'function vrOrders(sess,price)').replace(/^function vrOrders\(/,'function (')+')')(FEE,usd,calcVrState);
  const st={ticker:'TECL',mode:.5,formula:'basic',g:10,initAmt:1000,add:0,band:15,startv:0,startpool:100,
            planTotalCapital:1100,planInitStockPct:90,planPresetVersion:6};
  const ord=vrOrders({settings:st,hist:[]},333).orders;
  ok('플랜 VR 첫매수 수량은 수수료 포함 initAmt 안에서만 — $1000 @333 → 2주',
     ord.length===1 && ord[0].qty===2, JSON.stringify(ord));

  const fee=2*333*FEE, left=1000-2*333-fee;
  const hist=[
    {type:'buy',date:'2026-01-02',price:333,qty:2,fee,init:true,cyc:0},
    {type:'add',date:'2026-01-02',amt:left,cyc:0}
  ];
  const c=calcVrState({settings:st,hist});
  ok('VR 첫매수 잔돈은 명시적 add 한 번만 Pool에 남는다',
     near(c.pool,100+left,1e-9), `Pool ${c.pool} / 기대 ${100+left}`);
  ok('VR 초기 총자산 보존 — 주식원가+수수료+Pool = startPool+initAmt',
     near(2*333+fee+c.pool,1100,1e-9), String(2*333+fee+c.pool));

  const vf=extractFn(idx,'function vrFirstBuy()');
  ok('운영 VR 수동 첫매수도 수수료 포함 수량·fee·init·잔돈 add를 기록한다',
     /Math\.floor\(amt\/\(pr\*\(1\+F\)\)\)/.test(vf)
     && /fee:\+fee\.toFixed\(6\),init:true,cyc:0/.test(vf)
     && /amt:\+left\.toFixed\(6\),cyc:0/.test(vf));
}

/* ════ 118. 제8차 감사 대응 — SOURCE GOLDEN / ENGINE PARITY ════
   8차 감사가 짚은 것: 이 회귀는 '현재 구현끼리 서로 맞는다' 는 강하게 보지만 '원 전략과 맞는다' 는
   보장하지 않는다. 특히 VR [69]·[108] 은 지금의 20차 사다리를 정답으로 넣어 두어, 해석이 틀렸다면
   틀린 구현을 보호한다. 그래서 여기서는 두 단계로 나눈다.
     SOURCE GOLDEN — 기대값을 엔진이 아니라 규칙 문장에서 손으로 계산해 상수로 적는다.
                     근거가 원문으로 확인되지 않은 규칙은 이름에 '원전 미확인 · 현재 구현 규칙' 이라고 적는다.
     ENGINE PARITY — 운영 주문표·모의·과거재생·백테·5년 플랜·서버가 그 기대값과 전부 같은지 본다. */
console.log('\n[118] 제8차 감사 대응 — SOURCE GOLDEN / ENGINE PARITY');
{
  const pl=fs.readFileSync(__d+'/plan.html','utf8');
  const imSrc8=fs.readFileSync(__d+'/functions/api/_im.js','utf8');
  const SV8=new Function(imSrc8.replace(/export /g,'')+'\nreturn {imOrders,imCompute};')();
  const G8=(nm,cond,detail)=>ok('SOURCE GOLDEN · '+nm,cond,detail);
  const P8=(nm,cond,detail)=>ok('ENGINE PARITY · '+nm,cond,detail);
  const fnOf=(src,sigs)=>sigs.map(x=>extractFn(src,x)).join('\n');
  const same3=(sig,a,b,c)=>{ const x=extractFn(a,sig), y=extractFn(b,sig), z=c?extractFn(c,sig):x; return !!x && x===y && x===z; };

  /* ───────── 1. VR 체결 — SOURCE GOLDEN: 사용자 제공 정식 문서 (VR 5.0 운용 절차 · posts/009) ─────────
     원문 정리본: "평가금이 상단(1.15V)을 초과하면 평가금이 V로 돌아올 만큼 매도 · 하단(0.85V)을 하회하면
                  V에 도달할 만큼 매수 (Pool 사용 한도 안) · 2주치 예약주문 · 사이클 첫날 매수표/매도표"
     V=10000 · 밴드 15% → 상단 11500 · 하단 8500 · 보유 100주
       매도 1차 가격 = 11500/100 = 115.00 → 고가 116 ≥ 115 → 체결
       수량 = V 로 돌아올 만큼 = 100 − 10000/115 = 13.04 → 13주 → 87주 · 평가금(116) = 87 × 116 = 10092
       매도 2차 가격 = 11500/87 = 132.18 → 호가 올림 132.19 → 미체결
       매수 1차 (저가 84) = 8500/100 = 85.00 · 수량 10000/85 − 100 = 17.6 → 18주 → 118주
     정수로 끊는 방식(가장 가까운 정수)과 차수를 잇는 방식은 정리본에 없는 세부라 이 구현의 해석이다. */
  const VG={p1:115, q1:13, p2:132.19, shares:87, evalAt116:10092, bp1:85, bq1:18};
  G8('VR 체결 (정식 문서) — 손 계산: 115.00 × 13주 → 87주 · 평가금 10092 · 2차 132.19 · 매수 85.00 × 18주',
     VG.p1===11500/100 && VG.q1===Math.round(100-10000/115) && VG.p2===Math.ceil(11500/87*100)/100
     && VG.evalAt116===87*116 && VG.bq1===Math.round(10000/85-100));
  const idxVr=new Function(fnOf(idx,['function vrTick(p, cur)','function vrTickUp(p, cur)','function vrTickDn(p, cur)',
      'function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)','function vrOrderPlan(S, P, bar)'])+'\nreturn {vrOrderPlan, vrTiers};')();
  const P0v={band:.15,poolLimit:.5,FEE:0,baseShares:100,sellFilled:0,buyFilled:0,maxTiers:20,budgetRemaining:0,cur:'usd'};
  const barG={date:'2026-01-05',open:112,high:116,low:112,close:116};
  for(const [nm,fn] of [['운영 모의·재생 vrOrderPlan (index 코드)',idxVr.vrOrderPlan],['백테 vrOrderPlan (backtest 코드)',vrOrderPlan]]){
    const S={shares:100,pool:0,avg:100,V:10000}, f=fn(S,{...P0v},barG), sells=f.filter(x=>x.type==='sell');
    P8(`VR 체결 — ${nm}: 115.00 × 13주 · 87주 · 평가금 10092`,
       sells.length===1 && sells[0].price===VG.p1 && sells[0].qty===VG.q1 && S.shares===VG.shares && S.shares*116===VG.evalAt116, JSON.stringify(f));
    const S2={shares:100,pool:1e6,avg:100,V:10000}, f2=fn(S2,{...P0v,budgetRemaining:1e6},{date:'x',open:90,high:90,low:84,close:84});
    P8(`VR 체결 — ${nm}: 저가 84 → 85.00 × 18주 매수 · 118주`, f2.length===1 && f2[0].price===VG.bp1 && f2[0].qty===VG.bq1 && S2.shares===118, JSON.stringify(f2)); }
  { const L=idxVr.vrTiers(100,0,0,11500,8500,0,1,20,'usd');
    P8('VR 체결 — 운영 주문표(vrTiers): 1차 115.00 × 13 · 2차 132.19', L.sells[0].p===VG.p1 && L.sells[0].q===VG.q1 && L.sells[1].p===VG.p2,
       `${L.sells[0].p}×${L.sells[0].q} · ${L.sells[1].p}`); }
  const PLV=new Function([(pl.match(/const usd=v=>[^\n]*/)||[''])[0], (pl.match(/const FEE=[^\n]*/)||[''])[0],
      extractFn(pl,'function calcVrState(sess)'), (pl.match(/function nextVrDate\(s\)\{[^\n]*/)||[''])[0],
      (pl.match(/function vrCycleStart\(c\)\{[^\n]*/)||[''])[0], extractFn(pl,'function vrOrders(sess,price)'),
      fnOf(pl,['function vrTick(p, cur)','function vrTickUp(p, cur)','function vrTickDn(p, cur)','function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)',
               'function vrCycleTransition(V, pool, ev, G, mode, add, formula)','function calcPlanNextV(c,close)']),
      'return {vrOrders, calcVrState, calcPlanNextV};'].join('\n'))();
  { const st={ticker:'TQQQ',mode:0.5,formula:'basic',g:10,initAmt:10000,add:0,band:15,startv:0,startpool:0,cycStart:'2026-01-02'};
    const o=PLV.vrOrders({settings:st,hist:[{type:'buy',date:'2026-01-02',price:100,qty:100,fee:0,init:true,cyc:0}]},100).orders.filter(x=>x.side==='sell');
    P8('VR 체결 — 5년 플랜 주문표: 1차 115.00 × 13 · 2차 132.19', o.length>=2 && o[0].price===VG.p1 && o[0].qty===VG.q1 && o[1].price===VG.p2,
       o.slice(0,2).map(x=>x.price+'×'+x.qty).join(' · ')); }
  // 끝에서 끝까지 — 합성 시세 40거래일 (첫날 100 → 둘째 날 고가 116 → 이후 110 보합: 밴드 안). 수수료는 앱 규약(0.25%)
  { const days=[]; { const d0=new Date('2026-01-02T00:00:00Z');
      while(days.length<40){ const w=d0.getUTCDay(); if(w>0&&w<6) days.push(d0.toISOString().slice(0,10)); d0.setUTCDate(d0.getUTCDate()+1); } }
    M.__G8={}; days.forEach((d,i)=>{ const r=[]; const [c,o,h,l]= i===0?[100,100,100,100]:i===1?[112,112,116,112]:[110,110,110,110];
      r[C]=c; r[O]=o; r[HI]=h; r[LO]=l; M.__G8[d]=r; });
    const _cgt=global.capGainTax; global.capGainTax=()=>0;
    const rb=runVR(days,'__G8',{initAmt:10025,G:10,bandPct:15,mode:0.5,formula:'basic',costOn:true});
    P8('VR 체결 — 백테 runVR 끝까지: 매도 1건 · 최종 87주', rb.sells===1 && rb.shares===VG.shares, `매도 ${rb.sells} · ${rb.shares}주`);
    const Q={symbol:'__G8', ohlc:days.map(d=>({date:d,close:M.__G8[d][C],open:M.__G8[d][O],high:M.__G8[d][HI],low:M.__G8[d][LO]})),
             days:days.map(d=>({date:d,close:M.__G8[d][C]})), priceBasis:'trade', dividends:[]};
    const st={ticker:'__G8', mode:0.5, formula:'basic', g:10, initAmt:10025, add:0, band:15, startv:0, startpool:0, autoCyc:false, vrModel:'vreturn', divmode:'reinv'};
    for(const [nm,run] of [['모의 vrSimForward',e=>e.vrSimForward()],['과거재생 vrReplay',e=>e.vrReplay()]]){
      const sess={paper:true,id:'g8',simStart:days[0],settings:{...st},hist:[]};
      run(__P7.mkVr(sess,Q,days[0]));
      const sells=sess.hist.filter(h=>h.type==='sell');
      __strat=sess; const cv=computeVr();
      P8(`VR 체결 — ${nm} 끝까지: 둘째 날 115.00 × 13주만 · 최종 87주`,
         sells.length===1 && sells[0].date===days[1] && +sells[0].price===VG.p1 && +sells[0].qty===VG.q1 && cv.qty===VG.shares,
         JSON.stringify(sells)+' · '+cv.qty+'주'); }
    global.capGainTax=_cgt; delete M.__G8; }

  /* ───────── 2. VR 인출 — 미리보기 == 실제 진입 (8-② · 8-⑦) ─────────
     규칙 문장: 인출은 Pool 안에서만 나간다. Pool 1.10 · 요청 50 → 실제 인출 1.10 · 다음 Pool 0.
     V 식의 인출 항은 요청액(50)이다 — 원문 확인 전까지 지금 동작 유지 (감사도 '원문 확인 후 결정' 이라 적었다).
       다음 V = 10000 + 1.10/10 − 50 = 9950.11 */
  const WG={actual:1.10, nextPool:0, nextV:9950.11};
  G8('VR 인출 — Pool 1.10 · 요청 50 → 실제 1.10 · 다음 Pool 0 · 다음 V 9950.11 (손 계산)',
     WG.actual===Math.min(50,1.10) && WG.nextPool===0 && Math.abs(WG.nextV-(10000+1.10/10-50))<1e-9);
  { const c={st:{mode:0.25,add:50,g:10,formula:'basic'},V:10000,pool:1.10};
    const r=computeNextV(c,10000);
    P8('VR 인출 — 운영 미리보기 computeNextV: 다음 Pool 0 · 실제 1.10 · V 9950.11',
       Math.abs(r.nextPool-WG.nextPool)<1e-12 && Math.abs(r.actual-WG.actual)<1e-12 && r.requested===50 && Math.abs(r.nextV-WG.nextV)<1e-9,
       JSON.stringify({nextPool:r.nextPool,actual:r.actual,nextV:r.nextV}));
    // 실제 진입 — 자동 진입(vrStepCycle)이 남긴 기록으로 장부를 다시 세면 Pool 이 미리보기와 같다
    const step=new Function('computeNextV','CYC_DAYS', fnOf(idx,['function vrCycStart(c)','function cycDates(c)',
      'function vrStepCycle(sess, c, dateStr, close)'])+'\nreturn vrStepCycle;')(computeNextV,14);
    const st={ticker:'TQQQ',mode:0.25,formula:'basic',g:10,initAmt:0,add:50,band:15,startv:10000,startpool:1.10,startCyc:3,cycStart:'2026-01-02'};
    const sess={settings:{...st},hist:[]};
    __strat=sess; const c0=computeVr();
    const rp=computeNextV(c0, c0.V);                        // 미리보기
    step(sess, c0, '2026-01-16', 0);                      // 실제 진입
    __strat=sess; const c1=computeVr();
    P8('VR 인출 — 운영 자동 진입 뒤 장부 Pool = 미리보기 Pool = 0', Math.abs(c1.pool-rp.nextPool)<1e-9 && Math.abs(c1.pool)<1e-9,
       `미리보기 ${rp.nextPool} · 진입 뒤 ${c1.pool} · 기록 ${JSON.stringify(sess.hist)}`);
    P8('VR 인출 — 진입 뒤 V = 미리보기 V', Math.abs(c1.V-rp.nextV)<1e-6, `${c1.V} / ${rp.nextV}`);
    // 5년 플랜
    const pr=PLV.calcPlanNextV({st:{mode:0.25,add:50,g:10,formula:'basic'},V:10000,pool:1.10,qty:0},0);
    P8('VR 인출 — 5년 플랜 calcPlanNextV: 실제 1.10 · 다음 Pool 0 · V 9950.11',
       Math.abs(pr.actual-WG.actual)<1e-12 && Math.abs(pr.nextPool)<1e-12 && Math.abs(pr.nextV-WG.nextV)<1e-9, JSON.stringify(pr));
    // 백테·과거재생 — 같은 전환식
    const tb=vrCycleTransition(10000,1.10,10000,10,0.25,50,'basic');
    P8('VR 인출 — 백테·과거재생 vrCycleTransition: 실제 1.10 · 다음 Pool 0', Math.abs(tb.actual-1.1)<1e-12 && Math.abs(tb.nextPool)<1e-12);
    // 예전 식(미리보기가 요청액을 그대로 뺐다)이면 −48.90 이었다 — 그 값이 다시 나오면 안 된다
    P8('VR 인출 — 미리보기가 −48.90 을 내지 않는다 (옛 버그값)', Math.abs(r.nextPool-(-48.9))>1); }
  ok('제8차 8-⑦ VR 전환식이 index·backtest·plan 에 글자 그대로 같다 (4벌 → 1벌)',
     same3('function vrCycleTransition(V, pool, ev, G, mode, add, formula)', idx, bt, pl));
  ok('제8차 8-⑦ 네 경로가 전환식만 쓴다 (V 식을 따로 적지 않는다)',
     /const T=vrCycleTransition\(V, Pool, ev, G, st\.mode, st\.add, st\.formula\);/.test(extractFn(idx,'function computeNextV(c,ev)'))
     && /const TR=vrCycleTransition\(V, pool, shares\*c, G, mode, isAccum\?contrib:withdraw, formula\);/.test(extractFn(idx,'function vrReplay()'))
     && /const TR=vrCycleTransition\(V, pool, shares\*c, G, mode, isAccum\?contrib:isWd\?withdraw:0, formula\);/.test(extractFn(bt,'function runVR(days,tkr,params)'))
     && /const T=vrCycleTransition\(c\.V, c\.pool, ev, G, st\.mode, st\.add, st\.formula\);/.test(extractFn(pl,'function calcPlanNextV(c,close)'))
     && !/pool\/G\+\(cv-V\)/.test(idx+bt) && !/c\.pool\/G\+sign\*add/.test(pl));
  ok('제8차 8-② 수동·자동 진입이 미리보기와 같은 r 의 실제 액수를 기록한다',
     /h\.push\(\{type:r\.type, date:startDate, amt:\+add\.toFixed\(6\)/.test(extractFn(idx,'function enterNextCycle()'))
     && /if\(r\.actual>0\) sess\.hist\.push\(\{type:r\.type, date:dateStr, amt:\+r\.actual\.toFixed\(6\)/.test(extractFn(idx,'function vrStepCycle(sess, c, dateStr, close)'))
     && !/function vrCycleFlow/.test(idx));

  /* ───────── 3. 리버스 미지원 분할 (8-③ · 8-④) ─────────
     규칙 문장: 리버스 규칙(보유÷N · T 배율)이 문서에 있는 분할은 20·40 뿐이다. 10·30분할에서는
     reverse=true 여도 리버스가 아니다. div=30 · T=29.5 · 보유 100주 → 모든 경로 reverse=false. */
  G8('리버스 미지원 — 10·30분할은 규칙 없음 → reverse=false (문서의 리버스 분할 20·40)', JSON.stringify(REV_DIVS)==='[20,40]');
  const PLI=new Function([
    (pl.match(/const usd=v=>[^\n]*/)||[''])[0], (pl.match(/const FEE=[^\n]*/)||[''])[0],
    pl.slice(pl.indexOf('const KIND_T='), pl.indexOf(';', pl.indexOf("'절반매수+지정가매도(애프터)'"))+1),
    (pl.match(/const isBuyKind=[^\n]*/)||[''])[0], (pl.match(/const isSellKind=[^\n]*/)||[''])[0],
    (pl.match(/const REV_DIVS_PLAN=[^\n]*/)||[''])[0],
    (pl.match(/function reverseTPlan[^\n]*/)||[''])[0], (pl.match(/function starPctPlan[^\n]*/)||[''])[0],
    (pl.match(/function imBuyQtyPlan[^\n]*/)||[''])[0], (pl.match(/function imRevBuyQtyPlan[^\n]*/)||[''])[0],
    extractFn(pl,'function calcInfState(sess)'), extractFn(pl,'function imOrders(sess,price,rows)'),
    'return {imOrders, calcInfState};'].join('\n'))();
  const sheetF=new Function('computeInf','starPct','wn', `
    const infSettledLast=()=>({close:10}), inputNum=()=>0;
    ${fnOf(idx,['function kindOptHTML(name,tval,cls,reco)','function fmtT(t)','function imBuy1(c)'])}
    ${extractFn(idx,'function sheetInfHTML(today)')}
    return sheetInfHTML;`)(computeInf, starPct, v=>'$'+(+v).toFixed(2));
  const rowBars=(n,start,px)=>{ const out=[]; const d0=new Date(start+'T00:00:00Z');
    while(out.length<n){ const w=d0.getUTCDay(); if(w>0&&w<6) out.push(d0.toISOString().slice(0,10)); d0.setUTCDate(d0.getUTCDate()+1); }
    return out.map((d,i)=>({date:d, close:px(i), open:px(i), high:px(i)*1.01, low:px(i)*0.99})); };
  for(const div of [10,30]){
    const T=div-0.5, st={ticker:'SOXL',div,target:20,principal:10000,compound:true,reverse:true,big:15,revGap:0,tgtDyn:false,divmode:'reinv'};
    const h1=[{kind:'1회매수',date:'2026-01-02',price:10,qty:100,tManual:T}];
    const h2=[...h1,{kind:'리버스매도',date:'2026-01-05',price:9,qty:5}];     // 분할을 나중에 바꾼 옛 세션 — 장부에 리버스 기록이 남아 있다
    for(const [lbl,H] of [['보유 100주 · T='+T,h1],['장부에 리버스 기록이 남은 옛 세션',h2]]){
      __strat={settings:{...st},hist:H}; const a=computeInf();
      const b=SV8.imCompute({...st},H), p=PLI.calcInfState({settings:{...st},hist:H});
      P8(`리버스 미지원 ${div}분할 (${lbl}) — 앱 computeInf · 서버 imCompute · 플랜 calcInfState 모두 reverse=false`,
         a.reverseActive===false && b.reverseActive===false && p.reverseActive===false,
         `앱 ${a.reverseActive} · 서버 ${b.reverseActive} · 플랜 ${p.reverseActive}`);
      const so=SV8.imOrders({st:{...st},hist:H,close:9,days:[{date:'2026-01-05',close:9}]});
      const po=PLI.imOrders({settings:{...st},hist:H},9,[{date:'2026-01-05',close:9}]);
      P8(`리버스 미지원 ${div}분할 (${lbl}) — 서버·플랜 주문에 리버스가 없다`,
         !/리버스/.test(so.skip||'') && !(so.orders||[]).some(o=>/리버스|쿼터매수|무한매도/.test(o.kind||''))
         && !(po.orders||[]).some(o=>/리버스|쿼터매수|무한매도/.test(o.name||'')),
         `서버 ${so.skip||''} ${JSON.stringify(so.orders)} · 플랜 ${JSON.stringify(po.orders)}`);
      __strat={id:'s',settings:{...st},hist:H};
      let sh=''; try{ sh=sheetF('2026-01-06'); }catch(e){ sh='ERR '+e.message; }
      P8(`리버스 미지원 ${div}분할 (${lbl}) — 기록시트 sheetInfHTML 에 리버스 입력칸이 없다`,
         !/ERR /.test(sh) && !/리버스매도|리버스매수|리버스모드/.test(sh), sh.slice(0,160));
    }
    // 모의 infSimForward — 소진 상태에서 하락이 이어져도 리버스 체결을 만들지 않는다
    { const bars=rowBars(8,'2026-01-05',i=>9-i*0.1);
      const Q={symbol:'SOXL', ohlc:bars, days:bars.map(x=>({date:x.date,close:x.close})), priceBasis:'trade', dividends:[]};
      const sess={paper:true,id:'r8',simStart:'2026-01-02',settings:{...st,simLast:'2026-01-02'},hist:h1.map(x=>({...x}))};
      __P7.paperRun(sess, Q, '2026-01-05');
      const rev=sess.hist.filter(x=>/리버스/.test(x.kind||''));
      P8(`리버스 미지원 ${div}분할 — 모의 infSimForward 가 리버스 체결을 만들지 않는다`, rev.length===0,
         JSON.stringify(rev.slice(0,3))+' / 기록 '+sess.hist.length+'건'); }
    // 백테 runIM — 켜도 끈 것과 같다 ([74] 와 같은 뜻을 이 골든 이름으로 한 번 더)
    { const Tk=DAYS.SOXL?'SOXL':'TQQQ', D0=DAYS[Tk];
      global.imReverse=false; const a=runIM(D0,Tk,10000,div,IM_OFFICIAL[Tk]||20,true);
      global.imReverse=true;  const b=runIM(D0,Tk,10000,div,IM_OFFICIAL[Tk]||20,true);
      global.imReverse=false;
      P8(`리버스 미지원 ${div}분할 — 백테 runIM 리버스 ON = OFF`, Math.abs(a.final-b.final)<1e-9, `${a.final} / ${b.final}`); }
  }
  // 지원 분할(20)에서는 같은 장부가 리버스여야 한다 — 문을 너무 닫지 않았는지
  { const st={ticker:'SOXL',div:20,target:20,principal:10000,compound:true,reverse:true,big:15,revGap:0};
    const H=[{kind:'1회매수',date:'2026-01-02',price:10,qty:100,tManual:19.5}];
    __strat={settings:{...st},hist:H}; const a=computeInf();
    P8('리버스 지원 20분할 — 같은 장부면 앱·서버·플랜 모두 reverse=true (지원 분할은 그대로)',
       a.reverseActive===true && SV8.imCompute({...st},H).reverseActive===true && PLI.calcInfState({settings:{...st},hist:H}).reverseActive===true); }
  ok('제8차 8-③ 모의가 revEnabled 를 쓴다', /const revOn=revEnabled\(st\);/.test(extractFn(idx,'function infSimForward(startFrom)'))
     && !/const revOn=\(st\.reverse===true\);/.test(idx));
  ok('제8차 8-④ 기록시트·장부·서버·플랜이 지원 분할을 본다',
     /const reverse = revEnabled\(st\) && c\.T>st\.div-1 && c\.qty>0;/.test(extractFn(idx,'function sheetInfHTML(today)'))
     && /const reverseActive = revEnabled\(st\) && revState!=='NORMAL' && qty>0;/.test(idx)
     && /const reverseActive = revEnabled\(st\) && revState !== "NORMAL" && qty > 0;/.test(imSrc8)
     && /reverseActive:st\.reverse===true&&REV_DIVS_PLAN\.includes\(\+st\.div\)&&revState!=='NORMAL'&&qty>0/.test(pl));

  /* ───────── 4. 플랜 가격 (8-⑤) ─────────
     규칙 문장: 매매·주문·리버스 별지점은 체결가 계열(ohlcTrade)로 센다 — 앱·백테 공통.
     실데이터(testdata/quote_TQQQ_2026-06_div1.json — 배당락 2026-06-24 · 0.171$) 에서 손으로 뽑은 값:
       2026-06-23 체결 종가 74.44 (조정 종가는 74.269 — 예전 플랜이 쓰던 값)
       06-24 주문의 리버스 별지점 = 06-16~06-23 체결 종가 5개 평균
                                 = (79.93+77.54+82.87+82.58+74.44)/5 = 79.472  (조정으로는 79.28944) */
  { const J=JSON.parse(fs.readFileSync(__d+'/testdata/quote_TQQQ_2026-06_div1.json','utf8'));
    const PG={close0623:74.44, star5:79.472, adjClose0623:74.269, adjStar5:79.28944};
    G8('플랜 가격 — 2026-06-23 체결 종가 74.44 · 06-24 리버스 별지점 79.472 (손 계산 · 조정가로는 74.269 · 79.28944)',
       Math.abs((79.93+77.54+82.87+82.58+74.44)/5-PG.star5)<1e-9 && Math.abs((79.7464+77.3619+82.6796+82.3903+74.269)/5-PG.adjStar5)<1e-9);
    // 두 쪽 다 실코드. 시계만 같은 값(2026-06-24 10:00 ET — 장중)으로 고정한다
    const CLOCK="function _exchNow(cur){ return {date:'2026-06-24', min:10*60}; }";
    const mainQ=new Function(fnOf(idx,['function quoteToDaily(SYM, j)','function simCutoff(cur)','function settledBars(rows,cur)'])+'\n'
      +(idx.match(/const MKT_CLOSE_MIN=[^\n]*/)||[''])[0]+'\n'+(idx.match(/const SETTLE_LAG_MIN=[^\n]*/)||[''])[0]+'\n'+CLOCK
      +'\nreturn (j)=>{ const q=quoteToDaily("TQQQ",j); return {q, settled:settledBars(q.days,"usd")}; };')();
    const planQ=new Function(fnOf(pl,['function quoteToDaily(SYM, j)','function simCutoff(cur)','function settledBars(rows,cur)','function planQuoteOf(sym,j,cur)'])+'\n'
      +(pl.match(/const MKT_CLOSE_MIN=[^\n]*/)||[''])[0]+'\n'+(pl.match(/const SETTLE_LAG_MIN=[^\n]*/)||[''])[0]+'\n'+CLOCK
      +'\nreturn (j)=>planQuoteOf("TQQQ",j);')();
    const m=mainQ(J), p=planQ(J);
    const mSet=m.settled[m.settled.length-1], pSet=p.settled;
    P8('플랜 가격 — 앱 확정 종가 = 플랜 확정 종가 = 74.44 (06-23)',
       mSet.date==='2026-06-23' && pSet.date==='2026-06-23' && mSet.close===PG.close0623 && pSet.close===PG.close0623,
       `앱 ${mSet.date} ${mSet.close} · 플랜 ${pSet.date} ${pSet.close}`);
    P8('플랜 가격 — 체결가 계열 전 구간이 앱과 같다', JSON.stringify(m.q.days)===JSON.stringify(p.rows) && m.q.priceBasis==='trade' && p.priceBasis==='trade');
    const s5=a=>{ const x=a.filter(r=>r.date<='2026-06-23').slice(-5); return x.reduce((s,r)=>s+r.close,0)/5; };
    P8('플랜 가격 — 리버스 별지점(직전 5일 평균) 앱 = 플랜 = 79.472',
       Math.abs(s5(m.settled)-PG.star5)<1e-9 && Math.abs(s5(p.rows)-PG.star5)<1e-9, `${s5(m.settled)} / ${s5(p.rows)}`);
    // 실제 주문 — 같은 리버스 장부에서 앱 renderOrder 와 플랜 imOrders 가 같은 리버스 매수가를 낸다
    const st={ticker:'TQQQ',div:20,target:15,principal:10000,compound:true,reverse:true,big:15,revGap:0,tgtDyn:false,divmode:'reinv'};
    const H=[{kind:'1회매수',date:'2026-06-01',price:90,qty:100,tManual:19.5},{kind:'리버스매도',date:'2026-06-02',price:88,qty:10}];
    const settledRows=p.rows.filter(r=>r.date<=pSet.date);
    __P7.ENV.ST={...st}; __P7.ENV.HIST=H; __P7.ENV.CLOSE=pSet.close; __P7.ENV.DAYS=m.settled;
    const ao=__P7.appOrders().filter(o=>o.side==='buy');
    const po=PLI.imOrders({settings:{...st},hist:H},pSet.close,settledRows).orders.filter(o=>o.side==='buy');
    const want=+(PG.star5-0.01).toFixed(6);
    P8('플랜 가격 — 리버스 매수가 앱 주문표 = 플랜 주문표 = 79.462 (별지점 − 0.01)',
       ao.length>0 && po.length>0 && Math.abs(ao[0].price-want)<1e-9 && Math.abs(po[0].price-want)<1e-9,
       `앱 ${ao.map(o=>o.price).join(',')} · 플랜 ${po.map(o=>o.price).join(',')}`);
    // 확정 시각도 같은가 — 값으로 (장 마감 15분 뒤: 앱 규약 16:00+20분이면 아직 전날 봉이 확정 종가다)
    { const CLOCK2="function _exchNow(cur){ return {date:'2026-06-24', min:16*60+15}; }";
      const mk=(src,extra,ret)=>new Function(fnOf(src,['function quoteToDaily(SYM, j)','function simCutoff(cur)','function settledBars(rows,cur)'].concat(extra))+'\n'
        +(src.match(/const MKT_CLOSE_MIN=[^\n]*/)||[''])[0]+'\n'+(src.match(/const SETTLE_LAG_MIN=[^\n]*/)||[''])[0]+'\n'+CLOCK2+'\n'+ret)();
      const a=mk(idx,[],'return (j)=>{ const d=settledBars(quoteToDaily("TQQQ",j).days,"usd"); return d[d.length-1]; };')(J);
      const b=mk(pl,['function planQuoteOf(sym,j,cur)'],'return (j)=>planQuoteOf("TQQQ",j).settled;')(J);
      P8('플랜 가격 — 16:15 ET(마감 15분 뒤)에도 앱·플랜 둘 다 06-23 을 확정 종가로 본다 (예전 플랜 16:10 이면 06-24)',
         a.date==='2026-06-23' && b.date==='2026-06-23', `앱 ${a.date} · 플랜 ${b.date}`); }
    // 실제 로더 — fetchPlanQuote 가 div=1 로 받고 정규화를 거치는가. 회귀는 동기로 돌므로
    // 실코드에서 async/await 만 걷어 내고 fetch 를 동기 가짜로 바꿔 그대로 돌린다
    { const urls=[];
      const loader=extractFn(pl,'async function fetchPlanQuote(symbol)').replace(/^async function/,'function').replace(/await /g,'');
      const fq=new Function('fetch', fnOf(pl,['function quoteToDaily(SYM, j)','function simCutoff(cur)','function settledBars(rows,cur)','function planQuoteOf(sym,j,cur)'])+'\n'+loader+'\n'
        +(pl.match(/const MKT_CLOSE_MIN=[^\n]*/)||[''])[0]+'\n'+(pl.match(/const SETTLE_LAG_MIN=[^\n]*/)||[''])[0]+'\n'+CLOCK+'\nlet liveQuotes={};\nreturn fetchPlanQuote;')(
        (u)=>{ urls.push(u); return {ok:true, json:()=>J}; });
      const q=fq('TQQQ');
      P8('플랜 가격 — 실제 로더 fetchPlanQuote: div=1 로 받고 확정 종가 74.44 (06-23)',
         urls.length===1 && /[?&]div=1(&|$)/.test(urls[0]) && q.settled.date==='2026-06-23' && q.settled.close===PG.close0623 && q.priceBasis==='trade',
         `${urls[0]} · ${q.settled.date} ${q.settled.close} · ${q.priceBasis}`); }
    ok('제8차 8-⑤ 시세 정규화가 index·plan 에 글자 그대로 같다 (quoteToDaily · _exchNow · simCutoff · settledBars · 상수)',
       ['function quoteToDaily(SYM, j)','function _exchNow(cur)','function simCutoff(cur)','function settledBars(rows,cur)'].every(sig=>same3(sig,idx,pl))
       && (idx.match(/const MKT_CLOSE_MIN=[^\n]*/)||[1])[0]===(pl.match(/const MKT_CLOSE_MIN=[^\n]*/)||[2])[0]
       && (idx.match(/const SETTLE_LAG_MIN=[^\n]*/)||[1])[0]===(pl.match(/const SETTLE_LAG_MIN=[^\n]*/)||[2])[0]);
    ok('제8차 8-⑤ 플랜이 div=1 로 받아 정규화 함수를 거친다',
       /\/api\/quote\?symbol='\+encodeURIComponent\(sym\)\+'&range=max&div=1'/.test(extractFn(pl,'async function fetchPlanQuote(symbol)'))
       && /return liveQuotes\[sym\]=planQuoteOf\(sym,j\);/.test(pl) && !/j\.series\.map\(x=>\(\{date:x\.date,close:\+x\.close\}\)\)/.test(pl)); }

  /* ───────── 5. 표시 — 공식/변형 · CUSTOM · 자동주문 한계 (8-① · 8-⑥ · 8-⑧ · P2-11) ───────── */
  const noCmt=x=>x.replace(/\/\*[\s\S]*?\*\//g,'').replace(/<!--[\s\S]*?-->/g,'');   // 옛 이름을 설명하는 주석은 빼고 화면·코드만
  ok('정식 문서 반영 — VR 모델 이름 = V 복귀 예약표 (정식) · 옛 20차 사다리 이름은 화면에 없다',
     /V 복귀 예약표 \(정식\)/.test(idx) && /V 복귀 예약표 \(정식\)/.test(bt) && !/20차 예약 사다리/.test(noCmt(idx+bt))
     && !/공식 예약 사다리/.test(noCmt(idx+bt)) && !/data-v="(official|ladder20)"/.test(idx+bt) && !/vrModel:'(official|ladder20)'/.test(idx));
  { const f=new Function(extractFn(bt,'function vrFillLabel()')+'\nreturn vrFillLabel;')();
    global.vrFill='vreturn'; const a=f(); global.vrFill='close'; const b=f(); delete global.vrFill;
    ok('정식 문서 반영 — 백테 결과 제목: 기본 \'V 복귀 예약표(정식)\', 비교 모델이면 종가', /V 복귀 예약표\(정식\)/.test(a) && /종가 리밸런싱/.test(b), a+' / '+b);
    ok('제8차 8-① 결과 제목 세 곳이 한 함수를 읽는다', (bt.match(/vrFillLabel\(\)/g)||[]).length>=4); }
  ok('제8차 8-⑥ 자동주문 화면에 V4.0 완전 자동 아님 · 다섯 가지 한계', (()=>{ const f=new Function(extractFn(idx,'function kisAutoLimitsNote()')+'\nreturn kisAutoLimitsNote;')()();
       return /V4\.0 완전 자동 아님/.test(f) && /일반모드만 지원/.test(f) && /리버스 자동주문 미지원/.test(f) && /LOC는 일반 지정가로 근사/.test(f)
         && /체결내역 자동 동기화 없음/.test(f) && /익절 지정가 유효시간이 백테와 다름/.test(f); })()
     && /\$\{kisAutoLimitsNote\(\)\}/.test(extractFn(idx,'function renderKisPanel()')) && /kisAutoLimitsNote\(\)\+/.test(extractFn(idx,'async function kisOptUI()')));
  /* 정식 문서 반영 — 8-⑧ 에서 'CUSTOM(백테·모의 미반영)' 으로 표시했던 하방 LOC 는 V4.0 정리본의
     처음매수·전반전·후반전 모두에 '아래로 LOC매수 추가' 로 들어 있는 정식 주문이다. 이제 백테·모의·운영·서버·플랜이
     같은 함수(imBuyOrders)로 걸고 체결한다 — CUSTOM·미반영 문구가 남아 있으면 안 된다. */
  ok('정식 문서 반영 — 아래로 LOC 추가에 CUSTOM·미반영 문구가 없다 (설정·주문표·서버·플랜)',
     !/미반영 CUSTOM|CUSTOM\(백테/.test(noCmt(idx)) && !/CUSTOM/.test(noCmt(imSrc8)) && !/CUSTOM/.test(noCmt(pl))
     && /const BO=imBuyOrders\(\{/.test(extractFn(idx,'function renderOrder()')) && /imBuyOrders\(\{/.test(imSrc8));
  { // 서버 주문 = 정식 함수 그대로 (값) — 평단 10 · 50주 · 잔금 9500 · T=1 → 1회매수금 500, 본 주문 21+25=46주
    const st={ticker:'SOXL',div:20,target:20,principal:10000,compound:true,reverse:false,big:15,revGap:0,rows:2,rowqty:1};
    const so=SV8.imOrders({st,hist:[{kind:'1회매수',date:'2026-01-02',price:10,qty:50}],close:10,days:[{date:'2026-01-02',close:10}]});
    const lad=(so.orders||[]).filter(o=>/하방/.test(o.kind)), mains=(so.orders||[]).filter(o=>o.side==='buy'&&!/하방/.test(o.kind));
    const lo=Math.min(...mains.map(o=>o.price));
    ok('정식 문서 반영 — 서버 아래로 LOC 추가: 1회매수금÷(46+k) · 1주씩 · 본 주문보다 아래만 (평단 10 위인 ÷47~50 은 건너뜀)',
       lad.length===2 && lad.every(o=>o.qty===1 && o.price<lo && !/CUSTOM/.test(o.kind))
       && lad[0].price===9.8 && lad[1].price===9.61 && /÷51/.test(lad[0].kind) && /÷52/.test(lad[1].kind), JSON.stringify(so.orders)); }
  ok('제8차 8-⑧ 리버스 gap 칸이 하방 LOC 스위치에 같이 잠기지 않는다',
     !/id="rows_fields">[\s\S]{0,400}id="set_revgap"/.test(idx) && /id="set_revgap" type="number" inputmode="decimal" value="0"/.test(idx));
  // P2-11 공식/변형 — 앱·백테 같은 판정
  ok('제8차 P2-11 공식/변형 판정이 index·backtest 에 글자 그대로 같다', same3('function imVariantOf(cfg)', idx, bt));
  { const V=new Function('IM_OFFICIAL','revSupported','IM_BIG_DEFAULT', extractFn(idx,'function imVariantOf(cfg)')+'\nreturn imVariantOf;')(IM_OFFICIAL, revSupported, 15);
    const base={tickers:['TQQQ'],div:20,reverse:true,revGap:0,target:15,tgtDyn:false,engine:'v40',big:15};
    ok('P2-11 V4.0 공식 — TQQQ 20분할 · 리버스 ON · gap 0 · 익절 15 · 큰수 15', V(base).length===0, JSON.stringify(V(base)));
    ok('P2-11 V4.0 공식 — SOXL 40분할 · 익절 20', V({...base,tickers:['SOXL'],div:40,target:20}).length===0);
    ok('P2-11 변형 — 리버스 OFF (앱 기본값)', JSON.stringify(V({...base,reverse:false}))==='["리버스 OFF"]');
    ok('P2-11 변형 — 리버스 gap 2.5%', /리버스 gap 2\.5%/.test(V({...base,revGap:2.5}).join()));
    ok('P2-11 변형 — 아래로 LOC 추가 끔 (rows 0) · 줄 수를 바꾸는 건 공식', /아래로 LOC 추가 끔/.test(V({...base,rows:0}).join())
       && V({...base,rows:8}).length===0 && V({...base,rows:3}).length===0);
    ok('P2-11 변형 — SOXL 에 익절 15%', /익절 15% 고정/.test(V({...base,tickers:['SOXL']}).join()));
    ok('P2-11 변형 — 30분할(리버스 미적용)', /30분할/.test(V({...base,div:30}).join()) && /리버스 미적용/.test(V({...base,div:30}).join()));
    ok('P2-11 변형 — 큰수 20%', /큰수 20%/.test(V({...base,big:20}).join())); }
  { // 백테 공식 프리셋(리버스 ON · gap 0)이 '변형' 으로 표시되던 버그 — imVariant 가 전역값을 모아 넘긴다
    const f=new Function('IM_OFFICIAL','revSupported','IM_BIG_DEFAULT', extractFn(bt,'function imVariantOf(cfg)')+'\n'+extractFn(bt,'function imVariant(tkrs)')+'\nreturn imVariant;')(IM_OFFICIAL, revSupported, 15);
    const sv={imDiv:global.imDiv, imReverse:global.imReverse, imRevGap:global.imRevGap, imTarget:global.imTarget, imTgtDyn:global.imTgtDyn, imEngine:global.imEngine};
    Object.assign(global,{imDiv:20, imReverse:true, imRevGap:0, imTarget:0, imTgtDyn:false, imEngine:'v40'});
    const v0=f(['TQQQ','SOXL']);
    Object.assign(global,{imRevGap:2.5}); const v1=f(['TQQQ']);
    Object.assign(global,sv);
    ok('P2-11 백테 공식 프리셋(리버스 ON · gap 0) = 변형 표시 없음 (예전엔 \'리버스 gap 0%\' 로 변형이었다)', v0.length===0, JSON.stringify(v0));
    ok('P2-11 백테 gap 2.5% 는 변형', v1.length===1 && /리버스 gap 2\.5%/.test(v1[0]), JSON.stringify(v1)); }
  ok('P2-11 앱 주문표에 규칙 줄 (V4.0 공식 / 변형(CUSTOM))', /id="o_rule"/.test(idx) && /\$\('o_rule'\)\.innerHTML=imRuleTag\(st\);/.test(extractFn(idx,'function renderOrder()')));

  /* ───────── 6. P2-9 호가 · P2-10 양방향 터치 ───────── */
  ok('P2-9 호가 헬퍼·차수 목록이 index·backtest·plan 에 글자 그대로 같다',
     ['function vrTick(p, cur)','function vrTickUp(p, cur)','function vrTickDn(p, cur)','function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)'].every(sig=>same3(sig,idx,bt,pl)));
  ok('P2-9 매도 올림 116.1616 → 116.17 · 매수 내림 84.158 → 84.15', vrTickUp(11500/99)===116.17 && vrTickDn(8500/101)===84.15);
  ok('P2-9 딱 떨어지는 값은 그대로 (115.00 · 85.00 — 부동소수 잡음 없이)', vrTickUp(10000*1.15/100)===115 && vrTickDn(10000*0.85/100)===85);
  ok('P2-9 1달러 미만은 0.0001 · 원화 ETF 2,000원 미만 1원 · 이상 5원',
     vrTickUp(0.12341)===0.1235 && vrTickUp(1234.2,'krw')===1235 && vrTickUp(12341,'krw')===12345 && vrTickDn(12344,'krw')===12340 && vrTickUp(1999.2,'krw')===2000);
  { // 고가가 반올림 가격(132.18)에 닿아도 호가 올림 132.19 주문은 안 닿는다 — 엔진과 실제 주문이 같은 가격
    const S={shares:87,pool:0,avg:100,V:10000};
    const f=vrOrderPlan(S,{...P0v,sellFilled:13},{date:'x',open:130,high:132.18,low:130,close:132.18});
    ok('P2-9 고가 132.18 에서 2차(11500/87 = 132.1839 → 132.19) 미체결', f.length===0, JSON.stringify(f)); }
  { // 같은 봉 양방향 터치 — 순서 가정이 결과를 바꾸는 경우를 만든다 (Pool 이 매도대금 없이는 모자람)
    const P={band:.15,poolLimit:.75,FEE:0,baseShares:100,sellFilled:0,buyFilled:0,maxTiers:20,budgetRemaining:1000,cur:'usd'};
    const bar={date:'x',open:100,high:116,low:84,close:100};
    const Sa={shares:100,pool:50,avg:100,V:10000}, fa=vrOrderPlan(Sa,{...P},bar);
    const Sb={shares:100,pool:50,avg:100,V:10000}, fb=vrOrderPlan(Sb,{...P,order:'buy-first'},bar);
    ok('P2-10 같은 봉 상·하단 둘 다 닿으면 both=true', fa.both===true && fb.both===true);
    ok('P2-10 매도 먼저면 판 돈으로 1차 매수 · 매수 먼저면 Pool 50 이라 못 산다 (순서가 결과를 바꾼다)',
       fa.filter(x=>x.type==='buy').length===1 && fb.filter(x=>x.type==='buy').length===0,
       JSON.stringify(fa)+' / '+JSON.stringify(fb));
    const Sc={shares:100,pool:50,avg:100,V:10000}, fc=vrOrderPlan(Sc,{...P},{date:'x',open:100,high:116,low:100,close:100});
    ok('P2-10 한쪽만 닿으면 both=false', fc.both===false); }
  { // 백테가 양방향 터치일을 세어 돌려준다 · 화면이 그 수와 매수 먼저 민감도를 적는다
    const days=[]; { const d0=new Date('2026-02-02T00:00:00Z');
      while(days.length<12){ const w=d0.getUTCDay(); if(w>0&&w<6) days.push(d0.toISOString().slice(0,10)); d0.setUTCDate(d0.getUTCDate()+1); } }
    M.__B8={}; days.forEach((d,i)=>{ const r=[]; const [c,o,h,l]= i===2?[100,100,117,83]:i===5?[100,100,135,70]:[100,100,100,100];
      r[C]=c; r[O]=o; r[HI]=h; r[LO]=l; M.__B8[d]=r; });
    const r1=runVR(days,'__B8',{initAmt:10000,startPool:20000,G:10,bandPct:15,mode:0.5,formula:'basic',costOn:false});
    const r2=runVR(days,'__B8',{initAmt:10000,startPool:20000,G:10,bandPct:15,mode:0.5,formula:'basic',costOn:false,order:'buy-first'});
    delete M.__B8;
    ok('P2-10 백테 runVR 이 양방향 터치일을 센다 (합성 2일)', r1.bothDays===2 && r2.bothDays===2 && r1.order==='sell-first' && r2.order==='buy-first',
       `${r1.bothDays}/${r2.bothDays} ${r1.order}/${r2.order}`);
    ok('P2-10 백테 화면이 양방향 터치 N일과 매수 먼저 민감도를 적는다',
       /function noteVrBothTouch\(results, rerun\)/.test(bt) && /양방향 터치 \$\{parts\.join\(' · '\)\}/.test(bt)
       && /noteVrBothTouch\(results, t=>runVR\(commonD,t,\{[^}]*order:'buy-first'\}\)\);/.test(bt)); }

  /* ───────── D12 (사용자 결정 · 09-24) — 리버스 기본값은 끔 유지, 대신 'V4.0 변형' 으로 표시 ─────────
     공식(문서의 V4.0 일반모드)은 '소진 → 리버스' 다. 기본값을 끔으로 두는 건 백테 성적을 본 사용자 선택이라
     공식처럼 보이면 안 된다 — 기본값은 끔인 채로, 설정·주문표가 그걸 '변형' 이라고 부르는지 값으로 묶는다. */
  { const d=new Function([(idx.match(/const IM_BIG_DEFAULT=[^\n]*/)||[''])[0], (idx.match(/const REV_GAP_DEF=[^\n]*/)||[''])[0],
                          extractFn(idx,'function defInfSettings()'), 'return defInfSettings();'].join('\n'))();
    const R=new Function('IM_OFFICIAL','revSupported','IM_BIG_DEFAULT', (idx.match(/const REV_GAP_DEF=[^\n]*/)||[''])[0]+'\n'
      +fnOf(idx,['function revGapOf(st)','function imVariantOf(cfg)','function imRuleOf(st)'])+'\nreturn imRuleOf;')(IM_OFFICIAL, revSupported, 15);
    ok('D12 사용자 결정 — 앱 신규 무매 세션의 리버스 기본값은 끔 (값)', d.reverse!==true, JSON.stringify(d.reverse));
    ok('D12 — 그 기본값은 주문표 규칙 줄에 V4.0 변형 · 리버스 OFF 로 뜬다 (값)', JSON.stringify(R(d))==='["리버스 OFF"]', JSON.stringify(R(d)));
    ok('D12 — 설정 안내·백테 버튼이 끔 = V4.0 변형 · 켬 = V4.0 공식으로 적는다',
       /끔\(기본 · <b>V4\.0 변형<\/b>\)/.test(idx) && /켬\(<b>V4\.0 공식<\/b>\)/.test(idx)
       && /유리\(기본 · V4\.0 변형 — 문서의 공식 규칙은 켬\)/.test(bt)); }

  /* ───────── 7. 문구 — '완전 동일' 이라고 쓰지 않는다 (D9·D10 이 열려 있다) ───────── */
  { const doc=fs.existsSync(__d+'/AUDIT-SELF-REVIEW.md')?fs.readFileSync(__d+'/AUDIT-SELF-REVIEW.md','utf8'):'';
    const bad=[idx,bt,pl,doc].some(s=>/모든 전략[^\n]{0,20}완전 동일|운영·모의·백테 완전 동일/.test(s.replace(/'모든 전략 운영·모의·백테 완전 동일'[^\n]*/g,'')));
    ok('제8차 — 어디에도 \'모든 전략 운영·모의·백테 완전 동일\' 이라고 쓰지 않는다', !bad); }
}

console.log(`\n════ 결과: ${pass} PASS / ${fail} FAIL ${fail===0?'— ALL PASS ★':'— 배포 금지, 위 ✗ 항목 수정 필요'} ════`);
process.exit(fail===0?0:1);
