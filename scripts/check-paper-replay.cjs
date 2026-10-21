'use strict';
/* 모의 재생 '이어 계산'(index.html _infResume) 검사 — 2026-10-21
   모의 재생(infSimForward)은 하루씩 기록을 덧붙이며 computeInf 를 부른다. 예전엔 부를 때마다 첫 줄부터 다시 세서
   재생이 기록 줄 수의 제곱으로 느려졌다(익절 자동 10년 32초). 지금은 끝난 날까지의 장부를 기억해 두고 그 뒤 줄만 센다.
   기억이 장부를 한 푼이라도 바꾸면 안 된다 — 그래서 실코드를 그대로 떼어 와 vm 에서
     ① 같은 재생을 기억 켬/끔으로 두 번 돌려, computeInf 가 불릴 때마다 내놓는 장부와 남긴 기록이 같은지
     ② 줄을 하나씩 무작위로 덧붙이며(같은 날 여러 줄 · 출금 · 배당 · 리버스 · 복합) 기억한 계산과 처음부터 센 계산이 같은지
     ③ 기억을 쓰면 안 되는 경우(다른 배열 · 설정 변경 · 앞줄 교체 · 날이 안 끝난 자리)에 처음부터 세는지
     ④ 기억이 실제로 쓰이는지(장부 줄 계산 횟수) · 재생이 끝나거나 실패하면 꺼지는지
   를 본다. 시세는 testdata CSV. 사용: node scripts/check-paper-replay.cjs [index.html] [testdata] */
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const IDX=process.argv[2]||path.join(__dirname,'../index.html'), TD=process.argv[3]||path.join(__dirname,'../testdata');
const idx=fs.readFileSync(IDX,'utf8');

/* ── 실코드 떼어 오기 — 이름으로 'function 이름(' 또는 'const|let 이름=' 선언 하나를 통째로 ── */
function scanEnd(s,i,stopAtSemi){   // 문자열·주석을 건너뛰며 괄호 깊이를 센다
  let d=0,q=null,esc=false,line=false,block=false;
  for(;i<s.length;i++){ const c=s[i],n=s[i+1];
    if(line){ if(c==='\n') line=false; continue; }
    if(block){ if(c==='*'&&n==='/'){ block=false; i++; } continue; }
    if(q){ if(esc) esc=false; else if(c==='\\') esc=true; else if(c===q) q=null; continue; }
    if(c==='/'&&n==='/'){ line=true; i++; continue; }
    if(c==='/'&&n==='*'){ block=true; i++; continue; }
    if(c==="'"||c==='"'||c==='`'){ q=c; continue; }
    if('({['.includes(c)) d++;
    else if(')}]'.includes(c)){ d--; if(!stopAtSemi&&d===0&&c==='}') return i+1; }
    else if(stopAtSemi&&c===';'&&d===0) return i+1;
  }
  throw Error('끝을 못 찾음');
}
function srcOf(name){
  const e=name.replace(/[$]/g,'\\$');
  let m=new RegExp('\\n(async )?function '+e+'\\(').exec(idx);
  if(m) return idx.slice(m.index+1, scanEnd(idx, idx.indexOf('{', m.index+1+m[0].length-1), false));
  m=new RegExp('\\n(const|let) ([^\\n]*?\\b)?'+e+'\\s*=').exec(idx);
  if(m) return idx.slice(m.index+1, scanEnd(idx, m.index+1, true));
  return null;
}
/* 필요한 실코드는 이름으로 모은다 — vm 이 'X is not defined' 로 멈추면 X 를 index.html 에서 찾아 더하고 다시 돈다.
   손으로 목록을 적어 두면 엔진이 새 도우미를 쓰는 순간 시험이 엉뚱하게 깨진다(실코드가 아니라 목록이 틀려서). */
