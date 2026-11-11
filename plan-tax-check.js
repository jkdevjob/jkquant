/* 연말 세금 점검 (plan 1.47.0 · 2026-11-07) — 해외주식 양도소득세(1년 실현손익 합산 · 기본공제 250만원 · 22%)를
   자산플랜 거래이력으로 추정하고, 연말에 '팔고 바로 되사기'로 공제를 채우거나(평가이익) 공제 초과분을 상계할(평가손실) 주수를 제안한다.
   조회·안내 기능 — 주문을 내지 않는다. 연구 근거: research/im_plan RESEARCH_LOG.md 11-07 심층 2(세후 CAGR +0.3~0.5%p · 5년 창 116:5).
   - 양도 시기 = 결제일: 미국 T+1(2024-05-28 전 T+2). 그 해 세금에 넣을 마지막 체결일 = lastTradeDate(year).
   - 원화 환산 = 결제일(그날 없으면 직전) USD/KRW 종가 — 신고는 서울외국환중개 기준환율이라 몇 원 다르다. 취득·양도 환율 차이(환차손익)는 들어간다.
   - 취득가 = 선입선출(국내 증권사 해외주식 양도세 기본) · 이동평균 두 방식으로 같이 낸다. 제안은 두 방식 모두에서 성립하는 주수만.
   - 필요경비: 매수 수수료는 취득가에, 매도 수수료는 양도가에서 뺀다. 배당(분배금)은 배당소득이라 넣지 않는다.
   - 시작잔고·보정(reconcile) 기록은 그날 평단 한 덩어리로 본다(그 전 체결 이력이 없으므로 근사).
   포트폴리오(2026-11-11 사용자 "듀얼가드 현재에 연말 세금 점검 양도세는 포트폴리오로 들어가서 포트폴리오에 속한 전략 전부로 판단해야지"):
   공제 · 세율은 사람당 1년 합산이라 판단도 포트폴리오 전략 전부로 한다 — portfolio(). check() 는 장부 하나짜리 portfolio(). */
