/* 연말 세금 점검 (plan 1.47.0 · 2026-11-07) — 해외주식 양도소득세(1년 실현손익 합산 · 기본공제 250만원 · 22%)를
   자산플랜 거래이력으로 추정하고, 연말에 '팔고 바로 되사기'로 공제를 채우거나(평가이익) 공제 초과분을 상계할(평가손실) 주수를 제안한다.
   조회·안내 기능 — 주문을 내지 않는다. 연구 근거: research/im_plan RESEARCH_LOG.md 11-07 심층 2(세후 CAGR +0.3~0.5%p · 5년 창 116:5).
   - 양도 시기 = 결제일: 미국 T+1(2024-05-28 전 T+2). 그 해 세금에 넣을 마지막 체결일 = lastTradeDate(year).
   - 원화 환산 = 결제일(그날 없으면 직전) USD/KRW 종가 — 신고는 서울외국환중개 기준환율이라 몇 원 다르다. 취득·양도 환율 차이(환차손익)는 들어간다.
   - 취득가 = 선입선출(국내 증권사 해외주식 양도세 기본) · 이동평균 두 방식으로 같이 낸다. 제안은 두 방식 모두에서 성립하는 주수만.
   - 필요경비: 매수 수수료는 취득가에, 매도 수수료는 양도가에서 뺀다. 배당(분배금)은 배당소득이라 넣지 않는다.
   - 시작잔고·보정(reconcile) 기록은 그날 평단 한 덩어리로 본다(그 전 체결 이력이 없으므로 근사). */
