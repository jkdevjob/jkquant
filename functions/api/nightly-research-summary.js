// POST /api/nightly-research-summary
// 시초가 + 데이트레이딩 + KIS VTS 누적 연구결과를 하루 한 번 Telegram으로 요약한다.
// 연구 리포트 전용이며 주문/전략 파라미터 변경은 하지 않는다.

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
const pct=v=>v==null?"—":(Number(v)>=0?"+":"")+Number(v).toFixed(2)+"%";
function variant(report,name){
  return (report?.variants||[]).find(x=>x.name===name)||null;
}
function topCandidate(report){
  const a=report?.candidates||[];
  return a.find(x=>x.status==="review")||a[0]||null;
}
export async function onRequestPost({request,env}){
  if(!authorized(request,env))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:JH});
  try{
    const j=await request.json();
    const o=j.opening||{},d=j.daytrading||{},e=j.execution||{};
    const ob=variant(o,"baseline"),db=variant(d,"baseline");
    const oc=topCandidate(o),dc=topCandidate(d);
    const ov=(e.strategies||[]).find(x=>x.strategy==="opening")||{};
    const dv=(e.strategies||[]).find(x=>x.strategy==="daytrading")||{};
    const lines=["🧪 단타 야간 자동연구 · "+String(j.date||"")];

    lines.push("","[시초가]");
    lines.push("누적 "+Number(o.archiveDays||0)+"일 · 기준 "+Number(ob?.windows?.all?.trades||0)+"건 · 평균 "+pct(ob?.windows?.all?.avgPnl));
    lines.push("최근20일 평균 "+pct(ob?.windows?.last20?.avgPnl)+" · 상태 "+String(o.status||"collecting"));
    if(oc)lines.push("개선안 관찰: "+oc.name+" · 20일 우위 "+pct(oc.last20AvgEdgePct)+" · 전체 우위 "+pct(oc.allAvgEdgePct)+" · "+oc.status);
    else lines.push("개선안 관찰: 표본 수집 중");

    lines.push("","[데이트레이딩]");
    lines.push("원본 "+Number(d.archiveDays||0)+"일 · 유효 "+Number(d.eligibleArchiveDays||0)+"일 · 기준 "+Number(d.baselineTradeCount||0)+"건");
    lines.push("비교 "+String(d.comparisonStatus||"collecting")+" · walk-forward "+String(d.walkForwardStatus||"collecting"));
    if(db)lines.push("기준 평균 "+pct(db.avgPnl)+" · 누적 "+pct(db.portfolioReturnPct)+" · MDD "+pct(db.portfolioMddPct));
    if(dc)lines.push("개선안 관찰: "+dc.name+" · 평균손익 우위 "+pct(dc.avgPnlEdgePct)+" · "+dc.status);
    else lines.push("개선안 관찰: 표본 수집 중");

    lines.push("","[KIS VTS 체결검증]");
    lines.push("시초가 매칭 "+Number(ov.completeMatches||0)+"건 · 관측 마찰 "+pct(ov.avgObservedExecutionDragPct)+" · "+String(ov.calibrationStatus||"collecting"));
    lines.push("데이트레이딩 매칭 "+Number(dv.completeMatches||0)+"건 · 관측 마찰 "+pct(dv.avgObservedExecutionDragPct)+" · "+String(dv.calibrationStatus||"collecting"));

    lines.push("","기준전략 자동변경: OFF");
    lines.push("표본·일관성 기준을 넘으면 검토 후보만 올립니다.");
    const id=await telegram(env,lines.join("\n"));
    return new Response(JSON.stringify({ok:true,messageId:id}),{headers:JH});
  }catch(e){
    return new Response(JSON.stringify({ok:false,error:String(e.message||e)}),{status:500,headers:JH});
  }
}
