// Cloudflare Pages Function — POST /api/job-alert
// GitHub Actions가 매일 09:00 KST에 대전·세종 Java/AI 신규 공고를 보내면
// 기존 Telegram 환경변수를 재사용해 알림을 전송한다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}

function splitText(text,limit=3900){
  if(text.length<=limit)return [text];
  const chunks=[];
  let current="";
  for(const block of text.split("\n\n")){
    const next=current?current+"\n\n"+block:block;
    if(next.length<=limit){
      current=next;
    }else{
      if(current)chunks.push(current);
      current=block;
    }
  }
  if(current)chunks.push(current);
  return chunks;
}

async function sendTelegramToChat(env,text,targetChatId){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim();
  const chatId=String(targetChatId||env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)throw new Error("Telegram 환경변수 없음");

  const ids=[];
  for(const chunk of splitText(text)){
    const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        chat_id:chatId,
        text:chunk,
        parse_mode:"HTML",
        disable_web_page_preview:true
      })
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.ok)throw new Error("Telegram 전송 실패: "+(j.description||r.status));
    if(j.result&&j.result.message_id)ids.push(j.result.message_id);
  }
  return ids;
}

async function findLatestGroupChat(env){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim();
  if(!token)throw new Error("Telegram bot token 없음");
  const current=String(env.TELEGRAM_CHAT_ID||"").trim();
  const r=await fetch("https://api.telegram.org/bot"+token+"/getUpdates?limit=100&timeout=0");
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("Telegram getUpdates 실패: "+(j.description||r.status));
  const chats=[];
  for(const u of (j.result||[])){
    const msg=u.message||u.channel_post||u.edited_message||null;
    const chat=msg&&msg.chat;
    if(!chat)continue;
    const type=String(chat.type||"");
    const id=String(chat.id||"");
    if((type==="group"||type==="supergroup")&&id&&id!==current){
      chats.push({id,title:String(chat.title||""),updateId:Number(u.update_id||0)});
    }
  }
  chats.sort((a,b)=>b.updateId-a.updateId);
  return chats[0]||null;
}

export async function onRequestPost({request,env}){
  if(!authorized(request,env)){
    return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  }

  try{
    const body=await request.json();

    if(body.action==="test-latest-group"){
      const chat=await findLatestGroupChat(env);
      if(!chat){
        return new Response(JSON.stringify({ok:false,error:"새 Telegram 그룹 업데이트를 찾지 못했습니다."}),{status:404,headers:JH});
      }
      const text=String(body.text||"✅ JKQuant 새 프로젝트방 테스트 메시지입니다.").trim();
      const messageIds=await sendTelegramToChat(env,text,chat.id);
      return new Response(JSON.stringify({ok:true,chatId:chat.id,title:chat.title,messageIds}),{headers:JH});
    }

    const text=String(body.text||"").trim();
    const count=Number(body.count||0);
    if(!text){
      return new Response(JSON.stringify({ok:false,error:"empty text"}),{status:400,headers:JH});
    }
    if(text.length>30000){
      return new Response(JSON.stringify({ok:false,error:"text too long"}),{status:400,headers:JH});
    }

    const messageIds=await sendTelegramToChat(env,text);
    return new Response(JSON.stringify({ok:true,count,messageIds}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
