#!/usr/bin/env node
'use strict';
/* 운영 '오늘 할 일' == 모의 재생 엔진이 그날 한 매매 — 하루씩 (섀넌 · 로테이션 · 적립 · 듀얼가드 기본 · 듀얼가드 공포 모드)
 * 2026-11-19 사용자: "운영 메뉴, 포트폴리오, 모의투자가 전략대로 제대로 코드가 구현되어 있는지 점검해봐"
 *
 * 모의 세션은 재생 엔진(ivsReplay · maReplay · _paperDca · plan-session-engine replay)으로 거래이력을 만들고, 그 엔진은 백테와 거래 단위로
 * 같다([105]·[107]·[112]~[114] · check-plan-*). 운영(실계좌) 화면은 다른 함수(computeIvs · computeMa+renderMaNow · computeDca · renderAlphaPlan)가
 * '오늘 할 일'을 센다. 여기서 둘을 하루씩 맞춘다:
 *   실계좌가 앱 말대로만 했다면 d 아침 장부 = 재생 기록 중 d 전날까지(+ 그날 배당락 배당) · 확정 봉 = d 전날 · 시세에는 d 장중 봉이 붙어 옴 ·
 *   현재가 = d 종가(장 마감 직전 MOC 를 넣는 순간). 이때 운영이 내라는 주문(종목 · 방향 · 주수)이 재생의 d 날 체결과 같아야 한다.
 *   운영 포트폴리오는 이 운영 함수와 엔진 장부(ledgerCalc)를 그대로 부른다(scripts/check-portfolio.cjs) — 따로 세지 않는다.
 * 시세: testdata/ 고정본(SOXL · TECL · TQQQ 2020-09-08~2026-08-27, 분할 보정) + 합성 분기 배당 · 합성 SGOV(달마다 분배) ·
 *       합성 VIX(= TQQQ 10일 실현 변동성 ÷ 3) · VXN(= VIX × 1.18). 두 구현에 같은 입력을 넣는 대조라 합성이어도 된다 —
 *       대신 공포 모드 무장 · 빠른 Guard · TECL 재가속이 실제로 일어났는지 따로 세어 빈 시험이 되지 않게 한다.
 * 실제 시세 전 구간(API · 2009~2026)으로도 같은 대조를 돌렸다(TEST_RESULTS.md 2026-11-19).
 * 이 대조로 찾아 고친 것(2026-11-19):
 *   ① 섀넌 운영 매수 주수 — 배정금×(1−수수료)÷가격 → 재생·백테와 같은 imBuyQty(배정금÷(가격×(1+수수료))). 경계에서 1주 적었다.
 *   ② 로테 운영 진입 수량(안내 · 🟢 진입 기록) — 원금÷가격 → 장부 현금 전액 imBuyQty(maEntryQty). 첫 청산 뒤엔 현금과 무관한 수량이었다.
 * 값 시험 + 변이(옛 코드 · 확정 봉 대신 오늘 봉 · 수수료 빼먹음 …)마다 빨간불인지 본다.
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const IDX0=fs.readFileSync(path.join(root,'index.html'),'utf8'),PL0=fs.readFileSync(path.join(root,'plan.html'),'utf8'),ENG=fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8');
const fnOf=(src,m)=>{const s=src.indexOf(m);if(s<0)throw new Error('없음: '+m);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw new Error('끝 없음: '+m);};
const declOf=(src,re)=>{const m=src.match(re);if(!m)throw new Error('선언 없음: '+re);return m[0].replace(/^const /,'var ');};
/* 함수 하나 안에서만 바꾼다(같은 줄이 여러 함수에 있을 때) — 바꿀 글자가 그 함수에 정확히 한 번 있어야 한다 */
const inFn=(src,marker,from,to)=>{const f=fnOf(src,marker);if(f.split(from).length!==2)throw new Error('변이 대상 '+marker+' · '+from);return src.replace(f,f.replace(from,to));};

/* ── 시세 ── */
const csv=f=>fs.readFileSync(path.join(root,'testdata',f+'.csv'),'utf8').trim().split(/\r?\n/).slice(1)
  .map(l=>{const [date,c,o,h,lw]=l.split(',');return {date,open:+o,high:+h,low:+lw,close:+c};}).filter(r=>r.close>0).sort((a,b)=>a.date<b.date?-1:1);
