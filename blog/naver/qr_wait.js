const {chromium}=require('playwright');
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0];
  const start=Date.now();
  while(Date.now()-start<200000){
    const ck=(await ctx.cookies('https://nid.naver.com')).map(c=>c.name);
    const pg=ctx.pages().find(x=>/nidlogin|blog\.naver\.com/.test(x.url()));
    const url=pg?pg.url():'';
    if(ck.includes('NID_AUT')){ console.log('LOGGED_IN',url); break; }
    if(pg && /nidlogin/.test(url)){ const t=await pg.evaluate(()=>document.body.innerText).catch(()=>''); if(/만료|다시 시도|새로고침/.test(t)&&!/남은 시간/.test(t)){ console.log('EXPIRED'); break; } }
    await new Promise(r=>setTimeout(r,2000));
  }
  if(Date.now()-start>=200000) console.log('TIMEOUT');
  await b.close();
})();
