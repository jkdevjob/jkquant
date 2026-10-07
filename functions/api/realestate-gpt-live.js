const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"public, max-age=300, s-maxage=900",
  "access-control-allow-origin":"*"
};

const APPLY_BASE="https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1";
const APPLY_ENDPOINTS={
  apt:{detail:"getAPTLttotPblancDetail",model:"getAPTLttotPblancMdl"},
  remndr:{detail:"getRemndrLttotPblancDetail",model:"getRemndrLttotPblancMdl"},
  opt:{detail:"getOPTLttotPblancDetail",model:"getOPTLttotPblancMdl"}
};
const RTMS_ENDPOINTS={
  trade:"https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
  rent:"https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
  right:"https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade"
};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS})}
function clean(v,max=80){return String(v||"").replace(/[<>\r\n]/g,"").slice(0,max)}
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
    if(/SERVICE_ACCESS_DENIED|PERMISSION_DENIED/i.test(t))return "공공데이터포털 활용신청 권한 없음";
    if(/SERVICE_KEY_IS_NOT_REGISTERED|NOT_REGISTERED/i.test(t))return "공공데이터포털 서비스키 미등록 또는 해당 API 미연결";
    if(/LIMITED_NUMBER|REQUESTS_EXCEEDS/i.test(t))return "공공데이터포털 호출 한도 초과";
    return "공공데이터포털 인증 거부(HTTP 403) · 해당 API 활용신청 상태 확인 필요";
  }
  return "upstream HTTP "+status+" "+t.replace(/\s+/g," ").slice(0,180);
}
function validDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)}
function validYm(v){return /^\d{6}$/.test(v)}
function validLawd(v){return /^\d{5}$/.test(v)}

async function getText(url){
  const r=await fetch(url.toString(),{
    headers:{"accept":"application/json,text/xml,application/xml,text/plain,*/*","user-agent":"JKQuant-RealEstate-GPT/1.1"},
    cf:{cacheTtl:900,cacheEverything:true}
  });
  const text=await r.text();
  if(!r.ok)throw new Error(upstreamError(r.status,text));
  return {text,contentType:r.headers.get("content-type")||""};
}

async function applyhome(req,key){
  const category=clean(req.searchParams.get("category"),12);
  const mode=clean(req.searchParams.get("mode"),12);
  const ep=APPLY_ENDPOINTS[category]&&APPLY_ENDPOINTS[category][mode];
  if(!ep)return json({ok:false,error:"unsupported applyhome category/mode"},400);
  const u=new URL(APPLY_BASE+"/"+ep);
  u.searchParams.set("serviceKey",key);
  u.searchParams.set("returnType","JSON");
  u.searchParams.set("page","1");
  u.searchParams.set("perPage",String(Math.min(300,Math.max(10,Number(req.searchParams.get("perPage"))||100))));
  if(mode==="detail"){
    const from=clean(req.searchParams.get("from"),10),to=clean(req.searchParams.get("to"),10);
    const region=clean(req.searchParams.get("region"),20);
    if(validDate(from))u.searchParams.set("cond[RCRIT_PBLANC_DE::GTE]",from);
    if(validDate(to))u.searchParams.set("cond[RCRIT_PBLANC_DE::LTE]",to);
    if(region)u.searchParams.set("cond[SUBSCRPT_AREA_CODE_NM::EQ]",region);
  }else{
    const hm=clean(req.searchParams.get("houseManageNo"),40);
    const pn=clean(req.searchParams.get("pblancNo"),40);
    if(!hm||!pn)return json({ok:false,error:"houseManageNo and pblancNo required"},400);
    u.searchParams.set("cond[HOUSE_MANAGE_NO::EQ]",hm);
    u.searchParams.set("cond[PBLANC_NO::EQ]",pn);
  }
  const {text}=await getText(u);
  let payload;try{payload=JSON.parse(text)}catch{return json({ok:false,error:"invalid applyhome json",sample:text.slice(0,300)},502)}
  return json({ok:true,source:"applyhome",category,mode,fetchedAt:new Date().toISOString(),payload});
}

async function rtms(req,key,kind){
  const lawd=clean(req.searchParams.get("lawd"),5),ymd=clean(req.searchParams.get("ymd"),6);
  if(!validLawd(lawd)||!validYm(ymd))return json({ok:false,error:"lawd(5 digits) and ymd(YYYYMM) required"},400);
  const base=RTMS_ENDPOINTS[kind]; if(!base)return json({ok:false,error:"unsupported rtms kind"},400);
  const u=new URL(base);
  u.searchParams.set("serviceKey",key);
  u.searchParams.set("LAWD_CD",lawd);
  u.searchParams.set("DEAL_YMD",ymd);
  u.searchParams.set("numOfRows","9999");
  u.searchParams.set("pageNo","1");
  const {text}=await getText(u);
  return json({ok:true,source:"molit",kind,lawd,ymd,fetchedAt:new Date().toISOString(),format:"xml",payload:text});
}

export async function onRequestGet(context){
  const req=new URL(context.request.url);
  const kind=clean(req.searchParams.get("kind"),20)||"status";
  const key=keyOf(context.env||{});
  if(kind==="status")return json({
    ok:true,configured:!!key,
    features:{applyhome:true,trade:true,rent:true,presaleRight:true},
    envName:"DATA_GO_KR_API_KEY",
    note:key?"공공데이터포털 공식 API 자동수집 사용 가능 · Encoding/Decoding 키 자동정규화":"공공데이터포털 인증키 미설정 — 검증 스냅샷으로 동작"
  });
  if(!key)return json({ok:false,error:"DATA_GO_KR_API_KEY not configured",configured:false},503);
  try{
    if(kind==="applyhome")return await applyhome(req,key);
    if(kind==="trade"||kind==="rent"||kind==="right")return await rtms(req,key,kind);
    return json({ok:false,error:"unsupported kind"},400);
  }catch(e){
    return json({ok:false,error:String(e&&e.message||e)},502);
  }
}