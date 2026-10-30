const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({locale:'ko-KR',viewport:{width:1280,height:1000}});
  const p=await ctx.newPage();
  await p.goto('https://blog.naver.com/PostView.naver?blogId=maniacjk&logNo='+process.argv[2]+'',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(4000);
  const imgs=p.locator('.se-main-container .se-component.se-image');
  const n=await imgs.count();
  for(let i=0;i<n;i++){
    const c=imgs.nth(i); await c.scrollIntoViewIfNeeded(); await p.waitForTimeout(2500);
    const info=await c.evaluate(el=>{const im=el.querySelector('img');const next=el.nextElementSibling;return {w:im.naturalWidth,h:im.naturalHeight,src:im.src.slice(0,90),cap:el.querySelector('.se-caption')?.innerText,
      below:next?next.innerText:null, belowLinks:next?[...next.querySelectorAll('a')].map(a=>a.href):[]}});
    console.log(JSON.stringify(info,null,1));
    const bb=await c.boundingBox();
    await p.screenshot({path:`view_img${i+1}.png`,clip:{x:0,y:Math.max(0,bb.y-40),width:1280,height:Math.min(1000,bb.height+170)}});
  }
  // public state hints & footer (comments/likes)
  const meta=await p.evaluate(()=>({cat:document.querySelector('.blog2_series')?.innerText, comment:!!document.querySelector('[class*="btn_comment"], .area_comment, #Comi224456244734'), sympathy:!!document.querySelector('[class*="u_likeit"], .area_sympathy')}));
  console.log('meta',JSON.stringify(meta));
  await b.close();
})();
