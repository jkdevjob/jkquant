// Cloudflare Pages Function — POST /api/scalping-alert
// 단타 전략 공통 Telegram 알림. 서버 스케줄러 전용이며 주문을 만들지 않는다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const LABELS={opening:"시초가",daytrading:"데이트레이딩",crypto:"비트코인",soxl:"SOXL",swing:"과매도 반등"};

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
function clean(v,n=1000){return String(v==null?"":v).replace(/[\u0000-\u001f]+/g," ").trim().slice(0,n);}
async function claim(eventId){
  if(!eventId||typeof caches==="undefined"||!caches.default)return true;
  const key="https://scalping-alert.internal/"+encodeURIComponent(eventId);
  try{
    if(await caches.default.match(key))return false;
    await caches.default.put(key,new Response("1",{headers:{"cache-control":"max-age=604800","content-type":"text/plain"}}));
  }catch(_){ return true; }
  return true;
}
async function telegram(env,text){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)throw new Error("Telegram 환경변수 없음");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error(j.description||("HTTP "+r.status));
  return j.result&&j.result.message_id;
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  try{
    const b=await request.json();
    const strategy=clean(b.strategy,30).toLowerCase(),stage=clean(b.stage,20).toLowerCase();
    if(!LABELS[strategy])return json({ok:false,error:"unknown strategy"},400);
    if(!["buy","sell","summary"].includes(stage))return json({ok:false,error:"unknown stage"},400);
    const eventId=clean(b.eventId,220);
    if(!eventId)return json({ok:false,error:"eventId required"},400);
    if(!(await claim(eventId)))return json({ok:true,duplicate:true,eventId});

    const icon=stage==="buy"?"🟢":stage==="sell"?"🔴":"📊";
    const action=stage==="buy"?"매수 타이밍":stage==="sell"?"매도 타이밍":"장 종료 일일결과";
    const when=[clean(b.date,20),clean(b.time,20)].filter(Boolean).join(" ");
    const lines=Array.isArray(b.lines)?b.lines.map(x=>clean(x,500)).filter(Boolean).slice(0,16):[];
    const msg=[
      icon+" ["+LABELS[strategy]+"] "+action,
      when,
      "",
      ...lines,
      "",
      stage==="summary"?"JKQuant 기준전략 당일 모의매매 마감":"JKQuant 기준전략 모의/연구 신호"
    ].filter((x,i,a)=>!(x===""&&a[i-1]==="")).join("\n");
    const id=await telegram(env,msg);
    return json({ok:true,eventId,messageId:id});
  }catch(e){
    return json({ok:false,error:String(e.message||e)},500);
  }
}
