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
   "const D=DEFAULTS[5],sigma=realizedVol(S.tecl,p,RULES.look??D.ivsLook),mv=tma225[p];"],   // look(11-11): TECL σ 창(거래일) — 안 주면 20
  ["const s0=D.ivsS0,sigUse=pm?pm.sigma:sigma,",
   "const s0=RULES.s0??D.ivsS0,sigUse=pm?pm.sigma:sigma,"],
  // opt.depEvery(11-10): 월 입금 간격(달) — 2·3·6·12 면 달마다 monthlyAdd 를 쌓아 두었다가 (월−1)%depEvery===0 인 달 첫 거래일에 한꺼번에 넣는다(그날만 전체 맞춤). 안 주면 앱 그대로(매달).
  ["let cash=principal,inflow=principal,", "let __pend=0,cash=principal,inflow=principal,"],
  ["      cash+=monthlyAdd;inflow+=monthlyAdd;addCash(ledger,date,'dep',monthlyAdd,seq++);lastMonth=month;force=true;",
   "      __pend+=monthlyAdd;lastMonth=month;if(!(opt.depEvery>1)||(+month.slice(5,7)-1)%opt.depEvery===0){cash+=__pend;inflow+=__pend;addCash(ledger,date,'dep',__pend,seq++);__pend=0;force=true;}"],
  // holdT(11-11 · 사용자 "굳이 팔지 말고 가만히 기다리면?"): TECL 은 절대 팔지 않는다 — 목표가 지금 보유보다 작으면 보유 그대로(사기만 함). 안 주면 앱 그대로.
  ["const tt=(teclHit||force||first)?Math.max(0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;",
   "const tt=(teclHit||force||first)?Math.max(RULES.holdT?pos.TECL:0,Math.floor(total*D.teclWeight*w/sp.TECL)):pos.TECL;"]];
function load(V){
  let src=fs.readFileSync(path.join(__dirname,'..','..','..','plan-session-engine.js'),'utf8');
  for(const [a,b] of P){ const n=src.split(a).length-1; if(n!==1) throw new Error(`앱 엔진 모양이 바뀌었다(${n}곳) — engine_var.js 의 바꿔 넣을 줄을 고칠 것: ${a.slice(0,50)}`); src=src.replace(a,()=>b); }
  const ctx={__V:V||{}}; vm.runInNewContext(src,ctx); return ctx.JKPlanSessionEngine;
}
module.exports={load};
