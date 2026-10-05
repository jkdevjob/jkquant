/* JK 퀀트 — 이용 승인 (모든 페이지 공용 · 판정은 이 파일 한 곳에서만 한다)
   로그인 → 이용 신청(로그인하면 자동 접수) → 관리자 승인 → 사용.
   - 관리자(소유자)는 언제나 통과한다.
   - profiles/{uid}.approved === true 이고 차단(blocked)이 아니면 통과한다.
   - 그 밖은 '승인 대기'(신청 접수) 또는 '사용 불가'(거절·차단)다.
   진짜로 막는 건 Firestore 규칙이다(firestore.rules — 승인 안 된 계정은 자기 데이터도 못 연다).
   이 파일은 화면을 가리고, 신청 기록을 남기고, 단타·관리자 메뉴를 소유자에게만 보인다.
   단순 페이지(백테·공모주·JOB)는 data-guard="1" 로 불러 guard() 하나로 끝낸다.
   운영·자산플랜은 자기 로그인 막을 쓰고, 승인 판정(check)과 대기 화면(show)만 여기서 가져간다. */
(function(){
  var ADMIN_EMAILS=['jk82investing@gmail.com'];
  var accessCache=null; // 페이지가 열려 있는 동안만 유지. 영구 브라우저 저장 금지.
  /* 공용 메뉴 정책 — 관리자가 Firestore settings/siteMenu 한 곳에서 공개/관리자/숨김과 순서를 정한다.
     hidden은 모든 사람의 메뉴에서 숨기고, 관리자는 주소를 직접 입력했을 때만 접근할 수 있다.
     scalping/claude/admin은 별도 소유자 보안이 있으므로 기본값도 admin이다. */
  var MENU_ITEMS=[
    {path:'/',label:'운영',mode:'public',order:10},
    {path:'/plan',label:'자산플랜',mode:'public',order:20},
    {path:'/backtest',label:'백테',mode:'public',order:30},
    {path:'/scalping',label:'단타(지피티)',mode:'admin',order:40},
    {path:'/claude',label:'단타(클로드)',mode:'admin',order:50},
    {path:'/paper',label:'모의',mode:'public',order:60},
    {path:'/ipo',label:'공모주',mode:'public',order:70},
    {path:'/job',label:'JOB',mode:'public',order:80},
    {path:'/admin',label:'관리자',mode:'admin',order:90}
  ];
  var menuCache=null;
  function menuPath(v){
    var p=String(v||'/').split(/[?#]/)[0]||'/';
    try{ p=new URL(p, location.origin).pathname; }catch(e){}
    p=p.replace(/\/+$/,'')||'/';
    var map={'/index.html':'/','/plan.html':'/plan','/backtest.html':'/backtest','/scalping.html':'/scalping',
             '/claude.html':'/claude','/ipo.html':'/ipo','/job.html':'/job','/admin.html':'/admin'};
    return map[p]||p;
  }
  function menuDefaults(){
    var items={}; MENU_ITEMS.forEach(function(x){items[x.path]={mode:x.mode,order:x.order};});
    return {items:items,updatedAt:0,updatedBy:''};
  }
  function normalizeMenuConfig(data){
    var d=menuDefaults(),src=data&&data.items&&typeof data.items==='object'?data.items:{};
    MENU_ITEMS.forEach(function(x){
      var v=src[x.path]||{},mode=['public','admin','hidden'].indexOf(v.mode)>=0?v.mode:x.mode;
      var order=Number.isFinite(+v.order)?+v.order:x.order;
      d.items[x.path]={mode:mode,order:order};
    });
    d.updatedAt=+(data&&data.updatedAt)||0; d.updatedBy=String(data&&data.updatedBy||'');
    return d;
  }
  async function loadMenuConfig(user,fb,opt){
    opt=opt||{}; if(menuCache&&!opt.force)return menuCache;
    var cfg=menuDefaults();
    if(user&&fb&&fb.db&&fb.doc&&fb.getDoc){
      try{
        var snap=await timeout(fb.getDoc(fb.doc(fb.db,'settings','siteMenu')),opt.timeoutMs||5000);
        if(snap&&snap.exists&&snap.exists())cfg=normalizeMenuConfig(snap.data()||{});
      }catch(e){ console.warn('menu config',e); }
    }
    menuCache=cfg; return cfg;
  }
  function menuMode(cfg,path){
    path=menuPath(path); var d=MENU_ITEMS.find(function(x){return x.path===path;});
    var v=cfg&&cfg.items&&cfg.items[path]; return v&&v.mode||d&&d.mode||'public';
  }
  function applyMenuDom(user,cfg){
    var admin=isAdminEmail(user&&user.email),pops=document.querySelectorAll('.jkmenu-pop');
    Array.prototype.forEach.call(pops,function(pop){
      var links=Array.prototype.slice.call(pop.querySelectorAll('a[href]'));
      links.sort(function(a,b){
        var ap=menuPath(a.getAttribute('href')),bp=menuPath(b.getAttribute('href'));
        var av=cfg&&cfg.items&&cfg.items[ap],bv=cfg&&cfg.items&&cfg.items[bp];
        return +(av&&av.order||9999)-+(bv&&bv.order||9999);
      });
      links.forEach(function(a){
        var p=menuPath(a.getAttribute('href')),mode=menuMode(cfg,p);
        var visible=mode==='public'||(mode==='admin'&&admin);
        if(mode==='hidden')visible=false;
        a.classList.toggle('jk-menu-hidden',!visible);
        if(p==='/admin')a.classList.toggle('admin-on',admin);
        pop.appendChild(a);
      });
    });
  }
  async function applyMenuConfig(user,fb,opt){
    setAdmin(isAdminEmail(user&&user.email));
    var cfg=await loadMenuConfig(user,fb,opt); applyMenuDom(user,cfg); return cfg;
  }
  function menuAccess(user,cfg,path){
    var mode=menuMode(cfg,path),admin=isAdminEmail(user&&user.email);
    return {mode:mode,allowed:admin||mode==='public'};
  }
  var html=document.documentElement;
  function norm(e){ return String(e||'').trim().toLowerCase(); }
  function isAdminEmail(e){ return ADMIN_EMAILS.indexOf(norm(e))>=0; }
  /* 판정 한 곳 — 차단이 승인보다 먼저다(승인돼 있어도 차단이면 못 쓴다) */
  function decide(user, prof){
    if(!user) return 'signedout';
    if(isAdminEmail(user.email)) return 'admin';
    if(prof && prof.blocked) return 'blocked';
    if(prof && prof.approved===true) return 'approved';
    return 'pending';
  }
  function isOk(state){ return state==='admin'||state==='approved'; }
  /* 승인 캐시는 같은 페이지의 메모리에서만 유지한다. 페이지 이동/새로고침마다 Firebase를 다시 확인한다. */
  function cacheGet(){ return accessCache; }
  function cacheSet(user, state){ accessCache=(user&&isOk(state))?{uid:user.uid,state:state,at:Date.now()}:null; }
  function cacheOk(user){ var c=cacheGet(); return !!(user && c && c.uid===user.uid && isOk(c.state)); }
  function setAdmin(on){ html.classList.toggle('jk-admin', !!on); }
  function timeout(p, ms){ var t; return Promise.race([p, new Promise(function(_, rej){ t=setTimeout(function(){ rej(new Error('응답 없음('+Math.round(ms/1000)+'초)')); }, ms); })])
    .finally(function(){ clearTimeout(t); }); }

  /* 승인 확인 — fb: {db, doc, getDoc, setDoc}. 처음 로그인한 계정은 신청 기록을 남긴다.
     본인이 쓰는 칸은 이메일·이름·사진·신청 시각뿐이다(승인·차단 칸은 규칙상 관리자만 쓴다). */
  async function check(user, fb, opt){
    opt=opt||{};
    if(!user){ cacheSet(null); setAdmin(false); return {state:'signedout'}; }
    if(isAdminEmail(user.email)){ cacheSet(user, 'admin'); setAdmin(true); return {state:'admin'}; }
    setAdmin(false);
    var ref=fb.doc(fb.db, 'profiles', user.uid), prof=null;
    try{ var snap=await timeout(fb.getDoc(ref), opt.timeoutMs||8000); prof=snap.exists()?(snap.data()||{}):null; }
    catch(e){
      return cacheOk(user) ? {state:'approved', offline:true} : {state:'error', error:String(e&&e.message||e)};
    }
    if(!prof || !prof.requestedAt){
      var req={email:user.email||'', name:user.displayName||'', photo:user.photoURL||'', requestedAt:Date.now()};
      try{ await timeout(fb.setDoc(ref, req, {merge:true}), opt.timeoutMs||8000); }catch(e){ console.warn('access request', e); }
      prof=Object.assign({}, prof||{}, req);
    }
    var state=decide(user, prof); cacheSet(user, state);
    return {state:state, prof:prof};
  }
  /* 신청 메모 — 관리자가 누구인지 알아보게 이름·관계 같은 걸 남긴다(200자) */
  async function saveNote(user, fb, note){
    if(!user) return false;
    try{ await timeout(fb.setDoc(fb.doc(fb.db,'profiles',user.uid), {reqNote:String(note||'').slice(0,200), reqNoteAt:Date.now()}, {merge:true}), 8000); return true; }
    catch(e){ console.warn('access note', e); return false; }
  }

  /* ── 화면 ── 단타·관리자 메뉴는 소유자에게만 · 승인 전에는 본문을 가린다(data-guard) */
  var css=''
   +'html:not(.jk-admin) a[href="/scalping"],html:not(.jk-admin) a[href="/claude"],html:not(.jk-admin) a[href="/admin"]{display:none!important}'
   +'.jk-menu-hidden{display:none!important}'
   +'html.jk-guard:not(.jk-ok) body{overflow:hidden}'
   +'html.jk-guard:not(.jk-ok) body>*:not(#jkgate){visibility:hidden}'
   +'#jkgate{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:24px;'
   +'background:linear-gradient(160deg,#0f1320,#171c2e);color:#e8ecf7;font-family:-apple-system,BlinkMacSystemFont,"Pretendard","Segoe UI",sans-serif;text-align:center}'
   /* visibility 까지 직접 켠다 — 자산플랜은 로그인 전 body 아래를 통째로(#authgate 말고) 숨기는데 이 막도 거기 걸린다 */
   +'#jkgate.on{display:flex;visibility:visible!important}#jkgate .jb{max-width:380px;width:100%}'
   +'#jkgate .jl{font-size:28px;font-weight:800;letter-spacing:-.02em;margin-bottom:8px}#jkgate .jl b{color:#f5c451}'
   +'#jkgate .js{color:#9aa6c9;font-size:13px;line-height:1.7;margin-bottom:22px}#jkgate .js b{color:#e8ecf7}'
   +'#jkgate .jbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;border:0;border-radius:12px;padding:13px 18px;font-size:15px;font-weight:700;cursor:pointer;margin-top:9px}'
   +'#jkgate .jg{background:#fff;color:#1f1f1f}#jkgate .jg svg{width:20px;height:20px}'
   +'#jkgate .j2{background:#1e2540;color:#e8ecf7;border:1px solid #34406a}'
   +'#jkgate textarea{width:100%;min-height:64px;margin-top:4px;padding:10px;border-radius:10px;border:1px solid #34406a;background:#171c2e;color:#e8ecf7;font:inherit;font-size:13px;resize:vertical}'
   +'#jkgate .jm{color:#f87b8c;font-size:12px;margin-top:12px;min-height:16px;line-height:1.6}#jkgate .jok{color:#36d399}'
   +'#jkgate .jspin{display:inline-block;width:16px;height:16px;border:2.5px solid #2a3354;border-top-color:#8b8cf0;border-radius:50%;animation:jkspin .7s linear infinite;vertical-align:-3px;margin-right:7px}'
   +'@keyframes jkspin{to{transform:rotate(360deg)}}';
  try{ var st=document.createElement('style'); st.id='jkaccess-css'; st.textContent=css; (document.head||html).appendChild(st); }catch(e){}
  var cur=document.currentScript;
  if(cur && cur.getAttribute('data-guard')==='1') html.classList.add('jk-guard');
  /* 관리자 메뉴는 현재 페이지에서 Firebase 승인 확인이 끝난 뒤에만 보인다. */

  var G='<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function esc(t){ return String(t==null?'':t).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function el(){
    var g=document.getElementById('jkgate');
    if(!g && document.body){ g=document.createElement('div'); g.id='jkgate'; g.setAttribute('role','dialog'); g.setAttribute('aria-modal','true'); document.body.appendChild(g); }
    return g;
  }
  var H={};   // 지금 화면의 단추 동작
  function show(state, o){
    o=o||{}; H=o;
    var g=el(); if(!g){ document.addEventListener('DOMContentLoaded', function(){ show(state, o); }, {once:true}); return; }
    var who=o.user ? '<b>'+esc(o.user.email||o.user.displayName||'')+'</b>' : '';
    var head='<div class="jl">JK <b>퀀트</b></div>', body='';
    if(state==='checking'){
      body='<div class="js"><span class="jspin"></span>로그인 확인 중…</div>';
    }else if(state==='signedout'){
      body='<div class="js">로그인해야 볼 수 있습니다.<br>처음이면 로그인할 때 <b>이용 신청</b>이 접수되고,<br>관리자가 승인하면 열립니다.</div>'
          +'<button class="jbtn jg" data-jk="login">'+G+'Google로 로그인</button>';
    }else if(state==='pending'){
      var note=(o.prof&&o.prof.reqNote)||'';
      body='<div class="js">이용 신청이 접수되었습니다 — '+who+'<br>관리자가 승인하면 바로 사용할 수 있습니다.</div>'
          +'<textarea id="jknote" maxlength="200" placeholder="관리자에게 남길 말 (이름·관계 등)">'+esc(note)+'</textarea>'
          +'<button class="jbtn j2" data-jk="note">메모 남기기</button>'
          +'<button class="jbtn j2" data-jk="retry">승인됐는지 다시 확인</button>'
          +'<button class="jbtn j2" data-jk="logout">로그아웃</button>';
    }else if(state==='menu'){
      var hidden=o.menuMode==='hidden';
      body='<div class="js">'+(hidden
          ?'이 메뉴는 현재 <b>전체 숨김</b> 상태입니다.<br>관리자는 주소를 직접 입력해서만 열 수 있습니다.'
          :'이 메뉴는 현재 <b>관리자 전용</b>입니다.')+'</div>'
          +'<button class="jbtn j2" onclick="location.href=\'/\'">운영 화면으로</button>'
          +(o.logout?'<button class="jbtn j2" data-jk="logout">로그아웃</button>':'');
    }else if(state==='blocked'){
      body='<div class="js">'+who+' 계정은 사용할 수 없습니다.<br>(승인 거절 또는 차단)<br>다른 계정으로 쓰려면 로그아웃한 뒤 다시 로그인하세요.</div>'
          +'<button class="jbtn j2" data-jk="logout">로그아웃</button>';
    }else{   // error
      body='<div class="js">승인 상태를 확인하지 못했습니다.<br>인터넷 연결을 확인하고 다시 시도해 주세요.</div>'
          +'<button class="jbtn j2" data-jk="retry">다시 시도</button>'
          +'<button class="jbtn j2" data-jk="logout">로그아웃</button>';
    }
    g.innerHTML='<div class="jb">'+head+body+'<div class="jm" id="jkmsg">'+esc(o.msg||'')+'</div></div>';
    g.className='on'; g.setAttribute('data-state', state);
    html.classList.remove('jk-ok');
  }
  function msg(t, ok){ var m=document.getElementById('jkmsg'); if(m){ m.textContent=t||''; m.className='jm'+(ok?' jok':''); } }
  function hide(){ var g=document.getElementById('jkgate'); if(g){ g.className=''; g.innerHTML=''; g.removeAttribute('data-state'); } html.classList.add('jk-ok'); }
  /* 지금 덮고 있는 화면('checking'·'pending'·…) — 없으면 '' · 다른 코드가 이 막을 직접 만지지 않게 */
  function showing(){ var g=document.getElementById('jkgate'); return (g && g.className==='on' && g.getAttribute('data-state')) || ''; }
  document.addEventListener('click', function(e){
    var b=e.target && e.target.closest && e.target.closest('#jkgate [data-jk]'); if(!b) return;
    var a=b.getAttribute('data-jk');
    if(a==='login' && H.login) H.login();
    else if(a==='logout' && H.logout) H.logout();
    else if(a==='retry'){ if(H.retry) H.retry(); else location.reload(); }
    else if(a==='note' && H.saveNote){ var t=(document.getElementById('jknote')||{}).value||''; msg('저장 중…');
      Promise.resolve(H.saveNote(t)).then(function(ok){ msg(ok?'메모를 남겼습니다.':'메모를 저장하지 못했습니다.', ok); }); }
  });

  /* 열지 말지 — 모든 페이지가 이 하나로 정한다. fb: {auth, db, doc, getDoc, setDoc} · o.lock(r): 승인 안 됐을 때 그 페이지가 덮는 법.
     이 기기에서 승인이 확인된 계정(관리자 포함)은 곧바로 true — 페이지를 옮길 때마다 기다리지 않게.
       대신 뒤에서 다시 묻고, 그 사이 승인 취소·차단됐으면 o.lock(r) 로 그 자리에서 덮는다.
     처음 보는 계정은 답이 와야 연다 — 승인이면 true, 아니면 o.lock(r) 하고 false.
     확인하는 사이 계정이 바뀌었으면 false(새 계정 흐름이 맡는다). */
  async function admit(user, fb, o){
    o=o||{};
    var lock=function(r){ try{ if(o.lock) o.lock(r); }catch(e){ console.error(e); } };
    var stale=function(){ var cu=fb.auth && fb.auth.currentUser; return !!(fb.auth && (!cu || cu.uid!==user.uid)); };
    async function menuOk(){
      var cfg=await applyMenuConfig(user,fb);
      var ma=menuAccess(user,cfg,location.pathname);
      if(!ma.allowed){ lock({state:'menu',menuMode:ma.mode}); return false; }
      return true;
    }
    if(isAdminEmail(user.email)){
      /* 관리자는 현재 페이지 접근이 항상 허용된다.
         메뉴 정렬 하나 읽느라 5초를 막으면 실제 원장 로딩이 늦어지므로 앱부터 열고 뒤에서 적용한다. */
      setAdmin(true); hide();
      applyMenuConfig(user,fb).catch(function(e){ console.warn('menu config',e); });
      return true;
    }
    if(cacheOk(user)){
      setAdmin(false);
      if(!await menuOk())return false;
      hide();
      check(user, fb).then(function(r){ if(!stale() && !isOk(r.state)) lock(r); }, function(e){ console.warn('access recheck', e); });
      return true;
    }
    show('checking', {user:user});
    var r; try{ r=await check(user, fb); }catch(e){ r={state:'error', error:String(e&&e.message||e)}; }
    if(stale()) return false;
    if(!isOk(r.state)){ lock(r); return false; }
    if(!await menuOk())return false;
    hide();
    return true;
  }

  /* 단순 페이지용 — 로그인·승인을 통째로 맡는다.
     fb: {auth, db, doc, getDoc, setDoc, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut}
     o.onUser(user|null): 배지 같은 것 · o.onOk(user): 승인 뒤 한 번(페이지 자료 불러오기). */
  function guard(fb, o){
    o=o||{}; html.classList.add('jk-guard');
    var login=function(){
      var p=new fb.GoogleAuthProvider(); try{ p.setCustomParameters({prompt:'select_account'}); }catch(e){}
      return fb.signInWithPopup(fb.auth, p).catch(function(e){ msg((e&&e.code==='auth/popup-blocked')?'팝업이 막혔습니다 — 팝업을 허용한 뒤 다시 눌러 주세요.':((e&&e.message)||'로그인 실패')); });
    };
    var logout=function(){ return fb.signOut(fb.auth); };
    var resolved=false, startedUid=null;   // 같은 화면에서 다른 계정으로 다시 로그인하면 그 계정 자료를 다시 부른다
    show('checking');
    setTimeout(function(){
      if(resolved)return;
      /* currentUser가 이미 있으면 인증 콜백/DB가 늦는 것이지 로그아웃이 아니다.
         예전엔 8초만 지나면 로그인 버튼으로 바꿔 진행 중 인증을 사용자가 또 시작하게 했다. */
      var cu=fb.auth&&fb.auth.currentUser;
      if(cu) show('checking', {user:cu, msg:'Google 로그인은 확인됐습니다. Firebase DB 연결을 기다리는 중입니다…'});
      else show('signedout', {login:login, msg:'로그인 상태 확인이 늦어지고 있습니다 — 다시 로그인하거나 새로고침해 주세요.'});
    }, 12000);
    fb.onAuthStateChanged(fb.auth, async function(user){
      resolved=true;
      try{ if(o.onUser) o.onUser(user||null); }catch(e){ console.warn(e); }
      if(!user){ startedUid=null; cacheSet(null); setAdmin(false); show('signedout', {login:login}); return; }
      var ok=await admit(user, fb, {lock:function(r){
        show(r.state, {user:user, prof:r.prof, login:login, logout:logout, retry:function(){ location.reload(); },
                       saveNote:function(n){ return saveNote(user, fb, n); }});
      }});
      if(!ok) return;
      if(startedUid!==user.uid){ startedUid=user.uid; try{ if(o.onOk) await o.onOk(user); }catch(e){ console.error(e); } }
    });
  }

  window.JKAccess={ADMIN_EMAILS:ADMIN_EMAILS, MENU_ITEMS:MENU_ITEMS, isAdminEmail:isAdminEmail, decide:decide, isOk:isOk, check:check, admit:admit, saveNote:saveNote,
                   cacheOk:cacheOk, cacheSet:cacheSet, setAdmin:setAdmin, show:show, hide:hide, showing:showing, guard:guard,
                   menuPath:menuPath, menuDefaults:menuDefaults, normalizeMenuConfig:normalizeMenuConfig, loadMenuConfig:loadMenuConfig,
                   applyMenuConfig:applyMenuConfig, menuAccess:menuAccess};
})();
