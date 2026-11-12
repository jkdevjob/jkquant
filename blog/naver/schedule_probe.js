// 발행 창의 '예약' 발행 칸 구조를 살핀다(STRATEGY_LAB E1 · 2026-11-12). 로그인된 CDP 브라우저(9222)와 열린 글쓰기 화면이 필요하다.
// usage: node schedule_probe.js        — '예약'을 눌러 보고 날짜·시·분 칸의 HTML 과 스크린샷(schedule_probe.png)을 남긴다. 발행하지 않는다.
const {getEditor}=require('./ed_common');
(async()=>{
  const {b,p,f}=await getEditor();
  const L=f.locator('[class*="layer_publish"]');
  if(!(await L.count())){ await f.locator('button[class*="publish_btn"]').first().click(); await p.waitForTimeout(2500); }
  const r2=f.locator('#radio_time2'); if(await r2.count()) await r2.check({force:true}).catch(()=>{}); else await L.getByText('예약',{exact:true}).first().click().catch(()=>{});
  await p.waitForTimeout(1200);
  const info=await f.evaluate(()=>{const l=document.querySelector('[class*="layer_publish"]');
    const t=[...l.querySelectorAll('*')].find(e=>e.children.length&&/발행 시간/.test(e.innerText||'')&&e.querySelector('input[type=radio]'));
    const box=t||l;
    return {checked:[...l.querySelectorAll('input[type=radio]')].filter(x=>x.checked).map(x=>x.id),
      selects:[...l.querySelectorAll('select')].map(s=>({cls:s.className,val:s.value,opts:[...s.options].slice(0,6).map(o=>o.value)})),
      inputs:[...l.querySelectorAll('input:not([type=radio]):not([type=checkbox])')].map(i=>({id:i.id,cls:i.className,val:i.value,ph:i.placeholder})),
      html:box.outerHTML.slice(0,4000)};});
  console.log(JSON.stringify(info,null,1));
  await p.screenshot({path:'schedule_probe.png'});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
