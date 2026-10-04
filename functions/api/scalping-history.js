// Cloudflare Pages Function — GET /api/scalping-history?strategy=opening|daytrading|crypto|soxl
// Unified cumulative trade history backed by immutable research CSVs on scalping-data.
// Read-only. No order path and no strategy mutation.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const TREND_H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60, s-maxage=300, stale-while-revalidate=1800"};
async function trendCacheGet(request){
  try{
    const c=globalThis.caches&&globalThis.caches.default;
    return c?await c.match(new Request(request.url,{method:"GET"})):null;
  }catch(e){return null;}
}
async function trendCachePut(request,response){
  try{
    const c=globalThis.caches&&globalThis.caches.default;
    if(c)await c.put(new Request(request.url,{method:"GET"}),response.clone());
  }catch(e){}
}
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
const GLOBAL_WORKER_FALLBACK="https://jkquant-global-intraday-scheduler.mumae4.workers.dev";
const DAYTRADING_WORKER_FALLBACK="https://jkquant-daytrading-scheduler.mumae4.workers.dev";

const SOURCES={
  opening:{path:"opening-history/baseline-trades.csv",market:"KR",pnl:"pnl"},
  daytrading:{path:"daytrading-research/baseline-trades.csv",market:"KR",pnl:"pnl"},
  crypto:{path:"crypto-research/baseline-trades.csv",market:"KRW-BTC",pnl:"pnlPct"},
  soxl:{path:"soxl-research/baseline-trades.csv",market:"US",pnl:"pnlPct"}
};

function parseCsv(text){
  const rows=[]; let row=[],cell="",q=false;
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
    const o={}; head.forEach((h,i)=>o[h]=r[i]??""); return o;
  });
}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function str(v){return v==null?"":String(v);}
function hm(v){
  const s=str(v); if(!s)return "";
  if(s.includes(":"))return s;
  const z=s.padStart(4,"0"); return z.slice(0,2)+":"+z.slice(2);
}
function normalize(strategy,x){
  if(strategy==="opening"){
    return {
      date:x.date,code:x.code,name:x.name||x.code,strategyVersion:x.strategyVersion||"",
      signalTime:hm(x.entryTime),entryTime:hm(x.entryTime),entryPrice:n(x.entryPrice),
      exitTime:hm(x.exitTime),exitPrice:n(x.exitPrice),reason:x.reason||"",pnl:n(x.pnl),
      rank:n(x.rank),detail:{gap:n(x.gap),pullbackPct:n(x.pullbackPct),volRatio:n(x.volRatio),amountRatio:n(x.amountRatio)}
    };
  }
  if(strategy==="daytrading"){
    return {
      date:x.date,code:x.code,name:x.name||x.code,strategyVersion:x.strategyVersion||"",
      signalTime:hm(x.signalTime),entryTime:hm(x.entryTime),entryPrice:n(x.entryPrice),
      exitTime:hm(x.exitTime),exitPrice:n(x.exitPrice),reason:x.reason||"",pnl:n(x.pnl),
      rank:n(x.rank),detail:{sessionRet:n(x.sessionRet),vwapSlope:n(x.vwapSlope),volRatio:n(x.volRatio)}
    };
  }
  if(strategy==="crypto"){
    return {
      date:x.date,code:"KRW-BTC",name:"비트코인",strategyVersion:x.strategyVersion||"",
      signalTime:x.signalTimeKst||"",entryTime:x.entryTimeKst||"",entryPrice:n(x.entryPrice),
      exitTime:x.exitTimeKst||"",exitPrice:n(x.exitPrice),reason:x.reason||"",pnl:n(x.pnlPct),
      rank:null,detail:{openingHigh:n(x.openingHigh),signalVwap:n(x.signalVwap),volRatio:n(x.volumeRatio)}
    };
  }
  return {
    date:x.date,code:"SOXL",name:"SOXL",strategyVersion:x.strategyVersion||"",
    signalTime:x.signalTimeEt||"",entryTime:x.entryTimeEt||"",entryPrice:n(x.entryPrice),
    exitTime:x.exitTimeEt||"",exitPrice:n(x.exitPrice),reason:x.reason||"",pnl:n(x.pnlPct),
    rank:null,detail:{openingHigh:n(x.openingHigh),signalVwap:n(x.signalVwap),volRatio:n(x.volumeRatio),mfePct:n(x.mfePct),maePct:n(x.maePct)}
  };
}
function dateDaysAgo(days){
  const d=new Date(Date.now()-days*86400000);
  return d.toISOString().slice(0,10);
}
function tzNow(timeZone){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false,weekday:"short"}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value||"";
  const hh=Number(g("hour"))||0,mm=Number(g("minute"))||0;
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:hh*100+mm,weekday:g("weekday")};
}
function isCompletedSession(strategy,date){
  if(strategy==="crypto")return String(date)<tzNow("Asia/Seoul").date;
  if(strategy==="daytrading"){
    const k=tzNow("Asia/Seoul");
    return String(date)<k.date||(String(date)===k.date&&!["Sat","Sun"].includes(k.weekday)&&k.hm>=1535);
  }
  if(strategy==="soxl"){
    const n=tzNow("America/New_York");
    return String(date)<n.date||(String(date)===n.date&&!["Sat","Sun"].includes(n.weekday)&&n.hm>=1605);
  }
  return false;
}
function monitorKey(env){return String(env&&(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY)||"").trim();}
async function durableLedgers(env,strategy,limit=3650){
  if(!["daytrading","crypto","soxl"].includes(strategy))return [];
  const key=monitorKey(env);if(!key)return [];
  const base=String(strategy==="daytrading"?(env.DAYTRADING_WORKER_URL||DAYTRADING_WORKER_FALLBACK):(env.GLOBAL_INTRADAY_WORKER_URL||GLOBAL_WORKER_FALLBACK)).replace(/\/$/,"");
  const q=new URLSearchParams({limit:String(Math.max(1,Math.min(3650,Number(limit)||3650)))});
  if(strategy!=="daytrading")q.set("strategy",strategy);
  const r=await fetch(base+"/paper-history?"+q.toString(),{headers:{"Accept":"application/json","x-monitor-key":key}});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)return [];
  return (Array.isArray(j.ledgers)?j.ledgers:[]).filter(x=>x&&x.date&&isCompletedSession(strategy,String(x.date)));
}
function durableTradeRows(strategy,ledgers){
  const rows=[],days=[];
  for(const ledger of ledgers||[]){
    const date=String(ledger.date||"");if(!date)continue;
    const trades=Array.isArray(ledger.trades)?ledger.trades:[];
    if(trades.some(x=>x&&x.status!=="closed"))continue;
    days.push(date);
    for(const x of trades){
      const pnl=strategy==="daytrading"?n(x.pnl):n(x.pnlPct);
      if(!Number.isFinite(pnl))continue;
      rows.push({
        date,code:strategy==="daytrading"?String(x.code||""):(strategy==="crypto"?"KRW-BTC":"SOXL"),
        name:strategy==="daytrading"?String(x.name||x.code||""):(strategy==="crypto"?"비트코인":"SOXL"),
        strategyVersion:String(x.strategyVersion||ledger.strategyVersion||""),
        signalTime:hm(x.signalTime),entryTime:hm(x.entryTime),entryPrice:n(x.entryPrice),
        exitTime:hm(x.exitTime),exitPrice:n(x.exitPrice),reason:String(x.reason||""),pnl,
        rank:n(x.rank),detail:{source:"durable-paper-db",mainVariant:String(x.mainVariant||ledger.mainVariant||"baseline")}
      });
    }
  }
  return {rows,days:Array.from(new Set(days))};
}

