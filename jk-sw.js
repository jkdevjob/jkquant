self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));

const CONFIG="/data/realestate/gpt/push-config.json";
const META_CACHE="jk-push-meta-v2";
const TOPICS_KEY="/__jk_push_topics";
const SHOWN_KEY="/__jk_push_shown";

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
function pickAlert(payload,allowed,shown){
  const rows=[];
  if(payload&&Array.isArray(payload.alerts))rows.push(...payload.alerts);
  if(payload&&payload.alert)rows.push(payload.alert);
  const uniq=[],seen=new Set();
  for(const a of rows){
    if(!a||!a.id||seen.has(a.id))continue;
    seen.add(a.id);uniq.push(a);
  }
  uniq.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  let candidates=uniq.filter(a=>shown.indexOf(a.id)<0);
  if(allowed.length)candidates=candidates.filter(a=>allowed.indexOf(String(a.type||""))>=0);
  return candidates[0]||null;
}
self.addEventListener("message",event=>{
  const d=event.data||{};
  if(d.type==="JK_PUSH_TOPICS"){
    const a=Array.isArray(d.topics)?d.topics.filter(x=>x==="presale"||x==="job"):[];
    event.waitUntil(writeMeta(TOPICS_KEY,[...new Set(a)]));
  }
});
self.addEventListener("push",event=>{
  event.waitUntil((async()=>{
    try{
      const [j,allowed,shown]=await Promise.all([getLatest(),topics(),shownIds()]);
      const a=pickAlert(j,allowed,shown);
      if(!a)return;
      await self.registration.showNotification(a.title||"JK 알림",{
        body:a.body||"새로운 정보가 업데이트되었습니다.",
        icon:"/icons/jk-invest-192.png?v=1.0.0",
        badge:"/icons/jk-invest-192.png?v=1.0.0",
        tag:"jk-"+String(a.type||"notice")+"-"+String(a.id||"latest"),
        renotify:true,
        data:{url:a.url||"/"}
      });
      await markShown(a.id);
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
