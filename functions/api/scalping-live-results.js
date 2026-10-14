// Owner-only, read-only current session view. Never scans, places orders, sends alerts,
// rewrites ledgers, or replaces completed historical results with intraday values.
import {ownerAuthorized} from './global-paper.js';
import {tzParts,shiftIso,isNyseSessionDate} from './scalping-daily-results.js';
import {krxDay} from './_krx_calendar.js';

const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const WORKERS={opening:'https://jkquant-opening-scheduler.mumae4.workers.dev',daytrading:'https://jkquant-daytrading-scheduler.mumae4.workers.dev',crypto:'https://jkquant-global-intraday-scheduler.mumae4.workers.dev',soxl:'https://jkquant-global-intraday-scheduler.mumae4.workers.dev'};
const LABELS={opening:'시초가',daytrading:'데이트레이딩',crypto:'비트코인',soxl:'SOXL'};
const numeric=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:HEADERS});

function sessionClock(strategy,now=Date.now()){
  const k=tzParts('Asia/Seoul',now),n=tzParts('America/New_York',now);
  const activeUS=strategy==='soxl'&&isNyseSessionDate(n.date)&&n.hm>=930&&n.hm<1605;
  const marketDate=strategy==='soxl'?(activeUS?n.date:shiftIso(k.date,-1)):k.date;
  const date=strategy==='soxl'?shiftIso(marketDate,1):k.date;
  const hm=strategy==='soxl'?n.hm:k.hm;
  const start=strategy==='opening'?905:strategy==='daytrading'?1000:strategy==='crypto'?5:930;
  const end=strategy==='opening'?931:strategy==='daytrading'?1515:strategy==='crypto'?2359:1605;
  const marketClosed=strategy==='soxl'?!isNyseSessionDate(marketDate):strategy==='crypto'?false:krxDay(marketDate).closed;
  return {strategy,date,marketDate:strategy==='soxl'?marketDate:null,ledgerDate:marketDate,now,hm,start,end,activeUS,
    before:strategy==='soxl'?activeUS?false:marketDate===n.date&&hm<start:hm<start,
    ended:strategy==='soxl'?!activeUS:hm>=end,marketClosed};
}
function baseRow(clock){
  return {date:clock.date,marketDate:clock.marketDate,live:true,finalized:false,source:clock.strategy==='opening'?'opening-signal-live':clock.strategy==='daytrading'?'daytrading-paper-live':'global-paper-live',
    returnPct:null,realizedReturnPct:null,trades:0,open:0,pendingTrades:0,closed:0,wins:0,losses:0,noTrade:false,
    updatedAt:null,stale:false,reason:'',positions:[]};
}
function missingRow(clock,error=''){
  const row=baseRow(clock);
  if(clock.marketClosed)return {...row,state:'market_closed',marketClosed:true,reason:'해당 시장 비개장일'};
  if(clock.before&&!error)return {...row,state:'scheduled',reason:(clock.strategy==='crypto'?'00:05':clock.strategy==='opening'?'09:05':clock.strategy==='daytrading'?'10:00':'09:30 ET')+'부터 서버 감시 · 시작 전'};
  return {...row,state:'unavailable',reason:error||'오늘 서버 장부 미확인 · 실행/원천 확인 필요'};
}
function freshness(row,clock){
  const at=Date.parse(row.updatedAt||'');
  if(!Number.isFinite(at)){row.stale=true;return row;}
  const limit=['crypto','soxl'].includes(clock.strategy)?8*60000:3*60000;
  let due=clock.now;
  if(clock.ended&&clock.strategy!=='soxl'){
    due=Math.min(due,Date.parse(clock.ledgerDate+'T'+String(clock.end).padStart(4,'0').replace(/(\d{2})(\d{2})/,'$1:$2')+':00+09:00'));
  }
  // U.S. completed session is not expected to keep receiving overnight updates.
  if(clock.before||clock.strategy==='soxl'&&!clock.activeUS)due=at;
  row.stale=due-at>limit||at-clock.now>90000;
  return row;
}
function summarizePaperLedger(strategy,ledger,now=Date.now()){
  const clock=sessionClock(strategy,now);
  if(clock.marketClosed)return missingRow(clock);
  if(!ledger)return missingRow(clock);
  if(String(ledger.date)!==clock.ledgerDate)return missingRow(clock,'서버 장부 날짜 불일치 · 전일 값을 당일로 표시하지 않음');
  if(String(ledger.mode||'').startsWith('historical-research'))return missingRow(clock,'과거 연구 이관 자료는 장중 원본이 아님');
  if(!Array.isArray(ledger.trades))return missingRow(clock,'서버 장부 거래 배열 누락');
  const a=ledger.trades,row=baseRow(clock),slots=Math.max(1,numeric(ledger.slots)||numeric(ledger.maxTrades)|| (strategy==='daytrading'?3:1));
  row.updatedAt=ledger.updatedAt||null;row.mainVariant=ledger.mainVariant||'baseline';row.trades=a.length;row.slots=slots;
  const closed=a.filter(x=>x.status==='closed'),open=a.filter(x=>x.status==='open'),pending=a.filter(x=>x.status==='pending');
  row.closed=closed.length;row.open=open.length;row.pendingTrades=pending.length;
  const realized=closed.map(x=>numeric(strategy==='daytrading'?x.pnl:x.pnlPct));
  const current=a.map(x=>x.status==='closed'?numeric(strategy==='daytrading'?x.pnl:x.pnlPct):x.status==='open'?numeric(strategy==='daytrading'?x.unrealizedPnl:x.pnlPct):null);
  row.realizedReturnPct=realized.every(x=>x!==null)?realized.reduce((a,b)=>a+b,0)/slots:null;
  row.returnPct=a.length===closed.length+open.length&&current.every(x=>x!==null)?current.reduce((a,b)=>a+b,0)/slots:null;
  row.wins=realized.filter(x=>x>0).length;row.losses=realized.filter(x=>x!==null&&x<0).length;
  row.positions=a.map(x=>({name:x.name||x.code||(strategy==='crypto'?'KRW-BTC':'SOXL'),status:x.status,signalTime:x.signalTime,entryTime:x.entryTime,exitTime:x.exitTime}));
  row.noTrade=!a.length;
  row.state=open.length?'holding':pending.length?'entry_pending':closed.length?'closed':clock.before?'scheduled':'no_signal';
  if(a.length&&a.length!==closed.length+open.length+pending.length||closed.length&&realized.some(x=>x===null)){row.state='unavailable';row.reason='거래 상태/확정 손익 누락';row.returnPct=null;}
  else row.reason=ledger.decision?.reason|| (row.noTrade?(clock.ended?'현재 장부에 신호 없음 · 감시 종료':'현재까지 조건 미충족 · 감시 중'):'서버 원본 모의장부 · 보유 평가손익은 잠정값');
  if(row.state==='scheduled')row.reason=missingRow(clock).reason;
  return freshness(row,clock);
}
function summarizeOpeningLedger(ledger,now=Date.now()){
  const clock=sessionClock('opening',now);
  if(clock.marketClosed)return missingRow(clock);
  if(!ledger)return missingRow(clock);
  if(String(ledger.date)!==clock.ledgerDate)return missingRow(clock,'시초가 원본 날짜 불일치');
  if(!Array.isArray(ledger.scans)||!Array.isArray(ledger.events))return missingRow(clock,'시초가 원본 감시/신호 누락');
  const scans=ledger.scans.slice().sort((a,b)=>(a.targetHm-b.targetHm)||String(a.capturedAt).localeCompare(String(b.capturedAt)));
  const latest=scans.at(-1),variant=String(ledger.mainVariant||'baseline');
  if(!latest)return missingRow(clock);
  const events=ledger.events.filter(e=>e&&e.variant===variant&&['buy','sell'].includes(e.stage));
  const positions=new Map();
  for(const e of events){
    const s=e.signal||{},id=String(e.code||s.code)+':'+String(s.entryTime||'');
    if(e.stage==='buy')positions.set(id,{name:e.name||e.code,signalTime:s.signalTime,entryTime:s.entryTime,status:'open',pnl:null});
  }
  for(const e of events.filter(e=>e.stage==='sell')){
    const s=e.signal||{},id=String(e.code||s.code)+':'+String(s.entryTime||'');
    const p=positions.get(id);if(p)Object.assign(p,{status:'closed',exitTime:s.exitTime,pnl:numeric(s.pnl)});
  }
  const row=baseRow(clock),a=[...positions.values()],closed=a.filter(x=>x.status==='closed');
  row.updatedAt=latest.capturedAt||ledger.updatedAt||null;row.mainVariant=variant;row.positions=a;row.trades=a.length;row.open=a.length-closed.length;row.closed=closed.length;
  const pn=closed.map(x=>x.pnl);row.realizedReturnPct=pn.length&&pn.every(x=>x!==null)?pn.reduce((a,b)=>a+b,0)/Math.max(1,a.length):null;
  row.returnPct=!row.open&&pn.every(x=>x!==null)?(pn.length?pn.reduce((a,b)=>a+b,0)/pn.length:0):null;
  row.wins=pn.filter(x=>x>0).length;row.losses=pn.filter(x=>x!==null&&x<0).length;
  const partial=!!latest.partial||latest.okShards!==5||Number(latest.quoteErrors||0)>0||(latest.failed||[]).length>0;
  row.state=row.open?'holding':closed.length?'closed':partial?'unavailable':'no_signal';
  row.noTrade=!a.length&&!partial;
  row.reason=partial?'부분 감시/시세 오류 · 원본 신호 누락 가능':clock.ended?'09:30까지 감시한 원본 신호 · 감시 종료':'현재까지 감시한 원본 신호 · 신호 없음이면 다음 1분봉 확인';
  if(partial){row.sourceWarning=row.reason;if(!a.length)row.returnPct=null;}
  if(pn.some(x=>x===null)){row.state='unavailable';row.reason='청산 원본 손익 누락';row.returnPct=null;}
  return freshness(row,clock);
}
async function readLedger(strategy,env,now){
  const clock=sessionClock(strategy,now);if(clock.marketClosed||clock.before)return null;
  const key=String(strategy==='opening'?(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||''):(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'')).trim();
  if(!key)throw new Error('서버 장부 조회 키 미설정');
  const envName=strategy==='opening'?'OPENING_WORKER_URL':strategy==='daytrading'?'DAYTRADING_WORKER_URL':'GLOBAL_INTRADAY_WORKER_URL';
  const base=String(env[envName]||WORKERS[strategy]).replace(/\/$/,'');
  const q=new URLSearchParams({date:clock.ledgerDate});if(['crypto','soxl'].includes(strategy))q.set('strategy',strategy);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const r=await fetch(base+(strategy==='opening'?'/events?':'/paper?')+q,{signal:controller.signal,headers:{accept:'application/json','x-monitor-key':key}});
    const j=await r.json();if(!r.ok||j.ok!==true)throw new Error(j.error||'원본 조회 HTTP '+r.status);return j.ledger||null;
  }finally{clearTimeout(timer);}
}
export async function onRequestGet({request,env}){
  if(!await ownerAuthorized(request,env))return json({ok:false,error:'unauthorized'},401);
  const now=Date.now(),kstDate=tzParts('Asia/Seoul',now).date;
  const strategies=await Promise.all(Object.keys(LABELS).map(async strategy=>{
    try{
      const l=await readLedger(strategy,env,now),current=strategy==='opening'?summarizeOpeningLedger(l,now):summarizePaperLedger(strategy,l,now);
      return {strategy,label:LABELS[strategy],current};
    }catch(e){return {strategy,label:LABELS[strategy],current:missingRow(sessionClock(strategy,now),'원본 조회 실패 · '+String(e.message||e))};}
  }));
  return json({ok:true,kstDate,generatedAt:new Date(now).toISOString(),strategies});
}
export {sessionClock,summarizePaperLedger,summarizeOpeningLedger};
