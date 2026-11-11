#!/usr/bin/env node
'use strict';
/* 거래이력 그림(jk-trade-chart.js 1.0.0 · 운영 v3.130.0 · 듀얼가드 v2.10.0 · 2026-11-11) — 값 시험 + 변이 시험.
   사용자: "운영에서 각전략 세션 거래이력에 투자종목 그래프 그리고 그 그래프에 매수와 매도한걸 표현해 줄수 있나?" → 시안 → "어 좋아 그렇게 해"
   실제 파일의 함수를 그대로 돌린다(재구현 없음).
     A 그림 — 매매 표시가 체결가 자리(종가에 산 표시는 선 위 꼭짓점) · 같은 날 묶음 · 금액 크기 · 평단 계단 · 띠(5거래일 빈틈 잇기 · 90% 넘으면 안 그림)
       · 촘촘하면 매수만 주 · 달로(드문 매도는 낱낱이) · 요약(지금 평단 · 실현 합) · 기간 · 글자 escape
     B 값 상자 — 그날 종가 · 보유 · 평단 · 매매(손익) · 판 날이면 그 뒤 첫 매수(+%) · 묶음 표시
     C 운영 탭 → 매매 목록 — 보유 · 평단 · 손익은 각 탭 계산 값 그대로(무매 computeInf · VR computeVr 실효평단 · 섀넌 ivsPos · 적립 computeDca · 로테이션 진입가)
     D 듀얼가드 → 매매 목록 — 그날까지의 장부(엔진 ledgerCalc)로 보유 · 평단 · 손익은 표와 같은 tradePnl
     E 연결 — 거래이력 표를 그릴 때 · 칸을 열 때 · 자리 · 스크립트 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={mod:rd('jk-trade-chart.js'),idx:rd('index.html'),plan:rd('plan.html'),eng:rd('plan-session-engine.js'),bt:rd('backtest.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const optFn=(src,m)=>{try{return fnOf(src,m);}catch(e){return '';}};
const lineOf=(src,m)=>{const i=src.indexOf(m);if(i<0)throw Error('없음: '+m);return src.slice(i,src.indexOf('\n',i));};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

function loadMod(src){ const c={console,Math,Date,JSON,Map,Set,Number,String,Array,Object,Promise,isFinite,parseFloat}; c.globalThis=c; vm.createContext(c); vm.runInContext(src,c); return c.JKTradeChart; }
/* 시세 30일(평일만) — 종가는 100 + i */
function mkDays(n,start='2026-03-02',f=i=>100+i){ const out=[]; const t=new Date(start+'T00:00:00Z'); let i=0; while(out.length<n){ const dw=t.getUTCDay(); if(dw!==0&&dw!==6){ out.push({date:t.toISOString().slice(0,10),close:f(i)}); i++; } t.setUTCDate(t.getUTCDate()+1); } return out; }
/* 아주 작은 가짜 화면 — 값 상자 글자만 본다 */
function fakeBox(markup){
  const lines=[],H={};
  const tip={hidden:true,style:{},offsetWidth:150,textContent:'',children:lines,appendChild(d){lines.push(d);}};
  Object.defineProperty(tip,'textContent',{get(){return lines.map(l=>l.textContent).join('\n');},set(v){if(v==='')lines.length=0;}});
  const cross={setAttribute(){}};
  const W=+((markup.match(/viewBox="0 0 (\d+) /)||[])[1]||360);
  const svg={querySelector:s=>s==='.tc-cross'?cross:null,addEventListener:(k,f)=>{H[k]=f;},getBoundingClientRect:()=>({left:0,width:W})};
  const box={ownerDocument:{createElement:()=>({className:'',textContent:''})},querySelector:s=>s==='svg'?svg:s==='.tc-tip'?tip:null};
  return {box,tip,lines};
}
const tipText=(F,i)=>{ F.box._tcAt(i); return F.lines.map(l=>l.textContent); };

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const J=loadMod(S.mod);
  // ── A 그림
  { const days=mkDays(30);
    const trades=[{date:days[3].date,side:'buy',qty:10,price:days[3].close},{date:days[3].date,side:'buy',qty:10,price:days[3].close},
      {date:days[8].date,side:'buy',qty:5,price:days[8].close},{date:days[20].date,side:'sell',qty:25,price:days[20].close,pnl:123.4}];
    const steps=[{date:days[3].date,held:20,avg:103},{date:days[8].date,held:25,avg:(20*103+5*108)/25},{date:days[20].date,held:0,avg:null}];
    const R=J.render({symbol:'SOXL',days,trades,steps,period:'all',width:360});
    const m=R.markup, nb=(m.match(/tc-mk tc-b/g)||[]).length, ns=(m.match(/tc-mk tc-s/g)||[]).length;
    // 종가에 산 표시의 꼭짓점 = 종가 선의 그날 점
    const line=(m.match(/class="tc-line" d="([^"]+)"/)||[])[1]||'', pts=line.split(/[ML]/).filter(Boolean).map(p=>p.trim().split(' ').map(Number));
    const polys=[...m.matchAll(/class="tc-mk (tc-b|tc-s)" points="([^"]+)"/g)].map(x=>({k:x[1],p:x[2].split(' ').map(q=>q.split(',').map(Number))}));
    const g=R.geo, i3=g.days.findIndex(d=>d.date===days[3].date), i20=g.days.findIndex(d=>d.date===days[20].date);
    const b0=polys.find(p=>p.k==='tc-b'), s0=polys.find(p=>p.k==='tc-s');
    const apexOnLine=b0&&near(b0.p[0][0],pts[i3][0],0.11)&&near(b0.p[0][1],pts[i3][1],0.11)&&s0&&near(s0.p[0][0],pts[i20][0],0.11)&&near(s0.p[0][1],pts[i20][1],0.11);
    const dirOK=b0&&b0.p[1][1]>b0.p[0][1]&&s0&&s0.p[1][1]<s0.p[0][1];   // 매수 ▲ 몸통은 아래 · 매도 ▼ 몸통은 위
    t('A1 같은 날 두 번 산 것은 표시 하나 · 매수 2 · 매도 1 · 끝이 그날 종가 점(선 위) · 매수 ▲ · 매도 ▼',nb===2&&ns===1&&apexOnLine&&dirOK,JSON.stringify({nb,ns,apexOnLine,dirOK}));
    const sizeOf=p=>Math.abs(p.p[1][0]-p.p[2][0]);
    const bs=polys.filter(p=>p.k==='tc-b').map(sizeOf);
    t('A2 크기 = 금액(20주 묶음이 5주보다 크다)',bs.length===2&&bs[0]>bs[1],JSON.stringify(bs));
    const avgD=(m.match(/class="tc-avg" d="([^"]+)"/)||[])[1]||'';
    const avgMoves=(avgD.match(/M/g)||[]).length, ys=[...avgD.matchAll(/V([\d.]+)/g)].map(x=>+x[1]);
    t('A3 평단 계단 — 들고 있을 때만(판 날 끊김 · 한 덩어리) · 5주 더 산 날 평단이 오른다',avgMoves===1&&ys.length>0&&!/tc-avg[^>]*>.*tc-avg/.test(m),avgD.slice(0,80));
    t('A4 요약 — 지금 안 들고 있음 · 매수 3번 · 매도 1번 · 실현 +$123',/지금 안 들고 있음/.test(m)&&/매수 3번 · 매도 1번 · 실현 <span class="tc-up">\+\$123<\/span>/.test(m),(m.match(/<div class="tc-sum">.*?<\/div>/)||[''])[0]);
    // 값 상자
    const F=fakeBox(m); J.bind(F.box,R.geo);
    const L3=tipText(F,i3), L8=tipText(F,g.days.findIndex(d=>d.date===days[8].date)), L20=tipText(F,i20);
    t('B1 값 상자 — 날짜 · 종가 · 보유 · 평단 · 그날 매매 두 줄 · 판 날 손익',L3[0]===days[3].date+' · 종가 $103.00'&&L3[1]==='보유 20주 · 평단 $103.00'&&L3.filter(x=>/^▲ 매수 10주 × \$103\.00 = \$1,030$/.test(x)).length===2
      &&L20.some(x=>x==='▼ 매도 25주 × $120.00 = $3,000 · 손익 +$123'),JSON.stringify([L3,L20]));
    const R2=J.render({symbol:'SOXL',days,trades:trades.concat([{date:days[25].date,side:'buy',qty:3,price:days[25].close}]),period:'all',width:360});
    const F2=fakeBox(R2.markup); J.bind(F2.box,R2.geo); const L20b=tipText(F2,i20);
    t('B2 판 날 — 그 뒤 첫 매수 날짜 · 값 · 판 값 대비 %',L20b.some(x=>x==='  → 다음 매수 '+days[25].date.slice(5).replace('-','/')+' $125.00 (+4.2%)'),JSON.stringify(L20b));
    t('B3 매수만 한 날은 다음 매수 줄이 없다',!L8.some(x=>/다음 매수/.test(x)),JSON.stringify(L8));
  }
  // 띠 — 5거래일 이하 빈틈은 잇고 · 90% 넘으면 안 그림
  { const days=mkDays(60);
    const mk=(pairs)=>{ const tr=[],st=[]; for(const [a,b] of pairs){ tr.push({date:days[a].date,side:'buy',qty:1,price:days[a].close}); st.push({date:days[a].date,held:1,avg:days[a].close});
      if(b!=null){ tr.push({date:days[b].date,side:'sell',qty:1,price:days[b].close}); st.push({date:days[b].date,held:0,avg:null}); } } return {tr,st}; };
    const A=mk([[5,15],[18,25],[40,50]]); const RA=J.render({symbol:'X',days,trades:A.tr,steps:A.st,period:'all',width:360});
    const nA=(RA.markup.match(/class="tc-hold"/g)||[]).length;
    const Bq=mk([[2,null]]); const RB=J.render({symbol:'X',days,trades:Bq.tr,steps:Bq.st,period:'all',width:360});
    const nB=(RB.markup.match(/class="tc-hold"/g)||[]).length;
    t('A5 띠 — 3번 들고 판 것 중 3일 빈틈은 이어 2덩어리 · 처음부터 끝까지 들고 있으면 띠 없음(범례도 없음)',nA===2&&nB===0&&!/들고 있던 기간/.test(RB.markup)&&/들고 있던 기간/.test(RA.markup),JSON.stringify({nA,nB})); }
  // 촘촘 — 매수는 묶고 드문 매도는 낱낱이
  { const days=mkDays(260); const tr=[];
    days.forEach((d,i)=>{ if(i>=5) tr.push({date:d.date,side:'buy',qty:1,price:d.close}); if(i%40===39) tr.push({date:d.date,side:'sell',qty:2,price:d.close,pnl:1}); });
    const R=J.render({symbol:'X',days,trades:tr,period:'all',width:360}), m=R.markup;
    const nb=(m.match(/tc-mk tc-b/g)||[]).length, ns=(m.match(/tc-mk tc-s/g)||[]).length;
    t('A6 매일 산 매수는 주 · 달로 묶고(표시 수 ≤ 폭/7) · 6번 판 매도는 6개 그대로 · 범례에 묶음 단위',R.geo.unitB!=='day'&&R.geo.unitS==='day'&&ns===6&&nb*7<=R.geo.PW+7&&/▲ 하나 = 한 (주|달) 매수 합/.test(m)&&!/▼ 하나/.test(m),JSON.stringify({unitB:R.geo.unitB,unitS:R.geo.unitS,nb,ns}));
    const G=J.group([{date:'2026-03-02',side:'buy',qty:1,price:10},{date:'2026-03-03',side:'buy',qty:3,price:20},{date:'2026-03-10',side:'buy',qty:null,price:30}],'week');
    const w1=G.find(q=>q.from==='2026-03-02'), w2=G.find(q=>q.from==='2026-03-10');
    t('A7 묶음 평균가 = 수량 가중(1×10 + 3×20 → 17.5) · 수량 모르는 표시는 값 평균',w1&&near(w1.price,17.5)&&w1.n===2&&w1.qty===4&&w2&&near(w2.price,30)&&w2.amt===0,JSON.stringify(G)); }
  // 기간 · 글자 · 비어 있음
  { const days=mkDays(200), tr=[{date:days[10].date,side:'buy',qty:1,price:days[10].close,label:'<img src=x onerror=alert(1)>'}];
    const R=J.render({symbol:'<b>X</b>',days,trades:tr,period:'3m',width:360});
    t('A8 기간 3개월 = 마지막 63거래일 · 전체 = 첫 매매 열흘 전부터',R.geo.n===63&&J.render({symbol:'X',days,trades:tr,period:'all',width:360}).geo.n===200-0,R.geo.n);
    t('A9 글자는 escape(종목 · 범례) — 기록의 글자가 태그가 되지 않는다',!/<b>X<\/b>/.test(R.markup)&&/&lt;b&gt;X&lt;\/b&gt;/.test(R.markup));
    const R0=J.render({symbol:'X',days,trades:[],width:360}), R1=J.render({symbol:'X',days:[],trades:tr,width:360});
    t('A10 매매 없음 · 시세 없음 — 그림 대신 안내 한 줄',/아직 매매 기록이 없습니다/.test(R0.markup)&&!R0.geo&&/시세를 불러오지 못했습니다/.test(R1.markup)&&!R1.geo);
    const P=J.pathOf(days.slice(0,5),[{date:'2026-01-01',held:true,avg:50},{date:days[2].date,held:0,avg:9}]);
    t('A11 보유 경로 — 그날까지 마지막 기록 · 수량 모르는 보유(true) · 다 팔면 평단 없음',P[0].held===true&&P[0].avg===50&&P[2].held===0&&P[2].avg===null,JSON.stringify(P)); }

  // ── C 운영 탭 → 매매 목록(각 탭 계산 값 그대로)
  { const I=S.idx, ki=I.indexOf('const KIND_T=');
    const parts=[I.slice(ki,I.indexOf(';',I.indexOf('(애프터)',ki))+1),fnOf(I,'function reverseT(kind,t,div)'),lineOf(I,'function isBuy(k)'),lineOf(I,'function isSell(k)'),fnOf(I,'function isAmtKind(k)'),
      lineOf(I,"const CX_KINDS="),lineOf(I,'function isCx(k)'),I.slice(I.indexOf('const IM_OFFICIAL='),I.indexOf(';',I.indexOf('const IM_OFFICIAL='))+1),
      fnOf(I,'function starPct(ticker,div,T,base)'),fnOf(I,'function exitMulOf(base)'),optFn(I,'function imCycleEnds(soldToday, qtyAtDayEnd)'),optFn(I,'function imDayOpenAfter(hist, i)'),
      (I.match(/const IM_AUTOTP=\{[^\n]*\};/)||[''])[0],optFn(I,'function imAutoTP(bars, date)'),optFn(I,'function normalizeAutoTpMode(v)'),optFn(I,'function autoTpModeOf(st)'),
      (I.match(/const IM_AUTOTP_MA150=\{[^\n]*\};/)||[''])[0],optFn(I,'function imAutoTPMA150(bars,date)'),optFn(I,'function imAutoTPByMode(bars,date,mode)'),
      (I.match(/const IM_AUTOTP_M1=\{[^\n]*\};/)||[''])[0],optFn(I,'function imAutoTPM1(bars,cycStart,date,base)'),
      (I.match(/const REV_DIVS=\[[^\]]*\];/)||[''])[0],fnOf(I,'function revSupported(div)'),fnOf(I,'function revEnabled(st)'),
      fnOf(I,'function computeInf()'),fnOf(I,'function computeVr()'),fnOf(I,'function ivsPos(principal,hist)'),fnOf(I,'function computeDca()'),fnOf(I,'function maLedger(hist, price, principal)'),
      fnOf(I,'function tcFromInf(c)'),fnOf(I,'function tcFromVr(c)'),fnOf(I,'function tcFromMa(st,hist)'),fnOf(I,'function tcFromIvs(c)'),fnOf(I,'function tcFromDca(c)')];
    const c={console,Math,Date,JSON,Map,Set,Number,String,Array,Object,isFinite,IVS_FEE:0.0025,__strat:null,_infReplayAsOf:'',_infResume:null,imAutoBars:()=>null,dcaQuoteData:null,
      _dcaRawMap:()=>new Map(),settledBars:x=>x,curOf:()=>'usd',nfix:(v,d)=>(+v).toFixed(d)};
    c.curStrat=()=>c.__strat; vm.createContext(c);
    vm.runInContext(parts.join('\n')+'\n;this.__fns={computeInf,computeVr,ivsPos,computeDca,tcFromInf,tcFromVr,tcFromMa,tcFromIvs,tcFromDca};',c);
    const F=c.__fns, sumP=a=>a.reduce((s,x)=>s+(x.pnl!=null?x.pnl:0),0), lastStep=st=>st.slice().sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0).pop();
    // 무매 — 1회매수 3번 · 쿼터매도 · 복합(지정가매도+1회매수) · 출금 · 배당
    c.__strat={settings:{ticker:'SOXL',div:40,principal:10000,mode:'compound',ver:'4.0'},hist:[
      {date:'2026-06-01',kind:'1회매수',price:100,qty:3,ts:1},{date:'2026-06-02',kind:'1회매수',price:90,qty:3,ts:2},{date:'2026-06-03',kind:'1회매수',price:80,qty:4,ts:3},
      {date:'2026-06-04',kind:'쿼터매도',price:95,qty:2,ts:4},{date:'2026-06-05',kind:'출금',amt:50,ts:5},{date:'2026-06-08',kind:'배당',amt:3,ts:6},
      {date:'2026-06-09',kind:'지정가매도+1회매수',sellPrice:99,sellQty:2,buyPrice:96,buyQty:3,ts:7}]};
    const ci=F.computeInf(), ti=F.tcFromInf(ci), li=lastStep(ti.steps), prof=ci.rows.reduce((s,h)=>s+(isFinite(h.profit)&&(h.kind.includes('매도'))?h.profit:0),0);
    t('C1 무매 — 매매 6건(복합은 매도 + 매수 · 출금 · 배당 빠짐) · 지금 보유 · 평단 = computeInf · 매도 손익 합 = 표 손익 합',
      ti.sym==='SOXL'&&ti.trades.length===6&&ti.trades.filter(x=>x.side==='sell').length===2&&li.held===ci.qty&&near(li.avg,ci.avg)&&near(sumP(ti.trades),prof)&&ti.trades.some(x=>x.label==='지정가매도'&&x.price===99&&x.qty===2),
      JSON.stringify({n:ti.trades.length,li,qty:ci.qty,avg:ci.avg,p:sumP(ti.trades),prof}));
    // VR — 실효평단 · 실현손익
    c.__strat={settings:{ticker:'TQQQ',band:15,startpool:1000},hist:[{type:'buy',date:'2026-03-02',price:50,qty:100,fee:1,init:true,cyc:0},{type:'buy',date:'2026-03-16',price:45,qty:10,fee:0.5,cyc:1},
      {type:'sell',date:'2026-03-30',price:60,qty:20,fee:1.2,cyc:2},{type:'div',date:'2026-04-01',amt:12.5,cyc:2},{type:'sell',date:'2026-04-13',price:62,qty:10,fee:0.6,cyc:3}]};
    const cv=F.computeVr(), tv=F.tcFromVr(cv), lv=lastStep(tv.steps);
    t('C2 VR — 평단 선 = 실효평단(computeVr.avgEff) · 보유 = qty · 매도 손익 합 = 실현손익(realized)',tv.avgLabel==='실효평단'&&lv.held===cv.qty&&near(lv.avg,cv.avgEff)&&near(sumP(tv.trades),cv.realized)&&tv.trades.length===4,
      JSON.stringify({lv,qty:cv.qty,avgEff:cv.avgEff,p:sumP(tv.trades),r:cv.realized}));
    // 섀넌 — 종목마다 · 손익 = ivsPos 실현
    const IH=[{type:'add',date:'2026-05-01',amt:1000},{type:'buy',date:'2026-05-01',qty:10,price:60,amt:600,fee:0.6,leg:'lev',sym:'TQQQ'},{type:'buy',date:'2026-05-08',qty:5,price:40,amt:200,leg:'x1',sym:'QQQ'},
      {type:'sell',date:'2026-05-15',qty:4,price:70,amt:280,fee:0.3,leg:'lev',sym:'TQQQ'},{type:'buy',date:'2026-05-22',qty:2,price:65,amt:130,leg:'lev',sym:'TQQQ'}];
    const P=F.ivsPos(5000,IH), ts=F.tcFromIvs({posRows:P.rows,sym:'TQQQ',sym1:'QQQ'}), lq=lastStep(ts.TQQQ.steps), l1=lastStep(ts.QQQ.steps);
    t('C3 섀넌 — 종목마다 따로 · TQQQ 보유 · 평단 = ivsPos qty · avg · 1배 짝 = qty1 · avg1 · 손익 합 = realized',Object.keys(ts).sort().join()==='QQQ,TQQQ'&&lq.held===P.qty&&near(lq.avg,P.avg)&&l1.held===P.qty1&&near(l1.avg,P.avg1)
      &&near(sumP(ts.TQQQ.trades),P.realized),JSON.stringify({lq,qty:P.qty,avg:P.avg,p:sumP(ts.TQQQ.trades),r:P.realized}));
    // 적립 — 평단 = 넣은 돈 ÷ 주수
    c.__strat={settings:{ticker:'QLD',amount:100,mode:'dca'},hist:[{date:'2026-01-05',amt:100,price:80},{date:'2026-01-12',amt:200,price:70,mul:2},{date:'2026-01-20',amt:100,price:90}]};
    const cd=F.computeDca(), td=F.tcFromDca(cd), ld=lastStep(td.steps);
    t('C4 적립 — 매수 3 · 보유 · 평단 = computeDca.pos(shares · avg) · 배수 적립 이름',td.trades.length===3&&near(ld.held,cd.pos.shares)&&near(ld.avg,cd.pos.avg)&&td.trades[1].label==='배수 적립 ×2'&&near(td.trades[1].qty,200/70),JSON.stringify({ld,pos:cd.pos}));
    // 로테이션 — 진입가 · 수량 모르는 진입
    const tm=F.tcFromMa({ticker:'SOXL',principal:10000},[{type:'in',date:'2026-01-05',price:30,qty:40},{type:'out',date:'2026-03-20',price:25},{type:'div',date:'2026-03-25',amt:3},{type:'in',date:'2026-04-21',price:20}]);
    const want=(25-(30*40+30*40*0.0025)/40)*40-25*40*0.0025;   // 분석 탭 장부(maLedger) — 수수료 포함 원가 · 청산 수수료 차감
    t('C5 로테이션 — 진입 = 매수(진입가 선) · 청산 = 매도(수량 · 손익 = 분석 탭 maLedger — 수량 안 적은 청산 = 들고 있던 40주) · 배당 빠짐 · 수량 모르는 진입은 들고 있음(true)',tm.trades.length===3&&tm.trades[1].qty===40&&near(tm.trades[1].pnl,want)&&tm.avgLabel==='진입가'
      &&tm.steps[1].held===0&&tm.steps[1].avg===null&&tm.steps[2].held===true&&tm.steps[2].avg===20&&tm.trades[2].qty===null,JSON.stringify(tm)); }

  // ── D 듀얼가드 → 매매 목록
  { const c={console,Math,Date,JSON,Map,Set,Number,String,Array,Object,isFinite}; c.window=c; vm.createContext(c); vm.runInContext(S.eng,c);
    vm.runInContext('function alphaEventList(ledger){return JKPlanSessionEngine.ledgerEvents(ledger);}function alphaLedgerCalc(ledger){return JKPlanSessionEngine.ledgerCalc(ledger);}\n'
      +lineOf(S.plan,'const ALPHA_TC_KEYS=')+'\n'+fnOf(S.plan,'function alphaTradeChartData(ledger)')+'\n;this.__f=alphaTradeChartData;',c);
    const L={base:{date:'2026-09-22',tecl:0,tqqq:0,sgov:0,cash:20000},events:[
      {id:'1',type:'trade',date:'2026-09-23',symbol:'TECL',side:'buy',qty:40,price:200,fee:8},{id:'2',type:'trade',date:'2026-09-23',symbol:'TQQQ',side:'buy',qty:74,price:79,fee:5.8},
      {id:'3',type:'cash',date:'2026-10-02',kind:'dep',amount:2557.23},{id:'4',type:'trade',date:'2026-10-20',symbol:'TECL',side:'buy',qty:8,price:180,fee:1.4},
      {id:'5',type:'trade',date:'2026-10-23',symbol:'TECL',side:'sell',qty:12,price:150,fee:1.8},{id:'6',type:'trade',date:'2026-11-02',symbol:'TQQQ',side:'sell',qty:74,price:59.46,fee:4.4}]};
    const D=c.__f(L), S2=c.JKPlanSessionEngine.ledgerCalc(L), at=(st,d)=>st.filter(x=>x.date<=d).pop();
    const t1=at(D.TECL.steps,'2026-09-30'), t2=at(D.TECL.steps,'2026-10-21'), t3=at(D.TECL.steps,'2026-12-31'), q3=at(D.TQQQ.steps,'2026-12-31');
    const sell=D.TECL.trades.find(x=>x.side==='sell'), tq=D.TQQQ.trades.find(x=>x.side==='sell');
    t('D1 듀얼가드 — 날마다 그날까지의 장부(ledgerCalc): TECL 9/23 40주 · 평단 200 → 10/20 48주 · 평단 196.67 → 지금 36주 · 평단 그대로 · TQQQ 다 팔아 0 · 평단 없음',
      t1.held===40&&near(t1.avg,200)&&t2.held===48&&near(t2.avg,(40*200+8*180)/48)&&t3.held===S2.tecl&&near(t3.avg,S2.avgTecl)&&q3.held===0&&q3.avg===null,JSON.stringify({t1,t2,t3,q3}));
    t('D2 매도 손익 = 거래이력 표의 tradePnl(매도 당시 평단 · 수수료 제외) · SGOV 는 매매 없음',near(sell.pnl,(150-(40*200+8*180)/48)*12)&&near(tq.pnl,(59.46-79)*74)&&D.SGOV.trades.length===0,JSON.stringify({sell,tq})); }

  // ── E 연결
  { const I=S.idx,P=S.plan;
    t('E1 운영 — 거래이력 표를 그릴 때마다 그 탭 그림(보일 때만) · 거래이력 칸을 열 때 · 폭이 바뀔 때',['inf','vr','ma','ivs','dca'].every(k=>new RegExp("tcRender\\('"+k+"'\\);").test(I))
      &&/const tb=\['inf','vr','ma','ivs','dca'\]\.find\(k=>tcBlockOf\(k\)===c\.dataset\.b\); if\(tb\) setTimeout/.test(I)&&/if\(tcBlockOf\(S\.activeTab\)\) tcRender\(S\.activeTab\)/.test(I)
      &&/S\.activeTab!==tab\|\|!blk\.classList\.contains\('on'\)\) return;/.test(fnOf(I,'function tcRender(tab)')));
    t('E2 자리 — 각 거래이력 맨 위 · 듀얼가드 거래이력 머리 아래 · 두 화면 모두 스크립트',['inf','vr','ma','ivs','dca'].every(k=>I.includes('<div id="'+k+'_tc"></div>'))&&P.includes('<div id="alphaTradeChart"></div>')
      &&I.includes('<script src="/jk-trade-chart.js?v=1.0.0"></script>')&&P.includes('<script src="/jk-trade-chart.js?v=1.0.0"></script>'));
    t('E3 듀얼가드 — 거래이력 탭을 열 때 · 장부 표를 그릴 때 그림',/if\(selected==='history'&&typeof renderAlphaTradeChart==='function'\)renderAlphaTradeChart\(\);/.test(fnOf(P,'function setAssetDetail(name)'))
      &&/if\(typeof renderAlphaTradeChart==='function'\)renderAlphaTradeChart\(\);/.test(fnOf(P,'function renderAlphaLedger()'))&&/sec\.hidden/.test(fnOf(P,'function renderAlphaTradeChart()'))); }
  return bad;
}

