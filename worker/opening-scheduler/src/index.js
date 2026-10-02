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
function kstHm(ms){const p=kstParts(ms);return p.hh*100+p.mm;}
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
    if(request.method==="GET"&&u.pathname==="/config"){
      const config=(await this.ctx.storage.get("strategyConfig"))||{schema:1,strategy:"opening",selectedVariant:"baseline",updatedAt:null,updatedBy:null};
      return json({ok:true,config});
    }
    if(request.method==="POST"&&u.pathname==="/config"){
      const b=await request.json();
      const variant=String(b&&b.variant||"");
      if(!variant)return json({ok:false,error:"variant required"},400);
      const prev=(await this.ctx.storage.get("strategyConfig"))||{schema:2,strategy:"opening",selectedVariant:"baseline",history:[]};
      const at=new Date().toISOString(),effectiveFrom=String(b&&b.effectiveFrom||"");
      const entry={at,effectiveFrom,previousVariant:String(prev.selectedVariant||"baseline"),selectedVariant:variant,
        updatedBy:String(b.updatedBy||"owner"),source:String(b.source||"manual-promotion"),
        researchScore:Number.isFinite(+b.researchScore)?+b.researchScore:null,rank:Number.isFinite(+b.rank)?+b.rank:null};
      const history=[...(Array.isArray(prev.history)?prev.history:[]),entry].slice(-50);
      const config={schema:2,strategy:"opening",selectedVariant:variant,previousVariant:String(prev.selectedVariant||"baseline"),
        effectiveFrom,updatedAt:at,updatedBy:entry.updatedBy,source:entry.source,researchScore:entry.researchScore,rank:entry.rank,history};
      await this.ctx.storage.put("strategyConfig",config);
      return json({ok:true,config});
    }
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
        schema:LEDGER_SCHEMA,date:String(b.date),mainVariant:String(b.mainVariant||"baseline"),createdAt:nowIso,updatedAt:nowIso,scans:[],events:[]
      };
      if(!ledger.mainVariant)ledger.mainVariant=String(b.mainVariant||"baseline");
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
function configStore(env){return env.SIGNAL_STORE.get(env.SIGNAL_STORE.idFromName("__gpt_opening_strategy_config__"));}
async function readStrategyConfig(env){
  const r=await configStore(env).fetch("https://opening-signal.internal/config");
  const j=await r.json().catch(()=>({}));
  return j.config||{schema:1,strategy:"opening",selectedVariant:"baseline",updatedAt:null};
}
async function writeStrategyConfig(env,b){
  const r=await configStore(env).fetch("https://opening-signal.internal/config",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("config store HTTP "+r.status));
  return j.config;
}
async function mainVariantForDate(env,date){
  const ledger=await readLedger(env,date).catch(()=>null);
  if(ledger&&ledger.mainVariant)return String(ledger.mainVariant);
  const cfg=await readStrategyConfig(env);
  if(cfg.effectiveFrom&&String(date)<String(cfg.effectiveFrom))return String(cfg.previousVariant||"baseline");
  return String(cfg.selectedVariant||"baseline");
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

async function scanOne(env,shard,target,mainVariant){
  const u=baseUrl(env)+"/api/opening-monitor?shard="+shard+"&shards="+SHARDS+"&limit="+LIMIT+"&targetHm="+target+"&mainVariant="+encodeURIComponent(mainVariant||"baseline");
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
    const mainVariant=String(p.mainVariant||"baseline");
    for(const x of (p.buyEvents||[]))out.push(liveEvent(date,target,"buy",mainVariant,x,buyDelivery,null));
    for(const x of (p.sellEvents||[]))out.push(liveEvent(date,target,"sell",mainVariant,x,sellDelivery,null));
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

async function persistScan(env,{scheduled,lag,target,kst,parts,failed,partial,mainVariant}){
  const events=collectEvents(kst.date,target,parts);
  const quoteErrors=parts.reduce((s,x)=>s+(+x.errors||0),0);
  const scanId=[scheduled,target,partial?"partial":"full"].join(":");
  const stored=await appendLedger(env,{
    scanId,date:kst.date,mainVariant:String(mainVariant||"baseline"),scheduledTime:scheduled,capturedAt:new Date().toISOString(),
    targetHm:target,lagMs:lag,partial:!!partial,okShards:parts.length,failed,quoteErrors,events
  });
  return {events:events.length,added:stored.added,total:stored.total,scans:stored.scans};
}

async function sendOpeningCloseSummary(env,date){
  const mainVariant=await mainVariantForDate(env,date);
  const parts=[];
  for(let shard=0;shard<SHARDS;shard++){
    const u=baseUrl(env)+"/api/opening-monitor?serverHistory=1&shard="+shard+"&shards="+SHARDS+"&limit="+LIMIT+"&mainVariant="+encodeURIComponent(mainVariant);
    const r=await fetch(u,{headers:{"x-monitor-key":env.MONITOR_KEY,"Accept":"application/json"}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error("opening summary shard "+shard+" HTTP "+r.status+" "+String(j.error||""));
    parts.push(j);
  }
  const trades=parts.flatMap(x=>Array.isArray(x.operationalTrades)?x.operationalTrades:(Array.isArray(x.trades)?x.trades:[])).sort((a,b)=>(+a.entryTime||0)-(+b.entryTime||0));
  const pn=trades.map(x=>Number(x.pnl)).filter(Number.isFinite),wins=pn.filter(x=>x>0).length,losses=pn.filter(x=>x<0).length;
  const avg=pn.length?pn.reduce((s,x)=>s+x,0)/pn.length:0;
  const lines=[
    "후보/진입 "+trades.length+"건 · 청산 "+pn.length+"건 · 미청산 "+Math.max(0,trades.length-pn.length)+"건",
    "승 "+wins+" · 패 "+losses+" · 승률 "+(pn.length?(wins/pn.length*100).toFixed(1):"0.0")+"%",
    "실현 평균 순수익률 "+(avg>=0?"+":"")+avg.toFixed(2)+"% · 왕복 마찰비용 0.25% 반영"
  ];
  for(const x of trades)lines.push((x.name||x.code)+" · "+String(x.entryTime||"—")+"→"+String(x.exitTime||"—")+" · "+(Number.isFinite(+x.pnl)?((+x.pnl>=0?"+":"")+(+x.pnl).toFixed(2)+"%"):"진행중")+" · "+String(x.reason||""));
  if(!trades.length)lines.push("오늘 조건 충족 모의거래 없음");
  const r=await fetch(baseUrl(env)+"/api/scalping-alert",{method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},body:JSON.stringify({strategy:"opening",stage:"summary",eventId:"opening:"+date+":close-summary",date,time:"09:31 KST",lines})});
  const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||("opening summary HTTP "+r.status));return j;
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

  const mainVariant=await mainVariantForDate(env,kst.date);
  const settled=await Promise.allSettled(Array.from({length:SHARDS},(_,shard)=>scanOne(env,shard,target,mainVariant)));
  const ok=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const failed=settled.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||x.reason));

  let archive=null;
  try{
    archive=await persistScan(env,{scheduled,lag,target,kst,parts:ok,failed,partial:ok.length!==SHARDS,mainVariant});
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
    type:"opening_scan",date:kst.date,targetHm:target,lagMs:lag,mainVariant,
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
  if(kst.hh===9&&kst.mm===31){ try{await sendOpeningCloseSummary(env,kst.date);}catch(e){console.error(JSON.stringify({type:"opening_close_summary_failed",date:kst.date,error:String(e.message||e)}));} }
}

// ── D-1 시초가 갭하락 과매도(opening_gapdown_v1) 연구용 모의체결 ──
// 08:56 예상체결가 조회(40종목씩 순차) → 규칙 선택 + 장전 동시호가 VTS 매수 → 15:21 종가 동시호가 VTS 매도 → 15:40 체결 조회.
// 매 단계 응답 원본을 별도 ledger(gapdown:날짜)에 먼저 쌓는다. 주문 호출은 재시도하지 않는다.
// Workers 무료 요금제는 계정 전체 cron 5개가 한도라 이 Worker 는 cron 한 줄만 쓴다(wrangler.jsonc).
// "5-31,40,56 0,6,23 * * *" 로 필요한 시각을 모두 덮고, 실제로 할 일은 한국시각으로 여기서 고른다.
// 토요일 09:05 — 금요일 밤(23:40) 장부로 이번 주 결과를 보낸다(코인 금요일 하루는 토 09시에 끝나 다음 주 계산에 들어감).
export function claudeWeeklyDue(ms){
  const p=kstParts(ms),wd=new Date(Date.parse(p.date+"T00:00:00Z")).getUTCDay();
  return wd===6&&p.hh===9&&p.mm===5;
}
export function scheduleRoute(ms){
  const p=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  // 단타(클로드) 하루 마감 — ③ 코인은 매일 한국 00:05(00:31 까지 재시도), ④ SOXL 은 뉴욕 16:05(정규장 마감+5분, 서머타임 자동) 평일
  if(g("hour")==="00"&&+g("minute")>=5&&+g("minute")<=31)return "claude_crypto";
  const n=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
  const ng=t=>n.find(x=>x.type===t)?.value||"";
  if(ng("weekday")!=="Sat"&&ng("weekday")!=="Sun"&&ng("hour")==="16"&&+ng("minute")>=5&&+ng("minute")<=31)return "claude_soxl";
  if(g("weekday")==="Sat"||g("weekday")==="Sun")return null;
  const hm=+g("hour")*100+ +g("minute");
  if(hm>=905&&hm<=931)return "opening";
  if(hm===856)return "gapdown_preopen";
  if(hm===1521)return "gapdown_close";
  if(hm===1540)return "gapdown_reconcile";
  if(hm===1556)return "claude_kr";                 // 15:40 마감 알림이 실패했을 때 한 번 더
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
// 단타(클로드) Telegram — 기록을 저장한 뒤에 부른다. 실패해도 주문·기록에는 영향이 없다.
async function claudeTelegram(env,date,kind){
  try{
    const r=await fetch(baseUrl(env)+"/api/claude-telegram",{method:"POST",
      headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},body:JSON.stringify({kind,date})});
    const j=await r.json().catch(()=>({}));
    console.log(JSON.stringify({type:"claude_telegram",kind,date,ok:!!j.ok,duplicate:!!j.duplicate,error:j.error||null}));
  }catch(e){console.error(JSON.stringify({type:"claude_telegram_failed",kind,date,error:String(e.message||e)}));}
}
// ── 단타(클로드) 전략별 하루 마감 → Telegram ──
// 1) Pages 가 그 시점까지의 원본으로 마감 장부를 계산 → 2) Durable Object(claude:{거래일})에 한 번만 저장(먼저 저장된 것이 정본)
// → 3) 저장된 장부로 메시지를 만들어 보낸다. 보냄·모름은 기록해 다시 보내지 않고, 텔레그램이 거절한 경우만 최대 5번 다시 시도한다.
export const CLAUDE_TG_MAX_FAILS=5;
export function claudeSendState(ledger,strategy){
  const ev=(ledger&&Array.isArray(ledger.events)?ledger.events:[]);
  const has=id=>ev.some(e=>e&&e.id===id);
  const fails=ev.filter(e=>e&&String(e.id).startsWith("tg:"+strategy+":fail:")).length;
  const rec=(ev.find(e=>e&&e.id==="close:"+strategy)||{}).payload||null;
  return {done:has("tg:"+strategy+":sent")||has("tg:"+strategy+":unknown"),fails,record:rec,
    canSend:!(has("tg:"+strategy+":sent")||has("tg:"+strategy+":unknown"))&&fails<CLAUDE_TG_MAX_FAILS};
}
async function claudeAppend(env,date,id,stage,payload,ms){
  const event={id,date,capturedAt:new Date().toISOString(),targetHm:kstHm(ms),strategy:"claude_day",stage,payload};
  return appendLedger(env,{scanId:id,date,scheduledTime:ms,capturedAt:event.capturedAt,targetHm:kstHm(ms),lagMs:0,partial:false,
    okShards:1,failed:[],quoteErrors:0,events:[event]},"claude");
}
async function claudePost(env,body){
  const r=await fetch(baseUrl(env)+"/api/claude-telegram",{method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},body:JSON.stringify(body)});
  return r.json().catch(()=>({ok:false,error:"HTTP "+r.status,definite:r.status<500}));
}
async function claudeDayClose(env,strategy,date,ms,extra={}){
  try{
    let L=await readLedger(env,date,"claude");
    let s=claudeSendState(L,strategy);
    if(!s.canSend)return s;
    if(!s.record&&strategy!=="overview"){
      const c=await claudePost(env,{op:"close",strategy,date});
      if(!c.ok||!c.result){console.error(JSON.stringify({type:"claude_close_failed",strategy,date,error:c.error||""}));return s;}
      await claudeAppend(env,date,"close:"+strategy,"close",c.result,ms);
      L=await readLedger(env,date,"claude");s=claudeSendState(L,strategy);          // 먼저 저장된 장부가 정본
    }
    let res;
    try{res=await claudePost(env,{op:"send",strategy,date,result:s.record,records:extra.records});}
    catch(e){res={ok:false,definite:false,error:String(e.message||e)};}
    const tag=res.ok?"sent":res.definite?"fail:"+(s.fails+1):"unknown";
    await claudeAppend(env,date,"tg:"+strategy+":"+tag,"telegram",{ok:!!res.ok,messageId:res.messageId||null,error:res.error||null},ms);
    console.log(JSON.stringify({type:"claude_day_telegram",strategy,date,result:tag,error:res.error||null}));
    return s;
  }catch(e){console.error(JSON.stringify({type:"claude_day_error",strategy,date,error:String(e.message||e)}));return null;}
}
async function claudeKrClose(env,date,ms){
  await claudeDayClose(env,"opening",date,ms);
  await claudeDayClose(env,"daytrading",date,ms);
  // 전일·당일 요약: 각 전략의 마지막 마감 장부(코인은 한국 00:00, SOXL 은 미국장 마감 기준)
  const recs={};
  for(const [k,back] of [["opening",0],["daytrading",0],["crypto",1],["soxl",1]]){
    for(let i=back;i<=back+4&&!recs[k];i++){
      const d=kstParts(ms-i*864e5).date;
      try{const s=claudeSendState(await readLedger(env,d,"claude"),k);if(s.record)recs[k]=s.record;}catch(e){}
    }
  }
  await claudeDayClose(env,"overview",date,ms,{records:recs});
}
export function nyDate(ms){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(ms));
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
    await claudeTelegram(env,date,"preopen");
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
  if(stage==="close")await claudeTelegram(env,date,"etfbuy");
  else await claudeKrClose(env,date,ms);            // 15:40 체결조회로 ①② 장부가 마감된 뒤 전략별 결과 → 전일·당일 요약
}

