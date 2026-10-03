const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const FILES=[
  'index.html','plan.html','backtest.html','scalping.html',
  'claude.html','ipo.html','job.html','admin.html','jk-access.js'
];
const BAD=[
  ['local'+'Storage',/localStorage/],
  ['session'+'Storage',/sessionStorage/],
  ['indexed'+'DB',/indexedDB/i],
  ['localforage',/localforage/i],
  ['CacheStorage',/CacheStorage/],
  ['caches.open',/caches\.open/],
  ['document.cookie',/document\.cookie/]
];
let fail=0;
for(const file of FILES){
  const src=fs.readFileSync(path.join(ROOT,file),'utf8');
  for(const [label,re] of BAD){
    if(re.test(src)){console.error('✗ '+file+' — 앱 직접 브라우저 영구저장 사용 발견: '+label);fail++;}
  }
}
const titles={
  'index.html':'JK 퀀트 — 운영',
  'plan.html':'JK 퀀트 — 자산플랜',
  'backtest.html':'JK 퀀트 — 백테스트',
  'scalping.html':'JK 퀀트 — 단타(지피티)',
  'claude.html':'JK 퀀트 — 단타(클로드)',
  'ipo.html':'JK 퀀트 — 공모주',
  'job.html':'JK 퀀트 — JOB',
  'admin.html':'JK 퀀트 — 관리자'
};
for(const [file,want] of Object.entries(titles)){
  const src=fs.readFileSync(path.join(ROOT,file),'utf8');
  const m=src.match(/<title>([^<]+)<\/title>/i);
  if(!m||m[1]!==want){console.error('✗ '+file+' — title 기대 "'+want+'" / 실제 "'+(m?m[1]:'없음')+'"');fail++;}
}
const index=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
if(!index.includes("document.title='JK 퀀트 — 모의투자'")){
  console.error('✗ /paper 동적 title이 JK 퀀트 — 모의투자 형식이 아님');fail++;
}
if(fail)process.exit(1);
console.log('✓ JKQuant 앱 직접 브라우저 영구저장 0건');
console.log('✓ 모든 브라우저 탭 제목 JK 퀀트 — 메뉴명 형식');