const MUT=[
  ['그림: 표시가 체결가 대신 몸통 가운데','mod',s=>s.replace("const pts=q.side==='buy'?[[cx,cy],[cx-w,cy+h],[cx+w,cy+h]]:[[cx,cy],[cx-w,cy-h],[cx+w,cy-h]];","const pts=q.side==='buy'?[[cx,cy-h/2],[cx-w,cy+h/2],[cx+w,cy+h/2]]:[[cx,cy+h/2],[cx-w,cy-h/2],[cx+w,cy-h/2]];")],
  ['그림: 크기가 금액과 무관','mod',s=>s.replace("const r=q.amt>0?Math.sqrt(q.amt/maxA):0.5,","const r=0.5,")],
  ['그림: 다 팔아도 평단 남음','mod',s=>s.replace("cur={held:h,avg:on&&S[j].avg!=null&&+S[j].avg>0?+S[j].avg:null}; j++;","cur={held:h,avg:S[j].avg!=null?+S[j].avg:cur.avg}; j++;")],
  ['그림: 띠 빈틈 안 이음','mod',s=>s.replace("if(p0&&sp[0]-p0[1]<=5) p0[1]=sp[1];","if(false) p0[1]=sp[1];")],
  ['그림: 늘 들고 있어도 띠','mod',s=>s.replace("band=covered<0.9&&merged.length>0;","band=merged.length>0;")],
  ['그림: 매도도 매수와 같이 묶음','mod',s=>s.replace("unitS=pickUnit(vs,PW);","unitS=unitB;")],
  ['그림: 묶음 값 = 단순 평균','mod',s=>s.replace("price:o.qty>0?o.amt/o.qty:o.pxSum/o.n","price:o.pxSum/o.n")],
  ['그림: 종목 글자 escape 안 함','mod',s=>s.replace("const sum='<div class=\"tc-sum\"><b>'+esc(sym)+'</b> '","const sum='<div class=\"tc-sum\"><b>'+sym+'</b> '").replace("note(sym+' — 아직","note(sym+' — 아직")],
  ['그림: 실현 합 빠짐','mod',s=>s.replace("(withP.length?' · 실현 <span","(false?' · 실현 <span")],
  ['그림: 기간이 늘 전체','mod',s=>s.replace("else i0=Math.max(0,all.length-per[2]);","else { i0=all.findIndex(d=>d.date>=tr[0].date); i0=Math.max(0,i0-10); }")],
  ['값 상자: 다음 매수가 판 날 앞 매수','mod',s=>s.replace("const nb=G.all.find(z=>z.side==='buy'&&z.date>t.date);","const nb=G.all.find(z=>z.side==='buy');")],
  ['값 상자: 손익 안 적음','mod',s=>s.replace("+(t.side==='sell'&&t.pnl!=null?' · 손익 '+(t.pnl>=0?'+':'')+G.M0(t.pnl):'')","")],
  ['무매: 복합 매도 손익 버림','idx',s=>s.replace("const sl={date:h.date,side:'sell',qty:+h.sellQty,price:+h.sellPrice,pnl:h.profit,label:'지정가매도'};","const sl={date:h.date,side:'sell',qty:+h.sellQty,price:+h.sellPrice,label:'지정가매도'};")],
  ['무매: 출금 · 배당도 매매로','idx',s=>s.replace("    }else if(isAmtKind(k)||k==='리버스복귀') continue;","    }else if(k==='리버스복귀') continue;\n    else if(isAmtKind(k)) trades.push({date:h.date,side:'buy',qty:1,price:+h.amt||1});")],
  ['무매: 평단을 기록 값 대신 체결가로','idx',s=>s.replace("steps.push({date:h.date,held:+h.qtyAfter||0,avg:(+h.qtyAfter>0&&+h.avgAfter>0)?+h.avgAfter:null});","steps.push({date:h.date,held:+h.qtyAfter||0,avg:+h.qtyAfter>0?+h.price:null});")],
  ['VR: 실효평단 대신 이동평균 원가(옛 계산 아님)','idx',s=>s.replace("rows.push({h,held:qty,avgEff:qty>0&&eff>0?eff/qty:null,pnl:_pnl});","rows.push({h,held:qty,avgEff:qty>0?cost/qty:null,pnl:_pnl});")],
  ['VR: 매도 손익 안 넘김','idx',s=>s.replace("pnl:h.type==='sell'?r.pnl:null,label:h.type==='buy'?'매수':'매도'});","pnl:null,label:h.type==='buy'?'매수':'매도'});")],
  ['섀넌: 1배 짝도 레버리지 종목에','idx',s=>s.replace("const sym=String(h.sym||(r.leg==='x1'?c.sym1:c.sym)||'').toUpperCase(); if(!sym) continue;","const sym=String(c.sym||'').toUpperCase(); if(!sym) continue;")],
  ['적립: 평단을 마지막 값으로','idx',s=>s.replace("rows.push({h,held:shares,avg:inv/shares});","rows.push({h,held:shares,avg:p});")],
  ['로테이션: 청산 손익을 분석 장부에서 안 받음','idx',s=>s.replace("price:+h.price,pnl:o?o.pnl:null,label:'청산'});","price:+h.price,pnl:null,label:'청산'});")],
  ['듀얼가드: 날짜 무시하고 마지막 장부로','plan',s=>s.replace("for(const d of dates)put(d,alphaLedgerCalc(Object.assign({},L,{events:(L.events||[]).filter(e=>String(e.date||'')<=d)})));","for(const d of dates)put(d,S);")],
  ['듀얼가드: 손익을 표와 다른 값으로','plan',s=>s.replace("pnl:e.side==='sell'&&pn&&Number.isFinite(pn.profit)?pn.profit:null});","pnl:e.side==='sell'?(+e.price||0)*Math.floor(+e.qty||0):null});")],
  ['연결: 무매 표 그릴 때 그림 안 함','idx',s=>s.replace("  tcRender('inf');   // 거래이력 그림(보일 때만)\n","")],
  ['연결: 듀얼가드 거래이력 탭 열 때 안 그림','plan',s=>s.replace("  if(selected==='history'&&typeof renderAlphaTradeChart==='function')renderAlphaTradeChart();","")],
];
let finished=false;
process.on('exit',code=>{if(!finished&&code===0){console.error('FAIL 시험이 끝까지 돌지 않음');process.exitCode=1;}});
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 거래이력 그림 — 체결가 자리 표시 · 묶음 · 크기 · 평단 계단 · 띠 · 기간 · escape · 값 상자(다음 매수) · 운영 5탭 값 = 각 탭 계산 · 듀얼가드 = 그날 장부 · 연결');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS trade chart · 변이 '+red+'/'+MUT.length+' red');
  finished=true;
})().catch(e=>{console.error(e);process.exit(1);});