const RAW={SOXL:csv('SOXL'),TECL:csv('TECL'),TQQQ:csv('TQQQ')};
const DIVBASE={SOXL:.05,TECL:.08,TQQQ:.12};
/* 합성 분기 배당 — 3·6·9·12월 22일 이후 첫 거래일(배당락) · 금액은 분기마다 조금씩 */
function divsOf(rows,base){const out=[];let lastM='',q=0;for(const r of rows){const m=+r.date.slice(5,7),ym=r.date.slice(0,7);
  if(m%3===0&&+r.date.slice(8,10)>=22&&ym!==lastM){lastM=ym;out.push({date:r.date,amount:+(base*(1+.25*(q++%3))).toFixed(4)});}}return out;}
const DIVS={SOXL:divsOf(RAW.SOXL,DIVBASE.SOXL),TECL:divsOf(RAW.TECL,DIVBASE.TECL),TQQQ:divsOf(RAW.TQQQ,DIVBASE.TQQQ)};
/* /api/quote 모양(체결가 계열 · 배당 따로) */
function quoteJ(T){const rows=RAW[T],last=rows[rows.length-1];
  return {symbol:T,currency:'USD',src:'testdata',priceBasis:'trade',ohlcTrade:rows,series:rows.map(r=>({date:r.date,close:r.close})),ohlc:rows,dividends:DIVS[T],price:last.close,last:{date:last.date,close:last.close}};}
/* 합성 SGOV — 달 첫 거래일 100.00 에서 날마다 0.0142$ 씩 쌓이다 다음 달 첫 거래일에 쌓인 만큼 분배(배당락) */
const SGOV=[],SGOV_DIV=[];{let k=0,lastM='';for(const r of RAW.TECL){const m=r.date.slice(0,7);if(m!==lastM){if(lastM)SGOV_DIV.push({date:r.date,amount:+(.0142*k).toFixed(4)});k=0;lastM=m;}SGOV.push({date:r.date,close:+(100+.0142*k).toFixed(4)});k++;}}
/* 합성 VIX · VXN — TQQQ 10일 실현 변동성 ÷ 3 (2025-04 폭락에 76까지 · 2022 에 무장) */
const VIX=RAW.TQQQ.map((x,i,a)=>{if(i<10)return {date:x.date,close:20};let s=0,s2=0;for(let j=i-9;j<=i;j++){const r=a[j].close/a[j-1].close-1;s+=r;s2+=r*r;}
  const m=s/10,v=Math.max(0,s2/10-m*m);return {date:x.date,close:+(100*Math.sqrt(v*252)/3).toFixed(2)};});
const VXN=VIX.map(x=>({date:x.date,close:+(x.close*1.18).toFixed(2)}));

/* ── 운영·재생 함수 (index.html 원문 그대로) ── */
const IDX_FNS=['function quoteToDaily(SYM, j)','function divCashOn(st)','function isTradeBasis(Q)','function divPerShareQ(Q, d)','function divCashQ(Q, d, shares, taxOn)','function isKrCode(t)','function curOf(st)','function settledBars(rows,cur)','function imBuyQty(alloc, refPx, feeRate)',
  'function ivsX1Of(t)','function ivsPos(principal,hist)','function computeIvs()','function ivsReplay()',
  'function maLevOf(t)','function _maHold(sell,a,b)','function _maEntry(buy,a,b)','function maCond(st)','function computeMa()','function maReplay()','function maLedger(hist, price, principal)','function maEntryQty(st, hist, price)','function maRecord(type)',
  'function _dcaRawMap(raw)','function _dcaPriceView(days)','function computeDca()','function _clampFrom(from, lastDate)','function _lastTradingDay(days)','function _paperDca(sess, from)'];
