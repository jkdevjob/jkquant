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
  ['plan.html','.top','.plan-tabs'],['backtest.html','.top','.stabs-sticky'],
  ['scalping.html','header','.strategy-tabs'],['claude.html','header','.tabs'],
  ['ipo.html','header','#ipoWrap>.subnav'],['realestate.html','header','.tabs'],
  ['job.html','header','.tabs'],['settings.html','header','.tabs'],['admin.html','header','#nav']
];
function declarations(src,selector){
  const rule=src.match(new RegExp('(?:^|\\n)'+selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\{([^}]+)\\}'));
  assert(rule,selector+' CSS');
  return Object.fromEntries(rule[1].split(';').filter(Boolean).map(s=>{const i=s.indexOf(':');return [s.slice(0,i).trim(),s.slice(i+1).trim()];}));
}
function dom(route,width){
  const values={},observed=[],events={},frames=[];
  const el=(tag,cls,id,h)=>({tagName:tag.toUpperCase(),id:id||'',_classes:new Set(cls.split(' ').filter(Boolean)),_height:h,
    classList:{add(c){this.owner._classes.add(c);},contains(c){return this.owner._classes.has(c);}},
    getBoundingClientRect(){return {height:this._height};},contains(x){return x===this;}});
  const header=el(route[1]==='header'?'header':'div',route[1]==='.top'?'top':'','',width<600?96:72);
  const tabs=el('div',route[2].startsWith('.')?route[2].slice(1):route[2]==='#nav'?'nav':'subnav',route[2]==='#nav'?'nav':'',width<600?88:52);
  const body=el('body','','',0),sess=route[0]==='index.html'?el('div','sessbar','sessbar',38):null,status=sess?el('div','statusline','statusline',24):null;
  [header,tabs,body,sess,status].filter(Boolean).forEach(e=>e.classList.owner=e);
  if(route[3]==='/paper'){tabs._height=0;sess._height=0;status._height=0;}
  const menu={closest:s=>s===route[1]?header:null};
  const document={readyState:'loading',body,documentElement:{style:{setProperty:(k,v)=>values[k]=v}},
    querySelector(s){return s==='.jkmenu'?menu:s.split(',').includes(route[2])?tabs:null;},
    getElementById:id=>id==='sessbar'?sess:id==='statusline'?status:null,
    addEventListener:(n,f)=>(events[n]||=[]).push(f)};
  class RO{constructor(f){this.callback=f;}observe(e){observed.push(e);}}
  const win={ResizeObserver:RO,requestAnimationFrame:f=>{frames.push(f);return frames.length;},addEventListener:(n,f)=>(events[n]||=[]).push(f)};
  const context={window:win,document};
  return {context,header,tabs,sess,status,body,values,observed,events,frames,run(src=code){vm.runInNewContext(src,context);},flush(){while(frames.length)frames.shift()();}};
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
for(const route of routes)for(const width of [340,390,768,1280]){
  verify(route,width);console.log('PASS sticky '+(route[3]||route[0])+' '+width+'px');
}
for(const [name,mutCode,mutCss] of [
  ['body hidden 복귀',code,css.replace('body{max-width:100%;min-width:0;overflow-x:clip}','body{max-width:100%;min-width:0;overflow-x:hidden}')],
  ['헤더 높이 0으로 고정',code.replace("height(header)+'px'","0+'px'"),css],
  ['탭 고정 제거',code.replace("'jk-sticky-tabs'","'jk-no-sticky-tabs'"),css]
]){
  assert.throws(()=>verify(routes[0],390,mutCode,mutCss),assert.AssertionError,name+'를 검사에서 잡는다');
  console.log('PASS mutation '+name);
}
console.log('ALL PASS sticky: 11 routes × 4 widths, 3 mutations');
