/*
 * IPO alert score v1: public IPO feed fields only.
 * Research priority, not listing-price prediction.
 * Keep missing commitments/free-float explicitly unknown.
 */
export const IPO_SCORE_VERSION="ipo-v1";
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const numeric=v=>{
  if(v==null||v==="")return null;
  const n=Number(String(v).replace(/[,원\s]/g,"").replace(/:1$/,""));
  return Number.isFinite(n)&&n>0?n:null;
};
const clean=s=>String(s??"").trim();
export function dateKst(now=new Date()){
  const d=new Date(now.getTime()+9*3600000);
  return [d.getUTCFullYear(),String(d.getUTCMonth()+1).padStart(2,"0"),String(d.getUTCDate()).padStart(2,"0")].join("-");
}
export function addDays(date,days){
  const d=new Date(date+"T00:00:00Z");
  d.setUTCDate(d.getUTCDate()+days);
  return [d.getUTCFullYear(),String(d.getUTCMonth()+1).padStart(2,"0"),String(d.getUTCDate()).padStart(2,"0")].join("-");
}
export function normalizeIPO(it){
  return {
    code:clean(it.code),name:clean(it.name),
    poPrice:numeric(it.poPrice),bandLo:numeric(it.bandLo),bandHi:numeric(it.bandHi),
    instRate:numeric(it.instRate),subRate:numeric(it.subRate),
    subStart:clean(it.subStart),subEnd:clean(it.subEnd),listDate:clean(it.listDate),
    status:clean(it.status),market:clean(it.market),
    leadManager:clean(it.leadManager),url:clean(it.url)
  };
}
export function ipoScore(raw){
  const it=normalizeIPO(raw),scores=[],unknown=[];
  const base={version:IPO_SCORE_VERSION,status:"pending",score:null,grade:"평가 보류",coverage:0,components:scores,
    reason:"",unknown,price:it.poPrice,bandHi:it.bandHi,instRate:it.instRate,subRate:it.subRate,
    commitments:null,freeFloat:null,
    warning:"의무보유확약·상장 직후 유통가능물량·시가총액은 현재 IPO 데이터에서 확인할 수 없어 점수에서 제외. 상장일 손익 예측이 아닙니다."};
  if(!it.poPrice){base.reason="확정 공모가 미확인";return base}
  if(!it.bandHi||!it.bandLo||it.bandLo>it.bandHi){base.reason="공모가 희망밴드 미확인";return base}
  if(!it.instRate){base.reason="기관 수요예측 경쟁률 미확인";return base}
  const ratio=it.poPrice/it.bandHi;
  // Higher than upper end gets a lower score, below lower end gets a higher score.
  const pricePts=it.poPrice<=it.bandLo?35:
    it.poPrice<=it.bandHi?Math.round(28-13*(it.poPrice-it.bandLo)/Math.max(1,it.bandHi-it.bandLo)):
    Math.round(clamp(15-(ratio-1)*80,0,15));
  scores.push({name:"확정 공모가 vs 희망밴드",weight:35,points:pricePts,
    detail:"공모가 "+money(it.poPrice)+" / 상단 "+money(it.bandHi)+" ("+((ratio-1)*100).toFixed(1)+"%)"});
  const instPts=Math.round(clamp(it.instRate/1800*40,0,40));
  scores.push({name:"기관 수요예측 경쟁률",weight:40,points:instPts,
    detail:it.instRate.toFixed(1)+" 대 1"});
  if(it.subRate!=null){
    const pts=Math.round(clamp(it.subRate/1000*15,0,15));
    scores.push({name:"일반청약 경쟁률",weight:15,points:pts,detail:it.subRate.toFixed(1)+" 대 1"});
  }else unknown.push("일반청약 경쟁률 미발표");
  if(it.subStart&&it.subEnd&&/^\d{4}-\d{2}-\d{2}$/.test(it.subStart)&&/^\d{4}-\d{2}-\d{2}$/.test(it.subEnd)){
    scores.push({name:"청약 일정 확인",weight:10,points:10,detail:it.subStart+" ~ "+it.subEnd});
  }else unknown.push("청약 일정 일부 미확인");
  unknown.push("의무보유확약률 미확인","상장 직후 유통가능주식 비율 미확인","상장 시가총액 미확인");
  const weight=scores.reduce((s,x)=>s+x.weight,0);
  base.coverage=weight;
  base.score=Math.round(scores.reduce((s,x)=>s+x.points,0)/weight*100);
  base.grade=base.score>=80?"우선검토":base.score>=65?"관심":base.score>=50?"중립":"주의";
  base.status="scored";
  base.priceVsBandPercent=100*(ratio-1);
  return base;
}
export function money(n){return Number.isFinite(n)?Math.round(n).toLocaleString("ko-KR")+"원":"미확인"}
export function buildDailyDigest(rawItems,now=new Date()){
  const today=dateKst(now),week=addDays(today,7);
  const items=(Array.isArray(rawItems)?rawItems:[]).map(normalizeIPO)
    .filter(it=>it.name&&it.code&&(it.subStart||it.listDate));
  const unique=[...new Map(items.map(it=>[it.code,it])).values()];
  const subs=unique.filter(it=>it.subStart&&it.subStart<=today&&it.subEnd&&it.subEnd>=today);
  const upcoming=unique.filter(it=>it.subStart&&it.subStart>today&&it.subStart<=week);
  const listing=unique.filter(it=>it.listDate===today);
  const tagged=[...new Set([...subs,...upcoming,...listing])].map(it=>{
    const phase=subs.some(x=>x.code===it.code)?"청약중":upcoming.some(x=>x.code===it.code)?"청약예정":"오늘상장";
    return {...it,phase,evaluation:ipoScore(it)};
  });
  const priority={"청약중":0,"청약예정":1,"오늘상장":2};
  tagged.sort((a,b)=>priority[a.phase]-priority[b.phase]||
    ((b.evaluation.score??-1)-(a.evaluation.score??-1))||a.name.localeCompare(b.name,"ko"));
  const first=tagged[0],alertScore=first&&first.evaluation;
  const title="📈 공모주 "+today.slice(5)+" · 청약 "+subs.length+" / 예정 "+upcoming.length;
  const body=first?
    first.name+" "+first.phase+" · "+(alertScore.status==="scored"?alertScore.score+"점("+alertScore.grade+") · ":"평가 보류 · ")+
    "공모가 "+money(first.poPrice)+" · 기관 "+(first.instRate?first.instRate.toFixed(1)+":1":"미확인")+
    (tagged.length>1?" 외 "+(tagged.length-1)+"종목":""):
    "오늘 청약 중이거나 7일 내 청약 예정인 종목이 없습니다.";
  return {date:today,subs:subs.length,upcoming:upcoming.length,listing:listing.length,
    items:tagged,title,body,scoringVersion:IPO_SCORE_VERSION};
}
