import { buildDailyDigest, IPO_SCORE_VERSION } from "./ipo-score.mjs";
import { evaluatePresale, describeEvaluation, won, SCORING_VERSION } from "./presale-score.mjs";
const enc=new TextEncoder();
const BASE_APP="https://jkquant.pages.dev";
const PRESALE_APP=BASE_APP+"/realestate";
const JOB_APP=BASE_APP+"/job";
const IPO_APP=BASE_APP+"/ipo";
const ALLOW_ORIGINS=new Set([BASE_APP,"http://localhost:8788","http://127.0.0.1:8788"]);
const TRADE_TOPICS=new Set(["opening","daytrading","crypto","soxl"]);
const VALID_TOPICS=new Set(["presale","job","ipo",...TRADE_TOPICS]);

function b64u(bytes){
  let s="";for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function b64uText(s){return b64u(enc.encode(s))}
function b64uDecode(s){
  s=String(s||"").replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4)s+="=";
  const raw=atob(s),out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
  return out;
}
function cors(request){
  const origin=request.headers.get("origin")||"";
  const h={
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "access-control-allow-methods":"GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers":"content-type"
  };
  if(ALLOW_ORIGINS.has(origin))h["access-control-allow-origin"]=origin;
  else if(!origin)h["access-control-allow-origin"]="*";
  return h;
}
function json(request,data,status=200){return new Response(JSON.stringify(data),{status,headers:cors(request)})}
function kstDate(offsetDays=0){
  const d=new Date(Date.now()+offsetDays*86400000+9*3600000);
  return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0")+"-"+String(d.getUTCDate()).padStart(2,"0");
}
function clean(v,max=500){return String(v==null?"":v).replace(/[<>\r\n]/g," ").trim().slice(0,max)}
function normalizeTopics(v,fallback){
  const a=Array.isArray(v)?v:(fallback||[]);
  return [...new Set(a.map(x=>String(x||"").trim()).filter(x=>VALID_TOPICS.has(x)))];
}
async function hashText(s){
  const d=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(String(s))));
  return b64u(d).slice(0,32);
}
function rawPublicFromJwk(jwk){
  const x=b64uDecode(jwk.x),y=b64uDecode(jwk.y);
  const out=new Uint8Array(65);out[0]=4;out.set(x,1);out.set(y,33);return out;
}
async function generateVapid(){
  const kp=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
  const privateJwk=await crypto.subtle.exportKey("jwk",kp.privateKey);
  const publicJwk=await crypto.subtle.exportKey("jwk",kp.publicKey);
  return {privateJwk,publicJwk,publicKey:b64u(rawPublicFromJwk(publicJwk)),createdAt:new Date().toISOString()};
}
async function signJwt(vapid,endpoint){
  const origin=new URL(endpoint).origin;
  const header=b64uText(JSON.stringify({typ:"JWT",alg:"ES256"}));
  const payload=b64uText(JSON.stringify({
    aud:origin,
    exp:Math.floor(Date.now()/1000)+12*3600,
    sub:BASE_APP+"/"
  }));
  const input=header+"."+payload;
  const key=await crypto.subtle.importKey("jwk",vapid.privateJwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,enc.encode(input)));
  return input+"."+b64u(sig);
}
async function sendEmptyPush(vapid,endpoint,topic){
  const jwt=await signJwt(vapid,endpoint);
  const r=await fetch(endpoint,{
    method:"POST",
    headers:{
      "TTL":"86400",
      "Urgency":"high",
      // 거래 매수·매도는 서로 다른 이벤트가 큐에서 덮이지 않도록 Topic 없이 전송한다.
      ...(TRADE_TOPICS.has(topic)?{}:{"Topic":"jk-"+clean(topic||"notice",20)}),
      "Authorization":"vapid t="+jwt+", k="+vapid.publicKey
    }
  });
  return {ok:r.ok,status:r.status,text:(await r.text()).slice(0,200)};
}

