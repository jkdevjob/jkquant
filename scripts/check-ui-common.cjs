// 공용 화면 도구(jk-ui.js) · 모의 성과 표 첫 칸 — 2026-10-07 사용자 요청
//   "전략 세션 줄바꿈해서 최종이 스크롤 없이도 보이게 · 오른쪽 중간위치쯤에 탑으로 가는 버튼 · 모든 페이지에"
// 실제 파일 글자를 가짜 DOM 에서 돌려 값으로 본다.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const ROOT=path.join(__dirname,'..');
const ui=fs.readFileSync(path.join(ROOT,'jk-ui.js'),'utf8');
const html=fs.readFileSync(process.argv[2]||path.join(ROOT,'index.html'),'utf8');
const PAGES=['index.html','backtest.html','plan.html','admin.html','scalping.html','claude.html','ipo.html','job.html','realestate.html'];
const results=[];let failed=0;
function t(name,body){ try{ body(); results.push('PASS '+name); }catch(e){ failed++; results.push('FAIL '+name+' — '+(e&&e.message||e)); } }
function fnOf(src,marker){const start=src.indexOf(marker);assert(start>=0,marker);let i=src.indexOf('{',start),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(start,i+1);}throw Error('unclosed '+marker);}

/* 가짜 브라우저 — 스크롤 이벤트는 붙잡기 단계 듣기로만 전달된다(실제와 같다) */
function fakeDom(){
  const listeners={doc:[],win:[]}; const calls={winScroll:[],cancel:0,elScroll:[]};
  const mkEl=tag=>{ const el={tagName:tag.toUpperCase(),nodeType:1,children:[],style:{},attrs:{},isConnected:true,_cls:new Set(),_on:{},
    classList:{contains:c=>el._cls.has(c),toggle:(c,f)=>{ const v=f===undefined?!el._cls.has(c):!!f; if(v)el._cls.add(c); else el._cls.delete(c); return v; },add:c=>el._cls.add(c),remove:c=>el._cls.delete(c)},
    setAttribute:(k,v)=>{el.attrs[k]=String(v);},getAttribute:k=>el.attrs[k],appendChild:c=>{el.children.push(c);return c;},
    addEventListener:(ev,f)=>{(el._on[ev]=el._on[ev]||[]).push(f);},getClientRects:()=>[1],scrollTop:0,scrollHeight:0,clientHeight:0,
    scrollTo(o){ calls.elScroll.push(o); el.scrollTop=0; } }; return el; };
  const head=mkEl('head'), body=mkEl('body');
  const document={readyState:'complete',head,body,documentElement:{scrollTop:0},nodeType:9,
    createElement:mkEl,addEventListener:(ev,f,o)=>listeners.doc.push({ev,f,capture:!!(o&&o.capture)})};
  const win={pageYOffset:0,document,requestAnimationFrame:f=>{f();return 1;},
    addEventListener:(ev,f)=>listeners.win.push({ev,f}),scrollTo(o){ calls.winScroll.push(o); win.pageYOffset=0; }};
  win.window=win;
  const all=()=>[...head.children,...body.children];
  const fireScroll=target=>listeners.doc.filter(l=>l.ev==='scroll'&&l.capture).forEach(l=>l.f({target}));
  return {win,document,head,body,mkEl,calls,all,fireScroll,listeners};
}
function load(D){ vm.runInNewContext(ui,{window:D.win,document:D.document,setTimeout,console}); }

