self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
const CONFIG="/data/realestate/gpt/push-config.json";
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
self.addEventListener("push",event=>{
  event.waitUntil((async()=>{
    try{
      const j=await getLatest(),a=j&&j.alert;
      if(!a)return;
      await self.registration.showNotification(a.title||"JK 부동산 신규분양",{
        body:a.body||"대전·세종 신규분양 정보가 업데이트되었습니다.",
        icon:"/icons/jk-invest-192.png?v=1.0.0",
        badge:"/icons/jk-invest-192.png?v=1.0.0",
        tag:"jk-presale-"+String(a.id||"latest"),
        renotify:true,
        data:{url:a.url||"/realestate?gpt=presale"}
      });
    }catch(e){
      await self.registration.showNotification("JK 부동산 신규분양",{
        body:"신규분양 정보가 업데이트되었습니다. 눌러서 확인하세요.",
        icon:"/icons/jk-invest-192.png?v=1.0.0",
        tag:"jk-presale-fallback",
        data:{url:"/realestate?gpt=presale"}
      });
    }
  })());
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const url=(event.notification.data&&event.notification.data.url)||"/realestate?gpt=presale";
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
