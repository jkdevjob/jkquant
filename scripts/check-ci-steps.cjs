'use strict';
/* 검사 단계 목록 한 곳(.github/check-steps.yml) · 로컬 실행기(scripts/check-before-push.cjs · 병렬/조각/offline) ·
   GitHub 검증(check.yml 조각 4개 + 합치는 check) 값 시험. 파서·배정은 실제 함수를 불러 쓰고, 실행기는 가짜 목록으로
   자식 프로세스로 돌린다(재구현 없음). 변이(배정 빠뜨림 · 종료코드 무시 · 병렬 안 함 · 끊기 안 함 · pip 중복 · 조각 수 불일치)는
   TEST_RESULTS 에 적힌 대로 손으로 바꿔 빨간불을 확인했다. */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const ROOT=path.join(__dirname,'..'),RUNNER=path.join(ROOT,'scripts/check-before-push.cjs');
const R=require(RUNNER);
const MANIFEST=fs.readFileSync(path.join(ROOT,'.github/check-steps.yml'),'utf8');
const WF=fs.readFileSync(path.join(ROOT,'.github/workflows/check.yml'),'utf8');
let passed=0;const ok=(name,cond,detail)=>{if(!cond){console.error('FAIL '+name+(detail?' — '+detail:''));process.exit(1);}passed++;console.log('PASS '+name);};
const T=fs.mkdtempSync(path.join(os.tmpdir(),'jkq-ci-steps-'));
const run=(args,env,manifestText,name)=>{
  const file=path.join(T,name+'.yml');fs.writeFileSync(file,manifestText);
  const t0=Date.now();
  const r=cp.spawnSync(process.execPath,[RUNNER,'--manifest='+file,...args],{cwd:ROOT,encoding:'utf8',env:Object.assign({},process.env,{GITHUB_ACTIONS:''},env||{}),maxBuffer:8*1024*1024});
  return {status:r.status,out:(r.stdout||'')+(r.stderr||''),ms:Date.now()-t0};
};
const Y=(...steps)=>steps.map(s=>'- name: '+s.name+'\n'+(s.minutes?'  minutes: '+s.minutes+'\n':'')+(s.run.includes('\n')?'  run: |\n'+s.run.split('\n').map(l=>'    '+l).join('\n')+'\n':'  run: '+s.run+'\n')).join('');
try{
  /* ── C1 목록 ── */
  const steps=R.parseSteps(MANIFEST);
  const names=steps.map(s=>s.name);
  ok('C1 목록: 50단계 이상 · 이름 겹침 없음 · 빈 명령 없음 · CI expression 없음',
     steps.length>=50&&new Set(names).size===steps.length&&steps.every(s=>s.command.trim()&&!/\$\{\{/.test(s.command)),String(steps.length));
  const regIdx=steps.findIndex(s=>/^node regression-check\.js index\.html backtest\.html testdata$/m.test(s.command));
  ok('C1 목록: 회귀 · Worker dry-run(npx) · 텐배거 변이 · 이 시험이 들어 있다',
     regIdx>=0&&steps.some(s=>/npx --yes wrangler@4 deploy --dry-run/.test(s.command))&&steps.some(s=>/scripts\/tenbagger_claude\/mutation_test\.py/.test(s.command))
     &&steps.some(s=>/node scripts\/check-ci-steps\.cjs/.test(s.command)));
  const gapIdx=steps.findIndex(s=>/mutation_test_opening_gapdown\.py/.test(s.command)),heavy=steps.reduce((m,s)=>s.minutes>steps[m].minutes?s.index:m,0);
  ok('C1 목록: minutes 힌트 — 갭하락 변이(399개 · 가장 무거운 단계) 3분 이상 · 회귀 1분 이상 · 모두 0보다 큼',
     gapIdx>=0&&heavy===gapIdx&&steps[gapIdx].minutes>=3&&steps[regIdx].minutes>=1&&steps.every(s=>s.minutes>0),steps[gapIdx]&&steps[gapIdx].minutes+' / '+steps[regIdx].minutes);
  ok('C1 목록: workflows 폴더에 check-steps.yml 이 없다(GitHub 가 워크플로로 읽으면 안 됨)', !fs.existsSync(path.join(ROOT,'.github/workflows/check-steps.yml')));
  /* ── C2 GitHub 검증 ── */
  const mx=WF.match(/^\s+part: \[([0-9, ]+)\]$/m),parts=mx?mx[1].split(',').map(x=>+x.trim()):[];
  const N=parts.length;
  ok('C2 check.yml: 조각 매트릭스 1..N 연속 · 실행기 --shard=${{ matrix.part }}/N 의 N 이 같다',
     N>=2&&parts.every((p,i)=>p===i+1)&&WF.includes('run: node scripts/check-before-push.cjs --shard=${{ matrix.part }}/'+N)
     &&(WF.match(/check-before-push\.cjs --shard=/g)||[]).length===1,JSON.stringify(parts));
  const runLines=WF.match(/^\s+run: /gm)||[];
  ok('C2 check.yml: run 은 실행기 호출 + 합치기 둘뿐(단계 목록은 check-steps.yml 에만)', runLines.length===2,String(runLines.length));
  ok('C2 check.yml: shard · check 두 작업 · check 는 needs: shard · always() · 조각 결과 success 검사',
     /^  shard:\n/m.test(WF)&&/^  check:\n/m.test(WF)&&/needs: shard/.test(WF)&&/if: always\(\) && \(github\.event_name != 'pull_request' \|\| !github\.event\.pull_request\.draft\)/.test(WF)
     &&WF.includes('test "${{ needs.shard.result }}" = "success"')&&/fail-fast: false/.test(WF));
  ok('C2 check.yml: Draft 제외 · Node 22 · Python 3.12 · 겹치는 실행 취소 · 트리거(main push · PR opened/ready · 수동) 그대로',
     (WF.match(/github\.event\.pull_request\.draft/g)||[]).length===2&&WF.includes("node-version: '22'")&&WF.includes("python-version: '3.12'")
     &&/cancel-in-progress: true/.test(WF)&&/branches: \[main\]/.test(WF)&&/types: \[opened, ready_for_review\]/.test(WF)&&/workflow_dispatch:/.test(WF));
  /* ── C3 배정 ── */
  const total=steps.reduce((a,s)=>a+s.minutes,0),maxMin=Math.max(...steps.map(s=>s.minutes));
  let all=true;
  for(let n=1;n<=8;n++){
    const {part,load}=R.assignShards(steps,n),again=R.assignShards(steps,n);
    const cover=part.every(p=>Number.isInteger(p)&&p>=1&&p<=n)&&part.length===steps.length;
    const nonEmpty=Array.from({length:n},(_,k)=>part.filter(p=>p===k+1).length).every(c=>c>0);
    const bound=Math.max(...load)<=total/n+maxMin+1e-9;
    const sumOk=Math.abs(load.reduce((a,b)=>a+b,0)-total)<1e-9;
    if(!(cover&&nonEmpty&&bound&&sumOk&&JSON.stringify(again)===JSON.stringify({part,load})))all=false;
  }
  ok('C3 배정: 조각 1~8 — 모든 단계가 꼭 한 조각 · 빈 조각 없음 · 가장 찬 조각 ≤ 평균+최대 단계(LPT) · 늘 같은 배정',all);
  { const {part}=R.assignShards(steps,N);
    const union=[].concat(...Array.from({length:N},(_,k)=>steps.filter((s,i)=>part[i]===k+1).map(s=>s.index))).sort((a,b)=>a-b);
    ok('C3 배정: GitHub 조각 '+N+'개의 합 = 단계 전부, 하나씩',JSON.stringify(union)===JSON.stringify(steps.map((s,i)=>i)));
    ok('C3 배정: 가장 무거운 단계(갭하락 변이)가 든 조각은 다른 단계를 가장 적게 든다 · 회귀와 다른 조각',
       (()=>{const counts=Array.from({length:N},(_,k)=>part.filter(p=>p===k+1).length);return counts[part[heavy]-1]===Math.min(...counts)&&part[heavy]!==part[regIdx];})());
  }
  const toy=[{index:0,name:'a',command:'x',minutes:3},{index:1,name:'b',command:'x',minutes:1},{index:2,name:'c',command:'x',minutes:1},{index:3,name:'d',command:'x',minutes:1}];
  ok('C3 배정 값: [3,1,1,1]분을 둘로 → 3분 하나 | 1분 셋 (부하 3 · 3)',JSON.stringify(R.assignShards(toy,2))==='{"part":[1,2,2,2],"load":[3,3]}',JSON.stringify(R.assignShards(toy,2)));
  /* ── C4 파서 ── */
  assert.throws(()=>R.parseSteps('- name: a\n  run: x\n- name: a\n  run: y\n'),/겹치는/);
  assert.throws(()=>R.parseSteps('- name: a\n  run: echo ${{ github.sha }}\n'),/CI expression/);
  assert.throws(()=>R.parseSteps('  run: x\n'),/앞에 올 수 없는/);
  assert.throws(()=>R.parseSteps('- name: a\n  run: x\n  foo: 1\n'),/알 수 없는 줄/);
  assert.throws(()=>R.parseSteps('- name: a\n  minutes: 0\n  run: x\n'),/minutes/);
  assert.throws(()=>R.parseSteps('- name: a\n'),/run 이 없는/);
  const blk=R.parseSteps('# 주석\n\n- name: b\n  minutes: 2.5\n  run: |\n    python - <<\'PY\'\n    print(1)\n\n    x=1\n    PY\n\n- name: c\n  run: echo c\n');
  ok('C4 파서: 주석·빈 줄 · | 블록(속 빈 줄 유지 · 들여쓰기 4칸 제거) · minutes · 한 줄 run',
     blk.length===2&&blk[0].minutes===2.5&&blk[0].command==="python - <<'PY'\nprint(1)\n\nx=1\nPY"&&blk[1].command==='echo c'&&blk[1].minutes===R.DEFAULT_MINUTES,JSON.stringify(blk));
  ok('C4 pip 줄: 찾기 · 떼기(앞뒤 공백 정리)',
     R.pipLines('pip install --quiet numpy pandas\npython a.py\n  pip install x').length===2&&R.stripPip('pip install --quiet numpy\npython a.py')==='python a.py'&&R.pipLines('echo pip install').length===0);
  assert.throws(()=>R.parseShard('0/4'),/형식/);assert.throws(()=>R.parseShard('5/4'),/형식/);assert.throws(()=>R.parseShard('a'),/형식/);
  ok('C4 조각 지정: k/n 만(1≤k≤n)',JSON.stringify(R.parseShard('2/4'))==='{"k":2,"n":4}');
  /* ── C5 실행기(가짜 목록) ── */
  const okY=Y({name:'A',run:'echo A-out'},{name:'B',run:'echo B1\necho B2'},{name:'C',run:'printf C-out'});
  let r=run(['--serial'],null,okY,'ok');
  ok('C5 하나씩: 셋 모두 통과 · 목록 순서 · 요약 PASS 3 · 전체 검증 완료',
     r.status===0&&r.out.indexOf('[1/3] A')<r.out.indexOf('A-out')&&r.out.indexOf('A-out')<r.out.indexOf('[2/3] B')&&r.out.indexOf('B2')<r.out.indexOf('[3/3] C')
     &&/PASS 3 CI 검사 단계 — 전체 검증 완료/.test(r.out),r.out.slice(0,600));
  r=run(['--serial'],{GITHUB_ACTIONS:'true'},okY,'ok');
  ok('C5 GitHub 안: 단계마다 ::group:: / ::endgroup::',r.status===0&&r.out.includes('::group::[1/3] A')&&(r.out.match(/::endgroup::/g)||[]).length===3);
  r=run(['--serial','--only=B'],null,okY,'ok');
  ok('C5 --only: 이름이 맞는 단계만 · 요약에 일부 표시',r.status===0&&r.out.includes('B2')&&!r.out.includes('A-out')&&!r.out.includes('C-out')&&/PASS 1 CI 검사 단계 \(일부 · --only\)/.test(r.out),r.out.slice(0,400));
  const m2=path.join(T,'m-serial');
  r=run(['--serial'],null,Y({name:'F',run:'exit 3'},{name:'G',run:'touch '+m2}),'serialfail');
  ok('C5 하나씩 빨간불: 종료코드 그대로(3) · FAIL 이름 · 뒤 단계는 안 돈다',r.status===3&&/FAIL F/.test(r.out)&&!fs.existsSync(m2),r.status+' '+r.out.slice(0,300));
  r=run(['--serial'],{GITHUB_ACTIONS:'true'},Y({name:'F',run:'exit 3'}),'serialfail2');
  ok('C5 GitHub 안 빨간불: ::error 표시',r.status===3&&r.out.includes('::error title=검사 실패::F'));
  const par=Y({name:'P1',run:'sleep 1.5'},{name:'P2',run:'sleep 1.5'},{name:'P3',run:'sleep 1.5'},{name:'P4',run:'sleep 1.5'});
  r=run(['--parallel=4'],null,par,'par');
  ok('C5 병렬 4: 1.5초 넷이 4.5초 안에(하나씩이면 6초) · 요약에 병렬 4 · 가장 오래 걸린 단계',
     r.status===0&&r.ms<4500&&/PASS 4 CI 검사 단계 — 전체 검증 완료 · 0분 0[0-9]초 · 병렬 4/.test(r.out)&&/가장 오래 걸린 단계: P/.test(r.out),r.ms+'ms '+r.out.slice(-300));
  const mk=path.join(T,'m-kill');
  r=run(['--parallel=2'],null,Y({name:'F',run:'sleep 0.3; exit 7'},{name:'G',run:'sleep 2; touch '+mk}),'kill');
  ok('C5 병렬 빨간불: 바로 멈추고 도는 단계를 끊는다(표시 파일 없음 · 1.5초 안) · 종료 1 · FAIL F',
     r.status===1&&r.ms<1500&&!fs.existsSync(mk)&&/FAIL F/.test(r.out)&&/남은 단계는 돌리지 않음|FAIL 1개/.test(r.out),r.status+' '+r.ms+'ms '+fs.existsSync(mk));
  const mk2=path.join(T,'m-keep');
  r=run(['--parallel=2','--keep-going'],null,Y({name:'F',run:'sleep 0.3; exit 7'},{name:'G',run:'sleep 1.2; touch '+mk2}),'keep');
  ok('C5 --keep-going: 빨간불 뒤에도 끝까지(표시 파일 있음) · 종료 1 · FAIL 1개',r.status===1&&fs.existsSync(mk2)&&/FAIL 1개 — F/.test(r.out),r.status+' '+r.out.slice(-200));
  const shY=Y({name:'S1',minutes:3,run:'echo S1-out'},{name:'S2',run:'echo S2-out'},{name:'S3',run:'echo S3-out'},{name:'S4',run:'echo S4-out'});
  r=run(['--list','--parts=2'],null,shY,'shard');
  ok('C5 --list: 배정 표(S1 → 조각 1 · S2~S4 → 조각 2) · 조각별 분',r.status===0&&/ 1  조각 1 {2,}3분  S1/.test(r.out)&&/ 2  조각 2 .*S2/.test(r.out)&&/ 4  조각 2 .*S4/.test(r.out)&&/조각별 예상 분: 1: 3\.0 · 2: 1\.5/.test(r.out),r.out);
  r=run(['--shard=2/2'],null,shY,'shard');
  ok('C5 --shard=2/2: S2·S3·S4 만 · 하나씩 · 요약 (조각 2/2)',r.status===0&&!r.out.includes('S1-out')&&['S2-out','S3-out','S4-out'].every(x=>r.out.includes(x))&&/PASS 3 CI 검사 단계 \(조각 2\/2\)/.test(r.out)&&!/병렬/.test(r.out),r.out.slice(-300));
  r=run(['--shard=1/2'],null,shY,'shard');
  ok('C5 --shard=1/2: S1 만',r.status===0&&r.out.includes('S1-out')&&!r.out.includes('S2-out')&&/PASS 1 CI 검사 단계 \(조각 1\/2\)/.test(r.out));
  const ordY=Y({name:'O1',run:'echo O1-out'},{name:'O2',minutes:2,run:'echo O2-out'},{name:'O3',minutes:1,run:'echo O3-out'});
  r=run(['--shard=1/1'],null,ordY,'order');
  ok('C5 조각 안 순서: 목록 순서 그대로(O1 → O2 → O3) — 무거운 순이 아님',r.status===0&&r.out.indexOf('O1-out')<r.out.indexOf('O2-out')&&r.out.indexOf('O2-out')<r.out.indexOf('O3-out'),r.out.slice(-300));
  const offY=Y({name:'X',run:'npx --yes some-build --dry-run'},{name:'Y',run:'pip install --quiet nothing-here\necho after-pip'});
  r=run(['--serial','--offline'],null,offY,'off');
  ok('C5 --offline: npx 단계 건너뜀(CI에서 확인) · pip 줄 생략 · 요약에 외부 빌드 1개',
     r.status===0&&r.out.includes('CI에서 확인 필요 (offline): X')&&r.out.includes('의존성 설치 생략 (offline): Y')&&r.out.includes('after-pip')&&/PASS 1 CI 검사 단계 · 외부 빌드 1개는 GitHub CI에서 추가 확인 필요/.test(r.out),r.out.slice(-400));
  // 병렬일 때 pip 는 먼저 한 번씩(겹치면 하나) 설치하고 단계에서는 뺀다 — 가짜 pip 가 호출을 기록한다
  const bin=path.join(T,'bin');fs.mkdirSync(bin,{recursive:true});const plog=path.join(T,'pip.log');
  fs.writeFileSync(path.join(bin,'pip'),'#!/usr/bin/env bash\necho "$*" >> "'+plog+'"\n',{mode:0o755});
  const pipY=Y({name:'Q1',run:'pip install --quiet numpy pandas\necho Q1-out'},{name:'Q2',run:'pip install --quiet numpy pandas\necho Q2-out'},{name:'Q3',run:'pip install --quiet lxml\necho Q3-out'});
  r=run(['--parallel=3'],{PATH:bin+path.delimiter+process.env.PATH},pipY,'pip');
  const plines=fs.existsSync(plog)?fs.readFileSync(plog,'utf8').trim().split('\n'):[];
  ok('C5 병렬 pip: 겹치는 줄은 한 번(2줄) · 단계보다 먼저 · 단계 안에서는 다시 안 돈다',
     r.status===0&&plines.length===2&&plines.includes('install --quiet numpy pandas')&&plines.includes('install --quiet lxml')&&r.out.indexOf('[의존성] pip install')<r.out.indexOf('Q1-out')&&['Q1-out','Q2-out','Q3-out'].every(x=>r.out.includes(x)),JSON.stringify(plines)+' '+r.out.slice(0,300));
  // 조각 모드: 조각 밖 단계의 pip 줄까지 전체 합집합을 먼저 한 번(조각마다 같은 환경 — GitHub 첫 실행에서 텐배거 GPT 가 numpy 없이 떨어졌다) · offline 이면 설치 없음
  fs.rmSync(plog,{force:true});
  const shY2=Y({name:'T1',minutes:3,run:'pip install --quiet aaa\necho T1-out'},{name:'T2',run:'pip install --quiet bbb\necho T2-out'},{name:'T3',run:'pip install --quiet aaa\necho T3-out'});
  r=run(['--shard=1/2'],{PATH:bin+path.delimiter+process.env.PATH},shY2,'shardpip');
  const plines2=fs.existsSync(plog)?fs.readFileSync(plog,'utf8').trim().split('\n').sort():[];
  ok('C5 조각 pip: 조각 1/2(T1 만)인데 전체 합집합(aaa·bbb) 2줄을 먼저 · T1 만 돌고 · 단계 안 pip 는 뺌',
     r.status===0&&JSON.stringify(plines2)===JSON.stringify(['install --quiet aaa','install --quiet bbb'])&&r.out.includes('T1-out')&&!r.out.includes('T2-out')&&r.out.indexOf('[의존성] pip install')<r.out.indexOf('T1-out'),JSON.stringify(plines2)+' '+r.out.slice(0,300));
  fs.rmSync(plog,{force:true});
  r=run(['--shard=1/2','--offline'],{PATH:bin+path.delimiter+process.env.PATH},shY2,'shardpip');
  ok('C5 조각 pip offline: 설치 없음(기록 없음) · 생략 안내',r.status===0&&!fs.existsSync(plog)&&r.out.includes('의존성 설치 생략 (offline): T1')&&r.out.includes('T1-out'),r.out.slice(0,300));
  /* ── C6 회귀 연결 ── */
  const reg=fs.readFileSync(path.join(ROOT,'regression-check.js'),'utf8');
  ok('C6 회귀: CI 단계 목록을 check-steps.yml 에서 읽고(check.yml 아님) 이 시험을 돌린다',
     reg.includes("'/.github/check-steps.yml'")&&!reg.includes("workflows/check.yml")&&/check-ci-steps\.cjs/.test(reg));
  console.log('ALL PASS ci steps · '+passed+'건');
}finally{fs.rmSync(T,{recursive:true,force:true});}
