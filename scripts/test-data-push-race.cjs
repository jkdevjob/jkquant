'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),script=path.join(root,'scripts/push-scalping-data.sh');
const git=cp.execFileSync('bash',['-c','command -v git'],{encoding:'utf8'}).trim();
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jkq-data-push-'));
function run(cwd,...args){return cp.execFileSync(git,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
function config(cwd){run(cwd,'config','user.name','Push test');run(cwd,'config','user.email','test@example.invalid');}
function commit(cwd,file,value){fs.writeFileSync(path.join(cwd,file),value);run(cwd,'add',file);run(cwd,'commit','-m',file);}
function setup(name){
  const base=path.join(temp,name);fs.mkdirSync(base);const origin=path.join(base,'origin.git');run(base,'init','--bare',origin);
  const a=path.join(base,'a'),b=path.join(base,'b');run(base,'clone',origin,a);config(a);run(a,'switch','-c','scalping-data');commit(a,'base.txt','base');run(a,'push','origin','scalping-data');
  run(base,'clone','--branch','scalping-data',origin,b);config(b);return {base,origin,a,b};
}
function push(D,env={},helper=script){return cp.spawnSync('bash',[helper],{cwd:D.a,encoding:'utf8',env:{...process.env,JKQ_DATA_PUSH_RETRY_DELAY:'0',...env}});}
function raceEnv(D){
  const bin=path.join(D.base,'bin');fs.mkdirSync(bin);const flag=path.join(D.base,'once');
  fs.writeFileSync(path.join(bin,'git'),`#!/usr/bin/env bash\nif [ "$1" = "push" ] && [ ! -f "$RACE_FLAG" ]; then\n touch "$RACE_FLAG"\n "$REAL_GIT" -C "$RACE_OTHER" push origin scalping-data >&2\nfi\nexec "$REAL_GIT" "$@"\n`,{mode:0o755});
  return {PATH:bin+path.delimiter+process.env.PATH,RACE_FLAG:flag,RACE_OTHER:D.b,REAL_GIT:git};
}
try{
  const D=setup('race');commit(D.a,'daytrading.json','snapshot');commit(D.b,'soxl.json','soxl');
  // 정확히 첫 pull과 push 사이에 다른 연구 작업을 push해 실제 non-fast-forward를 만든다.
  const race=push(D,raceEnv(D));
  assert.equal(race.status,0,race.stdout+race.stderr);assert(race.stdout.includes('시도 2'),'충돌 뒤 재시도');
  assert.equal(run(D.base,'--git-dir='+D.origin,'show','scalping-data:daytrading.json'),'snapshot');
  assert.equal(run(D.base,'--git-dir='+D.origin,'show','scalping-data:soxl.json'),'soxl');
  assert.equal(run(D.base,'--git-dir='+D.origin,'rev-list','--count','scalping-data'),'3','두 작업의 커밋을 모두 보존');
  console.log('PASS pull→push 사이 실제 저장 충돌을 재시도하고 두 결과/커밋 모두 보존');
  const M=setup('mutation');commit(M.a,'daytrading.json','snapshot');commit(M.b,'soxl.json','soxl');
  const mutation=path.join(M.base,'single-attempt.sh');
  fs.writeFileSync(mutation,fs.readFileSync(script,'utf8').replace('for attempt in 1 2 3 4 5; do','for attempt in 1; do'));
  const broken=push(M,raceEnv(M),mutation);assert.notEqual(broken.status,0,'재시도를 제거하면 같은 저장 충돌이 다시 실패');
  assert.equal(run(M.base,'--git-dir='+M.origin,'show','scalping-data:soxl.json'),'soxl','변이에서도 다른 작업 이력 보존');
  console.log('PASS 변이: 재시도 제거 시 실제 저장 충돌을 잡아냄');
  const C=setup('conflict');commit(C.a,'base.txt','local');commit(C.b,'base.txt','remote');run(C.b,'push','origin','scalping-data');
  const before=run(C.b,'rev-parse','HEAD'),conflict=push(C);assert.notEqual(conflict.status,0,'진짜 내용 충돌은 실패');
  assert.equal(run(C.base,'--git-dir='+C.origin,'rev-parse','scalping-data'),before,'원격 기록은 그대로');
  console.log('PASS 실제 데이터 내용 충돌은 중단하고 원격 기록 보존');
  const W=setup('wrong-branch');run(W.a,'switch','-c','main');const wrong=push(W);assert.notEqual(wrong.status,0,'main 저장 금지');
  console.log('PASS main에서 데이터 저장 금지');
  // 다섯 번 push가 거절돼도 초록으로 숨기지 않는다.
  const F=setup('exhaust');commit(F.a,'new.txt','new');const no=path.join(F.base,'bin');fs.mkdirSync(no);
  fs.writeFileSync(path.join(no,'git'),`#!/usr/bin/env bash\nif [ "$1" = "push" ]; then exit 1; fi\nexec "$REAL_GIT" "$@"\n`,{mode:0o755});
  const exhausted=push(F,{PATH:no+path.delimiter+process.env.PATH,REAL_GIT:git});assert.notEqual(exhausted.status,0);assert(exhausted.stdout.includes('재시도 5회 실패'));
  console.log('PASS 재시도 한도 초과를 실패로 보고');
  const workflows=fs.readdirSync(path.join(root,'.github/workflows')).filter(f=>f.endsWith('.yml'));
  let writers=0,saves=0;for(const file of workflows){const text=fs.readFileSync(path.join(root,'.github/workflows',file),'utf8');
    if(!/ref:\s*scalping-data/.test(text))continue;
    assert(!/git (?:pull|push)[^\n]*scalping-data/.test(text),file+'는 공용 저장 함수 사용');
    assert(text.includes('bash .app/scripts/push-scalping-data.sh'),file);writers++;
    saves+=(text.match(/bash \.app\/scripts\/push-scalping-data\.sh/g)||[]).length;
  }
  assert.equal(writers,10,'모든 데이터 저장 workflow');
  assert.equal(saves,12,'조건부 저장을 포함한 모든 데이터 저장 경로');
  for(const file of ['daytrading-research.yml','soxl-research.yml','daily1-shadow-research.yml'])
    assert(!fs.readFileSync(path.join(root,'.github/workflows',file),'utf8').includes('- "scalping.html"'),file+' UI 수정은 연구 수집을 실행하지 않음');
  console.log('PASS 10개 workflow의 모든 저장 경로 공용화 · UI 수정으로 연구 수집 재실행 없음');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
console.log('ALL PASS data push race');
