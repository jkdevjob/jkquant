(function(){
"use strict";
const CONFIG="/data/realestate/gpt/push-config.json";
const host=document.getElementById("notificationSettings");
if(!host)return;
let cfg=null,reg=null,sub=null,health=null,busy=false;

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function isIOS(){return /iPad|iPhone|iPod/.test(navigator.userAgent||"")}
function standalone(){return !!(window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone===true}
function supported(){return "serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window}
function b64ToU8(s){
  const pad="=".repeat((4-s.length%4)%4),b64=(s+pad).replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(b64),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
}
async function getConfig(){
  const r=await fetch(CONFIG+"?ts="+Date.now(),{cache:"no-store"});
  if(!r.ok)throw new Error("푸시 설정 HTTP "+r.status);
  const j=await r.json();if(!j.workerUrl)throw new Error("푸시 서버 배포 중");
  return j;
}
async function server(path,opt){
  if(!cfg)cfg=await getConfig();
  const r=await fetch(cfg.workerUrl+path,opt);
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok||j.ok===false)throw new Error(j.error||("푸시 서버 HTTP "+r.status));
  return j;
}
async function getSubscription(){
  if(!supported())return null;
  reg=await navigator.serviceWorker.register("/jk-sw.js?v=1.0.0",{scope:"/"});
  await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
function description(){
  if(isIOS()&&!standalone())return "iPhone은 Safari에서 JK투자를 홈 화면에 추가한 뒤 홈화면 아이콘으로 실행해야 웹푸시를 켤 수 있습니다.";
  if(!supported())return "이 브라우저는 백그라운드 웹푸시를 지원하지 않습니다.";
  if(Notification.permission==="denied")return "알림 권한이 차단돼 있습니다. 기기 설정에서 JK 투자 알림을 허용해 주세요.";
  if(sub)return "대전·세종의 새 일반분양·무순위/잔여·임의공급 공고를 약 30분 간격으로 확인해 알려줍니다.";
  return "대전·세종 신규분양 공고가 새로 올라오면 웹푸시로 알려줍니다.";
}
function render(){
  const on=!!sub,iosNeed=isIOS()&&!standalone(),blocked=typeof Notification!=="undefined"&&Notification.permission==="denied";
  host.innerHTML='<div class="alert-list"><div class="alert-item">'+
    '<div class="alert-top"><div><div class="alert-name">🏢 대전·세종 신규분양</div><div class="alert-desc">'+esc(description())+'</div></div>'+
    '<span class="badge '+(on?'on':'')+'">'+(on?'ON':'OFF')+'</span></div>'+
    '<div class="actions">'+
      (!on?'<button id="notifyOn" '+((busy||iosNeed||blocked||!supported()||!cfg)?'disabled':'')+'>알림 켜기</button>':'')+
      (on?'<button id="notifyTest" '+(busy?'disabled':'')+'>테스트 알림</button><button class="secondary" id="notifyOff" '+(busy?'disabled':'')+'>알림 끄기</button>':'')+
    '</div>'+
    (iosNeed?'<div class="help"><b>iPhone 설정</b><br>Safari에서 JK투자를 연 뒤 공유 → <b>홈 화면에 추가</b> → 홈화면의 JK투자 아이콘으로 실행 → 설정 → 알림에서 다시 켜세요.</div>':'')+
    '<div class="server">'+(health?('푸시 서버 정상 · 등록기기 '+Number(health.subscriptions||0)+'대 · 최근 확인 '+esc(health.lastCheck||"대기중")):(cfg?'푸시 서버 연결 확인 중':'푸시 서버 연결 안 됨'))+'</div>'+
  '</div></div>';
  const onBtn=document.getElementById("notifyOn"),offBtn=document.getElementById("notifyOff"),testBtn=document.getElementById("notifyTest");
  if(onBtn)onBtn.addEventListener("click",enable);
  if(offBtn)offBtn.addEventListener("click",disable);
  if(testBtn)testBtn.addEventListener("click",test);
}
async function enable(){
  if(busy)return;busy=true;render();
  try{
    if(isIOS()&&!standalone())throw new Error("iPhone에서는 먼저 Safari 공유 → 홈 화면에 추가 후 홈화면 앱으로 실행하세요.");
    if(!supported())throw new Error("이 브라우저는 웹푸시를 지원하지 않습니다.");
    const perm=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    if(perm!=="granted")throw new Error("알림 권한이 허용되지 않았습니다.");
    reg=await navigator.serviceWorker.register("/jk-sw.js?v=1.0.0",{scope:"/"});
    await navigator.serviceWorker.ready;
    const v=await server("/vapid");
    sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(v.publicKey)});
    await server("/subscribe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subscription:sub.toJSON(),userAgent:navigator.userAgent})});
    try{health=await server("/health")}catch(e){}
    alert("신규분양 알림을 켰습니다.");
  }catch(e){alert("알림 설정 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function disable(){
  if(busy||!sub)return;busy=true;render();
  try{
    await server("/subscribe",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})}).catch(()=>{});
    await sub.unsubscribe();sub=null;
  }catch(e){alert("알림 해제 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function test(){
  if(busy||!sub)return;busy=true;render();
  try{
    const j=await server("/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({endpoint:sub.endpoint})});
    if(j.ok)alert("테스트 알림을 보냈습니다.");
  }catch(e){alert("테스트 알림 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function init(){
  try{cfg=await getConfig()}catch(e){cfg=null}
  if(supported()){try{sub=await getSubscription()}catch(e){sub=null}}
  if(cfg){try{health=await server("/health")}catch(e){health=null}}
  render();
}
init();
})();