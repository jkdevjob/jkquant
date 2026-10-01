// Cloudflare Pages Function — GET /api/scalping-daily-results
// One-screen previous/latest completed-session results for the four active scalping strategies.
// Read-only: data comes from immutable scalping-data research/history files.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";

async function readText(path){
  const r=await fetch(RAW+path,{headers:{"Accept":"text/plain,application/json,text/csv","User-Agent":"jkquant-scalping-daily-results/1.0"}});
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
function isoKstDate(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return g("year")+"-"+g("month")+"-"+g("day");
}
function shiftIso(date,days){
  const [y,m,d]=String(date).split("-").map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
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
async function openingSessions(){
  const today=isoKstDate();
  const out=[];
  for(let back=0;back<15&&out.length<2;back++){
    const date=shiftIso(today,-back);
    const j=await readJson("opening-history/"+date+".json");
    if(!j)continue;
    const z=tradeSummary(String(j.date||date),j.trades||[]);
    z.source="opening-history";
    z.generatedAt=j.generatedAt||null;
    out.push(z);
  }
  return out;
}
async function daytradingSessions(){
  const j=await readJson("daytrading-research/latest.json");
  if(!j)return [];
  const base=(j.variants||[]).find(x=>x&&x.params&&x.params.name==="baseline");
  const daily=((base&&base.summary&&base.summary.daily)||[]).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,2);
  return daily.map(x=>({
    date:String(x.date||""),
    returnPct:num(x.returnPct)??0,
    sumPnlPct:null,
    trades:Number(x.trades||0),
    wins:null,
    losses:null,
    noTrade:Number(x.trades||0)===0,
    finalized:true,
    source:"daytrading-research",
    generatedAt:j.generatedAt||null
  }));
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
function pair(name,label,marketTime,sessions){
  const a=Array.isArray(sessions)?sessions:[];
  return {
    strategy:name,label,marketTime,
    current:a[0]||null,
    previous:a[1]||null,
    status:a.length?"ok":"collecting"
  };
}

export async function onRequestGet(){
  try{
    const [opening,daytrading,crypto,soxl]=await Promise.all([
      openingSessions(),
      daytradingSessions(),
      decisionSessions("crypto-research/baseline-decisions.csv","crypto-research"),
      decisionSessions("soxl-research/baseline-decisions.csv","soxl-research")
    ]);
    return new Response(JSON.stringify({
      ok:true,
      generatedAt:new Date().toISOString(),
      kstDate:isoKstDate(),
      returnRule:"If a strategy has multiple baseline trades in one session, daily return is the equal-weight average of trade net PnL. No-trade session = 0%.",
      strategies:[
        pair("opening","시초가","KST",opening),
        pair("daytrading","데이트레이딩","KST",daytrading),
        pair("crypto","비트코인","KST",crypto),
        pair("soxl","SOXL","ET",soxl)
      ]
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:502,headers:JH});
  }
}