const NEED=['infSimForward','computeInf','sortHist','curStrat','tabBox','_infSimBusy','_infReplayAsOf','_infResume'];
const KNOWN=new Set(NEED);
const FIX={off:['_infResume={};','_infResume=null;'], step:['const step=(h,hi)=>{','const step=(h,hi)=>{ __steps++;']};
function code(memo){
  let out='';
  for(const n of KNOWN){ const s=srcOf(n); if(s==null) throw Error('index.html 에서 못 찾음: '+n); out+=s+'\n'; }
  const swap=(src,[a,b],why)=>{ assert.equal(src.split(a).length,2,why+' — 고칠 자리 "'+a+'" 가 꼭 한 번 있어야 한다'); return src.replace(a,b); };
  out=swap(out,FIX.step,'computeInf 장부 줄 계산 횟수');
  if(!memo) out=swap(out,FIX.off,'infSimForward 이어 계산 끄기');
  return out;
}
function context(memo, setup){
  const ctx=vm.createContext({console,Math,Date,JSON,Object,Array,String,Number,Map,Set,WeakMap,isFinite,isNaN,parseFloat,parseInt,Intl,RegExp,Error,Symbol,__steps:0});
  vm.runInContext(code(memo),ctx); setup(ctx); return ctx;
}
/* 실행 중에야 드러나는 의존성(드문 경로의 도우미)은 더한 뒤 그 시험을 처음부터 다시 돈다 — 문맥을 새로 만들어야 보인다 */
const missing=e=>{ const m=String(e&&e.message||e).match(/^([\w$]+) is not defined/); return (m&&!KNOWN.has(m[1])&&srcOf(m[1])!=null)?m[1]:null; };
function retry(fn){ for(let t=0;t<200;t++){ try{ return fn(); }catch(e){ const n=missing(e); if(n){ KNOWN.add(n); continue; } throw e; } } throw Error('의존성을 다 못 모음'); }

/* ── 시세: testdata CSV (Date,Price,Open,High,Low · 최신이 위) ── */
function bars(tk){
  return fs.readFileSync(path.join(TD,tk+'.csv'),'utf8').trim().split(/\r?\n/).slice(1).map(l=>{ const [date,c,o,h,lo]=l.split(','); return {date,close:+c,open:+o||+c,high:+h||+c,low:+lo||+c}; })
    .filter(r=>r.close>0).sort((a,b)=>a.date<b.date?-1:1);
}
const SOXL=bars('SOXL');
/* 배당(체결가 계열 시험용) — 분기 첫 거래일마다 주당 0.03$ (실제 값이 아니라 배당 기록 경로를 지나게 하려는 것) */
const DIVS=SOXL.filter((r,i)=>i>0&&r.date.slice(5,7)!==SOXL[i-1].date.slice(5,7)&&['01','04','07','10'].includes(r.date.slice(5,7))).map(r=>({date:r.date,amount:0.03}));
const quote=(upto,basis)=>{ const O=SOXL.filter(r=>r.date<=upto);
  return {symbol:'SOXL',ohlc:O,days:O.map(r=>({date:r.date,close:r.close})),priceBasis:basis||'adjusted',dividends:basis==='trade'?DIVS.filter(d=>d.date<=upto):[]}; };
const BASE={ticker:'SOXL',div:20,target:20,principal:10000,compound:true,reverse:false,big:20,rows:3};   // 사용자 기본 조건
const noTs=x=>{ const y={...x}; delete y.ts; return y; };
const ledger=(r,full)=>JSON.stringify([r.avg,r.qty,r.inv,r.realized,r.T,r.totbuy,r.totsell,r.bal,r.cycleSeq,r.revState,r.reverseActive,r.reverseDay1,r.revFrom,
  r.withdrawn,r.saved,r.divTotal,r.flows,r.tp,r.tpAuto,r.cycStart,r.rows.length,(full?r.rows:r.rows.slice(-3)).map(noTs)]);

