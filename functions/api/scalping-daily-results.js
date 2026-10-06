// Cloudflare Pages Function — GET /api/scalping-daily-results
// One-screen previous/latest completed-session results for the four active scalping strategies.
// Read-only: live paper ledgers are preferred for BTC/SOXL; immutable research/history is fallback.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FAST_H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=20, s-maxage=60, stale-while-revalidate=300"};
async function edgeGet(request){
  try{
    const c=globalThis.caches&&globalThis.caches.default;
    return c?await c.match(new Request(request.url,{method:"GET"})):null;
  }catch(e){return null;}
}
async function edgePut(request,response){
  try{
    const c=globalThis.caches&&globalThis.caches.default;
    if(c)await c.put(new Request(request.url,{method:"GET"}),response.clone());
  }catch(e){}
}
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
const GLOBAL_WORKER_FALLBACK="https://jkquant-global-intraday-scheduler.mumae4.workers.dev";
const DAYTRADING_WORKER_FALLBACK="https://jkquant-daytrading-scheduler.mumae4.workers.dev";

async function readText(path){
  const r=await fetch(RAW+path,{headers:{"Accept":"text/plain,application/json,text/csv","User-Agent":"jkquant-scalping-daily-results/1.1"}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("GitHub raw "+path+" HTTP "+r.status);
  return r.text();
}
async function readJson(path){
  const t=await readText(path);
  if(t==null)return null;
  return JSON.parse(t);
}
function parseCsv(text){
  const rows=[];let row=[],cell="",q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i],nx=text[i+1];
    if(q){
      if(ch==='"'&&nx==='"'){cell+='"';i++;}
      else if(ch==='"')q=false;
      else cell+=ch;
    }else{
      if(ch==='"')q=true;
      else if(ch===','){row.push(cell);cell="";}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}
      else cell+=ch;
    }
  }
  if(cell.length||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}
  if(!rows.length)return [];
  const head=rows.shift().map(x=>x.trim());
  return rows.filter(r=>r.some(x=>x!=="")).map(r=>{
    const o={};head.forEach((h,i)=>o[h]=r[i]??"");return o;
  });
}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function tzParts(timeZone,ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,weekday:"short"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  const hh=Number(g("hour"))||0,mm=Number(g("minute"))||0;
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:hh*100+mm,weekday:g("weekday")};
}
function isoKstDate(ms=Date.now()){return tzParts("Asia/Seoul",ms).date;}
function shiftIso(date,days){
  const [y,m,d]=String(date).split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
}
function weekdayUtc(date){return new Date(date+"T12:00:00Z").getUTCDay();}

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
  const a=y%19,b=Math.floor(y/100),cc=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(cc/4),k=cc%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return new Date(Date.UTC(y,month-1,day));
}
function nyseHolidaySet(y){
  const s=new Set([observedFixed(y,1,1),nthWeekday(y,1,1,3),nthWeekday(y,2,1,3),lastWeekday(y,5,1),
    observedFixed(y,6,19),observedFixed(y,7,4),nthWeekday(y,9,1,1),nthWeekday(y,11,4,4),observedFixed(y,12,25)]);
  const easter=easterSunday(y);easter.setUTCDate(easter.getUTCDate()-2);s.add(easter.toISOString().slice(0,10));
  const nextNewYear=observedFixed(y+1,1,1);if(nextNewYear.startsWith(y+"-"))s.add(nextNewYear);
  return s;
}
function isNyseSessionDate(date){
  const d=new Date(date+"T12:00:00Z"),wd=d.getUTCDay(),y=d.getUTCFullYear();
  return wd!==0&&wd!==6&&!nyseHolidaySet(y).has(date);
}
async function krMarketDayStatus(request,date){
  const u=new URL("/api/kis",request.url);
  u.searchParams.set("op","holiday");u.searchParams.set("market","kr");u.searchParams.set("date",String(date).replace(/\D/g,""));
  try{
    const r=await fetch(u.toString(),{headers:{"accept":"application/json"}});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.ok!==true||typeof j.open!=="boolean")return {date,open:null,error:j.error||("HTTP "+r.status),source:"KIS/CTCA0903R"};
    return {date,open:j.open,source:j.source||"KIS/CTCA0903R"};
  }catch(e){return {date,open:null,error:String(e.message||e),source:"KIS/CTCA0903R"};}
}
function tradeSummary(date,trades){
  const a=(Array.isArray(trades)?trades:[]).filter(x=>Number.isFinite(Number(x.pnl)));
  const pn=a.map(x=>Number(x.pnl));
  const sum=pn.reduce((s,x)=>s+x,0);
  return {
    date,
    returnPct:pn.length?sum/pn.length:0,
    sumPnlPct:sum,
    trades:a.length,
    wins:pn.filter(x=>x>0).length,
    losses:pn.filter(x=>x<0).length,
    noTrade:a.length===0,
    finalized:true
  };
}
function liveLedgerSummary(ledger,date,source){
  const all=Array.isArray(ledger&&ledger.trades)?ledger.trades:[];
  const closed=all.filter(x=>x&&x.status==="closed"&&Number.isFinite(Number(x.pnlPct)));
  const pn=closed.map(x=>Number(x.pnlPct));
  const sum=pn.reduce((s,x)=>s+x,0);
  return {
    date:String((ledger&&ledger.date)||date),
    returnPct:pn.length?sum/pn.length:0,
    sumPnlPct:sum,
    trades:all.length,
    wins:pn.filter(x=>x>0).length,
    losses:pn.filter(x=>x<0).length,
    noTrade:all.length===0,
    finalized:all.every(x=>x&&x.status==="closed"),
    incomplete:all.some(x=>x&&x.status!=="closed"),
    source,
    generatedAt:ledger&&ledger.updatedAt||null,
    strategyVersion:ledger&&ledger.strategyVersion||""
  };
}
function mergeSessions(primary,fallback){
  const m=new Map();
  for(const x of Array.isArray(primary)?primary:[])if(x&&x.date)m.set(String(x.date),x);
  for(const x of Array.isArray(fallback)?fallback:[])if(x&&x.date&&!m.has(String(x.date)))m.set(String(x.date),x);
  return [...m.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
}
async function openingSessions(){
  const today=isoKstDate(),out=[];
  /* 예전에는 최근 JSON을 찾을 때 15일을 하나씩 await 해서 휴일/주말일수록 느렸다.
     서로 독립인 날짜 파일은 한 번에 읽고 최신 2개만 고른다. */
  const dates=Array.from({length:15},(_,back)=>shiftIso(today,-back));
  const got=await Promise.all(dates.map(async date=>{
    try{return [date,await readJson("opening-history/"+date+".json")];}
    catch(e){return [date,null];}
  }));
  for(const [date,j] of got){
    if(!j)continue;
    const operational=Array.isArray(j.operationalTrades)?j.operationalTrades:(j.trades||[]);
    const z=tradeSummary(String(j.date||date),operational);
    z.source=Array.isArray(j.operationalTrades)?"opening-operational-history":"opening-history";
    z.mainVariant=String(j.mainVariant||"baseline");
    z.generatedAt=j.generatedAt||null;
    out.push(z); if(out.length>=2)break;
  }
  return out;
}
async function daytradingResearchSessions(){
  const j=await readJson("daytrading-research/latest.json");
  if(!j)return [];
  const base=(j.variants||[]).find(x=>x&&x.params&&x.params.name==="baseline");
  const daily=((base&&base.summary&&base.summary.daily)||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
  return daily.map(x=>({
    date:String(x.date||""),returnPct:num(x.returnPct)??0,sumPnlPct:null,
    trades:Number(x.trades||0),wins:null,losses:null,noTrade:Number(x.trades||0)===0,
    finalized:true,source:"daytrading-research",generatedAt:j.generatedAt||null,mainVariant:"baseline"
  }));
}
function completedKrCandidates(now=Date.now()){
  const k=tzParts("Asia/Seoul",now),out=[];
  let d=(!["Sat","Sun"].includes(k.weekday)&&k.hm>=1535)?k.date:shiftIso(k.date,-1);
  for(let i=0;i<10&&out.length<4;i++){
    const wd=weekdayUtc(d);if(wd!==0&&wd!==6)out.push(d);
    d=shiftIso(d,-1);
  }
  return out;
}
async function readDaytradingPaper(env,date){
  const key=globalKey(env);if(!key)throw new Error("daytrading monitor key missing");
  const worker=String(env.DAYTRADING_WORKER_URL||DAYTRADING_WORKER_FALLBACK).replace(/\/$/,"");
  const r=await fetch(worker+"/paper?date="+encodeURIComponent(date),{headers:{"Accept":"application/json","x-monitor-key":key}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("daytrading worker HTTP "+r.status));
  return j.ledger||null;
}
async function readDaytradingPaperHistory(env,limit=8){
  const key=globalKey(env);if(!key)throw new Error("daytrading monitor key missing");
  const worker=String(env.DAYTRADING_WORKER_URL||DAYTRADING_WORKER_FALLBACK).replace(/\/$/,"");
  const r=await fetch(worker+"/paper-history?limit="+Math.max(1,Math.min(120,Number(limit)||8)),{headers:{"Accept":"application/json","x-monitor-key":key}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("daytrading history HTTP "+r.status));
  return Array.isArray(j.ledgers)?j.ledgers:[];
}
function daytradingLedgerSummary(ledger,date){
  const all=Array.isArray(ledger&&ledger.trades)?ledger.trades:[];
  const closed=all.filter(x=>x&&x.status==="closed"&&Number.isFinite(Number(x.pnl)));
  const pn=closed.map(x=>Number(x.pnl)),sum=pn.reduce((s,x)=>s+x,0);
  return {
    date:String((ledger&&ledger.date)||date),returnPct:pn.length?sum/Math.max(1,Number(ledger&&ledger.maxTrades||3)):0,
    sumPnlPct:sum,trades:all.length,wins:pn.filter(x=>x>0).length,losses:pn.filter(x=>x<0).length,
    noTrade:all.length===0,finalized:all.every(x=>x&&x.status==="closed"),
    incomplete:all.some(x=>x&&x.status!=="closed"),source:"daytrading-paper-live",
    generatedAt:ledger&&ledger.updatedAt||null,mainVariant:String(ledger&&ledger.mainVariant||"baseline")
  };
}
async function daytradingLiveSessions(env){
  const out=[],candidates=completedKrCandidates(),completed=new Set(candidates);
  try{
    const indexed=await readDaytradingPaperHistory(env,12);
    for(const ledger of indexed){
      const date=String(ledger&&ledger.date||"");
      if(date&&completed.has(date))out.push(daytradingLedgerSummary(ledger,date));
      if(out.length>=2)break;
    }
  }catch(e){}
  if(out.length>=2)return out;
  const seen=new Set(out.map(x=>x.date));
  const missing=candidates.filter(date=>!seen.has(date));
  const extra=await Promise.all(missing.map(async date=>{
    try{
      const ledger=await readDaytradingPaper(env,date);
      return ledger?daytradingLedgerSummary(ledger,date):null;
    }catch(e){return null;}
  }));
  for(const x of extra){if(x&&!seen.has(x.date)){out.push(x);seen.add(x.date);}}
  return out.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
}
function mergeDaytradingSessions(live,fallback){
  const primary=Array.isArray(live)?live:[];
  const secondary=Array.isArray(fallback)?fallback:[];
  const fbByDate=new Map(secondary.filter(x=>x&&x.date).map(x=>[String(x.date),x]));
  const resolved=primary.map(x=>{
    if(!x||!x.date)return x;
    const fb=fbByDate.get(String(x.date));
    if(!fb)return x;
    const liveTrades=Number(x.trades||0),fallbackTrades=Number(fb.trades||0);
    const liveVariant=String(x.mainVariant||"baseline");
    const fallbackVariant=String(fb.mainVariant||"baseline");
    // A zero-trade live ledger must not erase confirmed reconstructed trades
    // when both sources represent the same operational main strategy.
    // If a different variant was promoted, keep the live ledger as authoritative.
    if(liveTrades===0&&fallbackTrades>0&&liveVariant===fallbackVariant){
      return {...fb,source:"daytrading-research-confirmed",liveLedgerSource:x.source||null,liveLedgerNoTrade:true};
    }
    return x;
  });
  return mergeSessions(resolved,secondary);
}
async function daytradingSessions(env){
  const [lr,fr]=await Promise.allSettled([daytradingLiveSessions(env),daytradingResearchSessions()]);
  const live=lr.status==="fulfilled"?lr.value:[],fallback=fr.status==="fulfilled"?fr.value:[];
  return mergeDaytradingSessions(live,fallback);
}
async function decisionSessions(path,source){
  const t=await readText(path);
  if(t==null)return [];
  const rows=parseCsv(t).filter(x=>x.date).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
  return rows.map(x=>{
    const trade=String(x.action||"").toLowerCase()==="trade";
    const pnl=num(x.pnlPct);
    return {
      date:String(x.date),
      returnPct:trade?(pnl??0):0,
      sumPnlPct:trade?(pnl??0):0,
      trades:trade?1:0,
      wins:trade&&pnl!=null&&pnl>0?1:0,
      losses:trade&&pnl!=null&&pnl<0?1:0,
      noTrade:!trade,
      finalized:true,
      source,
      strategyVersion:x.strategyVersion||"",
      decisionReason:x.decisionReason||"",
      exitReason:x.exitReason||""
    };
  });
}
function globalKey(env){
  return String(env&& (env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY)||"").trim();
}
async function readGlobalPaper(env,strategy,date){
  const key=globalKey(env);
  if(!key)throw new Error("global intraday monitor key missing");
  const worker=String(env.GLOBAL_INTRADAY_WORKER_URL||GLOBAL_WORKER_FALLBACK).replace(/\/$/,"");
  const q=new URLSearchParams({strategy,date});
  const r=await fetch(worker+"/paper?"+q.toString(),{headers:{"Accept":"application/json","x-monitor-key":key}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("global worker HTTP "+r.status));
  return j.ledger||null;
}
async function readGlobalPaperHistory(env,strategy,limit=8){
  const key=globalKey(env);
  if(!key)throw new Error("global intraday monitor key missing");
  const worker=String(env.GLOBAL_INTRADAY_WORKER_URL||GLOBAL_WORKER_FALLBACK).replace(/\/$/,"");
  const q=new URLSearchParams({strategy,limit:String(Math.max(1,Math.min(120,Number(limit)||8)))});
  const r=await fetch(worker+"/paper-history?"+q.toString(),{headers:{"Accept":"application/json","x-monitor-key":key}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.error||("global history HTTP "+r.status));
  return Array.isArray(j.ledgers)?j.ledgers:[];
}
function completedGlobalCandidates(strategy,now=Date.now()){
  if(strategy==="crypto"){
    const k=tzParts("Asia/Seoul",now),out=[];
    let d=shiftIso(k.date,-1); // 한국 00:00~24:00 하루가 완전히 끝난 날부터
    for(let i=0;i<4;i++){out.push(d);d=shiftIso(d,-1);}
    return out;
  }
  const n=tzParts("America/New_York",now),out=[];
  let d=(!["Sat","Sun"].includes(n.weekday)&&n.hm>=1605)?n.date:shiftIso(n.date,-1);
  for(let i=0;i<10&&out.length<4;i++){
    const wd=weekdayUtc(d);
    if(wd!==0&&wd!==6)out.push(d);
    d=shiftIso(d,-1);
  }
  return out;
}
async function globalPaperSessions(env,strategy){
  const out=[],candidates=completedGlobalCandidates(strategy),completed=new Set(candidates);
  try{
    const indexed=await readGlobalPaperHistory(env,strategy,12);
    for(const ledger of indexed){
      const date=String(ledger&&ledger.date||"");
      if(date&&completed.has(date))out.push(liveLedgerSummary(ledger,date,"global-paper-db"));
      if(out.length>=2)break;
    }
  }catch(e){}
  if(out.length>=2)return out;
  const seen=new Set(out.map(x=>x.date)),missing=candidates.filter(date=>!seen.has(date));
  const extra=await Promise.all(missing.map(async date=>{
    try{
      const ledger=await readGlobalPaper(env,strategy,date);
      return ledger?liveLedgerSummary(ledger,date,"global-paper-live"):null;
    }catch(e){return null;}
  }));
  for(const x of extra){if(x&&!seen.has(x.date)){out.push(x);seen.add(x.date);}}
  return out.sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
}
async function liveFirstSessions(env,strategy,path,source){
  const [lr,fr]=await Promise.allSettled([globalPaperSessions(env,strategy),decisionSessions(path,source)]);
  const live=lr.status==="fulfilled"?lr.value:[],fallback=fr.status==="fulfilled"?fr.value:[];
  const liveError=lr.status==="rejected"?String(lr.reason&&lr.reason.message||lr.reason):null;
  const fallbackError=fr.status==="rejected"?String(fr.reason&&fr.reason.message||fr.reason):null;
  const sessions=mergeSessions(live,fallback);
  if(!sessions.length&&liveError&&fallbackError)throw new Error(liveError+" / "+fallbackError);
  return sessions;
}
async function safeSessions(fn){
  try{return {sessions:await fn(),error:null};}
  catch(e){return {sessions:[],error:String(e.message||e)};}
}
function kstSessionDate(strategy,date){
  const d=String(date||"");
  // SOXL ledger dates are U.S. market dates. The regular session closes on the
  // next Korean calendar day, so every displayed SOXL result is shifted +1 day.
  return strategy==="soxl"&&d?shiftIso(d,1):d;
}
function normalizeKstSessions(strategy,result){
  const a=Array.isArray(result&&result.sessions)?result.sessions:[];
  return a.map(x=>{
    const marketDate=String(x&&x.date||"");
    const date=kstSessionDate(strategy,marketDate);
    return {...x,date,marketDate:strategy==="soxl"?marketDate:null,timeZone:"Asia/Seoul"};
  }).sort((a,b)=>String(b.date).localeCompare(String(a.date)));
}
function closedRow(date,source,marketDate=null){
  return {date,marketDate,marketClosed:true,returnPct:0,sumPnlPct:0,trades:0,wins:0,losses:0,noTrade:true,finalized:true,source};
}
function pendingRow(date,reason,marketDate=null){
  return {date,marketDate,pending:true,pendingReason:reason,finalized:false,source:"kst-calendar"};
}
function unknownRow(date,error){
  return {date,marketDayUnknown:true,marketDayError:error||"개장일 확인 실패",finalized:false,source:"market-calendar"};
}
function placeholderFor(strategy,date,krStatus=null){
  if(strategy==="opening"||strategy==="daytrading"){
    if(krStatus&&krStatus.date===date){
      if(krStatus.open===false)return closedRow(date,"KIS/CTCA0903R");
      if(krStatus.open==null)return unknownRow(date,krStatus.error);
    }else{
      const wd=weekdayUtc(date);
      if(wd===0||wd===6)return closedRow(date,"weekend-calendar");
    }
    return pendingRow(date,"KST 장 마감 후 기준전략 결과 확정");
  }
  if(strategy==="crypto")return pendingRow(date,"KST 00:00~24:00 세션 종료 후 결과 확정");
  if(strategy==="soxl"){
    const marketDate=shiftIso(date,-1);
    if(!isNyseSessionDate(marketDate))return closedRow(date,"NYSE-calendar",marketDate);
    return pendingRow(date,"미국 정규장 종료 후 KST 날짜로 결과 확정",marketDate);
  }
  return pendingRow(date,"세션 결과 확정 대기");
}
function pairKst(name,label,result,kstDate,krStatuses=null){
  const a=normalizeKstSessions(name,result),prevDate=shiftIso(kstDate,-1);
  const statusMap=new Map((Array.isArray(krStatuses)?krStatuses:[]).filter(Boolean).map(x=>[String(x.date),x]));
  const current=a.find(x=>String(x.date)===kstDate)||placeholderFor(name,kstDate,statusMap.get(kstDate)||null);
  const previous=a.find(x=>String(x.date)===prevDate)||placeholderFor(name,prevDate,statusMap.get(prevDate)||null);
  return {
    strategy:name,label,marketTime:"KST",timeZone:"Asia/Seoul",dateRule:"kst-calendar",
    current,previous,
    status:(current||previous)?"ok":(result&&result.error?"error":"collecting"),
    error:result&&result.error||null
  };
}

export async function onRequestGet({request,env}){
  const u=new URL(request.url),force=u.searchParams.get("refresh")==="1";
  if(!force){
    const hit=await edgeGet(request);
    if(hit)return hit;
  }
  const kst=tzParts("Asia/Seoul"),prevKst=shiftIso(kst.date,-1);
  const [opening,daytrading,crypto,soxl,krToday,krPrevious]=await Promise.all([
    safeSessions(()=>openingSessions()),
    safeSessions(()=>daytradingSessions(env)),
    safeSessions(()=>liveFirstSessions(env,"crypto","crypto-research/baseline-decisions.csv","crypto-research")),
    safeSessions(()=>liveFirstSessions(env,"soxl","soxl-research/baseline-decisions.csv","soxl-research")),
    krMarketDayStatus(request,kst.date),
    krMarketDayStatus(request,prevKst)
  ]);
  const krStatuses=[krToday,krPrevious];
  const response=new Response(JSON.stringify({
    ok:true,
    generatedAt:new Date().toISOString(),
    kstDate:kst.date,
    dateRule:"All displayed previous/current result dates use the Asia/Seoul calendar. SOXL U.S. market dates are shifted to the Korean calendar date containing the regular-session close.",
    returnRule:"Opening uses the equal-weight average of executed baseline trades; Daytrading uses the sum of trade net PnL divided by 3 fixed capital slots; BTC/SOXL use one slot. No-trade session = 0%.",
    sourceRule:"BTC/SOXL use the completed live paper ledger first; immutable research CSV is fallback. One strategy source failure does not hide the other strategies.",
    strategies:[
      pairKst("opening","시초가",opening,kst.date,krStatuses),
      pairKst("daytrading","데이트레이딩",daytrading,kst.date,krStatuses),
      pairKst("crypto","비트코인",crypto,kst.date),
      pairKst("soxl","SOXL",soxl,kst.date)
    ]
  }),{headers:force?JH:FAST_H});
  if(!force)await edgePut(request,response);
  return response;
}

export {liveLedgerSummary,mergeSessions,mergeDaytradingSessions,completedGlobalCandidates,kstSessionDate,pairKst};
