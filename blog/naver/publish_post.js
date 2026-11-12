// usage: node publish_post.js <post.json> [--at HH:M0 [--date YYYY-MM-DD]] [--go]   (without --go: set everything and stop before clicking 발행)
// --at: 네이버 '예약' 발행(실험 E1, 2026-11-13 구조 확인). 시각은 한국 시간, 분은 10분 단위. 날짜 기본값은 오늘(한국).
//   발행 창의 '예약'(#radio_time2) → 날짜(input_date, jQuery UI 달력) · 시(select.hour_option) · 분(select.minute_option)을 고른 뒤
//   화면에서 다시 읽어 같을 때만 진행한다. 달력·시각은 브라우저 시간대를 따르므로(11/13: 서버 브라우저가 UTC 라 9시간 어긋남)
//   브라우저 시간대가 Asia/Seoul 이 아니면 CDP 로 바꾸고, 그래도 아니면 멈춘다. chrome 은 TZ=Asia/Seoul 로 띄운다(README 1).
const {getEditor}=require('./ed_common');
const fs=require('fs');
const post=JSON.parse(fs.readFileSync(process.argv[2],'utf8')); const GO=process.argv.includes('--go');
// 글마다 네이버 주제(post.topic, 예: '스타·연예인' '사회·정치' 'IT·컴퓨터'). 없으면 비즈니스·경제. 이름이 틀리면 설정 불일치로 발행하지 않는다.
const TOPIC=post.topic||'비즈니스·경제';
const argAfter=k=>{const i=process.argv.indexOf(k); return i>0? process.argv[i+1]||'' : '';};
const AT=argAfter('--at'); const DATE=argAfter('--date')||new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
if(AT && !/^([01]\d|2[0-3]):[0-5]0$/.test(AT)){ console.log('BAD --at (HH:M0, 10분 단위):',AT); process.exit(1); }
if(AT && !/^\d{4}-\d{2}-\d{2}$/.test(DATE)){ console.log('BAD --date (YYYY-MM-DD):',DATE); process.exit(1); }
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
  // 예약(--at)
  let schedOk=true, sched=null;
  if(AT){
    schedOk=false;
    const target=new Date(`${DATE}T${AT}:00+09:00`).getTime();
    if(target-Date.now()<15*60e3){ console.log('예약 시각이 15분 이내이거나 지났음 — 멈춤',DATE,AT); await b.close(); return; }
    let tz=await f.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone);
    if(tz!=='Asia/Seoul'){ const cdp=await p.context().newCDPSession(p); await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Seoul'}).catch(e=>console.log('tz override',e.message));
      await p.waitForTimeout(300); tz=await f.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone); }
    if(tz!=='Asia/Seoul'){ console.log('BROWSER TZ',tz,'— 예약 시각이 어긋나므로 멈춤(chrome 을 TZ=Asia/Seoul 로 띄울 것)'); await b.close(); return; }
    await f.locator('#radio_time2').check({force:true}); await p.waitForTimeout(1000);
    const [y,m,d]=DATE.split('-').map(Number); const [hh,mm]=AT.split(':');
    const dInp=f.locator('[class*="layer_publish"] input[class*="input_date"]');
    const dateVal=async()=>((await dInp.inputValue().catch(()=>''))||'').match(/\d+/g)?.map(Number)||[];
    let dv=await dateVal();
    if(dv[0]!==y||dv[1]!==m||dv[2]!==d){
      await dInp.click(); await p.waitForTimeout(700);
      const cal=f.locator('.ui-datepicker').first();
      for(let i=0;i<2;i++){ const t=await cal.locator('.ui-datepicker-title').innerText().catch(()=> '');
        if(+(t.match(/\d{4}/)||[])[0]===y && +(t.match(/(\d+)월/)||[])[1]===m) break;
        await cal.locator('.ui-datepicker-next').click(); await p.waitForTimeout(500); }
      const day=cal.locator('td:not(.ui-state-disabled) button').filter({hasText:new RegExp('^\\s*'+d+'\\s*$')}).first();
      if(await day.count()){ await day.click(); await p.waitForTimeout(700); } else console.log('DAY NOT SELECTABLE',DATE);
      dv=await dateVal();
    }
    const hs=f.locator('[class*="layer_publish"] select[class*="hour_option"]'), ms=f.locator('[class*="layer_publish"] select[class*="minute_option"]');
    await hs.selectOption(hh); await p.waitForTimeout(300); await ms.selectOption(mm); await p.waitForTimeout(600);
    const hv=await hs.inputValue(), mv=await ms.inputValue();
    const pre=await f.evaluate(()=>{const e=document.getElementById('radio_time2');return !!(e&&e.checked)});
    sched={date:dv.join('-'),time:`${hv}:${mv}`,pre,tz};
    schedOk= pre && dv[0]===y && dv[1]===m && dv[2]===d && hv===hh && mv===mm;
    console.log('schedule',JSON.stringify(sched), schedOk? 'match':'MISMATCH');
  }
  const st=await f.evaluate(()=>{const g=id=>{const e=document.getElementById(id);return e?e.checked:null};const l=document.querySelector('[class*="layer_publish"]');
    return {public:g('open_public'),comment:g('publish-option-comment'),sympathy:g('publish-option-sympathy'),search:g('publish-option-search'),setDefault:g('set-default'),notice:g('set-notice'),now:g('radio_time1'),
      cat:l.querySelector('button[class*="selectbox_button"]').innerText.trim(),topic:(l.innerText.match(/주제\n(.+)/)||[])[1],tags:[...l.querySelectorAll('span[id^="tag-item-"]')].map(x=>x.getAttribute('aria-label'))}});
  console.log(JSON.stringify(st));
  const ok=st.public&&st.comment&&st.sympathy&&st.search&&!st.setDefault&&!st.notice&&(AT? (!st.now&&schedOk) : st.now)&&(CAT? st.cat===CAT : ['핫이슈 분석','경제','게시판'].includes(st.cat))&&(st.topic||'').includes(TOPIC)&&JSON.stringify(st.tags)===JSON.stringify(post.tags);
  await p.screenshot({path:'pub_settings.png'});
  if(!ok){ console.log('SETTINGS MISMATCH — not publishing'); await b.close(); return; }
  if(!GO){ console.log('settings ok'+(AT?` (예약 ${DATE} ${AT} KST)`:'')+', stopped before publish'); await b.close(); return; }
  // final duplicate check right before publishing
  const r=await p.evaluate(async()=>{const x=await fetch('https://blog.naver.com/PostTitleListAsync.naver?blogId=maniacjk&currentPage=1&categoryNo=0&countPerPage=30');return await x.text()});
  if(r.includes(encodeURIComponent(post.title).replace(/%20/g,'+').slice(0,60))){ console.log('DUPLICATE TITLE FOUND — abort'); await b.close(); return; }
  await f.locator('[class*="layer_publish"] button[class*="confirm_btn"]').click();
  for(let i=0;i<30;i++){ await p.waitForTimeout(1000); if(!p.url().includes('Redirect=Write')) break; }
  await p.waitForTimeout(3000); console.log('URL after publish',p.url()+(AT?` | 예약 ${DATE} ${AT} KST`:''));
  await b.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
