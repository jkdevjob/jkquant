#!/usr/bin/env node
'use strict';
/* 운영 '오늘 할 일' == 모의 재생 엔진이 그날 한 매매 — 하루씩 (섀넌 · 로테이션 · 적립 · 듀얼가드 기본 · 듀얼가드 공포 모드 · VR · ASAP)
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
 *   ③ ASAP 운영 오늘 할 일 · 🟢 매수 돈 출처 — 판정을 모의와 같은 asapDay 하나로. 예전엔 재진입 날 20%·30% 매수를 안내하지 않았고,
 *      재진입이 끝난 뒤에도 리저브가 있으면 '전액 매수'를 날마다 띄웠으며, 상승장 적립 · 딥 매수를 리저브에서 뺐다.
 * VR(사용자 "VR이랑 ASAP도 매일 대조 돌려봐")은 화면 주문표 · 사이클 진입이 엔진과 같다. 화면 표(매도 · 매수 각 20줄)보다 많이 닿은 날만 따로 센다.
 * 값 시험 + 변이(옛 코드 · 확정 봉 대신 오늘 봉 · 수수료 빼먹음 …)마다 빨간불인지 본다.
 */
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.join(__dirname,'..');
const IDX0=fs.readFileSync(path.join(root,'index.html'),'utf8'),PL0=fs.readFileSync(path.join(root,'plan.html'),'utf8'),ENG=fs.readFileSync(path.join(root,'plan-session-engine.js'),'utf8');
const fnOf=(src,m)=>{const s=src.indexOf(m);if(s<0)throw new Error('없음: '+m);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;else if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw new Error('끝 없음: '+m);};
const declOf=(src,re)=>{const m=src.match(re);if(!m)throw new Error('선언 없음: '+re);return m[0].replace(/^(?:const|let) /,'var ');};
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
  vm.runInContext([/const KR_CODE_RE=[^\n]*/,/let JK_FEE=[^\n;]*;/,/const IVS_X1=\{[^}]*\};/,/const DCA_N=\d+;/,/const DCA_N_AUTO=\d+;/,/const DIV_TAXRATE=[^;]*;/].map(re=>declOf(H,re)).join('\n')+'\n'+IDX_FNS.map(m=>fnOf(H,m)).join('\n'),c);
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
  vm.runInContext([/const PATH_DEFAULTS=\{[\s\S]*?\n\};/,/let ALPHA_FEE_RATE=[^;]*;/,/const usd=[^\n]*/,/const usd2=[^\n]*/].map(re=>declOf(PL,re)).join('\n')
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

/* ── VR · ASAP (2026-11-19 사용자: "VR이랑 ASAP도 매일 대조 돌려봐") ──
   운영 쪽은 하네스가 다시 세지 않는다 — 실제 화면 함수(renderVrTable · renderVrNext · enterNextCycle · renderAsapNow · asapRecord)를
   가짜 화면(id → {value, textContent, innerHTML})에서 그대로 돌려, 화면에 보인 주문표 · 진입 · 오늘 할 일과 기록된 장부를 읽는다. */
const domStub=()=>{const E={};return id=>E[id]||(E[id]={id,value:'',textContent:'',innerHTML:'',className:'',style:{},disabled:false,checked:false});};
const VR_FNS=['function computeVr()','function vrNextDue(s)','function vrCycStart(c)','function vrDue(c)','function cycDates(c)','function poolLimit(c)','function vrTiersShow(B, sf, bf, up, dn, limit, fee1, cur)',
  'function vrCycleTransition(V, pool, ev, G, mode, add, formula)','function computeNextV(c,ev)','function vrEntryEval(c, bars, dueStr, man)','function vrStepCycle(sess, c, dateStr, close)',
  'function vrModelOf(st)','function vrTick(p, cur)','function vrTickUp(p, cur)','function vrTickDn(p, cur)','function imTickRound(p, cur)','function vrRowQty(B)','function vrTiers(B, sf, bf, up, dn, limit, fee1, N, cur)',
  'function vrOrderPlan(S, P, bar)','function vrSimForward()','function vrFirstAmt(st)','function _lastSettled(rows, cur)','function sortHist(arr)','function paperStart(sess)',
  'function renderVrTable()','function renderVrNext()','function enterNextCycle()','function vrLastPrice(c)','function vrEval(c)','function vnOwner()','function vnOwn(kind)','function quoteOf(tab)',
  'function inputNum(id)','function unComma(s)','function vrBandExp(b)','function vrBandText(b)'];
const ASAP_FNS=['function asapDay(I, i, S, cfg, c)','function asapBuyFrom(c, amt)','function asapPos(hist)','function computeAsap()','function _asapPriceView(days)','function _asapMA(a,k)','function _asapRSI(a)',
  'function _paperAsap(sess, from)','function renderAsapNow()','function asapRecord(kind)','function inputNum(id)','function unComma(s)','function sortHist(arr)'];
const BASE_FNS=['function isKrCode(t)','function curOf(st)','function settledBars(rows,cur)','function divCashOn(st)','function isTradeBasis(Q)','function divPerShareQ(Q, d)','function divCashQ(Q, d, shares, taxOn)',
  'function _clampFrom(from, lastDate)','function _lastTradingDay(days)'];
function vaCtx(H,fns){
  const $=domStub(),c={CUT:'2099-12-31',SESS:null,lastQuote:{inf:null,vr:null},asapQuoteData:null,S:{paperCommon:{},vr:{sessions:[],active:null}},
    confirm:()=>true,alert:m=>{c.ALERTS.push(String(m));},ALERTS:[],save:()=>{},refreshVr:()=>{},refreshAsap:()=>{},pushRemote:null,drawAsapChart:()=>{},
    wn:v=>'P['+(+v)+']',px:v=>'$'+(+v).toFixed(2),nfix:(v,d)=>(+v).toFixed(d==null?2:d),tickerLabel:t=>String(t),paperPreferredSimStart:()=>null,document:{querySelector:()=>({click(){}})}};
  c.simCutoff=()=>c.CUT;c.curStrat=()=>c.SESS;c.$=$;
  vm.createContext(c);
  vm.runInContext([/const KR_CODE_RE=[^\n]*/,/let JK_FEE=[^\n;]*;/,/const DIV_TAXRATE=[^;]*;/,/const CYC_DAYS=\d+;/,/const VR_MODEL_DEFAULT=[^;]*;/,/const VR_ROWS_SHOW=\d+;/,/const VR_ROWS_MAX=\d+;/,/const VR_ROW_DIV=\d+;/]
    .map(re=>declOf(H,re)).join('\n')+'\nvar _vrAutoBusy=false, _vnFor={price:null,eval:null};\n'+BASE_FNS.concat(fns).filter((m,i,a)=>a.indexOf(m)===i).map(m=>fnOf(H,m)).join('\n'),c);
  return c;
}
const f6=v=>(+v).toFixed(6);
/* 화면 주문표 읽기 — 줄마다 <span class="lx-p">P[가격] × 주수</span> · 매수 '한도 밖' 줄은 걸지 않는다 */
const ladRows=html=>{const out=[],re=/<div class="lxr[^"]*"[^>]*>([\s\S]*?)<\/div>/g;let m;while((m=re.exec(html))){const b=m[1],pm=b.match(/<span class="lx-p">P\[([0-9.eE+-]+)\] × (\d+)<\/span>/);
  if(!pm||/<span class="lx-q">한도 밖<\/span>/.test(b))continue;out.push({p:+pm[1],q:+pm[2]});}return out;};
