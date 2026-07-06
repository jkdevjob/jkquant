#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════
   JK 퀀트 회귀 테스트 — 검증 1~6차의 핵심 체크를 한 번에 재실행
   사용법: node 회귀테스트.js [index.html경로] [backtest.html경로] [CSV디렉토리]
   기본값: /mnt/project/index.html /mnt/project/backtest.html /mnt/project
   원칙: 재구현 금지 — 실제 HTML에서 함수 원문을 추출해 그대로 실행.
   코드를 수정할 때마다 이 스크립트가 ALL PASS여야 배포.
   ════════════════════════════════════════════════════════════════════ */
const fs=require('fs'), path=require('path');
const [,, IDX='/mnt/project/index.html', BT='/mnt/project/backtest.html', CSVDIR='/mnt/project']=process.argv;
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
  extractFn(idx,'function starPct(ticker,div,T)'),
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
inject(`if(sellQty>0){ realized+=sellQty*(c-avg); cash+=sellQty*c; shares-=sellQty; T=divs>=40?T*0.95:T*0.9; }
        reverseDay1=false;`,
`if(sellQty>0){ __LOG('리버스매도',c,sellQty); realized+=sellQty*(c-avg); cash+=sellQty*c; shares-=sellQty; T=divs>=40?T*0.95:T*0.9; }
        reverseDay1=false;`,'r1');
inject(`if(c>=star5){
          const sellQty=Math.floor(shares/sellDiv);
          if(sellQty>0){ realized+=sellQty*(c-avg); cash+=sellQty*c; shares-=sellQty; T=divs>=40?T*0.95:T*0.9; }`,
`if(c>=star5){
          const sellQty=Math.floor(shares/sellDiv);
          if(sellQty>0){ __LOG('리버스매도',c,sellQty); realized+=sellQty*(c-avg); cash+=sellQty*c; shares-=sellQty; T=divs>=40?T*0.95:T*0.9; }`,'r2');
inject(`avg=(shares*avg+amt)/(shares+q); shares+=q; cash-=amt;
            T=T+(divs-T)*0.25;`,
`__LOG('리버스매수',c,q); avg=(shares*avg+amt)/(shares+q); shares+=q; cash-=amt;
            T=T+(divs-T)*0.25;`,'r3');
inject(`{realized+=q3*(tgt-avg);cash+=q3*tgt;shares-=q3;tpHit=true;}`,
`{__LOG('지정가매도',tgt,q3); realized+=q3*(tgt-avg);cash+=q3*tgt;shares-=q3;tpHit=true;}`,'tp');
inject(`{realized+=sell*(c-avg);cash+=sell*c;shares-=sell;qtHit=true;}`,
`{__LOG('쿼터매도',c,sell); realized+=sell*(c-avg);cash+=sell*c;shares-=sell;qtHit=true;}`,'qt');
inject(`if(shares===0&&T===0){shares+=one/c;avg=c;cash-=one;T+=1;}`,
`if(shares===0&&T===0){__LOG('1회매수',c,one/c); shares+=one/c;avg=c;cash-=one;T+=1;}`,'fb');
inject(`if(b>0){avg=(shares*avg+sp)/(shares+b);shares+=b;cash-=sp;T+=ti;}`,
`if(b>0){__LOG(ti===1?'1회매수':'절반매수',c,b); avg=(shares*avg+sp)/(shares+b);shares+=b;cash-=sp;T+=ti;}`,'hb');
inject(`if(c<=buyP){const q=one/c;avg=(shares*avg+one)/(shares+q);shares+=q;cash-=one;T+=1;}`,
`if(c<=buyP){const q=one/c;__LOG('1회매수',c,q); avg=(shares*avg+one)/(shares+q);shares+=q;cash-=one;T+=1;}`,'bb');
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
const btBase=new Function('tkr','return '+mBase[1]);
const btSlope=new Function('tkr','divs','return '+mSlope[1]);
const btExit=new Function('tkr','return '+mExit[1].replace(/\/\/.*$/,''));

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

