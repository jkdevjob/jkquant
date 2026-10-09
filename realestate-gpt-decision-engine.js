/* GPT 부동산 계획 계산 v1.0.0. 가격 한도는 사용자 가정이며 예측/수익 보장이 아니다. */
(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.REDecision=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  const VERSION="planning-1";
  const DEFAULTS=Object.freeze({cash:null,reserve:null,monthlyLimit:null,ltvPct:0,ratePct:4,years:30,
    buyCostPct:2,sellCostPct:1,extraCost:0,targetMarginPct:10});
  function number(v){if(v===null||v===undefined||typeof v==="string"&&v.trim()===""||typeof v==="boolean")return null;const n=Number(v);return Number.isFinite(n)?n:null;}
  function nonnegative(v){const n=number(v);return n!==null&&n>=0?n:null;}
  function positive(v){const n=number(v);return n!==null&&n>0?n:null;}
  function median(v){const a=v.map(positive).filter(x=>x!==null).sort((a,b)=>a-b);const i=Math.floor(a.length/2);return a.length?(a.length%2?a[i]:(a[i-1]+a[i])/2):null;}
  function today(now=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);}
  function validDate(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s||"")))return false;const d=new Date(s+"T00:00:00Z");return Number.isFinite(+d)&&d.toISOString().slice(0,10)===s;}
  function age(date,now=new Date()){
    const s=String(date||"");const d=s.length===7?s+"-01":s.slice(0,10);
    return validDate(d)?Math.floor((Date.parse(today(now)+"T00:00:00Z")-Date.parse(d+"T00:00:00Z"))/86400000):null;
  }
  function offerStatus(p,now=new Date()){
    if(p.kind==="apt")return "기존 아파트";
    const o=p.offer||{},d=today(now);
    if(validDate(o.applyEnd)&&o.applyEnd<d)return "접수 마감";
    if(o.status==="마감")return "접수 마감";
    if(validDate(o.applyStart)&&o.applyStart>d)return "접수 예정";
    if(validDate(o.applyStart)&&validDate(o.applyEnd)&&o.applyStart<=d&&d<=o.applyEnd)return "접수 중";
    return "일정 확인";
  }
  function payment(principal,annualPct,years){
    const p=nonnegative(principal),r=nonnegative(annualPct),y=positive(years);
    if(p===null||r===null||y===null)return null;
    const n=Math.round(y*12),m=r/1200;
    if(!n)return null;if(m===0)return p/n;
    return p*m/(1-Math.pow(1+m,-n));
  }
  function settings(input={}){
    const s={...DEFAULTS,...input};
    for(const k of Object.keys(s))s[k]=nonnegative(s[k]);
    if(s.ltvPct!==null&&s.ltvPct>90)s.ltvPct=null;
    if(s.years===0||s.years>50)s.years=null;
    if(s.targetMarginPct===null||s.targetMarginPct>=100)s.targetMarginPct=null;
    if(s.buyCostPct===null||s.buyCostPct>30)s.buyCostPct=null;
    if(s.sellCostPct===null||s.sellCostPct>=100)s.sellCostPct=null;
    return s;
  }
  function plan(p,input={},override={}){
    const s=settings(input),f=p.featured||{},b=p.benchmarks||{};
    const ask=positive(override.askPrice===undefined?f.price:override.askPrice);
    const expansion=nonnegative(override.expansion===undefined?f.expansion:override.expansion);
    const ref=positive(b.conservative&&b.conservative.price),lease=positive(b.jeonse&&b.jeonse.price);
    const extras=s.extraCost,fee=s.buyCostPct===null?null:s.buyCostPct/100,l=s.ltvPct===null?null:s.ltvPct/100;
    const known=ask!==null&&expansion!==null&&extras!==null&&fee!==null&&l!==null;
    const total=known?ask*(1+fee)+expansion+extras:null;
    const loan=known?ask*l:null,own=known?total-loan:null;
    const available=s.cash!==null&&s.reserve!==null?Math.max(0,s.cash-s.reserve):null;
    const monthly=loan===null?null:payment(loan,s.ratePct,s.years);
    const stressedMonthly=loan===null||s.ratePct===null?null:payment(loan,s.ratePct+2,s.years);
    const referenceLimit=ref!==null&&expansion!==null&&extras!==null&&fee!==null&&s.targetMarginPct!==null?
      Math.max(0,(ref*(1-s.targetMarginPct/100)-expansion-extras)/(1+fee)):null;
    const cashLimit=available!==null&&expansion!==null&&extras!==null&&fee!==null&&l!==null?
      Math.max(0,(available-expansion-extras)/(1-l+fee)):null;
    let paymentLimit=null;
    if(l===0)paymentLimit=Infinity;
    else if(l!==null&&s.monthlyLimit!==null&&s.ratePct!==null&&s.years!==null){
      const unit=payment(1,s.ratePct+2,s.years);paymentLimit=unit>0?s.monthlyLimit/(unit*l):null;
    }
    const affordabilityLimit=cashLimit!==null&&paymentLimit!==null?Math.min(cashLimit,paymentLimit):null;
    const maxPrice=referenceLimit!==null&&affordabilityLimit!==null?Math.min(referenceLimit,affordabilityLimit):null;
    return {settings:s,ask,expansion,reference:ref,lease,total,loan,own,available,monthly,stressedMonthly,
      cashShortfall:available!==null&&own!==null?Math.max(0,own-available):null,
      monthlyExcess:s.monthlyLimit!==null&&stressedMonthly!==null?Math.max(0,stressedMonthly-s.monthlyLimit):null,
      referenceLimit,affordabilityLimit,maxPrice,
      comparisonRoom:ref!==null&&total!==null?ref-total:null,
      priceDownside:ask!==null?ask*.2:null,leaseDownside:lease!==null?lease*.2:null};
  }
  function evaluate(p,input={},override={},review={},market=null,now=new Date()){
    const x=plan(p,input,override),missing=[],status=offerStatus(p,now),a=age(p.asOf,now);
    if(a===null||a<0||a>7)missing.push("자료 기준일 갱신");
    if(p.collectionIncomplete)missing.push("누락된 실거래 수집 확인");
    if(p.officialIncomplete)missing.push("청약 공고 연결 확인");
    if(p.kind!=="apt"&&status==="일정 확인")missing.push("청약 일정 확인");
    if(x.ask===null)missing.push("실제 매물·공급 가격 입력");
    if(x.expansion===null)missing.push("확장비 확인");
    if(x.reference===null)missing.push("비교 실거래 확인");
    const refAge=age(p.benchmarks?.conservative?.date,now);
    if(refAge===null||refAge<0||refAge>90)missing.push("비교가격 기준일 확인");
    const comparableCount=(p.recentComparables||[]).filter(t=>{
      const d=age(t.date,now),area=positive(t.area),target=positive(p.featured?.area);
      return d!==null&&d>=0&&d<=90&&area!==null&&target!==null&&Math.abs(area-target)<=Math.max(2,target*.04)&&positive(t.price)!==null;
    }).length;
    if(comparableCount<3)missing.push("동일 면적 최근 거래 3건 이상 확인");
    if(x.available===null)missing.push("내 투자금·비상자금 입력");
    if(x.loan>0&&x.settings.monthlyLimit===null)missing.push("월 상환 한도 입력");
    if(x.total===null||x.stressedMonthly===null)missing.push("비용·대출 가정 확인");
    if(!review.comparables)missing.push("비교단지·층·입지 확인");
    if(!review.supply)missing.push("주변 입주·미분양 확인");
    if(!review.conditions)missing.push("세금·대출·전매 조건 확인");
    if(!market||market.stale)missing.push("최신 시장신호 확인");
    let code="check",label="확인 필요";
    if(status==="접수 마감"){code="closed";label="접수 마감";}
    else if(x.ask!==null&&x.referenceLimit!==null&&x.ask>x.referenceLimit){code="price";label="가격 부담";}
    else if((x.cashShortfall||0)>0||(x.monthlyExcess||0)>0){code="cash";label="자금 부족";}
    else if(missing.length===0&&market.entry){code="review";label="가격·자금 조건 통과";}
    else if(missing.length===0){code="wait";label="시장 추세 대기";}
    return {...x,status,code,label,missing:[...new Set(missing)],comparableCount,
      priceGap:x.ask!==null&&x.referenceLimit!==null?Math.max(0,x.ask-x.referenceLimit):null};
  }
  function event(type,details,now=new Date()){return {type,at:now.toISOString(),version:VERSION,details:JSON.parse(JSON.stringify(details))};}
  function registerPurchase(item,input,now=new Date()){
    if(item.stage!=="watch")throw new Error("관심 단지에서만 보유로 등록할 수 있습니다.");
    const price=positive(input.price),expenses=nonnegative(input.expenses),loan=nonnegative(input.loan);
    if(price===null||expenses===null||loan===null||loan>price)throw new Error("매수가·총 취득비용·초기 대출을 확인하세요. 비용이 없으면 0을 입력하세요.");
    if(!validDate(input.date)||input.date>today(now))throw new Error("매수일은 오늘까지의 실제 계약일을 입력하세요.");
    const purchase={price,expenses,loan,date:input.date};
    const result={...item,stage:"held",purchase,targetPrice:positive(input.targetPrice),defensePrice:positive(input.defensePrice)};
    result.events=[...(item.events||[]),event("buy",{...purchase,plan:item.plan||{},review:item.review||{},property:item.property},now)];
    return result;
  }
  function holding(item,market=null,now=new Date()){
    if(item.stage!=="held"||!item.purchase)return null;
    const q=item.quote||{},price=positive(q.price),quoteAge=age(q.date,now);
    const fresh=price!==null&&quoteAge!==null&&quoteAge>=0&&quoteAge<=90;
    const sellPct=nonnegative(item.sellCostPct),tax=nonnegative(item.estimatedTax),cost=nonnegative(item.holdingCosts);
    const known=sellPct!==null&&sellPct<100&&tax!==null&&cost!==null;
    const basis=item.purchase.price+item.purchase.expenses;
    const breakeven=known?(basis+cost+tax)/(1-sellPct/100):null;
    const profit=fresh&&known?price*(1-sellPct/100)-basis-cost-tax:null;
    const reasons=[];
    if(fresh&&positive(item.targetPrice)!==null&&price>=item.targetPrice)reasons.push("기록한 목표가 도달");
    if(fresh&&positive(item.defensePrice)!==null&&price<=item.defensePrice)reasons.push("기록한 하방 점검가 도달");
    if(market&&!market.stale&&market.exit)reasons.push("시장 3·12개월 동반 약세");
    return {price,fresh,breakeven,profit,reasons,code:reasons.length?"sell":!fresh?"update":!known?"check":"hold",
      label:reasons.length?"매도 검토":!fresh?"시세 갱신 필요":!known?"매도 비용 확인 필요":"보유·점검",costsKnown:known};
  }
  function registerSale(item,input,now=new Date()){
    if(item.stage!=="held"||!item.purchase)throw new Error("보유 단지에서만 매도 기록을 남길 수 있습니다.");
    const price=positive(input.price),expenses=nonnegative(input.expenses),tax=nonnegative(input.tax),holdingCosts=nonnegative(input.holdingCosts);
    if([price,expenses,tax,holdingCosts].some(x=>x===null))throw new Error("매도가와 비용을 모두 입력하세요. 비용이 없으면 0을 입력하세요.");
    if(!validDate(input.date)||input.date<item.purchase.date||input.date>today(now))throw new Error("매도일은 매수일 이후부터 오늘까지의 실제 계약일을 입력하세요.");
    const profit=price-item.purchase.price-item.purchase.expenses-expenses-tax-holdingCosts;
    const sale={price,expenses,tax,holdingCosts,date:input.date,profit,returnOnCost:profit/(item.purchase.price+item.purchase.expenses)};
    return {...item,stage:"sold",sale,events:[...(item.events||[]),event("sell",sale,now)]};
  }
  function norm(s){return String(s||"").replace(/\s+/g,"").toLowerCase();}
  function normaliseRtms(r,kind){
    const cancelled=String(r.cdealDay||r.cdealDe||"").trim()||!/^(?:N|0)?$/i.test(String(r.cdealType||"").trim());
    const area=positive(r.excluUseAr),apt=String(r.aptNm||r.aptName||"").trim();
    const date=String(r.dealYear||"")+"-"+String(r.dealMonth||"").padStart(2,"0")+"-"+String(r.dealDay||"").padStart(2,"0");
    if(cancelled||!apt||area===null||!validDate(date)||kind!=="rent"&&String(r.dealingGbn||"").trim()==="직거래")return null;
    const price=positive(String(r.dealAmount??"").replace(/,/g,"").trim());
    const deposit=positive(String(r.deposit??"").replace(/,/g,"").trim());
    return {apt,umd:String(r.umdNm||"").trim(),area,date,floor:r.floor||null,price:price===null?null:price*10000,
      deposit:deposit===null?null:deposit*10000,monthly:nonnegative(r.monthlyRent),cancelled:false};
  }
  function apartmentCandidates(trades,rents,{lawd,city,district,area=84,query="",now=new Date()}={}){
    const groups=new Map(),d=today(now);
    for(const t of trades){
      if(t.cancelled||!t.apt||positive(t.price)===null||!validDate(t.date)||t.date>d||age(t.date,now)>90)continue;
      if(Math.abs(t.area-area)>Math.max(2,area*.04)||!norm(t.apt).includes(norm(query)))continue;
      const key=norm(t.apt)+"|"+norm(t.umd),a=groups.get(key)||[];a.push(t);groups.set(key,a);
    }
    return [...groups.values()].map(list=>{
      list.sort((a,b)=>b.date.localeCompare(a.date));const t=list[0];
      const rr=rents.filter(r=>r.apt===t.apt&&r.umd===t.umd&&r.monthly===0&&positive(r.deposit)!==null&&validDate(r.date)&&r.date<=d&&age(r.date,now)<=90&&Math.abs(r.area-area)<=Math.max(2,area*.04));
      return {id:"apt-"+lawd+"-"+encodeURIComponent(t.apt+"|"+(t.umd||"")+"|"+area),kind:"apt",city,district,name:t.apt,address:t.umd||"",asOf:d,
        featured:{area,price:null,expansion:0,label:"실제 매물가격 입력"},liveMarket:{lawd,targetArea:area,saleApts:[t.apt],rentApts:[t.apt]},
        benchmarks:{conservative:{label:"동일 단지 최근 90일 실거래 중앙값",price:median(list.map(x=>x.price)),date:t.date},jeonse:{label:"동일 단지 순수전세 중앙값",price:median(rr.map(x=>x.deposit)),date:rr[0]?.date||null}},
        recentComparables:list.slice(0,10).map(t=>({name:t.apt,area:t.area,price:t.price,date:t.date,floor:t.floor,umd:t.umd})),tradeCount:list.length,rentCount:rr.length,
        sources:[{label:"국토부 실거래 확인",url:"https://rt.molit.go.kr/pt/gis/gis.do"}]};
    }).sort((a,b)=>b.tradeCount-a.tradeCount||a.name.localeCompare(b.name)).slice(0,30);
  }
  return {VERSION,DEFAULTS,number,positive,nonnegative,median,today,validDate,age,offerStatus,payment,settings,plan,evaluate,
    event,registerPurchase,holding,registerSale,apartmentCandidates,normaliseRtms};
});
