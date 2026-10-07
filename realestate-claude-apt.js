/* 부동산 🤖 클로드 — 아파트(단지) 매매 전략 엔진 apt-1
   "어느 아파트를 언제·얼마에·왜 사서, 언제·얼마에·왜 팔았나"를 계산하는 한 곳.
   화면(realestate-claude.js)·모의장부(scripts/realestate_claude/paper.mjs)·시험이 이 함수를 같이 쓴다.
   자료  apt.json    — 단지별 KB 월 시세(전용 84㎡ 대표 타입: 하한·일반·상한·전세)와 매매 실거래 월 요약 (단위 만원)
         series.json — 한국은행 기준금리·예금금리 (realestate-claude-engine.js 의 prepare 로 읽는다)
         events.json — 날짜를 확인한 정책·개발·교통·규제 사건 (기준금리 변경은 금리 자료에서 자동으로 덧붙인다)
   시점  k월 결정은 k-1월까지 공개된 시세·금리만 본다(룩어헤드 금지). 체결은 k월 KB 일반거래가.
   규칙  매수: 현금일 때, 기준금리가 1년 전보다 높지 않고, 대단지 중 6개월 시세 상승률 1위가 +3% 이상이면 그 단지를 산다.
         매도: 2년(1주택 양도세 비과세 요건) 이상 보유한 뒤, 그 단지 6개월 시세가 떨어졌거나 기준금리가 1년 새 0.5%p 이상 오르면 판다.
         판 달에 매수 조건이 맞는 다른 단지가 있으면 바로 갈아탄다. 현금은 예금이자(세후)를 받는다. */
