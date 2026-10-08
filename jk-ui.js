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

/* 넓은 표 — 휴대폰에서도 표는 표 그대로 (2026-10-07 사용자 요청 '모든 페이지를 기본적으로 모바일에 맞춰'.
   사용자: '비교는 표가 편함' — 단타(클로드) #437 에서 받아들인 방식을 모든 페이지 공용으로 쓴다).
   - 폭 760px 이하에서 표가 자기 상자보다 넓으면 그 표만 글자·간격을 줄이고 머리글을 접는다(jk-fit).
   - 그래도 넓으면 첫 칸(날짜·이름)을 고정하고 표 상자 안에서만 옆으로 민다 — 페이지는 옆으로 안 밀린다.
   - 표를 새로 그리거나, 눌러서(탭) 숨어 있던 표가 보이거나, 화면 폭이 바뀌면 다시 잰다.
   - 단타(클로드)는 자기 fit 이 있어 건너뛴다(두 번 줄이지 않게). */
(function(){
  'use strict';
  if (window.JKFit) return;
  var AT = 760, SKIP = /^\/claude(?:\.html)?\/?$/, timer = 0, lastW = 0;
  function style(){
    if (document.getElementById('jkFitStyle')) return;
    var s = document.createElement('style'); s.id = 'jkFitStyle';
    s.textContent = '@media (max-width:' + AT + 'px){' +
      'table.jk-fit th,table.jk-fit td{font-size:11px!important;padding:5px 3px!important;word-break:keep-all;overflow-wrap:normal}' +
      'table.jk-fit th{white-space:normal!important;line-height:1.25;vertical-align:bottom}' +
      'table.jk-fit tr>:first-child{position:sticky;left:0;z-index:1;box-shadow:inset 0 0 0 100vmax var(--jk-fit-bg,#171c2e)}' +
      '}';
    (document.head || document.documentElement).appendChild(s);
  }
  function box(t){                                   // 옆으로 미는 가장 가까운 상자 — 없으면 부모
    for (var p = t.parentElement; p && p !== document.body; p = p.parentElement){
      var ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return p;
    }
    return t.parentElement;
  }
  /* 고정한 첫 칸 바탕 — 옆 칸 글자가 비치지 않게, 칸 → 줄 → 머리/몸통 → 표 → 카드로 올라가며 실제 칠해진 색을
     불투명한 색이 나올 때까지 모아 한 가지 불투명 색으로 합성한다(머리글 줄 색 · 반투명 줄 강조가 그대로 보이게).
     칠하기는 background 가 아니라 안쪽 그림자 — 그래야 줄인 채로도 칸의 원래 바탕색을 그대로 읽는다(반을 벗겼다 씌우면
     큰 표는 스타일 재계산·배치가 한 번에 0.2~0.5초 · 운영 무매 거래 이력 286줄 · 폰 속도). */
  function painted(c){ return !!c && c !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(c); }
  function rgbaOf(c){ var m = /^rgba?\(([^)]+)\)$/.exec(c || ''); if (!m) return null; var p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  function solid(c){ var x = rgbaOf(c); return !x || x[3] >= 1; }
  function stack(from, stop){
    var out = [];
    for (var p = from; p && p.nodeType === 1 && p !== stop; p = p.parentElement){
      var c = getComputedStyle(p).backgroundColor;
      if (painted(c)){ out.push(c); if (solid(c)) return {list:out, done:true}; }
    }
    return {list:out, done:false};
  }
  function layers(list, done){                           // 위 → 아래로 겹친 색 → 불투명 한 색
    var all = done ? list : list.concat(['rgb(23, 28, 46)']), o = rgbaOf(all[all.length - 1]) || [23, 28, 46, 1];
    for (var i = all.length - 2; i >= 0; i--){ var c = rgbaOf(all[i]); if (!c) continue; var a = c[3]; o = [c[0]*a + o[0]*(1-a), c[1]*a + o[1]*(1-a), c[2]*a + o[2]*(1-a), 1]; }
    return 'rgb(' + Math.round(o[0]) + ', ' + Math.round(o[1]) + ', ' + Math.round(o[2]) + ')';
  }
  /* 읽기를 먼저 다 하고 쓰기는 나중에 한꺼번에 — 줄마다 읽고 쓰기를 번갈아 하면 줄 수만큼 스타일을 다시 계산한다.
     보통 줄은 표에 단 색을 물려받고, 색이 다른 칸(머리글·강조 줄)만 따로 단다. 색이 그대로면 안 쓴다. */
  function paint(t){
    var base = stack(t, null), baseV = layers(base.list, base.done), rows = t.rows || [], todo = [], i, c, own;
    for (i = 0; i < rows.length; i++){
      c = rows[i].cells && rows[i].cells[0]; if (!c) continue;
      own = stack(c, t);
      todo.push([c, own.list.length ? (own.done ? layers(own.list, true) : layers(own.list.concat(base.list), base.done)) : '']);
    }
    if (t.style.getPropertyValue('--jk-fit-bg') !== baseV) t.style.setProperty('--jk-fit-bg', baseV);
    for (i = 0; i < todo.length; i++){
      c = todo[i][0];
      if (todo[i][1]){ if (c.style.getPropertyValue('--jk-fit-bg') !== todo[i][1]) c.style.setProperty('--jk-fit-bg', todo[i][1]); }
      else if (c.style.getPropertyValue('--jk-fit-bg')) c.style.removeProperty('--jk-fit-bg');
    }
  }
  function wide(t, cw){ return Math.max(t.scrollWidth, t.offsetWidth) > cw; }
  function fit(t){
    if (window.innerWidth > AT){ if (t.classList.contains('jk-fit')) t.classList.remove('jk-fit'); return false; }
    var b = box(t); if (!b) return false;
    var cw = b.clientWidth + 2;
    if (t.classList.contains('jk-fit')){
      if (wide(t, cw)){ paint(t); return true; }                 // 줄여도 넘친다 → 그대로(벗겨서 다시 잴 필요 없음)
      t.classList.remove('jk-fit');                               // 줄인 채 들어맞는다 → 원래 표로도 들어맞는지 본다(자료가 줄었을 때)
    }
    if (!wide(t, cw)) return false;
    paint(t); t.classList.add('jk-fit');
    return true;
  }
  /* 같은 폭에서 이미 잰 표는 다시 안 잰다 — 표 안이 바뀌면(관찰자가 표시) · 폭이 바뀌면 · 숨어 있다 처음 보이면만 잰다 */
  function scan(){
    timer = 0;
    if (SKIP.test(location.pathname) || !document.querySelectorAll) return 0;
    var W = window.innerWidth, n = 0;
    Array.prototype.forEach.call(document.querySelectorAll('table'), function(t){
      if (t.__jkFitW === W && !t.__jkFitDirty){ if (t.classList.contains('jk-fit')) n++; return; }
      if (W <= AT && !t.getClientRects().length) return;          // 숨은 표는 보일 때 잰다
      if (fit(t)) n++;
      t.__jkFitW = W; t.__jkFitDirty = false;
    });
    return n;
  }
  function later(ms){ if (timer) clearTimeout(timer); timer = setTimeout(scan, ms == null ? 150 : ms); }
  function hasTable(nodes){
    for (var i = 0; i < nodes.length; i++){ var n = nodes[i]; if (n.nodeType === 1 && (n.tagName === 'TABLE' || (n.querySelector && n.querySelector('table')))) return true; }
    return false;
  }
  // 표 안을 다시 그렸거나 표가 새로 들어온 변화만 본다 — 시계·시세 글자 바뀜엔 안 잰다. 반 바꾸기(속성)는 안 봐서 스스로 다시 부르지 않는다
  var obs = (typeof MutationObserver === 'function') ? new MutationObserver(function(list){
    var hit = false;
    for (var i = 0; i < list.length; i++){
      var m = list[i], t = m.target;
      var tb = t && t.closest && t.closest('table');
      if (tb){ tb.__jkFitDirty = true; hit = true; }
      else if (hasTable(m.addedNodes || [])) hit = true;            // 새로 들어온 표는 잰 적이 없어 저절로 잰다
    }
    if (hit) later();
  }) : null;
  function start(){
    style(); lastW = window.innerWidth; scan();
    if (obs && document.body) obs.observe(document.body, {childList:true, subtree:true});
  }
  document.addEventListener('click', function(){ if (window.innerWidth <= AT) later(120); }, true);   // 탭을 눌러 숨은 표가 보일 때
  window.addEventListener('resize', function(){ var w = window.innerWidth; if (w !== lastW){ lastW = w; later(200); } }, {passive:true});
  function invalidate(){ if (document.querySelectorAll) Array.prototype.forEach.call(document.querySelectorAll('table'), function(t){ t.__jkFitDirty = true; }); later(0); }
  window.addEventListener('load', invalidate);                                                        // 그림·글꼴이 늦게 들어와 폭이 바뀌었을 수 있다
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) document.fonts.ready.then(invalidate);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  window.JKFit = { scan: scan, fit: fit, invalidate: invalidate, AT: AT };
})();


