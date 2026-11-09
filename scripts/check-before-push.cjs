'use strict';
// 검사 단계 목록은 .github/check-steps.yml 한 곳 — GitHub 검증(check.yml 조각 N개)과 이 스크립트가 같은 목록·같은 명령으로 돈다.
// 사용:
//   node scripts/check-before-push.cjs                 전체 · 병렬(코어 수만큼 · 최대 8) · 무거운 단계부터
//   node scripts/check-before-push.cjs --serial        전체 · 목록 순서대로 하나씩(옛 방식)
//   node scripts/check-before-push.cjs --parallel=3    일꾼 수 지정
//   node scripts/check-before-push.cjs --shard=2/4     GitHub 조각 2/4 와 같은 부분집합(하나씩)
//   node scripts/check-before-push.cjs --only=회귀     이름이 정규식에 맞는 단계만
//   node scripts/check-before-push.cjs --list          단계 · 예상 분 · 조각 배정(--parts=N · 기본 4)만 보여 준다
//   --offline     npx(외부 빌드) 건너뜀 · pip install 생략 — 개발 중에만. 생략한 것은 GitHub 검증으로 확인한다.
//   --keep-going  빨간불이 나도 남은 단계를 끝까지 돈다(기본은 바로 멈추고 도는 단계를 끊는다)
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('node:child_process');
const root=path.join(__dirname,'..');
const DEFAULT_MINUTES=0.5;

function parseSteps(text){
  const lines=text.split(/\r?\n/),steps=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const n=line.match(/^- name: (.+)$/);
    if(n){steps.push({index:steps.length,name:n[1].trim(),command:'',minutes:DEFAULT_MINUTES});continue;}
    if(!line.trim()||/^#/.test(line))continue;
    const cur=steps[steps.length-1];
    if(!cur)throw Error('단계(- name:) 앞에 올 수 없는 줄 '+(i+1)+': '+line);
    const r=line.match(/^  run: (.*)$/);
    if(r){
      let command=r[1];
      if(command==='|'){
        const block=[];
        while(i+1<lines.length&&(/^    /.test(lines[i+1])||!lines[i+1].trim()))block.push(lines[++i].slice(4));
        command=block.join('\n').trimEnd();
      }
      if(cur.command)throw Error('run 이 두 번: '+cur.name);
      cur.command=command;continue;
    }
    const m=line.match(/^  minutes: ([0-9]*\.?[0-9]+)$/);
    if(m){cur.minutes=+m[1];continue;}
    throw Error('알 수 없는 줄 '+(i+1)+': '+line);
  }
  if(!steps.length)throw Error('검사 단계를 찾지 못했습니다.');
  const seen=new Set();
  for(const s of steps){
    if(!s.command)throw Error('run 이 없는 단계: '+s.name);
    if(seen.has(s.name))throw Error('이름이 겹치는 단계: '+s.name);seen.add(s.name);
    if(/\$\{\{/.test(s.command))throw Error('CI expression을 포함한 run은 로컬 환경 매핑 필요: '+s.name);
    if(!(s.minutes>0))throw Error('minutes 는 0보다 커야 한다: '+s.name);
  }
  return steps;
}
// 조각 배정: 무거운 단계부터 가장 덜 찬 조각에(LPT). 같은 목록이면 늘 같은 배정. 조각 안에서는 목록 순서.
function assignShards(steps,n){
  if(!(n>=1))throw Error('조각 수는 1 이상이어야 합니다: '+n);
  const load=Array(n).fill(0),part=steps.map(()=>0);
  const order=steps.map((s,i)=>i).sort((a,b)=>steps[b].minutes-steps[a].minutes||a-b);
  for(const i of order){let k=0;for(let j=1;j<n;j++)if(load[j]<load[k])k=j;part[i]=k+1;load[k]+=steps[i].minutes;}
  return {part,load};
}
function parseShard(spec){
  const m=/^(\d+)\/(\d+)$/.exec(String(spec));
  if(!m||+m[1]<1||+m[2]<1||+m[1]>+m[2])throw Error('--shard=k/n 형식(1≤k≤n)이어야 합니다: '+spec);
  return {k:+m[1],n:+m[2]};
}
function pipLines(command){return command.match(/^\s*pip install[^\n]*$/gm)||[];}
function stripPip(command){return command.replace(/^\s*pip install[^\n]*\n?/gm,'').trim();}
function fmt(ms){const s=Math.round(ms/1000);return Math.floor(s/60)+'분 '+String(s%60).padStart(2,'0')+'초';}

const running=new Set();
function spawnStep(command,capture){
  return new Promise(resolve=>{
    const t0=Date.now();let out='',done=false;
    const child=cp.spawn('bash',['-e','-o','pipefail','-c',command],{cwd:root,env:process.env,stdio:capture?['ignore','pipe','pipe']:'inherit',detached:capture});
    if(capture){child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});}
    running.add(child);
    const finish=r=>{if(done)return;done=true;running.delete(child);resolve(Object.assign({ms:Date.now()-t0,out},r));};
    child.on('error',e=>finish({ok:false,code:null,signal:null,error:e.message}));
    child.on('close',(code,signal)=>finish({ok:code===0,code,signal}));
  });
}
function killRunning(){for(const c of running){try{process.kill(-c.pid,'SIGTERM');}catch(e){try{c.kill('SIGTERM');}catch(e2){}}}}
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{killRunning();process.exit(130);});