function itemKey(category,row){
  return [category,row.HOUSE_MANAGE_NO||"",row.PBLANC_NO||"",row.HOUSE_NM||""].join("|");
}
function categoryName(c){return c==="apt"?"일반분양":c==="remndr"?"무순위·잔여":"임의공급"}
async function officialFeed(baseUrl){
  const from=kstDate(-14),to=kstDate(90);
  const cats=["apt","remndr","opt"],regions=["대전","세종"],out=[];
  for(const category of cats){
    for(const region of regions){
      const q=new URLSearchParams({kind:"applyhome",category,mode:"detail",region,from,to,perPage:"200"});
      try{
        const r=await fetch(baseUrl+"/api/realestate-gpt-live?"+q.toString(),{
          headers:{"accept":"application/json","user-agent":"JKQuant-Push/2.0"},
          cf:{cacheTtl:300,cacheEverything:true}
        });
        const j=await r.json();
        if(!r.ok||!j.ok)continue;
        for(const row of (j.payload&&j.payload.data)||[]){
          const name=clean(row.HOUSE_NM,140);if(!name)continue;
          out.push({
            key:itemKey(category,row),category,categoryName:categoryName(category),
            region:clean(row.SUBSCRPT_AREA_CODE_NM||region,30),name,
            announce:clean(row.RCRIT_PBLANC_DE,20),start:clean(row.RCEPT_BGNDE,20),
            end:clean(row.RCEPT_ENDDE,20),winner:clean(row.PRZWNER_PRESNATN_DE,20),
            units:Number(row.TOT_SUPLY_HSHLDCO||0)||null,address:clean(row.HSSPLY_ADRES,180),
            moveIn:clean(row.MVN_PREARNGE_YM,20),announceUrl:clean(row.PBLANC_URL,1500),
            houseManageNo:clean(row.HOUSE_MANAGE_NO,50),pblancNo:clean(row.PBLANC_NO,50)
          });
        }
      }catch(e){}
    }
  }
  const m=new Map();for(const x of out)m.set(x.key,x);
  return [...m.values()].sort((a,b)=>String(b.announce||b.start).localeCompare(String(a.announce||a.start)));
}
async function evaluateFreshPresales(base,items){
  const cache=new Map();
  const api=async q=>{
    const params=new URLSearchParams(q),url=base+"/api/realestate-gpt-live?"+params.toString();
    const key=params.toString();
    if(!cache.has(key))cache.set(key,(async()=>{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),12000);
      try{
        const r=await fetch(url,{headers:{"accept":"application/json","user-agent":"JKQuant-Presale-Score/1.0"},signal:controller.signal});
        const j=await r.json();
        if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));
        return j;
      }finally{clearTimeout(timer)}
    })());
    return cache.get(key);
  };
  const now=new Date(),out=new Array(items.length);let next=0;
  await Promise.all(Array.from({length:Math.min(items.length,2)},async()=>{
    while(next<items.length){
      const idx=next++,a=items[idx];
      a.evaluation=await evaluatePresale(a,api,now);
      out[idx]=a;
    }
  }));
  return out;
}

async function ipoFeed(base){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),23000);
  try{
    const r=await fetch(base+"/api/ipo",{
      headers:{"accept":"application/json","user-agent":"JKQuant-IPO-Digest/1.0"},
      signal:controller.signal,
      cf:{cacheTtl:0,cacheEverything:false}
    });
    const j=await r.json();
    // The existing IPO endpoint uses HTTP 502 + "no data" when both sources
    // responded successfully but the calendar contained no IPO events.
    if(!r.ok&&!(r.status===502&&j.error==="no data"&&Array.isArray(j.items)&&!j.items.length))
      throw new Error("IPO feed HTTP "+r.status+" "+String(j.error||""));
    if(!Array.isArray(j.items))throw new Error("IPO feed missing items");
    return j.items;
  }finally{clearTimeout(timer)}
}

