#!/usr/bin/env node
'use strict';
/* 제15차 — 운영 메뉴 전 전략 점검(2026-11-09)에서 고친 것의 값 시험 + 변이 시험 (index v3.124.1 · 듀얼가드 v2.5.5 · 엔진 판 3).
 * 실제 페이지 함수를 뽑아 그대로 돌린다(재구현 없음). 옛 코드로 되돌리면(MUT) 빨간불이 나야 한다.
 *   R1 로테 장부 — 수량 없는 '청산' 기록은 전량 매도 (예전엔 통째로 무시 → 분석·포트폴리오가 다 판 세션을 보유로 셈)
 *   R2 로테 진입 수량 — 장부 현금 ÷ (가격×(1+수수료)) 내림 (모의 maReplay·백테 runMA200 과 같은 식 · 예전 원금÷가격)
 *   R3 로테 배수표 — 백테 META 와 같다 (SPYU 4 · 국내 2× · 1×)
 *   D1 기록 날짜 기본값 — 거래소 날짜 (개장 전 → 마지막 확정 봉 · 장중/마감 뒤 → 거래소 오늘 · 예전 UTC 오늘)
 *   D2 분배금 — 락일 당일 매수는 못 받는다 (백테·재생과 같다)
 *   D3 적립 로더 — 200일선·종가 표시는 체결가(raw) 계열 (백테와 같다 · 예전 adjclose)
 *   S1 섀넌 운영 수량식 — 배정금 ÷ (가격×(1+수수료)) (재생·백테와 같다)
 *   I1 무매 기록 시트 — 리버스 칸은 장부 상태(reverseActive) · 소진 보유 1~3주는 쿼터매도 0주 → 지정가만 · 리버스매수 수량은 주문가 기준 · 20일 창은 종가일 전날 · 1일차는 날로 넘긴다
 *   V1 VR — 재생 적립/인출 기록 auto · 사이클 시작일 = 기준일 · 날짜의 사이클 번호 · V 0 유지(startCyc>0) · 수정 때 수수료 재계산
 *   P1 듀얼가드 — 화면 장부 묶임(viewBoundSid) · 기준일 저장 · 거래일 날짜 · 모의 배당 세후(엔진 판 3)
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={idx:rd('index.html'),plan:rd('plan.html'),eng:rd('plan-session-engine.js'),bt:rd('backtest.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const constLine=(src,name)=>{const m=src.match(new RegExp('const '+name+'=[^\\n]*'));if(!m)throw Error('상수 없음: '+name);return m[0];};
const near=(a,b,tol=1e-6)=>Math.abs(a-b)<=tol;

/* 날짜를 고정한 Date — _exchNow 가 new Date()·Date.now 를 쓴다 */
function fixedDate(iso){const T=new Date(iso).getTime();const R=Date;return class extends R{constructor(...a){if(a.length)return new R(...a);return new R(T);}static now(){return T;}};}

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const idx=S.idx;

  // ── R1·R2 로테 장부·진입 수량
  { const FEE=0.0025;
    const maLedger=new Function('IVS_FEE',fnOf(idx,'function maLedger(')+'\nreturn maLedger;')(FEE);
    const imBuyQty=new Function(fnOf(idx,'function imBuyQty(')+'\nreturn imBuyQty;')();
    const maEntryQty=new Function('IVS_FEE','maLedger','imBuyQty',fnOf(idx,'function maEntryQty(')+'\nreturn maEntryQty;')(FEE,maLedger,imBuyQty);
    const A=maLedger([{type:'in',date:'2026-01-05',price:100,qty:100},{type:'out',date:'2026-03-02',price:120}],130,10000);
    t('R1 수량 없는 청산 = 전량 매도 — 보유 0 · 현금 11,945 (12,000 − 수수료 30 − 첫 매수 수수료 25) · 실현 +1,945',
      A.qty===0&&near(A.cash,11945,1e-6)&&near(A.realized,1945,1e-6)&&A.nOut===1,JSON.stringify({qty:A.qty,cash:A.cash,realized:A.realized,nOut:A.nOut}));
    const B=maLedger([{type:'in',date:'2026-01-05',price:100,qty:100},{type:'out',date:'2026-03-02',price:120,qty:40}],130,10000);
    t('R1 수량 있는 청산은 그 수량만 (보유 60)',B.qty===60&&near(B.cash,-25+4800-12,1e-6),JSON.stringify({qty:B.qty,cash:B.cash}));
    const C=maLedger([{type:'in',date:'2026-01-05',price:100,qty:100},{type:'out',date:'2026-03-02'}],130,10000);
    t('R1 가격 없는 기록은 건너뛴다 (보유 100 그대로)',C.qty===100,C.qty);
    const H=[{type:'in',date:'2026-01-05',price:30,qty:333},{type:'out',date:'2026-03-02',price:45,qty:333}];
    const E=maEntryQty(H,45,10000);
    t('R2 청산 뒤 재진입 수량 = 장부 현금 14,932.56 ÷ (45×1.0025) 내림 = 331주 (원금÷가격 222주 아님)',E.qty===331&&near(E.cash,14932.56,0.01),JSON.stringify(E));
    const E0=maEntryQty([],30,10000);
    t('R2 첫 진입도 수수료를 넣어 332주 (333주면 10,014.98 > 10,000)',E0.qty===332,E0.qty);
    const rec=fnOf(idx,'function maRecord(type)'),now=fnOf(idx,'function renderMaNow()');
    t('R2 기록 버튼·화면 안내가 같은 함수(maEntryQty)를 쓰고 원금÷가격이 없다',/maEntryQty\(/.test(rec)&&/maEntryQty\(/.test(now)&&!/Math\.floor\(\(st\.principal\|\|0\)\/price\)/.test(rec+now)&&/if\(held>0\) rec\.qty=held;/.test(rec));
    const edit=fnOf(idx,'function saveMaEdit()');
    t('R2 청산 기록을 고쳐도 수량을 지킨다',/const qty=\+\$\('em_qty'\)\.value; if\(qty>0\)rec\.qty=qty;/.test(edit)&&!/if\(type==='in'\)\{ const qty/.test(edit)); }

  // ── R3 배수표
  { const maLevOf=new Function(fnOf(idx,'function maLevOf(')+'\nreturn maLevOf;')();
    const metaSrc=S.bt.slice(S.bt.indexOf('const META={'),S.bt.indexOf('};',S.bt.indexOf('const META={'))+2);
    const META=new Function(metaSrc+'\nreturn META;')();
    const diff=Object.keys(META).filter(k=>maLevOf(k)!==META[k].lev);
    t('R3 로테 배수표 = 백테 META ('+Object.keys(META).length+'종목)',diff.length===0,diff.join());
    t('R3 국내 종목 .KS 꼬리와 모르는 종목 기본 3',maLevOf('418660.KS')===2&&maLevOf('ZZZZ')===3&&maLevOf('spyu')===4);
    t('R3 V5.0 국면(imRegime)도 같은 배수표',/const lev=maLevOf\(ticker\);/.test(fnOf(idx,'function imRegime('))); }

  // ── D1 기록 날짜 기본값
  { const src=constLine(idx,'MKT_CLOSE_MIN')+'\n'+constLine(idx,'SETTLE_LAG_MIN')+'\n'+fnOf(idx,'function _exchNow(cur)')+'\n'+fnOf(idx,'function simCutoff(cur)')+'\n'+fnOf(idx,'function settledBars(rows,cur)')+'\n'+fnOf(idx,'function settledLast(rows,cur)')+'\n'+fnOf(idx,'function tradeDateDefault(')+'\nreturn tradeDateDefault;';
    const at=iso=>new Function('Date',src)(fixedDate(iso));
    const days=[{date:'2026-11-06',close:1},{date:'2026-11-09',close:1}];
    t('D1 11/10 09:30 KST(미국 19:30 ET 전날 마감 뒤) → 11-09 (예전 UTC 오늘 11-10)',at('2026-11-10T00:30:00Z')('usd',days)==='2026-11-09');
    t('D1 11/10 12:00 KST → 11-09',at('2026-11-10T03:00:00Z')('usd')==='2026-11-09');
    t('D1 11/10 21:00 KST(미국 07:00 ET 개장 전) → 마지막 확정 봉 11-09',at('2026-11-10T12:00:00Z')('usd',days)==='2026-11-09');
    t('D1 개장 전 · 봉 없으면 직전 평일 (월요일 아침 → 금요일)',at('2026-11-09T12:00:00Z')('usd')==='2026-11-06');
    t('D1 미국 장중(11/11 00:00 KST = 11/10 10:00 ET) → 11-10',at('2026-11-10T15:00:00Z')('usd')==='2026-11-10');
    t('D1 11/10 07:00 KST(마감 뒤) → 11-09',at('2026-11-09T22:00:00Z')('usd')==='2026-11-09');
    t('D1 국내 08:30 KST → 전날 · 09:30 KST → 오늘',at('2026-11-10T23:30:00Z')('krw')==='2026-11-10'&&at('2026-11-11T00:30:00Z')('krw')==='2026-11-11');
    const users=['function openSheet()','function sheetSelInf(kind)','function sheetTvirtual()','function quickLadder(type,price,qty)','function vrFirstBuy()','function maRecord(type)','function maDivRecord()','function ivsRecord()','function ivsCash(kind)','function ivsAddMonthly()','function ivsSeed()','function saveIvsSeed()','function dcaRecord()','function asapRecord(kind)'];
    const left=users.filter(u=>{const b=fnOf(idx,u);return /toISOString\(\)\.slice\(0,10\)/.test(b)||!/recDateFor\(/.test(b);});
    t('D1 기록 함수 14곳이 전부 recDateFor 를 쓰고 UTC 오늘이 없다',left.length===0,left.join());
    t('D1 자동 채움 경고가 날짜를 맞추라고 한다(정산 대기 안내는 괄호로)',/LOC 체결은 종가 날짜의 거래입니다 — 날짜를 \$\{g\.closeDate\.slice\(5\)\.replace\('-','\/'\)\}로 맞추세요/.test(fnOf(idx,'function sheetSelInf(kind)')));
    const pl=S.plan;
    t('P1 듀얼가드도 거래일 날짜 — tradeDateDefault 를 체결·현금 기록 기본값에',/function tradeDateDefault\(\)/.test(pl)&&/\$\('alphaFillDate'\)\.value=tradeDateDefault\(\);/.test(pl)&&/\$\("alphaCashDate"\)\.value=tradeDateDefault\(\);/.test(pl)); }

  // ── D2 분배금 락일 당일 매수
  { const divIncome=new Function(fnOf(idx,'function divIncome(')+'\nreturn divIncome;')();
    const divs=[{date:'2026-03-10',amount:1}];
    const a=divIncome(divs,[{date:'2026-03-10',q:100}],false), b=divIncome(divs,[{date:'2026-03-09',q:100}],false);
    t('D2 락일 당일 매수 100주 → 0 · 전날 매수 → 100',a.divCash===0&&b.divCash===100,JSON.stringify([a.divCash,b.divCash]));
    t('D2 적립(computeDca)도 같은 규약',/buys\[bi\]\.date<d\.date/.test(fnOf(idx,'function computeDca()'))&&!/buys\[bi\]\.date<=d\.date/.test(fnOf(idx,'function computeDca()'))); }

  // ── D3 적립 로더 — 체결가 계열
  { const f=fnOf(idx,'async function _fetchDailyDivRaw(symbol)');
    const j={series:[{date:'2026-01-02',close:9.5},{date:'2026-01-05',close:9.6}],raw:[{date:'2026-01-02',close:10},{date:'2026-01-05',close:10.1}],last:{date:'2026-01-05',close:9.6},dividends:[{date:'2026-01-05',amount:.1}],splits:[],price:10.2,currency:'USD'};
    const run=async(jj)=>new Function('fetchT','fetchDaily','QUOTE_TRY_MS','encodeURIComponent',f+'\nreturn _fetchDailyDivRaw;')(async()=>({ok:true,json:async()=>jj}),async()=>null,[1],encodeURIComponent)('USD');
    return (async()=>{
      const q=await run(j);
      t('D3 days = raw(체결가) 10 · 10.1 · daysAdj = adjclose · priceBasis trade · last 는 체결가 종가',q.days[0].close===10&&q.days[1].close===10.1&&q.daysAdj[0].close===9.5&&q.priceBasis==='trade'&&q.last.close===10.1&&q.price===10.2,JSON.stringify({d:q.days,a:q.daysAdj,b:q.priceBasis,l:q.last}));
      const q2=await run({...j,raw:[]});
      t('D3 raw 가 없으면(폴백) 조정 계열 그대로',q2.days[0].close===9.5&&q2.priceBasis==='adjusted');
      return afterD3();
    })();
  }
  function afterD3(){
  // ── S1 섀넌 수량식
  { const ci=fnOf(idx,'function computeIvs()');
    t('S1 운영 주문·이번 달 투입 수량이 imBuyQty(배정금 ÷ (가격×(1+수수료)))',(ci.match(/imBuyQty\(/g)||[]).length>=4&&!/\(1-IVS_FEE\)\/price/.test(ci));
    const imBuyQty=new Function(fnOf(idx,'function imBuyQty(')+'\nreturn imBuyQty;')();
    t('S1 경계값 — 현금 10,000 · 가격 99.7503 → 100주 (옛 식 99주)',imBuyQty(10000,99.7503,.0025)===100&&Math.floor(10000*(1-.0025)/99.7503)===99); }

  // ── I1 무매 기록 시트 (실 computeInf·infSuggest·sheetInfHTML)
  { const scope=(settings,hist,quoteDays,sheetDate)=>{
      const e={settings,hist};const quote={symbol:settings.ticker,price:999,days:quoteDays};const els={};
      const ctx=vm.createContext({console,curStrat:()=>e,quoteOf:()=>quote,infSettledLast:()=>quote.days[quote.days.length-1],curOf:()=>'usd',inputNum:()=>0,
        curCurrency:()=>'usd',sheetTprev:()=>{},nfix:(v,n)=>(+v).toFixed(n),SETTLE_LAG_MIN:30,settledBars:r=>r,document:{querySelectorAll:()=>[]},
        recDateFor:()=>sheetDate,$:id=>els[id]||(els[id]={value:id==='sh_date'?sheetDate:'',style:{},innerHTML:'',scrollIntoView(){}}),wn:v=>'$'+(+v).toFixed(2),infChartData:null});
      const names=['computeInf','infRecordState','infRecordBuy','infSuggest','sheetInfHTML','sheetSelInf','fieldPriceQty','kindOptHTML','fmtT','imBuy1','imBuyOrders','imBigPct','imRowsOf','imTickRound','vrTick','vrTickDn','imStarPx','imBuyPx',
        'starPct','reverseT','isBuy','isSell','isAmtKind','imCycleEnds','imDayOpenAfter','revSupported','revEnabled','imRevBuyQty','infRevDay1','imRevOrders','revGapOf','imMomAt','imTgtOf','calcStarPoint','exitMulOf','imRevExitDue'];
      const at=idx.indexOf('const KIND_T=');
      vm.runInContext(idx.slice(at,idx.indexOf('};',at)+2)+'\nconst REV_DIVS=[20,40], IM_BIG_DEFAULT=20, IM_ROWS_DEFAULT=3, REV_GAP_DEF=0, IM_MOM_LEN=20, IM_MOM_TH=8, IM_MOM_CAP=30; let _infReplayAsOf="", _infResume=null;\nconst isCx=k=>k.includes("+");\n'
        +names.map(n=>fnOf(idx,'function '+n+'(')).join('\n'),ctx);
      return ctx; };
    const d=i=>'2026-10-'+String(20+i).padStart(2,'0');   // 10-20 ~ 10-26 평일 가정(날짜 비교만 쓴다)
    // (a) 소진 + 보유 3주 — 쿼터매도 0주 → 지정가매도 3주 추천
    { const c=scope({ticker:'SOXL',div:20,target:10,principal:10000,reverse:false},[{date:d(1),kind:'1회매수',price:100,qty:3,tManual:19.5}],[{date:d(1),close:100},{date:d(2),close:101}],d(2));
      const h=c.sheetInfHTML(d(2));
      t('I1 소진 보유 3주 — 추천 지정가매도 3주 · 쿼터매도 1주 추천 없음 · 소진 문구 T>19',/<div class="rmain">지정가매도<\/div>/.test(h)&&/sheetPickInf\('지정가매도',110,3\)/.test(h)&&!/쿼터매도 1주/.test(h)&&/T=19\.5>19/.test(h),h.match(/<div class="rmain">[^<]*/)&&h.match(/<div class="rmain">[^<]*/)[0]); }
    // (b) 리버스 진행 중(첫 리버스매도 뒤 T 17.55 ≤ 19) — 리버스 칸이 남아 있다
    { const c=scope({ticker:'SOXL',div:20,target:20,principal:10600.1,reverse:true},[{date:d(1),kind:'1회매수',price:70,qty:100,tManual:19.5},{date:d(2),kind:'리버스매도',price:60,qty:10}],
        [{date:d(0),close:60.01},{date:d(1),close:60.01},{date:d(2),close:60.01},{date:d(3),close:60.01},{date:d(4),close:60.01},{date:d(5),close:50}],d(5));
      const st=c.computeInf();
      t('I1 장부 — 리버스 진행 중 T 17.55 · reverseActive',st.reverseActive===true&&near(st.T,17.55,1e-9),JSON.stringify({T:st.T,r:st.reverseActive}));
      const h=c.sheetInfHTML(d(5));
      t('I1 리버스 진행 중이면 T 가 19 아래여도 리버스매도·리버스매수 칸이 있다',/data-kind="리버스매도"/.test(h)&&/data-kind="리버스매수"/.test(h)&&!/data-kind="1회매수"/.test(h)); }
    // (c) 리버스 2일차 쿼터매수 자동 채움 — 주문가(별지점 −0.01)로 센 15주 · 종가가 주문가 위면 0
    { const mk=close=>scope({ticker:'SOXL',div:20,target:20,principal:10600.1,reverse:true},[{date:d(1),kind:'1회매수',price:70,qty:100,tManual:19.5}],
        [{date:d(0),close:60.01},{date:d(1),close:60.01},{date:d(2),close:60.01},{date:d(3),close:60.01},{date:d(4),close:60.01},{date:d(5),close}],d(5));
      const c=mk(50), st=c.computeInf();
      t('I1 장부 — 소진(T 19.5) · DAY1 · 잔금 3,600.1',st.reverseActive===true&&st.reverseDay1===true&&near(st.bal,3600.1,1e-6),JSON.stringify({T:st.T,d1:st.reverseDay1,bal:st.bal}));
      const g=c.infSuggest('리버스매수');
      t('I1 10-25 체결(소진일 10-21 뒤) — 1일차 아님 · 쿼터매수 = 잔금÷4 900.025 ÷ 주문가 60.00 = 15주 (종가 50 으로 세면 18주)',g&&g.qty===15&&g.price===50,JSON.stringify(g&&{qty:g.qty,price:g.price}));
      const g2=mk(61).infSuggest('리버스매수');
      t('I1 종가 61 > 주문가 60.00 — 미체결이라 수량 0',g2&&g2.qty===0,JSON.stringify(g2&&{qty:g2.qty}));
      const s=mk(61).infSuggest('리버스매도');
      t('I1 종가 61 ≥ 별지점 60.01 — 리버스매도 보유÷10 = 10주 · 종가 50 이면 0',s&&s.qty===10&&c.infSuggest('리버스매도').qty===0,JSON.stringify([s&&s.qty,c.infSuggest('리버스매도').qty])); }
    // (d) 1일차 판정은 날로 — 소진일과 같은 확정 종가면 1일차, 그 뒤면 아니다
    { const c=scope({ticker:'SOXL',div:20,target:20,principal:10600.1,reverse:true},[{date:d(1),kind:'1회매수',price:70,qty:100,tManual:19.5}],[{date:d(1),close:70},{date:d(2),close:65}],d(2));
      const st=c.computeInf();
      t('I1 infRevDay1 — 확정 종가 = 소진일 → 1일차 · 하루 뒤 → 2일차 · 리버스 아니면 false',c.infRevDay1(st,d(1))===true&&c.infRevDay1(st,d(2))===false&&c.infRevDay1({reverseDay1:false},d(2))===false);
      const R1=c.infSuggest('리버스매도');   // 10-22 체결(소진 10-21 다음 거래일) — 그 아침 확정 봉은 10-21 = 소진일 → 1일차
      t('I1 1일차 자동 채움 — 무조건 MOC 보유÷10 = 10주 (별지점 무관) · 가격은 그날 종가 65',R1&&R1.qty===10&&R1.price===65,JSON.stringify(R1&&{qty:R1.qty,price:R1.price}));
      const h=c.sheetInfHTML(d(2));
      t('I1 기록 시트 추천도 1일차 MOC 10주',/리버스 1일차 — 보유÷10 무조건 MOC 10주/.test(h),(h.match(/<div class="rsub">[^<]*/)||[''])[0]); }
    // (e) 20일 창 — 종가일 '전날' 까지
    { const days=Array.from({length:22},(_,i)=>({date:'2026-01-'+String(i+1).padStart(2,'0'),close:100+i}));   // 1/1~1/22 (1/22 종가 121)
      const c=scope({ticker:'SOXL',div:20,target:10,principal:10000},[],days,'2026-01-22');
      const mAt=c.imMomAt('2026-01-22'), mNow=c.imMomAt(null);
      t('I1 imMomAt(1/22) = 1/21 종가 120 / 1/1 종가 100 − 1 = +20% · imMomAt(null) = 1/22 종가 121 / 1/2 101 − 1',near(mAt,20,1e-9)&&near(mNow,(121/101-1)*100,1e-9),JSON.stringify([mAt,mNow])); }
    // (f) 모의 재생기 — 1일차도 날로
    t('I1 모의(infSimForward) 1일차 = 소진 다음 거래일 하루뿐',/const day1=revDay1 && !\(c\.revFrom && prevD && prevD>c\.revFrom\); revDay1=false;/.test(fnOf(idx,'function infSimForward(startFrom)'))&&/const isDay1 = infRevDay1\(c, _sl&&_sl\.date\);/.test(fnOf(idx,'function renderOrder()')));
  }

  // ── V1 VR
  { const vr=(settings,hist)=>new Function('curStrat',fnOf(idx,'function computeVr()')+'\nreturn computeVr();')(()=>({settings,hist}));
    const a=vr({startpool:0,startv:0,band:15},[{type:'buy',date:'2026-01-02',price:100,qty:10,fee:0,init:true,cyc:0},{type:'add',date:'2026-01-16',amt:100,cyc:1,auto:true}]);
    const b=vr({startpool:0,startv:0,band:15},[{type:'buy',date:'2026-01-02',price:100,qty:10,fee:0,init:true,cyc:0},{type:'add',date:'2026-01-16',amt:100,cyc:1}]);
    t('V1 computeVr — auto 적립은 사이클 시작 Pool(한도 밑천)에 들어간다 100 · auto 없으면 0',near(a.cycStartPool,100)&&near(b.cycStartPool,0),JSON.stringify([a.cycStartPool,b.cycStartPool]));
    const rp=fnOf(idx,'function vrReplay()');
    t('V1 재생 적립/인출 기록에 auto · 0 적립은 안 적음 · 새 사이클 시작일 = 기준일(due) · cycLog 에 from',/if\(TR\.actual>0\) rec\.push\(\{type:'add',date:d,amt:\+TR\.actual,cyc,sim:true,auto:true/.test(rp)&&/rec\.push\(\{type:'wd',date:d,amt:\+TR\.actual,cyc,sim:true,auto:true/.test(rp)&&/cycStartDate=due;cycBaseQty=shares/.test(rp)&&/cycLog\.push\(\{cyc, from:cycStartDate,/.test(rp));
    const vz=vr({startpool:100,startv:0,startCyc:3,band:15},[{type:'buy',date:'2026-01-02',price:100,qty:10,fee:0,init:true,cyc:3}]);
    t('V1 사이클을 넘긴 세션(startCyc 3)의 V 0 은 0 으로 둔다(첫 매수금 1,000 으로 되살리지 않음) · 새 세션은 첫 매수금',vz.V===0&&vr({startpool:0,startv:0,band:15},[{type:'buy',date:'2026-01-02',price:100,qty:10,fee:0,init:true,cyc:0}]).V===1000,JSON.stringify(vz.V));
    const vrCycOfDate=new Function(fnOf(idx,'function vrCycOfDate(')+'\nreturn vrCycOfDate;')();
    const c1={st:{cycStart:'2026-01-16',cycLog:[{cyc:0,from:'2026-01-02'}]},curCyc:1};
    t('V1 날짜의 사이클 — 1/15 → 0 · 1/16 → 1 · 1/20 → 1 · 시작일 모르면 지금 사이클',vrCycOfDate(c1,'2026-01-15')===0&&vrCycOfDate(c1,'2026-01-16')===1&&vrCycOfDate(c1,'2026-01-20')===1&&vrCycOfDate({st:{},curCyc:2},'2026-01-15')===2);
    const c2={st:{cycStart:'2026-01-30',cycLog:[{cyc:0,from:'2026-01-02'},{cyc:1,from:'2026-01-16'}]},curCyc:2};
    t('V1 두 사이클 전 날짜 → 그 사이클 (1/10 → 0 · 1/20 → 1 · 1/01 → 0)',vrCycOfDate(c2,'2026-01-10')===0&&vrCycOfDate(c2,'2026-01-20')===1&&vrCycOfDate(c2,'2026-01-01')===0);
    t('V1 손 기록(시트·예약표 탭)이 날짜의 사이클을 쓴다',/const curCyc=vrCycOfDate\(computeVr\(\),date\);/.test(fnOf(idx,'function sheetSaveVr()'))&&/cyc:vrCycOfDate\(c,date\)/.test(fnOf(idx,'function quickLadder(type,price,qty)')));
    t('V1 수정 때 수수료 재계산',/rec\.fee=\+\(price\*qty\*/.test(fnOf(idx,'function saveVrEdit()')));
    t('P1 듀얼가드 VR 진입도 기준일을 저장',/st\.cycStart=pendingVrCycle\.due\|\|pendingVrCycle\.date;/.test(S.plan)); }

  // ── P1 듀얼가드 — 화면 장부 묶임 · 모의 배당 세후
  { const pl=S.plan;
    t('P1 viewBoundSid — 선언 · 세션 보기 올릴 때 묶음(실전·모의) · 현재 투자중(apply)은 \'\' · sync 가드',/let viewBoundSid=null;/.test(pl)
      &&/viewBoundSid=x\.id;   \/\/ 이제 화면 장부는 이 세션 것/.test(fnOf(pl,'async function loadActiveAssetSessionView('))&&/viewBoundSid=x\.id;alphaSyncInputs\(\);renderAlphaLedger\(\);/.test(fnOf(pl,'async function loadActiveAssetSessionView('))
      &&/viewBoundSid='';/.test(fnOf(pl,'function apply(o)'))&&/viewBoundSid!==x\.id\)return false;/.test(fnOf(pl,'function syncActiveAssetSessionFromView()'))
      &&/alphaLedger=x\.ledger;viewBoundSid='';alphaSyncInputs\(\);localSave\(\);/.test(fnOf(pl,'async function createAssetSession()')));
    // 엔진 — 배당 세후
    const g={};new Function('globalThis','window',S.eng.replace(/typeof window!=='undefined'\?window:globalThis/,'arguments[0]'))(g,undefined);
    const E=g.JKPlanSessionEngine;
    t('P1 엔진 판 3 · DIV_TAX 0.154',E.VERSION===3&&E.DIV_TAX===.154,JSON.stringify([E.VERSION,E.DIV_TAX]));
    const N=300,rows=(p0)=>Array.from({length:N},(_,i)=>{const dt=new Date(Date.UTC(2025,0,1)+i*864e5);return {date:dt.toISOString().slice(0,10),close:p0*(1+0.0004*i)};});
    const tecl=rows(50),tqqq=rows(60),sgov=rows(100);
    const start=tecl[240].date,exDate=tecl[250].date;
    const R=E.replay({horizon:5,startDate:start,endDate:tecl[N-1].date,principal:20000,monthlyAdd:0,tecl,tqqq,sgov,teclDiv:[{date:exDate,amount:1}],tqqqDiv:[],sgovDiv:[]});
    const div=R.ledger.events.find(e=>e.type==='cash'&&e.kind==='div');
    const held=R.nav.find(n=>n.date===exDate), prev=R.nav[R.nav.findIndex(n=>n.date===exDate)-1];
    t('P1 모의 배당 = 보유 TECL × 1$ × (1 − 0.154) · 세전 아님',R.error===''&&!!div&&prev&&near(div.amount,prev.tecl*1*0.846,1e-6)&&prev.tecl>0,JSON.stringify({err:R.error,div:div&&div.amount,tecl:prev&&prev.tecl}));
  }
  return bad;
  }
}

const MUT=[
  ['R1 로테 장부: 수량 없는 청산 무시(옛 코드)','idx',s=>s.replace("      const sq=q>0?Math.min(q,qty):qty; if(!(sq>0)) return; const gross=pr*sq;","      if(!(q>0)) return; const sq=q>0?Math.min(q,qty):qty; const gross=pr*sq;")],
  ['R2 로테 진입: 원금÷가격(옛 코드)','idx',s=>s.replace("  return {qty:(price>0)?imBuyQty(L.cash, price, FEE):0, cash:L.cash, held:L.qty};","  return {qty:(price>0)?Math.floor((principal||0)/price):0, cash:L.cash, held:L.qty};")],
  ['R2 청산 기록에 수량 안 적음','idx',s=>s.replace("    rec={type:'out',date,price:+price,ts:Date.now()}; if(held>0) rec.qty=held;","    rec={type:'out',date,price:+price,ts:Date.now()};")],
  ['R3 배수표에서 SPYU 빠짐','idx',s=>s.replace("SPYU:4,","")],
  ['D1 기록 날짜: UTC 오늘(옛 코드)','idx',s=>s.replace("  if(n.min>=open) return n.date;\n  const sl=(days&&days.length)?settledLast(days,cur):null;","  return new Date().toISOString().slice(0,10);\n  const sl=(days&&days.length)?settledLast(days,cur):null;")],
  ['D1 적립 기록이 UTC 오늘로 돌아감','idx',s=>s.replace("  const date=recDateFor('dca');   // 거래소 날짜 (제15차)","  const date=new Date().toISOString().slice(0,10);")],
  ['D2 분배금: 락일 당일 매수도 받음(옛 코드)','idx',s=>s.replace("    while(li<lots.length && lots[li].date<d.date){ held+=lots[li].q; li++; }","    while(li<lots.length && lots[li].date<=d.date){ held+=lots[li].q; li++; }")],
  ['D3 적립 로더: adjclose 로 200일선(옛 코드)','idx',s=>s.replace("        const days=raw.length?raw:daysAdj;","        const days=daysAdj;")],
  ['S1 섀넌 수량식 (1−수수료)(옛 코드)','idx',s=>s.replace("      out.orderQty=imBuyQty(spend, price, IVS_FEE);","      out.orderQty=Math.floor(spend*(1-IVS_FEE)/price);")],
  ['I1 기록 시트: 리버스 칸을 T 로만 판정(옛 코드)','idx',s=>s.replace("  const reverse = !!c.reverseActive || (revEnabled(st) && c.T>st.div-1 && c.qty>0);","  const reverse = revEnabled(st) && c.T>st.div-1 && c.qty>0;")],
  ['I1 기록 시트: 쿼터매도 최소 1주 강제(옛 코드)','idx',s=>s.replace("    const q4=Math.floor(c.qty/4);\n    if(q4>0){","    const q4=Math.max(1,Math.floor(c.qty/4));\n    if(q4>0){")],
  ['I1 리버스매수 수량을 종가로 다시 셈(옛 코드)','idx',s=>s.replace("    '리버스매수':{price:close, qty:(RV&&RV.buy&&close<=RV.buy.price)?RV.buy.q:0},","    '리버스매수':{price:close, qty:imRevBuyQty(c.bal, close)},")],
  ['I1 1일차를 날로 안 넘김(옛 코드)','idx',s=>s.replace("  return !(d && c.revFrom && d>c.revFrom);","  return true;")],
  ['I1 20일 창이 종가일까지(옛 코드)','idx',s=>s.replace("  if(date) ds=ds.filter(d=>d&&d.date<date);\n","")],
  ['V1 재생 적립에 auto 없음(옛 코드)','idx',s=>s.replace("rec.push({type:'add',date:d,amt:+TR.actual,cyc,sim:true,auto:true,ts:rec.length+1});","rec.push({type:'add',date:d,amt:+TR.actual,cyc,sim:true,ts:rec.length+1});")],
  ['V1 재생 사이클 시작일 = 실제 거래일(옛 코드)','idx',s=>s.replace("cycStartDate=due;cycBaseQty=shares;cycSellFilled=0;cycBuyFilled=0;\n      if(isAccum)","cycStartDate=d;cycBaseQty=shares;cycSellFilled=0;cycBuyFilled=0;\n      if(isAccum)")],
  ['V1 V 0 을 첫 매수금으로 되살림(옛 코드)','idx',s=>s.replace("  let vSet=V>0||(+st.startCyc>0), sawBuy=false;","  let vSet=V>0, sawBuy=false;")],
  ['V1 손 기록 cyc = 지금 사이클(옛 코드)','idx',s=>s.replace("  if(!date||!st.cycStart||date>=st.cycStart) return cur;\n","  return cur;\n")],
  ['P1 viewBoundSid 가드 없음(옛 코드)','plan',s=>s.replace("  if(typeof viewBoundSid!=='undefined'&&viewBoundSid!==x.id)return false;\n","")],
  ['P1 듀얼가드 VR 진입: 실제 거래일 저장(옛 코드)','plan',s=>s.replace("st.cycStart=pendingVrCycle.due||pendingVrCycle.date;","st.cycStart=pendingVrCycle.date;")],
  ['P1 엔진 배당 세전(옛 코드)','eng',s=>s.replace("pos.SGOV*(div.SGOV.get(date)||0))*(1-DIV_TAX);","pos.SGOV*(div.SGOV.get(date)||0));")],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 제15차 운영 점검: 로테 장부·진입 수량·배수표 · 기록 날짜 · 분배금 락일 · 적립 체결가 계열 · 섀넌 수량식 · 무매 기록 시트(리버스·소진·20일 창·1일차) · VR(auto·기준일·사이클 번호·V 0·수수료) · 듀얼가드(장부 묶임·기준일·날짜·배당 세후)');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS ops audit · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
