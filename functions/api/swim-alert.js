// Cloudflare Pages Function — POST /api/swim-alert
// GitHub Actions(수영대회 매일 수집)가 새 대회 · 접수 시작/마감 임박 · 일정/장소/접수 변경 · 취소/연기를
// 한 번에 묶어 보내면 텔레그램으로 전달한다. 중복 판정은 보내는 쪽(scripts/swim_alerts.py · alerts.json)이 한다.
// 방: TELEGRAM_SWIM_CHAT_ID 가 있으면 그 방, 없으면 JOB 알림과 같은 생활 알림 방(TELEGRAM_JOB_CHAT_ID).
const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const HEAD="[수영대회]";

export function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}

export function splitText(text,limit=3900){
  if(text.length<=limit)return [text];
  const chunks=[];let cur="";
  for(const line of text.split("\n")){
    const next=cur?cur+"\n"+line:line;
    if(next.length<=limit)cur=next;
    else{if(cur)chunks.push(cur);cur=line.slice(0,limit);}
  }
  if(cur)chunks.push(cur);
  return chunks;
}

// 링크는 이 앱의 수영대회 화면만 — 받은 글로 다른 주소를 열지 않는다.
export function validText(text){
  if(!text||text.length>30000)return false;
  if(!text.startsWith("<b>"+HEAD)&&!text.startsWith(HEAD))return false;
  const hrefs=[...text.matchAll(/href="([^"]*)"/g)].map(m=>m[1]);
  return hrefs.every(h=>/^https:\/\/jkquant\.pages\.dev\/swim(?:\?id=[0-9a-f]{12,16}\d*)?$/.test(h));
}

export function chatOf(env){
  return String(env.TELEGRAM_SWIM_CHAT_ID||env.TELEGRAM_JOB_CHAT_ID||"-5315924745").trim();
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  try{
    const body=await request.json();
    const text=String(body.text||"").trim();
    if(!validText(text))return new Response(JSON.stringify({ok:false,error:"invalid text"}),{status:400,headers:JH});
    const token=String(env.TELEGRAM_BOT_TOKEN||"").trim(),chatId=chatOf(env);
    if(!token||!chatId)throw new Error("Telegram 환경변수 없음");
    const ids=[];
    for(const chunk of splitText(text)){
      const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({chat_id:chatId,text:chunk,parse_mode:"HTML",disable_web_page_preview:true})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok||!j.ok)throw new Error("Telegram 전송 실패: "+(j.description||r.status));
      if(j.result&&j.result.message_id)ids.push(j.result.message_id);
    }
    return new Response(JSON.stringify({ok:true,count:Number(body.count||0),messageIds:ids}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}

export async function onRequestGet(){
  return new Response(JSON.stringify({ok:true,endpoint:"swim-alert",method:"POST"}),{headers:JH});
}
