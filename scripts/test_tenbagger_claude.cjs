'use strict';
// 텐배거 메뉴 · 🤖 클로드 탭 값 시험 + 변이 시험
//  T1~T4  화면 숫자 형식(tenbagger-claude.js — 같은 파일을 그대로 불러 값으로 본다)
//  T5~T9  텐배거 목록 거르기·정렬·쪽 나누기
//  T10    분석 파일 점검(빠진 칸이면 그리지 않는다)
//  M1~M3  메뉴: '모의' 바로 아래 '텐배거' — 관리자가 순서를 바꿔 저장한 DB 설정에도 지켜진다(jk-access.js)
//  P1~P4  페이지: 승인 가드 · 클로드/지피티 탭 · 버전 · 차트 라이브러리 고정 버전
//  D1~D6  분석 결과 파일(data/tenbagger/claude/analysis.json)의 정합성 — 화면이 다시 계산하지 않으므로 파일이 스스로 맞아야 한다
//  변이   목록 정렬 방향 · 시장 거르기 · 메뉴 기준점(after) 을 틀리게 바꾸면 위 시험이 빨간불이 되는지
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const ROOT=path.join(__dirname,'..');
const SRC=fs.readFileSync(path.join(ROOT,'tenbagger-claude.js'),'utf8');
const ACC=fs.readFileSync(path.join(ROOT,'jk-access.js'),'utf8');
const HTML=fs.readFileSync(path.join(ROOT,'tenbagger.html'),'utf8');
const results=[];let failed=0;
function t(name,fn){ try{ fn(); results.push('PASS '+name); }catch(e){ failed++; results.push('FAIL '+name+' — '+(e&&e.message||e)); } }

function loadUI(src){ const m={exports:{}}; vm.runInNewContext(src,{module:m,globalThis:{},console}); return m.exports; }
function loadAcc(src){
  const html={classList:{add(){},remove(){},toggle(){},contains(){return false;}}};
  const document={documentElement:html,head:{appendChild(){}},body:null,createElement:()=>({setAttribute(){},appendChild(){}}),
    getElementById:()=>null,querySelectorAll:()=>[],currentScript:null,addEventListener(){}};
  const ctx={document,console:{warn(){},error(){},log(){}},setTimeout:()=>0,clearTimeout(){},URL,location:{origin:'https://jkquant.pages.dev',pathname:'/'}};
  ctx.window=ctx; vm.createContext(ctx); vm.runInContext(src,ctx); return ctx.JKAccess;
}

const COLS=['code','name0','name','mkt','t0','t10','tp','peak','d10','dpk','cap0','raw0','dd3','industry','alive'];
const ROWS=[
  ['000001','가','가','코스닥','1998-09-01','1999-06-01','2000-01-03',40,190,330,120,800,-0.9,'',false],
  ['000002','나','나','코스피','2003-03-03','2005-03-02','2007-10-01',140,495,1150,450,3080,-0.8,'조선',true],
  ['000003','다','다2','코스닥','2020-03-19','2021-02-10','2026-05-07',525.8,222,1503,816,8750,-0.7,'전기장비',true],
  ['000004','라','라','코스피','2008-10-27','2010-05-17','2012-11-13',83,391,1014,150,935,-0.85,'',true],
  ['000005','마','마','코스닥','2020-03-23','2022-09-13','2023-07-31',90.7,611,830,773,1755,-0.6,'화학',true]
];

