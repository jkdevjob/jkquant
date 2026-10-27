// Read-only projections shared by Today, history, trend and research. No orders.
import {closingRows,closingMainVariant} from './_closing30.js';
import {krxDay} from './_krx_calendar.js';
export const CLOSING_LABELS={closing30:'종가 30분',closing_bet:'개별 종목 종가 베팅'};
export const closingKind=strategy=>strategy==='closing_bet'?'overnight':'day';
export function closingResult(ledger,kind,now=Date.now(),variant=null){
 const date=ledger?.date||'',main=variant||closingMainVariant(ledger,kind);
 const rows=closingRows(ledger).filter(x=>x.kind===kind&&x.variant===main);
 const target=kind==='day'?1506:1522;
 const scans=(ledger?.scans||[]).filter(s=>Number(s.targetHm)===target);
 const good=scans.length>0&&scans.every(s=>!s.partial&&!(s.failed||[]).length&&!Number(s.quoteErrors||0));
 const closed=rows.filter(x=>x.status==='closed'),pnl=closed.map(x=>x.pnl);
 const local=new Date(now+9*3600000).toISOString(),today=local.slice(0,10),hm=Number(local.slice(11,16).replace(':',''));
 let exitDate=date;
 if(kind==='overnight'&&date){
  for(let i=0;i<31;i++){
   exitDate=new Date(Date.parse(exitDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   const calendar=krxDay(exitDate);if(!calendar.known)break;if(!calendar.closed)break;
  }
 }
 const due=kind==='day'?(date<today||date===today&&hm>=1541):(exitDate<today||exitDate===today&&hm>=907);
 const pending=rows.filter(x=>x.status==='signal').length,held=rows.filter(x=>x.status==='open').length;
 const incomplete=!good||rows.some(x=>x.status==='unverified')||due&&closed.length!==rows.length;
 const finalized=good&&!incomplete&&closed.length===rows.length;
 const sum=pnl.reduce((s,x)=>s+x,0),at=(ledger?.scans||[]).map(x=>x.capturedAt).filter(Boolean).sort().at(-1)||ledger?.updatedAt||null;
 return {date,mainVariant:main,source:'closing30-durable-paper-ledger',pnlBasis:'strategy-paper',slots:3,
  returnPct:finalized?sum/3:null,realizedReturnPct:good?sum/3:null,sumPnlPct:sum,
  trades:rows.length,closed:closed.length,open:held,pendingTrades:pending,wins:pnl.filter(x=>x>0).length,losses:pnl.filter(x=>x<0).length,
  noTrade:good&&!rows.length,finalized,incomplete,unavailable:incomplete,
  updatedAt:at,generatedAt:at,
  state:incomplete?'unavailable':held?'holding':pending?'entry_pending':closed.length?'closed':'no_signal',
  reason:!good?'종가 신호 감시 원본 누락/오류 · 매매 여부 확인 필요':incomplete?'체결/청산 가격 원본 확인 필요':
   kind==='overnight'&&held?'종가 매수 완료 · 다음 거래일 시가 청산 대기':held?'당일 15:30 종가 청산 대기':pending?'선정 완료 · 기준 체결가격 확인 대기':
   rows.length?'전략 모의손익 · 3개 고정 자금 슬롯 · 한투 체결정산과 별도':'감시 완료 · 조건 충족 종목 없음',
  positions:rows.map(x=>({name:x.name,code:x.code,status:due&&x.status!=='closed'?'unverified':x.status==='signal'?'pending':x.status,entryTime:x.entryTime,exitTime:x.exitTime}))};
}
export function closingDaily(ledgers,strategy,now=Date.now(),variant=null){
 return (ledgers||[]).map(l=>closingResult(l,closingKind(strategy),now,variant)).filter(x=>x.finalized).sort((a,b)=>a.date.localeCompare(b.date));
}
export async function readClosingLedgers(env,{from,to,date,limit=40}={}){
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'');if(!key)throw Error('종가 원장 조회 키 미설정');
 const base=String(env.OPENING_WORKER_URL||'https://jkquant-opening-scheduler.mumae4.workers.dev').replace(/\/$/,'');
 const q=new URLSearchParams(date?{date}:{kind:'closing30',from,to,limit:String(limit)});
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),5000);
 try{const r=await fetch(base+(date?'/closing-ledger?':'/event-history?')+q,{headers:{'x-monitor-key':key,accept:'application/json'},signal:ac.signal});
  const j=await r.json();if(!r.ok||!j.ok)throw Error(j.error||'종가 원장 HTTP '+r.status);
  if(j.sourceWarnings?.length)throw Error(j.sourceWarnings.join(' / '));
  return date?(j.ledger?[j.ledger]:[]):(j.ledgers||[]);
 }finally{clearTimeout(timer);}
}