/* VR — 운영 화면 주문표(renderVrTable)를 그날 봉에 걸면 체결될 줄 == 모의 vrSimForward 의 그날 체결.
   증권사 모형: 매도 고가 ≥ 가격 · 매수 저가 ≤ 가격, 시가가 이미 넘었으면 시가(모의 엔진과 같은 체결 규약) · 매도 먼저(판 돈이 그날 매수 재원) · 현금이 모자라면 거기까지.
   사이클 진입: 모의가 장 마감에 넘어간 날, 그날 체결을 기록한 운영 장부에서 renderVrNext(진입일 칸 채움) → enterNextCycle 을 눌렀을 때 V · 적립 · 시작일 == 모의 */
function vr(H,T,st,fromIdx){
  const c=vaCtx(H,VR_FNS),rows=RAW[T],Q={symbol:T,ohlc:rows,days:rows.map(r=>({date:r.date,close:r.close})),priceBasis:'trade',dividends:DIVS[T],last:0};
  const from=rows[fromIdx].date,FEE=c.JK_FEE,fee1=1+FEE;
  const sess={paper:true,id:'v',simStart:from,simStartMode:'explicit',settings:{ticker:T,mode:0.75,formula:'basic',g:10,initAmt:10000,add:250,band:15,startv:0,startpool:0,autoCyc:true,vrModel:'ladder',divmode:'reinv',...st},hist:[]};
  const S=sess.settings,name=`VR ${T} ${({0.75:'적립',0.5:'거치',0.25:'인출'})[S.mode]} ${S.formula} G${S.g} 밴드 ${S.band}%`;
  const use=(x,i)=>{c.SESS=x;c.S.vr={sessions:[x],active:x.id};c.lastQuote={inf:null,vr:{...Q,last:rows[i].close,days:Q.days.slice(0,i+1)}};};
  use(sess,fromIdx);c.CUT=from;c.vrSimForward();
  if(!sess.hist.length)return {name,ok:false,info:'첫 매수 없음'};
  let n=0,nb=0,fillDays=0,nFill=0,offTable=0,cyc=0,cycBad=0,gap=0;const bad=[];
  for(let i=fromIdx+1;i<rows.length;i++){
    const d=rows[i].date,bar=rows[i],S0=JSON.parse(JSON.stringify(sess));
    use(S0,i);c.CUT=rows[i-1].date;c.renderVrTable();
    const sells=ladRows(c.$('sell_lad').innerHTML),buys=ladRows(c.$('buy_lad').innerHTML),cc=c.computeVr();
    const hi=bar.high>0?bar.high:bar.close,lo=bar.low>0?bar.low:bar.close,op=bar.open>0?bar.open:0;
    let hold=Math.floor(cc.qty),pool=cc.pool;const want=[];let lastHit=false;
    { const sh=Math.floor(cc.qty); if(!c.divCashOn(S0.settings)&&sh>0) pool+=c.divCashQ(Q,d,sh,true); }   // 모의는 배당락 배당을 사다리 전에 Pool 에 넣는다
    for(const [j,t] of sells.entries()){if(!(hi>=t.p))break;const q=Math.min(t.q,hold);if(q<1)break;const p=op>=t.p?op:t.p;if(p!==t.p)gap++;want.push('sell '+f6(p)+' x'+q);hold-=q;pool+=p*q-p*q*FEE;if(j===sells.length-1)lastHit=true;}
    for(const [j,t] of buys.entries()){if(!(lo<=t.p))break;const fp=(op>0&&op<=t.p)?op:t.p;const q=Math.min(t.q,Math.floor(pool/(fp*fee1)+1e-9));if(q<1)break;if(fp!==t.p)gap++;want.push('buy '+f6(fp)+' x'+q);pool-=fp*fee1*q;if(j===buys.length-1)lastHit=true;if(q<t.q)break;}
    use(sess,i);c.CUT=d;c.vrSimForward();
    const got=sess.hist.filter(h=>h.date===d&&(h.type==='buy'||h.type==='sell')&&!h.init).map(h=>h.type+' '+f6(h.price)+' x'+h.qty);
    n++;if(got.length){fillDays++;nFill+=got.length;}
    if(!(want.length===got.length&&want.every((x,k)=>x===got[k]))){
      if(lastHit&&got.length>want.length)offTable++;   // 화면 표는 매도 · 매수 각 20줄(VR_ROWS_SHOW) — 그보다 많이 닿은 날은 표 밖 줄까지 엔진이 체결한다(따로 센다)
      else{nb++;if(bad.length<4)bad.push(`${d} 운영표 [${want.join(', ')||'없음'}] · 모의 [${got.join(', ')||'없음'}]`);}
    }
    if(sess.settings.startCyc!==S0.settings.startCyc){
      cyc++;
      const L=JSON.parse(JSON.stringify(S0));
      sess.hist.filter(h=>h.date===d&&!h.auto&&!S0.hist.some(x=>x.ts===h.ts&&x.type===h.type&&x.date===h.date)).forEach(h=>L.hist.push(JSON.parse(JSON.stringify(h))));
      c.sortHist(L.hist);use(L,i);c.CUT=d;c.$('nv_date').value='';c.$('vn_eval').value='';
      c.renderVrNext();c.enterNextCycle();
      const pa=sess.hist.find(h=>h.auto&&h.cyc===sess.settings.startCyc),la=L.hist.find(h=>h.auto&&h.cyc===L.settings.startCyc);
      const okC=Math.abs(L.settings.startv-sess.settings.startv)<1e-9&&L.settings.startCyc===sess.settings.startCyc&&L.settings.cycStart===sess.settings.cycStart
        &&(!pa&&!la||(pa&&la&&pa.type===la.type&&pa.date===la.date&&Math.abs(pa.amt-la.amt)<1e-9));
      if(!okC){cycBad++;if(bad.length<4)bad.push(`${d} 진입 운영 V ${L.settings.startv} · ${L.settings.cycStart} · ${la?la.type+' '+la.amt+' '+la.date:'없음'} / 모의 V ${sess.settings.startv} · ${sess.settings.cycStart} · ${pa?pa.type+' '+pa.amt+' '+pa.date:'없음'}`);}
    }
  }
  return {name:`${name} — ${from}~ ${n}일 운영 화면 주문표 닿는 줄 == 모의 체결 (체결 ${fillDays}일 ${nFill}건 · 시가 체결 ${gap}줄 · 표 20줄 밖 ${offTable}일) · 진입 ${cyc}번 V · 적립 == 모의`,
    ok:n>900&&fillDays>=20&&cyc>=60&&nb===0&&cycBad===0,info:`${nb}일 다름 · 진입 ${cycBad}번 다름 · `+bad.join(' | ')};
}
/* ASAP — 운영 오늘 할 일(computeAsap().todo · 화면이 그대로 보인다) == 모의 _paperAsap 의 그날 기록.
   화면 · 기록: 재진입 날 / 상승장 적립 날 / 재진입 뒤 리저브가 남은 날에 renderAsapNow 가 보인 글자 · 권장 금액칸, 그 금액으로 🟢 매수를 눌렀을 때 장부에 적힌 돈 출처 · 금액 */
