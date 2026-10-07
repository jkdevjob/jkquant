// 단타(지피티) 매수·매도 타이밍 웹 알림 받기 전용. 네트워크 요청은 가로채지 않는다.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("push",e=>{
  let d={};try{d=e.data?e.data.json():{}}catch(_){d={body:e.data?e.data.text():""}}
  e.waitUntil(self.registration.showNotification(d.title||"JK 투자 단타(지피티)",{
    body:d.body||"",tag:d.tag||undefined,renotify:!!d.tag,icon:"/icons/jk-invest-192.png",badge:"/icons/jk-invest-192.png",
    data:{url:d.url||"/scalping"}
  }));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();const url=e.notification.data&&e.notification.data.url||"/scalping";
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(cs=>{
    for(const c of cs)if(c.url.includes("/scalping")&&"focus" in c)return c.focus();
    return self.clients.openWindow(url);
  }));
});
