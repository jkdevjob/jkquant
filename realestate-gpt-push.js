(function(){
"use strict";
const CONFIG="/data/realestate/gpt/push-config.json";
let cfg=null,reg=null,sub=null,busy=false,health=null,topics=new Set();

function qs(s,r=document){return r.querySelector(s)}
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
async function currentSub(){
  if(!supported())return null;
  reg=await navigator.serviceWorker.register("/jk-sw.js?v=2.0.0",{scope:"/"});
  await navigator.serviceWorker.ready;
  sub=await reg.pushManager.getSubscription();
  if(sub&&cfg){
    try{
      const j=await server("/subscription?endpoint="+encodeURIComponent(sub.endpoint));
      topics=new Set(j.topics||[]);
    }catch(e){}
  }
  return sub;
}
function statusText(){
  if(isIOS()&&!standalone())return "iPhone은 Safari에서 JK투자를 홈 화면에 추가한 뒤, 홈화면 아이콘으로 실행해야 백그라운드 웹알림을 켤 수 있습니다.";
  if(!supported())return "이 브라우저는 웹 푸시를 지원하지 않습니다.";
  if(Notification.permission==="denied")return "알림 권한이 차단돼 있습니다. iPhone 설정의 알림에서 JK 투자를 허용한 뒤 다시 시도하세요.";
  if(topics.has("presale"))return "웹알림 켜짐 · 대전·세종 신규분양 공고를 약 30분 간격으로 자동 확인합니다.";
  if(cfg&&cfg.workerUrl)return "웹알림 꺼짐 · 한 번만 켜면 새 분양공고가 생길 때 푸시로 알려줍니다.";
  return "푸시 서버 배포 또는 연결 설정을 확인하는 중…";
}
function panel(){
  const host=qs("#gptPresale");if(!host)return;
  let box=qs("#gptPresalePush",host);
  if(!box){
    box=document.createElement("div");box.id="gptPresalePush";box.className="gpt-panel ps-push";
    host.prepend(box);
  }
  const on=topics.has("presale"),iosNeed=isIOS()&&!standalone(),blocked=typeof Notification!=="undefined"&&Notification.permission==="denied";
  box.innerHTML=
    '<div class="ps-push-head"><div><h4>🔔 신규분양 웹알림</h4><div class="ps-mini">'+esc(statusText())+'</div></div>'+
    '<span class="ps-badge '+(on?'open':'closed')+'">'+(on?'알림 ON':'알림 OFF')+'</span></div>'+
    '<div class="ps-push-actions">'+
      (!on?'<button id="psPushOn" '+((busy||iosNeed||blocked||!supported())?'disabled':'')+'>신규분양 알림 켜기</button>':'')+
      (on?'<button id="psPushTest" '+(busy?'disabled':'')+'>테스트 알림</button><button id="psPushOff" '+(busy?'disabled':'')+'>알림 끄기</button>':'')+
    '</div>'+
    (iosNeed?'<div class="ps-push-help"><b>iPhone 설정 방법</b> Safari 아래 공유 버튼 → <b>홈 화면에 추가</b> → 홈화면의 JK투자 실행 → 이 화면에서 알림 켜기</div>':'')+
    (health?'<div class="ps-push-help">푸시 서버 정상 · 구독 '+Number(health.subscriptions||0)+'대 · 최근 확인 '+esc(health.lastCheck||"대기중")+'</div>':'');
  bind(box);
}
function bind(box){
  const on=qs("#psPushOn",box),test=qs("#psPushTest",box),off=qs("#psPushOff",box);
  if(on)on.addEventListener("click",enable);
  if(test)test.addEventListener("click",sendTest);
  if(off)off.addEventListener("click",disable);
}
async function enable(){
  if(busy)return;busy=true;panel();
  try{
    if(isIOS()&&!standalone())throw new Error("iPhone에서는 먼저 Safari 공유 → 홈 화면에 추가 후 홈화면 앱으로 실행하세요.");
    const perm=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    if(perm!=="granted")throw new Error("알림 권한이 허용되지 않았습니다.");
    cfg=await getConfig();
    reg=await navigator.serviceWorker.register("/jk-sw.js?v=2.0.0",{scope:"/"});
    await navigator.serviceWorker.ready;
    const v=await server("/vapid");
    sub=await reg.pushManager.getSubscription();
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(v.publicKey)});
    try{
      const current=await server("/subscription?endpoint="+encodeURIComponent(sub.endpoint));
      topics=new Set(current.topics||[]);
    }catch(e){}
    topics.add("presale");
    await server("/subscribe",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({subscription:sub.toJSON(),userAgent:navigator.userAgent,topics:[...topics]})
    });
    try{
      const msg={type:"JK_PUSH_TOPICS",topics:[...topics]};
      if(navigator.serviceWorker.controller)navigator.serviceWorker.controller.postMessage(msg);
      if(reg.active)reg.active.postMessage(msg);
    }catch(e){}
    try{health=await server("/health")}catch(e){}
    panel();
    alert("신규분양 웹알림을 켰습니다. 테스트 알림으로 수신 여부를 확인할 수 있습니다.");
  }catch(e){alert("웹알림 설정 실패: "+String(e&&e.message||e))}
  finally{busy=false;panel()}
}
async function disable(){
  if(busy||!sub)return;busy=true;panel();
  try{
    cfg=cfg||await getConfig();
    topics.delete("presale");
    if(topics.size){
      await server("/subscribe",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({subscription:sub.toJSON(),userAgent:navigator.userAgent,topics:[...topics]})
      });
    }else{
      await server("/subscribe",{
        method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({endpoint:sub.endpoint})
      }).catch(()=>{});
      await sub.unsubscribe();sub=null;
    }
    try{
      const msg={type:"JK_PUSH_TOPICS",topics:[...topics]};
      if(navigator.serviceWorker.controller)navigator.serviceWorker.controller.postMessage(msg);
      if(reg&&reg.active)reg.active.postMessage(msg);
    }catch(e){}
    panel();
  }catch(e){alert("알림 해제 실패: "+String(e&&e.message||e))}
  finally{busy=false;panel()}
}
async function sendTest(){
  if(busy||!sub)return;busy=true;panel();
  try{
    const j=await server("/test",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({endpoint:sub.endpoint,topic:"presale"})
    });
    if(j.ok)alert("테스트 푸시를 보냈습니다. 잠시 후 알림이 도착해야 합니다.");
  }catch(e){alert("테스트 알림 실패: "+String(e&&e.message||e))}
  finally{busy=false;panel()}
}
async function init(){
  try{cfg=await getConfig()}catch(e){cfg=null}
  if(supported()){
    try{sub=await currentSub()}catch(e){sub=null}
  }
  if(cfg){
    try{health=await server("/health")}catch(e){health=null}
  }
  panel();
  const host=qs("#gptPresale");
  if(host)new MutationObserver(()=>{if(!qs("#gptPresalePush",host))panel()}).observe(host,{childList:true});
  const p=new URLSearchParams(location.search);
  if(p.get("gpt")==="presale"){
    try{if(typeof window.reTab==="function")window.reTab("gpt")}catch(e){}
    const b=document.querySelector('#gptReNav button[data-v="presale"]');
    if(b)b.click();
  }
}
const css=document.createElement("style");
css.textContent='.ps-push{border-color:rgba(54,211,153,.32)!important}.ps-push-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.ps-push-head h4{margin:0 0 4px!important}.ps-push-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.ps-push-actions button{border:1px solid var(--border);background:#353765;color:#fff;border-radius:8px;padding:7px 10px;font-size:10px;font-weight:900}.ps-push-actions button:disabled{opacity:.45}.ps-push-help{font-size:10px;color:var(--dim);line-height:1.55;margin-top:8px;padding-top:7px;border-top:1px solid var(--border)}@media(max-width:760px){.ps-push-actions button{flex:1 1 auto;min-height:38px}.ps-push-head{align-items:center}}';
(document.head||document.documentElement).appendChild(css);

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();