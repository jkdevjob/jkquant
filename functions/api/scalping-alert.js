// Cloudflare Pages Function — POST /api/scalping-alert
// 연구(지피티) 전략 공통 Telegram 알림. 서버 스케줄러 전용이며 주문을 만들지 않는다.
// 사용자 요청(2026-10-13): 모든 연구 메뉴는 실제 매수 · 매도 때만 알린다 — 메시지는 '[지피티 연구 시초가]' 처럼 시작하고,
// 장 종료 일일결과(summary)는 보내지 않는다(요청은 받아 skipped 로 답한다).

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const LABELS={opening:"시초가",daytrading:"데이트레이딩",crypto:"비트코인",soxl:"SOXL",swing:"과매도 반등",closing30:"종가 30분"};

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
function clean(v,n=1000){return String(v==null?"":v).replace(/[\u0000-\u001f]+/g," ").trim().slice(0,n);}
async function telegramReceipt(env,b,op,extra={}){
  const key=String(env.AUTOTRADE_KEY||"").trim();
  if(!key)throw new Error("durable Telegram receipt key missing");
  const endpoint=String(env.PUSH_ALERT_WORKER_URL||"https://jkquant-presale-alert.mumae4.workers.dev").replace(/\/$/,"")+"/signal-telegram";
  const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","x-monitor-key":key},
    body:JSON.stringify({strategy:b.strategy,stage:b.stage,eventId:b.eventId,date:b.date,eventAt:b.eventAt,op,...extra}),signal:AbortSignal.timeout(8000)});
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j?.ok)throw new Error(j?.error||("durable Telegram receipt HTTP "+r.status));
  return j;
}
async function webPush(env,b){
  const key=String(env.AUTOTRADE_KEY||"").trim();
  if(!key)return {ok:false,error:"AUTOTRADE_KEY not configured"};
  const endpoint=String(env.PUSH_ALERT_WORKER_URL||"https://jkquant-presale-alert.mumae4.workers.dev").replace(/\/$/,"")+"/signal";
  try{
    const r=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json","x-monitor-key":key},
      body:JSON.stringify({strategy:b.strategy,stage:b.stage,eventId:b.eventId,date:b.date,time:b.time,eventAt:b.eventAt,lines:b.lines})});
    const j=await r.json().catch(()=>({}));
    return r.ok&&j.ok?{ok:true,duplicate:!!j.duplicate,delivery:j.delivery||null}:{ok:false,error:j.error||("push HTTP "+r.status)};
  }catch(e){return {ok:false,error:String(e.message||e)};}
}
async function telegram(env,text){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)return {status:"failed",definite:true,error:"Telegram 환경변수 없음"};
  try{
    const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(10000)
    });
    const j=await r.json().catch(()=>null);
    if(r.ok&&j?.ok&&Number.isSafeInteger(j.result?.message_id)&&j.result.message_id>0)
      return {status:"sent",messageId:j.result.message_id};
    // A timeout/5xx/malformed response may follow an accepted send. Never replay it.
    const definite=r.status>=400&&r.status<500&&j?.ok===false;
    return {status:definite?"failed":"unknown",definite,error:clean(j?.description||("Telegram HTTP "+r.status),200)};
  }catch(e){return {status:"unknown",definite:false,error:"Telegram delivery uncertain"};}
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  let eventId="",webDelivery=null;
  try{
    const b=await request.json();
    const strategy=clean(b.strategy,30).toLowerCase(),stage=clean(b.stage,20).toLowerCase();
    if(!LABELS[strategy])return json({ok:false,error:"unknown strategy"},400);
    if(!["buy","sell","summary"].includes(stage))return json({ok:false,error:"unknown stage"},400);
    eventId=clean(b.eventId,220);
    if(!eventId)return json({ok:false,error:"eventId required"},400);
    if(stage!=="summary"&&b.eventAt!=null){
      const at=Date.parse(b.eventAt),age=Date.now()-at;
      if(!Number.isFinite(at))return json({ok:false,error:"invalid eventAt"},400);
      if(age>20*60_000||age< -90_000)return json({ok:true,eventId,skipped:"stale_or_future_signal"});
    }
    if(stage==="summary")return json({ok:true,eventId,skipped:"buy_sell_only"});
    const webOnly=b.webOnly===true;
    // Web push has its own durable receipt. A Telegram receipt must not suppress its retry.
    webDelivery=await webPush(env,{...b,strategy,stage,eventId});
    if(webOnly)return json({ok:webDelivery.ok,eventId,webPush:webDelivery},webDelivery.ok?200:502);
    // This durable, serialized claim works across Pages locations and survives restarts.
    // Fail closed: a receipt-store outage must never fall back to a direct Telegram send.
    const signal={...b,strategy,stage,eventId},claim=await telegramReceipt(env,signal,"claim");
    if(!claim.claimed){
      const done=claim.receipt?.status!=="failed";
      return json({ok:webDelivery.ok&&done,duplicate:true,eventId,webPush:webDelivery,telegram:claim.receipt},webDelivery.ok&&done?200:502);
    }

    const icon=stage==="buy"?"🟢":"🔴";
    const action=stage==="buy"?"매수":"매도";
    const when=[clean(b.date,20),clean(b.time,20)].filter(Boolean).join(" ");
    const lines=Array.isArray(b.lines)?b.lines.map(x=>clean(x,500)).filter(Boolean).slice(0,16):[];
    const msg=[
      "[지피티 연구 "+LABELS[strategy]+"] "+icon+" "+action,
      when,
      "",
      ...lines,
      "",
      "JKQuant 기준전략 알림"
    ].filter((x,i,a)=>!(x===""&&a[i-1]==="")).join("\n");
    const delivery=await telegram(env,msg);
    // The claim is persisted as unknown BEFORE network I/O. If this completion is lost,
    // later calls remain blocked rather than risk sending an accepted message twice.
    let receipt={...delivery,tries:claim.receipt.tries};
    try{receipt=(await telegramReceipt(env,signal,"complete",{token:claim.token,receipt:delivery})).receipt;}
    catch(e){receipt={status:"unknown",tries:claim.receipt.tries,completionUnconfirmed:true};}
    const ok=webDelivery.ok&&receipt.status!=="failed";
    return json({ok,eventId,messageId:receipt.messageId||null,webPush:webDelivery,telegram:receipt},ok?200:502);
  }catch(e){
    return json({ok:false,eventId,error:String(e.message||e),webPush:webDelivery},500);
  }
}
