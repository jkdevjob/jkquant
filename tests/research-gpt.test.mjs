import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {onRequestGet} from '../functions/api/tenbagger-research.js';

const ui=fs.readFileSync('scalping.html','utf8'),source=fs.readFileSync('tenbagger-gpt.js','utf8');
const access=fs.readFileSync('jk-access.js','utf8');
function fn(name){const at=ui.indexOf('function '+name+'(');let start=ui.indexOf('{',at),i=start,d=0;for(;i<ui.length;i++){if(ui[i]==='{')d++;if(ui[i]==='}'&&!--d)break;}return ui.slice(at,i+1);}

test('연구 탭 복원·직접 링크와 기존 전략 경로 보존',()=>{
  assert.match(ui,/<title>JK 투자 — 연구\(지피티\)<\/title>/);
  assert.match(ui,/<div class="kicker">GPT Research<\/div><h1>JK <span class="v">투자<\/span> 연구/);
  assert.match(ui,/<div class="glogo">JK <span class="v">투자<\/span> 연구<\/div>/);
  assert.match(ui,/data-strategy="tenbagger"/);
  assert.match(ui,/id="scVer">v1\.44\.2/);
  const calls=[],ctx={location:{search:'?strategy=tenbagger',hash:''},URLSearchParams,SCALP_PREFS:{strategyTab:'opening'},showStrategy:n=>calls.push(n)};
  vm.runInNewContext(fn('restoreStrategy'),ctx);ctx.restoreStrategy();
  assert.equal(calls.pop(),'tenbagger');
  ctx.location={search:'',hash:'#tenbagger'};ctx.restoreStrategy();assert.equal(calls.pop(),'tenbagger');
  for(const name of ['daily','duel','opening','daytrading','crypto','soxl']){ctx.location={search:'?strategy='+name,hash:''};ctx.restoreStrategy();assert.equal(calls.pop(),name);}
  assert.match(fs.readFileSync('jk-access.js','utf8'),/path:'\/scalping',label:'연구\(지피티\)',mode:'admin'/);
});

function tabOrderValues(html){
  const tabs=[...html.matchAll(/<button class="strategy-tab([^"\n]*)" data-strategy="([^"]+)" onclick="([^"]+)">/g)];
  assert.deepEqual(tabs.map(x=>x[2]),['daily','opening','daytrading','crypto','soxl','tenbagger','duel']);
  assert.deepEqual(tabs.filter(x=>x[1].trim()==='on').map(x=>x[2]),['daily'],'오늘 기본 선택 유지');
  const calls=[];
  vm.runInNewContext(tabs.find(x=>x[2]==='tenbagger')[3],{showStrategy:n=>calls.push(n)});
  assert.deepEqual(calls,['tenbagger'],'이동한 버튼도 같은 연구 화면을 연다');
}
test('텐배거 연구는 클로드 대결 바로 앞 · 오늘 기본값과 버튼 동작 유지',()=>{
  tabOrderValues(ui);
  const button=ui.match(/    <button class="strategy-tab" data-strategy="tenbagger"[^\n]+\n/)[0];
  const old=ui.replace(button,'').replace('  <div class="strategy-tabs">\n','  <div class="strategy-tabs">\n'+button);
  assert.throws(()=>tabOrderValues(old),assert.AssertionError,'맨 앞으로 되돌린 변이 차단');
});

