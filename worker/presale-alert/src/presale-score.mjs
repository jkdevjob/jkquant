/*
 * 신규분양 알림 전용 보수적 가격평가 v1.
 * 오직 청약홈 모델 분양가와 국토부 계약일 기준 아파트 매매/전세 API를 사용.
 * 주소에 법정동이 없거나 비교단지 표본이 부족하면 점수 산출을 보류한다.
 * 이 점수는 조사 우선순위이지 투자수익률 예측이 아니다.
 */
export const SCORING_VERSION="presale-v1.0";
const DISTRICT={"동구":"30110","중구":"30140","서구":"30170","유성구":"30200","대덕구":"30230"};
const cap=(x,a,b)=>Math.min(b,Math.max(a,x));
const clean=s=>String(s??"").trim();
const normalize=s=>clean(s).replace(/[^0-9A-Za-z가-힣]/g,"").toLowerCase();
const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return null;const i=v.length>>1;return v.length%2?v[i]:(v[i-1]+v[i])/2};
const num=v=>{const n=Number(clean(v).replace(/,/g,""));return Number.isFinite(n)&&n>0?n:null};
const firstTag=(block,tags)=>{
  for(const tag of tags){
    const m=String(block).match(new RegExp("<"+tag+">([\\s\\S]*?)<\\/"+tag+">","i"));
    if(m)return m[1].trim();
  }return "";
};

