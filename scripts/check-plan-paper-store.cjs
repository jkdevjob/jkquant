#!/usr/bin/env node
'use strict';
/* 듀얼가드 모의 세션 재생 저장본 (엔진 plan-session-engine.js paperRun* · 듀얼가드 plan v2.13.0 · 운영 v3.134.0 · 2026-11-11)
 * 사용자: "듀얼가드 DB에 저장하게 바꾸고" · "운영 모든 전략 모든 세션을 DB에 저장하라는거야" · "이렇게 열 때마다 그때그때 계산하지 말고"
 *
 * A 묶기 = 풀기(저장 전 장부 == 저장 후 장부) — 무작위 장면마다 풀어 낸 결과 JSON == 재생 결과 JSON · 망가진 문서는 안 씀 · 이상하면 저장 안 함
 * B 재생 조건(sig) — 규칙·시작일·원금·월 적립·엔진 코드가 바뀌면 다른 sig · 상관없는 칸(이름 등)은 그대로 · 공포 모드는 모의 세션에서만
 * C '오늘 것인가'(직전 평일 봉까지) · 재생 끝 날(세 종목 확정 봉 중 가장 이른 날)
 * D 흐름(엔진 paperRunGet) — 처음: 재생·저장 / 다시 열기: 메모리 / 다른 창: DB(시세 안 받음) / 새 봉: 다시 재생 / 휴장: 그대로 / 설정 바뀜: 다시 / 실패 처리
 * E 듀얼가드 화면(plan.html replayAssetPaperSession · deleteAssetSession) — 실제 함수를 떼어 대역 DB 로 돌린다
 * F 모의 목록(index.html planPaperRun · paperPrefetchQuotes) — 같은 대역 DB 를 읽는다(듀얼가드 화면이 센 값 = 목록이 읽는 값)
 * 값 시험 + 변이(틀린 코드로 바꾸면 빨간불).
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'..'),READ=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const SRC={eng:READ('plan-session-engine.js'),plan:READ('plan.html'),idx:READ('index.html')};
const fnOf=(src,marker)=>{const s=src.indexOf(marker);if(s<0)throw Error('없음: '+marker);let i=src.indexOf('{',s),d=0;for(;i<src.length;i++){if(src[i]==='{')d++;if(src[i]==='}'&&!--d)return src.slice(s,i+1);}throw Error(marker);};
const loadEngine=src=>{const c={};vm.createContext(c);vm.runInContext(src,c);return c.JKPlanSessionEngine;};
const J=x=>JSON.stringify(x),clone=x=>JSON.parse(J(x));

/* ── 합성 시세(정해진 씨앗) — 주말·휴장 없는 평일, 폭락 구간(공포 모드 무장), SGOV 는 2020-06-01 상장, 분배금 ── */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const HOLI=new Set(['2019-12-25','2020-01-01','2020-07-03','2020-12-25','2021-01-01','2022-07-04','2023-12-25','2024-07-04','2025-12-25','2026-01-01','2026-07-03']);
function mkMarket(seed){
  const rnd=mulberry32(seed),days=[];
  for(let t=Date.parse('2019-01-02T00:00:00Z');t<=Date.parse('2026-11-10T00:00:00Z');t+=864e5){const d=new Date(t),w=d.getUTCDay(),s=d.toISOString().slice(0,10);if(w===0||w===6||HOLI.has(s))continue;days.push(s);}
  let te=25,tq=40,sg=100;const TE=[],TQ=[],SG=[],VI=[],VN=[],TD=[],QD=[],GD=[];const r4=x=>Math.round(x*1e4)/1e4;
  days.forEach((d,i)=>{
    const crash=(i>=290&&i<318)||(i>=1130&&i<1150)?-0.045:0,calm=(i>=318&&i<380)||(i>=1150&&i<1200)?0.012:0;
    const g=(rnd()-0.485)*0.07+crash+calm;te=Math.max(0.5,te*(1+g*1.1));tq=Math.max(0.5,tq*(1+g*0.9+(rnd()-0.5)*0.012));
    TE.push({date:d,close:r4(te)});TQ.push({date:d,close:r4(tq)});
    const back=Math.max(0,i-20),ret=TE[i].close/TE[back].close-1,vix=Math.min(85,Math.max(11,14+260*Math.max(0,-ret)+(rnd()-0.5)*3));
    VI.push({date:d,close:Math.round(vix*100)/100});VN.push({date:d,close:Math.round((vix*1.15+2)*100)/100});
    if(d>='2020-06-01'){sg*=1+0.00012+(rnd()-0.5)*0.0002;SG.push({date:d,close:r4(sg)});if(d.slice(8)<='03'&&(!GD.length||GD[GD.length-1].date.slice(0,7)!==d.slice(0,7)))GD.push({date:d,amount:0.33});}
    if(/-(03|06|09|12)-2[0-4]$/.test(d)&&(!TD.length||TD[TD.length-1].date.slice(0,7)!==d.slice(0,7))){TD.push({date:d,amount:0.004});QD.push({date:d,amount:0.006});}
  });
  return {days,TE,TQ,SG,VI,VN,TD,QD,GD};
}
const MK=mkMarket(20261111);
/* io.quotes 가 돌려주는 모양(두 화면 모두 이것으로 바꿔 넘긴다) — upto 이하 봉만(자료가 거기까지 왔다) */
const quotesTo=(upto,panic)=>{const f=a=>a.filter(r=>r.date<=upto);return {tecl:f(MK.TE),tqqq:f(MK.TQ),sgov:f(MK.SG),teclDiv:MK.TD,tqqqDiv:MK.QD,sgovDiv:MK.GD,vix:panic?f(MK.VI):null,vxn:panic?f(MK.VN):null};};
const direct=(E,sess,end)=>{const o=E.paperRunOpts(sess),q=quotesTo(end,o.rules==='panic');return E.replay(Object.assign({},o,{endDate:end},q));};