/* 상단 메뉴·탭 고정 — 메뉴가 들어 있는 header 또는 .top을 찾고 탭은 바로 그 아래에 붙인다.
   높이를 숫자로 고정하지 않는다: 휴대폰 줄바꿈, 로그인 배지, 탭/세션 변경을 ResizeObserver로 잰다.
   운영의 세션·상태·서브탭은 기존 --h1/2/3에 헤더 높이를 더해 겹치지 않게 한다. */
(function(){
  'use strict';
  if(window.JKSticky)return;
  var header=null,tabs=null,observer=null,raf=0;
  function height(el){return el?Math.ceil(el.getBoundingClientRect().height):0;}
  function update(){
    if(!header)return;
    var st=document.documentElement.style;
    st.setProperty('--jk-header-height',height(header)+'px');
    if(document.getElementById('sessbar')){
      var h1=height(tabs),h2=h1+height(document.getElementById('sessbar'));
      st.setProperty('--h1',h1+'px');
      st.setProperty('--h2',h2+'px');
      st.setProperty('--h3',(h2+height(document.getElementById('statusline')))+'px');
    }
    raf=0;
  }
  function schedule(){if(!raf)raf=window.requestAnimationFrame(update);}
  function mount(){
    if(header||!document.querySelector)return;
    var menu=document.querySelector('.jkmenu');
    if(!menu)return;
    header=menu.closest('header')||menu.closest('.top');
    if(!header)return;
    header.classList.add('jk-sticky-header');
    tabs=document.querySelector('.stabs-sticky,.strategy-tabs,.plan-tabs,.tabs,#ipoWrap>.subnav,#nav');
    if(tabs&&!header.contains(tabs))tabs.classList.add(tabs.id==='nav'?'jk-sticky-side':'jk-sticky-tabs');
    if(document.getElementById('sessbar'))document.body.classList.add('jk-sticky-stack');
    update();
    if(window.ResizeObserver){
      observer=new window.ResizeObserver(schedule);
      [header,tabs,document.getElementById('sessbar'),document.getElementById('statusline')].forEach(function(el){if(el)observer.observe(el);});
    }
    window.addEventListener('resize',schedule,{passive:true});
    window.addEventListener('load',schedule);
    if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  window.JKSticky={mount:mount,update:update};
})();

/* JK 투자 공용 로그인·전체메뉴 UI — 9개 페이지가 같은 모양과 동작을 쓴다.
   페이지별 기존 메뉴 링크/권한 로직은 유지하고, 공용 파일이 시각·열고닫기만 통일한다. */
(function(){
  'use strict';
  if(window.JKUnifiedUI)return;
  var GOOGLE='<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19C10.05 26.22 9.77 24.65 9.77 24s.28-2.22.76-3.59z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function style(){
    if(window.__JKUnifiedUiStyleMounted)return;window.__JKUnifiedUiStyleMounted=true;
    var s=document.createElement('style');s.id='jkUnifiedUiStyle';
    s.textContent=
      '.jkmenu{position:relative!important;flex-shrink:0!important}'+
      '.jkmenu-btn{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:44px!important;height:40px!important;padding:0!important;margin:0!important;border:1px solid #34406a!important;border-radius:11px!important;background:#1e2540!important;color:#e8ecf7!important;font:800 20px/1 system-ui,-apple-system,sans-serif!important;cursor:pointer!important;letter-spacing:0!important;-webkit-tap-highlight-color:transparent}'+
      '.jkmenu-btn:hover,.jkmenu-btn:focus-visible{border-color:#8b8cf0!important;color:#f5c451!important;outline:none!important}'+
      '.jkmenu-pop{position:absolute!important;right:0!important;top:48px!important;z-index:1000!important;width:230px!important;min-width:230px!important;max-width:calc(100vw - 24px)!important;max-height:calc(100dvh - 84px)!important;overflow:auto!important;padding:8px!important;border:1px solid #34406a!important;border-radius:14px!important;background:#171c2e!important;box-shadow:0 16px 40px rgba(0,0,0,.48)!important;display:flex!important;flex-direction:column!important;gap:3px!important}'+
      '.jkmenu-pop[hidden]{display:none!important}'+
      '.jkmenu-title{display:flex;align-items:center;justify-content:space-between;padding:7px 9px 9px;margin-bottom:2px;border-bottom:1px solid #2a3354;color:#e8ecf7;font-size:12px;font-weight:800}'+
      '.jkmenu-title b{color:#f5c451}.jkmenu-title span{color:#6f7ba0;font-size:10px;font-weight:700}'+
      '.jkmenu-pop a{display:flex!important;align-items:center!important;gap:10px!important;min-height:40px!important;padding:9px 10px!important;border-radius:9px!important;color:#9aa6c9!important;text-decoration:none!important;font-size:13px!important;font-weight:750!important;white-space:nowrap!important}'+
      '.jkmenu-pop a:hover{background:#1e2540!important;color:#e8ecf7!important}'+
      '.jkmenu-pop a.cur{background:#242b49!important;color:#f5c451!important}'+
      '.jkmenu-pop a .mi{display:inline-flex!important;width:20px!important;justify-content:center!important;text-align:center!important}'+
      '#authgate .gbox,#gate .gbox,#jkgate .jb{box-sizing:border-box!important;width:calc(100% - 32px)!important;max-width:360px!important;padding:26px 20px!important;border:1px solid #2a3354!important;border-radius:18px!important;background:#171c2e!important;box-shadow:0 18px 50px rgba(0,0,0,.42)!important;text-align:center!important}'+
      '#authgate .glogo,#gate .glogo,#jkgate .jl{margin:0 0 8px!important;color:#e8ecf7!important;font-size:28px!important;font-weight:850!important;letter-spacing:-.03em!important}'+
      '#authgate .glogo .v,#gate .glogo .v,#jkgate .jl b{color:#f5c451!important}'+
      '#authgate .gsub,#gate .gsub,#jkgate .js{margin-bottom:20px!important;color:#9aa6c9!important;font-size:13px!important;line-height:1.7!important}'+
      '#authgate #gbtn,#gate #gbtn,#jkgate .jbtn.jg{box-sizing:border-box!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:10px!important;width:100%!important;min-height:48px!important;padding:12px 16px!important;border:0!important;border-radius:12px!important;background:#fff!important;color:#1f1f1f!important;font-size:15px!important;font-weight:800!important;cursor:pointer!important}'+
      '#authgate #gbtn svg,#gate #gbtn svg,#jkgate .jbtn.jg svg{width:20px!important;height:20px!important;flex:none!important}'+
      '#authgate .gnote,#gate .gnote{margin-top:16px!important;color:#6f7ba0!important;font-size:11px!important;line-height:1.6!important}'+
      '@media(max-width:600px){.jkmenu-pop{position:fixed!important;right:12px!important;top:68px!important;width:min(260px,calc(100vw - 24px))!important;max-height:calc(100dvh - 84px)!important}.jkmenu-pop a{min-height:42px!important;font-size:14px!important}#authgate .gbox,#gate .gbox,#jkgate .jb{width:calc(100% - 28px)!important;padding:24px 18px!important}}';
    (document.head||document.documentElement).appendChild(s);
  }
  /* 다음 HTML을 메뉴를 펼친 동안만 미리 요청한다. 거래 원장·인증 정보는 캐시하지 않는다.
     느린 통신/데이터 절약 모드에서는 선행 요청을 하지 않는다. */
  var warmPages=Object.create(null),warmCount=0;
  function warmPage(href){
    try{
      var conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
      if(conn&&(conn.saveData||/^(?:slow-2g|2g)$/.test(conn.effectiveType||'')))return;
      if(warmCount>=2)return;
      var u=new URL(href,location.href);
      if(u.origin!==location.origin||u.pathname===location.pathname||warmPages[u.pathname])return;
      if(!/^\/(?:plan|paper|backtest|settings|job|realestate|ipo|scalping|claude|admin)?(?:\.html)?$/.test(u.pathname))return;
      warmPages[u.pathname]=true;warmCount++;
      var link=document.createElement('link');
      link.rel='prefetch';link.as='document';link.href=u.pathname;
      (document.head||document.documentElement).appendChild(link);
    }catch(e){}
  }
  function menuWarm(pop){
    var current=(location.pathname||'/').replace(/\.html$/,'');
    var target=current==='/plan'?'/':current==='/'?'/plan':'/';
    if(pop.querySelector('a[href="'+target+'"]'))warmPage(target);
  }
  function mountMenus(){
    if(!document.querySelectorAll)return;
    document.querySelectorAll('.jkmenu').forEach(function(wrap){
      var btn=wrap.querySelector('.jkmenu-btn'),pop=wrap.querySelector('.jkmenu-pop');
      if(!btn||!pop)return;
      if(!pop.querySelector('.jkmenu-title')){
        var t=document.createElement('div');t.className='jkmenu-title';t.innerHTML='<b>JK 투자</b><span>전체메뉴</span>';pop.insertBefore(t,pop.firstChild);
      }
      if(!pop.querySelector('a[href="/settings"],a[href="/settings.html"]')){
        var settings=document.createElement('a');
        settings.href='/settings';
        settings.innerHTML='<span class="mi">⚙️</span>설정';
        var admin=pop.querySelector('a[href="/admin"],a[href="/admin.html"]');
        if(admin)pop.insertBefore(settings,admin); else pop.appendChild(settings);
      }
      var path=(location.pathname||'').replace(/\.html$/,'').replace(/\/$/,'')||'/';
      pop.querySelectorAll('a').forEach(function(a){
        var ap=(a.getAttribute('href')||'').replace(/\.html$/,'').replace(/\/$/,'')||'/';
        if(ap==='/settings')a.classList.toggle('cur',path==='/settings');
      });
      btn.textContent='☰';btn.setAttribute('aria-label','전체메뉴');btn.setAttribute('title','전체메뉴');btn.removeAttribute('onclick');
      if(btn.dataset.jkUnified)return;btn.dataset.jkUnified='1';
      btn.addEventListener('click',function(e){
        e.stopPropagation();pop.hidden=!pop.hidden;
        if(!pop.hidden)menuWarm(pop);
      });
      pop.addEventListener('pointerover',function(e){
        var a=e.target&&e.target.closest&&e.target.closest('a[href]');
        if(a)warmPage(a.getAttribute('href'));
      },{passive:true});
      pop.addEventListener('focusin',function(e){
        var a=e.target&&e.target.closest&&e.target.closest('a[href]');
        if(a)warmPage(a.getAttribute('href'));
      });
      pop.addEventListener('click',function(e){if(e.target&&e.target.closest&&e.target.closest('a'))pop.hidden=true;});
    });
  }
  function normalizeLogin(){
    if(!document.querySelectorAll)return;
    document.querySelectorAll('#authgate .glogo,#gate .glogo').forEach(function(x){x.innerHTML='JK <span class="v">투자</span>';});
    document.querySelectorAll('#authgate #gbtn,#gate #gbtn').forEach(function(b){
      if(!b.querySelector('svg'))b.insertAdjacentHTML('afterbegin',GOOGLE);
      var nodes=Array.prototype.slice.call(b.childNodes);nodes.forEach(function(n){if(n.nodeType===3)n.remove();});
      b.appendChild(document.createTextNode('Google로 로그인'));
    });
  }
  function mount(){style();mountMenus();normalizeLogin();}
  document.addEventListener('click',function(e){
    if(!document.querySelectorAll)return;
    document.querySelectorAll('.jkmenu-pop').forEach(function(p){var w=p.closest('.jkmenu');if(w&&!w.contains(e.target))p.hidden=true;});
  });
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
  window.JKUnifiedUI={mount:mount,mountMenus:mountMenus,normalizeLogin:normalizeLogin};
})();

