import { DurableObject } from "cloudflare:workers";
import { krxDay } from "../../../functions/api/_krx_calendar.js";   // KRX 휴장일 — 주문 경로(Pages)와 같은 목록
import {defaultPaperSettings,changePaperSettings} from "../../../functions/api/_paper-trading.js";
import {openingOrderRefs,openingExecutionResult} from "../../../functions/api/_opening-execution.js";
import { pushEvents, sendPush, vapidPublic, alertText, reportMsg } from "../../../functions/api/_claude_push.js";   // 단타(클로드) 매수·매도 알림(웹 알림 · 텔레그램 같은 사건)

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

const KR_MARKET_DAY_CACHE=new Map();
async function krMarketOpen(env,date){
  if(KR_MARKET_DAY_CACHE.has(date))return KR_MARKET_DAY_CACHE.get(date);
  const q=new URLSearchParams({op:"holiday",market:"kr",date:String(date).replace(/\D/g,"")});
  const r=await fetch(baseUrl(env)+"/api/kis?"+q.toString(),{headers:{"accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.ok!==true||typeof j.open!=="boolean")throw new Error(j.error||("KRX holiday HTTP "+r.status));
  KR_MARKET_DAY_CACHE.set(date,j.open);
  return j.open;
}
function isoUtc(y,m,d){return new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);}
function nthWeekday(y,m,weekday,n){
  const first=new Date(Date.UTC(y,m-1,1)),delta=(weekday-first.getUTCDay()+7)%7;
  return isoUtc(y,m,1+delta+(n-1)*7);
}
function lastWeekday(y,m,weekday){
  const last=new Date(Date.UTC(y,m,0)),delta=(last.getUTCDay()-weekday+7)%7;
  return isoUtc(y,m,last.getUTCDate()-delta);
}
function observedFixed(y,m,d){
  const x=new Date(Date.UTC(y,m-1,d)),wd=x.getUTCDay();
  if(wd===6)x.setUTCDate(x.getUTCDate()-1);
  else if(wd===0)x.setUTCDate(x.getUTCDate()+1);
  return x.toISOString().slice(0,10);
}
function easterSunday(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return new Date(Date.UTC(y,month-1,day));
}
function nyseHolidaySet(y){
  const s=new Set([
    observedFixed(y,1,1),
    nthWeekday(y,1,1,3),
    nthWeekday(y,2,1,3),
    lastWeekday(y,5,1),
    observedFixed(y,6,19),
    observedFixed(y,7,4),
    nthWeekday(y,9,1,1),
    nthWeekday(y,11,4,4),
    observedFixed(y,12,25)
  ]);
  const easter=easterSunday(y);easter.setUTCDate(easter.getUTCDate()-2);s.add(easter.toISOString().slice(0,10));
  const nextNewYear=observedFixed(y+1,1,1);if(nextNewYear.startsWith(y+"-"))s.add(nextNewYear);
  return s;
}
function isNyseSessionDate(date){
  const d=new Date(date+"T12:00:00Z"),wd=d.getUTCDay(),y=d.getUTCFullYear();
  return wd!==0&&wd!==6&&!nyseHolidaySet(y).has(date);
}

export class OpeningSignalStore extends DurableObject {
  // 단타(클로드) 웹 알림 저장소(이름 "claudepush" 인스턴스만 쓴다): 서명키(VAPID, 처음 한 번 만들고 밖으로 안 나감) · 구독 · 보낸 알림 기록
  async push(op,request){
    const b=request.method==="POST"?await request.json().catch(()=>({})):{};
    const r=await this.pushOp(op,b);
    return json(r,r.status||200);
  }
  // 5분 알림 감시 — cron 을 늘리지 않고(계정 한도 · 스케줄 정책) 이 저장소의 알람으로 돈다. 실패해도 다음 알람은 꼭 건다.
  async alarm(){
    try{await claudePushWatch(this.env,Date.now(),(op,b)=>this.pushOp(op,b||{}));}
    catch(e){console.error(JSON.stringify({type:"claude_push_error",error:String(e.message||e)}));}
    finally{await this.ctx.storage.setAlarm(nextPushAt(Date.now()));}
  }
  async pushOp(op,b){
    const st=this.ctx.storage,json=o=>o;
    if(op==="ensure"){                                  // 알람이 없으면 다음 5분 정각에 건다(구독할 때 · 장 일정 cron 때마다 확인)
      let a=await st.getAlarm();
      if(!a){a=nextPushAt(Date.now());await st.setAlarm(a);}
      return {ok:true,alarm:a};
    }
    if(op==="vapid"){
      let v=await st.get("pushVapid");
      if(!v){
        const k=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);
        const j=await crypto.subtle.exportKey("jwk",k.privateKey);
        v={d:j.d,x:j.x,y:j.y,createdAt:new Date().toISOString()};
        await st.put("pushVapid",v);
      }
      return json({ok:true,jwk:v});
    }
    const subs=(await st.get("pushSubs"))||[];
    if(op==="subs")return json({ok:true,subs});
    if(op==="sub"){
      const x=b.subscription||{};
      if(!/^https:\/\//.test(String(x.endpoint||""))||!x.keys||!x.keys.p256dh||!x.keys.auth)return {ok:false,error:"구독 정보 오류",status:400};
      const next=[{endpoint:String(x.endpoint),keys:{p256dh:String(x.keys.p256dh),auth:String(x.keys.auth)},at:new Date().toISOString(),ua:String(b.ua||"").slice(0,120)},
        ...subs.filter(s=>s.endpoint!==x.endpoint)].slice(0,10);
      await st.put("pushSubs",next);
      if(!(await st.getAlarm()))await st.setAlarm(nextPushAt(Date.now()));
      return json({ok:true,count:next.length});
    }
    if(op==="unsub"||op==="drop"){
      const gone=new Set(op==="unsub"?[String(b.endpoint||"")]:(b.endpoints||[]).map(String));
      const next=subs.filter(s=>!gone.has(s.endpoint));
      await st.put("pushSubs",next);
      return json({ok:true,count:next.length});
    }
    if(op==="sent")return json({ok:true,sent:(await st.get("pushSent"))||{}});
    if(op==="claim"){                                   // 처음 보는 알림 id 만 돌려주고 기록한다(같은 알림 두 번 안 보냄) · 열흘 지난 기록은 지운다
      const sent=(await st.get("pushSent"))||{},now=Date.now(),fresh=[];
      for(const e of b.events||[]){if(e&&e.id&&!sent[e.id]){sent[e.id]={at:now,price:e.price??null};fresh.push(e.id);}}
      for(const k of Object.keys(sent))if(now-(+sent[k].at||0)>10*864e5)delete sent[k];
      await st.put("pushSent",sent);
      return json({ok:true,fresh});
    }
    if(op==="tg"){                                      // 텔레그램 결과(sent · fail · unknown)와 시도 횟수 — 거절(fail)만 다음 감시에서 다시 보낸다
      const sent=(await st.get("pushSent"))||{},x=sent[String(b.id||"")];
      if(x){x.tg=String(b.result||"");x.tgTries=(+x.tgTries||0)+1;await st.put("pushSent",sent);}
      return json({ok:!!x});
    }
    return {ok:false,error:"push op",status:404};
  }
  async fetch(request){
    const u=new URL(request.url);
    if(u.pathname==="/paper-settings"){
      const patch=request.method==='POST'?await request.json().catch(()=>null):null;
      if(request.method==='GET')return json({ok:true,settings:(await this.ctx.storage.get('paperSettings'))||defaultPaperSettings()});
      if(request.method!=='POST')return json({ok:false,error:'method not allowed'},405);
      try{
        const next=await this.ctx.storage.transaction(async tx=>{
          const current=(await tx.get('paperSettings'))||defaultPaperSettings(),next=changePaperSettings(current,patch);
          const change=patch.allOff===true?{allOff:true}:{strategy:patch.strategy,enabled:patch.enabled,budget:patch.budget};
          const history=[...((await tx.get('paperSettingsHistory'))||[]),{at:next.updatedAt,revision:next.revision,change,previous:current}].slice(-100);
          await tx.put({paperSettings:next,paperSettingsHistory:history});return next;
        });
        return json({ok:true,settings:next});
      }catch(e){return json({ok:false,error:String(e.message||e)},e.status||400);}
    }
    if(u.pathname.startsWith("/push/"))return this.push(u.pathname.slice(6),request);
    if(u.pathname==="/kistoken"){                       // 한투 접근 토큰(모의투자) 보관 — 아래 kisTokenRecord 설명
      const now=Date.now(),r=request.method==="GET"?null:kisTokenRecord(await request.json().catch(()=>null),now);   // 본문은 저장소 읽기 전에(읽기~쓰기 사이에 다른 요청이 끼지 않게)
      if(request.method!=="GET"&&!r)return json({ok:false,error:"invalid token record"},400);
      const all=(await this.ctx.storage.get("kisTokens"))||{};
      for(const k of Object.keys(all))if(!(+all[k].exp>now))delete all[k];   // 만료된 것은 돌려주지 않고 다음 저장 때 지운다
      if(!r){const t=all[u.searchParams.get("k")||""];return json(t?{ok:true,token:t.token,exp:t.exp}:{ok:true,token:null});}
      if(r.drop!=null){if(all[r.k]&&all[r.k].token===r.drop)delete all[r.k];}   // 같은 토큰일 때만 지운다(다른 곳이 막 새로 받은 것은 그대로)
      else all[r.k]={token:r.token,exp:r.exp,at:now};
      await this.ctx.storage.put("kisTokens",all);
      return json({ok:true});
    }
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
      const entry={at,effectiveFrom,previousVariant:String(b&&b.previousVariant||prev.selectedVariant||"baseline"),selectedVariant:variant,
        updatedBy:String(b.updatedBy||"owner"),source:String(b.source||"manual-promotion"),
        researchScore:Number.isFinite(+b.researchScore)?+b.researchScore:null,rank:Number.isFinite(+b.rank)?+b.rank:null};
      const history=[...(Array.isArray(prev.history)?prev.history:[]),entry].slice(-50);
      const config={schema:2,strategy:"opening",selectedVariant:variant,previousVariant:entry.previousVariant,
        effectiveFrom,updatedAt:at,updatedBy:entry.updatedBy,source:entry.source,researchScore:entry.researchScore,rank:entry.rank,history};
      await this.ctx.storage.put("strategyConfig",config);
      return json({ok:true,config});
    }
    if(u.pathname==="/history-index"){
      const b=request.method==="POST"?await request.json():null;
      const dates=await this.ctx.storage.get("historyDates")||[];
      if(b){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date||"")))return json({ok:false,error:"invalid date"},400);
        const next=[...new Set([...dates,b.date])].sort();await this.ctx.storage.put("historyDates",next);
        return json({ok:true,dates:next});
      }
      return json({ok:true,dates});
    }
    if(request.method==="GET"&&u.pathname==="/ledger"){
      const ledger=await this.ctx.storage.get("ledger");
      return json({ok:true,ledger:ledger||null});
    }
    if(request.method==='POST'&&u.pathname==='/execution'){
      const e=await request.json();
      return this.ctx.storage.transaction(async tx=>{
        const ledger=await tx.get('ledger');
        if(!ledger||e.date!==ledger.date||!e.id||!['intent','result'].includes(e.phase))return json({ok:false,error:'execution ledger mismatch'},409);
        const journal=ledger.executionEvents||[],old=journal.find(x=>x.id===e.id);
        if(old)return JSON.stringify(old)===JSON.stringify(e)?json({ok:true,duplicate:true}):json({ok:false,error:'immutable execution event'},409);
        if(e.phase==='intent'){
          const main=ledger.mainVariant||'baseline',events=(ledger.events||[]).filter(x=>x.variant===main);
          const allowed=new Set(events.flatMap(x=>openingOrderRefs(ledger.date,x.stage==='buy'?[x.signal]:[],x.stage==='sell'?[x.signal]:[])).map(x=>x.signalId));
          if(!Array.isArray(e.requests)||!e.requests.length||e.requests.length>40||e.requests.some(x=>!allowed.has(x.signalId)))return json({ok:false,error:'order intent requires original main signal'},409);
        }else{
          const intent=journal.find(x=>x.phase==='intent'&&x.id===e.attemptId);
          if(!intent||e.id!==intent.id+':result'||!Array.isArray(e.receipts)||e.receipts.length!==intent.requests.length||e.receipts.some(x=>!intent.requests.some(r=>r.signalId===x.signalId)))return json({ok:false,error:'order result requires intent'},409);
        }
        ledger.executionEvents=[...journal,e];ledger.updatedAt=e.at;
        await tx.put('ledger',ledger);return json({ok:true});
      });
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
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))){
    const index=await store(env,"__history_index__",kind).fetch("https://opening-signal.internal/history-index",{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({date:payload.date})});
    if(!index.ok)throw new Error("signal history index unavailable");
  }
  return j;
}
async function readLedger(env,date,kind=""){
  const r=await store(env,date,kind).fetch("https://opening-signal.internal/ledger");
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("signal store HTTP "+r.status));
  return j.ledger||null;
}
async function readEventHistory(env,kind,from,to,limit=3650){
  const r=await store(env,"__history_index__",kind).fetch("https://opening-signal.internal/history-index");
  const j=await r.json();if(!r.ok||!j.ok)throw new Error("history index unavailable");
  // Older immutable ledgers predate the index. Probe a bounded window as well;
  // the nightly archive supplies the full preceding evidence without date guessing.
  const recent=[];let d=new Date(to+"T12:00:00Z");
  for(let i=0;i<31;i++){const date=d.toISOString().slice(0,10);if(date<from)break;recent.push(date);d.setUTCDate(d.getUTCDate()-1);}
  const dates=[...new Set([...(j.dates||[]),...recent])].filter(d=>d>=from&&d<=to).sort().reverse().slice(0,limit);
  const ledgers=[],sourceWarnings=[];
  for(let i=0;i<dates.length;i+=6){
    const batch=await Promise.allSettled(dates.slice(i,i+6).map(d=>readLedger(env,d,kind)));
    batch.forEach((x,k)=>{if(x.status==="fulfilled"){if(x.value)ledgers.push(x.value);}else sourceWarnings.push(dates[i+k]+": "+String(x.reason?.message||x.reason));});
  }
  return {dates,ledgers,sourceWarnings};
}

