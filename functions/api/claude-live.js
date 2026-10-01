// Cloudflare Pages Function — GET /api/claude-live
// 단타(클로드) 탭별 "오늘 모의 매매이력" (장중 실시간). 읽기 전용 — 주문 경로 없음.
//  ① 시초가 · ② 데이트레이딩: opening-scheduler Worker 의 오늘 gapdown ledger(KIS 모의투자 주문·체결 원본)를
//     서버에서 감시키로 읽어 가격·시각·손익만 돌려준다(주문번호·수량·키는 내보내지 않는다).
//  ③ 코인 · ④ 미국: 전날 확정 판단(scalping-data claude-lab/*-decisions.csv)과 현재 시세로 오늘 손익을 계산한다.
// 확정 결과는 밤 workflow 의 모의투자 장부(claude-paper)가 따로 남긴다. 이 응답은 화면 표시용이다.

const JH={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const WORKER="https://jkquant-opening-scheduler.mumae4.workers.dev";
const RAW="https://raw.githubusercontent.com/jkdevjob/jkquant/scalping-data/data/";
const KR_COST=0.23, ETF_COST=0.13, COIN_COST=0.14, US_COST=0.20;   // 왕복 비용 %(연구와 같은 값)
const COIN_STOP=4.0, COIN_STOP_SLIP=0.1, COIN_TAB_SIZE=0.6;

function json(o,s=200){return new Response(JSON.stringify(o),{status:s,headers:JH});}
export function kstToday(ms=Date.now()){
  const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(ms));
  const g=t=>p.find(x=>x.type===t)?.value||"";
  return {date:g("year")+"-"+g("month")+"-"+g("day"),hm:+g("hour")*100+ +g("minute")};
}
const pct=(a,b)=>a>0&&b>0?(a/b-1)*100:null;

async function ledger(env,date){
  const key=String(env.OPENING_MONITOR_KEY||env.AUTOTRADE_KEY||"").trim();
  if(!key)return null;
  try{
    const r=await fetch(WORKER+"/gapdown?date="+encodeURIComponent(date),{headers:{"x-monitor-key":key}});
    const j=await r.json().catch(()=>({}));
    return r.ok&&j.ok?j.ledger:null;
  }catch(e){return null;}
}
function stages(l){
  const m={};
  for(const e of (l&&Array.isArray(l.events)?l.events:[]))if(e&&e.stage)m[e.stage]=e.payload||{};
  return m;
}
async function quote(origin,sym){
  try{
    const r=await fetch(origin+"/api/quote?symbol="+encodeURIComponent(sym)+"&range=5d",{headers:{Accept:"application/json"}});
    const j=await r.json();
    return r.ok&&j.price?j:null;
  }catch(e){return null;}
}
async function csvLast(path,n=2){
  try{
    const r=await fetch(RAW+path+"?t="+Date.now());
    if(!r.ok)return [];
    const lines=(await r.text()).trim().split("\n");
    const head=lines[0].split(",");
    return lines.slice(-n).map(l=>{const v=l.split(",");return Object.fromEntries(head.map((h,i)=>[h,v[i]]));});
  }catch(e){return [];}
}

