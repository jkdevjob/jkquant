#!/usr/bin/env node
'use strict';
/* 하위 탭 숨김·순서 (index v3.125.0 · admin v0.13.0 · 2026-11-09)
 * 사용자(관리자 › 메뉴 관리 화면): "각 메뉴별로 하위탭들도 숨기거나 위치 변경 가능하게 하자"
 * 실제 jk-access.js · admin.html 함수를 그대로 돌린다(재구현 없음). 값 시험 + 변이(틀린 코드로 바꾸면 빨간불).
 *   S1 설정 정리(normalizeMenuConfig) — 모르는 키 버림 · 잘못된 값은 기본 · ASAP 기본 숨김 · 저장된 페이지에 새로 생긴 탭은 맨 뒤
 *   S2 상태(subTabState) — 공개 / 관리자만(관리자에게만) / 숨김(모두) · 저장 순서
 *   S3 적용(applySubTabs · applyMenuConfig) — 탭 단추에 숨김 클래스·CSS order · 모의·포트폴리오 주소도 운영 탭 · 모르는 탭은 그대로 ·
 *      지금 열린 탭은 CSS 가 남긴다 · 정책을 받으면 준비 표시
 *   S4 목록 = 각 페이지의 실제 탭(키·이름·순서) — 페이지에 탭이 생기거나 빠지면 빨간불
 *   S5 관리자 화면 — 초안 → 저장 문서(subs) · 공개범위 바꾸기 · 위아래 · 기본값 되돌리기 · 펼친 칸 글자 · 불러오기 배선
 *   S6 운영 ASAP CSS — 정책을 받기 전까지만 가린다(그 뒤엔 정책이 정한다)
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={acc:rd('jk-access.js'),admin:rd('admin.html'),idx:rd('index.html')};
const PAGE_FILES={'/':['index.html','<div class="tabs">'],'/scalping':['scalping.html','<div class="strategy-tabs">'],'/claude':['claude.html','<div class="tabs" id="tabs">'],
  '/realestate':['realestate.html','<div class="tabs" id="tabs">'],'/job':['job.html','<div class="tabs" id="tabs">'],'/settings':['settings.html','<div class="tabs" role="tablist">'],
  '/workout':['workout.html','<div class="mode-tabs"']};
const PAGES=Object.fromEntries(Object.entries(PAGE_FILES).map(([p,[f]])=>[p,rd(f)]));
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const ADM={uid:'a1',email:'jk82investing@gmail.com'}, USR={uid:'u1',email:'user@example.com'};

/* 가짜 탭 단추 — 속성 하나 · 클래스 · style.order */
function btn(attr,key,on){ const cls=new Set(on?['on']:[]); return {key,style:{},getAttribute:a=>a===attr?key:null,
  classList:{toggle:(x,f)=>f?cls.add(x):cls.delete(x),contains:x=>cls.has(x),add:x=>cls.add(x),remove:x=>cls.delete(x)},cls}; }