function idxCtx(H){
  const c={CUT:'2099-12-31',FROM:'',SESS:null,ALERTS:[],confirm:()=>true,save:()=>{},saveLocal:()=>{},pushRemote:null,sortHist:()=>{},refreshIvs:()=>{},refreshMa:()=>{},
    px:v=>String(v),nfix:v=>String(v),inputNum:()=>0};
  c.alert=m=>{c.ALERTS.push(String(m));}; c.simCutoff=()=>c.CUT; c.curStrat=()=>c.SESS; c.$=()=>({value:c.FROM});
  vm.createContext(c);
  vm.runInContext([/const KR_CODE_RE=[^\n]*/,/const IVS_FEE=[^\n;]*;/,/const IVS_X1=\{[^}]*\};/,/const DCA_N=\d+;/,/const DCA_N_AUTO=\d+;/,/const DIV_TAXRATE=[^;]*;/].map(re=>declOf(H,re)).join('\n')+'\n'+IDX_FNS.map(m=>fnOf(H,m)).join('\n'),c);
  return c;
}
/* 하루 시세 — d 장중 봉까지 붙어 오고(시세 API 가 그렇다) 현재가 = d 종가. 판정은 확정 봉(CUT = d 전날)까지만 써야 한다 */
const dayQ=(Q,i)=>({...Q,days:Q.days.slice(0,i+1),price:Q.days[i].close});

