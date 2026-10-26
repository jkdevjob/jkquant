// One Durable Object owns research broker identities, intents and receipts.
// Paper returns never enter this store. An accepted order is not a fill.
import {defaultPaperSettings,validPaperSettings,withPaperDefaults} from './_paper-trading.js';
import {validateBrokerPlan,localClock,BROKER_STRATEGIES} from './_research-orders.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers});
const stamp=()=>new Date().toISOString();
export const positionKey=p=>['p',p.strategy,p.date,p.sourceId].join(':');
const orderId=v=>String(v||'').replace(/^0+(?=\d)/,'');
const pending=o=>o?.orderNo&&['accepted','partial'].includes(o.status);
export function exactOrderFill(op,rows,code,side){
 const a=(rows||[]).filter(x=>orderId(x.orderNo)===orderId(op.orderNo)&&x.code===code&&String(x.sideCode)===(side==='buy'?'02':'01')&&String(x.orderDate).replaceAll('-','')===op.orderDate.replaceAll('-',''));
 if(!a.length)throw Error('해당 전략 주문번호의 체결 원본 없음');
 const x=a.sort((a,b)=>+b.fillQty- +a.fillQty)[0],qty=+x.fillQty;
 if(!Number.isSafeInteger(qty)||qty<0||qty>op.qty||qty>0&&!(x.fillPrice>0))throw Error('체결 수량/가격 원본 확인 필요');
 return {fillQty:qty,fillPrice:qty>0?+x.fillPrice:null,fillAmount:qty>0?+x.fillAmount||qty*+x.fillPrice:0,remainingQty:+x.remainingQty||0,
  status:qty===op.qty?'filled':x.canceled?'canceled':+x.rejectedQty===op.qty?'rejected':qty>0?'partial':'accepted',
  canceled:x.canceled===true,orderDate:x.orderDate,orderTime:x.orderTime};
}
async function settings(env){
 const st=env.SIGNAL_STORE.get(env.SIGNAL_STORE.idFromName('__paper_settings__'));
 const r=await st.fetch('https://opening-signal.internal/paper-settings'),j=await r.json();
 const value=withPaperDefaults(j.settings||defaultPaperSettings());if(!r.ok||!j.ok||!validPaperSettings(value))throw Error('모의투자 설정 원본 확인 실패');return value;
}
async function relay(env,action,p,extra={}){
 const url=String(env.BASE_URL||'https://jkquant.pages.dev').replace(/\/$/,'')+'/api/research-kis';
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),18000);
 try{
  const r=await fetch(url,{method:'POST',headers:{'x-monitor-key':env.MONITOR_KEY,'content-type':'application/json'},body:JSON.stringify({action,plan:p,...extra}),signal:ac.signal});
  const j=await r.json();if(!r.ok&&action!=='order'&&action!=='cancel')throw Error(j.error||'KIS 조회 HTTP '+r.status);
  return {...j,httpStatus:r.status};
 }finally{clearTimeout(timer);}
}
const pause=()=>new Promise(r=>setTimeout(r,1200));
async function save(st,key,change){
 return st.transaction(async tx=>{
  const p=await tx.get(key);if(!p)throw Error('broker position missing');
  const result=change(p);p.updatedAt=stamp();await tx.put(key,p);return result??p;
 });
}
async function remember(tx,key,p){
 const dates=await tx.get('dates')||[],items=await tx.get('date:'+p.date)||[];
 await tx.put({[key]:p,dates:[...new Set([...dates,p.date])].sort(),['date:'+p.date]:[...new Set([...items,key])]});
}
async function track(st,key,yes){
 await st.transaction(async tx=>{const a=await tx.get('pending')||[];await tx.put('pending',yes?[...new Set([...a,key])]:a.filter(x=>x!==key));});
}
async function refresh(st,env,key){
 let p=await st.get(key);if(!p)return null;
 for(const side of ['buy','sell']){
  // A terminal fill is immutable ownership evidence, including years-old tenbagger buys.
  const op=p.operations[side];if(!op?.orderNo||!['accepted','partial'].includes(op.status))continue;
  const result=await relay(env,'orders',p.plan,{side,orderNo:op.orderNo,orderDate:op.orderDate});await pause();
  const fill=exactOrderFill(op,result.orders,p.plan.code,side);
  p=await save(st,key,state=>{
   const current=state.operations[side];
   if((current.fillQty||0)>fill.fillQty)throw Error('체결 수량 감소 · 원본 확인 필요');
   if(JSON.stringify(current.fill)!==JSON.stringify(fill))state.events.push({phase:'fill',side,at:stamp(),orderNo:op.orderNo,...fill});
   state.operations[side]={...current,...fill,fill,verifiedAt:stamp()};state.lastError=null;
  });
 }
 await track(st,key,['buy','sell'].some(side=>pending(p.operations[side])));return p;
}
function denied(p,conf,now){
 if(!conf.enabled)return '전략 모의투자 OFF';
 const reason=validateBrokerPlan(p,now);if(reason)return reason;
 if(p.side==='buy'&&(!conf.enabledSince||Date.parse(p.triggerAt||p.dueAt)<Date.parse(conf.enabledSince)))return 'ON 이전 신호 소급주문 차단';
 if(p.strategy==='gpt_tenbagger'&&p.side==='buy'&&(p.exitArm!==conf.exitArm||p.source?.pattern!==conf.pattern))return '선택한 텐배거 가격 가설/청산군 아님';
 return '';
}
async function claim(st,p,operation,blocked=''){
 const key=positionKey(p);
 return st.transaction(async tx=>{
  let row=await tx.get(key);
  if(row&&(row.plan.code!==p.code||row.plan.variant!==p.variant))throw Error('원본 주문 정체성 충돌');
  if(row?.operations[p.side])return {claimed:false,position:row};
  if(p.side==='buy'&&!blocked){
   const owned=await tx.get('owned:'+p.strategy+':'+p.code);
   if(owned&&owned!==key){
    const prior=await tx.get(owned),b=prior?.operations.buy,s=prior?.operations.sell;
    const released=['not_submitted','rejected'].includes(b?.status)||(b?.status==='canceled'&&!b.fillQty)||(s?.status==='filled'&&s.fillQty===b?.fillQty);
    if(!released)blocked='동일 전략·종목의 기존 보유/주문 확인 필요';
   }
  }
  row=row||{schema:1,key,date:p.date,plan:p,createdAt:stamp(),updatedAt:stamp(),operations:{},events:[]};
  const rec=blocked?{status:'not_submitted',reason:blocked,at:stamp(),qty:0,orderNo:''}:{status:'unverified',at:stamp(),...operation};
  row.operations[p.side]=rec;row.events.push({phase:blocked?'not_submitted':'intent',side:p.side,at:rec.at,plan:p,...rec});
  if(p.side==='buy'&&!blocked)row.entrySettings=operation.settings;
  await remember(tx,key,row);
  if(!blocked){
   // Recovery indexes belong to the same transaction as the intent, before HTTP.
   await tx.put('pending',[...new Set([...(await tx.get('pending')||[]),key])]);
   if(p.side==='buy'){
    await tx.put('owned:'+p.strategy+':'+p.code,key);
    if(p.exitDueAt)await tx.put('watch',[...new Set([...(await tx.get('watch')||[]),key])]);
   }
  }
  return {claimed:!blocked,position:row};
 });
}
async function cancelRemaining(st,env,key,side){
 let p=await st.get(key),op=p?.operations[side];
 if(p?.plan.strategy!=='gpt_soxl'||!pending(op)||!(op.remainingQty>0))return p;
 const cancelSide='cancel_'+side;
 const claimed=await st.transaction(async tx=>{
  const v=await tx.get(key);if(v.operations[cancelSide])return false;
  const intent={status:'unverified',orderNo:op.orderNo,qty:op.remainingQty,at:stamp()};
  v.operations[cancelSide]=intent;v.events.push({phase:'cancel_intent',side,...intent});await tx.put(key,v);return true;
 });
 if(!claimed)return p;
 let receipt;
 try{receipt=await relay(env,'cancel',p.plan,{side,orderNo:op.orderNo,qty:op.remainingQty,market:op.market});}
 catch(e){receipt={error:String(e.message||e),outcomeUnknown:true};}
 await save(st,key,v=>{
  const status=receipt.ok===true?'accepted':receipt.raw?.rt_cd!=null&&String(receipt.raw.rt_cd)!=='0'?'rejected':'unverified';
  v.operations[cancelSide]={...v.operations[cancelSide],status,reason:receipt.msg||receipt.error||'',receipt};
  v.events.push({phase:'cancel_result',side,at:stamp(),status,receipt});
 });await pause();
 // A cancel receipt alone never proves that no more shares can fill.
 return refresh(st,env,key);
}
async function execute(st,env,p,now){
 validateBrokerPlan(p,now);const key=positionKey(p),s=await settings(env),conf=s.strategies[p.strategy];
 const block=denied(p,conf,now);if(block)return {...await claim(st,p,{},block),ok:true};
 let row=await st.get(key);if(row?.operations[p.side])return {ok:true,duplicate:true,position:row};
 let qty=0,quote,fx=null;
 if(p.side==='sell'){
  if(!row?.operations.buy?.orderNo)return {...await claim(st,p,{},'이 전략의 접수된 매수 주문 없음'),ok:true};
  row=await refresh(st,env,key);
  if(pending(row.operations.buy))row=await cancelRemaining(st,env,key,'buy');
  const buy=row.operations.buy;
  if(!['filled','canceled'].includes(buy.status))throw Error('매수 미체결 잔량 확인 전 매도 보류');
  qty=buy.fillQty||0;
  if(!qty)return {...await claim(st,p,{},'해당 주문번호의 매수 체결수량 0'),ok:true};
 }
 quote=await relay(env,'quote',p);await pause();
 if(!(quote.price>0))throw Error('현재 주문 기준 시세 없음');
 let price=0,priceType='market',market='KRX';
 if(p.strategy==='gpt_soxl'){
  priceType='limit';market=quote.market;
  if(!['AMEX','NYSE','NASD'].includes(market))throw Error('SOXL 거래소 확인 실패');
  // Marketable limit is still a limit: partial/unfilled quantities remain explicit.
  price=Math.round(quote.price*(p.side==='buy'?1.005:.995)*100)/100;
  if(p.side==='buy'){
   fx=await relay(env,'fx',p);await pause();
   const at=Date.parse(fx.asof||fx.date+'T00:00:00Z');
   if(!(fx.rate>0)||!Number.isFinite(at)||now-at>4*864e5||at>now+60000)throw Error('SOXL 원화 환산 환율 확인 실패');
   qty=Math.floor(conf.budget/fx.rate/price);
  }
 }else if(p.side==='buy')qty=Math.floor(conf.budget/(quote.price*1.03));
 if(!(qty>0))return {...await claim(st,p,{},'종목당 예산 내 주문수량 0'),ok:true};
 // Recheck after queries/queueing, then atomically persist before the only order HTTP.
 const latest=await settings(env),fresh=denied(p,latest.strategies[p.strategy],Date.now());
 if(fresh||latest.revision!==s.revision)return {...await claim(st,p,{},fresh||'주문 준비 중 설정 변경'),ok:true};
 const claimed=await claim(st,p,{qty,price,priceType,market,orderDate:p.sessionDate||localClock(now,p.strategy==='gpt_soxl'?'America/New_York':'Asia/Seoul').date,
  quote,fx,settings:{revision:s.revision,budget:conf.budget,enabledSince:conf.enabledSince,exitArm:conf.exitArm||null}});
 if(!claimed.claimed)return {ok:true,duplicate:true,position:claimed.position};
 let receipt;
 try{receipt=await relay(env,'order',p,{side:p.side,qty,price,priceType,market,settingsRevision:s.revision});}
 catch(e){receipt={error:String(e.message||e),outcomeUnknown:true};}
 const status=receipt.ok===true&&receipt.orderNo?'accepted':receipt.notSubmitted?'not_submitted':receipt.raw?.rt_cd!=null&&String(receipt.raw.rt_cd)!=='0'?'rejected':'unverified';
 const position=await save(st,key,v=>{
  v.operations[p.side]={...v.operations[p.side],status,orderNo:String(receipt.orderNo||''),reason:receipt.msg||receipt.error||'',receipt};
  v.events.push({phase:'result',side:p.side,at:stamp(),status,receipt});
 });
 await track(st,key,!!position.operations[p.side].orderNo);
 await pause();return {ok:true,position};
}
async function reconcile(st,env,now){
 const waiting=await st.get('pending')||[],watch=await st.get('watch')||[],keys=[...new Set([...waiting,...watch])],cursor=await st.get('cursor')||0;
 // Old inquiries must never push a fresh holding past its mandatory exit window.
 const priority=[];for(const key of watch){const p=await st.get(key),due=Date.parse(p?.plan.exitDueAt);if(due>0&&now>=due&&now<=due+120000&&!p.operations.sell)priority.push(key);}
 const rotated=keys.length?Array.from({length:keys.length},(_,i)=>keys[(cursor+i)%keys.length]):[];
 const selected=[...new Set([...priority,...rotated])].slice(0,Math.max(5,priority.length));
 const result=[];for(const key of selected){
  try{
   let p=waiting.includes(key)?await refresh(st,env,key):await st.get(key);if(!p)continue;
   const clock=localClock(now,p.plan.strategy==='gpt_soxl'?'America/New_York':'Asia/Seoul');
   if(p.plan.strategy==='gpt_soxl'&&clock.date===(p.operations.sell?.orderDate||p.operations.buy?.orderDate)&&clock.hm>=930&&clock.hm<1600){
    const conf=(await settings(env)).strategies.gpt_soxl;
    if(conf.enabled)for(const side of ['buy','sell']){
     const op=p.operations[side];if(pending(op)&&now-Date.parse(op.at)>=120000)p=await cancelRemaining(st,env,key,side);
    }
   }
   const deadline=Date.parse(p.plan.exitDueAt);
   if(deadline>0&&now>=deadline&&now<=deadline+120000&&!p.operations.sell){
    const conf=(await settings(env)).strategies[p.plan.strategy];
    if(conf.enabled)await execute(st,env,{...p.plan,side:'sell',dueAt:new Date(deadline).toISOString(),expiresAt:new Date(deadline+120000).toISOString(),source:{...p.plan.source,reason:'broker_session_deadline'}},now);
   }
   p=await st.get(key);
   if(deadline>0&&now>deadline+120000||p.operations.sell?.status==='filled')await st.transaction(async tx=>{await tx.put('watch',(await tx.get('watch')||[]).filter(x=>x!==key));});
   result.push({key,ok:true});
  }catch(e){await save(st,key,p=>{p.lastError=String(e.message||e);});result.push({key,ok:false,error:String(e.message||e)});}
 }await st.put('cursor',keys.length?(cursor+selected.length)%keys.length:0);return {ok:true,checked:result};
}
export async function researchBroker(st,env,request){
 const url=new URL(request.url),now=Date.now();
 try{
  if(request.method==='GET'){
   const from=url.searchParams.get('from')||'2000-01-01',to=url.searchParams.get('to')||'9999-12-31',strategy=url.searchParams.get('strategy')||'all';
   if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||strategy!=='all'&&!BROKER_STRATEGIES.includes(strategy))return json({ok:false,error:'invalid broker history filter'},400);
   const dates=(await st.get('dates')||[]).filter(d=>d>=from&&d<=to),positions=[];
   for(const d of dates)for(const key of await st.get('date:'+d)||[]){const p=await st.get(key);if(p&&(strategy==='all'||p.plan.strategy===strategy))positions.push(p);}
   return json({ok:true,version:'research_kis_vts_v1',positions});
  }
  if(request.method!=='POST')return json({ok:false,error:'method not allowed'},405);
  if(url.pathname.endsWith('reconcile'))return json(await reconcile(st,env,now));
  const p=await request.json();return json(await execute(st,env,p,now));
 }catch(e){return json({ok:false,error:String(e.message||e)},/invalid|unsupported/.test(String(e.message))?400:503);}
}
