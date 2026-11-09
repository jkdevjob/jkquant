// 이미 올라간 글의 제목만 바꾼다(사용자 지시 2026-11-10 "오늘꺼 제목이 별로다 잭슨황 이슈를 강조 했어야지").
// 로그인된 CDP 브라우저(9222)가 필요하다. 본문·카테고리·주제·태그는 건드리지 않는다.
// usage: node retitle_post.js <logNo> "<새 제목>" [--go]      --go 없이는 제목만 바꿔 보고 발행(수정 완료)하지 않는다.
const {chromium}=require('playwright');
const [logNo,newTitle]=process.argv.slice(2); const GO=process.argv.includes('--go');
if(!/^\d+$/.test(logNo||'')||!newTitle){ console.error('usage: node retitle_post.js <logNo> "<새 제목>" [--go]'); process.exit(2); }
const titleOf=f=>f.evaluate(()=>{const p=document.querySelector('.se-documentTitle .se-text-paragraph');if(!p)return null;const c=p.cloneNode(true);c.querySelectorAll('.se-placeholder').forEach(x=>x.remove());return c.innerText.trim();});
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0];
  let p=ctx.pages().find(x=>/Redirect=Update|PostUpdate|postupdate/i.test(x.url())&&x.url().includes(logNo));
  if(!p){
    p=await ctx.newPage(); await p.setViewportSize({width:1400,height:1000});
    p.on('dialog',d=>{console.log('dialog',d.message());d.dismiss();});
    await p.goto(`https://blog.naver.com/maniacjk/${logNo}`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(4000);
    const view=p.frame({name:'mainFrame'});
    // '수정하기'는 숨은 메뉴 안에 있어 화면 클릭이 안 된다(11/10 확인) — 페이지 안에서 직접 click() 한다.
    const ok=await view.evaluate(()=>{const a=document.querySelector('a._modifyPost'); if(!a) return false; a.click(); return true;});
    if(!ok) throw new Error('수정하기 link not found'); await p.waitForTimeout(8000);
  }
  console.log('edit URL',p.url());
  const f=p.frame({name:'mainFrame'});
  if(!f) throw new Error('editor frame not found');
  await f.waitForSelector('.se-documentTitle .se-text-paragraph',{timeout:20000});
  for(const t of ['취소']){ const l=f.getByRole('button',{name:t,exact:true}); if(await l.count()&&await l.first().isVisible()){ await l.first().click(); console.log('clicked',t); await p.waitForTimeout(1500);} }
  const hl=f.locator('.se-help-layer-button-close'); if(await hl.count()&&await hl.first().isVisible()) await hl.first().click().catch(()=>{});
  const before=await titleOf(f); console.log('title before',JSON.stringify(before));
  if(before!==newTitle){
    const para=f.locator('.se-documentTitle .se-text-paragraph').first();
    await para.scrollIntoViewIfNeeded().catch(()=>{});
    // 제목 문단 전체를 선택한 뒤 새 제목으로 덮어쓴다. 선택이 제목과 다르면 끝에서 지우고 쓴다.
    await para.click({clickCount:3}); await p.waitForTimeout(300);
    const sel=await f.evaluate(()=>String(window.getSelection()).trim());
    if(sel!==before){
      console.log('selection mismatch, fallback',JSON.stringify(sel));
      await para.click(); await p.keyboard.press('End');
      for(let i=0;i<(before||'').length+5;i++) await p.keyboard.press('Backspace');
    }
    await p.keyboard.type(newTitle,{delay:8}); await p.waitForTimeout(500);
  }
  const after=await titleOf(f); console.log('title after',JSON.stringify(after));
  const comps=await f.locator('.se-components-wrap > .se-component').count(); console.log('components',comps);
  if(after!==newTitle){ console.log('TITLE MISMATCH — not publishing'); await b.close(); process.exitCode=1; return; }
  if(!GO){ await p.screenshot({path:'retitle.png'}); console.log('title set, stopped before publish'); await b.close(); return; }
  // 수정 화면에는 오른쪽 '도움말' 창이 열려 발행 버튼을 가린다(11/10 확인) — 먼저 닫는다.
  for(const s of ['.se-help-panel-close-button','.se-help-layer-button-close']){ const c=f.locator(s); if(await c.count()&&await c.first().isVisible()){ await c.first().click().catch(()=>{}); await p.waitForTimeout(800); } }
  const L=f.locator('[class*="layer_publish"]');
  if(!(await L.count())){ await f.locator('button[class*="publish_btn"]').first().click(); await p.waitForTimeout(2500); }
  const st=await f.evaluate(()=>{const l=document.querySelector('[class*="layer_publish"]');const g=id=>{const e=document.getElementById(id);return e?e.checked:null};
    return {cat:l.querySelector('button[class*="selectbox_button"]').innerText.trim(),topic:(l.innerText.match(/주제\n(.+)/)||[])[1],public:g('open_public'),search:g('publish-option-search'),
      tags:[...l.querySelectorAll('span[id^="tag-item-"]')].map(x=>x.getAttribute('aria-label'))};});
  console.log(JSON.stringify(st));
  await p.screenshot({path:'retitle_publish.png'});
  await f.locator('[class*="layer_publish"] button[class*="confirm_btn"]').click();
  for(let i=0;i<30;i++){ await p.waitForTimeout(1000); if(!/Redirect=Update|PostUpdate|postupdate/i.test(p.url())) break; }
  await p.waitForTimeout(3000); console.log('URL after update',p.url());
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