async function scanOne(env,shard,target,mainVariant){
  const u=baseUrl(env)+"/api/opening-monitor?shard="+shard+"&shards="+SHARDS+"&limit="+LIMIT+"&targetHm="+target+"&mainVariant="+encodeURIComponent(mainVariant||"baseline");
  const r=await fetch(u,{headers:{"x-monitor-key":env.MONITOR_KEY,"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("shard "+shard+" HTTP "+r.status+" "+String(j.error||j.skipped||""));
  return j;
}
async function appendExecution(env,event){
  const r=await store(env,event.date).fetch('https://opening-signal.internal/execution',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(event)});
  const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'execution evidence storage failed');
}
export async function executeVts(env,date,buyEvents,sellEvents,blockedReason=''){
  const intent={id:crypto.randomUUID(),phase:'intent',date,at:new Date().toISOString(),requests:openingOrderRefs(date,buyEvents,sellEvents)};
  if(!intent.requests.length)return {ordersOk:false,eventCount:0};
  // No broker request before durable intent. A missing result remains unknown, never auto-retried here.
  await appendExecution(env,intent);
  let response={},status=0,error='';
  if(blockedReason){response={ok:true,enabled:false,reason:blockedReason};status=200;}
  else try{
    const r=await fetch(baseUrl(env)+"/api/opening-execute",{
      method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
      body:JSON.stringify({date,buyEvents,sellEvents,source:"cloudflare-cron"})
    });
    status=r.status;response=await r.json();
    if(!r.ok||!response.ok)error='opening-execute HTTP '+status+' '+String(response.error||'');
  }catch(e){error=String(e.message||e);}
  const result=openingExecutionResult(intent,response,status,error);
  await appendExecution(env,result);
  return {...response,ordersOk:result.ordersOk,counts:result.counts,eventCount:result.receipts.length,executionError:error||null};
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
    const baselineDelivery=mainVariant==="baseline"?buyDelivery:{channel:"telegram",sent:false,messageId:null,error:null,reason:"canonical_baseline_observation"};
    const baselineSellDelivery=mainVariant==="baseline"?sellDelivery:{channel:"telegram",sent:false,messageId:null,error:null,reason:"canonical_baseline_observation"};
    for(const x of (p.baselineBuyEvents||[]))out.push(liveEvent(date,target,"buy","baseline",x,baselineDelivery,null));
    for(const x of (p.baselineSellEvents||[]))out.push(liveEvent(date,target,"sell","baseline",x,baselineSellDelivery,null));
    if(mainVariant!=="baseline"){
      for(const x of (p.buyEvents||[]))out.push(liveEvent(date,target,"buy",mainVariant,x,buyDelivery,null));
      for(const x of (p.sellEvents||[]))out.push(liveEvent(date,target,"sell",mainVariant,x,sellDelivery,null));
    }
    for(const v of (p.shadowEvents||[])){
      if(String(v.name||"shadow")===mainVariant)continue; // 운영 메인 이벤트와 동일 ID 중복 방지
      const delivery={channel:"telegram",sent:false,messageId:null,error:null,reason:"shadow_strategy_not_notified"};
      for(const x of (v.buyEvents||[]))out.push(liveEvent(date,target,"buy",String(v.name||"shadow"),x,delivery,v));
      for(const x of (v.sellEvents||[]))out.push(liveEvent(date,target,"sell",String(v.name||"shadow"),x,delivery,v));
    }
  }
  return out;
}
// 장중 신호 엔진의 09:30 분봉 지연/누락을 대비한 마지막 청산 안전망.
// 장부에 기록된 메인 매수 중 매도 신호가 없는 것만 반환한다. 다른 전략·그림자·전일 물량은 제외.
// 이는 '모의 매도 주문 시도'이며 KIS 체결 확정이나 확정 손익을 의미하지 않는다.
export function openingUnmatchedExits(ledger,mainVariant){
  if(!ledger||!Array.isArray(ledger.events))return [];
  const buys=new Map(),sold=new Set();
  const key=e=>String(e.code||e.signal?.code||"")+":"+String(e.signal?.entryTime||"");
  for(const e of ledger.events){
    if(!e||e.variant!==mainVariant||!["buy","sell"].includes(e.stage))continue;
    const id=key(e),sig=e.signal||{};
    if(!String(sig.entryTime||"")||!String(e.code||sig.code||""))continue;
    if(e.stage==="buy")buys.set(id,{...sig,code:e.code||sig.code,name:e.name||sig.name||e.code});
    else sold.add(id);
  }
  return [...buys].filter(([id,x])=>!sold.has(id)&&+x.entryTime<930)
    .map(([,x])=>({...x,exitTime:930,exitPrice:null,pnl:null,
      reason:"09:30 종료 매도 원본 누락 · 모의주문/체결 확인 필요",finalExitUnverified:true}));
}
export async function forceOpeningSessionClose(env,date,mainVariant,target){
  if(target!==930)return {count:0};
  const ledger=await readLedger(env,date);
  const missing=openingUnmatchedExits(ledger,mainVariant);
  if(!missing.length)return {count:0};
  const now=Date.now();
  // 원본 보관 실패 시 주문하지 않는다. 이전 매도/다른 전략을 절대로 다시 팔지 않는다.
  await appendLedger(env,{scanId:(ledger.scans||[]).at(-1)?.id||date+":opening:final-exit-check",date,mainVariant,
    scheduledTime:now,capturedAt:new Date(now).toISOString(),targetHm:930,
    partial:false,okShards:0,quoteErrors:0,events:missing.map(x=>
      liveEvent(date,930,"sell",mainVariant,x,{channel:"telegram",sent:false,reason:"final_exit_unverified"},null))});
  let exec;
  try{exec=await executeVts(env,date,[],missing);}
  catch(e){console.error(JSON.stringify({type:"opening_final_exit_vts_failed",date,count:missing.length,error:String(e.message||e)}));return {count:missing.length,ok:false,error:String(e.message||e)};}
  console.log(JSON.stringify({type:"opening_final_exit_recovery",date,count:missing.length,vts:exec.events||[]}));
  return {count:missing.length,ok:exec.ordersOk,counts:exec.counts};
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

async function notifyOpeningWebPush(env,date,buys,sells,mainVariant){
  const out=[];
  for(const [stage,items] of [["buy",buys],["sell",sells]])for(const x of items){
    const hm=String((stage==="buy"?x.entryTime:x.exitTime)||"").padStart(4,"0");
    const code=String(x.code||""),price=Number(stage==="buy"?x.entryPrice:x.exitPrice);
    const lines=[String(x.name||code).slice(0,50)+" ("+code+")",Number.isFinite(price)?Math.round(price).toLocaleString("ko-KR")+"원":"가격 확인 중",
      stage==="sell"&&x.pnl!=null&&Number.isFinite(Number(x.pnl))?"전략 손익 "+Number(x.pnl).toFixed(2)+"%":"기준전략 "+mainVariant+" · 체결가 확인 전"];
    const eventId=["opening",date,mainVariant,code,stage,hm].join(":");
    try{
      const r=await fetch(baseUrl(env)+"/api/scalping-alert",{method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
        body:JSON.stringify({strategy:"opening",stage,webOnly:true,eventId,date,time:hm.slice(0,2)+":"+hm.slice(2)+" KST",lines})});
      const j=await r.json().catch(()=>({}));out.push({eventId,ok:r.ok&&!!j.ok,error:j.error||j.webPush?.error||null});
    }catch(e){out.push({eventId,ok:false,error:String(e.message||e)});}
  }
  return out;
}
export function recentOpeningAlertEvents(ledger,target,windowMin=8){
  const minute=hm=>Math.floor(Number(hm)/100)*60+Number(hm)%100;
  const full=new Set((ledger?.scans||[]).filter(x=>!x.partial&&x.okShards===SHARDS).map(x=>x.targetHm));
  const variant=String(ledger?.mainVariant||"baseline"),out=[];
  for(const e of ledger?.events||[]){
    if(e.variant!==variant||!full.has(e.targetHm)||!["buy","sell"].includes(e.stage))continue;
    const age=minute(target)-minute(e.targetHm);
    if(age<1||age>windowMin)continue; // This minute's VTS/first-delivery path stays unchanged.
    const x=e.signal||{},hm=String((e.stage==="buy"?x.entryTime:x.exitTime)||e.targetHm).padStart(4,"0");
    out.push({strategy:"opening",stage:e.stage,webOnly:!e.alertDelivery?.error,
      eventId:["opening",ledger.date,variant,String(x.code||e.code),e.stage,hm].join(":"),date:ledger.date,
      time:hm.slice(0,2)+":"+hm.slice(2)+" KST",
      eventAt:new Date(Date.parse(ledger.date+"T00:00:00+09:00")+(minute(e.targetHm)+1)*60_000).toISOString(),
      lines:[String(x.name||e.name||e.code)+" ("+String(x.code||e.code)+")","보관된 운영 메인 "+variant+" 신호 재전송",
        e.stage==="sell"&&x.pnl!=null?"전략 손익 "+Number(x.pnl).toFixed(2)+"%":"매수 "+hm]});
  }
  return out;
}
async function retryOpeningNotifications(env,date,target){
  try{
    const ledger=await readLedger(env,date);
    for(const payload of recentOpeningAlertEvents(ledger,target)){
      const r=await fetch(baseUrl(env)+"/api/scalping-alert",{method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},body:JSON.stringify(payload)});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok)console.warn(JSON.stringify({type:"opening_alert_retry_failed",eventId:payload.eventId,error:j.error||j.webPush?.error||r.status}));
    }
  }catch(e){console.warn(JSON.stringify({type:"opening_alert_retry_failed",date,error:String(e.message||e)}));}
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
  const pn=trades.map(x=>x.pnl==null?NaN:Number(x.pnl)).filter(Number.isFinite),wins=pn.filter(x=>x>0).length,losses=pn.filter(x=>x<0).length;
  const avg=pn.length?pn.reduce((s,x)=>s+x,0)/pn.length:0;
  const lines=[
    "후보/진입 "+trades.length+"건 · 청산 "+pn.length+"건 · 미청산 "+Math.max(0,trades.length-pn.length)+"건",
    "승 "+wins+" · 패 "+losses+" · 승률 "+(pn.length?(wins/pn.length*100).toFixed(1):"0.0")+"%",
    "실현 평균 순수익률 "+(avg>=0?"+":"")+avg.toFixed(2)+"% · 왕복 마찰비용 0.25% 반영"
  ];
  for(const x of trades)lines.push((x.name||x.code)+" · "+String(x.entryTime||"—")+"→"+String(x.exitTime||"—")+" · "+(x.pnl!=null&&Number.isFinite(+x.pnl)?((+x.pnl>=0?"+":"")+(+x.pnl).toFixed(2)+"%"):"체결 확인 전")+" · "+String(x.reason||""));
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
  await retryOpeningNotifications(env,kst.date,target);
  // 09:31 KST: 원본 장부에서 종료되지 않은 실제 메인 매수 신호만 VTS 매도 시도.
  // 일부 샤드 실패에도 이미 기록된 매수분은 보호하되, 미확정 가격/체결을 수익으로 확정하지 않는다.
  if(target===930){
    try{await forceOpeningSessionClose(env,kst.date,mainVariant,target);}
    catch(e){console.error(JSON.stringify({type:"opening_final_exit_recovery_failed",date:kst.date,error:String(e.message||e)}));}
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
    result.webPush=await notifyOpeningWebPush(env,kst.date,buyEvents,sellEvents,mainVariant);
    const exec=await executeVts(env,kst.date,buyEvents,sellEvents,'알림 전송 실패 · 주문 중지');
    result.vts={ok:false,skipped:"alert_delivery_failed",counts:exec.counts};
    console.error(JSON.stringify(result));
    return;
  }

  if((buyEvents.length||sellEvents.length)&&lag<=MAX_EXEC_LAG_MS){
    try{
      const exec=await executeVts(env,kst.date,buyEvents,sellEvents);
      result.vts={ok:exec.ordersOk,eventCount:exec.eventCount,counts:exec.counts,error:exec.executionError};
    }catch(e){
      result.vts={ok:false,error:String(e.message||e)};
      result.webPush=await notifyOpeningWebPush(env,kst.date,buyEvents,sellEvents,mainVariant);
      console.error(JSON.stringify(result));
      throw e;
    }
  }else if(buyEvents.length||sellEvents.length){
    const exec=await executeVts(env,kst.date,buyEvents,sellEvents,'오래된 신호 · 주문 중지');
    result.vts={ok:false,skipped:"stale_signal",maxExecLagMs:MAX_EXEC_LAG_MS,counts:exec.counts};
  }

  if(buyEvents.length||sellEvents.length){
    // VTS 처리가 끝난 뒤 웹푸시: 알림 실패는 모의주문 경로에 간섭하지 않는다.
    result.webPush=await notifyOpeningWebPush(env,kst.date,buyEvents,sellEvents,mainVariant);
  }
  console.log(JSON.stringify(result));
  if(kst.hh===9&&kst.mm===31){ try{await sendOpeningCloseSummary(env,kst.date);}catch(e){console.error(JSON.stringify({type:"opening_close_summary_failed",date:kst.date,error:String(e.message||e)}));} }
}