/* 섀넌 — 운영 computeIvs 의 주문(방향 · 주수) == 재생 ivsReplay 의 그날 레버리지 체결 */
function ivs(H,T,st,fromIdx){
  const c=idxCtx(H),Q=c.quoteToDaily(T,quoteJ(T)),D=Q.days,from=D[fromIdx].date,name=`섀넌 ${T} s0 ${st.s0} · N ${st.look} · 밴드 ${st.band}${st.mode==='fix'?' · 고정 5:5':''}`;
  c.ivsQuoteData={...Q};c.ivsQuote1=null;c.FROM=from;c.CUT='2099-12-31';
  const sess={settings:{ticker:T,park:'bill',mode:'iv',principal:10000,monthly:0,divmode:'reinv',...st},hist:[],paper:true};c.SESS=sess;
  const okR=c.ivsReplay(),Hh=sess.hist.slice();
  if(okR===false||!Hh.length)return {name,ok:false,info:'재생 실패'};
  let n=0,nb=0,trd=0,divN=0;const bad=[];
  for(let i=fromIdx;i<D.length;i++){
    const d=D[i].date;
    c.SESS={settings:sess.settings,hist:Hh.filter(x=>x.date<d||(x.date===d&&x.type==='div'))};c.CUT=D[i-1].date;c.ivsQuoteData=dayQ(Q,i);
    if(Hh.some(x=>x.date===d&&x.type==='div'))divN++;
    const o=c.computeIvs();if(!o.ready)continue;n++;
    const tr=Hh.filter(x=>x.date===d&&x.leg==='lev'&&(x.type==='buy'||x.type==='sell'));
    const want=tr.length?tr[0].type+' '+tr.reduce((a,x)=>a+x.qty,0):'없음',got=(o.hit&&(o.orderQty||0)>=1)?o.side+' '+o.orderQty:'없음';
    if(tr.length)trd++;
    if(want!==got){nb++;if(bad.length<5)bad.push(`${d} 재생 ${want} · 운영 ${got}`);}
  }
  return {name:`${name} — ${from}~ ${n}일 운영 주문 == 재생 체결 (체결 ${trd}일 · 배당락 ${divN}일)`,ok:n>900&&trd>=10&&divN>=10&&nb===0,info:nb+'일 다름 · '+bad.join(' | ')};
}
/* 로테이션 — 운영 신호·보유(renderMaNow 의 진입/청산 판단)와 수량(진입 = maEntryQty · 청산 = 들고 있는 전부) == 재생 maReplay 의 그날 진입·청산 */
function ma(H,T,st,fromIdx){
  const c=idxCtx(H),Q=c.quoteToDaily(T,quoteJ(T)),D=Q.days,from=D[fromIdx].date,name=`로테 ${T} 매수 ${st.buy}·매도 ${st.sell}`;
  c.maQuoteData={...Q};c.FROM=from;c.CUT='2099-12-31';
  const sess={settings:{ticker:T,principal:10000,buy:'ma',sell:'ma',park:'cash',short:50,divmode:'reinv',...st},hist:[],paper:true};c.SESS=sess;
  c.maReplay();const Hh=sess.hist.slice();
  if(!Hh.length)return {name,ok:false,info:'재생 기록 없음'};
  let n=0,nb=0,ins=0,outs=0,divN=0;const bad=[];
  for(let i=fromIdx;i<D.length;i++){
    const d=D[i].date,px=D[i].close,before=Hh.filter(x=>x.date<d||(x.date===d&&x.type==='div'));
    if(Hh.some(x=>x.date===d&&x.type==='div'))divN++;
    c.SESS={settings:sess.settings,hist:before};c.CUT=D[i-1].date;c.maQuoteData=dayQ(Q,i);
    const o=c.computeMa();if(!o.ready)continue;n++;
    const hold=o.signal==='hold',act=(hold&&o.pos!=='hold')?'in':(!hold&&o.pos==='hold')?'out':null;   // renderMaNow 와 같은 판단
    const q=act==='in'?c.maEntryQty(sess.settings,before,px).qty:act==='out'?((o.entry&&o.entry.qty)||0):0;
    const tr=Hh.filter(x=>x.date===d&&(x.type==='in'||x.type==='out'));
    const want=tr.length?tr[0].type+' '+tr[0].qty:'없음',got=act?act+' '+q:'없음';
    if(tr.length){if(tr[0].type==='in')ins++;else outs++;}
    if(want!==got){nb++;if(bad.length<5)bad.push(`${d} 재생 ${want} · 운영 ${got}`);}
  }
  return {name:`${name} — ${from}~ ${n}일 운영 신호·수량 == 재생 진입 ${ins}·청산 ${outs} (배당락 ${divN}일)`,ok:n>900&&ins>=2&&outs>=2&&nb===0,info:nb+'일 다름 · '+bad.join(' | ')};
}
/* 적립 — 운영 computeDca 의 오늘 배수·금액 == 재생 _paperDca 의 그날 적립 */
function dca(H,T,st,fromIdx){
  const c=idxCtx(H),Q=c.quoteToDaily(T,quoteJ(T)),D=Q.days,from=D[fromIdx].date,name=`적립 ${T} ${st.freq} ${st.amount}$ × ${st.dipMul}`;
  c.dcaQuoteData={...Q};c.CUT='2099-12-31';
  const sess={settings:{ticker:T,mode:'accum',amount:10,dipMul:2,freq:'day',...st},hist:[],paper:true};c.SESS=sess;
  const r=c._paperDca(sess,from),Hh=sess.hist.slice();
  if(!r||!Hh.length)return {name,ok:false,info:'재생 실패'};
  let n=0,nb=0,dip=0;const bad=[];
  for(const h of Hh){
    const i=D.findIndex(x=>x.date===h.date);if(i<1)continue;
    c.SESS={settings:sess.settings,hist:Hh.filter(x=>x.date<h.date)};c.CUT=D[i-1].date;c.dcaQuoteData=dayQ(Q,i);
    const o=c.computeDca();if(!o.ready)continue;n++;if(h.mul>1)dip++;
    const amt=+(sess.settings.amount*o.todayMul).toFixed(2);
    if(o.todayMul!==h.mul||Math.abs(amt-h.amt)>1e-9){nb++;if(bad.length<5)bad.push(`${h.date} 재생 ×${h.mul} ${h.amt} · 운영 ×${o.todayMul} ${amt}`);}
  }
  return {name:`${name} — ${from}~ 적립 ${n}번(배수 ${dip}번) 운영 배수·금액 == 재생`,ok:n>=40&&dip>=5&&nb===0,info:nb+'번 다름 · '+bad.join(' | ')};
}
/* 듀얼가드 — 운영 renderAlphaPlan(실계좌 '오늘 주문' · 포트폴리오 오늘 칸이 쓰는 계산 · 화면 없이 띠만) == 재생 replay(모의 세션)의 그날 체결 */
function planCtx(PL){
  const ectx={};vm.runInNewContext(ENG,ectx);const E=ectx.JKPlanSessionEngine;
  const c={window:{JKPlanSessionEngine:E},$:()=>null,num:()=>0};vm.createContext(c);
  vm.runInContext([/const PATH_DEFAULTS=\{[\s\S]*?\n\};/,/const ALPHA_FEE_RATE=[^;]*;/,/const usd=[^\n]*/,/const usd2=[^\n]*/].map(re=>declOf(PL,re)).join('\n')
    +'\nvar horizonRebalancePending=false,pendingAlphaOrders=[],alphaOrderHold="",planLivePanicMemo=new Map(),planIndexError="",planIndexLoading=false,liveQuotes={},planIndexCache={};\n'
    +['function indicatorSeries(a,n)','function realizedVol(rows,n)','function alphaRuleSet()','function alphaFee(q,p)','function alphaPanicApply(PX,sigma,decGuard)','function planLivePanic(x,signalDate,posOn,startOverride)',
      'function alphaExplainBounds(target,current,band)','function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)'].map(m=>fnOf(PL,m)).join('\n'),c);
  return {c,E};
}
function dg(PL,label,opt,panicLive){
  const {c,E}=planCtx(PL),T=RAW.TECL,Q=RAW.TQQQ,G=SGOV,cap=opt.principal||20000;
  const R=E.replay({horizon:5,rules:'base',principal:cap,monthlyAdd:0,tecl:T,tqqq:Q,sgov:G,teclDiv:DIVS.TECL,tqqqDiv:DIVS.TQQQ,sgovDiv:SGOV_DIV,vix:VIX,vxn:VXN,...opt});
  const name='듀얼가드 '+label;
  if(R.error||!R.nav.length)return {name,ok:false,info:R.error||'빈 재생'};
  if(panicLive){c.liveQuotes={TECL:{rows:T},TQQQ:{rows:Q},SGOV:{rows:G}};c.planIndexCache={'^VIX':{rows:VIX},'^VXN':{rows:VXN}};}
  const sessX={id:'live1',settings:{startDate:opt.startDate,alphaRules:panicLive?'panic':'base'}};
  const ev=R.ledger.events.filter(e=>e.type==='trade'),byDay=new Map();ev.forEach(e=>{if(!byDay.has(e.date))byDay.set(e.date,[]);byDay.get(e.date).push(e);});
  const pm=rows=>{const m=new Map();rows.forEach(x=>m.set(x.date,x.close));return m;},mT=pm(T),mQ=pm(Q),mG=pm(G);
  const dm=div=>{const m=new Map();div.forEach(x=>m.set(x.date,(m.get(x.date)||0)+x.amount));return m;},dT=dm(DIVS.TECL),dQ=dm(DIVS.TQQQ),dG=dm(SGOV_DIV);
  const iT=new Map(T.map((x,i)=>[x.date,i])),iQ=new Map(Q.map((x,i)=>[x.date,i])),iG=new Map(G.map((x,i)=>[x.date,i]));
  let n=0,nb=0,trd=0;const bad=[];
  for(let k=1;k<R.nav.length;k++){
    const d=R.nav[k].date,p=R.nav[k-1];
    const cash=p.cash+p.tecl*(dT.get(d)||0)+p.tqqq*(dQ.get(d)||0)+p.sgov*(dG.get(d)||0);   // 재생처럼 배당락일 아침 현금
    const q=(rows,ix,m)=>({rows:rows.slice(0,ix.get(d)+1),settled:{date:p.date,close:m.get(p.date)},price:m.get(d)});   // d 장중 봉까지 · 확정 = d 전날 · 현재가 = d 종가
    const strip=c.renderAlphaPlan(q(T,iT,mT),q(Q,iQ,mQ),q(G,iG,mG),{tq:p.tecl,qq:p.tqqq,sq:p.sgov,cash,startCap:cap,dep:null,
      panic:panicLive?((sd,on)=>c.planLivePanic(sessX,sd,on,opt.startDate)):(()=>null)});
    if(!strip)continue;if(strip.hold){nb++;if(bad.length<5)bad.push(d+' 판정 불가 '+strip.hold);continue;}
    n++;
    const got={};String(strip.orderText||'').split(' · ').filter(Boolean).forEach(t=>{const m=t.match(/^(\w+) (매수|매도) (\d+)주$/);if(m)got[m[1]]=(m[2]==='매수'?1:-1)*+m[3];});
    const want={};(byDay.get(d)||[]).forEach(e=>{want[e.symbol]=(want[e.symbol]||0)+(e.side==='buy'?1:-1)*e.qty;});
    if(byDay.has(d))trd++;
    const diff=[...new Set([...Object.keys(got),...Object.keys(want)])].filter(s=>(got[s]||0)!==(want[s]||0));
    if(diff.length){nb++;if(bad.length<5)bad.push(d+' '+diff.map(s=>`${s} 재생 ${want[s]||0} · 운영 ${got[s]||0}`).join(', '));}
  }
  let extra='',okX=true;
  if(panicLive){const cnt={};((R.panic&&R.panic.log)||[]).forEach(x=>{cnt[x.ev]=(cnt[x.ev]||0)+1;});
    extra=` · 무장 ${cnt.armed||0} · 빠른 Guard ${cnt.fastOn||0} · 재가속 ${cnt.sleeveOn||0}`;okX=(cnt.armed||0)>=2&&(cnt.fastOn||0)>=2&&(cnt.sleeveOn||0)>=3;}
  return {name:`${name} — ${opt.startDate}~ ${n}일 운영 주문 == 재생 체결 (체결 ${trd}일${extra})`,ok:n>900&&trd>=60&&nb===0&&okX,info:nb+'일 다름 · '+bad.join(' | ')};
}

