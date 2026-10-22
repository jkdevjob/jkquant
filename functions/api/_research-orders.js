// Broker plans reference already persisted research evidence. No signal discovery or fills here.
export const RESEARCH_BROKER_VERSION='research_kis_vts_v1';
export const BROKER_STRATEGIES=['gpt_daytrading','gpt_closing30','gpt_closing_bet','gpt_soxl','gpt_tenbagger'];
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const KR=/^(?:\d{6}|\d{4}[A-Z]\d)$/;
export const iso=ms=>new Date(ms).toISOString();
export function localClock(ms,zone='Asia/Seoul'){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)),g=t=>parts.find(x=>x.type===t)?.value;
 return {date:g('year')+'-'+g('month')+'-'+g('day'),hm:+g('hour')*100+ +g('minute')};
}
export function krAt(date,hm){const n=+String(hm).replace(':','');return Date.parse(date+'T'+String(Math.floor(n/100)).padStart(2,'0')+':'+String(n%100).padStart(2,'0')+':00+09:00');}
export function validateBrokerPlan(p,now=Date.now()){
 if(!p||!BROKER_STRATEGIES.includes(p.strategy)||!DATE.test(p.date)||!['buy','sell'].includes(p.side)||typeof p.sourceId!=='string'||!p.sourceId||p.sourceId.length>240||!p.variant||!p.sourceVersion)throw Error('invalid broker source');
 if(p.strategy==='gpt_soxl'?p.code!=='SOXL':!KR.test(p.code))throw Error('unsupported broker symbol');
 const due=Date.parse(p.dueAt),expires=Date.parse(p.expiresAt),clock=localClock(now,p.strategy==='gpt_soxl'?'America/New_York':'Asia/Seoul');
 if(!Number.isFinite(due)||!Number.isFinite(expires)||expires<=due||expires-due>6*60000)throw Error('invalid broker window');
 if(p.triggerAt&&(!Number.isFinite(Date.parse(p.triggerAt))||Date.parse(p.triggerAt)>due))throw Error('invalid broker trigger');
 if(p.side==='buy'&&['gpt_daytrading','gpt_soxl'].includes(p.strategy)&&(!Number.isFinite(Date.parse(p.exitDueAt))||Date.parse(p.exitDueAt)<=due))throw Error('invalid broker exit deadline');
 if(now<due||now>expires)return '신호 주문 가능 시각 경과 또는 미도래';
 const session=p.sessionDate||p.date;if(!DATE.test(session)||clock.date!==session)return '현재 거래일 신호 아님';
 if(p.side==='buy'&&p.strategy!=='gpt_tenbagger'&&p.date!==session)return '과거 매수 차단';
 const hm=clock.hm;
 if(p.strategy==='gpt_daytrading'&&(hm<1000||hm>(p.side==='buy'?1433:1512)))return '데이트레이딩 주문 시간 아님';
 if(p.strategy==='gpt_soxl'&&(hm<945||hm>1558||(p.side==='buy'&&hm>1136)))return 'SOXL 정규장 주문 시간 아님';
 if(p.strategy==='gpt_closing30'&&(p.side==='buy'?(hm<1507||hm>1509):(hm<1523||hm>1527)))return '종가 30분 주문 시간 아님';
 if(p.strategy==='gpt_closing_bet'&&(p.side==='buy'?(hm<1523||hm>1527):(hm<856||hm>859)))return '종가 베팅 주문 시간 아님';
 if(p.strategy==='gpt_tenbagger'&&(hm<1523||hm>1527))return '텐배거 종가 주문 시간 아님';
 return '';
}
function plan(strategy,ledger,x,side,due,expires,extra={}){
 return {version:RESEARCH_BROKER_VERSION,strategy,date:ledger.date,sessionDate:ledger.date,sourceId:String(x.id),variant:ledger.mainVariant||'baseline',
  sourceVersion:x.strategyVersion||ledger.strategyVersion||'closing30_v1',code:x.code||'SOXL',name:x.name||x.code||'SOXL',side,dueAt:iso(due),expiresAt:iso(expires),
  referencePrice:side==='buy'?x.entryPrice:x.exitPrice,source:{ledgerDate:ledger.date,tradeId:x.id,params:x.strategyParams||ledger.strategyParams||null,signalTime:x.signalTime},...extra};
}
export function dayBrokerPlans(ledger,now=Date.now(),partial=false){
 if(!ledger||ledger.mode!=='server-live-paper-no-order')return [];
 return (ledger.trades||[]).flatMap(x=>{
  const out=[];if(!x.id||!x.code)return out;
  if(!partial){const due=krAt(ledger.date,x.entryTime||x.signalTime);if(Number.isFinite(due)&&x.entryPrice>0&&now>=due)out.push(plan('gpt_daytrading',ledger,x,'buy',due,due+3*60000,{exitDueAt:iso(krAt(ledger.date,1510))}));}
  if(x.status==='closed'){const due=krAt(ledger.date,x.exitTime)+60000;if(Number.isFinite(due))out.push(plan('gpt_daytrading',ledger,x,'sell',due,due+2*60000));}
  // Broker holdings still need a time exit when a research candle is missing.
  else if(now>=krAt(ledger.date,1510))out.push(plan('gpt_daytrading',ledger,x,'sell',krAt(ledger.date,1510),krAt(ledger.date,1512),{source:{tradeId:x.id,reason:'broker_session_deadline'}}));
  return out;
 });
}
export function soxlBrokerPlans(ledger,now=Date.now()){
 if(!ledger||ledger.mode!=='server-live-paper-no-order'||ledger.strategy!=='soxl')return [];
 return (ledger.trades||[]).flatMap(x=>{
  const out=[];if(!x.id)return out;
  if(x.entryMs>0&&x.entryPrice>0&&x.deadlineMs>0&&now>=x.entryMs)out.push(plan('gpt_soxl',ledger,x,'buy',x.entryMs,x.entryMs+6*60000,{exitDueAt:iso(x.deadlineMs)}));
  const due=x.status==='closed'&&x.exitMs>0?x.exitMs+5*60000:x.deadlineMs;
  if(due>0&&now>=due)out.push(plan('gpt_soxl',ledger,x,'sell',due,due+3*60000,{source:{tradeId:x.id,reason:x.status==='closed'?x.reason:'broker_holding_deadline'}}));
  return out;
 });
}
export function closingBrokerPlans(ledger,kind,side,sessionDate,now=Date.now()){
 if(!ledger||(ledger.scans||[]).some(x=>x.partial))return [];
 const strategy=kind==='day'?'gpt_closing30':'gpt_closing_bet',stage=kind==='day'&&side==='sell'?'buy':'signal';
 const due=krAt(sessionDate,kind==='day'&&side==='buy'?1507:kind==='overnight'&&side==='sell'?856:1523);
 return (ledger.events||[]).filter(x=>x.kind===kind&&x.stage===stage&&x.variant==='baseline').map(x=>{
  const sourceId=[kind,x.variant,x.code].join(':');
  return plan(strategy,{...ledger,mainVariant:'baseline'},{...x,id:sourceId},side,due,due+(kind==='overnight'&&side==='sell'?3:kind==='day'&&side==='buy'?2:4)*60000,{sessionDate,triggerAt:x.createdAt,source:{eventId:x.id,ledgerDate:ledger.date,kind,params:x.strategyParams,recordedAt:x.createdAt}});
 });
}
export function tenbaggerBrokerPlans(data,previousSession,today,exitArm,now=Date.now()){
 if(!data?.ok||data.schemaVersion!==1||!['hold1260','stop12_trail35'].includes(exitArm)||data.asOf!==previousSession||data.source?.asOf!==previousSession)return [];
 const due=krAt(today,1523),expiry=krAt(today,1527);
 return (data.records||[]).flatMap(x=>{
  const arm=x.arms?.[exitArm];if(!arm||!x.id||!KR.test(x.code)||x.rulesSha256!==data.rulesSha256||x.revisionDates?.length||['reference_or_action_review','missing_session_or_settlement_unknown'].includes(x.dataStatus))return [];
  const entry=!x.entryDate&&x.registeredDate===previousSession&&x.signalDate<=previousSession&&Date.parse(x.registeredAt)<krAt(today,0);
  const exit=!!x.entryDate&&arm.exitSignalDate===previousSession&&!arm.exitDate;
  if(!entry&&!exit)return [];
  const sourceId=x.id+':'+exitArm;
  return [plan('gpt_tenbagger',{date:x.registeredDate,mainVariant:x.pattern+'.'+exitArm,strategyVersion:x.strategyVersion},{...x,id:sourceId},entry?'buy':'sell',due,expiry,
   {sessionDate:today,exitArm,triggerAt:x.registeredAt,source:{recordId:x.id,registeredAt:x.registeredAt,signalDate:x.signalDate,exitSignalDate:arm.exitSignalDate,rulesSha256:x.rulesSha256,sourceAsOf:data.asOf,pattern:x.pattern,exitArm}})];
 });
}
export async function sendResearchPlans(env,plans){
 if(!plans.length)return [];
 const origin=String(env.OPENING_WORKER_URL||'https://jkquant-opening-scheduler.mumae4.workers.dev').replace(/\/$/,''),out=[];
 for(const p of plans){
  // A missed/old event is retained locally; enabling a switch never replays it.
  if(validateBrokerPlan(p))continue;
  const r=await fetch(origin+'/research-execute',{method:'POST',headers:{'x-monitor-key':env.MONITOR_KEY,'content-type':'application/json'},body:JSON.stringify(p)}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'research broker HTTP '+r.status);out.push(j);
 }return out;
}
export async function reconcileResearchBroker(env){
 const origin=String(env.OPENING_WORKER_URL||'https://jkquant-opening-scheduler.mumae4.workers.dev').replace(/\/$/,'');
 const r=await fetch(origin+'/research-reconcile',{method:'POST',headers:{'x-monitor-key':env.MONITOR_KEY,'content-type':'application/json'},body:'{}'});
 if(!r.ok)throw Error('research broker reconciliation HTTP '+r.status);
}