// ── D-1 시초가 갭하락 과매도(opening_gapdown_v1) 연구용 모의체결 ──
// 08:56 예상체결가 조회(40종목씩 순차) → 08:58 갭 깊은 10종목 다시 조회 → 규칙 선택 + 장전 동시호가 VTS 매수 → 15:21 종가 동시호가 VTS 매도 → 15:40 체결 조회.
// 매 단계 응답 원본을 별도 ledger(gapdown:날짜)에 먼저 쌓는다. 주문 호출은 재시도하지 않는다.
// Workers 무료 요금제는 계정 전체 cron 5개가 한도라 이 Worker 는 cron 한 줄만 쓴다(wrangler.jsonc).
// "0,5-31,40,56 0,6,9,15,20,21,23 * * *" 로 필요한 시각을 모두 덮고, 실제로 할 일은 한국시각으로 여기서 고른다(0분은 ⑤ 15:00 매수 — 2026-10-22).
// 토요일 09:05 — 금요일 밤(23:40) 장부로 이번 주 결과를 보낸다(코인 금요일 하루는 토 09시에 끝나 다음 주 계산에 들어감).
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
  if(hm===1506)return "closing_day_signal";
  if(hm===1507)return "closing_day_entry";
  if(hm===1522)return "closing_overnight_signal";
  if(hm===906)return "opening"; // 병렬로 종가 베팅의 전일 종목 시가 청산
  if(hm===1500)return "gapdown_c30";               // ⑤ 종가 30분 — 15:00 판단 · 매수(15:21 매도 · 15:40 체결 조회는 아래 ①② 단계에 붙어 돈다)
  if(hm===856)return "gapdown_preopen";
  if(hm===1521)return "gapdown_close";
  if(hm===1540)return "gapdown_reconcile";
  if(hm===1556)return "claude_kr";                 // 15:40 마감 알림이 실패했을 때 한 번 더
  if(hm===1810)return "duel";                      // GPT·클로드 일일 대결은 Worker가 정시에 전송
  return null;
}
// 한투 접근 토큰 보관(2026-10-20 · 한투 알림톡 "1일 1회 발급 원칙, 잦은 발급 시 이용 제한"): Pages kis.js 가 모의투자 토큰을 맡기고 꺼내
// 계좌 · 앱마다 하루 한 번만 받게 한다. 이름표 k = 앱키 해시 앞 16자리(앱키는 받지 않음) · 만료는 지금+25시간 안 · 실전 토큰은 오지 않는다.
export function kisTokenRecord(b,now=Date.now()){
  if(!b||!/^[0-9a-f]{16}$/.test(String(b.k||"")))return null;
  if(b.drop!=null)return typeof b.drop==="string"&&b.drop.length>0&&b.drop.length<=4096?{k:b.k,drop:b.drop}:null;
  const token=String(b.token||""),exp=+b.exp;
  if(token.length<20||token.length>4096||/\s/.test(token))return null;
  if(!(exp>now+60e3)||exp>now+25*36e5)return null;
  return {k:b.k,token,exp};
}