/* ── 값 시험 ── */
function values(H){
  const out=[],t=(name,ok,info)=>out.push({name,ok:!!ok,info:info==null?'':String(info)});
  /* 섀넌 매수 경계 — 첫 편입 · σ 아주 작음(목표 100%) · 배정금 10,000$ · 가격 99.7503 · 수수료 0.25%:
     10000 ÷ (99.7503 × 1.0025) = 100.0003 → 100주 (옛 식 10000 × 0.9975 ÷ 99.7503 = 99.9997 → 99주). 재생도 100주. */
  { const c=idxCtx(H),days=[];let px=99.7;
    for(let i=0;i<70;i++){px=+(px*(i%2?1.0001:0.9999)).toFixed(4);days.push({date:'2026-0'+(1+Math.floor(i/22))+'-'+String(1+i%22).padStart(2,'0'),close:px});}
    const Q={symbol:'TQQQ',days,price:99.7503,last:days[days.length-1]};
    c.ivsQuoteData=Q;c.ivsQuote1=null;c.CUT='2099-12-31';
    c.SESS={settings:{ticker:'TQQQ',park:'bill',mode:'iv',s0:55,look:40,band:15,principal:10000,monthly:0},hist:[]};
    const o=c.computeIvs();
    t('섀넌 매수 경계 — 배정금 10,000$ · 99.7503$ → 100주(수수료 얹어 냄 · 재생 imBuyQty 와 같음 · 옛 식 99주)',o.ready&&o.hit&&o.side==='buy'&&o.orderQty===100&&c.imBuyQty(10000,99.7503,c.IVS_FEE)===100,JSON.stringify([o.side,o.orderQty,o.w]));
    const c2=idxCtx(H);c2.ivsQuoteData={...Q,days:days.map(x=>({...x})).concat([{date:'2026-04-30',close:99.7503}])};c2.ivsQuote1=null;c2.FROM='2026-04-30';c2.CUT='2099-12-31';
    const s2={settings:{ticker:'TQQQ',park:'bill',mode:'iv',s0:55,look:40,band:15,principal:10000,monthly:0},hist:[],paper:true};c2.SESS=s2;c2.ivsReplay();
    const b=s2.hist.find(x=>x.type==='buy');
    t('섀넌 매수 경계 — 재생(ivsReplay)도 같은 날 같은 배정금이면 100주',b&&b.qty===100,JSON.stringify(b)); }
  /* 로테 진입 수량 — 원금 10,000$ · 50$ 에 199주 진입(수수료 24.875) → 100$ 에 청산(수수료 49.75) → 현금 19,875.375$.
     80$ 진입 = 19,875.375 ÷ (80 × 1.0025) = 247.8 → 247주 (옛 식 원금 10,000 ÷ 80 = 125주) */
  { const c=idxCtx(H),st={ticker:'SOXL',principal:10000};
    const hist=[{type:'in',date:'2025-01-02',price:50,qty:199},{type:'out',date:'2025-06-02',price:100,qty:199}];
    const E=c.maEntryQty(st,hist,80);
    t('로테 진입 수량 = 장부 현금 19,875.375$ 전액 ÷ (80 × 1.0025) → 247주 (옛 식 원금÷가격 125주)',Math.abs(E.cash-19875.375)<1e-6&&E.qty===247,JSON.stringify(E));
    const E0=c.maEntryQty(st,[],80);
    t('로테 첫 진입 = 원금 10,000 ÷ (80 × 1.0025) → 124주 (재생 maReplay 첫 매수와 같은 식)',E0.qty===124&&E0.qty===c.imBuyQty(10000,80,c.IVS_FEE),JSON.stringify(E0));
    c.computeMa=()=>({ready:true,price:80,lastClose:80});c.SESS={settings:st,hist:hist.slice()};c.maRecord('in');
    const last=c.SESS.hist[c.SESS.hist.length-1];
    t('로테 🟢 진입 기록 — 장부에 적는 수량도 247주(안내와 같은 함수)',last.type==='in'&&last.qty===247&&last.price===80,JSON.stringify(last));
    const poor=[{type:'in',date:'2025-01-02',price:50,qty:199},{type:'out',date:'2025-06-02',price:0.1,qty:199}];   /* 현금 25.125+19.9−0.05 = 44.975$ < 1주 80.2$ */
    c.SESS={settings:st,hist:poor.slice()};c.ALERTS.length=0;c.maRecord('in');
    t('로테 🟢 진입 기록 — 현금이 1주 값보다 적으면 0주 진입을 적지 않고 알린다',c.SESS.hist.length===2&&c.ALERTS.length===1,JSON.stringify([c.SESS.hist.length,c.ALERTS])); }
  return out;
}