async function jobFeed(baseUrl){
  const urls=[
    "https://raw.githubusercontent.com/jkdevjob/jkquant/main/data/job_archive.json?ts="+Date.now(),
    baseUrl+"/data/job_archive.json?ts="+Date.now()
  ];
  let j=null,lastError="";
  for(const url of urls){
    try{
      const r=await fetch(url,{
        headers:{"accept":"application/json","user-agent":"JKQuant-Job-Push/2.0"},
        cf:{cacheTtl:0,cacheEverything:false}
      });
      if(!r.ok){lastError="HTTP "+r.status;continue}
      j=await r.json();
      if(j&&Array.isArray(j.jobs))break;
    }catch(e){lastError=String(e&&e.message||e)}
  }
  if(!j||!Array.isArray(j.jobs))throw new Error("job archive fetch failed "+lastError);
  const out=[];
  for(const row of (Array.isArray(j.jobs)?j.jobs:[])){
    if(String(row.status||"")!=="active")continue;
    const key=clean(row.url||row.id,2000);if(!key)continue;
    const title=clean(row.title,180);if(!title||title==="제목 없음")continue;
    const deadline=clean(row.deadline,20);
    if(deadline&&deadline<kstDate(0))continue;
    out.push({
      key,title,company:clean(row.company,80),source:clean(row.source,40),
      firstSeen:clean(row.firstSeen,20),postedDate:clean(row.postedDate,20),
      deadline,externalUrl:clean(row.url,2000),
      appUrl:JOB_APP+"?focus="+encodeURIComponent(key)
    });
  }
  const m=new Map();for(const x of out)m.set(x.key,x);
  return [...m.values()].sort((a,b)=>{
    const ad=String(a.firstSeen||a.postedDate||""),bd=String(b.firstSeen||b.postedDate||"");
    return bd.localeCompare(ad)||String(a.title).localeCompare(String(b.title),"ko");
  });
}

