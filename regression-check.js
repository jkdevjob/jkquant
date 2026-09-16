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
const adm=fs.existsSync(ADM)?fs.readFileSync(ADM,'utf8'):'';
console.log(`대상: ${IDX} (${(idx.match(/appVer">(v[\d.]+)/)||[])[1]||'?'}) · ${BT} (${(bt.match(/btVer[^>]*>(v[\d.]+)/)||[])[1]||'?'})\n`);

/* ════ 0. 파일 문법 ════ */
console.log('[0] 파일 문법');
{
  const {spawnSync}=require('child_process');
  const chk=(html,label)=>{
    const js=[...html.matchAll(/<script(?![^>]*src=)(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n;\n');
    const tmp='/tmp/__syn_'+label+'.js'; fs.writeFileSync(tmp,js);
    const r=spawnSync('node',['--check',tmp],{encoding:'utf8'});
    ok(label+' 메인 스크립트 문법', r.status===0, (r.stderr||'').split('\n')[0]);
  };
  chk(idx,'index'); chk(bt,'backtest');
}

// index 엔진
const ki=idx.indexOf('const KIND_T=');
const idxParts=[
  idx.slice(ki, idx.indexOf(';', idx.indexOf('(애프터)', ki))+1),
  extractFn(idx,'function reverseT(kind,t,div)'),
  idx.slice(idx.indexOf('function isBuy(k)'), idx.indexOf('\n', idx.indexOf('function isBuy(k)'))),
  idx.slice(idx.indexOf('function isSell(k)'), idx.indexOf('\n', idx.indexOf('function isSell(k)'))),
  extractFn(idx,'function starPct(ticker,div,T,base)'),
  extractFn(idx,'function exitMulOf(base)'),
  extractFn(idx,'function computeInf()'),
  extractFn(idx,'function computeNextV(c,ev)'),
  extractFn(idx,'function computeVr()'),
];
let __strat=null; global.curStrat=()=>__strat;
eval(idxParts.join('\n'));

// backtest 엔진 + 거래로그 훅 주입 (실코드에 정확 substring 치환, 각 1회 매치 검증)
// 정수 주수 헬퍼는 엔진 밖에 있다 — 파일에서 그대로 떼어 와야 실코드와 어긋나지 않는다
const iqSrc=(bt.match(/^const iq=\(amt,px\)=>[^\n]*\nconst isq=\([^\n]*$/m)||[''])[0];
if(!iqSrc) throw new Error('정수 주수 헬퍼(iq/isq)를 backtest.html에서 못 찾음');
// eval 안의 const는 밖으로 안 새어나간다 — 뒤에 따로 eval하는 엔진(runIM50 등)도 봐야 하니 전역으로 올린다
{ const f=new Function(iqSrc+'\nreturn {iq,isq};')(); global.iq=f.iq; global.isq=f.isq; }
let btSrc=extractFn(bt,'function runIM(days,tkr,cap,divs,targetPct,compound')+'\n'+extractFn(bt,'function runVR(days,tkr,params)');
function inject(before, after, label){
  const p=btSrc.split(before);
  if(p.length!==2) throw new Error(`주입 실패(${label}): ${p.length-1}회 매치 — 코드가 바뀌었으면 이 스크립트의 주입 문자열을 갱신할 것`);
  btSrc=p[0]+after+p[1];
}
inject(`if(sellQty>0){ _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // MOC=종가`,
`if(sellQty>0){ __LOG('리버스매도',c,sellQty); _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // MOC=종가`,'r1');
inject(`if(sellQty>0){ _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // LOC=종가`,
`if(sellQty>0){ __LOG('리버스매도',c,sellQty); _sell(c,sellQty,0); T=divs>=40?T*0.95:T*0.9; }   // LOC=종가`,'r2');
inject(`_buy(c, Math.min(cash, Math.max(cash/4, c)));   // LOC=종가`,
`{const __a=Math.min(cash, Math.max(cash/4, c));const __q=_buy(c,__a);if(__q>0)__LOG('리버스매수',c,__q);}   // LOC=종가`,'r3');
inject(`{_sell(o>tgt?o:tgt,q3,SLIP);tpHit=true;}`,
`{const __px=o>tgt?o:tgt;__LOG('지정가매도',__px,q3);_sell(__px,q3,SLIP);tpHit=true;}`,'tp');
inject(`{_sell(c,sq,0);qtHit=true;}`,
`{__LOG('쿼터매도',c,sq);_sell(c,sq,0);qtHit=true;}`,'qt');
inject(`if(shares===0&&T===0){ if(_buy(c,one)>0) T+=1; }   // 못 사면 회차도 안 쓴다`,
`if(shares===0&&T===0){ const __q=_buy(c,one); if(__q>0){__LOG('1회매수',c,__q); T+=1;} }`,'fb');
inject(`if(c<=buyP){ if(_buy(c,half)>0) T+=0.5; }`,
`if(c<=buyP){ const __q=_buy(c,half); if(__q>0){__LOG('절반매수',c,__q); T+=0.5;} }`,'hb1');
inject(`if(c<=avg) { if(_buy(c,half)>0) T+=0.5; }`,
`if(c<=avg) { const __q=_buy(c,half); if(__q>0){__LOG('절반매수',c,__q); T+=0.5;} }`,'hb2');
inject(`}else{ if(c<=buyP){ if(_buy(c,one)>0) T+=1; } }`,
`}else{ if(c<=buyP){ const __q=_buy(c,one); if(__q>0){__LOG('1회매수',c,__q); T+=1;} } }`,'bb');
// 단리에서 밖에서 넣은 돈(addedCash)을 총자산에서 빼게 되면서 이 줄이 바뀌었다
inject(`const fin=cash+shares*M[tkr][days[days.length-1]][C]+savedProfit-addedCash;`,
`__FINAL({T,avg,shares,cash,realized,savedProfit,addedCash});
  const fin=cash+shares*M[tkr][days[days.length-1]][C]+savedProfit-addedCash;`,'fin');
let tradeLog=[], finalState=null;
global.__LOG=(k,p,q)=>tradeLog.push({kind:k,price:p,qty:q});
global.__FINAL=s=>finalState=s;
global.M={}; global.C=0;
eval(btSrc);
// backtest 상수(starBase/starSlope/exitMul)를 함수화 — 계열 규약 검사용
const mBase=btSrc.match(/const starBase=([^;]+);/), mSlope=btSrc.match(/const starSlope=([^;]+);/), mExit=btSrc.match(/const exitMul ?= ?([^;]+);/);
const btBase=new Function('targetPct','return '+mBase[1]);
const btSlope=new Function('starBase','divs','return '+mSlope[1]);
const btExit=new Function('starBase','return '+mExit[1].replace(/\/\/.*$/,''));

/* ════ 1. 문서 수치 재현 (3차) ════ */
console.log('[1] 문서 수치 재현');
ok('별% TQQQ 20분할 T=10 → 0', near(starPct('TQQQ',20,10),0));
ok('별% TQQQ 40분할 T=10 → 7.5', near(starPct('TQQQ',40,10),7.5));
ok('별% SOXL 20분할 T=10 → 0', near(starPct('SOXL',20,10),0));
ok('별% SOXL 40분할 T=25 → −5', near(starPct('SOXL',40,25),-5));
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
ok('index 기본 base: TQQQ=15', near(starPct('TQQQ',20,0),15));
ok('index 기본 base: SOXL=20', near(starPct('SOXL',20,0),20));

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
  const A=[['SOXL',20,20,102989.30,54.04,35],
           ['TQQQ',40,10,25963.09,62.68,30],
           ['TECL',20,20,46709.32,40.01,14]];
  for(const [tkr,div,tgt,fexp,mexp,cexp] of A){
    if(!DAYS[tkr]){ console.log('  (CSV 없음, 스킵: '+tkr+')'); continue; }
    if(!fixOK(tkr)){ console.log(`  (데이터가 고정본과 달라 앵커 스킵: ${tkr} ${DAYS[tkr].length}일 ~${DAYS[tkr][DAYS[tkr].length-1]})`); continue; }
    const r=runIM(DAYS[tkr],tkr,10000,div,tgt,true);
    ok(`${tkr} ${div}분할 ${tgt}% V4.0 앵커 (최종·MDD·사이클)`,
       near(r.final,fexp,0.05)&&near(r.mdd,mexp,0.01)&&r.cycles===cexp,
       `final ${r.final.toFixed(2)}/${fexp} mdd ${r.mdd.toFixed(2)}/${mexp} cyc ${r.cycles}/${cexp}`);
  }
}

/* ════ 4c. 섀넌 차분 (runIVS 거래로그 → ivsPos 재생) ════
   백테가 만든 리밸런싱을 운영 장부에 그대로 먹였을 때 수량·예수금이 같아야 한다.
   백테에만 있는 '예수금 쪽 비용'(국채 매매 수수료·보수·이자)은 거래 기록 밖의 현금 비용이라
   운영엔 개념이 없다 — 매매 수수료 경로만 격리하려고 그 셋을 끄고 대조한다. */
console.log('[4c] 섀넌 차분 (runIVS 거래로그 → ivsPos 재생)');
{
  global.TBILL_RATE=new Proxy({},{get:()=>0});          // 예수금 이자 중화
  global.META=global.META||{};
  global.COST_FEE=0.0025; global.COST_KRW=1350; global.COST_TAXRATE=0.22;
  global.COST_DEDUCT=1e18;                             // 양도세 중화 (운영은 세금을 안 넣는다)
  eval(extractFn(bt,'function _ivsWeights(tkr,N,s0)'));
  let ivsSrc=extractFn(bt,'function runIVS(days,tkr,cap,s0,N,band,costOn,mode,pair)');
  const inj=(before,after,label)=>{ const p=ivsSrc.split(before);
    if(p.length!==2) throw new Error(`섀넌 주입 실패(${label}): ${p.length-1}회 매치`);
    ivsSrc=p[0]+after+p[1]; };
  inj(`P.avg=(P.sh*P.avg+q*px)/(P.sh+q); P.sh+=q; cash-=spend+lf;`,
      `P.avg=(P.sh*P.avg+q*px)/(P.sh+q); P.sh+=q; cash-=spend+lf; __LOGI('buy',P===A?'lev':'x1',__DD,px,q,spend-fee,fee);`,'buy');
  inj(`yearPnl+=q*(px-P.avg)-fee; P.sh-=q;`,
      `yearPnl+=q*(px-P.avg)-fee; P.sh-=q; __LOGI('sell',P===A?'lev':'x1',__DD,px,q,gross,fee);`,'sell');
  inj(`days.forEach((d,i)=>{`,`days.forEach((d,i)=>{ __DD=d;`,'date');
  inj(`const LEGFEE=(costOn&&!X1)?COST_FEE:0;`,`const LEGFEE=0;`,'legfee');
  inj(`const CASH_DIVTAX=costOn?0.154:0, CASH_EXP=costOn?0.0010:0;`,`const CASH_DIVTAX=0, CASH_EXP=0;`,'cashcost');
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
  ok('성과 행에 통화를 실어 보낸다', /cur:st\.cur\|\|'usd'/.test(stat));
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
  ok('모의 체결도 별지점 − 0.01', /star-0\.01|star\s*-\s*0\.01/.test(sim));
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
  // 무매 시세 로더 3곳 전부 last를 확정 종가로 채운다 (한 곳만 빠져도 그 화면에서 새어 든다)
  const loaders=idx.match(/lastQuote(?:\.inf|\[which\])\s*=\s*\{[^}]*\}/g)||[];
  const bad=loaders.filter(t=>/last:\s*q\.last\.close/.test(t));
  ok('무매 시세 로더가 확정 종가를 저장', loaders.length>=3 && bad.length===0,
     `로더 ${loaders.length}곳 · 미적용 ${bad.length}곳`);
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
  ok('허용폭 초과 매수에 상한을 씌운다', /_cbrow/.test(ord) && /over\?limit:price/.test(ord),
     ord?'':'renderOrder 없음');
  ok('상한이 공짜가 아님을 안내한다', /건너뜁니다|건너뛰/.test(ord) && /큰수 %/.test(ord));
  /* 기준 종가를 입력칸에서만 읽으면, 보유 중인 세션(입력칸이 숨김)에서 close=0이 되어
     limit=0 → 상한이 통째로 꺼진다. 실제로 현재가보다 +33%인 주문가가 그대로 나갔다. */
  ok('기준 종가가 시세로 폴백된다 (입력칸이 비어도)',
     /inputNum\('o_close'\)\|\|\(_sl\?/.test(ord) && /infSettledLast\(\)/.test(ord));
  ok('폴백 시세는 종목을 대조한다', /Q\.symbol[\s\S]{0,120}st\.ticker/.test(idx));
  ok('큰수 % 기본값 20 (꼬리가 닫히는 구간)',
     /isFinite\(\+st\.big\)\)\?\+st\.big:20/.test(idx) && /big:20,/.test(idx));
  ok('하방 LOC는 같은 상한', /하방 \$\{i\}[\s\S]{0,80}p>limit\)\?limit:p/.test(ord));
  // 수량은 상한 전 가격으로 — 상한이 수량까지 바꾸면 모의·백테와 어긋난다
  // 수량은 상한가가 아니라 '종가'로 나눈다 — 상한이 수량을 흔들면 안 되고,
  // 주문가(별지점)로 나누면 배정액만큼 못 산다(백테·모의는 종가로 나눈다).
  ok('수량은 종가 기준 (주문가 아님)', /alloc,\s*\n?\s*close>0\?close:price/.test(ord));
  // 매도는 절대 낮추면 안 된다 — 낮추면 원치 않는 체결이 난다
  const sellCap=/oitem\('s'[^)]*limit/.test(ord);
  ok('매도가는 상한으로 낮추지 않는다', !sellCap, sellCap?'매도에 상한 적용됨':'');
  // 큰수 %가 없는 옛 세션에서 NaN이 되어 상한이 통째로 꺼지지 않아야 한다
  ok('큰수 % 미설정 세션도 상한 동작', /isFinite\(\+st\.big\)/.test(ord));
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
  ok('모의 매수는 종가 체결', /put\('절반매수',d,cl,/.test(sim) && /put\('1회매수',d,cl,/.test(sim));
  ok('모의 쿼터매도는 종가 체결', /put\('쿼터매도',d,cl,/.test(sim));
  /* 익절 판정은 '종가'다. 고가 터치를 체결로 치면 장중에 스치기만 하고 안 팔린 날까지
     익절로 세어 모의가 실제보다 낙관적으로 나온다 (SOXL 20/10 한 해 +8.7%p).
     체결가는 여전히 max(익절가, 시가) — 갭업이면 시가가 더 유리하다. */
  ok('익절 판정은 종가', /if\(cl>=tgt && qTp>0\)/.test(sim) && !/hi>=tgt/.test(sim));
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
  let ps=''; try{ ps=extractFn(idx,'function paperStat(tab, sess)'); }catch(e){}
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
  ok('시세 요청이 배당을 함께 받는다', /period2=\$\{p2\}&div=1/.test(bt));
  ok('청크마다 배당·raw를 합친다', /allDiv\[x\.date\]=\+x\.amount/.test(bt) && /allRaw\[x\.date\]=\+x\.close/.test(bt));
  let ds=''; try{ ds=extractFn(bt,'function divSplit(tkr, days, buys)'); }catch(e){}
  ok('분해기 존재', !!ds, ds?'':'divSplit 없음');
  ok('분배금은 배당락일 보유수량 기준', /while\(bi<B\.length && B\[bi\]\[0\]<=d\)/.test(ds) && /dvMap\[d\]!=null && sh>0/.test(ds));
  // 단리는 현금이 쌓여 복리와 낙폭이 다르다 — 이벤트만 훑으면 중간 낙폭을 못 잰다
  ok('단리 MDD를 날짜를 걸으며 잰다', /for\(const d of days\)/.test(ds) && /mddCash:mdd\*100/.test(ds));
  ok('매수 단가는 raw 종가', /const rawAt=d=>/.test(ds) && /sh\+=B\[bi\]\[1\]\/p/.test(ds));
  ok('가격수익·현금수령총수익을 따로 낸다', /retPrice:/.test(ds) && /retCash:/.test(ds));
  ok('배당 없으면 null (화면에서 감춤)', /if\(!inWin\.length\) return null/.test(ds));
  // 기존 수익률(adjclose)은 절대 바뀌면 안 된다 — 앵커가 그걸 물고 있다
  let dc=''; try{ dc=extractFn(bt,'function _dcaOne(t,days,amt,step,costOn,dipMul)'); }catch(e){}
  ok('적립 결과에 div를 덧붙인다(기존 ret 불변)',
     /ret:inv>0\?\(fin\/inv-1\)\*100:0/.test(dc) && /div:_div/.test(dc));
  let bh=''; try{ bh=extractFn(bt,'function runBH(days,tkr,cap,costOn)'); }catch(e){}
  ok('거치(B&H)에도 분해를 붙인다', /divSplit\(tkr,days,\[\[days\[0\]/.test(bh));
  // 단리 선택 시에만 raw 경로 결과로 갈아끼운다 (배당 없는 종목은 두 경로가 같아 불변)
  let d1=''; try{ d1=extractFn(bt,'function _dcaOne(t,days,amt,step,costOn,dipMul)'); }catch(e){}
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
  ok('잔금 식에 출금·단리인출·단리보충 반영', /principal\+realized-inv-withdrawn-saved\+added/.test(ci));
  /* 단리는 사이클이 끝나면 계좌를 원금으로 되돌린다 — 양쪽 다.
     넘치면 빼고(saved) 모자라면 채운다(added). 한쪽만 하면 진 사이클 뒤로
     계좌가 원금보다 작은 채 굴러가 1회매수금이 줄고 전략이 저절로 약해진다. */
  ok('단리는 사이클 끝에 원금으로 맞춘다',
     /if\(simple\)\{[\s\S]{0,320}?if\(cashNow>P0\) saved\+=cashNow-P0;[\s\S]{0,80}?else if\(cashNow<P0\) added\+=P0-cashNow;/.test(ci));
  // 백테도 같은 규약이어야 한다 — 한쪽만 바꾸면 모의와 백테가 갈린다
  ok('백테도 원금으로 맞춘다',
     (bt.match(/else if\(cash<cap\)\{ addedCash\+=cap-cash; cash=cap; \}/g)||[]).length===4);
  ok('백테는 넣은 돈을 총자산에서 뺀다', /\+savedProfit-addedCash;/.test(bt));
  ok('단리 판정은 compound===false', /const simple=\(st\.compound===false\)/.test(ci));
  ok('출금·단리인출·단리보충을 밖으로 낸다', /withdrawn,saved,added,simple,outside:withdrawn\+saved/.test(ci));
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
  let ps=''; try{ ps=extractFn(idx,'function paperStat(tab, sess)'); }catch(e){}
  ok('성과표도 같은 기준', /price\*c\.qty \+ c\.bal \+ \(c\.outside\|\|0\)/.test(ps));
  // 입력·편집 경로
  ok('시트에 출금 항목·금액칸', /kindOptHTML\('출금'/.test(idx) && /id="sh_amt"/.test(idx));
  ok('편집에서도 출금 가능', /<option value="출금">/.test(idx) && /id="ei_amt"/.test(idx));
  /* 모의 성과표 — 단리는 익절금이 계좌 밖으로 빠져 있다. 평가금엔 더해 놨어도
     '얼마가 나갔는지'를 안 보이면 잔금이 왜 안 늘었는지 알 수 없다. */
  ok('성과표가 단리 인출액을 낸다', /_out=\{saved:c\.saved\|\|0, withdrawn:c\.withdrawn\|\|0, simple:!!c\.simple\}/.test(idx)
     && /nTrade, price, out:_out\}/.test(idx));
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
  ok('야후가 막히면 네이버로 물러난다', /if \(wantDiv\) \{ out\.dividends = \[\]; out\.splits = \[\]; out\.raw = kr\.series; \}/.test(q));
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
  ok('줄을 누르면 이동', /<tr class="jump" onclick="gotoSess\('\$\{r\.tab\}','\$\{r\.id\}'\)"/.test(idx)
     && /\.htable tr\.jump\{cursor:pointer\}/.test(idx));
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
  ok('줄 설명도 분석으로 바뀌었다', /title="이 세션의 분석으로"/.test(idx));
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
  ok('분석 그릴 때 같이 그린다', /function renderInfAnal\(\)\{\s*\n\s*const c=computeInf\(\), st=c\.st;\s*\n\s*renderInfBreak\(c\);/.test(idx));
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
  ok('원화 열은 달러 세션에서만', /isKrw=\(st\.cur==='krw'\)/.test(br)
     && /\$\{isKrw\?'':'<th>원화<\/th>'\}/.test(br));
  ok('빈 표 colspan이 열 수를 따라간다', /colspan="\$\{isKrw\?4:5\}"/.test(br));
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
     && /if\(cap!=null\)\{ const f=paperCapField\(tab,x\.settings\); if\(f\) x\.settings\[f\]=cap; \}/.test(ap));
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
  ok('백테: 별지점 주문을 따로 내림', /if\(c<=buyP\)\{ if\(_buy\(c,half\)>0\) T\+=0\.5; \}/.test(im));
  ok('백테: 평단 주문을 따로 내림',   /if\(c<=avg\) \{ if\(_buy\(c,half\)>0\) T\+=0\.5; \}/.test(im));
  ok('백테: 합산 후 일괄 내림이 안 남아 있다', !/if\(sp>0\)\{ if\(_buy\(c,sp\)>0\) T\+=ti; \}/.test(bt));
  // runIM50도 같은 규약이어야 한다 — 예전에 여기만 빠뜨려서 V5.0==V4.0 항등이 깨졌었다
  const n=(bt.match(/if\(c<=buyP\)\{ if\(_buy\(c,half\)>0\) T\+=0\.5; \}/g)||[]).length;
  ok('runIM·runIM50 둘 다 고쳐져 있다', n===2, n+'곳');
  // 운영 모의도 반드시 절반씩 따로 내림해야 한다 (한쪽만 고치면 다시 갈린다)
  const half=(idx.match(/put\('절반매수',d,cl,Math\.floor\(\(B\.amt\/2\)\/cl\)\)/g)||[]).length;
  ok('모의: 절반 주문 2건을 각각 내림', half===2, half+'곳');
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
  const krwLines=(idx.match(/\$\('(?:a_realized_krw|ana_realized_krw|anaI_realized_krw)'\)\.textContent=\(st\.cur==='krw'\)\?'':/g)||[]).length;
  ok('무매·이평·섀넌이 같은 원화 규약', krwLines===3, krwLines+'곳');
  const va=extractFn(idx,'function renderVrAnal()');
  ok('VR도 같은 원화 규약', /vc_profit_krw[\s\S]{0,80}st\.cur==='krw'/.test(va) && /won\(profit\)/.test(va));
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
  // 시세를 못 받은 줄은 평가~연 다섯 칸을 colspan 으로 덮는다 — 투입은 그 뒤에 따로 온다
  const iSpan=op.indexOf('colspan="5"'), iInflow=op.indexOf('${wnCur(r.inflow,r.cur)}');
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
  ok('세션 통화로 찍는다', /wnCur\(\+st\[f\]\|\|0, st\.cur\)/.test(vs));
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
  ok('둘 다 따로 적용한다', /paperCapField\(tab,x\.settings\); if\(f\) x\.settings\[f\]=cap;/.test(ap)
     && /paperAddField\(tab,x\.settings\); if\(f\) x\.settings\[f\]=add;/.test(ap));
  // 원화 세션에 10,000을 넣으면 ₩10,000이다 — 묻기 전에 알려야 한다
  ok('통화 규약을 미리 알린다', /각 세션의 통화로 그대로 들어갑니다/.test(ap));
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
      'function quoteOf(tab)',
      'function fmtT(t)','function isSell(k)','function isBuy(k)','function isCx(k)']
      .map(x=>{ try{ return extractFn(idx,x); }catch(e){ return ''; } }).filter(Boolean).join('\n');
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
      rowsOn:false,rows:8,gap:2.5,rowqty:1,compound:false,reverse:false,tgtDyn:false},o);
    const DAYS=Array.from({length:30},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'), close:90+i}));
    const many=(n,f)=>Array.from({length:n},(_,i)=>f(i));
    const CASES=[
      ['빈 세션(첫 매수)',       ST({}), [], 100],
      ['보유·전반전',            ST({}), [{kind:'1회매수',date:'2026-01-02',price:100,qty:5}], 95],
      ['보유·후반전',            ST({}), many(12,i=>({kind:'1회매수',date:'2026-01-0'+(i%9+1),price:100-i,qty:3})), 80],
      ['원금 소진',              ST({principal:500}), many(21,()=>({kind:'1회매수',date:'2026-02-01',price:20,qty:1})), 20],
      ['하방 LOC 켬',            ST({rowsOn:true,rows:3,rowqty:2}), [{kind:'1회매수',date:'2026-01-02',price:100,qty:5}], 95],
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
    ok('자동 주문이 확정 종가를 쓴다', /settledLast\(q\.series \|\| q\.ohlc \|\| \[\], st\.cur\)/.test(at_||''));

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
    ok('초당 제한을 피해 간격을 둔다', /await paceOrder\(\);/.test(at)
       && /const ORDER_GAP_MS = 1200;/.test(at));
    ok('간격은 세션을 넘어서도 이어진다',
       /let _lastOrderAt = 0;/.test(at)
       && /_lastOrderAt \? ORDER_GAP_MS - \(Date\.now\(\) - _lastOrderAt\) : 0/.test(at)
       && !/if \(i\) await sleep/.test(at));
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
    const t = src[f].replace(/'\$1'/g,'');
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
  ok('백테 — money 가 기호를 뒤에 붙인다', /fmt\(Math\.round\(x\)\)\+'\$'/.test(bt));
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
  ok('실현은 확정된 손익이다',    /put\('a_ret_real',\s*c\.realized\|\|0\);/.test(infA));
  ok('누적은 나간 돈을 포함한다', /put\('a_ret',\s*total - P\);/.test(infA)
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
  ok('시세 대기 줄이 칸 수를 맞춘다', /<td colspan="5" style="color:var\(--gold\)">시세 대기/.test(idx));
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
  ok('출금·입금·합계 순이다', (()=>{
    const i1=idx.indexOf('id="a_sv_out"'), i2=idx.indexOf('id="a_sv_in"'), i3=idx.indexOf('id="a_sv_net"');
    return i1>0 && i2>i1 && i3>i2; })());
  ok('합계는 출금 − 입금이다', /setv\('a_sv_net', out-inn,/.test(infA));
  ok('원금 대비 %를 같이 적는다', /const pct=v=>` \(\$\{\(v\/P0\*100\)\.toFixed\(1\)\}%\)`;/.test(infA));

  // 월 수입으로 읽히려면 셋이 더 필요하다
  ok('월 평균은 안 나온 달도 센다',
     /const avg=months\.reduce\(\(a,x\)=>a\+x\.v,0\)\/nM;/.test(infA) && /안 나온 달도 포함/.test(idx));
  ok('끊긴 달과 최장 연속을 센다',
     /let run=0, worst=0; for\(const x of months\)\{ if\(x\.v<=0\)\{run\+\+; worst=Math\.max\(worst,run\);\} else run=0; \}/.test(infA));
  ok('마지막 인출이 언제였는지 알린다', /id="a_sv_last"/.test(idx) && /개월 전/.test(infA));
  // 오래 끊기면 눈에 띄어야 한다
  ok('3개월 넘게 끊기면 빨갛게', /gap>=3 \? 'var\(--sell\)'/.test(infA));
  // 되짚기는 computeInf 와 같은 순서여야 값이 어긋나지 않는다
  ok('사이클 종료 시점을 같은 식으로 되짚는다',
     /const now=P0\+rz-wd-sv\+ad;/.test(infA) && /if\(now>P0\)\{[\s\S]{0,90}?else if\(now<P0\)/.test(infA));
}

console.log(`\n════ 결과: ${pass} PASS / ${fail} FAIL ${fail===0?'— ALL PASS ★':'— 배포 금지, 위 ✗ 항목 수정 필요'} ════`);
process.exit(fail===0?0:1);
