#!/usr/bin/env node
'use strict';
/* 메뉴 이름 바꾸기 (index v3.133.0 · admin v0.14.0 · 2026-11-11)
 * 사용자: "관리자 메뉴관리에서 메뉴 이름도 변경 가능하게 하자"
 * 실제 jk-access.js · admin.html 함수를 그대로 돌린다(재구현 없음). 값 시험 + 변이(틀린 코드로 바꾸면 빨간불).
 *   L1 이름 정리(cleanMenuLabel) — 앞뒤 빈칸 · 빈칸 하나로 · 제어·보이지 않는 문자 지움 · 20자(그림 글자 하나 = 1자)
 *   L2 설정 정리(normalizeMenuConfig) — 바꾼 이름만 남김(비었거나 기본 이름과 같으면 없음) · 공개범위·순서는 그대로
 *   L3 보일 이름(menuLabel) — 바꾼 이름 · 없으면 기본 · 주소 표기(.html · 끝 /)도 같은 메뉴
 *   L4 적용(applyMenuConfig → 링크) — 아이콘은 그대로 글자만 · 이름을 지우면 페이지 기본 글자로 · 마크업 글자는 글자로(요소 안 생김) ·
 *      바꾼 이름이 없으면 링크를 건드리지 않음 · 가짜 링크(글자 없음)도 깨지지 않음
 *   L5 관리자 화면 — 저장 문서에 바꾼 이름만 · 이름 칸(값·기본 이름 안내·글자 그대로) · 바꾸기/지우기 · 되돌리기는 이름 그대로 · 불러오기·미리보기 배선
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={acc:rd('jk-access.js'),admin:rd('admin.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const ADM={uid:'a1',email:'jk82investing@gmail.com'};

/* 작은 DOM — 글자 노드 · 요소 · childNodes · querySelector(.클래스) · textContent(쓰면 자식 하나의 글자 노드) */
function txt(s){ return {nodeType:3,textContent:s}; }
function elem(tag,cls){
  const e={nodeType:1,tagName:tag,childNodes:[],attrs:{},_cls:new Set(cls?[cls]:[]),
    get className(){return [...this._cls].join(' ');}, set className(v){this._cls=new Set(String(v).split(/\s+/).filter(Boolean));},
    classList:null,
    getAttribute(k){return k in this.attrs?this.attrs[k]:null;}, setAttribute(k,v){this.attrs[k]=String(v);},
    appendChild(n){const i=this.childNodes.indexOf(n);if(i>=0)this.childNodes.splice(i,1);this.childNodes.push(n);return n;},
    removeChild(n){const i=this.childNodes.indexOf(n);if(i>=0)this.childNodes.splice(i,1);return n;},
    get textContent(){return this.childNodes.map(n=>n.textContent).join('');},
    set textContent(v){this.childNodes=[txt(String(v))];},
    querySelector(q){ const c=q.replace(/^\./,''); const walk=n=>{ for(const k of n.childNodes){ if(k.nodeType===1&&k._cls.has(c)) return k; const r=k.nodeType===1&&walk(k); if(r) return r; } return null; }; return walk(this); },
    querySelectorAll(q){ return q==='a[href]'?this.childNodes.filter(n=>n.tagName==='a'):[]; }};
  e.classList={toggle:(x,on)=>{ if(on===undefined) on=!e._cls.has(x); on?e._cls.add(x):e._cls.delete(x); },contains:x=>e._cls.has(x),add:x=>e._cls.add(x),remove:x=>e._cls.delete(x)};
  return e;
}
/* 페이지 메뉴 링크 — <a href="/job"><span class="mi">💼</span>JOB</a> 과 같은 모양 */
function link(href,icon,label){ const a=elem('a'); a.attrs.href=href; const mi=elem('span','mi'); mi.childNodes=[txt(icon)]; a.childNodes=[mi,txt(label)]; return a; }
function load(acc,links,extra){
  const html=new Set(), pop=elem('div','jkmenu-pop'); pop.hidden=true; links.forEach(a=>pop.appendChild(a)); (extra||[]).forEach(a=>pop.appendChild(a));
  const document={documentElement:{classList:{add:x=>html.add(x),remove:x=>html.delete(x),toggle(){},contains:x=>html.has(x)}},
    head:{appendChild:n=>n}, body:null, createElement:t=>elem(t),
    getElementById:()=>null, querySelectorAll:q=>q==='.jkmenu-pop'?[pop]:[], currentScript:null, addEventListener(){}};
  const ctx={document,console:{warn(){},error(){},log(){}},setTimeout:(f,ms)=>ms>=6000?0:setTimeout(f,ms),clearTimeout,URL,location:{origin:'https://jkquant.pages.dev',pathname:'/job'}};
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(acc,ctx);
  return {A:ctx.JKAccess,pop};
}
const mkFb=data=>({db:{},doc:(db,c,id)=>c+'/'+id,getDoc:async()=>({exists:()=>true,data:()=>data})});
const label=a=>a.childNodes.filter(n=>!(n.nodeType===1&&n._cls.has('mi'))).map(n=>n.textContent).join('');

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const {A}=load(S.acc,[]);
  // ── L1 이름 정리
  { const c=A.cleanMenuLabel;
    t('L1 앞뒤 빈칸·빈칸 여럿·줄바꿈·탭 → 빈칸 하나',c('  채용 \n\t 공고  ')==='채용 공고',JSON.stringify(c('  채용 \n\t 공고  ')));
    t('L1 제어 문자·보이지 않는 문자(폭 0 · 방향 · BOM) 지움',c('채\u0000용​‮﻿')==='채용',JSON.stringify(c('채\u0000용​‮﻿')));
    t('L1 20자까지(그림 글자 하나 = 1자) · 비면 빈 글자 · null 도 빈 글자',c('가'.repeat(25)).length===20&&Array.from(c('🎯'.repeat(25))).length===20&&c('   ')===''&&c(null)==='',c('가'.repeat(25)).length); }
  // ── L2 설정 정리
  { const n=A.normalizeMenuConfig({items:{'/job':{mode:'hidden',order:5,label:'  채용 공고 '},'/ipo':{mode:'public',order:70,label:'공모주'},'/paper':{label:'   '},'/realestate':{label:42},'/nope':{label:'x'}}});
    t('L2 바꾼 이름만 남긴다 — 정리된 글자 · 공개범위·순서 그대로',n.items['/job'].label==='채용 공고'&&n.items['/job'].mode==='hidden'&&n.items['/job'].order===5,JSON.stringify(n.items['/job']));
    t('L2 기본 이름과 같거나(공모주) 빈 이름은 없음 · 숫자는 글자로 · 모르는 주소는 버림',!('label' in n.items['/ipo'])&&!('label' in n.items['/paper'])&&n.items['/realestate'].label==='42'&&!n.items['/nope'],JSON.stringify([n.items['/ipo'],n.items['/paper'],n.items['/realestate']]));
    t('L2 기본값에는 이름이 없다',Object.values(A.menuDefaults().items).every(v=>!('label' in v))); }
  // ── L3 보일 이름
  { const cfg=A.normalizeMenuConfig({items:{'/job':{label:'채용'}}});
    t('L3 바꾼 이름 · 없으면 기본 · /job.html · /job/ 도 같은 메뉴 · 모르는 주소는 빈 글자',A.menuLabel(cfg,'/job')==='채용'&&A.menuLabel(cfg,'/job.html')==='채용'&&A.menuLabel(cfg,'/job/')==='채용'&&A.menuLabel(cfg,'/ipo')==='공모주'&&A.menuLabel(cfg,'/zzz')===''); }
  // ── L4 적용
  { const J=link('/job','💼','JOB'), I=link('/ipo','🎯','공모주'), X=link('/realestate','🏢','부동산');
    const fake={getAttribute:k=>k==='href'?'/paper':null,classList:{toggle(){},contains:()=>false}};   // 글자 없는 가짜 링크(다른 시험이 쓰는 모양)
    const {A:B,pop}=load(S.acc,[J,I,X],[]); pop.childNodes.push(fake);
    let threw='';
    try{ await B.applyMenuConfig(ADM,mkFb({items:{'/job':{mode:'public',order:80,label:'채용 공고'},'/realestate':{mode:'public',order:75,label:'<b>집</b>'},'/paper':{label:'모의 성과'}}}),{force:true}); }catch(e){ threw=e.message; }
    t('L4 이름 바꾼 링크 — 아이콘 그대로 · 글자만 · 바꾼 글자는 jk-menu-label 칸 하나',!threw&&J.childNodes[0]._cls.has('mi')&&J.childNodes[0].textContent==='💼'&&label(J)==='채용 공고'
      &&J.childNodes.length===2&&J.childNodes[1]._cls.has('jk-menu-label')&&J.childNodes[1].getAttribute('data-default')==='JOB',threw||JSON.stringify(J.childNodes.map(n=>n.textContent)));
    t('L4 마크업 글자는 글자 그대로(요소가 생기지 않음)',label(X)==='<b>집</b>'&&X.childNodes[1].childNodes.every(n=>n.nodeType===3),JSON.stringify(X.childNodes[1].childNodes));
    t('L4 바꾼 이름이 없는 링크는 건드리지 않는다(DOM 그대로)',I.childNodes.length===2&&I.childNodes[1].nodeType===3&&label(I)==='공모주');
    t('L4 글자 없는 가짜 링크가 섞여도 깨지지 않는다',!threw,threw);
    await B.applyMenuConfig(ADM,mkFb({items:{'/job':{mode:'public',order:80}}}),{force:true});
    t('L4 이름을 지우면 페이지 기본 글자(JOB)로 돌아간다 · 아이콘 그대로',label(J)==='JOB'&&J.childNodes[0].textContent==='💼'&&label(X)==='부동산',JSON.stringify([label(J),label(X)]));
    B.applyMenuLabels({items:{'/job':{label:' 일자리​ '}}});
    t('L4 미리보기(applyMenuLabels)도 같은 정리 규칙',label(J)==='일자리',label(J)); }
  // ── L5 관리자 화면
  { const fns=['function menuNameClean(v)','function menuDraftConfig()','function menuLabelChange(path,value)','function resetMenus()','function paintMenus()','function menuModeOptions(r)'];
    const consts=['MENU_ICONS','MENU_HARD_ADMIN'].map(k=>(S.admin.match(new RegExp('const '+k+'=[^\\n]*'))||[''])[0].replace('const ','var ')).join('\n');
    const body={innerHTML:'',contains:()=>true,querySelectorAll:()=>[]};
    const c={window:{JKAccess:A},JKAccess:A,me:{email:'JK82investing@gmail.com'},normEmail:e=>String(e||'').trim().toLowerCase(),
      esc:t=>String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
      $:id=>id==='menuBody'?body:null,document:{activeElement:null},
      menuBase:()=>[{path:'/',label:'운영',mode:'public',order:10},{path:'/job',label:'JOB',mode:'public',order:80},{path:'/admin',label:'관리자',mode:'admin',order:90}],
      subDraftFrom:()=>({}),subBlockHtml:()=>'',saves:0,Date,Set,Object};
    vm.createContext(c);
    vm.runInContext(consts+'\nvar menuDraft=[{path:"/",label:"운영",mode:"public",order:10,name:""},{path:"/job",label:"JOB",mode:"public",order:80,name:"채용"},{path:"/admin",label:"관리자",mode:"admin",order:90}],subDraft={};\nfunction queueMenuSave(){saves++;}\n'+fns.map(m=>fnOf(S.admin,m)).join('\n'),c);
    const op=()=>vm.runInContext('menuDraftConfig()',c), d0=op();
    t('L5 저장 문서 — 바꾼 이름만(items./job.label 채용) · 이름 없는 메뉴(운영·관리자)는 label 없음 · 공개범위·순서 그대로',d0.items['/job'].label==='채용'&&!('label' in d0.items['/'])&&!('label' in d0.items['/admin'])&&d0.items['/job'].mode==='public'&&d0.items['/job'].order===20,JSON.stringify(d0.items));
    vm.runInContext("paintMenus()",c); const h=body.innerHTML;
    t('L5 이름 칸 — 바꾼 이름이 값 · 기본 이름이 안내 글자 · 20자 · 기본 이름 표시 · ↺ 는 바꾼 메뉴에만',
      /<input class="menu-label-in" type="text" maxlength="20" data-path="\/job" value="채용" placeholder="JOB"/.test(h)&&/value="" placeholder="운영"/.test(h)&&h.includes('· 기본 이름 JOB')
      &&(h.match(/class="menu-label-reset"/g)||[]).length===1&&/onchange="menuLabelChange\('\/job',this\.value\)"/.test(h),h.slice(0,400));
    vm.runInContext("menuLabelChange('/','  <i>홈</i>  '); menuLabelChange('/admin','관리자')",c); const d1=op();
    vm.runInContext("paintMenus()",c); const h1=body.innerHTML;
    t('L5 바꾸기 — 정리해 저장(<i>홈</i>) · 기본 이름과 같으면 기본(관리자 · 칸 비움 · ↺ 없음) · 바꿀 때마다 저장 대기 · 화면엔 글자 그대로(이스케이프)',
      d1.items['/'].label==='<i>홈</i>'&&!('label' in d1.items['/admin'])&&c.saves===2&&h1.includes('value="&lt;i&gt;홈&lt;/i&gt;"')&&!h1.includes('<i>홈')
      &&/data-path="\/admin" value="" placeholder="관리자"/.test(h1)&&(h1.match(/class="menu-label-reset"/g)||[]).length===2,JSON.stringify([d1.items['/'],d1.items['/admin'],c.saves]));
    vm.runInContext("menuLabelChange('/job','')",c); const d2=op();
    t('L5 지우기 — 기본 이름으로(label 없음)',!('label' in d2.items['/job'])&&c.saves===3,JSON.stringify(d2.items['/job']));
    vm.runInContext("menuLabelChange('/job','채용'); resetMenus()",c); const d3=op();
    t('L5 기본 순서로 되돌리기 — 이름은 그대로(채용 · <i>홈</i>)',d3.items['/job'].label==='채용'&&d3.items['/'].label==='<i>홈</i>'&&c.saves===5,JSON.stringify(d3.items));
    const lm=fnOf(S.admin,'async function loadMenus()'), pv=fnOf(S.admin,'function previewMenuDraft()');
    t('L5 배선 — 불러올 때 저장된 이름을 초안으로 · 미리보기가 이름도 바로 붙임 · 안내 글자',
      /name:menuNameClean\(v\.label\)/.test(lm)&&/JKAccess\.applyMenuLabels\(\{items:Object\.fromEntries\(menuDraft\.map\(x=>\[x\.path,\{label:x\.name\|\|''\}\]\)\)\}\)/.test(pv)
      &&/칸을 비우거나 ↺ 를 누르면 기본 이름으로 돌아갑니다/.test(S.admin)&&/각 메뉴의 <b>이름<\/b>을 바꾸고/.test(S.admin)); }
  // ── 적용 배선
  t('적용 — 메뉴 정책을 붙일 때 이름도 붙인다(applyMenuDom → applyMenuLabels) · 바깥에 내보냄',/try\{ applyMenuLabels\(cfg\); \}catch\(e\)\{ console\.warn\('menu labels',e\); \}/.test(fnOf(S.acc,'function applyMenuDom(user,cfg)'))
    &&/cleanMenuLabel:cleanMenuLabel, menuLabel:menuLabel, applyMenuLabels:applyMenuLabels/.test(S.acc));
  return bad;
}

