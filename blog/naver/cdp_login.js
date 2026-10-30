const {chromium}=require('playwright');
const [,,code]=process.argv;
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0];
  const p=await ctx.newPage();
  await p.goto('https://nid.naver.com/nidlogin.login?mode=number&url=https%3A%2F%2Fblog.naver.com%2FMyBlog.naver&locale=ko_KR&svctype=1',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1200);
  if(!code){ console.log('ready, title:',await p.title(), 'has field', await p.locator('#OnetimeCode').count()); await p.close(); await b.close(); return; }
  await p.fill('#OnetimeCode',code.replace(/\D/g,''));
  await p.locator('[id="otnlog.login"]').click();
  await p.waitForTimeout(5000);
  for (const t of ['등록안함','나중에 하기','다음에 하기']) { const l=p.getByText(t,{exact:true}); if(await l.count()){ await l.first().click(); await p.waitForTimeout(3000); console.log('clicked',t);} }
  console.log('after login URL',p.url());
  await ctx.storageState({path:'state.json'});
  await p.goto('https://blog.naver.com/MyBlog.naver',{waitUntil:'domcontentloaded'}).catch(e=>console.log('nav err',e.message));
  await p.waitForTimeout(4000);
  console.log('MyBlog URL',p.url());
  await p.screenshot({path:'myblog.png'});
  const ck=(await ctx.cookies()).filter(c=>c.name.startsWith('NID_')).map(c=>c.name+':'+(c.expires>0?'persist':'session'));
  console.log(ck.join(' '));
  await b.close(); // disconnects only; browser keeps running
})();
