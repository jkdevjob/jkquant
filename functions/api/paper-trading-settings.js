// Owner-only broker settings; never submits or cancels an order.
import {ownerAuthorized} from './global-paper.js';
import {PAPER_STRATEGIES,PAPER_WORKER,readPaperSettings} from './_paper-trading.js';
import {researchVtsConnections} from './kis.js';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers});
export async function onRequest({request,env}){
 if(!await ownerAuthorized(request,env))return json({ok:false,error:'unauthorized'},401);
 if(!['GET','POST'].includes(request.method))return json({ok:false,error:'method not allowed'},405);
 try{
  if(request.method==='GET')return json({ok:true,settings:await readPaperSettings(env),strategies:PAPER_STRATEGIES,connections:researchVtsConnections(env),globalStopped:String(env.SCALPING_VTS_AUTO||'1')==='0'});
  let patch;try{patch=await request.json();}catch{return json({ok:false,error:'invalid JSON'},400);}
  const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'').trim();if(!key)throw Error('설정 저장 키 없음');
  const base=String(env.OPENING_WORKER_URL||PAPER_WORKER).replace(/\/$/,'');
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),8000);
  try{const r=await fetch(base+'/paper-settings',{method:'POST',headers:{'x-monitor-key':key,'content-type':'application/json'},body:JSON.stringify(patch),signal:ac.signal});
   const j=await r.json();return json({...j,strategies:PAPER_STRATEGIES,connections:researchVtsConnections(env),globalStopped:String(env.SCALPING_VTS_AUTO||'1')==='0'},r.status);
  }finally{clearTimeout(timer);}
 }catch{return json({ok:false,error:'모의투자 설정을 읽거나 저장하지 못했습니다. 설정 확인 전 주문은 중지됩니다.'},503);}
}
