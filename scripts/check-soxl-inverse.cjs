#!/usr/bin/env node
'use strict';
/* 연구(클로드) ⚡ SOXL 탭 '인버스 거래대금 비율' 전향 시험 — 규칙 · 누적 · 화면 · 자료 API · 매일 실행 값 시험 + 변이 시험
 *  A 규칙(순수 계산)  B 수집·누적(가짜 원천으로 main 을 날짜를 바꿔 가며 돌린다)  C 화면  D 자료 API  E 연결(페이지 · workflow)  F 변이 */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'..');
const ENG=fs.readFileSync(path.join(ROOT,'scripts/soxl_inverse/forward.cjs'),'utf8');
const UI=fs.readFileSync(path.join(ROOT,'claude-soxl-inverse.js'),'utf8');
const PAGE=fs.readFileSync(path.join(ROOT,'claude.html'),'utf8');
const WF=fs.readFileSync(path.join(ROOT,'.github/workflows/soxl-inverse-forward.yml'),'utf8');
const MODEL=JSON.parse(fs.readFileSync(path.join(ROOT,'data/soxl-inverse/forward-model-1.0.0.json'),'utf8'));
const SEED=JSON.parse(fs.readFileSync(path.join(ROOT,'data/soxl-inverse/history-seed.json'),'utf8'));
function engine(src){const m={exports:{}};new Function('require','module','exports','__dirname',src.replace(/^#!.*\n/,'')+'\n;module.exports.__main=require.main===module;')(
  Object.assign(id=>require(id),{main:null}),m,m.exports,path.join(ROOT,'scripts/soxl_inverse'));return m.exports;}
function ui(src){const m={exports:{}};vm.runInNewContext(src,{module:m,Date,Math,JSON,isFinite,isNaN,String,Number});return m.exports;}
const near=(a,b,e,msg)=>assert.ok(Math.abs(a-b)<=(e||1e-9),(msg||'')+' '+a+' ≠ '+b);
const day=i=>new Date(Date.UTC(2030,0,1)+i*864e5).toISOString().slice(0,10);
/* n 일 · sig 에 든 날의 비율은 sigRatio(기본 0.8), 나머지 0.1 · 하루 수익은 rets[i](기본 0) */
const mk=(n,sig,rets,sigRatio)=>Array.from({length:n},(_,i)=>({date:day(i),a:sig.includes(i)?(sigRatio==null?80:sigRatio*100):10,b:100,src:'em',ret:(rets&&rets[i])||0,px:100+i}));
const P={threshold:.7,hold:3,fee:0};

/* ── A 규칙 ── */
function testEngine(F){
  // A1 씨앗 과거 재생 = 연구 값(research/daily RESEARCH_LOG 11번): 연 53.5% · 낙폭 80.4% · 매매 7번
  const rows=SEED.rows.map(F.unpack),s=F.summary(rows,MODEL.params,rows[0].date);
  assert.equal(rows.length,4184);assert.equal(rows[0].date,'2010-03-12');assert.equal(rows[rows.length-1].date,MODEL.seedThrough);
  assert.equal(s.cagr,53.5);assert.equal(s.mdd,80.4);assert.equal(s.bhCagr,30);assert.equal(s.bhMdd,90.5);assert.equal(s.heldPct,54);assert.equal(s.open,null);
  assert.deepEqual(s.trades,[{in:'2013-08-21',out:'2015-04-08',ret:210.7},{in:'2015-08-20',out:'2017-10-27',ret:627.7},{in:'2018-10-10',out:'2020-07-08',ret:78.1},
    {in:'2022-07-25',out:'2024-03-12',ret:190.3},{in:'2024-09-10',out:'2025-03-05',ret:-22.3},{in:'2025-04-07',out:'2026-01-26',ret:565},{in:'2026-03-09',out:'2026-08-31',ret:111.3}]);
  // A2 기준은 '이상' — 딱 70% 는 신호 · 69.99% 는 아님
  assert.deepEqual(F.simulate(mk(8,[3],null,.7),P).events.map(e=>e.type+':'+e.date),['signal:'+day(3),'buy:'+day(4),'sell:'+day(7)]);
  assert.equal(F.simulate(mk(8,[3],null,.6999),P).events.length,0);
  assert.equal(F.ratioOf({a:70,b:100}),.7);assert.equal(F.ratioOf({a:1,b:0}),null);
  // A3 신호 다음 거래일 종가에 산다 — 산 날의 수익은 못 먹고(룩어헤드 없음) 그다음 날부터 hold 일치를 먹는다
  const r3=[0,0,0,.5,.1,.02,.03,.04,.2,.2];let S=F.simulate(mk(10,[3],r3),P);
  near(S.eq,1.02*1.03*1.04,1e-12,'A3 보유 수익');near(S.bh,1.5*1.1*1.02*1.03*1.04*1.2*1.2,1e-9,'A3 그냥 보유');
  assert.deepEqual(S.trades.map(t=>[t.in,t.out,t.inPx,t.outPx]),[[day(4),day(7),104,107]]);near(S.trades[0].ret,1.02*1.03*1.04-1,1e-12);
  assert.deepEqual(S.curve.map(c=>c.pos),[0,0,0,0,1,1,1,0,0,0]);
  // A4 마지막 신호부터 다시 센다 — 3·5 일 신호 · 3일 보유 → 6+3=9 일째 종가 매도
  S=F.simulate(mk(12,[3,5]),P);assert.deepEqual(S.events.filter(e=>e.type!=='signal').map(e=>e.type+':'+e.date),['buy:'+day(4),'sell:'+day(9)]);
  assert.equal(S.events.find(e=>e.type==='sell').lastSignalDate,day(5));assert.equal(S.events.find(e=>e.type==='buy').signalDate,day(3));
  // A5 수수료는 살 때 · 팔 때 한 번씩
  S=F.simulate(mk(10,[3],r3),{threshold:.7,hold:3,fee:.001});near(S.eq,.999*1.02*1.03*1.04*.999,1e-12,'A5 수수료');
  // A6 등록(from) 전 신호는 전향 장부에 없다 · start 날 종가를 1 로 둔다
  S=F.simulate(mk(12,[1,6],[0,0,0,.3,0,0,0,0,.1,.1,.1,0]),P,{from:day(5),start:day(4)});
  assert.deepEqual(S.events.map(e=>e.type+':'+e.date),['signal:'+day(6),'buy:'+day(7),'sell:'+day(10)]);
  assert.equal(S.curve[0].date,day(4));assert.equal(S.curve[0].eq,1);near(S.eq,1.1**3,1e-12);near(S.bh,1.1**3,1e-12);
  assert.equal(F.simulate(mk(12,[1],null),P,{from:day(5),start:day(4)}).events.length,0,'등록 전 신호만 있으면 사건 없음');
  S=F.simulate(mk(12,[5],[0,0,0,0,0,0,0,.1,.1,.1,0,0]),P,{from:day(6),start:day(4)});   // 곡선 시작(start)과 등록(from) 사이의 신호 — 곡선엔 보여도 사지 않는다
  assert.equal(S.events.length,0);assert.equal(S.eq,1);assert.deepEqual([S.state.pos,S.state.next,S.state.lastSignal],['cash','cash',null]);
  // A7 지금 상태 — 신호 날: 다음 날 매수 · hold+1 뒤 매도 / 보유 중 / 매도 전날 / 매도 뒤
  const st=n=>F.simulate(mk(n,[3]),P).state;
  assert.deepEqual([st(3).pos,st(3).next,st(3).sellIn,st(3).lastSignal],['cash','cash',null,null]);
  assert.deepEqual([st(4).pos,st(4).next,st(4).sellIn,st(4).lastSignal],['cash','hold',4,day(3)]);
  assert.deepEqual([st(5).pos,st(5).next,st(5).sellIn,st(5).boughtDate,st(5).boughtPx],['hold','hold',3,day(4),104]);
  assert.deepEqual([st(7).pos,st(7).next,st(7).sellIn],['hold','cash',1]);
  assert.deepEqual([st(8).pos,st(8).next,st(8).sellIn,st(8).boughtDate],['cash','cash',null,null]);
  // A8 덧붙이기 — 이미 적은 날짜는 값이 달라도 그대로 · 빈 줄은 버림 · 날짜순
  const have=[{date:day(1),a:1,b:2,src:'em',ret:0,px:1}],ap=F.appendRows(have,[{date:day(3),a:5,b:6,ret:0},{date:day(1),a:9,b:9,ret:0},{date:day(2),a:3,b:4,ret:0},{date:day(4),a:0,b:4,ret:0},{date:day(5),a:1,b:4,ret:null}]);
  assert.deepEqual(ap.rows.map(r=>[r.date,r.a]),[[day(1),1],[day(2),3],[day(3),5]]);assert.equal(ap.added.length,2);
  // A9 원자료 → 줄: 거래대금 원자료 → 같은 곳 종가×거래량 → Yahoo 종가×거래량 · 수익은 수정 종가(분할에 안 흔들림) · 마감 안 된 날 제외
  const yL=[{date:day(0),c:100,v:10,ac:10},{date:day(1),c:110,v:10,ac:11},{date:day(2),c:11,v:100,ac:11.55},{date:day(3),c:12,v:100,ac:12},{date:day(4),c:13,v:1,ac:13}];
  const yS=[1,2,3,4].map(i=>({date:day(i),c:5,v:40,ac:5}));
  const em={SOXS:new Map([[day(1),{c:5,v:40,a:210}],[day(2),{c:5,v:44,a:0}]]),SOXL:new Map([[day(1),{c:110,v:10,a:1000}],[day(2),{c:11,v:100,a:0}]])};
  const br=F.buildRows(em,{SOXS:yS,SOXL:yL},day(3));
  assert.deepEqual(br.map(r=>[r.date,r.src,r.a,r.b]),[[day(1),'em',210,1000],[day(2),'em-cv',220,1100],[day(3),'yh',200,1200]]);
  near(br[1].ret,.05,1e-12,'A9 분할 날 수익(수정 종가)');assert.equal(br[1].px,11);
  assert.equal(F.buildRows({SOXS:null,SOXL:null},{SOXS:yS,SOXL:yL},day(9)).length,4,'원자료가 없어도 Yahoo 로 잇는다');
  // A10 미국 정규장이 끝난 날짜까지만 — 겨울 16:20 ET = 21:20Z · 여름 = 20:20Z
  assert.equal(F.settledThrough(Date.parse('2026-11-10T21:19:00Z')),'2026-11-09');assert.equal(F.settledThrough(Date.parse('2026-11-10T21:20:00Z')),'2026-11-10');
  assert.equal(F.settledThrough(Date.parse('2026-07-01T20:19:00Z')),'2026-06-30');assert.equal(F.settledThrough(Date.parse('2026-07-01T20:20:00Z')),'2026-07-01');
  assert.equal(F.settledThrough(Date.parse('2026-11-11T02:40:00Z')),'2026-11-10','한국 오전 보완 실행 = 미국 전날 저녁');
  // A11 빠진 날이 있으면 멈춘다
  assert.equal(F.continuity(day(0),[{date:day(1)},{date:day(2)}],yL),'');
  assert.ok(F.continuity(day(0),[{date:day(2)}],yL).includes(day(2)));assert.ok(F.continuity(day(0),[{date:day(1)},{date:day(3)}],yL).includes(day(3)));
  // A12 화면 묶음 — 과거 재생은 씨앗까지만(뒤에 줄이 붙어도 숫자가 안 바뀐다) · 전향은 등록 뒤만
  const tail=[{date:'2026-11-10',a:9e9,b:1e10,src:'em',ret:.02,px:210},{date:'2026-11-11',a:1e9,b:1e10,src:'yh',ret:.05,px:220.5},{date:'2026-11-12',a:1e9,b:1e10,src:'em',ret:-.1,px:198.45}];
  const v0=F.buildView(rows,MODEL,Date.parse('2026-11-10T08:00:00Z')),v1=F.buildView(rows.concat(tail),MODEL,Date.parse('2026-11-13T00:00:00Z'));
  assert.deepEqual(v1.backtest,v0.backtest);assert.deepEqual(v1.counts,v0.counts);assert.deepEqual(v0.counts,{days:4184,ge50:801,ge70:301,gt100:55});
  assert.equal(v0.backtest.cagr,53.5);assert.ok(v0.backtest.note.includes('전향 성과가 아니다'));
  assert.equal(v0.forward.days,0);assert.equal(v0.forward.events.length,0);assert.deepEqual([v0.state.pos,v0.state.next],['cash','cash']);
  assert.equal(v0.lastPastSignal.date,'2026-03-09');near(v0.lastPastSignal.ratio,1.0348,5e-5);assert.equal(v0.today.date,'2026-11-09');near(v0.today.ratio,.4585,5e-4);near(v0.today.gap,.7-v0.today.ratio,1e-12);assert.equal(v0.recent.length,60);
  assert.deepEqual(v1.forward.events.map(e=>e.type+':'+e.date),['signal:2026-11-10','buy:2026-11-11']);
  assert.equal(v1.forward.days,3);assert.equal(v1.forward.ret,+((.999*.9-1)*100).toFixed(2));assert.equal(v1.forward.bhRet,+((1.02*1.05*.9-1)*100).toFixed(2));
  assert.equal(v1.forward.mdd,10.09);assert.equal(v1.forward.bhMdd,10);
  assert.deepEqual([v1.state.pos,v1.state.next,v1.state.sellIn,v1.state.boughtPx],['hold','hold',MODEL.params.hold-1,220.5]);
  assert.deepEqual([v1.strategyVersion,v1.registeredDate,v1.seedThrough,v1.asOf,v1.schemaVersion],['1.0.0','2026-11-10','2026-11-09','2026-11-12',1]);
  assert.deepEqual(MODEL.params,{threshold:.7,hold:120,fee:.001});
}

/* ── B 수집·누적 ── 가짜 원천: Yahoo 일봉 + Eastmoney 일봉. 날짜를 하루씩 넘기며 main 을 돌린다 */
const ts=d=>Date.parse(d+'T14:30:00Z')/1000;
function yahoo(bars){return {chart:{result:[{meta:{gmtoffset:-18000},timestamp:bars.map(b=>ts(b[0])),indicators:{quote:[{close:bars.map(b=>b[1]),volume:bars.map(b=>b[2])}],adjclose:[{adjclose:bars.map(b=>b[1])}]}}]}};}
function eastmoney(rows){return {data:{klines:rows.map(r=>[r[0],0,r[1],0,0,r[2],r[3]].join(','))}};}
const PAD=[['2026-11-02',190,5e7],['2026-11-03',192,5e7],['2026-11-04',195,5e7],['2026-11-05',197,5e7],['2026-11-06',200,5e7],['2026-11-09',205,5e7]];
function source(o){return async url=>{const u=String(url),sym=/SOXS/.test(u)?'SOXS':'SOXL';
  if(u.includes('yahoo'))return {ok:true,json:async()=>yahoo(PAD.concat(o.days.map(d=>[d.date,sym==='SOXL'?d.px:8,sym==='SOXL'?d.vol==null?5e7:d.vol:1e8])))};
  if(o.noEm)return {ok:true,json:async()=>({data:{klines:[]}})};
  return {ok:true,json:async()=>eastmoney(PAD.map(p=>[p[0],p[1],5e7,sym==='SOXL'?1e10:4e9]).concat(o.days.filter(d=>d.em!==false).map(d=>[d.date,d.px,5e7,sym==='SOXL'?1e10:d.inv])))};};}
async function testCollect(F){
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'siv-')),keep=globalThis.fetch,log=console.log;console.log=()=>{};
  const run=(now,o,dir)=>{globalThis.fetch=source(o);return F.main(['--app',ROOT,'--out',dir||out,'--now',now]);};
  const rd=f=>fs.readFileSync(path.join(out,f),'utf8');
  try{
    const d10={date:'2026-11-10',px:210,inv:8e9},d11={date:'2026-11-11',px:231,inv:3e9};
    // B1 장중(마감 전)에 돌면 그날 봉은 쓰지 않는다
    let r=await run('2026-11-10T20:00:00Z',{days:[d10]});assert.equal(r.added.length,0);assert.equal(r.view.asOf,'2026-11-09');assert.equal(JSON.parse(rd('history.json')).rows.length,0);assert.ok(!fs.existsSync(path.join(out,'events.jsonl')));
    // B2 마감 뒤 — 한 줄 덧붙임 · 80% 신호 기록(판·파라미터·근거 같이) · 다음 거래일 매수 예정
    r=await run('2026-11-10T23:10:00Z',{days:[d10]});
    assert.deepEqual(JSON.parse(rd('history.json')).rows,[['2026-11-10',8e9,1e10,'em',+(210/205-1).toFixed(6),210]]);
    let ev=rd('events.jsonl').trim().split('\n').map(l=>JSON.parse(l));assert.equal(ev.length,1);
    assert.deepEqual([ev[0].type,ev[0].date,ev[0].ratio,ev[0].inverseAmount,ev[0].longAmount,ev[0].src,ev[0].strategyVersion,ev[0].recordedAt],['signal','2026-11-10',.8,8e9,1e10,'em','1.0.0','2026-11-10T23:10:00.000Z']);
    assert.deepEqual(ev[0].params,MODEL.params);assert.deepEqual([r.view.state.pos,r.view.state.next,r.view.state.sellIn],['cash','hold',121]);
    // B3 같은 자료로 보완 실행 — 아무 파일도 안 바뀐다(기록 시각만 바뀐 저장 없음)
    const snap=['history.json','events.jsonl','latest.json'].map(rd);
    r=await run('2026-11-11T02:40:00Z',{days:[d10]});assert.equal(r.added.length,0);assert.equal(r.events.length,0);assert.deepEqual(['history.json','events.jsonl','latest.json'].map(rd),snap);
    // B4 다음 날 — 원천이 어제 값을 바꿔 보내도 어제 줄은 그대로 · 매수 기록이 뒤에 붙는다 · 원자료가 빠진 날은 Yahoo 로
    r=await run('2026-11-11T23:10:00Z',{days:[Object.assign({},d10,{inv:1e9}),Object.assign({},d11,{em:false})]});
    const h=JSON.parse(rd('history.json')).rows;assert.equal(h.length,2);assert.deepEqual(h[0],[ '2026-11-10',8e9,1e10,'em',+(210/205-1).toFixed(6),210]);
    assert.deepEqual(h[1],['2026-11-11',8*1e8,231*5e7,'yh',.1,231]);
    assert.ok(rd('events.jsonl').startsWith(snap[1]),'먼저 적은 기록은 한 글자도 안 바뀐다');
    ev=rd('events.jsonl').trim().split('\n').map(l=>JSON.parse(l));assert.deepEqual(ev.map(e=>e.type+':'+e.date),['signal:2026-11-10','buy:2026-11-11']);
    assert.deepEqual([ev[1].price,ev[1].signalDate,ev[1].ratio,ev[1].strategyVersion],[231,'2026-11-10',.8,'1.0.0']);
    const L=JSON.parse(rd('latest.json'));assert.deepEqual([L.asOf,L.today.src,L.forward.days,L.state.pos,L.state.sellIn,L.forward.ret,L.forward.bhRet],['2026-11-11','yh',2,'hold',120,-.1,+((231/205-1)*100).toFixed(2)]);
    // B5 거래대금을 어디서도 못 구한 날이 끼면 멈춘다(그날 수익이 장부에서 사라지지 않게) — 파일은 그대로
    const out2=fs.mkdtempSync(path.join(os.tmpdir(),'siv-'));
    await assert.rejects(run('2026-11-11T23:10:00Z',{noEm:true,days:[Object.assign({},d10,{vol:0}),d11]},out2),/이어지지 않습니다: 새 줄 2026-11-11/);
    assert.ok(!fs.existsSync(path.join(out2,'latest.json')));fs.rmSync(out2,{recursive:true,force:true});
    return L;
  }finally{globalThis.fetch=keep;console.log=log;fs.rmSync(out,{recursive:true,force:true});}
}

