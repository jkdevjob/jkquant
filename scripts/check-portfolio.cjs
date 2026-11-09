#!/usr/bin/env node
'use strict';
/* 💰 포트폴리오 · 운영 › 듀얼 가드 탭 · ASAP 숨김 (index v3.119.0 · plan v2.2.0 · 2026-11-09)
 * 사용자: "자산플랜의 듀얼가드를 운영메뉴로 옮기고 무매보다 왼쪽으로 / 자산플랜은 포트폴리오로 변경하고 운영에서 내가 실투자 하고 있는 것들에 대해
 *          자세히 볼수 있게 / 두전략 합친 결과와 투자상황 등등 한눈에 볼수 있게 / 운영메뉴 탭이 너무 꽉차면 제일 성과없는 asap 탭을 숨기고"
 * 실제 페이지·엔진 함수를 뽑아 그대로 돌린다(재구현 없음). 값 시험 + 변이(틀린 코드로 바꾸면 빨간불).
 *   A 장부 계산을 엔진으로 옮긴 것 — 옮기기 전 plan.html 코드와 결과가 같다(고정 + 무작위 600개) · plan.html 은 엔진을 부른다
 *   B 합계(pfSummary) — 원화 세션 환율 환산 · 시세 대기 줄은 0 으로 안 더함 · 나간 돈 · 비중
 *   C 듀얼 가드 줄(pfPlanRow) — 엔진 장부 × 시세 · 투입 = 시작금 + 입금 − 출금
 *   D 듀얼 가드 장부 목록(pfPlanLedgers) — 현재 투자중 + 실전 세션만(모의·폐지·빈 장부 제외) · 창이 보낸 최신 장부 우선
 *   E 실전 세션 채우기(paperFillAll({live:true})) — 모의 제외 · 기록 없는 세션 제외 · 모의 체결 안 만듦 · 상태줄 글자
 *   F 화면 구조 — 듀얼 가드 탭 맨 왼쪽 · S.activeTab 에 안 들어감 · ASAP 숨김 · 메뉴 포트폴리오 · 플랜 화면 창 모드
 *   G 플랜 창 → 바깥 알림(planEmbedPost) — 모의 장부는 안 보냄 · H 바깥이 받는 쪽 — 같은 출처·창·계정 · 모의 거절
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={idx:rd('index.html'),plan:rd('plan.html'),eng:rd('plan-session-engine.js'),acc:rd('jk-access.js'),ui:rd('jk-ui.js'),admin:rd('admin.html'),tax:rd('plan-tax-check.js')};
const PAGES=['index.html','plan.html','backtest.html','scalping.html','claude.html','ipo.html','realestate.html','job.html','settings.html','admin.html','tenbagger.html','workout.html','swim.html'];
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;
/* 옮기기 전 plan.html(v2.1.0 · main 81d5d2c)의 장부 계산 원문 그대로 — 엔진 ledgerEvents·ledgerCalc 가 이것과 같아야 한다 */
const OLD_LEDGER=`function alphaEventList(ledger=alphaLedger){
  return (Array.isArray(ledger&&ledger.events)?ledger.events:[]).map((e,i)=>({...e,_i:i}))
    .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||a._i-b._i);
}
function alphaLedgerCalc(ledger=alphaLedger){
  const b=ledger&&ledger.base?ledger.base:{};
  const S={
    tecl:Math.max(0,Math.floor(+b.tecl||0)),tqqq:Math.max(0,Math.floor(+b.tqqq||0)),sgov:Math.max(0,Math.floor(+b.sgov||0)),
    avgTecl:Number.isFinite(+b.avgTecl)&&+b.avgTecl>0?+b.avgTecl:null,avgTqqq:Number.isFinite(+b.avgTqqq)&&+b.avgTqqq>0?+b.avgTqqq:null,avgSgov:Number.isFinite(+b.avgSgov)&&+b.avgSgov>0?+b.avgSgov:null,
    cash:Number.isFinite(+b.cash)?+b.cash:0,minCash:Number.isFinite(+b.cash)?+b.cash:0,invalid:false,error:"",divIn:0,netFlow:0,tradePnl:{}
  };
  for(const e of alphaEventList(ledger)){
    /* 현금 기록 — 배당(분배금)·입금·출금. 매매가 아니다: 수량·평단은 그대로, 현금만 바뀐다.
       netFlow(입금−출금)는 밖에서 넣고 뺀 돈이라 성장이 아니다 — 목표 진행률의 시작점에 더한다. */
    if(e.type==='cash'){
      const amt=Math.max(0,+e.amount||0),k=e.kind==='wd'?'wd':e.kind==='dep'?'dep':'div';
      if(!(amt>0))continue;
      if(k==='wd'){S.cash-=amt;S.netFlow-=amt;}else{S.cash+=amt;if(k==='dep')S.netFlow+=amt;else S.divIn+=amt;}
      S.minCash=Math.min(S.minCash,S.cash);continue;
    }
    if(e.type==='reconcile'&&e.snapshot){
      S.tecl=Math.max(0,Math.floor(+e.snapshot.tecl||0));S.tqqq=Math.max(0,Math.floor(+e.snapshot.tqqq||0));S.sgov=Math.max(0,Math.floor(+e.snapshot.sgov||0));S.cash=Number.isFinite(+e.snapshot.cash)?+e.snapshot.cash:S.cash;
      S.avgTecl=Number.isFinite(+e.snapshot.avgTecl)&&+e.snapshot.avgTecl>0?+e.snapshot.avgTecl:null;S.avgTqqq=Number.isFinite(+e.snapshot.avgTqqq)&&+e.snapshot.avgTqqq>0?+e.snapshot.avgTqqq:null;S.avgSgov=Number.isFinite(+e.snapshot.avgSgov)&&+e.snapshot.avgSgov>0?+e.snapshot.avgSgov:null;continue;
    }
    if(e.type!=='trade')continue;
    const sym=String(e.symbol||'').toUpperCase(),q=Math.max(0,Math.floor(+e.qty||0)),p=Math.max(0,+e.price||0),fee=Math.max(0,+e.fee||0),k=sym==='TECL'?'tecl':sym==='TQQQ'?'tqqq':sym==='SGOV'?'sgov':null,ak=sym==='TECL'?'avgTecl':sym==='TQQQ'?'avgTqqq':sym==='SGOV'?'avgSgov':null;
    if(!k||!ak||!q||!(p>0))continue;
    if(e.side==='buy'){
      const oldQ=S[k],oldAvg=S[ak];
      S[ak]=oldQ===0?p:(Number.isFinite(oldAvg)?(oldQ*oldAvg+q*p)/(oldQ+q):null);
      S[k]+=q;S.cash-=q*p+fee;S.minCash=Math.min(S.minCash,S.cash);
    }else if(e.side==='sell'){
      /* 표시용 파생값: 평단이 사라지는 전량매도도 매도 직전 평단으로 계산한다.
         무매 거래이력과 같이 수수료 제외 손익이며 원본 체결·계좌 계산은 변경하지 않는다. */
      S.tradePnl[e._i]={profit:q<=S[k]&&Number.isFinite(S[ak])?(p-S[ak])*q:null,
        reason:q>S[k]?'이력 오류':!Number.isFinite(S[ak])?'평단 미등록':''};
      if(q>S[k]){S.invalid=true;S.error=String(e.date||'')+' '+sym+' 매도 '+q+'주 > 당시 보유 '+S[k]+'주';}
      S[k]=Math.max(0,S[k]-q);if(S[k]===0)S[ak]=null;S.cash+=q*p-fee;S.minCash=Math.min(S.minCash,S.cash);
    }
  }
  return S;
}`;
function rng(seed){let s=seed>>>0;return ()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};}
function fuzzLedger(r){
  const pick=a=>a[Math.floor(r()*a.length)],day=()=>'2026-'+String(1+Math.floor(r()*11)).padStart(2,'0')+'-'+String(1+Math.floor(r()*27)).padStart(2,'0');
  const base={date:'2026-01-02',tecl:Math.floor(r()*30),tqqq:Math.floor(r()*30),sgov:pick([0,5,10.7]),cash:pick([0,1000,20000,'5000',null]),
    avgTecl:pick([null,0,90,'95.5']),avgTqqq:pick([null,70]),avgSgov:pick([null,100.2,-1])};
  const ev=[];const n=Math.floor(r()*14);
  for(let i=0;i<n;i++){const k=r();
    if(k<0.55)ev.push({id:'t'+i,type:'trade',date:day(),symbol:pick(['TECL','TQQQ','SGOV','tecl','QQQ']),side:pick(['buy','sell','sell','x']),qty:pick([1,3,7,12,40,0,-2,2.6]),price:pick([50,98.875,101.2,0,'77']),fee:pick([0,0.1,1.25,undefined])});
    else if(k<0.85)ev.push({id:'c'+i,type:'cash',date:day(),kind:pick(['div','dep','wd','x']),amount:pick([3.5,500,-7,0,'250'])});
    else ev.push({id:'r'+i,type:'reconcile',date:day(),snapshot:pick([{tecl:9,tqqq:1,sgov:2,cash:900,avgTecl:42,avgTqqq:30,avgSgov:100},{tecl:'4',cash:null}])});}
  return {base,events:ev};
}
function loadEngine(src){const c={};c.window=c;vm.createContext(c);vm.runInContext(src,c);return c.JKPlanSessionEngine;}

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const E=loadEngine(S.eng);
  // ── A. 장부 계산 이동 — 옛 코드와 결과가 글자까지 같다
  { const O=new Function('alphaLedger',OLD_LEDGER+'\nreturn alphaLedgerCalc;')(null);
    const fixed=[
      {base:{date:'2026-01-02',tecl:10,tqqq:0,sgov:0,cash:5000,avgTecl:100},events:[
        {id:'1',type:'trade',date:'2026-01-02',symbol:'TECL',side:'buy',qty:10,price:120,fee:0},{id:'2',type:'cash',date:'2026-09-03',kind:'div',amount:3.5},
        {id:'3',type:'cash',date:'2026-09-04',kind:'dep',amount:1000},{id:'4',type:'cash',date:'2026-09-05',kind:'wd',amount:200},
        {id:'5',type:'trade',date:'2026-09-06',symbol:'TECL',side:'sell',qty:25,price:130,fee:1}]},
      {base:{},events:[]},null];
    const r=rng(20261109);const all=fixed.concat(Array.from({length:600},()=>fuzzLedger(r)));let diff=-1;
    for(let i=0;i<all.length;i++){if(JSON.stringify(O(all[i]))!==JSON.stringify(E.ledgerCalc(all[i]))){diff=i;break;}}
    t('A1 엔진 ledgerCalc = 옮기기 전 plan.html alphaLedgerCalc (고정 3 + 무작위 600 장부 · 결과 글자까지)',diff<0,diff>=0?JSON.stringify([all[diff],O(all[diff]),E.ledgerCalc(all[diff])]):null);
    const f0=E.ledgerCalc(fixed[0]);
    t('A2 값: 현금 5000−1200+3.5+1000−200+3249=7852.5 · 입출금 800 · 배당 3.5 · TECL 매도 25>20 → 장부 오류',near(f0.cash,7852.5)&&f0.netFlow===800&&near(f0.divIn,3.5)&&f0.invalid===true&&f0.tecl===0,JSON.stringify(f0));
    t('A3 plan.html 의 alphaEventList·alphaLedgerCalc 는 엔진을 부른다(계산 한 벌)',
      /function alphaEventList\(ledger=alphaLedger\)\{return JKPlanSessionEngine\.ledgerEvents\(ledger\);\}/.test(S.plan)
      &&/function alphaLedgerCalc\(ledger=alphaLedger\)\{return JKPlanSessionEngine\.ledgerCalc\(ledger\);\}/.test(S.plan)
      &&!/S\.tradePnl\[e\._i\]=/.test(S.plan));
    t('A4 엔진 캐시 판 6 — 플랜·운영 둘 다(새 함수를 옛 캐시 엔진으로 부르지 않게)',/plan-session-engine\.js\?v=6"/.test(S.plan)&&/plan-session-engine\.js\?v=6"/.test(S.idx)); }

  // ── B. 합계
  { const c={};vm.createContext(c);vm.runInContext(fnOf(S.idx,'function pfOutAmt(r)')+fnOf(S.idx,'function pfSummary(rows, fx)'),c);
    const rows=[{tab:'plan',cur:'usd',total:21671.76,inflow:20500,out:0},{tab:'dca',cur:'usd',total:228,inflow:400,out:{saved:0,withdrawn:0}},
      {tab:'inf',cur:'usd',total:1070,inflow:1000,out:{saved:50,withdrawn:20}},{tab:'ivs',cur:'krw',total:1400000,inflow:1120000,out:null},{tab:'vr',cur:'usd',total:999,inflow:1,pending:true}];
    const Z=c.pfSummary(rows,1400);
    t('B1 합계: 지금 23,899.76(나간 돈 70 별도) · 투입 22,700 · TR +5.594% · 시세 대기 1줄 제외',near(Z.now,23899.76)&&near(Z.out,70)&&near(Z.total,23969.76)&&near(Z.inflow,22700)&&near(Z.ret,(23969.76/22700-1)*100)&&Z.missing===1&&Z.parts.length===4,JSON.stringify({now:Z.now,out:Z.out,inflow:Z.inflow,ret:Z.ret,missing:Z.missing}));
    t('B2 비중은 지금 계좌 기준 — 듀얼 가드 90.68% · 원화 섀넌 4.18% · 합 100%',near(Z.parts[0].w,21671.76/23899.76)&&near(Z.parts[3].w,1000/23899.76)&&near(Z.parts.reduce((a,p)=>a+p.w,0),1),Z.parts.map(p=>p.w).join());
    const Z0=c.pfSummary(rows,0);
    t('B3 환율이 없으면 원화 줄은 0 으로 더하지 않고 뺀다(2줄 대기)',Z0.missing===2&&near(Z0.inflow,21900),JSON.stringify({m:Z0.missing,i:Z0.inflow}));
    t('B4 빈 목록 — 0 · 수익률 없음',(()=>{const z=c.pfSummary([],1400);return z.now===0&&z.ret===null&&z.parts.length===0;})()); }

  // ── C. 듀얼 가드 줄
  { const c={JKPlanSessionEngine:E,curOf:st=>/^\d{6}$/.test(String((st||{}).ticker||''))?'krw':'usd'};vm.createContext(c);
    vm.runInContext(fnOf(S.idx,'function pfPlanRow(L, Q, E)'),c);
    const L={key:'cur',id:'',name:'현재 투자중',start:20000,from:'2026-01-02',ledger:{base:{date:'2026-01-02',cash:20000},events:[
      {id:'a',type:'trade',date:'2026-01-05',symbol:'TECL',side:'buy',qty:64,price:95,fee:6.08},{id:'b',type:'trade',date:'2026-01-05',symbol:'TQQQ',side:'buy',qty:38,price:80,fee:3.04},
      {id:'c',type:'trade',date:'2026-01-05',symbol:'SGOV',side:'buy',qty:6,price:100.3,fee:0},{id:'d',type:'cash',kind:'dep',date:'2026-11-03',amount:500},{id:'e',type:'cash',kind:'wd',date:'2026-11-04',amount:100}]}};
    const Q={TECL:{price:98.875,last:{date:'2026-11-06',close:98}},TQQQ:{price:0,last:{date:'2026-11-06',close:62.2}},SGOV:{price:100.5,last:{date:'2026-11-05',close:100.4}}};
    const r=c.pfPlanRow(L,Q,E),cash=20000-64*95-6.08-38*80-3.04-6*100.3+500-100;
    t('C1 평가 = 현금 + TECL 64×98.875 + TQQQ 38×62.2(지금가 없으면 마지막 종가) + SGOV 6×100.5',near(r.total,cash+64*98.875+38*62.2+6*100.5)&&near(r.hold.cash,cash),JSON.stringify(r));
    t('C2 투입 = 시작 20,000 + 입금 500 − 출금 100 = 20,400 · 수익률 = 평가÷투입−1',r.inflow===20400&&near(r.ret,(r.total/20400-1)*100),r.inflow);
    t('C3 기준일 = 세 종목 마지막 종가 중 가장 이른 날 · 통화 USD · 시세 대기 아님',r.to==='2026-11-05'&&r.cur==='usd'&&r.pending===false&&r.out===0,JSON.stringify([r.to,r.cur,r.pending]));
    const r2=c.pfPlanRow(L,{TECL:{price:98},TQQQ:{price:62},SGOV:null},E);
    t('C4 보유한 종목 시세가 없으면 시세 대기(합계에서 빠진다)',r2.pending===true,r2.pending); }

  // ── D. 듀얼 가드 장부 목록
  { const c={planLiveDoc:{startCapital:'20,000',startDate:'2026-01-02',alphaLedger:{base:{cash:20000},events:[{id:'x',type:'trade',date:'2026-01-05',symbol:'TECL',side:'buy',qty:1,price:90,fee:0}]}},
      PF:{over:{}},S:{plan:{sessions:[
        {id:'live1',name:'실전 세션',horizon:5,paper:false,settings:{startCapital:5000,startDate:'2026-03-02'},ledger:{base:{cash:5000},events:[{id:'y',type:'cash',kind:'dep',date:'2026-04-01',amount:100}]}},
        {id:'paper1',name:'모의',horizon:5,paper:true,settings:{startCapital:9999},ledger:{base:{cash:9999,tecl:3},events:[{id:'z'}]}},
        {id:'old10',name:'10년',horizon:10,paper:false,settings:{startCapital:7777},ledger:{base:{cash:7777,tecl:2},events:[{id:'w'}]}},
        {id:'empty',name:'빈 장부',horizon:5,paper:false,settings:{startCapital:3000},ledger:{base:{cash:3000},events:[]}}]}},
      planPaperRetired:x=>!!(E.retiredReason&&E.retiredReason(x))};
    vm.createContext(c);vm.runInContext(fnOf(S.idx,'function pfNum(v)')+fnOf(S.idx,'function pfLedgerUsed(l)')+fnOf(S.idx,'function pfPlanLedgers()'),c);
    const a=c.pfPlanLedgers();
    t('D1 현재 투자중 + 실전 세션만 — 모의·10년(폐지)·빈 장부 제외 · 시작금 "20,000" → 20000',a.map(x=>x.key).join()==='cur,live1'&&a[0].start===20000&&a[1].start===5000&&a[1].from==='2026-03-02',JSON.stringify(a.map(x=>[x.key,x.start,x.from])));
    c.PF.over.cur={ledger:{base:{cash:1},events:[{id:'n',type:'trade',date:'2026-11-07',symbol:'SGOV',side:'buy',qty:1,price:100,fee:0}]},startCapital:21000,startDate:'2026-02-02'};
    const b=c.pfPlanLedgers();
    t('D2 듀얼 가드 창이 보낸 최신 장부·시작금을 쓴다(처음 읽은 사본보다 우선)',b[0].ledger===c.PF.over.cur.ledger&&b[0].start===21000&&b[0].from==='2026-02-02',JSON.stringify(b[0]));
    c.planLiveDoc=null;c.PF.over={};
    t('D3 듀얼 가드 원장이 없으면 현재 투자중 줄도 없다',c.pfPlanLedgers().map(x=>x.key).join()==='live1'); }

  // ── E. 실전 세션 채우기
  { const mk=()=>{const log={auto:0,vr:0,inf:0,loaders:[]};
      const S0={activeTab:'inf',inf:{active:'i1',sessions:[{id:'i1',paper:false,settings:{ticker:'SOXL'},hist:[{d:1}]},{id:'ip',paper:true,settings:{ticker:'SOXL'},hist:[{d:1}]},{id:'i0',paper:false,settings:{ticker:'SOXL'},hist:[]}]},
        dca:{active:'d1',sessions:[{id:'d1',paper:false,settings:{ticker:'TQQQ',mode:'dca'},hist:[{d:1}]}]},
        plan:{sessions:[{id:'pl',paper:false,horizon:5,settings:{},ledger:{base:{},events:[{id:1}]}},{id:'pp',paper:true,horizon:5,simStart:'2026-01-02',settings:{}}]}};
      const ctx={S:S0,_paperFilling:false,_fillQuoteCache:null,infChartData:[],vrChartData:[],lastQuote:{inf:{symbol:'SOXL'},dca:null,plan:null},
        infQuoteCache:null,maQuoteData:null,ivsQuoteData:null,ivsQuote1:null,dcaQuoteData:null,asapQuoteData:null,
        PAPER_TABS:[['inf','무한매수법'],['dca','매수적립'],['plan','듀얼 가드']],
        PAPER_CACHESYM:{inf:()=>'SOXL',dca:()=>'TQQQ'},PAPER_LOADERS:{inf:async f=>log.loaders.push('inf'),dca:async f=>log.loaders.push('dca')},
        fetchDaily:async s=>{(log.fd=log.fd||[]).push(s);return {};},fetchDailyDiv:async()=>({}),
        divCashOn:()=>false,warmDiv:async()=>{},ivsX1Of:x=>x,paperAuto:()=>{log.auto++;},vrSimForward:()=>{log.vr++;},infSimForward:()=>{log.inf++;},paperStart:()=>'2025-01-02',
        paperStat:(tab,x)=>({tab,id:x.id,price:tab==='dca'?0:10}),stratStatusHtml:(tab,x)=>'ST:'+tab+':'+x.id,
        planPaperRetired:()=>false,loadPlanPaperData:async()=>({}),replayPlanPaper:()=>({}),paperStatPlan:x=>({tab:'plan',id:x.id}),
        console:{error(){},warn(){}},Map,Promise,Set};
      vm.createContext(ctx);vm.runInContext(fnOf(S.idx,'async function paperBreathe()')+fnOf(S.idx,'async function paperPrefetchQuotes(opt)')+fnOf(S.idx,'async function paperFillAll(opt)'),ctx);
      return {ctx,log};};
    return Promise.resolve().then(async()=>{
      const A=mk(),rows=await A.ctx.paperFillAll({live:true});
      t('E1 실전 — 기록 있는 실전 세션만(무매 i1 · 적립 d1) · 모의·빈 세션·플랜 제외',rows.map(r=>r.tab+':'+r.id).join()==='inf:i1,dca:d1',rows.map(r=>r.tab+':'+r.id).join());
      t('E2 실전 — 모의 체결을 만들지 않는다(paperAuto·SimForward 0번)',A.log.auto===0&&A.log.vr===0&&A.log.inf===0,JSON.stringify(A.log));
      t('E3 실전 — 줄마다 운영 상태줄 글자(stratStatusHtml) · 시세 없으면 시세 대기',rows[0].status==='ST:inf:i1'&&rows[1].status==='ST:dca:d1'&&rows[1].pending===true&&!rows[0].pending,JSON.stringify(rows));
      t('E4 실전 — 시세 선취도 실전 세션 종목만(SOXL·TQQQ) · 플랜 세 종목 안 받음',JSON.stringify((A.log.fd||[]).sort())==='["SOXL","TQQQ"]',JSON.stringify(A.log.fd));
      t('E5 끝나면 탭·세션·재생 표시가 그대로',A.ctx.S.activeTab==='inf'&&A.ctx.S.inf.active==='i1'&&A.ctx._paperFilling===false&&A.ctx._fillQuoteCache===null);
      const B=mk(),rows2=await B.ctx.paperFillAll();
      t('E6 모의(기본) — 예전 그대로: 모의 세션(무매 ip · 플랜 pp)만 · 모의 체결을 굴린다 · 상태줄 글자 없음',rows2.map(r=>r.tab+':'+r.id).join()==='inf:ip,plan:pp'&&B.log.auto===1&&B.log.inf===1&&!rows2[0].status,rows2.map(r=>r.tab+':'+r.id).join()+' auto='+B.log.auto);
      return check2(S,t,E,bad);
    });
  }
}
function check2(S,t,E,bad){
  // ── F. 화면 구조
  { const tabs=(S.idx.match(/<div class="tabs">([\s\S]*?)<\/div>/)||['',''])[1],order=[...tabs.matchAll(/data-t="(\w+)"/g)].map(m=>m[1]).join();
    t('F1 운영 탭 순서 — 듀얼 가드 맨 왼쪽(무매보다 왼쪽) · ASAP 은 맨 끝에 남되 숨김',order==='dg,inf,vr,ma,ivs,dca,asap'&&/\.tab\[data-t="asap"\]:not\(\.on\)\{display:none\}/.test(S.idx),order);
    const st=fnOf(S.idx,'function setupTabs()'),od=fnOf(S.idx,'function openDualGuard(extra)'),sa=fnOf(S.idx,'function startApp()');
    t('F2 듀얼 가드 탭은 S.activeTab 에 안 들어간다 — 누르면 화면만 바꾸고(opView) 다른 탭이 지운다',
      /if\(t\.dataset\.t==='dg'\)\{ openDualGuard\(\); return; \}/.test(st)&&st.indexOf("openDualGuard(); return;")<st.indexOf('S.activeTab=t.dataset.t')&&/closeDualGuardView\(\);/.test(st)
      &&!/S\.activeTab\s*=/.test(od)&&/S\.opView='dg'/.test(od)&&/\/plan\?embed=1/.test(fnOf(S.idx,'function dgEnsureFrame(extra)')));
    t('F3 첫 화면 — ASAP 을 보고 있었어도 무한매수법 · 듀얼 가드를 보고 있었으면 듀얼 가드',/if\(S\.activeTab==='asap'\)S\.activeTab='inf';/.test(sa)&&/if\(S\.opView==='dg'\) openDualGuard\(\);/.test(sa)
      &&sa.indexOf("if(S.activeTab==='asap')S.activeTab='inf';")<sa.indexOf('const tb=document.querySelector'));
    t('F4 모의 목록 듀얼 가드 줄 → 운영 › 듀얼 가드 탭 안에서 그 세션(딥링크) · 다른 전략 줄은 듀얼 가드를 보고 있어도 그 탭으로',
      /openDualGuard\('session='\+encodeURIComponent\(id\)/.test(fnOf(S.idx,'function gotoSess(tab, id)'))&&/if\(S\.activeTab!==tab \|\| isDgView\(\)\)\{/.test(fnOf(S.idx,'function gotoSess(tab, id)')));
    const menuBad=PAGES.filter(f=>{const s=rd(f);return !/<a href="\/portfolio"[^>]*><span class="mi">💰<\/span>포트폴리오<\/a>/.test(s)||/>자산플랜<\/a>/.test(s);});
    t('F5 모든 페이지 메뉴: 자산플랜 → 💰 포트폴리오(/portfolio)',menuBad.length===0,menuBad.join());
    t('F6 메뉴 정책: 포트폴리오 20번 공개 · /plan 은 메뉴에서 숨기고 주소 권한만(듀얼 가드) · 머리말 이름',
      /\{path:'\/portfolio',label:'포트폴리오',mode:'public',order:20\}/.test(S.acc)&&/\{path:'\/plan',label:'듀얼 가드',mode:'public',order:21,navHidden:true\}/.test(S.acc)
      &&/'\/portfolio':'포트폴리오','\/plan':'듀얼 가드'/.test(S.ui)&&/\.filter\(x=>!x\.navHidden\)/.test(S.admin)&&/'\/portfolio':'💰'/.test(S.admin));
    t('F7 /portfolio 는 운영 앱이 그린다(모의 /paper 와 같은 방식) · 원장 읽은 뒤 채움',
      /if\(\/\^\\\/portfolio\\\/\?\$\/\.test\(location\.pathname\)\)\{\s*document\.body\.classList\.add\('portfoliopage'\)/.test(S.idx)
      &&(S.idx.match(/pfPageAuto\(\);/g)||[]).length>=2&&/body\.portfoliopage>div\.wrap>\*:not\(#pfPage\):not\(footer\)\{display:none!important\}/.test(S.idx)
      &&/body\.dgview:not\(\.portfoliopage\) \.wrap>footer/.test(S.idx));   // 듀얼 가드를 보던 채로 포트폴리오를 열어도 바닥글(버전)은 보인다
    // 플랜 화면 창 모드 — 머리 스크립트를 실제로 돌린다
    const head=(S.plan.match(/<script>\n\/\* 운영 › 듀얼 가드 탭 안[\s\S]*?<\/script>/)||[''])[0].replace(/^<script>|<\/script>$/g,'');
    const run=(search,inFrame)=>{const cls=new Set(),kids=[];const de={classList:{add:x=>cls.add(x)}};const w={};w.parent=inFrame?{}:w;
      const c={location:{search},window:w,document:{documentElement:de,createElement:()=>({}),head:{appendChild:x=>kids.push(x)}}};vm.createContext(c);vm.runInContext(head,c);return {embed:cls.has('embed'),base:kids[0]&&kids[0].target};};
    const a=run('?embed=1',true),b=run('?embed=1',false),d=run('?session=x',true);
    t('F8 플랜 화면 창 모드: 운영 탭 창 안 + ?embed=1 일 때만 머리말 숨김 · 링크는 바깥 창(_top) · 주소로 바로 열면 평소 화면',
      head.length>0&&a.embed&&a.base==='_top'&&!b.embed&&!d.embed&&/html\.embed \.jk-site-header,html\.embed \.wrap>\.top\{display:none!important\}/.test(S.plan),JSON.stringify([a,b,d]));
    t('F9 플랜 화면 이름 듀얼 가드 · 메뉴는 운영(cur)·포트폴리오',/<title>JK 투자 — 듀얼 가드<\/title>/.test(S.plan)&&/<a href="\/" class="cur"><span class="mi">🏠<\/span>운영<\/a>/.test(S.plan)); }

  // ── G. 플랜 창 → 바깥 알림
  { const sent=[];const mkc=(embed,sess)=>{const w={};w.parent={postMessage:(m,o)=>sent.push({m,o})};
      const c={document:{documentElement:{classList:{contains:x=>x==='embed'&&embed}}},window:w,location:{origin:'https://jk.example'},auth:{currentUser:{uid:'u1'}},
        activeAssetSession:()=>sess,alphaLedger:{base:{cash:1},events:[{id:'q'}]},cloneObj:v=>JSON.parse(JSON.stringify(v)),num:(id,f)=>id==='startCapital'?20000:f,$:id=>id==='startDate'?{value:'2026-01-02'}:null};
      vm.createContext(c);vm.runInContext(fnOf(S.plan,'function planEmbedPost(o)'),c);return c;};
    const o={date:'2026-11-06',orders:2,orderText:'TQQQ 매도 38주',need:true,guard:'OFF',guardFlip:true};
    mkc(true,null).planEmbedPost(o);mkc(true,{id:'p1',paper:true}).planEmbedPost(o);mkc(true,{id:'s9',paper:false}).planEmbedPost(o);mkc(false,null).planEmbedPost(o);mkc(true,null).planEmbedPost(null);
    const [m1,m2,m3]=sent.map(x=>x.m);
    t('G1 현재 투자중: key cur · 장부·시작금 같이 · 같은 출처로만',sent.length===3&&m1.type==='jk-dg'&&m1.key==='cur'&&m1.uid==='u1'&&!m1.paper&&m1.ledger&&m1.ledger.events.length===1&&m1.startCapital===20000&&sent[0].o==='https://jk.example'&&m1.strip.orders===2,JSON.stringify(sent));
    t('G2 모의 세션은 장부를 안 보낸다(paper 표시만) · 실전 세션은 그 세션 키로',m2&&m2.paper===true&&m2.key==='p1'&&m2.ledger===undefined&&m3&&m3.key==='s9'&&m3.ledger,JSON.stringify([m2,m3]));
    t('G3 창 밖(주소로 바로 연 화면)·불러오는 중(null)은 보내지 않는다 · 띠를 그릴 때마다 부른다',sent.length===3&&/if\(typeof planEmbedPost==='function'\)planEmbedPost\(o\);/.test(fnOf(S.plan,'function renderDualGuardStrip(o)'))); }

  // ── H. 바깥이 받는 쪽
  { const blk=S.idx.slice(S.idx.indexOf("window.addEventListener('message',e=>{"));const code=blk.slice(0,blk.indexOf('\n});')+4);
    let h=null;const frame={contentWindow:{}};const c={window:{addEventListener:(k,f)=>{if(k==='message')h=f;}},location:{origin:'https://jk.example'},dgFrameEl:frame,curUid:'u1',
      PF:{dg:{},over:{}},isPfPage:()=>false,pfRecalcPlan:()=>{},String};vm.createContext(c);vm.runInContext(code,c);
    const ev=(d,o={})=>h({origin:o.origin||'https://jk.example',source:o.source||frame.contentWindow,data:d});
    const good={type:'jk-dg',uid:'u1',key:'cur',paper:false,strip:{orders:1},ledger:{base:{},events:[]},startCapital:20000};
    if(h){ ev(good,{origin:'https://evil.example'});ev(good,{source:{}});ev({...good,uid:'u2'});ev({...good,paper:true,key:'p1'});ev({...good,type:'x'}); }
    t('H1 다른 출처·다른 창·다른 계정·모의·다른 종류는 버린다',!!h&&Object.keys(c.PF.dg).length===0&&Object.keys(c.PF.over).length===0,JSON.stringify(c.PF));
    if(h)ev(good);
    t('H2 우리 창 · 같은 계정 · 실전이면 오늘 판단과 최신 장부를 받는다',!!c.PF.dg.cur&&c.PF.dg.cur.strip.orders===1&&c.PF.over.cur&&c.PF.over.cur.startCapital===20000,JSON.stringify(c.PF));
    // 모의 세션을 보고 있다는 알림은 값은 안 받고 '보는 중' 표시만 — 오늘 칸이 '계산 중'에 멈춰 보이지 않게 이유를 적는다
    const c2={window:{addEventListener:(k,f)=>{if(k==='message')c2.h=f;}},location:{origin:'https://jk.example'},dgFrameEl:frame,curUid:'u1',PF:{dg:{},over:{},dgSeen:null},isPfPage:()=>false,pfRecalcPlan:()=>{},String};
    vm.createContext(c2);vm.runInContext(code,c2);if(c2.h)c2.h({origin:'https://jk.example',source:frame.contentWindow,data:{...good,paper:true,key:'p1'}});
    vm.runInContext(fnOf(S.idx,'function pfEsc(x)')+fnOf(S.idx,'function pfDgText(r)'),c2);
    const txt=c2.pfDgText({key:'cur',name:'현재 투자중'});
    t('H3 모의 세션 알림 → 값은 안 받고(dg·over 비어 있음) 오늘 칸에 "모의 세션 보는 중 — 「현재 투자중」 선택 시 표시"',
      Object.keys(c2.PF.dg).length===0&&Object.keys(c2.PF.over).length===0&&c2.PF.dgSeen&&c2.PF.dgSeen.paper===true&&txt.includes('모의 세션 보는 중')&&txt.includes('「현재 투자중」'),txt); }
  return check3(S,t,E,bad);
}
/* ── v2 (2026-11-09 사용자: "합친 평가액 추이와 합친 MDD, 올해 양도세 합산(250만원 공제는 사람당 한 번), 목표 비중(듀얼 가드 5/6 : 섀넌 1/6) 대비 표시") ── */
function check3(S,t,E,bad){
  const T=(()=>{const c={};c.window=c;vm.createContext(c);vm.runInContext(S.tax,c);return c.JKPlanTaxCheck;})();
  const helpers=['function pfOutAmt(r)','function pfPlanSeries(L, Q, E, row)','function pfCombine(rows, fx)','function pfOpTaxKrw(series, T, fx, year)','function pfApplyTax(rows, T, fxDays, year, E)',
    'function pfTaxSummary(rows, T, year)','function pfTargetView(Z)','function pfUsdPlain(v)','function pfCompact(v)','function pfNiceTicks(lo, hi, n)','function pfPct(v)','function pfEsc(x)','function pfChartHtml(C)','function pfMonthTable(C)'];
  const c={PF:{chartGeo:null},$:()=>({clientWidth:640}),Math,Object,Number,String,Set,Map,console:{warn(){}}};vm.createContext(c);
  vm.runInContext(helpers.map(m=>fnOf(S.idx,m)).join('\n')+'\n'+((S.idx.match(/const PF_TARGET=\{[^}]*\};/)||[''])[0]).replace('const PF_TARGET','var PF_TARGET'),c);
  // ── I. 운영 세션 날마다 값 — paperMdd 걸음이 그릇(_pfSeriesSink)에 넣는다 · 끝 값은 지금 시세 · 끝 날짜는 마지막 기록 날까지
  { const md=fnOf(S.idx,'function paperMdd(tab, sess, R, hist)');
    const days=[1,2,3,4,5].map(i=>({date:'2026-01-0'+i,close:10*i}));
    const hist=[{date:'2026-01-01'},{date:'2026-01-03'},{date:'2026-01-09'}];
    const raw=(tab,sess)=>{const n=sess.hist.length;return {inflow:100,qty:2,k:50,price:0,realized:n*5,out:{saved:n,withdrawn:0},turnover:0,cost:0};};
    const run=(withSink)=>new Function('PAPER_DAYS','PAPER_CACHESYM','paperRaw','ivsQuote1','console','paperAfterTaxAcc','PAPER_NOFEE_TABS',
      (withSink?'var _pfSeriesSink=[];':'')+md+'\nreturn {r:paperMdd("vr",{settings:{ticker:"SOXL"},hist:'+JSON.stringify(hist)+'},{qty1:0,price:77,inflow:100,total:999,realized:42,out:{saved:3,withdrawn:4}},'+JSON.stringify(hist)+'),sink:'+(withSink?'_pfSeriesSink':'null')+'};')(
      {vr:()=>days},{vr:()=>'SOXL'},raw,undefined,{error(){}},()=>({step(){},done(){return null;}}),new Set());
    const A=run(true),B=run(false),k=A.sink||[];
    t('I1 날마다 값: 총자산 = 주식×종가 + 나머지(k) · 투입 · 나간 돈 · 누적 실현손익(그날까지 기록)',k.length===6&&k[0].tot===2*10+50&&k[2].tot===2*30+50&&k[2].realized===10&&k[2].out===2&&k[1].inflow===100,JSON.stringify(k));
    t('I2 끝 값은 지금 시세(목록·카드와 같은 값) · 날짜는 종가 끝(01-05)보다 늦은 마지막 기록 날(01-09)',k[5]&&k[5].date==='2026-01-09'&&k[5].tot===999&&k[5].realized===42&&k[5].out===7,JSON.stringify(k[5]));
    t('I3 그릇이 없으면(모의 목록) 예전 그대로 — 결과 같음',JSON.stringify(A.r)===JSON.stringify(B.r)&&B.sink===null); }
  // ── M. 합친 추이 · MDD — 시간가중(새 세션이 들어온 날 섞임으로 가짜 낙폭을 만들지 않는다)
  { const d=i=>'2026-02-0'+i;
    const A={tab:'plan',cur:'usd',series:[1,2,3,4,5].map((i)=>({date:d(i),tot:[100,110,121,108.9,120][i-1],inflow:100,out:0}))};
    const B={tab:'ivs',cur:'usd',series:[{date:d(3),tot:1000,inflow:1000,out:0},{date:d(5),tot:1000,inflow:1000,out:0}]};
    const K={tab:'dca',cur:'krw',series:[{date:d(1),tot:140000,inflow:140000,out:0},{date:d(5),tot:140000,inflow:140000,out:0}]};
    const C=c.pfCombine([A,B,K],1400),day4=(108.9+1000+100)/(121+1000+100)-1;
    t('M1 시간가중: 새 세션(1,000$)이 들어온 날은 손실이 아니다 · 진짜 하락(−10%)만 희석돼 잡힌다',near(C.mdd,-day4*100,1e-9)&&C.mddPeak===d(3)&&C.mddTrough===d(4),JSON.stringify([C.mdd,-day4*100,C.mddPeak,C.mddTrough]));
    t('M2 줄마다 이월(그날 값 없으면 직전) · 원화 줄은 환율로 나눔 · 시작 전엔 0',C.points.length===5&&near(C.points[3].tot,108.9+1000+100)&&near(C.points[0].inflow,200)&&near(C.points[2].inflow,1200),JSON.stringify(C.points.map(p=>[p.tot,p.inflow])));
    t('M3 환율이 없으면 원화 줄은 빼고 합친다(0 으로 섞지 않음)',c.pfCombine([A,K],0).points.every(p=>p.inflow===100),'');
    t('M4 나간 돈 — 그림 평가액(now)은 지금 계좌 · 낙폭은 나간 돈 포함(tot)',(()=>{const R=c.pfCombine([{tab:'inf',cur:'usd',series:[{date:d(1),tot:100,inflow:100,out:0},{date:d(2),tot:100,inflow:100,out:30}]}],1);return R.points[1].now===70&&R.mdd===0;})()); }
  // ── N. 듀얼 가드 날마다 값 — 기록이 늘어나는 날마다 엔진 ledgerCalc · 투입 = 시작금 + 입금 − 출금 · 끝 = 지금 값
  { const days=k=>[1,2,3,4,5].map(i=>({date:'2026-03-0'+i,close:k*i}));
    const Q={TECL:{days:days(50)},TQQQ:{days:days(40)},SGOV:{days:[1,2,3,4,5].map(i=>({date:'2026-03-0'+i,close:100}))}};
    const L={start:1000,from:'2026-03-01',ledger:{base:{date:'2026-03-01',cash:1000},events:[
      {id:'b',type:'trade',date:'2026-03-02',symbol:'TECL',side:'buy',qty:5,price:100,fee:0.5},{id:'p',type:'cash',kind:'dep',date:'2026-03-04',amount:500},
      {id:'w',type:'cash',kind:'wd',date:'2026-03-07',amount:100}]}};
    const s1=c.pfPlanSeries(L,Q,E,{pending:false,total:4321,inflow:1400});
    t('N1 날마다: 03-02 체결 뒤 현금 499.5 + TECL 5×100 · 03-03 5×150 · 03-04 입금 → 투입 1,500',s1.length===6&&near(s1[1].tot,499.5+500)&&near(s1[2].tot,499.5+750)&&s1[3].inflow===1500&&s1[0].inflow===1000&&near(s1[0].tot,1000),JSON.stringify(s1));
    t('N2 끝 = 줄의 지금 값 · 종가 뒤(03-07) 출금 기록 → 그 날짜로 하나 더',s1[5].date==='2026-03-07'&&s1[5].tot===4321&&s1[5].inflow===1400&&s1[4].date==='2026-03-05',JSON.stringify(s1.slice(-2))); }
  // ── J. 올해 양도세 — 운영 줄 추정(결제일 해 · 결제일 환율) · 듀얼 가드는 플랜 세금 점검과 같은 계산 · 공제는 사람당 한 번
  { const fx=T.fxFn([{date:'2026-01-02',close:1000},{date:'2026-07-01',close:1100}]);
    const ser=[{date:'2026-06-01',realized:100},{date:'2026-06-02',realized:100},{date:'2026-12-30',realized:150},{date:'2026-12-31',realized:170}];
    const o=c.pfOpTaxKrw(ser,T,fx,'2026');
    t('J1 운영 줄: 06-01 매도 100$×1,000 + 12-30 매도 50$×1,100(결제 12-31) · 12-31 매도는 결제가 다음 해(01-04)라 뺌',near(o.krw,100*1000+50*1100)&&o.n===2,JSON.stringify(o));
    const rows=[{tab:'plan',tax:{exact:true,krw:2000000,n:3}},{tab:'ivs',tax:{est:true,krw:2000000,n:2}},{tab:'dca',tax:{domestic:true}},{tab:'inf',tax:{missing:true}},{tab:'dca',tax:{est:true,krw:0,n:0}}];
    const X=c.pfTaxSummary(rows,T,'2026');
    t('J2 공제 250만원은 합친 뒤 한 번: 400만 − 250만 = 150만 × 22% = 33만 · 듀얼 가드 밖 200만 · 국내 1 · 빠짐 1 · 매도 없는 줄은 표에서 뺌',X.total===4000000&&X.taxable===1500000&&near(X.tax,330000)&&X.other===2000000&&X.domestic===1&&X.skipped===1&&X.items.length===2&&X.room===-1500000,JSON.stringify(X));
    const L={base:{date:'2026-01-02',tecl:10,avgTecl:50,cash:0},events:[{id:'s',type:'trade',date:'2026-05-01',symbol:'TECL',side:'sell',qty:4,price:80,fee:0.32}]};
    const FX=[{date:'2026-01-02',close:1300},{date:'2026-05-04',close:1400}];
    const pr={tab:'plan',cur:'usd',ledgerRef:L,px:{TECL:90}},or={tab:'ivs',cur:'usd',series:[{date:'2026-05-01',realized:20}]},kr={tab:'dca',cur:'krw'};
    c.pfApplyTax([pr,or,kr],T,FX,'2026',E);
    const ref=T.check({ledger:L,prices:{TECL:90},fxSeries:FX,year:'2026',feeFn:E.alphaFee});
    t('J3 듀얼 가드 = plan-tax-check check(선입선출 원화 · 플랜 화면과 같은 값) · 운영 = 추정 · 국내 = 제외',pr.tax.exact&&near(pr.tax.krw,ref.realized.fifo)&&pr.tax.n===1&&or.tax.est&&near(or.tax.krw,20*1400)&&kr.tax.domestic===true,JSON.stringify([pr.tax,or.tax,ref.realized])); }
  // ── K. 목표 비중 5/6 : 1/6 — 두 전략 합 기준 모자람/넘침 · 무매가 끝나 옮길 때의 몫
  { const P=(tab,now,label)=>({r:{tab,label},now});
    const V=c.pfTargetView({parts:[P('plan',25000,'듀얼 가드'),P('inf',10000,'무한매수법'),P('dca',228,'매수적립')]});
    t('K1 섀넌 0 · 듀얼 가드 25,000 → 섀넌 4,166.67 모자람 · 무매 10,000 까지 옮기면 섀넌 +5,833.33 · 듀얼 가드 +4,166.67 · 적립은 목표 밖',
      V.wPlan===1&&near(V.gapIvs,25000/6)&&near(V.gapPlan,-25000/6)&&near(V.moveIvs,35000/6)&&near(V.movePlan,35000*5/6-25000)&&V.otherBy['매수적립']===228,JSON.stringify(V));
    const V2=c.pfTargetView({parts:[P('plan',25000,''),P('ivs',5000,'')]});
    t('K2 목표대로(25,000 : 5,000) → 모자람 0 · 무매 없으면 옮길 몫 없음',near(V2.gapIvs,0)&&near(V2.wIvs,1/6)&&V2.moveIvs===null,JSON.stringify(V2)); }
  // ── L. 그림 — 선 2개(평가액 · 투입) · 한 축 · 범례 · 낙폭 띠 · 값 상자는 textContent · 검증한 색
  { const C=c.pfCombine([{tab:'plan',cur:'usd',series:[{date:'2026-04-01',tot:100,inflow:100},{date:'2026-04-02',tot:120,inflow:100},{date:'2026-04-03',tot:90,inflow:100},{date:'2026-04-06',tot:95,inflow:100}]}],1);
    const html=c.pfChartHtml(C),bind=fnOf(S.idx,'function pfChartBind()');
    t('L1 그림: 평가액·투입 선 · 끝 값 표시 · 범례 · 최대 낙폭 띠(04-02→04-03 · −25%) · 접근 이름',/class="pf-line pf-in"/.test(html)&&/class="pf-line pf-val"/.test(html)&&/class="pf-end">\$95</.test(html)&&/합친 평가액\(지금 계좌\)/.test(html)&&/투입 원금/.test(html)&&/class="pf-band"/.test(html)&&/role="img"/.test(html)&&near(C.mdd,25)&&C.mddPeak==='2026-04-02',html.slice(0,200));
    t('L2 값 상자는 textContent 로만 · 손가락(pointerdown)·화살표 키로도 · 색은 검증한 쌍(#3987e5 · #c98500)',/textContent/.test(bind)&&!/innerHTML/.test(bind)&&/pointerdown/.test(bind)&&/ArrowLeft/.test(bind)&&/--pf-val:#3987e5;--pf-in:#c98500/.test(S.idx));
    t('L3 비중 막대는 무리 넷(듀얼 가드·섀넌·무매·그 밖)만 — 모든 짝이 갈리는 색(검증) · 2px 틈',/plan:\{label:'듀얼 가드',color:'#9085e9'\},ivs:\{label:'섀넌',color:'#d55181'\},inf:\{label:'무한매수법',color:'#008300'\}/.test(S.idx)&&/const PF_OTHER=\{label:'그 밖',color:'#c9cdd9'\};/.test(S.idx)&&/\.pf-bar\{display:flex;gap:2px;/.test(S.idx)&&!/PF_COLOR/.test(S.idx));
    t('L4 화면 배선: 합친 MDD 칸 · 추이 · 목표 · 양도세(세금 모듈 불러옴) · 환율 KRW=X',/합친 MDD/.test(fnOf(S.idx,'function pfRender()'))&&/pfChartHtml\(C\)/.test(fnOf(S.idx,'function pfRender()'))&&/pfTargetHtml\(V\)/.test(fnOf(S.idx,'function pfRender()'))&&/pfTaxHtml\(X,T\)/.test(fnOf(S.idx,'function pfRender()'))
      &&/<script src="\/plan-tax-check\.js\?v=1"><\/script>/.test(S.idx)&&/fetchDaily\('KRW=X'\)/.test(fnOf(S.idx,'async function pfRefresh(force)'))); }
  return bad;
}

const MUT=[
  ['엔진 장부: 배당도 입출금 순액에 넣음','eng',s=>s.replace("if(k==='wd'){S.cash-=amt;S.netFlow-=amt;}else{S.cash+=amt;if(k==='dep')S.netFlow+=amt;else S.divIn+=amt;}","if(k==='wd'){S.cash-=amt;S.netFlow-=amt;}else{S.cash+=amt;S.netFlow+=amt;if(k!=='dep')S.divIn+=amt;}")],
  ['합계: 원화 세션을 환율로 안 나눔','idx',s=>s.replace("let k=1; if(r.cur==='krw'){ if(!(+fx>0)){ missing++; continue; } k=1/(+fx); }","let k=1;")],
  ['합계: 시세 대기 줄을 그대로 더함','idx',s=>s.replace("if(!r||r.pending||!Number.isFinite(+r.total)){ missing++; continue; }","if(!r||!Number.isFinite(+r.total)){ missing++; continue; }")],
  ['합계: 나간 돈을 지금 계좌로 셈','idx',s=>s.replace("now+=t-o; out+=o;","now+=t; out+=o;")],
  ['듀얼 가드 줄: 투입에 입출금 빠짐','idx',s=>s.replace("inflow=Math.max(0,(+L.start||0)+(+c.netFlow||0))","inflow=Math.max(0,(+L.start||0))")],
  ['듀얼 가드 목록: 모의 세션도 넣음','idx',s=>s.replace("if(!x||x.paper||planPaperRetired(x)) continue;","if(!x||planPaperRetired(x)) continue;")],
  ['실전 채우기: 모의 세션도 넣음','idx',s=>s.replace("pick=x=>!!x&&(live?(!x.paper&&(x.hist||[]).length>0):!!x.paper)","pick=x=>!!x&&(live?((x.hist||[]).length>0):!!x.paper)")],
  ['실전 채우기: 모의 체결을 굴림','idx',s=>s.replace("if(!live){                          // 실전 세션엔 모의 체결을 만들지 않는다","if(true){")],
  ['듀얼 가드 탭이 무매 오른쪽','idx',s=>s.replace('    <button class="tab" data-t="dg">듀얼 가드</button>\n    <button class="tab on" data-t="inf">무한매수법</button>','    <button class="tab on" data-t="inf">무한매수법</button>\n    <button class="tab" data-t="dg">듀얼 가드</button>')],
  ['듀얼 가드가 S.activeTab 에 들어감','idx',s=>s.replace("  if(S.opView!=='dg'){ S.opView='dg'; save(); }","  S.activeTab='dg'; if(S.opView!=='dg'){ S.opView='dg'; save(); }")],
  ['ASAP 탭 다시 보임','idx',s=>s.replace('.tab[data-t="asap"]:not(.on){display:none}','.tab[data-t="asap"]:not(.on){}')],
  ['포트폴리오에서도 바닥글 숨김(듀얼 가드 보던 채)','idx',s=>s.replace('body.dgview:not(.portfoliopage) .wrap>footer','body.dgview .wrap>footer')],
  ['플랜 창: 모의 장부도 보냄','plan',s=>s.replace("if(!paper){msg.ledger=cloneObj(alphaLedger);","if(true){msg.ledger=cloneObj(alphaLedger);")],
  ['플랜 창 모드: 창 밖에서도 머리말 숨김','plan',s=>s.replace("if(!/[?&]embed=1(&|$)/.test(location.search)||window.parent===window) return;","if(!/[?&]embed=1(&|$)/.test(location.search)) return;")],
  ['받는 쪽: 모의도 받음','idx',s=>s.replace("if(d.paper){ if(isPfPage()) pfRender(); return; }","")],
  ['받는 쪽: 다른 계정도 받음','idx',s=>s.replace("if(!d||d.type!=='jk-dg'||!curUid||d.uid!==curUid) return;","if(!d||d.type!=='jk-dg') return;")],
  ['합친 MDD: 시간가중 대신 총자산÷투입','idx',s=>s.replace("if(prev&&prev.tot>0){ const r=(tot-(inflow-prev.inflow))/prev.tot-1; if(Number.isFinite(r)) idx*=1+r; }","idx=tot/inflow;")],
  ['양도세: 공제를 전략마다 뺌','idx',s=>s.replace("const taxable=Math.max(0,total-ded);","const taxable=items.reduce((a,it)=>a+Math.max(0,it.krw-ded),0);")],
  ['양도세: 결제일 대신 체결일 해','idx',s=>s.replace("const sd=T.settleDate(p.date);","const sd=p.date;")],
  ['목표: 듀얼 가드·섀넌 거꾸로','idx',s=>s.replace("const PF_TARGET={plan:5/6, ivs:1/6};","const PF_TARGET={plan:1/6, ivs:5/6};")],
  ['날마다 값: 끝 날짜를 종가 끝으로 고정','idx',s=>s.replace("const end={date:lastH>endD?lastH:endD, tot:R.total,","const end={date:endD, tot:R.total,")],
  ['듀얼 가드 추이: 입금을 투입에 안 넣음','idx',s=>s.replace("const inflow=Math.max(0,(+L.start||0)+(+st.netFlow||0)); if(!(inflow>0)) continue;","const inflow=Math.max(0,(+L.start||0)); if(!(inflow>0)) continue;")],
  ['합친 추이: 원화 줄을 환율 없이 섞음','idx',s=>s.replace("let k=1; if(r.cur==='krw'){ if(!(+fx>0)) continue; k=1/(+fx); }","let k=1;")],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 포트폴리오·듀얼 가드 탭: 장부 이동 = 옛 코드(603 장부) · 합계(환율·대기·나간 돈·비중) · 듀얼 가드 줄 · 장부 목록 · 실전 채우기(모의 제외·모의 체결 없음) · 탭 순서·ASAP 숨김·메뉴 · 창 모드 · 알림 주고받기');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS portfolio · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
