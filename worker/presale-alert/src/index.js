const enc=new TextEncoder();
const APP_URL="https://jkquant.pages.dev/realestate";
const ALLOW_ORIGINS=new Set(["https://jkquant.pages.dev","http://localhost:8788","http://127.0.0.1:8788"]);

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
    sub:"https://jkquant.pages.dev/"
  }));
  const input=header+"."+payload;
  const key=await crypto.subtle.importKey("jwk",vapid.privateJwk,{name:"ECDSA",namedCurve:"P-256"},false,["sign"]);
  const sig=new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},key,enc.encode(input)));
  return input+"."+b64u(sig);
}
async function sendEmptyPush(vapid,endpoint){
  const jwt=await signJwt(vapid,endpoint);
  const r=await fetch(endpoint,{
    method:"POST",
    headers:{
      "TTL":"86400",
      "Urgency":"high",
      "Topic":"jk-presale",
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
      const q=new URLSearchParams({
        kind:"applyhome",category,mode:"detail",region,from,to,perPage:"200"
      });
      try{
        const r=await fetch(baseUrl+"/api/realestate-gpt-live?"+q.toString(),{
          headers:{"accept":"application/json","user-agent":"JKQuant-Presale-Push/1.0"},
          cf:{cacheTtl:300,cacheEverything:true}
        });
        const j=await r.json();
        if(!r.ok||!j.ok)continue;
        for(const row of (j.payload&&j.payload.data)||[]){
          const name=clean(row.HOUSE_NM,140);if(!name)continue;
          out.push({
            key:itemKey(category,row),
            category,
            categoryName:categoryName(category),
            region:clean(row.SUBSCRPT_AREA_CODE_NM||region,30),
            name,
            announce:clean(row.RCRIT_PBLANC_DE,20),
            start:clean(row.RCEPT_BGNDE,20),
            end:clean(row.RCEPT_ENDDE,20),
            winner:clean(row.PRZWNER_PRESNATN_DE,20),
            units:Number(row.TOT_SUPLY_HSHLDCO||0)||null,
            address:clean(row.HSSPLY_ADRES,180),
            houseManageNo:clean(row.HOUSE_MANAGE_NO,50),
            pblancNo:clean(row.PBLANC_NO,50)
          });
        }
      }catch(e){}
    }
  }
  const m=new Map();
  for(const x of out)m.set(x.key,x);
  return [...m.values()].sort((a,b)=>String(b.announce||b.start).localeCompare(String(a.announce||a.start)));
}

export class PresaleAlertStore{
  constructor(state,env){this.state=state;this.env=env}
  async vapid(){
    let v=await this.state.storage.get("vapid");
    if(!v){v=await generateVapid();await this.state.storage.put("vapid",v)}
    return v;
  }
  async subscriptions(){return this.state.storage.list({prefix:"sub:"})}
  async subscribe(request){
    const body=await request.json().catch(()=>null),s=body&&body.subscription;
    const endpoint=clean(s&&s.endpoint,2000);
    if(!endpoint||!/^https:\/\//.test(endpoint))return json(request,{ok:false,error:"invalid subscription"},400);
    const id=await hashText(endpoint);
    await this.state.storage.put("sub:"+id,{endpoint,createdAt:new Date().toISOString(),ua:clean(body.userAgent,220)});
    return json(request,{ok:true,subscribed:true});
  }
  async unsubscribe(request){
    const body=await request.json().catch(()=>null),endpoint=clean(body&&body.endpoint,2000);
    if(!endpoint)return json(request,{ok:false,error:"endpoint required"},400);
    const id=await hashText(endpoint);await this.state.storage.delete("sub:"+id);
    return json(request,{ok:true,subscribed:false});
  }
  async pushOne(endpoint){
    const v=await this.vapid(),r=await sendEmptyPush(v,endpoint);
    if(r.status===404||r.status===410){
      const id=await hashText(endpoint);await this.state.storage.delete("sub:"+id);
    }
    return r;
  }
  async notifyAll(){
    const subs=await this.subscriptions();let sent=0,failed=0,removed=0;
    for(const [key,s] of subs){
      try{
        const r=await this.pushOne(s.endpoint);
        if(r.ok)sent++;else{failed++;if(r.status===404||r.status===410)removed++}
      }catch(e){failed++}
    }
    return {sent,failed,removed,total:subs.size};
  }
  async test(request){
    const body=await request.json().catch(()=>null),endpoint=clean(body&&body.endpoint,2000);
    if(!endpoint)return json(request,{ok:false,error:"endpoint required"},400);
    const id=await hashText(endpoint),sub=await this.state.storage.get("sub:"+id);
    if(!sub)return json(request,{ok:false,error:"subscription not registered"},404);
    const last=Number(await this.state.storage.get("test:"+id)||0);
    if(Date.now()-last<30000)return json(request,{ok:false,error:"테스트는 30초에 한 번 가능합니다."},429);
    await this.state.storage.put("latest",{
      id:"test-"+Date.now(),type:"test",title:"JK 부동산 웹알림 테스트",
      body:"대전·세종 신규분양 알림이 정상 연결되었습니다.",
      url:APP_URL+"?gpt=presale",createdAt:new Date().toISOString()
    });
    await this.state.storage.put("test:"+id,Date.now());
    const r=await this.pushOne(endpoint);
    return json(request,{ok:r.ok,status:r.status,error:r.ok?null:r.text},r.ok?200:502);
  }
  async check(request){
    const base=this.env.BASE_URL||"https://jkquant.pages.dev";
    const items=await officialFeed(base);
    if(!items.length)return json(request,{ok:false,error:"official feed empty"},502);
    const seenArr=await this.state.storage.get("seen");
    const keys=items.map(x=>x.key);
    if(!Array.isArray(seenArr)){
      await this.state.storage.put("seen",keys.slice(0,1200));
      await this.state.storage.put("lastCheck",new Date().toISOString());
      return json(request,{ok:true,baseline:true,items:items.length,newCount:0});
    }
    const seen=new Set(seenArr),fresh=items.filter(x=>!seen.has(x.key));
    const merged=[...new Set([...keys,...seenArr])].slice(0,1600);
    await this.state.storage.put("seen",merged);
    await this.state.storage.put("lastCheck",new Date().toISOString());
    if(!fresh.length)return json(request,{ok:true,items:items.length,newCount:0});
    const top=fresh[0],more=fresh.length-1;
    const alert={
      id:top.key,type:"presale",
      title:"🏢 신규분양 · "+top.region+" · "+top.categoryName,
      body:top.name+(top.start?(" · 접수 "+top.start+(top.end&&top.end!==top.start?"~"+top.end:"")):"")+(more>0?(" 외 "+more+"건"):""),
      url:APP_URL+"?gpt=presale",
      project:top,newItems:fresh.slice(0,10),createdAt:new Date().toISOString()
    };
    await this.state.storage.put("latest",alert);
    const delivery=await this.notifyAll();
    return json(request,{ok:true,items:items.length,newCount:fresh.length,alert,delivery});
  }
  async fetch(request){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors(request)});
    const u=new URL(request.url),path=u.pathname;
    if(path==="/health"){
      const subs=await this.subscriptions(),lastCheck=await this.state.storage.get("lastCheck");
      return json(request,{ok:true,service:"jkquant-presale-alert",version:"1.0.0",subscriptions:subs.size,lastCheck:lastCheck||null});
    }
    if(path==="/vapid"){
      const v=await this.vapid();return json(request,{ok:true,publicKey:v.publicKey});
    }
    if(path==="/latest"){
      const alert=await this.state.storage.get("latest");
      return json(request,{ok:true,alert:alert||null});
    }
    if(path==="/subscribe"&&request.method==="POST")return this.subscribe(request);
    if(path==="/subscribe"&&request.method==="DELETE")return this.unsubscribe(request);
    if(path==="/test"&&request.method==="POST")return this.test(request);
    if(path==="/check"&&request.method==="POST")return this.check(request);
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
    const id=env.ALERT_STORE.idFromName("global");
    ctx.waitUntil(env.ALERT_STORE.get(id).fetch(new Request("https://internal/check",{method:"POST"})));
  }
};