(function(g){
'use strict';
const DED_KRW=2500000,RATE=0.22,SYMS=['TECL','TQQQ','SGOV'],KEY={TECL:['tecl','avgTecl'],TQQQ:['tqqq','avgTqqq'],SGOV:['sgov','avgSgov']},EPS=1e-9;
const pad=n=>String(n).padStart(2,'0'),iso=d=>d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-'+pad(d.getUTCDate()),parse=s=>new Date(String(s||'')+'T00:00:00Z');
function defaultFee(q,p){const gross=Math.max(0,(+q||0)*(+p||0));return gross<=10?0:Math.floor(gross*0.001*100)/100;}   // plan.html alphaFee 와 같은 식(화면은 alphaFee 를 넘긴다)
/* 미국 결제 휴일 — 연말·연초만 정확히: 1월 1일(일요일이면 1월 2일) · 12월 25일(토요일이면 24일 · 일요일이면 26일). 그 밖의 휴장은 평일로 본다. */
function isHoliday(d){const m=d.getUTCMonth()+1,day=d.getUTCDate(),w=d.getUTCDay();
  return (m===1&&(day===1||(day===2&&w===1)))||(m===12&&(day===25||(day===24&&w===5)||(day===26&&w===1)));}
function isBizDay(d){const w=d.getUTCDay();return w!==0&&w!==6&&!isHoliday(d);}
function settleDate(trade){const d=parse(trade);if(isNaN(d))return '';let n=String(trade)>='2024-05-28'?1:2;while(n>0){d.setUTCDate(d.getUTCDate()+1);if(isBizDay(d))n--;}return iso(d);}
function lastTradeDate(year){const d=parse(year+'-12-31');for(let i=0;i<20;i++,d.setUTCDate(d.getUTCDate()-1)){if(!isBizDay(d))continue;const s=iso(d);if(settleDate(s).slice(0,4)===String(year))return s;}return '';}
/* USD/KRW 일봉 [{date,close}] → date 이하 마지막 값(없으면 첫 값) */
function fxFn(series){
  const a=(Array.isArray(series)?series:[]).filter(x=>x&&x.date&&+x.close>0).map(x=>[String(x.date),+x.close]).sort((p,q)=>p[0]<q[0]?-1:p[0]>q[0]?1:0);
  const f=date=>{if(!a.length)return NaN;let lo=0,hi=a.length-1,ans=-1;while(lo<=hi){const m=(lo+hi)>>1;if(a[m][0]<=date){ans=m;lo=m+1;}else hi=m-1;}return ans>=0?a[ans][1]:a[0][1];};
  f.last=a.length?{date:a[a.length-1][0],rate:a[a.length-1][1]}:null;return f;
}
function eventsOf(ledger){   // plan.html alphaEventList 와 같은 순서(날짜 · 같은 날은 기록 순)
  return (Array.isArray(ledger&&ledger.events)?ledger.events:[]).map((e,i)=>({...e,_i:i})).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||a._i-b._i);
}
/* 체결 하나 — 듀얼가드 장부(build)와 운영 체결 목록(buildTrades)이 같은 셈을 쓴다(같은 걸 두 군데서 세지 않는다).
   매수: 수수료는 취득가에 · 매도: 수수료는 양도가에서 · 원가는 선입선출 lot 과 이동평균 합계를 같이 줄인다. */
function lotTrade(S,s,side,q,p,fee,d,sells,notes){
  const sd=settleDate(d),r=S.fx(sd||d);
  if(side==='buy'){const cu=q*p+fee;S.lots.push({date:d,qty:q,costUsd:cu,costKrw:cu*r});S.qty+=q;S.costUsd+=cu;S.costKrw+=cu*r;return;}
  if(side!=='sell')return;
  if(q>S.qty+1e-6)notes.push('oversell:'+d+' '+s);
  const qq=Math.min(q,S.qty);if(!(qq>EPS))return;
  const pu=qq*p-fee*(qq/q),pk=pu*r;
  let need=qq,fu=0,fk=0;while(need>EPS&&S.lots.length){const L=S.lots[0],take=Math.min(need,L.qty),fr=take/L.qty,cu=L.costUsd*fr,ck=L.costKrw*fr;fu+=cu;fk+=ck;L.costUsd-=cu;L.costKrw-=ck;L.qty-=take;need-=take;if(L.qty<=EPS)S.lots.shift();}
  const ar=qq/S.qty,au=S.costUsd*ar,ak=S.costKrw*ar;S.costUsd-=au;S.costKrw-=ak;S.qty-=qq;
  if(S.qty<=EPS){S.qty=0;S.costUsd=0;S.costKrw=0;S.lots=[];}
  sells.push({date:d,settle:sd,year:sd.slice(0,4),symbol:s,qty:qq,price:p,fx:r,unknown:S.unknown,fifo:{usd:pu-fu,krw:pk-fk},avg:{usd:pu-au,krw:pk-ak}});
}
function posOut(P){for(const k of Object.keys(P))delete P[k].fx;return P;}
/* 거래이력 → 종목별 세금 원가(선입선출 lots · 이동평균 합계)와 매도별 실현손익(USD · KRW · 두 방식) */
function build(ledger,fx){
  const b=(ledger&&ledger.base)||{},P={},sells=[],notes=[];
  const reset=(s,q,avg,d,tag)=>{const cu=avg!=null?q*avg:0,r=fx(settleDate(d)||d);P[s]={lots:q>0?[{date:d,qty:q,costUsd:cu,costKrw:cu*r,tag}]:[],qty:q,costUsd:cu,costKrw:cu*r,unknown:q>0&&avg==null,fx};};
  for(const s of SYMS){const [qk,ak]=KEY[s];reset(s,Math.max(0,Math.floor(+b[qk]||0)),+b[ak]>0?+b[ak]:null,String(b.date||''),'base');}
  for(const e of eventsOf(ledger)){
    if(e.type==='reconcile'&&e.snapshot){for(const s of SYMS){const [qk,ak]=KEY[s];reset(s,Math.max(0,Math.floor(+e.snapshot[qk]||0)),+e.snapshot[ak]>0?+e.snapshot[ak]:null,String(e.date||''),'reconcile');}notes.push('reconcile');continue;}
    if(e.type!=='trade')continue;
    const s=String(e.symbol||'').toUpperCase(),S=P[s];if(!S)continue;
    const q=Math.max(0,Math.floor(+e.qty||0)),p=+e.price||0,fee=Math.max(0,+e.fee||0);
    if(!(q>0&&p>0))continue;
    lotTrade(S,s,e.side,q,p,fee,String(e.date||''),sells,notes);
  }
  return {pos:posOut(P),sells,notes};
}
/* 운영 전략 체결 목록 [{date, symbol, side, qty, price, fee}] → build 와 같은 모양. 종목은 무엇이든 · 소수 주(적립) 그대로 · 같은 날은 적은 순서 */
function buildTrades(trades,fx){
  const P={},sells=[],notes=[];
  const list=(Array.isArray(trades)?trades:[]).map((t,i)=>({...t,_i:i})).sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||a._i-b._i);
  for(const e of list){
    const s=String(e.symbol||'').toUpperCase(),q=+e.qty||0,p=+e.price||0,fee=Math.max(0,+e.fee||0);
    if(!s||!(q>EPS&&p>0))continue;
    const S=P[s]||(P[s]={lots:[],qty:0,costUsd:0,costKrw:0,unknown:false,fx});
    lotTrade(S,s,e.side,q,p,fee,String(e.date||''),sells,notes);
  }
  return {pos:posOut(P),sells,notes};
}
/* 지금 n주를 팔면(확정 종가 px · 환율 fxNow · 매도 수수료 포함) 두 방식의 실현손익 */
function simSell(S,n,px,fxNow,feeFn){
  const pu=n*px-(feeFn||defaultFee)(n,px),pk=pu*fxNow;let need=n,fu=0,fk=0;
  for(const L of S.lots){if(need<=0)break;const take=Math.min(need,L.qty),fr=take/L.qty;fu+=L.costUsd*fr;fk+=L.costKrw*fr;need-=take;}
  const ar=S.qty>0?n/S.qty:0;return {fifo:{usd:pu-fu,krw:pk-fk},avg:{usd:pu-S.costUsd*ar,krw:pk-S.costKrw*ar}};
}
/* 포트폴리오 연말 점검 — o={sources, fxSeries, year, otherKrw, dedKrw, rate, margin(공제 채우기 여유 · 기본 0.9)}
   sources: [{key, label, tab, kind, prices:{SYM:px}, feeFn, harvest, why, …}]
     kind 'plan'   = 듀얼가드 장부(ledger · build)
     kind 'trades' = 운영 체결 목록(trades · buildTrades) · expect:{SYM:qty} = 그 전략 계산의 지금 보유 — 다르면 체결 목록을 믿지 않고 추정으로 낮춘다
     kind 'est'    = 원화 원가를 모르는 세션 — estKrw(올해 실현손익 추정) · estN · estPositions:[{symbol,qty,price,costUsd}]
   harvest=false(why) · 추정 세션의 보유는 '지금 팔면'에만 보이고 팔고 되사기 제안에서 뺀다.
   mode: 'fill'(두 방식 다 공제 남음) · 'offset'(두 방식 다 초과) · 'mixed'(방식에 따라 갈림 → 제안 없음) */