function suite(H,PL,parts){
  const P=new Set(parts||['val','ivs','ma','dca','dg','dgp']),out=[];
  const run=(k,f)=>{if(!P.has(k))return;try{const r=f();(Array.isArray(r)?r:[r]).forEach(x=>out.push(x));}catch(e){out.push({name:k+' 실행 오류',ok:false,info:String(e&&e.stack||e).slice(0,300)});}};
  run('val',()=>values(H));
  run('ivs',()=>[ivs(H,'TQQQ',{s0:55,look:40,band:15},230),ivs(H,'SOXL',{s0:40,look:40,band:15},230),ivs(H,'TECL',{s0:50,look:60,band:10},230),ivs(H,'TQQQ',{mode:'fix',s0:55,look:40,band:10},230)]);
  run('ma',()=>[ma(H,'SOXL',{buy:'ma',sell:'ma'},230),ma(H,'TQQQ',{buy:'cross',sell:'both'},230),ma(H,'TECL',{buy:'both',sell:'ma'},230)]);
  run('dca',()=>[dca(H,'TQQQ',{freq:'day',amount:10,dipMul:2},230),dca(H,'SOXL',{freq:'week',amount:100,dipMul:3},230),dca(H,'TECL',{freq:'month',amount:500,dipMul:2},230)]);
  run('dg',()=>[dg(PL,'기본 규칙 2만$',{startDate:'2021-09-01'}),dg(PL,'기본 규칙 10만$ · 2022-04 하락장 시작',{startDate:'2022-04-01',principal:100000})]);
  run('dgp',()=>[dg(PL,'공포 모드(실험) 2만$ — 운영 판정 = planLivePanic',{startDate:'2021-09-01',rules:'panic'},true)]);
  return out;
}

