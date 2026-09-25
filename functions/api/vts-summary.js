// Cloudflare Pages Function — POST /api/vts-summary
// Read-only VTS execution-quality Telegram summary. Never submits broker orders.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.DAYTRADING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
const pct=v=>v==null?"—":((+v>=0?"+":"")+Number(v).toFixed(3)+"%");
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
function dayStats(rep){
  const a=(rep&&rep.matches)||[],complete=a.filter(x=>x.matched);
  const av=v=>{const z=v.filter(Number.isFinite);return z.length?z.reduce((s,x)=>s+x,0)/z.length:null;};
  return {
    internal:+(rep&&rep.internalTrades||0),kis:+(rep&&rep.kisOrders||0),matched:complete.length,
    entry:av(a.map(x=>x.entrySlippageCostPct)),
    exit:av(a.map(x=>x.exitSlippageCostPct)),
    net:av(complete.map(x=>x.vtsNetPnlPct)),
    costs:complete.reduce((s,x)=>s+(+x.vtsBrokerEstimatedCosts||0),0)
  };
}
export async function onRequestPost({request,env}){
  if(!authorized(request,env))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  try{
    const j=await request.json(),date=j.to||j.latest&&j.latest.date||"";
    const reps=(j.latest&&j.latest.reports)||[];
    const lines=["🔎 KIS VTS 체결대조 · "+date,"읽기전용 · 주문 전송 없음"];
    for(const name of ["opening","daytrading"]){
      const rep=reps.find(x=>x.strategy===name);
      if(!rep)continue;
      const s=dayStats(rep),label=name==="opening"?"시초가":"데이트레이딩";
      lines.push("",label+" · 내부 "+s.internal+"건 / VTS 주문 "+s.kis+"건 / 완전매칭 "+s.matched+"건");
      lines.push("진입 슬리피지 "+pct(s.entry)+" · 청산 "+pct(s.exit));
      lines.push("VTS 순손익 평균 "+pct(s.net)+" · 추정 제비용 "+Math.round(s.costs).toLocaleString("ko-KR")+"원");
    }
    const id=await telegram(env,lines.join("\n"));
    return new Response(JSON.stringify({ok:true,messageId:id}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
