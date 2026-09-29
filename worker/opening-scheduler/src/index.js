import { DurableObject } from "cloudflare:workers";

// Cloudflare Worker — jkquant opening scheduler
// Primary realtime trigger for the opening strategy.
// Every scan and every baseline/shadow signal is first appended to a Durable Object ledger.
// GitHub Actions later archives that immutable live ledger together with reconstructed outcomes.

const SHARDS=5;
const LIMIT=100;
const MAX_SCAN_LAG_MS=10*60*1000;
const MAX_EXEC_LAG_MS=3*60*1000;
const LEDGER_SCHEMA=1;

function baseUrl(env){
  return String(env.BASE_URL||"https://jkquant.pages.dev").replace(/\/$/,"");
}
function json(o,status=200){
  return new Response(JSON.stringify(o),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
}
function kstParts(ms=Date.now()){
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
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  return !!env.MONITOR_KEY&&got===env.MONITOR_KEY;
}

export class OpeningSignalStore extends DurableObject {
  async fetch(request){
    const u=new URL(request.url);
    if(request.method==="GET"&&u.pathname==="/ledger"){
      const ledger=await this.ctx.storage.get("ledger");
      return json({ok:true,ledger:ledger||null});
    }
    if(request.method==="POST"&&u.pathname==="/append"){
      const b=await request.json();
      if(!b||!b.date||!Number.isFinite(+b.targetHm)||!Array.isArray(b.events)){
        return json({ok:false,error:"invalid ledger append"},400);
      }
      const nowIso=new Date().toISOString();
      const ledger=(await this.ctx.storage.get("ledger"))||{
        schema:LEDGER_SCHEMA,date:String(b.date),createdAt:nowIso,updatedAt:nowIso,scans:[],events:[]
      };
      if(String(ledger.date)!==String(b.date))return json({ok:false,error:"ledger date mismatch"},409);

      const scanId=String(b.scanId||[b.scheduledTime,b.targetHm,b.partial?"partial":"full"].join(":"));
      if(!ledger.scans.some(x=>x&&x.id===scanId)){
        ledger.scans.push({
          id:scanId,
          scheduledTime:+b.scheduledTime||null,
          capturedAt:String(b.capturedAt||nowIso),
          targetHm:+b.targetHm,
          lagMs:+b.lagMs||0,
          partial:!!b.partial,
          okShards:+b.okShards||0,
          failed:Array.isArray(b.failed)?b.failed:[],
          quoteErrors:+b.quoteErrors||0,
          eventCount:b.events.length
        });
      }

      const seen=new Set(ledger.events.map(x=>x&&x.id).filter(Boolean));
      let added=0;
      for(const e of b.events){
        if(!e||!e.id||seen.has(e.id))continue;
        ledger.events.push(e);seen.add(e.id);added++;
      }
      ledger.events.sort((a,b)=>(+a.targetHm||0)-(+b.targetHm||0)||String(a.id).localeCompare(String(b.id)));
      ledger.scans.sort((a,b)=>(+a.targetHm||0)-(+b.targetHm||0)||String(a.id).localeCompare(String(b.id)));
      ledger.updatedAt=nowIso;
      await this.ctx.storage.put("ledger",ledger);
      return json({ok:true,added,total:ledger.events.length,scans:ledger.scans.length});
    }
    return json({ok:false,error:"not found"},404);
  }
}

function store(env,date){
  return env.SIGNAL_STORE.get(env.SIGNAL_STORE.idFromName(String(date)));
}
async function appendLedger(env,payload){
  const r=await store(env,payload.date).fetch("https://opening-signal.internal/append",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("signal store HTTP "+r.status));
  return j;
}
async function readLedger(env,date){
  const r=await store(env,date).fetch("https://opening-signal.internal/ledger");
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("signal store HTTP "+r.status));
  return j.ledger||null;
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
function liveEvent(date,target,stage,variant,x,delivery,variantMeta){
  const signal=x||{};
  const clock=stage==="buy"?(signal.entryTime??target):(signal.exitTime??target);
  const id=[date,"opening",variant,signal.strategyVersion||"opening_rebreak_v1",stage,signal.code||"",clock||target].join(":");
  return {
    id,date,capturedAt:new Date().toISOString(),targetHm:target,
    strategy:"opening_rebreak",strategyVersion:signal.strategyVersion||"opening_rebreak_v1",
    signalSchemaVersion:+signal.signalSchemaVersion||1,
    variant,stage,code:String(signal.code||""),name:signal.name||signal.code||"",
    strategyParams:signal.strategyParams||variantMeta?.params||null,
    decisionReason:signal.decisionReason||"opening_rebreak_condition_pass",
    alertDelivery:delivery||null,
    signal
  };
}
function collectEvents(date,target,parts){
  const out=[];
  for(const p of parts){
    const tel=p.telegram||{};
    const buyDelivery={channel:"telegram",sent:!!tel.buySent,messageId:tel.buyMessageId||null,error:tel.buyError||null};
    const sellDelivery={channel:"telegram",sent:!!tel.sellSent,messageId:tel.sellMessageId||null,error:tel.sellError||null};
    for(const x of (p.buyEvents||[]))out.push(liveEvent(date,target,"buy","baseline",x,buyDelivery,null));
    for(const x of (p.sellEvents||[]))out.push(liveEvent(date,target,"sell","baseline",x,sellDelivery,null));
    for(const v of (p.shadowEvents||[])){
      const delivery={channel:"telegram",sent:false,messageId:null,error:null,reason:"shadow_strategy_not_notified"};
      for(const x of (v.buyEvents||[]))out.push(liveEvent(date,target,"buy",String(v.name||"shadow"),x,delivery,v));
      for(const x of (v.sellEvents||[]))out.push(liveEvent(date,target,"sell",String(v.name||"shadow"),x,delivery,v));
    }
  }
  return out;
}
function telegramFailures(parts){
  let n=0;
  for(const p of parts){
    const t=p.telegram||{};
    if(t.buyError)n++;
    if(t.sellError)n++;
  }
  return n;
}

async function persistScan(env,{scheduled,lag,target,kst,parts,failed,partial}){
  const events=collectEvents(kst.date,target,parts);
  const quoteErrors=parts.reduce((s,x)=>s+(+x.errors||0),0);
  const scanId=[scheduled,target,partial?"partial":"full"].join(":");
  const stored=await appendLedger(env,{
    scanId,date:kst.date,scheduledTime:scheduled,capturedAt:new Date().toISOString(),
    targetHm:target,lagMs:lag,partial:!!partial,okShards:parts.length,failed,quoteErrors,events
  });
  return {events:events.length,added:stored.added,total:stored.total,scans:stored.scans};
}

async function runMinute(controller,env){
  if(!env.MONITOR_KEY)throw new Error("MONITOR_KEY secret missing");
  if(!env.SIGNAL_STORE)throw new Error("SIGNAL_STORE binding missing");
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

  let archive=null;
  try{
    archive=await persistScan(env,{scheduled,lag,target,kst,parts:ok,failed,partial:ok.length!==SHARDS});
  }catch(e){
    console.error(JSON.stringify({type:"signal_archive_failed",date:kst.date,targetHm:target,error:String(e.message||e)}));
  }

  if(ok.length!==SHARDS){
    console.error(JSON.stringify({type:"scan_partial",targetHm:target,okShards:ok.length,failed,archive}));
    // Partial universe must never generate broker orders. Any signals from successful shards are still retained above.
    return;
  }

  const buyEvents=ok.flatMap(x=>Array.isArray(x.buyEvents)?x.buyEvents:[]);
  const sellEvents=ok.flatMap(x=>Array.isArray(x.sellEvents)?x.sellEvents:[]);
  const errors=ok.reduce((s,x)=>s+(+x.errors||0),0);
  const deliveryFailures=telegramFailures(ok);
  const result={
    type:"opening_scan",date:kst.date,targetHm:target,lagMs:lag,
    buyEvents:buyEvents.length,sellEvents:sellEvents.length,quoteErrors:errors,
    telegramFailures:deliveryFailures,archive
  };

  // Data retention is the first guardrail: a VTS order is never sent for an unarchived signal.
  if((buyEvents.length||sellEvents.length)&&!archive){
    result.vts={ok:false,skipped:"signal_archive_failed"};
    console.error(JSON.stringify(result));
    return;
  }
  // Preserve previous safety behavior: if the user alert failed, retain the signal but do not place a VTS order.
  if((buyEvents.length||sellEvents.length)&&deliveryFailures){
    result.vts={ok:false,skipped:"alert_delivery_failed"};
    console.error(JSON.stringify(result));
    return;
  }

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
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/events"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=u.searchParams.get("date")||kstParts().date;
      try{return json({ok:true,date,ledger:await readLedger(env,date)});}
      catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    return json({
      ok:true,
      service:"jkquant-opening-scheduler",
      schedule:"09:05-09:31 KST weekdays",
      mode:"Cloudflare Cron -> Pages opening-monitor -> immutable signal ledger -> KIS VTS",
      signalLedger:"Durable Object /events (authorized)"
    });
  }
};
