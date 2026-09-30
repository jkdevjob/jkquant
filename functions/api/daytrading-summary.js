// Cloudflare Pages Function — POST /api/daytrading-summary
// 장마감 누적 백테스트가 만든 오늘 모의 결과를 Telegram으로 요약한다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.DAYTRADING_MONITOR_KEY||env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
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
const signed=v=>(v>=0?"+":"")+Number(v||0).toFixed(2)+"%";

export async function onRequestPost({request,env}){
  if(!authorized(request,env))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  try{
    const j=await request.json(),today=j.latestDayTrades||[];
    const vars=j.variants||[];
    const lines=["📈 데이트레이딩 모의 일일요약 · "+(j.to||"")];
    lines.push("기준전략 "+today.length+"건");
    for(const x of today){
      lines.push("• "+(x.name||x.code)+" "+String(x.entryTime||"").padStart(4,"0")+"→"+String(x.exitTime||"").padStart(4,"0")+" "+signed(x.pnl));
    }
    lines.push("");
    lines.push("누적/그림자 비교");
    for(const v of vars){
      const n=v.params&&v.params.name||"",s=v.summary||{};
      lines.push("• "+n+" · "+(s.trades||0)+"건 · 승률 "+Number(s.winRate||0).toFixed(1)+"% · 평균 "+signed(s.avgPnl));
    }
    const id=await telegram(env,lines.join("\n"));
    return new Response(JSON.stringify({ok:true,messageId:id,count:today.length}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