export function sessionReturnPct(strategy,pnls){
  const a=Array.isArray(pnls)?pnls.filter(Number.isFinite):[];
  if(!a.length)return 0;
  const sum=a.reduce((s,v)=>s+v,0);
  // Daytrading allocates three equal capital slots per session; unused slots remain cash.
  if(strategy==="daytrading")return sum/3;
  // Opening uses equal weight across executed baseline trades; BTC/SOXL are one-slot strategies.
  return sum/a.length;
}
export function dailyRisk(rows,strategy,explicitDays=[]){
  const by=new Map((Array.isArray(explicitDays)?explicitDays:[]).map(d=>[String(d),[]]));
  for(const x of rows){
    if(!x.date||!Number.isFinite(x.pnl))continue;
    if(!by.has(x.date))by.set(x.date,[]);
    by.get(x.date).push(x.pnl);
  }
  const daily=[...by.entries()].map(([date,a])=>({
    date,
    returnPct:sessionReturnPct(strategy,a),
    trades:a.length
  })).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  let eq=1,peak=1,maxDd=0;
  for(const d of daily){
    eq*=1+d.returnPct/100;
    if(eq>peak)peak=eq;
    const dd=(eq/peak-1)*100;
    if(dd<maxDd)maxDd=dd;
  }
  const currentDd=(eq/peak-1)*100;
  let lossStreak=0;
  for(let i=daily.length-1;i>=0;i--){
    if(daily[i].returnPct<0)lossStreak++;
    else break;
  }
  const latest=daily.length?daily[daily.length-1].date:null;
  let weekStart=null,weekly=[];
  if(latest){
    const d=new Date(latest+"T00:00:00Z");
    const dow=d.getUTCDay()||7;
    d.setUTCDate(d.getUTCDate()-(dow-1));
    weekStart=d.toISOString().slice(0,10);
    weekly=daily.filter(x=>x.date>=weekStart);
  }
  let weekEq=1; for(const d of weekly)weekEq*=1+d.returnPct/100;
  const weeklyReturnPct=(weekEq-1)*100;
  return {
    daily,
    recentDaily:daily.slice(-5).reverse(),
    currentDrawdownPct:daily.length?currentDd:0,
    maxDrawdownPct:daily.length?maxDd:0,
    lossStreakTradeDays:lossStreak,
    weekStart,
    weeklyReturnPct,
    weeklyTargetPct:5,
    weeklyTargetGapPct:Math.max(0,5-weeklyReturnPct)
  };
}

