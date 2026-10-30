// usage: node insert_section.js <post.json> <compIndex> <fromBlock> <toBlockExclusive>
const {getEditor,pasteHTML}=require('./ed_common');
const fs=require('fs');
const [, , pf, ciA, fromA, toA]=process.argv; const post=JSON.parse(fs.readFileSync(pf,'utf8'));
const S='font-size:15px;color:#000000'; const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
(async()=>{
  const {b,p,f}=await getEditor(); const ci=+ciA;
  const texts=post.blocks.slice(+fromA,+toA).map(x=>x.text);
  const html=`<p><span style="${S}"><br></span></p>`+texts.map(t=>{const [h,bd]=t.split('\n');return `<p><span style="${S}"><br></span></p><p><span style="${S}"><b>${esc(h)}</b></span></p><p><span style="${S}">${esc(bd)}</span></p>`}).join('');
  const paras=f.locator('.se-components-wrap > .se-component').nth(ci).locator('.se-text-paragraph');
  const last=paras.nth((await paras.count())-1); await last.scrollIntoViewIfNeeded(); const bb=await last.boundingBox();
  console.log('bbox',JSON.stringify(bb)); await p.mouse.click(bb.x+60,bb.y+bb.height/2); await p.waitForTimeout(300); await p.keyboard.press('End'); await p.waitForTimeout(400);
  const foc=await f.evaluate(()=>[...document.querySelectorAll('.se-is-focused')].map(e=>[...document.querySelectorAll('.se-components-wrap > .se-component')].indexOf(e.closest('.se-component'))));
  if(!foc.includes(ci)){ console.log('ABORT focus',foc); await b.close(); return; }
  console.log('last para:',(await last.innerText()).slice(0,40));
  await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  await pasteHTML(p,f,html); await p.waitForTimeout(3500);
  console.log('paras in comp now:',await paras.count());
  await b.close();
})();
