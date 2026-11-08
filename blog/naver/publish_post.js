// usage: node publish_post.js <post.json> [--go]   (without --go: set everything and stop before clicking 발행)
const {getEditor}=require('./ed_common');
const fs=require('fs');
const post=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const GO=process.argv.includes('--go');
// 글마다 네이버 주제(post.topic, 예: '스타·연예인' '사회·정치' 'IT·컴퓨터'). 없으면 비즈니스·경제. 이름이 틀리면 설정 불일치로 발행하지 않는다.
const TOPIC=post.topic||'비즈니스·경제';
(async()=>{
  const {b,p,f}=await getEditor();
  const L=f.locator('[class*="layer_publish"]');
  if(!(await L.count())){ await f.locator('button[class*="publish_btn"]').first().click(); await p.waitForTimeout(2500); }
  const exact=s=>new RegExp('^\\s*'+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*$');
  // 주제 선택 창(theme_list_wrap)이 열린 채로 남아 있으면 먼저 닫는다(열려 있으면 카테고리 버튼이 화면에 없다).
  const picker=L.locator('[class*="theme_list_wrap"]');
  if(await picker.count()){ const c=L.locator('button[class*="cancel_btn"]'); if(await c.count()){ await c.first().click(); await p.waitForTimeout(800); } }
  // category 먼저 (post.category, 예: 'IT·과학'). 카테고리를 바꾸면 네이버가 주제를 '주제 선택 안 함' 등으로 되돌리므로
  // 주제는 그 뒤에 고른다(11/09 확인). 카테고리가 없으면 지금 선택된 것을 그대로 둔다. 이름이 목록에 없으면 설정 불일치로 멈춘다.
  const CAT=post.category||'';
  const catNow=async()=>((await L.locator('button[class*="selectbox_button"]').first().innerText().catch(()=>''))||'').trim();
  if(CAT && (await catNow())!==CAT){
    // 목록은 div.option_list_layer[role=menu] 안의 label.radio_label 이다(11/09 확인). 이미 열려 있으면 다시 누르지 않는다(누르면 닫힌다).
    const sb=L.locator('button[class*="selectbox_button"]').first();
    if((await sb.getAttribute('aria-expanded'))!=='true'){ await sb.click(); await p.waitForTimeout(700); }
    const menu=L.locator('[class*="option_list_layer"], [role="menu"]').first();
    const opt=menu.locator('label[class*="radio_label"]').filter({hasText:exact(CAT)}).first();
    if(await opt.count()) { await opt.click(); await p.waitForTimeout(1000); }
    else console.log('CATEGORY NOT FOUND:',CAT,'| options:',(await menu.innerText().catch(()=>'?')).replace(/\n+/g,' / '));
  }
  // topic: 주제 줄의 링크(set_theme__ a)를 눌러 선택 창을 열고, 창 안의 label 중 이름이 정확히 같은 것만 누른다.
  // (전체 화면에서 이름으로 찾으면 카테고리 버튼의 '스포츠' 같은 같은 글자를 누를 수 있다.)
  const topicNow=async()=>((await L.innerText().catch(()=>'')).match(/주제\n(.+)/)||[])[1]||'';
  const tNow=await topicNow();
  if(!tNow.includes(TOPIC)){
    const row=L.locator('[class^="set_theme__"] a').first();
    if(await row.count()) await row.click(); else await L.getByText(tNow.replace(/\s*>\s*$/,'').trim(),{exact:false}).first().click();
    await p.waitForTimeout(1200);
    const opt=picker.locator('label').filter({hasText:exact(TOPIC)}).first();
    if(await opt.count()){ await opt.click(); await p.waitForTimeout(400); await L.locator('button[class*="ok_btn"]').first().click(); await p.waitForTimeout(1000); }
    else { console.log('TOPIC NOT FOUND:',TOPIC); const c=L.locator('button[class*="cancel_btn"]'); if(await c.count()) await c.first().click(); await p.waitForTimeout(800); }
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
  const ok=st.public&&st.comment&&st.sympathy&&st.search&&!st.setDefault&&!st.notice&&st.now&&(CAT? st.cat===CAT : ['핫이슈 분석','경제','게시판'].includes(st.cat))&&(st.topic||'').includes(TOPIC)&&JSON.stringify(st.tags)===JSON.stringify(post.tags);
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
