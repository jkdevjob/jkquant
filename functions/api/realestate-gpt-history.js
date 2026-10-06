const HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"public, max-age=3600, s-maxage=86400",
  "access-control-allow-origin":"*"
};
const TRADE_URL="https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:HEADERS})}
function keyOf(env){return env.DATA_GO_KR_API_KEY||env.DATA_GO_KR_SERVICE_KEY||""}
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
async function getMonth(key,lawd,ymd){
  const u=new URL(TRADE_URL);
  u.searchParams.set("serviceKey",key);
  u.searchParams.set("LAWD_CD",lawd);
  u.searchParams.set("DEAL_YMD",ymd);
  u.searchParams.set("numOfRows","9999");
  u.searchParams.set("pageNo","1");
  const r=await fetch(u.toString(),{
    headers:{"accept":"application/xml,text/xml,*/*","user-agent":"JKQuant-RealEstate-Backtest/1.0"},
    cf:{cacheTtl:86400,cacheEverything:true}
  });
  const text=await r.text();
  if(!r.ok)throw new Error(lawd+" "+ymd+" HTTP "+r.status);
  const rc=tag(text,["resultCode"]);
  if(rc&&rc!=="000"&&rc!=="00")throw new Error(lawd+" "+ymd+" API "+rc+" "+tag(text,["resultMsg"]));
  return parseItems(text,lawd,ymd);
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
    maxLawdsPerRequest:3,
    note:key?"실거래 백테스트 데이터 사용 가능":"DATA_GO_KR_API_KEY 미설정"
  });
  if(!key)return json({ok:false,configured:false,error:"DATA_GO_KR_API_KEY not configured"},503);
  if(kind!=="year")return json({ok:false,error:"unsupported kind"},400);
  const year=Number(req.searchParams.get("year"));
  const maxYear=new Date().getFullYear();
  if(!Number.isInteger(year)||year<2006||year>maxYear)return json({ok:false,error:"year must be 2006.."+maxYear},400);
  const lawds=String(req.searchParams.get("lawds")||"").split(",").map(x=>x.trim()).filter(Boolean);
  if(!lawds.length||lawds.length>3||lawds.some(x=>!validLawd(x)))return json({ok:false,error:"lawds: 1..3 five-digit codes"},400);
  const jobs=[];
  for(const lawd of lawds)for(let m=1;m<=12;m++)jobs.push({lawd,ymd:String(year)+String(m).padStart(2,"0")});
  try{
    const chunks=await mapLimit(jobs,6,j=>getMonth(key,j.lawd,j.ymd));
    const trades=chunks.flat().sort((a,b)=>a.date.localeCompare(b.date)||a.apt.localeCompare(b.apt));
    return json({ok:true,source:"molit",year,lawds,count:trades.length,fetchedAt:new Date().toISOString(),trades});
  }catch(e){
    return json({ok:false,error:String(e&&e.message||e)},502);
  }
}