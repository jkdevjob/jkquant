const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(__dirname,'..');
const SKIP_DIRS=new Set(['.git','node_modules','functions','worker','scripts','.github','data','testdata']);
const BAD=[
  ['localStorage',/localStorage/],
  ['sessionStorage',/sessionStorage/],
  ['indexedDB',/indexedDB/i],
  ['localforage',/localforage/i],
  ['CacheStorage',/CacheStorage/],
  ['caches.open',/caches\.open/],
  ['document.cookie',/document\.cookie/]
];

function rel(abs){return path.relative(ROOT,abs).replace(/\\/g,'/');}
function walkHtml(dir,out=[]){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.isDirectory()){
      if(SKIP_DIRS.has(ent.name))continue;
      walkHtml(path.join(dir,ent.name),out);
    }else if(ent.isFile()&&/\.html$/i.test(ent.name)) out.push(path.join(dir,ent.name));
  }
  return out;
}
function stripRef(x){return String(x||'').trim().split('#')[0].split('?')[0];}
function resolveLocal(fromFile,spec){
  spec=stripRef(spec);
  if(!spec||/^(?:https?:|data:|blob:|\/\/)/i.test(spec))return null;
  let abs;
  if(spec.startsWith('/'))abs=path.join(ROOT,spec.replace(/^\/+/,'')); else abs=path.resolve(path.dirname(fromFile),spec);
  if(!abs.startsWith(ROOT+path.sep)&&abs!==ROOT)return null;
  if(!/\.(?:js|mjs)$/i.test(abs)||!fs.existsSync(abs)||!fs.statSync(abs).isFile())return null;
  return abs;
}
function depsOf(file){
  const src=fs.readFileSync(file,'utf8'),out=[];
  for(const re of [
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
    /\b(?:import|export)\s+(?:[^"'\n;]+?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ]){
    let m;while((m=re.exec(src))){const d=resolveLocal(file,m[1]);if(d)out.push(d);}
  }
  return out;
}

const htmlAbs=walkHtml(ROOT);
const appAbs=new Set(htmlAbs);
const queue=[...htmlAbs];
while(queue.length){
  const f=queue.shift();
  for(const d of depsOf(f))if(!appAbs.has(d)){appAbs.add(d);queue.push(d);}
}
const FILES=[...appAbs].map(rel).sort();

let fail=0;
for(const file of FILES){
  let src=fs.readFileSync(path.join(ROOT,file),'utf8');
  if(file==='plan.html'){
    const m=src.match(/\/\* LEGACY_PLAN_RECOVERY_READ_ONCE_START[\s\S]*?LEGACY_PLAN_RECOVERY_READ_ONCE_END \*\//);
    if(m){
      if(/\.setItem\s*\(/.test(m[0])){console.error('✗ plan.html — 1회 복구 블록은 브라우저 저장소 쓰기 금지');fail++;}
      if(!/\.getItem\s*\(/.test(m[0])||!/\.removeItem\s*\(/.test(m[0])){console.error('✗ plan.html — 1회 복구 블록은 읽기 후 삭제만 허용');fail++;}
      src=src.replace(m[0],'');
    }
  }
  for(const [label,re] of BAD){
    if(re.test(src)){console.error('✗ '+file+' — 앱 직접 브라우저 영구저장 사용 발견: '+label);fail++;}
  }
}

const exactTitles={
  'index.html':'JK 퀀트 — 운영',
  'plan.html':'JK 퀀트 — 자산플랜',
  'backtest.html':'JK 퀀트 — 백테스트',
  'scalping.html':'JK 퀀트 — 단타(지피티)',
  'claude.html':'JK 퀀트 — 단타(클로드)',
  'ipo.html':'JK 퀀트 — 공모주',
  'job.html':'JK 퀀트 — JOB',
  'admin.html':'JK 퀀트 — 관리자'
};
for(const abs of htmlAbs){
  const file=rel(abs),src=fs.readFileSync(abs,'utf8');
  const m=src.match(/<title>([^<]+)<\/title>/i);
  if(!m||!m[1].startsWith('JK 퀀트 — ')){
    console.error('✗ '+file+' — title이 "JK 퀀트 — 메뉴명" 형식이 아님: '+(m?m[1]:'없음'));fail++;
  }
  if(exactTitles[file]&&m&&m[1]!==exactTitles[file]){
    console.error('✗ '+file+' — title 기대 "'+exactTitles[file]+'" / 실제 "'+m[1]+'"');fail++;
  }
}

function collectStringConsts(src){
  const out=new Map(),re=/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`)/g;
  let m;while((m=re.exec(src)))out.set(m[1],m[2]??m[3]??m[4]??'');
  return out;
}
function titleAtomOk(expr,consts){
  expr=String(expr||'').trim();
  let m=expr.match(/^(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`)$/);
  if(m)return (m[1]??m[2]??m[3]??'').startsWith('JK 퀀트 — ');
  if(/^[A-Za-z_$][\w$]*$/.test(expr))return String(consts.get(expr)||'').startsWith('JK 퀀트 — ');
  return false;
}
function titleExprOk(expr,consts){
  expr=String(expr||'').trim();
  if(titleAtomOk(expr,consts))return true;
  const q=expr.indexOf('?'),c=expr.lastIndexOf(':');
  if(q>=0&&c>q)return titleAtomOk(expr.slice(q+1,c),consts)&&titleAtomOk(expr.slice(c+1),consts);
  return false;
}
for(const file of FILES){
  const src=fs.readFileSync(path.join(ROOT,file),'utf8'),consts=collectStringConsts(src);
  const staticTitle=(src.match(/<title>([^<]+)<\/title>/i)||[])[1]||'';
  if(staticTitle.startsWith('JK 퀀트 — ')){
    const inherited=/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.title\b/g;
    let im;while((im=inherited.exec(src)))consts.set(im[1],staticTitle);
  }
  const re=/document\.title\s*=\s*([^;\n]+)/g;
  let m;
  while((m=re.exec(src))){
    if(!titleExprOk(m[1],consts)){
      console.error('✗ '+file+' — 동적 document.title 결과가 모두 "JK 퀀트 — 메뉴명" 형식이어야 함: '+m[1].trim());fail++;
    }
  }
}

if(fail)process.exit(1);
console.log('✓ JKQuant 앱 직접 브라우저 영구저장 쓰기 0건 · plan 1회 legacy 읽기/삭제만 예외');
console.log('✓ 전체 앱 HTML + 참조 로컬 JS 자동 탐색: '+FILES.length+'개 파일');
console.log('✓ 모든 브라우저 탭 제목 JK 퀀트 — 메뉴명 형식');
