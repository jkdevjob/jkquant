'use strict';
// CI와 별도 목록을 유지하지 않는다. check.yml의 모든 run 블록을 같은 순서/명령으로 실행한다.
const fs=require('fs'),path=require('path'),cp=require('node:child_process');
const root=path.join(__dirname,'..');
const lines=fs.readFileSync(path.join(root,'.github/workflows/check.yml'),'utf8').split(/\r?\n/);
const steps=[];let name='';
for(let i=0;i<lines.length;i++){
  const n=lines[i].match(/^      - name: (.+)$/);if(n)name=n[1];
  const r=lines[i].match(/^        run: (.*)$/);if(!r)continue;
  let command=r[1];
  if(command==='|'){
    const block=[];
    while(i+1<lines.length&&(/^          /.test(lines[i+1])||!lines[i+1].trim()))block.push(lines[++i].slice(10));
    command=block.join('\n').trimEnd();
  }
  if(/\$\{\{/.test(command))throw Error('CI expression을 포함한 run은 로컬 환경 매핑 필요: '+name);
  steps.push({name,command});
}
if(!steps.length)throw Error('check.yml run 블록을 찾지 못했습니다.');
const offline=process.argv.includes('--offline');let external=0,passed=0;
for(const step of steps){
  // 오프라인 모드는 개발용 검사만. 최종 CI의 빌드/의존성 설치를 통과한 것으로 표시하지 않는다.
  if(offline&&/\bnpx\b/.test(step.command)){console.log('CI에서 확인 필요 (offline): '+step.name);external++;continue;}
  let command=step.command;
  if(offline&&/^\s*pip install[^\n]*$/m.test(command)){
    command=command.replace(/^\s*pip install[^\n]*\n?/m,'');
    console.log('의존성 설치 생략 (offline): '+step.name);
  }
  console.log('\n['+(passed+1)+'/'+steps.length+'] '+step.name);
  const r=cp.spawnSync('bash',['-e','-o','pipefail','-c',command],{cwd:root,stdio:'inherit',env:process.env});
  if(r.error||r.status!==0){console.error('FAIL '+step.name+(r.error?' — '+r.error.message:''));process.exit(r.status||1);}
  passed++;
}
console.log('\nPASS '+passed+' CI 검사 단계'+(external?' · 외부 빌드 '+external+'개는 GitHub CI에서 추가 확인 필요':' — 전체 검증 완료'));