export default {
  async scheduled(controller,env,ctx){
    const at=Number(controller.scheduledTime)||Date.now();
    const route=scheduleRoute(at);
    // 09:05 KST 매일(주말 포함 — 코인은 쉬지 않는다): 코인 하루 마감·미국 지난 세션 결과 알림
    if(claudeWeeklyDue(at))ctx.waitUntil(claudeTelegram(env,kstParts(at).date,"weekly"));
    if(route==="claude_crypto")ctx.waitUntil(claudeDayClose(env,"crypto",kstParts(at-864e5).date,at));   // 어제 00:00~24:00
    else if(route==="claude_soxl")ctx.waitUntil(claudeDayClose(env,"soxl",nyDate(at),at));
    else if(route==="claude_kr")ctx.waitUntil(claudeKrClose(env,kstParts(at).date,at));
    else if(route==="opening")ctx.waitUntil(runMinute(controller,env));
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
    if(u.pathname==="/claude"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=u.searchParams.get("date")||kstParts().date;
      try{return json({ok:true,date,ledger:await readLedger(env,date,"claude")});}
      catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    if(u.pathname==="/events"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=u.searchParams.get("date")||kstParts().date;
      try{return json({ok:true,date,ledger:await readLedger(env,date)});}
      catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    if(u.pathname==="/config"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      try{
        if(request.method==="GET")return json({ok:true,config:await readStrategyConfig(env)});
        if(request.method==="POST"){
          const b=await request.json();
          return json({ok:true,config:await writeStrategyConfig(env,b)});
        }
        return json({ok:false,error:"method not allowed"},405);
      }catch(e){return json({ok:false,error:String(e.message||e)},500);}
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
