// 설정 → 알림: 단타(지피티) 매수·매도 타이밍 웹 알림.
(function(){
"use strict";
var host=document.getElementById("scalpingPushSettings");if(!host||!window.ScalpingPush)return;
var P=window.ScalpingPush,st="off",busy=false;
function token(){var a=window.jkAuth,u=a&&a.currentUser;return u?u.getIdToken():Promise.resolve("")}
function render(){
  var on=st==="on",dis=busy||st==="unsupported";
  var desc=st==="unsupported"?"이 브라우저는 웹 알림을 지원하지 않습니다.":P.iosNeedsHome()?"iPhone은 Safari에서 JK투자를 홈 화면에 추가한 뒤 홈화면 아이콘으로 실행해야 켤 수 있습니다.":
    "단타(지피티) 시초가 · 데이트레이딩 · 비트코인 · SOXL 서버 모의장부에 실제 진입·청산 시점이 기록되면 약 1분 단위로 알려줍니다. 전략 계산이나 주문은 알림 때문에 바뀌지 않습니다.";
  host.innerHTML='<div class="alert-list"><div class="alert-item"><div class="alert-top"><div><div class="alert-name">⚡ 단타(지피티) 매수·매도 타이밍</div><div class="alert-desc">'+desc+'</div></div>'+
    '<span class="badge '+(on?'on':'')+'">'+(on?'ON':'OFF')+'</span></div><div class="actions">'+
    (on?'<button data-a="test" '+(busy?'disabled':'')+'>테스트 알림</button><button class="secondary" data-a="off" '+(busy?'disabled':'')+'>알림 끄기</button>'
       :'<button data-a="on" '+(dis?'disabled':'')+'>알림 켜기</button>')+
    '</div><div class="server">알림을 누르면 단타(지피티) 화면으로 이동합니다.</div></div></div>';
  host.querySelectorAll("button[data-a]").forEach(function(b){b.addEventListener("click",function(){act(b.getAttribute("data-a"))})});
}
async function act(a){
  if(busy)return;busy=true;render();
  try{
    if(a==="on"){st=await P.enable(token);alert("단타(지피티) 매수·매도 타이밍 알림을 켰습니다.");}
    else if(a==="off")st=await P.disable(token);
    else{await P.test(token);alert("테스트 알림을 보냈습니다.");}
  }catch(e){alert("단타(지피티) 알림 설정 실패: "+String(e&&e.message||e))}
  finally{busy=false;render()}
}
P.state().then(function(s){st=s;render()});render();
})();
