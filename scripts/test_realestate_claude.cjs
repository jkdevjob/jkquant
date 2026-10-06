/* 부동산(클로드) 엔진 값 시험 — node scripts/test_realestate_claude.cjs [series.json]
   합성 자료로 계산을 값으로 확인하고, 실제 자료가 있으면 룩어헤드·장부 일치를 실제 자료로도 본다. */
'use strict';
const fs=require('fs'),path=require('path');
const E=require(process.env.REC_ENGINE||path.join(__dirname,'..','realestate-claude-engine.js'));  // 변이 시험은 REC_ENGINE 으로 바꾼 엔진을 넣는다
let pass=0,fail=0;
function ok(name,cond,detail){ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ '+name+(detail?' — '+detail:''));} }
const near=(a,b,eps)=>Math.abs(a-b)<=(eps||1e-9)*Math.max(1,Math.abs(a),Math.abs(b));

/* ── 합성 자료 ── */
function synth(opt){
  opt=opt||{};
  const start='2003-11',n=opt.n||274,regions=E.UNIVERSE.concat(['daejeon']);
  const S={sale:{},jeonse:{},jratio:{},volume:{},buyOutSeoul:{},buyOutOther:{},macro:{}};
  regions.forEach((r,ri)=>{
    const sv=[],jv=[],vv=[];
    let p=50+ri*3,j=35+ri*2;
    for(let i=0;i<n;i++){
      const cyc=Math.sin((i+ri*7)/18);           // 지역마다 위상이 다른 순환
      p*=1+0.004+0.012*cyc; j*=1+0.003+0.006*Math.sin((i+ri*7-4)/18);
      sv.push(+p.toFixed(4)); jv.push(+j.toFixed(4)); vv.push(Math.round(800+300*cyc+ri*20));
    }
    const s0=r==='sejong'?109:0;                  // 세종은 2012-12 부터
    S.sale[r]={start:E.kym(E.ymk(start)+s0),v:sv.slice(s0)};
    S.jeonse[r]={start:E.kym(E.ymk(start)+s0),v:jv.slice(s0)};
    const v26=E.ymk('2006-01')-E.ymk(start);
    S.volume[r]={start:'2006-01',v:vv.slice(v26)};
    S.buyOutSeoul[r]={start:'2006-01',v:vv.slice(v26).map(x=>Math.round(x*0.05))};
    S.buyOutOther[r]={start:'2006-01',v:vv.slice(v26).map(x=>Math.round(x*0.15))};
    const k12=E.ymk('2012-01')-E.ymk(start);
    S.jratio[r]={start:'2012-01',v:sv.slice(k12).map((x,i)=>+(jv[k12+i]/x*100).toFixed(4))};
  });
  const mk=(st,len,f)=>({start:st,v:Array.from({length:len},(_,i)=>f(i))});
  S.macro.depositRate=mk('1996-01',369,()=>3);
  S.macro.baseRate=mk('1999-05',329,i=>+(3+Math.round(2*Math.sin(i/30)*4)/4).toFixed(2));
  S.macro.cpi=mk('1986-01',489,i=>+(40*Math.pow(1.0025,i)).toFixed(3));
  return {schema:1,regions:Object.fromEntries(regions.map(r=>[r,{label:r}])),series:S};
}
function clone(x){ return JSON.parse(JSON.stringify(x)); }
/* month 이후 값을 망가뜨린다(미래 자료가 바뀌어도 과거 판단은 그대로여야 한다) */
function perturbAfter(doc,month){
  const d=clone(doc),K=E.ymk(month);
  const walk=o=>{ for(const k in o){ const s=o[k]; if(s&&s.start&&Array.isArray(s.v)){ const k0=E.ymk(s.start);
      s.v=s.v.map((x,i)=>(k0+i>K&&x!=null)?+(x*(1+0.3*Math.sin(i*1.7)+0.2)).toFixed(4):x); } else if(s&&typeof s==='object') walk(s); } };
  walk(d.series); return d;
}
function truncateAfter(doc,month){
  const d=clone(doc),K=E.ymk(month);
  const walk=o=>{ for(const k in o){ const s=o[k]; if(s&&s.start&&Array.isArray(s.v)){ const k0=E.ymk(s.start); s.v=s.v.slice(0,Math.max(0,K-k0+1)); } else if(s&&typeof s==='object') walk(s); } };
  walk(d.series); return d;
}

console.log('[부동산 클로드 엔진] 기본 계산');
ok('달 변환 왕복', E.kym(E.ymk('2003-11'))==='2003-11' && E.ymk('2004-01')-E.ymk('2003-12')===1);
{
  const s=E.ser({start:'2020-01',v:[100,110,99,null,121]});
  ok('수익률 값', near(E.ret(s,E.ymk('2020-02')),0.1) && near(E.chg(s,E.ymk('2020-03'),2),-0.01) && E.ret(s,E.ymk('2020-04'))===null);
  ok('k 이하 마지막 값', E.upTo(s,E.ymk('2020-04'))===99 && E.upTo(s,E.ymk('2019-12'))===null);
}
{
  const v=[100,104,108,112,106,100,95,98,103,108,104];
  const pv=E.zigzag(E.ser({start:'2010-01',v}),0.05).map(p=>p.type+':'+p.k%12+':'+p.v);
  ok('사이클 판정: 고점 112(4월)·저점 95(7월)·고점 108(10월) — 5% 되돌림 기준',
     JSON.stringify(pv)===JSON.stringify(['start:0:100','peak:3:112','trough:6:95','peak:9:108','now:10:104']),JSON.stringify(pv));
}

console.log('[부동산 클로드 엔진] 결정 사슬 · 정산');
{
  const T=[{id:'cash',score:.02,inMarket:0},{id:'rebound_0.1',score:.03,inMarket:.05},{id:'mom_3_0',score:.025,inMarket:.6}];
  ok('전략 고르기: 학습 기간 보유 5% 규칙은 점수 1위여도 빼고, 다음 1위(보유 60%)를 고른다', E.pickBest(T).id==='mom_3_0');
  ok('전략 고르기: 동점이면 앞 후보(현금)', E.pickBest([{id:'cash',score:.02,inMarket:0},{id:'mom_3_0',score:.02,inMarket:.5}]).id==='cash');
}
{
  const o=Object.assign({},E.DEFAULTS,{minHold:3}),plan={pos:null,held:0},seq=['a','b','b','c','c','c','c',null,null];
  const got=seq.map(t=>E.planNext(plan,{target:t},o).target);
  ok('최소 보유 3개월: a 를 3개월 지킨 뒤에야 갈아탄다', JSON.stringify(got)===JSON.stringify(['a','a','a','c','c','c','c',null,null]),JSON.stringify(got));
}
{
  const doc=synth(),D=E.prepare(doc),k=E.ymk('2015-06'),o=Object.assign({},E.DEFAULTS,{rent:'none'});
  const acct={nav:1e8,pos:null,fees:0},ev=E.markMonth(acct,D,k,'dj_seo',o);
  const pr=E.ret(D.sale.dj_seo,k),afterBuy=1e8/(1+o.buyCost);
  ok('살 때 수수료 = 자산/(1+매수비용) 차액, 장부에 금액으로 남는다', near(ev.buyFee,1e8-afterBuy,1e-12) && near(ev.fee,ev.buyFee));
  ok('보유 수익 = 가격 + 0 임대 − 보유세/12', near(ev.r,pr-o.holdCostYr/12,1e-12) && near(acct.nav,afterBuy*(1+ev.r),1e-12));
  const ev2=E.markMonth(acct,D,k+1,null,o),dep=3/100*(1-o.depositTax)/12;
  ok('팔 때 수수료 · 현금은 예금금리 세후', near(ev2.sellFee,ev.nav*o.sellCost,1e-12) && near(ev2.r,dep,1e-12)
     && near(acct.nav,ev.nav*(1-o.sellCost)*(1+dep),1e-12));
  ok('장부 수수료 합 = 계좌 수수료 누계', near(acct.fees,ev.fee+ev2.fee,1e-12));
  const o2=Object.assign({},o,{rent:'jeonse'}),y=E.monthYield(D,k,'dj_seo',o2),jr=E.jeonseRatio(D,'dj_seo',k);
  ok('전세환산 임대가치 = 전세가율 × 예금금리(세후) / 12', near(y.rent,jr.v/100*3/100*(1-o.depositTax)/12,1e-12) && jr.est===false);
  const jr0=E.jeonseRatio(D,'dj_seo',E.ymk('2008-03')),k1=E.ymk('2012-01');
  const want=E.at(D.jratio.dj_seo,k1)*(E.at(D.jeonse.dj_seo,E.ymk('2008-03'))/E.at(D.jeonse.dj_seo,k1))/(E.at(D.sale.dj_seo,E.ymk('2008-03'))/E.at(D.sale.dj_seo,k1));
  ok('2012년 전 전세가율은 지수비로 거꾸로 이은 추정(표시)', jr0&&jr0.est===true&&near(jr0.v,want,1e-12));
}

console.log('[부동산 클로드 엔진] 룩어헤드 금지');
function lookaheadCheck(doc,cut,tag){
  const D1=E.prepare(doc),D2=E.prepare(perturbAfter(doc,cut));
  const w1=E.walkForward(D1),w2=E.walkForward(D2),K=E.ymk(cut),lag=E.DEFAULTS.lag;
  const sameSel=w1.years.filter(y=>y*12-lag<=K).every(y=>w2.sel[y]&&w1.sel[y].id===w2.sel[y].id&&near(w1.sel[y].table[0].score,w2.sel[y].table[0].score,1e-12));
  const d1=w1.meta.decisions.filter(x=>E.ymk(x.data)<=K),d2=w2.meta.decisions.filter(x=>E.ymk(x.data)<=K);
  const sameDec=d1.length>0&&d1.length===d2.length&&d1.every((x,i)=>x.target===d2[i].target&&x.cand===d2[i].cand);
  const n1=w1.meta.rows.filter(x=>E.ymk(x.m)<=K),n2=w2.meta.rows.filter(x=>E.ymk(x.m)<=K);
  const sameNav=n1.length===n2.length&&n1.every((x,i)=>near(x.nav,n2[i].nav,1e-12));
  ok(tag+': '+cut+' 뒤 자료를 바꿔도 그때까지의 전략 선택·결정·장부가 같다', sameSel&&sameDec&&sameNav,
     'sel '+sameSel+' dec '+sameDec+'('+d1.length+') nav '+sameNav);
  ok(tag+': 학습 기간 보유 비율이 기준 미만인 규칙은 고르지 않는다', w1.years.every(y=>{ const s=w1.sel[y],t=s.table.find(x=>x.id===s.id); return s.id==='cash'||t.inMarket>=E.DEFAULTS.minInMarket; }));
  return {w1,w2};
}
{
  const doc=synth();
  lookaheadCheck(doc,'2014-05','합성');
  lookaheadCheck(doc,'2019-12','합성');
  const D=E.prepare(doc),w=E.walkForward(D);
  ok('워크포워드: 그해 학습 끝 = 1월 − 2개월(그때 공표된 마지막 달)', w.years.every(y=>w.sel[y].trainTo===E.kym(y*12-E.DEFAULTS.lag)));
  ok('워크포워드: 고른 전략 = 학습 점수 1위', w.years.every(y=>{ const t=w.sel[y].table,b=t.reduce((a,c)=>c.score>a.score+1e-12?c:a); return b.id===w.sel[y].id; }));
  ok('결정은 늘 LAG 개월 전 자료로', w.meta.decisions.every(x=>E.ymk(x.m)-E.ymk(x.data)===E.DEFAULTS.lag));
  ok('워크포워드: 학습 기간 보유 비율이 기준 미만인 규칙은 고르지 않는다(현금 후보 제외)',
     w.years.every(y=>{ const s=w.sel[y],t=s.table.find(x=>x.id===s.id); return s.id==='cash'||t.inMarket>=E.DEFAULTS.minInMarket; }));
  {
    const o=Object.assign({},E.DEFAULTS),f=E.ymk('2010-01'),t=E.ymk('2012-12'),C=E.candidates();
    const cash=E.simulate(D,{from:f,to:t},(d,pos)=>E.desire(D,C.find(c=>c.id==='cash'),d,pos));
    const want=o.capital*Math.pow(1+3/100*(1-o.depositTax)/12,t-f+1);
    ok('현금 후보: 내내 예금 · 평가액 = 원금 × (1+세후 예금이자/12)^개월', cash.rows.every(x=>x.pos===null&&x.fee===0)&&near(cash.stats.end,want,1e-12));
    const hold=E.simulate(D,{from:f,to:t},(d,pos)=>E.desire(D,C.find(c=>c.id==='hold_daejeon'),d,pos));
    ok('대전 보유 후보: 처음 한 번만 사고 내내 대전', hold.rows.every(x=>x.pos==='daejeon')&&hold.stats.trades===1);
  }
  const st=w.meta.stats,rows=w.meta.rows;
  ok('통계: 수수료 합 = 정산 행 수수료 합', near(st.fees,rows.reduce((a,x)=>a+x.fee,0),1e-9));
}

console.log('[부동산 클로드 엔진] 참고 전망 · 지가 잇기');
{
  const D=E.prepare(synth()),o=E.outlook(D),fs=E.factorStudy(D,{h:12});
  const good=o.rows.length>0&&o.rows.every(r=>r.parts.every(x=>{ const f=fs.find(q=>q.id===x.id),bi=x.v<=f.q1?0:x.v<=f.q2?1:2;
      return Math.abs(f.rho)>=0.2&&x.bucket===['낮음','중간','높음'][bi]&&near(x.avg,f.buckets[bi].avg,1e-12); })
    &&near(r.avg,r.parts.reduce((a,x)=>a+x.avg,0)/r.parts.length,1e-12));
  ok('참고 전망: 지금 값이 속한 구간(하위·중위·상위 1/3)의 이후 12개월 평균을 지표별로 단순 평균(|ρ|≥0.2 지표만)', good);
  ok('참고 전망: 평균 높은 순', o.rows.every((r,i)=>i===0||o.rows[i-1].avg>=r.avg));
  const D2=E.prepare({series:{land:{x:{start:'2005-01',v:[60.4,60.5,60.9]}},landQ:{x:{start:'2004-12',v:[60.3,null,null,99]}}}});
  const L=E.landLong(D2,'x');
  ok('지가 잇기: 2005년 전은 분기 값, 겹치는 달은 월간 값', E.kym(L.k0)==='2004-12'&&JSON.stringify(L.v)===JSON.stringify([60.3,60.4,60.5,60.9]),JSON.stringify(L.v));
}

console.log('[부동산 클로드 엔진] 모의장부 — 덧붙이기만 · 백테와 같은 값');
function ledgerCheck(doc,t0,t1,t2,tag){
  const a=E.paperUpdate(null,E.prepare(truncateAfter(doc,t0)),{},'t0').ledger;
  const b=E.paperUpdate(a,E.prepare(truncateAfter(doc,t1)),{},'t1').ledger;
  const c=E.paperUpdate(b,E.prepare(truncateAfter(doc,t2)),{},'t2').ledger;
  const prefix=(x,y)=>x.decisions.every((d,i)=>JSON.stringify(d)===JSON.stringify(y.decisions[i]))&&x.marks.every((m,i)=>JSON.stringify(m)===JSON.stringify(y.marks[i]));
  ok(tag+': 지난 기록은 그대로 두고 새 달만 덧붙인다', prefix(a,b)&&prefix(b,c)&&c.decisions.length>b.decisions.length);
  ok(tag+': 시작 전 달(시작 자료 달+1)은 결정하지 않는다', c.decisions[0].m===E.kym(E.ymk(t0)+E.DEFAULTS.lag)&&c.decisions[0].data===t0);
  /* 같은 기간을 백테(simulate)로 돌린 값과 같아야 한다 */
  const D=E.prepare(truncateAfter(doc,t2)),w=E.walkForward(D);
  const sim=E.simulate(D,{from:E.ymk(t0)+E.DEFAULTS.lag,to:E.ymk(t2)},w.choose);
  const same=c.marks.length===sim.rows.length&&c.marks.every((m,i)=>m.m===sim.rows[i].m&&m.to===sim.rows[i].to&&near(m.nav,sim.rows[i].nav,1e-12));
  ok(tag+': 장부 NAV = 같은 기간 백테 NAV (저장 전 장부 == 저장 후 장부)', same, c.marks.length+' vs '+sim.rows.length);
  const recomputed=c.marks.reduce((nav,m)=>{ let x=nav; if(m.sellFee) x-=m.sellFee; if(m.buyFee) x-=m.buyFee; return x*(1+m.r); },c.capital);
  ok(tag+': 장부만으로 다시 계산한 NAV = 기록된 NAV', near(recomputed,c.acct.nav,1e-9));
  ok(tag+': 기록마다 전략 버전·엔진 버전', c.decisions.every(d=>d.sv===E.STRATEGY_VERSION&&d.ev===E.VERSION));
  return c;
}
ledgerCheck(synth(),'2020-08','2021-03','2022-11','합성');

/* ── 실제 자료 ── */
const real=process.argv[2]||path.join(__dirname,'..','data','realestate','claude','series.json');
if(fs.existsSync(real)){
  console.log('[부동산 클로드 엔진] 실제 자료 '+path.basename(real));
  const doc=JSON.parse(fs.readFileSync(real,'utf8')),D=E.prepare(doc);
  ok('실제 자료: 대전 5구 · 세종 매매지수 있음', E.UNIVERSE.every(r=>D.sale[r]) && D.lastK!=null);
  lookaheadCheck(doc,'2016-06','실제');
  lookaheadCheck(doc,E.kym(D.lastK-14),'실제');
  ledgerCheck(doc,E.kym(D.lastK-30),E.kym(D.lastK-17),E.kym(D.lastK),'실제');
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);
