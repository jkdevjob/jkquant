// Research broker settings. Research/paper calculations do not depend on this switch.
export const PAPER_STRATEGIES=Object.freeze([
 {id:'gpt_opening',group:'연구(지피티)',label:'시초가 돌파',supported:true,description:'국내 시장가 · 오전 진입/09:30 청산'},
 {id:'gpt_daytrading',group:'연구(지피티)',label:'데이트레이딩',supported:true,description:'국내 시장가 · 당시 운영 메인 · 최대 3종목 · 15:10 청산'},
 {id:'gpt_closing30',group:'연구(지피티)',label:'종가 30분',supported:true,description:'15:07 시장가 매수 → 15:23 종가 동시호가 시장가 매도'},
 {id:'gpt_closing_bet',group:'연구(지피티)',label:'개별 종목 종가 베팅',supported:true,description:'15:23 종가 동시호가 매수 → 다음 거래일 08:56 시가 동시호가 매도'},
 {id:'gpt_crypto',group:'연구(지피티)',label:'비트코인',supported:false,description:'한투 BTC 현물 주문 미지원 · Upbit KRW-BTC 연구·이력은 계속 수집'},
 {id:'gpt_soxl',group:'연구(지피티)',label:'SOXL',supported:true,description:'미국 지정가(현재가 대비 매수 +0.5% / 매도 −0.5%) · 원화 예산을 조회 환율로 환산 · 미체결 잔량 취소/확인'},
 {id:'gpt_tenbagger',group:'연구(지피티)',label:'텐배거',supported:true,description:'등록 이후 첫 거래일 종가 동시호가 · 선택한 가격 가설/청산군만 주문'},
]);
export const PAPER_WORKER='https://jkquant-opening-scheduler.mumae4.workers.dev';
export function defaultPaperSettings(){return {schema:1,revision:0,updatedAt:null,strategies:Object.fromEntries(PAPER_STRATEGIES.map(s=>[s.id,{enabled:false,budget:2000000}]))};}
export function validPaperSettings(value){
 if(!value||value.schema!==1||!Number.isSafeInteger(value.revision)||value.revision<0)return false;
 return PAPER_STRATEGIES.every(s=>{const v=value.strategies?.[s.id];return v&&typeof v.enabled==='boolean'&&(!v.enabled||s.supported)&&Number.isSafeInteger(v.budget)&&v.budget>=10000&&v.budget<=100000000&&(!v.enabledSince||Number.isFinite(Date.parse(v.enabledSince)))&&(s.id!=='gpt_tenbagger'||(v.exitArm==null||['hold1260','stop12_trail35'].includes(v.exitArm))&&(v.pattern==null||['trend200','breakout252','pullback50'].includes(v.pattern)));});
}
export function changePaperSettings(current,patch,at=new Date().toISOString()){
 if(!validPaperSettings(current))throw Error('설정 원본 오류');
 if(!patch||patch.expectedRevision!==current.revision){const e=Error('다른 화면에서 설정이 바뀌었습니다. 다시 불러오세요.');e.status=409;throw e;}
 const next=structuredClone(current);
 if(patch.allOff===true){for(const s of PAPER_STRATEGIES)next.strategies[s.id].enabled=false;}
 else{
  const def=PAPER_STRATEGIES.find(s=>s.id===patch.strategy);
  if(!def||typeof patch.enabled!=='boolean'||(patch.enabled&&!def.supported)||!Number.isSafeInteger(patch.budget)||patch.budget<10000||patch.budget>100000000)throw Error('전략 또는 주문 예산이 올바르지 않습니다.');
  const prior=current.strategies[def.id],exitArm=patch.exitArm??prior.exitArm??null;
  const pattern=patch.pattern??prior.pattern??null;
  if(def.id==='gpt_tenbagger'&&((patch.enabled&&(!exitArm||!pattern))||(exitArm!=null&&!['hold1260','stop12_trail35'].includes(exitArm))||(pattern!=null&&!['trend200','breakout252','pullback50'].includes(pattern))))throw Error('텐배거 가격 가설과 청산군을 선택해 주세요.');
  next.strategies[def.id]={...prior,enabled:patch.enabled,budget:patch.budget,
   enabledSince:patch.enabled?(prior.enabled?prior.enabledSince||at:at):null,
   ...(def.id==='gpt_tenbagger'?{exitArm,pattern}:{} )};
 }
 next.revision++;next.updatedAt=at;return next;
}
export async function readPaperSettings(env){
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'').trim();if(!key)throw Error('모의투자 설정 조회 키 없음');
 const origin=String(env.OPENING_WORKER_URL||PAPER_WORKER).replace(/\/$/,'');
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),4000);
 try{const r=await fetch(origin+'/paper-settings',{headers:{'x-monitor-key':key,accept:'application/json'},signal:ac.signal});const j=await r.json();
  if(!r.ok||!j.ok||!validPaperSettings(j.settings))throw Error('모의투자 설정 조회 실패');return j.settings;
 }finally{clearTimeout(timer);}
}
export async function paperPermission(env,strategy){
 if(String(env.SCALPING_VTS_AUTO||'1')==='0')return {enabled:false,reason:'전역 모의주문 중지'};
 const def=PAPER_STRATEGIES.find(s=>s.id===strategy);if(!def?.supported)return {enabled:false,reason:'한투 모의주문 미연결'};
 const settings=await readPaperSettings(env),v=settings.strategies[strategy];
 return {...v,revision:settings.revision,reason:v.enabled?'':'전략 모의투자 OFF'};
}