export function areaFromType(model){
  const direct=num(model.EXCLSV_AR||model.EXCLUSE_AR||model.EXCLV_AR||model.EXCLUSIVE_AREA);
  if(direct&&direct>=20&&direct<=250)return direct;
  // HOUSE_TY: "084.9361A" / "84A" (전용 기준); SUPLY_AR는 공급면적이므로 사용하지 않음.
  const t=clean(model.HOUSE_TY);
  const m=t.match(/^0?(\d{2,3})(?:\.(\d+))?[A-Za-z가-힣]?$/);
  if(!m)return null;
  const area=Number(m[1]+(m[2]?"."+m[2]:""));
  return area>=20&&area<=250?area:null;
}
export function modelPrices(rows){
  return (Array.isArray(rows)?rows:[]).map(r=>{
    const area=areaFromType(r),p=num(r.LTTOT_TOP_AMOUNT);
    return area&&p?{
      type:clean(r.HOUSE_TY),area,price:Math.round(p*10000),
      units:num(r.SUPLY_HSHLDCO)||num(r.TOT_SUPLY_HSHLDCO)||null
    }:null;
  }).filter(Boolean);
}
export function referenceModel(rows){
  const models=modelPrices(rows);if(!models.length)return null;
  const areaGroups=new Map();
  for(const m of models){
    const band=Math.round(m.area);
    let arr=areaGroups.get(band);if(!arr){arr=[];areaGroups.set(band,arr)}arr.push(m);
  }
  const candidates=[...areaGroups.entries()].map(([area,arr])=>({
    area,models:arr,units:arr.reduce((s,x)=>s+(x.units||0),0),
    price:median(arr.map(x=>x.price)),
    minPrice:Math.min(...arr.map(x=>x.price)),
    maxPrice:Math.max(...arr.map(x=>x.price))
  }));
  candidates.sort((a,b)=>((b.area===84?1:0)-(a.area===84?1:0))||b.units-a.units||Math.abs(a.area-84)-Math.abs(b.area-84));
  return {...candidates[0],allModels:models};
}
export function placeFromAddress(address,region){
  const addr=clean(address);
  const city=/(세종|世宗)/.test(region+" "+addr)?"세종":/(대전)/.test(region+" "+addr)?"대전":null;
  if(!city)return null;
  const lawd=city==="세종"?"36110":Object.keys(DISTRICT).find(x=>addr.includes(x));
  if(city==="대전"&&!lawd)return null;
  // "동"은 도로명(예: 동서대로)을 잡지 않도록 공백/숫자 뒤 종료 기준 사용.
  const m=addr.match(/(?:^|[\s(])([가-힣0-9]{1,12}(?:동|읍|면))(?:[\s),0-9]|$)/);
  if(!m)return null;
  return {city,lawd:city==="세종"?lawd:DISTRICT[lawd],umd:m[1]};
}
export function parseRtms(xml,kind){
  const blocks=String(xml||"").match(/<item>[\s\S]*?<\/item>/gi)||[],out=[];
  for(const block of blocks){
    if(firstTag(block,["cdealDay","cdealDe"]))continue;
    const apt=firstTag(block,["aptNm","아파트"]),umd=firstTag(block,["umdNm","법정동"]);
    const area=num(firstTag(block,["excluUseAr","전용면적"]));
    const yr=Number(firstTag(block,["dealYear","년"])),mo=Number(firstTag(block,["dealMonth","월"])),day=Number(firstTag(block,["dealDay","일"]));
    const yearBuilt=Number(firstTag(block,["buildYear","건축년도"]))||null;
    const date=(yr&&mo&&day)?String(yr)+"-"+String(mo).padStart(2,"0")+"-"+String(day).padStart(2,"0"):null;
    if(!apt||!umd||!area||!date)continue;
    if(kind==="trade"){
      const p=num(firstTag(block,["dealAmount","거래금액"]));
      if(p)out.push({apt,umd,area,price:p*10000,yearBuilt,date});
    }else{
      const deposit=num(firstTag(block,["deposit","보증금액"]));
      const monthly=Number(clean(firstTag(block,["monthlyRent","월세금액"])).replace(/,/g,""))||0;
      if(deposit&&monthly===0)out.push({apt,umd,area,price:deposit*10000,yearBuilt,date});
    }
  }return out;
}
export function comparablePrices(rows,place,ref,projectName,now,kind){
  const cutoff=new Date(now.getTime()-123*86400000).toISOString().slice(0,10);
  const olderThan=new Date(now.getTime()-16*365*86400000).getUTCFullYear();
  const excluded=normalize(projectName);
  const filtered=rows.filter(r=>{
    const n=normalize(r.apt);
    return r.umd===place.umd &&
      Math.abs(r.area-ref.area)<=5 &&
      r.date>=cutoff &&
      r.date<=now.toISOString().slice(0,10) &&
      (!r.yearBuilt||r.yearBuilt>=olderThan) &&
      n && n!==excluded && Number.isFinite(r.price);
  });
  const names=new Set(filtered.map(r=>normalize(r.apt)));
  const minTrades=kind==="trade"?5:3,minComplexes=kind==="trade"?2:1;
  if(filtered.length<minTrades||names.size<minComplexes)return {
    ok:false,count:filtered.length,complexes:names.size,
    reason:"같은 법정동·면적의 최근 실거래 표본 부족"
  };
  return {
    ok:true,count:filtered.length,complexes:names.size,
    median:median(filtered.map(r=>r.price)),
    area:ref.area,umd:place.umd,
    latestDate:filtered.reduce((z,r)=>r.date>z?r.date:z,""),
    examples:[...new Map(filtered.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(r=>[r.apt,r])).values()].slice(0,3).map(r=>({apt:r.apt,area:r.area,date:r.date,price:r.price}))
  };
}
function kstDate(d,offsetMonth=0){
  const local=new Date(d.getTime()+9*3600000);
  const month=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-offsetMonth,1));
  return String(month.getUTCFullYear())+String(month.getUTCMonth()+1).padStart(2,"0");
}
const valueOf=(v)=>typeof v==="object"&&v&&"payload" in v?v.payload:v;
export async function evaluatePresale(item,api,now=new Date()){
  const result={
    version:SCORING_VERSION,status:"pending",score:null,grade:"평가 보류",
    reason:"",components:[],model:null,market:null,rent:null,
    coverage:0,sources:["청약홈 주택형별 분양가","국토교통부 아파트 실거래가(계약일 기준)"],
    warnings:["취득세·유상옵션·중도금이자·대출 가능액·전매제한 조건은 미반영","인근 신축 시세와 신규분양가의 단순 비교이며 미래 수익을 보장하지 않음"]
  };
  try{
    const modelRes=valueOf(await api({
      kind:"applyhome",category:item.category,mode:"model",
      houseManageNo:item.houseManageNo,pblancNo:item.pblancNo,perPage:"100"
    }));
    result.model=referenceModel(modelRes&&modelRes.data);
    if(!result.model){result.reason="공식 주택형별 분양가 미확인";return result}
    const place=placeFromAddress(item.address,item.region);
    if(!place){result.reason="공고 주소에서 비교 법정동/자치구 확인 불가";return result}
    const yms=[0,1,2,3].map(i=>kstDate(now,i));
    const requests=[];
    for(const kind of ["trade","rent"])for(const ymd of yms)requests.push(
      api({kind,lawd:place.lawd,ymd})
        .then(r=>({kind,ymd,payload:valueOf(r)}))
        .catch(e=>({kind,ymd,error:String(e&&e.message||e)}))
    );
    const responses=await Promise.all(requests);
    const rows={trade:[],rent:[]};
    let failed=0;
    for(const r of responses){
      if(r.error){failed++;continue}
      rows[r.kind].push(...parseRtms(r.payload,r.kind));
    }
    result.market=comparablePrices(rows.trade,place,result.model,item.name,now,"trade");
    result.rent=comparablePrices(rows.rent,place,result.model,item.name,now,"rent");
    result.place=place;
    result.apiFailures=failed;
    if(failed)result.warnings.push("일부 국토부 월별 API 조회 실패: "+failed+"건");
    if(!result.market.ok){result.reason=result.market.reason+" ("+result.market.count+"건·"+result.market.complexes+"개 단지)";return result}
    const price=result.model.price;
    const margin=(result.market.median-price)/price;
    const pricePoints=Math.round(cap(30+margin*200,0,55));
    // 가점은 관측된 항목만 사용. 전세 표본이 없으면 20점 항목 자체를 분모에서도 제외.
    const comp=[
      {name:"주변 시세 대비 분양가",weight:55,points:pricePoints,description:(margin*100).toFixed(1)+"% 가격차"},
      {name:"단지 규모",weight:15,points:(item.units>=1000?15:item.units>=500?12:item.units>=200?9:item.units>0?6:0),description:item.units?item.units+"세대":"공급규모 미확인"},
      {name:"비교거래 신뢰도",weight:10,points:Math.round(cap(5+(result.market.count-5)*0.6+(result.market.complexes-2)*1.2,0,10)),description:result.market.count+"건·"+result.market.complexes+"개 단지"}
    ];
    if(result.rent.ok){
      const ratio=result.rent.median/price;
      comp.push({name:"인근 전세가율 참고",weight:20,points:Math.round(cap((ratio-.30)/.30*20,0,20)),description:(ratio*100).toFixed(1)+"% (현재 전세/분양가)"});
    }else result.warnings.push("전세 실거래 표본 부족: 전세 항목은 점수에서 제외");
    const weight=comp.reduce((s,c)=>s+c.weight,0);
    result.components=comp;result.coverage=weight;
    // 공급규모 미확인은 가점 아예 제외하지 않고 확실히 평가보류로 둔다.
    if(!item.units){result.reason="공식 공급 세대수 확인 불가";return result}
    result.score=Math.round(comp.reduce((s,c)=>s+c.points,0)/weight*100);
    result.grade=result.score>=80?"우선검토":result.score>=65?"관심":result.score>=50?"중립":"주의";
    result.margin=margin;result.status="scored";
    return result;
  }catch(e){result.reason="공식 API 평가 실패: "+String(e&&e.message||e).slice(0,130);return result}
}
export function won(v){
  if(!Number.isFinite(v))return "미확인";
  const n=v/100000000;
  return n>=1?(n.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")+"억"):(Math.round(v/10000).toLocaleString("ko-KR")+"만원");
}
export function describeEvaluation(item){
  const x=item.evaluation;
  if(!x||!x.model)return item.name+" · 분양가 확인 중 · "+(x?.reason||"평가 보류");
  const p=x.model;
  const label="전용 "+p.area+"㎡ 최고분양가 "+won(p.price);
  if(x.status!=="scored")return item.name+" · "+label+" · 평가 보류("+x.reason+")";
  const diff=(x.margin*100).toFixed(1);
  return item.name+" · "+label+" · 인근 "+won(x.market.median)+
    " ("+x.market.count+"건) · 가격차 "+(x.margin>=0?"+":"")+diff+"%"+
    (x.rent&&x.rent.ok?" · 전세 "+won(x.rent.median):"");
}
