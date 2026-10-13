'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const pages=['index.html','plan.html','backtest.html','scalping.html','claude.html','ipo.html','realestate.html','job.html','settings.html','admin.html','tenbagger.html'];
const labels={'/':'운영','/paper':'모의','/plan':'자산플랜','/backtest':'백테','/scalping':'연구(지피티)','/claude':'연구(클로드)','/ipo':'공모주','/realestate':'부동산','/job':'JOB','/settings':'설정','/admin':'관리자','/tenbagger':'텐배거'};
const ui=fs.readFileSync('jk-ui.js','utf8'),mobile=fs.readFileSync('jk-mobile.css','utf8');
new vm.Script(ui,{filename:'jk-ui.js'});
function verify(src=ui){
  assert(src.includes(':root{--jk-desktop-width:1100px}'),'PC 공통 폭은 자산플랜 1100px');
  assert(src.includes('@media(min-width:769px){body .wrap'),'PC에서만 공통 폭 적용');
  assert(src.includes('max-width:var(--jk-desktop-width)!important'),'wrap 최대폭 공통 변수');
  assert(src.includes("kicker.textContent='JK 투자'"),'작은 브랜드 JK 투자');
  assert(src.includes("title.textContent=label"),'큰 제목은 메뉴명');
  for(const [route,label] of Object.entries(labels))assert(src.includes("'"+route+"':'"+label+"'"),route+' 메뉴명');
}
verify();
assert(mobile.includes('@media (max-width:768px)'),'모바일 분기 유지');
assert(/\.wrap\{width:100%!important;max-width:none!important/.test(mobile),'모바일 전체폭 유지');
for(const p of pages){
  const html=fs.readFileSync(p,'utf8');
  assert(html.includes('/jk-ui.js?v=1.0.4'),p+' 공용 UI 캐시 버전');
  assert(html.includes('class="wrap'),p+' wrap 존재');
  assert(html.includes('class="jkmenu'),p+' 공통 메뉴 존재');
}
assert.equal(fs.readdirSync('.').filter(x=>x.endsWith('.html')).length,11,'루트 11페이지');
const admin=fs.readFileSync('admin.html','utf8');
assert(admin.includes("src.filter(x=>x.path!=='/tenbagger')"),'관리자 메뉴관리에서 텐배거 제외');
const index=fs.readFileSync('index.html','utf8');
assert(index.includes('function paperDualMoney('),'달러+원화 병기 함수');
assert(index.includes('paperDualMoney(r,r.total,r.wonRate)'),'모의 평가 달러+원화 병기');
assert(index.includes('paperDualMoney(r,r.inflow,r.wonRate,r.inflowWon)'),'모의 투입 달러+원화 병기');
assert(index.includes('달러 종목은 달러 + 원화 병기'),'표 설명 병기 규칙');
// /paper 는 별도 HTML이 아니라 운영 index 를 공유한다. 첫 진입과 SPA 이동 양쪽에서 제목을 확인한다.
const start=ui.indexOf('  var HEADER_LABELS='),end=ui.indexOf('  function normalizeLogin(){',start);
assert(start>0&&end>start,'공통 헤더 함수를 추출할 수 있어야 한다');
const headerSrc=ui.slice(start,end);
const bodyModes=new Set(),loc={pathname:'/paper'};
const version={textContent:'v3.110.34',id:'appVerTop',classList:{add(){}}};
const h1={parentElement:null,children:[version],classList:{add(){}},
  querySelectorAll(){return this.children;},
  set textContent(s){if(s==='')this.children=[];},
  appendChild(x){this.children.push(x);return x;}};
const kicker={textContent:'',classList:{add(){}}};
const brand={classList:{add(){}},querySelector(){return kicker;},insertBefore(){}};
h1.parentElement=brand;
const row={classList:{add(){}},querySelector(){return h1;}};
const documentStub={body:{classList:{contains:x=>bodyModes.has(x)}},
  querySelector:()=>row,createElement:()=>({className:'',textContent:''})};
const normalize=new Function('document','location',headerSrc+';return normalizeHeader;')(documentStub,loc);
const rendered=()=>h1.children.find(x=>x.className==='jk-page-title')?.textContent;
normalize();assert.equal(rendered(),'모의','/paper 직접 진입');assert.equal(kicker.textContent,'JK 투자','작은 브랜드');
loc.pathname='/';bodyModes.add('paperpage');normalize();assert.equal(rendered(),'모의','모의 페이지 상태 전환 중에는 모의 표시');
bodyModes.delete('paperpage');normalize();assert.equal(rendered(),'운영','운영 복귀');
loc.pathname='/paper';bodyModes.add('paperpage');normalize();assert.equal(rendered(),'모의','뒤로가기/재진입');
assert(h1.children.includes(version),'버전 DOM id 유지');
assert(index.includes("if(window.JKUnifiedUI&&typeof window.JKUnifiedUI.normalizeHeader==='function')window.JKUnifiedUI.normalizeHeader();"),'운영/모의 상태 전환에서 헤더 다시 계산');
assert.throws(()=>verify(ui.replace('--jk-desktop-width:1100px','--jk-desktop-width:1180px')),assert.AssertionError,'폭 회귀 차단');
assert.throws(()=>verify(ui.replace("'/job':'JOB'","'/job':'채용'")),assert.AssertionError,'메뉴명 회귀 차단');
assert.throws(()=>verify(ui.replace("kicker.textContent='JK 투자'","kicker.textContent='JK'")),assert.AssertionError,'브랜드 회귀 차단');
console.log('ALL PASS unified UI: 11 pages · desktop 1100px · menu headers · admin menu · paper dual currency · 3 mutations');
