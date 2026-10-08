(function(){
"use strict";
const CONFIG="/data/realestate/gpt/push-config.json";
const host=document.getElementById("notificationSettings");
if(!host)return;

let cfg=null,reg=null,sub=null,health=null,busy=false;
let topics=new Set();

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
  reg=await navigator.serviceWorker.register("/jk-sw.js?v=2.1.0",{scope:"/"});
  await navigator.serviceWorker.ready;
  sub=await reg.pushManager.getSubscription();
  return sub;
}
async function loadTopics(){
  topics=new Set();
  if(!sub||!cfg)return;
  try{
    const j=await server("/subscription?endpoint="+encodeURIComponent(sub.endpoint));
    (j.topics||[]).forEach(x=>topics.add(x));
  }catch(e){}
}
async function syncWorkerTopics(){
  if(!reg&&"serviceWorker" in navigator)reg=await navigator.serviceWorker.ready.catch(()=>null);
  const msg={type:"JK_PUSH_TOPICS",topics:[...topics]};
  try{if(navigator.serviceWorker.controller)navigator.serviceWorker.controller.postMessage(msg)}catch(e){}
  try{if(reg&&reg.active)reg.active.postMessage(msg)}catch(e){}
  try{if(reg&&reg.waiting)reg.waiting.postMessage(msg)}catch(e){}
}
function topicCount(topic){
  return Number(health&&health.topicSubscriptions&&health.topicSubscriptions[topic]||0);
}
function lastCheck(topic){
  return health&&health.lastChecks&&health.lastChecks[topic]||null;
}
function fmtServerTime(v){
  if(!v)return "대기중";
  const d=new Date(v);return isNaN(d)?"대기중":d.toLocaleString("ko-KR");
}
function commonDescription(){
  if(isIOS()&&!standalone())return "iPhone은 Safari에서 JK투자를 홈 화면에 추가한 뒤 홈화면 아이콘으로 실행해야 웹푸시를 켤 수 있습니다.";
  if(!supported())return "이 브라우저는 백그라운드 웹푸시를 지원하지 않습니다.";
  if(Notification.permission==="denied")return "알림 권한이 차단돼 있습니다. 기기 설정에서 JK 투자 알림을 허용해 주세요.";
  return "";
}
function item(topic,icon,name,desc){
  const on=topics.has(topic),iosNeed=isIOS()&&!standalone(),blocked=typeof Notification!=="undefined"&&Notification.permission==="denied";
  const common=commonDescription();
  const statusDesc=common||desc;
  return '<div class="alert-item">'+
    '<div class="alert-top"><div><div class="alert-name">'+icon+" "+esc(name)+'</div><div class="alert-desc">'+esc(statusDesc)+'</div></div>'+
    '<span class="badge '+(on?'on':'')+'">'+(on?'ON':'OFF')+'</span></div>'+
    '<div class="actions">'+
      (!on?'<button data-action="on" data-topic="'+topic+'" '+((busy||iosNeed||blocked||!supported()||!cfg)?'disabled':'')+'>알림 켜기</button>':'')+
      (on?'<button data-action="test" data-topic="'+topic+'" '+(busy?'disabled':'')+'>테스트 알림</button>'+
           '<button class="secondary" data-action="off" data-topic="'+topic+'" '+(busy?'disabled':'')+'>알림 끄기</button>':'')+
    '</div>'+
    (iosNeed?'<div class="help"><b>iPhone 설정</b><br>Safari에서 JK투자를 연 뒤 공유 → <b>홈 화면에 추가</b> → 홈화면의 JK투자 아이콘으로 실행 → 설정 → 알림에서 다시 켜세요.</div>':'')+
    '<div class="server">'+(health?('등록기기 '+topicCount(topic)+'대 · 최근 확인 '+esc(fmtServerTime(lastCheck(topic)))):(cfg?'푸시 서버 연결 확인 중':'푸시 서버 연결 안 됨'))+'</div>'+
  '</div>';
}
const NOTIFY_DEFS=[
  {topic:"opening",href:"/scalping",icon:"⚡",name:"단타(지피티) · 시초가 매수·매도",
    desc:"기준전략의 시초가 모의매수·매도 신호를 알립니다. 알림을 누르면 해당 전략 화면으로 이동합니다."},
  {topic:"daytrading",href:"/scalping",icon:"📈",name:"단타(지피티) · 데이트레이딩 매수·매도",
    desc:"기준전략의 모의매수·매도 전환 시 알려줍니다."},
  {topic:"crypto",href:"/scalping",icon:"₿",name:"단타(지피티) · 비트코인 매수·매도",
    desc:"KRW-BTC 기준전략 모의매수·매도 신호 알림입니다."},
  {topic:"soxl",href:"/scalping",icon:"⚡",name:"단타(지피티) · SOXL 매수·매도",
    desc:"미국장 SOXL 기준전략의 모의매수·매도 신호를 알립니다."},
  {topic:"ipo",href:"/ipo",icon:"📈",name:"공모주·청약 일정",
   desc:"매일 오전 8:10경 청약 중·7일 내 청약 예정·당일 상장 종목과 공모가/경쟁률 기반 투자 조사 점수를 보내드립니다."},
  {topic:"presale",href:"/realestate",icon:"🏢",name:"대전·세종 신규분양",
   desc:"대전·세종 일반·무순위/잔여·임의공급 신규공고를 30분 간격으로 확인하고 분양가·주변 실거래 기반 점수로 안내합니다."},
  {topic:"job",href:"/job",icon:"💼",name:"대전·세종 JOB 신규공고",
   desc:"30분마다 채용공고를 확인하고 새 공고가 있을 때만 알려줍니다."}
];
function notificationMenuOrder(){
  const menu=[...document.querySelectorAll(".jkmenu-pop a[href]")].map(a=>(a.getAttribute("href")||"").replace(/\.html$/,""));
  const idx=href=>{const i=menu.indexOf(href);return i<0?999:i};
  return NOTIFY_DEFS.slice().sort((a,b)=>idx(a.href)-idx(b.href));
}
function render(){
  host.innerHTML='<div class="alert-list">'+notificationMenuOrder()
    .map(x=>item(x.topic,x.icon,x.name,x.desc)).join("")+'</div>';
  host.querySelectorAll("button[data-action]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const a=btn.dataset.action,t=btn.dataset.topic;
      if(a==="on")enable(t);else if(a==="off")disable(t);else if(a==="test")test(t);
    });
  });
}
async function ensurePushSubscription(){
  if(isIOS()&&!standalone())throw new Error("iPhone에서는 먼저 Safari 공유 → 홈 화면에 추가 후 홈화면 앱으로 실행하세요.");
  if(!supported())throw new Error("이 브라우저는 웹푸시를 지원하지 않습니다.");
  const perm=Notification.permission==="granted"?"granted":await Notification.requestPermission();
  if(perm!=="granted")throw new Error("알림 권한이 허용되지 않았습니다.");
  cfg=cfg||await getConfig();
  reg=await navigator.serviceWorker.register("/jk-sw.js?v=2.1.0",{scope:"/"});
  await navigator.serviceWorker.ready;
  const v=await server("/vapid");
  sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(v.publicKey)});
}
async function saveTopics(){
  if(!sub)return;
  await server("/subscribe",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({subscription:sub.toJSON(),userAgent:navigator.userAgent,topics:[...topics]})
  });
  await syncWorkerTopics();
}
async function enable(topic){
  if(busy)return;busy=true;render();
  try{
    await ensurePushSubscription();
    await loadTopics();
    topics.add(topic);
    await saveTopics();
    try{health=await server("/health")}catch(e){}
    alert(({ipo:"공모주·청약 매일",job:"JOB 신규공고",presale:"신규분양",opening:"시초가 매수·매도",daytrading:"데이트레이딩 매수·매도",crypto:"비트코인 매수·매도",soxl:"SOXL 매수·매도"})[topic]+" 알림을 켰습니다.");
  }catch(e){alert("알림 설정 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function disable(topic){
  if(busy||!sub)return;busy=true;render();
  try{
    topics.delete(topic);
    if(topics.size){
      await saveTopics();
    }else{
      await server("/subscribe",{
        method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({endpoint:sub.endpoint})
      }).catch(()=>{});
      await sub.unsubscribe();
      sub=null;
      await syncWorkerTopics();
    }
    try{health=await server("/health")}catch(e){}
  }catch(e){alert("알림 해제 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function test(topic){
  if(busy||!sub||!topics.has(topic))return;busy=true;render();
  try{
    const j=await server("/test",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({endpoint:sub.endpoint,topic})
    });
    if(j.ok)alert("테스트 알림을 보냈습니다.");
  }catch(e){alert("테스트 알림 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function init(){
  try{cfg=await getConfig()}catch(e){cfg=null}
  if(supported()){try{await currentSub()}catch(e){sub=null}}
  if(sub&&cfg)await loadTopics();
  await syncWorkerTopics();
  if(cfg){try{health=await server("/health")}catch(e){health=null}}
  render();
}
init();
})();