function asap(H,T,st,fromIdx){
  const c=vaCtx(H,ASAP_FNS),D=RAW[T].map(r=>({date:r.date,close:r.close})),Q={symbol:T,days:D,price:D[D.length-1].close,last:D[D.length-1],dividends:DIVS[T],priceBasis:'trade'};
  const from=D[fromIdx].date,name=`ASAP ${T} 적립 ${st.base||10} · mid ${st.mid||50} · deep ${st.deep||100}`;
  c.asapQuoteData={...Q};c.CUT='2099-12-31';
  const sess={paper:true,settings:{ticker:T,base:10,mid:50,deep:100,divmode:'reinv',...st},hist:[]};c.SESS=sess;
  c._paperAsap(sess,from);const Hh=sess.hist.slice();
  if(!Hh.length)return {name,ok:false,info:'모의 기록 없음'};
  let n=0,nb=0,act=0,re=0,reOk=0,bs=0,bsOk=0,lf=0,lfOk=0;const bad=[];
  for(let i=fromIdx;i<D.length;i++){
    const d=D[i].date,live=Hh.filter(x=>x.date<d||(x.date===d&&x.type==='div'));
    c.SESS={settings:sess.settings,hist:live.slice()};c.CUT=D[i-1].date;c.asapQuoteData={...Q,days:D.slice(0,i+1),price:D[i].close};
    const o=c.computeAsap();if(!o.ready)continue;n++;
    const want=(o.warming||!o.todo)?[]:o.todo.acts.map(a=>a.type==='sgov'?'sgov '+f6(a.amt):'buy '+a.from+' '+f6(a.amt)).sort();
    const pr=Hh.filter(x=>x.date===d&&x.type!=='div'),got=pr.map(x=>x.type==='sgov'?'sgov '+f6(x.amt):'buy '+x.from+' '+f6(x.amt)).sort();
    if(got.length)act++;
    if(want.join()!==got.join()){nb++;if(bad.length<4)bad.push(`${d} 운영 [${want.join(', ')}] · 모의 [${got.join(', ')}] · 단계 ${o.stage}`);continue;}
    /* 화면 · 기록 — 모의가 리저브로 산 날, 상승장 적립 날(리저브가 있는데 새 돈), 재진입 뒤 리저브가 남은 날 */
    const resAmt=pr.filter(x=>x.type==='buy'&&x.from==='reserve').reduce((s,x)=>s+x.amt,0),resLeft=o.todo&&!o.todo.skip?o.todo.sgov:0;
    const kind=resAmt>0?'re':(o.phase==='up'&&o.pos.reserve>0.5&&o.stage>=3&&resLeft>0.5)?'lf':(o.phase==='up'&&o.pos.reserve>0.5)?'bs':'';
    if(!kind||(kind==='bs'&&bs>=40)||(kind==='lf'&&lf>=40))continue;
    c.$('asap_amt').value='';c.renderAsapNow();
    const v=c.$('asap_verdict').innerHTML,amt=c.$('asap_amt').value;
    c.$('asap_amt').value=amt;c.ALERTS.length=0;const before=c.SESS.hist.length;c.asapRecord('buy');const rec=c.SESS.hist.length>before?c.SESS.hist[c.SESS.hist.length-1]:null;
    if(kind==='re'){re++;const rs=pr.filter(x=>x.from==='reserve'),lab=rs.length&&/재진입 [123]차/.test(v)&&rs.every(x=>v.includes('$'+x.amt.toFixed(2)));   // 리저브 매수가 한 날 두 건(2차 · 3차)이면 화면에 금액이 따로 보인다
      const resAfter=c.asapPos(c.SESS.hist).reserve;   // 리저브를 다 쓰는 날(3차)에 센트 반올림으로 리저브가 음수가 되면 안 된다
      if(lab&&rec&&rec.from==='reserve'&&Math.abs(rec.amt-resAmt)<=0.005&&resAfter>=-1e-9)reOk++;else if(bad.length<4)bad.push(`${d} 재진입 화면/기록 — 리저브 ${resAmt.toFixed(2)} · 칸 ${amt} · 기록 ${rec?rec.from+' '+rec.amt:'없음'} · 글자 ${/재진입 [123]차/.test(v)}`);}
    else if(kind==='bs'){bs++;if(rec&&rec.from==='new'&&Math.abs(rec.amt-(+sess.settings.base||10))<=0.005&&/매일 적립/.test(v))bsOk++;else if(bad.length<4)bad.push(`${d} 상승장 적립 — 기록 ${rec?rec.from+' '+rec.amt:'없음'} (리저브 ${o.pos.reserve.toFixed(2)})`);}
    else{lf++;if(/다음 하락장 재진입 때 씁니다/.test(v)&&!/전액 SOXL 매수로 소진/.test(v))lfOk++;else if(bad.length<4)bad.push(`${d} 재진입 뒤 남은 리저브 ${resLeft.toFixed(2)} — 화면에 '전액 매수'`);}
  }
  return {name:`${name} — ${from}~ ${n}일 운영 오늘 할 일 == 모의 기록 (기록 ${act}일) · 화면 · 기록 재진입 ${reOk}/${re} · 적립 ${bsOk}/${bs} · 재진입 뒤 리저브 ${lfOk}/${lf}`,
    ok:n>900&&nb===0&&re>=3&&reOk===re&&bs>=3&&bsOk===bs&&lf>=1&&lfOk===lf,info:`${nb}일 다름 · `+bad.join(' | ')};
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
    t('섀넌 매수 경계 — 배정금 10,000$ · 99.7503$ → 100주(수수료 얹어 냄 · 재생 imBuyQty 와 같음 · 옛 식 99주)',o.ready&&o.hit&&o.side==='buy'&&o.orderQty===100&&c.imBuyQty(10000,99.7503,c.JK_FEE)===100,JSON.stringify([o.side,o.orderQty,o.w]));
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
    t('로테 첫 진입 = 원금 10,000 ÷ (80 × 1.0025) → 124주 (재생 maReplay 첫 매수와 같은 식)',E0.qty===124&&E0.qty===c.imBuyQty(10000,80,c.JK_FEE),JSON.stringify(E0));
    c.computeMa=()=>({ready:true,price:80,lastClose:80});c.SESS={settings:st,hist:hist.slice()};c.maRecord('in');
    const last=c.SESS.hist[c.SESS.hist.length-1];
    t('로테 🟢 진입 기록 — 장부에 적는 수량도 247주(안내와 같은 함수)',last.type==='in'&&last.qty===247&&last.price===80,JSON.stringify(last));
    const poor=[{type:'in',date:'2025-01-02',price:50,qty:199},{type:'out',date:'2025-06-02',price:0.1,qty:199}];   /* 현금 25.125+19.9−0.05 = 44.975$ < 1주 80.2$ */
    c.SESS={settings:st,hist:poor.slice()};c.ALERTS.length=0;c.maRecord('in');
    t('로테 🟢 진입 기록 — 현금이 1주 값보다 적으면 0주 진입을 적지 않고 알린다',c.SESS.hist.length===2&&c.ALERTS.length===1,JSON.stringify([c.SESS.hist.length,c.ALERTS])); }
  return out;
}

