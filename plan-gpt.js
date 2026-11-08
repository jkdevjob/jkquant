/* ⚡ 지피티 탭 전용 — 자산플랜(plan.html #pane-gpt · 2026-11-08 탭 신설)
 * 클로드 탭(🤖 듀얼 가드 · plan.html #pane-claude · plan-session-engine.js)의 화면·장부·엔진과 섞지 않는다.
 * 지피티가 이 파일(과 자기 자료)만 고친다. 지금은 빈 칸 안내만 그린다 — 클로드는 이 탭의 전략을 만들지 않는다.
 */
(function(){
  'use strict';
  var VERSION='1.0.0';
  function render(){
    var root=document.getElementById('planGptRoot');if(!root)return;
    root.innerHTML='<section class="card gpt-empty"><h2>⚡ 지피티 자산플랜</h2>'
      +'<div class="sub">지피티가 맡는 탭입니다. 아직 올라온 전략이 없습니다.<br>'
      +'클로드 탭(🤖 듀얼 가드)과 화면·장부·엔진을 따로 둡니다 — 이 탭의 전략과 결과는 클로드 탭 숫자와 섞이지 않습니다.</div>'
      +'<div class="btnrow"><a class="btn" href="/scalping" style="text-decoration:none">⚡ 연구(지피티) 보기</a></div>'
      +'<div class="sub" style="margin-top:8px">plan-gpt.js v'+VERSION+'</div></section>';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
