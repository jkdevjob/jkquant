// 단타(지피티) 매수·매도 타이밍 웹 알림 — 설정 > 알림에서 사용.
(function(){
"use strict";
function supported(){return "serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window}
function iosNeedsHome(){return /iPhone|iPad|iPod/.test(navigator.userAgent||"")&&!(navigator.standalone===true||(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches))}
function key(s){s=String(s).replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";var b=atob(s),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
async function api(getToken,body){
  var h={Accept:"application/json"},t=getToken?await getToken():"";if(t)h.Authorization="Bearer "+t;
  if(body)h["content-type"]="application/json";
  var r=await fetch("/api/scalping-push",body?{method:"POST",headers:h,body:JSON.stringify(body)}:{headers:h});
  var j=await r.json().catch(function(){return {}});
  if(r.status===401)throw new Error("단타(지피티) 알림은 소유자 계정으로 로그인해야 켤 수 있습니다.");
  if(!r.ok||j.ok===false)throw new Error(j.error||("HTTP "+r.status));
  return j;
}
async function reg(){return navigator.serviceWorker.getRegistration("/scalping")}
async function state(){
  if(!supported())return "unsupported";
  try{var g=await reg(),s=g&&await g.pushManager.getSubscription();return s&&Notification.permission==="granted"?"on":"off"}catch(e){return "off"}
}
async function enable(getToken){
  if(iosNeedsHome())throw new Error("아이폰은 Safari에서 공유 → '홈 화면에 추가' 한 뒤 홈 화면의 JK 투자 아이콘으로 열어 켜야 합니다(iOS 16.4 이상).");
  if(!supported())throw new Error("이 브라우저는 웹 알림을 지원하지 않습니다.");
  var perm=Notification.permission==="granted"?"granted":await Notification.requestPermission();
  if(perm!=="granted")throw new Error("알림 권한이 꺼져 있습니다 — 설정에서 JK 투자 알림을 허용해 주세요.");
  var g=await navigator.serviceWorker.register("/scalping-sw.js",{scope:"/scalping"});
  if(!g.active)await new Promise(function(ok){var w=g.installing||g.waiting;if(!w)return ok();w.addEventListener("statechange",function(){if(w.state==="activated")ok()});setTimeout(ok,5000)});
  var k=await api(getToken);
  if(!k.publicKey)throw new Error("알림 키를 못 받음");
  var s=await g.pushManager.getSubscription()||await g.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key(k.publicKey)});
  await api(getToken,{action:"subscribe",subscription:s.toJSON()});
  await api(getToken,{action:"test"}).catch(function(){});
  return "on";
}
async function disable(getToken){
  var g=await reg(),s=g&&await g.pushManager.getSubscription();
  if(s){await api(getToken,{action:"unsubscribe",endpoint:s.endpoint}).catch(function(){});await s.unsubscribe()}
  return "off";
}
async function test(getToken){return api(getToken,{action:"test"})}
window.ScalpingPush={supported:supported,iosNeedsHome:iosNeedsHome,state:state,enable:enable,disable:disable,test:test};
})();