// ── 종가 30분: 당일 15:06~15:30 + 개별 종목 종가 매수/익일 시가 매도 ──
// 기준/10 그림자 모두 같은 보존 가능한 신호장부. 연구용 종이체결만, VTS 실주문 금지.
// 매수 신호와 확정 가능한 모의가격을 분리해 15:30 종가를 미리 아는 오류를 방지한다.
const CLOSING_STAGE_MAP={closing_day_signal:1506,closing_day_entry:1507,
  closing_overnight_signal:1522,closing_settle:1540,closing_overnight_exit:906};
const closingKey=(kind,variant,code,stage)=>[kind,variant,code,stage].join(":");
function closingEvent(date,kind,variant,code,stage,price=null,meta={}){
  return {id:[date,kind,variant,code,stage].join(":"),date,kind,variant,code,
    name:meta.name||code,stage,targetHm:meta.targetHm||null,
    createdAt:new Date().toISOString(),price:price??null,
    source:meta.source||"paper-only",pnl:meta.pnl??null,
    signal:meta.signal||null,strategyParams:meta.strategyParams||null,priceAt:meta.priceAt||null,decisionVersion:"closing30_v1",
    orderStatus:"paper_only_no_broker_order",state:stage==="signal"?"candidate":"paper_filled"};
}
async function closingApi(env,params){
  const q=new URLSearchParams(params);
  const r=await fetch(baseUrl(env)+"/api/closing30-monitor?"+q.toString(),{
    headers:{"x-monitor-key":env.MONITOR_KEY,"accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw Error(j.error||"closing monitor "+r.status);
  return j;
}
async function closingAlert(env,date,e,stage){
  if(e.variant!=="baseline")return;
  const lines=[
    e.name+" ("+e.code+") · "+(e.kind==="day"?"종가 30분 당일청산":"종가 베팅 · 익일 시가청산"),
    "모의체결 "+Number(e.price).toLocaleString("ko-KR")+"원 · "+e.source,
    stage==="sell"&&e.pnl!=null?"비용반영 손익 "+(e.pnl>=0?"+":"")+e.pnl.toFixed(2)+"%":"증권사 실제 주문 없음 · 모의장부"];
  try{
    const time=String(e.targetHm||0).padStart(4,"0").replace(/(..)(..)$/,"$1:$2");
    const r=await fetch(baseUrl(env)+"/api/scalping-alert",{method:"POST",
      headers:{"x-monitor-key":env.MONITOR_KEY,"content-type":"application/json"},
      body:JSON.stringify({strategy:"closing30",stage,date:e.createdAt.slice(0,10)||date,time,
        eventId:e.id,eventAt:e.createdAt,lines})});
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)console.error("closing30 alert "+(j.error||r.status));
  }catch(error){console.error("closing30 alert failed "+String(error));}
}
async function lastOpenDate(env,date){
  let d=new Date(date+"T00:00:00Z");
  for(let i=0;i<9;i++){
    d.setUTCDate(d.getUTCDate()-1);const prior=d.toISOString().slice(0,10);
    try{if(await krMarketOpen(env,prior))return prior;}catch(error){throw Error("KRX previous day not verified: "+error);}
  }
  throw Error("previous open day not resolved");
}
function closingEntries(ledger,kind,stage){
  return (ledger?.events||[]).filter(e=>e&&e.kind===kind&&e.stage===stage);
}
async function runClosing30(route,controller,env){
  const scheduled=Number(controller.scheduledTime)||Date.now(),now=Date.now();
  if(Math.max(0,now-scheduled)>MAX_SCAN_LAG_MS)throw Error("closing30 scheduled invocation stale");
  const today=kstParts(scheduled).date,hm=kstHm(scheduled);
  if(route==="closing_day_signal"||route==="closing_overnight_signal"){
    const kind=route==="closing_day_signal"?"day":"overnight";
    const j=await closingApi(env,{op:"scan",kind,date:today});
    const events=(j.signals||[]).map(x=>closingEvent(today,kind,x.variant,x.code,"signal",null,{
      name:x.name,source:"15시 완성봉 관측",targetHm:hm,signal:x.signal,strategyParams:x.strategyParams}));
    const receipt=await appendLedger(env,{date:today,mainVariant:"baseline",scanId:"closing:"+today+":"+route,
      scheduledTime:scheduled,capturedAt:new Date(now).toISOString(),targetHm:hm,
      partial:!!j.partial,failed:j.errors||[],okShards:1,quoteErrors:j.errors?.length||0,events},"closing30");
    console.log(JSON.stringify({type:route,date:today,signals:events.length,recorded:receipt.added,partial:j.partial}));
    return;
  }
  const prior=route==="closing_overnight_exit"?await lastOpenDate(env,today):today;
  const ledger=await readLedger(env,prior,"closing30");
  if(!ledger){console.warn(JSON.stringify({type:"closing30_missing_signal_ledger",date:prior,route}));return;}
  if((ledger.scans||[]).some(x=>x.partial))throw Error("partial input: do not fill unverified signals");
  const cases=route==="closing_day_entry"?[["day","signal","buy","day_entry"]]:
    route==="closing_settle"?[["day","buy","sell","day_exit"],["overnight","signal","buy","overnight_entry"]]:
    [["overnight","buy","sell","overnight_exit"]];
  for(const [kind,sourceStage,destStage,priceStage] of cases){
    const previous=closingEntries(ledger,kind,sourceStage),already=new Set(closingEntries(ledger,kind,destStage)
      .map(e=>closingKey(e.kind,e.variant,e.code,sourceStage)));
    const fresh=previous.filter(e=>!already.has(closingKey(e.kind,e.variant,e.code,sourceStage)));
    if(!fresh.length)continue;
    const codes=[...new Set(fresh.map(x=>x.code))];
    const quotes=await closingApi(env,{op:"prices",stage:priceStage,date:today,codes:codes.join(",")});
    const prices=new Map((quotes.prices||[]).map(x=>[x.code,x]));
    const events=fresh.flatMap(x=>{
      const q=prices.get(x.code);
      if(!q||!(q.price>0))return [];
      let pnl=null;
      if(destStage==="sell"){
        const bought=closingEntries(ledger,kind,"buy").find(y=>y.variant===x.variant&&y.code===x.code);
        if(!bought||!(bought.price>0))return [];
        pnl=(q.price/bought.price-1)*100-.23; // 보수적인 왕복 비용 0.23% 연구가정
      }
      return [closingEvent(prior,kind,x.variant,x.code,destStage,q.price,{
        name:x.name,source:q.source,targetHm:hm,pnl,signal:x.signal||null,strategyParams:x.strategyParams,priceAt:q.priceAt})];
    });
    if(!events.length){console.warn(JSON.stringify({type:"closing30_fill_unavailable",route,kind,date:prior,missing:quotes.missing}));continue;}
    // 09:06 경과 후 이전 거래일 장부에 다음날 시가 청산 결과를 소급 첨부하되 주문은 소급하지 않는다.
    const saved=await appendLedger(env,{date:prior,mainVariant:"baseline",
      scanId:"closing:"+prior+":"+route+":"+today,scheduledTime:scheduled,
      capturedAt:new Date(now).toISOString(),targetHm:hm,
      partial:false,okShards:1,quoteErrors:quotes.errors?.length||0,events},"closing30");
    // 이미 처리된 id는 저장소에서 중복 배제. 재호출 시 동일 event를 다시 알리지 않는다.
    if(saved.added>0)for(const e of events.filter(e=>e.variant==="baseline"))await closingAlert(env,prior,e,destStage);
    console.log(JSON.stringify({type:route,kind,date:prior,events:events.length,stored:saved.added,priceErrors:quotes.errors?.length||0}));
  }
}

const GAPDOWN_PARTS=2;
// ① 08:58 다시 보기(2026-10-19 사용자 선택 '가'): 08:56 예상가가 실제 시가보다 평균 5.4%p 깊었다(체결 12건) — 실제로는 갭하락이 아닌 종목을 샀다.
// 08:56 전체 조회(1~2분 걸림)는 그대로 두고, 갭 깊은 n 종목만 08:58:00 뒤 다시 물어 그 값으로 고른다.
// 08:58:45 가 지났으면(전체 조회가 늦은 날) 다시 묻지 않고 08:56 값으로 — 08:59:40 주문 마감을 지킨다.
export const RECHECK={atHms:85800,lastHms:85845,n:10};
export function recheckCodes(cands,rule,n=RECHECK.n){
  const gapMax=+(rule||{}).gapMax,gapFloor=+(rule||{}).gapFloor;          // 기준값은 전날 밤 명단(rule)에서만 — 없으면 다시 보지 않는다(08:56 값으로)
  if(!Number.isFinite(gapMax)||!Number.isFinite(gapFloor))return [];
  return (Array.isArray(cands)?cands:[]).filter(c=>c&&c.expectedGapPct!=null&&Number.isFinite(+c.expectedGapPct)&&+c.expectedGapPct<=gapMax&&+c.expectedGapPct>gapFloor)
    .sort((a,b)=>a.expectedGapPct-b.expectedGapPct||String(a.code).localeCompare(String(b.code))).slice(0,n).map(c=>String(c.code));
}
const kstHms=ms=>{const p=kstParts(ms);return p.hh*10000+p.mm*100+p.ss;};
const secOf=h=>Math.floor(h/10000)*3600+Math.floor(h/100)%100*60+h%100;
export function recheckWaitMs(ms){const h=kstHms(ms);return h>=RECHECK.atHms?0:(secOf(RECHECK.atHms)-secOf(h))*1000-ms%1000;}
export function recheckOpen(ms){return kstHms(ms)<RECHECK.lastHms;}
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
async function sendDuelSummary(env,date){
  try{
    const r=await fetch(baseUrl(env)+"/api/scalping-duel",{
      method:"POST",
      headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
      body:JSON.stringify({date})
    });
    const j=await r.json().catch(()=>({}));
    console.log(JSON.stringify({type:"scalping_duel_summary",date,ok:!!j.ok,pending:!!j.pending,duplicate:!!j.duplicate,error:j.error||null}));
    if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));
    return j;
  }catch(e){
    console.error(JSON.stringify({type:"scalping_duel_summary_failed",date,error:String(e.message||e)}));
    return null;
  }
}
async function claudeAlertsNow(env){
  try{await claudePushWatch(env);}
  catch(e){console.error(JSON.stringify({type:"claude_alert_now_failed",error:String(e.message||e)}));}
}
// ── 단타(클로드) 전략별 하루 마감 장부 ──
// Pages 가 그 시점까지의 원본으로 마감 장부를 계산 → Durable Object(claude:{거래일})에 한 번만 저장(먼저 저장된 것이 정본).
// 밤 계산(data/claude-live 사본)과 GPT 대결 비교가 이 장부를 읽는다. 사용자 요청(2026-10-13)으로 마감 결과 텔레그램은 보내지 않는다.
export function claudeCloseRecord(ledger,strategy){
  const ev=(ledger&&Array.isArray(ledger.events)?ledger.events:[]);
  return (ev.find(e=>e&&e.id==="close:"+strategy)||{}).payload||null;
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
async function claudeDayClose(env,strategy,date,ms){
  try{
    if(claudeCloseRecord(await readLedger(env,date,"claude"),strategy))return true;     // 이미 저장
    const c=await claudePost(env,{op:"close",strategy,date});
    if(!c.ok||!c.result){console.error(JSON.stringify({type:"claude_close_failed",strategy,date,error:c.error||""}));return false;}
    await claudeAppend(env,date,"close:"+strategy,"close",c.result,ms);
    console.log(JSON.stringify({type:"claude_day_close",strategy,date}));
    return true;
  }catch(e){console.error(JSON.stringify({type:"claude_day_error",strategy,date,error:String(e.message||e)}));return null;}
}
async function claudeKrClose(env,date,ms){
  await claudeDayClose(env,"opening",date,ms);
  await claudeDayClose(env,"daytrading",date,ms);
  await claudeDayClose(env,"close30",date,ms);
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
// 단타(클로드) ①② — 장이 열리는 날인지 먼저. 휴장이면 08:56 에 기록 한 줄 + 텔레그램 '휴장' 한 번만, 나머지(시세·주문·15:21·15:40)는 하지 않는다.
export function krHolidayAction(stage,date){
  const kd=krxDay(date);
  if(!kd.closed)return "run";
  return stage==="preopen"?"notice":"skip";
}
export async function runGapdown(stage,controller,env){
  if(!env.MONITOR_KEY||!env.SIGNAL_STORE)throw new Error("MONITOR_KEY/SIGNAL_STORE missing");
  const ms=Number(controller.scheduledTime)||Date.now();
  const date=kstParts(ms).date;
  const hol=krHolidayAction(stage,date);
  if(hol!=="run"){
    if(hol==="notice"){
      try{await gapdownRecord(env,date,"preopen",{stage:"preopen",date,decisionReason:"krx_holiday",holiday:true,picks:[],orders:[],candidates:0},ms);}
      catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage:"holiday",error:String(e.message||e)}));}
    }
    console.log(JSON.stringify({type:"gapdown_holiday",date,stage,action:hol}));
    return;
  }
  if(stage==="c30"){                               // ⑤ 15:00 — 지금 가격이 전일 종가보다 메인 기준 미만이면 시장가 매수(Pages 가 판단 · 주문, 재시도 없음)
    await runEtf(env,date,"c30_buy",ms);
    await claudeAlertsNow(env);                      // ⑤ 매수 기록 직후 바로 알림
    return;
  }
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
    let recheck=null;                                 // ① 08:58 다시 보기 — 위 RECHECK 설명
    const codes=recheckCodes(candidates,(parts[0]&&parts[0].watchlist&&parts[0].watchlist.rule)||null);
    if(codes.length){
      const wait=recheckWaitMs(Date.now());
      if(wait>0)await new Promise(r=>setTimeout(r,wait));
      if(recheckOpen(Date.now())){
        try{recheck=await gapdownCall(env,{stage:"quote",date,codes});}
        catch(e){recheck={ok:false,error:String(e.message||e)};}
        recheck.part="recheck";
        try{await gapdownRecord(env,date,"quote",recheck,ms);}
        catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage:"quote",part:"recheck",error:String(e.message||e)}));}
      }
    }
    let res;
    try{res=await gapdownCall(env,{stage:"preopen",date,candidates,...(recheck&&recheck.ok&&Array.isArray(recheck.candidates)?{recheck:recheck.candidates}:{})});}
    catch(e){res={ok:false,error:"전송 결과 불명 — 재시도하지 않음: "+String(e.message||e)};}
    try{await gapdownRecord(env,date,"preopen",res,ms);}
    catch(e){console.error(JSON.stringify({type:"gapdown_archive_failed",stage:"preopen",error:String(e.message||e)}));}
    console.log(JSON.stringify({type:"gapdown_preopen",date,picks:(res.picks||[]).length,orders:(res.orders||[]).length,reason:res.decisionReason||res.error||""}));
    await claudeAlertsNow(env);                      // ① 매수 · ② 매도 기록 직후 바로 알림(5분 감시를 기다리지 않게)
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
  // ⑤ 종가 30분: 15:21 오늘 15:00 매수분 종가 동시호가 매도(보유가 없으면 Pages 가 주문하지 않음) — ② 매수 판단보다 먼저(15:28 창 안)
  if(stage==="close")await runEtf(env,date,"c30_sell",ms);
  // ② ETF: 15:21 종가 매수 판단(매일) · 15:40 체결 조회(매일)
  await runEtf(env,date,stage==="close"?"etf_buy":"etf_reconcile",ms);
  if(stage!=="close")await runEtf(env,date,"c30_reconcile",ms);   // ⑤ 15:40 오늘 매수 · 매도 체결 조회
  if(stage!=="close")await claudeKrClose(env,date,ms);   // 15:40 체결조회로 ①②⑤ 장부가 마감된 뒤 전략별 마감 장부 저장(텔레그램 없음)
  await claudeAlertsNow(env);                      // ② 매수(15:21) · ① 매도 체결(15:40) 직후 바로 알림
}

