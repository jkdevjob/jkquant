#!/usr/bin/env node
'use strict';
/* 듀얼가드 v1.1 '공포 모드' — 실험적 확장 · 모의 세션 선택지 (앱 v3.128.0 · 듀얼가드 v2.6.0 · 2026-11-10 사용자 승인 "그래 하자")
 * 규칙: VIX 전일 종가 ≥ 40 무장 → < 35 진정 · ① Guard OFF 이고 TQQQ > SMA50×1.02 면 빠른 모드 ON(SMA50 ±2% · SMA225 +1% 위면 보통 복귀)
 *       ② 진정 뒤 TECL σ20 > 3×VXN 인 동안 목표 σ = min(σ20, 3×VXN). 그 밖은 기본 규칙 그대로. 판정은 전일 확정값만.
 * 근거·재현: research/daily research/im_plan RESEARCH_LOG.md 11-10 · REPLICATION.md R-20261110-1(지피티 재현 확인 · 연구 기준 구현과 516회 재생 장부 일치는 TEST_RESULTS).
 * 실제 파일의 함수를 그대로 돌려 값으로 확인하고, 고친 곳을 되돌린 변이가 빨간불인지 본다.
 *  A panicStep 판정표 — 무장·진정·빠른 모드·중립 유지·보통 복귀·슬리브 min·시작 상태·무장 없으면 안 켜짐
 *  B replay(합성 시세) — 기본 규칙 결과는 글자까지 그대로 · 공포 모드는 정해진 날에만 다른 주문 · VIX 없으면 오류 · 룩어헤드 없음 · 화면용 next
 *  C 세션 설정 — 모의일 때만 panic 저장 · 운영은 늘 base
 *  D 화면(plan.html) — 선택 줄 · 이름 · 상태 카드 · 다음 주문 판정이 엔진 next 를 따른다 / 모의 목록(index.html) — 이름 · VIX 없으면 줄 비움
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
const READ=f=>fs.readFileSync(path.join(root,f),'utf8');
const SRC={eng:READ('plan-session-engine.js'),set:READ('plan-session-settings.js'),plan:READ('plan.html'),idx:READ('index.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('함수 없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const constOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('상수 없음: '+marker);const e=src.indexOf(';',s);return src.slice(s,e+1);};
const loadEngine=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionEngine;};
const loadSettings=js=>{const c={};vm.runInNewContext(js,c);return c.JKPlanSessionSettings;};

// ── 합성 시세 — 평일 700일. TQQQ: 오름(0~399) → 급락(400~429 · −45%) → V 반등(430~) · TECL 도 같은 모양(급락 때 σ20 급등)
//    VIX: 평소 18 · 급락 중 최고 55 · 반등 5일째(434)부터 32(진정 — TECL σ20 은 아직 높아 재가속이 켜진다) · 475 부터 20 / VXN: VIX×0.6(3×VXN 이 σ20 보다 훨씬 낮아 재가속이 TECL 주문을 바꾼다)
const D=[];for(let t=new Date('2022-01-03T00:00:00Z');D.length<700;t.setUTCDate(t.getUTCDate()+1)){const w=t.getUTCDay();if(w&&w<6)D.push(t.toISOString().slice(0,10));}
const path_=(k)=>k<400?Math.pow(1.0012,k):k<430?Math.pow(1.0012,400)*Math.pow(0.9803,k-399):Math.pow(1.0012,400)*Math.pow(0.9803,30)*Math.pow(1.0085,k-429);
const wig=(k,a)=>1+a*((k*7919)%13-6)/6;   // 결정적 잔물결
const TQ=D.map((date,k)=>({date,close:+(40*path_(k)*wig(k,.004)).toFixed(4)}));
const TE=D.map((date,k)=>({date,close:+(30*path_(k)*wig(k,k>=400&&k<432?.09:.012)).toFixed(4)}));
const SG=D.map((date,k)=>({date,close:+(100*Math.pow(1.00012,k)).toFixed(4)}));
const vixOf=k=>k<402?18:k<434?(k<412?42:55):k<475?32:20;
const VIX=D.map((date,k)=>({date,close:vixOf(k)})),VXN=VIX.map(x=>({date:x.date,close:+(x.close*.6).toFixed(2)}));
const OPT=(over)=>Object.assign({horizon:5,startDate:D[260],endDate:D[699],principal:20000,monthlyAdd:0,tecl:TE,tqqq:TQ,sgov:SG},over||{});
const trades=R=>R.ledger.events.filter(e=>e.type==='trade');
const tq=R=>Array.from(trades(R)).filter(e=>e.symbol==='TQQQ').map(e=>e.date+(e.side==='buy'?' 매수':' 매도'));   // Array.from — vm 영역 배열을 이쪽 배열로(deepEqual 은 원형까지 본다)

function check(S){
  const E=loadEngine(S.eng),ST=loadSettings(S.set),PR=E.ALPHA_RULES.panic;
  // ── A panicStep ──
  { assert.equal(E.alphaRules('panic').key,'panic');assert.equal(E.alphaRules('exp1').key,'base');assert.equal(E.alphaRules().key,'base');
    assert.deepEqual(JSON.parse(JSON.stringify(PR.panic)),{hi:40,lo:35,ma:50,band:.02,k:3,fbK:3.6},'A0 값');
    assert.equal(PR.guardOn,.01);assert.equal(PR.guardOff,.01);assert.equal(PR.bandDn,.10);assert.equal(PR.bandUp,.10);assert.equal(PR.exp,true);
    assert.equal(E.strategyLabel('base'),'듀얼가드 v1.0','A0 기본 이름');assert.equal(E.strategyLabel('panic'),'듀얼가드 v1.1 공포 모드(실험)','A0 공포 이름');assert.equal(E.strategyLabel('exp2'),'듀얼가드 v1.0');
    const step=(st,o)=>E.panicStep(st,Object.assign({rules:PR,vix:20,vxn:22,tqqqClose:90,sma:100,fast:80,sigma:.5,posOn:false},o));
    let st=E.panicState();assert.deepEqual(JSON.parse(JSON.stringify(st)),{armed:false,pf:false,armS:false,ps:false,gN:false},'A1 시작 상태');
    // 시작: 중립 밴드(SMA225 ±1% 안)·빈 계좌 = OFF(기본과 같다) · +1% 넘으면 ON
    assert.equal(step(E.panicState(),{tqqqClose:100.5}).guard,'OFF','A1 중립 시작 = OFF');
    assert.equal(step(E.panicState(),{tqqqClose:101.1}).guard,'ON','A1 +1% 초과 = ON');
    // 무장 없이 VIX 낮고 가격 > SMA50×1.02 여도 안 켜진다(통제)
    st=E.panicState();let r=step(st,{vix:30,tqqqClose:90,fast:80});assert.equal(r.guard,'OFF','A2 무장 없으면 OFF');assert.equal(st.pf,false);
    // 무장: VIX 40 은 무장(≥) · 39.99 는 아님
    st=E.panicState();r=step(st,{vix:39.99});assert.equal(st.armed,false,'A3 39.99 무장 아님');
    r=step(st,{vix:40});assert.equal(st.armed,true,'A3 40 무장');assert.ok(r.events.includes('armed'));assert.equal(r.guard,'OFF');
    // 무장 중 VIX 35 는 진정 아님(<) · 34.99 + 가격 > SMA50×1.02 → 빠른 모드 ON
    r=step(st,{vix:35,tqqqClose:90,fast:80});assert.equal(r.guard,'OFF','A4 35 는 진정 아님');assert.equal(st.pf,false);
    r=step(st,{vix:34.99,tqqqClose:81.6,fast:80});assert.equal(r.guard,'OFF','A4 SMA50×1.02 는 초과가 아님');
    r=step(st,{vix:34.99,tqqqClose:81.7,fast:80});assert.equal(r.guard,'ON','A4 진정 + SMA50 +2% 초과 → ON');assert.equal(st.pf,true);assert.ok(r.events.includes('fastOn'));
    // 빠른 모드: 중립(SMA50 ±2%)에선 보유 상태 유지 · −2% 아래 OFF · 다시 +2% 위 ON
    assert.equal(step(st,{tqqqClose:80,fast:80,posOn:true}).guard,'ON','A5 중립 · 보유 중 = 유지');
    assert.equal(step(st,{tqqqClose:80,fast:80,posOn:false}).guard,'OFF','A5 중립 · 미보유 = 유지');
    assert.equal(step(st,{tqqqClose:78.3,fast:80,posOn:true}).guard,'OFF','A5 SMA50 −2% 미만 OFF');assert.equal(st.pf,true,'A5 빠른 모드는 남는다');
    assert.equal(step(st,{tqqqClose:81.7,fast:80,posOn:false}).guard,'ON','A5 다시 ON');
    // 보통 복귀: SMA225 +1% 위 → 빠른 모드·무장 해제
    r=step(st,{tqqqClose:101.1,fast:80,posOn:true});assert.equal(r.guard,'ON');assert.equal(st.pf,false,'A6 복귀');assert.equal(st.armed,false);assert.ok(r.events.includes('normal'));
    // 복귀 뒤 SMA225 −1% 아래 → 보통 OFF(무장이 풀려 빠른 모드로 다시 안 켜진다)
    r=step(st,{tqqqClose:98.9,fast:80,vix:20});assert.equal(r.guard,'OFF','A6 보통 OFF');assert.equal(step(st,{tqqqClose:98.9,fast:80,vix:20}).guard,'OFF');
    // 슬리브: 진정 뒤 σ20 > 3×VXN 이면 min · σ20 ≤ 3×VXN 이면 끝 · VXN 없으면 3.6×VIX
    st=E.panicState();step(st,{vix:45,sigma:1.5});r=step(st,{vix:30,vxn:33,sigma:1.5});
    assert.equal(st.ps,true,'A7 슬리브 켜짐');assert.ok(Math.abs(r.sigma-.99)<1e-12,'A7 σ = 3×VXN/100');assert.ok(r.events.includes('sleeveOn'));
    r=step(st,{vix:30,vxn:null,sigma:1.5});assert.ok(Math.abs(r.sigma-1.08)<1e-12,'A7 VXN 없으면 3.6×VIX/100');
    r=step(st,{vix:30,vxn:33,sigma:.9});assert.equal(st.ps,false,'A7 σ20 ≤ 3×VXN 이면 끝');assert.equal(r.sigma,.9);assert.ok(r.events.includes('sleeveOff'));
    r=step(st,{vix:30,vxn:20,sigma:1.5});assert.equal(r.sigma,1.5,'A7 끝난 뒤엔 σ20 그대로(다시 무장 전까지)');
    st=E.panicState();r=step(st,{vix:30,vxn:20,sigma:1.5});assert.equal(r.sigma,1.5,'A7 무장 없으면 σ20 그대로');
  }
  // ── B replay ──
  const base=E.replay(OPT()),baseR=E.replay(OPT({rules:'base',vix:VIX,vxn:VXN})),pan=E.replay(OPT({rules:'panic',vix:VIX,vxn:VXN}));
  { assert.equal(base.error,'');assert.equal(pan.error,'');
    assert.equal(JSON.stringify(base),JSON.stringify(baseR),'B1 기본 규칙은 VIX 를 줘도 그대로');assert.equal('panic' in base,false,'B1 기본 결과에 panic 칸 없음');
    assert.equal(base.rules,'base');assert.equal(pan.rules,'panic');
    // 합성 시세의 정해진 값(고정) — 기본: Guard 가 급락에 나가 SMA225 +1% 회복 때 돌아온다 · 공포: 진정(VIX 32) 뒤 SMA50 +2% 넘는 날 먼저 돌아온다
    const bq=tq(base),pq=tq(pan);
    assert.deepEqual(bq,EXPECT.baseTq,'B2 기본 TQQQ 매매일');assert.deepEqual(pq,EXPECT.panTq,'B2 공포 TQQQ 매매일');
    const log=Array.from(pan.panic.log).map(l=>l.date+' '+l.ev);assert.deepEqual(log,EXPECT.log,'B2 전환 기록');
    assert.ok(Math.abs(base.stats.total-EXPECT.baseTotal)<.01,'B2 기본 끝 평가액 '+base.stats.total);assert.ok(Math.abs(pan.stats.total-EXPECT.panTotal)<.01,'B2 공포 끝 평가액 '+pan.stats.total);
    assert.ok(pan.stats.total>base.stats.total,'B2 이 V자 합성에선 공포 모드가 더 번다');
    // 전환 기록의 판정일은 체결일 전 거래일(전일 확정값)
    for(const l of pan.panic.log){assert.equal(D[D.indexOf(l.date)-1],l.signalDate,'B3 판정 = 전 거래일');}
    // 룩어헤드 없음: 체결 당일(=빠른 모드 ON 날)의 VIX·VXN 을 바꿔도 그날 주문은 같다
    const onDay=pan.panic.log.find(l=>l.ev==='fastOn').date,V2=VIX.map(x=>x.date===onDay?{date:x.date,close:99}:x),X2=VXN.map(x=>x.date===onDay?{date:x.date,close:.01}:x);
    const pan2=E.replay(OPT({rules:'panic',vix:V2,vxn:X2,endDate:onDay})),pan1=E.replay(OPT({rules:'panic',vix:VIX,vxn:VXN,endDate:onDay}));
    assert.equal(JSON.stringify(pan2.ledger),JSON.stringify(pan1.ledger),'B4 당일 VIX 를 바꿔도 그날까지 장부 같음');
    // VIX 없으면 기본으로 몰래 계산하지 않는다
    for(const o of [{},{vix:[]},{vix:null,vxn:VXN}]){const r=E.replay(OPT(Object.assign({rules:'panic'},o)));assert.equal(r.error,'공포 모드 — VIX 시세 없음','B5');assert.equal(r.stats,null);assert.equal(r.nav.length,0);}
    // 무장이 한 번도 없으면(VIX 늘 20) 공포 모드 = 기본 장부
    const calm=E.replay(OPT({rules:'panic',vix:VIX.map(x=>({date:x.date,close:20})),vxn:VXN}));
    assert.equal(JSON.stringify(calm.ledger),JSON.stringify(base.ledger),'B6 무장 없으면 기본과 같은 장부');assert.equal(JSON.stringify(calm.nav),JSON.stringify(base.nav));assert.equal(calm.panic.log.length,0);
    // 화면용 next: 자료를 빠른 모드 한가운데서 끊으면 상태·다음 판정이 나온다
    const mid=E.replay(OPT({rules:'panic',vix:VIX,vxn:VXN,endDate:EXPECT.midDate}));
    assert.equal(mid.panic.signalDate,EXPECT.midDate);assert.equal(mid.panic.state.pf,true,'B7 빠른 모드 상태');assert.equal(mid.panic.next.guard,'ON','B7 다음 판정 ON');
    assert.ok(mid.panic.next.sigma<=mid.panic.next.sigma20);assert.deepEqual(JSON.parse(JSON.stringify(mid.panic.params)),{hi:40,lo:35,ma:50,band:.02,k:3,fbK:3.6});
    const midBase=E.replay(OPT({endDate:EXPECT.midDate}));assert.equal(midBase.last.tqqq,0,'B7 같은 날 기본은 TQQQ 없음');assert.ok(mid.last.tqqq>0,'B7 공포는 TQQQ 보유');
    // 폐지 규칙은 여전히 거절
    assert.match(E.replay(OPT({rules:'exp1'})).error,/폐지/);assert.equal(E.retiredReason({horizon:5,settings:{alphaRules:'panic'}}),'','B8 공포 모드는 폐지 아님');
  }
  // ── C 세션 설정 ──
  { const seed={id:'s1',horizon:5,paper:false,settings:{startCapital:20000,monthlyAdd:0,targetCapital:150000,startDate:'2026-01-02',alphaRules:'base'},ledger:null};
    const inp=o=>Object.assign({paper:true,name:'t',capital:20000,monthly:0,target:150000,start:'2026-01-02',rules:'panic'},o),O={today:'2026-11-10',minStart:'2023-11-10',fx:1400};
    assert.equal(ST.update(seed,inp(),O).settings.alphaRules,'panic','C1 모의 + panic');
    assert.equal(ST.update(seed,inp({rules:'base'}),O).settings.alphaRules,'base','C1 모의 + base');
    assert.equal(ST.update(seed,inp({rules:undefined}),O).settings.alphaRules,'base','C1 안 주면 base');
    assert.equal(ST.update(seed,inp({rules:'exp1'}),O).settings.alphaRules,'base','C1 다른 값은 base');
    assert.equal(ST.update(seed,inp({paper:false}),O).settings.alphaRules,'base','C2 운영 세션은 panic 을 줘도 base');
    const p=ST.update(seed,inp(),O);assert.equal(ST.update(p,inp({paper:false,rules:'panic'}),O).settings.alphaRules,'base','C2 모의 → 운영으로 바꾸면 base');
  }
  // ── D 화면 ──
  { const P=S.plan,X=S.idx;
    assert.match(P,/id="assetSessionPanicRow"[^>]*display:none[^>]*><input type="checkbox" id="assetSessionPanic">/,'D1 선택 줄(처음엔 숨김)');
    assert.match(P,/실험적 확장\(공식 규칙 아님\)/,'D1 실험 표시');assert.match(P,/휩쏘로 잃을 수 있다/,'D1 위험 표시');
    const c={window:{JKPlanSessionEngine:E},usd2:x=>'$'+(+x).toFixed(2),assetPaperCache:{},_act:null,activeAssetSession(){return c._act;}};vm.createContext(c);
    for(const m of ['function planStrategy()','function planStrategyLabel()','function assetRulesOf(x)','function planStrategyLabelOf(x)','function assetPanicHtml(R)','function assetPaperStatsHtml(x,R)','function alphaPanicNext(signalDate)'])vm.runInContext(fnOf(P,m),c);
    vm.runInContext(constOf(P,'const PANIC_EV='),c);
    const run=s=>vm.runInContext(s,c);
    c.sp={id:'p1',paper:true,name:'공포',settings:{alphaRules:'panic'}};c.sb={id:'b1',paper:true,name:'기본',settings:{alphaRules:'base'}};c.sl={id:'l1',paper:false,settings:{alphaRules:'panic'}};
    assert.equal(run('assetRulesOf(sp)'),'panic');assert.equal(run('assetRulesOf(sb)'),'base');assert.equal(run('assetRulesOf(sl)'),'base','D2 운영 세션은 panic 이 적혀 있어도 base');assert.equal(run('assetRulesOf(null)'),'base');
    assert.equal(run('planStrategyLabelOf(sp)'),'듀얼가드 v1.1 공포 모드(실험)');assert.equal(run('planStrategyLabelOf(sb)'),'듀얼가드 v1.0');
    c.Rp=pan;c.Rb=base;
    const hp=run('assetPaperStatsHtml(sp,Rp)'),hb=run('assetPaperStatsHtml(sb,Rb)');
    assert.match(hp,/듀얼가드 v1\.1 공포 모드\(실험\)/,'D3 공포 세션 머리');assert.match(hp,/id="assetPanicCard"/);assert.match(hp,/공식 규칙이 아닙니다/);assert.match(hp,/휩쏘로 잃습니다/);
    assert.match(hp,/진정 → TQQQ 빠른 모드 ON/,'D3 전환 기록');assert.match(hp,/무장 40 이상 → 진정 35 아래/);
    assert.match(hb,/듀얼가드 v1\.0/);assert.doesNotMatch(hb,/assetPanicCard|공포 모드/,'D3 기본 세션엔 카드 없음');
    // 상태 문구
    c.Rm=E.replay(OPT({rules:'panic',vix:VIX,vxn:VXN,endDate:EXPECT.midDate}));assert.match(run('assetPanicHtml(Rm)'),/지금 상태<\/b> · TQQQ 빠른 모드\(SMA50 ±2%\)/,'D3 빠른 모드 상태');
    c.Rn={panic:{state:{armed:true},params:PR.panic,vix:35.6,vxn:38,signalDate:'2026-01-02',log:[]}};const hn=run('assetPanicHtml(Rn)');
    assert.match(hn,/무장 — VIX 가 35 아래로/,'D3 무장 상태');assert.match(hn,/경계 근처/,'D3 경계 경고(무장 중 35±1)');assert.match(hn,/켜진 적이 없습니다/);
    c.Rn.panic.vix=20;c.Rn.panic.state={};assert.doesNotMatch(run('assetPanicHtml(Rn)'),/경계 근처/,'D3 멀면 경고 없음');assert.match(run('assetPanicHtml(Rn)'),/대기\(보통 모드\)/);
    c.Rn.panic.vix=40.8;assert.match(run('assetPanicHtml(Rn)'),/경계 근처/,'D3 40±1 경고');
    // 다음 주문 판정: 보고 있는 세션이 공포 모드 모의이고 판정일이 재생 자료 끝과 같을 때만
    c.assetPaperCache.p1=c.Rm;c._act=c.sp;
    const nx=run('alphaPanicNext("'+EXPECT.midDate+'")');assert.equal(nx.guard,'ON','D4 next');assert.equal(nx.state.pf,true);assert.equal(nx.params.ma,50);
    assert.equal(run('alphaPanicNext("2099-01-01")'),null,'D4 판정일 다르면 null');
    c._act=c.sb;assert.equal(run('alphaPanicNext("'+EXPECT.midDate+'")'),null,'D4 기본 세션 null');c._act=null;assert.equal(run('alphaPanicNext("'+EXPECT.midDate+'")'),null,'D4 현재 투자중 null');
    c._act=c.sl;assert.equal(run('alphaPanicNext("'+EXPECT.midDate+'")'),null,'D4 운영 세션 null');
    // renderAlphaPlan 이 그 판정을 쓴다(σ · Guard) · 모의 재생이 규칙과 지수 시세를 넘긴다 · 오류는 화면에
    const rp=fnOf(P,'function renderAlphaPlan(qTecl,qTqqq,qSgov)');
    assert.match(rp,/const PX=alphaPanicNext\(qTecl\.settled\.date\),sigW=\(PX&&PX\.sigma>0\)\?PX\.sigma:sigma;/,'D5 σ');
    assert.match(rp,/w=Math\.min\(1,\(S0\*S0\)\/\(sigW\*sigW\)\)/,'D5 목표 w');
    assert.match(rp,/guard=PX\?PX\.guard:dec\.guard,guardFlip=PX\?\(guard==='ON'\)!==\(qq>0\):dec\.guardFlip;/,'D5 Guard');
    const rs=fnOf(P,'async function replayAssetPaperSession(x,applyView)');
    assert.match(rs,/const rules=assetRulesOf\(x\),ix=rules==='panic'\?await Promise\.all\(\[fetchPlanIndex\('\^VIX'\),fetchPlanIndex\('\^VXN'\)\]\):\[null,null\];/,'D6 지수 시세');
    assert.match(rs,/replay\(\{horizon:\+x\.horizon,rules,startDate/,'D6 규칙');assert.match(rs,/vix:ix\[0\],vxn:ix\[1\]/);assert.match(rs,/if\(R&&R\.error\)throw new Error\(R\.error\);/,'D6 오류 표시');
    assert.match(fnOf(P,'async function fetchPlanIndex(sym)'),/quoteToDaily\(sym,j\)\.days/,'D6 모의 목록과 같은 변환');
    assert.match(fnOf(P,'function renderAssetSessions()'),/assetRulesOf\(x\)==='panic'\?'<span class="paperbadge">공포<\/span>':''/,'D7 칩 표시');
    assert.match(fnOf(P,'function syncAssetSessionModal()'),/pr\.style\.display=paper\?'':'none';if\(!paper&&\$\('assetSessionPanic'\)\)\$\('assetSessionPanic'\)\.checked=false;/,'D7 모의일 때만 보임');
    assert.match(fnOf(P,'async function createAssetSession()'),/rules:\(\$\('assetSessionPanic'\)&&\$\('assetSessionPanic'\)\.checked\)\?'panic':'base'/,'D7 저장');
    // 모의 목록
    const ci={window:{JKPlanSessionEngine:E},PLAN_PAPER_QUOTES:{TECL:{days:TE,dividends:[]},TQQQ:{days:TQ,dividends:[]},SGOV:{days:SG,dividends:[]}},PLAN_PAPER_CACHE:{},simCutoff:()=>D[699]};vm.createContext(ci);
    vm.runInContext(fnOf(X,'function planPaperPanic(sess)')+fnOf(X,'function replayPlanPaper(sess)'),ci);
    ci.sp={id:'p',paper:true,simStart:D[260],settings:{alphaRules:'panic',startCapital:20000}};ci.sb={id:'b',paper:true,simStart:D[260],settings:{alphaRules:'base',startCapital:20000}};ci.sl={id:'l',paper:false,simStart:D[260],settings:{alphaRules:'panic',startCapital:20000}};
    assert.equal(vm.runInContext('replayPlanPaper(sp)',ci),null,'D8 VIX 없으면 줄 비움(기본으로 계산 안 함)');
    assert.equal(JSON.stringify(vm.runInContext('replayPlanPaper(sb)',ci).ledger),JSON.stringify(base.ledger),'D8 기본 세션');
    ci.PLAN_PAPER_QUOTES['^VIX']={days:VIX};ci.PLAN_PAPER_QUOTES['^VXN']={days:VXN};
    assert.equal(JSON.stringify(vm.runInContext('replayPlanPaper(sp)',ci).ledger),JSON.stringify(pan.ledger),'D8 공포 세션 = 엔진 공포 장부');
    assert.equal(JSON.stringify(vm.runInContext('replayPlanPaper(sl)',ci).ledger),JSON.stringify(base.ledger),'D8 운영 세션은 base');
    assert.match(fnOf(X,'async function loadPlanPaperData(force,panic)'),/\.concat\(panic\?\['\^VIX','\^VXN'\]:\[\]\)/,'D8 지수는 공포 세션이 있을 때만');
    assert.match(X,/await loadPlanPaperData\(false,planPaperPanic\(sess\)\);replayPlanPaper\(sess\);/,'D8 목록 재계산');
    assert.match(X,/PE\.strategyLabel\(S0\.alphaRules==='panic'\?'panic':'base'\)/,'D8 목록 이름');
  }
}
// 합성 시세에서 미리 재 둔 값(이 파일을 처음 쓸 때 실제 엔진으로 잰 값 — 규칙이 바뀌면 여기서 걸린다)
const EXPECT=JSON.parse(fs.readFileSync(path.join(__dirname,'check-plan-panic.expect.json'),'utf8'));
if(process.argv.includes('--print')){const E=loadEngine(SRC.eng),b=E.replay(OPT()),p=E.replay(OPT({rules:'panic',vix:VIX,vxn:VXN}));
  const on=p.panic.log.find(l=>l.ev==='fastOn').date,mid=D[D.indexOf(on)+5];
  console.log(JSON.stringify({baseTq:tq(b),panTq:tq(p),log:p.panic.log.map(l=>l.date+' '+l.ev),baseTotal:+b.stats.total.toFixed(2),panTotal:+p.stats.total.toFixed(2),midDate:mid,teclDiff:trades(p).filter(e=>e.symbol==='TECL').length-trades(b).filter(e=>e.symbol==='TECL').length}));process.exit(0);}
check(SRC);
// ── 변이: 고친 곳을 되돌리거나 비틀면 빨간불 ──
const M=[
  ['엔진: 무장 문턱 ≥ → >','eng',s=>s.replace("if(v!=null&&v>=P.hi)st.armed=true;","if(v!=null&&v>P.hi)st.armed=true;")],
  ['엔진: 무장 없이도 켜짐(통제)','eng',s=>s.replace("if(st.armed&&v!=null&&v<P.lo&&fm>0&&c>fm*(1+b)){st.pf=true;","if(v!=null&&v<P.lo&&fm>0&&c>fm*(1+b)){st.pf=true;")],
  ['엔진: 진정 문턱 < → <=','eng',s=>s.replace("if(st.armed&&v!=null&&v<P.lo&&fm>0","if(st.armed&&v!=null&&v<=P.lo&&fm>0")],
  ['엔진: SMA50 조건 없음','eng',s=>s.replace("v<P.lo&&fm>0&&c>fm*(1+b)){st.pf=true;","v<P.lo){st.pf=true;")],
  ['엔진: 빠른 모드 중립 = 늘 OFF','eng',s=>s.replace("(fm>0&&c<fm*(1-b))?'OFF':(a.posOn?'ON':'OFF');","(fm>0&&c<fm*(1-b))?'OFF':'OFF';")],
  ['엔진: 보통 복귀 때 빠른 모드 안 풂','eng',s=>s.replace("if(st.gN){st.pf=false;st.armed=false;guard='ON';","if(st.gN){guard='ON';")],
  ['엔진: 시작 상태 gN=true','eng',s=>s.replace("function panicState(){return {armed:false,pf:false,armS:false,ps:false,gN:false};}","function panicState(){return {armed:false,pf:false,armS:false,ps:false,gN:true};}")],
  ['엔진: 슬리브 min 안 씀','eng',s=>s.replace("else sigma=Math.min(a.sigma,iv);}","else sigma=a.sigma;}")],
  ['엔진: 슬리브가 무장 없이 켜짐','eng',s=>s.replace("if(st.armS&&v!=null&&v<P.lo){st.ps=true;","if(v!=null&&v<P.lo){st.ps=true;")],
  ['엔진: 슬리브 k 3 → 2.5','eng',s=>s.replace("panic:{hi:40,lo:35,ma:50,band:.02,k:3.0,fbK:3.6}","panic:{hi:40,lo:35,ma:50,band:.02,k:2.5,fbK:3.6}")],
  ['엔진: 진정선 35 → 30','eng',s=>s.replace("panic:{hi:40,lo:35,","panic:{hi:40,lo:30,")],
  ['엔진: 재생이 공포 Guard 를 안 씀','eng',s=>s.replace("if(pm){guard=pm.guard;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}","")],
  ['엔진: 재생이 공포 σ 를 안 씀','eng',s=>s.replace("sigUse=pm?pm.sigma:sigma,","sigUse=sigma,")],
  ['엔진: 당일 VIX 를 본다(룩어헤드)','eng',s=>s.replace("panicStep(st,{rules:RULES,vix:vixA[p],vxn:vxnA[p],","panicStep(st,{rules:RULES,vix:vixA[Math.min(p+1,vixA.length-1)],vxn:vxnA[p],")],
  ['엔진: VIX 없어도 계산','eng',s=>s.replace("if(PN&&!(Array.isArray(opt.vix)&&opt.vix.length))return","if(false)return")],
  ['엔진: 공포 규칙을 base 로 돌려줌','eng',s=>s.replace("return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;","return ALPHA_RULES.base;")],
  ['엔진: 이름에 실험 표시 없음','eng',s=>s.replace("+(R.exp?' '+R.name+'(실험)':'')","")],
  ['엔진: 기본 결과에 panic 칸','eng',s=>s.replace("  if(PN){\n    /* 화면용","  if(true){\n    /* 화면용")],
  ['설정: 운영 세션에도 panic 저장','set',s=>s.replace("x.settings.alphaRules=(paper&&input.rules==='panic')?'panic':'base';","x.settings.alphaRules=(input.rules==='panic')?'panic':'base';")],
  ['설정: 늘 base','set',s=>s.replace("x.settings.alphaRules=(paper&&input.rules==='panic')?'panic':'base';","x.settings.alphaRules='base';")],
  ['화면: 운영 세션도 공포 규칙','plan',s=>s.replace("function assetRulesOf(x){return (x&&x.paper&&x.settings&&x.settings.alphaRules==='panic')?'panic':'base';}","function assetRulesOf(x){return (x&&x.settings&&x.settings.alphaRules==='panic')?'panic':'base';}")],
  ['화면: 판정일이 달라도 next','plan',s=>s.replace("return (P&&P.next&&P.signalDate===signalDate)?","return (P&&P.next)?")],
  ['화면: 다음 주문이 σ 를 안 씀','plan',s=>s.replace("sigW=(PX&&PX.sigma>0)?PX.sigma:sigma;","sigW=sigma;")],
  ['화면: 다음 주문이 Guard 를 안 씀','plan',s=>s.replace("guard=PX?PX.guard:dec.guard,guardFlip=PX?(guard==='ON')!==(qq>0):dec.guardFlip;","guard=dec.guard,guardFlip=dec.guardFlip;")],
  ['화면: 상태 카드 없음','plan',s=>s.replace("+assetPanicHtml(R);\n}","+'';\n}")],
  ['화면: 경계 경고 없음','plan',s=>s.replace("(near?'<div style=\"color:var(--gold);margin-top:4px\">⚠","(false?'<div style=\"color:var(--gold);margin-top:4px\">⚠")],
  ['화면: 위험 문구 없음','plan',s=>s.replace("2011 처럼 공포가 두 번 오면 휩쏘로 잃습니다.","")],
  ['화면: 오류를 삼킴','plan',s=>s.replace("    if(R&&R.error)throw new Error(R.error);\n","")],
  ['화면: 재생에 지수 시세 안 넘김','plan',s=>s.replace("vix:ix[0],vxn:ix[1],","")],
  ['화면: 선택 줄이 운영에도 보임','plan',s=>s.replace("pr.style.display=paper?'':'none';if(!paper&&$('assetSessionPanic'))$('assetSessionPanic').checked=false;","pr.style.display='';")],
  ['목록: VIX 없으면 기본으로 계산','idx',s=>s.replace("  if(panic&&!(VI&&VI.days&&VI.days.length))return null;","").replace("rules:panic?'panic':(sess.settings.alphaRules==='panic'?'base':(sess.settings.alphaRules||'base'))","rules:(panic&&VI)?'panic':'base'").replace("vix:panic?VI.days:null","vix:(panic&&VI)?VI.days:null")],
  ['목록: 운영 세션에 적힌 panic 을 그대로 넘김','idx',s=>s.replace("(sess.settings.alphaRules==='panic'?'base':(sess.settings.alphaRules||'base'))","(sess.settings.alphaRules||'base')")],
  ['목록: 운영 세션도 공포','idx',s=>s.replace("return !!(sess&&sess.paper&&sess.settings&&sess.settings.alphaRules==='panic');}","return !!(sess&&sess.settings&&sess.settings.alphaRules==='panic');}")],
  ['목록: 공포 세션을 base 로 재생','idx',s=>s.replace("rules:panic?'panic':(sess.settings.alphaRules==='panic'?'base':(sess.settings.alphaRules||'base'))","rules:'base'")],
  ['목록: 이름이 늘 v1.0','idx',s=>s.replace("PE.strategyLabel(S0.alphaRules==='panic'?'panic':'base')","PE.strategyLabel('base')")],
];
let red=0;for(const [name,key,fn] of M){const src=SRC[key],mut=fn(src);if(mut===src){console.error('변이가 안 들어감: '+name);process.exit(1);}
  let ok=false;try{check(Object.assign({},SRC,{[key]:mut}));}catch(e){ok=true;}
  if(!ok){console.error('변이 생존: '+name);process.exit(1);}red++;}
console.log('ALL PASS plan panic · 변이 '+red+'/'+M.length+' red');
