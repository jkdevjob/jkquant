// 로그인 화면 · 시세 요청 · 모의 성과 표 — 2026-10-06 사용자 신고("로그인 안 됨 · 시세 못 가져옴 · 모의 결과 이상")에서
// 실서버/실화면으로 재현한 원인들을 값으로 고정한다. 각 시험은 실제 글자를 떼어 가짜 이웃으로 돌린다.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const ROOT=path.join(__dirname,'..');
const html=fs.readFileSync(process.argv[2]||path.join(ROOT,'index.html'),'utf8');
const plan=fs.readFileSync(path.join(ROOT,'plan.html'),'utf8');
const quoteJs=fs.readFileSync(path.join(ROOT,'functions/api/quote.js'),'utf8');
function fnOf(src,marker){const start=src.indexOf(marker);assert(start>=0,marker);let i=src.indexOf('{',start),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(start,i+1);}throw Error('unclosed '+marker);}
const fn=m=>fnOf(html,m);
const results=[];let failed=0;
/* 시험 하나가 영영 안 끝나면(응답 없는 fetch 를 그대로 기다리는 옛 코드) Node 는 할 일이 없다며 그냥 0 으로 끝나 버린다 —
   그러면 실패가 통과로 보인다. 시험마다 시간을 재고, 전체에도 감시 타이머를 둔다. */
