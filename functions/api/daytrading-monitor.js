// Cloudflare Pages Function — /api/daytrading-monitor
// 고정된 당일 Top100 스냅샷을 대상으로 데이트레이딩 모의 신호만 장중 감시한다.
// 기준전략만 Telegram 후보 신호를 보내고 shadow는 비교용으로만 계산한다.

import { minuteVolume, daySignal, DAY_SHADOW_VARIANTS } from "./_daytrading.js";

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
async function sendTelegram(env,title,lines){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)throw new Error("Telegram 환경변수 없음");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:"📈 "+title+"\n\n"+lines.join("\n"),disable_web_page_preview:true})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("Telegram 전송 실패: "+(j.description||r.status));
  return j.result&&j.result.message_id;
}
async function snapshot(date,year){
  const u="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/daytrading-universe/"+year+"/"+date+".json";
  const r=await fetch(u,{headers:{"Accept":"application/json","User-Agent":"jkquant-daytrading-monitor/1.0"},cf:{cacheTtl:60}});
  if(r.status===404)return null;
  if(!r.ok)throw new Error("snapshot HTTP "+r.status);
  return r.json();
}
function emptyShadow(){
  return Object.fromEntries(DAY_SHADOW_VARIANTS.map(v=>[v.name,{name:v.name,label:v.label,params:v.params,signals:[]}]));
}

async function scanShard(origin,now,snap,shard,shards){
  const universe=(snap.universe||[]).filter((_,i)=>i%shards===shard);
  const signals=[],shadow=emptyShadow(),errors=[];let idx=0;
  async function worker(){
    while(idx<universe.length){
      const u=universe[idx++];
      try{
        const mj=await fetch(origin+"/api/quote?symbol="+encodeURIComponent(u.code)+"&minute=1").then(r=>r.json());
        if(!mj.minutes||!mj.minutes.length)continue;
        const rows=minuteVolume(mj.minutes).filter(x=>String(x.t||"").slice(0,10)===now.date);
        const base=daySignal(rows,now.targetHm,{snapshotHm:+snap.snapshotHm||1000});
        if(base)signals.push({code:u.code,name:u.name||u.code,rank:+u.rank||0,...base});
        for(const v of DAY_SHADOW_VARIANTS){
          const s=daySignal(rows,now.targetHm,{snapshotHm:+snap.snapshotHm||1000,...v.params});
          if(s)shadow[v.name].signals.push({code:u.code,name:u.name||u.code,rank:+u.rank||0,...s});
        }
      }catch(e){errors.push({code:u.code,error:String(e.message||e).slice(0,120)});}
    }
  }
  await Promise.all([worker(),worker(),worker()]);
  const sorter=(a,b)=>a.signalTime-b.signalTime||(b.score-a.score)||a.rank-b.rank;
  signals.sort(sorter);Object.values(shadow).forEach(v=>v.signals.sort(sorter));
  return {universe:universe.length,signals,shadow,errors};
}

export async function onRequestGet({request,env}){
  if(!authorized(request,env))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  const url=new URL(request.url),now=kstNow();
  if(now.hm<1000||now.hm>1431)return new Response(JSON.stringify({ok:true,skipped:"outside_window",now}),{headers:JH});
  const snap=await snapshot(now.date,now.year);
  if(!snap)return new Response(JSON.stringify({ok:true,skipped:"snapshot_missing",date:now.date}),{headers:JH});

  const shard=Math.max(0,parseInt(url.searchParams.get("shard")||"0",10)||0);
  const shards=Math.max(1,Math.min(10,parseInt(url.searchParams.get("shards")||"5",10)||5));
  try{
    const res=await scanShard(url.origin,now,snap,shard,shards);
    const events=res.signals.filter(x=>x.signalTime===now.targetHm);
    let messageId=null;
    if(events.length){
      const lines=events.flatMap((x,i)=>[
        (i+1)+". "+x.name+" ("+x.code+") · Top"+x.rank,
        "후보신호 "+String(x.signalTime).padStart(4,"0")+" · 신호가 "+Math.round(x.signalPrice).toLocaleString("ko-KR")+"원",
        "세션 +"+x.sessionRet.toFixed(2)+"% · VWAP기울기 +"+x.vwapSlope.toFixed(2)+"% · 거래량 "+x.volRatio.toFixed(2)+"배",
        "※ 다음 1분봉 시가 진입은 장마감 KIS 데이터로 모의 재구성"
      ]);
      messageId=await sendTelegram(env,"데이트레이딩 모의 후보 신호 · "+String(now.targetHm).padStart(4,"0"),lines);
    }
    return new Response(JSON.stringify({
      ok:true,date:now.date,targetHm:now.targetHm,snapshotHm:+snap.snapshotHm||null,
      shard,shards,universe:res.universe,signalEvents:events,signals:res.signals,
      shadowEvents:Object.values(res.shadow).map(v=>({...v,signalEvents:v.signals.filter(x=>x.signalTime===now.targetHm)})),
      telegram:{sent:!!messageId,messageId},errors:res.errors.length
    }),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
