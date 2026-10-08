self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));

const CONFIG="/data/realestate/gpt/push-config.json";
const META_CACHE="jk-push-meta-v2";
const TOPICS_KEY="/__jk_push_topics";
const SHOWN_KEY="/__jk_push_shown";
const VALID_TOPICS=new Set(["presale","job","ipo","opening","daytrading","crypto","soxl"]);

async function getConfig(){
  const r=await fetch(CONFIG+"?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("push config "+r.status);
  return r.json();
}
async function getLatest(){
  const c=await getConfig();
  if(!c.workerUrl)throw new Error("push server not ready");
  const r=await fetch(c.workerUrl+"/latest",{cache:"no-store"});
  if(!r.ok)throw new Error("latest "+r.status);
  return r.json();
}
async function readMeta(key,fallback){
  try{
    const cache=await caches.open(META_CACHE),r=await cache.match(key);
    if(!r)return fallback;
    return await r.json();
  }catch(e){return fallback}
}
async function writeMeta(key,value){
  try{
    const cache=await caches.open(META_CACHE);
    await cache.put(key,new Response(JSON.stringify(value),{headers:{"content-type":"application/json"}}));
  }catch(e){}
}
async function topics(){
  const v=await readMeta(TOPICS_KEY,[]);
  return Array.isArray(v)?v:[];
}
async function shownIds(){
  const v=await readMeta(SHOWN_KEY,[]);
  return Array.isArray(v)?v:[];
}
async function markShown(id){
  if(!id)return;
  const v=await shownIds();
  await writeMeta(SHOWN_KEY,[id,...v.filter(x=>x!==id)].slice(0,100));
}
function pickAlerts(payload,allowed,shown,now=Date.now()){
  if(!allowed.length)return []; // 설정하지 않은 주제의 알림은 표시하지 않는다.
  const rows=[];
  if(payload&&Array.isArray(payload.alerts))rows.push(...payload.alerts);
  if(payload&&payload.alert)rows.push(payload.alert);
  const seen=new Set(),uniq=[];
  for(const a of rows){
    if(!a||!a.id||seen.has(a.id))continue;
    seen.add(a.id);
    const age=now-Date.parse(a.createdAt||"");
    if(!Number.isFinite(age)||age<0||age>20*60*1000)continue;
    if(!allowed.includes(String(a.type||""))||shown.includes(a.id))continue;
    uniq.push(a);
  }
  uniq.sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
  return uniq.slice(-10);
}
self.addEventListener("message",event=>{
  const d=event.data||{};
  if(d.type==="JK_PUSH_TOPICS"){
    const a=Array.isArray(d.topics)?d.topics.filter(x=>VALID_TOPICS.has(x)):[];
    event.waitUntil(writeMeta(TOPICS_KEY,[...new Set(a)]));
  }
});
self.addEventListener("push",event=>{
  event.waitUntil((async()=>{
    try{
      const [j,allowed,shown]=await Promise.all([getLatest(),topics(),shownIds()]);
      const alerts=pickAlerts(j,allowed,shown);
      for(const a of alerts){
        await self.registration.showNotification(a.title||"JK 알림",{
          body:a.body||"새로운 정보가 업데이트되었습니다.",
          icon:"/icons/jk-invest-192.png?v=1.0.0",
          badge:"/icons/jk-invest-192.png?v=1.0.0",
          tag:"jk-"+String(a.id||"latest").slice(0,100),
          renotify:false,data:{url:a.url||"/"}
        });
        await markShown(a.id);
      }
    }catch(e){
      await self.registration.showNotification("JK 알림",{
        body:"새로운 정보가 업데이트되었습니다. 눌러서 확인하세요.",
        icon:"/icons/jk-invest-192.png?v=1.0.0",
        tag:"jk-notice-fallback",
        data:{url:"/"}
      });
    }
  })());
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=(event.notification.data&&event.notification.data.url)||"/";
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const c of list){
      try{
        if("navigate" in c)await c.navigate(url);
        if("focus" in c)return c.focus();
      }catch(e){}
    }
    return clients.openWindow(url);
  })());
});
