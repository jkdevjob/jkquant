// 앱 엔진(저장소 루트 plan-session-engine.js)을 그대로 읽어 연구용 규칙 벌만 끼워 돌린다(11-09).
// 앱 엔진은 2026-11-08 부터 규칙 하나(base)만 받는다 — 판정(alphaDecide) · 체결(전일 종가 주수 · 다음 날 종가) · 배당 · 수수료 줄은 그대로,
// '규칙 값을 고르는 줄'(alphaRules)과 'TECL 목표 변동성 줄'(s0)만 바꿔 넣는다. 규칙 벌: {guardOn, guardOff, bandDn, bandUp, tqReb, s0?}
const fs=require('fs'),vm=require('vm'),path=require('path');
function load(V){
  let src=fs.readFileSync(path.join(__dirname,'..','..','..','plan-session-engine.js'),'utf8');
  const A="function alphaRules(key){return ALPHA_RULES.base;}", B="const s0=D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));";
  if(!src.includes(A)||!src.includes(B)) throw new Error('앱 엔진 모양이 바뀌었다 — engine_var.js 의 바꿔 넣을 줄을 고칠 것');
  src=src.replace(A,"function alphaRules(key){const k=String(key&&key.key||key||'');return (__V[k]?Object.assign({key:k,name:k,tqReb:0,exp:true},__V[k]):null)||ALPHA_RULES.base;}")
         .replace(B,"const s0=RULES.s0??D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));");
  // opt.depEvery(11-10): 월 입금 간격(달) — 2·3·6·12 면 달마다 monthlyAdd 를 쌓아 두었다가 (월−1)%depEvery===0 인 달 첫 거래일에 한꺼번에 넣는다(그날만 전체 맞춤). 안 주면 앱 그대로(매달).
  const C1="let cash=principal,inflow=principal,", C2="      cash+=monthlyAdd;inflow+=monthlyAdd;addCash(ledger,date,'dep',monthlyAdd,seq++);lastMonth=month;force=true;";
  if(!src.includes(C1)||!src.includes(C2)) throw new Error('앱 엔진 입금 줄 모양이 바뀌었다 — engine_var.js 를 고칠 것');
  src=src.replace(C1,"let __pend=0,cash=principal,inflow=principal,")
         .replace(C2,"      __pend+=monthlyAdd;lastMonth=month;if(!(opt.depEvery>1)||(+month.slice(5,7)-1)%opt.depEvery===0){cash+=__pend;inflow+=__pend;addCash(ledger,date,'dep',__pend,seq++);__pend=0;force=true;}");
  const ctx={__V:V||{}}; vm.runInNewContext(src,ctx); return ctx.JKPlanSessionEngine;
}
module.exports={load};