/* jk-access.js 를 가짜 문서에서 돌린다 — pathname · 그 페이지의 탭 단추(선택자 → 단추) */
function load(acc,pathname,buttons){
  const html=new Set(), styles=[];
  const document={documentElement:{classList:{add:x=>html.add(x),remove:x=>html.delete(x),toggle(){},contains:x=>html.has(x)}},
    head:{appendChild:n=>{ styles.push(n); return n; }}, body:null, createElement:()=>({setAttribute(){},appendChild(){},textContent:''}),
    getElementById:()=>null, querySelectorAll:q=>q==='.jkmenu-pop'?[]:((buttons&&buttons[q])||[]), currentScript:null, addEventListener(){}};
  const ctx={document,console:{warn(){},error(){},log(){}},setTimeout:(f,ms)=>ms>=6000?0:setTimeout(f,ms),clearTimeout,URL,location:{origin:'https://jkquant.pages.dev',pathname}};
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(acc,ctx);
  return {A:ctx.JKAccess,html};
}
const mkFb=data=>({db:{},doc:(db,c,id)=>c+'/'+id,getDoc:async()=>({exists:()=>true,data:()=>data})});

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  const {A}=load(S.acc,'/',{});
  // ── S1 설정 정리
  { const d=A.menuDefaults(), c=A.normalizeMenuConfig({items:{},subs:{'/':{inf:{mode:'hidden',order:5},dg:{mode:'weird',order:'x'},zzz:{mode:'public',order:1}},'/job':{},'/nope':{a:{mode:'hidden'}}}});
    const r=c.subs['/'];
    t('S1 기본값 — 페이지 순서(10 단위) · ASAP 은 전체 숨김 · 나머지 공개',d.subs['/'].dg.order===10&&d.subs['/'].asap.mode==='hidden'&&d.subs['/'].asap.order===70&&d.subs['/'].inf.mode==='public'&&d.subs['/claude'].duel.order===80,JSON.stringify(d.subs['/']));
    t('S1 정리 — 저장한 값은 그대로(inf 숨김 · 5) · 잘못된 값은 기본(dg 공개) · 모르는 키(zzz)·모르는 페이지(/nope)는 버림',
      r.inf.mode==='hidden'&&r.inf.order===5&&r.dg.mode==='public'&&!('zzz' in r)&&!('/nope' in c.subs),JSON.stringify(r));
    t('S1 저장된 페이지에 새로 생긴 탭(저장에 없음)은 맨 뒤(1000+) · 아무것도 저장 안 한 페이지(/job)는 기본 순서',
      r.dg.order===1010&&r.asap.order===1070&&r.asap.mode==='hidden'&&c.subs['/job'].all.order===10&&c.subs['/job'].applied.order===80,JSON.stringify([r.dg,r.asap,c.subs['/job'].all])); }
  // ── S2 상태
  { const cfg={subs:{'/':{dg:{mode:'admin',order:30},inf:{mode:'public',order:10},vr:{mode:'hidden',order:20}}}};
    const u=A.subTabState(cfg,'/',false), a=A.subTabState(cfg,'/',true), v=L=>L.filter(x=>x.visible).map(x=>x.key).join();
    t('S2 순서 — 저장 순서(inf·vr·dg) 다음 기본 순서(ma·ivs·dca·asap)',u.map(x=>x.key).join()==='inf,vr,dg,ma,ivs,dca,asap',u.map(x=>x.key).join());
    t('S2 공개범위 — 일반: 관리자만(dg)·숨김(vr)·기본 숨김(asap) 안 보임 · 관리자: 관리자만은 보임 · 숨김은 관리자도 안 보임',
      v(u)==='inf,ma,ivs,dca'&&v(a)==='inf,dg,ma,ivs,dca',v(u)+' | '+v(a));
    t('S2 목록에 없는 페이지는 빈 목록',A.subTabState(cfg,'/backtest',true).length===0); }
  // ── S3 적용
  { const def=A.SUB_TABS['/'], keys=['dg','inf','vr','ma','ivs','dca','asap','zzz'];
    const run=async(pathname,user,data,on='inf')=>{ const B=keys.map(k=>btn(def.attr,k,k===on)); const L=load(S.acc,pathname,{[def.sel]:B});
      await L.A.applyMenuConfig(user,mkFb(data),{force:true}); return {B,L}; };
    const data={items:{},subs:{'/':{dg:{mode:'admin',order:30},inf:{mode:'public',order:10},vr:{mode:'hidden',order:20}}}};
    const {B,L}=await run('/',USR,data), by=k=>B.find(b=>b.key===k);
    t('S3 적용(일반 사용자) — 숨김·관리자만·기본 숨김에 숨김 클래스 · 공개는 없음 · CSS order = 순서 · 준비 표시',
      by('vr').cls.has('jk-sub-hidden')&&by('dg').cls.has('jk-sub-hidden')&&by('asap').cls.has('jk-sub-hidden')&&!by('inf').cls.has('jk-sub-hidden')&&!by('ma').cls.has('jk-sub-hidden')
      &&by('inf').style.order==='1'&&by('vr').style.order==='2'&&by('dg').style.order==='3'&&by('asap').style.order==='7'&&L.html.has('jk-subtabs-ready'),
      JSON.stringify(B.map(b=>[b.key,b.style.order,[...b.cls].join('+')])));
    t('S3 목록에 없는 탭(zzz)은 손대지 않는다',by('zzz').style.order===undefined&&!by('zzz').cls.has('jk-sub-hidden'));
    const adm=(await run('/',ADM,data)).B.find(b=>b.key==='dg');
    t('S3 관리자에겐 관리자만 탭이 보인다',!adm.cls.has('jk-sub-hidden'));
    const pp=(await run('/paper',USR,data)).B.find(b=>b.key==='vr'), pf=(await run('/portfolio',USR,data)).B.find(b=>b.key==='vr');
    t('S3 모의·포트폴리오 주소(같은 운영 파일)도 운영 탭 정책',pp.cls.has('jk-sub-hidden')&&pf.cls.has('jk-sub-hidden'));
    const other=await run('/backtest',USR,data);
    t('S3 목록에 없는 페이지 — 아무것도 안 바꾸고 준비 표시도 없음',other.B.every(b=>b.style.order===undefined&&!b.cls.has('jk-sub-hidden'))&&!other.L.html.has('jk-subtabs-ready'));
    t('S3 숨긴 탭도 지금 열린 탭(on · aria-selected)은 CSS 가 남긴다 — 옮길 때까지',S.acc.includes('.jk-sub-hidden:not(.on):not([aria-selected="true"]){display:none!important}')); }
  t('S3 정책을 탭 단추에 적용한 뒤 운영 화면에 알린다(jk-subtabs — 첫 탭을 그 순서로 다시 고름)',/document\.dispatchEvent\(new CustomEvent\('jk-subtabs'/.test(fnOf(S.acc,'function applySubTabs(user,cfg)')));
  // ── S4 목록 = 각 페이지의 실제 탭
  { const strip=h=>h.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    for(const [p,def] of Object.entries(A.SUB_TABS)){
      const pf=PAGE_FILES[p]; if(!pf){ t('S4 '+p+' — 시험의 페이지 표에 없음',false); continue; }
      const src=S.pages&&S.pages[p]||PAGES[p], i=src.indexOf(pf[1]);
      if(i<0){ t('S4 '+p+' — 탭 줄을 못 찾음',false,pf[1]); continue; }
      let j=src.indexOf('>',i)+1, d=1, k=j; const re=/<(\/?)div\b[^>]*>/g; re.lastIndex=j; let m;
      while((m=re.exec(src))){ if(m[1]) d--; else d++; if(!d){ k=m.index; break; } }
      const inner=src.slice(j,k), got=[...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(b=>{ const a=b[1].match(new RegExp(def.attr+'="([^"]*)"')); return [a&&a[1],strip(b[2])]; });
      const want=def.items.map(x=>[x[0],x[1]]);
      t('S4 '+p+' — 목록(키·이름·순서) = 페이지 탭',JSON.stringify(got)===JSON.stringify(want),JSON.stringify({got,want}));
    } }
  // ── S5 관리자 화면
  { const fns=['function subDraftFrom(cfg)','function menuDraftConfig()','function subBlockHtml(path)','function subModeChange(path,key,mode)','function moveSub(path,key,dir)','function resetMenus()','function subToggle(d)'];
    const lab=(S.admin.match(/const SUB_MODE_LABEL=\{[^}]*\};/)||[''])[0].replace('const ','var ');
    const c={window:{JKAccess:A},JKAccess:A,me:{email:'JK82investing@gmail.com'},normEmail:e=>String(e||'').trim().toLowerCase(),
      esc:t=>String(t==null?'':t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
      menuBase:()=>[{path:'/',label:'운영',mode:'public',order:10}],paints:0,saves:0,Date,Set};
    vm.createContext(c);
    vm.runInContext('var menuDraft=[{path:"/",label:"운영",mode:"public",order:10}],subDraft={},subOpen=new Set();'+lab+'\nfunction paintMenus(){paints++;}\nfunction queueMenuSave(){saves++;}\n'+fns.map(m=>fnOf(S.admin,m)).join('\n'),c);
    c.subDraft=vm.runInContext('subDraft=subDraftFrom(JKAccess.menuDefaults()); subDraft',c);
    const op=()=>vm.runInContext('menuDraftConfig()',c), d0=op();
    t('S5 초안 → 저장 문서: subs(페이지마다 키 → 공개범위·순서) · 기본은 ASAP 숨김 · 나머지 공개',d0.subs&&d0.subs['/'].asap.mode==='hidden'&&d0.subs['/'].dg.order===10&&d0.subs['/job'].applied.order===80&&d0.items['/'].mode==='public',JSON.stringify(d0.subs&&d0.subs['/']));
    vm.runInContext("moveSub('/','asap',-1); subModeChange('/','inf','admin'); subModeChange('/','vr','oops'); moveSub('/','dg',-1)",c);
    const d1=op();
    t('S5 위로(ASAP ↔ 적립) · 맨 위는 그대로 · 공개범위 바꾸기 · 잘못된 값은 무시 · 바뀔 때마다 다시 그리고 저장 대기',
      d1.subs['/'].asap.order===60&&d1.subs['/'].dca.order===70&&d1.subs['/'].dg.order===10&&d1.subs['/'].inf.mode==='admin'&&d1.subs['/'].vr.mode==='public'&&c.saves===2&&c.paints===2,
      JSON.stringify([d1.subs['/'],c.saves,c.paints]));
    const h=vm.runInContext("subBlockHtml('/')",c);
    t('S5 펼칠 칸 — 하위 탭 7개 · 숨김 1 · 관리자만 1 · 탭마다 공개범위 고르기·위아래 · 맨 위 ↑ 잠금',
      h.includes('하위 탭 7개 · 숨김 1 · 관리자만 1')&&(h.match(/subModeChange\(/g)||[]).length===7&&(h.match(/moveSub\(/g)||[]).length===14&&h.includes('>전체 숨김</option>')
      &&/<button disabled onclick="moveSub\('\/','dg',-1\)"/.test(h),h.slice(0,240));
    t('S5 하위 탭이 없는 메뉴는 칸이 없다',vm.runInContext("subBlockHtml('/backtest')",c)==='');
    vm.runInContext("resetMenus()",c); const d2=op();
    t('S5 기본 순서로 되돌리기 — 하위 탭도 기본(ASAP 숨김 · 페이지 순서)',d2.subs['/'].asap.mode==='hidden'&&d2.subs['/'].asap.order===70&&d2.subs['/'].inf.mode==='public'&&c.saves===3,JSON.stringify(d2.subs['/']));
    t('S5 배선 — 불러올 때 저장된 정책으로 초안(subDraftFrom(cfg)) · 메뉴 줄마다 하위 탭 칸 · 안내 글자',
      /subDraft=subDraftFrom\(cfg\);/.test(fnOf(S.admin,'async function loadMenus()'))&&/\+subBlockHtml\(r\.path\)\+/.test(fnOf(S.admin,'function paintMenus()'))
      &&/하위 탭<\/b>을 펼치면/.test(S.admin)&&/관리자 화면의 탭은 스스로 잠그지 않게 목록에 없습니다/.test(S.admin)); }
  // ── S6 운영 ASAP CSS
  t('S6 운영 ASAP CSS — 정책을 받기 전까지만 가린다(그 뒤엔 정책 · 기본 숨김)',S.idx.includes('html:not(.jk-subtabs-ready) .tab[data-t="asap"]:not(.on){display:none}')
    &&!/\n\.tab\[data-t="asap"\]:not\(\.on\)\{display:none\}/.test(S.idx));
  return bad;
}

const MUT=[
  ['적용: 메뉴 적용에서 하위 탭을 안 부름','acc',s=>s.replace("    try{ applySubTabs(user,cfg); }catch(e){ console.warn('sub tabs',e); }\n","")],
  ['상태: 관리자만 탭을 모두에게 보임','acc',s=>s.replace("visible:mode==='public'||(mode==='admin'&&!!admin)","visible:mode!=='hidden'")],
  ['목록: ASAP 기본 공개','acc',s=>s.replace("['asap','ASAP','hidden']","['asap','ASAP']")],
  ['정리: 새로 생긴 탭이 맨 앞','acc',s=>s.replace("(i+1)*10+(saved?1000:0)","(i+1)*10-(saved?1000:0)")],
  ['정리: 모르는 공개범위도 받음','acc',s=>s.replace("d.subs[p][it[0]]={mode:SUB_MODES.indexOf(v.mode)>=0?v.mode:(it[2]||'public')","d.subs[p][it[0]]={mode:v.mode||(it[2]||'public')")],
  ['CSS: 지금 열린 탭도 숨김','acc',s=>s.replace('.jk-sub-hidden:not(.on):not([aria-selected="true"]){display:none!important}',`.jk-sub-hidden{display:none!important}`)],
  ['별칭: 모의 주소는 운영 탭 정책 안 받음','acc',s=>s.replace("var SUB_ALIAS={'/portfolio':'/','/paper':'/'};","var SUB_ALIAS={'/portfolio':'/'};")],
  ['적용: 목록에 없는 탭도 순서를 덮음','acc',s=>s.replace("      var r=by[b.getAttribute(def.attr)]; if(!r) return;   // 목록에 없는 탭은 손대지 않는다\n","      var r=by[b.getAttribute(def.attr)]||{visible:true,rank:99};\n")],
  ['목록: 운영 탭 하나 빠짐(로테이션)','acc',s=>s.replace(",['ma','로테이션']","")],
  ['관리자: 저장 문서에 하위 탭 빠짐','admin',s=>s.replace("  return {items,subs,updatedAt:Date.now(),updatedBy:normEmail(me&&me.email)};","  return {items,updatedAt:Date.now(),updatedBy:normEmail(me&&me.email)};")],
  ['관리자: 위아래 뒤 순서 다시 안 매김','admin',s=>s.replace("  [L[i],L[j]]=[L[j],L[i]]; L.forEach((z,k)=>z.order=(k+1)*10); paintMenus(); queueMenuSave();","  [L[i],L[j]]=[L[j],L[i]]; paintMenus(); queueMenuSave();")],
  ['관리자: 되돌리기에서 하위 탭 그대로','admin',s=>s.replace("  subDraft=subDraftFrom(window.JKAccess?JKAccess.menuDefaults():{});   // 하위 탭도 기본(페이지 순서 · ASAP 숨김)\n","")],
  ['적용: 운영 화면에 안 알림(jk-subtabs 없음)','acc',s=>s.replace(/    try\{ if\(typeof CustomEvent==='function'&&document\.dispatchEvent\) document\.dispatchEvent\(new CustomEvent\('jk-subtabs'[^\n]*\n/,'')],
  ['운영: ASAP CSS 를 정책 뒤에도 강제(옛 규칙)','idx',s=>s.replace('html:not(.jk-subtabs-ready) .tab[data-t="asap"]:not(.on){display:none}','.tab[data-t="asap"]:not(.on){display:none}')],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 하위 탭: 설정 정리(모르는 키·잘못된 값·ASAP 기본 숨김·새 탭 맨 뒤) · 공개범위(일반/관리자) · 적용(숨김 클래스·순서·모의 주소·모르는 탭·열린 탭) · 목록 = 페이지 7곳 실제 탭 · 관리자 화면(저장 문서·바꾸기·위아래·되돌리기) · 운영 ASAP CSS');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS sub tabs · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