function runAll(UI,ACCAPI){
  const out=[];let bad=0;
  const T=(name,fn)=>{ try{ fn(); out.push('PASS '+name); }catch(e){ bad++; out.push('FAIL '+name+' — '+(e&&e.message||e)); } };
  T('T1 백분율·부호: 0.0275→2.8% · −0.112→−11% · +0.381→+38.1%',()=>{
    assert.equal(UI.pct(0.0275,1),'2.8%'); assert.equal(UI.spct(-0.112,0),'−11%'); assert.equal(UI.spct(0.381,1),'+38.1%'); assert.equal(UI.pct(null),'–'); assert.equal(UI.spct(NaN),'–'); });
  T('T2 억·조: 233억 · 4,476억 · 1.2조 · 42조',()=>{
    assert.equal(UI.eok(233.1),'233억'); assert.equal(UI.eok(4476),'4,476억'); assert.equal(UI.eok(12000),'1.2조'); assert.equal(UI.eok(420000),'42조'); });
  T('T3 거래일 → 개월·년(21일≈1개월, 250일≈1년)',()=>{
    assert.equal(UI.tdays(91),'4개월'); assert.equal(UI.tdays(665),'2.7년'); assert.equal(UI.tdays(5),'1개월'); assert.equal(UI.tdays(null),'–'); });
  T('T4 배수·원',()=>{ assert.equal(UI.mult(13.919,1),'13.9배'); assert.equal(UI.won(2250),'2,250원'); assert.equal(UI.lift(2.4692),'2.47배'); });
  T('T5 목록 기본: 고점 배수 큰 순',()=>{ const v=UI.listView(ROWS,COLS,{}); assert.deepEqual(v.items.map(x=>x.code),['000003','000002','000005','000004','000001']); assert.equal(v.total,5); });
  T('T6 시장·상태 거르기: 코스닥 + 지금 상장 → 다·마',()=>{ const v=UI.listView(ROWS,COLS,{mkt:'코스닥',status:'alive'}); assert.deepEqual(v.items.map(x=>x.code),['000003','000005']); });
  T('T7 저점 연도 범위 2003~2010 → 나·라 · 상장폐지만 → 가',()=>{
    assert.deepEqual(UI.listView(ROWS,COLS,{from:'2003',to:'2010'}).items.map(x=>x.code).sort(),['000002','000004']);
    assert.deepEqual(UI.listView(ROWS,COLS,{status:'gone'}).items.map(x=>x.code),['000001']); });
  T('T8 찾기: 바뀐 이름(다2)·업종(화학)으로도 찾는다 · 날짜 순 오름',()=>{
    assert.deepEqual(UI.listView(ROWS,COLS,{text:'다2'}).items.map(x=>x.code),['000003']);
    assert.deepEqual(UI.listView(ROWS,COLS,{text:'화학'}).items.map(x=>x.code),['000005']);
    assert.deepEqual(UI.listView(ROWS,COLS,{sort:'t0',dir:'asc'}).items.map(x=>x.t0.slice(0,4)),['1998','2003','2008','2020','2020']); });
  T('T9 쪽 나누기: 2개씩 → 3쪽 · 범위 밖 쪽은 끝 쪽으로',()=>{
    const v=UI.listView(ROWS,COLS,{size:2,page:3}); assert.equal(v.pages,3); assert.equal(v.items.length,1);
    const w=UI.listView(ROWS,COLS,{size:2,page:99}); assert.equal(w.page,3); });
  T('T10 분석 파일 점검: 빠진 칸이면 이유를 돌려준다',()=>{
    assert.match(UI.validate({meta:{}}),/빠진 칸/); assert.equal(UI.validate(null).indexOf('빠진 칸')>=0,true); });
  T('T11 표 읽는 법 문장은 표에서 고른다(중앙값 1등 · 10배 1등 · 가장 나쁜 신호) · 이름은 이스케이프',()=>{
    const TR=[{sig:'가',rule:'1년',med:-0.1,win:0.4,x10:0.001,x3:0.02},{sig:'가',rule:'과열',med:0.05,win:0.52,x10:0.002,x3:0.08},
      {sig:'<b>나',rule:'1년',med:-0.3,win:0.3,x10:0.03,x3:0.09},{sig:'<b>나',rule:'과열',med:-0.2,win:0.35,x10:0.001,x3:0.04}];
    const n=UI.tradeNotes(TR);
    assert.match(n,/중앙값이 가장 높은 조합은 '가 \+ 과열'\(\+5%/); assert.match(n,/10배 이상 비율이 가장 높은 조합은 '&lt;b&gt;나 \+ 1년'/);
    assert.match(n,/가장 나쁜 것은 '&lt;b&gt;나'/); assert.ok(n.indexOf('<b>')<0,'이름 그대로 HTML 이 되면 안 된다');
    const m=UI.mcNote([{filter:'전체',timing:'상시',rule:'r1',cagr:0.03,p10:0,p90:0.06},{filter:'소형',timing:'상시',rule:'r2',cagr:0.08,p10:0.05,p90:0.1}],{KOSPI:{cagr:0.081}});
    assert.match(m,/'소형 · 상시 · r2'/); assert.match(m,/연 \+8\.0%/); assert.match(m,/코스피\(연 \+8\.1%\)/); });
  if(ACCAPI){
    T('M1 기본 메뉴: 모의(60) < 텐배거(65) < 공모주(70)',()=>{
      const d=ACCAPI.menuDefaults(); assert.equal(d.items['/paper'].order,60); assert.equal(d.items['/tenbagger'].order,65); assert.equal(d.items['/ipo'].order,70);
      assert.equal(ACCAPI.menuPath('/tenbagger.html'),'/tenbagger'); });
    T('M2 관리자가 모의를 30 으로 옮겨 저장했고 텐배거는 아직 없다 → 텐배거 35(모의 바로 아래)',()=>{
      const c=ACCAPI.normalizeMenuConfig({items:{'/':{mode:'public',order:10},'/paper':{mode:'public',order:30},'/scalping':{mode:'admin',order:40},'/ipo':{mode:'public',order:70}}});
      assert.equal(c.items['/tenbagger'].order,35); assert.equal(c.items['/tenbagger'].mode,'public'); });
    T('M3 관리자가 텐배거 자리를 직접 저장했으면 그 값을 따른다(숨김 포함)',()=>{
      const c=ACCAPI.normalizeMenuConfig({items:{'/paper':{mode:'public',order:30},'/tenbagger':{mode:'hidden',order:90}}});
      assert.equal(c.items['/tenbagger'].order,90); assert.equal(c.items['/tenbagger'].mode,'hidden'); });
  }
  return {out,bad};
}

/* ── 실제 파일로 값 시험 ── */
const UI=loadUI(SRC),ACCAPI=loadAcc(ACC);
const R=runAll(UI,ACCAPI); results.push(...R.out); failed+=R.bad;

/* ── 페이지 구조 ── */
t('P1 승인 가드(data-guard) · Firestore iOS 안전 전송 · JKAccess.guard',()=>{
  assert.match(HTML,/<script src="\/jk-access\.js" data-guard="1"><\/script>/); assert.match(HTML,/JKAccess\.guard\(\{auth/);
  assert.match(HTML,/experimentalForceLongPolling:true/); assert.match(HTML,/experimentalAutoDetectLongPolling:true/); });
t('P2 클로드 탭이 먼저 · 지피티 탭 · 각 칸 id',()=>{
  assert.ok(HTML.indexOf('data-tab="claude"')>=0&&HTML.indexOf('data-tab="claude"')<HTML.indexOf('data-tab="gpt"'));
  assert.match(HTML,/id="pane-claude"/); assert.match(HTML,/id="pane-gpt"/); assert.match(HTML,/id="tbc-root"/); });
t('P3 버전 x.y.z(#tbVer) · 화면 스크립트 버전과 같다',()=>{
  const v=(HTML.match(/id="tbVer">v(\d+\.\d+\.\d+)</)||[])[1]; assert.ok(v,'tbVer'); assert.match(HTML,/tenbagger-claude\.js\?v=\d+\.\d+\.\d+/);
  assert.equal(UI.VERSION,(HTML.match(/tenbagger-claude\.js\?v=(\d+\.\d+\.\d+)/)||[])[1],'스크립트 ?v 와 파일 VERSION'); });
t('P4 Chart.js 는 cdnjs 고정 버전(4.4.1) · 메뉴에서 텐배거가 현재 칸',()=>{
  assert.match(HTML,/cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.1\/chart\.umd\.min\.js/);
  assert.match(HTML,/<a href="\/tenbagger" class="cur"><span class="mi">🔟<\/span>텐배거<\/a>/); });

/* ── 분석 결과 파일 ── */
const AJ=path.join(ROOT,'data/tenbagger/claude/analysis.json');
const A=JSON.parse(fs.readFileSync(AJ,'utf8'));
t('D1 화면이 기대하는 칸이 다 있다',()=>assert.equal(UI.validate(A),''));
t('D2 텐배거 수 = 목록 길이 · 목록 행 = 열 수 · 고점 배수 ≥ 10',()=>{
  assert.equal(A.meta.episodes,A.episodes.list.length); assert.ok(A.episodes.list.every(r=>r.length===A.episodes.cols.length));
  const pi=A.episodes.cols.indexOf('peak'); assert.ok(A.episodes.list.every(r=>r[pi]>=10),'peak>=10'); });
t('D3 저점 연도별 합 = 텐배거 수 · 코스피+코스닥 = 텐배거 수',()=>{
  assert.equal(A.episodes.byYear.reduce((s,x)=>s+x.n,0),A.meta.episodes); assert.equal(A.episodes.kospi+A.episodes.kosdaq,A.meta.episodes); });
t('D4 기저율 0~1 · 3년 확률 ≤ 5년 확률 · 확률표 값 범위',()=>{
  const b=A.base; assert.ok(b.p10_5>0&&b.p10_5<1); assert.ok(b.p10_3<=b.p10_5);
  for(const k of Object.keys(A.featureBins)) for(const r of A.featureBins[k]) assert.ok(r.p10==null||(r.p10>=0&&r.p10<=1),k); });
t('D5 요약 숫자 = 본문 숫자(최고 규칙 · 앞 시기로 고른 규칙이 실제 앞 시기 1등)',()=>{
  const P=A.portfolio; assert.deepEqual(A.headline.best,P.best); assert.equal(A.headline.bestRule,P.best.rule);
  const top=P.grid.reduce((m,x)=>(x.is_cagr||-9)>(m.is_cagr||-9)?x:m); assert.equal(top.rule,P.best.rule,'앞 시기 1등만 고른다(검증 구간으로 고르지 않는다)');
  assert.ok(P.robust.some(r=>/1만\$/.test(r.label))&&P.robust.some(r=>/10만\$/.test(r.label)),'원금 두 가지'); });
t('D6 오늘 후보 ≤ 30 · 날짜 = 자료 마지막 날 · 그래프 월 순서',()=>{
  assert.ok(A.current.candidates.length<=30); assert.equal(A.current.asOf,A.meta.dataTo);
  const c=A.portfolio.curve.map(x=>x.d); assert.deepEqual(c,[...c].sort()); assert.equal(A.portfolio.curve[0].v,1); });

/* ── 변이: 틀리게 바꾸면 빨간불 ── */
function mutant(name,file,from,to){
  const src=file==='ui'?SRC:ACC; if(src.indexOf(from)<0){ failed++; results.push('FAIL 변이 대상 없음: '+name); return; }
  const m=src.replace(from,to); let r;
  try{ r=file==='ui'?runAll(loadUI(m),ACCAPI):runAll(UI,loadAcc(m)); }catch(e){ results.push('PASS 변이 차단(실행 오류): '+name); return; }
  if(r.bad>0) results.push('PASS 변이 차단: '+name+' ← '+r.out.find(x=>x.startsWith('FAIL')).slice(5,40));
  else{ failed++; results.push('FAIL 변이 놓침: '+name); }
}
mutant('목록 정렬 방향을 반대로','ui',"dir=q.dir==='asc'?1:-1","dir=q.dir==='asc'?-1:1");
mutant('시장 거르기를 빼먹음','ui',"if(q.mkt&&r[ix.mkt]!==q.mkt) return false;","");
mutant('바뀐 이름으로 못 찾음','ui',"(r[ix.name0]+' '+r[ix.name]+' '","(r[ix.name0]+' '");
mutant('억→조 기준을 잘못(1,000억)','ui',"if(Math.abs(x)>=10000){","if(Math.abs(x)>=1000){");
mutant('표 읽는 법에서 이름을 이스케이프하지 않음','ui',"+'10배 이상 비율이 가장 높은 조합은 \\''+esc(tb.sig)","+'10배 이상 비율이 가장 높은 조합은 \\''+(tb.sig)");
mutant('중앙값 1등 대신 평균 1등을 고름','ui',"const best=T.reduce((m,x)=>x.med>m.med?x:m,T[0]);","const best=T.reduce((m,x)=>x.x3>m.x3?x:m,T[0]);");
mutant('새 메뉴 기준점(after) 무시 — 저장된 순서 아래로 밀림','acc',"if(x.after&&!src[x.path]&&src[x.after]&&Number.isFinite(+src[x.after].order)) order=+src[x.after].order+5;","");
mutant('저장된 텐배거 순서를 기준점이 덮음','acc',"if(x.after&&!src[x.path]&&","if(x.after&&");

console.log(results.join('\n'));
console.log('\n텐배거(클로드) 화면·메뉴 시험: '+(results.length-failed)+' PASS / '+failed+' FAIL');
process.exit(failed?1:0);
