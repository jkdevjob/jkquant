// Shared read model for Today, history and trend. Original events remain immutable.
export const CLOSING_KINDS={closing30:'day',closing_bet:'overnight'};
export const closingNumber=v=>v==null||v===''||!Number.isFinite(+v)?null:+v;
export const closingMain=(ledger,kind)=>String(ledger?.paperMainVariants?.[kind]||'baseline');
export function flattenClosingLedger(ledger){
  if(!ledger||!Array.isArray(ledger.events))return [];
  const map=new Map();
  const order={signal:0,buy:1,sell:2};
  for(const e of ledger.events.filter(x=>x&&['day','overnight'].includes(x.kind)&&x.variant&&x.code&&x.stage in order)
    .slice().sort((a,b)=>order[a.stage]-order[b.stage])){
    const id=[e.date||ledger.date,e.kind,e.variant,e.code].join(':');
    let x=map.get(id);
    if(!x){x={id,date:e.date||ledger.date,kind:e.kind,variant:e.variant,code:e.code,name:e.name||e.code,
      signalTime:null,entryTime:null,exitTime:null,entryPrice:null,exitPrice:null,pnl:null,status:'signal',
      source:'closing30-paper-live',strategyVersion:e.strategyVersion||e.decisionVersion||'closing30_v1',
      strategyParams:e.strategyParams||null,main:e.variant===closingMain(ledger,e.kind)};map.set(id,x);}
    if(e.strategyParams)x.strategyParams=e.strategyParams;
    if(e.stage==='signal'){x.signalTime=e.priceAt||e.signal?.signalTime||e.createdAt;x.signal=e.signal||null;}
    if(e.stage==='buy'){x.entryTime=e.priceAt||e.createdAt;x.entryPrice=closingNumber(e.price);x.status=x.entryPrice>0?'open':'unverified';x.outcomes=e.outcomes||null;}
    if(e.stage==='sell'){x.exitTime=e.priceAt||e.createdAt;x.exitPrice=closingNumber(e.price);x.pnl=closingNumber(e.pnl);
      x.outcomes=e.outcomes||null;x.status=x.entryPrice>0&&x.exitPrice>0&&x.pnl!==null?'closed':'unverified';}
  }
  return [...map.values()];
}
export function closingCoverage(ledger,kind,settled=false){
  const target=kind==='day'?1506:1522;
  const scans=ledger?.scans||[],scan=scans.find(x=>+x.targetHm===target);
  const good=x=>x&&!x.partial&&!(x.failed||[]).length&&!(+x.quoteErrors);
  const settle=scans.find(x=>+x.targetHm===1540);
  return {signalRecorded:!!scan,signalComplete:!!good(scan),settlementRecorded:!!settle,
    complete:!!good(scan)&&(!settled||!!good(settle))};
}
export function closingDaySummary(ledger,strategy,{settled=true}={}){
  const kind=CLOSING_KINDS[strategy];
  if(!ledger||!kind)return null;
  const all=flattenClosingLedger(ledger).filter(x=>x.kind===kind&&x.main),closed=all.filter(x=>x.status==='closed');
  const coverage=closingCoverage(ledger,kind,settled),complete=coverage.complete&&closed.length===all.length;
  const sum=closed.reduce((s,x)=>s+x.pnl,0);
  return {date:ledger.date,returnPct:complete?sum/3:null,sumPnlPct:closed.length?sum:complete?0:null,
    realizedReturnPct:coverage.signalComplete?sum/3:null,slots:3,trades:all.length,closed:closed.length,
    open:all.filter(x=>x.status==='open').length,pendingTrades:all.filter(x=>x.status==='signal').length,
    unverified:all.filter(x=>x.status==='unverified').length,wins:closed.filter(x=>x.pnl>0).length,
    losses:closed.filter(x=>x.pnl<0).length,noTrade:complete&&!all.length,finalized:complete,
    incomplete:!complete,source:'closing30-paper-live',pnlBasis:'strategy-paper',
    mainVariant:closingMain(ledger,kind),strategyVersion:'close30-paper-v1',generatedAt:ledger.updatedAt,
    updatedAt:ledger.updatedAt,scanCoverage:coverage,positions:all,
    reason:!coverage.complete?'종가 감시/마감 원본 확인 필요':complete?'종가 연구 모의장부 · 비용 후 3슬롯 손익':'체결·청산 원본 확정 대기'};
}
export async function readClosingLedger(env,date,{timeoutMs=5000}={}){
  const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'').trim();
  if(!key)throw Error('closing monitor key missing');
  const base=String(env.OPENING_WORKER_URL||'https://jkquant-opening-scheduler.mumae4.workers.dev').replace(/\/$/,'');
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeoutMs);
  try{const r=await fetch(base+'/closing-ledger?date='+encodeURIComponent(date),{headers:{'x-monitor-key':key,accept:'application/json'},signal:ac.signal});
    const j=await r.json();if(!r.ok||j.ok!==true)throw Error(j.error||'closing ledger HTTP '+r.status);
    if(j.ledger&&j.ledger.date!==date)throw Error('closing ledger date mismatch');return j.ledger||null;
  }finally{clearTimeout(timer);}
}
