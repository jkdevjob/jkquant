// 노트북(윈도우)에서 오늘 원고를 네이버 블로그에 자동으로 올린다(사용자 지시 2026-11-06:
// "전에 지피티가 하던 방식대로 너가 모든걸 자동으로 할수 없을까? 노트북 항상 켜놓으면").
// 클라우드 세션이 매일 아침 posts/<날짜>_*.json 을 저장소에 올리면, 작업 스케줄러가 이 스크립트를 30분마다 돌린다.
// 로그인은 노트북 전용 브라우저 프로필에 '로그인 상태 유지'로 한 번 해 두고 계속 쓴다. 저장소 파일은 고치지 않는다
// (결과는 %USERPROFILE%\.maniac-naver-work 에 남기고, 발행 기록은 클라우드 세션이 글 목록을 보고 커밋한다).
//
// usage: node local_publish.js              오늘(한국 시간) 원고 게시
//        node local_publish.js --login      처음 한 번: 보이는 창에서 로그인('로그인 상태 유지' 켜기)
//        node local_publish.js --check      로그인·원고만 확인하고 게시하지 않음
//        node local_publish.js --date YYYY-MM-DD
//        node local_publish.js --verify <logNo>   로그인 없이 공개 화면 확인만
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),os=require('os'),{execFile}=require('child_process');
// 하위 스크립트는 비동기로 돌린다. 동기 실행(execFileSync)으로 이 프로세스가 멈추면 Playwright 파이프를 못 읽어 브라우저도 멈춘다.
const execNode=(args,opts)=>new Promise((res,rej)=>execFile(process.execPath,args,opts,(e,out,err)=>e?rej(new Error((e.message+' '+(err||'')+(out||'')).slice(0,600))):res(out)));

const HERE=__dirname, POSTS=path.join(HERE,'posts');
const PROFILE=process.env.MANIAC_NAVER_PROFILE||path.join(os.homedir(),'.maniac-naver-profile');
const WORK=process.env.MANIAC_NAVER_WORK||path.join(os.homedir(),'.maniac-naver-work');
const argv=process.argv.slice(2), opt=k=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:null;};
const LOGIN=argv.includes('--login'), CHECK=argv.includes('--check');
const DATE=opt('--date')||new Date(Date.now()+9*3600e3).toISOString().slice(0,10);
const BLOG='maniacjk';
fs.mkdirSync(WORK,{recursive:true});

function log(...a){ const line=`[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); fs.appendFileSync(path.join(WORK,'publish.log'),line+'\n'); }
function status(o){ fs.writeFileSync(path.join(WORK,'last_status.json'),JSON.stringify({date:DATE,at:new Date().toISOString(),...o},null,1)); }
const unent=s=>s.replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

async function naverList(){
  const r=await fetch(`https://blog.naver.com/PostTitleListAsync.naver?blogId=${BLOG}&currentPage=1&categoryNo=0&countPerPage=30`);
  const t=await r.text();
  return [...t.matchAll(/"logNo":"(\d+)".*?"title":"(.*?)"/g)].map(m=>{let title=m[2]; try{title=decodeURIComponent(title.replace(/\+/g,' '));}catch(e){} return {logNo:m[1],title:unent(title)};});
}

async function verifyPublic(logNo,post){
  const r=await fetch(`https://blog.naver.com/PostView.naver?blogId=${BLOG}&logNo=${logNo}`,{headers:{'User-Agent':'Mozilla/5.0'}});
  const html=unent(await r.text());
  const head=post?post.title.slice(0,14):'';
  const imgs=(html.match(/se-component se-image/g)||[]).length;
  const inList=(await naverList()).some(x=>x.logNo===logNo);
  return {http:r.status, title:post?html.includes(head):null, imgs, inList};
}

async function launch(headless){
  const o={headless,args:['--remote-debugging-port=9222'],viewport:{width:1400,height:1000},locale:'ko-KR'};
  try{ return await chromium.launchPersistentContext(PROFILE,{...o,channel:'chrome'}); }
  catch(e){ log('설치된 Chrome 으로 못 띄움, Playwright Chromium 으로 다시 시도:',e.message.split('\n')[0]); return await chromium.launchPersistentContext(PROFILE,o); }
}
const hasAuth=async ctx=>(await ctx.cookies('https://nid.naver.com')).find(c=>c.name==='NID_AUT');

