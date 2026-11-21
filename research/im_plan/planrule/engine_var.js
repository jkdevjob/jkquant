// 앱 엔진(저장소 루트 plan-session-engine.js)을 그대로 읽어 연구용 규칙 벌만 끼워 돌린다(11-09).
// 판정(alphaDecide · 공포 모드 panicStep) · 체결(전일 종가 주수 · 다음 날 종가) · 배당 · 수수료 줄은 그대로,
// '규칙 값을 고르는 줄'(alphaRules) · 'TECL 목표 변동성 줄'(s0 · σ 창 look) · 월 입금 줄(depEvery)만 바꿔 넣는다.
// 규칙 벌: {guardOn, guardOff, bandDn, bandUp, tqReb, s0?, look?, panic?} — 벌에 없는 이름('base' · 'panic')은 앱 규칙 그대로.
// 11-11: 앱 v3.128.0(공포 모드 v1.1 · alphaRules 가 base/panic 을 고르고 σ 줄이 sigUse 로 바뀜)에 맞춰 바꿔 넣을 줄을 고침 — 안 맞으면 멈춘다.
const fs=require('fs'),vm=require('vm'),path=require('path');
const P=[
  ["function alphaRules(key){const k=String(key&&key.key||key||'');return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}",
   "function alphaRules(key){const k=String(key&&key.key||key||'');if(__V[k])return Object.assign({key:k,name:k,tqReb:0,exp:true},__V[k]);return k==='panic'?ALPHA_RULES.panic:ALPHA_RULES.base;}"],
  ["const D=DEFAULTS[5],sigma=realizedVol(S.tecl,p,D.ivsLook),mv=tma225[p];",
   "const D=(RULES.tw!=null||RULES.gw!=null)?Object.assign({},DEFAULTS[5],RULES.tw!=null?{teclWeight:RULES.tw}:{},RULES.gw!=null?{guardWeight:RULES.gw}:{}):DEFAULTS[5],sigma=realizedVol(S.tecl,p,RULES.look??D.ivsLook),mv=tma225[p];"],   // look(11-11): TECL σ 창(거래일) — 안 주면 20 · tw/gw(11-12): TECL 몫 · TQQQ Guard 몫(안 주면 70/30)
  ["const s0=D.ivsS0,sigUse=pm?pm.sigma:sigma,",
   "const s0=(typeof RULES.s0==='function'?RULES.s0(S.dates[p]):RULES.s0)??D.ivsS0,sigUse=pm?pm.sigma:sigma,"   /* 11-14: s0 를 날짜 함수로도(전일 확정 바깥 정보 · null 이면 앱 값) */],
  // gOvl·wMul(11-12 · 새 정보원 시험): 전일(S.dates[p]) 확정 바깥 신호 — gOvl(날짜, 기본 판정) 이 'ON'/'OFF' 를 내면 Guard 를 덮어쓰고, wMul(날짜) 은 TECL 목표 비중에 곱한다. 안 주면 앱 그대로.
  ["w=Math.min(1,(s0*s0)/(sigUse*sigUse));",
   "w=Math.min(1,(s0*s0)/(sigUse*sigUse))*(RULES.wMul?RULES.wMul(S.dates[p]):1);"],
  ["if(pm){guard=pm.guard;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}",
   "if(pm){guard=pm.guard;guardFlip=(guard==='ON')!==(pos.TQQQ>0);} if(RULES.gOvl){const __g=RULES.gOvl(S.dates[p],guard);if(__g&&__g!==guard){guard=__g;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}}"],
  // opt.depEvery(11-10): 월 입금 간격(달) — 2·3·6·12 면 달마다 monthlyAdd 를 쌓아 두었다가 (월−1)%depEvery===0 인 달 첫 거래일에 한꺼번에 넣는다(그날만 전체 맞춤). 안 주면 앱 그대로(매달).
  ["let cash=principal,inflow=principal,", "let __pend=0,cash=principal,inflow=principal,"],
  ["      cash+=monthlyAdd;inflow+=monthlyAdd;addCash(ledger,date,'dep',monthlyAdd,seq++);lastMonth=month;force=true;",
   "      __pend+=(opt.depAmt?opt.depAmt(date,i,S):monthlyAdd);lastMonth=month;if(!(opt.depEvery>1)||(+month.slice(5,7)-1)%opt.depEvery===0){cash+=__pend;inflow+=__pend;addCash(ledger,date,'dep',__pend,seq++);__pend=0;force=true;}"],
  // opt.depAmt(11-18 ⑬): 입금 날(달 첫 거래일) 넣을 금액을 함수로(date, i, S) — 안 주면 monthlyAdd 그대로(앱과 같음)
  // holdT(11-11 · 사용자 "굳이 팔지 말고 가만히 기다리면?"): TECL 은 절대 팔지 않는다 — 목표가 지금 보유보다 작으면 보유 그대로(사기만 함). 안 주면 앱 그대로.
  ["const tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;",
   "const tt=(teclHit||force||first)?Math.max(RULES.holdT?pos.TECL:0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;"],
  // 11-12 '다시 사는 쪽'(사용자 "공포 모드 켜놨어, 다시 사는 쪽 연구 바로 해봐") — 공포 모드 panicStep 고리. 규칙 벌의 panic 묶음에 아래 이름이 없으면 앱 그대로:
  //   bOff(빠른 모드 끄는 선만 SMA(ma)×(1−bOff) · 켜는 선은 band 그대로) · cool(빠른 모드 매도 뒤 n 거래일은 빠른 재진입 없음) · oneShot(빠른 모드 첫 매도에서 빠른 모드·무장 끝)
  //   ts(무장 뒤 VIX÷VIX3M < ts 이고 VIX < hi 면 '진정' 으로도 봄 · RULES.tsAt(날짜) 가 비율을 줌) · rel(무장 뒤 VIX ≤ rel×무장 뒤 최고 VIX 이고 VIX < hi 면 '진정' 으로도 봄)
  ["let sigma=a.sigma;",
   "let sigma=a.sigma;if(P.cool)st.t=(st.t||0)+1;const __calm=pk=>v!=null&&(v<P.lo||(P.ts!=null&&a.ts!=null&&a.ts<P.ts&&v<P.hi)||(P.rel!=null&&pk>0&&v<=P.rel*pk&&v<P.hi));"],
  ["if(st.armS&&v!=null&&v<P.lo){st.ps=true;st.armS=false;ev.push('sleeveOn');}",
   "if(P.rel!=null){if(st.armS)st.pkS=Math.max(st.pkS||0,v||0);else st.pkS=0;}if(st.armS&&__calm(st.pkS||0)){st.ps=true;st.armS=false;ev.push('sleeveOn');}"],
  ["if(v!=null&&v>=P.hi)st.armed=true;",
   "if(v!=null&&v>=P.hi)st.armed=true;if(P.rel!=null){if(st.armed)st.pk=Math.max(st.pk||0,v||0);else st.pk=0;}"],
  ["if(st.armed&&v!=null&&v<P.lo&&fm>0&&c>fm*(1+b)){st.pf=true;guard='ON';ev.push('fastOn');}",
   "if(st.armed&&__calm(st.pk||0)&&fm>0&&c>fm*(1+b)&&!(P.cool&&st.t<(st.cu||0))){st.pf=true;guard='ON';ev.push('fastOn');}"],
  ["else guard=(fm>0&&c>fm*(1+b))?'ON':(fm>0&&c<fm*(1-b))?'OFF':(a.posOn?'ON':'OFF');",
   "else{guard=(fm>0&&c>fm*(1+b))?'ON':(fm>0&&c<fm*(1-(P.bOff??b)))?'OFF':(a.posOn?'ON':'OFF');if(P.cool&&guard==='ON'&&!a.posOn&&st.t<(st.cu||0))guard='OFF';if(guard==='OFF'&&a.posOn){if(P.cool)st.cu=st.t+P.cool;if(P.oneShot){st.pf=false;st.armed=false;st.pk=0;}}}"],
  ["const panicAt=(st,p,posOn,sigma,mv)=>panicStep(st,{rules:RULES,vix:vixA[p],vxn:vxnA[p],tqqqClose:S.tqqq[p],sma:mv,fast:fastMA[p],sigma,posOn});",
   "const panicAt=(st,p,posOn,sigma,mv)=>panicStep(st,{rules:RULES,vix:vixA[p],vxn:vxnA[p],tqqqClose:S.tqqq[p],sma:mv,fast:fastMA[p],sigma,posOn,ts:RULES.tsAt?RULES.tsAt(S.dates[p]):null});"],
  // 11-13 고리: depBuy(입금 날 신호가 없으면 TECL·TQQQ 를 목표까지 사기만 — 넘친 쪽은 안 팖) · tqVol{s0,look,band}(Guard ON 동안 TQQQ 목표 = 30% × min(1,(s0/σ)²) · 슬리브 밴드 넘으면 맞춤). 안 주면 앱 그대로.
  ["Math.max(RULES.holdT?pos.TECL:0,", "Math.max((RULES.holdT||(RULES.depBuy&&force&&!teclHit&&!first))?pos.TECL:0,"],
  ["need=teclHit||guardFlip||tqReb||force||first||sgNew;",
   "const __wq=(RULES.tqVol&&guard==='ON')?Math.min(1,Math.pow(RULES.tqVol.s0/Math.max(1e-9,realizedVol(S.tqqq,p,RULES.tqVol.look||20)||RULES.tqVol.s0),2)):1,__qHit=!!(RULES.tqVol&&guard==='ON'&&!guardFlip&&pos.TQQQ>0&&Math.abs(((pos.TQQQ*sp.TQQQ)/Math.max(total,1))/D.guardWeight-__wq)>(RULES.tqVol.band??.10));need=teclHit||guardFlip||tqReb||force||first||sgNew||__qHit;"],
  ["const tq=(guardFlip||tqReb||force||first)?(guard==='ON'?Math.max(0,Math.floor(total*D.guardWeight/sp.TQQQ)):0):pos.TQQQ;",
   "const tq=(guardFlip||tqReb||force||first||__qHit)?(guard==='ON'?Math.max((RULES.depBuy&&force&&!guardFlip&&!tqReb&&!first&&!__qHit)?pos.TQQQ:0,Math.floor(total*D.guardWeight*__wq/sp.TQQQ)):0):pos.TQQQ;"],
  // 11-16 고리 decHold(날짜): 그날(전일 확정) TECL 이 목표보다 많아도 TECL 을 팔지 않음(밴드 맞춤 · 입금 날 맞춤 모두 — 12월 실현이익을 다음 해로 미루는 시험) · 안 주면 앱 그대로
  ["let {teclHit,guard,guardFlip,tqReb}=dec;", "let {teclHit,guard,guardFlip,tqReb}=dec; const __dh=!!(RULES.decHold&&sleeveNow>w&&RULES.decHold(S.dates[p])); if(__dh) teclHit=false;"],
  ["Math.max((RULES.holdT||(RULES.depBuy&&force&&!teclHit&&!first))?pos.TECL:0,", "Math.max((RULES.holdT||__dh||(RULES.depBuy&&force&&!teclHit&&!first))?pos.TECL:0,"],
  // 11-21 고리 relBand(k): TECL 밴드를 목표 비중에 비례(±k×w · 안 주면 앱 ±bandDn/bandUp) · relMin/relMax 로 한쪽만(좁히기만 = min(앱, k×w) · 넓히기만 = max)
  ["const teclHit=!(a.teclQty>0)||(a.sleeveNow-a.w>R.bandDn)||(a.w-a.sleeveNow>R.bandUp);",
   "const __kb=R.relBand!=null?R.relBand*a.w:null,__bd=__kb==null?R.bandDn:(R.relMode==='min'?Math.min(R.bandDn,__kb):R.relMode==='max'?Math.max(R.bandDn,__kb):__kb),__bu=__kb==null?R.bandUp:(R.relMode==='min'?Math.min(R.bandUp,__kb):R.relMode==='max'?Math.max(R.bandUp,__kb):__kb);const teclHit=!(a.teclQty>0)||(a.sleeveNow-a.w>__bd)||(a.w-a.sleeveNow>__bu);"],
  // 11-21 고리 noForce: 입금 날 전체 맞춤을 하지 않는다(입금 돈은 다음 신호 때 맞춤까지 현금) · 안 주면 앱 그대로
  ["addCash(ledger,date,'dep',__pend,seq++);__pend=0;force=true;}", "addCash(ledger,date,'dep',__pend,seq++);__pend=0;force=!RULES.noForce;}"],
  // 11-21 고리 gRamp(배열): Guard 가 바뀌면 TQQQ 를 배열의 비율대로 며칠에 나눠 맞춤(켜질 때 [1/3,2/3,1] 이면 첫날 1/3 · 둘째 날 2/3 · 셋째 날 전부 · 꺼질 때 거꾸로) · [0,1] = 하루 늦춰 한 번에(위약) · 안 주면 앱 그대로
  ["let __pend=0,cash=principal,inflow=principal,", "let __pend=0,__RP={d:null,k:0},cash=principal,inflow=principal,"],
  ["if(__g&&__g!==guard){guard=__g;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}}", "if(__g&&__g!==guard){guard=__g;guardFlip=(guard==='ON')!==(pos.TQQQ>0);}} let __rh=false,__rf=1;if(RULES.gRamp){const __A=RULES.gRamp,__n=__A.length;if(__RP.d==null){__RP.d=guard;__RP.k=__n;}else if(__RP.d!==guard){__RP.d=guard;__RP.k=1;}else if(__RP.k<__n){__RP.k++;__rh=true;}__rf=__A[Math.min(__RP.k,__n)-1];}"],
  ["||sgNew||__qHit;", "||sgNew||__qHit||__rh;"],
  ["const tq=(guardFlip||tqReb||force||first||__qHit)?(guard==='ON'?Math.max((RULES.depBuy&&force&&!guardFlip&&!tqReb&&!first&&!__qHit)?pos.TQQQ:0,Math.floor(total*D.guardWeight*__wq/sp.TQQQ)):0):pos.TQQQ;",
   "const tq=(guardFlip||tqReb||force||first||__qHit||__rh)?(guard==='ON'?Math.max(((RULES.depBuy&&force&&!guardFlip&&!tqReb&&!first&&!__qHit)||(RULES.gRamp&&__RP.k<RULES.gRamp.length))?pos.TQQQ:0,Math.floor(total*D.guardWeight*__wq*__rf/sp.TQQQ)):(RULES.gRamp?((1-__rf)>=1?pos.TQQQ:Math.min(pos.TQQQ,Math.floor(total*D.guardWeight*(1-__rf)/sp.TQQQ))):0)):pos.TQQQ;"],
  // 11-21 고리 depX(날짜 → 금액 · 포트폴리오 ⑮): 그달 첫 거래일에 월 입금에 더해 넣을 돈(나눠 넣기) — monthlyAdd 가 0 이어도 그 달만 입금·전체 맞춤 · 안 주면 앱 그대로
  ["    if(month!==lastMonth&&monthlyAdd>0){", "    const __dx=(opt.depX&&month!==lastMonth)?(+opt.depX(date)||0):0;if(month!==lastMonth&&(monthlyAdd>0||__dx>0)){"],
  ["__pend+=(opt.depAmt?opt.depAmt(date,i,S):monthlyAdd);", "__pend+=(opt.depAmt?opt.depAmt(date,i,S):monthlyAdd)+__dx;"],
  // 11-21 고리 sgx{fee0, drag}(포트폴리오 ⑯): SGOV 자리를 수수료 없는 달러 이자로 — fee0 = SGOV 매매 수수료 0 · drag = SGOV 보유액에 매일 −drag/252(음수면 더함 · 이자가 SGOV 보다 높/낮음) · 안 주면 앱 그대로
  ["function replay(opt){\n  opt=opt||{};", "function replay(opt){\n  opt=opt||{};__SGX=opt.sgx||null;"],
  ["const q=-dq,p=px[sym],f=alphaFee(q,p),gross=q*p;", "const q=-dq,p=px[sym],f=(sym==='SGOV'&&__SGX&&__SGX.fee0)?0:alphaFee(q,p),gross=q*p;"],
  ["if(q>0){const f=alphaFee(q,p),gross=q*p;", "if(q>0){const f=(sym==='SGOV'&&__SGX&&__SGX.fee0)?0:alphaFee(q,p),gross=q*p;"],
  ["    const total=pos.TECL*S.tecl[i]+pos.TQQQ*S.tqqq[i]+pos.SGOV*(S.sgov[i]||0)+cash;", "    if(__SGX&&__SGX.drag&&pos.SGOV>0&&S.sgov[i]>0) cash-=pos.SGOV*S.sgov[i]*__SGX.drag/252;\n    const total=pos.TECL*S.tecl[i]+pos.TQQQ*S.tqqq[i]+pos.SGOV*(S.sgov[i]||0)+cash;"]];
function load(V){
  let src=fs.readFileSync(path.join(__dirname,'..','..','..','plan-session-engine.js'),'utf8');
  for(const [a,b] of P){ const n=src.split(a).length-1; if(n!==1) throw new Error(`앱 엔진 모양이 바뀌었다(${n}곳) — engine_var.js 의 바꿔 넣을 줄을 고칠 것: ${a.slice(0,50)}`); src=src.replace(a,()=>b); }
  const ctx={__V:V||{},__SGX:null}; vm.runInNewContext(src,ctx); return ctx.JKPlanSessionEngine;
}
module.exports={load};
