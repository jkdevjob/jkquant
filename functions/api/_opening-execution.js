// KIS order receipts are separate evidence from strategy paper prices/returns.
const codeValid=v=>/^(?:\d{6}|\d{4}[A-Z]\d)$/.test(v);
const clean=(v,n=500)=>String(v??'').slice(0,n);
export function openingOrderRefs(date,buys=[],sells=[]){
 const out=[];
 for(const [side,rows] of [['buy',buys],['sell',sells]]){
  const by=new Map();for(const x of Array.isArray(rows)?rows:[]){
   const code=String(x?.code||'').toUpperCase();if(!codeValid(code))continue;
   const signalId=['opening',date,code,String(x.entryTime||''),side].join(':');
   by.set(signalId,{signalId,side,code});
  }out.push(...[...by.values()].slice(0,20));
 }return out;
}
export function openingExecutionResult(intent,response={},httpStatus=0,error=''){
 response=response&&typeof response==='object'?response:{};
 const receipts=intent.requests.map(ref=>{
  const e=(Array.isArray(response.events)?response.events:[]).find(e=>e.signalId===ref.signalId),v=e?.vts||{};
  const status=response.enabled===false?'not_submitted':!e?'unverified':
   v.rejected?'rejected':v.ok===true&&v.orderNo?'accepted':!e.submittedAt?'not_submitted':'unverified';
  return {...ref,status,requestedQty:Number.isSafeInteger(e?.qty)&&e.qty>=0?e.qty:null,
   orderNo:clean(v.orderNo,80),submittedAt:e?.submittedAt?clean(e.submittedAt,40):null,
   reason:clean(v.msg||response.reason||response.error||error||(!e?'개별 주문 응답 없음':''))};
 });
 const counts=Object.fromEntries(['accepted','rejected','not_submitted','unverified'].map(k=>[k,receipts.filter(r=>r.status===k).length]));
 return {id:intent.id+':result',attemptId:intent.id,phase:'result',date:intent.date,at:new Date().toISOString(),
  processingOk:httpStatus>=200&&httpStatus<300&&response.ok===true,enabled:response.enabled===true,
  ordersOk:receipts.length>0&&counts.accepted===receipts.length,counts,receipts,error:clean(error||response.error)};
}
function sideState(attempts,side){
 const rows=attempts.filter(a=>a.side===side);if(!rows.length)return 'unrecorded';
 // A later duplicate/OFF observation must not erase an accepted order receipt.
 if(rows.some(a=>a.status==='accepted'))return 'accepted';
 if(rows.some(a=>a.status==='unverified'))return 'unverified';
 return rows.at(-1).status;
}
export function mergeOpeningBroker(...brokers){
 const by=new Map();for(const b of brokers)for(const a of b?.attempts||[]){const old=by.get(a.id);if(!old||!old.resultRecorded)by.set(a.id,a);}
 const attempts=[...by.values()].sort((a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id));
 return {kind:'kis-vts',attempts,buy:sideState(attempts,'buy'),sell:sideState(attempts,'sell'),settlement:'unverified',pnl:null};
}
export function openingBroker(events,signalIds){
 const wanted=new Set(signalIds),results=new Map((events||[]).filter(e=>e.phase==='result').map(e=>[e.attemptId,e]));
 const attempts=[];
 for(const intent of events||[]){if(intent.phase!=='intent')continue;
  const result=results.get(intent.id);
  for(const ref of intent.requests||[]){if(!wanted.has(ref.signalId))continue;
   const receipt=result?.receipts?.find(r=>r.signalId===ref.signalId);
   attempts.push({id:intent.id+':'+ref.signalId,at:result?.at||intent.at,...ref,
    status:receipt?.status||'unverified',requestedQty:receipt?.requestedQty??null,orderNo:receipt?.orderNo||'',
    submittedAt:receipt?.submittedAt||null,reason:receipt?.reason||'주문 처리 결과 원본 미기록 · 자동 재주문 안 함',resultRecorded:!!receipt});
  }
 }return mergeOpeningBroker({attempts});
}
export function openingOwnedQty(ledger,signal,orders){
 const refs=openingOrderRefs(ledger.date,[signal],[signal]),broker=openingBroker(ledger.executionEvents,refs.map(x=>x.signalId));
 const norm=v=>String(v||'').replace(/^0+(?=\d)/,'');
 let buyQty=0,soldQty=0;
 for(const side of ['buy','sell']){
  const ids=new Set(broker.attempts.filter(a=>a.side===side&&a.status==='accepted'&&a.orderNo).map(a=>norm(a.orderNo)));
  const by=new Map();for(const x of orders||[]){
   if(x.code!==signal.code||!ids.has(norm(x.orderNo))||x.sideCode!==(side==='buy'?'02':'01')||String(x.orderDate).replaceAll('-','')!==ledger.date.replaceAll('-',''))continue;
   const prior=by.get(norm(x.orderNo));if(!prior||+x.fillQty>+prior.fillQty)by.set(norm(x.orderNo),x);
  }
  // Incomplete inquiry must not reuse a previous quantity or another strategy's shares.
  if(by.size!==ids.size)throw Error('시초가 주문번호별 체결 원본 미확인');
  for(const x of by.values()){
   if(!Number.isSafeInteger(+x.fillQty)||+x.fillQty<0||+x.remainingQty>0)throw Error('시초가 미체결 잔량/수량 확인 필요');
   if(side==='buy')buyQty+=+x.fillQty;else soldQty+=+x.fillQty;
  }
 }
 return {qty:Math.max(0,buyQty-soldQty),buyQty,soldQty,error:buyQty?'':'시초가 VTS 매수 체결수량 0'};
}