t('U1 맨 위로 버튼 — 하나만 만든다 · 맨 위에선 숨고 300px 넘게 내려가면 보인다 · 누르면 창을 맨 위로(보던 자리 지키기를 먼저 푼다)',()=>{
  const D=fakeDom(); D.win.cancelHold=()=>{D.calls.cancel++;};
  load(D); load(D);                                                   // 두 번 읽혀도
  const btns=D.body.children.filter(x=>x.attrs&&x.tagName==='BUTTON'); assert.equal(btns.length,1,'버튼 하나');
  const b=btns[0]; assert.equal(b.id,'jkToTop'); assert.equal(b.attrs['aria-label'],'맨 위로'); assert.equal(b.textContent,'↑');
  assert.equal(b.classList.contains('on'),false,'맨 위에선 숨는다');
  D.win.pageYOffset=250; D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'250px 은 아직');
  D.win.pageYOffset=301; D.fireScroll(D.document); assert.equal(b.classList.contains('on'),true,'301px 이면 보인다');
  b._on.click[0](); assert.equal(D.calls.cancel,1,'cancelHold 먼저'); assert.equal(JSON.stringify(D.calls.winScroll.at(-1)),'{"top":0,"behavior":"smooth"}','창을 맨 위로');
  D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'올라가면 다시 숨는다');
  assert.equal(D.win.JKToTop.SHOW_AT,300);
});
t('U1 안쪽 스크롤 칸(시트·긴 목록)을 내리고 있으면 — 창이 맨 위여도 버튼이 보이고, 누르면 그 칸도 맨 위로',()=>{
  const D=fakeDom(); load(D); const b=D.body.children.find(x=>x.tagName==='BUTTON');
  const box=D.mkEl('div'); box.scrollHeight=3000; box.clientHeight=600; box.scrollTop=900;
  D.fireScroll(box); assert.equal(b.classList.contains('on'),true,'안쪽 칸 900px');
  b._on.click[0](); assert.equal(JSON.stringify(D.calls.elScroll.at(-1)),'{"top":0,"behavior":"smooth"}','그 칸을 올린다'); assert.equal(D.calls.winScroll.length,1,'창도 같이');
  const small=D.mkEl('div'); small.scrollHeight=640; small.clientHeight=600; small.scrollTop=40;
  D.fireScroll(small); D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'거의 안 넘치는 칸은 안 센다');
  box.scrollTop=800; box.getClientRects=()=>[]; D.fireScroll(D.document); assert.equal(b.classList.contains('on'),false,'닫힌(안 보이는) 칸은 안 센다');
});
t('U2 자리 — 오른쪽 가장자리 · 화면 세로 가운데 · 모달(z-index 100)보다 아래 · 인쇄엔 안 나온다',()=>{
  assert(/#jkToTop\{position:fixed;right:calc\(6px \+ env\(safe-area-inset-right,0px\)\);top:50%;transform:translateY\(-50%\);z-index:96;/.test(ui),'오른쪽 가운데 고정');
  assert(/\.modal\{[^}]*z-index:100/.test(html),'운영 모달은 100');
  assert(/#jkToTop\.on\{opacity:\.8;visibility:visible\}/.test(ui) && /opacity:0;visibility:hidden/.test(ui),'평소 숨김 · on 이면 보임');
  assert(/@media print\{#jkToTop\{display:none\}\}/.test(ui));
});
t('U3 모든 페이지(9개)가 같은 파일을 한 번씩 읽는다 — 공용 jk-access.js 바로 다음',()=>{
  for(const f of PAGES){
    const s=fs.readFileSync(path.join(ROOT,f),'utf8');
    assert.equal((s.match(/<script src="\/jk-ui\.js" defer><\/script>/g)||[]).length,1,f+' 한 번');
    assert(/<script src="\/jk-access\.js"[^>]*><\/script>\n<script src="\/jk-ui\.js" defer><\/script>/.test(s),f+' jk-access 다음');
  }
  const htmls=fs.readdirSync(ROOT).filter(f=>/\.html$/.test(f)).sort();
  assert.deepEqual(htmls,[...PAGES].sort(),'페이지가 늘면 여기에도 넣는다: '+htmls.join(','));
});
t('U4 모의 성과 첫 칸 — 폭을 정해 두고 줄바꿈 · 폰 폭 340~414px 에서 기간·평가·최종이 한 화면에',()=>{
  const op=fnOf(html,'async function openPaper()');
  assert(/<td><div class="pcell"><b class="slink"[^`]*\$\{outTag\}<\/div><\/td>/.test(op),'첫 칸을 pcell 로 감싼다');
  const css=(html.match(/\.htable\.narrow td:first-child \.pcell\{[^}]*\}/)||[''])[0];
  assert(/min-width:clamp\(96px,calc\(100vw - 250px\),170px\)/.test(css) && /overflow-wrap:anywhere/.test(css),css);
  assert(/\.htable\.narrow td:first-child \.pcell \.cw\{white-space:normal\}/.test(html),'설정 줄도 접힌다');
  // 폭 계산 — 첫 칸(최소 폭+여백 8) + 기간·평가·최종(실측 170px) 이 표 칸(화면−50) 안에 든다
  const first=vw=>Math.min(170,Math.max(96,vw-250))+8;
  for(const vw of [340,360,375,390,414,430]) assert(first(vw)+170<=vw-50,`폭 ${vw}px: ${first(vw)}+170 > ${vw-50}`);
});

console.log(results.join('\n'));
console.log(failed?`\n${failed} FAIL`:'\nALL PASS');
process.exitCode=failed?1:0;