export const CLAUDE_CONFIG_KEY="main";
export function claudeConfigEvent(b){
  if(!b||typeof b!=="object")return null;
  const tabs=["opening","daytrading","crypto","soxl","close30"];
  if(!tabs.includes(b.tab)||!b.version||typeof b.params!=="object"||!b.params||!/^\d{4}-\d{2}-\d{2}$/.test(String(b.effectiveFrom||""))||!b.promotedAt)return null;
  const payload={tab:b.tab,version:String(b.version).slice(0,80),name:String(b.name||"").slice(0,120),rule:String(b.rule||"").slice(0,400),
    params:b.params,effectiveFrom:String(b.effectiveFrom),promotedAt:String(b.promotedAt),prevVersion:String(b.prevVersion||""),by:String(b.by||"").slice(0,120),
    basis:b.basis&&typeof b.basis==="object"?{labGeneratedAt:String(b.basis.labGeneratedAt||""),rank:+b.basis.rank||null,promotion:String(b.basis.promotion||"").slice(0,300)}:null};
  return {id:"promote:"+payload.tab+":"+payload.promotedAt,date:CLAUDE_CONFIG_KEY,capturedAt:new Date().toISOString(),targetHm:0,strategy:"claude_main",stage:"promote",payload};
}

// ── 단타(클로드) 매수·매도 웹 알림 — 5분마다 실시간 화면 자료(/api/claude-live)로 새 매수·매도를 찾아 보낸다 ──
export const nextPushAt=ms=>(Math.floor(ms/3e5)+1)*3e5;          // 다음 5분 정각(알람)
async function pushStore(env,op,body){
  const stub=env.SIGNAL_STORE.get(env.SIGNAL_STORE.idFromName("claudepush"));
  const r=await stub.fetch("https://store/push/"+op,body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{});
  return r.json();
}
async function pushBroadcast(env,msgs,call=(op,b)=>pushStore(env,op,b)){
  const [{jwk},{subs}]=await Promise.all([call("vapid",{}),call("subs")]);
  const res=[],gone=[];
  for(const m of msgs)for(const s of subs){
    try{const r=await sendPush(s,{title:m.title,body:m.body,tag:m.tag,url:m.url},jwk);res.push({id:m.id,status:r.status});if(r.gone)gone.push(s.endpoint);}
    catch(e){res.push({id:m.id,error:String(e.message||e)});}
  }
  if(gone.length)await call("drop",{endpoints:gone});
  return {subs:subs.length,sent:res,dropped:gone.length};
}
// 매일 08:00 연구 리포트(사용자 요청 2026-10-14) — 같은 날 리포트는 한 번만(먼저 기록하고 보낸다 · 다시 불러도 안 보냄) · 웹 알림 + 텔레그램.
// 텔레그램은 Pages /api/claude-telegram op=report — 거절(definite)만 3번까지, 보냈는지 모르면 다시 보내지 않는다(매수·매도 알림과 같은 규칙).
export async function claudeReport(env,b,call=(op,x)=>pushStore(env,op,x)){
  const m=reportMsg(b);
  if(!m.ok)return {ok:false,error:m.error,status:400};
  const {fresh}=await call("claim",{events:[{id:m.id}]});
  if(!(fresh||[]).includes(m.id))return {ok:true,duplicate:true,id:m.id};
  let push;try{push=await pushBroadcast(env,[m],call);}catch(e){push={error:String(e.message||e)};}
  let telegram={result:"fail",tries:0};
  for(let i=1;i<=CLAUDE_TG_TRIES;i++){
    try{
      const r=await fetch(baseUrl(env)+"/api/claude-telegram",{method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},body:JSON.stringify({op:"report",text:m.text})});
      const j=await r.json().catch(()=>null);
      if(r.ok&&j&&j.ok){telegram={result:"sent",tries:i};break;}
      if(!(j&&j.definite)){telegram={result:"unknown",tries:i,error:(j&&j.error)||("HTTP "+r.status)};break;}
      telegram={result:"fail",tries:i,error:j.error||("HTTP "+r.status)};
    }catch(e){telegram={result:"unknown",tries:i,error:String(e.message||e)};break;}
  }
  return {ok:true,id:m.id,push,telegram};
}
// 텔레그램 — Pages(/api/claude-telegram op=event)가 보낸다. 결과: sent(보냄) · fail(텔레그램이 거절 → 다시 보내도 됨) · unknown(보냈는지 모름 → 다시 안 보냄)
export const CLAUDE_TG_TRIES=3;
async function claudeTgSend(env,m){
  try{
    const r=await fetch(baseUrl(env)+"/api/claude-telegram",{method:"POST",headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
      body:JSON.stringify({op:"event",text:alertText(m)})});
    const j=await r.json().catch(()=>null);
    return r.ok&&j&&j.ok?"sent":j&&j.definite?"fail":"unknown";
  }catch(e){return "unknown";}
}
export async function claudePushWatch(env,nowMs=Date.now(),call=(op,b)=>pushStore(env,op,b),tg=m=>claudeTgSend(env,m)){
  const r=await fetch(baseUrl(env)+"/api/claude-live",{headers:{"x-monitor-key":env.MONITOR_KEY,Accept:"application/json"}});
  const live=await r.json().catch(()=>null);
  if(!r.ok||!live||!live.ok)throw new Error("claude-live "+r.status);
  const {sent}=await call("sent");
  const evs=pushEvents(live,nowMs,sent);
  if(!evs.length)return {events:0};
  const {fresh}=await call("claim",{events:evs});           // 먼저 기록 — 보내다 실패해도 같은 알림을 되풀이하지 않는다
  const msgs=evs.filter(e=>fresh.includes(e.id));
  const again=evs.filter(e=>!fresh.includes(e.id)&&sent[e.id]&&sent[e.id].tg==="fail"&&(+sent[e.id].tgTries||0)<CLAUDE_TG_TRIES);
  if(!msgs.length&&!again.length)return {events:evs.length,fresh:0};
  const out=msgs.length?await pushBroadcast(env,msgs,call):{subs:0,sent:[],dropped:0};   // 웹 알림은 처음 한 번만
  const telegram=[];
  for(const m of [...msgs,...again]){                       // 텔레그램은 같은 사건 · 같은 머리말 — 거절된 것만 최대 3번까지
    const result=await tg(m);
    telegram.push({id:m.id,result});
    await call("tg",{id:m.id,result});
  }
  console.log(JSON.stringify({type:"claude_push",fresh:msgs.map(m=>m.id),...out,telegram}));
  return {events:evs.length,fresh:msgs.length,...out,telegram};
}

