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

await t('L4 Firestore 전송은 iOS·앱내장 브라우저만 강제 long-polling, 일반 브라우저는 자동감지',async()=>{
  const pages=['index.html','plan.html','backtest.html','scalping.html','claude.html','ipo.html','job.html','realestate.html','admin.html'];
  for(const p of pages){
    const s=fs.readFileSync(path.join(ROOT,p),'utf8');
    assert(/const JK_FORCE_FIRESTORE_LONG_POLLING=\/iPhone\|iPad\|iPod\|NAVER\|KAKAOTALK\|Instagram\|FBAN\|FBAV\|; wv\\\)\/i\.test\(navigator\.userAgent\|\|""\);/.test(s),p+' mobile/webview detector missing');
    assert(/JK_FORCE_FIRESTORE_LONG_POLLING\?\{experimentalForceLongPolling:true\}:\{experimentalAutoDetectLongPolling:true\}/.test(s),p+' conditional firestore transport missing');
  }
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

await t('Q3 운영/자산플랜 시세는 모의·플랜에서 불필요한 1분봉을 건너뛰고 캐시버스터를 쓰지 않는다',async()=>{
  const raw=fn('async function _fetchDailyRaw(symbol)');
  assert(/intraday=\$\{noIntraday\?'0':'1'\}/.test(raw),'운영 paper intraday switch');
  assert(/typeof _paperFilling/.test(raw),'paper filling guard');
  const pf=fnOf(plan,'async function fetchPlanQuote(symbol)');
  assert(/intraday=0/.test(pf),'plan minute bars disabled');
  assert(!/_ts=/.test(pf),'plan cache bust remains');
  assert(!/cache:'no-store'/.test(pf),'plan no-store remains');
});
await t('Q4 시세 서버는 Yahoo query1→query2까지만 시도하고 같은 query1을 세 번째로 중복 호출하지 않는다',async()=>{
  assert(/for \(const host of \["query1", "query2"\]\)/.test(quoteJs));
  assert(!/query1-fc/.test(quoteJs));
});
await t('Q5 환율 실패도 Pages 운영에서 공개 프록시 연쇄대기로 넘어가지 않는다',async()=>{
  const fx=fn('async function _loadFXNet()');
  assert(/fetchT\('\/api\/fx'.*5000/.test(fx));
  assert(/\.pages\\\.dev/.test(fx)||/pages\\\.dev/.test(fx));
  assert(/if\(_prodPages\) return;/.test(fx));
});

/* ── 모의 성과 표 ───────────────────────────────────────────────────── */
await t('P0 모의성과 시세는 종목별 병렬 선취 후 전략 재생만 순차로 한다',async()=>{
  const fill=fn('async function paperFillAll()');
  const pre=fn('async function paperPrefetchQuotes()');
  assert(/await paperPrefetchQuotes\(\)/.test(fill));
  assert(/Promise\.all\(\[\.\.\.px\]/.test(pre),'price prefetch parallel');
  assert(/Promise\.all\(\[\.\.\.dv\]/.test(pre),'dividend prefetch parallel');
  const pp=fn('async function loadPlanPaperData(force)');
  assert(/Promise\.all\(miss\.map/.test(pp),'plan paper quotes parallel');
});

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
  vm.createContext(ctx); vm.runInContext(fn('async function refreshPaperView(force=false, onRows=null)'),ctx);
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

/* ── 속도: 같은 요청 반복 · 모의 갱신 중 다시 그리기 폭주 · MDD 의 전 구간 재계산 (2026-10-06 2차 점검) ──
   실측(휴대폰 근사 CPU 4배): 모의 갱신 한 번에 /api 49건(SOXL 전체 이력 12번 · 환율 28번) · 12.96초.
   고친 뒤 9건 · 4.70초, 결과는 전 자릿수 같음. */
await t('Q6 평소 화면: 같은 종목 시세가 아직 오는 중이면 그 요청을 같이 쓴다 · 끝난 결과는 기억하지 않는다 · 실패는 기억하지 않는다',async()=>{
  const ctx={_fillQuoteCache:null,Map,Promise}; vm.createContext(ctx);
  vm.runInContext(fn('const _quoteInflight=new Map();').replace(/^[\s\S]*?(const _quoteInflight)/,'$1')+'\n',ctx);
  let calls=0, fail=false; ctx.raw=async(S)=>{ calls++; await tick(15); if(fail) throw Error('x'); return {symbol:S,n:calls}; };
  vm.runInContext(fn('function _quoteShare(fn, SYM)')+'\nconst _memoQuote='+fnOf(html,'(fn)=>async function(symbol){').replace(/;\s*$/,'')+';\nvar fd=_memoQuote(raw);',ctx);
  const [a,b]=await Promise.all([ctx.fd('soxl'),ctx.fd('SOXL')]);
  assert.equal(calls,1,'동시 두 번 → 한 번'); assert.equal(a,b);
  const c=await ctx.fd('SOXL'); assert.equal(calls,2,'끝난 뒤엔 새로 받는다'); assert.equal(c.n,2);
  fail=true; await ctx.fd('SOXL').catch(()=>{}); fail=false; const d=await ctx.fd('SOXL'); assert.equal(calls,4,'실패는 기억 안 함'); assert.equal(d.n,4);
});
await t('Q7 환율: 오는 중이면 같이 기다리고, 5분 안에 받은 게 있으면 다시 안 받는다 · 5분이 지나면 다시 받는다',async()=>{
  let now=1e12; const ctx={Date:{now:()=>now},Promise,liveFX:null,_fxAt:0,_fxInflight:null,FX_FRESH_MS:null,net:0}; vm.createContext(ctx);
  vm.runInContext('FX_FRESH_MS=5*60*1000;\n'+fn('function loadFX(){')+'\nasync function _loadFXNet(){ net++; await new Promise(r=>setTimeout(r,10)); liveFX=1343.5; _fxAt=Date.now(); }',
    Object.assign(ctx,{setTimeout}));
  await Promise.all([ctx.loadFX(),ctx.loadFX(),ctx.loadFX()]); assert.equal(ctx.net,1,'동시 세 번 → 한 번');
  now+=60*1000; await ctx.loadFX(); assert.equal(ctx.net,1,'1분 뒤 → 안 받음');
  now+=5*60*1000; await ctx.loadFX(); assert.equal(ctx.net,2,'5분 넘으면 → 다시');
  assert(/const FX_FRESH_MS=5\*60\*1000;/.test(html));
});
await t('P5 모의 일괄 재생 중에는 시세 도착 후처리(모의 굴리기·전체 다시 그리기)를 하지 않는다 · 평소엔 한다',async()=>{
  const run=(filling)=>{ const log=[]; const timers=[];
    new Function('_paperFilling','paperAuto','renderStatusline','refreshAll','setTimeout','console',fn('function _afterQuote(){')+'\n_afterQuote();')(
      filling,()=>log.push('auto'),()=>log.push('status'),()=>log.push('refresh'),(f)=>timers.push(f),{error(){}});
    timers.forEach(f=>f()); return log.join(','); };
  assert.equal(run(true),''); assert.equal(run(false),'auto,status,refresh');
});
await t('P6 모의 일괄 재생이 끝나면 탭별 시세 칸(무매 캐시·이평·섀넌·짝·적립·ASAP)을 재생 전으로 되돌린다 — 운영 화면이 남의 종목으로 다시 받지 않게',async()=>{
  const orig={inf:{symbol:'SOXL'},ma:{symbol:'SOXL'},ivs:{symbol:'TQQQ'},ivs1:{symbol:'QQQ'},dca:{symbol:'USD'},asap:{symbol:'SOXL'}};
  const S={activeTab:'inf',inf:{active:'op',sessions:[{id:'op'},{id:'p1',paper:true,settings:{ticker:'TQQQ'},hist:[]}]},
           ma:{active:'m0',sessions:[{id:'p2',paper:true,settings:{ticker:'TQQQ'},hist:[]}]}};
  const ctx={S,_paperFilling:false,_fillQuoteCache:null,infChartData:[],vrChartData:[],lastQuote:{inf:null,ma:null},
    infQuoteCache:orig.inf,maQuoteData:orig.ma,ivsQuoteData:orig.ivs,ivsQuote1:orig.ivs1,dcaQuoteData:orig.dca,asapQuoteData:orig.asap,
    PAPER_TABS:[['inf','무매'],['ma','이평']],paperPrefetchQuotes:async()=>{},
    PAPER_CACHESYM:{inf:()=>ctx.infQuoteCache&&ctx.infQuoteCache.symbol,ma:()=>ctx.maQuoteData&&ctx.maQuoteData.symbol},
    PAPER_LOADERS:{inf:async()=>{ ctx.infQuoteCache={symbol:'TQQQ'}; ctx.ivsQuoteData={symbol:'X'}; },ma:async()=>{ ctx.maQuoteData={symbol:'TQQQ'}; ctx.dcaQuoteData={symbol:'Y'}; ctx.asapQuoteData={symbol:'Z'}; ctx.ivsQuote1={symbol:'W'}; }},
    divCashOn:()=>false,warmDiv:async()=>{},ivsX1Of:x=>x,paperAuto:()=>{},vrSimForward:()=>{},infSimForward:()=>{},paperStart:()=>'2025-01-02',
    paperStat:(tab,x)=>({tab,id:x.id}),console:{error(){}},Map,Promise};
  vm.createContext(ctx); vm.runInContext(fn('async function paperFillAll()'),ctx);
  const rows=await ctx.paperFillAll(); assert.equal(rows.length,2);
  for(const [k,v] of [['inf','infQuoteCache'],['ma','maQuoteData'],['ivs','ivsQuoteData'],['ivs1','ivsQuote1'],['dca','dcaQuoteData'],['asap','asapQuoteData']])
    assert.equal(ctx[v],orig[k],v+' 되돌림');
  assert.equal(ctx._paperFilling,false); assert.equal(ctx._fillQuoteCache,null);
  // 선취(prefetch)가 던져도 재생 상태가 풀린다(예전엔 try 밖이라 _paperFilling 이 영영 true)
  ctx.paperPrefetchQuotes=async()=>{ throw Error('net'); }; await ctx.paperFillAll().catch(()=>{});
  assert.equal(ctx._paperFilling,false,'선취 실패 뒤에도 풀린다');
});
await t('P7 MDD 속도: 기록과 무관한 가격 계산은 시세 배열마다 한 번 — 같은 배열이면 같은 결과를 다시 쓰고, 새 배열·길이 변화·확정 상한 변화면 다시 센다(값은 새로 센 것과 같다)',async()=>{
  const days=[]; let px=40; for(let i=0;i<700;i++){ px*=1+Math.sin(i*0.37)*0.03; const d=new Date(Date.UTC(2023,0,2)+i*864e5).toISOString().slice(0,10); days.push({date:d,close:+px.toFixed(4)}); }
  const D=new Function('DCA_N',fn('function _dcaPriceView(days){')+'\nreturn _dcaPriceView;')(200);
  const a=D(days), b=D(days), c=D(days.map(x=>({...x})));
  assert.equal(a,b,'같은 배열 → 같은 계산 결과 재사용'); assert.notEqual(a,c);
  assert.deepEqual({sma:a.sma,flips:a.flips,closes:a.closes,dates:a.dates},{sma:c.sma,flips:c.flips,closes:c.closes,dates:c.dates},'값은 새로 센 것과 같다');
  // 기준: 예전 식(배열 shift) 그대로 센 200일선과 같다
  const ref=[]; { let s2=0; const buf=[]; for(const x of days){ buf.push(x.close); s2+=x.close; if(buf.length>200)s2-=buf.shift(); ref.push(buf.length===200?s2/200:null); } }
  assert.deepEqual(a.sma,ref,'200일선 = 예전 식');
  days.push({date:'2099-01-01',close:50}); const e=D(days); assert.notEqual(e,a,'길이가 바뀌면 다시 센다'); assert.equal(e.dates[e.n-1],'2099-01-01');
  const A=new Function('_asapMA','_asapRSI',fn('function _asapPriceView(days){')+'\nreturn _asapPriceView;')(
    new Function(fn('function _asapMA(a,k){')+'\nreturn _asapMA;')(), new Function(fn('function _asapRSI(a){')+'\nreturn _asapRSI;')());
  const d2=days.slice(0,650), x1=A(d2), x2=A(d2), x3=A(d2.map(x=>({...x})));
  assert.equal(x1,x2); assert.deepEqual(JSON.parse(JSON.stringify(x1)),JSON.parse(JSON.stringify(x3)),'ASAP 지표·국면 = 새로 센 값');
  let cut='2023-06-30';
  const SB=new Function('simCutoff',fn('function settledBars(rows,cur){')+'\nreturn settledBars;')(()=>cut);
  const r1=SB(days,'usd'), r2=SB(days,'usd'); assert.equal(r1,r2,'같은 배열·같은 상한 → 같은 결과'); assert(r1.every(x=>x.date<=cut));
  cut='2023-12-29'; const r3=SB(days,'usd'); assert.notEqual(r3,r1,'상한이 바뀌면 다시'); assert(r3.length>r1.length);
  days.push({date:'2099-02-01',close:51}); cut='2099-12-31'; const r4=SB(days,'usd'), r5=SB(days,'usd'); assert.equal(r4,r5); days.push({date:'2099-03-01',close:52}); assert.notEqual(SB(days,'usd'),r4,'길이 변화 → 다시');
  assert.deepEqual(SB(null,'usd'),[]);
});
await t('P7 거래소 현지 시각: 포맷터는 시간대마다 한 번만 만든다 · 값은 그 시각 그대로',async()=>{
  let made=0; const RealDTF=Intl.DateTimeFormat;
  const FakeIntl={DateTimeFormat:function(...a){ made++; return new RealDTF(...a); }};
  /* 시계를 호출마다 1.5초씩 민다 — 초 단위 기억에 기대지 않고 포맷터 재사용 자체를 본다 */
  let tick=Date.UTC(2026,9,6,14,0,0); class FD extends Date{ constructor(...a){ if(a.length) super(...a); else { super(tick); tick+=1500; } } }
  const ex=new Function('Intl','Date',fn('function _exchNow(cur){')+'\nreturn _exchNow;')(FakeIntl,FD);
  for(let i=0;i<200;i++){ ex('usd'); ex('krw'); }
  assert.equal(made,2,'포맷터 생성 '+made+'번');
  const ny=ex('usd'); assert(/^\d{4}-\d{2}-\d{2}$/.test(ny.date));
  const at=tick, v=ex('krw'), want=new RealDTF('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
  assert.equal(v.date,want); assert(v.min>=0&&v.min<1440);
});

await t('D1 저장 실패 안내: 크기 · 사용량 한도 · 권한 · 그 밖을 가른다 — "Quota exceeded" 를 크기로 적지 않는다 · 크기는 문서 전체(칸별 내역)',async()=>{
  const src=(html.match(/const DB_DOC_LIMIT=1048576, DB_DOC_WARN=[^\n]*/)||[''])[0]+'\n'+(html.match(/const DB_FIELD_LABEL=\{[\s\S]*?\};/)||[''])[0]+'\n'
    +['function dbStateBytes(json)','function dbPartsText(parts, n)','function dbErrKind(err)','function dbErrBytes(err)','function dbSizeMsg(bytes, err, parts)'].map(fn).join('\n');
  const F=new Function('TextEncoder','_dbArchiveBlocked',src+'\nreturn {dbSizeMsg,dbErrKind,dbErrBytes,dbStateBytes,DB_DOC_LIMIT,DB_DOC_WARN};')(TextEncoder,false);
  assert.equal(F.DB_DOC_LIMIT,1048576); assert.equal(F.DB_DOC_WARN,Math.round(1048576*0.8));
  const parts=[{k:'stateV2',bytes:662*1024},{k:'state',bytes:398*1024},{k:'scalp',bytes:41*1024},{k:'stateV2Rev',bytes:20}];
  // Firestore 가 크기로 거절할 때 적는 글(문서 크기 숫자가 들어 있다) — 그 숫자로 적는다
  const sizeErr={code:'invalid-argument',message:"Document 'projects/jk-invest/databases/(default)/documents/users/u1' cannot be written because its size (1,101,824 bytes) exceeds the maximum allowed size of 1,048,576 bytes."};
  assert.equal(F.dbErrKind(sizeErr),'size'); assert.equal(F.dbErrBytes(sizeErr),1101824);
  const e1=F.dbSizeMsg(F.dbErrBytes(sizeErr),sizeErr,parts); assert.equal(e1.level,'err');
  assert(/문서 전체 1076KB = 운영·모의 기록 662KB · 옛 형식 사본\(10\/2 이전\) 398KB · 단타 41KB\./.test(e1.text),e1.text);
  assert(/모든 칸을 합한 크기/.test(e1.text) && !/기록이 \d+KB 로/.test(e1.text),'예전 문구(기록 N KB 로 넘어) 아님');
  // 사용량 한도 — 'exceeded' 가 들어 있어도 크기 문제가 아니다 (예전엔 /exceed/ 로 크기 탓을 했다)
  const quota={code:'resource-exhausted',message:'Quota exceeded.'};
  assert.equal(F.dbErrKind(quota),'quota');
  const e2=F.dbSizeMsg(828*1024,quota,parts); assert(/사용량 한도/.test(e2.text) && /크기 문제가 아닙니다/.test(e2.text) && !/문서 한 개의 한도/.test(e2.text),e2.text);
  const perm={code:'permission-denied',message:'Missing or insufficient permissions.'};
  assert.equal(F.dbErrKind(perm),'perm'); assert(/권한이 거절/.test(F.dbSizeMsg(300*1024,perm,parts).text));
  // 그 밖(네트워크 등) — 문서가 커 보여도 서버가 크기라고 안 했으면 크기 탓을 하지 않는다
  const e4=F.dbSizeMsg(1100*1024,new Error('internal'),parts); assert.equal(F.dbErrKind(new Error('internal')),'other');
  assert(/저장에 실패했습니다 — internal/.test(e4.text) && !/문서 한 개의 한도/.test(e4.text),e4.text);
  // 경고 — 문서 전체 기준 · 내역 함께
  assert.equal(F.dbSizeMsg(500*1024,null,parts),null,'500KB 는 조용');
  const w=F.dbSizeMsg(900*1024,null,parts); assert.equal(w.level,'warn'); assert(/900KB/.test(w.text)&&/88%/.test(w.text)&&/운영·모의 기록 662KB/.test(w.text),w.text);
  assert(/기록크기/.test(fn('function authDiag()')) && /dbPartsText\(dbPartsNow,6\)/.test(fn('function authDiag()')),'진단 정보에 문서 크기·내역');
});
await t('D2 Firestore 크기 계산식 — 공식 문서 예시(users/jeff/tasks/my_task_id · 147바이트) · 한글 3바이트 · 숫자 8바이트',async()=>{
  const src=['function utf8Len(s)','function fsValueBytes(v)','function fsDocParts(d)','function fsDocBytes(path, parts)'].map(fn).join('\n');
  const F=new Function(src+'\nreturn {utf8Len,fsValueBytes,fsDocParts,fsDocBytes};')();
  assert.equal(F.utf8Len('abc'),3); assert.equal(F.utf8Len('가나다'),9); assert.equal(F.utf8Len('😀'),4);
  assert.equal(F.fsValueBytes(null),1); assert.equal(F.fsValueBytes(false),1); assert.equal(F.fsValueBytes(1.5),8); assert.equal(F.fsValueBytes(3),8);
  assert.equal(F.fsValueBytes('abc'),4); assert.equal(F.fsValueBytes([1,'a']),10); assert.equal(F.fsValueBytes({a:1}),10);
  assert.equal(F.fsValueBytes({가:'나'}),8); assert.equal(F.fsValueBytes({x:{y:[true]}}),5);
  const task={type:'Personal',done:false,priority:1,description:'Learn Cloud Firestore'};
  const P=F.fsDocParts(task); assert.equal(P.reduce((a,p)=>a+p.bytes,0),71,'칸 합 71');
  assert.equal(F.fsDocBytes('users/jeff/tasks/my_task_id',P),147,'공식 예시 147바이트');
  assert.deepEqual(P.map(p=>p.k),['description','priority','type','done'],'큰 순');
  // 무매 모의 한 줄 — JSON 117바이트 · Firestore 98바이트 (숫자는 자릿수와 무관하게 8)
  const rec={date:'2026-10-05',kind:'1회매수',price:164.27,qty:31,amt:5092.37,fee:0,ts:1791317714930,sim:true};
  assert.equal(F.fsValueBytes(rec),98); assert.equal(Buffer.byteLength(JSON.stringify(rec)),117);
});
await t('D3 문서가 경고선(80%)을 넘고 옛 형식 사본(state)이 있으면 — 사본을 archive 하위 문서로 옮기고 본 문서에서 지운다 · 한 트랜잭션 · 작은 문서·사본 없음은 그대로',async()=>{
  const consts=(html.match(/const DB_DOC_LIMIT=1048576, DB_DOC_WARN=[^\n]*/)||[''])[0]+'\n'+(html.match(/const DB_LEGACY_KEYS=[^\n]*/)||[''])[0];
  const src=consts+'\n'+['function utf8Len(s)','function fsValueBytes(v)','function fsDocParts(d)','function fsDocBytes(path, parts)','function dbPlanWrite(path, d, fields, force, canArchive)'].map(fn).join('\n');
  const F=new Function(src+'\nreturn {dbPlanWrite,fsValueBytes,DB_DOC_WARN,DB_DOC_LIMIT};')();
  const blob=n=>'x'.repeat(n);
  const legacy={inf:{sessions:[{id:'a',hist:[{note:blob(420*1024)}]}]}};
  const big={stateV2:{inf:{sessions:[{id:'a',hist:[{note:blob(600*1024)}]}]}},state:legacy,updated:1,stateRev:57,scalp:{log:[blob(30*1024)]}};
  const fields={stateV2:{inf:{sessions:[{id:'a',hist:[{note:blob(610*1024)}]}]}},stateV2Updated:2,stateV2Rev:9};
  const a=F.dbPlanWrite('users/u1',big,fields,false,true);
  assert(a.archive && a.archive.state===legacy && a.archive.updated===1 && a.archive.stateRev===57,'옛 사본 세 칸을 그대로 옮긴다');
  assert(!a.parts.some(p=>['state','updated','stateRev'].includes(p.k)) && a.parts.some(p=>p.k==='scalp'),'남은 칸 = 새 기록 + 다른 페이지 칸');
  assert(a.bytes<F.DB_DOC_LIMIT && a.archivedBytes>380*1024,'옮긴 뒤 한도 안 · 옮긴 크기 '+a.archivedBytes);
  const noArc=F.dbPlanWrite('users/u1',big,fields,false,false); assert.equal(noArc.archive,null,'규칙이 막으면(canArchive=false) 옮기지 않는다'); assert(noArc.bytes>F.DB_DOC_LIMIT);
  // 경고선(80%)과 한도 사이 — 이미 무거우면 미리 옮긴다(다음 저장에서 넘기 전에)
  const mid={stateV2:{n:blob(500*1024)},state:{n:blob(350*1024)}};
  const m=F.dbPlanWrite('users/u1',mid,{stateV2:{n:blob(500*1024)}},false,true); assert(m.archive,'80~100% 구간도 옮긴다');
  // 작은 문서 — 옛 사본이 있어도 그대로 (평소 저장은 바뀌지 않는다)
  const small={stateV2:{n:blob(100*1024)},state:{n:blob(200*1024)}};
  assert.equal(F.dbPlanWrite('users/u1',small,{stateV2:{n:blob(100*1024)}},false,true).archive,null);
  assert(F.dbPlanWrite('users/u1',small,{stateV2:{n:blob(100*1024)}},true,true).archive,'바로 전에 크기로 거절됐으면(force) 작아 보여도 옮긴다');
  assert.equal(F.dbPlanWrite('users/u1',{stateV2:{n:blob(900*1024)}},{stateV2:{n:blob(900*1024)}},true,true).archive,null,'옛 사본이 없으면 옮길 것 없음');
});
await t('D4 저장 배선 — 옮기기·지우기·새 기록이 한 트랜잭션 · 크기로 거절되면 한 번만 옮기며 다시 저장 · 보관 쓰기를 규칙이 막으면 옮기지 않고 다시 저장',async()=>{
  const consts=(html.match(/const DB_DOC_LIMIT=1048576, DB_DOC_WARN=[^\n]*/)||[''])[0]+'\n'+(html.match(/const DB_LEGACY_KEYS=[^\n]*/)||[''])[0];
  const helpers=['function utf8Len(s)','function fsValueBytes(v)','function fsDocParts(d)','function fsDocBytes(path, parts)','function dbPlanWrite(path, d, fields, force, canArchive)','function dbErrKind(err)','function dbErrBytes(err)'].map(fn).join('\n');
  const blob=n=>'x'.repeat(n);
  const run=async(remote,failWith)=>{
    const sets=[], timers=[], reports=[]; let txCount=0;
    const DEL={del:true};
    const ctx={S:{inf:{sessions:[]},big:blob(620*1024)},curUid:'u1',stateCloudHydrated:true,stateCloudRev:0,stateCloudHistorySig:'',stateDbBase:null,stateCloudPending:true,lastPushedJSON:'',
      _dbPlan:null,_dbForceArchive:false,_dbArchiveBlocked:false,_dbArchivedNote:'',console:{error(){},warn(){}},setTimeout:(f)=>{timers.push(f);return 0;},
      _staleStateGuard(){},validState:x=>!!(x&&x.inf),_historySignature:()=>'',_rebaseStateOnRemote:(a,b)=>b,ensureBoxes(){},refreshAll(){},setSync(){},
      dbSizeReport:(b,e,p)=>reports.push({b,e:e&&e.code,p}),pushRemoteNow:async()=>{},
      window:{fb:{db:{},doc:(db,...p)=>({path:p.join('/')}),deleteField:()=>DEL,
        runTransaction:async(db,cb)=>{ txCount++; const local=[]; const tx={get:async()=>({exists:()=>true,data:()=>JSON.parse(JSON.stringify(remote))}),set:(ref,data,opt)=>local.push({path:ref.path,data,opt})};
          const out=await cb(tx); const f=failWith&&failWith(local); if(f) throw f; sets.push(...local); return out; }}}};
    vm.createContext(ctx); vm.runInContext(consts+'\n'+helpers+'\n'+fn('async function _commitStateRemote(where)'),ctx);
    const ok=await ctx._commitStateRemote('t');
    return {ok,sets,timers,reports,ctx,txCount};
  };
  const remote={stateV2:{inf:{sessions:[]}},stateV2Rev:0,state:{inf:{sessions:[{id:'old',hist:[{n:blob(400*1024)}]}]}},updated:7,stateRev:3};
  const a=await run(remote,null);
  assert.equal(a.ok,true);
  const arc=a.sets.find(x=>/^users\/u1\/archive\/legacy-state-\d+$/.test(x.path)), main=a.sets.find(x=>x.path==='users/u1');
  assert(arc && JSON.stringify(arc.data.state)===JSON.stringify(remote.state) && arc.data.updated===7 && arc.data.stateRev===3,'보관 문서에 옛 사본 그대로');
  assert(main && main.data.state.del && main.data.updated.del && main.data.stateRev.del && main.opt.merge && main.data.stateV2,'본 문서: 옛 칸 지우기 + 새 기록');
  assert.equal(a.txCount,1,'한 트랜잭션'); assert(/옛 형식 사본\(\d+KB\)을 보관 문서로 옮겨/.test(a.ctx._dbArchivedNote),'성공 안내');
  // 크기로 거절 — 이번에 안 옮겼고 옛 사본이 있으면 force 로 한 번만 다시
  const sizeErr=Object.assign(new Error("Document 'x' cannot be written because its size (1,200,000 bytes) exceeds the maximum allowed size of 1,048,576 bytes."),{code:'invalid-argument'});
  const smallRemote={stateV2:{inf:{sessions:[]}},stateV2Rev:0,state:{inf:{sessions:[]},n:blob(50*1024)}};
  const b=await run(smallRemote,()=>sizeErr);
  assert.equal(b.ok,false); assert.equal(b.ctx._dbForceArchive,true); assert.equal(b.timers.length,1,'한 번 다시 저장'); assert.equal(b.reports[0].b,1200000,'서버가 적은 크기로 안내');
  b.ctx._dbPlan=null; await b.ctx._commitStateRemote('again');   // force 상태에서 또 거절 → 더는 다시 안 함
  assert.equal(b.timers.length,1,'반복하지 않는다');
  // 보관 하위 문서를 규칙이 막으면 — 옮기지 않고 다시 저장(평소 저장까지 막히면 안 된다)
  const permErr=Object.assign(new Error('Missing or insufficient permissions.'),{code:'permission-denied'});
  const c=await run(remote,local=>local.some(x=>/archive/.test(x.path))?permErr:null);
  assert.equal(c.ok,false); assert.equal(c.ctx._dbArchiveBlocked,true); assert.equal(c.timers.length,1);
  c.ctx._dbPlan=null; const ok2=await c.ctx._commitStateRemote('retry');
  assert.equal(ok2,true,'옮기지 않고 저장 성공'); assert(!c.sets.some(x=>/archive/.test(x.path)),'보관 쓰기 시도 안 함');
});
await t('P8 모의 표는 계산이 끝나면 바로 다시 그린다 — 클라우드 저장이 안 끝나도 · 재계산이 실패하면 "다시 계산하는 중"을 실패 안내로 바꾼다',async()=>{
  // 저장이 끝나지 않는(느린 iOS long-polling 흉내) 상황에서도 onRows 는 계산 결과로 바로 불린다
  let saveDone=false, got=null, order=[];
  const ctx={_paperViewRefreshPromise:null,$:()=>null,paperRepairCommonStarts:async()=>0,paperViewCacheRead:()=>null,paperViewCacheFresh:()=>false,
    loadFX:async()=>{},paperFillAll:async()=>[{id:'a'}],paperViewCacheWrite:()=>order.push('cache'),
    pushRemoteNow:()=>new Promise(r=>setTimeout(()=>{ saveDone=true; order.push('saved'); r(true); },400)),refreshAll:()=>{}};
  vm.createContext(ctx); vm.runInContext(fn('async function refreshPaperView(force=false, onRows=null)'),ctx);
  const p=ctx.refreshPaperView(false, rows=>{ got=rows; order.push('draw'); });
  await tick(30);
  assert.deepEqual(got,[{id:'a'}],'계산 결과로 바로 그린다'); assert.equal(saveDone,false,'저장은 아직');
  await p; assert.deepEqual(order,['cache','draw','saved'],'캐시 → 그리기 → 저장 순서');
  // openPaper 배선: 계산 직후 그리기(onRows) · 같이 기다린 경우 끝날 때 한 번 · 두 번 그리지 않음 · 실패면 안내
  const op=fn('async function openPaper()');
  assert(/const redraw=r=>\{ if\(drawn\|\|!r\)return; drawn=true;/.test(op) && /refreshPaperView\(false,redraw\)\.then\(redraw,e=>\{ console\.error\('paper refresh',e\); paperStaleFail\(\); \}\)/.test(op),'openPaper 배선');
  const note={style:{},textContent:'🔄 지난번 계산 결과입니다 — 오늘 기준으로 다시 계산하는 중…'};
  const fail=new Function('$',fn('function paperStaleFail()')+'\nreturn paperStaleFail;')(id=>id==='paper_stale_note'?note:null);
  assert.equal(fail(),true); assert(/재계산에 실패했습니다/.test(note.textContent) && !/다시 계산하는 중/.test(note.textContent),note.textContent);
  assert.equal(new Function('$',fn('function paperStaleFail()')+'\nreturn paperStaleFail;')(()=>null)(),false,'안내가 없으면 할 일 없음');
});
await t('P9 원화 평가와 달러 수익률이 어긋나 보이던 것 — 줄마다 원화 수익률(평가÷투입) · 표 위에 시작일 환율 → 지금 환율',async()=>{
  const K=new Function(fn('function paperKrwRet(r)')+'\nreturn paperKrwRet;')();
  const L=new Function(fn('function paperFxLine(rows)')+'\nreturn paperFxLine;')();
  // 사용자 화면(2026-10-06): 원금 1억원 · 시작일 환율 1,508.45 → 달러 원금 66,293.03$ · 지금 1,338.47원
  const inflow=1e8/1508.45, fxNow=1338.47;
  const row=(won,extra)=>Object.assign({cur:'usd',price:164.27,inflow,inflowWon:1e8,wonRate:fxNow,total:won/fxNow},extra||{});
  const a=row(110743733), b=row(95592291), c=row(106888195);
  assert.equal(K(a).toFixed(1),'10.7'); assert.equal(K(b).toFixed(1),'-4.4'); assert.equal(K(c).toFixed(1),'6.9');
  // 달러 기준 최종은 같은 줄에서 +24.8% · +7.7% — 차이는 정확히 환율 변화(×0.8873)
  assert.equal(((a.total/inflow-1)*100).toFixed(1),'24.8'); assert.equal(((b.total/inflow-1)*100).toFixed(1),'7.7');
  assert(Math.abs((1+K(a)/100)/(a.total/inflow)-fxNow/1508.45)<1e-12,'원화÷달러 = 환율 변화');
  assert.equal(K({cur:'krw',price:1,inflow:1e8,inflowWon:1e8,wonRate:1,total:1.2e8}),null,'원화 종목은 최종과 같아 안 적는다');
  assert.equal(K(row(1e8,{price:0})),null,'시세 없는 줄은 비운다'); assert.equal(K(row(1e8,{inflowWon:null})),null);
  const line=L([a,b,c,{cur:'krw',price:1,inflow:1,inflowWon:1,wonRate:1}]);
  assert(/시작일 환율 1,508원 → 지금 1,338원 \(−11\.3%\)/.test(line),line);
  assert(/평가\(원\)<\/b>는 지금 환율로 바꾼 값, <b>최종·현재·연\(%\)<\/b>은 달러 기준/.test(line));
  assert(/시작일 환율 1,450~1,508원\(세션마다 다름\) → 지금 1,338원/.test(L([a,Object.assign(row(1e8),{inflow:1e8/1450})])),'시작일이 다르면 범위');
  assert.equal(L([{cur:'krw',price:1,inflow:1,inflowWon:1,wonRate:1}]),'','원화 종목뿐이면 안 적는다');
  const op=fn('async function openPaper()');
  assert(op.indexOf('h=paperFxLine(rows)+h;')>0 && op.indexOf('h=paperFxLine(rows)+h;')<op.indexOf('if(paperStaleNote) h=')
     && /원화 \$\{paperKrwRet\(r\)>=0\?'\+':''\}\$\{paperKrwRet\(r\)\.toFixed\(1\)\}%/.test(op),'표 배선');
});
await t('P10 폰 폭: 첫 칸 윗줄(줄바꿈 없음)은 설정 2개까지 — 3개면 375px 폰에서 최종 칸이 잘렸다',async()=>{
  const op=fn('async function openPaper()');
  const m=op.match(/const _paperSplitAt=_paperCompact\?1:(\d+);/); assert(m,'split');
  assert.equal(+m[1],2);
  // 실제 무매 설정으로 윗줄 글자 수 — 'SOXL · 20분할 · 익절 자동' 까지만
  const opts=['20분할','익절 자동','LOC 3줄','단리'], top=' · '+opts.slice(0,+m[1]).join(' · ');
  assert.equal('SOXL'+top,'SOXL · 20분할 · 익절 자동');
});
/* ── 자산플랜 열기 (2026-10-07 사용자 화면: "자산플랜만 로그인 페이지가 다르고 오류가 나고 시세도 느리다") ── */
await t('P11 자산플랜 8초: 로그인됐고 원장을 읽는 중이면 로그인 상자 대신 "원장 불러오는 중" · 로그인 안 된 채 무응답이면 예전처럼 로그인 상자',async()=>{
  const tm=(plan.match(/setTimeout\(function\(\)\{ var h=document\.documentElement;[\s\S]*?\}, 8000\);/)||[''])[0]; assert(tm,'plan 8s timer');
  const run=win=>{ const cls=new Set(['had-user']), e={textContent:''}, notes=[]; let f=null;
    new Function('document','window','setTimeout','planBootNote',tm)({documentElement:{classList:{contains:c=>cls.has(c),remove:c=>cls.delete(c)}},getElementById:()=>e},win,fn=>{f=fn;},(x,n)=>notes.push(x)); f();
    return {had:cls.has('had-user'),msg:e.textContent,notes}; };
  const a=run({__planAuthResolved:true,__planAuthUser:true});
  assert.equal(a.had,true,'로그인된 사람에게 로그인 상자를 띄우지 않는다'); assert.equal(a.msg,''); assert.deepEqual(a.notes,['로그인됨 · Firebase DB 원장을 불러오는 중…']);
  const b=run({__planAuthResolved:false}); assert.equal(b.had,false); assert(/늦어지고 있습니다/.test(b.msg),'무응답은 로그인 상자 + 안내');
  const c=run({__planAuthResolved:true,__planAuthUser:false}); assert.equal(c.had,false); assert.equal(c.msg,'','로그아웃 판정이면 겁주는 문구 없이 로그인 상자');
  assert(/window\.__planAuthResolved=true;[^\n]*\n\s*window\.__planAuthUser=!!user;/.test(plan),'onAuthStateChanged 맨 앞에서 세운다');
});
await t('P12 대기 문구(planBootNote) — 로그인 상자가 아니라 "확인 중" 화면(had-user)에 적는다 · 이미 열렸으면 손대지 않는다',async()=>{
  const src=fnOf(plan,'function planBootNote(text, note){');
  const mk=open=>{ const cls=new Set(open?['authed']:[]), E={bwText:{textContent:'로그인 확인 중…'},bwNote:{textContent:''}};
    const f=new Function('document',src+'\nreturn planBootNote;')({documentElement:{classList:{contains:c=>cls.has(c),add:c=>cls.add(c)}},getElementById:id=>E[id]||null});
    return {f,cls,E}; };
  const a=mk(false); a.f('로그인됨 · Firebase DB 원장을 불러오는 중…','늦어집니다');
  assert.deepEqual([a.cls.has('had-user'),a.E.bwText.textContent,a.E.bwNote.textContent],[true,'로그인됨 · Firebase DB 원장을 불러오는 중…','늦어집니다']);
  a.f(null); assert.equal(a.E.bwText.textContent,'로그인됨 · Firebase DB 원장을 불러오는 중…','글자 없이 부르면 그대로'); assert.equal(a.E.bwNote.textContent,'');
  const b=mk(true); b.f('x'); assert.deepEqual([b.cls.has('had-user'),b.E.bwText.textContent],[false,'로그인 확인 중…'],'열린 뒤엔 그대로');
  assert(/<span id="bwText">로그인 확인 중…<\/span><div class="bw-note" id="bwNote"><\/div>/.test(plan),'화면 칸');
});
await t('P13 원장이 12초 넘게 걸려도 실패로 돌리지 않는다 — "늦어지고 있습니다"를 적고 계속 기다렸다 열고, 진짜 오류만 다시 연결로 · 시세는 원장 읽기 전에 미리 받기 시작',async()=>{
  const src=fnOf(plan,'async function finishPlanOpen(user){');
  assert(!/planWithTimeout\(cloudLoad/.test(src),'12초에 끊던 옛 방식 없음');
  const mk=loadMs=>{ const log=[]; let rej=null;
    const f=new Function('startPlanQuotePrefetch','planBootNote','cloudLoad','PLAN_DB_SLOW_MS','planGate','refreshLive','requestedAssetSessionId','renderAssetSessions','loadActiveAssetSessionView','setTimeout','clearTimeout','planBootHydrating',src+'\nreturn finishPlanOpen;')(
      ()=>log.push('prefetch'),(x,n)=>log.push('note:'+(n||x)),()=>{ log.push('cloudLoad'); return new Promise((res,rj)=>{ rej=rj; setTimeout(()=>{ log.push('loaded'); res(); },loadMs); }); },
      20,on=>log.push('gate:'+on),async()=>log.push('refreshLive'),null,()=>log.push('sessions'),async()=>log.push('view'),setTimeout,clearTimeout,true);
    return {f,log,fail:e=>rej(e)}; };
  const A=mk(60); await A.f({uid:'u'});
  assert.deepEqual(A.log.filter(x=>!/^note:/.test(x)),['prefetch','cloudLoad','loaded','gate:true','refreshLive','sessions','view'],'미리 받기 → 원장 → 열기 → 시세');
  assert(A.log.some(x=>/^note:DB 응답이 늦어지고 있습니다/.test(x)),'늦으면 안내(로그인 상자 아님)');
  assert(A.log.indexOf('gate:true')>A.log.findIndex(x=>/늦어지고/.test(x)),'안내 뒤에도 끝까지 기다려 연다');
  const B=mk(5); await B.f({uid:'u'}); assert(!B.log.some(x=>/늦어지고/.test(x)),'빨리 오면 안내 없음');
  const C=mk(1e6); const p=C.f({uid:'u'}); C.fail(new Error('permission-denied'));
  await assert.rejects(p,/permission-denied/,'진짜 오류는 그대로 올려 다시 연결 화면으로'); assert(!C.log.includes('gate:true'));
  assert(/catch\(e\)\{console\.error\('plan cloud open',e\);showPlanDbRetry\(e\);\}/.test(plan),'오류만 다시 연결');
});
await t('P14 같은 원장을 두 번 읽지 않는다 — 방금(20초 안) 쓰기 없이 읽은 문서는 첫 loadOperatingState 가 한 번 그대로 쓰고, 그 뒤·쓰기 뒤·20초 뒤엔 다시 읽는다',async()=>{
  const decl=(plan.match(/let planSnapCache=null;[\s\S]*?\nfunction takePlanSnap\(uid\)\{[\s\S]*?\n\}/)||[''])[0]; assert(decl,'캐시 선언');
  const cl=fnOf(plan,'async function cloudLoad(user){'), lo=fnOf(plan,'async function loadOperatingState(user){');
  const mk=data=>{ let now=1e12, reads=0, saves=0;
    const C={console:{error(){}},Date:{now:()=>now},getDoc:async()=>{ reads++; return {exists:()=>true,data:()=>JSON.parse(JSON.stringify(data))}; },doc:(db,c,id)=>c+'/'+id,db:{},
      restoreMorningPlanFromLegacy:async()=>false,PLAN_LEGACY_RESTORE_MARK:'mark',planHistorySig:()=>'',planOpHistorySig:()=>'',cloneObj:x=>JSON.parse(JSON.stringify(x)),
      apply(){},renderSessionSelectors(){},renderLedger(){},renderAlphaLedger(){},render(){},renderAssetSessions(){},$:()=>null,defaults:()=>({}),
      cloudSave:async()=>{ saves++; },saveOperatingState:async()=>{ saves++; },ensureLiveBoxes(){},migrateLiveInfOperatingDefaults:()=>false,opLocalState:()=>null,
      planStateConflict:false,liveState:null,planStateDbBase:null,liveStateSource:'',planStateCloudRev:0,planStateHistorySig:'',planStateCloudHydrated:false,planCloudHydrated:false,planCloudRev:0,planCloudHistorySig:'',planDbState:null};
    vm.createContext(C); vm.runInContext(decl+'\n'+cl+'\n'+lo+'\nthis.cloudLoad=cloudLoad;this.loadOperatingState=loadOperatingState;',C);
    return {C,reads:()=>reads,saves:()=>saves,later:ms=>{ now+=ms; }}; };
  const D={fiveYearPlanV2:{alphaLedger:{}},stateV2:{inf:{sessions:[]},vr:{sessions:[]},mark:7},stateV2Rev:3};
  const A=mk(D), U={uid:'u1'};
  await A.C.cloudLoad(U); assert.equal(A.reads(),1);
  await A.C.loadOperatingState(U); assert.equal(A.reads(),1,'열 때 두 번째 읽기 없음');
  assert.equal(A.C.liveState.mark,7); assert.equal(A.C.planStateCloudRev,3); assert.equal(A.C.liveStateSource,'Firebase 운영 원장');
  await A.C.loadOperatingState(U); assert.equal(A.reads(),2,'다음 새로고침은 DB 를 다시 읽는다');
  const B=mk(D); await B.C.cloudLoad(U); B.later(20001); await B.C.loadOperatingState(U); assert.equal(B.reads(),2,'20초 지나면 다시 읽는다');
  const W=mk({fiveYearPlan:{alphaLedger:{}},stateV2:{inf:{},vr:{}},stateV2Rev:1}); await W.C.cloudLoad(U); assert.equal(W.saves(),1,'옛 칸 → 새 칸 저장');
  await W.C.loadOperatingState(U); assert.equal(W.reads(),2,'쓰기를 했으면 바뀐 문서를 다시 읽는다');
  const O=mk(D); await O.C.cloudLoad(U); await O.C.loadOperatingState({uid:'other'}); assert.equal(O.reads(),2,'다른 계정이면 다시 읽는다');
});
await t('P15 자산플랜 시세 — 원장 읽기와 같이 받기 시작 · TECL·TQQQ·SGOV 가 오면 "오늘 주문"을 먼저 그린다(SOXL·QQQ·QLD 를 안 기다린다)',async()=>{
  const rl=fnOf(plan,'async function refreshLive(){'), cutAt='const [qs,qv,qt,qqq,qld,sgov]=await Promise.all([pS,pV,pT,pQ,pL,pG]);', cut=rl.indexOf(cutAt); assert(cut>0,'시세 묶음');
  const head=rl.slice(0,cut)+cutAt+'\n    return {qs,qv,qt,qqq,qld,sgov};\n  }finally{liveBusy=false;}\n}';
  const log=[], gate={}, Q={}; for(const s of ['SOXL','TECL','TQQQ','QQQ','QLD','SGOV']) Q[s]=new Promise(r=>gate[s]=()=>r({symbol:s}));
  let opDone; const op=new Promise(r=>opDone=r);
  const C={$:()=>({disabled:false,textContent:''}),liveBusy:false,liveQuotes:{},fetchPlanQuote:s=>{ log.push('q:'+s); return Q[s]; },
    loadOperatingState:()=>{ log.push('op'); return op; },auth:{currentUser:{uid:'u'}},renderSessionSelectors(){},linkedOpSession:()=>null,liveState:null,planLinks:{},
    renderAlphaPlan:(a,b,c)=>log.push('alpha:'+[a,b,c].map(x=>x.symbol).join(',')),renderAlphaLedger:()=>log.push('ledger')};
  vm.createContext(C); vm.runInContext(head+'\nthis.run=refreshLive;',C);
  const p=C.run();
  assert.deepEqual(log.slice(0,7),['q:SOXL','q:TECL','q:TQQQ','q:QQQ','q:QLD','q:SGOV','op'],'시세 6개를 먼저 부르고 원장을 읽는다');
  gate.TECL(); gate.TQQQ(); gate.SGOV(); await tick(5);
  assert(log.includes('alpha:TECL,TQQQ,SGOV') && log.includes('ledger'),'세 종목만 와도 오늘 주문을 그린다: '+log.join(' '));
  gate.SOXL(); gate.QQQ(); gate.QLD(); opDone(); const r=await p; assert.equal(r.qs.symbol,'SOXL'); assert.equal(C.liveBusy,false);
});
await t('P16 자산플랜 시세 미리 받기 — 6종목을 한 번 받아 두고 첫 새로고침이 그대로 쓴다 · 그다음은 새로 받는다 · 미리 받기가 실패했으면 그 자리에서 다시 받는다',async()=>{
  const decl=(plan.match(/const PLAN_QUOTE_SYMS=\[[^\]]*\];\nlet planQuotePrefetch=null;\nfunction startPlanQuotePrefetch\(\)\{[\s\S]*?\n\}/)||[''])[0]; assert(decl,'미리 받기 선언');
  const fq=fnOf(plan,'async function fetchPlanQuote(symbol){');
  const calls=[], failLeft={};
  const C={fetch:async u=>{ const s=/symbol=(\w+)/.exec(u)[1]; calls.push(s); if(failLeft[s]>0){ failLeft[s]--; throw new Error('끊김'); } return {ok:true,json:async()=>({series:[1]})}; },
    AbortController,setTimeout,clearTimeout,planQuoteOf:(s,j)=>({symbol:s,n:calls.length}),liveQuotes:{}};
  vm.createContext(C); vm.runInContext(decl+'\n'+fq+'\nthis.start=startPlanQuotePrefetch;this.get=fetchPlanQuote;this.box=()=>planQuotePrefetch;',C);
  C.start(); C.start(); assert.deepEqual(calls,['SOXL','TECL','TQQQ','QQQ','QLD','SGOV'],'한 번만 · 6종목');
  await tick(5); C.liveQuotes={};                                      // refreshLive 가 처음에 비운다
  const a=await C.get('TECL'); assert.equal(calls.length,6,'첫 새로고침은 미리 받은 걸 쓴다'); assert.equal(a.symbol,'TECL'); assert.equal(C.liveQuotes.TECL,a);
  C.liveQuotes={}; await C.get('TECL'); assert.equal(calls.length,7,'그다음 새로고침은 새로 받는다');
  const D={fetch:C.fetch,AbortController,setTimeout,clearTimeout,planQuoteOf:C.planQuoteOf,liveQuotes:{}}; const calls0=calls.length; failLeft.SGOV=2;   // 미리 받기의 두 번 시도가 다 끊긴다
  vm.createContext(D); vm.runInContext(decl+'\n'+fq+'\nthis.start=startPlanQuotePrefetch;this.get=fetchPlanQuote;',D);
  D.start(); await tick(5); D.liveQuotes={}; const s=await D.get('SGOV');
  assert.equal(s.symbol,'SGOV','실패한 미리 받기는 그 자리에서 다시 받아 채운다'); assert.equal(calls.length,calls0+6+1+1,'6종목 + SGOV 두 번째 시도 + 다시 받기');
});
clearTimeout(ALL_GUARD);
console.log(results.join('\n'));
console.log(failed?`\n${failed} FAIL`:'\nALL PASS');
process.exit(failed?1:0);
})().catch(e=>{ console.error('HARNESS FAIL',e); process.exit(1); });
