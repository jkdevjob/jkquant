const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0];
  for(const pg of ctx.pages()) if(pg.url().includes('nidlogin')) await pg.close();
  const p=await ctx.newPage(); await p.setViewportSize({width:900,height:900});
  await p.goto('https://nid.naver.com/nidlogin.login?mode=qrcode&url=https%3A%2F%2Fblog.naver.com%2FMyBlog.naver&locale=ko_KR&svctype=1',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(3000);
  console.log('URL',p.url());
  console.log((await p.evaluate(()=>document.body.innerText)).slice(0,400).replace(/\n+/g,' | '));
  const qr=p.locator('#qrImage, .qr_img img, img[src*="qr"], canvas').first();
  if(await qr.count()){ const bb=await qr.boundingBox(); console.log('qr bbox',JSON.stringify(bb)); }
  await p.screenshot({path:'qr_full.png'});
  await b.close();
})();