export async function onRequestGet({request,env}){
  try{
    const u=new URL(request.url);
    const trendOnly=u.searchParams.get("trend")==="1";
    if(trendOnly){
      const hit=await trendCacheGet(request);
      if(hit)return hit;
    }
    const strategy=(u.searchParams.get("strategy")||"").toLowerCase();
    const src=SOURCES[strategy];
    if(!src)return new Response(JSON.stringify({ok:false,error:"strategy must be opening|daytrading|crypto|soxl"}),{status:400,headers:JH});

    const r=await fetch(RAW+src.path,{
      headers:{"Accept":"text/csv","User-Agent":"jkquant-scalping-history/1.1"},
      ...(trendOnly?{cf:{cacheEverything:true,cacheTtl:300}}:{})
    });
    if(r.status===404){
      return new Response(JSON.stringify({ok:true,strategy,source:src.path,total:0,filtered:0,page:1,pageSize:100,pages:0,trades:[],status:"collecting"}),{headers:JH});
    }
    if(!r.ok)throw new Error("GitHub raw "+src.path+" HTTP "+r.status);

    let rows=parseCsv(await r.text()).map(x=>normalize(strategy,x)).filter(x=>x.date);
    let durableDays=[];
    if(strategy!=="opening"){
      try{
        const db=durableTradeRows(strategy,await durableLedgers(env,strategy,trendOnly?120:3650));
        durableDays=db.days;
        if(durableDays.length){
          const override=new Set(durableDays);
          rows=rows.filter(x=>!override.has(String(x.date))).concat(db.rows);
        }
      }catch(e){}
    }
    rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.entryTime).localeCompare(String(a.entryTime))||String(a.code).localeCompare(String(b.code)));
    const total=rows.length;

    const range=(u.searchParams.get("range")||"180").toLowerCase();
    let from=u.searchParams.get("from")||"",to=u.searchParams.get("to")||"";
    const rangeDays=parseInt(range,10);
    if(!from&&Number.isFinite(rangeDays)&&rangeDays>0)from=dateDaysAgo(rangeDays);
    if(from)rows=rows.filter(x=>x.date>=from);
    if(to)rows=rows.filter(x=>x.date<=to);

    const filtered=rows.length;
    const risk=dailyRisk(rows,strategy,durableDays.filter(d=>(!from||d>=from)&&(!to||d<=to)));
    if(trendOnly){
      const response=new Response(JSON.stringify({
        ok:true,strategy,market:src.market,source:src.path,durableDbDays:durableDays.length,
        summary:{dailySeries:risk.daily}
      }),{headers:TREND_H});
      await trendCachePut(request,response);
      return response;
    }

    const page=Math.max(1,parseInt(u.searchParams.get("page")||"1",10)||1);
    const pageSize=Math.min(200,Math.max(20,parseInt(u.searchParams.get("pageSize")||"100",10)||100));
    const pages=filtered?Math.ceil(filtered/pageSize):0;
    const start=(page-1)*pageSize;
    const trades=rows.slice(start,start+pageSize);
    const pn=rows.map(x=>x.pnl).filter(Number.isFinite);
    const wins=pn.filter(x=>x>0),losses=pn.filter(x=>x<0);
    const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;

    return new Response(JSON.stringify({
      ok:true,strategy,market:src.market,source:src.path,durableDbDays:durableDays.length,total,filtered,
      page,pageSize,pages,trades,
      summary:{
        trades:filtered,
        wins:wins.length,losses:losses.length,
        winRate:pn.length?wins.length/pn.length*100:0,
        avgPnl:avg(pn),avgWin:avg(wins),avgLoss:avg(losses),
        from:rows.length?rows[rows.length-1].date:null,
        to:rows.length?rows[0].date:null,
        currentDrawdownPct:risk.currentDrawdownPct,
        maxDrawdownPct:risk.maxDrawdownPct,
        lossStreakTradeDays:risk.lossStreakTradeDays,
        weekStart:risk.weekStart,
        weeklyReturnPct:risk.weeklyReturnPct,
        weeklyTargetPct:risk.weeklyTargetPct,
        weeklyTargetGapPct:risk.weeklyTargetGapPct,
        recentDaily:risk.recentDaily,
        dailySeries:risk.daily
      }
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
