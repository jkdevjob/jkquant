const {chromium}=require('playwright');
async function getEditor(){
  const b=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=b.contexts()[0];
  let p=ctx.pages().find(x=>x.url().includes('Redirect=Write'));
  if(!p) throw new Error('editor page not found');
  const f=p.frame({name:'mainFrame'});
  return {b,ctx,p,f};
}

async function pasteHTML(p,f,html){
  const inner=p.frames().filter(fr=>fr.parentFrame()===f && fr.name().startsWith('input_buffer'));
  if(!inner.length) throw new Error('no input buffer');
  return inner[0].evaluate((html)=>{const dt=new DataTransfer();dt.setData('text/html',html);dt.setData('text/plain',html.replace(/<[^>]+>/g,''));
    const t=document.activeElement||document.body; return t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));},html);
}
async function clickBox(p,loc,where){ // where: 'end'|'start'|'triple'
  await loc.scrollIntoViewIfNeeded().catch(()=>{});
  const bb=await loc.boundingBox(); if(!bb) throw new Error('no bbox');
  if(where==='triple'){ await p.mouse.click(bb.x+5,bb.y+bb.height/2,{clickCount:3}); return; }
  const x= where==='start'? bb.x+2 : bb.x+bb.width-2, y= where==='start'? bb.y+5 : bb.y+bb.height-5;
  await p.mouse.click(x,y);
}
async function dump(f,from=0){
  return f.evaluate((from)=>[...document.querySelectorAll('.se-components-wrap > .se-component')].slice(from).map((c,i)=>(i+from)+' '+c.className.split(' ')[1]+' :: '+(c.innerText||'').replace(/\n+/g,' ⏎ ').slice(0,160)+' | links='+[...c.querySelectorAll('[data-href],a')].length),from);
}
module.exports={getEditor,pasteHTML,clickBox,dump};