/* ── C 화면 ── */
function testView(U,F){
  const rows=SEED.rows.map(F.unpack),now=Date.parse('2026-11-10T23:10:00Z');
  const tail=[{date:'2026-11-10',a:9e9,b:1e10,src:'em',ret:.02,px:210},{date:'2026-11-11',a:1e9,b:1e10,src:'yh',ret:.05,px:220.5},{date:'2026-11-12',a:1e9,b:1e10,src:'em',ret:-.1,px:198.45}];
  const J0=Object.assign({ok:true},F.buildView(rows,MODEL,now)),J1=Object.assign({ok:true},F.buildView(rows.concat(tail),MODEL,now));
  const sig=Object.assign({ok:true},F.buildView(rows.concat(tail.slice(0,1)),MODEL,now));
  for(const J of [null,{ok:false,error:'<img src=x onerror=1>'},{ok:true,schemaVersion:1,status:'waiting_first_run'},J0,J1,sig]){const h=U.view(J)+U.strip(J);assert.ok(!/NaN|undefined|Infinity/.test(h),'NaN·undefined 없음');assert.ok(h.includes("id='siv'"));assert.ok(!h.includes('<img src=x'));}
  assert.ok(U.view(null).includes('불러오는 중'));assert.ok(U.view({ok:false,error:'<img src=x onerror=1>'}).includes('&lt;img src=x onerror=1&gt;'));
  assert.ok(U.view({ok:true,schemaVersion:1,status:'waiting_first_run'}).includes('아직 첫 실행 전'));assert.equal(U.strip(null),'');assert.equal(U.strip({ok:false,error:'x'}),'');
  // 오늘 비율 · 기준까지 남은 거리 · 현금 대기
  let h=U.view(J0);
  assert.ok(h.includes("<div class='l'>11/09 비율</div><div class='v '>45.8%</div>"),'오늘 비율');assert.ok(h.includes('기준 70%까지 24.2%p'));assert.ok(h.includes('SOXS $63.4억 ÷ SOXL $138.3억'));
  assert.ok(h.includes("<div class='v '>현금 대기</div>")&&h.includes('비율이 70% 이상인 날이 나오면 다음 거래일 종가에 삽니다'));
  assert.ok(h.includes('별도 실험 · 주문 없음')&&h.includes('<b>상관없는 별도 실험</b>'),'④ 전략과 섞이지 않게');
  assert.ok(h.includes('등록(11/10) 뒤로 아직 신호가 없습니다')&&h.includes('등록 전 마지막 신호는 26/03/09 (103.5%)'));
  assert.ok(h.includes("<div class='v '>—</div><div class='sub'>등록 11/10 — 다음 거래일부터 쌓입니다"),'전향 성과는 쌓이기 전엔 빈칸');
  assert.equal((h.match(/<polyline/g)||[]).length,1,'비율 한 줄만(전향 곡선은 이틀부터)');assert.ok(h.includes('기준 70%</text>')&&h.includes("stroke-dasharray='5 4'"));
  assert.equal((h.match(/<rect /g)||[]).length,60,'날짜마다 손잡이');assert.ok(h.includes('<title>2026-11-09 · 45.8%</title>'));
  // 과거 재생은 이름을 달리 붙여 접어 둔다
  assert.ok(h.includes('📜 과거 시험 (등록 전 재생 · 전향 성과 아님) — 10/03/12 ~ 26/11/09'));assert.ok(h.includes('연 +53.5%')&&h.includes('최대 낙폭 -80.4%')&&h.includes('연 +30.0%')&&h.includes('최대 낙폭 -90.5%')&&h.includes("<div class='v'>7번</div>"));
  assert.ok(h.includes('<td>25/04/07</td><td>26/01/26</td><td class=\'win\'><b>+565.0%</b></td>')&&h.includes("<td class='loss'><b>-22.3%</b></td>"));
  assert.ok(h.includes('70% 이상 301일')&&h.includes('약한 후보')&&h.includes('TQQQ·TECL')&&h.includes('수수료 0.1%')&&h.includes('기록 v1.0.0'));
  assert.ok(h.indexOf('🧾 기록')<h.indexOf('📜 과거 시험'),'등록 뒤 기록이 먼저');
  let s=U.strip(J0);assert.ok(s.includes('11/09 <b>45.8%</b>')&&s.includes('기준 70%까지 24.2%p')&&s.includes('현금 대기')&&s.includes("getElementById('siv')"));
  // 신호 날
  h=U.view(sig);assert.ok(h.includes('🟢 매수 신호')&&h.includes('11/10 비율 90.0% — 다음 거래일 종가에 SOXL 매수(모의) · 그 뒤 120거래일 보유'));assert.ok(h.includes('기준 70% 이상 — 신호'));
  assert.ok(h.includes('<b>11/10</b> 📣 신호 · 비율 90.0% (SOXS $90.0억 ÷ SOXL $100.0억)'));assert.ok(U.strip(sig).includes('기준 70% 넘음')&&U.strip(sig).includes('🟢 매수 신호'));
  assert.ok(h.includes('<title>2026-11-10 · 90.0% · 신호</title>')&&(h.match(/r='4.5'/g)||[]).length>=1,'기준 넘은 날은 따로 표시');
  // 보유 중 — 전향 성과 · 곡선 두 줄 · 대체 자료 표시
  h=U.view(J1);assert.ok(h.includes('보유 중')&&h.includes('매수 11/11 $220.50')&&h.includes("<b class='loss'>-10.0%</b>")&&h.includes('119거래일 뒤 종가에 매도'));
  assert.ok(h.includes("<div class='v loss'>-10.1%</div><div class='sub'>3거래일 · SOXL 그냥 보유 -3.6% · 최대 낙폭 -10.1% (보유 -10.0%)"));
  assert.equal((h.match(/<polyline/g)||[]).length,3,'비율 + 실험 + 그냥 보유');assert.ok(h.includes('이 실험(모의)')&&h.includes('SOXL 그냥 보유 -3.6%'));
  assert.ok(h.includes('<b>11/11</b> 🟢 매수(모의) · SOXL $220.50 · 근거 11/10 비율 90.0%'));assert.ok(h.includes('<title>2026-11-11 · 10.0% · 종가×거래량(대체 · Yahoo)</title>'));
  assert.ok(h.indexOf('<b>11/11</b> 🟢')<h.indexOf('<b>11/10</b> 📣'),'새 기록이 위');
  // 매도 예정 · 매도 기록
  const sold={ok:true,schemaVersion:1,strategyVersion:'1.0.0',params:MODEL.params,registeredDate:'2026-11-10',asOf:'2027-05-06',updatedAt:'2027-05-06T23:10:00Z',today:{date:'2027-05-06',ratio:.31,inverseAmount:3.1e9,longAmount:1e10,src:'em',gap:.39},recent:[],
    state:{pos:'hold',next:'cash',lastSignal:'2026-11-10',sellIn:1,boughtDate:'2026-11-11',boughtPx:220.5,openRet:.42},forward:{days:122,ret:41.9,bhRet:30,mdd:20,bhMdd:25,curve:[],
      events:[{type:'sell',date:'2027-05-07',price:313.1,ret:.4186,boughtDate:'2026-11-11',lastSignalDate:'2026-11-10'}]}};
  h=U.view(sold);assert.ok(h.includes('🔴 매도 예정')&&h.includes('마지막 신호 11/10 뒤 120거래일이 지났습니다 — 다음 거래일 종가에 매도(모의)'));
  assert.ok(h.includes("<b>05/07</b> 🔴 매도(모의) · SOXL $313.10 · <b class='win'>+41.9%</b> (매수 11/11 · 마지막 신호 11/10)"));assert.ok(h.includes('그래프는 자료가 이틀 이상 쌓이면'));
}