export class PresaleAlertStore{
  constructor(state,env){this.state=state;this.env=env}
  async vapid(){
    let v=await this.state.storage.get("vapid");
    if(!v){v=await generateVapid();await this.state.storage.put("vapid",v)}
    return v;
  }
  async subscriptions(){return this.state.storage.list({prefix:"sub:"})}
  topicsOf(s){return normalizeTopics(s&&s.topics,s&&s.topics?[]:["presale"])}
  async subscribe(request){
    const body=await request.json().catch(()=>null),s=body&&body.subscription;
    const endpoint=clean(s&&s.endpoint,2000);
    if(!endpoint||!/^https:\/\//.test(endpoint))return json(request,{ok:false,error:"invalid subscription"},400);
    const id=await hashText(endpoint),old=await this.state.storage.get("sub:"+id);
    const topics=normalizeTopics(body&&body.topics,old?this.topicsOf(old):["presale"]);
    await this.state.storage.put("sub:"+id,{
      endpoint,topics,createdAt:(old&&old.createdAt)||new Date().toISOString(),
      updatedAt:new Date().toISOString(),ua:clean(body&&body.userAgent,220)
    });
    return json(request,{ok:true,subscribed:true,topics});
  }
  async subscription(request){
    const u=new URL(request.url),endpoint=clean(u.searchParams.get("endpoint"),2000);
    if(!endpoint)return json(request,{ok:false,error:"endpoint required"},400);
    const id=await hashText(endpoint),s=await this.state.storage.get("sub:"+id);
    return json(request,{ok:true,registered:!!s,topics:s?this.topicsOf(s):[]});
  }
  async unsubscribe(request){
    const body=await request.json().catch(()=>null),endpoint=clean(body&&body.endpoint,2000);
    if(!endpoint)return json(request,{ok:false,error:"endpoint required"},400);
    const id=await hashText(endpoint);await this.state.storage.delete("sub:"+id);
    return json(request,{ok:true,subscribed:false,topics:[]});
  }
  async pushOne(endpoint,topic){
    const v=await this.vapid(),r=await sendEmptyPush(v,endpoint,topic);
    if(r.status===404||r.status===410){
      const id=await hashText(endpoint);await this.state.storage.delete("sub:"+id);
    }
    return r;
  }
  async notifyAll(topic){
    const subs=await this.subscriptions();let sent=0,failed=0,removed=0,eligible=0;
    for(const [key,s] of subs){
      if(!this.topicsOf(s).includes(topic))continue;
      eligible++;
      try{
        const r=await this.pushOne(s.endpoint,topic);
        if(r.ok)sent++;else{failed++;if(r.status===404||r.status===410)removed++}
      }catch(e){failed++}
    }
    return {sent,failed,removed,total:subs.size,eligible};
  }
  async recordAlert(alert){
    const topic=clean(alert&&alert.type,20)||"notice";
    await this.state.storage.put("latest",alert);
    await this.state.storage.put("latest:"+topic,alert);
    let recent=await this.state.storage.get("recentAlerts");
    if(!Array.isArray(recent))recent=[];
    recent=[alert,...recent.filter(x=>x&&x.id!==alert.id)].slice(0,100);
    await this.state.storage.put("recentAlerts",recent);
    if(topic==="presale"&&alert&&alert.project){
      let a=await this.state.storage.get("recentPresaleAlerts");
      if(!Array.isArray(a))a=[];
      a=[alert,...a.filter(x=>x&&x.id!==alert.id)].slice(0,60);
      await this.state.storage.put("recentPresaleAlerts",a);
    }
  }
  async test(request){
    const body=await request.json().catch(()=>null),endpoint=clean(body&&body.endpoint,2000);
    const topic=VALID_TOPICS.has(String(body&&body.topic||""))?String(body.topic):"presale";
    if(!endpoint)return json(request,{ok:false,error:"endpoint required"},400);
    const id=await hashText(endpoint),sub=await this.state.storage.get("sub:"+id);
    if(!sub)return json(request,{ok:false,error:"subscription not registered"},404);
    const last=Number(await this.state.storage.get("test:"+id)||0);
    if(Date.now()-last<30000)return json(request,{ok:false,error:"테스트는 30초에 한 번 가능합니다."},429);
    const alert=TRADE_TOPICS.has(topic)?{
      id:"test-"+topic+"-"+Date.now(),type:topic,title:"🔔 "+({opening:"시초가",daytrading:"데이트레이딩",crypto:"비트코인",soxl:"SOXL"}[topic])+" 매매알림 테스트",
      body:"매수·매도 알림 수신이 정상 연결되었습니다. 실제 주문이 아닌 모의매매 신호입니다.",
      url:BASE_APP+"/scalping?strategy="+topic,createdAt:new Date().toISOString()
    }:topic==="ipo"?{
      id:"test-ipo-"+Date.now(),type:"ipo",title:"📈 공모주 웹알림 테스트",
      body:"IPO 일정 및 평가점수 웹알림이 정상 연결되었습니다.",
      url:IPO_APP,createdAt:new Date().toISOString()
    }:topic==="job"?{
      id:"test-job-"+Date.now(),type:"job",title:"💼 JOB 웹알림 테스트",
      body:"대전·세종 신규 채용공고 알림이 정상 연결되었습니다.",
      url:JOB_APP,createdAt:new Date().toISOString()
    }:{
      id:"test-presale-"+Date.now(),type:"presale",title:"🏢 신규분양 웹알림 테스트",
      body:"대전·세종 신규분양 알림이 정상 연결되었습니다.",
      url:PRESALE_APP+"?gpt=presale",createdAt:new Date().toISOString()
    };
    await this.recordAlert(alert);
    await this.state.storage.put("test:"+id,Date.now());
    const r=await this.pushOne(endpoint,topic);
    return json(request,{ok:r.ok,status:r.status,error:r.ok?null:r.text},r.ok?200:502);
  }
  async recordTradingSignal(request){
    // 서버 감시키를 아는 호출만 실제 푸시를 게시할 수 있다.
    if(!this.env.MONITOR_KEY||request.headers.get("x-monitor-key")!==this.env.MONITOR_KEY)
      return json(request,{ok:false,error:"unauthorized"},401);
    const b=await request.json().catch(()=>null);
    const topic=String(b&&b.strategy||"").toLowerCase(),stage=String(b&&b.stage||"").toLowerCase();
    if(!TRADE_TOPICS.has(topic)||!["buy","sell"].includes(stage))return json(request,{ok:false,error:"unsupported trading signal"},400);
    const eventId=clean(b.eventId,220),date=clean(b.date,20),time=clean(b.time,30);
    if(!eventId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date))return json(request,{ok:false,error:"invalid signal identity"},400);
    const marketDate=topic==="soxl"?new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()):kstDate();
    if(date!==marketDate)return json(request,{ok:false,error:"stale or future market date"},409);
    const id="trade:"+topic+":"+eventId,claimKey="signal:"+await hashText(id);
    if(await this.state.storage.get(claimKey))return json(request,{ok:true,duplicate:true,id,delivery:{sent:0}});
    const lines=Array.isArray(b.lines)?b.lines.map(x=>clean(x,200)).filter(Boolean).slice(0,5):[];
    const name={opening:"시초가",daytrading:"데이트레이딩",crypto:"비트코인",soxl:"SOXL"}[topic];
    const trade={id,type:topic,stage,createdAt:new Date().toISOString(),
      title:(stage==="buy"?"🟢 ":"🔴 ")+name+" 모의 "+(stage==="buy"?"매수":"매도")+" 타이밍",
      body:[date,time,...lines].filter(Boolean).join(" · ").slice(0,245),url:BASE_APP+"/scalping?strategy="+topic};
    // Durable Object에 먼저 기록해 Cron 중복/재시도로 두 번 보내지 않는다.
    await this.state.storage.put(claimKey,trade.createdAt);
    await this.recordAlert(trade);
    const delivery=await this.notifyAll(topic);
    await this.state.storage.put("lastCheck:"+topic,trade.createdAt);
    return json(request,{ok:true,duplicate:false,id,delivery});
  }
  async checkPresale(request){
    const base=this.env.BASE_URL||BASE_APP,items=await officialFeed(base);
    if(!items.length)return json(request,{ok:false,error:"official feed empty"},502);
    const seenArr=await this.state.storage.get("seen"),keys=items.map(x=>x.key);
    if(!Array.isArray(seenArr)){
      await this.state.storage.put("seen",keys.slice(0,1200));
      await this.state.storage.put("lastCheck",new Date().toISOString());
      return json(request,{ok:true,baseline:true,items:items.length,newCount:0});
    }
    const seen=new Set(seenArr),fresh=items.filter(x=>!seen.has(x.key));
    if(!fresh.length){
      await this.state.storage.put("lastCheck",new Date().toISOString());
      return json(request,{ok:true,items:items.length,newCount:0});
    }
    // 평가 실패나 API 누락이 있더라도 새 공고 자체는 누락하지 않는다.
    const evaluated=await evaluateFreshPresales(base,fresh);
    evaluated.sort((a,b)=>{
      const va=a.evaluation&&a.evaluation.status==="scored"?1:0;
      const vb=b.evaluation&&b.evaluation.status==="scored"?1:0;
      return vb-va||(vb&&va?(b.evaluation.score-a.evaluation.score):0)||
        String(b.announce||b.start).localeCompare(String(a.announce||a.start));
    });
    const top=evaluated[0],more=evaluated.length-1,ev=top.evaluation;
    const scored=ev&&ev.status==="scored";
    const headline=scored?ev.grade+" "+ev.score+"점/100":"평가 보류";
    const message=describeEvaluation(top)+(more>0?" · 신규 "+more+"건 추가":"");
    const url=PRESALE_APP+"?gpt=presale&notice="+encodeURIComponent(top.key);
    const alert={
      id:"presale:"+top.key,type:"presale",
      title:"🏢 "+top.region+" 신규분양 · "+headline,
      body:message.slice(0,250),url,project:top,
      newItems:evaluated.slice(0,25),
      scoringVersion:SCORING_VERSION,createdAt:new Date().toISOString()
    };
    await this.recordAlert(alert);
    // 알림 평가정보가 저장된 다음 seen을 갱신한다.
    await this.state.storage.put("seen",[...new Set([...items.map(x=>x.key),...seenArr])].slice(0,1600));
    await this.state.storage.put("lastCheck",new Date().toISOString());
    const delivery=await this.notifyAll("presale");
    return json(request,{ok:true,items:items.length,newCount:fresh.length,alert,delivery});

  }
  async checkJobs(request){
    const base=this.env.BASE_URL||BASE_APP,items=await jobFeed(base);
    if(!items.length)return json(request,{ok:false,error:"job feed empty"},502);
    const storageKey="seen:job",seenArr=await this.state.storage.get(storageKey),keys=items.map(x=>x.key);
    if(!Array.isArray(seenArr)){
      await this.state.storage.put(storageKey,keys.slice(0,5000));
      await this.state.storage.put("lastCheck:job",new Date().toISOString());
      return json(request,{ok:true,baseline:true,items:items.length,newCount:0});
    }
    const seen=new Set(seenArr),fresh=items.filter(x=>!seen.has(x.key));
    await this.state.storage.put(storageKey,[...new Set([...keys,...seenArr])].slice(0,7000));
    await this.state.storage.put("lastCheck:job",new Date().toISOString());
    if(!fresh.length)return json(request,{ok:true,items:items.length,newCount:0});
    const top=fresh[0],more=fresh.length-1;
    const body=(top.company?top.company+" · ":"")+top.title+
      (top.deadline?" · 마감 "+top.deadline:"")+(more>0?" 외 "+more+"건":"");
    const alert={
      id:"job:"+top.key,type:"job",title:"💼 대전·세종 신규 JOB "+fresh.length+"건",
      body,url:top.appUrl,job:top,newItems:fresh.slice(0,10),createdAt:new Date().toISOString()
    };
    await this.recordAlert(alert);
    const delivery=await this.notifyAll("job");
    return json(request,{ok:true,items:items.length,newCount:fresh.length,alert,delivery});
  }
  async checkIPO(request){
    const today=kstDate(0),stored=await this.state.storage.get("lastSent:ipo");
    if(stored===today)return json(request,{ok:true,skipped:true,reason:"이미 오늘 IPO 브리핑 발송",date:today});
    const rows=await ipoFeed(this.env.BASE_URL||BASE_APP);
    // Empty, valid items[] may be genuine lack of IPO. Error response is never treated as 'none'.
    const digest=buildDailyDigest(rows);
    if(digest.date!==today)return json(request,{ok:false,error:"date mismatch, retry"},503);
    const alert={
      id:"ipo-daily:"+digest.date,type:"ipo",
      title:digest.title,body:digest.body,
      url:IPO_APP+"?brief="+digest.date,
      digest,scoringVersion:IPO_SCORE_VERSION,
      createdAt:new Date().toISOString()
    };
    await this.recordAlert(alert);
    await this.state.storage.put("digest:ipo:"+today,digest);
    await this.state.storage.put("lastCheck:ipo",new Date().toISOString());
    const delivery=await this.notifyAll("ipo");
    await this.state.storage.put("lastSent:ipo",today);
    return json(request,{ok:true,date:today,sent:delivery.sent,digest,delivery});
  }
  async ipoDaily(request){
    const day=clean(new URL(request.url).searchParams.get("date"),10)||kstDate(0);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return json(request,{ok:false,error:"invalid date"},400);
    const digest=await this.state.storage.get("digest:ipo:"+day);
    return json(request,{ok:true,date:day,digest:digest||null});
  }
  async fetch(request){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(request)});
    const u=new URL(request.url),path=u.pathname;
    if(path==="/health"){
      const subs=await this.subscriptions(),lastCheck=await this.state.storage.get("lastCheck");
      const jobLastCheck=await this.state.storage.get("lastCheck:job");
      const counts=Object.fromEntries([...VALID_TOPICS].map(t=>[t,0]));
      for(const [,s] of subs)for(const t of this.topicsOf(s))counts[t]++;
      const lastChecks={presale:lastCheck||null,job:jobLastCheck||null,ipo:await this.state.storage.get("lastCheck:ipo")||null};
      for(const t of TRADE_TOPICS)lastChecks[t]=await this.state.storage.get("lastCheck:"+t)||null;
      return json(request,{ok:true,service:"jkquant-push-alert",version:"2.1.0",subscriptions:subs.size,
        topicSubscriptions:counts,lastCheck:lastCheck||null,lastChecks});
    }
    if(path==="/vapid"){const v=await this.vapid();return json(request,{ok:true,publicKey:v.publicKey})}
    if(path==="/latest"){
      const topic=String(u.searchParams.get("topic")||"");
      const alert=topic?await this.state.storage.get("latest:"+topic):await this.state.storage.get("latest");
      const alerts=await this.state.storage.get("recentAlerts");
      return json(request,{ok:true,alert:alert||null,alerts:Array.isArray(alerts)?alerts:[]});
    }
    if(path==="/presale-item"&&request.method==="GET"){
      const key=clean(u.searchParams.get("key"),250);
      if(!key)return json(request,{ok:false,error:"key required"},400);
      const recent=await this.state.storage.get("recentPresaleAlerts");
      for(const alert of (Array.isArray(recent)?recent:[])){
        const selected=(alert.newItems||[]).find(x=>x&&x.key===key);
        if(selected)return json(request,{ok:true,item:selected,alertCreatedAt:alert.createdAt});
      }
      return json(request,{ok:false,error:"최근 알림 상세 보관기간이 지났습니다."},404);
    }
    if(path==="/subscription"&&request.method==="GET")return this.subscription(request);
    if(path==="/subscribe"&&request.method==="POST")return this.subscribe(request);
    if(path==="/subscribe"&&request.method==="DELETE")return this.unsubscribe(request);
    if(path==="/test"&&request.method==="POST")return this.test(request);
    if(path==="/signal"&&request.method==="POST")return this.recordTradingSignal(request);
    if(path==="/check"&&request.method==="POST")return this.checkPresale(request);
    if(path==="/check-jobs"&&request.method==="POST")return this.checkJobs(request);
    if(path==="/check-ipo"&&request.method==="POST")return this.checkIPO(request);
    if(path==="/ipo-daily"&&request.method==="GET")return this.ipoDaily(request);
    return json(request,{ok:false,error:"not found"},404);
  }
}

export default{
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(request)});
    const id=env.ALERT_STORE.idFromName("global");
    return env.ALERT_STORE.get(id).fetch(request);
  },
  async scheduled(controller,env,ctx){
    const id=env.ALERT_STORE.idFromName("global"),stub=env.ALERT_STORE.get(id);
    if(controller&&controller.cron==="10 23 * * *"){
      ctx.waitUntil(stub.fetch(new Request("https://internal/check-ipo",{method:"POST"})));
      return;
    }
    ctx.waitUntil(Promise.allSettled([
      stub.fetch(new Request("https://internal/check",{method:"POST"})),
      stub.fetch(new Request("https://internal/check-jobs",{method:"POST"}))
    ]));
  }
};