function sameQty(P,expect){
  const ks=new Set([...Object.keys(P||{}),...Object.keys(expect||{})]);
  for(const k of ks){const a=+((P[k]&&P[k].qty)||0),b=+((expect||{})[k]||0);if(Math.abs(a-b)>1e-6*Math.max(1,Math.abs(b)))return false;}
  return true;
}
function portfolio(o){
  const fx=fxFn(o.fxSeries),fxNow=fx.last?fx.last.rate:NaN,year=String(o.year),ded=o.dedKrw??DED_KRW,rate=o.rate??RATE,margin=o.margin??0.9,other=Number.isFinite(+o.otherKrw)?+o.otherKrw:0;
  if(!(fxNow>0))return {ok:false,reason:'fx'};
  const sources=[],positions=[];
  for(const s of (o.sources||[])){
    let B=null,est=s.kind==='est',estWhy=est?(s.estWhy||'원화 원가(산 날 환율)를 모릅니다'):'';
    if(s.kind==='plan')B=build(s.ledger,fx);
    else if(s.kind==='trades'){B=buildTrades(s.trades,fx);if(s.expect&&!sameQty(B.pos,s.expect)){B=null;est=true;estWhy='체결 기록으로 다시 센 보유가 그 전략 계산과 달라 원화 원가를 모릅니다';}}
    let realized;
    if(B){const ys=B.sells.filter(x=>x.year===year),sum=(k,u)=>ys.reduce((a,x)=>a+x[k][u],0);
      realized={fifo:sum('fifo','krw'),avg:sum('avg','krw'),fifoUsd:sum('fifo','usd'),avgUsd:sum('avg','usd'),n:ys.length,unknown:ys.some(x=>x.unknown)};}
    else{const v=Number.isFinite(+s.estKrw)?+s.estKrw:0;realized={fifo:v,avg:v,fifoUsd:null,avgUsd:null,n:+s.estN||0,unknown:false,est:true};}
    const S={key:s.key,label:s.label,tab:s.tab,kind:est?'est':s.kind,est,estWhy,why:s.why||'',harvest:!!s.harvest&&!est,realized,notes:B?B.notes:[],feeFn:s.feeFn||defaultFee};
    sources.push(S);
    const px=sym=>+((s.prices||{})[sym])||0;
    if(B){for(const sym of Object.keys(B.pos)){const P=B.pos[sym],p=px(sym);if(!(P.qty>EPS))continue;
      positions.push({key:S.key,label:S.label,tab:S.tab,symbol:sym,qty:P.qty,price:p,unknown:P.unknown,costUsd:P.costUsd,unreal:p>0?simSell(P,P.qty,p,fxNow,()=>0):null,harvest:S.harvest,why:S.why,est:false,_S:S,_P:P});}}
    else for(const h of (s.estPositions||[])){const q=+h.qty||0,p=+h.price||px(h.symbol),c=+h.costUsd;if(!(q>EPS))continue;
      const u=p>0&&Number.isFinite(c)?{usd:q*p-c,krw:(q*p-c)*fxNow}:null;
      positions.push({key:S.key,label:S.label,tab:S.tab,symbol:String(h.symbol||'').toUpperCase(),qty:q,price:p,unknown:!Number.isFinite(c),costUsd:Number.isFinite(c)?c:null,unreal:u?{fifo:u,avg:u}:null,harvest:false,why:S.why,est:true,estWhy});}
  }
  const rf=sources.reduce((a,x)=>a+x.realized.fifo,0),ra=sources.reduce((a,x)=>a+x.realized.avg,0);
  const realized={fifo:rf,avg:ra,n:sources.reduce((a,x)=>a+x.realized.n,0),unknown:sources.some(x=>x.realized.unknown),est:sources.some(x=>x.est&&x.realized.n)};
  const total={fifo:rf+other,avg:ra+other},room={fifo:ded-total.fifo,avg:ded-total.avg};
  const tax={fifo:Math.max(0,-room.fifo)*rate,avg:Math.max(0,-room.avg)*rate};
  const mode=room.fifo>0&&room.avg>0?'fill':room.fifo<0&&room.avg<0?'offset':'mixed';
  const sug=[];let left=mode==='fill'?{fifo:room.fifo*margin,avg:room.avg*margin}:mode==='offset'?{fifo:-room.fifo,avg:-room.avg}:null;
  if(left){
    /* 한 주 손익은 순서만 정한다 — 거르지 않는다. 선입선출은 오래된 lot 부터 팔아, 한 주는 이익인데 통째로는 손실(또는 그 반대)일 수 있다
       (2026-11-11 실제 화면: VR TQQQ 134주 — 첫 lot 이 싸서 한 주는 이익 · 다 팔면 두 방식 모두 손실인데 후보에서 통째로 빠졌다). n 마다 두 방식을 아래에서 본다. */
    const cand=positions.filter(p=>p.harvest&&!p.est&&!p.unknown&&p.price>0).map(p=>{const one=simSell(p._P,1,p.price,fxNow,p._S.feeFn);return {p,per:mode==='fill'?Math.min(one.fifo.krw,one.avg.krw):Math.min(-one.fifo.krw,-one.avg.krw)};})
      .sort((a,b)=>b.per-a.per);
    for(const {p} of cand){
      const feeFn=p._S.feeFn,feeKrw=(n,px)=>2*feeFn(n,px)*fxNow;   // 팔기 + 되사기
      let best=null;
      for(let n=1;n<=p.qty+EPS;n++){const r=simSell(p._P,n,p.price,fxNow,feeFn),f=r.fifo.krw,a=r.avg.krw;let gain;
        if(mode==='fill'){if(!(f>0&&a>0&&f<=left.fifo&&a<=left.avg))continue;gain=rate*Math.min(f,a);}
        else{if(!(f<0&&a<0))continue;gain=rate*Math.min(Math.min(-f,left.fifo),Math.min(-a,left.avg));}
        const net=gain-feeKrw(n,p.price);if(net>0&&(!best||net>best.net+1e-9))best={n,r,gain,net};}
      if(best){sug.push({key:p.key,label:p.label,tab:p.tab,symbol:p.symbol,qty:best.n,price:p.price,realized:best.r,taxKrw:best.gain,feeUsd:2*feeFn(best.n,p.price),netKrw:best.net});
        if(mode==='fill'){left={fifo:left.fifo-best.r.fifo.krw,avg:left.avg-best.r.avg.krw};}else{left={fifo:Math.max(0,left.fifo+best.r.fifo.krw),avg:Math.max(0,left.avg+best.r.avg.krw)};}
        if(mode==='offset'&&!(left.fifo>0&&left.avg>0))break;}
    }
  }
  for(const p of positions){delete p._S;delete p._P;}
  for(const S of sources)delete S.feeFn;
  return {ok:true,year,ded,rate,fxNow,fxDate:fx.last.date,deadline:lastTradeDate(year),sources,realized,other,total,room,tax,mode,positions,suggestions:sug};
}
/* 연말 점검(장부 하나) — o={ledger, prices:{TECL,TQQQ,SGOV}, fxSeries, year, otherKrw, dedKrw, rate, margin, feeFn} · portfolio() 를 장부 하나로 부른다 */
function check(o){
  const R=portfolio({sources:[{key:'plan',kind:'plan',ledger:o.ledger,prices:o.prices,feeFn:o.feeFn,harvest:true}],fxSeries:o.fxSeries,year:o.year,otherKrw:o.otherKrw,dedKrw:o.dedKrw,rate:o.rate,margin:o.margin});
  if(!R.ok)return R;
  const S=R.sources[0];
  return {ok:true,year:R.year,ded:R.ded,rate:R.rate,fxNow:R.fxNow,fxDate:R.fxDate,deadline:R.deadline,realized:S.realized,other:R.other,total:R.total,room:R.room,tax:R.tax,mode:R.mode,
    positions:R.positions.map(p=>({symbol:p.symbol,qty:p.qty,price:p.price,unknown:p.unknown,costUsd:p.costUsd,unreal:p.unreal})),
    suggestions:R.suggestions.map(x=>({symbol:x.symbol,qty:x.qty,price:x.price,realized:x.realized,taxKrw:x.taxKrw,feeUsd:x.feeUsd,netKrw:x.netKrw})),notes:S.notes};
}
const api={DED_KRW,RATE,settleDate,lastTradeDate,fxFn,build,buildTrades,simSell,check,portfolio,isBizDay,defaultFee};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
g.JKPlanTaxCheck=api;
})(typeof globalThis!=='undefined'?globalThis:this);