// ① 시초가: 08:59 장전 동시호가 매수 → 15:30 종가 매도
export function openingRows(st,prices){
  const pre=st.preopen||{},rec=st.reconcile||st.close||{};
  const pos=Object.fromEntries((rec.positions||[]).map(p=>[p.code,p]));
  const ord=Object.fromEntries((pre.orders||[]).filter(o=>o.side==="buy").map(o=>[o.code,o]));
  const sells=Object.fromEntries(((st.close||{}).orders||[]).filter(o=>o.side==="sell").map(o=>[o.code,o]));
  return (pre.picks||[]).map(p=>{
    const ps=pos[p.code]||{},o=ord[p.code]||{},bf=(ps.buy||{}).avgPrice||null,sf=(ps.sell||{}).avgPrice||null;
    const buy=bf||p.expectedPrice||null,now=prices[p.code]||null;
    const status=!(o.vts&&o.vts.ok)?"주문 실패":sf?"청산":(sells[p.code]&&sells[p.code].vts&&!sells[p.code].vts.ok)?"매도 실패":"보유중";
    const ref=sf||now;
    return {code:p.code,name:p.name||p.code,buyTime:"08:59 동시호가",buyPrice:buy,buyPriceKind:bf?"체결":"예상",
      sellTime:sf?"15:30 종가":null,sellPrice:sf,nowPrice:now,status,
      pnlPct:buy&&ref?pct(ref,buy)-KR_COST:null,realized:!!sf,expectedGapPct:p.expectedGapPct,
      note:o.vts&&!o.vts.ok?String(o.vts.msg||""):""};
  });
}
// ② ETF: 전날 15:21 종가 매수 → 오늘 08:59 시가 매도 · 오늘 15:21 종가 매수(오버나잇 보유)
export function etfRows(todaySt,prevSt,prevDate,nowPrice){
  const rows=[];
  const sell=todaySt.etf_sell,buyPrev=prevSt&&prevSt.etf_buy;
  if(sell&&buyPrev&&buyPrev.signal){
    const b=((prevSt.etf_reconcile||{}).fills||{}).closeBuy||{},s=((todaySt.etf_reconcile||{}).fills||{}).openSell||{};
    const bp=b.avgPrice||(buyPrev.quote||{}).expectedPrice||null,sp=s.avgPrice||null;
    rows.push({code:"233740",name:"KODEX 코스닥150레버리지",buyTime:prevDate+" 15:30 종가",buyPrice:bp,buyPriceKind:b.avgPrice?"체결":"예상",
      sellTime:"오늘 09:00 시가",sellPrice:sp,nowPrice:nowPrice,status:sp?"청산":(sell.order&&sell.order.vts&&sell.order.vts.ok?"매도 접수":"매도 대기"),
      pnlPct:bp&&(sp||nowPrice)?pct(sp||nowPrice,bp)-ETF_COST:null,realized:!!sp,note:sell.decisionReason||""});
  }
  const buy=todaySt.etf_buy;
  if(buy){
    const b=((todaySt.etf_reconcile||{}).fills||{}).closeBuy||{};
    if(buy.signal){
      const bp=b.avgPrice||(buy.quote||{}).expectedPrice||null;
      rows.push({code:"233740",name:"KODEX 코스닥150레버리지",buyTime:"오늘 15:30 종가",buyPrice:bp,buyPriceKind:b.avgPrice?"체결":"예상",
        sellTime:"다음 거래일 09:00 시가",sellPrice:null,nowPrice:nowPrice,status:buy.order&&buy.order.vts&&buy.order.vts.ok?"보유중(오버나잇)":"주문 실패",
        pnlPct:null,realized:false,dropPct:buy.dropPct,note:(buy.order&&buy.order.vts&&!buy.order.vts.ok)?String(buy.order.vts.msg||""):""});
    }else rows.push({code:"233740",name:"KODEX 코스닥150레버리지",status:"매매 없음",note:"15:21 예상 하락 "+(buy.dropPct==null?"—":buy.dropPct.toFixed(2)+"%")+" (기준 −3% 이하)"});
  }
  return rows;
}
// ③ 코인: 전날 종가가 20일 평균 위면 오늘 09시 시가에 보유, −4% 닿으면 손절
// 오늘(09시~) 보유 판단 = 어제까지 확정된 20개 종가의 평균 < 어제 종가. candles: 업비트 일봉 최신순(0 = 진행 중인 오늘).
export function coinHoldToday(candles,ma=20){
  const done=(Array.isArray(candles)?candles:[]).slice(1,1+ma).map(c=>+c.trade_price);
  if(done.length<ma||done.some(x=>!(x>0)))return null;
  const avg=done.reduce((a,b)=>a+b,0)/ma;
  return {hold:done[0]>avg,prevClose:done[0],ma:avg,basedOn:String(candles[1].candle_date_time_kst||"").slice(0,10)};
}
// 어제(09시~오늘 09시) 확정 결과: candles[1] 이 어제 봉, 그 판단은 candles[2..21] 종가로 한다.
export function coinDayResult(candles,ma=20){
  const c=Array.isArray(candles)?candles:[];
  if(c.length<ma+2)return null;
  const h=coinHoldToday(c.slice(1),ma);
  const d=c[1],open=+d.opening_price,low=+d.low_price,close=+d.trade_price;
  if(!h)return null;
  if(!h.hold)return {date:String(d.candle_date_time_kst||"").slice(0,10),hold:false,pnlPct:0,action:"쉼"};
  const stopped=low<=open*(1-COIN_STOP/100);
  return {date:String(d.candle_date_time_kst||"").slice(0,10),hold:true,action:stopped?"손절":"보유",
    pnlPct:stopped?(-COIN_STOP-COIN_STOP_SLIP-COIN_COST):pct(close,open)};
}
export function coinRow(market,lastDec,tick,today){
  const hold=lastDec&&String(lastDec.hold)!=="0";
  if(!tick)return {code:market,name:market.replace("KRW-",""),status:"시세 없음"};
  const open=+tick.opening_price,low=+tick.low_price,now=+tick.trade_price,stop=open*(1-COIN_STOP/100);
  return {code:market,name:market.replace("KRW-",""),hold,buyTime:"09:00",buyPrice:open,nowPrice:now,stopPrice:stop,
    status:!hold?"쉼(평균 아래)":low<=stop?"손절":"보유중",
    pnlPct:!hold?0:low<=stop?(-COIN_STOP-COIN_STOP_SLIP-COIN_COST):pct(now,open),realized:hold&&low<=stop,date:today};
}

