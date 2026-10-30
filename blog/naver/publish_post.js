// usage: node publish_post.js <post.json> [--go]   (without --go: set everything and stop before clicking 발행)
const {getEditor}=require('./ed_common');
const fs=require('fs');
const post=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const GO=process.argv.includes('--go');
(async()=>{
  const {b,p,f}=await getEditor();
  const L=f.locator('[class*="layer_publish"]');
  if(!(await L.count())){ await f.locator('button[class*="publish_btn"]').first().click(); await p.waitForTimeout(2500); }
  // topic
  const topicNow=((await L.innerText()).match(/주제\n(.+)/)||[])[1]||'';
  if(!/비즈니스·경제/.test(topicNow)){
    await L.getByText(topicNow.replace(/\s*>\s*$/,'').trim(),{exact:false}).first().click(); await p.waitForTimeout(1200);
    await f.getByText('비즈니스·경제',{exact:true}).first().click(); await p.waitForTimeout(300);
    await f.getByRole('button',{name:'확인',exact:true}).last().click(); await p.waitForTimeout(1000);
  }
  // tags
  const tags=()=>f.evaluate(()=>[...document.querySelectorAll('[class*="layer_publish"] span[id^="tag-item-"]')].map(x=>x.getAttribute('aria-label')));
  const inp=f.locator('#tag-input'); await inp.click();
  for(const t of await tags()){ if(!post.tags.includes(t)){ /* remove unrelated auto tag(s): backspace removes last */ } }
  let cur=await tags(); let guard=10; while(cur.some(t=>!post.tags.includes(t)) && guard--){ await inp.click(); await p.keyboard.press('Backspace'); await p.waitForTimeout(300); cur=await tags(); }
  for(const t of post.tags){ if((await tags()).includes(t)) continue; await inp.click(); await p.keyboard.type(t,{delay:15}); await p.waitForTimeout(400); await p.keyboard.press('Enter'); await p.waitForTimeout(500); }
  const st=await f.evaluate(()=>{const g=id=>{const e=document.getElementById(id);return e?e.checked:null};const l=document.querySelector('[class*="layer_publish"]');
    return {public:g('open_public'),comment:g('publish-option-comment'),sympathy:g('publish-option-sympathy'),search:g('publish-option-search'),setDefault:g('set-default'),notice:g('set-notice'),now:g('radio_time1'),
      cat:l.querySelector('button[class*="selectbox_button"]').innerText.trim(),topic:(l.innerText.match(/주제\n(.+)/)||[])[1],tags:[...l.querySelectorAll('span[id^="tag-item-"]')].map(x=>x.getAttribute('aria-label'))}});
  console.log(JSON.stringify(st));
  const ok=st.public&&st.comment&&st.sympathy&&st.search&&!st.setDefault&&!st.notice&&st.now&&['핫이슈 분석','경제','게시판'].includes(st.cat)&&/비즈니스·경제/.test(st.topic||'')&&JSON.stringify(st.tags)===JSON.stringify(post.tags);
  await p.screenshot({path:'pub_settings.png'});
  if(!ok){ console.log('SETTINGS MISMATCH — not publishing'); await b.close(); return; }
  if(!GO){ console.log('settings ok, stopped before publish'); await b.close(); return; }
  // final duplicate check right before publishing
  const r=await p.evaluate(async()=>{const x=await fetch('https://blog.naver.com/PostTitleListAsync.naver?blogId=maniacjk&currentPage=1&categoryNo=0&countPerPage=30');return await x.text()});
  if(r.includes(encodeURIComponent(post.title).replace(/%20/g,'+').slice(0,60))){ console.log('DUPLICATE TITLE FOUND — abort'); await b.close(); return; }
  await f.locator('[class*="layer_publish"] button[class*="confirm_btn"]').click();
  for(let i=0;i<30;i++){ await p.waitForTimeout(1000); if(!p.url().includes('Redirect=Write')) break; }
  await p.waitForTimeout(3000); console.log('URL after publish',p.url());
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