/* 변이 — [이름, 바꾸는 쪽(idx|plan), 바꾸기, 돌릴 묶음] */
const MUT=[
  ['섀넌 옛 매수 식 배정금×(1−수수료)÷가격','idx',s=>inFn(s,'function computeIvs()','out.orderQty=_ivsBuyQ(spend,price);','out.orderQty=Math.floor(spend*(1-IVS_FEE)/price);'),['val','ivs']],
  ['섀넌 밴드 판정을 현재가 비중으로(확정 종가 대신)','idx',s=>inFn(s,'function computeIvs()','out.hit=Math.abs(out.gap)>band;','out.hit=Math.abs(out.w-out.wNow)>band;'),['ivs']],
  ['섀넌 σ 에 오늘 장중 봉 섞음','idx',s=>inFn(s,'function computeIvs()','const days=_dAll ? settledBars(_dAll, curOf(st)) : null;','const days=_dAll;'),['ivs']],
  ['섀넌 매도 주수 1e-9 여유 없음(재생 _sq 와 다름) + 보유 넘게','idx',s=>inFn(s,'function computeIvs()','const _ivsSellQ=(x,have)=>Math.min(Math.floor(x+1e-9), Math.floor(have+1e-9));','const _ivsSellQ=(x,have)=>Math.ceil(x);'),['ivs']],
  ['로테 옛 진입 수량 원금÷가격','idx',s=>inFn(s,'function maEntryQty(st, hist, price)','imBuyQty(L.cash, price, FEE)','Math.floor((+(st&&st.principal)||0)/price)'),['val','ma']],
  ['로테 진입 기록이 공용 함수를 안 씀(옛 줄)','idx',s=>inFn(s,'function maRecord(type)','const qty=maEntryQty(st, curStrat().hist, price).qty;','const qty=Math.floor((st.principal||0)/price)||0;'),['val']],
  ['로테 신호에 오늘 장중 봉 섞음','idx',s=>inFn(s,'function computeMa()','const days=_dAll ? settledBars(_dAll, curOf(st)) : null;','const days=_dAll;'),['ma']],
  ['적립 배수를 현재가로 판정','idx',s=>inFn(s,'function computeDca()','const below = warming ? false : (lastClose<=smaNow);','const below = warming ? false : (price<=smaNow);'),['dca']],
  ['적립 200일선에 오늘 장중 봉 섞음','idx',s=>inFn(s,'function computeDca()','const days=_dAll ? settledBars(_dAll, curOf(st)) : null;','const days=_dAll;'),['dca']],
  ['듀얼가드 TECL 목표 주수를 현재가로(확정 종가 대신)','plan',s=>inFn(s,'function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)','Math.floor(signalTotal*D.teclWeight*w/ts)','Math.floor(signalTotal*D.teclWeight*w/tp)'),['dg']],
  ['듀얼가드 σ 에 오늘 장중 봉 섞음','plan',s=>inFn(s,'function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)','tr=qTecl.rows.filter(x=>x.date<=qTecl.settled.date)','tr=qTecl.rows'),['dg']],
  ['듀얼가드 매수 현금 한도에 수수료 안 남김','plan',s=>inFn(s,'function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)','q=Math.min(dq,Math.floor(avail/(p*(1+F))))','q=Math.min(dq,Math.floor(avail/p))'),['dg']],
  ['듀얼가드 Guard 를 현재가로 판정','plan',s=>inFn(s,'function renderAlphaPlan(qTecl,qTqqq,qSgov,bg)','tqqqClose:qs,sma','tqqqClose:qp,sma'),['dg']],
  ['공포 모드 운영이 TECL 재가속 σ 를 안 씀','plan',s=>inFn(s,'function alphaPanicApply(PX,sigma,decGuard)','return {sigma:sl?PX.sigma:sigma,','return {sigma:sigma,'),['dgp']],
  ['공포 모드 운영이 빠른 Guard 를 안 씀','plan',s=>inFn(s,'function alphaPanicApply(PX,sigma,decGuard)','guard:PX.state.pf?PX.guard:decGuard','guard:decGuard'),['dgp']],
];

