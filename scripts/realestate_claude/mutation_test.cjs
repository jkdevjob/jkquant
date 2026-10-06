/* 부동산(클로드) 변이 시험 — node scripts/realestate_claude/mutation_test.cjs
   엔진·수집기를 일부러 옛/틀린 코드로 바꿔 값 시험이 실제로 빨간불을 내는지 본다. 하나라도 살아남으면 실패. */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..','..');
const ENG=fs.readFileSync(path.join(ROOT,'realestate-claude-engine.js'),'utf8');
const COL=fs.readFileSync(path.join(__dirname,'collect.py'),'utf8');
const TCOL=fs.readFileSync(path.join(__dirname,'test_collect.py'),'utf8');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rec-mut-'));
const ENGINE_MUTS=[
  ['결정에 한 달 뒤 자료(룩어헤드)','    const d=k-o.lag,ch=choose(d,plan.pos)','    const d=k-o.lag+1,ch=choose(d,plan.pos)'],
  ['워크포워드 학습이 아직 공표 안 된 달까지','    const trainTo=y*12-o.lag; if(trainTo>D.lastK) break;','    const trainTo=y*12-1; if(trainTo>D.lastK) break;'],
  ['최소 보유 무시','  if(plan.pos&&plan.held<o.minHold&&target!==plan.pos){','  if(false&&plan.pos&&plan.held<o.minHold&&target!==plan.pos){'],
  ['매수 수수료를 빼지 않음','    if(target){ const f=acct.nav-acct.nav/(1+o.buyCost); acct.nav-=f;','    if(target){ const f=acct.nav-acct.nav/(1+o.buyCost);'],
  ['매수 수수료를 장부에 안 남김',' ev.fee+=f; ev.buyFee=f; }',' ev.fee+=f; }'],
  ['전세환산 임대가치 빠짐','rent=jr?jr.v/100*netDep/12:0;','rent=0;'],
  ['예금 이자소득세 무시',"netDep=(dep==null?0:dep/100)*(1-o.depositTax);","netDep=(dep==null?0:dep/100);"],
  ['거의 안 산 규칙도 선택',"  const elig=table.filter(t=>t.id==='cash'||t.inMarket>=o.minInMarket);","  const elig=table;"],
  ['장부를 매번 처음부터 다시 씀',"  const added={decisions:0,marks:0};","  const added={decisions:0,marks:0}; L.decisions=[];L.marks=[];L.plan={pos:null,held:0};L.acct={nav:L.capital,pos:null,fees:0};"],
  ['2012년 전 전세가율 추정 방향 뒤집힘','return {v:v1*(a/a1)/(b/b1),est:true};','return {v:v1*(b/b1)/(a/a1),est:true};'],
  ['참고 전망 구간 뒤집힘',"const bi=v<=f.q1?0:v<=f.q2?1:2,b=f.buckets[bi];","const bi=v<=f.q1?2:v<=f.q2?1:0,b=f.buckets[bi];"],
  ['사이클 되돌림 폭 무시',"else if(v<=hV*(1-th)){ piv.push({k:hK,v:hV,type:'peak'}); mode=-1; hK=k; hV=v; }","else if(v<hV){ piv.push({k:hK,v:hV,type:'peak'}); mode=-1; hK=k; hV=v; }"],
  ['지가 잇기에서 분기값이 월간값을 덮음',"const a=at(m,k); v.push(a!=null?a:at(q,k));","const a=at(q,k); v.push(a!=null?a:at(m,k));"]
];
const COL_MUTS=[
  ['지역 이름 검사 없음','            if expect is not None and got != expect:','            if False:'],
  ['한 달 두 행 검사 없음','            if m in out and r.get("DTA_VAL") is not None:','            if False:'],
  ['소급 수정 감지 없음','    changed = [k for k in overlap if not same(fresh[k], old_rows[k])]','    changed = []'],
  ['분기말 달 잘못','    return "%s%02d" % (q[:4], int(q[4:]) * 3)','    return "%s%02d" % (q[:4], int(q[4:]) * 3 - 2)'],
  ['이어 받기 시작 달 건너뜀','    s = ym_add(max(out), 1)\n    while s <= end:\n        e = min(ym_add(s, 4), end)\n        rone_call(stat, where, s, e, out, expect)','    s = ym_add(max(out), 2)\n    while s <= end:\n        e = min(ym_add(s, 4), end)\n        rone_call(stat, where, s, e, out, expect)']
];
let killed=0,total=0,bad=[];
for(const [name,a,b] of ENGINE_MUTS){
  total++;
  if(ENG.split(a).length!==2){ bad.push(name+' (원문 못 찾음)'); continue; }
  const f=path.join(tmp,'engine.js'); fs.writeFileSync(f,ENG.replace(a,b));
  const r=cp.spawnSync(process.execPath,[path.join(ROOT,'scripts','test_realestate_claude.cjs')],{encoding:'utf8',env:Object.assign({},process.env,{REC_ENGINE:f})});
  if(r.status!==0){ killed++; console.log('  ✓ 잡힘: '+name); } else { bad.push(name); console.log('  ✗ 살아남음: '+name); }
}
for(const [name,a,b] of COL_MUTS){
  total++;
  if(COL.split(a).length!==2){ bad.push(name+' (원문 못 찾음)'); continue; }
  const d=fs.mkdtempSync(path.join(tmp,'col-')); fs.writeFileSync(path.join(d,'collect.py'),COL.replace(a,b)); fs.writeFileSync(path.join(d,'test_collect.py'),TCOL);
  const r=cp.spawnSync('python3',['-I',path.join(d,'test_collect.py')],{encoding:'utf8'});
  if(r.status!==0){ killed++; console.log('  ✓ 잡힘: '+name); } else { bad.push(name); console.log('  ✗ 살아남음: '+name); }
}
console.log(`\n변이 ${killed}/${total} 잡힘`+(bad.length?' — 살아남음: '+bad.join(', '):''));
process.exit(bad.length?1:0);
