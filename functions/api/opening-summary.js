// Cloudflare Pages Function — POST /api/opening-summary
// GitHub Actions가 09:31 KST에 Top100 5개 shard 결과를 합친 뒤 호출한다.
// Telegram 일일 요약만 담당하며 실제 주문은 하지 않는다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};

function authorized(request,env){
  const got=request.headers.get("x-monitor-key")||"";
  const want=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  return !!want&&got===want;
}
async function sendTelegram(env,title,lines){
  const token=String(env.TELEGRAM_BOT_TOKEN||"").trim();
  const chatId=String(env.TELEGRAM_CHAT_ID||"").trim();
  if(!token||!chatId)throw new Error("Telegram 환경변수 없음");
  const r=await fetch("https://api.telegram.org/bot"+token+"/sendMessage",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      chat_id:chatId,
      text:"📊 "+title+"\n\n"+lines.join("\n"),
      disable_web_page_preview:true
    })
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.ok)throw new Error("Telegram 전송 실패: "+(j.description||r.status));
  return j.result&&j.result.message_id;
}
const hm=v=>v==null?"—":String(v).padStart(4,"0");
const won=v=>v==null?"—":Math.round(v).toLocaleString("ko-KR")+"원";

export async function onRequestPost({request,env}){
  if(!authorized(request,env)){
    return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  }
  try{
    const body=await request.json();
    const date=String(body.date||"");
    const trades=Array.isArray(body.trades)?body.trades:[];
    const lines=[];

    if(!trades.length){
      lines.push("오늘 조건 충족 종목 0건");
      lines.push("Top100 · +2~+7% 갭 · 첫3분 고점 · 눌림→재돌파 · 수급 조건");
      lines.push("모의 신호 기준이며 실제 주문은 없습니다.");
    }else{
      let win=0,loss=0,flat=0,sum=0,nPnl=0;
      trades.forEach((x,i)=>{
        const p=Number.isFinite(+x.pnl)?+x.pnl:null;
        if(p!=null){nPnl++;sum+=p;if(p>0)win++;else if(p<0)loss++;else flat++;}
        lines.push(
          (i+1)+". "+String(x.name||x.code||"")+" ("+String(x.code||"")+")",
          "매수 "+hm(x.entryTime)+" · "+won(x.entryPrice),
          "매도 "+hm(x.exitTime)+" · "+won(x.exitPrice)+" · "+String(x.reason||"진행 중"),
          "손익 "+(p==null?"—":(p>=0?"+":"")+p.toFixed(2)+"%")
        );
        if(i<trades.length-1)lines.push("");
      });
      lines.push("");
      lines.push("거래 "+trades.length+"건 · 승 "+win+" · 패 "+loss+(flat?" · 보합 "+flat:""));
      if(nPnl)lines.push("평균 "+(sum/nPnl>=0?"+":"")+(sum/nPnl).toFixed(2)+"% · 단순합 "+(sum>=0?"+":"")+sum.toFixed(2)+"%");
      lines.push("손익은 왕복 마찰비용 0.25% 반영 · 분봉 종가 체결 근사");
    }

    const id=await sendTelegram(env,(date||"오늘")+" 시초가 모의매매 결과",lines);
    return new Response(JSON.stringify({ok:true,messageId:id,count:trades.length}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