/* ── D 자료 API ── */
async function testApi(view){
  const {onRequestGet}=await import(path.join(ROOT,'functions/api/soxl-inverse.js'));const keep=globalThis.fetch;let seen='';
  const call=async res=>{globalThis.fetch=async u=>{seen=String(u);return res;};const r=await onRequestGet();return [r.status,await r.json(),r.headers.get('Cache-Control')];};
  try{
    let [st,j,cc]=await call({status:200,ok:true,json:async()=>view});assert.equal(st,200);assert.equal(j.ok,true);assert.equal(j.asOf,view.asOf);assert.equal(cc,'no-store');
    assert.equal(seen,'https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/soxl-inverse-forward/latest.json');
    [st,j]=await call({status:404,ok:false});assert.equal(st,200);assert.deepEqual(j,{ok:true,schemaVersion:1,status:'waiting_first_run'});
    [st,j]=await call({status:500,ok:false});assert.equal(st,502);assert.equal(j.ok,false);assert.ok(j.error.includes('HTTP 500'));
    for(const bad of [{...view,schemaVersion:2},{...view,today:null},{...view,forward:{events:[]}},{...view,recent:{}}]){[st,j]=await call({status:200,ok:true,json:async()=>bad});assert.equal(st,502,'모양이 다르면 빈 장부로 숨기지 않는다');assert.ok(j.error.includes('schema'));}
  }finally{globalThis.fetch=keep;}
}