async function main(){
  const ARGS=process.argv.slice(2);
  const flag=n=>{const a=ARGS.find(x=>x===n||x.startsWith(n+'='));return a===undefined?undefined:(a.includes('=')?a.slice(a.indexOf('=')+1):true);};
  const manifest=typeof flag('--manifest')==='string'?path.resolve(flag('--manifest')):path.join(root,'.github/check-steps.yml');
  const steps=parseSteps(fs.readFileSync(manifest,'utf8'));
  const offline=ARGS.includes('--offline'),keepGoing=ARGS.includes('--keep-going'),ci=!!process.env.GITHUB_ACTIONS;
  const shard=typeof flag('--shard')==='string'?parseShard(flag('--shard')):null;
  const only=typeof flag('--only')==='string'?new RegExp(flag('--only')):null;
  if(flag('--list')!==undefined){
    const parts=typeof flag('--parts')==='string'?+flag('--parts'):(shard?shard.n:4);
    const {part,load}=assignShards(steps,parts);
    steps.forEach((s,i)=>console.log(String(i+1).padStart(2)+'  조각 '+part[i]+'  '+String(s.minutes).padStart(4)+'분  '+s.name));
    console.log('\n조각별 예상 분: '+load.map((x,i)=>(i+1)+': '+x.toFixed(1)).join(' · ')+' (단계 '+steps.length+'개)');
    return 0;
  }
  let selected=steps;
  if(shard){const {part}=assignShards(steps,shard.n);selected=steps.filter((s,i)=>part[i]===shard.k);}
  if(only){selected=selected.filter(s=>only.test(s.name));if(!selected.length)throw Error('--only 에 맞는 단계가 없습니다.');}
  const cores=Math.min(8,os.availableParallelism?os.availableParallelism():os.cpus().length);
  const p=flag('--parallel');
  let workers=ARGS.includes('--serial')?1:p===undefined?(shard?1:cores):(typeof p==='string'?Math.max(1,parseInt(p,10)||1):cores);
  workers=Math.max(1,Math.min(workers,selected.length));
  // 계획: 돌릴 단계 · 건너뛸 단계(offline npx) · pip 줄(병렬이면 먼저 한 번씩 설치하고 단계에서는 뺀다)
  const plan=[];let external=0;
  for(const s of selected){
    if(offline&&/\bnpx\b/.test(s.command)){console.log('CI에서 확인 필요 (offline): '+s.name);external++;continue;}
    let command=s.command;
    if(offline&&pipLines(command).length){command=stripPip(command);console.log('의존성 설치 생략 (offline): '+s.name);}
    plan.push({step:s,command});
  }
  const t0=Date.now(),total=plan.length;let passed=0,stopped=false;const failed=[];
  if(workers>1){
    const pips=[...new Set(plan.flatMap(x=>pipLines(x.command).map(l=>l.trim())))];
    for(const line of pips){
      console.log('\n[의존성] '+line);
      const r=await spawnStep(line,false);
      if(!r.ok){console.error('FAIL 의존성 설치 — '+line);return r.code||1;}
    }
    if(pips.length)for(const x of plan)x.command=stripPip(x.command);
  }
  if(workers===1){
    for(let i=0;i<plan.length;i++){
      const {step,command}=plan[i];
      console.log(ci?'::group::['+(i+1)+'/'+total+'] '+step.name:'\n['+(i+1)+'/'+total+'] '+step.name);
      const r=await spawnStep(command,false);
      if(ci)console.log('::endgroup::');
      if(!r.ok){
        console.error('FAIL '+step.name+(r.error?' — '+r.error:'')+' ('+fmt(r.ms)+')');
        if(ci)console.log('::error title=검사 실패::'+step.name);
        failed.push(step.name);if(!keepGoing)return r.code||1;continue;
      }
      passed++;console.log('PASS '+step.name+' ('+fmt(r.ms)+')');
    }
  }else{
    console.log('병렬 '+workers+' · 단계 '+total+'개 · 무거운 것부터');
    const queue=plan.slice().sort((a,b)=>b.step.minutes-a.step.minutes||a.step.index-b.step.index);
    const durations=[];let doneCount=0;
    const worker=async()=>{
      while(queue.length&&!stopped){
        const {step,command}=queue.shift();
        const r=await spawnStep(command,true);
        if(stopped&&!r.ok&&r.signal)return; // 빨간불 뒤에 끊은 단계
        durations.push({name:step.name,ms:r.ms});doneCount++;
        console.log('\n['+doneCount+'/'+total+(r.ok?' ✓ ':' ✗ ')+fmt(r.ms)+'] '+step.name+(r.out.trim()?'\n'+r.out.trimEnd():''));
        if(r.ok){passed++;continue;}
        failed.push(step.name);console.error('FAIL '+step.name+(r.error?' — '+r.error:''));
        if(!keepGoing){stopped=true;killRunning();}
      }
    };
    await Promise.all(Array.from({length:workers},worker));
    durations.sort((a,b)=>b.ms-a.ms);
    if(durations.length)console.log('\n가장 오래 걸린 단계: '+durations.slice(0,5).map(d=>d.name+' '+fmt(d.ms)).join(' · '));
  }
  const elapsed=fmt(Date.now()-t0),scope=shard?' (조각 '+shard.k+'/'+shard.n+')':only?' (일부 · --only)':'';
  if(failed.length){console.error('\nFAIL '+failed.length+'개 — '+failed.join(' / ')+' · '+elapsed+(stopped?' · 남은 단계는 돌리지 않음':''));return 1;}
  console.log('\nPASS '+passed+' CI 검사 단계'+scope+(external?' · 외부 빌드 '+external+'개는 GitHub CI에서 추가 확인 필요':scope?'':' — 전체 검증 완료')+' · '+elapsed+(workers>1?' · 병렬 '+workers:''));
  return 0;
}
if(require.main===module)main().then(code=>process.exit(code),e=>{console.error(e&&e.stack||e);process.exit(1);});
else module.exports={parseSteps,assignShards,parseShard,pipLines,stripPip,DEFAULT_MINUTES};