(function(g){
'use strict';
const DED_KRW=2500000,RATE=0.22,SYMS=['TECL','TQQQ','SGOV'],KEY={TECL:['tecl','avgTecl'],TQQQ:['tqqq','avgTqqq'],SGOV:['sgov','avgSgov']};
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
/* 거래이력 → 종목별 세금 원가(선입선출 lots · 이동평균 합계)와 매도별 실현손익(USD · KRW · 두 방식) */
function build(ledger,fx){
  const b=(ledger&&ledger.base)||{},P={},sells=[],notes=[];
  const reset=(s,q,avg,d,tag)=>{const cu=avg!=null?q*avg:0,r=fx(settleDate(d)||d);P[s]={lots:q>0?[{date:d,qty:q,costUsd:cu,costKrw:cu*r,tag}]:[],qty:q,costUsd:cu,costKrw:cu*r,unknown:q>0&&avg==null};};
  for(const s of SYMS){const [qk,ak]=KEY[s];reset(s,Math.max(0,Math.floor(+b[qk]||0)),+b[ak]>0?+b[ak]:null,String(b.date||''),'base');}
  for(const e of eventsOf(ledger)){
    if(e.type==='reconcile'&&e.snapshot){for(const s of SYMS){const [qk,ak]=KEY[s];reset(s,Math.max(0,Math.floor(+e.snapshot[qk]||0)),+e.snapshot[ak]>0?+e.snapshot[ak]:null,String(e.date||''),'reconcile');}notes.push('reconcile');continue;}
    if(e.type!=='trade')continue;
    const s=String(e.symbol||'').toUpperCase(),S=P[s];if(!S)continue;
    const q=Math.max(0,Math.floor(+e.qty||0)),p=+e.price||0,fee=Math.max(0,+e.fee||0),d=String(e.date||''),sd=settleDate(d),r=fx(sd||d);
    if(!(q>0&&p>0))continue;
    if(e.side==='buy'){const cu=q*p+fee;S.lots.push({date:d,qty:q,costUsd:cu,costKrw:cu*r});S.qty+=q;S.costUsd+=cu;S.costKrw+=cu*r;}
    else if(e.side==='sell'){
      if(q>S.qty)notes.push('oversell:'+d+' '+s);
      const qq=Math.min(q,S.qty);if(!(qq>0))continue;
      const pu=qq*p-fee*(qq/q),pk=pu*r;
      let need=qq,fu=0,fk=0;while(need>0&&S.lots.length){const L=S.lots[0],take=Math.min(need,L.qty),fr=take/L.qty,cu=L.costUsd*fr,ck=L.costKrw*fr;fu+=cu;fk+=ck;L.costUsd-=cu;L.costKrw-=ck;L.qty-=take;need-=take;if(L.qty<=0)S.lots.shift();}
      const ar=qq/S.qty,au=S.costUsd*ar,ak=S.costKrw*ar;S.costUsd-=au;S.costKrw-=ak;S.qty-=qq;
      sells.push({date:d,settle:sd,year:sd.slice(0,4),symbol:s,qty:qq,price:p,fx:r,unknown:S.unknown,fifo:{usd:pu-fu,krw:pk-fk},avg:{usd:pu-au,krw:pk-ak}});
    }
  }
  return {pos:P,sells,notes};
}
/* 지금 n주를 팔면(확정 종가 px · 환율 fxNow · 매도 수수료 포함) 두 방식의 실현손익 */
function simSell(S,n,px,fxNow,feeFn){
  const pu=n*px-(feeFn||defaultFee)(n,px),pk=pu*fxNow;let need=n,fu=0,fk=0;
  for(const L of S.lots){if(need<=0)break;const take=Math.min(need,L.qty),fr=take/L.qty;fu+=L.costUsd*fr;fk+=L.costKrw*fr;need-=take;}
  const ar=S.qty>0?n/S.qty:0;return {fifo:{usd:pu-fu,krw:pk-fk},avg:{usd:pu-S.costUsd*ar,krw:pk-S.costKrw*ar}};
}
/* 연말 점검 — o={ledger, prices:{TECL,TQQQ,SGOV}, fxSeries, year, otherKrw, dedKrw, rate, margin(공제 채우기 여유 · 기본 0.9), feeFn}
   mode: 'fill'(두 방식 다 공제 남음) · 'offset'(두 방식 다 초과) · 'mixed'(방식에 따라 갈림 → 제안 없음) · 'none'(이력 없음) */
function check(o){
  const fx=fxFn(o.fxSeries),fxNow=fx.last?fx.last.rate:NaN,year=String(o.year),ded=o.dedKrw??DED_KRW,rate=o.rate??RATE,margin=o.margin??0.9,feeFn=o.feeFn||defaultFee,other=Number.isFinite(+o.otherKrw)?+o.otherKrw:0;
  if(!(fxNow>0))return {ok:false,reason:'fx'};
  const B=build(o.ledger,fx),ys=B.sells.filter(x=>x.year===year);
  const sum=(k,u)=>ys.reduce((a,x)=>a+x[k][u],0);
  const realized={fifo:sum('fifo','krw'),avg:sum('avg','krw'),fifoUsd:sum('fifo','usd'),avgUsd:sum('avg','usd'),n:ys.length,unknown:ys.some(x=>x.unknown)};
  const total={fifo:realized.fifo+other,avg:realized.avg+other},room={fifo:ded-total.fifo,avg:ded-total.avg};
  const tax={fifo:Math.max(0,-room.fifo)*rate,avg:Math.max(0,-room.avg)*rate};
  const positions=SYMS.map(s=>{const S=B.pos[s],px=+((o.prices||{})[s])||0;if(!(S.qty>0))return null;
    const u=px>0?simSell(S,S.qty,px,fxNow,()=>0):null;return {symbol:s,qty:S.qty,price:px,unknown:S.unknown,costUsd:S.costUsd,unreal:u};}).filter(Boolean);
  const mode=room.fifo>0&&room.avg>0?'fill':room.fifo<0&&room.avg<0?'offset':'mixed';
  const feeKrw=(n,px)=>2*feeFn(n,px)*fxNow;   // 팔기 + 되사기
  const sug=[];let left=mode==='fill'?{fifo:room.fifo*margin,avg:room.avg*margin}:mode==='offset'?{fifo:-room.fifo,avg:-room.avg}:null;
  if(left){
    const cand=positions.filter(p=>!p.unknown&&p.price>0).map(p=>{const one=simSell(B.pos[p.symbol],1,p.price,fxNow,feeFn);return {p,per:mode==='fill'?Math.min(one.fifo.krw,one.avg.krw):Math.min(-one.fifo.krw,-one.avg.krw)};})
      .filter(c=>c.per>0).sort((a,b)=>b.per-a.per);
    for(const {p} of cand){
      let best=null;
      for(let n=1;n<=p.qty;n++){const r=simSell(B.pos[p.symbol],n,p.price,fxNow,feeFn),f=r.fifo.krw,a=r.avg.krw;let gain;
        if(mode==='fill'){if(!(f>0&&a>0&&f<=left.fifo&&a<=left.avg))continue;gain=rate*Math.min(f,a);}
        else{if(!(f<0&&a<0))continue;gain=rate*Math.min(Math.min(-f,left.fifo),Math.min(-a,left.avg));}
        const net=gain-feeKrw(n,p.price);if(net>0&&(!best||net>best.net+1e-9))best={n,r,gain,net};}
      if(best){sug.push({symbol:p.symbol,qty:best.n,price:p.price,realized:best.r,taxKrw:best.gain,feeUsd:2*feeFn(best.n,p.price),netKrw:best.net});
        if(mode==='fill'){left={fifo:left.fifo-best.r.fifo.krw,avg:left.avg-best.r.avg.krw};}else{left={fifo:Math.max(0,left.fifo+best.r.fifo.krw),avg:Math.max(0,left.avg+best.r.avg.krw)};}
        if(mode==='offset'&&!(left.fifo>0&&left.avg>0))break;}
    }
  }
  return {ok:true,year,ded,rate,fxNow,fxDate:fx.last.date,deadline:lastTradeDate(year),realized,other,total,room,tax,mode,positions,suggestions:sug,notes:B.notes};
}
const api={DED_KRW,RATE,settleDate,lastTradeDate,fxFn,build,simSell,check,isBizDay};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
g.JKPlanTaxCheck=api;
})(typeof globalThis!=='undefined'?globalThis:this);
