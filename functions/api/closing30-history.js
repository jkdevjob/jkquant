// Owner-only closing 30-min research history, read-only Durable Object ledger.
// Includes every variant's signals and paper fills. No trade/order path.
import {ownerAuthorized} from "./global-paper.js";
import {flattenClosingLedger as flatten,readClosingLedger as readDay} from './_closing30-ledger.js';
const JH={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:JH});
function kstDate(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());}
function isoShift(date,n){const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
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
