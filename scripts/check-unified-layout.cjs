'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const pages=['index.html','plan.html','backtest.html','scalping.html','claude.html','ipo.html','realestate.html','job.html','settings.html','admin.html','tenbagger.html'];
const labels={'/':'운영','/plan':'자산플랜','/backtest':'백테','/scalping':'연구(지피티)','/claude':'단타(클로드)','/ipo':'공모주','/realestate':'부동산','/job':'JOB','/settings':'설정','/admin':'관리자','/tenbagger':'텐배거'};
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
  assert(html.includes('/jk-ui.js?v=1.0.2'),p+' 공용 UI 캐시 버전');
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
assert.throws(()=>verify(ui.replace('--jk-desktop-width:1100px','--jk-desktop-width:1180px')),assert.AssertionError,'폭 회귀 차단');
assert.throws(()=>verify(ui.replace("'/job':'JOB'","'/job':'채용'")),assert.AssertionError,'메뉴명 회귀 차단');
assert.throws(()=>verify(ui.replace("kicker.textContent='JK 투자'","kicker.textContent='JK'")),assert.AssertionError,'브랜드 회귀 차단');
console.log('ALL PASS unified UI: 11 pages · desktop 1100px · menu headers · admin menu · paper dual currency · 3 mutations');
