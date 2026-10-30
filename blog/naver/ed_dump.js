const {getEditor}=require('./ed_common');
(async()=>{
  const {b,p,f}=await getEditor();
  const comps=await f.evaluate(()=>[...document.querySelectorAll('.se-components-wrap > .se-component')].map((c,i)=>i+' '+c.className.split(' ')[1]+' :: '+(c.innerText||'').replace(/\n/g,' ⏎ ').slice(0,300)));
  console.log(comps.join('\n'));
  await b.close();
})();
