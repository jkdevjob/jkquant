// Cloudflare Worker — jkquant opening scheduler
// Primary realtime trigger for the opening strategy. GitHub Actions remains a delayed archive/reconcile fallback.
// Cron runs every minute from 09:05 through 09:31 KST (00:05-00:31 UTC, weekdays).

const SHARDS=5;
const LIMIT=100;
const MAX_SCAN_LAG_MS=10*60*1000;
const MAX_EXEC_LAG_MS=3*60*1000;

function baseUrl(env){
  return String(env.BASE_URL||"https://jkquant.pages.dev").replace(/\/$/,"");
}
function kstParts(ms){
  const p=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  }).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hh:+g("hour"),mm:+g("minute"),ss:+g("second")};
}
function targetHm(scheduledTime){
  const p=kstParts(scheduledTime-60_000);
  return p.hh*100+p.mm;
}
async function scanOne(env,shard,target){
  const u=baseUrl(env)+"/api/opening-monitor?shard="+shard+"&shards="+SHARDS+"&limit="+LIMIT+"&targetHm="+target;
  const r=await fetch(u,{headers:{"x-monitor-key":env.MONITOR_KEY,"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("shard "+shard+" HTTP "+r.status+" "+String(j.error||j.skipped||""));
  return j;
}
async function executeVts(env,date,buyEvents,sellEvents){
  const r=await fetch(baseUrl(env)+"/api/opening-execute",{
    method:"POST",
    headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
    body:JSON.stringify({date,buyEvents,sellEvents,source:"cloudflare-cron"})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("opening-execute HTTP "+r.status+" "+String(j.error||""));
  return j;
}
async function runMinute(controller,env){
  if(!env.MONITOR_KEY)throw new Error("MONITOR_KEY secret missing");
  const scheduled=Number(controller.scheduledTime)||Date.now();
  const lag=Math.max(0,Date.now()-scheduled);
  const target=targetHm(scheduled);
  const kst=kstParts(scheduled);

  if(lag>MAX_SCAN_LAG_MS){
    console.warn(JSON.stringify({type:"skip",reason:"cron_too_late",lagMs:lag,scheduledTime:scheduled,targetHm:target}));
    return;
  }

  const settled=await Promise.allSettled(Array.from({length:SHARDS},(_,shard)=>scanOne(env,shard,target)));
  const ok=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const failed=settled.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||x.reason));
  if(ok.length!==SHARDS){
    console.error(JSON.stringify({type:"scan_partial",targetHm:target,okShards:ok.length,failed}));
    // Partial universe must never generate broker orders.
    return;
  }

  const buyEvents=ok.flatMap(x=>Array.isArray(x.buyEvents)?x.buyEvents:[]);
  const sellEvents=ok.flatMap(x=>Array.isArray(x.sellEvents)?x.sellEvents:[]);
  const errors=ok.reduce((s,x)=>s+(+x.errors||0),0);
  const result={
    type:"opening_scan",date:kst.date,targetHm:target,lagMs:lag,
    buyEvents:buyEvents.length,sellEvents:sellEvents.length,quoteErrors:errors
  };

  if((buyEvents.length||sellEvents.length)&&lag<=MAX_EXEC_LAG_MS){
    try{
      const exec=await executeVts(env,kst.date,buyEvents,sellEvents);
      result.vts={ok:true,eventCount:Array.isArray(exec.events)?exec.events.length:0};
    }catch(e){
      result.vts={ok:false,error:String(e.message||e)};
      console.error(JSON.stringify(result));
      throw e;
    }
  }else if(buyEvents.length||sellEvents.length){
    result.vts={ok:false,skipped:"stale_signal",maxExecLagMs:MAX_EXEC_LAG_MS};
  }

  console.log(JSON.stringify(result));
}

export default {
  async scheduled(controller,env,ctx){
    ctx.waitUntil(runMinute(controller,env));
  },
  async fetch(){
    return new Response(JSON.stringify({
      ok:true,
      service:"jkquant-opening-scheduler",
      schedule:"09:05-09:31 KST weekdays",
      mode:"Cloudflare Cron -> Pages opening-monitor -> KIS VTS"
    }),{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
  }
};
