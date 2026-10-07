/* 부동산(클로드) 변이 시험 — node scripts/realestate_claude/mutation_test.cjs
   엔진·수집기를 일부러 옛/틀린 코드로 바꿔 값 시험이 실제로 빨간불을 내는지 본다. 하나라도 살아남으면 실패. */
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..','..');
const ENG=fs.readFileSync(path.join(ROOT,'realestate-claude-engine.js'),'utf8');
const COL=fs.readFileSync(path.join(__dirname,'collect.py'),'utf8');
const TCOL=fs.readFileSync(path.join(__dirname,'test_collect.py'),'utf8');
const APT=fs.readFileSync(path.join(ROOT,'realestate-claude-apt.js'),'utf8');
const CAPT=fs.readFileSync(path.join(__dirname,'collect_apt.py'),'utf8'),TCAPT=fs.readFileSync(path.join(__dirname,'test_collect_apt.py'),'utf8');
const CPRE=fs.readFileSync(path.join(__dirname,'collect_presale.py'),'utf8'),TCPRE=fs.readFileSync(path.join(__dirname,'test_collect_presale.py'),'utf8');
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
  ['지가 잇기에서 분기값이 월간값을 덮음',"const a=at(m,k); v.push(a!=null?a:at(q,k));","const a=at(q,k); v.push(a!=null?a:at(m,k));"],
  ['인허가 누계를 1월에 다시 시작하지 않음',"const m=k-Math.floor(k/12)*12; if(m===0) return a;","const m=k-Math.floor(k/12)*12;"],
  ['앞으로 입주에 이번 달 포함(한 달 밀림)',"const ahead=moveinSum(D,r,t+1,t+12)","const ahead=moveinSum(D,r,t,t+11)"],
  ['구 입주 자료가 끝난 뒤를 모름으로',"const x=at(s,k); return x==null?0:x; }","const x=at(s,k); if(k>lastK(s)) return null; return x==null?0:x; }"],
  ['장기 검증 학습을 1996년 전부터',"universe:['daejeon'],firstRetMin:'1996-01'}","universe:['daejeon']}"],
  ['매수우위 문턱 무시',"if(m==null||mk==null) continue; sc[r]=m; if(mk>=c.th&&m>0&&m>bv){bv=m;best=r;} }","if(m==null||mk==null) continue; sc[r]=m; if(m>0&&m>bv){bv=m;best=r;} }"],
  ['공급 회피 상한 무시',"if(m==null||sp==null) continue; sc[r]=m; if(sp<=c.cap&&m>0&&m>bv){bv=m;best=r;} }","if(m==null||sp==null) continue; sc[r]=m; if(m>0&&m>bv){bv=m;best=r;} }"],
  ['지난 1년 입주에 앞으로 입주를 씀(룩어헤드)',"function supplyPast(D,r,t){ const a=moveinSum(D,r,t-11,t),","function supplyPast(D,r,t){ const a=moveinSum(D,r,t+1,t+12),"],
  ['매수우위 타이밍이 문턱 무시',"const mk=marketOf(D,c.region,t),ok=mk!=null&&mk>=c.th;","const mk=marketOf(D,c.region,t),ok=mk!=null;"],
  ['v1 장부에 v2 후보 섞임',"  if(sv==='rec-wf-1') return c;\n","  \n"],
  ['장부가 제 전략 버전 대신 기본 버전으로 계산',"const SV=(ledger&&ledger.strategyVersion)||o.strategy||STRATEGY_VERSION;","const SV=o.strategy||STRATEGY_VERSION;"]
];
const COL_MUTS=[
  ['지역 이름 검사 없음','            if expect is not None and got != expect:','            if False:'],
  ['한 달 두 행 검사 없음','            if m in out and r.get("DTA_VAL") is not None:','            if False:'],
  ['소급 수정 감지 없음','    changed = [k for k in overlap if not same(fresh[k], old_rows[k])]','    changed = []'],
  ['분기말 달 잘못','    return "%s%02d" % (q[:4], int(q[4:]) * 3)','    return "%s%02d" % (q[:4], int(q[4:]) * 3 - 2)'],
  ['KB 변동률 요약까지 값으로 씀','    for m, v in zip(dates, (row.get("dataList") or [])[:len(dates)]):','    for m, v in zip(dates + ["209901", "209902", "209903"], (row.get("dataList") or [])):'],
  ['KB 지역 이름 검사 없음','    if row.get("지역명") != name:','    if False:'],
  ['KB 입주 연도 합계도 달로 셈','        if len(m) == 6 and r.get("합계") is not None:','        if r.get("합계") is not None:'],
  ['ECOS 항목 이름 검사 없음','            if expect is not None and r.get("ITEM_NAME1") != expect:','            if False:'],
  ['이어 받기 시작 달 건너뜀','    s = ym_add(max(out), 1)\n    while s <= end:\n        e = min(ym_add(s, 4), end)\n        rone_call(stat, where, s, e, out, expect)','    s = ym_add(max(out), 2)\n    while s <= end:\n        e = min(ym_add(s, 4), end)\n        rone_call(stat, where, s, e, out, expect)']
];
const APT_MUTS=[
  ['후보 상승률에 이번 달 시세(룩어헤드)','function momOf(A,id,k,o){ const a=price(A,id,k-1),b=price(A,id,k-1-o.mom);','function momOf(A,id,k,o){ const a=price(A,id,k),b=price(A,id,k-o.mom);'],
  ['매수 금리 필터 없음','if(best&&m.rateUp!=null&&m.rateUp<=0&&best.mom>=o.buyMin){','if(best&&best.mom>=o.buyMin){'],
  ['매수 문턱(+3%) 무시','if(best&&m.rateUp!=null&&m.rateUp<=0&&best.mom>=o.buyMin){','if(best&&m.rateUp!=null&&m.rateUp<=0&&best.mom>0){'],
  ['2년 보유 전 매도','    if(held>=o.minHold){ if(mc!=null&&mc<0)','    if(true){ if(mc!=null&&mc<0)'],
  ['금리 급등 매도 없음',"if(m.rateUp!=null&&m.rateUp>=o.rateUpSell) why.push('rate'); }\n    const px","}\n    const px"],
  ['취득세를 매수 총액에서 뺌','total:px+acq+broker,','total:px+broker,'],
  ['보유세를 안 쌓음','      if(px!=null){ p.hold+=px*o.holdCostYr/12;','      if(px!=null){'],
  ['그때 뉴스에 결정 달 사건 포함','e.k>=k-n&&e.k<=k-1&&regionHit(e,city)','e.k>=k-n&&e.k<=k&&regionHit(e,city)'],
  ['다른 지역 뉴스도 붙임',"function regionHit(e,city){ return e.region==='전국'||e.region==='대전·세종'||e.region===city; }","function regionHit(e,city){ return true; }"],
  ['작은 단지도 후보',"    if(o.minUnits&&(+u.units||0)<o.minUnits) continue;\n    const m=momOf","    const m=momOf"],
  ['갈아타기 없음','  if(!st.pos){\n    const C=candidatesAt(A,k,o)','  if(!st.pos&&!out.closed){\n    const C=candidatesAt(A,k,o)'],
  ['장부를 처음부터 다시 씀',"  const done=L.months.length?ymk(L.months[L.months.length-1].m):ymk(L.startedData);","  const done=ymk(L.startedData); L.months=[];"],
  ['사건 기준 달을 사건 달로',"const a=price(A,u.id,e.k-1),b=price(A,u.id,e.k-1+h);","const a=price(A,u.id,e.k),b=price(A,u.id,e.k+h);"],
  ['예금 이자소득세 무시',"return (d==null?0:d/100)*(1-o.depositTax)/12;","return (d==null?0:d/100)/12;"],
  ['비과세 기준 12억 안 올림',"k<ymk('2021-12')?90000:120000;","90000;"],
  ['장기보유특별공제 없음',"  if(held>=36) taxable*=1-Math.min(0.8,0.08*Math.floor(held/12));","  if(false) taxable*=1;"],
  ['체결을 전달 시세로',"      const px=price(A,best.id,k),q=quote(A,best.id,k)","      const px=price(A,best.id,k-1),q=quote(A,best.id,k)"]
];
const CAPT_MUTS=[
  ['84㎡ 대표 타입을 세대수 대신 첫 타입',"    t84.sort(key=lambda t: (-(t.get(\"세대수\") or 0), t.get(\"면적일련번호\") or 0))","    pass"],
  ['시세 같은 달 두 번 검사 없음','        if m in rows:\n            raise RuntimeError("시세 같은 달 두 번: %s" % m)','        if False:\n            raise RuntimeError("x")'],
  ['단지 이름 검사 없음','    if norm(m.get("단지명")) != norm(c["name"]):','    if False:'],
  ['모든 오류를 자료 없음으로',"        if soft and head.get(\"resultCode\") == \"10500\":","        if True:"],
  ['대단지 문턱 무시','    big = [c for c in allc if c["kind"] in ("아파트", "주상복합") and (c.get("units") or 0) >= MIN_UNITS]','    big = [c for c in allc if c["kind"] in ("아파트", "주상복합")]'],
  ['짝수 건 중앙값을 위쪽 값으로','        med = v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2','        med = v[n // 2]']
];
const CPRE_MUTS=[
  ['청약홈 목록 지역 검사 없음','        if c[0] != area:','        if False:'],
  ['미달을 첫 순위 기준으로','        last[ty] = c[5]','        last.setdefault(ty, c[5])'],
  ['공공분양(결과 없음)을 0:1 로','    if all("접수중" in c[6] for c in rows):','    if False:'],
  ['다른 구 단지도 위치로','        if c.get("gu") != gu:','        if False:']
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
for(const [name,a,b] of APT_MUTS){
  total++;
  const aa=a.replace(/\\n/g,'\n'),bb=b.replace(/\\n/g,'\n');
  if(APT.split(aa).length!==2){ bad.push(name+' (원문 못 찾음)'); console.log('  ✗ 원문 못 찾음: '+name); continue; }
  const f=path.join(tmp,'apt.js'); fs.writeFileSync(f,APT.replace(aa,bb).replace("require('./realestate-claude-engine.js')","require("+JSON.stringify(path.join(ROOT,'realestate-claude-engine.js'))+")"));
  const r=cp.spawnSync(process.execPath,[path.join(ROOT,'scripts','test_realestate_claude_apt.cjs')],{encoding:'utf8',env:Object.assign({},process.env,{REC_APT:f})});
  if(r.status!==0){ killed++; console.log('  ✓ 잡힘: '+name); } else { bad.push(name); console.log('  ✗ 살아남음: '+name); }
}
for(const [muts,src,test,file,tfile] of [[CAPT_MUTS,CAPT,TCAPT,'collect_apt.py','test_collect_apt.py'],[CPRE_MUTS,CPRE,TCPRE,'collect_presale.py','test_collect_presale.py']]){
  for(const [name,a,b] of muts){
    total++;
    const aa=a.replace(/\\n/g,'\n'),bb=b.replace(/\\n/g,'\n');
    if(src.split(aa).length!==2){ bad.push(name+' (원문 못 찾음)'); console.log('  ✗ 원문 못 찾음: '+name); continue; }
    const d=fs.mkdtempSync(path.join(tmp,'c-')); fs.writeFileSync(path.join(d,file),src.replace(aa,bb)); fs.writeFileSync(path.join(d,tfile),test);
    fs.copyFileSync(path.join(__dirname,'collect.py'),path.join(d,'collect.py'));
    const r=cp.spawnSync('python3',['-I',path.join(d,tfile)],{encoding:'utf8'});
    if(r.status!==0){ killed++; console.log('  ✓ 잡힘: '+name); } else { bad.push(name); console.log('  ✗ 살아남음: '+name); }
  }
}
console.log(`\n변이 ${killed}/${total} 잡힘`+(bad.length?' — 살아남음: '+bad.join(', '):''));
process.exit(bad.length?1:0);
