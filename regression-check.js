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
`{const __a=Math.min(cash, Math.max(cash/4, c));__LOG('리버스매수',c,__a/c);_buy(c,__a);}   // LOC=종가`,'r3');
inject(`{_sell(o>tgt?o:tgt,q3,SLIP);tpHit=true;}`,
`{const __px=o>tgt?o:tgt;__LOG('지정가매도',__px,q3);_sell(__px,q3,SLIP);tpHit=true;}`,'tp');
inject(`{_sell(c,sq,0);qtHit=true;}`,
`{__LOG('쿼터매도',c,sq);_sell(c,sq,0);qtHit=true;}`,'qt');
inject(`if(shares===0&&T===0){_buy(c,one);T+=1;}`,
`if(shares===0&&T===0){__LOG('1회매수',c,one/c);_buy(c,one);T+=1;}`,'fb');
inject(`if(sp>0){_buy(c,sp);T+=ti;}`,
`if(sp>0){__LOG(ti===1?'1회매수':'절반매수',c,sp/c);_buy(c,sp);T+=ti;}`,'hb');
inject(`}else{ if(c<=buyP){_buy(c,one);T+=1;} }`,
`}else{ if(c<=buyP){__LOG('1회매수',c,one/c);_buy(c,one);T+=1;} }`,'bb');
inject(`const fin=cash+shares*M[tkr][days[days.length-1]][C]+savedProfit;`,
`__FINAL({T,avg,shares,cash,realized,savedProfit});
  const fin=cash+shares*M[tkr][days[days.length-1]][C]+savedProfit;`,'fin');
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
  const btBal=finalState.cash+finalState.savedProfit;
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
  // v1.167에서 지정가매도 체결가를 max(익절가, 시가)로 바로잡아 최종값만 이동했다.
  // (MDD·사이클은 그대로 — 체결 '판정'은 안 바뀌고 '체결가'만 바뀐 게 확인됨)
  const A=[['SOXL',20,20,106916.88,54.11,35],
           ['TQQQ',40,10,26454.24,65.50,29],
           ['TECL',20,20,45505.63,42.07,14]];
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
  ok('VR 평가금은 확정 종가로 굳히지 않는다', /lastQuote\.vr/.test(ev) && !/settledLast\(/.test(ev));
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
  // 체결 '판정'은 그대로여야 한다 — 고가 터치로 판정하고 체결가만 시가로 올린다
  ok('익절 판정은 여전히 고가 터치', /hi>=tgt && qTp>0/.test(sim));
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


console.log(`\n════ 결과: ${pass} PASS / ${fail} FAIL ${fail===0?'— ALL PASS ★':'— 배포 금지, 위 ✗ 항목 수정 필요'} ════`);
process.exit(fail===0?0:1);
