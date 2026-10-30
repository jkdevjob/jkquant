// usage: node fill_post.js <post.json> <imgdir>
// Fills an already-open, empty SmartEditor page (Redirect=Write) with the post. Does NOT publish.
const {getEditor,pasteHTML}=require('./ed_common');
const fs=require('fs'),path=require('path');
const [, , postFile, imgDir, startArg, modeArg]=process.argv;
const START=startArg?parseInt(startArg):0; let ATTR_ONLY=modeArg==='attronly';
const post=JSON.parse(fs.readFileSync(postFile,'utf8'));
const S='font-size:15px;color:#000000', G='font-size:13px;color:#777777';
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function secHTML(texts){ return texts.map(t=>{const [h,b]=t.split('\n');return `<p><span style="${S}"><br></span></p><p><span style="${S}"><b>${esc(h)}</b></span></p><p><span style="${S}">${esc(b)}</span></p>`}).join(''); }
const attrHTML=lines=>lines.map(l=>`<p><span style="${G}">${l}</span></p>`).join('');
async function pasteConfirmed(p,f,html,ci,expectAdd){
  const cnt=()=>f.locator('.se-components-wrap > .se-component').nth(ci).locator('.se-text-paragraph').count();
  const before=await cnt();
  await pasteHTML(p,f,html);
  for(let k=0;k<12;k++){ await p.waitForTimeout(500); if(await cnt()>=before+expectAdd-1) { await p.waitForTimeout(1500); return true; } }
  return false;
}
(async()=>{
  const {b,p,f}=await getEditor();
  const comps=()=>f.locator('.se-components-wrap > .se-component');
  const focusedIdx=()=>f.evaluate(()=>[...document.querySelectorAll('.se-is-focused')].map(e=>[...document.querySelectorAll('.se-components-wrap > .se-component')].indexOf(e.closest('.se-component'))));
  async function caretEndOfLast(){ // click at end of last paragraph of last text component
    const n=await comps().count(); const ci=n-1;
    const paras=comps().nth(ci).locator('.se-text-paragraph'); const last=paras.nth((await paras.count())-1);
    await last.scrollIntoViewIfNeeded(); const bb=await last.boundingBox();
    const isEmpty=!(await last.innerText()).trim();
    let fi=[];
    for(let attempt=0;attempt<3 && !fi.includes(ci);attempt++){
      const bx=await last.boundingBox();
      if(isEmpty) await p.mouse.click(bx.x+20, bx.y+bx.height/2);
      else if(attempt===1 && bx.height<30) await p.mouse.click(bx.x+60, bx.y+bx.height/2); // single-line: mid-click is safe
      else await p.mouse.click(bx.x+bx.width-2, bx.y+bx.height-5);
      await p.keyboard.press('End'); await p.waitForTimeout(500);
      fi=await focusedIdx();
    }
    if(!fi.includes(ci)) throw new Error('focus mismatch '+fi+' vs '+ci);
    return {ci, empty:!(await last.innerText()).trim()};
  }
  const blocks=post.blocks;
  if(START===0){
  // title + intro
  const titleText=await f.evaluate(()=>{const p=document.querySelector('.se-documentTitle .se-text-paragraph');if(!p)return '';const c=p.cloneNode(true);c.querySelectorAll('.se-placeholder').forEach(x=>x.remove());return c.innerText.trim();});
  console.log('existing title:',JSON.stringify(titleText));
  if(!titleText){
    await f.locator('.se-documentTitle .se-text-paragraph').first().click();
    await p.keyboard.type(post.title,{delay:4});
  }
  await f.locator('.se-component.se-text .se-text-paragraph').first().click();
  await p.keyboard.type(blocks[0].text,{delay:2}); await p.waitForTimeout(500);
  }
  let i=START||1, imgIdx=0;
  while(i<blocks.length){
    const bl=blocks[i];
    if(bl.t==='img' && ATTR_ONLY){ ATTR_ONLY=false;
      const {ci,empty}=await caretEndOfLast(); if(!empty){ await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
      if(!await pasteConfirmed(p,f,attrHTML(bl.attr),ci,bl.attr.length)) throw new Error('attr paste not applied'); console.log('attr only done',bl.file,'comp',ci); i++; continue; }
    if(bl.t==='img'){
      await caretEndOfLast();
      const before=await f.locator('.se-component.se-image').count();
      const [fc]=await Promise.all([p.waitForEvent('filechooser',{timeout:15000}), f.locator('button.se-image-toolbar-button').first().click()]);
      await fc.setFiles(path.join(imgDir,bl.file));
      for(let k=0;k<40;k++){ await p.waitForTimeout(1000); if(await f.locator('.se-component.se-image').count()>before){ const ok=await f.evaluate(n=>{const im=document.querySelectorAll('.se-component.se-image')[n].querySelector('img');return !!(im&&im.src.startsWith('https://blogfiles'))},before); if(ok) break; } }
      await p.waitForTimeout(1500);
      const comp=f.locator('.se-component.se-image').nth(before);
      const img=comp.locator('img').first(); await img.scrollIntoViewIfNeeded(); await img.click(); await p.waitForTimeout(600);
      await comp.locator('.se-caption').first().click(); await p.waitForTimeout(300);
      await p.keyboard.type(bl.cap,{delay:2}); await p.waitForTimeout(500);
      // attribution into the text component after the image
      const {ci,empty}=await caretEndOfLast();
      if(!empty){ await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
      if(!await pasteConfirmed(p,f,attrHTML(bl.attr),ci,bl.attr.length)) throw new Error('attr paste not applied at comp '+ci);
      console.log('image done',bl.file,'-> comp',ci-1);
      imgIdx++; i++;
    } else {
      const texts=[]; while(i<blocks.length && blocks[i].t==='p'){ texts.push(blocks[i].text); i++; }
      const {ci,empty}=await caretEndOfLast();
      if(!empty){ await p.keyboard.press('Enter'); await p.waitForTimeout(300); }
      if(!await pasteConfirmed(p,f,`<p><span style="${S}"><br></span></p>`+secHTML(texts),ci,texts.length*2)) throw new Error('section paste not applied at comp '+ci+' (block '+(i-texts.length)+')');
      console.log('section pasted',texts.length,'paras into comp',ci);
    }
  }
  await p.screenshot({path:path.join(imgDir,'filled.png')});
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