(function(g){
'use strict';
const BASE=(typeof module!=='undefined'&&module.exports)?require('./realestate-claude-engine.js'):g.JKRealEstateClaude;
const {ymk,kym,at,upTo,lastK}=BASE;

const VERSION='1.0.0';
const STRATEGY='apt-1';
const DEFAULTS={mom:6,buyMin:0.03,minHold:24,rateLook:12,rateUpSell:0.5,minUnits:1000,holdCostYr:0.0015,depositTax:0.154,newsWindow:6,capital:30000};
const CITY_OF=gu=>gu==='세종시'?'세종':'대전';

/* ── 자료 준비 ── */
function sr(start,arr){ return start&&Array.isArray(arr)?{k0:ymk(start),v:arr}:null; }
function monthOf(date){ const m=/^(\d{4})-(\d{2})/.exec(String(date||'')); if(!m) throw new Error('사건 날짜 형식 오류: '+date); return ymk(m[1]+'-'+m[2]); }
function rateEvents(D){
  const s=D&&D.macro&&D.macro.baseRate,out=[]; if(!s) return out;
  let prev=null;
  for(let i=0;i<s.v.length;i++){ const x=s.v[i]; if(x==null) continue;
    if(prev!=null&&Math.abs(x-prev)>1e-9){ const k=s.k0+i;
      out.push({date:kym(k),k,region:'전국',type:x>prev?'금리인상':'금리인하',title:'기준금리 '+prev+'% → '+x+'% '+(x>prev?'인상':'인하'),src:'https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643',auto:true}); }
    prev=x; }
  return out;
}
function prepareApt(doc,D,evDoc){
  const A={doc:doc||{},D,U:[],byId:{},P:{},LO:{},HI:{},J:{},R:{},events:[],lastK:null};
  for(const u of (doc&&doc.universe)||[]){
    const s=doc.sise&&doc.sise[u.id]; if(!s) continue;
    const x=Object.assign({},u,{city:CITY_OF(u.gu)});
    A.U.push(x); A.byId[u.id]=x;
    A.P[u.id]=sr(s.start,s.mid); A.LO[u.id]=sr(s.start,s.low); A.HI[u.id]=sr(s.start,s.high); A.J[u.id]=sr(s.start,s.jeonse);
    const r=doc.real&&doc.real[u.id];
    if(r) A.R[u.id]={k0:ymk(r.start),n:r.n,med:r.med,min:r.min,max:r.max};
    const e=lastK(A.P[u.id]); if(e!=null&&(A.lastK==null||e>A.lastK)) A.lastK=e;
  }
  const ev=((evDoc&&evDoc.events)||[]).map(e=>Object.assign({},e,{k:monthOf(e.date)}));
  A.events=ev.concat(rateEvents(D)).sort((a,b)=>a.k-b.k||String(a.date).localeCompare(String(b.date)));
  return A;
}

/* ── 값 읽기 ── */
function price(A,id,k){ return at(A.P[id],k); }
function momOf(A,id,k,o){ const a=price(A,id,k-1),b=price(A,id,k-1-o.mom); return (a==null||b==null||b<=0)?null:a/b-1; }
function marketAt(A,k,o){
  const s=A.D&&A.D.macro&&A.D.macro.baseRate,r1=at(s,k-1),r0=at(s,k-1-o.rateLook);
  return {rate:r1,rate0:r0,rateUp:(r1==null||r0==null)?null:Math.round((r1-r0)*1e6)/1e6};
}
function depMonthly(A,k,o){ const d=upTo(A.D&&A.D.macro&&A.D.macro.depositRate,k-1); return (d==null?0:d/100)*(1-o.depositTax)/12; }
function realAt(A,id,k){
  const r=A.R[id]; if(!r) return null; const i=k-r.k0; if(i<0||i>=r.n.length||!r.n[i]) return null;
  return {n:r.n[i],med:r.med[i],min:r.min[i],max:r.max[i]};
}
function quote(A,id,k){ return {m:kym(k),price:price(A,id,k),low:at(A.LO[id],k),high:at(A.HI[id],k),jeonse:at(A.J[id],k),real:realAt(A,id,k)}; }

/* ── 후보: k월 결정 — k-1월까지 시세가 있는 대단지의 6개월 상승률 순 ── */
function candidatesAt(A,k,o){
  const out=[];
  for(const u of A.U){
    if(o.minUnits&&(+u.units||0)<o.minUnits) continue;
    const m=momOf(A,u.id,k,o); if(m==null) continue;
    out.push({id:u.id,mom:m,last:price(A,u.id,k-1)});
  }
  out.sort((x,y)=>(y.mom-x.mom)||((+A.byId[y.id].units||0)-(+A.byId[x.id].units||0))||String(x.id).localeCompare(String(y.id)));
  return out;
}

/* ── 비용 (만원) — 현행 세법 근사. 과거 세율과 다를 수 있다 ── */
function acqRate(p){ const e=p/10000,r=e<=6?1:e<=9?e*2/3-3:3; return r*1.1/100; }              // 취득세+지방교육세(전용 85㎡ 이하)
function brokerRate(p){ const e=p/10000,r=p<5000?0.6:e<2?0.5:e<9?0.4:e<12?0.5:e<15?0.6:0.7; return r*1.1/100; } // 중개보수 상한+부가세
function exemptLimit(k){ return k<ymk('2008-10')?60000:k<ymk('2021-12')?90000:120000; }        // 1주택 비과세 고가주택 기준
function gainTax(buyTotal,sellP,sellBroker,held,k){
  const gain=sellP-sellBroker-buyTotal; if(gain<=0) return 0;
  if(held<24) return Math.round(gain*(held<12?0.77:0.66));
  const lim=exemptLimit(k); if(sellP<=lim) return 0;
  let taxable=gain*(sellP-lim)/sellP;
  if(held>=36) taxable*=1-Math.min(0.8,0.08*Math.floor(held/12));                              // 1주택 장기보유특별공제(보유+거주)
  taxable=Math.max(0,taxable-250);
  return Math.round(taxable*0.385);
}

/* ── 뉴스: 결정 직전 n개월(k-n ~ k-1) 사건 중 그 지역·전국 것 ── */
function regionHit(e,city){ return e.region==='전국'||e.region==='대전·세종'||e.region===city; }
function newsFor(A,k,city,n){
  return A.events.filter(e=>e.k>=k-n&&e.k<=k-1&&regionHit(e,city)).slice().reverse().slice(0,4)
    .map(e=>({date:e.date,type:e.type,title:e.title,src:e.src,auto:!!e.auto}));
}

/* ── 한 달 진행 — 백테스트와 모의장부가 같은 함수를 쓴다 ──
   st = {eq(만원), pos:null|{id,k,buy...,hold}} → 이 달 체결·평가를 반영해 st 를 고친다. */
function info(A,id){ const u=A.byId[id]||{}; return {id,name:u.name,gu:u.gu,dong:u.dong,city:u.city,built:u.built,units:u.units,excl:u.excl}; }
function stepMonth(A,st,k,o){
  const out={k,closed:null,opened:null,action:'wait',why:[]};
  const m=marketAt(A,k,o);
  if(st.pos){
    const p=st.pos,held=k-p.k,mc=momOf(A,p.id,k,o),why=[];
    if(held>=o.minHold){ if(mc!=null&&mc<0) why.push('mom'); if(m.rateUp!=null&&m.rateUp>=o.rateUpSell) why.push('rate'); }
    const px=price(A,p.id,k);
    if(why.length&&px!=null){
      const q=quote(A,p.id,k),broker=Math.round(px*brokerRate(px)),tax=gainTax(p.buy.total,px,broker,held,k);
      const net=px-broker-tax-p.hold,r=net/p.buy.total-1,eq0=st.eq;
      st.eq=p.eqIn*(1+r);
      out.closed=Object.assign({},p.meta,{buy:p.buy,
        sell:Object.assign(q,{k,costs:{broker,tax,hold:Math.round(p.hold)},net:Math.round(net),mom:mc,held,rate:m.rate,rate0:m.rate0,rateUp:m.rateUp,why,news:newsFor(A,k,p.meta.city,o.newsWindow)}),
        result:{months:held,gross:px/p.buy.price-1,net:r,profit:Math.round(net-p.buy.total),eqIn:p.eqIn,eqOut:st.eq,eqBefore:eq0}});
      st.pos=null; out.action='sell'; out.why=why;
    }else{
      if(px!=null){ p.hold+=px*o.holdCostYr/12; st.eq=p.eqIn*((px-p.hold)/p.buy.total); }
      out.action='hold'; out.why=held<o.minHold?['minHold']:[];
    }
  }
  if(!st.pos){
    const C=candidatesAt(A,k,o),best=C.find(c=>price(A,c.id,k)!=null)||null;
    if(best&&m.rateUp!=null&&m.rateUp<=0&&best.mom>=o.buyMin){
      const px=price(A,best.id,k),q=quote(A,best.id,k),acq=Math.round(px*acqRate(px)),broker=Math.round(px*brokerRate(px));
      const meta=info(A,best.id),rank=C.indexOf(best)+1;
      const buy=Object.assign(q,{k,costs:{acq,broker},total:px+acq+broker,mom:best.mom,rank,of:C.length,rate:m.rate,rate0:m.rate0,rateUp:m.rateUp,
        runners:C.filter(c=>c!==best).slice(0,2).map(c=>({id:c.id,name:A.byId[c.id].name,mom:c.mom})),news:newsFor(A,k,meta.city,o.newsWindow)});
      st.pos={id:best.id,k,meta,buy,hold:0,eqIn:st.eq};
      st.eq=st.pos.eqIn*(px/buy.total);
      out.opened=Object.assign({},meta,{buy}); out.action=out.closed?'switch':'buy';
    }else{
      if(out.action!=='sell') out.action='wait';
      const w=[]; if(m.rateUp==null) w.push('noRate'); else if(m.rateUp>0) w.push('rateUp');
      if(!best) w.push('noCand'); else if(best.mom<o.buyMin) w.push('weak');
      if(out.action==='wait') out.why=w;
      st.eq*=1+depMonthly(A,k,o);
    }
  }
  out.eq=st.eq; out.market=m;
  return out;
}

/* ── 백테스트 ── */
function startK(A,o){
  let s=null; for(const u of A.U){ const p=A.P[u.id]; if(p&&(s==null||p.k0<s)) s=p.k0; }
  return s==null?null:s+1+o.mom;
}
function simulate(A,o){
  o=Object.assign({},DEFAULTS,o||{});
  const k0=startK(A,o),k1=A.lastK; if(k0==null||k1==null||k1<k0) return {trades:[],curve:[],opts:o};
  const st={eq:o.capital,pos:null},trades=[],curve=[],months=[];
  for(let k=k0;k<=k1;k++){
    const r=stepMonth(A,st,k,o);
    if(r.closed) trades.push(Object.assign(r.closed,{open:false}));
    curve.push({m:kym(r.k),eq:r.eq,pos:st.pos?st.pos.id:null}); months.push(r);
  }
  if(st.pos){ const p=st.pos,px=price(A,p.id,k1);
    trades.push(Object.assign({},p.meta,{buy:p.buy,sell:null,open:true,mark:Object.assign(quote(A,p.id,k1),{k:k1,held:k1-p.k}),
      result:{months:k1-p.k,gross:px/p.buy.price-1,net:(px-p.hold)/p.buy.total-1,profit:Math.round(px-p.hold-p.buy.total),eqIn:p.eqIn,eqOut:st.eq}})); }
  trades.forEach((t,i)=>t.no=i+1);
  return {trades,curve,months,opts:o,start:kym(k0),end:kym(k1),final:st.eq,pos:st.pos?st.pos.id:null};
}
function cagr(a,b,months){ return (a>0&&b>0&&months>0)?Math.pow(b/a,12/months)-1:null; }
function mdd(curve){ let pk=-Infinity,dd=0; for(const c of curve){ pk=Math.max(pk,c.eq); dd=Math.min(dd,c.eq/pk-1); } return dd; }
function summary(A,sim){
  const c=sim.curve; if(!c.length) return null;
  const n=c.length,cl=sim.trades.filter(t=>!t.open);
  return {start:sim.start,end:sim.end,months:n,trades:sim.trades.length,closed:cl.length,wins:cl.filter(t=>t.result.net>0).length,
    final:sim.final,total:sim.final/sim.opts.capital-1,cagr:cagr(sim.opts.capital,sim.final,n),mdd:mdd(c),
    inMarket:c.filter(x=>x.pos).length/n};
}
/* 비교: 같은 기간 예금만 / 대단지 전부 고르게 사서 보유(시세 있는 단지 평균 월수익) */
function benchmarks(A,sim){
  const o=sim.opts,k0=ymk(sim.start),k1=ymk(sim.end);
  let dep=o.capital,eqw=o.capital;
  for(let k=k0;k<=k1;k++){
    dep*=1+depMonthly(A,k,o);
    let s=0,n=0; for(const u of A.U){ if(o.minUnits&&(+u.units||0)<o.minUnits) continue; const a=price(A,u.id,k),b=price(A,u.id,k-1); if(a!=null&&b!=null&&b>0){ s+=a/b-1; n++; } }
    eqw*=1+(n?s/n:0)-o.holdCostYr/12;
  }
  const months=k1-k0+1;
  return {deposit:{final:dep,cagr:cagr(o.capital,dep,months)},hold:{final:eqw,cagr:cagr(o.capital,eqw,months)}};
}

/* ── 사건 뒤 가격: 사건 직전 달(k-1) 대비 6·12·24개월 뒤 그 지역 대단지 평균 ── */
function eventStudy(A,o){
  o=Object.assign({},DEFAULTS,o||{});
  const H=[6,12,24],rows=[];
  for(const e of A.events){ if(e.auto) continue;
    const row={date:e.date,region:e.region,type:e.type,title:e.title,src:e.src,res:{}};
    for(const city of ['대전','세종']){ if(!regionHit(e,city)) continue;
      const r={};
      for(const h of H){ let s=0,n=0;
        for(const u of A.U){ if(u.city!==city||(o.minUnits&&(+u.units||0)<o.minUnits)) continue;
          const a=price(A,u.id,e.k-1),b=price(A,u.id,e.k-1+h); if(a!=null&&b!=null&&a>0){ s+=b/a-1; n++; } }
        r[h]=n?{avg:s/n,n}:null; }
      row.res[city]=r; }
    rows.push(row); }
  return rows;
}

/* ── 지금: 다음 달(n=lastK+1) 결정 미리보기 — lastK월까지 자료로 ── */
function nowView(A,o,pos){
  o=Object.assign({},DEFAULTS,o||{});
  const n=A.lastK+1,m=marketAt(A,n,o),C=candidatesAt(A,n,o);
  const top=C.slice(0,10).map((c,i)=>Object.assign(info(A,c.id),{rank:i+1,mom:c.mom},quote(A,c.id,A.lastK)));
  let action='wait',why=[];
  if(pos){ const held=n-pos.k,mc=momOf(A,pos.id,n,o);
    if(held>=o.minHold&&((mc!=null&&mc<0)||(m.rateUp!=null&&m.rateUp>=o.rateUpSell))){ action='sell'; if(mc!=null&&mc<0) why.push('mom'); if(m.rateUp!=null&&m.rateUp>=o.rateUpSell) why.push('rate'); }
    else { action='hold'; why=held<o.minHold?['minHold']:[]; } }
  else if(C.length&&m.rateUp!=null&&m.rateUp<=0&&C[0].mom>=o.buyMin){ action='buy'; }
  else { if(m.rateUp==null) why.push('noRate'); else if(m.rateUp>0) why.push('rateUp'); if(!C.length) why.push('noCand'); else if(C[0].mom<o.buyMin) why.push('weak'); }
  return {forMonth:kym(n),dataMonth:kym(A.lastK),market:m,action,why,top,news:newsFor(A,n,'대전',o.newsWindow).concat(newsFor(A,n,'세종',o.newsWindow).filter(e=>e.title&&!/대전/.test(e.title))).slice(0,6)};
}

/* ── 모의장부(앞으로) — 만든 달 다음 달부터 같은 stepMonth 로 한 달씩. 지난 기록은 고치지 않는다 ── */
function paperUpdate(ledger,A,o,nowIso){
  o=Object.assign({},DEFAULTS,o||{});
  let L=ledger?JSON.parse(JSON.stringify(ledger)):null;
  if(L&&L.strategyVersion!==STRATEGY) throw new Error('장부 전략 버전 다름: '+L.strategyVersion);
  if(!L){ L={strategyVersion:STRATEGY,engineVersion:VERSION,created:nowIso,startedData:kym(A.lastK),params:pickParams(o),months:[],trades:[],acct:{eq:o.capital,pos:null}}; return {ledger:L,added:0}; }
  const po=Object.assign({},o,L.params);
  const st={eq:L.acct.eq,pos:L.acct.pos?JSON.parse(JSON.stringify(L.acct.pos)):null};
  const done=L.months.length?ymk(L.months[L.months.length-1].m):ymk(L.startedData);
  let added=0;
  for(let k=done+1;k<=A.lastK;k++){
    const r=stepMonth(A,st,k,po);
    L.months.push({m:kym(k),action:r.action,why:r.why,eq:Math.round(r.eq*100)/100,pos:st.pos?st.pos.id:null,at:nowIso});
    if(r.closed) L.trades.push(Object.assign(r.closed,{open:false,closedAt:nowIso}));
    added++;
  }
  L.acct={eq:st.eq,pos:st.pos};
  return {ledger:L,added};
}
function pickParams(o){ const x={}; for(const k of ['mom','buyMin','minHold','rateLook','rateUpSell','minUnits','holdCostYr','depositTax','newsWindow','capital']) x[k]=o[k]; return x; }


/* ── 주변 대단지(신규 분양 비교) — 좌표 반경 안 대단지의 최근 KB 시세 ── */
function distKm(a,b,c,d){ const p=Math.PI/180; return 6371*Math.hypot((d-b)*p*Math.cos((a+c)/2*p),(c-a)*p); }
function builtYear(u){ const m=/^(\d{4})/.exec(String(u.built||'')); return m?+m[1]:null; }
function nearby(A,lat,lng,o){
  o=Object.assign({radius:3,limit:4,newYears:10},o||{});
  const k=A.lastK,y=Math.floor(k/12),out=[];
  for(const u of A.U){ if(u.lat==null||u.lng==null) continue;
    const d=distKm(+lat,+lng,+u.lat,+u.lng),px=price(A,u.id,k); if(d>o.radius||px==null) continue;
    const by=builtYear(u);
    out.push(Object.assign(info(A,u.id),{km:Math.round(d*100)/100,price:px,jeonse:at(A.J[u.id],k),m:kym(k),isNew:by!=null&&y-by<=o.newYears})); }
  out.sort((a,b)=>(b.isNew-a.isNew)||(a.km-b.km));
  return out.slice(0,o.limit);
}

const API={VERSION,STRATEGY,DEFAULTS,nearby,distKm,prepareApt,rateEvents,price,momOf,marketAt,candidatesAt,acqRate,brokerRate,exemptLimit,gainTax,newsFor,
  stepMonth,simulate,summary,benchmarks,eventStudy,nowView,paperUpdate,quote,realAt,startK};
if(typeof module!=='undefined'&&module.exports) module.exports=API;
g.JKREApt=API;
})(typeof globalThis!=='undefined'?globalThis:this);
