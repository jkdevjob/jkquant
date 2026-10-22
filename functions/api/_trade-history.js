// Shared read models for original paper evidence and separately labelled research.
// Never infer a fill, a zero return or a parameter snapshot from a later strategy.
import {openingBroker,openingOrderRefs,mergeOpeningBroker} from './_opening-execution.js';
export const TRADE_STRATEGIES={opening:'시초가',daytrading:'데이트레이딩',crypto:'비트코인',soxl:'SOXL',closing30:'종가 30분',closing_bet:'개별 종목 종가 베팅',tenbagger:'텐배거 연구'};
export const variantValid=v=>/^[a-zA-Z0-9_.-]{1,80}$/.test(String(v||''));
export const number=v=>v==null||v===''||!Number.isFinite(+v)?null:+v;
export function time(v){
  if(v==null||v==='')return null;
  const s=String(v);if(s.includes(':')||s.includes('-'))return s;
  return s.padStart(4,'0').replace(/^(..)(..)$/,'$1:$2');
}
function params(v){if(v&&typeof v==='object')return v;try{return JSON.parse(v||'null');}catch{return null;}}
export function record(strategy,x,variant='baseline',origin='research-reconstructed',mainVariant=null){
  const entryTime=time(x.entryTime),signalTime=time(x.signalTime??x.entryTime),code=String(x.code||({crypto:'KRW-BTC',soxl:'SOXL'}[strategy])||'');
  const date=String(x.date||''),role=mainVariant?(variant===mainVariant?'main':'shadow'):(origin==='research-reconstructed'?'research':'shadow');
  const deadline=number(x.deadlineMs)||(['opening','daytrading'].includes(strategy)?Date.parse(date+'T'+(strategy==='opening'?'09:31':'15:11')+':00+09:00'):null);
  const expired=x.status==='open'&&deadline&&Date.now()>deadline;
  return {id:x.id||[strategy,date,variant,code,signalTime||''].join(':'),strategy,date,variant,role,
    code,name:x.name||code,timezone:x.timezone||(strategy==='soxl'?'America/New_York':'Asia/Seoul'),
    strategyVersion:x.strategyVersion||'',strategyParams:params(x.strategyParams),
    signalTime,entryTime,entryPrice:number(x.entryPrice),exitTime:time(x.exitTime),exitPrice:number(x.exitPrice),
    pnl:number(Object.hasOwn(x,'pnl')?x.pnl:x.pnlPct),unrealizedPnl:number(x.unrealizedPnl),reason:x.reason||null,
    status:expired?'unverified':x.status||(number(x.exitPrice)>0&&number(Object.hasOwn(x,'pnl')?x.pnl:x.pnlPct)!==null?'closed':number(x.entryPrice)>0?'open':'signal'),
    recordOrigin:origin,recordedAt:x.firstRecordedAt||x.capturedAt||x.updatedAt||null,
    evidence:x.evidence||null,events:x.events||[]};
}
export function paperRecords(strategy,ledger){
  if(!ledger?.date)return [];
  const main=String(ledger.mainVariant||'baseline');
  const sets=[{...ledger,variant:main},...Object.entries(ledger.shadowLedgers||{}).filter(([v])=>v!==main).map(([variant,l])=>({...l,variant}))];
  const out=[];
  for(const l of sets){
    const variant=l.variant,origin=ledger.mode==='historical-research-import-no-order'?'research-import':'server-paper';
    for(const x of l.trades||[])out.push(record(strategy,{...x,date:ledger.date,timezone:ledger.timezone,
      strategyVersion:x.strategyVersion||l.strategyVersion||ledger.strategyVersion,
      strategyParams:x.strategyParams||l.strategyParams||null,
      pnl:x.status==='closed'?(x.pnl??x.pnlPct):null,
      unrealizedPnl:x.status==='closed'?null:(x.unrealizedPnl??x.pnlPct)},variant,origin,main));
  }
  // Signals survive missing fills and partial scans; link them to the selected paper trade.
  const selected=new Set(out.map(x=>[x.variant,x.code,x.signalTime].join(':')));
  for(const e of ledger.signalEvents||[]){
    const variant=e.variant||main,key=[variant,String(e.code),time(e.signalTime)].join(':');
    if(selected.has(key))continue;
    out.push(record(strategy,{...e,date:ledger.date,entryTime:null,entryPrice:null,pnl:null,
      status:'signal',reason:e.selectionEligible===false?'partial_scan_unconfirmed':'not_selected_or_fill_pending'},variant,'server-signal',main));
  }
  return out;
}
export function openingRecords(ledger){
  if(!ledger?.date)return [];
  const by=new Map(),main=String(ledger.mainVariant||'baseline');
  for(const e of (ledger.events||[]).slice().sort((a,b)=>(+a.targetHm||0)-(+b.targetHm||0))){
    if(!['buy','sell'].includes(e.stage)||!e.code)continue;
    const s=e.signal||{},v=String(e.variant||s.variant||'baseline');
    const key=[v,e.strategyVersion||s.strategyVersion||'',e.code,s.entryTime??''].join(':');
    let r=by.get(key);
    if(!r){r=record('opening',{...s,id:['opening',ledger.date,key].join(':'),date:ledger.date,code:e.code,name:e.name,
      strategyVersion:e.strategyVersion||s.strategyVersion,strategyParams:e.strategyParams||s.strategyParams,
      capturedAt:e.capturedAt,evidence:s.evidence,exitTime:null,exitPrice:null,pnl:null,status:'unverified'},v,'server-signal',main);
      if(r.role==='main'){const ref={code:e.code,entryTime:s.entryTime};r.broker=openingBroker(ledger.executionEvents,openingOrderRefs(ledger.date,[ref],[ref]).map(x=>x.signalId));}
      by.set(key,r);}
    r.events.push({id:e.id,stage:e.stage,capturedAt:e.capturedAt||null,delivery:e.alertDelivery||null});
    if(e.stage==='buy'){r.entryTime=time(s.entryTime??e.targetHm);r.entryPrice=number(s.entryPrice);r.signalTime=r.entryTime;r.status=r.entryPrice>0?'open':'unverified';}
    if(e.stage==='sell'){
      r.exitTime=time(s.exitTime??e.targetHm);r.exitPrice=number(s.exitPrice);r.reason=s.reason||null;
      r.pnl=s.finalExitUnverified?null:number(s.pnl);
      r.status=r.entryPrice>0&&r.exitPrice>0&&r.pnl!==null?'closed':'unverified';
    }
  }
  return [...by.values()].map(x=>{
    return x.status==='open'&&Date.now()>Date.parse(x.date+'T09:31:00+09:00')?{...x,status:'unverified',reason:'opening_exit_not_recorded'}:x;
  });
}
export function closingRecords(ledger){
  if(!ledger?.date)return [];
  const by=new Map();
  for(const e of (ledger.events||[]).slice().sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')))){
    if(!['day','overnight'].includes(e.kind)||!e.variant||!e.code)continue;
    const strategy=e.kind==='day'?'closing30':'closing_bet',key=[strategy,ledger.date,e.variant,e.code].join(':');
    let r=by.get(key);
    if(!r){r=record(strategy,{id:key,date:ledger.date,code:e.code,name:e.name,strategyVersion:e.decisionVersion,
      strategyParams:e.strategyParams||e.signal?.strategyParams,capturedAt:e.createdAt,entryTime:null,status:'signal'},e.variant,'server-paper','baseline');by.set(key,r);}
    r.events.push({id:e.id,stage:e.stage,at:e.createdAt,source:e.source,price:number(e.price)});
    if(e.stage==='signal'){r.signalTime=e.signal?.cutoffTime||e.createdAt;r.evidence=e.signal||null;}
    if(e.stage==='buy'){r.entryTime=e.priceAt||e.createdAt;r.entryPrice=number(e.price);r.status=r.entryPrice>0?'open':'unverified';}
    if(e.stage==='sell'){r.exitTime=e.priceAt||e.createdAt;r.exitPrice=number(e.price);r.pnl=number(e.pnl);r.reason=e.kind==='day'?'closing_price':'next_session_open';r.status=r.entryPrice>0&&r.exitPrice>0&&r.pnl!==null?'closed':'unverified';}
  }
  return [...by.values()];
}
export function tenbaggerRecords(data){
  return (data?.records||[]).flatMap(x=>Object.entries(x.arms||{}).map(([arm,a])=>record('tenbagger',{
    id:x.id+':'+arm,date:x.entryDate||x.registeredDate||x.signalDate,code:x.code,name:x.name,
    strategyVersion:x.strategyVersion,strategyParams:{...data.rules?.parameters,pattern:x.pattern,arm,rulesSha256:x.rulesSha256},
    signalTime:x.signalDate,entryTime:x.entryDate,entryPrice:x.entryPrice,exitTime:a.exitDate,exitPrice:a.exitPrice,
    pnl:a.status==='closed'?a.netReturnPct:null,unrealizedPnl:a.status==='closed'?null:x.netMarkPct,status:a.status||'pending',
    reason:a.exitReason,capturedAt:x.registeredAt,evidence:{dataStatus:x.dataStatus,source:x.sourceSnapshot}},x.pattern+'.'+arm,'forward-research')));
}
// Keep research and observed evidence as separate records, even when their fills agree.
export function uniqueRecords(rows){
  const map=new Map();for(const x of rows){const k=x.recordOrigin+':'+x.strategy+':'+x.date+':'+x.variant+':'+x.code+':'+(x.signalTime||'');
    const old=map.get(k),chosen=old?.status==='closed'?old:x;
    map.set(k,old?.broker||x.broker?{...chosen,broker:mergeOpeningBroker(old?.broker,x.broker)}:chosen);}
  return [...map.values()];
}
export function filterRecords(rows,q){
  const strategy=q.get('strategy')||'all',variant=q.get('variant')||'all',status=q.get('status')||'all',origin=q.get('origin')||'all';
  const search=(q.get('symbol')||'').trim().toLowerCase(),from=q.get('from')||'',to=q.get('to')||'';
  return rows.filter(x=>(strategy==='all'||x.strategy===strategy)&&(!from||x.date>=from)&&(!to||x.date<=to)&&
    (variant==='all'||(variant==='main'||variant==='shadow'?x.role===variant:x.variant===variant))&&
    (status==='all'||x.status===status)&&(origin==='all'||(origin==='research'?x.recordOrigin.startsWith('research'):origin==='forward'?x.recordOrigin==='forward-research':x.recordOrigin.startsWith('server-')))&&
    (!search||(x.code+' '+x.name).toLowerCase().includes(search)))
    .sort((a,b)=>b.date.localeCompare(a.date)||String(b.entryTime||b.signalTime||'').localeCompare(String(a.entryTime||a.signalTime||''))||a.id.localeCompare(b.id));
}
export function recordsCsv(rows){
  const columns=['strategy','date','variant','role','code','name','status','signalTime','entryTime','entryPrice','exitTime','exitPrice','pnl','unrealizedPnl','timezone','recordOrigin','recordedAt','strategyVersion','strategyParams','reason','evidence','events','broker'];
  const cell=v=>{let s=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+@\t\r]/.test(s)||/^-(?!\d)/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+[columns.join(','),...rows.map(x=>columns.map(k=>cell(x[k])).join(','))].join('\r\n');
}
