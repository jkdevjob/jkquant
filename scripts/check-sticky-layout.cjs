'use strict';
// 실제 공용 JS를 DOM에서 실행해 헤더/탭의 상태·높이·재측정을 확인한다. 외부 계정/자료는 쓰지 않는다.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(root,'jk-ui.js'),'utf8');
const css=fs.readFileSync(path.join(root,'jk-mobile.css'),'utf8');
const start=ui.indexOf('/* 상단 메뉴·탭 고정'),end=ui.indexOf('/* JK 투자 공용 로그인·전체메뉴 UI',start);
assert(start>=0&&end>start,'공용 고정 코드');
const code=ui.slice(start,end);
const routes=[
  ['index.html','header','.tabs'],['index.html','header','.tabs','/paper'],
  ['backtest.html','.top','.stabs-sticky'],   // 듀얼가드(plan.html)는 2026-11-09 클로드/지피티 탭을 없애 고정 탭 줄이 없다
  ['scalping.html','header','.strategy-tabs'],['claude.html','header','.tabs'],
  ['ipo.html','header','#ipoWrap>.subnav'],['realestate.html','header','.tabs'],
  ['job.html','header','.tabs'],['settings.html','header','.tabs'],['admin.html','header','#nav'],
  ['tenbagger.html','header','.tabs']
];
function declarations(src,selector){
  const rule=src.match(new RegExp('(?:^|\\n)'+selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]+)\\}'));
  assert(rule,selector+' CSS');
  return Object.fromEntries(rule[1].split(';').filter(Boolean).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}));
}
function dom(route,width){
  const values={},observed=[],events={},frames=[],microtasks=[];
  const el=(tag,cls,id,h)=>({tagName:tag.toUpperCase(),id:id||'',_classes:new Set(cls.split(' ').filter(Boolean)),_height:h,
    classList:{add(c){this.owner._classes.add(c);},contains(c){return this.owner._classes.has(c);}},
    getBoundingClientRect(){return {height:this._height};},contains(x){return x===this;}});
  const header=el(route[1]==='header'?'header':'div',route[1]==='.top'?'top':'','',width<600?96:72);
  const tabs=el('div',route[2].startsWith('.')?route[2].slice(1):route[2]==='#nav'?'nav':'subnav',route[2]==='#nav'?'nav':'',width<600?88:52);
  const body=el('body','','',0),sess=route[0]==='index.html'?el('div','sessbar','sessbar',38):null,status=sess?el('div','statusline','statusline',24):null;
  [header,tabs,body,sess,status].filter(Boolean).forEach(e=>e.classList.owner=e);
  if(route[3]==='/paper'){tabs._height=0;sess._height=0;status._height=0;}
  let shell=route[1]==='header'?header:null;
  const menu={closest:s=>s==='header'?shell:s==='.top'&&route[1]==='.top'?header:null};
  const document={readyState:'loading',body,documentElement:{style:{setProperty:(k,v)=>values[k]=v}},
    querySelector(s){return s==='.jkmenu'?menu:s.split(',').includes(route[2])?tabs:null;},
    getElementById:id=>id==='sessbar'?sess:id==='statusline'?status:null,
    addEventListener:(n,f)=>(events[n]||=[]).push(f)};
  class RO{constructor(f){this.callback=f;}observe(e){observed.push(e);}}
  const win={ResizeObserver:RO,requestAnimationFrame:f=>{frames.push(f);return frames.length;},addEventListener:(n,f)=>(events[n]||=[]).push(f)};
  const context={window:win,document,Promise:{resolve:()=>({then:f=>microtasks.push(f)})}};
  return {context,header,tabs,sess,status,body,values,observed,events,frames,microtasks,
    normalizeHeader(){
      if(!shell){shell=el('header','jk-site-header','',header._height+1);shell.classList.owner=shell;}
      return shell;
    },
    run(src=code){vm.runInNewContext(src,context);},flush(){while(frames.length)frames.shift()();},
    flushMicrotasks(){while(microtasks.length)microtasks.shift()();}};
}
function verify(route,width,src=code,styles=css){
  const html=fs.readFileSync(path.join(root,route[0]),'utf8');
  assert(html.includes('class="jkmenu'),'공용 메뉴 '+route[0]);
  assert(route[1]==='header'?html.includes('<header>'):html.includes('class="top"'),'헤더 '+route[0]);
  const tabToken=route[2]==='#nav'?'id="nav"':route[2]==='#ipoWrap>.subnav'?'class="subnav"':'class="'+route[2].slice(1)+'"';
  assert(html.includes(tabToken),'탭 '+route[0]);
  for(const sel of ['html','body'])assert.equal(declarations(styles,sel)['overflow-x'],'clip',sel+'는 스크롤 컨테이너를 만들지 않는다');
  assert.equal(declarations(styles,'main')['overflow-x'],'clip','모바일 main도 스크롤 컨테이너를 만들지 않는다');
  const D=dom(route,width);D.run(src);assert(!D.header._classes.has('jk-sticky-header'),'DOM 준비 전에는 기다린다');
  D.events.DOMContentLoaded.forEach(f=>f());
  assert(D.header._classes.has('jk-sticky-header'),'메뉴가 든 헤더 고정');
  assert(D.tabs._classes.has(route[2]==='#nav'?'jk-sticky-side':'jk-sticky-tabs'),'탭 고정');
  assert.equal(D.values['--jk-header-height'],D.header._height+'px','탭 시작점은 실측 헤더 높이');
  const headStyle=declarations(styles,'.jk-sticky-header'),tabStyle=declarations(styles,'.jk-sticky-tabs');
  assert.equal(headStyle.position,'sticky!important');assert.equal(headStyle.top,'0!important');
  assert.equal(tabStyle.position,'sticky!important');assert.equal(tabStyle.top,'var(--jk-header-height,0px)!important');
  assert(Number.parseInt(headStyle['z-index'])>Number.parseInt(tabStyle['z-index']),'메뉴 펼침이 탭보다 위');
  assert(Number.parseInt(headStyle['z-index'])<100,'기존 모달보다 아래');
  assert.equal(D.observed.filter(e=>e===D.header).length,1,'헤더 높이 감시');
  assert.equal(D.observed.filter(e=>e===D.tabs).length,1,'탭 줄바꿈 감시');
  if(D.sess){
    assert(D.body._classes.has('jk-sticky-stack'));
    assert.equal(D.values['--h1'],D.tabs._height+'px');
    assert.equal(D.values['--h2'],D.tabs._height+D.sess._height+'px');
    assert.equal(D.values['--h3'],D.tabs._height+D.sess._height+D.status._height+'px');
    for(const [sel,key] of [['.sessbar','--h1'],['.statusline','--h2'],['.subnav','--h3']]){
      const value=declarations(styles,'.jk-sticky-stack '+sel).top;
      assert(value.includes('--jk-header-height')&&value.includes(key),'운영 '+sel+'는 헤더 아래에 계단식 고정');
    }
  }
  // 로그인 배지/가로회전으로 헤더가 커졌을 때 + 연속 resize도 한 프레임에서 처리.
  D.header._height+=27;D.tabs._height+=18;
  D.events.resize[0]();D.events.resize[0]();assert.equal(D.frames.length,1,'resize 묶음');D.flush();
  assert.equal(D.values['--jk-header-height'],D.header._height+'px','변경된 헤더 높이 반영');
  if(D.sess)assert.equal(D.values['--h1'],D.tabs._height+'px','탭 줄바꿈 반영');
  D.context.window.JKSticky.mount();D.run(src);
  assert.equal(D.observed.filter(e=>e===D.header).length,1,'중복 로딩/마운트에도 감시는 하나');
}
// The production <script defer> runs at interactive, before DOMContentLoaded.
// Plan/backtest start with a .top row; the later unified UI moves it into a new
// backdrop-filter header. Sticky must attach to that outer stacking context.
function verifyReadyHeader(route,width,state,src=code){
  const D=dom(route,width);D.context.document.readyState=state;D.run(src);
  const shell=D.normalizeHeader();
  if(state==='loading')D.events.DOMContentLoaded.forEach(f=>f());else D.flushMicrotasks();
  assert(shell._classes.has('jk-sticky-header'),'통합된 바깥 헤더에 고정 레이어: '+state+' '+route[0]);
  if(route[1]==='.top')assert(!D.header._classes.has('jk-sticky-header'),'이동 전 내부 행에 고정 레이어를 남기지 않는다');
  assert.equal(D.values['--jk-header-height'],shell._height+'px','바깥 헤더의 테두리까지 포함한 높이');
  assert.equal(D.observed.filter(e=>e===shell).length,1,'바깥 헤더를 감시');
  assert(D.tabs._classes.has(route[2]==='#nav'?'jk-sticky-side':'jk-sticky-tabs'),'초기화 뒤 탭 고정');
  shell._height+=27;D.events.resize[0]();D.flush();
  assert.equal(D.values['--jk-header-height'],shell._height+'px','바깥 헤더 높이 변경을 반영');
  D.context.window.JKSticky.mount();D.run(src);D.flushMicrotasks();
  assert.equal(D.observed.filter(e=>e===shell).length,1,'준비된 DOM에서도 중복 감시 없음');
}
for(const route of routes)for(const width of [340,390,768,1280]){
  verify(route,width);console.log('PASS sticky '+(route[3]||route[0])+' '+width+'px');
  for(const state of ['loading','interactive','complete'])verifyReadyHeader(route,width,state);
}
for(const [name,mutCode,mutCss] of [
  ['body hidden 복귀',code,css.replace('body{max-width:100%;min-width:0;overflow-x:clip}','body{max-width:100%;min-width:0;overflow-x:hidden}')],
  ['헤더 높이 0으로 고정',code.replace("height(header)+'px'","0+'px'"),css],
  ['탭 고정 제거',code.replace("'jk-sticky-tabs'","'jk-no-sticky-tabs'"),css]
]){
  assert.throws(()=>verify(routes[0],390,mutCode,mutCss),assert.AssertionError,name+'를 검사에서 잡는다');
  console.log('PASS mutation '+name);
}
const immediate=code.replace('else Promise.resolve().then(mount);','else mount();');
assert.notEqual(immediate,code,'defer 초기화 변이가 실제 소스를 변경한다');
const topRoutes=routes.filter(r=>r[1]==='.top');   // 머리말을 옮겨 붙이는 화면(.top) — 듀얼가드(plan.html)는 탭 줄이 없어져(2026-11-09) 백테만 남았다
assert(topRoutes.length>=1,'.top 화면이 하나는 있어야 defer 변이를 잰다');
for(const route of topRoutes){
  assert.throws(()=>verifyReadyHeader(route,390,'interactive',immediate),assert.AssertionError,'이동 전 행을 잡는 옛 defer 동작을 검사에서 잡는다');
}
console.log('PASS mutation defer 초기화 즉시 실행 복귀 ('+topRoutes.map(r=>r[0].replace('.html','')).join('/')+')');
// ── 위쪽 안전 영역 — 아이폰 홈 화면 앱은 상태 표시줄 밑까지 그린다. 머리말이 그 밑에 깔리면 三 메뉴가 안 눌린다(2026-11-10 신고).
//    브라우저 실측(402×874 · 위 59px): 고치기 전 단추 13~57px(상태 표시줄 밑) → 고친 뒤 72~116px · 펼침 127px · 안전 영역 0이면 13~57 · 68 그대로.
function verifySafeArea(uiSrc=ui,styles=css){
  const head=declarations(styles,'.jk-sticky-header');
  assert.equal(head['border-top'],'env(safe-area-inset-top,0px) solid var(--bg,#0f1320)!important','머리말을 위쪽 안전 영역만큼 내린다');
  const pop=uiSrc.match(/@media\(max-width:600px\)\{\.jkmenu-pop\{([^}]+)\}/);
  assert(pop,'좁은 화면 메뉴 펼침 규칙');
  const P=Object.fromEntries(pop[1].split(';').filter(Boolean).map(x=>{const i=x.indexOf(':');return [x.slice(0,i),x.slice(i+1)];}));
  assert(!('position' in P),'메뉴 펼침은 三 단추에 매단다 — 화면 고정이면 내려온 머리말과 어긋난다');
  assert(/\.jkmenu\{position:relative!important/.test(uiSrc)&&/\.jkmenu-pop\{position:absolute!important/.test(uiSrc),'매달 기준(.jkmenu) · 기본 absolute');
  assert.equal(P.top,'55px!important');assert.equal(P.right,'0!important');
  assert.equal(P['max-height'],'calc(100dvh - 84px - env(safe-area-inset-top,0px))!important','펼침 높이도 안전 영역만큼 줄인다');
  const box=styles.match(/\.modal-card,\.modal \.box,#chartCard\{[^}]*max-height:([^;}]+)/);
  assert(box&&box[1]==='calc(100dvh - 16px - 2*env(safe-area-inset-top,0px))!important','가운데 뜨는 창의 위쪽도 상태 표시줄 아래');
}
verifySafeArea();console.log('PASS safe-area 머리말 · 메뉴 펼침 · 창 높이');
const SA_MUT=[
  ['머리말 안전 영역 제거',ui,css.replace(';border-top:env(safe-area-inset-top,0px) solid var(--bg,#0f1320)!important','')],
  ['메뉴 펼침 화면 고정 복귀',ui.replace('{.jkmenu-pop{right:0!important;top:55px!important;','{.jkmenu-pop{position:fixed!important;right:12px!important;top:68px!important;'),css],
  ['펼침 높이 안전 영역 제거',ui.replace('calc(100dvh - 84px - env(safe-area-inset-top,0px))','calc(100dvh - 84px)'),css],
  ['창 높이 안전 영역 제거',ui,css.replace('calc(100dvh - 16px - 2*env(safe-area-inset-top,0px))','calc(100dvh - 16px)')]
];
for(const [name,mutUi,mutCss] of SA_MUT){
  assert(mutUi!==ui||mutCss!==css,name+' 변이가 실제 소스를 바꾼다');
  assert.throws(()=>verifySafeArea(mutUi,mutCss),assert.AssertionError,name+'를 검사에서 잡는다');
  console.log('PASS mutation '+name);
}
console.log('ALL PASS sticky: '+routes.length+' routes × 4 widths; 144 unified header lifecycle cases; '+(4+SA_MUT.length)+' mutations');
