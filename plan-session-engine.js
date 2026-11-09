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
  base:{key:'base',name:'기본 규칙',guardOn:.01,guardOff:.01,bandDn:.10,bandUp:.10,tqReb:0,exp:false}
};
const RETIRED={
  horizons:{10:'10년 추세+폭락매수',15:'15년 Shannon',20:'20년 듀얼모멘텀'},
  rules:{exp1:'새 규칙',exp2:'공격형'}
};
function alphaRules(key){return ALPHA_RULES.base;}   // 규칙은 기본 하나 — 예전 세션에 적힌 exp1·exp2 도 판정에는 쓰지 않는다
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
        const s0=D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));
        const sleeveNow=((pos.TECL*sp.TECL)/Math.max(total,1))/Math.max(D.teclWeight,1e-9);
        // 판정은 공용 alphaDecide (플랜 화면과 같은 글자).
        const dec=alphaDecide({rules:RULES,w,sleeveNow,teclQty:pos.TECL,tqqqQty:pos.TQQQ,tqqqClose:sp.TQQQ,sma:mv,
          tqqqWeight:(pos.TQQQ*sp.TQQQ)/Math.max(total,1),guardWeight:D.guardWeight,yearStart:date.slice(0,4)!==S.dates[p].slice(0,4)});
        const {teclHit,guard,guardFlip,tqReb}=dec;
        const first=!pos.TECL&&!pos.TQQQ&&!pos.SGOV;
        need=teclHit||guardFlip||tqReb||force||first||sgNew;
        if(need){
          const tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;
          const tq=(guardFlip||tqReb||force||first)?(guard==='ON'?Math.max(0,Math.floor(total*D.guardWeight/sp.TQQQ)):0):pos.TQQQ;
          const ts=sgQty(total-tt*sp.TECL-tq*sp.TQQQ);
          targetShares={TECL:tt,TQQQ:tq,SGOV:ts};
        }
        meta={horizon,rules:RULES.key,s0,sigma,w,sleeveNow,guard,teclHit,guardFlip,tqReb};
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

  return {horizon,rules:RULES.key,orderSizingVersion:2,ledger,nav,stats:stats(nav,nTrade),lastDecision,last:nav[nav.length-1]||null,error:''};
}

g.JKPlanSessionEngine={VERSION:2,ORDER_SIZING_BASIS:'previous-settled-close',STRATEGY,DEFAULTS,ALPHA_RULES,RETIRED,alphaRules,retiredReason,alphaDecide,yearDoneAt,FEE_RATE,alphaFee,ledgerEvents,ledgerCalc,replay,stats};
})(typeof window!=='undefined'?window:globalThis);
