// Cloudflare Pages Function — POST /api/scalping-daily-summary?strategy=crypto|soxl
// ⑤ 매매이력 + ⑥ 일일 검증/분석 기록을 전략별 Telegram으로 보낸다.
// 연구 리포트 전용이며 주문이나 전략 자동변경은 하지 않는다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
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
const num=(v,d=2)=>Number.isFinite(Number(v))?Number(v).toFixed(d):"—";
function baseline(report){
  return (report.variants||[]).find(x=>(x.params||{}).name==="baseline")||null;
}
function bestHoldout(report){
  const rows=(report.variants||[]).filter(x=>(x.params||{}).name!=="baseline");
  if(!rows.length)return null;
  return rows.slice().sort((a,b)=>{
    const aa=Number(((a.validation||{}).holdout||{}).avgPnl||-999);
    const bb=Number(((b.validation||{}).holdout||{}).avgPnl||-999);
    return bb-aa;
  })[0];
}
function reasonKo(x){
  const r=String(x||"");
  if(r==="take_profit")return "익절";
  if(r==="stop"||r==="stop_same_bar")return "손절";
  if(r==="time_exit")return "시간청산";
  return r||"—";
}
function btcLines(j){
  const b=baseline(j),s=b&&b.summary||{},h=b&&b.validation&&b.validation.holdout||{};
  const latest=(j.latestTrades||[]).slice(-1)[0]||null;
  const traded=latest&&latest.date===j.to;
  const lines=["₿ [비트코인] ⑤ 매매이력 · ⑥ 일일 검증/분석","기준일 "+String(j.to||"")];
  lines.push("","⑤ 오늘 매매이력");
  if(traded){
    lines.push(
      "TRADE · "+String(latest.entryTimeKst||"")+" → "+String(latest.exitTimeKst||"")+" · "+reasonKo(latest.reason),
      "진입 "+Number(latest.entryPrice||0).toLocaleString("ko-KR")+"원 · 청산 "+Number(latest.exitPrice||0).toLocaleString("ko-KR")+"원",
      "순손익 "+pct(latest.pnlPct)+" · OR고점 "+Number(latest.openingHigh||0).toLocaleString("ko-KR")+"원",
      "근거: VWAP "+Number(latest.signalVwap||0).toLocaleString("ko-KR")+"원 · 거래량 "+num(latest.volumeRatio,2)+"배"
    );
  }else{
    lines.push("NO TRADE · 확정 5분봉 기준 조건 충족 거래 없음","필터: 00:00 OR 돌파 + 거래량 1.2배 + VWAP 위 + 21:55 KST 신호(22:00 진입)까지");
  }
  lines.push("","⑥ 검증·분석 기록");
  lines.push("누적 "+Number(j.validDays||0)+"일 · 거래 "+Number(s.trades||0)+"건 · 승률 "+num(s.winRate,1)+"% · 평균 "+pct(s.avgPnl));
  lines.push("복리 "+pct(s.compoundReturnPct)+" · MDD "+pct(s.maxDrawdownPct)+" · +1% 이상 일수 "+pct(s.target1PctDayRatePct));
  lines.push("70/30 홀드아웃 "+Number(h.trades||0)+"건 · 평균 "+pct(h.avgPnl)+" · 30일 롤링 "+String((j.rolling30||{}).count||0)+"구간");
  const cand=bestHoldout(j);
  if(cand){
    const ch=((cand.validation||{}).holdout||{}),name=(cand.params||{}).name||"candidate";
    lines.push("그림자 관찰: "+name+" · 홀드아웃 평균 "+pct(ch.avgPnl)+" · 기준전략 자동변경 OFF");
  }else lines.push("그림자 관찰: 표본 수집 중 · 기준전략 자동변경 OFF");
  return lines;
}
function soxlLines(j){
  const b=baseline(j),s=b&&b.summary||{},h=b&&b.validation&&b.validation.holdout||{};
  const dec=(j.latestDecisions||[]).slice(-1)[0]||null;
  const tr=(j.latestTrades||[]).slice(-1)[0]||null;
  const traded=tr&&tr.date===j.to;
  const lines=["⚡ [SOXL] ⑤ 매매이력 · ⑥ 일일 검증/분석","기준일 "+String(j.to||"")];
  lines.push("","⑤ 오늘 매매이력");
  if(traded){
    lines.push(
      "TRADE · "+String(tr.entryTimeEt||"")+" → "+String(tr.exitTimeEt||"")+" ET · "+reasonKo(tr.reason),
      "진입 $"+num(tr.entryPrice)+" · 청산 $"+num(tr.exitPrice)+" · 순손익 "+pct(tr.pnlPct),
      "근거: OR $"+num(tr.openingHigh)+" · VWAP $"+num(tr.signalVwap)+" · 거래량 "+num(tr.volumeRatio,2)+"배",
      "MFE "+pct(tr.mfePct)+" · MAE "+pct(tr.maePct)
    );
  }else{
    lines.push("NO TRADE · "+String(dec&&dec.decisionReason||"기준전략 조건 미충족"));
    if(dec)lines.push("관찰: OR $"+num(dec.openingHigh)+" · 최대 거래량 "+num(dec.maxVolumeRatio,2)+"배 · 최대 OR돌파 "+pct(dec.maxCloseVsOpeningHighPct));
  }
  lines.push("","⑥ 검증·분석 기록");
  lines.push("누적 "+Number(j.validDays||0)+"일 · 거래 "+Number(s.trades||0)+"건 · 승률 "+num(s.winRate,1)+"% · 평균 "+pct(s.avgPnl));
  lines.push("복리 "+pct(s.compoundReturnPct)+" · MDD "+pct(s.maxDrawdownPct)+" · +1% 이상 일수 "+pct(s.target1PctDayRatePct));
  lines.push("홀드아웃 "+Number(h.trades||0)+"건 · 평균 "+pct(h.avgPnl)+" · WF "+String((j.walkForward||{}).status||"collecting")+" / "+Number((j.walkForward||{}).foldCount||0)+" folds");
  const cand=bestHoldout(j);
  if(cand){
    const ch=((cand.validation||{}).holdout||{}),name=(cand.params||{}).name||"candidate";
    lines.push("그림자 관찰: "+name+" · 홀드아웃 평균 "+pct(ch.avgPnl)+" · 기준전략 자동변경 OFF");
  }else lines.push("그림자 관찰: 표본 수집 중 · 기준전략 자동변경 OFF");
  return lines;
}
export async function onRequestPost({request,env}){
  if(!authorized(request,env))return json({ok:false,error:"unauthorized"},401);
  try{
    const strategy=String(new URL(request.url).searchParams.get("strategy")||"").toLowerCase();
    const j=await request.json();
    const lines=strategy==="crypto"?btcLines(j):strategy==="soxl"?soxlLines(j):null;
    if(!lines)return json({ok:false,error:"unsupported strategy"},400);
    const id=await telegram(env,lines.join("\n"));
    return json({ok:true,strategy,date:j.to||"",messageId:id});
  }catch(e){return json({ok:false,error:String(e.message||e)},500);}
}