function menuProbe(src,html){
  const block=html.match(/<div class="jkmenu-pop"[^>]*>([\s\S]*?)<\/div>/);
  assert(block,'전체메뉴');
  const links=[...block[1].matchAll(/<a href="([^"]+)"/g)].map(m=>{
    const classes=new Set();return {getAttribute:()=>m[1],classList:{toggle:(c,on)=>on?classes.add(c):classes.delete(c),contains:c=>classes.has(c)}};
  });
  const pop={hidden:true,querySelectorAll:()=>links,appendChild(){}};
  const styles=[],classes=new Set(),timers=[];
  const doc={documentElement:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),toggle(){},contains:c=>classes.has(c)}},
    head:{appendChild:s=>styles.push(s)},body:null,createElement:()=>({}),getElementById:()=>null,
    querySelectorAll:()=>[pop],currentScript:null,addEventListener(){}};
  const ctx={document:doc,console:{warn(){}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return 0;},clearTimeout(){},URL,location:{origin:'https://jkquant.pages.dev',pathname:'/'}};
  ctx.window=ctx;vm.runInNewContext(src,ctx);
  return {api:ctx.JKAccess,links,styles,timers,classes};
}
async function hiddenMenuValues(src,html){
  const admin={uid:'owner',email:'jk82investing@gmail.com'},approved={uid:'approved',email:'member@example.test'};
  for(const user of [null,approved,admin]){
    const d=menuProbe(src,html);
    const css=d.styles.find(x=>x.id==='jkaccess-css').textContent;
    assert(css.includes('.jkmenu-pop a[href="/tenbagger"]{display:none!important}'),'DB/인증 응답 전에도 숨김');
    d.timers.find(x=>x.ms===6000).fn();assert(!d.classes.has('jk-menu-wait'),'대기 한도가 지나도 메뉴 숨김 CSS 유지');
    const cfg=await d.api.applyMenuConfig(user,null);
    const tb=d.links.find(x=>x.getAttribute()==='/tenbagger');assert(tb);
    assert(tb.classList.contains('jk-menu-hidden'),'기본 설정에서도 소유자 포함 메뉴 숨김');
    assert.equal(d.api.menuAccess(approved,cfg,'/tenbagger').allowed,true,'주소 접근권한은 바꾸지 않는다');
    const old={items:{'/tenbagger':{mode:'public',order:1},'/paper':{mode:'public',order:20}}};
    const fb={db:{},doc(){return {};},getDoc:async()=>({exists:()=>true,data:()=>old})};
    await d.api.applyMenuConfig(user||approved,fb,{force:true});
    assert(tb.classList.contains('jk-menu-hidden'),'옛 DB의 전체 공개 설정도 메뉴를 다시 노출하지 않는다');
    assert(!d.links.find(x=>x.getAttribute()==='/paper').classList.contains('jk-menu-hidden'),'모의 등 다른 공개 메뉴는 유지');
    assert.equal(d.api.menuAccess(approved,d.api.normalizeMenuConfig(old),'/scalping').allowed,false,'연구 소유자 제한 유지');
  }
}
test('11페이지 전체메뉴: 텐배거는 인증·대기 한도·옛 DB 설정과 무관하게 숨김, 기존 접근/다른 메뉴 유지',async()=>{
  const pages=fs.readdirSync('.').filter(x=>x.endsWith('.html'));assert.equal(pages.length,11);
  for(const page of pages)await hiddenMenuValues(access,fs.readFileSync(page,'utf8'));
  await assert.rejects(()=>hiddenMenuValues(access.replace(',navHidden:true',''),ui),assert.AssertionError,'숨김 정책 제거 변이 차단');
  const css="return '.jkmenu-pop a[href=\"'+x.path+'\"]{display:none!important}';";
  assert(access.includes(css));
  await assert.rejects(()=>hiddenMenuValues(access.replace(css,"return '';"),ui),assert.AssertionError,'초기 숨김 CSS 제거 변이 차단');
});

function viewProbe(src=source){
  let fetched=0;
  const root={dataset:{host:'research',defaultView:'forward'}};
  const doc={readyState:'complete',querySelectorAll:()=>[],getElementById:id=>id==='tbg-root'?root:null};
  const ctx={document:doc,window:{},URL,AbortController,setTimeout,clearTimeout,fetch:()=>{fetched++;return new Promise(()=>{});}};
  vm.runInNewContext(src,ctx);assert.equal(fetched,0,'hidden research must not fetch');
  const api=ctx.window.TenbaggerResearch;
  api.state.forward={asOf:'2026-10-13',strategyVersion:'1.0.0',rules:{patterns:{p:'<script>x</script>'}},candidates:[{name:'<img src=x>',code:'1',pattern:'p'}],records:[],warnings:[]};
  const html=api.forward();assert(!html.includes('<script>x'));assert(!html.includes('<img src=x>'));
  assert(html.includes('미검증'));assert(html.includes('실체결'));assert(!html.includes('NaN'));assert(!html.includes('undefined'));
  return ctx;
}
test('전향 표시 이스케이프·미검증·격리와 변이',()=>{
  viewProbe();
  assert.throws(()=>viewProbe(source.replaceAll('esc(c.name)','c.name')),assert.AssertionError);
});

test('API 날짜·기록 유지, 404만 초기 스냅샷, 오류를 0건으로 숨기지 않음',async()=>{
  const old=globalThis.fetch;
  const data={schemaVersion:1,records:[{id:'locked'}],candidates:[]};let fallback=0;
  const ctx={request:new Request('https://jkquant.pages.dev/api/tenbagger-research'),env:{ASSETS:{fetch:async()=>{fallback++;return Response.json(data);}}}};
  try{
    globalThis.fetch=async()=>Response.json(data);
    let r=await onRequestGet(ctx);assert.equal(r.status,200);assert.equal((await r.json()).records[0].id,'locked');
    globalThis.fetch=async()=>new Response('',{status:404});r=await onRequestGet(ctx);
    assert.equal((await r.json()).dataSource,'initial_locked_snapshot');assert.equal(fallback,1);
    globalThis.fetch=async()=>new Response('',{status:503});r=await onRequestGet(ctx);
    assert.equal(r.status,502);assert.equal((await r.json()).ok,false);assert.equal(fallback,1);
    globalThis.fetch=async()=>Response.json({schemaVersion:1,records:'invalid',candidates:[]});r=await onRequestGet(ctx);assert.equal(r.status,502);
  }finally{globalThis.fetch=old;}
});

test('자료 브랜치·원천 보관·저장 후 알림·실주문 없는 workflow',()=>{
  const w=fs.readFileSync('.github/workflows/tenbagger-forward.yml','utf8');
  assert.match(w,/ref: scalping-data/);assert.match(w,/actions\/upload-artifact@v4/);
  assert(w.indexOf('push-scalping-data.sh')<w.indexOf('$WORKER/research-note'));
  assert.match(w,/secrets\.AUTOTRADE_KEY/);assert(!w.includes('scalping-auto-promotion'));
});
