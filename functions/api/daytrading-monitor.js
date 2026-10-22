// Cloudflare Pages Function — /api/daytrading-monitor
// 10:00~14:30 데이트레이딩 후보를 서버에서 계산한다.
// Cloudflare scheduler는 09:55 고정 Top100 스냅샷을 POST로 전달하고,
// GitHub/수동 GET은 scalping-data에 저장된 스냅샷을 fallback으로 사용한다.
// 실제 주문은 하지 않는다. 사용자 요청(2026-10-13): 후보 신호는 텔레그램으로 보내지 않는다 — 모든 연구 메뉴는 실제 매수 · 매도 때만 알린다
// (연구(지피티) 데이트레이딩의 모의 매수 · 매도는 daytrading-scheduler → /api/scalping-alert 가 '[지피티 연구 데이트레이딩]' 으로 보낸다).

import { minuteVolume, daySignal, DAY_BASE_PARAMS, DAY_SHADOW_VARIANTS, dayVariant } from "./_daytrading.js";

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

function kstNow(){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value||"",hh=+g("hour"),mm=+g("minute");
  return {date:g("year")+"-"+g("month")+"-"+g("day"),year:g("year"),hm:hh*100+mm,targetHm:mm>0?hh*100+(mm-1):(hh-1)*100+59};
}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
async function snapshot(date,year){
  const u="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/daytrading-universe/"+year+"/"+date+".json";
  const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-daytrading-monitor/1.1"},cf:{cacheTtl:60}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("snapshot HTTP "+r.status);
  return r.json();
}
async function generatedDayVariants(){
  const u="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/nightly-research/lifecycle.json";
  try{
    const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-day-generated/1.0"},cf:{cacheTtl:60}});
    if(!r.ok)return [];
    const j=await r.json();
    const life=((j.strategies||{}).daytrading)||{};
    const pool=Array.isArray(life.generatedPool)?life.generatedPool:[];
    return pool.map(x=>dayVariant(x&&x.name)).filter(Boolean);
  }catch(e){return [];}
}
function emptyShadow(variants){
  return Object.fromEntries((variants||[]).map(v=>[v.name,{name:v.name,label:v.label,params:{...DAY_BASE_PARAMS,...v.params},signals:[]}]));
}
function mainVariantDef(name){
  const n=String(name||"baseline");
  if(n==="baseline")return {name:"baseline",label:"원래 기준전략",params:{}};
  return dayVariant(n)||{name:"baseline",label:"원래 기준전략",params:{}};
}
function validTarget(now,requested){
  if(!Number.isFinite(requested))return null;
  const m=requested%100,h=Math.floor(requested/100);
  if(h<9||h>14||m<0||m>59||requested<959||requested>1430)return null;
  if(requested>now.targetHm)return null;
  return requested;
}

async function scanShard(origin,now,snap,shard,shards,targetHm,mainVariant="baseline"){
  const universe=(snap.universe||[]).filter((_,i)=>i%shards===shard);
  const generated=await generatedDayVariants();
  const shadowVariants=[{name:"baseline",label:"기준전략",params:{}},...DAY_SHADOW_VARIANTS,...generated.filter(v=>!DAY_SHADOW_VARIANTS.some(s=>s.name===v.name))];
  const signals=[],shadow=emptyShadow(shadowVariants),errors=[];let idx=0;
  const mainDef=mainVariantDef(mainVariant);
  async function worker(){
    while(idx<universe.length){
      const u=universe[idx++];
      try{
        const mj=await fetch(origin+"/api/quote?symbol="+encodeURIComponent(u.code)+"&minute=1").then(r=>r.json());
        if(!mj.minutes||!mj.minutes.length)continue;
        const rows=minuteVolume(mj.minutes).filter(x=>String(x.t||"").slice(0,10)===now.date);
        const base=daySignal(rows,targetHm,{snapshotHm:+snap.snapshotHm||1000,...mainDef.params});
        if(base)signals.push({code:u.code,name:u.name||u.code,rank:+u.rank||0,mainVariant:mainDef.name,strategyParams:{...DAY_BASE_PARAMS,...mainDef.params},...base});
        for(const v of shadowVariants){
          const s=daySignal(rows,targetHm,{snapshotHm:+snap.snapshotHm||1000,...v.params});
          if(s)shadow[v.name].signals.push({code:u.code,name:u.name||u.code,rank:+u.rank||0,...s});
        }
      }catch(e){errors.push({code:u.code,error:String(e.message||e).slice(0,120)});}
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  const sorter=(a,b)=>a.signalTime-b.signalTime||(b.score-a.score)||a.rank-b.rank;
  signals.sort(sorter);Object.values(shadow).forEach(v=>v.signals.sort(sorter));
  return {universe:universe.length,signals,shadow,errors,mainVariant:mainDef.name,mainParams:mainDef.params};
}

async function run(request,env,supplied){
  if(!authorized(request,env))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  const url=new URL(request.url),now=kstNow();
  if(now.hm<959||now.hm>1434)return new Response(JSON.stringify({ok:true,skipped:"outside_window",now}),{headers:JH});

  const body=supplied||{};
  let snap=body.snapshot||null;
  if(snap&&String(snap.date||"")!==now.date){
    return new Response(JSON.stringify({ok:false,error:"snapshot_date_mismatch",date:now.date,snapshotDate:snap.date}),{status:400,headers:JH});
  }
  if(!snap)snap=await snapshot(now.date,now.year);
  if(!snap)return new Response(JSON.stringify({ok:true,skipped:"snapshot_missing",date:now.date}),{headers:JH});

  const rawTarget=body.targetHm!=null?+body.targetHm:(url.searchParams.has("targetHm")?+url.searchParams.get("targetHm"):now.targetHm);
  const targetHm=validTarget(now,rawTarget);
  if(targetHm==null)return new Response(JSON.stringify({ok:false,error:"invalid_or_unfinished_targetHm",requested:rawTarget,latestCompleted:now.targetHm}),{status:400,headers:JH});

  const shard=Math.max(0,parseInt(body.shard??url.searchParams.get("shard")??"0",10)||0);
  const shards=Math.max(1,Math.min(10,parseInt(body.shards??url.searchParams.get("shards")??"5",10)||5));
  const mainVariant=mainVariantDef(body.mainVariant??url.searchParams.get("mainVariant")??"baseline").name;
  try{
    const res=await scanShard(url.origin,now,snap,shard,shards,targetHm,mainVariant);
    const events=res.signals.filter(x=>x.signalTime===targetHm);
    return new Response(JSON.stringify({
      ok:true,date:now.date,targetHm,snapshotHm:+snap.snapshotHm||null,snapshotSource:snap.captureSource||snap.source||"",
      shard,shards,universe:res.universe,mainVariant:res.mainVariant,mainParams:res.mainParams,signalEvents:events,notifiedEvents:0,signals:res.signals,
      shadowEvents:Object.values(res.shadow).map(v=>({...v,signalEvents:v.signals.filter(x=>x.signalTime===targetHm)})),
      telegram:{sent:false,disabled:"candidate_alerts_off"},errors:res.errors.length
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}

export async function onRequestGet({request,env}){return run(request,env,null);}
export async function onRequestPost({request,env}){
  let body={};
  try{body=await request.json();}catch(e){return new Response(JSON.stringify({ok:false,error:"JSON body 오류"}),{status:400,headers:JH});}
  return run(request,env,body);
}