const ALL_GUARD=setTimeout(()=>{ console.log(results.join('\n')+'\nFAIL 전체 시간 초과 — 끝나지 않은 시험이 있다'); process.exit(1); },90000);
async function t(name,body){
  let to=null;
  try{ await Promise.race([body(), new Promise((_,rej)=>{ to=setTimeout(()=>rej(new Error('시간 초과 — 끝나지 않는다')),10000); })]); results.push('PASS '+name); }
  catch(e){ failed++; results.push('FAIL '+name+' — '+(e&&e.message||e)); }
  finally{ clearTimeout(to); }
}
const tick=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
/* ── 로그인 화면 ─────────────────────────────────────────────────────── */
await t('L1 워치독: Firebase 가 로그아웃이라고 답했으면 22초 뒤에도 "오래 걸리고 있습니다"를 달지 않는다 · 답이 없으면 단다',async()=>{
  const wd=(html.match(/\(function bootWatchdog\(\)\{[\s\S]*?\n\}\)\(\);/)||[''])[0]; assert(wd,'bootWatchdog');
  const run=resolved=>{
    const timers=[], E={}; const mk=id=>E[id]={id,style:{display:''},textContent:'',disabled:false,onclick:null,querySelector:q=>E[q.includes('bootwait')?'bw':'gb']};
    ['authgate','bw','gb','gerr','gbtn'].forEach(mk); E.authgate.style.display='flex';
    const doc={getElementById:id=>E[id]||null};
    const JK={showing:()=>''};
    new Function('document','getComputedStyle','window','JKAccess','authWired','authStep','authResolved','retryDbLoad','googleLogin','renderInAppWarn','setTimeout','console',wd)(
      doc, el=>({display:el.style.display||'block'}), {fb:{auth:{currentUser:null}},JKAccess:JK}, JK, true,'시작 전', resolved,
      ()=>{}, ()=>{}, ()=>{}, (f,ms)=>timers.push([ms,f]), {error(){}});
    timers.sort((a,b)=>a[0]-b[0]).forEach(([,f])=>f());
    return {msg:E.gerr.textContent, box:E.gb.style.display, btn:E.gbtn.textContent};
  };
  const a=run(true), b=run(false);
  assert.equal(a.msg,'', '로그아웃 판정 뒤 문구: '+a.msg); assert.equal(a.box,'block'); assert.equal(a.btn,'Google로 시작하기');
  assert(/오래 걸리고 있습니다/.test(b.msg), '무응답 문구: '+b.msg);
});
await t('L1 initAuth 는 콜백 맨 앞에서 authResolved 를 세운다',async()=>{
  const ia=fn('function initAuth(){');
  assert(/onAuthStateChanged\(window\.fb\.auth, async \(user\)=>\{\s*\n\s*authResolved=true;/.test(ia));
  assert(/let authResolved=false;/.test(html));
});
await t('L2 로그인 여부를 모르는 동안은 "여는 중" — 운영·자산플랜 모두 첫 페인트 전에 had-user(로그인 상자 감춤)로 시작한다',async()=>{
  const bodyStart=html.slice(html.indexOf('<body>'),html.indexOf('<div id="authgate">'));
  assert(/document\.documentElement\.classList\.add\('had-user'\);/.test(bodyStart),'운영 body 첫 스크립트');
  assert(/html\.had-user #authgate \.gbox\{display:none\}/.test(html)&&/html\.had-user #authgate \.bootwait\{display:block\}/.test(html));
  assert(/if\(!user\)\{[\s\S]{0,400}?classList\.remove\('had-user'\)/.test(fn('function initAuth(){')),'로그아웃 판정 때 지운다');
  const pBody=plan.slice(plan.indexOf('<body>'),plan.indexOf('<div id="authgate"'));
  assert(/document\.documentElement\.classList\.add\('had-user'\);/.test(pBody),'자산플랜 body 첫 스크립트');
  assert(!/브라우저영구저장소/.test(plan),'이름 없는 저장소 식별자가 남지 않는다');
});
await t('L2 자산플랜 8초 타이머도 Firebase 가 답했으면 "늦어지고 있습니다"를 달지 않는다',async()=>{
  const tm=(plan.match(/setTimeout\(function\(\)\{ var h=document\.documentElement;[\s\S]*?\}, 8000\);/)||[''])[0]; assert(tm,'plan 8s timer');
  const run=resolved=>{ const cls=new Set(['had-user']), e={textContent:''}; let f=null;
    new Function('document','window','setTimeout',tm)({documentElement:{classList:{contains:c=>cls.has(c),remove:c=>cls.delete(c)}},getElementById:()=>e},{__planAuthResolved:resolved},(fn)=>{f=fn;}); f(); return {msg:e.textContent,had:cls.has('had-user')}; };
  const a=run(true), b=run(false);
  assert.equal(a.msg,''); assert.equal(a.had,false); assert(/늦어지고 있습니다/.test(b.msg));
  assert(/onAuthStateChanged\(auth,async user=>\{\s*\n\s*window\.__planAuthResolved=true;/.test(plan));
});
await t('L3 앱 내장 브라우저 감지 — 이름을 아는 앱 + 이름 모르는 iOS/안드로이드 내장 화면 · 진짜 브라우저·홈 화면 앱은 아님',async()=>{
  const src=(html.match(/const INAPP_UA=\[[\s\S]*?\]\];/)||[''])[0]+'\n'+fn('function inAppName(ua){');
  const mk=(standalone)=>new Function('navigator','window',src+'\nreturn inAppName;')({userAgent:'',standalone},{matchMedia:()=>({matches:false})});
  const f=mk(false), fs_=mk(true);
  const iOS='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const cases=[[iOS+' Version/26.0 Mobile/15E148 Safari/604.1',null],[iOS+' CriOS/141.0 Mobile/15E148 Safari/604.1',null],
    [iOS+' Mobile/15E148 NAVER(inapp; search; 2000; 12.18.1)','네이버 앱'],[iOS+' Mobile/15E148 KAKAOTALK 10.8.0','카카오톡'],
    [iOS+' Mobile/15E148','앱 내장 브라우저'],
    ['Mozilla/5.0 (Linux; Android 15; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',null],
    ['Mozilla/5.0 (Linux; Android 15; SM-S928N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36','앱 내장 브라우저']];
  for(const [ua,want] of cases) assert.equal(f(ua),want,ua.slice(-50));
  assert.equal(fs_(iOS+' Mobile/15E148'),null,'홈 화면 앱(standalone)은 내장 화면이 아니다');
});

/* ── 시세 요청 ──────────────────────────────────────────────────────── */
await t('Q1 fetchT: 응답 없는 요청을 시간으로 끊는다',async()=>{
  const fetchT=new Function('fetch','AbortController','setTimeout','clearTimeout',fn('async function fetchT(url, opt, ms)')+'\nreturn fetchT;')(
    ()=>new Promise(()=>{}), AbortController, setTimeout, clearTimeout);
  const t0=Date.now(); let err=null; try{ await fetchT('/x',{},40); }catch(e){ err=e; }
  assert(err&&/응답 없음/.test(err.message)); assert(Date.now()-t0<1000);
});
await t('Q1 시세: 자체 함수가 한 번 멈춰도 다시 물어 받는다 · 공개 프록시로 안 빠진다 · 계속 안 되면 정해진 시간 안에 포기',async()=>{
  const fr=fn('async function _fetchDailyRaw(symbol)'), fT=fn('async function fetchT(url, opt, ms)');
  const body={symbol:'SOXL',series:[{date:'2026-10-02',close:160},{date:'2026-10-05',close:164.27}],price:164.27,last:{date:'2026-10-05',close:164.27}};
  /* 실제 시도 목록(QUOTE_TRY_MS)을 그대로 쓰되 시간만 줄인다 — 한 번만 묻는 옛 코드로 되돌리면 여기서 걸린다 */
  const TRY=JSON.parse((html.match(/const QUOTE_TRY_MS=(\[[^\]]*\]);/)||[])[1]||'[]');
  assert(TRY.length>=2,'자체 시세 함수 시도 횟수 '+TRY.length);
  const mk=(fetchImpl)=>new Function('fetch','AbortController','setTimeout','clearTimeout','QUOTE_TRY_MS','quoteToDaily','PUBLIC_PROXIES','proxyText','parseIntraday',
    fT+'\n'+fr+'\nreturn _fetchDailyRaw;')(fetchImpl, AbortController, setTimeout, clearTimeout,TRY.map(x=>Math.max(20,Math.round(x/300))),(S,j)=>({symbol:S,price:j.price}),[],async()=>{throw Error('proxy');},()=>null);
  let calls=[]; const f1=mk((u)=>{ calls.push(u); return calls.length===1?new Promise(()=>{}):Promise.resolve({ok:true,json:async()=>body}); });
  const q=await f1('soxl'); assert.equal(q&&q.price,164.27); assert.equal(calls.length,2); assert(calls.every(u=>u.startsWith('/api/quote?symbol=SOXL&range=max&div=1')));
  calls=[]; const f2=mk((u)=>{ calls.push(u); return new Promise(()=>{}); });
  const t0=Date.now(); const q2=await f2('soxl'); assert.equal(q2,null); assert.equal(calls.length,2); assert(Date.now()-t0<2000,'포기까지 '+(Date.now()-t0)+'ms');
});
await t('Q1 운영 Pages 는 정식 /api/quote 2회 실패 뒤 느린 공개 프록시로 빠지지 않는다',async()=>{
  const fr=fn('async function _fetchDailyRaw(symbol)');
  let proxyCalls=0;
  const run=new Function('fetchT','QUOTE_TRY_MS','quoteToDaily','PUBLIC_PROXIES','proxyText','parseIntraday','location',
    fr+'\nreturn _fetchDailyRaw;')(
      async()=>{throw Error('down');},[5,5],()=>null,[u=>u],
      async()=>{proxyCalls++;throw Error('proxy');},()=>null,{hostname:'jkquant.pages.dev'});
  const out=await run('SOXL');
  assert.equal(out,null); assert.equal(proxyCalls,0,'운영에서 공개 프록시를 호출함');
});
await t('Q1 자산플랜 시세도 응답 무한대기 방지 — AbortController + 2회 시간상한',async()=>{
  const fp=fnOf(plan,'async function fetchPlanQuote(symbol)');
  assert(/for\(const ms of \[7000,10000\]\)/.test(fp),'7초/10초 재시도');
  assert(/new AbortController\(\)/.test(fp)&&/Promise\.race\(\[p,lim\]\)/.test(fp),'요청 시간 제한');
  assert(/throw lastErr\|\|new Error\(sym\+' 시세 실패'\)/.test(fp),'최종 실패 반환');
});
await t('Q1 서버 외부 시세 호출도 공급자 응답을 무한 대기하지 않는다',async()=>{
  const fb=fnOf(quoteJs,'async function fetchBound(url, opt, ms=4500)');
  assert(/AbortController/.test(fb)&&/setTimeout/.test(fb)&&/signal: ac\.signal/.test(fb));
  const direct=(quoteJs.match(/await fetch\(/g)||[]).length;
  assert.equal(direct,1,'fetchBound 내부 외 직접 await fetch가 남음: '+direct);
  assert((quoteJs.match(/await fetchBound\(/g)||[]).length>=7,'시세 공급자 fetchBound 적용 누락');
});

await t('Q2 서버: range=max 의 야후 주소가 한 시간 안에는 같다(엣지 캐시가 맞는다) · 오늘 봉은 늘 범위 안',async()=>{
  const f=new Function(fnOf(quoteJs,'function yahooRangeParam(range, period1, period2, nowMs)')+'\nreturn yahooRangeParam;')();
  const h=Date.UTC(2026,9,6,1,0,0);
  const a=f('max',null,null,h+5000), b=f('max',null,null,h+59*60000), c=f('max',null,null,h+61*60000);
  assert.equal(a,b,'같은 시간대'); assert.notEqual(a,c,'다음 시간대');
  const p2=+a.match(/period2=(\d+)/)[1]; assert(p2*1000>=h+59*60000+86400000,'오늘 봉 포함');
  assert.equal(f('1y',null,null,h),'range=1y'); assert.equal(f('max','100','200',h),'period1=100&period2=200');
  assert(/const rangeParam = yahooRangeParam\(range, period1, period2, Date\.now\(\)\);/.test(quoteJs));
});

/* ── 모의 성과 표 ───────────────────────────────────────────────────── */
await t('P1 원화 환율: 실시간 환율이 아직 없으면 하드코딩 상수(FX) 대신 마지막으로 받은 실제 환율 · 결과와 함께 그 환율을 남긴다',async()=>{
  const mk=(liveFX,S)=>new Function('liveFX','FX','S',fn('function paperWonRate(r)')+'\n'+fn('function paperFxFallback()')+'\nreturn paperWonRate;')(liveFX,1520.21,S);
  assert.equal(mk(null,{paperViewCache:{fx:1343.5}})({cur:'usd'}),1343.5);
  assert.equal(mk(1400,{paperViewCache:{fx:1343.5}})({cur:'usd'}),1400);
  assert.equal(mk(null,{})({cur:'usd'}),1520.21);
  assert.equal(mk(null,{paperViewCache:{fx:1343.5}})({cur:'krw'}),1);
  const S={}; const w=new Function('S','liveFX','PAPER_VIEW_CACHE_VER','paperKstDate','paperViewSig',fn('function paperViewCacheWrite(rows)')+'\nreturn paperViewCacheWrite;')(S,1343.5,1,()=>'2026-10-06',()=>'sig');
  w([{price:1}]); assert.equal(S.paperViewCache.fx,1343.5);
  const op=fn('async function openPaper()');
  assert(op.indexOf('await Promise.race([loadFX()')>0 && op.indexOf('await Promise.race([loadFX()')<op.indexOf('r.wonRate=paperWonRate(r)'),'표를 그리기 전에 환율을 (짧게) 기다린다');
});
await t('P4 시세 못 받은 줄이 섞인 결과는 오늘 것으로 굳히지 않는다(새로고침하면 다시 받는다)',async()=>{
  const f=new Function('paperKstDate',fn('function paperViewCacheFresh(x)')+'\nreturn paperViewCacheFresh;')(()=>'2026-10-06');
  assert.equal(f({day:'2026-10-06',rows:[{price:12},{price:1}]}),true);
  assert.equal(f({day:'2026-10-06',rows:[{price:12},{price:0}]}),false);
  assert.equal(f({day:'2026-10-05',rows:[{price:12}]}),false);
  assert.equal(f(null),false);
});
await t('P3 강제 갱신(전체 적용·오늘 갱신)은 이미 도는 갱신 결과를 재사용하지 않고, 끝나기를 기다렸다 지금 원장으로 다시 계산한다',async()=>{
  let fills=0; const ctx={_paperViewRefreshPromise:null,$:()=>null,
    paperRepairCommonStarts:async()=>0,paperViewCacheRead:()=>null,paperViewCacheFresh:()=>false,loadFX:async()=>{},
    paperFillAll:async()=>{ const n=++fills; await tick(30); return [{n}]; },paperViewCacheWrite:()=>{},pushRemoteNow:async()=>true,refreshAll:()=>{}};
  vm.createContext(ctx); vm.runInContext(fn('async function refreshPaperView(force=false)'),ctx);
  const p1=ctx.refreshPaperView(false); await tick(5); const p2=ctx.refreshPaperView(true);
  const [r1,r2]=await Promise.all([p1,p2]);
  assert.equal(fills,2,'채우기 횟수'); assert.equal(r1[0].n,1); assert.equal(r2[0].n,2,'강제 갱신은 새로 계산한 결과');
  const p3=ctx.refreshPaperView(false); await tick(5); const p4=ctx.refreshPaperView(false); await Promise.all([p3,p4]);
  assert.equal(fills,3,'평소 열기 둘은 한 번만 계산(같이 씀)');
});
await t('P3 전체 적용은 도는 갱신이 끝난 뒤에 기록을 비운다',async()=>{
  const ap=fn('async function applyAllSimStart()');
  const iWait=ap.indexOf('if(_paperViewRefreshPromise){ try{ await _paperViewRefreshPromise; }catch(e){} }');
  const iClear=ap.indexOf('x.hist=[]; x.simStart=ns;');
  assert(iWait>0 && iClear>iWait && ap.indexOf('if(!confirm(msg)) return;')<iWait);
});
await t('P2 첫 화면: 저장 결과의 서명이 안 맞으면 지난 결과를 "갱신 중"으로 보인다 — 그 자리 시세로 센 가짜 값(시세 못 받음·평단 대체)을 안 보인다',async()=>{
  const op=fn('async function openPaper()');
  assert(/const last=cache\?null:paperViewCacheLast\(\);/.test(op) && /paperStaleNote=true/.test(op) && /지난번 계산 결과입니다/.test(op));
  const L=new Function('S','PAPER_VIEW_CACHE_VER',fn('function paperViewCacheLast()')+'\nreturn paperViewCacheLast;');
  assert.equal(L({paperViewCache:{ver:1,sig:'old',rows:[{price:1}]}},1)().sig,'old'); assert.equal(L({paperViewCache:{ver:1,rows:[]}},1)(),null);
  const sum=new Function('PAPER_TABS','S','paperStat',fn('function paperSummary()')+'\nreturn paperSummary;')(
    [['inf','무매'],['vr','VR']],{inf:{sessions:[{paper:true,id:'a'}]},vr:{sessions:[{paper:true,id:'b'}]}},(tab)=>({tab,price:tab==='inf'?0:12}));
  const rows=sum(); assert.equal(rows[0].pending,true); assert.equal(rows[1].pending,undefined);
  assert(/r\.pending\s*\n?\s*\? `<td colspan="7" style="color:var\(--faint\)">계산 중/.test(op),'아직 계산 전 줄은 실패로 안 보인다');
});
await t('P2 VR 모의 평가는 그 세션 종목 시세만 쓴다 — 없으면 평단 대체(가짜 0% 손익) 대신 0(시세 대기)',async()=>{
  const pr=fn('function paperRaw(tab, sess)');
  const run=(Q)=>new Function('computeVr','quoteOf','vrLastPrice','sessDivCash','console',pr+'\nreturn paperRaw;')(
    ()=>({qty:10,avgNom:50,pool:100,grossIn:1000,totwd:0,hist:[]}),()=>Q,()=>50,()=>({divCash:0}),{error(){}})('vr',{settings:{ticker:'SOXL'},hist:[]});
  assert.equal(run(null).price,0); assert.equal(run({symbol:'SOXL',last:60}).price,60); assert.equal(run({symbol:'SOXL',last:60}).total,10*60+100);
});
await t('P2 MDD 는 탭에 담긴 시세가 그 세션 종목일 때만 잰다',async()=>{
  const md=fn('function paperMdd(tab, sess, R, hist)');
  const days=[1,2,3,4,5].map(i=>({date:'2026-01-0'+i,close:10+i}));
  const run=(have)=>new Function('PAPER_DAYS','PAPER_CACHESYM','paperRaw','ivsQuote1','console',md+'\nreturn paperMdd;')(
    {vr:()=>days},{vr:()=>have},()=>({inflow:100,qty:1,k:0,price:0}),undefined,{error(){}})('vr',{settings:{ticker:'SOXL'},hist:[{date:'2026-01-01'}]},{qty1:0},[{date:'2026-01-01'}]);
  assert.equal(run('TQQQ'),null,'남의 종목'); assert(run('SOXL')&&run('SOXL').nDay>=3,'제 종목');
});

clearTimeout(ALL_GUARD);
console.log(results.join('\n'));
console.log(failed?`\n${failed} FAIL`:'\nALL PASS');
process.exit(failed?1:0);
})().catch(e=>{ console.error('HARNESS FAIL',e); process.exit(1); });