export default {
  async scheduled(controller,env,ctx){
    const at=Number(controller.scheduledTime)||Date.now();
    ctx.waitUntil(pushStore(env,"ensure",{}).catch(()=>null));   // 알림 감시 알람이 살아 있는지만 확인(감시는 저장소 알람이 5분마다 — 장 일정과 따로)
    const route=scheduleRoute(at);
    const krRoute=route==="opening"||route==="claude_kr"||route==="duel"||(route&&route.startsWith("closing_"))||(route&&route.startsWith("gapdown_"));
    if(krRoute){
      const date=kstParts(at).date;
      try{
        if(!(await krMarketOpen(env,date))){
          console.log(JSON.stringify({type:"market_closed_skip",market:"KRX",date,route}));
          return;
        }
      }catch(e){
        console.error(JSON.stringify({type:"market_day_unknown_skip",market:"KRX",date,route,error:String(e.message||e)}));
        return;
      }
    }
    if(route==="claude_soxl"){
      const date=nyDate(at);
      if(!isNyseSessionDate(date)){
        console.log(JSON.stringify({type:"market_closed_skip",market:"NYSE",date,route}));
        return;
      }
    }

    if(route==="claude_crypto")ctx.waitUntil(claudeDayClose(env,"crypto",kstParts(at-864e5).date,at));   // 어제 00:00~24:00
    else if(route==="claude_soxl")ctx.waitUntil(claudeDayClose(env,"soxl",nyDate(at),at));
    else if(route==="claude_kr"){if(krHolidayAction("close",kstParts(at).date)==="run")ctx.waitUntil(claudeKrClose(env,kstParts(at).date,at));}
    else if(route==="duel")ctx.waitUntil(sendDuelSummary(env,kstParts(at).date));
    else if(route==="opening"){
      ctx.waitUntil(runMinute(controller,env));
      if(kstHm(at)===906)ctx.waitUntil(runClosing30("closing_overnight_exit",controller,env));
    }
    else if(route&&route.startsWith("closing_"))ctx.waitUntil(runClosing30(route,controller,env));
    else if(route&&route.startsWith("gapdown_")){
      ctx.waitUntil(runGapdown(route.slice(8),controller,env));
      if(route==="gapdown_reconcile")ctx.waitUntil(runClosing30("closing_settle",controller,env));
    }
  },
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/paper-settings"){
      if(!authorized(request,env))return json({ok:false,error:'unauthorized'},401);
      if(!['GET','POST'].includes(request.method))return json({ok:false,error:'method not allowed'},405);
      return store(env,'__paper_settings__').fetch(new Request('https://opening-signal.internal/paper-settings',request));
    }
    if(u.pathname==="/event-history"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const kind=u.searchParams.get("kind")||"opening",from=u.searchParams.get("from")||"2000-01-01",to=u.searchParams.get("to")||kstParts().date;
      if(!["opening","closing30"].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({ok:false,error:"invalid history query"},400);
      try{return json({ok:true,...await readEventHistory(env,kind==="opening"?"":kind,from,to,Math.max(1,Math.min(3650,+u.searchParams.get("limit")||3650)))});}
      catch(e){return json({ok:false,error:String(e.message||e)},502);}
    }
    if(u.pathname==="/closing-ledger"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=u.searchParams.get("date")||kstParts().date;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"bad date"},400);
      try{return json({ok:true,date,ledger:await readLedger(env,date,"closing30")});}
      catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
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
    // 한투 접근 토큰(모의투자만) — Pages kis.js 가 감시키로 맡기고 꺼낸다(위 kisTokenRecord)
    if(u.pathname==="/kis-token"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      return env.SIGNAL_STORE.get(env.SIGNAL_STORE.idFromName("__kis_token__")).fetch("https://opening-signal.internal/kistoken"+u.search,
        {method:request.method==="POST"?"POST":"GET",headers:{"content-type":"application/json"},...(request.method==="POST"?{body:await request.text()}:{})});
    }
    // 단타(클로드) 메인 전략 승격 기록 — 쌓기만 한다(같은 id 는 무시). 내용 검사는 Pages /api/claude-promote 가 소유자 확인과 함께 한다.
    if(u.pathname==="/claude-config"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      try{
        if(request.method==="POST"){
          const b=await request.json().catch(()=>null);
          const e=claudeConfigEvent(b);
          if(!e)return json({ok:false,error:"invalid promote record"},400);
          const r=await appendLedger(env,{scanId:e.id,date:CLAUDE_CONFIG_KEY,scheduledTime:Date.now(),capturedAt:e.capturedAt,targetHm:kstHm(Date.now()),
            lagMs:0,partial:false,okShards:1,failed:[],quoteErrors:0,events:[e]},"claudecfg");
          return json({ok:true,added:r.added,event:e});
        }
        const l=await readLedger(env,CLAUDE_CONFIG_KEY,"claudecfg");
        return json({ok:true,events:((l&&l.events)||[]).map(x=>x.payload)});
      }catch(e){return json({ok:false,error:String(e.message||e)},500);}
    }
    // 단타(클로드) 웹 알림 — Pages /api/claude-push(소유자 확인)가 감시키로 부른다
    if(u.pathname.startsWith("/push-")){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      try{
        const op=u.pathname.slice(6);
        if(op==="key"){const {jwk}=await pushStore(env,"vapid",{});const {subs}=await pushStore(env,"subs");return json({ok:true,publicKey:vapidPublic(jwk),subscribers:subs.length});}
        if(op==="subscribe")return json(await pushStore(env,"sub",await request.json().catch(()=>({}))));
        if(op==="alarm")return json(await pushStore(env,"ensure",{}));
        if(op==="unsubscribe")return json(await pushStore(env,"unsub",await request.json().catch(()=>({}))));
        if(op==="test")return json({ok:true,...await pushBroadcast(env,[{id:"test",title:"🔔 연구(클로드) 알림 켜짐",body:"매수 · 매도 때마다 이렇게 알려 드립니다.",tag:"test",url:"/claude"}])});
        if(op==="watch")return json({ok:true,...await claudePushWatch(env)});
        if(op==="report"&&request.method==="POST"){const r=await claudeReport(env,await request.json().catch(()=>({})));return json(r,r.status||200);}
        return json({ok:false,error:"not found"},404);
      }catch(e){return json({ok:false,error:String(e.message||e)},500);}
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
      schedule:"opening 09:05-09:31 · gapdown 08:56/15:21/15:40 · duel 18:10 KST · crypto close 00:05 · SOXL close 16:05 ET",
      mode:"Cloudflare Cron -> Pages opening-monitor -> immutable signal ledger -> KIS VTS",
      signalLedger:"Durable Object /events (authorized)"
    });
  }
};
