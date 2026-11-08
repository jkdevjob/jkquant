// 블로그 카테고리를 만든다(사용자 지시 2026-11-08 "카테고리 분류도 잘해서 올리고"). 로그인된 CDP 브라우저(9222)가 필요하다.
// usage: node category_setup.js [--go]      --go 없이는 추가만 해 보고 저장(확인)하지 않는다.
// 이미 있는 카테고리('경제' 등)는 건드리지 않는다. 없는 이름만 맨 아래에 1단계 카테고리로 추가하고 공개로 둔다.
const {chromium}=require('playwright');
const WANT=['IT·과학','사회','정치','국제','연예·방송','스포츠','생활·건강'];
const GO=process.argv.includes('--go');
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0]; const p=await ctx.newPage(); await p.setViewportSize({width:1400,height:1100});
  p.on('dialog',d=>{console.log('dialog:',d.message()); d.accept();});
  await p.goto('https://admin.blog.naver.com/maniacjk/config/blog',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
  const f=p.frame({name:'papermain'});
  const names=async()=>f.evaluate(()=>{ const out=[]; document.querySelectorAll('[class*="tree"] a, [class*="tree"] span').forEach(e=>{ const t=(e.innerText||'').trim(); if(t&&t.length<30) out.push(t); }); return out; });
  const before=await names(); console.log('before:',JSON.stringify(before));
  const has=n=>before.some(t=>t.replace(/\(\d+\)$/,'').trim()===n);
  const todo=WANT.filter(n=>!has(n)); console.log('to add:',JSON.stringify(todo));
  for(const n of todo){
    // 맨 위('카테고리 전체보기')를 고른 뒤 추가해야 1단계 카테고리가 된다(하위 카테고리를 고른 채 추가하면 그 아래 2단계로 들어간다).
    await f.getByText('카테고리 전체보기',{exact:false}).first().click(); await p.waitForTimeout(600);
    await f.locator('img._addCategoryView').first().click(); await p.waitForTimeout(900);
    const inp=f.locator('#category_name'); await inp.click(); await inp.fill(''); await inp.type(n,{delay:20}); await p.waitForTimeout(300);
    await inp.press('Tab'); await p.waitForTimeout(500);
    console.log('added',n);
  }
  const after=await names(); console.log('after (unsaved):',JSON.stringify(after));
  await p.screenshot({path:'category_setup.png'});
  if(!GO||!todo.length){ console.log(todo.length?'dry run — not saved':'nothing to add'); await p.close(); await b.close(); return; }
  await f.locator('#submit_button').click(); await p.waitForTimeout(4000);
  await p.goto('https://admin.blog.naver.com/maniacjk/config/blog',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
  const f2=p.frame({name:'papermain'});
  const saved=await f2.evaluate(()=>{ const out=[]; document.querySelectorAll('[class*="tree"] a, [class*="tree"] span').forEach(e=>{ const t=(e.innerText||'').trim(); if(t&&t.length<30) out.push(t); }); return out; });
  console.log('saved:',JSON.stringify(saved));
  const missing=WANT.filter(n=>!saved.some(t=>t.replace(/\(\d+\)$/,'').trim()===n));
  console.log(missing.length?'MISSING '+JSON.stringify(missing):'CATEGORIES OK');
  await p.close(); await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
