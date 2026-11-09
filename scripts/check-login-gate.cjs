#!/usr/bin/env node
'use strict';
/* 로그인 게이트 — 팝업 한 번에 하나 · 오류 글자 한 벌 · 앱 내장 브라우저 안내 (index v3.127.1 · plan v2.5.5 · 2026-11-09)
 * 새 사용자 화면: "Firebase: Error (auth/cancelled-popup-request)." — 팝업이 떠 있는 동안 다시 눌러 앞 요청이 취소된 코드가 날것으로 보였다.
 * 실제 jk-access.js 를 가짜 문서·가짜 Firebase 로 돌린다(재구현 없음). 값 시험 + 변이(틀린 코드로 바꾸면 빨간불).
 *   G1 guard() 로그인 — 떠 있는 동안 또 눌러도 한 번만 · 단추 잠금 · 끝나면 풀림 · 오류 글자(취소는 조용히 · 닫음 · 차단(+앱 안) · 네트워크 · 도메인 · 모름)
 *   G2 inAppName — 이름 아는 앱 · 모르는 iOS/안드로이드 내장 화면 · 진짜 브라우저·홈 화면 앱은 아님
 *   G3 로그인 화면 — 앱 안이면 「다른 브라우저로 열기」 안내 · 아니면 없음
 *   G4 배선 — index·plan 이 같은 글자(loginErrorText)·같은 판별(inAppName) · 셋 다 한 번에 하나 · 듀얼가드 머리 단추도 같은 길
 */
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={acc:rd('jk-access.js'),idx:rd('index.html'),plan:rd('plan.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const tick=()=>new Promise(r=>setTimeout(r,0));
const IOS='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const SAFARI=IOS+' Version/26.0 Mobile/15E148 Safari/604.1', KAKAO=IOS+' Mobile/15E148 KAKAOTALK 10.8.0';
/* 가짜 문서 — 게이트(#jkgate)는 innerHTML 을 받고, 그 안의 로그인 단추·메시지 칸을 querySelector/getElementById 로 돌려준다 */
function load(acc, ua, standalone){
  const els={}, clicks=[], msgEl={textContent:'',className:''};
  const mkEl=tag=>{ const e={tagName:tag,id:'',className:'',textContent:'',attrs:{},_html:'',_btn:{},
    setAttribute(k,v){ e.attrs[k]=String(v); },getAttribute(k){ return k in e.attrs?e.attrs[k]:null; },removeAttribute(k){ delete e.attrs[k]; },
    appendChild(c){ if(c.id) els[c.id]=c; return c; },
    querySelector(sel){ const m=sel.match(/\[data-jk="(\w+)"\]/); if(m&&e._html.includes('data-jk="'+m[1]+'"')){ return e._btn[m[1]]||(e._btn[m[1]]={disabled:false}); } return null; }};
    Object.defineProperty(e,'innerHTML',{get(){ return e._html; },set(v){ e._html=String(v); e._btn={}; if(!e._html.includes('id="jkmsg"')){ msgEl.textContent=''; msgEl.className=''; } }}); return e; };
  const head=mkEl('head'), body=mkEl('body');
  const document={documentElement:{classList:{add(){},remove(){},contains:()=>false,toggle(){}}},head,body,createElement:mkEl,
    getElementById:id=>id==='jkmsg'?((els.jkgate&&els.jkgate._html.includes('id="jkmsg"'))?msgEl:null):(els[id]||null),
    querySelectorAll:()=>[],currentScript:{getAttribute:()=>'1'},addEventListener:(t,f)=>{ if(t==='click') clicks.push(f); }};
  const ctx={document,console:{warn(){},error(){},log(){}},setTimeout:(f,ms)=>ms>=6000?0:setTimeout(f,ms),clearTimeout,URL,location:{origin:'https://x',pathname:'/backtest',reload(){}},
    navigator:{userAgent:ua||'',standalone:!!standalone}};
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(acc,ctx);
  return {A:ctx.JKAccess,els,msgEl,click:act=>clicks.forEach(f=>f({target:{closest:()=>({getAttribute:()=>act})}})),gate:()=>els.jkgate,btn:()=>els.jkgate&&els.jkgate.querySelector('[data-jk="login"]')};
}
const deferred=()=>{ let res,rej; const p=new Promise((a,b)=>{ res=a; rej=b; }); return {p,res,rej}; };
function mkFb(onPopup){ let cb=null; const fb={auth:{currentUser:null},db:{},doc:(db,c,id)=>c+'/'+id,getDoc:async()=>({exists:()=>false,data:()=>({})}),setDoc:async()=>{},
  onAuthStateChanged:(a,f)=>{ cb=f; },signInWithPopup:(a,p)=>onPopup(p),GoogleAuthProvider:function(){ this.setCustomParameters=o=>{ this.p=o; }; },signOut:async()=>{}};
  return {fb,cb:()=>cb}; }

async function check(S){
  const bad=[];const t=(name,cond,info)=>{if(!cond)bad.push(name+(info!=null?' · '+String(info).slice(0,300):''));};
  // ── G1 guard() 로그인
  { let d=deferred(), popups=0; const L=load(S.acc,SAFARI), {fb,cb}=mkFb(()=>{ popups++; return d.p; });
    L.A.guard(fb,{}); await cb()(null); await tick();
    L.click('login'); L.click('login'); await tick();
    const b1=L.btn(); const during={popups,disabled:b1&&b1.disabled,msg:L.msgEl.textContent,cls:L.msgEl.className};
    d.res({}); await tick(); await tick();
    const after={disabled:L.btn()&&L.btn().disabled,msg:L.msgEl.textContent};
    t('G1 떠 있는 동안 두 번 눌러도 팝업 한 번 · 단추 잠금 · "창을 열었습니다"(초록) · 끝나면 풀리고 글자 비움',
      during.popups===1&&during.disabled===true&&/구글 로그인 창을 열었습니다/.test(during.msg)&&/jok/.test(during.cls)&&after.disabled===false&&after.msg==='',JSON.stringify({during,after}));
    const run=async(code,ua)=>{ const L2=load(S.acc,ua||SAFARI); let dd=deferred(), n=0; const F=mkFb(()=>{ n++; return dd.p; }); L2.A.guard(F.fb,{}); await F.cb()(null); await tick();
      L2.click('login'); await tick(); dd.rej(code?{code}:new Error('boom')); await tick(); await tick();
      const msg=L2.msgEl.textContent;   // 오류 글자는 다시 누르기 전에 읽는다(다시 누르면 '창을 열었습니다' 가 덮는다)
      dd=deferred(); L2.click('login'); await tick(); return {msg,n}; };
    const c1=await run('auth/cancelled-popup-request'), c2=await run('auth/popup-closed-by-user'), c3=await run('auth/popup-blocked'), c4=await run('auth/popup-blocked',KAKAO),
          c5=await run('auth/network-request-failed'), c6=await run('auth/unauthorized-domain'), c7=await run('auth/weird'), c8=await run(null);
    t('G1 오류 글자 — 취소는 조용히(빈 글자) · 닫음 · 차단(기본/앱 안은 「다른 브라우저로 열기」) · 네트워크 · 도메인 · 모르는 코드는 코드 그대로 · 코드 없는 오류도 "로그인 실패" · 실패 뒤엔 다시 누를 수 있음(팝업 2회)',
      c1.msg===''&&c2.msg==='로그인 창이 닫혔어요. 다시 눌러 주세요.'&&/^팝업이 차단됐어요/.test(c3.msg)&&/^카카오톡 안에서는 구글 로그인이 막힙니다 — .*다른 브라우저로 열기/.test(c4.msg)
      &&c5.msg==='인터넷 연결을 확인한 뒤 다시 눌러 주세요.'&&/허용되지 않은 도메인/.test(c6.msg)&&c7.msg==='로그인 실패: auth/weird'&&/^로그인 실패: /.test(c8.msg)&&[c1,c2,c3,c4,c5,c6,c7,c8].every(c=>c.n===2),
      JSON.stringify([c1,c2,c3,c4,c5,c6,c7,c8]));
    t('G1 로그인 뒤 계정 고르기 창(select_account) 그대로',(()=>{ const L3=load(S.acc,SAFARI); let prov=null; const F=mkFb(p=>{ prov=p; return Promise.resolve({}); }); L3.A.guard(F.fb,{}); return F.cb()(null).then(()=>{ L3.click('login'); return tick(); }).then(()=>prov&&prov.p&&prov.p.prompt==='select_account'); })()); }
  // ── G2 inAppName
  { const A=load(S.acc,'').A, f=ua=>A.inAppName(ua);
    const cases=[[SAFARI,null],[IOS+' CriOS/141.0 Mobile/15E148 Safari/604.1',null],[IOS+' Mobile/15E148 NAVER(inapp; search; 2000; 12.18.1)','네이버 앱'],[KAKAO,'카카오톡'],[IOS+' Mobile/15E148','앱 내장 브라우저'],
      ['Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',null],
      ['Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36','앱 내장 브라우저'],[IOS+' Mobile/15E148 Instagram 300.0','인스타그램']];
    t('G2 앱 내장 브라우저 판별 — 이름 아는 앱 · 모르는 iOS/안드로이드 내장 화면 · 진짜 브라우저는 아님',cases.every(([ua,w])=>f(ua)===w),JSON.stringify(cases.map(([ua,w])=>[f(ua),w])));
    t('G2 홈 화면 앱(standalone)은 내장 화면이 아니다 · 인자 없이 부르면 navigator 로',load(S.acc,IOS+' Mobile/15E148',true).A.inAppName()===null&&load(S.acc,KAKAO).A.inAppName()==='카카오톡'); }
  // ── G3 로그인 화면 안내
  { const g=async ua=>{ const L=load(S.acc,ua); const F=mkFb(()=>new Promise(()=>{})); L.A.guard(F.fb,{}); await F.cb()(null); return L.gate()._html; };
    const k=await g(KAKAO), s=await g(SAFARI);
    t('G3 앱 안이면 로그인 단추 아래 ⚠ 안내(이름 · 다른 브라우저로 열기) · 진짜 브라우저면 없음 · 단추는 그대로',
      /jwarn/.test(k)&&/카카오톡 안에서는 구글 로그인이 막힙니다/.test(k)&&/다른 브라우저로 열기/.test(k)&&/data-jk="login"/.test(k)&&!/jwarn/.test(s)&&/data-jk="login"/.test(s),k.slice(-300)); }
  // ── G4 배선
  { const gl=fnOf(S.idx,'function googleLogin()'), pl=S.plan;
    t('G4 운영(index) — 판별은 jk-access 에 위임(표는 한 군데) · 로그인 한 번에 하나(단추 잠금·풀림) · 오류 글자는 JKAccess.loginErrorText',
      /function inAppName\(ua\)\{ return \(window\.JKAccess&&JKAccess\.inAppName\)\?JKAccess\.inAppName\(ua\):null; \}/.test(S.idx)&&!/const INAPP_UA=/.test(S.idx)
      &&/if\(_googleLoginBusy\) return;/.test(gl)&&/_googleLoginBusy=true; const gb=\$\('gbtn'\); if\(gb\) gb\.disabled=true;/.test(gl)&&/\.finally\(\(\)=>\{ _googleLoginBusy=false; if\(gb\) gb\.disabled=false; \}\)/.test(gl)
      &&/JKAccess\.loginErrorText\(e\)/.test(gl)&&!/로그인 창이 닫혔어요/.test(gl));
    t('G4 듀얼가드(plan) — planLoginImpl 한 번에 하나 · 같은 글자 · 머리 로그인 단추도 planLoginImpl 로',
      /if\(_planLoginBusy\) return;/.test(pl)&&/JKAccess\.loginErrorText\(e\)/.test(fnOf(pl,'window.planLoginImpl=()=>'))&&/\.finally\(\(\)=>\{ _planLoginBusy=false; \}\)/.test(pl)
      &&/\$\("loginBtn"\)\.addEventListener\("click",\(\)=>window\.planLoginImpl\(\)\);/.test(pl)&&!/addEventListener\("click",\(\)=>signInWithPopup/.test(pl));
    t('G4 jk-access 가 내보냄(inAppName · loginErrorText) · 게이트 로그인은 결과와 상관없이 잠금을 푼다',/inAppName:inAppName, loginErrorText:loginErrorText\}/.test(S.acc)&&/\.then\(function\(\)\{ loginBusy=false; setLoginBusy\(false\); \}\)/.test(S.acc)); }
  return bad;
}
const MUT=[
  ['게이트: 떠 있는데 또 열림(한 번에 하나 없음)','acc',s=>s.replace("      if(loginBusy) return;\n","")],
  ['게이트: 취소 코드를 오류로 보임','acc',s=>s.replace("if(code==='auth/cancelled-popup-request') return '';","if(false) return '';")],
  ['게이트: 날것 메시지(옛 코드)','acc',s=>s.replace("function(e){ msg(loginErrorText(e)); }","function(e){ msg((e&&e.message)||'로그인 실패'); }")],
  ['게이트: 끝나도 잠금 안 풀림','acc',s=>s.replace(".then(function(){ loginBusy=false; setLoginBusy(false); });",".then(function(){ setLoginBusy(false); });")],
  ['게이트: 앱 안 안내 없음','acc',s=>s.replace("          +(inAppHint()?'<div class=\"js jwarn\">⚠ '+esc(inAppHint())+'</div>':'');   // 앱 안(카카오톡 등)에선 구글이 로그인을 막는다 — 누르기 전에 안내\n","")],
  ['판별: 안드로이드 내장 화면을 못 알아봄','acc',s=>s.replace("if(/Android/i.test(ua) && /; wv\\)/i.test(ua)) return '앱 내장 브라우저';","")],
  ['운영: 로그인 한 번에 하나 없음','idx',s=>s.replace("  if(_googleLoginBusy) return;\n","")],
  ['듀얼가드: 날것 메시지(옛 코드)','plan',s=>s.replace("(window.JKAccess&&JKAccess.loginErrorText)?JKAccess.loginErrorText(e):((e&&e.message)||'로그인 실패')","((e&&e.message)||'로그인 실패')")],
];
(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 로그인 게이트: 팝업 한 번에 하나(단추 잠금·풀림) · 오류 글자 한 벌(취소 조용히 · 닫음 · 차단/앱 안 · 네트워크 · 도메인 · 모름) · 앱 내장 판별 · 로그인 화면 안내 · index·plan 같은 벌');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check({...SRC,[key]:m})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS login gate · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
