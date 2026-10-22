// Research broker settings. Research/paper calculations do not depend on this switch.
export const PAPER_STRATEGIES=Object.freeze([
 {id:'gpt_opening',group:'연구(지피티)',label:'시초가 돌파',supported:true},
 {id:'gpt_daytrading',group:'연구(지피티)',label:'데이트레이딩',supported:false},
 {id:'gpt_closing30',group:'연구(지피티)',label:'종가 30분',supported:false},
 {id:'gpt_closing_bet',group:'연구(지피티)',label:'개별 종목 종가 베팅',supported:false},
 {id:'gpt_crypto',group:'연구(지피티)',label:'비트코인',supported:false},
 {id:'gpt_soxl',group:'연구(지피티)',label:'SOXL',supported:false},
 {id:'gpt_tenbagger',group:'연구(지피티)',label:'텐배거',supported:false},
]);
export const PAPER_WORKER='https://jkquant-opening-scheduler.mumae4.workers.dev';
export function defaultPaperSettings(){return {schema:1,revision:0,updatedAt:null,strategies:Object.fromEntries(PAPER_STRATEGIES.map(s=>[s.id,{enabled:false,budget:2000000}]))};}
export function validPaperSettings(value){
 if(!value||value.schema!==1||!Number.isSafeInteger(value.revision)||value.revision<0)return false;
 return PAPER_STRATEGIES.every(s=>{const v=value.strategies?.[s.id];return v&&typeof v.enabled==='boolean'&&(!v.enabled||s.supported)&&Number.isSafeInteger(v.budget)&&v.budget>=10000&&v.budget<=100000000;});
}
export function changePaperSettings(current,patch,at=new Date().toISOString()){
 if(!validPaperSettings(current))throw Error('설정 원본 오류');
 if(!patch||patch.expectedRevision!==current.revision){const e=Error('다른 화면에서 설정이 바뀌었습니다. 다시 불러오세요.');e.status=409;throw e;}
 const next=structuredClone(current);
 if(patch.allOff===true){for(const s of PAPER_STRATEGIES)next.strategies[s.id].enabled=false;}
 else{
  const def=PAPER_STRATEGIES.find(s=>s.id===patch.strategy);
  if(!def||typeof patch.enabled!=='boolean'||(patch.enabled&&!def.supported)||!Number.isSafeInteger(patch.budget)||patch.budget<10000||patch.budget>100000000)throw Error('전략 또는 주문 예산이 올바르지 않습니다.');
  next.strategies[def.id]={enabled:patch.enabled,budget:patch.budget};
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
