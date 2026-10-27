// GET /api/closing30-monitor?op=scan&kind=day|overnight, or ?op=prices&stage=...
// Internal scheduled paper-only signal/pricing. No broker orders and no post-cutoff input in signal selection.
import {minuteVolume} from "./_opening.js";
import {CLOSE_VARIANTS,closingVariant,closeHm,snapAt,closeFeature,chooseClosingSignals} from "./_closing30.js";
const JSON_H={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const respond=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:JSON_H});
function permitted(req,env){const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"");return !!key&&req.headers.get("x-monitor-key")===key;}
function kst(now=Date.now()){
 const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(now));
 const x=t=>p.find(z=>z.type===t)?.value||"";
 return {date:[x("year"),x("month"),x("day")].join("-"),hm:+x("hour")*100+(+x("minute"))};
}
async function getJson(url,init={},timeout=6500){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
 try{const r=await fetch(url,{...init,signal:ac.signal});if(!r.ok)throw Error("quote HTTP "+r.status);
 return await r.json();}finally{clearTimeout(timer);}
}
function authOrigin(req){return new URL(req.url).origin;}
async function quote(origin,code){
 const [m,d]=await Promise.all([
 getJson(origin+"/api/quote?symbol="+encodeURIComponent(code)+"&minute=1"),
 getJson(origin+"/api/quote?symbol="+encodeURIComponent(code)+"&range=5d&intraday=0&div=0")]);
 return {minutes:minuteVolume(m.minutes||[]),daily:d.ohlc||[]};
}
function sessionDaily(daily,date){
 const i=daily.findIndex(x=>String(x.date)===date);
 if(i<1)return null;
 const today=daily[i],prior=daily[i-1];
 if(!(prior.close>0)||!(today.open>0))return null;
 return {open:+today.open,prevClose:+prior.close,close:+today.close||null};
}
async function batch(list,fn,workers=4){
 let i=0;const output=[],errors=[];async function work(){
 while(i<list.length){const x=list[i++];try{const y=await fn(x);if(y)output.push(y);}catch(e){errors.push({code:String(x.code||x),error:String(e.message||e).slice(0,100)});}}
 }await Promise.all(Array.from({length:workers},work));return {output,errors};
}
const BATCH_SIZE=10;
function inputs(u,stocks){
 try{
  const xs=JSON.parse(u.searchParams.get("inputs")||"null");
  if(!Array.isArray(xs)||!xs.length||xs.length>BATCH_SIZE)return null;
  if(stocks){
   if(xs.some(x=>!x||!/^\d{6}$/.test(String(x.code||""))))return null;
   return xs.map(x=>({code:String(x.code),name:String(x.name||x.code).slice(0,80)}));
  }
  return xs.every(x=>/^\d{6}$/.test(String(x)))?xs.map(String):null;
 }catch{return null;}
}
async function distributed(request,rows,op,params){
 const chunks=[];for(let i=0;i<rows.length;i+=BATCH_SIZE)chunks.push(rows.slice(i,i+BATCH_SIZE));
 // Each child makes at most 20 quote requests. The parent makes at most five
 // child requests, keeping the unchanged Top50 universe below the per-invocation limit.
 // Two children × two symbols keeps provider concurrency at the original four symbols.
 const result=await batch(chunks,async chunk=>{
  const url=new URL(request.url);url.search=new URLSearchParams({...params,op,inputs:JSON.stringify(chunk)}).toString();
  const j=await getJson(url.toString(),{headers:{"x-monitor-key":request.headers.get("x-monitor-key"),accept:"application/json"}},45000);
  if(!j.ok)throw Error(j.error||"quote batch failed");return j;
 },2);
 return {output:result.output.flatMap(j=>j.features||j.prices||[]),
  errors:[...result.errors,...result.output.flatMap(j=>j.errors||[])]};
}
export async function onRequestGet({request,env}){
 if(!permitted(request,env))return respond({ok:false,error:"unauthorized"},401);
 const u=new URL(request.url),op=u.searchParams.get("op"),kind=u.searchParams.get("kind");
 const today=kst(),date=u.searchParams.get("date")||today.date,origin=authOrigin(request);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return respond({ok:false,error:"invalid date"},400);
 if(op==="scan"||op==="feature-batch"){
  if(!["day","overnight"].includes(kind))return respond({ok:false,error:"kind"},400);
  if(date!==today.date||today.hm<(kind==="day"?1505:1521))return respond({ok:false,error:"not due"},409);
  const cutoff=kind==="day"?1504:1520;
  let symbols;
  if(op==="feature-batch"){
   symbols=inputs(u,true);if(!symbols)return respond({ok:false,error:"invalid feature batch"},400);
  }else{
  const univers=await getJson(origin+"/api/universe?limit=100");
  // 종가 베팅은 개별 상장주식만: ETF/ETN은 기존 별도 연구와 구분한다.
  const fundName=/^(KODEX|TIGER|RISE|ACE|PLUS|SOL |HANARO|TIMEFOLIO|KOSEF|KBSTAR|ARIRANG|FOCUS|WOORI|1Q |BNK|KIWOOM|TREX)|\b(ETF|ETN)\b/i;
  symbols=(univers.universe||[]).filter(x=>x&&/^\d{6}$/.test(String(x.code||""))&&!fundName.test(String(x.name||""))).slice(0,50)
    .map(x=>({code:String(x.code),name:x.name||x.code}));
  }
  if(!symbols.length)return respond({ok:false,error:"universe empty"},503);
  const {output,errors}=op==="scan"?await distributed(request,symbols,"feature-batch",{kind,date}):await batch(symbols,async stock=>{
   const q=await quote(origin,stock.code),day=sessionDaily(q.daily,date);
   if(!day)return null;
   const prior=q.minutes.filter(x=>String(x.t).startsWith(date));
   const f=closeFeature(prior,day.prevClose,cutoff);
   return f?{code:stock.code,name:stock.name||stock.code,feature:f}:null;
  },2);
  if(op==="feature-batch")return respond({ok:true,features:output,errors});
  // Universe source unavailable/partial: record degraded and never imply no-trade.
  let variants=[...CLOSE_VARIANTS];
  // Only forward observations after registration. Retired candidates remain
  // observable so their old trades and post-retirement evidence are retained.
  let factoryError=null;
  try{
   const r=await getJson('https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/lifecycle.json');
   const life=r.strategies?.[kind==='day'?'closing30':'closing_bet']||{};
   for(const x of life.generatedPool||[]){
    const v=closingVariant(x.name);if(v&&/^\d{4}-\d{2}-\d{2}$/.test(String(x.createdAfter||''))&&x.createdAfter<date)variants.push(v);
   }
  }catch(e){factoryError=String(e.message||e);}
  const main=String(u.searchParams.get('mainVariant')||'baseline'),mainRule=closingVariant(main);
  if(!mainRule)return respond({ok:false,error:'unknown closing main'},400);
  // A promoted generation remains tradable even after the bounded reserve pool rotates.
  if(!variants.some(v=>v.id===main))variants.push(mainRule);
  const partial=errors.length>0||output.length===0;
  return respond({ok:true,date,kind,partial,errors,scanned:symbols.length,valid:output.length,
   signals:chooseClosingSignals(output,kind,3,variants),variants:variants.map(v=>v.id),factoryError,cutoff,source:"minute snapshot; no post-cutoff data"});
 }
 if(op==="prices"||op==="price-batch"){
  const stage=u.searchParams.get("stage");
  if(!["day_entry","day_exit","overnight_entry","overnight_exit"].includes(stage))return respond({ok:false,error:"stage"},400);
  if(date!==today.date)return respond({ok:false,error:"pricing only current session"},409);
  const allowed={day_entry:1507,day_exit:1540,overnight_entry:1540,overnight_exit:906};
  if(today.hm<allowed[stage])return respond({ok:false,error:"stage not settled"},409);
  const codes=op==="price-batch"?inputs(u,false):[...new Set(String(u.searchParams.get("codes")||"").split(",").filter(x=>/^\d{6}$/.test(x)))].slice(0,35);
  if(!codes)return respond({ok:false,error:"invalid price batch"},400);
  const {output,errors}=op==="prices"?await distributed(request,codes,"price-batch",{date,stage}):await batch(codes,async code=>{
   const q=await quote(origin,code),day=sessionDaily(q.daily,date);
   if(!day)return null;
   let price=null,source="";
   if(stage==="day_entry"){
    // 15:06 관측 봉(이미 완료된 다음 봉)을 모의 체결가로 사용한다.
    const b=snapAt(q.minutes.filter(x=>String(x.t).startsWith(date)),1506).find(x=>closeHm(x.t)===1506);
    price=b?.close>0?+b.close:null;source="15:06 완료 분봉 종가 대용";
   }else if(stage==="overnight_exit"){
    price=day.open;source="익일 공식 일봉 시가 (09:06 이후)";
   }else{
    // 15:30 종가 단일가 확정 후 15:40만 사용. 장중에는 절대로 종가를 입력에 쓰지 않는다.
    price=day.close;source="15:30 종가 단일가 (15:40 이후)";
   }
   const priceHm=stage==="day_entry"?"15:06":stage==="overnight_exit"?"09:00":"15:30";
   return price>0?{code,price,source,priceAt:date+"T"+priceHm+":00+09:00"}:null;
  },2);
  return respond({ok:true,date,stage,prices:output,errors,missing:codes.length-output.length});
 }
 return respond({ok:false,error:"unknown op"},400);
}
