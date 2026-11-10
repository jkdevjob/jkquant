// 앱 엔진(저장소 루트 plan-session-engine.js)을 그대로 읽어 '공포 모드'(11-10 연구 · plan_rules panic)만 끼워 돌린다 — engine_var.js 와 같은 방식.
// 바꾸는 줄: ① SMA225 줄 뒤에 빠른 이평·VIX·VXN 배열과 상태 ② TECL 목표 변동성 줄(공포 뒤 슬리브 σ = min(σ20, k×VXN)) ③ 판정 뒤 Guard 덮어쓰기(무장·진정·빠른 모드).
// 규칙 벌: {hi, lo, ma, band, sleeve, k, fbK, noGuard} · 키가 없으면 기본(앱 그대로). 체결·수수료·배당·전일 종가 주수는 앱 엔진 그대로.
const fs=require('fs'),vm=require('vm'),path=require('path');
function series(s){ const m={}; JSON.parse(fs.readFileSync(path.join(__dirname,'..','data',s+'.json'),'utf8')).series.forEach(x=>{ if(x.close>0) m[x.date]=x.close; }); return m; }
function load(V){
  let src=fs.readFileSync(path.join(__dirname,'..','..','..','plan-session-engine.js'),'utf8');
  const A="const horizon=5,RULES=alphaRules(opt.rules);", B="const tma225=sma(S.tqqq,225);", C="const s0=D.ivsS0,w=Math.min(1,(s0*s0)/(sigma*sigma));", Dd="const {teclHit,guard,guardFlip,tqReb}=dec;";
  for(const x of [A,B,C,Dd]) if(!src.includes(x)) throw new Error('앱 엔진 모양이 바뀌었다 — engine_panic.js 의 바꿔 넣을 줄을 고칠 것: '+x.slice(0,40));
  src=src.replace(A,"const horizon=5,RULES=alphaRules(opt.rules); const __PV=__V[String(opt.rules||'')]||{};")
    .replace(B,"const tma225=sma(S.tqqq,225); const __fm=sma(S.tqqq,__PV.ma||50); const __ff=M=>{ let l=null; return S.dates.map(d=>{ if(M[d]!=null) l=M[d]; return l; }); }; const __vix=__ff(__VIX), __vxn=__ff(__VXN); const __st={armed:false,pf:false,armS:false,ps:false,gN:undefined};")
    .replace(C,"const s0=D.ivsS0; let __sig=sigma; if(__PV.sleeve){ const v=__vix[p]; if(v!=null&&v>=__PV.hi) __st.armS=true; if(__st.armS&&v!=null&&v<__PV.lo){ __st.ps=true; __st.armS=false; } const __iv=__vxn[p]!=null?__vxn[p]/100*(__PV.k??2.5):(__vix[p]!=null?__vix[p]/100*(__PV.fbK??3.0):null); if(__st.ps&&__iv!=null){ if(sigma<=__iv) __st.ps=false; else __sig=Math.min(sigma,__iv); } } const w=Math.min(1,(s0*s0)/(__sig*__sig));")
    .replace(Dd,"let {teclHit,guard,guardFlip,tqReb}=dec; if(__PV.hi){ const c=sp.TQQQ, up=mv*(1+RULES.guardOn), lo_=mv*(1-RULES.guardOff); if(__st.gN===undefined) __st.gN=c>mv; if(c>up) __st.gN=true; else if(c<lo_) __st.gN=false; const v=__vix[p], fm=__fm[p], b=__PV.band??0.02; if(v!=null&&v>=__PV.hi) __st.armed=true; if(__st.gN){ __st.pf=false; __st.armed=false; guard='ON'; } else if(!__st.pf){ guard='OFF'; if(!__PV.noGuard&&__st.armed&&v!=null&&v<__PV.lo&&fm>0&&c>fm*(1+b)){ __st.pf=true; guard='ON'; } } else { if(fm>0&&c>fm*(1+b)) guard='ON'; else if(fm>0&&c<fm*(1-b)) guard='OFF'; else guard=pos.TQQQ>0?'ON':'OFF'; } guardFlip=(guard==='ON')!==(pos.TQQQ>0); }");
  const ctx={__V:V||{},__VIX:series('VIX'),__VXN:series('VXN')}; vm.runInNewContext(src,ctx); return ctx.JKPlanSessionEngine;
}
module.exports={load};
