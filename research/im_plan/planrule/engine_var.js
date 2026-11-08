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
  const ctx={__V:V||{}}; vm.runInNewContext(src,ctx); return ctx.JKPlanSessionEngine;
}
module.exports={load};