const MUT=[
  ['정리: 이름을 버림(옛 코드)','acc',s=>s.replace("      if(label&&label!==x.label) d.items[x.path].label=label;","")],
  ['정리: 기본 이름과 같아도 저장','acc',s=>s.replace("      if(label&&label!==x.label) d.items[x.path].label=label;","      if(label) d.items[x.path].label=label;")],
  ['정리: 20자 제한 없음','acc',s=>s.replace("return a.length>20?a.slice(0,20).join('').trim():s;","return s;")],
  ['정리: 보이지 않는 문자 그대로','acc',s=>s.replace("\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]","]")],
  ['적용: 메뉴 정책에서 이름을 안 붙임','acc',s=>s.replace("    try{ applyMenuLabels(cfg); }catch(e){ console.warn('menu labels',e); }\n","")],
  ['적용: innerHTML 로 넣음(마크업으로 해석)','acc',s=>s.replace("    if(lab.textContent!==want) lab.textContent=want;","    lab.childNodes=[]; String(want).split(/(<[^>]+>)/).forEach(function(p){ lab.appendChild(/^</.test(p)?document.createElement('b'):{nodeType:3,textContent:p}); });")],
  ['적용: 아이콘까지 지움','acc',s=>s.replace("        if(n.nodeType===1&&n.classList&&n.classList.contains('mi')) return;\n","")],
  ['적용: 이름을 지워도 기본 글자로 안 돌아감','acc',s=>s.replace("    var want=custom||lab.getAttribute('data-default')||'';","    if(!custom) return; var want=custom;")],
  ['관리자: 저장 문서에 이름 빠짐','admin',s=>s.replace("    const nm=menuNameClean(x.name); if(nm&&nm!==x.label) items[x.path].label=nm; });","    });")],
  ['관리자: 되돌리기에서 이름도 지움','admin',s=>s.replace("  menuDraft=menuBase().map(x=>({...x,name:names[x.path]||''}));","  menuDraft=menuBase().map(x=>({...x,name:''}));")],
  ['관리자: 이름 칸 글자를 이스케이프 안 함','admin',s=>s.replace("value=\"'+esc(r.name||'')+'\"","value=\"'+(r.name||'')+'\"")],
  ['관리자: 기본 이름과 같아도 바꾼 이름으로','admin',s=>s.replace("  r.name=(nm&&nm!==r.label)?nm:'';","  r.name=nm;")],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 메뉴 이름: 정리(빈칸·제어·보이지 않는 문자·20자) · 설정(바꾼 이름만) · 보일 이름 · 적용(아이콘 그대로·글자만·되돌림·마크업은 글자) · 관리자 화면(저장 문서·이름 칸·바꾸기/지우기·되돌리기는 이름 그대로·배선)');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS menu labels · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
