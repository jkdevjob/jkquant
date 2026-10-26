// Owner-only closing 30-min research history, read-only Durable Object ledger.
// Includes every variant's signals and paper fills. No trade/order path.
import {ownerAuthorized} from "./global-paper.js";
const JH={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const WORKER="https://jkquant-opening-scheduler.mumae4.workers.dev";
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:JH});
const numeric=v=>v==null||v===''||!Number.isFinite(+v)?null:+v;
function kstDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function isoShift(date,n){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
async function readDay(env,date){
 const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"");
 if(!key)throw Error("worker monitor key missing");
 const base=String(env.OPENING_WORKER_URL||WORKER).replace(/\/$/,"");
 const ac=new AbortController(),timeout=setTimeout(()=>ac.abort(),5000);
 try{const r=await fetch(base+"/closing-ledger?date="+date,{headers:{"x-monitor-key":key,accept:"application/json"},signal:ac.signal});
 const j=await r.json();if(!r.ok||j.ok!==true)throw Error(j.error||String(r.status));return j.ledger||null;}
 finally{clearTimeout(timeout);}
}
function flatten(ledger){
 if(!ledger||!Array.isArray(ledger.events))return [];
 const map=new Map();
 for(const e of ledger.events){
  if(!e||!["day","overnight"].includes(e.kind)||!e.variant||!e.code)continue;
  const id=[e.date||ledger.date,e.kind,e.variant,e.code].join(":");
  let x=map.get(id);
  if(!x){x={id,date:e.date||ledger.date,kind:e.kind,variant:e.variant,code:e.code,name:e.name||e.code,
    signalTime:null,entryTime:null,exitTime:null,entryPrice:null,exitPrice:null,
    pnl:null,status:"signal",source:"server-paper-only",strategyVersion:e.decisionVersion||"closing30_v1"};map.set(id,x);}
  if(e.stage==="signal"){x.signalTime=e.createdAt;x.signal=e.signal||null;}
  if(e.stage==="buy"){x.entryTime=e.createdAt;x.entryPrice=numeric(e.price);x.status="open";}
  if(e.stage==="sell"){x.exitTime=e.createdAt;x.exitPrice=numeric(e.price);x.pnl=numeric(e.pnl);
    x.status=x.entryPrice>0&&x.exitPrice>0&&x.pnl!==null?"closed":"unverified";}
 }
 return [...map.values()];
}
export async function onRequestGet({request,env}){
 if(!await ownerAuthorized(request,env))return json({ok:false,error:"unauthorized"},401);
 const q=new URL(request.url).searchParams;
 const date=q.get("to")||kstDate(),days=Math.min(31,Math.max(1,+q.get("days")||14));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({ok:false,error:"bad date"},400);
 if(date>kstDate())return json({ok:false,error:"future date"},400);
 const kind=q.get("kind")||"all",variant=q.get("variant")||"all";
 if(!["all","day","overnight"].includes(kind)||!/^([a-zA-Z0-9_.-]{1,80}|all)$/.test(variant))return json({ok:false,error:"invalid filter"},400);
 const dates=Array.from({length:days},(_,i)=>isoShift(date,-i));
 const results=await Promise.allSettled(dates.map(d=>readDay(env,d)));
 const warnings=results.flatMap((r,i)=>r.status==="rejected"?[dates[i]+": "+String(r.reason?.message||r.reason)]:[]);
 const ledgers=results.filter(r=>r.status==="fulfilled"&&r.value).map(r=>r.value);
 const all=ledgers.flatMap(flatten);
 const variants=[...new Set(all.map(x=>x.variant))].sort((a,b)=>a==="baseline"?-1:b==="baseline"?1:a.localeCompare(b));
 const trades=all.filter(x=>(kind==="all"||x.kind===kind)&&(variant==="all"||x.variant===variant))
   .sort((a,b)=>b.date.localeCompare(a.date)||String(b.entryTime||"").localeCompare(String(a.entryTime||"")));
 const closed=trades.filter(x=>x.status==="closed");
 const sum=closed.reduce((a,x)=>a+x.pnl,0),wins=closed.filter(x=>x.pnl>0);
 return json({ok:true,source:"closing30-durable-paper-ledger",date,days,filters:{kind,variant},
  sourceWarnings:warnings,status:warnings.length?"degraded":ledgers.length?"ok":"collecting",
  recordedDates:ledgers.map(x=>x.date),variants,allCount:all.length,trades,
  summary:{signals:trades.length,closed:closed.length,open:trades.filter(x=>x.status==="open").length,
    missing:trades.filter(x=>x.status==="signal"||x.status==="unverified").length,
    wins:wins.length,winRate:closed.length?wins.length/closed.length*100:null,
    avgPnl:closed.length?sum/closed.length:null,
    // Trade average is NOT equal-weight daily account return; no portfolio PnL fabricated.
    tradePnlTotal:closed.length?sum:null}});
}
export {flatten};