/* ── E 연결 ── */
function testWiring(U){
  const v=(PAGE.match(/<script src="\/claude-soxl-inverse\.js\?v=(\d+\.\d+\.\d+)" defer><\/script>/)||[])[1];assert.equal(v,U.VERSION,'스크립트 ?v 와 파일 VERSION');assert.equal(U.API,'/api/soxl-inverse');
  assert.ok(PAGE.includes('fetch("/api/soxl-inverse",{cache:"no-store"'));
  assert.ok(PAGE.includes('var siv=TAB==="soxl"?window.ClaudeSoxlInverse:null;')&&PAGE.includes('html+=(siv?siv.strip(SIV):"")+tabPage(TAB,T,gd,et,wl)+(siv?siv.view(SIV):"");'),'⚡ SOXL 탭에만 · 맨 위 한 줄 + 맨 아래 카드');
  assert.ok(PAGE.includes('if(TAB==="soxl")render();'),'받은 뒤 그 탭이면 다시 그린다');assert.ok(/\.siv-strip\{/.test(PAGE)&&/\.siv-past\{/.test(PAGE));
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(UI),'브라우저 저장 없음');
  // 매일 실행 — 미국장 마감 뒤 · scalping-data 에 덧붙임 · 알림·주문 없음
  assert.ok(WF.includes('cron: "10 23 * * 1-5"')&&WF.includes('cron: "40 2 * * 2-6"')&&WF.includes('workflow_dispatch:'));
  assert.ok(WF.includes('node .app/scripts/soxl_inverse/forward.cjs --app .app --out data/soxl-inverse-forward'));
  assert.ok(WF.includes('ref: scalping-data')&&WF.includes('bash .app/scripts/push-scalping-data.sh')&&WF.includes('git add data/soxl-inverse-forward'));
  assert.ok(WF.includes('group: soxl-inverse-forward')&&WF.includes('cancel-in-progress: false'));
  assert.ok(!/telegram|research-note|MONITOR_KEY|secrets\./i.test(WF),'알림·비밀값 없음(알림은 사용자가 정하면 따로 붙인다)');
  for(const p of ['scripts/soxl_inverse/forward.cjs','data/soxl-inverse/forward-model-1.0.0.json','.github/workflows/soxl-inverse-forward.yml'])assert.ok(WF.includes('- "'+p+'"'),'main 에 올리면 첫 실행: '+p);
  assert.ok(!/order|kis|주문 전송/i.test(ENG.replace(/실주문 없음/g,'')),'주문 경로 없음');
}

/* ── F 변이 ── 옛·틀린 코드로 바꾸면 빨간불이 떠야 한다 */
const MUT_ENG=[
  ['기준 이상 → 초과','if(rk!=null&&rk>=P.threshold&&rows[k].date>=from&&k>=s0){ if(last!==k){last=k;} }','if(rk!=null&&rk>P.threshold&&rows[k].date>=from&&k>=s0){ if(last!==k){last=k;} }'],
  ['신호 당일 종가에 매수(룩어헤드)','const k=i-1,rk=ratioOf(rows[k]);','const k=i,rk=ratioOf(rows[k]);'],
  ['보유 중 새 신호를 무시(첫 신호부터만 셈)','{ if(last!==k){last=k;} }','{ if(last!==k&&!pos){last=k;} }'],
  ['등록 전 신호도 전향 장부에','if(rk!=null&&rk>=P.threshold&&rows[k].date>=from&&k>=s0){ if(last!==k)','if(rk!=null&&rk>=P.threshold&&k>=s0){ if(last!==k)'],
  ['수수료 빠짐','if(want!==pos){ eq*=1-P.fee;','if(want!==pos){ '],
  ['보유 하루 더','const want=(last>=0&&(k-last)<P.hold)?1:0;','const want=(last>=0&&(k-last)<=P.hold)?1:0;'],
  ['이미 적은 날을 다시 적음',"fresh.filter(r=>r.date>lastD&&","fresh.filter(r=>r.date>=lastD&&"],
  ['장중 봉도 씀','if(hm>=16*60+20)return d;','if(hm>=0)return d;'],
  ['수익을 수정 안 한 종가로','ret:z.ac/p.ac-1,px:z.c','ret:z.c/p.c-1,px:z.c'],
  ['거래대금 원자료보다 Yahoo 먼저',"if(ea&&eb&&ea.a>0&&eb.a>0){a=ea.a;b=eb.a;src='em';}","if(s&&s.c>0&&s.v>0&&z.c>0&&z.v>0){a=s.c*s.v;b=z.c*z.v;src='yh';}else if(ea&&eb&&ea.a>0&&eb.a>0){a=ea.a;b=eb.a;src='em';}"],
  ['과거 재생에 등록 뒤 줄이 섞임','const hist=rows.filter(r=>r.date<=M.seedThrough);','const hist=rows;'],
  ['빠진 날이 있어도 계속',"if(gap)throw new Error(gap);",''],
  ['기록에 판·파라미터 없음','{strategyVersion:M.strategyVersion,params:M.params,recordedAt:new Date(now).toISOString()}','{recordedAt:new Date(now).toISOString()}'],
  ['같은 기록을 또 적음',"view.forward.events.filter(e=>!seen.has(e.type+'|'+e.date))",'view.forward.events'],
];
const MUT_UI=[
  ['오류 글자 이스케이프 빠짐','자료를 못 불러왔습니다: "+esc(J.error||"")','자료를 못 불러왔습니다: "+(J.error||"")'],
  ['과거 재생 이름표 빠짐','📜 과거 시험 (등록 전 재생 · 전향 성과 아님) — ','📜 성과 — '],
  ['신호 날에도 현금 대기','if(s.pos!=="hold"&&s.next==="hold")return','if(false)return'],
  ['남은 거리 부호 반대','(t.gap>0?"기준 "+share(T,0)+"까지 "','(t.gap<0?"기준 "+share(T,0)+"까지 "'],
];
async function all(F,U){testEngine(F);const L=await testCollect(F);testView(U,F);await testApi(Object.assign({},L));testWiring(U);}
(async()=>{
  const F=engine(ENG),U=ui(UI);assert.equal(F.__main,false);
  await all(F,U);
  let red=0;const tot=MUT_ENG.length+MUT_UI.length;
  for(const [name,a,b] of MUT_ENG){assert.equal(ENG.split(a).length,2,'변이 대상이 한 곳이어야: '+name);let ok=false;try{await all(engine(ENG.replace(a,b)),U);}catch(e){ok=true;}assert.ok(ok,'변이가 안 잡힘(엔진): '+name);red++;}
  for(const [name,a,b] of MUT_UI){assert.equal(UI.split(a).length,2,'변이 대상이 한 곳이어야: '+name);let ok=false;try{await all(F,ui(UI.replace(a,b)));}catch(e){ok=true;}assert.ok(ok,'변이가 안 잡힘(화면): '+name);red++;}
  console.log('ALL PASS soxl inverse forward · 변이 '+red+'/'+tot+' red');
})().catch(e=>{console.error(e);process.exit(1);});
