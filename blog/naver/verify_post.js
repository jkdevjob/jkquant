const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
  // logged-out (fresh) browser to confirm public visibility
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({locale:'ko-KR',viewport:{width:1280,height:1000}});
  const p=await ctx.newPage();
  await p.goto('https://blog.naver.com/PostView.naver?blogId=maniacjk&logNo='+process.argv[2]+'',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(5000);
  const r=await p.evaluate(()=>{
    const main=document.querySelector('.se-main-container');
    const title=(document.querySelector('.se-title-text, .pcol1')||{}).innerText;
    if(!main) return {title, err:'no main', body:document.body.innerText.slice(0,500)};
    const comps=[...main.children].map(c=>({cls:c.className.split(' ').slice(0,3).join('.'),
      text:(c.innerText||'').replace(/\n+/g,' ⏎ ').slice(0,120),
      imgs:[...c.querySelectorAll('img')].map(i=>({src:i.src.slice(0,70),w:i.naturalWidth,h:i.naturalHeight,complete:i.complete})),
      caption:c.querySelector('.se-caption')?c.querySelector('.se-caption').innerText:null,
      links:[...c.querySelectorAll('a')].map(a=>a.href).filter(h=>!h.startsWith('javascript'))}));
    const tags=[...document.querySelectorAll('.post_tag a, .wrap_tag a, a[href*="tag"]')].map(a=>a.innerText.trim()).filter(t=>t.startsWith('#'));
    const cat=(document.querySelector('.blog2_series a, .pcol2 a, .category a')||{}).innerText;
    return {title, cat, comps, tags:[...new Set(tags)], bold:main.querySelectorAll('b,strong,.se-weight-bold, [style*="bold"]').length, bodyLen:main.innerText.length};
  });
  fs.writeFileSync('naver_view.json',JSON.stringify(r,null,1));
  console.log('title:',r.title); console.log('cat:',r.cat,'tags:',JSON.stringify(r.tags),'bold:',r.bold);
  if(r.comps) for(const c of r.comps) console.log(c.cls,'|',c.text.slice(0,70),'| imgs',JSON.stringify(c.imgs.map(i=>i.w+'x'+i.h+(i.complete?'':'(loading)'))),'| cap',c.caption?c.caption.slice(0,30):'-','| links',c.links.length);
  // full-page screenshots in segments
  await p.screenshot({path:'pub_view_full.png',fullPage:true});
  await b.close();
})();
