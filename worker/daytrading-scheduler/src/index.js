import { DurableObject } from "cloudflare:workers";

const SHARDS=5;
const MAX_SCAN_LAG_MS=3*60*1000;
const MAX_SNAPSHOT_HM=1015;
const PAPER_MAX_TRADES=3;
const PAPER_STOP_PCT=1.0;
const PAPER_TAKE_PROFIT_PCT=2.0;
const PAPER_FINAL_EXIT_HM=1510;
const PAPER_FRICTION_PCT=0.25;
const KIS_MIN_INTERVAL_MS=650;
const DAY_EXIT_VARIANTS=Object.freeze({
  baseline:{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  "vol_2.0":{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  lookback_30:{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  "vwap_slope_0.2":{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  entry_by_1400:{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  session_min_2:{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  "stop_0.8":{stopPct:0.8,takeProfitPct:2.0,maxTrades:3},
  "tp_1.5":{stopPct:1.0,takeProfitPct:1.5,maxTrades:3},
  "vol_1.2":{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  lookback_10:{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  max_trades_1:{stopPct:1.0,takeProfitPct:2.0,maxTrades:1},
  "vwap_slope_0.15":{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  "session_min_1.5":{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  entry_by_1330:{stopPct:1.0,takeProfitPct:2.0,maxTrades:3},
  "stop_0.8_tp_1.6":{stopPct:0.8,takeProfitPct:1.6,maxTrades:3}
});
function parseGeneratedDayVariant(name){
  const m=/^gen_d_v(\d+)_l(\d+)_s(\d+)_r(\d+)_e(\d+)_sl(\d+)_tp(\d+)_m(\d+)$/.exec(String(name||""));
  if(!m)return null;
  return {stopPct:+m[6]/10,takeProfitPct:+m[7]/10,maxTrades:+m[8]};
}
function dayExitParams(name){return DAY_EXIT_VARIANTS[String(name||"baseline")]||parseGeneratedDayVariant(name)||DAY_EXIT_VARIANTS.baseline;}
function supportedDayVariant(name){return !!DAY_EXIT_VARIANTS[String(name||"")]||!!parseGeneratedDayVariant(name);}

let lastKisAt=0;

function baseUrl(env){return String(env.BASE_URL||"https://jkquant.pages.dev").replace(/\/$/,"");}
function json(o,s=200){return new Response(JSON.stringify(o,null,2),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
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
function hmToMin(hm){return Math.floor((+hm||0)/100)*60+((+hm||0)%100);}
function minToHm(m){return Math.floor(m/60)*100+(m%60);}
function addHm(hm,n){return minToHm(hmToMin(hm)+n);}
function barHm(b){
  const s=String(b&&b.t||"").replace(/\D/g,"");
  if(s.length<6)return -1;
  const x=s.slice(-6);
  return +x.slice(0,4);
}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  return !!env.MONITOR_KEY&&got===env.MONITOR_KEY;
}
async function throttleKis(){
  const wait=KIS_MIN_INTERVAL_MS-(Date.now()-lastKisAt);
  if(wait>0)await sleep(wait);
  lastKisAt=Date.now();
}

export class SnapshotStore extends DurableObject {
  async fetch(request){
    const u=new URL(request.url);
    if(request.method==="GET"&&u.pathname==="/config"){
      const config=(await this.ctx.storage.get("strategyConfig"))||{schema:1,strategy:"daytrading",selectedVariant:"baseline",updatedAt:null,updatedBy:null};
      return json({ok:true,config});
    }
    if(request.method==="POST"&&u.pathname==="/config"){
      const b=await request.json();
      const variant=String(b&&b.variant||"");
      if(!variant||!supportedDayVariant(variant))return json({ok:false,error:"unsupported variant"},400);
      const prev=(await this.ctx.storage.get("strategyConfig"))||{schema:2,strategy:"daytrading",selectedVariant:"baseline",history:[]};
      const at=new Date().toISOString(),effectiveFrom=String(b&&b.effectiveFrom||"");
      const entry={at,effectiveFrom,previousVariant:String(b&&b.previousVariant||prev.selectedVariant||"baseline"),selectedVariant:variant,
        updatedBy:String(b.updatedBy||"owner"),source:String(b.source||"manual-promotion"),
        researchScore:Number.isFinite(+b.researchScore)?+b.researchScore:null,rank:Number.isFinite(+b.rank)?+b.rank:null};
      const history=[...(Array.isArray(prev.history)?prev.history:[]),entry].slice(-50);
      const config={schema:2,strategy:"daytrading",selectedVariant:variant,previousVariant:entry.previousVariant,
        effectiveFrom,updatedAt:at,updatedBy:entry.updatedBy,source:entry.source,researchScore:entry.researchScore,rank:entry.rank,history};
      await this.ctx.storage.put("strategyConfig",config);
      return json({ok:true,config});
    }
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
    if(request.method==="GET"&&u.pathname==="/paper"){
      const ledger=await this.ctx.storage.get("paperLedger");
      return json({ok:true,ledger:ledger||null});
    }
    if(request.method==="POST"&&u.pathname==="/paper"){
      const ledger=await request.json();
      if(!ledger||!ledger.date||!Array.isArray(ledger.trades))return json({ok:false,error:"invalid paper ledger"},400);
      await this.ctx.storage.put("paperLedger",ledger);
      return json({ok:true,ledger});
    }
    return json({ok:false,error:"not found"},404);
  }
}

function store(env,date){
  return env.SNAPSHOT_STORE.get(env.SNAPSHOT_STORE.idFromName(date));
}
function configStore(env){return env.SNAPSHOT_STORE.get(env.SNAPSHOT_STORE.idFromName("__gpt_daytrading_strategy_config__"));}
async function readStrategyConfig(env){
  const r=await configStore(env).fetch("https://snapshot.internal/config");
  const j=await r.json().catch(()=>({}));
  return j.config||{schema:1,strategy:"daytrading",selectedVariant:"baseline",updatedAt:null};
}
async function writeStrategyConfig(env,b){
  const r=await configStore(env).fetch("https://snapshot.internal/config",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("config store HTTP "+r.status));
  return j.config;
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
async function readPaper(env,date){
  const r=await store(env,date).fetch("https://snapshot.internal/paper");
  const j=await r.json();
  return j.ledger||null;
}
async function writePaper(env,ledger){
  const r=await store(env,ledger.date).fetch("https://snapshot.internal/paper",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(ledger)
  });
  const j=await r.json();
  if(!r.ok||!j.ok)throw new Error(j.error||("paper store HTTP "+r.status));
  return j.ledger;
}
async function captureSnapshot(env,date){
  const now=kstParts();
  if(now.date!==date||now.hm>MAX_SNAPSHOT_HM)return null;
  const r=await fetch(baseUrl(env)+"/api/universe?limit=100",{headers:{"Accept":"application/json"}});
  const j=await r.json().catch(()=>({}));
  const rows=Array.isArray(j.universe)?j.universe:[];
  if(!r.ok||!rows.length)throw new Error("universe HTTP "+r.status);
  const config=await readStrategyConfig(env);
  const selected=(config.effectiveFrom&&String(date)<String(config.effectiveFrom))?String(config.previousVariant||"baseline"):String(config.selectedVariant||"baseline");
  const mainVariant=supportedDayVariant(selected)?selected:"baseline";
  const snapshot={
    schema:2,date,mainVariant,
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
  const mainVariant=String(snapshot&&snapshot.mainVariant||"baseline");
  const r=await fetch(baseUrl(env)+"/api/daytrading-monitor",{
    method:"POST",
    headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
    body:JSON.stringify({snapshot,targetHm:target,shard,shards:SHARDS,mainVariant})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("shard "+shard+" HTTP "+r.status+" "+String(j.error||j.skipped||""));
  return j;
}
async function kisMinuteWindow(env,code,date,endHm){
  const compact=String(date||"").replace(/\D/g,"");
  const hour=String(endHm).padStart(4,"0")+"00";
  let last=null;
  for(let attempt=1;attempt<=3;attempt++){
    await throttleKis();
    try{
      const u=baseUrl(env)+"/api/kis?op=minhist&env=vts&market=kr&code="+encodeURIComponent(code)+
        "&date="+encodeURIComponent(compact)+"&hour="+encodeURIComponent(hour);
      const r=await fetch(u,{headers:{"Accept":"application/json"}});
      const j=await r.json().catch(()=>({}));
      if(r.ok&&!j.error)return j.bars||[];
      last=new Error(j.error||("KIS minhist HTTP "+r.status));
      if(!j.rateLimited)break;
    }catch(e){last=e;}
    await sleep(1000*attempt);
  }
  throw last||new Error("KIS minhist failed");
}
async function kisRange(env,code,date,fromHm,toHm){
  const a=hmToMin(fromHm),b=hmToMin(toHm);
  if(!(a>=0)||b<a)return [];
  const by=new Map();
  let cursor=a;
  while(cursor<=b){
    const end=Math.min(cursor+118,b);
    const bars=await kisMinuteWindow(env,code,date,minToHm(end));
    for(const x of bars){
      const h=barHm(x),m=hmToMin(h);
      if(m>=a&&m<=b)by.set(String(x.t||h),x);
    }
    cursor=end+1;
  }
  return [...by.values()].sort((x,y)=>barHm(x)-barHm(y));
}
function blankTrade(c,date,params=DAY_EXIT_VARIANTS.baseline){
  return {
    id:String(c.code)+":"+String(c.signalTime),
    date,code:String(c.code||""),name:c.name||c.code,rank:+c.rank||0,
    mainVariant:String(c.mainVariant||"baseline"),strategyParams:c.strategyParams||null,
    signalTime:+c.signalTime||0,signalPrice:+c.signalPrice||0,score:+c.score||0,
    sessionRet:+c.sessionRet||0,vwapSlope:+c.vwapSlope||0,volRatio:+c.volRatio||0,
    entryTime:addHm(+c.signalTime||0,1),entryPrice:null,status:"pending",
    exitTime:null,exitPrice:null,reason:null,grossPnl:null,pnl:null,
    currentPrice:null,unrealizedPnl:null,lastEvaluatedHm:null,
    stopPct:Number(params.stopPct||PAPER_STOP_PCT),takeProfitPct:Number(params.takeProfitPct||PAPER_TAKE_PROFIT_PCT),
    finalExit:PAPER_FINAL_EXIT_HM,frictionPct:PAPER_FRICTION_PCT,
    source:"kis-minhist-paper"
  };
}
function applyBars(trade,bars,target){
  const t={...trade};
  if(!bars.length)return t;
  if(!(t.entryPrice>0)){
    const e=bars.find(x=>barHm(x)===t.entryTime);
    if(!e)return t;
    t.entryPrice=+(e.o||e.c||0);
    if(!(t.entryPrice>0))return t;
    t.status="open";
  }
  const stopPct=Number(t.stopPct||PAPER_STOP_PCT),takeProfitPct=Number(t.takeProfitPct||PAPER_TAKE_PROFIT_PCT);
  const stop=t.entryPrice*(1-stopPct/100);
  const tp=t.entryPrice*(1+takeProfitPct/100);
  const after=bars.filter(x=>barHm(x)>=t.entryTime&&(!t.lastEvaluatedHm||barHm(x)>t.lastEvaluatedHm));
  for(const b of after){
    const h=barHm(b);
    if(h<0||h>Math.min(target,PAPER_FINAL_EXIT_HM))continue;
    const low=+(b.l||b.c||0),high=+(b.h||b.c||0),close=+(b.c||0);
    t.lastEvaluatedHm=h;
    t.currentPrice=close||t.currentPrice;
    // 장마감 백테스트와 동일하게 한 봉에서 손절/익절이 모두 닿으면 손절 우선.
    if(low>0&&low<=stop){
      t.status="closed";t.exitTime=h;t.exitPrice=stop;t.reason="stop";
      break;
    }
    if(high>0&&high>=tp){
      t.status="closed";t.exitTime=h;t.exitPrice=tp;t.reason="take_profit";
      break;
    }
    if(h>=PAPER_FINAL_EXIT_HM){
      t.status="closed";t.exitTime=PAPER_FINAL_EXIT_HM;t.exitPrice=close;t.reason="time_exit";
      break;
    }
  }
  if(t.status==="open"&&target>=PAPER_FINAL_EXIT_HM){
    const z=bars.filter(x=>barHm(x)<=PAPER_FINAL_EXIT_HM).slice(-1)[0];
    if(z){
      t.status="closed";t.exitTime=PAPER_FINAL_EXIT_HM;t.exitPrice=+(z.c||t.currentPrice||t.entryPrice);t.reason="time_exit";
      t.lastEvaluatedHm=barHm(z);
    }
  }
  if(t.status==="closed"&&t.exitPrice>0){
    t.grossPnl=(t.exitPrice/t.entryPrice-1)*100;
    t.pnl=t.grossPnl-Number(t.frictionPct||PAPER_FRICTION_PCT);
    t.currentPrice=t.exitPrice;t.unrealizedPnl=null;
  }else if(t.entryPrice>0&&t.currentPrice>0){
    t.unrealizedPnl=(t.currentPrice/t.entryPrice-1)*100-Number(t.frictionPct||PAPER_FRICTION_PCT);
  }
  return t;
}
async function advanceTrade(env,date,candidate,existing,target,params=DAY_EXIT_VARIANTS.baseline){
  let t=existing?{...existing}:blankTrade(candidate,date,params);
  if(t.status==="closed")return t;
  if(target<t.entryTime)return t;
  let from=t.entryTime;
  if(t.entryPrice>0&&t.lastEvaluatedHm)from=addHm(t.lastEvaluatedHm,1);
  if(hmToMin(from)>hmToMin(target))return t;
  try{
    const bars=await kisRange(env,t.code,date,from,target);
    t=applyBars(t,bars,target);
    t.lastError=null;
  }catch(e){
    t.lastError=String(e.message||e).slice(0,180);
  }
  return t;
}
function pickCandidates(parts,maxTrades=PAPER_MAX_TRADES){
  const a=parts.flatMap(x=>x.signals||[]).slice().sort((x,y)=>
    (+x.signalTime||0)-(+y.signalTime||0)||(+y.score||0)-(+x.score||0)||String(x.code||"").localeCompare(String(y.code||""))
  );
  const out=[],seen=new Set();
  for(const x of a){
    const code=String(x.code||"");
    if(!code||seen.has(code))continue;
    seen.add(code);out.push(x);
    if(out.length>=maxTrades)break;
  }
  return out;
}
function ledgerSummary(ledger){
  const a=ledger&&ledger.trades||[];
  const closed=a.filter(x=>x.status==="closed"),pn=closed.map(x=>+x.pnl||0);
  return {
    selected:a.length,pending:a.filter(x=>x.status==="pending").length,
    open:a.filter(x=>x.status==="open").length,closed:closed.length,
    realizedPnlSumPct:pn.reduce((s,x)=>s+x,0),
    realizedAvgPnlPct:pn.length?pn.reduce((s,x)=>s+x,0)/pn.length:null
  };
}

async function sendScalpingAlert(env,payload){
  try{
    const r=await fetch(baseUrl(env)+"/api/scalping-alert",{
      method:"POST",
      headers:{"content-type":"application/json","x-monitor-key":env.MONITOR_KEY},
      body:JSON.stringify(payload)
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error(j.error||("HTTP "+r.status));
    return j;
  }catch(e){
    console.error(JSON.stringify({type:"telegram_alert_error",strategy:"daytrading",error:String(e.message||e),eventId:payload&&payload.eventId}));
    return null;
  }
}
function hmLabel(v){return String(v||"").padStart(4,"0");}
function signedPct(v){const n=Number(v||0);return (n>=0?"+":"")+n.toFixed(2)+"%";}
function exitLabel(v){
  return v==="take_profit"?"익절":v==="stop"?"손절":v==="time_exit"?"시간청산":String(v||"청산");
}
async function notifyPaperTransitions(env,oldLedger,newLedger){
  const oldBy=new Map(((oldLedger&&oldLedger.trades)||[]).map(x=>[x.id,x]));
  for(const x of ((newLedger&&newLedger.trades)||[])){
    const prev=oldBy.get(x.id);
    if(!prev){
      await sendScalpingAlert(env,{
        strategy:"daytrading",stage:"buy",
        eventId:"daytrading:"+newLedger.date+":"+x.id+":buy",
        date:newLedger.date,time:hmLabel(x.signalTime),
        lines:[
          (x.name||x.code)+" ("+x.code+")",
          "신호 "+hmLabel(x.signalTime)+" · 신호가 "+Math.round(x.signalPrice||0).toLocaleString("ko-KR")+"원",
          "매수: 다음 1분봉 시가 "+hmLabel(x.entryTime)+(x.entryPrice?" · "+Math.round(x.entryPrice).toLocaleString("ko-KR")+"원":" · 진입 대기"),
          "근거: 점수 "+Number(x.score||0).toFixed(1)+" · 장중수익 "+signedPct(x.sessionRet)+" · VWAP기울기 "+signedPct(x.vwapSlope)+" · 거래량 "+Number(x.volRatio||0).toFixed(2)+"배",
          "청산계획: 손절 -"+Number(newLedger.stopPct||PAPER_STOP_PCT).toFixed(1)+"% · 익절 +"+Number(newLedger.takeProfitPct||PAPER_TAKE_PROFIT_PCT).toFixed(1)+"% · "+hmLabel(PAPER_FINAL_EXIT_HM)+" 시간청산"
        ]
      });
    }
    if(x.status==="closed"&&(!prev||prev.status!=="closed")){
      await sendScalpingAlert(env,{
        strategy:"daytrading",stage:"sell",
        eventId:"daytrading:"+newLedger.date+":"+x.id+":sell:"+String(x.exitTime||""),
        date:newLedger.date,time:hmLabel(x.exitTime),
        lines:[
          (x.name||x.code)+" ("+x.code+") · "+exitLabel(x.reason),
          "매수 "+hmLabel(x.entryTime)+" · "+Math.round(x.entryPrice||0).toLocaleString("ko-KR")+"원",
          "매도 "+hmLabel(x.exitTime)+" · "+Math.round(x.exitPrice||0).toLocaleString("ko-KR")+"원",
          "모의 순손익 "+signedPct(x.pnl)+" · 왕복 마찰비용 "+PAPER_FRICTION_PCT.toFixed(2)+"% 반영"
        ]
      });
    }
  }
}
async function reconcilePaper(env,date,target,candidates,mainVariant="baseline"){
  const old=await readPaper(env,date);
  const params=dayExitParams(mainVariant);
  const by=new Map(((old&&old.trades)||[]).map(x=>[x.id,x]));
  const trades=[];
  for(const c of candidates){
    const id=String(c.code)+":"+String(c.signalTime);
    trades.push(await advanceTrade(env,date,c,by.get(id)||null,target,params));
  }
  const ledger={
    schema:1,date,updatedAt:new Date().toISOString(),targetHm:target,mainVariant,
    strategy:"VWAP trend breakout v1",mode:"server-live-paper-no-order",
    maxTrades:params.maxTrades,stopPct:params.stopPct,takeProfitPct:params.takeProfitPct,
    finalExit:PAPER_FINAL_EXIT_HM,frictionPct:PAPER_FRICTION_PCT,
    trades
  };
  ledger.summary=ledgerSummary(ledger);
  const saved=await writePaper(env,ledger);
  await notifyPaperTransitions(env,old,saved);
  return saved;
}
async function advanceExistingPaper(env,date,target){
  const old=await readPaper(env,date);
  if(!old||!Array.isArray(old.trades)||!old.trades.length)return old;
  const trades=[];
  for(const x of old.trades){
    const c={
      code:x.code,name:x.name,rank:x.rank,signalTime:x.signalTime,signalPrice:x.signalPrice,
      score:x.score,sessionRet:x.sessionRet,vwapSlope:x.vwapSlope,volRatio:x.volRatio
    };
    trades.push(await advanceTrade(env,date,c,x,target,{stopPct:x.stopPct||old.stopPct,takeProfitPct:x.takeProfitPct||old.takeProfitPct,maxTrades:old.maxTrades||PAPER_MAX_TRADES}));
  }
  const ledger={...old,updatedAt:new Date().toISOString(),targetHm:target,trades};
  ledger.summary=ledgerSummary(ledger);
  const saved=await writePaper(env,ledger);
  await notifyPaperTransitions(env,old,saved);
  return saved;
}

async function sendDailySummary(env,date){
  const ledger=await readPaper(env,date);
  const a=ledger&&Array.isArray(ledger.trades)?ledger.trades:[];
  const closed=a.filter(x=>x.status==="closed"),open=a.filter(x=>x.status==="open");
  const pn=closed.map(x=>Number(x.pnl)).filter(Number.isFinite),wins=pn.filter(x=>x>0).length,losses=pn.filter(x=>x<0).length;
  const avg=pn.length?pn.reduce((s,x)=>s+x,0)/pn.length:0;
  const lines=[
    "후보/진입 "+a.length+"건 · 청산 "+closed.length+"건 · 미청산 "+open.length+"건",
    "승 "+wins+" · 패 "+losses+" · 승률 "+(pn.length?(wins/pn.length*100).toFixed(1):"0.0")+"%",
    "실현 평균 순수익률 "+signedPct(avg)+" · 왕복 마찰비용 "+PAPER_FRICTION_PCT.toFixed(2)+"% 반영"
  ];
  for(const x of closed)lines.push((x.name||x.code)+" · "+hmLabel(x.entryTime)+"→"+hmLabel(x.exitTime)+" · "+signedPct(x.pnl)+" · "+exitLabel(x.reason));
  if(!a.length)lines.push("오늘 조건 충족 모의거래 없음");
  return sendScalpingAlert(env,{strategy:"daytrading",stage:"summary",eventId:"daytrading:"+date+":close-summary",date,time:"15:35 KST",lines});
}

async function runScheduled(controller,env){
  if(!env.MONITOR_KEY)throw new Error("MONITOR_KEY secret missing");
  const scheduled=Number(controller.scheduledTime)||Date.now();
  const sched=kstParts(scheduled);
  if(sched.hm===1535){ await sendDailySummary(env,sched.date); return; }
  const lag=Math.max(0,Date.now()-scheduled);

  // 09:55 KST: immutable Top100 snapshot. If it is delayed beyond 10:15,
  // captureSnapshot refuses to create a contaminated primary snapshot.
  if(sched.hm===955){
    const snapshot=await getOrCreateSnapshot(env,sched.date);
    console.log(JSON.stringify({type:"day_snapshot",date:sched.date,lagMs:lag,snapshotHm:snapshot?.snapshotHm||null,count:snapshot?.universe?.length||0}));
    return;
  }

  const target=targetHm(scheduled);
  if(target<959||target>PAPER_FINAL_EXIT_HM)return;

  // 신규 신호는 14:30까지만 찾는다. 그 뒤 15:10까지는 열린 모의포지션 청산만 추적한다.
  if(target>1430){
    const ledger=await advanceExistingPaper(env,sched.date,target);
    console.log(JSON.stringify({type:"day_paper_exit_track",date:sched.date,targetHm:target,summary:ledgerSummary(ledger)}));
    return;
  }

  if(lag>MAX_SCAN_LAG_MS){
    console.warn(JSON.stringify({type:"day_scan_skip",reason:"cron_too_late",lagMs:lag,scheduledTime:scheduled}));
    return;
  }

  const snapshot=await getOrCreateSnapshot(env,sched.date);
  if(!snapshot){
    console.error(JSON.stringify({type:"day_scan_skip",reason:"snapshot_missing_or_late",date:sched.date,targetHm:target}));
    return;
  }

  const settled=await Promise.allSettled(Array.from({length:SHARDS},(_,shard)=>scanShard(env,snapshot,target,shard)));
  const ok=settled.filter(x=>x.status==="fulfilled").map(x=>x.value);
  const failed=settled.filter(x=>x.status==="rejected").map(x=>String(x.reason?.message||x.reason));
  let ledger=null;
  // 하루 최대 3건 선정은 Top100 전체 결과가 모두 있을 때만 한다. 일부 shard 누락으로 잘못된 3건을 고정하지 않는다.
  if(ok.length===SHARDS){
    const mainVariant=String(snapshot.mainVariant||"baseline"),params=dayExitParams(mainVariant);
    const candidates=pickCandidates(ok,params.maxTrades);
    ledger=await reconcilePaper(env,sched.date,target,candidates,mainVariant);
  }
  console.log(JSON.stringify({
    type:"day_scan",date:sched.date,targetHm:target,lagMs:lag,snapshotHm:snapshot.snapshotHm,
    okShards:ok.length,signalEvents:ok.reduce((s,x)=>s+(x.signalEvents?.length||0),0),
    quoteErrors:ok.reduce((s,x)=>s+(+x.errors||0),0),failed,
    paper:ledger?ledger.summary:null
  }));
}

export default {
  async scheduled(controller,env,ctx){ctx.waitUntil(runScheduled(controller,env));},
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/health")return json({
      ok:true,service:"jkquant-daytrading-scheduler",
      schedule:"09:55 snapshot + 10:00~14:31 signal scans + 14:32~15:11 paper exits",
      paper:{maxTrades:PAPER_MAX_TRADES,stopPct:PAPER_STOP_PCT,takeProfitPct:PAPER_TAKE_PROFIT_PCT,finalExit:PAPER_FINAL_EXIT_HM,frictionPct:PAPER_FRICTION_PCT}
    });
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
    if(u.pathname==="/snapshot"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=String(u.searchParams.get("date")||kstParts().date);
      const snapshot=await readSnapshot(env,date);
      return json({ok:true,date,snapshot});
    }
    if(u.pathname==="/paper"){
      if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
      const date=String(u.searchParams.get("date")||kstParts().date);
      const ledger=await readPaper(env,date);
      return json({ok:true,date,ledger});
    }
    return json({ok:false,error:"not found"},404);
  }
};
