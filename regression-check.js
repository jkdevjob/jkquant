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

  ok('배당 포함 로더 존재', /async function fetchDailyDiv\(symbol\)/.test(idx) && /div=1/.test(idx));
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
  ok('잔금 식에 출금·단리적립 반영', /principal\+realized-inv-withdrawn-saved/.test(ci));
  ok('단리는 사이클 끝 초과익만 빼낸다', /if\(simple\)\{[\s\S]{0,260}?cashNow>\(\+st\.principal\|\|0\)\) saved\+=/.test(ci));
  ok('단리 판정은 compound===false', /const simple=\(st\.compound===false\)/.test(ci));
  ok('출금·단리적립을 밖으로 낸다', /withdrawn,saved,simple,outside:withdrawn\+saved/.test(ci));
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
     /applyAdminMode\(\);\s*\n\s*try\{ await window\.fb\.signOut/.test(idx));
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
     idx.indexOf("if(isBlocked(prof)){") < idx.indexOf("const ok=await pullRemote();")
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
  ok('백테 표 밀도', /\.cmp-tbl td\{padding:3px 5px;line-height:1\.25;/.test(bt)
     && /\.cmp-tbl th\{[^}]*padding:3px 5px;line-height:1\.2;[^}]*font-size:10px;\}/.test(bt)
     && /table\.cmp th,table\.cmp td\{padding:3px 5px;line-height:1\.25;/.test(bt));
  ok('관리자 표 밀도', /\.htable td\{padding:4px 4px;line-height:1\.25;/.test(adm), adm?'':'admin.html 없음');
  ok('단타 표 밀도', /\.htable td\{padding:3px 4px;line-height:1\.25;/.test(scal), scal?'':'scalping.html 없음');

  /* 날짜는 지우는 게 아니라 줄여 쓴다 — 2026-09-09 → 26-09-09 (81px→61px).
     수정창에는 원래 날짜가 그대로 뜨므로 잃는 정보가 없다. */
  ok('짧은 날짜 helper', /function dshort\(d\)\{ const t=String\(d\|\|''\); return \/\^\\d\{4\}-\\d\\d-\\d\\d\$\/\.test\(t\)\?t\.slice\(2\)/.test(idx));
  // 표 하나만 빠뜨리면 그 탭만 날짜 폭이 달라 열이 어긋나 보인다
  const n=(idx.match(/<td>\$\{dshort\((?:h|r)\.date\)\}/g)||[]).length;
  ok('모든 이력표가 짧은 날짜를 쓴다 (6개)', n===6, n+'개');
  ok('긴 날짜를 직접 찍는 표가 없다', !/<td>\$\{(?:h|r)\.date\|\|'-'\}/.test(idx));
}


/* ════ 25. 모의 성과 → 거래이력 이동 ════
   성과표에서 눈에 띈 세션을 보려고 탭·세션을 손으로 다시 찾아 들어가야 했다. */
console.log('[25] 모의 성과 → 거래이력 이동');
{
  ok('성과 줄이 어느 세션인지 안다', /return \{tab, id:sess\.id, name:sess\.name/.test(idx));
  ok('줄을 누르면 이동', /<tr class="jump" onclick="gotoSess\('\$\{r\.tab\}','\$\{r\.id\}'\)"/.test(idx)
     && /\.htable tr\.jump\{cursor:pointer\}/.test(idx));
  /* 순서가 핵심 — switchSess가 서브탭을 '현재'로 되돌리므로
     거래이력 열기가 그보다 먼저 오면 아무 일도 안 일어난 것처럼 보인다. */
  let gs=''; try{ gs=extractFn(idx,'function gotoSess(tab, id)'); }catch(e){}
  ok('이동 함수 존재', !!gs, gs?'':'gotoSess 없음');
  ok('탭 → 세션 → 서브탭 순서',
     gs.indexOf('tb.click()') < gs.indexOf('switchSess(id)')
     && gs.indexOf('switchSess(id)') < gs.indexOf("c.textContent.trim()==='거래이력'"), '순서 어긋남');
  // 서브탭 id가 탭마다 다르다 (inf-rec·vr-rec vs ma-hist·ivs-hist·dca-hist·asap-hist)
  ok('서브탭은 id가 아니라 이름으로 찾는다',
     /\[\.\.\.document\.querySelectorAll\(`#\$\{tab\} \.chip`\)\]\.find\(c=>c\.textContent\.trim\(\)==='거래이력'\)/.test(gs));
  ok('없는 세션이면 아무것도 안 한다', /if\(!box\.sessions\.some\(x=>x\.id===id\)\) return;/.test(gs));
  // 여섯 탭 모두 '거래이력' 칩이 있어야 이름 찾기가 성립한다
  const chips=(idx.match(/class="chip" data-b="[a-z]+-(?:rec|hist)">거래이력</g)||[]).length;
  ok('여섯 탭 모두 거래이력 칩이 있다', chips===6, chips+'개');
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
     && /list\.forEach\(\[?\(?\[,x\]\)?=>\{/.test(ap) && !/sessions\.forEach/.test(ap));
  ok('지우기 전에 묻는다', /if\(!confirm\(`모의 세션 \$\{list\.length\}개의 시작일을/.test(ap)
     && /기존 기록 \$\{nRec\}건을 지우고/.test(ap));
  /* 시작일을 옮기면 그때까지 만든 기록은 옛 시작일 산물이라 통째로 무효다.
     세션 편집(createSess)과 같은 키를 지워야 한다 — 하나라도 남으면 새 시작일과 옛 진행상태가 섞인다. */
  const KEYS=['simLast','cycStart','startCyc','cycLog'];
  ok('세션 편집과 같은 초기화 규약',
     KEYS.every(k=>new RegExp(`delete x\\.settings\\.${k};`).test(ap)) && /x\.settings\.startv=0;/.test(ap)
     && KEYS.every(k=>new RegExp(`delete t\\.settings\\.${k};`).test(idx)),
     KEYS.filter(k=>!new RegExp(`delete x\\.settings\\.${k};`).test(ap)).join(',')||'ok');
  ok('지운 자리를 다시 채운다', /save\(\); pushRemote\(\);\s*\n\s*await openPaper\(\);/.test(ap));
  ok('모의가 없으면 알리고 멈춘다', /if\(!list\.length\)\{ alert\('모의 세션이 없습니다\.'\); return; \}/.test(ap));
}


console.log(`\n════ 결과: ${pass} PASS / ${fail} FAIL ${fail===0?'— ALL PASS ★':'— 배포 금지, 위 ✗ 항목 수정 필요'} ════`);
process.exit(fail===0?0:1);
