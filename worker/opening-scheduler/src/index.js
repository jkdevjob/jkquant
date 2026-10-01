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

function store(env,date,kind=""){
  return env.SIGNAL_STORE.get(env.SIGNAL_STORE.idFromName(kind?kind+":"+String(date):String(date)));
}
async function appendLedger(env,payload,kind=""){
  const r=await store(env,payload.date,kind).fetch("https://opening-signal.internal/append",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("signal store HTTP "+r.status));
  return j;
}
async function readLedger(env,date,kind=""){
  const r=await store(env,date,kind).fetch("https://opening-signal.internal/ledger");
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

// ── D-1 시초가 갭하락 과매도(opening_gapdown_v1) 연구용 모의체결 ──
// 08:56 예상체결가 조회(40종목씩 순차) → 규칙 선택 + 장전 동시호가 VTS 매수 → 15:21 종가 동시호가 VTS 매도 → 15:40 체결 조회.
// 매 단계 응답 원본을 별도 ledger(gapdown:날짜)에 먼저 쌓는다. 주문 호출은 재시도하지 않는다.
// Workers 무료 요금제는 계정 전체 cron 5개가 한도라 이 Worker 는 cron 한 줄만 쓴다(wrangler.jsonc).
// "5-31,40,56 0,6,23 * * *" 로 필요한 시각을 모두 덮고, 실제로 할 일은 한국시각으로 여기서 고른다.
export function scheduleRoute(ms){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  if(g("weekday")==="Sat"||g("weekday")==="Sun")return null;
  const hm=+g("hour")*100+ +g("minute");
  if(hm>=905&&hm<=931)return "opening";
  if(hm===856)return "gapdown_preopen";
  if(hm===1521)return "gapdown_close";
  if(hm===1540)return "gapdown_reconcile";
  return null;
}
const GAPDOWN_PARTS=2;
async function gapdownCall(env,body){
  const r=await fetch(baseUrl(env)+"/api/opening-gapdown",{
    method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},body:JSON.stringify(body)
  });
  const j=await r.json().catch(()=>({}));
  return {httpStatus:r.status,...j};
}
async function gapdownRecord(env,date,stage,payload,ms){
  const p=kstParts(ms);
  const hm=p.hh*100+p.mm;
  const event={id:[date,"opening_gapdown",stage,payload&&payload.part!=null?"part"+payload.part:"all"].join(":"),
    date,capturedAt:new Date().toISOString(),targetHm:hm,strategy:"opening_gapdown",strategyVersion:"opening_gapdown_v1",
    stage,payload};
  return appendLedger(env,{scanId:[date,stage,event.id].join(":"),date,scheduledTime:ms,capturedAt:event.capturedAt,
    targetHm:hm,lagMs:0,partial:false,okShards:1,failed:[],quoteErrors:0,events:[event]},"gapdown");
}
export function gapdownPicksFromLedger(ledger){
  const ev=(ledger&&Array.isArray(ledger.events)?ledger.events:[]).find(e=>e&&e.stage==="preopen");
  const orders=ev&&ev.payload&&Array.isArray(ev.payload.orders)?ev.payload.orders:[];
  // 매수 주문이 접수된 종목만 오후에 다룬다. 접수 실패 종목은 보유가 없다.
  return orders.filter(o=>o&&o.side==="buy"&&o.vts&&o.vts.ok).map(o=>({code:o.code,name:o.name||o.code}));
}
// ② ETF 전략: 전날(공휴일·주말이면 최대 5일 전) ledger 에서 접수 성공한 etf_buy 를 찾는다.
export function etfBuyDateFromLedgers(ledgers){
  for(const l of (Array.isArray(ledgers)?ledgers:[])){
    const ev=(l&&Array.isArray(l.events)?l.events:[]).find(e=>e&&e.stage==="etf_buy");
    const o=ev&&ev.payload&&ev.payload.order;
    if(o&&o.side==="buy"&&o.vts&&o.vts.ok)return String(l.date);
    if(ev)return null;   // 가장 최근 거래일 기록이 '매수 없음'이면 더 거슬러 가지 않는다
  }
  return null;
}
async function runEtf(env,date,stage,ms,extra={}){
  let res;
  try{res=await gapdownCall(env,{stage,date,...extra});}
  catch(e){res={ok:false,error:"전송 결과 불명 — 재시도하지 않음: "+String(e.message||e)};}
  try{await gapdownRecord(env,date,stage,res,ms);}
  catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage,error:String(e.message||e)}));}
  console.log(JSON.stringify({type:stage,date,signal:res.signal,reason:res.decisionReason||res.error||""}));
}
async function runGapdown(stage,controller,env){
  if(!env.MONITOR_KEY||!env.SIGNAL_STORE)throw new Error("MONITOR_KEY/SIGNAL_STORE missing");
  const ms=Number(controller.scheduledTime)||Date.now();
  const date=kstParts(ms).date;
  if(stage==="preopen"){
    const prev=[];
    for(let k=1;k<=5;k++){
      const d=kstParts(ms-k*864e5).date;
      try{const l=await readLedger(env,d,"gapdown");if(l)prev.push(l);}catch(e){}
    }
    const buyDate=etfBuyDateFromLedgers(prev);
    if(buyDate)await runEtf(env,date,"etf_sell",ms,{buyDate});
    const parts=[];
    for(let part=0;part<GAPDOWN_PARTS;part++){
      let q;
      try{q=await gapdownCall(env,{stage:"quote",date,part});}
      catch(e){q={ok:false,error:String(e.message||e)};}
      q.part=part;
      parts.push(q);
      try{await gapdownRecord(env,date,"quote",q,ms);}
      catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage:"quote",part,error:String(e.message||e)}));return;}
      if(!q.ok||q.decisionReason||!q.watchlist||(!q.watchlist.truncated&&(part+1)*40>=(q.watchlist.size||0)))break;
    }
    if(parts.some(q=>!q.ok)){
      // 명단 일부만 조회됐으면 주문하지 않는다. 받은 예상가는 위에서 이미 저장했다.
      console.error(JSON.stringify({type:"gapdown_quote_partial",date,failed:parts.filter(q=>!q.ok).map(q=>q.error||q.httpStatus)}));
      return;
    }
    const candidates=parts.flatMap(q=>Array.isArray(q.candidates)?q.candidates:[]);
    let res;
    try{res=await gapdownCall(env,{stage:"preopen",date,candidates});}
    catch(e){res={ok:false,error:"전송 결과 불명 — 재시도하지 않음: "+String(e.message||e)};}
    try{await gapdownRecord(env,date,"preopen",res,ms);}
    catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage:"preopen",error:String(e.message||e)}));}
    console.log(JSON.stringify({type:"gapdown_preopen",date,picks:(res.picks||[]).length,orders:(res.orders||[]).length,reason:res.decisionReason||res.error||""}));
    return;
  }
  let ledger=null;
  try{ledger=await readLedger(env,date,"gapdown");}catch(e){ledger=null;}
  const picks=gapdownPicksFromLedger(ledger);
  if(picks.length){
    let res;
    try{res=await gapdownCall(env,{stage,date,picks});}
    catch(e){res={ok:false,error:"전송 결과 불명 — 재시도하지 않음: "+String(e.message||e)};}
    try{await gapdownRecord(env,date,stage,res,ms);}
    catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage,error:String(e.message||e)}));}
    console.log(JSON.stringify({type:"gapdown_"+stage,date,positions:(res.positions||[]).length,orders:(res.orders||[]).length}));
  }
  // ② ETF: 15:21 종가 매수 판단(매일) · 15:40 체결 조회(매일)
  await runEtf(env,date,stage==="close"?"etf_buy":"etf_reconcile",ms);
}

export default {
  async scheduled(controller,env,ctx){
    const route=scheduleRoute(Number(controller.scheduledTime)||Date.now());
    if(route==="opening")ctx.waitUntil(runMinute(controller,env));
    else if(route&&route.startsWith("gapdown_"))ctx.waitUntil(runGapdown(route.slice(8),controller,env));
  },
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/gapdown"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=u.searchParams.get("date")||kstParts().date;
      try{return json({ok:true,date,ledger:await readLedger(env,date,"gapdown")});}
      catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    if(u.pathname==="/events"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=u.searchParams.get("date")||kstParts().date;
      try{return json({ok:true,date,ledger:await readLedger(env,date)});}
      catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    return json({
      ok:true,
      service:"jkquant-opening-scheduler",
      schedule:"09:05-09:31 KST weekdays · gap-down research 08:56/15:21/15:40",
      mode:"Cloudflare Cron -> Pages opening-monitor -> immutable signal ledger -> KIS VTS",
      signalLedger:"Durable Object /events (authorized)"
    });
  }
};
