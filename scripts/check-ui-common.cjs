// 공용 화면 도구(jk-ui.js) · 모의 성과 표 첫 칸 — 2026-10-07 사용자 요청
//   "전략 세션 줄바꿈해서 최종이 스크롤 없이도 보이게 · 오른쪽 중간위치쯤에 탑으로 가는 버튼 · 모든 페이지에"
// 실제 파일 글자를 가짜 DOM 에서 돌려 값으로 본다.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const ROOT=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(ROOT,'jk-ui.js'),'utf8');
const html=fs.readFileSync(process.argv[2]||path.join(ROOT,'index.html'),'utf8');
const PAGES=['index.html','backtest.html','plan.html','admin.html','scalping.html','claude.html','ipo.html','job.html','realestate.html','settings.html'];
const results=[];let failed=0;
function t(name,body){ try{ body(); results.push('PASS '+name); }catch(e){ failed++; results.push('FAIL '+name+' — '+(e&&e.message||e)); } }
function fnOf(src,marker){const start=src.indexOf(marker);assert(start>=0,marker);let i=src.indexOf('{',start),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(start,i+1);}throw Error('unclosed '+marker);}

/* 가짜 브라우저 — 스크롤 이벤트는 붙잡기 단계 듣기로만 전달된다(실제와 같다) */
function fakeDom(){
  const listeners={doc:[],win:[]}; const calls={winScroll:[],cancel:0,elScroll:[]};
  const mkEl=tag=>{ const el={tagName:tag.toUpperCase(),nodeType:1,children:[],style:{},attrs:{},isConnected:true,_cls:new Set(),_on:{},
    classList:{contains:c=>el._cls.has(c),toggle:(c,f)=>{ const v=f===undefined?!el._cls.has(c):!!f; if(v)el._cls.add(c); else el._cls.delete(c); return v; },add:c=>el._cls.add(c),remove:c=>el._cls.delete(c)},
    setAttribute:(k,v)=>{el.attrs[k]=String(v);},getAttribute:k=>el.attrs[k],appendChild:c=>{el.children.push(c);return c;},
    addEventListener:(ev,f)=>{(el._on[ev]=el._on[ev]||[]).push(f);},getClientRects:()=>[1],scrollTop:0,scrollHeight:0,clientHeight:0,
    scrollTo(o){ calls.elScroll.push(o); el.scrollTop=0; } }; return el; };
  const head=mkEl('head'), body=mkEl('body');
  const document={readyState:'complete',head,body,documentElement:{scrollTop:0},nodeType:9,
    createElement:mkEl,getElementById:()=>null,querySelectorAll:()=>[],addEventListener:(ev,f,o)=>listeners.doc.push({ev,f,capture:!!(o&&o.capture)})};
  const win={pageYOffset:0,document,requestAnimationFrame:f=>{f();return 1;},
    addEventListener:(ev,f)=>listeners.win.push({ev,f}),scrollTo(o){ calls.winScroll.push(o); win.pageYOffset=0; }};
  win.window=win;
  const all=()=>[...head.children,...body.children];
  const fireScroll=target=>listeners.doc.filter(l=>l.ev==='scroll'&&l.capture).forEach(l=>l.f({target}));
  return {win,document,head,body,mkEl,calls,all,fireScroll,listeners};
}
function load(D){ vm.runInNewContext(ui,{window:D.win,document:D.document,location:{pathname:'/'},setTimeout,clearTimeout,console}); }