function suite(H,PL,parts){
  const P=new Set(parts||['val','ivs','ma','dca','dg','dgp','vr','asap']),out=[];
  const run=(k,f)=>{if(!P.has(k))return;try{const r=f();(Array.isArray(r)?r:[r]).forEach(x=>out.push(x));}catch(e){out.push({name:k+' 실행 오류',ok:false,info:String(e&&e.stack||e).slice(0,300)});}};
  run('val',()=>values(H));
  run('ivs',()=>[ivs(H,'TQQQ',{s0:55,look:40,band:15},230),ivs(H,'SOXL',{s0:40,look:40,band:15},230),ivs(H,'TECL',{s0:50,look:60,band:10},230),ivs(H,'TQQQ',{mode:'fix',s0:55,look:40,band:10},230)]);
  run('ma',()=>[ma(H,'SOXL',{buy:'ma',sell:'ma'},230),ma(H,'TQQQ',{buy:'cross',sell:'both'},230),ma(H,'TECL',{buy:'both',sell:'ma'},230)]);
  run('dca',()=>[dca(H,'TQQQ',{freq:'day',amount:10,dipMul:2},230),dca(H,'SOXL',{freq:'week',amount:100,dipMul:3},230),dca(H,'TECL',{freq:'month',amount:500,dipMul:2},230)]);
  run('dg',()=>[dg(PL,'기본 규칙 2만$',{startDate:'2021-09-01'}),dg(PL,'기본 규칙 10만$ · 2022-04 하락장 시작',{startDate:'2022-04-01',principal:100000})]);
  run('dgp',()=>[dg(PL,'공포 모드(실험) 2만$ — 운영 판정 = planLivePanic',{startDate:'2021-09-01',rules:'panic'},true)]);
  run('vr',()=>[vr(H,'TQQQ',{},230),vr(H,'SOXL',{},230),vr(H,'TECL',{mode:0.5,formula:'skill',g:20,band:10,add:0},230),vr(H,'TQQQ',{mode:0.25,add:50},230)]);
  run('asap',()=>[asap(H,'SOXL',{},230),asap(H,'TQQQ',{},230),asap(H,'SOXL',{},500),asap(H,'TECL',{base:20,mid:100,deep:200},230)]);
  return out;
}

