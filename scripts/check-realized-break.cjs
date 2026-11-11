#!/usr/bin/env node
'use strict';
/* 분석 탭 월별 · 사이클별 실현손익(운영 v3.131.0 · 듀얼가드 v2.11.0 · 2026-11-11) — 값 시험 + 변이 시험.
   사용자: "적립 거치 제외하고 매수매도가 있는 운영메뉴에 있는 전략들의 세션 분석 탭에 월별 실현손익 목록 추가하고
            싸이클이 있는 전략은 싸이클별 실현손익도 추가해"
   무한매수법은 이미 있다(renderInfBreak). 새로: 밸류리밸런싱(월별 · 사이클별) · 로테이션 · 섀넌 · 듀얼가드(월별).
   실제 파일의 함수를 그대로 돌린다(재구현 없음).
     R1 공용 표 — 월 묶음 · 최근이 위로 · 합계 · 손익률 = 손익 ÷ 분모 · 사이클 표
     R2 VR — 매도 손익 = computeVr 행(합 = realized) · 사이클 = 기록 주차(cyc) · 분모 = netInvested · 지금 사이클 진행중
     R3 로테이션 — 수량 안 적은 청산(손으로 적은 청산)도 들고 있던 전부를 판 것으로 실현손익에 넣는다(버그 고침) · 청산마다 손익
     R4 섀넌 — 매도 손익 = ivsPos(합 = realized)
     R5 듀얼가드 — 월별 = 거래이력 표의 tradePnl · 분모 = 시작자금 · 평단 모르는 매도는 빼고 알림
     R6 자리 · 연결 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={idx:rd('index.html'),plan:rd('plan.html'),eng:rd('plan-session-engine.js')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=marker.endsWith('{')?s+marker.length-1:src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;
const wn=v=>(v<0?'-':'')+'$'+Math.abs(v).toFixed(2);
const cells=html=>[...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<t[dh][^>]*>(.*?)<\/t[dh]>/g)].map(x=>x[1].replace(/<[^>]+>/g,'').trim()));
const blockOf=(I,id)=>{ const a=I.indexOf('<div class="block" id="'+id+'"'); const b=I.indexOf('<div class="block" id=',a+10); return a<0?'':I.slice(a,b<0?undefined:b); };

function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const I=S.idx;
  const ctx={console,Math,Date,JSON,Map,Set,Number,String,Array,Object,isFinite,wn,IVS_FEE:0.0025,dshort:d=>String(d).slice(5).replace('-','/'),__strat:null,$:id=>ctx.__els[id],__els:{}};
  ctx.curStrat=()=>ctx.__strat; vm.createContext(ctx);
  vm.runInContext([fnOf(I,'function realizedBreakHtml(sells, cap, o={}){'),fnOf(I,'function computeVr()'),fnOf(I,'function renderVrBreak(c)'),fnOf(I,'function maLedger(hist, price, principal)'),
    fnOf(I,'function ivsPos(principal,hist)'),fnOf(I,'function ivsSellsOf(c)')].join('\n')+'\n;this.__f={realizedBreakHtml,computeVr,renderVrBreak,maLedger,ivsPos,ivsSellsOf};',ctx);
  const F=ctx.__f;
  // ── R1 공용 표
  { const R=F.realizedBreakHtml([{date:'2026-06-03',pnl:100,cyc:3},{date:'2026-06-20',pnl:-30,cyc:3},{date:'2026-07-01',pnl:50,cyc:4},{date:'',pnl:9},{date:'2026-07-02',pnl:NaN}],1000,{cycle:{label:q=>q+'주차'}});
    const m=cells(R.month), c=cells(R.cycle);
    t('R1 월 표 — 최근이 위로 · 매도 수 · 손익금 · 손익률(÷1,000) · 합계(날짜 · 값 없는 줄은 뺀다)',m.length===4&&m[1][0]==='2026년 07월'&&m[1][1]==='1'&&m[1][2]==='+$50.00'&&m[1][3]==='+5.00%'
      &&m[2][0]==='2026년 06월'&&m[2][1]==='2'&&m[2][2]==='+$70.00'&&m[2][3]==='+7.00%'&&m[3][0]==='합계'&&m[3][1]==='3'&&m[3][2]==='+$120.00'&&m[3][3]==='+12.00%',JSON.stringify(m));
    t('R1b 사이클 표 — 사이클마다 · 큰 번호가 위로 · 합계',c.length===4&&c[1][0]==='4주차'&&c[1][2]==='+$50.00'&&c[2][0]==='3주차'&&c[2][1]==='2'&&c[3][2]==='+$120.00',JSON.stringify(c));
    const E=F.realizedBreakHtml([],0,{cycle:{label:q=>q}});
    t('R1c 매도 없음 — 안내 한 줄 · 분모 0 이면 손익률 —',/매도 기록이 없습니다/.test(E.month)&&/아직 매도가 없습니다/.test(E.cycle)&&/<td>—<\/td>/.test(F.realizedBreakHtml([{date:'2026-01-02',pnl:5}],0).month)); }
  // ── R2 VR
  { ctx.__strat={settings:{ticker:'TQQQ',band:15,startpool:1000},hist:[{type:'buy',date:'2026-03-02',price:50,qty:100,fee:1,init:true,cyc:0},{type:'buy',date:'2026-03-16',price:45,qty:10,fee:0.5,cyc:1},
      {type:'sell',date:'2026-03-30',price:60,qty:20,fee:1.2,cyc:2},{type:'wd',date:'2026-04-01',amt:300,cyc:2},{type:'sell',date:'2026-04-13',price:62,qty:10,fee:0.6,cyc:3},{type:'sell',date:'2026-04-14',price:63,qty:5,fee:0.3,cyc:3}]};
    const c=F.computeVr(); ctx.__els={vr_bymonth:{innerHTML:''},vr_bycycle:{innerHTML:''}}; F.renderVrBreak(c);
    const m=cells(ctx.__els.vr_bymonth.innerHTML), cy=cells(ctx.__els.vr_bycycle.innerHTML), tot=m[m.length-1], ctot=cy[cy.length-1];
    const pnls=c.rows.filter(r=>r.h.type==='sell').map(r=>r.pnl), apr=pnls[1]+pnls[2];
    t('R2 VR 월별 — 4월(2번) · 3월(1번) · 합계 = computeVr.realized · 손익률 분모 = netInvested(출금 반영)',m.length===4&&m[1][0]==='2026년 04월'&&m[1][1]==='2'&&m[1][2]===(apr>=0?'+':'')+wn(apr)
      &&tot[2]===(c.realized>=0?'+':'')+wn(c.realized)&&tot[3]===(c.realized>=0?'+':'')+(c.realized/c.netInvested*100).toFixed(2)+'%'&&c.netInvested!==c.grossIn,JSON.stringify({m,realized:c.realized,ni:c.netInvested}));
    t('R2b VR 사이클별 — 기록 주차(cyc) 3 · 2 · 지금 주차(3)는 진행중(시작일~) · 끝난 주차는 기간(하루면 날짜 하나) · 합계 = realized',cy.length===4&&/^3주차 04\/13~ 진행중$/.test(cy[1][0])&&cy[1][1]==='2'&&/^2주차 03\/30$/.test(cy[2][0])&&ctot[2]===tot[2],JSON.stringify(cy)); }
  // ── R3 로테이션 — 손으로 적은 청산(수량 없음)
  { const L=F.maLedger([{type:'in',date:'2026-01-05',price:30,qty:40},{type:'out',date:'2026-03-20',price:25},{type:'out',date:'2026-03-21',price:26},{type:'in',date:'2026-04-21',price:20,qty:10},{type:'out',date:'2026-05-20',price:22,qty:4}],0,10000);
    const want1=(25-(1200+3)/40)*40-1000*0.0025, want2=(22-(200+0.5)/10)*4-88*0.0025;
    t('R3 로테이션 — 수량 안 적은 청산 = 들고 있던 40주 다 팜(실현에 들어감 · 보유 0) · 들고 있는 게 없을 때의 청산은 무시 · 청산마다 손익',L.outs.length===2&&L.outs[0].qty===40&&near(L.outs[0].pnl,want1)&&L.outs[1].qty===4&&near(L.outs[1].pnl,want2)
      &&near(L.realized,want1+want2)&&L.nOut===2&&L.qty===6,JSON.stringify({outs:L.outs,realized:L.realized,qty:L.qty,nOut:L.nOut}));
    const mt=cells(F.realizedBreakHtml(L.outs.map(o=>({date:o.date,pnl:o.pnl})),10000).month);
    t('R3b 로테이션 월별 합계 = maLedger 실현손익',mt[mt.length-1][2]===(L.realized>=0?'+':'')+wn(L.realized),JSON.stringify(mt)); }
  // ── R4 섀넌
  { const P=F.ivsPos(5000,[{type:'buy',date:'2026-05-01',qty:10,price:60,amt:600,fee:0.6,leg:'lev',sym:'TQQQ'},{type:'buy',date:'2026-05-08',qty:5,price:40,amt:200,leg:'x1',sym:'QQQ'},
      {type:'sell',date:'2026-05-15',qty:4,price:70,amt:280,fee:0.3,leg:'lev',sym:'TQQQ'},{type:'sell',date:'2026-06-02',qty:2,price:45,amt:90,leg:'x1',sym:'QQQ'}]);
    const S=F.ivsSellsOf({posRows:P.rows}), sum=S.reduce((a,x)=>a+x.pnl,0);
    t('R4 섀넌 — 매도 2건(레버리지 · 1배) · 손익 합 = ivsPos realized · 매수는 안 들어감',S.length===2&&near(sum,P.realized)&&S[0].date==='2026-05-15',JSON.stringify({S,r:P.realized})); }
  // ── R5 듀얼가드
  { const P=S.plan, c={console,Math,Date,JSON,Map,Set,Number,String,Array,Object,isFinite,usd2:v=>(v<0?'-':'')+'$'+Math.abs(v).toFixed(2),__els:{}}; c.window=c; c.$=id=>c.__els[id]; vm.createContext(c); vm.runInContext(S.eng,c);
    vm.runInContext('function alphaEventList(ledger){return JKPlanSessionEngine.ledgerEvents(ledger);}function alphaLedgerCalc(ledger){return JKPlanSessionEngine.ledgerCalc(ledger);}var alphaLedger=null;function num(){return 20000;}\n'
      +fnOf(P,'function alphaMonthRows(ledger)')+'\n'+fnOf(P,'function renderAlphaMonth()')+'\n;this.__g={alphaMonthRows,renderAlphaMonth,set:L=>{alphaLedger=L;}};',c);
    const L={base:{date:'2026-09-01',tecl:5,tqqq:0,sgov:0,cash:20000,avgTecl:null},events:[
      {id:'1',type:'trade',date:'2026-09-23',symbol:'TQQQ',side:'buy',qty:74,price:79,fee:5.8},{id:'2',type:'trade',date:'2026-10-05',symbol:'TQQQ',side:'sell',qty:20,price:70,fee:1.4},
      {id:'3',type:'trade',date:'2026-11-02',symbol:'TQQQ',side:'sell',qty:54,price:59.46,fee:3.2},{id:'4',type:'trade',date:'2026-11-03',symbol:'TECL',side:'sell',qty:5,price:140,fee:0.7}]};
    const R=c.__g.alphaMonthRows(L); c.__g.set(L); c.__els.alphaMonthBody={innerHTML:''}; c.__g.renderAlphaMonth(); const m=cells(c.__els.alphaMonthBody.innerHTML);
    const oct=(70-79)*20, nov=(59.46-79)*54;
    t('R5 듀얼가드 — 11월 · 10월 · 손익 = tradePnl(매도 당시 평단 · 수수료 제외) · 평단 모르는 TECL 매도 1건은 빼고 알림 · 손익률 ÷ 시작자금 20,000',R.rows.length===2&&R.unknown===1&&R.rows[0].month==='2026-11'&&near(R.rows[0].p,nov)&&R.rows[1].n===1&&near(R.rows[1].p,oct)
      &&m[1][0]==='2026년 11월'&&m[3][0]==='합계'&&m[3][1]==='2'&&m[3][3]===((oct+nov)/20000*100).toFixed(2)+'%'.replace(/^/,(oct+nov)>=0?'+':'')&&/평단을 모르는 매도 1건은 빠졌습니다/.test(c.__els.alphaMonthBody.innerHTML),JSON.stringify({R,m})); }
  // ── R6 자리 · 연결
  { const P=S.plan;
    t('R6 자리 — VR 분석(월별 · 사이클별) · 로테이션 · 섀넌 분석(월별) · 적립은 없음 · 무매 원래 표 그대로',/id="vr_bymonth"/.test(blockOf(I,'vr-anal'))&&/id="vr_bycycle"/.test(blockOf(I,'vr-anal'))&&/id="ma_bymonth"/.test(blockOf(I,'ma-anal'))
      &&/id="ivs_bymonth"/.test(blockOf(I,'ivs-anal'))&&!/_bymonth/.test(blockOf(I,'dca-anal'))&&/id="a_bymonth"/.test(blockOf(I,'inf-anal'))&&/id="a_bycycle"/.test(blockOf(I,'inf-anal')));
    t('R6b 연결 — 분석 탭 그릴 때 채움(VR renderVrBreak · 로테 maLedger 청산 · 섀넌 ivsSellsOf) · 듀얼가드 분석 탭 상자 · 장부 그릴 때 채움',/renderVrBreak\(c\);/.test(fnOf(I,'function renderVrAnal()'))
      &&/\$\('ma_bymonth'\)[^\n]*realizedBreakHtml\(\(L\.outs\|\|\[\]\)/.test(fnOf(I,'function renderMaAnal()'))&&/\$\('ivs_bymonth'\)[^\n]*realizedBreakHtml\(ivsSellsOf\(c\),principal\)/.test(fnOf(I,'function renderIvsAnal()'))
      &&/<div class="todaybox" id="alphaMonthSection" data-asset-view="analysis" hidden>/.test(P)&&/renderAlphaMonth\(\);/.test(fnOf(P,'function renderAlphaLedger()'))); }
  return bad;
}

const MUT=[
  ['공용 표: 날짜별로 묶음','idx',s=>s.replace("const k=String(x.date).slice(0,7); if(k.length!==7) continue; const m=M.get(k)||{label:k.replace('-','년 ')+'월'","const k=String(x.date).slice(0,10); if(k.length!==10) continue; const m=M.get(k)||{label:k.replace('-','년 ')+'월'")],
  ['공용 표: 오래된 달이 위로','idx',s=>s.replace("const out={month:table('월',[...M.entries()].sort((a,b)=>b[0]<a[0]?-1:1)","const out={month:table('월',[...M.entries()].sort((a,b)=>a[0]<b[0]?-1:1)")],
  ['공용 표: 합계에 매도 수 안 더함','idx',s=>s.replace("let tot=0,n=0; const rows=list.map(x=>{ tot+=x.p; n+=x.n;","let tot=0,n=0; const rows=list.map(x=>{ tot+=x.p;")],
  ['VR: 사이클 = 달','idx',s=>s.replace("const cy=h=>h.cyc!=null?h.cyc:0, span=new Map();","const cy=h=>+String(h.date||'').slice(5,7), span=new Map();")],
  ['VR: 분모 = 들어온 돈 전부(출금 무시)','idx',s=>s.replace("const R=realizedBreakHtml(sells,c.netInvested,{cycle:","const R=realizedBreakHtml(sells,c.grossIn,{cycle:")],
  ['VR: 진행중 표시 없음','idx',s=>s.replace("const x=span.get(seq)||{}, open=seq===c.curCyc;","const x=span.get(seq)||{}, open=false;")],
  ['로테이션: 수량 없는 청산 건너뜀(옛 코드)','idx',s=>s.replace("if(!(pr>0)||(x.type==='in'&&!(q>0))) return;","if(!(q>0)||!(pr>0)) return;")],
  ['로테이션: 빈 청산도 센다','idx',s=>s.replace("const sq=q>0?Math.min(q,qty):qty; if(!(sq>0)) return;","const sq=q>0?Math.min(q,qty):qty;")],
  ['섀넌: 매수도 매도로','idx',s=>s.replace("filter(r=>r.h&&r.h.type==='sell'&&r.held!=null)","filter(r=>r.h&&r.held!=null)")],
  ['듀얼가드: 평단 모르는 매도를 0 으로 셈','plan',s=>s.replace("const pn=S.tradePnl[e._i];if(!pn||!Number.isFinite(pn.profit)){unknown++;continue;}","const pn=S.tradePnl[e._i]||{profit:0};if(!Number.isFinite(pn.profit))pn.profit=0;")],
  ['듀얼가드: 분모 = 1','plan',s=>s.replace("const R=alphaMonthRows(alphaLedger),cap=Math.max(0,num('startCapital'))","const R=alphaMonthRows(alphaLedger),cap=1")],
  ['연결: VR 분석에서 안 채움','idx',s=>s.replace("  renderVrBreak(c);   // 월별 · 사이클별 실현손익(2026-11-11)\n","")],
];
const bad=check(SRC);
if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 분석 탭 월별 · 사이클별 실현손익 — 공용 표 · VR(realized · netInvested · 주차 · 진행중) · 로테이션(손으로 적은 청산 실현) · 섀넌(ivsPos) · 듀얼가드(tradePnl · 시작자금) · 자리 · 연결');
let red=0;
for(const [name,key,mut] of MUT){
  const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
  let failed=false;try{failed=check({...SRC,[key]:m}).length>0;}catch(e){failed=true;}
  if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  red++;console.log('PASS 변이 빨간불: '+name);
}
console.log('ALL PASS realized break · 변이 '+red+'/'+MUT.length+' red');
