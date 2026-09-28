import { DurableObject } from "cloudflare:workers";

const SHARDS=5;
const MAX_SCAN_LAG_MS=3*60*1000;
const MAX_SNAPSHOT_HM=1015;

function baseUrl(env){return String(env.BASE_URL||"https://jkquant.pages.dev").replace(/\/$/,"");}
function json(o,s=200){return new Response(JSON.stringify(o,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function kstParts(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false
  }).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"",hh=+g("hour"),mm=+g("minute"),ss=+g("second");
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hh,mm,ss,hm:hh*100+mm};
}
function targetHm(scheduledTime){
  const p=kstParts(scheduledTime-60_000);
  return p.hh*100+p.mm;
}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  return !!env.MONITOR_KEY&&got===env.MONITOR_KEY;
}

export class SnapshotStore extends DurableObject {
  async fetch(request){
    const u=new URL(request.url);
    if(request.method==="GET"&&u.pathname==="/get"){
      const snapshot=await this.ctx.storage.get("snapshot");
      return json({ok:true,snapshot:snapshot||null});
    }
    if(request.method==="POST"&&u.pathname==="/put"){
      const b=await request.json();
      if(!b||!b.date||!Array.isArray(b.universe)||!b.universe.length)return json({ok:false,error:"invalid snapshot"},400);
      const existing=await this.ctx.storage.get("snapshot");
      if(existing)return json({ok:true,kept:true,snapshot:existing});
      await this.ctx.storage.put("snapshot",b);
      return json({ok:true,kept:false,snapshot:b});
    }
    return json({ok:false,error:"not found"},404);
  }
}

function store(env,date){
  return env.SNAPSHOT_STORE.get(env.SNAPSHOT_STORE.idFromName(date));
}
async function readSnapshot(env,date){
  const r=await store(env,date).fetch("https://snapshot.internal/get");
  const j=await r.json();
  return j.snapshot||null;
}
async function writeSnapshot(env,snapshot){
  const r=await store(env,snapshot.date).fetch("https://snapshot.internal/put",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(snapshot)
  });
  const j=await r.json();
  if(!r.ok||!j.ok)throw new Error(j.error||("snapshot store HTTP "+r.status));
  return j.snapshot;
}
async function captureSnapshot(env,date){
  const now=kstParts();
  if(now.date!==date||now.hm>MAX_SNAPSHOT_HM)return null;
  const r=await fetch(baseUrl(env)+"/api/universe?limit=100",{headers:{"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  const rows=Array.isArray(j.universe)?j.universe:[];
  if(!r.ok||!rows.length)throw new Error("universe HTTP "+r.status);
  const snapshot={
    schema:2,date,
    snapshotAt:new Date().toISOString(),
    snapshotHm:now.hm,
    scheduledTargetHm:955,
    limit:100,
    source:j.source||"",
    captureSource:"cloudflare-cron-durable-object",
    universe:rows.filter(x=>x&&x.code).slice(0,100).map((x,i)=>({
      rank:i+1,code:String(x.code||""),name:x.name||String(x.code||""),market:x.market||"",
      amount:x.amount||0,cap:x.cap||0,chg:x.chg||0,price:x.close||0
    }))
  };
  return writeSnapshot(env,snapshot);
}
async function getOrCreateSnapshot(env,date){
  const found=await readSnapshot(env,date);
  if(found)return found;
  return captureSnapshot(env,date);
}
async function scanShard(env,snapshot,target,shard){
  const r=await fetch(baseUrl(env)+"/api/daytrading-monitor",{
    method:"POST",
    headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
    body:JSON.stringify({snapshot,targetHm:target,shard,shards:SHARDS})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("shard "+shard+" HTTP "+r.status+" "+String(j.error||j.skipped||""));
  return j;
}
async function runScheduled(controller,env){
  if(!env.MONITOR_KEY)throw new Error("MONITOR_KEY secret missing");
  const scheduled=Number(controller.scheduledTime)||Date.now();
  const sched=kstParts(scheduled);
  const lag=Math.max(0,Date.now()-scheduled);

  // 09:55 KST: immutable Top100 snapshot. If it is delayed beyond 10:15,
  // captureSnapshot refuses to create a contaminated primary snapshot.
  if(sched.hm===955){
    const snapshot=await getOrCreateSnapshot(env,sched.date);
    console.log(JSON.stringify({type:"day_snapshot",date:sched.date,lagMs:lag,snapshotHm:snapshot?.snapshotHm||null,count:snapshot?.universe?.length||0}));
    return;
  }

  if(lag>MAX_SCAN_LAG_MS){
    console.warn(JSON.stringify({type:"day_scan_skip",reason:"cron_too_late",lagMs:lag,scheduledTime:scheduled}));
    return;
  }

  const target=targetHm(scheduled);
  if(target<959||target>1430)return;
  const snapshot=await getOrCreateSnapshot(env,sched.date);
  if(!snapshot){
    console.error(JSON.stringify({type:"day_scan_skip",reason:"snapshot_missing_or_late",date:sched.date,targetHm:target}));
    return;
  }

  const settled=await Promise.allSettled(Array.from({length:SHARDS},(_,shard)=>scanShard(env,snapshot,target,shard)));
  const ok=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const failed=settled.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||x.reason));
  console.log(JSON.stringify({
    type:"day_scan",date:sched.date,targetHm:target,lagMs:lag,snapshotHm:snapshot.snapshotHm,
    okShards:ok.length,signalEvents:ok.reduce((s,x)=>s+(x.signalEvents?.length||0),0),
    quoteErrors:ok.reduce((s,x)=>s+(+x.errors||0),0),failed
  }));
}

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil(runScheduled(controller,env));},
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/health")return json({ok:true,service:"jkquant-daytrading-scheduler",schedule:"09:55 snapshot + 10:00~14:31 KST minute scans"});
    if(u.pathname==="/snapshot"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=String(u.searchParams.get("date")||kstParts().date);
      const snapshot=await readSnapshot(env,date);
      return json({ok:true,date,snapshot});
    }
    return json({ok:false,error:"not found"},404);
  }
};