async function login(){
  const ctx=await launch(false);
  const p=ctx.pages()[0]||await ctx.newPage();
  await p.goto('https://nid.naver.com/nidlogin.login?mode=qrcode&url=https%3A%2F%2Fblog.naver.com%2FMyBlog.naver&locale=ko_KR&svctype=1');
  log("열린 창에서 네이버에 로그인하세요. QR(폰 네이버 앱 렌즈로 화면을 찍기) 또는 아이디 로그인 모두 됩니다. '로그인 상태 유지'를 꼭 켜세요. 10분 동안 기다립니다.");
  for(let i=0;i<300;i++){ const a=await hasAuth(ctx); if(a){ log('LOGGED_IN',a.expires>0?'(로그인 상태 유지 확인)':"(주의: 로그인 상태 유지가 꺼져 있어 창을 닫으면 풀립니다. 다시 --login 해서 켜 주세요)"); await p.waitForTimeout(3000); await ctx.close(); status({result:'LOGIN_OK',persistent:a.expires>0}); return; } await p.waitForTimeout(2000); }
  log('LOGIN_TIMEOUT'); status({result:'LOGIN_TIMEOUT'}); await ctx.close(); process.exitCode=4;
}

async function publish(){
  const files=fs.readdirSync(POSTS).filter(f=>f.startsWith(DATE+'_')&&f.endsWith('.json')).sort();
  if(!files.length){ log('NO_POST',DATE,'(오늘 원고가 아직 저장소에 없음)'); status({result:'NO_POST'}); return; }
  const postFile=path.join(POSTS,files[0]); const post=JSON.parse(fs.readFileSync(postFile,'utf8'));
  if(post.published){ log('ALREADY',post.published.url); status({result:'ALREADY',url:post.published.url}); return; }
  const found=(await naverList()).find(x=>x.title===post.title);
  if(found){ const url=`https://blog.naver.com/${BLOG}/${found.logNo}`; log('ALREADY_ON_NAVER',url); status({result:'ALREADY',url}); return; }

  const ctx=await launch(true);
  try{
    const p=ctx.pages()[0]||await ctx.newPage();
    await p.goto('https://blog.naver.com/MyBlog.naver',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3000);
    if(!(await hasAuth(ctx))||/nidlogin/.test(p.url())){ log('LOGIN_NEEDED','node local_publish.js --login 으로 다시 로그인하세요'); status({result:'LOGIN_NEEDED'}); process.exitCode=4; return; }
    if(CHECK){ log('CHECK_OK',post.title); status({result:'CHECK_OK',title:post.title}); return; }
    const run=async(script,...a)=>{ const out=await execNode([path.join(HERE,script),...a],{cwd:WORK,encoding:'utf8',timeout:600000,maxBuffer:8<<20}); log(script,'→',out.trim().split('\n').slice(-3).join(' | ')); return out; };
    const nImg=post.blocks.filter(b=>b.t==='img').length;
    await run('open_editor.js');
    await run('fill_post.js',postFile,path.join(POSTS,'assets',DATE));
    const vf=await run('verify_fill.js',postFile), caps=(vf.match(/captions ok (\[[^\]]*\])/)||[])[1]||'[false]';
    if(!/title ok true/.test(vf)||!/mismatch 0\b/.test(vf)||caps.includes('false')||!new RegExp(`images uploaded ${nImg}\\b`).test(vf)) throw new Error('편집기 내용이 원고와 다름 — 게시하지 않음');
    if(!/settings ok/.test(await run('publish_post.js',postFile))) throw new Error('발행 설정이 맞지 않음 — 게시하지 않음');
    const go=await run('publish_post.js',postFile,'--go'), m=go.match(/URL after publish https:\/\/blog\.naver\.com\/maniacjk\/(\d+)/);
    if(!m) throw new Error('발행 주소를 찾지 못함: '+go.trim().slice(-200));
    await p.waitForTimeout(5000);
    const v=await verifyPublic(m[1],post), url=`https://blog.naver.com/${BLOG}/${m[1]}`;
    const ok=v.http===200&&v.title&&v.imgs===nImg&&v.inList;
    log(ok?'PUBLISHED':'PUBLISHED_UNVERIFIED',url,JSON.stringify(v));
    status({result:ok?'PUBLISHED':'PUBLISHED_UNVERIFIED',url,title:post.title,check:v});
  } finally { await ctx.close().catch(()=>{}); }
}

(async()=>{
  if(opt('--verify')){ console.log(JSON.stringify(await verifyPublic(opt('--verify'),null))); return; }
  if(LOGIN) return login();
  return publish();
})().catch(e=>{ log('ERROR',e.message.split('\n')[0]); status({result:'ERROR',error:e.message.split('\n')[0]}); process.exitCode=1; });