const sessB={id:'pb',name:'모의 기본',paper:true,horizon:5,simStart:'2020-01-02',settings:{startCapital:20000,monthlyAdd:500,alphaRules:'base'}};
const sessP={id:'pp',name:'모의 공포',paper:true,horizon:5,simStart:'2019-06-03',settings:{startCapital:100000,monthlyAdd:0,alphaRules:'panic'}};

/* 대역 IO — 문서 저장소(Map) · 부른 횟수 · 순서 */
function mkIO(store,key,o){
  o=o||{};const c={read:0,write:0,quotes:0,show:[],order:[]};
  return {c,io:{key,cut:o.cut,
    read:async()=>{c.read++;c.order.push('read');if(o.readFail)throw Error('읽기 끊김');const d=store.get(key);return d?clone(d):null;},
    write:async d=>{c.write++;c.order.push('write');if(o.writeFail)throw Error('쓰기 거절');store.set(key,clone(d));},
    quotes:async panic=>{c.quotes++;c.order.push('quotes');if(o.quoteFail)throw Error('시세 끊김');return quotesTo(o.dataTo||o.cut,panic);},
    show:R=>{c.show.push(R);c.order.push('show');}}};
}

async function check(S,opt){
  opt=opt||{};const bad=[],t=(n,cond,info)=>{if(!cond)bad.push(n+(info?' · '+String(info).slice(0,300):''));};
  const E=loadEngine(S.eng);
  // ── A 묶기 = 풀기 ──
  { const rnd=mulberry32(77),N=opt.scenes||200;let worst=0,maxLen=0,ok=0,fails=[];
    for(let k=0;k<N;k++){
      const start=MK.days[Math.floor(rnd()*(MK.days.length-30))],caps=[10000,100000,20000,7777.77,123456.5],adds=[0,0,300,500.5,1000];
      const sess={id:'s'+k,paper:true,horizon:5,simStart:start,settings:{startCapital:caps[k%5],monthlyAdd:adds[(k*3)%5],alphaRules:k%3===0?'panic':'base'}};
      const end=MK.days[MK.days.length-1-Math.floor(rnd()*5)],R=direct(E,sess,end),sig=E.paperRunSig(E.paperRunOpts(sess));
      if(R.error){fails.push(start+':'+R.error);continue;}
      const d=E.paperRunPack(R,sig),back=d&&E.paperRunUnpack(clone(d),sig);
      if(!back||J(back)!==J(R)){fails.push(start+'/'+sess.settings.alphaRules);continue;}
      ok++;maxLen=Math.max(maxLen,d.run.length);worst=Math.max(worst,d.run.length/J(R).length);
    }
    t('A1 무작위 '+N+'장면: 묶었다 푼 결과 JSON == 재생 결과 JSON(거래이력 · 날마다 평가액 · 성과 · 마지막 판단 · 공포 모드 상태)',ok===N&&!fails.length,fails.slice(0,4).join(','));
    t('A2 묶은 글자는 원래의 40% 아래 · 문서 한도 안',worst<0.4&&maxLen<E.PAPER_RUN_MAX,JSON.stringify({worst:+worst.toFixed(3),maxLen}));
    const R=direct(E,sessP,'2026-11-10'),sig=E.paperRunSig(E.paperRunOpts(sessP)),d=E.paperRunPack(R,sig);
    t('A3 공포 모드 세션: 전환 기록이 있다(시험이 공포 모드 길을 탄다) · 풀어도 다음 판정 그대로',R.panic&&R.panic.log.length>=2&&J(E.paperRunUnpack(d,sig).panic)===J(R.panic),R.panic&&R.panic.log.length);
    const bads=[['판 다름',Object.assign(clone(d),{v:d.v+1})],['sig 다름',Object.assign(clone(d),{sig:d.sig+'x'})],['글자 아님',Object.assign(clone(d),{run:null})],
      ['깨진 JSON',Object.assign(clone(d),{run:d.run.slice(0,-9)})],['끝 날 다름',Object.assign(clone(d),{upto:'2026-11-09'})],['날 수 다름',Object.assign(clone(d),{n:d.n-1})],['없음',null]];
    const used=bads.filter(([,x])=>E.paperRunUnpack(x,sig)!==null).map(([n])=>n);
    t('A4 망가진·다른 조건 문서는 쓰지 않는다(판 · sig · 글자 · 깨짐 · 끝 날 · 날 수 · 없음)',!used.length,used.join(','));
    const R2=clone(R);R2.ledger.events[0].memo='손으로 적은 칸';const R3=clone(R);R3.ledger.events[1].id='custom-1';
    const big=clone(R);for(let i=0;i<30000;i++){const z=big.nav[big.nav.length-1];big.nav.push(Object.assign({},z,{date:new Date(Date.parse(z.date+'T00:00:00Z')+864e5).toISOString().slice(0,10),total:z.total+i*0.37,cash:z.cash+0.013,teclPx:z.teclPx+i*0.011}));}
    big.last=big.nav[big.nav.length-1];
    const refuse=[['모르는 칸',R2],['다른 id 모양',R3],['문서 한도 넘음',big],['재생 오류',Object.assign(clone(R),{error:'x'})]].filter(([,x])=>E.paperRunPack(x,sig)!==null).map(([n])=>n);
    t('A5 묶고 다시 푼 것이 원래와 다르거나 너무 크면 저장하지 않는다(null → 메모리만)',!refuse.length,refuse.join(','));
  }
  // ── B 재생 조건 ──
  { const O=s=>E.paperRunOpts(s),G=s=>E.paperRunSig(O(s));
    const o1=O({paper:true,simStart:'2020-01-02',settings:{alphaRules:'panic',startCapital:5000}}),o2=O({paper:false,settings:{alphaRules:'panic',startCapital:5000}}),
      o3=O({paper:true,settings:{principal:7000}}),o4=O({paper:true,horizon:10,settings:{alphaRules:'exp1'}});
    t('B1 공포 모드는 모의 세션에서만 · 빈 규칙 = base · 원금은 startCapital(없으면 principal) · 폐지 규칙·기간 글자는 그대로(재생이 거절)',
      o1.rules==='panic'&&o2.rules==='base'&&o3.rules==='base'&&o3.principal===7000&&o3.horizon===5&&o4.rules==='exp1'&&o4.horizon===10&&o1.startDate==='2020-01-02'&&o1.principal===5000,J([o1,o2,o3,o4]));
    const base=clone(sessB),s0=G(base),ch=[['규칙',x=>x.settings.alphaRules='panic'],['시작일',x=>x.simStart='2020-01-03'],['원금',x=>x.settings.startCapital=20001],['월 적립',x=>x.settings.monthlyAdd=501]]
      .filter(([,f])=>{const x=clone(base);f(x);return G(x)===s0;}).map(([n])=>n);
    const same=[['이름',x=>x.name='새 이름'],['포트폴리오 칸',x=>x.portfolio=false],['만든 때',x=>x.createdAt=1],['환율',x=>x.paperFxRate=1400]].filter(([,f])=>{const x=clone(base);f(x);return G(x)!==s0;}).map(([n])=>n);
    t('B2 재생 조건이 바뀌면 sig 가 달라진다(규칙 · 시작일 · 원금 · 월 적립) · 상관없는 칸(이름 · 포트폴리오 · 만든 때 · 환율)은 그대로',!ch.length&&!same.length,'안 바뀜:'+ch.join(',')+' 바뀜:'+same.join(','));
    const E2=loadEngine(S.eng),E3=loadEngine(S.eng.replace('const FEE_RATE=.001;','const FEE_RATE=.001; '));
    t('B3 엔진 코드 지문: 같은 파일이면 같은 값(두 화면) · 코드가 한 글자라도 바뀌면 다른 값 → 저장본을 다시 센다',E2.ENGINE_FP===E.ENGINE_FP&&E3.ENGINE_FP!==E.ENGINE_FP&&E2.paperRunSig(E2.paperRunOpts(sessB))===s0&&E3.paperRunSig(E3.paperRunOpts(sessB))!==s0,[E.ENGINE_FP,E2.ENGINE_FP,E3.ENGINE_FP].join());
  }
  // ── C 오늘 것인가 · 재생 끝 날 ──
  { const F=E.paperRunFresh,tab=[['2026-11-06','2026-11-07',true],['2026-11-06','2026-11-08',true],['2026-11-06','2026-11-09',false],['2026-11-09','2026-11-09',true],
      ['2026-11-09','2026-11-10',false],['2026-11-10','2026-11-10',true],['','2026-11-10',false],['2026-11-10','',false],['2026-11-10','엉뚱',false]];
    const wrong=tab.filter(([u,c,w])=>F(u,c)!==w).map(([u,c])=>u+'@'+c);
    t('C1 오늘 것인가 = 확정 상한(그날 포함)의 직전 평일 봉까지 있음(토·일엔 금요일 봉이면 됨 · 월요일 마감 뒤엔 월요일 봉 필요)',!wrong.length,wrong.join(','));
    const P=E.paperRunEnd,a=[{date:'2026-11-06'},{date:'2026-11-09'},{date:'2026-11-10'}],b=[{date:'2026-11-06'},{date:'2026-11-09'}],c=[{date:'2026-11-05'},{date:'2026-11-06'},{date:'2026-11-11'}];
    const r=[P([a,a,a],'2026-11-10'),P([a,b,a],'2026-11-10'),P([a,a,c],'2026-11-10'),P([a,a,a],'2026-11-08'),P([a,[],a],'2026-11-10'),P([a,null,a],'2026-11-10')];
    t('C2 재생 끝 날 = 세 종목 각각 확정 상한 이하 마지막 봉 중 가장 이른 날 · 상한 뒤 봉은 안 봄 · 한 종목이라도 없으면 없음',J(r)===J(['2026-11-10','2026-11-09','2026-11-06','2026-11-06','','']),J(r));
  }
  // ── D 흐름 (paperRunGet) ──
  { const DB=new Map(),K='u1/pb',sig=E.paperRunSig(E.paperRunOpts(sessB));
    // D1 처음 — 저장본 없음: 시세 → 재생 → 저장
    const a=mkIO(DB,K,{cut:'2026-11-06'}),r1=await E.paperRunGet(sessB,a.io),want1=direct(E,sessB,'2026-11-06');
    t('D1 처음 열기: 저장본 없음 → 시세 1번 · 재생 = 엔진 재생 · DB 에 1번 저장(풀면 같은 값) · 먼저 그릴 것 없음',
      r1.src==='replay'&&r1.saved===true&&a.c.quotes===1&&a.c.write===1&&!a.c.show.length&&J(r1.R)===J(want1)&&J(E.paperRunUnpack(DB.get(K),sig))===J(want1)&&r1.upto==='2026-11-06',J({src:r1.src,c:a.c.order}));
    // D2 같은 창에서 다시 — 메모리(DB 도 시세도 안 봄)
    const b=mkIO(DB,K,{cut:'2026-11-08'}),r2=await E.paperRunGet(sessB,b.io);
    t('D2 같은 창 다시 열기(주말): 메모리 저장본 그대로 — DB 읽기 0 · 시세 0 · 쓰기 0 · 같은 결과 · 먼저 그림 1번',r2.src==='stored'&&r2.R===r1.R&&b.c.read===0&&b.c.quotes===0&&b.c.write===0&&b.c.show.length===1&&b.c.show[0]===r1.R,J(b.c.order));
    // D3 다른 창(새 엔진 · 빈 메모리) — DB 에서 읽고 시세는 안 받는다
    const E2=loadEngine(S.eng),c=mkIO(DB,K,{cut:'2026-11-08'}),r3=await E2.paperRunGet(sessB,c.io);
    t('D3 다른 창(모의 목록 · 다른 기기): DB 저장본 1번 읽기 · 시세 0 · 재생 0 · 값 = 처음 센 값',r3.src==='stored'&&c.c.read===1&&c.c.quotes===0&&c.c.write===0&&J(r3.R)===J(want1),J(c.c.order));
    // D4 다음 거래일 마감 뒤 — 새 봉 → 다시 재생 · 저장 · 먼저 저장본을 그리고 시세를 기다린다
    const d=mkIO(DB,K,{cut:'2026-11-09'}),r4=await E2.paperRunGet(sessB,d.io),want4=direct(E,sessB,'2026-11-09');
    t('D4 새 확정 봉(월 마감 뒤): 저장본 먼저 그림 → 시세 → 다시 재생 → 저장 · 끝 날 11-09 · 값 = 엔진 재생',
      r4.src==='replay'&&r4.saved&&J(d.c.order)===J(['show','quotes','write'])&&r4.upto==='2026-11-09'&&J(r4.R)===J(want4)&&DB.get(K).upto==='2026-11-09',J({o:d.c.order,u:r4.upto}));
    // D5 휴장·자료 아직 안 옴 — 시세는 받아 보지만 끝이 그대로면 저장본 그대로
    const e=mkIO(DB,K,{cut:'2026-11-10',dataTo:'2026-11-09'}),r5=await E2.paperRunGet(sessB,e.io);
    t('D5 휴장일·자료 늦음(상한 11-10 · 자료는 11-09까지): 시세 1번 · 다시 재생 안 함 · 쓰기 0 · 저장본 그대로',r5.src==='stored'&&e.c.quotes===1&&e.c.write===0&&r5.R===r4.R,J(e.c.order));
    const f=mkIO(DB,K,{cut:'2026-11-10'}),r6=await E2.paperRunGet(sessB,f.io);
    t('D6 자료가 오면(11-10) 다시 재생 · 저장',r6.src==='replay'&&r6.upto==='2026-11-10'&&f.c.write===1&&J(r6.R)===J(direct(E,sessB,'2026-11-10')),J(f.c.order));
    // D7 설정 바뀜 — 같은 문서라도 sig 가 다르면 쓰지 않고 다시 센다
    const sb2=clone(sessB);sb2.settings.startCapital=30000;const g=mkIO(DB,K,{cut:'2026-11-10'}),r7=await E2.paperRunGet(sb2,g.io);
    t('D7 세션 설정(원금)이 바뀌면 저장본을 쓰지 않는다 → 다시 재생 · 저장(새 sig) · 먼저 그리지 않음',r7.src==='replay'&&!g.c.show.length&&g.c.quotes===1&&g.c.write===1&&DB.get(K).sig===E.paperRunSig(E.paperRunOpts(sb2))&&J(r7.R)===J(direct(E,sb2,'2026-11-10')),J(g.c.order));
    // D8 시세 실패 — 저장본이 있으면 그것(경고) · 없으면 오류
    const E3=loadEngine(S.eng),h=mkIO(DB,K,{cut:'2026-11-11',quoteFail:true}),r8=await E3.paperRunGet(sb2,h.io);
    let thrown='';try{await loadEngine(S.eng).paperRunGet(sessB,mkIO(new Map(),'u1/none',{cut:'2026-11-11',quoteFail:true}).io);}catch(err){thrown=String(err.message);}
    t('D8 시세가 끊겨도 저장본이 있으면 그것을 돌려준다(경고) · 저장본이 없으면 오류를 그대로 올린다',r8.src==='stored'&&/시세 끊김/.test(r8.warn)&&J(r8.R)===J(r7.R)&&thrown==='시세 끊김',J({src:r8.src,warn:r8.warn,thrown}));
    // D9 재생 오류(공포 모드인데 VIX 없음) — 아무것도 저장하지 않는다
    const DB2=new Map(),k9=mkIO(DB2,'u1/pp',{cut:'2026-11-10'});k9.io.quotes=async()=>{k9.c.quotes++;const q=quotesTo('2026-11-10',false);return q;};
    const r9=await loadEngine(S.eng).paperRunGet(sessP,k9.io);
    t('D9 공포 모드 세션에 VIX 가 없으면 오류(기본 규칙으로 몰래 세지 않음) · 저장 안 함',r9.src==='error'&&/VIX/.test(r9.error)&&k9.c.write===0&&!DB2.size,J(r9));
    // D10 DB 읽기·쓰기 실패 — 읽기 실패 = 저장본 없음(재생) · 쓰기 실패해도 결과는 쓴다(경고)
    const k10=mkIO(new Map(),'u1/pb',{cut:'2026-11-10',readFail:true,writeFail:true}),r10=await loadEngine(S.eng).paperRunGet(sessB,k10.io);
    t('D10 DB 읽기 실패 → 재생 · 쓰기 실패 → 결과는 그대로(저장 실패 경고)',r10.src==='replay'&&r10.saved===false&&/저장 실패/.test(r10.warn)&&J(r10.R)===J(direct(E,sessB,'2026-11-10')),J({src:r10.src,warn:r10.warn}));
    // D11 메모리도 sig 를 본다 — 같은 창에서 설정을 바꿨다 되돌리면 각각 맞는 결과
    const k11=mkIO(DB,K,{cut:'2026-11-10'}),r11=await E2.paperRunGet(sessB,k11.io);
    t('D11 같은 창에서 설정을 되돌리면(원금 30000 → 20000) 메모리의 다른 설정 결과를 쓰지 않는다',J(r11.R)===J(direct(E,sessB,'2026-11-10'))&&r11.R!==r7.R,r11.src);
    // D12 지운 세션은 메모리에서도 잊는다
    E2.paperRunForget(K);const k12=mkIO(new Map(),K,{cut:'2026-11-10'});const r12=await E2.paperRunGet(sessB,k12.io);
    t('D12 paperRunForget 뒤엔 메모리 저장본을 쓰지 않는다(DB 에도 없으면 다시 재생)',r12.src==='replay'&&k12.c.read===1,J(k12.c.order));
  }
  // ── E 듀얼가드 화면(plan.html) ──
  const FS=new Map(),fsDoc=(db,...p)=>({path:p.join('/')});
  const planCtx=(Eng,cut,dataTo,box,saveOk)=>{
    const L={fetch:[],set:[],del:[],renders:0,alerts:0},EL={};
    const c={window:{JKPlanSessionEngine:Eng},auth:{currentUser:{uid:'u1'}},db:{},doc:fsDoc,
      nativeGetDoc:async r=>({exists:()=>FS.has(r.path),data:()=>clone(FS.get(r.path))}),setDoc:async(r,d)=>{FS.set(r.path,clone(d));L.set.push(r.path);},deleteDoc:async r=>{FS.delete(r.path);L.del.push(r.path);},
      assetViewRevision:1,_act:null,activeAssetSession(){return c._act;},assetPaperCache:{},applyAssetSettings(){},alphaLedger:null,cloneObj:clone,
      assetLedgerSeed:(d,cap)=>({base:{date:d,cash:cap},events:[]}),alphaSyncInputs(){},document:{body:{classList:{add(){},remove(){}}}},
      $:id=>EL[id]||(EL[id]={hidden:true,innerHTML:''}),assetPaperStatsHtml:(x,R)=>'STATS '+x.id+' '+R.last.date+' '+R.stats.total.toFixed(4),
      renderAlphaLedger(){L.renders++;},render(){},refreshAlphaFromCache(){},simCutoff:()=>cut,liveQuotes:{},
      fetchPlanQuote:async sym=>{L.fetch.push(sym);const q=quotesTo(dataTo||cut,false),m={TECL:[q.tecl,q.teclDiv],TQQQ:[q.tqqq,q.tqqqDiv],SGOV:[q.sgov,q.sgovDiv]}[sym];return {rows:m[0],dividends:m[1]};},
      fetchPlanIndex:async sym=>{L.fetch.push(sym);return quotesTo(dataTo||cut,true)[sym==='^VIX'?'vix':'vxn'];},
      assetSwitchIdle:async()=>{},assetPlanBox:()=>box,confirm:()=>true,liveState:{},writeAssetSessionLocal(){},saveOperatingState:async()=>saveOk!==false,alert(){L.alerts++;},
      alphaCloseFillEditor(){},alphaCloseEdit(){},dgSheetClose(){},setAssetDetail(){},restoreCurrentPlanView(){},renderAssetSessions(){},refreshLive:async()=>{L.live=(L.live||0)+1;},todayISO:()=>'2026-11-11',
      console:{error(){},warn(){},log(){}}};
    vm.createContext(c);
    vm.runInContext(['function planPaperRef(id)','async function planPaperDocRead(id)','async function planPaperDocWrite(id,d)','async function planPaperDocDelete(id)','function planPaperKey(id)',
      'async function replayAssetPaperSession(x,applyView,storedOnly)','async function loadActiveAssetSessionView(refresh=true,early=false)','async function deleteAssetSession(id)'].map(m=>fnOf(S.plan,m)).join('\n'),c);
    return {c,L,EL};
  };
  { const P='users/u1/planPaper/pb',sig=E.paperRunSig(E.paperRunOpts(sessB));
    // E1 저장본 없음 → 시세 3종목 → 재생 → DB 저장 → 그림
    const A=planCtx(loadEngine(S.eng),'2026-11-06');A.c._act=sessB;const R1=await A.c.replayAssetPaperSession(sessB,true),want=direct(E,sessB,'2026-11-06');
    t('E1 듀얼가드 화면 · 저장본 없음: 시세(TECL·TQQQ·SGOV) → 재생 → DB(users/u1/planPaper/pb) 저장 → 화면 장부·성과 = 재생 결과',
      J(A.L.fetch)===J(['TECL','TQQQ','SGOV'])&&J(A.L.set)===J([P])&&J(R1)===J(want)&&J(A.c.alphaLedger)===J(want.ledger)&&A.EL.assetPaperResult.innerHTML==='STATS pb 2026-11-06 '+want.stats.total.toFixed(4)
      &&A.L.renders===1&&J(E.paperRunUnpack(FS.get(P),sig))===J(want),J({f:A.L.fetch,s:A.L.set,r:A.L.renders}));
    // E2 다른 때 다시 열기(새 창) — 저장본이 오늘 것: 시세 0 · 바로 그림
    const B=planCtx(loadEngine(S.eng),'2026-11-07');B.c._act=sessB;const R2=await B.c.replayAssetPaperSession(sessB,true);
    t('E2 다시 열기(토요일 · 새 창): DB 저장본으로 바로 그림 — 시세 0 · 재생 0 · 저장 0 · 화면 = 처음 센 값',!B.L.fetch.length&&!B.L.set.length&&B.L.renders===1&&J(R2)===J(want)&&J(B.c.alphaLedger)===J(want.ledger)&&J(B.c.assetPaperCache.pb)===J(want),J(B.L));
    // E3 새 확정 봉 — 저장본 먼저 그리고, 다시 재생해 한 번 더 그림 · DB 갱신
    const C=planCtx(loadEngine(S.eng),'2026-11-09');C.c._act=sessB;const R3=await C.c.replayAssetPaperSession(sessB,true),want3=direct(E,sessB,'2026-11-09');
    t('E3 새 확정 봉(월 마감 뒤): 저장본으로 먼저 그림 → 시세 → 다시 재생 → 다시 그림(2번) · DB 끝 날 11-09 · 화면 = 새 재생',
      C.L.renders===2&&J(C.L.fetch)===J(['TECL','TQQQ','SGOV'])&&J(R3)===J(want3)&&J(C.c.alphaLedger)===J(want3.ledger)&&FS.get(P).upto==='2026-11-09',J({r:C.L.renders,f:C.L.fetch}));
    // E4 공포 모드 세션은 VIX·VXN 도 받는다
    const D=planCtx(loadEngine(S.eng),'2026-11-09');D.c._act=sessP;const R4=await D.c.replayAssetPaperSession(sessP,true);
    t('E4 공포 모드 모의 세션: VIX·VXN 도 받아 재생 = 엔진 공포 재생 · 저장',J(D.L.fetch)===J(['TECL','TQQQ','SGOV','^VIX','^VXN'])&&J(R4)===J(direct(E,sessP,'2026-11-09'))&&FS.has('users/u1/planPaper/pp'),J(D.L.fetch));
    // E5 세션 삭제 — DB 저장에 성공했을 때만 저장본도 지운다
    const box={sessions:[clone(sessB)],activeByHorizon:{5:'pb'}};const F1=planCtx(loadEngine(S.eng),'2026-11-09',null,box,false);await F1.c.deleteAssetSession('pb');await new Promise(r=>setTimeout(r,0));
    const kept=FS.has(P);const box2={sessions:[clone(sessB)],activeByHorizon:{5:'pb'}};const F2=planCtx(loadEngine(S.eng),'2026-11-09',null,box2,true);await F2.c.deleteAssetSession('pb');await new Promise(r=>setTimeout(r,0));
    t('E5 세션 삭제: 장부 저장이 실패하면 저장본도 그대로 · 성공하면 저장본(users/u1/planPaper/pb)도 지움',kept&&!F1.L.del.length&&J(F2.L.del)===J([P])&&!FS.has(P),J({kept,d1:F1.L.del,d2:F2.L.del}));
    // E6 첫 화면(저장본만) — 오늘 것이 아니어도 저장본을 그리기만 한다(시세·재생·저장 없음) · 저장본이 없으면 아무것도 안 함
    FS.set(P,E.paperRunPack(want,sig));
    const G=planCtx(loadEngine(S.eng),'2026-11-09');G.c._act=sessB;await G.c.loadActiveAssetSessionView(false,true);
    const H=planCtx(loadEngine(S.eng),'2026-11-09');const sx={id:'nostore',paper:true,horizon:5,simStart:'2024-01-02',settings:{startCapital:5000}};H.c._act=sx;const r6=await H.c.replayAssetPaperSession(sx,true,true);
    t('E6 첫 화면(저장본만): 오늘 것이 아닌 저장본(11-06)도 시세 없이 바로 그림(빈 장부 → 저장본 · 2번) · 재생·저장 0 · 저장본 없으면 그대로(시세 0)',
      !G.L.fetch.length&&!G.L.set.length&&G.L.renders===2&&J(G.c.alphaLedger)===J(want.ledger)&&/STATS pb 2026-11-06/.test(G.EL.assetPaperResult.innerHTML)&&!G.L.live
      &&r6===null&&!H.L.fetch.length&&!H.L.renders,J({g:G.L,h:H.L}));
    // E7 실계좌 세션은 첫 화면 길에서 건드리지 않는다(장부·화면 그대로 · 시세가 온 뒤 본 흐름)
    const I=planCtx(loadEngine(S.eng),'2026-11-09');const live={id:'real',paper:false,horizon:5,settings:{startDate:'2026-01-02',startCapital:20000},ledger:{base:{cash:20000},events:[]}};
    I.c._act=live;I.c.alphaLedger={base:{cash:1},events:[]};await I.c.loadActiveAssetSessionView(false,true);
    t('E7 첫 화면 길에서 실계좌 세션은 장부·화면을 바꾸지 않는다',J(I.c.alphaLedger)===J({base:{cash:1},events:[]})&&!I.L.renders&&!I.L.fetch.length,J(I.c.alphaLedger));
    // E8 finishPlanOpen — 운영 원장(세션 목록)을 읽자마자 모의 세션이면 저장본부터(시세 전) · 시세가 온 뒤 본 흐름
    const mkFin=act=>{const log=[];const c={startPlanQuotePrefetch(){},planBootNote(){},cloudLoad:async()=>{},PLAN_DB_SLOW_MS:20,setTimeout,clearTimeout,planBootHydrating:true,planGate(){},
      refreshLive:async o=>{log.push('시세 시작');if(o&&typeof o.onState==='function')o.onState();await new Promise(r=>setTimeout(r,15));log.push('시세 끝');},
      requestedAssetSessionId:'',assetPlanBox:()=>({sessions:[],activeByHorizon:{}}),planRetired:()=>false,writeAssetSessionLocal(){},renderHorizonCopy(){},clearRequestedAssetSessionLink(){},
      activeAssetSession:()=>act,renderAssetSessions(){},loadActiveAssetSessionView:async(r,e)=>{log.push(e?'저장본 먼저':'본 흐름');},console:{warn(){},error(){}}};
      vm.createContext(c);vm.runInContext(fnOf(S.plan,'function planApplySessionLink()')+'\n'+fnOf(S.plan,'async function finishPlanOpen(user)'),c);return {c,log};};
    const FA=mkFin(sessB);await FA.c.finishPlanOpen({uid:'u1'});const FB=mkFin({id:'real',paper:false});await FB.c.finishPlanOpen({uid:'u1'});
    t('E8 듀얼가드 열기: 모의 세션이면 시세를 기다리지 않고 저장본부터 그린 뒤 시세가 오면 본 흐름 · 실계좌 세션은 예전 순서',
      J(FA.log)===J(['시세 시작','저장본 먼저','시세 끝','본 흐름'])&&J(FB.log)===J(['시세 시작','시세 끝','본 흐름']),J([FA.log,FB.log]));
    FS.set(P,E.paperRunPack(want3,sig));   // 아래 F 가 쓸 저장본(듀얼가드 화면이 센 값)
  }
  // ── F 모의 목록(index.html) ──
  { const P='users/u1/planPaper/pb';
    const idxCtx=(Eng,cut,dataTo,plans)=>{
      const L={fd:[],need:[]},c={window:{JKPlanSessionEngine:Eng,fb:{db:{},doc:fsDoc,getDoc:async r=>({exists:()=>FS.has(r.path),data:()=>clone(FS.get(r.path))}),setDoc:async(r,d)=>{FS.set(r.path,clone(d));L.set=(L.set||[]).concat(r.path);}}},
        curUid:'u1',simCutoff:()=>cut,S:{plan:{sessions:plans}},PAPER_TABS:[['plan','듀얼가드']],pfWanted:()=>true,divCashOn:()=>false,ivsX1Of:x=>x,fetchDailyDiv:async()=>({}),
        fetchDaily:async sym=>{L.fd.push(sym);const q=quotesTo(dataTo||cut,true),m={TECL:[q.tecl,q.teclDiv],TQQQ:[q.tqqq,q.tqqqDiv],SGOV:[q.sgov,q.sgovDiv],'^VIX':[q.vix,[]],'^VXN':[q.vxn,[]]}[sym];return {days:m[0],dividends:m[1]};},
        console:{error(){},warn(){},log(){}}};
      vm.createContext(c);
      vm.runInContext('var PLAN_PAPER_QUOTES={},PLAN_PAPER_CACHE={};\n'+['async function loadPlanPaperData(force,panic)','function planPaperRetired(sess)','function planPaperRef(id)','async function planPaperDocRead(id)','async function planPaperDocWrite(id,d)',
        'function planPaperIO(sess)','async function planPaperRun(sess)','async function planPaperNeedQuotes(list)','async function paperPrefetchQuotes(opt)'].map(m=>fnOf(S.idx,m)).join('\n'),c);
      return {c,L};
    };
    // F1 듀얼가드 화면이 저장한 것을 모의 목록이 그대로 읽는다(시세 안 받음)
    const A=idxCtx(loadEngine(S.eng),'2026-11-09',null,[sessB]);await A.c.paperPrefetchQuotes({});const fd1=A.L.fd.slice();const R1=await A.c.planPaperRun(sessB);
    t('F1 모의 목록 재계산 · 저장본이 오늘 것: 시세 선취에서 TECL·TQQQ·SGOV 안 받음 · 목록 칸(PLAN_PAPER_CACHE) = 듀얼가드 화면이 센 값 · 시세 0',
      !fd1.length&&!A.L.fd.length&&J(R1)===J(direct(E,sessB,'2026-11-09'))&&A.c.PLAN_PAPER_CACHE.pb===R1,J({fd1,fd:A.L.fd}));
    // F2 저장본이 없는 세션이 하나라도 있으면 선취에서 세 종목을 받는다 · 그 세션은 재생 → 저장
    const sx={id:'px',paper:true,horizon:5,simStart:'2023-03-01',settings:{startCapital:15000,monthlyAdd:0}};
    const B=idxCtx(loadEngine(S.eng),'2026-11-09',null,[sessB,sx]);await B.c.paperPrefetchQuotes({});const fd2=B.L.fd.slice().sort();const R2=await B.c.planPaperRun(sx);
    t('F2 저장본 없는 세션이 있으면 선취에서 TECL·TQQQ·SGOV 를 받는다 · 그 세션은 재생 → DB 저장(users/u1/planPaper/px)',
      J(fd2)===J(['SGOV','TECL','TQQQ'])&&J(R2)===J(direct(E,sx,'2026-11-09'))&&FS.has('users/u1/planPaper/px'),J(fd2));
    // F3 지난번에 담아 둔 시세(11-06까지)가 남아 있어도 새 봉을 볼 때는 이번에 받은 시세로(11-10)
    const C=idxCtx(loadEngine(S.eng),'2026-11-10',null,[sessB]);const old=quotesTo('2026-11-06',false);
    C.c.PLAN_PAPER_QUOTES.TECL={days:old.tecl,dividends:old.teclDiv};C.c.PLAN_PAPER_QUOTES.TQQQ={days:old.tqqq,dividends:old.tqqqDiv};C.c.PLAN_PAPER_QUOTES.SGOV={days:old.sgov,dividends:old.sgovDiv};
    const R3=await C.c.planPaperRun(sessB);
    t('F3 새 봉을 볼 때는 지난번 담아 둔 시세가 아니라 이번에 받은 시세로 — 11-10 까지 재생 · DB 갱신',R3&&R3.last.date==='2026-11-10'&&FS.get(P).upto==='2026-11-10'&&J(R3)===J(direct(E,sessB,'2026-11-10')),R3&&R3.last.date);
    // F4 로그인 없음 — DB 를 건드리지 않고 재생만
    const before=J([...FS.keys()].sort()),D=idxCtx(loadEngine(S.eng),'2026-11-10',null,[sessB]);D.c.curUid=null;const R4=await D.c.planPaperRun(Object.assign(clone(sessB),{id:'nologin'}));
    t('F4 로그인 전: DB 를 읽지도 쓰지도 않고 재생만(줄은 나온다)',R4&&J([...FS.keys()].sort())===before&&!D.L.set,before);
  }
  return bad;
}