/* ════ ① 재생을 기억 켬/끔으로 두 번 — 부를 때마다 같은 장부 · 같은 기록 ════ */
function replay(memo, sc){
  const calls=[];
  const ctx=context(memo, c=>{
    c.S={activeTab:'inf',inf:{active:'p',sessions:[{id:'p',paper:true,settings:{...BASE,...sc.set},hist:(sc.seed||[]).map(x=>({...x}))}]}};
    c.lastQuote={inf:null}; c.__saveThrows=!!sc.saveThrows; c.__full=false;
    c.__log=r=>calls.push(ledger(r, c.__full||calls.length%29===0));
    vm.runInContext('const __ci=computeInf; computeInf=function(){ const r=__ci(); __log(r); return r; };',c);
    /* 저장이 장부를 읽는다고 치고(요약·화면) 그 자리 장부를 통째로 적는다 — 재생은 정렬 뒤에 저장하므로,
       기억을 정렬 앞에서 안 끄면 정렬 전 순서로 센 줄을 이어 쓰게 된다(늦게 적은 출금이 앞줄 잔금에 섞인다) */
    vm.runInContext('save=function(){ if(__saveThrows) throw Error("저장 실패(시험)"); __full=true; try{ computeInf(); } finally { __full=false; } };',c);
    /* 재생 한가운데서 실패하는 경우 — 하루 주문을 정하는 도우미가 N번째에 멈춘다(정렬·저장 앞 · finally 만 기억을 지울 수 있다) */
    if(sc.throwAt) vm.runInContext('const __bp=imBigPct; let __bn=0; imBigPct=function(st){ if(++__bn==='+sc.throwAt+') throw Error("재생 중 실패(시험)"); return __bp(st); };',c);
  });
  const sess=ctx.S.inf.sessions[0], t0=process.hrtime.bigint(); let err=null;
  for(const step of sc.steps){
    ctx.lastQuote.inf=quote(step.upto, sc.basis);
    if(step.add) step.add(sess);
    try{ vm.runInContext('infSimForward('+JSON.stringify(step.from||null)+')',ctx); }catch(e){ if(missing(e)) throw e; err=e; }
    assert.equal(vm.runInContext('_infResume',ctx),null,sc.name+' — 재생이 끝나면(실패해도) 이어 계산 기억을 지운다');
    assert.equal(vm.runInContext('_infSimBusy',ctx),false,sc.name+' — 재생 끝 표시');
  }
  return {calls,hist:sess.hist.map(noTs),steps:ctx.__steps,ms:Number(process.hrtime.bigint()-t0)/1e6,err,ctx};
}
const SC=[
  {name:'기본 SOXL 20분할 복리 · 2021~2022 하락장',steps:[{from:'2021-01-04',upto:'2022-12-30'}]},
  {name:'익절 자동',set:{autoTp:true},steps:[{from:'2021-06-01',upto:'2023-06-30'}]},
  {name:'리버스 ON 20분할',set:{reverse:true},steps:[{from:'2021-10-01',upto:'2023-03-31'}],need:h=>h.some(x=>/리버스/.test(x.kind))},
  {name:'리버스 ON 40분할',set:{reverse:true,div:40},steps:[{from:'2021-06-01',upto:'2023-06-30'}],need:h=>h.some(x=>/리버스/.test(x.kind))},
  {name:'단리',set:{compound:false},steps:[{from:'2021-01-04',upto:'2022-06-30'}],need:(h,c)=>/"out":[1-9]/.test(c[c.length-1])},
  {name:'체결가 계열 배당 · 손으로 적은 출금 · 두 번 나눠 재생',basis:'trade',set:{autoTp:true},
   steps:[{from:'2021-06-01',upto:'2022-03-31'},
          {upto:'2023-06-30',add:s=>{ const d=s.settings.simLast; s.hist.push({date:d,kind:'출금',amt:500,qty:0,ts:1});   // 마지막 재생일과 같은 날
                                        s.hist.push({date:'2022-04-06',kind:'출금',amt:300,qty:0,ts:2}); }}],             // 아직 재생 안 한 날(기록 순서가 날짜 순서와 어긋난다)
   need:h=>h.some(x=>x.kind==='배당')&&h.filter(x=>x.kind==='출금').length===2},
];
let nCalls=0;
for(const sc of SC){
  const a=retry(()=>replay(true,sc)), b=retry(()=>replay(false,sc));
  assert.equal(a.err,null,sc.name+' — 재생 오류 '+(a.err&&a.err.stack));
  assert.equal(a.calls.length,b.calls.length,sc.name+' — computeInf 호출 수');
  const bad=a.calls.findIndex((x,i)=>x!==b.calls[i]);
  assert.equal(bad,-1,sc.name+' — '+bad+'번째 computeInf 장부가 다르다\n 기억 켬 '+a.calls[bad]+'\n 기억 끔 '+b.calls[bad]);
  assert.deepEqual(a.hist,b.hist,sc.name+' — 남긴 기록');
  assert(a.hist.length>50,sc.name+' — 재생이 실제로 기록을 남겼다 ('+a.hist.length+'줄)');
  if(sc.need) assert(sc.need(a.hist,a.calls),sc.name+' — 시험하려던 경로를 지나지 않았다');
  assert(a.steps*5<b.steps,sc.name+` — 기억을 쓰면 장부 줄 계산이 크게 준다 (켬 ${a.steps} · 끔 ${b.steps})`);
  nCalls+=a.calls.length;
  console.log(`  ✓ ${sc.name}: computeInf ${a.calls.length}회 장부 일치 · 기록 ${a.hist.length}줄 일치 · 줄 계산 ${b.steps}→${a.steps} · ${b.ms.toFixed(0)}→${a.ms.toFixed(0)}ms`);
}
/* 실패한 재생도 기억을 남기지 않는다 — 다음 화면 계산이 끊긴 재생의 장부를 이어 쓰면 안 된다 */
{ const r=retry(()=>replay(true,{name:'저장 실패',saveThrows:true,steps:[{from:'2021-01-04',upto:'2021-06-30'}]}));
  assert(r.err&&/저장 실패/.test(r.err.message),'저장 실패가 그대로 올라온다');
  const m=retry(()=>replay(true,{name:'재생 중 실패',throwAt:60,steps:[{from:'2021-01-04',upto:'2021-06-30'}]}));
  assert(m.err&&/재생 중 실패/.test(m.err.message),'재생 중 실패가 그대로 올라온다');
  console.log('  ✓ 저장이 실패하거나 재생 한가운데서 멈춰도 이어 계산 기억은 지워진다'); }