/* ════ 2. 종목 계열 규약 (6차) — 두 도구 동일 + base↔복귀 짝 ════ */
console.log('[2] 종목 계열 규약 (index ↔ backtest)');
for(const tkr of ['TQQQ','SOXL','TECL','KORU']){
  for(const div of [20,40]){
    const iPct=starPct(tkr,div,3), bPct=btBase(tkr)-btSlope(tkr,div)*3;
    ok(`별% 일치: ${tkr} ${div}분할`, near(iPct,bPct), `index=${iPct} bt=${bPct}`);
  }
  const wantExit = btBase(tkr)===20?0.80:0.85;
  ok(`복귀기준↔base 짝: ${tkr}`, near(btExit(tkr),wantExit), `base=${btBase(tkr)} exit=${btExit(tkr)}`);
}

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
function parseCSV(p){
  const L=fs.readFileSync(p,'utf8').split('\n').filter(l=>l.trim());const rows=[];
  for(let i=1;i<L.length;i++){const cel=L[i].match(/("[^"]*"|[^,]+)/g);if(!cel||cel.length<5)continue;
    const cl=s=>s.replace(/"/g,'').replace(/\s/g,'').replace(/,/g,'');
    const d=cl(cel[0]);const c=+cl(cel[1]),o=+cl(cel[2]),h=+cl(cel[3]),lo=+cl(cel[4]);
    if(!c||!d.match(/^\d{4}-\d{2}-\d{2}$/))continue;rows.push([d,c,o,h,lo]);}
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

/* ════ 4b. V4.1 국면익절 (v1.72) — 앵커 + 워밍업 항등 ════ */
console.log('[4b] runIM41 V4.1 국면익절');
{
  eval(extractFn(bt,'function buildGateIM(tkr)'));
  eval(extractFn(bt,'function runIM41(days,tkr,cap,divs,targetPct,compound'));
  // (a) 데이터 불변 항등: 이력 200일 미만(워밍업)에서는 V4.1 == V4.0 완전 동일 (CSV 갱신에도 항상 성립)
  if(DAYS.SOXL){
    const d150=DAYS.SOXL.slice(0,150);
    const a=runIM(d150,'SOXL',10000,20,20,true), b=runIM41(d150,'SOXL',10000,20,20,true);
    ok('워밍업(<200일) 구간 V4.1==V4.0 항등', near(a.final,b.final,1e-9)&&a.cycles===b.cycles&&near(a.mdd,b.mdd,1e-9),
       `final ${a.final}/${b.final}`);
  }
  // (b) 앵커: 전체 이력·복리·원금 1만$ (2026-06-12자 CSV 기준 — CSV 갱신 시 앵커 재산출 필요)
  const A=[['SOXL',20,20,97944844067.50,74.29,70],
           ['TQQQ',40,10,1251904.85,72.03,46],
           ['TECL',20,20,3258167777.77,68.86,42]];
  for(const [tkr,div,tgt,fexp,mexp,cexp] of A){
    if(!DAYS[tkr]){ console.log('  (CSV 없음, 스킵: '+tkr+')'); continue; }
    const r=runIM41(DAYS[tkr],tkr,10000,div,tgt,true);
    ok(`${tkr} ${div}분할 ${tgt}% V4.1 앵커 (최종·MDD·사이클)`,
       near(r.final,fexp,0.05)&&near(r.mdd,mexp,0.01)&&r.cycles===cexp,
       `final ${r.final.toFixed(2)}/${fexp} mdd ${r.mdd.toFixed(2)}/${mexp} cyc ${r.cycles}/${cexp}`);
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
  const LEGACY_OK=new Set(['ih_kind','ih_tprev','ih_date','ih_price','ih_qty','ih_price_lbl','vh_typeseg','vh_pricewrap','vh_qtywrap','vh_amtwrap','vh_date','ve_fetchnote','cfgModal']); // 8차 판정: null가드 레거시(무해)
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
    const orph=[...refs].filter(r=>!ids.has(r)&&!LEGACY_OK.has(r)&&!/^sh_|^shv_/.test(r));
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
console.log(`\n════ 결과: ${pass} PASS / ${fail} FAIL ${fail===0?'— ALL PASS ★':'— 배포 금지, 위 ✗ 항목 수정 필요'} ════`);
process.exit(fail===0?0:1);