const MUT=[
  ['풀기: 체결 수수료율 칸 빠짐','eng',s=>s.replace(",fee:e[7],feeRate:FEE_RATE,signalDate:e[8],sim:true}",",fee:e[7],signalDate:e[8],sim:true}")],
  ['풀기: 바뀐 날 펴기 하루 어긋남','eng',s=>s.replace("while(j<rs.length&&rs[j][0]<=i)cur=rs[j++].slice(1);","while(j<rs.length&&rs[j][0]<i)cur=rs[j++].slice(1);")],
  ['풀기: 평가액 칸 순서 바뀜(현금 먼저)','eng',s=>s.replace("nav[i]={date:dayStr(day),total:N.t[i],inflow:F[i][0],cash:C[i][0],","nav[i]={date:dayStr(day),total:N.t[i],cash:C[i][0],inflow:F[i][0],")],
  ['묶기: 다시 풀어 확인 안 함','eng',s=>s.replace("  try{if(JSON.stringify(unpackRun(JSON.parse(run)))!==JSON.stringify(R))return null;}catch(e){return null;}\n","")],
  ['묶기: 크기 한도 안 봄','eng',s=>s.replace("  if(run.length>PAPER_RUN_MAX)return null;\n","")],
  ['풀기: 판·조건 안 봄','eng',s=>s.replace("if(!d||d.v!==PAPER_RUN_VER||d.sig!==sig||typeof d.run!=='string')return null;","if(!d||typeof d.run!=='string')return null;")],
  ['조건: 원금 빠짐','eng',s=>s.replace("o.startDate,o.principal,o.monthlyAdd].join('|')","o.startDate,o.monthlyAdd].join('|')")],
  ['조건: 공포 모드를 모의 여부 없이','eng',s=>s.replace("rules:r==='panic'?((sess&&sess.paper)?'panic':'base'):(r||'base')","rules:r==='panic'?'panic':(r||'base')")],
  ['지문: 엔진 코드와 무관한 고정값','eng',s=>s.replace("const ENGINE_FP=(()=>{const s=String(jkPlanSessionEngine);","const ENGINE_FP=(()=>{const s='fixed';")],
  ['오늘 것: 평일 안 따짐','eng',s=>s.replace("function paperRunFresh(upto,cut){const w=weekdayOnOrBefore(cut);","function paperRunFresh(upto,cut){const w=String(cut||'');")],
  ['오늘 것: 늘 오늘 것','eng',s=>s.replace("return !!(upto&&w&&String(upto)>=w);}","return !!upto;}")],
  ['끝 날: 가장 늦은 날','eng',s=>s.replace("if(!d)return '';if(!end||d<end)end=d;","if(!d)return '';if(!end||d>end)end=d;")],
  ['흐름: 메모리 안 씀(늘 DB 읽기)','eng',s=>s.replace("const m=key?runMemo.get(key):null;if(m&&m.sig===sig)return m;","")],
  ['흐름: 메모리가 조건 안 봄','eng',s=>s.replace("const m=key?runMemo.get(key):null;if(m&&m.sig===sig)return m;","const m=key?runMemo.get(key):null;if(m)return m;")],
  ['흐름: 휴장일에도 다시 재생','eng',s=>s.replace("if(have&&end&&end<=have.upto)return keep();","if(have&&end&&end<have.upto)return keep();")],
  ['흐름: 시세 끊기면 저장본도 버림','eng',s=>s.replace("try{q=await io.quotes(opts.rules==='panic');}catch(e){if(have)return keep(String((e&&e.message)||e));throw e;}","q=await io.quotes(opts.rules==='panic');")],
  ['흐름: 저장본 먼저 안 그림','eng',s=>s.replace("if(have){if(typeof io.show==='function')io.show(have.R);","if(have){")],
  ['흐름: 저장 안 함','eng',s=>s.replace("else{try{await io.write(d);saved=true;}","else{try{saved=true;}")],
  ['흐름: 잊기가 안 지움','eng',s=>s.replace("function paperRunForget(key){runMemo.delete(String(key||''));}","function paperRunForget(key){}")],
  ['화면: 저장본 안 읽음(늘 재생)','plan',s=>s.replace("      read:()=>planPaperDocRead(x.id),write:d=>planPaperDocWrite(x.id,d),\n","      write:d=>planPaperDocWrite(x.id,d),\n")],
  ['화면: 다시 센 결과를 안 그림','plan',s=>s.replace("    if(assetPaperCache[x.id]!==got.R)show(got.R);","")],
  ['화면 첫 열기: 저장본만 길에서 시세·재생','plan',s=>s.replace("    if(storedOnly){const st=await E.paperRunStored(x,io);if(st)show(st.R);return st?st.R:null;}\n","")],
  ['화면 첫 열기: 시세를 다 받은 뒤에야 세션 화면(옛 순서)','plan',s=>s.replace("  await refreshLive({onState:()=>{planApplySessionLink();const a=activeAssetSession();if(a&&a.paper){renderAssetSessions();early=loadActiveAssetSessionView(false,true);}}});","  await refreshLive();")],
  ['화면 첫 열기: 실계좌 세션도 시세 전에 바꿈','plan',s=>s.replace("  if(early&&!(x&&x.paper))return;\n","")],
  ['화면: 세션 지워도 저장본 남김','plan',s=>s.replace("planPaperDocDelete(id).catch(e=>console.warn('asset paper store delete',e));","")],
  ['화면: 장부 저장 실패해도 저장본 지움','plan',s=>s.replace("  else if(x.paper){window.JKPlanSessionEngine","  if(x.paper){window.JKPlanSessionEngine")],
  ['목록: 선취가 늘 세 종목 받음','idx',s=>s.replace("  if(plans.length && await planPaperNeedQuotes(plans)) ['TECL','TQQQ','SGOV'].forEach(x=>px.add(x));","  if(plans.length) ['TECL','TQQQ','SGOV'].forEach(x=>px.add(x));")],
  ['목록: 지난번 담아 둔 시세로 새 봉 확인','idx',s=>s.replace("      await loadPlanPaperData(true,panic);","      await loadPlanPaperData(false,panic);")],
  ['목록: 저장본을 목록 칸에 안 넣음','idx',s=>s.replace("    PLAN_PAPER_CACHE[sess.id]=got.R; return got.R;","    return got.R;")],
  ['목록: 문서 자리가 화면과 다름','idx',s=>s.replace("f.doc(f.db,'users',curUid,'planPaper',String(id))","f.doc(f.db,'users',curUid,'planPapers',String(id))")],
  ['목록: 로그인 전에도 DB 씀','idx',s=>s.replace("return (f&&f.db&&curUid&&id)?","return (f&&f.db&&id)?")],
];

(async()=>{
  const bad=await check(SRC);
  if(bad.length){console.error('FAIL plan paper store\n  '+bad.join('\n  '));process.exit(1);}
  console.log('PASS 듀얼가드 모의 저장본: 묶기=풀기(무작위 200장면) · 조건(sig) · 오늘 것 · 흐름(처음·메모리·다른 창·새 봉·휴장·설정·실패) · 듀얼가드 화면 · 모의 목록(같은 문서·같은 값)');
  let red=0;
  for(const [name,key,mut] of MUT){
    const m=mut(SRC[key]);assert.notEqual(m,SRC[key],'변이 대상 없음: '+name);
    let failed=false;try{failed=(await check(Object.assign({},SRC,{[key]:m}),{scenes:24})).length>0;}catch(e){failed=true;}
    if(!failed){console.error('FAIL 변이가 통과함: '+name);process.exit(1);}
    red++;console.log('PASS 변이 빨간불: '+name);
  }
  console.log('ALL PASS plan paper store · 변이 '+red+'/'+MUT.length+' red');
})().catch(e=>{console.error(e);process.exit(1);});