/* 전 구간(6년) 익절 자동 — 기억 켬만 돌려 줄 계산 횟수가 기록 줄 수에 비례하는지 본다(끄면 줄 수의 제곱) */
{ const r=retry(()=>replay(true,{name:'전 구간 익절 자동',set:{autoTp:true},steps:[{from:SOXL[1].date,upto:SOXL[SOXL.length-1].date}]}));
  assert.equal(r.err,null);
  const per=r.steps/r.hist.length;
  assert(per<10,`전 구간 — 기록 한 줄당 장부 계산 ${per.toFixed(2)}회 (10회 미만이어야 — 끄면 수백~수천 회)`);
  console.log(`  ✓ 전 구간 ${SOXL[1].date}~ 익절 자동: 기록 ${r.hist.length}줄 · 줄당 장부 계산 ${per.toFixed(2)}회 · ${r.ms.toFixed(0)}ms`); }

/* ════ ② 줄을 하나씩 덧붙이며 — 기억한 계산 == 처음부터 센 계산 (무작위 · 씨앗 고정) ════ */
function rng(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function ledgerCtx(set){
  return context(true, c=>{
    c.S={activeTab:'inf',inf:{active:'p',sessions:[{id:'p',paper:true,settings:{...BASE,...set},hist:[]}]}};
    c.lastQuote={inf:quote('2099-12-31')}; c.save=()=>{};
  });
}
function both(ctx){   // 처음부터 센 값(기억 끔) · 기억으로 센 값
  vm.runInContext('__R=_infResume; _infResume=null;',ctx); const ref=vm.runInContext('computeInf()',ctx);
  vm.runInContext('_infResume=__R;',ctx); const s0=ctx.__steps; const got=vm.runInContext('computeInf()',ctx);
  return {ref:ledger(ref,true), got:ledger(got,true), steps:ctx.__steps-s0, ref0:ref};
}
const VAR=[['기본',{}],['단리',{compound:false}],['리버스 20분할',{reverse:true}],['리버스 40분할',{reverse:true,div:40}],['익절 자동',{autoTp:true}]];
let nProp=0;
for(const [vn,set] of VAR) for(const seed of [7,20261021]) nProp+=retry(()=>{ let nP=0;
  const ctx=ledgerCtx(set), R=rng(seed), H=ctx.S.inf.sessions[0].hist;
  vm.runInContext('var __R=null; _infResume={};',ctx);
  let di=200+Math.floor(R()*40), last=null, hits=0;
  for(let n=0;n<320;n++){
    const r=both(ctx); assert.equal(r.got,r.ref,`${vn} 씨앗 ${seed} — ${n}줄째 기억한 계산이 다르다`); nP++;
    if(r.steps<H.length) hits++;
    last=r.ref0;
    if(R()>0.45) di+=1+Math.floor(R()*3);   // 45% 는 같은 날 줄을 더 붙인다
    const d=SOXL[Math.min(di,SOXL.length-1)].date, px=+(SOXL[Math.min(di,SOXL.length-1)].close*(0.97+R()*0.06)).toFixed(4), q=last.qty, u=R();
    let row;
    if(u<0.07) row={kind:'출금',amt:+(50+R()*300).toFixed(2),qty:0};
    else if(u<0.12) row={kind:'배당',amt:+(1+R()*20).toFixed(2),qty:0};
    else if(u<0.16&&set.reverse) row={kind:'리버스복귀',price:px,qty:0};
    else if(q>0&&u<0.30) row={kind:'지정가매도',price:px,qty:q};                         // 전량 — 같은 날 매수가 뒤에 붙으면 사이클이 안 끝난다
    else if(q>=4&&u<0.40) row={kind:'쿼터매도',price:px,qty:Math.floor(q/4)};
    else if(q>0&&u<0.46&&set.reverse) row={kind:'리버스매도',price:px,qty:Math.max(1,Math.floor(q/10))};
    else if(u<0.52&&set.reverse) row={kind:'리버스매수',price:px,qty:1+Math.floor(R()*5)};
    else if(q>0&&u<0.58) row={kind:'지정가매도+1회매수',sellPrice:px,sellQty:q,buyPrice:+(px*0.99).toFixed(4),buyQty:1+Math.floor(R()*8),price:px,qty:0};
    else if(u<0.75) row={kind:'절반매수',price:px,qty:1+Math.floor(R()*10)};
    else row={kind:'1회매수',price:px,qty:1+Math.floor(R()*20)};
    H.push({date:d,...row,ts:n+1});
  }
  assert(hits>200,`${vn} 씨앗 ${seed} — 기억이 실제로 쓰였다 (${hits}/320)`);
  return nP; });
console.log(`  ✓ 줄을 하나씩 덧붙이는 무작위 기록 ${VAR.length}가지 설정 × 씨앗 2개: ${nProp}회 전부 처음부터 센 장부와 같다`);

/* ════ ③ 기억을 쓰면 안 되는 자리 — 처음부터 다시 센다 ════ */
retry(()=>{ const ctx=ledgerCtx({}), sess=ctx.S.inf.sessions[0];
  const day=(d,rows)=>rows.map((x,i)=>({date:d,...x,ts:Date.parse(d)+i}));
  sess.hist.push(...day('2022-03-01',[{kind:'1회매수',price:30,qty:10}]), ...day('2022-03-02',[{kind:'1회매수',price:29,qty:10}]),
                 ...day('2022-03-03',[{kind:'지정가매도',price:36,qty:20},{kind:'출금',amt:10,qty:0}]));   // 그날 전량 익절 + 출금
  vm.runInContext('var __R=null; _infResume={};',ctx);
  let r=both(ctx); assert.equal(r.got,r.ref);
  /* 같은 날 뒤에 매수가 붙었다 — 03-03 은 아직 안 끝난 날이라 그 자리부터 다시 세야 사이클이 이어진다(제14차 D15) */
  sess.hist.push(...day('2022-03-03',[{kind:'1회매수',price:28,qty:5}]).map(x=>({...x,ts:x.ts+5})));
  r=both(ctx); assert.equal(r.got,r.ref,'안 끝난 날에 매수가 더 붙음'); assert.equal(JSON.parse(r.got)[8],1,'같은 날 매수가 이어 가서 사이클은 그대로 1번');
  const n0=sess.hist.length;
  sess.hist.push(...day('2022-03-04',[{kind:'1회매수',price:27,qty:5}])); r=both(ctx); assert.equal(r.got,r.ref);
  assert(r.steps<n0,'끝난 날 뒤에 붙인 줄만 센다 ('+r.steps+'줄)');
  /* 재생일(simLast)만 바뀌면 그대로 쓴다 · 그 밖의 설정이 바뀌면 처음부터 */
  sess.settings.simLast='2022-03-04'; sess.hist.push(...day('2022-03-07',[{kind:'1회매수',price:26,qty:5}])); r=both(ctx);
  assert.equal(r.got,r.ref); assert(r.steps<sess.hist.length,'simLast 만 바뀜 — 기억을 쓴다');
  sess.settings.target=15; sess.hist.push(...day('2022-03-08',[{kind:'1회매수',price:25,qty:5}])); r=both(ctx);
  assert.equal(r.got,r.ref,'익절% 변경'); assert.equal(r.steps,sess.hist.length,'설정이 바뀌면 처음부터');
  /* 기억한 자리의 줄을 갈아 끼우면 처음부터 */
  sess.hist[0]={...sess.hist[0],price:31}; sess.hist.push(...day('2022-03-09',[{kind:'1회매수',price:24,qty:5}])); r=both(ctx);
  assert.equal(r.got,r.ref,'첫 줄 교체'); assert.equal(r.steps,sess.hist.length,'첫 줄이 바뀌면 처음부터');
  const k=vm.runInContext('_infResume.k',ctx); sess.hist[k-1]={...sess.hist[k-1],qty:6}; sess.hist.push(...day('2022-03-10',[{kind:'1회매수',price:23,qty:5}])); r=both(ctx);
  assert.equal(r.got,r.ref,'기억한 끝줄 교체'); assert.equal(r.steps,sess.hist.length,'기억한 끝줄이 바뀌면 처음부터');
  /* 배열을 새로 만들면(정렬·복원·불러오기) 처음부터 */
  sess.hist=sess.hist.slice(); r=both(ctx); assert.equal(r.got,r.ref); assert.equal(r.steps,sess.hist.length,'다른 배열이면 처음부터');
  /* 재생 밖(기억 꺼짐)에선 늘 처음부터 */
  vm.runInContext('_infResume=null;',ctx); const s0=ctx.__steps; vm.runInContext('computeInf()',ctx); assert.equal(ctx.__steps-s0,sess.hist.length,'재생 밖에선 기억을 안 쓴다');
  console.log('  ✓ 안 끝난 날 · 설정 변경 · 첫 줄/기억한 끝줄 교체 · 새 배열 · 재생 밖 — 처음부터 다시 센다 (simLast 만 바뀌면 이어 센다)'); });

console.log(`PASS 모의 재생 이어 계산 — 재생 ${SC.length}종(computeInf ${nCalls}회) · 무작위 ${nProp}회 · 경계 시험 전부 처음부터 센 장부와 같다`);
