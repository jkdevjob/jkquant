// Worker-only relay. Environment, symbol and order type cannot select a real account.
import {onRequestGet as kisGet,onRequestPost as kisPost,cancelSoxlVts} from './kis.js';
import {onRequestGet as fxGet} from './fx.js';
import {paperPermission} from './_paper-trading.js';
import {BROKER_STRATEGIES,validateBrokerPlan} from './_research-orders.js';
const json=(v,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'').trim();
 if(!key||request.headers.get('x-monitor-key')!==key)return json({error:'unauthorized'},401);
 const b=await request.json().catch(()=>null),p=b?.plan;
 if(!p||!BROKER_STRATEGIES.includes(p.strategy)||(p.strategy==='gpt_soxl'?p.code!=='SOXL':!/^(?:\d{6}|\d{4}[A-Z]\d)$/.test(p.code)))return json({error:'unsupported broker source'},400);
 if(!['quote','orders','fx','order','cancel'].includes(b.action))return json({error:'invalid action'},400);
 const base=new URL(request.url).origin,headers={'x-autotrade-key':env.AUTOTRADE_KEY||'','content-type':'application/json'};
 if(b.action==='fx')return fxGet({request:new Request(base+'/api/fx')});
 if(b.action==='quote')return kisGet({request:new Request(base+'/api/kis?op=price&env=vts&code='+encodeURIComponent(p.code)),env});
 if(b.action==='orders'){
  if(!/^\d+$/.test(String(b.orderNo))||!/^\d{4}-\d{2}-\d{2}$/.test(b.orderDate))return json({error:'invalid order identity'},400);
  const q=new URLSearchParams({op:'orders',env:'vts',market:p.strategy==='gpt_soxl'?'us':'kr',date:b.orderDate.replaceAll('-',''),code:p.code,odno:b.orderNo});
  return kisGet({request:new Request(base+'/api/kis?'+q,{headers}),env});
 }
 let permission;try{permission=await paperPermission(env,p.strategy);}catch{return json({notSubmitted:true,error:'설정 조회 실패 · 주문 중지'},503);}
 if(!permission.enabled)return json({notSubmitted:true,error:permission.reason},409);
 if(b.action==='cancel'){
  if(p.strategy!=='gpt_soxl'||!/^\d+$/.test(String(b.orderNo))||!Number.isSafeInteger(b.qty)||b.qty<=0||!['AMEX','NYSE','NASD'].includes(b.market))return json({notSubmitted:true,error:'invalid cancellation'},400);
  return cancelSoxlVts(env,{code:'SOXL',orderNo:b.orderNo,qty:b.qty,market:b.market});
 }
 let reason;try{reason=validateBrokerPlan(p);}catch(e){reason=e.message;}
 if(reason||b.settingsRevision!==permission.revision||p.side==='buy'&&(!permission.enabledSince||Date.parse(p.triggerAt||p.dueAt)<Date.parse(permission.enabledSince))||p.strategy==='gpt_tenbagger'&&p.side==='buy'&&(p.exitArm!==permission.exitArm||p.source?.pattern!==permission.pattern))return json({notSubmitted:true,error:reason||'주문 설정/시각 변경'},409);
 if(b.side!==p.side||!Number.isSafeInteger(b.qty)||b.qty<=0||(p.strategy==='gpt_soxl'?(b.priceType!=='limit'||!(b.price>0)||!['AMEX','NYSE','NASD'].includes(b.market)):(b.priceType!=='market'||b.price!==0)))return json({notSubmitted:true,error:'invalid order'},400);
 return kisPost({request:new Request(base+'/api/kis?op=order&internal=1',{method:'POST',headers,body:JSON.stringify({env:'vts',side:p.side,code:p.code,qty:b.qty,price:b.price,priceType:b.priceType,market:b.market,ordDvsn:'00'})}),env});
}
