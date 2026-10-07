// 설정 → 알림: 단타(클로드) 매수·매도 알림 항목(소유자만 켤 수 있음). 켜기/끄기는 claude-push-client.js 하나로 한다.
(function(){
"use strict";
var host=document.getElementById("claudePushSettings");
if(!host||!window.ClaudePush)return;
var P=window.ClaudePush,st="off",busy=false;
function token(){var a=window.jkAuth,u=a&&a.currentUser;return u?u.getIdToken():Promise.resolve("")}
function render(){
  var on=st==="on",dis=busy||st==="unsupported";
  var desc=st==="unsupported"?"이 브라우저는 웹 알림을 지원하지 않습니다.":P.iosNeedsHome()?"iPhone은 Safari에서 JK투자를 홈 화면에 추가한 뒤 홈화면 아이콘으로 실행해야 켤 수 있습니다.":
    "① 시초가 · ② 데이트레이딩 · ③ 비트코인 · ④ SOXL 의 모의 매수·매도가 생기면 5분 안에 알려줍니다(같은 알림은 한 번). 소유자 계정만 켤 수 있습니다.";
  host.innerHTML='<div class="alert-list"><div class="alert-item"><div class="alert-top"><div><div class="alert-name">⚡ 단타(클로드) 매수·매도</div><div class="alert-desc">'+desc+'</div></div>'+
    '<span class="badge '+(on?'on':'')+'">'+(on?'ON':'OFF')+'</span></div><div class="actions">'+
    (on?'<button data-a="test" '+(busy?'disabled':'')+'>테스트 알림</button><button class="secondary" data-a="off" '+(busy?'disabled':'')+'>알림 끄기</button>'
       :'<button data-a="on" '+(dis?'disabled':'')+'>알림 켜기</button>')+
    '</div><div class="server">알림을 누르면 단타(클로드) 화면으로 이동합니다.</div></div></div>';
  host.querySelectorAll("button[data-a]").forEach(function(b){b.addEventListener("click",function(){act(b.getAttribute("data-a"))})});
}
async function act(a){
  if(busy)return;busy=true;render();
  try{
    if(a==="on"){st=await P.enable(token);alert("단타 매수·매도 알림을 켰습니다.");}
    else if(a==="off")st=await P.disable(token);
    else{await P.test(token);alert("테스트 알림을 보냈습니다.");}
  }catch(e){alert("단타 알림 설정 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
P.state().then(function(s){st=s;render()});
render();
})();
