// Cloudflare Pages Function — GET /api/scalping-history?strategy=opening|daytrading|crypto|soxl
// Unified cumulative trade history backed by immutable research CSVs on scalping-data.
// Read-only. No order path and no strategy mutation.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";

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

export async function onRequestGet({request}){
  try{
    const u=new URL(request.url);
    const strategy=(u.searchParams.get("strategy")||"").toLowerCase();
    const src=SOURCES[strategy];
    if(!src)return new Response(JSON.stringify({ok:false,error:"strategy must be opening|daytrading|crypto|soxl"}),{status:400,headers:JH});

    const r=await fetch(RAW+src.path,{headers:{"Accept":"text/csv","User-Agent":"jkquant-scalping-history/1.0"}});
    if(r.status===404){
      return new Response(JSON.stringify({ok:true,strategy,source:src.path,total:0,filtered:0,page:1,pageSize:100,pages:0,trades:[],status:"collecting"}),{headers:JH});
    }
    if(!r.ok)throw new Error("GitHub raw "+src.path+" HTTP "+r.status);

    let rows=parseCsv(await r.text()).map(x=>normalize(strategy,x)).filter(x=>x.date);
    rows.sort((a,b)=>String(b.date).localeCompare(String(a.date))||String(b.entryTime).localeCompare(String(a.entryTime))||String(a.code).localeCompare(String(b.code)));
    const total=rows.length;

    const range=(u.searchParams.get("range")||"180").toLowerCase();
    let from=u.searchParams.get("from")||"",to=u.searchParams.get("to")||"";
    const rangeDays=parseInt(range,10);
    if(!from&&Number.isFinite(rangeDays)&&rangeDays>0)from=dateDaysAgo(rangeDays);
    if(from)rows=rows.filter(x=>x.date>=from);
    if(to)rows=rows.filter(x=>x.date<=to);

    const filtered=rows.length;
    const page=Math.max(1,parseInt(u.searchParams.get("page")||"1",10)||1);
    const pageSize=Math.min(200,Math.max(20,parseInt(u.searchParams.get("pageSize")||"100",10)||100));
    const pages=filtered?Math.ceil(filtered/pageSize):0;
    const start=(page-1)*pageSize;
    const trades=rows.slice(start,start+pageSize);
    const pn=rows.map(x=>x.pnl).filter(Number.isFinite);
    const wins=pn.filter(x=>x>0),losses=pn.filter(x=>x<0);
    const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;

    return new Response(JSON.stringify({
      ok:true,strategy,market:src.market,source:src.path,total,filtered,
      page,pageSize,pages,trades,
      summary:{
        trades:filtered,
        wins:wins.length,losses:losses.length,
        winRate:pn.length?wins.length/pn.length*100:0,
        avgPnl:avg(pn),avgWin:avg(wins),avgLoss:avg(losses),
        from:rows.length?rows[rows.length-1].date:null,
        to:rows.length?rows[0].date:null
      }
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
