import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {onRequestGet} from '../functions/api/tenbagger-research.js';

const ui=fs.readFileSync('scalping.html','utf8'),source=fs.readFileSync('tenbagger-gpt.js','utf8');
function fn(name){const at=ui.indexOf('function '+name+'(');let start=ui.indexOf('{',at),i=start,d=0;for(;i<ui.length;i++){if(ui[i]==='{')d++;if(ui[i]==='}'&&!--d)break;}return ui.slice(at,i+1);}

test('연구 탭 복원·직접 링크와 기존 전략 경로 보존',()=>{
  assert.match(ui,/<title>JK 투자 — 연구\(지피티\)<\/title>/);
  assert.match(ui,/<div class="kicker">GPT Research<\/div><h1>JK <span class="v">투자<\/span> 연구/);
  assert.match(ui,/<div class="glogo">JK <span class="v">투자<\/span> 연구<\/div>/);
  assert.match(ui,/data-strategy="tenbagger"/);
  assert.match(ui,/id="scVer">v1\.44\.0/);
  const calls=[],ctx={location:{search:'?strategy=tenbagger',hash:''},URLSearchParams,SCALP_PREFS:{strategyTab:'opening'},showStrategy:n=>calls.push(n)};
  vm.runInNewContext(fn('restoreStrategy'),ctx);ctx.restoreStrategy();
  assert.equal(calls.pop(),'tenbagger');
  ctx.location={search:'',hash:'#tenbagger'};ctx.restoreStrategy();assert.equal(calls.pop(),'tenbagger');
  for(const name of ['daily','duel','opening','daytrading','crypto','soxl']){ctx.location={search:'?strategy='+name,hash:''};ctx.restoreStrategy();assert.equal(calls.pop(),name);}
  assert.match(fs.readFileSync('jk-access.js','utf8'),/path:'\/scalping',label:'연구\(지피티\)',mode:'admin'/);
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
