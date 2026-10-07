const HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"public, max-age=3600, s-maxage=86400",
  "access-control-allow-origin":"*"
};
const TRADE_URL="https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:HEADERS})}
function keyOf(env){
  let k=String(env.DATA_GO_KR_API_KEY||env.DATA_GO_KR_SERVICE_KEY||"").trim();
  if((k.startsWith('"')&&k.endsWith('"'))||(k.startsWith("'")&&k.endsWith("'")))k=k.slice(1,-1).trim();
  try{
    if(/%[0-9A-Fa-f]{2}/.test(k))k=decodeURIComponent(k);
  }catch(e){}
  return k;
}
function upstreamError(status,text){
  const t=String(text||"").slice(0,500);
  if(status===403){
    if(/SERVICE_ACCESS_DENIED|PERMISSION_DENIED/i.test(t))return "공공데이터포털 활용신청 권한이 없습니다. '국토교통부_아파트 매매 실거래가 자료' 활용신청/승인 상태를 확인하세요.";
    if(/SERVICE_KEY_IS_NOT_REGISTERED|NOT_REGISTERED/i.test(t))return "공공데이터포털 서비스키가 등록되지 않았거나 이 API에 연결되지 않았습니다. 활용신청에 사용한 서비스키인지 확인하세요.";
    if(/LIMITED_NUMBER|REQUESTS_EXCEEDS/i.test(t))return "공공데이터포털 호출 한도를 초과했습니다. 잠시 후 다시 시도하거나 트래픽 한도를 확인하세요.";
    return "공공데이터포털 인증이 거부됐습니다(HTTP 403). 서비스키 인코딩은 자동 보정했습니다. 해당 API 활용신청/승인 상태를 확인하세요.";
  }
  return "국토부 실거래 API HTTP "+status+" "+t.replace(/\s+/g," ").slice(0,180);
}
function decode(s){return String(s||"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim()}
function tag(block,names){
  for(const name of names){
    const m=block.match(new RegExp("<"+name+">([\\s\\S]*?)<\\/"+name+">","i"));
    if(m)return decode(m[1]);
  }
  return "";
}
function num(v){const n=Number(String(v||"").replace(/,/g,"").trim());return Number.isFinite(n)?n:null}
function parseItems(xml,lawd,ymd){
  const out=[];
  const blocks=String(xml||"").match(/<item>[\s\S]*?<\/item>/gi)||[];
  for(const b of blocks){
    const cancel=tag(b,["cdealType","cdealDay","cdealDe"]);
    if(cancel)continue;
    const apt=tag(b,["aptNm","아파트"]);
    const area=num(tag(b,["excluUseAr","전용면적"]));
    const price10k=num(tag(b,["dealAmount","거래금액"]));
    const y=num(tag(b,["dealYear","년"]))||Number(ymd.slice(0,4));
    const m=num(tag(b,["dealMonth","월"]))||Number(ymd.slice(4,6));
    const d=num(tag(b,["dealDay","일"]))||1;
    if(!apt||!area||!price10k)continue;
    out.push({
      lawd,
      sggCd:tag(b,["sggCd"])||lawd,
      umd:tag(b,["umdNm","법정동"]),
      apt,
      area,
      price:price10k*10000,
      date:String(y).padStart(4,"0")+"-"+String(m).padStart(2,"0")+"-"+String(d).padStart(2,"0"),
      floor:num(tag(b,["floor","층"])),
      buildYear:num(tag(b,["buildYear","건축년도"])),
      jibun:tag(b,["jibun","지번"]),
      dealingGbn:tag(b,["dealingGbn"]),
      rgstDate:tag(b,["rgstDate"])
    });
  }
  return out;
}
function validLawd(v){return /^\d{5}$/.test(v)}
async function fetchTimed(url,options={},timeoutMs=15000){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort("timeout"),timeoutMs);
  try{return await fetch(url,{...options,signal:ac.signal})}
  finally{clearTimeout(timer)}
}
async function getMonth(key,lawd,ymd){
  const u=new URL(TRADE_URL);
  u.searchParams.set("serviceKey",key);
  u.searchParams.set("LAWD_CD",lawd);
  u.searchParams.set("DEAL_YMD",ymd);
  u.searchParams.set("numOfRows","9999");
  u.searchParams.set("pageNo","1");
  let last=null;
  for(let attempt=1;attempt<=2;attempt++){
    try{
      const r=await fetchTimed(u.toString(),{
        headers:{"accept":"application/xml,text/xml,*/*","user-agent":"JKQuant-RealEstate-Backtest/1.1"},
        cf:{cacheTtl:86400,cacheEverything:true}
      },15000);
      const text=await r.text();
      if(!r.ok)throw new Error(lawd+" "+ymd+" · "+upstreamError(r.status,text));
      const rc=tag(text,["resultCode"]);
      if(rc&&rc!=="000"&&rc!=="00")throw new Error(lawd+" "+ymd+" API "+rc+" "+tag(text,["resultMsg"]));
      return parseItems(text,lawd,ymd);
    }catch(e){
      last=e;
      if(attempt<2)await new Promise(r=>setTimeout(r,250));
    }
  }
  throw last||new Error(lawd+" "+ymd+" unknown error");
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let next=0;
  async function worker(){
    for(;;){
      const i=next++; if(i>=items.length)return;
      out[i]=await fn(items[i],i);
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
export async function onRequestGet(context){
  const req=new URL(context.request.url),env=context.env||{},key=keyOf(env);
  const kind=(req.searchParams.get("kind")||"status").trim();
  if(kind==="status")return json({
    ok:true,configured:!!key,
    coverage:"국토교통부 아파트 매매 실거래 API",
    minYear:2006,
    maxYear:new Date().getFullYear(),
    maxLawdsPerRequest:1,
    note:key?"실거래 백테스트 데이터 사용 가능 · Encoding/Decoding 키 자동정규화":"DATA_GO_KR_API_KEY 미설정"
  });
  if(!key)return json({ok:false,configured:false,error:"DATA_GO_KR_API_KEY not configured"},503);
  if(kind!=="year")return json({ok:false,error:"unsupported kind"},400);
  const year=Number(req.searchParams.get("year"));
  const maxYear=new Date().getFullYear();
  if(!Number.isInteger(year)||year<2006||year>maxYear)return json({ok:false,error:"year must be 2006.."+maxYear},400);
  const lawds=String(req.searchParams.get("lawds")||"").split(",").map(x=>x.trim()).filter(Boolean);
  if(lawds.length!==1||!validLawd(lawds[0]))return json({ok:false,error:"lawds: exactly one five-digit code required"},400);
  const lawd=lawds[0],now=new Date();
  const lastMonth=year===now.getUTCFullYear()?now.getUTCMonth()+1:12;
  const jobs=[];
  for(let m=1;m<=lastMonth;m++)jobs.push({lawd,ymd:String(year)+String(m).padStart(2,"0")});
  const results=await mapLimit(jobs,3,async j=>{
    try{return {ok:true,trades:await getMonth(key,j.lawd,j.ymd),ymd:j.ymd}}
    catch(e){return {ok:false,trades:[],ymd:j.ymd,error:String(e&&e.message||e)}}
  });
  const failures=results.filter(x=>!x.ok).map(x=>({ymd:x.ymd,error:x.error}));
  const trades=results.flatMap(x=>x.trades).sort((a,b)=>a.date.localeCompare(b.date)||a.apt.localeCompare(b.apt));
  if(!trades.length&&failures.length===jobs.length){
    return json({ok:false,error:"해당 연도·구의 월별 실거래 조회가 모두 실패했습니다.",year,lawd,failures},502);
  }
  return json({
    ok:true,source:"molit",year,lawds:[lawd],lawd,count:trades.length,
    partial:failures.length>0,failures,fetchedAt:new Date().toISOString(),trades
  });
}