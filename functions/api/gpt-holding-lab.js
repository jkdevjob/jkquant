// Owner-authenticated read only; no strategy promotion, broker or notification.
import {ownerAuthorized} from './global-paper.js';
import {HOLDING_RULES,HOLDING_START,HOLDING_VERSION} from './_gpt-holding-lab.js';
export async function onRequestGet({request,env}){
 const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
 if(!await ownerAuthorized(request,env))return reply({ok:false,error:'unauthorized'},401);
 const strategy=new URL(request.url).searchParams.get('strategy')||'all';
 if(strategy!=='all'&&!HOLDING_RULES[strategy])return reply({ok:false,error:'unsupported strategy'},400);
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'');
 if(!key)return reply({ok:false,error:'holding monitor unavailable'},503);
 try{
  const url=String(env.OPENING_WORKER_URL||'https://jkquant-opening-scheduler.mumae4.workers.dev').replace(/\/$/,'');
  const r=await fetch(url+'/holding-lab?strategy='+strategy,{headers:{'x-monitor-key':key},signal:AbortSignal.timeout(12000)}),j=await r.json();
  if(!r.ok||!j.ok)throw Error(j.error||'holding source unavailable');
  return reply({...j,version:HOLDING_VERSION,evaluationStart:HOLDING_START,paperOnly:true,autoPromotion:false});
 }catch(e){return reply({ok:false,error:String(e.message||e)},502);}
}
