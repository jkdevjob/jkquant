// usage: node verify_fill.js <post.json>
const {getEditor}=require('./ed_common');
const fs=require('fs');
const post=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
(async()=>{
  const {b,f}=await getEditor();
  const doc=await f.evaluate(()=>[...document.querySelectorAll('.se-components-wrap > .se-component')].map(c=>({
    type:c.className.split(' ')[1],
    paras:[...c.querySelectorAll(':scope .se-module-text:not(.se-caption) .se-text-paragraph, :scope.se-documentTitle .se-text-paragraph')].map(x=>x.innerText.trim()).filter(Boolean),
    caption:c.querySelector('.se-caption')?c.querySelector('.se-caption').innerText.trim():null,
    links:[...c.querySelectorAll('[data-href]')].map(a=>a.getAttribute('data-href')),
    img:!!c.querySelector('img[src^="https://blogfiles"]')})));
  const title=doc.find(c=>c.type==='se-documentTitle').paras[0];
  const ed=doc.filter(c=>c.type==='se-text').flatMap(c=>c.paras);
  const strip=h=>h.replace(/<[^>]+>/g,'').trim();
  const exp=[]; for(const bl of post.blocks){ if(bl.t==='p') exp.push(...bl.text.split('\n')); else exp.push(...bl.attr.map(strip)); }
  let bad=0; const n=Math.max(ed.length,exp.length);
  for(let i=0;i<n;i++) if(ed[i]!==exp[i]){ bad++; console.log('DIFF',i,'\n ED:',(ed[i]||'').slice(0,100),'\n EX:',(exp[i]||'').slice(0,100)); }
  const caps=doc.filter(c=>c.type==='se-image').map(c=>c.caption);
  const expCaps=post.blocks.filter(x=>x.t==='img').map(x=>x.cap);
  console.log('title ok',title===post.title,'| paras',ed.length,'/',exp.length,'mismatch',bad);
  console.log('captions ok',JSON.stringify(caps.map((c,i)=>c===expCaps[i])),'| images uploaded',doc.filter(c=>c.img).length);
  console.log('links',JSON.stringify(doc.flatMap(c=>c.links)));
  await b.close();
})();