const t0=Date.now();
const base=suite(IDX0,PL0);
for(const x of base)console.log((x.ok?'PASS ':'FAIL ')+x.name+(x.ok?'':' · '+x.info));
if(base.some(x=>!x.ok)){console.log('FAIL '+base.filter(x=>!x.ok).length+'건');process.exit(1);}
if(process.env.OPS_PARITY_NO_MUT){console.log('ALL PASS (변이 생략) · '+((Date.now()-t0)/1000).toFixed(1)+'s');process.exit(0);}
let red=0;
for(const [name,side,f,parts] of MUT){
  let H=IDX0,PL=PL0;try{if(side==='idx')H=f(IDX0);else PL=f(PL0);}catch(e){console.log('FAIL 변이 대상을 못 찾음: '+name+' · '+e.message);process.exit(1);}
  if(H===IDX0&&PL===PL0){console.log('FAIL 변이가 원본과 같음: '+name);process.exit(1);}
  const r=suite(H,PL,parts),hit=r.some(x=>!x.ok);if(hit)red++;
  console.log((hit?'PASS 변이 빨간불: ':'FAIL 변이가 통과함: ')+name+(hit?' ('+r.filter(x=>!x.ok).map(x=>x.name.split(' — ')[0]).join(' · ')+')':''));
}
if(red!==MUT.length){console.log('FAIL 변이 '+red+'/'+MUT.length);process.exit(1);}
console.log('ALL PASS 운영 오늘 할 일 == 재생 · '+base.length+'개 · 변이 '+red+'/'+MUT.length+' 빨간불 · '+((Date.now()-t0)/1000).toFixed(1)+'s');
