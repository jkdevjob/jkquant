const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0];
  for(const pg of ctx.pages()) if(pg.url().includes('Redirect=Write')) await pg.close();
  const p=await ctx.newPage(); await p.setViewportSize({width:1400,height:1000});
  p.on('dialog',d=>{console.log('dialog',d.message());d.dismiss();});
  await p.goto('https://blog.naver.com/maniacjk?Redirect=Write',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(7000);
  const f=p.frame({name:'mainFrame'});
  // draft-restore popup ("작성 중인 글이 있습니다") -> start new
  for(const t of ['취소','새로 작성']){ const l=f.getByRole('button',{name:t,exact:true}); if(await l.count()&&await l.first().isVisible()){ await l.first().click(); console.log('clicked',t); await p.waitForTimeout(1500);} }
  const close=f.locator('.se-help-panel-close-button'); if(await close.count()) await close.first().click().catch(()=>{});
  // '사진·글감 검색' 안내 창(.se-help-layer)이 발행 버튼을 가린 적이 있다(11/05)
  const hl=f.locator('.se-help-layer-button-close'); if(await hl.count()&&await hl.first().isVisible()){ await hl.first().click().catch(()=>{}); console.log('closed help layer'); }
  await p.waitForTimeout(800);
  console.log('title empty:',!(await f.locator('.se-documentTitle').innerText()).trim(),'comps',await f.locator('.se-components-wrap > .se-component').count());
  console.log('My blog check:', await p.evaluate(()=>location.href));
  await p.screenshot({path:'ed_open.png'});
  await b.close();
})();
