#!/usr/bin/env node
'use strict';
/* 운영 › 듀얼가드 — 창 높이 = 내용 높이 · 바깥 한 번 스크롤 (index v3.135.0 · 듀얼가드 v2.14.0 · 2026-11-11)
 * 사용자: "듀얼가드는 왜 안에 상하 스크롤이 왜 생기는거지" → "1번"(다른 탭처럼 바깥 한 번 스크롤)
 * P 바깥(index.html): 창이 알려 준 높이로 늘림(짧으면 탭 줄 아래 화면 채움) · 보이는 칸(탭 줄 밑 ~ 화면 아래)을 창에 알림 ·
 *   알려 오기 전엔 예전처럼 화면 높이 창 · 다른 창 · 다른 출처 무시 · 새로 열면 다시 화면 높이 · 잠금은 html 에만
 * C 창 안(plan.html): 보이는 칸에 세션 줄 · 상태줄 · 상세 탭 붙임 · 층(기록 단추 · 시트 · 설정 창) 위치 · 시트 · 설정 창 열린 동안 멈춤 · 잠금 알림 ·
 *   내용 높이 알림(불러오는 중 · 숨은 창 제외 · 같은 값 다시 안 보냄)
 * 실제 함수를 떼어 돌린다. 값 시험 + 변이.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'..'),SRC={idx:fs.readFileSync(path.join(ROOT,'index.html'),'utf8'),plan:fs.readFileSync(path.join(ROOT,'plan.html'),'utf8')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const J=JSON.stringify;

function check(S){
  const bad=[],t=(n,c,i)=>{if(!c)bad.push(n+(i!==undefined?' · '+String(i).slice(0,300):''));};
  // ── P 바깥
  const mkP=()=>{
    const calls=[],cls=new Set(),fr={top:180,bottom:4180,height:4000};
    const frame={style:{},_src:'',getAttribute(k){return k==='src'?this._src:null;},setAttribute(k,v){if(k==='src')this._src=v;},getBoundingClientRect:()=>({...fr}),
      contentWindow:{dgApplyViewport:(a,b,c)=>calls.push([a,b,c])},offsetHeight:0};
    const c={dgFrameEl:frame,calls,cls,fr,inner:664,tb:{bottom:135,height:62},dg:true,scrollY:0,
      location:{origin:'https://jk.example'},
      document:{querySelector:q=>q==='.tabs'?{getBoundingClientRect:()=>({bottom:c.tb.bottom,height:c.tb.height})}:null,documentElement:{classList:{toggle:(k,on)=>{if(on)cls.add(k);else cls.delete(k);}}},
        createElement:()=>({style:{},remove(){}}),body:{appendChild(){}}},
      getComputedStyle:()=>({paddingBottom:'34px'}),$:id=>id==='dg'?{appendChild(){}}:null};
    c.window={get innerHeight(){return c.inner;},get scrollY(){return c.scrollY;}};
    vm.createContext(c);
    vm.runInContext('var dgAutoH=false;function isDgView(){return dg;}\n'+['function dgEnsureFrame(extra)','function dgSize()','function dgFrameMsg(e)','function dgSab()','function dgVp()'].map(m=>fnOf(S.idx,m)).join('\n'),c);
    c.msg=(d,o)=>c.dgFrameMsg({origin:(o&&o.origin)||'https://jk.example',source:(o&&o.source)||frame.contentWindow,data:d});
    return c;};
  { const c=mkP();c.dgSize();const before=c.dgFrameEl.style.height;
    c.msg({type:'jk-dg-h',h:4000});
    t('P1 창이 내용 높이(4000)를 알려 오면 그 높이로 · 그 뒤 보이는 칸 알림(맨 위: 탭 줄 아래 창 시작 → t 0 · h = 664 − 180)',
      before==='484px'&&c.dgFrameEl.style.height==='4000px'&&c.dgAutoH===true&&J(c.calls.at(-1))===J([0,484,34]),J({before,h:c.dgFrameEl.style.height,calls:c.calls}));
    c.fr.top=-720;c.fr.bottom=3280;c.dgVp();
    t('P2 900 내림: 탭 줄(아래 135)에 가린 만큼 t = 135 − (−720) = 855 · h = 664 − 135 = 529',J(c.calls.at(-1))===J([855,529,34]),J(c.calls.at(-1)));
    c.fr.top=-3600;c.fr.bottom=400;c.dgVp();
    t('P3 창 끝이 화면 안(아래 400): h = 400 − 135 = 265',J(c.calls.at(-1))===J([3735,265,34]),J(c.calls.at(-1)));
    c.dgFrameEl.style.height='999px';c.dgSize();
    t('P4 창 높이 = 내용 높이 뒤엔 화면 높이로 덮어쓰지 않는다',c.dgFrameEl.style.height==='999px',c.dgFrameEl.style.height); }
  { const c=mkP();c.msg({type:'jk-dg-h',h:100});
    t('P5 내용이 짧으면 탭 줄 아래 화면을 채운다(664 − 62 = 602)',c.dgFrameEl.style.height==='602px',c.dgFrameEl.style.height);
    const c2=mkP();c2.msg({type:'jk-dg-h',h:4000},{origin:'https://evil.example'});c2.msg({type:'jk-dg-h',h:4000},{source:{}});
    t('P6 다른 출처 · 다른 창이 보낸 높이는 무시',c2.dgFrameEl.style.height===undefined&&c2.dgAutoH===false,J(c2.dgFrameEl.style));
    c.msg({type:'jk-dg-lock',on:true});const on=c.cls.has('dglock');c.msg({type:'jk-dg-lock',on:false});
    t('P7 창 안 시트 · 설정 창이 열리면 바깥 스크롤 잠금(html.dglock) · 닫히면 풂',on&&!c.cls.has('dglock'));
    c.dg=false;c.calls.length=0;c.dgVp();
    t('P8 듀얼가드 탭이 아니면 알리지 않는다',c.calls.length===0);
    const c3=mkP();c3.dgAutoH=true;c3.dgEnsureFrame('session=p1');
    t('P9 창을 새로 열면 주소에 autoh=1 · 높이를 다시 받을 때까지 화면 높이 창(dgAutoH 끔)',c3.dgFrameEl._src==='/plan?embed=1&autoh=1&session=p1'&&c3.dgAutoH===false,c3.dgFrameEl._src);
    t('P10 바깥 잠금은 html 에만(body 에도 걸면 위에 붙는 머리말 · 탭 줄이 사라진다) · 맨 위로 단추 숨김',/html\.dglock\{overflow:hidden\}/.test(S.idx)&&!/html\.dglock body/.test(S.idx)&&/html\.dglock #jkToTop\{display:none!important\}/.test(S.idx)); }
  // ── C 창 안
  const mkC=()=>{
    const els={},el=id=>els[id]||(els[id]={id,style:{setProperty(k,v){this[k]=v;}},hidden:true});
    const posted=[],bodyCls=new Set();
    const c={els,posted,bodyCls,hyd:false,innerWidth:390,bodyH:4000,
      document:{documentElement:{classList:{contains:k=>k==='plan-hydrating'?c.hyd:k==='autoh'},style:{setProperty(){}}},
        body:{classList:{contains:k=>bodyCls.has(k)},getBoundingClientRect:()=>({height:c.bodyH})}},
      getComputedStyle:()=>({marginTop:'0px',marginBottom:'0px'}),console:{warn(){}}};
    c.window={postMessage(){},parent:{postMessage:(m,o)=>posted.push([m,o])},get innerWidth(){return c.innerWidth;}};
    c.location={origin:'https://jk.example'};c.$=id=>el(id);
    els.assetSessionModal={hidden:true};els.assetSessionChips={style:{},offsetHeight:56};els.assetStatusline={style:{},offsetHeight:55};els.assetDetailTabs={style:{}};
    vm.createContext(c);
    const block=S.plan.slice(S.plan.indexOf('const dgStickyH='),S.plan.indexOf('function dgVpSetup(){'));
    vm.runInContext(block+'\n'+fnOf(S.plan,'function dgStickyOffsets()')+'\n'+fnOf(S.plan,'function dgVpOpen()')+'\n'+fnOf(S.plan,'function dgVpPaint()')+'\n'
      +'window.dgApplyViewport='+fnOf(S.plan,'window.dgApplyViewport=function(t,h,sab)').slice('window.dgApplyViewport='.length)+';\n'
      +fnOf(S.plan,'function dgVpLock()')+'\nlet dgPostedH=0;\n'+fnOf(S.plan,'function dgPostHeight()')+'\ndgVpLayer=$("dgVp");',c);
    return c;};
  { const c=mkC(),L=c.els.dgVp;c.dgStickyOffsets();c.window.dgApplyViewport(855.4,529,34);
    t('C1 보이는 칸(855 · 529 · 아래 여백 34): 층 위치 · 높이 · 여백 · 세션 줄 855 · 상태줄 855+56 · 상세 탭 855+56+55',
      L.style.top==='855px'&&L.style.height==='529px'&&L.style['--vp-sab']==='34px'&&c.els.assetSessionChips.style.top==='855px'&&c.els.assetStatusline.style.top==='911px'&&c.els.assetDetailTabs.style.top==='966px',
      J({L:L.style,a:c.els.assetSessionChips.style.top,b:c.els.assetStatusline.style.top,d:c.els.assetDetailTabs.style.top}));
    c.bodyCls.add('dg-sheet-open');c.dgVpLock();c.window.dgApplyViewport(1500,529,34);const frozen=L.style.top;
    c.bodyCls.delete('dg-sheet-open');c.dgVpLock();
    t('C2 기록 시트가 열린 동안 층을 움직이지 않는다(855 그대로) · 닫히면 그동안 온 칸(1500)으로 · 잠금 알림 켬 → 끔 한 번씩',
      frozen==='855px'&&L.style.top==='1500px'&&J(c.posted.map(x=>x[0]))===J([{type:'jk-dg-lock',on:true},{type:'jk-dg-lock',on:false}])&&c.posted.every(x=>x[1]==='https://jk.example'),J({frozen,top:L.style.top,posted:c.posted}));
    c.els.assetSessionModal.hidden=false;c.dgVpLock();c.window.dgApplyViewport(2000,529,34);const fm=L.style.top;c.els.assetSessionModal.hidden=true;c.dgVpLock();
    t('C3 세션 설정 창이 열린 동안도 멈춤 · 닫히면 맞춤',fm==='1500px'&&L.style.top==='2000px',J({fm,top:L.style.top})); }
  { const c=mkC();c.hyd=true;c.dgPostHeight();const a=c.posted.length;c.hyd=false;c.innerWidth=0;c.dgPostHeight();const b=c.posted.length;c.innerWidth=390;c.dgPostHeight();c.dgPostHeight();c.bodyH=4100.2;c.dgPostHeight();
    t('C4 내용 높이 알림: 불러오는 중 · 숨은 창(폭 0)엔 안 보냄 · 같은 값은 다시 안 보냄 · 바뀌면 올림값으로',a===0&&b===0&&J(c.posted.map(x=>x[0]))===J([{type:'jk-dg-h',h:4000},{type:'jk-dg-h',h:4101}]),J(c.posted)); }
  t('C5 창 안 고정 요소는 보이는 칸 층(#dgVp · transform)으로 — 기록 단추 · 시트 · 바탕 · 설정 창 · 로그인 상자 · 바깥 주소 autoh=1 일 때만',
    /for\(const id of \['authgate','dgFab','dgSheetBg','dgSheet','assetSessionModal'\]\)/.test(fnOf(S.plan,'function dgVpSetup()'))&&/html\.autoh #dgVp\{position:absolute;[^}]*transform:translateZ\(0\)/.test(S.plan)
    &&/if\(\/\[\?&\]autoh=1\(&\|\$\)\/\.test\(location\.search\)\) document\.documentElement\.classList\.add\('autoh'\);/.test(S.plan));
  return bad;
}

const bad=check(SRC);
if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
console.log('PASS 듀얼가드 창 높이 = 내용 높이: 바깥 높이 · 보이는 칸 · 잠금(html) · 새로 열기 · 창 안 붙는 자리 · 층 · 시트 · 설정 창 멈춤 · 높이 알림');
const MUT=[
  ['바깥: 보이는 칸이 탭 줄을 안 봄','idx',s=>s.replace("const top=Math.max(r.top,tbB), bot=Math.min(window.innerHeight||0,r.bottom);","const top=Math.max(r.top,0), bot=Math.min(window.innerHeight||0,r.bottom);")],
  ['바깥: 창 높이 = 내용 높이 뒤에도 화면 높이로 덮음','idx',s=>s.replace("  if(!dgFrameEl||!isDgView()||dgAutoH) return;   // 창 높이 = 내용 높이(dgFrameMsg)면 화면 높이로 맞추지 않는다","  if(!dgFrameEl||!isDgView()) return;")],
  ['바깥: 잠금을 body 에도(머리말 사라짐)','idx',s=>s.replace("html.dglock{overflow:hidden}","html.dglock,html.dglock body{overflow:hidden}")],
  ['창 안: 시트 · 설정 창 열린 동안에도 층을 움직임','plan',s=>s.replace("  if(!dgVpLayer||!dgVpState||dgVpOpen())return;\n","  if(!dgVpLayer||!dgVpState)return;\n")],
  ['창 안: 불러오는 중에도 높이를 알림','plan',s=>s.replace("if(!dgVpLayer||document.documentElement.classList.contains('plan-hydrating')||!(window.innerWidth>0))return;","if(!dgVpLayer||!(window.innerWidth>0))return;")],
  ['창 안: 상태줄이 세션 줄 높이를 안 더함','plan',s=>s.replace("if(b)b.style.top=(t+dgStickyH.h1)+'px';","if(b)b.style.top=t+'px';")],
];
let red=0;
for(const [name,key,mut] of MUT){
  const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
  let failed=false;try{failed=check({...SRC,[key]:m}).length>0;}catch(e){failed=true;}
  if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
  red++;console.log('PASS 변이 빨간불: '+name);
}
console.log('ALL PASS dg autoheight · 변이 '+red+'/'+MUT.length+' red');