t('U1 맨 위로 버튼 — 하나만 만든다 · 맨 위에선 숨고 300px 넘게 내려가면 보인다 · 누르면 창을 맨 위로(보던 자리 지키기를 먼저 푼다)',()=>{
  const D=fakeDom(); D.win.cancelHold=()=>{D.calls.cancel++;};
  load(D); load(D);                                                   // 두 번 읽혀도
  const btns=D.body.children.filter(x=>x.attrs&&x.tagName==='BUTTON'); assert.equal(btns.length,1,'버튼 하나');
  const b=btns[0]; assert.equal(b.id,'jkToTop'); assert.equal(b.attrs['aria-label'],'맨 위로'); assert.equal(b.textContent,'↑');
  assert.equal(b.classList.contains('on'),false,'맨 위에선 숨는다');
  D.win.pageYOffset=250; D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'250px 은 아직');
  D.win.pageYOffset=301; D.fireScroll(D.document); assert.equal(b.classList.contains('on'),true,'301px 이면 보인다');
  b._on.click[0](); assert.equal(D.calls.cancel,1,'cancelHold 먼저'); assert.equal(JSON.stringify(D.calls.winScroll.at(-1)),'{"top":0,"behavior":"smooth"}','창을 맨 위로');
  D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'올라가면 다시 숨는다');
  assert.equal(D.win.JKToTop.SHOW_AT,300);
});
t('U1 안쪽 스크롤 칸(시트·긴 목록)을 내리고 있으면 — 창이 맨 위여도 버튼이 보이고, 누르면 그 칸도 맨 위로',()=>{
  const D=fakeDom(); load(D); const b=D.body.children.find(x=>x.tagName==='BUTTON');
  const box=D.mkEl('div'); box.scrollHeight=3000; box.clientHeight=600; box.scrollTop=900;
  D.fireScroll(box); assert.equal(b.classList.contains('on'),true,'안쪽 칸 900px');
  b._on.click[0](); assert.equal(JSON.stringify(D.calls.elScroll.at(-1)),'{"top":0,"behavior":"smooth"}','그 칸을 올린다'); assert.equal(D.calls.winScroll.length,1,'창도 같이');
  const small=D.mkEl('div'); small.scrollHeight=640; small.clientHeight=600; small.scrollTop=40;
  D.fireScroll(small); D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'거의 안 넘치는 칸은 안 센다');
  box.scrollTop=800; box.getClientRects=()=>[]; D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'닫힌(안 보이는) 칸은 안 센다');
});
t('U2 자리 — 오른쪽 가장자리 · 화면 세로 가운데 · 모달(z-index 100)보다 아래 · 인쇄엔 안 나온다',()=>{
  assert(/#jkToTop\{position:fixed;right:calc\(6px \+ env\(safe-area-inset-right,0px\)\);top:50%;transform:translateY\(-50%\);z-index:96;/.test(ui),'오른쪽 가운데 고정');
  assert(/\.modal\{[^}]*z-index:100/.test(html),'운영 모달은 100');
  assert(/#jkToTop\.on\{opacity:\.8;visibility:visible\}/.test(ui) && /opacity:0;visibility:hidden/.test(ui),'평소 숨김 · on 이면 보임');
  assert(/@media print\{#jkToTop\{display:none\}\}/.test(ui));
});
t('U3 모든 페이지(10개)가 같은 파일을 한 번씩 읽는다 — 공용 jk-access.js 바로 다음',()=>{
  for(const f of PAGES){
    const s=fs.readFileSync(path.join(ROOT,f),'utf8');
    assert.equal((s.match(/<script src="\/jk-ui\.js" defer><\/script>/g)||[]).length,1,f+' 한 번');
    assert(/<script src="\/jk-access\.js"[^>]*><\/script>\n<script src="\/jk-ui\.js" defer><\/script>/.test(s),f+' jk-access 다음');
  }
  const htmls=fs.readdirSync(ROOT).filter(f=>/\.html$/.test(f)).sort();
  assert.deepEqual(htmls,[...PAGES].sort(),'페이지가 늘면 여기에도 넣는다: '+htmls.join(','));
});
t('U4 모의 성과 첫 칸 — 폭을 정해 두고 줄바꿈 · 폰 폭 340~414px 에서 기간·평가·최종이 한 화면에',()=>{
  const op=fnOf(html,'async function openPaper()');
  assert(/<td><div class="pcell"><b class="slink"[^`]*\$\{outTag\}<\/div><\/td>/.test(op),'첫 칸을 pcell 로 감싼다');
  const css=(html.match(/\.htable\.narrow td:first-child \.pcell\{[^}]*\}/)||[''])[0];
  assert(/min-width:clamp\(96px,calc\(100vw - 250px\),170px\)/.test(css) && /overflow-wrap:anywhere/.test(css),css);
  assert(/\.htable\.narrow td:first-child \.pcell \.cw\{white-space:normal\}/.test(html),'설정 줄도 접힌다');
  // 폭 계산 — 첫 칸(최소 폭+여백 8) + 기간·평가·최종(실측 170px) 이 표 칸(화면−50) 안에 든다
  const first=vw=>Math.min(170,Math.max(96,vw-250))+8;
  for(const vw of [340,360,375,390,414,430]) assert(first(vw)+170<=vw-50,`폭 ${vw}px: ${first(vw)}+170 > ${vw-50}`);
});

t('U5 자산플랜 맨 위 "다음 단계 조건" 카드를 뺐다 — 화면·글자·갱신 코드 모두 · 단계 카드가 전체 폭',()=>{
  const pl=fs.readFileSync(path.join(ROOT,'plan.html'),'utf8');
  assert(!/>다음 단계 조건</.test(pl) && !/id="nextRule"|id="nextNote"/.test(pl),'카드 없음');
  assert(!/\$\("nextRule"\)|\$\("nextNote"\)/.test(pl),'없는 칸을 채우는 코드도 없음(있으면 화면 갱신이 멈춘다)');
  assert(!/페이지 열기 → 오늘 주문 확인 → 체결 반영/.test(pl),'A탭 문구 없음');
  const hero=(pl.match(/<div class="hero">([\s\S]*?)\n  <\/div>\n/)||['',''])[1];
  assert.equal((hero.match(/<section class="card">/g)||[]).length,1,'hero 카드 하나');
  assert(/\.hero\{display:grid;grid-template-columns:1fr;/.test(pl),'한 칸 전체 폭');
});

/* 전체메뉴 순서 — 관리자가 바꾼 순서(settings/siteMenu)가 첫 읽기가 늦거나 끊겨도 결국 메뉴에 붙는다 (2026-10-07 사용자 화면) */
const acc=fs.readFileSync(path.join(ROOT,'jk-access.js'),'utf8');
const HREFS=['/','/plan','/backtest','/scalping','/claude','/paper','/ipo','/realestate','/job','/admin'];
const SAVED={'/':10,'/plan':20,'/paper':30,'/scalping':40,'/claude':50,'/backtest':60,'/ipo':70,'/realestate':80,'/job':90,'/admin':100};
const ORDER_SAVED=Object.keys(SAVED).sort((a,b)=>SAVED[a]-SAVED[b]).join(',');
function menuDom(){
  const pop={children:[], appendChild(a){ const i=this.children.indexOf(a); if(i>=0) this.children.splice(i,1); this.children.push(a); return a; },
             querySelectorAll(q){ return q==='a[href]'?this.children.slice():[]; }};
  HREFS.forEach(h=>{ const c=new Set(); pop.children.push({getAttribute:k=>k==='href'?h:null, classList:{toggle:(x,on)=>on?c.add(x):c.delete(x), contains:x=>c.has(x)}}); });
  const html={classList:{add(){},remove(){},toggle(){},contains:()=>false}};
  const document={documentElement:html, head:{appendChild(){}}, body:null, createElement:()=>({setAttribute(){},appendChild(){}}),
    getElementById:()=>null, querySelectorAll:q=>q==='.jkmenu-pop'?[pop]:[], currentScript:null, addEventListener(){}};
  const ctx={document, console:{warn(){},error(){},log(){}}, setTimeout, clearTimeout, URL, location:{origin:'https://jkquant.pages.dev',pathname:'/'}};
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(acc, ctx);
  return {A:ctx.JKAccess, order:()=>pop.children.map(a=>a.getAttribute('href')).join(',')};
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const menuDoc=items=>({exists:()=>true, data:()=>({items:Object.fromEntries(Object.entries(items).map(([p,o])=>[p,{mode:['/scalping','/claude','/admin'].includes(p)?'admin':'public',order:o}]))})});
const mkFb=answers=>{ let n=0; return {reads:()=>n, fb:{db:{}, doc:(db,c,id)=>c+'/'+id, getDoc:ref=>{ assert.equal(ref,'settings/siteMenu'); const a=answers[Math.min(n++,answers.length-1)]; return a(); }}}; };
const ADM={uid:'a1',email:'jk82investing@gmail.com'};
const PENDING=[];
function ta(name,body){ PENDING.push(Promise.resolve().then(body).then(()=>results.push('PASS '+name),e=>{ failed++; results.push('FAIL '+name+' — '+(e&&e.message||e)); })); }
ta('U8 전체메뉴 순서 — 첫 읽기가 시간 초과로 끝나도 늦게 온 답(관리자가 바꾼 순서)을 받는 즉시 메뉴에 붙인다',async()=>{
  const D=menuDom(), F=mkFb([()=>sleep(60).then(()=>menuDoc(SAVED))]);
  assert.equal(D.order(),HREFS.join(','),'처음은 페이지 기본 순서');
  const cfg=await D.A.applyMenuConfig(ADM,F.fb,{timeoutMs:15});
  assert.equal(cfg.items['/paper'].order,60,'시간 초과 — 지금은 기본값으로 판정');
  assert.equal(D.order(),HREFS.join(','),'아직 답이 안 왔다');
  await sleep(90);
  assert.equal(D.order(),ORDER_SAVED,'늦게 온 답의 순서: 운영·자산플랜·모의·단타·단타·백테…');
  const again=await D.A.applyMenuConfig(ADM,F.fb);
  assert.equal(again.items['/paper'].order,30,'이 화면의 다음 판정도 받은 값'); assert.equal(F.reads(),1,'다시 읽지 않는다');
});
ta('U8 첫 읽기가 실패(끊김)하면 한 번 더 읽어 그 순서를 붙인다 · 그 사이 새로 읽은 값(관리자 저장)이 있으면 옛 답이 덮지 않는다',async()=>{
  const D=menuDom(), F=mkFb([()=>Promise.reject(new Error('offline')),()=>Promise.resolve(menuDoc(SAVED))]);
  await D.A.applyMenuConfig(ADM,F.fb,{timeoutMs:200,retryMs:20});
  assert.equal(D.order(),HREFS.join(','),'실패 직후엔 기본 순서');
  await sleep(60);
  assert.equal(F.reads(),2,'한 번 더 읽었다'); assert.equal(D.order(),ORDER_SAVED,'다시 읽은 순서');
  const NEW={...SAVED,'/backtest':15};                                 // 관리자가 백테를 운영 바로 아래로 다시 옮겨 저장
  const ORDER_NEW=Object.keys(NEW).sort((a,b)=>NEW[a]-NEW[b]).join(',');
  const E=menuDom(), G=mkFb([()=>sleep(80).then(()=>menuDoc(SAVED)),()=>Promise.resolve(menuDoc(NEW))]);
  await E.A.applyMenuConfig(ADM,G.fb,{timeoutMs:15});                 // 느린 첫 읽기(옛 순서)
  await E.A.applyMenuConfig(ADM,G.fb,{force:true});                   // 저장 직후 새로 읽기
  assert.equal(E.order(),ORDER_NEW,'새 순서');
  await sleep(110);
  assert.equal(E.order(),ORDER_NEW,'늦게 온 옛 답이 새 순서를 덮으면 안 된다');
});
/* 넓은 표 — 휴대폰에서도 표 그대로(사용자: 비교는 표가 편함). 넘치는 표만 촘촘하게 + 첫 칸 고정 · 페이지는 안 밀린다 */
const fitSrc=(()=>{ const a=ui.indexOf('/* 넓은 표 —'), b=ui.indexOf('window.JKFit = {'); assert(a>=0&&b>a,'jk-ui.js 넓은 표 블록'); return ui.slice(a, ui.indexOf('})();',b)+5); })();
function fitDom(o={}){
  const L={doc:[],win:[]}; let mo=null; const log=[];
  const body={nodeType:1,tagName:'BODY',_bg:'rgb(15, 19, 32)',_ox:'hidden',parentElement:null};
  const card={nodeType:1,tagName:'DIV',_bg:'rgb(23, 28, 46)',_ox:'visible',parentElement:body,clientWidth:360};
  const wrap={nodeType:1,tagName:'DIV',_bg:'rgba(0, 0, 0, 0)',_ox:'auto',parentElement:card,clientWidth:351};   // 표 상자(옆으로 미는 칸)
  const tables=[], T0='rgba(0, 0, 0, 0)';
  const mkStyle=st=>({setProperty:(k,v)=>{ log.push('w'); st[k]=v; },getPropertyValue:k=>st[k]||'',removeProperty:k=>{ log.push('w'); delete st[k]; }});
  const mkTable=(w,vis=true,rows=[{}])=>{ const cls=new Set(), tst={}; let W=w; const t={nodeType:1,tagName:'TABLE',_bg:T0,parentElement:wrap,_tst:tst,reads:0,
    classList:{contains:c=>cls.has(c),add:c=>cls.add(c),remove:c=>cls.delete(c)},style:mkStyle(tst),getClientRects:()=>vis?[1]:[],
    setW(x){ W=x; }, show(v){ vis=v; }};
    Object.defineProperty(t,'scrollWidth',{get(){ t.reads++; return W; }}); Object.defineProperty(t,'offsetWidth',{get(){ return W; }});
    const head={nodeType:1,tagName:'THEAD',_bg:T0,parentElement:t}, bodyS={nodeType:1,tagName:'TBODY',_bg:T0,parentElement:t};
    t.rows=rows.map(r=>{ const tr={nodeType:1,tagName:'TR',_bg:r.tr||T0,parentElement:r.head?head:bodyS}, st={};
      tr.cells=[{nodeType:1,tagName:r.head?'TH':'TD',_bg:r.cell||T0,parentElement:tr,_st:st,style:mkStyle(st)}]; return tr; });
    t.bgOf=i=>t.rows[i].cells[0]._st['--jk-fit-bg']; tables.push(t); return t; };
  const scans={n:0};
  const document={readyState:'complete',body,head:{appendChild(){}},documentElement:{},getElementById:()=>null,createElement:()=>({}),
    querySelectorAll:q=>{ if(q!=='table') return []; scans.n++; return tables.slice(); },addEventListener:(ev,f,op)=>L.doc.push({ev,f,capture:op===true||!!(op&&op.capture)})};
  const win={innerWidth:o.w||375,addEventListener:(ev,f)=>L.win.push({ev,f})};
  class MO{ constructor(cb){ mo=this; this.cb=cb; } observe(target,opt){ this.target=target; this.opt=opt; } }
  const ctx={window:win,document,location:{pathname:o.path||'/'},getComputedStyle:el=>{ log.push('r'); return {overflowX:el._ox||'visible',backgroundColor:el._bg||T0}; },
    MutationObserver:MO,setTimeout,clearTimeout,console};
  win.window=win; vm.createContext(ctx);
  return {ctx,win,L,log,tables,scans,mkTable,wrap,mo:()=>mo,run(){ vm.runInContext(fitSrc,ctx); return win.JKFit; }};
}
const on=t=>t.classList.contains('jk-fit');
t('U9 넓은 표 — 폭 760px 이하에서 표 상자보다 넓은 표만 jk-fit(글자·간격 줄임 + 첫 칸 고정) · 들어맞는 표 · 숨은 표는 그대로',()=>{
  const D=fitDom({w:375});
  const wide=D.mkTable(600,true,[{head:true,cell:'rgb(30, 37, 64)'},{},{tr:'rgba(255, 255, 255, 0.05)'}]), fits=D.mkTable(340), edge=D.mkTable(353), hid=D.mkTable(900,false);
  const F=D.run();
  assert.deepEqual([on(wide),on(fits),on(edge),on(hid)],[true,false,false,false],'600px 표만(351px 상자 · 2px 여유)');
  assert.equal(wide._tst['--jk-fit-bg'],'rgb(23, 28, 46)','표에 단 색 = 표가 놓인 카드 색(투명한 표·표 상자는 건너뛴다) — 보통 줄 첫 칸은 이걸 물려받는다');
  assert.equal(wide.bgOf(0),'rgb(30, 37, 64)','머리글 첫 칸은 머리글 칸 색 그대로');
  assert.equal(wide.bgOf(1),undefined,'보통 줄은 칸마다 달지 않는다(286줄이면 286번 쓰기)');
  assert.equal(wide.bgOf(2),'rgb(35, 39, 56)','반투명 강조 줄(흰 5%)은 카드 색 위에 합성한 불투명 색 — 255×.05+23×.95=34.6 · 39.4 · 56.5');
  assert.equal(fits._tst['--jk-fit-bg'],undefined,'안 줄인 표는 손대지 않는다');
  wide.setW(330); wide.__jkFitDirty=true; F.scan(); assert.equal(on(wide),false,'자료가 줄어 들어맞으면 원래 표로');
  wide.setW(700); wide.__jkFitDirty=true; hid.show(true); F.scan(); assert.deepEqual([on(wide),on(hid)],[true,true],'다시 넓어지면 · 숨었던 표가 보이면');
  D.win.innerWidth=1024; F.scan(); assert.deepEqual(D.tables.map(on),[false,false,false,false],'넓은 화면에선 전부 원래 표');
  assert.equal(F.AT,760);
});
t('U9 빠르기 — 줄마다 읽고 쓰기를 번갈아 하지 않는다(읽기 다 하고 쓰기) · 같은 폭에서 안 바뀐 표는 다시 안 잰다 · 줄여도 넘치는 표는 벗겨 다시 재지 않는다',()=>{
  const D=fitDom({w:375}); const rows=[{head:true,cell:'rgb(30, 37, 64)'}]; for(let i=0;i<40;i++) rows.push(i%10===3?{tr:'rgba(255, 255, 255, 0.05)'}:{});
  const big=D.mkTable(900,true,rows); const F=D.run();
  assert.equal(on(big),true);
  const seq=D.log.join(''), firstW=seq.indexOf('w');
  assert(firstW>0 && seq.indexOf('r',firstW)<0,'첫 쓰기 뒤에 읽기가 없다: '+seq.replace(/(.)\1+/g,(m,c)=>c+m.length));
  const reads=big.reads; F.scan(); F.scan(); assert.equal(big.reads,reads,'안 바뀐 표는 폭을 다시 안 읽는다(누를 때마다 0.9초 멈칫하던 원인)');
  let removed=0; const rm=big.classList.remove; big.classList.remove=c=>{ if(c==='jk-fit') removed++; return rm(c); };
  D.log.length=0; big.__jkFitDirty=true; F.scan(); assert.equal(on(big),true,'내용이 바뀌면 다시 잰다');
  assert.equal(removed,0,'줄인 채 여전히 넘치면 벗기지 않는다 — 반을 껐다 켜면 큰 표는 0.2~0.5초(색도 벗기지 않고 읽는다)');
  assert.equal(D.log.filter(x=>x==='w').length,0,'색이 그대로면 쓰지 않는다');
});
t('U9 jk-fit 모양 — 760px 이하에서만 · 글자 11px · 간격 5px 3px · 머리글 접힘 · 첫 칸 sticky(바탕 칠함) · 단타(클로드)는 자기 fit 이 있어 건너뛴다',()=>{
  assert(/'@media \(max-width:' \+ AT \+ 'px\)\{'/.test(fitSrc),'760px 이하에서만');
  assert(/table\.jk-fit th,table\.jk-fit td\{font-size:11px!important;padding:5px 3px!important;word-break:keep-all;overflow-wrap:normal\}/.test(fitSrc),
    '낱말 가운데서 안 끊는다 — 카드의 overflow-wrap:anywhere 를 물려받으면 표 폭 제한(max-width:100%)에 머리글이 한 글자씩 세로로 쪼개졌다(부동산 10칸 표)');
  assert(/table\.jk-fit th\{white-space:normal!important;/.test(fitSrc),'머리글은 띄어쓰기에서 접힘');
  assert(/table\.jk-fit tr>:first-child\{position:sticky;left:0;z-index:1;box-shadow:inset 0 0 0 100vmax var\(--jk-fit-bg,#171c2e\)\}/.test(fitSrc),'첫 칸 고정 · 칠하기는 안쪽 그림자(바탕색은 그대로 읽히게)');
  const D=fitDom({w:375,path:'/claude'}); const w=D.mkTable(900); D.run(); assert.equal(on(w),false,'/claude 건너뜀');
  const E=fitDom({w:375,path:'/claude.html'}); const w2=E.mkTable(900); E.run(); assert.equal(on(w2),false,'/claude.html 건너뜀');
});
ta('U9 다시 재는 때 — 표 안을 다시 그림 · 표가 새로 들어옴 · 탭(누름)으로 숨었던 표가 보임 · 폭 바뀜 · 다 읽힌 뒤(load). 표와 상관없는 글자 바뀜엔 안 잰다',async()=>{
  const D=fitDom({w:375}); const t1=D.mkTable(300); const F=D.run();
  assert.equal(on(t1),false); const mo=D.mo(); assert(mo&&mo.opt&&mo.opt.childList&&mo.opt.subtree&&!mo.opt.attributes,'자식 변화만 본다(반 바꾸기로 스스로 다시 부르지 않게)');
  t1.setW(800);
  const s0=D.scans.n; mo.cb([{target:{closest:()=>null},addedNodes:[{nodeType:3}]}]); await sleep(200);
  assert.equal(on(t1),false,'시계 같은 글자 바뀜엔 안 잰다'); assert.equal(D.scans.n,s0,'표를 훑지도 않는다');
  mo.cb([{target:{closest:q=>q==='table'?t1:null},addedNodes:[]}]); await sleep(200); assert.equal(on(t1),true,'표 안을 다시 그리면 그 표를 잰다');
  const t2=D.mkTable(900), r1=t1.reads;
  mo.cb([{target:{closest:()=>null},addedNodes:[{nodeType:1,tagName:'DIV',querySelector:q=>q==='table'?t2:null}]}]); await sleep(200);
  assert.equal(on(t2),true,'표가 든 덩어리가 들어오면 새 표를 잰다'); assert.equal(t1.reads,r1,'그대로인 표는 안 잰다');
  const t3=D.mkTable(900,false); F.scan(); assert.equal(on(t3),false,'숨은 표는 안 잰다'); t3.show(true);
  const click=D.L.doc.find(l=>l.ev==='click'); assert(click&&click.capture,'누름은 붙잡기 단계(탭 함수가 전파를 막아도)');
  click.f({}); await sleep(200); assert.equal(on(t3),true,'탭을 눌러 보이게 된 표를 잰다');
  t1.setW(200); const rs=D.L.win.find(l=>l.ev==='resize');
  const s1=D.scans.n; rs.f(); await sleep(260); assert.equal(on(t1),true,'폭이 그대로면(주소창 접힘) 안 잰다'); assert.equal(D.scans.n,s1,'훑지도 않는다(폰은 스크롤만 해도 resize 가 온다)');
  D.win.innerWidth=360; rs.f(); await sleep(260); assert.equal(on(t1),false,'폭이 바뀌면 다시 잰다');
  t2.setW(300); const ld=D.L.win.find(l=>l.ev==='load'); ld.f(); await sleep(60); assert.equal(on(t2),false,'다 읽힌 뒤(글꼴·그림) 전부 다시 잰다');
});
/* 작은 CSS 우선순위 계산기 — 브라우저 없이(CI 는 node 뿐) '이 요소의 이 속성이 실제로 어떤 값이 되나'를 본다.
   중요도(!important) → 구체성(id·class·tag) → 나중 규칙 순. @media 는 max/min-width 만(그 밖 조건은 안 맞음으로 본다). */
function cssRules(src,origin){
  src=src.replace(/\/\*[\s\S]*?\*\//g,''); const out=[];
  (function walk(text,media){ let i=0;
    while(i<text.length){ const ob=text.indexOf('{',i); if(ob<0) break; const head=text.slice(i,ob).trim(); let d=0,k=ob;
      for(;k<text.length;k++){ if(text[k]==='{') d++; else if(text[k]==='}'&&!--d) break; }
      const body=text.slice(ob+1,k);
      if(/^@media/.test(head)) walk(body,head.slice(6).trim()); else if(!/^@/.test(head)) out.push({sel:head,body,media,origin});
      i=k+1; } })(src,null);
  return out;
}
function mediaOk(m,W){ if(!m) return true; return m.split(',').some(q=>{ if(/print/.test(q)) return false; const fs=q.match(/\([^)]*\)/g)||[];
  return fs.every(f=>{ let x; if((x=/max-width:\s*(\d+)px/.exec(f))) return W<=+x[1]; if((x=/min-width:\s*(\d+)px/.exec(f))) return W>=+x[1]; return false; }); }); }
function compound(c,el){ if(/[:\[]/.test(c)) return false; const tag=(c.match(/^[a-z][\w-]*/i)||[''])[0];
  if(tag&&tag!=='*'&&tag.toLowerCase()!==el.tag) return false;
  return (c.match(/#[\w-]+/g)||[]).every(x=>el.id===x.slice(1)) && (c.match(/\.[\w-]+/g)||[]).every(x=>el.cls.includes(x.slice(1))); }
function selMatch(sel,chain){            // chain: 뿌리 → 대상
  const parts=sel.replace(/\s*>\s*/g,' > ').trim().split(/\s+/);
  const go=(pi,ci)=>{ if(pi<0) return true; const comb=parts[pi-1]==='>'; const c=parts[pi];
    if(!compound(c,chain[ci])) return false; const next=comb?pi-2:pi-1; if(next<0) return true;
    if(comb) return ci>0&&go(next,ci-1); for(let j=ci-1;j>=0;j--) if(go(next,j)) return true; return false; };
  return go(parts.length-1,chain.length-1);
}
function specOf(sel){ const ids=(sel.match(/#[\w-]+/g)||[]).length, cls=(sel.match(/\.[\w-]+/g)||[]).length;
  const tags=(sel.replace(/[#.][\w-]+/g,' ').replace(/>/g,' ').match(/[a-z][\w-]*/gi)||[]).length; return ids*1e4+cls*100+tags; }
function computed(rules,chain,prop,W){
  let best=null;
  rules.forEach((r,order)=>{ if(!mediaOk(r.media,W)) return;
    r.sel.split(',').map(x=>x.trim()).filter(x=>selMatch(x,chain)).forEach(sel=>{
      r.body.split(';').forEach(d=>{ const i=d.indexOf(':'); if(i<0) return; let p=d.slice(0,i).trim(), v=d.slice(i+1).trim();
        const imp=/!important$/.test(v); v=v.replace(/\s*!important$/,'');
        const props=p==='overflow'?['overflow-x','overflow-y']:[p]; if(!props.includes(prop)) return;
        const key=[imp?1:0,specOf(sel),order]; const better=!best||key[0]>best.key[0]||(key[0]===best.key[0]&&(key[1]>best.key[1]||(key[1]===best.key[1]&&key[2]>=best.key[2])));
        if(better) best={key,v,sel,origin:r.origin}; }); }); });
  return best;
}
t('U10 /paper 페이지 상자 — 휴대폰에서 높이 제한 없이 표 전체를 담는다(공용 모바일 CSS 의 모달 높이 제한이 이기지 않는다)',()=>{
  const mob=fs.readFileSync(path.join(ROOT,'jk-mobile.css'),'utf8');
  const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  assert(html.indexOf('<link rel="stylesheet" href="/jk-mobile.css')>html.indexOf('<style>'),'공용 CSS 가 페이지 CSS 뒤에 온다(같은 무게면 공용이 이긴다)');
  const rules=[...cssRules(styles,'index'),...cssRules(mob,'jk-mobile')];
  const E=(tag,id,cls)=>({tag,id:id||'',cls:cls||[]});
  const chain=[E('html'),E('body','',['paperpage']),E('div','paperModal',['modal','on']),E('div','',['box'])];   // #446: 상자를 옮기지 않고 body 바로 아래 그대로 페이지로 쓴다
  const v=(prop,W)=>{ const b=computed(rules,chain,prop,W); return b&&b.v; };
  for(const W of [340,375,414,768]){
    assert.equal(v('max-height',W),'none',`${W}px max-height — 796px 같은 화면 높이로 묶이면 표가 상자 밖으로 흘러 하단 안내문을 덮는다`);
    assert.equal(v('overflow-y',W),'visible',`${W}px overflow-y`);
    assert.equal(v('max-width',W),'none',`${W}px max-width`);
  }
  assert.equal(v('padding',375),'12px 8px','폰 폭 여백은 페이지 값(표 칸을 넓게 — U4 폭 계산 근거)');
  assert.equal(v('max-height',1280),'none','넓은 화면도');
  const modal=[E('html'),E('body'),E('div','paperModal',['modal','on']),E('div','',['box'])];   // 운영 화면의 모달은 그대로 화면 높이 제한
  assert.equal(computed(rules,modal,'max-height',375).v,'calc(100dvh - 16px)','모달일 땐 공용 제한 그대로');
  assert.equal(computed(rules,modal,'overflow-y',375).v,'auto','모달은 안에서 스크롤');
});
t('U11 운영 화면 기록 표 — 휴대폰(≤560px)에선 최소 폭(590·440px)을 풀어 짧은 표는 한 화면에 · 숫자 칸은 줄바꿈 안 함(금액이 두 줄로 안 끊김)',()=>{
  const mob=fs.readFileSync(path.join(ROOT,'jk-mobile.css'),'utf8');
  const styles=[...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
  const rules=[...cssRules(styles,'index'),...cssRules(mob,'jk-mobile')];
  const E=(tag,id,cls)=>({tag,id:id||'',cls:cls||[]});
  const base=[E('html'),E('body'),E('div','',['wrap']),E('section','vr'),E('div','vr-anal',['block']),E('div','',['card'])];
  const cyc=[...base,E('div','',['cyc-scroll']),E('table','cyc_tbl',['cyctbl'])], cycTd=[...cyc,E('tbody'),E('tr'),E('td')];
  const ht=[...base,E('div','',['htable-wrap']),E('table','inf_table',['htable'])], htTd=[...ht,E('tbody'),E('tr'),E('td')];
  const v=(c,p,W)=>{ const b=computed(rules,c,p,W); return b&&b.v; };
  assert.deepEqual([v(ht,'min-width',375),v(cyc,'min-width',375)],['0','0'],'폰 폭에선 최소 폭 해제');
  assert.deepEqual([v(ht,'min-width',1024),v(cyc,'min-width',1024)],['590px','440px'],'넓은 화면은 그대로');
  for(const W of [340,375,560,1024]) assert.equal(v(cycTd,'white-space',W),'nowrap',`${W}px 사이클 표 숫자 칸 — '167,273 / .50$' 로 끊기지 않게`);
});
Promise.all(PENDING).then(()=>{
  console.log(results.join('\n'));
  console.log(failed?`\n${failed} FAIL`:'\nALL PASS');
  process.exitCode=failed?1:0;
});
