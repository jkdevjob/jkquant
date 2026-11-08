// Private read-only relay for the existing nightly research archiver.
export async function onRequestGet({request,env}){
 const reply=(x,s=200)=>Response.json(x,{status:s,headers:{'cache-control':'no-store'}});
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||'');
 if(!key||request.headers.get('x-monitor-key')!==key)return reply({ok:false,error:'unauthorized'},401);
 const base=String(env.OPENING_WORKER_URL||'https://jkquant-opening-scheduler.mumae4.workers.dev').replace(/\/$/,'');
 try{
  const r=await fetch(base+'/holding-lab?strategy=all',{headers:{'x-monitor-key':key,accept:'application/json'},signal:AbortSignal.timeout(20000)}),j=await r.json();
  if(!r.ok||!j.ok)throw Error('holding archive source unavailable');
  return reply(j);
 }catch(e){return reply({ok:false,error:String(e.message||e)},502);}
}
