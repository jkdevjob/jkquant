(function(){
"use strict";
const CONFIG="/data/realestate/gpt/push-config.json";
const host=document.getElementById("notificationSettings");
if(!host)return;

let cfg=null,reg=null,sub=null,health=null,busy=false;
let topics=new Set();
let approvalLinked=false;
let topicSchemaVersion=1;
const GPT_TOPICS=["opening","daytrading","crypto","soxl","tenbagger_gpt"];

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
  reg=await navigator.serviceWorker.register("/jk-sw.js?v=2.2.0",{scope:"/"});
  await navigator.serviceWorker.ready;
  sub=await reg.pushManager.getSubscription();
  return sub;
}
async function loadTopics(required=false){
  if(!sub||!cfg)return;
  try{
    const j=await server("/subscription?endpoint="+encodeURIComponent(sub.endpoint));
    topics=new Set(j.topics||[]);
    approvalLinked=!!j.approvalLinked;
    topicSchemaVersion=Number(j.topicSchemaVersion||1);
    if(topicSchemaVersion<2&&topics.has("research"))topics.add("tenbagger_gpt");
  }catch(e){if(required)throw e}
}
async function syncWorkerTopics(){
  if(!reg&&"serviceWorker" in navigator)reg=await navigator.serviceWorker.ready.catch(()=>null);
  const msg={type:"JK_PUSH_TOPICS",topics:[...topics],topicSchemaVersion};
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
function topicState(topic){
  if(topic!=="gpt")return topics.has(topic)?"on":"off";
  if(topics.has("gpt")||GPT_TOPICS.every(t=>topics.has(t)))return "on";
  return GPT_TOPICS.some(t=>topics.has(t))?"partial":"off";
}
function item(topic,icon,name,desc){
  const state=topicState(topic),on=state!=="off",partial=state==="partial";
  const iosNeed=isIOS()&&!standalone(),blocked=typeof Notification!=="undefined"&&Notification.permission==="denied";
  const common=commonDescription();
  const statusDesc=common||desc;
  return '<div class="alert-item">'+
    '<div class="alert-top"><div><div class="alert-name">'+icon+" "+esc(name)+'</div><div class="alert-desc">'+esc(statusDesc)+'</div></div>'+
    '<span class="badge '+(on?'on':'')+'">'+(partial?'일부 ON':on?'ON':'OFF')+'</span></div>'+
    '<div class="actions">'+
      (!on||partial?'<button data-action="on" data-topic="'+topic+'" '+((busy||iosNeed||blocked||!supported()||!cfg)?'disabled':'')+'>'+(partial?'전체 탭 알림 켜기':'알림 켜기')+'</button>':'')+
      (on?'<button data-action="test" data-topic="'+topic+'" '+(busy?'disabled':'')+'>테스트 알림</button>'+
           '<button class="secondary" data-action="off" data-topic="'+topic+'" '+(busy?'disabled':'')+'>알림 끄기</button>':'')+
    '</div>'+
    (partial?'<div class="help">기존에 선택한 일부 탭만 켜져 있습니다. 전체 탭 알림 켜기를 누르면 한 번에 통합됩니다.</div>':'')+
    (iosNeed?'<div class="help"><b>iPhone 설정</b><br>Safari에서 JK투자를 연 뒤 공유 → <b>홈 화면에 추가</b> → 홈화면의 JK투자 아이콘으로 실행 → 설정 → 알림에서 다시 켜세요.</div>':'')+
    '<div class="server">'+(health?('등록기기 '+topicCount(topic)+'대 · 최근 확인 '+esc(fmtServerTime(lastCheck(topic)))):(cfg?'푸시 서버 연결 확인 중':'푸시 서버 연결 안 됨'))+'</div>'+
  '</div>';
}
const NOTIFY_DEFS=[
  {topic:"gpt",href:"/scalping",icon:"⚡",name:"연구(지피티) · 전체 탭",
    desc:"시초가 · 데이트레이딩 · 비트코인 · SOXL의 모의 매수·매도와 텐배거 전향 연구 알림을 함께 켜고 끕니다. 알림을 누르면 해당 탭으로 이동합니다."},
  {topic:"ipo",href:"/ipo",icon:"📈",name:"공모주·청약 일정",
   desc:"매일 오전 8:10경 청약 중·7일 내 청약 예정·당일 상장 종목과 공모가/경쟁률 기반 투자 조사 점수를 보내드립니다."},
  {topic:"presale",href:"/realestate",icon:"🏢",name:"대전·세종 신규분양",
   desc:"대전·세종 일반·무순위/잔여·임의공급 신규공고를 30분 간격으로 확인하고 분양가·주변 실거래 기반 점수로 안내합니다."},
  {topic:"research",href:"/scalping",icon:"🔬",name:"연구 결과 · 무매·플랜·클로드 텐배거",
   desc:"무매·5년 플랜 연구 결과와 클로드 텐배거 모의 매수·매도 알림입니다. 지피티 텐배거는 연구(지피티) 전체 탭 설정에서 관리합니다."},
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
  reg=await navigator.serviceWorker.register("/jk-sw.js?v=2.2.0",{scope:"/"});
  await navigator.serviceWorker.ready;
  const v=await server("/vapid");
  sub=await reg.pushManager.getSubscription();
  if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64ToU8(v.publicKey)});
}
async function saveTopics(nextTopics=topics){
  if(!sub)throw new Error("기기의 알림 구독을 확인할 수 없습니다.");
  if(topicSchemaVersion<2)throw new Error("알림 서버 업데이트 중입니다. 잠시 후 다시 시도하세요.");
  await server("/subscribe",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({subscription:sub.toJSON(),userAgent:navigator.userAgent,topics:[...nextTopics],topicSchemaVersion:2})
  });
  topics=new Set(nextTopics);
  await syncWorkerTopics();
}
async function enable(topic){
  if(busy)return;busy=true;render();
  let message;
  try{
    await ensurePushSubscription();
    await loadTopics(true);
    const nextTopics=new Set(topics);
    if(topic==="gpt")GPT_TOPICS.forEach(t=>nextTopics.delete(t));
    nextTopics.add(topic);
    await saveTopics(nextTopics);
    try{health=await server("/health")}catch(e){}
    const def=NOTIFY_DEFS.find(x=>x.topic===topic);
    message=(def?def.name:"선택한 항목")+" 알림을 켰습니다.";
  }catch(e){message="알림 설정 실패: "+String(e&&e.message||e)}
  finally{busy=false;render()}
  // 차단형 팝업을 띄우기 전에 저장 결과와 버튼 상태가 실제 화면에 그려지게 한다.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  alert(message);
}
async function disable(topic){
  if(busy||!sub)return;busy=true;render();
  try{
    await loadTopics(true);
    const nextTopics=new Set(topics);nextTopics.delete(topic);
    if(topic==="gpt")GPT_TOPICS.forEach(t=>nextTopics.delete(t));
    if(nextTopics.size||approvalLinked){
      await saveTopics(nextTopics);
    }else{
      await server("/subscribe",{
        method:"DELETE",headers:{"content-type":"application/json"},
        body:JSON.stringify({endpoint:sub.endpoint})
      });
      topics=nextTopics;
      await syncWorkerTopics();
      await sub.unsubscribe();
      sub=null;
    }
    try{health=await server("/health")}catch(e){}
  }catch(e){alert("알림 해제 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
async function test(topic){
  if(busy||!sub||topicState(topic)==="off")return;busy=true;render();
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