/* 변이 — [이름, 바꾸는 쪽(idx|plan), 바꾸기, 돌릴 묶음] */
const MUT=[
  ['섀넌 옛 매수 식 배정금×(1−수수료)÷가격','idx',s=>inFn(s,'function computeIvs()','out.orderQty=_ivsBuyQ(spend,price);','out.orderQty=Math.floor(spend*(1-JK_FEE)/price);'),['val','ivs']],
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
  ['VR 주문표 줄을 지금 보유로 셈(사이클 시작 보유 대신)','idx',s=>inFn(s,'function renderVrTable()','const B=Math.floor(c.cycBaseQty||c.qty)','const B=Math.floor(c.qty)'),['vr']],
  ['VR 주문표가 이미 체결한 매도 주식을 안 뺌','idx',s=>inFn(s,'function renderVrTable()','sf=Math.max(0,c.cycSellFilled||0)','sf=0'),['vr']],
  ['VR 주문표 매수 한도에서 이번 사이클에 쓴 돈을 안 뺌','idx',s=>inFn(s,'function renderVrTable()','limit=poolLimit(c)','limit=(c.cycStartPool||0)*(c.st.mode||0.75)'),['vr']],
  ['VR 다음 사이클 V 를 센트로 저장(옛 7차 ⑬)','idx',s=>inFn(s,'function enterNextCycle()','st.startv=+r.nextV.toFixed(6);','st.startv=+r.nextV.toFixed(2);'),['vr']],
  ['VR 진입일 칸을 기준일 대신 오늘로','idx',s=>inFn(s,'function renderVrNext()',"if(du) $('nv_date').value=du.dueStr;","if(du) $('nv_date').value=new Date().toISOString().slice(0,10);"),['vr']],
  ['ASAP 운영 단계를 시세 전 구간 단계로(옛 V.stage)','idx',s=>inFn(s,'function computeAsap()','const todo=asapDay(I,n,{stage:stage0,sgov:pos.reserve},cfg,price);','const todo=asapDay(I,n,{stage:V.stage,sgov:pos.reserve},cfg,price);'),['asap']],
  ['ASAP 단계 다시 세기를 세션 첫 기록 대신 이력 처음부터','idx',s=>inFn(s,'function computeAsap()','for(let i=Math.max(2,s0);i<n;i++)','for(let i=2;i<n;i++)'),['asap']],
  ['ASAP 오늘 할 일 리저브를 장부 대신 0','idx',s=>inFn(s,'function computeAsap()','{stage:stage0,sgov:pos.reserve}','{stage:stage0,sgov:0}'),['asap']],
  ['ASAP 화면이 재진입 매수를 안 보임(옛 화면)','idx',s=>inFn(s,'function renderAsapNow()','else if(RL[a.why]) v+=','else if(false) v+='),['asap']],
  ['ASAP 화면이 재진입 뒤 남은 리저브를 전액 매수로 안내(옛 화면)','idx',s=>inFn(s,'function renderAsapNow()',': `<p class="note" style="margin-top:8px;color:var(--dim)">재진입 완료 — 남은 리저브 <b>${px(left)}</b>(배당 등)는 다음 하락장 재진입 때 씁니다</p>`;',': oi(\'b\',\'재진입 완료\',`상승장 재확인 — 남은 리저브 <b>${px(left)}</b> 전액 SOXL 매수로 소진`,px(price));'),['asap']],
  ['ASAP 🟢 매수 옛 돈 출처(리저브가 넉넉하면 리저브)','idx',s=>inFn(s,'function asapRecord(kind)','from=asapBuyFrom(c, amt);',"from=(pos.reserve>=amt-1e-6)?'reserve':'new';"),['asap']],
  ['ASAP 리저브 전액(센트 반올림 올라감)을 새 돈으로 판정(경계)','idx',s=>inFn(s,'function asapBuyFrom(c, amt)','if(R>=amt-0.005 && res.length','if(R>=amt-1e-6 && res.length'),['asap']],
  ['ASAP 리저브 전액 기록이 센트 반올림 그대로(리저브 음수)','idx',s=>inFn(s,'function asapRecord(kind)','amt-pos.reserve<=0.005)?pos.reserve:amt','amt-pos.reserve<=0.005)?amt:amt'),['asap']],
  ['ASAP 권장 금액 옛 반올림(100$ 이상 정수)','idx',s=>inFn(s,'function renderAsapNow()',"$('asap_amt').value=nfix(recAmt,2);","$('asap_amt').value=nfix(recAmt,recAmt>=100?0:2);"),['asap']],
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