export async function onRequestGet({request,env}){
  const origin=new URL(request.url).origin,now=kstToday(),out={ok:true,asOf:new Date().toISOString(),today:now.date,tabs:{}};
  try{
    // ①②
    const [lt,prev]=await Promise.all([ledger(env,now.date),(async()=>{
      for(let k=1;k<=5;k++){const d=kstToday(Date.now()-k*864e5).date;const l=await ledger(env,d);if(l&&(l.events||[]).length)return {date:d,l};}
      return null;})()]);
    const st=stages(lt),pst=prev?stages(prev.l):{};
    const codes=((st.preopen||{}).picks||[]).map(p=>p.code);
    const qs=await Promise.all([...codes,"233740"].map(c=>quote(origin,c)));
    const prices=Object.fromEntries([...codes,"233740"].map((c,i)=>[c,qs[i]?qs[i].price:null]));
    const pre=st.preopen||null;
    out.tabs.opening={rows:openingRows(st,prices),decision:pre?{reason:pre.decisionReason,breadth:pre.breadth||null,candidates:pre.candidates}:null,
      ledgerFound:!!lt,note:"08:56 예상체결가로 갭 판단 → 08:59 장전 동시호가 매수 → 15:21 종가 동시호가 매도 → 15:40 체결 조회. v2 매매일은 통과 5종목 이상."};
    out.tabs.daytrading={rows:etfRows(st,pst,prev&&prev.date,prices["233740"]),ledgerFound:!!lt,
      note:"전날 −3% 이하 마감이면 15:21 종가 매수 → 다음 거래일 08:59 시가 매도."};
    // ③
    const [btcDec,ethDec,tq]=await Promise.all([csvLast("claude-lab/btc-decisions.csv",1),csvLast("claude-lab/eth-decisions.csv",1),csvLast("claude-lab/tqqq-decisions.csv",2)]);
    let ticks={};
    try{const r=await fetch("https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH",{headers:{Accept:"application/json"}});for(const t of await r.json())ticks[t.market]=t;}catch(e){}
    const lab=await fetch(RAW+"claude-lab/latest.json?t="+Date.now()).then(r=>r.ok?r.json():null).catch(()=>null);
    const coins=await Promise.all(["KRW-BTC","KRW-ETH"].map(async m=>{
      let d=null;
      try{const r=await fetch("https://api.upbit.com/v1/candles/days?market="+m+"&count=22",{headers:{Accept:"application/json"}});d=coinHoldToday(await r.json());}catch(e){}
      const row=coinRow(m,d?{hold:d.hold?1:0}:((m==="KRW-BTC"?btcDec:ethDec)[0]||null),ticks[m],now.date);
      if(d)Object.assign(row,{signalBasedOn:d.basedOn,signalClose:d.prevClose,ma20:d.ma});
      return row;
    }));
    const basket=coins.reduce((s,c)=>s+(c.pnlPct||0),0)/2;
    out.tabs.crypto={rows:coins,basketPct:basket,tabPct:basket*COIN_TAB_SIZE,
      note:"업비트 하루는 09:00 시작. 전날 종가가 20일 평균 위면 09:00 시가로 보유, 시가 대비 −4% 닿으면 손절. 두 코인 반반, 탭 표시 자금 60%."};
    // ④
    const us=await quote(origin,"TQQQ");
    const un=((lab&&lab.tabs&&lab.tabs.soxl)||{}).nextSignal||null;
    const lastUs=tq[tq.length-1]||null;
    const ohlc=(us&&us.ohlc)||[],prevClose=ohlc.length?ohlc[ohlc.length-1].close:null;
    const intra=us&&us.intraday,livePx=intra&&(intra.regular||intra.pre||intra.post)?(intra.regular||intra.post||intra.pre).c:null;
    out.tabs.soxl={rows:[{code:"TQQQ",name:"TQQQ",hold:un?un.holdNext:null,status:un?(un.holdNext?"보유중":"쉼(200일 평균 아래)"):"판단 없음",
      lastSession:lastUs?{date:lastUs.date,pnlPct:lastUs.pnlPct===""?null:+lastUs.pnlPct,action:lastUs.action}:null,
      prevClose,nowPrice:livePx,pnlPct:un&&un.holdNext&&livePx&&prevClose?pct(livePx,prevClose):null,
      session:intra&&intra.regular?"정규장":intra&&intra.pre?"프리마켓":intra&&intra.post?"애프터마켓":"장 마감"}],
      note:"QQQ 종가가 200일 평균 위면 TQQQ 보유, −10% 손절. 미국장 결과는 한국시각 다음 날 아침에 확정."};
    return json(out);
  }catch(e){
    return json({ok:false,error:String(e.message||e)},502);
  }
}
