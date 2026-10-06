/* JK 공용 화면 도구 — 모든 페이지가 이 파일 하나를 읽는다(페이지마다 따로 만들면 갈라진다).
   맨 위로 버튼 (2026-10-07 사용자 요청: 오른쪽 가운데쯤 · 모든 페이지)
   - 오른쪽 가장자리 · 화면 세로 가운데. 300px 넘게 내려가야 보인다(맨 위에선 숨는다).
   - 누르면 지금 내려가 있는 화면을 맨 위로 — 창 스크롤이 기본이고, 안쪽 스크롤 칸(시트·긴 목록)을
     내리고 있었으면 그 칸도 같이 올린다.
   - 운영 화면의 '보던 자리 지키기'(cancelHold)가 걸려 있으면 먼저 푼다 — 안 그러면 올렸다가 다시 끌려 내려간다.
   - 표 위를 가리지 않게 작고 반투명하게 둔다. 모달(z-index 100)보다는 아래다. */
(function(){
  'use strict';
  if (window.JKToTop) return;                      // 두 번 읽혀도 버튼은 하나
  var SHOW_AT = 300;
  var btn = null, inner = null, raf = 0;

  function winTop(){ return window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || (document.body && document.body.scrollTop) || 0; }
  function visible(el){ try{ return !!(el && el.isConnected && el.getClientRects().length); }catch(e){ return false; } }
  function innerTop(){ return (inner && visible(inner)) ? (inner.scrollTop || 0) : 0; }
  function current(){ return Math.max(winTop(), innerTop()); }

  function update(){
    raf = 0;
    if (!btn) return;
    var on = current() > SHOW_AT;
    if (btn.classList.contains('on') !== on) btn.classList.toggle('on', on);
  }
  function schedule(){
    if (raf) return;
    raf = 1;                                          // 표시는 update 가 지운다(콜백이 곧바로 불려도 순서가 맞게)
    (window.requestAnimationFrame || function(f){ return setTimeout(f, 16); })(update);
  }

  function toTop(){
    try{ if (typeof window.cancelHold === 'function') window.cancelHold(); }catch(e){}
    if (inner && visible(inner) && inner.scrollTop > 0){
      try{ inner.scrollTo({top:0, behavior:'smooth'}); }catch(e){ inner.scrollTop = 0; }
    }
    try{ window.scrollTo({top:0, behavior:'smooth'}); }catch(e){ window.scrollTo(0, 0); }
  }

  function mount(){
    if (btn || !document.body) return;
    var st = document.createElement('style');
    st.id = 'jkToTopStyle';
    st.textContent =
      '#jkToTop{position:fixed;right:calc(6px + env(safe-area-inset-right,0px));top:50%;transform:translateY(-50%);z-index:96;' +
      'width:38px;height:38px;border-radius:50%;padding:0;margin:0;border:1px solid rgba(255,255,255,.22);' +
      'background:rgba(22,26,40,.72);color:#eef1f8;font:700 17px/36px system-ui,-apple-system,sans-serif;text-align:center;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer;opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s;' +
      '-webkit-tap-highlight-color:transparent;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
      '#jkToTop.on{opacity:.8;visibility:visible}' +
      '#jkToTop:active{transform:translateY(-50%) scale(.92)}' +
      '@media print{#jkToTop{display:none}}';
    (document.head || document.body).appendChild(st);
    btn = document.createElement('button');
    btn.id = 'jkToTop';
    btn.type = 'button';
    btn.title = '맨 위로';
    btn.setAttribute('aria-label', '맨 위로');
    btn.textContent = '↑';
    btn.addEventListener('click', toTop);
    document.body.appendChild(btn);
    update();
  }

  // 창 스크롤 + 안쪽 스크롤 칸 — 스크롤 이벤트는 거품이 안 올라오므로 붙잡기 단계에서 듣는다
  document.addEventListener('scroll', function(e){
    var t = e.target;
    if (t && t.nodeType === 1 && t !== document.documentElement && t !== document.body &&
        t.scrollHeight > t.clientHeight + 50) inner = t;
    schedule();
  }, {capture:true, passive:true});
  window.addEventListener('resize', schedule, {passive:true});

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  window.JKToTop = { toTop: toTop, update: update, SHOW_AT: SHOW_AT };
})();
