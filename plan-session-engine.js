(function(g){
'use strict';

const DEFAULTS={
  5:{teclWeight:.70,guardWeight:.30,ivsLook:20,ivsS0:.55,ivsBand:.10,guardMA:225,guardBand:.01}
};
const FEE_RATE=.001;
/* 🤖 클로드 탭 5년 플랜 — '듀얼가드' (2026-11-08 사용자: "현재 5년 플랜 전략 이름도 정하고 · 넌 클로드 탭만 담당").
   TECL 은 변동성으로 크기를 정하고(역분산 · 변동성 가드), TQQQ 는 추세로 켜고 끈다(SMA225 · 추세 가드) — 두 겹의 가드.
   화면(plan.html)·모의 목록(index.html)이 이 이름과 판 번호를 함께 쓴다(같은 걸 두 군데서 세지 않는다). */
const STRATEGY={key:'dualGuard',name:'듀얼가드',owner:'claude',version:'1.0',since:'2026-11-08',
  summary:'TECL 역분산 70% + TQQQ 추세 Guard 30% + SGOV'};
/* 5년 플랜 규칙 — 플랜 화면(renderAlphaPlan)과 모의 재생(replay)이 같은 alphaDecide 로 판정한다 (같은 걸 두 군데서 세지 않는다).
   규칙은 하나(base)뿐이다. 2026-11-08 폐지: exp1 '새 규칙'·exp2 '공격형' — 앱 엔진(전일 종가 주수)·세후로 다시 재니 기본보다 낫지 않았다
   (2011-04~2026-11 · 2만$ 거치 세후 연 30.9/29.9/30.7% · MDD 40.6/38.1/42.1% · research/im_plan/RESEARCH_LOG.md 11-08 정정).
   10·15·20년 플랜도 같은 날 사용자 지시로 폐지. 예전에 그 규칙·기간으로 만든 세션은 지우지 않고 목록에서 숨긴다(retiredReason). */
const ALPHA_RULES={
  base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:0,exp:false},
  /* 공포 모드 v1.1 — 실험적 확장(공식 규칙 아님 · 2026-11-10 사용자 승인 "그래 하자" · 모의 세션에서만 고른다).
     기본 규칙 위에 얹는다: VIX 전일 종가 ≥ hi 면 '무장' → 무장한 채 < lo 로 내려오면 '진정'.
     ① 진정일에 Guard OFF 이고 TQQQ > SMA(ma)×(1+band) 면 TQQQ 를 다시 켜고, 그동안은 SMA(ma) ±band 로 켜고 끈다(빠른 모드).
        TQQQ > SMA225×(1+guardOn) 이면 보통 모드로 돌아가고 무장을 푼다. ② 진정 뒤 TECL σ20 > k×VXN 인 동안 TECL 목표의 σ = min(σ20, k×VXN)
        (VXN 이 없는 날은 fbK×VIX) — 폭락 날들이 20일 창에서 빠질 때까지만.
     근거: research/im_plan/RESEARCH_LOG.md 2026-11-10 '공포 모드' · REPLICATION.md R-20261110-1(지피티 재현 확인).
     앱 엔진 세후 5년 창 128개(2.5만$+월 210$): 연 중앙 28.6 → 30.5% · MDD 중앙 39.1 → 36.8% · 최악 MDD 같음. 이득은 V자 반등 몇 번(2015·2020·2025)에 몰리고
     2011 같은 두 번 오는 공포에선 휩쏘로 잃는다(×0.95). 1987~99 에는 증거가 없다. */
  panic:{key:'panic',name:'공포 모드',version:'1.1',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:0,exp:true,
    panic:{hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6}}
};
const RETIRED={
  horizons:{10:'10년 추세+폭락매수',15:'15년 Shannon',20:'20년 듀얼모멘텀'},
  rules:{exp1:'새 규칙',exp2:'공격형'}
};
function alphaRules(key){const k=String(key&&key.key||key||'');return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}   // 기본 + 공포 모드(실험) — 예전 세션에 적힌 exp1·exp2 는 판정에 쓰지 않는다
/* 화면·모의 목록에 쓰는 이름 — 기본 '듀얼가드 v1.0' · 공포 모드 '듀얼가드 v1.1 공포 모드(실험)'. 공식 결과와 실험 결과가 같은 이름으로 보이지 않게 한 곳에서 만든다. */
function strategyLabel(rules){const R=alphaRules(rules);return STRATEGY.name+' v'+(R.version||STRATEGY.version)+(R.exp?' '+R.name+'(실험)':'');}
/* 공포 모드 하루 판정 — 전일 확정값만 받는다(룩어헤드 없음). 상태 st={armed,pf,armS,ps,gN} 를 고쳐 쓰고 {guard, sigma, iv, events} 를 돌려준다.
   a={rules, vix, vxn, tqqqClose, sma(225), fast(SMA ma), sigma(σ20), posOn(TQQQ 보유 중)}
   st.gN = 보통 Guard(SMA225 ±1%) 상태 — 빈 계좌·중립 밴드는 OFF(기본 규칙과 같은 시작) · st.armed 무장 · st.pf Guard 빠른 모드 · st.armS/ps 슬리브 무장/빠른 모드
   모의 재생(replay)과 화면(다음 주문 판정)이 이 함수 하나를 쓴다 — 같은 걸 두 군데서 세지 않는다. */
function panicStep(st,a){
  const R=a.rules,P=R.panic,ev=[],v=a.vix,c=a.tqqqClose,fm=a.fast,b=P.band;
  let sigma=a.sigma;
  const iv=a.vxn!=null&&+a.vxn>0?+a.vxn/100*P.k:(v!=null&&+v>0?+v/100*P.fbK:null);
  if(v!=null&&v>=P.hi)st.armS=true;
  if(st.armS&&v!=null&&v<P.lo){st.ps=true;st.armS=false;ev.push('sleeveOn');}
  if(st.ps&&iv!=null){if(a.sigma<=iv){st.ps=false;ev.push('sleeveOff');}else sigma=Math.min(a.sigma,iv);}
  const up=a.sma*(1+R.guardOn),lo=a.sma*(1-R.guardOff),wasArmed=st.armed,wasPf=st.pf;
  if(c>up)st.gN=true;else if(c<lo)st.gN=false;
  if(v!=null&&v>=P.hi)st.armed=true;
  let guard;
  if(st.gN){st.pf=false;st.armed=false;guard='ON';if(wasPf)ev.push('normal');}
  else if(!st.pf){guard='OFF';if(st.armed&&v!=null&&v<P.lo&&fm>0&&c>fm*(1+b)){st.pf=true;guard='ON';ev.push('fastOn');}}
  else guard=(fm>0&&c>fm*(1+b))?'ON':(fm>0&&c<fm*(1-b))?'OFF':(a.posOn?'ON':'OFF');
  if(st.armed&&!wasArmed)ev.push('armed');
  return {guard,sigma,iv,events:ev};
}
function panicState(){return {armed:false,pf:false,armS:false,ps:false,gN:false};}
/* 세션이 폐지된 기간·규칙으로 만들어졌으면 그 이름을, 아니면 '' — 플랜 화면 세션 목록과 모의 목록이 같은 함수로 거른다 */
function retiredReason(x){
  if(!x)return '';
  const h=+(x.horizon??(x.settings&&x.settings.horizon)??5);
  if(h!==5)return RETIRED.horizons[h]||(h+'년 기간');
  const r=String((x.settings&&x.settings.alphaRules)||x.alphaRules||x.rules||'');
  return RETIRED.rules[r]||'';
}
/* 다음 거래일(평일 기준)이 해가 바뀐 첫 거래일인가 — 1월 1일은 휴장이라 평일로 넘겨도 새해 첫 거래일은 1월 안에 있다. */
function yearDoneAt(dateStr){
  const d=new Date(String(dateStr||'')+'T00:00:00Z');if(isNaN(d))return false;const y=d.getUTCFullYear();
  do{d.setUTCDate(d.getUTCDate()+1);}while(d.getUTCDay()===0||d.getUTCDay()===6);
  return d.getUTCFullYear()!==y;
}
/* 5년 플랜 하루 판정 — 전일 확정값만 받는다.
   a={rules, w(목표 슬리브 비율), sleeveNow, teclQty, tqqqQty, tqqqClose, sma, tqqqWeight(전체 대비 TQQQ 비중), guardWeight, yearStart}
   반환 {rules, teclHit, guard, guardFlip, tqReb, upper, lower} — tqReb: 해 첫 거래일 TQQQ 30% 맞춤(exp1 · Guard ON 유지 중일 때만) */
function alphaDecide(a){
  const R=alphaRules(a.rules&&a.rules.key||a.rules);
  const teclHit=!(a.teclQty>0)||(a.sleeveNow-a.w>R.bandDn)||(a.w-a.sleeveNow>R.bandUp);
  const upper=a.sma*(1+R.guardOn),lower=a.sma*(1-R.guardOff),posOn=a.tqqqQty>0;
  const guard=a.tqqqClose>upper?'ON':a.tqqqClose<lower?'OFF':(posOn?'ON':'OFF'),guardFlip=(guard==='ON')!==posOn;
  const tqReb=R.tqReb>0&&!!a.yearStart&&guard==='ON'&&!guardFlip&&Math.abs((+a.tqqqWeight||0)-(+a.guardWeight||0))>R.tqReb;
  return {rules:R,teclHit,guard,guardFlip,tqReb,upper,lower};
}

function alphaFee(q,p){
  const gross=Math.max(0,(+q||0)*(+p||0));
  return gross<=10?0:Math.floor(gross*FEE_RATE*100)/100;
}
/* 운영 장부(듀얼가드 '현재 투자중'·운영 세션) — base(시작 잔고) + events(체결·현금·보정)를 날짜 → 기록 순서로 걸어 지금 수량·평단·현금을 센다.
   플랜 화면(plan.html alphaEventList·alphaLedgerCalc)과 포트폴리오(index.html)가 이 두 함수를 같이 쓴다 — 같은 장부를 두 곳에서 따로 세지 않는다.
   2026-11-09 plan.html 에서 그대로 옮겼다(내용 같음 · scripts/check-portfolio.cjs 가 옮기기 전 코드와 결과가 같은지 본다). */
function ledgerEvents(ledger){
  return (Array.isArray(ledger&&ledger.events)?ledger.events:[]).map((e,i)=>({...e,_i:i}))
    .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||a._i-b._i);
}
function ledgerCalc(ledger){
  const b=ledger&&ledger.base?ledger.base:{};
  const S={
    tecl:Math.max(0,Math.floor(+b.tecl||0)),tqqq:Math.max(0,Math.floor(+b.tqqq||0)),sgov:Math.max(0,Math.floor(+b.sgov||0)),
    avgTecl:Number.isFinite(+b.avgTecl)&&+b.avgTecl>0?+b.avgTecl:null,avgTqqq:Number.isFinite(+b.avgTqqq)&&+b.avgTqqq>0?+b.avgTqqq:null,avgSgov:Number.isFinite(+b.avgSgov)&&+b.avgSgov>0?+b.avgSgov:null,
    cash:Number.isFinite(+b.cash)?+b.cash:0,minCash:Number.isFinite(+b.cash)?+b.cash:0,invalid:false,error:"",divIn:0,netFlow:0,tradePnl:{}
  };
  for(const e of ledgerEvents(ledger)){
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
}
function sma(a,n){
  const out=Array(a.length).fill(null);let s=0;
  for(let i=0;i<a.length;i++){s+=+a[i]||0;if(i>=n)s-=+a[i-n]||0;if(i>=n-1)out[i]=s/n;}
  return out;
}
function realizedVol(a,idx,n){
  if(idx<n)return null;const r=[];
  for(let i=idx-n+1;i<=idx;i++){const p=+a[i-1],c=+a[i];if(!(p>0&&c>0))return null;r.push(c/p-1);}
  const m=r.reduce((x,y)=>x+y,0)/r.length,v=r.reduce((x,y)=>x+(y-m)*(y-m),0)/r.length;
  return Math.sqrt(Math.max(v,0)*252);
}
function mapRows(rows){
  const m=new Map();
  for(const x of rows||[])if(x&&x.date&&+x.close>0)m.set(String(x.date),+x.close);
  return m;
}
function mapDiv(rows){
  const m=new Map();
  for(const x of rows||[]){if(!x||!x.date)continue;const a=+x.amount||+x.dividend||0;if(a>0)m.set(String(x.date),(m.get(String(x.date))||0)+a);}
  return m;
}
/* 날짜 축은 TECL·TQQQ 둘 다 있는 날이다. SGOV 는 날짜를 자르지 않는다.
   예전엔 SGOV(2020-06 상장)까지 교집합에 넣어 그 앞 이력이 통째로 잘렸다 — SMA225·변동성·모멘텀 예열이
   2020-06 부터 다시 시작해 2021-04 까지 신호가 없었고, 그 전에 시작한 세션은 1년 넘게 현금만 들었다
   (2020-01 시작 5년 플랜: 2020년 수익 0% · 앞 16개월 무거래). 신호는 두 종목의 전 이력으로 예열한다.
   SGOV 가 아직 없는 날은 null — 그날 남는 돈은 현금(이자 0)으로 둔다. 상장 뒤 빠진 날은 직전 값으로 잇는다. */
function commonSeries(tecl,tqqq,sgov,endDate){
  const tm=mapRows(tecl),qm=mapRows(tqqq),sm=mapRows(sgov);
  const dates=[...(tqqq||[])].map(x=>String(x.date||'')).filter(d=>d&&tm.has(d)&&qm.has(d)&&(!endDate||d<=endDate)).sort();
  let lastS=null;
  return {dates,tecl:dates.map(d=>tm.get(d)),tqqq:dates.map(d=>qm.get(d)),sgov:dates.map(d=>{if(sm.has(d))lastS=sm.get(d);return lastS;})};
}
function initialLedger(start,principal){
  return {base:{date:start,tecl:0,tqqq:0,sgov:0,cash:principal,avgTecl:null,avgTqqq:null,avgSgov:null},events:[],feeModel:'toss-us-0.1-v1'};
}
function evtId(date,n){return 'planpaper_'+String(date).replace(/-/g,'')+'_'+n;}
function addCash(ledger,date,kind,amount,n){
  if(!(amount>0))return;
  ledger.events.push({id:evtId(date,n),date,type:'cash',kind,amount:+amount});
}
function addTrade(ledger,date,side,sym,qty,price,fee,n,signalDate){
  ledger.events.push({id:evtId(date,n),date,type:'trade',side,symbol:sym,qty,price,fee,feeRate:FEE_RATE,signalDate,sim:true});
}
function stats(nav,nTrade){
  if(!nav.length)return null;
  let peak=-Infinity,mdd=0,n=0;
  for(const x of nav){
    if(!(x.inflow>0&&x.total>0))continue;
    const u=x.total/x.inflow;if(!isFinite(u)||u<=0)continue;n++;
    if(u>peak)peak=u;else if(peak>0)mdd=Math.max(mdd,(peak-u)/peak);
  }
  const a=nav[0],z=nav[nav.length-1];
  const span=Math.max(1,Math.round((new Date(z.date+'T00:00:00Z')-new Date(a.date+'T00:00:00Z'))/864e5));
  const yrs=Math.max(.05,span/365.25),base=Math.max(1,z.inflow),total=z.total;
  return {from:a.date,to:z.date,spanDays:span,yrs,inflow:base,total,ret:(total/base-1)*100,
    cagr:(Math.pow(Math.max(total,1)/base,1/yrs)-1)*100,mdd:mdd*100,nDay:n,nTrade:nTrade||0};
}
function targetOrders(target,pos,px,cash,date,signalDate,ledger,seq){
  let nTrade=0,avail=Math.max(0,cash),n=seq;
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=(target[sym]||0)-(pos[sym]||0);
    if(dq<0&&px[sym]>0){
      const q=-dq,p=px[sym],f=alphaFee(q,p),gross=q*p;
      avail+=gross-f;pos[sym]-=q;nTrade++;addTrade(ledger,date,'sell',sym,q,p,f,n++,signalDate);
    }
  }
  for(const sym of ['TECL','TQQQ','SGOV']){
    const dq=(target[sym]||0)-(pos[sym]||0);
    if(dq>0&&px[sym]>0){
      const p=px[sym],max=Math.floor(avail/(p*(1+FEE_RATE))),q=Math.max(0,Math.min(dq,max));
      if(q>0){const f=alphaFee(q,p),gross=q*p;avail-=gross+f;pos[sym]+=q;nTrade++;addTrade(ledger,date,'buy',sym,q,p,f,n++,signalDate);}
    }
  }
  return {cash:avail,nTrade,seq:n};
}
function replay(opt){
  opt=opt||{};
  const start=String(opt.startDate||''),end=String(opt.endDate||'');
  const principal=Math.max(0,+opt.principal||0),monthlyAdd=Math.max(0,+opt.monthlyAdd||0);
  /* 폐지된 기간·규칙(10·15·20년 · 새 규칙 · 공격형)은 다른 규칙으로 몰래 다시 계산하지 않는다 — 오류로 돌려준다 */
  const gone=retiredReason({horizon:opt.horizon==null?5:opt.horizon,rules:opt.rules});
  if(gone)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'폐지된 세션 — '+gone,retired:gone};
  const horizon=5,RULES=alphaRules(opt.rules);
  if(!start||!(principal>0))return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'시작일 또는 원금 없음'};
  const S=commonSeries(opt.tecl,opt.tqqq,opt.sgov,end);
  if(!S.dates.length)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'공통 시세 없음'};
  const startIdx=S.dates.findIndex(d=>d>=start);
  if(startIdx<0)return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'시작일 이후 시세 없음'};

  const tma225=sma(S.tqqq,225);
  /* 공포 모드: VIX·VXN 을 날짜 축(TECL·TQQQ 공통 거래일)에 직전 값으로 잇는다. VIX 가 없으면 기본 규칙으로 몰래 계산하지 않고 오류로 돌려준다. */
  const PN=RULES.panic||null;
  if(PN&&!(Array.isArray(opt.vix)&&opt.vix.length))return {nav:[],ledger:initialLedger(start,principal),stats:null,error:'공포 모드 — VIX 시세 없음'};
  const onAxis=rows=>{const m=mapRows(rows);let l=null;return S.dates.map(d=>{if(m.has(d))l=m.get(d);return l;});};
  const fastMA=PN?sma(S.tqqq,PN.ma):null,vixA=PN?onAxis(opt.vix):null,vxnA=PN?onAxis(opt.vxn):null,pst=PN?panicState():null,plog=[];
  const panicAt=(st,p,posOn,sigma,mv)=>panicStep(st,{rules:RULES,vix:vixA[p],vxn:vxnA[p],tqqqClose:S.tqqq[p],sma:mv,fast:fastMA[p],sigma,posOn});
  const div={TECL:mapDiv(opt.teclDiv),TQQQ:mapDiv(opt.tqqqDiv),SGOV:mapDiv(opt.sgovDiv)};
  const ledger=initialLedger(start,principal),pos={TECL:0,TQQQ:0,SGOV:0};
  let cash=principal,inflow=principal,nTrade=0,seq=1,lastMonth=start.slice(0,7),lastDecision=null;
  const nav=[];

  for(let i=startIdx;i<S.dates.length;i++){
    const date=S.dates[i],month=date.slice(0,7);let force=false;
    // 확정 종가 p로 미리 주문 수량을 결정하고, i일 종가는 체결·평가에만 사용한다.
    // 리밸런싱 신호는 미확정 i일 가격을 읽지 않는다.
    if(month!==lastMonth&&monthlyAdd>0){
      cash+=monthlyAdd;inflow+=monthlyAdd;addCash(ledger,date,'dep',monthlyAdd,seq++);lastMonth=month;force=true;
    }else if(month!==lastMonth)lastMonth=month;

    const dc=pos.TECL*(div.TECL.get(date)||0)+pos.TQQQ*(div.TQQQ.get(date)||0)+pos.SGOV*(div.SGOV.get(date)||0);
    if(dc>0){cash+=dc;addCash(ledger,date,'div',dc,seq++);}

    const p=i-1;
    if(p>=0){
      const sp={TECL:S.tecl[p],TQQQ:S.tqqq[p],SGOV:S.sgov[p]};
      const ep={TECL:S.tecl[i],TQQQ:S.tqqq[i],SGOV:S.sgov[i]};
      let total=pos.TECL*sp.TECL+pos.TQQQ*sp.TQQQ+pos.SGOV*(sp.SGOV||0)+cash;
      if(!(total>0))total=inflow;
      let need=false,targetShares={...pos},meta={horizon};
      // 남는 돈 → SGOV 주수. 상장 전(시세 null)이면 0 — 현금으로 둔다.
      const sgQty=rest=>sp.SGOV>0?Math.max(0,Math.floor(Math.max(0,rest)/sp.SGOV)):0;
      // SGOV 가 막 상장한 날(전일 확정 기준): 그동안 현금으로 둔 돈을 한 번 SGOV 로 옮긴다.
      const sgNew=sp.SGOV>0&&!(p>0&&S.sgov[p-1]>0)&&cash>0;

      const D=DEFAULTS[5],sigma=realizedVol(S.tecl,p,D.ivsLook),mv=tma225[p];
      if(sigma>0&&mv>0){
        const pm=PN?panicAt(pst,p,pos.TQQQ>0,sigma,mv):null;
        if(pm)for(const e of pm.events)plog.push({date,signalDate:S.dates[p],ev:e,vix:vixA[p],vxn:vxnA[p],sigma,iv:pm.iv,tqqq:sp.TQQQ,sma:mv,fast:fastMA[p]});
        const s0=D.ivsS0,sigUse=pm?pm.sigma:sigma,w=Math.min(1,(s0*s0)/(sigUse*sigUse));
        const sleeveNow=((pos.TECL*sp.TECL)/Math.max(total,1))/Math.max(D.teclWeight,1e-9);
        // 판정은 공용 alphaDecide (플랜 화면과 같은 글자).
        const dec=alphaDecide({rules:RULES,w,sleeveNow,teclQty:pos.TECL,tqqqQty:pos.TQQQ,tqqqClose:sp.TQQQ,sma:mv,
          tqqqWeight:(pos.TQQQ*sp.TQQQ)/Math.max(total,1),guardWeight:D.guardWeight,yearStart:date.slice(0,4)!==S.dates[p].slice(0,4)});
        let {teclHit,guard,guardFlip,tqReb}=dec;
        if(pm){guard=pm.guard;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}   // 공포 모드: Guard 는 panicStep 이 정한다(보통 모드면 기본 판정과 같다)
        const first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
        need=teclHit||guardFlip||tqReb||force||first||sgNew;
        if(need){
          const tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;
          const tq=(guardFlip||tqReb||force||first)?(guard==='ON'?Math.max(0,Math.floor(total*D.guardWeight/sp.TQQQ)):0):pos.TQQQ;
          const ts=sgQty(total-tt*sp.TECL-tq*sp.TQQQ);
          targetShares={TECL:tt,TQQQ:tq,SGOV:ts};
        }
        meta={horizon,rules:RULES.key,s0,sigma,w,sleeveNow,guard,teclHit,guardFlip,tqReb};
        if(pm)meta.panic={armed:pst.armed,fast:pst.pf,sleeve:pst.ps,iv:pm.iv,sigmaUsed:sigUse};
      }

      if(need){
        const r=targetOrders(targetShares,pos,ep,cash,date,S.dates[p],ledger,seq);
        cash=r.cash;nTrade+=r.nTrade;seq=r.seq;
      }
      lastDecision={date,signalDate:S.dates[p],need,meta,target:{...targetShares}};
    }

    const total=pos.TECL*S.tecl[i]+pos.TQQQ*S.tqqq[i]+pos.SGOV*(S.sgov[i]||0)+cash;
    nav.push({date,total,inflow,cash,tecl:pos.TECL,tqqq:pos.TQQQ,sgov:pos.SGOV,teclPx:S.tecl[i],tqqqPx:S.tqqq[i],sgovPx:S.sgov[i]});
  }

  const out={horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,stats:stats(nav,nTrade),lastDecision,last:nav[nav.length-1]||null,error:''};
  if(PN){
    /* 화면용: 마지막 확정일(자료 끝) 신호로 본 '다음 거래일' 판정과 상태 — 재생 상태를 복사해 한 걸음만 더 간다(재생 장부는 건드리지 않는다). */
    const p=S.dates.length-1,sg=p>=0?realizedVol(S.tecl,p,DEFAULTS[5].ivsLook):null,mv=p>=0?tma225[p]:null,st=Object.assign({},pst);
    const nx=(sg>0&&mv>0)?panicAt(st,p,pos.TQQQ>0,sg,mv):null;
    out.panic={log:plog,state:st,signalDate:p>=0?S.dates[p]:'',vix:p>=0?vixA[p]:null,vxn:p>=0?vxnA[p]:null,
      next:nx?{guard:nx.guard,sigma:nx.sigma,sigma20:sg,iv:nx.iv,events:nx.events}:null,params:Object.assign({},PN)};
  }
  return out;
}

g.JKPlanSessionEngine={VERSION:2,ORDER_SIZING_BASIS:'previous-settled-close',STRATEGY,DEFAULTS,ALPHA_RULES,RETIRED,alphaRules,strategyLabel,panicStep,panicState,retiredReason,alphaDecide,yearDoneAt,FEE_RATE,alphaFee,ledgerEvents,ledgerCalc,replay,stats};
})(typeof window!=='undefined'?window:globalThis);
